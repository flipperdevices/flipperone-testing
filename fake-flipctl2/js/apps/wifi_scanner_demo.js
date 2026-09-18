/**
 * WifiScannerDemoScene
 *
 * Testing → UI Demos → 'Wi-Fi scanner'. Design-only mockup for the
 * upcoming Wi-Fi scanner app. Current stage: copies of the real
 * Settings screens with every action stripped — nothing talks to
 * the server, nothing changes device state.
 *
 *   1. Entry: a copy of the Settings → Network submenu (same rows,
 *      icons, live status texts, "> Network" breadcrumb). OK on
 *      'Wi-Fi' opens the page below; every other row press-flashes
 *      but opens nothing. The Airplane toggle doesn't toggle.
 *   2. 'Wi-Fi': a copy of the real Wi-Fi page (wifi.js) — toggle
 *      row + grouped drill-in rows, "> Network > Wi-Fi" breadcrumb.
 *      Rows mirror the live read-only radio / connection state;
 *      the toggle and the drill-ins are inert.
 *
 * Both are built on the same components as the originals
 * (SubMenuScene / MenuSelectorFrame / ComponentSelectorFrame), so
 * the layout stays pixel-identical to the real screens.
 */
var WifiScannerDemoScene = (function() {

    // ── Wi-Fi page copy ──────────────────────────────────────────
    // Layout constants copied verbatim from wifi.js so the clone
    // tracks the real page 1:1.
    var BREADCRUMB_X  = 4;
    var BREADCRUMB_Y  = UI.STATUS_BAR_H + 2;
    var SELECTOR_X        = 4;
    var SELECTOR_W        = 247;
    var ROW_H             = 13;         // compact row, no icons
    var SELECTOR_H        = ROW_H + 2;  // 1 px above + 1 px below
    var SELECTOR_Y_OFFSET = -1;
    var DIVIDER_COL       = '#CCCCCC';
    var CONTAINER_Y_OFFSET = 16;
    var TEXT_LEFT_PAD      = 5;
    var STATUS_RIGHT_PAD   = 5;
    var TOGGLE_SPACING     = 15;
    var DIVIDER_ROW_H      = 3;         // 1 px gap + 1 px line + 1 px gap
    var TEXT_DY            = 1;         // cap top 1 px below the row top

    // ── Scan screen ──────────────────────────────────────────────
    // The scanner app's own screen (reached via Wi-Fi → Scan).
    // Empty body for now — just the standard chrome: status bar +
    // gray title strip with the app icon and name (same geometry
    // as MeshCore's strip: icon at x=2, name in Sporty at x=20).
    var TITLE_H = 16;

    var DOTS_MS = 400;   // animated-ellipsis step

    // Network cards — a scrolling stack of ResponsiveFrames in the
    // body, laid out after the design mock: signal icon left, SSID
    // (Sporty) + security pills on the top line, band / channel
    // (Haxrcorp) below. Offsets are relative to the card's top-left.
    var BODY_TOP = UI.STATUS_BAR_H + TITLE_H;     // 29 — clip edge right under the strip
    var LIST_TOP = BODY_TOP + 2;                  // 31 — first card's top
    var CARD_X = 2;
    var CARD_W = 245;
    var CARD_H = 30;
    var CARD_GAP = 1;                             // the divider row between stacked cards
    var CARD_PITCH = CARD_H + CARD_GAP;
    // Selector frame reaches 1 px past the card top and bottom, so it
    // sits exactly on the divider rows above and below and hides them
    // — same trick as the menus (row + 2 tall selector).
    var CARD_SELECTOR_PAD = 1;
    var CARD_VISIBLE = 3;                         // fully visible cards
    var CARD_ICON_DX  = 4;
    var CARD_ICON_DY  = 6;                        // (30 - 17) / 2
    var CARD_TEXT_DX  = 30;
    var CARD_SSID_DY  = 1;
    var CARD_INFO_DY  = 17;
    var CARD_INFO_GAP_CHANNEL = 7;                // band → channel
    var CARD_DIM      = '#696969';
    // Hairline between stacked cards — the single gap row right under
    // a card, inset by the selector's corner radius, like the menu
    // dividers.
    var CARD_DIVIDER_COLOR = '#CCCCCC';
    var CARD_DIVIDER_DY    = CARD_H;              // card top → divider row
    var CARD_DIVIDER_INSET = 3;
    var PILL_RIGHT_PAD = 5;                       // pill cluster → card right edge
    var PILL_DY  = 3;
    var PILL_H   = 11;
    var PILL_PAD = 4;                             // text inset each side
    var PILL_FILL = '#696969';                    // pill background (text stays white)
    var PILL_GAP = 3;                             // between pills (and before the warning icon)
    var LOCK_GAP = 3;                             // SSID text → lock icon
    var LOCK_DY  = 4;                             // lock (8×10) top, 1 px above the SSID ink rows (y+4)
    // Inactive signal arcs are drawn as a translucent ghost of the
    // black icon.
    var SIGNAL_GHOST_ALPHA = 0.3;
    // Scrollbar — same column as the menus (x=253); track starts 1 px
    // under the strip and stops 15 px short of the screen bottom.
    var SCROLLBAR_X = 253;
    var SCROLLBAR_Y = BODY_TOP + 1;               // 30
    var SCROLLBAR_BOTTOM_PAD = 15;
    var SCROLLBAR_H = 144 - SCROLLBAR_BOTTOM_PAD - SCROLLBAR_Y;   // 99
    var SCROLLBAR_THUMB_PAD = 1;
    // Bottom-row button (More on V). Its right edge sits 53 px in
    // from the screen's right edge.
    var BTN_W = 48;
    var MORE_BTN_RIGHT_PAD = 53;
    var MORE_BTN_X = 256 - MORE_BTN_RIGHT_PAD - BTN_W;   // 155
    // "Help" (X slot) shows only while the pop-up is open; its left
    // edge sits 53 px in from the screen's left edge (design mock).
    var HELP_BTN_X = 53;
    // Help pulses while the pop-up is open: its body fills toward
    // black (pressed look) up to HELP_PULSE_MAX_BLACK and back on a
    // sine, one full breath per period.
    var HELP_PULSE_MAX_BLACK = 0.5;
    var HELP_PULSE_MS  = 1600;
    var BTN_H = 14;                 // bottom-button height (canvas.js)
    // Full-screen mock shown when Help is pressed (256×144 PNG,
    // buttons baked into the image). Back/ESC returns to the pop-up.
    var WARNING_IMG_SRC = 'assets/wifi_scanner/wifi_scan_warning.png';

    // Lazy image cache — each asset loads once, repaint on arrival.
    var imageCache = {};
    function loadImage(src) {
        var img = imageCache[src];
        if (!img) {
            img = new Image();
            img.onload = function() {
                if (window.requestRender) window.requestRender();
            };
            img.src = src;
            imageCache[src] = img;
        }
        return img;
    }
    function imageReady(img) {
        return !!(img && img.complete && img.naturalWidth);
    }
    // Gradient strip along the bottom edge, under the buttons.
    var FADE_H = 20;

    // Network pop-up (details for one network): a white wash over the
    // page plus a pre-rendered PNG of the whole window (name tab +
    // frame + content) laid over it. The PNG's frame top edge is on
    // its row 17, so y=3 puts that edge on screen row 20; x=4 keeps
    // the tab's left edge. Also the wash used under the Help warning.
    var POPUP_WASH  = 'rgba(255, 255, 255, 0.5)';
    var POPUP_IMG_X = 4;
    var POPUP_IMG_Y = 3;
    var POPUP_IMAGES = {
        'My_Home': 'assets/wifi_scanner/My_home_more.png'
    };
    // Only this network opens the pop-up for now.
    var POPUP_SSID = 'My_Home';

    // Fake scan results. `level` = active arcs 0..3 (dot always on),
    // `security` = pills left→right (anything but OPEN also gets the
    // lock after the SSID), `warn` = warning icon after the pills.
    var NETWORKS = [
        { ssid: 'Cafe-WiFi',    band: '2.4GHz', channel: 4,   security: ['OPEN'],         level: 3 },
        { ssid: 'My_Home',      band: '2.4GHz', channel: 8,   security: ['WEP'],          level: 2, warn: true },
        { ssid: 'YourMomGuest', band: '5GHz',   channel: 121, security: ['WPA3', 'SAE'],  level: 1 },
        { ssid: 'home_iot_2G',  band: '2.4GHz', channel: 11,  security: ['WPA2'],         level: 0 },
        { ssid: 'TP-Link_5F2A', band: '2.4GHz', channel: 1,   security: ['WPA2'],         level: 2 },
        { ssid: 'DIRECT-7A-HP', band: '5GHz',   channel: 36,  security: ['WPA2'],         level: 1 },
        { ssid: 'xfinitywifi',  band: '2.4GHz', channel: 6,   security: ['OPEN'],         level: 1 },
        { ssid: 'Office_Guest', band: '5GHz',   channel: 44,  security: ['WPA3'],         level: 3 }
    ];

    // Which signal-icon segment a pixel of wi_fi_icon_22px (22×17)
    // belongs to. The three arcs stack vertically but their tails
    // share row 5 and row 9 with the next arc's crown, so the split
    // is by row AND column, not by row bands alone:
    //   3 = outer arc  rows 0-4, plus row 5 cols 0-3 / 18-21 (tails)
    //   2 = middle arc row 5 centre, rows 6-9
    //   1 = inner arc  rows 10-13
    //   0 = dot        rows 14-16
    function wifiSegment(row, col) {
        if (row <= 4) return 3;
        if (row === 5) return (col < 4 || col > 17) ? 3 : 2;
        if (row <= 9) return 2;
        if (row <= 13) return 1;
        return 0;
    }

    // Draw the 6-bit grayscale signal icon segment by segment: arcs
    // 1..activeArcs (counted from the dot outwards) and the dot are
    // solid black, the rest are translucent. Same pixel unpacking as
    // FlipCanvas._drawGrayscaleSprite (4 px per 3 bytes, 63 = clear).
    function drawWifiSegments(canvas, sprite, x, y, activeArcs) {
        var ctx = canvas.ctx;
        var idx = 0;
        for (var row = 0; row < sprite.h; row++) {
            for (var col = 0; col < sprite.w; col += 4) {
                var b0 = sprite.d[idx] || 0, b1 = sprite.d[idx + 1] || 0, b2 = sprite.d[idx + 2] || 0;
                idx += 3;
                var px = [
                    (b0 >> 2) & 0x3F,
                    (((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0F)) & 0x3F,
                    (((b1 & 0x0F) << 2) | ((b2 >> 6) & 0x03)) & 0x3F,
                    b2 & 0x3F
                ];
                for (var i = 0; i < 4 && col + i < sprite.w; i++) {
                    var opacity = (63 - px[i]) / 63;
                    if (opacity <= 0.01) continue;
                    var seg = wifiSegment(row, col + i);
                    var on  = (seg === 0) || (seg <= activeArcs);
                    ctx.globalAlpha = opacity * (on ? 1 : SIGNAL_GHOST_ALPHA);
                    ctx.fillStyle = '#000';
                    ctx.fillRect(x + col + i, y + row, 1, 1);
                }
            }
        }
        ctx.globalAlpha = 1;
    }

    // One card at (CARD_X, y). Idle cards have no outline — the list
    // reads as rows separated by hairline dividers (drawn by the
    // caller in the gap). The selected card gets the MenuSelectorFrame
    // (black stroke + shadow pixel, same as the menus), 1 px taller
    // than the card on each side so it covers both dividers.
    function drawNetworkCard(canvas, net, y, selected, selectorFrame) {
        var ctx = canvas.ctx;
        if (selected) {
            selectorFrame.setPosition(CARD_X, y - CARD_SELECTOR_PAD);
            selectorFrame.setSize(CARD_W, CARD_H + 2 * CARD_SELECTOR_PAD);
            selectorFrame.render(canvas);
        }

        drawWifiSegments(canvas, Icons.wi_fi_icon_22px,
            CARD_X + CARD_ICON_DX, y + CARD_ICON_DY, net.level);

        var ssidX = CARD_X + CARD_TEXT_DX;
        Born2bSportyV2FlipCTL.draw(ctx, net.ssid, ssidX, y + CARD_SSID_DY, '#000');
        // Secured networks carry a lock right after the name.
        if (net.security.indexOf('OPEN') === -1) {
            canvas.drawSprite(Icons.lock_icon_8px,
                ssidX + Born2bSportyV2FlipCTL.textWidth(net.ssid) + LOCK_GAP,
                y + LOCK_DY, '#000');
        }

        // Security pills — solid black rounded boxes with the tag in
        // white, each sized to its tag. The whole cluster (pills,
        // gaps, and the warning icon of a `warn` network — 11 px
        // tall, flush with the pill's top) is right-aligned to the
        // card's right edge minus PILL_RIGHT_PAD, keeping the
        // left→right order.
        var widths = [];
        var cluster = 0;
        for (var m = 0; m < net.security.length; m++) {
            widths[m] = HaxrCorp4090FlipCTL.textWidth(net.security[m]) + 2 * PILL_PAD;
            cluster += widths[m] + (m > 0 ? PILL_GAP : 0);
        }
        if (net.warn) cluster += PILL_GAP + Icons.warning_icon.w;
        var px = CARD_X + CARD_W - PILL_RIGHT_PAD - cluster;
        var py = y + PILL_DY;
        for (var t = 0; t < net.security.length; t++) {
            var tag = net.security[t];
            var pw  = widths[t];
            new ResponsiveFrame({
                x: px, y: py, width: pw, height: PILL_H,
                anchorH: 'left', anchorV: 'top',
                showStroke: false,
                showFill: true, fillColor: PILL_FILL,
                cornerRadius: 3
            }).render(canvas);
            HaxrCorp4090FlipCTL.draw(ctx, tag, px + PILL_PAD, py, '#fff');
            px += pw + PILL_GAP;
        }
        if (net.warn) {
            canvas.drawSprite(Icons.warning_icon, px, py, '#000');
        }

        // Info line: band + channel, dimmed.
        var x = CARD_X + CARD_TEXT_DX;
        var iy = y + CARD_INFO_DY;
        HaxrCorp4090FlipCTL.draw(ctx, net.band, x, iy, CARD_DIM);
        x += HaxrCorp4090FlipCTL.textWidth(net.band) + CARD_INFO_GAP_CHANNEL;
        HaxrCorp4090FlipCTL.draw(ctx, 'Channel ' + net.channel, x, iy, CARD_DIM);
    }

    function ScanPageDemo(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Wi-Fi';
        this.breadcrumbTitle = 'Wi-Fi';
        this._dotTick  = 0;   // 0..3 → '', '.', '..', '...'
        this._dotTimer = null;

        this._networks   = NETWORKS;
        this._selected   = 0;
        this._scroll     = 0;      // index of the first visible card
        this._popup      = null;   // network shown in the details pop-up, or null
        this._warning    = false;  // Help's full-screen warning mock is up
        // Start loading the mocks now so the first show is instant.
        loadImage(WARNING_IMG_SRC);
        loadImage(POPUP_IMAGES[POPUP_SSID]);
        this._selectorFrame = new MenuSelectorFrame({
            x: CARD_X, y: LIST_TOP, width: CARD_W, height: CARD_H,
            anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });
        this._scrollbar = new UI.Scrollbar(this._networks.length, CARD_VISIBLE, 0);

        // Bottom button: "More" on the V slot (index 3, like
        // MeshCore's New), nudged to the design's x. A toggle button
        // — its 2 px top bar goes black while the details pop-up is
        // open and back to gray when it closes.
        this._moreBtn = new UI.MiddleToggleButton('More', 3, BTN_W, 2, 'del',
            function() { /* fired from handleInput */ }, false);
        this._moreBtn.x = MORE_BTN_X;   // off the slot grid, per the design

        // "Help" on the X slot — only shown while the pop-up is open.
        // Press-flash only, no action yet.
        this._helpBtn = new UI.MiddleButton('Help', 1, BTN_W, 2, 'edit',
            function() { /* fired from handleInput */ });
        this._helpBtn.x = HELP_BTN_X;
    }

    // Close the details pop-up and switch More's toggle bar off.
    ScanPageDemo.prototype._closePopup = function() {
        this._popup = null;
        this._warning = false;
        this._moreBtn.toggled = false;
        if (window.requestRender) window.requestRender();
    };

    // 30 ms press flash, same pattern as the other apps' buttons;
    // `then` (optional) runs on release.
    ScanPageDemo.prototype._pressButton = function(btn, then) {
        btn.press();
        if (window.requestRender) window.requestRender();
        setTimeout(function() {
            btn.release();
            if (then) then();
            if (window.requestRender) window.requestRender();
        }, 30);
    };

    // Keep the selected card fully inside the CARD_VISIBLE window.
    ScanPageDemo.prototype._ensureVisible = function() {
        if (this._selected < this._scroll) {
            this._scroll = this._selected;
        } else if (this._selected >= this._scroll + CARD_VISIBLE) {
            this._scroll = this._selected - CARD_VISIBLE + 1;
        }
    };

    ScanPageDemo.prototype.enter = function() {
        var self = this;
        if (this._dotTimer) return;
        this._dotTimer = setInterval(function() {
            self._dotTick = (self._dotTick + 1) % 4;
            if (window.requestRender) window.requestRender();
        }, DOTS_MS);
    };

    ScanPageDemo.prototype.exit = function() {
        if (this._dotTimer) {
            clearInterval(this._dotTimer);
            this._dotTimer = null;
        }
    };

    ScanPageDemo.prototype.handleInput = function(action) {
        // Pop-up owns input while open: Back/ESC or More again closes
        // it (More is a toggle — flashes, then switches off), the
        // rest is swallowed.
        if (this._popup) {
            var closeSelf = this;
            // Warning mock on top of the pop-up: Back/ESC returns to
            // the pop-up, everything else is swallowed.
            if (this._warning) {
                if (action === 'back' || action === 'esc') {
                    this._warning = false;
                    if (window.requestRender) window.requestRender();
                }
                return;
            }
            if (action === 'del') {
                this._pressButton(this._moreBtn, function() { closeSelf._closePopup(); });
            } else if (action === 'edit') {
                // Help: flash, then show the full-screen warning mock.
                this._pressButton(this._helpBtn, function() { closeSelf._warning = true; });
            } else if (action === 'back' || action === 'esc') {
                this._closePopup();
            }
            return;
        }
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'down' || action === 'up') {
            // Wraps at both ends, like the menus.
            var n = this._networks.length;
            var d = (action === 'down') ? 1 : -1;
            this._selected = (this._selected + d + n) % n;
            this._ensureVisible();
            if (window.requestRender) window.requestRender();
            return;
        }
        if (action === 'del') {
            // More: press flash, then open the details pop-up — for
            // now only when the selected network is POPUP_SSID. The
            // button's toggle bar stays on for as long as the pop-up
            // is open.
            var self = this;
            var net  = this._networks[this._selected];
            this._pressButton(this._moreBtn, function() {
                if (net && net.ssid === POPUP_SSID) {
                    self._popup = net;
                    self._moreBtn.toggled = true;
                }
            });
            return;
        }
    };

    ScanPageDemo.prototype.render = function(canvas) {
        canvas.clear('#fff');
        var ctx = canvas.ctx;
        if (typeof UI !== 'undefined' && UI.drawStatusBar) {
            UI.drawStatusBar(canvas, '');
        }
        var TITLE_Y = UI.STATUS_BAR_H;
        ctx.fillStyle = '#D9D9D9';
        ctx.fillRect(0, TITLE_Y, canvas.w, TITLE_H);
        canvas.drawSprite(Icons.wi_fi_scanner, 2, TITLE_Y + 1, '#000');
        Born2bSportyV2FlipCTL.draw(ctx, this.displayName, 19, TITLE_Y, '#000');

        // Strip status, centered in the strip: "Scanning" + animated
        // 1→3 dot ellipsis. Centered on the FULL "Scanning..." width
        // and drawn left-aligned from that x, so the word stays put
        // and only the dots grow.
        var base = 'Scanning';
        var dots = ['', '.', '..', '...'][this._dotTick];
        var fullW = HaxrCorp4090FlipCTL.textWidth(base + '...');
        HaxrCorp4090FlipCTL.draw(ctx, base + dots,
            Math.floor((canvas.w - fullW) / 2), TITLE_Y + 3, '#000');

        // Card stack, clipped to the body so a partially scrolled
        // card never paints over the title strip. One extra card
        // past the visible window is drawn so the cut-off next card
        // peeks in at the bottom, as in the mock.
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, BODY_TOP, canvas.w, canvas.h - BODY_TOP);
        ctx.clip();
        var total = this._networks.length;
        var last = Math.min(total, this._scroll + CARD_VISIBLE + 1);
        for (var i = this._scroll; i < last; i++) {
            var cy = LIST_TOP + (i - this._scroll) * CARD_PITCH;
            // Divider first, card after — so the selected card's
            // frame paints over the divider below it (the one above
            // was drawn with the previous card).
            if (i < total - 1) {
                canvas.drawHLine(CARD_X + CARD_DIVIDER_INSET, cy + CARD_DIVIDER_DY,
                    CARD_W - 2 * CARD_DIVIDER_INSET, CARD_DIVIDER_COLOR);
            }
            drawNetworkCard(canvas, this._networks[i], cy,
                i === this._selected, this._selectorFrame);
        }
        ctx.restore();

        this._scrollbar.update(this._networks.length, CARD_VISIBLE, this._scroll);
        this._scrollbar.render(canvas, SCROLLBAR_X, SCROLLBAR_Y, SCROLLBAR_H, SCROLLBAR_THUMB_PAD);

        // Bottom fade — 256×20 strip under the buttons, over everything
        // else: fully transparent #D3D3D3 at the top → opaque #BDBDBD
        // at the bottom edge.
        var fadeY = canvas.h - FADE_H;
        var fade = ctx.createLinearGradient(0, fadeY, 0, canvas.h);
        fade.addColorStop(0, 'rgba(211, 211, 211, 0)');
        fade.addColorStop(1, 'rgba(189, 189, 189, 1)');
        ctx.fillStyle = fade;
        ctx.fillRect(0, fadeY, canvas.w, FADE_H);

        // Bottom button sits on top of the fade.
        this._moreBtn.render(canvas);

        // Details pop-up on top of everything — except More, which
        // is redrawn above the wash with its toggle bar on, so it
        // reads as the control that closes the pop-up.
        if (this._popup) {
            drawPopup(canvas, this._popup);
            // Help breathes: its body fills toward black — like a
            // press, but capped at HELP_PULSE_MAX_BLACK — on a sine,
            // and back. Drawn as a black overlay on the button's
            // interior (inside the 1-px outline, following the 3-px
            // rounded top corners of drawMiddleButton), so the label
            // stays black on top. Skipped while the real press flash
            // is on. The scene re-schedules itself every frame while
            // the pop-up is open so the pulse runs at display rate.
            // Help disappears entirely while the warning mock is up
            // (the PNG carries its own Close / ? buttons).
            if (!this._warning) this._helpBtn.render(canvas);
            if (!this._warning && !this._helpBtn.pressed) {
                var phase = (Date.now() % HELP_PULSE_MS) / HELP_PULSE_MS;
                var pulse = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);   // 0..1
                var bx = this._helpBtn.x, bw = this._helpBtn.w;
                var by = canvas.h - BTN_H;
                ctx.fillStyle = 'rgba(0, 0, 0, ' + (HELP_PULSE_MAX_BLACK * pulse) + ')';
                ctx.fillRect(bx + 3, by + 1, bw - 6, 1);
                ctx.fillRect(bx + 2, by + 2, bw - 4, 1);
                ctx.fillRect(bx + 1, by + 3, bw - 2, BTN_H - 3);
                // Label inverts with the fill: black at rest → white
                // at the darkest point, so it stays readable. Same
                // placement as canvas.js's _btnText (centred, y + 2).
                var lv = Math.round(255 * pulse);
                var label = this._helpBtn.text;
                var lw = HaxrCorp4090FlipCTL.textWidth(label);
                HaxrCorp4090FlipCTL.draw(ctx, label,
                    bx + Math.floor((bw - lw) / 2), by + 2,
                    'rgb(' + lv + ',' + lv + ',' + lv + ')');
            }
            this._moreBtn.render(canvas);

            // Help's full-screen warning mock is an overlay too: the
            // transparent PNG goes over another 50 % white wash, so
            // the pop-up stays visible (dimmed) behind it.
            if (this._warning) {
                var img = loadImage(WARNING_IMG_SRC);
                if (imageReady(img)) {
                    ctx.fillStyle = POPUP_WASH;
                    ctx.fillRect(0, 0, canvas.w, canvas.h);
                    ctx.drawImage(img, 0, 0, canvas.w, canvas.h);
                }
            }
            if (window.requestRender) window.requestRender();
        }
    };

    // Network details pop-up: white wash over the page, then the
    // network's pre-rendered window PNG (transparent background) as
    // an overlay at POPUP_IMG_X/Y.
    function drawPopup(canvas, net) {
        var ctx = canvas.ctx;
        ctx.fillStyle = POPUP_WASH;
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        var src = POPUP_IMAGES[net.ssid];
        var img = src ? loadImage(src) : null;
        if (imageReady(img)) {
            ctx.drawImage(img, POPUP_IMG_X, POPUP_IMG_Y);
        }
    }

    function WifiPageDemo(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Wi-Fi';
        this.breadcrumbTitle = 'Wi-Fi';

        this.containerY    = UI.STATUS_BAR_H + CONTAINER_Y_OFFSET;
        this.selectedIndex = 0;
        this.items         = [];
        this._buildItems();

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
            chevronWidth: 7,
            chevronColor: '#666666',
            chevronGlyphColor: '#ffffff'
        });
    }

    // Same row structure as the real page, minus most actions: the
    // toggle has no onToggle and only 'Scan' drills in (into the
    // scanner screen). State is read live (radio on/off, connected
    // SSID) so the copy always shows what the real page would.
    WifiPageDemo.prototype._buildItems = function() {
        var self = this;
        var w = UI.getWifiInfo();
        var enabled = UI.getWifiEnabled();
        var items = [];
        items.push({
            text: 'Wi-Fi',
            isToggle: true,
            getStatus: function() { return UI.getWifiEnabled() ? 'ON' : 'OFF'; }
        });
        if (enabled) {
            items.push({ kind: 'divider' });
            if (w.connected && w.ssid) {
                items.push({ text: w.ssid, chevron: true, isConnected: true });
            }
            items.push({
                text: 'Scan',
                chevron: true,
                onPress: function() {
                    if (self.sceneManager) {
                        self.sceneManager.push(new ScanPageDemo(self.sceneManager));
                    }
                }
            });
            items.push({ kind: 'divider' });
            items.push({ text: 'Saved networks', chevron: true });
            items.push({ text: 'Connect to Hidden Network', chevron: true });
        }
        this.items = items;
        if (this.selectedIndex >= items.length) {
            this.selectedIndex = Math.max(0, items.length - 1);
        }
        if (items[this.selectedIndex] && items[this.selectedIndex].kind === 'divider') {
            this.selectedIndex = this._nextSelectable(this.selectedIndex, 1);
        }
    };

    WifiPageDemo.prototype._nextSelectable = function(idx, dir) {
        var n = this.items.length;
        if (n === 0) return 0;
        for (var step = 0; step < n; step++) {
            idx = (idx + dir + n) % n;
            var it = this.items[idx];
            if (!it || it.kind !== 'divider') return idx;
        }
        return 0;
    };

    WifiPageDemo.prototype.handleInput = function(action) {
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
            // Only rows with an onPress do anything (Scan → the
            // scanner screen); the rest are inert, same as the
            // real page's chevron-row behaviour (no press flash).
            var sel = this.items[this.selectedIndex];
            if (sel && sel.onPress) sel.onPress();
            return;
        }
        // left/right: inert — the demo toggle never fires.
    };

    // Verbatim port of WifiScene._drawToggleStatus (sans the
    // arrow-press flash — the demo toggle never fires).
    WifiPageDemo.prototype._drawToggleStatus = function(canvas, item, isSelected, x, w, y, color) {
        var ctx     = canvas.ctx;
        var midTxt  = item.getStatus();   // 'ON' or 'OFF'
        var rightX  = x + w - STATUS_RIGHT_PAD;
        if (!isSelected) {
            var dimW = HaxrCorp4090FlipCTL.textWidth(midTxt);
            HaxrCorp4090FlipCTL.draw(ctx, midTxt, rightX - dimW, y, color);
            return;
        }
        var ltW   = HaxrCorp4090FlipCTL.textWidth('<');
        var midW  = HaxrCorp4090FlipCTL.textWidth('OFF');
        var gtW   = HaxrCorp4090FlipCTL.textWidth('>');
        var gtX   = rightX - gtW;
        var ltX   = gtX - TOGGLE_SPACING - midW - TOGGLE_SPACING - ltW;
        var midBase = ltX + ltW + TOGGLE_SPACING;
        var midTxtW = HaxrCorp4090FlipCTL.textWidth(midTxt);
        var midX    = Math.floor(midBase + (midW - midTxtW) / 2);
        HaxrCorp4090FlipCTL.draw(ctx, '<',     ltX,  y, color);
        HaxrCorp4090FlipCTL.draw(ctx, midTxt,  midX, y, color);
        HaxrCorp4090FlipCTL.draw(ctx, '>',     gtX,  y, color);
    };

    WifiPageDemo.prototype.render = function(canvas) {
        this._buildItems();
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // Fixed "> Network > Wi-Fi" — matches the real page's
        // stack-derived trail instead of our Testing → UI Demos
        // path.
        HaxrCorp4090FlipCTL.draw(canvas.ctx, '> Network > Wi-Fi',
            BREADCRUMB_X, BREADCRUMB_Y, '#CCCCCC');

        var y = this.containerY;
        var selectedY = y;
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
            if (item.isConnected) {
                // Gray "Connected to:" prefix + SSID in black.
                var connPrefix = 'Connected to: ';
                var connPrefixW = HaxrCorp4090FlipCTL.textWidth(connPrefix);
                HaxrCorp4090FlipCTL.draw(canvas.ctx, connPrefix,
                    SELECTOR_X + TEXT_LEFT_PAD, y + TEXT_DY, '#999999');
                HaxrCorp4090FlipCTL.draw(canvas.ctx, item.text,
                    SELECTOR_X + TEXT_LEFT_PAD + connPrefixW,
                    y + TEXT_DY, '#000');
            } else {
                HaxrCorp4090FlipCTL.draw(canvas.ctx, item.text,
                    SELECTOR_X + TEXT_LEFT_PAD, y + TEXT_DY, '#000');
            }
            if (item.isToggle && item.getStatus) {
                var statusColor = isSelected ? '#000' : '#999999';
                this._drawToggleStatus(canvas, item, isSelected,
                    SELECTOR_X, SELECTOR_W, y + TEXT_DY, statusColor);
            }
            y += ROW_H;
            // Connected row gets +1 px breathing room below.
            if (item.isConnected) y += 1;
        }

        // Selector: toggle row → plain frame, chevron rows → the
        // chevron-bar frame (drill-in affordance only on highlight).
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
    };

    // ── Network submenu copy (demo entry point) ──────────────────
    function WifiScannerDemoScene(sceneManager) {
        var subMenu = new SubMenuScene(sceneManager, 'Network', [
            'Wi-Fi',
            'Ethernet',
            '5G Modem',
            'Airplane mode',
            'Routing info'
        ], {
            // Only Wi-Fi drills in — into the UI copy above. The
            // other rows press-flash but open nothing.
            'Wi-Fi': function() { return new WifiPageDemo(sceneManager); }
        });

        // Read as "> Network" like the real Settings page instead of
        // inheriting the "> Testing > UI Demos > …" trail.
        subMenu.setBreadcrumbTrail(['Network']);

        var iconMap = {
            'Routing info':  Icons.info_icon,
            '5G Modem':      Icons.modem_5g,
            'Wi-Fi':         Icons.wifi,
            'Ethernet':      Icons.ethernet,
            'Airplane mode': Icons.airplane_mode
        };
        var animatedIconMap = {
            'Airplane mode': AnimatedIcons.airplane_mode_animated
        };
        for (var i = 0; i < subMenu.items.length; i++) {
            var name = subMenu.items[i].text;
            subMenu.items[i].icon = iconMap[name] || null;
            subMenu.items[i].iconAnimated = animatedIconMap[name] || null;
        }

        // Status texts mirror the real Network menu's read-only
        // providers, so the copy always shows what Settings would
        // show; only the actions behind them are gone (no onToggle
        // → the Airplane chevrons are inert).
        for (var j = 0; j < subMenu.items.length; j++) {
            var line = subMenu.items[j];
            if (line.text === 'Wi-Fi') {
                line.statusProvider = function() {
                    if (!UI.getWifiEnabled()) return 'OFF';
                    var w = UI.getWifiInfo();
                    if (!w.connected) return 'not connected';
                    return w.ssid || 'connected';
                };
            } else if (line.text === '5G Modem') {
                line.statusProvider = function() {
                    return UI.getAirplaneMode() ? 'Airplane mode' : null;
                };
            } else if (line.text === 'Airplane mode') {
                line.statusProvider = function() {
                    return UI.getAirplaneMode() ? '< ON >' : '< OFF >';
                };
            }
        }

        return subMenu;
    }

    return WifiScannerDemoScene;
})();
