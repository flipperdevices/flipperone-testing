/**
 * AppSwitcherScene
 *
 * Cover-flow style app switcher overlay. Cards live in a 1-D
 * carousel of integer "position" slots:
 *
 *   −2  ── reserved (off-screen above, not yet defined)
 *   −1  ── peek above the focused card
 *    0  ── focused / selected card
 *   +1  ── collapsed tab below the focused card
 *   +2  ── reserved (off-screen below, not yet defined)
 *
 * Each card carries a `position` and gets its geometry from the
 * POSITIONS map. Pressing Up shifts every card's position by +1
 * (so the card at −1 takes the focus, the focused card sinks to
 * +1); Down shifts by −1. A press is only honoured if some card
 * lands at position 0 after the shift — otherwise we'd lose
 * selection.
 *
 * Rendering uses per-corner radii (rTL/rTR/rBL/rBR) so the bottom
 * tab can have square top corners and rounded bottom corners. The
 * clip-mask path is built row-by-row to stay pixel-perfect with
 * the stroke; native canvas curve primitives anti-alias and would
 * leak sub-pixel artifacts past the rounded outline.
 *
 * Cards stroke only when focused — un-focused cards read as soft
 * gray-titled tabs.
 *
 * Activation:
 *   Tab (mapped to 'appsw' in input.js) toggles the switcher from
 *   any scene except FigmaLivePreviewScene. Esc / Back also dismiss.
 *   Up / Down navigate the stack while idle (REST phase).
 */
var AppSwitcherScene = (function() {
    function S(x, y, w, h, rTL, rTR, rBL, rBR) {
        return { x: x, y: y, w: w, h: h,
                 rTL: rTL, rTR: rTR, rBL: rBL, rBR: rBR };
    }

    // ── Position-indexed geometry ───────────────────────────────
    // Cards at positions outside this map are not rendered (the
    // carousel scrolls them off-screen).
    var POSITIONS = {};
    POSITIONS[-2] = S(8, 0,   240, 100, 4, 4, 4, 4);  // peek above the peek
    POSITIONS[-1] = S(5, 8,   246, 100, 4, 4, 4, 4);  // peek above
    POSITIONS[ 0] = S(2, 22,  252, 100, 4, 4, 4, 4);  // selected / main
    POSITIONS[ 1] = S(5, 122, 246,  14, 0, 0, 4, 4);  // tab below
    // Same tab shape as +1 but narrower (240 px vs 246 px) and
    // shifted 8 px lower so its top hides behind +1's body. Top
    // corners square (0), bottom corners rounded (4) — matches
    // the visual language of +1 since it reads as a continuation
    // of the tab stack.
    POSITIONS[ 2] = S(8, 130, 240,  14, 0, 0, 4, 4);  // tab behind the tab

    // Source state for the opening animation: a 1-px overscan
    // square-cornered rect that "zooms in" to position 0.
    var OPENING_START = S(-1, -1, 258, 146, 0, 0, 0, 0);

    // Off-screen-left target used by the kill animation. Same height
    // and y as POSITIONS[0]; x shifted so the entire 252-wide body
    // sits past the left edge (x = -260 → right edge at -8).
    var KILLED_STATE  = S(-260, 22, 252, 100, 4, 4, 4, 4);

    // ── Phase state machine ─────────────────────────────────────
    var PHASE_OPENING   = 'opening';
    var PHASE_REST      = 'rest';
    var PHASE_SCROLLING = 'scrolling';
    var PHASE_KILLING   = 'killing';

    var IMG_X = 0;
    var STROKE = '#000';
    var ANIM_DURATION_MS = 110;

    // Title bars — background color is position-indexed so deeper
    // cards in the stack get progressively lighter shades of gray
    // (the focused card is solid black). Any position not listed
    // falls back to the default gray.
    var TITLE_BAR_H  = 14;
    var TITLE_BAR_BG_DEFAULT = '#6E6E6E';
    var TITLE_BAR_BG_BY_POSITION = {};
    TITLE_BAR_BG_BY_POSITION[-2] = '#C3C3C3';
    TITLE_BAR_BG_BY_POSITION[-1] = '#6E6E6E';
    TITLE_BAR_BG_BY_POSITION[ 0] = '#000';
    TITLE_BAR_BG_BY_POSITION[ 1] = '#6E6E6E';
    TITLE_BAR_BG_BY_POSITION[ 2] = '#C3C3C3';
    var TITLE_BAR_FG = '#FFF';
    // Vertical center of the 7 px font in a 14 px bar would be 3,
    // but the glyph mass sits a bit below true center — offset 2
    // reads as visually centered.
    var TITLE_TEXT_Y_OFFSET = 2;

    function now() {
        return (typeof performance !== 'undefined' && performance.now)
            ? performance.now() : Date.now();
    }
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function lerp(a, b, t)   { return a + (b - a) * t; }

    function lerpState(a, b, t) {
        return {
            x:   Math.round(lerp(a.x,   b.x,   t)),
            y:   Math.round(lerp(a.y,   b.y,   t)),
            w:   Math.round(lerp(a.w,   b.w,   t)),
            h:   Math.round(lerp(a.h,   b.h,   t)),
            rTL: Math.round(lerp(a.rTL, b.rTL, t)),
            rTR: Math.round(lerp(a.rTR, b.rTR, t)),
            rBL: Math.round(lerp(a.rBL, b.rBL, t)),
            rBR: Math.round(lerp(a.rBR, b.rBR, t))
        };
    }

    // Add a clip subpath for a rounded rect with per-corner radii.
    // Built row-by-row from the same stair-step formula
    // ResponsiveFrame uses, so the clip aligns pixel-perfectly with
    // the stroke.
    function addBodyClipPath(ctx, x, y, w, h, rTL, rTR, rBL, rBR) {
        for (var dy = 0; dy < h; dy++) {
            var li = 0, ri = 0;
            if (dy < rTL)        li = Math.max(li, rTL - 1 - dy);
            if (dy >= h - rBL)   li = Math.max(li, dy - (h - rBL));
            if (dy < rTR)        ri = Math.max(ri, rTR - 1 - dy);
            if (dy >= h - rBR)   ri = Math.max(ri, dy - (h - rBR));
            var rowW = w - li - ri;
            if (rowW > 0) ctx.rect(x + li, y + dy, rowW, 1);
        }
    }

    function fillBody(canvas, s, color) {
        var ctx = canvas.ctx;
        ctx.save();
        ctx.beginPath();
        addBodyClipPath(ctx, s.x, s.y, s.w, s.h, s.rTL, s.rTR, s.rBL, s.rBR);
        ctx.clip();
        ctx.fillStyle = color;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.restore();
    }

    function drawFrameStroke(canvas, s, color) {
        var ctx = canvas.ctx;
        var x = s.x, y = s.y, w = s.w, h = s.h;
        var rTL = s.rTL, rTR = s.rTR, rBL = s.rBL, rBR = s.rBR;
        ctx.fillStyle = color;

        var topLen = w - rTL - rTR;
        if (topLen > 0) ctx.fillRect(x + rTL, y, topLen, 1);

        var botLen = w - rBL - rBR;
        if (botLen > 0) ctx.fillRect(x + rBL, y + h - 1, botLen, 1);

        var leftLen = h - rTL - rBL;
        if (leftLen > 0) ctx.fillRect(x, y + rTL, 1, leftLen);

        var rightLen = h - rTR - rBR;
        if (rightLen > 0) ctx.fillRect(x + w - 1, y + rTR, 1, rightLen);

        var i;
        for (i = 0; i < rTL; i++) ctx.fillRect(x + i,             y + rTL - 1 - i, 1, 1);
        for (i = 0; i < rTR; i++) ctx.fillRect(x + w - rTR + i,   y + i,           1, 1);
        for (i = 0; i < rBL; i++) ctx.fillRect(x + i,             y + h - rBL + i, 1, 1);
        for (i = 0; i < rBR; i++) ctx.fillRect(x + w - rBR + i,   y + h - 1 - i,   1, 1);
    }

    function drawTitleBar(canvas, s, name, bgColor) {
        var ctx = canvas.ctx;
        ctx.save();
        ctx.beginPath();
        addBodyClipPath(ctx, s.x, s.y, s.w, s.h, s.rTL, s.rTR, s.rBL, s.rBR);
        ctx.clip();
        ctx.fillStyle = bgColor;
        ctx.fillRect(s.x, s.y, s.w, TITLE_BAR_H);
        ctx.restore();

        if (name) {
            var tw = HaxrcorpFont16.textWidth(name);
            var tx = s.x + Math.floor((s.w - tw) / 2);
            var ty = s.y + TITLE_TEXT_Y_OFFSET;
            HaxrcorpFont16.draw(canvas.ctx, name, tx, ty, TITLE_BAR_FG);
        }
    }

    // Render one card at a given frame state. Layers, bottom-up:
    //   1. White body fill (rounded shape)
    //   2. Optional image, anchored to the frame's interior top —
    //      can be either an HTMLImageElement (loaded PNG) or an
    //      HTMLCanvasElement (live snapshot); drawImage handles both.
    //   3. Title bar (covers the image's top 14 px) — color pulled
    //      from TITLE_BAR_BG_BY_POSITION[card.position]
    //   4. Stroke — drawn only when the card is focused (position 0)
    function drawCard(canvas, state, card) {
        // The killing card has position 0 but is sliding off-screen;
        // selection emphasis (black bar + stroke) belongs on the
        // *surviving* card that's taking over slot 0, not on this
        // outgoing one.
        var selected = (card.position === 0 && !card.killing);
        var titleBg  = card.killing
            ? TITLE_BAR_BG_DEFAULT
            : (TITLE_BAR_BG_BY_POSITION[card.position] || TITLE_BAR_BG_DEFAULT);

        fillBody(canvas, state, '#FFF');

        // card.image may be either an HTMLImageElement (loaded PNG)
        // or an HTMLCanvasElement (captured snapshot). For images
        // we wait until .complete && .naturalWidth > 0 to avoid
        // drawing an unloaded source; canvases are always usable
        // immediately, identified by them having a width property
        // but no .naturalWidth.
        var img = card.image;
        var ready = img && (img.naturalWidth > 0
            || (img.tagName === 'CANVAS' && img.width > 0));
        if (ready) {
            var ctx = canvas.ctx;
            var imgY = state.y + 1;
            ctx.save();
            ctx.beginPath();
            addBodyClipPath(ctx, state.x, state.y, state.w, state.h,
                state.rTL, state.rTR, state.rBL, state.rBR);
            ctx.clip();
            ctx.drawImage(img, IMG_X, imgY);
            ctx.restore();
        }

        drawTitleBar(canvas, state, card.name, titleBg);
        if (selected) drawFrameStroke(canvas, state, STROKE);
    }

    // Build the card carousel from the global RunningApps list.
    // The first entry (most-recent) lands at position 0 (focused),
    // the next at -1, and so on — matching the recents-stack mental
    // model. Returns an empty array when no apps are running.
    function buildCardsFromRunningApps() {
        var apps = (typeof RunningApps !== 'undefined')
            ? RunningApps.list()
            : [];
        var cards = [];
        for (var i = 0; i < apps.length; i++) {
            cards.push({
                name:      apps[i].name,
                imagePath: apps[i].imagePath,
                image:     apps[i].image,    // pre-loaded by RunningApps.open
                position:  -i,
                animFrom:  null
            });
        }
        return cards;
    }

    function AppSwitcherScene(sceneManager) {
        // SceneManager handle, used by the OK action to launch the
        // focused app (pop self, push a fresh PlaceholderAppScene).
        this.sceneManager = sceneManager || null;
        // Carousel of cards. Populated in enter() — by then the
        // previous scene's exit() has run and any snapshot it took
        // is already stored in RunningApps. Each card carries:
        //   name      — string shown in its title bar
        //   imagePath — path used when re-launching from the switcher
        //   image     — HTMLImageElement (loaded PNG) or
        //               HTMLCanvasElement (captured snapshot)
        //   position  — current slot index (integer)
        //   animFrom  — slot index the card is animating *from*, or
        //               null at rest.
        //   killing   — flag: card is mid-kill animation, sliding off
        //               to the left and about to be removed.
        this.cards = [];
        this.phase = PHASE_OPENING;
        this._animStart = 0;
    }

    AppSwitcherScene.prototype.enter = function() {
        this.cards = buildCardsFromRunningApps();
        this._animStart = now();
    };
    AppSwitcherScene.prototype.exit = function() {};

    AppSwitcherScene.prototype._findFocused = function() {
        for (var i = 0; i < this.cards.length; i++) {
            if (this.cards[i].position === 0 && !this.cards[i].killing) {
                return this.cards[i];
            }
        }
        return null;
    };

    // Slide the focused card off-screen to the left, drop it from
    // RunningApps, and slide every other card up by one slot to fill
    // the gap. Phase = PHASE_KILLING for ANIM_DURATION_MS, then auto-
    // advances back to REST in render() and the killed card is
    // spliced out of `this.cards`.
    AppSwitcherScene.prototype._killFocused = function() {
        var focused = this._findFocused();
        if (!focused) return;

        focused.killing  = true;
        focused.animFrom = 0;

        // Drop the killed app from the global recents stack first;
        // the surviving cards' new positions then come from the
        // post-kill RunningApps order.
        if (typeof RunningApps !== 'undefined') {
            RunningApps.close(focused.name);
        }

        // Also splice any PlaceholderAppScene for this app out of
        // the scene stack — otherwise, dismissing the switcher
        // would land on the killed app's now-orphaned scene. We
        // skip ourselves (the switcher is at the top of the stack).
        if (this.sceneManager && this.sceneManager._stack
            && typeof PlaceholderAppScene !== 'undefined') {
            var stk = this.sceneManager._stack;
            for (var s = stk.length - 1; s >= 0; s--) {
                var sc = stk[s];
                if (sc === this) continue;
                if (sc instanceof PlaceholderAppScene
                    && sc.displayName === focused.name) {
                    stk.splice(s, 1);
                }
            }
        }

        var newList = (typeof RunningApps !== 'undefined') ? RunningApps.list() : [];
        var newPosByName = {};
        for (var k = 0; k < newList.length; k++) newPosByName[newList[k].name] = -k;

        for (var j = 0; j < this.cards.length; j++) {
            var c = this.cards[j];
            if (c === focused) continue;
            c.animFrom = c.position;
            if (c.name in newPosByName) c.position = newPosByName[c.name];
        }

        this.phase = PHASE_KILLING;
        this._animStart = now();
        if (typeof window.requestRender === 'function') window.requestRender();
    };

    AppSwitcherScene.prototype.handleInput = function(action) {
        if (action === 'appsw' || action === 'back') {
            // If the user has just killed every running app, the
            // stack underneath is unlikely to be a useful place to
            // return to (it's typically the menu chain that led to
            // the now-dead apps). Bail straight to Desktop instead
            // of bubbling back up through it.
            var noApps = (typeof RunningApps !== 'undefined')
                && RunningApps.list().length === 0;
            if (noApps && this.sceneManager) {
                this.sceneManager.popToRoot();
                return;
            }
            return 'pop';
        }

        // Navigation only valid when nothing is animating; otherwise
        // a fast double-press could double up the position shift.
        if (this.phase !== PHASE_REST) return;

        // OK launches the focused app. Strategy:
        //   1. Pop the switcher.
        //   2. Pop any PlaceholderAppScene already on the stack — so
        //      Back from the launched app returns to the menu (its
        //      original launcher), not to the previously-active app.
        //   3. Push a fresh PlaceholderAppScene for the focused entry.
        // RunningApps.open() inside the new scene's enter() bumps the
        // existing recents entry back to the top, so the registry
        // stays consistent with what the user just selected.
        if (action === 'ok' || action === 'run') {
            var ok = this._findFocused();
            if (ok && this.sceneManager && typeof PlaceholderAppScene !== 'undefined') {
                this.sceneManager.pop();
                while (this.sceneManager.current() instanceof PlaceholderAppScene) {
                    this.sceneManager.pop();
                }
                this.sceneManager.push(new PlaceholderAppScene(ok.imagePath, ok.name));
            }
            return;
        }

        // Esc kills the focused app — only when there's something to
        // kill. With an empty stack the press is a no-op.
        if (action === 'esc') {
            this._killFocused();
            return;
        }

        var delta = (action === 'up')   ?  1
                  : (action === 'down') ? -1
                  : 0;
        if (delta === 0) return;

        // Allow the shift only if some card will land at position 0
        // after it — i.e. there's a card currently at -delta to take
        // the focus. Without this guard, scrolling past the last
        // card would leave the carousel selection-less.
        var hasIncoming = false;
        for (var i = 0; i < this.cards.length; i++) {
            if (this.cards[i].position === -delta) { hasIncoming = true; break; }
        }
        if (!hasIncoming) return;

        // Capture each card's current position into animFrom and
        // commit the destination immediately. Render then lerps
        // between POSITIONS[animFrom] and POSITIONS[position].
        for (var j = 0; j < this.cards.length; j++) {
            this.cards[j].animFrom = this.cards[j].position;
            this.cards[j].position += delta;
        }
        this.phase = PHASE_SCROLLING;
        this._animStart = now();
        if (typeof window.requestRender === 'function') window.requestRender();
    };

    // Sort key: |interpolated position|. Smallest = closest to
    // focus = drawn last = on top. Cards animating between two
    // positions have a fractional position during the lerp, so
    // their z-order swap with neighbors lands at the moment they
    // cross at the same depth — no t=0 or t=1 snap.
    //
    // Killed cards always sort last (drawn on top) so they cleanly
    // slide *over* the surviving cards as they slide off-screen.
    function zKey(card, e) {
        if (card.killing) return -1;
        if (card.animFrom !== null) {
            return Math.abs(lerp(card.animFrom, card.position, e));
        }
        return Math.abs(card.position);
    }

    // Resolve a card's current frame state, accounting for the
    // active animation. Returns null if the card is at a position
    // with no geometry (off-carousel) and should be skipped.
    function getCardState(card, phase, t) {
        if (card.killing) {
            // Slide from POSITIONS[0] to KILLED_STATE — off-screen left.
            return lerpState(POSITIONS[0], KILLED_STATE, t);
        }
        if (phase === PHASE_OPENING && card.position === 0) {
            var endStateOpening = POSITIONS[0];
            return endStateOpening
                ? lerpState(OPENING_START, endStateOpening, t)
                : null;
        }
        if ((phase === PHASE_SCROLLING || phase === PHASE_KILLING) && card.animFrom !== null) {
            var fromState = POSITIONS[card.animFrom];
            var toState   = POSITIONS[card.position];
            if (fromState && toState) return lerpState(fromState, toState, t);
            return toState || fromState || null;
        }
        return POSITIONS[card.position] || null;
    }

    AppSwitcherScene.prototype.render = function(canvas) {
        var elapsed = now() - this._animStart;
        var t = elapsed / ANIM_DURATION_MS;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        var e = easeOutCubic(t);

        var animating = (this.phase !== PHASE_REST && t < 1);

        canvas.clear('#FFF');

        // Empty stack — no apps have been launched. Show a hint so
        // the screen doesn't look broken. Animation is skipped here.
        if (this.cards.length === 0) {
            var msg = 'No running apps';
            var w = HaxrcorpFont16.textWidth(msg);
            HaxrcorpFont16.draw(canvas.ctx, msg,
                Math.floor((canvas.w - w) / 2),
                Math.floor((canvas.h - 7) / 2),
                '#6E6E6E');
            return;
        }

        // Z-order = sort cards by interpolated |position|, deepest
        // first (so the focused card — closest to slot 0 — paints
        // last and ends up on top). Using the *interpolated*
        // position (lerp between animFrom and position) gives a
        // smooth swap as cards cross each other in depth during a
        // scroll, instead of a snap at t=0 or t=1.
        var renderOrder = this.cards.slice().sort(function(a, b) {
            return zKey(b, e) - zKey(a, e);
        });
        for (var i = 0; i < renderOrder.length; i++) {
            var card = renderOrder[i];
            var state = getCardState(card, this.phase, e);
            if (!state) continue;
            drawCard(canvas, state, card);
        }

        // "Kill" left-button — surfaces what Esc does. Drawn last so
        // it sits on top of any +1/+2 card visuals at the bottom of
        // the screen. Hidden during the kill animation so it doesn't
        // visually flicker as the killed card slides past it; comes
        // back as soon as we settle into REST.
        var hasFocus = this._findFocused() !== null;
        if (hasFocus && this.phase !== PHASE_KILLING) {
            canvas.drawLeftButton('Kill', 0, 48, false, false);
        }

        // Auto-advance phase on animation completion.
        if (t >= 1) {
            if (this.phase === PHASE_OPENING) {
                this.phase = PHASE_REST;
            } else if (this.phase === PHASE_SCROLLING) {
                this.phase = PHASE_REST;
                for (var k = 0; k < this.cards.length; k++) {
                    this.cards[k].animFrom = null;
                }
            } else if (this.phase === PHASE_KILLING) {
                // Drop killed cards from the carousel for good.
                this.cards = this.cards.filter(function(c) { return !c.killing; });
                for (var m = 0; m < this.cards.length; m++) {
                    this.cards[m].animFrom = null;
                }
                this.phase = PHASE_REST;
            }
        }

        if (animating && typeof window.requestRender === 'function') {
            window.requestRender();
        }
    };

    return AppSwitcherScene;
})();
