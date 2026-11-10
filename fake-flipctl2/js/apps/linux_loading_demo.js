/**
 * LinuxLoadingDemoScene
 *
 * Testing → UI Demos → Linux loading → 'Powermeter - OFF' / 'Powermeter
 * - ON'. Plays the designer's Linux
 * boot animation full-screen (assets/kickstarter_UI/linux_loading/
 * F1_Linux_animation_v008_1x.mp4: 256×144, 60 fps, 300 frames; status
 * bar, Tux, LOADING... bar, service list and Logs tab are all part of
 * the art), looped from the moment it opens (from the first frame once
 * the sheet has loaded). Back / esc returns.
 *
 * With the power meter on, its LEDs follow the clip, restarting with
 * every loop: a green battery outline and one usage bar while the
 * kernel starts, two bars from the moment the services start loading,
 * and the third bar flashing now and then on top as a spike (METER).
 * Testing → Power Meter's override, when set, is shown instead.
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
    var LOOP_MS = CLIP.frames * 1000 / CLIP.fps;

    // Power meter timeline, in ms from the start of the loop: one bar
    // during "Starting kernel" (until the LOADING bar starts to fill at
    // frame 24), then two, with the third flashing for each
    // [start, length] spike.
    var METER = {
        twoBarsAt: 400,
        spikes: [[650, 120], [950, 240], [1400, 120], [1750, 120], [2050, 240],
                 [2550, 120], [2850, 120], [3350, 240], [3900, 120], [4300, 120],
                 [4600, 240]],
        tickMs: 20,
        resendMs: 3000     // full re-send (pm6.sh may write over the LEDs)
    };

    function meterColors(t) {
        var ov = PowerMeterLeds.getOverride();
        if (ov) return PowerMeterLeds.colors(ov);
        var usage = t < METER.twoBarsAt ? 1 : 2;
        for (var i = 0; i < METER.spikes.length; i++) {
            var sp = METER.spikes[i];
            if (t >= sp[0] && t < sp[0] + sp[1]) { usage = 3; break; }
        }
        return PowerMeterLeds.colors({ battery: 'OUTLINE', usage: usage });
    }

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    // opts.meter: drive the power meter LEDs along with the clip.
    function LinuxLoadingDemoScene(sceneManager, opts) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Linux loading';
        this.breadcrumbTitle = 'Linux loading';
        this._meter = !!(opts && opts.meter);
        this._sheet = null;
        this._t0 = 0;
        this._frameTimer = null;
        this._meterTimer = null;
        this._ledSent = null;
        this._ledSentAt = 0;
    }

    LinuxLoadingDemoScene.prototype.enter = function() {
        var self = this;
        var sheet = new Image();
        sheet.onload = function() {
            self._sheet = sheet;
            self._t0 = Date.now();
            repaint();
            if (self._meter && !self._meterTimer) {
                self._meterTimer = setInterval(function() { self._meterTick(); }, METER.tickMs);
                // After a previous app's deferred PowerMeterLeds.stop().
                setTimeout(function() { self._meterTick(); }, 0);
            }
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
        if (this._meterTimer) {
            clearInterval(this._meterTimer);
            this._meterTimer = null;
            this._ledSent = null;
            // Off, or Testing → Power Meter's override as the demos leave it.
            PowerMeterLeds.send(PowerMeterLeds.colors(PowerMeterLeds.getOverride()));
        }
    };

    // Sends the meter LEDs that changed since the last send (all of
    // them every METER.resendMs).
    LinuxLoadingDemoScene.prototype._meterTick = function() {
        if (!this._meterTimer) return;
        var now = Date.now();
        var c = meterColors((now - this._t0) % LOOP_MS);
        var all = !this._ledSent || now - this._ledSentAt >= METER.resendMs;
        var changed = {}, any = false;
        for (var n in c) {
            if (all || this._ledSent[n] !== c[n]) { changed[n] = c[n]; any = true; }
        }
        if (all) this._ledSentAt = now;
        if (!any) return;
        this._ledSent = c;
        PowerMeterLeds.send(changed);
    };

    LinuxLoadingDemoScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
    };

    LinuxLoadingDemoScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        if (!this._sheet || !this._sheet.naturalWidth) return;
        var fi = Math.floor(((Date.now() - this._t0) % LOOP_MS) * CLIP.fps / 1000);
        canvas.ctx.drawImage(this._sheet,
            (fi % CLIP.cols) * CLIP.w, Math.floor(fi / CLIP.cols) * CLIP.h,
            CLIP.w, CLIP.h, 0, 0, canvas.w, canvas.h);
    };

    return LinuxLoadingDemoScene;
})();
