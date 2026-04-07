var UI = (function() {
    var STATUS_BAR_H = 11;
    var ITEM_H = 12;
    var PAD_LEFT = 4;
    var SCROLLBAR_W = 3;

    var batteryLevel = -1;
    var batteryCharging = false;

    function pollBattery() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/power', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                if (data.available && data.capacity !== null) {
                    batteryLevel = data.capacity;
                }
                batteryCharging = (data.status === 'Charging' || data.status === 'Full');
            }
        };
        xhr.send();
    }

    // Poll battery every 5 seconds
    pollBattery();
    setInterval(pollBattery, 5000);

    function drawBattery(canvas, x, y, pct) {
        // Battery body: 9x5 outline
        canvas.drawFrame(x, y, 9, 5, '#000');
        // Nub on right: 1x3
        canvas.drawRect(x + 9, y + 1, 1, 3, '#000');
        // Fill: max 5px wide inside body
        var fillW = Math.round(5 * (pct / 100));
        if (fillW > 0) {
            canvas.drawRect(x + 2, y + 2, fillW, 1, '#000');
        }
    }

    function drawPlugIcon(canvas, x, y) {
        // Small power plug icon 5x7 in black on white status bar
        // Prongs
        canvas.drawRect(x + 1, y, 1, 2, '#000');
        canvas.drawRect(x + 3, y, 1, 2, '#000');
        // Body
        canvas.drawRect(x, y + 2, 5, 3, '#000');
        // Cord
        canvas.drawRect(x + 2, y + 5, 1, 2, '#000');
    }

    function drawStatusBar(canvas, title) {
        canvas.drawRect(0, 0, canvas.w, STATUS_BAR_H, '#fff');
        canvas.drawText(title, PAD_LEFT, 2, '#000');

        // Battery icon + percentage + optional plug, right-aligned
        var pctStr = batteryLevel >= 0 ? batteryLevel + '%' : '--%';
        var iconW = 10;
        var iconX = canvas.w - 2 - iconW;
        var textX = iconX - 2 - (pctStr.length * 6);

        if (batteryCharging) {
            var plugX = textX - 7;
            drawPlugIcon(canvas, plugX, 2);
        }

        canvas.drawText(pctStr, textX, 2, '#000');
        drawBattery(canvas, iconX, 3, Math.max(0, batteryLevel));

        canvas.drawHLine(0, STATUS_BAR_H, canvas.w, '#888');
    }

    function drawMenuList(canvas, items, selectedIndex, scrollOffset) {
        var startY = STATUS_BAR_H + 2;
        var visible = visibleCount(canvas.h);

        for (var i = 0; i < visible && (i + scrollOffset) < items.length; i++) {
            var idx = i + scrollOffset;
            var y = startY + i * ITEM_H;

            if (idx === selectedIndex) {
                canvas.drawRect(0, y, canvas.w - SCROLLBAR_W - 1, ITEM_H, '#fff');
                canvas.drawText('>' + items[idx], PAD_LEFT, y + 3, '#000');
            } else {
                canvas.drawText(' ' + items[idx], PAD_LEFT, y + 3, '#fff');
            }
        }

        if (items.length > visible) {
            drawScrollbar(canvas, items.length, visible, scrollOffset);
        }
    }

    function drawScrollbar(canvas, totalItems, visibleItems, scrollOffset) {
        var trackX = canvas.w - SCROLLBAR_W;
        var trackY = STATUS_BAR_H + 2;
        var trackH = canvas.h - trackY;

        canvas.drawRect(trackX, trackY, SCROLLBAR_W, trackH, '#333');

        var thumbH = Math.max(8, Math.floor(trackH * (visibleItems / totalItems)));
        var maxOffset = totalItems - visibleItems;
        var thumbY = trackY + (maxOffset > 0 ? Math.floor((trackH - thumbH) * (scrollOffset / maxOffset)) : 0);

        canvas.drawRect(trackX, thumbY, SCROLLBAR_W, thumbH, '#fff');
    }

    function visibleCount(canvasHeight) {
        return Math.floor((canvasHeight - STATUS_BAR_H - 2) / ITEM_H);
    }

    // ── MiddleButton ──────────────────────────────────────────────────────────
    // Button flush with bottom of screen. Rendering is in canvas.drawMiddleButton.
    function _makeButton(drawMethod) {
        return {
            render:  function(canvas) { canvas[drawMethod](this.text, this.x, this.w, this.pressed); },
            press:   function() { this.pressed = true; },
            release: function() { this.pressed = false; }
        };
    }

    // index — slot position (0..N-1), gap — px between buttons
    function MiddleButton(text, index, w, gap, action, onPress) {
        this.text    = text;
        this.x       = index * (w + gap);
        this.w       = w;
        this.pressed = false;
        this.action  = action  || null;
        this.onPress = onPress || null;
    }
    MiddleButton.prototype = _makeButton('drawMiddleButton');

    // Left button — always flush with left screen edge (x = 0)
    function LeftButton(text, w, action, onPress) {
        this.text    = text;
        this.x       = 0;
        this.w       = w;
        this.pressed = false;
        this.action  = action  || null;
        this.onPress = onPress || null;
    }
    LeftButton.prototype = _makeButton('drawLeftButton');

    // Right button — always flush with right screen edge (x = screenW - w)
    function RightButton(text, w, action, onPress, screenW) {
        this.text    = text;
        this.x       = (screenW || 256) - w;
        this.w       = w;
        this.pressed = false;
        this.action  = action  || null;
        this.onPress = onPress || null;
    }
    RightButton.prototype = _makeButton('drawRightButton');

    return {
        drawStatusBar:  drawStatusBar,
        drawMenuList:   drawMenuList,
        visibleCount:   visibleCount,
        MiddleButton:   MiddleButton,
        LeftButton:     LeftButton,
        RightButton:    RightButton,
        STATUS_BAR_H:   STATUS_BAR_H,
        ITEM_H:         ITEM_H,
        PAD_LEFT:       PAD_LEFT
    };
})();
