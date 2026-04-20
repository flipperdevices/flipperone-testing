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

    // Poll the server version every 2s. The first successful response
    // is the baseline; any later change means the server was restarted
    // (e.g., variant switch) and we reload the page to pick up the new
    // code. fetch() errors while the server is restarting are ignored.
    (function startVersionWatcher() {
        var baseline = null;
        setInterval(function() {
            fetch('/api/version', { cache: 'no-store' })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(v) {
                    if (!v) return;
                    if (baseline === null) {
                        baseline = v.id;
                    } else if (v.id !== baseline) {
                        location.reload();
                    }
                })
                .catch(function() { /* server restarting; ignore */ });
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
