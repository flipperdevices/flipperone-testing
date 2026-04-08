var SysInfoScene = (function() {
    var data = null;
    var loading = true;
    var error = false;
    var pollTimer = null;

    function fetchSysInfo() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/sysinfo', true);
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

    // Truncate text to fit canvas width (256px, 4px padding each side)
    function fitText(canvas, text) {
        var maxW = canvas.w - 8;
        if (canvas.textWidth(text) <= maxW) return text;
        while (text.length > 1 && canvas.textWidth(text + '..') > maxW) {
            text = text.slice(0, -1);
        }
        return text + '..';
    }

    function fmtUptime(sec) {
        if (sec === null || sec === undefined) return '--';
        var d = Math.floor(sec / 86400);
        var h = Math.floor((sec % 86400) / 3600);
        var m = Math.floor((sec % 3600) / 60);
        if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
        if (h > 0) return h + 'h ' + m + 'm';
        return m + 'm';
    }

    function SysInfoScene() {}

    SysInfoScene.prototype.enter = function() {
        loading = true;
        error = false;
        data = null;
        fetchSysInfo();
        pollTimer = setInterval(fetchSysInfo, 5000);
    };

    SysInfoScene.prototype.exit = function() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };

    SysInfoScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
    };

    SysInfoScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'System Info');

        var y = UI.STATUS_BAR_H + 4;
        var lineH = 10;
        var labelColor = '#888';
        var valueColor = '#fff';

        if (loading && !data) {
            canvas.drawText('Loading...', 4, y, labelColor);
            return;
        }
        if (error && !data) {
            canvas.drawText('Error', 4, y, labelColor);
            return;
        }

        canvas.drawText('Build', 4, y, labelColor);
        y += lineH;
        canvas.drawText(fitText(canvas, ' ' + (data.buildId || '--')), 4, y, valueColor);
        y += lineH;

        if (data.buildGit) {
            canvas.drawText(fitText(canvas, ' ' + data.buildGit), 4, y, valueColor);
            y += lineH;
        }

        y += 4;
        canvas.drawText('Hostname', 4, y, labelColor);
        y += lineH;
        canvas.drawText(fitText(canvas, ' ' + (data.hostname || '--')), 4, y, valueColor);
        y += lineH;

        y += 4;
        canvas.drawText('Kernel', 4, y, labelColor);
        y += lineH;
        canvas.drawText(fitText(canvas, ' ' + (data.kernel || '--')), 4, y, valueColor);
        y += lineH;

        y += 4;
        canvas.drawText('Uptime', 4, y, labelColor);
        y += lineH;
        canvas.drawText(' ' + fmtUptime(data.uptime), 4, y, valueColor);
    };

    return SysInfoScene;
})();
