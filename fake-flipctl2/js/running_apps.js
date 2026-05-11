/**
 * RunningApps
 *
 * Tracks the user's currently-running placeholder apps. Mirrors
 * the mental model of an OS-level recents stack: launching an app
 * from the Apps menu adds it here (or bumps it to the top if it
 * was already running), and the App Switcher renders one card per
 * entry. The list is in-memory and resets on page reload.
 *
 * Order is most-recently-used first: apps[0] = most recent,
 * apps[N-1] = oldest. The App Switcher maps that order onto its
 * position slots: apps[0] → position 0 (focused), apps[1] → -1, etc.
 *
 * Each entry carries an `image` field — initially the loaded PNG
 * placeholder, replaced on app exit by an off-screen canvas
 * holding what the user last saw (so the switcher shows
 * "live-looking" thumbnails of each app).
 */
var RunningApps = (function() {
    var apps = [];

    // Add a new app or bump an existing one to the top.
    // Re-launches preserve the existing entry's `image` (which may
    // already be a captured snapshot) — the foreground scene
    // re-renders its own content, but the switcher should keep
    // showing the most recent view of the app.
    //
    // `icon` is the bitmap sprite the App Switcher renders in the
    // card's title bar (matches the icon shown next to the app's
    // name in the Apps submenu).
    //
    // `factoryFn` is an optional `(sceneManager) => sceneInstance`
    // — used by the App Switcher to re-launch this entry. When
    // omitted, the switcher falls back to constructing a fresh
    // `PlaceholderAppScene` from `imagePath`/`name`/`icon`. App-mode
    // submenus (Settings, Network) provide a factory because they
    // aren't placeholder PNGs — they're real scene types.
    function open(name, imagePath, icon, factoryFn, onCloseFn) {
        if (!name) return;

        var existing = null;
        for (var i = apps.length - 1; i >= 0; i--) {
            if (apps[i].name === name) {
                existing = apps[i];
                apps.splice(i, 1);
            }
        }

        var entry;
        if (existing) {
            entry = existing;
            // Refresh imagePath / icon / factoryFn / onCloseFn
            // in case they changed; image stays as-is (the
            // captured snapshot is what matters).
            if (imagePath) entry.imagePath = imagePath;
            if (icon)      entry.icon = icon;
            if (factoryFn) entry.factoryFn = factoryFn;
            if (onCloseFn) entry.onCloseFn = onCloseFn;
        } else {
            entry = {
                name: name,
                imagePath: imagePath || null,
                icon: icon || null,
                factoryFn: factoryFn || null,
                onCloseFn: onCloseFn || null,
                image: null
            };
            if (entry.imagePath) {
                // Pre-load the fallback PNG so the switcher has
                // something to render before the first snapshot
                // (i.e. before the user has ever exited this app).
                var img = new Image();
                img.onload = function() {
                    if (typeof window.requestRender === 'function') window.requestRender();
                };
                img.src = entry.imagePath;
                entry.image = img;
            }
        }
        apps.unshift(entry);
    }

    // Replace an app's image with a captured canvas snapshot —
    // called from a scene's exit() so the switcher remembers what
    // the user was looking at when they left.
    function setSnapshot(name, snapshotCanvas) {
        for (var i = 0; i < apps.length; i++) {
            if (apps[i].name === name) {
                apps[i].image = snapshotCanvas;
                return;
            }
        }
    }

    function close(name) {
        for (var i = apps.length - 1; i >= 0; i--) {
            if (apps[i].name === name) {
                var entry = apps[i];
                apps.splice(i, 1);
                // Fire the entry's onClose hook so app-specific
                // teardown (stopping a media stream, releasing
                // a hardware lock, etc.) runs even when the
                // user kills via the switcher rather than
                // backing out of the scene. The scene's exit()
                // doesn't fire on switcher-kills — the scene is
                // already off the navigation stack — so this is
                // the only signal an app gets.
                if (typeof entry.onCloseFn === 'function') {
                    try { entry.onCloseFn(); } catch (e) {}
                }
                if (typeof window.requestRender === 'function') window.requestRender();
                return;
            }
        }
    }

    // Snapshot of the current list (most-recent first). Returns a
    // shallow copy so callers can iterate freely.
    function list() { return apps.slice(); }

    function clear() {
        apps.length = 0;
        if (typeof window.requestRender === 'function') window.requestRender();
    }

    return {
        open: open,
        close: close,
        list: list,
        clear: clear,
        setSnapshot: setSnapshot
    };
})();
