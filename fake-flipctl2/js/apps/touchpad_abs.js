var TouchpadAbsScene = (function() {
    var CX0 = 128, CY0 = 78;
    var DIVISOR = 10;

    var es = null;
    var x = 0, y = 0;
    var touching = false;
    var baseX = 0, baseY = 0;
    var strokePX = CX0, strokePY = CY0;
    var plusX = CX0, plusY = CY0;
    var seen = false;

    // Diagnostics (visible on-screen, bottom row).
    var msgCount = 0;       // how many SSE messages onmessage handled
    var renderCount = 0;    // how many times render ran (rAF tick)
    var lastMsgAt = 0;      // last onmessage timestamp (ms)
    var transitions = 0;    // number of touch up/down edges observed

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function TouchpadAbsScene() {}

    TouchpadAbsScene.prototype.enter = function() {
        x = 0; y = 0;
        touching = false;
        baseX = 0; baseY = 0;
        strokePX = CX0; strokePY = CY0;
        plusX = CX0; plusY = CY0;
        seen = false;
        msgCount = 0; renderCount = 0; lastMsgAt = 0; transitions = 0;

        es = new EventSource('/api/touchpad/xy');
        es.onmessage = function(e) {
            var p = e.data.split(',');
            if (p.length < 3) return;
            var nx = +p[0], ny = +p[1], nt = +p[2];
            // Reject any malformed message — one NaN propagates forever
            // through plusX/plusY and silently bricks the scene.
            if (nx !== nx || ny !== ny || (nt !== 0 && nt !== 1)) return;

            var prevTouching = touching;
            if (nt === 1 && !touching) {
                baseX = nx; baseY = ny;
                strokePX = plusX; strokePY = plusY;
            }
            touching = (nt === 1);
            if (touching !== prevTouching) transitions++;

            if (touching) {
                plusX = strokePX + (nx - baseX) / DIVISOR;
                plusY = strokePY + (ny - baseY) / DIVISOR;
            }

            x = nx; y = ny; seen = true;
            msgCount++;
            lastMsgAt = Date.now();
            if (window.requestRender) window.requestRender();
        };
    };

    TouchpadAbsScene.prototype.exit = function() {
        if (es) { es.close(); es = null; }
    };

    TouchpadAbsScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
        if (action === 'ok') {
            plusX = CX0; plusY = CY0;
            strokePX = CX0; strokePY = CY0;
            baseX = x; baseY = y;
            if (window.requestRender) window.requestRender();
        }
    };

    TouchpadAbsScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, 'Touchpad');

        if (!seen) {
            canvas.drawText('waiting for touchpad...', 4, 18, '#000');
            return;
        }

        canvas.drawText('X ' + x + '  Y ' + y, 4, 18, '#000');

        var cx = clamp(Math.round(plusX), 2, 253);
        var cy = clamp(Math.round(plusY), UI.STATUS_BAR_H + 2, 141);
        canvas.drawHLine(cx - 2, cy, 5, '#000');
        canvas.drawVLine(cx, cy - 2, 5, '#000');

        renderCount++;
        var ago = lastMsgAt ? (Date.now() - lastMsgAt) : -1;
        var dbg = 'm:' + msgCount + ' r:' + renderCount +
                  ' tr:' + transitions + ' ago:' + ago + 'ms';
        canvas.drawText(dbg, 4, 134, '#888');
    };

    return TouchpadAbsScene;
})();
