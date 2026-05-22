/**
 * Voice recorder — fresh stub.
 *
 * Everything from the previous Wi-Fi-style list / detail-modal /
 * RecordingScene implementation has been removed. This file is
 * intentionally minimal so the UI can be rebuilt from scratch on
 * top of it. The scene still registers with the App Switcher and
 * exits on Back so navigation works while we wire the new UI.
 */
var VoiceRecorderScene = (function() {
    function VoiceRecorderScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Voice recorder';
        this.breadcrumbTitle = 'Voice recorder';
        // Opt in to App-Switcher app handling so killing this
        // scene from the switcher splices it out of the
        // navigation stack cleanly.
        this._isApp          = true;
        this.icon            = (typeof Icons !== 'undefined' && Icons.voice_recorder)
                                ? Icons.voice_recorder
                                : null;
        // Latest per-channel mic levels, 0..100. Updated by SSE
        // pushes from /api/mic/level/stream; read by render() to
        // size the black fill inside each meter frame.
        this._micLeft   = 0;
        this._micRight  = 0;
        this._micEventSource = null;

        // Input-device picker. Mirrors the dropdown-row shape
        // Internet Radio uses for its Audio device row: a
        // MenuDropdownLine paired with a wrapping selector
        // outline, left/right cycles options. The wired-up
        // device-routing piece comes later — for now we just
        // hold the current selection in scene state.
        // Picker registry — every dropdown / cycle row reads its
        // options + current value out of this map. Key matches
        // the entry in `_rowPickerKey()` below, and the
        // dropdown overlay uses `_dropdownKey` to know which
        // picker it's editing.
        this._pickers = {
            inputDevice: {
                // Populated on enter() by _fetchInputDevices()
                // from /api/sound/inputs. While the fetch is in
                // flight the row shows a single "Loading…" entry
                // so it never reads as blank; if the codec card
                // isn't present the server returns an error
                // string we surface as the only option (e.g.
                // "NAU8822 not found") instead of stale fakes.
                options: ['Loading…'],
                current: 'Loading…'
            },
            format: {
                options: ['WAV', 'MP3'],
                current: 'WAV'
            }
        };

        // Input gain — plain ± row, no dropdown. Range and step
        // are conservative starter values; the actual codec
        // probably accepts a wider window. Defaults to +0 dB.
        this._inputGainDb   = 0;
        this._inputGainMin  = -20;
        this._inputGainMax  = 40;
        this._inputGainStep = 1;

        // File name — opens TextInputScreen on OK. Left / right
        // do nothing on this row; the chevron on the selector
        // frame is the affordance signalling "press OK to edit".
        this._fileName = 'F1_record_1';

        // Folder — drill-in row, no behaviour wired yet. Visual
        // structure mirrors File name (chevron selector frame,
        // OK is the future open trigger) so the eventual editor
        // can slot in without UI shuffling.
        this._folderName = 'Recording';

        // Timecode — display-only drill-in row, no behaviour
        // wired yet. Same chevron-selector treatment as File
        // name / Folder so it slots into the eventual editor
        // path without a layout shuffle. "HH:MM:SS:FF" shape so
        // the placeholder reads as a real timecode field.
        this._timecode = '00:00:00:00';

        // Focused-row index for up / down navigation between
        // the menu lines below the meters.
        //   0 → Input gain     (inline ± row)
        //   1 → Input device   (dropdown row)
        //   2 → File name      (chevron drill-in row)
        //   3 → Folder         (chevron drill-in row, stub)
        //   4 → Format         (dropdown row, plain selector)
        //   5 → Timecode       (chevron drill-in row, stub)
        this._selectedRow = 0;

        // Dropdown overlay state — copied from Internet Radio:
        //   `_dropdownOpen`  flips to true on OK over a
        //                    picker row,
        //   `_dropdownKey`   names which picker is being
        //                    edited (matches a key in
        //                    `_pickers`),
        //   `_dropdownIndex` highlighted option index inside
        //                    the open list.
        // OK commits whichever index is highlighted; Back / Esc
        // close without committing (revert).
        this._dropdownOpen   = false;
        this._dropdownKey    = null;
        this._dropdownIndex  = 0;
        // Shared selector outline — same dimensions Internet
        // Radio uses (SELECTOR_X=2, W=252, H=15, dropped 1 px
        // below the row top so it visually centres on the chip).
        this._selectorFrame = new MenuSelectorFrame({
            x: 2, y: 0, width: 252, height: 15,
            anchorH: 'left',   anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
        // Chevron-bearing selector — used on the File name row
        // (drill-in to TextInputScreen). The chevron paints a
        // "tap to open" affordance flush against the row's
        // right edge.
        this._chevronSelectorFrame = new ComponentSelectorFrame({
            x: 2, y: 0, width: 252, height: 15,
            anchorH: 'left',   anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false,
            cornerRadius:  3,
            showChevron:   true,
            chevronWidth:  7
        });
        // Smaller selector outline that lives INSIDE the
        // dropdown overlay. Width is patched per-render to
        // match the dropdown body's width (CHIP_WIDTH minus 1
        // on the right to dodge the bottom-right shadow pixel
        // MenuSelectorFrame paints — same trick Internet Radio
        // applies).
        this._dropdownInnerSelector = new MenuSelectorFrame({
            x: 0, y: 0, width: 1, height: 15,
            anchorH: 'left',   anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });

        // Left-side app-defined button — "Home". Wired to the
        // 'esc' action (which `input.js` maps to the 'z' key)
        // so pressing 'z' anywhere in the scene flashes the
        // button and pops the stack back to Desktop via
        // SceneManager.popToRoot. Width 48 matches Internet
        // Radio's right-side button for visual rhythm.
        var self = this;
        this._homeBtn = new UI.LeftButton('Home', 48, 'esc',
            function() {
                if (self.sceneManager
                        && typeof self.sceneManager.popToRoot === 'function') {
                    self.sceneManager.popToRoot();
                }
            });

        // Middle app-defined button — "Files". Slot index 1
        // (x = 1*(48+2) = 50) so it sits just right of the
        // Home button with a 2-px gap, matching the bottom-row
        // pattern in boot_menu_ui_demo. Wired to the 'edit'
        // action which `input.js` maps to the 'x' key. Only
        // visible OUT of recording mode — Pause takes over the
        // middle slot 3 while recording instead.
        this._filesBtn = new UI.MiddleButton('Files', 1, 48, 2, 'edit',
            function() { /* not wired yet */ });

        // "Pause" middle button — only rendered / wired while
        // `_recording` is true; takes over from Files in the
        // visible bottom row during a recording session. Bound
        // to the 'del' action which `input.js` maps to the 'v'
        // key. Slot index is irrelevant — we override `x`
        // straight after construction so the button's RIGHT
        // edge sits 52 px from the screen's right edge
        // (button x = canvas.w - 52 - 48 = 156). That leaves a
        // 4-px gap between Pause's right edge and Start's left
        // edge.
        this._pauseBtn = new UI.MiddleButton('Pause', 0, 48, 2, 'del',
            function() {
                // Only meaningful while recording; outside of
                // that the button isn't even rendered, but
                // guard anyway in case the input dispatch fires
                // it in an edge case.
                if (!self._recording) return;
                self._togglePause();
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            });
        this._pauseBtn.x = 156;

        // `true` while we're "recording" — collapses rows 2..5
        // (File name / Folder / Format / Timecode) and reveals a
        // placeholder ResponsiveFrame in their place. Toggled by
        // the Start / Stop right button.
        this._recording = false;

        // Timecode anchor + tick. `_recordStartTime` is set on
        // each Start press; `_recordTickTimer` runs while
        // recording so the rendered HH:MM:SS:FF display tracks
        // wall-clock time. Stopping recording clears the tick;
        // the next Start re-anchors to the press moment.
        this._recordStartTime = 0;
        this._recordTickTimer = null;
        // Pause sub-state of recording. `_paused` flips on each
        // Pause press while `_recording` is true; the timecode
        // tick stops and the lamp icon swaps to recording_pause.
        // `_pausedElapsed` captures the ms elapsed at pause time
        // so resuming re-anchors `_recordStartTime` without
        // losing the in-flight take.
        this._paused        = false;
        this._pausedElapsed = 0;

        // Right app-defined button — "Start" / "Stop". Flush
        // with the right screen edge, width 48 to match Internet
        // Radio's Play button. Wired to the 'run' action (the
        // device's primary-action key, mapped from 'b' in
        // input.js). Pressing it toggles `_recording`, which
        // also swaps the button label between Start and Stop on
        // the next render (text is rewritten in render()).
        this._startBtn = new UI.RightButton('Start', 48, 'run',
            function() {
                self._recording = !self._recording;
                // While recording the only visible row is Input
                // gain (row 0). Snap focus to it on start so
                // the selector doesn't hover over nothing.
                if (self._recording && self._selectedRow >= 1) {
                    self._selectedRow = 0;
                }
                // Link LED follows the recording state: take
                // LEDs into manual mode + light red on Start,
                // drop the colour + release manual on Stop.
                self._applyRecordingLed();
                // Anchor / clear the running timecode. Start
                // resets the take from 00:00:00:00 (anchor +
                // pause state both cleared); Stop just halts
                // the tick.
                if (self._recording) {
                    self._recordStartTime = Date.now();
                    self._paused          = false;
                    self._pausedElapsed   = 0;
                    self._startRecordTick();
                } else {
                    self._stopRecordTick();
                    self._paused          = false;
                }
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            });
    }

    VoiceRecorderScene.prototype.enter = function() {
        var self = this;
        // Register with the global recents stack so the App
        // Switcher picks Voice Recorder up on the next Tab.
        if (typeof RunningApps !== 'undefined') {
            RunningApps.open(this.displayName, null, this.icon,
                function(sm) { return new VoiceRecorderScene(sm); },
                function() {
                    self._closeMicStream();
                    self._stopMicMonitor();
                    // Switcher kill: drop the LED back to auto
                    // so the red recording cue can't outlive
                    // the scene if the user nukes it mid-take.
                    self._sendLinkLed(false);
                    self._sendLedManual(false);
                    self._stopRecordTick();
                });
        }
        // Kick the server-side arecord monitor and open one
        // long-lived SSE connection. Replaces the previous
        // 50-ms XHR poll — the server now pushes updates from
        // inside the arecord chunk handler so the Node event
        // loop isn't doing 20 req/sec of HTTP overhead while
        // the user sits on this page.
        this._startMicMonitor();
        this._openMicStream();
        this._fetchInputDevices();
    };

    VoiceRecorderScene.prototype.exit = function() {
        this._closeMicStream();
        this._stopMicMonitor();
        this._micLeft = 0;
        this._micRight = 0;
        // Tear down the running timecode tick so it doesn't
        // keep firing requestRender after the scene leaves.
        this._stopRecordTick();
        // Drop the LED back to auto on exit so the red
        // recording cue never strays past the scene's lifetime,
        // even if the user backs out without hitting Stop
        // first.
        this._sendLinkLed(false);
        this._sendLedManual(false);
    };

    // Fire-and-forget kickoff / teardown for the server-side
    // arecord process. Both are idempotent on the server.
    VoiceRecorderScene.prototype._startMicMonitor = function() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/mic/level/start', true);
            xhr.timeout = 1500;
            xhr.send();
        } catch (e) { /* mocked server / offline — ignore */ }
    };
    VoiceRecorderScene.prototype._stopMicMonitor = function() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/mic/level/stop', true);
            xhr.timeout = 1500;
            xhr.send();
        } catch (e) { /* mocked server / offline — ignore */ }
    };
    // Opens the SSE stream. `EventSource` auto-reconnects on
    // transport blips so we don't need to wire retry logic
    // ourselves — set `_micEventSource` once and let it run.
    VoiceRecorderScene.prototype._openMicStream = function() {
        var self = this;
        if (this._micEventSource) return;
        if (typeof EventSource === 'undefined') return;
        try {
            this._micEventSource = new EventSource('/api/mic/level/stream');
        } catch (e) {
            this._micEventSource = null;
            return;
        }
        this._micEventSource.onmessage = function(ev) {
            try {
                var d = JSON.parse(ev.data);
                if (typeof d.left  === 'number') self._micLeft  = d.left;
                if (typeof d.right === 'number') self._micRight = d.right;
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            } catch (e) {}
        };
        // Transport-level error fires when the connection drops;
        // EventSource handles the reconnect on its own. We just
        // need to make sure we don't leak the previous handle if
        // the browser decides to discard it.
        this._micEventSource.onerror = function() {
            // Leave the EventSource attached — it'll re-attempt
            // automatically. No state change needed.
        };
    };
    VoiceRecorderScene.prototype._closeMicStream = function() {
        if (!this._micEventSource) return;
        try { this._micEventSource.close(); } catch (e) {}
        this._micEventSource = null;
    };

    // Pull the real input-source list from the server and rewrite
    // the Input device picker in place. On success the picker
    // options become the labels reported by /api/sound/inputs
    // (e.g. "Internal mic", "Headset mic") and `current` snaps
    // to whichever entry the server says the codec mux is on so
    // first paint matches reality. On a server error
    // (`NAU8822 not found`) or a transport failure that single
    // string takes the picker over so the row surfaces the
    // actual reason instead of showing stale fakes.
    //
    // The raw [{id,label}] list is also retained on `_inputDevices`
    // so _postInputDevice can map the user-visible label back to
    // an id for /api/sound/input mutations.
    VoiceRecorderScene.prototype._fetchInputDevices = function() {
        var self = this;
        function applyFailure(label) {
            self._inputDevices = [];
            var picker = self._pickers.inputDevice;
            picker.options = [label];
            picker.current = label;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
        }
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/sound/inputs', true);
            xhr.timeout = 1500;
            xhr.onload = function() {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { applyFailure('NAU8822 not found'); return; }
                if (data.error || !data.inputs || !data.inputs.length) {
                    applyFailure(data.error || 'No inputs');
                    return;
                }
                self._inputDevices = data.inputs;
                var picker = self._pickers.inputDevice;
                picker.options = data.inputs.map(function(d) { return d.label; });
                var matched = null;
                if (data.current) {
                    for (var i = 0; i < data.inputs.length; i++) {
                        if (data.inputs[i].id === data.current) {
                            matched = data.inputs[i].label;
                            break;
                        }
                    }
                }
                picker.current = matched || picker.options[0];
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            };
            xhr.onerror   = function() { applyFailure('NAU8822 not found'); };
            xhr.ontimeout = function() { applyFailure('NAU8822 not found'); };
            xhr.send();
        } catch (e) {
            applyFailure('NAU8822 not found');
        }
    };

    // Map the picker's current label back to the server-side id
    // (`internal`, `headset`, …). Returns null when the picker
    // is on a placeholder like "Loading…" or "NAU8822 not found"
    // — those aren't real selections so the POST short-circuits.
    VoiceRecorderScene.prototype._inputIdForCurrent = function() {
        var list = this._inputDevices || [];
        var label = this._pickers.inputDevice.current;
        for (var i = 0; i < list.length; i++) {
            if (list[i].label === label) return list[i].id;
        }
        return null;
    };

    // Fire-and-forget POST that flips the NAU8822 input mux on
    // the server side. Called every time the user lands on a
    // new Input device selection (left / right inline cycle or
    // dropdown OK commit). No response handling — the next
    // /api/mic/level/stream tick will already reflect whichever
    // mic now feeds the ADC, which is the user-visible confirm.
    VoiceRecorderScene.prototype._postInputDevice = function() {
        var id = this._inputIdForCurrent();
        if (!id) return;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/sound/input', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send(JSON.stringify({ id: id }));
        } catch (e) { /* offline / no XHR — ignore */ }
    };

    // ── Link-LED helpers (mirror WalkieTalkieScene) ──────────────
    // /api/led/set writes the colour + on flag; /api/led/manual
    // tells the server's auto state-driven LED loop to step
    // aside so our colour sticks. We engage manual mode for the
    // duration of a recording and drop it the moment recording
    // stops (or the scene exits / is killed from the switcher).
    VoiceRecorderScene.prototype._sendLinkLed = function(on) {
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
    VoiceRecorderScene.prototype._sendLedManual = function(enabled) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/led/manual', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send(JSON.stringify({ enabled: !!enabled }));
        } catch (e) { /* mocked server / offline — ignore */ }
    };

    // Reconciles the physical Link LED with the current
    // recording state. LED is red only when we're actively
    // capturing audio — i.e. recording AND not paused. Pause
    // drops the LED to off (the on-screen `recording_pause`
    // icon is the user's visual cue that the take is held).
    // Called from Start / Stop, Pause / Resume, and every
    // teardown path so the red cue can never linger.
    VoiceRecorderScene.prototype._applyRecordingLed = function() {
        if (this._recording && !this._paused) {
            this._sendLedManual(true);
            this._sendLinkLed(true);
        } else {
            this._sendLinkLed(false);
            this._sendLedManual(false);
        }
    };

    // ── Running timecode ─────────────────────────────────────────
    // The Start press fully anchors a fresh take (00:00:00:00);
    // Pause / Resume re-anchor without losing elapsed time. The
    // tick (~30 Hz) is purely a re-render kicker — it doesn't
    // mutate state, so starting / stopping it is safe at any
    // point during a take.
    VoiceRecorderScene.prototype._startRecordTick = function() {
        var self = this;
        if (this._recordTickTimer) clearInterval(this._recordTickTimer);
        this._recordTickTimer = setInterval(function() {
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
        }, 33);
    };
    VoiceRecorderScene.prototype._stopRecordTick = function() {
        if (this._recordTickTimer) {
            clearInterval(this._recordTickTimer);
            this._recordTickTimer = null;
        }
    };

    // Pause / Resume toggle. While paused we freeze the
    // displayed elapsed by capturing it into `_pausedElapsed`
    // and stopping the re-render tick — the lamp icon also
    // swaps to recording_pause in render(). Resuming
    // back-dates `_recordStartTime` so the running
    // `Date.now() - _recordStartTime` math picks up where it
    // left off without a jump.
    VoiceRecorderScene.prototype._togglePause = function() {
        if (!this._recording) return;
        if (this._paused) {
            // Resume.
            this._recordStartTime = Date.now() - this._pausedElapsed;
            this._paused = false;
            this._startRecordTick();
        } else {
            // Pause.
            this._pausedElapsed = Date.now() - this._recordStartTime;
            this._paused = true;
            this._stopRecordTick();
        }
        // Link LED follows recording state minus pause —
        // _applyRecordingLed reads both flags and reconciles.
        this._applyRecordingLed();
    };

    // Format an elapsed-ms count as HH:MM:SS:FF (FF = hundredths
    // of a second, the convention the placeholder Timecode row
    // used). Caps at 99:59:59:99 — well beyond any plausible
    // voice-memo session.
    function pad2(n) { return (n < 10 ? '0' + n : '' + n); }
    VoiceRecorderScene.prototype._formatTimecode = function(ms) {
        if (ms < 0) ms = 0;
        var hh = Math.floor(ms / 3600000);
        var mm = Math.floor((ms % 3600000) / 60000);
        var ss = Math.floor((ms % 60000) / 1000);
        var ff = Math.floor((ms % 1000) / 10);
        if (hh > 99) hh = 99;
        return pad2(hh) + ':' + pad2(mm) + ':' + pad2(ss) + ':' + pad2(ff);
    };

    // "+0 dB" / "+5 dB" / "-3 dB" — always-signed integer
    // decibels so positive and negative values are visually
    // distinct in the chip. Zero shows as "+0 dB" to match the
    // user-facing convention.
    VoiceRecorderScene.prototype._formatGain = function(db) {
        var sign = db >= 0 ? '+' : '';
        return sign + db + ' dB';
    };

    // Row-index → picker-key lookup. Returns `null` for rows
    // that don't carry a picker (Input gain, File name, Folder,
    // Timecode). Keeping this in one place means every "is
    // this a picker row?" check is identical across
    // handleInput and render.
    VoiceRecorderScene.prototype._rowPickerKey = function(rowIdx) {
        if (rowIdx === 1) return 'inputDevice';
        if (rowIdx === 4) return 'format';
        return null;
    };

    // Row-index → human-readable title for the dropdown overlay
    // header. Only called when the dropdown is open, so non-
    // picker rows never reach this and a default fallback isn't
    // worth the bytes.
    VoiceRecorderScene.prototype._rowTitle = function(rowIdx) {
        if (rowIdx === 1) return 'Input device';
        if (rowIdx === 4) return 'Format';
        return '';
    };

    VoiceRecorderScene.prototype.handleInput = function(action) {
        // ── Open dropdown owns input until it closes ──────────
        // Mirrors Internet Radio: when the picker is open, the
        // page-level row navigation steps aside completely.
        if (this._dropdownOpen) {
            var picker = this._pickers[this._dropdownKey];
            if (!picker || !picker.options.length) {
                this._dropdownOpen = false;
                this._dropdownKey  = null;
                return;
            }
            var optsOpen = picker.options;
            if (action === 'back' || action === 'esc') {
                // Close without committing — `picker.current`
                // is untouched, so the chip snaps back to
                // whatever value it had before OK opened the
                // picker.
                this._dropdownOpen = false;
                this._dropdownKey  = null;
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
                return;
            }
            if (action === 'down') {
                this._dropdownIndex =
                    (this._dropdownIndex + 1) % optsOpen.length;
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
                return;
            }
            if (action === 'up') {
                this._dropdownIndex =
                    (this._dropdownIndex - 1 + optsOpen.length) % optsOpen.length;
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
                return;
            }
            if (action === 'ok' || action === 'run') {
                // Commit the highlighted option and close.
                picker.current     = optsOpen[this._dropdownIndex];
                var committedKey   = this._dropdownKey;
                this._dropdownOpen = false;
                this._dropdownKey  = null;
                if (committedKey === 'inputDevice') {
                    this._postInputDevice();
                }
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
                return;
            }
            return;
        }

        if (action === 'back') return 'pop';

        // Shared press-flash + onPress dispatch for app-defined
        // buttons. Mirrors Internet Radio's Play-button code:
        // press → request render → release after 30 ms → fire
        // the callback. The brief pressed-frame is the visual
        // confirmation the user hit a real button rather than
        // escaped a modal or triggered some hidden shortcut.
        function flashAndFire(btn) {
            if (!btn) return;
            btn.press();
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            setTimeout(function() {
                btn.release();
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            }, 30);
            if (typeof btn.onPress === 'function') btn.onPress();
        }

        // 'esc' (mapped from 'z') fires the Home button.
        if (action === 'esc' && this._homeBtn) {
            flashAndFire(this._homeBtn);
            return;
        }
        // 'edit' (mapped from 'x') fires the Files button —
        // but Files only exists outside recording mode, so the
        // dispatch is gated by `_recording`.
        if (action === 'edit' && this._filesBtn && !this._recording) {
            flashAndFire(this._filesBtn);
            return;
        }
        // 'del' (mapped from 'v') fires the Pause button —
        // only meaningful while recording.
        if (action === 'del' && this._pauseBtn && this._recording) {
            flashAndFire(this._pauseBtn);
            return;
        }
        // 'run' (mapped from 'b' — device primary action) fires
        // the Start / Stop button. Suppressed while paused —
        // the right slot is "Empty" during pause, so 'b' is a
        // no-op until the user hits Continue first.
        if (action === 'run' && this._startBtn && !this._paused) {
            flashAndFire(this._startBtn);
            return;
        }

        // Up / down move the focus between the menu lines.
        // While recording only Input gain (row 0) is visible,
        // so the focus stays pinned there.
        if (action === 'up' || action === 'down') {
            var rowCount = this._recording ? 1 : 6;
            if (action === 'down') {
                this._selectedRow = (this._selectedRow + 1) % rowCount;
            } else {
                this._selectedRow = (this._selectedRow - 1 + rowCount) % rowCount;
            }
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }

        // OK is a row-specific action:
        //   • Picker rows (Input device / Format) → open the
        //                    dropdown overlay, seeded with the
        //                    current option's index so the
        //                    highlight starts where the user
        //                    last left it.
        //   • Input gain   → no-op (left / right handles it).
        //   • File name    → push TextInputScreen pre-filled
        //                    with the current filename.
        //   • Folder       → no-op (drill-in not wired yet).
        if (action === 'ok') {
            var pkOk = this._rowPickerKey(this._selectedRow);
            if (pkOk) {
                var pOk      = this._pickers[pkOk];
                var idxStart = pOk.options.indexOf(pOk.current);
                this._dropdownIndex = idxStart >= 0 ? idxStart : 0;
                this._dropdownKey   = pkOk;
                this._dropdownOpen  = true;
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            } else if (this._selectedRow === 2) {
                this._openFileNameEditor();
            }
            return;
        }

        // Left / right is also row-specific:
        //   • Picker rows (Input device / Format) → cycle
        //                    options inline (no overlay).
        //   • Input gain   → bump ±_inputGainStep, clamped to
        //                    [_inputGainMin, _inputGainMax].
        //   • File name / Folder → intentionally no-op.
        if (action === 'left' || action === 'right') {
            var pkLR = this._rowPickerKey(this._selectedRow);
            if (pkLR) {
                var pLR = this._pickers[pkLR];
                if (!pLR || pLR.options.length <= 1) return;
                var idx = pLR.options.indexOf(pLR.current);
                if (idx < 0) idx = 0;
                idx = (action === 'right')
                    ? (idx + 1) % pLR.options.length
                    : (idx - 1 + pLR.options.length) % pLR.options.length;
                pLR.current = pLR.options[idx];
                if (pkLR === 'inputDevice') {
                    this._postInputDevice();
                }
            } else if (this._selectedRow === 0) {
                var delta = (action === 'right')
                    ? this._inputGainStep
                    : -this._inputGainStep;
                var next  = this._inputGainDb + delta;
                if (next < this._inputGainMin) next = this._inputGainMin;
                if (next > this._inputGainMax) next = this._inputGainMax;
                this._inputGainDb = next;
            }
            // File name (2) / Folder (3) rows: no-op.
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
    };

    // Push the shared TextInputScreen pre-seeded with the
    // current filename. The keyboard takes over input until the
    // user commits (Save) or discards; either way it pops itself
    // off the scene stack and we resume painting the list page.
    VoiceRecorderScene.prototype._openFileNameEditor = function() {
        var self = this;
        if (typeof TextInputScreen === 'undefined' || !this.sceneManager) return;
        var screen = new TextInputScreen({
            displayName: 'File name',
            title:       'File name',
            initialText: this._fileName,
            onSave: function(text) {
                // Trim incidental whitespace; reject an empty
                // string so the row never reads as blank.
                var clean = (text == null ? '' : String(text)).replace(/^\s+|\s+$/g, '');
                if (clean.length === 0) return;
                self._fileName = clean;
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            }
        });
        this.sceneManager.push(screen);
    };

    // Title-bar metrics — ported from Internet Radio so app
    // screens share the same chrome. Status bar stays as the
    // top strip; immediately under it sits a 16-px-tall light-
    // gray header carrying the app icon + name in
    // Born2bSportyV2Medium.
    var TITLE_H        = 16;
    var TITLE_FILL     = '#D9D9D9';
    var ICON_X         = 2;     // 2 px in from the left edge
    var TITLE_TEXT_X   = 18;    // 14-px icon ends at col 15, then 2 px gap
    var TITLE_TEXT_DY  = 1;     // baseline drop below status-bar bottom

    VoiceRecorderScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        // (1) Standard status bar across the top. Empty title —
        // the gray app-title bar below carries the app name, so
        // the status bar just shows battery / wifi / etc.
        if (typeof UI !== 'undefined' && typeof UI.drawStatusBar === 'function') {
            UI.drawStatusBar(canvas, '');
        }
        // (2) App-title header. Full-width 16-px gray strip
        // flush against the status bar's bottom edge, same fill
        // colour Internet Radio uses.
        var ctx = canvas.ctx;
        var titleY = UI.STATUS_BAR_H;
        ctx.fillStyle = TITLE_FILL;
        ctx.fillRect(0, titleY, canvas.w, TITLE_H);
        // (3) App icon — static 14×14 grayscale sprite. Sits at
        // x=2 / y=titleY+1 so the cap aligns with the title text
        // baseline (matches the +1 nudge Internet Radio applies
        // to its animated icon).
        if (this.icon) {
            canvas.drawSprite(this.icon, ICON_X, titleY + 1, '#000');
        }
        // (4) Title text — Born2bSportyV2Medium, 18 px in from
        // the left, 1 px below the status bar so the cap line
        // is tight against the strip's top edge.
        Born2bSportyV2Medium.draw(ctx, this.displayName,
            TITLE_TEXT_X, UI.STATUS_BAR_H + TITLE_TEXT_DY, '#000');

        // (5) Stereo mic-level meters. Two horizontal chambers
        // stacked with a 1-px gap. Each chamber is the same
        // 238 × 7 ResponsiveFrame (gray fill #D9D9D9, black
        // stroke, 2-px corners). The current peak for each
        // channel paints as a left-anchored black ResponsiveFrame
        // on top — left corners always rounded so they meet the
        // gray chamber's curve, right corners square unless the
        // level is at 100 % so the moving edge reads as the
        // current value. Same pattern MenuDropdownLine uses for
        // its slider chip.
        var METER_X       = 13;
        var METER_W       = 238;
        var METER_H       = 7;
        var METER_R       = 2;
        var METER_GAP     = 1;
        var METER_GRAY    = '#D9D9D9';
        var METER_BLACK   = '#000000';
        var METER_TOP_Y   = 31;
        var METER_BOT_Y   = METER_TOP_Y + METER_H + METER_GAP;

        // L / R channel labels. Right-aligned 2 px before each
        // meter's left edge so the gap between glyph and chamber
        // stays consistent regardless of the glyph's natural
        // width. Vertically nudged so the cap line sits centred
        // on the 7-px chamber (HaxrcorpFont16's visible cap
        // starts ~row 2 / spans ~9 rows; -1 lands the centre at
        // y + ~3).
        function drawChannelLabel(ch, meterY) {
            var w = HaxrcorpFont16.textWidth(ch);
            HaxrcorpFont16.draw(ctx, ch,
                METER_X - 2 - w, meterY - 1, '#000');
        }
        drawChannelLabel('L', METER_TOP_Y);
        drawChannelLabel('R', METER_BOT_Y);

        function drawMeter(y, levelPct) {
            // Gray chamber — no stroke, just the rounded fill.
            new ResponsiveFrame({
                x: METER_X,        y: y,
                width: METER_W,    height: METER_H,
                anchorH: 'left',   anchorV: 'top',
                fillColor:    METER_GRAY,
                showFill:     true,
                showStroke:   false,
                cornerRadius: METER_R
            }).render(canvas);
            // Black peak fill — width proportional to level.
            // Clamp to 0..100 so a bad poll can't draw past the
            // chamber's right edge.
            var lvl = Math.max(0, Math.min(100, levelPct));
            if (lvl <= 0) return;
            var fillW   = Math.round(METER_W * lvl / 100);
            var isFull  = fillW >= METER_W;
            new ResponsiveFrame({
                x: METER_X,        y: y,
                width: fillW,      height: METER_H,
                anchorH: 'left',   anchorV: 'top',
                fillColor:    METER_BLACK,
                strokeColor:  METER_BLACK,
                showFill:     true,
                showStroke:   false,
                cornerRadius: METER_R,
                corners: {
                    tl: true,      bl: true,
                    tr: isFull,    br: isFull
                }
            }).render(canvas);
        }

        drawMeter(METER_TOP_Y, this._micLeft);
        drawMeter(METER_BOT_Y, this._micRight);

        // (6) Input-device picker row. MenuDropdownLine renders
        // the title flush against the left edge and the value
        // chip anchored to the right edge — same shape as
        // Internet Radio's "Audio device" row. Selector outline
        // (the page-level focus indicator) wraps the row 1 px
        // below the row's top y so it centres on the chip
        // baseline rather than riding flush.
        // Rows now stack flush against each other — the gap was
        // 1 px previously. 0 keeps the column tighter so all 5
        // rows fit comfortably under the meters.
        var ROW_GAP    = 0;
        var gainRowY   = METER_BOT_Y + METER_H + 2;
        var deviceRowY = gainRowY   + MenuDropdownLine.HEIGHT + ROW_GAP;
        var fileRowY   = deviceRowY + MenuDropdownLine.HEIGHT + ROW_GAP;
        var folderRowY = fileRowY   + MenuDropdownLine.HEIGHT + ROW_GAP;
        var formatRowY   = folderRowY + MenuDropdownLine.HEIGHT + ROW_GAP;
        var timecodeRowY = formatRowY + MenuDropdownLine.HEIGHT + ROW_GAP;
        // Table that maps row index to its y anchor so the
        // selector / dropdown overlay can look up the row
        // position without re-doing the math.
        var rowYs = [gainRowY, deviceRowY, fileRowY, folderRowY, formatRowY, timecodeRowY];

        // Input gain row (row 0, topmost) — inline ± value,
        // no dropdown. Always visible, including while
        // recording so the user can still ride the gain.
        new MenuDropdownLine({
            y:        gainRowY,
            title:    'Input gain',
            value:    this._formatGain(this._inputGainDb),
            selected: !this._dropdownOpen && this._selectedRow === 0
        }).render(canvas);

        // Rows 1..5 are only present out of recording mode.
        // While `_recording` is true a single placeholder frame
        // takes their slot (drawn further down).
        if (!this._recording) {
            // Input device row (row 1) — dropdown picker.
            new MenuDropdownLine({
                y:        deviceRowY,
                title:    'Input device',
                value:    this._pickers.inputDevice.current,
                // Show the `< value >` arrows only when this
                // row is both focused AND the dropdown isn't
                // open — same dual condition Internet Radio
                // uses so the arrows never compete with the
                // open overlay for focus.
                selected: !this._dropdownOpen && this._selectedRow === 1
            }).render(canvas);

            // File name row — drill-in to TextInputScreen on OK.
            // `selected: false` always: left / right do nothing
            // on this row so we never want the `<` / `>`
            // arrows that MenuDropdownLine paints when
            // selected — the chevron on the selector frame is
            // the only affordance.
            new MenuDropdownLine({
                y:        fileRowY,
                title:    'File name',
                value:    this._fileName,
                selected: false
            }).render(canvas);

            // Folder row — same visual treatment as File name.
            // OK is intentionally a no-op for now; the chevron
            // is present so the row matches its eventual
            // drill-in behaviour without shifting layout when
            // that lands.
            new MenuDropdownLine({
                y:        folderRowY,
                title:    'Folder',
                value:    this._folderName,
                selected: false
            }).render(canvas);

            // Format row — second dropdown picker. Shares all
            // the overlay machinery the Input device row uses;
            // the plain (non-chevron) selector frame matches
            // the spec.
            new MenuDropdownLine({
                y:        formatRowY,
                title:    'Format',
                value:    this._pickers.format.current,
                selected: !this._dropdownOpen && this._selectedRow === 4
            }).render(canvas);

            // Timecode row — display-only drill-in. Same
            // chevron-selector treatment as File name / Folder.
            new MenuDropdownLine({
                y:        timecodeRowY,
                title:    'Timecode',
                value:    this._timecode,
                selected: false
            }).render(canvas);
        } else {
            // Recording rectangle — light-gray rounded panel
            // that replaces the bottom menu rows while a
            // recording session is active. Anchored at (3, 68)
            // per the spec; fills the remaining horizontal
            // space with a 3-px margin on the right so the
            // panel reads symmetrically. Height fills down to
            // ~2 px above the bottom-button row so the panel
            // and the Start / Stop button don't kiss.
            var REC_RECT_X = 3;
            var REC_RECT_Y = 68;
            var REC_RECT_W = canvas.w - 6;
            var REC_RECT_H = 60;
            new ResponsiveFrame({
                x: REC_RECT_X,   y: REC_RECT_Y,
                width: REC_RECT_W, height: REC_RECT_H,
                anchorH: 'left',   anchorV: 'top',
                fillColor:    '#000000',
                showFill:     true,
                showStroke:   false,
                cornerRadius: 4
            }).render(canvas);
            // File name in Born2bSportyV2Medium, 7 px in from
            // the rectangle's left edge and 1 px down from its
            // top edge — labels the current take so the user
            // sees what file is being written while the rows
            // that normally hold this info are hidden.
            var FN_TEXT_X = REC_RECT_X + 7;
            var FN_TEXT_Y = REC_RECT_Y + 1;
            Born2bSportyV2Medium.draw(canvas.ctx, this._fileName,
                FN_TEXT_X, FN_TEXT_Y, '#FFFFFF');
            // Horizontal white hairline 6 px below the visible
            // bottom of the file-name text. Born2bSportyV2Medium's
            // visible glyph spans rows 2..11 of its 18-row
            // bitmap, so the visible bottom sits at draw-y + 11.
            // Divider at draw-y + 11 + 6 = draw-y + 17 →
            // y = FN_TEXT_Y + 17. Spans the full width of the
            // recording rectangle.
            canvas.drawHLine(REC_RECT_X, FN_TEXT_Y + 17,
                REC_RECT_W, '#FFFFFF');

            // Record lamp — swaps icon based on pause state:
            //   recording   → Icons.record_circle  (10×10)
            //   paused      → Icons.recording_pause (14×18)
            // Both anchor at the same top-left (6 px in from
            // the rect's left edge, 27 px down from its top).
            // Timecode anchors against the smaller of the two
            // (LAMP_W = 10) so its x doesn't jitter when the
            // user toggles pause — the pause icon's right edge
            // (at x = lampX + 14 = 23) ends up flush with the
            // text's left edge, which still reads cleanly.
            var LAMP_W = 10;
            var LAMP_H = 10;
            var lampX  = REC_RECT_X + 6;
            var lampY  = REC_RECT_Y + 27;
            var lampIcon = (this._paused
                            && typeof Icons !== 'undefined'
                            && Icons.recording_pause)
                ? Icons.recording_pause
                : (typeof Icons !== 'undefined' ? Icons.record_circle : null);
            if (lampIcon) {
                canvas.drawSprite(lampIcon, lampX, lampY, '#FFFFFF');
            }

            // Running timecode — HH:MM:SS:FF. When paused the
            // tick is halted and `_pausedElapsed` carries the
            // frozen value forward so the readout sits still
            // until Pause is toggled off (which back-dates
            // `_recordStartTime` so the running math picks up
            // where it left off without a jump).
            var elapsedMs;
            if (this._paused) {
                elapsedMs = this._pausedElapsed;
            } else if (this._recordStartTime) {
                elapsedMs = Date.now() - this._recordStartTime;
            } else {
                elapsedMs = 0;
            }
            var tcText = this._formatTimecode(elapsedMs);
            // Lamp bbox right = lampX + LAMP_W = 19. Gap 4 →
            // text x = 23. Born2bSporty's visible cap spans
            // rows 2..11 (centre at draw-y + 6.5); to centre on
            // the lamp's centre y (100) the draw-y lands at
            // 100 - 7 (1-px nudge to balance optical centring).
            Born2bSportyV2Medium.draw(canvas.ctx, tcText,
                lampX + LAMP_W + 4, lampY + (LAMP_H / 2) - 7, '#FFFFFF');

            // Format + Folder annotations along the bottom edge
            // of the recording rectangle. Format on the left, 6
            // px in from the rect's left edge; Folder follows
            // with 7 px padding. Both in HaxrcorpFont16. The y
            // anchor (bottom - 3 - 11) places the bitmap's
            // bottom row 3 px above the rect's bottom edge.
            var BOTTOM_TEXT_Y = REC_RECT_Y + REC_RECT_H - 3 - 11;
            var formatText    = this._pickers.format.current || '';
            var formatTextX   = REC_RECT_X + 6;
            HaxrcorpFont16.draw(canvas.ctx, formatText,
                formatTextX, BOTTOM_TEXT_Y, '#FFFFFF');
            var formatW       = HaxrcorpFont16.textWidth(formatText);
            HaxrcorpFont16.draw(canvas.ctx, this._folderName,
                formatTextX + formatW + 7, BOTTOM_TEXT_Y, '#FFFFFF');

            // Right-aligned stack of three labels along the
            // recording rectangle's right edge, 5 px in from
            // the right and stacked from bottom up:
            //   1. "1h 30m"     — at BOTTOM_TEXT_Y (shared
            //                      baseline with Format /
            //                      Folder on the left).
            //   2. "8.3 GB"     — 4-px gap above (1).
            //   3. "Available:" — 4-px gap above (2).
            // All three are static placeholders for now;
            // eventually they'll show remaining take length,
            // free disk space, and the "Available:" label.
            // Spacing maths use HaxrcorpFont16's 11-row bitmap
            // height and a 4-row inter-line gap.
            var RIGHT_PAD     = 5;
            var LINE_H        = 11;
            var LINE_GAP      = 2;
            var rightTextX    = REC_RECT_X + REC_RECT_W - RIGHT_PAD;
            function drawRightAligned(ctx, text, y) {
                var w = HaxrcorpFont16.textWidth(text);
                HaxrcorpFont16.draw(ctx, text, rightTextX - w, y, '#FFFFFF');
            }

            var bottomLineY = BOTTOM_TEXT_Y;
            var midLineY    = bottomLineY - LINE_GAP - LINE_H;   // 99
            var topLineY    = midLineY    - LINE_GAP - LINE_H;   // 84
            drawRightAligned(canvas.ctx, '1h 30m',     bottomLineY);
            drawRightAligned(canvas.ctx, '8.3 GB',     midLineY);
            drawRightAligned(canvas.ctx, 'Available:', topLineY);
        }

        // Page-level selector outline anchored to the focused
        // row. File name / Folder / Timecode rows use the
        // chevron-bearing variant; the picker / value rows use
        // the plain outline. Suppressed entirely while the
        // dropdown overlay is open so the inner-selector inside
        // it is the only "this is focused" cue on screen.
        if (!this._dropdownOpen) {
            var selY  = rowYs[this._selectedRow];
            var frame = (this._selectedRow === 2
                      || this._selectedRow === 3
                      || this._selectedRow === 5)
                ? this._chevronSelectorFrame
                : this._selectorFrame;
            frame.setPosition(2, selY);
            frame.setSize(252, 15);
            frame.render(canvas);
        }

        // App-defined buttons — drawn before the dropdown
        // overlay so the overlay's wash mutes them along with
        // the rest of the page chrome.
        //
        // Layout by mode (5 slots, left → right):
        //   idle      : Home  | Files | …     | …       | Start
        //   recording : Home  | …     | …     | Pause   | Stop
        //   paused    : Home  | …     | …     | Resume  | …
        //
        // The right-button label flips between Start and Stop
        // each render; the middle slot's button flips between
        // Pause and Resume the same way.
        if (this._startBtn) {
            this._startBtn.text = this._recording ? 'Stop' : 'Start';
        }
        if (this._pauseBtn) {
            this._pauseBtn.text = this._paused ? 'Resume' : 'Pause';
        }
        if (this._homeBtn) this._homeBtn.render(canvas);
        // Files appears only when idle (out of recording).
        if (!this._recording && this._filesBtn) {
            this._filesBtn.render(canvas);
        }
        // Pause / Continue appears while recording (both
        // running and paused — label flip handles the state).
        if (this._recording && this._pauseBtn) {
            this._pauseBtn.render(canvas);
        }
        // Start / Stop appears in idle and while recording but
        // NOT while paused — that slot is intentionally empty
        // during pause so the only routes out are Continue or
        // Home.
        if (this._startBtn && !this._paused) {
            this._startBtn.render(canvas);
        }

        // (7) Dropdown overlay — painted LAST so it sits above
        // all the page chrome. Anchored at the chip's top-left
        // of whichever picker row owns the open dropdown
        // (Input device, Format, or any future picker), so it
        // reads as "this chip grew downward to reveal its
        // options".
        if (this._dropdownOpen && this._dropdownKey) {
            // Find the row that owns the open key by walking
            // the same lookup handleInput uses — keeps the two
            // sides in lockstep.
            var openRowIdx = -1;
            for (var ri = 0; ri < rowYs.length; ri++) {
                if (this._rowPickerKey(ri) === this._dropdownKey) {
                    openRowIdx = ri;
                    break;
                }
            }
            if (openRowIdx >= 0) {
                var chipX = canvas.w
                          - MenuDropdownLine.CHIP_WIDTH
                          - 5;                          // CHIP_RIGHT_PAD
                var chipY = rowYs[openRowIdx] + MenuDropdownLine.TOP_PAD;
                this._renderDropdown(canvas, chipX, chipY);
            }
        }
    };

    // Port of Internet Radio's `_renderDropdown`. Same visual
    // layering: semi-transparent white wash → re-drawn row
    // title for crispness → gray ResponsiveFrame body → items
    // stacked with 1-px dividers → MenuSelectorFrame around
    // the highlighted item.
    VoiceRecorderScene.prototype._renderDropdown = function(canvas, chipX, chipY) {
        var ctx     = canvas.ctx;
        var picker  = this._pickers[this._dropdownKey];
        if (!picker) return;
        var options = picker.options || [];
        if (!options.length) return;

        var ITEM_H = 13;
        var DIV_H  = 1;
        var W      = MenuDropdownLine.CHIP_WIDTH;       // 180
        var n      = options.length;
        // body height = N items + (N-1) dividers + 1 px top + 1 px bottom
        var H      = ITEM_H * n + DIV_H * (n - 1) + 2;

        // (1) Wash everything else out — same alpha the verbose
        // wifi modals and Internet Radio's dropdown use.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        // (2) Re-draw the row title in solid black so it stays
        // crisp on top of the wash — visual anchor for "you're
        // picking the value of THIS row". Title string comes
        // from the same lookup `handleInput` uses so we never
        // drift out of sync. Coords mirror MenuDropdownLine's
        // title position (TITLE_X = 6, draw y = chipY since
        // chipY already equals row.y + TOP_PAD).
        var openRowIdx = -1;
        for (var ti = 0; ti < 5; ti++) {
            if (this._rowPickerKey(ti) === this._dropdownKey) {
                openRowIdx = ti;
                break;
            }
        }
        var titleStr = openRowIdx >= 0 ? this._rowTitle(openRowIdx) : '';
        if (titleStr) {
            HaxrcorpFont16.draw(ctx, titleStr, 6, chipY, '#000');
        }

        // (3) Body. Same fill colour as the closed chip so the
        // dropdown reads as the chip growing downward.
        new ResponsiveFrame({
            x: chipX, y: chipY,
            width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            showStroke: false,
            showFill:   true, fillColor: MenuDropdownLine.CHIP_FILL,
            cornerRadius: 3,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);

        // (4) Items + dividers. Items are centred HaxrcorpFont16;
        // each item block is ITEM_H tall with a 1-px divider
        // after it (except the last). Top stroke = row 0; first
        // item sits at row 1.
        var selectedItemY = chipY + 1;
        for (var i = 0; i < n; i++) {
            var itemY = chipY + 1 + i * (ITEM_H + DIV_H);
            var label = String(options[i]);
            var labelW = HaxrcorpFont16.textWidth(label);
            HaxrcorpFont16.draw(ctx, label,
                chipX + Math.floor((W - labelW) / 2),
                itemY + 1, '#000');
            if (i === this._dropdownIndex) selectedItemY = itemY;
            if (i < n - 1) {
                canvas.drawHLine(chipX + 1, itemY + ITEM_H,
                    W - 2, '#999999');
            }
        }

        // (5) Inner selector outline around the highlighted item.
        // Inset 1 px on the right so MenuSelectorFrame's BR
        // shadow pixel doesn't run past the body's right edge.
        this._dropdownInnerSelector.setPosition(chipX, selectedItemY);
        this._dropdownInnerSelector.setSize(W - 1, ITEM_H + 2);
        this._dropdownInnerSelector.render(canvas);
    };

    return VoiceRecorderScene;
})();
