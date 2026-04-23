/**
 * MenuLine — a single row in a vertical menu list.
 *
 * Layout (relative to the line's top-left):
 *   - Icon at (3, 3); 3px L/T/B padding. Icon expected to be 14×14.
 *   - BusyFont9 label 4px to the right of the icon, with the capital
 *     letter top at y = 5 (so text is drawn at y = 2 given the glyph
 *     frame places cap tops at row 3).
 *   - Optional right-aligned `status` text (3px from the right edge).
 *
 * The line does NOT draw dividers. The owning scene stacks lines flush
 * and paints 1px separator rows between them.
 *
 * Animated icon strips replace the static icon only while the line is
 * SELECTED; when the strip is absent or the line isn't selected, the
 * static `icon` is used in every state.
 */
var MenuLine = (function() {
    var ICON_PAD      = 3;    // icon inset from left/top/bottom
    var TEXT_GAP      = 4;    // gap between icon and text
    var TEXT_DRAW_Y   = 2;    // draw y (inside the line) so cap top lands at 5
    var STATUS_PAD_R  = 3;    // right padding for status text
    var H             = 20;   // fixed line height (14px icon + 3+3 padding)
    var FRAME_MS      = 200;  // 5 fps animated-icon cadence
    var DEFAULT_W     = 224;

    var STATE_DEFAULT  = 'default';
    var STATE_SELECTED = 'selected';
    var STATE_PRESSED  = 'pressed';

    function MenuLine(options) {
        options = options || {};
        this.text          = options.text || '';
        this.w             = options.width !== undefined ? options.width : DEFAULT_W;
        this.h             = H;
        this.icon          = options.icon || null;
        this.iconAnimated  = options.iconAnimated || null;
        this.status        = options.status || null;
        this.state         = options.state || STATE_DEFAULT;
    }

    function spriteFrameHeight(sprite) {
        var frames = sprite.frames || 1;
        return frames > 1 ? Math.floor(sprite.h / frames) : sprite.h;
    }

    MenuLine.prototype.render = function(canvas, x, y) {
        var textColor = '#000';
        var iconColor = '#000';

        // Anchor animation time to the moment the line entered an
        // "active" state (SELECTED or PRESSED). Keeping _selectedAt
        // across the SELECTED→PRESSED→SELECTED transition means the
        // strip keeps advancing from the current frame rather than
        // rewinding when the user presses ok.
        if (this.state === STATE_SELECTED || this.state === STATE_PRESSED) {
            if (!this._selectedAt) this._selectedAt = Date.now();
        } else {
            this._selectedAt = 0;
        }

        // NOTE: The SELECTED and PRESSED visuals (outline / filled frame)
        // are painted by the owning scene — it knows the selector's
        // geometry, which is independent of the line's content area
        // (main menu uses 232×22 at x=10 while the line itself is
        // 224×20 at x=16). PRESSED only inverts the content colours
        // here so the text/icon read as white over whatever fill the
        // scene draws behind them.
        if (this.state === STATE_PRESSED) {
            textColor = '#fff';
            iconColor = '#fff';
        }

        // "active" lines (SELECTED or PRESSED) switch to Born2bSportyV2
        // for the label and drive the animated icon. Computed here so
        // both the icon-rendering block below and the font section can
        // read it.
        var active = this.state === STATE_SELECTED || this.state === STATE_PRESSED;

        // Icon rendering has three modes:
        //   1. active (SELECTED or PRESSED) + iconAnimated → play the
        //      strip at FRAME_MS cadence. PRESSED is included so the
        //      30ms press flash picks up the strip at its current
        //      frame instead of rewinding to frame 0.
        //   2. this.icon set           → draw it as a normal sprite / icon.
        //   3. only iconAnimated set   → draw frame 0 of the strip as a
        //      static fallback, so unselected lines aren't iconless when
        //      no dedicated static icon was supplied.
        var useAnimated = active && this.iconAnimated;
        var iconSource  = useAnimated ? this.iconAnimated : (this.icon || this.iconAnimated);

        var textLeft = x + ICON_PAD;
        if (iconSource) {
            var iconX = x + ICON_PAD;
            var iconY = y + ICON_PAD;
            if (useAnimated) {
                var frames = iconSource.frames || 1;
                var elapsed = Date.now() - this._selectedAt;
                // Unselected lines already show frame 0 (via the static
                // fallback), so the highlight should jump straight to
                // frame 1 — otherwise the first visible "selected" frame
                // is identical to the static and the motion is missed.
                var idx = (Math.floor(elapsed / FRAME_MS) + 1) % frames;
                canvas.drawSpriteFrame(iconSource, iconX, iconY, idx, iconColor);
            } else if (!this.icon && this.iconAnimated) {
                // No dedicated static — use the first frame of the strip.
                canvas.drawSpriteFrame(iconSource, iconX, iconY, 0, iconColor);
            } else if (iconSource.grayscale) {
                canvas.drawSprite(iconSource, iconX, iconY, iconColor);
            } else {
                canvas.drawIcon(iconSource, iconX, iconY, iconColor);
            }
            textLeft = iconX + iconSource.w + TEXT_GAP;
        }

        // Default state uses BusyFont9; active lines (SELECTED or
        // PRESSED) switch to Born2bSportyV2Medium. Status text follows
        // the same swap.
        var font = active ? Born2bSportyV2Medium : BusyFont9;
        var textY = y + TEXT_DRAW_Y;
        font.draw(canvas.ctx, this.text, textLeft, textY, textColor);

        if (this.status) {
            if (this.status === '< ON >' || this.status === '< OFF >') {
                // Inherit the original layout: < centred OFF/ON >
                var ltW   = font.textWidth('<');
                var midW  = font.textWidth('OFF');
                var gtW   = font.textWidth('>');
                var spacing = 15;
                var rightX = x + this.w - STATUS_PAD_R;
                var gtX    = rightX - gtW;
                var ltX    = gtX - spacing - midW - spacing - ltW;
                var midTxt = this.status === '< ON >' ? 'ON' : 'OFF';
                var midBase = ltX + ltW + spacing;
                var midTxtW = font.textWidth(midTxt);
                var midX   = Math.floor(midBase + (midW - midTxtW) / 2);
                font.draw(canvas.ctx, '<',     ltX,  textY, textColor);
                font.draw(canvas.ctx, midTxt,  midX, textY, textColor);
                font.draw(canvas.ctx, '>',     gtX,  textY, textColor);
            } else {
                var sw = font.textWidth(this.status);
                font.draw(canvas.ctx, this.status, x + this.w - sw - STATUS_PAD_R, textY, textColor);
            }
        }
    };

    MenuLine.H              = H;
    MenuLine.STATE_DEFAULT  = STATE_DEFAULT;
    MenuLine.STATE_SELECTED = STATE_SELECTED;
    MenuLine.STATE_PRESSED  = STATE_PRESSED;
    return MenuLine;
})();
