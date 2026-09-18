/**
 * WifiScannerV2DemoScene
 *
 * Testing → UI Demos → 'Wi-Fi scanner v2'. Second design pass at the
 * Wi-Fi scanner, built up screen by screen like v1
 * (wifi_scanner_demo.js). Current stage: the standard chrome only —
 * status bar + gray title strip with the scanner icon and the app
 * name — over an empty body. Back pops.
 */
var WifiScannerV2DemoScene = (function() {
    var TITLE_H = 16;
    var BAND_LABEL = '2.4 GHz band';   // centred in the title strip
    var BAND_SHORT = '2.4GHz';         // as written on the cards / in the pop-up
    var HAXR_INK_H = 9;                // Haxrcorp ink spans draw y+2 .. y+8 (declared first — used by constants below)

    // Bottom buttons, each 52 px in from its screen edge:
    //   X (left)  — mode switch; its label names the mode a press
    //               switches to ("Channels" in SSID mode, "SSID" in
    //               Channels mode). Plain button, no toggle bar.
    //   V (right) — "More", a toggle that opens / closes the details
    //               pop-up (bar on while it's open).
    // While the pop-up is open the left slot shows "Help" instead
    // (v1 geometry: 53 px in).
    var BTN_W        = 48;
    var BTN_EDGE_PAD = 52;
    var MODE_BTN_X   = BTN_EDGE_PAD;                      // 52
    var MORE_BTN_X   = 256 - BTN_EDGE_PAD - BTN_W;        // 156
    var HELP_BTN_X   = 53;

    // ── Details pop-up (View) ────────────────────────────────────
    // Same recipe as v1: 50 % white wash over the page, a white
    // ResponsiveFrame (black 1-px outline, radius 3) sized to the
    // content and centred, and a solid black name tab hanging off its
    // top-left corner — 22 px tall with its bottom 4 px behind the
    // frame, width fitted to "lock + SSID" in Sporty (white on black).
    // Content (Haxrcorp, labels dimmed, values black): signal icon +
    // "Signal level: <rssi> dBm" / "<band>  Channel <n>", then a
    // label/value column: Security (+ warning icon), Protocol, BSSID.
    var POPUP_W        = 156;
    var POPUP_H        = 96;
    var POPUP_X        = Math.floor((256 - POPUP_W) / 2);   // 50
    var POPUP_Y        = 26;
    var POPUP_RADIUS   = 4;                          // main frame and tab corners
    var POPUP_TAB_H    = 24;                         // bottom edge 2 px lower than v1's 22 (still behind the frame)
    var POPUP_TAB_OVERLAP = 6;                       // rows hidden behind the frame → tab top stays at y=8
    var POPUP_TAB_Y    = POPUP_Y - (POPUP_TAB_H - POPUP_TAB_OVERLAP);   // 8
    var POPUP_TAB_PAD_X   = 6;
    var POPUP_TAB_TEXT_DY = 1;                       // Sporty draw y inside the tab
    var POPUP_TAB_LOCK_DY = 4;                       // lock (8×10) shares the Sporty ink rows
    var POPUP_TAB_LOCK_GAP = 3;
    var POPUP_WASH     = 'rgba(255, 255, 255, 0.5)';
    var POPUP_DIM      = '#696969';
    var POPUP_ICON_DX  = 8,  POPUP_ICON_DY  = 12;    // 22×17 signal icon
    var POPUP_TEXT_DX  = 39;                         // text column beside the icon
    var POPUP_SIGNAL_DY = 12, POPUP_BAND_DY = 24;
    var POPUP_LABEL_DX = 8,  POPUP_VALUE_DX = 52;    // label / value columns
    var POPUP_ROW_DY   = [43, 58, 73];               // Security / Protocol / BSSID
    var POPUP_WARN_GAP = 3;
    var POPUP_WARN_DY  = -1;                         // 11-px icon vs 7-px ink: 1 px above the draw y

    // Help pulses while the pop-up is open (body fills toward black up
    // to HELP_PULSE_MAX_BLACK, label inverts); pressing it lays the
    // warning mock over a second wash. Same as v1.
    var HELP_PULSE_MAX_BLACK = 0.5;
    var HELP_PULSE_MS  = 1600;
    var BTN_H          = 14;                         // bottom-button height (canvas.js)
    var WARNING_IMG_SRC = 'assets/wifi_scanner/wifi_scan_warning.png';

    // Lazy image cache — each asset loads once, repaint on arrival.
    var imageCache = {};
    function loadImage(src) {
        var img = imageCache[src];
        if (!img) {
            img = new Image();
            img.onload = function() {
                if (window.requestRender) window.requestRender();
            };
            img.src = src;
            imageCache[src] = img;
        }
        return img;
    }
    function imageReady(img) {
        return !!(img && img.complete && img.naturalWidth);
    }

    // Signal icon (wi_fi_icon_22px, 22×17) drawn segment by segment —
    // copied from v1: arcs 1..activeArcs (from the dot outwards) and
    // the dot are black, the rest a translucent ghost.
    var SIGNAL_GHOST_ALPHA = 0.3;
    function wifiSegment(row, col) {
        if (row <= 4) return 3;
        if (row === 5) return (col < 4 || col > 17) ? 3 : 2;
        if (row <= 9) return 2;
        if (row <= 13) return 1;
        return 0;
    }
    function drawWifiSegments(canvas, sprite, x, y, activeArcs) {
        var ctx = canvas.ctx;
        var idx = 0;
        for (var row = 0; row < sprite.h; row++) {
            for (var col = 0; col < sprite.w; col += 4) {
                var b0 = sprite.d[idx] || 0, b1 = sprite.d[idx + 1] || 0, b2 = sprite.d[idx + 2] || 0;
                idx += 3;
                var pxs = [
                    (b0 >> 2) & 0x3F,
                    (((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0F)) & 0x3F,
                    (((b1 & 0x0F) << 2) | ((b2 >> 6) & 0x03)) & 0x3F,
                    b2 & 0x3F
                ];
                for (var i = 0; i < 4 && col + i < sprite.w; i++) {
                    var opacity = (63 - pxs[i]) / 63;
                    if (opacity <= 0.01) continue;
                    var seg = wifiSegment(row, col + i);
                    var on  = (seg === 0) || (seg <= activeArcs);
                    ctx.globalAlpha = opacity * (on ? 1 : SIGNAL_GHOST_ALPHA);
                    ctx.fillStyle = '#000';
                    ctx.fillRect(x + col + i, y + row, 1, 1);
                }
            }
        }
        ctx.globalAlpha = 1;
    }
    // RSSI → active arcs: ≥ −55 → 3, −55…−70 → 2, −70…−85 → 1, else 0.
    function signalArcs(rssi) {
        if (rssi >= -55) return 3;
        if (rssi >= -70) return 2;
        if (rssi >= -85) return 1;
        return 0;
    }


    // Channel axis: 1..14 in Haxrcorp, centres spread evenly over
    // CH_SPAN px (first centre at CH_LEFT, last at CH_LEFT + CH_SPAN),
    // ink bottom CH_BOTTOM_PAD px above the screen's bottom edge.
    var CH_COUNT      = 14;
    var CH_SPAN       = 223;
    var CH_LEFT       = Math.floor((256 - CH_SPAN) / 2);     // 16 — centred on screen
    var CH_BOTTOM_PAD = 18;
    var CH_INK_H      = HAXR_INK_H;
    var CH_Y          = 144 - CH_BOTTOM_PAD - CH_INK_H;      // 117 → ink rows 119..125, 18 rows free below

    // Channel cursor: a 2-px bar slightly narrower than one channel
    // zone (slot pitch 223/13 ≈ 17 px), centred over the current
    // channel's digit with 2 px of air above the ink. Hops 1 → 14 and
    // wraps, CURSOR_DWELL_MS per channel, driven by wall-clock time.
    var CURSOR_W        = 14;
    var CURSOR_H        = 2;
    var CURSOR_Y        = CH_Y - 2;                          // rows 115..116, 2 rows of air, ink from 119
    var CURSOR_DWELL_MS = 400;

    // Centre x of channel slot i (0-based) — shared by digits and cursor.
    function slotX(i) {
        return CH_LEFT + Math.round(i * CH_SPAN / (CH_COUNT - 1));
    }

    // ── Fake traffic model ───────────────────────────────────────
    // What the scanner "hears" on a channel is a packet RATE (pkt/s)
    // — it goes up when a network gets busy and down when it goes
    // quiet. Each network has a slow activity cycle: `a` runs 0..1 on
    // a sine with period `period`; below `idle` the network is silent
    // (rate 0), above it the rate scales from `min` to 1 × `rate`.
    // A 20 MHz network on channel c also leaks onto c±1 (~1/3) and
    // c±2 (~1/8), which is how a real per-channel histogram looks.
    // 12–14 stay near-silent (EU/JP-only channels). Channels 1-based.
    // `rssi` (dBm) sets the arc height; `width` is the channel width
    // in MHz — 20 (±2 channels) or 40 (HT40 bonding, ±4 channels,
    // centred between primary and secondary). Channels / names follow
    // the v1 list so the two demos agree.
    // `sec` is the security tag shown in the label. A hidden network
    // (`ssid: null`) still beacons — BSSID, channel, RSSI and security
    // are all visible to a passive scanner, only the name is blank —
    // so it gets an arc like any other and a HIDDEN_LABEL name.
    // `proto` / `bssid` feed the details pop-up. 2.4 GHz means
    // 802.11b/g/n (ac is 5 GHz only); WEP can't ride HT rates, so a
    // WEP network is honestly 802.11g.
    var NETWORKS = [
        { ssid: 'TP-Link_5F2A', sec: 'WPA2', ch: 1,  width: 20, rssi: -62, rate: 60,  period: 31000, phase: 0.7, idle: 0.20, min: 0.3, proto: '802.11n', bssid: 'c0:25:e9:4b:12:7a' },
        { ssid: 'Cafe-WiFi',    sec: 'OPEN', ch: 4,  width: 20, rssi: -48, rate: 220, period: 23000, phase: 0.0, idle: 0.00, min: 0.5, proto: '802.11n', bssid: '64:ae:0c:90:27:21' },   // steady, breathing
        { ssid: 'xfinitywifi',  sec: 'OPEN', ch: 6,  width: 40, rssi: -70, rate: 140, period: 19000, phase: 3.9, idle: 0.15, min: 0.4, proto: '802.11n', bssid: '58:90:43:a1:0e:c4' },   // fat HT40 (covers 2–10), busy
        { ssid: 'My_Home',      sec: 'WEP',  warn: true, ch: 8, width: 20, rssi: -45, rate: 180, period: 17000, phase: 2.1, idle: 0.35, min: 0.3, proto: '802.11g', bssid: '3c:84:6a:1f:b8:02' },   // ours — bursty, quiet ~1/3 of the time; WEP = weak → warning
        { ssid: 'home_iot_2G',  sec: 'WPA2', ch: 11, width: 20, rssi: -88, rate: 25,  period: 41000, phase: 1.3, idle: 0.60, min: 0.2, proto: '802.11n', bssid: 'd8:47:32:e5:0a:9c' },   // IoT chirps
        { ssid: null,           sec: 'WPA2', ch: 13, width: 20, rssi: -80, rate: 15,  period: 37000, phase: 5.0, idle: 0.70, min: 0.2, proto: '802.11n', bssid: '9c:3d:cf:77:41:e8' }    // hidden SSID
    ];
    var HIDDEN_LABEL = 'Hidden SSID';

    // Label over the selected arc: "<name>  <rssi> dBm  <sec>" in
    // white Haxrcorp on a black ResponsiveFrame pill (same recipe as
    // v1's security pills: 11 px tall, 4 px side padding, radius 3),
    // centred on the arc's channel with its bottom LABEL_GAP px above
    // the apex; kept inside the screen and below the strip.
    var LABEL_GAP    = 2;                        // pill bottom → arc apex (content sits where it did at 11 px / gap 3)
    var LABEL_H      = 13;                       // 11 px content band + 1 px extra above and below
    var LABEL_PAD_X  = 4;
    var LABEL_CONTENT_DY = 1;                    // text/icons drop by the extra top pixel
    var LABEL_MIN_Y  = UI.STATUS_BAR_H + TITLE_H + 1;   // 30 — 1 px under the strip
    var LABEL_SIDE_PAD = 2;
    var LABEL_FILL   = '#000';
    var LABEL_TEXT   = '#fff';
    var LABEL_ICON_GAP = 3;                      // text → icon gaps (lock after the name, warning after the tag)
    var LABEL_LOCK_DY  = 1;                      // lock (8×10) from the pill top: rows 1..10, centred on the caps
    var LABEL_WARN_DY  = 1;                      // warning (11×11) from the pill top: rows 1..11
    var LABEL_NAME_DY  = 0;                      // Helvb08 name: extra offset on top of LABEL_CONTENT_DY

    // Arcs: a network's footprint is the upper half of an ellipse
    // centred on its channel slot at the bar baseline — horizontal
    // radius = ±2 channel slots for 20 MHz, ±4 for HT40; vertical
    // radius = RSSI mapped from ARC_RSSI_MIN (on the axis) to
    // ARC_RSSI_MAX (full BAR_MAX_H). Drawn as a 1-px gray outline,
    // column by column with vertical joins so the steep flanks stay
    // continuous. A network's arc only shows once the scanner has
    // dwelt within its audible range (±1 channel for 20 MHz, ±2 for
    // HT40 — where its beacons come through); every such dwell takes
    // a fresh RSSI reading (base ± RSSI_JITTER_DB fading) and the arc
    // eases to the new height. Arcs never heat — only bars do.
    var ARC_RSSI_MIN   = -90;
    var ARC_RSSI_MAX   = -30;
    var ARC_COLOR      = '#AAAAAA';
    // Selected network: black, 2-px stroke (the 1-px arc plus a second
    // one inset by 1 px on both radii), drawn last so it sits on top.
    var ARC_SEL_COLOR  = '#000';
    var RSSI_JITTER_DB = 3;
    var RSSI_EASE_MS   = 300;
    function arcRadiusX(net) {
        return Math.round((net.width / 10) * CH_SPAN / (CH_COUNT - 1));   // 34 / 69
    }
    function audibleRange(net) {
        return net.width / 20;                                             // 1 / 2 channels
    }
    function arcHeight(rssi) {
        var k = (rssi - ARC_RSSI_MIN) / (ARC_RSSI_MAX - ARC_RSSI_MIN);
        return Math.round(BAR_MAX_H * Math.max(0, Math.min(1, k)));
    }
    function drawArc(ctx, cx, baseY, rx, ry, color) {
        ctx.fillStyle = color;
        var prev = null;
        for (var dx = -rx; dx <= rx; dx++) {
            var yy = Math.round(ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / (rx * rx))));
            var py = baseY - yy;
            if (prev === null) {
                ctx.fillRect(cx + dx, py, 1, 1);
            } else {
                var top = Math.min(prev, py), bot = Math.max(prev, py);
                // Join to the previous column so the flank has no gaps;
                // the shared row is drawn once, on this column.
                ctx.fillRect(cx + dx, top, 1, bot - top + 1);
            }
            prev = py;
        }
    }
    // Spectral leak by channel offset from the centre, per width:
    // 20 MHz reaches ±2, HT40 is flat-ish across ±2 and rolls off to ±4.
    var SPILL = {
        20: [1, 0.33, 0.12],
        40: [1, 0.90, 0.60, 0.30, 0.12]
    };
    var NOISE_RATE = [5, 4, 6, 3, 4, 8, 3, 4, 5, 3, 6, 1, 1, 0];   // background pkt/s per channel

    function networkActivity(net, t) {
        var a = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / net.period + net.phase);
        if (a < net.idle) return 0;
        var k = (a - net.idle) / (1 - net.idle);
        return net.min + (1 - net.min) * k;
    }
    // pkt/s on channel i (0-based) at wall-clock t.
    function channelRate(i, t) {
        var r = NOISE_RATE[i];
        for (var n = 0; n < NETWORKS.length; n++) {
            var spill = SPILL[NETWORKS[n].width];
            var d = Math.abs((NETWORKS[n].ch - 1) - i);
            if (d < spill.length) r += NETWORKS[n].rate * spill[d] * networkActivity(NETWORKS[n], t);
        }
        return r;
    }

    // Bars: last measured pkt/s per channel, 1 px per PPS_PER_PX,
    // capped at BAR_MAX_H. While the cursor dwells on a channel its
    // bar eases toward the live rate (time constant BAR_EASE_MS, so
    // it gets most of the way within one dwell); off-dwell it holds
    // the last reading — the scanner can't hear channels it isn't on.
    var BAR_W       = CURSOR_W;
    var BAR_BOTTOM  = CURSOR_Y - 2;              // 113 — last bar row is 112 (follows the cursor)
    var BAR_TOP     = UI.STATUS_BAR_H + TITLE_H + 5;   // 34
    var BAR_MAX_H   = BAR_BOTTOM - BAR_TOP;      // 79
    var PPS_PER_PX  = 4;                         // 79 px ≈ 316 pkt/s
    var BAR_COLOR   = '#CCCCCC';                 // bars at rest
    var BAR_SEL_COLOR = '#000';                  // selected channel's bar (Channels mode)
    var BAR_GRAY    = 0xCC;                      // BAR_COLOR's gray level

    // "Heat": a bar that grew during the current dwell darkens toward
    // black — fully black once it gained HEAT_FULL_DELTA pkt/s — then
    // fades back to BAR_COLOR exponentially (HEAT_DECAY_MS). Only
    // growth heats; a reading that drops (network went quiet) doesn't.
    var HEAT_ENABLED    = false;                 // switched off for now; flip to bring the effect back
    var HEAT_FULL_DELTA = 40;                    // pkt/s of growth for full black (= 10 px)
    var HEAT_DECAY_MS   = 1500;
    var CURSOR_COLOR    = '#000';
    var BAR_EASE_MS = 150;
    var JITTER      = 0.25;                      // ±25 % per-frame reading wobble

    function WifiScannerV2DemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Wi-Fi Scanner';
        this.breadcrumbTitle = 'Wi-Fi Scanner';
        this._pps    = [];      // last measured pkt/s per channel (0-based)
        this._heat   = [];      // 0..1 darkening per channel (see HEAT_*)
        this._dwellCh   = -1;   // channel of the current dwell
        this._dwellBase = 0;    // its pkt/s when the dwell began
        this._seen       = [];  // per network: scanner has heard it at least once
        this._rssi       = [];  // per network: displayed (eased) RSSI, dBm
        this._rssiTarget = [];  // per network: latest reading, dBm
        this._sel        = -1;  // selected network index, -1 = none
        this._lastTs = 0;       // wall-clock of the previous frame
        this._reset();

        // Mode switch on X — a plain button whose label names the mode
        // it switches TO: "Channels" while in SSID mode, "SSID" while
        // in Channels mode.
        this._mode  = 'ssid';    // 'ssid' → arcs selectable; 'ch' → bars selectable
        this._chSel = 0;         // selected channel (0-based) in Channels mode
        this._modeBtn = new UI.MiddleButton('Channels', 1, BTN_W, 2, 'edit',
            function() { /* fired from handleInput */ });
        this._modeBtn.x = MODE_BTN_X;
        // More on V: toggle that opens / closes the details pop-up.
        this._moreBtn = new UI.MiddleToggleButton('More', 3, BTN_W, 2, 'del',
            function() { /* fired from handleInput */ }, false);
        this._moreBtn.x = MORE_BTN_X;
        // Help replaces the mode toggle on X while the pop-up is open.
        this._helpBtn = new UI.MiddleButton('Help', 1, BTN_W, 2, 'edit',
            function() { /* fired from handleInput */ });
        this._helpBtn.x = HELP_BTN_X;

        this._popup   = null;    // network shown in the details pop-up, or null
        this._warning = false;   // Help's full-screen warning mock is up
        loadImage(WARNING_IMG_SRC);   // so the first show is instant
    }

    WifiScannerV2DemoScene.prototype._closePopup = function() {
        this._popup = null;
        this._warning = false;
        this._moreBtn.toggled = false;
        if (window.requestRender) window.requestRender();
    };

    // 30 ms press flash, same pattern as the other apps' buttons;
    // `then` (optional) runs on release.
    WifiScannerV2DemoScene.prototype._pressButton = function(btn, then) {
        btn.press();
        if (window.requestRender) window.requestRender();
        setTimeout(function() {
            btn.release();
            if (then) then();
            if (window.requestRender) window.requestRender();
        }, 30);
    };

    // Left/Right walk the arcs the scanner has heard so far, in
    // channel order (NETWORKS is sorted by channel), wrapping at both
    // ends. From "none selected" Right lands on the leftmost arc and
    // Left on the rightmost. Unseen networks are skipped.
    WifiScannerV2DemoScene.prototype._moveSelection = function(dir) {
        var n = NETWORKS.length;
        var i = this._sel;
        for (var step = 0; step < n; step++) {
            i = (i < 0) ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n;
            if (this._seen[i]) { this._sel = i; return; }
        }
    };

    WifiScannerV2DemoScene.prototype._reset = function() {
        for (var i = 0; i < CH_COUNT; i++) { this._pps[i] = 0; this._heat[i] = 0; }
        for (var n = 0; n < NETWORKS.length; n++) {
            this._seen[n]       = false;
            this._rssi[n]       = NETWORKS[n].rssi;
            this._rssiTarget[n] = NETWORKS[n].rssi;
        }
        this._dwellCh   = -1;
        this._dwellBase = 0;
        this._sel       = -1;
        this._lastTs = Date.now();
        // Back to SSID mode (the button exists only after the first
        // construction-time reset).
        this._mode  = 'ssid';
        this._chSel = 0;
        if (this._modeBtn) this._modeBtn.text = 'Channels';
    };

    // Switch between SSID mode (arcs selectable, network pill) and
    // Channels mode (bars selectable, channel pill). Entering Channels
    // mode lands on the selected network's channel.
    WifiScannerV2DemoScene.prototype._setMode = function(mode) {
        var chMode = (mode === 'ch');
        this._mode = mode;
        // Label names the OTHER mode — the one a press switches to.
        this._modeBtn.text = chMode ? 'SSID' : 'Channels';
        if (chMode && this._sel >= 0) this._chSel = NETWORKS[this._sel].ch - 1;
        if (window.requestRender) window.requestRender();
    };

    // Fresh scan every time the screen is opened.
    WifiScannerV2DemoScene.prototype.enter = function() {
        this._reset();
    };

    WifiScannerV2DemoScene.prototype.handleInput = function(action) {
        var self = this;
        // Pop-up owns input while open. Warning mock on top of it:
        // Back/ESC returns to the pop-up, everything else is swallowed.
        if (this._popup) {
            if (this._warning) {
                if (action === 'back' || action === 'esc') {
                    this._warning = false;
                    if (window.requestRender) window.requestRender();
                }
                return;
            }
            if (action === 'edit' && this._popup.warn) {
                // Help (weak-security networks only): flash, then show
                // the full-screen warning mock.
                this._pressButton(this._helpBtn, function() { self._warning = true; });
            } else if (action === 'del') {
                // More (toggle): flash, then close the pop-up.
                this._pressButton(this._moreBtn, function() { self._closePopup(); });
            } else if (action === 'back' || action === 'esc') {
                this._closePopup();
            }
            return;
        }
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'left' || action === 'right') {
            // SSID mode walks the arcs, Channels mode walks the bars.
            var dir = (action === 'right') ? 1 : -1;
            if (this._mode === 'ch') this._chSel = (this._chSel + dir + CH_COUNT) % CH_COUNT;
            else this._moveSelection(dir);
            if (window.requestRender) window.requestRender();
            return;
        }
        if (action === 'edit') {
            // Mode toggle: flash, then flip SSID ↔ Channels.
            this._pressButton(this._modeBtn, function() {
                self._setMode(self._mode === 'ch' ? 'ssid' : 'ch');
            });
            return;
        }
        if (action === 'del') {
            // More: flash, then open the details pop-up for the
            // selected network (SSID mode, and only once one has been
            // heard); in Channels mode it just flashes for now.
            var net = (this._mode === 'ssid' && this._sel >= 0) ? NETWORKS[this._sel] : null;
            this._pressButton(this._moreBtn, function() {
                if (net) { self._popup = net; self._moreBtn.toggled = true; }
            });
            return;
        }
    };

    WifiScannerV2DemoScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        var ctx = canvas.ctx;
        if (typeof UI !== 'undefined' && UI.drawStatusBar) {
            UI.drawStatusBar(canvas, '');
        }
        // Title strip — same geometry as v1 / MeshCore: gray band
        // under the status bar, 14×14 icon at x=2, name in Sporty.
        var TITLE_Y = UI.STATUS_BAR_H;
        ctx.fillStyle = '#D9D9D9';
        ctx.fillRect(0, TITLE_Y, canvas.w, TITLE_H);
        canvas.drawSprite(Icons.wi_fi_scanner, 2, TITLE_Y + 1, '#000');
        Born2bSportyV2FlipCTL.draw(ctx, this.displayName, 19, TITLE_Y, '#000');

        // Strip centre: the band being scanned (2.4 GHz — channels
        // 1–14 live at 2400–2483.5 MHz; "band" is the frequency
        // range, "range" in Wi-Fi speak would mean coverage).
        var bandW = HaxrCorp4090FlipCTL.textWidth(BAND_LABEL);
        HaxrCorp4090FlipCTL.draw(ctx, BAND_LABEL,
            Math.floor((canvas.w - bandW) / 2), TITLE_Y + 3, '#000');

        // Strip status, right-aligned like Update's "N commits back":
        // how many BSSIDs the scanner has heard so far.
        var found = 0;
        for (var s = 0; s < NETWORKS.length; s++) if (this._seen[s]) found++;
        var foundText = found + ' BSSID found';
        HaxrCorp4090FlipCTL.draw(ctx, foundText,
            canvas.w - 2 - HaxrCorp4090FlipCTL.textWidth(foundText), TITLE_Y + 3, '#000');

        // Channel numbers 1..14, each centred on its evenly spaced slot.
        for (var i = 0; i < CH_COUNT; i++) {
            var label = String(i + 1);
            var cx = slotX(i);
            var w  = HaxrCorp4090FlipCTL.textWidth(label);
            HaxrCorp4090FlipCTL.draw(ctx, label, cx - Math.floor(w / 2), CH_Y, '#000');
        }

        // Scanner state: the channel we dwell on takes a fresh
        // reading — its bar eases toward the live rate (with a
        // per-frame wobble so it flickers like a real counter);
        // every other channel keeps its last reading.
        var now = Date.now();
        var cur = Math.floor(now / CURSOR_DWELL_MS) % CH_COUNT;
        var dt  = Math.min(100, Math.max(0, now - this._lastTs));
        this._lastTs = now;
        var reading = channelRate(cur, now) * (1 + JITTER * (Math.random() * 2 - 1));
        var k = 1 - Math.exp(-dt / BAR_EASE_MS);
        if (cur !== this._dwellCh) {
            // New dwell — remember where this bar started so heat
            // reflects net growth over the dwell, not reading wobble.
            this._dwellCh   = cur;
            this._dwellBase = this._pps[cur];
            // Every network audible from this channel is heard: it
            // becomes visible and gets a fresh RSSI reading (fading).
            for (var n = 0; n < NETWORKS.length; n++) {
                if (Math.abs((NETWORKS[n].ch - 1) - cur) <= audibleRange(NETWORKS[n])) {
                    this._seen[n] = true;
                    this._rssiTarget[n] = NETWORKS[n].rssi
                        + RSSI_JITTER_DB * (Math.random() * 2 - 1);
                    // The very first network heard becomes the
                    // selection, so there is always one highlighted.
                    if (this._sel < 0) this._sel = n;
                }
            }
        }
        this._pps[cur] += (reading - this._pps[cur]) * k;
        var kr = 1 - Math.exp(-dt / RSSI_EASE_MS);
        for (var n2 = 0; n2 < NETWORKS.length; n2++) {
            this._rssi[n2] += (this._rssiTarget[n2] - this._rssi[n2]) * kr;
        }

        // Heat: everything cools exponentially; the dwelt channel
        // re-heats in proportion to how much its bar has grown.
        var cool = Math.exp(-dt / HEAT_DECAY_MS);
        for (var c2 = 0; c2 < CH_COUNT; c2++) this._heat[c2] *= cool;
        var grown = this._pps[cur] - this._dwellBase;
        if (HEAT_ENABLED && grown > 0) {
            this._heat[cur] = Math.max(this._heat[cur], Math.min(1, grown / HEAT_FULL_DELTA));
        }

        // pkt/s bars — one per channel, standing on BAR_BOTTOM. Rest
        // tone is BAR_COLOR; heat darkens a bar toward black; in
        // Channels mode the selected channel's bar is solid black.
        var chMode = (this._mode === 'ch');
        for (var b = 0; b < CH_COUNT; b++) {
            var h = Math.min(BAR_MAX_H, Math.round(this._pps[b] / PPS_PER_PX));
            if (h <= 0) continue;
            var gv = Math.round(BAR_GRAY * (1 - this._heat[b]));
            ctx.fillStyle = (chMode && b === this._chSel)
                ? BAR_SEL_COLOR : 'rgb(' + gv + ',' + gv + ',' + gv + ')';
            ctx.fillRect(slotX(b) - Math.floor(BAR_W / 2), BAR_BOTTOM - h, BAR_W, h);
        }

        // Network arcs over the bars — only the ones heard so far. In
        // SSID mode the selected one is drawn last, black, 2-px stroke,
        // with its info pill; in Channels mode all arcs stay gray.
        var selArc = (!chMode && this._sel >= 0 && this._seen[this._sel]) ? this._sel : -1;
        for (var a = 0; a < NETWORKS.length; a++) {
            if (!this._seen[a] || a === selArc) continue;
            var net = NETWORKS[a];
            drawArc(ctx, slotX(net.ch - 1), BAR_BOTTOM - 1,
                arcRadiusX(net), arcHeight(this._rssi[a]), ARC_COLOR);
        }
        if (selArc >= 0) {
            var snet = NETWORKS[selArc];
            var scx = slotX(snet.ch - 1), srx = arcRadiusX(snet), sry = arcHeight(this._rssi[selArc]);
            drawArc(ctx, scx, BAR_BOTTOM - 1, srx, sry, ARC_SEL_COLOR);
            drawArc(ctx, scx, BAR_BOTTOM - 1, srx - 1, Math.max(0, sry - 1), ARC_SEL_COLOR);

            // Pill above the apex: [lock] name (Helvb08) + RSSI / tag
            // (Haxrcorp) [+ warning icon for weak security].
            var items = [];
            if (snet.sec !== 'OPEN') {
                items.push({ icon: Icons.lock_icon_8px, dy: LABEL_LOCK_DY });
                items.push({ gap: LABEL_ICON_GAP });
            }
            items.push({ text: snet.ssid || HIDDEN_LABEL, font: Helvb08Regular, dy: LABEL_NAME_DY });
            items.push({ text: '  ' + Math.round(this._rssi[selArc]) + ' dBm  ' + snet.sec,
                         font: HaxrCorp4090FlipCTL });
            if (snet.warn) {
                items.push({ gap: LABEL_ICON_GAP });
                items.push({ icon: Icons.warning_icon, dy: LABEL_WARN_DY });
            }
            drawInfoPill(canvas, scx, BAR_BOTTOM - 1 - sry, items);
        }

        // Channels mode: the pill sits on the selected channel's bar —
        // "Ch N", its last pkt/s reading, and how many of the networks
        // heard so far call this their primary channel.
        if (chMode) {
            var ci  = this._chSel;
            var chH = Math.min(BAR_MAX_H, Math.round(this._pps[ci] / PPS_PER_PX));
            var onCh = 0;
            for (var q = 0; q < NETWORKS.length; q++) {
                if (this._seen[q] && NETWORKS[q].ch - 1 === ci) onCh++;
            }
            drawInfoPill(canvas, slotX(ci), BAR_BOTTOM - chH, [
                { text: 'Ch ' + (ci + 1), font: Helvb08Regular, dy: LABEL_NAME_DY },
                { text: '  ' + Math.round(this._pps[ci]) + ' pkt/s  ' + onCh + ' SSID',
                  font: HaxrCorp4090FlipCTL }
            ]);
        }

        // Cursor over the channel being scanned right now.
        ctx.fillStyle = CURSOR_COLOR;
        ctx.fillRect(slotX(cur) - Math.floor(CURSOR_W / 2), CURSOR_Y, CURSOR_W, CURSOR_H);

        // Bottom buttons (main screen only; the pop-up brings its own
        // pair).
        if (!this._popup) {
            this._modeBtn.render(canvas);
            this._moreBtn.render(canvas);
        }

        // Details pop-up layers: wash → pop-up → View (toggled) and
        // Help (pulsing) above the wash → optional warning mock over
        // another wash (Help hidden while it's up). Same as v1.
        if (this._popup) {
            ctx.fillStyle = POPUP_WASH;
            ctx.fillRect(0, 0, canvas.w, canvas.h);
            drawPopup(canvas, this._popup, this._rssi[this._sel]);
            this._moreBtn.render(canvas);
            // Help exists only for weak-security (WEP) networks.
            if (this._popup.warn && !this._warning) {
                this._helpBtn.render(canvas);
                if (!this._helpBtn.pressed) {
                    var phase = (Date.now() % HELP_PULSE_MS) / HELP_PULSE_MS;
                    var pulse = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);   // 0..1
                    var bx = this._helpBtn.x, bw = this._helpBtn.w;
                    var by = canvas.h - BTN_H;
                    ctx.fillStyle = 'rgba(0, 0, 0, ' + (HELP_PULSE_MAX_BLACK * pulse) + ')';
                    ctx.fillRect(bx + 3, by + 1, bw - 6, 1);
                    ctx.fillRect(bx + 2, by + 2, bw - 4, 1);
                    ctx.fillRect(bx + 1, by + 3, bw - 2, BTN_H - 3);
                    var lv = Math.round(255 * pulse);
                    var label = this._helpBtn.text;
                    var lw = HaxrCorp4090FlipCTL.textWidth(label);
                    HaxrCorp4090FlipCTL.draw(ctx, label,
                        bx + Math.floor((bw - lw) / 2), by + 2,
                        'rgb(' + lv + ',' + lv + ',' + lv + ')');
                }
            }
            if (this._warning) {
                var wimg = loadImage(WARNING_IMG_SRC);
                if (imageReady(wimg)) {
                    ctx.fillStyle = POPUP_WASH;
                    ctx.fillRect(0, 0, canvas.w, canvas.h);
                    ctx.drawImage(wimg, 0, 0, canvas.w, canvas.h);
                }
            }
        }

        // Keep hopping while on screen.
        if (window.requestRender) window.requestRender();
    };

    // Details pop-up for `net` (live RSSI passed in). Tab first, frame
    // over its bottom 4 px, then the content.
    function drawPopup(canvas, net, rssi) {
        var ctx  = canvas.ctx;
        var name = net.ssid || HIDDEN_LABEL;
        var secured = net.sec !== 'OPEN';

        // Name tab: [lock] + SSID in white Sporty on black.
        var nameW = Born2bSportyV2FlipCTL.textWidth(name);
        var lockW = secured ? Icons.lock_icon_8px.w + POPUP_TAB_LOCK_GAP : 0;
        var tabW  = lockW + nameW + 2 * POPUP_TAB_PAD_X;
        new ResponsiveFrame({
            x: POPUP_X, y: POPUP_TAB_Y, width: tabW, height: POPUP_TAB_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: true, strokeColor: '#000',
            showFill: true, fillColor: '#000',
            cornerRadius: POPUP_RADIUS
        }).render(canvas);
        var tx = POPUP_X + POPUP_TAB_PAD_X;
        if (secured) {
            canvas.drawSprite(Icons.lock_icon_8px, tx, POPUP_TAB_Y + POPUP_TAB_LOCK_DY, '#fff');
            tx += lockW;
        }
        Born2bSportyV2FlipCTL.draw(ctx, name, tx, POPUP_TAB_Y + POPUP_TAB_TEXT_DY, '#fff');

        // Main frame last so it covers the tab's bottom 4 px.
        new ResponsiveFrame({
            x: POPUP_X, y: POPUP_Y, width: POPUP_W, height: POPUP_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: true, strokeColor: '#000',
            showFill: true, fillColor: '#fff',
            cornerRadius: POPUP_RADIUS
        }).render(canvas);

        // Signal block: icon + "Signal level: <rssi> dBm" / band + channel.
        var r = Math.round(rssi);
        drawWifiSegments(canvas, Icons.wi_fi_icon_22px,
            POPUP_X + POPUP_ICON_DX, POPUP_Y + POPUP_ICON_DY, signalArcs(r));
        var cx = POPUP_X + POPUP_TEXT_DX;
        var sy = POPUP_Y + POPUP_SIGNAL_DY;
        var lbl = 'Signal level: ';
        HaxrCorp4090FlipCTL.draw(ctx, lbl, cx, sy, POPUP_DIM);
        HaxrCorp4090FlipCTL.draw(ctx, r + ' dBm', cx + HaxrCorp4090FlipCTL.textWidth(lbl), sy, '#000');
        HaxrCorp4090FlipCTL.draw(ctx, BAND_SHORT + '  Channel ' + net.ch, cx, POPUP_Y + POPUP_BAND_DY, POPUP_DIM);

        // Label / value rows.
        var rows = [
            ['Security:', net.sec],
            ['Protocol:', net.proto],
            ['BSSID:',    net.bssid]
        ];
        for (var i = 0; i < rows.length; i++) {
            var ry = POPUP_Y + POPUP_ROW_DY[i];
            HaxrCorp4090FlipCTL.draw(ctx, rows[i][0], POPUP_X + POPUP_LABEL_DX, ry, POPUP_DIM);
            HaxrCorp4090FlipCTL.draw(ctx, rows[i][1], POPUP_X + POPUP_VALUE_DX, ry, '#000');
            if (i === 0 && net.warn) {
                canvas.drawSprite(Icons.warning_icon,
                    POPUP_X + POPUP_VALUE_DX + HaxrCorp4090FlipCTL.textWidth(rows[i][1]) + POPUP_WARN_GAP,
                    ry + POPUP_WARN_DY, '#000');
            }
        }
    }

    // Black info pill centred on `cx` with its bottom LABEL_GAP px
    // above `anchorY`, kept inside the screen and under the strip.
    // `items` left → right: {text, font, dy?} (dy on top of
    // LABEL_CONTENT_DY), {icon, dy} (dy from the pill top), {gap}.
    // Text and icons are white on the black fill.
    function drawInfoPill(canvas, cx, anchorY, items) {
        var ctx = canvas.ctx;
        var w = 0;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.text != null)  w += it.font.textWidth(it.text);
            else if (it.icon)     w += it.icon.w;
            else                  w += it.gap;
        }
        var lw = w + 2 * LABEL_PAD_X;
        var lx = cx - Math.floor(lw / 2);
        lx = Math.max(LABEL_SIDE_PAD, Math.min(canvas.w - LABEL_SIDE_PAD - lw, lx));
        var ly = Math.max(LABEL_MIN_Y, anchorY - LABEL_GAP - LABEL_H);
        new ResponsiveFrame({
            x: lx, y: ly, width: lw, height: LABEL_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: false,
            showFill: true, fillColor: LABEL_FILL,
            cornerRadius: 3
        }).render(canvas);
        var tx = lx + LABEL_PAD_X;
        for (var j = 0; j < items.length; j++) {
            var el = items[j];
            if (el.text != null) {
                el.font.draw(ctx, el.text, tx, ly + LABEL_CONTENT_DY + (el.dy || 0), LABEL_TEXT);
                tx += el.font.textWidth(el.text);
            } else if (el.icon) {
                canvas.drawSprite(el.icon, tx, ly + el.dy, LABEL_TEXT);
                tx += el.icon.w;
            } else {
                tx += el.gap;
            }
        }
    }

    return WifiScannerV2DemoScene;
})();
