var MenuScene = (function() {
    // Parent menu container anchor (top-left) and width. Items stack
    // flush inside this container with 1px gray dividers between them.
    var CONTAINER_X = 16;
    var CONTAINER_Y = 24;
    var CONTAINER_W = 224;            // 256 - 16 (left) - 16 (right)
    var DIVIDER_COLOR = '#CCCCCC';
    var ANIMATED_ICON_FRAME_MS = 200; // 5 fps redraw cadence

    // MenuSelectorFrame around the selected line. Positioned/sized
    // independently of the MenuLine itself per spec.
    var SELECTOR_X = 10;
    var SELECTOR_W = 232;
    var SELECTOR_H = 22;
    // Vertical offset: centres the 22px frame over the 20px line.
    var SELECTOR_Y_OFFSET = -1;

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

        var iconMap = {
            'Routing info': Icons.info_icon,
            '5G Modem': Icons.modem_5g,
            'Wi-Fi': Icons.wifi,
            'Ethernet': Icons.ethernet
        };
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

        var iconMap = {
            'Network': Icons.network,
            'Testing': Icons.testing,
            'Settings': Icons.system
        };
        var animatedIconMap = {
            'Settings': AnimatedIcons.settings_animated
        };

        for (var i = 0; i < menuItems.length; i++) {
            this.items.push(new MenuLine({
                text: menuItems[i],
                width: CONTAINER_W,
                icon: iconMap[menuItems[i]] || null,
                iconAnimated: animatedIconMap[menuItems[i]] || null
            }));
        }

        this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;

        this.selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X,
            y: 0,               // scene updates this each frame
            width: SELECTOR_W,
            height: SELECTOR_H,
            anchorH: 'left',
            anchorV: 'top',
            strokeColor: '#000',
            showStroke: true,
            showFill: false     // transparent interior; line content shows through
        });
    }

    MenuScene.prototype.enter = function() {
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
                this.items[this.selectedIndex].state = MenuLine.STATE_DEFAULT;
                this.selectedIndex++;
                this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;
            }
        } else if (action === 'up') {
            if (this.selectedIndex > 0) {
                this.items[this.selectedIndex].state = MenuLine.STATE_DEFAULT;
                this.selectedIndex--;
                this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;
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

        // Stack lines flush. Between each pair (never above the first,
        // never below the last) paint a 1px gray separator. Track the
        // Y of the selected line so the selector frame can be placed
        // around it in a second pass.
        var y = CONTAINER_Y;
        var selectedLineY = CONTAINER_Y;
        for (var i = 0; i < this.items.length; i++) {
            if (i === this.selectedIndex) selectedLineY = y;
            this.items[i].render(canvas, CONTAINER_X, y);
            y += MenuLine.H;
            if (i < this.items.length - 1) {
                canvas.drawHLine(CONTAINER_X, y, CONTAINER_W, DIVIDER_COLOR);
                y += 1;
            }
        }

        // Selector frame around the selected line, drawn last so its
        // stroke sits on top of both the line content and any divider
        // the frame overlaps.
        this.selectorFrame.setPosition(SELECTOR_X, selectedLineY + SELECTOR_Y_OFFSET);
        this.selectorFrame.render(canvas);
    };

    return MenuScene;
})();
