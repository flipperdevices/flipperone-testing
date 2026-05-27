/**
 * TVMediaBoxScene
 *
 * Greenfield app shell for "TV Media Box". Renders the standard app
 * chrome (status bar + gray title bar with icon) over an empty body
 * that future media features build into.
 *
 * Wired in via:
 *   - index.html        — <script src="js/apps/tv_media_box.js">
 *   - js/apps/menu.js   — Apps submenu registry (factory + icon)
 */
var TVMediaBoxScene = (function() {
    var TITLE_H = 16;

    function TVMediaBoxScene(sceneManager) {
        this.sceneManager = sceneManager || null;
        // displayName drives the App Switcher title bar and is the
        // RunningApps dedup key; breadcrumbTitle feeds the trail / the
        // getSceneName fallback in main.js.
        this.displayName     = 'TV Media Box';
        this.breadcrumbTitle = 'TV Media Box';
        // Opt into the app model so main.js's Tab handler skips the
        // transient-snapshot path (this scene is already a real
        // RunningApps card).
        this._isApp   = true;
        this.icon     = (typeof Icons !== 'undefined') ? Icons.tv_media_box : null;
        this.imagePath = null;

        // HDMI connector state, polled from /api/hdmi. `_hdmiLoaded`
        // gates the "..." placeholder until the first reply lands.
        this._hdmiLoaded     = false;
        this._hdmiConnected  = false;
        this._hdmiResolution = null;   // preferred mode, e.g. '3840x2160'
        this._hdmiTimer      = null;

        // CEC dependency + screen state. On HDMI connect we register our
        // adapter once, then POLL /api/cec/tv-power while connected — a
        // reply means the connected SCREEN supports CEC (`_cecScreen`),
        // and the value is the live TV power state (`_tvPower`).
        //   _cecInstalled — cec-ctl present (null until dep check returns)
        //   _cecChecked   — at least one power probe has returned
        //   _cecScreen    — a CEC device answered (screen is CEC-capable)
        //   _cecStarting  — enable in flight (guards double-start)
        //   _cecTimer     — tv-power poll, runs while HDMI is connected
        this._cecInstalled = null;
        this._cecChecked   = false;
        this._cecScreen    = false;
        this._cecStarting  = false;
        this._cecTimer     = null;

        // Live TV power ('on'/'standby'/'to-on'/'to-standby'/null) from
        // the poll; also refreshed right after Start TV.
        this._tvPower      = null;

        // CEC-dependency install modal (same shape as Internet radio's
        // mpg123 modal). Opens only when /api/cec/status reports the
        // cec-ctl binary missing; the common case is silent.
        //   missing    — cec-ctl absent; Install / Cancel
        //   installing — POST /api/cec/install in flight (spinner)
        //   failed     — install failed; Retry / Cancel
        // Successful installs auto-dismiss, so there's no 'installed'.
        this._installModal     = { open: false, state: 'missing', buttonIndex: 0, output: '' };
        this._installAnimTimer = null;
        this._installBtnSelector = null;

        // CEC TV-power buttons, shown only while the screen supports CEC
        // and mutually exclusive by power state:
        //   TV off/standby → "Start TV" (right / run)  → wake + switch input
        //   TV on          → "TV OFF"  (left  / esc)  → standby
        var self = this;
        this._startTvBtn = new UI.RightButton('Start TV', 64, 'run', function() {
            self._sendTv('/api/cec/start-tv');
        }, 256);
        this._tvOffBtn = new UI.LeftButton('TV OFF', 64, 'esc', function() {
            self._sendTv('/api/cec/tv-off');
        });
    }

    // True when the TV is on (or coming on) per the latest power poll.
    TVMediaBoxScene.prototype._isTvOn = function() {
        return this._tvPower === 'on' || this._tvPower === 'to-on';
    };

    // POST a TV power command, then re-query power to reflect the result
    // (the 3s poll keeps it current through the on/standby transition).
    TVMediaBoxScene.prototype._sendTv = function(url) {
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.timeout = 8000;
        xhr.onload   = function() { self._fetchTvPower(); };
        xhr.send();
    };

    // Bottom-bar button press: 30ms flash, then fire onPress.
    TVMediaBoxScene.prototype._pressBtn = function(btn) {
        btn.press();
        if (window.requestRender) window.requestRender();
        setTimeout(function() {
            btn.release();
            if (btn.onPress) btn.onPress();
            if (window.requestRender) window.requestRender();
        }, 30);
    };

    TVMediaBoxScene.prototype._startHdmiPoll = function() {
        var self = this;
        var poll = function() {
            fetch('/api/hdmi', { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var connected = !!(data && data.connected);
                    var resolution = (data && data.resolution) || null;
                    // Only act when something changes (or on first load).
                    if (self._hdmiLoaded && connected === self._hdmiConnected
                        && resolution === self._hdmiResolution) return;
                    var was = self._hdmiConnected;
                    self._hdmiLoaded = true;
                    self._hdmiConnected = connected;
                    self._hdmiResolution = resolution;
                    // CEC is checked on the connect transition, not polled.
                    if (connected && !was)      self._maybeCheckScreenCec();
                    else if (!connected && was) self._resetCecState();
                    if (window.requestRender) window.requestRender();
                })
                .catch(function() { /* keep last known state */ });
        };
        poll();
        this._hdmiTimer = setInterval(poll, 2000);
    };

    // Dependency check (GET /api/cec/status). Opens the install modal
    // if any dependency (cec-ctl / edid-decode) is missing; otherwise
    // records deps present and runs the screen check if HDMI is connected.
    TVMediaBoxScene.prototype._checkCec = function() {
        var self = this;
        var openMissing = function() {
            self._installModal.open        = true;
            self._installModal.state       = 'missing';
            self._installModal.buttonIndex = 0;
            if (window.requestRender) window.requestRender();
        };
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/cec/status', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.depsOk) {
                        self._cecInstalled = true;
                        self._maybeCheckScreenCec();
                        return;
                    }
                    openMissing();
                    return;
                } catch (e) { /* fall through */ }
            }
            openMissing();
        };
        xhr.onerror   = openMissing;
        xhr.ontimeout = openMissing;
        xhr.send();
    };

    // Clear screen-CEC state + stop the poll — called on HDMI disconnect
    // so a re-connect re-registers and re-polls from scratch.
    TVMediaBoxScene.prototype._resetCecState = function() {
        this._stopCecPoll();
        this._cecChecked  = false;
        this._cecScreen   = false;
        this._cecStarting = false;
        this._tvPower     = null;
    };

    // Once per HDMI-connected session (deps present + HDMI connected):
    // register our adapter (--playback), then start the tv-power poll.
    TVMediaBoxScene.prototype._maybeCheckScreenCec = function() {
        if (!this._cecInstalled || !this._hdmiConnected || this._cecTimer || this._cecStarting) return;
        this._cecStarting = true;
        var self = this;
        var go = function() { self._cecStarting = false; self._startCecPoll(); };
        var en = new XMLHttpRequest();
        en.open('POST', '/api/cec/enable', true);
        en.timeout = 6000;
        en.onload = go; en.onerror = go; en.ontimeout = go;
        en.send();
    };

    // Poll TV power (and thus CEC-screen presence) every 3s while HDMI
    // is connected. Stopped on disconnect / exit.
    TVMediaBoxScene.prototype._startCecPoll = function() {
        if (this._cecTimer) return;
        var self = this;
        this._fetchTvPower();
        this._cecTimer = setInterval(function() { self._fetchTvPower(); }, 3000);
    };
    TVMediaBoxScene.prototype._stopCecPoll = function() {
        if (this._cecTimer) { clearInterval(this._cecTimer); this._cecTimer = null; }
    };

    // GET /api/cec/tv-power. A non-null power means a CEC device answered
    // at address 0 → the connected screen supports CEC (`_cecScreen`);
    // the value is the live on/standby state. Repaints only on change.
    TVMediaBoxScene.prototype._fetchTvPower = function() {
        var self = this;
        fetch('/api/cec/tv-power', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var p = (data && data.power) || null;
                var screen = (p !== null);
                var changed = !self._cecChecked || p !== self._tvPower || screen !== self._cecScreen;
                self._cecChecked = true;
                self._tvPower    = p;
                self._cecScreen  = screen;
                if (changed && window.requestRender) window.requestRender();
            })
            .catch(function() { /* keep last known state */ });
    };

    // POST /api/cec/install. Ticks requestRender at 80 ms while in
    // flight so the spinner sprite animates over the apt-get wait.
    TVMediaBoxScene.prototype._runCecInstall = function() {
        var self = this;
        self._installModal.state  = 'installing';
        self._installModal.output = '';
        if (!self._installAnimTimer) {
            self._installAnimTimer = setInterval(function() {
                if (window.requestRender) window.requestRender();
            }, 80);
        }
        var stopAnim = function() {
            if (self._installAnimTimer) {
                clearInterval(self._installAnimTimer);
                self._installAnimTimer = null;
            }
        };
        var fail = function(msg) {
            stopAnim();
            self._installModal.state       = 'failed';
            self._installModal.output      = msg;
            self._installModal.buttonIndex = 0;
            if (window.requestRender) window.requestRender();
        };
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/cec/install', true);
        xhr.timeout = 90000;
        xhr.onload = function() {
            stopAnim();
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.success) {
                        // Silent success — drop the modal and re-probe
                        // so the rest of the app unlocks immediately.
                        self._installModal.open = false;
                        self._checkCec();
                        if (window.requestRender) window.requestRender();
                        return;
                    }
                    fail(data.output || '');
                    return;
                } catch (e) { /* fall through */ }
            }
            fail('HTTP ' + xhr.status);
        };
        xhr.onerror   = function() { fail('Network error'); };
        xhr.ontimeout = function() { fail('Timeout'); };
        xhr.send();
    };

    // Modal owns input while open. 'installing' swallows everything
    // (nothing useful to do mid-request); 'missing'/'failed' share the
    // two-button (Install/Retry over Cancel) vertical layout.
    TVMediaBoxScene.prototype._handleInstallModalInput = function(action) {
        var m = this._installModal;
        if (m.state === 'installing') return;
        if (action === 'up' || action === 'down') {
            m.buttonIndex = (m.buttonIndex === 0) ? 1 : 0;
            return;
        }
        if (action === 'ok' || action === 'run') {
            if (m.buttonIndex === 0) this._runCecInstall();
            else                     m.open = false;
            return;
        }
        if (action === 'back' || action === 'esc') {
            m.open = false;
        }
    };

    TVMediaBoxScene.prototype.enter = function() {
        if (typeof RunningApps !== 'undefined') {
            // 4th arg (factoryFn) lets the App Switcher re-open this
            // app from its card. Without it the switcher falls back to
            // a PlaceholderAppScene built from our null imagePath — a
            // blank canvas.
            RunningApps.open(this.displayName, this.imagePath, this.icon,
                function(sm) { return new TVMediaBoxScene(sm); });
        }
        this._startHdmiPoll();
        this._checkCec();
        if (window.requestRender) window.requestRender();
    };

    TVMediaBoxScene.prototype.exit = function() {
        if (this._hdmiTimer) {
            clearInterval(this._hdmiTimer);
            this._hdmiTimer = null;
        }
        this._stopCecPoll();
        if (this._installAnimTimer) {
            clearInterval(this._installAnimTimer);
            this._installAnimTimer = null;
        }
        // Save the last frame as the App Switcher card thumbnail. The
        // _lastRenderedScene guard avoids grabbing the switcher's own
        // frame when we pop because the user picked another app there.
        var canvasEl = document.getElementById('screen');
        var ownsCanvas = (window._lastRenderedScene === this);
        if (ownsCanvas && canvasEl && typeof RunningApps !== 'undefined') {
            var snap = document.createElement('canvas');
            snap.width  = canvasEl.width;
            snap.height = canvasEl.height;
            snap.getContext('2d').drawImage(canvasEl, 0, 0);
            RunningApps.setSnapshot(this.displayName, snap);
        }
    };

    TVMediaBoxScene.prototype.handleInput = function(action) {
        // Modal gets first refusal — it renders on top of everything.
        if (this._installModal.open) {
            this._handleInstallModalInput(action);
            return;
        }
        // Start TV (right/run) when the TV is off; TV OFF (left/esc) when on.
        if (this._cecScreen && !this._isTvOn() && (action === 'run' || action === 'ok')) {
            this._pressBtn(this._startTvBtn);
            return;
        }
        if (this._cecScreen && this._isTvOn() && action === 'esc') {
            this._pressBtn(this._tvOffBtn);
            return;
        }
        if (action === 'back' || action === 'esc') return 'pop';
    };

    TVMediaBoxScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        canvas.clear('#fff');

        // Gray title bar flush against the status bar, with the static
        // icon at its left and the app name in the chunky Sporty font —
        // the shared app-screen idiom (see Internet radio).
        var TITLE_Y = UI.STATUS_BAR_H;
        ctx.fillStyle = '#D9D9D9';
        ctx.fillRect(0, TITLE_Y, canvas.w, TITLE_H);

        if (this.icon) {
            canvas.drawSprite(this.icon, 2, TITLE_Y + 1, '#000');
        }
        Born2bSportyV2Medium.draw(ctx, this.displayName, 18, UI.STATUS_BAR_H + 1, '#000');

        // Body status lines, centered (HaxrcorpFont16). The CEC line is
        // shown only when HDMI is connected — there's nothing attached
        // to report CEC for otherwise.
        var hdmiLine;
        if (!this._hdmiLoaded) hdmiLine = 'HDMI: ...';
        else if (this._hdmiConnected) hdmiLine = 'HDMI: ' + (this._hdmiResolution || 'connected');
        else hdmiLine = 'HDMI: disconnected';
        var lines = [hdmiLine];
        if (this._hdmiConnected) {
            // "enabled" means the connected screen actually answers CEC;
            // no reply (plain monitor / CEC off) → "not enabled".
            lines.push(!this._cecChecked
                ? 'CEC: ...'
                : ('CEC: ' + (this._cecScreen ? 'enabled' : 'not enabled')));
        }
        if (this._cecScreen) {
            lines.push('TV: ' + (this._tvPower || 'no reply'));
        }
        var bodyTop = TITLE_Y + TITLE_H;
        var LINE_H = 13;
        var blockTop = bodyTop + Math.floor((canvas.h - bodyTop - LINE_H * lines.length) / 2);
        for (var i = 0; i < lines.length; i++) {
            HaxrcorpFont16.draw(ctx, lines[i],
                Math.floor((canvas.w - HaxrcorpFont16.textWidth(lines[i])) / 2),
                blockTop + i * LINE_H, '#000');
        }

        // Status bar last so its indicators sit on top of the chrome.
        UI.drawStatusBar(canvas, '');

        // CEC screens: TV OFF (left) when the TV is on, else Start TV (right).
        if (this._cecScreen) {
            if (this._isTvOn()) this._tvOffBtn.render(canvas);
            else                this._startTvBtn.render(canvas);
        }

        // Dependency modal renders above everything (incl. status bar).
        if (this._installModal.open) {
            this._renderInstallModal(canvas);
        }
    };

    // Centred 150×70 frame on a 75% white wash. Title (Sporty), one
    // body line (Haxrcorp), two stacked buttons; 'installing' swaps
    // the buttons for the 8-frame spinner. Mirrors Internet radio.
    TVMediaBoxScene.prototype._renderInstallModal = function(canvas) {
        var ctx = canvas.ctx;
        var m   = this._installModal;

        var W = 150, H = 70;
        var X = Math.floor((canvas.w - W) / 2);
        var Y = Math.floor((canvas.h - H) / 2);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        var frame = new ResponsiveFrame({
            x: X, y: Y, width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true,
            fillColor:   '#fff', showFill:   true,
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        });
        frame.render(canvas);

        var titleY = Y + 6;
        var bodyY  = Y + 23;
        var BTN_H  = 14;
        var BTN_W  = W - 16;
        var BTN_X  = X + Math.floor((W - BTN_W) / 2);
        var btn1Y  = Y + 36;
        var btn2Y  = Y + 52;

        function centerSporty(text, y) {
            var tw = Born2bSportyV2Medium.textWidth(text);
            Born2bSportyV2Medium.draw(ctx, text, X + Math.floor((W - tw) / 2), y, '#000');
        }
        function centerHaxrcorp(text, y, color) {
            var tw = HaxrcorpFont16.textWidth(text);
            HaxrcorpFont16.draw(ctx, text, X + Math.floor((W - tw) / 2), y, color || '#000');
        }

        if (m.state === 'installing') {
            centerSporty('Installing', titleY);
            var sp       = AnimatedIcons.spinner_22x20px;
            var FRAME_MS = 80;
            var spFrameH = Math.floor(sp.h / sp.frames);
            var spFrame  = Math.floor(Date.now() / FRAME_MS) % sp.frames;
            var spX      = X + Math.floor((W - sp.w) / 2);
            var spY      = Y + Math.floor((H - spFrameH) / 2) + 4;
            canvas.drawSpriteFrame(sp, spX, spY, spFrame, '#000');
            return;
        }

        if (m.state === 'missing') {
            centerSporty('Install dependencies?', titleY);
            centerHaxrcorp('Needed for HDMI & CEC info', bodyY, '#666');
            this._drawStackedButton(canvas, BTN_X, btn1Y, BTN_W, BTN_H, 'Install', m.buttonIndex === 0);
            this._drawStackedButton(canvas, BTN_X, btn2Y, BTN_W, BTN_H, 'Cancel',  m.buttonIndex === 1);
            return;
        }

        // 'failed' — last non-empty line of apt output as a hint.
        centerSporty('Install failed', titleY);
        var lines = (m.output || '').split('\n');
        var lastLine = '';
        for (var li = lines.length - 1; li >= 0; li--) {
            var t = lines[li].trim();
            if (t) { lastLine = t; break; }
        }
        if (lastLine.length > 28) lastLine = lastLine.slice(0, 26) + '..';
        centerHaxrcorp(lastLine, bodyY, '#666');
        this._drawStackedButton(canvas, BTN_X, btn1Y, BTN_W, BTN_H, 'Retry',  m.buttonIndex === 0);
        this._drawStackedButton(canvas, BTN_X, btn2Y, BTN_W, BTN_H, 'Cancel', m.buttonIndex === 1);
    };

    // One stacked modal button: centred label, plus a MenuSelectorFrame
    // outline when selected (same idiom as the page chrome).
    TVMediaBoxScene.prototype._drawStackedButton = function(canvas, x, y, w, h, label, selected) {
        var ctx = canvas.ctx;
        var lw  = HaxrcorpFont16.textWidth(label);
        var labelY = y + Math.floor((h - 11) / 2);
        HaxrcorpFont16.draw(ctx, label, x + Math.floor((w - lw) / 2), labelY, '#000');
        if (selected) {
            if (!this._installBtnSelector) {
                this._installBtnSelector = new MenuSelectorFrame({
                    x: 0, y: 0, width: 1, height: 1,
                    anchorH: 'left', anchorV: 'top',
                    strokeColor: '#000', showStroke: true, showFill: false
                });
            }
            this._installBtnSelector.setPosition(x, y);
            this._installBtnSelector.setSize(w, h);
            this._installBtnSelector.render(canvas);
        }
    };

    return TVMediaBoxScene;
})();
