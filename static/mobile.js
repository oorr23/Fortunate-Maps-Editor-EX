$(function() {
  var LOUPE_TILES = 11;
  var LOUPE_CELL = 24;
  var LOUPE_SIZE = LOUPE_TILES * LOUPE_CELL;
  // Fisheye loupe: SVG displacement on .loupe-inner only.
  // Set LOUPE_FISHEYE false to restore the regular grid (no filter).
  // LOUPE_FISHEYE_SHAPE: 'circle' (default) or 'square' (Chebyshev + rounded-square chrome).
  var LOUPE_FISHEYE = true;
  var LOUPE_FISHEYE_POWER = 0.66;
  var LOUPE_FISHEYE_SHAPE = 'circle';
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

  function beginMoreDrag(e, origin, panelName) {
    if (e.touches && e.touches.length > 1) return;
    if ($('.modal.in:visible').length) return;
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
    if ($('.modal.in:visible').length) return;
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
  var loupeFocusTile = null;
  var loupeFollowAcc = { x: 0, y: 0 };
  var loupeFollowOrigin = null;
  var lastTouchAt = 0;
  var lastSettingsTap = null;
  var suppressLoupe = false;
  var pendingSettingsPaint = null;
  var settingsPaintTimer = null;
  var parkedLoupePending = null;

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
  }

  function showLoupe() {
    loupeVisible = true;
    $loupe.toggleClass('follow-finger', !!loupeFollow && !holdMovingLoupe);
    $loupe.addClass('visible').attr('aria-hidden', 'false');
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

  function isEmulatedMouse(e) {
    if (!e) return Date.now() - lastTouchAt < 800;
    var oe = e.originalEvent || e;
    if (oe.sourceCapabilities && oe.sourceCapabilities.firesTouchEvents) return true;
    if (oe.pointerType === 'touch') return true;
    return Date.now() - lastTouchAt < 800;
  }

  function captureLoupeFocusTile($tile) {
    loupeFocusTile = null;
    if (!$tile || !$tile.length) return;
    var x = $tile.data('x');
    var y = $tile.data('y');
    if (x == null || y == null || isNaN(x) || isNaN(y)) return;
    loupeFocusTile = { x: Number(x), y: Number(y) };
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

  function mapTileUnderPointer(clientX, clientY) {
    var $tile = tileFromPoint(clientX, clientY);
    if ($tile.length) return $tile;
    var cell = loupeCellFromPoint(clientX, clientY);
    if (!cell) return $();
    return mapTileAt(cell.x, cell.y);
  }

  function fisheyeUnitScale(nx, ny, power) {
    var r = LOUPE_FISHEYE_SHAPE === 'circle'
      ? Math.hypot(nx, ny)
      : Math.max(Math.abs(nx), Math.abs(ny));
    if (r === 0) return 0;
    // r = 1 at the inscribed circle (mid-sides). Outside it, identity — those
    // pixels are clipped by the circular chrome.
    if (LOUPE_FISHEYE_SHAPE === 'circle' && r > 1) return 1;
    return Math.pow(r, power - 1);
  }

  function fisheyeInverse(nx, ny) {
    var k = fisheyeUnitScale(nx, ny, 1 / LOUPE_FISHEYE_POWER);
    if (!k) return { nx: 0, ny: 0 };
    return { nx: nx * k, ny: ny * k };
  }

  function clampByte(v) {
    v = Math.round(v);
    if (v < 0) return 0;
    if (v > 255) return 255;
    return v;
  }

  function generateLoupeFisheyeMap(cssSize, scale) {
    var canvas = document.createElement('canvas');
    canvas.width = cssSize;
    canvas.height = cssSize;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(cssSize, cssSize);
    var data = img.data;
    for (var y = 0; y < cssSize; y++) {
      for (var x = 0; x < cssSize; x++) {
        var nx = (x + 0.5) / cssSize * 2 - 1;
        var ny = (y + 0.5) / cssSize * 2 - 1;
        var src = fisheyeInverse(nx, ny);
        var srcX = (src.nx + 1) / 2 * cssSize;
        var srcY = (src.ny + 1) / 2 * cssSize;
        var dx = srcX - (x + 0.5);
        var dy = srcY - (y + 0.5);
        var i = (y * cssSize + x) * 4;
        // 128 = zero offset; feDisplacementMap: p' = p + scale * (channel - 0.5)
        data[i] = clampByte((dx / scale + 0.5) * 255);
        data[i + 1] = clampByte((dy / scale + 0.5) * 255);
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function applyLoupeFisheyeFilter() {
    if (!loupeInner) return;
    var circleChrome = LOUPE_FISHEYE && LOUPE_FISHEYE_SHAPE === 'circle';
    $loupe.toggleClass('loupe-circle', circleChrome);
    if (!LOUPE_FISHEYE) {
      loupeInner.classList.remove('fisheye');
      loupeInner.style.filter = 'none';
      loupeInner.style.webkitFilter = 'none';
      return;
    }
    var xlinkNS = 'http://www.w3.org/1999/xlink';
    var scale = LOUPE_SIZE;
    var mapEl = document.getElementById('loupeFisheyeMap');
    var dispEl = document.getElementById('loupeFisheyeDisplacement');
    var mapUrl = generateLoupeFisheyeMap(LOUPE_SIZE, scale);
    if (mapEl) {
      mapEl.setAttribute('width', String(LOUPE_SIZE));
      mapEl.setAttribute('height', String(LOUPE_SIZE));
      mapEl.setAttribute('href', mapUrl);
      mapEl.setAttributeNS(xlinkNS, 'href', mapUrl);
    }
    if (dispEl) dispEl.setAttribute('scale', String(scale));
    loupeInner.classList.add('fisheye');
    loupeInner.style.filter = 'url(#loupeFisheyeFilter)';
    loupeInner.style.webkitFilter = 'url(#loupeFisheyeFilter)';
  }

  applyLoupeFisheyeFilter();

  function loupeCellFromPoint(clientX, clientY) {
    if (!loupeInner) return null;
    var rect = loupeInner.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    var col;
    var row;
    if (LOUPE_FISHEYE) {
      var nx = (x / rect.width) * 2 - 1;
      var ny = (y / rect.height) * 2 - 1;
      if (LOUPE_FISHEYE_SHAPE === 'circle' && Math.hypot(nx, ny) > 1) return null;
      var mapped = fisheyeInverse(nx, ny);
      col = Math.floor((mapped.nx + 1) / 2 * LOUPE_TILES);
      row = Math.floor((mapped.ny + 1) / 2 * LOUPE_TILES);
    } else {
      col = Math.floor(x / (rect.width / LOUPE_TILES));
      row = Math.floor(y / (rect.height / LOUPE_TILES));
    }
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

  function followLoupeTo(clientX, clientY) {
    if (clientX == null || clientY == null || isNaN(clientX) || isNaN(clientY)) return;
    lastPointer = { x: clientX, y: clientY };
    positionLoupe(clientX, clientY);
    var $tile = mapTileUnderPointer(clientX, clientY);
    if (!$tile.length) return;
    var x = Number($tile.data('x'));
    var y = Number($tile.data('y'));
    if (isNaN(x) || isNaN(y)) return;
    if (x === loupeCenterX && y === loupeCenterY) {
      syncPaintToLoupeCenter();
      return;
    }
    loupeCenterX = x;
    loupeCenterY = y;
    clampLoupeCenter();
    loupeFocusTile = { x: loupeCenterX, y: loupeCenterY };
    stampLoupeNow();
    syncPaintToLoupeCenter();
  }

  function followLoupePointer(clientX, clientY) {
    followLoupeTo(clientX, clientY);
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
    loupeCenterX += dx;
    loupeCenterY += dy;
    clampLoupeCenter();
    requestLoupeStamp();
    syncPaintToLoupeCenter();
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
      followLoupeTo(clientX, clientY);
      return;
    }
    if (loupeFocusTile) {
      loupeCenterX = loupeFocusTile.x;
      loupeCenterY = loupeFocusTile.y;
    }
    clampLoupeCenter();
    var ox = (holdStart && holdStart.clientX != null) ? holdStart.clientX : clientX;
    var oy = (holdStart && holdStart.clientY != null) ? holdStart.clientY : clientY;
    setLoupeFollowOrigin(ox, oy, loupeCenterX, loupeCenterY);
    loupeFollow = true;
    followLoupeTo(clientX, clientY);
    stampLoupeNow();
    syncPaintToLoupeCenter();
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
    loupeCenterX = x;
    loupeCenterY = y;
    clampLoupeCenter();
    loupeFocusTile = { x: loupeCenterX, y: loupeCenterY };
    loupeFollowAcc.x = 0;
    loupeFollowAcc.y = 0;
    if (clientX != null && clientY != null && !isNaN(clientX) && !isNaN(clientY)) {
      positionLoupe(clientX, clientY);
      setLoupeFollowOrigin(clientX, clientY, loupeCenterX, loupeCenterY);
    }
    stampLoupeNow();
  }

  function startFollowPaintAtCenter() {
    var $tile = mapTileUnderPointer(lastPointer.x, lastPointer.y);
    if (!$tile.length) $tile = mapTileAt(loupeCenterX, loupeCenterY);
    if (!$tile.length) return;
    var x = Number($tile.data('x'));
    var y = Number($tile.data('y'));
    if (!isNaN(x) && !isNaN(y)) {
      loupeCenterX = x;
      loupeCenterY = y;
      clampLoupeCenter();
      loupeFocusTile = { x: loupeCenterX, y: loupeCenterY };
    }
    painting = true;
    loupePainting = false;
    lastTileEl = $tile[0];
    triggerTile($tile, 'mousedown');
    triggerTile($tile, 'mouseenter');
    captureLoupeFocusTile($tile);
    stampLoupeNow();
  }

  function startParkedLoupePointer(clientX, clientY) {
    closeMore();
    pendingDismiss = false;
    holdMovingLoupe = false;
    var cell = loupeCellFromPoint(clientX, clientY);
    if (!cell) return;
    parkedLoupePending = { x: cell.x, y: cell.y, clientX: clientX, clientY: clientY };
    holdStart = { clientX: clientX, clientY: clientY };
    lastPointer = { x: clientX, y: clientY };
    clearLongPress();
    longPressTimer = setTimeout(function() {
      if (!parkedLoupePending) return;
      var p = parkedLoupePending;
      parkedLoupePending = null;
      if (mapHasSettings(p.x, p.y)) {
        openSettingsAt(p.x, p.y);
        return;
      }
      holdMovingLoupe = true;
      loupeFollow = true;
      recenterLoupeOn(p.x, p.y, lastPointer.x, lastPointer.y);
      showLoupe();
      startFollowPaintAtCenter();
    }, LONG_PRESS_MS);
  }

  function moveParkedLoupePointer(clientX, clientY, prevX, prevY) {
    if (prevX == null) prevX = lastPointer.x;
    if (prevY == null) prevY = lastPointer.y;
    lastPointer = { x: clientX, y: clientY };
    if (holdMovingLoupe) {
      followLoupeTo(clientX, clientY);
      return;
    }
    if (parkedLoupePending && movedPastSlop(clientX, clientY)) {
      clearLongPress();
      var p = parkedLoupePending;
      parkedLoupePending = null;
      paintLoupeAt(p.clientX, p.clientY, 'start');
      paintLoupeAt(clientX, clientY, 'move');
      return;
    }
    if (loupePainting) paintLoupeAt(clientX, clientY, 'move');
  }

  function endParkedLoupePointer(clientX, clientY) {
    clearLongPress();
    if (parkedLoupePending) {
      var p = parkedLoupePending;
      parkedLoupePending = null;
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
    if (painting && !loupePainting) {
      var $tile = lastTileEl ? $(lastTileEl) : tileFromPoint(clientX, clientY);
      triggerTile($tile, 'mouseup');
    }
    painting = false;
    lastTileEl = null;
    stopLoupeFollow();
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
    noteTouch();
    if (e.touches.length === 2) {
      e.preventDefault();
      twoFingerPanning = true;
      painting = false;
      stopLoupeFollow();
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
      if (pointInLoupe(t.clientX, t.clientY)) return;
      var over = tileFromPoint(t.clientX, t.clientY);
      captureLoupeFocusTile(over);
      if (!loupeFocusTile) loupeFocusTile = { x: loupeCenterX, y: loupeCenterY };
      pendingDismiss = true;
      holdMovingLoupe = false;
      holdStart = { clientX: t.clientX, clientY: t.clientY };
      lastPointer = { x: t.clientX, y: t.clientY };
      loupeFollowAcc.x = 0;
      loupeFollowAcc.y = 0;
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
    if (isEmulatedMouse(e)) return;
    if (isEmulatedMouse(e)) return;
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
        if (mapHasSettings(x, y) && !loupeVisible) {
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
      if (pointInLoupe(e.clientX, e.clientY)) return;
      var $over = $(e.target).closest('#map .tile');
      if (!$over.length) $over = tileFromPoint(e.clientX, e.clientY);
      captureLoupeFocusTile($over);
      if (!loupeFocusTile) loupeFocusTile = { x: loupeCenterX, y: loupeCenterY };
      pendingDismiss = true;
      holdMovingLoupe = false;
      holdStart = { clientX: e.clientX, clientY: e.clientY };
      lastPointer = { x: e.clientX, y: e.clientY };
      loupeFollowAcc.x = 0;
      loupeFollowAcc.y = 0;
      clearLongPress();
      longPressTimer = setTimeout(function() {
        beginHoldReposition(lastPointer.x, lastPointer.y);
      }, LONG_PRESS_MS);
    }
  }, true);

  $map.on('mousedown', function(e) {
    if (!e.originalEvent) return;
    if (isEmulatedMouse(e)) return;
    if (isEmulatedMouse(e)) return;
    if (e.which !== 1) return;
    if (e.shiftKey) return;
    if (panMode) return;
    if (loupeVisible) return;
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
    if (isEmulatedMouse(e)) return;
    var prevX = lastPointer.x;
    var prevY = lastPointer.y;
    if (e.originalEvent && e.clientX != null && e.clientY != null) {
      lastPointer = { x: e.clientX, y: e.clientY };
    }
    if (parkedLoupePending) {
      moveParkedLoupePointer(e.clientX, e.clientY, prevX, prevY);
      return;
    }
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
    if (isEmulatedMouse(e)) return;
    settingsPointerDown = false;
    if (parkedLoupePending) {
      endParkedLoupePointer(e.clientX, e.clientY);
      if (panPointer) endPan();
      return;
    }
    if (loupePainting) {
      endLoupePaint();
    }
    if (panPointer) endPan();
    if (mouseLoupe || pendingDismiss || holdMovingLoupe) {
      mouseLoupe = false;
      clearLongPress();
      if (painting && !loupePainting) {
        if (lastTileEl) triggerTile($(lastTileEl), 'mouseup');
        painting = false;
        lastTileEl = null;
      }
      stopLoupeFollow();
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
    noteTouch();
    e.preventDefault();
    e.stopPropagation();
    var t = e.touches[0];
    startParkedLoupePointer(t.clientX, t.clientY);
  }, { passive: false });
  loupeEl.addEventListener('touchmove', function(e) {
    noteTouch();
    e.preventDefault();
    e.stopPropagation();
    var t = e.touches[0];
    moveParkedLoupePointer(t.clientX, t.clientY);
  }, { passive: false });
  loupeEl.addEventListener('touchend', function(e) {
    noteTouch();
    e.preventDefault();
    e.stopPropagation();
    var t = (e.changedTouches && e.changedTouches[0]) || {};
    endParkedLoupePointer(t.clientX, t.clientY);
  }, { passive: false });
  loupeEl.addEventListener('touchcancel', function(e) {
    noteTouch();
    var t = (e.changedTouches && e.changedTouches[0]) || {};
    endParkedLoupePointer(t.clientX, t.clientY);
  }, { passive: false });
  $loupe.on('mousedown', function(e) {
    if (e.which !== 1) return;
    if (isEmulatedMouse(e)) return;
    e.preventDefault();
    e.stopPropagation();
    startParkedLoupePointer(e.clientX, e.clientY);
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
      }
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
