var MenuScene = (function() {
    var items = [
        '5G Modem',
        'Wi-Fi',
        'Bluetooth',
        'Display info',
        'GPIO Control',
        'Input test',
        'Disk info',
        'Power info',
        'Boot order'
    ];

    var appScenes = {
        '5G Modem': function() { return new Modem5gScene(); },
        'Disk info': function() { return new DiskSpaceScene(); },
        'Power info': function() { return new PowerScene(); }
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
            var factory = appScenes[items[this.selectedIndex]];
            if (factory) {
                this.sceneManager.push(factory());
            }
        }
    };

    MenuScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'FLIPPER ONE');
        UI.drawMenuList(canvas, items, this.selectedIndex, this.scrollOffset);
    };

    return MenuScene;
})();
