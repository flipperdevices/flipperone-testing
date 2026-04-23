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

        // NOTE: The SELECTED frame is not painted here. The owning scene
        // is expected to render a MenuSelectorFrame around the selected
        // line — this keeps the selector's geometry independent of the
        // line's content area (e.g. main menu uses 232×22 at x=10 while
        // the line itself is 224×20 at x=16).
        if (this.state === STATE_PRESSED) {
            canvas.drawRoundRect(x, y, this.w, this.h, 2, '#000');
            textColor = '#fff';
            iconColor = '#fff';
        }

        // Pick the icon source: animated strip while selected, else static.
        var useAnimated = this.state === STATE_SELECTED && this.iconAnimated;
        var iconSource  = useAnimated ? this.iconAnimated : this.icon;

        var textLeft = x + ICON_PAD;
        if (iconSource) {
            var iconX = x + ICON_PAD;
            var iconY = y + ICON_PAD;
            if (useAnimated) {
                var frames = iconSource.frames || 1;
                var idx = Math.floor(Date.now() / FRAME_MS) % frames;
                canvas.drawSpriteFrame(iconSource, iconX, iconY, idx, iconColor);
            } else if (iconSource.grayscale) {
                canvas.drawSprite(iconSource, iconX, iconY, iconColor);
            } else {
                canvas.drawIcon(iconSource, iconX, iconY, iconColor);
            }
            textLeft = iconX + iconSource.w + TEXT_GAP;
        }

        // Default state uses BusyFont9; SELECTED lines switch to
        // Born2bSportyV2Medium. Status text follows the same font swap.
        var font = this.state === STATE_SELECTED ? Born2bSportyV2Medium : BusyFont9;
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
