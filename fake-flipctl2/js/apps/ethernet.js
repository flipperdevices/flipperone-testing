var EthernetScene = (function() {
    // Layout anchors (match the EthernetTab spec).
    var TAB_X         = 4;
    var TAB_Y         = 28;
    var TAB_W         = 248;
    // When the scrollbar is visible the tab frame shrinks to leave a
    // 3px gap between its right edge and the scrollbar track. Scrollbar
    // thumb sits at x=252..254; tab right edge needs to land at x=248,
    // so width = 248 − 4 + 1 = 245.
    var TAB_W_WITH_SCROLL = 245;
    var TAB_H         = 22;
    var TAB_GAP       = 3;
    var BREADCRUMB_X  = 4;

    // Scroll viewport. Content that doesn't fit into VIEWPORT_H pixels
    // is scrolled; the UI.Scrollbar appears along the right edge.
    // When scrolled, the selected tab's bottom edge lands
    // SELECTED_BOTTOM_MARGIN px above the canvas bottom (i.e. at
    // y=127 for the default 144-tall canvas).
    var VIEWPORT_H             = 112;   // clip + scrollbar trigger threshold
    var SELECTED_BOTTOM_MARGIN = 18;    // gap below selected tab's bottom edge (lands at y=125)

    // Scrollbar geometry matches the main menu — dotted track runs
    // from 2px below the status bar down to 2px above the canvas
    // bottom, with a 1px thumb inset.
    var SCROLLBAR_X         = 253;
    var SCROLLBAR_Y         = 15;
    var SCROLLBAR_H         = 127;
    var SCROLLBAR_THUMB_PAD = 1;

    // Bottom fade-to-white band: 16px tall, aligned flush with the
    // canvas bottom edge (y=128..143 on the 144-tall screen). Draws
    // on top of the tab content but beneath the scrollbar and the
    // button bar — gives the feel of content disappearing into the
    // bottom of the screen.
    var FADE_H = 16;

    var data = null;
    var loading = true;
    var error = false;
    var pollTimer = null;

    // Skeleton placeholder: how many tabs to show while loading.
    var PLACEHOLDER_COUNT = 2;
    // Breathing animation: 1s loop between #EEEEEE and #DDDDDD.
    var PLACEHOLDER_PERIOD_MS = 1000;
    var PLACEHOLDER_RENDER_MS = 50;   // 20fps redraw while loading

    function placeholderColor() {
        var t = (Date.now() % PLACEHOLDER_PERIOD_MS) / PLACEHOLDER_PERIOD_MS;
        var phase = (1 - Math.cos(2 * Math.PI * t)) / 2;   // smooth [0,1] loop
        var v = Math.round(238 - 17 * phase);              // 238 (#EE) → 221 (#DD)
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
        };
        xhr.onerror = function() { error = true; loading = false; };
        xhr.ontimeout = function() { error = true; loading = false; };
        xhr.send();
    }

    function isConnected(iface) {
        return !!(iface && iface.state
            && iface.state.indexOf('connected') !== -1
            && iface.state.indexOf('disconnected') === -1);
    }

    function stripCidr(addr) {
        // nmcli formats are "192.168.1.10/24"; strip the suffix.
        return String(addr).split('/')[0];
    }

    function firstIpv4(iface) {
        if (!iface || !iface.ip4 || !iface.ip4.length) return '';
        return stripCidr(iface.ip4[0]);
    }

    function firstIpv6(iface) {
        if (!iface || !iface.ip6 || !iface.ip6.length) return '';
        return stripCidr(iface.ip6[0]);
    }

    function EthernetScene(sceneManager) {
        this.sceneManager = sceneManager;
        this.breadcrumbTitle = 'Ethernet';
        this.selectedIndex = 0;
        // Per-tab expansion state — each tab keeps its own expanded
        // flag even when the user navigates away.
        this.expansions = [];
        this.scrollOffset = 0;
        this._autoSelected = false;
        var self = this;
        // Triggered by the "view" button (v key). Toggles only the
        // currently-selected tab.
        this.expandBtn = new UI.MiddleButton('Expand', 3, 48, 2, 'view', function() {
            self.expansions[self.selectedIndex] = !self.expansions[self.selectedIndex];
            if (window.requestRender) window.requestRender();
        });
        // Button position is spec'd as 52px from the canvas right edge.
        // A 48px-wide button → x = 256 − 52 − 48 = 156.
        this.expandBtn.x = 256 - 52 - 48;
        this.scrollbar = new UI.Scrollbar(1, 1, 0);
    }

    EthernetScene.prototype.enter = function() {
        loading = true;
        error = false;
        data = null;
        this.selectedIndex = 0;
        this.expansions = [];
        this.scrollOffset = 0;
        this._autoSelected = false;
        fetchEthernet();
        pollTimer = setInterval(fetchEthernet, 1000);
        // Drive the placeholder breathing animation until data arrives.
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
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        if (this._renderTick) {
            clearInterval(this._renderTick);
            this._renderTick = null;
        }
    };

    EthernetScene.prototype.handleInput = function(action) {
        // Expand button — triggered by the "view" action (v key), but
        // only when the selected tab is connected.
        if (action === this.expandBtn.action && this._selectedConnected()) {
            var btn = this.expandBtn;
            btn.press();
            if (btn.onPress) btn.onPress();
            setTimeout(function() {
                btn.release();
                if (window.requestRender) window.requestRender();
            }, 30);
            if (window.requestRender) window.requestRender();
            return;
        }
        var n = Array.isArray(data) ? data.length : 0;
        if ((action === 'down' || action === 'up') && n > 0) {
            // Navigation leaves each tab's expansion state untouched.
            if (action === 'down') {
                this.selectedIndex = (this.selectedIndex + 1) % n;
            } else {
                this.selectedIndex = (this.selectedIndex - 1 + n) % n;
            }
        } else if (action === 'back' || action === 'esc') {
            return 'pop';
        }
    };

    EthernetScene.prototype._selectedConnected = function() {
        var ifaces = Array.isArray(data) ? data : [];
        return isConnected(ifaces[this.selectedIndex]);
    };

    EthernetScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // Breadcrumb: dynamic, built from the live scene stack.
        var titles = this.sceneManager.breadcrumb();
        var breadcrumb = '> ' + titles.join(' > ');
        HaxrcorpFont16.draw(canvas.ctx, breadcrumb, BREADCRUMB_X, UI.STATUS_BAR_H + 2, '#999999');

        if (loading && !data) {
            // Skeleton: empty frames where the real tabs will land,
            // softly pulsing between #EEEEEE and #DDDDDD on a 1s loop.
            var phColor = placeholderColor();
            for (var p = 0; p < PLACEHOLDER_COUNT; p++) {
                var ph = new ResponsiveFrame({
                    x: TAB_X,
                    y: TAB_Y + p * (TAB_H + TAB_GAP),
                    width: TAB_W,
                    height: TAB_H,
                    anchorH: 'left', anchorV: 'top',
                    cornerRadius: 3,
                    strokeColor: phColor,
                    showStroke: true,
                    fillColor: phColor,
                    showFill: true
                });
                ph.render(canvas);
            }
            return;
        }
        if (error && !data) {
            canvas.drawText('Error', 4, TAB_Y, '#888');
            return;
        }

        // One EthernetTab per interface returned by /api/ethernet.
        var ifaces = Array.isArray(data) ? data : [];
        if (this.selectedIndex >= ifaces.length) this.selectedIndex = 0;

        // Ensure the expansion array tracks the interface count.
        while (this.expansions.length < ifaces.length) this.expansions.push(false);

        // Auto-highlight the first connected interface the first time
        // we receive data. After that, navigation is user-driven.
        if (!this._autoSelected && ifaces.length > 0) {
            for (var a = 0; a < ifaces.length; a++) {
                if (isConnected(ifaces[a])) { this.selectedIndex = a; break; }
            }
            this._autoSelected = true;
        }

        // Compute logical Y + height of every tab (unscrolled), then
        // the total content height, then the scroll offset that keeps
        // the selected tab fully visible in the viewport.
        var logicals = [];   // [{ top, height }]
        var cursor = 0;
        for (var li = 0; li < ifaces.length; li++) {
            var connected = isConnected(ifaces[li]);
            var expanded = !!this.expansions[li] && connected;
            var tmp = new EthernetTab({
                x: TAB_X, y: 0, width: TAB_W, height: TAB_H,
                portNumber: li, connected: connected,
                ipv4: firstIpv4(ifaces[li]),
                ipv6: firstIpv6(ifaces[li]),
                gateway: ifaces[li].gateway4 || '',
                dns: ifaces[li].dns || [],
                selected: li === this.selectedIndex,
                expanded: expanded
            });
            var h = tmp.getHeight();
            logicals.push({ top: cursor, height: h, tab: tmp });
            cursor += h + (li < ifaces.length - 1 ? TAB_GAP : 0);
        }
        var totalH = cursor;

        // Clamp the scroll offset: keep the selected tab's bottom edge
        // SELECTED_BOTTOM_MARGIN px above the canvas bottom, and its
        // top edge not scrolled past the viewport start.
        if (totalH > VIEWPORT_H && logicals[this.selectedIndex]) {
            var sel = logicals[this.selectedIndex];
            var selectedBottomY = canvas.h - SELECTED_BOTTOM_MARGIN - 1;
            // Top: don't scroll past the selected tab's top edge.
            if (this.scrollOffset > sel.top) this.scrollOffset = sel.top;
            // Bottom: selected tab's rendered bottom must not exceed
            // selectedBottomY.
            var minOffset = TAB_Y + sel.top + sel.height - 1 - selectedBottomY;
            if (this.scrollOffset < minOffset) this.scrollOffset = minOffset;
            if (this.scrollOffset < 0) this.scrollOffset = 0;
        } else {
            this.scrollOffset = 0;
        }

        // Tab width shrinks when the scrollbar is visible so there's a
        // 2px gap between the frame's right edge and the scrollbar.
        var needsScroll = totalH > VIEWPORT_H;
        var tabWidth = needsScroll ? TAB_W_WITH_SCROLL : TAB_W;

        // Clip the rendering to the viewport so tabs can't bleed over
        // the button bar when they're scrolled.
        var ctx = canvas.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, TAB_Y, canvas.w, VIEWPORT_H);
        ctx.clip();

        for (var i = 0; i < logicals.length; i++) {
            var info = logicals[i];
            var renderY = TAB_Y + info.top - this.scrollOffset;
            if (renderY + info.height < TAB_Y) continue;
            if (renderY > TAB_Y + VIEWPORT_H) continue;
            info.tab.y = renderY;
            info.tab.w = tabWidth;
            info.tab.render(canvas);
        }

        ctx.restore();

        // Bottom fade: full-width 16px band flush with the canvas
        // bottom (transparent → fully opaque white as it descends).
        // Drawn after the tab content so it masks it, but before the
        // scrollbar and the button bar so those stay crisp on top.
        var fadeY = canvas.h - FADE_H;
        var fadeGrad = ctx.createLinearGradient(0, fadeY, 0, fadeY + FADE_H);
        fadeGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        fadeGrad.addColorStop(1, 'rgba(255, 255, 255, 1)');
        ctx.fillStyle = fadeGrad;
        ctx.fillRect(0, fadeY, canvas.w, FADE_H);

        // Scrollbar along the right edge, only when content overflows.
        // The effective scrollable viewport is shorter than
        // VIEWPORT_H because the selected tab's bottom is clamped to
        // y=125 — scroll math uses that shorter span so the thumb's
        // maxScroll matches the actual scrollOffset range.
        if (needsScroll) {
            var effectiveViewportH = canvas.h - TAB_Y - SELECTED_BOTTOM_MARGIN;
            this.scrollbar.update(totalH, effectiveViewportH, this.scrollOffset);
            this.scrollbar.render(canvas, SCROLLBAR_X, SCROLLBAR_Y, SCROLLBAR_H, SCROLLBAR_THUMB_PAD);
        }

        // App-defined button bar: (null)(null)(null)("Expand"/"Collapse")(null),
        // only when the selected tab is connected. Text reflects the
        // selected tab's own expansion state.
        if (this._selectedConnected()) {
            this.expandBtn.text = this.expansions[this.selectedIndex] ? 'Collapse' : 'Expand';
            this.expandBtn.render(canvas);
        }
    };

    return EthernetScene;
})();
