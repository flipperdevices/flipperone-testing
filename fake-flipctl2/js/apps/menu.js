var MenuScene = (function() {
    // Parent menu container anchor (top-left) and width. Items stack
    // flush inside this container with 1px gray dividers between them.
    var CONTAINER_X = 16;
    var CONTAINER_Y = 24;
    var CONTAINER_W = 224;            // 256 - 16 (left) - 16 (right)
    var DIVIDER_COLOR = '#CCCCCC';
    var ANIMATED_ICON_FRAME_MS = 200; // 5 fps redraw cadence

    // Viewport: the menu area fits 5 lines (5*20 + 4 dividers = 104px)
    // before the canvas bottom. When the list is longer, scroll.
    var VISIBLE_COUNT = 5;
    var VIEWPORT_H = VISIBLE_COUNT * 20 + (VISIBLE_COUNT - 1); // 104
    var SCROLLBAR_X = 253;  // 3px-wide thumb centred here → cols 252..254

    // Scrollbar geometry independent of the viewport: dotted line sits
    // 2px below the status bar and 2px above the canvas bottom; the
    // thumb has an extra 1px inset so its minimum distance from the
    // status bar and canvas bottom is 3px.
    var SCROLLBAR_Y = 15;
    var SCROLLBAR_H = 127;   // 143 (canvas bottom 2px pad) - 15 + 1
    var SCROLLBAR_THUMB_PAD = 1;

    // MenuSelectorFrame around the selected line. Positioned/sized
    // independently of the MenuLine itself per spec.
    var SELECTOR_X = 10;
    var SELECTOR_W = 232;
    var SELECTOR_H = 22;
    var SELECTOR_CORNER_R = 3;
    // Vertical offset: centres the 22px frame over the 20px line.
    var SELECTOR_Y_OFFSET = -1;

    // Gray divider spans the selector frame's straight top/bottom edge
    // (selector width − 2× rounded-corner radius), aligned to it.
    var DIVIDER_X = SELECTOR_X + SELECTOR_CORNER_R;
    var DIVIDER_W = SELECTOR_W - 2 * SELECTOR_CORNER_R;

    var menuItems = [
        'Router',
        'Apps',
        'Files',
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

        // Wi-Fi row shows the current SSID, or "not connected" — pulled
        // live from the UI polling state each render.
        for (var j = 0; j < subMenu.items.length; j++) {
            if (subMenu.items[j].text === 'Wi-Fi') {
                subMenu.items[j].statusProvider = function() {
                    var w = UI.getWifiInfo();
                    if (!w.connected) return 'not connected';
                    return w.ssid || 'connected';
                };
                break;
            }
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
        // Files / Apps / Router have no backing scene yet — factories
        // return null so pressing ok/run is a no-op until wired up.
        'Files':  function() { return null; },
        'Apps':   function() { return null; },
        'Testing': testingMenu,
        'Settings': settingsMenu,
        'Router': function() { return null; }
    };

    function MenuScene(sceneManager) {
        this.sceneManager = sceneManager;
        this.selectedIndex = 0;
        this.scrollOffset = 0;
        this.items = [];

        var iconMap = {
            'Settings': Icons.system,
            'Router':   Icons.router
            // 'Network' / 'Files' / 'Apps' / 'Testing' have no static
            // icon — they fall back to frame 0 of their animated strip
            // while unselected.
        };
        var animatedIconMap = {
            'Settings': AnimatedIcons.settings_animated,
            'Files':    AnimatedIcons.files_animated,
            'Apps':     AnimatedIcons.apps_animated,
            'Network':  AnimatedIcons.network_animated,
            'Testing':  AnimatedIcons.testing_animated
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

        this.scrollbar = new UI.Scrollbar(menuItems.length, VISIBLE_COUNT, this.scrollOffset);
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

    MenuScene.prototype._ensureVisible = function() {
        // Shift the viewport so the selected line is inside it.
        if (this.selectedIndex < this.scrollOffset) {
            this.scrollOffset = this.selectedIndex;
        } else if (this.selectedIndex >= this.scrollOffset + VISIBLE_COUNT) {
            this.scrollOffset = this.selectedIndex - VISIBLE_COUNT + 1;
        }
    };

    MenuScene.prototype.handleInput = function(action) {
        var n = this.items.length;
        if (action === 'down' || action === 'up') {
            // Infinity scroll: down past the last item jumps to the first,
            // up past the first jumps to the last.
            this.items[this.selectedIndex].state = MenuLine.STATE_DEFAULT;
            if (action === 'down') {
                this.selectedIndex = (this.selectedIndex + 1) % n;
            } else {
                this.selectedIndex = (this.selectedIndex - 1 + n) % n;
            }
            this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;
            this._ensureVisible();
        } else if (action === 'ok' || action === 'run') {
            // 30ms "press" flash on the selected line, then open the
            // submenu. The render loop paints the selector frame filled
            // black while the line is PRESSED, and the line inverts its
            // own text/icon to white.
            var self = this;
            var idx = this.selectedIndex;
            var line = this.items[idx];
            line.state = MenuLine.STATE_PRESSED;
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                line.state = MenuLine.STATE_SELECTED;
                var factory = subMenus[menuItems[idx]];
                if (factory) {
                    var next = factory(self.sceneManager);
                    if (next) self.sceneManager.push(next);
                }
                if (window.requestRender) window.requestRender();
            }, 30);
        } else if (action === 'back' || action === 'esc') {
            return 'pop';
        }
    };

    MenuScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // Render only the slice of items currently in the viewport.
        // Dividers still sit between every visible pair (the "no
        // divider on first / last" rule is satisfied because we draw
        // a divider only between rendered items).
        var total = this.items.length;
        var first = this.scrollOffset;
        var last = Math.min(total, first + VISIBLE_COUNT);
        var y = CONTAINER_Y;
        var selectedLineY = CONTAINER_Y;
        for (var i = first; i < last; i++) {
            if (i === this.selectedIndex) selectedLineY = y;
            this.items[i].render(canvas, CONTAINER_X, y);
            y += MenuLine.H;
            if (i < last - 1) {
                canvas.drawHLine(DIVIDER_X, y, DIVIDER_W, DIVIDER_COLOR);
                y += 1;
            }
        }

        // Selector frame. Filled while PRESSED (covers the selected
        // line backdrop in black); outline otherwise.
        var pressed = this.items[this.selectedIndex].state === MenuLine.STATE_PRESSED;
        this.selectorFrame.setPosition(SELECTOR_X, selectedLineY + SELECTOR_Y_OFFSET);
        this.selectorFrame.setShowFill(pressed);
        if (pressed) this.selectorFrame.setFillColor('#000');
        this.selectorFrame.render(canvas);

        // The filled frame just painted over the selected line content.
        // Redraw the selected line on top so its (inverted) text/icon
        // sit over the black backdrop.
        if (pressed) {
            this.items[this.selectedIndex].render(canvas, CONTAINER_X, selectedLineY);
        }

        // Scrollbar along the right edge. Dotted line spans the full
        // SCROLLBAR_H (2px off the status bar and bottom); the thumb is
        // inset 1px more so it sits at least 3px from each edge.
        this.scrollbar.update(total, VISIBLE_COUNT, this.scrollOffset);
        this.scrollbar.render(canvas, SCROLLBAR_X, SCROLLBAR_Y, SCROLLBAR_H, SCROLLBAR_THUMB_PAD);
    };

    return MenuScene;
})();
