(function() {
    var canvasEl = document.getElementById('screen');
    var canvas = new FlipCanvas(canvasEl);
    var input = new Input();
    var scenes = new SceneManager();

    scenes.push(new MenuScene(scenes));

    function loop() {
        var keys = input.processQueue();
        var scene = scenes.current();

        for (var i = 0; i < keys.length; i++) {
            if (scene && scene.handleInput) {
                if (scene.handleInput(keys[i]) === 'pop') {
                    scenes.pop();
                    scene = scenes.current();
                }
            }
        }

        canvas.clear('#000');
        if (scene && scene.render) {
            scene.render(canvas);
        }

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
})();
