/**
 * SdrConnectedDemoScene
 *
 * Testing → Kickstarter demo → 'SDR connected'. Disconnected still until
 * something is plugged into USB (USB-A), then the 120-frame, 60 fps
 * "SDR Receiver Connected" loop. Engine: js/apps/kickstarter_connect_demo.js.
 *
 * Detection: GET /api/usb/devices. Ids are occupied hub ports
 * ('port:<name>', set the moment something is electrically present,
 * before the kernel recognises it) plus enumerated devices (fallback if
 * the port watcher isn't running). When the port watcher comes up (first
 * time or after a restart) the ports it sees are built-in, not "plugged
 * in". A bare cable is invisible: nothing on the far end, nothing on the
 * bus.
 *
 * Rebuild the sheet after changing the frames, from assets/kickstarter_UI/:
 *   ffmpeg -framerate 60 -i sdr_connected/frame_%03d.png \
 *          -vf format=gray,tile=12x10 -frames:v 1 -update 1 sdr_connected_sheet.png
 */
var SdrConnectedDemoScene = KickstarterConnectDemo({
    name:            'SDR connected',
    disconnectedSrc: 'assets/kickstarter_UI/sdr_disconnected.png',
    clip: {
        src:    'assets/kickstarter_UI/sdr_connected_sheet.png',
        frames: 120,
        cols:   12,
        fps:    60,
        w:      256,
        h:      144
    },
    pollMs: 150,
    fetch: function(ctx, done) {
        KickstarterConnectDemo.getJson('/api/usb/devices', function(d) {
            if (!d || !d.ok || !d.devices) { done(null); return; }
            var ids = [], portIds = [], i;
            for (i = 0; i < d.devices.length; i++) ids.push(d.devices[i].id);
            var ports = d.portsOk ? (d.ports || []) : [];
            for (i = 0; i < ports.length; i++) portIds.push('port:' + ports[i]);
            var absorb = (d.portsOk && !ctx.portsOk) ? portIds : null;
            ctx.portsOk = !!d.portsOk;
            done({ ids: ids.concat(portIds), absorb: absorb });
        });
    }
});
