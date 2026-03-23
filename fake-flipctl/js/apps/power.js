var PowerScene = (function() {
    var data = null;
    var loading = true;
    var error = false;
    var pollTimer = null;

    function fetchPower() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/power', true);
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

    function fmtTime(sec) {
        if (sec === null || sec === undefined || sec < 0) return '--';
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
        var s = sec % 60;
        if (m > 0) return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        return s + 's';
    }

    function PowerScene() {}

    PowerScene.prototype.enter = function() {
        loading = true;
        error = false;
        data = null;
        fetchPower();
        pollTimer = setInterval(fetchPower, 2000);
    };

    PowerScene.prototype.exit = function() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };

    PowerScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
    };

    PowerScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Power Info');

        var y = UI.STATUS_BAR_H + 4;
        var lineH = 10;

        if (loading && !data) {
            canvas.drawText('Loading...', 4, y, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        if (error && !data) {
            canvas.drawText('Error reading power', 4, y, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        if (!data || !data.available) {
            canvas.drawText('No battery found', 4, y, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        // Row 1: Status with icon + time estimate
        var charging = (data.status === 'Charging');
        var full = (data.status === 'Full');
        var statusStr = data.status || 'Unknown';

        if (charging) {
            // Lightning bolt icon
            canvas.drawPixel(4 + 4, y, '#fff');
            canvas.drawPixel(4 + 3, y + 1, '#fff');
            canvas.drawPixel(4 + 2, y + 2, '#fff');
            canvas.drawRect(4 + 1, y + 3, 4, 1, '#fff');
            canvas.drawPixel(4 + 3, y + 4, '#fff');
            canvas.drawPixel(4 + 2, y + 5, '#fff');
            canvas.drawPixel(4 + 1, y + 6, '#fff');
            canvas.drawText(statusStr, 14, y, '#fff');
        } else if (full) {
            canvas.drawText(statusStr, 4, y, '#fff');
        } else {
            // Down arrow for discharging
            canvas.drawRect(4 + 2, y, 1, 5, '#fff');
            canvas.drawPixel(4 + 1, y + 3, '#fff');
            canvas.drawPixel(4 + 3, y + 3, '#fff');
            canvas.drawPixel(4, y + 4, '#fff');
            canvas.drawPixel(4 + 4, y + 4, '#fff');
            canvas.drawText(statusStr, 14, y, '#fff');
        }

        // Time estimate on the right
        var timeStr = '';
        if (charging && data.timeToFull !== null) {
            timeStr = fmtTime(data.timeToFull) + ' left';
        } else if (!charging && !full && data.timeToEmpty !== null) {
            timeStr = fmtTime(data.timeToEmpty) + ' left';
        }
        if (timeStr) {
            var tw = canvas.textWidth(timeStr);
            canvas.drawText(timeStr, canvas.w - 4 - tw, y, '#888');
        }

        y += lineH + 4;

        // Row 2: Capacity bar
        var cap = data.capacity !== null ? data.capacity : 0;
        canvas.drawText(cap + '%', 4, y, '#fff');
        var barX = 30;
        var barW = canvas.w - barX - 6;
        var barH = 5;
        canvas.drawFrame(barX, y + 1, barW + 2, barH + 2, '#888');
        var fillW = Math.round(barW * (cap / 100));
        if (fillW > 0) {
            canvas.drawRect(barX + 1, y + 2, fillW, barH, '#fff');
        }

        y += lineH + 4;

        // Row 3: Charge stats
        if (data.chargeNow !== null && data.chargeFull !== null) {
            canvas.drawText('Charge: ' + data.chargeNow + '/' + data.chargeFull + ' Ah', 4, y, '#fff');
        } else {
            canvas.drawText('Charge: --', 4, y, '#fff');
        }
        y += lineH;

        // Row 4: Voltage / Current
        var vStr = data.voltage !== null ? data.voltage + 'V' : '--';
        var iStr = data.current !== null ? data.current + 'A' : '--';
        canvas.drawText(vStr + '  ' + iStr, 4, y, '#fff');
        y += lineH;

        // Row 5: System power
        var pStr = data.power !== null ? data.power + ' W' : '-- W';
        canvas.drawText('Power: ' + pStr, 4, y, '#fff');

        // Row 6: Temperature
        if (data.temp !== null) {
            y += lineH;
            var tempC = (data.temp / 10).toFixed(1);
            canvas.drawText('Temp: ' + tempC + ' C', 4, y, '#fff');
        }

        canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
    };

    return PowerScene;
})();
