(function (global) {
  var DEADZONE = 0.3;
  var REPEAT_DELAY = 320;
  var REPEAT_RATE = 80;
  var HINT_MS = 8000;
  var PAN_SPEED = 18;

  var SWAP_KEY = 'tagpro-gamepad-swap-ax';

  var raf = 0;
  var hintTimer = 0;
  var paintHeld = false;
  var ignoreAUntilUp = false;
  var ignoreBUntilUp = false;
  var ignoreXUntilUp = false;
  var gpFocusEl = null;
  var prev = {};
  var repeats = {};
  var swapAX = false;

  function readSwapAX() {
    try {
      return global.localStorage && global.localStorage.getItem(SWAP_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function writeSwapAX(on) {
    try {
      if (global.localStorage) global.localStorage.setItem(SWAP_KEY, on ? '1' : '0');
    } catch (err) {}
  }

  function syncSwapLabels() {
    var paint = swapAX ? 'X' : 'A';
    var chat = swapAX ? 'A' : 'X';
    var els = document.querySelectorAll('[data-gp-ax]');
    for (var i = 0; i < els.length; i++) {
      var role = els[i].getAttribute('data-gp-ax');
      els[i].textContent = role === 'paint' ? paint : chat;
    }
    var help = document.getElementById('gpAxHelp');
    if (help) {
      help.textContent = swapAX
        ? 'X paints (hold X and move for a trail). A opens chat.'
        : 'A paints (hold A and move for a trail). X opens chat.';
    }
  }

  function syncSwapAXVisibility() {
    var group = document.getElementById('gpSwapAXGroup');
    if (!group) return;
    var override = global.TagproLayout && TagproLayout.getOverride && TagproLayout.getOverride();
    var show = isGamepadLayout() || override === 'gamepad';
    if (show) group.removeAttribute('hidden');
    else group.setAttribute('hidden', '');
  }

  function syncSwapAXButtons() {
    var onBtn = document.getElementById('gpSwapAXOn');
    var offBtn = document.getElementById('gpSwapAXOff');
    if (onBtn) {
      onBtn.classList.toggle('active', swapAX);
      onBtn.setAttribute('aria-pressed', swapAX ? 'true' : 'false');
    }
    if (offBtn) {
      offBtn.classList.toggle('active', !swapAX);
      offBtn.setAttribute('aria-pressed', swapAX ? 'false' : 'true');
    }
  }

  function applySwapAX(on, persist) {
    swapAX = !!on;
    document.documentElement.classList.toggle('gp-swap-ax', swapAX);
    syncSwapLabels();
    syncSwapAXButtons();
    if (persist !== false) writeSwapAX(swapAX);
  }

  function setSwapAX(on) {
    endPaint();
    ignoreAUntilUp = true;
    ignoreXUntilUp = true;
    applySwapAX(on, true);
  }

  applySwapAX(readSwapAX(), false);
  syncSwapAXVisibility();

  function isGamepadLayout() {
    return document.documentElement.classList.contains('layout-gamepad');
  }

  function firstPad() {
    if (!navigator.getGamepads) return null;
    var pads = navigator.getGamepads();
    for (var i = 0; i < pads.length; i++) {
      if (pads[i]) return pads[i];
    }
    return null;
  }

  function hasPad() {
    return !!firstPad();
  }

  function hintEl() {
    return document.getElementById('gpHint');
  }

  function hintVisible() {
    var el = hintEl();
    return !!(el && !el.hasAttribute('hidden'));
  }

  function hideHint() {
    var el = hintEl();
    if (el) el.setAttribute('hidden', '');
    if (hintTimer) {
      clearTimeout(hintTimer);
      hintTimer = 0;
    }
  }

  function showHint() {
    if (isGamepadLayout()) return;
    var el = hintEl();
    if (!el) return;
    el.removeAttribute('hidden');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, HINT_MS);
    ensureLoop();
  }

  function acceptHint() {
    ignoreAUntilUp = true;
    ignoreXUntilUp = true;
    hideHint();
    if (global.TagproLayout) TagproLayout.setOverride('gamepad');
  }

  function shouldPoll() {
    if (hintVisible()) return true;
    return hasPad() && isGamepadLayout();
  }

  function ensureLoop() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function buttonDown(pad, i) {
    var b = pad && pad.buttons && pad.buttons[i];
    if (!b) return false;
    if (b.pressed) return true;
    return typeof b.value === 'number' && b.value > 0.5;
  }

  function axisValue(pad, i) {
    var axes = pad && pad.axes;
    if (!axes || axes[i] == null || isNaN(axes[i])) return 0;
    return axes[i];
  }

  function analog(v) {
    if (Math.abs(v) <= DEADZONE) return 0;
    var mag = (Math.abs(v) - DEADZONE) / (1 - DEADZONE);
    return (v < 0 ? -1 : 1) * mag;
  }

  function chatIsOpen() {
    if (document.documentElement.classList.contains('collab-chat-open')) return true;
    return !!(global.TagproCollab && TagproCollab.isOpen && TagproCollab.isOpen());
  }

  function uiMode() {
    if (document.body && document.body.classList.contains('tile-settings-open')) return 'dialog';
    if (document.querySelector('.modal.in')) return 'modal';
    var sheet = document.getElementById('moreSheet');
    if (sheet && sheet.classList.contains('open')) return 'more';
    if (chatIsOpen()) return 'chat';
    return null;
  }

  function clickEl(el) {
    if (!el) return;
    if (typeof el.click === 'function') el.click();
  }

  function clickId(id) {
    clickEl(document.getElementById(id));
  }

  function endPaint() {
    if (!paintHeld) return;
    paintHeld = false;
    if (global.TagproLoupe && TagproLoupe.paintWorkTile) TagproLoupe.paintWorkTile('end');
  }

  function setGpFocus(el) {
    var olds = document.querySelectorAll('.gp-focus');
    for (var i = 0; i < olds.length; i++) olds[i].classList.remove('gp-focus');
    gpFocusEl = el || null;
    if (gpFocusEl) gpFocusEl.classList.add('gp-focus');
  }

  function isShown(el) {
    if (!el || el.disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (el.hidden || el.getAttribute('hidden') != null) return false;
    if (el.getAttribute('type') === 'hidden') return false;
    if (el.classList && el.classList.contains('disabled')) return false;
    var style = global.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function collectFocusables(root) {
    if (!root) return [];
    var nodes = root.querySelectorAll('a[href], button, input, select, textarea, .btn, .highlight-color, [data-toggle], [role="button"]');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isShown(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  function overlayFocusables() {
    var mode = uiMode();
    var list = [];
    var i;
    if (mode === 'dialog') {
      var dialog = document.querySelector('.tile-settings-dialog.in, .tile-settings-dialog.is-open');
      return collectFocusables(dialog);
    }
    if (mode === 'modal') {
      return collectFocusables(document.querySelector('.modal.in'));
    }
    if (mode === 'chat') {
      return collectFocusables(document.getElementById('collabChat'));
    }
    if (mode !== 'more') return list;
    var sheet = document.getElementById('moreSheet');
    if (!sheet) return list;
    var nav = sheet.querySelectorAll('.more-nav-btn');
    for (i = 0; i < nav.length; i++) {
      if (isShown(nav[i])) list.push(nav[i]);
    }
    var panelName = sheet.getAttribute('data-open') || '';
    var panel = panelName ? sheet.querySelector('.more-panel[data-panel="' + panelName + '"]') : null;
    if (panel) {
      var extras = collectFocusables(panel);
      for (i = 0; i < extras.length; i++) list.push(extras[i]);
    }
    var closeBtn = document.getElementById('moreClose');
    if (closeBtn && isShown(closeBtn)) list.push(closeBtn);
    return list;
  }

  function moveOverlayFocus(dx, dy) {
    var list = overlayFocusables();
    if (!list.length) return;
    var dir = (dy > 0 || dx > 0) ? 1 : -1;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === gpFocusEl || list[i].classList.contains('gp-focus')) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      setGpFocus(dir > 0 ? list[0] : list[list.length - 1]);
    } else {
      setGpFocus(list[(idx + dir + list.length) % list.length]);
    }
    if (gpFocusEl && gpFocusEl.scrollIntoView) {
      try { gpFocusEl.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) {
        gpFocusEl.scrollIntoView(false);
      }
    }
  }

  function activateFocus() {
    var el = gpFocusEl || document.querySelector('.gp-focus');
    if (!el) {
      var list = overlayFocusables();
      el = list[0];
      setGpFocus(el);
    }
    if (!el) return;
    var tag = (el.tagName || '').toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'textarea' || (tag === 'input' && type !== 'button' && type !== 'submit' && type !== 'checkbox' && type !== 'radio' && type !== 'color')) {
      if (typeof el.focus === 'function') el.focus();
      return;
    }
    if (el.classList && el.classList.contains('more-nav-btn')) {
      var panel = el.getAttribute('data-panel');
      if (global.TagproMore && TagproMore.setPanel) {
        TagproMore.setPanel(panel, { keep: true });
        return;
      }
    }
    clickEl(el);
  }

  function closeOverlay() {
    if (uiMode() === 'dialog') {
      var dismiss = document.querySelector('.tile-settings-dialog.in [data-dismiss="tile-settings"], .tile-settings-dialog.is-open [data-dismiss="tile-settings"]');
      clickEl(dismiss);
      return;
    }
    if (uiMode() === 'modal') {
      var modal = document.querySelector('.modal.in');
      if (modal && global.jQuery) $(modal).modal('hide');
      return;
    }
    if (uiMode() === 'more') {
      if (global.TagproMore && TagproMore.close) TagproMore.close();
      else clickId('moreClose');
    } else if (uiMode() === 'chat') {
      if (global.TagproCollab && TagproCollab.close) TagproCollab.close();
    }
    setGpFocus(null);
  }

  function toggleChat() {
    if (global.TagproCollab && TagproCollab.toggle) TagproCollab.toggle();
  }

  function focusChatControls() {
    var list = collectFocusables(document.getElementById('collabChat'));
    var input = document.getElementById('collabChatInput');
    setGpFocus((input && isShown(input)) ? input : (list[0] || null));
  }

  function ensureWorkTileVisible(center) {
    var loupe = global.TagproLoupe;
    var mapApi = global.TagproMap;
    var mapEl = document.getElementById('map');
    if (!loupe || !mapApi || !mapEl || !mapApi.tileElem) return;
    var c = loupe.center ? loupe.center() : null;
    if (!c) return;
    var $tile = mapApi.tileElem(c.x, c.y);
    if (!$tile || !$tile.length) return;
    var tr = $tile[0].getBoundingClientRect();
    var mr = mapEl.getBoundingClientRect();
    if (center) {
      mapEl.scrollLeft += (tr.left + tr.width / 2) - (mr.left + mr.width / 2);
      mapEl.scrollTop += (tr.top + tr.height / 2) - (mr.top + mr.height / 2);
      return;
    }
    var pad = 6;
    if (tr.left < mr.left + pad) mapEl.scrollLeft -= (mr.left + pad - tr.left);
    if (tr.right > mr.right - pad) mapEl.scrollLeft += (tr.right - (mr.right - pad));
    if (tr.top < mr.top + pad) mapEl.scrollTop -= (mr.top + pad - tr.top);
    if (tr.bottom > mr.bottom - pad) mapEl.scrollTop += (tr.bottom - (mr.bottom - pad));
  }

  function stepWork(dx, dy) {
    var loupe = global.TagproLoupe;
    if (!loupe || !loupe.setWorkTile) return;
    var c = loupe.center ? loupe.center() : { x: 0, y: 0 };
    loupe.setWorkTile(c.x + dx, c.y + dy);
    ensureWorkTileVisible(false);
    if (paintHeld && loupe.paintWorkTile) loupe.paintWorkTile('move');
  }

  function repeatStep(name, dx, dy, now, onStep) {
    var st = repeats[name];
    if (!st) st = repeats[name] = { dx: 0, dy: 0, start: 0, last: 0 };
    if (!dx && !dy) {
      repeats[name] = { dx: 0, dy: 0, start: 0, last: 0 };
      return;
    }
    if (dx !== st.dx || dy !== st.dy) {
      repeats[name] = { dx: dx, dy: dy, start: now, last: now };
      onStep(dx, dy);
      return;
    }
    if (now - st.start >= REPEAT_DELAY && now - st.last >= REPEAT_RATE) {
      st.last = now;
      onStep(dx, dy);
    }
  }

  function dpadDir(pad) {
    var up = buttonDown(pad, 12);
    var down = buttonDown(pad, 13);
    var left = buttonDown(pad, 14);
    var right = buttonDown(pad, 15);
    var dx = (right ? 1 : 0) - (left ? 1 : 0);
    var dy = (down ? 1 : 0) - (up ? 1 : 0);
    if (dx && dy) dx = 0;
    return { dx: dx, dy: dy };
  }

  function stickDir(pad) {
    var ax = axisValue(pad, 0);
    var ay = axisValue(pad, 1);
    var dx = Math.abs(ax) > DEADZONE ? (ax > 0 ? 1 : -1) : 0;
    var dy = Math.abs(ay) > DEADZONE ? (ay > 0 ? 1 : -1) : 0;
    return { dx: dx, dy: dy };
  }

  function moveDir(pad) {
    var d = dpadDir(pad);
    if (d.dx || d.dy) return d;
    return stickDir(pad);
  }

  function stepPalette(dir) {
    var copy = document.querySelector('#palette .palette-copy');
    if (!copy) return;
    var opts = copy.querySelectorAll('.tilePaletteOption');
    if (!opts.length) return;
    var idx = 0;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].classList.contains('palette-selected')) {
        idx = i;
        break;
      }
    }
    var next = (idx + dir + opts.length) % opts.length;
    clickEl(opts[next]);
    if (global.TagproPalette && TagproPalette.centerOnSelected) TagproPalette.centerOnSelected(true);
  }

  function nextTool() {
    var group = document.querySelector('#tools .btn-group-justified');
    if (!group) return;
    var all = group.querySelectorAll('.btn');
    var btns = [];
    for (var i = 0; i < all.length; i++) {
      if (!all[i].hasAttribute('data-tool-clone')) btns.push(all[i]);
    }
    if (!btns.length) return;
    var idx = 0;
    for (i = 0; i < btns.length; i++) {
      if (btns[i].classList.contains('active')) {
        idx = i;
        break;
      }
    }
    for (var n = 1; n <= btns.length; n++) {
      var el = btns[(idx + n) % btns.length];
      if (el.classList.contains('disabled')) continue;
      if (el.getAttribute('aria-disabled') === 'true') continue;
      clickEl(el);
      return;
    }
  }

  function zoomBy(dir) {
    if (global.TagproMap) {
      if (dir > 0 && TagproMap.zoomIn) {
        TagproMap.zoomIn();
        return;
      }
      if (dir < 0 && TagproMap.zoomOut) {
        TagproMap.zoomOut();
        return;
      }
    }
    clickId(dir > 0 ? 'zoomIn' : 'zoomOut');
  }

  function openWorkTileSettings() {
    var loupe = global.TagproLoupe;
    var mapApi = global.TagproMap;
    if (!loupe || !mapApi || !mapApi.tileHasSettings || !mapApi.openTileSettings) return;
    var c = loupe.center();
    if (mapApi.tileHasSettings(c.x, c.y)) mapApi.openTileSettings(c.x, c.y);
  }

  function toggleMore() {
    if (global.TagproMore && TagproMore.toggle) TagproMore.toggle();
    else clickId('moreToggle');
  }

  function panMap(pad) {
    var mapEl = document.getElementById('map');
    if (!mapEl) return;
    var rx = analog(axisValue(pad, 2));
    var ry = analog(axisValue(pad, 3));
    if (rx) mapEl.scrollLeft += rx * PAN_SPEED;
    if (ry) mapEl.scrollTop += ry * PAN_SPEED;
  }

  function rising(id, down) {
    var was = !!prev[id];
    prev[id] = down;
    return down && !was;
  }

  function handlePad(pad) {
    var now = Date.now();
    var a = buttonDown(pad, 0);
    var b = buttonDown(pad, 1);
    var x = buttonDown(pad, 2);
    var aEdge = rising('a', a);
    var bEdge = rising('b', b);
    var xEdge = rising('x', x);

    if (ignoreAUntilUp) {
      if (!a) ignoreAUntilUp = false;
      else {
        a = false;
        aEdge = false;
      }
    }
    if (ignoreBUntilUp) {
      if (!b) ignoreBUntilUp = false;
      else {
        b = false;
        bEdge = false;
      }
    }
    if (ignoreXUntilUp) {
      if (!x) ignoreXUntilUp = false;
      else {
        x = false;
        xEdge = false;
      }
    }

    if (hintVisible() && !isGamepadLayout()) {
      if (aEdge) acceptHint();
      else if (bEdge) {
        ignoreBUntilUp = true;
        hideHint();
      }
      return;
    }

    if (!isGamepadLayout()) return;

    var paintDown = swapAX ? x : a;
    var paintEdge = swapAX ? xEdge : aEdge;
    var chatEdge = swapAX ? aEdge : xEdge;
    var yEdge = rising('y', buttonDown(pad, 3));
    var lbEdge = rising('lb', buttonDown(pad, 4));
    var rbEdge = rising('rb', buttonDown(pad, 5));
    var ltEdge = rising('lt', buttonDown(pad, 6));
    var rtEdge = rising('rt', buttonDown(pad, 7));
    var selectEdge = rising('select', buttonDown(pad, 8));
    var startEdge = rising('start', buttonDown(pad, 9));
    var l3Edge = rising('l3', buttonDown(pad, 10));
    var dir = moveDir(pad);
    var mode = uiMode();

    if (mode) {
      endPaint();
      if (bEdge) closeOverlay();
      else if (startEdge) {
        if (mode === 'more') {
          toggleMore();
          setGpFocus(null);
        } else if (mode === 'chat') {
          closeOverlay();
        }
      } else if (mode === 'chat' && chatEdge && !(swapAX && aEdge)) {
        toggleChat();
        setGpFocus(null);
      } else if (aEdge) activateFocus();
      repeatStep('ui', dir.dx, dir.dy, now, function (dx, dy) {
        moveOverlayFocus(dx, dy);
      });
      return;
    }

    setGpFocus(null);
    repeatStep('map', dir.dx, dir.dy, now, function (dx, dy) {
      stepWork(dx, dy);
    });
    panMap(pad);

    if (paintEdge) {
      paintHeld = true;
      if (global.TagproLoupe && TagproLoupe.paintWorkTile) TagproLoupe.paintWorkTile('start');
    } else if (!paintDown) {
      endPaint();
    }

    if (bEdge) clickId('undo');
    if (chatEdge) {
      toggleChat();
      if (chatIsOpen()) focusChatControls();
      else setGpFocus(null);
    }
    if (yEdge) openWorkTileSettings();
    if (lbEdge) stepPalette(-1);
    if (rbEdge) stepPalette(1);
    if (ltEdge) zoomBy(-1);
    if (rtEdge) zoomBy(1);
    if (selectEdge) nextTool();
    if (startEdge) {
      toggleMore();
      var first = document.querySelector('#moreSheet.open .more-nav-btn');
      if (first) setGpFocus(first);
    }
    if (l3Edge) ensureWorkTileVisible(true);
  }

  function tick() {
    raf = 0;
    if (!shouldPoll()) return;
    raf = requestAnimationFrame(tick);
    var pad = firstPad();
    if (pad) handlePad(pad);
    else if (!hintVisible()) return;
  }

  function onConnected() {
    if (!isGamepadLayout()) showHint();
    ensureLoop();
  }

  function onLayout() {
    if (isGamepadLayout()) {
      hideHint();
      if (global.TagproLoupe && TagproLoupe.setWorkTile) {
        var c = TagproLoupe.center ? TagproLoupe.center() : { x: 0, y: 0 };
        TagproLoupe.setWorkTile(c.x, c.y);
        ensureWorkTileVisible(false);
      }
    } else {
      endPaint();
      setGpFocus(null);
    }
    syncSwapAXVisibility();
    if (shouldPoll()) ensureLoop();
  }

  global.addEventListener('gamepadconnected', onConnected);
  global.addEventListener('gamepaddisconnected', function () {
    endPaint();
    if (shouldPoll()) ensureLoop();
  });
  document.documentElement.addEventListener('tagpro-layout', onLayout);

  function bindBumpers() {
    function onBumper(dir) {
      return function (e) {
        if (!isGamepadLayout()) return;
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (uiMode()) return;
        stepPalette(dir);
      };
    }
    var left = document.getElementById('gpBumperL');
    var right = document.getElementById('gpBumperR');
    if (left) left.addEventListener('click', onBumper(-1));
    if (right) right.addEventListener('click', onBumper(1));
  }

  function bindSwapAXControl() {
    var onBtn = document.getElementById('gpSwapAXOn');
    var offBtn = document.getElementById('gpSwapAXOff');
    if (onBtn) {
      onBtn.addEventListener('click', function (e) {
        e.preventDefault();
        setSwapAX(true);
      });
    }
    if (offBtn) {
      offBtn.addEventListener('click', function (e) {
        e.preventDefault();
        setSwapAX(false);
      });
    }
  }

  $(function () {
    bindBumpers();
    bindSwapAXControl();
    applySwapAX(swapAX, false);
    syncSwapAXVisibility();
    if (hasPad() && !isGamepadLayout()) showHint();
    if (shouldPoll()) ensureLoop();
    if (isGamepadLayout() && global.TagproLoupe && TagproLoupe.setWorkTile) {
      var c = TagproLoupe.center ? TagproLoupe.center() : { x: 0, y: 0 };
      TagproLoupe.setWorkTile(c.x, c.y);
    }
  });

  global.TagproGamepad = {
    stepPalette: stepPalette,
    swapAX: function () { return swapAX; },
    setSwapAX: setSwapAX
  };
})(window);
