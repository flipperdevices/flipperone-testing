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

    // CEC support-detection knobs. We probe `tv-present` quickly on
    // HDMI connect; the first ACK promotes us to 'supported' (sticky
    // for the HDMI session — never re-flapped by a missed poll), and
    // CEC_MISS_LIMIT consecutive misses settle us at 'not_supported'.
    // 3 misses × 2 s = ~6 s before we give up — enough to absorb bus
    // jitter without leaving the user staring at dots.
    var CEC_MISS_LIMIT      = 3;
    var CEC_PROBE_PERIOD_MS = 2000;
    var CEC_ANIM_PERIOD_MS  = 333;

    // Mid-session tv-power tolerance: a single null reply is more
    // likely CEC bus jitter than the TV genuinely powering down, so
    // we keep showing 'Checking' until we've seen TV_POWER_MISS_LIMIT
    // nulls in a row. At the 3 s poll cadence that's ~9 s before we
    // commit to 'Off' — a non-null reply at any point resets the
    // counter and snaps us back to the live state.
    var TV_POWER_MISS_LIMIT = 3;

    // Grace window after a Start TV / TV OFF command. Suppresses two
    // independent "TV: Off" flashes during the TV's wake/sleep cycle:
    //   1. HDMI HPD flap: TVs drop HPD and wipe their EDID while they
    //      renegotiate, which otherwise tears down our CEC state and
    //      shows 'HDMI: disconnected' → 'TV: Off'.
    //   2. CEC silence: a booting TV ignores --give-device-power-status
    //      until it finishes coming up. Without the grace mask, the
    //      tv-power miss counter would hit TV_POWER_MISS_LIMIT mid-boot
    //      and commit to 'Off'.
    // A real cable yank or a TV that takes longer than this to come up
    // still surfaces — the grace just delays the "Off" verdict.
    var POST_CMD_GRACE_MS   = 15000;

    // Settings-row layout. Two MenuDropdownLine rows stacked below
    // the TV graphic + CEC line. SELECTOR_* mirror Internet Radio
    // so the page-level selection outline reads the same here.
    var ROW1_Y      = 97;
    var ROW_GAP     = 2;
    var ROW2_Y      = ROW1_Y + MenuDropdownLine.HEIGHT + ROW_GAP;
    var SELECTOR_X  = 2;
    var SELECTOR_W  = 252;
    var SELECTOR_H  = 15;

    // Turn a CEC physical address ('1.0.0.0', '2.0.0.0', …) into a
    // user-friendly TV input label. The first nibble is the
    // top-level HDMI port; 0 or 'f' means "the TV itself" (internal
    // tuner / app / no source).
    function physAddrToInputName(pa) {
        if (!pa || pa === '0.0.0.0' || pa === 'f.f.f.f') return 'TV';
        var first = pa.split('.')[0];
        if (first === '0' || first === 'f') return 'TV';
        return 'HDMI' + first;
    }

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

        // Preset run-state, polled from /api/tvmb/status (kodiRunning is
        // a server-side `pgrep -x kodi.bin` check). Drives the
        // "Running Kodi" label on the title bar.
        this._kodiRunning       = false;
        this._presetStatusTimer = null;

        // HDMI connector state, polled from /api/hdmi. `_hdmiLoaded`
        // gates the "..." placeholder until the first reply lands.
        this._hdmiLoaded     = false;
        this._hdmiConnected  = false;
        this._hdmiResolution = null;   // preferred mode, e.g. '3840x2160'
        this._hdmiTimer      = null;

        // CEC dependency + screen state. On HDMI connect we register
        // our adapter once, then run a cheap tv-present probe loop
        // until we resolve the screen's CEC support. Once 'supported',
        // the result is sticky for the HDMI session — the probe loop
        // stops and only the tv-power poll continues (button label).
        //   _cecInstalled  — cec-ctl present (null until dep check returns)
        //   _cecState      — 'checking' | 'supported' | 'not_supported'
        //   _cecMisses     — consecutive --poll misses (drives 'not_supported')
        //   _cecStarting   — enable in flight (guards double-start)
        //   _cecProbeTimer — tv-present poll, only in 'checking'
        //   _cecAnimTimer  — animates the "checking..." dots
        //   _cecTimer      — tv-power poll, only in 'supported'
        this._cecInstalled  = null;
        this._cecState      = 'checking';
        this._cecMisses     = 0;
        this._cecStarting   = false;
        this._cecProbeTimer = null;
        this._cecAnimTimer  = null;
        this._cecTimer      = null;
        // Distinguishes "haven't asked for TV power yet" (shows
        // 'Checking') from "asked and got null" (shows 'Off'). Reset
        // alongside _tvPower on HDMI disconnect.
        this._tvPowerChecked = false;
        // Consecutive null tv-power replies. While 0 < _tvPowerMisses
        // < TV_POWER_MISS_LIMIT we display 'Checking' (transient bus
        // glitch is more likely than the TV actually disappearing);
        // at the limit we finally commit to 'Off'.
        this._tvPowerMisses = 0;
        // Timestamp of the last Start TV / TV OFF command. Drives the
        // POST_CMD_GRACE_MS mask against transient HDMI HPD flaps
        // during TV wake/sleep. 0 = never issued one.
        this._lastTvCmdAt = 0;

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

        // Active-source mismatch modal — opened once per CEC session
        // when /api/cec/active-source reports the TV is displaying a
        // different physical address than ours. User picks:
        //   buttonIndex 0 → Switch (re-uses the Start TV path so it
        //                   also wakes the TV if needed)
        //   buttonIndex 1 → Keep current source (and dismiss for the
        //                   rest of this HDMI session)
        // `checked` blocks re-querying after the first answer;
        // `dismissed` blocks re-opening even on subsequent checks.
        this._sourceModal = {
            open:           false,
            buttonIndex:    0,
            tvSourceName:   '',
            ourSourceName:  '',
            checked:        false,
            dismissed:      false
        };

        // Bottom-bar buttons.
        //   Start (right / run)  — unified launch: wakes the TV via
        //                          CEC (when supported) and spawns
        //                          the binary for the selected preset.
        //                          Visible whenever HDMI is connected.
        //   Stop (left / esc)    — kills the running preset via
        //                          POST /api/tvmb/stop. Only while
        //                          Kodi is running.
        var self = this;
        this._startBtn = new UI.RightButton('Start', 48, 'run', function() {
            self._handleStart();
        }, 256);
        this._stopBtn = new UI.LeftButton('Stop', 48, 'esc', function() {
            self._stopKodi();
        });

        // Body frame — decorative card that tucks underneath the title
        // bar. y=16 puts the top 13 px (with the rounded corners) behind
        // the title bar at y=13..29, so only the bottom edge + side
        // walls are visible. Static layout; cache the instance.
        this._bodyFrame = new ResponsiveFrame({
            x: 6, y: 16, width: 244, height: 76,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#919191', showStroke: true,
            showFill: false,
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        });

        // Settings pickers. Each picker owns its options list and
        // current value; rows tag themselves with a pickerKey so OK
        // can look up the right picker without per-row logic.
        this._pickers = {
            videoOut: { options: ['HDMI', 'DisplayPort USB C1'],          current: 'HDMI' },
            preset:   { options: ['Kodi TV', 'Linux Desktop', 'AirPlay'], current: 'Kodi TV' }
        };
        // Active-dropdown state. Both null/false means no dropdown
        // is open; `_dropdownIndex` is the currently-highlighted
        // item INSIDE the open dropdown (page-level selection lives
        // in `_selectedRow`).
        this._dropdownOpen   = false;
        this._dropdownKey    = null;
        this._dropdownIndex  = 0;
        // Page-level row selection. Index into _buildRows().
        this._selectedRow = 0;
        // Cached selector frames — one for the page-level outline
        // around the active row, one for the highlight inside the
        // open dropdown. Lazy-instantiated in render to avoid
        // declaring MenuSelectorFrame before its script tag.
        this._pageSelectorFrame     = null;
        this._dropdownInnerSelector = null;

        // Screen-info badge — filled black pill centered horizontally
        // on x=175 (the midpoint of the original fixed 84 px width).
        // Width adapts each render to wrap the live label string with
        // 3 px of padding on each side; height stays 9 px. Content
        // swaps based on HDMI state: 'No screen detected' when
        // unplugged, '<W>x<H> <NN>Hz' once a screen is attached.
        this._screenInfoFrame = new ResponsiveFrame({
            x: 175, y: 50, width: 84, height: 9,
            anchorH: 'center', anchorV: 'top',
            fillColor:   '#000', showFill:   true,
            strokeColor: '#000', showStroke: false,
            cornerRadius: 3,
            corners: { tl: true, tr: true, bl: true, br: true }
        });
    }

    // True when the TV is on (or coming on) per the latest power poll.
    TVMediaBoxScene.prototype._isTvOn = function() {
        return this._tvPower === 'on' || this._tvPower === 'to-on';
    };

    // POST a TV power command, then re-query power to reflect the result
    // (the 3s poll keeps it current through the on/standby transition).
    // Clearing _tvPowerChecked here forces the on-sprite label back to
    // 'Checking' until the next poll lands — otherwise the user sees
    // the bottom-bar button flip instantly while the TV label lags up
    // to one full 3 s poll tick behind it.
    TVMediaBoxScene.prototype._sendTv = function(url) {
        var self = this;
        self._tvPowerChecked = false;
        self._tvPowerMisses  = 0;
        self._lastTvCmdAt    = Date.now();
        if (window.requestRender) window.requestRender();
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.timeout = 8000;
        xhr.onload   = function() { self._fetchTvPower(); };
        xhr.send();
    };

    // Unified Start: wakes the TV over CEC (when supported and the
    // TV isn't already on) and tells the server to spawn the binary
    // for the selected Preset. Both halves are best-effort and fire
    // independently — Linux Desktop on a PC monitor works fine with
    // CEC missing, and Kodi on a sleeping TV works fine if CEC wakes
    // it. The server keeps a single preset child slot, so pressing
    // Start while one is running replaces it.
    TVMediaBoxScene.prototype._handleStart = function() {
        var preset = this._pickers.preset.current;
        // Always assert TV power + our input on Start (when CEC is
        // supported): /api/cec/start-tv sends image-view-on (wakes the
        // TV) and active-source (switches it to our HDMI input).
        if (this._cecState === 'supported') {
            this._sendTv('/api/cec/start-tv');
        }
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/tvmb/start', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 5000;
        xhr.send(JSON.stringify({ preset: preset }));
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

    // One status fetch → updates _kodiRunning + repaints on change.
    // kodiRunning is a truthful `pgrep -a kodi` check on the server.
    TVMediaBoxScene.prototype._refreshPresetStatus = function() {
        var self = this;
        return fetch('/api/tvmb/status', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var running = !!(data && data.kodiRunning);
                if (running !== self._kodiRunning) {
                    self._kodiRunning = running;
                    if (window.requestRender) window.requestRender();
                }
            })
            .catch(function() { /* keep last known state */ });
    };

    // Poll preset status every 3s so the Running label + Start/Stop
    // buttons track reality (including Kodi exiting on its own).
    TVMediaBoxScene.prototype._startPresetStatusPoll = function() {
        var self = this;
        this._refreshPresetStatus();
        this._presetStatusTimer = setInterval(function() {
            self._refreshPresetStatus();
        }, 3000);
    };

    // Stop button → kill Kodi (server runs `killall kodi.bin kodi`) and,
    // when CEC is supported, also put the TV into standby. Optimistically
    // flip _kodiRunning so the Stop→Start swap is instant; the next poll
    // confirms (and corrects if the kill somehow failed).
    TVMediaBoxScene.prototype._stopKodi = function() {
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/tvmb/stop', true);
        xhr.timeout = 5000;
        xhr.send();
        // Also turn the TV off over CEC (standby), same as the old TV OFF.
        if (this._cecState === 'supported') {
            this._sendTv('/api/cec/tv-off');
        }
        self._kodiRunning = false;
        if (window.requestRender) window.requestRender();
    };

    TVMediaBoxScene.prototype._startHdmiPoll = function() {
        var self = this;
        var poll = function() {
            fetch('/api/hdmi', { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var connected = !!(data && data.connected);
                    var resolution = (data && data.resolution) || null;
                    // Post-command grace: mask transient disconnects so
                    // a TV's wake/sleep HPD flap doesn't tear down CEC
                    // state and flash 'TV: Off'. We only mask the
                    // disconnect direction — a transition from
                    // 'connected' back to 'connected' (resolution
                    // change, refresh-rate negotiation) passes through.
                    var inGrace = (Date.now() - self._lastTvCmdAt) < POST_CMD_GRACE_MS;
                    if (inGrace && !connected && self._hdmiConnected) {
                        connected  = true;
                        resolution = self._hdmiResolution;
                    }
                    // Only act when something changes (or on first load).
                    if (self._hdmiLoaded && connected === self._hdmiConnected
                        && resolution === self._hdmiResolution) return;
                    var was = self._hdmiConnected;
                    self._hdmiLoaded = true;
                    self._hdmiConnected = connected;
                    self._hdmiResolution = resolution;
                    // CEC is checked on the connect transition, not polled.
                    // Start the dot animation here too so the "checking"
                    // line animates even before deps resolve and probing
                    // begins (_maybeCheckScreenCec might early-return).
                    if (connected && !was) {
                        self._startCecAnim();
                        self._maybeCheckScreenCec();
                    } else if (!connected && was) {
                        self._resetCecState();
                    }
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

    // Clear screen-CEC state + stop every CEC-related timer — called on
    // HDMI disconnect so a re-connect re-detects from scratch.
    TVMediaBoxScene.prototype._resetCecState = function() {
        this._stopCecProbe();
        this._stopCecAnim();
        this._stopCecPoll();
        this._cecState    = 'checking';
        this._cecMisses   = 0;
        this._cecStarting = false;
        this._tvPower     = null;
        this._tvPowerChecked = false;
        this._tvPowerMisses = 0;
        // Reset the source-mismatch modal so the next HDMI session
        // gets a fresh check + (if needed) a fresh prompt.
        this._sourceModal.open      = false;
        this._sourceModal.checked   = false;
        this._sourceModal.dismissed = false;
    };

    // Once per HDMI-connected session (deps present + HDMI connected):
    // register our adapter (--playback), then start the tv-present
    // probe loop. Idempotent — early-returns once we've left 'checking'
    // or the probe is already running.
    TVMediaBoxScene.prototype._maybeCheckScreenCec = function() {
        if (!this._cecInstalled || !this._hdmiConnected) return;
        if (this._cecState !== 'checking') return;
        if (this._cecStarting || this._cecProbeTimer) return;
        this._cecStarting = true;
        var self = this;
        var go = function() { self._cecStarting = false; self._startCecProbe(); };
        var en = new XMLHttpRequest();
        en.open('POST', '/api/cec/enable', true);
        en.timeout = 6000;
        en.onload = go; en.onerror = go; en.ontimeout = go;
        en.send();
    };

    // tv-present probe loop. Runs only while 'checking'. First ACK
    // promotes us to 'supported' (sticky for the HDMI session — never
    // re-flapped) and hands off to the tv-power poll for button labels.
    // CEC_MISS_LIMIT consecutive misses settle to 'not_supported'.
    TVMediaBoxScene.prototype._startCecProbe = function() {
        if (this._cecProbeTimer) return;
        if (this._cecState !== 'checking') return;
        var self = this;
        var settleMiss = function() {
            if (self._cecState !== 'checking') return;
            self._cecMisses++;
            if (self._cecMisses >= CEC_MISS_LIMIT) {
                self._cecState = 'not_supported';
                self._stopCecProbe();
                self._stopCecAnim();
                if (window.requestRender) window.requestRender();
            }
        };
        var probe = function() {
            if (self._cecState !== 'checking') {
                self._stopCecProbe();
                return;
            }
            fetch('/api/cec/tv-present', { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (self._cecState !== 'checking') return;
                    if (data && data.present) {
                        self._cecState = 'supported';
                        self._stopCecProbe();
                        self._stopCecAnim();
                        self._startCecPoll();
                        self._checkActiveSource();
                        if (window.requestRender) window.requestRender();
                        return;
                    }
                    settleMiss();
                })
                // Network/parse error counts as a miss so an unreachable
                // server doesn't leave us stuck in 'checking' forever.
                .catch(settleMiss);
        };
        probe();
        this._cecProbeTimer = setInterval(probe, CEC_PROBE_PERIOD_MS);
    };
    TVMediaBoxScene.prototype._stopCecProbe = function() {
        if (this._cecProbeTimer) {
            clearInterval(this._cecProbeTimer);
            this._cecProbeTimer = null;
        }
    };

    // Drives the animated "..." dots in the 'checking' state. Just
    // a render-tick — the dot count itself is derived from Date.now()
    // in render(), so the timer only has to wake the main loop.
    TVMediaBoxScene.prototype._startCecAnim = function() {
        if (this._cecAnimTimer) return;
        this._cecAnimTimer = setInterval(function() {
            if (window.requestRender) window.requestRender();
        }, CEC_ANIM_PERIOD_MS);
    };
    TVMediaBoxScene.prototype._stopCecAnim = function() {
        if (this._cecAnimTimer) {
            clearInterval(this._cecAnimTimer);
            this._cecAnimTimer = null;
        }
    };

    // tv-power poll (3 s) — runs only while 'supported'. Keeps the
    // bottom-bar Start TV / TV OFF label fresh against external power
    // changes (TV remote, etc.). Stopped on disconnect / exit.
    TVMediaBoxScene.prototype._startCecPoll = function() {
        if (this._cecTimer) return;
        var self = this;
        this._fetchTvPower();
        this._cecTimer = setInterval(function() { self._fetchTvPower(); }, 3000);
    };
    TVMediaBoxScene.prototype._stopCecPoll = function() {
        if (this._cecTimer) { clearInterval(this._cecTimer); this._cecTimer = null; }
    };

    // GET /api/cec/tv-power. Repaints only when the power value
    // actually changes; support is already known to be sticky here
    // so a null reply isn't a "lost support" signal — just noise.
    TVMediaBoxScene.prototype._fetchTvPower = function() {
        var self = this;
        fetch('/api/cec/tv-power', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var p = (data && data.power) || null;
                var first = !self._tvPowerChecked;
                self._tvPowerChecked = true;
                var prevPower  = self._tvPower;
                var prevMisses = self._tvPowerMisses;
                if (p !== null) {
                    // Any successful reply ends a miss streak — snaps
                    // back to the live label whether we were Checking
                    // (mid-streak) or already committed to Off.
                    self._tvPower       = p;
                    self._tvPowerMisses = 0;
                } else {
                    self._tvPowerMisses++;
                    // Inside the post-command grace window the TV is
                    // mid-boot and silent CEC is expected; pin misses
                    // below the commit threshold so the label stays
                    // at 'Checking' instead of flashing to 'Off' while
                    // the user can see the TV literally turning on.
                    var inGrace = (Date.now() - self._lastTvCmdAt) < POST_CMD_GRACE_MS;
                    if (inGrace && self._tvPowerMisses >= TV_POWER_MISS_LIMIT) {
                        self._tvPowerMisses = TV_POWER_MISS_LIMIT - 1;
                    }
                    if (self._tvPowerMisses >= TV_POWER_MISS_LIMIT) {
                        // Hit the threshold — commit to 'Off'. Future
                        // nulls just keep us here; a non-null reply
                        // recovers via the branch above.
                        self._tvPower = null;
                    }
                    // Else: keep the last known _tvPower so a recovery
                    // can snap straight back without re-asking; the
                    // label uses the miss counter to show 'Checking'.
                }
                var changed = first
                    || prevPower  !== self._tvPower
                    || prevMisses !== self._tvPowerMisses;
                if (changed && window.requestRender) window.requestRender();
            })
            .catch(function() { /* keep last known state */ });
    };

    // One-shot active-source check fired right after CEC is first
    // promoted to 'supported'. If the TV's currently displayed input
    // doesn't match our physical address, pop the source-mismatch
    // modal — user can switch to us or keep their current source.
    // Subsequent calls during the same HDMI session are no-ops
    // (single-prompt UX; HDMI disconnect resets via _resetCecState).
    TVMediaBoxScene.prototype._checkActiveSource = function() {
        var m = this._sourceModal;
        if (m.checked || m.dismissed || m.open) return;
        var self = this;
        fetch('/api/cec/active-source', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                m.checked = true;
                // Bail if CEC was torn down while the request was
                // in flight, or the TV didn't reply, or we ARE the
                // active source (nothing to prompt about).
                if (self._cecState !== 'supported') return;
                if (!data || !data.tvPhysicalAddress) return;
                if (data.isUs) return;
                m.tvSourceName  = physAddrToInputName(data.tvPhysicalAddress);
                m.ourSourceName = physAddrToInputName(data.ourPhysicalAddress);
                m.buttonIndex = 0;
                m.open = true;
                if (window.requestRender) window.requestRender();
            })
            .catch(function() { m.checked = true; });
    };

    // Map CEC power state → on-screen TV label. 'to-on' / 'to-standby'
    // are treated as their target state so the label doesn't flap
    // mid-transition. null *after* a fetch means the TV stopped
    // answering (powered fully off); null *before* the first fetch
    // means we just haven't asked yet — Checking.
    TVMediaBoxScene.prototype._tvStatusLabel = function() {
        // Before the first HDMI poll lands we don't know anything —
        // suppress the label so the sprite stays blank rather than
        // briefly lying. Once HDMI is conclusively disconnected the
        // TV is unreachable through any path → Off.
        if (!this._hdmiLoaded) return null;
        if (!this._hdmiConnected) return 'TV: Off';
        // CEC support probe still running — show 'Checking' so the
        // user sees something is in flight rather than a blank screen
        // on the TV graphic.
        if (this._cecState === 'checking') return 'TV: Checking';
        // CEC settled as "not supported" (PC monitor, TV without CEC,
        // or CEC disabled in the TV's settings). We can't query power
        // state on this screen — but HDMI is up so a picture IS
        // flowing. Best-effort acknowledge with 'ON' so the user
        // knows the connection is alive.
        if (this._cecState === 'not_supported') return 'TV: ON';
        if (!this._tvPowerChecked) return 'TV: Checking';
        // Mid-streak: at least one null since the last good reply,
        // but not yet enough to commit. Show 'Checking' instead of
        // a stale label so the user doesn't see a 1-tick flicker.
        if (this._tvPowerMisses > 0 && this._tvPowerMisses < TV_POWER_MISS_LIMIT) {
            return 'TV: Checking';
        }
        var p = this._tvPower;
        if (p === 'on' || p === 'to-on')           return 'TV: ON';
        if (p === 'standby' || p === 'to-standby') return 'TV: Sleep';
        return 'TV: Off';
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

    // Two stacked buttons. OK fires the selected one; back/esc
    // counts as "keep current source" (same as picking button 1).
    // Either path marks the modal dismissed so we don't reprompt
    // for the remainder of the HDMI session.
    TVMediaBoxScene.prototype._handleSourceModalInput = function(action) {
        var m = this._sourceModal;
        if (action === 'up' || action === 'down') {
            m.buttonIndex = (m.buttonIndex === 0) ? 1 : 0;
            if (window.requestRender) window.requestRender();
            return;
        }
        if (action === 'ok' || action === 'run') {
            m.open      = false;
            m.dismissed = true;
            if (m.buttonIndex === 0) {
                // Reuse the Start TV path — it sends image-view-on
                // and active-source together, so the TV wakes if
                // needed and switches to our input.
                this._sendTv('/api/cec/start-tv');
            }
            if (window.requestRender) window.requestRender();
            return;
        }
        if (action === 'back' || action === 'esc') {
            m.open      = false;
            m.dismissed = true;
            if (window.requestRender) window.requestRender();
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
        this._startPresetStatusPoll();
        if (window.requestRender) window.requestRender();
    };

    TVMediaBoxScene.prototype.exit = function() {
        if (this._hdmiTimer) {
            clearInterval(this._hdmiTimer);
            this._hdmiTimer = null;
        }
        if (this._presetStatusTimer) {
            clearInterval(this._presetStatusTimer);
            this._presetStatusTimer = null;
        }
        this._stopCecProbe();
        this._stopCecAnim();
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

    // Build the settings-row list each call so the displayed value
    // always tracks the latest picker state. Each entry carries the
    // pickerKey that links it back to `_pickers[key]` and the y the
    // MenuDropdownLine and selector should anchor to.
    TVMediaBoxScene.prototype._buildRows = function() {
        return [
            { title: 'Video out', pickerKey: 'videoOut', value: this._pickers.videoOut.current, y: ROW1_Y },
            { title: 'Preset',    pickerKey: 'preset',   value: this._pickers.preset.current,   y: ROW2_Y }
        ];
    };

    // Dropdown owns input while open: up/down cycles its items,
    // OK / run commits the selection, back / esc cancels. Mirrors
    // Internet Radio's dropdown handler.
    TVMediaBoxScene.prototype._handleDropdownInput = function(action) {
        var picker = this._pickers[this._dropdownKey];
        if (!picker) {
            this._dropdownOpen = false;
            this._dropdownKey  = null;
            return;
        }
        if (action === 'back' || action === 'esc') {
            this._dropdownOpen = false;
            this._dropdownKey  = null;
            return;
        }
        var n = picker.options.length;
        if (action === 'down') {
            this._dropdownIndex = (this._dropdownIndex + 1) % n;
            return;
        }
        if (action === 'up') {
            this._dropdownIndex = (this._dropdownIndex - 1 + n) % n;
            return;
        }
        if (action === 'ok' || action === 'run') {
            picker.current = picker.options[this._dropdownIndex];
            this._dropdownOpen = false;
            this._dropdownKey  = null;
            return;
        }
    };

    TVMediaBoxScene.prototype.handleInput = function(action) {
        // Modal gets first refusal — it renders on top of everything.
        if (this._installModal.open) {
            this._handleInstallModalInput(action);
            return;
        }
        if (this._sourceModal.open) {
            this._handleSourceModalInput(action);
            return;
        }
        if (this._dropdownOpen) {
            this._handleDropdownInput(action);
            return;
        }
        // Row navigation across the Video out / Preset stack.
        var rows = this._buildRows();
        if (action === 'up') {
            this._selectedRow = (this._selectedRow - 1 + rows.length) % rows.length;
            return;
        }
        if (action === 'down') {
            this._selectedRow = (this._selectedRow + 1) % rows.length;
            return;
        }
        // Left / right cycle the selected row's picker value inline,
        // without opening the dropdown (mirrors Internet Radio). These
        // pickers have no side-effect on change — the value is read at
        // Start time — so we just advance `current` and repaint.
        if (action === 'left' || action === 'right') {
            var selRow = rows[this._selectedRow];
            if (selRow && selRow.pickerKey && this._pickers[selRow.pickerKey]) {
                var picker = this._pickers[selRow.pickerKey];
                var nOpts  = picker.options.length;
                if (nOpts <= 1) return;
                var i = picker.options.indexOf(picker.current);
                if (i < 0) i = 0;
                i = (action === 'right') ? (i + 1) % nOpts : (i - 1 + nOpts) % nOpts;
                picker.current = picker.options[i];
                if (window.requestRender) window.requestRender();
                return;
            }
        }
        // OK on a settings row opens its dropdown — highlight lands
        // on the currently-selected option so the user can confirm
        // without thinking. Falls back to the first option if the
        // stored value isn't in the list.
        if (action === 'ok') {
            var row = rows[this._selectedRow];
            if (row && row.pickerKey && this._pickers[row.pickerKey]) {
                var p   = this._pickers[row.pickerKey];
                var idx = p.options.indexOf(p.current);
                this._dropdownIndex = idx >= 0 ? idx : 0;
                this._dropdownKey   = row.pickerKey;
                this._dropdownOpen  = true;
                return;
            }
        }
        // Bottom-bar buttons remain on their dedicated keys — Start
        // on 'run' (visible whenever HDMI is connected; routes
        // through _handleStart for unified wake + preset launch),
        // Stop on 'esc' (only while Kodi is running). OK is owned by
        // the dropdown rows.
        if (this._hdmiConnected && !this._kodiRunning && action === 'run') {
            this._pressBtn(this._startBtn);
            return;
        }
        if (this._kodiRunning && action === 'esc') {
            this._pressBtn(this._stopBtn);
            return;
        }
        if (action === 'back' || action === 'esc') return 'pop';
    };

    TVMediaBoxScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        canvas.clear('#fff');

        // Body frame first so the title bar and status bar paint on
        // top of its rounded top corners.
        this._bodyFrame.render(canvas);

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

        // "Running Kodi" status on the title line — HaxrcorpFont16,
        // right-aligned 4 px from the right edge. Shown only while a
        // Kodi process is actually running (pgrep-backed poll).
        if (this._kodiRunning) {
            var statusLabel = 'Running Kodi';
            var statusX = canvas.w - 4 - HaxrcorpFont16.textWidth(statusLabel);
            HaxrcorpFont16.draw(ctx, statusLabel, statusX, UI.STATUS_BAR_H + 3, '#000');
        }

        var TV_FRAME_X = 45;
        var TV_FRAME_Y = 38;
        var TV_FRAME_W = 61;
        var TV_FRAME_H = 43;
        if (typeof Icons !== 'undefined' && Icons.tv_frame) {
            canvas.drawSprite(Icons.tv_frame, TV_FRAME_X, TV_FRAME_Y, '#000');
        }

        // Screen-info badge: black pill with white text. Holds
        // 'No screen detected' until the first HDMI poll lands and
        // reports connected; then swaps to the resolution + Hz
        // string the server hands back from /api/hdmi (e.g.
        // '3840x2160 60Hz'). Three dots while the very first poll
        // is in flight so the badge isn't briefly lying.
        // Pill width is recomputed each frame from the current text
        // width + 3 px padding on each side; the pill stays centered
        // on x=175 so it grows symmetrically as the label changes.
        var infoText;
        if (!this._hdmiLoaded)       infoText = '...';
        else if (this._hdmiConnected) infoText = this._hdmiResolution || 'Connected';
        else                          infoText = 'No screen detected';
        var infoW = HaxrcorpFont16.textWidth(infoText);
        this._screenInfoFrame.setSize(infoW + 10, 9);  // 5 px padding each side
        this._screenInfoFrame.render(canvas);
        var infoX = 175 - Math.floor(infoW / 2);
        // Pill top is y=50; nudge text 2 px up (y=49) so the cap row
        // sits visually closer to the pill's optical center — the 11-
        // row HaxrcorpFont16 frame leaves blank rows below the caps,
        // which would otherwise pull them down.
        var infoY = 49;
        HaxrcorpFont16.draw(ctx, infoText, infoX, infoY, '#fff');

        // TV status text painted on the sprite's screen area.
        // _tvStatusLabel returns null in the "no answer to give" cases
        // (HDMI poll still pending, or HDMI up but CEC not yet
        // resolved); only paint when we actually have a label.
        var tvLabel = this._tvStatusLabel();
        if (tvLabel) {
            var tvLw = HaxrcorpFont16.textWidth(tvLabel);
            var tvLx = TV_FRAME_X + Math.floor((TV_FRAME_W - tvLw) / 2);
            var tvLy = TV_FRAME_Y + Math.floor((TV_FRAME_H - 7) / 2);
            HaxrcorpFont16.draw(ctx, tvLabel, tvLx, tvLy, '#000');
        }

        // CEC status line, positioned directly below the screen-info
        // pill and horizontally centered on the same x=175 axis so
        // the two read as a stacked unit. Only shown while HDMI is
        // connected — nothing to report CEC for otherwise.
        if (this._hdmiConnected) {
            var cecLine;
            if (this._cecState === 'supported') {
                cecLine = 'CEC: supported';
            } else if (this._cecState === 'not_supported') {
                cecLine = 'CEC: not enabled';
            } else {
                // Trail 'checking' with 0..3 dots padded with spaces
                // so HaxrcorpFont16.textWidth stays stable across
                // frames — otherwise the centered line wobbles
                // left/right as the dot count changes.
                var dotCount = Math.floor(Date.now() / CEC_ANIM_PERIOD_MS) % 4;
                var dots     = '...'.slice(0, dotCount) + '   '.slice(dotCount);
                cecLine = 'CEC: checking' + dots;
            }
            var cecW = HaxrcorpFont16.textWidth(cecLine);
            var cecX = 175 - Math.floor(cecW / 2);
            var cecY = 61;  // 2 px gap below the 9 px pill at y=50
            HaxrcorpFont16.draw(ctx, cecLine, cecX, cecY, '#000');
        }

        // ── Settings rows ───────────────────────────────────────
        // Two stacked MenuDropdownLine rows below the CEC line —
        // Video out + Preset. Page-level selector outlines whichever
        // one `_selectedRow` points at, suppressed while a dropdown
        // is open so the inner dropdown selector is the only active
        // focus the user sees.
        var rows = this._buildRows();
        for (var ri = 0; ri < rows.length; ri++) {
            new MenuDropdownLine({
                y:        rows[ri].y,
                title:    rows[ri].title,
                value:    rows[ri].value,
                selected: (ri === this._selectedRow && !this._dropdownOpen)
            }).render(canvas);
        }
        if (!this._dropdownOpen) {
            if (!this._pageSelectorFrame) {
                this._pageSelectorFrame = new MenuSelectorFrame({
                    x: 0, y: 0, width: 1, height: 1,
                    anchorH: 'left', anchorV: 'top',
                    strokeColor: '#000', showStroke: true, showFill: false
                });
            }
            var selRow = rows[this._selectedRow];
            if (selRow) {
                this._pageSelectorFrame.setPosition(SELECTOR_X, selRow.y);
                this._pageSelectorFrame.setSize(SELECTOR_W, SELECTOR_H);
                this._pageSelectorFrame.render(canvas);
            }
        }

        // Status bar last so its indicators sit on top of the chrome.
        UI.drawStatusBar(canvas, '');

        // Bottom-bar buttons render independently:
        //   • Start (right) — when HDMI is connected AND Kodi isn't
        //     already running. Hidden while running so it doesn't
        //     offer to start what's already up.
        //   • Stop (left) — only while Kodi is running.
        if (this._hdmiConnected && !this._kodiRunning) {
            this._startBtn.render(canvas);
        }
        if (this._kodiRunning) {
            this._stopBtn.render(canvas);
        }

        // Dropdown overlay — painted before the dependency / source
        // modals so they always sit above it (a missing dep should
        // block the entire UI). 75 % white wash mutes everything
        // else; flips upward (drop-up) when growing downward would
        // overflow the canvas — the Preset picker at row 2 hits this.
        if (this._dropdownOpen && this._dropdownKey) {
            this._renderDropdown(canvas);
        }

        // Dependency modal renders above everything (incl. status bar).
        if (this._installModal.open) {
            this._renderInstallModal(canvas);
        }
        // Source-mismatch modal — same layer; mutually exclusive with
        // the install modal in practice (install would have stopped
        // us before CEC ever reached 'supported').
        if (this._sourceModal.open) {
            this._renderSourceModal(canvas);
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

    // Settings dropdown overlay. Anchored at the active row's chip;
    // drops downward by default, flips upward when the body would
    // overflow the canvas (e.g. the Preset row near the bottom).
    // Same layered look as Internet Radio: wash + crisp chip fill
    // body + per-item dividers + cached selector outline.
    TVMediaBoxScene.prototype._renderDropdown = function(canvas) {
        var ctx     = canvas.ctx;
        var picker  = this._pickers[this._dropdownKey];
        if (!picker) return;
        var rowsAll = this._buildRows();
        var dropIdx = -1;
        for (var i = 0; i < rowsAll.length; i++) {
            if (rowsAll[i].pickerKey === this._dropdownKey) {
                dropIdx = i; break;
            }
        }
        if (dropIdx < 0) return;

        var rowY  = rowsAll[dropIdx].y;
        var chipX = canvas.w - 5 - MenuDropdownLine.CHIP_WIDTH;
        var chipY = rowY + MenuDropdownLine.TOP_PAD;

        var ITEM_H = 13;
        var DIV_H  = 1;
        var W      = MenuDropdownLine.CHIP_WIDTH;
        var n      = picker.options.length;
        var H      = ITEM_H * n + DIV_H * (n - 1) + 2;

        // Drop up if growing down would overflow. Title stays at
        // chipY either way so the dropdown is visually tethered
        // to its originating row.
        var BOTTOM_MARGIN = 2;
        var dropUp = (chipY + H > canvas.h - BOTTOM_MARGIN);
        var bodyY  = dropUp
            ? (chipY + MenuDropdownLine.CHIP_HEIGHT - H)
            : chipY;

        // Wash everything else out.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        // Re-draw the row's title in crisp black so the user knows
        // which row they're editing (MenuDropdownLine's TITLE_X = 6).
        HaxrcorpFont16.draw(ctx, rowsAll[dropIdx].title, 6, chipY, '#000');

        // Body. Same chip fill, 3 px corners, no stroke — reads as
        // the chip growing into the option list.
        new ResponsiveFrame({
            x: chipX, y: bodyY,
            width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            showStroke: false,
            showFill:   true, fillColor: MenuDropdownLine.CHIP_FILL,
            cornerRadius: 3,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);

        // Items + per-row dividers.
        var selectedItemY = bodyY + 1;
        for (var i2 = 0; i2 < n; i2++) {
            var itemY  = bodyY + 1 + i2 * (ITEM_H + DIV_H);
            var label  = String(picker.options[i2]);
            var labelW = HaxrcorpFont16.textWidth(label);
            HaxrcorpFont16.draw(ctx, label,
                chipX + Math.floor((W - labelW) / 2),
                itemY + 1, '#000');
            if (i2 === this._dropdownIndex) selectedItemY = itemY;
            if (i2 < n - 1) {
                canvas.drawHLine(chipX + 1, itemY + ITEM_H, W - 2, '#999999');
            }
        }

        // Selector outline around the highlighted item. Width is
        // CHIP_W - 1 so MenuSelectorFrame's BR shadow pixels stay
        // inside the dropdown silhouette.
        if (!this._dropdownInnerSelector) {
            this._dropdownInnerSelector = new MenuSelectorFrame({
                x: 0, y: 0, width: 1, height: ITEM_H + 2,
                anchorH: 'left', anchorV: 'top',
                strokeColor: '#000', showStroke: true, showFill: false
            });
        }
        this._dropdownInnerSelector.setPosition(chipX, selectedItemY - 1);
        this._dropdownInnerSelector.setSize(W - 1, ITEM_H + 2);
        this._dropdownInnerSelector.render(canvas);
    };

    // Source-mismatch prompt: 220×86 frame on a 75% white wash.
    // Title in Sporty, two body lines in Haxrcorp naming the TV's
    // current source and ours, and two stacked buttons reused from
    // _drawStackedButton.
    TVMediaBoxScene.prototype._renderSourceModal = function(canvas) {
        var ctx = canvas.ctx;
        var m   = this._sourceModal;

        var W = 220, H = 86;
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

        var titleY = Y + 5;
        var body1Y = Y + 19;
        var body2Y = Y + 31;
        var BTN_H  = 14;
        var BTN_W  = W - 16;
        var BTN_X  = X + Math.floor((W - BTN_W) / 2);
        var btn1Y  = Y + 48;
        var btn2Y  = Y + 64;

        function centerSporty(text, y) {
            var tw = Born2bSportyV2Medium.textWidth(text);
            Born2bSportyV2Medium.draw(ctx, text, X + Math.floor((W - tw) / 2), y, '#000');
        }
        function centerHaxrcorp(text, y, color) {
            var tw = HaxrcorpFont16.textWidth(text);
            HaxrcorpFont16.draw(ctx, text, X + Math.floor((W - tw) / 2), y, color || '#000');
        }

        centerSporty('Switch source?', titleY);
        centerHaxrcorp('Your TV is on ' + m.tvSourceName + ',',  body1Y, '#000');
        centerHaxrcorp('Flipper One is on ' + m.ourSourceName,   body2Y, '#000');
        this._drawStackedButton(canvas, BTN_X, btn1Y, BTN_W, BTN_H, 'Switch to Flipper One', m.buttonIndex === 0);
        this._drawStackedButton(canvas, BTN_X, btn2Y, BTN_W, BTN_H, 'Keep current source',   m.buttonIndex === 1);
    };

    return TVMediaBoxScene;
})();
