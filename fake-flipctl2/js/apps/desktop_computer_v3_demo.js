/**
 * DesktopComputerV3DemoScene
 *
 * Testing → Kickstarter demo → All → Desktop computer → 'Version 3', and
 * Kickstarter demo → Selected → 'Desktop Mode'. Built on
 * Version 1, standalone (no code shared with it or with
 * KickstarterConnectDemo):
 *
 *   • Disconnected — the "plug in the cable" clip loops: a Flipper with a
 *     USB-C cable bobbing at its port (display_port_connect_v008.mp4,
 *     cable only; the Flipper is display_port_outline_100.png laid over
 *     it at an adjustable opacity), under a status bar (battery 69 %) and
 *     "Plug in Display Port" / "Waiting for connection" on the right.
 *   • Connected    — the happy monitor loop (bounce and a glare;
 *     desktop_mode/desktop_connected_dip_256x144_h264.mp4), from its
 *     first frame on every connect, with "Desktop Mode" over it in
 *     Version 1's title font and place, and the same status bar as the
 *     waiting state (now charging) over the clip's own.
 *
 * Both clips are pre-rendered sprite sheets (every frame in a cols × rows
 * grid, one rect blitted per frame, so the wrap has no seam), re-fetched
 * on every visit with a cache-busting query so art swapped on disk shows
 * up without reloading the page.
 *
 * Detection, as in Version 1: GET /api/usbc every POLL_MS; ids
 *   'typec:<portN>'  a Type-C partner (the main, earliest signal);
 *   'drm:<conn>'     a display connector reports "connected";
 *   'udc:<name>'     the USB gadget port sees a host;
 *   'psu:<name>'     an external supply is online.
 * The first snapshot is the baseline (built-in hardware); a new id not
 * in it means connected. Baseline ids that disappear are dropped, so a
 * cable already in when the app opened counts once replugged.
 *
 * Power meter LEDs while open: battery outline + one usage tick; once
 * connected the full battery (outline + bolt), 3 USB-C input chevrons
 * and the plug; off on exit.
 *
 * OK toggles a manual "connected" override (preview without hardware,
 * or a backup during a shoot). Up / Down change the Flipper outline's
 * opacity (OUTLINE.min..max % in OUTLINE.step steps, kept for the
 * session) and flash the value in the status bar. Back returns to the
 * previous list.
 *
 * Rebuild the sheets after changing the clips, from assets/desktop_mode/:
 *   ffmpeg -i display_port_connect_v008.mp4 \
 *          -vf format=gray,tile=10x6 -frames:v 1 -update 1 display_port_connect_v008_sheet.png
 *   ffmpeg -i desktop_connected_dip_256x144_h264.mp4 \
 *          -vf format=gray,tile=10x6 -frames:v 1 -update 1 desktop_connected_sheet.png
 */
var DesktopComputerV3DemoScene = (function() {
    var POLL_MS = 150;
    var TYPEC_PORT = null;   // e.g. 'port0' once USB-C1 is identified on the device

    var WAITING = {
        src: 'assets/desktop_mode/display_port_connect_v008_sheet.png',
        frames: 60, cols: 10, fps: 30, w: 256, h: 144,
        dy: 6                                    // drawn 6 px lower than the clip's frame
    };
    // The Flipper over the waiting clip (same frame and dy), opacity in %.
    var OUTLINE = {
        src: 'assets/desktop_mode/display_port_outline_100.png',
        def: 50, min: 30, max: 100, step: 10
    };
    var OUTLINE_LABEL_MS = 1500;                 // how long the % shows after a press
    var outlinePct = OUTLINE.def;                // survives re-entering the scene
    // Overlay on the waiting clip, from the design.
    var TITLE = 'Plug in Display Port', TITLE_X = 112, TITLE_Y = 38;       // Born2bSporty
    var HINT = 'Waiting for connection', HINT_X = 112, HINT_Y = 56;        // Haxrcorp
    var BATTERY_PCT = 69;
    // Power meter LEDs (PowerMeterLeds): battery outline and a one-tick
    // usage bar; once connected (Desktop Mode) the full battery (outline
    // + bolt), 3 USB-C input chevrons and the plug (green: PD).
    var METER_WAITING   = { battery: 'OUTLINE', usage: 1 };
    var METER_CONNECTED = { battery: 'FULL', usage: 1, powerIn: 3, pd: true };
    // Over the connected clip, where Version 1 had "Desktop Computer":
    // Born2bSporty at 2× (caps rows 20..39), centred.
    var CONNECTED_TITLE = 'Desktop Mode', CONNECTED_TITLE_Y = 14, CONNECTED_TITLE_SCALE = 2;
    var CONNECTED = {
        src: 'assets/desktop_mode/desktop_connected_sheet.png',
        frames: 60, cols: 10, fps: 60, w: 256, h: 144
    };

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    function getJson(url, done) {
        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(d) { done(d); })
            .catch(function() { done(null); });
    }

    // Ids present now (see the header), or null on a failed request.
    function readIds(d) {
        if (!d || !d.ok) return null;
        var ids = [], i;
        var typec = d.typec || [], drm = d.drm || [];
        for (i = 0; i < typec.length; i++) {
            if (TYPEC_PORT && typec[i].port !== TYPEC_PORT) continue;
            if (typec[i].partner) ids.push('typec:' + typec[i].port);
        }
        for (i = 0; i < drm.length; i++) {
            if (drm[i].status === 'connected') ids.push('drm:' + drm[i].connector);
        }
        var udc = d.udc || [], power = d.power || [];
        for (i = 0; i < udc.length; i++) {
            if (udc[i].state && udc[i].state !== 'not attached') ids.push('udc:' + udc[i].name);
        }
        for (i = 0; i < power.length; i++) {
            if (power[i].online) ids.push('psu:' + power[i].name);
        }
        return ids;
    }

    // Fake status bar: the same pixels as UI.drawStatusBar with only the
    // battery (BATTERY_PCT) on the right, its charging bolt when
    // `charging` (drawn literally over the icon, as UI.drawBattery does).
    function drawStatusBar(canvas, charging) {
        var ctx = canvas.ctx, top = 3, H = HaxrCorp4090FlipCTL;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.w, UI.STATUS_BAR_H);
        var pct = BATTERY_PCT + '%', bat = StatusBarBattery.sprite, bx = canvas.w - 2 - bat.w;
        H.draw(ctx, pct, bx - 1 - H.textWidth(pct), top - 2, '#fff');
        canvas.drawSprite(bat, bx, top - 1, '#fff');
        ctx.fillStyle = '#fff';
        ctx.fillRect(bx + 2, top + 1, Math.round(10 * BATTERY_PCT / 100), 5);
        if (charging) canvas.drawSpriteLiteral(Icons.charging_status_bar, bx, top - 1);
    }

    function DesktopComputerV3DemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Desktop computer';
        this.breadcrumbTitle = 'Desktop computer';
        this._sheets = {};
        this._baseline = null;     // id -> true, set by the first snapshot
        this._fresh = false;       // a non-baseline id is present
        this._manual = false;      // OK override
        this._connected = false;
        this._t0 = 0;              // start of the clip on screen
        this._pollTimer = null;
        this._frameTimer = null;
        this._labelUntil = 0;      // show the outline % until then
    }

    DesktopComputerV3DemoScene.prototype._load = function(clip) {
        var self = this, img = new Image();
        img.onload = function() { self._sheets[clip.src] = img; repaint(); };
        img.src = clip.src + '?v=' + Date.now();
    };

    DesktopComputerV3DemoScene.prototype.enter = function() {
        var self = this;
        this._load(WAITING);
        this._load(CONNECTED);
        this._load(OUTLINE);
        this._labelUntil = 0;
        this._baseline = null;
        this._fresh = false;
        this._t0 = Date.now();
        this._update();
        var poll = function() {
            getJson('/api/usbc', function(d) {
                if (!self._pollTimer) return;
                var ids = readIds(d);
                if (ids) self._onIds(ids);
            });
        };
        this._pollTimer = setInterval(poll, POLL_MS);
        poll();
        // Both states animate: repaint every frame of the faster clip.
        this._frameTimer = setInterval(repaint, Math.floor(1000 / CONNECTED.fps));
        PowerMeterLeds.start(this._connected ? METER_CONNECTED : METER_WAITING);
        repaint();
    };

    DesktopComputerV3DemoScene.prototype.exit = function() {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
        if (this._frameTimer) { clearInterval(this._frameTimer); this._frameTimer = null; }
        PowerMeterLeds.stop();
    };

    DesktopComputerV3DemoScene.prototype._onIds = function(ids) {
        var present = {}, i;
        for (i = 0; i < ids.length; i++) present[ids[i]] = true;
        if (this._baseline === null) {
            this._baseline = present;
        } else {
            // Forget built-in entries that went away, so a replug counts.
            for (var id in this._baseline) {
                if (!present[id]) delete this._baseline[id];
            }
        }
        var fresh = false;
        for (var p in present) {
            if (!this._baseline[p]) { fresh = true; break; }
        }
        this._fresh = fresh;
        this._update();
    };

    // Each state change restarts its clip from the first frame.
    DesktopComputerV3DemoScene.prototype._update = function() {
        var on = this._fresh || this._manual;
        if (on !== this._connected) {
            this._connected = on;
            this._t0 = Date.now();
            if (this._pollTimer) PowerMeterLeds.start(on ? METER_CONNECTED : METER_WAITING);
            repaint();
        }
    };

    DesktopComputerV3DemoScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'ok') {
            this._manual = !this._manual;
            this._update();
        } else if (action === 'up' || action === 'down') {
            var d = action === 'up' ? OUTLINE.step : -OUTLINE.step;
            outlinePct = Math.max(OUTLINE.min, Math.min(OUTLINE.max, outlinePct + d));
            this._labelUntil = Date.now() + OUTLINE_LABEL_MS;
            repaint();
        }
    };

    DesktopComputerV3DemoScene.prototype.render = function(canvas) {
        var clip = this._connected ? CONNECTED : WAITING;
        var sheet = this._sheets[clip.src];
        if (!sheet || !sheet.complete || !sheet.naturalWidth) { canvas.clear('#fff'); return; }
        var fi = Math.floor((Date.now() - this._t0) * clip.fps / 1000) % clip.frames;
        var dy = clip.dy || 0;
        if (dy) canvas.clear('#fff');
        canvas.ctx.drawImage(sheet,
            (fi % clip.cols) * clip.w, Math.floor(fi / clip.cols) * clip.h,
            clip.w, clip.h, 0, dy, canvas.w, canvas.h);
        var outline = this._sheets[OUTLINE.src];
        if (!this._connected && outline && outline.complete && outline.naturalWidth) {
            var ctx = canvas.ctx, a = ctx.globalAlpha;
            ctx.globalAlpha = a * outlinePct / 100;
            ctx.drawImage(outline, 0, dy);
            ctx.globalAlpha = a;
        }
        var B = Born2bSportyV2FlipCTL;
        // Same status bar in both states (covers the one baked into the
        // connected clip), charging once something is plugged in.
        drawStatusBar(canvas, this._connected);
        if (Date.now() < this._labelUntil) {
            HaxrCorp4090FlipCTL.draw(canvas.ctx, 'Flipper Opacity ' + outlinePct + '%', 2, 1, '#fff');
        }
        if (!this._connected) {
            B.draw(canvas.ctx, TITLE, TITLE_X, TITLE_Y, '#000');
            HaxrCorp4090FlipCTL.draw(canvas.ctx, HINT, HINT_X, HINT_Y, '#000');
        } else {
            var tw = B.textWidth(CONNECTED_TITLE, CONNECTED_TITLE_SCALE);
            B.draw(canvas.ctx, CONNECTED_TITLE, Math.floor((canvas.w - tw) / 2),
                CONNECTED_TITLE_Y, '#000', CONNECTED_TITLE_SCALE);
        }
    };

    return DesktopComputerV3DemoScene;
})();
