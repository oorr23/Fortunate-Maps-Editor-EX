$(function() {
  var importJson;
  var importPng;

  var maxZoom = 8;
  var zoom = 0;
  var fitMode = 'contain';
  var tileSize = 8;
  var tileSheetWidth = 16;
  var tileSheetHeight = 11;
  
  // Tilesheet sprite origin. Mars Ball is a 2×2 cell (multiplier 0.5 at sheet 12,9).
  // Do not add a centering shift when mult !== 1 — that crops the wrong region.
  // FortunateMaps: -sheetX * cell * multiplier (e.g. 40px cell → -240px -180px, size 320×220).
  function sheetBackgroundPosition(x, y, cell, mult) {
    if (mult) return (-x * cell * mult) + 'px ' + (-y * cell * mult) + 'px';
    return (-x * cell) + 'px ' + (-y * cell) + 'px';
  }
  function positionCss(x, y, mult) {
    return sheetBackgroundPosition(x, y, tileSize, mult);
  }
  function TileType(name, sheetX, sheetY, r,g,b, toolTipText, extra) {
    this.name = name;
    this.sheetX = sheetX;
    this.sheetY = sheetY;
    this.color = String.fromCharCode(r)+String.fromCharCode(g)+String.fromCharCode(b)+String.fromCharCode(255);
    this.postPlaceFn = extra&&extra.postPlaceFn;
    this.logicFn = extra&&extra.logicFn;
    this.image = extra&&extra.image;
    this.imageTileWidth = extra&&extra.imageTileWidth||5;
    this.imageTileHeight = extra&&extra.imageTileHeight||1;
    this.multiplier = extra&&extra.multiplier||1;
    this.wallSolids = (extra&&extra.wallSolids)|0;
    this.rgb = r | (g<<8) | (b<<16);
    this.opposite = this; // What it switches to when mirrored
    this.verticalMirror = this;
    this.horizontalMirror = this;
    this.plusNinetyRotator = this;
    this.minusNinetyRotator = this;
    this.toolTipText = toolTipText;
  }
  TileType.prototype.isWall = function() {
    return !!this.wallSolids;
  }
  TileType.prototype.positionCss = function() {
    return positionCss(this.sheetX, this.sheetY, this.multiplier);
  }
  function textureSrcFor(type) {
    if (window.TagproTextures && TagproTextures.urlFor) return TagproTextures.urlFor(type);
    return (type.image || 'default-skin-v2') + '.png';
  }
  var PALETTE_CELL = 40;

  function bustDrawCache($elem) {
    if (!$elem || !$elem.length) return;
    $elem.styleUrl = $elem.styleBackgroundSize = $elem.styleBgColor = undefined;
    var node = $elem[0];
    if (node) {
      node.styleUrl = node.styleBackgroundSize = node.styleBgColor = undefined;
    }
  }
  TileType.prototype.drawOn = function($elem, tile, onTop) {
    var $target = (onTop && tile && tile.topSquare) ? $(tile.topSquare) : $elem;
    var styleBgColor = '';
    var src = this.name == 'empty' ? '' : textureSrcFor(this);
    var styleUrl = src ? 'url("' + src + '")' : '';
    var styleBackgroundSize = this.image
      ? (this.imageTileWidth*tileSize+'px ' + this.imageTileHeight*tileSize + 'px')
      : (tileSheetWidth*tileSize*this.multiplier + 'px ' + tileSheetHeight*tileSize*this.multiplier + 'px');
    if (this.name == 'empty') {
      styleBgColor = 'black';
      styleUrl = '';
    }
    if (onTop || styleBgColor != $elem.styleBgColor) {
      $target.css('background-color', styleBgColor);
      if (!onTop) $elem.styleBgColor = styleBgColor;
    }
    if (onTop || styleBackgroundSize != $elem.styleBackgroundSize) {
      $target.css('background-size', styleBackgroundSize);
      if (!onTop) $elem.styleBackgroundSize = styleBackgroundSize;
    }
    if (!onTop && styleUrl != $elem.styleUrl) {
      $elem.css('background-image', styleUrl)
      $elem.styleUrl = styleUrl;
    }
    if (onTop) {
      $target.css('background-image', styleUrl);
    }
    if (!onTop && tile && tile.quadrantElems) {
      if (this.isWall()) {
        var x = tile.x, y = tile.y;
        // Beware: dragons
        for (var q=0; q<4; q++) { // loop through this tile's four quadrants like a clock: TR, BR, BL, TL
          var mask = (this.wallSolids >> (q<<1)) & 3; // See what is filled in in this quadrant
          
          if (mask==0) {
            tile.quadrantElems[q].style.display='none';
          } else {
            // This quadrant is next to some grid corner. We use some bit patterns to tell which.
            var cornerX = x + ((q&2)==0 ? 1 : 0); 
            var cornerY = y + ((((q+1)&2)==0) ? 0 : 1);
            // Figure out the filled/unfilledness of the 8 spots around this corner
            var aroundCorner = 
               (wallSolidsAt(cornerX,cornerY, tile)&0xc0)|
               (wallSolidsAt(cornerX-1, cornerY, tile)&0x03)| 
               (wallSolidsAt(cornerX-1, cornerY-1, tile)&0x0c)| 
               (wallSolidsAt(cornerX, cornerY-1, tile)&0x30);
            aroundCorner = aroundCorner|(aroundCorner<<8);
            var startDirection = q*2 + 1; // start pointing through the middle of our own quadrant
            // See how far we can rotate clockwise without falling off the wall
            var cwSteps = 0; 
            while (cwSteps<8 && (aroundCorner & (1<<(startDirection+cwSteps)))) {
              cwSteps++;
            }
            // See how far we can rotate counterclockwise without falling off the wall
            var ccwSteps = 0;
            while (ccwSteps<8 && (aroundCorner & (1<<(startDirection+7-ccwSteps)))) {
              ccwSteps++;
            }
            
            // There is a chip out of this quadrant's corner if it is solid and across from us, on the
            // same tile, is empty. (This is the corner by the center of the tile.)
            var hasChip = mask==3 && (((this.wallSolids|(this.wallSolids<<8)) >> ((q+2)<<1))&3)==0;
            
            var solidStart,solidEnd;
            if (cwSteps==8) {
              // We're surrounded!
              solidStart=solidEnd=0;
            } else {
              // The +4 is because of the mirroredness of looking in the corner instead of around this tile's center
              solidEnd = (startDirection + cwSteps + 4) % 8;
              solidStart = (startDirection - ccwSteps + 12) % 8;
            }
            
            var coords = quadrantCoords && quadrantCoords[q+''+solidStart+''+solidEnd + (hasChip?'d':'')];
            if (!coords) {
              coords = [5.5,5.5];
            }
            tile.quadrantElems[q].style.display='inline-block';
            tile.quadrantElems[q].style.backgroundPosition = positionCss(coords[0], coords[1]);
          }
        }
        var idx = (isWall(x-1,y)?1:0) | (isWall(x+1,y)?2:0) | (isWall(x,y-1)?4:0) | (isWall(x,y+1)?8:0);
        var coords = [5.5,5.5]/*[
          [0,0], //
          [9,6], // L
          [8,6], // R
          [2,4], // LR
          [0,6], // U
          [6,8], // LU
          [2,8], // RU
          [4,8], // LRU
          [0,2],  // D
          [6,0], // LD
          [2,0], // RD
          [4,0], // LRD
          [4,1], // UD
          [7,4], // LUD
          [0,4], // RUD
          [4,4]  // LRUD
        ][idx];*/
        $elem.css('background-position', floorType.positionCss())
      } else {
        if (tile && tile.quadrantElems) {
          for (var q=0; q<4; q++) {
            tile.quadrantElems[q].style.display='none';
          }
        }
        $target.css('background-position', this.positionCss())
      }
    } else {
      $target.css('background-position', this.positionCss())
    }
    if (onTop) {
      $target.css({ position: 'absolute', display: 'inline-block' });
    }
  }


  function Tool(fns) {
    this.type = fns.type || '';
    this.down = fns.down || function() {};
    this.speculateDrag = fns.speculateDrag || function() {};
    this.speculateUp = fns.speculateUp || function() {};
    this.drag = fns.drag || function() {};
    this.up = fns.up || function() {};
    this.select = fns.select || function() {};
    this.unselect = fns.unselect || function() {};
    this.stateChange = fns.stateChange || function() {}; // arbitrary state change happened -- redraw tool state if necessary
    this.getState = fns.getState || function() {};
    this.setState = fns.setState || function() {};
    this.previewOnly = !!fns.previewOnly;
  }
  var pencil = new Tool({
    speculateDrag: function(x,y) {
      return new UndoStep([
        new TileState(tiles[x][y], {type:brushTileType})
      ]);
    },
  });
  var brush = new Tool({
    speculateDrag: function(x,y) {
      var changes = [];
      for (var ix=x-1; ix<=x+1; ix++) {
        for (var iy=y-1; iy<=y+1; iy++) {
          if (ix>=0 && iy>=0 && ix<width && iy<height) {
            changes.push(new TileState(tiles[ix][iy], {type:brushTileType}));
          }
        }
      }
      return new UndoStep(changes);
    }
  });

  function lineFn (x0, y0, x1, y1) {
    var deltaX = x1 - x0;
    var deltaY = y1 - y0;
    var y = 0;

    var lineTiles = [];

    if (deltaX == 0) {
      var low = Math.min(y0, y1);
      var high = Math.max(y0, y1);
      for (var yi = low; yi <= high; yi++) {
        lineTiles.push({x: x0, y: yi});
      }

    } else if (deltaY == 0) {
      var left = Math.min(x0, x1);
      var right = Math.max(x0, x1);
      for (var xi = left; xi <= right; xi++) {
        lineTiles.push({x: xi, y: y0});
      }

    } else {
      var slope = deltaY / deltaX;
      var intercept;
      var intercept = y0 - slope * x0;

      if (Math.abs(slope) <= 1) {
        var left = Math.min(x0, x1);
        var right = Math.max(x0, x1);
        for (var xi = left; xi <= right; xi++) {
          var y = slope * xi + intercept;
          lineTiles.push({x: xi, y: Math.round(y)});
        }
      } else {
        var low = Math.min(y0, y1);
        var high = Math.max(y0, y1);
        for (var yi = low; yi <= high; yi++) {
          var x = (yi-intercept) / slope;
          lineTiles.push({x: Math.round(x), y: yi});
        }
      }
    }

    return lineTiles;
  }

  function constrainToSquare(x0, y0, x1, y1) {

    var xPrime, yPrime;
    var xOffset = Math.abs(x1-x0), yOffset = Math.abs(y1-y0);
    var offsetMin = Math.min(xOffset, yOffset);
    if (x1 >= x0 && y1 >= y0) {         // Quadrant I
      xPrime = x0 + offsetMin;
      yPrime = y0 + offsetMin;
    } else if (x1 <= x0 && y1 >= y0) {  // Quadrant II
      xPrime = x0 - offsetMin;
      yPrime = y0 + offsetMin;
    } else if (x1 <= x0 && y1 <= y0) {  // Quadrant III
      xPrime = x0 - offsetMin;
      yPrime = y0 - offsetMin;
    } else  {                           // Quadrant IV
      xPrime = x0 + offsetMin;
      yPrime = y0 - offsetMin;
    }
    return {x: xPrime, y: yPrime};
  }

  var line = new Tool({
    down: function(x,y) {
      this.downX = x;
      this.downY = y;
      console.log('down at ', x,y);
    },
    speculateUp: function(x,y) {
      var coordinates = lineFn(this.downX===undefined?x:this.downX, this.downY===undefined?y:this.downY, x, y);
      var calculatedTiles = [];
      for (var i = 0; i < coordinates.length; i++) {
        calculatedTiles.push(new TileState(tiles[coordinates[i].x][coordinates[i].y], {type: brushTileType}));
      }
      return new UndoStep(calculatedTiles);
    },
    up: function(x,y) {
      this.downX = undefined;
      this.downY = undefined;
    }
  })


  function rectFn (x0, y0, x1, y1, fill) {
    if (shiftDown) { // constrain to diagonal
      var adjustedPoint1 = constrainToSquare(x0,y0,x1,y1);
      x1 = adjustedPoint1.x;
      y1 = adjustedPoint1.y
    }
    var rectTiles = [];
    var left = Math.min(x0, x1);
    var right = Math.max(x0, x1);
    var low = Math.min(y0, y1);
    var high = Math.max(y0, y1);
    for (var xi = left; xi <= right; xi++) {
      for (var yi = low; yi <= high; yi++) {
        var addTile = fill || xi == left || xi == right || yi == low || yi == high;
        if (addTile) {
          rectTiles.push({x: xi, y: yi});
        }
      }
    }
    return rectTiles;
  }

  var rectFill = new Tool({
    down: function(x,y) {
      this.downX = x;
      this.downY = y;
      console.log('down at ', x,y);
    },
    speculateUp: function(x,y) {
      var coordinates = rectFn(this.downX===undefined?x:this.downX, this.downY===undefined?y:this.downY, x, y, true);
      var calculatedTiles = [];
      for (var i = 0; i < coordinates.length; i++) {
        calculatedTiles.push(new TileState(tiles[coordinates[i].x][coordinates[i].y], {type: brushTileType}));
      }
      return new UndoStep(calculatedTiles);
    },
    up: function(x,y) {
      this.downX = undefined;
      this.downY = undefined;
    }
  })

  var rectOutline = new Tool({
    down: function(x,y) {
      this.downX = x;
      this.downY = y;
      console.log('down at ', x,y);
    },
    speculateUp: function(x,y) {
      var coordinates = rectFn(this.downX===undefined?x:this.downX, this.downY===undefined?y:this.downY, x, y, false);
      var calculatedTiles = [];
      for (var i = 0; i < coordinates.length; i++) {
        calculatedTiles.push(new TileState(tiles[coordinates[i].x][coordinates[i].y], {type: brushTileType}));
      }
      return new UndoStep(calculatedTiles);
    },
    up: function(x,y) {
      this.downX = undefined;
      this.downY = undefined;
    }
  })

  // taken from http://members.chello.at/~easyfilter/bresenham.html
  function circleFn (x0, y0, x1, y1, fill) {
    if (shiftDown) { // constrain to diagonal
      var adjustedPoint1 = constrainToSquare(x0,y0,x1,y1);
      x1 = adjustedPoint1.x;
      y1 = adjustedPoint1.y
    }

    var circleTiles = [];
    var a = Math.abs(x1-x0), b = Math.abs(y1-y0), b1 = b&1; /* values of diameter */
    var dx = 4*(1-a)*b*b, dy = 4*(b1+1)*a*a; /* error increment */
    var err = dx+dy+b1*a*a, e2; /* error of 1.step */

    if (x0 > x1) { x0 = x1; x1 += a; } /* if called with swapped points */
    if (y0 > y1) y0 = y1; /* .. exchange them */
    y0 += (b+1)/2; y1 = y0-b1;   /* starting pixel */
    a *= 8*a; b1 = 8*b*b;

    function addToCircleTiles(x, y) {
      var flooredY = Math.floor(y);
      circleTiles.push({x: x, y: flooredY});
      if (fill) {
        for (var yi = Math.floor(y1); yi < flooredY; yi++) {
          circleTiles.push({x: x, y: yi});
        }
      }
    }
    do {
      addToCircleTiles(x1, y0); /*   I. Quadrant */
      addToCircleTiles(x0, y0); /*  II. Quadrant */
      addToCircleTiles(x0, y1); /* III. Quadrant */
      addToCircleTiles(x1, y1); /*  IV. Quadrant */
      e2 = 2*err;
      if (e2 <= dy) { y0++; y1--; err += dy += a; }  /* y step */
      if (e2 >= dx || 2*err > dy) { x0++; x1--; err += dx += b1; } /* x step */
    } while (x0 <= x1);

    while (y0-y1 < b) {  /* too early stop of flat ellipses a=1 */
      addToCircleTiles(x0-1, y0); /* -> finish tip of ellipse */
      addToCircleTiles(x1+1, y0++);
      addToCircleTiles(x0-1, y1);
      addToCircleTiles(x1+1, y1--);
    }
    return circleTiles;
  }

  var circleFill = new Tool({
    down: function(x,y) {
      this.downX = x;
      this.downY = y;
      console.log('down at ', x,y);
    },
    speculateUp: function(x,y) {
      var coordinates = circleFn(this.downX===undefined?x:this.downX, this.downY===undefined?y:this.downY, x, y, true);
      var calculatedTiles = [];
      for (var i = 0; i < coordinates.length; i++) {
        calculatedTiles.push(new TileState(tiles[coordinates[i].x][coordinates[i].y], {type: brushTileType}));
      }
      return new UndoStep(calculatedTiles);
    },
    up: function(x,y) {
      this.downX = undefined;
      this.downY = undefined;
    }
  })

  var circleOutline = new Tool({
    down: function(x,y) {
      this.downX = x;
      this.downY = y;
      console.log('down at ', x,y);
    },
    speculateUp: function(x,y) {
      var coordinates = circleFn(this.downX===undefined?x:this.downX, this.downY===undefined?y:this.downY, x, y, false);
      var calculatedTiles = [];
      for (var i = 0; i < coordinates.length; i++) {
        calculatedTiles.push(new TileState(tiles[coordinates[i].x][coordinates[i].y], {type: brushTileType}));
      }
      return new UndoStep(calculatedTiles);
    },
    up: function(x,y) {
      this.downX = undefined;
      this.downY = undefined;
    }
  })

  var fill = new Tool({
    speculateUp: function(x,y) {
      var targetType = tiles[x][y].type;

      var toChange = [ tiles[x][y] ];

      var changed = [ new TileState(tiles[x][y], {type:brushTileType}) ];
      var inChanged = {};
      while (toChange.length > 0) {

        var tempToChange = [];

        toChange.forEach(function(tile) {
          for (var ix=tile.x-1; ix<=tile.x+1; ix++) {
            for (var iy=tile.y-1; iy<=tile.y+1; iy++) {
              if (Math.abs(tile.x-ix) + Math.abs(tile.y-iy) == 1&& ix>=0 && iy>=0 && ix<width && iy<height) {
                var test = tiles[ix][iy];
                if (test.type == targetType && !inChanged[xy(test)]) {
                  tempToChange.push(test);
                  changed.push(new TileState(test, {type: brushTileType}));
                  inChanged[xy(test)] = true;
                }
              }
            }
          }
        });
        toChange = tempToChange;
      }
      return new UndoStep(changed);
    }
  })

  var wire = new Tool({
    type: 'special',
    unselect: function() {
      clearHighlights();
      this.selectedSwitch = null;
    },
    stateChange: function() {
      this.refreshHighlights();
    },
    getState: function() {
      console.log('storing state', this.selectedSwitch && xy(this.selectedSwitch))
      return {selectedSwitch: this.selectedSwitch}
    },
    setState: function(state) {
      this.selectedSwitch = state.selectedSwitch;
      console.log('restored state', this.selectedSwitch && xy(this.selectedSwitch))
    },
    speculateUp: function(x,y) {
      var tile = tiles[x][y];
      var change = null;
      if (isAnyPortal(tile.type) && this.selectedSwitch && isEnterablePortal(this.selectedSwitch.type)) {
        change = new TileState(this.selectedSwitch, {destination: tile})
        console.log('making destination action to', xy(tile));
        this.selectedSwitch = null;
      } else if (isEnterablePortal(tile.type)) {
        this.selectedSwitch = tile;
        console.log('selected ', xy(this.selectedSwitch));
      } else if (tile.type == switchType) {
        this.selectedSwitch = tile;
      } else if (this.selectedSwitch && this.selectedSwitch.type == switchType) {
        var affected = this.selectedSwitch.affected || ( this.selectedSwitch.affected={});
        var affected = {};
        for (var key in (this.selectedSwitch.affected||{})) {
          affected[key] = this.selectedSwitch.affected[key];;
        }
        var hitKey = xy(tile);
        if (affected[hitKey]) delete affected[hitKey];
        else affected[hitKey] = tile;
        
        change = new TileState(this.selectedSwitch, {affected: affected});
      }
      return new UndoStep(change ? [change] : []);
    }
  });
  wire.refreshHighlights = function() {
    clearHighlights();
    if (this.selectedSwitch) {
      this.selectedSwitch.highlight(true);
      if (isEnterablePortal(this.selectedSwitch.type)) {
        if (this.selectedSwitch.destination) {
          this.selectedSwitch.destination.highlight(true);
        }
      } else if (this.selectedSwitch.type == switchType) {
        var sel = this.selectedSwitch.affected || ( this.selectedSwitch.affected={});
        for (var key in sel) {
          sel[key].highlight(true);
        }
      }
    }
  }

  function clearHighlights() {
    $map.find('.selectionIndicator').css('display', 'none');
    $map.find('.potentialHighlight').css('display', 'none');
    if (window.TagproLoupe && TagproLoupe.refresh) TagproLoupe.refresh();
  }

  function pairType(ty, axis) {
    var mirrored = axis === 'h' ? ty.horizontalMirror : ty.verticalMirror;
    if (mirrored && mirrored !== ty) return mirrored;
    return ty.opposite || ty;
  }

  function mirrorDirFromClick(x, y) {
    var dl = x;
    var dr = width - 1 - x;
    var dt = y;
    var db = height - 1 - y;
    var nearest = Math.min(dl, dr, dt, db);
    if (nearest === dl) return 'right';
    if (nearest === dr) return 'left';
    if (nearest === dt) return 'down';
    return 'up';
  }

  var mapClipboard = null;
  var oddSnapToastTimer = 0;

  function isMobileLayout() {
    if (window.TagproLayout && window.TagproLayout.isMobile) return window.TagproLayout.isMobile();
    return !document.documentElement.classList.contains('layout-desktop');
  }

  function showMapToast(msg) {
    var el = document.getElementById('fmToast');
    if (!el) return;
    el.textContent = msg;
    el.removeAttribute('hidden');
    el.classList.add('is-on');
    if (oddSnapToastTimer) clearTimeout(oddSnapToastTimer);
    oddSnapToastTimer = setTimeout(function() {
      oddSnapToastTimer = 0;
      el.classList.remove('is-on');
      el.setAttribute('hidden', '');
    }, 2000);
  }

  function maybeToastOddSnap(x0, y0, x1, y1, tool) {
    if (!isMobileLayout() || !tool || tool.oddSnapToasted) return;
    var r = clipSelectRect(x0, y0, x1, y1);
    if (r.x1 !== x1 || r.y1 !== y1) {
      tool.oddSnapToasted = true;
      showMapToast('Selection snapped to an odd size so paste can center.');
    }
  }

  function oddSpanEnd(start, end) {
    var d = end - start;
    if (((Math.abs(d) + 1) % 2) === 0) end -= (d >= 0 ? 1 : -1);
    return end;
  }

  function clipSelectRect(x0, y0, x1, y1) {
    if (x0 == null || isNaN(x0)) x0 = x1;
    if (y0 == null || isNaN(y0)) y0 = y1;
    if (isMobileLayout()) {
      x1 = oddSpanEnd(x0, x1);
      y1 = oddSpanEnd(y0, y1);
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function clipContains(clip, pt) {
    if (!clip || !pt) return false;
    return pt.x >= clip.minX && pt.x <= clip.maxX && pt.y >= clip.minY && pt.y <= clip.maxY;
  }

  function shiftCopiedPoint(pt, dx, dy, clip) {
    if (!pt) return null;
    var nx = pt.x;
    var ny = pt.y;
    if (clipContains(clip, pt)) {
      nx = pt.x + dx;
      ny = pt.y + dy;
    }
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return null;
    return new Point({ x: nx, y: ny });
  }

  function snapshotClipboardRect(x0, y0, x1, y1) {
    var r = clipSelectRect(x0, y0, x1, y1);
    var coords = rectFn(r.x0, r.y0, r.x1, r.y1, true);
    if (!coords.length) return null;
    var cells = [];
    var minX = coords[0].x, maxX = coords[0].x, minY = coords[0].y, maxY = coords[0].y;
    for (var i = 0; i < coords.length; i++) {
      var ix = coords[i].x;
      var iy = coords[i].y;
      if (ix < minX) minX = ix;
      if (ix > maxX) maxX = ix;
      if (iy < minY) minY = iy;
      if (iy > maxY) maxY = iy;
      cells.push(new TileState(tiles[ix][iy]));
    }
    return {
      cells: cells,
      minX: minX,
      minY: minY,
      maxX: maxX,
      maxY: maxY
    };
  }

  function syncPasteButton() {
    var has = !!(mapClipboard && mapClipboard.cells && mapClipboard.cells.length);
    $('#tools [data-tool-id="toolPaste"]').toggleClass('disabled', !has).attr('aria-disabled', has ? 'false' : 'true');
  }

  function highlightClipboardSource() {
    clearHighlights();
    if (!mapClipboard) return;
    for (var i = 0; i < mapClipboard.cells.length; i++) {
      var cell = mapClipboard.cells[i];
      var tile = tiles[cell.x] && tiles[cell.x][cell.y];
      if (tile) tile.highlight(true);
    }
    if (window.TagproLoupe && TagproLoupe.refresh) TagproLoupe.refresh();
  }

  function selectionPreview(x0, y0, x1, y1) {
    var r = clipSelectRect(x0, y0, x1, y1);
    var coords = rectFn(r.x0, r.y0, r.x1, r.y1, true);
    var preview = [];
    for (var i = 0; i < coords.length; i++) {
      preview.push(new TileState(tiles[coords[i].x][coords[i].y]));
    }
    return preview.length ? new UndoStep(preview) : null;
  }

  function pasteTileFromSnapshot(dest, snap, dx, dy, clip) {
    var st = new TileState(dest, {
      type: snap.type,
      radius: snap.radius,
      weight: snap.weight,
      cooldown: snap.cooldown,
      timer: snap.timer
    });
    if (snap.topType) st.topType = snap.topType;
    else delete st.topType;
    st.affected = [];
    for (var i = 0; i < snap.affected.length; i++) {
      var shifted = shiftCopiedPoint(snap.affected[i], dx, dy, clip);
      if (shifted) st.affected.push(shifted);
    }
    st.destination = shiftCopiedPoint(snap.destination, dx, dy, clip);
    return st;
  }

  function pasteClipboardAt(x, y) {
    if (!mapClipboard || !mapClipboard.cells.length) return null;
    var cx = Math.floor((mapClipboard.minX + mapClipboard.maxX) / 2);
    var cy = Math.floor((mapClipboard.minY + mapClipboard.maxY) / 2);
    var dx = x - cx;
    var dy = y - cy;
    var changes = [];
    for (var i = 0; i < mapClipboard.cells.length; i++) {
      var snap = mapClipboard.cells[i];
      var nx = snap.x + dx;
      var ny = snap.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      changes.push(pasteTileFromSnapshot(tiles[nx][ny], snap, dx, dy, mapClipboard));
    }
    return changes.length ? new UndoStep(changes) : null;
  }

  function previewPasteAt(x, y) {
    clearPotentialHighlights();
    if (x == null || y == null || isNaN(x) || isNaN(y)) return;
    var change = pasteClipboardAt(x, y);
    if (change) setSpeculativeStep(change);
  }

  function clearTileForCut(tile) {
    var st = new TileState(tile, { type: emptyType });
    delete st.topType;
    st.affected = [];
    st.destination = null;
    st.radius = undefined;
    st.weight = undefined;
    st.cooldown = undefined;
    st.timer = undefined;
    return st;
  }

  function makeSelectClipboardTool(isCut) {
    return new Tool({
      previewOnly: !isCut,
      type: 'special',
      getState: function() {
        return { downX: this.downX, downY: this.downY };
      },
      setState: function(state) {
        this.downX = state.downX;
        this.downY = state.downY;
      },
      unselect: function() {
        clearHighlights();
        this.downX = undefined;
        this.downY = undefined;
        this.oddSnapToasted = false;
      },
      down: function(x, y) {
        this.downX = x;
        this.downY = y;
        this.lastX = x;
        this.lastY = y;
        this.oddSnapToasted = false;
      },
      speculateDrag: function(x, y) {
        var x0 = this.downX === undefined ? x : this.downX;
        var y0 = this.downY === undefined ? y : this.downY;
        this.lastX = x;
        this.lastY = y;
        maybeToastOddSnap(x0, y0, x, y, this);
        return selectionPreview(x0, y0, x, y);
      },
      speculateUp: function(x, y) {
        var x0 = this.downX === undefined ? x : this.downX;
        var y0 = this.downY === undefined ? y : this.downY;
        this.lastX = x;
        this.lastY = y;
        maybeToastOddSnap(x0, y0, x, y, this);
        var clip = snapshotClipboardRect(x0, y0, x, y);
        if (clip) mapClipboard = clip;
        if (!isCut) return selectionPreview(x0, y0, x, y);
        var r = clipSelectRect(x0, y0, x, y);
        var coords = rectFn(r.x0, r.y0, r.x1, r.y1, true);
        var changes = [];
        for (var c = 0; c < coords.length; c++) {
          changes.push(clearTileForCut(tiles[coords[c].x][coords[c].y]));
        }
        return changes.length ? new UndoStep(changes) : null;
      },
      up: function() {
        this.downX = undefined;
        this.downY = undefined;
        syncPasteButton();
        highlightClipboardSource();
        if (mapClipboard && mapClipboard.cells.length) {
          // Lock paste until a new pointer-down. Switching tools during this
          // mouseup (or a touch ghost click) used to apply paste immediately.
          lockPasteInput();
          setTimeout(function() {
            $('#toolPaste').trigger('click');
          }, 0);
        }
      }
    });
  }

  var cutTool = makeSelectClipboardTool(true);
  var copyTool = makeSelectClipboardTool(false);
  var pasteTool = new Tool({
    type: 'special',
    unselect: function() {
      clearHighlights();
    },
    select: function() {
      highlightClipboardSource();
    },
    speculateDrag: function(x, y) {
      if (pasteInputLocked()) return null;
      return pasteClipboardAt(x, y);
    },
    speculateUp: function(x, y) {
      if (pasteInputLocked()) return null;
      return pasteClipboardAt(x, y);
    },
    up: function(x, y) {
      if (pasteInputLocked()) return;
      highlightClipboardSource();
      previewPasteAt(x, y);
    }
  });

  var addWidth = new Tool({
    previewOnly: true,
    down: function(x) {
      this.downX = x;
      this.lastX = x;
    },
    speculateDrag: function(x) {
      this.lastX = x;
      if (this.downX === undefined) this.downX = x;
      var start = Math.min(x, this.downX);
      var end = Math.max(x, this.downX);
      var calculated = [];
      for (var ix = start; ix <= end; ix++) {
        for (var iy = 0; iy < height; iy++) {
          calculated.push(new TileState(tiles[ix][iy]));
        }
      }
      return new UndoStep(calculated);
    },
    up: function() {
      if (this.downX === undefined || this.lastX === undefined) return;
      var extra = Math.abs(this.lastX - this.downX) + 1;
      var start = Math.min(this.lastX, this.downX);
      this.downX = this.lastX = undefined;
      insertColumns(start, extra);
      reselectDrawingTool();
    }
  });

  var addHeight = new Tool({
    previewOnly: true,
    down: function(x, y) {
      this.downY = y;
      this.lastY = y;
    },
    speculateDrag: function(x, y) {
      this.lastY = y;
      if (this.downY === undefined) this.downY = y;
      var start = Math.min(y, this.downY);
      var end = Math.max(y, this.downY);
      var calculated = [];
      for (var iy = start; iy <= end; iy++) {
        for (var ix = 0; ix < width; ix++) {
          calculated.push(new TileState(tiles[ix][iy]));
        }
      }
      return new UndoStep(calculated);
    },
    up: function() {
      if (this.downY === undefined || this.lastY === undefined) return;
      var extra = Math.abs(this.lastY - this.downY) + 1;
      var start = Math.min(this.lastY, this.downY);
      this.downY = this.lastY = undefined;
      insertRows(start, extra);
      reselectDrawingTool();
    }
  });

  var mirrorTool = new Tool({
    previewOnly: true,
    speculateUp: function(x, y) {
      var calculated = [];
      for (var ix = 0; ix < width; ix++) {
        for (var iy = 0; iy < height; iy++) {
          calculated.push(new TileState(tiles[ix][iy]));
        }
      }
      return new UndoStep(calculated);
    },
    up: function(x, y) {
      if (x === undefined || y === undefined) return;
      if (x === 0 && y === 0 && width > 1 && height > 1) return;
      mirrorMap(mirrorDirFromClick(x, y));
      reselectDrawingTool();
    }
  });

  function ensureUnique(placedX, placedY) {
    for (var x=0; x<width; x++) {
      for (var y=0; y<height; y++) {
        if (x==placedX && y==placedY) continue;
        if (tiles[x][y].type == this) {
          tiles[x][y].setType(floorType);
        }
      }
    }
  }

  function Point(sourceOrX, maybeY) {
    if (maybeY) {
      this.x = sourceOrX;
      this.y = maybeY;
    } else {
      this.x = sourceOrX.x;
      this.y = sourceOrX.y;
    }
  }
  Point.cmp = function(a, b) {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a.x != b.x) return a.x - b.x;
    return a.y - b.y;
  }
  var marsBallCount = 0;
  function tileStateChangesEmpty(changes) {
    for (var key in changes) {
      if (Object.prototype.hasOwnProperty.call(changes, key)) return false;
    }
    return true;
  }
  function TileState(source, changes) {
    changes = changes || {};
    this.x = changes.x || source.x 
    this.y = changes.y || source.y;
    var placingMars = changes.type == marsBallType
      || (tileStateChangesEmpty(changes) && source.topType == marsBallType);
    if (placingMars) {
      this.topType = changes.type || source.topType;
      if (changes.type && this.topType != changes.type) this.type = changes.type;
      else if (this.topType != source.type) this.type = source.type;
    } else {
      this.type = changes.type || source.type;
      if (changes.topType) this.topType = changes.topType;
      else if (source.topType && (changes.mirror || 'radius' in changes || 'weight' in changes)) {
        this.topType = source.topType;
      }
    }
    this.affected = [];
    var affectedMap = changes.affected || source.affected || {};
    for (var key in affectedMap) {
      this.affected.push(new Point(affectedMap[key]));
    }
    this.affected.sort(Point.cmp);
    var destTile = changes.destination || source.destination;
    this.destination = destTile && new Point(destTile);
    this.cooldown = 'cooldown' in changes ? changes.cooldown : source.cooldown;
    this.timer = 'timer' in changes ? changes.timer : source.timer;
    this.radius = 'radius' in changes ? changes.radius : source.radius;
    this.weight = 'weight' in changes ? changes.weight : source.weight;
  }
  TileState.prototype.equals = function(other) {
    if (this.x!=other.x
      || this.y!=other.y
      || this.type!=other.type
      || this.topType!=other.topType
      || Point.cmp(this.destination, other.destination)
      || this.affected.length != other.affected.length
      || (''+this.cooldown) != (''+other.cooldown)
      || (''+this.timer) != (''+other.timer)
      || (''+this.radius) != (''+other.radius)
      || (''+this.weight) != (''+other.weight)) return false;
    for (var i=0; i<this.affected.length; i++) {
      if (Point.cmp(this.affected[i], other.affected[i])) return false;
    }
    return true;
  }
  TileState.prototype.restoreInto = function(tile) {
    if (this.topType == marsBallType) {
      if (tile.topType != marsBallType) {
        marsBallCount++;
        if (marsBallCount > 2) {
          marsBallCount--;
          alert('Only 2 mars balls are allowed per map');
          if (tile.topType) this.topType = tile.topType;
          else delete this.topType;
        }
      }
    } else if (tile.topType == marsBallType) {
      marsBallCount--;
    }
    tile.setType(this.type || tile.type);
    tile.setTopType(this.topType);
    tile.affected = {};
    for (var i=0; i<this.affected.length; i++) {
      var a = this.affected[i];
      tile.affected[xy(a)] = tiles[a.x][a.y];
    }
    tile.destination = this.destination && tiles[this.destination.x][this.destination.y];
    tile.cooldown = this.cooldown;
    tile.timer = this.timer;
    tile.radius = this.radius;
    tile.weight = this.weight;
    mayHaveChanged(tile);
  }

  function recordStep() {
    var changes = [];

    if (!backingStates || backingStates.length != tiles.length || backingStates[0].length != tiles[0].length) {
      var size;
      if (backingStates) {
        for (var x=0; x<backingStates.length; x++) {
          for (var y=0; y<backingStates[0].length; y++) {
            if (x>= tiles.length || y>=tiles[0].length || !backingStates[x][y].equals(new TileState(tiles[x][y]))) {
              changes.push(backingStates[x][y]);
            }
          }
        }
        size = new Point({x:backingStates.length, y:backingStates[0].length});
      }
      backingStates = [];
      for (var x=0; x<tiles.length; x++) {
        backingStates[x] = [];
        for (var y=0; y<tiles[x].length; y++) {
          backingStates[x][y] = new TileState(tiles[x][y]);
        }
      }

      dirtyStates = {}
      return new UndoStep(changes, size);
    }

    for (var key in dirtyStates) {
      var newState = new TileState(dirtyStates[key]);
      if (!newState.equals(backingStates[newState.x][newState.y])) {
        changes.push(backingStates[newState.x][newState.y]);
        backingStates[newState.x][newState.y] = newState;
      }
    }
    dirtyStates = {}
    if (!changes.length) return null;
    return new UndoStep(changes, null);
  }

  function savePoint() {
    var step = recordStep();
    if (step) {
      console.log('recording step', step);
      undoSteps.push(step);
      redoSteps = [];
      enableUndoRedoButtons();
      persistMap();
    }
  }
  
  function applyStep(step) {
    var tileChanges = step.states;
    if (step.size) {
      var types = [];
      for (var x=0; x<step.size.x; x++) {
        types[x] = [];
        for (var y=0; y<step.size.y; y++) {
          types[x][y] = x<tiles.length && y<tiles[0].length ? tiles[x][y].type : emptyType;
        }
      }
      buildTilesWith(types);
      for (var x=0; x<backingStates.length && x<tiles.length; x++) {
        for (var y=0; y<backingStates[x].length && y<tiles[0].length; y++) {
          backingStates[x][y].restoreInto(tiles[x][y]);
        }
      }
    }

    for (var i=0; i<tileChanges.length; i++) {
      var change = tileChanges[i];
      change.restoreInto(tiles[change.x][change.y]);
    }
    cleanDirtyWalls();
    if (selectedTool) selectedTool.stateChange();
    persistMap();
    if (window.TagproLoupe && TagproLoupe.refresh) TagproLoupe.refresh();
  }

  function moveChange(fromSteps, toSteps) {
    if (!fromSteps.length) return;

    var step = fromSteps.splice(fromSteps.length-1, 1)[0];
    applyStep(step);
    
    var step = recordStep();
    if (step) {
      toSteps.push(step);
    }
  }

  function enable($elem, enabled) {
    if (enabled) $elem.removeAttr('disabled');
    else $elem.attr('disabled', 'disabled')
  }
  function enableUndoRedoButtons() {
    enable($('#undo'), undoSteps.length);
    enable($('#redo'), redoSteps.length);
  }
  function undo() {
    moveChange(undoSteps, redoSteps);
    enableUndoRedoButtons();
  }
  function redo() {
    moveChange(redoSteps, undoSteps);
    enableUndoRedoButtons();
  }

  function xy(pt) {
    return pt.x + ',' + pt.y;
  }

  var backingStates = null;
  var dirtyStates = {};
  function mayHaveChanged(tile) {
    dirtyStates[xy(tile)] = tile;
  }

  function UndoStep(states, size) {
    this.states = states;
    this.size = size;
  }
  var undoSteps = [];
  var redoSteps = [];

  function setFieldFn(defaultState) {
    return function(logic, tile) {
      logic.fields[tile.x + ',' + tile.y] = {defaultState: defaultState};
    }
  }

  function exportSwitch(logic, tile) {
    var toggles = [];
    for (var key in tile.affected) {
      var affectedTile = tile.affected[key];
      var t = affectedTile.type;
      if (t==bombType || t==onFieldType || t==offFieldType || t==redFieldType || t==blueFieldType) {
        toggles.push({pos: {x: affectedTile.x, y: affectedTile.y}});
      }
    }
    logic.switches[tile.x + ',' + tile.y] = {
      toggle: toggles,
      timer: (tile.timer != undefined) ? tile.timer : defaultButtonTimer
    };
  }
  function exportPortal(logic, tile) {
    var dest = tile.destination || tile;
    logic.portals[tile.x + ',' + tile.y] = {
      destination: {x: dest.x, y: dest.y},
      cooldown: (tile.cooldown != undefined) ? tile.cooldown : defaultPortalCooldown
    };
  }
  function exportExitPortal(logic, tile) {
    logic.portals[tile.x + ',' + tile.y] = {};
  }
  function exportMarsBall(logic, tile) {
    logic.marsballs.push({y: tile.y, x: tile.x});
  }
  function exportSpawn(logic, tile) {
    var color = (tile.type == redSpawnType) ? 'red' : 'blue';
    if (!logic.spawnPoints[color]) logic.spawnPoints[color] = [];
    logic.spawnPoints[color].push({
      x: tile.x,
      y: tile.y,
      radius: (tile.radius != undefined) ? tile.radius : defaultSpawnRadius,
      weight: (tile.weight != undefined) ? tile.weight : defaultSpawnWeight
    });
  }

  var defaultPortalCooldown = 0;
  var defaultButtonTimer = 0;
  var defaultSpawnRadius = 5;
  var defaultSpawnWeight = 1;

  var floorType, emptyType, 
    wallType, wallTopLeftType, wallTopRightType, wallBottomLeftType, wallBottomRightType,
    blueFlagType, redFlagType, switchType, bombType, onFieldType, offFieldType,
    redFieldType, blueFieldType, portalType, exitPortalType, redPortalType, bluePortalType,
    redSpawnType, blueSpawnType, redSpeedPadType, blueSpeedpadType, yellowFloorType, redFloorType, blueFloorType,
    spikeType, powerupType, speedpadType,
    yellowFlagType, redEndzoneType, blueEndzoneType, gravityWellType, marsBallType;
  
  var tileTypes = [
    emptyType = new TileType('empty', 13,5, 0,0,0, "Background"),
    floorType = new TileType('floor',13,4, 212,212,212, "Tile"),
    wallType = new TileType('wall', 15,6, 120,120,120, "Wall", {wallSolids: 0xff}), // encoding: bit 0 is noon, goes clockwise
    wallBottomLeftType = new TileType('wallBottomLeft', 15,7, 128,112,64, "Wall BL", {wallSolids: 0xb4}),
    wallTopLeftType = new TileType('wallTopLeft', 15,9, 64,128,80, "Wall TL", {wallSolids: 0xd2}),
    wallTopRightType = new TileType('wallTopRight', 15,10, 64,80,128, "Wall TR", {wallSolids: 0x4b}),
    wallBottomRightType = new TileType('wallBottomRight', 15,8, 128,64,112, "Wall BR", {wallSolids: 0x2d}),
    switchType = new TileType('switch', 13,6, 185,122,87, "Button - Emits signals to gates and bombs.", {logicFn: exportSwitch}),
    spikeType = new TileType('spike', 12,0, 55,55,55, "Spike"),
    bombType = new TileType('bomb', 12,1, 255,128,0, "Bomb - Receives signals from switches."),
    powerupType = new TileType('powerup', 12,7, 0,255,0, "Powerup"),
    speedpadType = new TileType('speedpad', 0,0, 255,255,0, "Boost", {image: 'speedpad'}),
    blueSpeedpadType = new TileType('blueSpeedpad', 0,0, 115,115,255, "Blue Team Boost", {image: 'speedpadblue'}),
    redSpeedPadType = new TileType('redSpeedpad', 0,0, 255,115,115, "Red Team Boost", {image: 'speedpadred'}),
    yellowFloorType = new TileType('yellowFloor', 13,5, 220,220,186, "Yellow Speed Tile - Increases speed for non-flag-carriers."),
    redFloorType = new TileType('redFloor', 14,4, 220,186,186, "Red Speed Tile - Increases speed for non-flag-carriers."),
    blueFloorType = new TileType('blueFloor', 15,4, 187,184,221, "Blue Speed Tile - Increases speed for non-flag-carriers."),
    offFieldType = new TileType('offField', 12,3, 0,117,0, "Gate - Default Off", {logicFn: setFieldFn('off')}),
    onFieldType = new TileType('onField', 13,3, 0,117,0, "Gate - Default On", {logicFn: setFieldFn('on')}),
    redFieldType = new TileType('redField', 14,3, 0,117,0, "Gate - Default Red", {logicFn: setFieldFn('red')}),
    blueFieldType = new TileType('blueField', 15,3, 0,117,0, "Gate - Default Blue", {logicFn: setFieldFn('blue')}),
    portalType = new TileType('portal', 0,0, 202, 192,0, "Portal - Link two portals using the wire tool.", {image: 'portal', logicFn: exportPortal}),
    exitPortalType = new TileType('exitPortal', 4,0, 202, 192,0, "Exit Portal - Can be linked as destination for other portals.", {image: 'portal', logicFn: exportExitPortal}),
    redPortalType = new TileType('redPortal', 0, 0, 204, 51, 0, "Red Portal - Can be used by red balls.", {image: 'portalred', logicFn: exportPortal}),
    bluePortalType = new TileType('bluePortal', 0,0, 0, 102, 204, "Blue Portal - Can be used by blue balls.", {image: 'portalblue', logicFn: exportPortal}),
    redFlagType = new TileType('redFlag', 14,1, 255,0,0, "Red Flag"),
    blueFlagType = new TileType('blueFlag', 15,1, 0,0,255, "Blue Flag"),
    redSpawnType = new TileType('redSpawn', 14,0, 155,0,0, "Red Spawn Tile - Red balls will spawn within a certain radius of this tile.", {logicFn: exportSpawn}),
    blueSpawnType = new TileType('blueSpawn', 15,0, 0,0,155, "Blue Spawn Tile - Blue balls will spawn within a certain radius of this tile.", {logicFn: exportSpawn}),
    yellowFlagType = new TileType('yellowFlag', 13,1, 128,128,0, "Yellow Flag - Bring this neutral flag to your zone to score."),
    redEndzoneType = new TileType('redEndzone', 14,5, 185,0,0, "Red Endzone - Bring a neutral (yellow) flag to this zone to score."),
    blueEndzoneType = new TileType('blueEndzone', 15,5, 25,0,148, "Blue Endzone - Bring a neutral (yellow) flag to this zone to score."),
    gravityWellType = new TileType('gravityWell', 0, 0, 32, 32, 32, "Gravity Well - Pulls nearby balls to their splat.", {image: 'gravitywell', imageTileWidth: 1, imageTileHeight: 1}),
    marsBallType = new TileType('marsBall', 12,9, 256,256,256, "Mars Ball - Push into own endzone or opponent flag to win.", {logicFn: exportMarsBall, multiplier: 0.5}), // 2×2 sheet sprite; no centering shift (see sheetBackgroundPosition)
  ];

  function isEnterablePortal(type) {
    return type === portalType || type === redPortalType || type === bluePortalType;
  }
  function isAnyPortal(type) {
    return isEnterablePortal(type) || type === exitPortalType;
  }
  function isSpeedFloor(type) {
    return type === floorType || type === yellowFloorType || type === redFloorType || type === blueFloorType;
  }
  function recountMarsBalls() {
    marsBallCount = 0;
    if (!tiles) return;
    for (var x = 0; x < tiles.length; x++) {
      for (var y = 0; y < tiles[x].length; y++) {
        if (tiles[x][y].topType == marsBallType) marsBallCount++;
      }
    }
  }

  function areOpposites(t1, t2) {
    t1.opposite = t2;
    t2.opposite = t1; 
  }
  function areVerticalMirrors(t1, t2) {
    t1.verticalMirror = t2;
    t2.verticalMirror = t1;
  }
  function areHorizontalMirrors(t1, t2) {
    t1.horizontalMirror = t2;
    t2.horizontalMirror = t1;
  }
  function isPlusNinetyRotator(t1, t2) {
    t1.plusNinetyRotator = t2;
  }
  function isMinusNinetyRotator(t1, t2) {
    t1.minusNinetyRotator = t2;
  }
  areOpposites(redSpeedPadType, blueSpeedpadType);
  areOpposites(redFloorType, blueFloorType);
  areOpposites(redFieldType, blueFieldType);
  areOpposites(redFlagType, blueFlagType);
  areOpposites(redSpawnType, blueSpawnType);
  areOpposites(redEndzoneType, blueEndzoneType);
  areOpposites(redPortalType, bluePortalType);
  areHorizontalMirrors(wallBottomLeftType, wallBottomRightType);
  areHorizontalMirrors(wallTopLeftType, wallTopRightType);
  areVerticalMirrors(wallBottomLeftType, wallTopLeftType);
  areVerticalMirrors(wallBottomRightType, wallTopRightType);
  isPlusNinetyRotator(wallBottomLeftType, wallTopLeftType);
  isPlusNinetyRotator(wallTopLeftType, wallTopRightType);
  isPlusNinetyRotator(wallTopRightType, wallBottomRightType);
  isPlusNinetyRotator(wallBottomRightType, wallBottomLeftType);
  isMinusNinetyRotator(wallTopLeftType, wallBottomLeftType);
  isMinusNinetyRotator(wallTopRightType, wallTopLeftType);
  isMinusNinetyRotator(wallBottomRightType, wallTopRightType);
  isMinusNinetyRotator(wallBottomLeftType, wallBottomRightType);
  

  function Tile(options, elem) {
    this.set(options);
    if (elem) {
      this.elem = elem;
      this.setType(options.type, true);
      this.background = elem.parent();
      
      var domElem = elem[0];
      // clockwise from noon: TR, BR, BL, TL
      this.quadrantElems = [domElem.children[0], domElem.children[1], domElem.children[2],domElem.children[3]];
      
      this.topSquare = domElem.children[4];
      this.selectionIndicator = domElem.children[5];
      this.affectedIndicator = domElem.children[6];
    }
  }
  Tile.prototype.set = function(options) {
    this.x = options.x;
    this.y = options.y;
    this.type = options.type;
    this.affected = {};
    for (var key in options.affected || {}) {
      this.affected[key] = options.affected[key]
    }
    this.destination = options.destination;
  }
  Tile.prototype.setType = function(type, force) {
    if  (this.type==type && !force) return;
    this.type = type;
    type.drawOn(this.elem, this);
    if (type.postPlaceFn) {
      type.postPlaceFn.call(type, this.x, this.y);
    }

    for (var dx=-1; dx<=1; dx++) {
      for (var dy=-1; dy<=1; dy++) {
        maybeIsDirtyWall(this.x+dx, this.y+dy);
      }
    }
    mayHaveChanged(this);
  }
  Tile.prototype.setTopType = function(topType) {
    if (!this.topSquare) {
      if (!topType) delete this.topType;
      else this.topType = topType;
      return;
    }
    if (!topType) {
      delete this.topType;
      this.topSquare.style.display = 'none';
      return;
    }
    this.topType = topType;
    topType.drawOn(this.elem, this, true);
    if (topType.postPlaceFn) {
      topType.postPlaceFn.call(topType, this.x, this.y);
    }
    mayHaveChanged(this);
  }
  Tile.prototype.highlight = function(highlighted) {
    this.elem.find('.selectionIndicator').css('display', highlighted ? 'inline-block' : 'none');
  }
  Tile.prototype.highlightWithPotential = function(highlighted) {
    this.elem.find('.potentialHighlight').css('display', highlighted ? 'inline-block' : 'none');
  }
  function pinConsoleCursor(opts) {
    if (!document.documentElement.classList.contains('layout-gamepad')) return;
    var loupe = window.TagproLoupe;
    if (!loupe || !loupe.center || !tiles) return;
    var keep = !!(opts && opts.keepOthers);
    if (!keep) $map.find('.potentialHighlight').css('display', 'none');
    var c = loupe.center();
    var tile = tiles[c.x] && tiles[c.x][c.y];
    if (!tile) return;
    tile.elem.find('.potentialHighlight').css('background-color', ownHighlightHex);
    tile.highlightWithPotential(true);
    if (opts && opts.notify) notifySpeculativeTiles([{ x: c.x, y: c.y }]);
  }
  function clearPotentialHighlights() {
    $map.find('.potentialHighlight').css('display', 'none');
    pinConsoleCursor({ keepOthers: true });
    if (window.TagproLoupe && TagproLoupe.refresh) TagproLoupe.refresh();
  }


  var dirtyWalls = {};
  function isWall(x, y) {
    return !!(tiles && tiles[x] && tiles[x][y] && tiles[x][y].type.isWall());
  }
  function wallSolidsAt(x,y, ctx) {
    var t;
    if (ctx && ctx.isolated) {
      t = (x === ctx.x && y === ctx.y) ? (ctx.previewSolids|0) : 0;
    } else if (!tiles) {
      t = 0;
    } else {
      t = (tiles[x] && tiles[x][y] && tiles[x][y].type.wallSolids|0);
    }
    return t|(t<<8);
  }
  function maybeIsDirtyWall(x, y) {
    if (isWall(x,y)) {
      dirtyWalls[x + ',' + y] = tiles[x][y];
    }
  }
  function cleanDirtyWalls() {
    for (var key in dirtyWalls) {
      var wall = dirtyWalls[key];
      if (!wall.type.isWall()) continue;

      wall.type.drawOn(wall.elem, wall);
    }
    dirtyWalls = {};
  }

  var $map = $('#map');
  var $palette = $('#palette');

  var height;
  var width;
  var $tiles;
  var tiles;
  var ownHighlightHex = '#99FF99';
  var speculativeListener = null;
  var tilesRebuiltListener = null;

  function highlightClassId(id) {
    return String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, '');
  }

  function notifySpeculativeTiles(coords) {
    if (typeof speculativeListener === 'function') {
      try { speculativeListener(coords || []); } catch (err) {}
    }
  }

  function buildTilesWith(types) {
    width = types.length;
    height = types[0].length;
    marsBallCount = 0;

    var html = '';
    var row = "<div class='tileRow'>";


    for (var x=0; x<width; x++) {
      row += "<div class='tileBackground'><div class='tile nestedSquare'>" +
        "<div class='tileQuadrant nestedSquareTR'></div>" +
        "<div class='tileQuadrant nestedSquareBR'></div>" +
        "<div class='tileQuadrant nestedSquareBL'></div>" +
        "<div class='tileQuadrant nestedSquareTL'></div>" +
        "<div class='topSquare nestedSquare'></div>" +
        "<div class='selectionIndicator nestedSquare'></div><div class='potentialHighlight nestedSquare'></div><div class='potentialHighlightOther nestedSquare'></div></div></div>";
    }
    row += "</div>"
    for (var y=0; y<height; y++) {
      html += row;
    }
    $map.html('<div class="map-canvas">' + html + '</div>');

    $tiles = $map.find('.tile');
    tiles = [];

    for (var x=0; x<width; x++) {
      tiles[x] = [];
      for (var y=0; y<height; y++) {
        var $tile = $($tiles[y*width + x]).data('x', x).data('y', y);
        var tile = tiles[x][y] = new Tile({x: x, y: y, type: types[x][y]}, $tile);
      }
    }

    cleanDirtyWalls();

    $('#resizeWidth').val(width);
    $('#resizeHeight').val(height);
    $('#mapSize').val(width + 'x' + height);
    zoom = 0;
    fitMode = 'contain';
    showZoom();
    enableZoomButtons();
    requestAnimationFrame(function() {
      showZoom();
      enableZoomButtons();
    });
    $map.find('.potentialHighlight').css('background-color', ownHighlightHex);
    if (typeof tilesRebuiltListener === 'function') {
      try { tilesRebuiltListener(); } catch (err) {}
    }
    if (window.TagproLoupe && TagproLoupe.refresh) TagproLoupe.refresh();
  }

  function confirmLargeMap(nextW, nextH) {
    if (nextW * nextH <= 3600) return true;
    return confirm('Maps larger than 3600 tiles cannot be tested and may lag the browser.\nContinue anyway?');
  }

  function snapshotTiles() {
    var snap = [];
    for (var x = 0; x < width; x++) {
      snap[x] = [];
      for (var y = 0; y < height; y++) {
        var t = tiles[x][y];
        var affected = [];
        for (var key in t.affected || {}) {
          var a = t.affected[key];
          if (a) affected.push({ x: a.x, y: a.y });
        }
        snap[x][y] = {
          type: t.type,
          topType: t.topType || null,
          cooldown: t.cooldown,
          timer: t.timer,
          radius: t.radius,
          weight: t.weight,
          dest: t.destination ? { x: t.destination.x, y: t.destination.y } : null,
          affected: affected
        };
      }
    }
    return snap;
  }

  function applyMappedProps(snap, oldW, oldH, destOf) {
    for (var x = 0; x < oldW; x++) {
      for (var y = 0; y < oldH; y++) {
        var d = destOf(x, y);
        if (!d || !tiles[d.x] || !tiles[d.x][d.y]) continue;
        var tile = tiles[d.x][d.y];
        var s = snap[x][y];
        tile.cooldown = s.cooldown;
        tile.timer = s.timer;
        tile.radius = s.radius;
        tile.weight = s.weight;
        if (s.topType) tile.setTopType(s.topType);
        if (s.dest) {
          var nd = destOf(s.dest.x, s.dest.y);
          if (nd && tiles[nd.x]) tile.destination = tiles[nd.x][nd.y];
        }
        if (s.affected.length) {
          tile.affected = {};
          for (var i = 0; i < s.affected.length; i++) {
            var na = destOf(s.affected[i].x, s.affected[i].y);
            if (na && tiles[na.x] && tiles[na.x][na.y]) {
              tile.affected[na.x + ',' + na.y] = tiles[na.x][na.y];
            }
          }
        }
      }
    }
  }

  function rebuildMapped(newW, newH, destOf, opts) {
    opts = opts || {};
    if (!confirmLargeMap(newW, newH)) return false;
    var oldW = width;
    var oldH = height;
    var snap = snapshotTiles();
    var types = [];
    var x, y, d;
    for (x = 0; x < newW; x++) {
      types[x] = [];
      for (y = 0; y < newH; y++) types[x][y] = emptyType;
    }
    var mapType = opts.mapType || function(ty) { return ty; };
    for (x = 0; x < oldW; x++) {
      for (y = 0; y < oldH; y++) {
        d = destOf(x, y);
        if (!d || d.x < 0 || d.y < 0 || d.x >= newW || d.y >= newH) continue;
        types[d.x][d.y] = mapType(snap[x][y].type);
      }
    }
    if (opts.copyOf) {
      var copyType = opts.copyType || function(ty) { return ty; };
      for (x = 0; x < oldW; x++) {
        for (y = 0; y < oldH; y++) {
          d = opts.copyOf(x, y);
          if (!d || d.x < 0 || d.y < 0 || d.x >= newW || d.y >= newH) continue;
          types[d.x][d.y] = copyType(snap[x][y].type);
        }
      }
    }
    buildTilesWith(types);
    applyMappedProps(snap, oldW, oldH, destOf);
    if (opts.copyOf) applyMappedProps(snap, oldW, oldH, opts.copyOf);
    recountMarsBalls();
    cleanDirtyWalls();
    savePoint();
    persistMap();
    return true;
  }

  function insertColumns(start, extra) {
    var oldW = width;
    rebuildMapped(oldW + extra, height, function(x, y) {
      return { x: x < start ? x : x + extra, y: y };
    });
  }

  function insertRows(start, extra) {
    var oldH = height;
    rebuildMapped(width, oldH + extra, function(x, y) {
      return { x: x, y: y < start ? y : y + extra };
    });
  }

  function rotateMap(degrees) {
    var oldW = width;
    var oldH = height;
    if (degrees === 90) {
      rebuildMapped(oldH, oldW, function(x, y) {
        return { x: oldH - 1 - y, y: x };
      }, { mapType: function(ty) { return ty.plusNinetyRotator || ty; } });
    } else {
      rebuildMapped(oldH, oldW, function(x, y) {
        return { x: y, y: oldW - 1 - x };
      }, { mapType: function(ty) { return ty.minusNinetyRotator || ty; } });
    }
  }

  function flipMap(axis) {
    var oldW = width;
    var oldH = height;
    if (axis === 'h') {
      rebuildMapped(oldW, oldH, function(x, y) {
        return { x: oldW - 1 - x, y: y };
      }, { mapType: function(ty) { return ty.horizontalMirror || ty; } });
    } else {
      rebuildMapped(oldW, oldH, function(x, y) {
        return { x: x, y: oldH - 1 - y };
      }, { mapType: function(ty) { return ty.verticalMirror || ty; } });
    }
  }

  function mirrorMap(dir) {
    var oldW = width;
    var oldH = height;
    if (dir === 'right') {
      rebuildMapped(oldW * 2, oldH, function(x, y) { return { x: x, y: y }; }, {
        copyOf: function(x, y) { return { x: oldW * 2 - 1 - x, y: y }; },
        copyType: function(ty) { return pairType(ty, 'h'); }
      });
    } else if (dir === 'left') {
      rebuildMapped(oldW * 2, oldH, function(x, y) { return { x: x + oldW, y: y }; }, {
        copyOf: function(x, y) { return { x: oldW - 1 - x, y: y }; },
        copyType: function(ty) { return pairType(ty, 'h'); }
      });
    } else if (dir === 'down') {
      rebuildMapped(oldW, oldH * 2, function(x, y) { return { x: x, y: y }; }, {
        copyOf: function(x, y) { return { x: x, y: oldH * 2 - 1 - y }; },
        copyType: function(ty) { return pairType(ty, 'v'); }
      });
    } else {
      rebuildMapped(oldW, oldH * 2, function(x, y) { return { x: x, y: y + oldH }; }, {
        copyOf: function(x, y) { return { x: x, y: oldH - 1 - y }; },
        copyType: function(ty) { return pairType(ty, 'v'); }
      });
    }
  }

  var lastDrawingToolId = 'toolPencil';
  function reselectDrawingTool() {
    setTimeout(function() {
      var $btn = $('#' + lastDrawingToolId);
      if ($btn.length) $btn.trigger('click');
      else $('#toolPencil').trigger('click');
    }, 0);
  }

  function clearMap() {
    var emptyTypes = [];
    var clearX = tiles ? width : 20;
    var clearY = tiles ? height : 20;
    for (var x=0;x<clearX;x++) {
      var col = emptyTypes[x] = [];
      for (var y=0; y<clearY; y++) {
        col.push(floorType)
      }
    }
    buildTilesWith(emptyTypes);
    savePoint();
    clearHistory();
    $('#mapName').val('Untitled');
    $('#author').val('Anonymous');
  };
  redrawTextures();
  clearMap();

  var symmetry = 'None';
  var SYMMETRY_KEY = 'tagproSymmetry';

  // One #symmetry <select> in index.html: Map tab of the mobile More sheet and the desktop sidebar.
  // Import auto-detect writes this control here so both layouts show the same value.
  function setSymmetry(mode) {
    if (symmetryFns[mode]) {
      symmetry = mode;
      $('#symmetry').val(mode);
    } else {
      symmetry = 'None';
      $('#symmetry').val('No Symmetry');
    }
    try { localStorage.setItem(SYMMETRY_KEY, symmetry); } catch (err) {}
  }

  $('#symmetry').change(function() {
    console.log('Symmetry was ', symmetry);
    setSymmetry($(this).val());
    console.log('Symmetry is ', symmetry);
  });

  function transformType(type, how) {
    if (!type) return type;
    if (how[4]) type = type.opposite;
    if (how[0]==-1) type = type.horizontalMirror;
    if (how[2]==-1) type = type.verticalMirror;
    return type;
  }

  function applyHow(pt, how, cols, rows) {
    pt.x = pt.x*how[0] + (cols-1)*how[1];
    pt.y = pt.y*how[2] + (rows-1)*how[3];
    if (pt.type) pt.type = transformType(pt.type, how);
  }

  function transformPoint(pt, how) {
    applyHow(pt, how, tiles.length, tiles[0].length);
  }
  
  var symmetryFns = {
    'Horizontal': [
      [1,0,  1,0],
      [-1,1, 1,0, true]
    ],
    'Vertical': [
      [1,0, 1,0],
      [1,0, -1,1, true]
    ],
    '4-Way': [
      [1,0, 1,0],
      [-1,1, 1,0, true],
      [1,0, -1,1, true],
      [-1,1, -1,1]
    ],
    'Rotational': [
      [1,0, 1,0],
      [-1,1, -1,1, true]
    ]
  }

  try {
    var savedSymmetry = localStorage.getItem(SYMMETRY_KEY);
    if (savedSymmetry) setSymmetry(savedSymmetry);
  } catch (err) {}

  function isIdentityHow(how) {
    return how[0] === 1 && how[1] === 0 && how[2] === 1 && how[3] === 0 && !how[4];
  }

  function hasAffectedTargets(tile) {
    if (!tile || !tile.affected) return false;
    for (var key in tile.affected) {
      if (tile.affected[key]) return true;
    }
    return false;
  }

  function mapMatchesSymmetry(mode, grid) {
    var transforms = symmetryFns[mode];
    grid = grid || tiles;
    if (!transforms || !grid || !grid.length || !grid[0] || !grid[0].length) return false;
    var cols = grid.length;
    var rows = grid[0].length;
    for (var ti = 0; ti < transforms.length; ti++) {
      var how = transforms[ti];
      if (isIdentityHow(how)) continue;
      for (var x = 0; x < cols; x++) {
        for (var y = 0; y < rows; y++) {
          var src = grid[x][y];
          if (!src) return false;
          var pt = { x: x, y: y, type: src.type };
          applyHow(pt, how, cols, rows);
          var dst = grid[pt.x] && grid[pt.x][pt.y];
          if (!dst || dst.type !== pt.type) return false;
          var expectedTop = src.topType ? transformType(src.topType, how) : null;
          var actualTop = dst.topType || null;
          if (expectedTop !== actualTop) return false;
          if (isEnterablePortal(src.type) && isEnterablePortal(dst.type) && src.destination && dst.destination) {
            var destPt = { x: src.destination.x, y: src.destination.y };
            applyHow(destPt, how, cols, rows);
            if (dst.destination.x !== destPt.x || dst.destination.y !== destPt.y) return false;
          }
          if (src.type === switchType && dst.type === switchType && hasAffectedTargets(src) && hasAffectedTargets(dst)) {
            for (var key in src.affected) {
              var aff = src.affected[key];
              if (!aff) continue;
              var affPt = { x: aff.x, y: aff.y };
              applyHow(affPt, how, cols, rows);
              if (!dst.affected[affPt.x + ',' + affPt.y]) return false;
            }
          }
        }
      }
    }
    return true;
  }

  function detectImportedSymmetry(grid) {
    if (mapMatchesSymmetry('4-Way', grid)) return '4-Way';
    var horizontal = mapMatchesSymmetry('Horizontal', grid);
    var vertical = mapMatchesSymmetry('Vertical', grid);
    if (horizontal && !vertical) return 'Horizontal';
    if (vertical && !horizontal) return 'Vertical';
    if (mapMatchesSymmetry('Rotational', grid)) return 'Rotational';
    return 'No Symmetry';
  }
  
  function applySymmetry(step) {
    var transforms = symmetryFns[symmetry];
    var tileChangeMap = {};
    if (transforms) {
      step.states.forEach(function(state) {
        transforms.forEach(function(transform) {
          var transformedState = new TileState(state);
          transformPoint(transformedState, transform);
          if (transformedState.affected) {
            transformedState.affected.forEach(function(pt) {
              transformPoint(pt, transform);
            });
          }
          if (transformedState.destination) {
            transformPoint(transformedState.destination, transform);
          }
          tileChangeMap[xy(transformedState)] = transformedState;
        });
        
      });
    }
    
    
    step.states.forEach(function(state) {
      tileChangeMap[xy(state)] = state;
    });
    
    step.states = [];
    for (var key in tileChangeMap) {
      step.states.push(tileChangeMap[key]);
    }
  }
  
  function setSpeculativeStep(step) {
    if (!step || !step.states) return;
    applySymmetry(step);
    $map.find('.potentialHighlight').css('display', 'none');
    var coords = [];
    $.each(step.states, function(idx, state) {
      if (!tiles[state.x] || !tiles[state.x][state.y]) return;
      tiles[state.x][state.y].elem.find('.potentialHighlight').css('background-color', ownHighlightHex);
      tiles[state.x][state.y].highlightWithPotential(true);
      coords.push({ x: state.x, y: state.y });
    });
    notifySpeculativeTiles(coords);
    pinConsoleCursor({ keepOthers: true });
    if (window.TagproLoupe && TagproLoupe.refresh) TagproLoupe.refresh();
  }

  function setOwnHighlightColor(name, hex) {
    if (hex) ownHighlightHex = hex;
    $map.find('.potentialHighlight').css('background-color', ownHighlightHex);
  }

  function clearPeerHighlights(id) {
    var sid = highlightClassId(id);
    if (!sid) {
      $map.find('.potentialHighlightOther').filter(function() {
        return /(?:^|\s)potentialHighlightOther-\S+/.test(this.className);
      }).remove();
      $map.find('.potentialHighlightOther').css('display', 'none');
      return;
    }
    $map.find('.potentialHighlightOther-' + sid).remove();
  }

  function showPeerHighlights(id, tileList, hex) {
    var sid = highlightClassId(id);
    if (!sid || !tiles) return;
    clearPeerHighlights(sid);
    if (!tileList || !tileList.length) return;
    var color = hex || ownHighlightHex;
    var sizeCss = tileSize + 'px';
    for (var i = 0; i < tileList.length; i++) {
      var pt = tileList[i];
      if (!pt) continue;
      var tile = tiles[pt.x] && tiles[pt.x][pt.y];
      if (!tile) continue;
      var $el = $("<div class='potentialHighlightOther nestedSquare potentialHighlightOther-" + sid + "'></div>");
      $el.css({
        display: 'inline-block',
        backgroundColor: color,
        width: sizeCss,
        height: sizeCss
      });
      tile.elem.append($el);
    }
  }
  
  $map.mouseleave(function(e) {
    clearPotentialHighlights();
    notifySpeculativeTiles([]);
  });

  var controlDown = false;
  var shiftDown = false;

  $(document).keydown(function(e) {
    if(e.which==17) { // control
      controlDown = true;
    } else if (e.which==16) {
      shiftDown = true;
    } else if (window.TagproCollab && typeof TagproCollab.chatFocused === 'function' && TagproCollab.chatFocused()) {
      return;
    } else if (e.which==90) { //z
      undo();
    } else if (e.which==89) { //y
      redo();
    }
  }).keyup(function(e) {
    if (e.which==17) { // control
      controlDown = false;
    }
    if (e.which==16) {
      shiftDown = false;
    }
  });
  
  $(window).blur (function() { // If the user ctrl-tabs away, it won't the keyup won't register
    controlDown = false;
  })

  function settingsTypeName(type) {
    if (!type) return '';
    if (typeof type === 'string') return type;
    return type.name || '';
  }

  function isEnterablePortalName(name) {
    return name === 'portal' || name === 'redPortal' || name === 'bluePortal';
  }

  function isSwitchName(name) {
    return name === 'switch';
  }

  function isSpawnName(name) {
    return name === 'redSpawn' || name === 'blueSpawn';
  }

  function tileHasSettings(x, y) {
    var tile = tiles && tiles[x] && tiles[x][y];
    if (!tile || !tile.type) return false;
    var name = settingsTypeName(tile.type);
    return isEnterablePortalName(name) || isSwitchName(name) || isSpawnName(name);
  }

  var settingsModalGuardUntil = 0;
  var TILE_SETTINGS_MODALS = '#portalOptions, #switchOptions, #spawnOptions';
  var SETTINGS_MODAL_GUARD_MS = 500;

  function armSettingsModalGuard(until) {
    settingsModalGuardUntil = until || (Date.now() + SETTINGS_MODAL_GUARD_MS);
    if (window.TagproLoupe && TagproLoupe.armSettingsModalGuard) {
      TagproLoupe.armSettingsModalGuard(settingsModalGuardUntil);
    }
  }

  function tileSettingsIsOpen() {
    return $('body').hasClass('tile-settings-open');
  }

  function isGuardedTileSettingsTarget(el) {
    if (!el) return false;
    if (el.id === 'tileSettingsBackdrop') return true;
    if (el.closest) {
      if (el.closest('#tileSettingsBackdrop, .tile-settings-backdrop, .modal-backdrop')) return true;
      if (el.closest('.tile-settings-dialog')) return true;
      if (el.closest('[data-dismiss="tile-settings"]')) return true;
    }
    if (el.classList && (el.classList.contains('tile-settings-backdrop') || el.classList.contains('modal-backdrop'))) {
      return true;
    }
    return false;
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

  function placeTileSettingsOverMap(el) {
    if (!el) return;
    var pad = 12;
    var maxW = Math.min(420, Math.max(180, window.innerWidth - pad * 2));
    var maxH = Math.max(120, window.innerHeight - pad * 2);
    el.style.left = '50%';
    el.style.top = '50%';
    el.style.width = maxW + 'px';
    el.style.maxWidth = maxW + 'px';
    el.style.maxHeight = maxH + 'px';
    el.style.transform = 'translate(-50%, -50%)';
  }

  function showMapSettingsBackdrop() {
    $('#tileSettingsBackdrop, .tile-settings-backdrop').remove();
    var bd = document.createElement('div');
    bd.id = 'tileSettingsBackdrop';
    bd.className = 'tile-settings-backdrop';
    bd.setAttribute('aria-hidden', 'true');
    bd.style.left = '0';
    bd.style.top = '0';
    bd.style.width = '100%';
    bd.style.height = '100%';
    document.body.appendChild(bd);
  }

  function relayoutTileSettings() {
    if (!tileSettingsIsOpen()) return;
    var open = document.querySelector('#portalOptions.is-open, #switchOptions.is-open, #spawnOptions.is-open');
    if (open) placeTileSettingsOverMap(open);
    var bd = document.getElementById('tileSettingsBackdrop');
    if (!bd) return;
    bd.style.left = '0';
    bd.style.top = '0';
    bd.style.width = '100%';
    bd.style.height = '100%';
  }

  window.addEventListener('resize', relayoutTileSettings);

  function hideTileSettings() {
    var dialogs = document.querySelectorAll(TILE_SETTINGS_MODALS);
    var active = document.activeElement;
    var i, j, inputs;
    for (i = 0; i < dialogs.length; i++) {
      if (active && dialogs[i].contains(active) && typeof active.blur === 'function') {
        active.blur();
        active = document.activeElement;
      }
      inputs = dialogs[i].querySelectorAll('input, textarea, select');
      for (j = 0; j < inputs.length; j++) {
        if (typeof inputs[j].blur === 'function') inputs[j].blur();
      }
    }
    $(TILE_SETTINGS_MODALS).each(function() {
      this.classList.remove('in', 'is-open');
      this.style.removeProperty('display');
      this.style.removeProperty('left');
      this.style.removeProperty('top');
      this.style.removeProperty('width');
      this.style.removeProperty('max-width');
      this.style.removeProperty('max-height');
      this.style.removeProperty('transform');
      this.setAttribute('hidden', '');
      this.setAttribute('aria-hidden', 'true');
    });
    $('#tileSettingsBackdrop, .tile-settings-backdrop').remove();
    $('body').removeClass('tile-settings-open');
    if (window.TagproLoupe && TagproLoupe.refresh) TagproLoupe.refresh();
  }

  function showTileSettingsModal($modal) {
    hideTileSettings();
    armSettingsModalGuard();
    showMapSettingsBackdrop();
    var el = $modal && $modal[0];
    var host = document.getElementById('tileSettingsHost');
    if (el && host && el.parentNode !== host) host.appendChild(el);
    if (el) {
      el.removeAttribute('hidden');
      el.classList.add('in', 'is-open');
      el.style.removeProperty('display');
      el.setAttribute('aria-hidden', 'false');
      placeTileSettingsOverMap(el);
    }
    $('body').addClass('tile-settings-open');
  }

  $(document).on('click', '.tile-settings-dialog [data-dismiss="tile-settings"]', function(e) {
    if (settingsModalGuardUntil && Date.now() < settingsModalGuardUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    hideTileSettings();
  });

  $(document).on('click', '#tileSettingsBackdrop, .tile-settings-backdrop', function(e) {
    if (settingsModalGuardUntil && Date.now() < settingsModalGuardUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    hideTileSettings();
  });

  document.addEventListener('keydown', function(e) {
    if (e.which !== 27 && e.key !== 'Escape') return;
    if (!tileSettingsIsOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    hideTileSettings();
  }, true);

  function openTileSettings(x, y) {
    var tile = tiles && tiles[x] && tiles[x][y];
    if (!tile || !tile.type) return false;
    var name = settingsTypeName(tile.type);
    if (isEnterablePortalName(name)) {
      var cooldown = (tile.cooldown != undefined) ? tile.cooldown : defaultPortalCooldown;
      $('#portalCooldown').val('').attr('placeholder', cooldown);
      showTileSettingsModal($('#portalOptions'));
      $('#portalSubmit').off('click').on('click', function() {
        var value = parseFloat($('#portalCooldown').val());
        if (!(value >= 0)) value = cooldown;
        applyStep(new UndoStep([new TileState(tile, { cooldown: value })]));
        savePoint();
        hideTileSettings();
      });
      return true;
    }
    if (isSwitchName(name)) {
      var timer = (tile.timer != undefined) ? tile.timer : defaultButtonTimer;
      $('#switchTimer').val('').attr('placeholder', timer);
      showTileSettingsModal($('#switchOptions'));
      $('#switchSubmit').off('click').on('click', function() {
        var value = parseFloat($('#switchTimer').val());
        if (isNaN(value)) value = timer;
        applyStep(new UndoStep([new TileState(tile, { timer: value })]));
        savePoint();
        hideTileSettings();
      });
      return true;
    }
    if (isSpawnName(name)) {
      var radius = (tile.radius != undefined) ? tile.radius : defaultSpawnRadius;
      var weight = (tile.weight != undefined) ? tile.weight : defaultSpawnWeight;
      $('#spawnRadius').val('').attr('placeholder', radius);
      $('#spawnWeight').val('').attr('placeholder', weight);
      showTileSettingsModal($('#spawnOptions'));
      $('#spawnSubmit').off('click').on('click', function() {
        var nextRadius = parseFloat($('#spawnRadius').val());
        var nextWeight = parseFloat($('#spawnWeight').val());
        var changes = {};
        if (nextRadius >= 0) changes.radius = nextRadius;
        else changes.radius = radius;
        if (nextWeight >= 1) changes.weight = nextWeight;
        else changes.weight = weight;
        applyStep(new UndoStep([new TileState(tile, changes)]));
        savePoint();
        hideTileSettings();
      });
      return true;
    }
    return false;
  }

  var mouseDown = false;
  var pasteInputLock = false;

  function lockPasteInput() {
    pasteInputLock = true;
  }

  function unlockPasteInput() {
    pasteInputLock = false;
  }

  function pasteInputLocked() {
    return pasteInputLock;
  }

  function isLoupeSyntheticEvent(e) {
    return !!(e && e.tagproFromLoupe);
  }

  function isGhostMouseEvent(e) {
    if (isLoupeSyntheticEvent(e)) return false;
    if (window.TagproLoupe && TagproLoupe.isEmulatedMouse) return TagproLoupe.isEmulatedMouse(e);
    return false;
  }

  function ignoreNativeWhileLoupeTracking(e) {
    if (window.TagproLoupe && TagproLoupe.dismissing && TagproLoupe.dismissing()) return true;
    if (isLoupeSyntheticEvent(e)) return false;
    return !!(window.TagproLoupe && TagproLoupe.tracking && TagproLoupe.tracking());
  }

  function ignoreConsolePointerHover(e) {
    if (!document.documentElement.classList.contains('layout-gamepad')) return false;
    return !isLoupeSyntheticEvent(e);
  }

  $map.on('mouseenter', '.tile', function(e) {
    if (isGhostMouseEvent(e) || ignoreNativeWhileLoupeTracking(e) || ignoreConsolePointerHover(e)) return;

    var x = $(this).data('x');
    var y = $(this).data('y');

    if (!selectedTool) return;

    if (selectedTool.speculateDrag || selectedTool.speculateUp) { // should really test for speculatedDown || speculateDrag, maybe
      var st = selectedTool.getState();
      var change = selectedTool.speculateDrag && selectedTool.speculateDrag(x,y);
      if (!change) {
        change = selectedTool.speculateUp && selectedTool.speculateUp(x,y)
      }
      selectedTool.setState(st);
      if (change) setSpeculativeStep(change);
      else notifySpeculativeTiles([{ x: x, y: y }]);
      return;
    }
    })
    .on('mouseleave', '.tile', function(e) {
      if (isGhostMouseEvent(e) || ignoreNativeWhileLoupeTracking(e) || ignoreConsolePointerHover(e)) return;
      clearPotentialHighlights();
//      console.log('mouse left ', $(this).data('x'), $(this).data('y'));
    })
    .on('mousedown', '.tile', function(e) {
      if (e.which==1) {
        if (isGhostMouseEvent(e) || ignoreNativeWhileLoupeTracking(e)) return;
        unlockPasteInput();
        var x = $(this).data('x');
        var y = $(this).data('y');
        if (!controlDown) {
          if (e.shiftKey && openTileSettings(x, y)) {
            mouseDown = false;
            return;
          }
          // Native click must not paint a settings tile (that kills dblclick).
          // Synthetic loupe/drag paints may still draw over them.
          if (tileHasSettings(x, y) && !isLoupeSyntheticEvent(e)) {
            mouseDown = false;
            return;
          }
          mouseDown = true;

          selectedTool.down(x,y)
          var change = selectedTool.speculateDrag(x,y);
          if (change && !selectedTool.previewOnly) {
            applySymmetry(change);
            applyStep(change);
            selectedTool.stateChange();
          }
          
          e.preventDefault();
        }
      } else if (e.which==3) {
        e.preventDefault();
        var x = $(this).data('x');
        var y = $(this).data('y');
        
        if (isEnterablePortal(tiles[x][y].type)) {
          var cooldown = parseFloat(prompt("Cooldown time (in milliseconds):", tiles[x][y].cooldown || 0));
          if (!(cooldown>=0)) return;
          
          var change = new UndoStep([
            new TileState(tiles[x][y], {cooldown:cooldown})
          ]);
          applySymmetry(change);
          applyStep(change);
        }
      }
    })
    .on('dblclick', '.tile', function(e) {
      if (isMobileLayout()) return;
      var x = $(this).data('x');
      var y = $(this).data('y');
      if (openTileSettings(x, y)) {
        e.preventDefault();
        mouseDown = false;
      }
    })
    .on('mousemove', '.tile', function(e) {
      if (isGhostMouseEvent(e) || ignoreNativeWhileLoupeTracking(e)) return;
      var x = $(this).data('x');
      var y = $(this).data('y');
      if (selectedTool && mouseDown) {
        var change = selectedTool.speculateDrag && selectedTool.speculateDrag(x,y);
        if (change) {
          applySymmetry(change);
          applyStep(change);
        } else if (selectedTool.speculateUp) {
          var st = selectedTool.getState();
          change = selectedTool.speculateUp(x,y);
          selectedTool.setState(st);
          if (change) setSpeculativeStep(change);
        }
      }
    })
    .on('mouseup', '.tile', function(e) {
      if (e.which==1) {
        if (isGhostMouseEvent(e) || ignoreNativeWhileLoupeTracking(e)) return;
        var x = $(this).data('x');
        var y = $(this).data('y');
        if (controlDown) {
          var eyeDropBrushType = tiles[x][y].type;
          setBrushTileType(eyeDropBrushType);
        } else if (tileHasSettings(x, y) && !isLoupeSyntheticEvent(e) && !mouseDown) {
          // Mobile hold opens settings; native mouseup must not also stamp.
        } else {
          var change = selectedTool.speculateUp(x,y);
          if (change && !selectedTool.previewOnly) {
            applySymmetry(change);
            applyStep(change);
            selectedTool.stateChange();
          }
          clearPotentialHighlights();
          selectedTool.up(x,y);
        
          savePoint();
        }
        mouseDown = false;
        cleanDirtyWalls();
      }
    });


  $(document).on('mouseup', function(e) {
    if (isGhostMouseEvent(e) || ignoreNativeWhileLoupeTracking(e)) return;
    if (e.which==1 && mouseDown) {
      mouseDown = false;
      if (selectedTool) {
        var x = selectedTool.lastX != null ? selectedTool.lastX : selectedTool.downX;
        var y = selectedTool.lastY != null ? selectedTool.lastY : selectedTool.downY;
        if (x == null) x = 0;
        if (y == null) y = 0;
        if (selectedTool.speculateUp) {
          var change = selectedTool.speculateUp(x, y);
          if (change && !selectedTool.previewOnly) {
            applySymmetry(change);
            applyStep(change);
            selectedTool.stateChange();
          }
        }
        clearPotentialHighlights();
        if (selectedTool.up) selectedTool.up(x, y);
      }
      savePoint();
      cleanDirtyWalls();
    }
  });

  $map.on('contextmenu', function(e) {
    e.preventDefault();
  });

  var wall = String.fromCharCode(120)+String.fromCharCode(120)+String.fromCharCode(120)+String.fromCharCode(255);
  var open = String.fromCharCode(212)+String.fromCharCode(212)+String.fromCharCode(212)+String.fromCharCode(255);
  function createPng() {
    var text = '';
    for (var y=0; y<height; y++) {
      for (var x=0; x<width; x++) {
        text += tiles[x][y].type.color;
      }
    }
    return text;
  }

  function makeLogic() {
    var logic = {
      info: {
        name: $('#mapName').val(),
        author: $('#author').val()
      },
      switches: {},
      fields: {},
      portals: {},
      marsballs: [],
      spawnPoints: { red: [], blue: [] }
    };

    for (var x=0; x<width; x++) {
      for (var y=0; y<height; y++) {
        var fn = tiles[x][y].type.logicFn;
        if (fn) fn(logic, tiles[x][y]);
        if (tiles[x][y].topType && tiles[x][y].topType.logicFn) {
          tiles[x][y].topType.logicFn(logic, tiles[x][y]);
        }
      }
    }
    return logic;
  }

  function extractMap() {
    var map = {};
    map.tiles = [];
    for (var y=0; y<height; y++) {
      var row = map.tiles[y] = [];
      for (var x=0; x<width; x++) {
        var tile = tiles[x][y];
        var cell;
        if (isEnterablePortal(tile.type)) {
          cell = {
            type: tile.type.name,
            destination: tile.destination ? [tile.destination.x, tile.destination.y] : [x,y]
          }
        } else if (tile.type == switchType) {
          var targets = [];
          for (var key in tile.affected||[]) {
            var affected = tile.affected[key];
            targets.push([affected.x, affected.y])
          }
          cell = {
            type: tile.type.name,
            targets: targets
          }
        } else if (tile.topType == marsBallType) {
          cell = {
            type: tile.type.name,
            topType: 'marsBall'
          }
        } else {
          cell = tile.type.name;
        }
        row[x] = cell;
      }
    }
    return map;
  }

  function typeByNameMap() {
    var byName = {};
    tileTypes.forEach(function(type) {
      byName[type.name] = type;
    });
    return byName;
  }

  function applyJsonMetadata(json) {
    if (!json) return;
    var info = json.info || {};
    $('#mapName').val(info.name || '');
    $('#author').val(info.author || '');

    var portals = json.portals || {};
    for (var key in portals) {
      var xy = key.split(',');
      var tile = (tiles[xy[0]] || [])[xy[1]];
      if (tile && isEnterablePortal(tile.type)) {
        var dest = portals[key].destination || {};
        if (dest && dest.x != undefined && dest.y != undefined && !tile.destination) {
          tile.destination = (tiles[dest.x] || [])[dest.y];
        }
        if (portals[key].cooldown != undefined) tile.cooldown = portals[key].cooldown;
      }
    }

    var switches = json.switches || {};
    for (var key in switches) {
      var xy = key.split(',');
      var tile = (tiles[xy[0]] || [])[xy[1]];
      if (tile && tile.type == switchType) {
        if (!tile.affected || !Object.keys(tile.affected).length) {
          tile.affected = {};
          (switches[key].toggle || []).forEach(function(affected) {
            var pos = affected.pos || {};
            var affectedTile = (tiles[pos.x] || [])[pos.y];
            if (affectedTile) tile.affected[pos.x + ',' + pos.y] = affectedTile;
          });
        }
        if (switches[key].timer != undefined) tile.timer = switches[key].timer;
      }
    }

    var spawnPoints = json.spawnPoints || {};
    function applySpawnMeta(color) {
      (spawnPoints[color] || []).forEach(function(pt) {
        var tile = (tiles[pt.x] || [])[pt.y];
        if (!tile) return;
        if (pt.radius != undefined) tile.radius = pt.radius;
        if (pt.weight != undefined) tile.weight = pt.weight;
      });
    }
    applySpawnMeta('red');
    applySpawnMeta('blue');
    applyMarsBalls(json, 0, 0);
  }

  function applyMarsBalls(json, deltaX, deltaY) {
    if (!json) return;
    var marsballs = json.marsballs || [];
    for (var i = 0; i < marsballs.length; i++) {
      var x = parseInt(marsballs[i].x, 10) + (deltaX || 0);
      var y = parseInt(marsballs[i].y, 10) + (deltaY || 0);
      var tile = (tiles[x] || [])[y];
      if (tile) new TileState(tile, {type: marsBallType}).restoreInto(tile);
    }
  }

  function restoreFromExtractedMap(extracted, jsonString, doHistoryClear) {
    var rows = Array.isArray(extracted) ? extracted : (extracted && extracted.tiles);
    if (!rows || !rows.length || !rows[0] || !rows[0].length) return false;
    var heightRows = rows.length;
    var widthCols = rows[0].length;
    var byName = typeByNameMap();
    var cols = [];
    var x, y, cell, name;
    for (x = 0; x < widthCols; x++) {
      cols[x] = [];
      for (y = 0; y < heightRows; y++) {
        cell = (rows[y] || [])[x];
        name = (cell && typeof cell === 'object') ? cell.type : cell;
        cols[x][y] = (name === 'marsBall' ? floorType : (byName[name] || emptyType));
      }
    }
    if (applyingRemote && persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    buildTilesWith(cols);

    for (y = 0; y < heightRows; y++) {
      for (x = 0; x < widthCols; x++) {
        cell = (rows[y] || [])[x];
        var tile = tiles[x] && tiles[x][y];
        if (!tile) continue;
        name = (cell && typeof cell === 'object') ? cell.type : cell;
        if (name === 'marsBall' || (cell && typeof cell === 'object' && cell.topType === 'marsBall')) {
          new TileState(tile, {type: marsBallType}).restoreInto(tile);
        }
        if (!cell || typeof cell !== 'object') continue;
        if (isEnterablePortal(tile.type) && cell.destination) {
          tile.destination = (tiles[cell.destination[0]] || [])[cell.destination[1]];
        } else if (cell.type === 'switch' && cell.targets) {
          tile.affected = {};
          cell.targets.forEach(function(target) {
            var affectedTile = (tiles[target[0]] || [])[target[1]];
            if (affectedTile) tile.affected[target[0] + ',' + target[1]] = affectedTile;
          });
        }
      }
    }

    var json = null;
    if (typeof jsonString === 'string' && jsonString) {
      try { json = JSON.parse(jsonString); } catch (err) { json = null; }
    } else if (jsonString && typeof jsonString === 'object') {
      json = jsonString;
    }
    applyJsonMetadata(json);
    recountMarsBalls();

    savePoint();
    if (doHistoryClear) clearHistory();
    persistReady = true;
    persistMapNow();
    applyingRemote = false;
    return true;
  }

  function getPngBase64() {
    return Base64.encode(generatePng(width, height, createPng()));
  }
  
  function getPngBase64Url() {
    return 'data:image/png;base64,' + getPngBase64();
  }

  $('#export').click(function() {
    $('.dropArea').removeClass('hasImportable');
    $('.dropArea').addClass('hasExportable');
    $(jsonDropArea).attr('href', 'data:application/json;base64,' + Base64.encode(makeLogicString()));
    $(pngDropArea).attr('href', getPngBase64Url());
  });

  $('#save').click(function() {
    persistReady = true;
    persistMapNow();
  });

  function isValidMapStr() {
    var hasRedFlag = false;
    var hasBlueFlag = false;
    var hasRedSpawn = false;
    var hasBlueSpawn = false;
    $.each(tiles, function(rowIdx, row) {
      $.each(row, function(tileIdx, tile) {
        if (tile.type.name == "redFlag") hasRedFlag = true;
        if (tile.type.name == "blueFlag") hasBlueFlag = true;
        if (tile.type.name == "redSpawn") hasRedSpawn = true;
        if (tile.type.name == "blueSpawn") hasBlueSpawn = true;
      });
    });
    if (!(hasRedSpawn || hasRedFlag))
      return "A map requires a red flag or a red spawn tile to test.";
    if (!(hasBlueSpawn || hasBlueFlag))
      return "A map requires a blue flag or a blue spawn tile to test.";
    return "Valid";
  }

  function launchTest(eu) {
    var validStr = isValidMapStr();
    if (validStr != "Valid") {
      alert(validStr);
      return false;
    }
    $.post('test', {logic: JSON.stringify(makeLogic()), layout: getPngBase64(), eu: !!eu}, function(data) {
      if (data && data.location) {
        window.open(data.location);
      } else {
        alert("Test couldn't get started.")
      }
    });
    return false;
  }

  $('#test, #testeu').click(function(e) {
    var eu = e.target.id === 'testeu' || !!(e.target.closest && e.target.closest('#testeu'));
    if (window.TagproGamepad && TagproGamepad.setTestServer) {
      TagproGamepad.setTestServer(eu ? 'eu' : 'na');
    }
    return launchTest(!!eu);
  });
  
  function setBrushTileType(type) {
    brushTileType = type;
    $('.tilePaletteOption').removeClass('palette-selected');
    $('.tileTypeSelectionIndicator').css('display', 'none');
    $('.tilePaletteOption').each(function(idx, el) {
      if ($(el).data('tileType') == type) {
        $(el).addClass('palette-selected');
        $(el).find('.tileTypeSelectionIndicator').css('display', 'inline-block');
      }
    });
    if (window.TagproPalette && TagproPalette.centerOnSelected) {
      TagproPalette.centerOnSelected();
    } else if (window.TagproPalette && TagproPalette.refreshScale) {
      TagproPalette.refreshScale();
    }
  }

  var persistReady = false;
  var persistTimer = null;
  var applyingRemote = false;
  var restoreSerial = 0;
  function persistMapNow() {
    if (!persistReady || !tiles || !tiles.length) return;
    try {
      localStorage.setItem('png', getPngBase64Url());
      localStorage.setItem('json', makeLogicString());
    } catch (err) {}
    if (!applyingRemote && window.TagproCollab && typeof window.TagproCollab.onPersist === 'function') {
      try { window.TagproCollab.onPersist(); } catch (err) {}
    }
  }
  function persistMap() {
    if (!persistReady || applyingRemote) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistMapNow, 350);
  }

  var paletteOrder = [
    bombType, emptyType,
    wallType, wallTopLeftType, wallTopRightType, wallBottomLeftType, wallBottomRightType, floorType,
    spikeType, powerupType, gravityWellType, marsBallType,
    portalType, exitPortalType, redPortalType, bluePortalType,
    redFlagType, blueFlagType, redSpawnType, blueSpawnType, redEndzoneType, blueEndzoneType, yellowFlagType,
    speedpadType, redSpeedPadType, blueSpeedpadType, redFloorType, blueFloorType, yellowFloorType,
    switchType, offFieldType, onFieldType, redFieldType, blueFieldType
  ];

  var brushTileType = floorType;

  function applyPalettePreviewStyles($button, type, $inner) {
    var cell = PALETTE_CELL;
    var sizeCss = cell + 'px';
    var sheetCss = (tileSheetWidth * cell) + 'px ' + (tileSheetHeight * cell) + 'px';
    var imageCss = type.image
      ? (type.imageTileWidth * cell + 'px ' + type.imageTileHeight * cell + 'px')
      : ((tileSheetWidth * cell * (type.multiplier || 1)) + 'px ' + (tileSheetHeight * cell * (type.multiplier || 1)) + 'px');
    var pos = sheetBackgroundPosition(type.sheetX, type.sheetY, cell, type.multiplier || 1);
    var floorPos = '-' + (floorType.sheetX * cell) + 'px -' + (floorType.sheetY * cell) + 'px';
    $button.css({
      width: sizeCss,
      height: sizeCss,
      backgroundSize: sheetCss,
      backgroundPosition: floorPos,
      overflow: 'visible'
    });
    if (type.isWall()) {
      $inner.css({
        width: sizeCss,
        height: sizeCss,
        overflow: 'visible',
        backgroundSize: sheetCss,
        backgroundPosition: floorPos
      });
      return;
    }
    $inner.css({
      width: sizeCss,
      height: sizeCss,
      overflow: 'visible'
    });
    if (type.name == 'empty') {
      $inner.css({
        backgroundImage: 'none',
        backgroundColor: 'black',
        backgroundSize: sheetCss
      });
    } else {
      $inner.css({
        backgroundSize: imageCss,
        backgroundPosition: pos
      });
    }
  }

  function paintPaletteOption($button) {
    var type = $button.data('tileType');
    if (!type) return;
    var $inner = $button.find('.tile').first();
    var inner = $inner[0];
    bustDrawCache($button);
    bustDrawCache($inner);
    var savedTileSize = tileSize;
    tileSize = PALETTE_CELL;
    try {
      floorType.drawOn($button);
      var kids = inner && inner.children;
      if (type.isWall() && kids && kids.length >= 4 && quadrantCoords) {
        var half = (PALETTE_CELL / 2) + 'px';
        var sheetCss = (tileSheetWidth * PALETTE_CELL) + 'px ' + (tileSheetHeight * PALETTE_CELL) + 'px';
        for (var q = 0; q < 4; q++) {
          if (!kids[q]) continue;
          kids[q].style.width = kids[q].style.height = half;
          kids[q].style.left = (q & 2) ? '0' : half;
          kids[q].style.top = ((q + 1) & 2) ? half : '0';
          kids[q].style.position = 'absolute';
          kids[q].style.backgroundSize = sheetCss;
        }
        type.drawOn($inner, {
          x: 0,
          y: 0,
          isolated: true,
          previewSolids: type.wallSolids | 0,
          quadrantElems: [kids[0], kids[1], kids[2], kids[3]]
        });
      } else {
        type.drawOn($inner);
      }
      applyPalettePreviewStyles($button, type, $inner);
    } finally {
      tileSize = savedTileSize;
    }
  }

  function redrawPaletteTiles() {
    $('.tilePaletteOption').each(function() {
      paintPaletteOption($(this));
    });
  }

  function makePaletteButton(type) {
    var inner = type.isWall()
      ? "<div class='tile nestedSquare'>" +
        "<div class='tileQuadrant nestedSquareTR'></div>" +
        "<div class='tileQuadrant nestedSquareBR'></div>" +
        "<div class='tileQuadrant nestedSquareBL'></div>" +
        "<div class='tileQuadrant nestedSquareTL'></div>" +
        "<div class='tileTypeSelectionIndicator nestedSquare'></div></div>"
      : "<div class='tile'><div class='tileTypeSelectionIndicator'></div></div>";
    var $button = $("<div class='tileBackground tilePaletteOption' title = '" + type.toolTipText + "'>" + inner + "</div>");
    $button.data('tileType', type);
    paintPaletteOption($button);
    $button.on('click', function() {
      if (selectedTool == wire) {
        $('#toolPencil').trigger('click');
      }
      setBrushTileType(type);
    });
    return $button;
  }

  var $track = $("<div class='palette-track'></div>");
  for (var copy = 0; copy < 3; copy++) {
    var $copy = $("<div class='palette-copy'></div>");
    for (var i = 0; i < paletteOrder.length; i++) {
      $copy.append(makePaletteButton(paletteOrder[i]));
    }
    $track.append($copy);
  }
  $palette.append($track);
  setBrushTileType(floorType);

  $('#toolPencil').data('tool', pencil);
  $('#toolBrush').data('tool', brush);
  $('#toolLine').data('tool', line);
  $('#toolRectFill').data('tool', rectFill);
  $('#toolRectOutline').data('tool', rectOutline);
  $('#toolCircleFill').data('tool', circleFill);
  $('#toolCircleOutline').data('tool', circleOutline);
  $('#toolFill').data('tool', fill);
  $('#toolCut').data('tool', cutTool);
  $('#toolCopy').data('tool', copyTool);
  $('#toolPaste').data('tool', pasteTool);
  $('#toolWire').data('tool', wire);
  $('#toolAddCol').data('tool', addWidth);
  $('#toolAddRow').data('tool', addHeight);
  $('#toolMirror').data('tool', mirrorTool);
  $('#tools').on('click', '.btn', function(e) {
    var $btn = $(this);
    var action = $btn.attr('data-action');
    if (action) {
      e.preventDefault();
      if (action === 'rotateCw') rotateMap(90);
      else if (action === 'rotateCcw') rotateMap(-90);
      else if (action === 'flipH') flipMap('h');
      else if (action === 'flipV') flipMap('v');
      else if (action === 'mirrorV') mirrorMap('down');
      return;
    }
    var tool = $btn.data('tool');
    if (!tool) return;
    if ($btn.hasClass('disabled') || $btn.attr('aria-disabled') === 'true') {
      e.preventDefault();
      return;
    }
    selectedTool.unselect.call(selectedTool);
    var toolId = $btn.attr('data-tool-id') || $btn.attr('id') || '';
    $('#tools .btn').removeClass('active');
    if (toolId) $('#tools [data-tool-id="' + toolId + '"]').addClass('active');
    else $btn.addClass('active');
    selectedTool = tool;
    selectedTool.select.call(selectedTool);
    if (toolId && ['toolAddCol', 'toolAddRow', 'toolMirror', 'toolCut', 'toolCopy', 'toolPaste'].indexOf(toolId) === -1) {
      lastDrawingToolId = toolId;
    }
    if (window.TagproTools && TagproTools.centerOnActive) TagproTools.centerOnActive(true);
  });

  var selectedTool = pencil;
  $('#tools [data-tool-id="toolPencil"]').addClass('active');
//  $('#toolPencil').trigger('click');

  $('#undo').click(undo);
  $('#redo').click(redo);

  var importJson;
  var importPng;
  //$jsonDrop.ondragover = function () { this.className = 'hover'; return false; };
  //$jsonDrop.ondragend = function () { this.className = ''; return false; };
  var jsonDropArea = document.getElementById('jsonDrop')
  jsonDropArea.ondragover = function () { return false; };
  jsonDropArea.ondragend = function () { return false; };

  jsonDropArea.addEventListener("dragstart",function(evt){
    evt.dataTransfer.setData("DownloadURL",
      'data:application/json;base64,' + Base64.encode(makeLogicString()));
    return false;
  },false);

  var pngDropArea = document.getElementById('pngDrop');
  pngDropArea.ondragover = function () { return false; };
  pngDropArea.ondragend = function () { return false; };

  jsonDropArea.ondrop = pngDropArea.ondrop = function (e) {
    e.preventDefault();
    $('.dropArea').removeClass('hasExportable');
    for (var i=0; i<e.dataTransfer.files.length; i++) {
      var file = e.dataTransfer.files[i],
        reader = new FileReader();

      if (file.name.match(/json$/i)) {
        reader.onload = function (event) {
          importJson = event.target.result;
          $(jsonDropArea).addClass('hasImportable');
        };
        reader.readAsText(file);
      } else if (file.name.match(/png$/i)) {
        reader.onload = function (event) {
          importPng = event.target.result;
          $(pngDropArea).addClass('hasImportable');
        }
        reader.readAsDataURL(file);
      } else {
        alert('Expected a PNG or a JSON, but got ' + file.name);
      }
    }

    return false;
  };
  function handleImportFile(file) {
    var reader = new FileReader();
    if (file.name.match(/json$/i) || file.type === 'application/json') {
      reader.onload = function (event) {
        importJson = event.target.result;
        $(jsonDropArea).addClass('hasImportable');
      };
      reader.readAsText(file);
    } else if (file.name.match(/png$/i) || file.type === 'image/png') {
      reader.onload = function (event) {
        importPng = event.target.result;
        $(pngDropArea).addClass('hasImportable');
      };
      reader.readAsDataURL(file);
    } else {
      alert('Expected a PNG or a JSON, but got ' + file.name);
    }
  }

  $('#pngFileInput').on('change', function() {
    if (this.files[0]) handleImportFile(this.files[0]);
    this.value = '';
  });
  $('#jsonFileInput').on('change', function() {
    if (this.files[0]) handleImportFile(this.files[0]);
    this.value = '';
  });

  function restoreFromPngAndJson(pngBase64, jsonString, optResizeParams, doHistoryClear, detectSymmetry) {
    var serial = ++restoreSerial;
    var optWidth = optResizeParams && optResizeParams.width;
    var optHeight = optResizeParams && optResizeParams.height;
    var deltaX = (optResizeParams && optResizeParams.deltaX) || 0;
    var deltaY = (optResizeParams && optResizeParams.deltaY) || 0;
    var canvas = document.getElementById('importCanvas');
    var ctx = canvas.getContext('2d');
    var json;
    try {
      json = JSON.parse(jsonString);
    } catch (err) {
      if (serial === restoreSerial) applyingRemote = false;
      return;
    }
    if (applyingRemote && persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    var img = new Image();
    img.onload = function() {
      if (serial !== restoreSerial) return;
      var w = img.width;
      var h = img.height;
      optWidth = optWidth || w;
      optHeight = optHeight || h;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img,0,0);
      var imgd = ctx.getImageData(0, 0, w, h).data;
      var typeByColor = {};
      tileTypes.forEach(function(type) {
        typeByColor[type.rgb] = type;
      })

      var fields = json.fields || {};
      var portals = json.portals || {};
      if (!json.spawnPoints) json.spawnPoints = { red: [], blue: [] };
      if (!json.spawnPoints.red) json.spawnPoints.red = [];
      if (!json.spawnPoints.blue) json.spawnPoints.blue = [];
      var cols = [];
      for (var destX=0; destX<optWidth; destX++) {
        var sourceX = destX - deltaX;
        var col = [];
        for (var destY=0; destY<optHeight; destY++) {
          var sourceY = destY - deltaY;
          var type;
          if (sourceX<w && sourceY<h && sourceX>=0 && sourceY>=0) {
            var i = (sourceY*w + sourceX)*4;
            var pixel = imgd[i] | (imgd[i+1]<<8) | (imgd[i+2]<<16);
            type = typeByColor[pixel] || emptyType;
            if (type == redSpawnType) {
              type = floorType;
              json.spawnPoints.red.push({x: destX, y: destY});
            } else if (type == blueSpawnType) {
              type = floorType;
              json.spawnPoints.blue.push({x: destX, y: destY});
            } else if (type == portalType || type == exitPortalType) {
              var hasDestination = !!(portals[sourceX + ',' + sourceY] || {}).destination;
              type = hasDestination ? portalType : exitPortalType;
            } else if (type == onFieldType || type==offFieldType || type==redFieldType || type==blueFieldType) {
              type = {on: onFieldType, off: offFieldType, red: redFieldType, blue: blueFieldType
              }[(fields[sourceX+','+sourceY]||{}).defaultState] || offFieldType;
            }
          } else {
            type = emptyType;
          }
          col.push(type);
        }
        cols.push(col);
      }
      buildTilesWith(cols);

      var info = json.info || {};
      $('#mapName').val(info.name || '');
      $('#author').val(info.author || '');

      for (var key in portals) {
        var xy = key.split(',');
        var portalX = parseInt(xy[0], 10) + deltaX;
        var portalY = parseInt(xy[1], 10) + deltaY;
        var tile = (tiles[portalX]||[])[portalY];
        if (tile && isEnterablePortal(tile.type)) {
          var dest = portals[key].destination || {};
          if (dest && dest.x != undefined && dest.y != undefined) {
            tile.destination = (tiles[parseInt(dest.x, 10) + deltaX]||[])[parseInt(dest.y, 10) + deltaY];
          }
          if (portals[key].cooldown != undefined) tile.cooldown = portals[key].cooldown;
        }
      }

      var switches = json.switches || {};
      for (var key in switches) {
        var xy = key.split(',');
        var tile = (tiles[xy[0]]||[])[xy[1]];
        if (tile && tile.type == switchType) {
          tile.affected = []
          var toggles = (switches[key].toggle||[]);
          toggles.forEach(function(affected) {
            var pos = affected.pos || {};
            var affectedTile = (tiles[pos.x]||[])[pos.y];
            if (affectedTile) tile.affected[pos.x + ',' + pos.y] = (affectedTile);
          });
          if (switches[key].timer != undefined) tile.timer = switches[key].timer;
        }
      }

      var spawnPoints = json.spawnPoints || {};
      function applyImportedSpawns(color) {
        var spawnType = color === 'red' ? redSpawnType : blueSpawnType;
        (spawnPoints[color] || []).forEach(function(pt) {
          var x = parseInt(pt.x, 10) + deltaX;
          var y = parseInt(pt.y, 10) + deltaY;
          var tile = (tiles[x] || [])[y];
          if (!tile) return;
          var under = tile.type;
          if (under !== floorType && under !== yellowFloorType && under !== redFloorType && under !== blueFloorType && under !== spawnType) return;
          var changes = { type: spawnType };
          if (pt.radius != undefined) changes.radius = pt.radius;
          if (pt.weight != undefined) changes.weight = pt.weight;
          new TileState(tile, changes).restoreInto(tile);
        });
      }
      applyImportedSpawns('red');
      applyImportedSpawns('blue');
      applyMarsBalls(json, deltaX, deltaY);
      recountMarsBalls();
      // User PNG/JSON and FortunateMaps imports only. Shared path for desktop and mobile;
      // do not gate on isMobileLayout() / layout-desktop, and do not move this into mobile.js.
      if (detectSymmetry) setSymmetry(detectImportedSymmetry());

      savePoint();
      if (doHistoryClear) clearHistory();
      persistReady = true;
      persistMapNow();
      applyingRemote = false;
    };
    img.onerror = function() {
      if (serial === restoreSerial) applyingRemote = false;
    };
    img.src = pngBase64;//'https://mdn.mozillademos.org/files/5397/rhino.jpg';
  }
  
  function clearHistory() {
    undoSteps = redoSteps = []
    enableUndoRedoButtons();
  }

  $('#import').click(function() {
    if (importPng && importJson) {
      restoreFromPngAndJson(
        importPng,
        importJson, undefined, true, true);
    } else {
      alert('Please add a PNG and a JSON (tap the squares on a phone, or drag and drop on desktop) before importing.')
    }
  });

  function makeLogicString() {
    return JSON.stringify(makeLogic(), null, 2);
  }
  
  function resizeTo(width, height, deltaX, deltaY) {
    var png = getPngBase64Url();
    var json = makeLogicString();

    restoreFromPngAndJson(png, json, {width: width, height: height, deltaX: deltaX, deltaY: deltaY});
  }

  function parseMapSize() {
    var combined = ($('#mapSize').val() || '').trim();
    var match = combined.match(/^(\d+)\s*[x×,\s]\s*(\d+)$/i);
    if (match) {
      return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
    }
    return {
      width: parseInt($('#resizeWidth').val(), 10),
      height: parseInt($('#resizeHeight').val(), 10)
    };
  }

  $('#resize').click(function(e) {
    e.preventDefault();
    var oldWidth = tiles.length;
    var oldHeight = tiles[0].length;
    var size = parseMapSize();
    var nextWidth = size.width;
    var nextHeight = size.height;

    if (!(nextWidth >= 1) || !(nextHeight >= 1)) {
      alert('Enter a size like 56x24.');
      $('#mapSize').val(oldWidth + 'x' + oldHeight);
      return;
    }
    if (nextWidth * nextHeight > 3600) {
      if (!confirm('Maps larger than 3600 tiles cannot be tested and may lag the browser.\nResize anyway?')) {
        $('#mapSize').val(oldWidth + 'x' + oldHeight);
        return;
      }
    }

    var deltaX = Math.round((nextWidth - oldWidth) / 2);
    var deltaY = Math.round((nextHeight - oldHeight) / 2);
    resizeTo(nextWidth, nextHeight, deltaX, deltaY);
  });

  function mapViewportSize() {
    var el = document.getElementById('map');
    var w = el && el.clientWidth;
    var h = el && el.clientHeight;
    if (el) {
      var cs = window.getComputedStyle(el);
      w -= (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      h -= (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    }
    if (!w || !h) {
      w = window.innerWidth || 320;
      h = Math.max(120, (window.innerHeight || 480) - 180);
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function computeContainTileSize() {
    if (!width || !height) return 8;
    var vp = mapViewportSize();
    var ts = Math.floor(Math.min((vp.w - 1) / width, (vp.h - 1) / height));
    while (ts > 2 && (width * ts > vp.w || height * ts > vp.h)) ts--;
    return Math.max(2, ts);
  }

  function computeCoverTileSize() {
    if (!width || !height) return 8;
    var vp = mapViewportSize();
    var ts = Math.ceil(Math.max(vp.w / width, vp.h / height));
    while (ts < 4096 && width * ts < vp.w && height * ts < vp.h) ts++;
    return Math.max(2, ts);
  }

  function computeFitTileSize() {
    return computeCoverTileSize();
  }

  function syncFitModeFromSize(size) {
    var contain = computeContainTileSize();
    var cover = computeCoverTileSize();
    if (size <= contain + 0.51) fitMode = 'contain';
    else if (size <= cover + 0.51) fitMode = 'cover';
    else fitMode = 'zoom';
  }

  function tileSizeForZoom() {
    var contain = computeContainTileSize();
    var cover = computeCoverTileSize();
    if (fitMode === 'contain') return contain;
    if (zoom <= 0 || fitMode === 'cover') return cover;
    return Math.max(cover, Math.round(cover * Math.pow(1.4, zoom)));
  }

  function applyTilePixelSize(size) {
    tileSize = size;
    var sizeCss = tileSize + 'px';
    var quadrantSizeCss = (tileSize / 2) + 'px';
    var singleTileBackgroundSize = sizeCss + ' ' + sizeCss;
    var tileSheetBackgroundSize = (tileSize * tileSheetWidth) + 'px ' + (tileSize * tileSheetHeight) + 'px';

    function applySize(e) {
      if (e) e.style.width = e.style.height = sizeCss;
    }
    function applyQuadrantSize(e, isLeft, isBottom) {
      e.style.width = e.style.height = quadrantSizeCss;
      e.style.left = isLeft ? '0' : quadrantSizeCss;
      e.style.top = isBottom ? quadrantSizeCss : '0';
      e.style.backgroundSize = tileSheetBackgroundSize;
    }

    for (var x = 0; x < tiles.length; x++) {
      for (var y = 0; y < tiles[0].length; y++) {
        var tile = tiles[x][y];
        var typeIndicator = tile.elem[0];
        var bg = typeIndicator.parentNode;
        if (x == 0) {
          bg.parentNode.style.height = sizeCss;
        }
        applySize(tile.affectedIndicator);
        applySize(tile.selectionIndicator);
        if (tile.topSquare) applySize(tile.topSquare);
        tile.selectionIndicator.style.backgroundSize = singleTileBackgroundSize;
        applySize(tile.elem[0]);
        applySize(tile.background[0]);
        var others = typeIndicator.querySelectorAll('.potentialHighlightOther');
        for (var oi = 0; oi < others.length; oi++) applySize(others[oi]);
        for (var q = 0; q < 4; q++) {
          applyQuadrantSize(tile.quadrantElems[q], q & 2, (q + 1) & 2);
        }
        tile.type.drawOn(tile.elem, tile);
        if (tile.topType) tile.topType.drawOn(tile.elem, tile, true);
        floorType.drawOn(tile.background, null);
      }
    }
  }

  function mapOverflows() {
    var el = document.getElementById('map');
    if (!el) return false;
    return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  }

  function mapScrollSnapshot() {
    var el = document.getElementById('map');
    if (!el) return null;
    return {
      sl: el.scrollLeft,
      st: el.scrollTop,
      cw: el.clientWidth,
      ch: el.clientHeight,
      sw: el.scrollWidth,
      sh: el.scrollHeight
    };
  }

  function pinMapCanvas() {
    var el = document.getElementById('map');
    var canvas = el && el.querySelector('.map-canvas');
    if (!el || !canvas) return;
    var cs = window.getComputedStyle(el);
    var padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var extraX = Math.max(0, el.clientWidth - padX - canvas.offsetWidth);
    var extraY = Math.max(0, el.clientHeight - padY - canvas.offsetHeight);
    canvas.style.marginLeft = (extraX / 2) + 'px';
    canvas.style.marginRight = (extraX / 2) + 'px';
    canvas.style.marginTop = (extraY / 2) + 'px';
    canvas.style.marginBottom = (extraY / 2) + 'px';
  }

  function restoreMapCenter(prev) {
    var el = document.getElementById('map');
    if (!el) return;
    pinMapCanvas();
    var sw = el.scrollWidth;
    var sh = el.scrollHeight;
    if (prev && prev.sw > 0 && prev.sh > 0) {
      el.scrollLeft = (prev.sl + prev.cw / 2) / prev.sw * sw - el.clientWidth / 2;
      el.scrollTop = (prev.st + prev.ch / 2) / prev.sh * sh - el.clientHeight / 2;
    } else {
      el.scrollLeft = Math.max(0, (sw - el.clientWidth) / 2);
      el.scrollTop = Math.max(0, (sh - el.clientHeight) / 2);
    }
  }

  function mapCanvasEl() {
    var el = document.getElementById('map');
    return el && el.querySelector('.map-canvas');
  }

  function minMaxTileSize() {
    var contain = computeContainTileSize();
    var cover = computeCoverTileSize();
    return {
      min: contain,
      max: Math.max(cover, Math.round(cover * Math.pow(1.4, maxZoom)))
    };
  }

  function zoomLevelFromTileSize(size) {
    var cover = computeCoverTileSize();
    if (size <= cover + 0.51) return 0;
    var z = Math.log(size / cover) / Math.log(1.4);
    return Math.max(0, Math.min(maxZoom, Math.round(z)));
  }

  var zoomAnimFrame = 0;
  var viewScale = 1;
  var viewTx = 0;
  var viewTy = 0;

  function cancelZoomAnimation() {
    if (zoomAnimFrame) {
      cancelAnimationFrame(zoomAnimFrame);
      zoomAnimFrame = 0;
    }
  }

  function mapViewCenter() {
    var el = document.getElementById('map');
    if (!el) return { x: 0, y: 0 };
    var rect = el.getBoundingClientRect();
    return {
      x: rect.left + el.clientWidth / 2,
      y: rect.top + el.clientHeight / 2
    };
  }

  function zoomScaleLimits() {
    var lim = minMaxTileSize();
    return { min: lim.min / tileSize, max: lim.max / tileSize };
  }

  function isZoomedIn() {
    if (isMobileLayout()) return zoom > 0 || viewScale > 1.05;
    return zoom > 0;
  }

  function applyViewTransform() {
    var c = mapCanvasEl();
    if (!c) return;
    if (Math.abs(viewScale - 1) < 1e-6 && Math.abs(viewTx) < 0.05 && Math.abs(viewTy) < 0.05) {
      c.style.transform = '';
      c.style.transformOrigin = '';
      c.style.willChange = '';
      return;
    }
    c.style.willChange = 'transform';
    c.style.transformOrigin = '0 0';
    c.style.transform = 'translate3d(' + viewTx + 'px,' + viewTy + 'px,0) scale(' + viewScale + ')';
  }

  function resetViewTransform() {
    cancelZoomAnimation();
    viewScale = 1;
    viewTx = 0;
    viewTy = 0;
    applyViewTransform();
  }

  function beginFocalZoom(clientX, clientY) {
    var c = mapCanvasEl();
    if (!c) return null;
    var cr = c.getBoundingClientRect();
    return {
      localX: (clientX - cr.left) / viewScale,
      localY: (clientY - cr.top) / viewScale,
      baseScale: viewScale
    };
  }

  function setFocalZoom(focal, scale, clientX, clientY) {
    var c = mapCanvasEl();
    if (!c || !focal) return;
    var lim = zoomScaleLimits();
    var next = Math.max(lim.min, Math.min(lim.max, scale));
    if (!(next > 0)) return;
    var cr = c.getBoundingClientRect();
    var layoutX = cr.left - viewTx;
    var layoutY = cr.top - viewTy;
    viewScale = next;
    viewTx = clientX - layoutX - focal.localX * viewScale;
    viewTy = clientY - layoutY - focal.localY * viewScale;
    applyViewTransform();
    zoom = zoomLevelFromTileSize(tileSize * viewScale);
    syncFitModeFromSize(tileSize * viewScale);
    enableZoomButtons();
  }

  function zoomBy(factor, clientX, clientY) {
    var focal = beginFocalZoom(clientX, clientY);
    if (!focal) return;
    setFocalZoom(focal, viewScale * factor, clientX, clientY);
  }

  function rebaseTileSizeToView(clientX, clientY) {
    var c = mapCanvasEl();
    var el = document.getElementById('map');
    if (!c || !el || !tiles || !tiles.length) return;
    if (!(viewScale > 0)) return;
    var identity = Math.abs(viewScale - 1) < 1e-6 && Math.abs(viewTx) < 0.05 && Math.abs(viewTy) < 0.05;
    if (identity) return;

    var center = mapViewCenter();
    if (clientX == null) clientX = center.x;
    if (clientY == null) clientY = center.y;

    var cr = c.getBoundingClientRect();
    var localX = (clientX - cr.left) / viewScale;
    var localY = (clientY - cr.top) / viewScale;
    var oldTile = tileSize;
    var visual = oldTile * viewScale;
    var lim = minMaxTileSize();
    var next = Math.round(visual);
    next = Math.max(lim.min, Math.min(lim.max, next));
    var ratio = next / oldTile;

    viewScale = 1;
    viewTx = 0;
    viewTy = 0;
    applyViewTransform();
    if (next !== oldTile) applyTilePixelSize(next);
    pinMapCanvas();

    var cr2 = c.getBoundingClientRect();
    el.scrollLeft += (cr2.left + localX * ratio) - clientX;
    el.scrollTop += (cr2.top + localY * ratio) - clientY;
    zoom = zoomLevelFromTileSize(tileSize);
    syncFitModeFromSize(tileSize);
    enableZoomButtons();
    if (window.TagproLoupe && TagproLoupe.refresh) TagproLoupe.refresh();
  }

  function clearPreviewZoom() {
    cancelZoomAnimation();
  }

  function animateFocalZoom(targetScale, clientX, clientY) {
    var lim = zoomScaleLimits();
    targetScale = Math.max(lim.min, Math.min(lim.max, targetScale));
    if (!(targetScale > 0) || Math.abs(targetScale - viewScale) < 0.002) return;
    var focal = beginFocalZoom(clientX, clientY);
    if (!focal) return;
    var from = viewScale;
    var t0 = performance.now();
    cancelZoomAnimation();
    function frame(now) {
      var t = Math.min(1, (now - t0) / 180);
      var ease = 1 - Math.pow(1 - t, 3);
      setFocalZoom(focal, from + (targetScale - from) * ease, clientX, clientY);
      if (t < 1) zoomAnimFrame = requestAnimationFrame(frame);
      else {
        zoomAnimFrame = 0;
        rebaseTileSizeToView(clientX, clientY);
      }
    }
    zoomAnimFrame = requestAnimationFrame(frame);
  }

  function showZoom(opts) {
    opts = opts || {};
    resetViewTransform();
    var prev = mapScrollSnapshot();
    var next = tileSizeForZoom();
    if (opts.shrinkOnly) next = Math.min(tileSize, computeContainTileSize());
    applyTilePixelSize(next);
    restoreMapCenter(fitMode === 'contain' || zoom <= 0 ? null : prev);
  }

  function zoomIn() {
    if (isMobileLayout()) {
      var c = mapViewCenter();
      animateFocalZoom(viewScale * 1.4, c.x, c.y);
      return;
    }
    if (fitMode === 'contain') {
      fitMode = 'cover';
      zoom = 0;
    } else {
      fitMode = 'zoom';
      zoom = Math.min(maxZoom, zoom + 1);
    }
    showZoom();
    enableZoomButtons();
  }

  function zoomOut() {
    if (isMobileLayout()) {
      var c = mapViewCenter();
      animateFocalZoom(viewScale / 1.4, c.x, c.y);
      return;
    }
    if (zoom > 0) {
      zoom = zoom - 1;
      fitMode = zoom <= 0 ? 'cover' : 'zoom';
      showZoom();
    } else if (fitMode !== 'contain') {
      fitMode = 'contain';
      zoom = 0;
      showZoom();
    }
    enableZoomButtons();
  }
  
  $('#clear').click(function() {
    if (confirm('Are you sure you want to clear the map?')) {
      clearMap();
    }
  });
  
  function enableZoomButtons() {
    if (isMobileLayout()) {
      var lim = zoomScaleLimits();
      enable($('#zoomIn, #dockZoomIn'), viewScale < lim.max - 0.01);
      enable($('#zoomOut, #dockZoomOut'), viewScale > lim.min + 0.01);
      return;
    }
    enable($('#zoomIn, #dockZoomIn'), zoom < maxZoom || fitMode === 'contain');
    enable($('#zoomOut, #dockZoomOut'), fitMode !== 'contain' || mapOverflows());
  }
  $('#zoomIn').click(function(e) {
    e.preventDefault();
    if ($(this).attr('disabled')) return;
    zoomIn();
  });
  $('#zoomOut').click(function(e) {
    e.preventDefault();
    if ($(this).attr('disabled')) return;
    zoomOut();
  });
  enableZoomButtons();
  $(window).on('resize orientationchange', function() {
    requestAnimationFrame(function() {
      if (!tiles || !tiles.length) return;
      if (isMobileLayout()) {
        if (Math.abs(viewScale - 1) < 0.02) showZoom();
        else applyViewTransform();
        enableZoomButtons();
        return;
      }
      showZoom();
      enableZoomButtons();
    });
  });
  document.documentElement.addEventListener('tagpro-layout', function() {
    resetViewTransform();
    if (tiles && tiles.length) showZoom();
    enableZoomButtons();
  });
  
  $('#dropHelp').click(function() {
    alert("Importing Map:\n" +
      "Drag a .png file and a .json file from your file manager onto their respective squares. When both are added, hit Import to apply them to the current map.\n\n" +
      "Exporting Map:\n" +
      "Hit Export. The .png and .json files can then be dragged or clicked from their respective squares.")
  })
  
  function collabRoomFromUrl() {
    var search = window.location.search || '';
    var q = search.match(/[?&]room=([A-Za-z0-9]{12,16})(?:&|$)/);
    if (q) return q[1];
    var pathname = window.location.pathname || '';
    var m = pathname.match(/^\/collab\/([A-Za-z0-9]{12,16})\/?$/);
    return m ? m[1] : null;
  }

  var savedPng = localStorage.getItem('png')
  var savedJson = localStorage.getItem('json')
  if (collabRoomFromUrl()) {
    persistReady = false;
  } else if (savedPng && savedJson) {
    restoreFromPngAndJson(savedPng, savedJson, undefined, true);
  } else {
    persistReady = true;
    persistMapNow();
  }
  $(window).on('pagehide beforeunload', function() {
    persistReady = true;
    persistMapNow();
  });
  
  var quadrantCoords = {
    "132": [10.5, 7.5],
    "232": [11, 7.5],
    "332": [11, 8],
    "032": [10.5, 8],
    "132d": [0.5, 3.5],
    "232d": [1, 3.5],
    "032d": [0.5, 4],
    "143": [4.5, 9.5],
    "243": [5, 9.5],
    "343": [5, 10],
    "043": [4.5, 10],
    "143d": [1.5, 2.5],
    "243d": [2, 2.5],
    "043d": [1.5, 3],
    "154": [6.5, 9.5],
    "254": [7, 9.5],
    "354": [7, 10],
    "054": [6.5, 10],
    "154d": [9.5, 2.5],
    "254d": [10, 2.5],
    "354d": [10, 3],
    "165": [0.5, 7.5],
    "265": [1, 7.5],
    "365": [1, 8],
    "065": [0.5, 8],
    "165d": [10.5, 3.5],
    "265d": [11, 3.5],
    "365d": [11, 4],
    "176": [1.5, 6.5],
    "276": [2, 6.5],
    "376": [2, 7],
    "076": [1.5, 7],
    "276d": [9, 1.5],
    "376d": [9, 2],
    "076d": [8.5, 2],
    "107": [6.5, 8.5],
    "207": [7, 8.5],
    "307": [7, 9],
    "007": [6.5, 9],
    "207d": [11, 1.5],
    "307d": [11, 2],
    "007d": [10.5, 2],
    "110": [4.5, 8.5],
    "210": [5, 8.5],
    "310": [5, 9],
    "010": [4.5, 9],
    "110d": [0.5, 1.5],
    "310d": [1, 2],
    "010d": [0.5, 2],
    "121": [9.5, 6.5],
    "221": [10, 6.5],
    "321": [10, 7],
    "021": [9.5, 7],
    "121d": [2.5, 1.5],
    "321d": [3, 2],
    "021d": [2.5, 2],
    "142": [1.5, 7.5],
    "242": [2, 7.5],
    "042": [1.5, 8],
    "142d": [10.5, 0.5],
    "242d": [11, 0.5],
    "042d": [10.5, 1],
    "153": [5.5, 6.5],
    "253": [6, 6.5],
    "353": [6, 7],
    "053": [5.5, 7],
    "153d": [5.5, 0.5],
    "253d": [6, 0.5],
    "164": [9.5, 7.5],
    "264": [10, 7.5],
    "364": [10, 8],
    "164d": [0.5, 0.5],
    "264d": [1, 0.5],
    "364d": [1, 1],
    "175": [4.5, 5.5],
    "275": [5, 5.5],
    "375": [5, 6],
    "075": [4.5, 6],
    "275d": [7, 1.5],
    "375d": [7, 2],
    "206": [4, 9.5],
    "306": [4, 10],
    "006": [3.5, 10],
    "206d": [2, 3.5],
    "306d": [2, 4],
    "006d": [1.5, 4],
    "117": [5.5, 2.5],
    "217": [6, 2.5],
    "317": [6, 4],
    "017": [5.5, 4],
    "317d": [6, 3],
    "017d": [5.5, 3],
    "120": [7.5, 9.5],
    "320": [8, 10],
    "020": [7.5, 10],
    "120d": [9.5, 3.5],
    "320d": [10, 4],
    "020d": [9.5, 4],
    "131": [6.5, 5.5],
    "231": [7, 5.5],
    "331": [7, 6],
    "031": [6.5, 6],
    "131d": [4.5, 1.5],
    "031d": [4.5, 2],
    "141": [7.5, 8.5],
    "241": [8, 8.5],
    "323": [4, 5],
    "041": [7.5, 9],
    "141d": [8.5, 3.5],
    "041d": [8.5, 4],
    "152": [8.5, 7.5],
    "252": [9, 7.5],
    "334": [2, 0],
    "052": [8.5, 8],
    "152d": [3.5, 0.5],
    "252d": [4, 0.5],
    "163": [2.5, 7.5],
    "263": [3, 7.5],
    "363": [3, 8],
    "045": [9.5, 0],
    "163d": [7.5, 0.5],
    "263d": [8, 0.5],
    "174": [3.5, 8.5],
    "274": [4, 8.5],
    "374": [4, 9],
    "056": [7.5, 5],
    "274d": [3, 3.5],
    "374d": [3, 4],
    "167": [7.5, 6.5],
    "205": [10, 8.5],
    "305": [10, 9],
    "005": [9.5, 9],
    "205d": [2, 0.5],
    "305d": [2, 1],
    "170": [6.5, 7.5],
    "216": [9, 9.5],
    "316": [9, 10],
    "016": [8.5, 10],
    "316d": [10, 5],
    "016d": [9.5, 5],
    "127": [2.5, 9.5],
    "201": [5, 7.5],
    "327": [3, 10],
    "027": [2.5, 10],
    "327d": [2, 5],
    "027d": [1.5, 5],
    "130": [1.5, 8.5],
    "212": [4, 6.5],
    "330": [2, 9],
    "030": [1.5, 9],
    "130d": [9.5, 0.5],
    "030d": [9.5, 1],
    "151": [10.5, 9.5],
    "251": [11, 9.5],
    "324": [0, 7],
    "051": [10.5, 10],
    "151d": [10.5, 4.5],
    "324d": [0, 0],
    "162": [8.5, 10.5],
    "262": [9, 10.5],
    "335": [6, 8],
    "035": [5.5, 8],
    "162d": [3.5, 2.5],
    "262d": [8, 2.5],
    "173": [0.5, 9.5],
    "273": [1, 9.5],
    "373": [1, 10],
    "046": [11.5, 7],
    "046d": [11.5, 0],
    "273d": [1, 4.5],
    "157": [11.5, 8.5],
    "204": [0, 5.5],
    "304": [0, 5],
    "057": [11.5, 9],
    "204d": [0, 4.5],
    "304d": [0, 6],
    "160": [11.5, 7.5],
    "215": [8, 6.5],
    "315": [8, 7],
    "015": [7.5, 7],
    "160d": [2.5, 4.5],
    "315d": [9, 3],
    "171": [5.5, 10.5],
    "271": [6, 10.5],
    "326": [6, 5],
    "026": [5.5, 5],
    "326d": [7, 5],
    "026d": [4.5, 5],
    "137": [3.5, 6.5],
    "202": [0, 7.5],
    "337": [4, 7],
    "037": [3.5, 7],
    "202d": [9, 4.5],
    "037d": [2.5, 3],
    "140": [11.5, 5.5],
    "213": [0, 8.5],
    "313": [0, 9],
    "040": [11.5, 5],
    "140d": [11.5, 4.5],
    "040d": [11.5, 6],
    "161": [9.5, 10.5],
    "261": [10, 10.5],
    "325": [9, 6],
    "025": [8.5, 6],
    "161d": [3.5, 1.5],
    "325d": [4, 1],
    "172": [1.5, 10.5],
    "272": [2, 10.5],
    "336": [3, 6],
    "036": [2.5, 6],
    "036d": [7.5, 1],
    "272d": [8, 1.5],
    "147": [4.5, 7.5],
    "203": [4, 3.5],
    "303": [4, 4],
    "047": [4.5, 8],
    "047d": [8.5, 5],
    "203d": [8, 4.5],
    "150": [7.5, 3.5],
    "214": [7, 7.5],
    "314": [7, 8],
    "050": [7.5, 4],
    "150d": [3.5, 4.5],
    "314d": [3, 5],
    "100": [5.5, 5.5],
    "200": [6, 5.5],
    "300": [6, 6],
    "000": [5.5, 6],
    "100d": [5.5, 8.5],
    "200d": [6, 8.5],
    "300d": [6, 10],
    "000d": [5.5, 10]
  };
  redrawPaletteTiles();

  function parseFortunateMapsId(input) {
    var s = String(input || '').trim();
    if (!s) return null;
    var query = s.match(/[?&]mapid=(\d+)/i);
    if (query) return query[1];
    var path = s.match(/\/(?:map|png|json|preview|show|editor)\/(\d+)/i);
    if (path) return path[1];
    var digits = s.match(/^(\d+)$/);
    if (digits) return digits[1];
    return null;
  }

  function importFromFortunateMaps(idOrUrl) {
    var id = parseFortunateMapsId(idOrUrl);
    if (!id) {
      alert('Enter a FortunateMaps map ID or URL (example: 77011).');
      return;
    }
    $('#fmImport').addClass('disabled').text('Importing…');
    $.getJSON('/fm/map/' + id)
      .done(function(data) {
        if (!data || !data.png || !data.json) {
          alert('FortunateMaps did not return a PNG and JSON for that map.');
          return;
        }
        var jsonString = typeof data.json === 'string' ? data.json : JSON.stringify(data.json);
        restoreFromPngAndJson(data.png, jsonString, undefined, true, true);
        $('#importExport').modal('hide');
      })
      .fail(function(xhr) {
        var msg = (xhr.responseJSON && xhr.responseJSON.err) || 'Could not import that FortunateMaps map.';
        alert(msg);
      })
      .always(function() {
        $('#fmImport').removeClass('disabled').text('Import from FM');
      });
  }

  $('#fmImport').on('click', function(e) {
    e.preventDefault();
    importFromFortunateMaps($('#fmMapId').val());
  });
  $('#fmMapId').on('keydown', function(e) {
    if (e.which === 13) {
      e.preventDefault();
      importFromFortunateMaps($('#fmMapId').val());
    }
  });
  $('#fmExport').on('click', function(e) {
    e.preventDefault();
    $('#export').trigger('click');
    window.open('https://fortunatemaps.herokuapp.com/editor', '_blank');
    alert('PNG and JSON are ready in this dialog. Sign in on FortunateMaps, then upload those two files.');
  });

  function redrawTextures() {
    var tilesUrl = (window.TagproTextures && TagproTextures.tilesUrl)
      ? TagproTextures.tilesUrl()
      : 'default-skin-v2.png';
    var sheet = document.getElementById('texturePackSheet');
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = 'texturePackSheet';
      document.head.appendChild(sheet);
    }
    sheet.textContent = 'div.tileQuadrant{background-image:url("' + String(tilesUrl).replace(/"/g, '\\"') + '") !important;}';
    if (tiles && tiles.length) {
      for (var x = 0; x < tiles.length; x++) {
        for (var y = 0; y < tiles[0].length; y++) {
          bustDrawCache(tiles[x][y].elem);
          bustDrawCache(tiles[x][y].background);
        }
      }
    }
    if (tiles && tiles.length) showZoom();
    redrawPaletteTiles();
    if (window.TagproLoupe && TagproLoupe.refresh) TagproLoupe.refresh();
    if (window.TagproPalette && TagproPalette.refreshScale) TagproPalette.refreshScale();
  }

  function paintLoupeCell(x, y, bgEl, cellPx) {
    if (!bgEl) return;
    cellPx = 40;
    var tileEl = bgEl.querySelector('.tile') || bgEl;
    var $bg = $(bgEl);
    var $tile = $(tileEl);
    var size = cellPx + 'px';
    var half = (cellPx / 2) + 'px';
    var sheetSize = (tileSheetWidth * cellPx) + 'px ' + (tileSheetHeight * cellPx) + 'px';
    bgEl.style.width = bgEl.style.height = size;
    bgEl.style.display = 'inline-block';
    bgEl.style.position = 'relative';
    tileEl.style.width = tileEl.style.height = size;
    var kids = tileEl.children || [];
    for (var q = 0; q < 4; q++) {
      if (!kids[q]) continue;
      kids[q].style.width = kids[q].style.height = half;
      kids[q].style.left = (q & 2) ? '0' : half;
      kids[q].style.top = ((q + 1) & 2) ? half : '0';
      kids[q].style.position = 'absolute';
      kids[q].style.backgroundSize = sheetSize;
    }
    for (var hi = 0; hi < kids.length; hi++) {
      if (!kids[hi]) continue;
      if (/topSquare/.test(kids[hi].className || '')) {
        kids[hi].style.display = 'none';
      }
    }
    var sel = tileEl.querySelector('.selectionIndicator');
    var pot = tileEl.querySelector('.potentialHighlight');
    if (sel) {
      sel.style.width = sel.style.height = size;
      sel.style.backgroundSize = size + ' ' + size;
      sel.style.display = 'none';
      sel.style.pointerEvents = 'none';
    }
    if (pot) {
      pot.style.width = pot.style.height = size;
      pot.style.display = 'none';
      pot.style.pointerEvents = 'none';
    }
    bustDrawCache($bg);
    bustDrawCache($tile);
    var saved = tileSize;
    tileSize = cellPx;
    var src = tiles && tiles[x] && tiles[x][y];
    if (!src) {
      emptyType.drawOn($bg, null);
      emptyType.drawOn($tile, {
        x: x,
        y: y,
        quadrantElems: [kids[0], kids[1], kids[2], kids[3]]
      });
    } else {
      var fake = {
        x: x,
        y: y,
        quadrantElems: [kids[0], kids[1], kids[2], kids[3]],
        topSquare: tileEl.querySelector('.topSquare') || kids[4]
      };
      floorType.drawOn($bg, null);
      src.type.drawOn($tile, fake);
      if (src.topType) src.topType.drawOn($tile, fake, true);
      var srcEl = src.elem && src.elem[0];
      if (srcEl) {
        var srcSel = srcEl.querySelector('.selectionIndicator');
        var srcPot = srcEl.querySelector('.potentialHighlight');
        if (sel && srcSel && srcSel.style.display && srcSel.style.display !== 'none') {
          sel.style.display = 'inline-block';
        }
        if (pot && srcPot && srcPot.style.display && srcPot.style.display !== 'none') {
          pot.style.display = 'inline-block';
          pot.style.backgroundColor = srcPot.style.backgroundColor || ownHighlightHex;
        }
      }
    }
    tileSize = saved;
  }

  window.TagproMap = {
    detectImportedSymmetry: detectImportedSymmetry,
    restoreFromPngAndJson: restoreFromPngAndJson,
    restoreFromExtractedMap: restoreFromExtractedMap,
    extractMap: extractMap,
    importFromFortunateMaps: importFromFortunateMaps,
    getPngBase64Url: getPngBase64Url,
    makeLogicString: makeLogicString,
    setApplyingRemote: function(v) { applyingRemote = !!v; },
    isApplyingRemote: function() { return applyingRemote; },
    enablePersist: function() { persistReady = true; },
    persistNow: persistMapNow,
    getSize: function() { return { width: width, height: height, tileSize: tileSize, zoom: zoom, viewScale: viewScale }; },
    fitView: function() { showZoom(); enableZoomButtons(); },
    zoomIn: zoomIn,
    zoomOut: zoomOut,
    beginFocalZoom: beginFocalZoom,
    setFocalZoom: setFocalZoom,
    zoomBy: zoomBy,
    isZoomedIn: isZoomedIn,
    brushName: function() { return brushTileType && brushTileType.name; },
    rebaseTileSizeToView: rebaseTileSizeToView,
    resetViewTransform: resetViewTransform,
    clearPreviewZoom: clearPreviewZoom,
    zoomScaleLimits: zoomScaleLimits,
    redrawTextures: redrawTextures,
    paintLoupeCell: paintLoupeCell,
    tileHasSettings: tileHasSettings,
    openTileSettings: openTileSettings,
    armSettingsModalGuard: armSettingsModalGuard,
    setOwnHighlightColor: setOwnHighlightColor,
    showPeerHighlights: showPeerHighlights,
    clearPeerHighlights: clearPeerHighlights,
    onSpeculativeHover: function(fn) { speculativeListener = fn; },
    pinConsoleCursor: pinConsoleCursor,
    launchTest: launchTest,
    onTilesRebuilt: function(fn) { tilesRebuiltListener = fn; },
    rotateCw: function() { rotateMap(90); },
    rotateCcw: function() { rotateMap(-90); },
    flipH: function() { flipMap('h'); },
    flipV: function() { flipMap('v'); },
    mirrorV: function() { mirrorMap('down'); },
    paletteNames: function() {
      return paletteOrder.map(function(t) { return t.name; });
    },
    inspectTile: function(x, y) {
      var t = tiles[x] && tiles[x][y];
      if (!t) return null;
      return {
        type: t.type && t.type.name,
        topType: t.topType && t.topType.name,
        destination: t.destination ? { x: t.destination.x, y: t.destination.y } : null
      };
    },
    tileElem: function(x, y) {
      var t = tiles[x] && tiles[x][y];
      return (t && t.elem) ? t.elem : $();
    },
    previewPasteAt: previewPasteAt,
    lockPasteInput: lockPasteInput,
    highlightClipboardSource: highlightClipboardSource,
    tileAtClient: function(clientX, clientY) {
      // Unmagnified canvas hit-test. Do not use this to drive loupeCenter while following.
      var c = mapCanvasEl();
      if (!c || !width || !height) return null;
      var cr = c.getBoundingClientRect();
      if (cr.width < 1 || cr.height < 1) return null;
      if (clientX < cr.left || clientY < cr.top || clientX >= cr.right || clientY >= cr.bottom) return null;
      var x = Math.floor((clientX - cr.left) / cr.width * width);
      var y = Math.floor((clientY - cr.top) / cr.height * height);
      if (x < 0) x = 0;
      if (y < 0) y = 0;
      if (x >= width) x = width - 1;
      if (y >= height) y = height - 1;
      return { x: x, y: y };
    },
    setTile: function(x, y, typeName) {
      var type = typeByNameMap()[typeName];
      if (!type || !tiles[x] || !tiles[x][y]) return false;
      applyStep(new UndoStep([new TileState(tiles[x][y], { type: type })]));
      savePoint();
      return true;
    },
    marsBallCount: function() { return marsBallCount; }
  };
});
