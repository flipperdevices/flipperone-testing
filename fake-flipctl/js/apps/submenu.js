var SubMenuScene = (function() {
    function SubMenuScene(sceneManager, title, items, appScenes) {
        this.sceneManager = sceneManager;
        this.title = title;
        this.items = items;
        this.appScenes = appScenes || {};
        this.selectedIndex = 0;
        this.scrollOffset = 0;
    }

    SubMenuScene.prototype.enter = function() {};
    SubMenuScene.prototype.exit = function() {};

    SubMenuScene.prototype.handleInput = function(action) {
        var visible = UI.visibleCount(144);

        if (action === 'down') {
            if (this.selectedIndex < this.items.length - 1) {
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
            var factory = this.appScenes[this.items[this.selectedIndex]];
            if (factory) {
                this.sceneManager.push(factory());
            }
        } else if (action === 'back') {
            return 'pop';
        }
    };

    SubMenuScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, this.title);
        UI.drawMenuList(canvas, this.items, this.selectedIndex, this.scrollOffset);
    };

    return SubMenuScene;
})();
