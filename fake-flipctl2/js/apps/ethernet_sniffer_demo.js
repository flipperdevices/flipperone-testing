/**
 * EthernetSnifferDemoScene
 *
 * Testing → Kickstarter demo → Selected → 'Ethernet Sniffer' (and All →
 * Ethernet Sniffer). Two full-screen states from the designer's art in
 * assets/kickstarter_UI/network_sniffer/ (status bar, "Ethernet
 * Sniffer" title and the Flipper between the Network / Device / PC
 * cables are part of both):
 *   • not connected — the still Ethernet_sniffer_v002_still.png;
 *   • Ethernet connected — the clip with packets running along the
 *     cables (Ethernet_sniffer_v002.mp4, 256×144, 25 fps, 4 s), looped,
 *     from its first frame on every connect.
 * Left / right / up / down / OK flip between the two (no detection).
 *
 * A fake status bar covers the one in the art: battery BATTERY_PCT on
 * the right; on the left nothing while not connected, the Ethernet
 * icon once connected.
 *
 * The clip is a pre-rendered sprite sheet (every frame in a cols × rows
 * grid, one rect blitted per frame by wall-clock index, so the wrap has
 * no seam), re-fetched on every visit with a cache-busting query so a
 * swapped sheet shows up without reloading the page. Back returns.
 *
 * Rebuild the sheet after changing the clip, from
 * assets/kickstarter_UI/network_sniffer/:
 *   ffmpeg -i Ethernet_sniffer_v002.mp4 \
 *          -vf format=gray,tile=10x10 -frames:v 1 -update 1 Ethernet_sniffer_v002_sheet.png
 */
var EthernetSnifferDemoScene = (function() {
    var STILL_SRC = 'assets/kickstarter_UI/network_sniffer/Ethernet_sniffer_v002_still.png';
    var CLIP = {
        src: 'assets/kickstarter_UI/network_sniffer/Ethernet_sniffer_v002_sheet.png',
        frames: 100, cols: 10, fps: 25, w: 256, h: 144
    };

    var BATTERY_PCT = 84;

    // Same pixels as UI.drawStatusBar: black bar, the Ethernet icon at
    // the left slot when `ethernet`, BATTERY_PCT % + battery on the right.
    function drawStatusBar(canvas, ethernet) {
        var ctx = canvas.ctx, top = 3, H = HaxrCorp4090FlipCTL;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.w, UI.STATUS_BAR_H);
        if (ethernet) canvas.drawSprite(Icons.ethernet_statusbar, 2, top, '#fff');
        var pct = BATTERY_PCT + '%', bat = StatusBarBattery.sprite, bx = canvas.w - 2 - bat.w;
        H.draw(ctx, pct, bx - 1 - H.textWidth(pct), top - 2, '#fff');
        canvas.drawSprite(bat, bx, top - 1, '#fff');
        ctx.fillStyle = '#fff';
        ctx.fillRect(bx + 2, top + 1, Math.round(10 * BATTERY_PCT / 100), 5);
    }

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    function EthernetSnifferDemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Ethernet Sniffer';
        this.breadcrumbTitle = 'Ethernet Sniffer';
        this._sheet = null;
        this._still = null;
        this._connected = false;
        this._t0 = 0;
        this._frameTimer = null;
    }

    EthernetSnifferDemoScene.prototype.enter = function() {
        var self = this, v = '?v=' + Date.now();
        var sheet = new Image(), still = new Image();
        sheet.onload = function() { self._sheet = sheet; repaint(); };
        still.onload = function() { self._still = still; repaint(); };
        sheet.src = CLIP.src + v;
        still.src = STILL_SRC + v;
        this._connected = false;
        this._t0 = Date.now();
        if (!this._frameTimer) {
            this._frameTimer = setInterval(repaint, Math.floor(1000 / CLIP.fps));
        }
        repaint();
    };

    EthernetSnifferDemoScene.prototype.exit = function() {
        if (this._frameTimer) { clearInterval(this._frameTimer); this._frameTimer = null; }
    };

    EthernetSnifferDemoScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'left' || action === 'right' || action === 'up' ||
                action === 'down' || action === 'ok') {
            this._connected = !this._connected;
            this._t0 = Date.now();
            repaint();
        }
    };

    EthernetSnifferDemoScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        if (!this._connected) {
            if (this._still) canvas.ctx.drawImage(this._still, 0, 0);
        } else if (this._sheet && this._sheet.naturalWidth) {
            var fi = Math.floor((Date.now() - this._t0) * CLIP.fps / 1000) % CLIP.frames;
            canvas.ctx.drawImage(this._sheet,
                (fi % CLIP.cols) * CLIP.w, Math.floor(fi / CLIP.cols) * CLIP.h,
                CLIP.w, CLIP.h, 0, 0, canvas.w, canvas.h);
        }
        drawStatusBar(canvas, this._connected);
    };

    return EthernetSnifferDemoScene;
})();
