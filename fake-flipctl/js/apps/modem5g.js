var Modem5gScene = (function() {
    var data = null;
    var loading = true;
    var error = false;
    var pollTimer = null;

    function fetchModem() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/modem', true);
        xhr.timeout = 2000;
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

    function techLabel(techs) {
        if (!techs || !techs.length) return '--';
        var labels = [];
        for (var i = 0; i < techs.length; i++) {
            var t = techs[i].toLowerCase().replace(/[\s-]/g, '');
            if (t === '5gnr') labels.push('5G');
            else if (t === 'lte') labels.push('LTE');
            else if (t === 'umts' || t === 'hspa' || t === 'hsdpa' || t === 'hsupa') labels.push('3G');
            else if (t === 'gsm' || t === 'gprs' || t === 'edge') labels.push('2G');
            else labels.push(t.toUpperCase());
        }
        return labels.join('+');
    }

    function signalBars(pct) {
        if (pct === null || pct === undefined || pct <= 0) return 0;
        if (pct >= 80) return 5;
        if (pct >= 60) return 4;
        if (pct >= 40) return 3;
        if (pct >= 20) return 2;
        return 1;
    }

    // Draw 5-bar signal icon, bottom-aligned
    // Each bar: 3px wide, 1px gap, heights 3/5/7/9/11
    function drawSignalIcon(canvas, x, y, bars) {
        var baseY = y + 11;
        var heights = [3, 5, 7, 9, 11];
        for (var i = 0; i < 5; i++) {
            var bx = x + i * 4;
            var h = heights[i];
            var by = baseY - h;
            if (i < bars) {
                canvas.drawRect(bx, by, 3, h, '#fff');
            } else {
                canvas.drawFrame(bx, by, 3, h, '#555');
            }
        }
    }

    function Modem5gScene() {}

    Modem5gScene.prototype.enter = function() {
        loading = true;
        error = false;
        data = null;
        fetchModem();
        pollTimer = setInterval(fetchModem, 500);
    };

    Modem5gScene.prototype.exit = function() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    };

    Modem5gScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
    };

    Modem5gScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, '5G Modem1');

        var y = UI.STATUS_BAR_H + 4;
        var lh = 10;

        if (loading && !data) {
            canvas.drawText('Loading...', 4, y, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        if ((error && !data) || !data || !data.available) {
            canvas.drawText('Modem not available', 4, y, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        // Row 1: Signal bars + operator + tech label (tall row)
        var bars = signalBars(data.signalQuality);
        drawSignalIcon(canvas, 4, y, bars);

        var operator = data.operator || 'Unknown';
        canvas.drawText(operator, 26, y + 3, '#fff');

        var tech = techLabel(data.accessTech);
        var techW = canvas.textWidth(tech);
        canvas.drawText(tech, canvas.w - 4 - techW, y + 3, '#fff');

        y += 16;

        // Row 2: Signal percentage + RSRP
        var sigStr = data.signalQuality !== null ? data.signalQuality + '%' : '--%';
        var sigLine = 'Signal: ' + sigStr;
        if (data.rsrp) sigLine += '  RSRP:' + data.rsrp;
        canvas.drawText(sigLine, 4, y, '#fff');
        y += lh;

        // Separator
        canvas.drawHLine(4, y, canvas.w - 8, '#555');
        y += 4;

        // Row 3: TAC + Cell ID
        var tac = data.tac || '--';
        var cid = data.cellId || '--';
        canvas.drawText('TAC:' + tac + ' CID:' + cid, 4, y, '#fff');
        y += lh;

        // Row 4: PLMN + PCI
        var plmn = (data.mcc && data.mnc) ? data.mcc + '/' + data.mnc : '--';
        var pci = data.pci ? data.pci : '--';
        canvas.drawText('PLMN:' + plmn + ' PCI:' + pci, 4, y, '#fff');
        y += lh;

        // Row 5: Band/EARFCN
        if (data.band) {
            canvas.drawText(data.band, 4, y, '#888');
        } else if (data.earfcn) {
            canvas.drawText('EARFCN:' + data.earfcn, 4, y, '#888');
        }
        y += lh;

        // Separator
        canvas.drawHLine(4, y, canvas.w - 8, '#555');
        y += 4;

        // Row 6: Modem model
        canvas.drawText(data.model || '--', 4, y, '#fff');
        y += lh;

        // Row 7: IP
        var ip = data.ip4 || '--';
        canvas.drawText('IP: ' + ip, 4, y, '#fff');
        y += lh;

        // Row 8: Bandwidth
        var dl = data.dlMbps !== null ? data.dlMbps + ' Mbit/s' : '-- Mbit/s';
        var ul = data.ulMbps !== null ? data.ulMbps + ' Mbit/s' : '-- Mbit/s';
        canvas.drawText('DL:' + dl + ' UL:' + ul, 4, y, '#fff');

        canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
    };

    return Modem5gScene;
})();
