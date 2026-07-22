/**
 * UiPngViewerScene
 *
 * Testing tool: browse the PNGs dropped in /media/ui_png on the
 * device.
 *
 *   • List mode  — GET /api/ui-png returns the .png filenames;
 *     up/down scroll the list, OK opens the highlighted image,
 *     Back pops the app.
 *   • Image mode — the picture fills the screen (contain-fit);
 *     Left/Right step to the previous/next image and wrap around
 *     (infinite), Back returns to the list.
 *
 * Images are fetched from /media/ui_png/<name> (served by the Node
 * server straight off the device) and cached per name so stepping
 * back and forth doesn't refetch.
 */
var UiPngViewerScene = (function() {
    var TITLE_H  = 16;
    var LIST_TOP = 30;              // status bar (13) + title strip (16) + 1
    var ROW_H    = 16;
    var VISIBLE  = 7;               // (144 - 30) / 16, floored
    var ROW_LEFT = 6;

    function UiPngViewerScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'UI PNG viewer';
        this.breadcrumbTitle = 'UI PNG viewer';
        this.icon = (typeof Icons !== 'undefined' && Icons.system) ? Icons.system : null;

        this._files    = null;      // null = still loading; [] = loaded empty
        this._error    = null;
        this._sel      = 0;         // list selection index
        this._scroll   = 0;         // first visible row
        this._mode     = 'list';    // 'list' | 'image'
        this._idx      = 0;         // current image index (image mode)
        this._cache    = {};        // name → Image

        this._selector = new MenuSelectorFrame({
            x: 2, y: 0, width: 252, height: 15,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
    }

    UiPngViewerScene.prototype.enter = function() {
        if (typeof RunningApps !== 'undefined') {
            RunningApps.open(this.displayName, null, this.icon,
                function(sm) { return new UiPngViewerScene(sm); });
        }
        this._fetchList();
        if (window.requestRender) window.requestRender();
    };

    UiPngViewerScene.prototype.exit = function() {};

    // GET /api/ui-png → { files: [...] }.
    UiPngViewerScene.prototype._fetchList = function() {
        var self = this;
        try {
            var x = new XMLHttpRequest();
            x.open('GET', '/api/ui-png', true);
            x.timeout = 5000;
            x.onload = function() {
                if (x.status !== 200) { self._error = 'HTTP ' + x.status; }
                else {
                    try {
                        var d = JSON.parse(x.responseText);
                        self._files = Array.isArray(d.files) ? d.files : [];
                    } catch (e) { self._error = 'Bad response'; self._files = []; }
                }
                if (window.requestRender) window.requestRender();
            };
            x.onerror = x.ontimeout = function() {
                self._error = 'Request failed';
                self._files = [];
                if (window.requestRender) window.requestRender();
            };
            x.send();
        } catch (e) {
            self._error = 'offline';
            self._files = [];
        }
    };

    // Lazy per-name Image, cached. onload triggers a repaint.
    UiPngViewerScene.prototype._image = function(name) {
        if (this._cache[name]) return this._cache[name];
        var img = new Image();
        img.onload = function() { if (window.requestRender) window.requestRender(); };
        img.src = '/media/ui_png/' + encodeURIComponent(name);
        this._cache[name] = img;
        return img;
    };

    UiPngViewerScene.prototype._ensureVisible = function() {
        if (this._sel < this._scroll) this._scroll = this._sel;
        else if (this._sel >= this._scroll + VISIBLE) this._scroll = this._sel - VISIBLE + 1;
    };

    UiPngViewerScene.prototype.handleInput = function(action) {
        var n = (this._files && this._files.length) || 0;

        if (this._mode === 'image') {
            if (action === 'back' || action === 'esc') {
                this._mode = 'list';
                this._sel  = this._idx;   // land the list on the last-viewed pic
                this._ensureVisible();
                if (window.requestRender) window.requestRender();
                return;
            }
            if (n > 0 && (action === 'left' || action === 'right')) {
                var step = (action === 'right') ? 1 : -1;
                this._idx = (this._idx + step + n) % n;   // infinite wrap
                this._image(this._files[this._idx]);      // prefetch/cache
                if (window.requestRender) window.requestRender();
            }
            return;
        }

        // ── list mode ──
        if (action === 'back' || action === 'esc') return 'pop';
        if (n === 0) return;
        if (action === 'up' || action === 'down') {
            var d = (action === 'down') ? 1 : -1;
            this._sel = (this._sel + d + n) % n;          // wrap the list too
            this._ensureVisible();
            if (window.requestRender) window.requestRender();
            return;
        }
        if (action === 'ok' || action === 'run') {
            this._idx  = this._sel;
            this._mode = 'image';
            this._image(this._files[this._idx]);
            if (window.requestRender) window.requestRender();
        }
    };

    UiPngViewerScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;

        if (this._mode === 'image') {
            // Nothing but the PNG — no status bar, no title. The
            // image fills the whole screen (these are 256×144 screen
            // captures, so it's pixel-exact). White shows only while
            // the image is still loading.
            var name = this._files[this._idx];
            var img  = this._image(name);
            if (img && img.complete && img.naturalWidth > 0) {
                ctx.drawImage(img, 0, 0, canvas.w, canvas.h);
            } else {
                canvas.clear('#fff');
                var msg = 'Loading…';
                HaxrCorp4090FlipCTL.draw(ctx, msg,
                    Math.floor((canvas.w - HaxrCorp4090FlipCTL.textWidth(msg)) / 2),
                    Math.floor((canvas.h - 7) / 2), '#666');
            }
            return;
        }

        // ── list mode ──
        canvas.clear('#fff');
        if (typeof UI !== 'undefined' && UI.drawStatusBar) UI.drawStatusBar(canvas, '');
        ctx.fillStyle = '#D9D9D9';
        ctx.fillRect(0, UI.STATUS_BAR_H, canvas.w, TITLE_H);
        Born2bSportyV2FlipCTL.draw(ctx, this.displayName, 4, UI.STATUS_BAR_H, '#000');

        // Loading / empty / error states.
        if (this._files === null) { this._centerMsg(canvas, 'Loading…'); return; }
        if (this._error && this._files.length === 0) {
            this._centerMsg(canvas, this._error); return;
        }
        if (this._files.length === 0) {
            this._centerMsg(canvas, 'No PNGs in /media/ui_png'); return;
        }

        var end = Math.min(this._scroll + VISIBLE, this._files.length);
        for (var i = this._scroll; i < end; i++) {
            var y = LIST_TOP + (i - this._scroll) * ROW_H;
            var label = this._files[i].replace(/\.png$/i, '');
            label = this._fit(label, 246);
            if (i === this._sel) {
                this._selector.setPosition(2, y - 1);
                this._selector.setSize(252, 15);
                this._selector.render(canvas);
            }
            HaxrCorp4090FlipCTL.draw(ctx, label, ROW_LEFT, y + 2, '#000');
        }

        if (this._files.length > VISIBLE && UI.Scrollbar) {
            new UI.Scrollbar(this._files.length, VISIBLE, this._scroll)
                .render(canvas, 253, LIST_TOP - 1, VISIBLE * ROW_H, 1);
        }
    };

    // Truncate a label with an ellipsis so it fits `maxW` px.
    UiPngViewerScene.prototype._fit = function(s, maxW) {
        if (HaxrCorp4090FlipCTL.textWidth(s) <= maxW) return s;
        while (s.length > 1 && HaxrCorp4090FlipCTL.textWidth(s + '…') > maxW) {
            s = s.slice(0, -1);
        }
        return s + '…';
    };

    UiPngViewerScene.prototype._centerMsg = function(canvas, msg) {
        HaxrCorp4090FlipCTL.draw(canvas.ctx, msg,
            Math.floor((canvas.w - HaxrCorp4090FlipCTL.textWidth(msg)) / 2),
            Math.floor((canvas.h - 7) / 2), '#666');
    };

    return UiPngViewerScene;
})();
