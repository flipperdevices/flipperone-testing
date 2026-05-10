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
    POSITIONS[ 0] = S(2, 15,  258, 100, 4, 4, 4, 4);  // selected / main (right edge runs 4 px past the canvas, same convention as ±1 tabs)
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

    // Off-screen-bottom source used by the wrap-hint slide-in. y is
    // anchored at the canvas height (144) since drawCard's wrap-hint
    // override now leaves y untouched (only grows h by +6). With
    // WRAP_HINT_START.y = 144, the card's top edge starts exactly
    // at the canvas bottom — fully off-screen — and lerps up to
    // POSITIONS[-2].y at the slide-in's end. Corners pre-set to the
    // wrap-hint shape (TL rounded, others square) so the lerped
    // stroke geometry doesn't morph mid-slide; drawCard overrides
    // corners after the lerp anyway, but matching here keeps the
    // lerp results sensible if anything ever reads them.
    var WRAP_HINT_START = S(50, 144, 252, 13, 4, 0, 0, 0);

    // N=2 intro source for B (the "previous" app sliding up from
    // below the canvas into the focused slot). Same x/w/h/corners
    // as POSITIONS[0] but y anchored to the canvas bottom so at
    // t=0 the entire frame sits off-screen below.
    var INTRO_B_FROM_BOTTOM = S(2, 144, 258, 100, 4, 4, 4, 4);

    // ── Phase state machine ─────────────────────────────────────
    var PHASE_OPENING   = 'opening';
    var PHASE_REST      = 'rest';
    var PHASE_SCROLLING = 'scrolling';
    var PHASE_KILLING   = 'killing';
    // Reverse of OPENING — focused card zooms from POSITIONS[0]
    // out to the full-canvas overscan (OPENING_START), then the
    // PlaceholderAppScene for the selected app takes over. All
    // non-focused cards are hidden during this phase.
    var PHASE_CLOSING   = 'closing';
    // Boundary feedback. Pressing Down at the oldest or Up at
    // the most-recent (where there's nothing further to navigate
    // to) plays a quick "tug" on the focused card: it slides a
    // few pixels in the direction its phantom move *would* have
    // gone, then springs back to POSITIONS[0]. Visual hint that
    // the press registered but there's no card past this one.
    var PHASE_BOUNCING  = 'bouncing';
    // Maximum y-displacement of the bounce, in pixels.
    var BOUNCE_DISTANCE = 5;
    // Touchpad-driven fractional scroll. Cards render at fractional
    // positions while the user's finger is on the pad — releasing
    // snaps to the nearest integer focusedIdx via PHASE_SCROLLING.
    var PHASE_DRAGGING  = 'dragging';
    // Pad units per one focusedIdx step. Y axis on this hardware
    // ranges ~400 raw units; 400/step → full pad ≈ 1 position.
    var TP_UNITS_PER_STEP = 400;
    // Velocity-based momentum on release. We average raw Y movement
    // over the last `TP_VELOCITY_WINDOW_MS` of touch and project it
    // forward by `TP_VELOCITY_PROJECTION_MS` to decide how many
    // extra slots to fly past the finger's last position. iPhone-
    // style: a slow drag stops where you let go (projected ≈ 0); a
    // fast flick sails through several frames before settling.
    var TP_VELOCITY_WINDOW_MS     = 100;
    var TP_VELOCITY_PROJECTION_MS = 150;

    // Screenshot draw offset. Aligns the image's left edge with the
    // focused frame body's left edge (state.x = 2 for POSITIONS[0]),
    // so the left side of the snapshot isn't cropped by the body
    // clip mask. The right edge runs past the canvas — that's
    // already off-screen and clipped naturally.
    var IMG_X = 2;
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

    function drawTitleBar(canvas, s, name, bgColor, barH, icon, textDy) {
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
            // For multi-frame animated icons the visible frame
            // height is `icon.h / icon.frames`, NOT the full
            // strip height. Centring against `icon.h` would push
            // the icon way below the bar (the strip stacks all
            // frames vertically). Same heuristic MenuLine uses.
            var iconFrameCount = icon.frames || 1;
            var iconVisH = (iconFrameCount > 1)
                ? Math.floor(icon.h / iconFrameCount)
                : icon.h;
            // Vertically centre the icon inside the title bar so
            // assets of different heights (e.g. 14-px square menu
            // icons vs. 9-px nmap_eye) all read centred against
            // the bar. Hardcoding +3 used to make 14-tall icons
            // sit 2 px below centre and bleed 1 px below the bar
            // onto the screenshot below.
            var iconY = s.y + Math.floor((barH - iconVisH) / 2);
            // Optional per-icon nudge. Two channels of overrides so
            // the App Switcher title-bar position can be tuned
            // independently of the MenuLine row position (some
            // icons read fine inline in a menu but ride high or
            // low against the title bar's distinct background):
            //   - `titleBarOffsetX` / `titleBarOffsetY` — preferred
            //     here. When defined they take precedence.
            //   - `offsetX` / `offsetY`               — fallback,
            //     reused from MenuLine if no title-bar-specific
            //     override is given.
            // The label anchor (`labelStartX`) keeps using the
            // icon's *unshifted* right edge so subsequent text
            // still sits 3 px past where the icon would have ended
            // without the nudge — otherwise nudging an icon right
            // would push the label right with it.
            var dx = (icon.titleBarOffsetX !== undefined)
                     ? icon.titleBarOffsetX
                     : (icon.offsetX || 0);
            var dy = (icon.titleBarOffsetY !== undefined)
                     ? icon.titleBarOffsetY
                     : (icon.offsetY || 0);
            var drawX = iconX + dx;
            var drawY = iconY + dy;
            // Pick the right renderer for the icon's storage format.
            // Same convention MenuLine uses:
            //   - Multi-frame strip (`frames > 1`) → drawSpriteFrame
            //     at the wall-clock-derived index, so the icon
            //     animates in lockstep with the rest of the system
            //     (same FRAME_MS cadence MenuLine uses).
            //   - 6-bit grayscale (`grayscale: true`) → drawSprite
            //     uses the gray value as opacity for the supplied
            //     tint, so anti-aliased edges survive.
            //   - 1-bit binary (legacy, one hex value per row, no
            //     `grayscale` flag) → drawIcon. Routing these
            //     through drawSprite goes via _drawBinarySprite,
            //     which expects a flat byte array, NOT the per-row
            //     hex format icons.js stores them in — that mismatch
            //     made router / minimal render as garbled pixels.
            if (iconFrameCount > 1) {
                // Animated icons render as frame 0 only here —
                // the switcher is supposed to be a quiet
                // overview of running apps; cycling glyphs in
                // every card title bar would compete with the
                // user's attention. Animation still plays in
                // the Apps submenu underneath, where the row
                // selection makes one specific icon "active".
                canvas.drawSpriteFrame(icon, drawX, drawY, 0, TITLE_BAR_FG);
            } else if (icon.grayscale) {
                canvas.drawSprite(icon, drawX, drawY, TITLE_BAR_FG);
            } else {
                canvas.drawIcon(icon, drawX, drawY, TITLE_BAR_FG);
            }
            labelStartX = iconX + icon.w + 3;   // 3 px gap to the label
        }

        if (name) {
            // Optional `textDy` nudge lets specific call sites (e.g.
            // the focused 0-slot card) push the label down a pixel
            // without affecting tab- or kill-style titles.
            var ty = s.y + titleTextYOffset(barH) + (textDy || 0);
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

    function drawCard(canvas, state, card, e, phase) {
        // Card-level alpha — fades the whole card in or out when it
        // animates between a slot that has POSITIONS geometry and
        // one that doesn't. Without this, a card pushed past +1
        // (which has no geometry) would stay parked at +1's place
        // throughout the animation and then snap out of existence
        // at t=1; symmetrically, one returning would pop in. The
        // fade lets it dissolve cleanly in either direction.
        var cardAlpha = 1;
        // Transient intro fade-out: the Desktop / Menu / Submenu
        // snapshot is animated alongside the rest of the intro, but
        // it's not a real switchable card — it fades from 1 → 0 over
        // the same lerp so it's already invisible by the time it
        // reaches the +1 peek slot. The actual splice happens when
        // PHASE_SCROLLING completes; this just makes the transition
        // a smooth fade instead of an abrupt removal.
        if (card._fadeOut) cardAlpha = 1 - e;
        // Drag: fractional `_dragPos` may walk past +1 or below -2
        // where POSITIONS has no geometry. fractionalAlpha ramps the
        // card out over one slot of overshoot in either direction.
        if (typeof card._dragPos === 'number') {
            cardAlpha = Math.min(cardAlpha, fractionalAlpha(card._dragPos));
        }
        // `pinnedPosAbs` short-circuits the position lerp in the
        // posAbs computation below when the card is doing a pure
        // fade-in or fade-out. Without it, lerping `animFrom` →
        // `position` from e.g. +2 to -2 walks through 0 at the
        // midpoint, which makes posClamped dip to 0 and momentarily
        // trips the focused-zone title-bar styling (dark fill). The
        // card *renders* at only one geometric side throughout the
        // fade, so we pin posAbs to that side too.
        var pinnedPosAbs = null;
        if (card._fromState && !card._toState) {
            // Slide animation (e.g. wrap-hint) where only the
            // start state is overridden — pin posAbs to the
            // destination so the title-bar style doesn't crossfade
            // through the focused zone while the card is mid-slide.
            // When BOTH _fromState and _toState are set (e.g. the
            // N=2 intro phase 1), the caller is fully driving the
            // visual via the two states, so we let posClamped lerp
            // normally; that produces the focused → tab crossfade
            // synced to the position change.
            pinnedPosAbs = Math.abs(card.position);
            // If the destination ALSO has no POSITIONS geometry
            // (e.g. drag-release lands a card at +2 or -3 with no
            // slot), fade the card out across the lerp the same way
            // the integer-only animFrom→position branch does. The
            // card sticks to its `_fromState` geometry while alpha
            // ramps to 0 — gracefully drops off the carousel.
            if (POSITIONS[card.position] === undefined) {
                cardAlpha = Math.min(cardAlpha, 1 - e);
            }
        } else if (card.animFrom !== null) {
            var posExists = POSITIONS[card.position] !== undefined;
            var afpExists = POSITIONS[card.animFrom] !== undefined;
            if (afpExists && !posExists) {
                cardAlpha    = 1 - e;
                pinnedPosAbs = Math.abs(card.animFrom);
            } else if (!afpExists && posExists) {
                cardAlpha    = e;
                pinnedPosAbs = Math.abs(card.position);
            }
        }
        if (cardAlpha < 0.001) return;

        var topCtx = canvas.ctx;
        topCtx.save();
        topCtx.globalAlpha *= cardAlpha;

        // Transient (Desktop / Menu / Submenu) intro: render ONLY the
        // full-canvas screenshot at native (0, 0) and fade it out via
        // cardAlpha — no card frame, no title bar, no body fill, no
        // movement. Visually it's "the screen you came from dissolves
        // to reveal the switcher behind it". The actual splice from
        // this.cards happens at PHASE_SCROLLING completion; until
        // then the alpha is already 0 so nothing is drawn anyway.
        if (card._fadeOut) {
            var fimg = card.image;
            var freedy = fimg && (fimg.naturalWidth > 0
                || (fimg.tagName === 'CANVAS' && fimg.width > 0));
            if (freedy) {
                topCtx.drawImage(fimg, 0, 0);
            }
            topCtx.restore();
            return;
        }

        // Wrap-hint shape override: when this card is the most-recent
        // app raised to slot -2 as a loop-boundary indicator (see
        // AppSwitcherScene._raiseWrapHint), it draws as a rectangle
        // with ONLY the top-left corner rounded and stroke on top
        // and left edges only — anchors visually to the bottom-left
        // of the canvas. The override applies the moment the flag
        // is set, including throughout the fade-in animation, so
        // the user never sees the standard -2 tab shape flicker
        // first. `_wrapToTop` clears the flag before its scroll
        // animation, so that lerp uses the standard geometry.
        //
        // Also nudges the card 2 px taller and 2 px down vs the raw
        // POSITIONS[-2] tab so the wrap hint sits more prominently
        // at the canvas bottom. The bottom 1 px overflows the
        // canvas, but the bottom edge has no stroke (override drops
        // bottom + right strokes) so there's nothing to clip.
        var isWrapHint = card.wrapHint === true
                         && card.position === -2;
        if (isWrapHint) {
            state = {
                x:   state.x,
                y:   state.y,
                w:   state.w,
                h:   state.h + 6,
                rTL: 4, rTR: 0, rBL: 0, rBR: 0
            };
        }

        fillBody(canvas, state, '#FFF');

        // Interpolated |position|. For an idle card it's just the
        // integer position; mid-animation it's the lerped value
        // between animFrom and position — UNLESS this is a pure
        // fade-in/out (`pinnedPosAbs` set above), in which case the
        // card stays styled at its rendered side throughout.
        var posAbs;
        if (pinnedPosAbs !== null) {
            posAbs = pinnedPosAbs;
        } else if (typeof card._dragPos === 'number') {
            // Drag drives posAbs from the fractional position so the
            // focused-zone title-bar crossfade tracks the user's
            // finger smoothly across the 0 ↔ ±1 boundary.
            posAbs = Math.abs(card._dragPos);
        } else if (card.animFrom !== null) {
            posAbs = Math.abs(lerp(card.animFrom, card.position, e));
        } else {
            posAbs = Math.abs(card.position);
        }
        var posClamped = Math.max(0, Math.min(1, posAbs));

        // Image alpha. Keyboard / animation paths use the linear
        // 1 − posClamped (their `e = easeOutCubic(t)` already paces
        // the visual). Touchpad drag is linear with finger position,
        // so a 1 − posClamped fade keeps the screenshot visible into
        // the tab-styled range and reads as the focused style
        // "lagging" the geometry. Tying the drag image fade to the
        // discrete type-flip threshold (p = 0.5) makes the screenshot
        // disappear exactly when the type commits to tab.
        var dragMode = (typeof card._dragPos === 'number');

        // ── Image (fades with the focused style) ──────────────
        var img = card.image;
        var ready = img && (img.naturalWidth > 0
            || (img.tagName === 'CANVAS' && img.width > 0));
        if (ready) {
            var imgAlpha = dragMode
                ? Math.max(0, 1 - 2 * posClamped)
                : 1 - posClamped;
            if (imgAlpha > 0.001) {
                var ictx = canvas.ctx;
                ictx.save();
                ictx.beginPath();
                addBodyClipPath(ictx, state.x, state.y, state.w, state.h,
                    state.rTL, state.rTR, state.rBL, state.rBR);
                ictx.clip();
                // Multiply *into* the existing alpha (which is the
                // card-level fade) instead of overwriting it.
                ictx.globalAlpha = ictx.globalAlpha * imgAlpha;
                if (phase === PHASE_OPENING
                        || phase === PHASE_CLOSING
                        || card._imageFromFullApp) {
                    // Zoom transitions — translate ONLY. The
                    // screenshot stays at its native pixel size
                    // (no resampling). Position lerps between
                    //   FULL APP   (0, 0)
                    //   REST/POS X (IMG_X, target.y − 12)
                    // so at the animation boundary the image lands
                    // exactly where the standard REST path draws
                    // it — no jump when PHASE_OPENING settles into
                    // REST, no jump when PHASE_CLOSING starts from
                    // REST. Math.round on both coords keeps the
                    // draw on integer pixel boundaries → no sub-
                    // pixel blur. The body clip handles cropping.
                    // Both REST and lerp target now use the same
                    // -12 offset (was -9): screenshot rides 3 px
                    // higher in the focused card so the source
                    // app's content sits more visibly inside the
                    // frame instead of being cropped low.
                    var targetState = POSITIONS[card.position] || POSITIONS[0];
                    var targetImgY  = targetState.y - 12;
                    var imgX, imgY;
                    if (phase === PHASE_CLOSING) {
                        imgX = Math.round(lerp(IMG_X, 0, e));
                        imgY = Math.round(lerp(targetImgY, 0, e));
                    } else {
                        imgX = Math.round(lerp(0, IMG_X, e));
                        imgY = Math.round(lerp(0, targetImgY, e));
                    }
                    ictx.drawImage(img, imgX, imgY);
                } else {
                    // Standard: native size, raised 13 px above
                    // the frame's interior top (was 10 — the
                    // extra 3 px lifts the screenshot to match
                    // the new -12 offset above so REST stays in
                    // lockstep with the zoom-transition target).
                    // The body clip mask trims the overflow so
                    // the visible result is the source image
                    // with its top cropped off — keeps the
                    // focused card's title bar free of the
                    // source's status-bar strip.
                    var imgY = state.y + 1 - 13;
                    ictx.drawImage(img, IMG_X, imgY);
                }
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
        //
        // During a touchpad drag the integer `card.position` is the
        // RESTING slot from before touch-down — it doesn't reflect
        // where the card has been pulled to visually. A card with
        // integer position −3 dragged into the visible 0..±1 range
        // would otherwise hit deepZone here (|pos|=3 ≥ 2) and render
        // with the default gray bar instead of the proper crossfade.
        // The extra `_dragPos`-aware guard forces the crossfade path
        // whenever the card is visually inside the [−2, +2] band.
        var posInTab = TAB_CONFIG[card.position] !== undefined;
        var afpInTab = card.animFrom !== null && TAB_CONFIG[card.animFrom] !== undefined;
        var deepZone = !posInTab && !afpInTab
            && (Math.abs(card.position) >= 2)
            && (card.animFrom === null || Math.abs(card.animFrom) >= 2);
        if (deepZone
                && typeof card._dragPos === 'number'
                && Math.abs(card._dragPos) < 2) {
            deepZone = false;
        }
        if (deepZone) {
            var dBg = TITLE_BAR_BG_BY_POSITION[card.position] || TITLE_BAR_BG_DEFAULT;
            var dBarH = TITLE_BAR_H_BY_POSITION[card.position] || TITLE_BAR_H_DEFAULT;
            drawTitleBar(canvas, state, card.name, dBg, dBarH, card.icon);
            topCtx.restore();
            return;
        }

        // ── 0 ↔ ±1 zone ──────────────────────────────────────
        // Two paths:
        //
        //   Keyboard / animations: posClamped is driven by an eased
        //   lerp (e = easeOutCubic(t)) over the integer animFrom →
        //   position transition. A linear crossfade between focused
        //   and tab styles works fine here because the easing makes
        //   posClamped pass the midpoint quickly, so the dual-style
        //   overlap region is brief.
        //
        //   Touchpad drag: posClamped is driven directly by the
        //   finger's Y position with no easing. A linear crossfade
        //   keeps both styles overlapping linearly across the whole
        //   [0, 1] range — every card mid-transition shows TWO
        //   fonts, two strokes, two colours, which reads as "the
        //   type is lagging the geometry". The discrete picker
        //   below commits to a single style on either side of
        //   |visPos| = 0.5, so every card is always visually
        //   committed to one type.
        var ctx = canvas.ctx;
        if (dragMode) {
            // DRAG: type comes from the carousel-wide `_typeSlot`
            // (Math.round(fracIdx) − cardIdx), NOT from the card's
            // own fractional `_dragPos`. This way every card across
            // the carousel snaps types simultaneously when fracIdx
            // crosses a half-integer — the user sees the whole
            // carousel "click into" each new focused-slot
            // arrangement as they scroll, and a card visibly travels
            // +1 → 0 → −1 → −2 in sequence picking up the matching
            // style at each commit. Geometry stays smooth via
            // `_dragPos` (handled in getCardState).
            var slot = card._typeSlot;
            if (slot === 0) {
                // Focused: black bar, Born2bSporty white label,
                // 4-sided black stroke.
                drawTitleBar(canvas, state, card.name, '#000000', 16, card.icon, 1);
                drawFrameStroke(canvas, state, '#000000');
            } else if (TAB_CONFIG[slot]) {
                // Tab(slot).
                var dragTabCfg = TAB_CONFIG[slot];
                var dragTabColor = dragTabCfg.color || '#666666';
                if (card.name) {
                    var dragLabelDy = dragTabCfg.labelDy + (isWrapHint ? 1 : 0);
                    HaxrcorpFont16.draw(canvas.ctx, card.name,
                        state.x + 3 + dragTabCfg.labelDx,
                        state.y + dragLabelDy,
                        dragTabColor);
                }
                var dragEdges = {};
                dragEdges[dragTabCfg.openEdge] = false;
                if (isWrapHint) dragEdges = { bottom: false, right: false };
                if (card._keepBottomStroke && dragEdges.bottom === false) {
                    dragEdges = Object.assign({}, dragEdges);
                    delete dragEdges.bottom;
                }
                drawFrameStroke(canvas, state, dragTabColor, dragEdges);
            } else {
                // Past the visible tab range (|slot| > 2) — the card
                // is sliding off-canvas and `cardAlpha` is fading it
                // out via `fractionalAlpha`. Paint the default-deep
                // bar so it has something to dissolve.
                drawTitleBar(canvas, state, card.name,
                    TITLE_BAR_BG_DEFAULT, TITLE_BAR_H_DEFAULT, card.icon);
            }
            topCtx.restore();
            return;
        }

        // KEYBOARD / animations: original crossfade preserved.
        var focusedAlpha = 1 - posClamped;
        var tabAlpha     = posClamped;

        // Always-opaque title-bar background. Drawn at full alpha
        // (only `cardAlpha` modulates it) with a colour that lerps
        // from black at the focused slot 0 to white at any tab slot
        // (±1, ±2, …). Without this, the focused/tab branches each
        // draw the bar at their own alpha (1 − posClamped /
        // posClamped) — at midpoint both are 0.5 and the body fill
        // shows through as translucent gray. Pre-painting at full
        // alpha keeps the bar solid; the focused branch's later
        // overdraw at reduced alpha deposits the same colour again.
        {
            var barCtx = canvas.ctx;
            barCtx.save();
            barCtx.beginPath();
            addBodyClipPath(barCtx, state.x, state.y, state.w, state.h,
                state.rTL, state.rTR, state.rBL, state.rBR);
            barCtx.clip();
            barCtx.fillStyle = lerpColor('#000000', '#FFFFFF', posClamped);
            barCtx.fillRect(state.x, state.y, state.w, 16);
            barCtx.restore();
        }

        // Focused style: black title bar with Born2bSporty centered,
        // 4-sided black stroke. As we approach ±1 the bg drifts to
        // white and the stroke to gray.
        if (focusedAlpha > 0.001) {
            var fBg     = lerpColor('#000000', '#FFFFFF', posClamped);
            var fStroke = lerpColor('#000000', '#666666', posClamped);
            ctx.save();
            ctx.globalAlpha = ctx.globalAlpha * focusedAlpha;
            drawTitleBar(canvas, state, card.name, fBg, 16, card.icon, 1);
            drawFrameStroke(canvas, state, fStroke);
            ctx.restore();
        }

        // Tab style: white card with HaxrcorpFont16 gray label and a
        // 3-sided gray stroke. tabCfg from integer position /
        // animFrom (we know we're not in drag mode here).
        var tabCfg = TAB_CONFIG[card.position]
            || (card.animFrom !== null ? TAB_CONFIG[card.animFrom] : null);
        if (tabAlpha > 0.001 && tabCfg) {
            var tabColor = tabCfg.color || '#666666';
            ctx.save();
            ctx.globalAlpha = ctx.globalAlpha * tabAlpha;
            if (card.name) {
                var labelDy = tabCfg.labelDy + (isWrapHint ? 1 : 0);
                HaxrcorpFont16.draw(canvas.ctx, card.name,
                    state.x + 3 + tabCfg.labelDx,
                    state.y + labelDy,
                    tabColor);
            }
            var edges = {};
            edges[tabCfg.openEdge] = false;
            if (isWrapHint) edges = { bottom: false, right: false };
            if (card._keepBottomStroke && edges.bottom === false) {
                edges = Object.assign({}, edges);
                delete edges.bottom;
            }
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
    // Cyclical-carousel slot for `idx` given current `focusedIdx` and
    // total card count `n`. The carousel layout for N=4 is:
    //   diff 0 → focused (0)
    //   diff 1 → peek-below (-1)
    //   diff 2 → deeper-below (-2)
    //   diff N − 1 → peek-above wrap target (+1)  ← what the user
    //       would land on if they pressed Up; "previous-cyclical".
    // For larger N the middle diffs (3..N−2) land at -3, -4, … which
    // have no POSITIONS geometry and fade out via cardAlpha.
    function cyclicalPosition(idx, focusedIdx, n) {
        if (n <= 1) return 0;
        // Pure linear list — cards above focus (lower idx) land at
        // positive positions, cards below at negative. Cards that
        // fall past -2 run off-canvas and fade out via cardAlpha.
        // Navigation is bounded at both ends (see handleInput).
        // Applies uniformly across N >= 2; the only "non-linear"
        // visual is the N=2 intro itself, which sets explicit
        // positions on cards[0] / cards[1] in
        // buildCardsFromRunningApps.
        return focusedIdx - idx;
    }

    // Index of the "most-recent app" in the cards array. With a
    // transient at cards[0], the most-recent app sits at cards[1];
    // otherwise it's cards[0]. Returns -1 if the array contains
    // only a transient (no real apps to be a wrap-hint).
    function mostRecentAppIdx(cards) {
        if (!cards || cards.length === 0) return -1;
        if (cards[0] && cards[0].transient) {
            return cards.length > 1 ? 1 : -1;
        }
        return 0;
    }

    // Apply the cyclical position model to `cards` for the given
    // focus index, capturing the previous position into `animFrom`
    // first so the caller can drive a SCROLLING animation. Also
    // applies the at-oldest wrap-hint override:
    //   - The most-recent app card lands at -2 with wrap-hint
    //     shape (TL-rounded silhouette, top+left strokes).
    //   - If a *different* card lands at -2 cyclically (only
    //     happens for non-transient N >= 4), that card is flagged
    //     `hidden` so it doesn't overlap the wrap-hint.
    //   - The most-recent's `_fromState` is set to WRAP_HINT_START
    //     when its previous position wasn't already -2, so the
    //     existing slide-in animation plays.
    // For any other focus state, wrapHint / hidden / _fromState
    // are explicitly cleared.
    function applyCyclicalLayout(cards, focusedIdx) {
        var n = cards.length;
        for (var j = 0; j < n; j++) {
            var c = cards[j];
            c.animFrom            = c.position;
            c.position            = cyclicalPosition(j, focusedIdx, n);
            c.wrapHint            = false;
            c.hidden              = false;
            c._fromState          = null;
            c._toState            = null;
            // Clear N=2 / N>=3 intro one-shot flags so subsequent
            // Up/Down scrolls don't carry the opener's overlay or
            // image-from-full-app behaviour.
            c._intro              = false;
            c._overlay            = false;
            c._imageFromFullApp   = false;
            c._keepBottomStroke   = false;
        }
    }

    function buildCardsFromRunningApps(transient) {
        var apps = (typeof RunningApps !== 'undefined')
            ? RunningApps.list()
            : [];
        if (apps.length === 0) return [];
        var cards = [];
        if (transient) {
            cards.push({
                name:      transient.name,
                imagePath: null,
                image:     transient.snapshot,
                icon:      null,
                animFrom:  null,
                transient: true     // not in RunningApps, can't be killed
            });
        }
        for (var i = 0; i < apps.length; i++) {
            cards.push({
                name:      apps[i].name,
                imagePath: apps[i].imagePath,
                image:     apps[i].image,
                icon:      apps[i].icon,
                factoryFn: apps[i].factoryFn || null,
                animFrom:  null
            });
        }
        // Multi-app intro animation, single phase. Applies for any
        // N >= 2 with no transient. Two cards animate in parallel:
        //   A (most-recent / current)   FULL APP → POSITIONS[+1]
        //   B (previous app)            off-canvas-below → POSITIONS[0]
        //
        // Cards 2..N-1 (C, D, …) just appear at their linear
        // slots for focusedIdx = 1 — no intro animation, they're
        // initially hidden behind A's full-canvas frame and become
        // visible as A shrinks toward the +1 corner:
        //
        //   N = 3:  A at +1, B at 0, C at -1.
        //   N = 4:  A at +1, B at 0, C at -1, D at -2.
        //   N >= 5: extras run past -2 (off-canvas, fade out via
        //           cardAlpha).
        //
        // Z-order: B is flagged `_overlay` so zKey() puts it
        // above A — A sits behind, B paints on top. A keeps its
        // bottom stroke (`_keepBottomStroke`) so the line where
        // it meets B's top is visible. A's screenshot translates
        // from full-canvas (0, 0) to the +1 REST anchor via the
        // `_imageFromFullApp` path; B's screenshot uses the
        // standard REST math (state.y − 9) so it tracks its frame
        // smoothly as the frame slides up from the bottom.
        // Desktop / Menu / Submenu transients participate in this
        // intro the same way regular apps do — the snapshot we just
        // took IS what's currently filling the screen, so it animates
        // FULL → +1 just like a real most-recent app would. The user
        // lands focused on the *previous* running app (cards[1]),
        // which is what they almost always want when Tab'ing from a
        // non-app scene.
        if (cards.length >= 2) {
            // A: FULL APP → +1.
            cards[0].animFrom         = 0;
            cards[0].position         = 1;
            cards[0]._fromState       = OPENING_START;
            cards[0]._toState         = POSITIONS[1];
            cards[0]._imageFromFullApp = true;
            cards[0]._keepBottomStroke = true;
            // Transient (Desktop / Menu / Submenu) snapshots aren't
            // real switchable apps — they fade out across the FULL →
            // +1 lerp so by the time they'd land at the +1 peek slot
            // they're fully invisible. Splice happens at PHASE_REST,
            // but the visual is "vanishes into the +1 frame as the
            // intro plays". Real apps keep cardAlpha = 1.
            if (cards[0].transient) cards[0]._fadeOut = true;

            // B: off-canvas-below → 0 (focused).
            cards[1].animFrom   = 0;
            cards[1].position   = 0;
            cards[1]._fromState = INTRO_B_FROM_BOTTOM;
            cards[1]._toState   = POSITIONS[0];
            cards[1]._overlay   = true;

            // C onwards: static at their linear positions for
            // focusedIdx = 1. animFrom stays null so no animation
            // is played — they just sit at -1, -2, … and become
            // visible as A's full-canvas frame shrinks past them.
            for (var ci = 2; ci < cards.length; ci++) {
                cards[ci].animFrom = null;
                cards[ci].position = cyclicalPosition(ci, 1, cards.length);
            }
            return cards;
        }

        // Apply cyclical positions with focus on cards[0] (the
        // transient if present, otherwise the most-recent app).
        // The last card in the array (oldest, or most-old running
        // app behind the transient) lands at +1 — the wrap-target
        // peek-above slot. focusedIdx === 0 never triggers the
        // wrap-hint override, so cards[0] doesn't get the
        // wrapHint / hidden flags set on initial load.
        cards.forEach(function(c) { c.position = 0; });   // seed for animFrom capture
        applyCyclicalLayout(cards, 0);
        // Wipe animFrom on initial build so the OPENING animation
        // doesn't try to lerp anything into place.
        cards.forEach(function(c) { c.animFrom = null; });
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
        // Cyclical-carousel index of the focused card. Starts at 0
        // (cards[0] = transient if present, otherwise most-recent
        // app). Up shifts -1 mod N, Down shifts +1 mod N. Each shift
        // recomputes every card's position via cyclicalPosition().
        this.focusedIdx = 0;
        this.phase = PHASE_OPENING;
        this._animStart = 0;
        // N=2 opening sequence step: 0 = inactive/finished,
        // 1 = shrink-in-place phase running, 2 = move-and-rise
        // phase running. Set in enter() when the carousel is
        // exactly two non-transient cards.
        this._n2IntroStep = 0;
    }

    AppSwitcherScene.prototype.enter = function() {
        this.cards = buildCardsFromRunningApps(this._transient);
        // Multi-app intro plays for any N >= 2 — including the
        // transient cases (Desktop / Menu / Submenu snapshot at
        // cards[0]). A (cards[0]) animates FULL APP → +1, B
        // (cards[1], the most-recent real app) slides up from the
        // bottom into focus 0. Cards 2..N-1 sit statically at their
        // linear slots. focusedIdx = 1 — B is the resting focus.
        // N = 1 falls back to the standard OPENING zoom-in.
        if (this.cards.length >= 2) {
            this.focusedIdx = 1;
            this.phase      = PHASE_SCROLLING;
            // Intro runs at 2× the base duration so the
            // FULL APP → +1 transition reads as a deliberate opener,
            // not a quick scroll-step. Cleared by the SCROLLING
            // auto-advance so subsequent Up/Down lerps run normally.
            this._animDurationMs = ANIM_DURATION_MS * 2;
        } else {
            this.focusedIdx = 0;
            this.phase      = PHASE_OPENING;
            this._animDurationMs = 0;
        }
        this._animStart = now();

        // ── Touchpad scroll ──────────────────────────────────────
        // Subscribe to the kernel-evdev SSE stream (same pipeline as
        // TouchpadAbsScene). Each message is "x,y,touch" where touch
        // is 0 or 1. Y on this hardware spans ~400 raw units; we
        // map TP_UNITS_PER_STEP units to one focusedIdx step.
        //
        // While the finger is on the pad we drive a continuous
        // fractional `_tpDragDelta` that the renderer reads to lerp
        // every card between adjacent integer slots. On lift we snap
        // to the nearest integer focusedIdx and play a smooth
        // PHASE_SCROLLING animation from the captured fractional
        // states down to the target slots.
        this._tpTouching = false;
        this._tpBaselineY = 0;
        this._tpBaselineFocusedIdx = this.focusedIdx;
        this._tpDragDelta = 0;
        var self = this;
        try {
            this._tpES = new EventSource('/api/touchpad/xy');
            this._tpES.onmessage = function(e) {
                self._handleTouchpadMessage(e);
            };
            this._tpES.onerror = function() {
                // Silently degrade: keyboard input still works.
            };
        } catch (err) {
            this._tpES = null;
        }

    };
    AppSwitcherScene.prototype.exit = function() {
        if (this._tpES) { this._tpES.close(); this._tpES = null; }
    };

    // Resolve a card's frame state for a given fractional position.
    // The carousel only defines geometry for integer positions in
    // POSITIONS (-2 … +1). Between two defined integers we lerp.
    // Past +1 or -2 (where one neighbour is missing) we hold the
    // last defined state and rely on `cardAlpha` (computed in
    // drawCard) to fade the card out as it leaves the carousel.
    function fractionalState(fracPos) {
        var lo = Math.floor(fracPos);
        var hi = lo + 1;
        var t  = fracPos - lo;
        var loS = POSITIONS[lo];
        var hiS = POSITIONS[hi];
        if (loS && hiS) return lerpState(loS, hiS, t);
        if (loS)        return loS;
        if (hiS)        return hiS;
        return null;
    }

    // Per-card alpha during drag — fades cards that have fractionally
    // walked past the visible range (above +1 or below -2). The fade
    // happens over one "slot" of distance so a card sliding past +1
    // is fully gone by the time it would have hit +2.
    function fractionalAlpha(fracPos) {
        if (fracPos > 1)  return Math.max(0, 1 - (fracPos - 1));
        if (fracPos < -2) return Math.max(0, 1 + (fracPos + 2));
        return 1;
    }

    // Translate one SSE message ("x,y,touch") into PHASE_DRAGGING
    // updates. Touch-down captures the current focusedIdx + Y as
    // baseline; subsequent movement updates `_tpDragDelta` (in
    // fractional position units). Touch-up snaps to the nearest
    // integer focusedIdx and hands off to PHASE_SCROLLING.
    AppSwitcherScene.prototype._handleTouchpadMessage = function(e) {
        if (!this.cards || this.cards.length === 0) return;
        // Block touchpad scroll during phases that own the carousel
        // mid-motion (intro, kill, close). Resume once we're at REST
        // or already in DRAGGING / SCROLLING / BOUNCING.
        var blocking = (this.phase === PHASE_OPENING
                     || this.phase === PHASE_KILLING
                     || this.phase === PHASE_CLOSING);
        if (blocking) return;

        var p = e.data.split(',');
        if (p.length < 3) return;
        var ny = +p[1], nt = +p[2];
        if (ny !== ny || (nt !== 0 && nt !== 1)) return;

        var nowTouching = (nt === 1);
        var prevTouching = this._tpTouching;

        if (nowTouching && !prevTouching) {
            // Touch-down: capture baselines. _tpDragDelta starts at 0.
            // Reset _animStart so the auto-advance can't accidentally
            // tick a stale snap-back to completion right after touch.
            // Reset the velocity sample buffer too — momentum is
            // computed only from movement within this stroke.
            // Overshoot tracker resets too: we only fire the
            // edge-bounce when the user actually pushed past the
            // limits during this stroke.
            this._tpBaselineY = ny;
            this._tpBaselineFocusedIdx = this.focusedIdx;
            this._tpDragDelta = 0;
            this._tpSnapStartDelta = 0;
            this._tpSnapTargetDelta = 0;
            this._tpSnapTarget = this.focusedIdx;
            this._tpLastRawFracIdx = this.focusedIdx;
            this._tpOvershootDir = 0;
            this._tpVelSamples = [{ y: ny, ts: now() }];
            this.phase = PHASE_DRAGGING;
            this._animDurationMs = 0;
            this._animStart = now();
        }

        if (nowTouching) {
            // Inverted Y: finger moves DOWN on the pad → focus moves
            // UP through the list (toward more-recent / lower
            // focusedIdx). Matches the "drag the carousel down"
            // direct-manipulation feel.
            var rawDelta = (this._tpBaselineY - ny) / TP_UNITS_PER_STEP;
            // Clamp to the carousel's bounded range so the user
            // can't drag the focus out past the ends. fracIdx must
            // sit in [0, n-1]. Track the unclamped raw value so we
            // can fire an edge-bounce on release if the user pushed
            // past either end during the stroke.
            var n = this.cards.length;
            var rawFracIdx = this._tpBaselineFocusedIdx + rawDelta;
            this._tpLastRawFracIdx = rawFracIdx;
            var fracIdx = rawFracIdx;
            if (fracIdx < 0) fracIdx = 0;
            else if (fracIdx > n - 1) fracIdx = n - 1;
            this._tpDragDelta = fracIdx - this._tpBaselineFocusedIdx;
            this.phase = PHASE_DRAGGING;
            // Append a velocity sample. Trim to the recent window so
            // a long drag with a slow tail doesn't average in stale
            // movement when the user finally releases.
            var sampleTs = now();
            if (!this._tpVelSamples) this._tpVelSamples = [];
            this._tpVelSamples.push({ y: ny, ts: sampleTs });
            while (this._tpVelSamples.length > 0
                   && sampleTs - this._tpVelSamples[0].ts > TP_VELOCITY_WINDOW_MS) {
                this._tpVelSamples.shift();
            }
        }

        if (!nowTouching && prevTouching) {
            // Touch-up: stay in PHASE_DRAGGING and time-lerp
            // `_tpDragDelta` from its current fractional value to an
            // integer target. render() reads `_tpDragDelta` every
            // frame, so the same fractional-position rendering used
            // during the live drag carries over into the snap — the
            // styling stays continuous (no posAbs jump that would
            // otherwise blink the title bar at release).
            //
            // Target = round(fracIdx + projectedExtra), where
            // projectedExtra is derived from the finger's average
            // velocity over the last TP_VELOCITY_WINDOW_MS of touch.
            // Slow drag → projectedExtra ≈ 0 (lands where finger
            // stopped). Fast flick → projectedExtra carries the
            // carousel multiple slots past where the finger left.
            // Duration scales with snap distance so longer flings
            // visibly decelerate (easeOutCubic + longer dt = the
            // iPhone-style "decay to a stop" feel).
            var fracIdx = this._tpBaselineFocusedIdx + this._tpDragDelta;
            var velUnitsPerMs = 0;
            var samples = this._tpVelSamples || [];
            if (samples.length >= 2) {
                var first = samples[0];
                var last  = samples[samples.length - 1];
                var dt    = last.ts - first.ts;
                if (dt > 0) {
                    // Inverted Y matches `rawDelta`'s convention:
                    // finger UP (ny decreasing) → positive velocity
                    // toward higher focusedIdx.
                    velUnitsPerMs = -(last.y - first.y) / dt;
                }
            }
            var projectedExtra = velUnitsPerMs * TP_VELOCITY_PROJECTION_MS / TP_UNITS_PER_STEP;
            var projected = fracIdx + projectedExtra;
            var rawTarget = Math.round(projected);
            var n = this.cards.length;
            var target = Math.max(0, Math.min(n - 1, rawTarget));

            // Edge-bounce trigger. Two ways the stroke can want to
            // go past the carousel's [0, n-1] limits:
            //   (1) Finger-position overshoot: at any point during
            //       the drag (including the moment of release) the
            //       unclamped fracIdx was outside the range.
            //   (2) Momentum overshoot: a fast flick whose
            //       projected stop position lands outside the range.
            // Either case stamps `_tpOvershootDir` (-1 = past the
            // most-recent end, +1 = past the oldest end). The
            // PHASE_DRAGGING auto-advance reads it after the snap
            // commits and chains a PHASE_BOUNCING pulse on the
            // focused card so the user gets the same "you've hit
            // the wall" feedback they get from keyboard Up/Down.
            var overshoot = 0;
            var raw = this._tpLastRawFracIdx;
            if (typeof raw === 'number') {
                if (raw < 0)        overshoot = -1;
                else if (raw > n-1) overshoot = 1;
            }
            if (!overshoot) {
                if (rawTarget < 0)         overshoot = -1;
                else if (rawTarget > n-1)  overshoot = 1;
            }
            this._tpOvershootDir = overshoot;

            this._tpSnapStartDelta  = this._tpDragDelta;
            this._tpSnapTargetDelta = target - this._tpBaselineFocusedIdx;
            this._tpSnapTarget      = target;

            // Fast-path edge bounce. When the user is at a carousel
            // end and pulls the finger past it, the snap is a no-op
            // (snapStart === snapTarget — the clamped target is the
            // baseline focusedIdx, no real motion). The standard
            // snap-then-bounce chain takes a full ANIM_DURATION_MS
            // before the bounce fires; if the user is rapid-jerking
            // (lift, drag, lift, drag, …) faster than that, each
            // touch-down would reset `_tpOvershootDir` before the
            // chain could fire and the user would see at most one
            // bounce per burst. Firing the bounce immediately here,
            // skipping the no-op snap, lets every jerk produce
            // feedback even at high cadence.
            //
            // Momentum overshoot (snap actually moves toward a
            // different end-slot) still goes through the standard
            // snap → bounce chain so the user sees the carousel
            // commit the fling before it pulses.
            if (overshoot
                    && this._tpSnapStartDelta === this._tpSnapTargetDelta) {
                this.focusedIdx = this._tpSnapTarget;
                applyCyclicalLayout(this.cards, this.focusedIdx);
                this._tpDragDelta = 0;
                for (var fci = 0; fci < this.cards.length; fci++) {
                    this.cards[fci]._dragPos  = undefined;
                    this.cards[fci]._typeSlot = undefined;
                    this.cards[fci].animFrom  = null;
                }
                var fastFocus = this._findFocused();
                if (fastFocus) {
                    fastFocus._bounceDir = overshoot;
                    this.phase = PHASE_BOUNCING;
                } else {
                    this.phase = PHASE_REST;
                }
                this._tpOvershootDir = 0;
                this._animDurationMs = 0;
                this._animStart      = now();
                this._tpVelSamples   = [];
                this._tpTouching     = nowTouching;
                if (typeof window.requestRender === 'function') window.requestRender();
                return;
            }

            // Standard path: snap then bounce. Scale snap duration
            // with distance, capped at 4× so a multi-slot fling
            // decelerates smoothly without dragging on too long.
            var snapDistance = Math.abs(this._tpSnapTargetDelta - this._tpSnapStartDelta);
            var distScale = Math.min(4, Math.max(1, snapDistance));
            this._animDurationMs    = ANIM_DURATION_MS * distScale;
            this._animStart         = now();
            this._tpVelSamples      = [];
        }

        this._tpTouching = nowTouching;
        if (typeof window.requestRender === 'function') window.requestRender();
    };

    AppSwitcherScene.prototype._findFocused = function() {
        for (var i = 0; i < this.cards.length; i++) {
            if (this.cards[i].position === 0 && !this.cards[i].killing) {
                return this.cards[i];
            }
        }
        return null;
    };

    // First non-transient card in the carousel — represents the
    // most-recent running app (cards are stored most-recent-first;
    // an optional transient sits at index 0).
    AppSwitcherScene.prototype._mostRecentApp = function() {
        for (var i = 0; i < this.cards.length; i++) {
            if (!this.cards[i].transient) return this.cards[i];
        }
        return null;
    };

    // True iff the focused card is the OLDEST app — i.e. there's a
    // card at position 0, no card sits at position -1 (so a normal
    // Down would do nothing), AND the focused isn't a transient
    // (the transient itself doesn't trigger the wrap visualization).
    AppSwitcherScene.prototype._isAtOldest = function() {
        var focused = this._findFocused();
        if (!focused || focused.transient) return false;
        if (this.cards.length < 2) return false;
        for (var i = 0; i < this.cards.length; i++) {
            if (this.cards[i].position === -1 && !this.cards[i].killing) {
                return false;
            }
        }
        return true;
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

        // If killing this app drains RunningApps, every surviving
        // card is a transient (current scene snapshot). The carousel
        // is collapsing to "no running apps" — drop those transients
        // *now* rather than carrying them through the kill animation,
        // so the user sees only the focused card sliding off, with
        // no Desktop frame parked above. The killed card itself is
        // kept so its slide-out still plays; render's t>=1 cleanup
        // empties the list and triggers the empty-state repaint.
        if (newList.length === 0) {
            this.cards = this.cards.filter(function(c) {
                return c === focused || !c.transient;
            });
        }

        // Cyclical re-layout for the survivors. The card cyclically
        // *after* the killed one becomes the new focus (so e.g.
        // killing the most-recent slides up to second-most-recent;
        // killing the oldest wraps focus to the most-recent). We
        // run applyCyclicalLayout against a temporary array of just
        // the survivors so the wrap-hint override (at-oldest
        // visualization) re-applies correctly.
        var oldN      = this.cards.length;
        var killedIdx = this.cards.indexOf(focused);
        var survivors = [];
        for (var ci = 0; ci < oldN; ci++) {
            if (this.cards[ci] !== focused) survivors.push(this.cards[ci]);
        }
        var newN = survivors.length;
        var newFocusedIdx = 0;
        if (newN > 0) {
            // Index of "next cyclical" survivor. In the post-splice
            // array, survivors that came after `killedIdx` shift down
            // by one — so the next-cyclical card lands at index
            // `killedIdx` if there are survivors past the killed
            // slot, otherwise at 0 (wrap to the start).
            newFocusedIdx = (killedIdx < newN) ? killedIdx : 0;
        }
        if (newN > 0) {
            applyCyclicalLayout(survivors, newFocusedIdx);
        }
        this.focusedIdx = newFocusedIdx;

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
            // they were, no zoom-out animation.
            if (ok.transient) {
                return 'pop';
            }
            // Real app: trigger the closing zoom-out. The actual
            // pop + push happens in render's PHASE_CLOSING auto-
            // advance once the animation lands at full size.
            this.phase = PHASE_CLOSING;
            this._animStart = now();
            if (typeof window.requestRender === 'function') window.requestRender();
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

        var n = this.cards.length;
        if (n === 0) return;

        // Bounded linear scroll — Down moves focus forward (next-
        // older becomes focused), Up moves it backward. No wrap:
        // pressing past either end triggers a brief bounce on the
        // focused card instead of cycling.
        //
        // N === 1 falls through too: every press is a boundary,
        // so any Up/Down nudges the lone card to signal "nowhere
        // else to go".
        var newFocusedIdx = this.focusedIdx + delta;
        if (newFocusedIdx < 0 || newFocusedIdx >= n) {
            // Boundary: stamp the focused card with the press
            // direction so PHASE_BOUNCING knows which way to nudge
            // it. Down (delta=+1) at the oldest → card pulses up
            // (toward where it would have moved). Up (delta=-1)
            // at the most-recent → pulses down. The sign flip
            // happens in getCardState.
            var focused = this._findFocused();
            if (focused) {
                focused._bounceDir = delta;
                this.phase = PHASE_BOUNCING;
                this._animStart = now();
                if (typeof window.requestRender === 'function') {
                    window.requestRender();
                }
            }
            return;
        }
        this.focusedIdx = newFocusedIdx;
        applyCyclicalLayout(this.cards, this.focusedIdx);

        this.phase = PHASE_SCROLLING;
        this._animStart = now();
        if (typeof window.requestRender === 'function') window.requestRender();
    };

    // Reset every card to its initial-state slot (cards[i].position =
    // -i). Most-recent ends at 0, oldest at -(N − 1). With the wrap
    // hint visualization in effect, cards[0] (or cards[1] when a
    // transient is present) starts at -2 and animates up to 0;
    // others animate from wherever they were parked.
    AppSwitcherScene.prototype._wrapToTop = function() {
        for (var j = 0; j < this.cards.length; j++) {
            var c = this.cards[j];
            c.animFrom = c.position;
            c.position = -j;          // works in both transient (j=0 → 0)
                                       // and non-transient (j=0 → 0) layouts
            // Clear the wrap-hint flag — the special TR-rounded
            // shape only applies while resting at -2 as the loop
            // boundary indicator. Once the card animates away we
            // want the standard tab shape during the lerp.
            c.wrapHint = false;
        }
        this.phase = PHASE_SCROLLING;
        this._animStart = now();
        if (typeof window.requestRender === 'function') window.requestRender();
    };

    // One step of cyclical Up scrolling: rotates `cards` so that
    // the next array index (wrapping at the boundary) takes focus.
    // The new focused card animates from POSITIONS[+1] (the
    // peek-above slot) down to focused 0, even if it was actually
    // at -(N-1) before — that "from above" anchor is what gives
    // the wrap a normal-scroll feel instead of a teleport.
    //
    // For N apps focused at cards[i]: the new focused becomes
    // cards[(i - 1 + N) % N]. Every other card's new position is
    //   -((j - newIdx + N) % N)
    // — i.e. distance from the new focus measured downward,
    // wrapping past the boundary.
    AppSwitcherScene.prototype._wrapUpOnce = function() {
        var n = this.cards.length;
        if (n <= 1) return;

        var focusedIdx = -1;
        for (var k = 0; k < n; k++) {
            if (this.cards[k].position === 0 && !this.cards[k].killing) {
                focusedIdx = k;
                break;
            }
        }
        if (focusedIdx === -1) return;

        var newIdx = (focusedIdx - 1 + n) % n;

        for (var j = 0; j < n; j++) {
            var c = this.cards[j];
            c.animFrom = c.position;
            var newPos = -((j - newIdx + n) % n);
            // The new-focus card slides in from the peek-above slot
            // (animFrom=+1 → position=0) so the user sees it
            // descend into focus, regardless of where it actually
            // was before the wrap.
            if (j === newIdx) {
                c.animFrom = 1;
            }
            c.position = newPos;
            c.wrapHint = false;     // any leftover wrap-hint flag is stale now
        }

        this.phase = PHASE_SCROLLING;
        this._animStart = now();
        if (typeof window.requestRender === 'function') window.requestRender();
    };

    // Move the most-recent app's card from its current off-carousel
    // slot (+(N − 1), no geometry) to the visible -2 tab so the user
    // sees the loop boundary while parked at the oldest. Animated as
    // a fade-in via the cardAlpha path: animFrom has no POSITIONS
    // entry → fromState = undefined → cardAlpha ramps 0 → 1.
    AppSwitcherScene.prototype._raiseWrapHint = function() {
        var mr = this._mostRecentApp();
        var focused = this._findFocused();
        if (!mr || mr === focused) return false;
        if (mr.position === -2) return false;
        // When the most-recent card is currently sitting at +1
        // (peek-above slot — happens for N = 2 apps, possibly with
        // a transient prepended), moving it down to -2 would erase
        // its peek-above visual instantly. Spawn a one-shot ghost
        // duplicate at +1 that slides down a short distance behind
        // the focused card while the wrap hint rises up. The ghost
        // is filtered out of `this.cards` once SCROLLING completes
        // (see render's auto-advance).
        var GHOST_SLIDE_PX = 20;   // travel distance from the rest +1 anchor
        var GHOST_LIFT_PX  = 2;    // shift the whole slide 2 px up vs POSITIONS[+1]
        if (mr.position === 1 && POSITIONS[1]) {
            var slot1 = POSITIONS[1];
            this.cards.push({
                name:  mr.name,
                image: mr.image,
                icon:  mr.icon,
                position:   1,
                animFrom:   1,
                _fromState: { x: slot1.x, y: slot1.y - GHOST_LIFT_PX,
                              w: slot1.w, h: slot1.h,
                              rTL: slot1.rTL, rTR: slot1.rTR,
                              rBL: slot1.rBL, rBR: slot1.rBR },
                _toState:   { x: slot1.x,
                              y: slot1.y - GHOST_LIFT_PX + GHOST_SLIDE_PX,
                              w: slot1.w, h: slot1.h,
                              rTL: slot1.rTL, rTR: slot1.rTR,
                              rBL: slot1.rBL, rBR: slot1.rBR },
                _ghost: true
            });
        }
        mr.animFrom = mr.position;
        mr.position = -2;
        // Slide-in source: a state below the canvas, NOT a position
        // index. `_fromState` overrides POSITIONS[animFrom] in
        // getCardState so the card lerps geometry from below the
        // screen up to POSITIONS[-2], visibly "rising into view"
        // instead of fading in in place. drawCard also reads this
        // flag to skip the cardAlpha fade — the slide IS the
        // animation now.
        mr._fromState = WRAP_HINT_START;
        // Tag the card so drawCard renders the loop-boundary shape
        // (rectangle, only top + left strokes, TL-rounded only)
        // instead of the standard -2 tab geometry. Cleared in
        // _wrapToTop when the carousel cycles back.
        mr.wrapHint = true;
        this.phase = PHASE_SCROLLING;
        this._animStart = now();
        if (typeof window.requestRender === 'function') window.requestRender();
        return true;
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
        // Overlay cards (e.g. B in the N=2 single-phase opener)
        // draw above everything except the kill-out slide. -0.5
        // sits between killing (-1) and focused (0) in the
        // descending sort — i.e. they paint LAST, on top.
        if (card._overlay) return -0.5;
        // Drag: fractional `_dragPos` drives z-order, so cards
        // visibly cross depth as the user scrubs through positions.
        if (typeof card._dragPos === 'number') {
            return Math.abs(card._dragPos);
        }
        // Ghosts (e.g. the +1 slide-out spawned by _raiseWrapHint)
        // use the same `|position|` zKey as everything else, so
        // they sit naturally behind the focused card — at position
        // +1 the descending sort puts them ahead of the position-0
        // focus in render order, drawn first → focus draws on top.
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
        if (phase === PHASE_DRAGGING && typeof card._dragPos === 'number') {
            // Fractional position fed by the drag handler. Lerp between
            // adjacent integer slots; cardAlpha is applied separately
            // by drawCard for the "past +1 / past -2" fade.
            return fractionalState(card._dragPos);
        }
        if (phase === PHASE_OPENING && card.position === 0) {
            var endStateOpening = POSITIONS[0];
            return endStateOpening
                ? lerpState(OPENING_START, endStateOpening, t)
                : null;
        }
        if (phase === PHASE_CLOSING && card.position === 0) {
            // Reverse of OPENING — focused card zooms out from its
            // POSITIONS[0] frame to the full-canvas overscan, then
            // the actual app scene takes over (push happens in the
            // PHASE_CLOSING auto-advance branch).
            return lerpState(POSITIONS[0], OPENING_START, t);
        }
        if (phase === PHASE_BOUNCING && card.position === 0 && card._bounceDir) {
            // Boundary bounce: nudge the focused card a few pixels
            // in the direction the press would have moved it, then
            // spring back. sin(π · t) curve → 0 at endpoints, 1
            // at the midpoint, single smooth pulse over the phase
            // duration. Sign convention: Down (delta=+1) means
            // the card would have moved UP (toward POSITIONS[+1]
            // at y=1); negate to match the screen-y convention.
            var s = POSITIONS[0];
            var pulse = Math.sin(Math.PI * t) * BOUNCE_DISTANCE;
            var dy    = -card._bounceDir * pulse;
            return {
                x:   s.x,
                y:   s.y + Math.round(dy),
                w:   s.w,
                h:   s.h,
                rTL: s.rTL, rTR: s.rTR, rBL: s.rBL, rBR: s.rBR
            };
        }
        if ((phase === PHASE_SCROLLING || phase === PHASE_KILLING) && card.animFrom !== null) {
            // Explicit `_fromState` / `_toState` (e.g. the wrap-hint
            // slide-in, the +1 ghost slide-out) override the POSITIONS
            // lookups — useful when the source or destination isn't
            // a position index but an off-canvas anchor state.
            var fromState = card._fromState || POSITIONS[card.animFrom];
            var toState   = card._toState   || POSITIONS[card.position];
            if (fromState && toState) return lerpState(fromState, toState, t);
            return toState || fromState || null;
        }
        return POSITIONS[card.position] || null;
    }

    AppSwitcherScene.prototype.render = function(canvas) {
        var elapsed = now() - this._animStart;
        // Per-phase duration override. The N >= 2 intro
        // (FULL APP → +1 with the parallel slide-up of B and the
        // transient fade-out) sets `_animDurationMs` to 2×
        // ANIM_DURATION_MS so the opener reads as a substantial
        // transition; subsequent scroll/kill/bounce/close phases
        // clear the override and run at the base duration.
        var dur = this._animDurationMs || ANIM_DURATION_MS;
        var t = elapsed / dur;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        var e = easeOutCubic(t);

        var animating = (this.phase !== PHASE_REST && t < 1);

        // PHASE_DRAGGING: stamp every card with a fractional `_dragPos`
        // and an integer `_typeSlot`.
        //
        //   `_dragPos`  drives geometry — fractional, lerps every
        //               frame so cards visibly move with the finger
        //               (and during the snap-back lerp afterwards).
        //
        //   `_typeSlot` drives the title bar style — integer, snaps
        //               whenever `fracIdx` crosses a half-integer.
        //               Same value across all cards each frame, so
        //               the carousel always reads as one consistent
        //               state ("we're committed to focusedIdx = N
        //               right now"). A card visibly travels through
        //               +1 → 0 → −1 → −2 in sequence as the user
        //               scrolls, picking up the matching type as
        //               its slot crosses the midpoint.
        //
        // Live drag: `_tpDragDelta` is updated by SSE; we just read
        // it here. Snap-back (after release): we time-lerp it from
        // the touch-up snapshot down to the integer target.
        if (this.phase === PHASE_DRAGGING) {
            if (!this._tpTouching) {
                this._tpDragDelta = lerp(
                    this._tpSnapStartDelta || 0,
                    this._tpSnapTargetDelta || 0,
                    e
                );
            }
            var fracIdx = this._tpBaselineFocusedIdx + this._tpDragDelta;
            var effectiveFocusedIdx = Math.round(fracIdx);
            for (var di = 0; di < this.cards.length; di++) {
                this.cards[di]._dragPos  = fracIdx - di;
                this.cards[di]._typeSlot = effectiveFocusedIdx - di;
            }
        } else {
            // Clear stale fields so other phases don't accidentally
            // read them (getCardState branches on `_dragPos`,
            // drawCard branches on `_typeSlot`).
            for (var dj = 0; dj < this.cards.length; dj++) {
                this.cards[dj]._dragPos  = undefined;
                this.cards[dj]._typeSlot = undefined;
            }
        }

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
            // Hide the cyclical wrap target at +1 when the focus is
            // on the most-recent app. Only applies for N >= 4 — at
            // smaller counts the +1 slot either isn't used (N = 3
            // linear lays out at 0/-1/-2) or IS used as a regular
            // peek-above swap target (N = 2: B always at +1 when A
            // focused; we want it visible). focusedIdx === 0 covers
            // both transient (cards[0] = transient) and non-
            // transient (cards[0] = most-recent app) layouts.
            if (this.cards.length >= 4
                    && this.focusedIdx === 0
                    && card.position === 1) continue;
            // Cards explicitly hidden by the at-oldest wrap-hint
            // override (the cyclical card that would otherwise sit
            // at -2 and overlap the wrap-hint silhouette).
            if (card.hidden) continue;
            // During the closing zoom-out, only the focused card
            // is rendered — peek-above / peek-below tabs would
            // otherwise sit on top of the expanding focused card
            // (which now overflows the standard 0 slot).
            if (this.phase === PHASE_CLOSING && card.position !== 0) continue;
            drawCard(canvas, state, card, e, this.phase);
        }

        // Kill affordance — surfaces what Esc does. Standard left-button
        // chrome (white fill, top-right rounded, 1 px black border) with
        // the kill_app icon and the literal label "Kill". Hidden
        // during the kill animation so it doesn't visually flicker as
        // the killed card slides past; comes back at REST. Hidden too
        // when the focus is on the transient current-scene card
        // (Desktop / Menu / Submenu) — there's nothing for Esc to do
        // there.
        var focusedForKill = this._findFocused();
        var hasFocus = focusedForKill !== null && !focusedForKill.transient;
        // Kill stays on-screen across every phase except the actual
        // kill animation (where flickering it as the killed card
        // slides past would be distracting). PHASE_DRAGGING included
        // — the user expects the affordance to remain visible while
        // they scrub. The action targets whichever card is at
        // integer position 0 (the resting focus); during a drag
        // that's the baseline card, post-release it's the snapped
        // target.
        if (hasFocus && this.phase !== PHASE_KILLING) {
            // 11 px icon + 3 px gap + ~16 px "Kill" + chrome margins.
            // 48 px lines the icon + label up tight against the
            // button edges — same width the text-only Kill used to
            // be, no extra padding now that the icon shares the
            // budget.
            canvas.drawLeftButton('Kill', 0, 48, false, false, Icons.kill_app);
        }

        // Auto-advance phase on animation completion.
        if (t >= 1) {
            if (this.phase === PHASE_OPENING) {
                this.phase = PHASE_REST;
            } else if (this.phase === PHASE_BOUNCING) {
                // Bounce pulse done — back to REST and clear the
                // direction marker on whichever card had it.
                this.phase = PHASE_REST;
                for (var bi = 0; bi < this.cards.length; bi++) {
                    this.cards[bi]._bounceDir = 0;
                }
            } else if (this.phase === PHASE_DRAGGING) {
                // Snap-back lerp done — commit focusedIdx, drop the
                // fractional rendering machinery, return to REST.
                // Skipped while still touching: live drag stays in
                // PHASE_DRAGGING indefinitely until the user lifts.
                if (!this._tpTouching) {
                    this.focusedIdx = this._tpSnapTarget;
                    applyCyclicalLayout(this.cards, this.focusedIdx);
                    this._tpDragDelta = 0;
                    for (var dki = 0; dki < this.cards.length; dki++) {
                        this.cards[dki]._dragPos  = undefined;
                        this.cards[dki]._typeSlot = undefined;
                        // Clear `animFrom` after commit so a
                        // subsequent PHASE_BOUNCING (Up at the
                        // most-recent / Down at the oldest) doesn't
                        // see leftover animFrom != position state
                        // and accidentally drive cardAlpha / posAbs
                        // animations on non-focused cards. Mirrors
                        // what PHASE_SCROLLING auto-advance already
                        // does for keyboard.
                        this.cards[dki].animFrom = null;
                    }
                    // Reset the per-fling duration override; the next
                    // animation should run at the base ANIM_DURATION_MS.
                    this._animDurationMs = 0;
                    // If the user pushed past either carousel end
                    // during the drag (or their fling momentum
                    // projected past one), chain a PHASE_BOUNCING
                    // pulse on the freshly-committed focused card —
                    // same feedback the keyboard Up/Down boundary
                    // path already produces. Otherwise return to
                    // REST as usual.
                    if (this._tpOvershootDir) {
                        var bounceFocus = this._findFocused();
                        if (bounceFocus) {
                            bounceFocus._bounceDir = this._tpOvershootDir;
                            this.phase = PHASE_BOUNCING;
                            this._animStart = now();
                        } else {
                            this.phase = PHASE_REST;
                        }
                        this._tpOvershootDir = 0;
                    } else {
                        this.phase = PHASE_REST;
                    }
                }
            } else if (this.phase === PHASE_CLOSING) {
                // Closing zoom-out finished — the focused card has
                // expanded out to full canvas. Pop the switcher and
                // push the PlaceholderAppScene for the focused
                // entry. Any existing PlaceholderAppScene already
                // on the stack is popped first so Back from the
                // launched app returns to the menu/desktop, not to
                // the previously-active app.
                var ok = this._findFocused();
                if (ok && this.sceneManager) {
                    this.sceneManager.pop();
                    // Pop any "running app" scenes already on the
                    // stack so the new launch replaces them, rather
                    // than stacking on top. Two scene shapes count
                    // as a running app: PlaceholderAppScene and
                    // SubMenuScenes flagged via markAsApp() (i.e.
                    // Settings / Network).
                    while (true) {
                        var cur = this.sceneManager.current();
                        if (typeof PlaceholderAppScene !== 'undefined'
                                && cur instanceof PlaceholderAppScene) {
                            this.sceneManager.pop();
                            continue;
                        }
                        if (typeof SubMenuScene !== 'undefined'
                                && cur instanceof SubMenuScene
                                && cur._asApp) {
                            this.sceneManager.pop();
                            continue;
                        }
                        break;
                    }
                    // Prefer a registered factoryFn (used by the
                    // app-mode submenus to construct fresh
                    // instances). Falls back to PlaceholderAppScene
                    // for the regular PNG-mockup apps.
                    var newScene = null;
                    if (typeof ok.factoryFn === 'function') {
                        newScene = ok.factoryFn(this.sceneManager);
                    } else if (typeof PlaceholderAppScene !== 'undefined') {
                        newScene = new PlaceholderAppScene(ok.imagePath, ok.name, ok.icon);
                    }
                    if (newScene && typeof newScene.render === 'function') {
                        this.sceneManager.push(newScene);
                    }
                } else {
                    // Defensive fallback — if anything is missing,
                    // just return to REST so the switcher doesn't
                    // hang on a finished closing animation.
                    this.phase = PHASE_REST;
                }
            } else if (this.phase === PHASE_SCROLLING) {
                this.phase = PHASE_REST;
                // Clear any per-phase duration override (set by the
                // 2× intro) so the next lerp reverts to the base
                // ANIM_DURATION_MS.
                this._animDurationMs = 0;
                // Drop any one-shot ghost cards left over from
                // legacy wrap-hint code (none spawn in the cyclical
                // model, but the filter is cheap and keeps any
                // future ghost-style overlays cleanly removed).
                this.cards = this.cards.filter(function(c) { return !c._ghost; });
                // Discard the transient (Desktop / Menu / Submenu
                // snapshot) once the intro completes. It's never a
                // real running app, so leaving it in the carousel at
                // +1 would put a dead "card" in the user's switch
                // path. Decrement focusedIdx by one transient eaten
                // so the most-recent real app stays focused.
                var trIdx = -1;
                for (var ti = 0; ti < this.cards.length; ti++) {
                    if (this.cards[ti].transient) { trIdx = ti; break; }
                }
                if (trIdx !== -1) {
                    this.cards.splice(trIdx, 1);
                    if (this.focusedIdx > trIdx) this.focusedIdx--;
                }
                for (var k = 0; k < this.cards.length; k++) {
                    this.cards[k].animFrom            = null;
                    this.cards[k]._fromState          = null;
                    this.cards[k]._toState            = null;
                    // Clear N=2 intro flags so subsequent scrolls
                    // / kills don't carry them.
                    this.cards[k]._intro              = false;
                    this.cards[k]._overlay            = false;
                    this.cards[k]._imageFromFullApp   = false;
                    this.cards[k]._keepBottomStroke   = false;
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
