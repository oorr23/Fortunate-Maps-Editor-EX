(function (global) {
  var DEADZONE = 0.3;
  var REPEAT_DELAY = 320;
  var REPEAT_DELAY_X = 600;
  var REPEAT_RATE = 80;
  var HINT_MS = 8000;
  var PAN_SPEED = 18;
  var PLAY_HOLD_MS = 400;

  var BINDS_KEY = 'tagpro-gamepad-binds';
  var SWAP_KEY = 'tagpro-gamepad-swap-ax';
  var TEST_KEY = 'tagpro-test-server';
  var LEGEND_KEY = 'tagpro-gamepad-legend';
  var BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3', 'R3', 'Up', 'Down', 'Left', 'Right'];
  var DEFAULT_BINDS = {
    paint: 0,
    undo: 1,
    chat: 2,
    tile: 3,
    palettePrev: 4,
    paletteNext: 5,
    zoomOut: 6,
    zoomIn: 7,
    tools: 8,
    more: 9,
    center: 10,
    play: 12,
    redo: 13,
    railLeft: 14,
    railRight: 15
  };
  var DEFAULT_STICKS = { move: 'left', pan: 'right' };
  var BIND_ROWS = [
    { id: 'paint', label: 'Paint' },
    { id: 'undo', label: 'Undo' },
    { id: 'chat', label: 'Chat' },
    { id: 'tile', label: 'Tile settings' },
    { id: 'palettePrev', label: 'Previous tile' },
    { id: 'paletteNext', label: 'Next tile' },
    { id: 'zoomOut', label: 'Zoom out' },
    { id: 'zoomIn', label: 'Zoom in' },
    { id: 'tools', label: 'Tools wheel' },
    { id: 'more', label: 'More (hold: Controller)' },
    { id: 'center', label: 'Center work tile' },
    { id: 'play', label: 'Play / test' },
    { id: 'redo', label: 'Redo' },
    { id: 'railLeft', label: 'Left menu' },
    { id: 'railRight', label: 'Right menu' },
    { id: 'moveStick', label: 'Move cursor', stick: true },
    { id: 'panStick', label: 'Pan map', stick: true }
  ];

  var raf = 0;
  var hintTimer = 0;
  var lastEventPad = null;
  var hintDismissed = false;
  var paintHeld = false;
  var ignoreAUntilUp = false;
  var ignoreBUntilUp = false;
  var ignoreXUntilUp = false;
  var gpFocusEl = null;
  var prev = {};
  var repeats = {};
  var binds = {};
  var sticks = { move: 'left', pan: 'right' };
  var bindListen = null;
  var ignoreUntilUp = {};
  var wheelPageIdx = 0;
  var wheelSlot = 0;
  var wheelConfirmId = null;
  var railSide = null;
  var testServer = 'na';
  var legendOn = true;
  var legendAway = false;
  var legendAtX = null;
  var legendAtY = null;
  var playHeldAt = 0;
  var playHoldFired = false;
  var moreHeldAt = 0;
  var moreHoldFired = false;
  var oskTarget = null;
  var oskPage = 'alpha';
  var oskShift = false;
  var oskRow = 0;
  var oskCol = 0;
  var WHEEL_CONFIRM = {
    rotateCw: true,
    rotateCcw: true,
    flipV: true,
    flipH: true,
    mirrorV: true
  };
  // Pages with fewer than 8 tools sit at equal angles (thirds, quarters, …).
  var WHEEL_PAGES = [
    { name: 'Draw', ids: ['toolPencil', 'toolBrush', 'toolLine', 'toolRectFill', 'toolRectOutline', 'toolCircleFill', 'toolCircleOutline', 'toolFill'] },
    { name: 'Edit', ids: ['toolCut', 'toolCopy', 'toolPaste', 'toolWire', 'toolAddCol', 'toolAddRow', 'rotateCw', 'rotateCcw'] },
    { name: 'Map', ids: ['flipV', 'flipH', 'toolMirror', 'mirrorV'] }
  ];

  function cloneDefaults() {
    var out = {};
    var k;
    for (k in DEFAULT_BINDS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_BINDS, k)) out[k] = DEFAULT_BINDS[k];
    }
    return out;
  }

  function validButton(i) {
    return typeof i === 'number' && i >= 0 && i < BUTTON_NAMES.length && i === Math.floor(i);
  }

  function buttonName(i) {
    return validButton(i) ? BUTTON_NAMES[i] : '?';
  }

  function stickName(which) {
    return which === 'right' ? 'Right stick' : 'Left stick';
  }

  function persistBinds() {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(BINDS_KEY, JSON.stringify({ binds: binds, sticks: sticks }));
      }
    } catch (err) {}
  }

  function loadBinds() {
    binds = cloneDefaults();
    sticks = { move: DEFAULT_STICKS.move, pan: DEFAULT_STICKS.pan };
    var usedStore = false;
    try {
      var raw = global.localStorage && global.localStorage.getItem(BINDS_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        var src = (data && data.binds) || data;
        var k;
        for (k in DEFAULT_BINDS) {
          if (src && validButton(src[k])) binds[k] = src[k];
        }
        if (data && data.sticks) {
          if (data.sticks.move === 'right' || data.sticks.move === 'left') sticks.move = data.sticks.move;
          sticks.pan = sticks.move === 'left' ? 'right' : 'left';
        }
        usedStore = true;
      }
    } catch (err) {}
    if (!usedStore) {
      try {
        if (global.localStorage && global.localStorage.getItem(SWAP_KEY) === '1') {
          binds.paint = 2;
          binds.chat = 0;
        }
      } catch (err2) {}
    }
    resolveBindConflicts();
  }

  function resolveBindConflicts() {
    var used = {};
    var k;
    var i;
    for (k in DEFAULT_BINDS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_BINDS, k)) continue;
      var b = binds[k];
      if (!validButton(b) || used[b] != null) {
        for (i = 0; i < BUTTON_NAMES.length; i++) {
          if (used[i] == null) {
            binds[k] = i;
            used[i] = k;
            break;
          }
        }
      } else used[b] = k;
    }
  }

  function actionForButton(i) {
    var k;
    for (k in binds) {
      if (binds[k] === i) return k;
    }
    return null;
  }

  function setBind(action, button) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_BINDS, action) || !validButton(button)) return;
    var k;
    for (k in binds) {
      if (k !== action && binds[k] === button) {
        binds[k] = binds[action];
        break;
      }
    }
    binds[action] = button;
    persistBinds();
    syncBindLabels();
    renderBindsList();
  }

  function setStick(role, which) {
    if (which !== 'left' && which !== 'right') return;
    if (role === 'move') {
      sticks.move = which;
      sticks.pan = which === 'left' ? 'right' : 'left';
    } else if (role === 'pan') {
      sticks.pan = which;
      sticks.move = which === 'left' ? 'right' : 'left';
    } else return;
    persistBinds();
    syncBindLabels();
    renderBindsList();
  }

  function restoreDefaultBinds() {
    binds = cloneDefaults();
    sticks = { move: DEFAULT_STICKS.move, pan: DEFAULT_STICKS.pan };
    bindListen = null;
    try {
      if (global.localStorage) {
        global.localStorage.removeItem(SWAP_KEY);
        global.localStorage.setItem(BINDS_KEY, JSON.stringify({ binds: binds, sticks: sticks }));
      }
    } catch (err) {}
    endPaint();
    syncBindLabels();
    renderBindsList();
  }

  function syncBindLabels() {
    var els = document.querySelectorAll('[data-gp-bind]');
    var i;
    for (i = 0; i < els.length; i++) {
      var action = els[i].getAttribute('data-gp-bind');
      if (action === 'moveStick') els[i].textContent = stickName(sticks.move);
      else if (action === 'panStick') els[i].textContent = stickName(sticks.pan);
      else els[i].textContent = buttonName(binds[action]);
    }
    var help = document.getElementById('gpBindsHelp');
    if (help) {
      help.textContent = buttonName(binds.paint) + ' paints (hold and move for a trail). '
        + buttonName(binds.chat) + ' opens chat. '
        + buttonName(binds.undo) + ' undo, '
        + buttonName(binds.redo) + ' redo, '
        + buttonName(binds.tile) + ' tile settings. '
        + buttonName(binds.play) + ' tests (hold to pick a server). '
        + buttonName(binds.railLeft) + '/' + buttonName(binds.railRight) + ' focus the side menus. '
        + buttonName(binds.palettePrev) + '/' + buttonName(binds.paletteNext) + ' change palette tiles (hold to repeat); '
        + buttonName(binds.zoomOut) + '/' + buttonName(binds.zoomIn) + ' zoom. '
        + buttonName(binds.tools) + ' opens the tools wheel. '
        + buttonName(binds.more) + ' opens More (hold for Controller). '
        + buttonName(binds.center) + ' scrolls the work tile into view. '
        + stickName(sticks.move) + ' steps the work tile; '
        + stickName(sticks.pan) + ' pans the map. '
        + 'The connect hint always uses the physical A button, even if Paint is remapped.';
    }
  }

  function bindsEl() {
    return document.getElementById('gpBindsSheet');
  }

  function bindsIsOpen() {
    var el = bindsEl();
    return !!(el && !el.hasAttribute('hidden'));
  }

  function renderBindsList() {
    var list = document.getElementById('gpBindsList');
    if (!list) return;
    var html = '';
    var r;
    var i;
    for (r = 0; r < BIND_ROWS.length; r++) {
      var row = BIND_ROWS[r];
      var listen = bindListen === row.id;
      html += '<div class="gp-bind-row' + (listen ? ' is-listen' : '') + '">';
      html += '<label for="gpBind-' + row.id + '">' + row.label + '</label>';
      if (listen) {
        html += '<button type="button" class="btn btn-default gp-bind-listen" data-bind-listen="' + row.id + '">Press…</button>';
      } else if (row.stick) {
        var cur = row.id === 'moveStick' ? sticks.move : sticks.pan;
        html += '<select id="gpBind-' + row.id + '" class="form-control" data-bind-stick="' + row.id + '">';
        html += '<option value="left"' + (cur === 'left' ? ' selected' : '') + '>Left stick</option>';
        html += '<option value="right"' + (cur === 'right' ? ' selected' : '') + '>Right stick</option>';
        html += '</select>';
      } else {
        html += '<select id="gpBind-' + row.id + '" class="form-control" data-bind-action="' + row.id + '">';
        for (i = 0; i < BUTTON_NAMES.length; i++) {
          html += '<option value="' + i + '"' + (binds[row.id] === i ? ' selected' : '') + '>' + BUTTON_NAMES[i] + '</option>';
        }
        html += '</select>';
      }
      html += '</div>';
    }
    list.innerHTML = html;
  }

  function startBindListen(action) {
    bindListen = action;
    renderBindsList();
  }

  function cancelBindListen() {
    if (!bindListen) return;
    bindListen = null;
    renderBindsList();
  }

  function openBinds() {
    var el = bindsEl();
    if (!el) return;
    bindListen = null;
    el.removeAttribute('hidden');
    el.setAttribute('aria-hidden', 'false');
    renderBindsList();
    var first = el.querySelector('select, button');
    if (first) setGpFocus(first);
  }

  function closeBinds() {
    var el = bindsEl();
    bindListen = null;
    if (!el) return;
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    setGpFocus(null);
  }

  function syncBindsVisibility() {
    var group = document.getElementById('gpBindsGroup');
    var testGroup = document.getElementById('gpTestServerGroup');
    var legendGroup = document.getElementById('gpLegendGroup');
    var override = global.TagproLayout && TagproLayout.getOverride && TagproLayout.getOverride();
    var show = isGamepadLayout() || override === 'gamepad' || override === 'steamdeck';
    if (group) {
      if (show) group.removeAttribute('hidden');
      else {
        group.setAttribute('hidden', '');
        closeBinds();
      }
    }
    if (testGroup) {
      if (show) testGroup.removeAttribute('hidden');
      else testGroup.setAttribute('hidden', '');
    }
    if (legendGroup) {
      if (show) legendGroup.removeAttribute('hidden');
      else legendGroup.setAttribute('hidden', '');
    }
    if (!show) {
      var sheet = document.getElementById('moreSheet');
      if (sheet && sheet.getAttribute('data-open') === 'controller' && global.TagproMore && TagproMore.setPanel) {
        TagproMore.setPanel('file', { keep: true });
      }
    }
    syncTestServerSelect();
    syncLegendButtons();
    updateLegend();
  }

  function preferredTestIsEu() {
    return testServer === 'eu';
  }

  function persistTestServer() {
    try {
      if (global.localStorage) global.localStorage.setItem(TEST_KEY, testServer === 'eu' ? 'eu' : 'na');
    } catch (err) {}
  }

  function loadTestServer() {
    testServer = 'na';
    try {
      var raw = global.localStorage && global.localStorage.getItem(TEST_KEY);
      if (raw === 'eu' || raw === 'testeu') testServer = 'eu';
    } catch (err) {}
  }

  function setTestServer(value) {
    testServer = value === 'eu' || value === 'testeu' ? 'eu' : 'na';
    persistTestServer();
    syncTestServerSelect();
  }

  function syncTestServerSelect() {
    var sel = document.getElementById('gpTestServer');
    if (sel) sel.value = testServer === 'eu' ? 'eu' : 'na';
  }

  function launchPreferredTest() {
    var eu = preferredTestIsEu();
    if (global.TagproMap && TagproMap.launchTest) TagproMap.launchTest(eu);
    else clickId(eu ? 'testeu' : 'test');
  }

  function loadLegendPref() {
    legendOn = true;
    try {
      var raw = global.localStorage && global.localStorage.getItem(LEGEND_KEY);
      if (raw === '0' || raw === 'off' || raw === 'false') legendOn = false;
    } catch (err) {}
  }

  function persistLegendPref() {
    try {
      if (global.localStorage) global.localStorage.setItem(LEGEND_KEY, legendOn ? '1' : '0');
    } catch (err) {}
  }

  function setLegendOn(on) {
    legendOn = !!on;
    persistLegendPref();
    syncLegendButtons();
    updateLegend({ force: true });
  }

  function syncLegendButtons() {
    var onBtn = document.getElementById('gpLegendOn');
    var offBtn = document.getElementById('gpLegendOff');
    if (onBtn) onBtn.classList.toggle('active', legendOn);
    if (offBtn) offBtn.classList.toggle('active', !legendOn);
  }

  function legendEl() {
    return document.getElementById('gpLegend');
  }

  function workTileNearLegend() {
    var legend = legendEl();
    var tile = document.querySelector('#map .tileBackground.gp-work-tile, #map .gp-work-tile');
    if (!legend || !tile) return null;
    var lr = legend.getBoundingClientRect();
    var tr = tile.getBoundingClientRect();
    var th = tr.height;
    if (!th) {
      var size = global.TagproMap && TagproMap.getSize && TagproMap.getSize();
      th = size && size.tileSize ? size.tileSize * (size.viewScale || 1) : 0;
    }
    if (!th) return null;
    var pad = 4 * th;
    return tr.bottom > lr.top - pad && tr.top < lr.bottom + pad;
  }

  function updateLegend(opts) {
    var el = legendEl();
    var handle = document.querySelector('.collab-chat-handle');
    var off = !isGamepadLayout() || !legendOn;
    var away = false;
    if (!off) {
      var c = global.TagproLoupe && TagproLoupe.center && TagproLoupe.center();
      var moved = c && (c.x !== legendAtX || c.y !== legendAtY);
      if ((opts && opts.force) || moved || legendAtX == null) {
        if (c) {
          legendAtX = c.x;
          legendAtY = c.y;
        }
        var near = workTileNearLegend();
        if (near != null) legendAway = !!near;
      }
      away = legendAway;
    } else {
      legendAtX = null;
      legendAtY = null;
      legendAway = false;
    }
    if (el) {
      el.classList.toggle('is-off', off);
      el.classList.toggle('is-away', away);
    }
    if (handle) {
      handle.classList.toggle('is-off', off);
      handle.classList.toggle('is-away', away);
    }
  }

  loadBinds();
  loadTestServer();
  loadLegendPref();
  syncBindLabels();
  syncBindsVisibility();

  function isGamepadLayout() {
    return document.documentElement.classList.contains('layout-gamepad');
  }

  function firstPad() {
    if (navigator.getGamepads) {
      var pads = navigator.getGamepads();
      for (var i = 0; i < pads.length; i++) {
        if (pads[i]) return pads[i];
      }
    }
    return lastEventPad;
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

  function dismissHint() {
    hintDismissed = true;
    hideHint();
  }

  function isAutoLayout() {
    return !(global.TagproLayout && TagproLayout.getOverride && TagproLayout.getOverride());
  }

  function showHint() {
    if (isGamepadLayout() || hintDismissed) return;
    var el = hintEl();
    if (!el) return;
    if (hintVisible()) return;
    el.removeAttribute('hidden');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(dismissHint, HINT_MS);
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
    if (hasPad() && isGamepadLayout()) return true;
    return isAutoLayout();
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

  function wheelEl() {
    return document.getElementById('gpToolWheel');
  }

  function wheelIsOpen() {
    var el = wheelEl();
    return !!(el && !el.hasAttribute('hidden'));
  }

  function uiMode() {
    if (bindsIsOpen()) return 'binds';
    if (oskIsOpen()) return 'osk';
    if (testMenuIsOpen()) return 'testMenu';
    if (wheelIsOpen()) return 'wheel';
    if (document.body && document.body.classList.contains('tile-settings-open')) return 'dialog';
    if (document.querySelector('.modal.in')) return 'modal';
    var sheet = document.getElementById('moreSheet');
    if (sheet && sheet.classList.contains('open')) return 'more';
    if (chatIsOpen()) return 'chat';
    if (railSide) return 'rail';
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
    if (mode === 'binds') {
      return collectFocusables(document.getElementById('gpBindsSheet'));
    }
    if (mode === 'testMenu') {
      return collectFocusables(document.getElementById('gpTestMenu'));
    }
    if (mode === 'rail') {
      return collectFocusables(document.getElementById(railSide === 'right' ? 'gpRailRight' : 'gpRailLeft'));
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
      openOsk(el);
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
    if (uiMode() === 'binds') {
      if (bindListen) cancelBindListen();
      else closeBinds();
      return;
    }
    if (uiMode() === 'osk') {
      closeOsk();
      return;
    }
    if (uiMode() === 'testMenu') {
      closeTestMenu();
      return;
    }
    if (uiMode() === 'wheel') {
      closeWheel();
      return;
    }
    if (uiMode() === 'rail') {
      closeRail();
      return;
    }
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

  function repeatDelayFor(name, dx, dy) {
    if ((name === 'ui' || name === 'osk' || name === 'rail') && dx && !dy) return REPEAT_DELAY_X;
    return REPEAT_DELAY;
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
    if (now - st.start >= repeatDelayFor(name, dx, dy) && now - st.last >= REPEAT_RATE) {
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

  function stickAxes(which) {
    if (which === 'right') return { x: 2, y: 3 };
    return { x: 0, y: 1 };
  }

  function stickDir(pad) {
    var axn = stickAxes(sticks.move);
    var ax = axisValue(pad, axn.x);
    var ay = axisValue(pad, axn.y);
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

  function toolButton(id) {
    if (!id) return null;
    var all = document.querySelectorAll('#tools [data-tool-id="' + id + '"]');
    var i;
    for (i = 0; i < all.length; i++) {
      if (!all[i].hasAttribute('data-tool-clone')) return all[i];
    }
    return all[0] || null;
  }

  function toolIsDisabled(el) {
    if (!el) return true;
    if (el.classList.contains('disabled')) return true;
    return el.getAttribute('aria-disabled') === 'true';
  }

  function toolLabel(el) {
    if (!el) return '';
    var t = el.getAttribute('title') || '';
    var cut = t.split(' - ')[0].split(' — ')[0];
    return cut || el.getAttribute('data-tool-id') || 'Tool';
  }

  function copyToolIcon(src, dest) {
    if (!dest) return;
    dest.innerHTML = src ? src.innerHTML : '';
    var svg = dest.querySelector('svg');
    if (svg) {
      svg.setAttribute('width', '1em');
      svg.setAttribute('height', '1em');
      svg.style.width = '1em';
      svg.style.height = '1em';
    }
  }

  function activeToolId() {
    var el = document.querySelector('#tools .btn.active');
    return (el && el.getAttribute('data-tool-id')) || 'toolPencil';
  }

  function pageToolCount(page) {
    var ids = WHEEL_PAGES[page] && WHEEL_PAGES[page].ids;
    return ids ? ids.length : 0;
  }

  function toolAngleFromTop(count, index) {
    if (!count) return 0;
    return (index * 360 / count) % 360;
  }

  function angleToToolIndex(page, degFromTop) {
    var n = pageToolCount(page);
    if (n <= 0) return 0;
    var step = 360 / n;
    while (degFromTop < 0) degFromTop += 360;
    degFromTop = degFromTop % 360;
    var idx = Math.round(degFromTop / step) % n;
    return idx;
  }

  function clampWheelSlot(page, slot) {
    var n = pageToolCount(page);
    if (n <= 0) return 0;
    if (slot == null || isNaN(slot)) return 0;
    return ((slot % n) + n) % n;
  }

  function findToolLocation(id) {
    var p;
    var s;
    for (p = 0; p < WHEEL_PAGES.length; p++) {
      var ids = WHEEL_PAGES[p].ids;
      for (s = 0; s < ids.length; s++) {
        if (ids[s] === id) return { page: p, slot: s };
      }
    }
    return { page: 0, slot: 0 };
  }

  function wheelToolAt(page, slot) {
    var ids = WHEEL_PAGES[page] && WHEEL_PAGES[page].ids;
    if (!ids) return null;
    return ids[slot] || null;
  }

  function renderWheel() {
    var cats = document.getElementById('gpToolCats');
    var wedges = document.getElementById('gpToolWedges');
    var hubIcon = document.getElementById('gpToolHubIcon');
    var hubName = document.getElementById('gpToolHubName');
    if (!cats || !wedges) return;
    var page = WHEEL_PAGES[wheelPageIdx] || WHEEL_PAGES[0];
    var n = page.ids.length;
    var html = '';
    var i;
    for (i = 0; i < WHEEL_PAGES.length; i++) {
      html += '<button type="button" class="gp-tool-cat' + (i === wheelPageIdx ? ' active' : '') + '" data-wheel-page="' + i + '">' + WHEEL_PAGES[i].name + '</button>';
    }
    cats.innerHTML = html;
    html = '';
    wheelSlot = clampWheelSlot(wheelPageIdx, wheelSlot);
    for (i = 0; i < n; i++) {
      var id = page.ids[i];
      var el = toolButton(id);
      var angle = (toolAngleFromTop(n, i) - 90) * Math.PI / 180;
      var x = Math.cos(angle) * 84;
      var y = Math.sin(angle) * 84;
      var cls = 'gp-tool-wedge' + (i === wheelSlot ? ' is-on' : '');
      if (el && toolIsDisabled(el)) cls += ' is-disabled';
      html += '<button type="button" class="' + cls + '" data-wheel-slot="' + i + '" style="transform:translate(' + x + 'px,' + y + 'px)"' + (id ? ' title="' + toolLabel(el) + '"' : '') + '></button>';
    }
    wedges.innerHTML = html;
    for (i = 0; i < n; i++) {
      var btn = wedges.children[i];
      var src = toolButton(page.ids[i]);
      if (btn && src) copyToolIcon(src, btn);
    }
    var cur = toolButton(wheelToolAt(wheelPageIdx, wheelSlot));
    copyToolIcon(cur, hubIcon);
    if (hubName) hubName.textContent = cur ? toolLabel(cur) : '';
    if (hubIcon && cur && toolIsDisabled(cur)) hubIcon.style.opacity = '0.35';
    else if (hubIcon) hubIcon.style.opacity = '';
    var note = document.getElementById('gpToolHubNote');
    if (note) {
      var id = wheelToolAt(wheelPageIdx, wheelSlot);
      var text = '';
      if (cur && toolIsDisabled(cur) && id === 'toolPaste') text = 'Cut or copy first';
      else if (id && WHEEL_CONFIRM[id] && wheelConfirmId === id) text = 'Press A to confirm';
      note.textContent = text;
    }
  }

  function setWheelSlot(slot) {
    if (slot == null || isNaN(slot)) return;
    slot = clampWheelSlot(wheelPageIdx, slot);
    if (slot === wheelSlot) return;
    wheelSlot = slot;
    wheelConfirmId = null;
    renderWheel();
  }

  function setWheelPage(page) {
    var fromAngle = toolAngleFromTop(pageToolCount(wheelPageIdx), wheelSlot);
    page = ((page % WHEEL_PAGES.length) + WHEEL_PAGES.length) % WHEEL_PAGES.length;
    wheelPageIdx = page;
    wheelSlot = angleToToolIndex(page, fromAngle);
    wheelConfirmId = null;
    renderWheel();
  }

  function wheelPage(dir) {
    setWheelPage(wheelPageIdx + dir);
  }

  function openWheel() {
    var el = wheelEl();
    if (!el) return;
    endPaint();
    closeRail();
    var loc = findToolLocation(activeToolId());
    wheelPageIdx = loc.page;
    wheelSlot = loc.slot;
    wheelConfirmId = null;
    el.removeAttribute('hidden');
    el.setAttribute('aria-hidden', 'false');
    renderWheel();
  }

  function closeWheel() {
    var el = wheelEl();
    wheelConfirmId = null;
    if (!el) return;
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
  }

  function confirmWheel() {
    var id = wheelToolAt(wheelPageIdx, wheelSlot);
    var el = toolButton(id);
    if (!el || toolIsDisabled(el)) return;
    if (WHEEL_CONFIRM[id] && wheelConfirmId !== id) {
      wheelConfirmId = id;
      renderWheel();
      return;
    }
    wheelConfirmId = null;
    clickEl(el);
    closeWheel();
  }

  function wheelAimIndex(ax, ay) {
    if (!ax && !ay) return null;
    var deg = Math.atan2(ay, ax) * 180 / Math.PI + 90;
    return angleToToolIndex(wheelPageIdx, deg);
  }

  function wheelStickIndex(pad) {
    var axn = stickAxes(sticks.move);
    var ax = axisValue(pad, axn.x);
    var ay = axisValue(pad, axn.y);
    if (Math.sqrt(ax * ax + ay * ay) < 0.45) return null;
    return wheelAimIndex(ax, ay);
  }

  function wheelDpadIndex(pad) {
    var dx = (buttonDown(pad, 15) ? 1 : 0) - (buttonDown(pad, 14) ? 1 : 0);
    var dy = (buttonDown(pad, 13) ? 1 : 0) - (buttonDown(pad, 12) ? 1 : 0);
    if (!dx && !dy) return null;
    return wheelAimIndex(dx, dy);
  }

  function handleWheelPad(pad, edges) {
    if (edges.undo || edges.tools) {
      closeWheel();
      return;
    }
    if (edges.paint) confirmWheel();
    if (edges.palettePrev) wheelPage(-1);
    if (edges.paletteNext) wheelPage(1);
    var stick = wheelStickIndex(pad);
    if (stick != null) {
      setWheelSlot(stick);
      return;
    }
    var dpad = wheelDpadIndex(pad);
    if (dpad != null) setWheelSlot(dpad);
  }

  function bindWheel() {
    var el = wheelEl();
    if (!el) return;
    el.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) {
        if (t === el) closeWheel();
        return;
      }
      if (t.closest('#gpToolL')) {
        e.preventDefault();
        wheelPage(-1);
        return;
      }
      if (t.closest('#gpToolR')) {
        e.preventDefault();
        wheelPage(1);
        return;
      }
      var cat = t.closest('[data-wheel-page]');
      if (cat) {
        e.preventDefault();
        setWheelPage(Number(cat.getAttribute('data-wheel-page')));
        return;
      }
      var wedge = t.closest('[data-wheel-slot]');
      if (wedge) {
        e.preventDefault();
        setWheelSlot(Number(wedge.getAttribute('data-wheel-slot')));
        confirmWheel();
        return;
      }
      if (t.closest('.gp-tool-hub')) {
        e.preventDefault();
        confirmWheel();
        return;
      }
      if (t === el) closeWheel();
    });
  }

  function enterRail(side) {
    railSide = side === 'right' ? 'right' : 'left';
    var list = overlayFocusables();
    if (!list.length) {
      railSide = null;
      setGpFocus(null);
      return;
    }
    var keep = gpFocusEl && list.indexOf(gpFocusEl) >= 0;
    setGpFocus(keep ? gpFocusEl : list[0]);
  }

  function closeRail() {
    if (!railSide) return;
    railSide = null;
    setGpFocus(null);
  }

  function testMenuEl() {
    return document.getElementById('gpTestMenu');
  }

  function testMenuIsOpen() {
    var el = testMenuEl();
    return !!(el && !el.hasAttribute('hidden'));
  }

  function openTestMenu() {
    var el = testMenuEl();
    if (!el) return;
    endPaint();
    closeRail();
    el.removeAttribute('hidden');
    el.setAttribute('aria-hidden', 'false');
    setGpFocus(document.getElementById(preferredTestIsEu() ? 'gpTestEu' : 'gpTestNa'));
  }

  function closeTestMenu() {
    var el = testMenuEl();
    if (!el) return;
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    setGpFocus(null);
  }

  function launchPickedTest(eu) {
    closeTestMenu();
    if (global.TagproMap && TagproMap.launchTest) TagproMap.launchTest(!!eu);
    else clickId(eu ? 'testeu' : 'test');
  }

  function handlePlayButton(pad, now, mode) {
    var down = bindDown(pad, 'play');
    if (mode && mode !== 'testMenu') {
      if (!down) {
        playHeldAt = 0;
        playHoldFired = false;
      }
      return;
    }
    if (mode === 'testMenu') {
      if (!down) {
        playHeldAt = 0;
        playHoldFired = false;
      }
      return;
    }
    if (down) {
      if (!playHeldAt) playHeldAt = now;
      if (!playHoldFired && now - playHeldAt >= PLAY_HOLD_MS) {
        playHoldFired = true;
        openTestMenu();
      }
      return;
    }
    if (playHeldAt && !playHoldFired) launchPreferredTest();
    playHeldAt = 0;
    playHoldFired = false;
  }

  function openControllerMore() {
    endPaint();
    closeRail();
    closeWheel();
    if (global.TagproMore) {
      if (TagproMore.open) TagproMore.open();
      if (TagproMore.setPanel) TagproMore.setPanel('controller', { keep: true });
    }
    var btn = document.querySelector('#moreSheet.open .more-nav-btn[data-panel="controller"]');
    if (btn) setGpFocus(btn);
    else {
      var first = document.querySelector('#moreSheet.open .more-nav-btn');
      if (first) setGpFocus(first);
    }
  }

  function handleMoreButton(pad, now, mode) {
    var down = bindDown(pad, 'more');
    if (mode && mode !== 'more') {
      if (!down) {
        moreHeldAt = 0;
        moreHoldFired = false;
      }
      return;
    }
    if (down) {
      if (!moreHeldAt) moreHeldAt = now;
      if (!moreHoldFired && now - moreHeldAt >= PLAY_HOLD_MS) {
        moreHoldFired = true;
        openControllerMore();
      }
      return;
    }
    if (moreHeldAt && !moreHoldFired) {
      if (mode === 'more') {
        toggleMore();
        setGpFocus(null);
      } else {
        toggleMore();
        var first = document.querySelector('#moreSheet.open .more-nav-btn');
        if (first) setGpFocus(first);
      }
    }
    moreHeldAt = 0;
    moreHoldFired = false;
  }

  function oskEl() {
    return document.getElementById('gpOsk');
  }

  function oskIsOpen() {
    var el = oskEl();
    return !!(el && !el.hasAttribute('hidden'));
  }

  function oskKeyId(key) {
    if (!key) return '';
    if (typeof key === 'string') return key;
    return key.id || '';
  }

  function oskLayout() {
    if (oskPage === 'num') {
      return [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
        ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
        ['.', ',', '?', '!', '\'', '#', '%', '*', '+', '='],
        [{ id: 'abc', label: 'ABC' }, { id: 'space', label: 'space', wide: true }, { id: 'bksp', label: '⌫' }]
      ];
    }
    function letter(ch) {
      return oskShift ? ch.toUpperCase() : ch;
    }
    return [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      [letter('q'), letter('w'), letter('e'), letter('r'), letter('t'), letter('y'), letter('u'), letter('i'), letter('o'), letter('p')],
      [letter('a'), letter('s'), letter('d'), letter('f'), letter('g'), letter('h'), letter('j'), letter('k'), letter('l')],
      [{ id: 'shift', label: oskShift ? '⇧' : 'shift' }, letter('z'), letter('x'), letter('c'), letter('v'), letter('b'), letter('n'), letter('m'), { id: 'bksp', label: '⌫' }],
      [{ id: '123', label: '123' }, { id: 'space', label: 'space', wide: true }, { id: 'enter', label: 'Enter' }, { id: 'close', label: 'Done' }]
    ];
  }

  function clampOskCursor() {
    var rows = oskLayout();
    if (!rows.length) {
      oskRow = 0;
      oskCol = 0;
      return;
    }
    if (oskRow < 0) oskRow = rows.length - 1;
    if (oskRow >= rows.length) oskRow = 0;
    var row = rows[oskRow];
    if (!row.length) {
      oskCol = 0;
      return;
    }
    if (oskCol < 0) oskCol = row.length - 1;
    if (oskCol >= row.length) oskCol = row.length - 1;
  }

  function oskPreviewText() {
    if (!oskTarget) return '';
    return String(oskTarget.value == null ? '' : oskTarget.value);
  }

  function oskEscape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function renderOsk() {
    var keysEl = document.getElementById('gpOskKeys');
    var preview = document.getElementById('gpOskPreview');
    if (!keysEl) return;
    clampOskCursor();
    if (preview) preview.textContent = oskPreviewText() || ' ';
    var rows = oskLayout();
    var html = '';
    var r;
    var c;
    for (r = 0; r < rows.length; r++) {
      html += '<div class="gp-osk-row">';
      for (c = 0; c < rows[r].length; c++) {
        var key = rows[r][c];
        var id = oskKeyId(key);
        var label = typeof key === 'string' ? key : (key.label || id);
        var wide = key && key.wide ? ' is-wide' : '';
        var on = (r === oskRow && c === oskCol) ? ' is-on' : '';
        html += '<button type="button" class="gp-osk-key' + wide + on + '" data-osk-row="' + r + '" data-osk-col="' + c + '" data-osk-id="' + oskEscape(id) + '">' + oskEscape(label) + '</button>';
      }
      html += '</div>';
    }
    keysEl.innerHTML = html;
  }

  function openOsk(el) {
    if (!el || !isGamepadLayout()) return;
    var root = oskEl();
    if (!root) return;
    oskTarget = el;
    oskShift = false;
    oskPage = ((el.getAttribute('type') || '').toLowerCase() === 'number') ? 'num' : 'alpha';
    oskRow = 0;
    oskCol = 0;
    root.removeAttribute('hidden');
    root.setAttribute('aria-hidden', 'false');
    renderOsk();
  }

  function closeOsk() {
    var root = oskEl();
    oskTarget = null;
    oskShift = false;
    oskPage = 'alpha';
    if (!root) return;
    root.setAttribute('hidden', '');
    root.setAttribute('aria-hidden', 'true');
  }

  function dispatchInput(el) {
    if (!el) return;
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) {}
  }

  function oskInsert(ch) {
    var el = oskTarget;
    if (!el || ch == null) return;
    var value = String(el.value == null ? '' : el.value);
    var start = el.selectionStart != null ? el.selectionStart : value.length;
    var end = el.selectionEnd != null ? el.selectionEnd : start;
    var max = el.maxLength > 0 ? el.maxLength : 10000;
    var next = value.slice(0, start) + ch + value.slice(end);
    if (next.length > max) return;
    el.value = next;
    try {
      el.selectionStart = el.selectionEnd = start + ch.length;
    } catch (err) {}
    dispatchInput(el);
    renderOsk();
  }

  function oskBackspace() {
    var el = oskTarget;
    if (!el) {
      closeOsk();
      return;
    }
    var value = String(el.value == null ? '' : el.value);
    if (!value) {
      closeOsk();
      return;
    }
    var start = el.selectionStart != null ? el.selectionStart : value.length;
    var end = el.selectionEnd != null ? el.selectionEnd : start;
    if (start === end) {
      if (!start) return;
      el.value = value.slice(0, start - 1) + value.slice(end);
      try { el.selectionStart = el.selectionEnd = start - 1; } catch (err) {}
    } else {
      el.value = value.slice(0, start) + value.slice(end);
      try { el.selectionStart = el.selectionEnd = start; } catch (err2) {}
    }
    dispatchInput(el);
    renderOsk();
  }

  function oskSubmit() {
    var el = oskTarget;
    if (!el) {
      closeOsk();
      return;
    }
    var form = el.form;
    if (form) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else if (global.jQuery) $(form).trigger('submit');
    }
    renderOsk();
  }

  function oskPressId(id) {
    if (!id) return;
    if (id === 'shift') {
      oskShift = !oskShift;
      renderOsk();
      return;
    }
    if (id === '123') {
      oskPage = 'num';
      oskRow = 0;
      oskCol = 0;
      renderOsk();
      return;
    }
    if (id === 'abc') {
      oskPage = 'alpha';
      oskRow = 0;
      oskCol = 0;
      renderOsk();
      return;
    }
    if (id === 'space') {
      oskInsert(' ');
      return;
    }
    if (id === 'bksp') {
      oskBackspace();
      return;
    }
    if (id === 'enter') {
      if (oskTarget && (oskTarget.tagName || '').toLowerCase() === 'textarea') oskInsert('\n');
      else oskSubmit();
      return;
    }
    if (id === 'close') {
      closeOsk();
      return;
    }
    oskInsert(id);
    if (oskShift && id.length === 1 && /[A-Za-z]/.test(id)) {
      oskShift = false;
      renderOsk();
    }
  }

  function oskPressCurrent() {
    var rows = oskLayout();
    clampOskCursor();
    var key = rows[oskRow] && rows[oskRow][oskCol];
    oskPressId(oskKeyId(key));
  }

  function moveOsk(dx, dy) {
    var rows = oskLayout();
    if (!rows.length) return;
    if (dy) {
      oskRow = (oskRow + dy + rows.length) % rows.length;
      if (oskCol >= rows[oskRow].length) oskCol = rows[oskRow].length - 1;
    } else if (dx) {
      var row = rows[oskRow];
      oskCol = (oskCol + dx + row.length) % row.length;
    }
    renderOsk();
  }

  function handleOskPad(pad, edges, dir, now) {
    if (edges.undo) {
      oskBackspace();
      return;
    }
    if (edges.paint) {
      oskPressCurrent();
      return;
    }
    if (edges.more || edges.tools) {
      if (edges.more) oskSubmit();
      closeOsk();
      return;
    }
    if (edges.chat) {
      closeOsk();
      toggleChat();
      setGpFocus(null);
      return;
    }
    repeatStep('osk', dir.dx, dir.dy, now, function (dx, dy) {
      moveOsk(dx, dy);
    });
  }

  function bindTestMenu() {
    var el = testMenuEl();
    if (!el) return;
    el.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#gpTestMenuClose') || t === el) {
        e.preventDefault();
        closeTestMenu();
        return;
      }
      var pick = t.closest('[data-test-server]');
      if (pick) {
        e.preventDefault();
        launchPickedTest(pick.getAttribute('data-test-server') === 'eu');
      }
    });
  }

  function bindOsk() {
    var el = oskEl();
    if (!el) return;
    el.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var key = t.closest('[data-osk-id]');
      if (!key) return;
      e.preventDefault();
      oskRow = Number(key.getAttribute('data-osk-row')) || 0;
      oskCol = Number(key.getAttribute('data-osk-col')) || 0;
      oskPressId(key.getAttribute('data-osk-id'));
    });
  }

  function bindTestServerUi() {
    var sel = document.getElementById('gpTestServer');
    if (!sel) return;
    sel.addEventListener('change', function () {
      setTestServer(sel.value);
    });
  }

  function bindLegendUi() {
    var onBtn = document.getElementById('gpLegendOn');
    var offBtn = document.getElementById('gpLegendOff');
    if (onBtn) {
      onBtn.addEventListener('click', function (e) {
        e.preventDefault();
        setLegendOn(true);
      });
    }
    if (offBtn) {
      offBtn.addEventListener('click', function (e) {
        e.preventDefault();
        setLegendOn(false);
      });
    }
    var mapEl = document.getElementById('map');
    if (mapEl) {
      mapEl.addEventListener('scroll', updateLegend, { passive: true });
    }
    global.addEventListener('resize', updateLegend);
  }

  function clearPanMode() {
    if (!document.documentElement.classList.contains('pan-mode')) return;
    var pan = document.getElementById('panMode');
    if (pan) clickEl(pan);
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
    var axn = stickAxes(sticks.pan);
    var rx = analog(axisValue(pad, axn.x));
    var ry = analog(axisValue(pad, axn.y));
    if (rx) mapEl.scrollLeft += rx * PAN_SPEED;
    if (ry) mapEl.scrollTop += ry * PAN_SPEED;
  }

  function rising(id, down) {
    var was = !!prev[id];
    prev[id] = down;
    return down && !was;
  }

  function bindDown(pad, action) {
    var i = binds[action];
    if (!validButton(i)) return false;
    if (ignoreUntilUp[i]) {
      if (!buttonDown(pad, i)) delete ignoreUntilUp[i];
      else return false;
    }
    return buttonDown(pad, i);
  }

  function captureBindInput(pad) {
    if (!bindListen) return false;
    var row = null;
    var r;
    for (r = 0; r < BIND_ROWS.length; r++) {
      if (BIND_ROWS[r].id === bindListen) {
        row = BIND_ROWS[r];
        break;
      }
    }
    if (!row) {
      bindListen = null;
      return true;
    }
    if (row.stick) {
      var lx = axisValue(pad, 0);
      var ly = axisValue(pad, 1);
      var rx = axisValue(pad, 2);
      var ry = axisValue(pad, 3);
      var role = row.id === 'moveStick' ? 'move' : 'pan';
      if (Math.sqrt(lx * lx + ly * ly) > 0.6) {
        bindListen = null;
        setStick(role, 'left');
        return true;
      }
      if (Math.sqrt(rx * rx + ry * ry) > 0.6) {
        bindListen = null;
        setStick(role, 'right');
        return true;
      }
      return true;
    }
    var i;
    for (i = 0; i < BUTTON_NAMES.length; i++) {
      if (rising('cap' + i, buttonDown(pad, i))) {
        var action = bindListen;
        bindListen = null;
        ignoreUntilUp[i] = true;
        setBind(action, i);
        return true;
      }
    }
    return true;
  }

  function nudgeBindSelect(select, dir) {
    if (!select || select.tagName !== 'SELECT' || !dir) return;
    var next = select.selectedIndex + (dir > 0 ? 1 : -1);
    if (next < 0) next = select.options.length - 1;
    if (next >= select.options.length) next = 0;
    select.selectedIndex = next;
    if (typeof select.dispatchEvent === 'function') {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
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
        dismissHint();
      }
      return;
    }

    if (!isGamepadLayout()) return;

    if (bindListen) {
      captureBindInput(pad);
      return;
    }

    var paintDown = bindDown(pad, 'paint');
    var edges = {
      paint: rising('paint', paintDown),
      undo: rising('undo', bindDown(pad, 'undo')),
      chat: rising('chat', bindDown(pad, 'chat')),
      tile: rising('tile', bindDown(pad, 'tile')),
      palettePrev: rising('palettePrev', bindDown(pad, 'palettePrev')),
      paletteNext: rising('paletteNext', bindDown(pad, 'paletteNext')),
      zoomOut: rising('zoomOut', bindDown(pad, 'zoomOut')),
      zoomIn: rising('zoomIn', bindDown(pad, 'zoomIn')),
      tools: rising('tools', bindDown(pad, 'tools')),
      more: rising('more', bindDown(pad, 'more')),
      center: rising('center', bindDown(pad, 'center')),
      redo: rising('redo', bindDown(pad, 'redo')),
      railLeft: rising('railLeft', bindDown(pad, 'railLeft')),
      railRight: rising('railRight', bindDown(pad, 'railRight'))
    };
    var dir = moveDir(pad);
    var stick = stickDir(pad);
    var mode = uiMode();

    if (mode === 'wheel') {
      endPaint();
      handleWheelPad(pad, edges);
      return;
    }

    if (mode === 'osk') {
      endPaint();
      handleOskPad(pad, edges, dir, now);
      return;
    }

    if (mode === 'testMenu') {
      endPaint();
      if (edges.undo) closeTestMenu();
      else if (edges.paint) activateFocus();
      repeatStep('ui', dir.dx, dir.dy, now, function (dx, dy) {
        moveOverlayFocus(dx, dy);
      });
      handlePlayButton(pad, now, mode);
      return;
    }

    if (mode === 'rail') {
      endPaint();
      if (edges.undo) {
        closeRail();
        return;
      }
      if (edges.tools) {
        closeRail();
        openWheel();
        return;
      }
      if (edges.more) {
        closeRail();
        toggleMore();
        var railMore = document.querySelector('#moreSheet.open .more-nav-btn');
        if (railMore) setGpFocus(railMore);
        return;
      }
      if (edges.chat) {
        closeRail();
        toggleChat();
        if (chatIsOpen()) {
          focusChatControls();
          openOsk(document.getElementById('collabChatInput'));
        }
        return;
      }
      if (edges.railLeft) {
        enterRail('left');
        return;
      }
      if (edges.railRight) {
        enterRail('right');
        return;
      }
      if (edges.paint) activateFocus();
      repeatStep('rail', 0, dir.dy, now, function (dx, dy) {
        moveOverlayFocus(0, dy);
      });
      return;
    }

    if (mode === 'binds') {
      endPaint();
      if (edges.undo) closeOverlay();
      else if (edges.paint) {
        var focused = gpFocusEl || document.querySelector('.gp-focus');
        if (focused && focused.getAttribute('data-bind-action')) startBindListen(focused.getAttribute('data-bind-action'));
        else if (focused && focused.getAttribute('data-bind-stick')) startBindListen(focused.getAttribute('data-bind-stick'));
        else activateFocus();
      }
      repeatStep('ui', dir.dx, dir.dy, now, function (dx, dy) {
        var el = gpFocusEl || document.querySelector('.gp-focus');
        if (el && el.tagName === 'SELECT' && dx) nudgeBindSelect(el, dx);
        else moveOverlayFocus(dx, dy);
      });
      return;
    }

    if (mode) {
      endPaint();
      if (mode === 'more') handleMoreButton(pad, now, mode);
      if (edges.undo) closeOverlay();
      else if (edges.more && mode !== 'more') {
        if (mode === 'chat') closeOverlay();
      } else if (mode === 'chat' && edges.chat) {
        toggleChat();
        closeOsk();
        setGpFocus(null);
      } else if (edges.paint) activateFocus();
      repeatStep('ui', dir.dx, dir.dy, now, function (dx, dy) {
        moveOverlayFocus(dx, dy);
      });
      return;
    }

    setGpFocus(null);
    repeatStep('map', stick.dx, stick.dy, now, function (dx, dy) {
      stepWork(dx, dy);
    });
    panMap(pad);

    if (edges.paint) {
      paintHeld = true;
      if (global.TagproLoupe && TagproLoupe.paintWorkTile) TagproLoupe.paintWorkTile('start');
    } else if (!paintDown) {
      endPaint();
    }

    if (edges.undo) clickId('undo');
    if (edges.redo) clickId('dockRedo');
    if (edges.chat) {
      toggleChat();
      if (chatIsOpen()) {
        focusChatControls();
        openOsk(document.getElementById('collabChatInput'));
      } else {
        closeOsk();
        setGpFocus(null);
      }
    }
    if (edges.tile) openWorkTileSettings();
    var palDx = (bindDown(pad, 'paletteNext') ? 1 : 0) - (bindDown(pad, 'palettePrev') ? 1 : 0);
    repeatStep('palette', palDx, 0, now, function (dx) {
      stepPalette(dx);
    });
    if (edges.zoomOut) zoomBy(-1);
    if (edges.zoomIn) zoomBy(1);
    if (edges.tools) openWheel();
    handleMoreButton(pad, now, mode);
    if (edges.center) ensureWorkTileVisible(true);
    if (edges.railLeft) {
      enterRail('left');
      return;
    }
    if (edges.railRight) {
      enterRail('right');
      return;
    }
    handlePlayButton(pad, now, mode);
    updateLegend();
  }

  function tick() {
    raf = 0;
    if (!shouldPoll()) return;
    raf = requestAnimationFrame(tick);
    var pad = firstPad();
    if (isAutoLayout() && global.TagproLayout && TagproLayout.apply) {
      if (!!pad !== isGamepadLayout()) TagproLayout.apply();
    }
    if (pad) handlePad(pad);
    else if (!hintVisible() && !isAutoLayout()) return;
    if (isGamepadLayout()) updateLegend();
  }

  function onConnected(e) {
    if (e && e.gamepad) lastEventPad = e.gamepad;
    hintDismissed = false;
    if (isAutoLayout() && global.TagproLayout && TagproLayout.apply) TagproLayout.apply();
    if (!isGamepadLayout()) showHint();
    ensureLoop();
  }

  function onLayout() {
    if (isGamepadLayout()) {
      hideHint();
      clearPanMode();
      if (global.TagproLoupe && TagproLoupe.setWorkTile) {
        var c = TagproLoupe.center ? TagproLoupe.center() : { x: 0, y: 0 };
        TagproLoupe.setWorkTile(c.x, c.y);
        ensureWorkTileVisible(false);
      }
    } else {
      closeWheel();
      closeBinds();
      closeOsk();
      closeTestMenu();
      closeRail();
      endPaint();
      setGpFocus(null);
      moreHeldAt = 0;
      moreHoldFired = false;
    }
    syncBindsVisibility();
    if (shouldPoll()) ensureLoop();
    updateLegend();
  }

  global.addEventListener('gamepadconnected', onConnected);
  global.addEventListener('gamepaddisconnected', function (e) {
    endPaint();
    if (e && e.gamepad && lastEventPad && e.gamepad.index === lastEventPad.index) {
      lastEventPad = null;
    }
    if (isAutoLayout() && global.TagproLayout && TagproLayout.apply) TagproLayout.apply();
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
        if (uiMode() === 'wheel') {
          wheelPage(dir);
          return;
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

  function bindBindsUi() {
    var openBtn = document.getElementById('gpBindsOpen');
    var doneBtn = document.getElementById('gpBindsDone');
    var restoreBtn = document.getElementById('gpBindsRestore');
    var list = document.getElementById('gpBindsList');
    var sheet = bindsEl();
    if (openBtn) {
      openBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openBinds();
      });
    }
    if (doneBtn) {
      doneBtn.addEventListener('click', function (e) {
        e.preventDefault();
        closeBinds();
      });
    }
    if (restoreBtn) {
      restoreBtn.addEventListener('click', function (e) {
        e.preventDefault();
        restoreDefaultBinds();
      });
    }
    if (sheet) {
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) closeBinds();
      });
    }
    if (list) {
      list.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('[data-bind-listen]')) {
          e.preventDefault();
          cancelBindListen();
          return;
        }
        var label = t.closest('.gp-bind-row label');
        if (!label) return;
        var row = label.parentNode;
        var sel = row && row.querySelector('[data-bind-action], [data-bind-stick]');
        if (!sel) return;
        e.preventDefault();
        startBindListen(sel.getAttribute('data-bind-action') || sel.getAttribute('data-bind-stick'));
      });
      list.addEventListener('change', function (e) {
        var t = e.target;
        if (!t) return;
        if (t.getAttribute('data-bind-action')) {
          setBind(t.getAttribute('data-bind-action'), Number(t.value));
        } else if (t.getAttribute('data-bind-stick')) {
          setStick(t.getAttribute('data-bind-stick') === 'moveStick' ? 'move' : 'pan', t.value);
        }
      });
    }
  }

  $(function () {
    bindBumpers();
    bindWheel();
    bindBindsUi();
    bindTestMenu();
    bindOsk();
    bindTestServerUi();
    bindLegendUi();
    syncBindLabels();
    syncBindsVisibility();
    if (isAutoLayout() && hasPad() && global.TagproLayout && TagproLayout.apply) TagproLayout.apply();
    if (hasPad() && !isGamepadLayout()) showHint();
    if (shouldPoll()) ensureLoop();
    if (isGamepadLayout() && global.TagproLoupe && TagproLoupe.setWorkTile) {
      var c = TagproLoupe.center ? TagproLoupe.center() : { x: 0, y: 0 };
      TagproLoupe.setWorkTile(c.x, c.y);
    }
    updateLegend();
  });

  global.TagproGamepad = {
    stepPalette: stepPalette,
    openTools: openWheel,
    closeTools: closeWheel,
    openBinds: openBinds,
    closeBinds: closeBinds,
    restoreBinds: restoreDefaultBinds,
    preferredTestIsEu: preferredTestIsEu,
    launchPreferredTest: launchPreferredTest,
    setTestServer: setTestServer,
    openTestMenu: openTestMenu,
    closeTestMenu: closeTestMenu,
    openOsk: openOsk,
    closeOsk: closeOsk,
    updateLegend: updateLegend,
    setLegendOn: setLegendOn
  };
})(window);
