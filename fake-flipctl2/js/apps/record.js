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
    // Cross-instance recording snapshot. When the user
    // backgrounds a take, exit() stashes the live recording
    // state here; the next instance reads it SYNCHRONOUSLY in
    // enter() so the recording panel paints immediately instead
    // of flashing the idle settings list for the ~1 s it takes
    // /api/record/status to answer. The async status fetch then
    // reconciles (and clears this if the server says the take
    // ended). Null when no take is in flight.
    var _recorderBgState = null;

    // Default filename pattern. Shown verbatim in the File name
    // row and in the editor — substitution only happens at Start
    // press, and only inside the square brackets.
    var DEFAULT_NAME_TEMPLATE = 'F1-REC-[YYYYMMDD-HHMMSS]';

    // Recognised date-format tokens for `_expandTemplateName`.
    // Longest first so the greedy walker prefers the more
    // specific match: `YYYYMMDD` beats `YYYY`+`MM`+`DD`, `HHMM`
    // beats `HH`+`MM`. `MM` is the one genuinely ambiguous token
    // (month vs minute) — when it stands alone we resolve it to
    // month, which is the more common naming use-case. To pick
    // minutes specifically, use `HHMM` (hour+minute) or build
    // the brackets like `[HH-MM]` only when you mean month after
    // an hour (rare; in practice users write `[YYYYMMDD]` or
    // `[HHMMSS]`, never `[HH-MM]`).
    var TEMPLATE_TOKENS = [
        'YYYYMMDD',  // full date  → e.g. 20260525
        'HHMMSS',    // full time  → e.g. 161853
        'HHMM',      // time, no seconds → e.g. 1618
        'MMDD',      // month+day → e.g. 0525
        'YYYY',      // year, 4 digits
        'YY',        // year, 2 digits
        'HH',        // hour, 24h
        'MM',        // month (when standalone)
        'DD',        // day-of-month
        'SS'         // second
    ];

    // Compute the value for a single token at the given Date.
    // Centralised so the walker can ask for any recognised
    // token by string without each call repeating the padding /
    // slicing logic.
    function _tokenValue(tok, d) {
        var pad = function(n) { return n < 10 ? '0' + n : String(n); };
        var Y4  = String(d.getFullYear());
        var Mo  = pad(d.getMonth() + 1);
        var Da  = pad(d.getDate());
        var Hr  = pad(d.getHours());
        var Mi  = pad(d.getMinutes());
        var Se  = pad(d.getSeconds());
        switch (tok) {
            case 'YYYYMMDD': return Y4 + Mo + Da;
            case 'HHMMSS':   return Hr + Mi + Se;
            case 'HHMM':     return Hr + Mi;
            case 'MMDD':     return Mo + Da;
            case 'YYYY':     return Y4;
            case 'YY':       return Y4.slice(-2);
            case 'HH':       return Hr;
            case 'MM':       return Mo;
            case 'DD':       return Da;
            case 'SS':       return Se;
            default:         return tok;
        }
    }

    // Expand any `[...]` segments in `s` with date tokens
    // substituted; everything outside the brackets stays as
    // typed. The brackets themselves are stripped after
    // substitution, so `F1-REC-[YYYYMMDD-HHMM]` becomes
    // `F1-REC-20260525-1618` and `Meeting-SS` stays
    // `Meeting-SS` (because the `SS` is outside any brackets,
    // so we leave it alone). Inside the brackets we walk
    // left-to-right matching the longest recognised token at
    // each position; characters that aren't part of any token
    // (dashes, underscores, letters that aren't format codes)
    // pass through unchanged.
    function _expandTemplateName(s) {
        if (typeof s !== 'string') return s;
        var d = new Date();
        return s.replace(/\[([^\]]*)\]/g, function(_match, inner) {
            var out = '';
            var i   = 0;
            while (i < inner.length) {
                var matched = false;
                for (var j = 0; j < TEMPLATE_TOKENS.length; j++) {
                    var tok = TEMPLATE_TOKENS[j];
                    if (inner.substr(i, tok.length) === tok) {
                        out += _tokenValue(tok, d);
                        i   += tok.length;
                        matched = true;
                        break;
                    }
                }
                if (!matched) {
                    out += inner.charAt(i);
                    i   += 1;
                }
            }
            return out;
        });
    }

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

        // NAU8822 presence. Optimistic default true so the
        // input picker doesn't read as "Not found" for a frame
        // before the first /api/sound/input/source fetch lands.
        // Flips false (and stays there) when the server reports
        // the codec is absent — render then paints "Not found"
        // and the input-device row stops accepting input.
        this._codecPresent = true;

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
                options: ['3.5 Audio', 'Build-in mic'],
                // Default to the built-in mic — that's the
                // device a freshly opened Voice Recorder should
                // listen on without the user needing to hunt
                // for a setting.
                current: 'Build-in mic'
            },
            format: {
                // Seed with the three supported formats so the
                // picker still works pre-fetch; _fetchRecordFormats
                // overwrites this with the server's authoritative
                // availability map (MP3 / OGG may need install).
                options: ['WAV', 'MP3', 'OGG'],
                current: 'WAV'
            }
        };
        // Per-format availability map populated by _fetchRecordFormats
        // on enter. Picker shows all three formats; selecting an
        // unavailable one opens the install modal.
        this._formatMeta = {
            WAV: { id: 'wav', ext: 'wav', available: true },
            MP3: { id: 'mp3', ext: 'mp3', available: true, package: 'lame' },
            OGG: { id: 'ogg', ext: 'ogg', available: true, package: 'vorbis-tools' }
        };
        // Install-dependency modal — same shape as
        // InternetRadioScene's _installModal. Pops when the
        // user commits an unavailable format or presses Start
        // with one selected.
        //   missing     — encoder absent; Install / Cancel
        //   installing  — POST /api/record/install in flight
        //   failed      — install failed; Retry / Cancel
        this._installModal = {
            open:        false,
            state:       'missing',
            buttonIndex: 0,
            output:      '',
            formatId:    null,
            onSuccess:   null
        };
        // Generic info modal — single title line and an OK
        // button. Used as a "we hear you, this is coming" stub
        // for menu rows whose deeper UI isn't built yet (Folder
        // → "File manager: TBA"). Opens with `_openInfoModal`,
        // closes on OK or Back.
        this._infoModal = {
            open:  false,
            title: ''
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
        //
        // Default is the literal template `F1-REC-[YYYYMMDD-HHMMSS]`;
        // the bracketed segment is the substitution zone, and
        // `_expandTemplateName` only fills it in at Start press.
        // The row, the editor and any save round-trip all carry
        // the unexpanded template so the user can keep editing
        // the pattern between takes.
        this._fileName = DEFAULT_NAME_TEMPLATE;
        // Snapshot of the expanded name once a take starts —
        // rendered in the recording rectangle so the user sees
        // the actual filename being written. Cleared on Stop.
        this._recordingDisplayName = null;

        // Folder — drill-in row, no behaviour wired yet. Visual
        // structure mirrors File name (chevron selector frame,
        // OK is the future open trigger) so the eventual editor
        // can slot in without UI shuffling.
        this._folderName = 'voice_recordings';

        // Focused-row index for up / down navigation between
        // the menu lines below the meters.
        //   0 → Input gain     (inline ± row)
        //   1 → Input device   (dropdown row)
        //   2 → File name      (chevron drill-in row)
        //   3 → Folder         (chevron drill-in row, stub)
        //   4 → Format         (dropdown row, plain selector)
        // The live HH:MM:SS:FF timecode that appears inside the
        // recording rectangle while a take is in flight is a
        // separate widget — it lives on the recording panel, not
        // in this menu list.
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
            function() {
                // Push the recordings-folder browser. The folder
                // name shown in its header is the same string the
                // Folder row in this scene displays — that way
                // the user sees the same label in both places.
                if (!self.sceneManager
                        || typeof VoiceRecorderFilesScene === 'undefined') {
                    return;
                }
                var browser = new VoiceRecorderFilesScene(
                    self.sceneManager, self._folderName);
                self.sceneManager.push(browser);
            });

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

        // `true` while we're "recording" — collapses rows 2..4
        // (File name / Folder / Format) and reveals a placeholder
        // ResponsiveFrame in their place. Toggled by the Start /
        // Stop right button.
        this._recording = false;

        // Timecode anchor + tick. `_recordStartTime` is set on
        // each Start press; `_recordTickTimer` runs while
        // recording so the rendered HH:MM:SS:FF display tracks
        // wall-clock time. Stopping recording clears the tick;
        // the next Start re-anchors to the press moment.
        // Snapshot of the latest /api/record/status fetch. The
        // recording panel reads bytes / elapsedMs to derive a
        // bytes-per-second rate, freeBytes for "Available", and
        // (bytes/elapsedMs ÷ freeBytes) for time-left. Outside
        // a take, `bytes` and `elapsedMs` stay 0 and we fall
        // back to the format's nominal byte-rate table.
        this._recordEstimate = {
            freeBytes:  null,
            totalBytes: null,
            bytes:     0,
            elapsedMs: 0,
            format:    null
        };

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
                    // Expand the template token in the File
                    // name row into a concrete timestamp at
                    // press time. The row's display value
                    // (`_fileName`) stays as the template; only
                    // `_recordingDisplayName` and the value
                    // sent to the server carry the expanded
                    // form. If the user has edited the name
                    // and stripped the token, expand is a
                    // no-op and we use their literal text.
                    self._recordingDisplayName =
                        _expandTemplateName(self._fileName);
                    // Resolve the current Format picker label
                    // to its server-side id.
                    var fmtLabel = self._pickers.format.current;
                    var fmtMeta  = self._formatMeta[fmtLabel];
                    var fmtId    = (fmtMeta && fmtMeta.id) || 'wav';
                    self._postStartRecord(fmtId,
                            self._recordingDisplayName,
                            function(result) {
                        if (result && result.success) {
                            self._serverFile = result.file || null;
                            return;
                        }
                        // Server refused — back out cleanly.
                        self._recording            = false;
                        self._recordingDisplayName = null;
                        self._stopRecordTick();
                        self._applyRecordingLed();
                        if (typeof window.requestRender === 'function') {
                            window.requestRender();
                        }
                        if (typeof console !== 'undefined' && console.warn) {
                            console.warn('Record start failed:',
                                result && result.error);
                        }
                    });
                } else {
                    self._stopRecordTick();
                    self._paused               = false;
                    self._postStopRecord();
                    self._serverFile           = null;
                    self._recordingDisplayName = null;
                }
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            });
    }

    VoiceRecorderScene.prototype.enter = function() {
        var self = this;
        // Recorder is now the foreground scene — the shared status
        // bar suppresses its recording icon while we're on top (you
        // can already see the take here). Cleared in exit() so the
        // icon reappears once a backgrounded take keeps rolling.
        window._voiceRecorderForeground = true;
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
                    // Switcher-kill ends the take for good — drop
                    // the stashed bg state so a later re-open
                    // starts clean idle instead of flashing the
                    // dead take, and clear the status-bar flag
                    // (this path bypasses _applyRecordingLed).
                    _recorderBgState = null;
                    window._voiceRecorderRecording = false;
                    // Stop server-side recording too — it's
                    // idempotent on the server so safe even if
                    // we weren't actually recording.
                    if (self._recording) self._postStopRecord();
                });
        }
        // Kick the server-side arecord monitor and open one
        // long-lived SSE connection. Replaces the previous
        // 50-ms XHR poll — the server now pushes updates from
        // inside the arecord chunk handler so the Node event
        // loop isn't doing 20 req/sec of HTTP overhead while
        // the user sits on this page.
        // Re-entry from the App Switcher: if a take was rolling
        // when we last left, restore the recording UI
        // SYNCHRONOUSLY from the stashed state so this paint
        // already shows the recording panel — no flash of the
        // idle settings list while the async status fetch is in
        // flight.
        this._applyBgStateSync();
        this._startMicMonitor();
        this._openMicStream();
        this._fetchInputGain();
        this._fetchInputSource();
        this._fetchRecordFormats();
        // One-shot pull on enter so the recording panel shows
        // a real Available figure as soon as the user starts
        // a take, instead of dashes for the first poll cycle.
        this._fetchRecordEstimate();
        // Reconcile against the server: confirms the optimistic
        // restore (refreshing elapsed / file) or clears it back
        // to idle if the take actually ended while we were away.
        this._restoreRecordingState();
    };

    // Synchronously seed recording UI state from the stashed
    // `_recorderBgState`. No-op when nothing was rolling.
    VoiceRecorderScene.prototype._applyBgStateSync = function() {
        var s = _recorderBgState;
        if (!s || !s.recording) return;
        this._recording            = true;
        this._paused               = !!s.paused;
        this._recordStartTime      = s.recordStartTime;
        this._pausedElapsed        = s.pausedElapsed;
        this._serverFile           = s.serverFile;
        this._recordingDisplayName = s.recordingDisplayName;
        if (s.formatLabel
                && this._pickers.format.options.indexOf(s.formatLabel) >= 0) {
            this._pickers.format.current = s.formatLabel;
        }
        if (!this._paused) this._startRecordTick();
        this._applyRecordingLed();
    };

    // Query /api/record/status on enter and, if a recording is
    // already in progress (backgrounded), restore the scene's
    // recording state — timecode anchor, paused flag, filename,
    // format picker, LED, and the running tick.
    VoiceRecorderScene.prototype._restoreRecordingState = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/record/status', true);
            xhr.timeout = 1500;
            xhr.onload = function() {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { return; }
                if (!data.recording) {
                    // The take ended while we were away (or there
                    // never was one). Undo any optimistic restore
                    // from _applyBgStateSync and drop back to idle.
                    if (self._recording) {
                        self._recording            = false;
                        self._paused               = false;
                        self._recordingDisplayName = null;
                        self._serverFile           = null;
                        self._stopRecordTick();
                        self._applyRecordingLed();
                        if (typeof window.requestRender === 'function') {
                            window.requestRender();
                        }
                    }
                    _recorderBgState = null;
                    return;
                }
                self._recording = true;
                self._paused    = !!data.paused;
                var elapsed = (typeof data.elapsedMs === 'number') ? data.elapsedMs : 0;
                // Anchor both the running clock and the paused
                // snapshot so the timecode reads correctly in
                // either state and resume math stays consistent.
                self._recordStartTime = Date.now() - elapsed;
                self._pausedElapsed   = elapsed;
                self._serverFile = data.file || null;
                self._recordingDisplayName = data.file
                    ? data.file.replace(/\.(wav|mp3|ogg)$/i, '')
                    : null;
                // Restore the Format picker to the take's format.
                if (data.format) {
                    for (var label in self._formatMeta) {
                        if (self._formatMeta[label]
                                && self._formatMeta[label].id === data.format) {
                            self._pickers.format.current = label;
                            break;
                        }
                    }
                }
                // Resume the render tick + estimate poll only
                // when actively recording; the LED reconciles
                // both flags.
                if (!self._paused) self._startRecordTick();
                self._applyRecordingLed();
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            };
            xhr.send();
        } catch (e) { /* offline — start fresh idle */ }
    };

    VoiceRecorderScene.prototype.exit = function() {
        // Leaving the foreground — if a take is still rolling it's
        // now a background recording, so let the shared status bar
        // start showing the recording icon in whatever scene is on
        // top now.
        window._voiceRecorderForeground = false;
        // Snapshot the current frame for the App Switcher card —
        // a static image of what the user last saw, captured at
        // the moment of transition. Guarded by `_lastRenderedScene`
        // so we grab the recorder's pixels, not the switcher's.
        if (typeof RunningApps !== 'undefined'
                && typeof RunningApps.setSnapshot === 'function') {
            var canvasEl = document.getElementById('screen');
            if (canvasEl && window._lastRenderedScene === this) {
                try {
                    var snap = document.createElement('canvas');
                    snap.width  = canvasEl.width;
                    snap.height = canvasEl.height;
                    snap.getContext('2d').drawImage(canvasEl, 0, 0);
                    RunningApps.setSnapshot(this.displayName, snap);
                } catch (e) { /* canvas tainted / offscreen — skip */ }
            }
        }
        // Stash recording state so the NEXT instance can paint
        // the recording panel synchronously on enter (no idle
        // flash). Cleared when no take is in flight.
        if (this._recording) {
            _recorderBgState = {
                recording:            true,
                paused:               this._paused,
                recordStartTime:      this._recordStartTime,
                pausedElapsed:        this._pausedElapsed,
                serverFile:           this._serverFile,
                recordingDisplayName: this._recordingDisplayName,
                formatLabel:          this._pickers.format.current
            };
        } else {
            _recorderBgState = null;
        }
        this._closeMicStream();
        this._stopMicMonitor();
        this._micLeft = 0;
        this._micRight = 0;
        // Tear down the running timecode tick so it doesn't
        // keep firing requestRender after the scene leaves.
        this._stopRecordTick();
        // Background persistence: a recording in progress is NOT
        // stopped on exit — it keeps running server-side, like
        // Internet Radio's stream. The red LED stays lit so the
        // hardware cue tells the user a take is still rolling
        // while they're off in another app. Only the
        // switcher-kill path (the onClose callback in enter())
        // actually halts the take. When NOT recording, drop the
        // LED back to auto as before.
        if (!this._recording) {
            this._sendLinkLed(false);
            this._sendLedManual(false);
        }
        // Install-modal spinner timer (started in _runInstall).
        if (this._installAnimTimer) {
            clearInterval(this._installAnimTimer);
            this._installAnimTimer = null;
        }
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
        // Surface a global "actively recording" flag for the shared
        // status bar (UI.drawStatusBar reads it to show the records
        // icon in every scene). Mirrors the LED condition exactly —
        // on only while recording AND not paused — so a backgrounded
        // pause hides the pulsing dot just like it drops the red LED
        // (the take is held, not rolling). This is the single hook
        // every state transition flows through (start/stop, pause/
        // resume, bg-restore, status reconcile), so the flag stays
        // in sync without sprinkling assignments everywhere. The
        // switcher-kill path clears it explicitly since it bypasses
        // this method.
        window._voiceRecorderRecording = !!(this._recording && !this._paused);
    };

    // ── Input device source ─────────────────────────────────────
    // The two NAU8822 mic switches default to both-on (so they
    // mix into the same ADC). The picker maps each label to one
    // of the server's two exclusive source modes; the server
    // toggles `Internal Microphone` / `Headset Microphone`
    // accordingly so only the chosen path is hot.
    var INPUT_DEVICE_LABEL_TO_SOURCE = {
        'Build-in mic': 'builtin',
        '3.5 Audio':    'jack'
    };
    var INPUT_DEVICE_SOURCE_TO_LABEL = {
        builtin: 'Build-in mic',
        jack:    '3.5 Audio'
    };
    VoiceRecorderScene.prototype._fetchInputSource = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/sound/input/source', true);
            xhr.timeout = 1500;
            xhr.onload = function() {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { return; }
                if (typeof data.cardPresent === 'boolean') {
                    self._codecPresent = data.cardPresent;
                }
                var label = INPUT_DEVICE_SOURCE_TO_LABEL[data.source];
                if (label && self._pickers.inputDevice.options.indexOf(label) >= 0) {
                    self._pickers.inputDevice.current = label;
                }
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            };
            xhr.send();
        } catch (e) { /* offline — keep default */ }
    };
    VoiceRecorderScene.prototype._postInputSource = function() {
        var self   = this;
        var label  = this._pickers.inputDevice.current;
        var source = INPUT_DEVICE_LABEL_TO_SOURCE[label];
        if (!source) return;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/sound/input/source', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send(JSON.stringify({ source: source }));
        } catch (e) { /* offline — ignore */ }
    };

    // ── Input gain (slider) ─────────────────────────────────────
    // Pull the server's current input-gain value (and the
    // slider's allowed range) so the on-screen ± row starts in
    // sync with whatever the codec was last set to.
    VoiceRecorderScene.prototype._fetchInputGain = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/sound/input/gain', true);
            xhr.timeout = 1500;
            xhr.onload = function() {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { return; }
                if (typeof data.min === 'number') self._inputGainMin = data.min;
                if (typeof data.max === 'number') self._inputGainMax = data.max;
                if (typeof data.db  === 'number') {
                    var db = data.db;
                    if (db < self._inputGainMin) db = self._inputGainMin;
                    if (db > self._inputGainMax) db = self._inputGainMax;
                    self._inputGainDb = db;
                }
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            };
            xhr.send();
        } catch (e) { /* offline — keep defaults */ }
    };
    // Debounced ~60 ms POST so a held arrow key only fires one
    // amixer cascade per pause instead of one per keyboard repeat.
    VoiceRecorderScene.prototype._postInputGain = function() {
        var self = this;
        if (this._gainPostTimer) clearTimeout(this._gainPostTimer);
        this._gainPostTimer = setTimeout(function() {
            self._gainPostTimer = null;
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/sound/input/gain', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.timeout = 1500;
                xhr.send(JSON.stringify({ db: self._inputGainDb }));
            } catch (e) { /* offline — ignore */ }
        }, 60);
    };

    // ── Recording start / stop ──────────────────────────────────
    // Posts /api/record/start with {format, name}. On 409
    // (missing encoder package), pops the install modal and
    // retries on success. On cancel, surfaces the original
    // failure.
    VoiceRecorderScene.prototype._postStartRecord = function(formatId, name, onResult) {
        var self = this;
        var done = false;
        function finish(result) {
            if (done) return;
            done = true;
            if (typeof onResult === 'function') onResult(result);
        }
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/start', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 2500;
            xhr.onload = function() {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { data = { success: false, error: 'Bad response' }; }
                if (!data.success && data.missingPackage && data.missingFormat) {
                    self._openInstallModal(data.missingFormat, function() {
                        self._postStartRecord(formatId, name, function(r2) { finish(r2); });
                    });
                    // Detect cancel via the open flag dropping
                    // without the success continuation firing.
                    var cancelWatch = setInterval(function() {
                        if (!self._installModal.open && !done) {
                            clearInterval(cancelWatch);
                            finish(data);
                        } else if (done) {
                            clearInterval(cancelWatch);
                        }
                    }, 120);
                    return;
                }
                finish(data);
            };
            xhr.onerror   = function() { finish({ success: false, error: 'Network error' }); };
            xhr.ontimeout = function() { finish({ success: false, error: 'Timeout' }); };
            var body = { format: formatId || 'wav' };
            if (name) body.name = name;
            xhr.send(JSON.stringify(body));
        } catch (e) {
            finish({ success: false, error: String(e.message || e) });
        }
    };
    VoiceRecorderScene.prototype._postStopRecord = function() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/stop', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 2500;
            xhr.send('{}');
        } catch (e) { /* offline — ignore */ }
    };

    // ── Format availability ─────────────────────────────────────
    VoiceRecorderScene.prototype._fetchRecordFormats = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/record/formats', true);
            xhr.timeout = 2500;
            xhr.onload = function() {
                if (xhr.status !== 200) return;
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { return; }
                if (!data || !Array.isArray(data.formats)) return;
                for (var i = 0; i < data.formats.length; i++) {
                    var f = data.formats[i];
                    if (!f || !f.label) continue;
                    self._formatMeta[f.label] = {
                        id:        f.id,
                        ext:       f.ext,
                        available: !!f.available,
                        package:   f.package
                    };
                }
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            };
            xhr.send();
        } catch (e) { /* offline — keep optimistic defaults */ }
    };

    // ── Install modal ───────────────────────────────────────────
    VoiceRecorderScene.prototype._openInstallModal = function(formatId, onSuccess) {
        var m = this._installModal;
        m.open        = true;
        m.state       = 'missing';
        m.buttonIndex = 0;
        m.output      = '';
        m.formatId    = formatId;
        m.onSuccess   = onSuccess || null;
        if (typeof window.requestRender === 'function') {
            window.requestRender();
        }
    };
    VoiceRecorderScene.prototype._runInstall = function() {
        var self = this;
        var m    = self._installModal;
        m.state  = 'installing';
        m.output = '';
        if (!self._installAnimTimer) {
            self._installAnimTimer = setInterval(function() {
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            }, 80);
        }
        var stopAnim = function() {
            if (self._installAnimTimer) {
                clearInterval(self._installAnimTimer);
                self._installAnimTimer = null;
            }
        };
        var finish = function(success, output) {
            stopAnim();
            if (success) {
                self._fetchRecordFormats();
                var cb = m.onSuccess;
                m.open       = false;
                m.onSuccess  = null;
                m.formatId   = null;
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
                if (typeof cb === 'function') cb();
                return;
            }
            m.state       = 'failed';
            m.output      = output || '';
            m.buttonIndex = 0;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
        };
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/install', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 90000;
            xhr.onload = function() {
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText || '{}');
                        finish(!!data.success, data.output);
                        return;
                    } catch (e) {}
                }
                finish(false, 'HTTP ' + xhr.status);
            };
            xhr.onerror   = function() { finish(false, 'Network error'); };
            xhr.ontimeout = function() { finish(false, 'Timeout'); };
            xhr.send(JSON.stringify({ id: m.formatId }));
        } catch (e) {
            finish(false, String(e.message || e));
        }
    };
    VoiceRecorderScene.prototype._handleInstallModalInput = function(action) {
        var m = this._installModal;
        if (m.state === 'installing') return;
        if (action === 'up' || action === 'down') {
            m.buttonIndex = (m.buttonIndex === 0) ? 1 : 0;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        if (action === 'ok' || action === 'run') {
            if (m.buttonIndex === 0) {
                this._runInstall();
            } else {
                m.open      = false;
                m.onSuccess = null;
                m.formatId  = null;
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            }
            return;
        }
        if (action === 'back' || action === 'esc') {
            m.open      = false;
            m.onSuccess = null;
            m.formatId  = null;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
    };
    VoiceRecorderScene.prototype._renderInstallModal = function(canvas) {
        var ctx = canvas.ctx;
        var m   = this._installModal;
        var W = 150, H = 70;
        var X = Math.floor((canvas.w - W) / 2);
        var Y = Math.floor((canvas.h - H) / 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        new ResponsiveFrame({
            x: X, y: Y, width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true,
            fillColor:   '#fff', showFill:   true,
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        var titleY = Y + 6;
        var bodyY  = Y + 23;
        var BTN_H  = 14;
        var BTN_W  = W - 16;
        var BTN_X  = X + Math.floor((W - BTN_W) / 2);
        var btn1Y  = Y + 36;
        var btn2Y  = Y + 52;
        function centerSporty(text, y) {
            var tw = Born2bSportyV2Medium.textWidth(text);
            Born2bSportyV2Medium.draw(ctx, text,
                X + Math.floor((W - tw) / 2), y, '#000');
        }
        function centerHaxrcorp(text, y, color) {
            var tw = HaxrcorpFont16.textWidth(text);
            HaxrcorpFont16.draw(ctx, text,
                X + Math.floor((W - tw) / 2), y, color || '#000');
        }
        var fmtLabel = (m.formatId || '').toUpperCase() || 'codec';
        if (m.state === 'installing') {
            centerSporty('Installing', titleY);
            if (typeof AnimatedIcons !== 'undefined'
                    && AnimatedIcons.spinner_22x20px) {
                var sp       = AnimatedIcons.spinner_22x20px;
                var FRAME_MS = 80;
                var spFrameH = Math.floor(sp.h / sp.frames);
                var spFrame  = Math.floor(Date.now() / FRAME_MS) % sp.frames;
                var spX      = X + Math.floor((W - sp.w) / 2);
                var spY      = Y + Math.floor((H - spFrameH) / 2) + 4;
                canvas.drawSpriteFrame(sp, spX, spY, spFrame, '#000');
            }
            return;
        }
        if (m.state === 'missing') {
            centerSporty('Install ' + fmtLabel + '?', titleY);
            centerHaxrcorp('Encoder needed for recording', bodyY, '#666');
            this._drawStackedButton(canvas, BTN_X, btn1Y, BTN_W, BTN_H,
                'Install', m.buttonIndex === 0);
            this._drawStackedButton(canvas, BTN_X, btn2Y, BTN_W, BTN_H,
                'Cancel',  m.buttonIndex === 1);
            return;
        }
        centerSporty('Install failed', titleY);
        var lines = (m.output || '').split('\n');
        var lastLine = '';
        for (var li = lines.length - 1; li >= 0; li--) {
            var t = lines[li].trim();
            if (t) { lastLine = t; break; }
        }
        if (lastLine.length > 28) lastLine = lastLine.slice(0, 26) + '..';
        centerHaxrcorp(lastLine, bodyY, '#666');
        this._drawStackedButton(canvas, BTN_X, btn1Y, BTN_W, BTN_H,
            'Retry',  m.buttonIndex === 0);
        this._drawStackedButton(canvas, BTN_X, btn2Y, BTN_W, BTN_H,
            'Cancel', m.buttonIndex === 1);
    };
    VoiceRecorderScene.prototype._drawStackedButton = function(canvas, x, y, w, h, label, selected) {
        var ctx = canvas.ctx;
        var lw  = HaxrcorpFont16.textWidth(label);
        var labelY = y + Math.floor((h - 11) / 2);
        HaxrcorpFont16.draw(ctx, label,
            x + Math.floor((w - lw) / 2), labelY, '#000');
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

    // ── Info modal (single OK button) ──────────────────────────
    // Lightweight cousin of the install modal: one title line,
    // one OK button. Used for "TBA"-style stubs where the row
    // exists in the menu but its deeper UI is still to come.
    VoiceRecorderScene.prototype._openInfoModal = function(title) {
        this._infoModal.open  = true;
        this._infoModal.title = String(title || '');
        if (typeof window.requestRender === 'function') {
            window.requestRender();
        }
    };
    VoiceRecorderScene.prototype._handleInfoModalInput = function(action) {
        if (action === 'ok' || action === 'run'
                || action === 'back' || action === 'esc') {
            this._infoModal.open = false;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
        }
    };
    VoiceRecorderScene.prototype._renderInfoModal = function(canvas) {
        var ctx = canvas.ctx;
        var m   = this._infoModal;
        var W = 150, H = 50;
        var X = Math.floor((canvas.w - W) / 2);
        var Y = Math.floor((canvas.h - H) / 2);
        // Wash everything behind the modal.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        // Modal body — same fill / stroke / corner as the
        // install modal so the two read as siblings.
        new ResponsiveFrame({
            x: X, y: Y, width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true,
            fillColor:   '#fff', showFill:   true,
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        var titleY = Y + 8;
        var BTN_H  = 14;
        var BTN_W  = W - 16;
        var BTN_X  = X + Math.floor((W - BTN_W) / 2);
        var btnY   = Y + H - BTN_H - 6;
        // Title — same Born2bSportyV2 face the install modal
        // uses for its top line, so the type weight matches.
        var titleStr = m.title || '';
        var tw       = Born2bSportyV2Medium.textWidth(titleStr);
        Born2bSportyV2Medium.draw(ctx, titleStr,
            X + Math.floor((W - tw) / 2), titleY, '#000');
        // OK button — always focused since it's the only button.
        this._drawStackedButton(canvas, BTN_X, btnY, BTN_W, BTN_H,
            'OK', true);
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
        // Status poll for the Available / time-left numbers in
        // the recording panel. Once a minute — at typical voice-
        // memo bitrates the time-left changes by under a minute
        // per minute, so any faster cadence just makes the
        // bottom-right text flicker between near-identical
        // estimates. The initial kick runs now so the panel
        // shows real numbers from the first frame.
        self._fetchRecordEstimate();
        if (this._estimatePollTimer) clearInterval(this._estimatePollTimer);
        this._estimatePollTimer = setInterval(function() {
            self._fetchRecordEstimate();
        }, 60000);
    };
    VoiceRecorderScene.prototype._stopRecordTick = function() {
        if (this._recordTickTimer) {
            clearInterval(this._recordTickTimer);
            this._recordTickTimer = null;
        }
        if (this._estimatePollTimer) {
            clearInterval(this._estimatePollTimer);
            this._estimatePollTimer = null;
        }
    };

    // Bytes-per-second the codec writes per format. Used as the
    // fallback rate before we have enough elapsed time to
    // observe one from the running take (and as the rate while
    // we're not recording at all). Values are the nominal
    // pipeline-out byte rates the server's RECORD_FORMATS
    // settings produce.
    //   wav — 48 kHz × 16 bit × 1 ch = 96 000 B/s
    //   mp3 — lame -V 4 ≈ 165 kbps ≈ 20 625 B/s
    //   ogg — oggenc -q 4 ≈ 128 kbps ≈ 16 000 B/s
    var FORMAT_NOMINAL_BPS = {
        wav: 96000,
        mp3: 20625,
        ogg: 16000
    };

    // Pull the latest /api/record/status and stash bytes,
    // elapsedMs, freeBytes into `_recordEstimate`. Render uses
    // these to compute the live "Available" / time-left
    // values. Idempotent: starting / stopping the take just
    // resets the cached counters.
    VoiceRecorderScene.prototype._fetchRecordEstimate = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/record/status', true);
            xhr.timeout = 1500;
            xhr.onload = function() {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { return; }
                if (typeof data.freeBytes  === 'number') self._recordEstimate.freeBytes  = data.freeBytes;
                if (typeof data.totalBytes === 'number') self._recordEstimate.totalBytes = data.totalBytes;
                if (typeof data.bytes      === 'number') self._recordEstimate.bytes      = data.bytes;
                if (typeof data.elapsedMs  === 'number') self._recordEstimate.elapsedMs  = data.elapsedMs;
                if (typeof data.format     === 'string') self._recordEstimate.format     = data.format;
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            };
            xhr.send();
        } catch (e) { /* offline — keep last values */ }
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
            this._postRecordResume();
        } else {
            // Pause.
            this._pausedElapsed = Date.now() - this._recordStartTime;
            this._paused = true;
            this._stopRecordTick();
            this._postRecordPause();
        }
        // Link LED follows recording state minus pause —
        // _applyRecordingLed reads both flags and reconciles.
        this._applyRecordingLed();
    };

    // Fire-and-forget POST helpers — the server SIGSTOPs sox
    // (+ encoder) on pause and SIGCONTs on resume so audio
    // captured during the pause window doesn't end up in the
    // file. The UI clock is already frozen by the time we POST,
    // so a slight network delay just means the file truncation
    // and the displayed timecode line up after a beat.
    VoiceRecorderScene.prototype._postRecordPause = function() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/pause', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send('{}');
        } catch (e) { /* offline — UI still pauses locally */ }
    };
    VoiceRecorderScene.prototype._postRecordResume = function() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/resume', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send('{}');
        } catch (e) { /* offline — UI still resumes locally */ }
    };

    // Format an elapsed-ms count as HH:MM:SS:FF (FF = hundredths
    // of a second) for the live timecode that paints inside the
    // recording rectangle while a take is in flight. Caps at
    // 99:59:59:99 — well beyond any plausible voice-memo session.
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
    // that don't carry a picker (Input gain, File name, Folder).
    // Keeping this in one place means every "is this a picker
    // row?" check is identical across handleInput and render.
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
        // ── Modals own input first ───────────────────────────
        // They draw on top of every other element including the
        // dropdown overlay, so input dispatch matches that
        // layering — give the modal first refusal. Info modal
        // takes precedence over install (only one is ever open
        // at a time today, but if that ever changes the simpler
        // modal yields the user out faster).
        if (this._infoModal.open) {
            return this._handleInfoModalInput(action);
        }
        if (this._installModal.open) {
            return this._handleInstallModalInput(action);
        }
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
                var pickedLabel    = optsOpen[this._dropdownIndex];
                var committedKey   = this._dropdownKey;
                this._dropdownOpen = false;
                this._dropdownKey  = null;
                // Format row needs an availability gate — an
                // unavailable encoder pops the install modal
                // and only commits the new picker value on a
                // successful install.
                if (committedKey === 'format') {
                    var meta = this._formatMeta[pickedLabel];
                    if (meta && !meta.available && meta.package) {
                        var pickerRef = picker;
                        this._openInstallModal(meta.id, function() {
                            pickerRef.current = pickedLabel;
                            if (typeof window.requestRender === 'function') {
                                window.requestRender();
                            }
                        });
                    } else {
                        picker.current = pickedLabel;
                    }
                } else {
                    var pickerChanged = picker.current !== pickedLabel;
                    picker.current = pickedLabel;
                    if (pickerChanged && committedKey === 'inputDevice') {
                        this._postInputSource();
                    }
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
            var rowCount = this._recording ? 1 : 5;
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
                // Input-device picker is inert when the NAU8822
                // codec is missing — without the card there's
                // no source to switch between, and opening the
                // dropdown would just present options that
                // can't be applied.
                if (pkOk === 'inputDevice' && !this._codecPresent) {
                    return;
                }
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
            } else if (this._selectedRow === 3) {
                // Folder row's eventual job is "drill into a
                // mini file manager so the user can pick the
                // destination folder for new takes". Until that
                // exists, OK pops a small stub modal so the
                // press has acknowledged feedback instead of
                // reading as a dead key.
                this._openInfoModal('File manager: TBA');
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
                // Input-device picker is inert without the
                // NAU8822 codec — left / right is a no-op so
                // the row stays at "Not found" instead of
                // cycling phantom options.
                if (pkLR === 'inputDevice' && !this._codecPresent) {
                    return;
                }
                var pLR = this._pickers[pkLR];
                if (!pLR || pLR.options.length <= 1) return;
                var idx = pLR.options.indexOf(pLR.current);
                if (idx < 0) idx = 0;
                idx = (action === 'right')
                    ? (idx + 1) % pLR.options.length
                    : (idx - 1 + pLR.options.length) % pLR.options.length;
                var nextLabel = pLR.options[idx];
                // Format row mirrors the dropdown gate: an
                // unavailable encoder opens the install modal
                // and only commits the new value on success.
                if (pkLR === 'format') {
                    var fmeta = this._formatMeta[nextLabel];
                    if (fmeta && !fmeta.available && fmeta.package) {
                        var pkRef = pLR;
                        this._openInstallModal(fmeta.id, function() {
                            pkRef.current = nextLabel;
                            if (typeof window.requestRender === 'function') {
                                window.requestRender();
                            }
                        });
                    } else {
                        pLR.current = nextLabel;
                    }
                } else {
                    var lrChanged = pLR.current !== nextLabel;
                    pLR.current = nextLabel;
                    if (lrChanged && pkLR === 'inputDevice') {
                        this._postInputSource();
                    }
                }
            } else if (this._selectedRow === 0) {
                var delta = (action === 'right')
                    ? this._inputGainStep
                    : -this._inputGainStep;
                var next  = this._inputGainDb + delta;
                if (next < this._inputGainMin) next = this._inputGainMin;
                if (next > this._inputGainMax) next = this._inputGainMax;
                if (next !== this._inputGainDb) {
                    this._inputGainDb = next;
                    this._postInputGain();
                }
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
        // Always seed with the raw template — the user needs to
        // see the bracketed substitution pattern (e.g. `[YYYYMMDD-
        // HHMMSS]`) so they can edit it (drop SS, swap order,
        // remove the brackets entirely if they want a literal
        // name). Showing the expanded timestamp would force the
        // user to re-type the placeholder from memory every time
        // they wanted to tweak it.
        var seed = this._fileName;
        var screen = new TextInputScreen({
            displayName: 'File name',
            title:       'File name',
            initialText: seed,
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

        // (5) Input level — single non-focusable readout for the
        // currently selected mic source. The codec captures both
        // ADC channels, but each is wired to a different physical
        // mic (built-in → left, 3.5-mm jack → right per the
        // device-tree routing), so the chosen source has its
        // signal on exactly one channel. We pick that channel
        // and paint a thin progress bar that lines up with the
        // chip column of the menu rows below (same width / x
        // anchor / rounded corners), but only 7 px tall — same
        // height as the original stereo meters used. No L / R
        // labels — the level is implicitly the active mic.
        var INPUT_LEVEL_Y     = 31;
        var INPUT_LEVEL_BAR_W = MenuDropdownLine.CHIP_WIDTH;       // 180
        var INPUT_LEVEL_BAR_H = 7;                                  // restored meter height
        var INPUT_LEVEL_BAR_R = 2;                                  // matches original meter radius
        var INPUT_LEVEL_BAR_X = canvas.w - 5 - INPUT_LEVEL_BAR_W;   // 5 = MenuDropdownLine right pad
        // Sit the bar 2 px above where a centred chip would land
        // — its top edge then aligns roughly with the title
        // text's cap line, which reads tighter than the centred
        // placement and gives the row a bit more breathing room
        // at the bottom before the next row starts.
        var INPUT_LEVEL_BAR_Y = INPUT_LEVEL_Y
                              + Math.floor((MenuDropdownLine.CHIP_HEIGHT - INPUT_LEVEL_BAR_H) / 2);
        var activeLvl  = (this._pickers.inputDevice.current === '3.5 Audio')
                            ? this._micRight
                            : this._micLeft;
        var lvlClamped = Math.max(0, Math.min(100, activeLvl));
        // Title — sat 2 px higher than a MenuDropdownLine title
        // would, so its cap line aligns with the bar's top edge
        // rather than its midline. The Input-level row isn't a
        // selectable picker, so it doesn't need the same
        // baseline as the rows below it.
        HaxrcorpFont16.draw(ctx, 'Input level',
            6, INPUT_LEVEL_Y, '#000');
        // Transparent base with a black outline. At level 0 the
        // bar reads as an empty rounded rectangle; as the peak
        // fill grows from the left it overwrites the outline on
        // the filled portion, leaving the outline visible only
        // around the remaining empty area.
        new ResponsiveFrame({
            x: INPUT_LEVEL_BAR_X,     y: INPUT_LEVEL_BAR_Y,
            width: INPUT_LEVEL_BAR_W, height: INPUT_LEVEL_BAR_H,
            anchorH: 'left',          anchorV: 'top',
            showFill:     false,
            showStroke:   true,
            strokeColor:  '#000',
            cornerRadius: INPUT_LEVEL_BAR_R
        }).render(canvas);
        // Black peak fill — proportional to the active channel's
        // 0..100 level. Pure level-meter behaviour: at level 0
        // the bar is fully gray (no min-fill nub), so silence
        // reads as silence.
        if (lvlClamped > 0) {
            var fillW  = Math.round(INPUT_LEVEL_BAR_W * lvlClamped / 100);
            var isFull = fillW >= INPUT_LEVEL_BAR_W;
            new ResponsiveFrame({
                x: INPUT_LEVEL_BAR_X,     y: INPUT_LEVEL_BAR_Y,
                width: fillW,             height: INPUT_LEVEL_BAR_H,
                anchorH: 'left',          anchorV: 'top',
                showStroke:   false,
                fillColor:    '#000',
                showFill:     true,
                cornerRadius: INPUT_LEVEL_BAR_R,
                corners: {
                    tl: true,             bl: true,
                    tr: isFull,           br: isFull
                }
            }).render(canvas);
        }

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
        var ROW_GAP    = 2;
        // 3-px breathing gap between the Input level bar's
        // bottom edge and the first focusable menu row. Expressed
        // relative to the bar's geometry (not the chip slot) so
        // the gap stays a true 3 px regardless of the bar
        // height we end up picking.
        var gainRowY   = INPUT_LEVEL_BAR_Y + INPUT_LEVEL_BAR_H + 3;
        var deviceRowY = gainRowY   + MenuDropdownLine.HEIGHT + ROW_GAP;
        var fileRowY   = deviceRowY + MenuDropdownLine.HEIGHT + ROW_GAP;
        var folderRowY = fileRowY   + MenuDropdownLine.HEIGHT + ROW_GAP;
        var formatRowY = folderRowY + MenuDropdownLine.HEIGHT + ROW_GAP;
        // Table that maps row index to its y anchor so the
        // selector / dropdown overlay can look up the row
        // position without re-doing the math.
        var rowYs = [gainRowY, deviceRowY, fileRowY, folderRowY, formatRowY];

        // Input gain row (row 0, topmost) — inline ± value,
        // no dropdown. Always visible, including while
        // recording so the user can still ride the gain.
        new MenuDropdownLine({
            y:        gainRowY,
            title:    'Input gain',
            value:    this._formatGain(this._inputGainDb),
            selected: !this._dropdownOpen && this._selectedRow === 0
        }).render(canvas);

        // Rows 1..4 are only present out of recording mode.
        // While `_recording` is true a single placeholder frame
        // takes their slot (drawn further down).
        if (!this._recording) {
            // Input device row (row 1) — dropdown picker. When
            // the NAU8822 codec isn't enumerable on the host we
            // swap the value to "Not found" and suppress the
            // `selected` flag so the cycling arrows don't paint
            // (there's nothing to cycle between).
            new MenuDropdownLine({
                y:        deviceRowY,
                title:    'Input device',
                value:    this._codecPresent
                    ? this._pickers.inputDevice.current
                    : 'Not found',
                // Show the `< value >` arrows only when this
                // row is both focused AND the dropdown isn't
                // open AND the codec exists — same dual
                // condition Internet Radio uses, extended with
                // the codec-present gate so a missing card
                // reads as inert.
                selected: !this._dropdownOpen
                       && this._selectedRow === 1
                       && this._codecPresent
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
            var REC_RECT_Y = 65;
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
            // Render the name the server actually chose
            // (`_serverFile`, returned by /api/record/start) so
            // the panel reflects any `-1`, `-2`, … collision
            // suffix the server appended. The extension is
            // stripped because the bottom-left of the panel
            // already shows the format. While the start response
            // is still in flight `_serverFile` is null, so we
            // fall through to the locally-expanded display name
            // — small lag, then the suffixed form appears.
            var FN_TEXT_X = REC_RECT_X + 7;
            var FN_TEXT_Y = REC_RECT_Y + 1;
            var fnText;
            if (this._serverFile) {
                fnText = this._serverFile.replace(/\.(wav|mp3|ogg)$/i, '');
            } else {
                fnText = this._recordingDisplayName || this._fileName;
            }
            Born2bSportyV2Medium.draw(canvas.ctx, fnText,
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
                if (!this._paused) {
                    // Breathe the record circle while actively
                    // recording — same pulse as the background
                    // status-bar indicator (~1.6s sine, alpha
                    // 0.35..1.0). The 33ms record tick already
                    // drives repaints, so it animates smoothly.
                    // Paused shows the pause icon static (below).
                    var lampPulse = 0.5 + 0.5 * Math.sin(Date.now() / 250);
                    var lampAlpha = 0.35 + 0.65 * lampPulse;
                    canvas.drawSprite(lampIcon, lampX, lampY, '#FFFFFF', lampAlpha);
                } else {
                    canvas.drawSprite(lampIcon, lampX, lampY, '#FFFFFF');
                }
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
            //   1. time-left — at BOTTOM_TEXT_Y (shared baseline
            //                  with Format / Folder on the left).
            //   2. free GB  — 2-px gap above (1).
            //   3. "Available:" label — 2-px gap above (2).
            // Spacing maths use HaxrcorpFont16's 11-row bitmap
            // height and a 2-row inter-line gap.
            var RIGHT_PAD     = 5;
            var LINE_H        = 11;
            var LINE_GAP      = 2;
            var rightTextX    = REC_RECT_X + REC_RECT_W - RIGHT_PAD;
            function drawRightAligned(ctx, text, y) {
                var w = HaxrcorpFont16.textWidth(text);
                HaxrcorpFont16.draw(ctx, text, rightTextX - w, y, '#FFFFFF');
            }

            // Pick a bytes-per-second rate: prefer the
            // observed rate from the running take (size /
            // elapsed) once we have at least 2 s of elapsed
            // time, otherwise fall back to the format's nominal
            // byte rate. The 2-s gate keeps the first poll from
            // producing a wildly-inflated number off a single
            // small chunk.
            var est       = this._recordEstimate;
            var fmtMeta   = this._formatMeta[this._pickers.format.current] || {};
            var fmtId     = est.format || fmtMeta.id || 'wav';
            var nominal   = FORMAT_NOMINAL_BPS[fmtId] || FORMAT_NOMINAL_BPS.wav;
            var observed  = (est.bytes > 0 && est.elapsedMs >= 2000)
                          ? (est.bytes * 1000 / est.elapsedMs)
                          : 0;
            var bytesPerSec = observed > 0 ? observed : nominal;

            // Format helpers — kept inline so they don't leak
            // into the scene's prototype just for two call sites.
            function fmtBytes(b) {
                if (b == null) return '—';
                if (b >= 1024 * 1024 * 1024) {
                    return (b / 1024 / 1024 / 1024).toFixed(1) + ' GB';
                }
                if (b >= 1024 * 1024) {
                    return Math.round(b / 1024 / 1024) + ' MB';
                }
                return Math.round(b / 1024) + ' KB';
            }
            function fmtDuration(s) {
                if (!isFinite(s) || s < 0) return '—';
                if (s >= 3600) {
                    var h = Math.floor(s / 3600);
                    var m = Math.floor((s % 3600) / 60);
                    return h + 'h ' + m + 'm';
                }
                if (s >= 60) {
                    var mm = Math.floor(s / 60);
                    var ss = Math.floor(s % 60);
                    return mm + 'm ' + ss + 's';
                }
                return Math.floor(s) + 's';
            }

            var freeBytesV  = (est.freeBytes != null) ? est.freeBytes : null;
            var freeText    = fmtBytes(freeBytesV);
            var timeLeftText = (freeBytesV != null && bytesPerSec > 0)
                ? fmtDuration(freeBytesV / bytesPerSec)
                : '—';

            var bottomLineY = BOTTOM_TEXT_Y;
            var midLineY    = bottomLineY - LINE_GAP - LINE_H;
            var topLineY    = midLineY    - LINE_GAP - LINE_H;
            drawRightAligned(canvas.ctx, timeLeftText, bottomLineY);
            drawRightAligned(canvas.ctx, freeText,     midLineY);
            drawRightAligned(canvas.ctx, 'Available:', topLineY);
        }

        // Page-level selector outline anchored to the focused
        // row. File name / Folder rows use the chevron-bearing
        // variant; the picker / value rows use the plain
        // outline. Suppressed entirely while the dropdown
        // overlay is open so the inner-selector inside it is
        // the only "this is focused" cue on screen.
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
        //   recording : Home  | Files | …     | Pause   | Stop
        //   paused    : Home  | Files | …     | Resume  | …
        //
        // The right-button label flips between Start and Stop
        // each render; the middle slot's button flips between
        // Pause and Resume the same way. Files stays in slot 1
        // across every state so the file browser is reachable
        // even mid-take.
        if (this._startBtn) {
            this._startBtn.text = this._recording ? 'Stop' : 'Start';
        }
        if (this._pauseBtn) {
            this._pauseBtn.text = this._paused ? 'Resume' : 'Pause';
        }
        if (this._homeBtn)  this._homeBtn.render(canvas);
        if (this._filesBtn) this._filesBtn.render(canvas);
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

        // Install-dependency modal — drawn LAST so it sits
        // above every other element including the dropdown.
        // Open state is set by _openInstallModal; the modal
        // owns input the entire time it's open (gated at the
        // top of handleInput).
        if (this._installModal.open) {
            this._renderInstallModal(canvas);
        }
        // Info modal — same "above everything" layering as the
        // install modal. Painted after it so if both ever ended
        // up open the info acknowledgement sits on top (the
        // gate at the top of handleInput also routes input to
        // info first, keeping the two ends consistent).
        if (this._infoModal.open) {
            this._renderInfoModal(canvas);
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

        // Direction. By default the overlay grows downward from
        // the chip's top — same visual "the chip expanded
        // downward" trick Internet Radio uses. When the row sits
        // near the bottom of the screen (Format row, in this
        // app), there isn't room: the last items would render
        // off-screen. In that case we flip: anchor the body's
        // BOTTOM to the chip's bottom and grow upward. The
        // title still lives at the row's natural y, so the
        // dropdown stays visually tethered to its row either
        // way.
        var BOTTOM_MARGIN = 2;
        var dropUp = (chipY + H > canvas.h - BOTTOM_MARGIN);
        var bodyY  = dropUp
            ? (chipY + MenuDropdownLine.CHIP_HEIGHT - H)
            : chipY;

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
        // chipY already equals row.y + TOP_PAD). Note the title
        // y stays at chipY even when the body flips upward —
        // anchors the dropdown to the originating row.
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
        // dropdown reads as the chip growing into the list —
        // downward in the default case, upward when we flipped.
        new ResponsiveFrame({
            x: chipX, y: bodyY,
            width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            showStroke: false,
            showFill:   true, fillColor: MenuDropdownLine.CHIP_FILL,
            cornerRadius: 3,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);

        // (4) Items + dividers. Items are centred HaxrcorpFont16;
        // each item block is ITEM_H tall with a 1-px divider
        // after it (except the last). Top stroke = body row 0;
        // first item sits at body row 1. Item order (top = first
        // option) is preserved regardless of direction so the
        // visual mapping `index 0 = top item` stays stable.
        var selectedItemY = bodyY + 1;
        for (var i = 0; i < n; i++) {
            var itemY = bodyY + 1 + i * (ITEM_H + DIV_H);
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
