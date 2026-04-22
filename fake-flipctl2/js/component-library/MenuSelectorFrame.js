/**
 * MenuSelectorFrame
 *
 * Selection frame for menu entries. Starts as a duplicate of
 * ResponsiveFrame; will diverge as menu-selector-specific behavior is
 * added.
 *
 *   anchorH: 'left' | 'center' | 'right'
 *   anchorV: 'top'  | 'center' | 'bottom'
 *
 * Rendering paints only the body pixels of the rounded rectangle;
 * cut-corner pixels are never touched, so whatever was drawn on the
 * canvas underneath shows through naturally in any context.
 */
var MenuSelectorFrame = (function() {
    function MenuSelectorFrame(options) {
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
    }

    function anchorOffset(anchor, size) {
        if (anchor === 'center') return Math.floor(size / 2);
        if (anchor === 'right' || anchor === 'bottom') return size;
        return 0;
    }

    MenuSelectorFrame.prototype._origin = function() {
        return {
            x: this.x - anchorOffset(this.anchorH, this.width),
            y: this.y - anchorOffset(this.anchorV, this.height)
        };
    };

    MenuSelectorFrame.prototype.render = function(canvas) {
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
        // Left inset: cornerRadius. Length: width - 2*cornerRadius.
        var shadowLen = w - 2 * r;
        if (shadowLen > 0) {
            ctx.fillStyle = this.strokeColor;
            ctx.fillRect(x + r, y + h, shadowLen, 1);
        }
    };

    MenuSelectorFrame.prototype.setPosition = function(x, y) { this.x = x; this.y = y; };
    MenuSelectorFrame.prototype.setSize = function(w, h) { this.width = w; this.height = h; };
    MenuSelectorFrame.prototype.setFillColor = function(c) { this.fillColor = c; };
    MenuSelectorFrame.prototype.setStrokeColor = function(c) { this.strokeColor = c; };
    MenuSelectorFrame.prototype.setShowFill = function(b) { this.showFill = !!b; };
    MenuSelectorFrame.prototype.setShowStroke = function(b) { this.showStroke = !!b; };
    MenuSelectorFrame.prototype.setCornerRadius = function(r) { this.cornerRadius = r; };
    MenuSelectorFrame.prototype.setCorner = function(which, enabled) { this.corners[which] = !!enabled; };
    MenuSelectorFrame.prototype.setAnchor = function(h, v) {
        if (h) this.anchorH = h;
        if (v) this.anchorV = v;
    };

    return MenuSelectorFrame;
})();

MenuSelectorFrame.tweakables = [
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
    { key: 'corners.br',   type: 'bool', default: true, label: 'bottom-right' }
];
