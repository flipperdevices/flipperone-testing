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

    // ── Phase state machine ─────────────────────────────────────
    var PHASE_OPENING   = 'opening';
    var PHASE_REST      = 'rest';
    var PHASE_SCROLLING = 'scrolling';
    var PHASE_KILLING   = 'killing';

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
            // Vertically centre the icon inside the title bar so
            // assets of different heights (e.g. 14-px square menu
            // icons vs. 9-px nmap_eye) all read centred against
            // the bar. Hardcoding +3 used to make 14-tall icons
            // sit 2 px below centre and bleed 1 px below the bar
            // onto the screenshot below.
            var iconY = s.y + Math.floor((barH - icon.h) / 2);
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
            //   - 6-bit grayscale (`grayscale: true`) → drawSprite
            //     uses the gray value as opacity for the supplied
            //     tint, so anti-aliased edges survive.
            //   - 1-bit binary (legacy, one hex value per row, no
            //     `grayscale` flag) → drawIcon. Routing these
            //     through drawSprite goes via _drawBinarySprite,
            //     which expects a flat byte array, NOT the per-row
            //     hex format icons.js stores them in — that mismatch
            //     made router / minimal render as garbled pixels.
            if (icon.grayscale) {
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

    function drawCard(canvas, state, card, e) {
        // Card-level alpha — fades the whole card in or out when it
        // animates between a slot that has POSITIONS geometry and
        // one that doesn't. Without this, a card pushed past +1
        // (which has no geometry) would stay parked at +1's place
        // throughout the animation and then snap out of existence
        // at t=1; symmetrically, one returning would pop in. The
        // fade lets it dissolve cleanly in either direction.
        var cardAlpha = 1;
        // `pinnedPosAbs` short-circuits the position lerp in the
        // posAbs computation below when the card is doing a pure
        // fade-in or fade-out. Without it, lerping `animFrom` →
        // `position` from e.g. +2 to -2 walks through 0 at the
        // midpoint, which makes posClamped dip to 0 and momentarily
        // trips the focused-zone title-bar styling (dark fill). The
        // card *renders* at only one geometric side throughout the
        // fade, so we pin posAbs to that side too.
        var pinnedPosAbs = null;
        if (card._fromState) {
            // Slide animation (e.g. wrap-hint) — full opacity, and
            // pin posAbs to the destination so the title-bar style
            // doesn't crossfade through the focused zone while the
            // card is mid-slide.
            pinnedPosAbs = Math.abs(card.position);
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
        } else if (card.animFrom !== null) {
            posAbs = Math.abs(lerp(card.animFrom, card.position, e));
        } else {
            posAbs = Math.abs(card.position);
        }
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
            // +1 px on the title text so the focused card's label
            // reads visually centred against the 16-px bar — the
            // bar's mathematical centre lands too high for
            // Born2bSporty's optical baseline.
            drawTitleBar(canvas, state, card.name, fBg, 16, card.icon, 1);
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
                // Wrap-hint label: nudge 1 px down on top of
                // tabCfg.labelDy so the text reads centred against
                // the now-taller card silhouette.
                var labelDy = tabCfg.labelDy + (isWrapHint ? 1 : 0);
                HaxrcorpFont16.draw(canvas.ctx, card.name,
                    state.x + 3 + tabCfg.labelDx,
                    state.y + labelDy,
                    tabColor);
            }
            var edges = {};
            edges[tabCfg.openEdge] = false;
            // Wrap-hint shape: stroke ONLY top + left (drop bottom
            // and right), matching the "anchor in the bottom-left
            // corner of the screen" silhouette the user sees when
            // parked at the oldest app.
            if (isWrapHint) edges = { bottom: false, right: false };
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
        // Linear position relative to focus — cards above focus
        // (lower idx) land at positive positions, cards below at
        // negative. Cards array is ordered most-recent → oldest,
        // so cards[focusedIdx] is at 0, cards[focusedIdx + 1] at
        // -1, cards[focusedIdx - 1] at +1, etc.
        var pos = focusedIdx - idx;
        // The wrap-target peek-above (+1) only kicks in when the
        // truly-oldest card (idx = N - 1) would otherwise land at
        // a slot with no POSITIONS geometry (-3 or worse). Happens
        // at the most-recent focus state for N >= 4. For N <= 3
        // every card fits naturally, so no wrap.
        if (pos === -(n - 1) && pos < -2) return 1;
        return pos;
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
            c.animFrom   = c.position;
            c.position   = cyclicalPosition(j, focusedIdx, n);
            c.wrapHint   = false;
            c.hidden     = false;
            c._fromState = null;
        }

        // Wrap-hint at oldest fires for N >= 3. At N = 2 the only
        // "other" card lands at the visible +1 peek-above slot so
        // a wrap-hint adds no information; at N >= 3 the most-
        // recent's linear position is +2 (off-canvas) or worse,
        // which would just fade out without the loop-boundary
        // indicator. Layouts:
        //   N = 2 oldest: cards[0] at +1, cards[1] at 0 (no override).
        //   N = 3 oldest: cards[0] at -2 wrap-hint, cards[1] at +1,
        //                 cards[2] at 0.
        //   N = 4 oldest: cards[0] at -2 wrap-hint, cards[1]
        //                 at +2 (fade), cards[2] at +1, cards[3] at 0.
        if (n < 3 || focusedIdx !== n - 1) return;

        var mri = mostRecentAppIdx(cards);
        // Bail when the most-recent IS the currently-focused card
        // (defensive — shouldn't happen at N >= 4 oldest, but
        // covers degenerate cards arrangements).
        if (mri < 0 || mri === focusedIdx) return;
        var mr = cards[mri];
        mr.position = -2;
        mr.wrapHint = true;
        // Slide-up-from-below animation only when the previous
        // position had no geometry (off-carousel). When the card
        // was visibly somewhere else, lerp directly from there to
        // -2 instead — avoids the visual "teleport off-screen,
        // re-appear from below" jump.
        if (mr.animFrom !== -2 && POSITIONS[mr.animFrom] === undefined) {
            mr._fromState = WRAP_HINT_START;
        }

        // Hide any other card whose cyclical position landed at -2
        // (collides with the wrap-hint slot). Happens for N >= 4
        // without a transient — cards[1] would otherwise sit there.
        for (var k = 0; k < n; k++) {
            if (k === mri) continue;
            if (cards[k].position === -2) {
                cards[k].hidden = true;
            }
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
                animFrom:  null
            });
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
    }

    AppSwitcherScene.prototype.enter = function() {
        this.cards = buildCardsFromRunningApps(this._transient);
        this.focusedIdx = 0;
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

        var n = this.cards.length;
        if (n <= 1) return;

        // Cyclical scroll: Down moves focus forward (next-older
        // becomes focused, wrapping at the boundary), Up moves it
        // backward. The layout helper handles the position
        // recompute plus the at-oldest wrap-hint override (most-
        // recent slides up to -2, conflicting card hidden).
        this.focusedIdx = (this.focusedIdx + delta + n) % n;
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
        if (phase === PHASE_OPENING && card.position === 0) {
            var endStateOpening = POSITIONS[0];
            return endStateOpening
                ? lerpState(OPENING_START, endStateOpening, t)
                : null;
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
            // Hide the cyclical wrap target at +1 when the focus is
            // on the most-recent app. The card remains in `cards[]`
            // so an Up press still cycles to it — just don't paint
            // it on the LCD. focusedIdx === 0 covers both transient
            // (cards[0] = transient) and non-transient (cards[0] =
            // most-recent app) layouts.
            if (this.focusedIdx === 0 && card.position === 1) continue;
            // Cards explicitly hidden by the at-oldest wrap-hint
            // override (the cyclical card that would otherwise sit
            // at -2 and overlap the wrap-hint silhouette).
            if (card.hidden) continue;
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
                // Drop any one-shot ghost cards left over from
                // legacy wrap-hint code (none spawn in the cyclical
                // model, but the filter is cheap and keeps any
                // future ghost-style overlays cleanly removed).
                this.cards = this.cards.filter(function(c) { return !c._ghost; });
                for (var k = 0; k < this.cards.length; k++) {
                    this.cards[k].animFrom   = null;
                    this.cards[k]._fromState = null;
                    this.cards[k]._toState   = null;
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
