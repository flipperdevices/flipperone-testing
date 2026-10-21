/**
 * FlipSdrDemoScene
 *
 * Testing → Kickstarter demo → 'FlipSDR'. Fake SDR receiver for the
 * campaign footage, after the SDR# look (spectrum on top, waterfall
 * below), in grayscale:
 *
 *   • Status bar + the standard gray title strip (Icons.sdr_icon, name, a
 *     map-style scale bar "20 kHz |___|" centred on the screen, the band
 *     preset "Airband" on the right; mode and step come with the preset).
 *   • Spectrum (y 29..78): noise floor as a black line with a light
 *     gray fill under it; the demodulation band as two gray edge lines
 *     around the VFO; the squelch threshold as a dashed line a little
 *     above the noise floor; the VFO itself as a black line ending in a
 *     small pointer on the frequency pill; bookmarks as pills of the
 *     same shape at the top, each with a pointer down onto its
 *     frequency (overlapping ones give way to the one nearer the VFO).
 *   • Pills have two looks: selected = black with white text and the
 *     < > arrows (the one left / right acts on), unselected = COL_PILL_OFF
 *     gray (darker than the frequency strip) with white text. An arrow is
 *     left out where there is nothing further that way: the first / last
 *     bookmark, the air band's edges.
 *   • Frequency strip (y 79..87): labels at a round interval that keeps
 *     them ~50 px apart, black pill with the VFO frequency in the middle.
 *   • Waterfall (y 88..143): one new row every 1/WF_ROWS_PER_SEC s,
 *     newest on top. Intensity = darkness: white is the noise floor,
 *     sparse light speckles are noise ("grain"), black is a strong
 *     carrier.
 *   • Bottom: the waterfall runs on under the buttons and a white fade
 *     (opacity 0 at y=FADE_Y → 1 at the bottom edge) hides the rows
 *     as they scroll away. The left button "Bookmark" (X) is a toggle
 *     with a constant label, its bar showing the state (Caps Lock
 *     style): bar off (default) — left / right step 8.33 kHz, the
 *     frequency pill is selected; bar on — left / right jump to the
 *     previous / next bookmark, the bookmark under the
 *     VFO is selected and the frequency pill is not. Entering Bookmark
 *     mode jumps to the nearest bookmark. While PTT is held it is always
 *     Frequency behaviour: the frequency pill is selected and the
 *     touchpad / d-pad tune by frequency (with the bookmark snap), in
 *     either mode.
 *   • Edit (V) opens a modal with a gray header band, for whatever is
 *     selected. Frequency selected: the header shows the frequency and
 *     the rows are "Add to bookmarks" and "Decoder: …" (adding is refused
 *     if the channel already has a bookmark). Bookmark selected: the
 *     header shows its name and the rows are Rename / Delete / "Decoder: …". Add and
 *     Rename open the standard keyboard (TextInputScreen); Decoder opens
 *     a picker headed by a breadcrumb ("APP > Decoder", "133.400 >
 *     Decoder") with Off / ACARS. Decoder is listed only on the ACARS
 *     channel; voice frequencies get just the bookmark actions. The
 *     title strip keeps showing just "Airband"; a running decoder shows
 *     itself in its own window. Scan is drawn only.
 *
 * An ACARS-like data station on ACARS_KHZ (131.550, no bookmark) sends
 * short bursts that show as solid blocks on the waterfall. Tuning onto
 * it while a burst is on the air (decoder off) raises the dolphin with a
 * speech bubble: "Looks like ACARS / Try to enable decoder for this
 * frequency" and Enable ACARS / Dismiss. With the ACARS decoder on and
 * the VFO on that channel, a decode window opens (black tab centred on
 * the VFO with < > and just the frequency or bookmark name, the pill
 * grown into a window; a gray "ACARS decoder" band on top that the
 * text scrolls under) and every burst adds a decoded message in the usual
 * ACARS log format (fictional traffic); up / down or a vertical swipe
 * (no PTT) scroll it smoothly, scrollbar on the right; Back hides it
 * until the VFO leaves the channel.
 *
 * ATIS on 133.350 is a continuous voice loop (a solid trail on the
 * waterfall; the Link LED stays lit while tuned to it).
 *
 * One station on SIGNAL_KHZ (133.400 MHz, air band AM) transmits in
 * short bursts like the Walkie Talkie demo, but on a single band:
 * TX_MIN_MS..TX_MAX_MS of voice (with a short carrier-only lead-in and
 * tail, the thin dashes seen in a real waterfall), then a short pause
 * of PAUSE_MIN_MS..PAUSE_MAX_MS.
 *
 * OK on the selected frequency opens digit entry: a bigger pill with the
 * 10 kHz digit already chosen (filled triangles above / below it), left /
 * right pick another, up / down step it with carry and the band follows
 * live; a step past the band edge buzzes and its triangle is hidden.
 * Select (Scan's slot, the only live button meanwhile), OK or Back leave
 * entry keeping the frequency.
 *
 * Left / right retune the VFO in 8.33 kHz steps. The VFO stays in the
 * centre and the band scrolls under it (the waterfall history shifts
 * with it), so the station walks out of the demodulation band.
 * Up / down zoom the displayed span through SPANS_KHZ: 2.4 MHz is the
 * most an RTL2832U dongle (NESDR Nano 3) delivers at once, the narrow
 * end is just a finer FFT view.
 *
 * Touchpad works only while PTT is held (like the Browser's zoom).
 * Pressing PTT gives a strong haptic (PTT_HAPTIC_EFFECT) and the VFO
 * pill grows smoothly from 49×9 to PILL_BIG_W×PILL_BIG_H (57×19), showing ^ / v
 * arrows next to < > for the swipe directions; releasing PTT shrinks
 * it back. With PTT held (with haptics, Browser vocabulary): a vertical
 * swipe zooms one level per TP_ZOOM_UNITS (up = in), a horizontal drag
 * moves the band with the finger, snapped to 8.33 kHz steps and pulled
 * onto a bookmark within SNAP_PX of the finger's target. The axis is
 * locked by the first TP_AXIS_LOCK units of travel. Short effect-3 tick
 * per step / zoom level, effect 3 for 50 ms when landing on a bookmark
 * (the App Switcher's snap), full effect-3 thump at a limit.
 *
 * Link LED (as in the Walkie Talkie demo): solid red while the
 * squelch is open, i.e. the station is on the air AND inside the
 * demodulation band; off otherwise. LEDs are taken into manual mode on
 * enter and handed back on exit.
 *
 * Columns sit on a fixed grid in absolute frequency (column k covers
 * k × colKhz), shared by the spectrum, every waterfall row, labels and
 * flags. Retuning therefore shifts the waterfall history by a whole
 * number of columns and new rows line up with old ones exactly, so a
 * signal's trail stays straight instead of stair-stepping.
 *
 * The signal model is in kHz, so the
 * carrier, voice sidebands and filter scale with the zoom; the waterfall
 * history (stored per row) is redrawn at the new scale. No sound, the
 * backlight is not touched. Back returns to the list.
 */
var FlipSdrDemoScene = (function() {
    // Power meter LEDs while open (PowerMeterLeds): battery outline and a
    // level-3 usage bar; off when the demo is left.
    var METER = { battery: 'OUTLINE', usage: 3 };

    // ── Layout (from the mockup, 1 screen px = 4 mockup px) ─────────
    var TITLE_H    = 16;
    var SPEC_TOP   = 29;            // first spectrum row
    // Screen split roughly in half: spectrum above the frequency strip,
    // waterfall below it.
    var SPEC_BOT   = 78;            // last spectrum row (pill top overlaps it)
    var SCALE_Y    = 79;            // frequency strip, 9 rows
    var SCALE_H    = 9;
    var WF_Y       = 88;            // waterfall, down to the bottom edge
    var WF_H       = 144 - WF_Y;
    var FADE_Y     = 123;           // white fade over the waterfall starts here
    var CX         = 128;           // VFO column
    var PILL_W     = 49;
    var PILL_X     = CX - (PILL_W - 1) / 2;   // 104: centred on the VFO column
    var PILL_Y     = SCALE_Y;       // fills the frequency strip rows 79..87
    var PILL_H     = 9;

    var COL_STRIP  = '#D9D9D9';     // standard title strip
    var COL_SCALE  = '#C0C0C0';
    var COL_EDGE   = '#C0C0C0';     // demodulation band edges
    var COL_FILL   = '#E0E0E0';     // under the spectrum line
    var COL_PILL_OFF = '#808080';   // unselected pill, darker than COL_SCALE
    // Decoder choice on the ACARS channel (the only data signal in the demo).
    var DECODERS = ['Off', 'ACARS'];

    // ATIS on its bookmark: a continuous voice loop (carrier always on,
    // short gaps between phrases), as real ATIS broadcasts do.
    var ATIS_KHZ = 133350;

    // ACARS-like data station (demo): short AM-MSK bursts on 131.550.
    // No bookmark on purpose; the dolphin points it out instead.
    var ACARS_KHZ        = 131550;
    var ACARS_MIN_MS     = 300;     // burst length
    var ACARS_MAX_MS     = 700;
    var ACARS_GAP_MIN_MS = 1500;    // gap between bursts
    var ACARS_GAP_MAX_MS = 4000;
    var ACARS_HALF_KHZ   = 2.6;     // MSK sidebands, ± around the carrier
    var ACARS_CARRIER_DB = 30;
    var ACARS_DATA_DB    = 13;      // flat, low-variance data block

    // Dolphin hint ("Looks like ACARS"), same layers and talk timing as
    // the Wi-Fi scanner's warning; speech bubble drawn in code.
    var DOLPHIN_OPEN  = 'assets/kickstarter_UI/FlipSDR/warning_doplhin_open.png';
    var DOLPHIN_CLOSE = 'assets/kickstarter_UI/FlipSDR/warning_doplhin_close.png';
    var TALK_OPEN_MS   = [70, 180];
    var TALK_CLOSED_MS = [60, 260];
    var DOLPHIN_WASH  = 'rgba(255, 255, 255, 0.5)';
    var BUBBLE_X = 119, BUBBLE_W = 124, BUBBLE_Y = 13;   // Wi-Fi overlay geometry
    var BUBBLE_PAD = 6;
    var TAIL_Y = 56;                // tail rows 56..64, fixed at the mouth
    var TAIL_H = 9;
    var DOLPHIN_ITEMS = ['Enable ACARS', 'Dismiss'];

    // ACARS decode window (Wi-Fi scanner v2 popup look: black name tab,
    // white rounded frame). One decoded message per burst, newest last.
    var LOG_X = 4, LOG_W = 248, LOG_Y = 26, LOG_H = 96;
    var LOG_TAB_H = 24, LOG_TAB_OVERLAP = 6, LOG_TAB_PAD = 6, LOG_R = 4;
    var LOG_PAD = 6, LOG_LINE = 10, LOG_GAP = 4;
    var LOG_MAX = 40;
    // Demo traffic (fictional registrations / flights), in the format of
    // a typical ACARS decoder log.
    var ACARS_REGS    = ['.N104FL', '.G-FLPR', '.D-AFLO', '.F-HFLP'];
    var ACARS_FLIGHTS = ['FL0101', 'FL0233', 'FL0417', 'FL0802'];
    var ACARS_BODIES  = [
        function(f) { return 'F20A ' + f + ' #M1BPRG/FN' + f.slice(2) + '/DTEDDB,,25,091422L2M'; },
        function(f) { return 'H1 ' + f + ' #DFB/POS N5230.4E01324.9,FL350'; },
        function(f) { return '5Z ' + f + ' /ETA EDDB 1742 GATE B12'; },
        function(f) { return '80 ' + f + ' OUT 1612 OFF 1621 ON 1745'; },
        function(f) { return 'Q0 ' + f + ' LINK TEST'; }
    ];

    // ── Radio model ─────────────────────────────────────────────────
    // Displayed span per zoom level (256 px). 2.4 MHz = the dongle's
    // maximum stable sample rate (2.4 MS/s); the default (150 kHz) is
    // close to the mockup's scale.
    var SPANS_KHZ    = [2400, 1000, 500, 250, 150, 100, 50, 25];
    var ZOOM_DEFAULT = SPANS_KHZ.length - 1;   // opens fully zoomed in (25 kHz) on APP
    var STEP_KHZ     = 25 / 3;      // 8.333 kHz air band channel spacing
    // Frequency labels: the smallest round interval that keeps them
    // LABEL_MIN_PX apart.
    var LABEL_STEPS_KHZ = [5, 10, 20, 25, 40, 50, 100, 200, 250, 500, 1000];
    var LABEL_MIN_PX    = 50;
    // Title-strip scale bar: the largest 1-2-5 value whose bar fits
    // SCALEBAR_MAX_PX (always >= SCALEBAR_MIN_PX for these spans).
    var SCALEBAR_KHZ    = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    var SCALEBAR_MIN_PX = 16;
    var SCALEBAR_MAX_PX = 40;
    // AM demodulator filter for 8.33 kHz channels: ~8 kHz wide (±4 kHz).
    var DEMOD_BW_KHZ = 8;
    var SIGNAL_KHZ   = 133400;
    var VFO_MIN_KHZ  = 118000;
    var VFO_MAX_KHZ  = 136975;
    var VOICE_KHZ    = 4;           // AM voice sidebands, ± around the carrier (fits the filter)

    var TX_MIN_MS    = 2000;
    var TX_MAX_MS    = 4000;
    var PAUSE_MIN_MS = 500;
    var PAUSE_MAX_MS = 1500;
    var CARRIER_LEAD_MS = 250;      // carrier only, before the voice
    var CARRIER_TAIL_MS = 150;      // carrier only, after the voice

    var WF_ROWS_PER_SEC = 8;        // 40 clear rows ≈ 5 s, then the fade
    var SPEC_UPDATE_MS  = 40;

    // Spectrum: dB above the noise floor → y.
    var FLOOR_Y   = 65;             // noise floor row (5 px lower with the taller spectrum)
    var PX_PER_DB = 0.75;
    // Squelch threshold, dashed, a little above the noise floor.
    var SQUELCH_DB = 5;

    // Bookmarks (air band). APP is the station that talks in the demo.
    // No bookmarks by default; the user adds them via Edit (kept for the
    // page session). Stations on the air: APP voice 133.400, ATIS loop
    // 133.350, ACARS data 131.550.
    var BOOKMARKS = [];
    var FLAG_Y   = SPEC_TOP + 1;    // bookmark pill rows 30..38
    var FLAG_H   = 9;
    var FLAG_PAD = 8;               // ink to pill edge, room for < > (as the VFO pill)
    var FLAG_PTR_H = 3;             // pointer rows 39..41 down onto the frequency
    var FLAG_GAP = 2;               // min px between two bookmark pills

    // Touchpad (raw units, a full swipe ≈ 1000).
    var TP_AXIS_LOCK  = 24;         // travel that decides drag vs zoom
    var TP_PX_DIVIDER = 2;          // 2 raw units = 1 screen px of drag
    var TP_ZOOM_UNITS = 120;        // vertical travel per zoom level
    var HAPTIC_MIN_MS = 25;         // tick rate limit for fast drags
    var SNAP_PX       = 12;         // drag target this close to a bookmark lands on it
    // Strong buzz when PTT engages the touchpad: effect 2, full waveform
    // (the keyboard's emphatic focus-switch buzz). Tune in Haptic tests.
    var PTT_HAPTIC_EFFECT = 2;
    // VFO pill while PTT is held: grows to this size around its centre.
    var PILL_BIG_W   = 57;          // 4 px more on each side
    var PILL_BIG_H   = 19;          // ^ and v with 2 rows of air to the digits
    var PILL_GROW_MS = 120;         // grow / shrink time
    // Digit entry (OK on the selected frequency): a bigger pill with the
    // digits, a filled triangle above / below the chosen one.
    var PILL_EDIT_W  = 61;
    var PILL_EDIT_H  = 21;
    // "133.400": char index of each digit and the kHz one step of it is.
    var DIGIT_CHARS  = [0, 1, 2, 4, 5, 6];
    var DIGIT_KHZ    = [100000, 10000, 1000, 100, 10, 1];
    // Waterfall: dB above the floor → gray (255 = white).
    var WF_T0_DB  = 5;              // below this the pixel stays white (~4% of noise bins pass)
    var WF_GAIN   = 18;             // gray levels per dB

    function rand(a, b) { return a + Math.random() * (b - a); }
    // Exponential noise power (mean 1): what a real FFT bin of noise looks like.
    function noisePower() { return -Math.log(1 - Math.random()); }
    function db(p) { return 10 * Math.log10(p); }

    function FlipSdrDemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'FlipSDR';
        this.breadcrumbTitle = 'FlipSDR';
        this._vfo     = SIGNAL_KHZ;
        this._zoom    = ZOOM_DEFAULT;
        this._mode = 'frequency';    // or 'bookmark'
        this._decoder = 'Off';
        this._modal = null;          // null | 'edit' | 'decoder'
        this._modalSel = 0;
        this._modalFrame = new MenuSelectorFrame({
            x: 0, y: 0, width: 1, height: 1,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
        // Constant label; the toggle bar shows the state (Caps Lock style).
        this._modeBtn = new UI.MiddleToggleButton('Bookmark', 1, 48, 2, 'edit', null, false);
        this._btns = [
            this._modeBtn,
            this._editBtn = new UI.MiddleButton('Edit', 3, 48, 2, 'del'),
            this._scanBtn = new UI.RightButton('Scan', 48, 'run', null, 256)
        ];
        this._btns[0].x = 52;
        this._btns[1].x = 156;
    }

    // First enter builds the display; later ones (back from the keyboard)
    // just resume so the waterfall, zoom and tuning survive.
    FlipSdrDemoScene.prototype.enter = function() {
        PowerMeterLeds.start(METER);
        var now = Date.now();
        if (this._wf) {
            this._lastRow = now;
            this._lastSpec = 0;
            this._pillAt = now;
            this._resume();
            return;
        }
        this._wf = document.createElement('canvas');
        this._wf.width = 256;
        this._wf.height = WF_H;
        this._wfCtx = this._wf.getContext('2d');
        this._wfCtx.fillStyle = '#fff';
        this._wfCtx.fillRect(0, 0, 256, WF_H);
        this._row = this._wfCtx.createImageData(256, 1);
        this._hist = [];                            // station state per row, newest first
        this._spec = new Float32Array(256);         // smoothed dB per column
        for (var i = 0; i < 256; i++) this._spec[i] = db(noisePower());
        this._lastSpec = 0;
        this._lastRow  = now;
        // Transmission schedule: start with a short pause.
        this._txStart = now + rand(PAUSE_MIN_MS, PAUSE_MAX_MS);
        this._txEnd   = this._txStart + rand(TX_MIN_MS, TX_MAX_MS);
        // The waterfall starts empty: rows begin to fall from the moment
        // the band is opened.
        this._resume();
    };

    // Live parts: render loop, LEDs, touchpad stream.
    FlipSdrDemoScene.prototype._resume = function() {
        this._running = true;
        var self = this;
        this._ledOn = false;
        sendLedManual(true);
        sendLinkLed(false);
        this._tp = { down: false, axis: null };
        try {
            this._tpES = new EventSource('/api/touchpad/xy');
            this._tpES.onmessage = function(e) { self._handleTouchpad(e); };
            this._tpES.onerror   = function() { /* d-pad still works */ };
        } catch (err) {
            this._tpES = null;
        }
    };

    FlipSdrDemoScene.prototype.exit = function() {
        PowerMeterLeds.stop();
        this._running = false;
        if (this._tpES) { this._tpES.close(); this._tpES = null; }
        sendLinkLed(false);
        sendLedManual(false);
        this._ledOn = false;
    };

    // ── Link LED ────────────────────────────────────────────────────
    function sendLinkLed(on) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/led/set', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send(JSON.stringify({ led: 'link', r: on ? 255 : 0, g: 0, b: 0, on: !!on }));
        } catch (e) { /* offline, ignore */ }
    }
    function sendLedManual(enabled) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/led/manual', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send(JSON.stringify({ enabled: !!enabled }));
        } catch (e) { /* offline, ignore */ }
    }

    // Squelch open: the station is transmitting inside the filter.
    FlipSdrDemoScene.prototype._squelchOpen = function(t) {
        var inBand = function(khz, vfo) { return Math.abs(khz - vfo) <= DEMOD_BW_KHZ / 2; };
        if (this._station(t).carrier !== -Infinity && inBand(SIGNAL_KHZ, this._vfo)) return true;
        if (inBand(ATIS_KHZ, this._vfo)) return true;     // ATIS never stops
        return this._acars(t).on && inBand(ACARS_KHZ, this._vfo);
    };
    // Post only on change.
    FlipSdrDemoScene.prototype._updateLed = function(t) {
        var on = this._squelchOpen(t);
        if (on === this._ledOn) return;
        this._ledOn = on;
        sendLinkLed(on);
    };

    // Advance the burst schedule so it covers time t.
    FlipSdrDemoScene.prototype._schedule = function(t) {
        while (t >= this._txEnd + 0) {
            var pause = rand(PAUSE_MIN_MS, PAUSE_MAX_MS);
            this._txStart = this._txEnd + pause;
            this._txEnd   = this._txStart + rand(TX_MIN_MS, TX_MAX_MS);
        }
    };

    // Station state at time t: { carrier: dB, voice: dB } above the floor
    // (-Infinity when off).
    FlipSdrDemoScene.prototype._station = function(t) {
        var off = { carrier: -Infinity, voice: -Infinity };
        if (t < this._txStart || t >= this._txEnd) return off;
        var carrier = 34 + 1.5 * Math.sin(t / 37);
        var inVoice = t >= this._txStart + CARRIER_LEAD_MS && t < this._txEnd - CARRIER_TAIL_MS;
        if (!inVoice) return { carrier: carrier - 6, voice: -Infinity };
        // Syllabic envelope: a few beats plus a slow phrase swell.
        var env = 0.55 + 0.25 * Math.sin(t / 90) + 0.15 * Math.sin(t / 37 + 1.3)
                + 0.2 * Math.sin(t / 410);
        env = Math.max(0.05, Math.min(1, env));
        return { carrier: carrier, voice: 4 + 11 * env };
    };

    // ATIS state at time t (same shape as _station): never off, voice
    // dips to carrier-only for ~0.3 s between phrases.
    FlipSdrDemoScene.prototype._atis = function(t) {
        var carrier = 32 + 1 * Math.sin(t / 53);
        if (Math.sin(t / 650) + 0.4 * Math.sin(t / 211) < -1.05) return { carrier: carrier - 4, voice: -Infinity };
        var env = 0.55 + 0.25 * Math.sin(t / 83 + 0.7) + 0.15 * Math.sin(t / 29 + 2.1)
                + 0.2 * Math.sin(t / 370);
        env = Math.max(0.05, Math.min(1, env));
        return { carrier: carrier, voice: 3 + 10 * env };
    };

    // ACARS bursts: its own schedule, started on first use.
    FlipSdrDemoScene.prototype._acars = function(t) {
        if (!this._aEnd) {
            this._aStart = t + rand(400, 1200);
            this._aEnd   = this._aStart + rand(ACARS_MIN_MS, ACARS_MAX_MS);
        }
        while (t >= this._aEnd) {
            this._aStart = this._aEnd + rand(ACARS_GAP_MIN_MS, ACARS_GAP_MAX_MS);
            this._aEnd   = this._aStart + rand(ACARS_MIN_MS, ACARS_MAX_MS);
        }
        return { on: t >= this._aStart };
    };

    // ACARS power in a column `df` kHz from its carrier: carrier + a flat
    // block of data (uniform, so the waterfall shows a solid rectangle).
    function acarsPower(df, colKhz, a) {
        if (!a || !a.on) return 0;
        var d = Math.abs(df), p = 0;
        if (d <= colKhz / 2) p += Math.pow(10, ACARS_CARRIER_DB / 10);
        if (d <= ACARS_HALF_KHZ + colKhz / 2) {
            p += Math.pow(10, ACARS_DATA_DB / 10) * (0.7 + 0.6 * Math.random());
        }
        return p;
    }

    // Signal power (linear, floor = 1) in a column centred `df` kHz from
    // the carrier, `colKhz` wide, for a station state.
    function signalPower(df, colKhz, st) {
        if (st.carrier === -Infinity) return 0;
        var d = Math.abs(df);
        var p = 0;
        if (d <= colKhz / 2) p += Math.pow(10, st.carrier / 10);
        else if (d <= colKhz * 1.5) p += Math.pow(10, (st.carrier - 14) / 10);
        if (st.voice !== -Infinity && d <= VOICE_KHZ + colKhz / 2) {
            // Voice energy falls off toward the filter edges.
            var r = Math.min(1, d / VOICE_KHZ);
            var shape = 1 - r * r;
            p += Math.pow(10, (st.voice - 10 * (1 - shape)) / 10) * noisePower();
        }
        return p;
    }

    FlipSdrDemoScene.prototype._pxPerKhz = function() {
        return 256 / SPANS_KHZ[this._zoom];
    };
    // Grid column of the VFO; screen x = CX + column - vfoCol.
    FlipSdrDemoScene.prototype._vfoCol = function() {
        return Math.round(this._vfo * this._pxPerKhz());
    };
    // Screen x of an absolute frequency on the shared column grid.
    FlipSdrDemoScene.prototype._xOf = function(khz) {
        var pxk = this._pxPerKhz();
        return CX + Math.round(khz * pxk) - Math.round(this._vfo * pxk);
    };

    // Paint waterfall row `y` for row state `row` ({ st, ac }: voice
    // station + ACARS) at the current VFO / zoom (fresh noise every time).
    // `x0`..`x1` (exclusive) limits it to a column range (default: all).
    FlipSdrDemoScene.prototype._paintRow = function(y, row, x0, x1) {
        if (x0 === undefined) { x0 = 0; x1 = 256; }
        var colKhz = 1 / this._pxPerKhz();
        var c0 = this._vfoCol() - CX;
        var d = this._row.data;
        for (var x = x0; x < x1; x++) {
            var f = (c0 + x) * colKhz;
            var level = db(noisePower() + signalPower(f - SIGNAL_KHZ, colKhz, row.st)
                                        + signalPower(f - ATIS_KHZ, colKhz, row.at)
                                        + acarsPower(f - ACARS_KHZ, colKhz, row.ac));
            var g = 255 - Math.round((level - WF_T0_DB) * WF_GAIN);
            if (g > 255) g = 255;
            if (g < 0) g = 0;
            var i = x * 4;
            d[i] = d[i + 1] = d[i + 2] = g;
            d[i + 3] = 255;
        }
        this._wfCtx.putImageData(this._row, 0, y, x0, 0, x1 - x0, 1);
    };

    // Add one waterfall row (time t) at the top, pushing the rest down.
    // The station state is kept per row so a zoom can redraw history.
    FlipSdrDemoScene.prototype._pushRow = function(t) {
        this._schedule(t);
        var row = { st: this._station(t), at: this._atis(t), ac: this._acars(t) };
        this._hist.unshift(row);
        if (this._hist.length > WF_H) this._hist.length = WF_H;
        this._wfCtx.drawImage(this._wf, 0, 1);
        this._paintRow(0, row);
    };

    // Redraw the whole waterfall from the stored row states.
    FlipSdrDemoScene.prototype._repaintWaterfall = function() {
        this._wfCtx.fillStyle = '#fff';
        this._wfCtx.fillRect(0, 0, 256, WF_H);
        for (var y = 0; y < this._hist.length; y++) this._paintRow(y, this._hist[y]);
    };

    // Refresh the smoothed spectrum (a few averaged noise samples per bin).
    // `fresh` skips the smoothing (after a zoom the old shape is stale).
    FlipSdrDemoScene.prototype._updateSpectrum = function(t, fresh) {
        this._schedule(t);
        var st = this._station(t), at = this._atis(t), ac = this._acars(t);
        var colKhz = 1 / this._pxPerKhz();
        var c0 = this._vfoCol() - CX;
        for (var x = 0; x < 256; x++) {
            var f = (c0 + x) * colKhz;
            var p = (noisePower() + noisePower() + noisePower() + noisePower()) / 4
                  + signalPower(f - SIGNAL_KHZ, colKhz, st)
                  + signalPower(f - ATIS_KHZ, colKhz, at)
                  + acarsPower(f - ACARS_KHZ, colKhz, ac);
            this._spec[x] = fresh ? db(p) : 0.55 * this._spec[x] + 0.45 * db(p);
        }
    };

    // Up = zoom in (narrower span), down = zoom out.
    FlipSdrDemoScene.prototype._zoomBy = function(dir) {
        var next = this._zoom + dir;
        if (next < 0 || next >= SPANS_KHZ.length) return false;
        this._zoom = next;
        this._repaintWaterfall();
        this._updateSpectrum(Date.now(), true);
        if (window.requestRender) window.requestRender();
        return true;
    };

    // ── Touchpad ────────────────────────────────────────────────────
    // Fire-and-forget haptic (daemon behind /api/haptic/play). No
    // durationMs → the effect's full waveform.
    function playHaptic(effectId, durationMs) {
        try {
            var x = new XMLHttpRequest();
            x.open('POST', '/api/haptic/play', true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.timeout = 2000;
            x.send(JSON.stringify({ effectId: effectId, durationMs: durationMs }));
        } catch (e) { /* offline / mocked — ignore */ }
    }

    FlipSdrDemoScene.prototype._tick = function() {
        var now = Date.now();
        if (now - (this._lastTick || 0) < HAPTIC_MIN_MS) return;
        this._lastTick = now;
        playHaptic(3, 10);
    };
    FlipSdrDemoScene.prototype._thump = function() {
        if (this._edgeBuzzed) return;
        this._edgeBuzzed = true;
        playHaptic(3);
    };

    // "x,y,touch" from /api/touchpad/xy.
    FlipSdrDemoScene.prototype._handleTouchpad = function(e) {
        var p = String(e.data || '').split(',');
        if (p.length < 3) return;
        var nx = +p[0], ny = +p[1], nt = +p[2];
        if (nx !== nx || ny !== ny || (nt !== 0 && nt !== 1)) return;
        var tp = this._tp;
        // Only while PTT is held; a PTT press mid-touch re-anchors.
        if (this._fedit) { tp.down = false; return; }
        if (this._logOpen && !isPttHeld() && !this._modal && !this._dolphin) {
            tp.down = false;
            this._touchLog(ny, nt === 1);
            return;
        }
        if (this._tpLog) this._tpLog.down = false;
        if (nt !== 1 || !isPttHeld() || this._modal || this._dolphin) { tp.down = false; return; }
        if (!tp.down) {
            // Touch-down: anchor, axis undecided.
            tp.down = true; tp.axis = null;
            tp.ax = nx; tp.ay = ny;
            this._edgeBuzzed = false;
            return;
        }
        var dx = nx - tp.ax, dy = ny - tp.ay;
        if (!tp.axis) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) < TP_AXIS_LOCK) return;
            tp.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
            tp.ax = nx; tp.ay = ny;          // start counting from here
            tp.done = 0;                     // zoom levels applied so far
            tp.startVfo = this._vfo;
            tp.snap = null;                  // bookmark the drag is parked on
            return;
        }
        if (tp.axis === 'x') {
            // The band follows the finger: finger right = band right =
            // lower frequency. Target snapped to a channel, or pulled onto
            // a bookmark when one is within SNAP_PX of it.
            var pxk = this._pxPerKhz();
            var target = tp.startVfo - ((nx - tp.ax) / TP_PX_DIVIDER) / pxk;
            // Snap targets: bookmarks plus the (unbookmarked) ACARS signal.
            var targets = BOOKMARKS.concat([{ khz: ACARS_KHZ }]);
            var snap = null, best = SNAP_PX + 1;
            for (var i = 0; i < targets.length; i++) {
                var dpx = Math.abs(targets[i].khz - target) * pxk;
                if (dpx <= SNAP_PX && dpx < best) { best = dpx; snap = targets[i]; }
            }
            var ch = snap ? channelOf(snap.khz) : channelOf(target);
            if (ch < CH_MIN || ch > CH_MAX) {
                this._setChannel(Math.max(CH_MIN, Math.min(CH_MAX, ch)));
                this._thump();
                return;
            }
            this._edgeBuzzed = false;
            if (ch === channelOf(this._vfo)) return;
            this._setChannel(ch);
            if (snap && snap !== tp.snap) playHaptic(3, 50);
            else this._tick();
            tp.snap = snap;
        } else {
            // Up (smaller y) = zoom in.
            var lv = Math.trunc((tp.ay - ny) / TP_ZOOM_UNITS);
            var dz = lv - tp.done;
            if (!dz) return;
            var dir = dz > 0 ? 1 : -1;
            if (this._zoomBy(dir)) { tp.done += dir; this._edgeBuzzed = false; this._tick(); }
            else { tp.done = lv; this._thump(); }
        }
    };

    // Channel index on the 8.33 kHz grid (25 kHz multiples, so every
    // bookmark is a channel too).
    function channelOf(khz) { return Math.round(khz / STEP_KHZ); }
    var CH_MIN = channelOf(VFO_MIN_KHZ), CH_MAX = channelOf(VFO_MAX_KHZ);

    // Move the band under the fixed VFO: shift the waterfall history by
    // the same whole number of grid columns so old rows stay aligned.
    // Returns false when the band edge stopped it.
    FlipSdrDemoScene.prototype._tune = function(steps) {
        return this._setChannel(channelOf(this._vfo) + steps);
    };
    FlipSdrDemoScene.prototype._setChannel = function(ch) {
        if (ch < CH_MIN || ch > CH_MAX) return false;
        return this._setVfoKhz(ch * STEP_KHZ);
    };
    // Any frequency (digit entry can land between 8.33 kHz channels).
    FlipSdrDemoScene.prototype._setVfoKhz = function(khz) {
        if (khz < VFO_MIN_KHZ - 0.5 || khz > VFO_MAX_KHZ + 0.5) return false;
        var before = this._vfoCol();
        this._vfo = khz;
        var dx = before - this._vfoCol();
        if (dx) {
            // Shift the history, then fill the strip that scrolled in from
            // the stored row states, so signals that went off screen come
            // back with their trail instead of a blank band.
            this._wfCtx.drawImage(this._wf, dx, 0);
            var a = dx > 0 ? 0 : Math.max(0, 256 + dx);
            var b = dx > 0 ? Math.min(256, dx) : 256;
            for (var y = 0; y < this._hist.length; y++) this._paintRow(y, this._hist[y], a, b);
        }
        if (window.requestRender) window.requestRender();
        return true;
    };

    FlipSdrDemoScene.prototype.handleInput = function(action) {
        if (this._fedit) return this._handleFreqEdit(action);
        if (this._dolphin) return this._handleDolphinInput(action);
        if (this._modal) return this._handleModalInput(action);
        if ((action === 'ok') && this._mode === 'frequency' && !this._logOpen && !isPttHeld()) {
            this._startFreqEdit();
            return;
        }
        if (this._logOpen) {
            if (action === 'back' || action === 'esc') { this._logOpen = false; this._logClosed = true; return; }
            if (action === 'up')   { this._scrollLog(LOG_LINE); return; }    // older
            if (action === 'down') { this._scrollLog(-LOG_LINE); return; }   // newer
        }
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'del') { this._openEdit(); return; }
        if (action === 'up')    this._zoomBy(1);
        if (action === 'down')  this._zoomBy(-1);
        var byBookmark = this._mode === 'bookmark' && !isPttHeld();
        if (action === 'left')  { if (byBookmark) this._jumpBookmark(-1); else this._tune(-1); }
        if (action === 'right') { if (byBookmark) this._jumpBookmark(1); else this._tune(1); }
        if (action === 'edit')  this._toggleMode();
        // PTT hold is read via Input.isHeld in render / the touchpad.
        if (action === 'ptt' && window.requestRender) window.requestRender();
    };

    function scaleText(khz) {
        if (khz < 1) return Math.round(khz * 1000) + ' Hz';
        if (khz < 1000) return khz + ' kHz';
        return (khz / 1000) + ' MHz';
    }

    // Map-style scale bar: the bar itself is centred on the screen (the
    // VFO column), its label sits to the left of it. 1 px lines: the
    // bottom bar and two end ticks rising to the label's cap height.
    // An odd length keeps the bar exactly symmetric around CX (±1 px of
    // the true length, invisible at this size).
    FlipSdrDemoScene.prototype._drawScaleBar = function(ctx, pxk, ty) {
        var khz = SCALEBAR_KHZ[0];
        for (var i = 0; i < SCALEBAR_KHZ.length; i++) {
            if (SCALEBAR_KHZ[i] * pxk <= SCALEBAR_MAX_PX) khz = SCALEBAR_KHZ[i];
        }
        var len = Math.max(SCALEBAR_MIN_PX, Math.round(khz * pxk));
        if (len % 2 === 0) len += 1;
        var bx = CX - (len - 1) / 2;
        var text = scaleText(khz);
        var GAP = 3;
        HaxrCorp4090FlipCTL.draw(ctx, text,
            bx - GAP - HaxrCorp4090FlipCTL.textWidth(text), ty + 3, '#000');
        var inkTop = ty + 5, inkBot = ty + 11;      // Haxrcorp ink rows
        ctx.fillStyle = '#000';
        ctx.fillRect(bx, inkBot, len, 1);                           // bar
        ctx.fillRect(bx, inkTop + 1, 1, inkBot - inkTop);           // left tick
        ctx.fillRect(bx + len - 1, inkTop + 1, 1, inkBot - inkTop); // right tick
    };

    // Bookmarks sorted by frequency (for prev / next jumps).
    var BOOKMARKS_SORTED = [];
    function resortBookmarks() {
        BOOKMARKS_SORTED = BOOKMARKS.slice().sort(function(a, b) { return a.khz - b.khz; });
    }
    resortBookmarks();

    // ── Dolphin hint ────────────────────────────────────────────────
    // Raised when the VFO sits on the ACARS channel, a burst is on the
    // air and the ACARS decoder is off. Enable ACARS switches the decoder
    // on; Dismiss (or Back) hides it until the VFO leaves that channel.
    var dolphinImgs = {};
    function dolphinImage(src) {
        if (!dolphinImgs[src]) {
            var img = new Image();
            img.onload = function() { if (window.requestRender) window.requestRender(); };
            img.src = src;
            dolphinImgs[src] = img;
        }
        return dolphinImgs[src];
    }
    function randIn(r) { return r[0] + Math.random() * (r[1] - r[0]); }

    FlipSdrDemoScene.prototype._maybeShowDolphin = function(now) {
        var onAcars = channelOf(this._vfo) === channelOf(ACARS_KHZ);
        if (!onAcars) { this._dolphinDismissed = false; return; }
        if (this._dolphin || this._modal || this._dolphinDismissed) return;
        if (this._decoder === 'ACARS' || isPttHeld()) return;
        if (!this._acars(now).on) return;
        this._dolphin = { sel: 0, talk: { open: false, nextAt: 0 } };
        dolphinImage(DOLPHIN_OPEN); dolphinImage(DOLPHIN_CLOSE);
    };

    FlipSdrDemoScene.prototype._handleDolphinInput = function(action) {
        var d = this._dolphin;
        var n = DOLPHIN_ITEMS.length;
        if (action === 'up')   d.sel = (d.sel + n - 1) % n;
        if (action === 'down') d.sel = (d.sel + 1) % n;
        var pick = (action === 'ok' || action === 'run') ? DOLPHIN_ITEMS[d.sel]
                 : (action === 'back' || action === 'esc') ? 'Dismiss' : null;
        if (pick === 'Enable ACARS') { this._decoder = 'ACARS'; this._dolphin = null; }
        if (pick === 'Dismiss') { this._dolphinDismissed = true; this._dolphin = null; }
        if (window.requestRender) window.requestRender();
    };

    // Wrap `text` into Haxrcorp lines no wider than `maxW`.
    function wrapText(text, maxW) {
        var words = text.split(' '), lines = [], line = '';
        for (var i = 0; i < words.length; i++) {
            var tryLine = line ? line + ' ' + words[i] : words[i];
            if (line && HaxrCorp4090FlipCTL.textWidth(tryLine) > maxW) {
                lines.push(line);
                line = words[i];
            } else {
                line = tryLine;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    // White wash, talking dolphin (mouth flips at random intervals like
    // the Wi-Fi warning), then the speech bubble: rounded frame sized to
    // its content with a tail at the mouth (fixed rows TAIL_Y..+8) — title
    // in Helvb08, message in Haxrcorp, then the two options as modal rows.
    FlipSdrDemoScene.prototype._drawDolphin = function(canvas) {
        var ctx = canvas.ctx, d = this._dolphin, now = Date.now();
        if (now >= d.talk.nextAt) {
            d.talk.open = !d.talk.open;
            d.talk.nextAt = now + randIn(d.talk.open ? TALK_OPEN_MS : TALK_CLOSED_MS);
        }
        ctx.fillStyle = DOLPHIN_WASH;
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        var img = dolphinImage(d.talk.open ? DOLPHIN_OPEN : DOLPHIN_CLOSE);
        if (img.complete && img.naturalWidth > 0) ctx.drawImage(img, 0, 0);

        var innerW = BUBBLE_W - 2 * BUBBLE_PAD;
        var body = wrapText('Try to enable decoder for this frequency', innerW);
        var titleY = BUBBLE_Y + BUBBLE_PAD - 1;                  // Helvb08 caps from +1
        var bodyY  = titleY + 13;                                // Haxrcorp lines, 10 px pitch
        var rowsY  = bodyY + body.length * 10 + 5;
        var BH = rowsY - BUBBLE_Y + DOLPHIN_ITEMS.length * 16 + 1;
        new ResponsiveFrame({
            x: BUBBLE_X, y: BUBBLE_Y, width: BUBBLE_W, height: BH,
            anchorH: 'left', anchorV: 'top',
            showStroke: true, strokeColor: '#000',
            showFill: true, fillColor: '#fff',
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        // Tail: opens the left border on rows TAIL_Y..TAIL_Y+7, diagonal
        // down-left, flat base on the last row (as in the Wi-Fi overlay).
        for (var k = 0; k < TAIL_H - 1; k++) {
            ctx.fillStyle = '#fff';
            ctx.fillRect(BUBBLE_X - k, TAIL_Y + k, k + 1, 1);
            ctx.fillStyle = '#000';
            ctx.fillRect(BUBBLE_X - 1 - k, TAIL_Y + k, 1, 1);
        }
        ctx.fillStyle = '#000';
        ctx.fillRect(BUBBLE_X - TAIL_H, TAIL_Y + TAIL_H - 1, TAIL_H + 1, 1);

        Helvb08Regular.draw(ctx, 'Looks like ACARS', BUBBLE_X + BUBBLE_PAD, titleY, '#000');
        for (var i = 0; i < body.length; i++) {
            HaxrCorp4090FlipCTL.draw(ctx, body[i], BUBBLE_X + BUBBLE_PAD, bodyY + i * 10, '#000');
        }
        var rowX = BUBBLE_X + 3, rowW = BUBBLE_W - 6;
        for (var r = 0; r < DOLPHIN_ITEMS.length; r++) {
            var ry = rowsY + r * 16;
            var sel = r === d.sel;
            var font = sel ? Helvb08Regular : HaxrCorp4090FlipCTL;
            var tw = font.textWidth(DOLPHIN_ITEMS[r]);
            font.draw(ctx, DOLPHIN_ITEMS[r], rowX + Math.floor((rowW - tw) / 2), ry + (sel ? 2 : 1), '#000');
            if (sel) {
                this._modalFrame.setPosition(rowX, ry);
                this._modalFrame.setSize(rowW, 14);
                this._modalFrame.render(canvas);
            }
        }
        // Keep talking.
        if (window.requestRender) window.requestRender();
    };

    // ── ACARS decode window ─────────────────────────────────────────
    // Open while the VFO sits on the ACARS channel with the ACARS decoder
    // on (Back hides it until the VFO leaves the channel). Every burst on
    // that channel adds one decoded message; up / down scroll back.
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function acarsStamp(t) {
        var d = new Date(t);
        return '[' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + '  '
             + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + ']';
    }
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

    FlipSdrDemoScene.prototype._fakeAcarsMessage = function(t) {
        if (!this._logSeq) this._logSeq = 88;
        if (Math.random() < 0.2) {
            // Ground station squitter.
            return { hdr: '------- SQ 164  ' + acarsStamp(t),
                     body: '02XA EDDBXA G52224N01331EV131550/ARINC' };
        }
        var i = Math.floor(Math.random() * ACARS_REGS.length);
        this._logSeq = this._logSeq >= 99 ? 80 : this._logSeq + 1;
        return { hdr: ACARS_REGS[i] + '  _ ' + this._logSeq + '  ' + acarsStamp(t),
                 body: pick(ACARS_BODIES)(ACARS_FLIGHTS[i]) };
    };

    FlipSdrDemoScene.prototype._updateAcarsLog = function(now) {
        var onAcars = channelOf(this._vfo) === channelOf(ACARS_KHZ);
        if (!onAcars || this._decoder !== 'ACARS') {
            this._logOpen = false;
            if (!onAcars) this._logClosed = false;
            return;
        }
        if (!this._logOpen && !this._logClosed) { this._logOpen = true; this._logScroll = 0; }
        if (!this._acarsLog) this._acarsLog = [];
        var a = this._acars(now);
        if (a.on && this._lastLogged !== this._aStart) {
            this._lastLogged = this._aStart;
            var msg = this._fakeAcarsMessage(now);
            this._acarsLog.push(msg);
            if (this._acarsLog.length > LOG_MAX) this._acarsLog.shift();
            // Pinned to the newest: stay pinned. Scrolled back: keep the
            // text where it is (the new message lands below, out of view).
            if (this._logScroll > 0) this._logScroll += logEntryH(msg);
        }
    };

    // Whole messages that fit in the window, and how far back it scrolls.
    // Message text stops 4 px short of the scrollbar (x = LOG_X+LOG_W-5)
    // and wraps: at a space when there is one, else mid-token.
    var LOG_TEXT_W = LOG_W - LOG_PAD - 5 - 1 - 4;
    // Gray header band inside the frame (as in the Edit modal); messages
    // scroll underneath it, pixel by pixel.
    var LOG_HEAD_H   = 16;
    var LOG_AREA_TOP = LOG_Y + 1 + LOG_HEAD_H;     // first row under the band (43)
    var LOG_INK_TOP  = LOG_AREA_TOP + 3;           // first ink row of the content (46)
    var LOG_INK_BOT  = LOG_Y + LOG_H - 5;          // last ink row in view (117)
    var LOG_VIEW_H   = LOG_INK_BOT - LOG_INK_TOP + 1;
    var TP_LOG_DIVIDER = 2;                        // 2 raw units = 1 px of scroll

    function wrapLine(text, maxW) {
        var out = [], line = '';
        for (var i = 0; i < text.length; i++) {
            var next = line + text[i];
            if (line && HaxrCorp4090FlipCTL.textWidth(next) > maxW) {
                var cut = line.lastIndexOf(' ');
                if (cut > 0) { out.push(line.slice(0, cut)); line = line.slice(cut + 1) + text[i]; }
                else { out.push(line); line = text[i]; }
            } else {
                line = next;
            }
        }
        if (line) out.push(line);
        return out;
    }
    // Wrapped lines of one message (cached on it).
    function logLines(m) {
        if (!m.lines) m.lines = wrapLine(m.hdr, LOG_TEXT_W).concat(wrapLine(m.body, LOG_TEXT_W));
        return m.lines;
    }
    function logEntryH(m) { return logLines(m).length * LOG_LINE + LOG_GAP; }
    // Ink height of the whole log, top of the oldest to bottom of the newest.
    FlipSdrDemoScene.prototype._logInkH = function() {
        var log = this._acarsLog || [], h = 0;
        for (var i = 0; i < log.length; i++) h += logEntryH(log[i]);
        return log.length ? h - LOG_GAP - (LOG_LINE - 7) : 0;
    };
    // Scroll is in px back from the newest (0 = pinned to the bottom).
    FlipSdrDemoScene.prototype._logMaxScroll = function() {
        return Math.max(0, this._logInkH() - LOG_VIEW_H);
    };
    FlipSdrDemoScene.prototype._scrollLog = function(px) {
        this._logScroll = Math.round(Math.max(0, Math.min(this._logMaxScroll(), (this._logScroll || 0) + px)));
        if (window.requestRender) window.requestRender();
    };

    // Touchpad (no PTT needed) while the window is open: the text follows
    // the finger — down shows older messages. Tick per line, thump at an end.
    FlipSdrDemoScene.prototype._touchLog = function(ny, down) {
        var tl = this._tpLog || (this._tpLog = { down: false });
        if (!down) { tl.down = false; return; }
        if (!tl.down) {
            tl.down = true; tl.ay = ny; tl.start = this._logScroll || 0;
            tl.line = Math.floor(tl.start / LOG_LINE); tl.edge = false;
            return;
        }
        // Whole pixels only: text drawn at a fractional y smears.
        var want = Math.round(tl.start + (ny - tl.ay) / TP_LOG_DIVIDER);
        var max = this._logMaxScroll();
        var clamped = Math.max(0, Math.min(max, want));
        this._logScroll = clamped;
        if (want < 0 || want > max) {
            if (!tl.edge) { tl.edge = true; playHaptic(3); }
        } else {
            tl.edge = false;
            var line = Math.floor(clamped / LOG_LINE);
            if (line !== tl.line) { tl.line = line; this._tick(); }
        }
        if (window.requestRender) window.requestRender();
    };

    FlipSdrDemoScene.prototype._drawAcarsLog = function(canvas) {
        var ctx = canvas.ctx;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        // Black name tab centred on the VFO column, reading as the
        // frequency pill grown into a window: < > on its sides like the
        // pill (left / right still tune), bottom rows tucked under the frame.
        // Just what the pill would show: the bookmark's name, else the frequency.
        var here = this._activeBookmark();
        var title = here ? here.name : vfoText(this._vfo);
        var tabY = LOG_Y - (LOG_TAB_H - LOG_TAB_OVERLAP);
        var ARROW_ROOM = 1 + 3 + 3;                        // edge gap + chevron + gap to text
        var tabW = Born2bSportyV2FlipCTL.textWidth(title) + 2 * (LOG_TAB_PAD + ARROW_ROOM);
        if (tabW % 2 === 0) tabW += 1;                     // odd → exact centre on CX
        var tabX = CX - (tabW - 1) / 2;
        new ResponsiveFrame({
            x: tabX, y: tabY, width: tabW, height: LOG_TAB_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: true, strokeColor: '#000', showFill: true, fillColor: '#000',
            cornerRadius: LOG_R
        }).render(canvas);
        var tw = Born2bSportyV2FlipCTL.textWidth(title);
        Born2bSportyV2FlipCTL.draw(ctx, title, CX - Math.floor(tw / 2), tabY + 1, '#fff');
        var midY = tabY + 8, ch = channelOf(this._vfo);
        ctx.fillStyle = '#fff';
        for (var k = 0; k < 3; k++) {
            if (ch > CH_MIN) {                              // <
                ctx.fillRect(tabX + 3 + k, midY - k, 1, 1);
                ctx.fillRect(tabX + 3 + k, midY + k, 1, 1);
            }
            if (ch < CH_MAX) {                              // >
                ctx.fillRect(tabX + tabW - 4 - k, midY - k, 1, 1);
                ctx.fillRect(tabX + tabW - 4 - k, midY + k, 1, 1);
            }
        }
        new ResponsiveFrame({
            x: LOG_X, y: LOG_Y, width: LOG_W, height: LOG_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: true, strokeColor: '#000', showFill: true, fillColor: '#fff',
            cornerRadius: LOG_R
        }).render(canvas);

        // Gray header band, full width inside the border (as in the Edit
        // modal), then the border on top again.
        new ResponsiveFrame({
            x: LOG_X, y: LOG_Y, width: LOG_W, height: LOG_HEAD_H + 1,
            anchorH: 'left', anchorV: 'top',
            showStroke: false, showFill: true, fillColor: COL_STRIP,
            cornerRadius: LOG_R, corners: { tl: true, tr: true, bl: false, br: false }
        }).render(canvas);
        new ResponsiveFrame({
            x: LOG_X, y: LOG_Y, width: LOG_W, height: LOG_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: true, strokeColor: '#000', showFill: false,
            cornerRadius: LOG_R
        }).render(canvas);
        var head = 'ACARS decoder';
        HaxrCorp4090FlipCTL.draw(ctx, head,
            LOG_X + Math.floor((LOG_W - HaxrCorp4090FlipCTL.textWidth(head)) / 2), LOG_Y + 3, '#000');

        // Messages, newest at the bottom, scrolled in px and clipped to the
        // area under the band so text slides behind it.
        var log = this._acarsLog || [];
        this._logScroll = Math.round(Math.min(this._logScroll || 0, this._logMaxScroll()));
        var inkH = this._logInkH();
        var y = inkH <= LOG_VIEW_H ? LOG_INK_TOP                    // short: from the top
              : LOG_INK_TOP - (inkH - LOG_VIEW_H - this._logScroll); // long: bottom-pinned
        ctx.save();
        ctx.beginPath();
        ctx.rect(LOG_X + 2, LOG_AREA_TOP, LOG_W - 4, LOG_Y + LOG_H - 2 - LOG_AREA_TOP);
        ctx.clip();
        if (!log.length) {
            HaxrCorp4090FlipCTL.draw(ctx, 'Waiting for messages...', LOG_X + LOG_PAD, LOG_INK_TOP - 2, '#696969');
        }
        for (var i = 0; i < log.length; i++) {
            var lines = logLines(log[i]), h = logEntryH(log[i]);
            if (y + h >= LOG_AREA_TOP && y <= LOG_Y + LOG_H) {
                for (var j = 0; j < lines.length; j++) {
                    HaxrCorp4090FlipCTL.draw(ctx, lines[j], LOG_X + LOG_PAD, y - 2 + j * LOG_LINE, '#000');
                }
            }
            y += h;
        }
        ctx.restore();
        // Scrollbar under the band on the right edge (only when the log is
        // taller than the view). Its index counts from the top.
        if (!this._logBar) this._logBar = new UI.Scrollbar(0, 1, 0);
        var maxScroll = this._logMaxScroll();
        this._logBar.update(inkH, LOG_VIEW_H, maxScroll - this._logScroll);
        this._logBar.render(canvas, LOG_X + LOG_W - 5, LOG_AREA_TOP + 2, LOG_Y + LOG_H - 4 - LOG_AREA_TOP - 2, 1);
        // Bookmark and Edit stay live while the window is up: drawn again
        // above the wash (as the Power menu does with its button).
        this._modeBtn.render(canvas);
        this._editBtn.render(canvas);
    };

    // ── Edit modal ──────────────────────────────────────────────────
    // The menu follows the selection: bookmark menu (Rename, Delete,
    // Decoder) when a bookmark is selected — Bookmark mode, PTT up, VFO on
    // it — otherwise the frequency menu (Add to bookmarks, Decoder).
    // Decoder opens a picker. Add / Rename open the standard keyboard.
    var NAME_MAX = 8;               // keeps bookmark pills compact

    // The selected bookmark, or null when the frequency is selected.
    FlipSdrDemoScene.prototype._selectedBookmark = function() {
        if (this._mode !== 'bookmark' || isPttHeld()) return null;
        return this._activeBookmark();
    };
    // Decoder is offered only where there is data to decode: the ACARS
    // channel. Voice frequencies get just the bookmark actions.
    FlipSdrDemoScene.prototype._decoderHere = function() {
        return channelOf(this._vfo) === channelOf(ACARS_KHZ);
    };
    FlipSdrDemoScene.prototype._editItems = function() {
        if (this._modal === 'decoder') return DECODERS;
        var items = this._editTarget ? ['Rename', 'Delete'] : ['Add to bookmarks'];
        if (this._decoderHere()) items.push('Decoder: ' + this._decoder);
        return items;
    };
    // Header text; one level down it is a breadcrumb ("APP > Decoder").
    FlipSdrDemoScene.prototype._editTitle = function() {
        var base = this._editTarget ? this._editTarget.name : vfoText(this._vfo);
        return this._modal === 'decoder' ? base + ' > Decoder' : base;
    };

    // V: 30 ms press flash on the Edit button, then the modal.
    FlipSdrDemoScene.prototype._openEdit = function() {
        var self = this, btn = this._editBtn;
        btn.press();
        if (window.requestRender) window.requestRender();
        // What Edit acts on is decided at the press.
        this._editTarget = this._selectedBookmark();
        setTimeout(function() {
            btn.release();
            self._modal = 'edit';
            self._modalSel = 0;
            if (window.requestRender) window.requestRender();
        }, 30);
    };

    FlipSdrDemoScene.prototype._handleModalInput = function(action) {
        var items = this._editItems();
        var n = items.length;
        if (action === 'back' || action === 'esc') {
            // Back from the decoder picker returns to the Edit modal.
            if (this._modal === 'decoder') {
                this._modal = 'edit';
                this._modalSel = this._editItems().length - 1;
            } else {
                this._modal = null;
            }
        } else if (action === 'up') {
            this._modalSel = (this._modalSel + n - 1) % n;
        } else if (action === 'down') {
            this._modalSel = (this._modalSel + 1) % n;
        } else if (action === 'ok' || action === 'run') {
            var item = items[this._modalSel];
            if (this._modal === 'decoder') {
                this._decoder = item;
                this._modal = null;
            } else if (item.indexOf('Decoder') === 0) {
                this._modal = 'decoder';
                this._modalSel = Math.max(0, DECODERS.indexOf(this._decoder));
            } else if (item === 'Add to bookmarks') {
                this._modal = null;
                this._editName(null);
            } else if (item === 'Rename') {
                this._modal = null;
                this._editName(this._editTarget);
            } else if (item === 'Delete') {
                var here = this._editTarget;
                if (here && BOOKMARKS.indexOf(here) !== -1) {
                    BOOKMARKS.splice(BOOKMARKS.indexOf(here), 1);
                    resortBookmarks();
                }
                this._modal = null;
            }
        }
        if (window.requestRender) window.requestRender();
    };

    // The meter stays as it is over a scene pushed on top (the keyboard).
    function keepMeter(scene) {
        var enter = scene.enter, exit = scene.exit;
        scene.enter = function() {
            PowerMeterLeds.start(METER);
            if (enter) return enter.apply(this, arguments);
        };
        scene.exit = function() {
            PowerMeterLeds.stop();
            if (exit) return exit.apply(this, arguments);
        };
        return scene;
    }

    // Keyboard for a new bookmark on the VFO channel (bm = null) or for
    // renaming `bm`. Returning from it re-enters this scene, which resumes.
    FlipSdrDemoScene.prototype._editName = function(bm) {
        if (!this.sceneManager || typeof TextInputScreen === 'undefined') return;
        var khz = channelOf(this._vfo) * STEP_KHZ;
        var existing = bm ? null : this._activeBookmark();     // one bookmark per channel
        this.sceneManager.push(keepMeter(new TextInputScreen({
            displayName: bm ? 'Rename' : 'Add bookmark',
            title:       bm ? 'Rename bookmark' : 'Bookmark ' + vfoText(khz),
            initialText: bm ? bm.name : '',
            validate: function(text) {
                var t = text.trim();
                if (!t) return 'Name required';
                if (t.length > NAME_MAX) return 'Max ' + NAME_MAX + ' characters';
                if (existing) return 'Already bookmarked: ' + existing.name;
                return null;
            },
            onSave: function(text) {
                var t = text.trim();
                if (!t || (!bm && existing)) return;
                if (bm) bm.name = t;
                else BOOKMARKS.push({ khz: khz, name: t });
                resortBookmarks();
            }
        })));
    };

    // Modal: white box, black 1 px rounded border, gray header band with
    // the title (frequency / bookmark name / "Decoder"), then rows. The
    // highlighted row sits in a MenuSelectorFrame in Helvb08; the others
    // are plain Haxrcorp.
    var MODAL_HEAD_H = 16;          // gray header rows inside the top border, full width
    var MODAL_ROW_H  = 14;
    var MODAL_PITCH  = 16;
    var MODAL_R      = 4;
    FlipSdrDemoScene.prototype._drawModal = function(canvas) {
        var ctx = canvas.ctx;
        var items = this._editItems();
        var title = this._editTitle();
        var widest = HaxrCorp4090FlipCTL.textWidth(title);
        for (var i = 0; i < items.length; i++) {
            widest = Math.max(widest, Helvb08Regular.textWidth(items[i]));
        }
        var MW = Math.max(120, widest + 24);
        var MH = MODAL_HEAD_H + 1 + 3 + items.length * MODAL_PITCH + 1;
        var MX = Math.floor((canvas.w - MW) / 2);
        var MY = Math.floor((canvas.h - MH) / 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        var frame = function(fill, stroke, h, bottomCorners) {
            new ResponsiveFrame({
                x: MX, y: MY, width: MW, height: h,
                anchorH: 'left', anchorV: 'top',
                showStroke: !!stroke, strokeColor: '#000',
                showFill: !!fill, fillColor: fill || '#fff',
                cornerRadius: MODAL_R,
                corners: { tl: true, tr: true, bl: bottomCorners, br: bottomCorners }
            }).render(canvas);
        };
        frame('#fff', true, MH, true);                       // box
        frame(COL_STRIP, false, MODAL_HEAD_H + 1, false);    // header band
        frame(null, true, MH, true);                         // border back on top
        // Haxrcorp's 7 ink rows centred in the 16 gray rows (MY+1..MY+16).
        var hw = HaxrCorp4090FlipCTL.textWidth(title);
        HaxrCorp4090FlipCTL.draw(ctx, title, MX + Math.floor((MW - hw) / 2), MY + 3, '#000');

        var rowX = MX + 3, rowW = MW - 6;
        for (var r = 0; r < items.length; r++) {
            var ry = MY + MODAL_HEAD_H + 1 + 3 + r * MODAL_PITCH;
            var sel = r === this._modalSel;
            var font = sel ? Helvb08Regular : HaxrCorp4090FlipCTL;
            var tw = font.textWidth(items[r]);
            // Helvb08 caps: 8 rows from draw y + 1; Haxrcorp: 7 rows from
            // draw y + 2. Both centred inside the frame (rows ry+1..ry+12).
            font.draw(ctx, items[r], rowX + Math.floor((rowW - tw) / 2), ry + (sel ? 2 : 1), '#000');
            if (sel) {
                this._modalFrame.setPosition(rowX, ry);
                this._modalFrame.setSize(rowW, MODAL_ROW_H);
                this._modalFrame.render(canvas);
            }
        }
    };

    // The bookmark the VFO sits on, or null.
    FlipSdrDemoScene.prototype._activeBookmark = function() {
        for (var i = 0; i < BOOKMARKS.length; i++) {
            if (Math.abs(BOOKMARKS[i].khz - this._vfo) < STEP_KHZ / 2) return BOOKMARKS[i];
        }
        return null;
    };

    // Jump to the next (dir 1) / previous (dir -1) bookmark by frequency.
    // Returns false at the end of the list.
    FlipSdrDemoScene.prototype._jumpBookmark = function(dir) {
        var vfo = this._vfo, target = null, i;
        if (dir > 0) {
            for (i = 0; i < BOOKMARKS_SORTED.length; i++) {
                if (BOOKMARKS_SORTED[i].khz > vfo + STEP_KHZ / 2) { target = BOOKMARKS_SORTED[i]; break; }
            }
        } else {
            for (i = BOOKMARKS_SORTED.length - 1; i >= 0; i--) {
                if (BOOKMARKS_SORTED[i].khz < vfo - STEP_KHZ / 2) { target = BOOKMARKS_SORTED[i]; break; }
            }
        }
        if (!target) return false;
        return this._setChannel(channelOf(target.khz));
    };

    // X: Frequency ⇄ Bookmark, with the usual 30 ms press flash.
    // Entering Bookmark mode lands on the nearest bookmark.
    FlipSdrDemoScene.prototype._toggleMode = function() {
        var self = this, btn = this._modeBtn;
        btn.press();
        if (window.requestRender) window.requestRender();
        setTimeout(function() {
            btn.release();
            btn.toggle();
            self._mode = btn.toggled ? 'bookmark' : 'frequency';
            if (self._mode === 'bookmark' && !self._activeBookmark()) {
                var best = null;
                BOOKMARKS.forEach(function(b) {
                    if (!best || Math.abs(b.khz - self._vfo) < Math.abs(best.khz - self._vfo)) best = b;
                });
                if (best) self._setChannel(channelOf(best.khz));
            }
            if (window.requestRender) window.requestRender();
        }, 30);
    };

    // Rounded pill, 2 px corners, centred on column `cx` (odd width keeps
    // it symmetric). selected: black; else COL_PILL_OFF gray. White ink
    // either way. `left` / `right` add < / >, `ud` adds ^ and v.
    function drawPill(ctx, cx, y, w, h, text, selected, left, right, ud) {
        var x = cx - (w - 1) / 2;
        var midY = y + (h - 1) / 2;
        ctx.fillStyle = selected ? '#000' : COL_PILL_OFF;
        ctx.fillRect(x + 2, y, w - 4, h);
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
        ctx.fillRect(x, y + 2, w, h - 4);
        var ink = '#fff';
        ctx.fillStyle = ink;
        for (var k = 0; k < 3; k++) {
            if (left) {
                ctx.fillRect(x + 1 + k, midY - k, 1, 1);          // <
                ctx.fillRect(x + 1 + k, midY + k, 1, 1);
            }
            if (right) {
                ctx.fillRect(x + w - 2 - k, midY - k, 1, 1);      // >
                ctx.fillRect(x + w - 2 - k, midY + k, 1, 1);
            }
            if (ud) {
                ctx.fillRect(cx - k, y + 1 + k, 1, 1);            // ^
                ctx.fillRect(cx + k, y + 1 + k, 1, 1);
                ctx.fillRect(cx - k, y + h - 2 - k, 1, 1);        // v
                ctx.fillRect(cx + k, y + h - 2 - k, 1, 1);
            }
        }
        // Haxrcorp ink starts 1 px right of the draw x and is textWidth - 1
        // wide; its 7 ink rows start 2 below the draw y.
        var inkW = HaxrCorp4090FlipCTL.textWidth(text) - 1;
        HaxrCorp4090FlipCTL.draw(ctx, text, cx - 1 - Math.floor((inkW - 1) / 2), midY - 5, ink);
    }

    // Bookmark pills at the top of the spectrum, each with a pointer down
    // onto its frequency. Returns the first row below the pill sitting on
    // the VFO (SPEC_TOP when there is none) so the VFO line starts there.
    FlipSdrDemoScene.prototype._drawBookmarks = function(ctx) {
        var self = this;
        var active = this._activeBookmark();
        var list = BOOKMARKS.map(function(b) {
            var w = HaxrCorp4090FlipCTL.textWidth(b.name) - 1 + 2 * FLAG_PAD;
            if (w % 2 === 0) w += 1;                       // odd → exact centre
            return { b: b, x: self._xOf(b.khz), w: w };
        }).filter(function(f) { return f.x + f.w / 2 >= 0 && f.x - f.w / 2 < 256; });
        // Nearest to the VFO wins a collision.
        list.sort(function(a, b) { return Math.abs(a.x - CX) - Math.abs(b.x - CX); });
        var placed = [];
        list.forEach(function(f) {
            var l = f.x - (f.w - 1) / 2, r = f.x + (f.w - 1) / 2;
            for (var i = 0; i < placed.length; i++) {
                if (l <= placed[i].r + FLAG_GAP && r >= placed[i].l - FLAG_GAP) return;
            }
            placed.push({ l: l, r: r, f: f });
        });
        var below = SPEC_TOP;
        var bookmarkMode = this._mode === 'bookmark' && !isPttHeld();
        placed.forEach(function(pl) {
            var f = pl.f;
            var sel = bookmarkMode && f.b === active;
            // No arrow toward a side with no further bookmark.
            var canL = f.b !== BOOKMARKS_SORTED[0];
            var canR = f.b !== BOOKMARKS_SORTED[BOOKMARKS_SORTED.length - 1];
            drawPill(ctx, f.x, FLAG_Y, f.w, FLAG_H, f.b.name, sel,
                     sel && canL, sel && canR, false);
            // Pointer under the pill: 5, 3, 1 px wide, in the pill's colour.
            ctx.fillStyle = sel ? '#000' : COL_PILL_OFF;
            for (var k = 0; k < FLAG_PTR_H; k++) {
                ctx.fillRect(f.x - (2 - k), FLAG_Y + FLAG_H + k, 5 - 2 * k, 1);
            }
            if (f.x === CX) below = FLAG_Y + FLAG_H + FLAG_PTR_H;
        });
        return below;
    };

    function isPttHeld() {
        return !!(window.input && typeof window.input.isHeld === 'function'
                  && window.input.isHeld('ptt'));
    }

    // PTT edge → strong haptic; pill grow progress eases toward 1 while
    // held and back to 0 after release.
    FlipSdrDemoScene.prototype._updatePill = function(now) {
        var held = isPttHeld();
        if (held && !this._pttWas) playHaptic(PTT_HAPTIC_EFFECT);
        this._pttWas = held;
        var dt = now - (this._pillAt || now);
        this._pillAt = now;
        var step = dt / PILL_GROW_MS;
        var p = this._pillP || 0;
        p = held ? Math.min(1, p + step) : Math.max(0, p - step);
        this._pillP = p;
    };

    // VFO pill, centred on the VFO column / strip centre row (PILL_Y + 4). Size
    // eases with _pillP (smoothstep) while PTT is held; ^ v appear once it
    // is fully grown. Selected (black, < >) in Frequency mode and whenever
    // PTT is held (or the pill is still grown); gray in Bookmark mode.
    FlipSdrDemoScene.prototype._drawPill = function(ctx, text) {
        if (this._fedit) { this._drawFreqEditPill(ctx, text); return; }
        var p = this._pillP || 0;
        var e = p * p * (3 - 2 * p);
        var growX = Math.round(e * (PILL_BIG_W - PILL_W) / 2);
        var growY = Math.round(e * (PILL_BIG_H - PILL_H) / 2);
        var w = PILL_W + 2 * growX, h = PILL_H + 2 * growY;
        var full = growY === (PILL_BIG_H - PILL_H) / 2;
        var sel = this._mode === 'frequency' || isPttHeld() || growY > 0;
        // No arrow toward a band edge already reached.
        var ch = channelOf(this._vfo);
        drawPill(ctx, CX, PILL_Y - growY, w, h, text, sel,
                 sel && ch > CH_MIN, sel && ch < CH_MAX, full);
    };

    // ── Digit entry ─────────────────────────────────────────────────
    // OK on the selected frequency. A digit is picked right away — the
    // 10 kHz one, where air band channels differ (…400 / …425 / …450);
    // left / right move between digits, up / down step the chosen one with
    // carry (133.900 + 100 kHz = 134.000), live — the band follows. A step
    // that would leave the band is refused with a haptic and its triangle
    // is hidden. Select (Scan's slot, the only live button), OK or Back
    // leave entry keeping the frequency.
    FlipSdrDemoScene.prototype._startFreqEdit = function() {
        this._fedit = { digit: DIGIT_KHZ.length - 2 };   // 10 kHz
        this._modeBtn.disabled = true;
        this._editBtn.disabled = true;
        this._scanBtn.text = 'Select';
        if (window.requestRender) window.requestRender();
    };
    FlipSdrDemoScene.prototype._endFreqEdit = function() {
        this._fedit = null;
        this._modeBtn.disabled = false;
        this._editBtn.disabled = false;
        this._scanBtn.text = 'Scan';
        if (window.requestRender) window.requestRender();
    };
    FlipSdrDemoScene.prototype._handleFreqEdit = function(action) {
        var fe = this._fedit, self = this;
        if (action === 'left')  fe.digit = Math.max(0, fe.digit - 1);
        if (action === 'right') fe.digit = Math.min(DIGIT_KHZ.length - 1, fe.digit + 1);
        if (action === 'up' || action === 'down') {
            var dir = action === 'up' ? 1 : -1;
            if (!this._canStepDigit(dir)) playHaptic(3);       // at the band edge: say so, every press
            else { this._setVfoKhz(Math.round(this._vfo) + dir * DIGIT_KHZ[fe.digit]); this._tick(); }
        }
        if (action === 'ok' || action === 'run') {
            // Select: the usual 30 ms press flash, then leave entry.
            this._scanBtn.press();
            setTimeout(function() { self._scanBtn.release(); self._endFreqEdit(); }, 30);
        }
        if (action === 'back' || action === 'esc') this._endFreqEdit();
        if (window.requestRender) window.requestRender();
    };

    // Can the chosen digit step up (dir 1) / down (-1) and stay in the band?
    FlipSdrDemoScene.prototype._canStepDigit = function(dir) {
        var next = Math.round(this._vfo) + dir * DIGIT_KHZ[this._fedit.digit];
        return next >= VFO_MIN_KHZ && next <= VFO_MAX_KHZ;
    };

    // Edit pill: PILL_EDIT_W×PILL_EDIT_H, black, centred on the VFO /
    // strip centre row (PILL_Y + 4); Haxrcorp digits with a filled
    // 5-3-1 triangle above (71..73) and below (83..85) the chosen digit.
    FlipSdrDemoScene.prototype._drawFreqEditPill = function(ctx, text) {
        var midY = PILL_Y + 4;
        var y = midY - (PILL_EDIT_H - 1) / 2;
        drawPill(ctx, CX, y, PILL_EDIT_W, PILL_EDIT_H, '', true, false, false, false);
        var inkW = HaxrCorp4090FlipCTL.textWidth(text) - 1;
        var x0 = CX - 1 - Math.floor((inkW - 1) / 2);
        HaxrCorp4090FlipCTL.draw(ctx, text, x0, PILL_Y - 1, '#fff');
        var d = this._fedit.digit;
        var ci = DIGIT_CHARS[d];
        var gx = x0 + HaxrCorp4090FlipCTL.textWidth(text.slice(0, ci));
        var gw = HaxrCorp4090FlipCTL.textWidth(text.charAt(ci)) - 1;   // ink width
        var cx = gx + 1 + Math.floor((gw - 1) / 2);                    // ink starts 1 px in
        // A triangle only where that digit can still go.
        var up = this._canStepDigit(1), down = this._canStepDigit(-1);
        ctx.fillStyle = '#fff';
        for (var k = 0; k < 3; k++) {
            if (up)   ctx.fillRect(cx - k, midY - 7 + k, 2 * k + 1, 1);    // ▲ 3 rows, 2 above the digits
            if (down) ctx.fillRect(cx - k, midY + 7 - k, 2 * k + 1, 1);    // ▼ 3 rows, 2 below
        }
    };

    function vfoText(khz) {
        return (Math.round(khz) / 1000).toFixed(3);
    }

    FlipSdrDemoScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        var now = Date.now();
        var x, y;

        if (this._running) {
            if (now - this._lastSpec >= SPEC_UPDATE_MS) {
                this._updateSpectrum(now);
                this._lastSpec = now;
            }
            var rowMs = 1000 / WF_ROWS_PER_SEC;
            var rows = 0;
            while (now - this._lastRow >= rowMs && rows < WF_H) {
                this._lastRow += rowMs;
                this._pushRow(this._lastRow);
                rows++;
            }
            if (now - this._lastRow >= rowMs) this._lastRow = now;   // fell far behind
            this._updateLed(now);
            this._maybeShowDolphin(now);
            this._updateAcarsLog(now);
        }

        canvas.clear('#fff');
        if (typeof UI !== 'undefined' && UI.drawStatusBar) UI.drawStatusBar(canvas, '');

        // Title strip.
        var TY = UI.STATUS_BAR_H;
        ctx.fillStyle = COL_STRIP;
        ctx.fillRect(0, TY, canvas.w, TITLE_H);
        // App icon, same slot as the other apps' title strips (14×14 at x=2).
        if (Icons.sdr_icon) canvas.drawSprite(Icons.sdr_icon, 2, TY + 1, '#000');
        Born2bSportyV2FlipCTL.draw(ctx, this.displayName, 19, TY, '#000');
        // Just the band preset; the decoder shows itself in its window.
        var band = 'Airband';
        HaxrCorp4090FlipCTL.draw(ctx, band,
            canvas.w - 2 - HaxrCorp4090FlipCTL.textWidth(band), TY + 3, '#000');
        var pxk = this._pxPerKhz();
        this._drawScaleBar(ctx, pxk, TY);

        // Spectrum: gray fill under the line, then band edges, then the line.
        var ys = new Array(256);
        for (x = 0; x < 256; x++) {
            y = Math.round(FLOOR_Y - this._spec[x] * PX_PER_DB);
            if (y < SPEC_TOP) y = SPEC_TOP;
            if (y > SPEC_BOT) y = SPEC_BOT;
            ys[x] = y;
        }
        ctx.fillStyle = COL_FILL;
        for (x = 0; x < 256; x++) ctx.fillRect(x, ys[x], 1, SPEC_BOT - ys[x] + 1);
        // Filter edges; at wide spans the 8 kHz band is narrower than
        // the VFO line itself, so the edges are left out.
        var half = Math.round(DEMOD_BW_KHZ / 2 * pxk);
        if (half >= 2) {
            ctx.fillStyle = COL_EDGE;
            ctx.fillRect(CX - half, SPEC_TOP, 1, SPEC_BOT - SPEC_TOP + 1);
            ctx.fillRect(CX + half, SPEC_TOP, 1, SPEC_BOT - SPEC_TOP + 1);
        }
        // Squelch threshold: 2 px dashes, 2 px gaps.
        var sqY = Math.round(FLOOR_Y - SQUELCH_DB * PX_PER_DB);
        ctx.fillStyle = '#000';
        for (x = 0; x < 256; x += 4) ctx.fillRect(x, sqY, 2, 1);
        for (x = 0; x < 256; x++) {
            // Join to the previous column so steep peaks stay connected.
            var prev = x > 0 ? ys[x - 1] : ys[x];
            var top = Math.min(prev, ys[x]), bot = Math.max(prev, ys[x]);
            if (bot - top > 1) ctx.fillRect(x, top + 1, 1, bot - top);
            ctx.fillRect(x, ys[x], 1, 1);
        }
        // Bookmark pills on top of the spectrum line.
        var flagBottom = this._drawBookmarks(ctx);
        // VFO line with its pointer onto the pill (starts under a bookmark
        // pill sitting on the VFO so it doesn't cut through its label).
        var vfoTop = Math.max(SPEC_TOP, flagBottom);
        var ptrTop = PILL_Y - 3;                       // 71..73
        ctx.fillStyle = '#000';
        ctx.fillRect(CX, vfoTop, 1, ptrTop - vfoTop);
        ctx.fillRect(CX, ptrTop, 1, 1);
        ctx.fillRect(CX - 1, ptrTop + 1, 3, 1);
        ctx.fillRect(CX - 2, ptrTop + 2, 5, 1);

        // Frequency strip: labels at a round interval for this zoom.
        ctx.fillStyle = COL_SCALE;
        ctx.fillRect(0, SCALE_Y, canvas.w, SCALE_H);
        var labelKhz = LABEL_STEPS_KHZ[LABEL_STEPS_KHZ.length - 1];
        for (var li = 0; li < LABEL_STEPS_KHZ.length; li++) {
            if (LABEL_STEPS_KHZ[li] * pxk >= LABEL_MIN_PX) { labelKhz = LABEL_STEPS_KHZ[li]; break; }
        }
        var spanKhz = (128 + 30) / pxk;
        var first = Math.ceil((this._vfo - spanKhz) / labelKhz) * labelKhz;
        for (var f = first; f <= this._vfo + spanKhz; f += labelKhz) {
            var lx = this._xOf(f);
            var label = (f / 1000).toFixed(3);
            var lw = HaxrCorp4090FlipCTL.textWidth(label);
            // -1: matches the mockup's label positions.
            HaxrCorp4090FlipCTL.draw(ctx, label, lx - Math.floor(lw / 2) - 1, SCALE_Y - 1, '#fff');
        }

        // Waterfall.
        if (this._wf) ctx.drawImage(this._wf, 0, WF_Y);

        // VFO pill on top of strip and waterfall (it overlaps both when grown).
        this._updatePill(now);
        this._drawPill(ctx, vfoText(this._vfo));

        // White fade over the bottom of the waterfall: opacity 0 at
        // FADE_Y → 1 at the bottom edge, so old rows dissolve under the
        // buttons.
        var fade = ctx.createLinearGradient(0, FADE_Y, 0, canvas.h);
        fade.addColorStop(0, 'rgba(255, 255, 255, 0)');
        fade.addColorStop(1, 'rgba(255, 255, 255, 1)');
        ctx.fillStyle = fade;
        ctx.fillRect(0, FADE_Y, canvas.w, canvas.h - FADE_Y);
        for (var b = 0; b < this._btns.length; b++) this._btns[b].render(canvas);
        if (this._logOpen) this._drawAcarsLog(canvas);
        if (this._modal) this._drawModal(canvas);
        if (this._dolphin) this._drawDolphin(canvas);

        // Live display: keep the render loop running.
        if (this._running && window.requestRender) window.requestRender();
    };

    return FlipSdrDemoScene;
})();

/**
 * FlipSdrBandsMenu(sm)
 *
 * What opens first from Testing → Kickstarter demo → 'FlipSDR': the list
 * of band presets. For the demo it holds just Airband (plane icon, range
 * on the right), which opens FlipSdrDemoScene. Back from the receiver
 * returns here.
 */
var FlipSdrBandsMenu = (function() {
    // Power meter LEDs: battery outline and a level-3 usage bar.
    var METER = { battery: 'OUTLINE', usage: 3 };
    var BANDS = [
        { name: 'Airband', range: '118-137 MHz', icon: function() { return Icons.airplane_mode; } }
    ];
    return function(sm) {
        var menu = new SubMenuScene(sm, 'FlipSDR', BANDS.map(function(b) { return b.name; }), {
            'Airband': function() { return new FlipSdrDemoScene(sm); }
        });
        menu.setBreadcrumbTrail(['FlipSDR']);
        // Same meter as the receiver while the band list is on screen.
        var enter = menu.enter, exit = menu.exit;
        menu.enter = function() {
            if (enter) enter.apply(this, arguments);
            PowerMeterLeds.start(METER);
        };
        menu.exit = function() {
            PowerMeterLeds.stop();
            if (exit) exit.apply(this, arguments);
        };
        for (var i = 0; i < BANDS.length; i++) {
            menu.items[i].status = BANDS[i].range;
            menu.items[i].icon   = BANDS[i].icon() || null;
        }
        return menu;
    };
})();
