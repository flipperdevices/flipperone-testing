var ScreenTestScene = (function() {
    function ScreenTestScene() {}

    ScreenTestScene.prototype.enter = function() {};
    ScreenTestScene.prototype.exit = function() {};

    ScreenTestScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
    };

    ScreenTestScene.prototype.render = function(canvas) {
        var w = canvas.w;
        var h = canvas.h;

        // Black background
        canvas.drawRect(0, 0, w, h, '#000');

        // 1px white border
        canvas.drawHLine(0, 0, w, '#fff');
        canvas.drawHLine(0, h - 1, w, '#fff');
        canvas.drawVLine(0, 0, h, '#fff');
        canvas.drawVLine(w - 1, 0, h, '#fff');

        // Diagonal cross
        for (var i = 0; i < w; i++) {
            var y1 = Math.round(i * (h - 1) / (w - 1));
            canvas.drawPixel(i, y1, '#fff');
            var y2 = h - 1 - y1;
            canvas.drawPixel(i, y2, '#fff');
        }

        // Center crosshair
        var cx = Math.floor(w / 2);
        var cy = Math.floor(h / 2);
        canvas.drawHLine(cx - 10, cy, 21, '#fff');
        canvas.drawVLine(cx, cy - 10, 21, '#fff');

        // Corner labels
        canvas.drawText('0,0', 2, 2, '#fff');
        var tr = (w - 1) + ',' + 0;
        canvas.drawText(tr, w - 2 - tr.length * 6, 2, '#fff');
        var bl = 0 + ',' + (h - 1);
        canvas.drawText(bl, 2, h - 9, '#fff');
        var br = (w - 1) + ',' + (h - 1);
        canvas.drawText(br, w - 2 - br.length * 6, h - 9, '#fff');
    };

    return ScreenTestScene;
})();
