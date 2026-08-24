$(function() {
  var LOUPE_TILES = 11;
  var LOUPE_CELL = 24;
  var LOUPE_SIZE = LOUPE_TILES * LOUPE_CELL;
  var LOUPE_LIFT = LOUPE_SIZE + 28;
  var LONG_PRESS_MS = 280;
  var HOLD_SLOP = 12;
  var DOUBLE_TAP_MS = 350;
  var PINCH_ZOOM_RATIO = 1.08;
  var LOUPE_STEP_PX = 40;

  var $map = $('#map');
  var mapEl = $map[0];
  var $loupe = $('#loupe');
  var loupeInner = document.getElementById('loupeInner');
  var $moreSheet = $('#moreSheet');
  var $moreBackdrop = $('#moreBackdrop');
  var $panMode = $('#panMode');

  var panMode = false;
  var painting = false;
  var loupeVisible = false;
  var longPressTimer = null;
  var lastTileEl = null;
  var pinchLastZoomAt = 0;
  var panPointer = null;
  var twoFingerPanning = false;
  var lastPinchMid = null;
  var twoFingerAcc = { x: 0, y: 0 };
  var wheelAcc = { x: 0, y: 0 };
  var mouseLoupe = false;
  var ignorePaintUntil = 0;
  var settingsPointerDown = false;

  function isPhoneLayout() {
    if (window.TagproLayout && window.TagproLayout.isMobile) return window.TagproLayout.isMobile();
    return true;
  }

  function syncLayoutSwitcher() {
    var override = (window.TagproLayout && window.TagproLayout.getOverride && window.TagproLayout.getOverride()) || null;
    $('#layoutAuto, #layoutMobileBtn, #layoutDesktopBtn').removeClass('active');
    if (override === 'mobile') $('#layoutMobileBtn').addClass('active');
    else if (override === 'desktop') $('#layoutDesktopBtn').addClass('active');
    else $('#layoutAuto').addClass('active');
  }

  syncLayoutSwitcher();
  $('#layoutAuto').on('click', function(e) {
    e.preventDefault();
    if (window.TagproLayout) TagproLayout.setOverride(null);
    closeMore();
    syncLayoutSwitcher();
  });
  $('#layoutMobileBtn').on('click', function(e) {
    e.preventDefault();
    if (window.TagproLayout) TagproLayout.setOverride('mobile');
    closeMore();
    syncLayoutSwitcher();
  });
  $('#layoutDesktopBtn').on('click', function(e) {
    e.preventDefault();
    if (window.TagproLayout) TagproLayout.setOverride('desktop');
    closeMore();
    syncLayoutSwitcher();
  });

  var THEME_KEY = 'tagpro-theme';
  function readTheme() {
    try {
      return (localStorage.getItem(THEME_KEY) === 'light') ? 'light' : 'dark';
    } catch (err) {
      return 'dark';
    }
  }
  function applyTheme(theme) {
    if (theme !== 'light') theme = 'dark';
    document.documentElement.classList.toggle('theme-dark', theme === 'dark');
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    $('#themeDarkBtn').toggleClass('active', theme === 'dark');
    $('#themeLightBtn').toggleClass('active', theme === 'light');
    try { localStorage.setItem(THEME_KEY, theme); } catch (err) {}
  }
  applyTheme(readTheme());
  $('#themeDarkBtn').on('click', function(e) {
    e.preventDefault();
    applyTheme('dark');
  });
  $('#themeLightBtn').on('click', function(e) {
    e.preventDefault();
    applyTheme('light');
  });

  function closeMore() {
    $moreSheet.removeClass('open');
    $moreBackdrop.removeClass('open').attr('hidden', true);
  }

  function openMore() {
    $moreSheet.addClass('open');
    $moreBackdrop.addClass('open').removeAttr('hidden');
  }

  $('#moreToggle').on('click', function() {
    if ($moreSheet.hasClass('open')) closeMore();
    else openMore();
  });
  $('#moreClose, #moreBackdrop').on('click', closeMore);

  function setPanMode(on) {
    panMode = !!on;
    $panMode.toggleClass('active', panMode).attr('aria-pressed', panMode ? 'true' : 'false');
    document.documentElement.classList.toggle('pan-mode', panMode);
    $map.css('cursor', panMode ? 'grab' : '');
    if (panMode) {
      hideLoupe();
      painting = false;
      mouseLoupe = false;
      if (lastTileEl) triggerTile($(lastTileEl), 'mouseup');
      lastTileEl = null;
    }
  }

  $panMode.on('click', function() {
    setPanMode(!panMode);
  });

  $('#dockUndo').on('click', function() { $('#undo').trigger('click'); });
  $('#dockRedo').on('click', function() { $('#redo').trigger('click'); });
  $('#dockZoomIn').on('click', function() {
    if (this.disabled) return;
    if (window.TagproMap && TagproMap.zoomIn) TagproMap.zoomIn();
  });
  $('#dockZoomOut').on('click', function() {
    if (this.disabled) return;
    if (window.TagproMap && TagproMap.zoomOut) TagproMap.zoomOut();
  });

  function tileFromPoint(clientX, clientY) {
    var stack = [];
    var el = document.elementFromPoint(clientX, clientY);
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.id === 'map' || (el.classList && el.classList.contains('tile') && $(el).closest('#map').length)) {
        break;
      }
      stack.push(el);
      el.style.pointerEvents = 'none';
      el = document.elementFromPoint(clientX, clientY);
    }
    for (var i = 0; i < stack.length; i++) {
      stack[i].style.pointerEvents = '';
    }
    if (!el) return $();
    return $(el).closest('#map .tile');
  }

  function mapHasSettings(x, y) {
    return !!(window.TagproMap && TagproMap.tileHasSettings && TagproMap.tileHasSettings(x, y));
  }

  function openSettingsAt(x, y) {
    return !!(window.TagproMap && TagproMap.openTileSettings && TagproMap.openTileSettings(x, y));
  }

  function handleSettingsDoubleTap(x, y) {
    if (x == null || y == null || !mapHasSettings(x, y)) return false;
    var now = Date.now();
    if (lastSettingsTap && lastSettingsTap.x === x && lastSettingsTap.y === y && (now - lastSettingsTap.t) <= DOUBLE_TAP_MS) {
      lastSettingsTap = null;
      clearSettingsPaint();
      openSettingsAt(x, y);
      hideLoupe();
      return true;
    }
    lastSettingsTap = { t: now, x: x, y: y };
    return false;
  }

  function triggerTile($tile, type) {
    if (!$tile || !$tile.length) return;
    $tile.trigger($.Event(type, { which: 1, button: 0, bubbles: true }));
  }

  var loupeFollow = false;
  var loupePainting = false;
  var loupeOriginX = 0;
  var loupeOriginY = 0;
  var loupeCenterX = 0;
  var loupeCenterY = 0;
  var loupeCells = [];
  var loupeGrid = null;
  var loupeRaf = 0;
  var pendingDismiss = false;
  var holdMovingLoupe = false;
  var holdStart = null;
  var lastPointer = { x: 0, y: 0 };
  var lastSettingsTap = null;
  var suppressLoupe = false;
  var pendingSettingsPaint = null;
  var settingsPaintTimer = null;

  function clearSettingsPaint() {
    if (settingsPaintTimer) {
      clearTimeout(settingsPaintTimer);
      settingsPaintTimer = null;
    }
    pendingSettingsPaint = null;
  }

  function queueSettingsPaint($tile, clientX, clientY) {
    clearSettingsPaint();
    pendingSettingsPaint = { $tile: $tile, clientX: clientX, clientY: clientY };
    settingsPaintTimer = setTimeout(function() {
      var p = pendingSettingsPaint;
      pendingSettingsPaint = null;
      settingsPaintTimer = null;
      if (p && p.$tile) {
        beginPaintAtTile(p.$tile, p.clientX, p.clientY, false);
        if (!settingsPointerDown) endPaint(p.clientX, p.clientY);
      }
    }, DOUBLE_TAP_MS);
  }

  function hideLoupe() {
    loupeVisible = false;
    loupeFollow = false;
    loupePainting = false;
    pendingDismiss = false;
    holdMovingLoupe = false;
    holdStart = null;
    suppressLoupe = false;
    clearSettingsPaint();
    if (loupeRaf) {
      cancelAnimationFrame(loupeRaf);
      loupeRaf = 0;
    }
    $loupe.removeClass('visible').attr('aria-hidden', 'true');
  }

  function showLoupe() {
    loupeVisible = true;
    $loupe.addClass('visible').attr('aria-hidden', 'false');
  }

  function pointInLoupe(clientX, clientY) {
    if (!loupeVisible) return false;
    var r = $loupe[0].getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function mapTileAt(x, y) {
    var rows = mapEl.querySelectorAll('.tileRow');
    var row = rows[y];
    if (!row || x < 0 || x >= row.children.length) return $();
    return $(row.children[x]).find('.tile').first();
  }

  function loupeCellFromPoint(clientX, clientY) {
    if (!loupeInner) return null;
    var rect = loupeInner.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    var col = Math.floor(x / (rect.width / LOUPE_TILES));
    var row = Math.floor(y / (rect.height / LOUPE_TILES));
    if (col < 0 || row < 0 || col >= LOUPE_TILES || row >= LOUPE_TILES) return null;
    return { x: loupeOriginX + col, y: loupeOriginY + row };
  }

  function ensureLoupeGrid() {
    if (loupeGrid || !loupeInner) return;
    loupeGrid = document.createElement('div');
    loupeGrid.className = 'loupe-grid';
    loupeCells = [];
    for (var dy = 0; dy < LOUPE_TILES; dy++) {
      var row = document.createElement('div');
      row.className = 'loupe-row';
      for (var dx = 0; dx < LOUPE_TILES; dx++) {
        var bg = document.createElement('div');
        bg.className = 'tileBackground';
        bg.innerHTML = "<div class='tile nestedSquare'>" +
          "<div class='tileQuadrant nestedSquareTR'></div>" +
          "<div class='tileQuadrant nestedSquareBR'></div>" +
          "<div class='tileQuadrant nestedSquareBL'></div>" +
          "<div class='tileQuadrant nestedSquareTL'></div>" +
          "<div class='selectionIndicator nestedSquare'></div>" +
          "<div class='potentialHighlight nestedSquare'></div></div>";
        row.appendChild(bg);
        loupeCells.push(bg);
      }
      loupeGrid.appendChild(row);
    }
    loupeInner.innerHTML = '';
    loupeInner.style.width = LOUPE_SIZE + 'px';
    loupeInner.style.height = LOUPE_SIZE + 'px';
    loupeInner.appendChild(loupeGrid);
  }

  function stampLoupeNow() {
    ensureLoupeGrid();
    var half = Math.floor((LOUPE_TILES - 1) / 2);
    loupeOriginX = loupeCenterX - half;
    loupeOriginY = loupeCenterY - half;
    var paint = window.TagproMap && TagproMap.paintLoupeCell;
    for (var i = 0; i < loupeCells.length; i++) {
      var dx = i % LOUPE_TILES;
      var dy = (i - dx) / LOUPE_TILES;
      if (paint) {
        paint(loupeOriginX + dx, loupeOriginY + dy, loupeCells[i], LOUPE_CELL);
      }
    }
    showLoupe();
  }

  function renderLoupe() {
    if (loupeRaf) {
      cancelAnimationFrame(loupeRaf);
      loupeRaf = 0;
    }
    stampLoupeNow();
  }

  function requestLoupeStamp() {
    if (loupeRaf) return;
    loupeRaf = requestAnimationFrame(function() {
      loupeRaf = 0;
      if (loupeVisible || loupeFollow) stampLoupeNow();
    });
  }

  function positionLoupe(clientX, clientY) {
    var left = clientX;
    var top = clientY - LOUPE_LIFT;
    var half = LOUPE_SIZE / 2;
    left = Math.max(half + 8, Math.min(left, window.innerWidth - half - 8));
    top = Math.max(half + 8, Math.min(top, window.innerHeight - half - 8));
    $loupe.css({ left: left + 'px', top: top + 'px', width: LOUPE_SIZE + 'px', height: LOUPE_SIZE + 'px' });
  }

  function updateLoupe(clientX, clientY) {
    var $tile = tileFromPoint(clientX, clientY);
    if ($tile.length) {
      var x = $tile.data('x');
      var y = $tile.data('y');
      if (x != null && y != null && !isNaN(x) && !isNaN(y)) {
        loupeCenterX = x;
        loupeCenterY = y;
      }
    }
    if (loupeFollow) positionLoupe(clientX, clientY);
    requestLoupeStamp();
  }

  function clampLoupeCenter() {
    loupeCenterX = Math.round(loupeCenterX);
    loupeCenterY = Math.round(loupeCenterY);
    var size = window.TagproMap && TagproMap.getSize && TagproMap.getSize();
    if (!size) return;
    if (size.width) loupeCenterX = Math.max(0, Math.min(size.width - 1, loupeCenterX));
    if (size.height) loupeCenterY = Math.max(0, Math.min(size.height - 1, loupeCenterY));
  }

  function stepLoupeBy(dx, dy) {
    if (!dx && !dy) return;
    loupeCenterX += dx;
    loupeCenterY += dy;
    clampLoupeCenter();
    loupeFollow = false;
    stampLoupeNow();
  }

  function accumulateLoupePan(dx, dy, acc) {
    acc.x += dx;
    acc.y += dy;
    var sx = 0;
    var sy = 0;
    while (acc.x >= LOUPE_STEP_PX) { sx += 1; acc.x -= LOUPE_STEP_PX; }
    while (acc.x <= -LOUPE_STEP_PX) { sx -= 1; acc.x += LOUPE_STEP_PX; }
    while (acc.y >= LOUPE_STEP_PX) { sy += 1; acc.y -= LOUPE_STEP_PX; }
    while (acc.y <= -LOUPE_STEP_PX) { sy -= 1; acc.y += LOUPE_STEP_PX; }
    if (sx || sy) stepLoupeBy(sx, sy);
  }

  function revealLoupeForNav(clientX, clientY) {
    if (!loupeVisible) {
      var $tile = (clientX != null && clientY != null) ? tileFromPoint(clientX, clientY) : $();
      if ($tile.length) {
        var x = $tile.data('x');
        var y = $tile.data('y');
        if (x != null && y != null && !isNaN(x) && !isNaN(y)) {
          loupeCenterX = x;
          loupeCenterY = y;
        }
      }
      clampLoupeCenter();
      if (clientX != null && clientY != null) {
        positionLoupe(clientX, clientY);
      } else {
        var r = mapEl.getBoundingClientRect();
        positionLoupe(r.left + r.width / 2, r.top + r.height / 2);
      }
    }
    stampLoupeNow();
  }

  function beginPaintAtTile($tile, clientX, clientY, allowLoupe) {
    painting = true;
    loupeFollow = !!allowLoupe;
    suppressLoupe = !allowLoupe;
    lastTileEl = $tile[0];
    triggerTile($tile, 'mousedown');
    triggerTile($tile, 'mouseenter');
    holdStart = { clientX: clientX, clientY: clientY };
    lastPointer = { x: clientX, y: clientY };
    clearLongPress();
    if (allowLoupe) {
      longPressTimer = setTimeout(function() {
        updateLoupe(lastPointer.x, lastPointer.y);
      }, LONG_PRESS_MS);
    }
  }

  function paintLoupeAt(clientX, clientY, phase) {
    var cell = loupeCellFromPoint(clientX, clientY);
    if (!cell) return false;
    var $tile = mapTileAt(cell.x, cell.y);
    if (!$tile.length) return false;
    if (phase === 'start') {
      if (handleSettingsDoubleTap(cell.x, cell.y)) return true;
      if (mapHasSettings(cell.x, cell.y)) {
        suppressLoupe = true;
        settingsPointerDown = true;
        holdStart = { clientX: clientX, clientY: clientY };
        lastPointer = { x: clientX, y: clientY };
        queueSettingsPaint($tile, clientX, clientY);
        return true;
      }
      loupePainting = true;
      painting = true;
      lastTileEl = $tile[0];
      triggerTile($tile, 'mousedown');
      triggerTile($tile, 'mouseenter');
    } else if (phase === 'move') {
      if (lastTileEl && lastTileEl !== $tile[0]) {
        triggerTile($(lastTileEl), 'mouseleave');
        triggerTile($tile, 'mouseenter');
      }
      triggerTile($tile, 'mousemove');
      lastTileEl = $tile[0];
    } else {
      if (lastTileEl) triggerTile($(lastTileEl), 'mouseup');
      loupePainting = false;
      painting = false;
      lastTileEl = null;
    }
    renderLoupe();
    return true;
  }

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function beginHoldReposition(clientX, clientY) {
    if (suppressLoupe) return;
    pendingDismiss = false;
    holdMovingLoupe = true;
    loupeFollow = true;
    updateLoupe(clientX, clientY);
  }

  function movedPastSlop(clientX, clientY) {
    if (!holdStart) return false;
    var dx = clientX - holdStart.clientX;
    var dy = clientY - holdStart.clientY;
    return (dx * dx + dy * dy) >= (HOLD_SLOP * HOLD_SLOP);
  }

  function endPaint(clientX, clientY) {
    clearLongPress();
    if (painting && !loupePainting) {
      var $tile = tileFromPoint(clientX, clientY);
      if (!$tile.length && lastTileEl) $tile = $(lastTileEl);
      triggerTile($tile, 'mouseup');
    }
    painting = false;
    lastTileEl = null;
    loupeFollow = false;
    holdMovingLoupe = false;
    if (pendingDismiss) {
      pendingDismiss = false;
      hideLoupe();
      return;
    }
    pendingDismiss = false;
    holdStart = null;
    if (loupeVisible) renderLoupe();
  }

  function startPan(clientX, clientY) {
    panPointer = {
      x: clientX,
      y: clientY,
      sl: mapEl.scrollLeft,
      st: mapEl.scrollTop
    };
    $map.css('cursor', 'grabbing');
  }

  function movePan(clientX, clientY) {
    if (!panPointer) return;
    mapEl.scrollLeft = panPointer.sl - (clientX - panPointer.x);
    mapEl.scrollTop = panPointer.st - (clientY - panPointer.y);
  }

  function endPan() {
    panPointer = null;
    $map.css('cursor', panMode ? 'grab' : '');
  }

  function pinchDistance(t0, t1) {
    var dx = t0.clientX - t1.clientX;
    var dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pinchMidpoint(t0, t1) {
    return {
      x: (t0.clientX + t1.clientX) / 2,
      y: (t0.clientY + t1.clientY) / 2
    };
  }

  mapEl.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      twoFingerPanning = true;
      painting = false;
      clearLongPress();
      clearSettingsPaint();
      panPointer = null;
      if (lastTileEl) triggerTile($(lastTileEl), 'mouseup');
      lastTileEl = null;
      lastPinchMid = pinchMidpoint(e.touches[0], e.touches[1]);
      twoFingerAcc.x = 0;
      twoFingerAcc.y = 0;
      if (isPhoneLayout()) {
        pinchLastZoomAt = 0;
        revealLoupeForNav(lastPinchMid.x, lastPinchMid.y);
      } else {
        hideLoupe();
        pinchLastZoomAt = pinchDistance(e.touches[0], e.touches[1]);
      }
      return;
    }

    if (e.touches.length !== 1) return;
    if (twoFingerPanning || Date.now() < ignorePaintUntil) return;
    var t = e.touches[0];

    if (loupeVisible) {
      e.preventDefault();
      e.stopPropagation();
      closeMore();
      var over = tileFromPoint(t.clientX, t.clientY);
      var ox = over.data('x');
      var oy = over.data('y');
      if (over.length && mapHasSettings(ox, oy)) {
        if (handleSettingsDoubleTap(ox, oy)) return;
        suppressLoupe = true;
        pendingDismiss = false;
        return;
      }
      pendingDismiss = true;
      holdMovingLoupe = false;
      holdStart = { clientX: t.clientX, clientY: t.clientY };
      lastPointer = { x: t.clientX, y: t.clientY };
      clearLongPress();
      longPressTimer = setTimeout(function() {
        beginHoldReposition(lastPointer.x, lastPointer.y);
      }, LONG_PRESS_MS);
      return;
    }

    if (panMode) {
      e.preventDefault();
      startPan(t.clientX, t.clientY);
      return;
    }

    var $tile = tileFromPoint(t.clientX, t.clientY);
    if (!$tile.length) return;
    e.preventDefault();
    closeMore();
    var x = $tile.data('x');
    var y = $tile.data('y');
    settingsPointerDown = true;
    if (mapHasSettings(x, y) && handleSettingsDoubleTap(x, y)) return;
    if (mapHasSettings(x, y)) {
      suppressLoupe = true;
      holdStart = { clientX: t.clientX, clientY: t.clientY };
      lastPointer = { x: t.clientX, y: t.clientY };
      queueSettingsPaint($tile, t.clientX, t.clientY);
      return;
    }
    beginPaintAtTile($tile, t.clientX, t.clientY, true);
  }, { passive: false });

  mapEl.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      twoFingerPanning = true;
      var mid = pinchMidpoint(e.touches[0], e.touches[1]);
      if (isPhoneLayout()) {
        if (lastPinchMid) {
          accumulateLoupePan(mid.x - lastPinchMid.x, mid.y - lastPinchMid.y, twoFingerAcc);
        }
        lastPinchMid = mid;
        return;
      }
      if (lastPinchMid) {
        mapEl.scrollLeft += lastPinchMid.x - mid.x;
        mapEl.scrollTop += lastPinchMid.y - mid.y;
      }
      lastPinchMid = mid;
      var dist = pinchDistance(e.touches[0], e.touches[1]);
      if (pinchLastZoomAt) {
        if (dist / pinchLastZoomAt >= PINCH_ZOOM_RATIO) {
          $('#zoomIn').trigger('click');
          pinchLastZoomAt = dist;
        } else if (pinchLastZoomAt / dist >= PINCH_ZOOM_RATIO) {
          $('#zoomOut').trigger('click');
          pinchLastZoomAt = dist;
        }
      }
      return;
    }

    if (e.touches.length !== 1) return;
    if (twoFingerPanning) return;
    var t = e.touches[0];
    lastPointer = { x: t.clientX, y: t.clientY };

    if (panMode && panPointer) {
      e.preventDefault();
      movePan(t.clientX, t.clientY);
      return;
    }

    if (!painting || loupePainting) {
      if (pendingSettingsPaint && movedPastSlop(t.clientX, t.clientY)) {
        e.preventDefault();
        var p = pendingSettingsPaint;
        clearSettingsPaint();
        beginPaintAtTile(p.$tile, t.clientX, t.clientY, false);
        return;
      }
      if (pendingDismiss || holdMovingLoupe) {
        e.preventDefault();
        if (movedPastSlop(t.clientX, t.clientY) || holdMovingLoupe) {
          clearLongPress();
          beginHoldReposition(t.clientX, t.clientY);
        }
      }
      return;
    }
    e.preventDefault();
    var $tile = tileFromPoint(t.clientX, t.clientY);
    if ($tile.length) {
      if (lastTileEl && lastTileEl !== $tile[0]) {
        triggerTile($(lastTileEl), 'mouseleave');
        triggerTile($tile, 'mouseenter');
      }
      triggerTile($tile, 'mousemove');
      lastTileEl = $tile[0];
    }
    if (movedPastSlop(t.clientX, t.clientY) || loupeVisible) {
      if (suppressLoupe) return;
      clearLongPress();
      loupeFollow = true;
      updateLoupe(t.clientX, t.clientY);
    }
  }, { passive: false });

  function onTouchEnd(e) {
    if (e.touches.length >= 2) {
      pinchLastZoomAt = pinchDistance(e.touches[0], e.touches[1]);
      lastPinchMid = pinchMidpoint(e.touches[0], e.touches[1]);
      return;
    }
    if (e.touches.length === 1 && twoFingerPanning) {
      twoFingerPanning = false;
      lastPinchMid = null;
      pinchLastZoomAt = 0;
      twoFingerAcc.x = 0;
      twoFingerAcc.y = 0;
      painting = false;
      ignorePaintUntil = Date.now() + 350;
      if (!isPhoneLayout()) {
        hideLoupe();
        startPan(e.touches[0].clientX, e.touches[0].clientY);
      }
      return;
    }
    if (e.touches.length === 0) {
      if (twoFingerPanning) ignorePaintUntil = Date.now() + 350;
      twoFingerPanning = false;
      lastPinchMid = null;
      pinchLastZoomAt = 0;
      twoFingerAcc.x = 0;
      twoFingerAcc.y = 0;
      settingsPointerDown = false;
      panPointer = null;
      endPan();
      var t = (e.changedTouches && e.changedTouches[0]) || {};
      endPaint(t.clientX, t.clientY);
    }
  }

  mapEl.addEventListener('touchend', onTouchEnd, { passive: false });
  mapEl.addEventListener('touchcancel', onTouchEnd, { passive: false });

  mapEl.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    if (panMode) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e.clientX, e.clientY);
      return;
    }
    if (isPhoneLayout() && !e.shiftKey) {
      var $tile = $(e.target).closest('#map .tile');
      if (!$tile.length) $tile = tileFromPoint(e.clientX, e.clientY);
      if ($tile.length) {
        var x = $tile.data('x');
        var y = $tile.data('y');
        if (mapHasSettings(x, y)) {
          e.preventDefault();
          e.stopPropagation();
          closeMore();
          settingsPointerDown = true;
          holdStart = { clientX: e.clientX, clientY: e.clientY };
          lastPointer = { x: e.clientX, y: e.clientY };
          if (handleSettingsDoubleTap(x, y)) return;
          suppressLoupe = true;
          pendingDismiss = false;
          if (!loupeVisible) queueSettingsPaint($tile, e.clientX, e.clientY);
          return;
        }
      }
    }
    if (loupeVisible) {
      e.preventDefault();
      e.stopPropagation();
      pendingDismiss = true;
      holdMovingLoupe = false;
      holdStart = { clientX: e.clientX, clientY: e.clientY };
      lastPointer = { x: e.clientX, y: e.clientY };
      clearLongPress();
      longPressTimer = setTimeout(function() {
        beginHoldReposition(lastPointer.x, lastPointer.y);
      }, LONG_PRESS_MS);
    }
  }, true);

  $map.on('mousedown', function(e) {
    if (e.which !== 1) return;
    if (e.shiftKey) return;
    if (panMode) return;
    if (loupeVisible) return;
    mouseLoupe = true;
    loupeFollow = true;
    holdStart = { clientX: e.clientX, clientY: e.clientY };
    lastPointer = { x: e.clientX, y: e.clientY };
    clearLongPress();
    longPressTimer = setTimeout(function() {
      if (mouseLoupe) updateLoupe(lastPointer.x, lastPointer.y);
    }, LONG_PRESS_MS);
  });
  $(document).on('mousemove', function(e) {
    lastPointer = { x: e.clientX, y: e.clientY };
    if (loupePainting) {
      paintLoupeAt(e.clientX, e.clientY, 'move');
      return;
    }
    if (panMode && panPointer) {
      e.preventDefault();
      movePan(e.clientX, e.clientY);
      return;
    }
    if (pendingSettingsPaint && movedPastSlop(e.clientX, e.clientY)) {
      var p = pendingSettingsPaint;
      clearSettingsPaint();
      beginPaintAtTile(p.$tile, e.clientX, e.clientY, false);
      return;
    }
    if (pendingDismiss || holdMovingLoupe) {
      if (movedPastSlop(e.clientX, e.clientY) || holdMovingLoupe) {
        clearLongPress();
        beginHoldReposition(e.clientX, e.clientY);
      }
      return;
    }
    if (!mouseLoupe || panMode) return;
    if (movedPastSlop(e.clientX, e.clientY) || loupeVisible) {
      clearLongPress();
      loupeFollow = true;
      updateLoupe(e.clientX, e.clientY);
    }
  });
  $(document).on('mouseup', function() {
    settingsPointerDown = false;
    if (loupePainting) {
      paintLoupeAt(0, 0, 'end');
    }
    if (panPointer) endPan();
    if (mouseLoupe || pendingDismiss || holdMovingLoupe) {
      mouseLoupe = false;
      clearLongPress();
      loupeFollow = false;
      holdMovingLoupe = false;
      if (pendingDismiss) {
        pendingDismiss = false;
        hideLoupe();
      } else if (loupeVisible) {
        renderLoupe();
      }
      holdStart = null;
    }
  });

  mapEl.addEventListener('dblclick', function(e) {
    if (!isPhoneLayout()) return;
    var $tile = $(e.target).closest('#map .tile');
    if (!$tile.length) $tile = tileFromPoint(e.clientX, e.clientY);
    if (!$tile.length) return;
    var x = $tile.data('x');
    var y = $tile.data('y');
    if (!mapHasSettings(x, y)) return;
    e.preventDefault();
    e.stopPropagation();
    clearSettingsPaint();
    lastSettingsTap = null;
    settingsPointerDown = false;
    openSettingsAt(x, y);
    hideLoupe();
  }, true);

  mapEl.addEventListener('wheel', function(e) {
    if (!isPhoneLayout()) return;
    e.preventDefault();
    revealLoupeForNav(e.clientX, e.clientY);
    accumulateLoupePan(e.deltaX, e.deltaY, wheelAcc);
  }, { passive: false });

  var loupeEl = $loupe[0];
  loupeEl.addEventListener('touchstart', function(e) {
    e.preventDefault();
    e.stopPropagation();
    var t = e.touches[0];
    paintLoupeAt(t.clientX, t.clientY, 'start');
  }, { passive: false });
  loupeEl.addEventListener('touchmove', function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!loupePainting) return;
    var t = e.touches[0];
    paintLoupeAt(t.clientX, t.clientY, 'move');
  }, { passive: false });
  loupeEl.addEventListener('touchend', function(e) {
    e.preventDefault();
    e.stopPropagation();
    paintLoupeAt(0, 0, 'end');
  }, { passive: false });
  loupeEl.addEventListener('touchcancel', function(e) {
    paintLoupeAt(0, 0, 'end');
  }, { passive: false });
  $loupe.on('mousedown', function(e) {
    if (e.which !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    paintLoupeAt(e.clientX, e.clientY, 'start');
  });
  $loupe.on('dblclick', function(e) {
    if (!isPhoneLayout()) return;
    var cell = loupeCellFromPoint(e.clientX, e.clientY);
    if (!cell || !mapHasSettings(cell.x, cell.y)) return;
    e.preventDefault();
    e.stopPropagation();
    clearSettingsPaint();
    lastSettingsTap = null;
    settingsPointerDown = false;
    openSettingsAt(cell.x, cell.y);
  });
  loupeEl.addEventListener('wheel', function(e) {
    if (!isPhoneLayout()) return;
    e.preventDefault();
    e.stopPropagation();
    revealLoupeForNav(e.clientX, e.clientY);
    accumulateLoupePan(e.deltaX, e.deltaY, wheelAcc);
  }, { passive: false });

  $('#pngDrop').on('click', function(e) {
    if ($(this).hasClass('hasExportable')) return;
    e.preventDefault();
    document.getElementById('pngFileInput').click();
  });
  $('#jsonDrop').on('click', function(e) {
    if ($(this).hasClass('hasExportable')) return;
    e.preventDefault();
    document.getElementById('jsonFileInput').click();
  });

  document.addEventListener('gesturestart', function(e) {
    if ($(e.target).closest('#map').length) e.preventDefault();
  });
  document.addEventListener('gesturechange', function(e) {
    if ($(e.target).closest('#map').length) e.preventDefault();
  });

  (function setupPaletteLoop() {
    var el = document.getElementById('palette');
    if (!el) return;
    var track = el.querySelector('.palette-track');
    if (!track) return;
    var setWidth = 0;
    var animating = false;
    var scrollAnimFrame = null;

    function measure() {
      setWidth = track.scrollWidth / 3;
      return setWidth;
    }

    function refreshScale() {
      var tiles = el.querySelectorAll('.tilePaletteOption');
      for (var i = 0; i < tiles.length; i++) {
        tiles[i].style.transform = '';
        tiles[i].style.zIndex = tiles[i].classList.contains('palette-selected') ? '2' : '1';
      }
    }

    function jumpLoop() {
      if (animating) return;
      if (!setWidth) measure();
      if (setWidth < 8) return;
      if (el.scrollLeft <= 4) el.scrollLeft += setWidth;
      else if (el.scrollLeft >= setWidth * 2 - 4) el.scrollLeft -= setWidth;
    }

    function finishCenter() {
      animating = false;
      if (scrollAnimFrame) {
        cancelAnimationFrame(scrollAnimFrame);
        scrollAnimFrame = null;
      }
      jumpLoop();
      refreshScale();
    }

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function animateScrollTo(to, duration) {
      if (scrollAnimFrame) cancelAnimationFrame(scrollAnimFrame);
      var from = el.scrollLeft;
      var dist = to - from;
      var start = null;
      animating = true;
      function step(now) {
        if (start === null) start = now;
        var t = Math.min(1, (now - start) / duration);
        el.scrollLeft = from + dist * easeInOutCubic(t);
        if (t < 1) {
          scrollAnimFrame = requestAnimationFrame(step);
        } else {
          scrollAnimFrame = null;
          finishCenter();
        }
      }
      scrollAnimFrame = requestAnimationFrame(step);
    }

    function centerOnSelected(animate) {
      measure();
      var selected = el.querySelectorAll('.tilePaletteOption.palette-selected');
      if (!selected.length) {
        refreshScale();
        return;
      }
      var viewCenter = el.scrollLeft + el.clientWidth / 2;
      var target = selected[0];
      var best = Infinity;
      for (var i = 0; i < selected.length; i++) {
        var c = selected[i].offsetLeft + selected[i].offsetWidth / 2;
        var d = Math.abs(c - viewCenter);
        if (d < best) {
          best = d;
          target = selected[i];
        }
      }
      var left = target.offsetLeft - (el.clientWidth / 2) + (target.offsetWidth / 2);
      if (left < 0) left = 0;
      if (Math.abs(el.scrollLeft - left) < 2) {
        refreshScale();
        return;
      }
      if (animate === false) {
        el.scrollLeft = left;
        jumpLoop();
        refreshScale();
        return;
      }
      animateScrollTo(left, 850);
    }

    el.addEventListener('scroll', function() {
      if (!animating) jumpLoop();
      refreshScale();
    }, { passive: true });
    window.addEventListener('resize', function() {
      measure();
      centerOnSelected(false);
    });

    requestAnimationFrame(function() {
      measure();
      centerOnSelected(false);
    });

    window.TagproPalette = {
      refreshScale: refreshScale,
      centerOnSelected: centerOnSelected
    };
    window.TagproLoupe = {
      refresh: function() {
        if (loupeVisible) renderLoupe();
      }
    };
  })();
});
