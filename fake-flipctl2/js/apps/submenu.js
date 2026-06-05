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
        // Exposed for SceneManager.breadcrumb() — contributes this level
        // to the breadcrumb trail (e.g. "Network" in "> Network > …").
        this.breadcrumbTitle = title;
        this.itemNames = items;
        this.appScenes = appScenes || {};
        this.selectedIndex = 0;
        this.scrollOffset = 0;
        this.items = [];
        this.toggleState = {
            'Fake-FlipCTL_2': true
        };

        // Container top sits 15px below the status bar (breadcrumb row
        // spans the area between status bar and container). Was 16,
        // then lifted to 14 to fit an extra row above a bottom app
        // button; nudged back down 1px to 15.
        this.containerY   = UI.STATUS_BAR_H + 15;
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

    // Force a fixed breadcrumb trail instead of the stack-derived
    // one. Used by self-contained demo flows (e.g. the Power-menu
    // UI demo's Settings submenu) that want a clean "> Settings"
    // crumb rather than inheriting the long Testing → UI Demos →
    // … path that led there. Pass an array of crumb titles; render
    // joins them with " > " and prefixes "> ".
    SubMenuScene.prototype.setBreadcrumbTrail = function(titles) {
        this._breadcrumbTrail = titles && titles.length ? titles.slice() : null;
    };

    // Suppress the top status bar for this instance only. Default
    // is to draw it (every existing submenu keeps it); the
    // Power-menu UI demo's Settings page opts out so it reads as a
    // clean breadcrumb-over-white page with no chrome strip.
    SubMenuScene.prototype.setHideStatusBar = function(hide) {
        this._hideStatusBar = !!hide;
    };

    // Install a custom header renderer for this instance. When set,
    // it's called with (canvas) in place of the default status bar
    // — the Power-menu UI demo passes its own chrome (dev label +
    // battery on white) so its Settings page matches the demo's
    // main screen. Implies hiding the default status bar.
    SubMenuScene.prototype.setHeaderRenderer = function(fn) {
        this._headerRenderer = (typeof fn === 'function') ? fn : null;
    };

    // Attach an app-defined button (any UI.{Left,Right,Middle}Button
    // instance) rendered along the bottom row for this instance
    // only. Its `action` is matched in handleInput; the existing
    // back/esc → pop path already covers an ESC button, so this is
    // primarily a visual affordance. Pass null to clear.
    SubMenuScene.prototype.setAppButton = function(button) {
        this._appButton = button || null;
    };

    // Make the 'run' action (B key) a no-op for this instance.
    // SubMenuScene normally aliases run → ok (select the row); the
    // Power-menu demo's Settings page wants B to do nothing, while
    // 'ok' (center / Enter) still selects. Other submenus leave
    // this unset and keep the run-as-ok behaviour.
    SubMenuScene.prototype.setIgnoreRun = function(ignore) {
        this._ignoreRun = !!ignore;
    };

    // Make the 'esc' action (Z key) pop the stack all the way back
    // to `targetScene` in one press, instead of the default single
    // pop. Used by the Power-menu demo so ESC returns to its main
    // screen no matter how deep into Settings → … the user is.
    // 'back' (Escape / Backspace keys) still single-pops.
    SubMenuScene.prototype.setEscTarget = function(targetScene) {
        this._escTarget = targetScene || null;
    };

    // Bottom-button geometry. The bottom app button is 14 px tall
    // — shorter than a 20 px menu row — so with the container
    // lifted 2 px the full VISIBLE_COUNT rows fit above it (the
    // last row's bottom padding just meets the button's top edge).
    // We only shorten the scrollbar so its track doesn't run under
    // the button.
    var APP_BUTTON_H = 14;
    SubMenuScene.prototype._visibleCount = function() {
        return VISIBLE_COUNT;
    };
    SubMenuScene.prototype._scrollbarHeight = function() {
        return this._appButton
            ? (SCROLLBAR_H - APP_BUTTON_H - 1)
            : SCROLLBAR_H;
    };

    // Mark this submenu as an "app" — it then participates in the
    // App Switcher exactly like a PlaceholderAppScene: enter()
    // registers it with RunningApps (bumping any prior entry to the
    // top), exit() captures a screenshot the switcher can use as
    // the card thumbnail. `icon` is the static icon shown in the
    // switcher's title bar; `factoryFn(sceneManager)` returns a
    // fresh instance of this submenu, used by the switcher when the
    // user picks the card.
    SubMenuScene.prototype.markAsApp = function(icon, factoryFn) {
        this._asApp = { icon: icon || null, factoryFn: factoryFn || null };
    };

    SubMenuScene.prototype.enter = function() {
        if (this._animTimer) return;
        this._animTimer = setInterval(function() {
            if (window.requestRender) window.requestRender();
        }, ANIMATED_ICON_FRAME_MS);
        // App-mode submenus register with RunningApps on enter so
        // the switcher's recents stack picks them up. No imagePath
        // — these scenes have no PNG mockup; the switcher will rely
        // on the snapshot captured on exit().
        if (this._asApp && typeof RunningApps !== 'undefined') {
            RunningApps.open(this.title, null, this._asApp.icon, this._asApp.factoryFn);
        }
    };
    SubMenuScene.prototype.exit = function() {
        if (this._animTimer) {
            clearInterval(this._animTimer);
            this._animTimer = null;
        }
        // Capture the current canvas pixels as the switcher's card
        // thumbnail. Same race guard as PlaceholderAppScene: only
        // capture when this scene is the one that actually rendered
        // the visible frame, otherwise we'd save (e.g.) the App
        // Switcher's own pixels as our thumbnail.
        if (this._asApp && typeof RunningApps !== 'undefined') {
            var canvasEl = document.getElementById('screen');
            var ownsCanvas = (window._lastRenderedScene === this);
            if (ownsCanvas && canvasEl) {
                var snap = document.createElement('canvas');
                snap.width  = canvasEl.width;
                snap.height = canvasEl.height;
                snap.getContext('2d').drawImage(canvasEl, 0, 0);
                RunningApps.setSnapshot(this.title, snap);
            }
        }
    };

    SubMenuScene.prototype._ensureVisible = function() {
        var vis = this._visibleCount();
        if (this.selectedIndex < this.scrollOffset) {
            this.scrollOffset = this.selectedIndex;
        } else if (this.selectedIndex >= this.scrollOffset + vis) {
            this.scrollOffset = this.selectedIndex - vis + 1;
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

        // Per-instance opt-out: swallow the 'run' (B) action so it
        // does nothing. 'ok' (center / Enter) still selects.
        if (action === 'run' && this._ignoreRun) {
            return;
        }

        var n = this.items.length;

        // Left/right on a row that defines either `onToggle` (flip a
        // boolean) or `onAdjust(direction)` (cycle / step a value).
        // `onAdjust` gets the direction so it can step up vs down;
        // `onToggle` is direction-agnostic. Both flash the pressed
        // chevron for 120ms.
        var selectedItem = this.items[this.selectedIndex];
        if ((action === 'left' || action === 'right')
                && (typeof selectedItem.onToggle === 'function'
                    || typeof selectedItem.onAdjust === 'function')) {
            if (typeof selectedItem.onAdjust === 'function') {
                selectedItem.onAdjust(action);
            } else {
                selectedItem.onToggle();
            }
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
            // no scene push (same behaviour as left/right). Adjust
            // rows (left/right value steppers) ignore OK entirely so
            // it doesn't trigger the press-flash / factory path.
            var pressedLine = this.items[this.selectedIndex];
            if (typeof pressedLine.onAdjust === 'function') {
                return;
            }
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
            // ESC with a target set: pop straight back to it in one
            // press (e.g. Power-menu demo → main screen from any
            // depth). Done in-place via sceneManager.pop() rather
            // than returning 'pop', so we control how many levels
            // unwind. 'back' always single-pops.
            if (action === 'esc' && this._escTarget && this.sceneManager) {
                var smRef = this.sceneManager;
                var guard = 0;
                while (smRef.current()
                        && smRef.current() !== this._escTarget
                        && guard < 32) {
                    var cur = smRef.current();
                    smRef.pop();
                    if (smRef.current() === cur) break;  // hit root
                    guard++;
                }
                if (window.requestRender) window.requestRender();
                return;
            }
            return 'pop';
        }
    };

    SubMenuScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        // Header: a custom renderer takes precedence (e.g. the
        // Power-menu demo's dev-label + battery chrome); otherwise
        // the default status bar draws unless this instance opted
        // out via setHideStatusBar(true). The breadcrumb + item
        // layout anchors are unchanged in every case.
        if (this._headerRenderer) {
            this._headerRenderer(canvas);
        } else if (!this._hideStatusBar) {
            UI.drawStatusBar(canvas, '');
        }

        // Breadcrumb: full "> A > B > …" trail built from every
        // scene on the stack that contributes a `breadcrumbTitle`
        // (Desktop / Main Menu contribute none, so a top-level
        // submenu reads "> Testing" while a nested one reads
        // "> Testing > Demo"). Falls back to this submenu's own
        // title if the SceneManager isn't reachable. Left-aligned,
        // canonical accent gray, no background fill.
        var crumbTitles = this._breadcrumbTrail
            || ((this.sceneManager
                    && typeof this.sceneManager.breadcrumb === 'function')
                ? this.sceneManager.breadcrumb()
                : [this.title]);
        if (!crumbTitles || !crumbTitles.length) crumbTitles = [this.title];
        var crumbTrail = '> ' + crumbTitles.join(' > ');
        HaxrcorpFont16.draw(canvas.ctx, crumbTrail, this.breadcrumbX, this.breadcrumbY, '#CCCCCC');

        // Selector width tracks scrollbar visibility; the gray divider
        // matches the selector's straight edge (width − 2×radius).
        var vis = this._visibleCount();
        var total = this.items.length;
        var hasScroll = total > vis;
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
        var last = Math.min(total, first + vis);
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

        // Scrollbar (same geometry as main menu). Height shrinks
        // when an app button occupies the bottom row so the track
        // never runs under the button.
        this.scrollbar.update(total, vis, this.scrollOffset);
        this.scrollbar.render(canvas, SCROLLBAR_X, SCROLLBAR_Y, this._scrollbarHeight(), SCROLLBAR_THUMB_PAD);

        // App-defined bottom button (per-instance; e.g. the
        // Power-menu demo Settings page's ESC). Drawn over the
        // item list, below the modal overlay.
        if (this._appButton) this._appButton.render(canvas);

        // Modal overlay on top of everything.
        if (this._modal) this._modal.render(canvas);
    };

    return SubMenuScene;
})();
