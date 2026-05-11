/**
 * InternetRadioScene
 *
 * Skeleton for the Internet radio app. Right now it just paints
 * the standard chrome (status bar + a centred placeholder
 * label) and registers with the App Switcher so the entry shows
 * up there alongside the other apps. UI + station list + audio
 * wiring will land in subsequent passes — this commit just
 * stakes out the menu entry and the scene class.
 */
var InternetRadioScene = (function() {
    // Selector geometry — 252 px wide × 16 px tall outline that
    // wraps whichever MenuDropdownLine row is currently
    // highlighted. Width takes the full canvas minus 2 px on
    // each side; the row's content (chip + label) sits centred
    // inside that 16-tall band.
    var SELECTOR_X = 2;
    var SELECTOR_W = 252;
    var SELECTOR_H = 15;

    // Persistent across scene re-entries. The App Switcher
    // builds a fresh InternetRadioScene every time the user
    // re-opens the app, so without parking these here the
    // station / city / volume / playing markers would reset
    // on every round trip — pick Heart, leave the app, come
    // back, and the picker would say Capital again.
    //
    // Audio device routing already persists server-side via
    // `selectedAlsaDevice` + `selectedOutputId` and the next
    // `_initSettings` call rehydrates the picker from there,
    // so it's not duplicated here.
    // `stationByCity` is the per-city station memory: switching
    // back to a city restores whichever station was last picked
    // there instead of snapping to the city's first entry. Keyed
    // by city name; populated lazily in `_refreshStationList` —
    // entries are seeded the first time each city is visited so
    // the constructor doesn't need to know the full list up
    // front.
    var saved = {
        city:           'London',
        stationByCity:  {},
        volume:         50,
        playingStation: null
    };

    function InternetRadioScene(sceneManager) {
        this.sceneManager  = sceneManager || null;
        // App Switcher reads `displayName` for its title bar and
        // RunningApps uses it as the dedup key when re-launching.
        this.displayName   = 'Internet radio';
        this.breadcrumbTitle = 'Internet radio';
        // Tells main.js's Tab handler this scene is an app —
        // suppresses the transient-snapshot path that would
        // otherwise add a duplicate card to the switcher and
        // trigger the slide-up-from-bottom intro animation.
        this._isApp        = true;
        // Icon shown in the App Switcher's title bar for this
        // app's card. The switcher is now animation-aware —
        // multi-frame strips render via drawSpriteFrame at the
        // same 200 ms cadence MenuLine uses, so the radio glyph
        // animates in the switcher card too. Static fallback
        // only kicks in if the animated strip didn't load.
        this.icon = (typeof AnimatedIcons !== 'undefined'
                        && AnimatedIcons.internet_radio_anim)
                    ? AnimatedIcons.internet_radio_anim
                    : ((typeof Icons !== 'undefined' && Icons.tv_media_box)
                        ? Icons.tv_media_box : null);
        this.imagePath     = null;

        // Currently-highlighted dropdown row. Indexes into
        // `_buildRows()` below. Reset to 0 (first row) on
        // construction; up/down keys move it.
        this.selectedIndex = 0;
        // Volume slider state — integer 0..100. Adjusted in
        // 5-unit steps via left/right when the Volume row is
        // selected. Drives both the displayed `xx%` text and
        // the proportional fill (volume / 100) on the chip.
        this._volume = saved.volume;
        this._volumeStep = 5;

        // Stations per city. The Station picker's options are
        // derived from this map at run time — switching the
        // city refreshes the list (see `_refreshStationList`),
        // and any current station that isn't in the new city's
        // list falls back to the new city's first station.
        // Every URL in `_stationUrls` was probed for an MP3
        // ICY response before being hard-coded; redirects (3xx
        // → 200) are fine because mpg123 follows them
        // transparently.
        //
        // Names are ASCII because the haxrcorp16 bitmap font
        // shipped on the device tops out at codepoint 126 —
        // Cyrillic / German diacritics would render as blank
        // tofu. "Chanson MSK" matches the stream's own
        // icy-name verbatim; "Spreeradio" trims the apostrophe
        // out of "105'5" so it sits cleanly in the dropdown.
        this._stationsByCity = {
            'London':   ['Capital London',     'Heart London'],
            'New York': ['WNYC-FM',            'WQXR Classical'],
            'Tokyo':    ['J-Pop Sakura',       'Japan Hits'],
            'Berlin':   ['Berliner Rundfunk',  'Spreeradio 105.5']
        };

        // Station name → MP3 stream URL. mpg123 reads the URL
        // directly; the server gates the scheme to http(s) so
        // anything else here would get rejected at the API
        // boundary anyway.
        this._stationUrls = {
            'Capital London':    'http://media-ice.musicradio.com/CapitalMP3',
            'Heart London':      'http://media-ice.musicradio.com/HeartLondonMP3',
            'WNYC-FM':           'https://fm939.wnyc.org/wnycfm',
            'WQXR Classical':    'https://stream.wqxr.org/wqxr-web',
            'J-Pop Sakura':      'https://quincy.torontocast.com:2070/stream.mp3',
            'Japan Hits':        'http://quincy.torontocast.com:2020/stream.mp3',
            'Berliner Rundfunk': 'http://stream.berliner-rundfunk.de/brf/mp3-128/internetradio/',
            'Spreeradio 105.5':  'http://stream.spreeradio.de/spree-live/mp3-192/radio-browser.info/'
        };

        // Picker rows. Each entry has an `options` array + a
        // `current` value; the matching row in `_buildRows`
        // pulls its display value from `current` and tags
        // itself with the picker's key so OK can route to the
        // right dropdown. The Station picker starts empty —
        // `_refreshStationList()` below seeds it from the
        // initial city's list so the constructor leaves the
        // state in a consistent shape. The audioDevice picker
        // also starts empty: real devices come back from
        // `/api/sound/devices` once `_initSettings()` runs.
        this._pickers = {
            city: {
                options: ['London', 'New York', 'Tokyo', 'Berlin'],
                current: saved.city
            },
            station: {
                options: [],
                current: ''      // set by _refreshStationList below
            },
            audioDevice: {
                options: ['Updating...'],
                current: 'Updating...'
            }
        };
        // _refreshStationList pulls `saved.stationByCity[city]`
        // for the active city's last pick, falls back to the
        // city's first entry, and writes the resolved value
        // back to `saved.stationByCity` so subsequent
        // constructs land on the same station immediately.
        this._refreshStationList();

        // Full {name, description} records for whatever aplay -l
        // returned. The audioDevice picker shows descriptions
        // (human-readable card names) but the API expects the
        // `hw:N,0` name — this map lets us translate between
        // the two in `_setAudioDevice`.
        this._audioDevices = [];

        // App-defined right button — fires Play/Stop. Same
        // bottom-bar pattern UIDemoScene + KeyboardTestScene
        // use, so the affordance lines up visually with every
        // other app that draws action buttons. Wired to the
        // 'run' action: `handleInput` flashes the button then
        // toggles playback. The label flips between 'Play'
        // and 'Stop' on every render based on `_playingStation`,
        // so the button always shows what the next press does.
        var self = this;
        this._playBtn = new UI.RightButton('Play', 48, 'run',
            function() { self._togglePlayback(); });

        // Tracks the station name currently streaming server-
        // side, or null when nothing is playing. Set after a
        // successful POST /api/radio/play; cleared on stop.
        // Read from `saved` so a re-entry while audio is
        // still playing in the background paints the Stop
        // label on the right button immediately.
        this._playingStation = saved.playingStation;
        // Dropdown overlay state. `_dropdownKey` names which
        // picker is open ('city' / 'station' / 'audioDevice');
        // null = closed. `_dropdownIndex` is the highlighted
        // option within that picker's list.
        this._dropdownOpen   = false;
        this._dropdownKey    = null;
        this._dropdownIndex  = 0;

        // Reusable selector outline — same shape the Wi-Fi page
        // uses for non-chevron rows: 1-px black stroke, no fill.
        this._selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X, y: 0,
            width: SELECTOR_W, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });

        // Install-dependency modal. Centred ResponsiveFrame
        // overlay that pops up only when the background
        // dependency probe in `_checkMpg123` reports a problem
        // — the common case (mpg123 already installed) is
        // silent and the user never sees the modal at all.
        // Modal owns input while open; nothing else gets a turn
        // until the user installs or dismisses.
        //
        // States (only the first one is "rest"; others are
        // hit when the user opts into the install flow):
        //   missing     — mpg123 absent; show Install/Cancel
        //   installing  — POST /api/radio/install in flight
        //   failed      — install failed; show Retry/Cancel
        //
        // Successful installs auto-dismiss the modal — no
        // acknowledgement screen — so 'installed' is not a
        // state we ever transition to.
        this._installModal = {
            open:        false,
            state:       'missing',
            buttonIndex: 0,
            output:      ''
        };
    }

    // Sync the Station picker's options + current value to the
    // currently-selected city. Restores whichever station was
    // last picked in this city (per-city memory in
    // `saved.stationByCity`); falls back to the city's first
    // entry the first time we visit a city, or if the
    // remembered choice isn't in the city's current list. The
    // resolved value is written back so re-entering the city
    // later honours whatever the user left it on.
    InternetRadioScene.prototype._refreshStationList = function() {
        var cityName = this._pickers.city.current;
        var list = this._stationsByCity[cityName] || [];
        this._pickers.station.options = list;
        var remembered = saved.stationByCity[cityName];
        var pick = (remembered && list.indexOf(remembered) >= 0)
            ? remembered
            : (list[0] || '');
        this._pickers.station.current = pick;
        saved.stationByCity[cityName] = pick;
    };

    // Single source of truth for the dropdown rows. Returned
    // fresh on every render so future state-driven changes
    // (selected city / station, fetched lists) flow through
    // automatically. Each entry: { title, value, slider? }.
    // `slider` (0..1) flips the row's chip into a horizontal
    // progress bar with split-colour text — used here for the
    // Volume control.
    InternetRadioScene.prototype._buildRows = function() {
        // Volume row reads the current `_volume` so the chip's
        // fill + text track keypress adjustments in real time.
        // Rows after the first three sit BELOW the divider; the
        // render loop handles the y-offset for any index >=
        // DIVIDER_AFTER.
        var v = this._volume;
        return [
            { title: 'City',         value: this._pickers.city.current,        pickerKey: 'city' },
            { title: 'Station',      value: this._pickers.station.current,     pickerKey: 'station' },
            { title: 'Volume',       value: v + '%', slider: v / 100, isVolume: true },
            { title: 'Audio device', value: this._pickers.audioDevice.current, pickerKey: 'audioDevice' }
        ];
    };

    InternetRadioScene.prototype.enter = function() {
        // Register the launch with the global recents stack so
        // the App Switcher picks it up on the next Tab. The
        // 4th `factoryFn` argument is critical for non-
        // PlaceholderAppScene apps: when the user picks our
        // card from the switcher to re-enter the app, the
        // switcher uses this factory to instantiate a fresh
        // scene. Without it, the switcher falls back to
        // `new PlaceholderAppScene(imagePath, ...)` — and our
        // `imagePath` is null, so the result is a blank canvas.
        if (typeof RunningApps !== 'undefined') {
            // 5th arg is the onClose hook — fired by RunningApps
            // when the user kills the app from the switcher. The
            // scene's `exit()` does NOT run in that path (the
            // scene is already off the navigation stack), so
            // without this hook the server-side mpg123 would
            // keep streaming after the card animates away.
            RunningApps.open(this.displayName, this.imagePath, this.icon,
                function(sm) { return new InternetRadioScene(sm); },
                function() {
                    // Switcher kill stops the stream AND clears
                    // the persistent playing marker, so a fresh
                    // open afterwards doesn't show "Stop" on
                    // the right button while nothing is
                    // actually playing.
                    saved.playingStation = null;
                    var xhr = new XMLHttpRequest();
                    xhr.open('POST', '/api/radio/stop', true);
                    xhr.timeout = 3000;
                    xhr.send();
                });
        }
        // Page-unload safety net: if the user closes the browser
        // tab / refreshes / navigates away, neither exit() nor
        // the switcher onClose fires. sendBeacon queues a POST
        // that survives the page tearing down — best-effort but
        // works in every browser the device's UI runs on.
        if (!this._unloadHandlerAdded) {
            this._unloadHandler = function() {
                if (navigator.sendBeacon) navigator.sendBeacon('/api/radio/stop');
            };
            window.addEventListener('beforeunload', this._unloadHandler);
            this._unloadHandlerAdded = true;
        }

        // Probe the mpg123 dependency. Re-checked on every
        // enter (not just construction) so reopening the app
        // after an out-of-band install picks the new binary up.
        this._checkMpg123();
        // Pull the live volume + audio-device state from the
        // server so the page reflects what amixer / aplay -l
        // actually report — the constructor seeded both with
        // placeholder values that would otherwise be a lie.
        this._initSettings();
    };

    // Hydrate `_volume` and the audioDevice picker from the
    // server. Two parallel XHRs (volume + devices) — neither
    // depends on the other and we don't want the slower one
    // to block UI for the faster.
    InternetRadioScene.prototype._initSettings = function() {
        var self = this;

        // Volume: prefer Speaker since that's the most common
        // output target on this device; fall back to Headphone
        // if amixer can't read Speaker (different codec config /
        // muted control). Keep the placeholder 50 if both are
        // null so the slider stays interactive even when the
        // mixer isn't reachable.
        var volX = new XMLHttpRequest();
        volX.open('GET', '/api/sound/volume', true);
        volX.timeout = 3000;
        volX.onload = function() {
            if (volX.status !== 200) return;
            try {
                var d = JSON.parse(volX.responseText);
                if (typeof d.speaker === 'number')        self._volume = d.speaker;
                else if (typeof d.headphone === 'number') self._volume = d.headphone;
                // Sync `saved` so a re-entry doesn't snap
                // back to the stale value the constructor
                // seeded `_volume` with.
                saved.volume = self._volume;
            } catch (e) {}
        };
        volX.send();

        // Audio outputs: high-level targets from /api/sound/outputs
        // — Speaker, Headphone, HDMI, DisplayPort. Server hides
        // Loopback and splits the NAU8822 card into Speaker +
        // Headphone so the picker doesn't lie about what the
        // user is choosing. Stashes the full records on the
        // scene so the dropdown can show labels while the API
        // call uses the stable id ('speaker' / 'headphone' /
        // 'hdmi' / 'dp').
        var devX = new XMLHttpRequest();
        devX.open('GET', '/api/sound/outputs', true);
        devX.timeout = 5000;
        devX.onload = function() {
            if (devX.status !== 200) return;
            try {
                var d = JSON.parse(devX.responseText);
                var outs = d.outputs || [];
                if (!outs.length) return;
                self._audioDevices = outs;
                var opts = outs.map(function(x) { return x.label; });
                self._pickers.audioDevice.options = opts;
                // Reflect the server's `current` id back as the
                // picker's selected label so the row matches the
                // actual codec routing on first paint.
                var current = opts[0];
                if (d.current) {
                    for (var i = 0; i < outs.length; i++) {
                        if (outs[i].id === d.current) {
                            current = outs[i].label;
                            break;
                        }
                    }
                }
                self._pickers.audioDevice.current = current;
            } catch (e) {}
        };
        devX.send();
    };

    // POST /api/sound/volume for both Speaker and Headphone so
    // the slider behaves like a master volume regardless of
    // which output the user has routed to. Updates `_volume`
    // optimistically — the slider needs to track the keypress
    // even before the server responds — and isn't rolled back
    // on failure (a missed amixer call shouldn't make the UI
    // flicker; the user can just keep adjusting).
    InternetRadioScene.prototype._setVolume = function(pct) {
        pct = Math.max(0, Math.min(100, pct));
        this._volume = pct;
        saved.volume = pct;
        ['Speaker', 'Headphone'].forEach(function(ctrl) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/sound/volume', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 3000;
            xhr.send(JSON.stringify({ control: ctrl, volume: pct }));
        });
    };

    // POST /api/sound/output with the id for the label the user
    // picked from the dropdown. Server-side this both flips
    // selectedAlsaDevice to the matching hw:N,0 AND adjusts the
    // NAU8822 mixer (when speaker/headphone) so the unwanted
    // output is muted. If the lookup fails (shouldn't — labels
    // come from `_audioDevices`) we silently no-op.
    InternetRadioScene.prototype._setAudioDevice = function(label) {
        var outs = this._audioDevices;
        var match = null;
        for (var i = 0; i < outs.length; i++) {
            if (outs[i].label === label) { match = outs[i]; break; }
        }
        if (!match) return;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/sound/output', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 3000;
        xhr.send(JSON.stringify({ id: match.id }));
    };

    // Press of the right-side Play/Stop button toggles
    // streaming. Server's `playRadioStream` already kills any
    // in-flight playback before starting, so a stop-then-play
    // race here can't leave two child processes alive.
    InternetRadioScene.prototype._togglePlayback = function() {
        if (this._playingStation) this._stopRadio();
        else                      this._playRadio(this._pickers.station.current);
    };

    // Apply the side-effects of a picker.current change, no
    // matter which UI path moved the value. Both the dropdown
    // OK and the inline left/right cycling on a picker row
    // funnel through here so the persistence + hot-swap logic
    // can't drift between the two flows.
    InternetRadioScene.prototype._commitPickerChange = function(key) {
        if (key === 'city') {
            saved.city = this._pickers.city.current;
            // Refresh the station picker — `_refreshStationList`
            // restores the city's last-picked station (or the
            // first entry on first visit). Then hot-swap the
            // live stream to that station so a city change
            // moves the audio to whatever's playing in the new
            // city, not just the picker UI.
            this._refreshStationList();
            if (this._playingStation) {
                this._playRadio(this._pickers.station.current);
            }
        } else if (key === 'station') {
            // Per-city memory: writing to `stationByCity[city]`
            // means revisiting this city later restores the
            // exact station the user left it on.
            saved.stationByCity[saved.city] = this._pickers.station.current;
            if (this._playingStation) {
                this._playRadio(this._pickers.station.current);
            }
        } else if (key === 'audioDevice') {
            this._setAudioDevice(this._pickers.audioDevice.current);
            // mpg123 doesn't reroute mid-stream, so a device
            // change while playing has to restart the child.
            if (this._playingStation) {
                this._playRadio(this._playingStation);
            }
        }
    };

    // Fire GET /api/radio/status in the background. The modal
    // stays closed while the request is in flight — the user
    // sees the full app immediately on open and only ever
    // hits the modal if the probe comes back with a problem
    // (binary missing or the probe itself failed). Common
    // case (already installed) is silent.
    InternetRadioScene.prototype._checkMpg123 = function() {
        var self = this;
        var openMissing = function() {
            self._installModal.open        = true;
            self._installModal.state       = 'missing';
            self._installModal.buttonIndex = 0;
            if (window.requestRender) window.requestRender();
        };
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/radio/status', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.mpg123Installed) return;       // silent: nothing to show
                    openMissing();
                    return;
                } catch (e) { /* fall through to error path */ }
            }
            openMissing();
        };
        xhr.onerror   = openMissing;
        xhr.ontimeout = openMissing;
        xhr.send();
    };

    // POST /api/radio/install. apt-get on this device usually
    // finishes in < 10 s for a single small package; the 90 s
    // timeout leaves headroom for a slow mirror without making
    // the user wait forever on a hung request.
    //
    // While the request is in flight we tick `requestRender` at
    // 80 ms intervals so the spinner sprite cycles through its
    // 8 frames smoothly — the page is otherwise input-driven
    // and would freeze on whichever frame was last drawn.
    InternetRadioScene.prototype._runInstall = function() {
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
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/radio/install', true);
        xhr.timeout = 90000;
        xhr.onload = function() {
            stopAnim();
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.success) {
                        // Silent success — close the modal so
                        // the user lands on the live app
                        // immediately. Failures still surface
                        // through the 'failed' branch below.
                        self._installModal.open = false;
                        if (window.requestRender) window.requestRender();
                        return;
                    }
                    self._installModal.output      = data.output || '';
                    self._installModal.state       = 'failed';
                    self._installModal.buttonIndex = 0;
                    if (window.requestRender) window.requestRender();
                    return;
                } catch (e) { /* fall through to error path */ }
            }
            self._installModal.state  = 'failed';
            self._installModal.output = 'HTTP ' + xhr.status;
            self._installModal.buttonIndex = 0;
            if (window.requestRender) window.requestRender();
        };
        xhr.onerror = function() {
            stopAnim();
            self._installModal.state  = 'failed';
            self._installModal.output = 'Network error';
            self._installModal.buttonIndex = 0;
            if (window.requestRender) window.requestRender();
        };
        xhr.ontimeout = function() {
            stopAnim();
            self._installModal.state  = 'failed';
            self._installModal.output = 'Timeout';
            self._installModal.buttonIndex = 0;
            if (window.requestRender) window.requestRender();
        };
        xhr.send();
    };

    InternetRadioScene.prototype.exit = function() {
        // Snapshot what the user last saw so the App Switcher
        // card uses our actual frame instead of a static asset.
        // The `_lastRenderedScene` guard keeps us from grabbing
        // the App Switcher's own frame when we're popping
        // because the user picked another app from there.
        var canvasEl = document.getElementById('screen');
        var ownsCanvas = (window._lastRenderedScene === this);
        if (ownsCanvas && canvasEl && typeof RunningApps !== 'undefined') {
            var snap = document.createElement('canvas');
            snap.width  = canvasEl.width;
            snap.height = canvasEl.height;
            snap.getContext('2d').drawImage(canvasEl, 0, 0);
            RunningApps.setSnapshot(this.displayName, snap);
        }
        // Stream is intentionally LEFT RUNNING when the user
        // backs out of the scene — the radio behaves like a
        // standard "background music" app: tap Back and the
        // music keeps playing while you do something else.
        // The two paths that DO stop playback live elsewhere:
        //   • Switcher-kill — RunningApps.onClose hook.
        //   • Tab close / refresh — beforeunload sendBeacon.
        // The user can also stop manually via the Play/Stop
        // button before exiting if they want silence.
        //
        // Spinner ticker, on the other hand, IS torn down here
        // — leaving an 80 ms requestRender loop alive on an
        // orphaned scene would burn CPU for no visible effect.
        // The install XHR keeps running; its callbacks land on
        // the dead instance and do nothing visible.
        if (this._installAnimTimer) {
            clearInterval(this._installAnimTimer);
            this._installAnimTimer = null;
        }
    };

    // Fire POST /api/radio/play with the station's URL. Optimistic:
    // we mark `_playingStation` immediately so the UI's playing
    // indicator updates on the same frame, and roll it back if
    // the server reports failure. The server kills any in-flight
    // playback before starting a new one, so consecutive picks
    // don't pile up child processes.
    InternetRadioScene.prototype._playRadio = function(stationName) {
        var url = this._stationUrls[stationName];
        if (!url) return;
        var self = this;
        self._playingStation = stationName;
        saved.playingStation = stationName;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/radio/play', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 5000;
        var clear = function() { self._playingStation = null; saved.playingStation = null; };
        xhr.onload = function() { if (xhr.status !== 200) clear(); };
        xhr.onerror   = clear;
        xhr.ontimeout = clear;
        xhr.send(JSON.stringify({ url: url }));
    };

    // Fire POST /api/radio/stop. Clears the local playing
    // marker eagerly so the UI matches the user's intent even
    // if the network round-trip is slow / fails — the server
    // tries to kill the child either way.
    InternetRadioScene.prototype._stopRadio = function() {
        this._playingStation = null;
        saved.playingStation = null;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/radio/stop', true);
        xhr.timeout = 3000;
        xhr.send();
    };

    InternetRadioScene.prototype.handleInput = function(action) {
        // Install modal owns input while open. It's rendered on
        // top of every other element (including the dropdown
        // overlay), so input dispatch has to mirror that — give
        // the modal first refusal before we even look at the
        // page state.
        if (this._installModal.open) {
            return this._handleInstallModalInput(action);
        }
        // Dropdown owns input while open: up/down cycles its
        // items, OK commits the selection (and closes), back/
        // esc cancels. Same flow regardless of which picker is
        // open — the active picker's options + current value
        // are pulled from `_pickers[_dropdownKey]`.
        if (this._dropdownOpen) {
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
            if (action === 'down') {
                this._dropdownIndex =
                    (this._dropdownIndex + 1) % picker.options.length;
                return;
            }
            if (action === 'up') {
                this._dropdownIndex =
                    (this._dropdownIndex - 1 + picker.options.length)
                        % picker.options.length;
                return;
            }
            if (action === 'ok' || action === 'run') {
                picker.current = picker.options[this._dropdownIndex];
                this._commitPickerChange(this._dropdownKey);
                this._dropdownOpen = false;
                this._dropdownKey  = null;
                return;
            }
            return;
        }

        if (action === 'back' || action === 'esc') return 'pop';

        // Right-side Play/Stop button — fires on the device's
        // primary-action key ('run'), the same one the bottom-
        // bar pattern wires elsewhere (Done in KeyboardTestScene,
        // etc.). Only checked here, after the dropdown handler's
        // early return — inside an open dropdown 'run' continues
        // to commit the highlighted option, which matches every
        // other scene in the app.
        if (action === 'run' && this._playBtn) {
            var btn = this._playBtn;
            btn.press();
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                btn.release();
                if (window.requestRender) window.requestRender();
            }, 30);
            this._togglePlayback();
            return;
        }

        var rows = this._buildRows();
        var n = rows.length;
        if (n === 0) return;
        if (action === 'down') {
            this.selectedIndex = (this.selectedIndex + 1) % n;
            return;
        }
        if (action === 'up') {
            this.selectedIndex = (this.selectedIndex - 1 + n) % n;
            return;
        }
        // Left / right has two jobs depending on the row:
        //   • Volume row → bump the slider ±5 % and fire the
        //     amixer write (see `_setVolume`).
        //   • Picker rows (City / Station / Audio device) →
        //     cycle through the picker's options without
        //     opening the dropdown. Skips when there's only
        //     one option (or no real change after wrapping)
        //     so we don't spuriously fire `_commitPickerChange`
        //     on stations/devices that are still loading.
        if (action === 'left' || action === 'right') {
            var sel = rows[this.selectedIndex];
            if (sel && sel.isVolume) {
                var delta = (action === 'right') ? this._volumeStep : -this._volumeStep;
                this._setVolume(this._volume + delta);
                return;
            }
            if (sel && sel.pickerKey && this._pickers[sel.pickerKey]) {
                var p = this._pickers[sel.pickerKey];
                var n = p.options.length;
                if (n <= 1) return;
                var idx = p.options.indexOf(p.current);
                if (idx < 0) idx = 0;
                idx = (action === 'right')
                    ? (idx + 1) % n
                    : (idx - 1 + n) % n;
                var next = p.options[idx];
                if (next === p.current) return;
                p.current = next;
                this._commitPickerChange(sel.pickerKey);
                return;
            }
        }
        // OK on any row tagged with `pickerKey` opens that
        // picker's dropdown. Highlight starts on the currently-
        // selected option so the user can confirm without
        // thinking; falls back to the first item if the stored
        // value is no longer in the list. Note: only `'ok'` —
        // `'run'` is owned by the right button and intercepted
        // earlier; reaching this code with action === 'run' is
        // impossible.
        if (action === 'ok') {
            var selRow = rows[this.selectedIndex];
            if (selRow && selRow.pickerKey
                    && this._pickers[selRow.pickerKey]) {
                var picker2 = this._pickers[selRow.pickerKey];
                var idx     = picker2.options.indexOf(picker2.current);
                this._dropdownIndex = idx >= 0 ? idx : 0;
                this._dropdownKey   = selRow.pickerKey;
                this._dropdownOpen  = true;
                return;
            }
        }
    };

    InternetRadioScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        // Standard status bar across the top — battery / wifi /
        // etc. stay visible on this scene.
        UI.drawStatusBar(canvas, '');

        // ── Title header ─────────────────────────────────────
        // Full-width, 16 px tall, #D9D9D9 fill, anchored
        // immediately below the status bar (no gap). Carries
        // the app's name in Born2bSportyV2Medium — bigger /
        // chunkier than the standard HaxrcorpFont16 the rest
        // of the system uses, gives the app screen its own
        // "title bar" look.
        var ctx     = canvas.ctx;
        var TITLE_H = 16;
        var TITLE_Y = UI.STATUS_BAR_H;             // flush against the status bar
        ctx.fillStyle = '#D9D9D9';
        ctx.fillRect(0, TITLE_Y, canvas.w, TITLE_H);

        // Static radio glyph — frame 0 of the animated strip,
        // anchored 2 px from the title bar's left edge and 1 px
        // from its top (was 2 px; the extra row lands the cap
        // closer to the title text's baseline). 14 px wide
        // sprite ends at column 15; title text starts at x = 18,
        // leaving a 2 px gap between icon and label.
        if (typeof AnimatedIcons !== 'undefined'
                && AnimatedIcons.internet_radio_anim) {
            canvas.drawSpriteFrame(
                AnimatedIcons.internet_radio_anim,
                2, TITLE_Y + 1, 0, '#000');
        }

        // Title text — 18 px in from the left, 1 px below the
        // status bar's bottom edge. Born2bSporty's glyph cell
        // is 18 rows with the visible cap starting around
        // row 2, so a draw-y of (status bar bottom + 1) lands
        // the cap visually 1 px tighter against the status bar
        // boundary than the previous +2 baseline.
        var TITLE_X = 18;
        var TITLE_TEXT_Y = UI.STATUS_BAR_H + 1;
        Born2bSportyV2Medium.draw(ctx, 'Internet radio',
            TITLE_X, TITLE_TEXT_Y, '#000');

        // ── Body: stacked MenuDropdownLine rows ───────────────
        // The first DIVIDER_AFTER rows sit ABOVE the divider,
        // stacking flush below the title bar at HEIGHT + ROW_GAP
        // pitch. Anything after DIVIDER_AFTER drops below the
        // divider line, with its own anchor at
        // dividerY + 1 + DIVIDER_PAD_AFTER (3 px breathing
        // gap), and stacks at the same pitch from there.
        var ROW_GAP             = 3;
        var bodyTop             = TITLE_Y + TITLE_H;
        var rowPitch            = MenuDropdownLine.HEIGHT + ROW_GAP;
        var DIVIDER_PAD_X       = 5;
        var DIVIDER_OFFSET_Y    = 49;     // 47 → 49: 2 px lower so it
                                          // clears the Volume chip's
                                          // bottom edge cleanly.
        var DIVIDER_AFTER       = 3;             // rows 0..2 above, 3+ below
        var DIVIDER_PAD_AFTER   = 3;             // gap below divider before next row
        var dividerY            = bodyTop + DIVIDER_OFFSET_Y;
        var belowDividerAnchor  = dividerY + 1 + DIVIDER_PAD_AFTER;
        function rowYAt(i) {
            if (i < DIVIDER_AFTER) return bodyTop + i * rowPitch;
            return belowDividerAnchor + (i - DIVIDER_AFTER) * rowPitch;
        }

        var rows      = this._buildRows();
        var selectedY = bodyTop;
        for (var i = 0; i < rows.length; i++) {
            var rowY = rowYAt(i);
            new MenuDropdownLine({
                y:        rowY,
                title:    rows[i].title,
                value:    rows[i].value,
                slider:   (typeof rows[i].slider === 'number') ? rows[i].slider : null,
                selected: (i === this.selectedIndex)
            }).render(canvas);
            if (i === this.selectedIndex) selectedY = rowY;
        }

        // ── Divider rule ──────────────────────────────────────
        // Horizontal hairline 47 px below the title bar's bottom
        // edge, inset 5 px from each canvas edge. Sits between
        // the settings stack above and the Audio device row
        // (and whatever else lands) below.
        canvas.drawHLine(
            DIVIDER_PAD_X,
            dividerY,
            canvas.w - DIVIDER_PAD_X * 2,
            '#CCCCCC');

        // Selector outline — 16 px tall, dropped 1 px below the
        // row's top y so it visually centres on the chip /
        // label baseline rather than riding flush with the
        // anchor. Suppressed while the dropdown is open — the
        // dropdown is the user's only focus then; doubling up
        // with the page-level outline reads as "two things
        // selected at once".
        if (!this._dropdownOpen) {
            this._selectorFrame.setPosition(SELECTOR_X, selectedY + 1);
            this._selectorFrame.setSize(SELECTOR_W, SELECTOR_H);
            this._selectorFrame.render(canvas);
        }

        // App-defined right button. Label tracks live playback
        // state every frame so the user always sees the next
        // action ("Play" when stopped, "Stop" when streaming).
        // Drawn before the dropdown / install-modal overlays so
        // their semi-transparent wash mutes the button along
        // with the rest of the page chrome — keeps the visual
        // hierarchy consistent.
        this._playBtn.text = this._playingStation ? 'Stop' : 'Play';
        this._playBtn.render(canvas);

        // ── Dropdown overlay ──────────────────────────────────
        // Drawn LAST (and only when open) so it sits on top of
        // the page chrome. Other elements fade out via a
        // semi-transparent white wash; the dropdown itself
        // paints crisp on top so the user's eye locks onto it.
        if (this._dropdownOpen && this._dropdownKey) {
            // Find the row owning the active picker so we can
            // anchor the dropdown's top edge to that row's chip.
            var rowsAll  = this._buildRows();
            var dropIdx  = -1;
            for (var ri = 0; ri < rowsAll.length; ri++) {
                if (rowsAll[ri].pickerKey === this._dropdownKey) {
                    dropIdx = ri; break;
                }
            }
            if (dropIdx >= 0) {
                var rowAnchor = rowYAt(dropIdx);
                var chipX     = canvas.w
                              - MenuDropdownLine.CHIP_WIDTH
                              - 5;                          // matches CHIP_RIGHT_PAD
                var chipY     = rowAnchor + MenuDropdownLine.TOP_PAD;
                this._renderDropdown(canvas, chipX, chipY,
                    rowsAll[dropIdx].title);
            }
        }

        // Install-dependency modal sits on top of everything
        // — including the dropdown — so users can never end up
        // looking at the app while the binary it depends on is
        // missing. Render last; input dispatch already gives
        // it first refusal in `handleInput`.
        if (this._installModal.open) {
            this._renderInstallModal(canvas);
        }
    };

    // ── Dropdown picker ──────────────────────────────────────
    // Rectangle anchored at the Audio device chip's top-left.
    // Width matches the chip; height = 13 × N + (N − 1) + 2
    // (per-line content + dividers between items + 1 px stroke
    // top + bottom). For N = 3 that's exactly 43 px, matching
    // the spec.
    //
    // Visual layering:
    //   1. Semi-transparent white wash covers the whole canvas
    //      so non-dropdown elements fade out — the user's
    //      attention should land on the picker only.
    //   2. Gray-fill ResponsiveFrame as the dropdown body.
    //   3. Item labels stacked vertically, separated by 1-px
    //      light-gray dividers.
    //   4. MenuSelectorFrame outline (one item wide) wrapping
    //      the highlighted row inside the dropdown.
    InternetRadioScene.prototype._renderDropdown = function(canvas, chipX, chipY, rowTitle) {
        var ctx     = canvas.ctx;
        var picker  = this._pickers[this._dropdownKey];
        if (!picker) return;
        var options = picker.options;
        var ITEM_H  = 13;
        var DIV_H   = 1;
        var W       = MenuDropdownLine.CHIP_WIDTH;     // 180
        var n       = options.length;
        var H       = ITEM_H * n + DIV_H * (n - 1) + 2; // +2 for top + bottom strokes

        // Wash everything else out — same alpha the verbose
        // wifi modals use, gives a clear "this is modal" cue.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        // Re-draw the active row's title in solid black on top
        // of the wash so it stays crisp instead of fading out
        // with the rest of the page. Visually anchors the user
        // — "you're picking the value for THIS row". Title
        // string is passed in by the caller so the dropdown
        // renderer doesn't need to know which picker is active.
        // Coords mirror MenuDropdownLine's title position
        // (TITLE_X = 6, draw-y = chipY since chipY already
        // equals row.y + TOP_PAD).
        if (rowTitle) {
            HaxrcorpFont16.draw(ctx, rowTitle, 6, chipY, '#000');
        }

        // Body. Same fill colour as the original chip so the
        // dropdown reads as "the chip grew downward to reveal
        // its options"; same 3 px corner radius. No stroke —
        // the chip background didn't have one either, and the
        // strokeless silhouette keeps the dropdown reading as
        // a continuation of the chip rather than a new boxed
        // modal.
        var body = new ResponsiveFrame({
            x: chipX, y: chipY,
            width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            showStroke: false,
            showFill:   true, fillColor: MenuDropdownLine.CHIP_FILL,
            cornerRadius: 3,
            corners: { tl: true, tr: true, bl: true, br: true }
        });
        body.render(canvas);

        // Items + per-row dividers. Items render as black
        // HaxrcorpFont16 centred horizontally; each item's
        // block is ITEM_H tall, with a 1-px divider after it
        // (except the last). Top stroke = row 0; first item
        // sits at row 1.
        var selectedItemY = chipY + 1;   // default: first item
        for (var i = 0; i < n; i++) {
            var itemY = chipY + 1 + i * (ITEM_H + DIV_H);
            // Centred label.
            var label = String(options[i]);
            var labelW = HaxrcorpFont16.textWidth(label);
            // 13-tall row with 11-tall font: cap top sits 1 px
            // from the row top.
            HaxrcorpFont16.draw(ctx, label,
                chipX + Math.floor((W - labelW) / 2),
                itemY + 1, '#000');
            if (i === this._dropdownIndex) selectedItemY = itemY;
            // Divider between items (not after the last).
            if (i < n - 1) {
                canvas.drawHLine(chipX + 1, itemY + ITEM_H,
                    W - 2, '#999999');
            }
        }

        // Selector outline around the highlighted item — same
        // shape as the page-level selector but shrunk to the
        // dropdown's width.
        if (!this._dropdownInnerSelector) {
            this._dropdownInnerSelector = new MenuSelectorFrame({
                x: 0, y: 0, width: 1, height: ITEM_H + 2,
                anchorH: 'left', anchorV: 'top',
                strokeColor: '#000', showStroke: true, showFill: false
            });
        }
        // Selector inset by 1 px on the right so the BR shadow
        // pixels MenuSelectorFrame paints don't run past the
        // dropdown's body — keeps the highlight tucked inside
        // the dropdown silhouette instead of poking out.
        this._dropdownInnerSelector.setPosition(chipX, selectedItemY - 1);
        this._dropdownInnerSelector.setSize(W - 1, ITEM_H + 2);
        this._dropdownInnerSelector.render(canvas);
    };

    // Input handler for the install-dependency modal. While the
    // modal is open every key lands here first; the page-level
    // handler is bypassed entirely (see `handleInput`).
    //
    // Direct flows:
    //   missing   →  Install / Cancel
    //   failed    →  Retry / Cancel  (same buttons, same handler
    //                — `_runInstall` is the action for index 0
    //                in both cases)
    //
    // Transient flow: 'installing' swallows input — the modal
    // is mid-network-request and there's nothing useful for the
    // user to do. The button index is still valid when control
    // returns to a button-bearing state.
    //
    // Successful installs auto-dismiss the modal in the XHR
    // onload handler, so there's no 'installed' state to
    // handle here — failures fall through to the 'missing'/
    // 'failed' two-button flow below.
    InternetRadioScene.prototype._handleInstallModalInput = function(action) {
        var m = this._installModal;
        if (m.state === 'installing') return;

        // 'missing' and 'failed' share the same two-button UX
        // (Install/Retry stacked on top of Cancel). Index 0
        // runs `_runInstall`, index 1 dismisses the modal.
        // Stacked layout → vertical navigation: up/down moves
        // the selector frame between the two buttons.
        if (action === 'up' || action === 'down') {
            m.buttonIndex = (m.buttonIndex === 0) ? 1 : 0;
            return;
        }
        if (action === 'ok' || action === 'run') {
            if (m.buttonIndex === 0) this._runInstall();
            else                     m.open = false;
            return;
        }
        if (action === 'back' || action === 'esc') {
            m.open = false;
            return;
        }
    };

    // Modal geometry — centred 150×70 frame on the 256×144
    // canvas. Vertical layout fixed at construction so each
    // state ('missing' / 'installing' / 'failed') anchors
    // against the same coordinates and the modal doesn't
    // visually jitter between transitions.
    //
    // Stack:
    //   • Title    (Born2bSportyV2Medium, chunky)  — y +  6
    //   • Body     (HaxrcorpFont16, single line)   — y + 23
    //   • Button 1 (Install / Retry, 14 tall)      — y + 36
    //   • Button 2 (Cancel,          14 tall)      — y + 52
    //
    // Buttons are stacked vertically; up/down moves the
    // selector frame between them and OK fires the active
    // button's action.
    InternetRadioScene.prototype._renderInstallModal = function(canvas) {
        var ctx = canvas.ctx;
        var m   = this._installModal;

        var W = 150, H = 70;
        var X = Math.floor((canvas.w - W) / 2);
        var Y = Math.floor((canvas.h - H) / 2);

        // Wash everything else out — same alpha the dropdown
        // overlay uses, so the page reads as muted while the
        // modal is the only thing in focus.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        // Frame body — white fill, 1-px black stroke, 4-px
        // corners.
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
            Born2bSportyV2Medium.draw(ctx, text,
                X + Math.floor((W - tw) / 2), y, '#000');
        }
        function centerHaxrcorp(text, y, color) {
            var tw = HaxrcorpFont16.textWidth(text);
            HaxrcorpFont16.draw(ctx, text,
                X + Math.floor((W - tw) / 2), y, color || '#000');
        }

        if (m.state === 'installing') {
            centerSporty('Installing', titleY);
            // 22×20 spinner sprite, 8 frames stacked vertically.
            // Frame ticks every 80 ms (driven by the timer in
            // `_runInstall`), so the icon spins smoothly through
            // the request lifetime regardless of how long apt-get
            // takes. Centred horizontally below the title with
            // enough breathing room above the modal's bottom
            // edge for visual balance.
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
            centerSporty('Install mpg123?', titleY);
            centerHaxrcorp('MP3 decoder for radio streaming', bodyY, '#666');
            this._drawStackedButton(canvas, BTN_X, btn1Y, BTN_W, BTN_H, 'Install', m.buttonIndex === 0);
            this._drawStackedButton(canvas, BTN_X, btn2Y, BTN_W, BTN_H, 'Cancel',  m.buttonIndex === 1);
            return;
        }

        // 'failed' — keep the same two-button layout but with
        // the primary action relabelled "Retry". Last non-
        // empty line of apt's output goes in the body slot to
        // give the user a clue ("Unable to fetch", "E: Could
        // not get lock", …); long messages get truncated.
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

    // One stacked button row. The label sits centred inside the
    // bounds; when the row is `selected` we paint a 1-px black
    // rounded outline around the same bounds via MenuSelectorFrame
    // — same component used for the dropdown highlight, so the
    // visual idiom carries over from the page chrome to the modal.
    InternetRadioScene.prototype._drawStackedButton = function(canvas, x, y, w, h, label, selected) {
        var ctx = canvas.ctx;
        var lw  = HaxrcorpFont16.textWidth(label);
        // HaxrcorpFont16's cap top sits 1 px below its anchor y;
        // centring the 11-px tall glyph cell inside an h-tall
        // button means y + (h - 11) / 2.
        var labelY = y + Math.floor((h - 11) / 2);
        HaxrcorpFont16.draw(ctx, label,
            x + Math.floor((w - lw) / 2), labelY, '#000');
        if (selected) {
            // Lazy single-shared selector — re-positioned per
            // call so we don't allocate a new MenuSelectorFrame
            // every render frame.
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

    return InternetRadioScene;
})();
