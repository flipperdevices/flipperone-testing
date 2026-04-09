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

    // Boot mode icons (14x14 pixels)
    var router = {
        w: 14,
        h: 14,
        d: [
            0x0,
            0x3e0,
            0x410,
            0x9c8,
            0x220,
            0x80,
            0x0,
            0x0,
            0xffc,
            0x1c1a,
            0x3c1e,
            0x1c1e,
            0xffe,
            0x0
        ]
    };

    var media = {
        w: 14,
        h: 14,
        d: [
            0x3fff,
            0x3807,
            0x2805,
            0x3907,
            0x2985,
            0x39c7,
            0x29e5,
            0x39e7,
            0x29c5,
            0x3987,
            0x2905,
            0x3807,
            0x2805,
            0x3fff
        ]
    };

    var desktop = {
        w: 14,
        h: 14,
        d: [
            0x3fff,
            0x2001,
            0x2001,
            0x2001,
            0x2001,
            0x2001,
            0x2001,
            0x3fff,
            0x2001,
            0x3fff,
            0x1e0,
            0x7f8,
            0x0,
            0x1ffe
        ]
    };

    var minimal = {
        w: 14,
        h: 14,
        d: [
            0xffc,
            0x1002,
            0x2001,
            0x2401,
            0x2201,
            0x2101,
            0x2201,
            0x2479,
            0x2001,
            0x2001,
            0x2001,
            0x2001,
            0x1002,
            0xffc
        ]
    };

    var sdcard = {
        w: 14,
        h: 14,
        d: [
            0x0,
            0x0,
            0x3e70,
            0x3fff,
            0x3ff3,
            0x3fff,
            0x3ff3,
            0x3fff,
            0x3ff3,
            0x3fff,
            0x3ff3,
            0x3fff,
            0x0,
            0x0
        ]
    };

    return {
        back: back,
        router: router,
        media: media,
        desktop: desktop,
        minimal: minimal,
        sdcard: sdcard
    };
})();
