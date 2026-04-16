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
- **`/api/modem`** — aggregates `mmcli -m 0 -J`, `qmicli --nas-get-serving-system`, `--nas-get-cell-location-info`, `--nas-get-signal-strength` for RM530N-GL modem via `/dev/cdc-wdm0`; also reads sysfs byte counters on the modem net interface for live bandwidth
- **`/api/disk`** — reads `df` for `/dev/mmcblk0p2` usage (eMMC)
- **`/api/power`** — reads sysfs `/sys/class/power_supply/bq28z610-0` (voltage, current, capacity, charge, temp, time estimates)
- Systemd unit: `fake-flipctl-node-server.service`

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

Two copies of this project exist on the device:
- **`/flipperone-testing/fake-flipctl/`** — the live copy served by the Node.js server. Edit here during development.
- **`/home/user/f1/flipperone-testing/fake-flipctl/`** — mutagen-synced copy. Copy changes here when ready and commit only from this path.

Both directories have `.git`, but **commits must only be made in `/home/user/f1/flipperone-testing/fake-flipctl/`**.

### Edit & reload cycle

1. Edit files in `/flipperone-testing/fake-flipctl/`
2. Reload the UI: `sudo systemctl restart cog-seat1.service`
3. When ready, copy changes to `/home/user/f1/flipperone-testing/fake-flipctl/` and commit there

## File: test-screen.html

Test pattern page for verifying LCD display alignment — draws 1px border, diagonal cross, center crosshair, and corner coordinate labels at native 256x144.

## Project Structure

```
fake-flipctl/
├── server.js              # Node.js HTTP server + API endpoints
├── index.html             # Main app entry point
├── test-screen.html       # Display test pattern
├── css/style.css          # Layout, canvas scaling
├── js/
│   ├── main.js            # Bootstrap + render loop (requestAnimationFrame)
│   ├── canvas.js          # Drawing primitives (includes drawSprite for large bitmaps)
│   ├── font.js            # 5x7 bitmap font data
│   ├── input.js           # Keyboard handler
│   ├── scene.js           # Scene stack manager
│   ├── ui.js              # UI components (status bar with battery, menu, scrollbar)
│   ├── sprites.js         # Large sprite assets (dolphin, etc.)
│   └── apps/
│       ├── desktop.js     # Desktop startup scene with Menu button
│       ├── menu.js        # Main menu (3 categories: Network, Testing, System)
│       ├── submenu.js     # Generic submenu handler (Routing, Ethernet, Screen, Sound, etc.)
│       ├── modem5g.js     # 5G Modem info via /api/modem (polls every 500ms)
│       ├── diskspace.js   # Disk space via /api/disk
│       ├── power.js       # Battery info via /api/power (polls every 2s)
│       ├── screentest.js  # Display test pattern scene
│       ├── boot_menu_ui_demo.js # Complex UI demo with profiles, cloning, rename
│       └── [other scenes]
├── systemd/
│   ├── fake-flipctl-node-server.service   # Node.js HTTP server (port 8899)
│   ├── fake-flipctl-wayland-cage.service  # cage + cog kiosk on tty1
│   └── fake-flipctl.target                # Groups server + UI
└── assets/                # (reserved for future icons/sprites)
```

---

## Status Bar

### Layout
- **Height**: 11px
- **Background**: White (#fff)
- **Left**: 5G signal bars (2px padding) + technology label (1px gap)
- **Center**: Time and date (HH:MM MMM DD)
- **Right**: Battery percentage + battery icon + plug icon (if charging)

### 5G Signal Bars

**Visual Indicator** (left side, 2px padding):
- **5 vertical bars** with heights: 3, 4, 5, 6, 7px (left to right)
- **Width**: 1px each
- **Gap**: 1px between bars
- **Total width**: 9px
- **Position**: Y raised 2px above baseline

**Coloring** (proportional to `signalQuality`):
- **Black (#000)**: Filled bars = `ceil(quality / 100 * 5)`
- **Gray (#ccc)**: Empty bars
- **Example**: 60% quality → 3 black + 2 gray bars

**Source**: Polled from `/api/modem` every 1 second

### Technology Label

**Display** (right of signal bars, 1px gap):
- **Format**: Technology abbreviation (5G, LTE, 3G, 2G, or combinations like "5G+LTE")
- **Default**: `--` (if unavailable)
- **Font**: HaxrcorpFont16
- **Color**: Black (#000)
- **Position**: X = 12px, Y = 0

**Mapping**:
- `5gnr` → "5G"
- `lte` → "LTE"
- `umts/hspa/hsdpa/hsupa` → "3G"
- `gsm/gprs/edge` → "2G"
- Multiple techs joined with `+` (e.g., "5G+LTE")

**Source**: Extracted from `/api/modem` accessTech array

### Time & Date Display

**Center of Status Bar**:
- **Format**: `HH:MM MMM DD` (24-hour format, month day)
- **Example**: `23:30 Apr 13`
- **Font**: HaxrcorpFont16
- **Color**: Black (#000)
- **Position**: Centered horizontally
- **Update**: Every frame (real-time)

### Battery Icon (Status Bar)

**Sprite Asset**:
- **File**: `js/sprites.js` → `StatusBarBattery.sprite`
- **Dimensions**: 16×9 pixels
- **Format**: 6-bit grayscale (64 gray levels)
- **Position**: Right-aligned, 2px from right edge, 1px from top

**Battery Level Bar** (drawn inside sprite):
- **Max dimensions**: 10px wide × 5px high (at 100% charge)
- **Position inside sprite**: 6px from left, 3px from top
- **Calculation**: `barWidth = Math.round((10 * batteryLevel) / 100)`
- **Example**: At 69% → width = 7px (rounded from 6.9)
- **Color**: Black (#000)

**Example Rendering**:
```javascript
// In drawStatusBar():
var batteryX = canvas.w - 2 - 16;  // 238px (right-aligned)
canvas.drawSprite(StatusBarBattery.sprite, batteryX, 1, '#000');

// Draw level bar on top
var barWidth = Math.round((10 * batteryLevel) / 100);
canvas.drawRect(batteryX + 6, 4, barWidth, 5, '#000');
```

### Battery State
- **Default value**: -1 (unknown, shows "--%" until API responds)
- **Source**: Polled from `/api/power` every 5 seconds
- **Charging indicator**: Plug icon (7×7) if status === 'Charging' or 'Full'
- **Position**: Right-aligned, 2px from right edge, 1px from top

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
    btn.release();              // Reset state after 50ms
}, 50);
```

Button feedback timing: **50ms** (visual press animation before state change)

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
- **Source**: `/Users/vladpetrenko/Library/CloudStorage/Dropbox/Work/Flipper/flipperone_ui/fake-flip-ctl/images/dolphin_open.png`
- **Size**: 150×114 pixels
- **Format**: 6-bit grayscale (64 levels)
- **Features**: Semi-transparent edges preserved as gray tones
- **Render**: Desktop scene, top center

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
- **Supported**: ASCII 32–126 (printable ASCII)
- **Color**: Any hex color (passed as parameter)
- **API**: `HaxrcorpFont16.draw(ctx, text, x, y, color)`
- **Metrics**: `HaxrcorpFont16.textWidth(text)` → pixels

## Color Palette

| Purpose | Color | Usage |
|---------|-------|-------|
| Background | `#ffffff` | Main canvas fill |
| Text/Borders | `#000` | Primary text, frames, icons |
| Dividers | `#EDEDED` | Menu item separator lines |
| Unselected | `#EAEAEA` | Dim state, accents |
| Overlay | `rgba(255, 255, 255, 0.75)` | Modal dialogs, keyboards |
| Disabled | `#CCC` | Disabled text, buttons |

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

// Text is rendered via font object, NOT canvas directly
HaxrcorpFont16.draw(canvas.ctx, text, x, y, color)
```

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
    }, 150);  // 150ms animation
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

#### MenuItem
- **Properties**: text, icon (14×14), width (240px), height (19px regular, 18px last)
- **States**: default (with gray divider), selected (rounded border), pressed (filled black)
- **Features**: Icon display, vertical centering, divider line management
- **Render**: `item.render(canvas, x, y)`

#### Buttons: LeftButton, MiddleButton, RightButton
- **Width**: 48px each, 2px gap between (5 × 48 + 4 × 2 = 256px exact)
- **Height**: 11px
- **States**: default, pressed, disabled (gray text)
- **Properties**: text, action ('ok', 'run', 'esc'), callback
- **Render**: `btn.render(canvas)`

#### Scrollbar
- **When visible**: `totalItems > visibleItems`
- **Components**: Dotted track line + solid thumb indicator
- **Calculation**: `thumbHeight = (visibleItems / totalItems) * height`
- **Position**: x ≈ 251–253, leaving 1px clearance from right edge
- **Render**: `scrollbar.render(canvas, x, y, height)`

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

### Component Composition Pattern
```javascript
function MenuScene() {
    // Core components
    this.items = [...];                          // Array of MenuItem
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
python3 /Users/vladpetrenko/flipper/flipperone-testing/fake-flipctl/png-to-bitmap.py main_menu/14_px_network.png network_grayscale
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
// In MenuItem creation
new MenuItem('My Item', false, Icons.myIcon)

// In custom rendering
canvas.drawSprite(Icons.myIcon, x, y, '#000');  // Black
canvas.drawSprite(Icons.myIcon, x, y, '#fff');  // White (for pressed state)
```

## Rendering Icons

### In Menu Items

**File**: `js/apps/menu.js`

Icons are automatically rendered with menu items:

```javascript
MenuItem.prototype.render = function(canvas, x, y) {
    if (this.icon) {
        var iconX = x + PAD_X;
        var iconY = y + Math.floor((this.h - this.icon.h) / 2);
        
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

```javascript
function MenuScene() {
    var items = [
        new MenuItem('Network', false, Icons.network),
        new MenuItem('Testing', false, Icons.testing),
        new MenuItem('System', true, Icons.system)  // Last item (no divider)
    ];
}
```

**Result**:
- Row 1: [Network icon] Network (divider line)
- Row 2: [Testing icon] Testing (divider line)
- Row 3: [System icon] System (no divider)

### Dynamic Icon Color in Pressed State

```javascript
MenuItem.prototype.render = function(canvas, x, y) {
    var textColor = '#000';
    var iconColor = '#000';

    if (this.state === 'pressed') {
        // Black background, white icon and text
        canvas.drawRoundRect(x, y - 1, this.w, this.h + 1, 2, '#000');
        textColor = '#fff';
        iconColor = '#fff';  // Icon becomes white
    }

    // Draw icon with state-based color
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
│       └── menu.js                 # MenuItem rendering with icon support
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
- **Related components**: Canvas drawing primitives, MenuItem rendering
- **Converter tools**: `png-to-bitmap.py` (grayscale), `png-to-bitmap-converter-v3.py` (binary, legacy)
