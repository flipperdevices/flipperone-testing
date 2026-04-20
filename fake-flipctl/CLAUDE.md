# fake-flipctl

## What is this project

A web application that simulates the Flipper One LCD screen user interface. It renders a 256x144 monochrome (black/white/grayscale) display using HTML5 Canvas and runs inside the Cog web browser on the actual Flipper One hardware.

## Tech Stack

- **Vanilla JS + CSS** — no frameworks, no bundlers, no client-side dependencies
- **Node.js server** (`server.js`) — static file server + JSON API endpoints, requires root
- **HTML5 Canvas** — pixel-perfect 256x144 rendering
- **Cog browser** — minimal WebKit-based kiosk browser, DRM plugin (`-P drm`) drives the SPI LCD directly; Wayland plugin also available for desktop dev

## Architecture

### Server (`server.js`)
- Static file server on port **8899** (binds `0.0.0.0`), requires root
- **`/api/modem`** — aggregates `mmcli -m 0 -J`, `qmicli --nas-get-serving-system`, `--nas-get-cell-location-info`, `--nas-get-signal-strength` for RM530N-GL modem via `/dev/cdc-wdm0`; also reads sysfs byte counters on the modem net interface for live bandwidth
- **`/api/disk`** — reads `df` for `/dev/mmcblk0p2` usage (eMMC)
- **`/api/power`** — reads sysfs `/sys/class/power_supply/bq28z610-0` (voltage, current, capacity, charge, temp, time estimates)
- **`/api/version`** — returns `{id: <hex>}`, where `id` is a random 8-byte value generated at process start. Changes on every restart. The client polls this to detect that the server has been replaced (e.g., variant switch) and reloads itself.
- **`/api/switch/flipctl2`** — swaps the `active-flipctl` symlink to point at `fake-flipctl2` and restarts `fake-flipctl-node-server.service`. See **Variant switching** below.
- Systemd unit: `fake-flipctl-node-server.service`

### Client
- **Bitmap font** (`js/font.js`) — custom 5x7 pixel font, 6x8 cell (supports ASCII 32-126)
- **Canvas layer** (`js/canvas.js`) — drawing primitives (rect, text, line, pixel, frame)
- **Input layer** (`js/input.js`) — keyboard events mapped to actions (up/down/left/right/ok/back)
- **Scene manager** (`js/scene.js`) — stack-based push/pop scene navigation
- **UI components** (`js/ui.js`) — status bar (with battery icon + percentage, polls `/api/power` every 5s), menu list with highlight, scrollbar
- **App scenes** (`js/apps/`) — each screen is a scene with `render()` and `handleInput()`, returns `'pop'` from `handleInput` to go back
- **Version watcher** (`js/main.js`) — polls `/api/version` every 2s. First response is the baseline; a subsequent change in `id` triggers `location.reload()`. Enables variant switching without restarting cog.

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

### Kiosk mode

Cog runs on the 256x144 SPI LCD (`/dev/dri/card0`). Cog's DRM plugin drives this panel directly — no Wayland compositor needed on this board.

Systemd units:
- **`fake-flipctl-node-server.service`** (in this repo, `systemd/`) — Node.js HTTP server on port 8899. `WorkingDirectory=/flipperone-testing/active-flipctl` (symlink, see below), `ExecStart=/usr/bin/node server.js`. Requires root for sysfs.
- **`cog-seat1.service`** (ships with the device image, not this repo) — launches `/usr/bin/cog -P drm -O renderer=gles http://localhost:8899` on a dedicated logind seat, under user `flipctl`.

Install (on the device):
```bash
# Deploy this repo to /flipperone-testing/ (rsync, etc.).
# The active-flipctl symlink must exist — it is tracked in the repo,
# so a fresh checkout brings it. Do NOT strip symlinks when deploying.
sudo ln -sf /flipperone-testing/fake-flipctl/systemd/fake-flipctl-node-server.service \
    /etc/systemd/system/fake-flipctl-node-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now fake-flipctl-node-server.service
```

`cog-seat1.service` is already enabled and running on the device image; it launches on `multi-user.target` and reaches `http://localhost:8899` after the node server comes up.

DRM devices:
- `/dev/dri/card0` — SPI LCD panel (256x144, panel-mipi-dbi-spi)
- `/dev/dri/card2` — Rockchip GPU/HDMI (only used when external monitor connected)

## Variant switching (fake-flipctl ↔ fake-flipctl2)

Two UI variants coexist in the same repo: `fake-flipctl/` (v1) and `fake-flipctl2/` (v2). Only one runs at a time. Selection is driven by a single tracked symlink at the repo root:

```
active-flipctl -> fake-flipctl     # default (checked in)
active-flipctl -> fake-flipctl2    # after Testing → Switch to fake-flipctl2
```

The node service's `WorkingDirectory` is the symlink, so `ExecStart=/usr/bin/node server.js` loads whichever variant it currently points at. Switching requires no systemd-unit edits and no `daemon-reload`.

### Switch flow

User presses **Testing → Switch to fake-flipctl2** in the UI.

1. Client does `POST /api/switch/flipctl2`. Server returns `200 {success:true}` immediately.
2. Server spawns a `systemd-run --collect --no-block sh -c '…'` pipeline:
   ```bash
   ln -sfn /flipperone-testing/fake-flipctl2 /flipperone-testing/active-flipctl \
     && systemctl restart fake-flipctl-node-server.service
   ```
   `systemd-run` is mandatory here: the shell must run in a transient unit outside the node service's cgroup, otherwise systemd tears the pipeline down when it restarts the service, and the chain dies before completing.
3. Node dies and restarts; the new instance picks up the symlink's new target and generates a fresh `SERVER_ID`.
4. Meanwhile, the client's version watcher keeps polling `/api/version`. During the ~1s node-restart window, fetches fail silently. As soon as node answers with a different `id`, the client calls `location.reload()`. The browser re-fetches HTML/JS/CSS from the already-running cog, which is reading from the new variant.

Cog is **not** restarted. This is deliberate: restarting cog would tear down the entire WebKit process tree, reacquire DRM, and flash the LCD. Reloading the page inside the running cog is near-instant and much cleaner.

### Adding a variant

1. Point `active-flipctl` at the new variant dir: `ln -sfn foo /flipperone-testing/active-flipctl`.
2. Restart the node service. The UI reloads itself via the version watcher.

The node unit, the cog unit, and `/etc/systemd/system/` are untouched.

### v2 parity (TODO)

`fake-flipctl2/server.js` still has a legacy `/api/switch/flipctl` endpoint from the oneshot-service era. It needs a mirror of v1's `/api/switch/flipctl2` (swap symlink → `fake-flipctl`, restart node via `systemd-run`). Until then, switching back from v2 to v1 via the menu is broken; recover by hand with:

```bash
sudo ln -sfn /flipperone-testing/fake-flipctl /flipperone-testing/active-flipctl
sudo systemctl restart fake-flipctl-node-server.service
```

## Live development workflow

- Repo checkout (with `.git`) lives at **`/home/user/f1/flipperone-testing/`** on the device. Commits happen here.
- Deployed copy (no `.git`) lives at **`/flipperone-testing/`**. This is what the node service reads.
- Sync from Mac → `/home/user/f1/flipperone-testing/` and from `/home/user/f1/flipperone-testing/` → `/flipperone-testing/` via rsync. The rsync that feeds `/flipperone-testing/` must preserve symlinks (`-l` / `-a`) so `active-flipctl` survives.

### Edit & reload cycle

1. Edit files on Mac; let rsync push them to `/home/user/f1/flipperone-testing/` and then on to `/flipperone-testing/`.
2. Restart the node service to pick up server-side changes: `sudo systemctl restart fake-flipctl-node-server.service`. The version watcher in the running page will reload the UI on its own within ~2s.
3. For client-only edits (JS/CSS/HTML with no server.js change), the watcher won't trigger (SERVER_ID hasn't changed) — force a reload by restarting node anyway, or press F5 in cog during development.
4. Commit from `/home/user/f1/flipperone-testing/`.

Cog is a kiosk browser with no devtools UI. Debug by reading `journalctl -u fake-flipctl-node-server.service` and, for client-side issues, by reading `sudo journalctl -u cog-seat1.service` (stdout from WebKit appears here).

## File: test-screen.html

Test pattern page for verifying LCD display alignment — draws 1px border, diagonal cross, center crosshair, and corner coordinate labels at native 256x144.

## Project Structure

Repo root (one level up from this file) owns the `active-flipctl` symlink that selects which variant directory the node service runs from:

```
<repo root>/
├── active-flipctl -> fake-flipctl     # tracked symlink; see "Variant switching"
├── fake-flipctl/                      # this dir (v1 UI)
└── fake-flipctl2/                     # v2 UI
```

Within `fake-flipctl/`:

```
fake-flipctl/
├── server.js              # Node.js HTTP server + API endpoints
├── index.html             # Main app entry point
├── test-screen.html       # Display test pattern
├── css/style.css          # Layout, canvas scaling
├── js/
│   ├── main.js            # Bootstrap, render loop, /api/version watcher (auto-reload on id change)
│   ├── canvas.js          # Drawing primitives
│   ├── font.js            # 5x7 bitmap font data
│   ├── input.js           # Keyboard handler
│   ├── scene.js           # Scene stack manager
│   ├── ui.js              # UI components (status bar with battery, menu, scrollbar)
│   └── apps/
│       ├── menu.js        # Main menu; Testing submenu has "Switch to fake-flipctl2"
│       ├── submenu.js     # Generic submenu scene (null-safe factory dispatch)
│       ├── modem5g.js     # 5G Modem info via /api/modem (polls every 500ms)
│       ├── diskspace.js   # Disk space via /api/disk
│       └── power.js       # Battery info via /api/power (polls every 2s)
├── systemd/
│   └── fake-flipctl-node-server.service   # Node.js HTTP server; WorkingDirectory=<repo root>/active-flipctl
└── assets/                # (reserved for future icons/sprites)
```
