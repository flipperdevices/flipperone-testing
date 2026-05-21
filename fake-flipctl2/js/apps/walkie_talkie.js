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

    // ── Animation sequence for Signal_level_01 ────────────────────
    // Channel 0's "real-audio" path runs a hand-authored timeline
    // synced to each iteration of 415_audio.wav. Each entry is an
    // inclusive-start, exclusive-end millisecond range during which
    // the bar fluctuates 80..100; everything outside the ranges
    // (and the inter-iteration gap) reads as silent 0.
    //
    // The audio loop is `WALKIE_AUDIO_DUR_MS` of audio followed by
    // `WALKIE_AUDIO_GAP_MS` of silence while the server respawns
    // sox — modulo-wrapping `t - _audioStart` against the sum
    // restarts the sequence at the top of every iteration.
    var WALKIE_AUDIO_DUR_MS = 17920;
    var WALKIE_AUDIO_GAP_MS = 80;
    var WALKIE_AUDIO_ACTIVE_RANGES = [
        [    0,  3280],
        [ 4950,  8140],
        [ 9120, 13400],
        [13720, 16990]
    ];

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
        // Master volume mirrors Internet Radio's slider model: an
        // integer 0..100 that we hydrate from the codec on enter
        // and push back via /api/sound/volume on every adjust.
        // 50 is a safe placeholder for the first paint before
        // the GET lands.
        this._volume         = 50;
        this._volumeStep     = 5;
        // Optimistic codec presence flag — we assume the NAU8822
        // is wired up until /api/sound/outputs tells us otherwise
        // (no `speaker`/`headphone` entries → no on-board codec).
        // When false, channel 0's compute switches from the
        // audio-envelope path to the legacy fake animation so the
        // bar still moves even though nothing is playing.
        this._hasNau8822     = true;
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

        // Route audio to the on-board NAU8822 speaker — same
        // trick Internet Radio uses on its audio-device picker.
        // The server's `speaker` id maps to the NAU8822 card, so
        // a single POST swings selectedAlsaDevice over before we
        // kick off the loop a moment later. The XHRs race, but
        // even in the worst case the first sox spawn grabs the
        // previous device and the next respawn picks up the new
        // one — 17.9 s of audio at worst.
        this._setAudioOutput('speaker');
        // Kick off the looping playback. Server-side handles the
        // respawn-on-exit so the WAV repeats seamlessly while
        // the scene is alive; exit() tears it down.
        this._startWalkieAudio();
        // Pull the live master volume off the codec so the
        // on-screen vertical bar reflects what amixer actually
        // reports (instead of the constructor placeholder).
        // Speaker / Headphone share the same NAU8822 control —
        // same priority order as Internet Radio.
        this._fetchVolume();
        // Probe whether the NAU8822 codec is actually present. The
        // response feeds the `_hasNau8822` flag that channel 0's
        // compute checks every tick — when false, we fall back to
        // the fake time-based animation so the bar still moves
        // even though no real audio is playing.
        this._checkAudioCapability();

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
        //     Tracks the audio envelope of 415_audio.wav — silent
        //     bins read 0, active bins animate 80..100. Anchored
        //     to `_audioStart` (set when the loop starts) and
        //     wraps every WALKIE_AUDIO_DUR_MS + GAP_MS.
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
        // Channel 0's compute is built inside enter() so it can
        // close over `self` and check the codec-presence flag on
        // every tick. The two branches are kept side-by-side:
        //   • NAU8822 present → hand-authored timeline driven by
        //     `_audioStart` so the bar follows the audio loop.
        //   • NAU8822 missing → legacy 4 s fake cycle (2 s silent
        //     / 2 s active around 60 ±10) so the UI still moves.
        var ch0Compute = function(t, elapsed) {
            if (self._hasNau8822 === false) {
                var phase = elapsed % 4000;
                if (phase < 2000) return 0;
                var fv = 60
                    + 6 * Math.sin(t / 80)
                    + 4 * Math.sin(t / 30);
                return Math.round(fv);
            }
            // `this` inside is the channel object (called as
            // `s.compute(...)` from _updateAllSignalLevels) — that
            // lets us pull `_audioStart` straight off the row.
            var start = this._audioStart || (t - elapsed);
            var posInCycle = (t - start) % (WALKIE_AUDIO_DUR_MS + WALKIE_AUDIO_GAP_MS);
            if (posInCycle < 0) posInCycle += (WALKIE_AUDIO_DUR_MS + WALKIE_AUDIO_GAP_MS);
            // During the inter-iteration gap nothing is playing
            // on the speaker → flatline.
            if (posInCycle >= WALKIE_AUDIO_DUR_MS) return 0;
            // Inside the audio iteration: scan the active-range
            // table. Outside every range = silent. Modulo wrap
            // above is what restarts the sequence at every new
            // loop iteration.
            var inActive = false;
            for (var ri = 0; ri < WALKIE_AUDIO_ACTIVE_RANGES.length; ri++) {
                var r = WALKIE_AUDIO_ACTIVE_RANGES[ri];
                if (posInCycle >= r[0] && posInCycle < r[1]) {
                    inActive = true;
                    break;
                }
            }
            if (!inActive) return 0;
            // Active window — animate 80..100 with two sine
            // beats so the bar visibly breathes instead of
            // flatlining at a single number.
            var v = 90
                + 7 * Math.sin(t / 70)
                + 4 * Math.sin(t / 25);
            if (v < 80)  v = 80;
            if (v > 100) v = 100;
            return Math.round(v);
        };
        this._signals = [
            { y: 69, level: 0, samples: [], lastSampleAt: 0,
              // `_audioStart` is the wall-clock time the current
              // loop iteration anchors against — written when
              // _startWalkieAudio fires. Until set, fall back to
              // the scene's `_rxAnimEpoch` so the lookup still
              // produces sensible (if drifted) values on the
              // first paint.
              _audioStart: 0,
              compute: ch0Compute },
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
        // Anchor channel 0's envelope lookup to roughly when the
        // server-side sox process starts. We POSTed /api/walkie/play
        // a few statements ago; the XHR + spawn add some latency,
        // but the loop is 18 s so a sub-100 ms offset is invisible
        // visually.
        this._signals[0]._audioStart = Date.now();

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
        // If the user exits while still holding PTT, the mixer
        // is sitting at 0. Push the chip's value back so the
        // next app / system audio doesn't open onto a silent
        // codec.
        this._setMixerVolume(this._volume);
        // Tear down the looping playback so the audio doesn't
        // outlive the scene. Idempotent on the server, so it's
        // safe even if the loop never managed to start.
        this._stopWalkieAudio();
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
            // Mute the audio at the mixer (volume 0 on both
            // Speaker and Headphone) without touching the
            // on-screen chip — the user's chosen volume stays
            // visible while transmitting, audio just goes
            // silent. The server-side sox loop keeps running
            // so we resume mid-loop on release, matching real
            // walkie talkie "can't hear while you talk" UX.
            this._setMixerVolume(0);
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
            // Restore the mixer to the volume the chip is
            // showing — the user can still adjust the slider
            // mid-press and the new value lands here.
            this._setMixerVolume(this._volume);
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

    // Route audio to a known output by id ('speaker' for the
    // on-board NAU8822). Fire-and-forget — the scene doesn't
    // wait for the response since the next call (start loop)
    // re-reads selectedAlsaDevice fresh on every sox spawn.
    WalkieTalkieScene.prototype._setAudioOutput = function(id) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/sound/output', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send(JSON.stringify({ id: id }));
        } catch (e) { /* mocked server / offline — ignore */ }
    };

    // Start / stop the server-side looping playback of
    // 415_audio.wav. Both are fire-and-forget and idempotent on
    // the server.
    WalkieTalkieScene.prototype._startWalkieAudio = function() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/walkie/play', true);
            xhr.timeout = 1500;
            xhr.send();
        } catch (e) { /* mocked server / offline — ignore */ }
    };

    WalkieTalkieScene.prototype._stopWalkieAudio = function() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/walkie/stop', true);
            xhr.timeout = 1500;
            xhr.send();
        } catch (e) { /* mocked server / offline — ignore */ }
    };

    // Detect whether the NAU8822 codec is wired up. The server's
    // /api/sound/outputs only emits `speaker` / `headphone`
    // entries when that card is present (those are the two
    // splits the codec exposes); their absence means no on-board
    // codec and therefore no audio playback. We flip
    // `_hasNau8822` to false in that case so channel 0 reverts
    // to the legacy fake animation. A failed XHR leaves the
    // optimistic default in place — no signal beats a misfire
    // that would unexpectedly mute the visualizer.
    WalkieTalkieScene.prototype._checkAudioCapability = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/sound/outputs', true);
            xhr.timeout = 3000;
            xhr.onload = function() {
                if (xhr.status !== 200) return;
                try {
                    var d = JSON.parse(xhr.responseText);
                    var outs = (d && d.outputs) || [];
                    var hasCodec = false;
                    for (var i = 0; i < outs.length; i++) {
                        if (outs[i].id === 'speaker' || outs[i].id === 'headphone') {
                            hasCodec = true;
                            break;
                        }
                    }
                    self._hasNau8822 = hasCodec;
                    if (typeof window.requestRender === 'function') {
                        window.requestRender();
                    }
                } catch (e) {}
            };
            xhr.send();
        } catch (e) { /* mocked server / offline — ignore */ }
    };

    // Hydrate `_volume` from the codec. Prefers Speaker (the
    // route we just selected via /api/sound/output) and falls
    // back to Headphone — matches the priority order Internet
    // Radio uses for the same hydration step. Failures leave
    // the constructor placeholder in place so the bar stays
    // interactive even when amixer isn't reachable.
    WalkieTalkieScene.prototype._fetchVolume = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/sound/volume', true);
            xhr.timeout = 3000;
            xhr.onload = function() {
                if (xhr.status !== 200) return;
                try {
                    var d = JSON.parse(xhr.responseText);
                    if (typeof d.speaker === 'number')        self._volume = d.speaker;
                    else if (typeof d.headphone === 'number') self._volume = d.headphone;
                    if (typeof window.requestRender === 'function') {
                        window.requestRender();
                    }
                } catch (e) {}
            };
            xhr.send();
        } catch (e) { /* mocked server / offline — ignore */ }
    };

    // Push a new volume to BOTH Speaker and Headphone so the
    // slider behaves like a master regardless of which output
    // we've routed to. Updates `_volume` optimistically; a
    // failed amixer call doesn't roll back — the user can keep
    // adjusting without UI flicker. Mirrors InternetRadio's
    // `_setVolume` shape exactly.
    WalkieTalkieScene.prototype._setVolume = function(pct) {
        pct = Math.max(0, Math.min(100, pct));
        this._volume = pct;
        this._setMixerVolume(pct);
        if (typeof window.requestRender === 'function') {
            window.requestRender();
        }
    };

    // Lower-level mixer write that does NOT touch `_volume` —
    // used by the PTT-mute path (push 0 on press, restore the
    // local value on release) so the on-screen chip keeps
    // showing the user's chosen level while the hardware
    // temporarily drops to 0.
    WalkieTalkieScene.prototype._setMixerVolume = function(pct) {
        pct = Math.max(0, Math.min(100, pct));
        ['Speaker', 'Headphone'].forEach(function(ctrl) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/sound/volume', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.timeout = 3000;
                xhr.send(JSON.stringify({ control: ctrl, volume: pct }));
            } catch (e) { /* mocked server / offline — ignore */ }
        });
    };

    WalkieTalkieScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
        // Volume bumps: ±_volumeStep per press, clamped 0..100,
        // fire-and-forget POST to the mixer. Only up / down are
        // wired so the binding matches the chip's vertical fill
        // direction (up = louder, down = softer). Left / right
        // are intentionally ignored.
        if (action === 'up') {
            this._setVolume(this._volume + this._volumeStep);
            return;
        }
        if (action === 'down') {
            this._setVolume(this._volume - this._volumeStep);
            return;
        }
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
        // Volume slider — vertical port of Internet Radio's
        // slider chip. Two ResponsiveFrames stacked:
        //   (1) Gray base (E5E5E5), rounded 3-px corners.
        //   (2) Black fill anchored at the BOTTOM, height
        //       proportional to `_volume`. Bottom corners always
        //       rounded so they meet the gray chip's curvature;
        //       top corners square unless the fill reaches the
        //       top (full 100 %).
        // The numeric value sits in the middle of the chip with
        // split-colour clipping — white glyphs over the black
        // fill, black glyphs over the gray remainder — same
        // trick MenuDropdownLine uses on the horizontal chip.
        var VOL_CHIP_X = 197;
        var VOL_CHIP_Y = 5;
        var VOL_CHIP_W = 11;
        var VOL_CHIP_H = 83;
        var VOL_CHIP_R = 3;
        // Mirror MenuDropdownLine's 5 % visible floor so the
        // chip always shows a small black nub at the bottom
        // even at volume 0 — gives the user an anchor.
        var pct       = (this._volume || 0) / 100;
        var minFrac   = 0.05;
        var visFrac   = Math.max(pct, minFrac);
        var fillH     = Math.round(VOL_CHIP_H * visFrac);
        var fillFull  = fillH >= VOL_CHIP_H;
        var fillY     = VOL_CHIP_Y + VOL_CHIP_H - fillH;

        // (1) Gray base.
        new ResponsiveFrame({
            x:           VOL_CHIP_X, y:      VOL_CHIP_Y,
            width:       VOL_CHIP_W, height: VOL_CHIP_H,
            anchorH:     'left',     anchorV:'top',
            showStroke:  false,
            fillColor:   '#E5E5E5',  showFill: true,
            cornerRadius: VOL_CHIP_R,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);

        // (2) Black fill from the bottom.
        if (fillH > 0) {
            new ResponsiveFrame({
                x:           VOL_CHIP_X, y:      fillY,
                width:       VOL_CHIP_W, height: fillH,
                anchorH:     'left',     anchorV:'top',
                showStroke:  false,
                fillColor:   '#000',     showFill: true,
                cornerRadius: VOL_CHIP_R,
                corners: {
                    tl: fillFull, tr: fillFull,
                    bl: true,     br: true
                }
            }).render(canvas);
        }

        // (3 + 4) Centred value text, rotated 90° counter-
        // clockwise so the digits read from bottom to top inside
        // the narrow vertical chip. Approach: clip first (in
        // screen coords) → translate to the chip's centre →
        // rotate → draw the glyphs offset by half their unrotated
        // size so they're centred on the pivot. The clip path is
        // captured before the rotation transform applies, so it
        // stays axis-aligned with the chip's actual bounds.
        var valStr  = String(Math.round(this._volume || 0));
        var valW    = HaxrcorpFont16.textWidth(valStr);
        var valHCap = 9;                 // visible glyph height
        // All four anchor values are floored to integers so the
        // glyph pixels land on whole-pixel screen positions after
        // the rotate transform — half-pixel offsets here would
        // smear each fillRect across two columns / rows and the
        // text reads blurry. Trade-off: when the chip and text
        // dimensions are both odd (e.g. width 11 / valW 11) the
        // glyph block is 0.5 px off geometric centre in one axis,
        // which is invisible at integer pixels but means perfect
        // centring isn't possible without sub-pixel rendering.
        var halfW   = Math.floor(valW / 2);
        var halfH   = Math.floor(valHCap / 2);
        // Pivot for the rotated text. Nudged 1 px left of the
        // chip's geometric centre so the digits sit a touch more
        // toward the chip's left edge — visually balances the
        // glyph weight inside the narrow 11-px-wide chamber.
        var cx      = Math.floor(VOL_CHIP_X + VOL_CHIP_W / 2) - 1;
        var cy      = Math.floor(VOL_CHIP_Y + VOL_CHIP_H / 2);

        var ctx2 = canvas.ctx;
        // White text clipped to the black fill region.
        if (fillH > 0) {
            ctx2.save();
            ctx2.beginPath();
            ctx2.rect(VOL_CHIP_X, fillY, VOL_CHIP_W, fillH);
            ctx2.clip();
            ctx2.translate(cx, cy);
            ctx2.rotate(-Math.PI / 2);
            HaxrcorpFont16.draw(ctx2, valStr, -halfW, -halfH, '#FFFFFF');
            ctx2.restore();
        }
        // Black text clipped to the gray remainder.
        if (!fillFull) {
            ctx2.save();
            ctx2.beginPath();
            ctx2.rect(VOL_CHIP_X, VOL_CHIP_Y, VOL_CHIP_W, fillY - VOL_CHIP_Y);
            ctx2.clip();
            ctx2.translate(cx, cy);
            ctx2.rotate(-Math.PI / 2);
            HaxrcorpFont16.draw(ctx2, valStr, -halfW, -halfH, '#000000');
            ctx2.restore();
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
