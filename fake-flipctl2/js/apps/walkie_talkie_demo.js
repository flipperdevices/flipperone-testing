/**
 * WalkieTalkieDemoScene
 *
 * Testing → Kickstarter demo → 'Walkie Talkie'. A silent copy of the
 * Walkie Talkie app (js/apps/walkie_talkie.js) for demo footage:
 *
 *   • Same screen: idle / pressed PNGs, big receive bar, volume chip,
 *     three channel slivers with their sampler tapes ("waterfall").
 *   • No sound at all: no server-side playback loop, no output
 *     routing, no mixer reads or writes.
 *   • Channel 0 runs a fixed loop: nobody talks for SILENT_MS, then
 *     someone talks for TALK_MS (bar and waterfall active). Channels 1
 *     and 2 behave as in the real app.
 *   • The LCD backlight follows that loop (commercial footage): off
 *     while silent, on while someone talks. 'always-on' is used for the
 *     talk window so the MCU's own idle timer can't blank it mid-way;
 *     exit hands the screen back with a plain 'on'.
 *   • The chip still reads "Volume" but sets screen brightness:
 *     0..100 maps to backlight level 1..255, hydrated from the MCU on
 *     enter and written debounced (every level write hits MCU flash).
 *   • Any key press wakes the screen on the MCU side, and a level write
 *     lights it too, so the current on/off state is re-sent after both.
 *   • PTT behaves as in the real app: pressed art on top, every
 *     channel reads 0 while held, red blinking Link LED.
 *
 * Not registered with RunningApps, so it never shadows the real
 * Walkie Talkie in the App Switcher.
 */
var WalkieTalkieDemoScene = (function() {
    var IDLE_PATH    = '/assets/apps/walkie_talkie/idle.png';
    var PRESSED_PATH = '/assets/apps/walkie_talkie/pressed.png';

    // Channel 0 loop: silence first, then talking.
    var SILENT_MS = 10000;
    var TALK_MS   = 10000;

    // Sampler tape cadence, same as the real app.
    var SAMPLE_INTERVAL_MS = 500;
    var MAX_SAMPLES        = 36;
    var BLINK_MS           = 120;

    // Volume chip → backlight level, written once the chip settles.
    var LEVEL_WRITE_DELAY_MS = 700;
    function volumeToLevel(v) { return Math.max(1, Math.min(255, Math.round(v * 255 / 100))); }
    function levelToVolume(l) { return Math.max(0, Math.min(100, Math.round(l * 100 / 255))); }

    function isPttHeld() {
        return (window.input && typeof window.input.isHeld === 'function')
            ? window.input.isHeld('ptt') : false;
    }

    function WalkieTalkieDemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Walkie Talkie';
        this.breadcrumbTitle = 'Walkie Talkie';
        this._idleImg    = null;
        this._pressedImg = null;
        this._volume     = 50;
        this._volumeStep = 5;
    }

    WalkieTalkieDemoScene.prototype.enter = function() {
        var self = this;

        // LEDs in manual mode so the PTT blink sticks (restored on exit).
        this._sendLedManual(true);

        function load(src, slot) {
            var img = new Image();
            img.onload = function() { if (window.requestRender) window.requestRender(); };
            img.src = src;
            self[slot] = img;
        }
        load(IDLE_PATH,    '_idleImg');
        load(PRESSED_PATH, '_pressedImg');

        this._lastPttHeld = false;
        this._linkBlinkOn = false;
        // Receive cycle anchor; re-armed 1 s ahead on PTT release.
        this._rxAnimEpoch = Date.now();
        // Talk / silence loop anchor for channel 0.
        this._talkStart   = Date.now();

        this._signals = [
            // ch 0: the talker. SILENT_MS of nothing, then TALK_MS of
            // voice (80..100, breathing), forever.
            { y: 69, level: 0, samples: [], lastSampleAt: 0,
              compute: function(t) {
                  if (!self._isTalking(t)) return 0;
                  var v = 90 + 7 * Math.sin(t / 70) + 4 * Math.sin(t / 25);
                  return Math.round(Math.max(80, Math.min(100, v)));
              } },
            // ch 1: random 1..4 s bursts with 1 s pauses (as in the app).
            { y: 40, level: 0, samples: [], lastSampleAt: 0,
              _cycleStart: 0, _activeDur: 0,
              compute: function(t) {
                  var PAUSE_MS = 1000;
                  if (!this._activeDur) {
                      this._activeDur  = 1000 + Math.random() * 3000;
                      this._cycleStart = t;
                  }
                  var sinceStart = t - this._cycleStart;
                  if (sinceStart >= this._activeDur + PAUSE_MS) {
                      this._activeDur  = 1000 + Math.random() * 3000;
                      this._cycleStart = t;
                      sinceStart       = 0;
                  }
                  if (sinceStart >= this._activeDur) return 0;
                  var v = 75 + 15 * Math.sin(t / 95) + 10 * Math.sin(t / 40);
                  return Math.round(Math.max(50, Math.min(100, v)));
              } },
            // ch 2: constant low carrier.
            { y: 122, level: 0, samples: [], lastSampleAt: 0,
              compute: function() { return 20; } }
        ];

        // Backlight: take the brightness from the MCU so entering
        // doesn't change it, then start following the talk loop.
        this._blQueue      = [];
        this._blBusy       = false;
        this._screenOn     = null;     // last on/off state sent
        this._levelTimer   = null;
        this._backlight('GET', null, function(d) {
            if (d && d.ok && typeof d.level === 'number') {
                self._volume = levelToVolume(d.level);
                if (window.requestRender) window.requestRender();
            }
        });
        this._syncScreen(true);

        if (this._tickTimer) clearInterval(this._tickTimer);
        this._tickTimer = setInterval(function() {
            self._updatePttLed();
            self._updateAllSignalLevels();
            self._maybeCaptureSamples();
            self._syncScreen(false);
            if (window.requestRender) window.requestRender();
        }, 33);
    };

    // Position in the silence → talk loop.
    WalkieTalkieDemoScene.prototype._isTalking = function(t) {
        var pos = (t - this._talkStart) % (SILENT_MS + TALK_MS);
        if (pos < 0) pos += SILENT_MS + TALK_MS;
        return pos >= SILENT_MS;
    };

    // Send the backlight on/off state for the current phase. `force`
    // re-sends it even if unchanged (after a key press or level write
    // that may have woken the screen on the MCU side).
    WalkieTalkieDemoScene.prototype._syncScreen = function(force) {
        var on = this._isTalking(Date.now());
        if (!force && on === this._screenOn) return;
        this._screenOn = on;
        this._backlight('POST', { action: on ? 'always-on' : 'off' });
    };

    // /api/backlight calls, strictly one at a time and in order, so an
    // off can never overtake the level write it is meant to follow.
    WalkieTalkieDemoScene.prototype._backlight = function(method, body, cb) {
        this._blQueue.push({ method: method, body: body, cb: cb || null });
        this._blPump();
    };
    WalkieTalkieDemoScene.prototype._blPump = function() {
        var self = this;
        if (this._blBusy || !this._blQueue.length) return;
        var job = this._blQueue.shift();
        this._blBusy = true;
        function done(d) {
            self._blBusy = false;
            if (job.cb) job.cb(d);
            self._blPump();
        }
        try {
            var xhr = new XMLHttpRequest();
            xhr.open(job.method, '/api/backlight', true);
            xhr.timeout = 8000;
            if (job.body) xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = function() {
                var d = null;
                try { d = JSON.parse(xhr.responseText); } catch (e) {}
                done(d);
            };
            xhr.onerror = xhr.ontimeout = function() { done(null); };
            xhr.send(job.body ? JSON.stringify(job.body) : null);
        } catch (e) { done(null); }
    };

    // Debounced brightness write from the volume chip.
    WalkieTalkieDemoScene.prototype._scheduleLevelWrite = function() {
        var self = this;
        if (this._levelTimer) clearTimeout(this._levelTimer);
        this._levelTimer = setTimeout(function() {
            self._levelTimer = null;
            self._writeLevel();
        }, LEVEL_WRITE_DELAY_MS);
    };
    WalkieTalkieDemoScene.prototype._writeLevel = function() {
        this._backlight('POST', { level: volumeToLevel(this._volume) });
        // A level change lights the screen; restore the phase state.
        this._syncScreen(true);
    };

    WalkieTalkieDemoScene.prototype.exit = function() {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = null;
        }
        if (this._linkBlinkTimer) {
            clearInterval(this._linkBlinkTimer);
            this._linkBlinkTimer = null;
        }
        this._sendLinkLed(false);
        this._sendLedManual(false);
        // Flush a pending brightness change, then give the screen back
        // lit and under the MCU's normal idle timer.
        if (this._levelTimer) {
            clearTimeout(this._levelTimer);
            this._levelTimer = null;
            this._backlight('POST', { level: volumeToLevel(this._volume) });
        }
        this._screenOn = null;
        this._backlight('POST', { action: 'on' });
        this._lastPttHeld = false;
        this._linkBlinkOn = false;
        this._idleImg     = null;
        this._pressedImg  = null;
    };

    // Newest sample at index 0; the tape is clipped to MAX_SAMPLES.
    WalkieTalkieDemoScene.prototype._maybeCaptureSamples = function() {
        var now = Date.now();
        for (var i = 0; i < this._signals.length; i++) {
            var s = this._signals[i];
            if (now - (s.lastSampleAt || 0) < SAMPLE_INTERVAL_MS) continue;
            s.lastSampleAt = now;
            s.samples.unshift(s.level || 0);
            if (s.samples.length > MAX_SAMPLES) s.samples.length = MAX_SAMPLES;
        }
    };

    // Everything reads 0 while transmitting and during the 1 s
    // lead-in after PTT release; otherwise each channel decides.
    WalkieTalkieDemoScene.prototype._updateAllSignalLevels = function() {
        var t = Date.now();
        var elapsed = t - (this._rxAnimEpoch || t);
        var held = isPttHeld();
        for (var i = 0; i < this._signals.length; i++) {
            var s = this._signals[i];
            s.level = (held || elapsed < 0) ? 0 : s.compute(t, elapsed);
        }
    };

    // Red blinking Link LED while PTT is held; only posts on change.
    WalkieTalkieDemoScene.prototype._updatePttLed = function() {
        var held = isPttHeld();
        if (held === this._lastPttHeld) return;
        this._lastPttHeld = held;
        var self = this;
        if (held) {
            this._linkBlinkOn = true;
            this._sendLinkLed(true);
            if (this._linkBlinkTimer) clearInterval(this._linkBlinkTimer);
            this._linkBlinkTimer = setInterval(function() {
                self._linkBlinkOn = !self._linkBlinkOn;
                self._sendLinkLed(self._linkBlinkOn);
            }, BLINK_MS);
        } else {
            if (this._linkBlinkTimer) {
                clearInterval(this._linkBlinkTimer);
                this._linkBlinkTimer = null;
            }
            this._linkBlinkOn = false;
            this._sendLinkLed(false);
            this._rxAnimEpoch = Date.now() + 1000;
        }
    };

    WalkieTalkieDemoScene.prototype._sendLinkLed = function(on) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/led/set', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send(JSON.stringify({ led: 'link', r: on ? 255 : 0, g: 0, b: 0, on: !!on }));
        } catch (e) { /* offline, ignore */ }
    };

    WalkieTalkieDemoScene.prototype._sendLedManual = function(enabled) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/led/manual', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send(JSON.stringify({ enabled: !!enabled }));
        } catch (e) { /* offline, ignore */ }
    };

    WalkieTalkieDemoScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
        // The press woke the screen on the MCU; put the phase state back.
        this._syncScreen(true);
        // "Volume" chip = screen brightness in the demo.
        if (action === 'up' || action === 'down') {
            var d = action === 'up' ? this._volumeStep : -this._volumeStep;
            var next = Math.max(0, Math.min(100, this._volume + d));
            if (next !== this._volume) {
                this._volume = next;
                this._scheduleLevelWrite();
            }
            if (window.requestRender) window.requestRender();
        }
    };

    WalkieTalkieDemoScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        canvas.clear('#fff');
        if (this._idleImg && this._idleImg.complete && this._idleImg.naturalWidth > 0) {
            ctx.drawImage(this._idleImg, 0, 0);
        }
        if (isPttHeld() && this._pressedImg
                && this._pressedImg.complete && this._pressedImg.naturalWidth > 0) {
            ctx.drawImage(this._pressedImg, 0, 0);
        }

        // Big vertical receive bar, driven by channel 0.
        var RX_BAR_X = 63, RX_BAR_Y = 29, RX_BAR_W = 3, RX_BAR_MAX_H = 85;
        var ch0lvl = (this._signals && this._signals[0] && this._signals[0].level) || 0;
        var h = Math.round(ch0lvl * RX_BAR_MAX_H / 100);
        if (h > 0) {
            ctx.fillStyle = '#000';
            ctx.fillRect(RX_BAR_X, RX_BAR_Y + RX_BAR_MAX_H - h, RX_BAR_W, h);
        }

        // Volume chip: gray base, black fill from the bottom, value
        // rotated 90° CCW with split-colour clipping.
        var VOL_CHIP_X = 197, VOL_CHIP_Y = 5, VOL_CHIP_W = 11, VOL_CHIP_H = 83, VOL_CHIP_R = 3;
        var visFrac  = Math.max((this._volume || 0) / 100, 0.05);
        var fillH    = Math.round(VOL_CHIP_H * visFrac);
        var fillFull = fillH >= VOL_CHIP_H;
        var fillY    = VOL_CHIP_Y + VOL_CHIP_H - fillH;

        new ResponsiveFrame({
            x: VOL_CHIP_X, y: VOL_CHIP_Y, width: VOL_CHIP_W, height: VOL_CHIP_H,
            anchorH: 'left', anchorV: 'top', showStroke: false,
            fillColor: '#E5E5E5', showFill: true, cornerRadius: VOL_CHIP_R,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        if (fillH > 0) {
            new ResponsiveFrame({
                x: VOL_CHIP_X, y: fillY, width: VOL_CHIP_W, height: fillH,
                anchorH: 'left', anchorV: 'top', showStroke: false,
                fillColor: '#000', showFill: true, cornerRadius: VOL_CHIP_R,
                corners: { tl: fillFull, tr: fillFull, bl: true, br: true }
            }).render(canvas);
        }

        var valStr = String(Math.round(this._volume || 0));
        var halfW  = Math.floor(HaxrCorp4090FlipCTL.textWidth(valStr) / 2);
        var halfH  = Math.floor(9 / 2);
        var cx     = Math.floor(VOL_CHIP_X + VOL_CHIP_W / 2) - 1;
        var cy     = Math.floor(VOL_CHIP_Y + VOL_CHIP_H / 2);
        if (fillH > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(VOL_CHIP_X, fillY, VOL_CHIP_W, fillH);
            ctx.clip();
            ctx.translate(cx, cy);
            ctx.rotate(-Math.PI / 2);
            HaxrCorp4090FlipCTL.draw(ctx, valStr, -halfW, -halfH, '#FFFFFF');
            ctx.restore();
        }
        if (!fillFull) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(VOL_CHIP_X, VOL_CHIP_Y, VOL_CHIP_W, fillY - VOL_CHIP_Y);
            ctx.clip();
            ctx.translate(cx, cy);
            ctx.rotate(-Math.PI / 2);
            HaxrCorp4090FlipCTL.draw(ctx, valStr, -halfW, -halfH, '#000000');
            ctx.restore();
        }

        // Per-channel sliver (right-anchored) + sampler tape
        // (1×2 grey per sample, newest on the left).
        var HBAR_X = 145, HBAR_H = 2, HBAR_MAX_W = 12, SAMPLER_X = 160, SAMPLER_H = 2;
        var signals = this._signals || [];
        for (var ci = 0; ci < signals.length; ci++) {
            var ch  = signals[ci];
            var lvl = ch.level || 0;
            var w   = Math.round(lvl * HBAR_MAX_W / 100);
            if (w > 0) {
                ctx.fillStyle = '#000';
                ctx.fillRect(HBAR_X + HBAR_MAX_W - w, ch.y, w, HBAR_H);
            }
            for (var si = 0; si < ch.samples.length; si++) {
                var sg = Math.max(0, Math.min(255, Math.round(255 * (100 - ch.samples[si]) / 100)));
                ctx.fillStyle = 'rgb(' + sg + ',' + sg + ',' + sg + ')';
                ctx.fillRect(SAMPLER_X + si, ch.y, 1, SAMPLER_H);
            }
        }
    };

    return WalkieTalkieDemoScene;
})();
