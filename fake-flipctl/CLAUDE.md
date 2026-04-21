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

The node service's `WorkingDirectory` is the symlink, so `ExecStart=/usr/bin/node server.js` loads whichever variant it currently points at. Switching requires no systemd-unit edits. `daemon-reload` is run defensively in the switch pipeline so an OTA update that changed `fake-flipctl-node-server.service` on disk doesn't leave systemd stuck on the old unit.

Both variants implement the same pair of endpoints and the same client-side version watcher, so switching is symmetric in both directions.

### Switch flow

User presses **Testing → Switch to fake-flipctl2** in v1 (or **Testing → Switch to fake-flipctl** in v2).

1. Client does `POST /api/switch/flipctl2` (or `/api/switch/flipctl` in the reverse direction). Server returns `200 {success:true}` immediately.
2. Server spawns a `systemd-run --collect --no-block sh -c '…'` pipeline:
   ```bash
   ln -sfn /flipperone-testing/fake-flipctl2 /flipperone-testing/active-flipctl \
     && systemctl daemon-reload \
     && systemctl restart fake-flipctl-node-server.service
   ```
   (Target path is `fake-flipctl` in the reverse direction.) `systemd-run` is mandatory here: the shell must run in a transient unit outside the node service's cgroup, otherwise systemd tears the pipeline down when it restarts the service, and the chain dies before completing.
3. Node dies and restarts; the new instance picks up the symlink's new target and generates a fresh `SERVER_ID`.
4. Meanwhile, the client's version watcher keeps polling `/api/version`. During the ~1s node-restart window, fetches fail silently. As soon as node answers with a different signature (HTTP status + body id), the client calls `location.reload()`. The browser re-fetches HTML/JS/CSS from the already-running cog, which now serves the new variant.

Cog is **not** restarted. This is deliberate: restarting cog would tear down the entire WebKit process tree, reacquire DRM, and flash the LCD. Reloading the page inside the running cog is near-instant and much cleaner.

The watcher uses a combined status+id signature (rather than comparing `id` alone) so that it also handles the case where one variant might not implement `/api/version` — a 404 counts as a signature change and still triggers the reload. Today both variants do implement it, but the watcher is defensive against a future variant that doesn't.

### Adding a variant

1. Point `active-flipctl` at the new variant dir: `ln -sfn foo /flipperone-testing/active-flipctl`.
2. Restart the node service. The UI reloads itself via the version watcher (even if the new variant doesn't implement `/api/version`).
3. For two-way switching, the new variant needs its own `/api/switch/<target>` endpoint and a matching menu entry, modeled on v1/v2.

The node unit, the cog unit, and `/etc/systemd/system/` are untouched.

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

## File: benchmark.html — browser CPU benchmark

A self-contained page that isolates individual browser-side activities (rAF, timers, canvas paint, CSS animation, DOM mutation, WebGL, WebSocket push) so we can measure which of them drives Cog / WPE CPU on the RK3576 panel. Used to answer questions like "why does the main UI idle at ~15% CPU?" — enable one bench at a time, watch the WebProcess and compositor thread in `top -H`, compare.

### Running it

```bash
sudo systemctl start cog-benchmark-page.service    # show benchmark.html
sudo systemctl start cog-seat1.service             # back to the normal UI
```

Both services drive `/dev/dri/card0` and are declared `Conflicts=` with each other, so starting one auto-stops the other.

The benchmark relies on **`ws-counter.service`** being up for the "Websocket redraw" test; that unit is already enabled at boot.

### Input mapping

The 5 buttons at the bottom of the page correspond 1-to-1 with Flipper One's hardware buttons. Each button sends a single ASCII key that the page consumes:

| Button | Key | Action |
|---|---|---|
| reset | `z` | Turn all tests off |
| help  | `x` | Open help overlay describing the currently-selected test |
| (empty) | — | — |
| (empty) | — | — |
| run   | `b` | Toggle the currently-selected test |

Keyboard equivalents for development: Backspace/Escape = reset, Enter/Space = toggle, ↑/↓ = cursor.

### The 10 tests

1. **rAF empty** — empty `requestAnimationFrame` loop; pure 60 Hz JS wakeup with no per-frame work.
2. **rAF + 1 fillRect** — adds one canvas fill per frame; shows the minimal paint cost over empty rAF.
3. **rAF + many rects** — heavy canvas paint; mimics bitmap-font rendering as used in the main UI.
4. **setInterval 16ms / 100ms / 1000ms** — JS timer at three rates, no work per tick. Compare against rAF empty to see timer cost without vsync alignment; compare the three rates to see per-wakeup fixed cost.
5. **CSS animation** — 2D `@keyframes rotate`; pure GPU compositor path with no JS per frame.
6. **DOM mutate 100ms** — `textContent` writes at 10 Hz on a visible node. Exercises DOM mutation + style recalc + layout + paint.
7. **Websocket redraw** — opens a `WebSocket` to `ws://localhost:8898/`, updates a status bar node each time the server pushes. No polling, no rAF — the browser wakes only when the server sends. Pairs with `ws-counter-server.js`.
8. **WebGL spin cube** — full GLES pipeline: vertex + fragment shaders, per-face grayscale, depth-tested triangles, driven by rAF. The heaviest GPU path.

### Design for zero idle CPU

This is a benchmark, so the page must itself add no CPU when no test is enabled — otherwise numbers are contaminated. Three design choices enforce this:

- **Hidden-by-default visual targets.** `#cvs`, `#glCvs`, `#domTarget`, `#cssAnim`, `#wsStatus` are `display:none` in CSS. A small `updateTargets()` reveals each one only while the bench that owns it is running. The CSS `@keyframes spin` on `#cssAnim` is declared at all times but does nothing while the element is `display:none` — WebKit does not tick animations on non-rendered elements.
- **No global render loop.** The menu's row list is built once from DOM elements; cursor-move flips two class names (`.sel` on and off) rather than rebuilding `innerHTML`. Keypress handling runs only from `keydown`.
- **Conditional tick refresh.** Per-test tick counters in the menu rows are updated by a 1 Hz interval that is *started* when any bench turns on and *stopped* when the last one turns off.

With all tests off: the page keeps no timers, no rAF, and no animations running; WebProcess CPU is effectively zero.

### Shared-canvas mutex

Some tests share visual targets (the two rAF-paint tests share `#cvs`; the cube and any other GL test would share `#glCvs`). `toggle()` turns off any bench that owns the same target before starting a new one, so two tests can never race on the same canvas.

### Pixel-perfect text

Browser-rendered text at 8–12 px is normally antialiased and looks soft on the 256×144 panel. The page avoids this by:

- Loading **Zpix** at its native 12 px via `@font-face` (`fonts/zpix.woff2`, ~950 KB, `font-display: block` so the page stays blank until the font is ready).
- Setting `-webkit-font-smoothing: none` and `font-smooth: never`.
- Setting `image-rendering: pixelated` on the root so the compositor uses nearest-neighbor for any scaled canvas/GL output.

### WebSocket counter server

`ws-counter-server.js` — ~70-line zero-dep Node.js server. Implements the RFC 6455 upgrade handshake (SHA-1 + base64) and text-frame encoding inline; does not pull the `ws` package. Broadcasts `{"counter": N, "ts": <ms>}` to every connected socket once per second. Listens on `127.0.0.1:8898`, so only the local cog can reach it. Runs under `ws-counter.service`.

The "Websocket redraw" bench is the cheapest way to drive a 1 Hz UI update on this stack: no `setInterval`, no `fetch()`, no rAF — only a single socket read → JS handler → one `textContent` write per second. Useful as a lower bound when comparing against the `setInterval 1000ms` bench.

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
├── benchmark.html         # Browser CPU benchmark page (see section above)
├── ws-counter-server.js   # Zero-dep WebSocket counter for the Websocket redraw bench
├── fonts/
│   └── zpix.woff2         # Zpix pixel font at native 12px, used by benchmark.html
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
│   ├── fake-flipctl-node-server.service   # Node.js HTTP server; WorkingDirectory=<repo root>/active-flipctl
│   ├── cog-benchmark-page.service         # Runs cog on seat1 against benchmark.html
│   └── ws-counter.service                 # Runs ws-counter-server.js
└── assets/                # (reserved for future icons/sprites)
```
