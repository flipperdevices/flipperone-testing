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
    var CORNER_RADIUS   = 3;
    var ICON_PAD_L      = 6;
    var ICON_PAD_T      = 4;
    var TEXT_GAP        = 4;
    var STATUS_PAD_R    = 8;
    // Vertical draw offsets inside the tab. Name (Born2bSporty) sits
    // 3px higher than the HaxrcorpFont16 IP / status text.
    var NAME_DRAW_Y     = 3;   // Born2bSporty "ETHn"
    var INFO_DRAW_Y     = 6;   // HaxrcorpFont16 IP + status
    var DIM_COLOR       = '#888888';

    // Expansion: the top row keeps its collapsed layout; additional
    // details render below it. Extras are padded from the row bottom
    // and stacked at EXTRA_LINE_H spacing.
    var EXTRA_PAD_T     = 2;   // gap between top row and first extra
    var EXTRA_LINE_H    = 10;
    var EXTRA_PAD_B     = 4;   // gap below the last extra
    var EXTRA_PAD_L     = 10;  // left inset for extra info lines

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
    }

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
        if (!this.expanded) return this.h;
        var lines = this._extraLines();
        return this.h + EXTRA_PAD_T + lines.length * EXTRA_LINE_H + EXTRA_PAD_B;
    };

    EthernetTab.prototype.render = function(canvas) {
        var fg = this.connected ? '#000000' : DIM_COLOR;
        var totalH = this.getHeight();

        // Background frame — grows downward when expanded. Top row
        // content below uses `this.y` anchors so it stays anchored to
        // the top edge of the frame.
        if (this.selected) {
            var sel = new MenuSelectorFrame({
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

        // Right-aligned status string.
        var infoY     = this.y + INFO_DRAW_Y;
        var statusStr = this.connected ? 'Connected' : 'Disconnected';
        var statusW   = HaxrcorpFont16.textWidth(statusStr);
        var statusX   = this.x + this.w - STATUS_PAD_R - statusW;
        HaxrcorpFont16.draw(canvas.ctx, statusStr, statusX, infoY, fg);

        // "IPv4: <ip>" label only when connected.
        if (this.connected && this.ipv4) {
            var labelX = nameX + nameW + TEXT_GAP;
            HaxrcorpFont16.draw(canvas.ctx, 'IPv4: ' + this.ipv4, labelX, infoY, fg);
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
