/**
 * SdrConnectedDemoScene
 *
 * Testing → Kickstarter demo → 'SDR connected'. Fake app for the
 * campaign footage, two full-screen states:
 *
 *   • Disconnected — assets/kickstarter_UI/sdr_disconnected.png.
 *   • Connected    — the 120-frame, 60 fps sdr_connected loop, shown
 *                    while something is plugged into USB (USB-A).
 *
 * Detection: GET /api/usb/devices every POLL_MS. Each snapshot is a set
 * of ids: occupied hub ports ('port:<name>', set the moment something
 * is electrically present, before the kernel recognises it) plus
 * enumerated devices (fallback if the port watcher isn't running). The
 * first snapshot is the baseline (modem and other built-in devices);
 * any id not in the baseline means "connected". A baseline id that
 * disappears is dropped from it, so an SDR that was already plugged in
 * when the app opened counts once it is replugged. The loop restarts
 * from frame 0 on every connect. A bare cable is invisible: nothing on
 * the far end, nothing on the bus.
 *
 * Playback uses a pre-rendered sprite sheet (same technique as the UI
 * PNG viewer / Wi-Fi scanner v3) so the 2 s loop wraps without a seam.
 * Rebuild after changing the frames, from assets/kickstarter_UI/:
 *   ffmpeg -framerate 60 -i sdr_connected/frame_%03d.png \
 *          -vf format=gray,tile=12x10 -frames:v 1 -update 1 sdr_connected_sheet.png
 *
 * OK toggles a manual "connected" override (preview without hardware,
 * or a backup during a shoot). Back returns to the Kickstarter list.
 */
var SdrConnectedDemoScene = (function() {
    var DISCONNECTED_SRC = 'assets/kickstarter_UI/sdr_disconnected.png';
    var CLIP = {
        src:    'assets/kickstarter_UI/sdr_connected_sheet.png',
        frames: 120,
        cols:   12,
        fps:    60,
        w:      256,
        h:      144
    };
    var POLL_MS = 150;

    // Images are re-fetched on every enter() with a cache-busting query,
    // so art swapped on disk shows up the next time the app is opened,
    // without reloading the (long-lived) page on the device.
    // The previous copy stays on screen until the fresh one has loaded.
    var images = {};
    function load(src) {
        var img = new Image();
        img.onload = function() {
            images[src] = img;
            if (window.requestRender) window.requestRender();
        };
        img.src = src + '?v=' + Date.now();
        if (!images[src]) images[src] = img;
    }
    function image(src) {
        if (!images[src]) load(src);
        return images[src];
    }
    function ready(img) { return img && img.complete && img.naturalWidth > 0; }

    function SdrConnectedDemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'SDR connected';
        this.breadcrumbTitle = 'SDR connected';
        this._baseline  = null;    // id -> true, set by the first snapshot
        this._usbNew    = false;   // a non-baseline device is present
        this._manual    = false;   // OK override
        this._connected = false;
        this._t0        = 0;       // loop start, reset on every connect
        this._pollTimer = null;
    }

    SdrConnectedDemoScene.prototype.enter = function() {
        var self = this;
        load(DISCONNECTED_SRC);
        load(CLIP.src);
        this._baseline = null;
        this._usbNew   = false;
        this._portsOk  = false;
        this._update();
        this._poll();
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = setInterval(function() { self._poll(); }, POLL_MS);
    };

    SdrConnectedDemoScene.prototype.exit = function() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    };

    SdrConnectedDemoScene.prototype._poll = function() {
        var self = this;
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/usb/devices', true);
            xhr.timeout = 2000;
            xhr.onload = function() {
                if (!self._pollTimer && self._baseline !== null) return;   // exited
                var d = null;
                try { d = JSON.parse(xhr.responseText); } catch (e) {}
                if (!d || !d.ok || !d.devices) return;
                var ids = d.devices.slice();
                var portIds = [];
                var ports = d.portsOk ? (d.ports || []) : [];
                for (var i = 0; i < ports.length; i++) portIds.push({ id: 'port:' + ports[i] });
                // The port watcher just came up (first time or after a
                // restart): what it sees now is built-in, not "plugged in".
                if (d.portsOk && !self._portsOk) self._absorb(portIds);
                self._portsOk = !!d.portsOk;
                self._onDevices(ids.concat(portIds));
            };
            xhr.send();
        } catch (e) { /* offline, keep the current state */ }
    };

    // Add ids to the baseline (treated as built-in). Before the first
    // snapshot there is no baseline yet; that snapshot becomes it whole.
    SdrConnectedDemoScene.prototype._absorb = function(devices) {
        if (this._baseline === null) return;
        for (var i = 0; i < devices.length; i++) this._baseline[devices[i].id] = true;
    };

    SdrConnectedDemoScene.prototype._onDevices = function(devices) {
        var present = {};
        for (var i = 0; i < devices.length; i++) present[devices[i].id] = true;
        if (this._baseline === null) {
            this._baseline = present;
        } else {
            // Forget built-in entries that went away, so a replug counts.
            for (var id in this._baseline) {
                if (!present[id]) delete this._baseline[id];
            }
        }
        var fresh = false;
        for (var p in present) {
            if (!this._baseline[p]) { fresh = true; break; }
        }
        this._usbNew = fresh;
        this._update();
    };

    SdrConnectedDemoScene.prototype._update = function() {
        var on = this._usbNew || this._manual;
        if (on && !this._connected) this._t0 = Date.now();
        if (on !== this._connected) {
            this._connected = on;
            if (window.requestRender) window.requestRender();
        }
    };

    SdrConnectedDemoScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'ok') {
            this._manual = !this._manual;
            this._update();
        }
    };

    SdrConnectedDemoScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        if (this._connected) {
            var sheet = image(CLIP.src);
            if (ready(sheet)) {
                // Wall-clock frame index; the modulo is the loop.
                var fi = Math.floor((Date.now() - this._t0) * CLIP.fps / 1000) % CLIP.frames;
                ctx.drawImage(sheet,
                    (fi % CLIP.cols) * CLIP.w, Math.floor(fi / CLIP.cols) * CLIP.h,
                    CLIP.w, CLIP.h, 0, 0, canvas.w, canvas.h);
            } else {
                canvas.clear('#fff');
            }
            // Keep the render loop running while the clip plays.
            if (window.requestRender) window.requestRender();
            return;
        }
        var still = image(DISCONNECTED_SRC);
        if (ready(still)) ctx.drawImage(still, 0, 0, canvas.w, canvas.h);
        else canvas.clear('#fff');
    };

    return SdrConnectedDemoScene;
})();
