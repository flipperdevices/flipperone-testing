# fake-flipctl

## What is this project

A web application that simulates the Flipper One LCD screen user interface. It renders a 256x144 monochrome (black/white/grayscale) display using HTML5 Canvas and runs inside the Cog web browser on the actual Flipper One hardware.

## Tech Stack

- **Vanilla JS + CSS** — no frameworks, no bundlers, no client-side dependencies
- **Node.js server** (`server.js`) — static file server + JSON API endpoints, requires root
- **HTML5 Canvas** — pixel-perfect 256x144 rendering
- **Cog browser** — minimal WebKit-based browser (Wayland)

## Architecture

### Server (`server.js`)
- Static file server on port **8899** (binds `0.0.0.0`), requires root
- Serves JSON API endpoints (all return `application/json`):
  - **`/api/modem`** — aggregates `mmcli -m 0 -J`, `qmicli --nas-get-serving-system`, `--nas-get-cell-location-info`, `--nas-get-signal-strength` for RM530N-GL modem via `/dev/cdc-wdm0`; also reads sysfs byte counters on the modem net interface for live bandwidth
  - **`/api/wifi`** — parses `nmcli -t -f ACTIVE,SIGNAL dev wifi` for active SSID signal; returns `{ connected, quality (0-100) }`
  - **`/api/power`** — reads sysfs `/sys/class/power_supply/bq28z610-0` (voltage, current, capacity, charge, temp, time estimates)
  - **`/api/disk`** — reads `df` for `/dev/mmcblk0p2` usage (eMMC)
  - **`/api/routing`** — current routing info
  - **`/api/ethernet`** — ethernet link/IP info
  - **`/api/hostname`** (GET) — returns `{ hostname }`
  - **`/api/version`** (GET) — returns `{ id: SERVER_ID }`; client polls this to detect a server restart and reload the page
  - **`/api/update/check`** — check for available update
  - **`/api/update/apply`** (POST) — apply update, then `daemon-reload` + restart `fake-flipctl-node-server.service` via transient `systemd-run` (survives the restart)
  - **`/api/switch/flipctl`** (POST) — swaps the `/flipperone-testing/active-flipctl` symlink to the other variant (fake-flipctl ↔ fake-flipctl2), then restarts the node service. Client reloads via `/api/version` polling
  - **`/api/sound/files`** — list playable sound files
  - **`/api/sound/play`** (POST `{ file }`) — play a file
  - **`/api/sound/stop`** (POST) — stop playback
  - **`/api/sound/devices`** — list audio output devices
  - **`/api/sound/device`** (POST `{ device }`) — set default audio device
  - **`/api/sound/volume`** (GET) — current volume
  - **`/api/sound/volume`** (POST `{ control, volume }`) — set volume
  - **`/api/sound/restart-driver`** (POST) — restart the audio driver
- Systemd unit: `fake-flipctl-node-server.service` (lives in the sibling `fake-flipctl/` repo — units are shared; the active variant is picked via the `/flipperone-testing/active-flipctl` symlink)

### Client
- **Bitmap font** (`js/font.js`) — custom 5x7 pixel font, 6x8 cell (supports ASCII 32-126)
- **Canvas layer** (`js/canvas.js`) — drawing primitives (rect, text, line, pixel, frame)
- **Input layer** (`js/input.js`) — keyboard events mapped to actions (up/down/left/right/ok/back)
- **Scene manager** (`js/scene.js`) — stack-based push/pop scene navigation
- **UI components** (`js/ui.js`) — status bar (with battery icon + percentage, polls `/api/power` every 5s), menu list with highlight, scrollbar
- **App scenes** (`js/apps/`) — each screen is a scene with `render()` and `handleInput()`, returns `'pop'` from `handleInput` to go back

## Display

- Resolution: **256x144** pixels
- Colors: black and white only, grayscale accents
- Font: custom 5x7 bitmap font (`js/font.js`), 6x8 cell, pixel-perfect rendering via `fillRect`

## Input

- Keyboard only: Arrow keys, Enter (ok), Escape/Backspace (back)

## Running

```bash
sudo node server.js
```
Then open `http://localhost:8899` in a browser. Requires root for sysfs access. No build step needed.

### Cog browser on Flipper One

Cog has platform plugins: `wl` (Wayland), `drm`, `headless`. Available at `/usr/lib/aarch64-linux-gnu/cog/modules/`.

To force window size on KDE/Wayland, use KDE window rules in `~/.config/kwinrulesrc`:

```ini
[499e477a-c004-4eac-ba76-430ec6419c46]
Description=Settings for com.igalia.Cog
ignoregeometry=true
ignoregeometryrule=2
position=0,0
positionrule=2
screenrule=2
size=256,144
sizerule=2
wmclass=com.igalia.Cog
wmclassmatch=1

[General]
count=1
rules=499e477a-c004-4eac-ba76-430ec6419c46
```

### Kiosk mode (cage + cog, no KDE)

The goal is to run Cog directly on the 256x144 SPI LCD without KDE. Cog's DRM plugin (`-P drm`) only works with GPU-backed connectors (HDMI on card2), not the SPI panel on card0. The solution is **cage** — a minimal Wayland kiosk compositor that handles non-GPU displays and runs one app fullscreen.

Systemd units (in `systemd/`):
- **`fake-flipctl-node-server.service`** — Node.js HTTP server (port 8899, web UI + JSON APIs), requires root for sysfs
- **`fake-flipctl-wayland-cage.service`** — cage compositor + Cog browser on tty1, replaces getty, runs as `root` (required for `LIBSEAT_BACKEND=builtin` — libseat's builtin backend needs root to manage DRM/TTY directly, avoiding the need for seatd or a logind session)
- **`fake-flipctl.target`** — groups both services; enabled on `multi-user.target`

Install:
```bash
sudo cp systemd/*.service systemd/*.target /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable fake-flipctl.target fake-flipctl-wayland-cage.service fake-flipctl-node-server.service
sudo reboot
```

DRM devices:
- `/dev/dri/card0` — SPI LCD panel (256x144, panel-mipi-dbi-spi)
- `/dev/dri/card2` — Rockchip GPU/HDMI (only used when external monitor connected)

## Live development workflow

Two sibling variants exist on the device:
- **`/flipperone-testing/fake-flipctl/`** — the "flipctl" variant
- **`/flipperone-testing/fake-flipctl2/`** — this repo, the "flipctl2" variant
- **`/flipperone-testing/active-flipctl`** — symlink pointing at whichever variant is currently active. The systemd service serves whatever this points to. Swap it via `POST /api/switch/flipctl`.

### Edit & reload cycle

1. Edit files in this directory
2. Reload the UI: `sudo systemctl restart cog-seat1.service`
3. The client auto-reloads when `/api/version` reports a new `SERVER_ID` after `fake-flipctl-node-server.service` restarts — no manual page refresh needed

## UI Sandbox

Isolated development environment for building and inspecting components from the component library without running the full app. Runs as its own Node server on a separate port, so editing sandbox-only code never touches the live app.

### Running

```bash
node ui-sandbox.js
```

Serves on **port 8900** (no root required, independent of the main app on 8899). Open `http://localhost:8900/`.

### Views

- **Library view** (default): grid of cards, one per registered component (name + short description). Click a card → detail view.
- **Detail view**: 3× zoomed 256×144 canvas with a light-gray/white checker background (so transparent pixels are visible), a 1-native-pixel grid overlay (toggleable), and auto-generated controls that match the selected component's `tweakables` schema. `← back to library` returns to the list.

### Files

- **`ui-sandbox.js`** — minimal static server. No API endpoints, no sysfs, no root.
- **`ui-sandbox.html`** — browser entry. Dark theme with Flipper orange (`#FF8200`) accent for controls.
- **`js/sandbox/main.js`** — registers the `COMPONENTS` list, renders library cards, handles list↔detail transitions, owns the render loop.
- **`js/sandbox/controls.js`** — schema-driven controls builder (see below).

### Registering a component for the sandbox

1. Add a static `tweakables` schema on the component (outside the IIFE):
   ```js
   MyComponent.tweakables = [
       { section: 'position' },
       { key: 'x', type: 'range', min: 0, max: 256, default: 0 },
       // ...
   ];
   ```
2. Add an entry to the `COMPONENTS` array in `js/sandbox/main.js`:
   ```js
   { name: 'MyComponent', ctor: MyComponent, description: 'What it does.' }
   ```
3. Ensure `ui-sandbox.html` loads the component file via `<script>` (in the component-library block at the bottom).

No other wiring needed — the sandbox instantiates the component with the schema's defaults, builds the controls UI, and mutates the instance on change.

### Tweakables schema

Each entry is one of:

| Entry | Produces |
| --- | --- |
| `{ section: 'name' }` | Starts a new panel with this title |
| `{ key, type: 'range', min, max, default, label? }` | Number slider with live value readout |
| `{ key, type: 'color', default, label? }` | Native color picker with hex readout |
| `{ key, type: 'bool',  default, label? }` | Checkbox |
| `{ key, type: 'enum',  options: [...], default, label? }` | Radio group |

- `key` supports dot paths (e.g. `'corners.tl'`). On change, the builder mutates the live instance directly via that path.
- `label` defaults to the key.
- For `enum`, `options` can be strings or numbers; their original type is preserved through `onChange`.

### Constraints & notes

- Components exposed to the sandbox should recompute layout inside `render()` (stateless). Components that cache computed state in an `_update()` method — like `MessageBox` — need setter-based mutation to stay correct; they're not currently in the sandbox registry.
- The sandbox canvas clears to **transparent** each frame (checker shows through). A component whose appearance depends on being drawn over a specific filled background (e.g. over a prior `canvas.clear('#fff')`) should either paint its own background or behave well on transparent — `ResponsiveFrame`'s body-only fill is the reference pattern here.
- Main app and sandbox load the **same** component file from `js/component-library/`. Both `server.js` and `ui-sandbox.js` serve from the project root. Edit once, reload both pages — behavior stays in sync.

## File: test-screen.html

Test pattern page for verifying LCD display alignment — draws 1px border, diagonal cross, center crosshair, and corner coordinate labels at native 256x144.

## Project Structure

```
fake-flipctl2/
├── server.js                      # Node.js HTTP server + API endpoints (main app, port 8899)
├── index.html                     # Main app entry point
├── ui-sandbox.js                  # Sandbox Node server (port 8900, no root) — see UI Sandbox
├── ui-sandbox.html                # Sandbox browser entry (component library + demo views)
├── test-screen.html               # Display test pattern
├── png-to-bitmap.py               # PNG → 6-bit grayscale sprite/icon converter
├── cog-drm-research.txt           # Notes on Cog DRM/Wayland setup
├── css/style.css                  # Layout, canvas scaling
└── js/
    ├── main.js                    # Bootstrap + render loop (requestAnimationFrame)
    ├── canvas.js                  # Drawing primitives (drawRect, drawFrame, drawSprite, _drawGrayscaleSprite)
    ├── font.js                    # 5x7 bitmap font data (legacy, small font)
    ├── haxrcorp16.js              # HaxrcorpFont16 — primary 5x7 font used across the UI
    ├── input.js                   # Keyboard event → action mapping
    ├── scene.js                   # Scene stack manager (push/pop)
    ├── ui.js                      # Status bar (battery, signal, tech, wifi, time) + shared components
    ├── icons.js                   # Icon definitions (re-exports from js/icons/icons.js)
    ├── sprites.js                 # Large sprite assets (dolphin, StatusBarBattery, etc.)
    ├── keyboard-blinking-cursor.js # Blinking cursor helper for text input
    ├── component-library/         # Reusable components — see Component Library & UI Sandbox sections
    │   ├── MessageBox.js          # Rounded speech-bubble dialog with tail indicator
    │   ├── ResponsiveFrame.js     # Configurable rect: fill, 1px stroke, per-corner rounding, anchor
    │   └── MenuSelectorFrame.js   # Menu selection frame (duplicate of ResponsiveFrame, diverging)
    ├── sandbox/                   # Sandbox boot + schema-driven controls builder
    │   ├── main.js                # Library list → component detail → render loop
    │   └── controls.js            # Builds UI from each component's .tweakables schema
    ├── icons/
    │   └── icons.js               # 6-bit grayscale icon data (network, system, testing, wifi_0..100, etc.)
    └── apps/
        ├── desktop.js             # Desktop startup scene with Menu button
        ├── menu.js                # Main menu (Network, Testing, Settings — no breadcrumb, no bottom buttons; keyboard-only navigation)
        ├── animated_icons.js      # Vertical sprite strips (e.g. settings_animated) played on SELECTED menu items
        ├── submenu.js             # Generic submenu handler
        ├── modem5g.js             # 5G modem info via /api/modem
        ├── diskspace.js           # Disk space via /api/disk
        ├── power.js               # Battery info via /api/power
        ├── routing.js             # Routing info via /api/routing
        ├── ethernet.js            # Ethernet info via /api/ethernet
        ├── sound.js               # Sound menu: files, devices, volume, driver restart (via /api/sound/*)
        ├── update.js              # OTA update via /api/update/check + /api/update/apply
        ├── screentest.js          # Display test pattern scene
        ├── figma_live_preview.js  # Embeds a Figma prototype in a 256×144 iframe; shows a mix-blend "x2 to exit" hint
        └── boot_menu_ui_demo.js   # Complex UI demo with profiles, cloning, rename
```

Note: systemd units are **not** in this repo. They live in the sibling `/flipperone-testing/fake-flipctl/systemd/` and are shared between both variants via the `active-flipctl` symlink.

---

## Status Bar

### Layout
- **Height**: 13px (`STATUS_BAR_H` in `ui.js`)
- **Background**: Black (`#000`)
- **Top padding for all elements**: 3px (`STATUS_BAR_PAD_TOP`)
- **Foreground color**: White (`#fff`). Grayscale sprites preserve their
  internal shade relationships through the canvas alpha-blending path.
- **Left side** (conditional, laid out left-to-right via a `leftX` cursor):
  1. **5G signal bars + tech label** — only when modem reports
     `available: true`.
  2. **Wifi icon** — only when wifi is connected.
  3. **Ethernet icon** (`Icons.ethernet_statusbar`, 13×7) — only when at
     least one ethernet interface reports a `connected` state (and not
     `disconnected`).
- **Right side**: Battery percentage + battery sprite. Charging bolt
  overlays the battery sprite when `batteryCharging === true`.
- **No time/date** is rendered in this variant.

### 5G Signal Bars

**Visual Indicator** (left-side cursor, 2px initial padding):
- **5 vertical bars** with heights: 3, 4, 5, 6, 7px (left to right)
- **Width**: 1px each, 1px gap → 9px total span
- **`drawSignalBars(canvas, x, topY, quality)`** takes `topY` as the top
  of the *tallest* bar; all bars share a common bottom so shorter bars
  are bottom-aligned.

**Coloring**:
- **White (`#fff`)** — filled bars (`ceil(quality / 100 * 5)`)
- **`#ccc`** — empty bars. Kept intentionally as a "shade" tone rather
  than re-inverting, so the empty/filled contrast mirrors the light-mode
  palette.

**Visibility**: The whole block (bars + tech label) is skipped when
`modemAvailable === false`, which happens when `/api/modem` returns
`available: false` **or** the poll errors/times out.

**Source**: Polled from `/api/modem` every 1 second.

### Technology Label

**Display** (right of signal bars, 2px gap):
- **Format**: Technology abbreviation (5G, LTE, 3G, 2G, or combos like
  "5G+LTE")
- **Default**: `--` (never visible, since the whole block hides when no
  modem)
- **Font**: HaxrcorpFont16
- **Color**: `#fff`
- **Position**: `leftX` cursor after the signal bars, `y = top` (=3)

**Mapping**:
- `5gnr` → "5G"
- `lte` → "LTE"
- `umts/hspa/hsdpa/hsupa` → "3G"
- `gsm/gprs/edge` → "2G"
- Multiple techs joined with `+`

### Wifi Icon

**Display** (after modem block via `leftX` cursor, only when connected):
- **Size**: 7×7 sprite, rendered via `canvas.drawSprite(..., '#fff')`
- **Position**: `leftX`, `y = top` (=3)
- **Icon variants** (by `quality` 0–100):
  - `>= 80` → `Icons.wifi_100`
  - `>= 60` → `Icons.wifi_75`
  - `>= 40` → `Icons.wifi_50`
  - `>= 20` → `Icons.wifi_25`
  - else → `Icons.wifi_0`
- **Hidden** when `wifiConnected === false`

**Source**: Polled from `/api/wifi` every 2 seconds.

### Ethernet Icon

**Display** (after wifi via `leftX` cursor, only when connected):
- **Asset**: `Icons.ethernet_statusbar` (13×7, 6-bit grayscale)
- **Rendered** with `canvas.drawSprite(..., '#fff')`
- **Connected check**: `state.indexOf('connected') !== -1 && state.indexOf('disconnected') === -1` over all interfaces returned by `/api/ethernet`
- **Source**: Polled from `/api/ethernet` every 2 seconds

### Battery Icon + Charging Overlay

**Battery sprite** (right-aligned):
- **Asset**: `StatusBarBattery.sprite` (16×9, 6-bit grayscale)
- **`batteryX = canvas.w - 2 - 16`** → `238px`
- **`batteryY = top - 1`** → `2px` (raised 1px vs. the other elements
  so the visual center sits closer to the bar's optical midline)

**Battery level bar** (drawn inside the sprite):
- **Max**: 10px wide × 5px tall at 100%
- **`barX = 240`** (fixed)
- **`barY = top + 1`** → `4px` (2px from the sprite's top-left)
- **Color**: `#fff`

**Percentage text** (right-aligned to the battery sprite):
- **Font**: HaxrcorpFont16, color `#fff`
- **Position**: Right edge of the last glyph sits **1px left** of the
  battery sprite — computed with `textX = batteryX - 1 - HaxrcorpFont16.textWidth(pctStr)` (do **not** approximate with `pctStr.length * 6`; glyph widths vary).
- **Y**: `top - 2` (raised 1px vs. other elements for optical
  alignment with the battery sprite, matching the sprite's 1px rise)

**Charging overlay**:
- When `batteryCharging === true`, `Icons.charging_status_bar` (16×9)
  is drawn on top of the battery sprite at `(batteryX, batteryY)`
  (flush with sprite top-left).
- **Rendered via `canvas.drawSpriteLiteral`** (not `drawSprite`) so the
  three tones map as: dark source → black, bright source → white,
  `gray=63` sentinel → transparent (battery shows through around the
  bolt silhouette). See [Canvas Drawing Primitives](#basic-methods).

### Battery State

- **Default `batteryLevel`**: `-1` (unknown) → `--%` until the API
  responds.
- **Source**: `/api/power` polled every 5 seconds. `batteryCharging` is
  set when `status` is `'Charging'` or `'Full'`.

---

## Input Handling & Button Feedback

### Keyboard Mapping (input.js)
```
ArrowUp/i → 'up'      | ArrowDown/m → 'down'
ArrowLeft/j → 'left'  | ArrowRight/l → 'right'
Enter/k → 'ok'        | Escape/Backspace/n → 'back'
z → 'esc'             | x → 'edit'
c → 'power'           | v → 'view'
a → 'ptt'             | b → 'run'
h → 'appsw'
```

### Button Press/Release Cycle
```javascript
// When action maps to a button (via btnActionMap):
btn.press();                    // Set state to 'pressed' (visual feedback)
if (btn.onPress) btn.onPress(); // Execute callback (e.g., open new scene)
setTimeout(function() {
    btn.release();              // Reset state after 30ms
}, 30);
```

**Press-feedback timing** (authoritative, from code):
- **Bottom-bar buttons** (Left/Middle/Right): **30ms** release — used in `desktop.js`, `menu.js`, `submenu.js`
- **PopupMenuLeft item selection**: **150ms** before `onSelect` fires — gives the inverted (black fill + white text) press state time to render
- **Keyboard key press**: **150ms** before clearing the pressed row/col

The longer 150ms delay is intentional for popup/keyboard: the user is committing to a choice, so the press flash must be clearly visible. Bottom-bar buttons are fast (30ms) because the next scene is often about to replace the whole screen.

### Button Bar Layout
- **5 button slots** (48px each, 2px gap): `5 × 48 + 4 × 2 = 256px` exactly
- **Position 0**: Left button (flush left, optional)
- **Positions 1-3**: Middle buttons (center area, optional)
- **Position 4**: Right button (flush right, optional)

Example from Desktop scene:
```javascript
this.app_defined_buttons = [
    null,  // Slot 0 (left) - unused
    new UI.MiddleButton('Menu', 1, 48, 2, 'edit', callback),  // Slot 1
    null,  // Slot 2
    null,  // Slot 3
    null   // Slot 4 (right) - unused
];
```

## Sprite System (Large Bitmap Assets)

### Overview
For large images (>16×16), use the sprite system instead of icons:
- **sprites.js** — sprite asset definitions
- **canvas.drawSprite()** — render sprites of any size
- Data format: bitmap array with multiple hex values per row

### Creating Sprites
1. **Convert image** to monochrome (black/white) PNG, exact dimensions
2. **Generate bitmap data**:
   - Python script to convert PNG → hex array
   - Example: 150×114 needs 19 bytes/row (150 ÷ 8 rounded up)
3. **Generate with converter**:
```bash
python3 png-to-bitmap.py dolphin.png Dolphins > sprites.js
```

The converter properly handles semi-transparent pixels:
- Alpha blending with white background (50% alpha → 50% gray)
- Threshold at brightness 128 (< 128 → black, >= 128 → white)
- No dithering (preserves clean edges)

4. **Use in sprites.js**:
```javascript
var Dolphins = (function() {
    var sprite = {
        w: 150,
        h: 114,
        d: [
            0xff, 0xff, ..., // row 0 (19 bytes)
            0xff, 0xff, ..., // row 1 (19 bytes)
            // ... 114 rows total (6516 hex values)
        ]
    };
    return { sprite: sprite };
})();
```

### Drawing Sprites
```javascript
var spriteX = Math.floor((256 - Dolphins.sprite.w) / 2);  // center
var spriteY = 0;  // top of screen
canvas.drawSprite(Dolphins.sprite, spriteX, spriteY, '#000');
```

### 6-bit Grayscale Sprite System

For images with semi-transparent pixels, use **6-bit grayscale** (64 gray levels):

**Converter:** `png-to-bitmap.py`
```bash
python3 png-to-bitmap.py image.png VariableName > sprites.js
```

**How it works:**
1. Blend RGBA pixels with white background (semi-transparent → gray)
2. Map brightness (0-255) to 6-bit value (0-63)
3. Pack 4 pixels → 3 bytes
4. Render with variable opacity: `opacity = (63 - grayValue) / 63`

**Result:** 64 gray levels, semi-transparent pixels become visible gray tones

**Sprite object:**
```javascript
var VariableName = (function() {
    var sprite = {
        w: 150, h: 114,
        bitsPerPixel: 6,
        grayscale: true,
        d: [0xff, 0x8a, 0x14, ...]  // Packed 6-bit data
    };
    return { sprite: sprite };
})();
```

**Rendering in canvas.js:** Uses `_drawGrayscaleSprite()` method with alpha blending

### Example: Dolphin Sprite
- **Size**: 150×114 pixels
- **Format**: 6-bit grayscale (64 levels)
- **Features**: Semi-transparent edges preserved as gray tones
- **Render**: Desktop scene, top center

---

## Animated Icons

Animated icons are **vertical sprite strips**: the same 6-bit grayscale
format as regular sprites, but with all frames stacked top-to-bottom in
one `d` array.

**File**: `js/animated_icons.js`

**Shape**:
```javascript
var AnimatedIcons = (function() {
    var settings_animated = {
        w: 14,                 // width of each frame
        h: 140,                // TOTAL strip height (frameH × frames)
        frames: 10,            // frame count
        bitsPerPixel: 6,
        grayscale: true,
        d: [ /* ... */ ]       // packed 6-bit data, rows top-to-bottom
    };
    return { settings_animated: settings_animated };
})();
```

**Byte layout note (important):** the grayscale renderer reads 3 bytes
per 4-pixel group, so a row consumes `ceil(w/4) * 3` bytes — **not**
`ceil(w*6/8)`. For `w=14` that's 12 bytes/row, not 11. `drawSpriteFrame`
uses the correct formula so `frameIndex` lands on the right offset.

### Playback

Scenes drive animation by computing a frame index from wall-clock time
and calling `canvas.drawSpriteFrame`:

```javascript
var FRAME_MS = 200;  // 5 fps
var frameIndex = Math.floor(Date.now() / FRAME_MS) % sprite.frames;
canvas.drawSpriteFrame(sprite, x, y, frameIndex, '#000');
```

### MenuLine integration

`MenuLine` supports an optional `iconAnimated` property. When the line's
state is `SELECTED` or `PRESSED` **and** `iconAnimated` is set, the
strip plays at 5 fps; frame index is `(floor(elapsed / 200ms) + 1) %
frames` so the first highlighted frame is frame 1 (user-facing "frame
2"), not the static fallback. When unselected, the line draws the
static `icon` if present, or falls back to **frame 0 of the strip** if
only `iconAnimated` was supplied.

```javascript
var line = new MenuLine({
    text: 'Settings',
    icon: Icons.system,                              // static fallback
    iconAnimated: AnimatedIcons.settings_animated    // plays on highlight
});
```

### Driving redraws

The main loop throttles renders (it only redraws on input or every
`IDLE_REDRAW_MS = 250 ms`). For smooth animation, scenes should tick
more frequently:

- `main.js` exposes `window.requestRender()` — call it to force a redraw
  on the next rAF tick.
- `MenuScene.enter()` starts a `setInterval(200 ms)` that calls
  `window.requestRender()`; `exit()` clears it.

Any new scene that hosts time-driven animation should follow the same
pattern (start an interval in `enter`, clear it in `exit`).

---

# UI System Documentation

Complete guide to the fake-flipctl UI system for building new screens and components.

## Canvas & Display Specifications

### Resolution & Rendering
- **Dimensions**: 256px × 144px (width × height)
- **Type**: Monochrome (black & white) with grayscale accents
- **Rendering**: HTML5 Canvas, pixel-perfect (no antialiasing)
- **Scaling**: All elements rendered with sharp, crisp edges

### Safe Margins & Layout Zones
```
0–14px:       Header area (text + 5px top padding)
15–19px:      Spacing/divider
20–127px:     Menu items area (max 5 items visible at 19px each)
128–144px:    Button bar (5 button positions)
```

### Coordinate System
- **Origin**: Top-left (0, 0)
- **Left/Right margins**: 8px from canvas edges
- **Centered content width**: 240px (canvas 256px - 16px margins)

## Typography System

### Primary Font: HaxrcorpFont16
- **Glyph size**: 5×7 pixels
- **Cell size**: 6×8 pixels (5px + 1px kerning)
- **Row frame**: 11 rows × 8 bits (bit7 = leftmost pixel)
- **Supported**: ASCII 32–126 (printable ASCII)
- **Color**: Any hex color (passed as parameter)
- **API**: `HaxrcorpFont16.draw(ctx, text, x, y, color)`
- **Metrics**: `HaxrcorpFont16.textWidth(text)` → pixels
- **Used by**: status bar, submenu titles, most scenes

### Menu Font (default): BusyFont9
- **Cap height**: 9px (capital R spans 9 rows)
- **Row frame**: 14 rows × 16 bits (MSB = leftmost pixel; 2 bytes per
  row to accommodate glyphs up to 16px wide)
- **Generated from**: `/Users/vladpetrenko/Downloads/busy-regular_9px.ttf`
  rasterised at `size=15` (the PIL size at which caps render 9px tall)
- **Source file**: `js/busy9.js`
- **Supported**: ASCII 32–126
- **API**: same surface as HaxrcorpFont16 — `BusyFont9.draw(ctx, text, x, y, color)` and `BusyFont9.textWidth(text)`
- **Used by**: `MenuLine` in the `DEFAULT` state (unselected rows)

### Menu Font (highlighted): Born2bSportyV2Medium
- **Row frame**: 18 rows × 16 bits (MSB = leftmost pixel)
- **Source file**: `js/born2bsportyv2.js` (TTF at `/Users/vladpetrenko/Downloads/Born2bSportyV2.ttf`)
- **Supported**: ASCII 32–126
- **API**: `Born2bSportyV2Medium.draw(ctx, text, x, y, color)` / `.textWidth(text)`
- **Used by**: `MenuLine` in `SELECTED` and `PRESSED` states — labels and
  status text both swap to this font so the whole row reads as a single
  unit while highlighted.

See [Font Creation (TTF → bitmap)](#font-creation-ttf--bitmap) for the
conversion pipeline.

### Font Creation (TTF → bitmap)

New fonts live under `js/` as hand-generated `.js` modules emitted by
`ttf-to-js.py` at the project root (sibling of `png-to-bitmap.py`). The converter:

1. Loads the TTF at a chosen rasterisation size (pick whatever size
   makes the target cap height right — for `busy-regular_9px.ttf`,
   `SIZE = 15` gives a 9px capital R).
2. For each ASCII codepoint 32–126: rasterises onto a wide `L`-mode
   canvas at `(1, TEXT_Y)`, thresholds at `>= 128`, crops the leftmost
   whitespace column, then packs the first `ROWS` rows × `COLS` columns
   into integers (MSB = leftmost pixel).
3. Writes a `<Name> = (function() { ... })()` IIFE with `draw` and
   `textWidth`, matching `haxrcorp16.js`.

Key knobs inside the converter:

| Knob | Purpose |
|------|---------|
| `SIZE` | PIL rasterisation size. Pick to control cap height. |
| `ROWS` | Fixed row count per glyph. Must cover ascenders + descenders. |
| `COLS` | Bit width per row (8 or 16). Use 16 if any glyph is wider than 8px. |
| `TEXT_Y` | Row at which to draw the text on the canvas. Choose so that cap tops land where you want them. |

Wiring a new font into a scene:

1. Add `<script src="js/<name>.js"></script>` to `index.html` after
   `haxrcorp16.js`.
2. Replace `HaxrcorpFont16.draw` / `HaxrcorpFont16.textWidth` calls in
   the target scene with the new font's symbol.
3. If the font uses a different `ROWS` count than the old one, update
   the scene's `FONT_H` constant so vertical centring accounts for the
   new frame height (e.g. `menu.js` uses `FONT_H = 14` for BusyFont9).

## Color Palette

| Purpose | Color | Usage |
|---------|-------|-------|
| Background | `#ffffff` | Main canvas fill |
| Text/Borders | `#000` | Primary text, frames, icons |
| Dividers | `#EDEDED` | Menu item separator lines |
| Unselected | `#EAEAEA` | Dim state, accents |
| Overlay | `rgba(255, 255, 255, 0.75)` | Modal dialogs, keyboards |
| Disabled | `#CCC` | Disabled text, buttons |

## Visual Design System

This section consolidates the visual conventions used across all components. Values below are authoritative — taken directly from the code.

### Design Tokens (constants from `js/ui.js` + `js/apps/menu.js` + `js/canvas.js`)

| Token | Value | Source | Meaning |
|-------|-------|--------|---------|
| `STATUS_BAR_H` | 13px | `ui.js` | Status bar height (black bg) |
| `STATUS_BAR_PAD_TOP` | 3px | `ui.js` | Top padding for every foreground element in the bar |
| `ITEM_H` (simple list) | 12px | `ui.js` | Plain menu row height |
| `MenuLine.H` | 20px | `MenuLine.js` | Fixed height of every `MenuLine` (14px icon + 3px top + 3px bottom padding) |
| `MenuLine` icon inset | 3px | `MenuLine.js` | Icon padding from the line's left/top/bottom (`ICON_PAD`) |
| `MenuLine` icon→text gap | 4px | `MenuLine.js` | Gap between icon and label (`TEXT_GAP`) |
| `MenuLine` cap-top offset | 5px | `MenuLine.js` | Y of the first pixel of capitals inside the line (achieved via `TEXT_DRAW_Y = 2`) |
| `MenuLine` status right pad | 3px | `MenuLine.js` | Right padding for status text (`STATUS_PAD_R`) |
| `PAD_LEFT` | 4px | `ui.js` | Status bar + simple list text left padding |
| `SCROLLBAR_W` | 3px | `ui.js` | Scrollbar track width (dotted 1px line + 3px thumb centred on it) |
| `BTN_H` (bottom bar) | 14px | `canvas.js` | Height of LeftButton/MiddleButton/RightButton |
| `BTN_W` (bottom bar) | 48px | `menu.js` | Width of a single button slot (5 × 48 + 4 × 2 = 256) |
| `BTN_R` (bottom bar) | 4px | `canvas.js` | Top-corner radius on bottom-bar buttons |
| `POPUP_ITEM_H` | 13px | `ui.js` | Height of a row inside PopupMenuLeft |
| `POPUP_PAD` | 3px | `ui.js` | Inner padding of PopupMenuLeft |
| Keyboard `BTN_W` × `BTN_H` | 15 × 16px | `ui.js` | Virtual keyboard key cell |
| Keyboard container | 250 × 77px | `ui.js` | Overall keyboard box |

### Corner Radius Conventions

Only two radius values are used system-wide. `drawRoundRect` / `drawRoundFrame` support `r = 2` and `r = 3` only — anything else renders as a plain rectangle.

| Radius | Where it's used |
|--------|-----------------|
| **2px** | PopupMenuLeft item selection; legacy MenuItem selected/pressed |
| **3px** | MenuSelectorFrame (default `cornerRadius`) — used by the main menu selector |
| **3px** | Dialog boxes (DeleteConfirmDialog body) |
| **4px** | MessageBox corners (manual pixel routine), bottom-bar button top corners, keyboard container (`drawRoundRect(..., 4, bg)`) |
| *none (1px frame)* | `drawFrame` for InputField, TestScreen borders |

### Component State Styling

All interactive components expose four possible states: `default`, `selected`, `pressed`, `disabled`. Not every component uses all four.

**MenuLine** (`js/component-library/MenuLine.js`, owning scene paints the selector):

| State | Line-level visual | Selector frame (painted by scene) | Font |
|-------|-------------------|-----------------------------------|------|
| `default` | No frame. Icon + text in `#000`. | — | `BusyFont9` |
| `selected` | Icon + text still `#000`. Animated strip plays if `iconAnimated` is set. | `MenuSelectorFrame` outline (`showStroke: true`, `showFill: false`) around the line. | `Born2bSportyV2Medium` |
| `pressed` | Icon + text flip to `#fff`. Animation keeps advancing (clock preserved across `SELECTED ↔ PRESSED`). | Same `MenuSelectorFrame` instance but with `showFill: true`, `fillColor: '#000'` — drawn *behind* the line content, then the line is redrawn on top so the white content reads over the black fill. | `Born2bSportyV2Medium` |
| `disabled` | Not implemented. |

**Bottom-bar buttons** (`drawMiddleButton` / `drawLeftButton` / `drawRightButton`):

| State | Background | Foreground (text) | Border |
|-------|------------|-------------------|--------|
| `default` | `#ffffff` | `#000` | 1px `#000`, top corners rounded at r=4 (middle: both; left: top-right only; right: top-left only — outer edges run flush to the screen) |
| `pressed` | `#000` | `#fff` | Same border pattern |
| `disabled` | `#CCC` | `#999` | Same border pattern |

**PopupMenuLeft items** (`js/ui.js`):

| State | Visual |
|-------|--------|
| unselected | No highlight, text in `#000` |
| selected | `drawRoundFrame(..., 2, '#000')` — 1px outline |
| pressed | `drawRoundRect(..., 2, '#000')` — filled black, text in `#fff` (selection frame suppressed while pressed) |

**Rule of thumb for state styling** — the pattern is consistent across components:
- **Selection** = outline only (`drawRoundFrame`)
- **Press** = filled black + inverted text/icon (`drawRoundRect` + `#fff` foreground)
- **Disabled** = `#CCC` background, `#999` text

### Icon Sizing Conventions

| Size | Format | Used for |
|------|--------|----------|
| 14×14 | 6-bit grayscale | Menu icons (network, system, testing, router) — inset 3px from the MenuLine's left/top/bottom (line is 20px tall) |
| 16×9 | 6-bit grayscale | Status bar battery (`StatusBarBattery.sprite`) |
| 7×7 | 6-bit grayscale | Wifi icon variants (`wifi_0` … `wifi_100`) — fits in the 11px status bar |
| 5×7 | drawn primitives | Plug icon — hand-drawn via `drawRect` calls |
| 150×114 | 6-bit grayscale | Dolphin (full desktop splash) |

### Layout Zones (256×144 canvas)

```
y:   0 ─── 11     Status bar (white bg, battery right, signal/tech/wifi left, time center)
y:  11 ─── 13     2px divider gap
y:  13 ── 130     Content area (menu list, scene body)
                  ├─ Menu list: items at y = 13 + i * 19 (max 5-6 visible)
                  └─ Scrollbar: x = 253, w = 3, visible when items > viewport
y: 130 ── 144     Bottom button bar (BTN_H = 14, 5 × 48px slots + 4 × 2px gaps)
```

Horizontal margins: **8px** on left/right for centered content (giving 240px usable width — same as `ITEM_W`).

### Press-feedback Timing (see also Button Press/Release Cycle)

| Context | Duration | Rationale |
|---------|----------|-----------|
| Bottom-bar button | **30ms** | Next scene usually replaces the view; keep it snappy |
| PopupMenuLeft item | **150ms** | User is committing to a choice — flash must be visible |
| Keyboard key | **150ms** | Same reason: confirm the character was captured |

### Invariants

- Everything renders on pixel boundaries — no antialiasing, no fractional coordinates.
- Black-on-white is the default; inversion (white-on-black) only for pressed/confirmed state.
- Dividers are never black — they're always `#EDEDED` so they sit quietly behind content.
- Selection never fills — always an outline. Filling is reserved for commit/press.
- Any rounded shape uses `r ∈ {2, 3, 4}` — no arbitrary radii.

## Canvas Drawing Primitives

### Basic Methods
```javascript
canvas.clear(color)                              // Fill entire canvas
canvas.drawRect(x, y, w, h, color)              // Filled rectangle
canvas.drawFrame(x, y, w, h, color)             // Rectangle outline (1px)
canvas.drawRoundRect(x, y, w, h, radius, color) // Rounded filled rect
canvas.drawRoundFrame(x, y, w, h, radius, color)// Rounded outline
canvas.drawHLine(x, y, length, color)           // Horizontal line
canvas.drawVLine(x, y, length, color)           // Vertical line
canvas.drawIcon(iconData, x, y, color)          // 14×14 bitmap icon
canvas.drawCursor(x, y, w, h, color)            // Text cursor indicator

// Sprite variants
canvas.drawSprite(sprite, x, y, color)                    // Full sprite (binary or 6-bit grayscale, alpha-blended)
canvas.drawSpriteFrame(sprite, x, y, frameIndex, color)   // One frame of a vertical strip (sprite has `frames` count)
canvas.drawSpriteLiteral(sprite, x, y)                    // Three-tone overlay: paint each pixel at its own grayscale value; gray=63 = transparent sentinel

// Text is rendered via font object, NOT canvas directly
HaxrcorpFont16.draw(canvas.ctx, text, x, y, color)
BusyFont9.draw(canvas.ctx, text, x, y, color)
```

**When to use each sprite method:**
- `drawSprite` — standard foreground-on-background rendering. Uses
  `opacity = (63 - grayValue) / 63`, so dark source pixels become
  opaque in the chosen `color`. Good for single-tone icons that should
  adopt the scene's ink colour.
- `drawSpriteFrame` — same rendering as `drawSprite`, but crops to one
  frame of a vertically-stacked strip (see [Animated Icons](#animated-icons)).
- `drawSpriteLiteral` — preserves the original pixel values. Dark
  stays dark, light stays light, `gray=63` skips the pixel entirely so
  whatever was drawn underneath shows through. Use for multi-tone
  overlays (e.g. the charging bolt that must sit on top of another
  sprite without taking on the scene's foreground colour).

### Common Patterns
```javascript
// Centered text
var textWidth = HaxrcorpFont16.textWidth('Title');
var x = Math.floor((256 - textWidth) / 2);
HaxrcorpFont16.draw(canvas.ctx, 'Title', x, 10, '#000');

// Right-aligned text (within 240px content)
var x = 8 + 240 - HaxrcorpFont16.textWidth(text) - 6;
HaxrcorpFont16.draw(canvas.ctx, text, x, y, '#000');

// Bordered box with content
canvas.drawFrame(x, y, w, h, '#000');
HaxrcorpFont16.draw(canvas.ctx, label, x + 5, y + 5, '#000');
```

## Architecture & Scene System

### One-Way Data Flow
```
Input (keyboard)
    ↓
scene.handleInput(action)  ← Process & update state
    ↓
state changes trigger next frame
    ↓
scene.render(canvas)       ← Read state, draw UI
    ↓
Canvas display updated
```

### Scene Interface
Every scene must implement:
```javascript
function MyScene() {
    this.items = [];           // State
    this.selectedIndex = 0;
    this.popup = null;
}

MyScene.prototype.enter = function() {
    // Called when scene becomes active
};

MyScene.prototype.exit = function() {
    // Called when scene is popped
};

MyScene.prototype.handleInput = function(action) {
    // Handle input: 'up', 'down', 'ok', 'back', 'esc', 'run'
    // Return 'pop' to go back to previous scene
    if (action === 'back') return 'pop';
};

MyScene.prototype.render = function(canvas) {
    // Draw all UI for this screen
    // Called every frame (60 FPS target)
};
```

### Input Priority (Highest to Lowest)
1. **Keyboard** (text input active) → captures all input
2. **Dialog** (confirmation dialog) → handles up/down/ok/back
3. **Popup** (action menu) → handles navigation + selection
4. **Scene** (normal mode) → handles menu navigation + scene actions

### Input Actions
```javascript
'up'    // Navigate up, previous item
'down'  // Navigate down, next item
'left'  // Navigate left, previous option
'right' // Navigate right, next option
'ok'    // Confirm, select item, press character
'back'  // Delete character, undo, go back
'esc'   // Cancel, force close
'run'   // Execute primary action, submit
```

### Button Management Pattern
```javascript
// Buttons mapped to actions via KEY_MAP
if (btn && btn.action) {
    btn.press();  // Visual feedback
    setTimeout(function() {
        btn.release();
        if (btn.onPress) btn.onPress();
    }, 30);  // 30ms — see Press-feedback timing section
}
```

## Component System

### Component Base Pattern
All UI components follow state-based rendering:

```javascript
function MyComponent(options) {
    this.x = options.x;
    this.y = options.y;
    this.w = options.width;
    this.h = options.height;
    this.state = 'default';  // default, selected, pressed, disabled
}

MyComponent.prototype.render = function(canvas) {
    if (this.state === 'pressed') {
        canvas.drawRect(this.x, this.y, this.w, this.h, '#000');
    } else {
        canvas.drawFrame(this.x, this.y, this.w, this.h, '#000');
    }
};

MyComponent.prototype.press = function() {
    if (this.state !== 'disabled') this.state = 'pressed';
};

MyComponent.prototype.release = function() {
    if (this.state !== 'disabled') this.state = 'default';
};
```

### Built-in Components

#### MenuLine
Shared single-row menu component in [`js/component-library/MenuLine.js`](js/component-library/MenuLine.js). Replaces the old per-scene `MenuItem` class. Designed to be reused by the main menu today and submenus/other lists in the future.

- **Properties** (constructor options): `text`, `width` (default 224), `icon` (optional static), `iconAnimated` (optional vertical strip), `status` (optional right-aligned label / `< ON >` / `< OFF >`)
- **Dimensions**: `width × 20px` (`MenuLine.H = 20` — 14px icon + 3px top + 3px bottom padding)
- **Internal layout** (relative to the line's top-left):
  - Icon at `(3, 3)` with 3px L/T/B padding (icon expected 14×14)
  - Text 4px right of the icon; text draw `y = 2` so the capital-letter top lands at line `y = 5`
  - Status text right-aligned at `x + w - 3`
- **States**: `MenuLine.STATE_DEFAULT` / `STATE_SELECTED` / `STATE_PRESSED`
- **Font swap**: `BusyFont9` in `DEFAULT`, **`Born2bSportyV2Medium`** in `SELECTED` and `PRESSED`.
- **Icon mode** (three-tier):
  1. `SELECTED` or `PRESSED` **and** `iconAnimated` set → the strip plays at `FRAME_MS = 200ms` (5 fps). Frame index is `(floor(elapsed / FRAME_MS) + 1) % frames` so the first visible frame after highlight is frame 1 (user-facing "frame 2"), not the static fallback.
  2. `this.icon` present → standard sprite / icon.
  3. Only `iconAnimated` present → frame 0 of the strip is drawn as the static fallback for unselected lines (so you don't need a separate static asset).
- **`_selectedAt` timestamp**: stamped on the first render where the line is in an "active" state (SELECTED or PRESSED), cleared on transition to DEFAULT. Kept across the `SELECTED ↔ PRESSED` transition so the press flash picks up the animation at its current frame instead of rewinding.
- **The SELECTED/PRESSED frame is NOT painted by MenuLine.** The owning scene renders a `MenuSelectorFrame` around the selected line — this decouples the selector's geometry (e.g. `232×22` at `x=10` in the main menu) from the line's content area (`224×20` at `x=16`). `PRESSED` only inverts the line's own text/icon colours to white so they read over the black fill the scene paints behind them.
- **Render**: `menuLine.render(canvas, x, y)`

### Main Menu scene

Implemented in `js/apps/menu.js` as `MenuScene`. Sets the reference
layout that `MenuLine` + `MenuSelectorFrame` are designed around.

**Container** (top-left anchor):
- `CONTAINER_X = 16`, `CONTAINER_Y = 24` (below the 13px status bar with
  11px of breathing room — the breadcrumb bar was removed, this gap is
  intentional)
- `CONTAINER_W = 224` (`256 − 16 − 16`)
- No background fill of its own; the canvas clear is `#fff`

**Items**: `MenuLine` instances stacked flush inside the container with
a 1px gray (`#CCCCCC`) horizontal divider between each adjacent pair.
No divider above the first visible line, none below the last. Dividers
always sit **beneath** the selector frame.

**Current item list** (in order):
`Network, Files, Apps, Testing, Settings, Router` — this is treated as
the maximum list size; the spec is "6 items, scroll to reveal any
beyond the viewport."

**Selector frame** — one `MenuSelectorFrame` reused across frames:
| Knob | Value | Meaning |
|------|-------|---------|
| `SELECTOR_X` | 10 | Absolute X; overshoots the container's 16px left pad by 6px |
| `SELECTOR_W` | 232 | Extends 2px past the container's right edge |
| `SELECTOR_H` | 22 | 2px taller than the 20px line |
| `SELECTOR_Y_OFFSET` | `-1` | Vertical inset so the 22px frame sits centred over the 20px line |
| `showStroke` | `true` | Always on |
| `showFill` | toggled per-frame | `true` during `PRESSED` (filled black), `false` otherwise |

**Viewport + scroll**:
- `VISIBLE_COUNT = 5` lines
- `VIEWPORT_H = 104` (5 × 20 + 4 dividers)
- Viewport starts at `CONTAINER_Y`; items outside it are skipped during
  render.
- Navigation wraps — `down` past the last item jumps to the first and
  `up` past the first jumps to the last (`_ensureVisible()` then
  adjusts `scrollOffset` so the new selection lands on screen).

**Scrollbar** (uses the shared `UI.Scrollbar`):
| Knob | Value |
|------|-------|
| `SCROLLBAR_X` | 253 (3px-wide thumb centred → cols 252..254) |
| `SCROLLBAR_Y` | 15 (2px below the 13px status bar) |
| `SCROLLBAR_H` | 127 (reaches to `y = 141` — 2px above the canvas bottom) |
| `SCROLLBAR_THUMB_PAD` | 1 — ensures the thumb stays ≥3px from both the status bar and the canvas bottom |

**Press flash** — `ok` / `run` feedback:
1. On keypress: selected line's state flips to `PRESSED`; a redraw is
   requested immediately.
2. `render` paints the selector frame filled black behind the line,
   then redraws the (now inverted) line on top so its `#fff` content
   sits over the black fill.
3. `setTimeout(30 ms)` flips the state back to `SELECTED` and calls
   the submenu factory. If the factory returns a scene it's pushed;
   returning `null` is a no-op (used today for `Files`, `Apps`,
   `Router` — empty stubs).

**Animation tick**: `enter()` starts a `setInterval(200 ms)` that calls
`window.requestRender()`; `exit()` clears it. See
[Animated Icons → Driving redraws](#driving-redraws).

#### Buttons: LeftButton, MiddleButton, RightButton
- **Width**: 48px each, 2px gap between (5 × 48 + 4 × 2 = 256px exact)
- **Height**: **14px** (`BTN_H` in `canvas.js`) — sits flush at the bottom of the 144px canvas (`y = 130`)
- **Top-corner radius**: 4px
  - `MiddleButton` — both top corners rounded
  - `LeftButton` — only top-right corner (flush to screen left edge)
  - `RightButton` — only top-left corner (flush to screen right edge)
- **States & colors** (see [Component State Styling](#component-state-styling) for the full table):
  - `default` — bg `#ffffff`, text `#000`, 1px `#000` border
  - `pressed` — bg `#000`, text `#fff`, same border
  - `disabled` — bg `#CCC`, text `#999`, same border
- **Properties**: `text`, `action` (`'ok'`, `'run'`, `'esc'`, etc.), `onPress` callback
- **Render**: `btn.render(canvas)`

#### Scrollbar
- **When visible**: `totalItems > visibleItems`
- **Components**: dotted track line (full `(y, height)` range) + solid 3px-wide thumb
- **Calculation**: `thumbHeight = max(5, round(thumbRange * visibleItems / totalItems))`; `thumbY = y + thumbPad + round((thumbRange - thumbHeight) * scrollRatio)` where `thumbRange = height - 2 * thumbPad`
- **Position**: x ≈ 251–253, leaving 1px clearance from right edge
- **Render**: `scrollbar.render(canvas, x, y, height, thumbPad = 0)` — the optional `thumbPad` inset keeps the thumb `thumbPad` pixels away from each end of the dotted line (useful when the track sits near the status bar or canvas edge). The dotted line itself always fills the full range.

#### PopupMenu
- **Items**: List of action strings ('Delete', 'Rename', 'Clone', etc.)
- **Navigation**: Up/down arrows, ok to select, esc to close
- **Overlay**: Semi-transparent white (75% opacity)
- **Render**: `popup.render(canvas)` + overlay in scene

#### DeleteConfirmDialog (Generic Confirmation)
- **Properties**: Item name, action type ('Delete' or 'Reset to default')
- **Buttons**: Cancel / Confirm with toggle (left/right arrows)
- **Render**: `dialog.render(canvas)` + overlay in scene
- **Callbacks**: `onConfirm()`, `onCancel()`

#### Virtual Keyboard
- **Layout**: QWERTY 3-row layout with special characters
- **Navigation**: Arrow keys within grid, ok to select character
- **Input**: Text accumulates in `inputText`, backspace via `\b` character
- **Render**: `keyboard.render(canvas)` + overlay in scene

#### TextInputBox & InputField
- **TextInputBox**: Header showing action ("Edit item name", "Rename item")
- **InputField**: Bordered box for text input with optional error message
- **Features**: Blinking cursor, real-time validation, error display

#### MessageBox
Dialog box component with rounded corners, dynamic sizing, and fixed tail indicator.

**Features:**
- Dynamic width/height based on text content (max 25 characters per line)
- Rounded corners (4px radius) with pixel-perfect rendering
- Fixed tail indicator on left side (completely independent of frame position)
- Text wrapping and newline support (`\n` for explicit line breaks)
- Screen boundary clamping (no overflow)

**Constructor:**
```javascript
var messageBox = new MessageBox({
    text: "Your message here\nWith multiple lines",
    tailX: 113,        // Horizontal position of tail (left edge)
    tailY: 82,         // Vertical position of tail
    bottomY: 86        // Fixed bottom edge position (frame aligns to this)
});
```

**Properties:**
- `padding`: 6px (internal spacing)
- `radius`: 4px (corner radius)
- `maxLineLength`: 25 characters per line
- `textRightPadding`: 12px from right edge of screen

**Methods:**
- `render(canvas)` — Draw the component
- `setText(newText)` — Update text content and recalculate layout
- `setTailPosition(x, y)` — Move tail independently

**Rendering Details:**
- **White background** with black 1px border
- **Tail indicator** (fixed position, independent of frame):
  - Black horizontal strip (10px wide, 1px high)
  - Black staircase pattern (8×8) ascending left to right above the strip
  - White vertical line (1px wide, 8px high) covering the border junction
- **Text rendering** uses HaxrcorpFont16 with automatic word wrapping

**Key Behavior:**
- Frame attaches to tail (positioned at `tailX + tailStripWidth`)
- Frame width/height adjust based on text content
- Frame position clamps to screen boundaries (6px padding from right edge)
- Tail remains completely fixed at specified position regardless of frame size
- Text max width is 25 characters; longer lines wrap to next line

**Example Usage:**
```javascript
// In DesktopScene constructor:
this.messageBox = new MessageBox({
    text: "Hello, I'm totally Fake",
    tailX: 113,
    tailY: 82,
    bottomY: 86
});

// In render method:
this.messageBox.render(canvas);

// Update text dynamically:
this.messageBox.setText("New message here");
```

#### ResponsiveFrame
Configurable rectangular frame — fill, optional 1px stroke, per-corner rounded corners, 3×3 anchor. Used as a building block for menus, cards, and selection highlights.

**File:** `js/component-library/ResponsiveFrame.js`
**Sandbox:** registered — full live-tweakable controls.

**Features:**
- Fill color (any CSS color)
- Optional 1px stroke, independent color, toggleable
- Per-corner rounded corners, radius 0/3/4 px, each of the four corners can be enabled or disabled individually
- Anchor: `anchorH` (`left`/`center`/`right`) × `anchorV` (`top`/`center`/`bottom`) — `(x, y)` represents the chosen anchor point on the frame, not a fixed top-left

**Constructor:**
```js
var frame = new ResponsiveFrame({
    x: 6, y: 6,
    width: 244, height: 22,
    fillColor:   '#ffffff',
    strokeColor: '#000000',
    showStroke:  true,
    cornerRadius: 3,
    corners: { tl: true, tr: true, bl: true, br: true },
    anchorH: 'left',
    anchorV: 'top'
});
```

Any omitted option falls back to the constructor default.

**Methods:**
- `render(canvas)` — draw the frame
- `setPosition(x, y)`, `setSize(w, h)`
- `setFillColor(c)`, `setStrokeColor(c)`, `setShowStroke(bool)`
- `setCornerRadius(r)`, `setCorner(which, enabled)` — `which` is `'tl' | 'tr' | 'bl' | 'br'`
- `setAnchor(h, v)` — pass a falsy value to keep a dimension unchanged

**Rendering approach (important):**
Paints **only the body pixels** of the rounded rectangle, row by row, using per-corner insets. Cut-corner pixels are never touched, so whatever was already on the canvas at those positions shows through naturally. This works in every context — transparent sandbox canvas, white desktop, or any mixed content underneath — without the component needing to know what's behind it.

**Stroke:**
- Straight top/bottom/left/right edges are painted between the rounded corner regions.
- Each enabled rounded corner gets a 1-pixel diagonal border (at `dx + dy == r - 1`, mirrored per orientation).
- Disabled corners get a square stroke corner via the adjacent straight edges meeting at the full rect corner.
- `showStroke: false` skips all stroke drawing.

#### MenuSelectorFrame
Selection frame for menu rows. Descendant of `ResponsiveFrame` with the same API (`x`, `y`, `width`, `height`, `anchorH`/`anchorV`, `showStroke`, `showFill`, `strokeColor`, `fillColor`, `cornerRadius`, `corners`), plus selector-specific embellishments.

**File:** `js/component-library/MenuSelectorFrame.js`
**Sandbox:** registered.

**Selector-specific flourishes (always painted, on top of the stroke):**
- **Bottom-right shadow pair** — a 1px horizontal segment at `y + h` and a 1px vertical segment at `x + w`, both using `strokeColor`. Each is `w - 2*r + 1` / `h - 2*r + 1` long so it meets the BR corner stair.
- **Two corner pixels at the bottom-right** — painted in the rounded-corner cut region at `(x + w − 2, y + h − 1)` and `(x + w − 1, y + h − 2)`. They thicken the BR corner visually and connect the shadow to the frame.
- Defaults: `cornerRadius = 3`, `showStroke = true`, `showFill = false` (transparent interior — the owning scene sets `showFill=true` only for the press-flash path).

**Main menu integration:** see [Main Menu scene](#main-menu-scene) for the specific geometry (`232×22` at `x=10`, `SELECTOR_Y_OFFSET = -1`) and the `showFill` toggle during the 30 ms press flash.

### Component Composition Pattern
```javascript
function MenuScene() {
    // Core components
    this.items = [...];                          // Array of MenuLine
    this.scrollbar = null;                       // Optional scrollbar
    this.buttons = {
        edit: new MiddleButton(...),
        cancel: new LeftButton(...),
        run: new RightButton(...)
    };

    // Modal components (mutually exclusive)
    this.popup = null;          // Action menu
    this.deleteConfirmDialog = null;
    this.keyboard = null;       // Text input
}

MyScene.prototype.render = function(canvas) {
    // 1. Render background/header
    canvas.clear('#ffffff');
    HaxrcorpFont16.draw(canvas.ctx, 'Menu Items', centerX, 5, '#000');

    // 2. Render main content (menu items)
    for (var i = 0; i < visibleItems; i++) {
        this.items[i + viewportStart].render(canvas, itemX, itemY);
    }

    // 3. Render optional scrollbar
    if (this.scrollbar && this.scrollbar.shouldShow()) {
        this.scrollbar.render(canvas, scrollbarX, startY, height);
    }

    // 4. Render modal components (overlay first, then component)
    if (this.popup) {
        canvas.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        canvas.ctx.fillRect(0, 0, 256, 144);
        this.popup.render(canvas);
    }

    if (this.keyboard) {
        canvas.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        canvas.ctx.fillRect(0, 0, 256, 144);
        this.keyboard.render(canvas);
    }

    // 5. Render buttons
    Object.values(this.buttons).forEach(function(btn) {
        btn.render(canvas);
    });
};
```

## Common Patterns & Solutions

### Viewport & Scrolling
```javascript
// Ensure selected item stays visible
var itemHeight = 19;
var visibleItems = Math.floor(107 / itemHeight);  // 5 max

if (this.selectedIndex < this.viewportStart) {
    this.viewportStart = this.selectedIndex;
} else if (this.selectedIndex >= this.viewportStart + visibleItems) {
    this.viewportStart = this.selectedIndex - visibleItems + 1;
}

// Bounds check
this.viewportStart = Math.max(0, this.viewportStart);
var maxViewport = Math.max(0, totalItems - visibleItems);
this.viewportStart = Math.min(this.viewportStart, maxViewport);
```

### Input Validation During Typing
```javascript
onKeyChar: function(char) {
    if (char === '\b') {
        this.inputText = this.inputText.slice(0, -1);
    } else {
        this.inputText += char;
    }

    // Real-time validation
    this._checkNameDuplicate();
    this._updateSaveButtonState();
};

_checkNameDuplicate: function() {
    this._inputError = '';
    for (var i = 0; i < this.items.length; i++) {
        if (this.items[i] !== this._renamingItem && 
            this.items[i].text === this.inputText) {
            this._inputError = 'Name already exists';
            this._saveBtn.disabled = true;
            return;
        }
    }
    this._saveBtn.disabled = false;
};
```

### Clone Naming Strategy
1. **First clone**: Add date suffix ("Router Jun 9")
2. **Repeated clone with same date**: Switch to [N] numbering ("Router Jun 9 [2]")
3. **Keep incrementing**: Auto-increment [N] when date exists
4. **Prevent conflicts**: Check all existing names before confirming

### Modal Overlay Rendering
```javascript
// Scene handles modal visibility
if (this.keyboard || this.popup || this.dialog) {
    // Draw semi-transparent overlay
    canvas.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    canvas.ctx.fillRect(0, 0, canvas.w, canvas.h);

    // Draw modal component on top
    if (this.keyboard) this.keyboard.render(canvas);
    if (this.popup) this.popup.render(canvas);
    if (this.dialog) this.dialog.render(canvas);

    // Render limited buttons (only applicable to current modal)
    this._closeBtn.render(canvas);
    this._saveBtn.render(canvas);
    return;  // Don't render background content
}
```

## Design Principles

1. **Simplicity**: Monochrome enforces minimal design; focus on clear hierarchy
2. **Efficiency**: Pixel-perfect rendering, no gradients/shadows, optimal canvas updates
3. **Consistency**: Same font, colors, spacing across all components
4. **Accessibility**: High contrast (black on white), consistent input patterns
5. **Responsiveness**: Viewport adjusts for long lists, buttons disable on validation error

## Creating New Scenes

### Step 1: Define Structure
```javascript
function MyScene() {
    // State
    this.items = [...];
    this.selectedIndex = 0;
    // UI components
    this.popup = null;
    this.keyboard = null;
    // Buttons
    this.editBtn = new MiddleButton(...);
}
```

### Step 2: Implement Core Methods
```javascript
MyScene.prototype.enter = function() { /* init */ };
MyScene.prototype.exit = function() { /* cleanup */ };

MyScene.prototype.handleInput = function(action) {
    if (this.keyboard) {
        // Handle keyboard input
    } else if (action === 'up') {
        // Handle navigation
        this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
    } else if (action === 'back') {
        return 'pop';  // Go back
    }
};

MyScene.prototype.render = function(canvas) {
    canvas.clear('#ffffff');
    // Draw UI based on state
    for (var i = 0; i < this.items.length; i++) {
        this.items[i].render(canvas, x, y);
    }
    // Render buttons, popups, etc.
};
```

### Step 3: Register in main.js
```javascript
// Add to initial scene stack
var menuScene = new MenuScene();
SceneManager.push(menuScene);
```

## Best Practices

✅ **DO**: Keep components pure (render depends only on state)
✅ **DO**: Calculate positions dynamically (don't hardcode)
✅ **DO**: Use modulo for circular navigation
✅ **DO**: Validate state before rendering
✅ **DO**: Handle input priority (keyboard → dialog → popup → scene)

❌ **DON'T**: Modify state during render()
❌ **DON'T**: Create new objects every frame
❌ **DON'T**: Hardcode colors and sizes
❌ **DON'T**: Use timers directly in components
❌ **DON'T**: Block render loop for long operations

## Performance Target

- **Frame rate**: 60 FPS (16.7ms per frame)
- **Render budget**: Complete within frame time
- **Input latency**: Respond within 1 frame (~16ms)

Profile with: `performance.now()` before/after `scene.render(canvas)`

---

# Icon System (6-bit Grayscale)

## Overview

The icon system uses **6-bit grayscale format** (64 gray levels) to preserve smooth anti-aliased edges from PNG source files. This is identical to the sprite system used for large assets like the Dolphins.

**Key Features**:
- 6 bits per pixel = 64 gray levels (0=white, 63=black)
- 4 pixels packed into 3 bytes (24 bits total)
- Smooth transparency and semi-transparent anti-aliased edges
- Perfect for small UI icons (14×14, 16×16, etc.)

## Why 6-bit Grayscale?

PNG icons are typically designed with anti-aliasing for smooth appearance:
- Edges have semi-transparent pixels (alpha 50-200) 
- Creates smooth transitions instead of hard edges
- Simple binary (black/white) conversion **loses** these edges

**Solution**: 6-bit grayscale preserves the full range:
- Semi-transparent pixels → gray values → smooth edges ✨
- Multiple opacity levels rendered with `globalAlpha`
- Supports colors in pressed/highlighted states

## Icon Files

### Main Menu Icons

Located in: `/fake-flip-ctl/icons/main_menu/`

**PNG Source Files** (14×14 pixels):
- `14_px_network.png` — Network/connectivity symbol (antenna/wifi)
- `14_px_system.png` — System/settings icon (gear-like)
- `14_px_testing.png` — Testing/tools icon (wrench-like)

All PNG files:
- RGBA color mode with transparent background
- Anti-aliased edges (semi-transparent pixels)
- Black foreground color

### JavaScript Icon Definitions

Located in: `js/icons.js` 

**Format**:
```javascript
var network = {
    w: 14,
    h: 14,
    bitsPerPixel: 6,        // ← 6 bits per pixel
    grayscale: true,        // ← Grayscale mode
    d: [
        0xff, 0xff, 0xff, ...,  // Packed hex bytes
        0xf0  // row N
    ]
};
```

**Properties**:
- `w`, `h` — Icon dimensions in pixels
- `bitsPerPixel: 6` — 6-bit grayscale format
- `grayscale: true` — Enables grayscale rendering
- `d` — Data array of packed hex bytes

## Converting Icons

### Using the Grayscale Converter

Location: `/fake-flip-ctl/png-to-bitmap.py`

**Basic usage**:
```bash
cd /fake-flipctl/icons
python3 /path/to/png-to-bitmap.py image.png variable_name
```

**Example**:
```bash
python3 /flipperone-testing/fake-flipctl2/png-to-bitmap.py main_menu/14_px_network.png network_grayscale
```

**Output**:
```javascript
var network_grayscale = (function() {
    var sprite = {
        w: 14,
        h: 14,
        bitsPerPixel: 6,
        grayscale: true,
        d: [
            0xff, 0xff, ..., 0xf0
        ]
    };
    return { sprite: sprite };
})();
```

### Converter Algorithm

1. **Load PNG as RGBA** — Preserves alpha channel
2. **Blend with white background** — For each pixel: `color * alpha + white * (1 - alpha)`
3. **Convert to 6-bit** — Brightness (0-255) → 6-bit value (0-63): `brightness >> 2`
4. **Pack 4 pixels** — 4 × 6-bit values → 3 bytes

**Packing format**:
```
Byte 0: [pixel0: 6 bits][pixel1: 2 MSBs]
Byte 1: [pixel1: 4 LSBs][pixel2: 4 MSBs]
Byte 2: [pixel2: 2 LSBs][pixel3: 6 bits]
```

### Creating New Icons

**Step 1: Design the icon**
- Create 14×14 or 16×16 PNG
- Use RGBA with transparent background
- Apply anti-aliasing for smooth edges
- Use black (#000) for the icon shape

**Step 2: Convert**
```bash
python3 png-to-bitmap.py my_icon.png my_icon_name
```

**Step 3: Add to icons.js**
```javascript
var myIcon = {
    w: 14,
    h: 14,
    bitsPerPixel: 6,
    grayscale: true,
    d: [ ... ]  // From converter output
};

return {
    network: network,
    myIcon: myIcon,  // ← Add here
    // ...
};
```

**Step 4: Use in scenes**
```javascript
// Inside a MenuScene
this.items.push(new MenuLine({
    text: 'My Item',
    icon: Icons.myIcon
}));

// Or directly in custom rendering
canvas.drawSprite(Icons.myIcon, x, y, '#000');  // Black
canvas.drawSprite(Icons.myIcon, x, y, '#fff');  // White (for pressed state)
```

## Rendering Icons

### In Menu Lines

**File**: `js/component-library/MenuLine.js`

Icons are rendered at a fixed 3px inset from the line's top-left; the
line picks between static and animated sources based on state:

```javascript
MenuLine.prototype.render = function(canvas, x, y) {
    if (this.icon) {
        var iconX = x + 3;
        var iconY = y + 3;

        // Use drawSprite for grayscale, drawIcon for binary
        if (this.icon.grayscale) {
            canvas.drawSprite(this.icon, iconX, iconY, iconColor);
        } else {
            canvas.drawIcon(this.icon, iconX, iconY, iconColor);
        }
    }
};
```

**Icon positions in menu**:
- X offset: `6px` from left edge (PAD_X)
- Y offset: Vertically centered in menu item
- Size: 14×14 pixels
- Text starts at: `6 + 14 + 4 = 24px` from left

### In Custom Scenes

**Using icons directly**:

```javascript
// Black icon (default)
canvas.drawSprite(Icons.network, 10, 50, '#000');

// White icon (for pressed/highlighted states)
canvas.drawSprite(Icons.network, 10, 50, '#fff');

// Any hex color (though icons are optimized for black/white)
canvas.drawSprite(Icons.network, 10, 50, '#ccc');
```

### Canvas Drawing Implementation

**File**: `js/canvas.js`

**drawSprite method**:
```javascript
FlipCanvas.prototype.drawSprite = function(sprite, x, y, color) {
    if (!sprite || !sprite.d) return;
    
    if (sprite.grayscale && sprite.bitsPerPixel === 6) {
        this._drawGrayscaleSprite(sprite, x, y, color);
    } else {
        this._drawBinarySprite(sprite, x, y, color);
    }
};
```

**_drawGrayscaleSprite method** (simplified):
```javascript
FlipCanvas.prototype._drawGrayscaleSprite = function(sprite, x, y, color) {
    var ctx = this.ctx;
    color = color || '#000';
    
    // Unpack 6-bit values and draw with opacity
    for (var row = 0; row < sprite.h; row++) {
        for (var col = 0; col < sprite.w; col++) {
            var grayValue = ... // Extract 6-bit value
            var opacity = (63 - grayValue) / 63;  // 0=white, 1=black
            
            if (opacity > 0.01) {
                ctx.globalAlpha = opacity;
                ctx.fillStyle = color;
                ctx.fillRect(x + col, y + row, 1, 1);
            }
        }
    }
};
```

**Key behavior**:
- Grayscale value 0 = white (transparent) → opacity 0
- Grayscale value 63 = black (opaque) → opacity 1
- Colors are applied with proper alpha blending
- Works with any HTML color (#000, #fff, #f00, etc.)

## Examples

### Main Menu with Icons

The current main menu is built from `MenuLine` instances inside `MenuScene`
(`js/apps/menu.js`). See [Main Menu scene](#main-menu-scene) below for the
full layout contract; here's the construction pattern:

```javascript
var line = new MenuLine({
    text: 'Settings',
    width: 224,
    icon: Icons.system,                      // static icon (shown when unselected)
    iconAnimated: AnimatedIcons.settings_animated  // plays while SELECTED
});
```

If no static icon is supplied but `iconAnimated` is, the line falls back
to frame 0 of the strip as the static render — no separate static asset
needed (used today for `Files` and `Apps`).

### Dynamic Icon Color in Pressed State

`MenuLine` itself only inverts its content colours during `PRESSED` —
the filled black backdrop is painted by the owning scene via the
`MenuSelectorFrame` (see [Main Menu scene](#main-menu-scene)). The line
looks up which font to use for text and then switches `iconColor` /
`textColor` based on state:

```javascript
MenuLine.prototype.render = function(canvas, x, y) {
    var textColor = '#000';
    var iconColor = '#000';

    if (this.state === STATE_PRESSED) {
        textColor = '#fff';
        iconColor = '#fff';   // line draws icon/text in white over the
                              // black selector fill the scene painted
    }

    // Pick static vs animated; grayscale sprites alpha-blend the colour.
    if (this.icon && this.icon.grayscale) {
        canvas.drawSprite(this.icon, iconX, iconY, iconColor);
    }
};
```

## File Structure

```
fake-flipctl/
├── js/
│   ├── icons.js                    # Icon definitions (network, system, testing)
│   ├── canvas.js                   # drawSprite() & _drawGrayscaleSprite()
│   └── apps/
│       └── menu.js                 # Main menu scene — builds MenuLine rows, owns the MenuSelectorFrame + scroll state
├── icons/
│   ├── main_menu/
│   │   ├── 14_px_network.png      # PNG source
│   │   ├── 14_px_system.png       # PNG source
│   │   ├── 14_px_testing.png      # PNG source
│   │   └── [generated .js files]  # (Optional, for reference)
│   ├── png-to-bitmap.py            # Grayscale converter tool
│   └── README_CONVERTER.md         # Conversion guide
└── CLAUDE.md                        # This documentation
```

## Troubleshooting

### Icon looks blocky/pixelated
- Check that PNG source uses anti-aliasing
- Verify conversion used `png-to-bitmap.py` (grayscale)
- Try re-converting the PNG

### Icon doesn't show up
- Verify icon is added to `Icons` object in `icons.js`
- Check `bitsPerPixel: 6` and `grayscale: true` are set
- Ensure canvas method uses `drawSprite()` not `drawIcon()`

### Icon color not changing
- Verify scene code passes the correct color parameter
- Check that `fillStyle` is set before `fillRect()` in canvas
- Ensure opacity is not being globally overridden elsewhere

### Edges look jagged
- PNG source may need better anti-aliasing
- Try adjusting PNG export settings for smoother curves
- Consider larger icon size (16×16) for finer detail

## Performance Notes

- **6-bit grayscale**: Minimal performance overhead vs. binary
- **Rendering cost**: Same as sprites (per-pixel opacity blending)
- **Memory**: 14×14 icon ≈ 42 bytes (4 pixels per 3 bytes × 14 rows)
- **Recommendation**: Use for UI icons up to ~20×20 pixels

For larger assets (>32×32), consider dedicated sprite assets with better compression.

## References

- **Grayscale sprite example**: Dolphins (`js/sprites.js`) — 150×114 at 6-bit grayscale
- **Related components**: Canvas drawing primitives, [MenuLine](#menuline) rendering
- **Converter tools**: `png-to-bitmap.py` (grayscale), `png-to-bitmap-converter-v3.py` (binary, legacy)
