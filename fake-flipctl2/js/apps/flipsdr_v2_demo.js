/**
 * FlipSdrV2DemoScene
 *
 * Testing → Kickstarter demo → FlipSDR → 'Version 2'. Standalone fake
 * (no code shared with Version 1, flipsdr_demo.js): just the spectrum
 * of a 128 kHz slice of the 10 m band — no waterfall, no tuning.
 *
 *   - A fake status bar on top (Wi-Fi only, full signal; battery
 *     69 %), drawn here rather than from live device state so the
 *     footage always looks the same. Then a frequency strip right under it in
 *     Version 1's style (gray band, white kHz labels), a bit taller,
 *     with the centre frequency in Helvb08 on a black pill.
 *   - Spectrum (one 1 px bar per 0.5 kHz; dark gray fill under a black
 *     top line, like Version 1's spectrum) standing on a
 *     tick ruler above the buttons, as if walking around the house
 *     with a spectrum analyser: a rolling landscape of broad humps
 *     (the room's RF hash) whose levels rise and fall as you get closer
 *     to / further from each source, plus "devices" — medium-width
 *     peaks that pop up in random spots, hold a few seconds (some
 *     buzzing like a switching supply) and fade out. Fine bar-to-bar
 *     ripple, no lone 1 px spikes.
 *   - Version 1's bottom buttons (View — Bookmark there — / Edit / Scan), press
 *     flash only.
 *
 * Back pops.
 */
var FlipSdrV2DemoScene = (function() {
    var W = 256;

    // Frequency window: 28.000–28.128 MHz, one 1 px bar per 0.5 kHz.
    var START_KHZ = 28000;
    var SPAN_KHZ  = 128;
    var BINS      = W;                           // 256 bars
    var PX_PER_KHZ = W / SPAN_KHZ;               // 2
    var CX        = 128;                         // centre column

    // Frequency strip: 12 gray rows under the status bar, white
    // Haxrcorp labels every LABEL_KHZ (ink rows +2..+8), the centre
    // frequency in Helvb08 (caps +2..+9) on a black pill of the same
    // height with white < > arrows inside its ends (Version 1's selected
    // pill), PILL_PAD_X px from each pill edge to the digits.
    var STRIP_Y   = UI.STATUS_BAR_H;             // 13
    var STRIP_H   = 12;
    var COL_STRIP = '#C0C0C0';
    var LABEL_KHZ = 32;
    var PILL_PAD_X = 11;
    var ARROW_DX   = 2;                          // pill edge → arrow tip
    var ARROW_K    = 4;                          // arrow depth (px), 8 rows tall

    // Spectrum: bars stand on SPEC_BASE, right on the ruler line, at
    // most SPEC_MAX_H tall (up to 1 px under the strip).
    var SPEC_TOP   = STRIP_Y + STRIP_H + 1;      // 26
    var RULER_Y    = 120;                        // ruler line
    var SPEC_BASE  = RULER_Y;                    // first row under the bars
    var SPEC_MAX_H = SPEC_BASE - SPEC_TOP;       // 94
    var COL_SPEC_FILL = '#404040';               // under the black top line
    // Ruler ticks hang under the line: a minor one every TICK_STEP px
    // (2 kHz), a major one every TICK_MAJOR_EVERY ticks (16 kHz).
    var TICK_STEP        = 4;
    var TICK_MAJOR_EVERY = 8;
    var TICK_MINOR_H     = 3;
    var TICK_MAJOR_H     = 6;

    // Animation.
    var FRAME_MS = 50;
    var SMOOTH   = 0.35;                         // share of the new frame per tick

    // Landscape: a floor (FLOOR_H with slow drifting waves) plus broad
    // humps summed on top — positions / half-widths in px. Each hump's
    // height breathes between (1 - BREATHE) and 1 of h and its centre
    // drifts up to DRIFT_PX, at its own speed `sp` and phase `ph`; on
    // top of that a "proximity" gain wanders between GAIN_RANGE (you
    // walk towards / away from the source), easing to a new random
    // target every GAIN_HOLD_MS.
    // Per-bar jitter (±JITTER_PX) is smoothed over neighbours, so the
    // top edge ripples finely instead of throwing single spikes.
    var FLOOR_H   = 20;
    var JITTER_PX = 9;
    var BREATHE   = 0.3;
    var DRIFT_PX  = 3;
    var GAIN_RANGE   = [0.35, 1.35];
    var GAIN_HOLD_MS = [1200, 3500];
    var GAIN_EASE    = 0.06;                     // per tick toward the target
    var HUMPS = [
        { at: 28,  w: 9,  h: 20, sp: 0.0011, ph: 0.0 },
        { at: 60,  w: 12, h: 48, sp: 0.0008, ph: 1.3 },
        { at: 92,  w: 16, h: 40, sp: 0.0007, ph: 2.1 },
        { at: 122, w: 7,  h: 34, sp: 0.0013, ph: 0.6 },
        { at: 146, w: 6,  h: 22, sp: 0.0010, ph: 3.4 },
        { at: 178, w: 14, h: 18, sp: 0.0006, ph: 4.0 },
        { at: 222, w: 26, h: 50, sp: 0.0005, ph: 5.2 }
    ];

    // Devices: up to DEVICE_COUNT peaks alive at once, each a bell of
    // half-width DEVICE_W px and height DEVICE_H at a random spot. A
    // device fades in over DEVICE_FADE_MS, holds DEVICE_HOLD_MS, fades
    // out, then respawns elsewhere after DEVICE_GAP_MS. Some buzz
    // (fast amplitude flicker, like a switching power supply).
    var DEVICE_COUNT   = 5;
    var DEVICE_W       = [2, 5];
    var DEVICE_H       = [14, 44];
    var DEVICE_FADE_MS = 300;
    var DEVICE_HOLD_MS = [1200, 4000];
    var DEVICE_GAP_MS  = [300, 2500];
    var DEVICE_BUZZ_CHANCE = 0.4;

    function FlipSdrV2DemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'FlipSDR';
        this.breadcrumbTitle = 'FlipSDR';
        this._shown = [];                        // smoothed bar heights per bin
        for (var i = 0; i < BINS; i++) this._shown.push(FLOOR_H);
        // Per-hump proximity gain (current, target, next retarget time).
        this._gains = HUMPS.map(function() { return { g: 1, to: 1, next: 0 }; });
        this._devices = [];
        for (var d = 0; d < DEVICE_COUNT; d++) this._devices.push({ born: 0, until: 0 });
        this._timer = null;
        this._t0 = 0;

        // Version 1's bottom buttons, inert (press flash only).
        this._modeBtn = new UI.MiddleToggleButton('View', 1, 48, 2, 'edit', null, false);
        this._editBtn = new UI.MiddleButton('Edit', 3, 48, 2, 'del');
        this._scanBtn = new UI.RightButton('Scan', 48, 'run', null, 256);
        this._modeBtn.x = 52;
        this._editBtn.x = 156;
        this._btns = [this._modeBtn, this._editBtn, this._scanBtn];
    }

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    function rand(range) {
        return range[0] + Math.random() * (range[1] - range[0]);
    }

    // (Re)spawn device dv at a random spot, starting at `now` + gap.
    function spawnDevice(dv, now, gap) {
        dv.at    = Math.random() * BINS;
        dv.w     = rand(DEVICE_W);
        dv.h     = rand(DEVICE_H);
        dv.buzz  = Math.random() < DEVICE_BUZZ_CHANCE;
        dv.born  = now + gap;
        dv.until = dv.born + 2 * DEVICE_FADE_MS + rand(DEVICE_HOLD_MS);
    }

    // Device dv's height factor 0..1 at `now` (fade in / hold / fade out).
    function deviceLevel(dv, now) {
        if (now < dv.born || now >= dv.until) return 0;
        var lv = Math.min(1, (now - dv.born) / DEVICE_FADE_MS, (dv.until - now) / DEVICE_FADE_MS);
        if (dv.buzz) lv *= 0.55 + 0.45 * Math.random();
        return lv;
    }

    // Floor height (px) at bar x, time t (ms).
    function floorAt(x, t) {
        return FLOOR_H
            + 4 * Math.sin(x * 0.03 + t * 0.0005)
            + 3 * Math.sin(x * 0.08 - t * 0.0008);
    }

    // Summed hump height (px) at bar x, time t, with proximity gains.
    function humpsAt(x, t, gains) {
        var sum = 0;
        for (var j = 0; j < HUMPS.length; j++) {
            var hp = HUMPS[j];
            var c = hp.at + DRIFT_PX * Math.sin(t * hp.sp * 0.7 + hp.ph);
            var d = (x - c) / hp.w;
            if (d > 3 || d < -3) continue;
            var amp = hp.h * gains[j].g * (1 - BREATHE * (0.5 + 0.5 * Math.sin(t * hp.sp + hp.ph)));
            sum += amp * Math.exp(-0.5 * d * d);
        }
        return sum;
    }

    FlipSdrV2DemoScene.prototype._tick = function() {
        var now = Date.now();
        var t = now - this._t0;
        var x, j;
        // Walk: each source drifts closer / further.
        for (j = 0; j < this._gains.length; j++) {
            var gn = this._gains[j];
            if (now >= gn.next) {
                gn.to = rand(GAIN_RANGE);
                gn.next = now + rand(GAIN_HOLD_MS);
            }
            gn.g += (gn.to - gn.g) * GAIN_EASE;
        }
        // Devices popping up and fading out.
        var levels = [];
        for (j = 0; j < this._devices.length; j++) {
            var dv = this._devices[j];
            if (now >= dv.until) spawnDevice(dv, now, rand(DEVICE_GAP_MS));
            levels.push(deviceLevel(dv, now));
        }
        var raw = [];
        for (x = 0; x < BINS; x++) {
            var v0 = floorAt(x, t) + humpsAt(x, t, this._gains);
            for (j = 0; j < this._devices.length; j++) {
                if (!levels[j]) continue;
                var dd = (x - this._devices[j].at) / this._devices[j].w;
                if (dd > 3 || dd < -3) continue;
                v0 += this._devices[j].h * levels[j] * Math.exp(-0.5 * dd * dd);
            }
            raw.push(v0 + (Math.random() * 2 - 1) * JITTER_PX);
        }
        for (x = 0; x < BINS; x++) {
            var l = raw[Math.max(0, x - 1)], r = raw[Math.min(BINS - 1, x + 1)];
            var target = (l + 2 * raw[x] + r) / 4;
            var v = this._shown[x] + (target - this._shown[x]) * SMOOTH;
            this._shown[x] = Math.max(1, Math.min(SPEC_MAX_H, v));
        }
        repaint();
    };

    FlipSdrV2DemoScene.prototype.enter = function() {
        if (this._timer) return;
        var self = this;
        if (!this._t0) {
            this._t0 = Date.now();
            // Stagger the first devices so they don't all pop at once.
            for (var d = 0; d < this._devices.length; d++) {
                spawnDevice(this._devices[d], this._t0, rand([0, 3000]));
            }
        }
        this._tick();
        this._timer = setInterval(function() { self._tick(); }, FRAME_MS);
    };

    FlipSdrV2DemoScene.prototype.exit = function() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    };

    // 30 ms press flash, like the other apps' buttons.
    FlipSdrV2DemoScene.prototype._flash = function(btn) {
        btn.press();
        repaint();
        setTimeout(function() { btn.release(); repaint(); }, 30);
    };

    FlipSdrV2DemoScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'edit') { this._flash(this._modeBtn); return; }
        if (action === 'del')  { this._flash(this._editBtn); return; }
        if (action === 'run')  { this._flash(this._scanBtn); return; }
    };

    // Pill in Version 1's shape (rounded, 2 px corners) centred on
    // column cx: black, the frequency in white Helvb08 (caps 2 rows below
    // the top, 2 above the bottom of the 12-row pill), and white 1 px
    // < > chevrons spanning the caps rows (tip on the two middle rows,
    // since the pill height is even).
    function drawPill(ctx, cx, y, h, text) {
        var tw = Helvb08Regular.textWidth(text);
        var w = tw + 2 * PILL_PAD_X;
        if (w % 2 === 0) w += 1;                 // odd → symmetric on cx
        var x = cx - (w - 1) / 2;
        ctx.fillStyle = '#000';
        ctx.fillRect(x + 2, y, w - 4, h);
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
        ctx.fillRect(x, y + 2, w, h - 4);
        Helvb08Regular.draw(ctx, text, cx - Math.floor(tw / 2), y + 1, '#fff');
        ctx.fillStyle = '#fff';
        var top = y + h / 2 - 1;                 // upper tip row
        for (var k = 0; k < ARROW_K; k++) {
            var lx = x + ARROW_DX + k, rx = x + w - 1 - ARROW_DX - k;
            ctx.fillRect(lx, top - k, 1, 1);     // <
            ctx.fillRect(lx, top + 1 + k, 1, 1);
            ctx.fillRect(rx, top - k, 1, 1);     // >
            ctx.fillRect(rx, top + 1 + k, 1, 1);
        }
    }

    // Fake status bar: same pixels as UI.drawStatusBar (black bar, white
    // glyphs, 3 px top pad) but with fixed state — only Wi-Fi connected
    // at full signal, battery at FAKE_BATTERY %, not charging.
    var FAKE_BATTERY = 69;
    function drawFakeStatusBar(canvas) {
        var ctx = canvas.ctx;
        var top = 3;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, UI.STATUS_BAR_H);
        if (Icons.wifi_100) canvas.drawSprite(Icons.wifi_100, 2, top, '#fff');
        var pct = FAKE_BATTERY + '%';
        var bat = StatusBarBattery.sprite;
        var bx = W - 2 - bat.w;
        HaxrCorp4090FlipCTL.draw(ctx, pct, bx - 1 - HaxrCorp4090FlipCTL.textWidth(pct), top - 2, '#fff');
        canvas.drawSprite(bat, bx, top - 1, '#fff');
        // Level bar inside the sprite: 10×5 at 100 %.
        ctx.fillStyle = '#fff';
        ctx.fillRect(bx + 2, top + 1, Math.round(10 * FAKE_BATTERY / 100), 5);
    }

    function khzLabel(khz) {
        return (khz / 1000).toFixed(3);
    }

    FlipSdrV2DemoScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        canvas.clear('#fff');

        // Spectrum, Version 1 style: a fill just lighter than black under
        // a 1 px black line along the top, joined column to column so
        // steep slopes stay connected.
        var tops = [];
        var i;
        for (i = 0; i < BINS; i++) tops.push(SPEC_BASE - Math.round(this._shown[i]));
        ctx.fillStyle = COL_SPEC_FILL;
        for (i = 0; i < BINS; i++) ctx.fillRect(i, tops[i], 1, SPEC_BASE - tops[i]);
        ctx.fillStyle = '#000';
        for (i = 0; i < BINS; i++) {
            var prev = i > 0 ? tops[i - 1] : tops[i];
            var hi = Math.min(prev, tops[i]), lo = Math.max(prev, tops[i]);
            if (lo - hi > 1) ctx.fillRect(i, hi + 1, 1, lo - hi);
            ctx.fillRect(i, tops[i], 1, 1);
        }

        drawFakeStatusBar(canvas);

        // Frequency strip with labels, centre pill on top.
        ctx.fillStyle = COL_STRIP;
        ctx.fillRect(0, STRIP_Y, W, STRIP_H);
        for (var f = START_KHZ; f <= START_KHZ + SPAN_KHZ; f += LABEL_KHZ) {
            var lx = (f - START_KHZ) * PX_PER_KHZ;
            var label = khzLabel(f);
            var lw = HaxrCorp4090FlipCTL.textWidth(label);
            HaxrCorp4090FlipCTL.draw(ctx, label, lx - Math.floor(lw / 2) - 1, STRIP_Y, '#fff');
        }
        drawPill(ctx, CX, STRIP_Y, STRIP_H, khzLabel(START_KHZ + SPAN_KHZ / 2));

        // Ruler under the spectrum.
        ctx.fillStyle = '#000';
        ctx.fillRect(0, RULER_Y, W, 1);
        for (var x = 0, n = 0; x < W; x += TICK_STEP, n++) {
            var th = (n % TICK_MAJOR_EVERY === 0) ? TICK_MAJOR_H : TICK_MINOR_H;
            ctx.fillRect(x, RULER_Y + 1, 1, th);
        }

        for (var b = 0; b < this._btns.length; b++) this._btns[b].render(canvas);
    };

    return FlipSdrV2DemoScene;
})();
