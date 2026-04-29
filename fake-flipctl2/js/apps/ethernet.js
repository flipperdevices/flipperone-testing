var EthernetScene = (function() {
    // Layout anchors (match the EthernetTab spec).
    var TAB_X         = 4;
    var TAB_W         = 248;
    var TAB_H         = 22;
    var TAB_GAP       = 3;
    var BREADCRUMB_X  = 4;

    // Mode switch row sits above ETH0. Compact HaxrcorpFont16 row —
    // label on the left, cycling value on the right (arrows appear
    // only while the row is selected, mirroring the MenuLine toggle).
    var MODE_Y        = 28;
    var MODE_H        = 14;
    var MODE_PAD_L    = 4;
    var MODE_PAD_R    = 4;
    var MODE_ARROW_PRESSED_MS = 120;
    var MODE_VALUES   = ['Manual'];
    var MODE_DEFAULT  = 0;

    // Per-mode role labels for (ETH0, ETH1). Dual WAN = both ports act
    // as independent WAN interfaces.
    var ROLE_BY_MODE = {
        'Manual': ['WAN', 'WAN']
    };

    // ETH tabs stack below the mode row — 1px more than TAB_GAP so the
    // switch's selector shadow has breathing room before ETH0.
    var TAB_Y         = MODE_Y + MODE_H + TAB_GAP + 1;  // = 46

    var data = null;
    var loading = true;
    var error = false;
    var pollTimer = null;

    // Skeleton placeholder: how many tabs to show while loading.
    var PLACEHOLDER_COUNT = 2;
    var PLACEHOLDER_PERIOD_MS = 1000;
    var PLACEHOLDER_RENDER_MS = 50;

    function placeholderColor() {
        var t = (Date.now() % PLACEHOLDER_PERIOD_MS) / PLACEHOLDER_PERIOD_MS;
        var phase = (1 - Math.cos(2 * Math.PI * t)) / 2;
        var v = Math.round(238 - 17 * phase);
        var hex = v.toString(16);
        if (hex.length < 2) hex = '0' + hex;
        return '#' + hex + hex + hex;
    }

    function fetchEthernet() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/ethernet', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                try { data = JSON.parse(xhr.responseText); } catch (e) { error = true; }
            } else {
                error = true;
            }
            loading = false;
            if (window.requestRender) window.requestRender();
        };
        xhr.onerror = function() {
            error = true; loading = false;
            if (window.requestRender) window.requestRender();
        };
        xhr.ontimeout = function() {
            error = true; loading = false;
            if (window.requestRender) window.requestRender();
        };
        xhr.send();
    }

    function isConnected(iface) {
        return !!(iface && iface.state
            && iface.state.indexOf('connected') !== -1
            && iface.state.indexOf('disconnected') === -1);
    }

    function stripCidr(addr) {
        return String(addr).split('/')[0];
    }

    function firstIpv4(iface) {
        if (!iface || !iface.ip4 || !iface.ip4.length) return '';
        return stripCidr(iface.ip4[0]);
    }

    function firstIpv6(iface) {
        if (!iface || !iface.ip6 || !iface.ip6.length) return '';
        var addr = stripCidr(iface.ip6[0]);
        // IPv6 addresses can be up to 39 chars — too long for the
        // bottom-left slot. Truncate after 30 and append "..." so the
        // user still sees the prefix.
        if (addr.length > 30) addr = addr.slice(0, 30) + '...';
        return addr;
    }

    // Map nmcli's ipv4.method to a short user-facing label.
    //   auto        → "DHCP"         (client, auto-configured)
    //   manual      → "Static"       (client, manual IP)
    //   shared      → "DHCP Server"  (this machine hands out leases)
    //   link-local  → "Link-local"
    //   disabled    → ""             (no IPv4)
    function formatDhcp(method) {
        if (!method) return '';
        switch (method) {
            case 'auto':       return 'DHCP Client';
            case 'manual':     return 'Static';
            case 'shared':     return 'DHCP Server';
            case 'link-local': return 'Link-local';
            case 'disabled':   return '';
            default:           return method;
        }
    }

    // Human-readable byte count (e.g. "10.6 MB").
    function formatBytes(n) {
        if (n === null || n === undefined) return '';
        var num = Number(n);
        if (!isFinite(num) || num < 0) return '';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var u = 0;
        while (num >= 1024 && u < units.length - 1) { num /= 1024; u++; }
        var str = (num >= 100 || u === 0) ? num.toFixed(0)
                : (num >= 10)             ? num.toFixed(1)
                                          : num.toFixed(2);
        return str + ' ' + units[u];
    }

    // Normalise ethtool speed strings into a short human label —
    // "1000Mb/s" → "1 Gb", "2500Mb/s" → "2.5 Gb", "100Mb/s" → "100 Mb".
    // Unknown formats are passed through unchanged so we never hide a
    // value we can't interpret.
    function formatSpeed(raw) {
        if (!raw) return '';
        var m = String(raw).match(/^(\d+(?:\.\d+)?)\s*(M|G)b(?:ps|\/s)?$/i);
        if (!m) return raw;
        var val = parseFloat(m[1]);
        var unit = m[2].toUpperCase();
        // Normalise to Mb.
        var mb = unit === 'G' ? val * 1000 : val;
        if (mb >= 1000) {
            var gb = mb / 1000;
            var str = (gb === Math.floor(gb)) ? gb.toFixed(0) : gb.toFixed(1);
            return str + ' Gb/s';
        }
        return mb + ' Mb/s';
    }

    function EthernetScene(sceneManager) {
        this.sceneManager = sceneManager;
        this.breadcrumbTitle = 'Ethernet';
        // Selection: 0 = Mode switch, 1..N = ethernet tabs.
        this.selectedIndex = 0;
        this.modeIndex = MODE_DEFAULT;
        this.modeArrowPressed = null;   // 'left' | 'right' | null
        this._autoSelected = false;
        // Verbose-detail modal — null when closed; an instance of
        // IfaceDetailModal otherwise. While set, all input is routed
        // to the modal and the modal paints over the page after the
        // normal render finishes.
        this._modal = null;
    }

    // ── Verbose interface modal ─────────────────────────────────────
    // Rendered as an overlay inside a ResponsiveFrame, popping over
    // the Ethernet page when the user presses OK on a tab. Shows the
    // full `ip addr show`-like dump for one interface: state, speed,
    // method, all IPv4 / IPv6 addresses, gateways, DNS, RX/TX. Up
    // / Down scroll, Back / Esc close.
    //
    // The modal pulls its data from the closure-level `data` array
    // every render so it stays in sync with the page's 2-second
    // poll — no separate fetch loop, no stale state.
    var MODAL_X        = 4;
    var MODAL_Y        = 18;
    var MODAL_W        = 248;
    var MODAL_H        = 122;
    var MODAL_PAD_X    = 6;
    var MODAL_PAD_Y    = 6;
    var MODAL_LINE_H   = 12;
    var MODAL_DIVIDER_H = 4;     // total height (line at center)
    var MODAL_DIVIDER_COLOR = '#E5E5E5';
    var MODAL_LABEL_GAP = 4;     // gap between "Label:" and value
    var MODAL_INDENT   = 8;      // indent for array values under a section header
    var MODAL_METRIC_GAP = 12;   // horizontal gap between Speed / RX / TX segments
    var MODAL_ICON_GAP = 2;      // gap between RX/TX arrow and its value
    var MODAL_SCROLL_STEP = MODAL_LINE_H;
    var MODAL_SCROLLBAR_X = MODAL_X + MODAL_W - 4;

    // nmcli's GENERAL.STATE comes back as "<code> (<label>)", e.g.
    // "100 (connected)" or "30 (disconnected)". The numeric NM-DEVICE-
    // STATE code is internal noise — strip it. Strings without that
    // shape pass through (we already produce "disconnected (no carrier)"
    // server-side when the kernel reports no carrier, and that should
    // stay readable as-is).
    function cleanState(state) {
        if (!state) return 'unknown';
        var s = String(state);
        var m = s.match(/^\s*\d+\s*\(([^)]+)\)\s*$/);
        if (m) return m[1];
        return s;
    }

    // Compose the rows for one interface. Each row is {kind, ...} with
    // its own height — the renderer accumulates them in pixel space so
    // dividers (slim) and text rows (taller) can coexist cleanly.
    //
    //   header   — name + cleaned status, full-width
    //   metrics  — single line: speed, ↓ RX, ↑ TX (any subset)
    //   kv       — "Label:" (gray) + " value" (black) on the same line
    //   sub      — section label "IPv4:" / "IPv6:" / "DNS:" in gray
    //   value    — array entry under the most recent `sub`, indented
    //   divider  — 1 px horizontal rule, gray, padded above and below
    function buildDetailRows(iface, displayName) {
        var rows = [];
        rows.push({ kind: 'header', text: displayName + '  ' + cleanState(iface.state) });

        // Combined link-stats line: Speed, ↓RX, ↑TX. Each segment is
        // optional; the row is omitted entirely when all three are
        // missing (e.g. cable unplugged, no carrier).
        var hasSpeed = !!iface.speed;
        var hasRx = iface.rxBytes !== null && iface.rxBytes !== undefined;
        var hasTx = iface.txBytes !== null && iface.txBytes !== undefined;
        if (hasSpeed || hasRx || hasTx) {
            rows.push({ kind: 'divider' });
            rows.push({
                kind: 'metrics',
                speed: hasSpeed ? formatSpeed(iface.speed) : '',
                rx:    hasRx    ? formatBytes(iface.rxBytes) : '',
                tx:    hasTx    ? formatBytes(iface.txBytes) : ''
            });
        }

        var method = formatDhcp(iface.ipv4Method);
        if (method) {
            rows.push({ kind: 'divider' });
            rows.push({ kind: 'kv', label: 'Method:', value: method });
        }

        // Helper: emit either a single inline "Label: value" row when
        // the section has just one entry, or "Label:" header + indented
        // list when it has multiple. The single-entry case avoids the
        // unnecessary tabulation break for the common one-address case.
        function pushList(label, arr) {
            if (!Array.isArray(arr) || arr.length === 0) return;
            if (arr.length === 1) {
                rows.push({ kind: 'kv', label: label, value: arr[0] });
            } else {
                rows.push({ kind: 'sub', text: label });
                for (var ii = 0; ii < arr.length; ii++) {
                    rows.push({ kind: 'value', text: arr[ii] });
                }
            }
        }

        var hasIp4 = Array.isArray(iface.ip4) && iface.ip4.length > 0;
        var hasGw4 = !!iface.gateway4;
        if (hasIp4 || hasGw4) {
            rows.push({ kind: 'divider' });
            pushList('IPv4:', iface.ip4);
            if (hasGw4) rows.push({ kind: 'kv', label: 'Gateway4:', value: iface.gateway4 });
        }

        var hasIp6 = Array.isArray(iface.ip6) && iface.ip6.length > 0;
        var hasGw6 = !!iface.gateway6;
        if (hasIp6 || hasGw6) {
            rows.push({ kind: 'divider' });
            pushList('IPv6:', iface.ip6);
            if (hasGw6) rows.push({ kind: 'kv', label: 'Gateway6:', value: iface.gateway6 });
        }

        if (Array.isArray(iface.dns) && iface.dns.length) {
            rows.push({ kind: 'divider' });
            pushList('DNS:', iface.dns);
        }
        return rows;
    }

    function rowHeight(row) {
        return row.kind === 'divider' ? MODAL_DIVIDER_H : MODAL_LINE_H;
    }

    // Display name maps "end0" → "ETH0", same as the desktop card.
    function ifaceDisplayName(iface) {
        var n = (iface && iface.name) || '';
        return n.replace(/^end(\d+)$/i, 'ETH$1').toUpperCase();
    }

    function IfaceDetailModal(scene, ifaceIndex) {
        this.scene = scene;
        this.ifaceIndex = ifaceIndex;
        this.scrollOffsetPx = 0;     // in pixels, snapped to row tops
        this.frame = new ResponsiveFrame({
            x: MODAL_X, y: MODAL_Y,
            width: MODAL_W, height: MODAL_H,
            anchorH: 'left', anchorV: 'top',
            cornerRadius: 4,
            strokeColor: '#000',
            fillColor: '#fff',
            showStroke: true, showFill: true
        });
        this.viewportH = MODAL_H - MODAL_PAD_Y * 2;
    }

    IfaceDetailModal.prototype._currentIface = function() {
        var arr = Array.isArray(data) ? data : [];
        return arr[this.ifaceIndex] || null;
    };

    IfaceDetailModal.prototype._totalHeight = function(rows) {
        var h = 0;
        for (var i = 0; i < rows.length; i++) h += rowHeight(rows[i]);
        return h;
    };

    IfaceDetailModal.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') {
            this.scene.closeModal();
            return;
        }
        var iface = this._currentIface();
        if (!iface) return;
        var rows = buildDetailRows(iface, ifaceDisplayName(iface));
        var max = Math.max(0, this._totalHeight(rows) - this.viewportH);
        if (action === 'down' && this.scrollOffsetPx < max) {
            this.scrollOffsetPx = Math.min(max, this.scrollOffsetPx + MODAL_SCROLL_STEP);
            if (window.requestRender) window.requestRender();
        } else if (action === 'up' && this.scrollOffsetPx > 0) {
            this.scrollOffsetPx = Math.max(0, this.scrollOffsetPx - MODAL_SCROLL_STEP);
            if (window.requestRender) window.requestRender();
        }
    };

    IfaceDetailModal.prototype.render = function(canvas) {
        this.frame.render(canvas);

        var iface = this._currentIface();
        if (!iface) {
            var msg = 'Interface unavailable';
            var w = HaxrcorpFont16.textWidth(msg);
            HaxrcorpFont16.draw(canvas.ctx, msg,
                MODAL_X + Math.floor((MODAL_W - w) / 2),
                MODAL_Y + Math.floor((MODAL_H - 7) / 2),
                '#999');
            return;
        }

        var rows = buildDetailRows(iface, ifaceDisplayName(iface));
        var totalH = this._totalHeight(rows);
        var maxScroll = Math.max(0, totalH - this.viewportH);
        if (this.scrollOffsetPx > maxScroll) this.scrollOffsetPx = maxScroll;

        var ctx = canvas.ctx;
        // Clip to the inner content area so partial rows at the top
        // and bottom don't bleed past the frame border.
        ctx.save();
        ctx.beginPath();
        ctx.rect(MODAL_X + 1, MODAL_Y + 1, MODAL_W - 2, MODAL_H - 2);
        ctx.clip();

        var contentX = MODAL_X + MODAL_PAD_X;
        var contentY = MODAL_Y + MODAL_PAD_Y;
        var contentRight = MODAL_X + MODAL_W - MODAL_PAD_X;
        var rowY = 0;
        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            var rh = rowHeight(row);
            // Skip rows entirely above or below the viewport. Cheap;
            // the clip would handle visibility anyway, but this saves
            // pixel-pushing on tall lists.
            var visibleTop    = contentY + rowY - this.scrollOffsetPx;
            var visibleBottom = visibleTop + rh;
            if (visibleBottom < contentY) {
                rowY += rh;
                continue;
            }
            if (visibleTop >= contentY + this.viewportH) break;

            var y = visibleTop;
            if (row.kind === 'divider') {
                // 1 px gray rule centered in the divider's vertical band.
                canvas.drawHLine(contentX, y + Math.floor(rh / 2),
                                 contentRight - contentX, MODAL_DIVIDER_COLOR);
            } else if (row.kind === 'header') {
                // Header uses Born2bSportyV2Medium for the same chunky
                // OS-chrome weight the App Switcher / menu selectors
                // use, so the interface name + state reads as a card
                // title rather than just another body line. Drawn 2 px
                // higher than the row's nominal y — the font's cap row
                // sits 2 px lower in its frame than HaxrcorpFont16's,
                // so without the nudge the title would look bottom-
                // heavy against the divider beneath it.
                Born2bSportyV2Medium.draw(ctx, row.text, contentX, y - 2, '#000');
            } else if (row.kind === 'kv') {
                HaxrcorpFont16.draw(ctx, row.label, contentX, y, '#6D6D6D');
                var lblW = HaxrcorpFont16.textWidth(row.label);
                HaxrcorpFont16.draw(ctx, row.value,
                    contentX + lblW + MODAL_LABEL_GAP, y, '#000');
            } else if (row.kind === 'sub') {
                HaxrcorpFont16.draw(ctx, row.text, contentX, y, '#6D6D6D');
            } else if (row.kind === 'value') {
                HaxrcorpFont16.draw(ctx, row.text, contentX + MODAL_INDENT, y, '#000');
            } else if (row.kind === 'metrics') {
                drawMetricsRow(canvas, contentX, y, row);
            }
            rowY += rh;
        }
        ctx.restore();

        // Scrollbar — only when content overflows. Pixel-space:
        // totalItems = totalH, visibleItems = viewportH, currentIndex
        // = scrollOffsetPx (the helper just computes thumb geometry
        // from a ratio so units don't have to be "items").
        if (totalH > this.viewportH) {
            var sb = new UI.Scrollbar(totalH, this.viewportH, this.scrollOffsetPx);
            sb.render(canvas, MODAL_SCROLLBAR_X, MODAL_Y + 4, MODAL_H - 8, 1);
        }
    };

    // Single-line layout for Speed + ↓RX + ↑TX. Each segment is
    // optional; missing ones are simply skipped, so e.g. an interface
    // with no carrier still renders cleanly with nothing in the row
    // (which is why we omit the row at build time, but defensive
    // here too — a poll that returns half a metric won't break us).
    //
    // Arrow icons sit 2 px below the text baseline so the 7-px sprite
    // reads as visually centred against the 7-px HaxrcorpFont16 cap
    // row (the font rasterises with two empty top rows; the icons
    // don't, so without the nudge the arrows ride high).
    var ARROW_DY = 2;
    function drawMetricsRow(canvas, x, y, row) {
        var ctx = canvas.ctx;
        var cursor = x;
        if (row.speed) {
            HaxrcorpFont16.draw(ctx, row.speed, cursor, y, '#000');
            cursor += HaxrcorpFont16.textWidth(row.speed) + MODAL_METRIC_GAP;
        }
        if (row.rx && Icons && Icons.arrow_down) {
            canvas.drawSprite(Icons.arrow_down, cursor, y + ARROW_DY, '#000');
            cursor += Icons.arrow_down.w + MODAL_ICON_GAP;
            HaxrcorpFont16.draw(ctx, row.rx, cursor, y, '#000');
            cursor += HaxrcorpFont16.textWidth(row.rx) + MODAL_METRIC_GAP;
        }
        if (row.tx && Icons && Icons.arrow_up) {
            canvas.drawSprite(Icons.arrow_up, cursor, y + ARROW_DY, '#000');
            cursor += Icons.arrow_up.w + MODAL_ICON_GAP;
            HaxrcorpFont16.draw(ctx, row.tx, cursor, y, '#000');
        }
    }

    EthernetScene.prototype.showModal = function(modal) {
        this._modal = modal;
        if (window.requestRender) window.requestRender();
    };
    EthernetScene.prototype.closeModal = function() {
        this._modal = null;
        if (window.requestRender) window.requestRender();
    };

    EthernetScene.prototype.enter = function() {
        loading = true;
        error = false;
        data = null;
        this.selectedIndex = 0;
        this.modeArrowPressed = null;
        this._autoSelected = false;
        fetchEthernet();
        // 2s poll keeps dbus-daemon overhead low; the server reads the
        // kernel carrier file directly so cable changes still surface
        // on the next tick.
        pollTimer = setInterval(fetchEthernet, 2000);
        var self = this;
        this._renderTick = setInterval(function() {
            if (!loading) {
                clearInterval(self._renderTick);
                self._renderTick = null;
                return;
            }
            if (window.requestRender) window.requestRender();
        }, PLACEHOLDER_RENDER_MS);
    };

    EthernetScene.prototype.exit = function() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (this._renderTick) { clearInterval(this._renderTick); this._renderTick = null; }
    };

    EthernetScene.prototype._rowCount = function() {
        // 1 (mode switch) + N (ethernet tabs).
        return 1 + (Array.isArray(data) ? data.length : 0);
    };

    EthernetScene.prototype.handleInput = function(action) {
        // Modal (verbose interface view) captures all input while open.
        if (this._modal) {
            this._modal.handleInput(action);
            return;
        }

        var rows = this._rowCount();

        // OK / Run on a tab opens the verbose modal for that interface.
        // Index 0 is the Mode row (no detail view); only tabs at 1..N
        // map to a real entry in `data`.
        if ((action === 'ok' || action === 'run')
            && this.selectedIndex >= 1
            && Array.isArray(data)
            && data[this.selectedIndex - 1]) {
            this.showModal(new IfaceDetailModal(this, this.selectedIndex - 1));
            return;
        }

        // Mode row reacts to left/right to cycle through the values.
        if ((action === 'left' || action === 'right') && this.selectedIndex === 0) {
            var n = MODE_VALUES.length;
            if (action === 'right') this.modeIndex = (this.modeIndex + 1) % n;
            else                    this.modeIndex = (this.modeIndex - 1 + n) % n;
            // Brief tap feedback on the pressed chevron.
            var self = this;
            this.modeArrowPressed = action;
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                if (self.modeArrowPressed === action) {
                    self.modeArrowPressed = null;
                    if (window.requestRender) window.requestRender();
                }
            }, MODE_ARROW_PRESSED_MS);
            return;
        }

        if (action === 'down' && rows > 0) {
            this.selectedIndex = (this.selectedIndex + 1) % rows;
        } else if (action === 'up' && rows > 0) {
            this.selectedIndex = (this.selectedIndex - 1 + rows) % rows;
        } else if (action === 'back' || action === 'esc') {
            return 'pop';
        }
    };

    EthernetScene.prototype._renderModeRow = function(canvas) {
        var labelY = MODE_Y + Math.floor((MODE_H - 11) / 2);   // center HaxrcorpFont16 (11-row frame)
        var selected = this.selectedIndex === 0;
        var valueColor = selected ? '#000' : '#999';
        var value = MODE_VALUES[this.modeIndex];
        var rightEdge = TAB_X + TAB_W - MODE_PAD_R;

        // Selector frame when selected. Uses MenuSelectorFrame (no
        // chevron) — the row is a toggle, not a drill-in card.
        if (selected) {
            var sel = new MenuSelectorFrame({
                x: TAB_X,
                y: MODE_Y - 1,
                width: TAB_W,
                height: MODE_H + 2,
                anchorH: 'left', anchorV: 'top',
                cornerRadius: 3,
                strokeColor: '#000',
                showStroke: true,
                showFill: false
            });
            sel.render(canvas);
        }

        HaxrcorpFont16.draw(canvas.ctx, 'Mode', TAB_X + MODE_PAD_L, labelY, '#000');

        if (!selected) {
            // Collapsed: just the value, right-aligned.
            var w = HaxrcorpFont16.textWidth(value);
            HaxrcorpFont16.draw(canvas.ctx, value, rightEdge - w, labelY, valueColor);
            return;
        }

        // Selected: `<value>` with arrows and tap-feedback colours.
        var ltW = HaxrcorpFont16.textWidth('<');
        var gtW = HaxrcorpFont16.textWidth('>');
        var valW = HaxrcorpFont16.textWidth(value);
        var spacing = 4;
        var gtX = rightEdge - gtW;
        var valX = gtX - spacing - valW;
        var ltX = valX - spacing - ltW;
        var ltColor = this.modeArrowPressed === 'left'  ? '#222222' : valueColor;
        var gtColor = this.modeArrowPressed === 'right' ? '#222222' : valueColor;
        HaxrcorpFont16.draw(canvas.ctx, '<',   ltX,  labelY, ltColor);
        HaxrcorpFont16.draw(canvas.ctx, value, valX, labelY, valueColor);
        HaxrcorpFont16.draw(canvas.ctx, '>',   gtX,  labelY, gtColor);
    };

    EthernetScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // Breadcrumb.
        var titles = this.sceneManager.breadcrumb();
        var breadcrumb = '> ' + titles.join(' > ');
        HaxrcorpFont16.draw(canvas.ctx, breadcrumb, BREADCRUMB_X, UI.STATUS_BAR_H + 2, '#999999');

        if (loading && !data) {
            var phColor = placeholderColor();
            for (var p = 0; p < PLACEHOLDER_COUNT; p++) {
                var ph = new ResponsiveFrame({
                    x: TAB_X,
                    y: TAB_Y + p * (TAB_H + TAB_GAP),
                    width: TAB_W, height: TAB_H,
                    anchorH: 'left', anchorV: 'top',
                    cornerRadius: 3,
                    strokeColor: phColor, showStroke: true,
                    fillColor: phColor, showFill: true
                });
                ph.render(canvas);
            }
            return;
        }
        if (error && !data) {
            canvas.drawText('Error', 4, TAB_Y, '#888');
            return;
        }

        var ifaces = Array.isArray(data) ? data : [];

        // Auto-highlight the first connected interface on first data.
        // Tab indices start at 1 (Mode switch is index 0).
        if (!this._autoSelected && ifaces.length > 0) {
            for (var a = 0; a < ifaces.length; a++) {
                if (isConnected(ifaces[a])) { this.selectedIndex = 1 + a; break; }
            }
            this._autoSelected = true;
        }

        // Clamp selection to valid range.
        var rows = 1 + ifaces.length;
        if (this.selectedIndex >= rows) this.selectedIndex = 0;

        // Mode switch first, tabs below.
        this._renderModeRow(canvas);

        var modeName = MODE_VALUES[this.modeIndex];
        var roleMap = ROLE_BY_MODE[modeName] || [];
        // Each tab grows to 40 px when connected (RX/TX row). Track
        // cursor so subsequent tabs sit below the previous one.
        var tabY = TAB_Y;
        for (var i = 0; i < ifaces.length; i++) {
            var iface = ifaces[i];
            var connected = isConnected(iface);
            var tab = new EthernetTab({
                x: TAB_X,
                y: tabY,
                width: TAB_W,
                height: TAB_H,              // base height — component expands itself when connected
                portNumber: i,
                connected: connected,
                ipv4: firstIpv4(iface),
                ipv6: firstIpv6(iface),
                portRole: roleMap[i] || '',
                speed: formatSpeed(iface.speed),
                rxLabel: connected ? formatBytes(iface.rxBytes) : '',
                txLabel: connected ? formatBytes(iface.txBytes) : '',
                dhcpLabel: connected ? formatDhcp(iface.ipv4Method) : '',
                selected: (i + 1) === this.selectedIndex
            });
            tab.render(canvas);
            tabY += tab.getHeight() + TAB_GAP;
        }

        // Modal overlay (verbose detail view) — painted last so it
        // sits above the tabs and the breadcrumb. The page underneath
        // keeps polling so the modal's data stays fresh.
        if (this._modal) {
            this._modal.render(canvas);
        }
    };

    return EthernetScene;
})();
