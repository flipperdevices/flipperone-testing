(function() {
    var canvasEl = document.getElementById('screen');
    var canvas = new FlipCanvas(canvasEl);
    var input = new Input();
    // Exposed so scenes / modals can poll continuous held-state
    // (e.g. Wi-Fi password modal's PTT-to-reveal). The action
    // queue stays the primary delivery channel — `window.input`
    // is only for the rare features that need "is this key down
    // right now?" semantics.
    window.input = input;
    var scenes = new SceneManager();

    // Event-driven repaint: the screen only redraws when something
    // actually changed. Input always flips the flag; scenes / pollers
    // call `window.requestRender()` to trigger a repaint after they
    // mutate visible state (data arrivals, animation frames, etc.).
    var needsRender = true;

    window.requestRender = function() { needsRender = true; };

    // Resolve a human-readable name for a scene — used by the App
    // Switcher's title bars. Order of preference:
    //   1. scene.displayName  — explicit constant (e.g. DesktopScene)
    //   2. scene.breadcrumbTitle — set by SubMenuScene to its title
    //   3. empty string — bar renders without a label.
    function getSceneName(scene) {
        if (!scene) return '';
        if (typeof scene.displayName === 'string') return scene.displayName;
        if (typeof scene.breadcrumbTitle === 'string') return scene.breadcrumbTitle;
        return '';
    }

    scenes.push(new DesktopScene(scenes));

    // Poll the server every 2s and reload the page when the underlying
    // server changes. The signature combines HTTP status with the body id
    // so any of these triggers a reload:
    //   - same variant, new process:    "200:A" -> "200:B"
    //   - swap to a variant that lacks
    //     /api/version:                 "200:A" -> "404"
    //   - swap from such a variant:     "404"   -> "200:B"
    // fetch() rejections (server unreachable during the restart window)
    // are ignored; the next poll will pick things up.
    (function startVersionWatcher() {
        var baseline = null;
        setInterval(function() {
            fetch('/api/version', { cache: 'no-store' })
                .then(function(r) {
                    if (r.ok) {
                        return r.json().then(function(body) {
                            return r.status + ':' + body.id;
                        });
                    }
                    return String(r.status);
                })
                .then(function(sig) {
                    if (baseline === null) {
                        baseline = sig;
                    } else if (sig !== baseline) {
                        location.reload();
                    }
                })
                .catch(function() { /* server unreachable; ignore */ });
        }, 2000);
    })();

    function loop(ts) {
        var keys = input.processQueue();

        if (keys.length > 0) {
            needsRender = true;
        }

        for (var i = 0; i < keys.length; i++) {
            var active = scenes.current();
            var key = keys[i];

            // Global Tab → App Switcher overlay. Suppressed inside
            // Figma live preview because that scene runs an iframe
            // that wants Tab for its own use; everywhere else, Tab
            // toggles the switcher: closes it if it's already on
            // top, opens it otherwise.
            // Tab opens the App Switcher from anywhere except Figma
            // live preview. When the switcher is already on top, we
            // do NOT auto-pop — instead we let the action fall
            // through to AppSwitcherScene.handleInput, which now
            // treats Tab the same as OK and launches the focused app.
            //
            // If no apps are currently running, there's nothing for
            // the switcher to show, so Tab degrades into Back —
            // dispatched through the active scene's handleInput
            // (so each scene gets to decide what Back means).
            if (key === 'appsw'
                && !(active instanceof FigmaLivePreviewScene)
                && !(active instanceof AppSwitcherScene)) {

                // Capture a "transient" focused card whenever Tab is
                // pressed from a non-app scene (Desktop, Main Menu,
                // generic submenus). The switcher renders that
                // snapshot as a fade-out overlay during the intro —
                // it isn't written to RunningApps and disappears
                // when the intro completes.
                //
                // Skipped for "app-like" scenes (PlaceholderAppScene,
                // SubMenuScenes that called `markAsApp(...)` —
                // i.e. Settings / Network — and any custom scene
                // class that sets `this._isApp = true` to opt in,
                // such as InternetRadioScene). Those scenes are
                // already in RunningApps as real cards; capturing
                // a transient on top would just duplicate them
                // and trigger the slide-up-from-bottom intro
                // intended for cases where Tab opens from a
                // non-app scene.
                var isAppScene = active instanceof PlaceholderAppScene
                    || (typeof SubMenuScene !== 'undefined'
                        && active instanceof SubMenuScene
                        && active._asApp)
                    || (active && active._isApp === true);
                var transient = null;
                if (!isAppScene) {
                    var tSnap = document.createElement('canvas');
                    tSnap.width  = canvas.w;
                    tSnap.height = canvas.h;
                    tSnap.getContext('2d').drawImage(canvas.el, 0, 0);
                    transient = {
                        name: getSceneName(active) || '',
                        snapshot: tSnap
                    };
                }

                scenes.push(new AppSwitcherScene(scenes, transient));
                needsRender = true;
                continue;
            }

            if (active && active.handleInput) {
                if (active.handleInput(key) === 'pop') {
                    scenes.pop();
                    needsRender = true;
                }
            }
        }

        if (needsRender) {
            // Re-fetch the current scene — handleInput may have pushed
            // a new one (or pop above advanced the stack). Without this
            // we'd paint the previous scene and wait for its first
            // async requestRender to show the new one.
            //
            // Clear the flag *before* the scene paints. Scenes running
            // an animation call window.requestRender() from within
            // their render() to schedule the next frame; clearing
            // after would clobber that and stop the animation cold.
            var active = scenes.current();
            needsRender = false;
            canvas.clear('#000');
            if (active && active.render) {
                active.render(canvas);
                // Record the scene whose pixels are now on the canvas.
                // Scenes that snapshot themselves on exit() consult this
                // to skip captures when the visible pixels actually
                // belong to a different (e.g. overlay) scene.
                window._lastRenderedScene = active;
            }
        }

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
})();
