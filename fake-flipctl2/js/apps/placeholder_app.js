/**
 * PlaceholderAppScene
 *
 * Renders a single full-screen PNG mockup as the entire app screen.
 * Used for the placeholder apps under Main Menu → Apps until each
 * one gets a real implementation.
 *
 * The image is loaded via the browser's <img> element (no bitmap
 * conversion step), pulled from /assets/apps/* — the server already
 * serves .png with the correct MIME, and Canvas' imageSmoothing is
 * disabled in canvas.js so the pixels stay crisp.
 *
 * Exit on the Back button. The scene's `displayName` flows through
 * to the App Switcher title bar via main.js → getSceneName.
 */
var PlaceholderAppScene = (function() {
    function PlaceholderAppScene(imagePath, displayName) {
        this.imagePath  = imagePath;
        this.displayName = displayName || '';
        // Image starts null and is created on enter() so leaving
        // and re-entering the scene picks up any updated PNG without
        // a stale browser cache.
        this.image = null;
    }

    PlaceholderAppScene.prototype.enter = function() {
        // Register the launch with the global recents stack so the
        // App Switcher picks it up on the next Tab. Bumps any
        // existing entry to the top — so re-launching an already
        // running app moves it to the front of the switcher rather
        // than duplicating it.
        if (typeof RunningApps !== 'undefined') {
            RunningApps.open(this.displayName, this.imagePath);
        }

        var self = this;
        this.image = new Image();
        this.image.onload = function() {
            if (typeof window.requestRender === 'function') window.requestRender();
        };
        this.image.src = this.imagePath;
    };

    PlaceholderAppScene.prototype.exit = function() {
        // Save what the user just saw — the App Switcher card for
        // this app will use this snapshot in place of the static
        // PNG.
        //
        // Race guard: when the user OKs a different app from the App
        // Switcher, `sceneManager.pop()` then `push(newApp)` fires
        // *this* scene's exit() a second time without an intermediate
        // render, so the canvas pixels still belong to the Switcher.
        // We only capture when this scene is the one whose render
        // last touched the canvas — otherwise we'd save the
        // Switcher's frame as our app's "last seen" thumbnail.
        var canvasEl = document.getElementById('screen');
        var ownsCanvas = (window._lastRenderedScene === this);
        if (ownsCanvas && canvasEl && typeof RunningApps !== 'undefined') {
            var snap = document.createElement('canvas');
            snap.width  = canvasEl.width;
            snap.height = canvasEl.height;
            snap.getContext('2d').drawImage(canvasEl, 0, 0);
            RunningApps.setSnapshot(this.displayName, snap);
        }
        this.image = null;
    };

    PlaceholderAppScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
    };

    PlaceholderAppScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        // Skip drawImage until the load has resolved — drawImage on
        // an incomplete Image throws in some browsers.
        if (this.image && this.image.complete && this.image.naturalWidth > 0) {
            canvas.ctx.drawImage(this.image, 0, 0);
        }
        // Standard OS status bar overlaid on top of the placeholder
        // mockup so battery / wifi / etc. indicators stay visible
        // and consistent with the rest of the system.
        UI.drawStatusBar(canvas, '');
    };

    return PlaceholderAppScene;
})();
