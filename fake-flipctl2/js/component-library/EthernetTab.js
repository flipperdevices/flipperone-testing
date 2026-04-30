/**
 * EthernetTab — a 248×22 card for a single Ethernet interface.
 *
 * Layout (relative to the tab's top-left):
 *   - Icon (`Icons.ethernet`, 14×14) at (8, 3).
 *   - Port number "0" / "1" in Born2bSportyV2Medium, 4px after the icon.
 *   - When connected: "IPv4: <ip>" in HaxrcorpFont16 after the port
 *     number; right-aligned status "Connected" in HaxrcorpFont16, 8px
 *     from the right.
 *   - When disconnected: only the icon, port number, and a right-aligned
 *     "Disconnected" status. The whole tab renders greyed out (#888).
 *
 * States:
 *   - `selected === false` → ResponsiveFrame (rounded rect, no shadow).
 *   - `selected === true`  → MenuSelectorFrame (same dimensions, the
 *     familiar selector look with the BR shadow + corner pixels).
 *
 * Defaults match the spec: position (4, 28), size 248×22, radius 3.
 * The page can override x/y/width/height via constructor options.
 */
var EthernetTab = (function() {
    var DEFAULT_X       = 4;
    var DEFAULT_Y       = 28;
    var DEFAULT_W       = 248;
    var DEFAULT_H       = 22;
    var CONNECTED_H     = 34;   // taller card when connected — room for RX/TX row
    var CORNER_RADIUS   = 3;
    var ICON_PAD_L      = 6;
    var ICON_PAD_T      = 4;
    var TEXT_GAP        = 4;
    var STATUS_PAD_R    = 10;
    // Vertical draw offsets inside the tab. Name (Born2bSporty) sits
    // 3px higher than the HaxrcorpFont16 IP / status text.
    var NAME_DRAW_Y     = 3;   // Born2bSporty "ETHn"
    var INFO_DRAW_Y     = 4;   // HaxrcorpFont16 role + speed/disconnected
    var DIM_COLOR       = '#888888';

    // Expansion: the top row keeps its collapsed layout; additional
    // details render below it. Extras are padded from the row bottom
    // and stacked at EXTRA_LINE_H spacing.
    var EXTRA_PAD_T     = 2;   // gap between top row and first extra
    var EXTRA_LINE_H    = 10;
    var EXTRA_PAD_B     = 4;   // gap below the last extra
    var EXTRA_PAD_L     = 10;  // left inset for extra info lines

    // Bottom RX/TX info row (connected state only). Positioned so its
    // bottom edge sits BOTTOM_INFO_PAD_B px above the frame bottom.
    // Bumped 4 → 5 — lifts IPv6 + DHCP one more pixel off the frame's
    // bottom border so the row breathes against the rounded corners.
    var BOTTOM_INFO_PAD_B   = 5;
    var BOTTOM_INFO_PAD_L   = 5;   // left inset for the RX arrow
    var BOTTOM_INFO_GAP     = 2;   // gap between arrow and value
    var BOTTOM_INFO_COL_GAP = 5;   // gap between RX value and the up arrow

    // Threshold renderer for the 6-bit grayscale arrow icons. The
    // default canvas renderer uses (63 − gray) / 63 as opacity, which
    // turns the icons' anti-aliased pixels into near-transparent white
    // on the gray pill. `drawSolidSprite` paints every non-transparent
    // pixel (gray < 63) as a fully opaque `color` — no blending — so
    // the arrows read crisply regardless of background.
    function drawSolidSprite(canvas, sprite, x, y, color) {
        if (!sprite || !sprite.d) return;
        var ctx = canvas.ctx;
        ctx.fillStyle = color;
        var bytesPerRow = Math.ceil(sprite.w / 4) * 3;
        for (var row = 0; row < sprite.h; row++) {
            var base = row * bytesPerRow;
            for (var col = 0; col < sprite.w; col += 4) {
                var bi = base + (col / 4) * 3;
                var b0 = sprite.d[bi]     || 0;
                var b1 = sprite.d[bi + 1] || 0;
                var b2 = sprite.d[bi + 2] || 0;
                var p0 = (b0 >> 2) & 0x3F;
                var p1 = (((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0F)) & 0x3F;
                var p2 = (((b1 & 0x0F) << 2) | ((b2 >> 6) & 0x03)) & 0x3F;
                var p3 = b2 & 0x3F;
                var pixels = [p0, p1, p2, p3];
                for (var k = 0; k < 4 && col + k < sprite.w; k++) {
                    if (pixels[k] < 63) {
                        ctx.fillRect(x + col + k, y + row, 1, 1);
                    }
                }
            }
        }
    }

    function EthernetTab(options) {
        options = options || {};
        this.x        = options.x      !== undefined ? options.x      : DEFAULT_X;
        this.y        = options.y      !== undefined ? options.y      : DEFAULT_Y;
        this.w        = options.width  !== undefined ? options.width  : DEFAULT_W;
        this.h        = options.height !== undefined ? options.height : DEFAULT_H;
        this.portNumber = options.portNumber || 0;
        // Optional override for the port label. When unset, the tab
        // renders the default `ETH<portNumber>`. Used to surface
        // non-numbered links (e.g. USB-gadget Ethernet → "USB")
        // without polluting `portNumber`, which is also used for
        // role lookups elsewhere.
        this.displayName = options.displayName || null;
        this.connected  = !!options.connected;
        this.ipv4       = options.ipv4 || '';
        this.selected   = !!options.selected;
        this.expanded   = !!options.expanded;
        this.ipv6       = options.ipv6 || '';
        this.gateway    = options.gateway || '';
        this.dns        = Array.isArray(options.dns) ? options.dns : [];
        // Right-hand status area: a role label ("WAN"/"LAN") followed by
        // a 7px gap and a status string. When connected and a link
        // speed is supplied, the status string becomes the speed (e.g.
        // "1000Mb/s"); otherwise it falls back to "Disconnected".
        this.portRole   = options.portRole || '';
        this.speed      = options.speed    || '';
        // Optional bottom RX/TX row — already-formatted strings
        // ("10.6 MB" etc.). Empty strings hide that side of the row.
        this.rxLabel    = options.rxLabel  || '';
        this.txLabel    = options.txLabel  || '';
        // DHCP / addressing mode label shown right-aligned in the
        // bottom row (e.g. "DHCP", "Static", "DHCP Server").
        this.dhcpLabel  = options.dhcpLabel || '';
    }

    var STATUS_ROLE_GAP = 7;  // px between portRole label and the status word

    EthernetTab.prototype._extraLines = function() {
        // Always surface the three detail rows when expanded — missing
        // values render as "—" so the frame always grows and the user
        // sees the transition even if the interface didn't report every
        // field.
        return [
            'IPv6: '    + (this.ipv6    || '—'),
            'Gateway: ' + (this.gateway || '—'),
            'DNS: '     + (this.dns && this.dns.length ? this.dns.join(', ') : '—')
        ];
    };

    EthernetTab.prototype.getHeight = function() {
        if (this.expanded) {
            var lines = this._extraLines();
            return this.h + EXTRA_PAD_T + lines.length * EXTRA_LINE_H + EXTRA_PAD_B;
        }
        // Connected tabs are taller to fit the RX/TX info row. If the
        // host already passed a custom height, respect it.
        if (this.connected && (this.h === DEFAULT_H)) return CONNECTED_H;
        return this.h;
    };

    EthernetTab.prototype.render = function(canvas) {
        var fg = this.connected ? '#000000' : DIM_COLOR;
        var totalH = this.getHeight();

        // Background frame — grows downward when expanded. Top row
        // content below uses `this.y` anchors so it stays anchored to
        // the top edge of the frame.
        if (this.selected) {
            var sel = new ComponentSelectorFrame({
                x: this.x, y: this.y,
                width: this.w, height: totalH,
                anchorH: 'left', anchorV: 'top',
                cornerRadius: CORNER_RADIUS,
                strokeColor: '#000000',
                showStroke: true,
                showFill: true,
                fillColor: '#ffffff',
                // Disconnected tabs aren't actionable — pressing OK
                // is a no-op (gated in the scene). Drop the drill-in
                // chevron so the tab visually conveys that.
                showChevron: this.connected
            });
            sel.render(canvas);
        } else {
            // Unselected frame stroke is a neutral grey regardless of
            // connection state (#999). Content colours still follow
            // `fg` so disconnected tabs read as greyed out overall.
            var frame = new ResponsiveFrame({
                x: this.x, y: this.y,
                width: this.w, height: totalH,
                anchorH: 'left', anchorV: 'top',
                cornerRadius: CORNER_RADIUS,
                strokeColor: '#999999',
                showStroke: true,
                showFill: true,
                fillColor: '#ffffff'
            });
            frame.render(canvas);
        }

        // Icon.
        var iconX = this.x + ICON_PAD_L;
        var iconY = this.y + ICON_PAD_T;
        canvas.drawSprite(Icons.ethernet, iconX, iconY, fg);

        // Port name ("ETH0"/"ETH1") in Born2bSporty, right after the icon.
        var nameX = iconX + Icons.ethernet.w + TEXT_GAP;
        var nameY = this.y + NAME_DRAW_Y;
        var nameStr = this.displayName || ('ETH' + this.portNumber);
        Born2bSportyV2Medium.draw(canvas.ctx, nameStr, nameX, nameY, fg);
        var nameW = Born2bSportyV2Medium.textWidth(nameStr);

        // Top-row layout:
        //   [icon] [ETHn]    [IPv4]            [speed  ↓ RX  ↑ TX]
        // Disconnected:
        //   [icon] [ETHn]                      [Disconnected]
        var infoY = this.y + INFO_DRAW_Y;
        var arrowY = infoY + 2;   // bottom of arrow = infoY + 8 (cap baseline)

        // IPv4 sits 4px right + 2px below the usual info row so it
        // doesn't crowd the name.
        if (this.connected && this.ipv4) {
            var ipX = nameX + nameW + TEXT_GAP + 4;
            var ipY = infoY + 2;
            HaxrcorpFont16.draw(canvas.ctx, this.ipv4, ipX, ipY, fg);
        }

        // Measure the top-right cluster first (right-to-left) so the
        // gray pill can size itself before we actually draw. Order
        // when connected:  [↓ RX]  [↑ TX]  [speed]  (speed rightmost).
        var rightEdge = this.x + this.w - STATUS_PAD_R;
        var measureR  = rightEdge;
        var arrowWhite = '#000000';
        var arrowDownW = Icons.arrow_down ? Icons.arrow_down.w : 0;
        var arrowUpW   = Icons.arrow_up   ? Icons.arrow_up.w   : 0;
        if (this.connected) {
            if (this.speed) {
                measureR -= HaxrcorpFont16.textWidth(this.speed);
                measureR -= BOTTOM_INFO_COL_GAP;
            }
            if (this.txLabel && Icons.arrow_up) {
                measureR -= HaxrcorpFont16.textWidth(this.txLabel);
                measureR -= BOTTOM_INFO_GAP + arrowUpW;
                measureR -= BOTTOM_INFO_COL_GAP;
            }
            if (this.rxLabel && Icons.arrow_down) {
                measureR -= HaxrcorpFont16.textWidth(this.rxLabel);
                measureR -= BOTTOM_INFO_GAP + arrowDownW;
            }
        } else {
            measureR -= HaxrcorpFont16.textWidth('Disconnected');
        }
        var topRightLeftEdge = measureR;

        // Gray backdrop pill behind the top-right cluster. Anchored to
        // the TR corner, painted on the fill layer so the frame stroke
        // + selector chevron stay crisp on top. Bottom-left rounded
        // with radius 4; top-right stair-cut for rounded TR corner (or
        // clipped at the chevron when selected).
        var pillLeft = topRightLeftEdge - 5;   // 5px left padding
        var pillTop  = this.y + 1;
        var pillH    = 17;
        var pillBLr  = 4;
        // Pill clip: when the tab is selected AND connected, the right
        // side is occluded by the 6-px selector chevron — the pill
        // stops 6 px short of the frame's right edge to make room.
        // Disconnected tabs suppress the chevron (the tab isn't
        // actionable), so the pill follows the rounded corner like
        // the unselected case.
        var hasChevron = this.selected && this.connected;
        for (var py = 0; py < pillH; py++) {
            var relY = py + 1;
            var rowEndExcl;
            if (hasChevron) {
                rowEndExcl = this.x + this.w - 6;
            } else {
                var ri = 0;
                if (relY < CORNER_RADIUS) ri = CORNER_RADIUS - 1 - relY;
                rowEndExcl = this.x + this.w - 1 - ri;
            }
            var li = 0;
            if (py >= pillH - pillBLr) li = py - (pillH - pillBLr);
            var rowStart = pillLeft + li;
            var rowW = rowEndExcl - rowStart;
            if (rowW > 0) canvas.drawRect(rowStart, pillTop + py, rowW, 1, '#CCCCCC');
        }

        // Draw the top-right cluster on top of the pill — same
        // right-to-left order as the measure pass above. Arrow icons
        // render via `drawSolidSprite` so every non-transparent pixel
        // is pure white, keeping them readable on the gray pill.
        var drawR = rightEdge;
        // Align each icon's bottom with the text's visible bottom
        // (infoY + 8 for HaxrcorpFont16). Icons are 7 tall → top row
        // at infoY + 2.
        var arrowTop = infoY + 2;
        if (this.connected) {
            if (this.speed) {
                var spdW = HaxrcorpFont16.textWidth(this.speed);
                drawR -= spdW;
                HaxrcorpFont16.draw(canvas.ctx, this.speed, drawR, infoY, fg);
                drawR -= BOTTOM_INFO_COL_GAP;
            }
            if (this.txLabel && Icons.arrow_up) {
                var txW = HaxrcorpFont16.textWidth(this.txLabel);
                drawR -= txW;
                HaxrcorpFont16.draw(canvas.ctx, this.txLabel, drawR, infoY, fg);
                drawR -= BOTTOM_INFO_GAP + arrowUpW;
                drawSolidSprite(canvas, Icons.arrow_up, drawR, arrowTop, arrowWhite);
                drawR -= BOTTOM_INFO_COL_GAP;
            }
            if (this.rxLabel && Icons.arrow_down) {
                var rxW = HaxrcorpFont16.textWidth(this.rxLabel);
                drawR -= rxW;
                HaxrcorpFont16.draw(canvas.ctx, this.rxLabel, drawR, infoY, fg);
                drawR -= BOTTOM_INFO_GAP + arrowDownW;
                drawSolidSprite(canvas, Icons.arrow_down, drawR, arrowTop, arrowWhite);
            }
        } else {
            var discStr = 'Disconnected';
            var discW   = HaxrcorpFont16.textWidth(discStr);
            HaxrcorpFont16.draw(canvas.ctx, discStr, rightEdge - discW, infoY, fg);
        }

        // Bottom row (connected only, on the tall 40px frame):
        //   [IPv6]                        [portRole]  [dhcp label]
        if (this.connected && totalH > this.h) {
            var bottomY = this.y + totalH - 1 - BOTTOM_INFO_PAD_B;
            var rowY    = bottomY - 8;

            // IPv6 on the left — 2px further right than the rest of
            // the BOTTOM_INFO_PAD_L inset.
            if (this.ipv6) {
                HaxrcorpFont16.draw(canvas.ctx, this.ipv6, this.x + BOTTOM_INFO_PAD_L + 2, rowY, fg);
            }

            // portRole + DHCP label, right-aligned.
            var brCursor = this.x + this.w - STATUS_PAD_R;
            if (this.dhcpLabel) {
                var dhcpW = HaxrcorpFont16.textWidth(this.dhcpLabel);
                brCursor -= dhcpW;
                HaxrcorpFont16.draw(canvas.ctx, this.dhcpLabel, brCursor, rowY, fg);
                brCursor -= STATUS_ROLE_GAP;
            }
            if (this.portRole) {
                var roleW2 = HaxrcorpFont16.textWidth(this.portRole);
                brCursor -= roleW2;
                HaxrcorpFont16.draw(canvas.ctx, this.portRole, brCursor, rowY, fg);
            }
        }

        // Extra details appear below the top row when expanded.
        if (this.expanded) {
            var extras = this._extraLines();
            var extraY = this.y + this.h + EXTRA_PAD_T;
            for (var i = 0; i < extras.length; i++) {
                HaxrcorpFont16.draw(canvas.ctx, extras[i], this.x + EXTRA_PAD_L, extraY + i * EXTRA_LINE_H, fg);
            }
        }
    };

    EthernetTab.prototype.setSelected  = function(v) { this.selected  = !!v; };
    EthernetTab.prototype.setConnected = function(v) { this.connected = !!v; };
    EthernetTab.prototype.setIpv4      = function(v) { this.ipv4 = v || ''; };
    EthernetTab.prototype.setPortNumber = function(v) { this.portNumber = v; };
    EthernetTab.prototype.setExpanded  = function(v) { this.expanded = !!v; };

    return EthernetTab;
})();
