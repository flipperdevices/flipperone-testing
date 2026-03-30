var MenuScene = (function() {
    var items = [
        'Network',
        'Testing',
        'System'
    ];

    function networkMenu(sm) {
        return new SubMenuScene(sm, 'Network', [
            'Routing info',
            '5G Modem',
            'Wi-Fi',
            'Ethernet'
        ], {
            'Routing info': function() { return new RoutingScene(); },
            '5G Modem': function() { return new Modem5gScene(); },
            'Ethernet': function() { return new EthernetScene(); }
        });
    }

    function testingMenu(sm) {
        return new SubMenuScene(sm, 'Testing', [
            'Screen',
            'Input',
            'Sound',
            'GPIO'
        ], {
            'Screen': function() { return new ScreenTestScene(); },
            'Sound': function() { return new SoundMenuScene(sm); }
        });
    }

    function systemMenu(sm) {
        return new SubMenuScene(sm, 'System', [
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
        'System': systemMenu
    };

    function MenuScene(sceneManager) {
        this.sceneManager = sceneManager;
        this.selectedIndex = 0;
        this.scrollOffset = 0;
    }

    MenuScene.prototype.enter = function() {};
    MenuScene.prototype.exit = function() {};

    MenuScene.prototype.handleInput = function(action) {
        var visible = UI.visibleCount(144);

        if (action === 'down') {
            if (this.selectedIndex < items.length - 1) {
                this.selectedIndex++;
                if (this.selectedIndex >= this.scrollOffset + visible) {
                    this.scrollOffset = this.selectedIndex - visible + 1;
                }
            }
        } else if (action === 'up') {
            if (this.selectedIndex > 0) {
                this.selectedIndex--;
                if (this.selectedIndex < this.scrollOffset) {
                    this.scrollOffset = this.selectedIndex;
                }
            }
        } else if (action === 'ok') {
            var factory = subMenus[items[this.selectedIndex]];
            if (factory) {
                this.sceneManager.push(factory(this.sceneManager));
            }
        }
    };

    MenuScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'FLIPPER ONE');
        UI.drawMenuList(canvas, items, this.selectedIndex, this.scrollOffset);
    };

    return MenuScene;
})();
