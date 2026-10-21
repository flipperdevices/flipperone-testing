/**
 * PowerMeterLeds
 *
 * The power meter (the MCU's wattmeter LEDs) on stock MCU firmware,
 * shared by Testing → Power Meter and the Kickstarter demo apps.
 * Colours go through POST /api/powermeter (the MCU's `led <n> <colour>`
 * CLI command over UART); brightness is not touched here (Testing →
 * Power Meter sets it).
 *
 * A meter state is { battery: 'OFF' | 'OUTLINE' | 'FULL',
 *                    usage:   0..USAGE_MAX  (bar next to the battery),
 *                    powerIn: 0..IN_MAX     (green USB-C chevrons),
 *                    pd:      bool          (plug green / yellow) };
 * missing fields are off. null = every LED off.
 *
 *   PowerMeterLeds.colors(state)  -> {led: colour} for all LEDs
 *   PowerMeterLeds.send(leds, cb) -> POST once; cb(ok)
 *   PowerMeterLeds.start(state, cb) -> show it and re-send every RESEND_MS
 *                                    (pm6.sh may write over the LEDs);
 *                                    cb(ok) for this first send
 *   PowerMeterLeds.stop()         -> stop re-sending, every LED off
 *                                    (with an override set: the override
 *                                    stays lit instead)
 *   PowerMeterLeds.setOverride(state | null)
 *                                 -> while set, start() shows this state
 *                                    instead of the app's own (Testing →
 *                                    Power Meter → Override)
 *   PowerMeterLeds.getOverride()  -> the override state or null
 *   PowerMeterLeds.setSpikes(pct) -> random usage spikes, 0 (off)..100,
 *                                    for every app (Testing → Power
 *                                    Meter → Spikes); getSpikes() reads it
 *
 * Spikes: while something is shown, every SPIKE_TICK_MS a spike (the
 * usage bar one level up, for 1..2 ticks, then at least one tick back)
 * starts with probability (pct / 100) ^ SPIKE_CURVE — at 100 % the bar
 * flickers non-stop, at 10 % it jumps now and then. Only the 4 usage
 * LEDs are sent for a spike.
 *
 * Demo apps call start() in enter() and stop() in exit(). The "off" of
 * stop() waits a tick and is dropped if start() comes first, so moving
 * between two scenes that both light the meter (exit, then enter of
 * the next) never blinks it off.
 */
var PowerMeterLeds = (function() {
    // MCU CLI colour indices and LED numbers (firmware led_cli.c).
    var RED = 0, GREEN = 1, YELLOW = 3, ORANGE = 4, OFF = 6;
    var LED_OUTLINE = 5;
    var LED_USAGE   = [6, 7, 8, 9];              // battery watt 1..4, 6 next to the battery
    var LED_PLUG    = 10;                        // USB charging
    var LED_IN      = [11, 12, 13, 14];          // USB watt 1..4
    var LED_BOLT    = 15;                        // battery centre
    var ALL_LEDS    = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

    // Usage level → bar (LED 6 first), the MCU UI demo's discharge
    // ticks at 1, 3, 5, 7, 10, 20 and 30 W.
    var USAGE_BARS = [
        null,
        [GREEN, OFF, OFF, OFF],
        [GREEN, YELLOW, OFF, OFF],
        [GREEN, YELLOW, ORANGE, OFF],
        [GREEN, YELLOW, ORANGE, RED],
        [YELLOW, YELLOW, RED, RED],
        [ORANGE, ORANGE, RED, RED],
        [ORANGE, RED, RED, RED]
    ];
    var USAGE_MAX = USAGE_BARS.length - 1;
    var IN_MAX    = LED_IN.length;
    var RESEND_MS = 3000;
    var SPIKE_TICK_MS = 120;
    var SPIKE_CURVE   = 1.5;

    function colors(st) {
        var c = {}, i;
        for (i = 0; i < ALL_LEDS.length; i++) c[ALL_LEDS[i]] = OFF;
        if (!st) return c;
        if (st.battery === 'OUTLINE' || st.battery === 'FULL') c[LED_OUTLINE] = GREEN;
        if (st.battery === 'FULL') c[LED_BOLT] = GREEN;
        var bar = USAGE_BARS[st.usage || 0];
        if (bar) {
            for (i = 0; i < LED_USAGE.length; i++) c[LED_USAGE[i]] = bar[i];
        }
        var n = Math.min(IN_MAX, st.powerIn || 0);
        for (i = 0; i < n; i++) c[LED_IN[i]] = GREEN;
        if (n > 0) c[LED_PLUG] = st.pd ? GREEN : YELLOW;
        return c;
    }

    function send(leds, cb) {
        fetch('/api/powermeter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leds: leds })
        })
            .then(function(r) { return r.json(); })
            .then(function(d) { if (cb) cb(!!(d && d.ok)); })
            .catch(function() { if (cb) cb(false); });
    }

    var active = null;   // state the running app asked for
    var override = null; // state shown instead of it, or null
    var shown = null;    // colours start() keeps re-sending
    var timer = null;
    var stopTimer = null;

    // Spikes (see the header).
    var spikePct = 0;
    var spikeTimer = null;
    var spikeOn = false, spikeLeft = 0;

    // Shows the base colours (no spike).
    function showBase(cb) {
        spikeOn = false;
        spikeLeft = 0;
        send(shown, cb);
    }

    function usageLeds(st) {
        var c = colors(st), out = {};
        for (var i = 0; i < LED_USAGE.length; i++) out[LED_USAGE[i]] = c[LED_USAGE[i]];
        return out;
    }

    function spikeTick() {
        var st = override || active;
        if (!st) return;
        var was = spikeOn;
        if (spikeLeft > 0) {
            spikeLeft--;
        } else if (was) {
            spikeOn = false;
        } else if (Math.random() < Math.pow(spikePct / 100, SPIKE_CURVE)) {
            spikeOn = true;
            spikeLeft = Math.floor(Math.random() * 2);
        }
        if (spikeOn === was) return;
        var up = {};
        for (var k in st) up[k] = st[k];
        up.usage = Math.min(USAGE_MAX, (st.usage || 0) + 1);
        send(usageLeds(spikeOn ? up : st));
    }

    function updateSpikes() {
        var want = spikePct > 0 && !!active;
        if (want && !spikeTimer) {
            spikeTimer = setInterval(spikeTick, SPIKE_TICK_MS);
        } else if (!want && spikeTimer) {
            clearInterval(spikeTimer);
            spikeTimer = null;
            spikeOn = false;
            spikeLeft = 0;
        }
    }

    function start(st, cb) {
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
        active = st;
        shown = colors(override || active);
        showBase(cb);
        if (!timer) {
            timer = setInterval(function() { if (shown) showBase(); }, RESEND_MS);
        }
        updateSpikes();
    }

    function stop() {
        if (timer) { clearInterval(timer); timer = null; }
        active = shown = null;
        updateSpikes();
        if (stopTimer) return;
        stopTimer = setTimeout(function() {
            stopTimer = null;
            send(colors(override));
        }, 0);
    }

    // An app already lighting the meter switches over at once.
    function setOverride(st) {
        override = st || null;
        if (active) {
            shown = colors(override || active);
            showBase();
        }
    }

    function setSpikes(pct) {
        spikePct = Math.max(0, Math.min(100, pct));
        updateSpikes();
        if (!spikePct && active) showBase();
    }

    return {
        setOverride: setOverride,
        getOverride: function() { return override; },
        setSpikes: setSpikes,
        getSpikes: function() { return spikePct; },
        USAGE_MAX: USAGE_MAX,
        IN_MAX: IN_MAX,
        colors: colors,
        send: send,
        start: start,
        stop: stop
    };
})();
