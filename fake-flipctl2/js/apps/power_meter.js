/**
 * PowerMeterScene
 *
 * Testing → 'Power Meter'. Manual control of the power meter (the
 * MCU's wattmeter LEDs) on stock MCU firmware. Colours go through
 * PowerMeterLeds (the MCU's `led` CLI command over UART); brightness
 * through POST /api/powermeter/brightness (the wattmeter LED group
 * register over I2C).
 *
 *   Brightness      < 0..100% >    the meter's brightness, shared by
 *                                  everything that lights it (the
 *                                  Kickstarter demos too) and kept by
 *                                  the MCU across reboots; 0 = nothing
 *                                  lights. Read from the MCU on enter;
 *                                  written WRITE_DELAY_MS after the
 *                                  last step (it goes to the MCU's
 *                                  flash, so only the final value).
 *   Override        < ON / OFF >   ON: the Kickstarter demos show the
 *                                  rows below instead of their own
 *                                  meter (PowerMeterLeds.setOverride),
 *                                  and the rows keep their values
 *                                  between visits. Kept for the session.
 *   Power Usage     < OFF / 1..7 > the bar next to the battery: the
 *                                  MCU UI demo's discharge ticks, one
 *                                  level per distinct look (up to 8 W
 *                                  they stack green / yellow / orange /
 *                                  red, above that all four show
 *                                  hotter mixes).
 *   Battery         < OFF / OUTLINE / FULL >  outline / outline + bolt.
 *   Power In        < OFF / 1..4 > green USB-C chevrons.
 *   Power Delivery  < ON / OFF >   the plug LED while power comes in:
 *                                  green with PD, yellow without (MCU
 *                                  UI demo).
 *
 * While the page is open the LEDs show the rows. With Override OFF,
 * opening the page switches the meter off: the rows below Override
 * start at OFF (Power Delivery keeps its value). Each change re-sends
 * every LED, and they're re-sent
 * every RESEND_MS while the page is open, in case something else
 * (pm6.sh) wrote over them.
 */
var PowerMeterScene = (function() {
    var BATTERY = ['OFF', 'OUTLINE', 'FULL'];
    var BRIGHTNESS_STEP = 10;                    // %
    var BRIGHTNESS_MAX  = 100;
    var WRITE_DELAY_MS  = 700;
    var RESEND_MS = 3000;

    // Rows; brightness null until read from the MCU.
    var st = { brightness: null, override: false, usage: 0, battery: 0, powerIn: 0, pd: true };
    var writtenBrightness = null;                // % last known to be in the MCU
    var ledError = false, brightnessError = false;
    var writeTimer = null;

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    function meterState() {
        return { battery: BATTERY[st.battery], usage: st.usage,
                 powerIn: st.powerIn, pd: st.pd };
    }

    // Shows the rows, and hands them to the demos while Override is ON.
    function sendLeds() {
        if (st.override) PowerMeterLeds.setOverride(meterState());
        PowerMeterLeds.send(PowerMeterLeds.colors(meterState()),
            function(ok) { ledError = !ok; repaint(); });
    }

    function readBrightness() {
        fetch('/api/powermeter/brightness', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d || !d.ok) throw new Error('read failed');
                var pct = Math.round(d.level * 100 / 255 / BRIGHTNESS_STEP) * BRIGHTNESS_STEP;
                st.brightness = writtenBrightness = pct;
                brightnessError = false;
                repaint();
            })
            .catch(function() {
                // Unknown: start from full so the row still works.
                if (st.brightness === null) st.brightness = BRIGHTNESS_MAX;
                brightnessError = true;
                repaint();
            });
    }

    // Only the last level of a burst of steps reaches the MCU.
    function writeBrightnessSoon() {
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = setTimeout(function() {
            writeTimer = null;
            var pct = st.brightness;
            if (pct === writtenBrightness) return;
            fetch('/api/powermeter/brightness', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ level: Math.round(pct * 255 / 100) })
            })
                .then(function(r) { return r.json(); })
                .then(function(d) {
                    brightnessError = !(d && d.ok);
                    if (!brightnessError) writtenBrightness = pct;
                    repaint();
                })
                .catch(function() { brightnessError = true; repaint(); });
        }, WRITE_DELAY_MS);
    }

    function toggle(item, key) {
        item.statusProvider = function() { return st[key] ? '< ON >' : '< OFF >'; };
        item.onToggle = function() {
            st[key] = !st[key];
            if (key === 'override' && !st.override) PowerMeterLeds.setOverride(null);
            sendLeds();
        };
    }

    function stepper(item, key, max, label) {
        item.statusProvider = function() { return '< ' + label(st[key]) + ' >'; };
        item.onAdjust = function(dir) {
            var v = st[key] + (dir === 'right' ? 1 : -1);
            if (v < 0 || v > max) return;
            st[key] = v;
            sendLeds();
        };
        item.atStart = function() { return st[key] <= 0; };
        item.atEnd = function() { return st[key] >= max; };
    }

    function brightnessRow(item) {
        item.statusProvider = function() {
            if (st.brightness === null) return '...';
            return (brightnessError ? 'Error ' : '') + '< ' + st.brightness + '% >';
        };
        item.onAdjust = function(dir) {
            if (st.brightness === null) return;
            var v = st.brightness + (dir === 'right' ? BRIGHTNESS_STEP : -BRIGHTNESS_STEP);
            if (v < 0 || v > BRIGHTNESS_MAX) return;
            st.brightness = v;
            repaint();
            writeBrightnessSoon();
        };
        item.atStart = function() { return st.brightness !== null && st.brightness <= 0; };
        item.atEnd = function() { return st.brightness !== null && st.brightness >= BRIGHTNESS_MAX; };
    }

    function offOr(v) { return v ? String(v) : 'OFF'; }

    return function PowerMeterScene(sceneManager) {
        var sub = new SubMenuScene(sceneManager, 'Power Meter', [
            'Brightness',
            'Override',
            'Power Usage',
            'Battery',
            'Power In',
            'Power Delivery'
        ], {});
        for (var i = 0; i < sub.items.length; i++) {
            var item = sub.items[i];
            switch (item.text) {
            case 'Brightness':
                brightnessRow(item);
                break;
            case 'Override':
                toggle(item, 'override');
                break;
            case 'Power Usage':
                stepper(item, 'usage', PowerMeterLeds.USAGE_MAX, offOr);
                // A failed LED write shows on the first LED row.
                var status = item.statusProvider;
                item.statusProvider = function() { return (ledError ? 'Error ' : '') + status(); };
                break;
            case 'Battery':
                stepper(item, 'battery', BATTERY.length - 1, function(v) { return BATTERY[v]; });
                break;
            case 'Power In':
                stepper(item, 'powerIn', PowerMeterLeds.IN_MAX, offOr);
                break;
            case 'Power Delivery':
                toggle(item, 'pd');
                break;
            }
        }

        var timer = null;
        var enter = sub.enter, exit = sub.exit;
        sub.enter = function() {
            if (enter) enter.apply(this, arguments);
            // Without Override every visit starts with the meter off.
            if (!st.override) st.usage = st.battery = st.powerIn = 0;
            st.brightness = null;
            sendLeds();
            readBrightness();
            if (!timer) timer = setInterval(sendLeds, RESEND_MS);
        };
        sub.exit = function() {
            if (timer) { clearInterval(timer); timer = null; }
            if (exit) exit.apply(this, arguments);
        };
        return sub;
    };
})();
