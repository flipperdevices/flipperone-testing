// Icon bitmap definitions (16x16 max)
// Similar to font.js but for UI icons
// Usage: IconManager.draw(canvas.ctx, Icons.back, x, y, '#000');

var Icons = (function() {
    // back icon (16x16) - arrow pointing left with circle
    var back = {
        w: 16,
        h: 16,
        d: [
            0x3c0,
            0xc30,
            0x1008,
            0x2004,
            0x4202,
            0x4402,
            0x8fc1,
            0x8421,
            0x8211,
            0x8011,
            0x4022,
            0x43c2,
            0x2004,
            0x1008,
            0xc30,
            0x3c0
        ]
    };

    return {
        back: back
    };
})();
