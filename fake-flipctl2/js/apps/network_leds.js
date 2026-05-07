/**
 * NetworkLedsScene
 *
 * Live tuning UI for the four physical "Network LEDs" along the
 * top of the device — wifi / eth0 / eth1 / link. One 164×18
 * ResponsiveFrame on screen at any time, showing:
 *
 *   [LED NAME]  R:NNN  G:NNN  B:NNN  ON
 *
 * The LED name on the left is rendered in `Born2bSportyV2Medium`
 * (chunky bitmap font); the value fields use the standard
 * `HaxrcorpFont16`. Five selectable fields total, in this order:
 *   0: LED name     (up/down cycles WIFI → ETH 0 → ETH 1 → LINK)
 *   1: R value      (up/down adjusts 0–255)
 *   2: G value      (up/down adjusts 0–255)
 *   3: B value      (up/down adjusts 0–255)
 *   4: ON / OFF     (up/down toggles)
 *
 * Selected field gets a black filled rectangle behind it, white
 * glyphs on top, and small triangular up/down arrow indicators
 * above and below the frame to advertise the up/down affordance.
 *
 * Per-LED state lives on the scene so each LED keeps its own
 * R/G/B/ON values — switching the LED name doesn't smear values
 * across LEDs. After every change the scene POSTs to
 * /api/led/set so the physical LED follows in real time.
 *
 * Long-press on up/down accelerates the step from ±1 to ±10. We
 * detect this by tracking the timestamp of the first event in a
 * hold (gap > 200 ms = new hold) and scaling once the hold has
 * lasted more than 500 ms.
 *
 * On enter() the scene flips manual mode ON server-side so the
 * auto-state loop (wifi/eth/link drivers) doesn't fight the
 * tuning values. exit() flips it back off and the auto-loop
 * snaps every LED back to its state-driven colour immediately.
 */
var NetworkLedsScene = (function() {
    // Frame geometry. Height + corner radius are fixed; width
    // is adaptive — recomputed each render from the laid-out
    // fields (LED name length varies, value fields all share
    // the same `R:NNN`/`G:NNN`/`B:NNN`/`ON|OFF` widths). The
    // frame ALWAYS centres horizontally on the canvas.
    var FRAME_H = 18;
    var FRAME_Y = 60;     // mid-screen-ish, clears the status bar
    var FRAME_R = 4;

    // Inner padding from the frame's left + right edges.
    var INNER_PAD_L = 5;
    var INNER_PAD_R = 5;
    // Gap (px) between adjacent fields.
    var FIELD_GAP   = 8;

    // Per-field padding — gives the highlight rectangle some
    // breathing room around the text.
    var FIELD_PAD_X = 2;

    // Long-press threshold: hold > this many ms and the step
    // ramps from ±1 to ±10.
    var LONGPRESS_MS  = 500;
    var REPEAT_GAP_MS = 200;

    // LED registry. Order matters — drives the "next LED" cycle.
    // `key` matches the server's /api/led/set vocabulary.
    // `nameDy` is a per-name vertical-render offset to fix
    // glyph alignment quirks in Born2bSportyV2Medium — `LINK`
    // sits visually high vs the other labels, so we drop it
    // 2 px so all four LED labels share a baseline.
    var LEDS = [
        { key: 'wifi', name: 'WIFI',  nameDy: 0 },
        { key: 'eth0', name: 'ETH 0', nameDy: 0 },
        { key: 'eth1', name: 'ETH 1', nameDy: 0 },
        { key: 'link', name: 'LINK',  nameDy: 2 }
    ];

    function NetworkLedsScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Network LEDs';
        this.breadcrumbTitle = 'Network LEDs';

        // Per-LED state. Defaults to a recognisable colour
        // (wifi=blue, eth=green, link=blue) at full output, off.
        // First selection of each LED is "as set in the
        // factory-ish baseline".
        this._ledState = {
            'wifi': { r:   0, g:   0, b: 255, on: false },
            'eth0': { r:   0, g: 255, b:   0, on: false },
            'eth1': { r:   0, g: 255, b:   0, on: false },
            'link': { r:   0, g:   0, b: 255, on: false }
        };

        // Field index into [name, R, G, B, ON]. Starts on the
        // LED name so the user sees what's currently being tuned.
        this._fieldIdx = 0;
        // Index into LEDS — which LED the row is currently
        // displaying.
        this._ledIdx   = 0;

        // Hold tracking for ramp-up. _holdAction = 'up' | 'down'
        // | null. _holdStart = ms when the current hold began.
        // _lastEventTs = ms of the last up/down event seen (used
        // to decide whether a new event is part of the same
        // hold or a fresh tap).
        this._holdAction  = null;
        this._holdStart   = 0;
        this._lastEventTs = 0;
    }

    // Hand-off to the server so the auto-state loop steps aside
    // while we're in this scene. `enabled: true` claims; false
    // releases.
    NetworkLedsScene.prototype._setManualMode = function(enabled) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/led/manual', true);
            xhr.timeout = 3000;
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({ enabled: !!enabled }));
        } catch (e) { /* nothing to do */ }
    };

    // Push the current state of `key` to the device.
    NetworkLedsScene.prototype._pushLed = function(key) {
        var s = this._ledState[key];
        if (!s) return;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/led/set', true);
            xhr.timeout = 3000;
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify({
                led: key, r: s.r, g: s.g, b: s.b, on: s.on
            }));
        } catch (e) { /* ignore */ }
    };

    NetworkLedsScene.prototype.enter = function() {
        // Take over.
        this._setManualMode(true);
        // Push initial state of the currently-displayed LED so
        // the user starts from a known baseline.
        this._pushLed(LEDS[this._ledIdx].key);
    };
    NetworkLedsScene.prototype.exit = function() {
        // Release. Server will snap LEDs back to auto-driven
        // states immediately (applyLedsFromState fires once
        // when manual mode flips off).
        this._setManualMode(false);
    };

    // Compute the step magnitude for an up/down action. ±1 for
    // taps; ±10 once the same direction has been held for more
    // than LONGPRESS_MS.
    NetworkLedsScene.prototype._stepFor = function(action) {
        var now = Date.now();
        var gap = now - this._lastEventTs;
        if (this._holdAction !== action || gap > REPEAT_GAP_MS) {
            // Fresh hold (different direction or finger released
            // and re-pressed past the gap threshold).
            this._holdAction = action;
            this._holdStart  = now;
        }
        this._lastEventTs = now;
        return (now - this._holdStart > LONGPRESS_MS) ? 10 : 1;
    };

    // Apply a delta to whichever value field is active. Wraps
    // for ON (toggle) and LED name (cycle). Clamps for R/G/B.
    NetworkLedsScene.prototype._applyDelta = function(action) {
        var delta = (action === 'up') ? 1 : -1;
        var step  = this._stepFor(action) * delta;
        var key   = LEDS[this._ledIdx].key;
        var s     = this._ledState[key];

        switch (this._fieldIdx) {
            case 0:
                // Cycle LED name. Wrap. Step magnitude doesn't
                // apply — even a long press still walks one LED
                // at a time so the user can land precisely.
                this._ledIdx = (this._ledIdx + delta + LEDS.length) % LEDS.length;
                this._pushLed(LEDS[this._ledIdx].key);
                return;
            case 1:
                s.r += step;
                if (s.r < 0)   s.r = 0;
                if (s.r > 255) s.r = 255;
                break;
            case 2:
                s.g += step;
                if (s.g < 0)   s.g = 0;
                if (s.g > 255) s.g = 255;
                break;
            case 3:
                s.b += step;
                if (s.b < 0)   s.b = 0;
                if (s.b > 255) s.b = 255;
                break;
            case 4:
                // Toggle. Direction doesn't matter, just flip.
                s.on = !s.on;
                break;
        }
        this._pushLed(key);
    };

    NetworkLedsScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'left') {
            this._fieldIdx = (this._fieldIdx - 1 + 5) % 5;
            // Movement breaks any active hold so the next up/down
            // starts a fresh ramp.
            this._holdAction = null;
            return;
        }
        if (action === 'right') {
            this._fieldIdx = (this._fieldIdx + 1) % 5;
            this._holdAction = null;
            return;
        }
        if (action === 'up' || action === 'down') {
            this._applyDelta(action);
            return;
        }
    };

    // Draw a small filled triangle of width `w` and height `h`
    // pointing up (dir = -1) or down (dir = +1), with its tip
    // at (cx, ty).
    function drawTriangle(canvas, cx, ty, w, h, dir, color) {
        // Symmetric base width per row. Triangle is widest at
        // the base, 1 px wide at the tip.
        for (var i = 0; i < h; i++) {
            // Row index along the height. For up-pointing (dir
            // = -1): i=0 is tip (1 px wide), i=h-1 is base
            // (w px wide). For down-pointing (dir = +1): i=0
            // is base, i=h-1 is tip.
            var rowFromTip = (dir < 0) ? i : (h - 1 - i);
            var halfW      = Math.floor((rowFromTip + 1) * (w / 2) / h);
            if (halfW < 0) halfW = 0;
            var rowW = halfW * 2 + 1;
            var rowX = cx - halfW;
            var rowY = ty + i;
            canvas.drawHLine(rowX, rowY, rowW, color);
        }
    }

    NetworkLedsScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // ── Layout (width is adaptive) ─────────────────────────
        // Build the fields list first so we know each one's
        // intrinsic width, sum them up + the gaps + inner pads,
        // and only THEN size + place the frame. As the LED name
        // / value digits change the frame retracts / grows to
        // hug its content, always re-centred horizontally on
        // the canvas.
        var led   = LEDS[this._ledIdx];
        var s     = this._ledState[led.key];
        var name  = led.name;
        var rTxt  = 'R:' + String(s.r);
        var gTxt  = 'G:' + String(s.g);
        var bTxt  = 'B:' + String(s.b);
        var onTxt = s.on ? 'ON' : 'OFF';

        // Each field carries its width; x is filled in once we
        // know the frame's left edge. font drives the renderer
        // in the second pass.
        var fields = [
            { font: 'born2b', text: name,
              w: Born2bSportyV2Medium.textWidth(name),
              dy: led.nameDy || 0 },
            { font: 'haxr',   text: rTxt,
              w: HaxrcorpFont16.textWidth(rTxt) },
            { font: 'haxr',   text: gTxt,
              w: HaxrcorpFont16.textWidth(gTxt) },
            { font: 'haxr',   text: bTxt,
              w: HaxrcorpFont16.textWidth(bTxt) },
            { font: 'haxr',   text: onTxt,
              w: HaxrcorpFont16.textWidth(onTxt) }
        ];

        // Total inner content width: sum of field widths + a gap
        // between every adjacent pair.
        var contentW = 0;
        for (var ci = 0; ci < fields.length; ci++) contentW += fields[ci].w;
        contentW += (fields.length - 1) * FIELD_GAP;

        // Frame width hugs the content + inner pads on both
        // sides; clamp so it never overflows the canvas.
        var frameW = contentW + INNER_PAD_L + INNER_PAD_R;
        if (frameW > 252) frameW = 252;
        var frameX = Math.floor((256 - frameW) / 2);

        // Now lay each field's x relative to the frame's inner
        // left edge.
        var px = frameX + INNER_PAD_L;
        for (var fi = 0; fi < fields.length; fi++) {
            fields[fi].x = px;
            px += fields[fi].w + FIELD_GAP;
        }

        // ── Frame body (rounded corners) ───────────────────────
        var frame = new ResponsiveFrame({
            x: frameX, y: FRAME_Y,
            width: frameW, height: FRAME_H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true,
            fillColor: '#ffffff', showFill: true,
            cornerRadius: FRAME_R,
            corners: { tl: true, tr: true, bl: true, br: true }
        });
        frame.render(canvas);

        // ── Selection highlight (under the text) ──────────────
        var sel = fields[this._fieldIdx];
        var highlightY = FRAME_Y + 2;
        var highlightH = FRAME_H - 4;
        var highlightX = sel.x - FIELD_PAD_X;
        var highlightW = sel.w + FIELD_PAD_X * 2;
        ctx.fillStyle = '#000';
        ctx.fillRect(highlightX, highlightY, highlightW, highlightH);

        // ── Field text ────────────────────────────────────────
        // Born2bSporty's cap sits high inside its 18-row glyph
        // cell. The base draw-y is FRAME_Y + 1 (was -1; the LED
        // titles read as too-high otherwise — the +2 lands them
        // visually centred against the value-text baseline).
        // Per-LED `dy` adds further per-name tuning on top
        // (e.g. LINK still needs its extra nudge to match).
        var textY = FRAME_Y + 4;
        for (var fj = 0; fj < fields.length; fj++) {
            var f  = fields[fj];
            var fg = (fj === this._fieldIdx) ? '#fff' : '#000';
            if (f.font === 'born2b') {
                Born2bSportyV2Medium.draw(ctx, f.text,
                    f.x, FRAME_Y + 1 + (f.dy || 0), fg);
            } else {
                HaxrcorpFont16.draw(ctx, f.text, f.x, textY, fg);
            }
        }

        // ── Up / down chevrons ────────────────────────────────
        var triCx = highlightX + Math.floor(highlightW / 2);
        var triW  = 5;
        var triH  = 3;
        var topTriY    = FRAME_Y - triH - 2;
        var bottomTriY = FRAME_Y + FRAME_H + 2;
        drawTriangle(canvas, triCx, topTriY,    triW, triH, -1, '#000');
        drawTriangle(canvas, triCx, bottomTriY, triW, triH, +1, '#000');
    };

    return NetworkLedsScene;
})();
