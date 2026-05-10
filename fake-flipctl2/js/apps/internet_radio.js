/**
 * InternetRadioScene
 *
 * Skeleton for the Internet radio app. Right now it just paints
 * the standard chrome (status bar + a centred placeholder
 * label) and registers with the App Switcher so the entry shows
 * up there alongside the other apps. UI + station list + audio
 * wiring will land in subsequent passes — this commit just
 * stakes out the menu entry and the scene class.
 */
var InternetRadioScene = (function() {
    // Selector geometry — 252 px wide × 16 px tall outline that
    // wraps whichever MenuDropdownLine row is currently
    // highlighted. Width takes the full canvas minus 2 px on
    // each side; the row's content (chip + label) sits centred
    // inside that 16-tall band.
    var SELECTOR_X = 2;
    var SELECTOR_W = 252;
    var SELECTOR_H = 15;

    function InternetRadioScene(sceneManager) {
        this.sceneManager  = sceneManager || null;
        // App Switcher reads `displayName` for its title bar and
        // RunningApps uses it as the dedup key when re-launching.
        this.displayName   = 'Internet radio';
        this.breadcrumbTitle = 'Internet radio';
        // Tells main.js's Tab handler this scene is an app —
        // suppresses the transient-snapshot path that would
        // otherwise add a duplicate card to the switcher and
        // trigger the slide-up-from-bottom intro animation.
        this._isApp        = true;
        // Static-PNG fallback for the App Switcher card. Real
        // apps replace this with a runtime snapshot in exit().
        this.icon          = (typeof Icons !== 'undefined' && Icons.tv_media_box)
                                ? Icons.tv_media_box : null;
        this.imagePath     = null;

        // Currently-highlighted dropdown row. Indexes into
        // `_buildRows()` below. Reset to 0 (first row) on
        // construction; up/down keys move it.
        this.selectedIndex = 0;
        // Volume slider state — integer 0..100. Adjusted in
        // 5-unit steps via left/right when the Volume row is
        // selected. Drives both the displayed `xx%` text and
        // the proportional fill (volume / 100) on the chip.
        this._volume = 50;
        this._volumeStep = 5;

        // Stations per city. The Station picker's options are
        // derived from this map at run time — switching the
        // city refreshes the list (see `_refreshStationList`),
        // and any current station that isn't in the new city's
        // list falls back to the new city's first station.
        // Hard-coded for now; trivial to swap for a server-
        // backed lookup later (the same `_refreshStationList`
        // path becomes async).
        this._stationsByCity = {
            'London':     ['London Capital', 'BBC Radio 1', 'Heart London',
                           'Magic FM',       'Kiss FM',     'Smooth London'],
            'Manchester': ['BBC Radio Manchester', 'Capital Manchester',
                           'Hits Radio', 'XS Manchester'],
            'Edinburgh':  ['Forth 1', 'Capital Edinburgh', 'BBC Radio Scotland'],
            'New York':   ['WNYC 93.9', 'Z100', '103.5 KTU', 'Hot 97'],
            'Tokyo':      ['J-Wave', 'Tokyo FM', 'NHK Radio 1', 'InterFM 89.7'],
            'Berlin':     ['Radio Eins', '104.6 RTL', 'Berliner Rundfunk',
                           'Antenne Brandenburg']
        };

        // Picker rows. Each entry has an `options` array + a
        // `current` value; the matching row in `_buildRows`
        // pulls its display value from `current` and tags
        // itself with the picker's key so OK can route to the
        // right dropdown. The Station picker starts empty —
        // `_refreshStationList()` below seeds it from the
        // initial city's list so the constructor leaves the
        // state in a consistent shape.
        this._pickers = {
            city: {
                options: ['London', 'Manchester', 'Edinburgh',
                          'New York', 'Tokyo', 'Berlin'],
                current: 'London'
            },
            station: {
                options: [],
                current: ''
            },
            audioDevice: {
                options: ['HDMI', '3.5 mm Audio', 'Onboard speaker'],
                current: 'HDMI'
            }
        };
        this._refreshStationList();
        // Dropdown overlay state. `_dropdownKey` names which
        // picker is open ('city' / 'station' / 'audioDevice');
        // null = closed. `_dropdownIndex` is the highlighted
        // option within that picker's list.
        this._dropdownOpen   = false;
        this._dropdownKey    = null;
        this._dropdownIndex  = 0;

        // Reusable selector outline — same shape the Wi-Fi page
        // uses for non-chevron rows: 1-px black stroke, no fill.
        this._selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X, y: 0,
            width: SELECTOR_W, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
    }

    // Sync the Station picker's options + current value to the
    // currently-selected city. Called once in the constructor
    // (to seed) and after any city change. If the current
    // station isn't valid for the new city, snap to the new
    // city's first station so the row never points at a
    // station that doesn't exist there.
    InternetRadioScene.prototype._refreshStationList = function() {
        var cityName = this._pickers.city.current;
        var list = this._stationsByCity[cityName] || [];
        this._pickers.station.options = list;
        if (list.indexOf(this._pickers.station.current) < 0) {
            this._pickers.station.current = list[0] || '';
        }
    };

    // Single source of truth for the dropdown rows. Returned
    // fresh on every render so future state-driven changes
    // (selected city / station, fetched lists) flow through
    // automatically. Each entry: { title, value, slider? }.
    // `slider` (0..1) flips the row's chip into a horizontal
    // progress bar with split-colour text — used here for the
    // Volume control.
    InternetRadioScene.prototype._buildRows = function() {
        // Volume row reads the current `_volume` so the chip's
        // fill + text track keypress adjustments in real time.
        // Rows after the first three sit BELOW the divider; the
        // render loop handles the y-offset for any index >=
        // DIVIDER_AFTER.
        var v = this._volume;
        return [
            { title: 'City',         value: this._pickers.city.current,        pickerKey: 'city' },
            { title: 'Station',      value: this._pickers.station.current,     pickerKey: 'station' },
            { title: 'Volume',       value: v + '%', slider: v / 100, isVolume: true },
            { title: 'Audio device', value: this._pickers.audioDevice.current, pickerKey: 'audioDevice' }
        ];
    };

    InternetRadioScene.prototype.enter = function() {
        // Register the launch with the global recents stack so
        // the App Switcher picks it up on the next Tab. The
        // 4th `factoryFn` argument is critical for non-
        // PlaceholderAppScene apps: when the user picks our
        // card from the switcher to re-enter the app, the
        // switcher uses this factory to instantiate a fresh
        // scene. Without it, the switcher falls back to
        // `new PlaceholderAppScene(imagePath, ...)` — and our
        // `imagePath` is null, so the result is a blank canvas.
        if (typeof RunningApps !== 'undefined') {
            RunningApps.open(this.displayName, this.imagePath, this.icon,
                function(sm) { return new InternetRadioScene(sm); });
        }
    };

    InternetRadioScene.prototype.exit = function() {
        // Snapshot what the user last saw so the App Switcher
        // card uses our actual frame instead of a static asset.
        // The `_lastRenderedScene` guard keeps us from grabbing
        // the App Switcher's own frame when we're popping
        // because the user picked another app from there.
        var canvasEl = document.getElementById('screen');
        var ownsCanvas = (window._lastRenderedScene === this);
        if (ownsCanvas && canvasEl && typeof RunningApps !== 'undefined') {
            var snap = document.createElement('canvas');
            snap.width  = canvasEl.width;
            snap.height = canvasEl.height;
            snap.getContext('2d').drawImage(canvasEl, 0, 0);
            RunningApps.setSnapshot(this.displayName, snap);
        }
    };

    InternetRadioScene.prototype.handleInput = function(action) {
        // Dropdown owns input while open: up/down cycles its
        // items, OK commits the selection (and closes), back/
        // esc cancels. Same flow regardless of which picker is
        // open — the active picker's options + current value
        // are pulled from `_pickers[_dropdownKey]`.
        if (this._dropdownOpen) {
            var picker = this._pickers[this._dropdownKey];
            if (!picker) {
                this._dropdownOpen = false;
                this._dropdownKey  = null;
                return;
            }
            if (action === 'back' || action === 'esc') {
                this._dropdownOpen = false;
                this._dropdownKey  = null;
                return;
            }
            if (action === 'down') {
                this._dropdownIndex =
                    (this._dropdownIndex + 1) % picker.options.length;
                return;
            }
            if (action === 'up') {
                this._dropdownIndex =
                    (this._dropdownIndex - 1 + picker.options.length)
                        % picker.options.length;
                return;
            }
            if (action === 'ok' || action === 'run') {
                picker.current = picker.options[this._dropdownIndex];
                // City change cascades into the Station list:
                // its options refresh + its current value snaps
                // to the new city's default if the previous
                // station doesn't exist there.
                if (this._dropdownKey === 'city') {
                    this._refreshStationList();
                }
                this._dropdownOpen = false;
                this._dropdownKey  = null;
                return;
            }
            return;
        }

        if (action === 'back' || action === 'esc') return 'pop';
        var rows = this._buildRows();
        var n = rows.length;
        if (n === 0) return;
        if (action === 'down') {
            this.selectedIndex = (this.selectedIndex + 1) % n;
            return;
        }
        if (action === 'up') {
            this.selectedIndex = (this.selectedIndex - 1 + n) % n;
            return;
        }
        // Left / right adjusts the slider on rows flagged
        // `isVolume`. Future picker rows (City, Station) can
        // hook the same actions with their own handlers; we
        // only special-case Volume here for now.
        if (action === 'left' || action === 'right') {
            var sel = rows[this.selectedIndex];
            if (sel && sel.isVolume) {
                var delta = (action === 'right') ? this._volumeStep : -this._volumeStep;
                this._volume += delta;
                if (this._volume < 0)   this._volume = 0;
                if (this._volume > 100) this._volume = 100;
                return;
            }
        }
        // OK on any row tagged with `pickerKey` opens that
        // picker's dropdown. Highlight starts on the currently-
        // selected option so the user can confirm without
        // thinking; falls back to the first item if the stored
        // value is no longer in the list.
        if (action === 'ok' || action === 'run') {
            var selRow = rows[this.selectedIndex];
            if (selRow && selRow.pickerKey
                    && this._pickers[selRow.pickerKey]) {
                var picker2 = this._pickers[selRow.pickerKey];
                var idx     = picker2.options.indexOf(picker2.current);
                this._dropdownIndex = idx >= 0 ? idx : 0;
                this._dropdownKey   = selRow.pickerKey;
                this._dropdownOpen  = true;
                return;
            }
        }
    };

    InternetRadioScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        // Standard status bar across the top — battery / wifi /
        // etc. stay visible on this scene.
        UI.drawStatusBar(canvas, '');

        // ── Title header ─────────────────────────────────────
        // Full-width, 16 px tall, #D9D9D9 fill, anchored
        // immediately below the status bar (no gap). Carries
        // the app's name in Born2bSportyV2Medium — bigger /
        // chunkier than the standard HaxrcorpFont16 the rest
        // of the system uses, gives the app screen its own
        // "title bar" look.
        var ctx     = canvas.ctx;
        var TITLE_H = 16;
        var TITLE_Y = UI.STATUS_BAR_H;             // flush against the status bar
        ctx.fillStyle = '#D9D9D9';
        ctx.fillRect(0, TITLE_Y, canvas.w, TITLE_H);

        // Title text — 18 px in from the left, 1 px below the
        // status bar's bottom edge. Born2bSporty's glyph cell
        // is 18 rows with the visible cap starting around
        // row 2, so a draw-y of (status bar bottom + 1) lands
        // the cap visually 1 px tighter against the status bar
        // boundary than the previous +2 baseline.
        var TITLE_X = 18;
        var TITLE_TEXT_Y = UI.STATUS_BAR_H + 1;
        Born2bSportyV2Medium.draw(ctx, 'Internet radio',
            TITLE_X, TITLE_TEXT_Y, '#000');

        // ── Body: stacked MenuDropdownLine rows ───────────────
        // The first DIVIDER_AFTER rows sit ABOVE the divider,
        // stacking flush below the title bar at HEIGHT + ROW_GAP
        // pitch. Anything after DIVIDER_AFTER drops below the
        // divider line, with its own anchor at
        // dividerY + 1 + DIVIDER_PAD_AFTER (3 px breathing
        // gap), and stacks at the same pitch from there.
        var ROW_GAP             = 3;
        var bodyTop             = TITLE_Y + TITLE_H;
        var rowPitch            = MenuDropdownLine.HEIGHT + ROW_GAP;
        var DIVIDER_PAD_X       = 5;
        var DIVIDER_OFFSET_Y    = 49;     // 47 → 49: 2 px lower so it
                                          // clears the Volume chip's
                                          // bottom edge cleanly.
        var DIVIDER_AFTER       = 3;             // rows 0..2 above, 3+ below
        var DIVIDER_PAD_AFTER   = 3;             // gap below divider before next row
        var dividerY            = bodyTop + DIVIDER_OFFSET_Y;
        var belowDividerAnchor  = dividerY + 1 + DIVIDER_PAD_AFTER;
        function rowYAt(i) {
            if (i < DIVIDER_AFTER) return bodyTop + i * rowPitch;
            return belowDividerAnchor + (i - DIVIDER_AFTER) * rowPitch;
        }

        var rows      = this._buildRows();
        var selectedY = bodyTop;
        for (var i = 0; i < rows.length; i++) {
            var rowY = rowYAt(i);
            new MenuDropdownLine({
                y:        rowY,
                title:    rows[i].title,
                value:    rows[i].value,
                slider:   (typeof rows[i].slider === 'number') ? rows[i].slider : null,
                selected: (i === this.selectedIndex)
            }).render(canvas);
            if (i === this.selectedIndex) selectedY = rowY;
        }

        // ── Divider rule ──────────────────────────────────────
        // Horizontal hairline 47 px below the title bar's bottom
        // edge, inset 5 px from each canvas edge. Sits between
        // the settings stack above and the Audio device row
        // (and whatever else lands) below.
        canvas.drawHLine(
            DIVIDER_PAD_X,
            dividerY,
            canvas.w - DIVIDER_PAD_X * 2,
            '#CCCCCC');

        // Selector outline — 16 px tall, dropped 1 px below the
        // row's top y so it visually centres on the chip /
        // label baseline rather than riding flush with the
        // anchor. Suppressed while the dropdown is open — the
        // dropdown is the user's only focus then; doubling up
        // with the page-level outline reads as "two things
        // selected at once".
        if (!this._dropdownOpen) {
            this._selectorFrame.setPosition(SELECTOR_X, selectedY + 1);
            this._selectorFrame.setSize(SELECTOR_W, SELECTOR_H);
            this._selectorFrame.render(canvas);
        }

        // ── Dropdown overlay ──────────────────────────────────
        // Drawn LAST (and only when open) so it sits on top of
        // the page chrome. Other elements fade out via a
        // semi-transparent white wash; the dropdown itself
        // paints crisp on top so the user's eye locks onto it.
        if (this._dropdownOpen && this._dropdownKey) {
            // Find the row owning the active picker so we can
            // anchor the dropdown's top edge to that row's chip.
            var rowsAll  = this._buildRows();
            var dropIdx  = -1;
            for (var ri = 0; ri < rowsAll.length; ri++) {
                if (rowsAll[ri].pickerKey === this._dropdownKey) {
                    dropIdx = ri; break;
                }
            }
            if (dropIdx >= 0) {
                var rowAnchor = rowYAt(dropIdx);
                var chipX     = canvas.w
                              - MenuDropdownLine.CHIP_WIDTH
                              - 5;                          // matches CHIP_RIGHT_PAD
                var chipY     = rowAnchor + MenuDropdownLine.TOP_PAD;
                this._renderDropdown(canvas, chipX, chipY,
                    rowsAll[dropIdx].title);
            }
        }
    };

    // ── Dropdown picker ──────────────────────────────────────
    // Rectangle anchored at the Audio device chip's top-left.
    // Width matches the chip; height = 13 × N + (N − 1) + 2
    // (per-line content + dividers between items + 1 px stroke
    // top + bottom). For N = 3 that's exactly 43 px, matching
    // the spec.
    //
    // Visual layering:
    //   1. Semi-transparent white wash covers the whole canvas
    //      so non-dropdown elements fade out — the user's
    //      attention should land on the picker only.
    //   2. Gray-fill ResponsiveFrame as the dropdown body.
    //   3. Item labels stacked vertically, separated by 1-px
    //      light-gray dividers.
    //   4. MenuSelectorFrame outline (one item wide) wrapping
    //      the highlighted row inside the dropdown.
    InternetRadioScene.prototype._renderDropdown = function(canvas, chipX, chipY, rowTitle) {
        var ctx     = canvas.ctx;
        var picker  = this._pickers[this._dropdownKey];
        if (!picker) return;
        var options = picker.options;
        var ITEM_H  = 13;
        var DIV_H   = 1;
        var W       = MenuDropdownLine.CHIP_WIDTH;     // 180
        var n       = options.length;
        var H       = ITEM_H * n + DIV_H * (n - 1) + 2; // +2 for top + bottom strokes

        // Wash everything else out — same alpha the verbose
        // wifi modals use, gives a clear "this is modal" cue.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        // Re-draw the active row's title in solid black on top
        // of the wash so it stays crisp instead of fading out
        // with the rest of the page. Visually anchors the user
        // — "you're picking the value for THIS row". Title
        // string is passed in by the caller so the dropdown
        // renderer doesn't need to know which picker is active.
        // Coords mirror MenuDropdownLine's title position
        // (TITLE_X = 6, draw-y = chipY since chipY already
        // equals row.y + TOP_PAD).
        if (rowTitle) {
            HaxrcorpFont16.draw(ctx, rowTitle, 6, chipY, '#000');
        }

        // Body. Same fill colour as the original chip so the
        // dropdown reads as "the chip grew downward to reveal
        // its options"; same 3 px corner radius. No stroke —
        // the chip background didn't have one either, and the
        // strokeless silhouette keeps the dropdown reading as
        // a continuation of the chip rather than a new boxed
        // modal.
        var body = new ResponsiveFrame({
            x: chipX, y: chipY,
            width: W, height: H,
            anchorH: 'left', anchorV: 'top',
            showStroke: false,
            showFill:   true, fillColor: MenuDropdownLine.CHIP_FILL,
            cornerRadius: 3,
            corners: { tl: true, tr: true, bl: true, br: true }
        });
        body.render(canvas);

        // Items + per-row dividers. Items render as black
        // HaxrcorpFont16 centred horizontally; each item's
        // block is ITEM_H tall, with a 1-px divider after it
        // (except the last). Top stroke = row 0; first item
        // sits at row 1.
        var selectedItemY = chipY + 1;   // default: first item
        for (var i = 0; i < n; i++) {
            var itemY = chipY + 1 + i * (ITEM_H + DIV_H);
            // Centred label.
            var label = String(options[i]);
            var labelW = HaxrcorpFont16.textWidth(label);
            // 13-tall row with 11-tall font: cap top sits 1 px
            // from the row top.
            HaxrcorpFont16.draw(ctx, label,
                chipX + Math.floor((W - labelW) / 2),
                itemY + 1, '#000');
            if (i === this._dropdownIndex) selectedItemY = itemY;
            // Divider between items (not after the last).
            if (i < n - 1) {
                canvas.drawHLine(chipX + 1, itemY + ITEM_H,
                    W - 2, '#999999');
            }
        }

        // Selector outline around the highlighted item — same
        // shape as the page-level selector but shrunk to the
        // dropdown's width.
        if (!this._dropdownInnerSelector) {
            this._dropdownInnerSelector = new MenuSelectorFrame({
                x: 0, y: 0, width: 1, height: ITEM_H + 2,
                anchorH: 'left', anchorV: 'top',
                strokeColor: '#000', showStroke: true, showFill: false
            });
        }
        // Selector inset by 1 px on the right so the BR shadow
        // pixels MenuSelectorFrame paints don't run past the
        // dropdown's body — keeps the highlight tucked inside
        // the dropdown silhouette instead of poking out.
        this._dropdownInnerSelector.setPosition(chipX, selectedItemY - 1);
        this._dropdownInnerSelector.setSize(W - 1, ITEM_H + 2);
        this._dropdownInnerSelector.render(canvas);
    };

    return InternetRadioScene;
})();
