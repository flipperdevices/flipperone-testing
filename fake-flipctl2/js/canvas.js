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
        return { bg: pressed ? '#000' : '#ffffff', fg: pressed ? '#fff' : '#000' };
    }
    function _btnText(ctx, text, x, w, y, fg) {
        var tw = HaxrcorpFont16.textWidth(text);
        var tx = x + Math.floor((w - tw) / 2);
        var ty = y + 2;  // 2px top padding
        HaxrcorpFont16.draw(ctx, text, tx, ty, fg);
    }
    // Combined icon + label inside a button. Icon and text are
    // measured as one block and centred horizontally inside the
    // button. Icon is vertically centred against BTN_H; text uses
    // the same 2px top padding as `_btnText`. Falls back to
    // `_btnText` when `icon` is null/undefined.
    function _btnIconText(canvas, text, icon, x, w, y, fg) {
        if (!icon) {
            _btnText(canvas.ctx, text, x, w, y, fg);
            return;
        }
        var GAP = 3;
        var tw = HaxrcorpFont16.textWidth(text);
        var totalW = icon.w + GAP + tw;
        var startX = x + Math.floor((w - totalW) / 2);
        // +1 nudge: pure vertical centring puts the icon top at y+1
        // (for an 11 px icon in a 14 px button), but the text top sits
        // at y+2 (the standard 2 px top padding). Matching the icon
        // top to the text top reads as a single optical baseline.
        var iconY  = y + Math.floor((BTN_H - icon.h) / 2) + 1;
        // grayscale sprites go through drawSprite; binary icons
        // through drawIcon — same convention MenuLine uses.
        if (icon.grayscale) {
            canvas.drawSprite(icon, startX, iconY, fg);
        } else {
            canvas.drawIcon(icon, startX, iconY, fg);
        }
        HaxrcorpFont16.draw(canvas.ctx, text, startX + icon.w + GAP, y + 2, fg);
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

    // Left button — flush with left screen edge, only top-right corner rounded.
    // Optional `icon` renders to the left of the label; the icon+text
    // pair is centred together inside the button.
    FlipCanvas.prototype.drawLeftButton = function(text, x, w, pressed, disabled, icon) {
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

        _btnIconText(this, text, icon, x, w, y, c.fg);
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

    // Bresenham line — used by scenes that paint per-pixel paths
    // (e.g. the touchpad test's stroke trail). Endpoints inclusive,
    // integer coordinates only; the input is `| 0`-coerced first
    // since pointer events arrive as floats post-CSS-unscale.
    FlipCanvas.prototype.drawLine = function(x0, y0, x1, y1, color) {
        this.ctx.fillStyle = color || '#fff';
        x0 = x0 | 0; y0 = y0 | 0; x1 = x1 | 0; y1 = y1 | 0;
        var dx = Math.abs(x1 - x0);
        var dy = Math.abs(y1 - y0);
        var sx = x0 < x1 ? 1 : -1;
        var sy = y0 < y1 ? 1 : -1;
        var err = dx - dy;
        while (true) {
            this.ctx.fillRect(x0, y0, 1, 1);
            if (x0 === x1 && y0 === y1) break;
            var e2 = err << 1;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 <  dx) { err += dx; y0 += sy; }
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
    FlipCanvas.prototype.drawKeyboard = function(x, y, rows, selectedRow, selectedCol, pressedRow, pressedCol, bg, fg, shiftState, langLabel) {
        var BTN_W = 15;
        var BTN_H = 16;
        var BTN_GAP = 0;  // No gap between buttons
        var SPACE_W = 35;  // Width of space button
        var SHIFT_W = 35;  // Width of shift button (matches space)
        var LANG_W  = 35;  // Width of language-switcher button (matches shift)
        // Sentinel for the shift key in `rows`. ⇧ is the unicode
        // upward-pointing white arrow — distinct from any character
        // a normal alphabetic layout might want to insert.
        var SHIFT_CHAR = '⇧';
        // Sentinel for the language-switcher key. Lives in the
        // private-use area so it can't collide with any character
        // a layout might legitimately want to type. drawKeyboard
        // recognises it at col 0 of the SECOND-TO-LAST row (the
        // slot directly above the shift cell) and paints
        // `Icons.keyboard_lang` instead of a glyph.
        var LANG_CHAR  = '⌘';
        var R = 4;
        var CONTAINER_W = 250;
        var CONTAINER_H = 77;
        var ctx = this.ctx;
        var self = this;

        // Normalise a cell from `rows`. Each entry can be either:
        //   - A string  (single char): legacy form. Width / icon
        //                              flags are inferred from
        //                              the sentinel char + position
        //                              (shift / lang / space).
        //   - An object {text, wide?, isShift?, isLang?, isSpace?}:
        //                              callers can mark any cell
        //                              wide and supply arbitrary
        //                              display text, used by the
        //                              symbol layout for keys like
        //                              wide '_' / '<>|' / '.' that
        //                              don't carry shift / lang /
        //                              space behaviour.
        function cellOf(rowIdx, colIdx) {
            var raw = rows[rowIdx][colIdx];
            if (raw && typeof raw === 'object') {
                return {
                    text:    raw.text != null ? raw.text : '',
                    wide:    !!raw.wide,
                    isShift: !!raw.isShift,
                    isLang:  !!raw.isLang,
                    isSpace: !!raw.isSpace
                };
            }
            var lastRow      = (rowIdx === rows.length - 1);
            var aboveLastRow = (rowIdx === rows.length - 2);
            var lastCol      = (colIdx === rows[rowIdx].length - 1);
            var isShift = lastRow      && colIdx === 0 && raw === SHIFT_CHAR;
            var isLang  = aboveLastRow && colIdx === 0 && raw === LANG_CHAR;
            var isSpace = lastRow      && lastCol      && raw === ' ';
            return {
                text:    raw,
                wide:    isShift || isLang || isSpace,
                isShift: isShift,
                isLang:  isLang,
                isSpace: isSpace
            };
        }

        function btnWidthAt(rowIdx, colIdx) {
            return cellOf(rowIdx, colIdx).wide ? SHIFT_W : BTN_W;
        }
        // Width of a row's leading wide key. Used to align the
        // alphabetic columns across all rows: rows without a
        // leading wide key are padded left by `maxLeadingWide`, so
        // e.g. Q sits over A which sits over Z even though Z is
        // preceded by shift and A is preceded by the language key.
        function rowLeadingWideWidth(rowIdx) {
            var rk = rows[rowIdx];
            if (!rk || rk.length === 0) return 0;
            return cellOf(rowIdx, 0).wide ? SHIFT_W : 0;
        }
        var maxLeadingWide = 0;
        for (var lwRow = 0; lwRow < rows.length; lwRow++) {
            var lw = rowLeadingWideWidth(lwRow);
            if (lw > maxLeadingWide) maxLeadingWide = lw;
        }
        function rowLeftOffset(rowIdx) {
            return maxLeadingWide - rowLeadingWideWidth(rowIdx);
        }
        function rowPixelWidth(rowIdx) {
            var rk = rows[rowIdx];
            var total = rowLeftOffset(rowIdx);
            for (var c = 0; c < rk.length; c++) total += btnWidthAt(rowIdx, c);
            return total;
        }

        // Three shift states with distinct icons:
        //   'off'    → unpressed arrow (default chrome)
        //   'shift'  → pressed arrow (one-shot, next letter capped)
        //   'caps'   → caps-lock variant (latched, all letters capped)
        // While shiftState !== 'off' alphabetic glyphs render uppercase
        // so the keyboard's visual state matches what onChar emits.
        var shiftActive = (shiftState && shiftState !== 'off');
        function shiftIconFor(state) {
            if (state === 'caps')  return Icons.keyboard_caps_lock_pressed;
            if (state === 'shift') return Icons.keyboard_shift_pressed;
            return Icons.keyboard_shift_unpressed || Icons.keyboard_shift;
        }

        // Centre either the shift icon, the language-switcher icon,
        // or a (possibly multi-char) text label inside a button.
        function paintContent(cell, bx, by, bw, color) {
            if (cell.isShift) {
                var sIcon = shiftIconFor(shiftState);
                var sIx = bx + Math.floor((bw - sIcon.w) / 2);
                var sIy = by + Math.floor((BTN_H - sIcon.h) / 2);
                if (sIcon.grayscale) self.drawSprite(sIcon, sIx, sIy, color);
                else                  self.drawIcon(sIcon, sIx, sIy, color);
                return;
            }
            if (cell.isLang) {
                var lIcon = Icons.keyboard_lang;
                var lIx = bx + Math.floor((bw - lIcon.w) / 2);
                var lIy = by + Math.floor((BTN_H - lIcon.h) / 2);
                if (lIcon.grayscale) self.drawSprite(lIcon, lIx, lIy, color);
                else                  self.drawIcon(lIcon, lIx, lIy, color);
                return;
            }
            if (cell.isSpace) return;            // empty wide bar
            var t = cell.text;
            if (t === '' || t === ' ' || t == null) return;
            // Single-letter cells get the shift-aware uppercasing.
            // Multi-char labels (e.g. the SYM layout's "<>|") are
            // never letters, so the comparison naturally skips them.
            var displayCh = (shiftActive && t.length === 1 && t >= 'a' && t <= 'z')
                ? t.toUpperCase() : t;
            var cw = HaxrcorpFont16.textWidth(displayCh);
            var cx = bx + Math.floor((bw - cw) / 2);
            var cy = by + 2;
            HaxrcorpFont16.draw(ctx, displayCh, cx, cy, color);
        }

        // Calculate keyboard dimensions — pick the widest row.
        var cols = rows[0].length;
        var maxRowWidth = 0;
        for (var rr = 0; rr < rows.length; rr++) {
            var rw = rowPixelWidth(rr);
            if (rw > maxRowWidth) maxRowWidth = rw;
        }
        var keyboardW = maxRowWidth;
        var keyboardH = rows.length * BTN_H;

        // Position keyboard: 5px from top, 4px from right edge of container
        // Centre the keyboard horizontally inside the container.
        // (Was right-anchored 4 px from the right edge before; the
        // new layout has wide shift + space keys flanking the
        // bottom row, so a centred placement reads cleaner and the
        // empty area to the right of the top rows naturally hosts
        // the Delete affordance.)
        var keyboardX = x + Math.floor((CONTAINER_W - keyboardW) / 2);
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

        // Selected button is deferred to a second pass after the
        // main loop. Its 2-px frame extends 1 px OUTSIDE the
        // button's bounds, and any neighbour drawn after it (next
        // column on the right, next row below) would otherwise
        // overdraw those outer-ring pixels. We record its geometry
        // here and re-render it on top once every other key has
        // been painted.
        var selBtn = null;

        // Draw each button.
        for (var row = 0; row < rows.length; row++) {
            var rowKeys = rows[row];
            // Rows without a leading wide key are padded left so
            // their first key aligns column-wise with the bottom
            // row's first letter (i.e., Q sits over A sits over Z).
            var btnX = keyboardX + rowLeftOffset(row);
            var btnY = keyboardY + row * BTN_H;
            for (var col = 0; col < rowKeys.length; col++) {
                var cell = cellOf(row, col);
                var btnW = cell.wide ? SHIFT_W : BTN_W;

                var isSelected = (row === selectedRow && col === selectedCol);
                var isPressed  = (row === pressedRow && col === pressedCol);
                // Filled-black look fires only on the brief press
                // flash. State indicators (shift mode, caps lock)
                // are conveyed by which icon paints — chrome stays
                // the standard light-gray frame at rest.
                var isFilled   = isPressed;

                if (isSelected) {
                    // Defer the 2-px black frame to a second pass,
                    // but paint the underlying button look now so
                    // the slot isn't blank if rendering aborts.
                    if (isFilled) {
                        this.drawRoundRect(btnX, btnY, btnW, BTN_H, 2, '#000');
                        paintContent(cell, btnX, btnY, btnW, '#fff');
                    } else {
                        this.drawRoundFrame(btnX, btnY, btnW, BTN_H, 2, '#CCCCCC');
                        paintContent(cell, btnX, btnY, btnW, '#000');
                    }
                    selBtn = { x: btnX, y: btnY, w: btnW, cell: cell, isFilled: isFilled };
                } else if (isFilled) {
                    // Pressed (transient): filled black background
                    // with white glyph/icon.
                    this.drawRoundRect(btnX, btnY, btnW, BTN_H, 2, '#000');
                    paintContent(cell, btnX, btnY, btnW, '#fff');
                } else {
                    // Default light-gray frame.
                    this.drawRoundFrame(btnX, btnY, btnW, BTN_H, 2, '#CCCCCC');
                    paintContent(cell, btnX, btnY, btnW, '#000');
                }

                btnX += btnW;
            }
        }

        // ── Selected-button second pass ──────────────────────────
        // Now that every other key is painted, layer the 2-px
        // black frame over the selected one. The outer ring (r=3,
        // expanded by 1 px) overdraws any neighbour pixels that
        // touched the outer-ring columns/rows; the inner ring
        // (r=2, at button bounds) overdraws the first-pass gray
        // (or filled black) with black. Then re-paint the
        // content — colour follows the underlying state so a
        // selected shift-on key keeps its white icon, a selected
        // letter shows its black glyph.
        if (selBtn) {
            this.drawRoundFrame(selBtn.x - 1, selBtn.y - 1, selBtn.w + 2, BTN_H + 2, 3, '#000');
            this.drawRoundFrame(selBtn.x,     selBtn.y,     selBtn.w,     BTN_H,     2, '#000');
            paintContent(selBtn.cell,
                         selBtn.x, selBtn.y, selBtn.w,
                         selBtn.isFilled ? '#fff' : '#000');
        }

        // ── Layout indicator ─────────────────────────────────────
        // Gray label in the top-row left-pad area, directly above
        // the wide cell at row [last-1][0]. The text is supplied
        // by the caller via `langLabel` ('EN' for the alphabet
        // layout, '123' for the symbol layout, etc.) — drawKeyboard
        // doesn't try to infer it. Drawn only when row[last-1] has
        // a wide cell (i.e., there's somewhere to anchor).
        if (langLabel && rows.length >= 2 && cellOf(rows.length - 2, 0).wide) {
            var llW = HaxrcorpFont16.textWidth(langLabel);
            var llX = keyboardX + Math.floor((LANG_W - llW) / 2);
            // Same y offset glyphs use inside button cells (btnY +
            // 2) so the label optically sits at the row's natural
            // text baseline.
            var llY = keyboardY + 2;
            HaxrcorpFont16.draw(ctx, langLabel, llX, llY, '#888888');
        }

        // Draw back icon and "Delete" label on the right —
        // positioned just past the TOP row's actual right edge so
        // it sits in the empty area left of the bottom row's
        // wider span (the bottom row may be wider thanks to shift +
        // space). Includes the row's left offset so the math
        // tracks correctly when other rows are pad-aligned.
        var labelX = keyboardX + rowPixelWidth(0) + 5 + 2;
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

    // drawSprite(sprite, x, y, color)
    // Draws a large sprite with support for grayscale (from sprites.js)
    // Binary sprite: {w: width, h: height, d: [hex values]}
    // Grayscale sprite: {w: width, h: height, bitsPerPixel: 6, grayscale: true, d: [...]}
    FlipCanvas.prototype.drawSprite = function(sprite, x, y, color) {
        if (!sprite || !sprite.d) return;

        var ctx = this.ctx;

        if (sprite.grayscale && sprite.bitsPerPixel === 6) {
            // 6-bit grayscale sprite (64 levels)
            this._drawGrayscaleSprite(sprite, x, y, color);
        } else {
            // Binary (1-bit) sprite
            this._drawBinarySprite(sprite, x, y, color);
        }
    };

    // Paint a 6-bit grayscale sprite using the pixel's own grayscale
    // value as the output color (0 = black, 62 = near-white, etc.).
    // Value 63 is the transparency sentinel and is skipped, so this is
    // suitable for overlays where the canvas underneath must remain
    // visible around the icon.
    FlipCanvas.prototype.drawSpriteLiteral = function(sprite, x, y) {
        if (!sprite || !sprite.d) return;
        if (!sprite.grayscale || sprite.bitsPerPixel !== 6) return;

        var ctx = this.ctx;
        var dataIndex = 0;

        for (var row = 0; row < sprite.h; row++) {
            for (var col = 0; col < sprite.w; col += 4) {
                var b0 = sprite.d[dataIndex]     || 0;
                var b1 = sprite.d[dataIndex + 1] || 0;
                var b2 = sprite.d[dataIndex + 2] || 0;
                dataIndex += 3;

                var pixels = [
                    (b0 >> 2) & 0x3F,
                    (((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0F)) & 0x3F,
                    (((b1 & 0x0F) << 2) | ((b2 >> 6) & 0x03)) & 0x3F,
                    b2 & 0x3F
                ];

                for (var i = 0; i < 4 && col + i < sprite.w; i++) {
                    var g = pixels[i];
                    if (g >= 63) continue;  // transparent sentinel
                    var v = Math.round((g / 63) * 255);
                    ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
                    ctx.fillRect(x + col + i, y + row, 1, 1);
                }
            }
        }
    };

    // Draw a single frame of a vertically-stacked sprite strip. The strip
    // describes frame count via `frames`; each frame occupies h/frames rows.
    FlipCanvas.prototype.drawSpriteFrame = function(sprite, x, y, frameIndex, color) {
        if (!sprite || !sprite.d) return;
        var frames = sprite.frames || 1;
        var frameH = Math.floor(sprite.h / frames);
        if (frameIndex < 0) frameIndex = 0;
        if (frameIndex >= frames) frameIndex = frames - 1;

        // Grayscale rows are consumed 3 bytes per 4-pixel group by the
        // renderer below, so each row occupies ceil(w/4)*3 bytes — not
        // the packed-bits figure ceil(w*6/8), which is smaller when w
        // isn't a multiple of 4 (e.g. w=14 gives 12 vs 11).
        var bytesPerRow = (sprite.grayscale && sprite.bitsPerPixel === 6)
            ? Math.ceil(sprite.w / 4) * 3
            : Math.ceil(sprite.w / 8);

        var offset = frameIndex * frameH * bytesPerRow;
        var view = {
            w: sprite.w,
            h: frameH,
            bitsPerPixel: sprite.bitsPerPixel,
            grayscale: sprite.grayscale,
            d: sprite.d
        };

        if (view.grayscale && view.bitsPerPixel === 6) {
            this._drawGrayscaleSprite(view, x, y, color, offset);
        } else {
            this._drawBinarySprite(view, x, y, color, offset);
        }
    };

    FlipCanvas.prototype._drawBinarySprite = function(sprite, x, y, color, dataOffset) {
        var ctx = this.ctx;
        ctx.fillStyle = color || '#000';

        var bytesPerRow = Math.ceil(sprite.w / 8);
        var baseIndex = dataOffset || 0;

        for (var row = 0; row < sprite.h; row++) {
            var dataIndex = baseIndex + row * bytesPerRow;
            var bitPos = 0;

            for (var byteIdx = 0; byteIdx < bytesPerRow && bitPos < sprite.w; byteIdx++) {
                var hexValue = sprite.d[dataIndex + byteIdx];
                if (hexValue === undefined) break;

                for (var bit = 7; bit >= 0 && bitPos < sprite.w; bit--) {
                    var isBitSet = (hexValue >> bit) & 1;
                    if (isBitSet === 1) {
                        ctx.fillRect(x + bitPos, y + row, 1, 1);
                    }
                    bitPos++;
                }
            }
        }
    };

    FlipCanvas.prototype._drawGrayscaleSprite = function(sprite, x, y, color, dataOffset) {
        var ctx = this.ctx;
        color = color || '#000';

        // Unpack 6-bit grayscale values (4 pixels per 3 bytes)
        var bytesPerRow = Math.ceil((sprite.w * 6) / 8);
        var dataIndex = dataOffset || 0;

        for (var row = 0; row < sprite.h; row++) {
            for (var col = 0; col < sprite.w; col += 4) {
                // Get 3 bytes for 4 pixels
                var byte0 = sprite.d[dataIndex] || 0;
                var byte1 = sprite.d[dataIndex + 1] || 0;
                var byte2 = sprite.d[dataIndex + 2] || 0;
                dataIndex += 3;

                // Unpack 4 pixels (6 bits each)
                // byte0: pixel0[5:0] | pixel1[5:4]
                // byte1: pixel1[3:0] | pixel2[5:2]
                // byte2: pixel2[1:0] | pixel3[5:0]

                var pixel0 = (byte0 >> 2) & 0x3F;
                var pixel1 = (((byte0 & 0x03) << 4) | ((byte1 >> 4) & 0x0F)) & 0x3F;
                var pixel2 = (((byte1 & 0x0F) << 2) | ((byte2 >> 6) & 0x03)) & 0x3F;
                var pixel3 = byte2 & 0x3F;

                var pixels = [pixel0, pixel1, pixel2, pixel3];

                // Draw pixels
                for (var i = 0; i < 4 && col + i < sprite.w; i++) {
                    var grayValue = pixels[i];
                    // grayValue: 0=black, 63=white
                    // opacity: 0=white (transparent), 1=black (opaque)
                    var opacity = (63 - grayValue) / 63;

                    if (opacity > 0.01) {  // Skip nearly transparent pixels
                        ctx.globalAlpha = opacity;
                        ctx.fillStyle = color;
                        ctx.fillRect(x + col + i, y + row, 1, 1);
                        ctx.globalAlpha = 1.0;
                    }
                }
            }
        }
    };


    return FlipCanvas;
})();
