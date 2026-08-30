(function (global) {
  var STORAGE_KEY = 'tagpro-layout-override';
  var DESKTOP_MIN_WIDTH = 1024;
  var PORTRAIT_DESKTOP_MIN_WIDTH = 1280;
  var sessionOverride = null;
  var OVERRIDES = { mobile: 1, desktop: 1, gamepad: 1, steamdeck: 1 };

  function isOverride(value) {
    return !!(value && OVERRIDES[value]);
  }

  function mq(query) {
    return !!(global.matchMedia && global.matchMedia(query).matches);
  }

  function clearStoredOverride() {
    try {
      if (global.localStorage) global.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {}
  }

  function readOverride() {
    if (isOverride(sessionOverride)) return sessionOverride;
    return null;
  }

  function writeOverride(value) {
    sessionOverride = isOverride(value) ? value : null;
  }

  function detectDesktop() {
    var width = global.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
    if (!width || width < DESKTOP_MIN_WIDTH) return false;

    var portrait = mq('(orientation: portrait)');
    if (portrait && width < PORTRAIT_DESKTOP_MIN_WIDTH) return false;

    var fine = mq('(pointer: fine)');
    var hover = mq('(hover: hover)');
    var coarse = mq('(pointer: coarse)');

    if (coarse && !fine) return false;
    if (fine && hover) return true;
    return false;
  }

  function chooseLayout(force) {
    if (isOverride(force)) return force;
    var override = readOverride();
    if (override) return override;
    // Auto never picks GamePad or Steam Deck — those layouts are explicit only.
    return detectDesktop() ? 'desktop' : 'mobile';
  }

  function applyLayoutClasses(el, layout) {
    if (!el || !el.classList) return;
    el.classList.remove('layout-mobile', 'layout-desktop', 'layout-gamepad', 'layout-steamdeck');
    if (layout === 'gamepad') {
      el.classList.add('layout-mobile', 'layout-gamepad');
    } else if (layout === 'steamdeck') {
      el.classList.add('layout-mobile', 'layout-gamepad', 'layout-steamdeck');
    } else if (layout) {
      el.classList.add('layout-' + layout);
    }
  }

  function applyLayout(force) {
    var layout = chooseLayout(force);
    var root = document.documentElement;
    var previous = root.getAttribute('data-layout');
    applyLayoutClasses(root, layout);
    root.setAttribute('data-layout', layout);
    root.setAttribute('data-layout-override', readOverride() || 'auto');
    var width = global.innerWidth || (root && root.clientWidth) || 0;
    var height = global.innerHeight || (root && root.clientHeight) || 0;
    var landscape = mq('(orientation: landscape)') || (width >= height && width > 0);
    root.classList.toggle('orient-landscape', !!landscape);
    root.classList.toggle('orient-portrait', !landscape);
    if (document.body) applyLayoutClasses(document.body, layout);
    if (previous && previous !== layout) {
      try {
        root.dispatchEvent(new CustomEvent('tagpro-layout', { detail: { layout: layout } }));
      } catch (err) {}
    }
    return layout;
  }

  function setOverride(value) {
    if (!isOverride(value)) value = null;
    writeOverride(value);
    return applyLayout();
  }

  function isMobileLayout() {
    return !document.documentElement.classList.contains('layout-desktop');
  }

  clearStoredOverride();
  applyLayout();

  global.addEventListener('resize', function () { applyLayout(); });
  global.addEventListener('orientationchange', function () { applyLayout(); });
  if (global.matchMedia) {
    var pointerMq = global.matchMedia('(pointer: coarse)');
    if (pointerMq.addEventListener) pointerMq.addEventListener('change', function () { applyLayout(); });
    else if (pointerMq.addListener) pointerMq.addListener(function () { applyLayout(); });
  }

  global.TagproLayout = {
    apply: applyLayout,
    setOverride: setOverride,
    getOverride: readOverride,
    isMobile: isMobileLayout,
    detectDesktop: detectDesktop
  };
})(window);
