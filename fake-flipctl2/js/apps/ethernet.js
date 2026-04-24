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
    }

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
        var rows = this._rowCount();

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
    };

    return EthernetScene;
})();
