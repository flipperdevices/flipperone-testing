var MonitorsScene = (function() {
    var data = null;
    var loading = true;
    var error = false;
    var pollTimer = null;
    var scrollOffset = 0;

    function fetchMonitors() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/monitors', true);
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

    function buildLines(monitors) {
        var lines = [];
        for (var i = 0; i < monitors.length; i++) {
            var m = monitors[i];
            if (i > 0) lines.push({ text: '', color: '#000' });

            var header = m.connector + ' (' + m.driver + ')';
            lines.push({ text: header, color: '#fff' });

            if (m.status !== 'connected') {
                lines.push({ text: ' Disconnected', color: '#888' });
                continue;
            }

            if (m.monitor) {
                lines.push({ text: ' ' + m.monitor, color: '#fff' });
            }
            if (m.mode) {
                var modeStr = ' ' + m.mode;
                if (m.modes > 1) modeStr += ' (' + m.modes + ' modes)';
                lines.push({ text: modeStr, color: '#fff' });
            }
            if (m.enabled) {
                lines.push({ text: ' Enabled: ' + m.enabled, color: '#888' });
            }
            if (m.dpms) {
                lines.push({ text: ' DPMS: ' + m.dpms, color: '#888' });
            }
        }
        return lines;
    }

    function MonitorsScene() {}

    MonitorsScene.prototype.enter = function() {
        loading = true;
        error = false;
        data = null;
        scrollOffset = 0;
        fetchMonitors();
        pollTimer = setInterval(fetchMonitors, 2000);
    };

    MonitorsScene.prototype.exit = function() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };

    MonitorsScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
        if (action === 'down') scrollOffset++;
        if (action === 'up' && scrollOffset > 0) scrollOffset--;
    };

    MonitorsScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Monitors');

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
        if (!data || !data.monitors || data.monitors.length === 0) {
            canvas.drawText('No connectors found', 4, y, '#888');
            return;
        }

        var lines = buildLines(data.monitors);
        var maxVisible = Math.floor((canvas.h - y) / lineH);

        if (scrollOffset > Math.max(0, lines.length - maxVisible)) {
            scrollOffset = Math.max(0, lines.length - maxVisible);
        }

        for (var i = scrollOffset; i < lines.length && (i - scrollOffset) < maxVisible; i++) {
            canvas.drawText(lines[i].text, 4, y + (i - scrollOffset) * lineH, lines[i].color);
        }
    };

    return MonitorsScene;
})();
