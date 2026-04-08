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

    // ── PopupMenuLeft ────────────────────────────────────────────────────────
    // Popup menu that appears above a button, replacing it with a tab.
    // items    — array of label strings
    // btnX     — left edge x position of the trigger button
    // tabW     — width of the tab (button width, e.g., 48px)
    // btnText  — fixed text for the tab (e.g., 'Edit')
    // onSelect(index) — called when the user confirms a selection
    // onClose()       — called when the popup is dismissed (esc / back)

    var POPUP_ITEM_H = 13;  // px per menu item
    var POPUP_PAD = 3;      // left/right/top/bottom padding inside body

    function PopupMenuLeft(items, btnX, tabW, btnText, onSelect, onClose) {
        this.items = items;
        this.btnX = btnX;
        this.tabW = tabW;
        this.btnText = btnText;  // fixed button text for the tab
        this.selIndex = 0;
        this.onSelect = onSelect || null;
        this.onClose = onClose || null;

        // Calculate body width: longest item text + left/right padding (7px each)
        var maxItemWidth = 0;
        for (var i = 0; i < items.length; i++) {
            var w = HaxrcorpFont16.textWidth(items[i]);
            if (w > maxItemWidth) maxItemWidth = w;
        }
        this.bodyW = maxItemWidth + 7 + 7;  // 7px left + 7px right padding

        // Calculate body height: items + top/bottom padding
        this.bodyH = items.length * POPUP_ITEM_H + 2 * POPUP_PAD;

        // Position: left-aligned with button, 4px above bottom (where tab sits)
        this.x = btnX;
        this.y = 144 - 17 - this.bodyH - 4;  // 144px screen height, 17px tab, 4px gap
    }

    PopupMenuLeft.prototype.render = function(canvas) {
        // Draw shell (body + tab)
        canvas.drawPopupLeft(this.x, this.y, this.bodyW, this.bodyH, this.tabW, '#fff', '#D0D0D0', '#000');

        // Draw menu items
        for (var i = 0; i < this.items.length; i++) {
            var iy = this.y + POPUP_PAD + i * POPUP_ITEM_H;

            // Draw selection highlight
            if (i === this.selIndex) {
                canvas.drawRoundFrame(this.x + POPUP_PAD, iy, this.bodyW - 2 * POPUP_PAD, POPUP_ITEM_H, 2, '#000');
            }

            // Draw item text (4px + 3px padding from left edge)
            HaxrcorpFont16.draw(canvas.ctx, this.items[i], this.x + 7, iy + 1, '#000');
        }

        // Draw tab label (button text — centered in tab)
        var tw = HaxrcorpFont16.textWidth(this.btnText);
        var ttx = this.x + Math.floor((this.tabW - tw) / 2);
        var tty = this.y + this.bodyH + Math.floor((17 - 11) / 2);
        HaxrcorpFont16.draw(canvas.ctx, this.btnText, ttx, tty, '#000');
    };

    PopupMenuLeft.prototype.handleInput = function(action) {
        if (action === 'up') {
            this.selIndex = (this.selIndex - 1 + this.items.length) % this.items.length;
        } else if (action === 'down') {
            this.selIndex = (this.selIndex + 1) % this.items.length;
        } else if (action === 'ok') {
            if (this.onSelect) this.onSelect(this.selIndex);
        } else if (action === 'esc' || action === 'back') {
            if (this.onClose) this.onClose();
        }
    };

    // ── Keyboard ──────────────────────────────────────────────────────────────
    // Virtual keyboard popup with multiple rows
    function Keyboard(rows, onChar, onClose) {
        this.rows = rows;
        this.selectedRow = 0;
        this.selectedCol = 0;
        this.onChar = onChar || null;   // Called with character when ok pressed
        this.onClose = onClose || null; // Called when esc pressed
        this.pressedRow = -1;
        this.pressedCol = -1;  // Track which button is pressed

        // Position: centered on screen in container
        var BTN_W = 15;
        var BTN_H = 16;
        var CONTAINER_W = 250;
        var CONTAINER_H = 77;
        var cols = rows[0].length;
        var keyboardW = cols * BTN_W;
        var keyboardH = rows.length * BTN_H;

        this.x = Math.floor((256 - CONTAINER_W) / 2);
        this.y = 70;  // 70px from top of screen
        this.w = CONTAINER_W;
        this.h = CONTAINER_H;
    }

    Keyboard.prototype.render = function(canvas) {
        canvas.drawKeyboard(this.x, this.y, this.rows, this.selectedRow, this.selectedCol, this.pressedRow, this.pressedCol, '#fff', '#000');
    };

    Keyboard.prototype.handleInput = function(action) {
        if (action === 'left') {
            this.selectedCol = (this.selectedCol - 1 + this.rows[this.selectedRow].length) % this.rows[this.selectedRow].length;
        } else if (action === 'right') {
            this.selectedCol = (this.selectedCol + 1) % this.rows[this.selectedRow].length;
        } else if (action === 'up') {
            this.selectedRow = (this.selectedRow - 1 + this.rows.length) % this.rows.length;
            // Adjust column if new row is shorter
            if (this.selectedCol >= this.rows[this.selectedRow].length) {
                this.selectedCol = this.rows[this.selectedRow].length - 1;
            }
        } else if (action === 'down') {
            this.selectedRow = (this.selectedRow + 1) % this.rows.length;
            // Adjust column if new row is shorter
            if (this.selectedCol >= this.rows[this.selectedRow].length) {
                this.selectedCol = this.rows[this.selectedRow].length - 1;
            }
        } else if (action === 'ok') {
            var char = this.rows[this.selectedRow][this.selectedCol];
            this.pressedRow = this.selectedRow;
            this.pressedCol = this.selectedCol;
            if (this.onChar) this.onChar(char);
            var self = this;
            setTimeout(function() {
                self.pressedRow = -1;
                self.pressedCol = -1;
            }, 100);
        } else if (action === 'back') {
            // Back key deletes character (backspace)
            if (this.onChar) this.onChar('\b');
        } else if (action === 'esc') {
            if (this.onClose) this.onClose();
        }
    };

    return {
        drawStatusBar:  drawStatusBar,
        drawMenuList:   drawMenuList,
        visibleCount:   visibleCount,
        MiddleButton:   MiddleButton,
        LeftButton:     LeftButton,
        RightButton:    RightButton,
        PopupMenuLeft:  PopupMenuLeft,
        Keyboard:       Keyboard,
        STATUS_BAR_H:   STATUS_BAR_H,
        ITEM_H:         ITEM_H,
        PAD_LEFT:       PAD_LEFT
    };
})();
