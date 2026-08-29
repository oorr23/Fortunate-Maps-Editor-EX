$(function() {
  var LOUPE_TILES = 11;
  var LOUPE_CELL = 24;
  var LOUPE_SIZE = LOUPE_TILES * LOUPE_CELL;
  var LONG_PRESS_MS = 280;
  var HOLD_SLOP = 12;
  var SETTINGS_HIT_RADIUS_PX = 24;
  var SETTINGS_HOLD_MS = 750;
  var SAME_GESTURE_MS = 40;
  var GHOST_MOUSE_SLOP = 24;
  var GHOST_MOUSE_MS = 700;
  var PINCH_ZOOM_RATIO = 1.03;
  var PINCH_ZOOM_GAIN = 2.2;
  var LOUPE_STEP_PX = 40;
  var HAS_POINTER = typeof window.PointerEvent === 'function' || 'onpointerdown' in window;

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
  var pinchLive = null;
  var wheelPinchTimer = 0;
  var panPointer = null;
  var twoFingerPanning = false;
  var twoFingerOnLoupe = false;
  var lastPinchMid = null;
  var twoFingerAcc = { x: 0, y: 0 };
  var wheelAcc = { x: 0, y: 0 };
  var mouseLoupe = false;
  var ignorePaintUntil = 0;
  var settingsPointerDown = false;

  function isPhoneLayout() {
    if (window.TagproLayout && window.TagproLayout.isMobile) return window.TagproLayout.isMobile();
    return !document.documentElement.classList.contains('layout-desktop');
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
    if (window.TagproTools && TagproTools.centerOnActive) TagproTools.centerOnActive(false);
  });
  $('#layoutMobileBtn').on('click', function(e) {
    e.preventDefault();
    if (window.TagproLayout) TagproLayout.setOverride('mobile');
    closeMore();
    syncLayoutSwitcher();
    if (window.TagproTools && TagproTools.centerOnActive) TagproTools.centerOnActive(false);
  });
  $('#layoutDesktopBtn').on('click', function(e) {
    e.preventDefault();
    if (window.TagproLayout) TagproLayout.setOverride('desktop');
    closeMore();
    syncLayoutSwitcher();
    if (window.TagproTools && TagproTools.centerOnActive) TagproTools.centerOnActive(false);
  });

  document.documentElement.addEventListener('tagpro-layout', function() {
    finishLivePinch();
    if (!isPhoneLayout()) hideLoupe();
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

  var morePanelsEl = document.querySelector('.more-panels');
  var moreNavEl = document.querySelector('.more-nav');
  var moreDrag = null;
  var moreIgnoreClickUntil = 0;
  var moreSnapTimer = null;
  var moreSnapToken = 0;

  function isLandscapeChrome() {
    var root = document.documentElement;
    if (root.classList.contains('orient-landscape')) return true;
    if (root.classList.contains('orient-portrait')) return false;
    return !!(window.matchMedia && window.matchMedia('(orientation: landscape)').matches);
  }

  function chromeChanged() {
    if (!window.TagproMap || !TagproMap.getSize || !TagproMap.fitView) return;
    if (TagproMap.getSize().zoom === 0) TagproMap.fitView();
  }

  function setMorePanel(name, opts) {
    opts = opts || {};
    var current = $moreSheet.attr('data-open') || '';
    if (name && name === current && !opts.keep) name = '';
    $moreSheet.attr('data-open', name);
    $('.more-nav-btn').removeClass('active').attr('aria-expanded', 'false');
    $('.more-panel').attr('hidden', true);
    if (name) {
      $('.more-nav-btn[data-panel="' + name + '"]').addClass('active').attr('aria-expanded', 'true');
      $('.more-panel[data-panel="' + name + '"]').removeAttr('hidden');
    }
    if (!isLandscapeChrome()) chromeChanged();
  }

  function clearMoreOverlayTransform() {
    if (!morePanelsEl) return;
    morePanelsEl.style.transition = '';
    morePanelsEl.style.transform = '';
  }

  function syncLandscapeBackdrop() {
    if (!isLandscapeChrome()) {
      $moreBackdrop.css('bottom', '');
      return;
    }
    var sheet = $moreSheet[0];
    var h = sheet ? Math.round(sheet.getBoundingClientRect().height) : 0;
    $moreBackdrop.css('bottom', h + 'px');
  }

  function closeMore() {
    moreSnapToken += 1;
    if (moreSnapTimer) {
      clearTimeout(moreSnapTimer);
      moreSnapTimer = null;
    }
    setMorePanel('');
    $moreSheet.removeClass('open more-dragging');
    $moreBackdrop.removeClass('open').attr('hidden', true);
    $moreBackdrop.css('bottom', '');
    clearMoreOverlayTransform();
  }

  function openMore() {
    $moreSheet.addClass('open').removeClass('more-dragging');
    $moreBackdrop.addClass('open').removeAttr('hidden');
    syncLandscapeBackdrop();
    if (!$moreSheet.attr('data-open')) setMorePanel('file');
  }

  $('#moreToggle').on('click', function() {
    if ($moreSheet.hasClass('open')) closeMore();
    else openMore();
  });
  $('#moreClose, #moreBackdrop').on('click', closeMore);
  $('.more-nav-btn').on('click', function(e) {
    if (isLandscapeChrome() || Date.now() < moreIgnoreClickUntil) {
      e.preventDefault();
      return;
    }
    setMorePanel($(this).attr('data-panel'));
  });

  function moreEventPoint(e) {
    if (e.touches && e.touches[0]) return e.touches[0];
    if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0];
    return e;
  }

  function moreIgnoreTarget(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('input, textarea, select, a, button');
  }

  function morePanelNameFromEvent(e) {
    var el = e.target;
    if (!el || !el.closest) return '';
    var btn = el.closest('.more-nav-btn');
    return btn ? (btn.getAttribute('data-panel') || '') : '';
  }

  function moreOverlayHeight() {
    if (!morePanelsEl) return 220;
    var h = morePanelsEl.getBoundingClientRect().height;
    return h > 0 ? h : 220;
  }

  function setMoreOverlayY(y, dragging) {
    if (!morePanelsEl) return;
    if (dragging) {
      morePanelsEl.style.transition = 'none';
      morePanelsEl.style.transform = 'translateY(' + y + 'px)';
      return;
    }
    morePanelsEl.style.transition = 'transform 180ms ease-out';
    morePanelsEl.style.transform = 'translateY(' + y + 'px)';
  }

  function finishMoreOverlay(open, height) {
    if (!height) height = moreOverlayHeight();
    var token = ++moreSnapToken;
    $moreSheet.addClass('more-dragging');
    setMoreOverlayY(open ? 0 : height, false);
    function done() {
      if (token !== moreSnapToken) return;
      moreSnapToken += 1;
      if (moreSnapTimer) {
        clearTimeout(moreSnapTimer);
        moreSnapTimer = null;
      }
      if (morePanelsEl) morePanelsEl.removeEventListener('transitionend', done);
      if (open) {
        openMore();
        clearMoreOverlayTransform();
      } else {
        closeMore();
      }
    }
    if (morePanelsEl) morePanelsEl.addEventListener('transitionend', done);
    moreSnapTimer = setTimeout(done, 220);
  }

  function attachMoreFollow(kind) {
    function onMove(e) { moveMoreDrag(e); }
    function onFinish(e) { endMoreDrag(e); }
    moreDrag.onMove = onMove;
    moreDrag.onFinish = onFinish;
    moreDrag.kind = kind;
    if (kind === 'pointer') {
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onFinish, true);
      document.addEventListener('pointercancel', onFinish, true);
    } else if (kind === 'touch') {
      document.addEventListener('touchmove', onMove, { capture: true, passive: false });
      document.addEventListener('touchend', onFinish, true);
      document.addEventListener('touchcancel', onFinish, true);
    } else {
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onFinish, true);
    }
  }

  function detachMoreFollow() {
    if (!moreDrag || !moreDrag.onMove) return;
    var kind = moreDrag.kind;
    var onMove = moreDrag.onMove;
    var onFinish = moreDrag.onFinish;
    if (kind === 'pointer') {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onFinish, true);
      document.removeEventListener('pointercancel', onFinish, true);
    } else if (kind === 'touch') {
      document.removeEventListener('touchmove', onMove, true);
      document.removeEventListener('touchend', onFinish, true);
      document.removeEventListener('touchcancel', onFinish, true);
    } else {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onFinish, true);
    }
  }

  function blockingOverlayOpen() {
    return !!(document.body.classList.contains('tile-settings-open') || $('.modal.in:visible').length);
  }

  function beginMoreDrag(e, origin, panelName) {
    if (e.touches && e.touches.length > 1) return;
    if (blockingOverlayOpen()) return;
    var pt = moreEventPoint(e);
    moreDrag = {
      origin: origin,
      panelName: panelName || '',
      startX: pt.clientX,
      startY: pt.clientY,
      lastY: pt.clientY,
      lastT: Date.now(),
      vy: 0,
      moved: false,
      wasOpen: $moreSheet.hasClass('open'),
      startTranslate: 0,
      height: 0,
      pointerId: e.pointerId,
      captureEl: e.currentTarget
    };
  }

  function moveMoreDrag(e) {
    if (!moreDrag) return;
    if (e.touches && e.touches.length > 1) return;
    var pt = moreEventPoint(e);
    var dx = pt.clientX - moreDrag.startX;
    var dy = pt.clientY - moreDrag.startY;
    var now = Date.now();
    var dt = now - moreDrag.lastT;
    if (dt > 0) moreDrag.vy = (pt.clientY - moreDrag.lastY) / dt;
    moreDrag.lastY = pt.clientY;
    moreDrag.lastT = now;

    if (!moreDrag.moved) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) <= Math.abs(dx)) {
        detachMoreFollow();
        moreDrag = null;
        return;
      }
      if (moreDrag.origin === 'panel') {
        var scroller = morePanelsEl;
        if (scroller) {
          if (dy > 2 && scroller.scrollTop > 1) {
            detachMoreFollow();
            moreDrag = null;
            return;
          }
          if (dy < -2 && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1) {
            detachMoreFollow();
            moreDrag = null;
            return;
          }
        }
      }
      moreDrag.moved = true;
      var name = moreDrag.panelName || $moreSheet.attr('data-open') || 'file';
      setMorePanel(name, { keep: true });
      $moreSheet.addClass('more-dragging');
      $moreBackdrop.addClass('open').removeAttr('hidden');
      syncLandscapeBackdrop();
      moreDrag.height = moreOverlayHeight();
      moreDrag.startTranslate = moreDrag.wasOpen ? 0 : moreDrag.height;
    }
    if (e.cancelable) e.preventDefault();
    var y = moreDrag.startTranslate + dy;
    if (y < 0) y = 0;
    if (y > moreDrag.height) y = moreDrag.height;
    moreDrag.translateY = y;
    setMoreOverlayY(y, true);
  }

  function endMoreDrag(e) {
    if (!moreDrag) return;
    var drag = moreDrag;
    detachMoreFollow();
    moreDrag = null;
    if (drag.captureEl && drag.pointerId != null && drag.captureEl.releasePointerCapture) {
      try { drag.captureEl.releasePointerCapture(drag.pointerId); } catch (err) {}
    }
    if (!drag.moved) {
      $moreSheet.removeClass('more-dragging');
      if (!drag.wasOpen) $moreBackdrop.removeClass('open').attr('hidden', true);
      return;
    }
    moreIgnoreClickUntil = Date.now() + 350;
    ignorePaintUntil = Date.now() + 350;
    if (e && e.cancelable) e.preventDefault();
    var pt = moreEventPoint(e);
    var dy = pt.clientY - drag.startY;
    var y = drag.translateY;
    if (y == null) y = drag.startTranslate + dy;
    var height = drag.height || moreOverlayHeight();
    var threshold = Math.max(40, height * 0.3);
    var open;
    if (drag.vy < -0.4) open = true;
    else if (drag.vy > 0.4) open = false;
    else if (drag.wasOpen) open = y < threshold;
    else open = (height - y) > threshold;
    finishMoreOverlay(open, height);
  }

  function bindMoreOverlayDrag() {
    if (!moreNavEl || !morePanelsEl) return;

    function onStart(origin) {
      return function(e) {
        if (!isLandscapeChrome()) return;
        if (e.type === 'mousedown' && e.button !== 0) return;
        if (e.type === 'pointerdown' && e.button !== 0 && e.pointerType === 'mouse') return;
        if (origin === 'panel' && !$moreSheet.hasClass('open')) return;
        if (origin === 'panel' && moreIgnoreTarget(e.target)) return;
        var name = origin === 'nav' ? morePanelNameFromEvent(e) : ($moreSheet.attr('data-open') || '');
        if (origin === 'nav' && !name) return;
        beginMoreDrag(e, origin, name);
        if (!moreDrag) return;
        if (e.type.indexOf('pointer') === 0) {
          if (e.currentTarget && e.currentTarget.setPointerCapture && e.pointerId != null) {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
          }
          attachMoreFollow('pointer');
        } else if (e.type.indexOf('touch') === 0) {
          attachMoreFollow('touch');
        } else {
          attachMoreFollow('mouse');
        }
      };
    }

    if ('onpointerdown' in window) {
      moreNavEl.addEventListener('pointerdown', onStart('nav'));
      morePanelsEl.addEventListener('pointerdown', onStart('panel'));
    } else {
      moreNavEl.addEventListener('mousedown', onStart('nav'));
      moreNavEl.addEventListener('touchstart', onStart('nav'), { passive: true });
      morePanelsEl.addEventListener('mousedown', onStart('panel'));
      morePanelsEl.addEventListener('touchstart', onStart('panel'), { passive: true });
    }
  }

  bindMoreOverlayDrag();

  document.addEventListener('click', function(e) {
    if (Date.now() >= moreIgnoreClickUntil) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  $(document).on('keydown', function(e) {
    if (e.which !== 27) return;
    if (!$moreSheet.hasClass('open') && !$moreSheet.hasClass('more-dragging')) return;
    if (blockingOverlayOpen()) return;
    e.preventDefault();
    closeMore();
  });

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
  $('#tileSettingsBtn').on('click', function(e) {
    openFocusedTileSettings(e);
  });
  $('#tileSettingsBtn').on('pointerdown mousedown touchstart', function(e) {
    e.stopPropagation();
  });
  $map.on('mouseup', '.tile', function() {
    setTimeout(refreshTileSettingsControl, 0);
  });

  function isMousePointer(e) {
    return pointerKind(e) === 'mouse';
  }

  function preventIfTouch(e) {
    if (!isMousePointer(e) && e && e.cancelable !== false) e.preventDefault();
  }

  function isLoupeSettingsControl(el) {
    return !!(el && $(el).closest('#tileSettingsBtn').length);
  }

  function tileFromPoint(clientX, clientY) {
    var parkedLoupe = loupeVisible && !loupeFollow && !holdMovingLoupe && pointInLoupe(clientX, clientY);
    if (parkedLoupe) {
      var cell = loupeCellFromPoint(clientX, clientY);
      if (cell) return mapTileAt(cell.x, cell.y);
    }
    // Tracking: the work tile is the locked loupe center, not the map pixel under the finger.
    if (loupeFollow || holdMovingLoupe) {
      return mapTileAt(loupeCenterX, loupeCenterY);
    }
    if (window.TagproMap && TagproMap.tileAtClient) {
      var at = TagproMap.tileAtClient(clientX, clientY);
      if (at) return mapTileAt(at.x, at.y);
    }
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

  function mapIsZoomedIn() {
    return !!(window.TagproMap && TagproMap.isZoomedIn && TagproMap.isZoomedIn());
  }

  function brushIsSettingsDeploy() {
    var name = window.TagproMap && TagproMap.brushName && TagproMap.brushName();
    if (!name) return false;
    return name === 'switch'
      || name === 'portal' || name === 'exitPortal' || name === 'redPortal' || name === 'bluePortal'
      || name === 'redSpawn' || name === 'blueSpawn';
  }

  // Hold opens the dialog when zoomed in, or when the magnifier is already open.
  // Placing a portal/button/spawn still paints instead.
  function shouldOpenSettingsOnHold() {
    if (brushIsSettingsDeploy()) return false;
    if (mapIsZoomedIn()) return true;
    if (loupeVisible) return true;
    return false;
  }

  // Buttons are a 14px circle. A click on the neighboring gravity well
  // must still count if it is within SETTINGS_HIT_RADIUS_PX of the Button.
  function settingsCellFromClient(clientX, clientY) {
    if (clientX == null || clientY == null) return null;
    var $exact = tileFromPoint(clientX, clientY);
    if ($exact.length) {
      var ex = $exact.data('x');
      var ey = $exact.data('y');
      if (mapHasSettings(ex, ey)) return { x: ex, y: ey };
    }
    var size = window.TagproMap && TagproMap.getSize && TagproMap.getSize();
    if (!size || !window.TagproMap.tileElem) return null;
    var best = null;
    var bestD = SETTINGS_HIT_RADIUS_PX * SETTINGS_HIT_RADIUS_PX;
    var x, y, $el, el, r, dx, dy, d2;
    for (x = 0; x < size.width; x++) {
      for (y = 0; y < size.height; y++) {
        if (!mapHasSettings(x, y)) continue;
        $el = TagproMap.tileElem(x, y);
        el = $el && $el[0];
        if (!el) continue;
        r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        dx = r.left + r.width / 2 - clientX;
        dy = r.top + r.height / 2 - clientY;
        d2 = dx * dx + dy * dy;
        if (d2 <= bestD) {
          bestD = d2;
          best = { x: x, y: y };
        }
      }
    }
    return best;
  }

  function openSettingsAt(x, y) {
    return !!(window.TagproMap && TagproMap.openTileSettings && TagproMap.openTileSettings(x, y));
  }

  var lastOpenSettingsAt = 0;
  var lastOpenSettingsCell = null;
  var rememberedSettingsCell = null;
  var pendingOpenSettingsTimer = 0;
  var OPEN_SETTINGS_DEBOUNCE_MS = 80;

  function settingsDialogIsOpen() {
    return !!(document.body && document.body.classList.contains('tile-settings-open'));
  }

  function rememberSettingsCell(x, y) {
    if (x == null || y == null || isNaN(x) || isNaN(y)) return;
    if (!mapHasSettings(x, y)) return;
    rememberedSettingsCell = { x: Number(x), y: Number(y) };
  }

  function forgetSettingsCellIfStale() {
    if (!rememberedSettingsCell) return;
    if (!mapHasSettings(rememberedSettingsCell.x, rememberedSettingsCell.y)) {
      rememberedSettingsCell = null;
    }
  }

  function commitOpenSettings(x, y, fromNativeDblclick) {
    if (pendingOpenSettingsTimer) {
      clearTimeout(pendingOpenSettingsTimer);
      pendingOpenSettingsTimer = 0;
    }
    clearSettingsPaint();
    settingsPointerDown = false;
    parkedLoupePending = null;
    clearLongPress();
    rememberSettingsCell(x, y);
    var now = Date.now();
    var sameCell = lastOpenSettingsCell
      && lastOpenSettingsCell.x === x
      && lastOpenSettingsCell.y === y;
    // Native dblclick / the two-click debounce may follow a still click
    // that already opened this cell. Do not open twice. Closing then
    // clicking Tile (or the map) is a new gesture because the dialog is gone.
    var companion = sameCell && (now - lastOpenSettingsAt) < OPEN_SETTINGS_DEBOUNCE_MS;
    if (fromNativeDblclick && companion) {
      hideLoupe();
      refreshTileSettingsControl();
      return true;
    }
    if (sameCell && settingsDialogIsOpen()) {
      hideLoupe();
      refreshTileSettingsControl();
      return true;
    }
    lastOpenSettingsAt = now;
    lastOpenSettingsCell = { x: x, y: y };
    openSettingsAt(x, y);
    hideLoupe();
    refreshTileSettingsControl();
    return true;
  }

  function noteSettingsFocus(x, y) {
    rememberSettingsCell(x, y);
    lastSettingsTap = { t: Date.now(), x: x, y: y };
    refreshTileSettingsControl();
  }

  function loupeTapCell(clientX, clientY) {
    var cell = loupeCellFromPoint(clientX, clientY);
    if (cell) return cell;
    if (mapHasSettings(loupeCenterX, loupeCenterY)) {
      return { x: loupeCenterX, y: loupeCenterY };
    }
    return null;
  }

  function settingsCoordsAt(clientX, clientY) {
    if (isPasteTool()) return null;
    if (loupeVisible && !loupeFollow && !holdMovingLoupe && pointInLoupe(clientX, clientY)) {
      return loupeTapCell(clientX, clientY);
    }
    return settingsCellFromClient(clientX, clientY);
  }

  function consumeSettingsPointer(clientX, clientY) {
    if (!shouldOpenSettingsOnHold()) return false;
    var cell = settingsCoordsAt(clientX, clientY);
    if (!cell) return false;
    settingsPointerDown = true;
    suppressLoupe = true;
    pendingDismiss = false;
    holdStart = { clientX: clientX, clientY: clientY };
    lastPointer = { x: clientX, y: clientY };
    var $tile = mapTileAt(cell.x, cell.y);
    captureLoupeFocusTile($tile);
    noteSettingsFocus(cell.x, cell.y);
    if ($tile.length) armSettingsPaint($tile, clientX, clientY);
    return true;
  }

  function focusedSettingsCell() {
    forgetSettingsCellIfStale();
    if (loupeVisible && mapHasSettings(loupeCenterX, loupeCenterY)) {
      return { x: loupeCenterX, y: loupeCenterY };
    }
    if (loupeFocusTile && mapHasSettings(loupeFocusTile.x, loupeFocusTile.y)) {
      return { x: loupeFocusTile.x, y: loupeFocusTile.y };
    }
    if (rememberedSettingsCell && mapHasSettings(rememberedSettingsCell.x, rememberedSettingsCell.y)) {
      return { x: rememberedSettingsCell.x, y: rememberedSettingsCell.y };
    }
    if (lastSettingsTap && mapHasSettings(lastSettingsTap.x, lastSettingsTap.y)) {
      return { x: lastSettingsTap.x, y: lastSettingsTap.y };
    }
    if (lastOpenSettingsCell && mapHasSettings(lastOpenSettingsCell.x, lastOpenSettingsCell.y)) {
      return { x: lastOpenSettingsCell.x, y: lastOpenSettingsCell.y };
    }
    return null;
  }

  function refreshTileSettingsControl() {
    var cell = focusedSettingsCell();
    var on = !!cell;
    var $dock = $('#tileSettingsBtn');
    $dock.prop('disabled', !on).attr('aria-disabled', on ? 'false' : 'true');
    $dock.toggleClass('has-settings', on);
  }

  function openFocusedTileSettings(e) {
    if (e) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    }
    var cell = focusedSettingsCell();
    if (!cell) return false;
    return commitOpenSettings(cell.x, cell.y);
  }

  // Remember the cell now; insert the dialog after this gesture's leftover
  // click has targeted the map. Chromium: pointerup → mouseup → click (map)
  // → timeout (show).
  function queueOpenSettings(x, y) {
    rememberSettingsCell(x, y);
    refreshTileSettingsControl();
    if (pendingOpenSettingsTimer) clearTimeout(pendingOpenSettingsTimer);
    pendingOpenSettingsTimer = setTimeout(function() {
      pendingOpenSettingsTimer = 0;
      commitOpenSettings(x, y);
      if (settingsHoldOpened) syncSettingsModalGuard(Date.now() + 120000);
    }, 0);
    return true;
  }

  function triggerTile($tile, type) {
    if (!$tile || !$tile.length) return;
    var ev = $.Event(type, { which: 1, button: 0, bubbles: true });
    ev.tagproFromLoupe = true;
    $tile.trigger(ev);
  }

  var loupeFollow = false;
  var loupePainting = false;
  var loupeOriginX = 0;
  var loupeOriginY = 0;
  // Work tile = yellow crosshair. Only setLoupeWorkTile / stepLoupeFollow may change these
  // while following — never tileAtClient / elementFromPoint (unmagnified map).
  var loupeCenterX = 0;
  var loupeCenterY = 0;
  var loupeCells = [];
  var loupeGrid = null;
  var loupeRaf = 0;
  var pendingDismiss = false;
  var holdMovingLoupe = false;
  var holdStart = null;
  var lastPointer = { x: 0, y: 0 };
  var loupeFocusTile = null;
  var loupeFollowAcc = { x: 0, y: 0 };
  var loupeFollowOrigin = null;
  var lastTouchAt = 0;
  var lastHandledDown = null;
  var lastSettingsTap = null;
  var suppressLoupe = false;
  var pendingSettingsPaint = null;
  var parkedLoupePending = null;
  var settingsModalGuardUntil = 0;
  var settingsHoldTimer = 0;
  var settingsHoldOpened = false;

  function armSettingsModalGuard(until) {
    settingsModalGuardUntil = until || (Date.now() + 500);
  }

  function syncSettingsModalGuard(until) {
    armSettingsModalGuard(until);
    if (window.TagproMap && TagproMap.armSettingsModalGuard) {
      TagproMap.armSettingsModalGuard(until);
    }
  }

  function isGuardedTileSettingsTarget(el) {
    if (!el) return false;
    if (el.id === 'tileSettingsBackdrop') return true;
    if (el.closest) {
      if (el.closest('#tileSettingsBackdrop, .tile-settings-backdrop, .modal-backdrop')) return true;
      if (el.closest('.tile-settings-dialog')) return true;
      if (el.closest('[data-dismiss="tile-settings"]')) return true;
    }
    if (!el.classList) return false;
    return el.classList.contains('tile-settings-backdrop') || el.classList.contains('modal-backdrop');
  }

  function swallowGuardedTileSettingsEvent(e) {
    if (!settingsModalGuardUntil || Date.now() >= settingsModalGuardUntil) return;
    if (!isGuardedTileSettingsTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }

  document.addEventListener('click', swallowGuardedTileSettingsEvent, true);
  document.addEventListener('pointerdown', swallowGuardedTileSettingsEvent, true);
  document.addEventListener('pointerup', swallowGuardedTileSettingsEvent, true);

  function clearSettingsHoldTimer() {
    if (settingsHoldTimer) {
      clearTimeout(settingsHoldTimer);
      settingsHoldTimer = 0;
    }
  }

  function clearSettingsPaint() {
    clearSettingsHoldTimer();
    pendingSettingsPaint = null;
  }

  function openSettingsFromHold(x, y) {
    if (!shouldOpenSettingsOnHold()) return;
    settingsHoldOpened = true;
    parkedLoupePending = null;
    syncSettingsModalGuard(Date.now() + 120000);
    queueOpenSettings(x, y);
  }

  // Arm a settings-tile stroke. Hold still 0.75s to open settings (opens then,
  // not on release). Tap or drag paints.
  function armSettingsPaint($tile, clientX, clientY) {
    clearSettingsPaint();
    settingsHoldOpened = false;
    if (!$tile || !$tile.length) return;
    var x = $tile.data('x');
    var y = $tile.data('y');
    pendingSettingsPaint = {
      $tile: $tile,
      clientX: clientX,
      clientY: clientY,
      t: Date.now(),
      x: x,
      y: y
    };
    settingsHoldTimer = setTimeout(function() {
      settingsHoldTimer = 0;
      if (painting || !pendingSettingsPaint) return;
      if (pendingSettingsPaint.x !== x || pendingSettingsPaint.y !== y) return;
      openSettingsFromHold(x, y);
    }, SETTINGS_HOLD_MS);
  }

  function settingsStrokeLeftCell(clientX, clientY, $start) {
    if (!$start || !$start.length) return false;
    var sx = $start.data('x');
    var sy = $start.data('y');
    var near = settingsCellFromClient(clientX, clientY);
    if (near && near.x === sx && near.y === sy) return false;
    var $end = tileFromPoint(clientX, clientY);
    if (!$end.length) return false;
    return $end.data('x') !== sx || $end.data('y') !== sy;
  }

  // Hold still 0.75s: open settings (timer, not release). Tap or drag: paint.
  function finishSettingsPointer(clientX, clientY) {
    settingsPointerDown = false;
    if (settingsHoldOpened) {
      settingsHoldOpened = false;
      clearSettingsHoldTimer();
      clearSettingsPaint();
      suppressLoupe = false;
      holdStart = null;
      parkedLoupePending = null;
      syncSettingsModalGuard(Date.now() + 500);
      return true;
    }
    if (painting || !pendingSettingsPaint) return false;
    var $tile = pendingSettingsPaint.$tile;
    var startX = pendingSettingsPaint.clientX;
    var startY = pendingSettingsPaint.clientY;
    var x = $tile && $tile.data('x');
    var y = $tile && $tile.data('y');
    if (clientX != null && clientY != null && settingsStrokeLeftCell(clientX, clientY, $tile)) {
      clearSettingsPaint();
      if ($tile && $tile.length) beginPaintAtTile($tile, clientX, clientY, false);
      return true;
    }
    clearSettingsPaint();
    suppressLoupe = false;
    holdStart = null;
    parkedLoupePending = null;
    if (x == null || y == null || !mapHasSettings(x, y)) return false;
    rememberSettingsCell(x, y);
    refreshTileSettingsControl();
    if ($tile && $tile.length) {
      var px = clientX != null ? clientX : startX;
      var py = clientY != null ? clientY : startY;
      beginPaintAtTile($tile, px, py, false);
      endPaint(px, py);
    }
    return true;
  }

  function hideLoupe() {
    loupeVisible = false;
    loupeFollow = false;
    loupePainting = false;
    painting = false;
    mouseLoupe = false;
    pendingDismiss = false;
    holdMovingLoupe = false;
    holdStart = null;
    suppressLoupe = false;
    loupeFocusTile = null;
    lastTileEl = null;
    parkedLoupePending = null;
    loupeFollowAcc.x = 0;
    loupeFollowAcc.y = 0;
    loupeFollowOrigin = null;
    clearSettingsPaint();
    if (loupeRaf) {
      cancelAnimationFrame(loupeRaf);
      loupeRaf = 0;
    }
    $loupe.removeClass('visible follow-finger').attr('aria-hidden', 'true');
    if (window.TagproMap && TagproMap.highlightClipboardSource) {
      TagproMap.highlightClipboardSource();
    }
    refreshTileSettingsControl();
  }

  function showLoupe() {
    loupeVisible = true;
    $loupe.toggleClass('follow-finger', !!loupeFollow && !holdMovingLoupe);
    $loupe.addClass('visible').attr('aria-hidden', 'false');
    refreshTileSettingsControl();
  }

  function stopLoupeFollow() {
    loupeFollow = false;
    holdMovingLoupe = false;
    loupeFollowOrigin = null;
    $loupe.removeClass('follow-finger');
  }

  function noteTouch() {
    lastTouchAt = Date.now();
  }

  function nativeEvent(e) {
    return (e && e.originalEvent) || e;
  }

  function pointerKind(e) {
    var oe = nativeEvent(e);
    if (oe && oe.pointerType) return oe.pointerType;
    var type = (e && e.type) || (oe && oe.type) || '';
    if (type.indexOf('touch') === 0) return 'touch';
    if (type.indexOf('mouse') === 0) return 'mouse';
    return '';
  }

  function pointerClient(e) {
    var oe = nativeEvent(e) || {};
    var t = (oe.touches && oe.touches[0]) || (oe.changedTouches && oe.changedTouches[0]);
    if (t) return { x: t.clientX, y: t.clientY };
    return { x: oe.clientX, y: oe.clientY };
  }

  function isPrimaryPointer(e) {
    var oe = nativeEvent(e);
    if (!oe) return false;
    if (oe.isPrimary === false) return false;
    var kind = pointerKind(e);
    if (kind === 'mouse' || ((e.type || '').indexOf('mouse') === 0)) {
      if (oe.button != null && oe.button !== 0) return false;
      if (e.which != null && e.which !== 1 && (e.type || '').indexOf('mouse') === 0) return false;
    }
    return true;
  }

  function markHandledDown(e, prevented) {
    var pt = pointerClient(e);
    var oe = nativeEvent(e);
    lastHandledDown = {
      t: Date.now(),
      x: pt.x,
      y: pt.y,
      id: oe && oe.pointerId,
      kind: pointerKind(e),
      prevented: !!prevented
    };
    if (lastHandledDown.kind === 'touch') lastTouchAt = lastHandledDown.t;
  }

  function pointsNear(ax, ay, bx, by, slop) {
    var dx = ax - bx;
    var dy = ay - by;
    return (dx * dx + dy * dy) <= (slop * slop);
  }

  function isGhostCompatibilityMouse(e) {
    if (!e) return false;
    var oe = nativeEvent(e);
    var kind = pointerKind(e);
    var type = e.type || (oe && oe.type) || '';
    if (kind === 'touch' && type.indexOf('mouse') === -1) return false;
    var mouseLike = kind === 'mouse' || type.indexOf('mouse') === 0;
    if (!mouseLike) return false;
    if (!lastHandledDown || lastHandledDown.kind !== 'touch') return false;
    var pt = pointerClient(e);
    if (pt.x == null || pt.y == null) return false;
    if (!pointsNear(pt.x, pt.y, lastHandledDown.x, lastHandledDown.y, GHOST_MOUSE_SLOP)) return false;
    var dt = Date.now() - lastHandledDown.t;
    if (dt > GHOST_MOUSE_MS) return false;
    if (dt <= SAME_GESTURE_MS) return true;
    var firesTouch = !!(oe.sourceCapabilities && oe.sourceCapabilities.firesTouchEvents);
    if (!firesTouch) return false;
    if (type === 'mousedown' || type === 'mouseup' || type === 'click') lastHandledDown = null;
    return true;
  }

  function isDuplicatePrimaryDown(e) {
    var type = e.type || '';
    if (type.indexOf('down') === -1 && type.indexOf('start') === -1) return false;
    if (!lastHandledDown) return false;
    var dt = Date.now() - lastHandledDown.t;
    if (dt > SAME_GESTURE_MS) return false;
    var pt = pointerClient(e);
    if (pt.x == null || pt.y == null) return false;
    if (!pointsNear(pt.x, pt.y, lastHandledDown.x, lastHandledDown.y, GHOST_MOUSE_SLOP)) return false;
    var oe = nativeEvent(e);
    if (oe && lastHandledDown.id != null && oe.pointerId != null && oe.pointerId === lastHandledDown.id) return true;
    return type.indexOf('mouse') === 0 || type.indexOf('touch') === 0 || type.indexOf('pointer') === 0;
  }

  function shouldIgnoreCompatPointer(e) {
    if (isGhostCompatibilityMouse(e)) return true;
    var type = e.type || '';
    if (type.indexOf('move') !== -1) return false;
    return isDuplicatePrimaryDown(e);
  }

  // Ghost touch-emulated mouse may still be cancelled. A mouse mousedown that
  // is only a duplicate of pointerdown must not preventDefault — Chromium
  // may then drop click/dblclick. Still stopPropagation so the jQuery loupe
  // handler does not start a second stroke.
  function ignoreCompatPointer(e) {
    if (!e) return;
    var type = e.type || '';
    var mouseDownDup = pointerKind(e) === 'mouse' && type.indexOf('mouse') === 0 && !isGhostCompatibilityMouse(e);
    if (!mouseDownDup && e.cancelable !== false) e.preventDefault();
    e.stopPropagation();
  }

  function isEmulatedMouse(e) {
    return isGhostCompatibilityMouse(e);
  }

  function captureLoupeFocusTile($tile) {
    loupeFocusTile = null;
    if (!$tile || !$tile.length) return;
    var x = $tile.data('x');
    var y = $tile.data('y');
    if (x == null || y == null || isNaN(x) || isNaN(y)) return;
    loupeFocusTile = { x: Number(x), y: Number(y) };
    rememberSettingsCell(x, y);
    refreshTileSettingsControl();
  }

  function activeDockToolId() {
    return ($('#tools .btn.active').first().attr('data-tool-id') || '');
  }

  function isPasteTool() {
    return activeDockToolId() === 'toolPaste';
  }

  function paintThroughParkedLoupe() {
    var id = activeDockToolId();
    return id === 'toolCopy' || id === 'toolCut';
  }

  function previewPasteAtLoupeCenter() {
    if (!isPasteTool()) return;
    if (window.TagproMap && TagproMap.previewPasteAt) {
      TagproMap.previewPasteAt(loupeCenterX, loupeCenterY);
    }
  }

  function beginPasteAimAt(x, y, clientX, clientY) {
    pendingDismiss = false;
    holdMovingLoupe = true;
    loupeFollow = true;
    recenterLoupeOn(x, y, clientX, clientY);
    showLoupe();
    previewPasteAtLoupeCenter();
  }

  function tapAimPasteAt(x, y, clientX, clientY) {
    pendingDismiss = false;
    holdMovingLoupe = false;
    recenterLoupeOn(x, y, clientX, clientY);
    showLoupe();
    previewPasteAtLoupeCenter();
  }

  function beginParkedMapPaint(clientX, clientY) {
    var $tile = tileFromPoint(clientX, clientY);
    if (!$tile.length) return false;
    pendingDismiss = false;
    holdMovingLoupe = false;
    clearLongPress();
    beginPaintAtTile($tile, clientX, clientY, true);
    return true;
  }

  function beginOutsideLoupePointer(clientX, clientY) {
    hideLoupe();
    pendingDismiss = false;
    holdMovingLoupe = false;
    parkedLoupePending = null;
    painting = false;
    loupePainting = false;
    lastTileEl = null;
    if (window.TagproMap && TagproMap.lockPasteInput) TagproMap.lockPasteInput();
    holdStart = { clientX: clientX, clientY: clientY };
    lastPointer = { x: clientX, y: clientY };
    loupeFollowAcc.x = 0;
    loupeFollowAcc.y = 0;
    clearLongPress();
    if (!shouldOpenSettingsOnHold()) return;
    var cell = settingsCellFromClient(clientX, clientY);
    if (!cell) return;
    var $tile = mapTileAt(cell.x, cell.y);
    captureLoupeFocusTile($tile);
    noteSettingsFocus(cell.x, cell.y);
    suppressLoupe = true;
    armSettingsPaint($tile, clientX, clientY);
  }

  function pointInLoupe(clientX, clientY) {
    if (!loupeVisible) return false;
    var r = $loupe[0].getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function mapTileAt(x, y) {
    if (window.TagproMap && TagproMap.tileElem) {
      var $fromMap = TagproMap.tileElem(x, y);
      if ($fromMap && $fromMap.length) return $fromMap;
    }
    var rows = mapEl.querySelectorAll('.tileRow');
    var row = rows[y];
    if (!row || x < 0 || x >= row.children.length) return $();
    return $(row.children[x]).find('.tile').first();
  }

  function setLoupeWorkTile(x, y) {
    if (x == null || y == null || isNaN(x) || isNaN(y)) return;
    loupeCenterX = Number(x);
    loupeCenterY = Number(y);
    clampLoupeCenter();
    loupeFocusTile = { x: loupeCenterX, y: loupeCenterY };
    refreshTileSettingsControl();
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
          "<div class='topSquare nestedSquare'></div>" +
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
    if (clientX == null || clientY == null || isNaN(clientX) || isNaN(clientY)) return;
    $loupe.css({
      left: clientX + 'px',
      top: clientY + 'px',
      width: LOUPE_SIZE + 'px',
      height: LOUPE_SIZE + 'px'
    });
  }

  function setLoupeFollowOrigin(pointerX, pointerY, centerX, centerY) {
    loupeFollowOrigin = {
      pointerX: pointerX,
      pointerY: pointerY,
      centerX: centerX,
      centerY: centerY
    };
    loupeFollowAcc.x = 0;
    loupeFollowAcc.y = 0;
  }

  function followLoupePointer(clientX, clientY, prevX, prevY) {
    if (clientX == null || clientY == null || isNaN(clientX) || isNaN(clientY)) return;
    if (prevX == null) prevX = lastPointer.x;
    if (prevY == null) prevY = lastPointer.y;
    lastPointer = { x: clientX, y: clientY };
    accumulateLoupeFollow(clientX - prevX, clientY - prevY);
    positionLoupe(clientX, clientY);
  }

  function syncPaintToLoupeCenter() {
    if (!painting || loupePainting) return;
    var $tile = mapTileAt(loupeCenterX, loupeCenterY);
    if (!$tile.length) return;
    if (lastTileEl && lastTileEl !== $tile[0]) {
      triggerTile($(lastTileEl), 'mouseleave');
      triggerTile($tile, 'mouseenter');
    }
    triggerTile($tile, 'mousemove');
    lastTileEl = $tile[0];
  }

  function stepLoupeFollow(dx, dy) {
    if (!dx && !dy) return;
    setLoupeWorkTile(loupeCenterX + dx, loupeCenterY + dy);
    requestLoupeStamp();
    if (isPasteTool() && !painting) previewPasteAtLoupeCenter();
    else syncPaintToLoupeCenter();
  }

  function accumulateLoupeFollow(dx, dy) {
    var acc = loupeFollowAcc;
    acc.x += dx;
    acc.y += dy;
    var sx = 0;
    var sy = 0;
    while (acc.x >= LOUPE_CELL) { sx += 1; acc.x -= LOUPE_CELL; }
    while (acc.x <= -LOUPE_CELL) { sx -= 1; acc.x += LOUPE_CELL; }
    while (acc.y >= LOUPE_CELL) { sy += 1; acc.y -= LOUPE_CELL; }
    while (acc.y <= -LOUPE_CELL) { sy -= 1; acc.y += LOUPE_CELL; }
    if (sx || sy) stepLoupeFollow(sx, sy);
  }

  function activateLoupeFollowFinger(clientX, clientY) {
    if (suppressLoupe) return;
    if ((clientX == null || isNaN(clientX) || clientY == null || isNaN(clientY)) && holdStart) {
      clientX = holdStart.clientX;
      clientY = holdStart.clientY;
    }
    if (loupeVisible && loupeFollow && loupeFollowOrigin) {
      followLoupePointer(clientX, clientY);
      return;
    }
    if (loupeFocusTile) setLoupeWorkTile(loupeFocusTile.x, loupeFocusTile.y);
    else clampLoupeCenter();
    var ox = (holdStart && holdStart.clientX != null) ? holdStart.clientX : clientX;
    var oy = (holdStart && holdStart.clientY != null) ? holdStart.clientY : clientY;
    setLoupeFollowOrigin(ox, oy, loupeCenterX, loupeCenterY);
    loupeFollow = true;
    positionLoupe(clientX, clientY);
    stampLoupeNow();
    // Mouse path never sets `painting`; copy/cut/draw still have map.js mouseDown.
    // Adopt that gesture so follow uses the work tile, not unmagnified hit-tests.
    if (!painting && !loupePainting && !isPasteTool()) {
      var $adopt = mapTileAt(loupeCenterX, loupeCenterY);
      if ($adopt.length) {
        painting = true;
        if (!lastTileEl) lastTileEl = $adopt[0];
      }
    }
    if (isPasteTool() && !painting) previewPasteAtLoupeCenter();
    else syncPaintToLoupeCenter();
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
    setLoupeWorkTile(loupeCenterX + dx, loupeCenterY + dy);
    stopLoupeFollow();
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
          setLoupeWorkTile(x, y);
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
    suppressLoupe = !allowLoupe;
    lastTileEl = $tile[0];
    triggerTile($tile, 'mousedown');
    triggerTile($tile, 'mouseenter');
    holdStart = { clientX: clientX, clientY: clientY };
    lastPointer = { x: clientX, y: clientY };
    captureLoupeFocusTile($tile);
    loupeFollowAcc.x = 0;
    loupeFollowAcc.y = 0;
    clearLongPress();
    if (allowLoupe) {
      longPressTimer = setTimeout(function() {
        activateLoupeFollowFinger(lastPointer.x, lastPointer.y);
      }, LONG_PRESS_MS);
    }
  }

  function endLoupePaint() {
    if (lastTileEl) triggerTile($(lastTileEl), 'mouseup');
    loupePainting = false;
    painting = false;
    lastTileEl = null;
    if (loupeVisible) renderLoupe();
  }

  function paintLoupeAt(clientX, clientY, phase) {
    if (phase === 'end') {
      endLoupePaint();
      return true;
    }
    var cell = loupeCellFromPoint(clientX, clientY);
    if (!cell) return false;
    var $tile = mapTileAt(cell.x, cell.y);
    if (!$tile.length) return false;
    if (phase === 'start') {
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
    activateLoupeFollowFinger(clientX, clientY);
  }

  function recenterLoupeOn(x, y, clientX, clientY) {
    setLoupeWorkTile(x, y);
    loupeFollowAcc.x = 0;
    loupeFollowAcc.y = 0;
    if (clientX != null && clientY != null && !isNaN(clientX) && !isNaN(clientY)) {
      positionLoupe(clientX, clientY);
      setLoupeFollowOrigin(clientX, clientY, loupeCenterX, loupeCenterY);
    }
    stampLoupeNow();
  }

  function startFollowPaintAtCenter() {
    var $tile = mapTileAt(loupeCenterX, loupeCenterY);
    if (!$tile.length) return;
    painting = true;
    loupePainting = false;
    lastTileEl = $tile[0];
    triggerTile($tile, 'mousedown');
    triggerTile($tile, 'mouseenter');
    captureLoupeFocusTile($tile);
    stampLoupeNow();
  }

  function startParkedLoupePointer(clientX, clientY, e) {
    closeMore();
    pendingDismiss = false;
    holdMovingLoupe = false;
    clearSettingsPaint();
    var cell = loupeTapCell(clientX, clientY);
    if (!cell) return;
    parkedLoupePending = { x: cell.x, y: cell.y, clientX: clientX, clientY: clientY, t: Date.now() };
    holdStart = { clientX: clientX, clientY: clientY };
    lastPointer = { x: clientX, y: clientY };
    captureLoupeFocusTile(mapTileAt(cell.x, cell.y));
    clearLongPress();
    if (mapHasSettings(cell.x, cell.y) && shouldOpenSettingsOnHold()) {
      noteSettingsFocus(cell.x, cell.y);
      armSettingsPaint(mapTileAt(cell.x, cell.y), clientX, clientY);
      return;
    }
    longPressTimer = setTimeout(function() {
      if (!parkedLoupePending) return;
      var p = parkedLoupePending;
      parkedLoupePending = null;
      if (isPasteTool()) {
        beginPasteAimAt(p.x, p.y, lastPointer.x, lastPointer.y);
        startFollowPaintAtCenter();
        return;
      }
      beginHoldReposition(lastPointer.x, lastPointer.y);
    }, LONG_PRESS_MS);
  }

  function moveParkedLoupePointer(clientX, clientY, prevX, prevY) {
    if (prevX == null) prevX = lastPointer.x;
    if (prevY == null) prevY = lastPointer.y;
    lastPointer = { x: clientX, y: clientY };
    if (holdMovingLoupe) {
      followLoupePointer(clientX, clientY, prevX, prevY);
      return;
    }
    if (parkedLoupePending && movedPastSlop(clientX, clientY)) {
      clearLongPress();
      clearSettingsPaint();
      var p = parkedLoupePending;
      parkedLoupePending = null;
      if (isPasteTool()) {
        beginPasteAimAt(p.x, p.y, clientX, clientY);
        startFollowPaintAtCenter();
        return;
      }
      paintLoupeAt(p.clientX, p.clientY, 'start');
      paintLoupeAt(clientX, clientY, 'move');
      return;
    }
    if (loupePainting) paintLoupeAt(clientX, clientY, 'move');
  }

  function endParkedLoupePointer(clientX, clientY) {
    clearLongPress();
    if (settingsHoldOpened || pendingSettingsPaint) {
      finishSettingsPointer(clientX, clientY);
      return;
    }
    if (parkedLoupePending) {
      var p = parkedLoupePending;
      parkedLoupePending = null;
      if (isPasteTool()) {
        tapAimPasteAt(p.x, p.y, clientX != null ? clientX : p.clientX, clientY != null ? clientY : p.clientY);
        return;
      }
      var cell = loupeTapCell(clientX != null ? clientX : p.clientX, clientY != null ? clientY : p.clientY);
      if (!cell) cell = { x: p.x, y: p.y };
      paintLoupeAt(p.clientX, p.clientY, 'start');
      endLoupePaint();
      return;
    }
    if (loupePainting) {
      endLoupePaint();
      return;
    }
    if (holdMovingLoupe || (painting && !loupePainting)) {
      endPaint(clientX, clientY);
    }
  }

  function movedPastSlop(clientX, clientY) {
    if (!holdStart) return false;
    var dx = clientX - holdStart.clientX;
    var dy = clientY - holdStart.clientY;
    return (dx * dx + dy * dy) >= (HOLD_SLOP * HOLD_SLOP);
  }

  function endPaint(clientX, clientY) {
    clearLongPress();
    var dismiss = pendingDismiss;
    if (!dismiss && painting && !loupePainting) {
      var $tile = lastTileEl ? $(lastTileEl) : tileFromPoint(clientX, clientY);
      triggerTile($tile, 'mouseup');
    }
    painting = false;
    lastTileEl = null;
    stopLoupeFollow();
    if (dismiss) {
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

  function bothTouchesOnLoupe(t0, t1) {
    return !!(loupeVisible &&
      pointInLoupe(t0.clientX, t0.clientY) &&
      pointInLoupe(t1.clientX, t1.clientY));
  }

  function beginTwoFingerGesture(t0, t1) {
    clearLongPress();
    clearSettingsPaint();
    parkedLoupePending = null;
    if (lastTileEl) triggerTile($(lastTileEl), 'mouseup');
    lastTileEl = null;
    painting = false;
    loupePainting = false;
    stopLoupeFollow();
    panPointer = null;
    twoFingerPanning = true;
    holdStart = null;
    pendingDismiss = false;
    if (wheelPinchTimer) {
      clearTimeout(wheelPinchTimer);
      wheelPinchTimer = 0;
    }
    pinchLive = null;
    lastPinchMid = pinchMidpoint(t0, t1);
    twoFingerAcc.x = 0;
    twoFingerAcc.y = 0;
    pinchLastZoomAt = pinchDistance(t0, t1);
    twoFingerOnLoupe = bothTouchesOnLoupe(t0, t1);
    pinchLive = null;
    if (isPhoneLayout() && !twoFingerOnLoupe && window.TagproMap && TagproMap.beginFocalZoom && lastPinchMid) {
      pinchLive = {
        startDist: pinchLastZoomAt,
        focal: TagproMap.beginFocalZoom(lastPinchMid.x, lastPinchMid.y)
      };
    }
    if (!isPhoneLayout() && !twoFingerOnLoupe) hideLoupe();
  }

  function handleTwoFingerMove(t0, t1) {
    var mid = pinchMidpoint(t0, t1);
    if (twoFingerOnLoupe) {
      if (lastPinchMid) {
        accumulateLoupePan(mid.x - lastPinchMid.x, mid.y - lastPinchMid.y, twoFingerAcc);
      }
      lastPinchMid = mid;
      return;
    }
    if (lastPinchMid && !pinchLive) {
      mapEl.scrollLeft += lastPinchMid.x - mid.x;
      mapEl.scrollTop += lastPinchMid.y - mid.y;
    }
    lastPinchMid = mid;
    var dist = pinchDistance(t0, t1);
    if (isPhoneLayout() && pinchLive && pinchLive.startDist && pinchLive.focal && window.TagproMap && TagproMap.setFocalZoom) {
      TagproMap.setFocalZoom(pinchLive.focal, pinchLive.focal.baseScale * Math.pow(dist / pinchLive.startDist, PINCH_ZOOM_GAIN), mid.x, mid.y);
      pinchLastZoomAt = dist;
      return;
    }
    if (pinchLastZoomAt) {
      if (dist / pinchLastZoomAt >= PINCH_ZOOM_RATIO) {
        $('#zoomIn').trigger('click');
        pinchLastZoomAt = dist;
      } else if (pinchLastZoomAt / dist >= PINCH_ZOOM_RATIO) {
        $('#zoomOut').trigger('click');
        pinchLastZoomAt = dist;
      }
    }
  }

  function finishLivePinch() {
    if (wheelPinchTimer) {
      clearTimeout(wheelPinchTimer);
      wheelPinchTimer = 0;
    }
    var mid = lastPinchMid;
    var skipRebase = twoFingerOnLoupe || !isPhoneLayout();
    pinchLive = null;
    if (skipRebase) return;
    if (window.TagproMap && TagproMap.rebaseTileSizeToView) {
      TagproMap.rebaseTileSizeToView(mid && mid.x, mid && mid.y);
    }
  }

  function clearTwoFingerGesture() {
    finishLivePinch();
    twoFingerPanning = false;
    twoFingerOnLoupe = false;
    lastPinchMid = null;
    pinchLastZoomAt = 0;
    twoFingerAcc.x = 0;
    twoFingerAcc.y = 0;
  }

  function handleMapPrimaryDown(e, clientX, clientY) {
    var mouse = isMousePointer(e);
    if (loupeVisible) {
      preventIfTouch(e);
      if (!mouse) e.stopPropagation();
      closeMore();
      if (pointInLoupe(clientX, clientY)) {
        if (consumeSettingsPointer(clientX, clientY)) return true;
        return true;
      }
      if (paintThroughParkedLoupe() && beginParkedMapPaint(clientX, clientY)) return true;
      beginOutsideLoupePointer(clientX, clientY);
      return true;
    }
    if (panMode) {
      e.preventDefault();
      e.stopPropagation();
      startPan(clientX, clientY);
      return true;
    }
    if (isPhoneLayout() && !e.shiftKey) {
      var cell = settingsCellFromClient(clientX, clientY);
      if (cell && shouldOpenSettingsOnHold()) {
        var $tile = mapTileAt(cell.x, cell.y);
        preventIfTouch(e);
        e.stopPropagation();
        closeMore();
        settingsPointerDown = true;
        holdStart = { clientX: clientX, clientY: clientY };
        lastPointer = { x: clientX, y: clientY };
        captureLoupeFocusTile($tile);
        noteSettingsFocus(cell.x, cell.y);
        suppressLoupe = true;
        pendingDismiss = false;
        armSettingsPaint($tile, clientX, clientY);
        return true;
      }
    }
    return false;
  }

  function onMapPrimaryDown(e) {
    if (!isPrimaryPointer(e)) return false;
    if (shouldIgnoreCompatPointer(e)) {
      ignoreCompatPointer(e);
      return true;
    }
    var pt = pointerClient(e);
    var handled = handleMapPrimaryDown(e, pt.x, pt.y);
    if (handled) markHandledDown(e, true);
    return handled;
  }

  function onLoupePrimaryDown(e) {
    if (!isPrimaryPointer(e)) return false;
    if (twoFingerPanning || Date.now() < ignorePaintUntil) return false;
    if (isLoupeSettingsControl(e.target)) return false;
    if (shouldIgnoreCompatPointer(e)) {
      preventIfTouch(e);
      e.stopPropagation();
      return true;
    }
    var pt = pointerClient(e);
    preventIfTouch(e);
    if (!isMousePointer(e)) e.stopPropagation();
    startParkedLoupePointer(pt.x, pt.y, e);
    markHandledDown(e, true);
    return true;
  }

  function onLoupePrimaryMove(e) {
    if (!isPrimaryPointer(e)) return;
    if (shouldIgnoreCompatPointer(e)) return;
    if (twoFingerOnLoupe || twoFingerPanning) return;
    var pt = pointerClient(e);
    moveParkedLoupePointer(pt.x, pt.y);
  }

  function onLoupePrimaryUp(e) {
    if (!isPrimaryPointer(e)) return;
    if (shouldIgnoreCompatPointer(e)) return;
    if (twoFingerPanning || twoFingerOnLoupe) return;
    var pt = pointerClient(e);
    endParkedLoupePointer(pt.x, pt.y);
    if (lastHandledDown && lastHandledDown.prevented) lastHandledDown = null;
  }

  function captureLoupePointer(e) {
    var el = $loupe[0];
    var oe = nativeEvent(e);
    if (el && oe && oe.pointerId != null && el.setPointerCapture) {
      try { el.setPointerCapture(oe.pointerId); } catch (err) {}
    }
  }

  mapEl.addEventListener('touchstart', function(e) {
    noteTouch();
    if (e.touches.length === 2) {
      if (!isPhoneLayout()) return;
      e.preventDefault();
      beginTwoFingerGesture(e.touches[0], e.touches[1]);
      return;
    }

    if (e.touches.length !== 1) return;
    if (twoFingerPanning || Date.now() < ignorePaintUntil) return;
    var t = e.touches[0];

    if (HAS_POINTER) {
      if (shouldIgnoreCompatPointer(e)) {
        ignoreCompatPointer(e);
        return;
      }
    }

    if (loupeVisible) {
      e.preventDefault();
      e.stopPropagation();
      closeMore();
      if (HAS_POINTER && lastHandledDown && (Date.now() - lastHandledDown.t) <= SAME_GESTURE_MS) return;
      if (pointInLoupe(t.clientX, t.clientY)) {
        if (consumeSettingsPointer(t.clientX, t.clientY)) {
          markHandledDown(e, true);
          return;
        }
        return;
      }
      if (paintThroughParkedLoupe() && beginParkedMapPaint(t.clientX, t.clientY)) {
        markHandledDown(e, true);
        return;
      }
      beginOutsideLoupePointer(t.clientX, t.clientY);
      markHandledDown(e, true);
      return;
    }

    if (panMode) {
      e.preventDefault();
      startPan(t.clientX, t.clientY);
      markHandledDown(e, true);
      return;
    }

    var $tile = tileFromPoint(t.clientX, t.clientY);
    if (!$tile.length) return;
    e.preventDefault();
    closeMore();
    if (HAS_POINTER && lastHandledDown && (Date.now() - lastHandledDown.t) <= SAME_GESTURE_MS) return;
    var x = $tile.data('x');
    var y = $tile.data('y');
    settingsPointerDown = true;
    if (mapHasSettings(x, y) && shouldOpenSettingsOnHold()) {
      captureLoupeFocusTile($tile);
      noteSettingsFocus(x, y);
      suppressLoupe = true;
      holdStart = { clientX: t.clientX, clientY: t.clientY };
      lastPointer = { x: t.clientX, y: t.clientY };
      armSettingsPaint($tile, t.clientX, t.clientY);
      markHandledDown(e, true);
      return;
    }
    beginPaintAtTile($tile, t.clientX, t.clientY, true);
    markHandledDown(e, true);
  }, { passive: false, capture: true });

  mapEl.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2) {
      if (!isPhoneLayout()) return;
      e.preventDefault();
      twoFingerPanning = true;
      handleTwoFingerMove(e.touches[0], e.touches[1]);
      return;
    }

    if (e.touches.length !== 1) return;
    if (twoFingerPanning) return;
    noteTouch();
    var t = e.touches[0];
    var prevX = lastPointer.x;
    var prevY = lastPointer.y;
    lastPointer = { x: t.clientX, y: t.clientY };

    if (panMode && panPointer) {
      e.preventDefault();
      movePan(t.clientX, t.clientY);
      return;
    }

    if (!painting || loupePainting) {
      if (pendingSettingsPaint && settingsStrokeLeftCell(t.clientX, t.clientY, pendingSettingsPaint.$tile)) {
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
          if (!holdMovingLoupe) {
            beginHoldReposition(t.clientX, t.clientY);
          } else {
            followLoupePointer(t.clientX, t.clientY, prevX, prevY);
          }
        }
      }
      return;
    }
    e.preventDefault();
    if (!suppressLoupe && ((loupeFollow && loupeVisible) || movedPastSlop(t.clientX, t.clientY))) {
      clearLongPress();
      if (loupeVisible && loupeFollow) {
        followLoupePointer(t.clientX, t.clientY, prevX, prevY);
      } else {
        activateLoupeFollowFinger(t.clientX, t.clientY);
      }
      return;
    }
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
      activateLoupeFollowFinger(t.clientX, t.clientY);
    }
  }, { passive: false });

  function onTouchEnd(e) {
    noteTouch();
    if (e.touches.length >= 2) {
      pinchLastZoomAt = pinchDistance(e.touches[0], e.touches[1]);
      lastPinchMid = pinchMidpoint(e.touches[0], e.touches[1]);
      return;
    }
    if (e.touches.length === 1 && twoFingerPanning) {
      var wasOnLoupe = twoFingerOnLoupe;
      clearTwoFingerGesture();
      painting = false;
      ignorePaintUntil = Date.now() + 350;
      if (!isPhoneLayout() && !wasOnLoupe) return;
      return;
    }
    if (e.touches.length === 0) {
      if (twoFingerPanning) ignorePaintUntil = Date.now() + 350;
      clearTwoFingerGesture();
      var t = (e.changedTouches && e.changedTouches[0]) || {};
      finishSettingsPointer(t.clientX, t.clientY);
      panPointer = null;
      endPan();
      var t = (e.changedTouches && e.changedTouches[0]) || {};
      if (!(HAS_POINTER && lastHandledDown && (Date.now() - lastHandledDown.t) <= SAME_GESTURE_MS && lastHandledDown.kind !== 'touch')) {
        endPaint(t.clientX, t.clientY);
      }
      if (lastHandledDown && lastHandledDown.prevented) lastHandledDown = null;
    }
  }

  mapEl.addEventListener('touchend', onTouchEnd, { passive: false });
  mapEl.addEventListener('touchcancel', onTouchEnd, { passive: false });

  mapEl.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    onMapPrimaryDown(e);
  }, true);

  if (HAS_POINTER) {
    mapEl.addEventListener('pointerdown', function(e) {
      onMapPrimaryDown(e);
    }, true);
    mapEl.addEventListener('pointerup', function(e) {
      if (!isPrimaryPointer(e)) return;
      if (shouldIgnoreCompatPointer(e)) return;
      var pt = pointerClient(e);
      finishSettingsPointer(pt.x, pt.y);
    }, true);
    mapEl.addEventListener('pointercancel', function(e) {
      if (!isPrimaryPointer(e)) return;
      finishSettingsPointer(pointerClient(e).x, pointerClient(e).y);
    }, true);
  }

  $map.on('mousedown', function(e) {
    if (!e.originalEvent) return;
    if (shouldIgnoreCompatPointer(e)) return;
    if (e.which !== 1) return;
    if (e.shiftKey) return;
    if (panMode) return;
    if (settingsPointerDown || pendingSettingsPaint) return;
    if (loupeVisible) {
      onMapPrimaryDown(e);
      return;
    }
    if (e.clientX == null || e.clientY == null) return;
    painting = false;
    loupePainting = false;
    mouseLoupe = true;
    holdStart = { clientX: e.clientX, clientY: e.clientY };
    lastPointer = { x: e.clientX, y: e.clientY };
    var $tile = $(e.target).closest('#map .tile');
    if (!$tile.length) $tile = tileFromPoint(e.clientX, e.clientY);
    captureLoupeFocusTile($tile);
    loupeFollowAcc.x = 0;
    loupeFollowAcc.y = 0;
    clearLongPress();
    longPressTimer = setTimeout(function() {
      if (mouseLoupe) activateLoupeFollowFinger(lastPointer.x, lastPointer.y);
    }, LONG_PRESS_MS);
  });
  $(document).on('mousemove', function(e) {
    if (shouldIgnoreCompatPointer(e)) return;
    var prevX = lastPointer.x;
    var prevY = lastPointer.y;
    if (e.originalEvent && e.clientX != null && e.clientY != null) {
      lastPointer = { x: e.clientX, y: e.clientY };
    }
    if (parkedLoupePending) {
      if (!HAS_POINTER) moveParkedLoupePointer(e.clientX, e.clientY, prevX, prevY);
      return;
    }
    if (loupePainting) {
      if (!HAS_POINTER) paintLoupeAt(e.clientX, e.clientY, 'move');
      return;
    }
    if (panMode && panPointer) {
      e.preventDefault();
      movePan(e.clientX, e.clientY);
      return;
    }
    if (pendingSettingsPaint && settingsStrokeLeftCell(e.clientX, e.clientY, pendingSettingsPaint.$tile)) {
      var p = pendingSettingsPaint;
      clearSettingsPaint();
      beginPaintAtTile(p.$tile, e.clientX, e.clientY, false);
      return;
    }
    if (pendingDismiss || holdMovingLoupe) {
      if (movedPastSlop(e.clientX, e.clientY) || holdMovingLoupe) {
        clearLongPress();
        if (!holdMovingLoupe) {
          beginHoldReposition(e.clientX, e.clientY);
        } else {
          followLoupePointer(e.clientX, e.clientY, prevX, prevY);
        }
      }
      return;
    }
    if (!mouseLoupe || panMode) return;
    if (loupeVisible && loupeFollow) {
      followLoupePointer(e.clientX, e.clientY, prevX, prevY);
      return;
    }
    if (movedPastSlop(e.clientX, e.clientY) || loupeVisible) {
      clearLongPress();
      activateLoupeFollowFinger(e.clientX, e.clientY);
    }
  });
  $(document).on('mouseup', function(e) {
    if (!e.originalEvent) return;
    if (shouldIgnoreCompatPointer(e)) return;
    finishSettingsPointer(e.clientX, e.clientY);
    if (parkedLoupePending) {
      endParkedLoupePointer(e.clientX, e.clientY);
      if (panPointer) endPan();
      if (lastHandledDown && lastHandledDown.prevented) lastHandledDown = null;
      return;
    }
    if (loupePainting) {
      endLoupePaint();
    }
    if (panPointer) endPan();
    if (painting && !loupePainting) endPaint(e.clientX, e.clientY);
    if (mouseLoupe || pendingDismiss || holdMovingLoupe) {
      mouseLoupe = false;
      clearLongPress();
      var dismiss = pendingDismiss;
      if (!dismiss && painting && !loupePainting) {
        if (lastTileEl) triggerTile($(lastTileEl), 'mouseup');
        painting = false;
        lastTileEl = null;
      }
      painting = false;
      lastTileEl = null;
      stopLoupeFollow();
      if (dismiss) {
        pendingDismiss = false;
        hideLoupe();
      } else if (loupeVisible) {
        renderLoupe();
      }
      holdStart = null;
    }
    if (lastHandledDown && lastHandledDown.prevented) lastHandledDown = null;
  });

  function applyMapWheel(e) {
    if (!isPhoneLayout()) return;
    // Trackpads send wheel (and ctrl+wheel for pinch), not Touch Events.
    if (e.ctrlKey || e.metaKey) {
      if (window.TagproMap && TagproMap.zoomBy) {
        TagproMap.zoomBy(Math.pow(1.0016, -e.deltaY), e.clientX, e.clientY);
      }
      lastPinchMid = { x: e.clientX, y: e.clientY };
      if (wheelPinchTimer) clearTimeout(wheelPinchTimer);
      wheelPinchTimer = setTimeout(function() {
        wheelPinchTimer = 0;
        if (twoFingerPanning) return;
        finishLivePinch();
      }, 140);
      return;
    }
    var dx = e.deltaX;
    var dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    }
    mapEl.scrollLeft += dx;
    mapEl.scrollTop += dy;
  }

  mapEl.addEventListener('wheel', function(e) {
    // Desktop: leave the event alone so a laptop touchpad stays a normal wheel.
    if (!isPhoneLayout()) return;
    e.preventDefault();
    if (loupeVisible && pointInLoupe(e.clientX, e.clientY)) {
      accumulateLoupePan(e.deltaX, e.deltaY, wheelAcc);
      return;
    }
    applyMapWheel(e);
  }, { passive: false });

  var loupeEl = $loupe[0];
  if (HAS_POINTER) {
    loupeEl.addEventListener('pointerdown', function(e) {
      if (onLoupePrimaryDown(e)) captureLoupePointer(e);
    });
    loupeEl.addEventListener('pointermove', onLoupePrimaryMove);
    loupeEl.addEventListener('pointerup', onLoupePrimaryUp);
    loupeEl.addEventListener('pointercancel', onLoupePrimaryUp);
  }
  loupeEl.addEventListener('touchstart', function(e) {
    noteTouch();
    if (isLoupeSettingsControl(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.touches.length >= 2) {
      beginTwoFingerGesture(e.touches[0], e.touches[1]);
      if (e.targetTouches && e.targetTouches.length >= 2) twoFingerOnLoupe = true;
      return;
    }
    if (twoFingerPanning || Date.now() < ignorePaintUntil) return;
    if (HAS_POINTER && lastHandledDown && (Date.now() - lastHandledDown.t) <= SAME_GESTURE_MS) return;
    var t = e.touches[0];
    startParkedLoupePointer(t.clientX, t.clientY, e);
    markHandledDown(e, true);
  }, { passive: false });
  loupeEl.addEventListener('touchmove', function(e) {
    noteTouch();
    e.preventDefault();
    e.stopPropagation();
    if (e.touches.length >= 2) {
      if (twoFingerOnLoupe) {
        twoFingerPanning = true;
        handleTwoFingerMove(e.touches[0], e.touches[1]);
      }
      return;
    }
    if (twoFingerOnLoupe || twoFingerPanning) return;
    if (HAS_POINTER) return;
    var t = e.touches[0];
    moveParkedLoupePointer(t.clientX, t.clientY);
  }, { passive: false });
  loupeEl.addEventListener('touchend', function(e) {
    noteTouch();
    e.preventDefault();
    e.stopPropagation();
    if (e.touches.length >= 2) {
      pinchLastZoomAt = pinchDistance(e.touches[0], e.touches[1]);
      lastPinchMid = pinchMidpoint(e.touches[0], e.touches[1]);
      return;
    }
    if (twoFingerPanning || twoFingerOnLoupe) {
      if (twoFingerPanning) ignorePaintUntil = Date.now() + 350;
      clearTwoFingerGesture();
      return;
    }
    if (HAS_POINTER) {
      if (lastHandledDown && lastHandledDown.prevented) lastHandledDown = null;
      return;
    }
    var t = (e.changedTouches && e.changedTouches[0]) || {};
    endParkedLoupePointer(t.clientX, t.clientY);
    if (lastHandledDown && lastHandledDown.prevented) lastHandledDown = null;
  }, { passive: false });
  loupeEl.addEventListener('touchcancel', function(e) {
    noteTouch();
    if (twoFingerPanning || twoFingerOnLoupe) {
      if (twoFingerPanning) ignorePaintUntil = Date.now() + 350;
      clearTwoFingerGesture();
      return;
    }
    if (HAS_POINTER) {
      if (lastHandledDown && lastHandledDown.prevented) lastHandledDown = null;
      return;
    }
    var t = (e.changedTouches && e.changedTouches[0]) || {};
    endParkedLoupePointer(t.clientX, t.clientY);
    if (lastHandledDown && lastHandledDown.prevented) lastHandledDown = null;
  }, { passive: false });
  $loupe.on('mousedown', function(e) {
    if (e.which !== 1) return;
    if (isLoupeSettingsControl(e.target)) return;
    onLoupePrimaryDown(e);
  });
  loupeEl.addEventListener('wheel', function(e) {
    if (!isPhoneLayout()) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      applyMapWheel(e);
      return;
    }
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
    if (!isPhoneLayout()) return;
    if ($(e.target).closest('#map').length) e.preventDefault();
  });
  document.addEventListener('gesturechange', function(e) {
    if (!isPhoneLayout()) return;
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

    function axis() {
      var vertical = window.getComputedStyle(track).flexDirection.indexOf('column') === 0;
      return vertical
        ? { size: function() { return track.scrollHeight / 3; }, pos: 'scrollTop', client: 'clientHeight', offset: 'offsetTop', dim: 'offsetHeight' }
        : { size: function() { return track.scrollWidth / 3; }, pos: 'scrollLeft', client: 'clientWidth', offset: 'offsetLeft', dim: 'offsetWidth' };
    }

    function measure() {
      setWidth = axis().size();
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
      var a = axis();
      if (el[a.pos] <= 4) el[a.pos] += setWidth;
      else if (el[a.pos] >= setWidth * 2 - 4) el[a.pos] -= setWidth;
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
      var a = axis();
      var from = el[a.pos];
      var dist = to - from;
      var start = null;
      animating = true;
      function step(now) {
        if (start === null) start = now;
        var t = Math.min(1, (now - start) / duration);
        el[a.pos] = from + dist * easeInOutCubic(t);
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
      var a = axis();
      var viewCenter = el[a.pos] + el[a.client] / 2;
      var target = selected[0];
      var best = Infinity;
      for (var i = 0; i < selected.length; i++) {
        var c = selected[i][a.offset] + selected[i][a.dim] / 2;
        var d = Math.abs(c - viewCenter);
        if (d < best) {
          best = d;
          target = selected[i];
        }
      }
      var left = target[a.offset] - (el[a.client] / 2) + (target[a.dim] / 2);
      if (left < 0) left = 0;
      if (Math.abs(el[a.pos] - left) < 2) {
        refreshScale();
        return;
      }
      if (animate === false) {
        el[a.pos] = left;
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
    window.addEventListener('orientationchange', function() {
      setTimeout(function() {
        measure();
        centerOnSelected(false);
      }, 250);
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
        refreshTileSettingsControl();
      },
      hide: hideLoupe,
      visible: function() { return loupeVisible; },
      center: function() { return { x: loupeCenterX, y: loupeCenterY }; },
      tracking: function() { return !!(loupeFollow || holdMovingLoupe || loupePainting); },
      dismissing: function() { return !!pendingDismiss; },
      isEmulatedMouse: isEmulatedMouse,
      armSettingsModalGuard: armSettingsModalGuard
    };
  })();

  (function setupToolsCarousel() {
    var el = document.getElementById('tools');
    if (!el) return;
    var group = el.querySelector('.btn-group-justified');
    if (!group) return;

    var setWidth = 0;
    var looping = false;
    var animating = false;
    var scrollAnimFrame = null;

    function isDesktopLayout() {
      return document.documentElement.classList.contains('layout-desktop');
    }

    function canonicalButtons() {
      var all = group.querySelectorAll('.btn');
      var out = [];
      for (var i = 0; i < all.length; i++) {
        if (!all[i].hasAttribute('data-tool-clone')) out.push(all[i]);
      }
      return out;
    }

    function ensureToolIds() {
      var buttons = canonicalButtons();
      for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        if (!btn.getAttribute('data-tool-id')) {
          btn.setAttribute('data-tool-id', btn.id || btn.getAttribute('data-action') || '');
        }
      }
    }

    function removeClones() {
      var clones = group.querySelectorAll('[data-tool-clone]');
      for (var i = 0; i < clones.length; i++) {
        clones[i].parentNode.removeChild(clones[i]);
      }
    }

    function addClones() {
      if (group.querySelector('[data-tool-clone]')) return;
      var originals = canonicalButtons();
      for (var copy = 0; copy < 2; copy++) {
        for (var i = 0; i < originals.length; i++) {
          var clone = originals[i].cloneNode(true);
          clone.removeAttribute('id');
          clone.setAttribute('data-tool-clone', '');
          var tool = $(originals[i]).data('tool');
          if (tool) $(clone).data('tool', tool);
          group.appendChild(clone);
        }
      }
    }

    function measure() {
      setWidth = looping ? group.scrollWidth / 3 : 0;
      return setWidth;
    }

    function jumpLoop() {
      if (animating || !looping) return;
      if (!setWidth) measure();
      if (setWidth < 8) return;
      if (el.scrollLeft <= 4) el.scrollLeft += setWidth;
      else if (el.scrollLeft >= setWidth * 2 - 4) el.scrollLeft -= setWidth;
    }

    function syncLoopMode() {
      ensureToolIds();
      removeClones();
      looping = false;
      setWidth = 0;
      el.classList.remove('tools-looping');
      if (isDesktopLayout()) {
        el.scrollLeft = 0;
        return;
      }
      void group.offsetWidth;
      if (group.scrollWidth <= el.clientWidth) {
        el.scrollLeft = 0;
        return;
      }
      addClones();
      looping = true;
      el.classList.add('tools-looping');
      void group.offsetWidth;
      measure();
      if (el.scrollLeft < 4) el.scrollLeft = setWidth;
      else jumpLoop();
    }

    function scrollLeftToCenter(btn) {
      var elRect = el.getBoundingClientRect();
      var btnRect = btn.getBoundingClientRect();
      return el.scrollLeft + (btnRect.left + btnRect.width / 2) - (elRect.left + el.clientWidth / 2);
    }

    function itemCenter(btn) {
      return btn.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft + btn.offsetWidth / 2;
    }

    function nearestActive() {
      var selected = el.querySelectorAll('.btn.active');
      if (!selected.length) return null;
      var viewCenter = el.scrollLeft + el.clientWidth / 2;
      var target = selected[0];
      var best = Infinity;
      for (var i = 0; i < selected.length; i++) {
        var d = Math.abs(itemCenter(selected[i]) - viewCenter);
        if (d < best) {
          best = d;
          target = selected[i];
        }
      }
      return target;
    }

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function finishCenter() {
      animating = false;
      if (scrollAnimFrame) {
        cancelAnimationFrame(scrollAnimFrame);
        scrollAnimFrame = null;
      }
      jumpLoop();
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

    function centerOnActive(animate) {
      // Rebuild clones on size/layout changes (animate !== true), not on tool taps.
      if (animate !== true) syncLoopMode();
      else if (!isDesktopLayout() && !looping && group.scrollWidth > el.clientWidth) {
        syncLoopMode();
      }

      if (!looping) {
        el.scrollLeft = 0;
        return;
      }

      var active = nearestActive();
      if (!active) {
        jumpLoop();
        return;
      }
      var left = scrollLeftToCenter(active);
      if (Math.abs(el.scrollLeft - left) < 2) {
        jumpLoop();
        return;
      }
      if (animate === false) {
        el.scrollLeft = left;
        jumpLoop();
        return;
      }
      animateScrollTo(left, 850);
    }

    el.addEventListener('scroll', function() {
      if (!animating) jumpLoop();
    }, { passive: true });
    window.addEventListener('resize', function() { centerOnActive(false); });
    window.addEventListener('orientationchange', function() {
      setTimeout(function() { centerOnActive(false); }, 250);
    });
    requestAnimationFrame(function() { centerOnActive(false); });

    window.TagproTools = { centerOnActive: centerOnActive };
  })();
});
