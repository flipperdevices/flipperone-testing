var WifiMenuScene = (function() {
    var status = null;
    var loading = true;
    var error = false;
    var pollTimer = null;

    function fetchStatus() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/wifi/status', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                status = JSON.parse(xhr.responseText);
            } else {
                error = true;
            }
            loading = false;
        };
        xhr.onerror = function() { error = true; loading = false; };
        xhr.ontimeout = function() { error = true; loading = false; };
        xhr.send();
    }

    function WifiMenuScene(sceneManager) {
        this.sceneManager = sceneManager;
        this.items = ['Scan WiFi', 'Activate 2.4 GHz AP', 'Activate 5 GHz AP'];
        this.selectedIndex = 0;
        this.scrollOffset = 0;
    }

    WifiMenuScene.prototype.enter = function() {
        loading = true;
        error = false;
        status = null;
        fetchStatus();
        pollTimer = setInterval(fetchStatus, 2000);
    };

    WifiMenuScene.prototype.exit = function() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };

    WifiMenuScene.prototype.handleInput = function(action) {
        var visible = Math.floor((144 - 50) / 12);
        if (action === 'down') {
            if (this.selectedIndex < this.items.length - 1) {
                this.selectedIndex++;
                if (this.selectedIndex >= this.scrollOffset + visible)
                    this.scrollOffset = this.selectedIndex - visible + 1;
            }
        } else if (action === 'up') {
            if (this.selectedIndex > 0) {
                this.selectedIndex--;
                if (this.selectedIndex < this.scrollOffset)
                    this.scrollOffset = this.selectedIndex;
            }
        } else if (action === 'ok') {
            if (this.items[this.selectedIndex] === 'Scan WiFi') {
                this.sceneManager.push(new WifiScanScene());
            } else if (this.items[this.selectedIndex] === 'Activate 2.4 GHz AP') {
                this.sceneManager.push(new WifiApActivateScene('wifi-router2g', '2.4 GHz'));
            } else if (this.items[this.selectedIndex] === 'Activate 5 GHz AP') {
                this.sceneManager.push(new WifiApActivateScene('wifi-router5g', '5 GHz'));
            }
        } else if (action === 'back') {
            return 'pop';
        }
    };

    WifiMenuScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Wi-Fi');

        var y = UI.STATUS_BAR_H + 3;
        var lineH = 9;

        // Status header
        if (loading && !status) {
            canvas.drawText('Loading...', 4, y, '#888');
            return;
        }

        if (status) {
            if (status.mode === 'ap') {
                canvas.drawText('AP: ' + (status.ssid || '--'), 4, y, '#fff');
                y += lineH;
                canvas.drawText('Clients: ' + (status.clients !== null ? status.clients : '--'), 4, y, '#888');
            } else if (status.mode === 'sta') {
                var conn = status.connectedTo || '--';
                canvas.drawText('STA: ' + conn, 4, y, '#fff');
            } else if (status.mode === 'disconnected') {
                canvas.drawText('WiFi: disconnected', 4, y, '#888');
            } else {
                canvas.drawText('WiFi: ' + (status.mode || 'unknown'), 4, y, '#888');
            }
        }

        // Menu below status
        y += lineH + 4;
        canvas.drawHLine(0, y, canvas.w, '#555');
        y += 3;

        var itemH = 12;
        for (var i = 0; i < this.items.length; i++) {
            var iy = y + i * itemH;
            if (iy + itemH > canvas.h) break;
            var selected = (i === this.selectedIndex);
            if (selected) {
                canvas.drawRect(0, iy, canvas.w, itemH, '#fff');
                canvas.drawText(this.items[i], 4, iy + 2, '#000');
            } else {
                canvas.drawText(this.items[i], 4, iy + 2, '#fff');
            }
        }
    };

    return WifiMenuScene;
})();


var WifiScanScene = (function() {
    var networks = null;
    var loading = false;
    var scanning = false;
    var error = false;
    var scrollOffset = 0;

    function doScan() {
        scanning = true;
        error = false;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/wifi/scan', true);
        xhr.timeout = 15000;
        xhr.onload = function() {
            scanning = false;
            if (xhr.status === 200) {
                networks = JSON.parse(xhr.responseText).networks || [];
            } else {
                error = true;
            }
        };
        xhr.onerror = function() { scanning = false; error = true; };
        xhr.ontimeout = function() { scanning = false; error = true; };
        xhr.send();
    }

    function WifiScanScene() {}

    WifiScanScene.prototype.enter = function() {
        networks = null;
        scanning = false;
        error = false;
        scrollOffset = 0;
        doScan();
    };

    WifiScanScene.prototype.exit = function() {};

    WifiScanScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
        if (action === 'down') scrollOffset++;
        if (action === 'up' && scrollOffset > 0) scrollOffset--;
        if (action === 'ok' && !scanning) doScan();
    };

    WifiScanScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Scan WiFi');

        var y = UI.STATUS_BAR_H + 3;
        var lineH = 9;

        if (scanning) {
            canvas.drawText('Scanning...', 4, y, '#888');
            return;
        }
        if (error) {
            canvas.drawText('Scan failed', 4, y, '#888');
            y += lineH + 2;
            canvas.drawText('WiFi may be in AP mode.', 4, y, '#888');
            y += lineH;
            canvas.drawText('Press OK to retry.', 4, y, '#888');
            return;
        }
        if (!networks || networks.length === 0) {
            canvas.drawText('No networks found', 4, y, '#888');
            y += lineH;
            canvas.drawText('Press OK to rescan', 4, y, '#888');
            return;
        }

        // Warning line
        canvas.drawText('Connection not implemented', 4, y, '#888');
        y += lineH + 2;

        var maxVisible = Math.floor((canvas.h - y) / lineH);
        if (scrollOffset > Math.max(0, networks.length - maxVisible)) {
            scrollOffset = Math.max(0, networks.length - maxVisible);
        }

        for (var i = scrollOffset; i < networks.length && (i - scrollOffset) < maxVisible; i++) {
            var n = networks[i];
            var signal = n.signal || 0;
            var sec = n.security || '';
            var label = n.ssid || '(hidden)';
            // Truncate long SSIDs
            if (label.length > 28) label = label.substring(0, 26) + '..';
            var suffix = ' ' + signal + '%';
            if (sec) suffix += ' ' + sec;
            canvas.drawText(label, 4, y + (i - scrollOffset) * lineH, '#fff');
            var sw = canvas.textWidth(suffix);
            canvas.drawText(suffix, canvas.w - sw - 4, y + (i - scrollOffset) * lineH, '#888');
        }
    };

    return WifiScanScene;
})();


var WifiApActivateScene = (function() {
    // States: 'confirm', 'activating', 'active', 'fail'
    var state = 'confirm';
    var connName = '';
    var bandLabel = '';
    var output = '';
    var apInfo = null;
    var pollTimer = null;
    var buttonIndex = 0;

    function activate() {
        state = 'activating';
        output = '';
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/wifi/activate-ap', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 15000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                if (data.success) {
                    apInfo = data;
                    state = 'active';
                } else {
                    output = data.error || 'Unknown error';
                    state = 'fail';
                }
            } else {
                output = 'HTTP ' + xhr.status;
                state = 'fail';
            }
        };
        xhr.onerror = function() { output = 'Network error'; state = 'fail'; };
        xhr.ontimeout = function() { output = 'Timeout'; state = 'fail'; };
        xhr.send(JSON.stringify({ connection: connName }));
    }

    function fetchApStatus() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/wifi/status', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                if (data.mode === 'ap') {
                    apInfo = data;
                }
            }
        };
        xhr.send();
    }

    function WifiApActivateScene(connection, band) {
        connName = connection;
        bandLabel = band;
    }

    WifiApActivateScene.prototype.enter = function() {
        state = 'confirm';
        output = '';
        apInfo = null;
        buttonIndex = 0;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    };

    WifiApActivateScene.prototype.exit = function() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };

    WifiApActivateScene.prototype.handleInput = function(action) {
        if (state === 'activating') return;

        if (state === 'confirm') {
            if (action === 'left' || action === 'right') {
                buttonIndex = buttonIndex === 0 ? 1 : 0;
            } else if (action === 'ok') {
                if (buttonIndex === 0) {
                    activate();
                } else {
                    return 'pop';
                }
            } else if (action === 'back') {
                return 'pop';
            }
            return;
        }

        if (action === 'back' || action === 'ok') return 'pop';
    };

    WifiApActivateScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, bandLabel + ' AP');

        var y = UI.STATUS_BAR_H + 3;
        var lineH = 9;

        if (state === 'confirm') {
            canvas.drawText('Activate ' + bandLabel + ' AP?', 4, y, '#fff');
            y += lineH;
            canvas.drawText('Profile: ' + connName, 4, y, '#888');
            y += lineH + 2;
            canvas.drawText('This will disconnect', 4, y, '#888');
            canvas.drawText('any current WiFi.', 4, y + lineH, '#888');

            var btnY = canvas.h - 11;
            var startLabel = '[Start]';
            var cancelLabel = '[Cancel]';
            if (buttonIndex === 0) {
                canvas.drawText(startLabel, 4, btnY, '#fff');
                canvas.drawText(cancelLabel, 4 + startLabel.length * 6 + 12, btnY, '#888');
            } else {
                canvas.drawText(startLabel, 4, btnY, '#888');
                canvas.drawText(cancelLabel, 4 + startLabel.length * 6 + 12, btnY, '#fff');
            }
            return;
        }

        if (state === 'activating') {
            canvas.drawText('Starting AP...', 4, y, '#fff');
            canvas.drawText('Please wait', 4, y + lineH, '#888');
            return;
        }

        if (state === 'active') {
            if (!pollTimer) {
                pollTimer = setInterval(fetchApStatus, 2000);
            }
            canvas.drawText('AP Active', 4, y, '#fff');
            y += lineH + 4;

            if (apInfo) {
                canvas.drawText('SSID', 4, y, '#888');
                y += lineH;
                canvas.drawText(' ' + (apInfo.ssid || '--'), 4, y, '#fff');
                y += lineH + 4;

                canvas.drawText('Password', 4, y, '#888');
                y += lineH;
                canvas.drawText(' ' + (apInfo.password || '--'), 4, y, '#fff');
                y += lineH + 4;

                canvas.drawText('Clients: ' + (apInfo.clients !== null ? apInfo.clients : '--'), 4, y, '#fff');
            }

            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        // fail
        canvas.drawText('AP activation failed', 4, y, '#fff');
        y += lineH;
        if (output) {
            var lines = output.split('\n');
            for (var i = 0; i < lines.length && i < 6; i++) {
                var line = lines[i];
                if (line.length > 42) line = line.substring(0, 40) + '..';
                canvas.drawText(line, 4, y, '#888');
                y += lineH;
            }
        }
        canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
    };

    return WifiApActivateScene;
})();
