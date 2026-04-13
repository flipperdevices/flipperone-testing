var DesktopScene = (function() {
    var BTN_W = 48;
    var BTN_GAP = 2;

    function DesktopScene(sceneManager) {
        this.sceneManager = sceneManager;

        // App-defined buttons: [left, middle (Edit/Menu), middle, middle, right]
        var self = this;
        this.app_defined_buttons = [
            null,
            new UI.MiddleButton('Menu', 1, BTN_W, BTN_GAP, 'edit', function() { self._onMenu(); }),
            null,
            null,
            null
        ];

        // Build action → button lookup
        this.btnActionMap = {};
        for (var i = 0; i < this.app_defined_buttons.length; i++) {
            var btn = this.app_defined_buttons[i];
            if (btn && btn.action) this.btnActionMap[btn.action] = btn;
        }
    }

    DesktopScene.prototype.enter = function() {};
    DesktopScene.prototype.exit = function() {};

    DesktopScene.prototype._onMenu = function() {
        this.sceneManager.push(new MenuScene(this.sceneManager));
    };

    DesktopScene.prototype.handleInput = function(action) {
        // Check if action maps to a button
        var btn = this.btnActionMap[action];
        if (btn) {
            var self = this;
            btn.press();
            if (btn.onPress) btn.onPress();
            setTimeout(function() { btn.release(); }, 50);
            return;
        }
    };

    DesktopScene.prototype.render = function(canvas) {
        canvas.clear('#fff');

        // Draw dolphin sprite at bottom-left corner, shifted left
        var dolphinX = -28;  // 28px off-screen to the left
        var dolphinY = canvas.h - Dolphins.sprite.h;  // Bottom edge (30px from top)
        canvas.drawSprite(Dolphins.sprite, dolphinX, dolphinY, '#000');

        // Status bar (overlays on top of dolphin)
        UI.drawStatusBar(canvas, 'FLIPPER ONE');

        // Render buttons
        for (var b = 0; b < this.app_defined_buttons.length; b++) {
            var btn = this.app_defined_buttons[b];
            if (btn) btn.render(canvas);
        }
    };

    return DesktopScene;
})();
