var UIDemoScene = (function() {
    var FONT_H   = 11;
    var PAD_X    = 6;
    var PAD_Y    = 1;
    var RADIUS   = 2;
    var COLOR_DIM = '#EAEAEA';  // shade of white for unselected items
    var ITEM_W   = 240;  // Menu item width
    var ITEM_H   = 20;   // Menu item height

    var STATE_DEFAULT  = 'default';
    var STATE_SELECTED = 'selected';
    var STATE_PRESSED  = 'pressed';

    function MenuItem(text, isUserCreated, icon, isLast) {
        this.text  = text;
        this.w     = ITEM_W;
        this.state = STATE_DEFAULT;
        this.isUserCreated = isUserCreated || false;  // true if created by user, false if default
        this.icon = icon || null;  // Icon to display next to text
        this.isLast = isLast || false;  // Last item has different styling

        // Set height based on position
        if (isLast) {
            this.h = ITEM_H_LAST;  // 18px, no line
        } else {
            this.h = ITEM_H_REGULAR;  // 19px, with bottom line
        }
    }

    MenuItem.prototype.render = function(canvas, x, y) {
        var textColor = '#000';
        var iconColor = '#000';

        if (this.state === STATE_DEFAULT) {
            // Draw gray separator line at the bottom (only for non-last items)
            // Line is 2px shorter on each side
            if (!this.isLast) {
                canvas.drawHLine(x + 2, y + this.h - 1, this.w - 4, '#EDEDED');
            }
            textColor = '#000';
            iconColor = '#000';
        } else if (this.state === STATE_SELECTED) {
            // Rounded rectangle with black frame (1px higher to cover line above)
            canvas.drawRoundFrame(x, y - 1, this.w, this.h + 1, RADIUS, '#000');
            textColor = '#000';
            iconColor = '#000';
        } else if (this.state === STATE_PRESSED) {
            // Rounded rectangle filled with black (1px higher to cover line above)
            canvas.drawRoundRect(x, y - 1, this.w, this.h + 1, RADIUS, '#000');
            textColor = '#fff';
            iconColor = '#fff';
        }

        // Center text and icon vertically within the item height
        var verticalPadding = Math.floor((this.h - FONT_H) / 2);

        // Draw icon if available (14x14 pixels)
        if (this.icon) {
            var iconX = x + PAD_X;
            var iconY = y + Math.floor((this.h - this.icon.h) / 2);  // Center vertically
            // Grayscale icons go through drawSprite; binary ones
            // through drawIcon (same convention MenuLine uses). The
            // `media` icon is now 6-bit grayscale, so this branch
            // matters — drawIcon would misread its packed data.
            if (this.icon.grayscale) {
                canvas.drawSprite(this.icon, iconX, iconY, iconColor);
            } else {
                canvas.drawIcon(this.icon, iconX, iconY, iconColor);
            }
        }

        // Draw text (offset if icon is present)
        var textX = this.icon ? x + PAD_X + 14 + 4 : x + PAD_X;  // 14px icon + 4px gap
        var textY = y + verticalPadding;
        HaxrCorp4090FlipCTL.draw(canvas.ctx, this.text, textX, textY, textColor);
    };

    // ---

    var ITEM_SPACING = 0;  // No spacing between items
    var ITEM_H_REGULAR = 19;  // Regular items height (with bottom line)
    var ITEM_H_LAST = 18;     // Last item height (no line)
    var BTN_W   = 48;
    var BTN_GAP = 2;  // 5 × 48 + 4 × 4 = 256px exactly

    function UIDemoScene(sceneManager) {
        this.sceneManager = sceneManager;
        this.items = [
            new MenuItem('Router', false, Icons.router, false),
            new MenuItem('TV Media Box', false, Icons.media, false),
            new MenuItem('Desktop Computer', false, Icons.desktop, false),
            new MenuItem('Minimal system', false, Icons.minimal, false),
            new MenuItem('Boot from SD card', false, Icons.sdcard, true)  // true = last item
        ];
        this.selectedIndex = 0;
        this.items[this.selectedIndex].state = STATE_SELECTED;
        this.popup = null;  // active PopupMenuLeft, or null
        this.popupClosing = false;  // Show Close button feedback while closing
        this.clonePopup = null;  // Popup for clone option
        this.clonePopupClosing = false;
        this.selectedItemForClone = null;  // Currently selected menu item for cloning
        this.keyboard = null;  // active Keyboard, or null
        this.keyboardClosing = false;  // Show Close button feedback while closing keyboard
        this.inputText = '';  // Text entered via keyboard
        this.cursor = null;  // Blinking cursor for text input
        this.tabHeader = null;  // TabHeader for keyboard
        this.textInputBox = null;  // TextInputBox when keyboard is open
        this.inputField = null;  // InputField for text entry
        this.deleteConfirmDialog = null;  // Delete confirmation dialog
        this.resetConfirmDialog = null;  // Reset to default confirmation dialog
        this._renamingItem = null;  // Track which item we're renaming
        this._inputError = '';  // Error message for input field
        this.scrollbar = null;  // Scrollbar for menu items
        this.viewportStartIndex = 0;  // First visible item in menu

        // Default profile names mapping
        this.defaultProfiles = {
            'Router': { icon: Icons.router },
            'TV Media Box': { icon: Icons.media },
            'Desktop Computer': { icon: Icons.desktop },
            'Minimal system': { icon: Icons.minimal },
            'Boot from SD card': { icon: Icons.sdcard }
        };

        // ── App-defined buttons ───────────────────────────────────────────────
        // Each button maps to an input action (see input.js KEY_MAP).
        // Pressing the key triggers the button animation + onPress callback.
        var self = this;
        var editBtn = new UI.MiddleButton('Edit', 1, BTN_W, BTN_GAP, 'edit', function() { self._onEdit(); });
        this._editBtn = editBtn;
        var closeBtn = new UI.LeftButton('Cancel', BTN_W, 'esc', function() { /* dialog/popup handles esc */ });
        this._closeBtn = closeBtn;
        var deleteBtn = new UI.RightButton('Delete', BTN_W, 'run', function() { /* dialog handles run */ });
        this._deleteBtn = deleteBtn;
        var resetBtn = new UI.RightButton('Reset', BTN_W, 'run', function() { /* dialog handles run */ });
        this._resetBtn = resetBtn;
        var saveBtn = new UI.RightButton('Save', BTN_W, 'ok', function() { self._onSave(); });
        this._saveBtn = saveBtn;
        this.app_defined_buttons = [
            new UI.LeftButton  ('OFF',   BTN_W,             'esc',   function() { self._onEsc();  }),
            editBtn,
            null,
            null,
            new UI.RightButton ('Run',   BTN_W,             'run',   function() { self._onRun();  }),
        ];

        // Build action → button lookup
        this.btnActionMap = {};
        for (var i = 0; i < this.app_defined_buttons.length; i++) {
            var btn = this.app_defined_buttons[i];
            if (btn && btn.action) this.btnActionMap[btn.action] = btn;
        }
    }

    // ── Button handlers ───────────────────────────────────────────────────────
    UIDemoScene.prototype._onEsc   = function() {
        if (this.sceneManager) {
            this.sceneManager.popToRoot();
        }
    };
    UIDemoScene.prototype._onSave  = function() {
        if (this.keyboard && this.inputText) {
            // Don't save if there's an error
            if (this._inputError) {
                return;
            }

            if (this._renamingItem) {
                // Rename existing profile
                this._renamingItem.text = this.inputText;
                this._renamingItem = null;
            } else {
                // Create new profile with the entered name
                // Final check: ensure name is unique
                if (this.items.some(function(item) { return item.text === this.inputText; }.bind(this))) {
                    // Name already exists, don't save
                    this._inputError = 'Name already exist';
                    return;
                }

                // Use icon from the cloned profile (selectedItemForClone)
                var icon = this.selectedItemForClone ? this.selectedItemForClone.icon : null;
                var newItem = new MenuItem(this.inputText, true, icon, false);  // true = user created
                this.items.push(newItem);
            }

            // Close keyboard
            this.keyboard = null;
            this.cursor = null;
            this.tabHeader = null;
            this.textInputBox = null;
            this.inputField = null;
            this.selectedItemForClone = null;
            this.inputText = '';
            this._inputError = '';
        }
    };
    UIDemoScene.prototype._onEdit  = function() {
        // Edit button shows different popup based on profile type
        var self = this;
        var selectedItem = this.items[this.selectedIndex];

        this.selectedItemForClone = selectedItem;

        // Different popup options for user-created vs default profiles
        var popupItems = selectedItem.isUserCreated
            ? ['Delete', 'Rename', 'Clone']
            : ['Clone', 'Reset to default'];

        this.clonePopup = new UI.PopupMenuLeft(
            popupItems,
            this._editBtn.x,  // btnX (position of Edit button)
            BTN_W,            // tabW (width of tab)
            'Edit',
            function(index) {
                // Handle selection based on profile type
                if (selectedItem.isUserCreated) {
                    // User-created profile options
                    if (index === 0) {
                        // Delete - show confirmation dialog
                        self.clonePopup = null;
                        self.deleteConfirmDialog = new UI.DeleteConfirmDialog(
                            selectedItem.text,
                            function() {
                                // Confirm delete
                                var idx = self.items.indexOf(selectedItem);
                                if (idx > -1) {
                                    self.items.splice(idx, 1);
                                    // Fix selection if needed
                                    if (self.selectedIndex >= self.items.length) {
                                        self.selectedIndex = self.items.length - 1;
                                    }
                                    // Update selected state
                                    for (var i = 0; i < self.items.length; i++) {
                                        self.items[i].state = (i === self.selectedIndex) ? STATE_SELECTED : STATE_DEFAULT;
                                    }

                                    // Adjust viewport to keep selected item visible
                                    var itemHeight = self.items[0] ? self.items[0].h + ITEM_SPACING : 19;
                                    var startY = 20;
                                    var scrollableHeight = (144 - 14) - startY;
                                    var visibleItems = Math.floor(scrollableHeight / itemHeight);

                                    if (self.selectedIndex < self.viewportStartIndex) {
                                        // Selected item is above viewport, scroll up
                                        self.viewportStartIndex = self.selectedIndex;
                                    } else if (self.selectedIndex >= self.viewportStartIndex + visibleItems) {
                                        // Selected item is below viewport, scroll down
                                        self.viewportStartIndex = self.selectedIndex - visibleItems + 1;
                                    }

                                    // Ensure viewport doesn't go past the end
                                    if (self.viewportStartIndex < 0) {
                                        self.viewportStartIndex = 0;
                                    }
                                    var maxViewportStart = Math.max(0, self.items.length - visibleItems);
                                    if (self.viewportStartIndex > maxViewportStart) {
                                        self.viewportStartIndex = maxViewportStart;
                                    }
                                }
                                self.deleteConfirmDialog = null;
                            },
                            function() {
                                // Cancel delete
                                self.deleteConfirmDialog = null;
                            }
                        );
                    } else if (index === 1) {
                        // Rename
                        self.inputText = selectedItem.text;
                        self._openKeyboardForRename(selectedItem);
                        self.clonePopup = null;
                    } else if (index === 2) {
                        // Clone
                        self._openKeyboardForClone(selectedItem);
                        self.clonePopup = null;
                    }
                } else {
                    // Default profile - Clone and Reset to default options
                    if (index === 0) {
                        // Clone
                        self._openKeyboardForClone(selectedItem);
                        self.clonePopup = null;
                    } else if (index === 1) {
                        // Reset to default
                        self.clonePopup = null;
                        self.resetConfirmDialog = new UI.DeleteConfirmDialog(
                            selectedItem.text,
                            function() {
                                // Confirm reset - restore original name
                                for (var key in self.defaultProfiles) {
                                    if (self.defaultProfiles[key].icon === selectedItem.icon) {
                                        selectedItem.text = key;
                                        break;
                                    }
                                }
                                self.resetConfirmDialog = null;
                            },
                            function() {
                                // Cancel reset
                                self.resetConfirmDialog = null;
                            },
                            'Reset to default'  // action parameter
                        );
                    }
                }
            },
            function() {
                // Close popup
                self.clonePopup = null;
            }
        );
    };

    UIDemoScene.prototype._openKeyboardForClone = function(selectedItem) {
        var self = this;

        var defaultText;

        // First, check if item name already has a [N] suffix (e.g., "Router Jun 9 [2]")
        var numberPattern = /\s\[(\d+)\]$/;
        var numberMatch = selectedItem.text.match(numberPattern);

        if (numberMatch) {
            // Already has a number suffix, extract base and increment
            var baseName = selectedItem.text.substring(0, numberMatch.index);
            var currentNumber = parseInt(numberMatch[1]);
            var newNumber = currentNumber + 1;
            var testName = baseName + ' [' + newNumber + ']';

            // Check for conflicts and find next available number
            var counter = newNumber;
            while (self.items.some(function(item) { return item.text === testName; })) {
                counter++;
                testName = baseName + ' [' + counter + ']';
            }
            defaultText = testName;
        } else {
            // Check if it has a date suffix (e.g., "Router Jun 9")
            // Pattern: space + month abbreviation + space + day number at the end
            var datePattern = /\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2}$/;
            var hasDateSuffix = datePattern.test(selectedItem.text);

            if (hasDateSuffix) {
                // Already has a date, add sequence number instead [1], [2], etc.
                var baseName = selectedItem.text;
                var counter = 1;
                var testName = baseName + ' [' + counter + ']';

                // Find next available number that doesn't conflict
                while (self.items.some(function(item) { return item.text === testName; })) {
                    counter++;
                    testName = baseName + ' [' + counter + ']';
                }
                defaultText = testName;
            } else {
                // No date or number suffix, add date
                var today = new Date();
                var monthStr = today.toLocaleString('en-US', { month: 'short' });
                var dayStr = today.getDate();
                var dateBasedName = selectedItem.text + ' ' + monthStr + ' ' + dayStr;

                // Check if this date-based name already exists
                if (self.items.some(function(item) { return item.text === dateBasedName; })) {
                    // Name exists, add sequence number [1], [2], etc.
                    var counter = 1;
                    var testName = dateBasedName + ' [' + counter + ']';
                    while (self.items.some(function(item) { return item.text === testName; })) {
                        counter++;
                        testName = dateBasedName + ' [' + counter + ']';
                    }
                    defaultText = testName;
                } else {
                    defaultText = dateBasedName;
                }
            }
        }

        self.inputText = defaultText;
        self._renamingItem = null;  // Not renaming, just cloning
        self._inputError = '';  // Clear error message

        // Open keyboard for clone
        self.tabHeader = new UI.TabHeader('Edit profile name');
        self.textInputBox = new UI.TextInputBox();
        self.inputField = new UI.InputField();
        self.keyboard = new UI.Keyboard(
            [
                ['q','w','e','r','t','y','u','i','o','p','['],
                ['a','s','d','f','g','h','j','k','l',':',']'],
                ['z','x','c','v','b','n','m',',','.','/','?',' ']
            ],
            function(char) {
                if (char === '\b') {
                    self.inputText = self.inputText.slice(0, -1);
                } else {
                    self.inputText += char;
                }
                // Check for duplicate names
                self._checkNameDuplicate();
                if (self.cursor) self.cursor.reset();
            },
            function() {
                self.keyboard = null;
                self.cursor = null;
                self.tabHeader = null;
                self.textInputBox = null;
                self.inputField = null;
                self._inputError = '';
            }
        );
        self.cursor = new BlinkingKeyboardCursor(500);
    };

    UIDemoScene.prototype._openKeyboardForRename = function(selectedItem) {
        var self = this;
        self.inputText = selectedItem.text;
        self._renamingItem = selectedItem;  // Track which item we're renaming
        self._inputError = '';  // Clear error message

        // Open keyboard for rename
        self.tabHeader = new UI.TabHeader('Rename profile');
        self.textInputBox = new UI.TextInputBox();
        self.inputField = new UI.InputField();
        self.keyboard = new UI.Keyboard(
            [
                ['q','w','e','r','t','y','u','i','o','p','['],
                ['a','s','d','f','g','h','j','k','l',':',']'],
                ['z','x','c','v','b','n','m',',','.','/','?',' ']
            ],
            function(char) {
                if (char === '\b') {
                    self.inputText = self.inputText.slice(0, -1);
                } else {
                    self.inputText += char;
                }
                // Check for duplicate names
                self._checkNameDuplicate();
                if (self.cursor) self.cursor.reset();
            },
            function() {
                self.keyboard = null;
                self.cursor = null;
                self.tabHeader = null;
                self.textInputBox = null;
                self.inputField = null;
                self._renamingItem = null;
                self._inputError = '';
            }
        );
        self.cursor = new BlinkingKeyboardCursor(500);
    };

    UIDemoScene.prototype._checkNameDuplicate = function() {
        var self = this;
        self._inputError = '';

        // Check if name already exists (excluding the current item being renamed)
        for (var i = 0; i < self.items.length; i++) {
            if (self.items[i] !== self._renamingItem && self.items[i].text === self.inputText) {
                self._inputError = 'Name already exist';
                return;
            }
        }
    };
    UIDemoScene.prototype._onPower = function() { /* TODO */ };
    UIDemoScene.prototype._onView  = function() { /* TODO */ };
    UIDemoScene.prototype._onRun   = function() { /* TODO */ };

    UIDemoScene.prototype.enter = function() {};
    UIDemoScene.prototype.exit = function() {};

    UIDemoScene.prototype.handleInput = function(action) {
        // If delete confirmation dialog is open, handle it
        if (this.deleteConfirmDialog) {
            this.deleteConfirmDialog.handleInput(action);
            return;
        }

        // If reset confirmation dialog is open, handle it
        if (this.resetConfirmDialog) {
            this.resetConfirmDialog.handleInput(action);
            return;
        }

        // If keyboard is open, handle it
        if (this.keyboard) {
            if (action === 'esc') {
                var self = this;
                // Show feedback on Close button while closing keyboard
                this._closeBtn.press();
                this.keyboard = null;
                this.cursor = null;
                this.tabHeader = null;
                this.textInputBox = null;
                this.inputField = null;
                this.keyboardClosing = true;
                setTimeout(function() {
                    self._closeBtn.release();
                    self.keyboardClosing = false;
                }, 30);
            } else if (action === 'run') {
                // Save button (B) — show feedback and save profile (if not disabled)
                if (!this._saveBtn.disabled) {
                    var self = this;
                    this._saveBtn.press();
                    setTimeout(function() {
                        self._onSave();
                        self._saveBtn.release();
                    }, 30);
                }
            } else {
                // Let keyboard handle all other inputs (ok prints letter, navigation, etc)
                this.keyboard.handleInput(action);
            }
            return;
        }

        // If clone popup is open, handle it
        if (this.clonePopup) {
            if (action === 'esc') {
                // Show feedback on Close button while closing popup
                this._closeBtn.press();
                this.clonePopup = null;
                this.clonePopupClosing = true;
                var self = this;
                setTimeout(function() {
                    self._closeBtn.release();
                    self.clonePopupClosing = false;
                }, 30);
            } else {
                this.clonePopup.handleInput(action);
            }
            return;
        }

        // If popup is open, handle Close button feedback and close immediately
        if (this.popup) {
            if (action === 'esc') {
                // Show feedback on Close button while closing popup
                this._closeBtn.press();
                this.popup.handleInput('esc');  // Close popup immediately
                this.popupClosing = true;
                var self = this;
                setTimeout(function() {
                    self._closeBtn.release();
                    self.popupClosing = false;
                }, 30);
            } else {
                this.popup.handleInput(action);
            }
            return;
        }

        // Check if action maps to a button
        var btn = this.btnActionMap[action];
        if (btn) {
            var self = this;
            btn.press();
            if (btn.onPress) btn.onPress();
            setTimeout(function() { btn.release(); }, 30);
            return;
        }

        if (action === 'up' || action === 'down') {
            this.items[this.selectedIndex].state = STATE_DEFAULT;
            var len = this.items.length;
            this.selectedIndex = (this.selectedIndex + (action === 'down' ? 1 : -1) + len) % len;
            this.items[this.selectedIndex].state = STATE_SELECTED;

            // Adjust viewport to keep selected item visible
            var itemHeight = this.items[0].h + ITEM_SPACING;
            var startY = 20;  // Must match render method's startY
            var scrollableHeight = (144 - 14) - startY;  // Canvas height - button bar - header space
            var visibleItems = Math.floor(scrollableHeight / itemHeight);

            if (this.selectedIndex < this.viewportStartIndex) {
                // Scroll up
                this.viewportStartIndex = this.selectedIndex;
            } else if (this.selectedIndex >= this.viewportStartIndex + visibleItems) {
                // Scroll down
                this.viewportStartIndex = this.selectedIndex - visibleItems + 1;
            }
        } else if (action === 'ok') {
            var self = this;
            this.items[this.selectedIndex].state = STATE_PRESSED;
            setTimeout(function() {
                self.items[self.selectedIndex].state = STATE_SELECTED;
                // TODO: Handle entering into selected item
            }, 200);
        }
    };

    UIDemoScene.prototype.render = function(canvas) {
        canvas.clear('#ffffff');

        // Draw header (centered)
        var headerText = 'FlipperOS Boot profiles | U-BOOT';
        var headerWidth = HaxrCorp4090FlipCTL.textWidth(headerText);
        var headerX = Math.floor((canvas.w - headerWidth) / 2);
        HaxrCorp4090FlipCTL.draw(canvas.ctx, headerText, headerX, 5, '#000');

        var startX = Math.floor((canvas.w - this.items[0].w) / 2);
        var startY = 20;  // Leave space for header (moved up to fit all 5 items)
        var itemHeight = this.items[0].h + ITEM_SPACING;
        var scrollableHeight = (canvas.h - 14) - startY;  // Available space before button bar
        var visibleItems = Math.floor(scrollableHeight / itemHeight);

        // Render only visible items (within viewport)
        for (var i = this.viewportStartIndex; i < this.items.length && i < this.viewportStartIndex + visibleItems; i++) {
            var relativeY = startY + (i - this.viewportStartIndex) * itemHeight;
            this.items[i].render(canvas, startX, relativeY);
        }

        // Create and render scrollbar
        if (!this.scrollbar) {
            this.scrollbar = new UI.Scrollbar(this.items.length, visibleItems, this.viewportStartIndex);
        } else {
            this.scrollbar.update(this.items.length, visibleItems, this.viewportStartIndex);
        }

        if (this.scrollbar.shouldShow()) {
            // Render scrollbar with 1 pixel gap from right button
            // Pass canvas.w - 3 (253) for dotted line, thumb at 251-253, leaving gap at 254-255
            // Reduce height by 1 pixel to leave clearance from button bar
            this.scrollbar.render(canvas, canvas.w - 3, startY, scrollableHeight - 1);
        }

        // Render delete confirmation dialog
        if (this.deleteConfirmDialog) {
            this.deleteConfirmDialog.render(canvas);
            // Render only Cancel and Delete buttons
            this._closeBtn.render(canvas);
            this._deleteBtn.render(canvas);
            return;  // Don't render menu when dialog is open
        }

        // Render reset confirmation dialog
        if (this.resetConfirmDialog) {
            this.resetConfirmDialog.render(canvas);
            // Render only Cancel and Reset buttons
            this._closeBtn.render(canvas);
            this._resetBtn.render(canvas);
            return;  // Don't render menu when dialog is open
        }

        // Render buttons (skip Edit button when popup or clonePopup is open)
        for (var b = 0; b < this.app_defined_buttons.length; b++) {
            var btn = this.app_defined_buttons[b];
            if (!btn) continue;
            if ((this.popup || this.clonePopup) && btn === this._editBtn) continue;
            btn.render(canvas);
        }

        // Render keyboard if open
        if (this.keyboard) {
            // Update Save button disabled state
            this._saveBtn.disabled = !!this._inputError;

            // Draw white overlay
            canvas.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
            canvas.ctx.fillRect(0, 0, canvas.w, canvas.h);

            // Render tab header
            if (this.tabHeader) {
                this.tabHeader.render(canvas);
            }

            // Render text input box
            if (this.textInputBox) {
                this.textInputBox.render(canvas);

                // Render input field
                if (this.inputField) {
                    this.inputField.render(canvas);

                    // Draw input text and cursor inside the field (10px padding left + 3px padding)
                    if (this.cursor) this.cursor.update();
                    HaxrCorp4090FlipCTL.draw(canvas.ctx, this.inputText, 25, 27, '#000');
                    if (this.cursor && this.cursor.isVisible()) {
                        var cursorX = 25 + HaxrCorp4090FlipCTL.textWidth(this.inputText) + 1;
                        canvas.drawCursor(cursorX, 28, 1, 10, '#000');
                    }

                    // Draw error message if exists
                    if (this._inputError) {
                        HaxrCorp4090FlipCTL.draw(canvas.ctx, this._inputError, 25, 42, '#000');
                    }
                }
            }

            // Render keyboard
            this.keyboard.render(canvas);
            // Render Close and Done buttons
            this._closeBtn.render(canvas);
            this._saveBtn.render(canvas);
            return;  // Don't render menu when keyboard is open
        } else if (this.keyboardClosing) {
            // Show only Close button feedback, no overlay or keyboard
            this._closeBtn.render(canvas);
        }

        // Render clone popup with semi-transparent white overlay
        if (this.clonePopup) {
            // Draw white overlay with 75% opacity (25% transparency)
            canvas.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
            canvas.ctx.fillRect(0, 0, canvas.w, canvas.h);
            // Render clone popup on top
            this.clonePopup.render(canvas);
            // Render Close button
            this._closeBtn.render(canvas);
        } else if (this.clonePopupClosing) {
            // Show only Close button feedback, no overlay
            this._closeBtn.render(canvas);
        }

        // Render popup with semi-transparent white overlay
        if (this.popup) {
            // Draw white overlay with 75% opacity (25% transparency)
            canvas.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
            canvas.ctx.fillRect(0, 0, canvas.w, canvas.h);
            // Render popup on top
            this.popup.render(canvas);
            // Render Close button (left button, on top of OFF) with feedback
            this._closeBtn.render(canvas);
        } else if (this.popupClosing) {
            // Show only Close button feedback, no overlay
            this._closeBtn.render(canvas);
        }
    };

    return UIDemoScene;
})();
