/**
 * DesktopComputerV2DemoScene
 *
 * Testing → Kickstarter demo → Desktop computer → 'Version 2'.
 * Standalone (no code shared with Version 1 / KickstarterConnectDemo):
 * a full-screen still of the Linux desktop (BG_SRC), and when a display
 * is plugged into USB-C a "Display Connected" notification drops in
 * from the top edge with a small bounce (a white → transparent fade
 * under it), holds NT_HOLD_MS and slides back up.
 *
 * Detection is the same as Version 1: GET /api/usbc every POLL_MS; ids
 *   'typec:<portN>'  a Type-C partner (the main, earliest signal);
 *   'drm:<conn>'     a display connector reports "connected";
 *   'udc:<name>'     the USB gadget port sees a host;
 *   'psu:<name>'     an external supply is online.
 * The first snapshot is the baseline (built-in hardware); a new id not
 * in it is "connected". Baseline ids that disappear are dropped, so a
 * device already plugged in when the app opened counts once replugged.
 *
 * OK shows the notification by hand (preview without hardware, or a
 * backup during a shoot). Back returns to the previous list.
 */
var DesktopComputerV2DemoScene = (function() {
    var BG_SRC  = 'assets/kickstarter_UI/desktop_computer/linux_desktop_v006.png';
    var POLL_MS = 150;
    var TYPEC_PORT = null;   // e.g. 'port0' once USB-C1 is identified on the device

    // Notification: white frame with a black 1 px outline and rounded
    // corners (plus a second line under the bottom edge), x 3..252,
    // reaching above the screen top so the top edge stays hidden while
    // it bounces. Rest position puts its bottom edge on row 25.
    var NT_X = 3, NT_W = 250, NT_H = 32;
    var NT_REST_Y   = -6;
    var NT_HIDDEN_Y = -NT_H - 2;
    var NT_RADIUS   = 4;
    var NT_TEXT     = 'Display Connected';
    // White → transparent fade under the notification, NT_FADE_H px from
    // its bottom edge down, moving with it; its strength follows how far
    // the notification is in (0 when hidden, 1 at rest).
    var NT_FADE_H   = 18;
    var NT_GAP      = 6;                     // icon → text
    var NT_ICON_Y   = 6;                     // 14×14 icon rows 6..19
    var NT_TEXT_Y   = 5;                     // Born2bSporty caps from row 8
    // Timing: drop in (easeOutBack — a small overshoot), hold, slide up.
    var NT_IN_MS    = 450;
    var NT_HOLD_MS  = 3000;
    var NT_OUT_MS   = 260;
    var NT_BACK     = 2.2;                   // easeOutBack overshoot amount (~3 px)

    function DesktopComputerV2DemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Desktop computer';
        this.breadcrumbTitle = 'Desktop computer';
        this._bg = null;
        this._timer = null;
        this._pollTimer = null;
        this._baseline = null;
        this._fresh = false;
        this._shownAt = 0;                   // notification start, 0 = hidden
    }

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    function easeOutBack(t) {
        var c3 = NT_BACK + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + NT_BACK * Math.pow(t - 1, 2);
    }

    function getJson(url, done) {
        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(d) { done(d); })
            .catch(function() { done(null); });
    }

    // Ids present now (see the header), or null on a failed request.
    function readIds(d) {
        if (!d || !d.ok) return null;
        var ids = [], i;
        var typec = d.typec || [], drm = d.drm || [];
        for (i = 0; i < typec.length; i++) {
            if (TYPEC_PORT && typec[i].port !== TYPEC_PORT) continue;
            if (typec[i].partner) ids.push('typec:' + typec[i].port);
        }
        for (i = 0; i < drm.length; i++) {
            if (drm[i].status === 'connected') ids.push('drm:' + drm[i].connector);
        }
        var udc = d.udc || [], power = d.power || [];
        for (i = 0; i < udc.length; i++) {
            if (udc[i].state && udc[i].state !== 'not attached') ids.push('udc:' + udc[i].name);
        }
        for (i = 0; i < power.length; i++) {
            if (power[i].online) ids.push('psu:' + power[i].name);
        }
        return ids;
    }

    DesktopComputerV2DemoScene.prototype.enter = function() {
        var self = this;
        // Re-fetch the art on every visit (cache-busted), so a PNG swapped
        // on disk shows up without reloading the page; keep the old copy
        // on screen until the new one has loaded.
        var img = new Image();
        img.onload = function() { self._bg = img; repaint(); };
        img.src = BG_SRC + '?v=' + Date.now();

        this._baseline = null;
        this._fresh = false;
        var poll = function() {
            getJson('/api/usbc', function(d) {
                if (!self._pollTimer) return;
                var ids = readIds(d);
                if (ids) self._onIds(ids);
            });
        };
        poll();
        this._pollTimer = setInterval(poll, POLL_MS);
        this._timer = setInterval(function() { if (self._shownAt) repaint(); }, 16);
        repaint();
    };

    DesktopComputerV2DemoScene.prototype.exit = function() {
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
        if (this._timer)     { clearInterval(this._timer);     this._timer = null; }
        this._shownAt = 0;
    };

    DesktopComputerV2DemoScene.prototype._onIds = function(ids) {
        var present = {}, i;
        for (i = 0; i < ids.length; i++) present[ids[i]] = true;
        if (this._baseline === null) { this._baseline = present; return; }
        for (var id in this._baseline) {
            if (!present[id]) delete this._baseline[id];
        }
        var fresh = false;
        for (var p in present) {
            if (!this._baseline[p]) { fresh = true; break; }
        }
        if (fresh && !this._fresh) this._notify();
        this._fresh = fresh;
    };

    DesktopComputerV2DemoScene.prototype._notify = function() {
        this._shownAt = Date.now();
        repaint();
    };

    DesktopComputerV2DemoScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'ok') this._notify();
    };

    // Notification top y at `now`, or null when it's off screen.
    DesktopComputerV2DemoScene.prototype._notifyY = function(now) {
        if (!this._shownAt) return null;
        var t = now - this._shownAt;
        if (t < NT_IN_MS) {
            return NT_HIDDEN_Y + (NT_REST_Y - NT_HIDDEN_Y) * easeOutBack(t / NT_IN_MS);
        }
        t -= NT_IN_MS;
        if (t < NT_HOLD_MS) return NT_REST_Y;
        t -= NT_HOLD_MS;
        if (t < NT_OUT_MS) {
            var p = t / NT_OUT_MS;
            return NT_REST_Y + (NT_HIDDEN_Y - NT_REST_Y) * p * p;
        }
        this._shownAt = 0;
        return null;
    };

    DesktopComputerV2DemoScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        canvas.clear('#fff');
        if (this._bg && this._bg.complete && this._bg.naturalWidth) ctx.drawImage(this._bg, 0, 0);

        var y = this._notifyY(Date.now());
        if (y === null) return;
        y = Math.round(y);
        var vis = Math.max(0, Math.min(1, (y - NT_HIDDEN_Y) / (NT_REST_Y - NT_HIDDEN_Y)));
        var fy = y + NT_H + 1;               // first row under the 2 px bottom
        if (fy > 0 && vis > 0) {
            var grad = ctx.createLinearGradient(0, fy, 0, fy + NT_FADE_H);
            grad.addColorStop(0, 'rgba(255, 255, 255, ' + vis + ')');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, fy, canvas.w, NT_FADE_H);
            // Same white behind the frame's rounded bottom corners.
            ctx.fillStyle = 'rgba(255, 255, 255, ' + vis + ')';
            ctx.fillRect(0, Math.max(0, y), canvas.w, fy - Math.max(0, y));
        }
        new ResponsiveFrame({
            x: NT_X, y: y, width: NT_W, height: NT_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: true, strokeColor: '#000',
            showFill: true, fillColor: '#fff',
            cornerRadius: NT_RADIUS,
            corners: { tl: true, tr: true, bl: true, br: true }
        }).render(canvas);
        // Second line under the bottom edge (a 2 px bottom, like the
        // selector frames).
        ctx.fillStyle = '#000';
        ctx.fillRect(NT_X + NT_RADIUS - 1, y + NT_H, NT_W - 2 * (NT_RADIUS - 1), 1);

        var icon = Icons.desktop_computer;
        var tw = Born2bSportyV2FlipCTL.textWidth(NT_TEXT);
        var x0 = 128 - Math.floor((icon.w + NT_GAP + tw) / 2);
        var dy = y - NT_REST_Y;
        canvas.drawSprite(icon, x0, NT_ICON_Y + dy, '#000');
        Born2bSportyV2FlipCTL.draw(ctx, NT_TEXT, x0 + icon.w + NT_GAP, NT_TEXT_Y + dy, '#000');
    };

    return DesktopComputerV2DemoScene;
})();
