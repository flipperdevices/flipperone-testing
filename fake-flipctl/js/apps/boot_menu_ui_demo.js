var UIDemoScene = (function() {
    var FONT_H   = 11;
    var PAD_X    = 4;
    var PAD_Y    = 1;
    var RADIUS   = 2;
    var COLOR_DIM = '#EAEAEA';  // shade of white for unselected items

    var STATE_DEFAULT  = 'default';
    var STATE_SELECTED = 'selected';
    var STATE_PRESSED  = 'pressed';

    function MenuItem(text) {
        this.text  = text;
        this.w     = 150;
        this.h     = FONT_H + PAD_Y * 2;
        this.state = STATE_DEFAULT;
    }

    MenuItem.prototype.render = function(canvas, x, y) {
        if (this.state === STATE_DEFAULT) {
            canvas.drawRoundRect(x, y, this.w, this.h, RADIUS, COLOR_DIM);
            HaxrcorpFont16.draw(canvas.ctx, this.text, x + PAD_X, y + PAD_Y, '#000');
        } else if (this.state === STATE_SELECTED) {
            canvas.drawRoundFrame(x, y, this.w, this.h, RADIUS, '#000');
            HaxrcorpFont16.draw(canvas.ctx, this.text, x + PAD_X, y + PAD_Y, '#000');
        } else if (this.state === STATE_PRESSED) {
            canvas.drawRoundRect(x, y, this.w, this.h, RADIUS, '#000');
            HaxrcorpFont16.draw(canvas.ctx, this.text, x + PAD_X, y + PAD_Y, '#fff');
        }
    };

    // ---

    var ITEM_SPACING = 1;
    var BTN_W   = 48;
    var BTN_GAP = 2;  // 5 × 48 + 4 × 4 = 256px exactly

    function UIDemoScene() {
        this.items = [
            new MenuItem('Router'),
            new MenuItem('TV Media Box'),
            new MenuItem('Desktop Computer')
        ];
        this.selectedIndex = 0;
        this.items[this.selectedIndex].state = STATE_SELECTED;
        this.popup = null;  // active PopupMenuLeft, or null
        this.popupClosing = false;  // Show Close button feedback while closing
        this.keyboard = null;  // active Keyboard, or null
        this.keyboardClosing = false;  // Show Close button feedback while closing keyboard
        this.inputText = '';  // Text entered via keyboard
        this.cursor = null;  // Blinking cursor for text input

        // ── App-defined buttons ───────────────────────────────────────────────
        // Each button maps to an input action (see input.js KEY_MAP).
        // Pressing the key triggers the button animation + onPress callback.
        var self = this;
        var editBtn = new UI.MiddleButton('Edit', 1, BTN_W, BTN_GAP, 'edit', function() { self._onEdit(); });
        this._editBtn = editBtn;
        var closeBtn = new UI.LeftButton('Close', BTN_W, 'esc', function() { /* popup handles esc */ });
        this._closeBtn = closeBtn;
        var doneBtn = new UI.RightButton('Done', BTN_W, 'ok', function() { /* keyboard handles ok */ });
        this._doneBtn = doneBtn;
        this.app_defined_buttons = [
            new UI.LeftButton  ('OFF',   BTN_W,             'esc',   function() { self._onEsc();  }),
            editBtn,
            null,
            null,
            new UI.RightButton ('Run',   BTN_W,             'run',   function() { self._onRun();  }),
        ];

        // Build action → button lookup
        this.btnActionMap = {};
        for (var i = 0; i < this.app_defined_buttons.length; i++) {
            var btn = this.app_defined_buttons[i];
            if (btn && btn.action) this.btnActionMap[btn.action] = btn;
        }
    }

    // ── Button handlers ───────────────────────────────────────────────────────
    UIDemoScene.prototype._onEsc   = function() { /* TODO */ };
    UIDemoScene.prototype._onDone  = function() {
        if (this.keyboard) {
            this.keyboard = null;
        }
    };
    UIDemoScene.prototype._onEdit  = function() {
        var self = this;
        // Open keyboard with full qwerty layout
        this.keyboard = new UI.Keyboard(
            [
                ['q','w','e','r','t','y','u','i','o','p','['],
                ['a','s','d','f','g','h','j','k','l',':',']'],
                ['z','x','c','v','b','n','m',',','.','/','?',' ']
            ],
            function(char) {
                if (char === '\b') {
                    // Backspace: remove last character (back key / N)
                    self.inputText = self.inputText.slice(0, -1);
                } else {
                    self.inputText += char;
                }
                // Reset cursor blink on input
                if (self.cursor) self.cursor.reset();
                // Keep keyboard open
            },
            function() {
                self.keyboard = null;
                self.cursor = null;
            }
        );
        // Create blinking cursor with 500ms blink interval
        this.cursor = new BlinkingKeyboardCursor(500);
    };
    UIDemoScene.prototype._onPower = function() { /* TODO */ };
    UIDemoScene.prototype._onView  = function() { /* TODO */ };
    UIDemoScene.prototype._onRun   = function() { /* TODO */ };

    UIDemoScene.prototype.enter = function() {};
    UIDemoScene.prototype.exit = function() {};

    UIDemoScene.prototype.handleInput = function(action) {
        // If keyboard is open, handle Close/Done buttons and keyboard input
        if (this.keyboard) {
            if (action === 'esc') {
                var self = this;
                // Show feedback on Close button while closing keyboard
                this._closeBtn.press();
                this.keyboard = null;
                this.keyboardClosing = true;
                setTimeout(function() {
                    self._closeBtn.release();
                    self.keyboardClosing = false;
                }, 150);
            } else if (action === 'ok') {
                // Let keyboard handle ok (add character)
                this.keyboard.handleInput(action);
            } else {
                // Let keyboard handle navigation
                this.keyboard.handleInput(action);
            }
            return;
        }

        // If popup is open, handle Close button feedback and close immediately
        if (this.popup) {
            if (action === 'esc') {
                // Show feedback on Close button while closing popup
                this._closeBtn.press();
                this.popup.handleInput('esc');  // Close popup immediately
                this.popupClosing = true;
                var self = this;
                setTimeout(function() {
                    self._closeBtn.release();
                    self.popupClosing = false;
                }, 150);
            } else {
                this.popup.handleInput(action);
            }
            return;
        }

        // Check if action maps to a button
        var btn = this.btnActionMap[action];
        if (btn) {
            var self = this;
            btn.press();
            if (btn.onPress) btn.onPress();
            setTimeout(function() { btn.release(); }, 150);
            return;
        }

        if (action === 'up' || action === 'down') {
            this.items[this.selectedIndex].state = STATE_DEFAULT;
            var len = this.items.length;
            this.selectedIndex = (this.selectedIndex + (action === 'down' ? 1 : -1) + len) % len;
            this.items[this.selectedIndex].state = STATE_SELECTED;
        } else if (action === 'ok') {
            var self = this;
            this.items[this.selectedIndex].state = STATE_PRESSED;
            setTimeout(function() {
                self.items[self.selectedIndex].state = STATE_SELECTED;
            }, 200);
        }
    };

    UIDemoScene.prototype.render = function(canvas) {
        canvas.clear('#ffffff');
        var totalH = this.items.length * this.items[0].h + (this.items.length - 1) * ITEM_SPACING;
        var startX = Math.floor((canvas.w - this.items[0].w) / 2);
        var startY = Math.floor((canvas.h - totalH) / 2);

        for (var i = 0; i < this.items.length; i++) {
            var y = startY + i * (this.items[0].h + ITEM_SPACING);
            this.items[i].render(canvas, startX, y);
        }

        // Render buttons (skip Edit button when popup is open)
        for (var b = 0; b < this.app_defined_buttons.length; b++) {
            var btn = this.app_defined_buttons[b];
            if (!btn) continue;
            if (this.popup && btn === this._editBtn) continue;
            btn.render(canvas);
        }

        // Render keyboard if open
        if (this.keyboard) {
            // Update cursor blink state
            if (this.cursor) this.cursor.update();

            // Draw white overlay
            canvas.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
            canvas.ctx.fillRect(0, 0, canvas.w, canvas.h);
            // Render keyboard
            this.keyboard.render(canvas);
            // Draw input text at top
            HaxrcorpFont16.draw(canvas.ctx, this.inputText, 10, 10, '#000');
            // Draw blinking cursor after text
            if (this.cursor && this.cursor.isVisible()) {
                var cursorX = 10 + HaxrcorpFont16.textWidth(this.inputText);
                canvas.drawCursor(cursorX, 10, 1, 11, '#000');
            }
            // Render Close and Done buttons
            this._closeBtn.render(canvas);
            this._doneBtn.render(canvas);
            return;  // Don't render menu when keyboard is open
        } else if (this.keyboardClosing) {
            // Show only Close button feedback, no overlay or keyboard
            this._closeBtn.render(canvas);
        }

        // Render popup with semi-transparent white overlay
        if (this.popup) {
            // Draw white overlay with 75% opacity (25% transparency)
            canvas.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
            canvas.ctx.fillRect(0, 0, canvas.w, canvas.h);
            // Render popup on top
            this.popup.render(canvas);
            // Render Close button (left button, on top of OFF) with feedback
            this._closeBtn.render(canvas);
        } else if (this.popupClosing) {
            // Show only Close button feedback, no overlay
            this._closeBtn.render(canvas);
        }
    };

    return UIDemoScene;
})();
