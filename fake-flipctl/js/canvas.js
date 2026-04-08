var FlipCanvas = (function() {
    function FlipCanvas(canvasEl) {
        this.el = canvasEl;
        this.w = 256;
        this.h = 144;
        this.ctx = canvasEl.getContext('2d');
        this.ctx.imageSmoothingEnabled = false;
    }

    FlipCanvas.prototype.clear = function(color) {
        this.ctx.fillStyle = color || '#000';
        this.ctx.fillRect(0, 0, this.w, this.h);
    };

    FlipCanvas.prototype.drawRect = function(x, y, w, h, color) {
        this.ctx.fillStyle = color || '#fff';
        this.ctx.fillRect(x, y, w, h);
    };

    FlipCanvas.prototype.drawFrame = function(x, y, w, h, color) {
        this.ctx.fillStyle = color || '#fff';
        this.ctx.fillRect(x, y, w, 1);
        this.ctx.fillRect(x, y + h - 1, w, 1);
        this.ctx.fillRect(x, y, 1, h);
        this.ctx.fillRect(x + w - 1, y, 1, h);
    };

    FlipCanvas.prototype.drawHLine = function(x, y, w, color) {
        this.ctx.fillStyle = color || '#fff';
        this.ctx.fillRect(x, y, w, 1);
    };

    FlipCanvas.prototype.drawVLine = function(x, y, h, color) {
        this.ctx.fillStyle = color || '#fff';
        this.ctx.fillRect(x, y, 1, h);
    };

    FlipCanvas.prototype.drawPixel = function(x, y, color) {
        this.ctx.fillStyle = color || '#fff';
        this.ctx.fillRect(x, y, 1, 1);
    };

    // Shared button constants
    var BTN_H = 17;
    var BTN_R = 2;

    function _btnColors(pressed) {
        return { bg: pressed ? '#000' : '#EAEAEA', fg: pressed ? '#fff' : '#000' };
    }
    function _btnText(ctx, text, x, w, y, fg) {
        var tw = HaxrcorpFont16.textWidth(text);
        var tx = x + Math.floor((w - tw) / 2);
        var ty = y + Math.floor((BTN_H - 11) / 2);
        HaxrcorpFont16.draw(ctx, text, tx, ty, fg);
    }

    // Middle button — both top corners rounded
    FlipCanvas.prototype.drawMiddleButton = function(text, x, w, pressed) {
        var y = this.h - BTN_H;
        var c = _btnColors(pressed);
        this.ctx.fillStyle = c.bg;
        this.ctx.fillRect(x + BTN_R, y,          w - BTN_R * 2, BTN_H);
        this.ctx.fillRect(x,         y + BTN_R,  BTN_R,         BTN_H - BTN_R);
        this.ctx.fillRect(x + w - BTN_R, y + BTN_R, BTN_R,     BTN_H - BTN_R);
        this.ctx.fillRect(x + 1,     y + 1, 1, 1);  // top-left
        this.ctx.fillRect(x + w - 2, y + 1, 1, 1);  // top-right
        _btnText(this.ctx, text, x, w, y, c.fg);
    };

    // Left button — flush with left screen edge, only top-right corner rounded
    FlipCanvas.prototype.drawLeftButton = function(text, x, w, pressed) {
        var y = this.h - BTN_H;
        var c = _btnColors(pressed);
        this.ctx.fillStyle = c.bg;
        this.ctx.fillRect(x,             y,         w - BTN_R, BTN_H);
        this.ctx.fillRect(x + w - BTN_R, y + BTN_R, BTN_R,    BTN_H - BTN_R);
        this.ctx.fillRect(x + w - 2,     y + 1, 1, 1);  // top-right corner pixel
        _btnText(this.ctx, text, x, w, y, c.fg);
    };

    // Right button — flush with right screen edge, only top-left corner rounded
    FlipCanvas.prototype.drawRightButton = function(text, x, w, pressed) {
        var y = this.h - BTN_H;
        var c = _btnColors(pressed);
        this.ctx.fillStyle = c.bg;
        this.ctx.fillRect(x + BTN_R, y,        w - BTN_R, BTN_H);
        this.ctx.fillRect(x,         y + BTN_R, BTN_R,    BTN_H - BTN_R);
        this.ctx.fillRect(x + 1,     y + 1, 1, 1);  // top-left corner pixel
        _btnText(this.ctx, text, x, w, y, c.fg);
    };

    // drawRoundRect(x, y, w, h, r, color) — filled rounded rect, r: 2 or 3
    FlipCanvas.prototype.drawRoundRect = function(x, y, w, h, r, color) {
        this.ctx.fillStyle = color || '#fff';
        this.ctx.fillRect(x + r, y,     w - r * 2, h);      // center column
        this.ctx.fillRect(x,     y + r, r, h - r * 2);      // left strip
        this.ctx.fillRect(x + w - r, y + r, r, h - r * 2);  // right strip
        if (r === 2) {
            this.ctx.fillRect(x + 1,     y + 1,     1, 1);
            this.ctx.fillRect(x + w - 2, y + 1,     1, 1);
            this.ctx.fillRect(x + 1,     y + h - 2, 1, 1);
            this.ctx.fillRect(x + w - 2, y + h - 2, 1, 1);
        } else if (r === 3) {
            this.ctx.fillRect(x + 2,     y + 1,     1, 1);
            this.ctx.fillRect(x + 1,     y + 2,     1, 1);
            this.ctx.fillRect(x + w - 3, y + 1,     1, 1);
            this.ctx.fillRect(x + w - 2, y + 2,     1, 1);
            this.ctx.fillRect(x + 2,     y + h - 2, 1, 1);
            this.ctx.fillRect(x + 1,     y + h - 3, 1, 1);
            this.ctx.fillRect(x + w - 3, y + h - 2, 1, 1);
            this.ctx.fillRect(x + w - 2, y + h - 3, 1, 1);
        }
    };

    // drawRoundFrame(x, y, w, h, r) — r: 2 or 3
    FlipCanvas.prototype.drawRoundFrame = function(x, y, w, h, r, color) {
        this.ctx.fillStyle = color || '#fff';
        this.ctx.fillRect(x + r, y,         w - r * 2, 1);  // top
        this.ctx.fillRect(x + r, y + h - 1, w - r * 2, 1);  // bottom
        this.ctx.fillRect(x,         y + r, 1, h - r * 2);  // left
        this.ctx.fillRect(x + w - 1, y + r, 1, h - r * 2);  // right
        if (r === 2) {
            this.ctx.fillRect(x + 1,     y + 1,     1, 1);
            this.ctx.fillRect(x + w - 2, y + 1,     1, 1);
            this.ctx.fillRect(x + 1,     y + h - 2, 1, 1);
            this.ctx.fillRect(x + w - 2, y + h - 2, 1, 1);
        } else if (r === 3) {
            this.ctx.fillRect(x + 2,     y + 1,     1, 1);
            this.ctx.fillRect(x + 1,     y + 2,     1, 1);
            this.ctx.fillRect(x + w - 3, y + 1,     1, 1);
            this.ctx.fillRect(x + w - 2, y + 2,     1, 1);
            this.ctx.fillRect(x + 2,     y + h - 2, 1, 1);
            this.ctx.fillRect(x + 1,     y + h - 3, 1, 1);
            this.ctx.fillRect(x + w - 3, y + h - 2, 1, 1);
            this.ctx.fillRect(x + w - 2, y + h - 3, 1, 1);
        }
    };

    FlipCanvas.prototype.drawText = function(text, x, y, color, scale) {
        BitmapFont.draw(this.ctx, text, x, y, color || '#fff', scale);
    };

    FlipCanvas.prototype.textWidth = function(text, scale) {
        return BitmapFont.textWidth(text, scale);
    };

    // drawPopupLeft(x, y, bodyW, bodyH, tabW, bg, tabBg, fg)
    // Popup with two rectangles: body (top, TL/TR/BR rounded r=4, BL square)
    // and tab (bottom, BL/BR rounded r=4, TL/TR square).
    // Body: white (#fff), Tab: darker (#D0D0D0)
    FlipCanvas.prototype.drawPopupLeft = function(x, y, bodyW, bodyH, tabW, bg, tabBg, fg) {
        var TAB_H = 17;
        var R = 4;
        var ctx = this.ctx;

        // ── Body Fill ────────────────────────────────────────────────────────
        ctx.fillStyle = bg;

        // Body main rectangles
        ctx.fillRect(x + R, y, bodyW - R * 2, bodyH);           // top/center (without rounded corners)
        ctx.fillRect(x, y + R, R, bodyH - R);                   // left edge (straight)
        ctx.fillRect(x + bodyW - R, y + R, R, bodyH - R * 2);   // right edge (TR and BR space)

        // Body corner fill pixels (r=4)
        // TL corner
        ctx.fillRect(x + 3, y, 1, 1);
        ctx.fillRect(x + 2, y + 1, 1, 1);
        ctx.fillRect(x + 3, y + 1, 1, 1);
        ctx.fillRect(x + 1, y + 2, 1, 1);
        ctx.fillRect(x + 2, y + 2, 1, 1);
        ctx.fillRect(x + 3, y + 2, 1, 1);
        ctx.fillRect(x, y + 3, 1, 1);
        ctx.fillRect(x + 1, y + 3, 1, 1);
        ctx.fillRect(x + 2, y + 3, 1, 1);
        ctx.fillRect(x + 3, y + 3, 1, 1);
        // TR corner (mirror TL)
        ctx.fillRect(x + bodyW - 4, y, 1, 1);
        ctx.fillRect(x + bodyW - 3, y + 1, 1, 1);
        ctx.fillRect(x + bodyW - 4, y + 1, 1, 1);
        ctx.fillRect(x + bodyW - 2, y + 2, 1, 1);
        ctx.fillRect(x + bodyW - 3, y + 2, 1, 1);
        ctx.fillRect(x + bodyW - 4, y + 2, 1, 1);
        ctx.fillRect(x + bodyW - 1, y + 3, 1, 1);
        ctx.fillRect(x + bodyW - 2, y + 3, 1, 1);
        ctx.fillRect(x + bodyW - 3, y + 3, 1, 1);
        ctx.fillRect(x + bodyW - 4, y + 3, 1, 1);
        // BR corner (180 rotation of TL)
        ctx.fillRect(x + bodyW - 4, y + bodyH - 4, 1, 1);
        ctx.fillRect(x + bodyW - 3, y + bodyH - 4, 1, 1);
        ctx.fillRect(x + bodyW - 2, y + bodyH - 4, 1, 1);
        ctx.fillRect(x + bodyW - 1, y + bodyH - 4, 1, 1);
        ctx.fillRect(x + bodyW - 4, y + bodyH - 3, 1, 1);
        ctx.fillRect(x + bodyW - 3, y + bodyH - 3, 1, 1);
        ctx.fillRect(x + bodyW - 2, y + bodyH - 3, 1, 1);
        ctx.fillRect(x + bodyW - 4, y + bodyH - 2, 1, 1);
        ctx.fillRect(x + bodyW - 3, y + bodyH - 2, 1, 1);
        ctx.fillRect(x + bodyW - 4, y + bodyH - 1, 1, 1);

        // ── Tab Fill ────────────────────────────────────────────────────────
        ctx.fillStyle = tabBg;

        // Tab main rectangles
        ctx.fillRect(x + R, y + bodyH, tabW - R * 2, TAB_H);    // center/bottom
        ctx.fillRect(x, y + bodyH, R, TAB_H - R);               // left edge (TL square)
        ctx.fillRect(x + tabW - R, y + bodyH, R, TAB_H - R);    // right edge (TR square)

        // Tab corner fill pixels (r=4)
        // BL corner (inverted vertically from TL)
        ctx.fillRect(x, y + bodyH + TAB_H - 4, 1, 1);
        ctx.fillRect(x + 1, y + bodyH + TAB_H - 4, 1, 1);
        ctx.fillRect(x + 2, y + bodyH + TAB_H - 4, 1, 1);
        ctx.fillRect(x + 3, y + bodyH + TAB_H - 4, 1, 1);
        ctx.fillRect(x + 1, y + bodyH + TAB_H - 3, 1, 1);
        ctx.fillRect(x + 2, y + bodyH + TAB_H - 3, 1, 1);
        ctx.fillRect(x + 3, y + bodyH + TAB_H - 3, 1, 1);
        ctx.fillRect(x + 2, y + bodyH + TAB_H - 2, 1, 1);
        ctx.fillRect(x + 3, y + bodyH + TAB_H - 2, 1, 1);
        ctx.fillRect(x + 3, y + bodyH + TAB_H - 1, 1, 1);
        // BR corner (inverted vertically from TR)
        ctx.fillRect(x + tabW - 4, y + bodyH + TAB_H - 4, 1, 1);
        ctx.fillRect(x + tabW - 3, y + bodyH + TAB_H - 4, 1, 1);
        ctx.fillRect(x + tabW - 2, y + bodyH + TAB_H - 4, 1, 1);
        ctx.fillRect(x + tabW - 1, y + bodyH + TAB_H - 4, 1, 1);
        ctx.fillRect(x + tabW - 4, y + bodyH + TAB_H - 3, 1, 1);
        ctx.fillRect(x + tabW - 3, y + bodyH + TAB_H - 3, 1, 1);
        ctx.fillRect(x + tabW - 2, y + bodyH + TAB_H - 3, 1, 1);
        ctx.fillRect(x + tabW - 4, y + bodyH + TAB_H - 2, 1, 1);
        ctx.fillRect(x + tabW - 3, y + bodyH + TAB_H - 2, 1, 1);
        ctx.fillRect(x + tabW - 4, y + bodyH + TAB_H - 1, 1, 1);

        // ── Body Border ──────────────────────────────────────────────────────
        ctx.fillStyle = fg;

        // TL corner outline (r=4)
        ctx.fillRect(x + 3, y, 1, 1);
        ctx.fillRect(x + 2, y + 1, 1, 1);
        ctx.fillRect(x + 1, y + 2, 1, 1);
        ctx.fillRect(x, y + 3, 1, 1);

        // Top edge
        ctx.fillRect(x + 4, y, bodyW - 8, 1);

        // TR corner outline (r=4)
        ctx.fillRect(x + bodyW - 4, y, 1, 1);
        ctx.fillRect(x + bodyW - 3, y + 1, 1, 1);
        ctx.fillRect(x + bodyW - 2, y + 2, 1, 1);
        ctx.fillRect(x + bodyW - 1, y + 3, 1, 1);

        // Right edge of body
        ctx.fillRect(x + bodyW - 1, y + 4, 1, bodyH - 8);

        // BR corner outline (r=4)
        ctx.fillRect(x + bodyW - 1, y + bodyH - 4, 1, 1);
        ctx.fillRect(x + bodyW - 2, y + bodyH - 3, 1, 1);
        ctx.fillRect(x + bodyW - 3, y + bodyH - 2, 1, 1);
        ctx.fillRect(x + bodyW - 4, y + bodyH - 1, 1, 1);

        // Bottom edge of body (right part, after tab)
        if (bodyW > tabW) {
            ctx.fillRect(x + tabW + 1, y + bodyH - 1, bodyW - tabW - 5, 1);
        }

        // Inner corner
        ctx.fillRect(x + tabW, y + bodyH, 1, 1);

        // Left edge of body
        ctx.fillRect(x, y + 4, 1, bodyH - 4);

        // ── Tab Border ───────────────────────────────────────────────────────

        // BL corner outline (r=4)
        ctx.fillRect(x, y + bodyH + TAB_H - 4, 1, 1);
        ctx.fillRect(x + 1, y + bodyH + TAB_H - 3, 1, 1);
        ctx.fillRect(x + 2, y + bodyH + TAB_H - 2, 1, 1);
        ctx.fillRect(x + 3, y + bodyH + TAB_H - 1, 1, 1);

        // Bottom edge of tab
        ctx.fillRect(x + 4, y + bodyH + TAB_H - 1, tabW - 8, 1);

        // BR corner outline (r=4)
        ctx.fillRect(x + tabW - 4, y + bodyH + TAB_H - 1, 1, 1);
        ctx.fillRect(x + tabW - 3, y + bodyH + TAB_H - 2, 1, 1);
        ctx.fillRect(x + tabW - 2, y + bodyH + TAB_H - 3, 1, 1);
        ctx.fillRect(x + tabW - 1, y + bodyH + TAB_H - 4, 1, 1);

        // Right edge of tab
        ctx.fillRect(x + tabW - 1, y + bodyH + 1, 1, TAB_H - 5);

        // Left edge of tab
        ctx.fillRect(x, y + bodyH, 1, TAB_H - 4);
    };

    return FlipCanvas;
})();
