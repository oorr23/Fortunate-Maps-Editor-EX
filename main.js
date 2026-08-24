var http = require('http');
var FormData = require('form-data');
var fs = require('fs');
var path = require('path');
var express = require('express');
var WebSocket = require('ws');

var app = express();
var PORT = process.env.PORT || 8060;

app.use(express.static(path.join(__dirname, 'static')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

function toBuffer(data, encoding) {
  if (Buffer.from) {
    return encoding ? Buffer.from(data, encoding) : Buffer.from(data);
  }
  return encoding ? new Buffer(data, encoding) : new Buffer(data);
}

var FM_BASE = 'https://fortunatemaps.herokuapp.com';
var TP_PAGE = 'https://tagpro.koalabeast.com/textures/';
var TP_FALLBACK = path.join(__dirname, 'static', 'official-texture-packs.json');
var TP_MAX_BYTES = 5 * 1024 * 1024;
var TP_HOSTS = {
  'tagpro.koalabeast.com': true,
  'static.koalabeast.com': true,
  'koalabeast.com': true,
  'www.koalabeast.com': true,
  'i.imgur.com': true,
  'imgur.com': true,
  'raw.githubusercontent.com': true,
  'cdn.jsdelivr.net': true,
  'github.com': true,
  'fortunatemaps.herokuapp.com': true,
  'cdn.discordapp.com': true,
  'media.discordapp.net': true
};

function tpAllowedUrl(raw) {
  try {
    var u = new URL(String(raw || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    var host = u.hostname.toLowerCase();
    if (TP_HOSTS[host] || host.slice(-16) === '.koalabeast.com') return u.toString();
    return null;
  } catch (err) {
    return null;
  }
}

function tpNormalizePack(p) {
  return {
    id: p.url || p.id,
    name: p.name,
    author: p.author || '',
    tiles: p.tiles,
    speedpad: p.speedpad,
    speedpadRed: p.speedpadRed,
    speedpadBlue: p.speedpadBlue,
    portal: p.portal,
    portalRed: p.portalRed,
    portalBlue: p.portalBlue,
    gravityWell: p.gravityWell || '/images/gravitywell.png'
  };
}

function tpParseCatalog(html) {
  var start = html.indexOf('[{"name":"Classic"');
  if (start < 0) throw new Error('catalog');
  var json = html.slice(start)
    .replace(/"name":"Yin & Yang"& Yang"/g, '"name":"Yin & Yang"')
    .replace(/\\_/g, '_');
  var end = json.indexOf(']\n');
  if (end < 0) end = json.indexOf(']</');
  if (end < 0) end = json.lastIndexOf(']');
  return JSON.parse(json.slice(0, end + 1)).map(tpNormalizePack);
}

function tpSendFallback(res) {
  res.sendFile(TP_FALLBACK);
}

function fmMapId(raw) {
  return String(raw || '').replace(/\.png$/i, '').replace(/\.json$/i, '').replace(/\D/g, '');
}

app.get('/fm/map/:id', function(req, res) {
  var id = fmMapId(req.params.id);
  if (!id) return res.status(400).json({ err: 'Enter a FortunateMaps map ID or URL.' });
  if (typeof fetch !== 'function') {
    return res.status(500).json({ err: 'This Node version cannot fetch FortunateMaps maps.' });
  }

  Promise.all([
    fetch(FM_BASE + '/png/' + id + '.png'),
    fetch(FM_BASE + '/json/' + id + '.json')
  ]).then(function(results) {
    var pngRes = results[0];
    var jsonRes = results[1];
    if (!pngRes.ok || !jsonRes.ok) {
      var err = new Error('notfound');
      err.status = 404;
      throw err;
    }
    return Promise.all([pngRes.arrayBuffer(), jsonRes.text()]).then(function(bodies) {
      res.json({
        id: id,
        png: 'data:image/png;base64,' + Buffer.from(bodies[0]).toString('base64'),
        json: bodies[1]
      });
    });
  }).catch(function(err) {
    if (err && err.status === 404) {
      return res.status(404).json({ err: 'Map ' + id + ' was not found on FortunateMaps.' });
    }
    res.status(502).json({ err: 'Could not reach FortunateMaps. Check the network and try again.' });
  });
});

app.get('/tp/catalog', function(req, res) {
  if (typeof fetch !== 'function') return tpSendFallback(res);
  fetch(TP_PAGE, { headers: { 'User-Agent': 'tagpro-mobile-editor' } }).then(function(r) {
    if (!r.ok) throw new Error('catalog');
    return r.text();
  }).then(function(html) {
    res.json(tpParseCatalog(html));
  }).catch(function() {
    tpSendFallback(res);
  });
});

app.get('/tp/image', function(req, res) {
  var url = tpAllowedUrl(req.query.u);
  if (!url) return res.status(400).type('text').send('Texture URL is not allowed.');
  if (typeof fetch !== 'function') {
    return res.status(500).type('text').send('This Node version cannot fetch texture images.');
  }
  fetch(url, { headers: { 'User-Agent': 'tagpro-mobile-editor' }, redirect: 'follow' }).then(function(r) {
    if (!r.ok) {
      var err = new Error('upstream');
      err.status = r.status;
      throw err;
    }
    var len = Number(r.headers.get('content-length') || 0);
    if (len > TP_MAX_BYTES) {
      var tooBig = new Error('too-large');
      tooBig.status = 413;
      throw tooBig;
    }
    var ct = r.headers.get('content-type') || 'image/png';
    if (ct.indexOf('image/') !== 0 && ct.indexOf('application/octet-stream') !== 0) {
      var notImg = new Error('not-image');
      notImg.status = 415;
      throw notImg;
    }
    return r.arrayBuffer().then(function(buf) {
      if (buf.byteLength > TP_MAX_BYTES) {
        return res.status(413).type('text').send('Texture image is too large.');
      }
      res.set('Content-Type', ct.indexOf('image/') === 0 ? ct : 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(buf));
    });
  }).catch(function(err) {
    if (err && err.status) return res.status(err.status).type('text').send('Could not load texture.');
    res.status(502).type('text').send('Could not load texture.');
  });
});

app.get('/collab/:id', function(req, res) {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

app.post('/test', function(req, res) {
    var logic = JSON.parse(req.body.logic);
    var layout = toBuffer(req.body.layout, 'base64');

    var url;
    if (req.body.eu == 'true')
      url =  Math.random() < 0.5 ? 'http://maptest.newcompte.fr/testmap' : 'http://justletme.be:8080/testmap';
    else
      url = 'http://tagpro-maptest.koalabeast.com/testmap';

    var form = new FormData();

    fs.writeFileSync('temp.json', toBuffer(JSON.stringify(logic)));
    fs.writeFileSync('temp.png', layout);
    form.append('logic', fs.createReadStream('temp.json'));
    form.append('layout', fs.createReadStream('temp.png'));

    form.submit(url, function(err, testRes) {
      if (err) {
        res.send('Sorry, we could not start up a test map. ' + err.toString());
      } else {
        testRes.resume();
        res.send(testRes.headers);
      }
    });
});

var ROOM_ID_RE = /^[A-Za-z0-9]{12,16}$/;
var MAX_COLLAB_BYTES = 5 * 1024 * 1024;
var MAX_CURSOR_TILES = 512;
var MAX_USERNAME = 32;
var MAX_CHAT = 300;
var collabRooms = Object.create(null);
var nextClientId = 1;

var HIGHLIGHT_COLORS = ['green', 'blue', 'red', 'purple', 'orange', 'yellow', 'turquoise', 'pink', 'brown'];
var HIGHLIGHT_COLOR_SET = {};
HIGHLIGHT_COLORS.forEach(function(name) { HIGHLIGHT_COLOR_SET[name] = true; });

function sendJson(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function sanitizeUsername(raw, fallback) {
  var s = String(raw == null ? '' : raw).replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (s.length > MAX_USERNAME) s = s.slice(0, MAX_USERNAME);
  return s || fallback;
}

function sanitizeChat(raw) {
  if (typeof raw !== 'string') return '';
  if (raw.length > 2000) return '';
  var s = raw.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (s.length > MAX_CHAT) s = s.slice(0, MAX_CHAT);
  return s;
}

function broadcastSystem(room, text) {
  if (!room || !text) return;
  var payload = { type: 'system', msg: String(text).slice(0, 200) };
  room.clients.forEach(function(peer) {
    sendJson(peer, payload);
  });
}

function publicUser(ws) {
  return { id: ws.clientId, username: ws.username, color: ws.color };
}

function roomUsers(room) {
  var list = [];
  room.clients.forEach(function(client) {
    list.push(publicUser(client));
  });
  return list;
}

function broadcastUsers(room) {
  var payload = { type: 'users', users: roomUsers(room), peers: room.clients.size };
  room.clients.forEach(function(peer) {
    sendJson(peer, payload);
  });
}

function pickNextColor(room, self) {
  var used = {};
  room.clients.forEach(function(client) {
    if (client !== self && client.color) used[client.color] = true;
  });
  for (var i = 0; i < HIGHLIGHT_COLORS.length; i++) {
    if (!used[HIGHLIGHT_COLORS[i]]) {
      room.lastColorIndex = i;
      return HIGHLIGHT_COLORS[i];
    }
  }
  var next = ((room.lastColorIndex >= 0 ? room.lastColorIndex : -1) + 1) % HIGHLIGHT_COLORS.length;
  room.lastColorIndex = next;
  return HIGHLIGHT_COLORS[next];
}

function sendMapState(ws, room) {
  sendJson(ws, {
    type: 'state',
    png: room.png,
    json: room.json,
    tiles: room.tiles,
    peers: room.clients.size
  });
}

function sendWelcome(ws, room) {
  sendJson(ws, {
    type: 'welcome',
    id: ws.clientId,
    color: ws.color,
    username: ws.username,
    users: roomUsers(room),
    png: room.png,
    json: room.json,
    tiles: room.tiles,
    peers: room.clients.size
  });
  sendMapState(ws, room);
}

function leaveCollabRoom(ws) {
  var id = ws.collabRoom;
  if (!id) return;
  var leftId = ws.clientId;
  var leftName = ws.username;
  ws.collabRoom = null;
  var room = collabRooms[id];
  if (!room) return;
  room.clients.delete(ws);
  if (room.clients.size === 0) {
    delete collabRooms[id];
    return;
  }
  broadcastUsers(room);
  if (leftName) broadcastSystem(room, leftName + ' left');
  room.clients.forEach(function(peer) {
    if (leftId != null) sendJson(peer, { type: 'cursor-leave', id: leftId });
    sendJson(peer, { type: 'state', peers: room.clients.size });
  });
}

function joinCollabRoom(ws, roomId, msg) {
  if (!ROOM_ID_RE.test(roomId)) {
    sendJson(ws, { type: 'error', error: 'invalid-room' });
    return;
  }
  if (ws.collabRoom === roomId) {
    var same = collabRooms[roomId];
    if (same) sendWelcome(ws, same);
    return;
  }
  leaveCollabRoom(ws);
  var room = collabRooms[roomId];
  if (!room) {
    room = collabRooms[roomId] = {
      clients: new Set(),
      png: null,
      json: null,
      tiles: null,
      lastColorIndex: -1,
      nextBall: 1
    };
  }
  room.clients.add(ws);
  ws.collabRoom = roomId;
  if (!ws.clientId) ws.clientId = nextClientId++;
  ws.color = pickNextColor(room, ws);
  ws.username = sanitizeUsername(msg && msg.username, 'Some Ball ' + (room.nextBall++));
  sendWelcome(ws, room);
  broadcastUsers(room);
  broadcastSystem(room, ws.username + ' joined');
  room.clients.forEach(function(peer) {
    if (peer !== ws) sendJson(peer, { type: 'state', peers: room.clients.size });
  });
}

function statePayloadSize(msg) {
  var n = 0;
  if (typeof msg.png === 'string') n += msg.png.length;
  if (typeof msg.json === 'string') n += msg.json.length;
  if (msg.tiles != null) {
    try { n += JSON.stringify(msg.tiles).length; } catch (err) { return Infinity; }
  }
  return n;
}

function applyCollabState(ws, msg) {
  var id = ws.collabRoom;
  if (!id) return;
  var room = collabRooms[id];
  if (!room) return;
  if (typeof msg.png !== 'string' || typeof msg.json !== 'string') return;
  if (statePayloadSize(msg) > MAX_COLLAB_BYTES) return;
  room.png = msg.png;
  room.json = msg.json;
  room.tiles = Array.isArray(msg.tiles) ? msg.tiles : null;
  room.clients.forEach(function(peer) {
    if (peer === ws) return;
    sendMapState(peer, room);
  });
}

function applyDetails(ws, msg) {
  var id = ws.collabRoom;
  if (!id) return;
  var room = collabRooms[id];
  if (!room) return;
  var fallback = ws.username || ('Some Ball ' + (room.nextBall++));
  ws.username = sanitizeUsername(msg.username, fallback);
  if (HIGHLIGHT_COLOR_SET[msg.color]) ws.color = msg.color;
  broadcastUsers(room);
}

function sanitizeCursorTiles(msg) {
  if (!msg) return null;
  if (msg.clear) return [];
  var tiles = msg.tiles;
  if (!Array.isArray(tiles) && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
    tiles = [{ x: msg.x, y: msg.y }];
  }
  if (!Array.isArray(tiles)) return null;
  if (tiles.length > MAX_CURSOR_TILES) return null;
  var out = [];
  for (var i = 0; i < tiles.length; i++) {
    var t = tiles[i];
    if (!t || typeof t !== 'object') continue;
    var x = t.x | 0;
    var y = t.y | 0;
    if (x < -1 || y < -1 || x > 512 || y > 512) continue;
    out.push({ x: x, y: y });
  }
  return out;
}

function applyCursor(ws, msg) {
  var id = ws.collabRoom;
  if (!id || ws.clientId == null) return;
  var room = collabRooms[id];
  if (!room) return;
  var tiles = sanitizeCursorTiles(msg);
  if (!tiles) return;
  ws.cursor = tiles;
  var payload = {
    type: 'cursor',
    id: ws.clientId,
    color: ws.color,
    username: ws.username,
    tiles: tiles
  };
  room.clients.forEach(function(peer) {
    if (peer === ws) return;
    sendJson(peer, payload);
  });
}

function applyChat(ws, msg) {
  var id = ws.collabRoom;
  if (!id) return;
  var room = collabRooms[id];
  if (!room) return;
  var text = sanitizeChat(msg && msg.msg);
  if (!text) return;
  var payload = {
    type: 'chat',
    id: ws.clientId,
    username: ws.username,
    color: ws.color,
    msg: text
  };
  room.clients.forEach(function(peer) {
    sendJson(peer, payload);
  });
}

var server = http.createServer(app);
var wss = new WebSocket.Server({ server: server, maxPayload: MAX_COLLAB_BYTES });

wss.on('connection', function(ws) {
  ws.collabRoom = null;
  ws.clientId = null;
  ws.color = null;
  ws.username = null;
  ws.cursor = null;
  ws.on('message', function(data) {
    var msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'join') {
      joinCollabRoom(ws, String(msg.room || ''), msg);
    } else if (msg.type === 'state') {
      applyCollabState(ws, msg);
    } else if (msg.type === 'details') {
      applyDetails(ws, msg);
    } else if (msg.type === 'cursor') {
      applyCursor(ws, msg);
    } else if (msg.type === 'chat') {
      applyChat(ws, msg);
    }
  });
  ws.on('close', function() {
    leaveCollabRoom(ws);
  });
});

server.listen(PORT, '0.0.0.0', function() {
  console.log('TagPro Map Editor running at http://localhost:' + PORT);
  console.log('On your phone, use this computer LAN IP on port ' + PORT);
});
