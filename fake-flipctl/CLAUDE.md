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
│   ├── canvas.js          # Drawing primitives
│   ├── font.js            # 5x7 bitmap font data
│   ├── input.js           # Keyboard handler
│   ├── scene.js           # Scene stack manager
│   ├── ui.js              # UI components (status bar with battery, menu, scrollbar)
│   └── apps/
│       ├── menu.js        # Main menu (9 items, 3 wired to scenes)
│       ├── modem5g.js     # 5G Modem info via /api/modem (polls every 500ms)
│       ├── diskspace.js   # Disk space via /api/disk
│       └── power.js       # Battery info via /api/power (polls every 2s)
├── systemd/
│   ├── fake-flipctl-node-server.service   # Node.js HTTP server (port 8899)
│   ├── fake-flipctl-wayland-cage.service  # cage + cog kiosk on tty1
│   └── fake-flipctl.target                # Groups server + UI
└── assets/                # (reserved for future icons/sprites)
```

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
