var DiskSpaceScene = (function() {
    var sdCard = { name: 'SD Card', mounted: false, used: 0, total: 0 };
    var loading = true;
    var error = false;

    function fetchDiskInfo() {
        loading = true;
        error = false;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/disk', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                sdCard.mounted = data.mounted;
                sdCard.used = data.usedGB || 0;
                sdCard.total = data.totalGB || 0;
            } else {
                error = true;
            }
            loading = false;
        };
        xhr.onerror = function() { error = true; loading = false; };
        xhr.ontimeout = function() { error = true; loading = false; };
        xhr.send();
    }

    function DiskSpaceScene() {}

    DiskSpaceScene.prototype.enter = function() {
        fetchDiskInfo();
    };
    DiskSpaceScene.prototype.exit = function() {};

    DiskSpaceScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
    };

    DiskSpaceScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Disk Space');

        var y = UI.STATUS_BAR_H + 4;
        var barH = 5;

        if (loading) {
            canvas.drawText('Loading...', 4, y, '#888');
        } else if (error) {
            canvas.drawText('SD Card: Error', 4, y, '#888');
        } else if (!sdCard.mounted) {
            canvas.drawText('SD Card: Not mounted', 4, y, '#888');
        } else {
            var pct = Math.round((sdCard.used / sdCard.total) * 100);
            canvas.drawText('SD Card: ' + sdCard.used + '/' + sdCard.total + ' GB (' + pct + '%)', 4, y, '#fff');

            var barY = y + 10;
            var barW = canvas.w - 12;
            canvas.drawFrame(4, barY, barW + 2, barH + 2, '#888');
            var fillW = Math.round(barW * (sdCard.used / sdCard.total));
            canvas.drawRect(5, barY + 1, fillW, barH, '#fff');
        }

        canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
    };

    return DiskSpaceScene;
})();
