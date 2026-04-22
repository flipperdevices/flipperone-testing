/**
 * ResponsiveFrame
 *
 * Configurable rectangular frame with fill, optional 1px stroke, and
 * per-corner rounded corners. Anchor controls which point on the frame
 * the (x, y) coordinate represents.
 *
 *   anchorH: 'left' | 'center' | 'right'
 *   anchorV: 'top'  | 'center' | 'bottom'
 *
 * Requires RoundCorner.js to be loaded first.
 */
var ResponsiveFrame = (function() {
    function ResponsiveFrame(options) {
        options = options || {};
        this.x = options.x !== undefined ? options.x : 0;
        this.y = options.y !== undefined ? options.y : 0;
        this.width = options.width !== undefined ? options.width : 244;
        this.height = options.height !== undefined ? options.height : 22;
        this.fillColor = options.fillColor || '#ffffff';
        this.strokeColor = options.strokeColor || '#000000';
        this.showStroke = options.showStroke !== undefined ? options.showStroke : true;
        this.cornerRadius = options.cornerRadius !== undefined ? options.cornerRadius : 3;
        this.corners = options.corners || { tl: true, tr: true, bl: true, br: true };
        this.anchorH = options.anchorH || 'left';
        this.anchorV = options.anchorV || 'top';

        this._rc = {
            tl: new RoundCorner({ orientation: 'tl', color: 'transparent' }),
            tr: new RoundCorner({ orientation: 'tr', color: 'transparent' }),
            bl: new RoundCorner({ orientation: 'bl', color: 'transparent' }),
            br: new RoundCorner({ orientation: 'br', color: 'transparent' })
        };
    }

    function anchorOffset(anchor, size) {
        if (anchor === 'center') return Math.floor(size / 2);
        if (anchor === 'right' || anchor === 'bottom') return size;
        return 0;
    }

    ResponsiveFrame.prototype._origin = function() {
        return {
            x: this.x - anchorOffset(this.anchorH, this.width),
            y: this.y - anchorOffset(this.anchorV, this.height)
        };
    };

    ResponsiveFrame.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        var o = this._origin();
        var x = o.x, y = o.y;
        var w = this.width, h = this.height;
        var r = this.cornerRadius;

        var rTL = (r > 0 && this.corners.tl) ? r : 0;
        var rTR = (r > 0 && this.corners.tr) ? r : 0;
        var rBL = (r > 0 && this.corners.bl) ? r : 0;
        var rBR = (r > 0 && this.corners.br) ? r : 0;

        ctx.fillStyle = this.fillColor;
        ctx.fillRect(x, y, w, h);

        if (rTL) { this._rc.tl.setRadius(rTL); this._rc.tl.setPosition(x, y);               this._rc.tl.render(canvas); }
        if (rTR) { this._rc.tr.setRadius(rTR); this._rc.tr.setPosition(x + w - rTR, y);     this._rc.tr.render(canvas); }
        if (rBL) { this._rc.bl.setRadius(rBL); this._rc.bl.setPosition(x, y + h - rBL);     this._rc.bl.render(canvas); }
        if (rBR) { this._rc.br.setRadius(rBR); this._rc.br.setPosition(x + w - rBR, y + h - rBR); this._rc.br.render(canvas); }

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
    };

    ResponsiveFrame.prototype.setPosition = function(x, y) { this.x = x; this.y = y; };
    ResponsiveFrame.prototype.setSize = function(w, h) { this.width = w; this.height = h; };
    ResponsiveFrame.prototype.setFillColor = function(c) { this.fillColor = c; };
    ResponsiveFrame.prototype.setStrokeColor = function(c) { this.strokeColor = c; };
    ResponsiveFrame.prototype.setShowStroke = function(b) { this.showStroke = !!b; };
    ResponsiveFrame.prototype.setCornerRadius = function(r) { this.cornerRadius = r; };
    ResponsiveFrame.prototype.setCorner = function(which, enabled) { this.corners[which] = !!enabled; };
    ResponsiveFrame.prototype.setAnchor = function(h, v) {
        if (h) this.anchorH = h;
        if (v) this.anchorV = v;
    };

    return ResponsiveFrame;
})();
