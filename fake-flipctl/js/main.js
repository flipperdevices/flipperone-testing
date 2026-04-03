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

    function loop(ts) {
        var keys = input.processQueue();
        var scene = scenes.current();

        if (keys.length > 0) {
            needsRender = true;
        }

        for (var i = 0; i < keys.length; i++) {
            if (scene && scene.handleInput) {
                if (scene.handleInput(keys[i]) === 'pop') {
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
