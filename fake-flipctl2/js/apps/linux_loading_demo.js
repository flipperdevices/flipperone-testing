/**
 * LinuxLoadingDemoScene
 *
 * Testing → UI Demos → 'Linux loading'. Plays the designer's Linux
 * boot animation full-screen (assets/kickstarter_UI/linux_loading/
 * F1_Linux_animation_v008_1x.mp4: 256×144, 60 fps, 300 frames; status
 * bar, Tux, LOADING... bar, service list and Logs tab are all part of
 * the art), looped from the moment it opens (from the first frame once
 * the sheet has loaded). Back / esc returns.
 *
 * The clip is a pre-rendered sprite sheet (every frame in a cols × rows
 * grid, one rect blitted per frame by wall-clock index), re-fetched on
 * every visit with a cache-busting query so a swapped sheet shows up
 * without reloading the page.
 *
 * Rebuild the sheet after changing the clip, from
 * assets/kickstarter_UI/linux_loading/:
 *   ffmpeg -i F1_Linux_animation_v008_1x.mp4 \
 *          -vf format=gray,tile=20x15 -frames:v 1 -update 1 F1_Linux_animation_v008_sheet.png
 */
var LinuxLoadingDemoScene = (function() {
    var CLIP = {
        src: 'assets/kickstarter_UI/linux_loading/F1_Linux_animation_v008_sheet.png',
        frames: 300, cols: 20, fps: 60, w: 256, h: 144
    };

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    function LinuxLoadingDemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Linux loading';
        this.breadcrumbTitle = 'Linux loading';
        this._sheet = null;
        this._t0 = 0;
        this._frameTimer = null;
    }

    LinuxLoadingDemoScene.prototype.enter = function() {
        var self = this;
        var sheet = new Image();
        sheet.onload = function() {
            self._sheet = sheet;
            self._t0 = Date.now();
            repaint();
        };
        sheet.src = CLIP.src + '?v=' + Date.now();
        this._t0 = Date.now();
        if (!this._frameTimer) {
            this._frameTimer = setInterval(repaint, Math.floor(1000 / CLIP.fps));
        }
        repaint();
    };

    LinuxLoadingDemoScene.prototype.exit = function() {
        if (this._frameTimer) { clearInterval(this._frameTimer); this._frameTimer = null; }
    };

    LinuxLoadingDemoScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
    };

    LinuxLoadingDemoScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        if (!this._sheet || !this._sheet.naturalWidth) return;
        var fi = Math.floor((Date.now() - this._t0) * CLIP.fps / 1000) % CLIP.frames;
        canvas.ctx.drawImage(this._sheet,
            (fi % CLIP.cols) * CLIP.w, Math.floor(fi / CLIP.cols) * CLIP.h,
            CLIP.w, CLIP.h, 0, 0, canvas.w, canvas.h);
    };

    return LinuxLoadingDemoScene;
})();
