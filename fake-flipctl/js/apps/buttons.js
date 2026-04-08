var ButtonsTestScene = (function() {
    var history = [];
    var MAX_HISTORY = 11;
    var backCount = 0;
    var BACK_EXIT = 3;

    function ButtonsTestScene() {}

    ButtonsTestScene.prototype.enter = function() {
        history = [];
        backCount = 0;
    };

    ButtonsTestScene.prototype.exit = function() {};

    ButtonsTestScene.prototype.handleInput = function(action, rawKey) {
        var label = rawKey ? rawKey.toUpperCase() : action.toUpperCase();
        // Show both raw key and action if they differ
        if (rawKey && action !== rawKey && action !== rawKey.toLowerCase()) {
            label = rawKey.toUpperCase() + ' -> ' + action.toUpperCase();
        }

        history.unshift(label);
        if (history.length > MAX_HISTORY) history.pop();

        if (action === 'back') {
            backCount++;
            if (backCount >= BACK_EXIT) return 'pop';
        } else {
            backCount = 0;
        }
    };

    ButtonsTestScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Buttons Test');

        var y = UI.STATUS_BAR_H + 3;
        var lineH = 10;

        if (history.length === 0) {
            canvas.drawText('Press any button...', 4, y, '#888');
            y += lineH + 6;
            canvas.drawText('Press BACK x3 to exit', 4, y, '#888');
            return;
        }

        // Latest press shown large
        canvas.drawText(history[0], 4, y, '#fff', 2);
        y += 20;

        // History
        for (var i = 1; i < history.length; i++) {
            var age = i;
            var color = age <= 2 ? '#888' : '#555';
            canvas.drawText(history[i], 4, y, color);
            y += lineH;
            if (y > canvas.h - 10) break;
        }

        // Back counter hint
        if (backCount > 0 && backCount < BACK_EXIT) {
            var hint = 'BACK x' + (BACK_EXIT - backCount) + ' to exit';
            var tw = canvas.textWidth(hint);
            canvas.drawText(hint, canvas.w - tw - 4, canvas.h - 9, '#888');
        }
    };

    return ButtonsTestScene;
})();
