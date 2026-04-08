var UsbEthScene = (function() {
    var data = null;
    var loading = true;
    var error = false;
    var pollTimer = null;
    var scrollOffset = 0;

    function fetchData() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/usbeth', true);
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

    function fmtBytes(b) {
        if (b === null || b === undefined) return '--';
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
        return (b / 1073741824).toFixed(1) + ' GB';
    }

    function buildLines(d) {
        var lines = [];

        lines.push({ text: 'flipusb0 (USB NCM)', color: '#fff' });

        lines.push({ text: ' Gadget: ' + d.service, color: d.service === 'active' ? '#fff' : '#888' });
        lines.push({ text: ' Link:   ' + d.operstate, color: d.operstate === 'up' ? '#fff' : '#888' });

        if (d.mac) {
            lines.push({ text: ' MAC:  ' + d.mac, color: '#fff' });
        }

        if (d.ip4 && d.ip4.length > 0) {
            for (var i = 0; i < d.ip4.length; i++) {
                lines.push({ text: ' IPv4: ' + d.ip4[i], color: '#fff' });
            }
        } else {
            lines.push({ text: ' IPv4: --', color: '#888' });
        }

        if (d.ip6 && d.ip6.length > 0) {
            for (var j = 0; j < d.ip6.length; j++) {
                lines.push({ text: ' IPv6: ' + d.ip6[j], color: '#fff' });
            }
        }

        lines.push({ text: '', color: '#000' });
        lines.push({ text: ' RX: ' + fmtBytes(d.rxBytes), color: '#888' });
        lines.push({ text: ' TX: ' + fmtBytes(d.txBytes), color: '#888' });

        return lines;
    }

    function UsbEthScene() {}

    UsbEthScene.prototype.enter = function() {
        loading = true;
        error = false;
        data = null;
        scrollOffset = 0;
        fetchData();
        pollTimer = setInterval(fetchData, 1000);
    };

    UsbEthScene.prototype.exit = function() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };

    UsbEthScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
        if (action === 'down') scrollOffset++;
        if (action === 'up' && scrollOffset > 0) scrollOffset--;
    };

    UsbEthScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'USB Ethernet');

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

        var lines = buildLines(data);
        var maxVisible = Math.floor((canvas.h - y) / lineH);

        if (scrollOffset > Math.max(0, lines.length - maxVisible)) {
            scrollOffset = Math.max(0, lines.length - maxVisible);
        }

        for (var i = scrollOffset; i < lines.length && (i - scrollOffset) < maxVisible; i++) {
            canvas.drawText(lines[i].text, 4, y + (i - scrollOffset) * lineH, lines[i].color);
        }
    };

    return UsbEthScene;
})();
