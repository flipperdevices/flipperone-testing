var DesktopScene = (function() {
    var BATTERY_TEMP_POLL_MS = 5000;
    // Display name — picked up by main.js → getSceneName so the App
    // Switcher's title bar shows "Desktop" when Tab is pressed here.
    var DISPLAY_NAME = 'Desktop';

    function DesktopScene(sceneManager) {
        this.sceneManager = sceneManager;
        this.displayName = DISPLAY_NAME;

        // Hostname — populated asynchronously via /api/hostname.
        // `hostnameRaw` is the raw kernel hostname string used for the
        // desktop display; the parsed lines are kept for any view that
        // wants the split form (e.g. "Flipper One 3c6d04" / "Build 1070").
        this.hostnameRaw = '';
        this.hostnameLine1 = '';
        this.hostnameLine2 = '';

        // Thermal readings in °C (null = not yet read).
        this.batteryTempC = null;
        this.cpuTempC = null;
        // Battery power flow in W; negative = discharging.
        this.powerWatts = null;
        // List of active Ethernet interfaces (display name + addresses).
        // Populated from /api/ethernet on enter and on each poll tick.
        this.ethList = [];
        this._tempTimer = null;
    }

    DesktopScene.prototype._fetchHostname = function() {
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/hostname', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status !== 200) return;
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
            self._setHostname(data.hostname || '');
        };
        xhr.send();
    };

    DesktopScene.prototype._setHostname = function(raw) {
        this.hostnameRaw = raw;
        // Expected format: flipperone-<id>-build-<rest>
        // e.g. flipperone-3c6d04-build-1049-test-dp-exp
        var m = raw.match(/^flipperone-([^-]+)-build-(.+)$/i);
        if (m) {
            this.hostnameLine1 = 'Flipper One ' + m[1];
            this.hostnameLine2 = 'Build ' + m[2];
        } else {
            this.hostnameLine1 = raw;
            this.hostnameLine2 = '';
        }
        if (typeof window.requestRender === 'function') window.requestRender();
    };

    // Generic XHR helper for a JSON stat endpoint. Reads `valueKey` off the
    // response body, stores it on `field`, and triggers a repaint only
    // when the value actually changed.
    DesktopScene.prototype._fetchStat = function(url, valueKey, field) {
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status !== 200) return;
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
            var next = (data && typeof data[valueKey] === 'number') ? data[valueKey] : null;
            if (next !== self[field]) {
                self[field] = next;
                if (typeof window.requestRender === 'function') window.requestRender();
            }
        };
        xhr.send();
    };

    DesktopScene.prototype._fetchAllStats = function() {
        this._fetchStat('/api/battery/temp', 'tempC', 'batteryTempC');
        this._fetchStat('/api/cpu/temp',     'tempC', 'cpuTempC');
        this._fetchStat('/api/power/usage',  'watts', 'powerWatts');
        this._fetchEthernet();
    };

    // Pull /api/ethernet, keep one snapshot per connected interface,
    // and render them as separate cards. We strip CIDR suffixes off the
    // addresses ("192.168.1.50/24" -> "192.168.1.50") and re-label the
    // kernel device names (end0/end1) as ETH0/ETH1 so the desktop shows
    // the friendly form regardless of the underlying driver convention.
    // An interface is considered "connected" only when it has at least
    // one IPv4 address — the link could be up but unaddressed during
    // DHCP setup, and we don't want a flicker card for that.
    DesktopScene.prototype._fetchEthernet = function() {
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/ethernet', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status !== 200) return;
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
            // /api/ethernet returns the interface array directly.
            var list = Array.isArray(data) ? data : [];
            var stripCidr = function(s) { return (s || '').replace(/\/\d+$/, ''); };
            var snaps = [];
            for (var i = 0; i < list.length; i++) {
                var f = list[i];
                if (!f || !Array.isArray(f.ip4) || f.ip4.length === 0) continue;
                snaps.push({
                    name: (f.name || '').replace(/^end(\d+)$/i, 'ETH$1').toUpperCase(),
                    ip4: stripCidr(f.ip4[0]),
                    ip6: f.ip6 && f.ip6.length ? stripCidr(f.ip6[0]) : ''
                });
            }
            // Cheap shallow comparison so we only repaint on real changes.
            var changed = snaps.length !== self.ethList.length;
            if (!changed) {
                for (var k = 0; k < snaps.length; k++) {
                    var a = snaps[k], b = self.ethList[k];
                    if (a.name !== b.name || a.ip4 !== b.ip4 || a.ip6 !== b.ip6) {
                        changed = true;
                        break;
                    }
                }
            }
            if (changed) {
                self.ethList = snaps;
                if (typeof window.requestRender === 'function') window.requestRender();
            }
        };
        xhr.send();
    };

    DesktopScene.prototype.enter = function() {
        this._fetchHostname();
        this._fetchAllStats();
        var self = this;
        this._tempTimer = setInterval(function() { self._fetchAllStats(); }, BATTERY_TEMP_POLL_MS);
    };
    DesktopScene.prototype.exit = function() {
        if (this._tempTimer !== null) {
            clearInterval(this._tempTimer);
            this._tempTimer = null;
        }
    };

    DesktopScene.prototype._onMenu = function() {
        this.sceneManager.push(new MenuScene(this.sceneManager));
    };

    DesktopScene.prototype.handleInput = function(action) {
        // ok / run open the Main Menu.
        if (action === 'ok' || action === 'run') {
            this._onMenu();
            return;
        }
    };

    // Renders one thermal block: a label, an icon, and a temperature value
    // to the right of the icon. The label and icon take independent absolute
    // coordinates so we can position the title separately from the readout.
    // `tempC` may be null while the first fetch is in flight — the icon is
    // drawn either way and the temperature string is omitted.
    function drawThermalCard(canvas, labelX, labelY, iconX, iconY, label, icon, tempC) {
        if (label) {
            HaxrcorpFont16.draw(canvas.ctx, label, labelX, labelY, '#6D6D6D');
        }
        canvas.drawSprite(icon, iconX, iconY, '#000');

        if (tempC === null) return;

        // Temperature value, right of the icon. One-decimal precision to
        // match the sensor's native resolution (e.g. 44.4, 55.5).
        var tempStr = tempC.toFixed(1);
        var textX = iconX + icon.w + 3;
        // Vertical centering of 7px glyph against icon, shifted 1px up.
        var textY = iconY + Math.floor((icon.h - 7) / 2) - 1;
        HaxrcorpFont16.draw(canvas.ctx, tempStr, textX, textY, '#000');

        var numWidth = HaxrcorpFont16.textWidth(tempStr);
        var degX = textX + numWidth + 1;
        // Degree glyph sits 2 px below the digit baseline so it visually
        // hangs at the top-right of the number, like a true superscript ring.
        canvas.drawSprite(Icons.degree_symbol, degX, textY + 2, '#000');

        var cX = degX + Icons.degree_symbol.w + 1;
        HaxrcorpFont16.draw(canvas.ctx, 'C', cX, textY, '#000');
    }

    // Renders a power-flow block: optional label, power_usage icon, and
    // "<N.NN> W" text (signed; negative = discharging, two decimals to
    // match `awk '{printf "%.2f W"}' …`).
    function drawPowerCard(canvas, labelX, labelY, iconX, iconY, label, icon, watts) {
        if (label) {
            HaxrcorpFont16.draw(canvas.ctx, label, labelX, labelY, '#6D6D6D');
        }
        canvas.drawSprite(icon, iconX, iconY, '#000');
        if (watts === null) return;

        // Display magnitude only — the icon (and battery state elsewhere)
        // already conveys discharge vs charge direction.
        var str = Math.abs(watts).toFixed(2) + ' W';
        var textX = iconX + icon.w + 3;
        var textY = iconY + Math.floor((icon.h - 7) / 2) - 1;
        HaxrcorpFont16.draw(canvas.ctx, str, textX, textY, '#000');
    }

    // Pixel-precise x at which the CPU temperature module ends — i.e. the
    // right edge of the "C" glyph after "<temp>°C". Used to place the next
    // module a fixed gap to the right of the CPU readout.
    function cpuTempEndX(cpuTempC) {
        var tempStr = (cpuTempC !== null) ? cpuTempC.toFixed(1) : '55.5';
        var textX = 82 + Icons.cpu_15px.w + 3;  // CPU icon at x=82, value text starts here
        return textX
            + HaxrcorpFont16.textWidth(tempStr)
            + 1 + Icons.degree_symbol.w
            + 1 + HaxrcorpFont16.textWidth('C');
    }

    DesktopScene.prototype.render = function(canvas) {
        canvas.clear('#fff');

        // Status bar — same style as the Main Menu (default dark theme).
        UI.drawStatusBar(canvas, '');

        // Hostname row sitting between the two dividers, centered.
        //   Short hostnames (≤ 40 chars) sit on a single line:
        //     "Hostname  <value>" — label gray, value black.
        //   Long hostnames wrap to two lines:
        //     line 1: "Hostname"
        //     line 2: <value>
        //   When wrapped, every element below the row (lower divider,
        //   ETH cards) shifts down by HOSTNAME_LINE_H so the whole
        //   layout breathes. Stored in `hostnameShift` so the rest
        //   of the render path can reuse it.
        var HOSTNAME_LINE_H = 12;
        var HOSTNAME_WRAP_THRESHOLD = 40;
        var hostnameY = UI.STATUS_BAR_H + 43;
        var hostnameLabel = 'Hostname';
        var hostnameWraps = !!(this.hostnameRaw
            && this.hostnameRaw.length > HOSTNAME_WRAP_THRESHOLD);
        var hostnameShift = hostnameWraps ? HOSTNAME_LINE_H : 0;

        // Two horizontal divider rules below the status bar — top at 36 px,
        // bottom at 59 px (shifted by hostnameShift when the value wraps).
        // 1 px tall, full canvas width, light gray.
        canvas.drawRect(0, UI.STATUS_BAR_H + 36, canvas.w, 1, '#CCCCCC');
        canvas.drawRect(0, UI.STATUS_BAR_H + 59 + hostnameShift, canvas.w, 1, '#CCCCCC');

        if (hostnameWraps) {
            // Two-line layout: label on top, value below, both centered.
            var lblW = HaxrcorpFont16.textWidth(hostnameLabel);
            HaxrcorpFont16.draw(canvas.ctx, hostnameLabel,
                Math.floor((canvas.w - lblW) / 2), hostnameY, '#6D6D6D');
            var valW = HaxrcorpFont16.textWidth(this.hostnameRaw);
            HaxrcorpFont16.draw(canvas.ctx, this.hostnameRaw,
                Math.floor((canvas.w - valW) / 2),
                hostnameY + HOSTNAME_LINE_H, '#000');
        } else {
            // Single-line layout: label + gap + value, treated as one
            // block centered on the canvas.
            var hostnameLabelW = HaxrcorpFont16.textWidth(hostnameLabel);
            var hostnameGap = 4;
            var hostnameValueW = this.hostnameRaw
                ? HaxrcorpFont16.textWidth(this.hostnameRaw)
                : 0;
            var hostnameTotalW = hostnameLabelW
                + (this.hostnameRaw ? hostnameGap + hostnameValueW : 0);
            var hostnameLabelX = Math.floor((canvas.w - hostnameTotalW) / 2);
            HaxrcorpFont16.draw(canvas.ctx, hostnameLabel, hostnameLabelX, hostnameY, '#6D6D6D');
            if (this.hostnameRaw) {
                var hostValueX = hostnameLabelX + hostnameLabelW + hostnameGap;
                HaxrcorpFont16.draw(canvas.ctx, this.hostnameRaw, hostValueX, hostnameY, '#000');
            }
        }

        // Battery thermal block.
        //   "Temperature" label — 57 px from left, 4 px below status bar.
        //   Battery icon + reading module — 36 px from left;
        //   icon top edge is 15 px below the status bar.
        drawThermalCard(canvas,
            57, UI.STATUS_BAR_H + 4,            // label position
            36, UI.STATUS_BAR_H + 15,           // icon position
            'Temperature', Icons.battery_vertical, this.batteryTempC);

        // CPU thermal block — icon + reading only, no label.
        //   Icon — 82 px from left; top edge 16 px below the status bar
        //   (this puts the bottom of the 15-tall CPU icon at the same y as
        //   the bottom of the 16-tall battery icon — they line up cleanly).
        drawThermalCard(canvas,
            0, 0,                                // no label
            82, UI.STATUS_BAR_H + 16,            // icon position
            null, Icons.cpu_15px, this.cpuTempC);

        // Battery power flow.
        //   "Power usage" label — 163 px from left, on the same baseline as
        //   the "Temperature" label.
        //   Power icon — placed 34 px to the right of where the CPU temp
        //   readout ends, so the gap stays consistent regardless of the
        //   numeric width of the CPU value.
        //   Icon top y matches CPU's so all three icons bottom-align.
        var powerIconX = cpuTempEndX(this.cpuTempC) + 34;
        drawPowerCard(canvas,
            163, UI.STATUS_BAR_H + 4,            // label position
            powerIconX, UI.STATUS_BAR_H + 16,    // icon position
            'Power usage', Icons.power_usage, this.powerWatts);

        // ETH connection cards — one per connected interface, stacked
        // vertically below the lower divider. Each card is two lines
        // ("<NAME> IPv4: <ipv4>" / "IPv6: <ipv6>") centered horizontally.
        // Interface names ("ETH0"/"ETH1") and the IP values render in
        // black; "IPv4:" and "IPv6:" labels are gray (#6D6D6D).
        var ETH_LINE_H  = 12;   // line spacing within a card
        var ETH_CARD_H  = ETH_LINE_H * 2;
        var ETH_CARD_GAP = 5;   // visual gap between two cards
        // Same +hostnameShift as the lower divider so the spacing
        // between divider and first ETH card stays at 8 px whether
        // the hostname wrapped or not.
        var ethStartY = UI.STATUS_BAR_H + 67 + hostnameShift;
        for (var ei = 0; ei < this.ethList.length; ei++) {
            var eth = this.ethList[ei];
            var line1Y = ethStartY + ei * (ETH_CARD_H + ETH_CARD_GAP);
            var line2Y = line1Y + ETH_LINE_H;
            drawEthCard(canvas, eth, line1Y, line2Y);
        }
    };

    // Renders a single interface card. Two lines, each centered:
    //   line1: <NAME>  IPv4: <ipv4>
    //   line2: IPv6: <ipv6>
    function drawEthCard(canvas, eth, line1Y, line2Y) {
        var v4Label  = 'IPv4:';
        var v6Label  = 'IPv6:';
        var v4LabelW = HaxrcorpFont16.textWidth(v4Label);
        var v6LabelW = HaxrcorpFont16.textWidth(v6Label);
        var nameW    = HaxrcorpFont16.textWidth(eth.name);
        var GAP_NAME = 4;
        var GAP_LBL  = 3;

        // Line 1 — interface name + "IPv4:" + addr, centered.
        var ip4W   = eth.ip4 ? HaxrcorpFont16.textWidth(eth.ip4) : 0;
        var line1W = nameW + GAP_NAME + v4LabelW + (eth.ip4 ? GAP_LBL + ip4W : 0);
        var nameX  = Math.floor((canvas.w - line1W) / 2);

        HaxrcorpFont16.draw(canvas.ctx, eth.name, nameX, line1Y, '#000');
        var v4LabelX = nameX + nameW + GAP_NAME;
        HaxrcorpFont16.draw(canvas.ctx, v4Label, v4LabelX, line1Y, '#6D6D6D');
        if (eth.ip4) {
            HaxrcorpFont16.draw(canvas.ctx, eth.ip4,
                v4LabelX + v4LabelW + GAP_LBL, line1Y, '#000');
        }

        // Line 2 — "IPv6:" + addr, centered.
        var ip6W   = eth.ip6 ? HaxrcorpFont16.textWidth(eth.ip6) : 0;
        var line2W = v6LabelW + (eth.ip6 ? GAP_LBL + ip6W : 0);
        var v6LabelX = Math.floor((canvas.w - line2W) / 2);

        HaxrcorpFont16.draw(canvas.ctx, v6Label, v6LabelX, line2Y, '#6D6D6D');
        if (eth.ip6) {
            HaxrcorpFont16.draw(canvas.ctx, eth.ip6,
                v6LabelX + v6LabelW + GAP_LBL, line2Y, '#000');
        }
    }

    return DesktopScene;
})();
