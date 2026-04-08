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

        // ── App-defined buttons ───────────────────────────────────────────────
        // Each button maps to an input action (see input.js KEY_MAP).
        // Pressing the key triggers the button animation + onPress callback.
        var self = this;
        var editBtn = new UI.MiddleButton('Edit', 1, BTN_W, BTN_GAP, 'edit', function() { self._onEdit(); });
        this._editBtn = editBtn;
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
    UIDemoScene.prototype._onEdit  = function() {
        var self = this;
        this.popup = new UI.PopupMenuLeft(
            ['Rename', 'Clone', 'Reset to default'],
            this._editBtn.x,
            BTN_W,
            'Edit',  // button text for the tab
            function(idx) { self.popup = null; /* TODO: handle idx */ },
            function() { self.popup = null; }
        );
    };
    UIDemoScene.prototype._onPower = function() { /* TODO */ };
    UIDemoScene.prototype._onView  = function() { /* TODO */ };
    UIDemoScene.prototype._onRun   = function() { /* TODO */ };

    UIDemoScene.prototype.enter = function() {};
    UIDemoScene.prototype.exit = function() {};

    UIDemoScene.prototype.handleInput = function(action) {
        // If popup is open, route all input to it
        if (this.popup) {
            this.popup.handleInput(action);
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

        // Render popup on top (replaces Edit button)
        if (this.popup) this.popup.render(canvas);
    };

    return UIDemoScene;
})();
