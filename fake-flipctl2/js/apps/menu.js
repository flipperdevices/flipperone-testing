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
        // Optional vertical sprite strip that plays while the item is
        // SELECTED. Expected shape: { w, h, frames, ... }. If absent, the
        // static `icon` renders in all states.
        this.iconAnimated = null;
        this.isLast = isLast || false;
        this.status = status || null;
    }

    // 5 fps = 200 ms per frame.
    var ANIMATED_ICON_FRAME_MS = 200;

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

        // Draw icon. When selected and an animated strip is available,
        // play it; otherwise fall back to the static icon.
        var activeAnim = (this.state === STATE_SELECTED && this.iconAnimated) ? this.iconAnimated : null;
        var iconSource = activeAnim || this.icon;
        if (iconSource) {
            var frameH = activeAnim ? Math.floor(iconSource.h / (iconSource.frames || 1)) : iconSource.h;
            var iconX = x + PAD_X;
            var iconY = y + Math.floor((this.h - frameH) / 2);
            if (activeAnim) {
                var frameIndex = Math.floor(Date.now() / ANIMATED_ICON_FRAME_MS) % (activeAnim.frames || 1);
                canvas.drawSpriteFrame(activeAnim, iconX, iconY, frameIndex, iconColor);
            } else if (iconSource.grayscale) {
                canvas.drawSprite(iconSource, iconX, iconY, iconColor);
            } else {
                canvas.drawIcon(iconSource, iconX, iconY, iconColor);
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
        'Settings'
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
            'GPIO',
            'Switch to fake-flipctl'
        ], {
            'Screen': function() { return new ScreenTestScene(); },
            'Boot menu - UI demo': function() { return new UIDemoScene(sm); },
            'Sound': function() { return new SoundMenuScene(sm); },
            'Figma live preview': function() { return new FigmaLivePreviewScene(sm); },
            'Switch to fake-flipctl': function() {
                fetch('/api/switch/flipctl', { method: 'POST' });
                return null;
            }
        });
    }

    function settingsMenu(sm) {
        return new SubMenuScene(sm, 'Settings', [
            'System info',
            'Battery info',
            'Disk info',
            'Update'
        ], {
            'Battery info': function() { return new PowerScene(); },
            'Disk info': function() { return new DiskSpaceScene(); },
            'Update': function() { return new UpdateScene(); }
        });
    }

    var subMenus = {
        'Network': networkMenu,
        'Testing': testingMenu,
        'Settings': settingsMenu
    };

    function MenuScene(sceneManager) {
        this.sceneManager = sceneManager;
        this.selectedIndex = 0;
        this.items = [];

        // Map menu items to icons. Animated entries take over on selection
        // and fall back to the static icon otherwise.
        var iconMap = {
            'Network': Icons.network,
            'Testing': Icons.testing,
            'Settings': Icons.system
        };
        var animatedIconMap = {
            'Settings': AnimatedIcons.settings_animated
        };

        // Create menu items
        for (var i = 0; i < menuItems.length; i++) {
            var isLast = (i === menuItems.length - 1);
            var icon = iconMap[menuItems[i]] || null;
            var item = new MenuItem(menuItems[i], isLast, icon);
            item.iconAnimated = animatedIconMap[menuItems[i]] || null;
            this.items.push(item);
        }

        this.items[this.selectedIndex].state = STATE_SELECTED;
    }

    MenuScene.prototype.enter = function() {
        // Tick at the animated-icon framerate so selection animations can
        // advance even when there's no input. The render loop decides what
        // to draw; we just nudge it.
        if (this._animTimer) return;
        this._animTimer = setInterval(function() {
            if (window.requestRender) window.requestRender();
        }, ANIMATED_ICON_FRAME_MS);
    };
    MenuScene.prototype.exit = function() {
        if (this._animTimer) {
            clearInterval(this._animTimer);
            this._animTimer = null;
        }
    };

    MenuScene.prototype.handleInput = function(action) {
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
            var factory = subMenus[menuItems[this.selectedIndex]];
            if (factory) {
                this.sceneManager.push(factory(this.sceneManager));
            }
        } else if (action === 'back' || action === 'esc') {
            return 'pop';
        }
    };

    MenuScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // Menu items start just below the status bar (13px) + 2px gap.
        var startY = 15;

        for (var i = 0; i < this.items.length; i++) {
            var y = startY + i * ITEM_H_REGULAR;
            this.items[i].render(canvas, 8, y);
        }
    };

    return MenuScene;
})();
