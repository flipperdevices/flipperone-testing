/**
 * BootMenuScene
 *
 * Main-menu "Boot Menu" entry. Same content as the Boot menu UI
 * demo (the U-BOOT header + the five boot profiles, with their
 * icons), but rendered in the project's standard menu style —
 * MenuLine rows (Born2bSportyV2Medium when selected, BusyFont9
 * otherwise) under a MenuSelectorFrame, like the Network / Apps /
 * Testing submenus. No app-defined buttons.
 *
 * Up/down moves the selection (wraps); OK gives a press flash;
 * Back / Esc returns to the main menu.
 */
var BootMenuScene = (function() {
    // Geometry mirrors SubMenuScene's standard menu chrome.
    var CONTAINER_X   = 5;     // icon lands at x = 8
    var CONTAINER_W   = 224;
    var HEADER_Y      = 5;     // U-BOOT header baseline
    var CONTAINER_Y   = 20;    // first row top (below the header)
    var DIVIDER_COLOR = '#CCCCCC';

    var SELECTOR_X             = 4;
    var SELECTOR_W_WITH_SCROLL = 244;
    var SELECTOR_W_NO_SCROLL   = 247;
    var SELECTOR_H             = 22;
    var SELECTOR_CORNER_R      = 3;
    var SELECTOR_Y_OFFSET      = -1;

    var SCROLLBAR_X         = 253;
    var SCROLLBAR_THUMB_PAD = 1;

    // Rows that fit between the header and the bottom edge.
    var VISIBLE_COUNT = 5;

    // Maps each profile to the systemd target its extlinux entry
    // boots (parsed from the `append … systemd.unit=` line). The
    // profile whose target equals the DEFAULT entry's target gets
    // the "default" tag. A label with no systemd.unit override
    // boots the normal graphical/KDE default → 'default'.
    var PROFILE_TARGET = {
        'TV Media Box':     'tv-media-box.target',
        'Minimal system':   'multi-user.target',
        'Desktop Computer': 'default'
    };

    // systemd target each profile switches to NOW on OK
    // (`systemctl isolate`). Note Desktop runs graphical.target,
    // unlike its extlinux "no systemd.unit" default above.
    var ISOLATE_TARGET = {
        'TV Media Box':     'tv-media-box.target',
        'Desktop Computer': 'graphical.target',
        'Minimal system':   'multi-user.target'
    };

    // Profiles whose availability is verified against the live systemd
    // target list (GET /api/boot/targets) rather than assumed: each is
    // shown active only when its target is present, and dimmed 'N/A'
    // otherwise. (Profile name → target to look for.) The other rows
    // are static placeholders ('TBA'), unaffected by this check.
    var DYNAMIC_PROFILE_TARGET = {
        'TV Media Box':     'tv-media-box.target',
        'Desktop Computer': 'graphical.target'
    };

    function BootMenuScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Boot Menu';
        this.breadcrumbTitle = 'Boot Menu';

        var names = [
            'Router',
            'TV Media Box',
            'Desktop Computer',
            'Minimal system',
            'Boot from SD card'
        ];
        var iconMap = {
            'Router':            Icons.router,
            'TV Media Box':       Icons.media,
            'Desktop Computer':   Icons.desktop,
            'Minimal system':     Icons.minimal,
            'Boot from SD card':  Icons.sdcard
        };
        // Profiles that aren't wired yet: rendered at 50% opacity
        // with a "TBA" status and skipped by the selector.
        var inactiveSet = {
            'Router':            true,
            'Minimal system':     true,
            'Boot from SD card':  true
        };

        this.items = [];
        for (var i = 0; i < names.length; i++) {
            var nm        = names[i];
            var isStatic  = !!inactiveSet[nm];             // permanent placeholder
            var isDynamic = !!DYNAMIC_PROFILE_TARGET[nm];  // target-gated profile
            // Status while inactive: static placeholders are 'TBA'
            // (planned); the target-gated profiles use 'N/A' (target
            // not present / not yet verified).
            var inactiveStatus = isStatic ? 'TBA' : 'N/A';
            // Target-gated profiles START inactive — grayed exactly like
            // the placeholders — and are promoted to active by
            // _applyTargets ONLY once their systemd target is confirmed
            // present. So a profile is never shown active until verified.
            var startInactive = isStatic || isDynamic;
            var line = new MenuLine({
                text:  nm,
                width: CONTAINER_W,
                icon:  iconMap[nm] || null,
                status: startInactive ? inactiveStatus : null
            });
            line._inactive       = startInactive;
            line._inactiveStatus = inactiveStatus;
            this.items.push(line);
        }
        // Initial selection: the first target-gated profile. It starts
        // grayed and is promoted once its target is confirmed; if it
        // turns out unavailable, _applyTargets hops the selection to the
        // next active row. Falls back to row 0.
        this.selectedIndex = 0;
        for (var s = 0; s < this.items.length; s++) {
            if (DYNAMIC_PROFILE_TARGET[this.items[s].text]) { this.selectedIndex = s; break; }
        }
        this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;
        this.scrollOffset = 0;
        this.containerY   = CONTAINER_Y;

        this.selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X, y: 0,
            width: SELECTOR_W_WITH_SCROLL, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
        this.scrollbar = new UI.Scrollbar(this.items.length, VISIBLE_COUNT, this.scrollOffset);

        // Edit button on the V slot (x = 156, 'del' action). A
        // toggle button — its 2 px bar lights up while the modal
        // is open. Opens a small centred modal with one option.
        var self = this;
        this._editBtn = new UI.MiddleToggleButton('Edit', 0, 48, 2, 'del',
            function() { self._openEdit(); }, false);
        this._editBtn.x = 156;
        this._editOpen  = false;
        this._editItems = ['Select as default'];
        this._editIndex = 0;
        this._editSelectorFrame = new MenuSelectorFrame({
            x: 0, y: 0, width: 1, height: 1,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });

        // "Starting…" spinner modal shown while a selected profile's
        // target is being isolated, until it reaches 'active'.
        this._spinnerOpen   = false;
        this._spinnerTarget = null;
        this._spinnerTimer  = null;
        this._spinnerTick   = 0;
    }

    BootMenuScene.prototype.enter = function() {
        // Gate the target-backed profiles against the live target list
        // first, then re-fetch the extlinux default (so the "Default"
        // tag lands on a row whose active/inactive state is settled).
        this._fetchTargets();
    };
    BootMenuScene.prototype.exit  = function() {
        if (this._spinnerTimer) {
            clearInterval(this._spinnerTimer);
            this._spinnerTimer = null;
        }
    };

    // GET the live systemd target list and gate the target-backed
    // profiles on it, then (always) re-fetch the extlinux default.
    // Runs the default re-fetch even on error so an unreachable /
    // mocked endpoint still tags the default off the optimistic state.
    BootMenuScene.prototype._fetchTargets = function() {
        var self = this;
        var done = function() { self._refetchDefault(); };
        try {
            var x = new XMLHttpRequest();
            x.open('GET', '/api/boot/targets', true);
            x.timeout = 3000;
            x.onload = function() {
                if (x.status === 200) {
                    try {
                        var d = JSON.parse(x.responseText);
                        self._applyTargets(d.targets || []);
                    } catch (e) {}
                }
                done();
            };
            x.onerror   = done;
            x.ontimeout = done;
            x.send();
        } catch (e) { done(); }
    };

    // Mark each target-gated profile active/inactive by whether its
    // target appears in the live list. Absent → dimmed 'N/A' and
    // skipped by the selector; present → active (default tag applied
    // afterwards). If the current selection lands on a row that just
    // went inactive, move it to the next selectable one.
    BootMenuScene.prototype._applyTargets = function(targets) {
        var present = {};
        for (var t = 0; t < targets.length; t++) present[targets[t]] = true;
        for (var i = 0; i < this.items.length; i++) {
            var tgt = DYNAMIC_PROFILE_TARGET[this.items[i].text];
            if (!tgt) continue;   // static placeholder — leave as-is
            var avail = !!present[tgt];
            this.items[i]._inactive = !avail;
            this.items[i].status = avail
                ? (this.items[i]._isDefault ? 'Default' : null)
                : this.items[i]._inactiveStatus;   // 'N/A'
        }
        // Selection may now sit on a freshly-inactive row — hop off it.
        if (this.items[this.selectedIndex] && this.items[this.selectedIndex]._inactive) {
            this.items[this.selectedIndex].state = MenuLine.STATE_DEFAULT;
            this.selectedIndex = this._nextSelectable(this.selectedIndex, 1);
            this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;
            this._ensureVisible();
        }
        if (window.requestRender) window.requestRender();
    };

    // GET the extlinux DEFAULT and re-tag the matching profile.
    BootMenuScene.prototype._refetchDefault = function() {
        var self = this;
        try {
            var x = new XMLHttpRequest();
            x.open('GET', '/api/boot/default', true);
            x.timeout = 3000;
            x.onload = function() {
                if (x.status !== 200) return;
                try { self._applyDefault(JSON.parse(x.responseText)); } catch (e) {}
            };
            x.send();
        } catch (e) { /* offline / mocked — ignore */ }
    };

    // Move the "Default" tag to whichever profile matches the
    // DEFAULT entry's systemd target. Clears any previous tag
    // first (restoring "TBA" on inactive rows) so it tracks
    // changes made via Select as default.
    BootMenuScene.prototype._applyDefault = function(data) {
        var tgt = data && data.defaultTarget;
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i]._isDefault) {
                this.items[i]._isDefault = false;
                this.items[i].status = this.items[i]._inactive
                    ? (this.items[i]._inactiveStatus || 'TBA')
                    : null;
            }
        }
        if (tgt) {
            for (var j = 0; j < this.items.length; j++) {
                if (PROFILE_TARGET[this.items[j].text] === tgt) {
                    this.items[j].status     = 'Default';
                    this.items[j]._isDefault = true;
                }
            }
        }
        if (window.requestRender) window.requestRender();
    };

    BootMenuScene.prototype._openEdit = function() {
        this._editOpen  = true;
        this._editIndex = 0;
        if (window.requestRender) window.requestRender();
    };

    // Switch the running system to the profile's target now
    // (`systemctl isolate`) and show the "Starting…" spinner until
    // that target reports active. Fire-and-forget POST — isolating
    // may tear down this UI's session, which is the intended mode
    // switch; if the UI survives, the spinner closes on active.
    BootMenuScene.prototype._isolate = function(name) {
        var tgt = ISOLATE_TARGET[name];
        if (!tgt) return;
        try {
            var x = new XMLHttpRequest();
            x.open('POST', '/api/boot/isolate', true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.timeout = 5000;
            x.send(JSON.stringify({ target: tgt }));
        } catch (e) { /* offline / mocked — ignore */ }
        this._startSpinner(tgt);
    };

    BootMenuScene.prototype._startSpinner = function(tgt) {
        var self = this;
        this._spinnerOpen   = true;
        this._spinnerTarget = tgt;
        this._spinnerTick   = 0;
        if (this._spinnerTimer) clearInterval(this._spinnerTimer);
        // 80 ms ticks: repaint every tick (the spinner animates off
        // Date.now()), poll the target every ~6th tick (~0.5 s).
        this._spinnerTimer = setInterval(function() {
            if (window.requestRender) window.requestRender();
            self._spinnerTick++;
            if (self._spinnerTick % 6 === 0) self._checkTargetActive();
        }, 80);
        setTimeout(function() { self._checkTargetActive(); }, 400);
    };

    BootMenuScene.prototype._checkTargetActive = function() {
        if (!this._spinnerOpen) return;
        var self = this;
        try {
            var x = new XMLHttpRequest();
            x.open('GET', '/api/boot/target-active?target='
                + encodeURIComponent(this._spinnerTarget), true);
            x.timeout = 3000;
            x.onload = function() {
                if (x.status !== 200) return;
                try {
                    var d = JSON.parse(x.responseText);
                    if (d.active) self._stopSpinner();
                } catch (e) {}
            };
            x.send();
        } catch (e) {}
    };

    BootMenuScene.prototype._stopSpinner = function() {
        if (this._spinnerTimer) {
            clearInterval(this._spinnerTimer);
            this._spinnerTimer = null;
        }
        this._spinnerOpen = false;
        if (window.requestRender) window.requestRender();
    };

    // "Select as default" — set the currently-selected profile as
    // the boot default (POST its systemd target), then re-fetch
    // to move the "Default" tag.
    BootMenuScene.prototype._selectAsDefault = function() {
        var name = this.items[this.selectedIndex].text;
        var tgt  = PROFILE_TARGET[name];
        if (!tgt) return;
        var self = this;
        try {
            var x = new XMLHttpRequest();
            x.open('POST', '/api/boot/default', true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.timeout = 3000;
            x.onload = function() { self._refetchDefault(); };
            x.send(JSON.stringify({ target: tgt }));
        } catch (e) { /* offline / mocked — ignore */ }
    };

    BootMenuScene.prototype._ensureVisible = function() {
        if (this.selectedIndex < this.scrollOffset) {
            this.scrollOffset = this.selectedIndex;
        } else if (this.selectedIndex >= this.scrollOffset + VISIBLE_COUNT) {
            this.scrollOffset = this.selectedIndex - VISIBLE_COUNT + 1;
        }
    };

    // Next selectable (active) index from `from` in `dir` (+1/-1),
    // wrapping and skipping inactive rows. Returns `from` if no
    // other active row exists.
    BootMenuScene.prototype._nextSelectable = function(from, dir) {
        var n = this.items.length;
        var i = from;
        for (var step = 0; step < n; step++) {
            i = (i + dir + n) % n;
            if (!this.items[i]._inactive) return i;
        }
        return from;
    };

    BootMenuScene.prototype.handleInput = function(action) {
        // While the "Starting…" spinner is up, swallow input. Esc /
        // Back hides the spinner (the isolate has already fired;
        // this just dismisses the overlay).
        if (this._spinnerOpen) {
            if (action === 'back' || action === 'esc') this._stopSpinner();
            return;
        }

        // Edit modal owns input while open.
        if (this._editOpen) {
            var en = this._editItems.length;
            if (action === 'up') {
                this._editIndex = (this._editIndex - 1 + en) % en;
            } else if (action === 'esc' || action === 'back' || action === 'del') {
                // Esc / Back, or a second press of Edit (V), closes it.
                this._editOpen = false;
            } else if (action === 'down') {
                this._editIndex = (this._editIndex + 1) % en;
            } else if (action === 'ok' || action === 'run') {
                // Only option for now: Select as default. No-op if
                // the selected profile is already the default (the
                // option is shown inert / gray in that case).
                this._editOpen = false;
                if (!this.items[this.selectedIndex]._isDefault) {
                    this._selectAsDefault();
                }
            }
            if (window.requestRender) window.requestRender();
            return;
        }

        if (action === 'back' || action === 'esc') return 'pop';

        // V (Edit) opens the edit modal for the selected profile.
        if (action === 'del') {
            var eb = this._editBtn;
            eb.press();
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                eb.release();
                if (window.requestRender) window.requestRender();
            }, 30);
            this._openEdit();
            return;
        }

        if (action === 'down' || action === 'up') {
            var next = this._nextSelectable(this.selectedIndex, action === 'down' ? 1 : -1);
            if (next !== this.selectedIndex) {
                this.items[this.selectedIndex].state = MenuLine.STATE_DEFAULT;
                this.selectedIndex = next;
                this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;
                this._ensureVisible();
                if (window.requestRender) window.requestRender();
            }
        } else if (action === 'ok' || action === 'run') {
            var self = this;
            var line = this.items[this.selectedIndex];
            line.state = MenuLine.STATE_PRESSED;
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                line.state = MenuLine.STATE_SELECTED;
                if (window.requestRender) window.requestRender();
            }, 30);
            // Switch the running system to the selected profile.
            this._isolate(line.text);
        }
    };

    BootMenuScene.prototype.render = function(canvas) {
        canvas.clear('#fff');

        // U-BOOT header (centred), kept from the demo.
        var headerText  = 'FlipperOS Boot profiles | U-BOOT';
        var headerWidth = HaxrcorpFont16.textWidth(headerText);
        HaxrcorpFont16.draw(canvas.ctx, headerText,
            Math.floor((canvas.w - headerWidth) / 2), HEADER_Y, '#000');

        // Selector width tracks scrollbar visibility; divider
        // matches the selector's straight edge (width − 2×radius).
        var total     = this.items.length;
        var hasScroll = total > VISIBLE_COUNT;
        var selectorW = hasScroll ? SELECTOR_W_WITH_SCROLL : SELECTOR_W_NO_SCROLL;
        var dividerX  = SELECTOR_X + SELECTOR_CORNER_R;
        var dividerW  = selectorW - 2 * SELECTOR_CORNER_R;

        // MenuLine `w` = its status right-align reference; extend so
        // the right edge lands on the selector's right edge.
        var lineW = selectorW + SELECTOR_X - CONTAINER_X;
        for (var k = 0; k < this.items.length; k++) this.items[k].w = lineW;

        var first = this.scrollOffset;
        var last  = Math.min(total, first + VISIBLE_COUNT);
        var y = this.containerY;
        var selectedLineY = this.containerY;
        for (var i = first; i < last; i++) {
            if (i === this.selectedIndex) selectedLineY = y;
            // Inactive rows render at 50% opacity (text, icon and
            // the "TBA" status all dim together). The divider below
            // stays full strength.
            if (this.items[i]._inactive) {
                canvas.ctx.globalAlpha = 0.5;
                this.items[i].render(canvas, CONTAINER_X, y);
                canvas.ctx.globalAlpha = 1.0;
            } else {
                this.items[i].render(canvas, CONTAINER_X, y);
            }
            y += MenuLine.H;
            if (i < last - 1) {
                canvas.drawHLine(dividerX, y, dividerW, DIVIDER_COLOR);
                y += 1;
            }
        }

        // Selector frame: filled while PRESSED, outline otherwise.
        var pressed = this.items[this.selectedIndex].state === MenuLine.STATE_PRESSED;
        this.selectorFrame.setPosition(SELECTOR_X, selectedLineY + SELECTOR_Y_OFFSET);
        this.selectorFrame.setSize(selectorW, SELECTOR_H);
        this.selectorFrame.setShowFill(pressed);
        if (pressed) this.selectorFrame.setFillColor('#000');
        this.selectorFrame.render(canvas);
        if (pressed) {
            this.items[this.selectedIndex].render(canvas, CONTAINER_X, selectedLineY);
        }

        // Scrollbar (only when the list overflows the viewport).
        this.scrollbar.update(total, VISIBLE_COUNT, this.scrollOffset);
        if (this.scrollbar.shouldShow()) {
            this.scrollbar.render(canvas, SCROLLBAR_X, this.containerY,
                canvas.h - this.containerY, SCROLLBAR_THUMB_PAD);
        }

        // Edit button (V slot) — its toggle bar tracks the modal.
        if (this._editBtn) this._editBtn.toggled = this._editOpen;
        if (this._editBtn) this._editBtn.render(canvas);

        // Edit modal on top of everything. The Edit button is
        // re-drawn over the wash so it stays crisp with its
        // toggled bar showing (same as the Power-menu buttons).
        if (this._editOpen) {
            this._renderEditModal(canvas);
            if (this._editBtn) this._editBtn.render(canvas);
        }

        // "Starting…" spinner modal — above everything.
        if (this._spinnerOpen) this._renderSpinnerModal(canvas);
    };

    // Centred "Starting…" modal: a label over an animated spinner,
    // under a wash. Shown while a profile's target is isolating.
    BootMenuScene.prototype._renderSpinnerModal = function(canvas) {
        var ctx   = canvas.ctx;
        var label = 'Starting';
        var sp    = AnimatedIcons.spinner_22x20px;
        var spFrameH = Math.floor(sp.h / sp.frames);

        var PAD = 12, GAP = 8, TEXT_H = 9;
        var tw   = HaxrcorpFont16.textWidth(label);
        var boxW = Math.max(tw, sp.w) + PAD * 2;
        var boxH = PAD + TEXT_H + GAP + spFrameH + PAD;
        var boxX = Math.floor((canvas.w - boxW) / 2);
        var boxY = Math.floor((canvas.h - boxH) / 2);

        // Dim the background.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        // Box.
        new ResponsiveFrame({
            x: boxX, y: boxY, width: boxW, height: boxH,
            anchorH: 'left', anchorV: 'top',
            fillColor: '#fff', strokeColor: '#000',
            showFill: true, showStroke: true, cornerRadius: 5
        }).render(canvas);

        // Label (centred).
        HaxrcorpFont16.draw(ctx, label,
            boxX + Math.floor((boxW - tw) / 2), boxY + PAD, '#000');

        // Spinner (centred) below the label, frame off wall-clock.
        var spFrame = Math.floor(Date.now() / 80) % sp.frames;
        var spX = boxX + Math.floor((boxW - sp.w) / 2);
        var spY = boxY + PAD + TEXT_H + GAP;
        canvas.drawSpriteFrame(sp, spX, spY, spFrame, '#000');
    };

    // Centred modal launched by Edit — same styling as the Power-
    // menu demo's modal: HaxrcorpFont16 rows, 7 px bottom / 6 px
    // top gap, 9 px between lines, and a fixed-width selector
    // (3 px in from each side, 14 px tall, centred on the text).
    var MODAL_SEL_H   = 14;
    var MODAL_GAP     = 9;
    var MODAL_TOP_GAP = 6;
    var MODAL_BOT_GAP = 7;
    var MODAL_VIS_TOP = 1;   // HaxrcorpFont16 visible glyph starts 1 px below draw-y
    var MODAL_VIS_H   = 9;   // ~9 px tall

    BootMenuScene.prototype._renderEditModal = function(canvas) {
        var ctx = canvas.ctx;
        // When the selected profile is already the boot default the
        // option is inert: "Selected as default" in gray, no
        // selector frame. Otherwise it's actionable: "Select as
        // default" in black, with the selector.
        var isDef = !!this.items[this.selectedIndex]._isDefault;
        var label = isDef ? 'Selected as default' : 'Select as default';
        var color = isDef ? '#AAAAAA' : '#000';

        var maxW   = HaxrcorpFont16.textWidth(label);
        var modalW = maxW + 21;   // 10 px left / 11 px right of the text
        var modalH = MODAL_TOP_GAP + MODAL_BOT_GAP + MODAL_VIS_H;
        var modalX = Math.floor((canvas.w - modalW) / 2);
        var modalY = Math.floor((canvas.h - modalH) / 2);

        // Dim the background.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        // Box — white fill, black rounded border.
        new ResponsiveFrame({
            x: modalX, y: modalY, width: modalW, height: modalH,
            anchorH: 'left', anchorV: 'top',
            fillColor: '#fff', strokeColor: '#000',
            showFill: true, showStroke: true, cornerRadius: 5
        }).render(canvas);

        var drawY = modalY + MODAL_TOP_GAP - MODAL_VIS_TOP;
        var tw = HaxrcorpFont16.textWidth(label);
        var tx = modalX + Math.floor((modalW - tw) / 2);
        // Selector only when the option is actionable.
        if (!isDef) {
            var visCenter = drawY + MODAL_VIS_TOP + MODAL_VIS_H / 2;
            var selY      = Math.round(visCenter - MODAL_SEL_H / 2);
            this._editSelectorFrame.setPosition(modalX + 3, selY);
            this._editSelectorFrame.setSize(modalW - 7, MODAL_SEL_H);
            this._editSelectorFrame.render(canvas);
        }
        HaxrcorpFont16.draw(ctx, label, tx, drawY, color);
    };

    return BootMenuScene;
})();
