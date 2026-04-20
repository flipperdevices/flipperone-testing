var MenuScene = (function() {
    var FONT_H = 11;
    var PAD_X = 6;
    var RADIUS = 2;
    var ITEM_W = 240;
    var ITEM_H_REGULAR = 19;  // Regular items height (with bottom line)
    var ITEM_H_LAST = 18;     // Last item height (no line)
    var BTN_W = 48;

    var STATE_DEFAULT = 'default';
    var STATE_SELECTED = 'selected';
    var STATE_PRESSED = 'pressed';

    function MenuItem(text, isLast, icon, status) {
        this.text = text;
        this.w = ITEM_W;
        this.h = isLast ? ITEM_H_LAST : ITEM_H_REGULAR;
        this.state = STATE_DEFAULT;
        this.icon = icon || null;
        this.isLast = isLast || false;
        this.status = status || null;
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

        // Center text vertically
        var verticalPadding = Math.floor((this.h - FONT_H) / 2);

        // Draw icon if available
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

        // Draw text
        var textX = this.icon ? x + PAD_X + 14 + 4 : x + PAD_X;
        var textY = y + verticalPadding;
        HaxrcorpFont16.draw(canvas.ctx, this.text, textX, textY, textColor);

        // Draw status text on the right if available
        if (this.status) {
            // For Fake-FlipCTL_2, render with custom spacing
            if (this.status === '< ON >' || this.status === '< OFF >') {
                var ltWidth = HaxrcorpFont16.textWidth('<');
                var maxMiddleWidth = HaxrcorpFont16.textWidth('OFF');  // Use longest text width
                var gtWidth = HaxrcorpFont16.textWidth('>');
                var spacing = 15;

                var rightX = x + this.w - PAD_X;
                var gtX = rightX - gtWidth;
                var ltX = gtX - spacing - maxMiddleWidth - spacing - ltWidth;
                var middleText = this.status === '< ON >' ? 'ON' : 'OFF';
                var middleBaseX = ltX + ltWidth + spacing;
                var middleTextWidth = HaxrcorpFont16.textWidth(middleText);
                var middleX = Math.floor(middleBaseX + (maxMiddleWidth - middleTextWidth) / 2);

                HaxrcorpFont16.draw(canvas.ctx, '<', ltX, textY, textColor);
                HaxrcorpFont16.draw(canvas.ctx, middleText, middleX, textY, textColor);
                HaxrcorpFont16.draw(canvas.ctx, '>', gtX, textY, textColor);
            } else {
                var statusWidth = HaxrcorpFont16.textWidth(this.status);
                var statusX = x + this.w - statusWidth - PAD_X;
                HaxrcorpFont16.draw(canvas.ctx, this.status, statusX, textY, textColor);
            }
        }
    };

    var menuItems = [
        'Network',
        'Testing',
        'System'
    ];

    function networkMenu(sm) {
        var subMenu = new SubMenuScene(sm, 'Network', [
            'Routing info',
            '5G Modem',
            'Wi-Fi',
            'Ethernet'
        ], {
            'Routing info': function() { return new RoutingScene(); },
            '5G Modem': function() { return new Modem5gScene(); },
            'Ethernet': function() { return new EthernetScene(); }
        });

        // Map icons to menu items
        var iconMap = {
            'Routing info': Icons.info_icon,
            '5G Modem': Icons.modem_5g,
            'Wi-Fi': Icons.wifi,
            'Ethernet': Icons.ethernet
        };

        // Add icons to existing items
        for (var i = 0; i < subMenu.items.length; i++) {
            subMenu.items[i].icon = iconMap[subMenu.items[i].text];
        }

        return subMenu;
    }

    function testingMenu(sm) {
        return new SubMenuScene(sm, 'Testing', [
            'Screen',
            'Boot menu - UI demo',
            'Input',
            'Sound',
            'Figma live preview',
            'GPIO'
        ], {
            'Screen': function() { return new ScreenTestScene(); },
            'Boot menu - UI demo': function() { return new UIDemoScene(sm); },
            'Sound': function() { return new SoundMenuScene(sm); },
            'Figma live preview': function() { return new FigmaLivePreviewScene(sm); }
        });
    }

    function systemMenu(sm) {
        return new SubMenuScene(sm, 'System', [
            'System info',
            'Battery info',
            'Disk info',
            'Switch to fake-flipctl',
            'Update'
        ], {
            'Battery info': function() { return new PowerScene(); },
            'Disk info': function() { return new DiskSpaceScene(); },
            'Switch to fake-flipctl': function() {
                fetch('/api/switch/flipctl', { method: 'POST' });
                return null;
            },
            'Update': function() { return new UpdateScene(); }
        });
    }

    var subMenus = {
        'Network': networkMenu,
        'Testing': testingMenu,
        'System': systemMenu
    };

    function MenuScene(sceneManager) {
        this.sceneManager = sceneManager;
        this.selectedIndex = 0;
        this.items = [];

        // Map menu items to icons
        var iconMap = {
            'Network': Icons.network,
            'Testing': Icons.testing,
            'System': Icons.system
        };

        // Create menu items
        for (var i = 0; i < menuItems.length; i++) {
            var isLast = (i === menuItems.length - 1);
            var icon = iconMap[menuItems[i]] || null;
            this.items.push(new MenuItem(menuItems[i], isLast, icon));
        }

        this.items[this.selectedIndex].state = STATE_SELECTED;

        // Create left button (back to desktop)
        var self = this;
        this.leftButton = new UI.LeftButton('Desktop', BTN_W, 'esc', function() {
            self.sceneManager.pop();
        });

        // Create right button (open selected menu)
        this.rightButton = new UI.RightButton('Open', BTN_W, null, null);  // No action, we'll handle it manually

        // Build button action map
        this.btnActionMap = {};
        if (this.leftButton && this.leftButton.action) {
            this.btnActionMap[this.leftButton.action] = this.leftButton;
        }
    }

    MenuScene.prototype.enter = function() {};
    MenuScene.prototype.exit = function() {};

    MenuScene.prototype.handleInput = function(action) {
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
                // Open the submenu after button feedback
                var factory = subMenus[menuItems[self.selectedIndex]];
                if (factory) {
                    self.sceneManager.push(factory(self.sceneManager));
                }
            }, 30);
        } else if (action === 'back' || action === 'esc') {
            return 'pop';
        }
    };

    MenuScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // Draw breadcrumbs
        var breadcrumbsY = 12;
        var breadcrumbsH = 12;
        canvas.drawRect(0, breadcrumbsY, canvas.w, breadcrumbsH, '#CCCCCC');

        // Draw breadcrumb text "Main menu" centered
        var breadcrumbText = 'Main menu';
        var breadcrumbWidth = HaxrcorpFont16.textWidth(breadcrumbText);
        var breadcrumbX = Math.floor((canvas.w - breadcrumbWidth) / 2);
        var breadcrumbTextY = breadcrumbsY + Math.floor((breadcrumbsH - 11) / 2);  // Center vertically
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

    return MenuScene;
})();
