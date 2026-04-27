/**
 * TouchpadTestScene
 *
 * Reads raw events from the FlipperOne touchpad evdev device on the
 * server (see server.js → /api/touchpad) and visualizes them on the
 * 256×144 LCD. The hardware reports:
 *
 *   ABS_X       0..1024     finger X
 *   ABS_Y       0..800      finger Y
 *   ABS_PRESSURE 0..12288   downforce
 *   BTN_TOUCH   0/1         finger present
 *
 * The server keeps a running snapshot plus the X/Y captured at the
 * moment of the most recent BTN_TOUCH=1 (touchdown), so the client
 * can show a per-stroke shift without tracking history itself.
 *
 * Layout:
 *   ┌─ Touchpad Test ────────────────────────────────────────────────┐
 *   │       ┌──────────── 1024 × 800 pad outline ────┐               │
 *   │       │                                        │  Δx -250      │
 *   │       │              ●                         │  Δy +148      │
 *   │       │                                        │  P  1480      │
 *   │       └────────────────────────────────────────┘               │
 *   │     X 680   Y 225   P 1480                                     │
 *   └────────────────────────────────────────────────────────────────┘
 */
var TouchpadTestScene = (function() {
    var POLL_MS  = 33;          // ~30 Hz visualization
    var DOT_R    = 3;           // touch dot radius
    var PAD_FG   = '#000';
    var PAD_BG   = '#FFF';
    var GRID     = '#EEEEEE';
    var TEXT_DIM = '#6D6D6D';

    function TouchpadTestScene() {
        this.state = null;     // last /api/touchpad payload, or null while loading
        this._timer = null;
        this._inFlight = false;
    }

    TouchpadTestScene.prototype.enter = function() {
        var self = this;
        this._fetch();
        this._timer = setInterval(function() { self._fetch(); }, POLL_MS);
    };

    TouchpadTestScene.prototype.exit = function() {
        if (this._timer !== null) {
            clearInterval(this._timer);
            this._timer = null;
        }
    };

    TouchpadTestScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
    };

    // Skip if a previous request is still on the wire — prevents the
    // queue from growing if the server briefly stalls.
    TouchpadTestScene.prototype._fetch = function() {
        if (this._inFlight) return;
        this._inFlight = true;
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/touchpad', true);
        xhr.timeout = 1000;
        xhr.onload = function() {
            self._inFlight = false;
            if (xhr.status !== 200) return;
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
            self.state = data;
            if (typeof window.requestRender === 'function') window.requestRender();
        };
        xhr.onerror = xhr.ontimeout = function() { self._inFlight = false; };
        xhr.send();
    };

    // Filled pixel disc (kept crisp under image-rendering: pixelated).
    function drawDisc(canvas, cx, cy, r, color) {
        canvas.ctx.fillStyle = color;
        var r2 = r * r;
        for (var dy = -r; dy <= r; dy++) {
            for (var dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy <= r2) {
                    canvas.ctx.fillRect(cx + dx, cy + dy, 1, 1);
                }
            }
        }
    }

    // Map a single coord onto a target span. Clamps to the inside of
    // the pad outline so the dot never paints over the border.
    function mapCoord(value, valueMax, originPx, sizePx) {
        var t = valueMax > 0 ? value / valueMax : 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        return originPx + Math.round(t * (sizePx - 1));
    }

    TouchpadTestScene.prototype.render = function(canvas) {
        canvas.clear('#FFF');

        // Title centered along the top.
        var title = 'Touchpad Test';
        var titleW = HaxrcorpFont16.textWidth(title);
        HaxrcorpFont16.draw(canvas.ctx, title,
            Math.floor((canvas.w - titleW) / 2), 2, '#000');

        var s = this.state;

        // Pad outline geometry. We want the visualization to preserve
        // the touchpad's 1024:800 aspect ratio so motion looks natural.
        // Reserve room for the title (10 px) at the top and a coord
        // line (10 px) at the bottom, then fit the largest box that
        // matches 1024:800 inside that area.
        var TOP    = 12;
        var BOT_RESERVE = 12;
        var availH = canvas.h - TOP - BOT_RESERVE;        // 120
        var availW = canvas.w - 8;                        // leave 4 px margin each side
        var padW = availW;
        var padH = Math.floor(padW * 800 / 1024);
        if (padH > availH) {
            padH = availH;
            padW = Math.floor(padH * 1024 / 800);
        }
        var padX = Math.floor((canvas.w - padW) / 2);
        var padY = TOP;

        // Center crosshair (light gray) for visual reference.
        var ccx = padX + Math.floor(padW / 2);
        var ccy = padY + Math.floor(padH / 2);
        canvas.drawHLine(padX + 2, ccy, padW - 4, GRID);
        canvas.drawVLine(ccx, padY + 2, padH - 4, GRID);

        // Pad outline (1 px border).
        canvas.drawFrame(padX, padY, padW, padH, PAD_FG);

        // Status / coord readout — single bottom line. The text shape
        // depends on whether the device is available and whether we
        // currently have a touch.
        var bottomY = canvas.h - 9;
        if (!s) {
            HaxrcorpFont16.draw(canvas.ctx, 'Loading…', 4, bottomY, TEXT_DIM);
            return;
        }
        if (!s.available) {
            var msg = 'Touchpad device not found';
            HaxrcorpFont16.draw(canvas.ctx, msg,
                Math.floor((canvas.w - HaxrcorpFont16.textWidth(msg)) / 2),
                bottomY, TEXT_DIM);
            return;
        }

        // Scale (x,y) into pad rectangle and draw the dot only while
        // the finger is touching. Inset DOT_R+1 from the border so the
        // disc never paints over the pad outline.
        if (s.touching) {
            var inset  = DOT_R + 1;
            var innerW = padW - inset * 2;
            var innerH = padH - inset * 2;
            var dotX = mapCoord(s.x, s.maxX, padX + inset, innerW);
            var dotY = mapCoord(s.y, s.maxY, padY + inset, innerH);
            drawDisc(canvas, dotX, dotY, DOT_R, PAD_FG);

            // Touchdown marker — small hollow ring at the start point
            // so the user can see the start of the stroke too.
            var t0x = mapCoord(s.touchdownX, s.maxX, padX + inset, innerW);
            var t0y = mapCoord(s.touchdownY, s.maxY, padY + inset, innerH);
            // 1px ring of radius 3 (4 corners + 8 sides).
            var ring = [
                [-3, -1], [-3, 0], [-3, 1],
                [ 3, -1], [ 3, 0], [ 3, 1],
                [-1, -3], [0, -3], [1, -3],
                [-1,  3], [0,  3], [1,  3],
                [-2, -2], [2, -2], [-2, 2], [2, 2]
            ];
            canvas.ctx.fillStyle = TEXT_DIM;
            for (var i = 0; i < ring.length; i++) {
                canvas.ctx.fillRect(t0x + ring[i][0], t0y + ring[i][1], 1, 1);
            }
        }

        // Bottom line: live coordinates, delta from touchdown, pressure.
        // Uses two segments separated by gap so the eye can group them.
        var coordStr = 'X ' + s.x + '  Y ' + s.y + '  P ' + s.pressure;
        var dx = s.x - s.touchdownX;
        var dy = s.y - s.touchdownY;
        var sign = function(n) { return (n >= 0 ? '+' : '') + n; };
        var deltaStr = s.touching
            ? ('Δx ' + sign(dx) + '  Δy ' + sign(dy))
            : 'lifted';

        HaxrcorpFont16.draw(canvas.ctx, coordStr, 4, bottomY, '#000');
        var rightW = HaxrcorpFont16.textWidth(deltaStr);
        HaxrcorpFont16.draw(canvas.ctx, deltaStr,
            canvas.w - rightW - 4, bottomY,
            s.touching ? '#000' : TEXT_DIM);
    };

    return TouchpadTestScene;
})();
