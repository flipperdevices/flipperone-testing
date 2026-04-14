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

        // Phrases dictionary for the message box
        this.phrases = [
            "Hello, I'm totally Fake",
            "Never gonna give you up\nNever gonna let you down!",
            "Sorry, I'm busy right now.\nI need to check every pixel\nbuilded by JS.",
            "67",
            "The answer is: 42",
            "Send nudes!",
            "As my grandpa always said,\nclick-click-click."
        ];

        // Initialize message box (will be updated in enter())
        this.messageBox = null;
    }

    DesktopScene.prototype.enter = function() {
        // Pick a random phrase and create message box each time we enter
        var phrase = this.phrases[Math.floor(Math.random() * this.phrases.length)];
        this.messageBox = new MessageBox({
            text: phrase,
            tailX: 113,
            tailY: 82,
            bottomY: 86
        });
    };
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

        // Render message box component
        this.messageBox.render(canvas);

        // Status bar (overlays on top of dolphin)
        UI.drawStatusBar(canvas, '');

        // Render buttons
        for (var b = 0; b < this.app_defined_buttons.length; b++) {
            var btn = this.app_defined_buttons[b];
            if (btn) btn.render(canvas);
        }
    };

    return DesktopScene;
})();
