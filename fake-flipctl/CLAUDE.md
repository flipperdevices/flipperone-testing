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
