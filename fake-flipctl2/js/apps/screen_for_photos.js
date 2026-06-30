/**
 * ScreenForPhotosScene
 *
 * A plain full-white screen (e.g. to use the panel as a fill light /
 * backdrop for photos). No chrome at all.
 *
 *   Back  → up one level (back to the Testing menu)
 *   Esc   → all the way out to the Desktop
 */
var ScreenForPhotosScene = (function() {
    function ScreenForPhotosScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Screen for photos';
        this.breadcrumbTitle = 'Screen for photos';
    }

    ScreenForPhotosScene.prototype.enter = function() {
        if (window.requestRender) window.requestRender();
    };

    ScreenForPhotosScene.prototype.exit = function() {};

    ScreenForPhotosScene.prototype.handleInput = function(action) {
        // Back (n / Backspace) → pop one level to the menu.
        if (action === 'back') return 'pop';
        // Esc (z) → jump straight to the Desktop (pop the whole stack).
        if (action === 'esc') {
            if (this.sceneManager && this.sceneManager.popToRoot) {
                this.sceneManager.popToRoot();
            }
            if (window.requestRender) window.requestRender();
            return;
        }
    };

    ScreenForPhotosScene.prototype.render = function(canvas) {
        canvas.clear('#fff');   // just a white screen
    };

    return ScreenForPhotosScene;
})();
