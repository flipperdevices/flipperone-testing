var SubMenuScene = (function() {
    // Layout mirrors the main menu (see MenuScene in menu.js) — same
    // MenuLine geometry, same selector frame behaviour, same scrollbar
    // — but the submenu has its own container anchor and a narrower
    // left margin. The icon's left edge must sit 8px from the canvas
    // left; since the MenuLine's built-in ICON_PAD is 3, that puts the
    // container at x = 8 - 3 = 5.
    //   - container x:           5 (icon lands at x=8)
    //   - container top:         14px below the status bar
    //   - selector frame x:      4 (canvas-left padding)
    var CONTAINER_X = 5;
    var CONTAINER_W = 224;
    var DIVIDER_COLOR = '#CCCCCC';
    var ANIMATED_ICON_FRAME_MS = 200;

    var VISIBLE_COUNT = 5;
    var VIEWPORT_H   = VISIBLE_COUNT * MenuLine.H + (VISIBLE_COUNT - 1);  // 104

    var SELECTOR_X = 4;
    // Selector width depends on scrollbar visibility. When the list is
    // long enough to show the scrollbar, leave room for it (244). When
    // it isn't, the selector extends further right to leave 5px of
    // spacing between its right edge and the canvas right edge
    // (`canvas.w − SELECTOR_X − 5 = 247`).
    var SELECTOR_W_WITH_SCROLL = 244;
    var SELECTOR_W_NO_SCROLL   = 247;
    var SELECTOR_H = 22;
    var SELECTOR_CORNER_R = 3;
    var SELECTOR_Y_OFFSET = -1;

    // Scrollbar spans the full menu column (matches main menu).
    var SCROLLBAR_X = 253;
    var SCROLLBAR_Y = 15;
    var SCROLLBAR_H = 127;
    var SCROLLBAR_THUMB_PAD = 1;

    function SubMenuScene(sceneManager, title, items, appScenes) {
        this.sceneManager = sceneManager;
        this.title = title;
        this.itemNames = items;
        this.appScenes = appScenes || {};
        this.selectedIndex = 0;
        this.scrollOffset = 0;
        this.items = [];
        this.toggleState = {
            'Fake-FlipCTL_2': true
        };

        // Container top sits 14px below the status bar per spec.
        // Breadcrumb is a single left-aligned "> Title" string, 4px
        // from the canvas left and 4px below the status bar.
        this.containerY   = UI.STATUS_BAR_H + 14;
        this.breadcrumbX  = 4;
        this.breadcrumbY  = UI.STATUS_BAR_H + 2;

        for (var i = 0; i < items.length; i++) {
            var status = null;
            if (items[i] === 'Fake-FlipCTL_2') {
                status = this.toggleState['Fake-FlipCTL_2'] ? '< ON >' : '< OFF >';
            }
            this.items.push(new MenuLine({
                text: items[i],
                width: CONTAINER_W,
                status: status
            }));
        }

        this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;
        this._modal = null;  // Optional overlay; see showModal() below.

        this.selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X,
            y: 0,
            width: SELECTOR_W_WITH_SCROLL,  // updated per-frame based on scrollbar visibility
            height: SELECTOR_H,
            anchorH: 'left',
            anchorV: 'top',
            strokeColor: '#000',
            showStroke: true,
            showFill: false
        });

        this.scrollbar = new UI.Scrollbar(items.length, VISIBLE_COUNT, this.scrollOffset);
    }

    SubMenuScene.prototype.enter = function() {
        if (this._animTimer) return;
        this._animTimer = setInterval(function() {
            if (window.requestRender) window.requestRender();
        }, ANIMATED_ICON_FRAME_MS);
    };
    SubMenuScene.prototype.exit = function() {
        if (this._animTimer) {
            clearInterval(this._animTimer);
            this._animTimer = null;
        }
    };

    SubMenuScene.prototype._ensureVisible = function() {
        if (this.selectedIndex < this.scrollOffset) {
            this.scrollOffset = this.selectedIndex;
        } else if (this.selectedIndex >= this.scrollOffset + VISIBLE_COUNT) {
            this.scrollOffset = this.selectedIndex - VISIBLE_COUNT + 1;
        }
    };

    // Modal overlay API: any object with `render(canvas)` and
    // `handleInput(action)` (returning truthy if it consumed the
    // event). While a modal is set, the scene still renders in the
    // background but all input is routed through the modal first.
    SubMenuScene.prototype.showModal = function(modal) {
        this._modal = modal;
        if (window.requestRender) window.requestRender();
    };
    SubMenuScene.prototype.closeModal = function() {
        this._modal = null;
        if (window.requestRender) window.requestRender();
    };

    SubMenuScene.prototype.handleInput = function(action) {
        // Modal (if any) captures all input.
        if (this._modal) {
            this._modal.handleInput(action);
            return;
        }

        var n = this.items.length;

        // Left/right toggle: any row whose MenuLine defines `onToggle`
        // (set by the submenu's owner at construction time).
        var selectedItem = this.items[this.selectedIndex];
        if ((action === 'left' || action === 'right') && typeof selectedItem.onToggle === 'function') {
            selectedItem.onToggle();
            // Visual tap feedback on the pressed chevron — 120ms in
            // #222222, then reverts to the normal status colour. 120ms
            // is long enough to be visible past the rAF cadence and
            // the 200ms animation tick.
            selectedItem.arrowPressed = action;
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                if (selectedItem.arrowPressed === action) {
                    selectedItem.arrowPressed = null;
                    if (window.requestRender) window.requestRender();
                }
            }, 120);
            return;
        }

        // Legacy Fake-FlipCTL_2 toggle (pre-dates `onToggle`; kept for
        // the Testing submenu's status-string-based entry).
        var selectedItemName = this.itemNames[this.selectedIndex];
        if ((action === 'left' || action === 'right') && selectedItemName === 'Fake-FlipCTL_2') {
            this.toggleState['Fake-FlipCTL_2'] = !this.toggleState['Fake-FlipCTL_2'];
            this.items[this.selectedIndex].status = this.toggleState['Fake-FlipCTL_2'] ? '< ON >' : '< OFF >';
            return;
        }

        if (action === 'down' || action === 'up') {
            // Infinity scroll: wraps at both ends.
            this.items[this.selectedIndex].state = MenuLine.STATE_DEFAULT;
            if (action === 'down') {
                this.selectedIndex = (this.selectedIndex + 1) % n;
            } else {
                this.selectedIndex = (this.selectedIndex - 1 + n) % n;
            }
            this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;
            this._ensureVisible();
        } else if (action === 'ok' || action === 'run') {
            // Toggle rows flip their value on enter — no press flash,
            // no scene push (same behaviour as left/right).
            var pressedLine = this.items[this.selectedIndex];
            if (typeof pressedLine.onToggle === 'function') {
                pressedLine.onToggle();
                if (window.requestRender) window.requestRender();
                return;
            }

            // Regular rows: 30ms press flash, then open the
            // factory-returned scene.
            var self = this;
            var idx = this.selectedIndex;
            pressedLine.state = MenuLine.STATE_PRESSED;
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                pressedLine.state = MenuLine.STATE_SELECTED;
                var factory = self.appScenes[self.itemNames[idx]];
                if (factory) {
                    // Factories receive the submenu instance so they
                    // can open a modal in place (returning null) instead
                    // of pushing a new scene.
                    var next = factory(self);
                    if (next && typeof next.render === 'function') {
                        self.sceneManager.push(next);
                    }
                }
                if (window.requestRender) window.requestRender();
            }, 30);
        } else if (action === 'back' || action === 'esc') {
            return 'pop';
        }
    };

    SubMenuScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, '');

        // Breadcrumb: "> Title", left-aligned, in the canonical accent
        // gray. No background fill.
        HaxrcorpFont16.draw(canvas.ctx, '> ' + this.title, this.breadcrumbX, this.breadcrumbY, '#CCCCCC');

        // Selector width tracks scrollbar visibility; the gray divider
        // matches the selector's straight edge (width − 2×radius).
        var total = this.items.length;
        var hasScroll = total > VISIBLE_COUNT;
        var selectorW = hasScroll ? SELECTOR_W_WITH_SCROLL : SELECTOR_W_NO_SCROLL;
        var dividerX = SELECTOR_X + SELECTOR_CORNER_R;
        var dividerW = selectorW - 2 * SELECTOR_CORNER_R;

        // MenuLine's `w` is its status-right-alignment reference. Extend
        // it so the right edge lands on the selector's right edge —
        // MenuLine then applies its STATUS_PAD_R = 3 internally, giving
        // the spec'd "3px padding from the MenuSelectorFrame".
        var lineW = selectorW + SELECTOR_X - CONTAINER_X;
        for (var k = 0; k < this.items.length; k++) this.items[k].w = lineW;

        // Render only the slice of items currently in the viewport.
        var first = this.scrollOffset;
        var last = Math.min(total, first + VISIBLE_COUNT);
        var y = this.containerY;
        var selectedLineY = this.containerY;
        for (var i = first; i < last; i++) {
            if (i === this.selectedIndex) selectedLineY = y;
            this.items[i].render(canvas, CONTAINER_X, y);
            y += MenuLine.H;
            if (i < last - 1) {
                canvas.drawHLine(dividerX, y, dividerW, DIVIDER_COLOR);
                y += 1;
            }
        }

        // Selector frame: filled while PRESSED, outline otherwise.
        var pressed = this.items[this.selectedIndex].state === MenuLine.STATE_PRESSED;
        this.selectorFrame.setPosition(SELECTOR_X, selectedLineY + SELECTOR_Y_OFFSET);
        this.selectorFrame.setSize(selectorW, SELECTOR_H);
        this.selectorFrame.setShowFill(pressed);
        if (pressed) this.selectorFrame.setFillColor('#000');
        this.selectorFrame.render(canvas);

        // Redraw the selected line on top when PRESSED so its inverted
        // text/icon sit over the black backdrop.
        if (pressed) {
            this.items[this.selectedIndex].render(canvas, CONTAINER_X, selectedLineY);
        }

        // Scrollbar (same geometry as main menu).
        this.scrollbar.update(total, VISIBLE_COUNT, this.scrollOffset);
        this.scrollbar.render(canvas, SCROLLBAR_X, SCROLLBAR_Y, SCROLLBAR_H, SCROLLBAR_THUMB_PAD);

        // Modal overlay on top of everything.
        if (this._modal) this._modal.render(canvas);
    };

    return SubMenuScene;
})();
