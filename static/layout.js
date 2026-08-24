(function (global) {
  var STORAGE_KEY = 'tagpro-layout-override';
  var DESKTOP_MIN_WIDTH = 1024;
  var PORTRAIT_DESKTOP_MIN_WIDTH = 1280;

  function mq(query) {
    return !!(global.matchMedia && global.matchMedia(query).matches);
  }

  function readOverride() {
    try {
      var value = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (value === 'mobile' || value === 'desktop') return value;
    } catch (err) {}
    return null;
  }

  function writeOverride(value) {
    try {
      if (!value) {
        global.localStorage.removeItem(STORAGE_KEY);
      } else {
        global.localStorage.setItem(STORAGE_KEY, value);
      }
    } catch (err) {}
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
    if (force === 'mobile' || force === 'desktop') return force;
    var override = readOverride();
    if (override) return override;
    return detectDesktop() ? 'desktop' : 'mobile';
  }

  function applyLayout(force) {
    var layout = chooseLayout(force);
    var root = document.documentElement;
    root.classList.remove('layout-mobile', 'layout-desktop');
    root.classList.add('layout-' + layout);
    root.setAttribute('data-layout', layout);
    root.setAttribute('data-layout-override', readOverride() || 'auto');
    var width = global.innerWidth || (root && root.clientWidth) || 0;
    var height = global.innerHeight || (root && root.clientHeight) || 0;
    var landscape = mq('(orientation: landscape)') || (width >= height && width > 0);
    root.classList.toggle('orient-landscape', !!landscape);
    root.classList.toggle('orient-portrait', !landscape);
    if (document.body) {
      document.body.classList.remove('layout-mobile', 'layout-desktop');
      document.body.classList.add('layout-' + layout);
    }
    return layout;
  }

  function setOverride(value) {
    if (value !== 'mobile' && value !== 'desktop') value = null;
    writeOverride(value);
    return applyLayout();
  }

  function isMobileLayout() {
    return !document.documentElement.classList.contains('layout-desktop');
  }

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