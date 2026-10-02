/**
 * DesktopComputerDemoScene
 *
 * Testing → Kickstarter demo → 'Desktop computer'. Sad monitor until
 * anything is plugged into USB-C1 (display, dock, PC, charger, USB
 * device), then the 57-frame intro (sad monitor turns into "Desktop
 * Computer") once, then the 60-frame loop, both at 60 fps.
 * Engine: js/apps/kickstarter_connect_demo.js.
 *
 * Detection: GET /api/usbc. Ids are
 *   'typec:<portN>'  while that Type-C port has a partner — set for any
 *                    attached device as soon as the controller sees CC,
 *                    before DP / USB / PD come up (the main signal);
 *   'drm:<conn>'     a display connector reports "connected" (DP alt mode);
 *   'udc:<name>'     the USB gadget port sees a host (a PC);
 *   'psu:<name>'     an external USB / mains supply is online (a charger).
 * The last three are fallbacks for when Type-C isn't exposed in sysfs.
 * USB-A is deliberately not watched here (that is the SDR demo).
 * TYPEC_PORT pins the Type-C signal to one port (the one behind USB-C1)
 * so plugging a charger into the other USB-C doesn't count; null = any.
 * A bare cable with nothing on the far end can't be seen: no CC, no
 * power, no data.
 *
 * Rebuild the sheets after changing the clips, from
 * assets/kickstarter_UI/desktop_computer/ (frames / cols below must match):
 *   ffmpeg -i desktop_intro_256x144_h264.mp4 \
 *          -vf format=gray,tile=8x8 -frames:v 1 -update 1 desktop_intro_sheet.png
 *   ffmpeg -i desktop_connected_dip_256x144_h264.mp4 \
 *          -vf format=gray,tile=10x6 -frames:v 1 -update 1 desktop_connected_sheet.png
 */
var DesktopComputerDemoScene = (function() {
    var TYPEC_PORT = null;   // e.g. 'port0' once USB-C1 is identified on the device

    return KickstarterConnectDemo({
        name:            'Desktop computer',
        disconnectedSrc: 'assets/kickstarter_UI/desktop_computer/desktop_disconnected.png',
        intro: {
            src:    'assets/kickstarter_UI/desktop_computer/desktop_intro_sheet.png',
            frames: 57,
            cols:   8,
            fps:    60,
            w:      256,
            h:      144
        },
        clip: {
            src:    'assets/kickstarter_UI/desktop_computer/desktop_connected_sheet.png',
            frames: 60,
            cols:   10,
            fps:    60,
            w:      256,
            h:      144
        },
        pollMs: 150,
        fetch: function(ctx, done) {
            KickstarterConnectDemo.getJson('/api/usbc', function(d) {
                if (!d || !d.ok) { done(null); return; }
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
                done({ ids: ids, absorb: null });
            });
        }
    });
})();
