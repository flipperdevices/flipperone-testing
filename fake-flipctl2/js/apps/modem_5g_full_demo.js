/**
 * Modem5gFullDemoScene
 *
 * Testing → Kickstarter demo → Selected → '5G Modem Only Full' (and
 * All → 5G Modem → 'Only Full'). A standalone copy of the Low-Full
 * version (modem_5g_demo.js), no code shared, with the signal pinned
 * to that version's good phase. Fake 5G modem status screen,
 * pixel-matched to the design mock:
 *
 *   - Status bar: cellular bars + "5G" left, battery 69 % right (fixed,
 *     not the device's live state).
 *   - Left: a light "Cell info:" panel with striped label / value rows
 *     (Carrier, MCC, MNC, TAC, CID, PCI, Band, BW).
 *   - Right: Mode / Signal / RSRP, the big "5G" + antenna glyph and 15
 *     rising signal bars (black = lit, gray = unlit).
 *   - Help / More buttons (press flash only; More shows its toggle bar).
 *   - Power meter LEDs (PowerMeterLeds) while open: battery outline and
 *     a level-3 usage bar; all off again on exit.
 *
 * Scenario: always good — every TICK_MS the lit bars move to another of
 * MID_BARS - 1, MID_BARS, MID_BARS + 1 (never the same twice in a row,
 * so it always moves), with a signal % inside that bar's range; RSRP
 * and the status-bar bars follow.
 *
 * Back pops.
 */
var Modem5gFullDemoScene = (function() {
    var W = 256;

    // Colours (from the mock).
    var COL_PANEL  = '#F4F4F4';
    var COL_STRIPE = '#E1E1E1';
    var COL_LABEL  = '#666666';
    var COL_BAR_OFF = '#CCCCCC';

    // Left panel: x 0..94, y 20..126, right corners rounded.
    var PANEL_X = 0, PANEL_Y = 20, PANEL_W = 95, PANEL_H = 107, PANEL_R = 4;
    var TITLE_X = 4, TITLE_Y = 19;           // Born2bSporty, ink rows 22..31
    // Rows: 11 px each from ROW0_Y; even rows striped. Haxrcorp drawn at
    // the row top (ink +2..+8).
    var ROW0_Y = 34, ROW_H = 11;
    var LABEL_X = 4, VALUE_X = 38;
    var ROWS = [
        ['Carrier:', 'O2 UK'],
        ['MCC:',     '234'],
        ['MNC:',     '10'],
        ['TAC:',     '14608'],
        ['CID:',     '134703477'],
        ['PCI:',     '52'],
        ['Band:',    'n78'],
        ['BW:',      '80MHz']
    ];

    // Right block: label / value lines.
    var R_LABEL_X = 99, R_VALUE_X = 128;
    var MODE_Y = 20, SIGNAL_Y = 31, RSRP_Y = 42;

    // "5G" + antenna glyph (28×54, from the mock), top-left at (99, 73).
    var GLYPH_X = 99, GLYPH_Y = 73;
    var GLYPH = [
        '############....########....', '############....########....',
        '############..############..', '############..############..',
        '####..........####....####..', '####..........####....####..',
        '####..........####....####..', '####..........####....####..',
        '##########....####..........', '##########....####..........',
        '############..####..######..', '############..####..######..',
        '........####..####..######..', '........####..####..######..',
        '####....####..####....####..', '####....####..####....####..',
        '############..############..', '############..############..',
        '..########......########....', '..########......########....',
        '............................', '............................',
        '............................', '............................',
        '.##########################.', '############################',
        '############################', '############################',
        '.######.....####.....######.', '.######.....####.....######.',
        '...######...####...######...', '...######...####...######...',
        '.....######.####.######.....', '.....######.####.######.....',
        '.......##############.......', '.......##############.......',
        '.........##########.........', '.........##########.........',
        '............####............', '............####............',
        '............####............', '............####............',
        '............####............', '............####............',
        '............####............', '............####............',
        '............####............', '............####............',
        '............####............', '............####............',
        '............####............', '............####............',
        '............####............', '............####............'
    ];

    // Signal bars: 15 bars 7 px wide, 8 px pitch from x 133, standing on
    // row 126; bar i is 30 + 5 i px tall. Rounded ends: the top row is
    // inset 2, the next 1; same at the bottom.
    var BARS = 15, BAR_X0 = 133, BAR_PITCH = 8, BAR_W = 7;
    var BAR_BOTTOM = 126, BAR_H0 = 30, BAR_STEP = 5;

    // Power meter LEDs while the app is open: the battery outline and
    // a level-3 usage bar (green / yellow / orange).
    var METER = { battery: 'OUTLINE', usage: 3 };

    // Bottom buttons (Wi-Fi scanner geometry, nudged to the mock).
    var BTN_W = 48;
    var HELP_X = 52, MORE_X = 156;

    // Scenario: good signal only, MID_BARS ± 1 lit bars.
    var TICK_MS   = 500;
    var MID_BARS  = 13;                     // so the top is BARS - 1, never all lit

    function Modem5gFullDemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = '5G Modem';
        this.breadcrumbTitle = '5G Modem';
        this._timer = null;
        this._bars = MID_BARS;
        this._pct = pctFor(MID_BARS);
        this._fixedPct = null;               // set to pin a value (tests / stills)
        this._helpBtn = new UI.MiddleButton('Help', 1, BTN_W, 2, 'edit');
        this._moreBtn = new UI.MiddleToggleButton('More', 3, BTN_W, 2, 'del', null, true);
        this._helpBtn.x = HELP_X;
        this._moreBtn.x = MORE_X;
    }

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    // A random whole signal % that readings() shows as `bars` lit bars.
    function pctFor(bars) {
        var ok = [];
        for (var p = 0; p <= 100; p++) {
            if (Math.round(p / 100 * BARS) === bars) ok.push(p);
        }
        return ok[Math.floor(Math.random() * ok.length)];
    }

    // Signal % for this tick: one of the other two of MID_BARS ± 1.
    Modem5gFullDemoScene.prototype._tick = function() {
        var next = MID_BARS - 1 + Math.floor(Math.random() * 2);
        if (next >= this._bars) next++;
        this._bars = next;
        this._pct = pctFor(next);
        repaint();
    };

    Modem5gFullDemoScene.prototype._start = function() {
        this._bars = MID_BARS;
        this._pct = pctFor(MID_BARS);
    };

    Modem5gFullDemoScene.prototype.enter = function() {
        if (this._timer) return;
        var self = this;
        this._start();
        this._timer = setInterval(function() { self._tick(); }, TICK_MS);
        PowerMeterLeds.start(METER);
        repaint();
    };

    Modem5gFullDemoScene.prototype.exit = function() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        PowerMeterLeds.stop();
    };

    Modem5gFullDemoScene.prototype._flash = function(btn) {
        btn.press();
        repaint();
        setTimeout(function() { btn.release(); repaint(); }, 30);
    };

    Modem5gFullDemoScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
        if (action === 'edit') { this._flash(this._helpBtn); return; }
        if (action === 'del')  { this._flash(this._moreBtn); return; }
    };

    // Displayed values for signal % `pct`.
    function readings(pct) {
        var p = Math.round(pct);
        return {
            pct:  p,
            rsrp: Math.round(-140 + p * 0.7),          // 40 % → -112, 88 % → -78
            bars: Math.max(0, Math.min(BARS, Math.round(p / 100 * BARS))),
            sbar: Math.max(1, Math.min(5, Math.ceil(p / 20)))    // status bar, as UI's drawSignalBars
        };
    }

    // Fake status bar: same pixels as UI.drawStatusBar with the modem up
    // (cellular bars at x 2 + "5G"), battery 69 %, not charging.
    function drawStatusBar(canvas, sbars) {
        var ctx = canvas.ctx, top = 3;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, UI.STATUS_BAR_H);
        // 5 bars, 1 px wide, 1 px apart, 3..7 px tall, bottoms on row 9.
        for (var i = 0; i < 5; i++) {
            ctx.fillStyle = i < sbars ? '#fff' : '#555';
            ctx.fillRect(2 + 2 * i, 9 - (2 + i), 1, 3 + i);
        }
        HaxrCorp4090FlipCTL.draw(ctx, '5G', 12, top - 2, '#fff');
        var pct = '69%', bat = StatusBarBattery.sprite, bx = W - 2 - bat.w;
        HaxrCorp4090FlipCTL.draw(ctx, pct, bx - 1 - HaxrCorp4090FlipCTL.textWidth(pct), top - 2, '#fff');
        canvas.drawSprite(bat, bx, top - 1, '#fff');
        ctx.fillStyle = '#fff';
        ctx.fillRect(bx + 2, top + 1, Math.round(10 * 69 / 100), 5);
    }

    function drawBar(ctx, x, top, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x + 2, top, BAR_W - 4, 1);
        ctx.fillRect(x + 1, top + 1, BAR_W - 2, 1);
        ctx.fillRect(x, top + 2, BAR_W, BAR_BOTTOM - top - 3);
        ctx.fillRect(x + 1, BAR_BOTTOM - 1, BAR_W - 2, 1);
        ctx.fillRect(x + 2, BAR_BOTTOM, BAR_W - 4, 1);
    }

    Modem5gFullDemoScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        var r = readings(this._fixedPct != null ? this._fixedPct : this._pct);
        canvas.clear('#fff');

        // Left panel with its striped rows; right corners rounded.
        new ResponsiveFrame({
            x: PANEL_X, y: PANEL_Y, width: PANEL_W, height: PANEL_H,
            anchorH: 'left', anchorV: 'top',
            showStroke: false,
            showFill: true, fillColor: COL_PANEL,
            cornerRadius: PANEL_R,
            corners: { tl: false, tr: true, bl: false, br: true }
        }).render(canvas);
        Born2bSportyV2FlipCTL.draw(ctx, 'Cell info:', TITLE_X, TITLE_Y, '#000');
        for (var i = 0; i < ROWS.length; i++) {
            var ry = ROW0_Y + i * ROW_H;
            if (i % 2 === 0) {
                ctx.fillStyle = COL_STRIPE;
                ctx.fillRect(PANEL_X, ry, PANEL_W, ROW_H);
            }
            HaxrCorp4090FlipCTL.draw(ctx, ROWS[i][0], LABEL_X, ry, COL_LABEL);
            HaxrCorp4090FlipCTL.draw(ctx, ROWS[i][1], VALUE_X, ry, '#000');
        }

        // Right block.
        var lines = [
            ['Mode:',   'NSA',              MODE_Y],
            ['Signal:', r.pct + '%',        SIGNAL_Y],
            ['RSRP:',   r.rsrp + ' dBm',    RSRP_Y]
        ];
        for (var k = 0; k < lines.length; k++) {
            HaxrCorp4090FlipCTL.draw(ctx, lines[k][0], R_LABEL_X, lines[k][2], COL_LABEL);
            HaxrCorp4090FlipCTL.draw(ctx, lines[k][1], R_VALUE_X, lines[k][2], '#000');
        }

        // "5G" + antenna.
        ctx.fillStyle = '#000';
        for (var gy = 0; gy < GLYPH.length; gy++) {
            var row = GLYPH[gy];
            for (var gx = 0; gx < row.length; gx++) {
                if (row.charAt(gx) === '#') ctx.fillRect(GLYPH_X + gx, GLYPH_Y + gy, 1, 1);
            }
        }

        // Signal bars.
        for (var b = 0; b < BARS; b++) {
            drawBar(ctx, BAR_X0 + b * BAR_PITCH, BAR_BOTTOM - (BAR_H0 + b * BAR_STEP) + 1,
                b < r.bars ? '#000' : COL_BAR_OFF);
        }

        drawStatusBar(canvas, r.sbar);
        this._helpBtn.render(canvas);
        this._moreBtn.render(canvas);
    };

    return Modem5gFullDemoScene;
})();
