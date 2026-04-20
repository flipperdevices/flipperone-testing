(function() {
    var canvasEl = document.getElementById('screen');
    var canvas = new FlipCanvas(canvasEl);
    var input = new Input();
    var scenes = new SceneManager();

    // Redraw immediately on interaction, but cap idle redraws to reduce CPU usage.
    var needsRender = true;
    var lastRenderTs = 0;
    var IDLE_REDRAW_MS = 250;

    scenes.push(new MenuScene(scenes));

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
        var scene = scenes.current();

        if (keys.length > 0) {
            needsRender = true;
        }

        for (var i = 0; i < keys.length; i++) {
            if (scene && scene.handleInput) {
                var action = keys[i].action || keys[i];
                var rawKey = keys[i].key || null;
                if (scene.handleInput(action, rawKey) === 'pop') {
                    scenes.pop();
                    scene = scenes.current();
                    needsRender = true;
                }
            }
        }

        if (needsRender || (ts - lastRenderTs) >= IDLE_REDRAW_MS) {
            canvas.clear('#000');
            if (scene && scene.render) {
                scene.render(canvas);
            }
            needsRender = false;
            lastRenderTs = ts;
        }

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
})();
