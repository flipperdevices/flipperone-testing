var EthernetScene = (function() {
    var data = null;
    var loading = true;
    var error = false;
    var pollTimer = null;
    var scrollOffset = 0;

    function fetchEthernet() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/ethernet', true);
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

    function buildLines(ifaces) {
        var lines = [];
        for (var i = 0; i < ifaces.length; i++) {
            var iface = ifaces[i];
            if (i > 0) lines.push({ text: '', color: '#000' });

            var connected = iface.state && iface.state.indexOf('connected') !== -1
                && iface.state.indexOf('disconnected') === -1;
            var label = 'Eth' + i + ' (' + iface.name + ')';

            if (!connected) {
                lines.push({ text: label, color: '#fff' });
                lines.push({ text: ' Disconnected', color: '#888' });
                continue;
            }

            lines.push({ text: label, color: '#fff' });

            for (var j = 0; j < iface.ip4.length; j++) {
                lines.push({ text: ' IPv4: ' + iface.ip4[j], color: '#fff' });
            }
            for (var k = 0; k < iface.ip6.length; k++) {
                lines.push({ text: ' IPv6: ' + iface.ip6[k], color: '#fff' });
            }
            if (iface.gateway4) {
                lines.push({ text: ' GW: ' + iface.gateway4, color: '#fff' });
            }
            if (iface.dns.length > 0) {
                lines.push({ text: ' DNS: ' + iface.dns.join(', '), color: '#fff' });
            }
        }
        return lines;
    }

    function EthernetScene() {}

    EthernetScene.prototype.enter = function() {
        loading = true;
        error = false;
        data = null;
        scrollOffset = 0;
        fetchEthernet();
        pollTimer = setInterval(fetchEthernet, 1000);
    };

    EthernetScene.prototype.exit = function() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };

    EthernetScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
        if (action === 'down') scrollOffset++;
        if (action === 'up' && scrollOffset > 0) scrollOffset--;
    };

    EthernetScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Ethernet');

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

    return EthernetScene;
})();
