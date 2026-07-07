/**
 * UIInputForwardingScene
 *
 * Testing tool that forwards the Flipper One's key + touchpad
 * evdev devices to a uinput clone on seat0, by running the
 * python-evdev scripts under /scripts via the server's
 * /api/forward/* endpoints (nohup-detached; pgrep-tracked).
 *
 * Screen shows the live forwarding state of each device — "Keys
 * forwarding" and "Touchpad forwarding" — derived from the actual
 * running processes (polled). A single app-defined toggle button
 * sits on the V slot, labelled "Control": pressing it once starts
 * BOTH forwarders, pressing again stops both. Its 2 px top bar
 * lights up while forwarding is active.
 */
var UIInputForwardingScene = (function() {
    var POLL_MS = 1500;

    function UIInputForwardingScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'UIinput forwarding';
        this.breadcrumbTitle = 'UIinput forwarding';

        // Live per-device state, refreshed from /api/forward/status.
        this._keysRunning     = false;
        this._touchpadRunning = false;
        this._pollTimer       = null;

        // "Control" toggle button on the V slot (x = 156, the same
        // V position the Power-menu demo uses), bound to the 'del'
        // action (V key). Its toggled bar tracks the running state.
        this._controlBtn = new UI.MiddleToggleButton('Control', 0, 48, 2, 'del',
            function() { /* handled in handleInput */ }, false);
        this._controlBtn.x = 156;
    }

    UIInputForwardingScene.prototype.enter = function() {
        var self = this;
        this._fetchStatus();
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = setInterval(function() { self._fetchStatus(); }, POLL_MS);
    };

    UIInputForwardingScene.prototype.exit = function() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    };

    // GET /api/forward/status → { keys, touchpad } (pgrep-based).
    UIInputForwardingScene.prototype._fetchStatus = function() {
        var self = this;
        try {
            var x = new XMLHttpRequest();
            x.open('GET', '/api/forward/status', true);
            x.timeout = 3000;
            x.onload = function() {
                if (x.status !== 200) return;
                try {
                    var d = JSON.parse(x.responseText);
                    self._keysRunning     = !!d.keys;
                    self._touchpadRunning = !!d.touchpad;
                    if (window.requestRender) window.requestRender();
                } catch (e) {}
            };
            x.send();
        } catch (e) { /* offline / mocked — ignore */ }
    };

    UIInputForwardingScene.prototype._post = function(url, body) {
        try {
            var x = new XMLHttpRequest();
            x.open('POST', url, true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.timeout = 3000;
            x.send(body ? JSON.stringify(body) : null);
        } catch (e) { /* offline / mocked — ignore */ }
    };

    // Control toggle: if anything is forwarding, stop both;
    // otherwise start both. A short re-poll confirms the new
    // state (and reverts if a script failed to launch).
    UIInputForwardingScene.prototype._toggleControl = function() {
        var anyOn = this._keysRunning || this._touchpadRunning;
        var action = anyOn ? 'stop' : 'start';
        this._post('/api/forward/' + action, { kind: 'keys' });
        this._post('/api/forward/' + action, { kind: 'touchpad' });
        var self = this;
        setTimeout(function() { self._fetchStatus(); }, 700);
    };

    UIInputForwardingScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
        // V (the Control button) toggles forwarding on/off.
        if (action === 'del') {
            var b = this._controlBtn;
            b.press();
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                b.release();
                if (window.requestRender) window.requestRender();
            }, 30);
            this._toggleControl();
            return;
        }
    };

    // App-title chrome, same as Internet Radio / Voice Recorder:
    // a plain status bar (battery / wifi / etc.) with a full-width
    // 16-px gray title strip flush beneath it carrying the app
    // name in Born2bSportyV2FlipCTL.
    var TITLE_H       = 16;
    var TITLE_FILL    = '#D9D9D9';
    var TITLE_TEXT_X  = 4;    // no icon → text flush-left
    var TITLE_TEXT_DY = 1;

    UIInputForwardingScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        var ctx = canvas.ctx;

        // (1) Standard status bar — empty title; the gray strip
        // below carries the app name.
        if (typeof UI !== 'undefined' && typeof UI.drawStatusBar === 'function') {
            UI.drawStatusBar(canvas, '');
        }
        // (2) App-title strip.
        var titleY = UI.STATUS_BAR_H;
        ctx.fillStyle = TITLE_FILL;
        ctx.fillRect(0, titleY, canvas.w, TITLE_H);
        Born2bSportyV2FlipCTL.draw(ctx, this.displayName,
            TITLE_TEXT_X, UI.STATUS_BAR_H + TITLE_TEXT_DY, '#000');

        // (3) Two status lines below the title bar. Label left,
        // ON/OFF right (ON solid black, OFF dim) — derived from
        // the live process state.
        function row(label, on, y) {
            HaxrCorp4090FlipCTL.draw(ctx, label, 6, y, '#000');
            var s  = on ? 'ON' : 'OFF';
            var sw = HaxrCorp4090FlipCTL.textWidth(s);
            HaxrCorp4090FlipCTL.draw(ctx, s, canvas.w - 6 - sw, y, on ? '#000' : '#999999');
        }
        var y0 = titleY + TITLE_H + 8;
        row('Keys forwarding',     this._keysRunning,     y0);
        row('Touchpad forwarding', this._touchpadRunning, y0 + 16);

        // (4) Control button — toggled bar reflects whether
        // anything is being forwarded.
        this._controlBtn.toggled = (this._keysRunning || this._touchpadRunning);
        this._controlBtn.render(canvas);
    };

    return UIInputForwardingScene;
})();
