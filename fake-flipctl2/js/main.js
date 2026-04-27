(function() {
    var canvasEl = document.getElementById('screen');
    var canvas = new FlipCanvas(canvasEl);
    var input = new Input();
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
            if (key === 'appsw' && !(active instanceof FigmaLivePreviewScene)) {
                if (active instanceof AppSwitcherScene) {
                    scenes.pop();
                } else {
                    // The switcher pulls its cards from the global
                    // RunningApps registry; sceneManager is needed so
                    // the OK action can launch the focused app.
                    scenes.push(new AppSwitcherScene(scenes));
                }
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
