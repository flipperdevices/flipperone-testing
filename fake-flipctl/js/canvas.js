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
    var BTN_H = 14;
    var BTN_R = 4;

    function _btnColors(pressed) {
        return { bg: pressed ? '#000' : '#EAEAEA', fg: pressed ? '#fff' : '#000' };
    }
    function _btnText(ctx, text, x, w, y, fg) {
        var tw = HaxrcorpFont16.textWidth(text);
        var tx = x + Math.floor((w - tw) / 2);
        var ty = y + 2;  // 2px top padding
        HaxrcorpFont16.draw(ctx, text, tx, ty, fg);
    }

    // Middle button — both top corners rounded
    FlipCanvas.prototype.drawMiddleButton = function(text, x, w, pressed, disabled) {
        var y = this.h - BTN_H;
        var c = disabled ? { bg: '#CCC', fg: '#999' } : _btnColors(pressed);
        this.ctx.fillStyle = c.bg;
        // Fill main areas (4px radius)
        this.ctx.fillRect(x + 3, y,      w - 6, 1);         // Row 0: 4px from edges
        this.ctx.fillRect(x + 2, y + 1,  w - 4, 1);         // Row 1: 3px from edges
        this.ctx.fillRect(x + 1, y + 2,  w - 2, 1);         // Row 2: 2px from edges
        this.ctx.fillRect(x,     y + 3,  w,     1);         // Row 3: 1px from edges
        this.ctx.fillRect(x,     y + 4,  w,     BTN_H - 4); // Rows 4+: full width

        // Draw 1px border pixels on top of fill (always black)
        this.ctx.fillStyle = '#000';
        // Top border (full width)
        this.ctx.fillRect(x + 3, y, w - 6, 1);
        // Left border corner pixels
        this.ctx.fillRect(x + 2, y + 1, 1, 1);
        this.ctx.fillRect(x + 1, y + 2, 1, 1);
        // Left border straight
        this.ctx.fillRect(x, y + 3, 1, BTN_H - 3);
        // Right border corner pixels
        this.ctx.fillRect(x + w - 3, y + 1, 1, 1);
        this.ctx.fillRect(x + w - 2, y + 2, 1, 1);
        // Right border straight
        this.ctx.fillRect(x + w - 1, y + 3, 1, BTN_H - 3);

        _btnText(this.ctx, text, x, w, y, c.fg);
    };

    // Left button — flush with left screen edge, only top-right corner rounded
    FlipCanvas.prototype.drawLeftButton = function(text, x, w, pressed, disabled) {
        var y = this.h - BTN_H;
        var c = disabled ? { bg: '#CCC', fg: '#999' } : _btnColors(pressed);
        this.ctx.fillStyle = c.bg;
        // Fill main areas (4px right radius)
        this.ctx.fillRect(x,     y,      w - 3, 1);         // Row 0: 4px from right
        this.ctx.fillRect(x,     y + 1,  w - 2, 1);         // Row 1: 3px from right
        this.ctx.fillRect(x,     y + 2,  w - 1, 1);         // Row 2: 2px from right
        this.ctx.fillRect(x,     y + 3,  w,     1);         // Row 3: 1px from right
        this.ctx.fillRect(x,     y + 4,  w,     BTN_H - 4); // Rows 4+: full width

        // Draw 1px border (no left border, always black)
        this.ctx.fillStyle = '#000';
        // Top border (no left corner)
        this.ctx.fillRect(x, y, w - 3, 1);
        // Right border corner pixels
        this.ctx.fillRect(x + w - 3, y + 1, 1, 1);
        this.ctx.fillRect(x + w - 2, y + 2, 1, 1);
        // Right border straight
        this.ctx.fillRect(x + w - 1, y + 3, 1, BTN_H - 3);

        _btnText(this.ctx, text, x, w, y, c.fg);
    };

    // Right button — flush with right screen edge, only top-left corner rounded
    FlipCanvas.prototype.drawRightButton = function(text, x, w, pressed, disabled) {
        var y = this.h - BTN_H;
        var c = disabled ? { bg: '#CCC', fg: '#999' } : _btnColors(pressed);
        this.ctx.fillStyle = c.bg;
        // Fill main areas (4px left radius)
        this.ctx.fillRect(x + 3, y,      w - 3, 1);         // Row 0: 4px from left
        this.ctx.fillRect(x + 2, y + 1,  w - 2, 1);         // Row 1: 3px from left
        this.ctx.fillRect(x + 1, y + 2,  w - 1, 1);         // Row 2: 2px from left
        this.ctx.fillRect(x,     y + 3,  w,     1);         // Row 3: 1px from left
        this.ctx.fillRect(x,     y + 4,  w,     BTN_H - 4); // Rows 4+: full width

        // Draw 1px border (no right border, always black)
        this.ctx.fillStyle = '#000';
        // Top border (no right corner)
        this.ctx.fillRect(x + 3, y, w - 3, 1);
        // Left border corner pixels
        this.ctx.fillRect(x + 2, y + 1, 1, 1);
        this.ctx.fillRect(x + 1, y + 2, 1, 1);
        // Left border straight
        this.ctx.fillRect(x, y + 3, 1, BTN_H - 3);

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

    // drawInputField(x, y, w, h, r, bgColor, borderColor)
    // Input field with rounded corners (r=3)
    // Simple bordered rectangle for text input
    FlipCanvas.prototype.drawInputField = function(x, y, w, h, r, bgColor, borderColor) {
        var ctx = this.ctx;

        // ── Fill ──────────────────────────────────────────────────────────────
        ctx.fillStyle = bgColor;

        // Main rectangles
        ctx.fillRect(x + r, y, w - r * 2, h);           // center
        ctx.fillRect(x, y + r, r, h - r * 2);           // left edge
        ctx.fillRect(x + w - r, y + r, r, h - r * 2);   // right edge

        // Corner pixels (r=3)
        // Top-left
        ctx.fillRect(x + 2, y, 1, 1);
        ctx.fillRect(x + 1, y + 1, 1, 1);
        ctx.fillRect(x + 2, y + 1, 1, 1);
        ctx.fillRect(x, y + 2, 1, 1);
        ctx.fillRect(x + 1, y + 2, 1, 1);
        ctx.fillRect(x + 2, y + 2, 1, 1);

        // Top-right (mirror)
        ctx.fillRect(x + w - 3, y, 1, 1);
        ctx.fillRect(x + w - 2, y + 1, 1, 1);
        ctx.fillRect(x + w - 3, y + 1, 1, 1);
        ctx.fillRect(x + w - 1, y + 2, 1, 1);
        ctx.fillRect(x + w - 2, y + 2, 1, 1);
        ctx.fillRect(x + w - 3, y + 2, 1, 1);

        // Bottom-left (inverted)
        ctx.fillRect(x, y + h - 3, 1, 1);
        ctx.fillRect(x + 1, y + h - 3, 1, 1);
        ctx.fillRect(x + 2, y + h - 3, 1, 1);
        ctx.fillRect(x + 1, y + h - 2, 1, 1);
        ctx.fillRect(x + 2, y + h - 2, 1, 1);
        ctx.fillRect(x + 2, y + h - 1, 1, 1);

        // Bottom-right (mirror)
        ctx.fillRect(x + w - 1, y + h - 3, 1, 1);
        ctx.fillRect(x + w - 2, y + h - 3, 1, 1);
        ctx.fillRect(x + w - 3, y + h - 3, 1, 1);
        ctx.fillRect(x + w - 2, y + h - 2, 1, 1);
        ctx.fillRect(x + w - 3, y + h - 2, 1, 1);
        ctx.fillRect(x + w - 3, y + h - 1, 1, 1);

        // ── Border ────────────────────────────────────────────────────────────
        ctx.fillStyle = borderColor;

        // Top-left corner outline (r=3)
        ctx.fillRect(x + 2, y, 1, 1);
        ctx.fillRect(x + 1, y + 1, 1, 1);
        ctx.fillRect(x, y + 2, 1, 1);

        // Top edge
        ctx.fillRect(x + 3, y, w - 6, 1);

        // Top-right corner outline
        ctx.fillRect(x + w - 3, y, 1, 1);
        ctx.fillRect(x + w - 2, y + 1, 1, 1);
        ctx.fillRect(x + w - 1, y + 2, 1, 1);

        // Right edge
        ctx.fillRect(x + w - 1, y + 3, 1, h - 6);

        // Bottom-right corner outline
        ctx.fillRect(x + w - 1, y + h - 3, 1, 1);
        ctx.fillRect(x + w - 2, y + h - 2, 1, 1);
        ctx.fillRect(x + w - 3, y + h - 1, 1, 1);

        // Bottom edge
        ctx.fillRect(x + 3, y + h - 1, w - 6, 1);

        // Bottom-left corner outline
        ctx.fillRect(x, y + h - 3, 1, 1);
        ctx.fillRect(x + 1, y + h - 2, 1, 1);
        ctx.fillRect(x + 2, y + h - 1, 1, 1);

        // Left edge
        ctx.fillRect(x, y + 3, 1, h - 6);
    };

    // drawTabHeader(x, y, w, h)
    // Tab header with rounded top corners (r=4)
    // Solid black fill with white text
    FlipCanvas.prototype.drawTabHeader = function(x, y, w, h) {
        var R = 4;
        var ctx = this.ctx;

        ctx.fillStyle = '#000';

        // Main rectangles
        ctx.fillRect(x + R, y, w - R * 2, h);           // center
        ctx.fillRect(x, y + R, R, h - R);               // left edge
        ctx.fillRect(x + w - R, y + R, R, h - R);       // right edge

        // Top-left corner pixels (r=4)
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

        // Top-right corner pixels (mirror of top-left)
        ctx.fillRect(x + w - 4, y, 1, 1);
        ctx.fillRect(x + w - 3, y + 1, 1, 1);
        ctx.fillRect(x + w - 4, y + 1, 1, 1);
        ctx.fillRect(x + w - 2, y + 2, 1, 1);
        ctx.fillRect(x + w - 3, y + 2, 1, 1);
        ctx.fillRect(x + w - 4, y + 2, 1, 1);
        ctx.fillRect(x + w - 1, y + 3, 1, 1);
        ctx.fillRect(x + w - 2, y + 3, 1, 1);
        ctx.fillRect(x + w - 3, y + 3, 1, 1);
        ctx.fillRect(x + w - 4, y + 3, 1, 1);
    };

    // drawTextInputBox(x, y, w, h, bg, fg)
    // Text input box with rounded top corners (r=4)
    // Three-sided border: top, left, right (no bottom, connects to keyboard)
    FlipCanvas.prototype.drawTextInputBox = function(x, y, w, h, bg, fg) {
        var R = 4;
        var ctx = this.ctx;

        // ── Fill ──────────────────────────────────────────────────────────────
        ctx.fillStyle = bg;

        // Main rectangles for rounded top corners
        ctx.fillRect(x + R, y, w - R * 2, h);           // center column (full height)
        ctx.fillRect(x, y + R, R, h - R);               // left edge
        ctx.fillRect(x + w - R, y + R, R, h - R);       // right edge

        // Top-left corner pixels (r=4)
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

        // Top-right corner pixels (mirror of top-left)
        ctx.fillRect(x + w - 4, y, 1, 1);
        ctx.fillRect(x + w - 3, y + 1, 1, 1);
        ctx.fillRect(x + w - 4, y + 1, 1, 1);
        ctx.fillRect(x + w - 2, y + 2, 1, 1);
        ctx.fillRect(x + w - 3, y + 2, 1, 1);
        ctx.fillRect(x + w - 4, y + 2, 1, 1);
        ctx.fillRect(x + w - 1, y + 3, 1, 1);
        ctx.fillRect(x + w - 2, y + 3, 1, 1);
        ctx.fillRect(x + w - 3, y + 3, 1, 1);
        ctx.fillRect(x + w - 4, y + 3, 1, 1);

        // ── Border ────────────────────────────────────────────────────────────
        ctx.fillStyle = fg;

        // Top-left corner outline (r=4)
        ctx.fillRect(x + 3, y, 1, 1);
        ctx.fillRect(x + 2, y + 1, 1, 1);
        ctx.fillRect(x + 1, y + 2, 1, 1);
        ctx.fillRect(x, y + 3, 1, 1);

        // Top edge
        ctx.fillRect(x + 4, y, w - 8, 1);

        // Top-right corner outline (r=4)
        ctx.fillRect(x + w - 4, y, 1, 1);
        ctx.fillRect(x + w - 3, y + 1, 1, 1);
        ctx.fillRect(x + w - 2, y + 2, 1, 1);
        ctx.fillRect(x + w - 1, y + 3, 1, 1);

        // Right edge
        ctx.fillRect(x + w - 1, y + 4, 1, h - 4);

        // Left edge
        ctx.fillRect(x, y + 4, 1, h - 4);
    };

    // drawKeyboard(x, y, rows, selectedRow, selectedCol, pressedRow, pressedCol, bg, fg)
    // Renders a virtual keyboard popup with rounded corners (r=4)
    // rows: array of arrays of characters (e.g., [['q','w','e',...], [...], ...])
    // selectedRow, selectedCol: current selection position
    // pressedRow, pressedCol: button currently pressed (-1 if none)
    // bg: background color, fg: border/text color
    FlipCanvas.prototype.drawKeyboard = function(x, y, rows, selectedRow, selectedCol, pressedRow, pressedCol, bg, fg) {
        var BTN_W = 15;
        var BTN_H = 16;
        var BTN_GAP = 0;  // No gap between buttons
        var SPACE_W = 35;  // Width of space button
        var R = 4;
        var CONTAINER_W = 250;
        var CONTAINER_H = 77;
        var ctx = this.ctx;

        // Calculate keyboard dimensions (account for space button in last row)
        var cols = rows[0].length;
        var lastRowWidth = (rows[rows.length - 1].length - 1) * BTN_W + SPACE_W;  // last row with space button
        var maxRowWidth = Math.max(cols * BTN_W, lastRowWidth);
        var keyboardW = maxRowWidth;
        var keyboardH = rows.length * BTN_H;

        // Position keyboard: 5px from top, 4px from right edge of container
        var keyboardX = x + (CONTAINER_W - keyboardW - 4);
        var keyboardY = y + 5;

        // Draw container background with r=4 corners
        ctx.fillStyle = bg;
        this.drawRoundRect(x, y, CONTAINER_W, CONTAINER_H, 4, bg);

        // Draw container border (top, left, right only - no bottom border)
        ctx.fillStyle = fg;
        // Top edge with corners
        ctx.fillRect(x + 4, y, CONTAINER_W - 8, 1);
        // Left edge (straight)
        ctx.fillRect(x, y + 4, 1, CONTAINER_H - 4);
        // Right edge (straight)
        ctx.fillRect(x + CONTAINER_W - 1, y + 4, 1, CONTAINER_H - 4);
        // TL corner outline
        ctx.fillRect(x + 3, y, 1, 1);
        ctx.fillRect(x + 2, y + 1, 1, 1);
        ctx.fillRect(x + 1, y + 2, 1, 1);
        ctx.fillRect(x, y + 3, 1, 1);
        // TR corner outline
        ctx.fillRect(x + CONTAINER_W - 4, y, 1, 1);
        ctx.fillRect(x + CONTAINER_W - 3, y + 1, 1, 1);
        ctx.fillRect(x + CONTAINER_W - 2, y + 2, 1, 1);
        ctx.fillRect(x + CONTAINER_W - 1, y + 3, 1, 1);

        // Draw keyboard background with r=4 corners (TL/TR/BR rounded, BL square)
        ctx.fillStyle = bg;

        // Background rectangles (keyboard inside container)
        ctx.fillRect(keyboardX + R, keyboardY, keyboardW - R * 2, keyboardH);
        ctx.fillRect(keyboardX, keyboardY + R, R, keyboardH - R);
        ctx.fillRect(keyboardX + keyboardW - R, keyboardY + R, R, keyboardH - R * 2);

        // Corner fill pixels (r=4)
        // TL corner
        ctx.fillRect(keyboardX + 3, keyboardY, 1, 1);
        ctx.fillRect(keyboardX + 2, keyboardY + 1, 1, 1);
        ctx.fillRect(keyboardX + 3, keyboardY + 1, 1, 1);
        ctx.fillRect(keyboardX + 1, keyboardY + 2, 1, 1);
        ctx.fillRect(keyboardX + 2, keyboardY + 2, 1, 1);
        ctx.fillRect(keyboardX + 3, keyboardY + 2, 1, 1);
        ctx.fillRect(keyboardX, keyboardY + 3, 1, 1);
        ctx.fillRect(keyboardX + 1, keyboardY + 3, 1, 1);
        ctx.fillRect(keyboardX + 2, keyboardY + 3, 1, 1);
        ctx.fillRect(keyboardX + 3, keyboardY + 3, 1, 1);

        // TR corner
        ctx.fillRect(keyboardX + keyboardW - 4, keyboardY, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 3, keyboardY + 1, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 4, keyboardY + 1, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 2, keyboardY + 2, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 3, keyboardY + 2, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 4, keyboardY + 2, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 1, keyboardY + 3, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 2, keyboardY + 3, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 3, keyboardY + 3, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 4, keyboardY + 3, 1, 1);

        // BR corner
        ctx.fillRect(keyboardX + keyboardW - 4, keyboardY + keyboardH - 4, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 3, keyboardY + keyboardH - 4, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 2, keyboardY + keyboardH - 4, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 1, keyboardY + keyboardH - 4, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 4, keyboardY + keyboardH - 3, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 3, keyboardY + keyboardH - 3, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 2, keyboardY + keyboardH - 3, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 4, keyboardY + keyboardH - 2, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 3, keyboardY + keyboardH - 2, 1, 1);
        ctx.fillRect(keyboardX + keyboardW - 4, keyboardY + keyboardH - 1, 1, 1);

        // Draw border and buttons
        ctx.fillStyle = fg;

        // Draw each button
        for (var row = 0; row < rows.length; row++) {
            for (var col = 0; col < rows[row].length; col++) {
                var char = rows[row][col];
                var isLastRowLastCol = (row === rows.length - 1 && col === rows[row].length - 1);
                var isSpaceButton = (char === ' ' && isLastRowLastCol);
                var btnW = isSpaceButton ? SPACE_W : BTN_W;

                // Calculate button position
                var btnX;
                if (isSpaceButton) {
                    // Space button positioned at the end of last row
                    var lastRowNormalBtnsW = (col) * BTN_W;
                    btnX = keyboardX + lastRowNormalBtnsW;
                } else {
                    btnX = keyboardX + col * BTN_W;
                }

                var btnY = keyboardY + row * BTN_H;
                var isSelected = (row === selectedRow && col === selectedCol);
                var isPressed = (row === pressedRow && col === pressedCol);

                if (isPressed) {
                    // Pressed state: filled black with white text
                    this.drawRoundRect(btnX, btnY, btnW, BTN_H, 2, '#000');
                    var charW = HaxrcorpFont16.textWidth(char || ' ');
                    var charX = btnX + Math.floor((btnW - charW) / 2);
                    var charY = btnY + 2;
                    if (char !== ' ') HaxrcorpFont16.draw(ctx, char, charX, charY, '#fff');
                } else if (isSelected) {
                    // Selected state: black frame only
                    this.drawRoundFrame(btnX, btnY, btnW, BTN_H, 2, '#000');
                    var charW = HaxrcorpFont16.textWidth(char || ' ');
                    var charX = btnX + Math.floor((btnW - charW) / 2);
                    var charY = btnY + 2;
                    if (char !== ' ') HaxrcorpFont16.draw(ctx, char, charX, charY, '#000');
                } else {
                    // Default state: gray frame only
                    this.drawRoundFrame(btnX, btnY, btnW, BTN_H, 2, '#888');
                    var charW = HaxrcorpFont16.textWidth(char || ' ');
                    var charX = btnX + Math.floor((btnW - charW) / 2);
                    var charY = btnY + 2;
                    if (char !== ' ') HaxrcorpFont16.draw(ctx, char, charX, charY, '#000');
                }
            }
        }

        // Draw back icon and "Delete" label on the right
        var labelX = keyboardX + cols * BTN_W + 5 + 2;  // +3px to the right
        var labelY = keyboardY + 12;  // Position icon higher

        // Set semi-transparent alpha (0.5 = 50%)
        ctx.globalAlpha = 0.5;

        // Draw "Delete" text above icon (raised 3px)
        var deleteTextY = labelY - 8 - 2;
        HaxrcorpFont16.draw(ctx, 'Delete', labelX - 2, deleteTextY, '#000');

        // Draw back icon (16x16) - shifted 2px right
        this.drawIcon(Icons.back, labelX + 2, labelY + 1, '#000');

        // Restore full opacity
        ctx.globalAlpha = 1.0;
    };

    // drawCursor(x, y, width, height, color)
    // Draws a blinking text cursor (vertical line)
    FlipCanvas.prototype.drawCursor = function(x, y, w, h, color) {
        this.ctx.fillStyle = color || '#000';
        this.ctx.fillRect(x, y, w, h);
    };

    // drawIcon(icon, x, y, color)
    // Draws a bitmap icon (from icons.js)
    // icon: {w: width, h: height, d: [hex values]}
    FlipCanvas.prototype.drawIcon = function(icon, x, y, color) {
        if (!icon || !icon.d) return;

        var ctx = this.ctx;
        ctx.fillStyle = color || '#000';

        for (var row = 0; row < icon.h; row++) {
            var hexValue = icon.d[row];
            if (hexValue === undefined) continue;

            // Convert hex to binary and draw pixels
            var bits = hexValue.toString(2).padStart(icon.w, '0');
            for (var col = 0; col < icon.w && col < bits.length; col++) {
                if (bits[col] === '1') {
                    ctx.fillRect(x + col, y + row, 1, 1);
                }
            }
        }
    };

    return FlipCanvas;
})();
