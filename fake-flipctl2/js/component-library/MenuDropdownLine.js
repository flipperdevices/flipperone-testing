/**
 * MenuDropdownLine
 *
 * A horizontal "settings line" pairing a left-aligned title
 * with a right-aligned dropdown chip. Used in app screens that
 * need a stacked list of named values (e.g. an app's settings
 * panel: source / quality / volume). The title sits flush
 * against the screen's left edge; the chip is anchored to the
 * right edge with a fixed width.
 *
 * Layout (anchored at `y` which the caller controls so the row
 * can be stacked freely below an app title bar):
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ <title text>                       ┌─ #E5E5E5 chip ──┐  │
 *   │                                    │ <future content> │  │
 *   │                                    └──────────────────┘  │
 *   └──────────────────────────────────────────────────────────┘
 *     ^                                  ^                   ^
 *     6 px from left                     180 wide            5 px from right
 *
 * Vertical metrics: title text and chip share the same top
 * inset (`TOP_PAD`). The chip is 11 px tall — caller picks `y`
 * such that the row sits where it belongs (the conventional
 * first-line spacing is 3 px below the app's gray title bar).
 *
 * `render(canvas)` paints both pieces. No selection / focus
 * state yet — that lands when the dropdown gains a value /
 * chevron in a follow-up.
 */
var MenuDropdownLine = (function() {
    // Geometry constants. Pulled out so app screens that want a
    // close-but-not-identical row can reach in and read them
    // without re-deriving the math.
    var TITLE_X        = 6;     // px from the screen's left edge
    var TOP_PAD        = 2;     // px from the row's `y` to text / chip top
    var CHIP_W         = 180;
    var CHIP_H         = 11;
    var CHIP_RIGHT_PAD = 5;     // px from the screen's right edge
    var CHIP_FILL      = '#E5E5E5';
    var TITLE_FG       = '#000';

    function MenuDropdownLine(options) {
        options = options || {};
        // Top of the row in screen coordinates. The component
        // applies its own internal TOP_PAD so the caller can
        // anchor flush against the app title bar (or whatever
        // sits above) without doing the offset math.
        this.y     = options.y     != null ? options.y     : 0;
        this.title = options.title != null ? options.title : '';
        this.value = options.value != null ? options.value : '';
        // Slider mode. When set to a number in 0..1, the chip
        // turns into a horizontal progress bar: black fill from
        // the left edge proportional to `slider`, gray for the
        // remainder. The centred value text auto-inverts so the
        // portion drawn over the black fill renders white and
        // the portion over the gray remainder renders black —
        // single string, two clipped passes. Pass `null` /
        // `undefined` for the default plain-chip behaviour.
        this.slider = (typeof options.slider === 'number')
                        ? Math.max(0, Math.min(1, options.slider))
                        : null;
        // Selection state. Drives extra affordances on top of
        // the chip — currently the < / > arrows on a selected
        // slider row, telling the user they can adjust the
        // value with left/right. The selector outline itself is
        // still drawn by the parent scene; this flag is just
        // for in-chip ornaments.
        this.selected = !!options.selected;
    }

    MenuDropdownLine.prototype.render = function(canvas) {
        var ctx = canvas.ctx;

        // Title — flush with the row's top inset, left aligned
        // 6 px from the canvas edge, HaxrCorp4090FlipCTL black.
        HaxrCorp4090FlipCTL.draw(ctx, this.title,
            TITLE_X, this.y + TOP_PAD, TITLE_FG);

        // Right-anchored chip. Width is fixed at 180 px, so its
        // left edge is `canvas.w - CHIP_RIGHT_PAD - CHIP_W`.
        var chipX = canvas.w - CHIP_RIGHT_PAD - CHIP_W;
        var chipY = this.y + TOP_PAD;

        if (this.slider !== null) {
            this._renderSliderChip(canvas, chipX, chipY);
        } else {
            this._renderPlainChip(canvas, chipX, chipY);
        }
    };

    // Plain (default) chip — gray fill, centred value text.
    // When `this.selected` is true the chip also paints `<` / `>`
    // affordances inset from each edge, advertising that left /
    // right will cycle the picker — matching the slider chip's
    // own selected-state ornaments.
    MenuDropdownLine.prototype._renderPlainChip = function(canvas, chipX, chipY) {
        var ctx = canvas.ctx;
        var chip = new ResponsiveFrame({
            x: chipX,      y: chipY,
            width: CHIP_W, height: CHIP_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: false,
            fillColor: CHIP_FILL,
            showFill:  true,
            cornerRadius: 3,
            corners: { tl: true, tr: true, bl: true, br: true }
        });
        chip.render(canvas);

        var ARROW_PAD = 4;
        var ltW = 0, gtW = 0;
        if (this.selected) {
            ltW = HaxrCorp4090FlipCTL.textWidth('<');
            gtW = HaxrCorp4090FlipCTL.textWidth('>');
        }

        if (this.value) {
            var valStr = String(this.value);
            // Reserve room on each side for the arrows when
            // selected so a long label can't overrun them; the
            // ellipsis path then trims to fit the narrowed
            // budget instead of the full chip width.
            var maxW = CHIP_W - 4
                     - (this.selected ? (ltW + gtW + ARROW_PAD * 2) : 0);
            while (valStr.length > 0
                   && HaxrCorp4090FlipCTL.textWidth(valStr) > maxW) {
                valStr = valStr.substring(0, valStr.length - 1);
            }
            if (valStr.length < String(this.value).length && valStr.length > 1) {
                valStr = valStr.substring(0, valStr.length - 1) + '…';
            }
            var valW = HaxrCorp4090FlipCTL.textWidth(valStr);
            HaxrCorp4090FlipCTL.draw(ctx, valStr,
                chipX + Math.floor((CHIP_W - valW) / 2), chipY, '#000');
        }

        if (this.selected) {
            HaxrCorp4090FlipCTL.draw(ctx, '<',
                chipX + ARROW_PAD, chipY, '#000');
            HaxrCorp4090FlipCTL.draw(ctx, '>',
                chipX + CHIP_W - gtW - ARROW_PAD, chipY, '#000');
        }
    };

    // Slider chip — gray base + black fill from the left, with
    // the value text auto-inverted across the fill boundary.
    // Two passes:
    //   (1) Gray base (full chip).
    //   (2) Black fill on top, sized to `slider × CHIP_W`.
    //       Left corners follow the chip's curvature; right
    //       corners are square unless the fill is full.
    //   (3) Value text in WHITE, clipped to the black-fill rect.
    //   (4) Value text in BLACK, clipped to the remaining gray
    //       region. Both passes write the SAME string at the
    //       SAME x/y, so the eye reads one continuous label
    //       that flips colour per-pixel across the fill edge.
    MenuDropdownLine.prototype._renderSliderChip = function(canvas, chipX, chipY) {
        var ctx     = canvas.ctx;
        // Floor the visible fill at 5 % so the bar never reads
        // as an empty line. At slider = 0 the chip still shows
        // a small black "nub" on the left edge — much easier to
        // see than a fully-gray pill, and gives the user a
        // visible anchor when they're at the bottom of the
        // range. Above 5 % the fill tracks the actual slider
        // value normally.
        var MIN_VISIBLE_FRAC = 0.05;
        var pct     = Math.max(this.slider, MIN_VISIBLE_FRAC);
        var filledW = Math.round(CHIP_W * pct);

        // (1) Gray base.
        var grayChip = new ResponsiveFrame({
            x: chipX,      y: chipY,
            width: CHIP_W, height: CHIP_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: false,
            fillColor: CHIP_FILL,
            showFill:  true,
            cornerRadius: 3,
            corners: { tl: true, tr: true, bl: true, br: true }
        });
        grayChip.render(canvas);

        // (2) Black fill. Skip when filledW <= 0 (empty bar).
        if (filledW > 0) {
            var fullFill = filledW >= CHIP_W;
            var blackChip = new ResponsiveFrame({
                x: chipX,        y: chipY,
                width: filledW, height: CHIP_H,
                anchorH: 'left', anchorV: 'top',
                showStroke: false,
                fillColor: '#000', showFill: true,
                cornerRadius: 3,
                corners: {
                    tl: true,        bl: true,
                    tr: fullFill,    br: fullFill
                }
            });
            blackChip.render(canvas);
        }

        if (!this.value) return;

        // (3 + 4) Inverted value text. Centred horizontally
        // inside the chip; clip-pass once for the black region
        // (white glyphs) and once for the gray region (black
        // glyphs). Long values trim from the right with a
        // trailing ellipsis the same way the plain chip does.
        var valRaw = String(this.value);
        var maxW   = CHIP_W - 4;
        var valStr = valRaw;
        while (valStr.length > 0
               && HaxrCorp4090FlipCTL.textWidth(valStr) > maxW) {
            valStr = valStr.substring(0, valStr.length - 1);
        }
        if (valStr.length < valRaw.length && valStr.length > 1) {
            valStr = valStr.substring(0, valStr.length - 1) + '…';
        }
        var valW = HaxrCorp4090FlipCTL.textWidth(valStr);
        var textX = chipX + Math.floor((CHIP_W - valW) / 2);
        var textY = chipY;

        // Helper: draw a single string with the same split-
        // colour clipping as the value text. White over the
        // black-fill region, black over the gray remainder.
        function drawSplit(text, x, y) {
            if (filledW > 0) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(chipX, chipY, filledW, CHIP_H);
                ctx.clip();
                HaxrCorp4090FlipCTL.draw(ctx, text, x, y, '#FFFFFF');
                ctx.restore();
            }
            if (filledW < CHIP_W) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(chipX + filledW, chipY,
                         CHIP_W - filledW, CHIP_H);
                ctx.clip();
                HaxrCorp4090FlipCTL.draw(ctx, text, x, y, '#000000');
                ctx.restore();
            }
        }

        // (3 + 4) Centred value text with inverted clipping.
        drawSplit(valStr, textX, textY);

        // (5) Adjustment arrows. Drawn ONLY when this row is the
        // currently-selected one — they advertise that left /
        // right will move the slider. Both arrows use the same
        // split-colour clipping so they invert across the fill
        // edge just like the value text. Inset 4 px from each
        // chip edge.
        if (this.selected) {
            var ARROW_PAD = 4;
            var lt   = '<';
            var gt   = '>';
            var ltW  = HaxrCorp4090FlipCTL.textWidth(lt);
            var ltX  = chipX + ARROW_PAD;
            var gtW  = HaxrCorp4090FlipCTL.textWidth(gt);
            var gtX  = chipX + CHIP_W - gtW - ARROW_PAD;
            drawSplit(lt, ltX, textY);
            drawSplit(gt, gtX, textY);
        }
    };

    // Class-level constants exposed for callers that need to
    // know the row's height (e.g. for stacking) without
    // instantiating one.
    MenuDropdownLine.HEIGHT       = TOP_PAD + CHIP_H;
    MenuDropdownLine.TOP_PAD      = TOP_PAD;
    MenuDropdownLine.CHIP_HEIGHT  = CHIP_H;
    MenuDropdownLine.CHIP_WIDTH   = CHIP_W;
    MenuDropdownLine.CHIP_FILL    = CHIP_FILL;

    return MenuDropdownLine;
})();
