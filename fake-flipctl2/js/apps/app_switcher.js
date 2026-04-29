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
    // Carousel layout (most-recently-used first):
    //   0  — focused / latest opened app
    //  +1  — pre-latest, collapsed tab BELOW the focused card
    //  +2  — pre-pre-latest, deeper tab below (behind +1)
    //  -1  — peek slot ABOVE the focused card; this is where the
    //        focused card slides when the user presses Down,
    //        making room for whatever's at +1 to rise up into focus.
    //
    // Pressing Down decrements every card's position by 1 (so 0 →
    // -1, 1 → 0, 2 → 1) — visually the stack scrolls upward as the
    // older app at +1 takes the focus. Pressing Up increments by 1.
    // Position -2 is not yet implemented; cards reaching it just
    // disappear off-carousel.
    var POSITIONS = {};
    // 12 px from left, 1 px from top; right edge runs off the
    // canvas (12 + 252 = 264). Height stays at 100 — the focused
    // card covers most of it; only the top ~14 rows peek out.
    // Same color / corner-radius style as before.
    // -2 is the deepest visible slot in the older direction. With
    // the carousel oriented so older apps go to NEGATIVE positions,
    // this is where the third-most-recent app lands at idle, and
    // where the second-most-recent slides to after Down. Geometry
    // anchors it 12 px from canvas bottom (top y=128, h=13) with
    // 45 px left padding; right edge runs off-canvas like the
    // other tabs.
    // Carousel orientation (top → bottom = most-recent → most-old):
    //   +1 — peek ABOVE the focused card (where the just-demoted
    //        card slides after a Down press).
    //    0 — focused / latest opened.
    //   -1 — tab BELOW the focused card (next-older).
    //   -2 — deepest tab anchored to the bottom of the screen.
    // Top-left corner is square so the left-side stroke extends
    // the full 4 px higher (all the way to the frame's top edge)
    // — visually anchors the tab to the card above it.
    POSITIONS[-2] = S(50, 128, 252, 13, 0, 4, 4, 4);  // tab anchored low (oldest visible)
    POSITIONS[-1] = S(12, 115, 252, 13, 0, 0, 4, 4);  // tab below focused (older)
    POSITIONS[ 0] = S(2, 15,  252, 100, 4, 4, 4, 4);  // selected / main
    POSITIONS[ 1] = S(12, 1, 252, 100, 4, 4, 4, 4);   // peek above (just-demoted)
    // Slot +2 has no geometry on purpose — cards that travel past
    // +1 (e.g. via repeated Down presses) simply stop rendering
    // and fade out instead of sliding off-screen.

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
    // Animation duration. ANIM_SPEED is a debug multiplier — set to
    // a smaller value (e.g. 0.2) to slow every animation down by
    // that factor for visual inspection. Production: 1.0.
    var ANIM_DURATION_BASE_MS = 110;
    var ANIM_SPEED = 1;
    var ANIM_DURATION_MS = ANIM_DURATION_BASE_MS / ANIM_SPEED;

    // Title bars — background color and height are both position-
    // indexed. Deeper cards get progressively lighter shades of gray
    // (the focused card is solid black). The focused card is also a
    // little taller (16 px vs the default 14 px) for emphasis. Any
    // position not listed falls back to the defaults.
    var TITLE_BAR_H_DEFAULT = 14;
    var TITLE_BAR_H_BY_POSITION = {};
    TITLE_BAR_H_BY_POSITION[ 0] = 16;
    var TITLE_BAR_BG_DEFAULT = '#6E6E6E';
    var TITLE_BAR_BG_BY_POSITION = {};
    TITLE_BAR_BG_BY_POSITION[ 0] = '#000';      // focused
    // -1, +1, -2 render as tabs (white card via the TAB_CONFIG
    // path) rather than via this colored bar map.
    var TITLE_BAR_FG = '#FFF';
    // Title-bar typeface — Born2bSportyV2Medium for that chunky,
    // OS-chrome look. Mathematical centering gives 0 for a 14-px
    // bar and 1 for a 16-px bar, but the design calls for the text
    // riding 2 px higher than that, so we subtract 2:
    //   - 14 px bar → y_offset -2
    //   - 16 px bar → y_offset -1
    function titleTextYOffset(barH) {
        return Math.floor((barH - 14) / 2) - 2;
    }

    // Per-position config for slots that render in the "tab" style
    // (white body, gray 3-sided stroke, HaxrcorpFont16 gray label
    // left-aligned). The `openEdge` is the side that abuts the
    // focused stack and therefore omits its stroke. `labelDx /
    // labelDy` are pixel nudges applied to the label position.
    var TAB_CONFIG = {};
    // -2: deepest tab at the bottom of the screen.
    // -1: tab just below the focused card.
    // +1: peek-above tab (where the just-demoted card lands).
    // Each tab omits the stroke edge that abuts the focused stack:
    //   slots BELOW focused (-1, -2) → omit the TOP stroke.
    //   slot ABOVE focused (+1)      → omit the BOTTOM stroke.
    // `color` drives both the label and the stroke; deeper slots
    // get progressively lighter shades.
    TAB_CONFIG[-2] = { openEdge: 'top',    labelDx: 0, labelDy: 0, color: '#A7A7A7' };
    TAB_CONFIG[-1] = { openEdge: 'top',    labelDx: 1, labelDy: 0, color: '#666666' };
    TAB_CONFIG[ 1] = { openEdge: 'bottom', labelDx: 0, labelDy: 1, color: '#666666' };

    function now() {
        return (typeof performance !== 'undefined' && performance.now)
            ? performance.now() : Date.now();
    }
    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
    function lerp(a, b, t)   { return a + (b - a) * t; }

    function lerpState(a, b, t) {
        // Lerp the four EDGES independently (not x/w and y/h), then
        // derive width and height from the rounded edges. Rounding
        // x and w separately can put their rounding errors out of
        // phase — the visible right edge then jitters ±1 px even
        // though the underlying lerp is monotonic. Rounding the
        // left and right edges directly removes the second rounding
        // error and makes each edge step through the pixel grid
        // monotonically. Same trick for top/bottom.
        var aL = a.x,         aR = a.x + a.w;
        var aT = a.y,         aB = a.y + a.h;
        var bL = b.x,         bR = b.x + b.w;
        var bT = b.y,         bB = b.y + b.h;
        var L = Math.round(lerp(aL, bL, t));
        var R = Math.round(lerp(aR, bR, t));
        var T = Math.round(lerp(aT, bT, t));
        var B = Math.round(lerp(aB, bB, t));
        return {
            x:   L,
            y:   T,
            w:   R - L,
            h:   B - T,
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

    // Draw the 1 px outline matching the body shape. `edges` is an
    // optional object with boolean { top, bottom, left, right }
    // flags (each defaults to true). Setting `top: false` skips
    // the top horizontal line *and* its corner pixels — used by
    // position +1, which reads as a tab "anchored upward" with no
    // visible top edge.
    function drawFrameStroke(canvas, s, color, edges) {
        var top    = !edges || edges.top    !== false;
        var bottom = !edges || edges.bottom !== false;
        var left   = !edges || edges.left   !== false;
        var right  = !edges || edges.right  !== false;

        var ctx = canvas.ctx;
        var x = s.x, y = s.y, w = s.w, h = s.h;
        var rTL = s.rTL, rTR = s.rTR, rBL = s.rBL, rBR = s.rBR;
        ctx.fillStyle = color;

        if (top) {
            var topLen = w - rTL - rTR;
            if (topLen > 0) ctx.fillRect(x + rTL, y, topLen, 1);
        }
        if (bottom) {
            var botLen = w - rBL - rBR;
            if (botLen > 0) ctx.fillRect(x + rBL, y + h - 1, botLen, 1);
        }
        if (left) {
            var leftLen = h - rTL - rBL;
            if (leftLen > 0) ctx.fillRect(x, y + rTL, 1, leftLen);
        }
        if (right) {
            var rightLen = h - rTR - rBR;
            if (rightLen > 0) ctx.fillRect(x + w - 1, y + rTR, 1, rightLen);
        }

        var i;
        if (top) {
            for (i = 0; i < rTL; i++) ctx.fillRect(x + i,           y + rTL - 1 - i, 1, 1);
            for (i = 0; i < rTR; i++) ctx.fillRect(x + w - rTR + i, y + i,           1, 1);
        }
        if (bottom) {
            for (i = 0; i < rBL; i++) ctx.fillRect(x + i,           y + h - rBL + i, 1, 1);
            for (i = 0; i < rBR; i++) ctx.fillRect(x + w - rBR + i, y + h - 1 - i,   1, 1);
        }
    }

    function drawTitleBar(canvas, s, name, bgColor, barH, icon) {
        var ctx = canvas.ctx;
        ctx.save();
        ctx.beginPath();
        addBodyClipPath(ctx, s.x, s.y, s.w, s.h, s.rTL, s.rTR, s.rBL, s.rBR);
        ctx.clip();
        ctx.fillStyle = bgColor;
        ctx.fillRect(s.x, s.y, s.w, barH);
        ctx.restore();

        // App icon — top-left aligned, 3 px padding from the left
        // and top of the bar. drawSprite uses each pixel's
        // grayscale value as opacity for the supplied tint, so a
        // sprite authored as black-on-white naturally renders white
        // on top of the dark bar (no separate inverted asset
        // needed).
        var labelStartX = null;
        if (icon) {
            var iconX = s.x + 3;
            var iconY = s.y + 3;
            canvas.drawSprite(icon, iconX, iconY, TITLE_BAR_FG);
            labelStartX = iconX + icon.w + 3;   // 3 px gap to the label
        }

        if (name) {
            var ty = s.y + titleTextYOffset(barH);
            // All title bars now left-align: when there's an icon
            // the label sits 3 px after it; when there isn't, 3 px
            // in from the frame's left edge — no centered fallback.
            var tx = (labelStartX !== null) ? labelStartX : (s.x + 3);
            Born2bSportyV2Medium.draw(canvas.ctx, name, tx, ty, TITLE_BAR_FG);
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
    // Lerp a hex color #RRGGBB → channels lerped, return hex string.
    function lerpColor(a, b, t) {
        var ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
        var br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
        var r = Math.round(lerp(ar, br, t));
        var g = Math.round(lerp(ag, bg, t));
        var bl = Math.round(lerp(ab, bb, t));
        var pad = function(n) { return (n < 16 ? '0' : '') + n.toString(16); };
        return '#' + pad(r) + pad(g) + pad(bl);
    }

    function drawCard(canvas, state, card, e) {
        // Card-level alpha — fades the whole card in or out when it
        // animates between a slot that has POSITIONS geometry and
        // one that doesn't. Without this, a card pushed past +1
        // (which has no geometry) would stay parked at +1's place
        // throughout the animation and then snap out of existence
        // at t=1; symmetrically, one returning would pop in. The
        // fade lets it dissolve cleanly in either direction.
        var cardAlpha = 1;
        if (card.animFrom !== null) {
            var posExists = POSITIONS[card.position] !== undefined;
            var afpExists = POSITIONS[card.animFrom] !== undefined;
            if (afpExists && !posExists)      cardAlpha = 1 - e;
            else if (!afpExists && posExists) cardAlpha = e;
        }
        if (cardAlpha < 0.001) return;

        var topCtx = canvas.ctx;
        topCtx.save();
        topCtx.globalAlpha *= cardAlpha;

        fillBody(canvas, state, '#FFF');

        // Interpolated |position|. For an idle card it's just the
        // integer position; mid-animation it's the lerped value
        // between animFrom and position.
        var posAbs = card.animFrom !== null
            ? Math.abs(lerp(card.animFrom, card.position, e))
            : Math.abs(card.position);
        var posClamped = Math.max(0, Math.min(1, posAbs));

        // ── Image (fades with the focused style) ──────────────
        var img = card.image;
        var ready = img && (img.naturalWidth > 0
            || (img.tagName === 'CANVAS' && img.width > 0));
        if (ready) {
            var imgAlpha = 1 - posClamped;
            if (imgAlpha > 0.001) {
                var ictx = canvas.ctx;
                // Raise the screenshot 10 px above the frame's
                // interior top — the body clip mask will trim that
                // overflow, so the visible result is the source
                // image with its top 10 px cropped off.
                var imgY = state.y + 1 - 10;
                ictx.save();
                ictx.beginPath();
                addBodyClipPath(ictx, state.x, state.y, state.w, state.h,
                    state.rTL, state.rTR, state.rBL, state.rBR);
                ictx.clip();
                // Multiply *into* the existing alpha (which is the
                // card-level fade) instead of overwriting it.
                ictx.globalAlpha = ictx.globalAlpha * imgAlpha;
                ictx.drawImage(img, IMG_X, imgY);
                ictx.restore();
            }
        }

        // Killing override: snap to the default styling so the
        // outgoing card slides off in a neutral state.
        if (card.killing) {
            drawTitleBar(canvas, state, card.name,
                TITLE_BAR_BG_DEFAULT, TITLE_BAR_H_DEFAULT, card.icon);
            topCtx.restore();
            return;
        }

        // ── Deep zone (|pos| ≥ 2 and not a tab) — default
        // position-indexed bar. No 0↔±1 crossfade applies; just
        // paint the row's standard gray title bar. -2 is a tab
        // (in TAB_CONFIG), so it skips this branch.
        var posInTab = TAB_CONFIG[card.position] !== undefined;
        var afpInTab = card.animFrom !== null && TAB_CONFIG[card.animFrom] !== undefined;
        var deepZone = !posInTab && !afpInTab
            && (Math.abs(card.position) >= 2)
            && (card.animFrom === null || Math.abs(card.animFrom) >= 2);
        if (deepZone) {
            var dBg = TITLE_BAR_BG_BY_POSITION[card.position] || TITLE_BAR_BG_DEFAULT;
            var dBarH = TITLE_BAR_H_BY_POSITION[card.position] || TITLE_BAR_H_DEFAULT;
            drawTitleBar(canvas, state, card.name, dBg, dBarH, card.icon);
            topCtx.restore();
            return;
        }

        // ── 0 ↔ ±1 zone — crossfade focused style and tab style.
        // Each style fades linearly with posClamped, so at slot 0
        // we see only the focused look, at slot ±1 only the tab,
        // and mid-animation both at complementary alphas. The bar
        // background and text colors *also* interpolate, which
        // smooths the transition further than a pure alpha xfade.
        var focusedAlpha = 1 - posClamped;
        var tabAlpha     = posClamped;
        var ctx = canvas.ctx;

        // Focused style: black title bar with Born2bSporty centered,
        // 4-sided black stroke. As we approach ±1 the bg drifts to
        // white and the stroke to gray, so even at low alpha the
        // colors are blending toward the tab's palette.
        if (focusedAlpha > 0.001) {
            var fBg     = lerpColor('#000000', '#FFFFFF', posClamped);
            var fStroke = lerpColor('#000000', '#666666', posClamped);
            // Bar height stays at the focused 16; the body height
            // itself is interpolating with the geometry, so a
            // 16-px-tall bar tucked behind the body clip naturally
            // shrinks with the card.
            ctx.save();
            ctx.globalAlpha = ctx.globalAlpha * focusedAlpha;
            drawTitleBar(canvas, state, card.name, fBg, 16, card.icon);
            drawFrameStroke(canvas, state, fStroke);
            ctx.restore();
        }

        // Tab style: white card with HaxrcorpFont16 gray label and a
        // 3-sided gray stroke. The exact look (open edge + label
        // nudge) comes from TAB_CONFIG indexed by the card's tab
        // slot. Slot 0 idle has tabAlpha = 0 and skips this block.
        var tabCfg = TAB_CONFIG[card.position]
            || (card.animFrom !== null ? TAB_CONFIG[card.animFrom] : null);
        if (tabAlpha > 0.001 && tabCfg) {
            var tabColor = tabCfg.color || '#666666';
            ctx.save();
            ctx.globalAlpha = ctx.globalAlpha * tabAlpha;
            if (card.name) {
                HaxrcorpFont16.draw(canvas.ctx, card.name,
                    state.x + 3 + tabCfg.labelDx,
                    state.y + tabCfg.labelDy,
                    tabColor);
            }
            var edges = {};
            edges[tabCfg.openEdge] = false;
            drawFrameStroke(canvas, state, tabColor, edges);
            ctx.restore();
        }

        topCtx.restore();   // pair with the cardAlpha save() at the top
    }

    // Build the card carousel. If a `transient` card is supplied
    // (snapshot of a non-app scene like Desktop / Menu / Submenu),
    // it occupies slot 0 and pushes the running apps down to -1,
    // -2, … . The transient is NOT in RunningApps — it lives only
    // for this switcher session and dismisses without launching.
    // Without a transient, apps[0] (most-recent) takes slot 0.
    //
    // If there are no running apps, the transient is dropped on the
    // floor — the switcher should fall through to its empty-state
    // "No running apps" message instead of presenting the current
    // scene as if it were the only card. The carousel only earns
    // its place when there's something to switch *between*.
    function buildCardsFromRunningApps(transient) {
        var apps = (typeof RunningApps !== 'undefined')
            ? RunningApps.list()
            : [];
        if (apps.length === 0) return [];
        var cards = [];
        var startIdx = 0;
        if (transient) {
            cards.push({
                name:      transient.name,
                imagePath: null,
                image:     transient.snapshot,
                icon:      null,
                position:  0,
                animFrom:  null,
                transient: true     // not in RunningApps, can't be killed
            });
            startIdx = 1;          // running apps queue behind it (slot -1, -2, …)
        }
        for (var i = 0; i < apps.length; i++) {
            cards.push({
                name:      apps[i].name,
                imagePath: apps[i].imagePath,
                image:     apps[i].image,
                icon:      apps[i].icon,
                position:  -(i + startIdx),
                animFrom:  null
            });
        }
        return cards;
    }

    function AppSwitcherScene(sceneManager, transient) {
        // SceneManager handle, used by the OK action to launch the
        // focused app (pop self, push a fresh PlaceholderAppScene).
        this.sceneManager = sceneManager || null;
        // Optional snapshot of the non-app scene that opened the
        // switcher; rendered as the focused card and dismisses
        // (rather than launches) when the user picks it.
        this._transient = transient || null;
        this.cards = [];
        this.phase = PHASE_OPENING;
        this._animStart = 0;
    }

    AppSwitcherScene.prototype.enter = function() {
        this.cards = buildCardsFromRunningApps(this._transient);
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
        // Most-recent app keeps slot 0; older ones go to -1, -2, …
        for (var k = 0; k < newList.length; k++) newPosByName[newList[k].name] = -k;

        // If killing this app drains RunningApps, every surviving
        // card is a transient (current scene snapshot). The carousel
        // is collapsing to "no running apps" — drop those transients
        // *now* rather than carrying them through the kill animation,
        // so the user sees only App 01 sliding off, with no Desktop
        // frame parked above. The killed card itself is kept so its
        // slide-out still plays; render's t>=1 cleanup empties the
        // list and triggers the empty-state repaint.
        if (newList.length === 0) {
            this.cards = this.cards.filter(function(c) {
                return c === focused || !c.transient;
            });
        }

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
        if (action === 'back') {
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

        // OK / Run / Tab(=appsw) all launch the focused app. Strategy:
        //   1. Pop the switcher.
        //   2. Pop any PlaceholderAppScene already on the stack — so
        //      Back from the launched app returns to the menu (its
        //      original launcher), not to the previously-active app.
        //   3. Push a fresh PlaceholderAppScene for the focused entry.
        // RunningApps.open() inside the new scene's enter() bumps the
        // existing recents entry back to the top, so the registry
        // stays consistent with what the user just selected.
        if (action === 'ok' || action === 'run' || action === 'appsw') {
            var ok = this._findFocused();
            if (!ok) return;
            // Transient (current Desktop / Menu / Submenu) just
            // dismisses the switcher — the user is staying where
            // they were.
            if (ok.transient) {
                return 'pop';
            }
            if (this.sceneManager && typeof PlaceholderAppScene !== 'undefined') {
                this.sceneManager.pop();
                while (this.sceneManager.current() instanceof PlaceholderAppScene) {
                    this.sceneManager.pop();
                }
                this.sceneManager.push(new PlaceholderAppScene(ok.imagePath, ok.name));
            }
            return;
        }

        // Esc kills the focused app — only when there's a real
        // running app in the focus slot. Transient (Desktop / Menu)
        // can't be "killed", and an empty focus is a no-op.
        if (action === 'esc') {
            var killTarget = this._findFocused();
            if (killTarget && !killTarget.transient) {
                this._killFocused();
            }
            return;
        }

        // Carousel orientation: older apps live at NEGATIVE
        // positions. Down brings the next-older into focus (so
        // every card's position += 1, including the focused one
        // sliding toward +1). Up reverses.
        var delta = (action === 'down') ?  1
                  : (action === 'up')   ? -1
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
            drawCard(canvas, state, card, e);
        }

        // Kill affordance — surfaces what Esc does. Standard left-button
        // chrome (white fill, top-right rounded, 1 px black border) with
        // the literal label "Kill". Hidden during the kill animation so
        // it doesn't visually flicker as the killed card slides past;
        // comes back at REST. Hidden too when the focus is on the
        // transient current-scene card (Desktop / Menu / Submenu) —
        // there's nothing for Esc to do there.
        var focusedForKill = this._findFocused();
        var hasFocus = focusedForKill !== null && !focusedForKill.transient;
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
                // If the only survivors are transient (Desktop / Menu /
                // Submenu snapshot), there's nothing left to switch
                // *between* — flush them too so the empty-state path
                // shows "No running apps" on the next frame. Force a
                // render: at this point `animating` is already false
                // (t >= 1), so without an explicit request the screen
                // would freeze on the last animation frame which still
                // shows the transient card.
                var realLeft = false;
                for (var n = 0; n < this.cards.length; n++) {
                    if (!this.cards[n].transient) { realLeft = true; break; }
                }
                if (!realLeft) {
                    this.cards = [];
                    if (typeof window.requestRender === 'function') {
                        window.requestRender();
                    }
                }
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
