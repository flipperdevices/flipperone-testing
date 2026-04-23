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

        // Hostname lines — populated asynchronously via /api/hostname
        this.hostnameLine1 = '';
        this.hostnameLine2 = '';
    }

    DesktopScene.prototype._fetchHostname = function() {
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/hostname', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status !== 200) return;
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
            self._setHostname(data.hostname || '');
        };
        xhr.send();
    };

    DesktopScene.prototype._setHostname = function(raw) {
        // Expected format: flipperone-<id>-build-<rest>
        // e.g. flipperone-3c6d04-build-1049-test-dp-exp
        var m = raw.match(/^flipperone-([^-]+)-build-(.+)$/i);
        if (m) {
            this.hostnameLine1 = 'Flipper One ' + m[1];
            this.hostnameLine2 = 'Build ' + m[2];
        } else {
            this.hostnameLine1 = raw;
            this.hostnameLine2 = '';
        }
    };

    DesktopScene.prototype.enter = function() {
        // Pick a random phrase and create message box each time we enter
        var phrase = this.phrases[Math.floor(Math.random() * this.phrases.length)];
        this.messageBox = new MessageBox({
            text: phrase,
            tailX: 113,
            tailY: 82,
            bottomY: 86
        });

        this._fetchHostname();
    };
    DesktopScene.prototype.exit = function() {};

    DesktopScene.prototype._onMenu = function() {
        this.sceneManager.push(new MenuScene(this.sceneManager));
    };

    DesktopScene.prototype.handleInput = function(action) {
        // ok / run open the Main Menu (same effect as tapping the
        // existing "Menu" button via its 'edit' action).
        if (action === 'ok' || action === 'run') {
            this._onMenu();
            return;
        }

        // Check if action maps to a button
        var btn = this.btnActionMap[action];
        if (btn) {
            var self = this;
            btn.press();
            if (btn.onPress) btn.onPress();
            setTimeout(function() { btn.release(); }, 30);
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

        // Status bar (overlays on top of dolphin). Desktop uses a
        // light theme — #EEEEEE bar with black foreground elements.
        UI.drawStatusBar(canvas, '', { bg: '#EEEEEE', fg: '#000' });

        // Draw profile info: "Profile: Router" on the right, under status bar
        var profileText = 'Profile: Router';
        var profileY = 12;  // Under status bar, 4px higher
        var profileWidth = HaxrcorpFont16.textWidth(profileText);
        var profileX = canvas.w - profileWidth - 2;  // 2px margin from right edge
        HaxrcorpFont16.draw(canvas.ctx, profileText, profileX, profileY, '#CCCCCC');

        // Hostname, right-aligned. Bottom line sits 25px from the bottom;
        // glyphs are 7px tall, so a 5px gap between lines means 12px between tops.
        var hostLine2Y = canvas.h - 35;
        var hostLine1Y = hostLine2Y - 12;
        if (this.hostnameLine1) {
            var hx1 = canvas.w - HaxrcorpFont16.textWidth(this.hostnameLine1) - 2;
            HaxrcorpFont16.draw(canvas.ctx, this.hostnameLine1, hx1, hostLine1Y, '#CCCCCC');
        }
        if (this.hostnameLine2) {
            var hx2 = canvas.w - HaxrcorpFont16.textWidth(this.hostnameLine2) - 2;
            HaxrcorpFont16.draw(canvas.ctx, this.hostnameLine2, hx2, hostLine2Y, '#CCCCCC');
        }

        // Render buttons
        for (var b = 0; b < this.app_defined_buttons.length; b++) {
            var btn = this.app_defined_buttons[b];
            if (btn) btn.render(canvas);
        }
    };

    return DesktopScene;
})();
