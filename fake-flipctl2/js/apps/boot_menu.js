/**
 * BootMenuScene
 *
 * Main-menu "Boot Menu": a titled header with a full-width auto-start
 * progress bar (inverts the header text as it fills), a scrollable list of
 * bootable profiles (from list-profiles) with icons and a "Used <when>"
 * column, a rounded selector, and Info / Edit soft buttons over the X / V
 * keys. Rows use HaxrCorp so the label keeps one baseline in every state.
 *
 * Any key press cancels the auto-start countdown (bar empties and stops,
 * countdown text hides). Selecting/booting is not wired yet.
 */
var BootMenuScene = (function() {
    var CONTAINER_X    = 5;      // icon lands at x = 8
    var HEADER_H       = 18;     // title bar height
    var CONTAINER_Y    = 20;     // first row top (below the header)
    var DIVIDER_COLOR  = '#CCCCCC';

    var SELECTOR_X             = 4;
    var SELECTOR_W_WITH_SCROLL = 244;
    var SELECTOR_W_NO_SCROLL   = 247;
    var SELECTOR_H             = 16;
    var SELECTOR_CORNER_R      = 3;
    var SELECTOR_Y_OFFSET      = 0;   // 16px frame on the 16px row

    var SCROLLBAR_X         = 253;
    var SCROLLBAR_THUMB_PAD  = 1;

    var VISIBLE_COUNT = 6;
    var ICON_BOX_W    = 12;   // fixed icon column so labels line up
    var ROW_H         = 16;   // row height (tighter than MenuLine.H = 20)
    var TIMEOUT_MS    = 5000; // auto-start countdown before loading the default

    function ic(name) { return (typeof Icons !== 'undefined') ? Icons[name] : null; }

    // Display name of a profile: drop the leading '@' subvol marker.
    function dispName(n) { return String(n || '').replace(/^@/, ''); }

    // Boot-menu icon for a profile, chosen by its name.
    function bootIcon(name) {
        var n = (name || '').toLowerCase();
        if (n.indexOf('minimal') >= 0)  return ic('minimal_small');
        if (n.indexOf('graphics') >= 0) return ic('no_graphics_boot_menu');
        if (n.indexOf('desktop') >= 0)  return ic('small_desktop');
        if (n.indexOf('router') >= 0)   return ic('router_small');
        if (n.indexOf('media') >= 0 || n.indexOf('tv') >= 0) return ic('media_small');
        return ic('flipper_os');
    }

    // "Used <when>" relative time (mockup style: singular units). Sentinels:
    // '' / 'never' -> blank, 'now' (the booted profile) -> "Running".
    function usedAgo(lu) {
        lu = lu || '';
        if (lu === '' || lu === 'never') return '';
        if (lu === 'now') return 'Running';
        var t = Date.parse(lu.replace(' ', 'T'));
        if (isNaN(t)) return lu;
        var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
        function u(n, w) { return 'Used ' + n + ' ' + w + (n === 1 ? '' : 's') + ' ago'; }
        if (s < 60) return 'Used just now';
        var m = Math.floor(s / 60);  if (m < 60) return u(m, 'min');
        var h = Math.floor(m / 60);  if (h < 24) return u(h, 'hour');
        var d = Math.floor(h / 24);  if (d < 30) return u(d, 'day');
        var mo = Math.floor(d / 30); if (mo < 12) return u(mo, 'month');
        return u(Math.floor(d / 365), 'year');
    }

    // Larger (14px) icon for the Edit popup header.
    function headerIcon(name) {
        var n = (name || '').toLowerCase();
        if (n.indexOf('graphics') >= 0) return ic('no_graphics_boot_menu');
        if (n.indexOf('minimal') >= 0) return ic('minimal');
        if (n.indexOf('desktop') >= 0) return ic('desktop');
        if (n.indexOf('router') >= 0)  return ic('router');
        if (n.indexOf('media') >= 0 || n.indexOf('tv') >= 0) return ic('media');
        return ic('flipper_os');
    }

    function BootMenuScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Boot Menu';
        this.breadcrumbTitle = 'Boot Menu';

        // Entries loaded from list-profiles on enter().
        this.items         = [];
        this.loading       = true;
        this.selectedIndex = 0;      // default: the first line (auto-start target)
        this.scrollOffset  = 0;
        this._autoStart    = true;   // countdown active until a key press
        this._startAt      = 0;      // countdown start (ms); set in enter()
        this._timer        = null;

        this.selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X, y: 0, width: SELECTOR_W_WITH_SCROLL, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top', strokeColor: '#000', showStroke: true, showFill: false
        });
        this.scrollbar = new UI.Scrollbar(0, VISIBLE_COUNT, 0);

        // Soft buttons over their physical keys: Info over X ('edit' slot,
        // x=50), Edit over V ('middle' slot, x=156).
        this.infoBtn = new UI.MiddleButton('Info', 0, 48, 2, 'edit', function() {});
        this.infoBtn.x = 50;  this.infoBtn.w = 48;
        this.editBtn = new UI.MiddleButton('Edit', 0, 48, 2, 'del', function() {});
        this.editBtn.x = 156; this.editBtn.w = 48;

        // Edit popup: profile actions for the selected entry. Same selector
        // frame style as the menu rows.
        this._editSelector = new MenuSelectorFrame({
            x: 0, y: 0, width: 10, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top', strokeColor: '#000', showStroke: true, showFill: false
        });
        this._profiles    = [];
        this._editOpen    = false;
        this._editIndex   = 0;
        this._editOptions = ['Rename', 'Clone', 'Delete'];
    }

    BootMenuScene.prototype.enter = function() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        this._autoStart = true;   // will start once the profiles arrive
        this._startAt = 0;
        this._fetchProfiles();
    };
    BootMenuScene.prototype.exit = function() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    };

    // Start the auto-start countdown + progress bar. Called only after the
    // profiles have loaded, so the bar never moves against an empty list.
    BootMenuScene.prototype._startCountdown = function() {
        var self = this;
        if (this._timer) clearInterval(this._timer);
        this._startAt = Date.now();
        this._timer = setInterval(function() {
            if (!self._autoStart) { clearInterval(self._timer); self._timer = null; return; }
            if (window.requestRender) window.requestRender();
            if (Date.now() - self._startAt >= TIMEOUT_MS) {
                clearInterval(self._timer);
                self._timer = null;
            }
        }, 100);
    };

    BootMenuScene.prototype._fetchProfiles = function() {
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/boot/profiles', true);
        xhr.timeout = 10000;
        function done(list) { self._setProfiles(list || []); }
        xhr.onload = function() {
            var list = [];
            if (xhr.status === 200) {
                try { list = JSON.parse(xhr.responseText).profiles || []; } catch (e) {}
            }
            done(list);
        };
        xhr.onerror   = function() { done([]); };
        xhr.ontimeout = function() { done([]); };
        xhr.send();
    };

    BootMenuScene.prototype._setProfiles = function(list) {
        this._profiles = list;
        this.items = list.map(function(p) {
            return new MenuLine({ text: dispName(p.name), width: 224, icon: bootIcon(p.name),
                                  status: usedAgo(p.lastUsed) || null, iconBoxW: ICON_BOX_W,
                                  // single font in every state -> no baseline
                                  // shift when the row becomes selected. Text
                                  // lowered to sit against the icon bottom.
                                  font: HaxrCorp4090FlipCTL, activeLabelYNudge: 0,
                                  labelYOffset: 0, rowHeight: ROW_H });
        });
        this.loading = false;
        this.selectedIndex = 0;
        this.scrollOffset = 0;
        if (this.items.length) this.items[0].state = MenuLine.STATE_SELECTED;
        // Begin the auto-start countdown now that the data is in, unless a key
        // press already cancelled it while loading.
        if (this._autoStart) this._startCountdown();
        if (window.requestRender) window.requestRender();
    };

    BootMenuScene.prototype._ensureVisible = function() {
        if (this.selectedIndex < this.scrollOffset) {
            this.scrollOffset = this.selectedIndex;
        } else if (this.selectedIndex >= this.scrollOffset + VISIBLE_COUNT) {
            this.scrollOffset = this.selectedIndex - VISIBLE_COUNT + 1;
        }
    };

    BootMenuScene.prototype._flash = function(btn) {
        btn.press();
        if (window.requestRender) window.requestRender();
        setTimeout(function() {
            btn.release();
            if (window.requestRender) window.requestRender();
        }, 30);
        if (typeof btn.onPress === 'function') btn.onPress();
    };

    // Any key cancels auto-start: bar resets to empty and stops, text hides.
    BootMenuScene.prototype._cancelAutoStart = function() {
        if (!this._autoStart) return;
        this._autoStart = false;
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        if (window.requestRender) window.requestRender();
    };

    BootMenuScene.prototype._openEdit = function() {
        if (!this.items.length) return;
        this._cancelAutoStart();
        this._editOpen = true;
        this._editIndex = 0;
        if (window.requestRender) window.requestRender();
    };

    // Input while the Edit popup is open (captures everything).
    BootMenuScene.prototype._editInput = function(action) {
        var opts = this._editOptions;
        if (action === 'up')        { this._editIndex = (this._editIndex - 1 + opts.length) % opts.length; }
        else if (action === 'down') { this._editIndex = (this._editIndex + 1) % opts.length; }
        else if (action === 'back' || action === 'esc') { this._editOpen = false; }
        else if (action === 'ok' || action === 'run')   { this._editOpen = false; }   // mockup: select closes
        else return;
        if (window.requestRender) window.requestRender();
    };

    BootMenuScene.prototype.handleInput = function(action) {
        if (this._editOpen) { this._editInput(action); return; }

        this._cancelAutoStart();   // any key cancels the auto-start countdown

        if (action === 'back') return 'pop';

        // X key -> Info; V key -> Edit (opens the popup).
        if (action === 'edit') { this._flash(this.infoBtn); return; }
        if (action === 'del')  { this._flash(this.editBtn); this._openEdit(); return; }

        var n = this.items.length;
        if (!n) return;
        if (action === 'down' || action === 'up') {
            this.items[this.selectedIndex].state = MenuLine.STATE_DEFAULT;
            this.selectedIndex = (action === 'down')
                ? (this.selectedIndex + 1) % n
                : (this.selectedIndex - 1 + n) % n;
            this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;
            this._ensureVisible();
            if (window.requestRender) window.requestRender();
        } else if (action === 'ok') {
            var line = this.items[this.selectedIndex];
            line.state = MenuLine.STATE_PRESSED;
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                line.state = MenuLine.STATE_SELECTED;
                if (window.requestRender) window.requestRender();
            }, 120);
        }
    };

    BootMenuScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        canvas.clear('#fff');

        // Grey header background (the progress bar's black fill sweeps over it).
        canvas.drawRect(0, 0, canvas.w, HEADER_H, '#D9D9D9');

        // Header: full-width auto-start progress bar. A black fill sweeps
        // left->right over TIMEOUT_MS while counting; the header text inverts
        // to white over the fill. Once a key cancels it, the bar is empty and
        // the countdown text is gone. The "Boot Menu" title is always shown
        // (the only non-HaxrCorp text).
        // The bar/countdown only exist once the countdown has actually started
        // (after the profiles loaded) and until a key cancels it.
        var started = this._autoStart && this._startAt > 0;
        var elapsed = started ? Math.min(TIMEOUT_MS, Date.now() - this._startAt) : 0;
        var fillW   = started ? Math.round(canvas.w * (elapsed / TIMEOUT_MS)) : 0;

        var title  = 'Boot Menu';
        var titleX = Math.floor((canvas.w - Born2bSportyV2FlipCTL.textWidth(title)) / 2);
        var auto = '', autoX = 0;
        if (started) {
            var remaining = Math.max(0, Math.ceil((TIMEOUT_MS - elapsed) / 1000));
            auto  = 'Auto start in ' + remaining + 's...';
            autoX = canvas.w - 4 - HaxrCorp4090FlipCTL.textWidth(auto);
        }
        var drawHeader = function(titleColor, autoColor) {
            Born2bSportyV2FlipCTL.draw(ctx, title, titleX, 3, titleColor);
            if (auto) HaxrCorp4090FlipCTL.draw(ctx, auto, autoX, 4, autoColor);
        };
        drawHeader('#000000', '#999999');                 // base, on white
        if (fillW > 0) {
            canvas.drawRect(0, 0, fillW, HEADER_H, '#000');   // progress fill
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, fillW, HEADER_H);
            ctx.clip();
            drawHeader('#ffffff', '#ffffff');              // inverted over the fill
            ctx.restore();
        }

        if (!this.items.length) {
            var msg = this.loading ? 'Loading...' : '(no profiles)';
            HaxrCorp4090FlipCTL.draw(ctx, msg, 8, CONTAINER_Y + 5, '#888888');
        } else {
            var total     = this.items.length;
            var hasScroll = total > VISIBLE_COUNT;
            var selectorW = hasScroll ? SELECTOR_W_WITH_SCROLL : SELECTOR_W_NO_SCROLL;
            var dividerX  = SELECTOR_X + SELECTOR_CORNER_R;
            var dividerW  = selectorW - 2 * SELECTOR_CORNER_R;
            var lineW     = selectorW + SELECTOR_X - CONTAINER_X;
            for (var k = 0; k < this.items.length; k++) this.items[k].w = lineW;

            var first = this.scrollOffset;
            var last  = Math.min(total, first + VISIBLE_COUNT);
            var y = CONTAINER_Y, selY = CONTAINER_Y;
            for (var i = first; i < last; i++) {
                if (i === this.selectedIndex) selY = y;
                this.items[i].render(canvas, CONTAINER_X, y);
                y += ROW_H;
                if (i < last - 1) y += 1;   // 1px row spacing, no divider line
            }

            var pressed = this.items[this.selectedIndex].state === MenuLine.STATE_PRESSED;
            this.selectorFrame.setPosition(SELECTOR_X, selY + SELECTOR_Y_OFFSET);
            this.selectorFrame.setSize(selectorW, SELECTOR_H);
            this.selectorFrame.setShowFill(pressed);
            if (pressed) this.selectorFrame.setFillColor('#000');
            this.selectorFrame.render(canvas);
            if (pressed) this.items[this.selectedIndex].render(canvas, CONTAINER_X, selY);

            this.scrollbar.update(total, VISIBLE_COUNT, this.scrollOffset);
            if (this.scrollbar.shouldShow()) {
                this.scrollbar.render(canvas, SCROLLBAR_X, CONTAINER_Y, 144 - CONTAINER_Y - 16, SCROLLBAR_THUMB_PAD);
            }
        }

        // Soft buttons (dimmed while the Edit popup is open).
        this.infoBtn.disabled = this._editOpen;
        this.editBtn.disabled = this._editOpen;
        this.infoBtn.render(canvas);
        this.editBtn.render(canvas);

        if (this._editOpen) this._renderEditPopup(canvas);
    };

    // Edit popup: profile header (icon + name + size) over a grey band, then
    // the actions (Rename / Clone / Delete), the selected one framed.
    BootMenuScene.prototype._renderEditPopup = function(canvas) {
        var ctx = canvas.ctx;
        var p = this._profiles[this.selectedIndex] || {};
        var name = dispName(p.name || '') + ' profile';

        var fx = 6, fy = 14, fw = 244, fh = 116, HDR = 38;

        new ResponsiveFrame({
            x: fx, y: fy, width: fw, height: fh, anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, fillColor: '#fff', showFill: true, cornerRadius: 5
        }).render(canvas);

        // Grey header band with icon + bold name + size.
        canvas.drawRect(fx + 2, fy + 2, fw - 4, HDR - 2, '#D9D9D9');
        var hicon = headerIcon(p.name);
        var nameX = fx + 8;
        if (hicon) {
            // Grayscale icons use drawSprite; binary ones (desktop/minimal/
            // router) use drawIcon's row-per-element format.
            if (hicon.grayscale) canvas.drawSprite(hicon, fx + 8, fy + 6, '#000');
            else canvas.drawIcon(hicon, fx + 8, fy + 6, '#000');
            nameX = fx + 8 + hicon.w + 4;
        }
        Born2bSportyV2FlipCTL.draw(ctx, name, nameX, fy + 6, '#000');
        var size = 'Size: ' + (p.size || '20 GB');
        var sw = HaxrCorp4090FlipCTL.textWidth(size);
        HaxrCorp4090FlipCTL.draw(ctx, size, fx + Math.floor((fw - sw) / 2), fy + 24, '#666666');

        // Actions, centred; the selected one in a rounded frame.
        var oy = fy + HDR + 5, rowH = 16;
        for (var i = 0; i < this._editOptions.length; i++) {
            var label = this._editOptions[i];
            var rowY = oy + i * rowH;
            if (i === this._editIndex) {
                this._editSelector.setPosition(fx + 10, rowY);
                this._editSelector.setSize(fw - 20, rowH);
                this._editSelector.render(canvas);
            }
            var lw = HaxrCorp4090FlipCTL.textWidth(label);
            HaxrCorp4090FlipCTL.draw(ctx, label, fx + Math.floor((fw - lw) / 2), rowY + 3, '#000');
        }
    };

    return BootMenuScene;
})();
