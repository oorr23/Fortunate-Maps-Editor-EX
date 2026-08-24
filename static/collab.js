$(function() {
  var ROOM_RE = /^[A-Za-z0-9]{12,16}$/;
  var CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var CURSOR_THROTTLE_MS = 60;
  var HIGHLIGHT_COLORS = {
    green: '#99FF99',
    blue: '#9999ff',
    red: '#ff9999',
    purple: '#cc99ff',
    orange: '#ffcc99',
    yellow: '#ffff99',
    turquoise: '#6fe8e0',
    pink: '#ffb8e8',
    brown: '#816040'
  };

  var socket = null;
  var roomId = null;
  var joined = false;
  var peers = 0;
  var copiedFlash = false;
  var pushedLocal = false;
  var haveRoomMap = false;
  var lastKey = '';
  var reconnectTimer = null;
  var closing = false;
  var copyAfterJoin = false;
  var myId = null;
  var myColor = 'green';
  var users = [];
  var peerCursors = {};
  var lastCursorKey = null;
  var cursorTimer = null;
  var pendingCursorTiles = null;

  function mapFn(names) {
    var map = window.TagproMap || {};
    for (var i = 0; i < names.length; i++) {
      if (typeof map[names[i]] === 'function') return map[names[i]].bind(map);
    }
    return null;
  }

  function getPng() {
    var fn = mapFn(['getPngBase64Url']);
    return fn ? fn() : null;
  }

  function getJson() {
    var fn = mapFn(['makeLogicString']);
    return fn ? fn() : null;
  }

  function getTiles() {
    var fn = mapFn(['extractMap']);
    if (!fn) return null;
    var extracted = fn();
    if (Array.isArray(extracted)) return extracted;
    return extracted && extracted.tiles ? extracted.tiles : null;
  }

  function restoreMap(png, json) {
    var fn = mapFn(['restoreFromPngAndJson']);
    if (fn) fn(png, json, undefined, true);
  }

  function restoreTiles(tiles, json) {
    var fn = mapFn(['restoreFromExtractedMap']);
    return fn ? !!fn(tiles, json, true) : false;
  }

  function setApplyingRemote(value) {
    var fn = mapFn(['setApplyingRemote']);
    if (fn) fn(value);
  }

  function enablePersist() {
    var fn = mapFn(['enablePersist']);
    if (fn) fn();
  }

  function persistNow() {
    var fn = mapFn(['persistNow']);
    if (fn) fn();
  }

  function hexFor(color) {
    return HIGHLIGHT_COLORS[color] || HIGHLIGHT_COLORS.green;
  }

  function xmlEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function roomFromLocation() {
    var search = window.location.search || '';
    var q = search.match(/[?&]room=([A-Za-z0-9]{12,16})(?:&|$)/);
    if (q) return q[1];
    var pathname = window.location.pathname || '';
    var m = pathname.match(/^\/collab\/([A-Za-z0-9]{12,16})\/?$/);
    return m ? m[1] : null;
  }

  function randomRoomId() {
    var id = '';
    var buf = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(buf);
    else for (var i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
    for (var i = 0; i < 16; i++) id += CHARS.charAt(buf[i] % 62);
    return id;
  }

  function shareUrl(id) {
    return window.location.origin + '/?room=' + encodeURIComponent(id);
  }

  function setRoomInUrl(id) {
    if (window.history && history.replaceState) {
      history.replaceState(null, '', '/?room=' + encodeURIComponent(id));
    }
    return shareUrl(id);
  }

  function setStatus(text) {
    $('#collabStatus').text(text || '');
  }

  function renderUsers() {
    var html = '';
    for (var i = 0; i < users.length; i++) {
      var user = users[i];
      html += '<span class="collab-user" style="color:' + hexFor(user.color) + '">' +
        xmlEscape(user.username || 'Some Ball') + '</span>';
    }
    $('#collabUsers').html(html);
  }

  function renderStatus() {
    var parts = [];
    if (copiedFlash) parts.push('Link copied...');
    if (joined && peers) {
      parts.push(peers === 1 ? '1 connected.' : (peers + ' connected.'));
    } else if (roomId && !joined) {
      parts.push('Connecting…');
    }
    setStatus(parts.join(' '));
    renderUsers();
  }

  function applyOwnColor(color, persist) {
    if (!HIGHLIGHT_COLORS[color]) color = 'green';
    myColor = color;
    $('.highlight-color').removeClass('highlight-color-active');
    $('.highlight-' + color).addClass('highlight-color-active');
    var hex = hexFor(color);
    if (window.TagproMap && typeof TagproMap.setOwnHighlightColor === 'function') {
      TagproMap.setOwnHighlightColor(color, hex);
    }
    if (persist !== false) {
      try { localStorage.setItem('color', color); } catch (err) {}
    }
  }

  function storedUsername() {
    try { return localStorage.getItem('username') || ''; } catch (err) { return ''; }
  }

  function storedColor() {
    try { return localStorage.getItem('color') || ''; } catch (err) { return ''; }
  }

  function copyText(text, cb) {
    function fallback() {
      var ok = false;
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      cb(ok);
    }
    if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() { cb(true); }).catch(fallback);
      return;
    }
    fallback();
  }

  function copyShareLink() {
    if (!roomId) return;
    var url = shareUrl(roomId);
    copyText(url, function(ok) {
      copiedFlash = ok;
      if (ok) {
        renderStatus();
        setTimeout(function() {
          copiedFlash = false;
          renderStatus();
        }, 2500);
      } else {
        setStatus('Share: ' + url);
      }
    });
  }

  function sendCurrentState() {
    if (!socket || socket.readyState !== 1 || !joined || !roomId) return;
    if (window.TagproMap && TagproMap.isApplyingRemote && TagproMap.isApplyingRemote()) return;
    var png = getPng();
    var json = getJson();
    if (!png || !json) return;
    var tiles = getTiles();
    lastKey = (tiles ? JSON.stringify(tiles) : png) + '\n' + json;
    var payload = { type: 'state', png: png, json: json };
    if (tiles) payload.tiles = tiles;
    socket.send(JSON.stringify(payload));
  }

  function pushLocalIfNeeded() {
    var png = null;
    var json = null;
    try {
      png = localStorage.getItem('png');
      json = localStorage.getItem('json');
    } catch (err) {}
    if (png && json) {
      restoreMap(png, json);
      return;
    }
    enablePersist();
    persistNow();
  }

  function applyRemote(png, json, tiles) {
    var key = (tiles ? JSON.stringify(tiles) : (png || '')) + '\n' + (json || '');
    if (key === lastKey) return;
    lastKey = key;
    setApplyingRemote(true);
    if (tiles && restoreTiles(tiles, json)) return;
    restoreMap(png, json);
  }

  function handleState(msg) {
    if (typeof msg.peers === 'number') peers = msg.peers;
    if (Array.isArray(msg.users)) users = msg.users;
    var hasTiles = Array.isArray(msg.tiles) && msg.tiles.length;
    var hasMap = hasTiles || (typeof msg.png === 'string' && msg.png && typeof msg.json === 'string' && msg.json);
    if (hasMap) {
      haveRoomMap = true;
      applyRemote(msg.png, msg.json, hasTiles ? msg.tiles : null);
    } else if (!haveRoomMap && !pushedLocal) {
      pushedLocal = true;
      pushLocalIfNeeded();
    }
    renderStatus();
  }

  function handleWelcome(msg) {
    if (msg.id != null) myId = msg.id;
    if (typeof msg.username === 'string') {
      $('#collabUsername').val(msg.username);
      try { localStorage.setItem('username', msg.username); } catch (err) {}
    }
    if (msg.color) applyOwnColor(msg.color, true);
    if (Array.isArray(msg.users)) users = msg.users;
    joined = true;
    handleState(msg);
  }

  function handleUsers(msg) {
    if (Array.isArray(msg.users)) users = msg.users;
    if (typeof msg.peers === 'number') peers = msg.peers;
    if (myId != null) {
      for (var i = 0; i < users.length; i++) {
        if (users[i].id === myId && users[i].color && users[i].color !== myColor) {
          applyOwnColor(users[i].color, true);
        }
      }
    }
    renderStatus();
  }

  function paintPeerCursor(id, color, tiles) {
    if (!window.TagproMap) return;
    if (!tiles || !tiles.length) {
      if (TagproMap.clearPeerHighlights) TagproMap.clearPeerHighlights(id);
      return;
    }
    if (TagproMap.showPeerHighlights) TagproMap.showPeerHighlights(id, tiles, hexFor(color));
  }

  function handleCursor(msg) {
    if (msg.id == null || msg.id === myId) return;
    var tiles = Array.isArray(msg.tiles) ? msg.tiles : [];
    if (!tiles.length && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
      tiles = [{ x: msg.x, y: msg.y }];
    }
    peerCursors[msg.id] = { color: msg.color, tiles: tiles };
    paintPeerCursor(msg.id, msg.color, tiles);
  }

  function handleCursorLeave(id) {
    if (id == null) return;
    delete peerCursors[id];
    if (window.TagproMap && TagproMap.clearPeerHighlights) TagproMap.clearPeerHighlights(id);
  }

  function reapplyPeerCursors() {
    if (!window.TagproMap || !TagproMap.showPeerHighlights) return;
    Object.keys(peerCursors).forEach(function(id) {
      var cur = peerCursors[id];
      paintPeerCursor(id, cur.color, cur.tiles);
    });
  }

  function flushCursor() {
    cursorTimer = null;
    if (pendingCursorTiles == null) return;
    sendCursorNow(pendingCursorTiles);
    pendingCursorTiles = null;
  }

  function sendCursorNow(tiles) {
    if (!socket || socket.readyState !== 1 || !joined) return;
    var key = JSON.stringify(tiles || []);
    if (key === lastCursorKey) return;
    lastCursorKey = key;
    socket.send(JSON.stringify({ type: 'cursor', tiles: tiles || [] }));
  }

  function queueCursor(tiles) {
    pendingCursorTiles = tiles || [];
    if (!tiles || !tiles.length) {
      if (cursorTimer) {
        clearTimeout(cursorTimer);
        cursorTimer = null;
      }
      flushCursor();
      return;
    }
    if (cursorTimer) return;
    cursorTimer = setTimeout(flushCursor, CURSOR_THROTTLE_MS);
  }

  function sendDetails() {
    if (!socket || socket.readyState !== 1 || !joined) return;
    var username = ($('#collabUsername').val() || '').trim();
    try { localStorage.setItem('username', username); } catch (err) {}
    try { localStorage.setItem('color', myColor); } catch (err) {}
    socket.send(JSON.stringify({ type: 'details', username: username, color: myColor }));
  }

  function joinPayload() {
    var payload = { type: 'join', room: roomId };
    var name = ($('#collabUsername').val() || storedUsername() || '').trim();
    if (name) payload.username = name;
    return payload;
  }

  function openSocket() {
    if (closing || !roomId) return;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(proto + '//' + location.host);
    socket.onopen = function() {
      joined = false;
      pushedLocal = false;
      haveRoomMap = false;
      lastCursorKey = null;
      socket.send(JSON.stringify(joinPayload()));
    };
    socket.onmessage = function(ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (err) { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'error') {
        setStatus(msg.error === 'invalid-room' ? 'Invalid collab room.' : 'Collab error.');
        return;
      }
      if (msg.type === 'welcome') {
        handleWelcome(msg);
        if (copyAfterJoin) {
          copyAfterJoin = false;
          copyShareLink();
        }
        return;
      }
      if (msg.type === 'users') {
        handleUsers(msg);
        return;
      }
      if (msg.type === 'cursor') {
        handleCursor(msg);
        return;
      }
      if (msg.type === 'cursor-leave') {
        handleCursorLeave(msg.id);
        return;
      }
      if (msg.type !== 'state') return;
      joined = true;
      handleState(msg);
      if (copyAfterJoin) {
        copyAfterJoin = false;
        copyShareLink();
      }
    };
    socket.onclose = function() {
      joined = false;
      socket = null;
      if (closing) return;
      renderStatus();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(openSocket, 1000);
    };
    socket.onerror = function() {
      try { if (socket) socket.close(); } catch (err) {}
    };
  }

  function startRoom(id, shouldCopy) {
    if (!ROOM_RE.test(id)) {
      setStatus('Invalid collab room.');
      return;
    }
    roomId = id;
    copyAfterJoin = !!shouldCopy;
    setRoomInUrl(id);
    if (shouldCopy) copyShareLink();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket && socket.readyState === 1) {
      pushedLocal = false;
      haveRoomMap = false;
      socket.send(JSON.stringify(joinPayload()));
      return;
    }
    openSocket();
  }

  window.TagproCollab = {
    onPersist: sendCurrentState,
    roomId: function() { return roomId; },
    onTilesRebuilt: reapplyPeerCursors
  };

  if (window.TagproMap) {
    if (typeof TagproMap.onSpeculativeHover === 'function') {
      TagproMap.onSpeculativeHover(queueCursor);
    }
    if (typeof TagproMap.onTilesRebuilt === 'function') {
      TagproMap.onTilesRebuilt(reapplyPeerCursors);
    }
  }

  $(window).on('pagehide beforeunload', function() {
    closing = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (cursorTimer) clearTimeout(cursorTimer);
    if (socket) {
      try { socket.close(); } catch (err) {}
    }
  });

  $('#collab').on('click', function(e) {
    e.preventDefault();
    if (roomId && ROOM_RE.test(roomId)) {
      setRoomInUrl(roomId);
      copyShareLink();
      if (!socket || socket.readyState > 1) openSocket();
      return;
    }
    startRoom(randomRoomId(), true);
  });

  $('.highlight-color').on('click', function() {
    var color = $(this).attr('data-color');
    if (!HIGHLIGHT_COLORS[color]) return;
    applyOwnColor(color, true);
    sendDetails();
  });

  $('#collabUsername').on('focusout', function() {
    sendDetails();
  }).on('keydown', function(e) {
    if (e.which === 13) {
      e.preventDefault();
      $(this).blur();
    }
  });

  var savedName = storedUsername();
  if (savedName) $('#collabUsername').val(savedName);
  applyOwnColor(HIGHLIGHT_COLORS[storedColor()] ? storedColor() : 'green', false);

  var fromUrl = roomFromLocation();
  if (fromUrl) startRoom(fromUrl, false);
});
