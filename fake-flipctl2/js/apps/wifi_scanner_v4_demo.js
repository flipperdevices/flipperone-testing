/**
 * WifiScannerV4DemoScene
 *
 * Testing → Kickstarter demo → Wi-Fi scanner → 'Version 4'. A
 * standalone copy of Version 1 (wifi_scanner_demo.js) — no code is
 * shared, so either can change without breaking the other.
 *
 *   1. Entry: a copy of the Settings → Network submenu; OK on 'Wi-Fi'
 *      opens the page below, other rows press-flash only.
 *   2. 'Wi-Fi': a copy of the real Wi-Fi page; 'Scan' opens the list.
 *   3. Scan list — same cards as Version 1, but My_Home is first and
 *      the only full-strength network, the rest sorted by signal, and
 *      each card's info line also shows the channel width.
 *   4. More opens a Wi-Fi scanner v2-style text pop-up for any network
 *      (signal, band / channel / width, Security, Protocol, BSSID,
 *      Vendor, Clients); Help is there only for WEP (My_Home). Help
 *      shows the dolphin typing an explanation into a speech bubble
 *      sized to the text.
 */
var WifiScannerV4DemoScene = (function() {

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
    // Help: the dolphin explains the problem, typing it into its speech
    // bubble. Same look as FlipSDR's dolphin hint, with the Wi-Fi
    // scanner's dolphin (it carries the small "?" button): the layer
    // (256×144 PNG, transparent background, mouth open / closed —
    // flapped at random intervals while it's typing, closed once done)
    // over a white wash (HELP_WASH), and a speech bubble drawn in code and
    // sized to its text. Back/ESC returns to the pop-up.
    var DOLPHIN_OPEN  = 'assets/wifi_scanner/wifi_scan_warning_doplhin_open.png';
    var DOLPHIN_CLOSE = 'assets/wifi_scanner/wifi_scan_warning_doplhin_close.png';
    var TALK_OPEN_MS   = [70, 180];      // how long the mouth stays open
    var TALK_CLOSED_MS = [60, 260];      // ... and closed
    // Bubble: left edge fixed next to the dolphin; the tail opens that
    // edge on rows TAIL_Y..TAIL_Y+TAIL_H-1 (at the mouth) and never
    // moves. The bubble is sized to the text — as wide as the longest
    // line (wrap at BUBBLE_MAX_TEXT_W), as tall as the line count — and
    // grows right and up from its fixed bottom edge.
    var BUBBLE_X      = 119;
    var BUBBLE_BOTTOM = 91;              // last row of the frame (tail ~mid-height)
    var BUBBLE_PAD    = 6;
    var BUBBLE_MAX_TEXT_W = 112;
    var BUBBLE_TITLE_TO_BODY = 13;       // Helvb08 draw y → first Haxrcorp draw y
    var BUBBLE_LINE_H = 10;
    var TAIL_Y = 56;                     // tail rows 56..64, fixed at the mouth
    var TAIL_H = 9;
    var HELP_TITLE = 'Weak security!';
    // Body paragraphs, separated by an empty line.
    var HELP_BODY  = ['WEP is outdated and easy to hack.', 'Switch to WPA3.'];
    // Wash behind the dolphin + bubble: more opaque than the pop-up's,
    // so the page behind fades out and the dolphin / bubble stand out.
    var HELP_WASH  = 'rgba(255, 255, 255, 0.85)';
    var TYPE_CHAR_MS  = 30;              // typing speed
    var TYPE_START_MS = 250;             // pause before the first letter
    // OK on the Help screen toggles blinking of the last paragraph (the
    // call to action): while on it alternates between a black pill
    // with white text and plain text, BLINK_MS each, until OK again.
    var BLINK_MS    = 300;
    var PILL_PAD_X  = 4;                 // pill edge → Haxrcorp ink, left / right

    // Greedy word wrap for Haxrcorp at `width` px.
    function wrapText(text, width) {
        var words = text.split(' ');
        var lines = [];
        var line = '';
        for (var i = 0; i < words.length; i++) {
            var next = line ? line + ' ' + words[i] : words[i];
            if (line && HaxrCorp4090FlipCTL.textWidth(next) > width) {
                lines.push(line);
                line = words[i];
            } else {
                line = next;
            }
        }
        if (line) lines.push(line);
        return lines;
    }
    var HELP_LINES = [];
    for (var hp = 0; hp < HELP_BODY.length; hp++) {
        if (hp > 0) HELP_LINES.push('');
        HELP_LINES = HELP_LINES.concat(wrapText(HELP_BODY[hp], BUBBLE_MAX_TEXT_W));
    }
    // First line of the last paragraph — the part OK blinks.
    var HELP_BLINK_FROM = HELP_LINES.lastIndexOf('') + 1;
    var HELP_CHARS = HELP_TITLE.length;
    for (var hl = 0; hl < HELP_LINES.length; hl++) HELP_CHARS += HELP_LINES[hl].length;

    // Bubble geometry from the full text (fixed while typing). Helvb08
    // caps sit at y+1..y+8, Haxrcorp ink at y+2..y+8 (+2 descender
    // rows); BUBBLE_PAD - 1 rows of air above the caps and below the
    // descenders.
    var HELP_BUBBLE = (function() {
        var textW = Helvb08Regular.textWidth(HELP_TITLE);
        for (var i = 0; i < HELP_LINES.length; i++) {
            textW = Math.max(textW, HaxrCorp4090FlipCTL.textWidth(HELP_LINES[i]));
        }
        var textH = BUBBLE_TITLE_TO_BODY + (HELP_LINES.length - 1) * BUBBLE_LINE_H + 10;
        var h = textH + 2 * BUBBLE_PAD - 1;
        return { x: BUBBLE_X, y: BUBBLE_BOTTOM - h + 1, w: textW + 2 * BUBBLE_PAD, h: h };
    })();

    function preloadWarning() {
        loadImage(DOLPHIN_OPEN);
        loadImage(DOLPHIN_CLOSE);
    }
    function randBetween(range) {
        return range[0] + Math.random() * (range[1] - range[0]);
    }
    // Paint the Help screen: the dolphin (talking while letters are still
    // coming), the bubble with its tail, and as much of the title + body
    // as has been typed `typeStart` ms-epoch after it opened.
    // `talk` = { open, nextAt }.
    function drawWarning(canvas, talk, typeStart, blinkAt) {
        var ctx = canvas.ctx;
        var now = Date.now();
        var typed = Math.max(0, Math.floor((now - typeStart - TYPE_START_MS) / TYPE_CHAR_MS));
        if (typed >= HELP_CHARS) {
            talk.open = false;
        } else if (now >= talk.nextAt) {
            talk.open   = !talk.open;
            talk.nextAt = now + randBetween(talk.open ? TALK_OPEN_MS : TALK_CLOSED_MS);
        }
        ctx.fillStyle = HELP_WASH;
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        var dolphin = loadImage(talk.open ? DOLPHIN_OPEN : DOLPHIN_CLOSE);
        if (imageReady(dolphin)) ctx.drawImage(dolphin, 0, 0);

        var b = HELP_BUBBLE;
        new ResponsiveFrame({
            x: b.x, y: b.y, width: b.w, height: b.h,
            anchorH: 'left', anchorV: 'top',
            showStroke: true, strokeColor: '#000',
            showFill: true, fillColor: '#fff',
            cornerRadius: 4,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        // Tail: opens the left border on rows TAIL_Y..TAIL_Y+7, diagonal
        // down-left, flat base on the last row (FlipSDR's tail).
        for (var k = 0; k < TAIL_H - 1; k++) {
            ctx.fillStyle = '#fff';
            ctx.fillRect(b.x - k, TAIL_Y + k, k + 1, 1);
            ctx.fillStyle = '#000';
            ctx.fillRect(b.x - 1 - k, TAIL_Y + k, 1, 1);
        }
        ctx.fillStyle = '#000';
        ctx.fillRect(b.x - TAIL_H, TAIL_Y + TAIL_H - 1, TAIL_H + 1, 1);

        // Typed text.
        var tx = b.x + BUBBLE_PAD;
        var titleY = b.y + BUBBLE_PAD - 1;
        var left = typed;
        var title = HELP_TITLE.slice(0, left);
        Helvb08Regular.draw(ctx, title, tx, titleY, '#000');
        left -= title.length;
        // Blink (while toggled on): pill on the first half of each
        // BLINK_MS * 2 cycle.
        var pillOn = !!blinkAt && Math.floor((now - blinkAt) / BLINK_MS) % 2 === 0;
        for (var i = 0; i < HELP_LINES.length && left > 0; i++) {   // '' = paragraph gap
            var part = HELP_LINES[i].slice(0, left);
            var ly = titleY + BUBBLE_TITLE_TO_BODY + i * BUBBLE_LINE_H;
            var inPill = pillOn && i >= HELP_BLINK_FROM && part;
            if (inPill) {
                // Haxrcorp ink spans x+1..x+w-1, rows y+2..y+8: PILL_PAD_X
                // px of black left / right, 2 px above / below.
                new ResponsiveFrame({
                    x: tx + 1 - PILL_PAD_X, y: ly,
                    width: HaxrCorp4090FlipCTL.textWidth(part) - 1 + 2 * PILL_PAD_X, height: 11,
                    anchorH: 'left', anchorV: 'top',
                    showStroke: false,
                    showFill: true, fillColor: '#000',
                    cornerRadius: 3
                }).render(canvas);
            }
            HaxrCorp4090FlipCTL.draw(ctx, part, tx, ly, inPill ? '#fff' : '#000');
            left -= part.length;
        }
    }

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

    // White wash under the details pop-up and the Help warning.
    var POPUP_WASH  = 'rgba(255, 255, 255, 0.5)';

    // Fake scan results. `level` = active arcs 0..3 (dot always on),
    // `security` = pills left→right (anything but OPEN also gets the
    // lock after the SSID), `warn` = warning icon after the pills.
    // Plus what the cards / More pop-up show (all passively observable, no association needed):
    //   width   — channel width (beacon HT/VHT/HE operation IEs);
    //             WEP and the 2.4 GHz crowd stay at 20 MHz;
    //   rssi    — dBm, matching `level` (v2's arc thresholds);
    //   proto   — newest 802.11 generation the AP advertises;
    //   bssid   — AP MAC; `vendor` is its OUI owner (first 3 bytes);
    //   clients — stations seen exchanging data frames with the BSSID.
    var NETWORKS = [
        { ssid: 'My_Home',      band: '2.4GHz', channel: 8,   width: '20MHz', security: ['WEP'],         level: 3, warn: true,
          rssi: -45, proto: '802.11g',  bssid: '50:c7:bf:1f:b8:02', vendor: 'TP-Link',      clients: 3 },
        { ssid: 'Cafe-WiFi',    band: '2.4GHz', channel: 4,   width: '20MHz', security: ['OPEN'],        level: 2,
          rssi: -58, proto: '802.11n',  bssid: '24:a4:3c:90:27:21', vendor: 'Ubiquiti',     clients: 7 },
        { ssid: 'Office_Guest', band: '5GHz',   channel: 44,  width: '80MHz', security: ['WPA3'],        level: 2,
          rssi: -63, proto: '802.11ax', bssid: 'e0:55:3d:6b:c1:40', vendor: 'Cisco Meraki', clients: 5 },
        { ssid: 'TP-Link_5F2A', band: '2.4GHz', channel: 1,   width: '40MHz', security: ['WPA2'],        level: 2,
          rssi: -67, proto: '802.11n',  bssid: 'c0:25:e9:4b:12:7a', vendor: 'TP-Link',      clients: 2 },
        { ssid: 'YourMomGuest', band: '5GHz',   channel: 120, width: '80MHz', security: ['WPA3', 'SAE'], level: 1,
          rssi: -74, proto: '802.11ac', bssid: 'a0:40:a0:8e:33:d5', vendor: 'Netgear',      clients: 1 },
        { ssid: 'DIRECT-7A-HP', band: '5GHz',   channel: 36,  width: '20MHz', security: ['WPA2'],        level: 1,
          rssi: -78, proto: '802.11n',  bssid: '9c:b6:54:7a:02:e1', vendor: 'HP',           clients: 0 },
        { ssid: 'xfinitywifi',  band: '2.4GHz', channel: 6,   width: '20MHz', security: ['OPEN'],        level: 1,
          rssi: -81, proto: '802.11n',  bssid: '58:90:43:a1:0e:c4', vendor: 'Sagemcom',     clients: 4 },
        { ssid: 'home_iot_2G',  band: '2.4GHz', channel: 11,  width: '20MHz', security: ['WPA2'],        level: 0,
          rssi: -88, proto: '802.11n',  bssid: '24:0a:c4:e5:0a:9c', vendor: 'Espressif',    clients: 6 }
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

        // Info line: band + channel (+ channel width when the list
        // has one, e.g. '40MHz'), dimmed.
        var x = CARD_X + CARD_TEXT_DX;
        var iy = y + CARD_INFO_DY;
        HaxrCorp4090FlipCTL.draw(ctx, net.band, x, iy, CARD_DIM);
        x += HaxrCorp4090FlipCTL.textWidth(net.band) + CARD_INFO_GAP_CHANNEL;
        var chText = 'Channel ' + net.channel;
        HaxrCorp4090FlipCTL.draw(ctx, chText, x, iy, CARD_DIM);
        if (net.width) {
            x += HaxrCorp4090FlipCTL.textWidth(chText) + CARD_INFO_GAP_CHANNEL;
            HaxrCorp4090FlipCTL.draw(ctx, net.width, x, iy, CARD_DIM);
        }
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
        this._talk       = { open: false, nextAt: 0 };   // dolphin mouth state
        this._typeStart  = 0;      // when the Help screen opened (typing clock)
        // Start loading the mocks now so the first show is instant.
        preloadWarning();
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

    // Help sits next to the open pop-up only for weak-security (warn)
    // networks.
    ScanPageDemo.prototype._helpShown = function() {
        return !!this._popup && !!this._popup.warn;
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
                } else if (action === 'ok') {
                    // Toggle blinking of the call to action ("Switch to
                    // WPA3."); turning it on also finishes the typing.
                    if (this._blinkAt) {
                        this._blinkAt = 0;
                    } else {
                        this._typeStart = Math.min(this._typeStart,
                            Date.now() - TYPE_START_MS - HELP_CHARS * TYPE_CHAR_MS);
                        this._blinkAt = Date.now();
                    }
                    if (window.requestRender) window.requestRender();
                }
                return;
            }
            if (action === 'del') {
                this._pressButton(this._moreBtn, function() { closeSelf._closePopup(); });
            } else if (action === 'edit' && this._helpShown()) {
                // Help: flash, then show the full-screen warning mock.
                this._pressButton(this._helpBtn, function() {
                    closeSelf._warning   = true;
                    closeSelf._typeStart = Date.now();
                    closeSelf._blinkAt   = 0;
                });
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
            // More: press flash, then open the details pop-up for the
            // selected network. The button's toggle bar stays on for
            // as long as the pop-up is open.
            var self = this;
            var net  = this._networks[this._selected];
            this._pressButton(this._moreBtn, function() {
                if (net) {
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
            drawTextPopup(canvas, this._popup);
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
            var help = this._helpShown();
            if (help && !this._warning) this._helpBtn.render(canvas);
            if (help && !this._warning && !this._helpBtn.pressed) {
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
            if (this._warning) drawWarning(canvas, this._talk, this._typeStart, this._blinkAt);
            if (window.requestRender) window.requestRender();
        }
    };

    // ── Text details pop-up (v2 style) ───────────────────────────
    // Wifi scanner v2's pop-up, drawn from the network's fields: 50 %
    // white wash, a solid black name tab ([lock] + SSID in white
    // Sporty) hanging off the top-left corner of a white frame, then
    // in Haxrcorp (labels dimmed, values black) the router icon +
    // "Signal level: <rssi> dBm" / "<band>  Channel <n>  <width>",
    // and a label / value column. Rows are tighter than v2's (12 px
    // pitch) to fit Vendor and Clients above the bottom buttons, and
    // sit on zebra stripes (gray / white, one stripe per row) so each
    // line reads as its own field.
    var TP_W        = 156;
    var TP_H        = 103;                       // bottom edge at 125, above the buttons
    var TP_X        = Math.floor((256 - TP_W) / 2);   // 50
    var TP_Y        = 23;
    var TP_RADIUS   = 4;
    var TP_TAB_H    = 24;
    var TP_TAB_OVERLAP = 6;                      // tab rows hidden behind the frame
    var TP_TAB_Y    = TP_Y - (TP_TAB_H - TP_TAB_OVERLAP);   // 5
    var TP_TAB_PAD_X   = 6;
    var TP_TAB_TEXT_DY = 1;
    var TP_TAB_LOCK_DY = 4;
    var TP_TAB_LOCK_GAP = 3;
    var TP_DIM      = '#696969';
    // Header (icon + signal level + band line) sits high in the frame
    // so the band line has ~10 px of air above the table.
    // big_router_icon (20×19): 2 px right of the old 22-px icon column's centre
    // and vertically on the two header lines (ink rows 10..29).
    var TP_ICON_DX  = 11, TP_ICON_DY  = 10;
    var TP_TEXT_DX  = 39;
    var TP_SIGNAL_DY = 8,  TP_BAND_DY = 21;
    var TP_LABEL_DX = 8,  TP_VALUE_DX = 52;
    var TP_ROW_DY0  = 40, TP_ROW_PITCH = 12;     // Security … Clients
    // Zebra stripes: one TP_ROW_PITCH band per row starting at the
    // row's draw y (Haxrcorp ink y+2..y+8, descenders below), inset
    // TP_STRIPE_INSET px from the frame edge; even rows are gray.
    var TP_STRIPE_COLOR = '#F5F5F5';             // barely there
    var TP_STRIPE_INSET = 2;
    var TP_WARN_GAP = 3;
    var TP_WARN_DY  = 0;

    // Signal bars before the dBm value: SIG_BAR_H.length rising bars
    // standing on the Haxrcorp baseline (ink y+2..y+8). level + 1 are
    // black (level 0..3 like the Wi-Fi icon, whose dot is always on),
    // the rest ghosted like the icon's inactive arcs.
    var SIG_BAR_H    = [2, 3, 5, 7];
    var SIG_BAR_W    = 2;
    var SIG_BAR_PITCH = 3;                       // 2 px bar + 1 px gap
    var SIG_BARS_W   = SIG_BAR_H.length * SIG_BAR_PITCH - 1;   // 11
    var SIG_BARS_GAP = 3;                        // label → bars → value
    function drawSignalBars(ctx, x, y, level) {
        var base = y + 9;                        // row under the ink
        for (var i = 0; i < SIG_BAR_H.length; i++) {
            ctx.globalAlpha = (i <= level) ? 1 : SIGNAL_GHOST_ALPHA;
            ctx.fillStyle = '#000';
            ctx.fillRect(x + i * SIG_BAR_PITCH, base - SIG_BAR_H[i], SIG_BAR_W, SIG_BAR_H[i]);
        }
        ctx.globalAlpha = 1;
    }

    function drawTextPopup(canvas, net) {
        var ctx = canvas.ctx;
        ctx.fillStyle = POPUP_WASH;
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        var secured = net.security[0] !== 'OPEN';
        var nameW = Born2bSportyV2FlipCTL.textWidth(net.ssid);
        var lockW = secured ? Icons.lock_icon_8px.w + TP_TAB_LOCK_GAP : 0;
        new ResponsiveFrame({
            x: TP_X, y: TP_TAB_Y, width: lockW + nameW + 2 * TP_TAB_PAD_X, height: TP_TAB_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: true, strokeColor: '#000',
            showFill: true, fillColor: '#000',
            cornerRadius: TP_RADIUS
        }).render(canvas);
        var tx = TP_X + TP_TAB_PAD_X;
        if (secured) {
            canvas.drawSprite(Icons.lock_icon_8px, tx, TP_TAB_Y + TP_TAB_LOCK_DY, '#fff');
            tx += lockW;
        }
        Born2bSportyV2FlipCTL.draw(ctx, net.ssid, tx, TP_TAB_Y + TP_TAB_TEXT_DY, '#fff');

        // Main frame last so it covers the tab's bottom rows.
        new ResponsiveFrame({
            x: TP_X, y: TP_Y, width: TP_W, height: TP_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: true, strokeColor: '#000',
            showFill: true, fillColor: '#fff',
            cornerRadius: TP_RADIUS
        }).render(canvas);

        canvas.drawSprite(Icons.big_router_icon,
            TP_X + TP_ICON_DX, TP_Y + TP_ICON_DY, '#000');
        var cx = TP_X + TP_TEXT_DX;
        var sy = TP_Y + TP_SIGNAL_DY;
        var lbl = 'Signal level:';
        HaxrCorp4090FlipCTL.draw(ctx, lbl, cx, sy, TP_DIM);
        var bx = cx + HaxrCorp4090FlipCTL.textWidth(lbl) + SIG_BARS_GAP;
        drawSignalBars(ctx, bx, sy, net.level);
        HaxrCorp4090FlipCTL.draw(ctx, net.rssi + ' dBm',
            bx + SIG_BARS_W + SIG_BARS_GAP, sy, '#000');
        var bandLine = net.band + '  Channel ' + net.channel + (net.width ? '  ' + net.width : '');
        HaxrCorp4090FlipCTL.draw(ctx, bandLine, cx, TP_Y + TP_BAND_DY, TP_DIM);

        var rows = [
            ['Security:', net.security.join(' ')],
            ['Protocol:', net.proto],
            ['BSSID:',    net.bssid],
            ['Vendor:',   net.vendor],
            ['Clients:',  String(net.clients)]
        ];
        for (var i = 0; i < rows.length; i++) {
            var ry = TP_Y + TP_ROW_DY0 + i * TP_ROW_PITCH;
            if (i % 2 === 0) {
                ctx.fillStyle = TP_STRIPE_COLOR;
                ctx.fillRect(TP_X + TP_STRIPE_INSET, ry,
                    TP_W - 2 * TP_STRIPE_INSET, TP_ROW_PITCH);
            }
            HaxrCorp4090FlipCTL.draw(ctx, rows[i][0], TP_X + TP_LABEL_DX, ry, TP_DIM);
            HaxrCorp4090FlipCTL.draw(ctx, rows[i][1], TP_X + TP_VALUE_DX, ry, '#000');
            if (i === 0 && net.warn) {
                canvas.drawSprite(Icons.warning_icon,
                    TP_X + TP_VALUE_DX + HaxrCorp4090FlipCTL.textWidth(rows[i][1]) + TP_WARN_GAP,
                    ry + TP_WARN_DY, '#000');
            }
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
    function WifiScannerV4DemoScene(sceneManager) {
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

    return WifiScannerV4DemoScene;
})();
