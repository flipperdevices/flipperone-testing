/**
 * KatakanaDemoScene
 *
 * Testing → Kickstarter demo → Selected / All → 'Katakana' → 'Static' /
 * 'Anim'. The teaser clip (assets/kickstarter_UI/katakana/
 * katakana_v003_1x.mp4: 256×144, 30 fps, 91 frames; the robot dolphin
 * spelling out フリッパー, status bar included in the art) full-screen:
 *   - Static — its last frame (the whole word), still;
 *   - Anim   — the clip looped from the moment it opens (from the first
 *              frame once the sheet has loaded).
 * Back / esc returns.
 *
 * Power meter, in both: a green battery outline and one usage bar
 * (METER). Testing → Power Meter's override, when set, is shown instead.
 *
 * The clip is a pre-rendered sprite sheet (every frame in a cols × rows
 * grid, one rect blitted per frame by wall-clock index), re-fetched on
 * every visit with a cache-busting query so a swapped sheet shows up
 * without reloading the page.
 *
 * Rebuild the sheet after changing the clip, from
 * assets/kickstarter_UI/katakana/:
 *   ffmpeg -i katakana_v003_1x.mp4 \
 *          -vf format=gray,tile=13x7 -frames:v 1 -update 1 katakana_v003_sheet.png
 */
var KatakanaDemoScene = (function() {
    var CLIP = {
        src: 'assets/kickstarter_UI/katakana/katakana_v003_sheet.png',
        frames: 91, cols: 13, fps: 30, w: 256, h: 144
    };
    var LOOP_MS = CLIP.frames * 1000 / CLIP.fps;

    var METER = {
        state: { battery: 'OUTLINE', usage: 1 },
        resendMs: 3000     // full re-send (pm6.sh may write over the LEDs)
    };

    function meterColors() {
        var ov = PowerMeterLeds.getOverride();
        return PowerMeterLeds.colors(ov || METER.state);
    }

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    // opts.anim: loop the clip; otherwise its last frame stays.
    function KatakanaDemoScene(sceneManager, opts) {
        this.sceneManager    = sceneManager || null;
        this._anim = !!(opts && opts.anim);
        this.displayName     = 'Katakana';
        this.breadcrumbTitle = this._anim ? 'Anim' : 'Static';
        this._sheet = null;
        this._t0 = 0;
        this._frameTimer = null;
        this._meterTimer = null;
    }

    KatakanaDemoScene.prototype.enter = function() {
        var self = this;
        var sheet = new Image();
        sheet.onload = function() {
            self._sheet = sheet;
            self._t0 = Date.now();
            repaint();
        };
        sheet.src = CLIP.src + '?v=' + Date.now();
        this._t0 = Date.now();
        if (this._anim && !this._frameTimer) {
            this._frameTimer = setInterval(repaint, Math.floor(1000 / CLIP.fps));
        }
        // Meter now (after a previous app's deferred PowerMeterLeds.stop())
        // and again every resendMs.
        setTimeout(function() { if (self._meterTimer) PowerMeterLeds.send(meterColors()); }, 0);
        this._meterTimer = setInterval(function() { PowerMeterLeds.send(meterColors()); }, METER.resendMs);
        repaint();
    };

    KatakanaDemoScene.prototype.exit = function() {
        if (this._frameTimer) { clearInterval(this._frameTimer); this._frameTimer = null; }
        if (this._meterTimer) {
            clearInterval(this._meterTimer);
            this._meterTimer = null;
            // Off, or Testing → Power Meter's override as the demos leave it.
            PowerMeterLeds.send(PowerMeterLeds.colors(PowerMeterLeds.getOverride()));
        }
    };

    KatakanaDemoScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
    };

    KatakanaDemoScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        if (!this._sheet || !this._sheet.naturalWidth) return;
        var fi = this._anim
            ? Math.floor(((Date.now() - this._t0) % LOOP_MS) * CLIP.fps / 1000)
            : CLIP.frames - 1;
        canvas.ctx.drawImage(this._sheet,
            (fi % CLIP.cols) * CLIP.w, Math.floor(fi / CLIP.cols) * CLIP.h,
            CLIP.w, CLIP.h, 0, 0, canvas.w, canvas.h);
    };

    return KatakanaDemoScene;
})();
