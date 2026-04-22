/**
 * RoundCorner
 *
 * Corner cutout for rounding the corner of a filled shape. Drawn as a
 * pixel-art anti-shape: when placed at a corner of a filled rectangle
 * with color set to the background, it carves a rounded corner.
 *
 * Supported radii: 3, 4.
 * Supported orientations: 'tl', 'tr', 'bl', 'br' — names the corner
 * that is cut off.
 */
var RoundCorner = (function() {
    var FILL_RULES = {
        tl: function(dx, dy, r) { return dx + dy < r - 1; },
        tr: function(dx, dy, r) { return dy < dx; },
        bl: function(dx, dy, r) { return dx < dy; },
        br: function(dx, dy, r) { return dx + dy > r - 1; }
    };

    function RoundCorner(options) {
        options = options || {};
        this.x = options.x !== undefined ? options.x : 0;
        this.y = options.y !== undefined ? options.y : 0;
        this.radius = options.radius !== undefined ? options.radius : 3;
        this.orientation = options.orientation || 'tl';
        this.color = options.color || '#fff';
    }

    RoundCorner.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        var rule = FILL_RULES[this.orientation] || FILL_RULES.tl;
        var r = this.radius;
        var transparent = this.color === null || this.color === 'transparent';
        if (!transparent) ctx.fillStyle = this.color;
        for (var dy = 0; dy < r; dy++) {
            for (var dx = 0; dx < r; dx++) {
                if (rule(dx, dy, r)) {
                    if (transparent) {
                        ctx.clearRect(this.x + dx, this.y + dy, 1, 1);
                    } else {
                        ctx.fillRect(this.x + dx, this.y + dy, 1, 1);
                    }
                }
            }
        }
    };

    RoundCorner.prototype.setPosition = function(x, y) {
        this.x = x;
        this.y = y;
    };

    RoundCorner.prototype.setRadius = function(r) {
        this.radius = r;
    };

    RoundCorner.prototype.setOrientation = function(o) {
        this.orientation = o;
    };

    return RoundCorner;
})();
