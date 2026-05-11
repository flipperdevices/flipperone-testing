/**
 * WifiScene
 *
 * Two-line settings page reached from Network → Wi-Fi:
 *
 *   > Network > Wi-Fi
 *   ┌─────────────────────────────────┐
 *   │ Wi-Fi               < ON >      │
 *   ├─────────────────────────────────┤
 *   │ See visible networks            │
 *   └─────────────────────────────────┘
 *
 * Differences from SubMenuScene that warranted a custom scene:
 *   - Breadcrumb shows the full path "> Network > Wi-Fi" (two
 *     levels) rather than the generic single-title breadcrumb.
 *   - Rows render in HaxrcorpFont16 throughout — no font swap on
 *     selection — and carry no icons.
 *   - Compact two-row layout, no scrollbar.
 *
 * Inputs:
 *   - up / down — move selection (wraps).
 *   - left / right / ok — toggles the Wi-Fi power on the first
 *     row; on the second row, runs onPress (TODO: open the
 *     visible-networks list, not wired yet).
 *   - back / esc — pop the scene.
 */
var WifiScene = (function() {
    var BREADCRUMB_X  = 4;
    var BREADCRUMB_Y  = UI.STATUS_BAR_H + 2;

    // Quality (0-100) → 7×7 sprite. Same thresholds the status
    // bar's wifiIcon helper uses (UI.js line ~213) so a network
    // listed in the modal renders with the exact same icon it'd
    // show in the bar if connected.
    function signalIconFor(quality) {
        if (quality >= 80) return Icons.wifi_100;
        if (quality >= 60) return Icons.wifi_75;
        if (quality >= 40) return Icons.wifi_50;
        if (quality >= 20) return Icons.wifi_25;
        return Icons.wifi_0;
    }

    // Security tag for the right-side label. nmcli's `-f SECURITY`
    // output emits a space-separated list of every protection mode
    // a network advertises — e.g. "WPA2", "WPA1 WPA2", "WPA2 WPA3",
    // "WEP", "802.1X" (enterprise), or "" for open networks. We
    // pick the strongest WPA generation present and append an
    // "-E" suffix when the network also advertises 802.1X
    // (enterprise authentication on top of the WPA cipher) so a
    // mixed-mode AP renders as e.g. "WPA2-E".
    function securityLabel(sec) {
        if (!sec) return '';
        var s = sec.toUpperCase();
        var enterprise = s.indexOf('802.1X') >= 0;
        var ver = null;
        if      (s.indexOf('WPA3') >= 0) ver = 'WPA3';
        else if (s.indexOf('WPA2') >= 0) ver = 'WPA2';
        else if (s.indexOf('WPA1') >= 0) ver = 'WPA1';
        else if (s.indexOf('WPA')  >= 0) ver = 'WPA';
        if (ver) return enterprise ? ver + '-E' : ver;
        if (s.indexOf('WEP') >= 0) return 'WEP';
        if (enterprise)             return '802.1X';
        return '*';   // unknown but non-empty — mark as secured
    }

    // Truncate `text` so its rendered width doesn't exceed `maxW`.
    // Appends an ellipsis when truncation actually happens.
    function ellipsizeTo(text, maxW) {
        if (maxW <= 0) return '';
        if (HaxrcorpFont16.textWidth(text) <= maxW) return text;
        var ell = '…';
        var ellW = HaxrcorpFont16.textWidth(ell);
        if (ellW > maxW) return '';
        var s = text;
        while (s.length > 0 &&
               HaxrcorpFont16.textWidth(s) + ellW > maxW) {
            s = s.slice(0, -1);
        }
        return s + ell;
    }

    // Selector chrome — 4 px from each canvas edge, 2 px taller
    // than the row itself for 1 px of breathing room above and
    // below. SELECTOR_Y_OFFSET = -1 anchors that breathing room
    // symmetrically around the row.
    var SELECTOR_X        = 4;
    var SELECTOR_W        = 247;
    var ROW_H             = 13;       // compact row, no icons
    var SELECTOR_H        = ROW_H + 2;  // 1 px above + 1 px below
    var SELECTOR_Y_OFFSET = -1;
    var DIVIDER_COL       = '#CCCCCC';
    // Container starts 16 px below the status bar (matches
    // SubMenuScene). Inner padding for the row text — 5 px so the
    // label sits comfortably inside the selector frame's left
    // edge with a touch of breathing room past the rounded corner.
    var CONTAINER_Y_OFFSET = 16;
    var TEXT_LEFT_PAD      = 5;
    // Status text right-aligns 5 px from the selector's right
    // edge, matching MenuLine's STATUS_PAD_R convention.
    var STATUS_RIGHT_PAD   = 5;
    // Toggle chevron spacing. Mirrors MenuLine's `< ON >` /
    // `< OFF >` rendering for a consistent toggle look.
    var TOGGLE_SPACING     = 15;

    function WifiScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Wi-Fi';
        // Used by the App Switcher's title-bar fallback.
        this.breadcrumbTitle = 'Wi-Fi';

        this.containerY    = UI.STATUS_BAR_H + CONTAINER_Y_OFFSET;
        this.selectedIndex = 0;
        this._arrowPressed = null;   // 'left' / 'right' on the toggle row, briefly

        // The items list is REBUILT every render via `_buildItems`
        // so the connected-network row (between the Wi-Fi toggle
        // and "See visible networks") appears / disappears as the
        // active connection changes. Item shape:
        //   text       — label (drawn left-aligned via Haxrcorp).
        //   getStatus  — optional, returns a string to render
        //                right-aligned. Used by the toggle row.
        //   isToggle   — true when the row should render
        //                "< ON >" / "< OFF >" with chevrons while
        //                selected, and just "ON" / "OFF" while
        //                idle.
        //   chevron    — appends a `>` drill-in affordance.
        //   onToggle   — flips the underlying state. Bound to
        //                left / right / ok on toggle rows.
        //   onPress    — non-toggle row's primary action (ok/run).
        this.items = [];
        this._buildItems();

        // Active modal — when non-null, render() draws it on top
        // of the page and handleInput routes to its handler.
        this._modal = null;
        // Real visible-networks list, populated by polling
        // /api/wifi/scan in enter(). Stays empty until the first
        // response lands; the modal renders a loading spinner in
        // that gap.
        this._visibleNetworks = [];
        // True after the first successful /api/wifi/scan response
        // (regardless of how many networks it returned). Lets the
        // modal distinguish "waiting" (show spinner) from "scan
        // came back empty" (show 'No networks' placeholder).
        this._scanLoaded = false;
        // While the modal is open, this 80-ms ticker calls
        // requestRender so the spinner sprite cycles its 8 frames.
        // Cleared on modal close + scene exit.
        this._modalAnimTimer = null;
        // Modal list selection / scroll state. Reset every time
        // the modal opens (in `_openNetworksModal`); kept on the
        // scene so all three call sites — input handler, render,
        // press-flash timeout — see the same values.
        this._modalSelected = 0;
        this._modalScroll   = 0;
        this._modalPressed  = -1;

        // Toggle row uses the thin MenuSelectorFrame (no chevron
        // — the toggle status fills the right side instead).
        this.selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X,
            y: 0,
            width: SELECTOR_W,
            height: SELECTOR_H,
            anchorH: 'left',
            anchorV: 'top',
            strokeColor: '#000',
            showStroke: true,
            showFill: false
        });
        // Chevron rows (connected-network drilldown, "See visible
        // networks") use ComponentSelectorFrame so the chevron
        // bar IS the selection indicator. Unselected rows draw
        // no chevron at all — the bar appears only when the row
        // is highlighted, signalling "press OK to drill in."
        this.chevronSelectorFrame = new ComponentSelectorFrame({
            x: SELECTOR_X,
            y: 0,
            width: SELECTOR_W,
            height: SELECTOR_H,
            anchorH: 'left',
            anchorV: 'top',
            strokeColor: '#000',
            showStroke: true,
            showFill: false,
            cornerRadius: 3,
            showChevron: true,
            chevronWidth: 7,
            chevronColor: '#666666',
            chevronGlyphColor: '#ffffff'
        });
    }

    WifiScene.prototype.enter = function() {
        var self = this;
        // Poll /api/wifi/scan while the scene is active so the
        // modal always opens against an up-to-date list. Initial
        // fetch fires immediately; the interval keeps it fresh.
        // Server-side data is cached at 5 s cadence already, so
        // this client poll is cheap.
        function fetchScan() {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', '/api/wifi/scan', true);
                xhr.timeout = 3000;
                xhr.onload = function() {
                    if (xhr.status !== 200) return;
                    try {
                        var data = JSON.parse(xhr.responseText);
                        // `ready` distinguishes "scan finished" from
                        // "scan still pending" on the server. Until
                        // it flips true the client keeps showing
                        // the spinner — even if `networks` is []
                        // (which would otherwise misread as "no
                        // networks visible" mid-load).
                        if (!data || !data.ready) return;
                        var arr = data.networks || [];
                        // Keep the full record per network — the
                        // modal now renders SSID + security tag +
                        // signal icon, and future UX may add more.
                        self._visibleNetworks = arr.filter(function(n) {
                            return n && n.ssid;
                        }).map(function(n) {
                            return {
                                ssid:     n.ssid,
                                signal:   typeof n.signal === 'number' ? n.signal : 0,
                                security: n.security || ''
                            };
                        });
                        // Scan has finished; modal can swap the
                        // spinner for either the SSID list or the
                        // 'No networks' placeholder if the list
                        // genuinely came back empty.
                        self._scanLoaded = true;
                        if (window.requestRender) window.requestRender();
                    } catch (e) { /* ignore parse errors */ }
                };
                xhr.send();
            } catch (e) { /* network unreachable; ignore */ }
        }
        fetchScan();
        this._scanTimer = setInterval(fetchScan, 5000);

        // Cached set of saved-profile SSIDs. Populated once on
        // enter() (then refreshed every 10 s while the scene is
        // active so newly-saved networks show up). Used by the
        // visible-networks OK path to skip the password modal
        // when a profile already exists for the picked SSID —
        // nmcli reuses the saved PSK in that case.
        this._savedSsids = {};
        function fetchSaved() {
            try {
                var sxhr = new XMLHttpRequest();
                sxhr.open('GET', '/api/wifi/saved', true);
                sxhr.timeout = 5000;
                sxhr.onload = function() {
                    if (sxhr.status !== 200) return;
                    try {
                        var sdata = JSON.parse(sxhr.responseText);
                        var arr = (sdata && sdata.networks) || [];
                        var byName = {};
                        for (var i = 0; i < arr.length; i++) {
                            var n = arr[i];
                            if (!n) continue;
                            // Index by SSID (the on-air name) AND
                            // by profile name — for typical user
                            // profiles they're the same, but
                            // they CAN differ, so keying both
                            // covers either lookup style.
                            if (n.ssid) byName[n.ssid] = n.name || n.ssid;
                            if (n.name) byName[n.name] = n.name;
                        }
                        self._savedSsids = byName;
                    } catch (e) { /* ignore parse errors */ }
                };
                sxhr.send();
            } catch (e) { /* network unreachable; ignore */ }
        }
        fetchSaved();
        this._savedTimer = setInterval(fetchSaved, 10000);
    };

    WifiScene.prototype.exit = function() {
        if (this._scanTimer) {
            clearInterval(this._scanTimer);
            this._scanTimer = null;
        }
        if (this._savedTimer) {
            clearInterval(this._savedTimer);
            this._savedTimer = null;
        }
        if (this._modalAnimTimer) {
            clearInterval(this._modalAnimTimer);
            this._modalAnimTimer = null;
        }
    };

    // Rebuild `this.items` based on the live wifi state. The
    // connected-network row only appears while a connection is
    // active. When the radio is OFF (per the optimistic toggle
    // state), every secondary row is hidden — only the toggle
    // remains. Called from enter() and from render() each frame
    // so the list stays in sync as the connection / radio state
    // come and go.
    WifiScene.prototype._buildItems = function() {
        var self = this;
        var w = UI.getWifiInfo();
        var enabled = UI.getWifiEnabled();
        var items = [];
        // ── Group 1: radio toggle ──
        items.push({
            text: 'Wi-Fi',
            isToggle: true,
            getStatus: function() { return UI.getWifiEnabled() ? 'ON' : 'OFF'; },
            onToggle: function() { UI.setWifiEnabled(!UI.getWifiEnabled()); }
        });
        // Everything below the toggle is gated on the radio being
        // on — there's nothing useful to do with these rows while
        // the radio is off, and showing them would be lying to the
        // user about what the device can do right now.
        if (enabled) {
            // ── Group 2: current network + scan ──
            items.push({ kind: 'divider' });
            if (w.connected && w.ssid) {
                items.push({
                    text: w.ssid,
                    chevron: true,
                    isConnected: true,
                    onPress: function() {
                        self._openVerboseNetworkModal(UI.getWifiInfo().ssid);
                    }
                });
            }
            items.push({
                text: 'See visible networks',
                chevron: true,
                onPress: function() { self._openNetworksModal(); }
            });
            // ── Group 3: saved networks + hidden ──
            items.push({ kind: 'divider' });
            items.push({
                text: 'Saved networks',
                chevron: true,
                onPress: function() { self._openSavedNetworksModal(); }
            });
            items.push({
                text: 'Connect to Hidden Network',
                chevron: true,
                // Functional wiring lands later — for now the row
                // exists in the menu so users can see the entry
                // point, but pressing OK is a no-op.
                onPress: function() { /* TODO: hidden-network connect flow */ }
            });
        }
        this.items = items;
        // Clamp the highlight + skip onto the nearest selectable
        // row if the list shrunk underneath it OR the highlight
        // is parked on a divider.
        if (this.selectedIndex >= items.length) {
            this.selectedIndex = Math.max(0, items.length - 1);
        }
        if (items[this.selectedIndex] && items[this.selectedIndex].kind === 'divider') {
            this.selectedIndex = this._nextSelectable(this.selectedIndex, 1);
        }
    };

    // Walk to the next non-divider row, wrapping through the
    // items list. Returns 0 if no selectable row exists (only
    // possible when the list is all dividers — shouldn't happen
    // but the guard keeps the highlight valid).
    WifiScene.prototype._nextSelectable = function(idx, dir) {
        var n = this.items.length;
        if (n === 0) return 0;
        for (var step = 0; step < n; step++) {
            idx = (idx + dir + n) % n;
            var it = this.items[idx];
            if (!it || it.kind !== 'divider') return idx;
        }
        return 0;
    };

    // Reconnect to a network whose saved profile already exists.
    // Surfaces a spinner overlay on the visible-networks modal,
    // POSTs /api/wifi/connect with no password (nmcli will reuse
    // the saved PSK), and on success closes the modal. On
    // failure (e.g. saved profile broken / password changed)
    // falls back to opening the regular password modal so the
    // user can re-enter the PSK.
    WifiScene.prototype._connectSavedDirectly = function(ssidOrName) {
        var self = this;
        if (!ssidOrName) return;
        // Trigger spinner overlay on the visible-networks modal.
        // The render path for the modal already checks
        // `_modalConnecting`; setting it here is enough.
        self._modalConnecting = true;
        if (window.requestRender) window.requestRender();
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/wifi/connect', true);
            xhr.timeout = 35000;
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = function() {
                self._modalConnecting = false;
                if (xhr.status === 200) {
                    // Close the visible-networks modal — wifi
                    // page poller will pick up the new active
                    // connection on its next tick.
                    self._modal = null;
                    if (self._modalAnimTimer) {
                        clearInterval(self._modalAnimTimer);
                        self._modalAnimTimer = null;
                    }
                    if (window.requestRender) window.requestRender();
                    return;
                }
                // Saved-profile reuse failed (broken creds, etc.)
                // — fall back to the password modal so the user
                // can re-enter the PSK.
                self._openConnectModal(ssidOrName, '');
            };
            xhr.onerror = function() {
                self._modalConnecting = false;
                self._openConnectModal(ssidOrName, '');
            };
            xhr.ontimeout = function() {
                self._modalConnecting = false;
                self._openConnectModal(ssidOrName, '');
            };
            xhr.send(JSON.stringify({ ssid: ssidOrName, password: '' }));
        } catch (e) {
            self._modalConnecting = false;
            self._openConnectModal(ssidOrName, '');
        }
    };

    WifiScene.prototype._flashArrow = function(dir) {
        var self = this;
        this._arrowPressed = dir;
        if (window.requestRender) window.requestRender();
        setTimeout(function() {
            if (self._arrowPressed === dir) {
                self._arrowPressed = null;
                if (window.requestRender) window.requestRender();
            }
        }, 120);
    };

    // Build the visible-networks modal. Pure data + a render /
    // handleInput pair the scene's render loop and handleInput
    // delegate to while `_modal` is non-null. Esc / back closes
    // the modal — the scene itself stays put. While open, an
    // 80-ms ticker requests renders so the loading-spinner
    // sprite cycles its 8 frames smoothly.
    WifiScene.prototype._openNetworksModal = function() {
        var self = this;

        // Modal geometry — split into static (horizontal) and
        // dynamic (vertical) parts. Horizontal positions never
        // change: 4 px padding on the left, 4 px on the right;
        // the tab and frame both stretch across the canvas.
        // Vertical layout is RECALCULATED per render in
        // `computeLayout()` below — modal height grows with the
        // number of networks, capped so the bottom never sits
        // below y = MAX_BOTTOM_Y; everything beyond that point
        // is paged into the scroll. With less than the cap,
        // the whole modal centres vertically on the canvas.
        var SCREEN_PAD       = 4;
        var TAB_H            = 16;
        var FRAME_X          = SCREEN_PAD;
        var FRAME_W          = 256 - SCREEN_PAD * 2;
        // Inner padding inside the frame body. Bottom is 1 px
        // larger than top so the frame's lower edge sits one row
        // below where straight 3+3 padding would land — gives the
        // last row a touch more breathing space and pushes the
        // overall bottom edge of the responsive frame 1 px down.
        var FRAME_PAD_TOP    = 3;
        var FRAME_PAD_BOTTOM = 4;
        // Right-side gutter (only used when the scrollbar shows).
        var SCROLLBAR_GUTTER = 6;
        var SCROLLBAR_X      = FRAME_X + FRAME_W - 5;
        // Row pitch: 13 px row + 1 px divider.
        var ROW_PITCH        = ROW_H + 1;
        // Modal can grow until its bottom edge touches y = 128
        // (the cap moves down 1 px alongside the +1 bottom-pad
        // bump above so the maximum-height modal still hits a
        // clean limit).
        var MAX_BOTTOM_Y     = 128;
        var CANVAS_H         = 144;
        // Spinner / placeholder min content height — always
        // reserve room for a couple of rows so the spinner has
        // breathing space even before the first scan returns.
        var MIN_CONTENT_ROWS = 2;

        // Selector frame for the highlighted row. Width / position
        // are reset per render via setSize / setPosition.
        var listSelector = new MenuSelectorFrame({
            x: 0, y: 0,
            width: 1, height: ROW_H + 2,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });

        // Headline tab. Reposition per render once we know where
        // the modal lands vertically.
        var tab = new UI.TabHeader('Visible networks');
        tab.x = FRAME_X;
        tab.h = TAB_H;

        // Compute every vertical coordinate from the network count.
        // Returns a struct the render path uses; called once per
        // frame so changes (scan completes, list grows) update the
        // geometry without restarting the modal.
        function computeLayout() {
            // Max possible frame height given the bottom cap and
            // the (still-unknown) top y. We solve in two passes:
            //   1. Compute the tallest the modal could ever be
            //      (top sits as high as we'd ever centre it, bottom
            //      pinned to MAX_BOTTOM_Y).
            //   2. Use that to derive max visible rows, then size
            //      the modal to whatever the actual content needs,
            //      capped by max.
            var nets = self._visibleNetworks;
            var loaded = self._scanLoaded;
            var n = loaded ? nets.length : 0;

            // Theoretical max modal height = MAX_BOTTOM_Y with top
            // at SCREEN_PAD (the cramped fallback when content
            // overflows).
            var maxModalH  = MAX_BOTTOM_Y - SCREEN_PAD;
            var maxFrameH  = maxModalH - TAB_H;
            var maxInnerH  = maxFrameH - FRAME_PAD_TOP - FRAME_PAD_BOTTOM;
            var maxRowsCap = Math.max(1, Math.floor((maxInnerH + 1) / ROW_PITCH));

            // Decide how many rows we want to PHYSICALLY allocate
            // in the frame. Loading / empty states reserve room
            // for the spinner / placeholder; populated state sizes
            // to fit n rows up to the cap.
            var rowsToFit;
            if (!loaded || n === 0) {
                rowsToFit = MIN_CONTENT_ROWS;
            } else {
                rowsToFit = Math.min(n, maxRowsCap);
            }

            var contentH  = rowsToFit * ROW_H + Math.max(0, rowsToFit - 1) * 1;
            var frameH    = contentH + FRAME_PAD_TOP + FRAME_PAD_BOTTOM;
            if (frameH > maxFrameH) frameH = maxFrameH;

            var modalH    = TAB_H + frameH;

            // Vertical placement: centre on the canvas while the
            // bottom doesn't exceed MAX_BOTTOM_Y. If centring
            // would push past, pin the top so the bottom lands
            // exactly at MAX_BOTTOM_Y.
            var centredTop = Math.floor((CANVAS_H - modalH) / 2);
            var pinnedTop  = MAX_BOTTOM_Y - modalH;
            var topY = Math.min(centredTop, pinnedTop);
            if (topY < SCREEN_PAD) topY = SCREEN_PAD;

            var frameY      = topY + TAB_H;
            var innerTop    = frameY + FRAME_PAD_TOP;
            var innerBottom = frameY + frameH - FRAME_PAD_BOTTOM;
            var innerH      = innerBottom - innerTop;
            var visibleCount = Math.max(1, Math.floor((innerH + 1) / ROW_PITCH));

            return {
                topY:          topY,
                frameY:        frameY,
                frameH:        frameH,
                innerTop:      innerTop,
                innerBottom:   innerBottom,
                innerH:        innerH,
                visibleCount:  visibleCount
            };
        }

        function ensureVisible() {
            var n = self._visibleNetworks.length;
            if (n === 0) return;
            // visibleCount depends on the layout's current modal
            // height — recompute via computeLayout so navigation
            // tracks the resized frame correctly when networks are
            // added or removed during the session.
            var L = computeLayout();
            if (self._modalSelected < self._modalScroll) {
                self._modalScroll = self._modalSelected;
            } else if (self._modalSelected >= self._modalScroll + L.visibleCount) {
                self._modalScroll = self._modalSelected - L.visibleCount + 1;
            }
            // Clamp: scroll never larger than max(0, n - visibleCount).
            var maxScroll = Math.max(0, n - L.visibleCount);
            if (self._modalScroll > maxScroll) self._modalScroll = maxScroll;
            if (self._modalScroll < 0) self._modalScroll = 0;
        }

        // Reset list state on each open so the user always lands
        // on the first network.
        self._modalSelected  = 0;
        self._modalScroll    = 0;
        self._modalScrollbar = null;

        this._modal = {
            handleInput: function(action) {
                if (action === 'back' || action === 'esc') {
                    self._modal = null;
                    if (self._modalAnimTimer) {
                        clearInterval(self._modalAnimTimer);
                        self._modalAnimTimer = null;
                    }
                    if (window.requestRender) window.requestRender();
                    return true;
                }
                var nets = self._visibleNetworks;
                if (!nets.length) return false;   // nothing to navigate
                if (action === 'down') {
                    self._modalSelected = (self._modalSelected + 1) % nets.length;
                    ensureVisible();
                    if (window.requestRender) window.requestRender();
                    return true;
                }
                if (action === 'up') {
                    self._modalSelected = (self._modalSelected - 1 + nets.length) % nets.length;
                    ensureVisible();
                    if (window.requestRender) window.requestRender();
                    return true;
                }
                if (action === 'ok' || action === 'run') {
                    // Press the highlighted network → either
                    // open the connect modal, OR if the picked
                    // SSID matches the currently-active
                    // connection surface a short "Already
                    // connected" toast at the bottom of the
                    // modal so the user gets feedback that
                    // there's nothing to do.
                    self._modalPressed = self._modalSelected;
                    if (window.requestRender) window.requestRender();
                    var picked = nets[self._modalSelected];
                    var live   = UI.getWifiInfo();
                    var alreadyConnected = !!(picked && live
                        && live.connected && live.ssid === picked.ssid);
                    setTimeout(function() {
                        self._modalPressed = -1;
                        if (alreadyConnected) {
                            // Toast lives on the scene so render
                            // can pick it up; auto-clears after
                            // ~1.6 s. Tapping a different network
                            // also clears it (state goes stale).
                            self._modalToast = 'Already connected';
                            self._modalToastUntil = Date.now() + 1600;
                            if (window.requestRender) window.requestRender();
                            return;
                        }
                        if (!picked || !picked.ssid) {
                            if (window.requestRender) window.requestRender();
                            return;
                        }
                        // Saved profile already exists → skip the
                        // password modal entirely. nmcli reuses
                        // the saved PSK if we connect by SSID
                        // without supplying a password. Spinner
                        // handles the brief join delay.
                        if (self._savedSsids && self._savedSsids[picked.ssid]) {
                            self._connectSavedDirectly(self._savedSsids[picked.ssid]);
                            return;
                        }
                        self._openConnectModal(picked.ssid, picked.security);
                    }, 30);
                    return true;
                }
                return false;
            },
            render: function(canvas) {
                var ctx = canvas.ctx;
                // Semi-transparent overlay so the underlying page
                // visually dims behind the modal — matches the
                // makeAirplaneBlockModal pattern in menu.js.
                ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
                ctx.fillRect(0, 0, canvas.w, canvas.h);

                // Geometry — recomputed per render so the modal
                // resizes when the network list grows / shrinks.
                var L = computeLayout();
                var INNER_X      = FRAME_X + 3;

                // Position the headline tab to match this frame
                // top.
                tab.y = L.topY;

                // Modal body (responsive frame). Top-left corner
                // is SQUARE (radius 0) so it tucks flush against
                // the tab's bottom-left corner; the other three
                // corners stay rounded at r = 4.
                var frame = new ResponsiveFrame({
                    x: FRAME_X, y: L.frameY,
                    width: FRAME_W, height: L.frameH,
                    anchorH: 'left', anchorV: 'top',
                    strokeColor: '#000', showStroke: true,
                    fillColor: '#ffffff', showFill: true,
                    // 3 px corner radius across both sides of the
                    // body — keeps left (BL) and right (TR/BR)
                    // visually consistent, and matches the
                    // ComponentSelectorFrame chevron-bar curvature
                    // on screens where the bar runs along the
                    // right edge.
                    cornerRadius: 3,
                    corners: { tl: false, tr: true, bl: true, br: true }
                });
                frame.render(canvas);

                // Headline tab.
                tab.render(canvas);

                // Body content.
                var nets = self._visibleNetworks;
                if (!self._scanLoaded) {
                    var sp = AnimatedIcons.spinner_22x20px;
                    var FRAME_MS = 80;
                    var spFrameH = Math.floor(sp.h / sp.frames);
                    var spFrame  = Math.floor(Date.now() / FRAME_MS) % sp.frames;
                    var sx = FRAME_X + Math.floor((FRAME_W - sp.w) / 2);
                    var sy = L.innerTop + Math.floor((L.innerH - spFrameH) / 2);
                    canvas.drawSpriteFrame(sp, sx, sy, spFrame, '#000');
                    return;
                }
                if (!nets.length) {
                    var placeholder = 'No networks';
                    var phW = HaxrcorpFont16.textWidth(placeholder);
                    HaxrcorpFont16.draw(ctx, placeholder,
                        FRAME_X + Math.floor((FRAME_W - phW) / 2),
                        L.innerTop + Math.floor((L.innerH - 11) / 2),
                        '#999999');
                    return;
                }

                // Scrollable, selectable list. Render only the
                // visible window. Each row carries:
                //   - SSID  (left, HaxrcorpFont16 black)
                //   - sec   (small text right of SSID, HaxrcorpFont16
                //            gray, only when network is encrypted)
                //   - icon  (right edge, status-bar wifi sprite
                //            picked from quality 0-100 the same
                //            way drawStatusBar picks one)
                //
                // Row width is dynamic: when the entire list fits
                // in the visible window we don't need the scrollbar
                // gutter, so rows stretch all the way to the
                // right frame edge. As soon as there's more content
                // than rows can show, we reserve `SCROLLBAR_GUTTER`
                // px on the right and render the scrollbar there.
                var needsScroll = nets.length > L.visibleCount;
                var dynInnerW   = FRAME_W - 6 - (needsScroll ? SCROLLBAR_GUTTER : 0);

                var first = self._modalScroll;
                var last  = Math.min(nets.length, first + L.visibleCount);
                var rowY  = L.innerTop;
                var selectedY = -1;
                for (var ni = first; ni < last; ni++) {
                    var net = nets[ni];
                    if (ni === self._modalSelected) selectedY = rowY;
                    var pressed = (ni === self._modalPressed);
                    var fg = pressed ? '#fff' : '#000';
                    var fgDim = pressed ? '#fff' : '#999999';

                    if (pressed) {
                        // Press flash: filled black with white text.
                        canvas.drawRoundRect(INNER_X, rowY - 1,
                            dynInnerW, ROW_H + 2, 2, '#000');
                    }

                    // Signal icon — same 7×7 sprites the status
                    // bar uses, picked by quality threshold.
                    var qIcon = signalIconFor(net.signal);
                    var iconX = INNER_X + dynInnerW - qIcon.w - 2;
                    var iconY = rowY + Math.floor((ROW_H - qIcon.h) / 2);
                    canvas.drawSprite(qIcon, iconX, iconY, fg);

                    // Security tag right-aligned just left of the
                    // signal icon. Empty for open networks.
                    var secLabel = securityLabel(net.security);
                    var secEndX = iconX - 4;
                    if (secLabel) {
                        var secW = HaxrcorpFont16.textWidth(secLabel);
                        HaxrcorpFont16.draw(ctx, secLabel,
                            secEndX - secW, rowY + 1, fgDim);
                        secEndX = secEndX - secW - 4;
                    }

                    // SSID. Left-aligned; if it would collide with
                    // the security/signal cluster, hard-clip by
                    // truncating with an ellipsis.
                    var ssidStartX = INNER_X + 5;
                    var ssidMaxW   = secEndX - ssidStartX;
                    var ssidText   = ellipsizeTo(net.ssid, ssidMaxW);
                    HaxrcorpFont16.draw(ctx, ssidText,
                        ssidStartX, rowY + 1, fg);

                    rowY += ROW_H;
                    if (ni < last - 1) {
                        canvas.drawHLine(INNER_X + 2, rowY,
                            dynInnerW - 4, '#EEEEEE');
                        rowY += 1;
                    }
                }

                // Selector frame around the highlighted row,
                // unless the row is currently flashing pressed
                // (the filled-black look already conveys focus).
                if (selectedY >= 0 && self._modalPressed !== self._modalSelected) {
                    listSelector.setSize(dynInnerW, ROW_H + 2);
                    listSelector.setPosition(INNER_X, selectedY - 1);
                    listSelector.render(canvas);
                }

                // Scrollbar — same UI.Scrollbar component the
                // sub-menus use. Only rendered when the list
                // exceeds the visible window. Sits in the right
                // gutter we reserved (only when needed) above.
                if (needsScroll) {
                    if (!self._modalScrollbar) {
                        self._modalScrollbar = new UI.Scrollbar(
                            nets.length, L.visibleCount, self._modalScroll);
                    }
                    self._modalScrollbar.update(
                        nets.length, L.visibleCount, self._modalScroll);
                    self._modalScrollbar.render(canvas,
                        SCROLLBAR_X, L.innerTop, L.innerH, 1);
                }

                // Saved-profile direct-connect spinner overlay.
                // Active while `_connectSavedDirectly` is waiting
                // on the /api/wifi/connect XHR. Covers the modal
                // body with a translucent veil + the same 22×20
                // spinner the visible-networks loading state uses.
                if (self._modalConnecting) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                    ctx.fillRect(FRAME_X + 1, L.frameY + 1,
                        FRAME_W - 2, L.frameH - 2);
                    var csp        = AnimatedIcons.spinner_22x20px;
                    var CSP_MS     = 80;
                    var cspFrameH  = Math.floor(csp.h / csp.frames);
                    var cspFrame   = Math.floor(Date.now() / CSP_MS) % csp.frames;
                    var cspX       = FRAME_X + Math.floor((FRAME_W - csp.w) / 2);
                    var cspY       = L.frameY + Math.floor((L.frameH - cspFrameH) / 2);
                    canvas.drawSpriteFrame(csp, cspX, cspY, cspFrame, '#000');
                }

                // "Already connected" toast — surfaces when the
                // user presses OK on the network they're already
                // joined to. Auto-clears after ~1.6 s; renders
                // as a small black pill near the bottom of the
                // modal so it doesn't fight the list above.
                if (self._modalToast && Date.now() < self._modalToastUntil) {
                    var toastTxt = self._modalToast;
                    var toastW   = HaxrcorpFont16.textWidth(toastTxt);
                    var pillH    = 14;
                    var pillW    = toastW + 14;
                    var pillX    = FRAME_X + Math.floor((FRAME_W - pillW) / 2);
                    var pillY    = L.frameY + L.frameH - pillH - 4;
                    canvas.drawRoundRect(pillX, pillY, pillW, pillH, 3, '#000');
                    HaxrcorpFont16.draw(ctx, toastTxt,
                        pillX + 7,
                        pillY + Math.floor((pillH - 11) / 2),
                        '#fff');
                } else if (self._modalToast) {
                    // Lifetime expired — clear so the next render
                    // doesn't keep painting it.
                    self._modalToast = null;
                }
            }
        };

        // Spinner / press-flash tick — fires while the modal is
        // open. Cleared on close (esc/back path above) and on
        // scene exit() too.
        if (this._modalAnimTimer) clearInterval(this._modalAnimTimer);
        this._modalAnimTimer = setInterval(function() {
            if (window.requestRender) window.requestRender();
        }, 80);

        if (window.requestRender) window.requestRender();
    };

    // ── Connected-network details modal ─────────────────────────
    // Opened from the connected-network row on the wifi page.
    // Single scrollable list of selectable rows: actions (Forget /
    // Auto-join / Password) above, an info section (IPv4 / IPv6
    // ──────────────────────────────────────────────────────────
    // Saved networks modal — list of every Wi-Fi connection
    // ──────────────────────────────────────────────────────────
    // Connect-to-network modal — opens when the user picks a
    // network from the visible-networks list. Layout: tab header
    // ("Connecting to the network") attached to a ResponsiveFrame
    // containing the SSID label + a CCCCCC-filled, no-stroke text
    // input box with a blinking cursor. Below the frame sits the
    // on-screen `UI.Keyboard`, and along the bottom three
    // app-defined buttons (Close / 123 / Done). Pressing Done
    // POSTs to /api/wifi/connect with { ssid, password }; success
    // closes every modal layer and returns to the Wi-Fi page.
    // ──────────────────────────────────────────────────────────
    WifiScene.prototype._openConnectModal = function(ssid, security) {
        var self = this;
        if (!ssid) return;

        // Modal-local state. The password lives inside the
        // TextInputScreen component; `connecting` + `errorMsg`
        // drive the spinner / error overlay we paint on top of
        // it during the /api/wifi/connect XHR round-trip.
        var connecting = false;
        var errorMsg   = null;

        // Drop the connect prompt onto a shared input screen so
        // the keyboard, peek-row, input field, tabs, and the
        // discard-changes prompt all match the rest of the
        // device. Save → connect; Discard → close.
        var screen = new TextInputScreen({
            title:       'Password for ' + ssid,
            initialText: '',
            onSave:      function(password) {
                // Returning `undefined` keeps the screen alive —
                // the spinner overlay (below) covers it while
                // the XHR is running. On success the close path
                // tears the whole modal down; on failure errorMsg
                // surfaces above the keyboard.
                doConnect(password);
            },
            onDiscard:   function() {
                closeModal();
            }
        });
        screen.enter();

        function closeModal() {
            if (screen.exit) screen.exit();
            self._modal = null;
            if (self._modalAnimTimer) {
                clearInterval(self._modalAnimTimer);
                self._modalAnimTimer = null;
            }
            if (window.requestRender) window.requestRender();
        }

        // POST { ssid, password } to /api/wifi/connect. While the
        // call is in flight the spinner covers the screen; on
        // success the whole modal layer closes (the wifi page
        // poller will pick up the new active connection); on
        // failure errorMsg surfaces above the keyboard.
        function doConnect(password) {
            if (connecting) return;
            connecting = true;
            errorMsg   = null;
            if (window.requestRender) window.requestRender();
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/wifi/connect', true);
                // Generous timeout — nmcli's full connect cycle
                // (auth + DHCP) can run 10-25 s on a flaky AP.
                xhr.timeout = 35000;
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.onload = function() {
                    connecting = false;
                    if (xhr.status === 200) {
                        closeModal();
                        return;
                    }
                    try {
                        var d = JSON.parse(xhr.responseText);
                        errorMsg = (d && d.error) ? d.error : 'Connection failed';
                    } catch (e) { errorMsg = 'Connection failed'; }
                    if (window.requestRender) window.requestRender();
                };
                xhr.onerror   = function() { connecting = false; errorMsg = 'Network error';      if (window.requestRender) window.requestRender(); };
                xhr.ontimeout = function() { connecting = false; errorMsg = 'Connection timed out'; if (window.requestRender) window.requestRender(); };
                xhr.send(JSON.stringify({ ssid: ssid, password: password }));
            } catch (e) { connecting = false; errorMsg = 'Network error'; }
        }

        self._modal = {
            handleInput: function(action) {
                // Connecting? Block everything except a cancel
                // via esc. The in-flight request continues
                // server-side; the user just gets the UI back.
                if (connecting) {
                    if (action === 'esc') closeModal();
                    return true;
                }
                // Error visible? Any key dismisses it so the
                // user can retry.
                if (errorMsg && (action === 'ok' || action === 'esc' || action === 'back')) {
                    errorMsg = null;
                    if (window.requestRender) window.requestRender();
                    return true;
                }
                // TextInputScreen runs the whole password-entry
                // experience. A `'pop'` return means the user
                // committed (Save / Done) or discarded — the
                // onSave / onDiscard callbacks above have
                // already routed the action. Closing the modal
                // here would tear the screen down mid-XHR
                // (Save → doConnect → spinner needs the screen
                // alive); we delay the teardown to the connect
                // resolver instead by only closing when no XHR
                // is in flight. The Discard path closes via its
                // own callback before this check runs, so it's
                // safe regardless.
                var r = screen.handleInput(action);
                if (r === 'pop' && !connecting && self._modal) {
                    closeModal();
                }
                return true;
            },
            render: function(canvas) {
                screen.render(canvas);
                var ctx = canvas.ctx;
                if (connecting) {
                    // Translucent wash + spinner over the whole
                    // page below the status bar.
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                    ctx.fillRect(0, 13, canvas.w, canvas.h - 13);
                    var sp       = AnimatedIcons.spinner_22x20px;
                    var spFrameH = Math.floor(sp.h / sp.frames);
                    var spFrame  = Math.floor(Date.now() / 80) % sp.frames;
                    var spX      = Math.floor((canvas.w - sp.w) / 2);
                    var spY      = Math.floor((canvas.h - spFrameH) / 2);
                    canvas.drawSpriteFrame(sp, spX, spY, spFrame, '#000');
                } else if (errorMsg) {
                    // Single ellipsised error line, parked just
                    // above the keyboard top edge.
                    var emsg = errorMsg.length > 36
                        ? errorMsg.substring(0, 35) + '…'
                        : errorMsg;
                    var ew = HaxrcorpFont16.textWidth(emsg);
                    HaxrcorpFont16.draw(ctx, emsg,
                        Math.floor((canvas.w - ew) / 2), 60, '#999999');
                }
            }
        };

        // 80 ms ticker for the spinner animation. The
        // TextInputScreen already runs its own 250 ms blink
        // ticker for the cursor, but the spinner needs faster
        // tick to look smooth.
        if (this._modalAnimTimer) clearInterval(this._modalAnimTimer);
        this._modalAnimTimer = setInterval(function() {
            if (window.requestRender) window.requestRender();
        }, 80);

        if (window.requestRender) window.requestRender();
    };

    // ──────────────────────────────────────────────────────────
    // Saved-networks modal — list of every Wi-Fi connection
    // profile NetworkManager knows about (i.e. networks the
    // device has ever joined). Backed by GET /api/wifi/saved
    // which runs `nmcli -t -f NAME,TYPE connection show` and
    // hydrates each entry with autoconnect / lastConnected /
    // security via per-profile `connection show <name>` calls.
    // The modal mirrors the visible-networks layout (4 px screen
    // padding, tab + frame stack, max bottom y = 128) but renders
    // simpler rows: SSID + a small WPA-family security tag. No
    // signal column — saved profiles aren't currently in range
    // by definition.
    // ──────────────────────────────────────────────────────────
    WifiScene.prototype._openSavedNetworksModal = function() {
        var self = this;

        // Layout constants — same shape as the visible-networks
        // modal, but the bottom inner padding is 3 px tighter so
        // the last row sits closer to the frame's bottom edge.
        // (Saved-list rows carry a chevron-bar selector; the
        // extra slack at the bottom looked unbalanced once that
        // bar was added.)
        // Layout constants. FRAME_W is now ADAPTIVE — recomputed
        // per render in computeLayout() based on the longest
        // SSID currently in the list. Min width is the tab
        // header's natural width + 20 px so the bar never looks
        // cramped against its label. Max width caps at the
        // canvas edge minus SCREEN_PAD on each side.
        var SCREEN_PAD       = 4;
        var TAB_H            = 16;
        var FRAME_PAD_TOP    = 3;
        // Bottom padding tightened another 2 px (was 1). Combined
        // with the trailing-gap removal in computeLayout below,
        // the visible white space below the last row shrinks by
        // 2 px without clipping the row's content.
        var FRAME_PAD_BOTTOM = -1;
        var SCROLLBAR_GUTTER = 6;
        var ROW_PITCH        = ROW_H + 1;
        var MAX_BOTTOM_Y     = 128;
        var CANVAS_H         = 144;
        var TAB_TEXT         = 'Saved networks';
        var FRAME_W_MAX      = 256 - SCREEN_PAD * 2;
        var FRAME_W_MIN      = HaxrcorpFont16.textWidth(TAB_TEXT) + 6 + 20;

        // Fetch state.
        var loaded   = false;
        var networks = [];
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/wifi/saved', true);
            xhr.timeout = 5000;
            xhr.onload = function() {
                loaded = true;
                if (xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        networks = (data && data.networks) || [];
                    } catch (e) { networks = []; }
                }
                if (window.requestRender) window.requestRender();
            };
            xhr.onerror   = function() { loaded = true; };
            xhr.ontimeout = function() { loaded = true; };
            xhr.send();
        } catch (e) { loaded = true; }

        // Saved-network rows drill into the verbose detail
        // modal, so the selection indicator carries a chevron
        // bar — same affordance the Wi-Fi page uses for its own
        // chevron rows. ComponentSelectorFrame paints the bar on
        // the right edge of the highlighted row only.
        var listSelector = new ComponentSelectorFrame({
            x: 0, y: 0, width: 1, height: ROW_H + 2,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true,
            fillColor: '#ffffff', showFill: false,
            cornerRadius: 3,
            showChevron: true,
            chevronWidth: 7,
            chevronColor: '#666666',
            chevronGlyphColor: '#ffffff'
        });

        var tab = new UI.TabHeader(TAB_TEXT);
        // tab.x is recomputed each render to track the modal's
        // adaptive frame x.
        tab.h = TAB_H;

        // Modal state, kept on the scene so input + render see
        // the same cursor.
        self._savedSelected = 0;
        self._savedScroll   = 0;
        self._savedPressed  = -1;

        function computeLayout() {
            // ── Vertical sizing first (independent of width) ──
            var rowsCount = networks.length;
            // Drop the trailing ROW_PITCH gap from the last row's
            // height so the visible bottom-padding shrinks
            // cleanly. Combined with FRAME_PAD_BOTTOM going
            // from 1 → -1, the visible white space below the
            // last row is 2 px less than before, without
            // clipping the row's content into the frame stroke.
            var contentH  = rowsCount > 0 ? rowsCount * ROW_PITCH - 1 : 0;
            var maxModalH = MAX_BOTTOM_Y - SCREEN_PAD;
            var maxFrameH = maxModalH - TAB_H;
            var frameH    = Math.min(maxFrameH,
                contentH + FRAME_PAD_TOP + FRAME_PAD_BOTTOM);
            // Empty / loading state needs minimum height for the
            // placeholder text.
            if (frameH < 24) frameH = 24;
            var innerH    = frameH - FRAME_PAD_TOP - FRAME_PAD_BOTTOM;
            // Whether we'll need the scrollbar — drives the
            // gutter reservation in the adaptive width below.
            var willScroll = contentH > innerH;

            // ── Adaptive width ────────────────────────────────
            // Find the widest SSID currently in the list. The
            // SSID renders at INNER_X + 5 inside the frame body
            // and ellipsises to dynInnerW - 10. Reverse the math
            // to get the frame width needed to fit the widest
            // entry without truncation:
            //   frameW = maxSsidW + 16  (no scrollbar)
            //   frameW = maxSsidW + 22  (with scrollbar)
            //  (10 ellipsis padding + 6 frame-side strokes/pads,
            //   plus 6 for the scrollbar gutter.)
            var maxSsidW = 0;
            for (var i = 0; i < networks.length; i++) {
                var ssid = (networks[i] && (networks[i].ssid || networks[i].name)) || '';
                var w = HaxrcorpFont16.textWidth(ssid);
                if (w > maxSsidW) maxSsidW = w;
            }
            var contentDrivenW = maxSsidW + (willScroll ? 22 : 16);
            var frameW = Math.max(FRAME_W_MIN, contentDrivenW);
            if (frameW > FRAME_W_MAX) frameW = FRAME_W_MAX;
            var frameX = Math.floor((256 - frameW) / 2);
            var scrollbarX = frameX + frameW - 5;

            // ── Final vertical placement ──────────────────────
            var modalH    = TAB_H + frameH;
            var centeredY = Math.floor((CANVAS_H - modalH) / 2);
            var pinnedY   = MAX_BOTTOM_Y - modalH;
            var topY      = Math.min(centeredY, pinnedY);
            if (topY < SCREEN_PAD) topY = SCREEN_PAD;
            var frameY    = topY + TAB_H;
            var innerTop  = frameY + FRAME_PAD_TOP;
            return { topY: topY, frameY: frameY, frameH: frameH,
                     frameX: frameX, frameW: frameW,
                     scrollbarX: scrollbarX,
                     innerTop: innerTop, innerH: innerH,
                     contentH: contentH };
        }

        function ensureVisible() {
            var L = computeLayout();
            var maxScroll = Math.max(0, L.contentH - L.innerH);
            var rowY = self._savedSelected * ROW_PITCH;
            if (rowY < self._savedScroll) {
                self._savedScroll = rowY;
            } else if (rowY + ROW_H > self._savedScroll + L.innerH) {
                self._savedScroll = rowY + ROW_H - L.innerH;
            }
            if (self._savedScroll > maxScroll) self._savedScroll = maxScroll;
            if (self._savedScroll < 0) self._savedScroll = 0;
        }

        function closeModal() {
            self._modal = null;
            if (self._modalAnimTimer) {
                clearInterval(self._modalAnimTimer);
                self._modalAnimTimer = null;
            }
            if (window.requestRender) window.requestRender();
        }

        // Friendly security tag — same vocabulary as the visible
        // networks list (WPA1/2/3/Open/WEP).
        function savedSecLabel(km) {
            if (!km) return 'Open';
            km = String(km).toLowerCase();
            if (km.indexOf('sae') >= 0)        return 'WPA3';
            if (km.indexOf('wpa-eap') >= 0)    return 'WPA-EAP';
            if (km.indexOf('wpa-psk') >= 0)    return 'WPA';
            if (km.indexOf('none') >= 0)       return 'WEP';
            return km.toUpperCase();
        }

        this._modal = {
            handleInput: function(action) {
                if (action === 'back' || action === 'esc') {
                    closeModal();
                    return true;
                }
                var n = networks.length;
                if (n === 0) return true;
                if (action === 'down') {
                    self._savedSelected = (self._savedSelected + 1) % n;
                    ensureVisible();
                    if (window.requestRender) window.requestRender();
                    return true;
                }
                if (action === 'up') {
                    self._savedSelected = (self._savedSelected - 1 + n) % n;
                    ensureVisible();
                    if (window.requestRender) window.requestRender();
                    return true;
                }
                if (action === 'ok' || action === 'run') {
                    self._savedPressed = self._savedSelected;
                    if (window.requestRender) window.requestRender();
                    var picked = networks[self._savedSelected];
                    setTimeout(function() {
                        self._savedPressed = -1;
                        // Close this modal and open the shared
                        // verbose-detail component on the picked
                        // profile. Same UI as the active-network
                        // drilldown — just driven by a different
                        // connection name.
                        closeModal();
                        if (picked && picked.name) {
                            self._openVerboseNetworkModal(picked.name);
                        }
                    }, 30);
                    return true;
                }
                return false;
            },
            render: function(canvas) {
                var ctx = canvas.ctx;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
                ctx.fillRect(0, 0, canvas.w, canvas.h);

                var L = computeLayout();
                var INNER_X = L.frameX + 3;
                var dynInnerW = L.frameW - 6;
                var needsScroll = L.contentH > L.innerH;
                if (needsScroll) dynInnerW -= SCROLLBAR_GUTTER;

                tab.x = L.frameX;
                tab.y = L.topY;

                var frame = new ResponsiveFrame({
                    x: L.frameX, y: L.frameY,
                    width: L.frameW, height: L.frameH,
                    anchorH: 'left', anchorV: 'top',
                    strokeColor: '#000', showStroke: true,
                    fillColor: '#ffffff', showFill: true,
                    // 3 px corner radius — matches the chevron-bar
                    // selector that sits along the right edge.
                    // The TR / BR corners now share the same
                    // radius as the bar so they read as one
                    // continuous silhouette.
                    cornerRadius: 3,
                    corners: { tl: false, tr: true, bl: true, br: true }
                });
                frame.render(canvas);
                tab.render(canvas);

                ctx.save();
                ctx.beginPath();
                ctx.rect(L.frameX + 1, L.frameY + 1, L.frameW - 2, L.frameH - 2);
                ctx.clip();

                if (!loaded) {
                    HaxrcorpFont16.draw(ctx, 'Loading…',
                        INNER_X + 5, L.innerTop + 4, '#999999');
                } else if (networks.length === 0) {
                    HaxrcorpFont16.draw(ctx, 'No saved networks',
                        INNER_X + 5, L.innerTop + 4, '#999999');
                } else {
                    var selectedY = -1;
                    for (var i = 0; i < networks.length; i++) {
                        var rowY = L.innerTop + i * ROW_PITCH - self._savedScroll;
                        if (rowY + ROW_H < L.innerTop) continue;
                        if (rowY > L.frameY + L.frameH) break;
                        var net      = networks[i];
                        var isSelected = (i === self._savedSelected);
                        var isPressed  = (i === self._savedPressed);
                        if (isSelected) selectedY = rowY;
                        var fg    = isPressed ? '#fff' : '#000';
                        var fgDim = isPressed ? '#fff' : '#999999';
                        if (isPressed) {
                            canvas.drawRoundRect(INNER_X, rowY - 1,
                                dynInnerW, ROW_H + 2, 2, '#000');
                        }
                        // SSID only — no security tag in this list.
                        // The drilldown verbose view already exposes
                        // security flavour where it's actionable.
                        var ssidMaxW = dynInnerW - 10;
                        var ssidTxt  = ellipsizeTo(net.ssid || net.name, ssidMaxW);
                        HaxrcorpFont16.draw(ctx, ssidTxt,
                            INNER_X + 5, rowY + 1, fg);
                    }
                    if (selectedY >= 0 && self._savedPressed !== self._savedSelected) {
                        listSelector.setSize(dynInnerW, ROW_H + 2);
                        listSelector.setPosition(INNER_X, selectedY - 1);
                        listSelector.render(canvas);
                    }
                }
                ctx.restore();

                if (needsScroll) {
                    var sb = new UI.Scrollbar(L.contentH, L.innerH, self._savedScroll);
                    sb.render(canvas, L.scrollbarX, L.innerTop, L.innerH, 1);
                }
            }
        };

        // Keep the modal redrawing while loading so the spinner-
        // less placeholder transition doesn't lag.
        if (this._modalAnimTimer) clearInterval(this._modalAnimTimer);
        this._modalAnimTimer = setInterval(function() {
            if (window.requestRender) window.requestRender();
        }, 200);

        if (window.requestRender) window.requestRender();
    };

    // ──────────────────────────────────────────────────────────
    // Verbose network detail modal — reusable component shared
    // by both the active-network drilldown and the saved-network
    // drilldown. Caller passes a connection name; the modal
    // fetches `/api/wifi/connection?secrets=1&name=<name>` and
    // renders the same Forget / Auto-join / Password / IPv4 /
    // IPv6 layout regardless of whether the profile is currently
    // active. For inactive profiles the address arrays come back
    // empty, but the configured Method / DNS / Gateway settings
    // are still populated from the saved profile, so the cards
    // remain useful.
    //
    // method + addresses + DNS) below — every non-divider row is
    // selectable so the user can navigate through and (in a
    // future iteration) drill in to edit the DHCP / DNS values.
    // Selection auto-scrolls; UI.Scrollbar shows when content
    // overflows; touchpad Y-axis drives scroll directly with
    // velocity-projected momentum on release (same speed-detect
    // model the App Switcher uses). Backed by GET
    // /api/wifi/connection — nmcli `connection show` parsed into
    // the structured fields the rows render from.
    // ──────────────────────────────────────────────────────────
    WifiScene.prototype._openVerboseNetworkModal = function(connName) {
        var self = this;
        var ssid = connName;
        if (!ssid) return;   // nothing to show

        // Connection name used for both the API fetch and the
        // forget call. SSID label drives the tab header; for
        // saved profiles where the connection id and SSID may
        // differ, this is just the profile name — refined once
        // the fetch lands and we know the real `802-11-wireless.ssid`.

        // Layout reuses the same geometry constants as the
        // visible-networks modal (4 px screen padding, tab + frame
        // stack, max bottom y = 128). Vertical sizing is content-
        // driven via computeLayout(), based on `actionItems` count
        // and the info-rows count.
        var SCREEN_PAD       = 4;
        var TAB_H            = 16;
        var FRAME_X          = SCREEN_PAD;
        var FRAME_W          = 256 - SCREEN_PAD * 2;
        var FRAME_PAD_TOP    = 3;
        var FRAME_PAD_BOTTOM = 4;
        var SCROLLBAR_GUTTER = 6;
        var SCROLLBAR_X      = FRAME_X + FRAME_W - 5;
        var ROW_PITCH        = ROW_H + 1;
        var DIVIDER_H        = 5;        // 2 px above + 1 px line + 2 px below
        var KV_H             = 12;       // info rows are slightly tighter
        var MAX_BOTTOM_Y     = 128;
        var CANVAS_H         = 144;
        var INNER_LABEL_GAP  = 4;        // px between "Label:" and value

        // Cached connection details from /api/wifi/connection.
        // null while loading; on failure stays null and the modal
        // keeps the action rows but renders the info area as a
        // single 'unavailable' line.
        var details = null;
        var loading = true;
        var forgetting = false;

        function fetchDetails() {
            try {
                var xhr = new XMLHttpRequest();
                // secrets=1 makes the server include the WPA PSK
                // in the response (via `nmcli --show-secrets`).
                // Server runs as root so the lookup just works;
                // the password lives in `details.password` and is
                // rendered inline by the Password row, masked
                // until PTT is held.
                // `name=<connName>` fetches the specific saved
                // profile rather than defaulting to whatever's
                // active — required for the saved-networks
                // drilldown path.
                var url = '/api/wifi/connection?secrets=1&name='
                    + encodeURIComponent(connName);
                xhr.open('GET', url, true);
                xhr.timeout = 3000;
                xhr.onload = function() {
                    loading = false;
                    if (xhr.status === 200) {
                        try { details = JSON.parse(xhr.responseText); }
                        catch (e) { details = null; }
                    }
                    if (window.requestRender) window.requestRender();
                };
                xhr.onerror = function() { loading = false; };
                xhr.ontimeout = function() { loading = false; };
                xhr.send();
            } catch (e) { loading = false; }
        }
        fetchDetails();

        // Velocity tracking — same window/projection constants the
        // App Switcher's drag uses, so the feel matches.
        var TP_VELOCITY_WINDOW_MS     = 100;
        var TP_VELOCITY_PROJECTION_MS = 150;
        // Sensitivity divider: raw touchpad units → scroll pixels.
        // 1.0 = pixel-for-pixel (felt too twitchy on real hardware,
        // a small finger nudge launched the list across the modal).
        // ~2.5 makes a full-modal swipe correspond to roughly half
        // the modal height of scroll, which feels more in-control.
        // Applied to BOTH the live drag delta and the momentum
        // projection so flicks decelerate at the same scale.
        var TP_SCROLL_DIVIDER         = 2.5;

        // Build the unified row list. Each row carries enough info
        // for both rendering and navigation (kind / selectable /
        // optional onPress / onToggle / etc.). Built fresh per
        // render so it tracks live state (loading → loaded,
        // address changes, etc.).
        function buildRows() {
            var rows = [];
            // ── Actions ──
            // Disconnect — only meaningful while THIS profile is
            // the currently-active connection. Sits at the top
            // since it's the most-likely action when viewing
            // your live network. For inactive saved profiles
            // the row is omitted (nothing to disconnect from).
            var live = UI.getWifiInfo();
            var isActive = !!(live && live.connected
                              && live.ssid === connName);
            if (isActive) {
                rows.push({
                    kind: 'action', text: 'Disconnect',
                    selectable: true,
                    onPress: function() { doDisconnect(); }
                });
                rows.push({ kind: 'sectionDivider', selectable: false });
            }
            // Forget — destructive action. Sits below Disconnect
            // (when active) so the Disconnect / Forget pair reads
            // top-to-bottom by severity: leave the network vs
            // delete the saved profile entirely.
            rows.push({
                kind: 'action', text: 'Forget this network',
                selectable: true,
                onPress: function() { doForget(); }
            });
            rows.push({ kind: 'sectionDivider', selectable: false });
            // Auto join + Password — paired group, no divider
            // between them. A 1-px `pad` row sits between to
            // breathe without committing to a full-row gap.
            rows.push({
                kind: 'action', text: 'Auto join',
                isToggle: true, selectable: true,
                getStatus: function() {
                    if (!details) return '—';
                    return details.autoconnect ? 'ON' : 'OFF';
                },
                onToggle: function() {
                    if (!details) return;
                    // Optimistic flip; backend modify-call wiring
                    // can land in a follow-up.
                    details.autoconnect = !details.autoconnect;
                    if (window.requestRender) window.requestRender();
                }
            });
            rows.push({ kind: 'pad', selectable: false });
            // Password row — selectable for navigation only.
            // No onPress, so the OK handler's `hasAction` guard
            // skips the 30 ms press flash; pressing/holding OK
            // is silent. Reveal happens entirely through the
            // render branch's `isSelected && Input.isHeld('ok')`
            // check, so the asterisks swap to the real PSK
            // without any black-row flash interfering.
            rows.push({
                kind: 'passwordInline', text: 'Password',
                selectable: true
            });
            // 1 px pad row between Password and the section
            // divider below — pushes the divider 1 px further
            // down so it sits with a touch more breathing room.
            rows.push({ kind: 'pad', selectable: false });
            // ── Info — two ComponentSelectorFrame cards ──
            // IPv4 and IPv6 are separate selectable targets. Each
            // wraps its own kv lines; selection moves between
            // them like any other row, and OK on either is a
            // future hook for an edit page. Splitting into two
            // cards (instead of one combined block) makes the
            // selection more granular without exposing every
            // single line as its own row.
            rows.push({ kind: 'sectionDivider', selectable: false });
            var ipv4Lines = buildIpv4Lines();
            var ipv6Lines = buildIpv6Lines();
            // If neither side has data (loading / disconnected),
            // fall back to a single 'unavailable' card so the
            // user sees *something* in the info section.
            if (ipv4Lines.length === 0 && ipv6Lines.length === 0) {
                var unavailLines = [{
                    kind: 'unavailable',
                    text: loading ? 'Loading…' : 'Unavailable'
                }];
                rows.push({
                    kind: 'cardBlock', selectable: true,
                    cardId: 'unavail', lines: unavailLines,
                    onPress: function() {}
                });
                return rows;
            }
            if (ipv4Lines.length > 0) {
                rows.push({
                    kind: 'cardBlock', selectable: true,
                    cardId: 'ipv4', lines: ipv4Lines,
                    onPress: function() { /* future: IPv4 edit page */ }
                });
            }
            // Tiny gap row between the two cards so their
            // selection frames don't kiss when the user moves
            // focus from one to the other.
            if (ipv4Lines.length > 0 && ipv6Lines.length > 0) {
                rows.push({ kind: 'pad', selectable: false });
            }
            if (ipv6Lines.length > 0) {
                rows.push({
                    kind: 'cardBlock', selectable: true,
                    cardId: 'ipv6', lines: ipv6Lines,
                    onPress: function() { /* future: IPv6 edit page */ }
                });
            }
            return rows;
        }
        // IPv4 lines for the IPv4 card. Empty when not connected
        // or still loading — the caller substitutes an
        // 'unavailable' card.
        function buildIpv4Lines() {
            if (!details || details.connected === false) return [];
            var lines = [];
            lines.push({ kind: 'kv',
                label: 'Method:', value: formatMethod(details.ipv4.method) });
            pushAddressLines(lines, 'IPv4:', details.ipv4.addresses);
            if (details.ipv4.gateway) {
                lines.push({ kind: 'kv',
                    label: 'Gateway:', value: details.ipv4.gateway });
            }
            pushAddressLines(lines, 'DNS:',
                details.ipv4.dns ? details.ipv4.dns.split(',').filter(Boolean) : []);
            return lines;
        }
        // IPv6 lines for the IPv6 card. Same shape as IPv4 but
        // off the v6 sub-object.
        function buildIpv6Lines() {
            if (!details || details.connected === false) return [];
            var lines = [];
            lines.push({ kind: 'kv',
                label: 'Method:', value: formatMethod(details.ipv6.method) });
            pushAddressLines(lines, 'IPv6:', details.ipv6.addresses);
            if (details.ipv6.gateway) {
                lines.push({ kind: 'kv',
                    label: 'Gateway:', value: details.ipv6.gateway });
            }
            pushAddressLines(lines, 'DNS:',
                details.ipv6.dns ? details.ipv6.dns.split(',').filter(Boolean) : []);
            return lines;
        }
        function pushAddressLines(lines, label, arr) {
            if (!Array.isArray(arr) || arr.length === 0) return;
            if (arr.length === 1) {
                lines.push({ kind: 'kv', label: label, value: arr[0] });
            } else {
                lines.push({ kind: 'sub', text: label });
                for (var ii = 0; ii < arr.length; ii++) {
                    lines.push({ kind: 'value', text: arr[ii] });
                }
            }
        }
        // Per-line height inside the DHCP block. Mirrors the
        // outer rowHeightOf vocabulary so divider math stays
        // identical to what the previous flat list produced.
        function lineHeightOf(ln) {
            // Tightened by 1 px on top AND 1 px on bottom,
            // matching the row-level divider rule.
            if (ln.kind === 'divider') return DIVIDER_H - 2;
            return KV_H;
        }
        // Total card height, including a small top + bottom
        // padding so the frame doesn't kiss the first / last
        // line.
        var CARD_BLOCK_PAD_TOP    = 2;
        var CARD_BLOCK_PAD_BOTTOM = 2;
        function cardBlockHeight(lines) {
            var h = CARD_BLOCK_PAD_TOP + CARD_BLOCK_PAD_BOTTOM;
            for (var i = 0; i < lines.length; i++) h += lineHeightOf(lines[i]);
            return h;
        }

        var disconnecting = false;
        function doDisconnect() {
            if (disconnecting) return;
            disconnecting = true;
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/wifi/disconnect', true);
                xhr.timeout = 12000;
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.onload = function() {
                    disconnecting = false;
                    if (xhr.status === 200) {
                        // Link dropped — close the modal; the
                        // /api/wifi poller will catch the new
                        // disconnected state and rebuild the
                        // wifi page's items list.
                        self._modal = null;
                        if (self._modalAnimTimer) {
                            clearInterval(self._modalAnimTimer);
                            self._modalAnimTimer = null;
                        }
                        if (window.requestRender) window.requestRender();
                    }
                };
                xhr.onerror   = function() { disconnecting = false; };
                xhr.ontimeout = function() { disconnecting = false; };
                xhr.send(JSON.stringify({ name: connName }));
            } catch (e) { disconnecting = false; }
        }

        function doForget() {
            if (forgetting) return;
            forgetting = true;
            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/wifi/forget', true);
                xhr.timeout = 5000;
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.onload = function() {
                    forgetting = false;
                    if (xhr.status === 200) {
                        // Connection deleted — close the modal,
                        // /api/wifi will report disconnected on
                        // the next poll and the wifi page rebuilds
                        // its items list without the connected row.
                        self._modal = null;
                        if (self._modalAnimTimer) {
                            clearInterval(self._modalAnimTimer);
                            self._modalAnimTimer = null;
                        }
                        if (window.requestRender) window.requestRender();
                    }
                };
                xhr.onerror = function() { forgetting = false; };
                xhr.ontimeout = function() { forgetting = false; };
                xhr.send(JSON.stringify({ name: connName }));
            } catch (e) { forgetting = false; }
        }

        function formatMethod(m) {
            if (m === 'auto')     return 'DHCP';
            if (m === 'manual')   return 'Manual';
            if (m === 'disabled') return 'Disabled';
            return m || '—';
        }

        // Per-row height helper (selection + scroll math both use
        // it; render reads it inside the row loop too).
        function rowHeightOf(row) {
            // Divider heights are 2 px shorter than they used to
            // be — top AND bottom padding each shrunk by 1 so
            // the rows on either side sit closer to the rule.
            // Line stays 1 px below the row top.
            if (row.kind === 'sectionDivider') return 2;
            if (row.kind === 'divider')        return DIVIDER_H - 2;
            if (row.kind === 'action')         return ROW_H;
            // Password row matches action-row height again now
            // that the dark inline frame is gone — just plain
            // text + the right-aligned PTT_reveal icon.
            if (row.kind === 'passwordInline') return ROW_H;
            // 1-px no-paint spacer between Auto join and Password —
            // gives the toggle pair `+1 px` of breathing room
            // without injecting a full row of empty space.
            if (row.kind === 'pad')            return 1;
            // The IPv4 / IPv6 info cards grow to fit their lines
            // plus a small inner padding.
            if (row.kind === 'cardBlock')      return cardBlockHeight(row.lines);
            return KV_H;
        }

        // Modal state. Selection moves through every row whose
        // `selectable` flag is true (skipping dividers). Scroll
        // is in pixels — keeps the math consistent for the
        // touchpad-driven case where finger movement directly
        // perturbs `_cdScrollPx`.
        self._cdSelected  = 0;
        self._cdScrollPx  = 0;
        self._cdPressed   = -1;
        // Touchpad drag state.
        self._cdTouching        = false;
        self._cdBaselineY       = 0;
        self._cdBaselineScrollPx = 0;
        self._cdVelSamples      = [];
        // Snap-back lerp used for the post-release momentum tail
        // (interpolates _cdScrollPx from start to target across
        // duration ms with easeOutCubic).
        self._cdSnapStart   = 0;
        self._cdSnapTarget  = 0;
        self._cdSnapStartTs = 0;
        self._cdSnapDur     = 0;

        var listSelector = new MenuSelectorFrame({
            x: 0, y: 0, width: 1, height: ROW_H + 2,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
        var tab = new UI.TabHeader(ssid);
        tab.x = FRAME_X;
        tab.h = TAB_H;

        // Layout — viewport is always at the max modal height
        // because content can scroll. (Sizing-to-content like the
        // visible-networks modal would conflict with the scroll
        // semantics.)
        function computeLayout() {
            var rows = buildRows();
            // Pre-compute each row's y offset within the content,
            // plus total content height.
            var rowOffsets = [];
            var contentH = 0;
            for (var i = 0; i < rows.length; i++) {
                rowOffsets.push(contentH);
                contentH += rowHeightOf(rows[i]);
            }
            var maxModalH = MAX_BOTTOM_Y - SCREEN_PAD;
            var maxFrameH = maxModalH - TAB_H;
            // Frame is min(content+padding, maxFrameH).
            var frameH = Math.min(maxFrameH,
                contentH + FRAME_PAD_TOP + FRAME_PAD_BOTTOM);
            var modalH    = TAB_H + frameH;
            var centeredY = Math.floor((CANVAS_H - modalH) / 2);
            var pinnedY   = MAX_BOTTOM_Y - modalH;
            var topY = Math.min(centeredY, pinnedY);
            if (topY < SCREEN_PAD) topY = SCREEN_PAD;
            var frameY      = topY + TAB_H;
            var innerTop    = frameY + FRAME_PAD_TOP;
            var innerBottom = frameY + frameH - FRAME_PAD_BOTTOM;
            var innerH      = innerBottom - innerTop;
            return { topY: topY, frameY: frameY, frameH: frameH,
                     innerTop: innerTop, innerBottom: innerBottom,
                     innerH: innerH, contentH: contentH,
                     rows: rows, rowOffsets: rowOffsets };
        }

        // Walk to the next selectable row (wraps).
        function nextSelectable(rows, idx, dir) {
            var n = rows.length;
            for (var step = 0; step < n; step++) {
                idx = (idx + dir + n) % n;
                if (rows[idx].selectable) return idx;
            }
            return -1;
        }

        // Make sure the selected row is visible inside the
        // viewport. Adjusts `_cdScrollPx` accordingly. Cancels any
        // active snap so the keyboard scroll wins immediately.
        function ensureSelectedVisible() {
            var L = computeLayout();
            self._cdSnapDur = 0;
            if (self._cdSelected < 0 || self._cdSelected >= L.rows.length) return;
            var rowY = L.rowOffsets[self._cdSelected];
            var rowH = rowHeightOf(L.rows[self._cdSelected]);
            var maxScroll = Math.max(0, L.contentH - L.innerH);
            if (rowY < self._cdScrollPx) {
                self._cdScrollPx = rowY;
            } else if (rowY + rowH > self._cdScrollPx + L.innerH) {
                self._cdScrollPx = rowY + rowH - L.innerH;
            }
            if (self._cdScrollPx > maxScroll) self._cdScrollPx = maxScroll;
            if (self._cdScrollPx < 0) self._cdScrollPx = 0;
        }

        // Snap-back animation — kicks off after a touchpad release
        // so the projected momentum eases to its target.
        function startSnap(targetScroll, durationMs) {
            var L = computeLayout();
            var maxScroll = Math.max(0, L.contentH - L.innerH);
            if (targetScroll < 0) targetScroll = 0;
            if (targetScroll > maxScroll) targetScroll = maxScroll;
            self._cdSnapStart   = self._cdScrollPx;
            self._cdSnapTarget  = targetScroll;
            self._cdSnapStartTs = Date.now();
            self._cdSnapDur     = durationMs;
        }
        function tickSnap() {
            if (!self._cdSnapDur) return;
            var t = (Date.now() - self._cdSnapStartTs) / self._cdSnapDur;
            if (t >= 1) {
                self._cdScrollPx = self._cdSnapTarget;
                self._cdSnapDur = 0;
                return;
            }
            var e = 1 - Math.pow(1 - t, 3);   // easeOutCubic
            self._cdScrollPx = self._cdSnapStart
                + (self._cdSnapTarget - self._cdSnapStart) * e;
        }

        // Touchpad SSE: same /api/touchpad/xy stream the App
        // Switcher uses. Here Y delta drives `_cdScrollPx`
        // directly (1 raw unit = 1 px); on release the recent
        // velocity projects forward into a snap-back lerp.
        function handleTouchpadMessage(e) {
            var p = e.data.split(',');
            if (p.length < 3) return;
            var ny = +p[1], nt = +p[2];
            if (ny !== ny || (nt !== 0 && nt !== 1)) return;
            var nowTouching  = (nt === 1);
            var prevTouching = self._cdTouching;
            var ts           = Date.now();

            if (nowTouching && !prevTouching) {
                self._cdBaselineY        = ny;
                self._cdBaselineScrollPx = self._cdScrollPx;
                self._cdVelSamples       = [{ y: ny, ts: ts }];
                self._cdSnapDur          = 0;   // cancel any in-flight snap
            }
            if (nowTouching) {
                // Direct-manipulation (iOS-style) inversion:
                // finger DOWN on the pad pulls the content DOWN,
                // so the viewport reveals content ABOVE — i.e.
                // scrollPx decreases. Sign flip on the raw delta
                // is all we need; tracking stays sub-pixel since
                // _cdScrollPx is a float, only rounded at render.
                var dy = -(ny - self._cdBaselineY) / TP_SCROLL_DIVIDER;
                var L = computeLayout();
                var maxScroll = Math.max(0, L.contentH - L.innerH);
                var ns = self._cdBaselineScrollPx + dy;
                if (ns < 0) ns = 0;
                if (ns > maxScroll) ns = maxScroll;
                self._cdScrollPx = ns;
                // Velocity samples — trim to the last window.
                self._cdVelSamples.push({ y: ny, ts: ts });
                while (self._cdVelSamples.length > 0
                       && (ts - self._cdVelSamples[0].ts) > TP_VELOCITY_WINDOW_MS) {
                    self._cdVelSamples.shift();
                }
            }
            if (!nowTouching && prevTouching) {
                // Touch-up: project momentum + ease to rest.
                // Sign flip mirrors the live drag above so the
                // momentum continues in the same direction the
                // finger was already moving the content.
                var samples = self._cdVelSamples;
                var velUnitsPerMs = 0;
                if (samples.length >= 2) {
                    var first = samples[0];
                    var last  = samples[samples.length - 1];
                    var dt    = last.ts - first.ts;
                    if (dt > 0) velUnitsPerMs = -(last.y - first.y) / dt;
                }
                var projectedExtra = (velUnitsPerMs * TP_VELOCITY_PROJECTION_MS) / TP_SCROLL_DIVIDER;
                var target = self._cdScrollPx + projectedExtra;
                var dist   = Math.abs(target - self._cdScrollPx);
                // Duration scales with distance, capped so a big
                // flick decelerates smoothly without taking
                // forever to settle.
                var dur = Math.max(150, Math.min(600, dist * 2));
                startSnap(target, dur);
                self._cdVelSamples = [];
            }
            self._cdTouching = nowTouching;
            if (window.requestRender) window.requestRender();
        }

        // Subscribe to the touchpad stream while the modal is open.
        try {
            self._cdTouchES = new EventSource('/api/touchpad/xy');
            self._cdTouchES.onmessage = handleTouchpadMessage;
            self._cdTouchES.onerror   = function() {};
        } catch (e) { self._cdTouchES = null; }

        function closeModal() {
            self._modal = null;
            if (self._modalAnimTimer) {
                clearInterval(self._modalAnimTimer);
                self._modalAnimTimer = null;
            }
            if (self._cdTouchES) {
                self._cdTouchES.close();
                self._cdTouchES = null;
            }
            if (window.requestRender) window.requestRender();
        }

        this._modal = {
            handleInput: function(action) {
                if (action === 'back' || action === 'esc') {
                    closeModal();
                    return true;
                }
                var rows = buildRows();
                if (action === 'down') {
                    self._cdSelected = nextSelectable(rows, self._cdSelected, 1);
                    ensureSelectedVisible();
                    if (window.requestRender) window.requestRender();
                    return true;
                }
                if (action === 'up') {
                    self._cdSelected = nextSelectable(rows, self._cdSelected, -1);
                    ensureSelectedVisible();
                    if (window.requestRender) window.requestRender();
                    return true;
                }
                var sel = rows[self._cdSelected];
                if ((action === 'left' || action === 'right') && sel && sel.isToggle) {
                    if (sel.onToggle) sel.onToggle();
                    return true;
                }
                if (action === 'ok' || action === 'run') {
                    // Only fire press flash + callback when the
                    // row actually has an action wired. Rows that
                    // are selectable for navigation only (e.g.
                    // the Password row, which surfaces its mask
                    // via PTT-held, not OK) consume the action
                    // silently without flashing.
                    var hasAction = !!(sel && (sel.onToggle || sel.onPress));
                    if (!hasAction) return true;
                    self._cdPressed = self._cdSelected;
                    if (window.requestRender) window.requestRender();
                    setTimeout(function() {
                        self._cdPressed = -1;
                        if (window.requestRender) window.requestRender();
                    }, 30);
                    if (sel.isToggle && sel.onToggle) sel.onToggle();
                    else if (sel.onPress) sel.onPress();
                    return true;
                }
                return false;
            },
            render: function(canvas) {
                tickSnap();
                var ctx = canvas.ctx;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
                ctx.fillRect(0, 0, canvas.w, canvas.h);

                var L = computeLayout();
                var INNER_X = FRAME_X + 3;
                var dynInnerW = FRAME_W - 6;
                var needsScroll = L.contentH > L.innerH;
                if (needsScroll) dynInnerW -= SCROLLBAR_GUTTER;

                tab.y = L.topY;

                var frame = new ResponsiveFrame({
                    x: FRAME_X, y: L.frameY,
                    width: FRAME_W, height: L.frameH,
                    anchorH: 'left', anchorV: 'top',
                    strokeColor: '#000', showStroke: true,
                    fillColor: '#ffffff', showFill: true,
                    // 3 px corner radius across both sides of the
                    // body — keeps left (BL) and right (TR/BR)
                    // visually consistent, and matches the
                    // ComponentSelectorFrame chevron-bar curvature
                    // on screens where the bar runs along the
                    // right edge.
                    cornerRadius: 3,
                    corners: { tl: false, tr: true, bl: true, br: true }
                });
                frame.render(canvas);
                tab.render(canvas);

                // Clip to inner area so the scrolled rows don't
                // bleed outside the frame body.
                ctx.save();
                ctx.beginPath();
                ctx.rect(FRAME_X + 1, L.frameY + 1, FRAME_W - 2, L.frameH - 2);
                ctx.clip();

                var rows = L.rows;
                var selectedY = -1;
                // Sub-pixel scroll position lives on the scene
                // (_cdScrollPx is a float — touchpad drag and
                // momentum projection both write fractional
                // values). Round ONLY at the render boundary so
                // glyphs and frame edges land on whole pixels.
                // The sub-pixel state still accumulates smoothly
                // underneath, which keeps slow drags from getting
                // "stuck" between integer rows.
                var scrollRounded = Math.round(self._cdScrollPx);
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    var rowAbsY = L.innerTop + L.rowOffsets[i] - scrollRounded;
                    var rh = rowHeightOf(row);
                    if (rowAbsY + rh < L.innerTop) continue;
                    if (rowAbsY > L.innerBottom)   break;

                    var isSelected = (i === self._cdSelected);
                    var isPressed  = (i === self._cdPressed);
                    if (isSelected) selectedY = rowAbsY;
                    var fg    = isPressed ? '#fff' : '#000';
                    var fgDim = isPressed ? '#fff' : '#999999';

                    if (isPressed && row.selectable) {
                        canvas.drawRoundRect(INNER_X, rowAbsY - 1,
                            dynInnerW, rh + 2, 2, '#000');
                    }

                    if (row.kind === 'sectionDivider') {
                        // Divider line is 3 px shorter on each side
                        // than the inner content width so it visually
                        // recedes from the frame edges. Top padding
                        // dropped to 1 px (was 2) per the latest
                        // tightening pass.
                        canvas.drawHLine(INNER_X + 3, rowAbsY + 1,
                            dynInnerW - 6, '#CCCCCC');
                    } else if (row.kind === 'divider') {
                        // Same 3-px-each-side inset as the section
                        // divider above; line sits 1 px below the
                        // row top, leaving the bottom padding alone.
                        canvas.drawHLine(INNER_X + 3, rowAbsY + 1,
                            dynInnerW - 6, '#CCCCCC');
                    } else if (row.kind === 'action') {
                        HaxrcorpFont16.draw(ctx, row.text,
                            INNER_X + 5, rowAbsY + 1, fg);
                        if (row.isToggle && row.getStatus) {
                            self._drawToggleStatus(canvas, row, isSelected,
                                INNER_X, dynInnerW, rowAbsY + 1,
                                isSelected ? '#000' : '#999999');
                        } else if (row.chevron) {
                            var ch  = '>';
                            var cw  = HaxrcorpFont16.textWidth(ch);
                            var col = isSelected ? fg : fgDim;
                            HaxrcorpFont16.draw(ctx, ch,
                                INNER_X + dynInnerW - cw - 2,
                                rowAbsY + 1, col);
                        }
                    } else if (row.kind === 'passwordInline') {
                        // "Password" label left-aligned, masked
                        // PSK right-aligned. No icon, no backing
                        // rectangle — the text sits flat on the
                        // modal's white body. Reveal-while-held
                        // is now driven by the OK key (no PTT
                        // affordance icon since the verbose view
                        // already has the row selected for OK
                        // when the user wants to read the PSK).
                        var RIGHT_PAD = 2;

                        // Label.
                        HaxrcorpFont16.draw(ctx, row.text,
                            INNER_X + 5, rowAbsY + 1, fg);

                        // Reveal trigger: hold the OK action
                        // (Enter / k) WHILE THIS ROW IS HIGHLIGHTED.
                        // Outside this row OK does its normal job
                        // (e.g. pressing actions); only when the
                        // selector is on the password row does
                        // OK-held swap the asterisks for the
                        // actual PSK.
                        var revealing = isSelected && !!(window.input
                            && typeof window.input.isHeld === 'function'
                            && window.input.isHeld('ok'));
                        var pwText, pwColor, pwTextDy = 0;
                        if (loading) {
                            pwText = '…';            pwColor = '#999999';
                        } else if (!details || details.connected === false) {
                            pwText = '—';            pwColor = '#999999';
                        } else if (!details.password) {
                            pwText = 'open';         pwColor = '#999999';
                        } else if (revealing) {
                            pwText = details.password;
                            pwColor = isPressed ? '#fff' : '#000';
                        } else {
                            // Asterisks (font has them; U+2022
                            // bullet doesn't exist in the bitmap).
                            // Length matches the real PSK so a
                            // short and a long password read as
                            // visually different.
                            var maskN = details.password.length;
                            pwText = '';
                            for (var pmk = 0; pmk < maskN; pmk++) pwText += '*';
                            pwColor = isPressed ? '#fff' : '#000';
                            // The `*` glyph sits high in
                            // HaxrcorpFont16 (cap near the ascender)
                            // — push it 2 px down so the dots read
                            // as visually centred against the row.
                            pwTextDy = 2;
                        }
                        // Right-align the text against the inner
                        // content edge. Truncate from the LEFT
                        // (tail stays visible, which is the part
                        // people glance at first) until the
                        // remaining string fits between the
                        // "Password" label and the right edge.
                        var rightAnchor = INNER_X + dynInnerW - RIGHT_PAD;
                        var labelEnd = INNER_X + 5
                            + HaxrcorpFont16.textWidth(row.text) + 6;
                        var maxTextW = rightAnchor - labelEnd;
                        if (maxTextW < 0) maxTextW = 0;
                        var fitText = pwText;
                        while (fitText.length > 0
                               && HaxrcorpFont16.textWidth(fitText) > maxTextW) {
                            fitText = fitText.substring(1);
                        }
                        var pwTextX = rightAnchor - HaxrcorpFont16.textWidth(fitText);
                        HaxrcorpFont16.draw(ctx, fitText,
                            pwTextX, rowAbsY + 1 + pwTextDy, pwColor);
                    } else if (row.kind === 'unavailable') {
                        HaxrcorpFont16.draw(ctx, row.text,
                            INNER_X + 5, rowAbsY + 1, '#999999');
                    } else if (row.kind === 'kv') {
                        var lblColor = isPressed ? '#fff' : '#6D6D6D';
                        HaxrcorpFont16.draw(ctx, row.label,
                            INNER_X + 5, rowAbsY + 1, lblColor);
                        var lblW = HaxrcorpFont16.textWidth(row.label);
                        HaxrcorpFont16.draw(ctx, String(row.value),
                            INNER_X + 5 + lblW + INNER_LABEL_GAP,
                            rowAbsY + 1, fg);
                    } else if (row.kind === 'sub') {
                        HaxrcorpFont16.draw(ctx, row.text,
                            INNER_X + 5, rowAbsY + 1,
                            isPressed ? '#fff' : '#6D6D6D');
                    } else if (row.kind === 'value') {
                        HaxrcorpFont16.draw(ctx, row.text,
                            INNER_X + 14, rowAbsY + 1,
                            isPressed ? '#fff' : '#000');
                    } else if (row.kind === 'pad') {
                        // Intentional no-op: just contributes 1 px
                        // of vertical space between Auto join and
                        // Password.
                    } else if (row.kind === 'cardBlock') {
                        // Always reserve a chevron-bar gutter on
                        // the right so the selected/unselected
                        // states have identical text wrapping —
                        // the frame painting is the only thing
                        // that flips when selection moves on/off
                        // the card.
                        var BLOCK_CHEVRON_W = 6;
                        var BLOCK_INNER_X = INNER_X + 4;
                        var BLOCK_INNER_W = dynInnerW - BLOCK_CHEVRON_W - 6;
                        var ly = rowAbsY + CARD_BLOCK_PAD_TOP;
                        for (var li = 0; li < row.lines.length; li++) {
                            var ln = row.lines[li];
                            var lh = lineHeightOf(ln);
                            var lnFg     = isPressed ? '#fff' : '#000';
                            var lnLbl    = isPressed ? '#fff' : '#6D6D6D';
                            if (ln.kind === 'divider') {
                                // 3-px inset on each side, top
                                // padding 1 px — matches the
                                // tightened divider style used
                                // by the row-level dividers
                                // above.
                                canvas.drawHLine(BLOCK_INNER_X + 3,
                                    ly + 1,
                                    BLOCK_INNER_W - 6, '#E5E5E5');
                            } else if (ln.kind === 'unavailable') {
                                HaxrcorpFont16.draw(ctx, ln.text,
                                    BLOCK_INNER_X + 1, ly + 1, '#999999');
                            } else if (ln.kind === 'kv') {
                                HaxrcorpFont16.draw(ctx, ln.label,
                                    BLOCK_INNER_X + 1, ly + 1, lnLbl);
                                var lnLblW = HaxrcorpFont16.textWidth(ln.label);
                                HaxrcorpFont16.draw(ctx, String(ln.value),
                                    BLOCK_INNER_X + 1 + lnLblW + INNER_LABEL_GAP,
                                    ly + 1, lnFg);
                            } else if (ln.kind === 'sub') {
                                HaxrcorpFont16.draw(ctx, ln.text,
                                    BLOCK_INNER_X + 1, ly + 1,
                                    isPressed ? '#fff' : '#6D6D6D');
                            } else if (ln.kind === 'value') {
                                HaxrcorpFont16.draw(ctx, ln.text,
                                    BLOCK_INNER_X + 10, ly + 1,
                                    isPressed ? '#fff' : '#000');
                            }
                            ly += lh;
                        }
                    }
                }
                ctx.restore();

                // Selector frame around selected row (skipped
                // during press flash — the filled black already
                // conveys focus then). The IPv4 / IPv6 cards use
                // a ComponentSelectorFrame (with chevron bar)
                // since each whole card is the selectable target;
                // everything else uses the thin per-row
                // MenuSelectorFrame.
                //
                // CLIPPED to the modal body interior (same rect
                // the row-text loop above uses) so the selector
                // outline can't bleed past the modal's rounded
                // frame edges when the highlighted row is at
                // the very top or bottom of the visible area.
                if (selectedY >= 0 && self._cdPressed !== self._cdSelected) {
                    var selRow = rows[self._cdSelected];
                    // Password row needs an extra 2 px above and
                    // below so the selection ring breathes around
                    // the inline mask + icon. Other rows keep the
                    // 1-px-each-side default.
                    var isPwRow = (selRow.kind === 'passwordInline');
                    var topPad  = isPwRow ? 3 : 1;
                    var botPad  = isPwRow ? 3 : 1;
                    var sH      = rowHeightOf(selRow) + topPad + botPad;
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(FRAME_X + 1, L.frameY + 1, FRAME_W - 2, L.frameH - 2);
                    ctx.clip();
                    if (selRow.kind === 'cardBlock') {
                        var csf = new ComponentSelectorFrame({
                            x: INNER_X, y: selectedY - topPad,
                            width: dynInnerW, height: sH,
                            anchorH: 'left', anchorV: 'top',
                            cornerRadius: 3,
                            strokeColor: '#000', showStroke: true,
                            fillColor: '#ffffff', showFill: false,
                            showChevron: true,
                            chevronWidth: 7,
                            chevronColor: '#666666',
                            chevronGlyphColor: '#ffffff'
                        });
                        csf.render(canvas);
                    } else {
                        listSelector.setSize(dynInnerW, sH);
                        listSelector.setPosition(INNER_X, selectedY - topPad);
                        listSelector.render(canvas);
                    }
                    ctx.restore();
                }

                // Scrollbar — shown whenever content exceeds the
                // viewport. Pixel-space totals so the helper's
                // thumb math just maps the same units.
                if (needsScroll) {
                    var sb = new UI.Scrollbar(L.contentH, L.innerH,
                        Math.round(self._cdScrollPx));
                    sb.render(canvas, SCROLLBAR_X, L.innerTop, L.innerH, 1);
                }

            }
        };

        // Anim ticker — keeps the modal redrawing while the snap
        // lerp is running, during touchpad drag, AND while the
        // user holds PTT to reveal the password (the inline
        // password row reads `window.input.isHeld('ptt')` per
        // render and the timer guarantees a redraw cadence even
        // when no other action is in flight).
        if (this._modalAnimTimer) clearInterval(this._modalAnimTimer);
        this._modalAnimTimer = setInterval(function() {
            if (window.requestRender) window.requestRender();
        }, 60);

        if (window.requestRender) window.requestRender();
    };

    WifiScene.prototype.handleInput = function(action) {
        // Modal owns all input while it's open. Returns truthy
        // when it consumed the action; falsy means we ignore it
        // (modal traps everything except its own dismiss path).
        if (this._modal) {
            this._modal.handleInput(action);
            return;
        }

        var sel = this.items[this.selectedIndex];
        var n   = this.items.length;

        if (action === 'back' || action === 'esc') return 'pop';

        if (action === 'down') {
            this.selectedIndex = this._nextSelectable(this.selectedIndex, 1);
            return;
        }
        if (action === 'up') {
            this.selectedIndex = this._nextSelectable(this.selectedIndex, -1);
            return;
        }

        if ((action === 'left' || action === 'right') && sel && sel.isToggle) {
            if (sel.onToggle) sel.onToggle();
            this._flashArrow(action);
            return;
        }

        if (action === 'ok' || action === 'run') {
            if (sel && sel.isToggle && sel.onToggle) {
                sel.onToggle();
                return;
            }
            if (sel && sel.onPress) {
                sel.onPress();
                return;
            }
        }
    };

    WifiScene.prototype._drawToggleStatus = function(canvas, item, isSelected, x, w, y, color) {
        var ctx     = canvas.ctx;
        var midTxt  = item.getStatus();   // 'ON' or 'OFF'
        var rightX  = x + w - STATUS_RIGHT_PAD;
        if (!isSelected) {
            // Idle: just the value, right-aligned.
            var dimW = HaxrcorpFont16.textWidth(midTxt);
            HaxrcorpFont16.draw(ctx, midTxt, rightX - dimW, y, color);
            return;
        }
        // Selected: "< value >" with chevrons spaced like MenuLine
        // does. Width is laid out from the right edge backwards so
        // the > sticks to STATUS_RIGHT_PAD and the rest follows.
        var ltW   = HaxrcorpFont16.textWidth('<');
        var midW  = HaxrcorpFont16.textWidth('OFF');
        var gtW   = HaxrcorpFont16.textWidth('>');
        var gtX   = rightX - gtW;
        var ltX   = gtX - TOGGLE_SPACING - midW - TOGGLE_SPACING - ltW;
        var midBase = ltX + ltW + TOGGLE_SPACING;
        var midTxtW = HaxrcorpFont16.textWidth(midTxt);
        var midX    = Math.floor(midBase + (midW - midTxtW) / 2);
        var ltCol = (this._arrowPressed === 'left')  ? '#222222' : color;
        var gtCol = (this._arrowPressed === 'right') ? '#222222' : color;
        HaxrcorpFont16.draw(ctx, '<',     ltX,  y, ltCol);
        HaxrcorpFont16.draw(ctx, midTxt,  midX, y, color);
        HaxrcorpFont16.draw(ctx, '>',     gtX,  y, gtCol);
    };

    WifiScene.prototype.render = function(canvas) {
        // Refresh the items list so the connected-network row
        // appears / disappears in step with the live wifi state.
        this._buildItems();
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // Breadcrumb trail — derived from SceneManager.breadcrumb(),
        // which walks the stack bottom→top and collects every
        // scene's `breadcrumbTitle`. Falls back to this scene's
        // own `breadcrumbTitle` if no scene manager is wired (the
        // standalone-render path used by some tests). Same accent
        // colour SubMenuScene uses (#CCCCCC).
        var titles = (this.sceneManager && typeof this.sceneManager.breadcrumb === 'function')
            ? this.sceneManager.breadcrumb()
            : (this.breadcrumbTitle ? [this.breadcrumbTitle] : []);
        var trail = titles.length ? '> ' + titles.join(' > ') : '';
        if (trail) {
            HaxrcorpFont16.draw(canvas.ctx, trail,
                BREADCRUMB_X, BREADCRUMB_Y, '#CCCCCC');
        }

        // Render each item. Dividers are now explicit entries in
        // the items list (kind === 'divider') marking GROUP
        // boundaries: the inline 1-px line still draws, but only
        // where the data says it should — not blindly between
        // every pair of rows. Within a group, rows sit directly
        // adjacent.
        var y = this.containerY;
        var selectedY = y;
        // Divider geometry — 3 px tall row carrying a 1 px line.
        // 1 px above + 1 px line + 1 px below balances the gap on
        // either side of the rule.
        var DIVIDER_ROW_H = 3;
        // Text y inside a row: HaxrcorpFont16's cap top sits 1 px
        // below the row's top → centred vertically against the
        // 13 px row (font is ~11 px tall, leaving 1 px margin
        // above and below).
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
            var labelColor = '#000';
            if (item.isConnected) {
                // Connected-network row: gray "Connected to:"
                // prefix + SSID in black on the same baseline.
                // The prefix narrates state; the SSID is the
                // actionable label, which should pop visually.
                var connPrefix = 'Connected to: ';
                var connPrefixW = HaxrcorpFont16.textWidth(connPrefix);
                HaxrcorpFont16.draw(canvas.ctx, connPrefix,
                    SELECTOR_X + TEXT_LEFT_PAD, y + TEXT_DY, '#999999');
                HaxrcorpFont16.draw(canvas.ctx, item.text,
                    SELECTOR_X + TEXT_LEFT_PAD + connPrefixW,
                    y + TEXT_DY, labelColor);
            } else {
                HaxrcorpFont16.draw(canvas.ctx, item.text,
                    SELECTOR_X + TEXT_LEFT_PAD, y + TEXT_DY, labelColor);
            }

            if (item.isToggle && item.getStatus) {
                var statusColor = isSelected ? '#000' : '#999999';
                this._drawToggleStatus(canvas, item, isSelected,
                    SELECTOR_X, SELECTOR_W, y + TEXT_DY, statusColor);
            }
            // Chevron rows DON'T get an inline `>` glyph any more.
            // The drill-in affordance lives on the
            // ComponentSelectorFrame's chevron bar, which only
            // shows up while the row is selected — unselected
            // chevron rows render as plain text.

            y += ROW_H;
            // Connected-network row gets +1 px breathing room
            // below before the next row starts. Doesn't grow the
            // selector frame (still ROW_H + 2) — the gap sits
            // between this selector and the next item, giving
            // the row a touch of visual separation from the
            // "See visible networks" line below.
            if (item.isConnected) y += 1;
        }

        // Selector frame around the highlighted row. Toggle row
        // → MenuSelectorFrame. Chevron rows → ComponentSelector-
        // Frame so the chevron bar appears only when selected.
        var selItem = this.items[this.selectedIndex];
        var useChevronFrame = !!(selItem && selItem.chevron && !selItem.isToggle);
        if (useChevronFrame) {
            this.chevronSelectorFrame.setPosition(SELECTOR_X, selectedY + SELECTOR_Y_OFFSET);
            this.chevronSelectorFrame.setSize(SELECTOR_W, SELECTOR_H);
            this.chevronSelectorFrame.render(canvas);
        } else {
            this.selectorFrame.setPosition(SELECTOR_X, selectedY + SELECTOR_Y_OFFSET);
            this.selectorFrame.setSize(SELECTOR_W, SELECTOR_H);
            this.selectorFrame.render(canvas);
        }

        // Modal sits on top of everything when open.
        if (this._modal) this._modal.render(canvas);
    };

    return WifiScene;
})();
