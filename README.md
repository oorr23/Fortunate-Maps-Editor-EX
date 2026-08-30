# Fortunate Maps Editor EX

**Fortunate Maps Editor EX** is a web map editor with phone, desktop, and console layouts, plus an iOS-style magnifying glass.

Based on the current public TagPro editor in [raikutro/fortunatemaps](https://github.com/raikutro/fortunatemaps) (`editor/public`, including its texture-pack menu). That editor descends from [PeterReid/tagpro-map-editor](https://github.com/PeterReid/tagpro-map-editor) (AGPL-3.0). This repo keeps the FortunateMaps editing model; it is not the FortunateMaps website (accounts, MongoDB, map hosting).

## Layout: mobile by default

The editor **detects the screen** and applies `layout-mobile` or `layout-desktop` on `html`/`body`.

**Default is mobile.** Desktop is used only when all of these are true (Auto mode):

- Viewport width is at least **1024px**
- Pointer is **fine** and **hover** is available (mouse/trackpad, not a finger-first screen)
- If the device is in **portrait**, width must be at least **1280px** (so tablets in portrait stay mobile)

Ambiguous, unknown, small, coarse-pointer, or portrait-tablet screens stay on the mobile UI.

Testers can force **Auto / Desktop / Mobile / Console** in More (or the sidebar on desktop). Console is for handhelds/Steam Deck; Auto never picks it. A layout pick lasts for this session only — every page load starts in Auto.

## Run locally

1. Install [Node.js](https://nodejs.org)
2. In this folder:

```
npm install
npm start
```

3. Open http://localhost:8060

The original README said `npm main`; the start command is `node main.js` (also available as `npm start`). The server listens on port 8060 on all interfaces so a phone on the same Wi-Fi can use `http://YOUR_LAN_IP:8060`.

## Test the layout switch

**Chrome device toolbar (mobile):**

1. Open http://localhost:8060
2. Press F12, then Ctrl+Shift+M (Device toolbar)
3. Pick a portrait phone (e.g. iPhone 12 / 390x844) and reload
4. You should see the bottom dock (`html` has class `layout-mobile`)
5. Tap a tile, paint on the map, long-press to open the loupe under your finger

**Wide desktop window:**

1. Turn the device toolbar **off**
2. Make the window at least 1024px wide (1280+ if the window is tall/portrait)
3. Reload — you should get the left sidebar (`layout-desktop`) if you have a mouse
4. In More / the sidebar, click Mobile to force the phone UI, Desktop to force the sidebar, Console for the handheld frame, Auto to restore detection. Reload always returns to Auto.

**Real phone on your LAN:**

1. Find this PC IPv4 address (`ipconfig` on Windows)
2. On the phone, open `http://IP:8060` (same Wi-Fi; allow Node on port 8060 in Windows Firewall)

## Mobile UI

- The map is the main surface
- Tile palette, drawing tools, undo/redo, zoom, pan, and More sit in a bottom dock
- Tap targets are at least ~44px
- Clear / Save / Test / import-export / resize / symmetry live in a collapsible More sheet
- One finger paints without scrolling the page
- Long-press (~280ms) or drag-paint shows a magnifier centered on the finger (about 2.5x); drag across magnified cells to move the focus
- Two-finger drag pans; pinch changes zoom; the hand button is one-finger pan

## License

GNU Affero General Public License v3.0 — see `LICENSE.txt`. The FortunateMaps site is Apache-2.0; the map editor it vendors remains AGPL. Copyright of the original editor belongs to Peter Reid and contributors.