/**
 * HapticTestScene
 *
 * Testing tool for the Flipper One haptic driver. Pick a library
 * effect index + a duration (Full = whole waveform), press Play
 * (B / run), and the server forwards it to the persistent
 * fo-haptic-test.py daemon, which plays that library effect on the
 * FF device for the requested length.
 *
 * Chrome mirrors Internet radio: status bar + gray title strip, two
 * settings rows (Effect / Duration) navigated with up/down, values
 * stepped with left/right, and a bottom-right Play button.
 */
var HapticTestScene = (function() {
    var TITLE_H      = 16;
    var TITLE_FILL   = '#D9D9D9';
    var TITLE_TEXT_X = 4;
    var ROW_GAP      = 2;
    var BTN_W        = 48;
    var SELECTOR_X   = 2;
    var SELECTOR_W   = 252;
    var SELECTOR_H   = 15;

    // Effect-stepper press-and-hold tuning. A tap is ±1; holding the
    // key auto-repeats after the initial delay (so a tap doesn't),
    // stepping ±1 for the first ACCEL_AFTER ms and ±5 thereafter.
    var STEP_INITIAL_DELAY_MS = 300;   // tap-vs-hold threshold
    var STEP_REPEAT_MS        = 100;   // auto-repeat tick
    var STEP_ACCEL_AFTER_MS   = 1000;  // hold longer than this → ±5

    // Duration presets cycled by left/right on the Duration row.
    // 0 = full library waveform; others = play for that many ms.
    var DURATIONS = [0, 50, 100, 150, 200, 255];

    function HapticTestScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Haptic tests';
        this.breadcrumbTitle = 'Haptic tests';

        this._effectId    = 0;     // library effect index (0..255)
        this._durIndex    = 0;     // index into DURATIONS
        this._selectedRow = 0;     // 0 = Effect, 1 = Duration

        this._available   = true;  // FF / haptic device present (polled)
        this._statusMsg   = '';    // transient "Playing …" banner
        this._statusTimer = null;

        // Effect-stepper press-and-hold repeat state.
        this._repeatTimer = null;
        this._repeatDir   = 0;
        this._holdStart   = 0;

        // Bottom-right Play button on the run / B key.
        this._playBtn = new UI.RightButton('Play', BTN_W, 'run',
            function() { /* fired from handleInput */ }, 256);

        this._selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X, y: 0, width: SELECTOR_W, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
    }

    HapticTestScene.prototype.enter = function() {
        if (typeof RunningApps !== 'undefined') {
            RunningApps.open(this.displayName, null,
                (typeof Icons !== 'undefined') ? Icons.system : null,
                function(sm) { return new HapticTestScene(sm); });
        }
        this._fetchStatus();
        if (window.requestRender) window.requestRender();
    };

    HapticTestScene.prototype.exit = function() {
        if (this._statusTimer) { clearTimeout(this._statusTimer); this._statusTimer = null; }
        this._stopStepRepeat();
        // The haptic daemon stays running system-wide — nothing to
        // stop here.
    };

    // GET /api/haptic/status → { available }.
    HapticTestScene.prototype._fetchStatus = function() {
        var self = this;
        try {
            var x = new XMLHttpRequest();
            x.open('GET', '/api/haptic/status', true);
            x.timeout = 3000;
            x.onload = function() {
                if (x.status !== 200) return;
                try {
                    var d = JSON.parse(x.responseText);
                    self._available = !!d.available;
                    if (window.requestRender) window.requestRender();
                } catch (e) {}
            };
            x.send();
        } catch (e) { /* offline / mocked — assume present */ }
    };

    HapticTestScene.prototype._post = function(url, body) {
        try {
            var x = new XMLHttpRequest();
            x.open('POST', url, true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.timeout = 4000;
            x.send(body ? JSON.stringify(body) : null);
        } catch (e) { /* offline / mocked — ignore */ }
    };

    // Effect index step (clamped 0..255).
    HapticTestScene.prototype._effectStep = function(dir, step) {
        this._effectId += dir * step;
        if (this._effectId < 0)   this._effectId = 0;
        if (this._effectId > 255) this._effectId = 255;
        if (window.requestRender) window.requestRender();
    };

    // Duration preset cycle (single step per press).
    HapticTestScene.prototype._cycleDuration = function(dir) {
        var n = DURATIONS.length;
        this._durIndex = (this._durIndex + dir + n) % n;
        if (window.requestRender) window.requestRender();
    };
    HapticTestScene.prototype._duration = function() {
        return DURATIONS[this._durIndex] || 0;
    };
    HapticTestScene.prototype._durationLabel = function() {
        var d = this._duration();
        return d === 0 ? 'Full' : (d + ' ms');
    };

    // Press-and-hold on the Effect row. Steps ±1 immediately, then
    // auto-repeats while the key stays held — gated on
    // window.input.isHeld so it stops on release. Driven by our own
    // timer so it works even when the input layer delivers no key
    // auto-repeat; re-fired same-direction actions are swallowed.
    HapticTestScene.prototype._beginStepRepeat = function(dir) {
        var self = this;
        // Already repeating this direction (input-layer re-fire) → let
        // the timer drive it; don't double-step.
        if (this._repeatTimer && this._repeatDir === dir) return;
        this._stopStepRepeat();
        this._repeatDir = dir;
        this._holdStart = Date.now();
        this._effectStep(dir, 1);                 // immediate single step
        var action  = (dir > 0) ? 'right' : 'left';
        var started = Date.now();
        this._repeatTimer = setInterval(function() {
            var held = (typeof window !== 'undefined' && window.input
                        && typeof window.input.isHeld === 'function')
                       && window.input.isHeld(action);
            if (!held) { self._stopStepRepeat(); return; }
            // Tap grace: no auto-repeat until the key's been held a bit.
            if (Date.now() - started < STEP_INITIAL_DELAY_MS) return;
            var step = (Date.now() - self._holdStart > STEP_ACCEL_AFTER_MS) ? 5 : 1;
            self._effectStep(dir, step);
        }, STEP_REPEAT_MS);
    };
    HapticTestScene.prototype._stopStepRepeat = function() {
        if (this._repeatTimer) { clearInterval(this._repeatTimer); this._repeatTimer = null; }
        this._repeatDir = 0;
    };

    HapticTestScene.prototype._play = function() {
        var self = this;
        var eff  = this._effectId;
        var dur  = this._duration();
        this._post('/api/haptic/play', { effectId: eff, durationMs: dur });
        this._statusMsg = 'Playing #' + eff + (dur ? '  ' + dur + ' ms' : '  full');
        if (this._statusTimer) clearTimeout(this._statusTimer);
        this._statusTimer = setTimeout(function() {
            self._statusMsg = '';
            self._statusTimer = null;
            if (window.requestRender) window.requestRender();
        }, 1500);
        if (window.requestRender) window.requestRender();
    };

    HapticTestScene.prototype._pressPlay = function() {
        var b = this._playBtn;
        b.press();
        if (window.requestRender) window.requestRender();
        var self = this;
        setTimeout(function() {
            b.release();
            if (window.requestRender) window.requestRender();
        }, 30);
        this._play();
    };

    HapticTestScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'up' || action === 'down') {
            this._stopStepRepeat();
            this._selectedRow = (action === 'up')
                ? (this._selectedRow - 1 + 2) % 2
                : (this._selectedRow + 1) % 2;
            if (window.requestRender) window.requestRender();
            return;
        }
        if (action === 'left' || action === 'right') {
            var dir = (action === 'right') ? 1 : -1;
            if (this._selectedRow === 0) {
                this._beginStepRepeat(dir);   // Effect: tap=±1, hold accelerates
            } else {
                this._stopStepRepeat();
                this._cycleDuration(dir);     // Duration: single preset cycle
            }
            return;
        }
        if (action === 'run' || action === 'ok') { this._pressPlay(); return; }
    };

    HapticTestScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        var ctx = canvas.ctx;

        // Status bar across the top.
        if (typeof UI !== 'undefined' && UI.drawStatusBar) {
            UI.drawStatusBar(canvas, '');
        }

        // Gray title strip flush under the status bar, app name in the
        // chunky Sporty font (no icon — mirrors UIinput forwarding).
        var TITLE_Y = UI.STATUS_BAR_H;
        ctx.fillStyle = TITLE_FILL;
        ctx.fillRect(0, TITLE_Y, canvas.w, TITLE_H);
        Born2bSportyV2Medium.draw(ctx, this.displayName,
            TITLE_TEXT_X, UI.STATUS_BAR_H + 1, '#000');

        // Effect / Duration rows + the page selector.
        var bodyTop  = TITLE_Y + TITLE_H;
        var rowPitch = MenuDropdownLine.HEIGHT + ROW_GAP;
        var rowYAt   = function(i) { return bodyTop + 4 + i * rowPitch; };
        var rows = [
            { title: 'Effect',   value: String(this._effectId) },
            { title: 'Duration', value: this._durationLabel() }
        ];
        for (var i = 0; i < rows.length; i++) {
            new MenuDropdownLine({
                y:        rowYAt(i),
                title:    rows[i].title,
                value:    rows[i].value,
                selected: (i === this._selectedRow)
            }).render(canvas);
        }
        this._selectorFrame.setPosition(SELECTOR_X, rowYAt(this._selectedRow));
        this._selectorFrame.setSize(SELECTOR_W, SELECTOR_H);
        this._selectorFrame.render(canvas);

        // Status line below the rows: device-missing warning, the
        // transient "Playing …" banner, or a play hint.
        var statusY = rowYAt(2) + 6;
        var line    = !this._available ? 'No haptic device detected'
                    : (this._statusMsg || 'Press B to play the effect');
        var color   = !this._available ? '#000' : '#6D6D6D';
        HaxrcorpFont16.draw(ctx, line, 6, statusY, color);

        // Bottom-right Play button.
        this._playBtn.render(canvas);
    };

    return HapticTestScene;
})();
