/**
 * WalkieTalkieScene
 *
 * Mockup app — renders one of two full-screen PNGs depending on
 * the PTT (`a` hardware key) state. While PTT is held the
 * "pressed" art shows; otherwise the idle art shows. No real
 * radio logic yet — this is the visual scaffold.
 *
 * Required assets (drop the PNGs in by hand):
 *   /assets/apps/walkie_talkie/idle.png      — default screen
 *   /assets/apps/walkie_talkie/pressed.png   — while a-key held
 *
 * Both images are loaded once on `enter()` and cached. Held
 * state comes from `Input.isHeld('ptt')` — the same path the
 * Wi-Fi password reveal uses for its push-to-show affordance.
 *
 * Back exits the scene. Tab opens the App Switcher (handled
 * generically by main.js).
 */
var WalkieTalkieScene = (function() {
    var IDLE_PATH    = '/assets/apps/walkie_talkie/idle.png';
    var PRESSED_PATH = '/assets/apps/walkie_talkie/pressed.png';

    function WalkieTalkieScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Walkie Talkie';
        this.breadcrumbTitle = 'Walkie Talkie';
        // Opt in to the App Switcher's app handling so killing
        // this scene from the switcher splices its entry out of
        // the navigation stack (no orphaned screen left behind).
        this._isApp          = true;
        // No bespoke menu icon yet — the Apps submenu and the
        // switcher card fall back to whatever generic shape the
        // menu/switcher code paints when `icon` is null.
        this.icon            = null;
        this._idleImg        = null;
        this._pressedImg     = null;
    }

    WalkieTalkieScene.prototype.enter = function() {
        var self = this;
        // Register with the global recents stack so the App
        // Switcher picks Walkie Talkie up on the next Tab.
        // Factory + (optional) onClose follow the same shape
        // as InternetRadioScene's registration.
        if (typeof RunningApps !== 'undefined') {
            RunningApps.open(this.displayName, IDLE_PATH, this.icon,
                function(sm) { return new WalkieTalkieScene(sm); });
        }

        // Take the LEDs into manual mode so /api/led/set writes
        // for the Link LED aren't immediately trampled by the
        // auto state-driven loop. We restore auto mode on exit.
        this._sendLedManual(true);

        // Load both PNGs once. They live on the server under
        // /assets/apps/walkie_talkie/. The PTT switch flips
        // between the two `Image` handles every render.
        function load(src, slot) {
            var img = new Image();
            img.onload = function() {
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            };
            img.src = src;
            self[slot] = img;
        }
        load(IDLE_PATH,    '_idleImg');
        load(PRESSED_PATH, '_pressedImg');

        // The held-state check happens once per render; force a
        // repaint at ~30 Hz so the PTT release / press flip is
        // immediate even when nothing else is changing. The
        // same tick also reconciles the physical Link LED with
        // the PTT state — it kicks the blink loop on press and
        // tears it down on release (`_updatePttLed`).
        this._lastPttHeld = false;
        this._linkBlinkOn = false;
        // `_rxAnimEpoch` is the timestamp the receive-signal
        // cycle is anchored to. We re-anchor it on every PTT
        // release with a 1 s lead-in, so the bar stays blank
        // for 1 s after release before the next 4 s cycle
        // (2 s active / 2 s silent) kicks back in. On initial
        // enter the bar starts animating immediately.
        this._rxAnimEpoch = Date.now();
        // Three independent signal channels — each carries its
        // own animated 0..100 level, its own historical sampler
        // tape, and renders its own horizontal sliver. Only
        // channel 0 (Signal_level_01) drives the big vertical
        // bar and the printed number; channels 1 and 2 are
        // bar + sampler only.
        //
        //   ch 0 (y = 69, Signal_level_01)
        //     2 s silent → 2 s active around 60 ±10. 4 s loop.
        //   ch 1 (y = 40)
        //     3 s active 50..100 → 1 s silent. 4 s loop.
        //   ch 2 (y = 122)
        //     Continuous 20 (no fluctuation, no pause).
        //
        // `compute(t, elapsed)` returns the level for that
        // channel at wall-clock `t`, with `elapsed = t -
        // _rxAnimEpoch` (negative during the 1 s post-PTT
        // lead-in — all channels are pinned to 0 in that
        // window).
        this._signals = [
            { y: 69, level: 0, samples: [], lastSampleAt: 0,
              compute: function(t, elapsed) {
                  var phase = elapsed % 4000;
                  if (phase < 2000) return 0;
                  var v = 60
                      + 6 * Math.sin(t / 80)
                      + 4 * Math.sin(t / 30);
                  return Math.round(v);
              } },
            { y: 40, level: 0, samples: [], lastSampleAt: 0,
              // Each active phase is a fresh random duration in
              // [1000, 4000] ms followed by a fixed 1000 ms
              // pause. State is held on the channel (`_cycleStart`
              // + `_activeDur`) so the duration doesn't reroll
              // every tick. The duration is rerolled at the end
              // of each cycle, or whenever `sinceStart` jumps so
              // far past the cycle length that the gap can't be
              // explained by a single missed frame — e.g. when
              // PTT was held for a few seconds and the channel
              // wasn't ticking.
              _cycleStart: 0,
              _activeDur:  0,
              compute: function(t, elapsed) {
                  var PAUSE_MS = 1000;
                  if (!this._activeDur) {
                      this._activeDur  = 1000 + Math.random() * 3000;
                      this._cycleStart = t;
                  }
                  var sinceStart = t - this._cycleStart;
                  var cycleDur   = this._activeDur + PAUSE_MS;
                  if (sinceStart >= cycleDur) {
                      this._activeDur  = 1000 + Math.random() * 3000;
                      this._cycleStart = t;
                      sinceStart       = 0;
                  }
                  if (sinceStart >= this._activeDur) return 0;
                  var v = 75
                      + 15 * Math.sin(t / 95)
                      + 10 * Math.sin(t / 40);
                  if (v < 50)  v = 50;
                  if (v > 100) v = 100;
                  return Math.round(v);
              } },
            { y: 122, level: 0, samples: [], lastSampleAt: 0,
              compute: function() { return 20; } }
        ];
        if (this._tickTimer) clearInterval(this._tickTimer);
        this._tickTimer = setInterval(function() {
            self._updatePttLed();
            self._updateAllSignalLevels();
            self._maybeCaptureSamples();
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
        }, 33);
    };

    // Sampler tape — every SAMPLE_INTERVAL_MS, snapshot the
    // current `s.level` of every channel onto its own samples
    // array. Newest at index 0; array clipped to MAX_SAMPLES so
    // anything past the right edge of the strip falls off.
    var SAMPLE_INTERVAL_MS = 500;
    var MAX_SAMPLES        = 36;
    WalkieTalkieScene.prototype._maybeCaptureSamples = function() {
        var now = Date.now();
        for (var i = 0; i < this._signals.length; i++) {
            var s = this._signals[i];
            if (now - (s.lastSampleAt || 0) < SAMPLE_INTERVAL_MS) continue;
            s.lastSampleAt = now;
            s.samples.unshift(s.level || 0);
            if (s.samples.length > MAX_SAMPLES) {
                s.samples.length = MAX_SAMPLES;
            }
        }
    };

    // Run every channel's `compute(t, elapsed)` and write the
    // result into `s.level`. Several conditions short-circuit
    // every channel to 0:
    //   • PTT is currently held — we're transmitting, not
    //     receiving, so the sampler tape should show flatline
    //     and the bars / printed number should read zero.
    //   • Negative `elapsed` — the 1 s post-PTT lead-in window
    //     after release, before the cycle re-anchors.
    // Outside those, the per-channel `compute` decides.
    WalkieTalkieScene.prototype._updateAllSignalLevels = function() {
        var t = Date.now();
        var elapsed = t - (this._rxAnimEpoch || t);
        var held = (typeof window !== 'undefined' && window.input
            && typeof window.input.isHeld === 'function')
            ? window.input.isHeld('ptt') : false;
        for (var i = 0; i < this._signals.length; i++) {
            var s = this._signals[i];
            if (held || elapsed < 0) {
                s.level = 0;
            } else {
                s.level = s.compute(t, elapsed);
            }
        }
    };

    WalkieTalkieScene.prototype.exit = function() {
        // Snapshot the last-rendered frame for the App Switcher
        // card (matches PlaceholderAppScene's behaviour). Skipped
        // when the canvas has since been painted by something
        // else (e.g. the switcher itself).
        var canvasEl = document.getElementById('screen');
        var ownsCanvas = (window._lastRenderedScene === this);
        if (ownsCanvas && canvasEl && typeof RunningApps !== 'undefined') {
            var snap = document.createElement('canvas');
            snap.width  = canvasEl.width;
            snap.height = canvasEl.height;
            snap.getContext('2d').drawImage(canvasEl, 0, 0);
            RunningApps.setSnapshot(this.displayName, snap);
        }
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = null;
        }
        // Make sure we leave the physical Link LED off when the
        // scene exits — otherwise a kill mid-press would strand
        // the LED on the device. Then drop manual mode so the
        // auto state-driven loop takes the LEDs back.
        if (this._linkBlinkTimer) {
            clearInterval(this._linkBlinkTimer);
            this._linkBlinkTimer = null;
        }
        this._sendLinkLed(false);
        this._sendLedManual(false);
        this._lastPttHeld = false;
        this._linkBlinkOn = false;
        this._idleImg    = null;
        this._pressedImg = null;
    };


    // Drive the physical Link LED off the PTT state. Called from
    // the 33-ms tick — only XHRs the server when the state
    // actually flips, so we're not POSTing 30× / sec while the
    // user holds the key. While PTT is down we toggle the LED
    // every BLINK_MS; on release we clear the interval and shut
    // the LED off.
    var BLINK_MS = 120;
    WalkieTalkieScene.prototype._updatePttLed = function() {
        var held = (typeof window !== 'undefined' && window.input
            && typeof window.input.isHeld === 'function')
            ? window.input.isHeld('ptt') : false;
        if (held === this._lastPttHeld) return;
        this._lastPttHeld = held;

        var self = this;
        if (held) {
            // Start blinking. Kick off with the LED already lit
            // so the first frame after press is bright (avoids
            // the BLINK_MS lag before the first toggle fires).
            this._linkBlinkOn = true;
            this._sendLinkLed(true);
            if (this._linkBlinkTimer) clearInterval(this._linkBlinkTimer);
            this._linkBlinkTimer = setInterval(function() {
                self._linkBlinkOn = !self._linkBlinkOn;
                self._sendLinkLed(self._linkBlinkOn);
            }, BLINK_MS);
        } else {
            // Stop blinking, leave the LED off.
            if (this._linkBlinkTimer) {
                clearInterval(this._linkBlinkTimer);
                this._linkBlinkTimer = null;
            }
            this._linkBlinkOn = false;
            this._sendLinkLed(false);
            // Re-arm the receive-signal cycle for 1 s in the
            // future so the bar stays blank for a beat after
            // the user releases PTT, then resumes its 2 s / 2 s
            // active / silent pattern from a fresh start.
            this._rxAnimEpoch = Date.now() + 1000;
        }
    };

    // Fire-and-forget LED command using /api/led/set so we can
    // pick a colour. Red (255, 0, 0) while PTT is held — a
    // clearer "transmitting" signal than the default blue Link
    // colour. Only effective in manual mode, which we engage on
    // `enter()`.
    WalkieTalkieScene.prototype._sendLinkLed = function(on) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/led/set', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send(JSON.stringify({
                led: 'link',
                r:   on ? 255 : 0,
                g:   0,
                b:   0,
                on:  !!on
            }));
        } catch (e) { /* mocked server / offline — ignore */ }
    };

    // Toggle the server's LED manual-mode flag. While manual mode
    // is on, the auto state-driven loop steps aside so the
    // `_sendLinkLed` calls above stick on the physical LED.
    // Re-enable auto on exit so the rest of the device's LED
    // behaviour returns once we leave the app.
    WalkieTalkieScene.prototype._sendLedManual = function(enabled) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/led/manual', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send(JSON.stringify({ enabled: !!enabled }));
        } catch (e) { /* mocked server / offline — ignore */ }
    };

    WalkieTalkieScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
        // 'ptt' presses arrive as discrete actions but the
        // pressed state is read from Input.isHeld() in render —
        // ignore the one-shot here (otherwise a tap would
        // register but a long hold wouldn't keep the art swapped).
    };

    WalkieTalkieScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        // Idle PNG is always painted first as the base layer.
        // Pressed PNG gets layered ON TOP while PTT is held —
        // it's expected to have transparent regions so the idle
        // art shows through wherever the pressed art doesn't
        // override it. (Previously the two PNGs swapped; the
        // pressed art now overlays so the receive-signal bar
        // and other idle widgets stay readable under it.)
        var held = (typeof window !== 'undefined' && window.input
            && typeof window.input.isHeld === 'function')
            ? window.input.isHeld('ptt') : false;
        if (this._idleImg && this._idleImg.complete && this._idleImg.naturalWidth > 0) {
            canvas.ctx.drawImage(this._idleImg, 0, 0);
        }
        if (held && this._pressedImg
                && this._pressedImg.complete && this._pressedImg.naturalWidth > 0) {
            canvas.ctx.drawImage(this._pressedImg, 0, 0);
        }
        // Fake "receiving signal" indicator: a 3-px wide vertical
        // bar at (63, 29) whose height pulses between RX_BAR_MIN
        // and RX_BAR_MAX_H to mimic incoming voice amplitude.
        // Only drawn in the idle state (i.e. when the user
        // isn't transmitting) — once PTT is pressed the screen
        // swaps to the "pressed" PNG and the bar goes away.
        //
        // Animation uses a sum-of-sines at three frequencies so
        // the pulses don't read as a regular sine pattern. Time
        // base is Date.now() so the motion progresses even when
        // nothing else triggers a render (the 33-ms tick handles
        // the actual repaints).
        // The receive-signal widgets render every frame — held
        // state no longer gates them. PTT-press still snaps
        // every channel's `level` to 0 in `_updateAllSignalLevels`,
        // so the bars / printed number naturally show empty,
        // but the sampler tape keeps painting its captured
        // history (now with a stretch of "white" pixels for the
        // transmit window once a sample fires while held).
        // Big vertical receive bar — driven only by channel 0
        // (Signal_level_01).
        var RX_BAR_X     = 63;
        var RX_BAR_Y     = 29;
        var RX_BAR_W     = 3;
        var RX_BAR_MAX_H = 85;
        var ch0lvl = (this._signals[0] && this._signals[0].level) || 0;
        var h = Math.round(ch0lvl * RX_BAR_MAX_H / 100);
        if (h > 0) {
            var topY = RX_BAR_Y + RX_BAR_MAX_H - h;
            canvas.ctx.fillStyle = '#000';
            canvas.ctx.fillRect(RX_BAR_X, topY, RX_BAR_W, h);
        }
        // Horizontal sliver + sampler tape for every channel.
        // X positions are shared (sliver at 145, sampler at
        // 160); Y comes from `channel.y` so each channel sits
        // on its own row.
        var HBAR_X     = 145;
        var HBAR_H     = 2;
        var HBAR_MAX_W = 12;
        var SAMPLER_X  = 160;
        var SAMPLER_H  = 2;
        for (var ci = 0; ci < this._signals.length; ci++) {
            var ch = this._signals[ci];
            var lvl = ch.level || 0;
            // Right-anchored sliver — width shrinks toward the
            // right edge as the level drops.
            var w = Math.round(lvl * HBAR_MAX_W / 100);
            if (w > 0) {
                var leftX = HBAR_X + HBAR_MAX_W - w;
                canvas.ctx.fillStyle = '#000';
                canvas.ctx.fillRect(leftX, ch.y, w, HBAR_H);
            }
            // Sampler tape — historical snapshots, 1 × 2
            // grayscale per slot, leftmost = newest. The capture
            // cadence + ageing is handled by
            // `_maybeCaptureSamples`.
            for (var si = 0; si < ch.samples.length; si++) {
                var sv = ch.samples[si];
                var sg = Math.round(255 * (100 - sv) / 100);
                if (sg < 0)   sg = 0;
                if (sg > 255) sg = 255;
                canvas.ctx.fillStyle = 'rgb(' + sg + ',' + sg + ',' + sg + ')';
                canvas.ctx.fillRect(SAMPLER_X + si, ch.y, 1, SAMPLER_H);
            }
        }
        // No status bar — the Walkie Talkie mockup PNGs already
        // bake their own status row into the top of the image.
    };

    return WalkieTalkieScene;
})();
