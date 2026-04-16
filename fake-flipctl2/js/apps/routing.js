var RoutingScene = (function() {
    var data = null;
    var loading = true;
    var error = false;
    var pollTimer = null;

    function fetchRouting() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/routing', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                data = JSON.parse(xhr.responseText);
            } else {
                error = true;
            }
            loading = false;
        };
        xhr.onerror = function() { error = true; loading = false; };
        xhr.ontimeout = function() { error = true; loading = false; };
        xhr.send();
    }

    function RoutingScene() {}

    RoutingScene.prototype.enter = function() {
        loading = true;
        error = false;
        data = null;
        fetchRouting();
        pollTimer = setInterval(fetchRouting, 1000);
    };

    RoutingScene.prototype.exit = function() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };

    RoutingScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
    };

    RoutingScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Routing Info');

        var y = UI.STATUS_BAR_H + 3;
        var lineH = 9;

        if (loading && !data) {
            canvas.drawText('Loading...', 4, y, '#888');
            return;
        }
        if (error && !data) {
            canvas.drawText('Error', 4, y, '#888');
            return;
        }

        canvas.drawText('Default gateways:', 4, y, '#fff');
        y += lineH + 2;

        if (!data || data.length === 0) {
            canvas.drawText('No default routes', 4, y, '#888');
            return;
        }

        for (var i = 0; i < data.length; i++) {
            var r = data[i];
            canvas.drawText(r.family + ' via ' + r.dev, 4, y, '#888');
            y += lineH;
            canvas.drawText(' ' + r.gateway, 4, y, '#fff');
            y += lineH + 1;
        }
    };

    return RoutingScene;
})();
