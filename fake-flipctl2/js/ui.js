var UI = (function() {
    var STATUS_BAR_H = 13;
    var STATUS_BAR_PAD_TOP = 3;
    var ITEM_H = 12;
    var PAD_LEFT = 4;
    var SCROLLBAR_W = 3;

    var batteryLevel = -1;
    var batteryCharging = false;
    var modemAvailable = false;
    var signalQuality = -1;  // 0-100 or -1 for unknown
    var accessTech = '--';  // Technology: 5G, LTE, 3G, etc.
    var wifiConnected = false;
    var wifiQuality = 0;     // 0-100
    var wifiSSID = '';
    var ethernetConnected = false;

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

    function formatTech(techs) {
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

    function pollSignal() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/modem', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                modemAvailable = !!data.available;
                if (data.available && data.signalQuality !== null) {
                    signalQuality = data.signalQuality;
                }
                if (data.available && data.accessTech) {
                    accessTech = formatTech(data.accessTech);
                }
            }
        };
        xhr.onerror = xhr.ontimeout = function() { modemAvailable = false; };
        xhr.send();
    }

    function pollEthernet() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/ethernet', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status !== 200) return;
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
            // /api/ethernet returns an array of interfaces; connected if any
            // interface state contains "connected" but not "disconnected".
            var connected = false;
            if (Array.isArray(data)) {
                for (var i = 0; i < data.length; i++) {
                    var s = data[i] && data[i].state;
                    if (s && s.indexOf('connected') !== -1 && s.indexOf('disconnected') === -1) {
                        connected = true;
                        break;
                    }
                }
            }
            ethernetConnected = connected;
        };
        xhr.send();
    }

    function pollWifi() {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/wifi', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status !== 200) return;
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
            wifiConnected = !!data.connected;
            wifiQuality = typeof data.quality === 'number' ? data.quality : 0;
            wifiSSID = typeof data.ssid === 'string' ? data.ssid : '';
        };
        xhr.send();
    }

    function getWifiInfo() {
        return { connected: wifiConnected, quality: wifiQuality, ssid: wifiSSID };
    }

    function wifiIcon(quality) {
        // Map quality (0-100) to the five icon variants.
        if (quality >= 80) return Icons.wifi_100;
        if (quality >= 60) return Icons.wifi_75;
        if (quality >= 40) return Icons.wifi_50;
        if (quality >= 20) return Icons.wifi_25;
        return Icons.wifi_0;
    }

    // Poll battery every 5 seconds
    pollBattery();
    setInterval(pollBattery, 5000);

    // Poll signal quality every 1 second
    pollSignal();
    setInterval(pollSignal, 1000);

    // Poll wifi every 2 seconds
    pollWifi();
    setInterval(pollWifi, 2000);

    // Poll ethernet every 2 seconds
    pollEthernet();
    setInterval(pollEthernet, 2000);

    function formatDateTime() {
        var now = new Date();
        var hours = String(now.getHours()).padStart(2, '0');
        var minutes = String(now.getMinutes()).padStart(2, '0');
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var month = months[now.getMonth()];
        var day = String(now.getDate()).padStart(2, '0');
        return hours + ':' + minutes + ' ' + month + ' ' + day;
    }

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

    function drawSignalBars(canvas, x, topY, quality) {
        // 5 signal bars: heights 3, 4, 5, 6, 7 from left to right.
        // `topY` is where the TOP of the tallest bar sits; shorter bars
        // share the same bottom as the tallest.
        var heights = [3, 4, 5, 6, 7];
        var tallest = 7;
        var barX = x;
        var barBottom = topY + tallest;

        var filledBars = 0;
        if (quality >= 0) {
            filledBars = Math.ceil((quality / 100) * 5);
        }

        for (var i = 0; i < 5; i++) {
            var h = heights[i];
            var barY = barBottom - h;
            // Filled bars use the foreground (white on black bar); empty
            // bars keep '#ccc' — the "shade" tone carried over from the
            // light-mode bar design.
            var color = (i < filledBars) ? '#fff' : '#ccc';
            canvas.drawRect(barX, barY, 1, h, color);
            barX += 2;  // 1px bar + 1px gap
        }
    }

    function drawStatusBar(canvas, title) {
        // Black bar background. All foreground elements sit at
        // STATUS_BAR_PAD_TOP (3px) from the top edge.
        canvas.drawRect(0, 0, canvas.w, STATUS_BAR_H, '#000');
        var top = STATUS_BAR_PAD_TOP;

        canvas.drawText(title, PAD_LEFT, top, '#fff');

        // Left-side network indicators are laid out left-to-right, only
        // showing elements whose underlying interface is present.
        var leftX = 2;
        if (modemAvailable) {
            drawSignalBars(canvas, leftX, top, signalQuality);
            leftX += 10;  // 5 bars × 1px + 4 gaps × 1px + 1px trailing gap
            HaxrcorpFont16.draw(canvas.ctx, accessTech, leftX, top, '#fff');
            leftX += HaxrcorpFont16.textWidth(accessTech) + 2;
        }
        if (wifiConnected) {
            canvas.drawSprite(wifiIcon(wifiQuality), leftX, top, '#fff');
            leftX += 7 + 2;  // wifi is 7px wide + 2px gap
        }
        if (ethernetConnected) {
            canvas.drawSprite(Icons.ethernet_statusbar, leftX, top, '#fff');
            leftX += Icons.ethernet_statusbar.w + 2;
        }

        // Battery sprite (16x9) + percentage, right-aligned.
        var pctStr = batteryLevel >= 0 ? batteryLevel + '%' : '--%';
        var batteryW = StatusBarBattery.sprite.w;
        var batteryX = canvas.w - 2 - batteryW;
        // Right-align so the last glyph ends 1px left of the battery icon,
        // using the font's actual pixel width (not a 6px-per-char estimate).
        var textX = batteryX - 1 - HaxrcorpFont16.textWidth(pctStr);

        HaxrcorpFont16.draw(canvas.ctx, pctStr, textX, top - 2, '#fff');
        var batteryY = top - 1;
        canvas.drawSprite(StatusBarBattery.sprite, batteryX, batteryY, '#fff');

        // Battery level bar inside the sprite — offset kept constant
        // relative to the sprite's top-left.
        var barMaxWidth = 10;
        var barHeight = 5;
        var barX = 240;
        var barY = top + 1;  // 2px from sprite top (sprite now at top-1)
        var barWidth = Math.round((barMaxWidth * Math.max(0, batteryLevel)) / 100);

        if (barWidth > 0) {
            canvas.drawRect(barX, barY, barWidth, barHeight, '#fff');
        }

        // Charging bolt overlays the battery icon flush with its
        // left/top edge. Rendered literally so black stays black, white
        // stays white, and transparent lets the battery sprite show
        // through.
        if (batteryCharging) {
            canvas.drawSpriteLiteral(Icons.charging_status_bar, batteryX, batteryY);
        }
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
            render:  function(canvas) { canvas[drawMethod](this.text, this.x, this.w, this.pressed, this.disabled); },
            press:   function() { if (!this.disabled) this.pressed = true; },
            release: function() { this.pressed = false; }
        };
    }

    // index — slot position (0..N-1), gap — px between buttons
    function MiddleButton(text, index, w, gap, action, onPress) {
        this.text    = text;
        this.x       = index * (w + gap);
        this.w       = w;
        this.pressed = false;
        this.disabled = false;
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
        this.disabled = false;
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
        this.disabled = false;
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
        this.pressedIndex = -1;  // Track which item is pressed
        this.onSelect = onSelect || null;
        this.onClose = onClose || null;

        // Calculate body width: longest item text + left/right padding (7px each)
        var maxItemWidth = 0;
        for (var i = 0; i < items.length; i++) {
            var w = HaxrcorpFont16.textWidth(items[i]);
            if (w > maxItemWidth) maxItemWidth = w;
        }
        var contentWidth = maxItemWidth + 7 + 7;  // 7px left + 7px right padding
        var minWidth = tabW + 5;  // button width + 5px padding
        this.bodyW = Math.max(contentWidth, minWidth);

        // Calculate body height: items + top/bottom padding
        this.bodyH = items.length * POPUP_ITEM_H + 2 * POPUP_PAD;

        // Position: left-aligned with button, 4px above bottom (where tab sits)
        this.x = btnX;
        this.y = 144 - 14 - this.bodyH - 4;  // 144px screen height, 14px tab, 4px gap
    }

    PopupMenuLeft.prototype.render = function(canvas) {
        // Draw shell (body + tab)
        canvas.drawPopupLeft(this.x, this.y, this.bodyW, this.bodyH, this.tabW, '#fff', '#D0D0D0', '#000');

        // Draw menu items
        for (var i = 0; i < this.items.length; i++) {
            var iy = this.y + POPUP_PAD + i * POPUP_ITEM_H;

            // Draw selection highlight (not when pressed)
            if (i === this.selIndex && i !== this.pressedIndex) {
                canvas.drawRoundFrame(this.x + POPUP_PAD, iy, this.bodyW - 2 * POPUP_PAD, POPUP_ITEM_H, 2, '#000');
            }

            // Draw pressed highlight (inverted - black background with white text)
            if (i === this.pressedIndex) {
                canvas.drawRoundRect(this.x + POPUP_PAD, iy, this.bodyW - 2 * POPUP_PAD, POPUP_ITEM_H, 2, '#000');
            }

            // Draw item text (4px + 3px padding from left edge)
            var textColor = (i === this.pressedIndex) ? '#fff' : '#000';
            HaxrcorpFont16.draw(canvas.ctx, this.items[i], this.x + 7, iy + 1, textColor);
        }

        // Draw tab label (button text — centered in tab)
        var tw = HaxrcorpFont16.textWidth(this.btnText);
        var ttx = this.x + Math.floor((this.tabW - tw) / 2);
        var tty = this.y + this.bodyH + Math.floor((17 - 11) / 2);
        HaxrcorpFont16.draw(canvas.ctx, this.btnText, ttx, tty, '#000');
    };

    PopupMenuLeft.prototype.handleInput = function(action) {
        var self = this;
        if (action === 'up') {
            this.selIndex = (this.selIndex - 1 + this.items.length) % this.items.length;
        } else if (action === 'down') {
            this.selIndex = (this.selIndex + 1) % this.items.length;
        } else if (action === 'ok') {
            // Show pressed feedback
            this.pressedIndex = this.selIndex;
            // Call onSelect after feedback delay
            setTimeout(function() {
                if (self.onSelect) self.onSelect(self.selIndex);
                self.pressedIndex = -1;
            }, 150);
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

    // ── TabHeader ─────────────────────────────────────────────────────────────
    // Tab header above main input box with rounded top corners (r=4)
    // x coincides with TextInputBox (x=6)
    // Black background with white text
    function TabHeader(text) {
        this.x = 6;
        this.y = 3;          // 3px from top
        this.text = text || '';
        this.h = 16;         // Height of tab
        // Width: text width + 3px padding on each side
        this.w = HaxrcorpFont16.textWidth(this.text) + 6;
    }

    TabHeader.prototype.render = function(canvas) {
        // Draw black background with rounded top corners
        canvas.drawTabHeader(this.x, this.y, this.w, this.h);
        // Draw white text (centered vertically)
        var textY = this.y + Math.floor((this.h - 11) / 2);  // 11 is font height
        HaxrcorpFont16.draw(canvas.ctx, this.text, this.x + 3, textY, '#fff');
    };

    // ── TextInputBox ──────────────────────────────────────────────────────
    // Container for text input with rounded top corners
    // Positioned 16px from top, extends to keyboard at 70px
    // Height: 54px, Width: 244px (256 - 6px padding left - 6px padding right)
    function TextInputBox() {
        this.x = 6;
        this.y = 16;
        this.w = 244;  // 256 - 12 (6px padding each side)
        this.h = 54;  // 70 - 16
    }

    TextInputBox.prototype.render = function(canvas) {
        canvas.drawTextInputBox(this.x, this.y, this.w, this.h, '#fff', '#000');
    };

    // ── InputField ────────────────────────────────────────────────────────────
    // Input field with rounded corners (r=3)
    // Height: 14px, positioned inside TextInputBox with padding
    function InputField() {
        this.x = 22;         // 6px screen padding + 6px box padding + 10px field padding
        this.y = 26;         // Inside TextInputBox (starts at 16) with 10px padding
        this.w = 212;        // 244 (box width) - 6px left padding - 6px right padding - 10px left - 10px right
        this.h = 14;
    }

    InputField.prototype.render = function(canvas) {
        canvas.drawInputField(this.x, this.y, this.w, this.h, 3, '#fff', '#000');
    };

    // ── DeleteConfirmDialog ────────────────────────────────────────────────────
    // Modal dialog for confirming profile deletion or reset
    function DeleteConfirmDialog(profileName, onConfirm, onCancel, action) {
        this.profileName = profileName;
        this.onConfirm = onConfirm || null;
        this.onCancel = onCancel || null;
        this.action = action || 'Delete';  // 'Delete' or 'Reset to default'
    }

    DeleteConfirmDialog.prototype.render = function(canvas) {
        // Draw semi-transparent overlay
        canvas.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        canvas.ctx.fillRect(0, 0, canvas.w, canvas.h);

        // Draw modal box
        var boxW = 200;
        var boxH = 40;
        var boxX = Math.floor((canvas.w - boxW) / 2);
        var boxY = Math.floor((canvas.h - boxH) / 2);

        // White background
        canvas.drawRoundRect(boxX, boxY, boxW, boxH, 3, '#fff');
        // Black border
        canvas.drawRoundFrame(boxX, boxY, boxW, boxH, 3, '#000');

        // Draw text (centered)
        var messageText = this.action + ' "' + this.profileName + '"?';
        var messageWidth = HaxrcorpFont16.textWidth(messageText);
        var messageX = boxX + Math.floor((boxW - messageWidth) / 2);
        var messageY = boxY + Math.floor((boxH - 11) / 2);
        HaxrcorpFont16.draw(canvas.ctx, messageText, messageX, messageY, '#000');
    };

    DeleteConfirmDialog.prototype.handleInput = function(action) {
        // Handled by app-defined buttons (esc and run)
        if (action === 'esc') {
            if (this.onCancel) this.onCancel();
        } else if (action === 'run') {
            if (this.onConfirm) this.onConfirm();
        }
    };

    // ─── Scrollbar ───────────────────────────────────────────────────────────────
    function Scrollbar(totalItems, visibleItems, currentIndex) {
        this.totalItems = totalItems || 0;
        this.visibleItems = visibleItems || 1;
        this.currentIndex = currentIndex || 0;
    }

    Scrollbar.prototype.shouldShow = function() {
        return this.totalItems > this.visibleItems;
    };

    Scrollbar.prototype.render = function(canvas, x, y, height, thumbPad) {
        if (!this.shouldShow()) return;

        thumbPad = thumbPad || 0;

        // Dotted base line fills the full (y, height) range.
        for (var i = 0; i < height; i += 2) {
            canvas.drawPixel(x, y + i, '#000');
        }

        // Thumb is inset from both ends of the dotted line by `thumbPad`
        // so it never touches the extremes — useful when the bar sits
        // close to another UI element (e.g. the status bar).
        var thumbRange = height - 2 * thumbPad;
        if (thumbRange < 5) thumbRange = 5;
        var thumbHeight = Math.max(5, Math.round(thumbRange * this.visibleItems / this.totalItems));
        var maxScroll = this.totalItems - this.visibleItems;
        var scrollRatio = maxScroll > 0 ? this.currentIndex / maxScroll : 0;
        var thumbY = y + thumbPad + Math.round((thumbRange - thumbHeight) * scrollRatio);

        // Draw thumb (3 pixels wide) centered on the dotted line.
        canvas.drawRect(x - 1, thumbY, 3, thumbHeight, '#000');
    };

    Scrollbar.prototype.update = function(totalItems, visibleItems, currentIndex) {
        this.totalItems = totalItems;
        this.visibleItems = visibleItems;
        this.currentIndex = currentIndex;
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
        TabHeader:      TabHeader,
        TextInputBox:   TextInputBox,
        InputField:     InputField,
        DeleteConfirmDialog: DeleteConfirmDialog,
        Scrollbar:      Scrollbar,
        getWifiInfo:    getWifiInfo,
        STATUS_BAR_H:   STATUS_BAR_H,
        ITEM_H:         ITEM_H,
        PAD_LEFT:       PAD_LEFT
    };
})();
