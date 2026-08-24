$(function() {
  var ROOM_RE = /^[A-Za-z0-9]{12,16}$/;
  var CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

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

  function mapFn(names) {
    var map = window.TagproMap || {};
    for (var i = 0; i < names.length; i++) {
      if (typeof map[names[i]] === 'function') return map[names[i]].bind(map);
    }
    return null;
  }

  function getPng() {
    var fn = mapFn(['getPngBase64Url', 'getPngBase64Url']);
    return fn ? fn() : null;
  }

  function getJson() {
    var fn = mapFn(['makeLogicString', 'makeLogicString']);
    return fn ? fn() : null;
  }

  function restoreMap(png, json) {
    var fn = mapFn(['restoreFromPngAndJson', 'restoreFromPngAndJson']);
    if (fn) fn(png, json, undefined, true);
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

  function renderStatus() {
    var parts = [];
    if (copiedFlash) parts.push('Link copied...');
    if (joined && peers) {
      parts.push(peers === 1 ? '1 connected.' : (peers + ' connected.'));
    } else if (roomId && !joined) {
      parts.push('Connecting…');
    }
    setStatus(parts.join(' '));
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
    lastKey = png + '\n' + json;
    socket.send(JSON.stringify({ type: 'state', png: png, json: json }));
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

  function applyRemote(png, json) {
    var key = png + '\n' + json;
    if (key === lastKey) return;
    lastKey = key;
    setApplyingRemote(true);
    restoreMap(png, json);
  }

  function handleState(msg) {
    if (typeof msg.peers === 'number') peers = msg.peers;
    var hasMap = typeof msg.png === 'string' && msg.png && typeof msg.json === 'string' && msg.json;
    if (hasMap) {
      haveRoomMap = true;
      applyRemote(msg.png, msg.json);
    } else if (!haveRoomMap && !pushedLocal) {
      pushedLocal = true;
      pushLocalIfNeeded();
    }
    renderStatus();
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
      socket.send(JSON.stringify({ type: 'join', room: roomId }));
    };
    socket.onmessage = function(ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (err) { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'error') {
        setStatus(msg.error === 'invalid-room' ? 'Invalid collab room.' : 'Collab error.');
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
      socket.send(JSON.stringify({ type: 'join', room: roomId }));
      return;
    }
    openSocket();
  }

  window.TagproCollab = {
    onPersist: sendCurrentState,
    roomId: function() { return roomId; }
  };

  $(window).on('pagehide beforeunload', function() {
    closing = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
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

  var fromUrl = roomFromLocation();
  if (fromUrl) startRoom(fromUrl, false);
});
