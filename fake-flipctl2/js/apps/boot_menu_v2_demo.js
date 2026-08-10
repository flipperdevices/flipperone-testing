/**
 * BootMenuV2DemoScene
 *
 * Testing → UI Demos → Boot Menu v3. Pure mockup flipbook: shows
 * the boot-menu scroll screens from assets/boot_menu_screens/
 * (boot_menu_scroll_01..06.png, 1280×720 = 5× the LCD, drawn
 * scaled to the full 256×144). Down steps to the next frame, Up
 * to the previous (clamped at the ends), Back pops. No status
 * bar — the PNG is the whole screen.
 */
var BootMenuV2DemoScene = (function() {
    var FRAME_COUNT = 6;
    var FRAME_PATH  = function(i) {
        var n = (i + 1 < 10 ? '0' : '') + (i + 1);
        return 'assets/boot_menu_screens/boot_menu_scroll_' + n + '.png';
    };

    function BootMenuV2DemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Boot Menu v3';
        this.breadcrumbTitle = 'Boot Menu v3';
        this._frames = null;   // Image[] — created on enter()
        this._idx    = 0;
    }

    BootMenuV2DemoScene.prototype.enter = function() {
        // Preload every frame so Up/Down stepping never flashes.
        this._frames = [];
        this._idx = 0;
        for (var i = 0; i < FRAME_COUNT; i++) {
            var img = new Image();
            img.onload = function() {
                if (window.requestRender) window.requestRender();
            };
            img.src = FRAME_PATH(i);
            this._frames.push(img);
        }
        if (window.requestRender) window.requestRender();
    };

    BootMenuV2DemoScene.prototype.exit = function() {};

    BootMenuV2DemoScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'down' && this._idx < FRAME_COUNT - 1) {
            this._idx++;
            if (window.requestRender) window.requestRender();
            return;
        }
        if (action === 'up' && this._idx > 0) {
            this._idx--;
            if (window.requestRender) window.requestRender();
        }
    };

    BootMenuV2DemoScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        var img = this._frames && this._frames[this._idx];
        if (img && img.complete && img.naturalWidth > 0) {
            // 1280×720 → 256×144: exact 5× downscale onto the LCD.
            canvas.ctx.drawImage(img, 0, 0, canvas.w, canvas.h);
        }
    };

    return BootMenuV2DemoScene;
})();
