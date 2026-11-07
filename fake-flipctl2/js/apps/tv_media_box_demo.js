/**
 * TvMediaBoxDemoScene
 *
 * Testing → Kickstarter demo → 'TV Media Box'. UI clone of the real
 * TVMediaBoxScene for the campaign footage: same chrome, TV remote and
 * keyboard, but no backend except HDMI plug detection, and a trimmed
 * main screen (no Video out / Adjust screen rows).
 *
 *   - Not connected: the "plug in the cable" clip loops — an HDMI cable
 *     bobbing over the port (Cable_Seq_v003/Media_box_outline, cable
 *     and port only, its white made transparent), in front of the Media
 *     Box itself (Media_box_outline.png) at an adjustable opacity, under the status bar +
 *     title bar; left of the box a 'Plug in HDMI' headline over a
 *     'Waiting for connection' hint. No body frame, no buttons.
 *     Up / Down change the Media Box opacity (OUTLINE.min..max % in
 *     OUTLINE.step steps, kept for the session) and flash the value in
 *     the status bar.
 *   - Connected (/api/hdmi `connected`, polled every HDMI_POLL_MS):
 *     the main screen comes in (unplugging goes straight back to the
 *     clip, from its first frame): the designer's animated media icon
 *     (a film strip with a play sign, media_big_icon_v001.gif) plays
 *     where the real app has its TV, the FAKE_RESOLUTION headline,
 *     'CEC: enabled' and 'Running Kodi' fade in, a selected 'Settings'
 *     row (Helvb08) and the Keyboard + TV remote buttons appear.
 *   - OK toggles a manual "connected" override (preview without
 *     hardware, or a backup during a shoot), like the other Kickstarter
 *     connect demos.
 *   - Remote / Keyboard: press flashes only, nothing sent.
 *   - Power meter LEDs while open: battery outline + one usage tick,
 *     connected or not; off on exit.
 * Not registered in RunningApps (no App Switcher card / snapshot).
 *
 * Must load after tv_media_box.js (subclasses TVMediaBoxScene).
 *
 * Rebuild the clip's sheet after changing the frames, from
 * assets/tv_media_box/Cable_Seq_v003/Media_box_outline/:
 *   ffmpeg -framerate 30 -i Media_box_cable_v003_%d.png \
 *          -vf format=gray,tile=10x6 -frames:v 1 -update 1 ../../Media_box_cable_v003_sheet.png
 * and the icon's from the GIF (frames 1:1, grayscale, ICON.cols per row;
 * keep ICON_MS in step with the GIF's frame durations), e.g. with Pillow:
 *   im = Image.open('media_big_icon_v001.gif'); sheet = Image.new('L', (63 * 8, 43 * 4), 255)
 *   for i in range(im.n_frames): im.seek(i); sheet.paste(
 *       im.convert('L'), ((i % 8) * 63, (i // 8) * 43))
 *   sheet.save('media_big_icon_v001_sheet.png')
 */
var TvMediaBoxDemoScene = (function() {
    var HDMI_POLL_MS    = 500;
    // Power meter LEDs (PowerMeterLeds), the same with or without HDMI:
    // battery outline and a one-tick usage bar.
    var METER = { battery: 'OUTLINE', usage: 1 };
    // Consecutive 'disconnected' polls before dropping back to
    // 'Not connected' — absorbs the TV's HPD flaps on wake / sleep.
    var HDMI_MISS_LIMIT = 3;
    var FAKE_RESOLUTION = '3840x2160 60Hz';

    var TITLE_H = 16;

    // Not connected: the cable clip (a sprite sheet, every frame in a
    // cols × rows grid, blitted by wall-clock index so the wrap has no
    // seam; ink only in x 161..180, y 0..71) under the Media Box
    // outline (x 110..255, y 59..125) at outlinePct %.
    var WAITING = {
        src: 'assets/tv_media_box/Media_box_cable_v003_sheet.png',
        frames: 60, cols: 10, fps: 30, w: 256, h: 144
    };
    var OUTLINE = {
        src: 'assets/tv_media_box/Media_box_outline.png',
        def: 50, min: 30, max: 100, step: 10
    };
    var OUTLINE_LABEL = 'Media Box Opacity ';
    var OUTLINE_LABEL_MS = 1500;                 // how long the % shows after a press
    var outlinePct = OUTLINE.def;                // survives re-entering the scene
    // Hint text left of the box, from the design: Born2bSporty headline
    // (ink rows 71..80) over a HaxrCorp line (ink rows 87..93), both
    // black, ink from x 11.
    var NC_TITLE = 'Plug in HDMI';
    var NC_HINT  = 'Waiting for connection';
    var NC_X       = 11;
    var NC_TITLE_Y = 68;
    var NC_HINT_Y  = 85;
    // Fake status bar, from the design (like the 5G Modem demo's, with
    // "5G" 1 px further right): full cellular bars + "5G" left, "69%"
    // and the battery right.
    var BATTERY_PCT = 69;         // the battery bar is filled to match

    // Media icon (the designer's GIF as a sprite sheet), centred on the
    // real app's TV spot (x 45..105, y 38..80). It loops the whole GIF
    // from its first frame on every connect; ICON_MS = the GIF's frame
    // durations (a 200 / 200 / 500 ms press, then the strip runs).
    var TV_X = 45, TV_Y = 38, TV_W = 61;
    var ICON = {
        src: 'assets/tv_media_box/media_big_icon_v001_sheet.png',
        frames: 31, cols: 8, w: 63, h: 43
    };
    var ICON_MS = [200, 200, 500];
    while (ICON_MS.length < ICON.frames) ICON_MS.push(100);
    var ICON_CYCLE_MS = ICON_MS.reduce(function(a, b) { return a + b; }, 0);

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

    // Bottom buttons slide up from below the screen edge on connect
    // (easeOutCubic).
    var BTN_SLIDE_PX = 14;   // button height: fully hidden at start
    var BTN_SLIDE_MS = 300;
    // The connect animation (fade + button slide) is over by then.
    var ANIM_END_MS = Math.max(BTN_SLIDE_MS, FADE_DELAY_MS + FADE_MS);

    function TvMediaBoxDemoScene(sceneManager) {
        TVMediaBoxScene.call(this, sceneManager);
        this._isApp = false;
    }
    TvMediaBoxDemoScene.prototype = Object.create(TVMediaBoxScene.prototype);
    TvMediaBoxDemoScene.prototype.constructor = TvMediaBoxDemoScene;

    function drawStatusBar(canvas) {
        var ctx = canvas.ctx, top = 3, H = HaxrCorp4090FlipCTL;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.w, UI.STATUS_BAR_H);
        // 5 bars, 1 px wide, 1 px apart, 3..7 px tall, bottoms on row 9.
        ctx.fillStyle = '#fff';
        for (var i = 0; i < 5; i++) ctx.fillRect(2 + 2 * i, 9 - (2 + i), 1, 3 + i);
        H.draw(ctx, '5G', 13, top - 2, '#fff');
        var bat = StatusBarBattery.sprite, bx = canvas.w - 2 - bat.w;
        var pct = BATTERY_PCT + '%';
        H.draw(ctx, pct, bx - 1 - H.textWidth(pct), top - 2, '#fff');
        canvas.drawSprite(bat, bx, top - 1, '#fff');
        ctx.fillRect(bx + 2, top + 1, Math.round(10 * BATTERY_PCT / 100), 5);
    }

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    // The clip's sheet with its white made transparent (a canvas), so
    // the cable can go over the Media Box: the cable has no pure white
    // inside its outline, only the background is 255. null until loaded.
    function loadClip(src) {
        var holder = { canvas: null };
        var img = new Image();
        img.onload = function() {
            var c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            var cx = c.getContext('2d');
            cx.drawImage(img, 0, 0);
            var data = cx.getImageData(0, 0, c.width, c.height);
            var px = data.data;
            for (var i = 0; i < px.length; i += 4) {
                if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255) px[i + 3] = 0;
            }
            cx.putImageData(data, 0, 0);
            holder.canvas = c;
            repaint();
        };
        img.src = src;
        return holder;
    }

    function loadImg(src) {
        var img = new Image();
        img.onload = repaint;
        img.src = src;
        return img;
    }

    function gray(v) {
        v = Math.max(0, Math.min(255, Math.round(v)));
        return 'rgb(' + v + ',' + v + ',' + v + ')';
    }

    // ── Lifecycle ─────────────────────────────────────────────────

    TvMediaBoxDemoScene.prototype.enter = function() {
        PowerMeterLeds.start(METER);
        // Re-entry (e.g. returning from a pushed scene) keeps the state.
        if (this._fakeStarted) { repaint(); return; }
        this._fakeStarted = true;
        this._hdmiReal    = false;   // last real plug state (debounced)
        this._hdmiMisses  = 0;
        this._manual      = false;   // OK override
        this._connectAt   = 0;       // 0 = no connect animation
        this._loopStart   = Date.now();
        // Re-fetched on every visit (cache-busting query), so art swapped
        // on disk shows up without reloading the page.
        this._clipImg    = loadClip(WAITING.src + '?v=' + Date.now());
        this._outlineImg = loadImg(OUTLINE.src + '?v=' + Date.now());
        this._iconImg    = loadImg(ICON.src + '?v=' + Date.now());
        this._iconT0     = Date.now();
        this._labelUntil = 0;
        var self = this;
        // Repaint tick for the clip / media icon (main view only).
        this._loopTimer = setInterval(function() {
            if (self._hdmiLoaded && self._view === 'main') repaint();
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
        PowerMeterLeds.stop();
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
        if (!on) this._loopStart = Date.now();   // the clip from its first frame
        else     this._iconT0    = Date.now();   // the icon from its first frame
        repaint();
    };

    TvMediaBoxDemoScene.prototype._startConnectAnim = function() {
        this._connectAt = Date.now();
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

    // ms since the main screen's connect animation started, or null
    // when idle.
    TvMediaBoxDemoScene.prototype._animT = function() {
        return this._connectAt ? Date.now() - this._connectAt : null;
    };

    // True while the main screen is up.
    TvMediaBoxDemoScene.prototype._mainShown = function() {
        return !!this._hdmiConnected;
    };

    // ── Input ─────────────────────────────────────────────────────

    TvMediaBoxDemoScene.prototype._buildRows = function() { return []; };

    TvMediaBoxDemoScene.prototype.handleInput = function(action) {
        if (this._view !== 'main') {
            return TVMediaBoxScene.prototype.handleInput.call(this, action);
        }
        if (action === 'ok') {
            this._manual = !this._manual;
            this._applyHdmi();
            return;
        }
        if (action === 'back' || action === 'esc') return 'pop';
        if (!this._mainShown()) {
            if (action === 'up' || action === 'down') {
                var d = action === 'up' ? OUTLINE.step : -OUTLINE.step;
                outlinePct = Math.max(OUTLINE.min, Math.min(OUTLINE.max, outlinePct + d));
                this._labelUntil = Date.now() + OUTLINE_LABEL_MS;
                repaint();
            }
            return;
        }
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
        else      this._drawPort(canvas);

        // Title bar (same as the real app).
        var TITLE_Y = UI.STATUS_BAR_H;
        ctx.fillStyle = '#D9D9D9';
        ctx.fillRect(0, TITLE_Y, canvas.w, TITLE_H);
        if (typeof Icons !== 'undefined' && Icons.media) {
            canvas.drawSprite(Icons.media, 2, TITLE_Y + 1, '#000');
        }
        Born2bSportyV2FlipCTL.draw(ctx, this.displayName, 18, TITLE_Y, '#000');

        if (!main) {
            Born2bSportyV2FlipCTL.draw(ctx, NC_TITLE, NC_X, NC_TITLE_Y, '#000');
            HaxrCorp4090FlipCTL.draw(ctx, NC_HINT, NC_X, NC_HINT_Y, '#000');
            drawStatusBar(canvas);
            if (Date.now() < this._labelUntil) {
                // Over the status bar's left side.
                var label = OUTLINE_LABEL + outlinePct + '%';
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, HaxrCorp4090FlipCTL.textWidth(label) + 4, UI.STATUS_BAR_H);
                HaxrCorp4090FlipCTL.draw(ctx, label, 2, 1, '#fff');
            }
            return;
        }

        var label = 'Running Kodi';
        HaxrCorp4090FlipCTL.draw(ctx, label,
            canvas.w - 4 - HaxrCorp4090FlipCTL.textWidth(label), TITLE_Y + 3, ink);

        this._drawIcon(canvas);

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
        // Centred on the screen.
        Helvb08Regular.draw(ctx, 'Settings',
            Math.floor((canvas.w - Helvb08Regular.textWidth('Settings')) / 2), ROW_Y + 2, '#000');

        drawStatusBar(canvas);

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

    // The Media Box outline at outlinePct, then the cable clip in front
    // of it.
    TvMediaBoxDemoScene.prototype._drawPort = function(canvas) {
        var ctx = canvas.ctx;
        var ready = function(img) { return img && img.complete && img.naturalWidth; };
        canvas.clear('#fff');
        if (ready(this._outlineImg)) {
            var a = ctx.globalAlpha;
            ctx.globalAlpha = a * outlinePct / 100;
            ctx.drawImage(this._outlineImg, 0, 0);
            ctx.globalAlpha = a;
        }
        var clip = this._clipImg && this._clipImg.canvas;
        if (clip) {
            var fi = Math.floor(Math.max(0, Date.now() - this._loopStart) * WAITING.fps / 1000) % WAITING.frames;
            ctx.drawImage(clip,
                (fi % WAITING.cols) * WAITING.w, Math.floor(fi / WAITING.cols) * WAITING.h,
                WAITING.w, WAITING.h, 0, 0, canvas.w, canvas.h);
        }
    };

    // The media icon at the frame due ICON_MS-wise since _iconT0.
    TvMediaBoxDemoScene.prototype._drawIcon = function(canvas) {
        var img = this._iconImg;
        if (!img || !img.complete || !img.naturalWidth) return;
        var t = (Date.now() - this._iconT0) % ICON_CYCLE_MS, fi = 0;
        while (fi < ICON.frames - 1 && t >= ICON_MS[fi]) t -= ICON_MS[fi++];
        canvas.ctx.drawImage(img,
            (fi % ICON.cols) * ICON.w, Math.floor(fi / ICON.cols) * ICON.h, ICON.w, ICON.h,
            TV_X + Math.floor((TV_W - ICON.w) / 2), TV_Y, ICON.w, ICON.h);
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
