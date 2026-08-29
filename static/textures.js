$(function() {
  var ID_KEY = 'tagpro-texture-pack-id';
  var IMPORTED_KEY = 'tagpro-texture-imported';
  var SLOT_BY_IMAGE = {
    speedpad: 'speedpad',
    speedpadred: 'speedpadRed',
    speedpadblue: 'speedpadBlue',
    portal: 'portal',
    portalred: 'portalRed',
    portalblue: 'portalBlue',
    gravitywell: 'gravityWell'
  };
  var FM_TEXTURE_BASE = 'https://raw.githubusercontent.com/raikutro/fortunatemaps/master/editor/public/texturepacks/';
  var FM_PACK_IDS = [
    '24k', 'bold', 'bowling', 'camsppdark', 'camspplight', 'camsppold', 'celeste', 'chip',
    'circlejerk', 'classic', 'cmyk', 'coral', 'corallight', 'crystal', 'electric', 'element',
    'flat', 'flatbug', 'galvanize', 'isometric', 'maxima', 'mltplive', 'mtbad', 'mumbo',
    'mural', 'musclescupgradients', 'musclescupog', 'nom', 'pastelpro', 'plique', 'plumb',
    'precisiondark', 'sharp', 'sketch', 'sniperpack', 'sparkle', 'starlight', 'supreme',
    'terminalpx', 'turbo', 'wave', 'xmas', 'yinyang'
  ];
  var FM_PACK_SET = {};
  for (var fi = 0; fi < FM_PACK_IDS.length; fi++) FM_PACK_SET[FM_PACK_IDS[fi]] = true;
  var EDITOR_DEFAULT = {
    id: 'editor-default',
    name: 'Editor Default',
    author: '',
    urls: {
      tiles: 'default-skin-v2.png',
      speedpad: 'speedpad.png',
      speedpadRed: 'speedpadred.png',
      speedpadBlue: 'speedpadblue.png',
      portal: 'portal.png',
      portalRed: 'portal.png',
      portalBlue: 'portal.png',
      gravityWell: 'gravitywell.png'
    }
  };

  var official = [];
  var imported = null;
  var current = clonePack(EDITOR_DEFAULT);
  var applying = false;

  function cloneUrls(urls) {
    if (!urls) return null;
    return {
      tiles: urls.tiles,
      speedpad: urls.speedpad,
      speedpadRed: urls.speedpadRed,
      speedpadBlue: urls.speedpadBlue,
      portal: urls.portal,
      portalRed: urls.portalRed || urls.portal,
      portalBlue: urls.portalBlue || urls.portal,
      gravityWell: urls.gravityWell
    };
  }

  function clonePack(pack) {
    return {
      id: pack.id,
      name: pack.name,
      author: pack.author || '',
      urls: cloneUrls(pack.urls),
      fallbackUrls: cloneUrls(pack.fallbackUrls)
    };
  }

  function urlsFromFm(id) {
    var base = FM_TEXTURE_BASE + encodeURIComponent(id) + '/';
    return {
      tiles: proxied(base + 'tiles.png'),
      speedpad: proxied(base + 'speedpad.png'),
      speedpadRed: proxied(base + 'speedpadred.png'),
      speedpadBlue: proxied(base + 'speedpadblue.png'),
      portal: proxied(base + 'portal.png'),
      portalRed: proxied(base + 'portalred.png'),
      portalBlue: proxied(base + 'portalblue.png'),
      gravityWell: proxied(base + 'gravitywell.png')
    };
  }

  function absTextureUrl(p) {
    if (!p) return '';
    if (/^(https?:|data:)/i.test(p)) return p;
    if (p.indexOf('/images/') === 0) return 'https://static.koalabeast.com' + p;
    if (p.charAt(0) === '/') return 'https://tagpro.koalabeast.com' + p;
    return p;
  }

  function proxied(url) {
    url = absTextureUrl(url);
    if (!url) return '';
    if (/^(data:)/i.test(url) || !/^https?:/i.test(url)) return url;
    return '/tp/image?u=' + encodeURIComponent(url);
  }

  function urlsFromOfficial(entry) {
    return {
      tiles: proxied(entry.tiles),
      speedpad: proxied(entry.speedpad),
      speedpadRed: proxied(entry.speedpadRed),
      speedpadBlue: proxied(entry.speedpadBlue),
      portal: proxied(entry.portal),
      portalRed: proxied(entry.portalRed || entry.portalred) || proxied(entry.portal),
      portalBlue: proxied(entry.portalBlue || entry.portalblue) || proxied(entry.portal),
      gravityWell: proxied(entry.gravityWell || '/images/gravitywell.png')
    };
  }

  function packFromOfficial(entry) {
    return {
      id: entry.id,
      name: entry.name,
      author: entry.author || '',
      urls: urlsFromOfficial(entry),
      fallbackUrls: FM_PACK_SET[entry.id] ? urlsFromFm(entry.id) : null
    };
  }

  function findOfficial(id) {
    for (var i = 0; i < official.length; i++) {
      if (official[i].id === id) return official[i];
    }
    return null;
  }

  function urlFor(type) {
    var slot = type.image ? (SLOT_BY_IMAGE[type.image] || 'tiles') : 'tiles';
    var urls = current.urls || EDITOR_DEFAULT.urls;
    var url = urls[slot];
    if (!url && (slot === 'portalRed' || slot === 'portalBlue')) url = urls.portal;
    return url || urls.tiles || EDITOR_DEFAULT.urls.tiles;
  }

  function setStatus(text) {
    $('#texturePackMeta').text(text || '');
  }

  function persist(pack) {
    try { localStorage.setItem(ID_KEY, pack.id); } catch (err) {}
    if (pack.id === 'imported') {
      try {
        localStorage.setItem(IMPORTED_KEY, JSON.stringify({
          name: pack.name,
          author: pack.author || '',
          urls: pack.urls
        }));
      } catch (err) {
        setStatus('Pack applied, but it was too large to remember after refresh.');
      }
    }
  }

  function loadImported() {
    try {
      var raw = localStorage.getItem(IMPORTED_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.urls || !data.urls.tiles) return null;
      imported = {
        id: 'imported',
        name: data.name || 'Imported pack',
        author: data.author || '',
        urls: data.urls
      };
      return imported;
    } catch (err) {
      return null;
    }
  }

  function officialEntryFromId(id) {
    return {
      id: id,
      name: id,
      author: '',
      tiles: '/textures/' + id + '/tiles.png',
      speedpad: '/textures/' + id + '/speedpad.png',
      speedpadRed: '/textures/' + id + '/speedpadred.png',
      speedpadBlue: '/textures/' + id + '/speedpadblue.png',
      portal: '/textures/' + id + '/portal.png',
      portalRed: '/textures/' + id + '/portalred.png',
      portalBlue: '/textures/' + id + '/portalblue.png',
      gravityWell: '/images/gravitywell.png'
    };
  }

  function packFromIdImmediate(id) {
    if (!id || id === EDITOR_DEFAULT.id) return clonePack(EDITOR_DEFAULT);
    if (id === 'imported') return imported ? clonePack(imported) : packFromIdImmediate('classic');
    var entry = findOfficial(id);
    if (entry) return packFromOfficial(entry);
    return packFromOfficial(officialEntryFromId(id));
  }

  function packById(id) {
    if (!id || id === EDITOR_DEFAULT.id) return clonePack(EDITOR_DEFAULT);
    if (id === 'imported') return imported ? clonePack(imported) : packFromIdImmediate('classic');
    var entry = findOfficial(id);
    return entry ? packFromOfficial(entry) : clonePack(EDITOR_DEFAULT);
  }

  function preload(url) {
    return new Promise(function(resolve, reject) {
      if (!url) return resolve();
      var img = new Image();
      img.onload = function() { resolve(url); };
      img.onerror = function() { reject(new Error('load')); };
      img.src = url;
    });
  }

  function apply(pack, opts) {
    opts = opts || {};
    current = clonePack(pack);
    persist(current);
    syncSelect();
    if (!opts.skipRedraw && window.TagproMap && TagproMap.redrawTextures) {
      TagproMap.redrawTextures();
    }
    var label = current.name + (current.author ? ' — ' + current.author : '');
    if (!opts.silentStatus) setStatus(label);
    return current;
  }

  function applyById(id) {
    var pack = packById(id);
    applying = true;
    setStatus('Loading ' + pack.name + '…');
    function failToDefault() {
      apply(clonePack(EDITOR_DEFAULT), { silentStatus: true });
      setStatus('Could not load that pack. Editor Default is still selected.');
    }
    return preload(pack.urls.tiles).then(function() {
      apply(pack);
    }).catch(function() {
      if (!pack.fallbackUrls || pack.fallbackUrls.tiles === pack.urls.tiles) {
        failToDefault();
        return;
      }
      pack.urls = cloneUrls(pack.fallbackUrls);
      return preload(pack.urls.tiles).then(function() {
        apply(pack);
      }).catch(failToDefault);
    }).then(function() {
      applying = false;
    });
  }

  function fillSelect() {
    var $sel = $('#texturePackSelect');
    if (!$sel.length) return;
    var html = '<optgroup label="Editor"><option value="editor-default">Editor Default</option></optgroup>';
    html += '<optgroup label="FortunateMaps / Official TagPro">';
    for (var i = 0; i < official.length; i++) {
      var p = official[i];
      html += '<option value="' + p.id + '">' + escapeHtml(p.name) + (p.author ? ' — ' + escapeHtml(p.author) : '') + '</option>';
    }
    html += '</optgroup>';
    if (imported) {
      html += '<optgroup label="Imported"><option value="imported">' + escapeHtml(imported.name || 'Imported pack') + '</option></optgroup>';
    }
    $sel.html(html);
    syncSelect();
  }

  function syncSelect() {
    var $sel = $('#texturePackSelect');
    if ($sel.length) $sel.val(current.id);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function readFileAsText(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(reader.error); };
      reader.readAsText(file);
    });
  }

  function slotFromFilename(filename) {
    var n = String(filename || '').replace(/^.*[\\/]/, '').toLowerCase();
    if (/gravitywell/.test(n)) return 'gravityWell';
    if (/speedpadred|speedpad-red|speedpad_red/.test(n)) return 'speedpadRed';
    if (/speedpadblue|speedpad-blue|speedpad_blue/.test(n)) return 'speedpadBlue';
    if (/speedpad/.test(n)) return 'speedpad';
    if (/portalred|portal-red/.test(n)) return 'portalRed';
    if (/portalblue|portal-blue/.test(n)) return 'portalBlue';
    if (/portal/.test(n)) return 'portal';
    if (/tiles|default-skin/.test(n)) return 'tiles';
    return null;
  }

  function readFileAsDataUrl(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(reader.error); };
      reader.readAsDataURL(file);
    });
  }

  function mergeImportedUrls(overrides) {
    var base = (imported && imported.urls) || current.urls || EDITOR_DEFAULT.urls;
    return {
      tiles: overrides.tiles || base.tiles,
      speedpad: overrides.speedpad || base.speedpad,
      speedpadRed: overrides.speedpadRed || base.speedpadRed,
      speedpadBlue: overrides.speedpadBlue || base.speedpadBlue,
      portal: overrides.portal || base.portal,
      portalRed: overrides.portalRed || base.portalRed || overrides.portal || base.portal,
      portalBlue: overrides.portalBlue || base.portalBlue || overrides.portal || base.portal,
      gravityWell: overrides.gravityWell || base.gravityWell
    };
  }

  function saveImportedPack(name, urls) {
    imported = {
      id: 'imported',
      name: name || 'Imported pack',
      author: '',
      urls: urls
    };
    fillSelect();
    return applyById('imported');
  }

  function shareKey(obj, names) {
    for (var i = 0; i < names.length; i++) {
      if (obj[names[i]]) return obj[names[i]];
    }
    return '';
  }

  function urlsFromShareObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var tiles = shareKey(obj, ['tiles', 'Tiles', 'tile']);
    if (!tiles) return null;
    return {
      tiles: proxied(tiles),
      speedpad: proxied(shareKey(obj, ['speedpad', 'speedPad'])) || EDITOR_DEFAULT.urls.speedpad,
      speedpadRed: proxied(shareKey(obj, ['speedpadRed', 'speedpadred', 'speedPadRed'])) || EDITOR_DEFAULT.urls.speedpadRed,
      speedpadBlue: proxied(shareKey(obj, ['speedpadBlue', 'speedpadblue', 'speedPadBlue'])) || EDITOR_DEFAULT.urls.speedpadBlue,
      portal: proxied(shareKey(obj, ['portal'])) || EDITOR_DEFAULT.urls.portal,
      portalRed: proxied(shareKey(obj, ['portalRed', 'portalred'])) || EDITOR_DEFAULT.urls.portalRed,
      portalBlue: proxied(shareKey(obj, ['portalBlue', 'portalblue'])) || EDITOR_DEFAULT.urls.portalBlue,
      gravityWell: proxied(shareKey(obj, ['gravityWell', 'gravitywell'])) || EDITOR_DEFAULT.urls.gravityWell
    };
  }

  function parseImportText(text) {
    text = String(text || '').trim();
    if (!text) return null;
    if (text.charAt(0) === '{' || text.charAt(0) === '[') {
      var obj = JSON.parse(text);
      if (Array.isArray(obj)) obj = obj[0];
      var urls = urlsFromShareObject(obj);
      if (!urls) throw new Error('sharepack');
      return { urls: urls, name: obj.name || 'Imported pack' };
    }
    var slug = text.match(/koalabeast\.com\/textures\/([a-z0-9_-]+)/i);
    if (slug) return { officialId: slug[1].toLowerCase() };
    if (/^https?:\/\//i.test(text)) {
      return { urls: mergeImportedUrls({ tiles: proxied(text) }), name: 'Imported pack' };
    }
    if (/^[a-z0-9_-]+$/i.test(text) && findOfficial(text.toLowerCase())) {
      return { officialId: text.toLowerCase() };
    }
    throw new Error('format');
  }

  function importFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return Promise.resolve();
    var jsonFile = null;
    var images = [];
    for (var i = 0; i < files.length; i++) {
      if (/\.json$/i.test(files[i].name) || files[i].type === 'application/json') jsonFile = files[i];
      else images.push(files[i]);
    }
    var jsonPromise = jsonFile ? readFileAsText(jsonFile).then(parseImportText) : Promise.resolve(null);

    return jsonPromise.then(function(parsed) {
      if (parsed && parsed.officialId) return applyById(parsed.officialId);
      var overrides = (parsed && parsed.urls) ? {
        tiles: parsed.urls.tiles,
        speedpad: parsed.urls.speedpad,
        speedpadRed: parsed.urls.speedpadRed,
        speedpadBlue: parsed.urls.speedpadBlue,
        portal: parsed.urls.portal,
        portalRed: parsed.urls.portalRed,
        portalBlue: parsed.urls.portalBlue,
        gravityWell: parsed.urls.gravityWell
      } : {};
      return Promise.all(images.map(function(file) {
        var slot = slotFromFilename(file.name);
        if (!slot && images.length === 1) slot = 'tiles';
        if (!slot) return null;
        return readFileAsDataUrl(file).then(function(url) {
          overrides[slot] = url;
        });
      })).then(function() {
        if (!overrides.tiles) {
          setStatus('Import a tiles.png (640×440) or a TagPro sharepack JSON.');
          return;
        }
        return saveImportedPack(parsed && parsed.name, mergeImportedUrls(overrides));
      });
    }).catch(function() {
      setStatus('Could not import that texture pack.');
    });
  }

  function savedPackId() {
    var saved = 'classic';
    try { saved = localStorage.getItem(ID_KEY) || saved; } catch (err) {}
    return saved;
  }

  function syncTilesheetCss() {
    var tilesUrl = (current && current.urls && current.urls.tiles) || EDITOR_DEFAULT.urls.tiles;
    var sheet = document.getElementById('texturePackSheet');
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = 'texturePackSheet';
      document.head.appendChild(sheet);
    }
    sheet.textContent = 'div.tileQuadrant{background-image:url("' + String(tilesUrl).replace(/"/g, '\\"') + '") !important;}';
  }

  function applySavedPackSync() {
    loadImported();
    current = packFromIdImmediate(savedPackId());
    var label = current.name + (current.author ? ' — ' + current.author : '');
    setStatus(label);
    syncTilesheetCss();
  }

  applySavedPackSync();

  window.TagproTextures = {
    urlFor: urlFor,
    tilesUrl: function() { return current.urls.tiles; },
    current: function() { return current; }
  };

  $('#texturePackSelect').on('change', function() {
    if (applying) return;
    applyById($(this).val());
  });
  $('#textureImportFiles').on('click', function(e) {
    e.preventDefault();
    $('#texturePackFiles').val('').trigger('click');
  });
  $('#texturePackFiles').on('change', function() {
    importFiles(this.files);
  });
  $('#textureImportUrl').on('click', function(e) {
    e.preventDefault();
    var box = document.getElementById('textureUrlImport');
    if (box) box.hidden = !box.hidden;
  });
  $('#textureUrlApply').on('click', function() {
    try {
      var parsed = parseImportText($('#textureSharepack').val());
      if (!parsed) return;
      if (parsed.officialId) {
        applyById(parsed.officialId);
        return;
      }
      saveImportedPack(parsed.name, mergeImportedUrls(parsed.urls));
    } catch (err) {
      setStatus('Paste a TagPro sharepack JSON, tiles.png URL, or official pack slug.');
    }
  });

  function mergeFortunateMapsPacks() {
    var have = {};
    for (var i = 0; i < official.length; i++) have[official[i].id] = true;
    for (var j = 0; j < FM_PACK_IDS.length; j++) {
      var id = FM_PACK_IDS[j];
      if (have[id]) continue;
      official.push({
        id: id,
        name: id,
        author: '',
        tiles: FM_TEXTURE_BASE + id + '/tiles.png',
        speedpad: FM_TEXTURE_BASE + id + '/speedpad.png',
        speedpadRed: FM_TEXTURE_BASE + id + '/speedpadred.png',
        speedpadBlue: FM_TEXTURE_BASE + id + '/speedpadblue.png',
        portal: FM_TEXTURE_BASE + id + '/portal.png',
        portalRed: FM_TEXTURE_BASE + id + '/portalred.png',
        portalBlue: FM_TEXTURE_BASE + id + '/portalblue.png',
        gravityWell: FM_TEXTURE_BASE + id + '/gravitywell.png'
      });
    }
  }

  function loadCatalog() {
    var done = $.Deferred();
    function useList(list) {
      official = Array.isArray(list) ? list : [];
      mergeFortunateMapsPacks();
      done.resolve();
    }
    $.getJSON('/tp/catalog').done(useList).fail(function() {
      $.getJSON('official-texture-packs.json').done(useList).fail(function() {
        official = [];
        mergeFortunateMapsPacks();
        done.resolve();
      });
    });
    return done.promise();
  }

  loadCatalog().always(function() {
    fillSelect();
    var saved = savedPackId();
    var pack = packById(saved);
    var sameTiles = current && current.urls && pack.urls && current.urls.tiles === pack.urls.tiles;
    if (sameTiles && current.id === pack.id) {
      current = clonePack(pack);
      persist(current);
      syncSelect();
      setStatus(current.name + (current.author ? ' — ' + current.author : ''));
      applying = true;
      preload(pack.urls.tiles).then(function() {
        applying = false;
      }).catch(function() {
        applying = false;
        applyById(saved);
      });
      return;
    }
    applyById(saved);
  });
});
