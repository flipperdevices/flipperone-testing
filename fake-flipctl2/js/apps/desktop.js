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

        // Active boot profile shown above the hostname — "TV Media
        // Box" / "Desktop Computer". Populated from
        // /api/target/current (empty until the first fetch
        // resolves, in which case the line is simply not drawn).
        this.currentTargetProfile = '';

        // Thermal readings in °C (null = not yet read).
        this.batteryTempC = null;
        this.cpuTempC = null;
        // Battery power flow in W; negative = discharging.
        this.powerWatts = null;
        // List of active Ethernet interfaces (display name + addresses).
        // Populated from /api/ethernet on enter and on each poll tick.
        this.ethList = [];
        // Connected Wi-Fi card. Same shape as an ethList entry
        // ({name, ip4, ip6}) so the same renderer paints both.
        // null when not connected or no IPv4 yet.
        this.wifi = null;
        this._tempTimer = null;

        // Bottom-bar "Menu" button — visual affordance for the X
        // key (`edit` action) which opens the Main Menu via _onMenu().
        // Slot 1 matches the original Desktop layout (left of centre).
        this.menuBtn = new UI.MiddleButton('Menu', 1, 48, 2, 'edit');

        // Bottom-bar right-side "TV Media" button — flush with the
        // right screen edge. Uses the RightButtonTopCut variant
        // (top black stroke cut 21 px short on the right); the
        // stock RightButton is left untouched. Fires on the right
        // soft-key (`run` / b) and launches the TV Media Box app.
        // "TV Media" is 38 px wide, so it fits the 48 px slot.
        this.tvMediaBtn = new UI.RightButtonTopCut('TV Media', 48, 'run');
        // Shown instead when the active target is the Desktop
        // (graphical) profile. Same slot / style; carries the
        // desktop_small_icon (instead of the default media icon).
        this.desktopBtn = new UI.RightButtonTopCut('Desktop', 48, 'run');
        if (typeof Icons !== 'undefined' && Icons.desktop_small_icon) {
            this.desktopBtn.icon = Icons.desktop_small_icon;
        }
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

    // Which boot profile is running right now. Stored as the
    // friendly name ("Desktop Computer", …) and repainted only on
    // change so a steady-state poll doesn't thrash the canvas.
    DesktopScene.prototype._fetchCurrentTarget = function() {
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/target/current', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status !== 200) return;
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
            var next = (data && data.profile) ? data.profile : '';
            if (next !== self.currentTargetProfile) {
                self.currentTargetProfile = next;
                if (typeof window.requestRender === 'function') window.requestRender();
            }
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
        this._fetchWifi();
        this._fetchCurrentTarget();
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
            // Friendly-name map for the Desktop card. Only the kernel
            // network ports (end0/end1) surface here — the USB-gadget
            // interface (flipusb0) is intentionally hidden on Desktop;
            // it's still visible on the Ethernet detail page.
            function friendlyName(rawName) {
                var n = String(rawName || '');
                if (/^end\d+$/i.test(n)) return n.replace(/^end/i, 'ETH').toUpperCase();
                return n.toUpperCase();
            }
            for (var i = 0; i < list.length; i++) {
                var f = list[i];
                if (!f || !Array.isArray(f.ip4) || f.ip4.length === 0) continue;
                // Skip USB-gadget Ethernet on Desktop — only "real"
                // physical ports earn a card here.
                if (/^flipusb\d*$/i.test(String(f.name || ''))) continue;
                snaps.push({
                    name: friendlyName(f.name),
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

    // Pull /api/wifi and turn it into a single ETH-card-shaped snapshot
    // ({name, ip4, ip6}) so `drawEthCard` paints it without changes.
    // Display name is hard-wired to "WIFI" — only one wireless interface
    // is ever active on Flipper One, so the kernel device name (wlan0,
    // wlp2s0, etc.) would just be noise. The card is shown only when:
    //   - we're connected (NetworkManager state = activated), AND
    //   - at least one IPv4 address is present.
    // Same gate as ETH — link can be up but unaddressed mid-DHCP and we
    // don't want a flicker card during association.
    DesktopScene.prototype._fetchWifi = function() {
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/wifi', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status !== 200) return;
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
            var stripCidr = function(s) { return (s || '').replace(/\/\d+$/, ''); };
            var snap = null;
            if (data && data.connected
                && Array.isArray(data.ip4) && data.ip4.length > 0) {
                snap = {
                    name: 'WIFI',
                    ip4: stripCidr(data.ip4[0]),
                    ip6: data.ip6 && data.ip6.length ? stripCidr(data.ip6[0]) : ''
                };
            }
            // Re-render only on real changes (presence or address shift).
            var prev = self.wifi;
            var changed = (snap === null) !== (prev === null)
                || (snap && prev && (snap.ip4 !== prev.ip4 || snap.ip6 !== prev.ip6));
            if (changed) {
                self.wifi = snap;
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
        // Pass the active target so the menu's first item is the right
        // app (TV Media Box / Desktop Computer).
        this.sceneManager.push(new MenuScene(this.sceneManager, this.currentTargetProfile));
    };

    // Launch the TV Media Box app — same scene the Apps menu opens
    // (Apps → TV Media Box), pushed straight onto the stack.
    DesktopScene.prototype._onTVMedia = function() {
        if (typeof TVMediaBoxScene !== 'function') return;
        this.sceneManager.push(new TVMediaBoxScene(this.sceneManager));
    };

    // Desktop target's app-defined button → opens the Desktop
    // Computer app (same scene the main menu's first slot opens).
    DesktopScene.prototype._onDesktop = function() {
        if (typeof DesktopComputerScene !== 'function') return;
        this.sceneManager.push(new DesktopComputerScene(this.sceneManager));
    };

    // The right app-defined button for the active target, or null
    // until the target is known: TV Media Box → tvMediaBtn,
    // Desktop Computer → desktopBtn.
    DesktopScene.prototype._targetBtn = function() {
        if (this.currentTargetProfile === 'TV Media Box')     return this.tvMediaBtn;
        if (this.currentTargetProfile === 'Desktop Computer') return this.desktopBtn;
        return null;
    };

    DesktopScene.prototype.handleInput = function(action) {
        // Menu opens on the X key (`edit` action) — the binding
        // surfaced by the visible bottom-bar Menu button — and on OK
        // (centre) as a primary-action alias.
        if (action === 'edit' || action === 'ok') {
            this._onMenu();
            return;
        }
        // Right soft-key (`run` / b) → the "TV Media" button: brief
        // press flash for feedback, then launch the TV Media Box app.
        if (action === 'run') {
            // Fires whichever target button is currently shown.
            var btn = this._targetBtn();
            if (!btn) return;
            btn.press();
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                btn.release();
                if (window.requestRender) window.requestRender();
            }, 30);
            if (btn === this.tvMediaBtn) this._onTVMedia();
            else                          this._onDesktop();
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
            HaxrCorp4090FlipCTL.draw(canvas.ctx, label, labelX, labelY, '#6D6D6D');
        }
        canvas.drawSprite(icon, iconX, iconY, '#000');

        if (tempC === null) return;

        // Temperature value, right of the icon. One-decimal precision to
        // match the sensor's native resolution (e.g. 44.4, 55.5).
        var tempStr = tempC.toFixed(1);
        var textX = iconX + icon.w + 3;
        // Vertical centering of 7px glyph against icon, shifted 1px up.
        var textY = iconY + Math.floor((icon.h - 7) / 2) - 1;
        HaxrCorp4090FlipCTL.draw(canvas.ctx, tempStr, textX, textY, '#000');

        var numWidth = HaxrCorp4090FlipCTL.textWidth(tempStr);
        var degX = textX + numWidth + 1;
        // Degree glyph sits 2 px below the digit baseline so it visually
        // hangs at the top-right of the number, like a true superscript ring.
        canvas.drawSprite(Icons.degree_symbol, degX, textY + 2, '#000');

        var cX = degX + Icons.degree_symbol.w + 1;
        HaxrCorp4090FlipCTL.draw(canvas.ctx, 'C', cX, textY, '#000');
    }

    // Renders a power-flow block: optional label, power_usage icon, and
    // signed "<±N.NN> W" text. Convention:
    //   +  → power flowing INTO the battery (charging)
    //   −  → power flowing OUT of the battery (discharging)
    //   0  → idle / balanced (a leading space keeps the column width
    //        identical to the signed forms so the value doesn't jitter
    //        horizontally when it crosses zero).
    // Two decimals to match the kernel sysfs reading (`power_now` in µW
    // → W, formatted via `awk '{printf "%.2f W"}' …`).
    function drawPowerCard(canvas, labelX, labelY, iconX, iconY, label, icon, watts) {
        if (label) {
            HaxrCorp4090FlipCTL.draw(canvas.ctx, label, labelX, labelY, '#6D6D6D');
        }
        canvas.drawSprite(icon, iconX, iconY, '#000');
        if (watts === null) return;

        var sign = watts > 0 ? '+' : (watts < 0 ? '-' : ' ');
        var str  = sign + Math.abs(watts).toFixed(2) + ' W';
        var textX = iconX + icon.w + 3;
        var textY = iconY + Math.floor((icon.h - 7) / 2) - 1;
        HaxrCorp4090FlipCTL.draw(canvas.ctx, str, textX, textY, '#000');
    }

    // Pixel-precise x at which the CPU temperature module ends — i.e. the
    // right edge of the "C" glyph after "<temp>°C". Used to place the next
    // module a fixed gap to the right of the CPU readout.
    function cpuTempEndX(cpuTempC) {
        var tempStr = (cpuTempC !== null) ? cpuTempC.toFixed(1) : '55.5';
        var textX = 82 + Icons.cpu_15px.w + 3;  // CPU icon at x=82, value text starts here
        return textX
            + HaxrCorp4090FlipCTL.textWidth(tempStr)
            + 1 + Icons.degree_symbol.w
            + 1 + HaxrCorp4090FlipCTL.textWidth('C');
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
        var hostnameY = UI.STATUS_BAR_H + 49;
        // "Hostname" label baseline — nudged 1 px below the value
        // baseline (visual tweak for the gray label only).
        var hostnameLabelY = hostnameY + 1;
        // "Current target: <profile>" line, one row above the
        // hostname (same centered label+value styling).
        var targetY = UI.STATUS_BAR_H + 36;
        // Divider separating the current-target line from the
        // hostname. Sits above the hostname label, so it stays
        // put regardless of hostnameShift (only rows below the
        // value-line move when the hostname wraps).
        var midDividerY = UI.STATUS_BAR_H + 48;
        var hostnameLabel = 'Hostname';
        var hostnameWraps = !!(this.hostnameRaw
            && this.hostnameRaw.length > HOSTNAME_WRAP_THRESHOLD);
        var hostnameShift = hostnameWraps ? HOSTNAME_LINE_H : 0;

        // Horizontal divider rules below the status bar — top at 34 px,
        // a middle rule between the current-target and hostname lines,
        // and the bottom at 62 px (shifted by hostnameShift when the
        // value wraps). 1 px tall, full canvas width, light gray.
        canvas.drawRect(0, UI.STATUS_BAR_H + 34, canvas.w, 1, '#CCCCCC');
        canvas.drawRect(0, midDividerY, canvas.w, 1, '#CCCCCC');
        canvas.drawRect(0, UI.STATUS_BAR_H + 62 + hostnameShift, canvas.w, 1, '#CCCCCC');

        // Current-target line — centered "Current target: <profile>"
        // (label gray, value black). Drawn only once the active
        // profile is known so the label never flashes value-less
        // before /api/target/current resolves.
        if (this.currentTargetProfile) {
            var tgtLabel  = 'Current target:';
            var tgtLabelW = HaxrCorp4090FlipCTL.textWidth(tgtLabel);
            var tgtGap    = 4;
            var tgtValueW = HaxrCorp4090FlipCTL.textWidth(this.currentTargetProfile);
            var tgtLabelX = Math.floor((canvas.w - (tgtLabelW + tgtGap + tgtValueW)) / 2);
            HaxrCorp4090FlipCTL.draw(canvas.ctx, tgtLabel, tgtLabelX, targetY, '#6D6D6D');
            HaxrCorp4090FlipCTL.draw(canvas.ctx, this.currentTargetProfile,
                tgtLabelX + tgtLabelW + tgtGap, targetY, '#000');
        }

        if (hostnameWraps) {
            // Two-line layout: label on top, value below, both centered.
            var lblW = HaxrCorp4090FlipCTL.textWidth(hostnameLabel);
            HaxrCorp4090FlipCTL.draw(canvas.ctx, hostnameLabel,
                Math.floor((canvas.w - lblW) / 2), hostnameLabelY, '#6D6D6D');
            var valW = HaxrCorp4090FlipCTL.textWidth(this.hostnameRaw);
            HaxrCorp4090FlipCTL.draw(canvas.ctx, this.hostnameRaw,
                Math.floor((canvas.w - valW) / 2),
                hostnameY + HOSTNAME_LINE_H, '#000');
        } else {
            // Single-line layout: label + gap + value, treated as one
            // block centered on the canvas.
            var hostnameLabelW = HaxrCorp4090FlipCTL.textWidth(hostnameLabel);
            var hostnameGap = 4;
            var hostnameValueW = this.hostnameRaw
                ? HaxrCorp4090FlipCTL.textWidth(this.hostnameRaw)
                : 0;
            var hostnameTotalW = hostnameLabelW
                + (this.hostnameRaw ? hostnameGap + hostnameValueW : 0);
            var hostnameLabelX = Math.floor((canvas.w - hostnameTotalW) / 2);
            HaxrCorp4090FlipCTL.draw(canvas.ctx, hostnameLabel, hostnameLabelX, hostnameLabelY, '#6D6D6D');
            if (this.hostnameRaw) {
                var hostValueX = hostnameLabelX + hostnameLabelW + hostnameGap;
                HaxrCorp4090FlipCTL.draw(canvas.ctx, this.hostnameRaw, hostValueX, hostnameY, '#000');
            }
        }

        // Battery thermal block.
        //   "Temperature" label — 57 px from left, 3 px below status bar.
        //   Battery icon + reading module — 36 px from left;
        //   icon top edge is 14 px below the status bar.
        drawThermalCard(canvas,
            57, UI.STATUS_BAR_H + 3,            // label position
            36, UI.STATUS_BAR_H + 14,           // icon position
            'Temperature', Icons.battery_vertical, this.batteryTempC);

        // CPU thermal block — icon + reading only, no label.
        //   Icon — 82 px from left; top edge 15 px below the status bar
        //   (this puts the bottom of the 15-tall CPU icon at the same y as
        //   the bottom of the 16-tall battery icon — they line up cleanly).
        drawThermalCard(canvas,
            0, 0,                                // no label
            82, UI.STATUS_BAR_H + 15,            // icon position
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
            163, UI.STATUS_BAR_H + 3,            // label position
            powerIconX, UI.STATUS_BAR_H + 15,    // icon position
            'Power flow', Icons.power_usage, this.powerWatts);

        // Connection cards — one per active link, stacked vertically below
        // the lower divider. Ethernet interfaces come first (ETH0/ETH1…),
        // followed by the Wi-Fi card if connected (label "WIFI"). Each
        // card is two lines ("<NAME> IPv4: <ipv4>" / "IPv6: <ipv6>")
        // centered horizontally. Interface names and IP values render in
        // black; "IPv4:"/"IPv6:" labels are gray (#6D6D6D).
        var ETH_LINE_H  = 12;   // line spacing within a card
        var ETH_CARD_H  = ETH_LINE_H * 2;
        var ETH_CARD_GAP = 2;   // visual gap between two cards (was 5)
        // Build the card list so the renderer doesn't have to know
        // which slot index belongs to ETH vs WIFI — they're all just
        // {name, ip4, ip6} entries.
        var connCards = this.ethList.slice();
        if (this.wifi) connCards.push(this.wifi);
        // Same +hostnameShift as the lower divider so the spacing
        // between divider and first card stays consistent whether
        // the hostname wrapped or not. Offset shrunk 67 → 65 to
        // tighten the gap below the divider by 2 px.
        var connStartY = UI.STATUS_BAR_H + 65 + hostnameShift;
        for (var ci = 0; ci < connCards.length; ci++) {
            var conn = connCards[ci];
            var line1Y = connStartY + ci * (ETH_CARD_H + ETH_CARD_GAP);
            var line2Y = line1Y + ETH_LINE_H;
            drawEthCard(canvas, conn, line1Y, line2Y);
        }

        // Bottom-bar buttons — drawn last so they sit above any
        // connection card that the worst-case stack might extend
        // close to the canvas bottom. Menu (centre slot) + the
        // right-edge "TV Media" shortcut.
        this.menuBtn.render(canvas);
        // Right app-defined button matches the active target — "TV
        // Media" under the TV Media Box target, "Desktop" under the
        // Desktop target (nothing until the target is known).
        var targetBtn = this._targetBtn();
        if (targetBtn) targetBtn.render(canvas);
    };

    // Renders a single interface card. Two lines, each centered:
    //   line1: <NAME>  IPv4: <ipv4>
    //   line2: IPv6: <ipv6>
    function drawEthCard(canvas, eth, line1Y, line2Y) {
        var v4Label  = 'IPv4:';
        var v6Label  = 'IPv6:';
        var v4LabelW = HaxrCorp4090FlipCTL.textWidth(v4Label);
        var v6LabelW = HaxrCorp4090FlipCTL.textWidth(v6Label);
        var nameW    = HaxrCorp4090FlipCTL.textWidth(eth.name);
        var GAP_NAME = 4;
        var GAP_LBL  = 3;

        // Line 1 — interface name + "IPv4:" + addr, centered.
        var ip4W   = eth.ip4 ? HaxrCorp4090FlipCTL.textWidth(eth.ip4) : 0;
        var line1W = nameW + GAP_NAME + v4LabelW + (eth.ip4 ? GAP_LBL + ip4W : 0);
        var nameX  = Math.floor((canvas.w - line1W) / 2);

        HaxrCorp4090FlipCTL.draw(canvas.ctx, eth.name, nameX, line1Y, '#000');
        var v4LabelX = nameX + nameW + GAP_NAME;
        HaxrCorp4090FlipCTL.draw(canvas.ctx, v4Label, v4LabelX, line1Y, '#6D6D6D');
        if (eth.ip4) {
            HaxrCorp4090FlipCTL.draw(canvas.ctx, eth.ip4,
                v4LabelX + v4LabelW + GAP_LBL, line1Y, '#000');
        }

        // Line 2 — "IPv6:" + addr, centered.
        var ip6W   = eth.ip6 ? HaxrCorp4090FlipCTL.textWidth(eth.ip6) : 0;
        var line2W = v6LabelW + (eth.ip6 ? GAP_LBL + ip6W : 0);
        var v6LabelX = Math.floor((canvas.w - line2W) / 2);

        HaxrCorp4090FlipCTL.draw(canvas.ctx, v6Label, v6LabelX, line2Y, '#6D6D6D');
        if (eth.ip6) {
            HaxrCorp4090FlipCTL.draw(canvas.ctx, eth.ip6,
                v6LabelX + v6LabelW + GAP_LBL, line2Y, '#000');
        }
    }

    return DesktopScene;
})();
