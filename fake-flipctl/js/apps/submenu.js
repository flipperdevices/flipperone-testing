var SubMenuScene = (function() {
    var FONT_H = 11;
    var PAD_X = 6;
    var RADIUS = 2;
    var ITEM_W = 240;
    var ITEM_H_REGULAR = 19;
    var ITEM_H_LAST = 18;
    var BTN_W = 48;

    var STATE_DEFAULT = 'default';
    var STATE_SELECTED = 'selected';
    var STATE_PRESSED = 'pressed';

    function MenuItem(text, isLast, icon) {
        this.text = text;
        this.w = ITEM_W;
        this.h = isLast ? ITEM_H_LAST : ITEM_H_REGULAR;
        this.state = STATE_DEFAULT;
        this.icon = icon || null;
        this.isLast = isLast || false;
    }

    MenuItem.prototype.render = function(canvas, x, y) {
        var textColor = '#000';
        var iconColor = '#000';

        if (this.state === STATE_DEFAULT) {
            if (!this.isLast) {
                canvas.drawHLine(x + 2, y + this.h - 1, this.w - 4, '#EDEDED');
            }
        } else if (this.state === STATE_SELECTED) {
            canvas.drawRoundFrame(x, y - 1, this.w, this.h + 1, RADIUS, '#000');
        } else if (this.state === STATE_PRESSED) {
            canvas.drawRoundRect(x, y - 1, this.w, this.h + 1, RADIUS, '#000');
            textColor = '#fff';
            iconColor = '#fff';
        }

        var verticalPadding = Math.floor((this.h - FONT_H) / 2);

        if (this.icon) {
            var iconX = x + PAD_X;
            var iconY = y + Math.floor((this.h - this.icon.h) / 2);
            // Use drawSprite for grayscale icons, drawIcon for binary icons
            if (this.icon.grayscale) {
                canvas.drawSprite(this.icon, iconX, iconY, iconColor);
            } else {
                canvas.drawIcon(this.icon, iconX, iconY, iconColor);
            }
        }

        var textX = this.icon ? x + PAD_X + 14 + 4 : x + PAD_X;
        var textY = y + verticalPadding;
        HaxrcorpFont16.draw(canvas.ctx, this.text, textX, textY, textColor);
    };

    function SubMenuScene(sceneManager, title, items, appScenes) {
        this.sceneManager = sceneManager;
        this.title = title;
        this.itemNames = items;
        this.appScenes = appScenes || {};
        this.selectedIndex = 0;
        this.items = [];

        // Create menu items
        for (var i = 0; i < items.length; i++) {
            var isLast = (i === items.length - 1);
            this.items.push(new MenuItem(items[i], isLast, null));
        }

        this.items[this.selectedIndex].state = STATE_SELECTED;

        // Create left button (back to desktop)
        var self = this;
        this.leftButton = new UI.LeftButton('Desktop', BTN_W, 'esc', function() {
            self.sceneManager.popToRoot();
        });

        // Create right button (open selected item)
        this.rightButton = new UI.RightButton('Open', BTN_W, null, null);  // No action, we'll handle it manually

        // Build button action map
        this.btnActionMap = {};
        if (this.leftButton && this.leftButton.action) {
            this.btnActionMap[this.leftButton.action] = this.leftButton;
        }
    }

    SubMenuScene.prototype.enter = function() {};
    SubMenuScene.prototype.exit = function() {};

    SubMenuScene.prototype.handleInput = function(action) {
        // Check if action maps to a button
        var btn = this.btnActionMap[action];
        if (btn) {
            var self = this;
            btn.press();
            if (btn.onPress) btn.onPress();
            setTimeout(function() { btn.release(); }, 30);
            return;
        }

        if (action === 'down') {
            if (this.selectedIndex < this.items.length - 1) {
                this.items[this.selectedIndex].state = STATE_DEFAULT;
                this.selectedIndex++;
                this.items[this.selectedIndex].state = STATE_SELECTED;
            }
        } else if (action === 'up') {
            if (this.selectedIndex > 0) {
                this.items[this.selectedIndex].state = STATE_DEFAULT;
                this.selectedIndex--;
                this.items[this.selectedIndex].state = STATE_SELECTED;
            }
        } else if (action === 'ok' || action === 'run') {
            // Show button feedback
            var self = this;
            this.rightButton.press();
            setTimeout(function() {
                self.rightButton.release();
                // Open the item after button feedback
                var factory = self.appScenes[self.itemNames[self.selectedIndex]];
                if (factory) {
                    self.sceneManager.push(factory());
                }
            }, 30);
        } else if (action === 'back') {
            return 'pop';
        }
    };

    SubMenuScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // Draw breadcrumbs
        var breadcrumbsY = 12;
        var breadcrumbsH = 12;
        canvas.drawRect(0, breadcrumbsY, canvas.w, breadcrumbsH, '#CCCCCC');

        var breadcrumbText = this.title;
        var breadcrumbWidth = HaxrcorpFont16.textWidth(breadcrumbText);
        var breadcrumbX = Math.floor((canvas.w - breadcrumbWidth) / 2);
        var breadcrumbTextY = breadcrumbsY + Math.floor((breadcrumbsH - 11) / 2);
        HaxrcorpFont16.draw(canvas.ctx, breadcrumbText, breadcrumbX, breadcrumbTextY, '#000');

        var startY = breadcrumbsY + breadcrumbsH + 2;

        for (var i = 0; i < this.items.length; i++) {
            var y = startY + i * ITEM_H_REGULAR;
            this.items[i].render(canvas, 8, y);
        }

        // Render buttons
        this.leftButton.render(canvas);
        this.rightButton.render(canvas);
    };

    return SubMenuScene;
})();
