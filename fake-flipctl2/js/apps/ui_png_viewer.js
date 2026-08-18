/**
 * UiPngViewerScene
 *
 * Testing tool: browse the PNGs dropped in /media/ui_png on the
 * device.
 *
 *   • List mode — GET /api/ui-png returns the .png/.mp4 names;
 *     up/down scroll the list, OK opens the highlighted file,
 *     Back pops the app.
 *   • View mode — the file fills the screen; Left/Right step to the
 *     previous/next file (stills and clips alike, one shared order)
 *     and wrap around, Back returns to the list.
 *
 * Stills are fetched from /media/ui_png/<name> and cached per name
 * so stepping back and forth doesn't refetch.
 *
 * Clips loop from a server-rendered sprite sheet (GET
 * /api/ui-png/frames + /api/ui-png/frames-sheet) blitted one frame
 * rect per rAF tick: the device's WPE/GStreamer <video> cannot loop
 * without a visible seam (the wrap is a seek + decoder restart,
 * ~66 ms measured), while a sheet wrap is index arithmetic — no
 * seam at all. If the sheet is unavailable (clip too long, ffmpeg
 * failure) a muted <video> with a manual ended→rewind loop is the
 * fallback.
 */
var UiPngViewerScene = (function() {
    var TITLE_H  = 16;
    var LIST_TOP = 30;              // status bar (13) + title strip (16) + 1
    var ROW_H    = 16;
    var VISIBLE  = 6;               // 6 rows leave room for the bottom bar
    var ROW_LEFT = 6;
    // Edit modal rows, top to bottom.
    var EDIT_ITEMS = ['Rename', 'Delete'];
    // Delete-confirmation rows. Cancel first — it's the safe
    // default selection.
    var DELETE_ITEMS = ['Cancel', 'Delete'];

    function UiPngViewerScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'UI PNG viewer';
        this.breadcrumbTitle = 'UI PNG viewer';
        this.icon = (typeof Icons !== 'undefined' && Icons.system) ? Icons.system : null;

        this._files    = null;      // null = still loading; [] = loaded empty
        this._error    = null;
        this._sel      = 0;         // list selection index
        this._scroll   = 0;         // first visible row
        this._mode     = 'list';    // 'list' | 'view'
        this._idx      = 0;         // file index shown by view mode
        this._cache    = {};        // name → Image (stills)
        this._video    = null;      // hidden <video> (fallback path only)
        this._videoName = null;     // clip being opened/played (async guard)
        this._sheet    = null;      // active sprite-sheet playback state
        this._sheetT0  = 0;         // wall-clock start of sheet playback
        this._sheets   = {};        // name → { img, frames, cols, w, h, fps }

        this._selector = new MenuSelectorFrame({
            x: 2, y: 0, width: 252, height: 15,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });

        // Edit modal (Rename / Delete) — opened by the V key / the
        // bottom-bar Edit button (V key) while the list has a selection.
        this._editModal = { open: false, sel: 0 };
        // Delete-confirmation gate — opened by the Edit modal's
        // Delete row. Cancel (index 0) is the default.
        this._deleteModal = { open: false, sel: 0 };
        this._modalSel  = new MenuSelectorFrame({
            x: 0, y: 0, width: 1, height: 1,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
        var self = this;
        // Bottom-bar slot 3 (x = 3 × (48 + 2) = 150).
        this._editBtn = new UI.MiddleButton('Edit', 3, 48, 2, 'del',
            function() { self._openEditModal(); });
    }

    UiPngViewerScene.prototype.enter = function() {
        if (typeof RunningApps !== 'undefined') {
            RunningApps.open(this.displayName, null, this.icon,
                function(sm) { return new UiPngViewerScene(sm); });
        }
        this._fetchList();
        if (window.requestRender) window.requestRender();
    };

    UiPngViewerScene.prototype.exit = function() {
        this._closeVideo();
    };

    // GET /api/ui-png → { files: [...] }. When `selectName` is
    // given, land the selection on that file after the reload
    // (post-rename); otherwise the old index is clamped in place
    // (post-delete the next file takes the slot).
    UiPngViewerScene.prototype._fetchList = function(selectName) {
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
                var files = self._files || [];
                if (selectName && files.indexOf(selectName) !== -1) {
                    self._sel = files.indexOf(selectName);
                }
                if (self._sel > files.length - 1) self._sel = Math.max(0, files.length - 1);
                if (self._idx > files.length - 1) self._idx = Math.max(0, files.length - 1);
                self._ensureVisible();
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

    UiPngViewerScene.prototype._post = function(url, body, cb) {
        try {
            var x = new XMLHttpRequest();
            x.open('POST', url, true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.timeout = 5000;
            x.onload = function() {
                var d = null;
                try { d = JSON.parse(x.responseText); } catch (e) {}
                if (cb) cb(d);
            };
            x.onerror = x.ontimeout = function() { if (cb) cb(null); };
            x.send(JSON.stringify(body));
        } catch (e) { if (cb) cb(null); }
    };

    // ── Edit modal ──────────────────────────────────────────────
    UiPngViewerScene.prototype._openEditModal = function() {
        if (!this._files || this._files.length === 0) return;
        this._editModal.open = true;
        this._editModal.sel  = 0;
        if (window.requestRender) window.requestRender();
    };

    UiPngViewerScene.prototype._handleEditModalInput = function(action) {
        var m = this._editModal;
        if (action === 'back' || action === 'esc') {
            m.open = false;
            if (window.requestRender) window.requestRender();
            return;
        }
        if (action === 'up' || action === 'down') {
            m.sel = (m.sel + 1) % EDIT_ITEMS.length;   // two rows — toggle
            if (window.requestRender) window.requestRender();
            return;
        }
        if (action === 'ok' || action === 'run') {
            m.open = false;
            if (EDIT_ITEMS[m.sel] === 'Rename') {
                this._startRename();
            } else {
                // Gate the destructive path behind a confirm modal;
                // Cancel is the default selection.
                this._deleteModal.open = true;
                this._deleteModal.sel  = 0;
                if (window.requestRender) window.requestRender();
            }
        }
    };

    UiPngViewerScene.prototype._handleDeleteModalInput = function(action) {
        var m = this._deleteModal;
        if (action === 'back' || action === 'esc') {
            m.open = false;
            if (window.requestRender) window.requestRender();
            return;
        }
        if (action === 'up' || action === 'down') {
            m.sel = (m.sel + 1) % DELETE_ITEMS.length;   // two rows — toggle
            if (window.requestRender) window.requestRender();
            return;
        }
        if (action === 'ok' || action === 'run') {
            m.open = false;
            if (DELETE_ITEMS[m.sel] === 'Delete') this._deleteSelected();
            if (window.requestRender) window.requestRender();
        }
    };

    // Rename via the standard TextInputScreen keyboard. onSave
    // POSTs the rename and refetches the list landed on the new
    // name; the keyboard pops itself.
    UiPngViewerScene.prototype._startRename = function() {
        var self = this;
        var from = this._files[this._sel];
        if (!from || !this.sceneManager) return;
        var extM = from.match(/\.(png|mp4)$/i);
        var ext  = extM ? extM[0].toLowerCase() : '.png';
        var base = from.replace(/\.(png|mp4)$/i, '');
        this.sceneManager.push(new TextInputScreen({
            displayName: 'Rename',
            title:       'Rename',
            initialText: base,
            validate: function(text) {
                var t = text.trim();
                if (!t) return 'Name required';
                if (t.indexOf('/') !== -1) return 'No slashes';
                var target = t + ext;
                if (target !== from
                        && self._files && self._files.indexOf(target) !== -1) {
                    return 'Name already exists';
                }
                return null;
            },
            onSave: function(text) {
                var to = text.trim();
                if (to && to !== base) {
                    // Caches are keyed by name — a future file could
                    // reuse the old one and show stale pixels.
                    delete self._cache[from];
                    delete self._sheets[from];
                    self._post('/api/ui-png/rename', { from: from, to: to },
                        function(r) {
                            self._fetchList(r && r.ok ? r.name : null);
                        });
                }
            }
        }));
    };

    // Delete the highlighted PNG — no confirmation, straight to
    // the endpoint, then reload the list (selection clamps onto
    // the next file).
    UiPngViewerScene.prototype._deleteSelected = function() {
        var self = this;
        var name = this._files[this._sel];
        if (!name) return;
        delete this._cache[name];
        delete this._sheets[name];
        this._post('/api/ui-png/delete', { name: name }, function() {
            self._fetchList(null);
        });
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

    function isVideo(name) { return /\.mp4$/i.test(name || ''); }

    // ── Opening files ───────────────────────────────────────────
    // One entry point for both kinds: land view mode on files[idx]
    // and start whatever that file needs. OK from the list and
    // Left/Right stepping both come through here, so stills and
    // clips live in one navigation order.
    UiPngViewerScene.prototype._openAt = function(idx) {
        var name = this._files[idx];
        if (!name) return;
        this._closeVideo();
        this._idx  = idx;
        this._mode = 'view';
        if (isVideo(name)) {
            this._videoName = name;
            this._openClip(name);
        } else {
            this._image(name);              // prefetch / cache
        }
        if (window.requestRender) window.requestRender();
    };

    // ── MP4 playback ────────────────────────────────────────────
    // Preferred path: ask the server for the clip's sprite sheet
    // (one PNG, all frames in a cols×rows grid; built by ffmpeg on
    // first use, then cached). render() blits one frame rect per
    // tick and the loop wrap is pure index arithmetic — no seam.
    // The <video> element only exists as a fallback for clips the
    // server refuses (too long) or when the sheet fails to arrive.
    UiPngViewerScene.prototype._openClip = function(name) {
        var self = this;
        var cached = this._sheets[name];
        if (cached) {
            this._sheet   = cached;
            this._sheetT0 = Date.now();
            return;
        }
        var x = new XMLHttpRequest();
        x.open('GET', '/api/ui-png/frames?name=' + encodeURIComponent(name), true);
        x.timeout = 30000;   // first hit runs ffmpeg on the device
        x.onload = function() {
            if (self._videoName !== name) return;   // user moved on
            var meta = null;
            try { meta = JSON.parse(x.responseText); } catch (e) {}
            if (!meta || !meta.ok) { self._openVideoElement(name); return; }
            var img = new Image();
            img.onload = function() {
                // Cache even if the user moved on — it's downloaded.
                var sheet = { img: img, frames: meta.frames, cols: meta.cols,
                              w: meta.w, h: meta.h, fps: meta.fps };
                self._sheets[name] = sheet;
                if (self._videoName !== name) return;
                self._sheet   = sheet;
                self._sheetT0 = Date.now();
                if (window.requestRender) window.requestRender();
            };
            img.onerror = function() {
                if (self._videoName === name) self._openVideoElement(name);
            };
            img.src = '/api/ui-png/frames-sheet?name=' + encodeURIComponent(name);
        };
        x.onerror = x.ontimeout = function() {
            if (self._videoName === name) self._openVideoElement(name);
        };
        x.send();
    };

    // Fallback player: hidden muted <video>, blitted per tick.
    // NOT `loop = true`. On the device's WPE WebKit / GStreamer
    // backend the native loop is broken: at the end it seeks
    // currentTime back to 0 but never resumes decoding — the
    // element sits at t=0 with paused=false, ended=false,
    // readyState=4 and the picture freezes. And because the spec
    // says `loop` suppresses `ended`, no event ever fires to
    // recover from it. Measured on WPE 2.48.3 / GStreamer 1.26.2
    // with both a blob URL and a plain http src. So drive the wrap
    // by hand: let `ended` fire, rewind, play again — a ~66 ms
    // seam, which is why the sheet path above is preferred.
    UiPngViewerScene.prototype._openVideoElement = function(name) {
        var self = this;
        var v = document.createElement('video');
        v.muted = true;    // allows autoplay without a gesture
        v.loop  = false;
        v.setAttribute('playsinline', '');
        v.style.display = 'none';
        document.body.appendChild(v);
        v.addEventListener('ended', function() {
            try {
                v.currentTime = 0;
                var p = v.play();
                if (p && p.catch) p.catch(function() { /* ignore */ });
            } catch (e) { /* best effort */ }
        });
        this._video = v;

        // Pull the WHOLE file into a Blob and play the object URL.
        // An in-memory source is fully seekable, so the loop's
        // seek-back-to-0 always works — no dependence on server
        // Range support. The spinner shows during the fetch.
        var x = new XMLHttpRequest();
        x.open('GET', '/media/ui_png/' + encodeURIComponent(name), true);
        x.responseType = 'blob';
        x.onload = function() {
            // Ignore if the user already backed out / switched.
            if (self._video !== v || x.status !== 200) return;
            var url = URL.createObjectURL(x.response);
            v._blobUrl = url;
            v.src = url;
            var p = v.play();
            if (p && p.catch) p.catch(function() { /* autoplay veto */ });
            if (window.requestRender) window.requestRender();
        };
        x.send();
        if (window.requestRender) window.requestRender();
    };

    // Stop clip playback of either kind. The per-name sheet cache
    // survives (like _cache for stills) so re-opening is instant.
    UiPngViewerScene.prototype._closeVideo = function() {
        this._sheet     = null;
        this._videoName = null;
        if (!this._video) return;
        try {
            this._video.pause();
            this._video.removeAttribute('src');
            this._video.load();
            if (this._video._blobUrl) URL.revokeObjectURL(this._video._blobUrl);
            if (this._video.parentNode) {
                this._video.parentNode.removeChild(this._video);
            }
        } catch (e) { /* teardown is best-effort */ }
        this._video = null;
    };

    UiPngViewerScene.prototype._ensureVisible = function() {
        if (this._sel < this._scroll) this._scroll = this._sel;
        else if (this._sel >= this._scroll + VISIBLE) this._scroll = this._sel - VISIBLE + 1;
    };

    UiPngViewerScene.prototype.handleInput = function(action) {
        var n = (this._files && this._files.length) || 0;

        // Modals swallow everything while open (list mode only) —
        // the delete gate sits on top of the Edit modal.
        if (this._deleteModal.open) {
            return this._handleDeleteModalInput(action);
        }
        if (this._editModal.open) {
            return this._handleEditModalInput(action);
        }

        if (this._mode === 'view') {
            if (action === 'back' || action === 'esc') {
                this._closeVideo();
                this._mode = 'list';
                this._sel  = this._idx;   // land the list on the last-viewed file
                this._ensureVisible();
                if (window.requestRender) window.requestRender();
                return;
            }
            if (n > 0 && (action === 'left' || action === 'right')) {
                // Infinite wrap over ALL files — stills and clips
                // share one order; stepping onto a clip plays it.
                var step = (action === 'right') ? 1 : -1;
                this._openAt((this._idx + step + n) % n);
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
            this._openAt(this._sel);
            return;
        }
        if (action === 'del') {
            // V key — flash the bottom-bar button, then open the
            // Edit modal (same 30 ms press pattern the other
            // bottom buttons use).
            var self = this;
            this._editBtn.press();
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                self._editBtn.release();
                self._openEditModal();
                if (window.requestRender) window.requestRender();
            }, 30);
        }
    };

    UiPngViewerScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;

        if (this._mode === 'view') {
            // Nothing but the file — no status bar, no title. It
            // fills the whole screen (these are 256×144 screen
            // captures, so it's pixel-exact). White + spinner only
            // while something is still loading.
            var name = this._files[this._idx];
            if (isVideo(name)) {
                var sh = this._sheet;
                if (sh) {
                    // Wall-clock frame index → one rect of the sheet.
                    // The modulo IS the loop: wrapping costs the same
                    // as any other frame step, hence no visible seam.
                    var fi = Math.floor((Date.now() - this._sheetT0)
                                        * sh.fps / 1000) % sh.frames;
                    ctx.drawImage(sh.img,
                        (fi % sh.cols) * sh.w,
                        Math.floor(fi / sh.cols) * sh.h,
                        sh.w, sh.h,
                        0, 0, canvas.w, canvas.h);
                } else if (this._video && this._video.readyState >= 2) {
                    ctx.drawImage(this._video, 0, 0, canvas.w, canvas.h);
                } else {
                    canvas.clear('#fff');
                    this._drawSpinner(canvas);
                }
                // Keep the rAF loop alive while a clip is on screen.
                if (window.requestRender) window.requestRender();
                return;
            }
            var img = this._image(name);
            if (img && img.complete && img.naturalWidth > 0) {
                ctx.drawImage(img, 0, 0, canvas.w, canvas.h);
            } else {
                canvas.clear('#fff');
                this._drawSpinner(canvas);
                // Keep the spinner turning until onload repaints.
                if (window.requestRender) window.requestRender();
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

        // Bottom-bar Edit button (V key).
        this._editBtn.render(canvas);

        // Modals — wash + centred frame + two option rows, the
        // highlighted one wrapped by a MenuSelectorFrame (same
        // idiom as the keyboard's discard modal). The delete gate
        // replaces the Edit modal (only one is ever open).
        var base = this._files[this._sel]
            ? this._files[this._sel].replace(/\.png$/i, '') : '';
        if (this._deleteModal.open) {
            this._renderChoiceModal(canvas, 'Delete ' + base,
                DELETE_ITEMS, this._deleteModal.sel);
        } else if (this._editModal.open) {
            this._renderChoiceModal(canvas, 'Edit ' + base,
                EDIT_ITEMS, this._editModal.sel);
        }
    };

    // Shared two-option modal renderer: translucent wash, 150×60
    // centred frame, Sporty title (truncated to fit), stacked
    // Haxrcorp rows with the selector frame on `sel`.
    UiPngViewerScene.prototype._renderChoiceModal = function(canvas, title, items, sel) {
        var ctx = canvas.ctx;
        var MW = 150, MH = 60;
        var MX = Math.floor((canvas.w - MW) / 2);
        var MY = Math.floor((canvas.h - MH) / 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        new ResponsiveFrame({
            x: MX, y: MY, width: MW, height: MH,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true,
            fillColor:   '#fff', showFill:   true,
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);

        while (title.length > 1
               && Born2bSportyV2FlipCTL.textWidth(title) > MW - 12) {
            title = title.slice(0, -1);
        }
        var mtW = Born2bSportyV2FlipCTL.textWidth(title);
        Born2bSportyV2FlipCTL.draw(ctx, title,
            MX + Math.floor((MW - mtW) / 2), MY + 5, '#000');

        var BTN_H = 14, BTN_W = MW - 16;
        var BTN_X = MX + 8;
        for (var r = 0; r < items.length; r++) {
            var by = MY + 24 + r * 16;
            var lw = HaxrCorp4090FlipCTL.textWidth(items[r]);
            HaxrCorp4090FlipCTL.draw(ctx, items[r],
                BTN_X + Math.floor((BTN_W - lw) / 2),
                by + Math.floor((BTN_H - 11) / 2), '#000');
            if (sel === r) {
                this._modalSel.setPosition(BTN_X, by);
                this._modalSel.setSize(BTN_W, BTN_H);
                this._modalSel.render(canvas);
            }
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

    // Centred loading spinner — the shared spinner_22x20px strip at
    // the project-standard 80 ms frame cadence (wordless).
    UiPngViewerScene.prototype._drawSpinner = function(canvas) {
        if (typeof AnimatedIcons === 'undefined'
                || !AnimatedIcons.spinner_22x20px) return;
        var sp       = AnimatedIcons.spinner_22x20px;
        var FRAME_MS = 80;
        var frameH   = Math.floor(sp.h / sp.frames);
        var frame    = Math.floor(Date.now() / FRAME_MS) % sp.frames;
        canvas.drawSpriteFrame(sp,
            Math.floor((canvas.w - sp.w) / 2),
            Math.floor((canvas.h - frameH) / 2),
            frame, '#000');
    };

    UiPngViewerScene.prototype._centerMsg = function(canvas, msg) {
        HaxrCorp4090FlipCTL.draw(canvas.ctx, msg,
            Math.floor((canvas.w - HaxrCorp4090FlipCTL.textWidth(msg)) / 2),
            Math.floor((canvas.h - 7) / 2), '#666');
    };

    return UiPngViewerScene;
})();
