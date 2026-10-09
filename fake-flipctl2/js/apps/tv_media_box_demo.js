/**
 * TvMediaBoxDemoScene
 *
 * Testing → Kickstarter demo → 'TV Media Box'. UI clone of the real
 * TVMediaBoxScene for the campaign footage: same chrome, TV remote and
 * keyboard, but no backend except HDMI plug detection, and a trimmed
 * main screen (no Video out / Adjust screen rows).
 *
 *   - Not connected: the device side with its ports (HMDI_BG.png), the
 *     HDMI cable over it (HDMI_cable_transparent.png) bobbing up and
 *     down above the HDMI port, and the port's front lip on top
 *     (HMDI_FG.png), under the status bar + title bar;
 *     right of the cable a gray 'No display connected' headline over a
 *     black 'Plug in HDMI cable' hint. No body frame, no buttons.
 *   - Connected (/api/hdmi `connected`, polled every HDMI_POLL_MS):
 *     the cable first drops into the port (unplugging plays it in
 *     reverse: back to this screen, cable pulled out), then the main screen comes
 *     in: the happy TV appears and bounces like the Desktop computer clip
 *     (body squashes into the stand, springs back with a 1 px
 *     overshoot), the FAKE_RESOLUTION headline, 'CEC: enabled' and
 *     'Running Kodi' fade in, then a white diagonal glare sweeps the
 *     screen once. A selected 'Settings' row (Helvb08) and the
 *     Keyboard + TV remote buttons appear.
 *   - B toggles a manual "connected" override (preview without
 *     hardware), like the other Kickstarter connect demos.
 *   - Remote / Keyboard: press flashes only, nothing sent.
 * Not registered in RunningApps (no App Switcher card / snapshot).
 *
 * Must load after tv_media_box.js (subclasses TVMediaBoxScene).
 */
var TvMediaBoxDemoScene = (function() {
    var HDMI_POLL_MS    = 500;
    // Consecutive 'disconnected' polls before dropping back to
    // 'Not connected' — absorbs the TV's HPD flaps on wake / sleep.
    var HDMI_MISS_LIMIT = 3;
    var FAKE_RESOLUTION = '3840x2160 60Hz';

    var TITLE_H = 16;

    // Not connected: full-screen layers — the device side with its
    // ports (white, opaque), the cable (transparent; plug tip at y 116,
    // 4 px above the HDMI port at y 120), and the port's front lip with
    // the white below it (rows 133..143, x 0..98) hiding the plug as
    // it goes in. The cable bobs up CABLE_BOB_PX and back
    // (easeInOutSine) every CABLE_BOB_MS. On connect it drops from
    // wherever it is to PLUG_DROP_PX below its rest position in PLUG_MS
    // (easeInQuad — fast, like pushing the plug in), and the main
    // screen comes in right after (PLUG_HOLD_MS).
    var BG_SRC        = 'assets/tv_media_box/HMDI_BG.png';
    var FG_SRC        = 'assets/tv_media_box/HMDI_FG.png';
    var CABLE_SRC     = 'assets/tv_media_box/HDMI_cable_transparent.png';
    var CABLE_BOB_PX  = 12;
    var CABLE_BOB_MS  = 2400;
    var PLUG_DROP_PX  = 38;
    var PLUG_MS       = 180;
    var PLUG_HOLD_MS  = 0;
    var PLUG_TOTAL_MS = PLUG_MS + PLUG_HOLD_MS;
    // Unplug (the reverse): the not-connected screen comes back at once
    // with the cable in the port (PLUG_DROP_PX), pulled out to rest in
    // UNPLUG_MS (easeOutQuad — fast start, settles), then it bobs again.
    var UNPLUG_MS     = 220;
    // Hint text centred in the free area right of the cable (it never
    // goes past x = 69 → x 70..255, centre 163), on the screen centre.
    // Born2bSporty headline (ink y+3..y+12), NC_GAP px, HaxrCorp line
    // (ink y+2..y+8): a 23 px block, ink rows 60..82.
    var NC_TITLE = 'No display connected';
    var NC_HINT  = 'Plug in HDMI cable';
    var NC_CX    = 163;
    var NC_GAP   = 6;
    var NC_TITLE_Y = 57;
    var NC_HINT_Y  = NC_TITLE_Y + 3 + 10 + NC_GAP - 2;   // 74
    var NC_GRAY    = '#969696';   // the Desktop computer "sad" gray

    // TV graphic — same spot as the real app. tv_frame rows: 0..36
    // body, 37..41 stand neck, 42 foot.
    var TV_X = 45, TV_Y = 38, TV_W = 61, TV_H = 43;
    var BODY_H = 37, FOOT_ROW = 42, NECK_ROW = 38;
    // TV screen: the transparent inside of the body (1 px border).
    var SCREEN_X = 1, SCREEN_Y = 1, SCREEN_W = 59, SCREEN_H = 35;
    var SCREEN_GRAY = '#EBEBEB';

    // Bounce: body offset per 60 fps frame after connect. Desktop
    // computer's curve (+2 +4 +6 +6 +5 … -1 -1 0) at half amplitude to
    // match the half-size TV; the foot stays put, the neck absorbs it.
    var BOUNCE = [1, 2, 3, 3, 3, 2, 2, 1, 1, 0, -1, -1, 0];
    var FRAME_MS = 1000 / 60;

    // Resolution headline (Born2bSporty, ink y+3..y+12) over the CEC
    // line (HaxrCorp, ink y+2..y+8), both centred on x = 175; the
    // 20 px block is centred in the body frame's interior.
    var INFO_CX = 175;
    var RES_Y   = 47;
    var CEC_Y   = 61;

    // 'Settings' row — the real app's first row slot, always selected.
    var ROW_Y      = 97;
    var SELECTOR_X = 2;
    var SELECTOR_W = 252;
    var SELECTOR_H = 15;

    // Resolution / CEC / 'Running Kodi' fade white → black (Desktop
    // computer's title fade: starts 2 frames in, lasts 6 frames).
    var FADE_DELAY_MS = 33;
    var FADE_MS       = 100;

    // Glare: a solid white '/' band GLARE_W px wide (measured along x)
    // crossing the screen from top-left to bottom-right in GLARE_MS,
    // once the bounce has settled.
    var GLARE_DELAY_MS = 400;
    var GLARE_W        = 22;
    var GLARE_MS       = 450;
    var ANIM_END_MS    = GLARE_DELAY_MS + GLARE_MS;

    // Bottom buttons slide up from below the screen edge on connect
    // (easeOutCubic).
    var BTN_SLIDE_PX = 14;   // button height: fully hidden at start
    var BTN_SLIDE_MS = 300;

    function TvMediaBoxDemoScene(sceneManager) {
        TVMediaBoxScene.call(this, sceneManager);
        this._isApp = false;
    }
    TvMediaBoxDemoScene.prototype = Object.create(TVMediaBoxScene.prototype);
    TvMediaBoxDemoScene.prototype.constructor = TvMediaBoxDemoScene;

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    function loadImg(src) {
        var img = new Image();
        img.onload = repaint;
        img.src = src;
        return img;
    }

    function easeInOutSine(t) {
        return 0.5 - 0.5 * Math.cos(Math.PI * t);
    }

    function gray(v) {
        v = Math.max(0, Math.min(255, Math.round(v)));
        return 'rgb(' + v + ',' + v + ',' + v + ')';
    }

    // ── Lifecycle ─────────────────────────────────────────────────

    TvMediaBoxDemoScene.prototype.enter = function() {
        // Re-entry (e.g. returning from a pushed scene) keeps the state.
        if (this._fakeStarted) { repaint(); return; }
        this._fakeStarted = true;
        this._hdmiReal    = false;   // last real plug state (debounced)
        this._hdmiMisses  = 0;
        this._manual      = false;   // B override
        this._connectAt   = 0;       // 0 = no connect animation
        this._loopStart   = Date.now();
        if (!this._bgImg) {
            this._bgImg    = loadImg(BG_SRC);
            this._fgImg    = loadImg(FG_SRC);
            this._cableImg = loadImg(CABLE_SRC);
        }
        var self = this;
        // Repaint tick for the cable bob (only while it's on screen).
        this._loopTimer = setInterval(function() {
            if (self._hdmiLoaded && !self._hdmiConnected && self._view === 'main') repaint();
        }, 16);
        var poll = function() {
            fetch('/api/hdmi', { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!self._fakeStarted) return;
                    if (data && data.connected) {
                        self._hdmiMisses = 0;
                        self._hdmiReal   = true;
                    } else if (++self._hdmiMisses >= HDMI_MISS_LIMIT) {
                        self._hdmiReal = false;
                    }
                    self._applyHdmi();
                })
                .catch(function() {
                    if (!self._fakeStarted) return;
                    self._applyHdmi();
                });
        };
        poll();
        this._hdmiPollTimer = setInterval(poll, HDMI_POLL_MS);
        repaint();
    };

    TvMediaBoxDemoScene.prototype.exit = function() {
        this._fakeStarted = false;
        if (this._hdmiPollTimer) { clearInterval(this._hdmiPollTimer); this._hdmiPollTimer = null; }
        if (this._connTimer)     { clearInterval(this._connTimer);     this._connTimer     = null; }
        if (this._loopTimer)     { clearInterval(this._loopTimer);     this._loopTimer     = null; }
        if (this._pressTimer)    { clearTimeout(this._pressTimer);     this._pressTimer    = null; }
        if (this._animTimer)     { clearInterval(this._animTimer);     this._animTimer     = null; }
        if (this._backTimer)     { clearTimeout(this._backTimer);      this._backTimer     = null; }
        if (this._kbScreen) {
            if (this._kbScreen.exit) this._kbScreen.exit();
            this._kbScreen = null;
        }
        this._forwardActive = false;
    };

    // Apply the (real or manual) plug state. The very first state is
    // shown as-is; later connects play the connect animation.
    TvMediaBoxDemoScene.prototype._applyHdmi = function() {
        var on = this._hdmiReal || this._manual;
        if (this._hdmiLoaded && on === this._hdmiConnected) return;
        var first = !this._hdmiLoaded;
        this._hdmiLoaded    = true;
        this._hdmiConnected = on;
        this._kodiRunning   = on;
        if (on && !first) this._startConnectAnim();
        else              this._connectAt = 0;
        if (!on) {
            // Pull-out first (not on the very first state), then the bob
            // starts from rest.
            this._unplugAt  = first ? 0 : Date.now();
            this._loopStart = Date.now() + (first ? 0 : UNPLUG_MS);
        }
        repaint();
    };

    // Plug-in drop first (PLUG_TOTAL_MS), then the main screen's connect
    // animation: _connectAt is set that far ahead, so _animT() < 0 means
    // the cable is still going in.
    TvMediaBoxDemoScene.prototype._startConnectAnim = function() {
        this._plugFrom  = this._cableIdleDy();
        this._connectAt = Date.now() + PLUG_TOTAL_MS;
        if (this._connTimer) return;
        var self = this;
        this._connTimer = setInterval(function() {
            if (Date.now() - self._connectAt >= ANIM_END_MS) {
                clearInterval(self._connTimer);
                self._connTimer = null;
                self._connectAt = 0;
            }
            repaint();
        }, 16);
    };

    // ms since the main screen's connect animation started (negative
    // during the plug-in drop), or null when idle.
    TvMediaBoxDemoScene.prototype._animT = function() {
        return this._connectAt ? Date.now() - this._connectAt : null;
    };

    // True while the main screen is up (connected, plug-in drop done).
    TvMediaBoxDemoScene.prototype._mainShown = function() {
        var t = this._animT();
        return this._hdmiConnected && (t === null || t >= 0);
    };

    // Cable offset while not connected: being pulled out of the port
    // (PLUG_DROP_PX → 0) right after an unplug, then the bob
    // 0 (rest) → -CABLE_BOB_PX → 0.
    TvMediaBoxDemoScene.prototype._cableIdleDy = function() {
        var now = Date.now();
        if (this._unplugAt && now - this._unplugAt < UNPLUG_MS) {
            var u = (now - this._unplugAt) / UNPLUG_MS;
            return PLUG_DROP_PX * (1 - u * (2 - u));
        }
        if (now < this._loopStart) return 0;
        var ph = ((now - this._loopStart) % CABLE_BOB_MS) / CABLE_BOB_MS;
        return -CABLE_BOB_PX * easeInOutSine(ph < 0.5 ? ph * 2 : 2 - ph * 2);
    };

    // ── Input ─────────────────────────────────────────────────────

    TvMediaBoxDemoScene.prototype._buildRows = function() { return []; };

    TvMediaBoxDemoScene.prototype.handleInput = function(action) {
        if (this._view !== 'main') {
            return TVMediaBoxScene.prototype.handleInput.call(this, action);
        }
        if (action === 'run') {
            this._manual = !this._manual;
            this._applyHdmi();
            return;
        }
        if (action === 'back' || action === 'esc') return 'pop';
        if (!this._mainShown()) return;
        if (action === 'edit') { this._pressBtn(this._keyboardBtn); return; }
        if (action === 'del')  { this._pressBtn(this._tvRemoteBtn); return; }
    };

    // ── Render ────────────────────────────────────────────────────

    TvMediaBoxDemoScene.prototype._renderMain = function(canvas) {
        var ctx = canvas.ctx;
        var t   = this._animT();
        // Fade colour for the pill / CEC line / title status.
        var ink = '#000';
        if (t !== null) {
            var f = Math.max(0, Math.min(1, (t - FADE_DELAY_MS) / FADE_MS));
            ink = gray(255 * (1 - f));
        }

        var main = this._mainShown();
        if (main) this._bodyFrame.render(canvas);
        else      this._drawPort(canvas, t);

        // Title bar (same as the real app).
        var TITLE_Y = UI.STATUS_BAR_H;
        ctx.fillStyle = '#D9D9D9';
        ctx.fillRect(0, TITLE_Y, canvas.w, TITLE_H);
        if (typeof Icons !== 'undefined' && Icons.media) {
            canvas.drawSprite(Icons.media, 2, TITLE_Y + 1, '#000');
        }
        Born2bSportyV2FlipCTL.draw(ctx, this.displayName, 18, TITLE_Y, '#000');

        if (!main) {
            var ntW = Born2bSportyV2FlipCTL.textWidth(NC_TITLE);
            Born2bSportyV2FlipCTL.draw(ctx, NC_TITLE,
                NC_CX - Math.floor(ntW / 2), NC_TITLE_Y, NC_GRAY);
            var nhW = HaxrCorp4090FlipCTL.textWidth(NC_HINT);
            HaxrCorp4090FlipCTL.draw(ctx, NC_HINT,
                NC_CX - Math.floor(nhW / 2), NC_HINT_Y, '#000');
            UI.drawStatusBar(canvas, '');
            return;
        }

        var label = 'Running Kodi';
        HaxrCorp4090FlipCTL.draw(ctx, label,
            canvas.w - 4 - HaxrCorp4090FlipCTL.textWidth(label), TITLE_Y + 3, ink);

        this._drawTv(canvas, t);

        var resW = Born2bSportyV2FlipCTL.textWidth(FAKE_RESOLUTION);
        Born2bSportyV2FlipCTL.draw(ctx, FAKE_RESOLUTION,
            INFO_CX - Math.floor(resW / 2), RES_Y, ink);
        var cec  = 'CEC: enabled';
        var cecW = HaxrCorp4090FlipCTL.textWidth(cec);
        HaxrCorp4090FlipCTL.draw(ctx, cec, INFO_CX - Math.floor(cecW / 2), CEC_Y, ink);

        // Selected 'Settings' row.
        if (!this._pageSelectorFrame) {
            this._pageSelectorFrame = new MenuSelectorFrame({
                x: SELECTOR_X, y: ROW_Y, width: SELECTOR_W, height: SELECTOR_H,
                anchorH: 'left', anchorV: 'top',
                strokeColor: '#000', showStroke: true, showFill: false
            });
        }
        this._pageSelectorFrame.render(canvas);
        Helvb08Regular.draw(ctx, 'Settings', 6, ROW_Y + 2, '#000');

        UI.drawStatusBar(canvas, '');

        var btnDy = 0;
        if (t !== null) {
            var bt = Math.min(1, t / BTN_SLIDE_MS);
            btnDy = Math.round(BTN_SLIDE_PX * Math.pow(1 - bt, 3));
        }
        ctx.save();
        ctx.translate(0, btnDy);
        this._keyboardBtn.render(canvas);
        if (this._view !== 'tvRemote') this._tvRemoteBtn.render(canvas);
        ctx.restore();
    };

    // Device side, cable, port front lip. `t` < 0 → the cable is
    // dropping into the port (plug-in), otherwise it bobs.
    TvMediaBoxDemoScene.prototype._drawPort = function(canvas, t) {
        var ctx = canvas.ctx;
        var ready = function(img) { return img && img.complete && img.naturalWidth; };
        if (ready(this._bgImg)) ctx.drawImage(this._bgImg, 0, 0);
        if (!ready(this._cableImg)) return;
        var dy;
        if (t !== null && t < 0) {
            var p = Math.min(1, (t + PLUG_TOTAL_MS) / PLUG_MS);
            dy = this._plugFrom + (PLUG_DROP_PX - this._plugFrom) * p * p;
        } else {
            dy = this._cableIdleDy();
        }
        var y = Math.round(dy);
        ctx.drawImage(this._cableImg, 0, y);
        // Pushed down past rest: stretch the wire's top row up to the
        // screen top so it doesn't come loose under the title bar.
        if (y > 0) ctx.drawImage(this._cableImg, 0, 0, 256, 1, 0, 0, 256, y);
        if (ready(this._fgImg)) ctx.drawImage(this._fgImg, 0, 0);
    };

    // Happy TV with the bounce: the body (frame, screen, glare, face)
    // is shifted by the bounce offset, the foot stays put and the neck
    // is redrawn to fill the gap between them.
    TvMediaBoxDemoScene.prototype._drawTv = function(canvas, t) {
        if (typeof Icons === 'undefined' || !Icons.tv_frame) return;
        var ctx = canvas.ctx;
        var spr = Icons.tv_frame;
        var dy  = 0;
        if (t !== null) {
            var fi = Math.floor(t / FRAME_MS);
            if (fi < BOUNCE.length) dy = BOUNCE[fi];
        }
        var clipRow = function(y, h, drawY) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(TV_X, y, TV_W, h);
            ctx.clip();
            canvas.drawSprite(spr, TV_X, drawY, '#000');
            ctx.restore();
        };
        // Foot (fixed).
        clipRow(TV_Y + FOOT_ROW, TV_H - FOOT_ROW, TV_Y);
        // Neck: from the shifted body's bottom down to the foot, one
        // neck row at a time.
        for (var y = TV_Y + BODY_H + dy; y < TV_Y + FOOT_ROW; y++) {
            clipRow(y, 1, y - NECK_ROW);
        }
        // Body.
        var by = TV_Y + dy;
        clipRow(by, BODY_H, by);

        // Screen fill + glare.
        var sx = TV_X + SCREEN_X, sy = by + SCREEN_Y;
        ctx.fillStyle = SCREEN_GRAY;
        ctx.fillRect(sx, sy, SCREEN_W, SCREEN_H);
        if (t !== null && t >= GLARE_DELAY_MS) {
            var g = Math.min(1, (t - GLARE_DELAY_MS) / GLARE_MS);
            // Band covers lx + ly in [a, a + GLARE_W); a runs from fully
            // before the top-left corner to fully past the bottom-right.
            var a = Math.round(-GLARE_W + g * (SCREEN_W + SCREEN_H + GLARE_W));
            ctx.fillStyle = '#fff';
            for (var ly = 0; ly < SCREEN_H; ly++) {
                var x0 = Math.max(0, a - ly);
                var x1 = Math.min(SCREEN_W, a + GLARE_W - ly);
                if (x1 > x0) ctx.fillRect(sx + x0, sy + ly, x1 - x0, 1);
            }
        }

        // Face (same centring as the real app's tv_screen_on).
        var face = Icons.tv_screen_on;
        if (face) {
            canvas.drawSprite(face,
                TV_X + Math.floor((TV_W - face.w) / 2),
                by + Math.floor((TV_H - face.h) / 2) - 3, '#000');
        }
    };

    // ── Keyboard: keep the UI, drop the mouse forwarder ───────────

    TvMediaBoxDemoScene.prototype._openKeyboard = function() {
        TVMediaBoxScene.prototype._openKeyboard.call(this);
        if (this._kbScreen) this._kbScreen._postForward = function() {};
    };

    // ── Backend stubs (no network) ────────────────────────────────

    function noop() {}
    TvMediaBoxDemoScene.prototype._postForward  = noop;
    TvMediaBoxDemoScene.prototype._postKodiSend = noop;
    TvMediaBoxDemoScene.prototype._postType     = noop;
    TvMediaBoxDemoScene.prototype._sendTv       = noop;
    TvMediaBoxDemoScene.prototype._handleStart  = noop;
    TvMediaBoxDemoScene.prototype._stopKodi     = noop;

    return TvMediaBoxDemoScene;
})();
