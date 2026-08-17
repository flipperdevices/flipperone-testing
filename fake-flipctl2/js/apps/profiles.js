// FlipperOS app — a thin UI over the /usr/local/sbin btrfs helpers:
//   Profiles        → GET  /api/profiles          (list-profiles)
//                     soft buttons: Default (stub) · Delete (delete-profile)
//   Snapshots       → GET  /api/snapshots         (list-snapshots)
//                     soft buttons: Delete (delete-snapshot) · Restore (create-profile)
//   Create snapshot → POST /api/snapshots/create  (create-snapshot)
//
// Entry point is ProfilesApp.makeMenu(sceneManager): it returns a
// SubMenuScene ("FlipperOS") whose rows push the scenes below.
// Registered from the Settings submenu in menu.js.
var ProfilesApp = (function() {

    // Wrap `text` into lines no wider than `maxW` px, measuring with the
    // active bitmap font. Breaks on spaces; hard-splits any single token
    // that's still too wide (btrfs paths have no spaces).
    function wrapText(canvas, text, maxW) {
        var out = [], words = String(text).split(/\s+/), line = '';
        function pushHardSplit(w) {
            var chunk = '';
            for (var i = 0; i < w.length; i++) {
                if (canvas.textWidth(chunk + w[i]) > maxW && chunk) {
                    out.push(chunk); chunk = '';
                }
                chunk += w[i];
            }
            line = chunk;
        }
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (!w) continue;
            var cand = line ? line + ' ' + w : w;
            if (canvas.textWidth(cand) <= maxW) {
                line = cand;
            } else {
                if (line) { out.push(line); line = ''; }
                if (canvas.textWidth(w) > maxW) pushHardSplit(w);
                else line = w;
            }
        }
        if (line) out.push(line);
        return out;
    }

    function rr() { if (window.requestRender) window.requestRender(); }

    // Centered modal box: `lines` of body text + a dim `hint` row.
    // Word-wrap using a specific pixel font's metrics.
    function wrapFont(font, text, maxW) {
        var out = [], words = String(text).split(/\s+/), line = '';
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (!w) continue;
            var cand = line ? line + ' ' + w : w;
            if (font.textWidth(cand) <= maxW) { line = cand; }
            else { if (line) out.push(line); line = w; }
        }
        if (line) out.push(line);
        return out;
    }

    function drawModal(canvas, lines, kind, frame) {
        var ctx = canvas.ctx;
        // Dim the screen behind the dialog (same wash the other apps' modals use).
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        var pad = 6, tlh = 13, blh = 11, maxW = canvas.w - 32;
        // First line is a bold Born2bSportyV2 title; the rest is HaxrCorp body.
        var titleLines = wrapFont(Born2bSportyV2FlipCTL, lines[0] || '', maxW);
        var bodyLines = [];
        for (var li = 1; li < lines.length; li++) {
            bodyLines = bodyLines.concat(wrapFont(HaxrCorp4090FlipCTL, lines[li], maxW));
        }

        // Busy dialogs get an animated spinner under the text.
        var sp = (kind === 'busy' && typeof AnimatedIcons !== 'undefined')
            ? AnimatedIcons.spinner_22x20px : null;
        var spH = sp ? Math.floor(sp.h / (sp.frames || 1)) : 0;

        var contentW = sp ? sp.w : 0;
        titleLines.forEach(function(l) { var w = Born2bSportyV2FlipCTL.textWidth(l); if (w > contentW) contentW = w; });
        bodyLines.forEach(function(l) { var w = HaxrCorp4090FlipCTL.textWidth(l); if (w > contentW) contentW = w; });
        var boxW = Math.min(canvas.w - 16, contentW + pad * 2);
        var boxH = titleLines.length * tlh + bodyLines.length * blh + pad * 2 + (spH ? spH + 4 : 0);
        var boxX = Math.floor((canvas.w - boxW) / 2);
        var boxY = Math.floor((canvas.h - 14 - boxH) / 2);   // leave room for the button bar

        new ResponsiveFrame({
            x: boxX, y: boxY, width: boxW, height: boxH,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true,
            fillColor: '#fff', showFill: true, cornerRadius: 3
        }).render(canvas);

        var ty = boxY + pad;
        titleLines.forEach(function(l) {
            var w = Born2bSportyV2FlipCTL.textWidth(l);
            Born2bSportyV2FlipCTL.draw(ctx, l, boxX + Math.floor((boxW - w) / 2), ty, '#000');
            ty += tlh;
        });
        bodyLines.forEach(function(l) {
            var w = HaxrCorp4090FlipCTL.textWidth(l);
            HaxrCorp4090FlipCTL.draw(ctx, l, boxX + Math.floor((boxW - w) / 2), ty, '#000');
            ty += blh;
        });
        if (sp) {
            canvas.drawSpriteFrame(sp, boxX + Math.floor((boxW - sp.w) / 2), ty + 2,
                (frame || 0) % (sp.frames || 1), '#000');
        }

        // Bottom action buttons, matching the app's modal convention.
        if (kind === 'confirm') {
            new UI.LeftButton('Cancel', 48, 'esc', null).render(canvas);
            new UI.RightButton('OK', 48, 'run', null, canvas.w).render(canvas);
        } else if (kind === 'notice') {
            new UI.RightButton('OK', 48, 'run', null, canvas.w).render(canvas);
        }
    }

    // Centred loading spinner (the shared 8-frame spinner_22x20px), drawn
    // in the middle of (top..bottom). `frame` advances the animation.
    function drawSpinner(canvas, top, bottom, frame) {
        if (typeof AnimatedIcons === 'undefined' || !AnimatedIcons.spinner_22x20px) {
            canvas.drawText('Loading...', 4, top, '#888');
            return;
        }
        var sp = AnimatedIcons.spinner_22x20px;
        var fh = Math.floor(sp.h / (sp.frames || 1));
        var cx = Math.floor((canvas.w - sp.w) / 2);
        var cy = Math.floor((top + bottom - fh) / 2);
        canvas.drawSpriteFrame(sp, cx, cy, (frame || 0) % (sp.frames || 1), '#000');
    }

    // Popup menu: optional title + icon'd, selectable options. Used for the
    // Restore/Delete choice on a snapshot (Enter opens it). Fonts follow the
    // app menu convention: Busy9px labels, Born2bSportyV2 when selected, with
    // a rounded selection frame.
    function drawMenu(canvas, d) {
        var pad = 4, rowH = 16, titleH = 11;
        var boxW = canvas.w - 20, x = 10;
        var titleLines = d.title ? wrapText(canvas, d.title, boxW - 2 * pad) : [];
        var boxH = titleLines.length * titleH + d.options.length * rowH + 2 * pad
                   + (titleLines.length ? 2 : 0);
        var y = Math.max(UI.STATUS_BAR_H + 2, Math.floor((144 - boxH) / 2));
        canvas.drawRect(x, y, boxW, boxH, '#fff');
        canvas.drawFrame(x, y, boxW, boxH, '#000');
        var ty = y + pad;
        titleLines.forEach(function(l) {
            HaxrCorp4090FlipCTL.draw(canvas.ctx, l, x + pad, ty, '#888'); ty += titleH;
        });
        if (titleLines.length) ty += 2;
        for (var i = 0; i < d.options.length; i++) {
            var opt = d.options[i];
            var sel = (i === d.sel);
            var oy = ty + i * rowH;
            if (sel) canvas.drawRoundFrame(x + 2, oy - 1, boxW - 4, rowH - 1, 2, '#000');
            var lx = x + pad;
            if (opt.icon) { canvas.drawSprite(opt.icon, lx, oy, '#000'); lx += (opt.icon.w || 14) + 3; }
            // Born2b's baseline is 1px lower than Busy9px's; offsetting keeps
            // the label on the same baseline whether selected or not (no jump).
            if (sel) Born2bSportyV2FlipCTL.draw(canvas.ctx, opt.label, lx, oy - 1, '#000');
            else Busy9pxFlipCTL.draw(canvas.ctx, opt.label, lx, oy, '#000');
        }
    }

    // ── Generic scrollable list scene with soft buttons ──────────
    // Fetches `endpoint`, reads array `key` from the JSON, keeps the raw
    // entries, and maps each through `formatRow(entry)` to a display
    // string. `buttons` is an array of { label, action, run } — `run`
    // gets (scene, selectedEntry). Loading / error / empty are handled.
    var LIST_ITEM_H = 12;
    var BUTTON_ROW_H = 15;

    // Settings-submenu geometry (mirrors SubMenuScene in submenu.js) so
    // FlipperOS lists share the same rows, markers, dividers and scrollbar.
    var ROW_H = MenuLine.H;              // 20px row (14px icon + 3+3 padding)
    var ROW_STEP = ROW_H + 1;            // + 1px gray divider between rows
    var CONTAINER_X = 5;                 // line x so the 14px icon lands at x=8
    var SELECTOR_X = 4;
    var SELECTOR_H = 22;
    var SELECTOR_CORNER_R = 3;
    var SELECTOR_Y_OFFSET = -1;
    var SELECTOR_W_WITH_SCROLL = 244;    // leaves room for the scrollbar
    var SELECTOR_W_NO_SCROLL   = 247;
    var SCROLLBAR_X = 253;
    var SCROLLBAR_Y = 15;
    var STATUS_PAD_R = 5;                // matches MenuLine's right padding
    var DIVIDER_COLOR = '#CCCCCC';

    function containerTop() { return UI.STATUS_BAR_H + 15; }

    // Build a Settings-style MenuLine for one list item. Animated icon
    // strips go through iconAnimated (they play only while the row is
    // selected); everything else is a static icon. activeLabelYNudge 0
    // matches the -1 selector offset used here (see MenuLine's note).
    function makeLine(it, w) {
        var o = { text: it.label, width: w, status: it.detail || null,
                  activeLabelYNudge: 0, labelScroll: true };
        if (it.icon) {
            if ((it.icon.frames || 1) > 1) o.iconAnimated = it.icon;
            else o.icon = it.icon;
        }
        return new MenuLine(o);
    }

    function ListScene(title, endpoint, key, formatRow, buttons, opts) {
        opts = opts || {};
        this.title = title;
        this.breadcrumbTitle = title;
        this.endpoint = endpoint;
        this.key = key;
        this.formatRow = formatRow;
        // Optional section header (icon + label) drawn under the status bar.
        this.headerLabel = opts.headerLabel || null;
        this.headerIcon = opts.headerIcon || null;
        this.rowIcon = opts.rowIcon || null;       // fn(entry) -> per-row icon
        this.rowDetail = opts.rowDetail || null;   // fn(entry) -> right-aligned detail
        this.detailHeader = opts.detailHeader || null;  // column header over rowDetail
        this.rowH = opts.rowH || LIST_ITEM_H;
        this.sm = opts.sceneManager || null;       // to push child scenes on OK
        this.onSelect = opts.onSelect || null;     // fn(scene, entry) on OK
        this.prepend = opts.prepend || [];         // synthetic action rows first
        this.filter = opts.filter || null;         // fn(entry) -> keep?
        this.sort = opts.sort || null;             // fn(a,b) applied after filter
        this.buttonDefs = buttons || [];
        this.buttons = [];
        this.entries = [];
        this.rows = [];
        this.loading = true;
        this.error = null;
        this.sel = 0;
        this.scroll = 0;
        // dialog: null | {kind:'confirm', lines, onYes}
        //              | {kind:'notice',  lines, afterClose}
        //              | {kind:'busy',    lines}
        this.dialog = null;
        this._animFrame = 0;      // drives animated-icon playback (selected row)
        this._animTimer = null;

        // Bottom soft buttons. On this device the physical button under
        // the X/'edit' slot is grabbed by the MCU's CPU menu, so we use
        // only the three positions the on-device testing tools use
        // (UIInput-forwarding, Power-menu demo, record):
        //   left  → 'esc' (x=0)
        //   mid   → 'del' (V slot, x=156)
        //   right → 'run' (x=208)
        var self = this;
        this.buttonDefs.forEach(function(def) {
            var btn;
            if (def.slot === 'left') {
                btn = new UI.LeftButton(def.label, 48, 'esc', null);
            } else if (def.slot === 'edit') {
                // X slot (second from the left, x=50).
                btn = new UI.MiddleButton(def.label, 1, 48, 2, 'edit', null);
            } else if (def.slot === 'middle') {
                btn = new UI.MiddleButton(def.label, 0, 48, 2, 'del', null);
                btn.x = 156;
            } else {
                btn = new UI.RightButton(def.label, 48, 'run', null, 256);
            }
            btn._def = def;
            btn.onPress = function() { self._fireButton(def); };
            self.buttons.push(btn);
        });

        // Shared selection marker + scrollbar (Settings style).
        this._pressedRow = -1;
        this.selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X, y: 0,
            width: SELECTOR_W_WITH_SCROLL, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
        this.scrollbar = new UI.Scrollbar(0, 1, 0);
    }

    ListScene.prototype._visible = function() {
        var avail = 144 - containerTop() - (this.buttons.length ? BUTTON_ROW_H : 0);
        // +1: the last visible row has no divider below it.
        return Math.max(1, Math.floor((avail + 1) / ROW_STEP));
    };

    // Unified item list: synthetic action rows (prepend) then data entries.
    ListScene.prototype._items = function() {
        var self = this, items = [];
        this.prepend.forEach(function(a) {
            items.push({ kind: 'action', label: a.label, icon: a.icon || null, run: a.run });
        });
        this.entries.forEach(function(e, i) {
            items.push({ kind: 'entry', label: self.rows[i],
                         icon: self.rowIcon ? self.rowIcon(e) : null,
                         detail: self.rowDetail ? (self.rowDetail(e) || '') : '',
                         entry: e });
        });
        return items;
    };

    ListScene.prototype.enter = function() {
        var self = this;
        // Repaint at ~10fps so the selected row's icon animates and a long
        // name marquee-scrolls smoothly (both time off Date.now()).
        if (this._animTimer) clearInterval(this._animTimer);
        this._animTimer = setInterval(function() {
            self._animFrame++;
            if (window.requestRender) window.requestRender();
        }, 100);
        this.loading = true; this.error = null;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', this.endpoint, true);
        xhr.timeout = 10000;
        function done() { self.loading = false; rr(); }
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.error) self.error = data.error;
                    self.entries = data[self.key] || [];
                    if (self.filter) self.entries = self.entries.filter(self.filter);
                    if (self.sort) self.entries = self.entries.slice().sort(self.sort);
                    self.rows = self.entries.map(self.formatRow);
                    var total = self.prepend.length + self.rows.length;
                    if (self.sel >= total) self.sel = Math.max(0, total - 1);
                    if (self.scroll > self.sel) self.scroll = 0;
                } catch (e) { self.error = 'Bad response'; }
            } else { self.error = 'HTTP ' + xhr.status; }
            done();
        };
        xhr.onerror   = function() { self.error = 'Network error'; done(); };
        xhr.ontimeout = function() { self.error = 'Timeout'; done(); };
        xhr.send();
    };
    ListScene.prototype.exit = function() {
        if (this._animTimer) { clearInterval(this._animTimer); this._animTimer = null; }
    };

    // Press-flash a button, then run its action.
    ListScene.prototype._fireButton = function(def) {
        // `noEntry` actions (e.g. Create) don't operate on a row, so
        // they fire even when the list is empty. Others need a data row
        // selected (a synthetic prepend row is not an entry).
        if (def.noEntry) { def.run(this, null); return; }
        var it = this._items()[this.sel];
        if (!it || it.kind !== 'entry') return;
        if (def.disabledFor && def.disabledFor(it.entry)) return;   // e.g. Delete on stock
        def.run(this, it.entry);
    };

    // POST helper shared by the destructive actions. Shows a busy
    // modal, then a result notice; `refresh` re-fetches on close.
    ListScene.prototype.postAction = function(url, body, busyText, refresh, onSuccess) {
        var self = this;
        this.dialog = { kind: 'busy', lines: [busyText] };
        rr();
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 30000;
        function show(ok, msg) {
            // Custom success handler (e.g. Restore -> offer a reboot) wins.
            if (ok && onSuccess) { onSuccess(msg); return; }
            self.dialog = {
                kind: 'notice',
                // Hide the internal @snapshots/ path prefix from result text.
                // Display cleanup: drop the internal @snapshots/ and
                // @stock-snapshots/ path prefixes, then the '@' subvol
                // marker from every name (profiles + snapshots).
                lines: [ok ? 'Done' : 'Error', String(msg)
                    .replace(/@snapshots\//g, '')
                    .replace(/@stock-snapshots\//g, '')
                    .replace(/@/g, '')],
                afterClose: refresh ? function() { self.enter(); } : null
            };
            rr();
        }
        xhr.onload = function() {
            try {
                var d = JSON.parse(xhr.responseText);
                show(!!d.ok, d.message || (d.ok ? 'OK' : 'Failed'));
            } catch (e) { show(false, 'Bad response'); }
        };
        xhr.onerror   = function() { show(false, 'Network error'); };
        xhr.ontimeout = function() { show(false, 'Timeout'); };
        xhr.send(JSON.stringify(body || {}));
    };

    ListScene.prototype.handleInput = function(action) {
        // Dialog captures all input first.
        if (this.dialog) {
            var d = this.dialog;
            if (d.kind === 'busy') return;
            if (d.kind === 'notice') {
                if (action === 'ok' || action === 'run' ||
                    action === 'back' || action === 'esc') {
                    var cb = d.afterClose; this.dialog = null;
                    if (cb) cb(); else rr();
                }
                return;
            }
            if (d.kind === 'confirm') {
                if (action === 'ok' || action === 'run') { var f = d.onYes; this.dialog = null; f(); }
                else if (action === 'back' || action === 'esc') { this.dialog = null; rr(); }
                return;
            }
            if (d.kind === 'menu') {
                if (action === 'up') { d.sel = (d.sel - 1 + d.options.length) % d.options.length; rr(); }
                else if (action === 'down') { d.sel = (d.sel + 1) % d.options.length; rr(); }
                else if (action === 'ok' || action === 'run') {
                    var opt = d.options[d.sel]; this.dialog = null;
                    if (opt && opt.run) opt.run(); else rr();
                }
                else if (action === 'back' || action === 'esc') { this.dialog = null; rr(); }
                return;
            }
            if (d.kind === 'days') {
                if (action === 'up') { d.days = Math.min(365, d.days + 1); rr(); }
                else if (action === 'down') { d.days = Math.max(1, d.days - 1); rr(); }
                else if (action === 'ok' || action === 'run') {
                    var od = d.onConfirm, dv = d.days; this.dialog = null;
                    if (od) od(dv); else rr();
                }
                else if (action === 'back' || action === 'esc') { this.dialog = null; rr(); }
                return;
            }
            return;
        }

        // 'back' (device Back key) leaves the list; 'esc' is the
        // LEFT soft button's action (handled in the button loop below),
        // so it must NOT pop here.
        if (action === 'back') return 'pop';

        // Soft buttons.
        for (var i = 0; i < this.buttons.length; i++) {
            var btn = this.buttons[i];
            if (action === btn.action) {
                var b = btn;
                b.press(); rr();
                setTimeout(function() { b.release(); rr(); }, 30);
                if (typeof b.onPress === 'function') b.onPress();
                return;
            }
        }

        // OK / Enter: 30ms press-flash on the selected row, then
        // activate it (action row or data entry) — matches SubMenuScene.
        if (action === 'ok') {
            var self2 = this, idx = this.sel;
            this._pressedRow = idx;
            rr();
            setTimeout(function() {
                self2._pressedRow = -1;
                var it = self2._items()[idx];
                if (it) {
                    if (it.kind === 'action' && typeof it.run === 'function') it.run(self2);
                    else if (it.kind === 'entry' && typeof self2.onSelect === 'function') self2.onSelect(self2, it.entry);
                }
                rr();
            }, 30);
            return;
        }

        // List navigation (over prepend + data rows).
        var n = this.prepend.length + this.rows.length;
        if (!n) return;
        if (action === 'down')    this.sel = (this.sel + 1) % n;
        else if (action === 'up') this.sel = (this.sel - 1 + n) % n;
        else return;
        var vis = this._visible();
        if (this.sel < this.scroll) this.scroll = this.sel;
        else if (this.sel >= this.scroll + vis) this.scroll = this.sel - vis + 1;
        rr();
    };

    // Persistent MenuLine pool. Rebuilt only when the item set changes
    // (label or detail), so each line keeps its animation / marquee clock
    // across renders and selection moves; width is refreshed every frame.
    ListScene.prototype._syncLines = function(items, lineW) {
        var key = items.map(function(it) {
            return it.label + '' + (it.detail || '');
        }).join('');
        if (this._linesKey !== key) {
            this._lines = items.map(function(it) { return makeLine(it, lineW); });
            this._linesKey = key;
        }
        for (var i = 0; i < this._lines.length; i++) this._lines[i].w = lineW;
        return this._lines;
    };

    ListScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        // Header matches the Settings submenu: empty status bar + a light-gray
        // breadcrumb ("> Profiles > @Desktop"), list starting 15px below.
        UI.drawStatusBar(canvas, '');
        var crumb = (this.sm && typeof this.sm.breadcrumb === 'function') ? this.sm.breadcrumb() : null;
        if (!crumb || !crumb.length) crumb = [this.title];
        HaxrCorp4090FlipCTL.draw(canvas.ctx, '> ' + crumb.join(' > '), 4, UI.STATUS_BAR_H + 2, '#CCCCCC');
        var items = this._items();
        var vis = this._visible();
        var hasScroll = items.length > vis;
        var selectorW = hasScroll ? SELECTOR_W_WITH_SCROLL : SELECTOR_W_NO_SCROLL;
        var lineW = selectorW + SELECTOR_X - CONTAINER_X;
        var top = containerTop();

        // Optional column header over the right-aligned detail column,
        // aligned to the MenuLine status edge and coloured like the crumb.
        if (this.detailHeader) {
            var dhw = HaxrCorp4090FlipCTL.textWidth(this.detailHeader);
            var dhx = CONTAINER_X + lineW - STATUS_PAD_R - dhw;
            HaxrCorp4090FlipCTL.draw(canvas.ctx, this.detailHeader, dhx, UI.STATUS_BAR_H + 2, '#CCCCCC');
        }

        if (this.error && !items.length) {
            var yE = top;
            wrapText(canvas, this.error, canvas.w - 8).slice(0, 6).forEach(function(l) {
                canvas.drawText(l, 4, yE, '#888'); yE += LIST_ITEM_H;
            });
        } else if (this.loading && !this.entries.length && !this.prepend.length) {
            drawSpinner(canvas, top, 144 - (this.buttons.length ? BUTTON_ROW_H : 0), this._animFrame);
        } else if (!items.length) {
            canvas.drawText('(none)', 4, top, '#888');
        } else {
            var lines = this._syncLines(items, lineW);
            var dividerX = SELECTOR_X + SELECTOR_CORNER_R;
            var dividerW = selectorW - 2 * SELECTOR_CORNER_R;
            var first = this.scroll;
            var last = Math.min(items.length, first + vis);
            var yy = top, selY = top, selPressed = false, haveSel = false;
            for (var i = first; i < last; i++) {
                var isSel = (i === this.sel);
                var isPressed = isSel && (this._pressedRow === i);
                var line = lines[i];
                line.state = isPressed ? MenuLine.STATE_PRESSED
                    : (isSel ? MenuLine.STATE_SELECTED : MenuLine.STATE_DEFAULT);
                if (isSel) { selY = yy; selPressed = isPressed; haveSel = true; }
                line.render(canvas, CONTAINER_X, yy);
                yy += ROW_H;
                if (i < last - 1) { canvas.drawHLine(dividerX, yy, dividerW, DIVIDER_COLOR); yy += 1; }
            }
            // Selection marker: rounded outline, filled black while pressed.
            if (haveSel) {
                this.selectorFrame.setPosition(SELECTOR_X, selY + SELECTOR_Y_OFFSET);
                this.selectorFrame.setSize(selectorW, SELECTOR_H);
                this.selectorFrame.setShowFill(selPressed);
                if (selPressed) this.selectorFrame.setFillColor('#000');
                this.selectorFrame.render(canvas);
                // Redraw the pressed row (already state PRESSED) over the
                // fill so its inverted text/icon read on the black backdrop.
                if (selPressed) lines[this.sel].render(canvas, CONTAINER_X, selY);
            }
            if (hasScroll) {
                var sbH = 144 - SCROLLBAR_Y - (this.buttons.length ? BUTTON_ROW_H : 2);
                this.scrollbar.update(items.length, vis, this.scroll);
                this.scrollbar.render(canvas, SCROLLBAR_X, SCROLLBAR_Y, sbH, 1);
            }
            if (this.loading && !this.entries.length) {
                drawSpinner(canvas, yy, 144 - (this.buttons.length ? BUTTON_ROW_H : 0), this._animFrame);
            }
        }

        // Soft buttons along the bottom (drawn even while empty so the
        // affordance is visible; actions no-op with nothing selected).
        var selItem = this._items()[this.sel];
        var selEntry = (selItem && selItem.kind === 'entry') ? selItem.entry : null;
        for (var b = 0; b < this.buttons.length; b++) {
            var bd = this.buttons[b]._def;
            this.buttons[b].disabled = !!(bd && bd.disabledFor && selEntry && bd.disabledFor(selEntry));
            this.buttons[b].render(canvas);
        }

        if (this.dialog) {
            if (this.dialog.kind === 'menu') {
                drawMenu(canvas, this.dialog);
            } else if (this.dialog.kind === 'days') {
                drawModal(canvas, ['Delete older',
                    'than ' + this.dialog.days + ' day' + (this.dialog.days === 1 ? '' : 's') + '?',
                    '(up / down to change)'], 'confirm', this._animFrame);
            } else {
                drawModal(canvas, this.dialog.lines, this.dialog.kind, this._animFrame);
            }
        }
    };

    // ── Button action definitions ────────────────────────────────
    // slot fixes the physical key: left → 'esc', middle → 'edit',
    // right → 'run'. `noEntry` actions don't need a selected row.
    var PROFILE_BUTTONS = [
        { label: 'Reboot', slot: 'edit', noEntry: true, run: function(scene) {
            scene.dialog = {
                kind: 'confirm',
                lines: ['Reboot the device?'],
                onYes: function() {
                    fetch('/api/system/reboot', { method: 'POST' });
                    scene.dialog = { kind: 'busy', lines: ['Rebooting...'] };
                    rr();
                }
            };
            rr();
        } },
        { label: 'Open', slot: 'right', disabledFor: function(e) { return isStock(e); }, run: function(scene, entry) {
            // Same as Enter: open the selected profile's snapshots.
            if (typeof scene.onSelect === 'function') scene.onSelect(scene, entry);
        } },
        { label: 'Clone', slot: 'middle', run: function(scene, entry) {
            // Clone the selected profile/base into a new writable profile via
            // create-profile <source> <dest>. Dest is the profile name (stock
            // suffix stripped) + '-copy'.
            var src = entry.fullName || entry.name;
            var dest = entry.name.replace(/_[0-9]+_stock$|_stock$/, '') + '-copy';
            scene.dialog = {
                kind: 'confirm',
                lines: ['Clone to', dispName(dest) + '?'],
                onYes: function() {
                    scene.postAction('/api/profiles/clone',
                        { source: src, dest: dest }, 'Cloning...', true);
                }
            };
            rr();
        } },
        { label: 'Delete', slot: 'left', disabledFor: function(e) { return isStock(e); }, run: function(scene, entry) {
            // A _stock profile is a golden factory-reset base — deleting
            // it is extra-destructive, so require a SECOND confirmation
            // (mirrors delete-profile's own tiered confirm).
            var isStock = entry.kind === 'stock' || /_stock$/.test(entry.name);
            function doDelete() {
                scene.postAction('/api/profiles/delete', { name: entry.name },
                    'Deleting...', true);
            }
            function secondConfirm() {
                scene.dialog = {
                    kind: 'confirm',
                    lines: [dispName(entry.name), 'is a _stock golden base',
                            '(factory-reset source).', 'Delete anyway?'],
                    onYes: doDelete
                };
                rr();
            }
            scene.dialog = {
                kind: 'confirm',
                lines: ['Delete profile', dispName(entry.name) + '?'],
                onYes: isStock ? secondConfirm : doDelete
            };
            rr();
        } }
    ];

    // Order left → right: Restore (left/esc), Delete (middle/edit),
    // Create (right/run).
    var SNAPSHOT_BUTTONS = [
        { label: 'Restore', slot: 'left', run: function(scene, entry) {
            scene.dialog = {
                kind: 'confirm',
                lines: ['Restore this snapshot?', entry.name,
                        '(takes effect after reboot)'],
                onYes: function() {
                    scene.postAction('/api/snapshots/restore', { name: entry.name },
                        'Restoring...', false);
                }
            };
            rr();
        } },
        { label: 'Delete', slot: 'middle', run: function(scene, entry) {
            scene.dialog = {
                kind: 'confirm',
                lines: ['Delete', entry.name + '?'],
                onYes: function() {
                    scene.postAction('/api/snapshots/delete', { name: entry.name },
                        'Deleting...', true);
                }
            };
            rr();
        } },
        { label: 'Create', slot: 'right', noEntry: true, run: function(scene) {
            scene.dialog = {
                kind: 'confirm',
                lines: ['Create snapshot of the booted root?'],
                onYes: function() {
                    scene.postAction('/api/snapshots/create', {}, 'Creating...', true);
                }
            };
            rr();
        } }
    ];

    // ── Menu factory ─────────────────────────────────────────────
    function makeMenu(sceneManager) {
        return new SubMenuScene(sceneManager, 'FlipperOS',
            ['Profiles', 'Snapshots'],
            {
                'Profiles': function() {
                    return new ListScene('Profiles', '/api/profiles', 'profiles',
                        function(p) {
                            return p.name + (p.booted ? ' *' : '') +
                                   (p.kind ? '  [' + p.kind + ']' : '');
                        }, PROFILE_BUTTONS);
                },
                'Snapshots': function() {
                    return new ListScene('Snapshots', '/api/snapshots', 'snapshots',
                        function(s) { return s.name; }, SNAPSHOT_BUTTONS);
                }
            });
    }

    // FlipperOS root entry: the Profiles list directly, with a 'Profiles:'
    // header + reused sdcard icon (no intermediate Profiles/Snapshots menu).
    // Pick a reused icon per profile by its name/type.
    function profileIcon(p) {
        if (typeof Icons === 'undefined') return null;
        var n = ((p && p.name) || '').toLowerCase();
        if (n.indexOf('desktop') >= 0) return Icons.desktop;
        if (n.indexOf('minimal') >= 0) return Icons.minimal;
        if (n.indexOf('media') >= 0 || n.indexOf('tv') >= 0) return Icons.media;
        if (n.indexOf('router') >= 0) return Icons.router;
        return Icons.sdcard;   // generic btrfs root
    }
    function isStock(p) {
        return (p && p.kind === 'stock') || /_stock$/.test((p && p.name) || '');
    }

    // Display form of a profile name: drop the leading '@' subvol marker.
    // The real '@name' is kept for API calls; this is display-only.
    function dispName(n) { return String(n || '').replace(/^@/, ''); }

    function makeProfiles(sceneManager) {
        return new ListScene('Profiles', '/api/profiles', 'profiles',
            function(p) {
                return dispName(p.name) + (p.booted ? ' *' : '');
            },
            PROFILE_BUTTONS,
            {
                sceneManager: sceneManager,
                rowIcon: profileIcon,
                // LAST USED column; drop the century (2026 -> 26) and seconds.
                rowDetail: function(p) {
                    return (p.lastUsed || '')
                        .replace(/^20(\d\d-)/, '$1')
                        .replace(/(\d\d:\d\d):\d\d$/, '$1');
                },
                detailHeader: 'Last used',
                rowH: 16,
                // Order: booted first, then used profiles by last-used time
                // (most recent first), then never-used, then _stock bases.
                sort: function(a, b) {
                    function used(p) { return /^\d{4}-\d\d-\d\d/.test(p.lastUsed || ''); }
                    function rank(p) {
                        if (p.booted) return 0;
                        if (isStock(p)) return 3;
                        return used(p) ? 1 : 2;
                    }
                    var ra = rank(a), rb = rank(b);
                    if (ra !== rb) return ra - rb;
                    if (ra === 1) return (b.lastUsed || '').localeCompare(a.lastUsed || '');
                    return 0;
                },
                // OK opens the snapshots menu scoped to this profile.
                onSelect: function(scene, p) {
                    // Stock golden bases have no per-profile snapshots view.
                    if (isStock(p)) return;
                    if (scene.sm) scene.sm.push(makeProfileSnapshots(scene.sm, p));
                }
            });
    }

    // Snapshots menu for a single profile: a 'Save' action first, then that
    // profile's snapshots. Restore/Delete soft buttons act on the selection.
    function makeProfileSnapshots(sceneManager, profile) {
        var pname = profile.name;                    // e.g. @Desktop
        var prefix = '@snapshots/' + pname + '_';    // snapshots for this profile
        // Animated 14px filesystem icon for snapshot rows.
        var icon = (typeof AnimatedIcons !== 'undefined' && AnimatedIcons.files_animated)
            ? AnimatedIcons.files_animated
            : ((typeof Icons !== 'undefined') ? Icons.sdcard : null);
        var shortName = function(s) {
            return s.name.indexOf(prefix) === 0 ? s.name.slice(prefix.length) : s.name;
        };

        // Save works for any profile: create-snapshot -p @X snapshots the
        // selected root even when it isn't the booted one.
        var prepend = [{
            label: 'Save',
            icon: (typeof Icons !== 'undefined') ? Icons.sdcard : null,
            run: function(sc) {
                sc.dialog = {
                    kind: 'confirm',
                    lines: ['Save ', dispName(pname) + '?'],
                    onYes: function() {
                        sc.postAction('/api/snapshots/create', { profile: pname }, 'Saving...', true);
                    }
                };
                rr();
            }
        }];

        // Shared Delete / Restore actions used by BOTH the soft buttons and
        // the Enter popup. Restore offers a reboot afterwards.
        function doDelete(sc, entry) {
            sc.dialog = {
                kind: 'confirm',
                lines: ['Delete', shortName(entry) + '?'],
                onYes: function() {
                    sc.postAction('/api/snapshots/delete', { name: entry.name }, 'Deleting...', true);
                }
            };
            rr();
        }
        function doRestore(sc, entry) {
            sc.dialog = {
                kind: 'confirm',
                lines: ['Restore ' + dispName(pname) + ' from', shortName(entry) + '?',
                        '(takes effect after reboot)'],
                onYes: function() {
                    sc.postAction('/api/snapshots/restore', { name: entry.name, dest: pname },
                        'Restoring...', false, function() {
                        // Applied on next boot -> offer to reboot now.
                        sc.dialog = {
                            kind: 'confirm',
                            lines: ['Restored.', 'Reboot now to apply?'],
                            onYes: function() {
                                fetch('/api/system/reboot', { method: 'POST' });
                                sc.dialog = { kind: 'busy', lines: ['Rebooting...'] };
                                rr();
                            }
                        };
                        rr();
                    });
                }
            };
            rr();
        }

        // Soft buttons: Delete (left) / Del Old (X) / Restore (right).
        var buttons = [
            { label: 'Delete', slot: 'left', run: doDelete },
            { label: 'Del Old', slot: 'edit', noEntry: true, run: function(sc) {
                sc.dialog = {
                    kind: 'days', days: 7,
                    onConfirm: function(days) {
                        sc.postAction('/api/snapshots/delete-old',
                            { profile: pname, days: days }, 'Deleting...', true);
                    }
                };
                rr();
            } },
            { label: 'Restore', slot: 'right', run: doRestore }
        ];

        return new ListScene(dispName(pname), '/api/snapshots', 'snapshots', shortName,
            buttons,
            {
                sceneManager: sceneManager,
                headerLabel: 'Snapshots:',
                headerIcon: icon,
                rowIcon: function() { return icon; },
                rowH: 16,
                filter: function(s) { return s.name.indexOf(prefix) === 0; },
                // Latest first (created is 'YYYY-MM-DD HH-MM-SS', sorts lexically).
                sort: function(a, b) { return (b.created || '').localeCompare(a.created || ''); },
                prepend: prepend,
                // Enter also opens a Restore/Delete popup (same actions).
                onSelect: function(sc, entry) {
                    sc.dialog = {
                        kind: 'menu',
                        title: shortName(entry),
                        sel: 0,
                        options: [
                            { label: 'Restore', icon: (typeof Icons !== 'undefined') ? Icons.arrow_left_11px : null,
                              run: function() { doRestore(sc, entry); } },
                            { label: 'Delete', icon: (typeof Icons !== 'undefined') ? Icons.kill_app : null,
                              run: function() { doDelete(sc, entry); } }
                        ]
                    };
                    rr();
                }
            });
    }

    return { makeMenu: makeMenu, makeProfiles: makeProfiles };
})();
