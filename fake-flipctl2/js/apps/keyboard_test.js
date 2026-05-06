/**
 * KeyboardTestScene
 *
 * Sandbox for the on-screen keyboard. Renders the standard chrome
 * (TabHeader, TextInputBox, InputField with a blinking cursor) plus
 * the UI.Keyboard component so the user can type and watch the
 * input field update in real time.
 *
 * Layout follows the keyboard's natural geometry — TextInputBox /
 * InputField are positioned 16/26 px from the top, the keyboard
 * sits at y = 70. The status bar still paints over the top.
 *
 * Input mapping:
 *   - up / down / left / right  → move keyboard cursor
 *   - ok                        → insert highlighted char
 *   - back                      → backspace one char (matches
 *                                 UI.Keyboard's built-in convention)
 *   - esc                       → pop the scene
 *
 * Touchpad: subscribes to the kernel-evdev SSE stream (same
 * endpoint TouchpadAbsScene / AppSwitcherScene use). Y axis maps
 * to row selection, X axis to column selection. Linear: every
 * TP_*_UNITS_PER_STEP raw units of finger motion ticks the
 * highlight one cell. No velocity / momentum — when the finger
 * stops or lifts, the highlight stays exactly where the finger
 * left it.
 */
var KeyboardTestScene = (function() {
    // Pad units → keyboard step. The pad's raw Y axis spans
    // ~400 units; with 3 rows, 130/row puts a full-pad Y sweep
    // squarely on a row-to-row traversal. X is sized so a full
    // pad sweep covers ~12 cols (the widest row), at ~32 raw
    // units per column step.
    var TP_X_UNITS_PER_STEP = 32;
    var TP_Y_UNITS_PER_STEP = 130;
    // Sensitivity knob. Raw axis deltas are divided by this before
    // the step math runs, so 1 = baseline speed, 2 = drag twice
    // as far for the same step, etc. Bump it to make the highlight
    // feel slower / less twitchy under the finger.
    var TP_SLOW_DIVIDER = 2;

    // Long-press threshold (ms) on the OK key while the highlight
    // sits on the shift cell. A press shorter than this cycles the
    // standard 'off' ↔ 'shift' state via UI.Keyboard's tap toggle;
    // a press longer than this latches caps lock.
    var SHIFT_LONGPRESS_MS = 500;
    // Browser keys that fire the OK action (mirrors KEY_MAP in
    // input.js). Only these warrant the long-press timer.
    var OK_KEYS = { 'Enter': 1, 'k': 1 };

    // App-defined bottom-bar buttons. Same 48 × 2 px slot
    // convention UIDemoScene uses, so Close / 123 / Done line up
    // visually with anything else that draws bottom buttons.
    var BTN_W   = 48;
    var BTN_GAP = 2;

    function KeyboardTestScene() {
        this.displayName = 'Screen Keyboard';
    }

    KeyboardTestScene.prototype.enter = function() {
        var self = this;

        this.inputText  = '';
        this.tabHeader  = new UI.TabHeader('Type to test');
        this.inputBox   = new UI.TextInputBox();
        this.inputField = new UI.InputField();
        this.cursor     = new BlinkingKeyboardCursor(500);

        // Three layouts.
        //
        // ABC uses sentinel chars ('⇧' shift, '⌘' lang, ' ' space)
        // that drawKeyboard / UI.Keyboard recognise as wide keys
        // with special rendering / behaviour.
        //
        // SYM and SYM2 are the symbol layouts. They share a top
        // row (digits 1-0 + dash) and a bottom row of punctuation
        // bracketed by wide '_' / '.' (no shift / no space — just
        // wide non-functional cells). Their middle rows differ —
        // each one's first wide cell ('<>|' on SYM, '[]◇' on
        // SYM2) acts as a switch-layout indicator: pressing it
        // toggles to the other symbol layout, mirroring how the
        // 123 / ABC bottom button toggles ABC ↔ SYM. Cell
        // onPress callbacks (handled by UI.Keyboard) carry the
        // toggle behaviour without any character emission.
        var switchSym = function() { self._switchSymLayout(); };
        this._layoutABC = [
            ['q','w','e','r','t','y','u','i','o','p','['],
            ['⌘','a','s','d','f','g','h','j','k','l',':',']'],
            ['⇧','z','x','c','v','b','n','m',',','.','/','?',' ']
        ];
        this._layoutSYM = [
            ['1','2','3','4','5','6','7','8','9','0','-'],
            [{text:'<>|', wide:true, onPress: switchSym},
             '+', '(', ')', '=', '{', '}', '@', '#', '$', '?', ';'],
            [{text:'_',   wide:true}, '%', '^', '&', '*', '`', '~', '\\', ',', '.', ':', '/',
             {text:'.',   wide:true}]
        ];
        this._layoutSYM2 = [
            ['1','2','3','4','5','6','7','8','9','0','-'],
            [{text:'[]◇', wide:true, onPress: switchSym},
             '[', ']', '<', '>', '|', '"', "'", '±', '!', '?', ';'],
            [{text:'_',   wide:true}, '%', '^', '&', '*', '`', '~', '\\', ',', '.', ':', '/',
             {text:'.',   wide:true}]
        ];
        this._layout = 'abc';

        this.keyboard = new UI.Keyboard(
            this._layoutABC,
            function(char) {
                if (char === '\b') {
                    self.inputText = self.inputText.slice(0, -1);
                } else {
                    self.inputText += char;
                }
                if (self.cursor) self.cursor.reset();
                if (window.requestRender) window.requestRender();
            },
            null   // no onClose — esc returns 'pop' from handleInput
        );

        // Cursor blink ticker — without it the field would freeze
        // on whichever cursor visibility was active when the last
        // key was pressed.
        this._blinkTimer = setInterval(function() {
            if (window.requestRender) window.requestRender();
        }, 250);

        // ── App-defined bottom-bar buttons ────────────────────────
        // Close (left, fires on esc)  — pops the scene.
        // Done  (right, fires on run) — also pops for now; future
        //                                wiring will commit the
        //                                input field elsewhere.
        // 123   (middle slot index 1, fires on edit) — swaps the
        //                                keyboard between the
        //                                alphabet and symbol
        //                                layouts. Label flips
        //                                between '123' and 'ABC'
        //                                so the user can see what
        //                                pressing it will do next.
        this._closeBtn = new UI.LeftButton(  'Close', BTN_W, 'esc', function() { /* esc → pop handled in handleInput */ });
        this._123Btn   = new UI.MiddleButton('123',   1, BTN_W, BTN_GAP, 'edit', function() { self._toggleLayout(); });
        this._doneBtn  = new UI.RightButton( 'Done',  BTN_W, 'run', function() { /* run → pop handled in handleInput */ });
        this._bottomBtns = [this._closeBtn, this._123Btn, this._doneBtn];
        // action → button lookup so handleInput can flash the
        // matching button.
        this._btnActionMap = {};
        for (var bi = 0; bi < this._bottomBtns.length; bi++) {
            var bb = this._bottomBtns[bi];
            if (bb && bb.action) this._btnActionMap[bb.action] = bb;
        }
        // Sync the keyboard's layout indicator to whatever layout
        // we're starting with (defaults to 'abc' / 'EN').
        this.keyboard.langLabel = (this._layout === 'sym') ? '123' : 'EN';

        // ── Touchpad ──────────────────────────────────────────────
        // Linear mapping only: target row/col = baseline + dx/dy
        // ÷ step. No velocity sampling, no momentum projection on
        // release — the highlight tracks the finger directly and
        // stops where the finger stops.
        this._tpTouching    = false;
        this._tpBaselineX   = 0;
        this._tpBaselineY   = 0;
        this._tpBaselineRow = 0;
        this._tpBaselineCol = 0;
        try {
            this._tpES = new EventSource('/api/touchpad/xy');
            this._tpES.onmessage = function(e) { self._handleTouchpadMessage(e); };
            this._tpES.onerror   = function() { /* keyboard input still works */ };
        } catch (err) {
            this._tpES = null;
        }

        // ── Long-press shift detection ───────────────────────────
        // Document-level keydown/keyup listeners track how long the
        // OK key is held while the highlight sits on the shift
        // cell. We work alongside Input.js (which queues 'ok'
        // actions) — the keydown handler here filters auto-repeats
        // and stamps a press start; the keyup handler measures
        // duration on release and, if past threshold, latches
        // shiftState to 'caps'. Auto-repeat suppression for the
        // tap-toggle path is handled in `handleInput` via the
        // `_shiftToggledThisPress` flag.
        this._shiftPressStart        = null;
        this._shiftToggledThisPress  = false;
        this._onSceneKeyDown = function(e) {
            if (e.repeat)                  return;   // auto-repeat: ignore
            if (!OK_KEYS[e.key])           return;
            if (!self._isHighlightOnShift()) return;
            self._shiftPressStart       = Date.now();
            self._shiftToggledThisPress = false;
        };
        this._onSceneKeyUp = function(e) {
            if (!OK_KEYS[e.key])     return;
            if (self._shiftPressStart === null) return;
            var dur = Date.now() - self._shiftPressStart;
            self._shiftPressStart       = null;
            self._shiftToggledThisPress = false;
            if (dur >= SHIFT_LONGPRESS_MS && self.keyboard) {
                // Long press latches caps lock. Overrides whatever
                // the tap-toggle put us in (could have been 'shift',
                // or 'off' if a previous tap left us in 'caps').
                self.keyboard.shiftState = 'caps';
                if (window.requestRender) window.requestRender();
            }
        };
        document.addEventListener('keydown', this._onSceneKeyDown);
        document.addEventListener('keyup',   this._onSceneKeyUp);
    };

    KeyboardTestScene.prototype.exit = function() {
        if (this._blinkTimer) {
            clearInterval(this._blinkTimer);
            this._blinkTimer = null;
        }
        if (this._tpES) {
            this._tpES.close();
            this._tpES = null;
        }
        if (this._onSceneKeyDown) {
            document.removeEventListener('keydown', this._onSceneKeyDown);
            this._onSceneKeyDown = null;
        }
        if (this._onSceneKeyUp) {
            document.removeEventListener('keyup', this._onSceneKeyUp);
            this._onSceneKeyUp = null;
        }
    };

    // True when the currently-selected key is the wide shift cell
    // at col 0 of the last row. Used by the long-press timer + the
    // auto-repeat suppression in handleInput. Only the alphabet
    // layout has a shift cell — the symbol layout's bottom-left is
    // a wide '_' that doesn't carry shift behaviour.
    KeyboardTestScene.prototype._isHighlightOnShift = function() {
        if (!this.keyboard) return false;
        if (this._layout !== 'abc') return false;
        var rows = this.keyboard.rows;
        var lastRow = rows.length - 1;
        if (this.keyboard.selectedRow !== lastRow) return false;
        if (this.keyboard.selectedCol !== 0)        return false;
        return rows[lastRow][0] === '⇧';
    };

    // Swap between the alphabet layout and the symbol layouts.
    // Pressing the 123 button while in ABC takes the user to SYM.
    // Pressing it while in either SYM or SYM2 returns to ABC. The
    // gray top-row indicator flips 'EN' ↔ '123' and the middle
    // button label flips '123' ↔ 'ABC' so the affordance always
    // shows where pressing will go next.
    KeyboardTestScene.prototype._toggleLayout = function() {
        if (!this.keyboard) return;
        var inSymbols = (this._layout === 'sym' || this._layout === 'sym2');
        if (!inSymbols) {
            this._layout = 'sym';
            this.keyboard.rows      = this._layoutSYM;
            this.keyboard.langLabel = '123';
            this._123Btn.text       = 'ABC';
        } else {
            this._layout = 'abc';
            this.keyboard.rows      = this._layoutABC;
            this.keyboard.langLabel = 'EN';
            this._123Btn.text       = '123';
        }
        // Clamp the highlight to the new layout. Rows have the
        // same row count (3), so selectedRow stays valid; columns
        // can differ, so re-clamp via _setSelection.
        this._setSelection(this.keyboard.selectedRow, this.keyboard.selectedCol);
        // Drop any one-shot shift state — the SYM layouts have no
        // letters to apply it to anyway, and re-entering ABC
        // should start fresh.
        this.keyboard.shiftState = 'off';
        if (window.requestRender) window.requestRender();
    };

    // Toggle between the two symbol layouts. Wired into the wide
    // '<>|' / '[]◇' cell at row 1 col 0 of each SYM layout — those
    // cells act as switch-layout indicators (not chars to insert).
    // No-op while in ABC so an accidental call from any other path
    // can't drop the user into a symbols layout.
    KeyboardTestScene.prototype._switchSymLayout = function() {
        if (!this.keyboard) return;
        if (this._layout === 'sym') {
            this._layout = 'sym2';
            this.keyboard.rows = this._layoutSYM2;
        } else if (this._layout === 'sym2') {
            this._layout = 'sym';
            this.keyboard.rows = this._layoutSYM;
        } else {
            return;
        }
        this._setSelection(this.keyboard.selectedRow, this.keyboard.selectedCol);
        if (window.requestRender) window.requestRender();
    };

    // Move the keyboard's (selectedRow, selectedCol) to the given
    // integer target, clamping so the column never overflows the
    // row's length (rows differ in width).
    KeyboardTestScene.prototype._setSelection = function(row, col) {
        var rows = this.keyboard.rows;
        if (row < 0)             row = 0;
        if (row > rows.length-1) row = rows.length - 1;
        var rowLen = rows[row].length;
        if (col < 0)            col = 0;
        if (col > rowLen - 1)   col = rowLen - 1;
        this.keyboard.selectedRow = row;
        this.keyboard.selectedCol = col;
    };

    KeyboardTestScene.prototype._handleTouchpadMessage = function(e) {
        if (!this.keyboard) return;
        var p = e.data.split(',');
        if (p.length < 3) return;
        var nx = +p[0], ny = +p[1], nt = +p[2];
        if (nx !== nx || ny !== ny || (nt !== 0 && nt !== 1)) return;

        var nowTouching  = (nt === 1);
        var prevTouching = this._tpTouching;

        if (nowTouching && !prevTouching) {
            // Touch-down: anchor the drag to where the finger
            // landed and which key was already selected. Subsequent
            // movement is measured against this baseline.
            this._tpBaselineX   = nx;
            this._tpBaselineY   = ny;
            this._tpBaselineRow = this.keyboard.selectedRow;
            this._tpBaselineCol = this.keyboard.selectedCol;
        }

        if (nowTouching) {
            // Live drag: target row/col = baseline + (delta / step).
            // Raw deltas are first divided by TP_SLOW_DIVIDER so
            // the user can dial the overall pad-to-keyboard ratio
            // up or down without rebalancing the per-axis step
            // constants. Math.round then ticks the selection one
            // cell every effective ±STEP of finger motion.
            var dx = (nx - this._tpBaselineX) / TP_SLOW_DIVIDER;
            var dy = (ny - this._tpBaselineY) / TP_SLOW_DIVIDER;
            var targetRow = this._tpBaselineRow + Math.round(dy / TP_Y_UNITS_PER_STEP);
            var targetCol = this._tpBaselineCol + Math.round(dx / TP_X_UNITS_PER_STEP);
            this._setSelection(targetRow, targetCol);
        }

        this._tpTouching = nowTouching;
        if (window.requestRender) window.requestRender();
    };

    KeyboardTestScene.prototype.handleInput = function(action) {
        // Bottom-bar buttons take priority — flash + run their
        // onPress, then handle the consequence (pop) ourselves so
        // the press feedback reads cleanly.
        var btn = this._btnActionMap[action];
        if (btn) {
            btn.press();
            if (btn.onPress) btn.onPress();
            if (window.requestRender) window.requestRender();
            var self = this;
            setTimeout(function() {
                btn.release();
                if (window.requestRender) window.requestRender();
            }, 30);
            // 'esc' (Close) and 'run' (Done) both pop the scene;
            // the visual flash above runs first, the pop happens
            // after the press feedback gets a frame to render.
            if (action === 'esc' || action === 'run') return 'pop';
            return;
        }
        // Auto-repeat suppression for the shift tap-toggle. Browser
        // keyboards fire repeated keydown events while a key is
        // held, which would oscillate `shiftState` back-and-forth
        // through `off ↔ shift` during a long press. The first
        // press sets `_shiftToggledThisPress` here; subsequent OK
        // actions during the same hold are ignored (visually the
        // press flash also stays clamped to one tap). Cleared on
        // keyup by the long-press handler.
        if (action === 'ok' && this._isHighlightOnShift()) {
            if (this._shiftToggledThisPress) return;
            this._shiftToggledThisPress = true;
        }
        if (this.keyboard) this.keyboard.handleInput(action);
    };

    KeyboardTestScene.prototype.render = function(canvas) {
        canvas.clear('#fff');

        // Status bar (kept on top — TextInputBox sits below it at
        // y = 16, so the bar's 13 px never overlap).
        UI.drawStatusBar(canvas, '');

        // Tab header, text container, input field.
        this.tabHeader.render(canvas);
        this.inputBox.render(canvas);
        this.inputField.render(canvas);

        // Live text inside the input field. Same coordinates the
        // UIDemoScene uses (x = 25, y = 27) so the layout matches
        // production.
        this.cursor.update();
        HaxrcorpFont16.draw(canvas.ctx, this.inputText, 25, 27, '#000');
        if (this.cursor.isVisible()) {
            var cursorX = 25 + HaxrcorpFont16.textWidth(this.inputText) + 1;
            canvas.drawCursor(cursorX, 28, 1, 10, '#000');
        }

        // Keyboard popup.
        this.keyboard.render(canvas);

        // App-defined bottom-bar buttons sit on top of everything
        // (including the keyboard's empty bottom margin) so the
        // user can always reach Close / Done.
        for (var bi = 0; bi < this._bottomBtns.length; bi++) {
            var bb = this._bottomBtns[bi];
            if (bb) bb.render(canvas);
        }
    };

    return KeyboardTestScene;
})();
