var SceneManager = (function() {
    function SceneManager() {
        this._stack = [];
    }

    SceneManager.prototype.push = function(scene) {
        var current = this.current();
        if (current && current.exit) current.exit();
        this._stack.push(scene);
        if (scene.enter) scene.enter();
    };

    SceneManager.prototype.pop = function() {
        if (this._stack.length <= 1) return;
        var removed = this._stack.pop();
        if (removed && removed.exit) removed.exit();
        var current = this.current();
        if (current && current.enter) current.enter();
    };

    SceneManager.prototype.current = function() {
        return this._stack[this._stack.length - 1] || null;
    };

    SceneManager.prototype.popToRoot = function() {
        while (this._stack.length > 1) {
            this.pop();
        }
    };

    // Collects `breadcrumbTitle` strings from every scene currently on
    // the stack (bottom → top). Scenes without that property are
    // skipped — e.g. Desktop and the Main Menu don't contribute to the
    // "> Network > Ethernet" trail.
    SceneManager.prototype.breadcrumb = function() {
        var titles = [];
        for (var i = 0; i < this._stack.length; i++) {
            var t = this._stack[i].breadcrumbTitle;
            if (t) titles.push(t);
        }
        return titles;
    };

    return SceneManager;
})();
