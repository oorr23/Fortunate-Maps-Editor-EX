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
  var MAX_CHAT = 300;
  var MAX_CHAT_LOG = 200;
  var EDGE_WIDTH = 22;
  var chatOpen = false;
  var chatUnread = false;
  var chatSwipe = null;

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

  function urlify(escaped) {
    return String(escaped).replace(/https?:\/\/[^\s<]+/gi, function(url) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
  }

  function chatFocused() {
    var el = document.activeElement;
    return !!(el && el.id === 'collabChatInput');
  }

  function chatPanelEl() {
    return document.getElementById('collabChat');
  }

  function chatVertical() {
    return document.documentElement.classList.contains('layout-gamepad');
  }

  function chatPanelWidth() {
    var el = chatPanelEl();
    return (el && el.offsetWidth) || Math.min(280, Math.floor(window.innerWidth * 0.7));
  }

  function chatPanelHeight() {
    var el = chatPanelEl();
    return (el && el.offsetHeight) || Math.min(380, Math.floor(window.innerHeight * 0.5));
  }

  function chatPanelSize() {
    return chatVertical() ? chatPanelHeight() : chatPanelWidth();
  }

  function setChatHiddenPx(px, dragging, vertical) {
    var el = chatPanelEl();
    if (!el) return;
    if (dragging) el.classList.add('is-dragging');
    else el.classList.remove('is-dragging');
    var useY = vertical == null ? chatVertical() : !!vertical;
    var axis = useY ? 'Y' : 'X';
    el.style.transform = 'translate' + axis + '(' + Math.max(0, px) + 'px)';
  }

  function clearChatInlineTransform() {
    var el = chatPanelEl();
    if (el) el.style.transform = '';
    if (el) el.classList.remove('is-dragging');
  }

  function setChatUnread(on) {
    chatUnread = !!on;
    var edge = document.getElementById('collabChatEdge');
    if (!edge) return;
    if (chatUnread && !chatOpen) $(edge).addClass('has-unread');
    else $(edge).removeClass('has-unread');
  }

  function trimChatLog() {
    var log = document.getElementById('collabChatLog');
    if (!log) return;
    while (log.childNodes.length > MAX_CHAT_LOG) {
      log.removeChild(log.firstChild);
    }
  }

  function scrollChatLog() {
    var log = document.getElementById('collabChatLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function appendSystem(text) {
    if (!text) return;
    var log = document.getElementById('collabChatLog');
    if (!log) return;
    var line = document.createElement('div');
    line.className = 'collab-chat-system';
    line.textContent = String(text);
    log.appendChild(line);
    trimChatLog();
    scrollChatLog();
  }

  function appendChat(msg) {
    var log = document.getElementById('collabChatLog');
    if (!log) return;
    var wrap = document.createElement('div');
    wrap.className = 'collab-chat-line';
    wrap.innerHTML = '<span style="color:' + hexFor(msg.color) + '"><b>' +
      xmlEscape(msg.username || 'Some Ball') + '</b></span>: <span>' +
      urlify(xmlEscape(msg.msg)) + '</span>';
    log.appendChild(wrap);
    trimChatLog();
    scrollChatLog();
    if (!chatOpen) setChatUnread(true);
  }

  function openChat() {
    chatOpen = true;
    setChatUnread(false);
    $('#collabChatBackdrop').removeAttr('hidden');
    $('#collabChat').addClass('is-open').attr('aria-hidden', 'false');
    document.documentElement.classList.add('collab-chat-open');
    clearChatInlineTransform();
  }

  function closeChat() {
    chatOpen = false;
    $('#collabChatBackdrop').attr('hidden', 'hidden');
    $('#collabChat').removeClass('is-open').attr('aria-hidden', 'true');
    document.documentElement.classList.remove('collab-chat-open');
    clearChatInlineTransform();
    var input = document.getElementById('collabChatInput');
    if (input) input.blur();
  }

  function toggleChat() {
    if (chatOpen) closeChat();
    else openChat();
  }

  function eventPoint(e) {
    if (e.touches && e.touches[0]) return e.touches[0];
    if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0];
    return e;
  }

  function swipeIgnoreTarget(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('input, textarea, button, a, select');
  }

  function beginChatSwipe(e, origin) {
    if (e.touches && e.touches.length > 1) return;
    if (origin === 'edge' && chatOpen) return;
    if (origin === 'panel' && !chatOpen) return;
    if (origin === 'panel' && swipeIgnoreTarget(e.target)) return;
    if ($('.modal.in:visible').length) return;
    var vertical = chatVertical();
    var pt = eventPoint(e);
    if (origin === 'edge' && !vertical && pt.clientX < window.innerWidth - EDGE_WIDTH - 2) return;
    if (origin === 'panel' && vertical) {
      var log = document.getElementById('collabChatLog');
      if (log && e.target && log.contains(e.target) && log.scrollTop > 0) return;
    }
    chatSwipe = {
      origin: origin,
      startX: pt.clientX,
      startY: pt.clientY,
      size: chatPanelSize(),
      vertical: vertical,
      moved: false
    };
  }

  function moveChatSwipe(e) {
    if (!chatSwipe) return;
    var pt = eventPoint(e);
    var dx = pt.clientX - chatSwipe.startX;
    var dy = pt.clientY - chatSwipe.startY;
    var primary = chatSwipe.vertical ? dy : dx;
    var secondary = chatSwipe.vertical ? dx : dy;
    if (!chatSwipe.moved) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(secondary) > Math.abs(primary)) {
        chatSwipe = null;
        clearChatInlineTransform();
        return;
      }
      if (chatSwipe.origin === 'edge' && primary > 6) {
        chatSwipe = null;
        return;
      }
      if (chatSwipe.origin === 'panel' && primary < -6) {
        chatSwipe = null;
        return;
      }
      chatSwipe.moved = true;
    }
    if (e.cancelable) e.preventDefault();
    var hidden = chatSwipe.origin === 'edge' ? chatSwipe.size + primary : primary;
    setChatHiddenPx(Math.max(0, Math.min(chatSwipe.size, hidden)), true, chatSwipe.vertical);
  }

  function endChatSwipe(e) {
    if (!chatSwipe) return;
    var pt = eventPoint(e);
    var primary = chatSwipe.vertical
      ? (pt.clientY - chatSwipe.startY)
      : (pt.clientX - chatSwipe.startX);
    var origin = chatSwipe.origin;
    var moved = chatSwipe.moved;
    var vertical = chatSwipe.vertical;
    var threshold = Math.min(48, chatSwipe.size * 0.28);
    chatSwipe = null;
    clearChatInlineTransform();
    if (!moved) {
      if (origin === 'edge' && vertical) toggleChat();
      return;
    }
    var shouldOpen = origin === 'edge' ? (-primary > threshold) : (primary < threshold);
    if (shouldOpen) openChat();
    else closeChat();
  }

  function layoutChatEdge() {
    var edge = document.getElementById('collabChatEdge');
    var map = document.getElementById('map');
    if (!edge || !map) return;
    var r = map.getBoundingClientRect();
    if (chatVertical()) {
      edge.style.left = Math.max(0, r.left) + 'px';
      edge.style.width = Math.max(0, r.width) + 'px';
      edge.style.right = 'auto';
      edge.style.top = 'auto';
      edge.style.height = EDGE_WIDTH + 'px';
      edge.style.bottom = Math.max(0, window.innerHeight - r.bottom) + 'px';
      edge.setAttribute('title', 'Swipe up for chat');
    } else {
      edge.style.top = Math.max(0, r.top) + 'px';
      edge.style.height = Math.max(0, r.height) + 'px';
      edge.style.bottom = 'auto';
      edge.style.right = '0px';
      edge.style.left = 'auto';
      edge.style.width = EDGE_WIDTH + 'px';
      edge.setAttribute('title', 'Swipe in from the right for chat');
    }
  }

  function bindChatSwipe() {
    var edge = document.getElementById('collabChatEdge');
    var panel = chatPanelEl();
    if (!edge || !panel) return;
    layoutChatEdge();
    $(window).on('resize orientationchange', layoutChatEdge);
    if (window.visualViewport) {
      visualViewport.addEventListener('resize', layoutChatEdge);
    }
    document.documentElement.addEventListener('tagpro-layout', function() {
      layoutChatEdge();
      clearChatInlineTransform();
    });

    var followKind = null;
    function onDocMove(e) { moveChatSwipe(e); }
    function detachFollow() {
      document.removeEventListener('mousemove', onDocMove, true);
      document.removeEventListener('mouseup', onFinish, true);
      document.removeEventListener('touchmove', onDocMove, true);
      document.removeEventListener('touchend', onFinish, true);
      document.removeEventListener('touchcancel', onFinish, true);
      document.removeEventListener('pointermove', onDocMove, true);
      document.removeEventListener('pointerup', onFinish, true);
      document.removeEventListener('pointercancel', onFinish, true);
      followKind = null;
    }
    function onFinish(e) {
      endChatSwipe(e);
      detachFollow();
    }
    function attachFollow(kind) {
      if (followKind) return;
      followKind = kind;
      if (kind === 'pointer') {
        document.addEventListener('pointermove', onDocMove, true);
        document.addEventListener('pointerup', onFinish, true);
        document.addEventListener('pointercancel', onFinish, true);
      } else if (kind === 'touch') {
        document.addEventListener('touchmove', onDocMove, { capture: true, passive: false });
        document.addEventListener('touchend', onFinish, true);
        document.addEventListener('touchcancel', onFinish, true);
      } else {
        document.addEventListener('mousemove', onDocMove, true);
        document.addEventListener('mouseup', onFinish, true);
      }
    }

    function onStart(origin) {
      return function(e) {
        if (e.type === 'mousedown' && e.button !== 0) return;
        if (e.type === 'pointerdown' && e.button !== 0 && e.pointerType === 'mouse') return;
        beginChatSwipe(e, origin);
        if (!chatSwipe) return;
        if (e.type.indexOf('pointer') === 0) attachFollow('pointer');
        else if (e.type.indexOf('touch') === 0) attachFollow('touch');
        else attachFollow('mouse');
      };
    }

    if ('onpointerdown' in window) {
      edge.addEventListener('pointerdown', onStart('edge'));
      panel.addEventListener('pointerdown', onStart('panel'));
    } else {
      edge.addEventListener('mousedown', onStart('edge'));
      edge.addEventListener('touchstart', onStart('edge'), { passive: true });
      panel.addEventListener('mousedown', onStart('panel'));
      panel.addEventListener('touchstart', onStart('panel'), { passive: true });
    }
  }

  function sendChatMessage() {
    var input = document.getElementById('collabChatInput');
    var raw = input ? input.value : '';
    var msg = String(raw == null ? '' : raw).replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!msg) return;
    if (msg.length > MAX_CHAT) msg = msg.slice(0, MAX_CHAT);
    if (input) input.value = '';
    if (!socket || socket.readyState !== 1 || !joined) {
      appendSystem('Not connected to a collab room.');
      return;
    }
    socket.send(JSON.stringify({ type: 'chat', msg: msg }));
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
        appendSystem('Collab link copied.');
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
    appendSystem('Connected to room.');
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
      if (msg.type === 'chat') {
        if (typeof msg.msg === 'string' && msg.msg) appendChat(msg);
        return;
      }
      if (msg.type === 'system') {
        if (msg.msg) appendSystem(msg.msg);
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
    onTilesRebuilt: reapplyPeerCursors,
    chatFocused: chatFocused,
    open: openChat,
    close: closeChat,
    toggle: toggleChat,
    isOpen: function() { return chatOpen; }
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

  $('#collabChatForm').on('submit', function(e) {
    e.preventDefault();
    sendChatMessage();
  });
  $('#collabChatInput').on('keydown', function(e) {
    if (e.which === 27) {
      e.preventDefault();
      closeChat();
    }
  });
  $('#collabChatClose').on('click', function() {
    closeChat();
  });
  $('#collabChatBackdrop').on('click', function() {
    closeChat();
  });
  $(document).on('keydown', function(e) {
    if (e.which !== 27 || !chatOpen) return;
    if ($('.modal.in:visible').length) return;
    e.preventDefault();
    closeChat();
  });
  bindChatSwipe();

  var savedName = storedUsername();
  if (savedName) $('#collabUsername').val(savedName);
  applyOwnColor(HIGHLIGHT_COLORS[storedColor()] ? storedColor() : 'green', false);

  var fromUrl = roomFromLocation();
  if (fromUrl) startRoom(fromUrl, false);
});
