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
    var CONNECTED_H     = 40;   // taller card when connected — room for RX/TX row
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
    var BOTTOM_INFO_PAD_B   = 7;
    var BOTTOM_INFO_PAD_L   = 5;   // left inset for the RX arrow
    var BOTTOM_INFO_GAP     = 2;   // gap between arrow and value
    var BOTTOM_INFO_COL_GAP = 5;   // gap between RX value and the up arrow

    function EthernetTab(options) {
        options = options || {};
        this.x        = options.x      !== undefined ? options.x      : DEFAULT_X;
        this.y        = options.y      !== undefined ? options.y      : DEFAULT_Y;
        this.w        = options.width  !== undefined ? options.width  : DEFAULT_W;
        this.h        = options.height !== undefined ? options.height : DEFAULT_H;
        this.portNumber = options.portNumber || 0;
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
                fillColor: '#ffffff'
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
        var nameStr = 'ETH' + this.portNumber;
        Born2bSportyV2Medium.draw(canvas.ctx, nameStr, nameX, nameY, fg);
        var nameW = Born2bSportyV2Medium.textWidth(nameStr);

        // Right-aligned status: [portRole]  [status].
        var infoY     = this.y + INFO_DRAW_Y;
        var statusStr = this.connected
            ? (this.speed || 'Connected')
            : 'Disconnected';
        var statusW   = HaxrcorpFont16.textWidth(statusStr);
        var statusX   = this.x + this.w - STATUS_PAD_R - statusW;

        var roleW = 0, roleX = 0;
        if (this.portRole) {
            roleW = HaxrcorpFont16.textWidth(this.portRole);
            roleX = statusX - STATUS_ROLE_GAP - roleW;
        }

        // Gray backdrop pill anchored to the TR corner of the frame —
        // painted on the fill layer so the frame's stroke and the
        // selector's chevron stay crisp on top. 17 rows tall starting
        // 1 row inside the top stroke; right edge stops short of:
        //   • selected:   the 6px chevron
        //   • unselected: the 1px right stroke, with the top two rows
        //     stair-cut to clear the rounded TR corner stroke pixels.
        // Bottom-left corner is rounded with radius 4.
        var pillLeftAnchor = this.portRole ? roleX : statusX;
        var pillLeft       = pillLeftAnchor - 5;   // 5px left padding
        var pillTop        = this.y + 1;
        var pillH          = 17;
        var pillBLr        = 4;
        for (var py = 0; py < pillH; py++) {
            var relY = py + 1;  // row offset inside frame
            // Right edge.
            var rowEndExcl;
            if (this.selected) {
                rowEndExcl = this.x + this.w - 6;
            } else {
                var ri = 0;
                if (relY < CORNER_RADIUS) ri = CORNER_RADIUS - 1 - relY;
                rowEndExcl = this.x + this.w - 1 - ri;
            }
            // Left edge — stair-cut on the bottom-left for a radius-4
            // rounded corner. `li` grows 0..3 over the last 4 rows.
            var li = 0;
            if (py >= pillH - pillBLr) li = py - (pillH - pillBLr);
            var rowStart = pillLeft + li;
            var rowW = rowEndExcl - rowStart;
            if (rowW > 0) canvas.drawRect(rowStart, pillTop + py, rowW, 1, '#CCCCCC');
        }

        HaxrcorpFont16.draw(canvas.ctx, statusStr, statusX, infoY, fg);
        if (this.portRole) {
            HaxrcorpFont16.draw(canvas.ctx, this.portRole, roleX, infoY, fg);
        }

        // Bottom RX/TX info row — only when the tab is connected and
        // the host enlarged the frame (totalH > top-row height). Text
        // sits so its bottom edge is BOTTOM_INFO_PAD_B px from the
        // frame's bottom stroke.
        if (this.connected && totalH > this.h) {
            // HaxrcorpFont16 visible glyph bottom = drawY + 8 (glyph rows
            // 2..8 inside an 11-row frame). Place visible bottom at
            // (this.y + totalH - 1) - BOTTOM_INFO_PAD_B.
            var bottomY = this.y + totalH - 1 - BOTTOM_INFO_PAD_B;
            var rowY    = bottomY - 8;   // HaxrcorpFont16 draw-y for that visible bottom
            var arrowH  = Icons.arrow_down ? Icons.arrow_down.h : 7;
            var arrowY  = bottomY - (arrowH - 1);
            var cursorX = this.x + BOTTOM_INFO_PAD_L;

            if (this.rxLabel && Icons.arrow_down) {
                canvas.drawSprite(Icons.arrow_down, cursorX, arrowY, fg);
                cursorX += Icons.arrow_down.w + BOTTOM_INFO_GAP;
                HaxrcorpFont16.draw(canvas.ctx, this.rxLabel, cursorX, rowY, fg);
                cursorX += HaxrcorpFont16.textWidth(this.rxLabel) + BOTTOM_INFO_COL_GAP;
            }
            if (this.txLabel && Icons.arrow_up) {
                canvas.drawSprite(Icons.arrow_up, cursorX, arrowY, fg);
                cursorX += Icons.arrow_up.w + BOTTOM_INFO_GAP;
                HaxrcorpFont16.draw(canvas.ctx, this.txLabel, cursorX, rowY, fg);
            }

            // Right cluster: [ipv4]  [dhcp]. Both right-aligned to
            // the same STATUS_PAD_R margin; IPv4 sits 5px left of the
            // DHCP label when both are present.
            var rightCursor = this.x + this.w - STATUS_PAD_R;
            if (this.dhcpLabel) {
                var dhcpW = HaxrcorpFont16.textWidth(this.dhcpLabel);
                rightCursor -= dhcpW;
                HaxrcorpFont16.draw(canvas.ctx, this.dhcpLabel, rightCursor, rowY, fg);
                rightCursor -= 5;
            }
            if (this.ipv4) {
                var ipW = HaxrcorpFont16.textWidth(this.ipv4);
                rightCursor -= ipW;
                HaxrcorpFont16.draw(canvas.ctx, this.ipv4, rightCursor, rowY, fg);
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
