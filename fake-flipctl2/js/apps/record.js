/**
 * Voice recorder — Wi-Fi-style scenes.
 *
 *   VoiceRecorderScene  — main page. Breadcrumb on top, then a
 *                         "New recording" chevron row, a section
 *                         divider, and the saved-recordings list.
 *                         Each row uses the same selector chrome as
 *                         the Wi-Fi page (MenuSelectorFrame for
 *                         non-chevron rows, ComponentSelectorFrame
 *                         with chevron bar for drill-in rows).
 *   RecordingScene      — full-screen active capture. Modal-styled
 *                         card centered in the body, blinking REC +
 *                         MM:SS counter, [Stop] button hint. Triple
 *                         coverage on stop (handleInput, exit,
 *                         pagehide / beforeunload via sendBeacon)
 *                         so the recording cannot leak past the
 *                         scene's lifetime.
 *
 * The list scene also hosts a per-recording detail modal (Play /
 * Delete + size/date info) — same shape as the Wi-Fi connect /
 * verbose modals. Triggered by OK on a saved-recording row.
 */
var VoiceRecorderScene = (function() {
    // ── Style constants (mirror the Wi-Fi page) ──────────────
    var BREADCRUMB_X       = 4;
    var BREADCRUMB_Y       = UI.STATUS_BAR_H + 2;
    var SELECTOR_X         = 4;
    var SELECTOR_W         = 247;
    var ROW_H              = 13;
    var SELECTOR_H         = ROW_H + 2;
    var SELECTOR_Y_OFFSET  = -1;
    var DIVIDER_COL        = '#CCCCCC';
    var CONTAINER_Y_OFFSET = 16;
    var TEXT_LEFT_PAD      = 5;
    var STATUS_RIGHT_PAD   = 5;
    var DIVIDER_ROW_H      = 3;

    // Modal layout (matches the visible-networks / saved-networks
    // shells: 4 px screen padding, tab + frame stack, max bottom
    // y = 128).
    var SCREEN_PAD         = 4;
    var TAB_H              = 16;
    var FRAME_PAD_TOP      = 3;
    var FRAME_PAD_BOTTOM   = 3;
    var MAX_BOTTOM_Y       = 128;
    var CANVAS_H           = 144;

    // Local ellipsiser. Wi-Fi has its own; we inline a copy here
    // so the file stays self-contained.
    function ellipsizeTo(text, maxW) {
        text = text == null ? '' : String(text);
        if (HaxrcorpFont16.textWidth(text) <= maxW) return text;
        var dots = '…';
        var dotW = HaxrcorpFont16.textWidth(dots);
        var s = text;
        while (s.length > 0
               && HaxrcorpFont16.textWidth(s) + dotW > maxW) {
            s = s.substring(0, s.length - 1);
        }
        return s + dots;
    }

    // Strip the .wav extension and the rec- prefix for display —
    // the timestamp itself is what matters and the chrome is
    // noise.
    function displayName(filename) {
        var s = filename.replace(/\.wav$/i, '');
        if (s.indexOf('rec-') === 0) s = s.substring(4);
        return s;
    }

    // Estimate duration in seconds from the WAV's data size.
    // 48 kHz × 16-bit × 1 ch = 96 000 bytes/sec; the WAV
    // header adds ~44 bytes which is well below 1 sec at this
    // rate, so the rough divide is fine for display purposes.
    // Keep this in sync with the sox arg block in
    // `server.js#startRecording` if either side changes.
    function estimateDurationSec(sizeBytes) {
        if (typeof sizeBytes !== 'number' || sizeBytes <= 44) return 0;
        return Math.max(0, (sizeBytes - 44) / 96000);
    }

    function formatDuration(sec) {
        if (!sec || sec < 0) return '0:00';
        var total = Math.round(sec);
        var mm = Math.floor(total / 60);
        var ss = total % 60;
        return mm + ':' + (ss < 10 ? '0' + ss : ss);
    }

    function formatSize(bytes) {
        if (typeof bytes !== 'number') return '—';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    // Pull the YYYYMMDD-HHMMSS chunk out of the filename and
    // format it as a human-friendly date. Falls back to the raw
    // display name on shape mismatch.
    function formatRecordingDate(filename) {
        var m = filename.match(/^rec-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
        if (!m) return displayName(filename);
        return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
    }

    function VoiceRecorderScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Voice recorder';
        this.breadcrumbTitle = 'Voice recorder';

        this.containerY    = UI.STATUS_BAR_H + CONTAINER_Y_OFFSET;
        this.selectedIndex = 0;

        // Init data state BEFORE _buildItems(): the builder
        // reads `_recordings.length` to decide whether to emit
        // the divider + saved-row entries, so an undefined
        // value here would throw and the scene would never
        // render.
        this._modal       = null;
        this._recordings  = [];
        this._loaded      = false;
        this._playing     = null;
        this._pollTimer   = null;

        this.items = [];
        this._buildItems();

        // Selection chrome — same two frames the Wi-Fi page uses.
        this.selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X, y: 0,
            width: SELECTOR_W, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
        this.chevronSelectorFrame = new ComponentSelectorFrame({
            x: SELECTOR_X, y: 0,
            width: SELECTOR_W, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false,
            cornerRadius: 3,
            showChevron: true,
            chevronWidth: 7
        });
    }

    VoiceRecorderScene.prototype.enter = function() {
        var self = this;
        this._fetchList();
        // Lightweight 4-s poll while the scene is active so a
        // recording made then-deleted via curl, or a refresh after
        // a server-side change, surfaces without manual reload.
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = setInterval(function() { self._fetchList(); }, 4000);
    };
    VoiceRecorderScene.prototype.exit = function() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        // Don't keep audio playing when leaving the scene.
        if (this._playing) this._stopPlayback();
    };

    VoiceRecorderScene.prototype._fetchList = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/record/list', true);
            xhr.timeout = 4000;
            xhr.onload = function() {
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        self._recordings = (data && data.files) || [];
                    } catch (e) { self._recordings = []; }
                }
                self._loaded = true;
                self._buildItems();
                if (window.requestRender) window.requestRender();
            };
            xhr.onerror   = function() { self._loaded = true; };
            xhr.ontimeout = function() { self._loaded = true; };
            xhr.send();
        } catch (e) { self._loaded = true; }
    };

    VoiceRecorderScene.prototype._playFile = function(filename) {
        var self = this;
        self._playing = filename;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/play', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 10000;
            xhr.onerror   = function() { self._playing = null; if (window.requestRender) window.requestRender(); };
            xhr.ontimeout = function() { self._playing = null; if (window.requestRender) window.requestRender(); };
            xhr.send(JSON.stringify({ file: filename }));
        } catch (e) { self._playing = null; }
        if (window.requestRender) window.requestRender();
    };

    VoiceRecorderScene.prototype._stopPlayback = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/sound/stop', true);
            xhr.timeout = 3000;
            xhr.onload = function() { self._playing = null; if (window.requestRender) window.requestRender(); };
            xhr.send();
        } catch (e) { self._playing = null; }
    };

    VoiceRecorderScene.prototype._deleteFile = function(filename, cb) {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/delete', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 4000;
            xhr.onload = function() { cb && cb(xhr.status === 200); };
            xhr.onerror   = function() { cb && cb(false); };
            xhr.ontimeout = function() { cb && cb(false); };
            xhr.send(JSON.stringify({ file: filename }));
        } catch (e) { cb && cb(false); }
    };

    // Rebuild items list. First row is always "New recording"
    // (chevron). When recordings exist, a divider follows, then
    // one chevron row per recording. Empty case: just the
    // sentinel row + a placeholder gray "No recordings" line
    // is rendered as a non-selectable row.
    VoiceRecorderScene.prototype._buildItems = function() {
        var self = this;
        var items = [];
        items.push({
            text: 'New recording',
            chevron: true,
            isNewRecording: true,
            onPress: function() {
                if (self.sceneManager) {
                    self.sceneManager.push(new RecordingScene(self.sceneManager));
                }
            }
        });
        if (this._recordings.length > 0) {
            items.push({ kind: 'divider' });
            for (var i = 0; i < this._recordings.length; i++) {
                var r = this._recordings[i];
                items.push({
                    text: displayName(r.name),
                    file: r.name,
                    size: r.size,
                    mtime: r.mtime,
                    chevron: true,
                    onPress: (function(rec) {
                        return function() { self._openDetailModal(rec); };
                    })(r)
                });
            }
        }
        this.items = items;
        if (this.selectedIndex >= items.length) {
            this.selectedIndex = Math.max(0, items.length - 1);
        }
        if (items[this.selectedIndex] && items[this.selectedIndex].kind === 'divider') {
            this.selectedIndex = this._nextSelectable(this.selectedIndex, 1);
        }
    };

    VoiceRecorderScene.prototype._nextSelectable = function(idx, dir) {
        var n = this.items.length;
        if (n === 0) return 0;
        for (var step = 0; step < n; step++) {
            idx = (idx + dir + n) % n;
            var it = this.items[idx];
            if (!it || it.kind !== 'divider') return idx;
        }
        return 0;
    };

    VoiceRecorderScene.prototype.handleInput = function(action) {
        if (this._modal) {
            this._modal.handleInput(action);
            return;
        }
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'down') {
            this.selectedIndex = this._nextSelectable(this.selectedIndex, 1);
            return;
        }
        if (action === 'up') {
            this.selectedIndex = this._nextSelectable(this.selectedIndex, -1);
            return;
        }
        if (action === 'ok' || action === 'run') {
            var sel = this.items[this.selectedIndex];
            if (sel && sel.onPress) sel.onPress();
            return;
        }
    };

    // ── Per-recording detail modal ───────────────────────────
    // Wi-Fi-verbose-style modal: ResponsiveFrame body + black
    // TabHeader (recording date), simple action list:
    //   • Play / Stop (toggle, surfaces playback state)
    //   • Delete this recording
    // Followed by a small info section: Size, Duration. Esc /
    // Back closes. Selection skips dividers via nextSelectable.
    VoiceRecorderScene.prototype._openDetailModal = function(rec) {
        var self = this;
        var FRAME_X      = SCREEN_PAD;
        var FRAME_W      = 256 - SCREEN_PAD * 2;
        var KV_H         = 12;
        var DIVIDER_H    = 3;
        var INNER_LABEL_GAP = 4;

        // Local selection / state.
        var selectedIdx = 0;
        var pressedIdx  = -1;
        var deleting    = false;

        function rowsList() {
            var rows = [];
            rows.push({
                kind: 'action',
                text: (self._playing === rec.name) ? 'Stop' : 'Play',
                selectable: true,
                onPress: function() {
                    if (self._playing === rec.name) {
                        self._stopPlayback();
                    } else {
                        self._playFile(rec.name);
                    }
                }
            });
            rows.push({
                kind: 'action',
                text: 'Delete this recording',
                selectable: true,
                onPress: function() {
                    if (deleting) return;
                    deleting = true;
                    // If we're playing the file we're about to
                    // delete, stop first so the OS isn't holding
                    // the descriptor open.
                    if (self._playing === rec.name) self._stopPlayback();
                    self._deleteFile(rec.name, function() {
                        deleting = false;
                        self._fetchList();
                        // Close the modal — the file is gone, so
                        // there's nothing to drill into.
                        closeModal();
                    });
                }
            });
            rows.push({ kind: 'sectionDivider', selectable: false });
            // Info section.
            rows.push({
                kind: 'kv', selectable: false,
                label: 'Size:',     value: formatSize(rec.size)
            });
            rows.push({
                kind: 'kv', selectable: false,
                label: 'Duration:', value: formatDuration(estimateDurationSec(rec.size))
            });
            rows.push({
                kind: 'kv', selectable: false,
                label: 'Date:',     value: formatRecordingDate(rec.name)
            });
            return rows;
        }

        function rowHeightOf(row) {
            if (row.kind === 'sectionDivider') return DIVIDER_H;
            if (row.kind === 'action')         return ROW_H;
            return KV_H;
        }

        function nextSelectable(rows, idx, dir) {
            var n = rows.length;
            for (var step = 0; step < n; step++) {
                idx = (idx + dir + n) % n;
                if (rows[idx].selectable) return idx;
            }
            return -1;
        }

        var listSelector = new MenuSelectorFrame({
            x: 0, y: 0, width: 1, height: ROW_H + 2,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
        var tab = new UI.TabHeader(formatRecordingDate(rec.name));
        tab.x = FRAME_X;
        tab.h = TAB_H;

        function computeLayout() {
            var rows = rowsList();
            var rowOffsets = [];
            var contentH   = 0;
            for (var i = 0; i < rows.length; i++) {
                rowOffsets.push(contentH);
                contentH += rowHeightOf(rows[i]);
            }
            var maxModalH = MAX_BOTTOM_Y - SCREEN_PAD;
            var maxFrameH = maxModalH - TAB_H;
            var frameH    = Math.min(maxFrameH,
                contentH + FRAME_PAD_TOP + FRAME_PAD_BOTTOM);
            if (frameH < 28) frameH = 28;
            var modalH    = TAB_H + frameH;
            var centeredY = Math.floor((CANVAS_H - modalH) / 2);
            var pinnedY   = MAX_BOTTOM_Y - modalH;
            var topY      = Math.min(centeredY, pinnedY);
            if (topY < SCREEN_PAD) topY = SCREEN_PAD;
            var frameY    = topY + TAB_H;
            var innerTop  = frameY + FRAME_PAD_TOP;
            var innerH    = frameH - FRAME_PAD_TOP - FRAME_PAD_BOTTOM;
            return { topY: topY, frameY: frameY, frameH: frameH,
                     innerTop: innerTop, innerH: innerH,
                     contentH: contentH, rows: rows,
                     rowOffsets: rowOffsets };
        }

        function closeModal() {
            self._modal = null;
            if (window.requestRender) window.requestRender();
        }

        self._modal = {
            handleInput: function(action) {
                if (action === 'back' || action === 'esc') {
                    closeModal();
                    return true;
                }
                var rows = rowsList();
                if (action === 'down') {
                    selectedIdx = nextSelectable(rows, selectedIdx, 1);
                    if (window.requestRender) window.requestRender();
                    return true;
                }
                if (action === 'up') {
                    selectedIdx = nextSelectable(rows, selectedIdx, -1);
                    if (window.requestRender) window.requestRender();
                    return true;
                }
                if (action === 'ok' || action === 'run') {
                    var sel = rows[selectedIdx];
                    if (!sel || !sel.onPress) return true;
                    pressedIdx = selectedIdx;
                    if (window.requestRender) window.requestRender();
                    setTimeout(function() {
                        pressedIdx = -1;
                        if (window.requestRender) window.requestRender();
                    }, 30);
                    sel.onPress();
                    return true;
                }
                return false;
            },
            render: function(canvas) {
                var ctx = canvas.ctx;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
                ctx.fillRect(0, 0, canvas.w, canvas.h);

                var L = computeLayout();
                var INNER_X   = FRAME_X + 3;
                var dynInnerW = FRAME_W - 6;

                tab.y = L.topY;

                var frame = new ResponsiveFrame({
                    x: FRAME_X, y: L.frameY,
                    width: FRAME_W, height: L.frameH,
                    anchorH: 'left', anchorV: 'top',
                    strokeColor: '#000', showStroke: true,
                    fillColor: '#ffffff', showFill: true,
                    cornerRadius: 3,
                    corners: { tl: false, tr: true, bl: true, br: true }
                });
                frame.render(canvas);
                tab.render(canvas);

                ctx.save();
                ctx.beginPath();
                ctx.rect(FRAME_X + 1, L.frameY + 1, FRAME_W - 2, L.frameH - 2);
                ctx.clip();

                var rows = L.rows;
                var selectedY = -1;
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    var rowAbsY = L.innerTop + L.rowOffsets[i];
                    var rh = rowHeightOf(row);
                    if (i === selectedIdx) selectedY = rowAbsY;
                    var isSelected = (i === selectedIdx);
                    var isPressed  = (i === pressedIdx);
                    var fg    = isPressed ? '#fff' : '#000';
                    var fgDim = isPressed ? '#fff' : '#999999';
                    if (isPressed && row.selectable) {
                        canvas.drawRoundRect(INNER_X, rowAbsY - 1,
                            dynInnerW, rh + 2, 2, '#000');
                    }
                    if (row.kind === 'sectionDivider') {
                        canvas.drawHLine(INNER_X + 3, rowAbsY + 1,
                            dynInnerW - 6, '#CCCCCC');
                    } else if (row.kind === 'action') {
                        HaxrcorpFont16.draw(ctx, row.text,
                            INNER_X + 5, rowAbsY + 1, fg);
                    } else if (row.kind === 'kv') {
                        var lblColor = isPressed ? '#fff' : '#6D6D6D';
                        HaxrcorpFont16.draw(ctx, row.label,
                            INNER_X + 5, rowAbsY + 1, lblColor);
                        var lblW = HaxrcorpFont16.textWidth(row.label);
                        var valStr = String(row.value);
                        var valMaxW = dynInnerW - 5 - lblW - INNER_LABEL_GAP - 2;
                        HaxrcorpFont16.draw(ctx, ellipsizeTo(valStr, valMaxW),
                            INNER_X + 5 + lblW + INNER_LABEL_GAP,
                            rowAbsY + 1, fg);
                    }
                }
                ctx.restore();

                if (selectedY >= 0 && pressedIdx !== selectedIdx) {
                    var sH = rowHeightOf(rows[selectedIdx]) + 2;
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(FRAME_X + 1, L.frameY + 1, FRAME_W - 2, L.frameH - 2);
                    ctx.clip();
                    listSelector.setSize(dynInnerW, sH);
                    listSelector.setPosition(INNER_X, selectedY - 1);
                    listSelector.render(canvas);
                    ctx.restore();
                }
            }
        };

        if (window.requestRender) window.requestRender();
    };

    VoiceRecorderScene.prototype.render = function(canvas) {
        // Refresh items every frame so the "playing" indicator on
        // saved-recording rows updates if playback toggles via
        // the modal underneath.
        this._buildItems();
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // Breadcrumb.
        var titles = (this.sceneManager && typeof this.sceneManager.breadcrumb === 'function')
            ? this.sceneManager.breadcrumb()
            : (this.breadcrumbTitle ? [this.breadcrumbTitle] : []);
        var trail = titles.length ? '> ' + titles.join(' > ') : '';
        if (trail) {
            HaxrcorpFont16.draw(canvas.ctx, trail,
                BREADCRUMB_X, BREADCRUMB_Y, '#CCCCCC');
        }

        var y = this.containerY;
        var selectedY = y;
        var TEXT_DY = 1;
        for (var i = 0; i < this.items.length; i++) {
            var item = this.items[i];
            if (item.kind === 'divider') {
                canvas.drawHLine(SELECTOR_X + 3, y + 1,
                    SELECTOR_W - 6, DIVIDER_COL);
                y += DIVIDER_ROW_H;
                continue;
            }
            if (i === this.selectedIndex) selectedY = y;
            var isSelected = (i === this.selectedIndex);

            // Saved-recording rows: name on left, "Playing"
            // marker on right when this row's file is the one
            // being played back. New-recording row: just label.
            var rowText = item.text;
            var rightTxt = '';
            if (item.file && this._playing === item.file) {
                rightTxt = 'Playing';
            }
            var rightW = rightTxt ? HaxrcorpFont16.textWidth(rightTxt) : 0;
            var rightX = SELECTOR_X + SELECTOR_W - rightW - STATUS_RIGHT_PAD - 8;
            // Ellipsise label so it can't collide with the
            // right-side marker (or the chevron-bar selector
            // when this row is highlighted).
            var labelMaxW = (rightTxt ? rightX : SELECTOR_X + SELECTOR_W - 12)
                          - (SELECTOR_X + TEXT_LEFT_PAD);
            var labelText = ellipsizeTo(rowText, labelMaxW);
            HaxrcorpFont16.draw(canvas.ctx, labelText,
                SELECTOR_X + TEXT_LEFT_PAD, y + TEXT_DY, '#000');
            if (rightTxt) {
                HaxrcorpFont16.draw(canvas.ctx, rightTxt,
                    SELECTOR_X + SELECTOR_W - rightW - STATUS_RIGHT_PAD - 8,
                    y + TEXT_DY, isSelected ? '#000' : '#999999');
            }

            y += ROW_H;
        }

        // Empty-state placeholder when there are no recordings
        // (only the New-recording sentinel exists). Sits below
        // the divider position so the layout reads as intentional.
        if (this._loaded && this._recordings.length === 0) {
            var msg = 'No recordings yet';
            HaxrcorpFont16.draw(canvas.ctx, msg,
                SELECTOR_X + TEXT_LEFT_PAD,
                this.containerY + ROW_H + DIVIDER_ROW_H + 6, '#999999');
        }

        // Selector frame on selected row.
        var selItem = this.items[this.selectedIndex];
        var useChevronFrame = !!(selItem && selItem.chevron);
        if (useChevronFrame) {
            this.chevronSelectorFrame.setPosition(SELECTOR_X, selectedY + SELECTOR_Y_OFFSET);
            this.chevronSelectorFrame.setSize(SELECTOR_W, SELECTOR_H);
            this.chevronSelectorFrame.render(canvas);
        } else {
            this.selectorFrame.setPosition(SELECTOR_X, selectedY + SELECTOR_Y_OFFSET);
            this.selectorFrame.setSize(SELECTOR_W, SELECTOR_H);
            this.selectorFrame.render(canvas);
        }

        if (this._modal) this._modal.render(canvas);
    };

    return VoiceRecorderScene;
})();

// ─────────────────────────────────────────────────────────────
// RecordingScene — active capture screen. Modal-styled card
// (TabHeader + ResponsiveFrame) with a blinking REC dot and
// MM:SS counter centred in the body. Triple coverage on stop:
//   • exit()                    ← scene pop
//   • pagehide                  ← tab close, /api/version reload, TTY switch
//   • beforeunload              ← dev-browser navigation
// All paths POST /api/record/stop; the server is idempotent.
// ─────────────────────────────────────────────────────────────
var RecordingScene = (function() {
    var SCREEN_PAD       = 4;
    var TAB_H            = 16;
    var FRAME_BOTTOM_Y   = 128;
    var FRAME_X          = SCREEN_PAD;
    var FRAME_W          = 256 - SCREEN_PAD * 2;
    var FRAME_TOP_Y      = SCREEN_PAD + TAB_H + 4;     // a touch below the tab
    var FRAME_H          = FRAME_BOTTOM_Y - FRAME_TOP_Y;

    function pad2(n) { return n < 10 ? '0' + n : String(n); }

    function RecordingScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Recording';
        this.breadcrumbTitle = 'Recording';

        // 'starting' → 'recording' → ('done' on error). We never
        // transition to 'done' on a successful start; the user
        // ends the recording by popping the scene.
        this.state         = 'starting';
        this.startedAt     = 0;
        this.elapsedMs     = 0;
        this.error         = '';
        this.filename      = '';
        this._tickHandle   = null;
        this._unloadHandler = null;
        // Real-time mic level (0..1, peak amplitude over the
        // last ~100 ms). Updated by the SSE subscription below.
        // `_levelPeakHold` decays slowly on top of the live
        // value so the user can spot transients even when the
        // bar's settling cadence is faster than the eye.
        this._level        = 0;
        this._levelPeakHold = 0;
        this._levelPeakAt   = 0;
        this._levelES      = null;
        this._tab          = new UI.TabHeader('Recording');
        this._tab.x = FRAME_X;
        this._tab.y = SCREEN_PAD;
        this._tab.h = TAB_H;
    }

    RecordingScene.prototype.enter = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/start', true);
            xhr.timeout = 5000;
            xhr.onload = function() {
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        if (data && data.success) {
                            self.state     = 'recording';
                            self.startedAt = Date.now();
                            self.filename  = data.file || '';
                            if (window.requestRender) window.requestRender();
                            return;
                        }
                        self.error = (data && data.error) || 'Start failed';
                    } catch (e) { self.error = 'Start failed'; }
                } else {
                    try {
                        var ed = JSON.parse(xhr.responseText);
                        self.error = (ed && ed.error) || ('HTTP ' + xhr.status);
                    } catch (e) { self.error = 'HTTP ' + xhr.status; }
                }
                self.state = 'done';
                if (window.requestRender) window.requestRender();
            };
            xhr.onerror   = function() { self.state = 'done'; self.error = 'Network error';   if (window.requestRender) window.requestRender(); };
            xhr.ontimeout = function() { self.state = 'done'; self.error = 'Start timed out'; if (window.requestRender) window.requestRender(); };
            xhr.send();
        } catch (e) {
            self.state = 'done';
            self.error = String(e.message || e);
        }

        // 250 ms tick. Drives both the counter and the blinking
        // REC dot's redraw cadence. The dot's visibility is
        // wall-clock-phased (every 500 ms) so a missed redraw
        // doesn't drift the visual rhythm.
        this._tickHandle = setInterval(function() {
            if (self.state === 'recording') {
                self.elapsedMs = Date.now() - self.startedAt;
                if (window.requestRender) window.requestRender();
            }
        }, 250);

        // Page-unload safety net — stop the recording on every
        // path the page can disappear down. sendBeacon is the
        // durable cross-engine option; fetch with keepalive
        // isn't supported in the Cog WebKit build this device
        // runs.
        this._unloadHandler = function() {
            try { navigator.sendBeacon('/api/record/stop'); } catch (e) {}
        };
        window.addEventListener('pagehide',     this._unloadHandler);
        window.addEventListener('beforeunload', this._unloadHandler);

        // Real-time level meter — same SSE pattern the touchpad
        // stream uses. Each `data: <float>` message updates the
        // current level. We keep a separate peak-hold value that
        // tracks the maximum the level reached recently, decayed
        // every redraw — gives the meter a satisfying "hold then
        // fall" indicator without interpreting it as a delayed
        // baseline.
        try {
            this._levelES = new EventSource('/api/record/level');
            this._levelES.onmessage = function(e) {
                var v = parseFloat(e.data);
                if (isNaN(v) || v < 0) v = 0;
                if (v > 1) v = 1;
                self._level = v;
                if (v >= self._levelPeakHold) {
                    self._levelPeakHold = v;
                    self._levelPeakAt   = Date.now();
                }
                if (window.requestRender) window.requestRender();
            };
            this._levelES.onerror = function() { /* tolerate dropouts */ };
        } catch (e) { this._levelES = null; }
    };

    RecordingScene.prototype.exit = function() {
        if (this._tickHandle) {
            clearInterval(this._tickHandle);
            this._tickHandle = null;
        }
        if (this._unloadHandler) {
            window.removeEventListener('pagehide',     this._unloadHandler);
            window.removeEventListener('beforeunload', this._unloadHandler);
            this._unloadHandler = null;
        }
        if (this._levelES) {
            try { this._levelES.close(); } catch (e) {}
            this._levelES = null;
        }
        // Always POST stop — server is idempotent so this is
        // safe even if the recording never started.
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/record/stop', true);
            xhr.timeout = 5000;
            xhr.send();
        } catch (e) { /* best effort */ }
    };

    RecordingScene.prototype.handleInput = function(action) {
        // Any commit-ish key stops the recording. Listed
        // explicitly so the intent reads cleanly.
        if (action === 'ok' || action === 'back' || action === 'esc' || action === 'run') {
            return 'pop';
        }
    };

    RecordingScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // Tab + frame body — same shell language as the Wi-Fi
        // modals, but rendered directly in the scene (no overlay
        // dim) since there's no underlying page to peek through.
        this._tab.render(canvas);
        var frame = new ResponsiveFrame({
            x: FRAME_X, y: FRAME_TOP_Y,
            width: FRAME_W, height: FRAME_H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true,
            fillColor: '#ffffff', showFill: true,
            cornerRadius: 3,
            corners: { tl: false, tr: true, bl: true, br: true }
        });
        frame.render(canvas);

        if (this.state === 'starting') {
            var s1 = 'Starting…';
            var s1W = HaxrcorpFont16.textWidth(s1);
            HaxrcorpFont16.draw(ctx, s1,
                FRAME_X + Math.floor((FRAME_W - s1W) / 2),
                FRAME_TOP_Y + Math.floor((FRAME_H - 11) / 2), '#000');
            return;
        }
        if (this.state === 'done') {
            var s2  = 'Failed';
            var s2W = HaxrcorpFont16.textWidth(s2);
            HaxrcorpFont16.draw(ctx, s2,
                FRAME_X + Math.floor((FRAME_W - s2W) / 2),
                FRAME_TOP_Y + 10, '#000');
            var msg = this.error || '(no detail)';
            if (msg.length > 38) msg = msg.substring(0, 37) + '…';
            var emW = HaxrcorpFont16.textWidth(msg);
            HaxrcorpFont16.draw(ctx, msg,
                FRAME_X + Math.floor((FRAME_W - emW) / 2),
                FRAME_TOP_Y + 26, '#999999');
            HaxrcorpFont16.draw(ctx, '[Back]',
                FRAME_X + 6, FRAME_TOP_Y + FRAME_H - 14, '#999999');
            return;
        }

        // 'recording' state — main display.
        // 1) Big timer MM:SS centered horizontally.
        var totalSec = Math.floor(this.elapsedMs / 1000);
        var mm = Math.floor(totalSec / 60);
        var ss = totalSec % 60;
        var timerStr = pad2(mm) + ':' + pad2(ss);
        // We don't have a big-font glyph stack so HaxrcorpFont16
        // drawn at a y-offset acts as the "headline". Centred.
        var timerW = HaxrcorpFont16.textWidth(timerStr);
        var timerY = FRAME_TOP_Y + 14;
        HaxrcorpFont16.draw(ctx, timerStr,
            FRAME_X + Math.floor((FRAME_W - timerW) / 2),
            timerY, '#000');

        // 2) Blinking REC indicator above the timer. Wall-clock
        // phased so the cadence is stable across redraw skips.
        var dotOn = (Math.floor(Date.now() / 500) % 2) === 0;
        var label = 'REC';
        var lblW  = HaxrcorpFont16.textWidth(label);
        var dotR  = 3;
        var dotGap = 4;
        var groupW = (dotR * 2) + dotGap + lblW;
        var groupX = FRAME_X + Math.floor((FRAME_W - groupW) / 2);
        var groupY = FRAME_TOP_Y + 1;
        if (dotOn) {
            // Filled red-ish dot. We're monochrome so just black.
            ctx.fillStyle = '#000';
            ctx.fillRect(groupX, groupY + 2, dotR * 2, dotR * 2);
        }
        HaxrcorpFont16.draw(ctx, label,
            groupX + (dotR * 2) + dotGap, groupY, '#000');

        // 3) Mic level meter. Outlined rectangle filled black
        // proportional to the current peak level, with a 1-px
        // peak-hold tick that decays. Centred horizontally,
        // ~16 px below the timer.
        var lvl = this._level || 0;
        if (lvl < 0) lvl = 0;
        if (lvl > 1) lvl = 1;
        // Gentle log-ish curve so quiet voice doesn't read as
        // "barely moving". Math.sqrt is a cheap stand-in for a
        // proper dB scale and looks fine for a UI meter.
        var disp = Math.sqrt(lvl);
        // Decay the peak-hold by 0.5 / second after the last
        // peak update. Snaps the indicator back if the user
        // stops talking.
        var now = Date.now();
        var decay = (now - this._levelPeakAt) / 1000 * 0.5;
        var peak = this._levelPeakHold - decay;
        if (peak < disp) peak = disp;
        if (peak < 0)    peak = 0;
        if (peak > 1)    peak = 1;
        this._levelPeakHold = peak;
        this._levelPeakAt   = now;

        var barW = 200;
        var barH = 8;
        var barX = FRAME_X + Math.floor((FRAME_W - barW) / 2);
        var barY = timerY + 18;
        canvas.drawFrame(barX, barY, barW, barH, '#000');
        var fillW = Math.floor((barW - 2) * disp);
        if (fillW > 0) {
            ctx.fillStyle = '#000';
            ctx.fillRect(barX + 1, barY + 1, fillW, barH - 2);
        }
        // Peak-hold tick: 1 px vertical line at the recent
        // maximum's position, sat just inside the inner area.
        var peakX = barX + 1 + Math.floor((barW - 2) * Math.sqrt(peak)) - 1;
        if (peakX < barX + 1)             peakX = barX + 1;
        if (peakX > barX + barW - 2)      peakX = barX + barW - 2;
        ctx.fillStyle = '#000';
        ctx.fillRect(peakX, barY + 1, 1, barH - 2);

        // 4) Hint + stop affordance at the bottom of the frame.
        var hint = 'Press OK or Back to stop';
        var hintW = HaxrcorpFont16.textWidth(hint);
        HaxrcorpFont16.draw(ctx, hint,
            FRAME_X + Math.floor((FRAME_W - hintW) / 2),
            FRAME_TOP_Y + FRAME_H - 14, '#999999');
    };

    return RecordingScene;
})();
