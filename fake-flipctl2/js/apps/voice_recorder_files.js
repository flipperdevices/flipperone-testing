/**
 * Voice recorder — Files browser scene.
 *
 * Pushed onto the scene stack when the user hits the "Files"
 * button from the recorder's main page. Replaces the standard
 * breadcrumb header with the recordings folder name, and below
 * that lists every recording in that folder as a MenuLine row
 * (filename on the left, duration on the right).
 *
 * Back: pop back to the recorder.
 * OK:   placeholder (no playback yet) — future hook for
 *       per-file actions (play, rename, delete).
 */
var VoiceRecorderFilesScene = (function() {

    // Layout — adapted from SubMenuScene. Same MenuLine height,
    // same selector geometry, same scrollbar column. Only
    // difference is the header: a gray title bar instead of a
    // "> Title" breadcrumb, matching how the parent
    // VoiceRecorderScene chrome reads.
    var TITLE_FILL    = '#D9D9D9';
    var TITLE_H       = 16;
    var ICON_X        = 2;
    var TITLE_TEXT_X  = 18;
    var TITLE_TEXT_DY = 1;

    var CONTAINER_X   = 5;
    var CONTAINER_W   = 224;
    var DIVIDER_COLOR = '#CCCCCC';

    // 4 visible rows — leaves headroom above the bottom button
    // strip. At MenuLine.H = 20 + 1 px divider, four rows take
    // 83 px; with the title bar (32 px) and button strip
    // (14 px) the canvas (144 px) has 15 px of breathing room.
    var VISIBLE_COUNT = 4;

    var SELECTOR_X = 4;
    var SELECTOR_W_WITH_SCROLL = 244;
    var SELECTOR_W_NO_SCROLL   = 247;
    var SELECTOR_H = 22;
    var SELECTOR_CORNER_R = 3;
    var SELECTOR_Y_OFFSET = -1;

    // Scrollbar geometry — matches the column SubMenuScene uses
    // so it visually lines up with the main menu's scrollbar.
    // The body spans from just below the title bar down to just
    // above the bottom button strip.
    var SCROLLBAR_X         = 253;
    // Breadcrumb row sits between the gray app-title bar and the
    // list. Mirrors SubMenuScene's `> Title` pattern in
    // HaxrcorpFont16 gray — a thin contextual subtitle that
    // tells the user which folder they're inside without
    // shoving the folder name into the app-name slot.
    var BREADCRUMB_X        = 4;
    var BREADCRUMB_Y        = UI.STATUS_BAR_H + TITLE_H + 1;              // 30
    var BREADCRUMB_HEIGHT   = 11;
    var BREADCRUMB_GAP      = 2;
    // Total vertical area taken by [breadcrumb text] + [gap before list].
    var LIST_TOP_PAD        = BREADCRUMB_HEIGHT + BREADCRUMB_GAP;         // 13
    var SCROLLBAR_Y         = UI.STATUS_BAR_H + TITLE_H + LIST_TOP_PAD;   // 42
    var SCROLLBAR_H         = 144 - 14 - SCROLLBAR_Y - 1;                  // 87 (canvas.h - btn strip - 1)
    var SCROLLBAR_THUMB_PAD = 1;

    function VoiceRecorderFilesScene(sceneManager, folderName) {
        this.sceneManager    = sceneManager || null;
        this.folderName      = folderName || 'voice_recordings';
        // The gray title bar shows the APP NAME (matches the
        // parent VoiceRecorderScene), not the folder — the
        // folder is what the inline breadcrumb row says.
        this.displayName     = 'Voice recorder';
        // breadcrumbTitle is what SceneManager.breadcrumb()
        // contributes to any cross-scene breadcrumb trail. The
        // folder name is the right entry there — that's the
        // "level" we're at inside the recorder app.
        this.breadcrumbTitle = this.folderName;
        // Use the parent voice-recorder icon for the title bar
        // until a dedicated folder icon lands. Same 14×14 sprite
        // means the title row's geometry is unchanged.
        this.icon            = (typeof Icons !== 'undefined' && Icons.voice_recorder)
                                ? Icons.voice_recorder
                                : null;

        this.items          = [];   // array of MenuLine instances
        this.selectedIndex  = 0;
        this.scrollOffset   = 0;
        this.containerY     = UI.STATUS_BAR_H + TITLE_H + LIST_TOP_PAD;
        // Full filesystem path to the folder, populated from
        // /api/record/list. Until the fetch lands the breadcrumb
        // falls back to just the folder name so the row never
        // reads as blank.
        this.folderPath     = null;

        // Cached payload from /api/record/list, keyed by name so
        // the OK handler can look up the original metadata if
        // needed without re-fetching.
        this.fileMeta = {};

        this.selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X, y: 0,
            width: SELECTOR_W_WITH_SCROLL, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
        this.scrollbar = null;   // built once we have item count

        // Bottom button strip — Home | Record | _ | Edit | Play.
        // Slots match the recorder's layout (slot 1 for Record
        // mirrors Files' slot, slot 3 for Edit mirrors Pause's
        // manually-placed x = 156). Edit and Play don't have
        // real behaviour yet — both pop the shared info modal
        // for now.
        var self = this;
        this._homeBtn = new UI.LeftButton('Home', 48, 'esc',
            function() {
                if (self.sceneManager
                        && typeof self.sceneManager.popToRoot === 'function') {
                    self.sceneManager.popToRoot();
                }
            });
        // Close — visible only while the player overlay is up.
        // Replaces Home in the leftmost slot when the player is
        // open and dismisses the player on press. Same 'esc'
        // action key so the existing input handler routes to
        // _closePlayer without extra plumbing.
        this._closeBtn = new UI.LeftButton('Close', 48, 'esc',
            function() { self._closePlayer(); });
        this._recordBtn = new UI.MiddleButton('Record', 1, 48, 2, 'edit',
            function() {
                if (self.sceneManager
                        && typeof self.sceneManager.pop === 'function') {
                    self.sceneManager.pop();
                }
            });
        this._editBtn = new UI.MiddleButton('Edit', 0, 48, 2, 'del',
            function() { self._openEditModal(); });
        // Pause sat at x = 156 in the recorder layout; place Edit
        // at the same x so the slot-3 button reads as the same
        // position across scenes.
        this._editBtn.x = 156;
        this._playBtn = new UI.RightButton('Play', 48, 'run',
            function() {
                // Open the player overlay on the currently-
                // focused file. The overlay layers on top of
                // the file list — when it closes the list is
                // already there, no scene transition needed.
                var picked = self.items[self.selectedIndex];
                if (!picked || !picked.text) return;
                var meta = (self.fileMeta && self.fileMeta[picked.text]) || {};
                self._openPlayer(picked.text, meta.durationMs || 0);
            },
            256);

        // Info modal — same shape the recorder uses for the
        // Folder row's "File manager: TBA" stub. Single title,
        // single OK button.
        this._infoModal = { open: false, title: '' };
        // Delete-confirmation modal. Opens when the user picks
        // Delete in the Edit modal. Two stacked buttons —
        // Cancel (index 0, safe default) and Delete (index 1,
        // destructive) — mirroring the keyboard's "Discard
        // changes?" chrome. `filename` holds the take that's
        // queued for deletion so the destructive button knows
        // what to POST.
        this._deleteModal = {
            open:        false,
            filename:    null,
            buttonIndex: 0
        };
        // Reused selector outline inside the delete modal's
        // button stack. Built once; setPosition / setSize fire
        // per render against the highlighted button.
        this._deleteBtnSelector = new MenuSelectorFrame({
            x: 0, y: 0, width: 1, height: 1,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });

        // Player overlay state. The player paints ON TOP of the
        // file list (the list still shows through behind the
        // wash), and owns input the whole time it's open. The
        // server is the source of truth for `positionMs` /
        // `playing` / `paused`; this client polls
        // /api/record/play/status to stay in sync.
        this._player = {
            open:       false,
            filename:   '',
            positionMs: 0,
            durationMs: 0,
            playing:    false,
            paused:     false,
            // Transient feedback for seek presses. Holds the
            // direction string ('+10' or '-10') while the seek
            // flash is visible, then clears via _seekFlashTimer.
            seekFlash:  null,
            // Speaker volume 0..100. Overwritten by /api/sound/
            // volume on player open; up / down on the player
            // overlay adjusts it in steps of 10.
            volume:     50
        };
        this._playerStatusTimer = null;
        this._seekFlashTimer    = null;
        // Active long-press seek cycle (set by left/right
        // handler when a hold starts, cleared when the key is
        // released or the player closes).
        this._seekHold          = null;

        // Edit modal — single-view popup invoked from the Edit
        // button. Three rows: Sort (dropdown-style — value
        // cycles inline via left/right, OK opens a dropdown
        // popover with the full options list), Rename, Delete.
        // `_sortMode` is the applied sort key (null = leave the
        // server's newest-first order untouched).
        this._editModal = { open: false, selectedIndex: 0 };
        // Sort dropdown popover that opens from the Edit modal's
        // Sort row. Owns input while open, layered ON TOP of
        // the Edit modal. Mirror of the recorder's Format
        // dropdown overlay — see VoiceRecorderScene._renderDropdown.
        this._sortPopup = { open: false, selectedIndex: 0 };
        this._sortMode  = null;
        // Selector frame inside the edit modal (used by both
        // views). Built once and reused per render with
        // setPosition / setSize.
        this._modalSelectorFrame = new MenuSelectorFrame({
            x: 0, y: 0, width: 1, height: 1,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
    }

    // Main-view rows in the Edit modal. `id` drives the OK
    // handler; `label` is what the user sees. Order = order
    // shown in the modal — Rename / Delete sit above Sort so
    // the action buttons (the things the user usually wants)
    // are reachable first.
    var EDIT_MAIN_ITEMS = [
        { id: 'rename', label: 'Rename' },
        { id: 'delete', label: 'Delete' },
        { id: 'sort',   label: 'Sort' }
    ];

    // Sort options shown inside the Sort dropdown popover.
    // `id` drives the comparator in `_applySort`; `label` is
    // what the user sees. Short labels keep the chip tight
    // and the popover body narrow.
    var SORT_OPTIONS = [
        { id: 'name-asc',      label: 'A-Z' },
        { id: 'name-desc',     label: 'Z-A' },
        { id: 'duration-desc', label: 'Longest' },
        { id: 'duration-asc',  label: 'Shortest' }
    ];

    // Look up the user-visible label for an applied sort mode.
    // Used to render the Sort row's inline value. Falls back to
    // the first option's label when nothing is applied yet, so
    // the row never reads as blank.
    function _sortLabel(mode) {
        for (var i = 0; i < SORT_OPTIONS.length; i++) {
            if (SORT_OPTIONS[i].id === mode) return SORT_OPTIONS[i].label;
        }
        return SORT_OPTIONS[0].label;
    }

    // Index in SORT_OPTIONS of the currently-applied mode, or 0
    // if nothing's applied. Used by the cycle logic so the next
    // step is always relative to the live value.
    function _sortIndex(mode) {
        for (var i = 0; i < SORT_OPTIONS.length; i++) {
            if (SORT_OPTIONS[i].id === mode) return i;
        }
        return 0;
    }


    // Info modal helpers (mirrors VoiceRecorderScene's pair —
    // small enough that copying it here beats threading a
    // shared component through the constructor).
    VoiceRecorderFilesScene.prototype._openInfoModal = function(title) {
        this._infoModal.open  = true;
        this._infoModal.title = String(title || '');
        if (typeof window.requestRender === 'function') {
            window.requestRender();
        }
    };
    VoiceRecorderFilesScene.prototype._handleInfoModalInput = function(action) {
        if (action === 'ok' || action === 'run'
                || action === 'back' || action === 'esc') {
            this._infoModal.open = false;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
        }
    };
    VoiceRecorderFilesScene.prototype._renderInfoModal = function(canvas) {
        var ctx = canvas.ctx;
        var W = 150, H = 50;
        var X = Math.floor((canvas.w - W) / 2);
        var Y = Math.floor((canvas.h - H) / 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        new ResponsiveFrame({
            x: X, y: Y, width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true,
            fillColor:   '#fff', showFill:   true,
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        var titleStr = this._infoModal.title || '';
        var tw = Born2bSportyV2Medium.textWidth(titleStr);
        Born2bSportyV2Medium.draw(ctx, titleStr,
            X + Math.floor((W - tw) / 2), Y + 8, '#000');
        // OK button — single, always focused.
        var BTN_H  = 14;
        var BTN_W  = W - 16;
        var BTN_X  = X + Math.floor((W - BTN_W) / 2);
        var btnY   = Y + H - BTN_H - 6;
        ctx.fillStyle = '#000';
        ctx.fillRect(BTN_X, btnY, BTN_W, BTN_H);
        var okStr = 'OK';
        var okW = HaxrcorpFont16.textWidth(okStr);
        HaxrcorpFont16.draw(ctx, okStr,
            BTN_X + Math.floor((BTN_W - okW) / 2),
            btnY + Math.floor((BTN_H - 11) / 2), '#fff');
    };

    // Layout constants shared by both Edit modal and Sort
    // popover — keeps the two visually consistent.
    var MODAL_TITLE_H = 14;     // Born2bSportyV2 cap area
    var MODAL_OPT_H   = 14;     // each row height
    var MODAL_PAD     = 4;      // vertical padding inside modal
    var MODAL_SIDE    = 8;      // horizontal padding inside modal body
    var MODAL_SEL_PAD = 5;      // padding between selector frame and modal edge
                                // (gap between chip's right edge and selector's
                                // right edge = MODAL_SIDE - MODAL_SEL_PAD = 3 px)
    var ROW_LABEL_GAP = 2;      // gap between row label and chip

    // Shared layout calc — both `_renderEditModal` and
    // `_renderSortPopup` need to know where the Sort chip lands
    // on screen (the popover anchors to the chip). Centralised
    // here so the two views agree.
    function _computeEditLayout(canvas) {
        // Chip width is content-driven: longest sort-option
        // label + 15 px padding on each side. Keeps the chip
        // visually tight to its values instead of the recorder's
        // fixed 180 px (which would leave a lot of empty room
        // for our short sort labels).
        var CHIP_VALUE_PAD = 15;
        var longestOptW = 0;
        for (var li = 0; li < SORT_OPTIONS.length; li++) {
            var lw = HaxrcorpFont16.textWidth(SORT_OPTIONS[li].label);
            if (lw > longestOptW) longestOptW = lw;
        }
        var CHIP_W = longestOptW + CHIP_VALUE_PAD * 2;
        var CHIP_H = MenuDropdownLine.CHIP_HEIGHT;
        var sortLabelW = HaxrcorpFont16.textWidth('Sort');
        // Modal width hosts the longest row. The Sort row is
        // widest: label + gap + chip + side paddings.
        var rowMaxW = MODAL_SIDE + sortLabelW + ROW_LABEL_GAP + CHIP_W + MODAL_SIDE;
        // Title contest in case it ever ends up wider than the row.
        var titleW  = Born2bSportyV2Medium.textWidth('Edit');
        var W = Math.max(rowMaxW, titleW + MODAL_SIDE * 2);
        var H = MODAL_PAD + MODAL_TITLE_H
              + EDIT_MAIN_ITEMS.length * MODAL_OPT_H + MODAL_PAD;
        var X = Math.floor((canvas.w - W) / 2);
        var Y = Math.floor((canvas.h - H) / 2);
        var optsTop = Y + MODAL_PAD + MODAL_TITLE_H;
        // The chip lives on whichever row carries `id: 'sort'`
        // — look that up so the chip Y stays correct when the
        // row order changes (Rename / Delete above Sort in the
        // current layout).
        var sortIdx = 0;
        for (var ei = 0; ei < EDIT_MAIN_ITEMS.length; ei++) {
            if (EDIT_MAIN_ITEMS[ei].id === 'sort') { sortIdx = ei; break; }
        }
        var sortRowY = optsTop + sortIdx * MODAL_OPT_H;
        var chipX    = X + W - MODAL_SIDE - CHIP_W;
        var chipY    = sortRowY + Math.floor((MODAL_OPT_H - CHIP_H) / 2);
        return {
            CHIP_W: CHIP_W, CHIP_H: CHIP_H,
            X: X, Y: Y, W: W, H: H,
            optsTop: optsTop,
            sortRowY: sortRowY,
            chipX: chipX, chipY: chipY
        };
    }

    // ── Delete-confirmation modal ───────────────────────────
    // Same chrome as TextInputScreen's "Discard changes?"
    // modal: white frame with black stroke on a translucent
    // wash, Born2bSportyV2 title, HaxrcorpFont16 detail line
    // below, two stacked buttons. Cancel is the safe default
    // (buttonIndex 0); Delete is the destructive option
    // (buttonIndex 1). Up / down toggles between them; OK
    // commits; Back / Esc cancels.
    VoiceRecorderFilesScene.prototype._openDeleteModal = function(filename) {
        this._deleteModal.open        = true;
        this._deleteModal.filename    = filename;
        this._deleteModal.buttonIndex = 0;     // Cancel
        if (typeof window.requestRender === 'function') {
            window.requestRender();
        }
    };
    VoiceRecorderFilesScene.prototype._handleDeleteModalInput = function(action) {
        var m = this._deleteModal;
        if (action === 'up' || action === 'down') {
            m.buttonIndex = (m.buttonIndex === 0) ? 1 : 0;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        if (action === 'ok' || action === 'run') {
            if (m.buttonIndex === 1) {
                var fname = m.filename;
                m.open = false;
                this._postDelete(fname);
            } else {
                m.open = false;
            }
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        if (action === 'back' || action === 'esc') {
            m.open = false;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
    };
    VoiceRecorderFilesScene.prototype._renderDeleteModal = function(canvas) {
        var ctx = canvas.ctx;
        var m   = this._deleteModal;
        var fname = m.filename || '';
        // Auto-size width to fit the filename + side padding,
        // floored at the same 150 px the discard modal uses so
        // short names don't get a comically narrow modal.
        var SIDE   = 15;
        var titleW = Born2bSportyV2Medium.textWidth('Delete');
        var fnW    = HaxrcorpFont16.textWidth(fname);
        var contentW = Math.max(titleW, fnW);
        var W = Math.max(150, contentW + SIDE * 2);
        // Height: title (14) + filename row (14) + 2 buttons of
        // 14 px each + a 6 px gap above the buttons + 6 px
        // top / bottom padding.
        var TITLE_H = 14;
        var FN_H    = 14;
        var BTN_H   = 14;
        var BTN_GAP = 2;
        var TOP_PAD = 6;
        var BOT_PAD = 6;
        var H = TOP_PAD + TITLE_H + FN_H + BTN_H + BTN_GAP + BTN_H + BOT_PAD;
        var X = Math.floor((canvas.w - W) / 2);
        var Y = Math.floor((canvas.h - H) / 2);
        // Wash everything else out.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        // Modal body.
        new ResponsiveFrame({
            x: X, y: Y, width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true,
            fillColor:   '#fff', showFill:   true,
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        // Title "Delete" — Born2bSportyV2Medium, centred.
        Born2bSportyV2Medium.draw(ctx, 'Delete',
            X + Math.floor((W - titleW) / 2), Y + TOP_PAD, '#000');
        // Filename — HaxrcorpFont16 dim gray, centred on the
        // next line. Long names will overflow the 150-px floor
        // case; W auto-grows above, so in practice the row
        // always fits without truncation.
        var fnY = Y + TOP_PAD + TITLE_H;
        HaxrcorpFont16.draw(ctx, fname,
            X + Math.floor((W - fnW) / 2), fnY + 2, '#666');
        // Stacked buttons — Cancel on top (safe default),
        // Delete below.
        var BTN_W = W - 16;
        var BTN_X = X + Math.floor((W - BTN_W) / 2);
        var btn1Y = fnY + FN_H;
        var btn2Y = btn1Y + BTN_H + BTN_GAP;
        this._drawDeleteBtn(canvas, BTN_X, btn1Y, BTN_W, BTN_H,
            'Cancel', m.buttonIndex === 0);
        this._drawDeleteBtn(canvas, BTN_X, btn2Y, BTN_W, BTN_H,
            'Delete', m.buttonIndex === 1);
    };
    // Render one button in the delete modal's stack. Centred
    // label; selector outline drawn only when this button is
    // the highlighted one (same idiom the discard modal uses).
    VoiceRecorderFilesScene.prototype._drawDeleteBtn = function(canvas, x, y, w, h, label, selected) {
        var ctx = canvas.ctx;
        var lw  = HaxrcorpFont16.textWidth(label);
        var labelY = y + Math.floor((h - 11) / 2);
        HaxrcorpFont16.draw(ctx, label,
            x + Math.floor((w - lw) / 2), labelY, '#000');
        if (selected) {
            this._deleteBtnSelector.setPosition(x, y);
            this._deleteBtnSelector.setSize(w, h);
            this._deleteBtnSelector.render(canvas);
        }
    };
    // POST /api/record/delete { file } and refresh the list.
    // The endpoint is idempotent — a 404 just means the file's
    // already gone, which is also a valid post-state for us.
    VoiceRecorderFilesScene.prototype._postDelete = function(filename) {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/delete', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 2500;
            xhr.onload = function() {
                self._fetchListAndSelect(null);
            };
            xhr.onerror   = function() { self._fetchListAndSelect(null); };
            xhr.ontimeout = function() { self._fetchListAndSelect(null); };
            xhr.send(JSON.stringify({ file: filename }));
        } catch (e) { /* offline — leave list as-is */ }
    };

    // ── Player overlay ──────────────────────────────────────
    // Paints a 238 × 48 player rectangle on top of the file
    // list (the list is still rendered underneath, dimmed by a
    // white wash). All playback state — position, paused,
    // duration — comes from the server via /api/record/play/
    // status, polled at 4 Hz while the overlay is open. The
    // overlay owns input the whole time it's visible.

    // Format helper — used by both progress-bar labels.
    function _fmtPlayerTime(ms) {
        if (!isFinite(ms) || ms < 0) ms = 0;
        var s  = Math.floor(ms / 1000);
        var mm = Math.floor(s / 60);
        var ss = s % 60;
        return mm + ':' + (ss < 10 ? '0' + ss : ss);
    }
    // Hand-rolled play / pause glyphs — HaxrcorpFont16 doesn't
    // carry ▶ / ‖, so we draw them ourselves with fillRect.
    function _drawPlayIcon(ctx, x, y, h, color) {
        ctx.fillStyle = color || '#000';
        for (var r = 0; r < h; r++) {
            var dist = Math.abs(r - Math.floor((h - 1) / 2));
            var w    = Math.floor(h / 2) - dist + 1;
            ctx.fillRect(x, y + r, w, 1);
        }
    }
    function _drawPauseIcon(ctx, x, y, h, color) {
        ctx.fillStyle = color || '#000';
        ctx.fillRect(x,     y, 2, h);
        ctx.fillRect(x + 3, y, 2, h);
    }

    VoiceRecorderFilesScene.prototype._openPlayer = function(filename, durationMs) {
        var self = this;
        this._player.open       = true;
        this._player.filename   = filename;
        this._player.positionMs = 0;
        this._player.durationMs = durationMs || 0;
        this._player.playing    = false;
        this._player.paused     = false;
        // Kick playback on the server, then start polling.
        this._postPlayerPlay(filename, 0);
        this._startPlayerStatusPoll();
        // Pull the current speaker volume so the widget on the
        // right of the player shows real state on first paint
        // (instead of the default 50).
        this._fetchPlayerVolume();
        if (typeof window.requestRender === 'function') {
            window.requestRender();
        }
    };
    VoiceRecorderFilesScene.prototype._fetchPlayerVolume = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/sound/volume', true);
            xhr.timeout = 1500;
            xhr.onload = function() {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { return; }
                // /api/sound/volume returns { speaker, headphone }
                // — prefer speaker since that's the output the
                // recorder targets by default.
                if (typeof data.speaker === 'number') {
                    self._player.volume = Math.max(0, Math.min(100, data.speaker));
                    if (typeof window.requestRender === 'function') {
                        window.requestRender();
                    }
                }
            };
            xhr.send();
        } catch (e) { /* offline — leave default */ }
    };
    VoiceRecorderFilesScene.prototype._postPlayerVolume = function(pct) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/sound/volume', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send(JSON.stringify({ control: 'Speaker', volume: pct }));
        } catch (e) {}
    };
    VoiceRecorderFilesScene.prototype._stopSeekHold = function() {
        if (this._seekHold) {
            clearInterval(this._seekHold.timer);
            this._seekHold = null;
        }
    };
    VoiceRecorderFilesScene.prototype._closePlayer = function() {
        this._stopPlayerStatusPoll();
        // Cancel any pending seek-flash timer so it doesn't
        // fire after the player overlay has gone away.
        if (this._seekFlashTimer) {
            clearTimeout(this._seekFlashTimer);
            this._seekFlashTimer   = null;
        }
        this._stopSeekHold();
        this._player.seekFlash = null;
        // Stop server-side playback if anything is still
        // running — /api/sound/stop is idempotent so this is
        // safe even when the file finished on its own.
        this._postPlayerStop();
        this._player.open    = false;
        this._player.playing = false;
        this._player.paused  = false;
        if (typeof window.requestRender === 'function') {
            window.requestRender();
        }
    };
    VoiceRecorderFilesScene.prototype._startPlayerStatusPoll = function() {
        var self = this;
        if (this._playerStatusTimer) clearInterval(this._playerStatusTimer);
        // 250 ms = 4 Hz — fast enough for a smooth progress
        // bar, slow enough that the server isn't slammed.
        this._playerStatusTimer = setInterval(function() {
            self._fetchPlayerStatus();
        }, 250);
        // Kick the first fetch immediately so the overlay
        // doesn't paint with stale defaults for 250 ms.
        this._fetchPlayerStatus();
    };
    VoiceRecorderFilesScene.prototype._stopPlayerStatusPoll = function() {
        if (this._playerStatusTimer) {
            clearInterval(this._playerStatusTimer);
            this._playerStatusTimer = null;
        }
    };
    VoiceRecorderFilesScene.prototype._fetchPlayerStatus = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/record/play/status', true);
            xhr.timeout = 1500;
            xhr.onload = function() {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { return; }
                if (typeof data.positionMs === 'number') self._player.positionMs = data.positionMs;
                if (typeof data.durationMs === 'number' && data.durationMs > 0) self._player.durationMs = data.durationMs;
                if (typeof data.playing    === 'boolean') self._player.playing   = data.playing;
                if (typeof data.paused     === 'boolean') self._player.paused    = data.paused;
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            };
            xhr.send();
        } catch (e) { /* offline — leave cached state */ }
    };
    // Thin POST wrappers — each fires an action and lets the
    // next status poll reconcile the result.
    VoiceRecorderFilesScene.prototype._postPlayerPlay = function(filename, positionMs) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/play', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 2500;
            xhr.send(JSON.stringify({ file: filename, positionMs: positionMs || 0 }));
        } catch (e) {}
    };
    VoiceRecorderFilesScene.prototype._postPlayerPause = function() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/play/pause', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send('{}');
        } catch (e) {}
    };
    VoiceRecorderFilesScene.prototype._postPlayerResume = function() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/play/resume', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 2500;
            xhr.send('{}');
        } catch (e) {}
    };
    VoiceRecorderFilesScene.prototype._postPlayerSeek = function(deltaMs) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/play/seek', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 2500;
            xhr.send(JSON.stringify({ deltaMs: deltaMs }));
        } catch (e) {}
    };
    VoiceRecorderFilesScene.prototype._postPlayerStop = function() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/sound/stop', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 1500;
            xhr.send('{}');
        } catch (e) {}
    };

    VoiceRecorderFilesScene.prototype._handlePlayerInput = function(action) {
        var p = this._player;
        if (action === 'back' || action === 'esc') {
            this._closePlayer();
            return;
        }
        if (action === 'run') {
            // Stop button — close the overlay and kill server
            // playback.
            this._closePlayer();
            return;
        }
        if (action === 'up' || action === 'down') {
            // Volume: step ±10, clamped to 0..100. POST the new
            // value optimistically; the server applies it to the
            // Speaker control via amixer.
            var step = (action === 'up') ? 10 : -10;
            var next = Math.max(0, Math.min(100, p.volume + step));
            if (next !== p.volume) {
                p.volume = next;
                this._postPlayerVolume(next);
            }
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        if (action === 'ok') {
            // Toggle play / pause based on the last status
            // snapshot. The poll will reconcile a beat later.
            if (p.playing) {
                p.playing = false;
                p.paused  = true;
                this._postPlayerPause();
            } else if (p.paused) {
                p.playing = true;
                p.paused  = false;
                this._postPlayerResume();
            } else {
                // Track ended (server reports not playing AND
                // not paused with position == duration). Restart
                // from zero so OK on a finished track means
                // "play again".
                p.positionMs = 0;
                p.playing    = true;
                this._postPlayerPlay(p.filename, 0);
            }
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        if (action === 'left' || action === 'right') {
            // Long-press acceleration: first press jumps 10 s;
            // hold the key for another 500 ms and the next
            // seek steps by 20 s; 500 ms after that, 30 s;
            // and so on, capped at 60 s.
            //
            // Browser auto-repeat delivers the same action
            // every few ms while the key is held; we ignore
            // those redundant events while a hold cycle is
            // active. A setInterval polls
            // `window.input.isHeld(action)` to detect release,
            // because we don't get a discrete keyup event here.
            var dir    = (action === 'right') ? 1 : -1;
            var dirStr = (dir > 0) ? '+' : '-';
            if (this._seekHold && this._seekHold.action === action) {
                // Already in a hold cycle for this direction —
                // the interval will keep firing, ignore the
                // auto-repeat.
                return;
            }
            this._stopSeekHold();
            var STEP_INC = 10;
            var STEP_MAX = 60;
            var TICK_MS  = 500;
            var FLASH_MS = 600;
            var step     = STEP_INC;
            var self     = this;
            function fireStep(s) {
                self._postPlayerSeek(dir * s * 1000);
                self._player.seekFlash = { dir: dirStr, step: s };
                if (self._seekFlashTimer) clearTimeout(self._seekFlashTimer);
                self._seekFlashTimer = setTimeout(function() {
                    self._player.seekFlash = null;
                    self._seekFlashTimer   = null;
                    if (typeof window.requestRender === 'function') {
                        window.requestRender();
                    }
                }, FLASH_MS);
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            }
            // Initial press: seek immediately with the base step.
            fireStep(step);
            // Hold cycle: bump the step and re-seek as long as
            // the user keeps the key down.
            var holdTimer = setInterval(function() {
                var held = (typeof window !== 'undefined'
                            && window.input
                            && typeof window.input.isHeld === 'function')
                        ? window.input.isHeld(action)
                        : false;
                if (!held) {
                    self._stopSeekHold();
                    return;
                }
                step = Math.min(STEP_MAX, step + STEP_INC);
                fireStep(step);
            }, TICK_MS);
            this._seekHold = { action: action, timer: holdTimer };
            return;
        }
    };

    VoiceRecorderFilesScene.prototype._renderPlayer = function(canvas) {
        var ctx = canvas.ctx;
        var p   = this._player;
        var REC_W = 228;
        var REC_H = 48;
        var REC_Y = 41;
        // Anchored 4 px from the canvas's left edge (same x as
        // the breadcrumb) so the right-side gap can host the
        // volume bar without the player straddling the centre.
        var REC_X = 4;
        // Wash so the file list dims behind the player.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        // Subtle gray border around the player.
        new ResponsiveFrame({
            x: REC_X, y: REC_Y,
            width: REC_W, height: REC_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: true,  strokeColor: '#000000',
            showFill:   true,  fillColor:   '#FFFFFF',
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        // (1) Filename at top of rectangle.
        var fnStr  = p.filename || '';
        var maxFNW = REC_W - 14;
        while (fnStr.length > 0
               && Born2bSportyV2Medium.textWidth(fnStr) > maxFNW) {
            fnStr = fnStr.slice(0, -1);
        }
        if (fnStr.length < (p.filename || '').length && fnStr.length > 1) {
            fnStr = fnStr.slice(0, -1) + '.';
        }
        Born2bSportyV2Medium.draw(ctx, fnStr, REC_X + 7, REC_Y + 2, '#000');
        // (2) Progress bar centred vertically inside the rect.
        var PROG_PAD = 6;
        var PROG_X = REC_X + PROG_PAD;
        var PROG_W = REC_W - PROG_PAD * 2;
        var PROG_H = 7;
        var PROG_Y = REC_Y + Math.floor((REC_H - PROG_H) / 2);
        new ResponsiveFrame({
            x: PROG_X, y: PROG_Y,
            width: PROG_W, height: PROG_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: false,
            showFill:   true, fillColor: '#D9D9D9',
            cornerRadius: 2,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        var pct = p.durationMs > 0
            ? Math.max(0, Math.min(1, p.positionMs / p.durationMs))
            : 0;
        var fillW = Math.round(PROG_W * pct);
        if (fillW > 0) {
            var isFull = fillW >= PROG_W;
            new ResponsiveFrame({
                x: PROG_X, y: PROG_Y,
                width: fillW, height: PROG_H,
                anchorH: 'left', anchorV: 'top',
                showStroke: false,
                showFill:   true, fillColor: '#000',
                cornerRadius: 2,
                corners: { tl: true, bl: true, tr: isFull, br: isFull }
            }).render(canvas);
        }
        // (3) Bottom row: position | < -10  icon  +10 > | total.
        // 4 px higher than a flush-bottom anchor would land —
        // keeps the row from hugging the rectangle's bottom
        // stroke.
        var BOT_Y = REC_Y + REC_H - 16;
        HaxrcorpFont16.draw(ctx, _fmtPlayerTime(p.positionMs),
            REC_X + 6, BOT_Y, '#000');
        var rightText = _fmtPlayerTime(p.durationMs);
        var rightW    = HaxrcorpFont16.textWidth(rightText);
        HaxrcorpFont16.draw(ctx, rightText,
            REC_X + REC_W - 6 - rightW, BOT_Y, '#000');
        // Layout uses the WORST-CASE `< -60s` / `+60s >` widths
        // so the play/pause icon stays centred regardless of
        // the current seek step (which can grow from 10 to 60
        // during a long press). The widest flash never pushes
        // the icon off-centre.
        var leftWorst  = '< -60s';
        var rightWorst = '+60s >';
        var leftWorstW  = HaxrcorpFont16.textWidth(leftWorst);
        var rightWorstW = HaxrcorpFont16.textWidth(rightWorst);
        var gtW         = HaxrcorpFont16.textWidth('>');
        var ICON_W   = 7;
        var GAP      = 7;
        var midW     = leftWorstW + GAP + ICON_W + GAP + rightWorstW;
        var midX     = REC_X + Math.floor((REC_W - midW) / 2);

        // Left bracket: full `< -<N>s` (black) only while the
        // most recent press was a Left; otherwise a plain
        // gray `<` at the same anchor — quiet hint that left
        // is available without shouting "-10" all the time.
        if (p.seekFlash && p.seekFlash.dir === '-') {
            HaxrcorpFont16.draw(ctx,
                '< -' + p.seekFlash.step + 's',
                midX, BOT_Y, '#000');
        } else {
            HaxrcorpFont16.draw(ctx, '<', midX, BOT_Y, '#999');
        }
        var iconX = midX + leftWorstW + GAP;
        if (p.playing) {
            _drawPauseIcon(ctx, iconX, BOT_Y + 1, 8, '#000');
        } else {
            _drawPlayIcon(ctx, iconX, BOT_Y + 1, 8, '#000');
        }
        // Right bracket: same treatment, right-anchored so the
        // `>` lines up with where it'd sit in the full
        // `+<N>s >` form.
        var rightAnchor = iconX + ICON_W + GAP;
        if (p.seekFlash && p.seekFlash.dir === '+') {
            HaxrcorpFont16.draw(ctx,
                '+' + p.seekFlash.step + 's >',
                rightAnchor, BOT_Y, '#000');
        } else {
            HaxrcorpFont16.draw(ctx, '>',
                rightAnchor + rightWorstW - gtW, BOT_Y, '#999');
        }

        // Volume widget — vertical bar sitting in the 24-px
        // gap to the right of the (10-px-narrowed) player
        // rectangle. Same height + corner radius as the player
        // so the two read as a pair. Inside the outline a
        // black bar fills from the bottom proportional to the
        // current speaker volume; user adjusts via up / down.
        var VOL_W = 16;
        var VOL_H = REC_H;
        var VOL_X = REC_X + REC_W
                  + Math.floor((canvas.w - (REC_X + REC_W) - VOL_W) / 2);
        var VOL_Y = REC_Y;
        new ResponsiveFrame({
            x: VOL_X, y: VOL_Y,
            width: VOL_W, height: VOL_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: true,  strokeColor: '#000',
            showFill:   true,  fillColor:   '#FFF',
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        // Inner fill — 2 px inset on each side so it sits
        // inside the stroke with a 1-px gap of white showing,
        // and clears the rounded-corner curve at top / bottom.
        var H_INSET   = 2;
        var V_INSET   = 2;
        var innerX    = VOL_X + H_INSET;
        var innerW    = VOL_W - H_INSET * 2;
        var innerBot  = VOL_Y + VOL_H - V_INSET;
        var innerMaxH = VOL_H - V_INSET * 2;
        var fillH     = Math.round(innerMaxH * (p.volume / 100));
        if (fillH > 0) {
            new ResponsiveFrame({
                x: innerX, y: innerBot - fillH,
                width: innerW, height: fillH,
                anchorH: 'left', anchorV: 'top',
                showStroke: false,
                showFill:   true, fillColor: '#000',
                cornerRadius: 2,
                corners: { tl: true, tr: true, bl: true, br: true }
            }).render(canvas);
        }

        // Close button — painted AFTER the wash and player rect
        // so it sits crisp on top instead of being dimmed
        // alongside the file-list buttons underneath. Same
        // leftmost slot as Home in the file list, so the user's
        // muscle memory for "leftmost = exit this view" carries
        // straight over.
        if (this._closeBtn) {
            this._closeBtn.render(canvas);
        }
    };

    // ── Edit modal ──────────────────────────────────────────
    // Single-view popup with three rows. Sort row is a
    // dropdown-style entry: shows the current sort label
    // inline, cycles on left/right, opens a popover on OK
    // (same pattern as the recorder's Format picker row).
    VoiceRecorderFilesScene.prototype._openEditModal = function() {
        this._editModal.open          = true;
        this._editModal.selectedIndex = 0;
        if (typeof window.requestRender === 'function') {
            window.requestRender();
        }
    };
    VoiceRecorderFilesScene.prototype._handleEditModalInput = function(action) {
        // Edit button toggles: pressing it while the modal is
        // already open closes everything (modal + any open
        // sort popover) — same key both opens and dismisses.
        if (action === 'del') {
            this._sortPopup.open = false;
            this._editModal.open = false;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        // Sort popover wins input when open — it sits above the
        // Edit modal, both visually and in dispatch order.
        if (this._sortPopup.open) {
            return this._handleSortPopupInput(action);
        }
        var m = this._editModal;
        var n = EDIT_MAIN_ITEMS.length;
        if (action === 'up') {
            m.selectedIndex = (m.selectedIndex - 1 + n) % n;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        if (action === 'down') {
            m.selectedIndex = (m.selectedIndex + 1) % n;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        if (action === 'left' || action === 'right') {
            // Cycle the Sort value inline. Only the Sort row
            // responds — Rename / Delete don't have a value to
            // cycle. Lookup is by `id` so the order in
            // EDIT_MAIN_ITEMS can change without re-jigging
            // this handler.
            if (EDIT_MAIN_ITEMS[m.selectedIndex].id === 'sort') {
                var sn  = SORT_OPTIONS.length;
                var idx = _sortIndex(this._sortMode);
                idx = (action === 'right')
                    ? (idx + 1) % sn
                    : (idx - 1 + sn) % sn;
                this._applySort(SORT_OPTIONS[idx].id);
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            }
            return;
        }
        if (action === 'ok' || action === 'run') {
            var pickId = EDIT_MAIN_ITEMS[m.selectedIndex].id;
            if (pickId === 'sort') {
                this._openSortPopup();
            } else if (pickId === 'rename') {
                var picked = this.items[this.selectedIndex];
                if (picked && picked.text) {
                    m.open = false;
                    this._openRenameEditor(picked.text);
                }
            } else if (pickId === 'delete') {
                var pickedDel = this.items[this.selectedIndex];
                if (pickedDel && pickedDel.text) {
                    m.open = false;
                    this._openDeleteModal(pickedDel.text);
                }
            }
            return;
        }
        if (action === 'back' || action === 'esc') {
            m.open = false;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
    };
    VoiceRecorderFilesScene.prototype._renderEditModal = function(canvas) {
        var ctx = canvas.ctx;
        var m   = this._editModal;
        var L   = _computeEditLayout(canvas);
        var X = L.X, Y = L.Y, W = L.W, H = L.H;
        // Wash + body — white background with black stroke
        // (modal chrome), same as the info modal so the two
        // read as siblings.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        new ResponsiveFrame({
            x: X, y: Y, width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true,
            fillColor:   '#fff', showFill:   true,
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        // Title centred.
        var titleStr = 'Edit';
        var tw = Born2bSportyV2Medium.textWidth(titleStr);
        Born2bSportyV2Medium.draw(ctx, titleStr,
            X + Math.floor((W - tw) / 2), Y + MODAL_PAD, '#000');
        // Rows.
        //   Row 0 Sort  — laid out as a MenuDropdownLine: label
        //                 flush-left, gray chip flush-right with
        //                 the current value centred inside, plus
        //                 `< value >` arrows when this row is
        //                 the focused one (left / right cycles).
        //   Row 1 Rename
        //   Row 2 Delete — plain centred labels; no chip because
        //                  they're action buttons, not values.
        for (var i = 0; i < EDIT_MAIN_ITEMS.length; i++) {
            var rowY = L.optsTop + i * MODAL_OPT_H;
            var item = EDIT_MAIN_ITEMS[i];
            if (item.id === 'sort') {
                // Left-anchored title — drawn 1 px higher than
                // a stock MenuDropdownLine title so its cap line
                // sits flush with the chip's value text, instead
                // of riding a row below it.
                HaxrcorpFont16.draw(ctx, 'Sort',
                    X + MODAL_SIDE, rowY + 1, '#000');
                // Gray chip.
                new ResponsiveFrame({
                    x: L.chipX,    y: L.chipY,
                    width: L.CHIP_W, height: L.CHIP_H,
                    anchorH: 'left', anchorV: 'top',
                    showStroke: false,
                    showFill:   true,
                    fillColor:  MenuDropdownLine.CHIP_FILL,
                    cornerRadius: 3,
                    corners: { tl: true, tr: true, bl: true, br: true }
                }).render(canvas);
                // Chip value text — centred. No arrows in the
                // centred string; they're painted separately
                // below, anchored to the chip's own edges.
                var val  = _sortLabel(this._sortMode);
                var valW = HaxrcorpFont16.textWidth(val);
                HaxrcorpFont16.draw(ctx, val,
                    L.chipX + Math.floor((L.CHIP_W - valW) / 2),
                    L.chipY, '#000');
                // Focused row: `<` flush-left and `>` flush-right
                // inside the chip with a 4-px inset, matching
                // the recorder's MenuDropdownLine plain-chip
                // arrows. Tells the user left / right cycles.
                if (m.selectedIndex === i) {
                    var ARROW_PAD = 4;
                    var gtW = HaxrcorpFont16.textWidth('>');
                    HaxrcorpFont16.draw(ctx, '<',
                        L.chipX + ARROW_PAD, L.chipY, '#000');
                    HaxrcorpFont16.draw(ctx, '>',
                        L.chipX + L.CHIP_W - gtW - ARROW_PAD,
                        L.chipY, '#000');
                }
            } else {
                // Same +1 vertical inset as the Sort label so
                // all three rows share an optical baseline.
                var lbl = item.label;
                var lblW = HaxrcorpFont16.textWidth(lbl);
                HaxrcorpFont16.draw(ctx, lbl,
                    X + Math.floor((W - lblW) / 2), rowY + 1, '#000');
            }
        }
        // Selector frame around the highlighted row. 1 px taller
        // than the row's nominal height AND anchored 1 px above
        // the row top — the outline reads with breathing room
        // around the chip rather than riding flush against its
        // top edge.
        var selY = L.optsTop + m.selectedIndex * MODAL_OPT_H - 1;
        this._modalSelectorFrame.setPosition(X + MODAL_SEL_PAD, selY);
        this._modalSelectorFrame.setSize(W - MODAL_SEL_PAD * 2, MODAL_OPT_H + 1);
        this._modalSelectorFrame.render(canvas);
    };

    // ── Sort dropdown popover ──────────────────────────────
    // Layered on top of the Edit modal. Lists all four sort
    // options; OK applies and closes the popover (Edit modal
    // stays underneath, so the user sees the updated value on
    // the Sort row before they dismiss). Back closes without
    // applying — the live `_sortMode` is untouched by browsing
    // the popover.
    VoiceRecorderFilesScene.prototype._openSortPopup = function() {
        this._sortPopup.open          = true;
        this._sortPopup.selectedIndex = _sortIndex(this._sortMode);
        if (typeof window.requestRender === 'function') {
            window.requestRender();
        }
    };
    VoiceRecorderFilesScene.prototype._handleSortPopupInput = function(action) {
        var m = this._sortPopup;
        var n = SORT_OPTIONS.length;
        if (action === 'up') {
            m.selectedIndex = (m.selectedIndex - 1 + n) % n;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        if (action === 'down') {
            m.selectedIndex = (m.selectedIndex + 1) % n;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        if (action === 'ok' || action === 'run') {
            this._applySort(SORT_OPTIONS[m.selectedIndex].id);
            m.open = false;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        if (action === 'back' || action === 'esc') {
            // Discard the in-popover highlight — live sort mode
            // is whatever was applied before the popover opened.
            m.open = false;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
    };
    VoiceRecorderFilesScene.prototype._renderSortPopup = function(canvas) {
        var ctx = canvas.ctx;
        var m   = this._sortPopup;
        // Anchor at the Sort row's chip position so the popover
        // reads as "this chip expanded". Same width as the chip
        // so it visually flows out of it. Exactly the pattern
        // the recorder's _renderDropdown uses.
        var L      = _computeEditLayout(canvas);
        var ITEM_H = 13;
        var DIV_H  = 1;
        var n      = SORT_OPTIONS.length;
        var H      = ITEM_H * n + DIV_H * (n - 1) + 2;     // n items + (n-1) dividers + 1 px top/bottom
        var W      = L.CHIP_W;
        var bodyX  = L.chipX;
        // Open downward; flip to up if there isn't room below
        // the chip in the canvas (same drop-up logic the
        // recorder uses for its bottom rows).
        var BOTTOM_MARGIN = 2;
        var dropUp = (L.chipY + H > canvas.h - BOTTOM_MARGIN);
        var bodyY  = dropUp
            ? (L.chipY + L.CHIP_H - H)
            : L.chipY;
        // Wash so the page chrome reads as dimmed underneath.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        // Gray body — same fill colour as the closed chip, no
        // stroke, rounded corners — so the popover reads as the
        // chip growing into the option list.
        new ResponsiveFrame({
            x: bodyX, y: bodyY,
            width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            showStroke: false,
            showFill:   true,
            fillColor:  MenuDropdownLine.CHIP_FILL,
            cornerRadius: 3,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        // Option items — centred HaxrcorpFont16, 1-px gray
        // dividers between them. Top stroke at row 0; first
        // item sits at row 1. Same layout the recorder's
        // dropdown overlay uses.
        var selectedItemY = bodyY + 1;
        for (var i = 0; i < n; i++) {
            var itemY  = bodyY + 1 + i * (ITEM_H + DIV_H);
            var label  = SORT_OPTIONS[i].label;
            var labelW = HaxrcorpFont16.textWidth(label);
            HaxrcorpFont16.draw(ctx, label,
                bodyX + Math.floor((W - labelW) / 2),
                itemY + 1, '#000');
            if (i === m.selectedIndex) selectedItemY = itemY;
            if (i < n - 1) {
                canvas.drawHLine(bodyX + 1, itemY + ITEM_H,
                    W - 2, '#999999');
            }
        }
        // Selector outline around the highlighted item. Inset
        // 1 px on the right so the selector's BR shadow pixel
        // doesn't run past the body's right edge.
        this._modalSelectorFrame.setPosition(bodyX, selectedItemY);
        this._modalSelectorFrame.setSize(W - 1, ITEM_H + 2);
        this._modalSelectorFrame.render(canvas);
    };

    // Re-order `this.items` in place using the durations from
    // `fileMeta` (the original /api/record/list payload). Keeps
    // the user's current selection — the focused file follows
    // its new position rather than the selector snapping back
    // to the top of the list.
    VoiceRecorderFilesScene.prototype._applySort = function(mode) {
        this._sortMode = mode;
        var n = this.items.length;
        if (n === 0) return;
        // Snapshot the focused file's name BEFORE the sort so
        // we can locate its new index afterwards.
        var prevSelectedName = this.items[this.selectedIndex]
            && this.items[this.selectedIndex].text;
        var meta = this.fileMeta;
        var pairs = this.items.map(function(item) {
            return { item: item, meta: meta[item.text] || {} };
        });
        pairs.sort(function(a, b) {
            if (mode === 'name-asc') {
                return a.item.text.localeCompare(b.item.text);
            }
            if (mode === 'name-desc') {
                return b.item.text.localeCompare(a.item.text);
            }
            if (mode === 'duration-desc') {
                return (b.meta.durationMs || 0) - (a.meta.durationMs || 0);
            }
            if (mode === 'duration-asc') {
                return (a.meta.durationMs || 0) - (b.meta.durationMs || 0);
            }
            return 0;
        });
        this.items = pairs.map(function(p) { return p.item; });
        // Find the same file in the resorted list — if it's
        // gone for any reason (shouldn't happen here, but
        // defensive), fall back to the top.
        var newIdx = 0;
        if (prevSelectedName) {
            for (var i = 0; i < this.items.length; i++) {
                if (this.items[i].text === prevSelectedName) {
                    newIdx = i;
                    break;
                }
            }
        }
        for (var j = 0; j < this.items.length; j++) {
            this.items[j].state = MenuLine.STATE_DEFAULT;
        }
        this.selectedIndex = newIdx;
        this.items[newIdx].state = MenuLine.STATE_SELECTED;
        // Scroll so the focused row is visible in the new
        // ordering — without this, sorting can leave the
        // selector outside the viewport.
        this._ensureVisible();
    };

    // Format milliseconds as `M:SS` for runtimes under an hour,
    // `H:MM:SS` otherwise. Empty / null durations render as `—`.
    function fmtDuration(ms) {
        if (ms == null || !isFinite(ms) || ms <= 0) return '—';
        var s = Math.round(ms / 1000);
        var hh = Math.floor(s / 3600);
        var mm = Math.floor((s % 3600) / 60);
        var ss = s % 60;
        function pad2(n) { return n < 10 ? '0' + n : '' + n; }
        if (hh > 0) return hh + ':' + pad2(mm) + ':' + pad2(ss);
        return mm + ':' + pad2(ss);
    }

    VoiceRecorderFilesScene.prototype._buildItems = function(files) {
        this.items = [];
        this.fileMeta = {};
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            this.fileMeta[f.name] = f;
            this.items.push(new MenuLine({
                text:   f.name,
                width:  CONTAINER_W,
                status: fmtDuration(f.durationMs),
                // Suppress the default +1 active-label nudge —
                // the selector frame in this scene sits a row
                // higher (SELECTOR_Y_OFFSET = -1), so the
                // Born2bSporty label needs to ride 1 px higher
                // too to stay optically centred inside it.
                activeLabelYNudge: 0
            }));
        }
        if (this.items.length > 0) {
            this.selectedIndex = 0;
            this.items[0].state = MenuLine.STATE_SELECTED;
        }
        this.scrollbar = new UI.Scrollbar(
            this.items.length, VISIBLE_COUNT, this.scrollOffset);
    };

    VoiceRecorderFilesScene.prototype._fetchList = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/record/list', true);
            xhr.timeout = 5000;     // soxi probes can add up on first call
            xhr.onload = function() {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { return; }
                if (!data || !Array.isArray(data.files)) return;
                if (typeof data.folderPath === 'string') {
                    self.folderPath = data.folderPath;
                }
                self._buildItems(data.files);
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            };
            xhr.send();
        } catch (e) { /* offline — leave empty list */ }
    };

    // Push the shared TextInputScreen pre-seeded with the
    // current filename (extension stripped) so the user only
    // edits the meaningful part. On save we POST the new name
    // and re-fetch the list so the freshly-renamed file shows
    // up with its new label and selection lands on it.
    VoiceRecorderFilesScene.prototype._openRenameEditor = function(originalName) {
        var self = this;
        if (typeof TextInputScreen === 'undefined' || !this.sceneManager) return;
        var nameNoExt = originalName.replace(/\.(wav|mp3|ogg)$/i, '');
        var extMatch  = originalName.match(/\.(wav|mp3|ogg)$/i);
        var ext       = extMatch ? extMatch[0] : '.wav';
        var screen = new TextInputScreen({
            displayName: 'Rename',
            title:       'New name',
            initialText: nameNoExt,
            onSave: function(text) {
                var clean = (text == null ? '' : String(text))
                    .replace(/^\s+|\s+$/g, '');
                if (clean.length === 0) return;
                // No-op if the user committed an unchanged name.
                if (clean === nameNoExt) return;
                self._postRename(originalName, clean);
            },
            // Live duplicate check — warns the user before
            // they hit Done, instead of after the server
            // rejects the rename. Looks up `<typed>.<orig-ext>`
            // in the scene's fileMeta cache; renaming to the
            // SAME file (target === source) is allowed and
            // suppresses the warning. Empty / unchanged input
            // also suppresses (nothing to warn about yet).
            validate: function(text) {
                var clean = String(text == null ? '' : text)
                    .replace(/^\s+|\s+$/g, '');
                if (clean.length === 0)        return null;
                if (clean === nameNoExt)        return null;
                var target = clean + ext;
                if (target === originalName)    return null;
                if (self.fileMeta && self.fileMeta[target]) {
                    return 'Name already exists';
                }
                return null;
            }
        });
        this.sceneManager.push(screen);
    };

    // POST /api/record/rename { from, to } — server preserves
    // the extension and walks `-N` suffixes on collision.
    // Refreshes the list on success and tries to keep the
    // renamed file selected so the user's focus follows their
    // edit.
    VoiceRecorderFilesScene.prototype._postRename = function(from, to) {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/rename', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 2500;
            xhr.onload = function() {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { data = null; }
                // Server rejected the rename. The common case is
                // a duplicate target — show a focused message so
                // the user knows their typed name was already
                // taken (and that the original file is intact).
                if (data && data.success === false) {
                    if (data.error === 'duplicate') {
                        self._openInfoModal('Name already exists');
                    } else if (data.error) {
                        self._openInfoModal(String(data.error));
                    } else {
                        self._openInfoModal('Rename failed');
                    }
                    return;
                }
                // Success — re-fetch list and try to land focus
                // on the renamed file.
                var targetName = (data && data.file) ? data.file : null;
                self._fetchListAndSelect(targetName);
            };
            xhr.onerror   = function() { self._fetchListAndSelect(null); };
            xhr.ontimeout = function() { self._fetchListAndSelect(null); };
            xhr.send(JSON.stringify({ from: from, to: to }));
        } catch (e) { /* offline — leave list as-is */ }
    };

    // Refetch the list and, if `selectName` is supplied, move
    // the selector to that file once items are rebuilt. Used
    // after a rename so the user's focus follows their edit.
    VoiceRecorderFilesScene.prototype._fetchListAndSelect = function(selectName) {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/record/list', true);
            xhr.timeout = 5000;
            xhr.onload = function() {
                var data;
                try { data = JSON.parse(xhr.responseText || '{}'); }
                catch (e) { return; }
                if (!data || !Array.isArray(data.files)) return;
                if (typeof data.folderPath === 'string') {
                    self.folderPath = data.folderPath;
                }
                self._buildItems(data.files);
                if (selectName) {
                    for (var i = 0; i < self.items.length; i++) {
                        if (self.items[i].text === selectName) {
                            self.items[self.selectedIndex]
                                && (self.items[self.selectedIndex].state = MenuLine.STATE_DEFAULT);
                            self.selectedIndex = i;
                            self.items[i].state = MenuLine.STATE_SELECTED;
                            self._ensureVisible();
                            break;
                        }
                    }
                }
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            };
            xhr.send();
        } catch (e) { /* offline */ }
    };

    VoiceRecorderFilesScene.prototype.enter = function() {
        this._fetchList();
    };
    VoiceRecorderFilesScene.prototype.exit = function() {
        // If the scene exits while the player is open (e.g.
        // user hits Home), tear down the status poll and stop
        // the server-side playback so audio doesn't keep going
        // after the page is gone.
        if (this._player && this._player.open) {
            this._stopPlayerStatusPoll();
            this._postPlayerStop();
            this._player.open = false;
        }
    };

    VoiceRecorderFilesScene.prototype._ensureVisible = function() {
        if (this.selectedIndex < this.scrollOffset) {
            this.scrollOffset = this.selectedIndex;
        } else if (this.selectedIndex >= this.scrollOffset + VISIBLE_COUNT) {
            this.scrollOffset = this.selectedIndex - VISIBLE_COUNT + 1;
        }
    };

    // Press-flash a button: brief pressed state, render, release
    // 30 ms later, render again, fire its onPress. Same shape
    // the recorder uses so the visual feedback feels identical
    // across scenes.
    function _flashAndFire(btn) {
        if (!btn) return;
        btn.pressed = true;
        if (typeof window.requestRender === 'function') {
            window.requestRender();
        }
        setTimeout(function() {
            btn.pressed = false;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
        }, 30);
        if (typeof btn.onPress === 'function') btn.onPress();
    }

    VoiceRecorderFilesScene.prototype.handleInput = function(action) {
        // Overlays own input until they close. Order:
        //   1. Player overlay (highest priority — visible UI)
        //   2. Delete-confirm modal (destructive prompt)
        //   3. Edit modal (main interaction surface)
        //   4. Info modal (smaller dismissible stub)
        if (this._player.open) {
            return this._handlePlayerInput(action);
        }
        if (this._deleteModal.open) {
            return this._handleDeleteModalInput(action);
        }
        if (this._editModal.open) {
            return this._handleEditModalInput(action);
        }
        if (this._infoModal.open) {
            return this._handleInfoModalInput(action);
        }

        // Button strip — dispatched by action name. Each button
        // handles its own scene navigation / modal in its
        // onPress; here we just route the press.
        if (action === 'esc')  { _flashAndFire(this._homeBtn);   return; }
        if (action === 'edit') { _flashAndFire(this._recordBtn); return; }
        if (action === 'del')  { _flashAndFire(this._editBtn);   return; }
        if (action === 'run')  { _flashAndFire(this._playBtn);   return; }

        var n = this.items.length;

        if (action === 'back') return 'pop';

        if (n === 0) return;

        if (action === 'down' || action === 'up') {
            this.items[this.selectedIndex].state = MenuLine.STATE_DEFAULT;
            if (action === 'down') {
                this.selectedIndex = (this.selectedIndex + 1) % n;
            } else {
                this.selectedIndex = (this.selectedIndex - 1 + n) % n;
            }
            this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;
            this._ensureVisible();
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            return;
        }
        if (action === 'ok') {
            // OK on a list row opens the player for the
            // focused file — same effect as pressing the Play
            // button on the right. Press flash gives the row
            // a quick "I heard that" tap feedback before the
            // overlay takes over.
            var self        = this;
            var pressedLine = this.items[this.selectedIndex];
            var pickedName  = pressedLine && pressedLine.text;
            if (!pickedName) return;
            pressedLine.state = MenuLine.STATE_PRESSED;
            if (typeof window.requestRender === 'function') {
                window.requestRender();
            }
            setTimeout(function() {
                pressedLine.state = MenuLine.STATE_SELECTED;
                var meta = (self.fileMeta && self.fileMeta[pickedName]) || {};
                self._openPlayer(pickedName, meta.durationMs || 0);
            }, 30);
            return;
        }
    };

    VoiceRecorderFilesScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        if (typeof UI !== 'undefined' && typeof UI.drawStatusBar === 'function') {
            UI.drawStatusBar(canvas, '');
        }
        var ctx    = canvas.ctx;
        var titleY = UI.STATUS_BAR_H;
        ctx.fillStyle = TITLE_FILL;
        ctx.fillRect(0, titleY, canvas.w, TITLE_H);
        if (this.icon) {
            canvas.drawSprite(this.icon, ICON_X, titleY + 1, '#000');
        }
        Born2bSportyV2Medium.draw(ctx, this.displayName,
            TITLE_TEXT_X, UI.STATUS_BAR_H + TITLE_TEXT_DY, '#000');

        // Inline breadcrumb — full filesystem path to the
        // current folder, HaxrcorpFont16 in gray. No leading
        // "> " marker on this screen; the gray app-title bar
        // above already tells the user they're inside the Voice
        // recorder, so the breadcrumb is purely the path
        // disambiguator. Until the fetch lands we fall back to
        // the bare folder name so the row never reads as blank.
        // Truncates with an ellipsis on the LEFT when it
        // doesn't fit, so the tail (the leaf folder the user
        // actually cares about) stays visible.
        var crumbPath = this.folderPath || this.folderName;
        var crumbStr  = crumbPath;
        var maxW      = canvas.w - BREADCRUMB_X - 2;
        if (HaxrcorpFont16.textWidth(crumbStr) > maxW) {
            var stripped = crumbPath;
            while (stripped.length > 1
                   && HaxrcorpFont16.textWidth('…' + stripped) > maxW) {
                stripped = stripped.slice(1);
            }
            crumbStr = '…' + stripped;
        }
        HaxrcorpFont16.draw(ctx, crumbStr,
            BREADCRUMB_X, BREADCRUMB_Y, '#999999');

        // Empty state.
        if (this.items.length === 0) {
            var msg = '(no recordings yet)';
            var w   = HaxrcorpFont16.textWidth(msg);
            HaxrcorpFont16.draw(ctx, msg,
                Math.floor((canvas.w - w) / 2),
                this.containerY + 18, '#999');
            return;
        }

        var total     = this.items.length;
        var hasScroll = total > VISIBLE_COUNT;
        var selectorW = hasScroll ? SELECTOR_W_WITH_SCROLL : SELECTOR_W_NO_SCROLL;
        var dividerX  = SELECTOR_X + SELECTOR_CORNER_R;
        var dividerW  = selectorW - 2 * SELECTOR_CORNER_R;

        var lineW = selectorW + SELECTOR_X - CONTAINER_X;
        for (var k = 0; k < this.items.length; k++) this.items[k].w = lineW;

        var first = this.scrollOffset;
        var last  = Math.min(total, first + VISIBLE_COUNT);
        var y     = this.containerY;
        var selectedLineY = this.containerY;
        for (var i = first; i < last; i++) {
            if (i === this.selectedIndex) selectedLineY = y;
            this.items[i].render(canvas, CONTAINER_X, y);
            y += MenuLine.H;
            if (i < last - 1) {
                canvas.drawHLine(dividerX, y, dividerW, DIVIDER_COLOR);
                y += 1;
            }
        }

        var pressed = this.items[this.selectedIndex].state === MenuLine.STATE_PRESSED;
        this.selectorFrame.setPosition(SELECTOR_X, selectedLineY + SELECTOR_Y_OFFSET);
        this.selectorFrame.setSize(selectorW, SELECTOR_H);
        this.selectorFrame.setShowFill(pressed);
        if (pressed) this.selectorFrame.setFillColor('#000');
        this.selectorFrame.render(canvas);
        if (pressed) {
            this.items[this.selectedIndex].render(canvas, CONTAINER_X, selectedLineY);
        }

        // Scrollbar — only when the list overflows the viewport.
        // Sync the scroll-state first (Scrollbar caches it
        // internally), then render at the fixed column with the
        // shared thumb-pad SubMenuScene uses.
        if (this.scrollbar && this.scrollbar.shouldShow()) {
            this.scrollbar.update(this.items.length,
                                  VISIBLE_COUNT,
                                  this.scrollOffset);
            this.scrollbar.render(canvas,
                                  SCROLLBAR_X, SCROLLBAR_Y,
                                  SCROLLBAR_H, SCROLLBAR_THUMB_PAD);
        }

        // Bottom button strip — Home | Record | _ | Edit | Play.
        // Painted before the modal so the wash drawn by the
        // modal dims the strip along with the rest of the page.
        if (this._homeBtn)   this._homeBtn.render(canvas);
        if (this._recordBtn) this._recordBtn.render(canvas);
        if (this._editBtn)   this._editBtn.render(canvas);
        if (this._playBtn)   this._playBtn.render(canvas);

        // Info modal sits above everything when open.
        if (this._infoModal.open) {
            this._renderInfoModal(canvas);
        }
        // Edit modal painted last so it sits above the info
        // modal too — in practice they don't overlap (selecting
        // Rename / Delete closes Edit first), but the ordering
        // keeps "current focus" predictable.
        if (this._editModal.open) {
            this._renderEditModal(canvas);
        }
        // Sort popover sits on top of the Edit modal so the
        // user sees it as a layered drop-down. Painted last
        // so it always wins z-order if both are open.
        if (this._sortPopup.open) {
            this._renderSortPopup(canvas);
        }
        // Delete-confirmation modal — painted absolutely last
        // so it sits above every other overlay (sort popover,
        // edit modal, info modal). In practice it's the only
        // overlay open when it's visible (it replaces Edit on
        // open), but ordering this way keeps z-order intent
        // explicit.
        if (this._deleteModal.open) {
            this._renderDeleteModal(canvas);
        }
        // Player overlay — painted on top of the file list and
        // every other overlay so its rectangle reads as "the
        // current foreground". The list is still drawn behind
        // (dimmed by the player's own wash).
        if (this._player.open) {
            this._renderPlayer(canvas);
        }
    };

    return VoiceRecorderFilesScene;
})();
