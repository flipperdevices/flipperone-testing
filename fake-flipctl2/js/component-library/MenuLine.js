/**
 * MenuLine — a single row in a vertical menu list.
 *
 * Layout (relative to the line's top-left):
 *   - Icon at (3, 3); 3px L/T/B padding. Icon expected to be 14×14.
 *   - Busy9pxFlipCTL label 4px to the right of the icon, with the capital
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
    var TEXT_DRAW_Y   = 3;    // draw y (inside the line) so cap top lands at 6
    var STATUS_PAD_R  = 5;    // right padding for status text
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
        // Optional callback: called in render() to produce a fresh
        // status string each frame (e.g. live Wi-Fi SSID). Return
        // falsy to suppress the status.
        this.statusProvider = options.statusProvider || null;
        this.state         = options.state || STATE_DEFAULT;
        // Optional per-instance override for the vertical nudge
        // applied to the ACTIVE (selected / pressed) label so it
        // optically aligns with the Busy9pxFlipCTL default underneath.
        // Stock value is +1 to compensate for Born2bSporty's
        // high cap line — consumers whose selector frame sits
        // higher (e.g. file-list scenes that use the smaller
        // y-offset of -1) can pass 0 to keep the label tight to
        // the cap.
        this.activeLabelYNudge = (typeof options.activeLabelYNudge === 'number')
            ? options.activeLabelYNudge
            : 1;
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
            // Vertically center the icon in the line so short icons
            // (e.g. nmap_eye at 9 px) don't ride high. For animated
            // icons the visible "frame" height is sprite.h / frames,
            // not the strip height. Stays at ICON_PAD for tall icons
            // (14+ px) so existing menu rows don't budge.
            var frameCount = iconSource.frames || 1;
            var iconVisH = frameCount > 1
                ? Math.floor(iconSource.h / frameCount)
                : iconSource.h;
            var iconY = y + Math.max(ICON_PAD,
                Math.round((H - iconVisH) / 2));
            // Optional per-icon nudge baked into the asset definition.
            // Lets specific icons compensate for whitespace inside
            // their bitmap without forcing every other icon to absorb
            // the offset. Defaults are 0.
            iconX += iconSource.offsetX || 0;
            iconY += iconSource.offsetY || 0;
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

        // Label font swaps: Busy9pxFlipCTL in DEFAULT, Born2bSportyV2FlipCTL
        // in SELECTED/PRESSED. Status text is different — it always
        // stays on Busy9pxFlipCTL so the row's right-side info keeps the
        // same typographic weight across states; only its *colour*
        // changes with the state. The active font also nudges 1 px
        // down — Born2bSporty's cap baseline sits visually high
        // against the selector frame, so + 1 puts it on the same
        // optical row as the Busy9pxFlipCTL default.
        var font       = active ? Born2bSportyV2FlipCTL : Busy9pxFlipCTL;
        var statusFont = Busy9pxFlipCTL;
        var textY = y + TEXT_DRAW_Y;
        var labelY = active ? (textY + this.activeLabelYNudge) : textY;
        font.draw(canvas.ctx, this.text, textLeft, labelY, textColor);

        var status = this.statusProvider ? this.statusProvider() : this.status;
        if (status) {
            // Status text is dimmer than the label when the row isn't
            // highlighted: #999 in DEFAULT, #000 in SELECTED, inherits
            // white from `textColor` in PRESSED.
            var statusColor = this.state === STATE_PRESSED
                ? textColor
                : (active ? '#000' : '#999999');
            if ((status === '< ON >' || status === '< OFF >')
                    && typeof this.onAdjust !== 'function') {
                // Toggle-style status: show the `< value >` layout only
                // while the row is highlighted (SELECTED or PRESSED) —
                // the arrows are an affordance for the left/right
                // keys, which only apply to the focused row. When not
                // highlighted, collapse to just the value word, right-
                // aligned like any other status string.
                var midTxt = status === '< ON >' ? 'ON' : 'OFF';
                if (active) {
                    var ltW   = statusFont.textWidth('<');
                    var midW  = statusFont.textWidth('OFF');
                    var gtW   = statusFont.textWidth('>');
                    var spacing = 15;
                    var rightX = x + this.w - STATUS_PAD_R;
                    var gtX    = rightX - gtW;
                    var ltX    = gtX - spacing - midW - spacing - ltW;
                    var midBase = ltX + ltW + spacing;
                    var midTxtW = statusFont.textWidth(midTxt);
                    var midX    = Math.floor(midBase + (midW - midTxtW) / 2);
                    // Arrow press feedback: when the scene flags this
                    // line's `arrowPressed = 'left'|'right'`, the
                    // corresponding chevron renders in #222222 as a
                    // tap indicator.
                    var ltColor = this.arrowPressed === 'left'  ? '#222222' : statusColor;
                    var gtColor = this.arrowPressed === 'right' ? '#222222' : statusColor;
                    statusFont.draw(canvas.ctx, '<',     ltX,  textY, ltColor);
                    statusFont.draw(canvas.ctx, midTxt,  midX, textY, statusColor);
                    statusFont.draw(canvas.ctx, '>',     gtX,  textY, gtColor);
                } else {
                    var dimW = statusFont.textWidth(midTxt);
                    statusFont.draw(canvas.ctx, midTxt, x + this.w - dimW - STATUS_PAD_R, textY, statusColor);
                }
            } else if (/^<\s*[\s\S]+\s*>$/.test(status)) {
                // Generic "< value >" cycle / adjust affordance —
                // any bracketed value that isn't the ON/OFF toggle
                // above (e.g. "< 10 sec >", "< 50% >", "< Never >").
                // Spread arrows around the value while the row is
                // highlighted (so left/right reads as adjustable);
                // collapse to the value alone, right-aligned, when
                // not highlighted. Arrows tap-flash in #222 via
                // arrowPressed, same as the toggle path.
                var gMid    = status.replace(/^<\s*/, '').replace(/\s*>$/, '');
                var gRightX = x + this.w - STATUS_PAD_R;
                if (active) {
                    var gSpacing = 6;
                    var gLtW  = statusFont.textWidth('<');
                    var gGtW  = statusFont.textWidth('>');
                    var gMidW = statusFont.textWidth(gMid);
                    var gGtX  = gRightX - gGtW;
                    var gMidX = gGtX - gSpacing - gMidW;
                    var gLtX  = gMidX - gSpacing - gLtW;
                    var gLtColor = this.arrowPressed === 'left'  ? '#222222' : statusColor;
                    var gGtColor = this.arrowPressed === 'right' ? '#222222' : statusColor;
                    // Hide the left arrow at the value's low end and
                    // the right arrow at its high end — the row
                    // exposes optional atStart() / atEnd() predicates
                    // for this. The value keeps its position either
                    // way; only the arrow glyph is suppressed.
                    var hideLt = (typeof this.atStart === 'function') && this.atStart();
                    var hideGt = (typeof this.atEnd   === 'function') && this.atEnd();
                    if (!hideLt) statusFont.draw(canvas.ctx, '<', gLtX, textY, gLtColor);
                    statusFont.draw(canvas.ctx, gMid, gMidX, textY, statusColor);
                    if (!hideGt) statusFont.draw(canvas.ctx, '>', gGtX, textY, gGtColor);
                } else {
                    var gDimW = statusFont.textWidth(gMid);
                    statusFont.draw(canvas.ctx, gMid, gRightX - gDimW, textY, statusColor);
                }
            } else {
                var sw = statusFont.textWidth(status);
                statusFont.draw(canvas.ctx, status, x + this.w - sw - STATUS_PAD_R, textY, statusColor);
            }
        }
    };

    MenuLine.H              = H;
    MenuLine.STATE_DEFAULT  = STATE_DEFAULT;
    MenuLine.STATE_SELECTED = STATE_SELECTED;
    MenuLine.STATE_PRESSED  = STATE_PRESSED;
    return MenuLine;
})();
