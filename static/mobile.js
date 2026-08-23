$(function() {
  var MAG = 2.5;
  var LOUPE_SIZE = 140;
  var LOUPE_LIFT = 96;
  var LONG_PRESS_MS = 280;
  var PINCH_ZOOM_RATIO = 1.25;

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
  var panTouch = null;
  var twoFingerPanning = false;
  var lastPinchMid = null;
  var mouseLoupe = false;

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

  $panMode.on('click', function() {
    panMode = !panMode;
    $panMode.toggleClass('active', panMode);
  });

  $('#dockUndo').on('click', function() { $('#undo').trigger('click'); });
  $('#dockRedo').on('click', function() { $('#redo').trigger('click'); });
  $('#dockZoomIn').on('click', function() { $('#zoomIn').trigger('click'); });
  $('#dockZoomOut').on('click', function() { $('#zoomOut').trigger('click'); });

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

  function triggerTile($tile, type) {
    if (!$tile || !$tile.length) return;
    $tile.trigger($.Event(type, { which: 1, button: 0, bubbles: true }));
  }

  function hideLoupe() {
    loupeVisible = false;
    $loupe.removeClass('visible').attr('aria-hidden', 'true');
    if (loupeInner) loupeInner.innerHTML = '';
  }

  function showLoupe() {
    loupeVisible = true;
    $loupe.addClass('visible').attr('aria-hidden', 'false');
  }

  function updateLoupe(clientX, clientY) {
    var $tile = tileFromPoint(clientX, clientY);
    if (!$tile.length) return;

    var x = $tile.data('x');
    var y = $tile.data('y');
    var bg = $tile.closest('.tileBackground')[0];
    if (!bg) return;
    var tilePx = bg.offsetWidth || 40;
    var rows = mapEl.querySelectorAll('.tileRow');
    var radius = 2;
    var wrap = document.createElement('div');
    wrap.style.position = 'absolute';
    wrap.style.left = '50%';
    wrap.style.top = '50%';
    wrap.style.width = ((radius * 2 + 1) * tilePx) + 'px';
    wrap.style.height = wrap.style.width;
    wrap.style.transform = 'translate(-50%, -50%) scale(' + MAG + ')';
    wrap.style.transformOrigin = 'center center';
    wrap.style.fontSize = '0';
    wrap.style.lineHeight = '0';
    wrap.style.whiteSpace = 'nowrap';

    for (var dy = -radius; dy <= radius; dy++) {
      var rowEl = rows[y + dy];
      var rowDiv = document.createElement('div');
      rowDiv.style.height = tilePx + 'px';
      rowDiv.style.whiteSpace = 'nowrap';
      rowDiv.style.fontSize = '0';
      for (var dx = -radius; dx <= radius; dx++) {
        var cell;
        if (!rowEl || (x + dx) < 0 || (x + dx) >= rowEl.children.length) {
          cell = document.createElement('div');
          cell.style.display = 'inline-block';
          cell.style.width = tilePx + 'px';
          cell.style.height = tilePx + 'px';
          cell.style.background = '#000';
        } else {
          cell = rowEl.children[x + dx].cloneNode(true);
          cell.style.display = 'inline-block';
        }
        rowDiv.appendChild(cell);
      }
      wrap.appendChild(rowDiv);
    }

    loupeInner.innerHTML = '';
    loupeInner.appendChild(wrap);

    var left = clientX;
    var top = clientY - LOUPE_LIFT;
    var half = LOUPE_SIZE / 2;
    left = Math.max(half + 8, Math.min(left, window.innerWidth - half - 8));
    top = Math.max(half + 8, top);
    $loupe.css({ left: left + 'px', top: top + 'px' });
    showLoupe();
  }

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function endPaint(clientX, clientY) {
    clearLongPress();
    if (painting) {
      var $tile = tileFromPoint(clientX, clientY);
      if (!$tile.length && lastTileEl) $tile = $(lastTileEl);
      triggerTile($tile, 'mouseup');
    }
    painting = false;
    lastTileEl = null;
    hideLoupe();
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
      hideLoupe();
      clearLongPress();
      if (lastTileEl) triggerTile($(lastTileEl), 'mouseup');
      lastTileEl = null;
      pinchLastZoomAt = pinchDistance(e.touches[0], e.touches[1]);
      lastPinchMid = pinchMidpoint(e.touches[0], e.touches[1]);
      return;
    }

    if (e.touches.length !== 1) return;
    var t = e.touches[0];

    if (panMode) {
      e.preventDefault();
      panTouch = {
        x: t.clientX,
        y: t.clientY,
        sl: mapEl.scrollLeft,
        st: mapEl.scrollTop
      };
      return;
    }

    var $tile = tileFromPoint(t.clientX, t.clientY);
    if (!$tile.length) return;
    e.preventDefault();
    closeMore();
    painting = true;
    lastTileEl = $tile[0];
    triggerTile($tile, 'mousedown');
    triggerTile($tile, 'mouseenter');
    longPressTimer = setTimeout(function() {
      updateLoupe(t.clientX, t.clientY);
    }, LONG_PRESS_MS);
  }, { passive: false });

  mapEl.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      twoFingerPanning = true;
      var mid = pinchMidpoint(e.touches[0], e.touches[1]);
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
    var t = e.touches[0];

    if (panMode && panTouch) {
      e.preventDefault();
      mapEl.scrollLeft = panTouch.sl - (t.clientX - panTouch.x);
      mapEl.scrollTop = panTouch.st - (t.clientY - panTouch.y);
      return;
    }

    if (!painting) return;
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
    if (loupeVisible) {
      updateLoupe(t.clientX, t.clientY);
    } else if (longPressTimer) {
      clearLongPress();
      updateLoupe(t.clientX, t.clientY);
    }
  }, { passive: false });

  function onTouchEnd(e) {
    if (e.touches.length === 0) {
      twoFingerPanning = false;
      lastPinchMid = null;
      panTouch = null;
      var t = (e.changedTouches && e.changedTouches[0]) || {};
      endPaint(t.clientX, t.clientY);
    } else if (e.touches.length === 1 && twoFingerPanning) {
      twoFingerPanning = false;
      lastPinchMid = null;
      painting = false;
      hideLoupe();
    }
  }

  mapEl.addEventListener('touchend', onTouchEnd, { passive: false });
  mapEl.addEventListener('touchcancel', onTouchEnd, { passive: false });

  $map.on('mousedown', function(e) {
    if (e.which !== 1) return;
    mouseLoupe = true;
    var cx = e.clientX, cy = e.clientY;
    longPressTimer = setTimeout(function() {
      if (mouseLoupe) updateLoupe(cx, cy);
    }, LONG_PRESS_MS);
  });
  $(document).on('mousemove', function(e) {
    if (!mouseLoupe) return;
    if (loupeVisible) updateLoupe(e.clientX, e.clientY);
    else if (longPressTimer) {
      clearLongPress();
      updateLoupe(e.clientX, e.clientY);
    }
  });
  $(document).on('mouseup', function() {
    if (mouseLoupe) {
      mouseLoupe = false;
      clearLongPress();
      hideLoupe();
    }
  });

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
});
