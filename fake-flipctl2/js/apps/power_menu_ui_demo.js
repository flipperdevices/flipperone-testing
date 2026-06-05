/**
 * PowerMenuUIDemoScene
 *
 * Empty stub sibling to BootMenuUIDemoScene. Lives under
 * Testing → Demo → "Power menu - UI demo" so the design slot
 * exists and is reachable; the body is blank until the actual
 * UI is wired up.
 */
var PowerMenuUIDemoScene = (function() {
    var BTN_W = 48;

    // Build / version string shown top-left where the status-bar
    // title normally sits. Static placeholder for the demo.
    var VERSION_LABEL = 'dev-31052026-d85a526a';

    // Shared top-of-screen chrome for the demo: dev label top-left
    // (dim gray) + battery top-right (black) on whatever the caller
    // already cleared to white. Used by both the main demo screen
    // and the Settings submenu (via SubMenuScene.setHeaderRenderer)
    // so the two pages match.
    function drawDemoChrome(canvas) {
        HaxrcorpFont16.draw(canvas.ctx, VERSION_LABEL, 4, 3, '#696969');
        if (typeof UI !== 'undefined' && typeof UI.drawBattery === 'function') {
            UI.drawBattery(canvas, '#000');
        }
    }

    // Help body line pitch (px). Shared by the renderer and the
    // d-pad step so one up/down press moves exactly one line.
    var HELP_LINE_H = 11;

    // Greedy word-wrap into lines no wider than `maxW` in
    // HaxrcorpFont16. Newlines in the source split paragraphs —
    // each is wrapped independently, and a blank "\n\n" in the
    // source yields an empty spacer line between paragraphs. Long
    // single words that exceed maxW alone are left intact (placed
    // on their own line) rather than broken.
    function wrapText(text, maxW) {
        var paragraphs = String(text).split('\n');
        var lines = [];
        for (var pi = 0; pi < paragraphs.length; pi++) {
            var para = paragraphs[pi].replace(/^\s+|\s+$/g, '');
            if (para === '') { lines.push(''); continue; }  // spacer line
            var words = para.split(/\s+/);
            var cur = '';
            for (var i = 0; i < words.length; i++) {
                var test = cur ? (cur + ' ' + words[i]) : words[i];
                if (cur && HaxrcorpFont16.textWidth(test) > maxW) {
                    lines.push(cur);
                    cur = words[i];
                } else {
                    cur = test;
                }
            }
            if (cur) lines.push(cur);
        }
        return lines;
    }

    function PowerMenuUIDemoScene(sceneManager) {
        var self = this;
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Power menu - UI demo';
        this.breadcrumbTitle = 'Power menu - UI demo';

        // Three app-defined buttons along the bottom row, all
        // 48 px wide. Positions are absolute (override the
        // MiddleButton slot math) so they sit at the requested
        // x offsets:
        //   Help     → x = 52   (52 px from the screen's left)
        //   Power    → x = 104
        //   Settings → x = 156  (right edge at 204 = 256 − 52,
        //              i.e. 52 px from the screen's right)
        // Evenly spaced 52 px apart. Each binds to an action
        // key; onPress is a no-op for now (UI demo only):
        //   Help     → 'edit' (X key)
        //   Power    → 'esc'  (Z key)
        //   Settings → 'del'  (V key)
        // Help is a toggle button — its 2 px top bar lights up
        // (black) while the help overlay is open, same as Power.
        // The toggled state is synced to `_helpOpen` each render.
        this._helpBtn = new UI.MiddleToggleButton('Help', 0, BTN_W, 2, 'edit',
            function() { /* opening handled in handleInput */ }, false);
        this._helpBtn.x = 52;

        // Power is a toggle button — its 2 px top bar lights up
        // (black) while the power modal is open. The toggled
        // state is synced to `_modalOpen` each render.
        this._powerBtn = new UI.MiddleToggleButton('Power', 0, BTN_W, 2, 'esc',
            function() { /* opening handled in handleInput */ }, false);
        this._powerBtn.x = 104;

        this._settingsBtn = new UI.MiddleButton('Settings', 0, BTN_W, 2, 'del',
            function() { self._openSettings(); });
        this._settingsBtn.x = 156;

        // ── Settings → Display state (persists across openings) ──
        // Backlight brightness — a discrete cycle: OFF, 2%, 5%,
        // 10%, then 10% steps to 100%. Adjusted via left/right on
        // the Display page's Backlight row (one step per press,
        // clamped at the ends). Defaults to "10%".
        this._blLevels = ['OFF', '2%', '5%', '10%', '20%', '30%',
                          '40%', '50%', '60%', '70%', '80%', '90%', '100%'];
        this._blLevelIndex = 3;   // "10%"
        // "Backlight OFF when inactive" timeout — a discrete cycle.
        // Defaults to "10 sec".
        this._blOffOptions = ['3 sec', '10 sec', '1 min', 'Never'];
        this._blOffIndex   = 1;

        // ── Settings → Power Management state ────────────────────
        // "Power OFF when inactive" timeout — a discrete cycle.
        // Defaults to "10 min".
        this._powerOffOptions = ['1 min', '3 min', '5 min', '10 min',
                                 '15 min', '30 min', '1 hour', 'Never'];
        this._powerOffIndex   = 3;   // "10 min"

        // ── Power modal (Z) ──────────────────────────────────────
        // Centered popup. Its contents depend on the screen:
        //   • main screen  → Start Linux / Maskrom / Power OFF
        //   • Linux mode   → Shutdown / Reboot
        // `_modalOpen` toggles it; `_modalIndex` is the highlight.
        this._modalOpen       = false;
        this._modalItemsMain  = ['Start Linux', 'Maskrom', 'Power OFF'];
        this._modalItemsLinux = ['Shutdown', 'Reboot'];
        this._modalItems      = this._modalItemsMain;
        this._modalIndex      = 1;   // defaults to Maskrom on main
        // `_linuxMode` swaps the whole screen to the "Linux mode"
        // placeholder (black status bar + centred label). Entered
        // by picking Start Linux; left by picking Shutdown/Reboot.
        this._linuxMode  = false;
        // Rounded selector outline reused for the highlighted
        // modal row; sized per-render.
        this._modalSelectorFrame = new MenuSelectorFrame({
            x: 0, y: 0, width: 1, height: 1,
            anchorH: 'left',   anchorV: 'top',
            strokeColor: '#000', showStroke: true, showFill: false
        });

        // ── Help overlay (X on the main screen) ──────────────────
        // A 240×106 white panel (black stroke, 4 px corners),
        // horizontally centred, its bottom edge 18 px above the
        // bottom button row. Holds scrollable body text driven by
        // the d-pad (up/down) and the touchpad (drag).
        this._helpOpen   = false;
        this._helpText   =
            'Lorem ipsum dolor sit amet, consetetur sadipscing elitr, ' +
            'sed diam nonumy eirmod tempor invidunt ut labore et dolore ' +
            'magna aliquyam erat, sed diam voluptua. At vero eos et ' +
            'accusam et justo duo dolores et ea rebum. Stet clita kasd ' +
            'gubergren, no sea takimata sanctus est Lorem ipsum dolor sit ' +
            'amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, ' +
            'sed diam nonumy eirmod tempor invidunt ut labore et dolore ' +
            'magna aliquyam erat, sed diam voluptua. At vero eos et accusam ' +
            'et justo duo dolores et ea rebum. Stet clita kasd gubergren, ' +
            'no sea takimata sanctus est Lorem ipsum dolor sit amet. ' +
            'Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed ' +
            'diam nonumy eirmod tempor invidunt ut labore et dolore magna ' +
            'aliquyam erat, sed diam voluptua. At vero eos et accusam et ' +
            'justo duo dolores et ea rebum. Stet clita kasd gubergren, no ' +
            'sea takimata sanctus est Lorem ipsum dolor sit amet.' +
            '\n\n' +
            'Duis autem vel eum iriure dolor in hendrerit in vulputate ' +
            'velit esse molestie consequat, vel illum dolore eu feugiat ' +
            'nulla facilisis at vero eros et accumsan et iusto odio ' +
            'dignissim qui blandit praesent luptatum zzril delenit augue ' +
            'duis dolore te feugait nulla facilisi. Lorem ipsum dolor sit ' +
            'amet, consectetuer';
        this._helpLines       = null;  // wrapped lines, cached on first render
        this._helpScrollPx    = 0;     // pixel scroll offset (0 = top)
        this._helpMaxScrollPx = 0;     // updated each render
        // Touchpad drag state.
        this._touchES          = null;
        this._helpTouchActive  = false;
        this._helpTouchBaseY   = 0;
        this._helpTouchScroll0 = 0;    // _helpScrollPx at touch-down
    }

    // Settings drill-in. Opens a SubMenuScene (same component the
    // Network menu uses) with a forced "> Settings" breadcrumb so
    // the demo reads like the standalone power-menu Settings page
    // rather than inheriting the long Testing → UI Demos → … trail
    // that led here. Rows mirror the reference screenshot:
    //   Display          — status "Backlight 10%" (drill-in)
    //   Power Management  — drill-in
    //   Self Check        — drill-in
    //   MCU Recovery Mode — drill-in
    //   Info              — drill-in
    // All factories are no-ops for now (return null). Toggle rows
    // will be wired once the spec names which entries toggle.
    PowerMenuUIDemoScene.prototype._openSettings = function() {
        if (typeof SubMenuScene === 'undefined' || !this.sceneManager) return;
        var self = this;
        var sm = this.sceneManager;
        var items = [
            'Display',
            'Power Management',
            'Self Check',
            'MCU Recovery Mode',
            'LED',
            'Info'
        ];
        var sub = new SubMenuScene(sm, 'Settings', items, {
            // Display + Power Management drill into their own
            // sub-pages. The factory receives the Settings submenu
            // instance; we pull the SceneManager off it to build
            // the child. Remaining rows stay placeholders (no
            // factory → no-op on OK).
            'Display': function(settingsSub) {
                return self._buildDisplayMenu(settingsSub.sceneManager);
            },
            'Power Management': function(settingsSub) {
                return self._buildPowerMgmtMenu(settingsSub.sceneManager);
            }
        });
        // "> Settings" breadcrumb + demo chrome + B-disabled +
        // 1px label lift, shared with the child pages.
        self._decorateDemoSubmenu(sub, ['Settings']);
        // Display row status reflects the live backlight value so
        // it stays in sync with the Display sub-page's Backlight
        // row (e.g. "Backlight 50%" after the user adjusts it).
        for (var i = 0; i < sub.items.length; i++) {
            if (sub.items[i].text === 'Display') {
                sub.items[i].statusProvider = function() {
                    return 'Backlight ' + self._blLevels[self._blLevelIndex];
                };
                break;
            }
        }
        sm.push(sub);
    };

    // Common demo-submenu setup shared by every Settings page:
    //   • forced breadcrumb trail (so it reads "> Settings > …"
    //     instead of the long Testing → UI Demos → … stack path)
    //   • demo chrome (dev label + battery on white) in place of
    //     the status bar
    //   • B / Run disabled ('ok' still selects)
    //   • selected-row Born2bSporty label lifted 1px (nudge 0)
    PowerMenuUIDemoScene.prototype._decorateDemoSubmenu = function(sub, trail) {
        sub.setBreadcrumbTrail(trail);
        sub.setHeaderRenderer(drawDemoChrome);
        sub.setIgnoreRun(true);
        // ESC (Z) jumps straight back to this main demo screen,
        // however deep the submenu chain goes.
        sub.setEscTarget(this);
        for (var n = 0; n < sub.items.length; n++) {
            sub.items[n].activeLabelYNudge = 0;
        }
    };

    // Settings → Display sub-page. Breadcrumb "> Settings >
    // Display". Two rows mirroring the reference screenshot:
    //   Backlight                     — status "10%"
    //   Backlight OFF when inactive   — cycle value "< 10 sec >"
    // The cycle value is a plain status string for now; MenuLine
    // right-aligns it (black when the row is selected, dim
    // otherwise). Left/right cycling can be wired later.
    PowerMenuUIDemoScene.prototype._buildDisplayMenu = function(sm) {
        if (typeof SubMenuScene === 'undefined' || !sm) return null;
        var self = this;
        var sub = new SubMenuScene(sm, 'Display', [
            'Backlight',
            'Backlight OFF when inactive'
        ], {});
        this._decorateDemoSubmenu(sub, ['Settings', 'Display']);
        for (var i = 0; i < sub.items.length; i++) {
            var item = sub.items[i];
            if (item.text === 'Backlight') {
                // Brightness — discrete cycle (OFF / 2% / 5% / 10%
                // / 20% … / 100%). statusProvider wraps the value
                // in "< … >" so MenuLine shows the spread arrows
                // while highlighted; atStart/atEnd hide the arrow
                // at each end. onAdjust steps one level per press.
                // onAdjust is set, so MenuLine routes the "OFF"
                // value through the generic cycle renderer instead
                // of the ON/OFF toggle path.
                item.statusProvider = function() {
                    return '< ' + self._blLevels[self._blLevelIndex] + ' >';
                };
                item.atStart = function() { return self._blLevelIndex <= 0; };
                item.atEnd   = function() {
                    return self._blLevelIndex >= self._blLevels.length - 1;
                };
                item.onAdjust = function(dir) {
                    var idx = self._blLevelIndex + (dir === 'right' ? 1 : -1);
                    if (idx < 0) idx = 0;
                    if (idx > self._blLevels.length - 1) {
                        idx = self._blLevels.length - 1;
                    }
                    self._blLevelIndex = idx;
                };
            } else if (item.text === 'Backlight OFF when inactive') {
                // Discrete timeout cycle: 3 sec / 10 sec / 1 min /
                // Never. No acceleration — left/right step one
                // option, clamped at the ends.
                item.statusProvider = function() {
                    return '< ' + self._blOffOptions[self._blOffIndex] + ' >';
                };
                item.atStart = function() { return self._blOffIndex <= 0; };
                item.atEnd   = function() {
                    return self._blOffIndex >= self._blOffOptions.length - 1;
                };
                item.onAdjust = function(dir) {
                    var idx = self._blOffIndex + (dir === 'right' ? 1 : -1);
                    if (idx < 0) idx = 0;
                    if (idx > self._blOffOptions.length - 1) {
                        idx = self._blOffOptions.length - 1;
                    }
                    self._blOffIndex = idx;
                };
            }
        }
        return sub;
    };

    // Settings → Power Management sub-page. Breadcrumb
    // "> Settings > Power Management". Rows mirror the reference
    // screenshot:
    //   Battery                    — drill-in placeholder
    //   Power OFF when inactive    — cycle (1 min … 1 hour / Never)
    //   Power Delivery             — drill-in placeholder
    PowerMenuUIDemoScene.prototype._buildPowerMgmtMenu = function(sm) {
        if (typeof SubMenuScene === 'undefined' || !sm) return null;
        var self = this;
        var sub = new SubMenuScene(sm, 'Power Management', [
            'Battery',
            'Power OFF when inactive',
            'Power Delivery'
        ], {});
        this._decorateDemoSubmenu(sub, ['Settings', 'Power Management']);
        for (var i = 0; i < sub.items.length; i++) {
            var item = sub.items[i];
            if (item.text === 'Power OFF when inactive') {
                // Discrete timeout cycle, clamped at the ends.
                item.statusProvider = function() {
                    return '< ' + self._powerOffOptions[self._powerOffIndex] + ' >';
                };
                item.atStart = function() { return self._powerOffIndex <= 0; };
                item.atEnd   = function() {
                    return self._powerOffIndex >= self._powerOffOptions.length - 1;
                };
                item.onAdjust = function(dir) {
                    var idx = self._powerOffIndex + (dir === 'right' ? 1 : -1);
                    if (idx < 0) idx = 0;
                    if (idx > self._powerOffOptions.length - 1) {
                        idx = self._powerOffOptions.length - 1;
                    }
                    self._powerOffIndex = idx;
                };
            }
        }
        return sub;
    };

    PowerMenuUIDemoScene.prototype.enter  = function() {
        var self = this;
        // Touchpad stream — only used to drag-scroll the help body
        // while the help overlay is open. Absolute (x, y, touch)
        // per message, same feed Touchpad ABS uses. On a fresh
        // touch we anchor the scroll; subsequent moves convert the
        // finger's Y delta into a line offset.
        if (typeof EventSource === 'undefined') return;
        try {
            this._touchES = new EventSource('/api/touchpad/xy');
        } catch (e) { this._touchES = null; return; }
        // Pixels scrolled per raw touchpad-Y unit. The pad's Y
        // spans ~400 raw units end-to-end (same scale the App
        // Switcher calibrates against), so 0.25 px/unit makes a
        // full-pad swipe scroll ~100 px — comfortably more than
        // the body's scroll range. Pixel-granular (not line-
        // snapped) so the text tracks the finger smoothly.
        var TOUCH_PX_PER_UNIT = 0.25;
        this._touchES.onmessage = function(ev) {
            if (!self._helpOpen) { self._helpTouchActive = false; return; }
            var p = ev.data.split(',');
            if (p.length < 3) return;
            var ny = +p[1], nt = +p[2];
            if (ny !== ny) return;   // NaN guard
            if (nt === 1) {
                if (!self._helpTouchActive) {
                    self._helpTouchActive  = true;
                    self._helpTouchBaseY   = ny;
                    self._helpTouchScroll0 = self._helpScrollPx;
                } else {
                    // Finger up (ny decreasing) scrolls forward.
                    var dPx = Math.round((self._helpTouchBaseY - ny) * TOUCH_PX_PER_UNIT);
                    var off = self._helpTouchScroll0 + dPx;
                    if (off < 0) off = 0;
                    if (off > self._helpMaxScrollPx) off = self._helpMaxScrollPx;
                    if (off !== self._helpScrollPx) {
                        self._helpScrollPx = off;
                        if (typeof window.requestRender === 'function') window.requestRender();
                    }
                }
            } else {
                self._helpTouchActive = false;
            }
        };
    };
    PowerMenuUIDemoScene.prototype.exit   = function() {
        if (this._touchES) {
            try { this._touchES.close(); } catch (e) {}
            this._touchES = null;
        }
    };

    PowerMenuUIDemoScene.prototype.handleInput = function(action) {
        var self = this;
        // Shared press-flash + onPress dispatch for the app-
        // defined buttons (mirrors the pattern the other app
        // scenes use): press → render → release after 30 ms →
        // fire callback. Visual confirmation only for now since
        // every onPress is a stub.
        function flashAndFire(btn) {
            if (!btn) return;
            btn.press();
            if (typeof window.requestRender === 'function') window.requestRender();
            setTimeout(function() {
                btn.release();
                if (typeof window.requestRender === 'function') window.requestRender();
            }, 30);
            if (typeof btn.onPress === 'function') btn.onPress();
        }

        // While the help overlay is open it owns all input:
        //   • up / down  → scroll the body text by one line
        //   • edit (X) / esc (Z) / back → close
        if (this._helpOpen) {
            if (action === 'up') {
                this._helpScrollPx = Math.max(0, this._helpScrollPx - HELP_LINE_H);
            } else if (action === 'down') {
                this._helpScrollPx = Math.min(this._helpMaxScrollPx,
                                              this._helpScrollPx + HELP_LINE_H);
            } else if (action === 'edit' || action === 'esc' || action === 'back') {
                this._helpOpen = false;
            }
            if (typeof window.requestRender === 'function') window.requestRender();
            return;
        }

        // While the power modal is open it owns all input.
        if (this._modalOpen) {
            var mn = this._modalItems.length;
            if (action === 'up') {
                this._modalIndex = (this._modalIndex - 1 + mn) % mn;
            } else if (action === 'down') {
                this._modalIndex = (this._modalIndex + 1) % mn;
            } else if (action === 'esc' || action === 'back') {
                this._modalOpen = false;   // Z / back closes it
            } else if (action === 'ok' || action === 'run') {
                // Act on the selection, then close.
                var sel = this._modalItems[this._modalIndex];
                this._modalOpen = false;
                if (this._linuxMode) {
                    // Shutdown / Reboot both return to the main
                    // Power-menu demo screen.
                    this._linuxMode = false;
                } else if (sel === 'Start Linux') {
                    // Enter the Linux-mode placeholder screen.
                    this._linuxMode = true;
                }
                // Maskrom / Power OFF: no-op (just close).
            }
            if (typeof window.requestRender === 'function') window.requestRender();
            return;
        }

        // Z (the Power button) opens the power modal — its items
        // depend on the current screen.
        if (action === 'esc') {
            this._modalItems = this._linuxMode
                ? this._modalItemsLinux : this._modalItemsMain;
            this._modalIndex = this._linuxMode ? 0 : 1;
            this._modalOpen  = true;
            if (typeof window.requestRender === 'function') window.requestRender();
            return;
        }

        // Linux-mode screen: only Z (handled above) and Back are
        // live. Back returns to the main demo screen.
        if (this._linuxMode) {
            if (action === 'back') {
                this._linuxMode = false;
                if (typeof window.requestRender === 'function') window.requestRender();
            }
            return;
        }

        // ── Main screen actions ──────────────────────────────────
        // X (the Help button) opens the help overlay (scrolled to
        // the top).
        if (action === 'edit') { this._helpOpen = true;
                                 this._helpScrollPx = 0;
                                 if (typeof window.requestRender === 'function') window.requestRender();
                                 return; }
        if (action === 'del')  { flashAndFire(this._settingsBtn); return; }

        // 'back' (Escape / Backspace keys) still exits the demo.
        if (action === 'back') return 'pop';
    };

    PowerMenuUIDemoScene.prototype.render = function(canvas) {
        canvas.clear('#fff');

        // ── Linux-mode screen ────────────────────────────────────
        // Empty body with the standard (black) status bar, and a
        // centred "Linux mode" label. Z opens the Shutdown/Reboot
        // modal (rendered on top); nothing else is drawn here.
        if (this._linuxMode) {
            if (typeof UI !== 'undefined' && typeof UI.drawStatusBar === 'function') {
                UI.drawStatusBar(canvas, '');
            }
            var lt = 'Linux mode';
            var lw = HaxrcorpFont16.textWidth(lt);
            HaxrcorpFont16.draw(canvas.ctx, lt,
                Math.floor((canvas.w - lw) / 2),
                Math.floor((canvas.h - 9) / 2), '#000');
            if (this._modalOpen) this._renderPowerModal(canvas);
            return;
        }

        // White background, no status-bar strip, no network
        // icons. Shared chrome paints the dev label top-left and
        // the battery top-right (both per drawDemoChrome).
        drawDemoChrome(canvas);

        // Sleep face — 50×31 grayscale icon. Left edge 113 px from
        // the screen's left; bottom edge 64 px from the screen's
        // bottom, so the top-left lands at (113, 144 − 64 − 31 = 49).
        if (typeof Icons !== 'undefined' && Icons.sleep_small_face) {
            canvas.drawSprite(Icons.sleep_small_face, 113,
                canvas.h - 64 - Icons.sleep_small_face.h, '#000');
        }

        // App-defined buttons along the bottom row. Power's and
        // Help's toggle bars track their open states.
        if (this._powerBtn) this._powerBtn.toggled = this._modalOpen;
        if (this._helpBtn)  this._helpBtn.toggled  = this._helpOpen;
        if (this._helpBtn)     this._helpBtn.render(canvas);
        if (this._powerBtn)    this._powerBtn.render(canvas);
        if (this._settingsBtn) this._settingsBtn.render(canvas);

        // Power modal on top of everything (when open).
        if (this._modalOpen) {
            this._renderPowerModal(canvas);
            // Re-draw the Power button ON TOP of the modal's
            // semitransparent wash so it stays crisp (not dimmed)
            // and its toggled bar reads clearly while the modal
            // is up. The other buttons stay washed-out underneath.
            if (this._powerBtn) this._powerBtn.render(canvas);
        }

        // Help overlay (when open). Like the power modal, the
        // Help button is re-drawn on top of the overlay's wash so
        // it stays crisp with its toggled bar showing.
        if (this._helpOpen) {
            this._renderHelpOverlay(canvas);
            if (this._helpBtn) this._helpBtn.render(canvas);
        }
    };

    // Help overlay panel — 240×106, black stroke / white fill,
    // 4 px corners. Horizontally centred (x = (256−240)/2 = 8);
    // its bottom edge sits 18 px above the screen's bottom edge
    // (panel bottom = 144 − 18 = 126 → panel top = 126 − 106 = 20).
    PowerMenuUIDemoScene.prototype._renderHelpOverlay = function(canvas) {
        var W = 240, H = 106;
        var x = Math.floor((canvas.w - W) / 2);   // 8
        var y = canvas.h - 18 - H;                 // 20

        // Dim the background so the help panel reads as foreground
        // (same wash the power modal uses).
        canvas.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        canvas.ctx.fillRect(0, 0, canvas.w, canvas.h);

        // Tab behind the panel — black with 4 px rounded corners,
        // sized to the title plus 6 px padding on each side, flush
        // with the panel's left edge and 1 px down from the
        // screen's top. Drawn BEFORE the frame so the white panel
        // covers its lower portion, leaving the rounded top
        // peeking out above the panel like a folder tab.
        var tabTitle = 'Help - Flipper One';
        var ttW   = HaxrcorpFont16.textWidth(tabTitle);
        var TAB_W = ttW + 12;   // 6 px padding left + right
        var TAB_H = 26;
        new ResponsiveFrame({
            x: x,           y: 1,
            width: TAB_W,   height: TAB_H,
            anchorH: 'left',  anchorV: 'top',
            fillColor:   '#000',
            showFill:    true,
            showStroke:  false,
            cornerRadius: 4
        }).render(canvas);
        // Tab title — white HaxrcorpFont16, 6 px in from the tab's
        // left edge, vertically centred in the tab's visible strip
        // (the part above the panel's top edge, y = 1 .. panel top).
        var ttX = x + 6;
        var ttY = 1 + Math.floor(((y - 1) - 9) / 2);   // centre 9px glyph in the strip
        HaxrcorpFont16.draw(canvas.ctx, tabTitle, ttX, ttY, '#fff');

        // Panel frame on top.
        new ResponsiveFrame({
            x: x,           y: y,
            width: W,       height: H,
            anchorH: 'left',  anchorV: 'top',
            fillColor:   '#fff',
            strokeColor: '#000',
            showFill:    true,
            showStroke:  true,
            cornerRadius: 4
        }).render(canvas);

        // ── Scrollable body text (pixel-granular) ───────────────
        // Content area: 6 px pad on the left/top, room on the
        // right for the scrollbar. Lines are HaxrcorpFont16 at
        // HELP_LINE_H pitch; the whole block scrolls by
        // `_helpScrollPx` pixels, so partial lines show at the
        // top/bottom of the viewport (clipped). Wrap is cached
        // (width is constant).
        var PAD     = 6;
        var SB_ZONE = 8;                        // right strip for the scrollbar
        var textX   = x + PAD;
        var textTop = y + PAD;
        var textW   = W - PAD - SB_ZONE;
        var viewH   = H - PAD * 2;              // visible pixel height of the body

        if (!this._helpLines) {
            this._helpLines = wrapText(this._helpText, textW);
        }
        var lines = this._helpLines;
        var contentH = lines.length * HELP_LINE_H;
        this._helpMaxScrollPx = Math.max(0, contentH - viewH);
        if (this._helpScrollPx > this._helpMaxScrollPx) {
            this._helpScrollPx = this._helpMaxScrollPx;
        }

        // Clip to the body viewport, then draw every line whose
        // pixel range intersects it, offset by the scroll.
        var ctx = canvas.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.rect(textX, textTop, textW, viewH);
        ctx.clip();
        for (var li = 0; li < lines.length; li++) {
            var lineY = textTop + li * HELP_LINE_H - this._helpScrollPx;
            if (lineY + HELP_LINE_H <= textTop) continue;   // above viewport
            if (lineY >= textTop + viewH) break;            // below viewport
            HaxrcorpFont16.draw(ctx, lines[li], textX, lineY, '#000');
        }
        ctx.restore();

        // Scrollbar on the right (only when the text overflows).
        // Fed pixel values — Scrollbar's thumb math is ratio-based
        // so it works the same with px as with item counts.
        if (contentH > viewH && typeof UI !== 'undefined' && UI.Scrollbar) {
            var sb = new UI.Scrollbar(contentH, viewH, this._helpScrollPx);
            sb.render(canvas, x + W - 5, textTop, viewH, 1);
        }
    };

    // Centered boot / power modal: Start Linux / Maskrom /
    // Power OFF. Box width = longest item + 10; height =
    // count × line-height + 5 (a small top/bottom gap). The
    // highlighted row gets a MenuSelectorFrame inset 2 px from
    // the box's left and right edges. Items are centered in
    // Born2bSportyV2Medium (matching the mockup).
    var MODAL_SEL_H = 14;   // highlight frame height
    var MODAL_GAP   = 9;    // white gap between consecutive lines
    PowerMenuUIDemoScene.prototype._renderPowerModal = function(canvas) {
        var ctx   = canvas.ctx;
        var items = this._modalItems;
        var n     = items.length;

        // Longest item drives the box width. Every row — selected
        // or not — uses HaxrcorpFont16; selection is shown by the
        // frame alone, no font swap.
        var maxW = 0;
        for (var i = 0; i < n; i++) {
            var w = HaxrcorpFont16.textWidth(items[i]);
            if (w > maxW) maxW = w;
        }
        // 10 px from the longest text to the modal's left edge and
        // 11 px to the right edge (right gap is 1 px wider). The
        // text is centred via floor(), which places the extra
        // odd pixel on the right.
        var modalW = maxW + 21;
        // Vertical layout is measured from the TEXT edges:
        //   • 7 px from the modal's top edge to the first line's
        //     text top, and from the last line's text bottom to
        //     the modal's bottom edge.
        //   • MODAL_GAP px of white between consecutive text lines.
        // HaxrcorpFont16's visible glyph starts 1 px below its
        // draw-y and is ~9 px tall (cell rows 1..9).
        var TOP_GAP      = 6;   // text top → modal top edge
        var BOTTOM_GAP   = 7;   // text bottom → modal bottom edge
        var TEXT_VIS_TOP = 1;
        var TEXT_VIS_H   = 9;
        var modalH = TOP_GAP + BOTTOM_GAP + n * TEXT_VIS_H + (n - 1) * MODAL_GAP;
        var modalX = Math.floor((canvas.w - modalW) / 2);
        var modalY = Math.floor((canvas.h - modalH) / 2);

        // Dim the background so the modal reads as foreground.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.fillRect(0, 0, canvas.w, canvas.h);

        // Box — white fill, black rounded border.
        new ResponsiveFrame({
            x: modalX,       y: modalY,
            width: modalW,   height: modalH,
            anchorH: 'left',  anchorV: 'top',
            fillColor:   '#fff',
            strokeColor: '#000',
            showFill:    true,
            showStroke:  true,
            cornerRadius: 5
        }).render(canvas);

        // Items + selector. Text lines are spaced by their visible
        // height + MODAL_GAP; every row is HaxrcorpFont16, the
        // selected one also gets the frame (centred on its text).
        var linePitch = TEXT_VIS_H + MODAL_GAP;
        for (var j = 0; j < n; j++) {
            // draw-y so the visible glyph top lands TOP_GAP below
            // the modal top for line 0, then steps by linePitch.
            var drawY      = modalY + TOP_GAP - TEXT_VIS_TOP + j * linePitch;
            var isSel      = (j === this._modalIndex);
            var tw         = HaxrcorpFont16.textWidth(items[j]);
            var tx         = modalX + Math.floor((modalW - tw) / 2);
            HaxrcorpFont16.draw(ctx, items[j], tx, drawY, '#000');
            if (isSel) {
                // Fixed-width selector: 3 px in from the modal's
                // left and right edges, same size for every row so
                // it doesn't resize as the highlight moves between
                // lines. Centred vertically on the visible text.
                var visCenter = drawY + TEXT_VIS_TOP + TEXT_VIS_H / 2;
                var selY      = Math.round(visCenter - MODAL_SEL_H / 2);
                this._modalSelectorFrame.setPosition(modalX + 3, selY);
                this._modalSelectorFrame.setSize(modalW - 6, MODAL_SEL_H);
                this._modalSelectorFrame.render(canvas);
            }
        }
    };

    return PowerMenuUIDemoScene;
})();
