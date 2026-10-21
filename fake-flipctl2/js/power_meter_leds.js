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
 *   PowerMeterLeds.start(state)   -> show it and re-send every RESEND_MS
 *                                    (pm6.sh may write over the LEDs)
 *   PowerMeterLeds.stop()         -> stop re-sending, every LED off
 *                                    (with an override set: the override
 *                                    stays lit instead)
 *   PowerMeterLeds.setOverride(state | null)
 *                                 -> while set, start() shows this state
 *                                    instead of the app's own (Testing →
 *                                    Power Meter → Override)
 *   PowerMeterLeds.getOverride()  -> the override state or null
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

    function start(st) {
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
        active = st;
        shown = colors(override || active);
        send(shown);
        if (!timer) {
            timer = setInterval(function() { if (shown) send(shown); }, RESEND_MS);
        }
    }

    function stop() {
        if (timer) { clearInterval(timer); timer = null; }
        active = shown = null;
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
            send(shown);
        }
    }

    return {
        setOverride: setOverride,
        getOverride: function() { return override; },
        USAGE_MAX: USAGE_MAX,
        IN_MAX: IN_MAX,
        colors: colors,
        send: send,
        start: start,
        stop: stop
    };
})();
