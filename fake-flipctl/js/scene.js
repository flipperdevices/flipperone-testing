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

    return SceneManager;
})();
