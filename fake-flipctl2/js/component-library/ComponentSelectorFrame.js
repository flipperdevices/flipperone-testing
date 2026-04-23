/**
 * ComponentSelectorFrame
 *
 * Selection frame for generic component cards (e.g. EthernetTab).
 * Starts as a duplicate of MenuSelectorFrame; will diverge as
 * component-selector-specific behaviour is added.
 *
 *   anchorH: 'left' | 'center' | 'right'
 *   anchorV: 'top'  | 'center' | 'bottom'
 *
 * Rendering paints only the body pixels of the rounded rectangle;
 * cut-corner pixels are never touched, so whatever was drawn on the
 * canvas underneath shows through naturally in any context.
 */
var ComponentSelectorFrame = (function() {
    function ComponentSelectorFrame(options) {
        options = options || {};
        this.x = options.x !== undefined ? options.x : 0;
        this.y = options.y !== undefined ? options.y : 0;
        this.width = options.width !== undefined ? options.width : 244;
        this.height = options.height !== undefined ? options.height : 22;
        this.fillColor = options.fillColor || '#ffffff';
        this.strokeColor = options.strokeColor || '#000000';
        this.showFill = options.showFill !== undefined ? options.showFill : true;
        this.showStroke = options.showStroke !== undefined ? options.showStroke : true;
        this.cornerRadius = options.cornerRadius !== undefined ? options.cornerRadius : 3;
        this.corners = options.corners || { tl: true, tr: true, bl: true, br: true };
        this.anchorH = options.anchorH || 'left';
        this.anchorV = options.anchorV || 'top';
        // Chevron: a 6px black bar on the right edge of the frame with
        // a ">" glyph centred inside it. Acts as a "drill in"
        // affordance for component cards.
        this.showChevron       = options.showChevron       !== undefined ? options.showChevron       : true;
        this.chevronWidth      = options.chevronWidth      !== undefined ? options.chevronWidth      : 6;
        this.chevronColor      = options.chevronColor      || '#000000';   // bar background
        this.chevronGlyphColor = options.chevronGlyphColor || '#ffffff';
    }

    function anchorOffset(anchor, size) {
        if (anchor === 'center') return Math.floor(size / 2);
        if (anchor === 'right' || anchor === 'bottom') return size;
        return 0;
    }

    ComponentSelectorFrame.prototype._origin = function() {
        return {
            x: this.x - anchorOffset(this.anchorH, this.width),
            y: this.y - anchorOffset(this.anchorV, this.height)
        };
    };

    ComponentSelectorFrame.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        var o = this._origin();
        var x = o.x, y = o.y;
        var w = this.width, h = this.height;
        var r = this.cornerRadius;

        var rTL = (r > 0 && this.corners.tl) ? r : 0;
        var rTR = (r > 0 && this.corners.tr) ? r : 0;
        var rBL = (r > 0 && this.corners.bl) ? r : 0;
        var rBR = (r > 0 && this.corners.br) ? r : 0;

        // Body fill, row by row. Cut-corner pixels are never painted,
        // so whatever was on the canvas underneath shows through.
        if (this.showFill) {
            ctx.fillStyle = this.fillColor;
            for (var dy = 0; dy < h; dy++) {
                var li = 0, ri = 0;
                if (dy < rTL)           li = Math.max(li, rTL - 1 - dy);
                if (dy >= h - rBL)      li = Math.max(li, dy - (h - rBL));
                if (dy < rTR)           ri = Math.max(ri, rTR - 1 - dy);
                if (dy >= h - rBR)      ri = Math.max(ri, dy - (h - rBR));
                var rowW = w - li - ri;
                if (rowW > 0) ctx.fillRect(x + li, y + dy, rowW, 1);
            }
        }

        if (this.showStroke) {
            ctx.fillStyle = this.strokeColor;

            var topLen = w - rTL - rTR;
            if (topLen > 0) ctx.fillRect(x + rTL, y, topLen, 1);

            var botLen = w - rBL - rBR;
            if (botLen > 0) ctx.fillRect(x + rBL, y + h - 1, botLen, 1);

            var leftLen = h - rTL - rBL;
            if (leftLen > 0) ctx.fillRect(x, y + rTL, 1, leftLen);

            var rightLen = h - rTR - rBR;
            if (rightLen > 0) ctx.fillRect(x + w - 1, y + rTR, 1, rightLen);

            var i;
            for (i = 0; i < rTL; i++) ctx.fillRect(x + i,             y + rTL - 1 - i, 1, 1);
            for (i = 0; i < rTR; i++) ctx.fillRect(x + w - rTR + i,   y + i,           1, 1);
            for (i = 0; i < rBL; i++) ctx.fillRect(x + i,             y + h - rBL + i, 1, 1);
            for (i = 0; i < rBR; i++) ctx.fillRect(x + w - rBR + i,   y + h - 1 - i,   1, 1);
        }

        // Bottom shadow line: 1px tall, at y+h (one row below the frame).
        // Left inset: cornerRadius. Length: width - 2*cornerRadius + 1 so
        // it extends one column further right, meeting the BR corner.
        var shadowLen = w - 2 * r + 1;
        if (shadowLen > 0) {
            ctx.fillStyle = this.strokeColor;
            ctx.fillRect(x + r, y + h, shadowLen, 1);
        }

        // Right shadow line: 1px wide, at x+w (one column right of the frame).
        // Top inset: cornerRadius. Length: height - 2*cornerRadius + 1 so
        // it extends one row further down, meeting the BR corner.
        var shadowVLen = h - 2 * r + 1;
        if (shadowVLen > 0) {
            ctx.fillStyle = this.strokeColor;
            ctx.fillRect(x + w, y + r, 1, shadowVLen);
        }

        // Two corner pixels at the bottom-right: inset (right 2 / bottom 1)
        // and (right 1 / bottom 2) from the container edges. They fill the
        // cut-corner region to give the selection frame extra weight there.
        ctx.fillStyle = this.strokeColor;
        ctx.fillRect(x + w - 2, y + h - 1, 1, 1);
        ctx.fillRect(x + w - 1, y + h - 2, 1, 1);

        // Right-side chevron: a solid black bar `chevronWidth` px wide
        // anchored to the frame's right edge, with a ">" glyph centred
        // inside. The bar respects the TR and BR rounded corners so it
        // blends into the frame silhouette rather than squaring it off.
        if (this.showChevron && this.chevronWidth > 0) {
            var cw = this.chevronWidth;
            ctx.fillStyle = this.chevronColor;
            for (var cy = 0; cy < h; cy++) {
                var ri = 0;
                if (cy < rTR)      ri = Math.max(ri, rTR - 1 - cy);
                if (cy >= h - rBR) ri = Math.max(ri, cy - (h - rBR));
                var barStart = w - cw;
                if (barStart < 0) barStart = 0;
                var barEnd = w - 1 - ri;
                var barW = barEnd - barStart + 1;
                if (barW > 0) ctx.fillRect(x + barStart, y + cy, barW, 1);
            }

            // ">" glyph centred in the bar. HaxrcorpFont16 glyphs render
            // inside an 11-row frame with the visible cap at row 2, so
            // shift the draw y by −2 so the cap top lands at the bar's
            // visual centre.
            if (typeof HaxrcorpFont16 !== 'undefined') {
                var glyph = '>';
                var glyphW = HaxrcorpFont16.textWidth(glyph);
                var glyphX = x + (w - cw) + Math.floor((cw - glyphW) / 2) + 1;
                var glyphY = y + Math.floor((h - 7) / 2) - 2;
                HaxrcorpFont16.draw(canvas.ctx, glyph, glyphX, glyphY, this.chevronGlyphColor);
            }
        }
    };

    ComponentSelectorFrame.prototype.setPosition = function(x, y) { this.x = x; this.y = y; };
    ComponentSelectorFrame.prototype.setSize = function(w, h) { this.width = w; this.height = h; };
    ComponentSelectorFrame.prototype.setFillColor = function(c) { this.fillColor = c; };
    ComponentSelectorFrame.prototype.setStrokeColor = function(c) { this.strokeColor = c; };
    ComponentSelectorFrame.prototype.setShowFill = function(b) { this.showFill = !!b; };
    ComponentSelectorFrame.prototype.setShowStroke = function(b) { this.showStroke = !!b; };
    ComponentSelectorFrame.prototype.setCornerRadius = function(r) { this.cornerRadius = r; };
    ComponentSelectorFrame.prototype.setCorner = function(which, enabled) { this.corners[which] = !!enabled; };
    ComponentSelectorFrame.prototype.setAnchor = function(h, v) {
        if (h) this.anchorH = h;
        if (v) this.anchorV = v;
    };
    ComponentSelectorFrame.prototype.setShowChevron       = function(b) { this.showChevron = !!b; };
    ComponentSelectorFrame.prototype.setChevronWidth      = function(n) { this.chevronWidth = n; };
    ComponentSelectorFrame.prototype.setChevronColor      = function(c) { this.chevronColor = c; };
    ComponentSelectorFrame.prototype.setChevronGlyphColor = function(c) { this.chevronGlyphColor = c; };

    return ComponentSelectorFrame;
})();

ComponentSelectorFrame.tweakables = [
    { section: 'position' },
    { key: 'x',            type: 'range', min: 0, max: 256, default: 6 },
    { key: 'y',            type: 'range', min: 0, max: 144, default: 6 },
    { section: 'size' },
    { key: 'width',        type: 'range', min: 1, max: 256, default: 244 },
    { key: 'height',       type: 'range', min: 1, max: 144, default: 22 },
    { section: 'anchor' },
    { key: 'anchorH',      type: 'enum', options: ['left', 'center', 'right'],  default: 'left', label: 'horizontal' },
    { key: 'anchorV',      type: 'enum', options: ['top', 'center', 'bottom'],  default: 'top',  label: 'vertical' },
    { section: 'fill' },
    { key: 'showFill',     type: 'bool',  default: true, label: 'show fill' },
    { key: 'fillColor',    type: 'color', default: '#ffffff' },
    { section: 'stroke' },
    { key: 'showStroke',   type: 'bool',  default: true, label: 'show stroke' },
    { key: 'strokeColor',  type: 'color', default: '#000000' },
    { section: 'corners' },
    { key: 'cornerRadius', type: 'enum', options: [0, 3, 4], default: 3, label: 'radius' },
    { key: 'corners.tl',   type: 'bool', default: true, label: 'top-left' },
    { key: 'corners.tr',   type: 'bool', default: true, label: 'top-right' },
    { key: 'corners.bl',   type: 'bool', default: true, label: 'bottom-left' },
    { key: 'corners.br',   type: 'bool', default: true, label: 'bottom-right' },
    { section: 'chevron' },
    { key: 'showChevron',       type: 'bool',  default: true, label: 'show chevron' },
    { key: 'chevronWidth',      type: 'range', min: 0, max: 16, default: 6, label: 'bar width' },
    { key: 'chevronColor',      type: 'color', default: '#000000', label: 'bar color' },
    { key: 'chevronGlyphColor', type: 'color', default: '#ffffff', label: 'glyph color' }
];
