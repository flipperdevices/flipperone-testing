/**
 * BrowserScene
 *
 * Apps → Browser. Built up piece by piece; current stage: no chrome
 * (no status bar, no title strip) — the body shows a page mockup PNG
 * scaled to fit the 256×144 screen, plus a zoom gesture:
 *
 *   • Hold PTT (same button the Walkie Talkie uses, `Input.isHeld`)
 *     to enter zoom mode. While it is held, sliding a finger up the
 *     touchpad zooms in, down zooms out — continuous, ZOOM_MIN..ZOOM_MAX,
 *     one doubling per TP_UNITS_PER_DOUBLING raw touchpad units. The
 *     factor is anchored where the finger lands, so lifting and
 *     re-touching never jumps.
 *   • The current factor ("x2.0") sits in the top-right corner in the
 *     same black pill the Wi-Fi scanner uses for network names, shown
 *     only while zoom mode is active.
 *   • The view zooms around the pan point (page centre for now; a pan
 *     gesture comes later).
 *
 * Back pops.
 */
var BrowserScene = (function() {
    var PAGE_IMG_SRC = 'assets/browser_test/flipepr_wiki.png';

    var ZOOM_MIN = 1;                       // 1 = fit to screen
    var ZOOM_MAX = 8;
    var TP_UNITS_PER_DOUBLING = 300;        // finger travel for ×2 (full swipe ≈ 1000 units)
    var ZOOM_QUANTUM = 0.05;                // factor granularity (keeps the scale cache useful)
    // Haptics while zooming — same vocabulary as the App Switcher's
    // scroll: a short effect-3 tick every ZOOM_HAPTIC_STEP of factor,
    // a full effect-3 thump once when the gesture hits ×1 or ×8.
    var ZOOM_HAPTIC_STEP = 0.1;

    // Cursor: the page point (source px) the view centres on and zooms
    // around. Drawn where that point lands on screen, so it sits at
    // the centre until the view is clamped at a page edge — then it
    // slides toward that edge / corner while the view stays put.
    // Touchpad drag without PTT moves it (1 raw unit / TP_CURSOR_DIVIDER
    // = 1 screen px, converted to page px at the current scale).
    var TP_CURSOR_DIVIDER = 2;
    var CURSOR_ARM   = 4;                   // crosshair arm length (px) from the centre
    var CURSOR_GAP   = 1;                   // hole in the middle
    var CURSOR_COLOR = '#000';
    var CURSOR_HALO  = '#fff';

    // Minimap (zoomed in only): the whole page at MINI_W px wide, flush
    // with the screen's left and bottom edges (the 1-px black border
    // then shows only on its top and right sides — the other two are
    // the screen edge), with a 1-px rectangle marking the part of the
    // page the screen currently shows.
    var MINI_W      = 64;
    var MINI_MARGIN = 0;
    var MINI_BORDER = '#000';
    var MINI_VIEW   = '#000';

    // Zoom pill — same recipe as the Wi-Fi scanner's network pill.
    var PILL_H      = 13;
    var PILL_PAD_X  = 4;
    var PILL_MARGIN = 2;                    // from the screen's top/right edges
    var PILL_TEXT_DY = 1;
    var PILL_FILL   = '#000';
    var PILL_TEXT   = '#fff';

    // Lazy, shared across instances — repaint when the file arrives.
    var pageImg = null;
    function pageImage() {
        if (!pageImg) {
            pageImg = new Image();
            pageImg.onload = function() {
                if (window.requestRender) window.requestRender();
            };
            pageImg.src = PAGE_IMG_SRC;
        }
        return pageImg;
    }

    // Mip chain: the source halved repeatedly (high-quality smoothing)
    // down to screen size, built once. Shrinking ~7× with a single
    // drawImage() samples only a fraction of the source pixels and
    // looks speckled; drawing from the nearest mip ≥ the target size
    // averages every source pixel the way Figma / Photoshop do, and
    // keeps continuous zoom cheap (one drawImage per frame).
    var mips = null;          // [{ w, h, canvas|Image }], largest first
    function mipChain(img) {
        if (mips && mips[0].source === img) return mips;
        var chain = [{ w: img.naturalWidth, h: img.naturalHeight, canvas: img, source: img }];
        var w = img.naturalWidth, h = img.naturalHeight, src = img;
        while (w / 2 >= 256 && h / 2 >= 144) {
            w = Math.round(w / 2); h = Math.round(h / 2);
            src = resample(src, w, h);
            chain.push({ w: w, h: h, canvas: src, source: img });
        }
        mips = chain;
        return chain;
    }
    function resample(src, w, h) {
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, w, h);
        return c;
    }
    // The page at scale `s` (source px × s), from the smallest mip that
    // is still at least the target size; cached for the last scale.
    var scaledCache = null;   // { img, s, canvas }
    function scaledImage(img, s) {
        if (scaledCache && scaledCache.img === img && scaledCache.s === s) return scaledCache.canvas;
        var tw = Math.max(1, Math.round(img.naturalWidth  * s));
        var th = Math.max(1, Math.round(img.naturalHeight * s));
        var chain = mipChain(img);
        var pick = chain[0];
        for (var i = 0; i < chain.length; i++) {
            if (chain[i].w >= tw && chain[i].h >= th) pick = chain[i];
        }
        var out = resample(pick.canvas, tw, th);
        scaledCache = { img: img, s: s, canvas: out };
        return out;
    }
    // The page at MINI_W px wide (from the smallest mip), cached.
    var miniCache = null;     // { img, canvas }
    function miniImage(img) {
        if (miniCache && miniCache.img === img) return miniCache.canvas;
        var chain = mipChain(img);
        var small = chain[chain.length - 1];
        var mh = Math.max(1, Math.round(img.naturalHeight * MINI_W / img.naturalWidth));
        var out = resample(small.canvas, MINI_W, mh);
        miniCache = { img: img, canvas: out };
        return out;
    }

    function BrowserScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Browser';
        this.breadcrumbTitle = 'Browser';

        // View state: zoom factor (1 = fit) and the page point (source
        // pixels) shown at the screen centre; centred on load.
        this._zoom   = 1;
        this._panX   = -1;
        this._panY   = -1;

        // Zoom gesture: touchpad SSE + PTT held-state. The anchor is
        // (finger y, zoom) at the moment the gesture became active.
        this._tpES        = null;
        this._tpTouching  = false;
        this._tpY         = 0;
        this._zoomArmed   = false;
        this._anchorY     = 0;
        this._anchorZoom  = 1;
        this._edgeBuzzed  = false;   // boundary thump already played for this push
        // Cursor drag (touchpad without PTT): finger and cursor
        // positions at touch-down.
        this._panArmed    = false;
        this._tpAnchorX   = 0;
        this._tpAnchorY   = 0;
        this._panAnchorX  = 0;
        this._panAnchorY  = 0;

        pageImage();   // start loading so the first frame is instant
    }

    BrowserScene.prototype.enter = function() {
        var self = this;
        try {
            this._tpES = new EventSource('/api/touchpad/xy');
            this._tpES.onmessage = function(e) { self._handleTouchpad(e); };
            this._tpES.onerror   = function() { /* keys still work */ };
        } catch (err) {
            this._tpES = null;
        }
    };

    BrowserScene.prototype.exit = function() {
        if (this._tpES) { this._tpES.close(); this._tpES = null; }
        this._zoomArmed = false;
    };

    function pttHeld() {
        return !!(window.input && typeof window.input.isHeld === 'function'
                  && window.input.isHeld('ptt'));
    }

    // Fire-and-forget haptic (daemon behind /api/haptic/play). No
    // durationMs → the effect's full waveform.
    function playHaptic(effectId, durationMs) {
        try {
            var x = new XMLHttpRequest();
            x.open('POST', '/api/haptic/play', true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.timeout = 2000;
            x.send(JSON.stringify({ effectId: effectId, durationMs: durationMs }));
        } catch (e) { /* offline / mocked — ignore */ }
    }

    // "x,y,touch" from the touchpad. Zoom follows the finger's vertical
    // travel only while PTT is held AND a finger is down; the anchor is
    // (re)taken whenever either becomes true, so the factor never jumps
    // on touch-down or on PTT press mid-swipe.
    BrowserScene.prototype._handleTouchpad = function(e) {
        var p = String(e.data || '').split(',');
        if (p.length < 3) return;
        var nx = +p[0], ny = +p[1], nt = +p[2];
        if (nx !== nx || ny !== ny || (nt !== 0 && nt !== 1)) return;
        this._tpTouching = (nt === 1);
        this._tpY = ny;
        if (!this._tpTouching) {
            this._zoomArmed = false;
            this._panArmed  = false;
            return;
        }
        if (!pttHeld()) {
            // No PTT: the finger drags the cursor. Anchor on the first
            // sample of a drag (also right after PTT is released), then
            // cursor = anchor + finger delta in page px.
            this._zoomArmed = false;
            var img = pageImage();
            if (!(img.complete && img.naturalWidth) || this._panX < 0) return;
            if (!this._panArmed) {
                this._panArmed   = true;
                this._tpAnchorX  = nx;   this._tpAnchorY  = ny;
                this._panAnchorX = this._panX; this._panAnchorY = this._panY;
                return;
            }
            var sc = this._scale(img);
            var px = this._panAnchorX + ((nx - this._tpAnchorX) / TP_CURSOR_DIVIDER) / sc;
            var py = this._panAnchorY + ((ny - this._tpAnchorY) / TP_CURSOR_DIVIDER) / sc;
            this._panX = Math.max(0, Math.min(img.naturalWidth,  px));
            this._panY = Math.max(0, Math.min(img.naturalHeight, py));
            if (window.requestRender) window.requestRender();
            return;
        }
        this._panArmed = false;
        if (!this._zoomArmed) {
            this._zoomArmed  = true;
            this._anchorY    = ny;
            this._anchorZoom = this._zoom;
            this._edgeBuzzed = false;
            return;
        }
        // Up (smaller y) → zoom in.
        var raw = this._anchorZoom * Math.pow(2, (this._anchorY - ny) / TP_UNITS_PER_DOUBLING);
        var z = Math.round(raw / ZOOM_QUANTUM) * ZOOM_QUANTUM;
        var clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
        var prev = this._zoom;
        this._zoom = clamped;

        // Haptics: one tick per ZOOM_HAPTIC_STEP crossed; a single full
        // thump when the finger pushes past a limit (re-armed once it
        // comes back inside the range).
        var atEdge = (z < ZOOM_MIN || z > ZOOM_MAX);
        if (atEdge) {
            if (!this._edgeBuzzed) { playHaptic(3); this._edgeBuzzed = true; }
        } else {
            this._edgeBuzzed = false;
            if (Math.round(clamped / ZOOM_HAPTIC_STEP) !== Math.round(prev / ZOOM_HAPTIC_STEP)) {
                playHaptic(3, 10);
            }
        }
        if (clamped !== prev && window.requestRender) window.requestRender();
    };

    BrowserScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
        // PTT press arrives as a discrete action; the hold itself is
        // read via Input.isHeld in the gesture handler and render().
        if (action === 'ptt' && window.requestRender) window.requestRender();
    };

    // Screen px per page px at the current zoom (fit × zoom).
    BrowserScene.prototype._scale = function(img) {
        return Math.min(256 / img.naturalWidth, 144 / img.naturalHeight) * this._zoom;
    };

    // Crosshair with a 1-px white halo so it reads on any page pixel.
    BrowserScene.prototype._drawCursor = function(canvas, sx, sy) {
        var ctx = canvas.ctx;
        var a = CURSOR_ARM, g = CURSOR_GAP;
        // Keep the whole glyph (arms + halo) on screen: at a page
        // corner the point itself lands on the screen edge.
        sx = Math.max(a + 1, Math.min(canvas.w - 2 - a, Math.round(sx)));
        sy = Math.max(a + 1, Math.min(canvas.h - 2 - a, Math.round(sy)));
        // Halo: the same arms, one pixel fatter on each side.
        ctx.fillStyle = CURSOR_HALO;
        ctx.fillRect(sx - a - 1, sy - 1, a - g + 1, 3);   // left
        ctx.fillRect(sx + g,     sy - 1, a - g + 1, 3);   // right
        ctx.fillRect(sx - 1, sy - a - 1, 3, a - g + 1);   // up
        ctx.fillRect(sx - 1, sy + g,     3, a - g + 1);   // down
        ctx.fillStyle = CURSOR_COLOR;
        ctx.fillRect(sx - a, sy, a - g, 1);
        ctx.fillRect(sx + g + 1, sy, a - g, 1);
        ctx.fillRect(sx, sy - a, 1, a - g);
        ctx.fillRect(sx, sy + g + 1, 1, a - g);
    };

    // Minimap in the bottom-left corner: whole page in miniature with
    // a rectangle over the region the screen shows. `s` is the page
    // scale on screen, (dx, dy) where the scaled page's top-left sits.
    BrowserScene.prototype._drawMinimap = function(canvas, img, s, dx, dy) {
        var ctx  = canvas.ctx;
        var mini = miniImage(img);
        var ms   = mini.width / img.naturalWidth;          // minimap px per source px
        var mx   = MINI_MARGIN;
        var my   = canvas.h - MINI_MARGIN - mini.height;
        ctx.fillStyle = MINI_BORDER;
        ctx.fillRect(mx - 1, my - 1, mini.width + 2, mini.height + 2);
        ctx.drawImage(mini, mx, my);

        // Visible region in source px → minimap px, clamped to the map.
        var vx = Math.max(0, -dx) / s, vy = Math.max(0, -dy) / s;
        var vw = Math.min(canvas.w, canvas.w - Math.max(0, dx) * 2) / s;
        var vh = Math.min(canvas.h, canvas.h - Math.max(0, dy) * 2) / s;
        var rx = mx + Math.round(vx * ms), ry = my + Math.round(vy * ms);
        var rw = Math.max(3, Math.round(vw * ms)), rh = Math.max(3, Math.round(vh * ms));
        rw = Math.min(rw, mx + mini.width - rx);
        rh = Math.min(rh, my + mini.height - ry);
        ctx.fillStyle = MINI_VIEW;
        ctx.fillRect(rx, ry, rw, 1);
        ctx.fillRect(rx, ry + rh - 1, rw, 1);
        ctx.fillRect(rx, ry, 1, rh);
        ctx.fillRect(rx + rw - 1, ry, 1, rh);
    };

    BrowserScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        var ctx = canvas.ctx;
        var img = pageImage();
        if (!(img.complete && img.naturalWidth)) return;
        if (this._panX < 0) { this._panX = img.naturalWidth / 2; this._panY = img.naturalHeight / 2; }

        // Scale = fit-to-screen × zoom. At zoom 1 the whole page is
        // visible and centred; zoomed in, the viewport is the screen-
        // sized window around the pan point, clamped to the page.
        var fit = Math.min(canvas.w / img.naturalWidth, canvas.h / img.naturalHeight);
        var s   = fit * this._zoom;
        var page = scaledImage(img, s);
        var dw = page.width, dh = page.height;
        var dx, dy;
        if (dw <= canvas.w) dx = Math.floor((canvas.w - dw) / 2);
        else dx = Math.max(canvas.w - dw, Math.min(0, Math.round(canvas.w / 2 - this._panX * s)));
        if (dh <= canvas.h) dy = Math.floor((canvas.h - dh) / 2);
        else dy = Math.max(canvas.h - dh, Math.min(0, Math.round(canvas.h / 2 - this._panY * s)));
        ctx.drawImage(page, dx, dy);

        // Minimap only once something is actually cropped.
        if (this._zoom > 1) this._drawMinimap(canvas, img, s, dx, dy);

        // Cursor at its page point's screen position — centre while the
        // view can follow it, pressed to an edge / corner when clamped.
        this._drawCursor(canvas, dx + this._panX * s, dy + this._panY * s);

        // Zoom mode indicator — top-right pill with the factor. Keep
        // repainting while PTT is held so the pill leaves the moment
        // the button does (release produces no action).
        if (pttHeld()) {
            var label = 'x' + this._zoom.toFixed(1);
            var tw = Helvb08Regular.textWidth(label);
            var pw = tw + 2 * PILL_PAD_X;
            var px = canvas.w - PILL_MARGIN - pw;
            var py = PILL_MARGIN;
            new ResponsiveFrame({
                x: px, y: py, width: pw, height: PILL_H,
                anchorH: 'left', anchorV: 'top',
                showStroke: false,
                showFill: true, fillColor: PILL_FILL,
                cornerRadius: 3
            }).render(canvas);
            Helvb08Regular.draw(ctx, label, px + PILL_PAD_X, py + PILL_TEXT_DY, PILL_TEXT);
            if (window.requestRender) window.requestRender();
        } else {
            this._zoomArmed = false;
        }
    };

    return BrowserScene;
})();
