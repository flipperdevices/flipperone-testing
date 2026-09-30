/**
 * Testing → 'Screen backlight'. Drives the LCD backlight through
 * /api/backlight (server.js → scripts/mcu-backlight.py → MCU over I2C).
 *
 * Rows:
 *   Screen off  — blanks the screen. The MCU wakes it on any key press;
 *                 that press is swallowed here so it doesn't also act on
 *                 the menu. Failsafe: turned back on after OFF_FAILSAFE_MS
 *                 in case the wake-on-key path doesn't work.
 *   Screen on   — on at the saved level, MCU idle timer restarts.
 *   Brightness  — left/right, 1..255. Debounced: only the value you
 *                 stop on is sent (every write goes to MCU flash).
 *   Auto-off    — left/right through presets, debounced the same way.
 *
 * State (level, timeout) is read on enter and refreshed from every
 * response.
 */
var BacklightTestScene = (function() {
    var LEVEL_STEP      = 15;
    var WRITE_DELAY_MS  = 700;
    var OFF_FAILSAFE_MS = 10000;
    // Auto-off presets in 100 ms steps (MCU units); 0 = never.
    var TIMEOUTS = [0, 50, 100, 300, 600, 3000];

    function timeoutLabel(ds) {
        if (ds === 0) return 'Never';
        var sec = ds / 10;
        if (sec >= 60 && sec % 60 === 0) return (sec / 60) + ' min';
        return sec + ' s';
    }

    function request(method, body, cb) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open(method, '/api/backlight', true);
            xhr.timeout = 8000;
            if (body) xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = function() {
                var d = null;
                try { d = JSON.parse(xhr.responseText); } catch (e) {}
                cb(d || { ok: false, error: 'HTTP ' + xhr.status });
            };
            xhr.onerror = xhr.ontimeout = function() { cb({ ok: false, error: 'network' }); };
            xhr.send(body ? JSON.stringify(body) : null);
        } catch (e) { cb({ ok: false, error: String(e) }); }
    }

    return function BacklightTestScene(sm) {
        var st = { loaded: false, error: null, level: 0, timeout: 0, control: 0 };
        var pendingLevel = null, pendingTimeout = null;
        var levelTimer = null, timeoutTimer = null, failsafeTimer = null;
        var blanked = false;

        function apply(d) {
            if (d && d.ok) {
                st.loaded  = true;
                st.error   = null;
                st.level   = d.level;
                st.timeout = d.timeout;
                st.control = d.control;
            } else {
                st.error = (d && d.error) || 'error';
            }
            if (window.requestRender) window.requestRender();
        }
        function send(body) { request('POST', body, apply); }

        function screenOn() {
            blanked = false;
            if (failsafeTimer) { clearTimeout(failsafeTimer); failsafeTimer = null; }
            send({ action: 'on' });
        }

        var menu = new SubMenuScene(sm, 'Screen backlight', [
            'Screen off',
            'Screen on',
            'Brightness',
            'Auto-off'
        ], {
            'Screen off': function() {
                blanked = true;
                send({ action: 'off' });
                if (failsafeTimer) clearTimeout(failsafeTimer);
                failsafeTimer = setTimeout(function() {
                    failsafeTimer = null;
                    if (blanked) screenOn();
                }, OFF_FAILSAFE_MS);
                return null;
            },
            'Screen on': function() { screenOn(); return null; }
        });

        function row(name) { return menu.items[menu.itemNames.indexOf(name)]; }
        function stateStatus(fn) {
            return function() {
                if (st.error) return 'Error';
                if (!st.loaded) return '...';
                return fn();
            };
        }

        var bright = row('Brightness');
        bright.statusProvider = stateStatus(function() {
            return '< ' + (pendingLevel !== null ? pendingLevel : st.level) + ' >';
        });
        bright.onAdjust = function(dir) {
            if (!st.loaded) return;
            var cur = pendingLevel !== null ? pendingLevel : st.level;
            var next = Math.max(1, Math.min(255, cur + (dir === 'right' ? LEVEL_STEP : -LEVEL_STEP)));
            if (next === cur) return;
            pendingLevel = next;
            if (levelTimer) clearTimeout(levelTimer);
            levelTimer = setTimeout(function() {
                levelTimer = null;
                var v = pendingLevel;
                pendingLevel = null;
                if (v !== st.level) { st.level = v; send({ level: v }); }
            }, WRITE_DELAY_MS);
        };

        var autoOff = row('Auto-off');
        autoOff.statusProvider = stateStatus(function() {
            return '< ' + timeoutLabel(pendingTimeout !== null ? pendingTimeout : st.timeout) + ' >';
        });
        autoOff.onAdjust = function(dir) {
            if (!st.loaded) return;
            var cur = pendingTimeout !== null ? pendingTimeout : st.timeout;
            // Nearest preset at or past the current value in the step direction.
            var i, next = cur;
            if (dir === 'right') {
                for (i = 0; i < TIMEOUTS.length; i++) if (TIMEOUTS[i] > cur) { next = TIMEOUTS[i]; break; }
            } else {
                for (i = TIMEOUTS.length - 1; i >= 0; i--) if (TIMEOUTS[i] < cur) { next = TIMEOUTS[i]; break; }
            }
            if (next === cur) return;
            pendingTimeout = next;
            if (timeoutTimer) clearTimeout(timeoutTimer);
            timeoutTimer = setTimeout(function() {
                timeoutTimer = null;
                var v = pendingTimeout;
                pendingTimeout = null;
                if (v !== st.timeout) { st.timeout = v; send({ timeout: v }); }
            }, WRITE_DELAY_MS);
        };

        // While blanked, the key that woke the screen (MCU side) is
        // swallowed so it doesn't also move or press anything here.
        var baseInput = menu.handleInput;
        menu.handleInput = function(action) {
            if (blanked) { screenOn(); return; }
            return baseInput.call(menu, action);
        };

        var baseEnter = menu.enter;
        menu.enter = function() {
            if (baseEnter) baseEnter.apply(menu, arguments);
            request('GET', null, apply);
        };

        // Leaving: flush pending writes, never leave the screen dark.
        var baseExit = menu.exit;
        menu.exit = function() {
            if (levelTimer) { clearTimeout(levelTimer); levelTimer = null; }
            if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
            if (pendingLevel !== null && pendingLevel !== st.level) send({ level: pendingLevel });
            if (pendingTimeout !== null && pendingTimeout !== st.timeout) send({ timeout: pendingTimeout });
            pendingLevel = pendingTimeout = null;
            if (blanked) screenOn();
            if (baseExit) baseExit.apply(menu, arguments);
        };

        return menu;
    };
})();
