/**
 * KickstarterConnectDemo
 *
 * Shared engine for the Kickstarter "plug something in" demo apps
 * (SDR connected, Desktop computer). Each app has two full-screen
 * states:
 *
 *   • Disconnected — a still PNG.
 *   • Connected    — optional `intro` clip played once, then a looping
 *                    clip. Both come from pre-rendered sprite sheets
 *                    (every frame in a cols × rows grid, blitted one rect
 *                    per tick, so the wrap has no seam — same technique
 *                    as the UI PNG viewer). Restarts from the intro's
 *                    first frame on every connect.
 *
 * Detection: the app's `fetch(ctx, done)` is polled every pollMs and
 * reports the set of ids currently present (devices, ports, connectors).
 * The first snapshot is the baseline (built-in hardware); any id not in
 * the baseline means "connected". A baseline id that disappears is
 * dropped from it, so something already plugged in when the app opened
 * counts once it is replugged. `done({ ids, absorb })`: `absorb` lists
 * ids to add to the baseline (a data source that only just came up).
 * `ctx` is a per-visit object the fetcher can keep state in.
 *
 * Images are re-fetched on every enter() with a cache-busting query, so
 * art swapped on disk shows up the next time the app is opened without
 * reloading the long-lived page on the device; the previous copy stays
 * on screen until the fresh one has loaded.
 *
 * OK toggles a manual "connected" override (preview without hardware,
 * or a backup during a shoot). Back returns to the previous list.
 *
 * Usage:
 *   var FooScene = KickstarterConnectDemo({
 *       name: 'Foo', disconnectedSrc: '…png',
 *       intro: { …same fields… },     // optional, played once
 *       clip: { src: '…sheet.png', frames, cols, fps, w: 256, h: 144 },
 *       pollMs: 150, fetch: function(ctx, done) { … }
 *   });
 */
var KickstarterConnectDemo = (function() {
    var images = {};
    function load(src) {
        var img = new Image();
        img.onload = function() {
            images[src] = img;
            if (window.requestRender) window.requestRender();
        };
        img.src = src + '?v=' + Date.now();
        if (!images[src]) images[src] = img;
    }
    function image(src) {
        if (!images[src]) load(src);
        return images[src];
    }
    function ready(img) { return img && img.complete && img.naturalWidth > 0; }

    // GET a JSON endpoint; done(parsed) or done(null) on any failure.
    function getJson(url, done) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = 2000;
            xhr.onload = function() {
                var d = null;
                try { d = JSON.parse(xhr.responseText); } catch (e) {}
                done(d);
            };
            xhr.onerror = xhr.ontimeout = function() { done(null); };
            xhr.send();
        } catch (e) { done(null); }
    }

    // Blit frame `fi` of a sheet clip; false if the sheet isn't loaded.
    function drawFrame(canvas, c, fi) {
        var sheet = image(c.src);
        if (!ready(sheet)) return false;
        canvas.ctx.drawImage(sheet,
            (fi % c.cols) * c.w, Math.floor(fi / c.cols) * c.h,
            c.w, c.h, 0, 0, canvas.w, canvas.h);
        return true;
    }

    function make(opts) {
        var clip   = opts.clip;
        var intro  = opts.intro || null;
        var introMs = intro ? intro.frames * 1000 / intro.fps : 0;
        var pollMs = opts.pollMs || 150;

        function Scene(sceneManager) {
            this.sceneManager    = sceneManager || null;
            this.displayName     = opts.name;
            this.breadcrumbTitle = opts.name;
            this._baseline  = null;    // id -> true, set by the first snapshot
            this._fresh     = false;   // a non-baseline id is present
            this._manual    = false;   // OK override
            this._connected = false;
            this._t0        = 0;       // loop start, reset on every connect
            this._pollTimer = null;
            this._visit     = 0;       // ignores replies from an earlier visit
            this._ctx       = {};
        }

        Scene.prototype.enter = function() {
            var self = this;
            load(opts.disconnectedSrc);
            if (intro) load(intro.src);
            load(clip.src);
            this._visit++;
            this._ctx      = {};
            this._baseline = null;
            this._fresh    = false;
            this._update();
            this._poll();
            if (this._pollTimer) clearInterval(this._pollTimer);
            this._pollTimer = setInterval(function() { self._poll(); }, pollMs);
        };

        Scene.prototype.exit = function() {
            this._visit++;
            if (this._pollTimer) {
                clearInterval(this._pollTimer);
                this._pollTimer = null;
            }
        };

        Scene.prototype._poll = function() {
            var self  = this;
            var visit = this._visit;
            opts.fetch(this._ctx, function(snap) {
                if (visit !== self._visit || !snap) return;   // exited, or no data
                if (snap.absorb) self._absorb(snap.absorb);
                self._onIds(snap.ids || []);
            });
        };

        // Add ids to the baseline (treated as built-in). Before the first
        // snapshot there is no baseline yet; that snapshot becomes it whole.
        Scene.prototype._absorb = function(ids) {
            if (this._baseline === null) return;
            for (var i = 0; i < ids.length; i++) this._baseline[ids[i]] = true;
        };

        Scene.prototype._onIds = function(ids) {
            var present = {};
            for (var i = 0; i < ids.length; i++) present[ids[i]] = true;
            if (this._baseline === null) {
                this._baseline = present;
            } else {
                // Forget built-in entries that went away, so a replug counts.
                for (var id in this._baseline) {
                    if (!present[id]) delete this._baseline[id];
                }
            }
            var fresh = false;
            for (var p in present) {
                if (!this._baseline[p]) { fresh = true; break; }
            }
            this._fresh = fresh;
            this._update();
        };

        Scene.prototype._update = function() {
            var on = this._fresh || this._manual;
            if (on && !this._connected) this._t0 = Date.now();
            if (on !== this._connected) {
                this._connected = on;
                if (window.requestRender) window.requestRender();
            }
        };

        Scene.prototype.handleInput = function(action) {
            if (action === 'back' || action === 'esc') return 'pop';
            if (action === 'ok') {
                this._manual = !this._manual;
                this._update();
            }
        };

        Scene.prototype.render = function(canvas) {
            var ctx = canvas.ctx;
            if (this._connected) {
                // Wall-clock timeline: intro once, then the loop (the
                // modulo is the loop).
                var t = Date.now() - this._t0;
                var drawn;
                if (t < introMs) {
                    drawn = drawFrame(canvas, intro,
                        Math.min(intro.frames - 1, Math.floor(t * intro.fps / 1000)));
                } else {
                    drawn = drawFrame(canvas, clip,
                        Math.floor((t - introMs) * clip.fps / 1000) % clip.frames);
                }
                if (!drawn) canvas.clear('#fff');
                // Keep the render loop running while the clip plays.
                if (window.requestRender) window.requestRender();
                return;
            }
            var still = image(opts.disconnectedSrc);
            if (ready(still)) ctx.drawImage(still, 0, 0, canvas.w, canvas.h);
            else canvas.clear('#fff');
        };

        return Scene;
    }

    make.getJson = getJson;
    return make;
})();
