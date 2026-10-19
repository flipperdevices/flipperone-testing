/**
 * McuUiV002DemoScene
 *
 * Testing → UI Demos → MCU UI → 'MCU UI - v002'. Design-only mock of the
 * MCU UI (v001 is the former Power menu demo, power_menu_ui_demo.js),
 * pixel-matched to the design mock. No status bar.
 *
 *   - Top left: a gray "Auto Power OFF" pill and, under it, the time left
 *     ("in 0h 59m 58s"), counting down from Settings → Power → Auto Power
 *     OFF (AUTO_OFF, 1 hour by default) from every visit or change;
 *     hidden when that is Never.
 *   - Top right: "Discharge: 0.03W" and the battery: rounded outline
 *     with a gray-filled tip, a black charge fill (rounded ends) and the
 *     percent centred in it — black on the empty part, white over the
 *     fill (the digits invert where the fill runs under them).
 *   - Bottom left: firmware version in gray.
 *   - Bottom buttons Help / Power / Settings (the design's tab shapes,
 *     slanted edges included). A press inverts the button — black body,
 *     white label, outline kept — for PRESS_MS; no actions yet.
 *     X → Help (the Help menu), C / Power → Power Menu (from any
 *     screen of the app), V → Settings (opens the Settings
 *     list: Display / Power / Haptics & LEDs / System / About).
 *   - The dolphin swims in the middle (DOLPHIN, 14 frames at 2 fps).
 *     While the USB-C1 status line is up it moves over to the left, and
 *     back to the centre once the line is gone.
 *
 * The data is fake, set from a Test menu: a barely visible "Test"
 * button over B (run) opens it. Rows: USB-C1 cable, USB-C1 direction
 * (IN / OUT), PD, USB-C1 watts (2 W by default, capped at PD_LIMIT_W
 * without PD), battery %, power usage, Error and MCU LEDs. Plugging a
 * real cable into USB-C1 turns "USB-C1 cable" on (detected like Desktop
 * computer v2, see USB_POLL_MS), unplugging turns it off; the port then
 * shows the Test menu's direction, PD and watts. The screen and the LEDs follow the power
 * meter demo (github.com/repetren/dev.repetren.com, power_meter_demo):
 *   - charging (input covers the usage) or discharging (the battery
 *     covers more than BASE_USAGE_W) slides a black plate with the
 *     battery and a light info plate in from the right ("Charging: 5V
 *     4.11W / Untill full: 4h 2m", "Output: 5W / Left: 2h 34m", "Fully
 *     charged!"), the Discharge line rides off to the right and the
 *     Auto Power OFF countdown hides;
 *   - while charging the battery shows a spark instead of the digits
 *     and the plate shows the charge with hundredths;
 *   - a non-zero USB-C1 port adds "USB-C1 IN: PD Ver2 [9V/20W]" under it;
 *   - the physical battery / USB-C LEDs get the same states (green
 *     charging, yellow when the input can't keep up, red on error or
 *     critical charge, blinking BLINK_MS, discharge ticks green → red)
 *     through POST /api/mcu/leds (server.js → scripts/mcu-leds.py → MCU
 *     over I2C). They go dark when the app closes.
 *
 * While the app is open it takes the hardware Power button from the
 * MCU (POST /api/mcu/power-key, MCU register 0x0210): a press comes in
 * as the 'power' action and flashes the Power button instead of opening
 * the MCU's menu. Leaving the app gives the button back.
 *
 * Back pops (one page at a time; on the home screen it leaves the app).
 * Z (esc) goes straight to the home screen from anywhere in the app.
 */
var McuUiV002DemoScene = (function() {
    var COL_PILL     = '#AAAAAA';
    var COL_VERSION  = '#AAAAAA';
    var COL_OUTLINE  = '#232323';                // battery body outline (the tip is black)
    var COL_TIP      = '#DFDFDF';
    var COL_TIP_LOW  = '#9D9D9D';                // the tip's last inside row

    // Auto Power OFF pill (rows 5..15) and the countdown under it.
    var PILL = { x: 5, y: 5, w: 80, h: 11 };
    var PILL_TEXT_X = 10, PILL_TEXT_Y = 5;       // Haxrcorp, ink rows 7..13
    // Settings → Power → Auto Power OFF choices (seconds, 0 = Never).
    var AUTO_OFF = [
        { label: '5 min', s: 300 }, { label: '30 min', s: 1800 },
        { label: '1 hour', s: 3600 }, { label: '10 hours', s: 36000 },
        { label: 'Never', s: 0 }
    ];
    var AUTO_OFF_DEFAULT = 2;                    // 1 hour
    var TIMER_X = 10, TIMER_Y = 17;              // ink rows 19..25

    // Discharge line + battery.
    var DISCHARGE_Y = 6;
    var DISCHARGE_RIGHT = 208;                   // last ink column, 3 px before the battery
    // Outline x 212..249, y 3..19 (2 px corners); fill area x 214..247,
    // y 5..17 (1 px air inside the outline), its left corners cut by 1;
    // tip x 249..252, y 6..16 with a gray inside x 250..251, y 8..15
    // (its first inside row stays white, the last one is darker).
    var BAT = { x: 212, y: 3, w: 38, h: 17 };
    var FILL = { x: 214, y: 5, w: 34, h: 13 };
    var PCT_Y = 6;                               // Haxrcorp, ink rows 8..14

    var VERSION = '0.1.0 88f88s88 /gui-test';
    var VERSION_X = 5, VERSION_Y = 110;          // ink rows 112..118

    // Buttons from the design: per row, ' ' outside, '#' outline,
    // 't' label / icon ink, 'w' white inside the shape.
    var BUTTONS = {
        help: { x: 52, y: 130, rows: [
            '   ##############################################',
            '  #wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            ' #wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwtwwwtwwwwwwtwwwwwwwwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwtwwwtwwwwwwtwwwwwwwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwtwwwtwwttwwtwtttwwwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwtttttwtwwtwtwtwwtwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwtwwwtwttttwtwtwwtwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwtwwwtwtwwwwtwtwwtwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwtwwwtwwttwwtwtttwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwwwwwwwwwwwwwwtwwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwwwwwwwwwwwwwwtwwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#'
        ] },
        power: { x: 99, y: 122, rows: [
            '             ################################',
            '           ##wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww##',
            '          #wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            '         #wwwwwttttwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            '         #wwwwwtwwwtwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            '        #wwwwwwtwwwtwwttwwtwwtwwtwwttwwtttwwwwwww#',
            '        #wwwwwwttttwwtwwtwtwwtwwtwtwwtwtwwwwwwwww#',
            '       #wwwwwwwtwwwwwtwwtwtwwtwwtwttttwtwwwwwwwwww#',
            '       #wwwwwwwtwwwwwtwwtwtwwtwwtwtwwwwtwwwwwwwwww#',
            '      #wwwwwwwwtwwwwwwttwwwttwttwwwttwwtwwwwwwwwwww#',
            '      #wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            '     #wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            '     #wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            '    #wwwwwwwwwwwwwwwwwwwwwwwwtwwwwwwwwwwwwwwwwwwwwwww#',
            '    #wwwwwwwwwwwwwwwwwwwwwwtwtwtwwwwwwwwwwwwwwwwwwwww#',
            '   #wwwwwwwwwwwwwwwwwwwwwwtwwtwwtwwwwwwwwwwwwwwwwwwwww#',
            '   #wwwwwwwwwwwwwwwwwwwwwwtwwwwwtwwwwwwwwwwwwwwwwwwwww#',
            '  #wwwwwwwwwwwwwwwwwwwwwwwtwwwwwtwwwwwwwwwwwwwwwwwwwwww#',
            '  #wwwwwwwwwwwwwwwwwwwwwwwwtwwwtwwwwwwwwwwwwwwwwwwwwwww#',
            ' #wwwwwwwwwwwwwwwwwwwwwwwwwwtttwwwwwwwwwwwwwwwwwwwwwwwww#',
            ' #wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#'
        ] },
        settings: { x: 154, y: 130, rows: [
            ' ##############################################',
            '#wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            '#wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            ' #wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#',
            ' #wwwwwwwwwtttwwwwwwwwtwwwtwwtwwwwwwwwwwwwwwwwwww#',
            '  #wwwwwwwtwwwtwwwwwwwtwwwtwwwwwwwwwwwwwwwwwwwwww#',
            '  #wwwwwwwtwwwwwwttwwtttwtttwtwtttwwwtttwwttwwwww#',
            '   #wwwwwwwtttwwtwwtwwtwwwtwwtwtwwtwtwwtwtwwwwwww#',
            '   #wwwwwwwwwwtwttttwwtwwwtwwtwtwwtwtwwtwwtwwwwww#',
            '    #wwwwwtwwwtwtwwwwwtwwwtwwtwtwwtwtwwtwwwtwwwww#',
            '    #wwwwwwtttwwwttwwwtwwwtwwtwtwwtwwtttwttwwwwww#',
            '     #wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwtwwwwwwwww#',
            '     #wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwttwwwwwwwwww#',
            '      #wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww#'
        ] }
    };
    var KEY_TO_BUTTON = { edit: 'help', power: 'power' };   // V (del) opens Settings
    var PRESS_MS = 150;

    // "Test" button over B (run): the stock right-button shape, drawn
    // barely visible.
    var TEST_BTN = { x: 208, w: 48, h: 14, text: 'Test' };
    var COL_TEST_LINE = '#E4E4E4';
    var COL_TEST_TEXT = '#D6D6D6';

    // Fake power model (the power meter demo's numbers).
    var PD_LIMIT_W   = 15;                       // USB-C1 input without PD
    var MAX_W        = 36;
    var BASE_USAGE_W = 0.3;                      // on battery, draw below this shows nothing
    var BATTERY_WH   = 7.2 * 3.7;                // 7200 mAh at 3.7 V
    // Stepper ladders for the Test menu (left / right step one value).
    var OUT_W_STEPS = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1];   // then whole watts
    var USAGE_STEPS = [0, 0.03, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5];  // then whole watts
    var MAX_USAGE_W = 60;
    var DEFAULT_SIM = { dir: 'in', pd: false, desiredW: 2, charge: 48,
                        usage: 0.03, error: false, leds: true, plugged: false };

    // USB-C1 cable detection, the same as Desktop computer v2: GET
    // /api/usbc every USB_POLL_MS; ids
    //   'typec:<portN>'  a Type-C partner (the main, earliest signal);
    //   'drm:<conn>'     a display connector reports "connected";
    //   'udc:<name>'     the USB gadget port sees a host;
    //   'psu:<name>'     an external supply is online.
    // The first snapshot is the baseline (built-in hardware); a new id
    // not in it means a cable is in. Baseline ids that disappear are
    // dropped, so a cable already in when the app opened counts once
    // replugged. Plug / unplug flip sim.plugged; the port's direction,
    // PD and watts stay the Test menu's.
    var USB_POLL_MS = 250;
    var TYPEC_PORT = null;   // e.g. 'port0' once USB-C1 is identified on the device

    // Charge / discharge plates: both slide in from SLIDE_FROM px to the
    // right over SLIDE_MS in whole pixels; the Discharge line rides off
    // the right edge over the same time.
    var SLIDE_MS = 200, SLIDE_FROM = 84;
    var PLATE_H = 23;                            // rows 0..22
    var BG_PLATE_X   = 153;                      // black plate, its top-left pixel
    var INFO_PLATE_X = 86;                       // light plate, its top-left pixel
    var COL_INFO_PLATE = '#EEEEEE';
    // Black plate shift: discharging shows no percent, full shows "100%".
    var BG_SHIFT_DISCHARGE = 43, BG_SHIFT_FULL = 18;
    // Info plate layout per state: plate (x of the content box + plate
    // offset) and the two lines' x, relative to INFO_PLATE_X - 86.
    var INFO = {
        discharge: { box: 39, plate: 0,  line1: 96,  line2: 101 },
        charge:    { box: -15, plate: -5, line1: 90, line2: 98 },
        chargeLow: { box: -23, plate: -5, line1: 90, line2: 95 },
        full:      { box: 3,  plate: -5, line1: 100, line2: 98 }
    };
    var INFO_LINE1_Y = 1, INFO_LINE2_Y = 12, INFO_FULL_Y = 6;  // Haxrcorp draw y
    var PLATE_PCT_RIGHT = 210;                   // last ink column of "38.00%"
    var PLATE_PCT_Y = 3;                         // Born2bSporty draw y

    // USB-C1 status line under the plates: gray text, then a gray box
    // with the port's volts / watts in white. Box rows 30..40, right
    // edge x 250, 5 px side padding.
    var STATUS_Y = 30;                           // Haxrcorp draw y (ink rows 32..38)
    var BOX = { right: 250, y: 30, h: 11, pad: 5 };
    var STATUS_GAP = 4;                          // text → box
    var COL_STATUS = '#696969';
    var COL_BOX    = '#AAAAAA';

    // Battery while a plate is up: light outline on the black plate, the
    // charge fill turns white (rows/cols as the idle battery).
    var CELL_ROWS = [
        '  cccccccccccccccccccccccccccccccccc',
        ' c##################################c',
        'c####################################c',
        'c####################################ccc',
        'c####################################cwwc',
        'c####################################cttc',
        'c####################################cttc',
        'c####################################cttc',
        'c####################################cttc',
        'c####################################cttc',
        'c####################################cttc',
        'c####################################cttc',
        'c####################################cggc',
        'c####################################ccc',
        'c####################################c',
        ' c##################################c',
        '  cccccccccccccccccccccccccccccccccc'
    ];
    var CELL_COLORS = { c: '#CCCCCC', '#': '#000', w: '#fff', t: '#DFDFDF', g: '#9D9D9D' };
    // Charging spark over the battery ('#' black, 'w' white edge).
    var SPARK = { x: 227, y: 6, rows: [
        '     w',
        '    w#w',
        '   w##w',
        '  w###w',
        ' w###www',
        'w#######w',
        'wwww###w',
        '  w###w',
        '  w##w',
        '  w#w',
        '   w'
    ] };
    // Glyphs the Haxrcorp font lacks: "×" (no PD) and "∞".
    var GLYPH_X   = ['#   #', ' # # ', '  #  ', ' # # ', '#   #'];
    var GLYPH_INF = [' ##   ## ', '#  # #  #', '#   #   #', '#  # #  #', ' ##   ## '];

    // Physical LEDs (names as in scripts/mcu-leds.py), RGB565.
    var LED_OFF = 0x0000, LED_GREEN = 0x07E0, LED_YELLOW = 0xFFE0,
        LED_ORANGE = 0xFC00, LED_RED = 0xF800;
    var LED_NAMES = ['bat_outline', 'bat_center', 'bat_watt1', 'bat_watt2',
                     'bat_watt3', 'bat_watt4', 'usb_charging', 'usb_watt1',
                     'usb_watt2', 'usb_watt3', 'usb_watt4'];
    var BLINK_MS = 1000;                         // on for the first half
    var LED_TICK_MS = 100;
    // Every LED is re-sent this often, not only the changed ones: the
    // MCU's own Settings → LEDs preset overwrites the wattmeter LEDs and
    // nothing redraws them otherwise.
    var LED_RESEND_MS = 3000;
    var FRAME_MS = 40;                           // repaint while sliding
    // The hardware Power button belongs to this app while it's open
    // (POST /api/mcu/power-key): it arrives as the 'power' action and
    // flashes the Power button. The server lease runs out after 6 s
    // without a renewal, so it's renewed every POWER_KEY_RENEW_MS.
    var POWER_KEY_RENEW_MS = 2000;

    // Power Menu (C or the hardware Power button on the home screen): a
    // window with a drop shadow over the washed home screen — header band
    // with power_menu_icon and "Power Menu", then Start / Power OFF (up /
    // down pick, the picked one bold in a selector frame). The Power
    // button stays drawn at full contrast above the wash while it's open.
    var POWER_MENU = {
        // Frame x 61..190, y 39..101, + 3 px shadow: the whole block
        // (61..193 × 39..104) sits centred on the screen.
        x: 61, y: 39, w: 130, h: 63, band: 20, radius: 4,
        shadow: 3,
        iconX: 66, iconY: 43, titleX: 82, titleY: 44,        // absolute
        rowFrame: { x: 80, y: 64, w: 91, h: 16 },            // selector of row 1 (absolute)
        rowPitch: 17, boldY: 67, regularY: 66,               // row 1 text: Helvb08 / Haxrcorp draw y
        cx: 125, regularCX: 124                               // label centres: bold / regular
    };
    // Help menu (X, the Help button): same window style as the Power
    // Menu — help_question badge and "Flipper One - Help" in the band,
    // then a left-aligned list (up / down pick; nothing opens yet).
    var HELP_MENU = {
        // Frame x 51..200 (y 27..105) + 3 px shadow, centred as a block.
        x: 51, y: 27, w: 150, h: 79, band: 20, radius: 4, shadow: 3,
        iconX: 56, iconY: 31, title: 'Flipper One - Help', titleX: 74, titleY: 32,
        items: ['Quick start', 'Ports', 'Troubleshooting'],
        rowFrame: { x: 70, y: 52, w: 111, h: 16 },           // selector of row 1 (absolute)
        rowPitch: 16, textX: 80, textY: 55                    // row 1 label draw y (Helvb08 and Haxrcorp)
    };
    // Help window (OK on a Help menu row): the pages Quick start / Ports
    // and slots / Troubleshooting, flipped with left / right (the page
    // tabs flash on a press) and scrolled with up / down (a dotted
    // scrollbar with a 3 px thumb). Back returns to the Help menu.
    var HELP_WINDOW = {
        x: 5, y: 5, w: 244, h: 131, band: 19, radius: 4, shadow: 2,    // frame x 5..248, y 5..135
        iconX: 12, iconY: 9, titleX: 30, titleY: 10, pageRight: 242,    // header
        view: { x: 6, y: 25, w: 236, h: 109 },                          // content viewport
        textX: 13, wrapW: 224,
        titleGap: 20, titleGapText: 17,                                 // title → heading / → paragraph
        line: 11, sectionGap: 11,                                       // px
        bar: { x: 243, y: 27, h: 105, pad: 0 }                          // dots at x, thumb x-1..x+1
    };
    // Page content: { title, blocks } — { h } a bold heading, { p } a
    // wrapped paragraph ({down} / {router} inline icons), { gap } an
    // empty line, { qr, lines } the docs QR code with lines beside it.
    var HELP_PAGES = [
        { title: 'Quick start', blocks: [
            { p: 'Flipper One is Portable Linux Computer.' },
            { p: 'It has different Operation Modes.' },
            { gap: 1 },
            { p: 'Now you are in MCU Mode. Only basic functions are available: Power Bank and Power Delivery tester.' },
            { gap: 1 },
            { p: 'To start Linux, press this {down} button.' }
        ] },
        { title: 'Ports and slots', blocks: [
            { h: 'USB-C1' },
            { p: 'This is main USB port. You can charge device through it or it can power your devices, like power bank do. In Linux Mode this port can be USB Ethernet, DisplayPort or USB data. Plug your devices into USB-C1, or connect Flipper One USB-C1 to another host.' },
            { gap: 1 },
            { p: 'Use USB-C1 to flash MCU firmware and for Maskrom mode.' },
            { h: 'USB-A and USB-C2' },
            { p: 'It can power your devices from this port 5V 3A max. In Linux Mode, plug in your USB devices: drives, keyboards, adapters and etc.' },
            { h: 'HDMI' },
            { p: 'Plug in your screen or TV to get the picture up to 4K\u00a0@\u00a0120Hz.' },
            { h: 'ETH0 and ETH1' },
            { p: '1 Gbps each. Launch the {router} Router with different port configurations of WAN, LAN or Bridge mode' },
            { h: 'M.2' },
            { p: 'Hidden behind the Back Plate. Use screwdriver to instal M.2 expansion modules: cellular modems, Wi-Fi, SDR, NVMe SSDs, GNSS modules, AI accelerators, and other M.2 modules.' },
            { gap: 1 },
            { p: 'Key B, Supported sizes: 2230(via extender), 2242, 3042, 3052' },
            { gap: 1 },
            { p: 'It also has: PCIe 2.1 x1, USB 2.0, USB 3.1, SATA3, Serial Audio, UART, I2C, SIM card + eSIM' },
            { h: 'NANO SIM' },
            { p: 'Works only with a modem in the M.2 slot.' },
            { h: '3.5 Audio' },
            { p: 'Plug in a TRRS headset to use headphones with a mic.' }
        ] },
        { title: 'Troubleshooting', blocks: [
            { h: "Can't boot Linux mode" },
            { p: 'Check whether your SD card or UFS has Linux image on it. Or use On-Device Recovery in Settings\u00a0-\u00a0System\u00a0-\u00a0CPU\u00a0Recovery.' },
            { h: "Doesn't charge" },
            { p: 'Flipper One can be charged only through USB-C1 port. Check battery in Settings\u00a0-\u00a0Power\u00a0-\u00a0Battery\u00a0Info.' },
            { h: 'Need additional help?' },
            { qr: 'docs', lines: ['For docs and support', 'go to docs.flipper.net/one'] }
        ] }
    ];
    // QR code for https://docs.flipper.net/one (version 3, ECC M, mask 0;
    // 29×29 modules, '#' dark), drawn at HELP_QR_SCALE px per module.
    var HELP_QR_DOCS = [
        '#######..##.##..#.##..#######',
        '#.....#.#####.######..#.....#',
        '#.###.#...#.###.#..#..#.###.#',
        '#.###.#..###.###..#...#.###.#',
        '#.###.#.###.#.#....#..#.###.#',
        '#.....#......#...###..#.....#',
        '#######.#.#.#.#.#.#.#.#######',
        '..........##.##.##..#........',
        '#.#.#.#....#..##.####...#..#.',
        '#..##..#..#...##.....###.#..#',
        '......##...###...#..##.#..###',
        '.###.#.#.#.#...#.##..###...#.',
        '..#.###..##.....##...###.#.##',
        '##..#....##..#.##...###..#..#',
        '#..####.#.#...####...###.#.##',
        '..#.#....##.###.########.#.#.',
        '......#.......##.#..###..#.##',
        '.#.##..#...#..##....###..##.#',
        '#..#.####.####...#..##.#...##',
        '.##..#...#.#...#.#.#.#..##.#.',
        '#....##.##.#....##..#####....',
        '........###.##.###..#...#.###',
        '#######..#....###..##.#.##.##',
        '#.....#...#####.###.#...##.#.',
        '#.###.#.#..#..##..#.#####..#.',
        '#.###.#...#.#.##...#...##.#..',
        '#.###.#.#...#.#..#..#..###..#',
        '#.....#..##.####....####...#.',
        '#######.#..#.##.#..######..##'
    ];
    var HELP_QR_SCALE = 2;
    var HELP_QR_TEXT_GAP = 8;                    // QR → its lines

    // A typographic apostrophe (U+2019) for Haxrcorp, which has none:
    // 2 px wide, 3 px advance, its top on the cap line. A no-break space
    // (U+00A0) in help text keeps words together when wrapping and is
    // drawn as a plain space.
    var RSQUO = ['.#', '.#', '#.'];
    function haxrWidth(t) {
        t = t.replace(/\u00a0/g, ' ');
        var n = (t.match(/\u2019/g) || []).length;
        return n ? HaxrCorp4090FlipCTL.textWidth(t.replace(/\u2019/g, '')) + 3 * n
                 : HaxrCorp4090FlipCTL.textWidth(t);
    }
    function drawHaxr(ctx, t, x, y, color) {
        var H = HaxrCorp4090FlipCTL, parts = t.replace(/\u00a0/g, ' ').split('\u2019');
        for (var i = 0; i < parts.length; i++) {
            if (parts[i]) { H.draw(ctx, parts[i], x, y, color); x += H.textWidth(parts[i]) + 1; }
            if (i < parts.length - 1) { drawMap(ctx, RSQUO, x, y + 2, { '#': color }); x += 3; }
        }
    }
    // The {down} glyph of the Quick start page (a filled down arrow,
    // 11×7, its top on the text's cap line).
    var HELP_DOWN_ICON = [
        ' ######### ',
        '###########',
        ' ######### ',
        '  #######  ',
        '   #####   ',
        '    ###    ',
        '     #     '
    ];
    // Network LEDs (server names) kept dark while this app is open.
    var NET_LEDS_OFF = ['wifi', 'eth0', 'eth1'];

    // Settings (V → the Settings button): a plain submenu (breadcrumb
    // and list where every submenu has them) under a white header with
    // only the battery. Row icons are the design's, in icons.js.
    var SETTINGS_ROWS = [
        { text: 'Display',        icon: 'display' },
        { text: 'Power',          icon: 'power_settings' },
        { text: 'Haptics & LEDs', icon: 'haptic' },
        { text: 'System',         icon: 'system_icon_settigns' },
        { text: 'About',          icon: 'about_settings' }
    ];
    var SETTINGS_BAT_TOP = 2;                    // battery rows 1..9 ("69%" ink rows 2..8)

    // Settings → Display: the real LCD backlight via /api/backlight
    // (server.js → scripts/mcu-backlight.py → MCU). Level and auto-off
    // are saved to MCU flash on every write, so only the value the
    // stepper stops on is sent, BL_WRITE_MS after the last press.
    // OFF blanks the screen (any key wakes it on the MCU side), with a
    // failsafe back on after BL_OFF_FAILSAFE_MS.
    var BL_LEVELS = [0, 2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];  // %, 0 = OFF
    var BL_TIMEOUTS = [                          // MCU units: 100 ms, 0 = never
        { label: '3 sec', ds: 30 }, { label: '10 sec', ds: 100 },
        { label: '30 sec', ds: 300 }, { label: '1 min', ds: 600 },
        { label: '2 min', ds: 1200 }, { label: '5 min', ds: 3000 },
        { label: 'Never', ds: 0 }
    ];
    var BL_DEFAULT_LEVEL = 3;                    // 10 %, until the MCU's value is read
    var BL_DEFAULT_TIMEOUT = 1;                  // 10 sec
    var BL_WRITE_MS = 700;
    var BL_OFF_FAILSAFE_MS = 10000;
    // Settings help: on a row whose value costs energy (see each page's
    // help topics) a Help button (the in_button_help icon) over X — the
    // View key — blinks (inverted every HELP_BLINK_MS) until that topic
    // has been opened once; X opens the help window.
    var HELP_BTN = { x: 52, w: 48, iconDy: 1 };  // icon rows 132..142
    var HELP_BLINK_MS = 500;
    // Help window, from the design: rounded 1 px frame, a light header
    // band with the "?" badge and the title, the body text under it.
    var HELP_WIN = { w: 156, h: 51, band: 20, radius: 4 };  // h for two body lines, +pitch per extra
    var COL_HELP_BAND = '#E4E4E4';
    var COL_WINDOW_LINE = '#3C3C3C';             // frame of the help / confirm windows
    var COL_POWER_MENU_LINE = '#000';            // Power Menu frame and shadow
    var HELP_WASH = 'rgba(255, 255, 255, 0.5)';   // over the page, under the window
    var HELP_ICON_X = 3, HELP_ICON_Y = 4;        // in the window
    var HELP_TITLE_X = 22, HELP_TITLE_Y = 5;     // Haxrcorp draw position
    var HELP_BODY_X = 5, HELP_BODY_Y = 23, HELP_BODY_PITCH = 12;

    // Swimming dolphin: a vertical sheet of 114×62 frames (the design's
    // dolphin-new-swim-smile.mp4, its codec noise snapped to pure black /
    // white, the bubbles' grays kept), drawn under the rest of
    // the UI. Centred on the screen; moves to leftX while the USB-C1
    // status line shows.
    var DOLPHIN = {
        src: 'assets/MCU_UI/dolphin-new-swim-smile_sheet.png',
        w: 114, h: 62, frames: 14, frameMs: 500,
        y: 41, centerX: 71, leftX: 10,
        moveMs: 350
    };

    function McuUiV002DemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'MCU UI - v002';
        this.breadcrumbTitle = 'MCU UI - v002';
        this._startedAt = 0;
        this._timer = null;
        this._pressed = null;                    // button name while flashing
        this._pressTimer = null;
        this._sim = {};
        for (var k in DEFAULT_SIM) this._sim[k] = DEFAULT_SIM[k];
        this._inMenu = false;                    // Test / Settings on top: keep running
        this._wasActive = false;                 // plates were up on the last frame
        this._activeAt = 0;                      // when they started sliding in
        this._ledTimer = null;
        this._ledSent = null;                    // last colours sent, by name
        this._ledSentAt = 0;                     // last full send
        this._powerKeyTimer = null;
        this._usbTimer = null;
        // Settings → Power values (fake: nothing on the device changes
        // except the home screen's Auto Power OFF countdown).
        this._power = { autoOff: AUTO_OFF_DEFAULT, usbA_C2: true, gpio5: true, gpio33: true };
        this._autoOffAt = 0;                     // countdown start
        this._helpSeen = {};                     // help topics opened, by title
        this._powerMenu = null;                  // { sel: 0 Start / 1 Power OFF } while open
        this._helpMenu = null;                   // { sel } while the Help menu is open
        this._helpWin = null;                    // { page, scroll, press, pressAt } while open
        this._ledsHeld = false;                  // Power OFF screen: LED loop paused
        this._usbBaseline = null;                // ids present when the app opened
        this._usbFresh = false;                  // a new id is present
        this._dolphinImg = null;
        this._dolphinLeft = null;                // null: place without moving
        this._dolphinFrom = DOLPHIN.centerX;
        this._dolphinMoveAt = 0;
    }

    function repaint() {
        if (window.requestRender) window.requestRender();
    }

    // ── Fake power model ─────────────────────────────────────────

    // Everything the screen and the LEDs show, from the Test menu values
    // (same rules as the power meter demo).
    function derive(sim) {
        var limit = sim.pd ? MAX_W : PD_LIMIT_W;
        var portW = sim.plugged ? Math.min(sim.desiredW, limit) : 0;  // what the port carries
        var watts = sim.dir === 'in' ? portW : 0;           // coming in
        var usageW = sim.usage + (sim.dir === 'out' ? portW : 0);
        var full = sim.charge >= 100;
        // Charging: plugged in and the input covers the usage; the error
        // state kills all charging UI.
        var charging = watts > 0 && usageW <= watts && !sim.error;
        // On battery the base usage doesn't count; with a cable in, any
        // deficit is battery draw.
        var excess = usageW - watts - (watts > 0 ? 0 : BASE_USAGE_W);
        var discharging = excess > 0;
        return {
            portW: portW, watts: watts, usageW: usageW, full: full,
            charging: charging, excess: excess, discharging: discharging,
            active: charging || discharging,
            critical: sim.charge < 5 && !charging,
            yellow: watts > 0 && usageW > watts
        };
    }

    // "0.5W", "12W": no trailing zeros.
    function fmtW(w) {
        return parseFloat(w.toFixed(2)) + 'W';
    }

    // "2h 34m" / "34m" from hours.
    function hmText(hours) {
        var totalMin = Math.ceil(hours * 60);
        var h = Math.floor(totalMin / 60);
        return { h: h, text: (h > 0 ? h + 'h ' : '') + (totalMin % 60) + 'm' };
    }

    // Info plate lines: { layout, line1, line2, inf } (inf: line2 ends
    // with the ∞ glyph).
    function infoLines(sim, d) {
        if (d.discharging) {
            var shownOut = d.usageW > 9 ? Math.round(d.usageW) : parseFloat(d.usageW.toFixed(2));
            var left = hmText((sim.charge / 100) * BATTERY_WH / (d.usageW - d.watts));
            return { layout: INFO.discharge, line1: 'Output: ' + shownOut + 'W',
                     line2: left.h > 48 ? 'Left: > 48h' : 'Left: ' + left.text };
        }
        if (d.full) return { layout: INFO.full, line1: 'Fully charged!', line2: '' };
        var volts = d.watts <= 15 ? 5 : d.watts <= 27 ? 9 : 12;
        // The battery only gets what the system doesn't use; above 9 W
        // the fraction is noise.
        var into = Math.max(0, d.watts - d.usageW);
        var shownW = into > 9 ? Math.round(into) : parseFloat(into.toFixed(2));
        var r = { layout: Number.isInteger(shownW) ? INFO.charge : INFO.chargeLow,
                  line1: 'Charging: ' + volts + 'V ' + shownW + 'W',
                  line2: 'Untill full: ', inf: true };
        if (into > 0) {
            var t = hmText((1 - sim.charge / 100) * BATTERY_WH / into);
            if (t.h < 100) { r.line2 += t.text; r.inf = false; }
        }
        return r;
    }

    // Next / previous value on a ladder: `steps`, then whole numbers up
    // to `max`.
    function stepValue(v, dir, steps, max) {
        var all = steps.slice();
        for (var w = Math.floor(steps[steps.length - 1]) + 1; w <= max; w++) all.push(w);
        var i;
        if (dir === 'right') {
            for (i = 0; i < all.length; i++) if (all[i] > v + 1e-9) return all[i];
            return all[all.length - 1];
        }
        for (i = all.length - 1; i >= 0; i--) if (all[i] < v - 1e-9) return all[i];
        return all[0];
    }

    // ── LEDs ─────────────────────────────────────────────────────

    // Colour per LED for this moment (blinking ones follow `now`).
    function ledColors(sim, d, now) {
        var blinkOn = (now % BLINK_MS) < BLINK_MS / 2;
        var c = {};
        for (var i = 0; i < LED_NAMES.length; i++) c[LED_NAMES[i]] = LED_OFF;
        // Battery icon: red on error, red outline at critical charge,
        // yellow when the input can't keep up (all blinking); green
        // bolt + outline while charging, green outline while draining.
        var yellow = d.yellow && !d.critical && !sim.error;
        var center = d.watts > 0 && !d.full && !d.yellow && !d.critical && !sim.error;
        var outline = center || (d.excess > 0 && !d.yellow && !d.critical && !sim.error);
        if (sim.error) {
            if (blinkOn) c.bat_outline = c.bat_center = LED_RED;
        } else if (d.critical) {
            if (blinkOn) c.bat_outline = LED_RED;
        } else if (yellow) {
            if (blinkOn) c.bat_outline = c.bat_center = LED_YELLOW;
        } else {
            if (center) c.bat_center = LED_GREEN;
            if (outline) c.bat_outline = LED_GREEN;
        }
        // Discharge ticks (watt1 next to the battery): up to 8 W they
        // stack green / yellow / orange / red; above that all four show
        // a hotter mix.
        var e = d.excess;
        if (!sim.error && e > 0) {
            var t;
            if (e <= 8) {
                t = [LED_GREEN, e > 2 ? LED_YELLOW : 0, e > 4 ? LED_ORANGE : 0, e > 6 ? LED_RED : 0];
            } else if (e <= 12) {
                t = [LED_YELLOW, LED_YELLOW, LED_RED, LED_RED];
            } else if (e <= 24) {
                t = [LED_ORANGE, LED_ORANGE, LED_RED, LED_RED];
            } else {
                t = [LED_ORANGE, LED_RED, LED_RED, LED_RED];
            }
            c.bat_watt1 = t[0]; c.bat_watt2 = t[1]; c.bat_watt3 = t[2]; c.bat_watt4 = t[3];
        }
        // USB-C: plug green with PD, yellow without; chevrons by the
        // incoming watts (an idle full battery shows the plug only).
        if (d.watts > 0) c.usb_charging = sim.pd ? LED_GREEN : LED_YELLOW;
        if (!sim.error && (sim.charge < 100 || sim.usage > 0)) {
            if (d.watts > 0)    c.usb_watt1 = LED_GREEN;
            if (d.watts > 7.5)  c.usb_watt2 = LED_GREEN;
            if (d.watts > 15)   c.usb_watt3 = LED_GREEN;
            if (d.watts > 27)   c.usb_watt4 = LED_GREEN;
        }
        return c;
    }

    // Network LEDs: take them over (the server's auto loop steps aside)
    // and switch Wi-Fi / Ethernet off; release hands them back to it.
    // The calls go one at a time, in order, so a release can't overtake
    // the takeover after it.
    var netQueue = Promise.resolve();
    function netPost(url, body) {
        netQueue = netQueue.then(function() {
            return fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).catch(function() { /* desktop preview */ });
        });
    }
    function setNetLedsOff() {
        netPost('/api/led/manual', { enabled: true });
        NET_LEDS_OFF.forEach(function(led) { netPost('/api/led/set', { led: led, on: false }); });
    }
    function releaseNetLeds() {
        netPost('/api/led/manual', { enabled: false });
    }

    function postLeds(body) {
        try {
            fetch('/api/mcu/leds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).catch(function() { /* no MCU (desktop preview) */ });
        } catch (e) { /* ignore */ }
    }

    // Sends the LEDs that changed since the last send.
    McuUiV002DemoScene.prototype._ledTick = function() {
        if (!this._sim.leds || this._ledsHeld) return;
        var now = Date.now();
        var c = ledColors(this._sim, derive(this._sim), now);
        var all = !this._ledSent || now - this._ledSentAt >= LED_RESEND_MS;
        var changed = {}, any = false;
        for (var n in c) {
            if (all || this._ledSent[n] !== c[n]) { changed[n] = c[n]; any = true; }
        }
        if (all) this._ledSentAt = now;
        if (!any) return;
        this._ledSent = c;
        postLeds({ leds: changed });
    };

    function postPowerKey(toCpu) {
        try {
            fetch('/api/mcu/power-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to_cpu: toCpu })
            }).catch(function() { /* no MCU (desktop preview) */ });
        } catch (e) { /* ignore */ }
    }

    McuUiV002DemoScene.prototype._ledsOff = function() {
        this._ledSent = null;
        postLeds({ action: 'off' });
    };

    // Settings → Power → Battery Info: the design's page (battery,
    // health, capacity, temperature, cycles — all in the art) under the
    // settings header and a "> Settings > Power > Battery Info"
    // breadcrumb. Back returns.
    var BATTERY_INFO = {
        src: 'assets/MCU_UI/Battery_UI/mcu_mode_settings_battery.png',
        crumb: '> Settings > Power > Battery Info', crumbX: 4, crumbY: 11, crumbCol: '#AAAAAA'
    };
    McuUiV002DemoScene.prototype._batteryInfoScene = function() {
        var self = this, img = null;
        return {
            breadcrumbTitle: 'Battery Info',
            enter: function() {
                // Re-fetched on every visit, so art swapped on disk shows up.
                var im = new Image();
                im.onload = function() { img = im; repaint(); };
                im.src = BATTERY_INFO.src + '?v=' + Date.now();
                repaint();
            },
            exit: function() {},
            handleInput: function(action) {
                if (action === 'back' || action === 'esc') return 'pop';
            },
            render: function(canvas) {
                canvas.clear('#fff');
                if (img && img.complete && img.naturalWidth) canvas.ctx.drawImage(img, 0, 0);
                self._drawSettingsHeader(canvas);
                var b = BATTERY_INFO;
                HaxrCorp4090FlipCTL.draw(canvas.ctx, b.crumb, b.crumbX, b.crumbY, b.crumbCol);
            }
        };
    };

    // Settings → Power page. Auto Power OFF sets the home screen's
    // countdown (restarted on every change; Never hides it); the rest
    // are plain ON / OFF toggles; Battery Info opens its page. Help on
    // Auto Power OFF = Never and on every power line that's ON.
    McuUiV002DemoScene.prototype._buildPowerSettings = function(sm) {
        var self = this, pw = this._power;
        var sub = new SubMenuScene(sm, 'Power',
            ['Auto Power OFF', 'USB-A & USB-C2', 'GPIO 5V', 'GPIO 3.3V', 'Battery Info'], {
                'Battery Info': function() { return self._batteryInfoScene(); }
            });
        sub.setBreadcrumbTrail(['Settings', 'Power']);
        sub.setHeaderRenderer(function(canvas) { self._drawSettingsHeader(canvas); });
        sub.setIgnoreRun(true);
        liftLabels(sub);
        markDrill(sub, ['Battery Info']);
        var auto = sub.items[0];
        auto.statusProvider = function() { return '< ' + AUTO_OFF[pw.autoOff].label + ' >'; };
        auto.atStart = function() { return pw.autoOff <= 0; };
        auto.atEnd = function() { return pw.autoOff >= AUTO_OFF.length - 1; };
        auto.onAdjust = function(dir) {
            var i = Math.max(0, Math.min(AUTO_OFF.length - 1, pw.autoOff + (dir === 'right' ? 1 : -1)));
            if (i === pw.autoOff) return;
            pw.autoOff = i;
            self._autoOffAt = Date.now();
        };
        var toggles = [['usbA_C2', 1], ['gpio5', 2], ['gpio33', 3]];
        toggles.forEach(function(t) {
            var key = t[0], item = sub.items[t[1]];
            item.statusProvider = function() { return pw[key] ? '< ON >' : '< OFF >'; };
            item.onToggle = function() { pw[key] = !pw[key]; };
        });
        var lineKeys = { 1: 'usbA_C2', 2: 'gpio5', 3: 'gpio33' };
        this._attachHelp(sub, function() {
            var i = sub.selectedIndex;
            if (i === 0 && AUTO_OFF[pw.autoOff].s === 0) {
                return { title: 'Auto Power OFF',
                         text: 'Energy usage will be higher if the Flipper One never turns OFF' };
            }
            if (lineKeys[i] && pw[lineKeys[i]]) {
                var name = sub.items[i].text;
                // One "seen" for all three lines: read once, none blinks.
                return { title: name, seen: 'power-lines',
                         text: 'Energy usage will be higher when ' + name + ' power is ON' };
            }
            return null;
        });
        return sub;
    };

    // Settings → System → Testing: four rows, none of them opens
    // anything yet.
    McuUiV002DemoScene.prototype._buildTesting = function(sm) {
        var self = this;
        var sub = new SubMenuScene(sm, 'Testing',
            ['LEDs', 'Keypad Test', 'Touchpad Test', 'Haptic Test'], {});
        sub.setBreadcrumbTrail(['Settings', 'System', 'Testing']);
        sub.setHeaderRenderer(function(canvas) { self._drawSettingsHeader(canvas); });
        sub.setIgnoreRun(true);
        liftLabels(sub);
        return sub;
    };

    // Settings → System → CPU Recovery: On-Device Recovery (the
    // "Launching Installer..." screen) and Maskrom (a confirmation modal).
    McuUiV002DemoScene.prototype._buildCpuRecovery = function(sm) {
        var self = this;
        var sub = new SubMenuScene(sm, 'CPU Recovery', ['On-Device Recovery', 'Maskrom'], {
            'On-Device Recovery': function() { return launchingScene(); },
            // A modal in place (the factory returns null: no push).
            'Maskrom': function(s) { s.showModal(maskromDialog(s)); repaint(); return null; }
        });
        sub.setBreadcrumbTrail(['Settings', 'System', 'CPU Recovery']);
        sub.setHeaderRenderer(function(canvas) { self._drawSettingsHeader(canvas); });
        sub.setIgnoreRun(true);
        liftLabels(sub);
        return sub;
    };

    // Confirmation modal (Maskrom, MCU Firmware Update), from the design:
    // a white wash over the page, a rounded window with a gray header
    // (the title, Born2bSporty), the text centred under it — `bold` lines
    // in Helvb08, then `regular` lines in Haxrcorp, both wrapped, one
    // CONFIRM.pitch apart — and Cancel / Continue. Left / right pick (the
    // picked one is bold in a selector frame); OK on Cancel or back
    // closes, OK on Continue closes and calls cfg.onContinue(sub).
    // The window fits its text: the buttons sit BTN_GAP under the last
    // line and the frame PAD_BOTTOM under them; the window is centred,
    // CONFIRM.lift px up (four lines give the design's 183×106 at y 17).
    var CONFIRM = {
        x: 37, w: 183, band: 20, radius: 4, lift: 2,
        titleX: 5, titleY: 2,                    // Born2bSporty, in the window
        textY: 28, pitch: 11,                    // draw y of the first line, in the window
        textW: 171,                              // wrap width
        btnGap: 11,                              // last line's slot → selector top
        btnH: 16, btnW: 72, padBottom: 7,
        cancelCX: 48, continueCX: 125            // button centres, in the window
    };
    // Word-wraps to maxW; a '\n' in the text forces a break.
    function wrapFont(font, text, maxW) {
        if (!text) return [];
        var lines = [];
        text.split('\n').forEach(function(para) {
            var words = para.split(' '), cur = '';
            for (var i = 0; i < words.length; i++) {
                var t = cur ? cur + ' ' + words[i] : words[i];
                if (cur && font.textWidth(t) > maxW) { lines.push(cur); cur = words[i]; }
                else cur = t;
            }
            if (cur) lines.push(cur);
        });
        return lines;
    }
    // The header band of a framed window: on each of its rows, gray from
    // just inside the frame's left edge to just inside its right one, so
    // it follows the rounded corners whatever their radius.
    function fillBand(ctx, x, y, w, band) {
        var data = ctx.getImageData(x, y + 1, w, band).data;
        ctx.fillStyle = COL_HELP_BAND;
        for (var r = 0; r < band; r++) {
            var left = -1, right = -1;
            for (var c = 0; c < w; c++) {
                if (data[(r * w + c) * 4] < 128) { if (left < 0) left = c; right = c; }
            }
            if (left >= 0 && right > left + 1) ctx.fillRect(x + left + 1, y + 1 + r, right - left - 1, 1);
        }
    }
    function confirmDialog(sub, cfg) {
        var m = CONFIRM, sel = 0;                // 0 Cancel, 1 Continue
        var B = Helvb08Regular, R = HaxrCorp4090FlipCTL;
        var lines = wrapFont(B, cfg.bold, m.textW).map(function(t) { return { f: B, t: t }; })
            .concat(wrapFont(R, cfg.regular, m.textW).map(function(t) { return { f: R, t: t }; }));
        function centred(ctx, font, text, cx, y) {
            font.draw(ctx, text, cx - Math.floor(font.textWidth(text) / 2), y, '#000');
        }
        var btnY = m.textY + lines.length * m.pitch + m.btnGap;
        var h = btnY + m.btnH + m.padBottom;
        return {
            render: function(canvas) {
                var ctx = canvas.ctx, x = m.x, y = Math.floor((canvas.h - h) / 2) - m.lift;
                ctx.fillStyle = HELP_WASH;
                ctx.fillRect(0, 0, canvas.w, canvas.h);
                new ResponsiveFrame({
                    x: x, y: y, width: m.w, height: h,
                    anchorH: 'left', anchorV: 'top',
                    showStroke: true, strokeColor: COL_WINDOW_LINE,
                    showFill: true, fillColor: '#fff',
                    cornerRadius: m.radius,
                    corners: { tl: true, tr: true, bl: true, br: true }
                }).render(canvas);
                fillBand(ctx, x, y, m.w, m.band);
                Born2bSportyV2FlipCTL.draw(ctx, cfg.title, x + m.titleX, y + m.titleY, '#000');
                var cx = x + Math.floor(m.w / 2);
                for (var i = 0; i < lines.length; i++) {
                    centred(ctx, lines[i].f, lines[i].t, cx, y + m.textY + i * m.pitch);
                }
                var labels = ['Cancel', 'Continue'], cxs = [m.cancelCX, m.continueCX];
                for (var b = 0; b < 2; b++) {
                    var bx = x + cxs[b];
                    if (b === sel) {
                        new MenuSelectorFrame({
                            x: bx - Math.floor(m.btnW / 2), y: y + btnY,
                            width: m.btnW, height: m.btnH,
                            anchorH: 'left', anchorV: 'top',
                            strokeColor: '#000', showStroke: true, showFill: false
                        }).render(canvas);
                        centred(ctx, B, labels[b], bx, y + btnY + 3);
                    } else {
                        centred(ctx, R, labels[b], bx, y + btnY + 3);
                    }
                }
            },
            handleInput: function(action) {
                // Two buttons, wrapping around: left and right both flip.
                if (action === 'left' || action === 'right') { sel = 1 - sel; repaint(); return; }
                if (action === 'ok' && sel === 1) {
                    sub.closeModal();
                    if (cfg.onContinue) cfg.onContinue(sub);
                    return;
                }
                if (action === 'ok' || action === 'back' || action === 'esc') {
                    sub.closeModal();
                }
            }
        };
    }

    // Maskrom: Continue opens the maskrom screen (a mock: the device
    // doesn't actually reboot into maskrom).
    function maskromDialog(sub) {
        return confirmDialog(sub, {
            title: 'Maskrom',
            bold: 'Maskrom mode may\nerase all your user data',
            regular: 'Use RkDevTool for next steps',
            onContinue: function(s) { if (s.sceneManager) s.sceneManager.push(maskromScene()); }
        });
    }

    // MCU Firmware Update: Continue blanks the backlight and leaves a
    // plain white screen (the MCU would now be a UF2 drive). Any key
    // wakes the backlight on the MCU side; Back leaves and turns it on.
    function mcuFirmwareDialog(sub) {
        return confirmDialog(sub, {
            title: 'MCU Firmware Update',
            regular: 'Upload .UF2 firmware to FlipperOneMCU mass storage device through USB-C1',
            onContinue: function(s) { if (s.sceneManager) s.sceneManager.push(blankScene()); }
        });
    }
    function postBacklight(body) {
        try {
            fetch('/api/backlight', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).catch(function() { /* no MCU (desktop preview) */ });
        } catch (e) { /* ignore */ }
    }
    function blankScene() {
        return {
            breadcrumbTitle: 'MCU Firmware Update',
            enter: function() { postBacklight({ action: 'off' }); repaint(); },
            exit: function() { postBacklight({ action: 'on' }); },
            handleInput: function(action) {
                if (action === 'back' || action === 'esc') return 'pop';
            },
            render: function(canvas) { canvas.clear('#fff'); }
        };
    }

    // On-Device Recovery: a plain white screen (no status bar) with
    // "Launching Installer" centred and its three dots filling in one by
    // one, then starting over. The text doesn't move as the dots change.
    var LAUNCHING = { text: 'Launching Installer', dotMs: 400 };
    function launchingScene() {
        var startedAt = 0, timer = null;
        return {
            breadcrumbTitle: 'On-Device Recovery',
            enter: function() {
                startedAt = Date.now();
                if (timer) clearInterval(timer);
                timer = setInterval(repaint, LAUNCHING.dotMs);
                repaint();
            },
            exit: function() {
                if (timer) { clearInterval(timer); timer = null; }
            },
            handleInput: function(action) {
                if (action === 'back' || action === 'esc') return 'pop';
            },
            render: function(canvas) {
                var F = Born2bSportyV2FlipCTL;
                canvas.clear('#fff');
                var dots = Math.floor((Date.now() - startedAt) / LAUNCHING.dotMs) % 4;
                var x = Math.floor((canvas.w - F.textWidth(LAUNCHING.text + '...')) / 2);
                var y = Math.floor((canvas.h - 16) / 2);   // Born2bSporty caps rows y+3..y+12
                F.draw(canvas.ctx, LAUNCHING.text + '...'.slice(0, dots), x, y, '#000');
            }
        };
    }

    // After Continue: a plain white screen (no status bar) with the
    // maskrom_usb_icon in the top-right corner and "Maskrom mode" to its
    // left. Back returns to CPU Recovery.
    var MASKROM_ICON = { right: 251, y: 4, gap: 4, text: 'Maskrom mode' };  // icon's last column, top row
    function maskromScene() {
        return {
            breadcrumbTitle: 'Maskrom',
            enter: function() { repaint(); },
            exit: function() {},
            handleInput: function(action) {
                if (action === 'back' || action === 'esc') return 'pop';
            },
            render: function(canvas) {
                canvas.clear('#fff');
                var m = MASKROM_ICON, icon = Icons.maskrom_usb_icon, H = HaxrCorp4090FlipCTL;
                var ix = m.right + 1 - icon.w;
                canvas.drawSprite(icon, ix, m.y, '#000');
                // Haxrcorp caps (rows y+2..y+8) level with the 7 px icon.
                H.draw(canvas.ctx, m.text, ix - m.gap - H.textWidth(m.text), m.y - 2, '#000');
            }
        };
    }

    // Boot screen art and text (see bootScene): SELF_CHECK.src is the
    // background (logo, serial, firmware), the title is drawn in code;
    // the Self Check list types in line by line in about a second.
    var SELF_CHECK = {
        src: 'assets/MCU_UI/flipper_star_no_text.png',
        // Title: Born2bSporty, white, ink x 9.., caps rows 12..21.
        titleX: 9, titleY: 9, selfTitle: 'Self Check', startTitle: 'Starting CPU',
        dotMs: 400,                              // Starting CPU: one more dot each step, then none
        x: 9, y: 30, pitch: 10,                  // Haxrcorp draw position of line 1 (ink rows 32..38)
        lineMs: 125,                             // line i shows at (i + 1) × lineMs
        lines: ['Current meter: ok', 'Expander control: ok', 'Expander main: ok',
                'Haptic: ok', 'Power Delivery: ok', 'Charger: ok', 'Gauge: ok',
                'Touchpad: ok']
    };
    // The boot screen in two flavours, on the same background (logo,
    // serial, firmware; no title), both with the check list typed in
    // line by line under the title:
    //   'self'  — Settings → System → Self Check: "Self Check";
    //   'start' — Start in the Power Menu: "Starting CPU" with its three
    //             dots filling in one by one, over and over.
    // Back returns.
    function bootScene(mode) {
        var img = null, startedAt = 0, timer = null, S = SELF_CHECK;
        var isSelf = mode === 'self';
        return {
            breadcrumbTitle: isSelf ? 'Self Check' : 'Starting CPU',
            enter: function() {
                startedAt = Date.now();
                var im = new Image();
                im.onload = function() { img = im; repaint(); };
                im.src = S.src + '?v=' + startedAt;
                if (timer) clearInterval(timer);
                timer = setInterval(function() {
                    repaint();
                    // Self Check is still once the list is typed; Starting
                    // CPU's dots go on.
                    if (isSelf && Date.now() - startedAt > (S.lines.length + 1) * S.lineMs) {
                        clearInterval(timer);
                        timer = null;
                    }
                }, FRAME_MS);
                repaint();
            },
            exit: function() {
                if (timer) { clearInterval(timer); timer = null; }
            },
            handleInput: function(action) {
                if (action === 'back' || action === 'esc') return 'pop';
            },
            render: function(canvas) {
                var ctx = canvas.ctx, t = Date.now() - startedAt;
                canvas.clear('#000');
                if (img && img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0);
                var title = isSelf ? S.selfTitle
                    : S.startTitle + '...'.slice(0, Math.floor(t / S.dotMs) % 4);
                Born2bSportyV2FlipCTL.draw(ctx, title, S.titleX, S.titleY, '#fff');
                var n = Math.min(S.lines.length, Math.floor(t / S.lineMs));
                for (var i = 0; i < n; i++) {
                    HaxrCorp4090FlipCTL.draw(ctx, S.lines[i], S.x, S.y + i * S.pitch, '#fff');
                }
            }
        };
    }

    // Settings → About: pages flipped with left / right (ABOUT.pages),
    // under the settings header, a "> Settings > About" breadcrumb and
    // "Page N/4" at the bottom. Half-oval tabs on the screen edges show
    // there's a page that way and flash inverted on a press. Page 1 is
    // the device card over its QR art; pages 2..4 are compliance art.
    var ABOUT = {
        pages: 4,
        crumb: '> Settings > About', crumbX: 4, crumbY: 11,     // Haxrcorp
        col: '#696969',                                          // crumb, labels, page number
        titleX: 24, titleY: 27,                                  // "Flipper One", Born2bSporty
        hwX: 95, hwY: 31,                                        // hardware rev next to it
        labelX: 24, valueX: 52, nameY: 45, serialY: 57,
        textX: 24, textY: 80, textPitch: 11,
        pageY: 127,                                              // "Page 1/4", centred
        tabY: 53,                                                // tab bitmap top row
        name: 'O3flis3g', serial: 'XXXXXXXXXXXXXXXX', hw: 'F1B2C2',
        text: ['For all compliance', 'certificates, please visit:', 'www.flip.dev/compliance'],
        // Page 2 text over its art: the address and the FCC / IC ids.
        address: ['Flipper Devices Inc. Suite B #551, 2803',
                  'Philadelphia Pike, Claymont DE, USA 19703'],
        addressX: 24, addressY: 36, addressPitch: 11,
        ids: [['FCC ID:', 23, 'XXXXX-XX', 57], ['IC:', 114, 'XXXXX-XX', 128]],  // label, x, value, x
        idsY: 63,
        // Page art from the design (full 256×144, white background), one
        // per page, drawn as is; only page 1 gets the device card text.
        art: {
            0: 'assets/MCU_UI/About/mcu_mode_about_device_1.png',   // QR code
            1: 'assets/MCU_UI/About/mcu_mode_about_device_3.png',   // EAC, CE, FCC, UKCA, WEEE, RCM
            2: 'assets/MCU_UI/About/mcu_mode_about_device_4.png',   // TELEC, CMIIT, made in China
            3: 'assets/MCU_UI/About/mcu_mode_about_device_5.png'    // NCC, NOM, NYCE
        }
    };
    // Page tabs ('#' outline, 't' arrow, 'w' inside), from the design.
    // The left one isn't an exact mirror: its arrow sits 1 px lower.
    var ABOUT_TAB_LEFT = [
        '##        ',
        'ww##      ',
        'wwww##    ',
        'wwwwww##  ',
        'wwwwwwww# ',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwtwww#',
        'wwwwttwww#',
        'wwwtttwww#',
        'wwttttwww#',
        'wtttttwww#',
        'wwttttwww#',
        'wwwtttwww#',
        'wwwwttwww#',
        'wwwwwtwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwwww#',
        'wwwwwwww# ',
        'wwwwww##  ',
        'wwww##    ',
        'ww##      ',
        '##        '
    ];
    var ABOUT_TAB = [
            '        ##',
            '      ##ww',
            '    ##wwww',
            '  ##wwwwww',
            ' #wwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwtwwwww',
            '#wwwttwwww',
            '#wwwtttwww',
            '#wwwttttww',
            '#wwwtttttw',
            '#wwwttttww',
            '#wwwtttwww',
            '#wwwttwwww',
            '#wwwtwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            '#wwwwwwwww',
            ' #wwwwwwww',
            '  ##wwwwww',
            '    ##wwww',
            '      ##ww',
            '        ##'
    ];
    McuUiV002DemoScene.prototype._buildAbout = function() {
        var self = this, a = ABOUT, page = 0, pressed = null, pressTimer = null, art = {};
        function drawTab(ctx, right, down) {
            var map = right ? ABOUT_TAB : ABOUT_TAB_LEFT;
            var w = map[0].length;
            var col = down
                ? { '#': '#000', w: '#000', t: '#fff' }
                : { '#': '#000', w: '#fff', t: '#000' };
            drawMap(ctx, map, right ? 256 - w : 0, a.tabY, col);
        }
        function flip(dir) {
            var next = page + (dir === 'right' ? 1 : -1);
            if (next < 0 || next >= a.pages) return;
            page = next;
            pressed = dir;
            if (pressTimer) clearTimeout(pressTimer);
            pressTimer = setTimeout(function() { pressed = null; pressTimer = null; repaint(); }, PRESS_MS);
            repaint();
        }
        return {
            breadcrumbTitle: 'About',
            enter: function() {
                // Re-fetched on every visit (cache-busted), so art swapped
                // on disk shows up without reloading the page.
                var v = Date.now();
                Object.keys(a.art).forEach(function(k) {
                    var im = new Image();
                    im.onload = function() { art[k] = im; repaint(); };
                    im.src = a.art[k] + '?v=' + v;
                });
                repaint();
            },
            exit: function() {
                if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
                pressed = null;
            },
            handleInput: function(action) {
                if (action === 'back' || action === 'esc') return 'pop';
                if (action === 'left' || action === 'right') flip(action);
            },
            render: function(canvas) {
                var ctx = canvas.ctx, H = HaxrCorp4090FlipCTL;
                canvas.clear('#fff');
                if (art[page]) ctx.drawImage(art[page], 0, 0);
                self._drawSettingsHeader(canvas);
                H.draw(ctx, a.crumb, a.crumbX, a.crumbY, a.col);
                if (page === 0) {
                    Born2bSportyV2FlipCTL.draw(ctx, 'Flipper One', a.titleX, a.titleY, '#000');
                    H.draw(ctx, a.hw, a.hwX, a.hwY, '#000');
                    H.draw(ctx, 'Name:', a.labelX, a.nameY, a.col);
                    H.draw(ctx, a.name, a.valueX, a.nameY, '#000');
                    H.draw(ctx, 'Serial:', a.labelX, a.serialY, a.col);
                    H.draw(ctx, a.serial, a.valueX, a.serialY, '#000');
                    for (var i = 0; i < a.text.length; i++) {
                        H.draw(ctx, a.text[i], a.textX, a.textY + i * a.textPitch, '#000');
                    }
                } else if (page === 1) {
                    for (var j = 0; j < a.address.length; j++) {
                        H.draw(ctx, a.address[j], a.addressX, a.addressY + j * a.addressPitch, '#000');
                    }
                    a.ids.forEach(function(id) {
                        H.draw(ctx, id[0], id[1], a.idsY, a.col);
                        H.draw(ctx, id[2], id[3], a.idsY, '#000');
                    });
                }
                var pg = 'Page ' + (page + 1) + '/' + a.pages;
                H.draw(ctx, pg, Math.floor((canvas.w - H.textWidth(pg)) / 2), a.pageY, a.col);
                // A press may have just reached the last page: keep its
                // tab on screen for the flash.
                if (page > 0 || pressed === 'left') drawTab(ctx, false, pressed === 'left');
                if (page < a.pages - 1 || pressed === 'right') drawTab(ctx, true, pressed === 'right');
            }
        };
    };

    // Rows that open a page or screen get, while selected, a light strip
    // inside the selector frame's right edge with a small ▶ (from the
    // design): 5 px wide, filling every inner row of the frame down to its
    // bottom edge (cut by the rounded corners), the arrow 3×5 on rows
    // 8..12. Right on such a row works as OK.
    var COL_DRILL_STRIP = '#D9D9D9';
    var DRILL_ARROW = ['#..', '##.', '###', '##.', '#..'];
    function markDrill(sub, names) {
        for (var i = 0; i < sub.items.length; i++) {
            if (names.indexOf(sub.items[i].text) >= 0) sub.items[i].drill = true;
        }
        var baseRender = sub.render, baseInput = sub.handleInput;
        sub.render = function(canvas) {
            baseRender.call(this, canvas);
            var item = this.items[this.selectedIndex], f = this.selectorFrame;
            if (!item || !item.drill || this._modal || item.state === MenuLine.STATE_PRESSED) return;
            // Strip flush with the frame's right edge: on each row, from sx
            // up to the frame line, wherever the row is inside the frame.
            var ctx = canvas.ctx, sx = f.x + f.width - 6, y = f.y, right = f.x + f.width;
            var data = ctx.getImageData(sx, y, right - sx, f.height).data, w = right - sx;
            ctx.fillStyle = COL_DRILL_STRIP;
            for (var r = 1; r < f.height; r++) {
                if (data[(r * w) * 4] < 128) continue;            // at or past the bottom line
                var c = 0;
                while (c < w && data[(r * w + c) * 4] >= 128) c++;
                if (c > 0 && c < w) ctx.fillRect(sx, y + r, c, 1);
            }
            drawMap(ctx, DRILL_ARROW, sx + 1, y + 8, { '#': '#000' });
        };
        sub.handleInput = function(action) {
            var item = this.items[this.selectedIndex];
            if (action === 'right' && !this._modal && item && item.drill) action = 'ok';
            return baseInput.call(this, action);
        };
    }

    // Every menu of this app draws its row labels (and values)
    // MENU_LABEL_DY px off the stock MenuLine position.
    var MENU_LABEL_DY = -1;
    function liftLabels(sub) {
        for (var i = 0; i < sub.items.length; i++) sub.items[i].labelYOffset = MENU_LABEL_DY;
    }

    // Settings → System page: Self Check, CPU Recovery, MCU Firmware
    // Update (a confirmation modal) and Testing.
    McuUiV002DemoScene.prototype._buildSystemSettings = function(sm) {
        var self = this;
        var sub = new SubMenuScene(sm, 'System',
            ['Self Check', 'CPU Recovery', 'MCU Firmware Update', 'Testing'], {
                'Self Check': function() { return bootScene('self'); },
                'CPU Recovery': function() { return self._buildCpuRecovery(sm); },
                // A modal in place (the factory returns null: no push).
                'MCU Firmware Update': function(s) { s.showModal(mcuFirmwareDialog(s)); repaint(); return null; },
                'Testing': function() { return self._buildTesting(sm); }
            });
        sub.setBreadcrumbTrail(['Settings', 'System']);
        sub.setHeaderRenderer(function(canvas) { self._drawSettingsHeader(canvas); });
        sub.setIgnoreRun(true);
        liftLabels(sub);
        markDrill(sub, ['Self Check', 'CPU Recovery', 'Testing']);
        return sub;
    };

    // Help for a settings page: `topic()` gives { title, text, seen? }
    // for the current selection, or null (no Help button). The button
    // blinks until that topic has been opened once — topics sharing a
    // `seen` key count as one (default: the title) — and stays toggled
    // on, drawn above the wash, while the window is open.
    McuUiV002DemoScene.prototype._attachHelp = function(sub, topic) {
        var self = this;
        var btn = new UI.MiddleIconToggleButton(Icons.in_button_help, 0, HELP_BTN.w, 0, 'edit');
        btn.iconDy = HELP_BTN.iconDy;
        btn.x = HELP_BTN.x;
        var baseRender = sub.render, baseInput = sub.handleInput;
        var baseEnter = sub.enter, baseExit = sub.exit, blinkTimer = null;
        sub.render = function(canvas) {
            var open = !!this._modal, t = open ? null : topic();
            btn.toggled = open;
            btn.pressed = !!t && !self._helpSeen[t.seen || t.title]
                && Math.floor(Date.now() / HELP_BLINK_MS) % 2 === 1;
            this.setAppButton(open || t ? btn : null);
            baseRender.call(this, canvas);
        };
        sub.handleInput = function(action) {
            var t = action === 'edit' && !this._modal ? topic() : null;
            if (t) {
                self._helpSeen[t.seen || t.title] = true;
                this.showModal(helpWindow(this, btn, t));
                repaint();
                return;
            }
            return baseInput.call(this, action);
        };
        sub.enter = function() {
            if (baseEnter) baseEnter.call(this);
            if (!blinkTimer) blinkTimer = setInterval(repaint, HELP_BLINK_MS / 2);
        };
        sub.exit = function() {
            if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
            if (baseExit) baseExit.call(this);
        };
    };

    // Help window over a submenu (its modal): a white wash over the
    // page, the window centred on it, and the Help button (`btn`) drawn
    // again above the wash, toggled on. Back / esc / ok / X close it.
    function wrapLines(text, maxW) {
        var words = text.split(' '), lines = [], cur = '';
        for (var i = 0; i < words.length; i++) {
            var t = cur ? cur + ' ' + words[i] : words[i];
            if (cur && HaxrCorp4090FlipCTL.textWidth(t) > maxW) { lines.push(cur); cur = words[i]; }
            else cur = t;
        }
        if (cur) lines.push(cur);
        return lines;
    }
    // A 6-bit grayscale icon drawn in pure black and white, with its
    // white (incl. the format's transparent 63) kept white wherever it
    // lies between inked pixels of the same row — the "?" inside the
    // help_question disc.
    function drawBadge(ctx, icon, x, y) {
        var px = [], i = 0;
        for (var r = 0; r < icon.h; r++) {
            var row = [];
            for (var c = 0; c < icon.w; c += 4) {
                var b0 = icon.d[i] || 0, b1 = icon.d[i + 1] || 0, b2 = icon.d[i + 2] || 0;
                i += 3;
                row.push((b0 >> 2) & 0x3F, ((b0 & 0x03) << 4) | (b1 >> 4),
                         ((b1 & 0x0F) << 2) | (b2 >> 6), b2 & 0x3F);
            }
            px.push(row.slice(0, icon.w));
        }
        for (r = 0; r < icon.h; r++) {
            var first = -1, last = -1;
            for (var c2 = 0; c2 < icon.w; c2++) {
                if (px[r][c2] < 63) { if (first < 0) first = c2; last = c2; }
            }
            for (c2 = 0; c2 < icon.w; c2++) {
                var g = px[r][c2];
                if (g >= 63 && !(c2 > first && c2 < last)) continue;
                // The icon's soft edges (levels 8 / 55) are pure black /
                // white in the design: threshold at mid-gray.
                var v = g < 32 ? 0 : 255;
                ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
                ctx.fillRect(x + c2, y + r, 1, 1);
            }
        }
    }

    function helpWindow(sub, btn, help) {
        var w = HELP_WIN, H = HaxrCorp4090FlipCTL;
        var lines = wrapLines(help.text, w.w - 2 * HELP_BODY_X);
        var h = w.h + Math.max(0, lines.length - 2) * HELP_BODY_PITCH;
        return {
            render: function(canvas) {
                var ctx = canvas.ctx;
                var x = Math.floor((canvas.w - w.w) / 2), y = Math.floor((canvas.h - h) / 2);
                ctx.fillStyle = HELP_WASH;
                ctx.fillRect(0, 0, canvas.w, canvas.h);
                new ResponsiveFrame({
                    x: x, y: y, width: w.w, height: h,
                    anchorH: 'left', anchorV: 'top',
                    showStroke: true, strokeColor: COL_WINDOW_LINE,
                    showFill: true, fillColor: '#fff',
                    cornerRadius: w.radius,
                    corners: { tl: true, tr: true, bl: true, br: true }
                }).render(canvas);
                fillBand(ctx, x, y, w.w, w.band);
                drawBadge(ctx, Icons.help_question, x + HELP_ICON_X, y + HELP_ICON_Y);
                H.draw(ctx, help.title, x + HELP_TITLE_X, y + HELP_TITLE_Y, '#000');
                for (var i = 0; i < lines.length; i++) {
                    H.draw(ctx, lines[i], x + HELP_BODY_X, y + HELP_BODY_Y + i * HELP_BODY_PITCH, '#000');
                }
                if (btn) btn.render(canvas);
            },
            handleInput: function(action) {
                if (action === 'back' || action === 'esc' || action === 'ok' || action === 'edit') {
                    sub.closeModal();
                }
            }
        };
    }

    // Settings → Display page.
    McuUiV002DemoScene.prototype._buildDisplaySettings = function(sm) {
        var self = this;
        var sub = new SubMenuScene(sm, 'Display', ['Backlight Brightness', 'Backlight OFF'], {});
        sub.setBreadcrumbTrail(['Settings', 'Display']);
        sub.setHeaderRenderer(function(canvas) { self._drawSettingsHeader(canvas); });
        sub.setIgnoreRun(true);
        liftLabels(sub);

        var levelIdx = BL_DEFAULT_LEVEL, timeoutIdx = BL_DEFAULT_TIMEOUT;
        var levelTimer = null, timeoutTimer = null, failsafeTimer = null;
        var queue = Promise.resolve();
        // One /api/backlight call at a time, in order (an 'on' must not
        // overtake the level write before it).
        function send(body) {
            queue = queue.then(function() {
                return fetch('/api/backlight', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                }).catch(function() { /* no MCU (desktop preview) */ });
            });
        }
        function writeLevel() {
            var pct = BL_LEVELS[levelIdx];
            if (failsafeTimer) { clearTimeout(failsafeTimer); failsafeTimer = null; }
            if (pct === 0) {
                send({ action: 'off' });
                failsafeTimer = setTimeout(function() {
                    failsafeTimer = null;
                    send({ action: 'on' });
                }, BL_OFF_FAILSAFE_MS);
                return;
            }
            send({ level: Math.max(1, Math.round(pct * 255 / 100)) });
            send({ action: 'on' });
        }
        function nearest(list, value, key) {
            var best = 0;
            for (var i = 1; i < list.length; i++) {
                if (Math.abs(key(list[i]) - value) < Math.abs(key(list[best]) - value)) best = i;
            }
            return best;
        }
        // Start from what the MCU has now.
        fetch('/api/backlight', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d || !d.ok) return;
                levelIdx = 1 + nearest(BL_LEVELS.slice(1), d.level * 100 / 255, function(v) { return v; });
                timeoutIdx = nearest(BL_TIMEOUTS, d.timeout, function(t) { return t.ds === 0 ? 1e9 : t.ds; });
                if (d.timeout === 0) timeoutIdx = BL_TIMEOUTS.length - 1;
                repaint();
            })
            .catch(function() { /* keep the defaults */ });

        function stepper(item, text, get, set, count, onChange) {
            item.statusProvider = function() { return '< ' + text() + ' >'; };
            item.atStart = function() { return get() <= 0; };
            item.atEnd = function() { return get() >= count - 1; };
            item.onAdjust = function(dir) {
                var i = Math.max(0, Math.min(count - 1, get() + (dir === 'right' ? 1 : -1)));
                if (i === get()) return;
                set(i);
                onChange();
            };
        }
        this._attachHelp(sub, function() {
            if (sub.selectedIndex !== 1 || BL_TIMEOUTS[timeoutIdx].ds !== 0) return null;
            return { title: 'Backlight OFF',
                     text: 'Energy usage will be higher if the Backlight never turns OFF' };
        });

        stepper(sub.items[0],
            function() { var v = BL_LEVELS[levelIdx]; return v === 0 ? 'OFF' : v + '%'; },
            function() { return levelIdx; }, function(i) { levelIdx = i; }, BL_LEVELS.length,
            function() {
                if (levelTimer) clearTimeout(levelTimer);
                levelTimer = setTimeout(function() { levelTimer = null; writeLevel(); }, BL_WRITE_MS);
            });
        stepper(sub.items[1],
            function() { return BL_TIMEOUTS[timeoutIdx].label; },
            function() { return timeoutIdx; }, function(i) { timeoutIdx = i; }, BL_TIMEOUTS.length,
            function() {
                if (timeoutTimer) clearTimeout(timeoutTimer);
                timeoutTimer = setTimeout(function() {
                    timeoutTimer = null;
                    send({ timeout: BL_TIMEOUTS[timeoutIdx].ds });
                }, BL_WRITE_MS);
            });
        return sub;
    };

    // ── USB-C1 cable ─────────────────────────────────────────────

    function getJson(url, done) {
        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(d) { done(d); })
            .catch(function() { done(null); });
    }

    // Ids present now (see USB_POLL_MS), or null on a failed request.
    function readUsbIds(d) {
        if (!d || !d.ok) return null;
        var ids = [], i;
        var typec = d.typec || [], drm = d.drm || [];
        for (i = 0; i < typec.length; i++) {
            if (TYPEC_PORT && typec[i].port !== TYPEC_PORT) continue;
            if (typec[i].partner) ids.push('typec:' + typec[i].port);
        }
        for (i = 0; i < drm.length; i++) {
            if (drm[i].status === 'connected') ids.push('drm:' + drm[i].connector);
        }
        var udc = d.udc || [], power = d.power || [];
        for (i = 0; i < udc.length; i++) {
            if (udc[i].state && udc[i].state !== 'not attached') ids.push('udc:' + udc[i].name);
        }
        for (i = 0; i < power.length; i++) {
            if (power[i].online) ids.push('psu:' + power[i].name);
        }
        return ids;
    }

    // Plug / unplug edges set sim.plugged (in between, the Test menu's
    // "USB-C1 cable" toggle can override it).
    McuUiV002DemoScene.prototype._onUsbIds = function(ids) {
        var present = {}, i;
        for (i = 0; i < ids.length; i++) present[ids[i]] = true;
        if (this._usbBaseline === null) { this._usbBaseline = present; return; }
        for (var id in this._usbBaseline) {
            if (!present[id]) delete this._usbBaseline[id];
        }
        var fresh = false;
        for (var p in present) {
            if (!this._usbBaseline[p]) { fresh = true; break; }
        }
        if (fresh !== this._usbFresh) {
            this._usbFresh = fresh;
            this._sim.plugged = fresh;
            repaint();
        }
    };

    // ── Scene ────────────────────────────────────────────────────

    McuUiV002DemoScene.prototype.enter = function() {
        var self = this;
        if (this._inMenu) {
            this._inMenu = false;                // back from Test / Settings: keep going
        } else {
            this._startedAt = Date.now();
            this._autoOffAt = this._startedAt;
            this._wasActive = false;
            this._ledSent = null;
            this._dolphinLeft = null;
            this._usbBaseline = null;
            this._usbFresh = false;
            this._powerMenu = null;
            setNetLedsOff();
            this._hookPowerKey();
            // Re-fetched on every visit (cache-busted), so a sheet swapped
            // on disk shows up without reloading the page.
            var img = new Image();
            img.onload = function() { self._dolphinImg = img; repaint(); };
            img.src = DOLPHIN.src + '?v=' + Date.now();
        }
        if (this._timer) clearInterval(this._timer);
        var lastTick = -1, lastSec = -1;
        this._timer = setInterval(function() {
            // Every frame while the plates slide or the dolphin moves,
            // else on each dolphin frame and each countdown second.
            var now = Date.now();
            var tick = Math.floor((now - self._startedAt) / DOLPHIN.frameMs);
            var sec = Math.floor((now - self._autoOffAt) / 1000);
            if (now - self._activeAt < SLIDE_MS + FRAME_MS
                    || now - self._dolphinMoveAt < DOLPHIN.moveMs + FRAME_MS
                    || tick !== lastTick || sec !== lastSec) {
                lastTick = tick;
                lastSec = sec;
                repaint();
            }
        }, FRAME_MS);
        if (!this._ledTimer) {
            this._ledTimer = setInterval(function() { self._ledTick(); }, LED_TICK_MS);
            this._ledTick();
        }
        if (!this._powerKeyTimer) {
            this._powerKeyTimer = setInterval(function() { postPowerKey(true); }, POWER_KEY_RENEW_MS);
            postPowerKey(true);
        }
        if (!this._usbTimer) {
            var poll = function() {
                getJson('/api/usbc', function(d) {
                    if (!self._usbTimer) return;
                    var ids = readUsbIds(d);
                    if (ids) self._onUsbIds(ids);
                });
            };
            this._usbTimer = setInterval(poll, USB_POLL_MS);
            poll();
        }
        repaint();
    };

    McuUiV002DemoScene.prototype.exit = function() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        if (this._pressTimer) { clearTimeout(this._pressTimer); this._pressTimer = null; }
        this._pressed = null;
        if (this._inMenu) return;                // LEDs and Power stay with the app
        this._helpTouchStop();
        if (this._ledTimer) { clearInterval(this._ledTimer); this._ledTimer = null; }
        if (this._usbTimer) { clearInterval(this._usbTimer); this._usbTimer = null; }
        if (this._powerKeyTimer) {
            clearInterval(this._powerKeyTimer);
            this._powerKeyTimer = null;
            postPowerKey(false);
        }
        if (this._sim.leds) this._ledsOff();
        releaseNetLeds();
        this._unhookPowerKey();
    };

    // Power anywhere in this app opens the Power Menu and Z (esc) goes to
    // the home screen: every scene pushed while the app is open (Settings
    // pages, Test, Self Check, …) gets those two actions redirected here.
    // The hook comes off when the app closes.
    McuUiV002DemoScene.prototype._hookPowerKey = function() {
        var self = this, sm = this.sceneManager;
        if (!sm || this._origPush) return;
        this._origPush = sm.push;
        sm.push = function(scene) {
            if (scene && scene !== self && !scene._mcuPowerHooked) {
                var orig = scene.handleInput;
                scene._mcuPowerHooked = true;
                scene.handleInput = function(action) {
                    if (action === 'power') { self._powerFromAnywhere(); return; }
                    if (action === 'esc') { self._goHome(); return; }
                    return orig ? orig.apply(this, arguments) : undefined;
                };
            }
            return self._origPush.apply(sm, arguments);
        };
    };
    McuUiV002DemoScene.prototype._unhookPowerKey = function() {
        if (this.sceneManager && this._origPush) this.sceneManager.push = this._origPush;
        this._origPush = null;
    };
    // Back to the home screen: each page closes as with Back, and any
    // menu / window on the home screen closes too.
    McuUiV002DemoScene.prototype._goHome = function() {
        var sm = this.sceneManager;
        while (sm && sm.current() !== this && sm._stack.length > 1) {
            this._inMenu = true;                 // keep the app running through the pops
            sm.pop();
        }
        this._helpWin = null;
        this._helpMenu = null;
        this._powerMenu = null;
        this._helpTouchStop();
        repaint();
    };
    // Home with the Power Menu open.
    McuUiV002DemoScene.prototype._powerFromAnywhere = function() {
        this._goHome();
        this._powerMenu = { sel: 0 };
        repaint();
    };

    McuUiV002DemoScene.prototype._flash = function(name, then) {
        var self = this;
        this._pressed = name;
        if (this._pressTimer) clearTimeout(this._pressTimer);
        this._pressTimer = setTimeout(function() {
            self._pressed = null;
            self._pressTimer = null;
            repaint();
            if (then) then();
        }, PRESS_MS);
        repaint();
    };

    McuUiV002DemoScene.prototype.handleInput = function(action) {
        var self = this;
        // Z (esc) on the home screen just closes what's open on it; Back
        // still leaves the app.
        if (action === 'esc') { this._goHome(); return; }
        // The Power Menu sits on top of everything (the Help menu / window
        // stay open under it): it gets the keys first; Back or Power
        // closes just it.
        if (this._powerMenu) {
            var pm = this._powerMenu;
            // Two rows, wrapping around: up and down both flip.
            if (action === 'up' || action === 'down') { pm.sel = 1 - pm.sel; repaint(); }
            else if (action === 'back' || action === 'power') {
                this._powerMenu = null; repaint();
            } else if (action === 'ok') {
                // Leaving for Start / Power OFF: the help underneath closes.
                this._powerMenu = null;
                this._helpWin = null;
                this._helpMenu = null;
                this._helpTouchStop();
                this._inMenu = true;
                this.sceneManager.push(pm.sel === 0 ? bootScene('start') : this._powerOffScene());
            }
            return;
        }
        if (action === 'power') {
            if (this.sceneManager) this._powerMenu = { sel: 0 };
            repaint();
            return;
        }
        if (this._helpWin) {
            var hw = this._helpWin, maxS = this._helpMaxScroll(hw.page);
            if (action === 'up') hw.scroll = Math.max(0, hw.scroll - HELP_WINDOW.line);
            else if (action === 'down') hw.scroll = Math.min(maxS, hw.scroll + HELP_WINDOW.line);
            else if (action === 'left' || action === 'right') {
                var np = hw.page + (action === 'right' ? 1 : -1);
                if (np >= 0 && np < HELP_PAGES.length) {
                    hw.page = np;
                    hw.scroll = 0;
                    hw.press = action;
                    if (hw.pressTimer) clearTimeout(hw.pressTimer);
                    hw.pressTimer = setTimeout(function() {
                        if (self._helpWin) self._helpWin.press = null;
                        repaint();
                    }, PRESS_MS);
                }
            } else if (action === 'back' || action === 'esc' || action === 'edit') {
                this._helpWin = null;            // back to the Help menu
                this._helpTouchStop();
            }
            repaint();
            return;
        }
        if (this._helpMenu) {
            var hm = this._helpMenu, n = HELP_MENU.items.length;
            // The list wraps around at both ends.
            if (action === 'up') { hm.sel = (hm.sel + n - 1) % n; repaint(); }
            else if (action === 'down') { hm.sel = (hm.sel + 1) % n; repaint(); }
            else if (action === 'back' || action === 'esc' || action === 'edit') {
                this._helpMenu = null; repaint();
            }
            else if (action === 'ok') {
                this._helpWin = { page: hm.sel, scroll: 0, press: null, pressTimer: null };
                this._helpTouchStart();
                repaint();
            }
            return;
        }
        if (action === 'back') return 'pop';
        if (action === 'edit') {
            this._helpMenu = { sel: 0 };
            repaint();
            return;
        }
        if (action === 'run') {
            this._flash('test', function() { self._openTest(); });
            return;
        }
        if (action === 'del') {
            this._flash('settings', function() { self._openSettings(); });
            return;
        }
        var name = KEY_TO_BUTTON[action];
        if (name) this._flash(name);
    };

    // ── Settings ─────────────────────────────────────────────────

    // Settings header: a white bar with only the battery on the right,
    // following the big battery's charge (and its charging bolt). Same
    // pixels as the stock status-bar battery (UI.drawBattery), with the
    // fake charge instead of the live one.
    McuUiV002DemoScene.prototype._drawSettingsHeader = function(canvas) {
        var sim = this._sim, d = derive(sim);
        var top = SETTINGS_BAT_TOP;
        var pct = Math.round(sim.charge);
        var pctStr = pct + '%';
        var sprite = StatusBarBattery.sprite;
        var bx = canvas.w - 2 - sprite.w;
        HaxrCorp4090FlipCTL.draw(canvas.ctx, pctStr,
            bx - 1 - HaxrCorp4090FlipCTL.textWidth(pctStr), top - 2, '#000');
        canvas.drawSprite(sprite, bx, top - 1, '#000');
        var barW = Math.round(10 * pct / 100);
        if (barW > 0) canvas.drawRect(bx + 2, top + 1, barW, 5, '#000');
        if (d.charging) canvas.drawSpriteLiteral(Icons.charging_status_bar, bx, top - 1);
    };

    McuUiV002DemoScene.prototype._openSettings = function() {
        var sm = this.sceneManager;
        if (!sm || typeof SubMenuScene === 'undefined' || sm.current() !== this) return;
        var self = this;
        var sub = new SubMenuScene(sm, 'Settings', SETTINGS_ROWS.map(function(r) { return r.text; }), {
            'Display': function() { return self._buildDisplaySettings(sm); },
            'Power': function() { return self._buildPowerSettings(sm); },
            'About': function() { return self._buildAbout(); },
            'System': function() { return self._buildSystemSettings(sm); }
        });
        sub.setBreadcrumbTrail(['Settings']);
        sub.setHeaderRenderer(function(canvas) { self._drawSettingsHeader(canvas); });
        sub.setIgnoreRun(true);
        liftLabels(sub);
        markDrill(sub, ['Display', 'Power', 'System', 'About']);
        for (var i = 0; i < sub.items.length; i++) sub.items[i].icon = Icons[SETTINGS_ROWS[i].icon];
        this._inMenu = true;
        sm.push(sub);
    };

    // ── Test menu ────────────────────────────────────────────────

    McuUiV002DemoScene.prototype._openTest = function() {
        var sm = this.sceneManager;
        if (!sm || typeof SubMenuScene === 'undefined' || sm.current() !== this) return;
        var sim = this._sim, self = this;
        var rows = ['USB-C1 cable', 'USB-C1', 'PD', 'USB-C1 power', 'Battery', 'Power usage', 'Error', 'MCU LEDs'];
        var sub = new SubMenuScene(sm, 'Test', rows, {});
        sub.setBreadcrumbTrail(['MCU UI - v002', 'Test']);
        sub.setIgnoreRun(true);
        liftLabels(sub);
        function toggle(item, get, set) {
            item.statusProvider = function() { return get() ? '< ON >' : '< OFF >'; };
            item.onToggle = function() { set(!get()); };
        }
        function stepper(item, text, onAdjust, atStart, atEnd) {
            item.statusProvider = function() { return '< ' + text() + ' >'; };
            item.onAdjust = onAdjust;
            item.atStart = atStart;
            item.atEnd = atEnd;
        }
        var limit = function() { return sim.pd ? MAX_W : PD_LIMIT_W; };
        for (var i = 0; i < sub.items.length; i++) {
            var item = sub.items[i];
            switch (item.text) {
            case 'USB-C1 cable':
                // Set by the cable detection; flip it here without one.
                toggle(item, function() { return sim.plugged; }, function(v) {
                    sim.plugged = v;
                    repaint();
                });
                break;
            case 'USB-C1':
                stepper(item, function() { return sim.dir.toUpperCase(); }, function() {
                    sim.dir = sim.dir === 'in' ? 'out' : 'in';
                    // IN has whole watts only.
                    if (sim.dir === 'in') sim.desiredW = Math.round(sim.desiredW);
                });
                break;
            case 'PD':
                toggle(item, function() { return sim.pd; }, function(v) { sim.pd = v; });
                break;
            case 'USB-C1 power':
                // The value shown is capped by the PD limit; the wanted
                // value comes back once PD is on again.
                stepper(item, function() { return fmtW(Math.min(sim.desiredW, limit())); },
                    function(dir) {
                        var cur = Math.min(sim.desiredW, limit());
                        var next = sim.dir === 'out'
                            ? stepValue(cur, dir, OUT_W_STEPS, limit())
                            : Math.max(0, Math.min(limit(), Math.round(cur) + (dir === 'right' ? 1 : -1)));
                        sim.desiredW = next;
                    },
                    function() { return Math.min(sim.desiredW, limit()) <= 0; },
                    function() { return Math.min(sim.desiredW, limit()) >= limit(); });
                break;
            case 'Battery':
                stepper(item, function() { return sim.charge + '%'; }, function(dir) {
                    sim.charge = Math.max(0, Math.min(100, sim.charge + (dir === 'right' ? 1 : -1)));
                },
                function() { return sim.charge <= 0; },
                function() { return sim.charge >= 100; });
                break;
            case 'Power usage':
                stepper(item, function() { return sim.usage.toFixed(2) + 'W'; }, function(dir) {
                    sim.usage = stepValue(sim.usage, dir, USAGE_STEPS, MAX_USAGE_W);
                },
                function() { return sim.usage <= 0; },
                function() { return sim.usage >= MAX_USAGE_W; });
                break;
            case 'Error':
                toggle(item, function() { return sim.error; }, function(v) { sim.error = v; });
                break;
            case 'MCU LEDs':
                // Off: the LEDs go dark and stay untouched.
                toggle(item, function() { return sim.leds; }, function(v) {
                    sim.leds = v;
                    if (v) self._ledSent = null; else self._ledsOff();
                });
                break;
            }
        }
        this._inMenu = true;
        sm.push(sub);
    };

    // ── Drawing ──────────────────────────────────────────────────

    // "in 1h 59m 58s" for the time left, never below zero.
    function timeLeftText(totalS, ms) {
        var s = Math.max(0, totalS - Math.floor(ms / 1000));
        var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
        return 'in ' + h + 'h ' + m + 'm ' + (s % 60) + 's';
    }

    // Rows of a char map; `colors` maps a char to a colour, others skip.
    function drawMap(ctx, rows, x, y, colors) {
        for (var r = 0; r < rows.length; r++) {
            for (var c = 0; c < rows[r].length; c++) {
                var col = colors[rows[r].charAt(c)];
                if (!col) continue;
                ctx.fillStyle = col;
                ctx.fillRect(x + c, y + r, 1, 1);
            }
        }
    }

    // A plate: rows 0..22, full to the right edge, its left edge
    // slanting right by a pixel every two rows (x = its top-left pixel).
    function drawPlate(ctx, x, color) {
        ctx.fillStyle = color;
        for (var r = 0; r < PLATE_H; r++) {
            var off = r === 0 ? 0 : r <= 20 ? Math.ceil(r / 2) : r === 21 ? 11 : 13;
            if (x + off < 256) ctx.fillRect(x + off, r, 256 - x - off, 1);
        }
    }

    // `inv`: on the black plate — light outline, white fill, digits
    // inverted. `digits`: false while charging (the spark shows instead).
    function drawBattery(canvas, pct, inv, digits) {
        var ctx = canvas.ctx;
        var b = BAT, f = FILL;
        if (inv) {
            drawMap(ctx, CELL_ROWS, b.x, b.y, CELL_COLORS);
        } else {
            // Outline, 2 px rounded corners.
            ctx.fillStyle = COL_OUTLINE;
            ctx.fillRect(b.x + 2, b.y, b.w - 4, 1);
            ctx.fillRect(b.x + 2, b.y + b.h - 1, b.w - 4, 1);
            ctx.fillRect(b.x + 1, b.y + 1, 1, 1);
            ctx.fillRect(b.x + b.w - 2, b.y + 1, 1, 1);
            ctx.fillRect(b.x + 1, b.y + b.h - 2, 1, 1);
            ctx.fillRect(b.x + b.w - 2, b.y + b.h - 2, 1, 1);
            ctx.fillRect(b.x, b.y + 2, 1, b.h - 4);
            ctx.fillRect(b.x + b.w - 1, b.y + 2, 1, b.h - 4);
            // Tip.
            var tx = b.x + b.w;                  // 250
            ctx.fillStyle = '#000';
            ctx.fillRect(tx, b.y + 3, 2, 1);
            ctx.fillRect(tx, b.y + b.h - 4, 2, 1);
            ctx.fillRect(tx + 2, b.y + 4, 1, b.h - 8);
            ctx.fillStyle = COL_TIP;
            ctx.fillRect(tx, b.y + 5, 2, b.h - 10);
            ctx.fillStyle = COL_TIP_LOW;
            ctx.fillRect(tx, b.y + b.h - 5, 2, 1);
        }
        var ink = inv ? '#fff' : '#000', paper = inv ? '#000' : '#fff';
        // Charge fill: any charge shows at least 1 px; the left corners
        // are cut, and the right ones too once it fills the whole area.
        var fw = Math.ceil(f.w * pct / 100);
        ctx.fillStyle = ink;
        if (fw > 0) {
            var cut = fw >= f.w ? 2 : 1;         // edge rows lose 1 px per rounded end
            ctx.fillRect(f.x, f.y + 1, fw, f.h - 2);
            if (fw > cut) {
                ctx.fillRect(f.x + 1, f.y, fw - cut, 1);
                ctx.fillRect(f.x + 1, f.y + f.h - 1, fw - cut, 1);
            }
        }
        if (!digits) return;
        // Percent, centred in the fill area (rounded like the power meter demo):
        // fill colour over the empty part, the other one clipped to the fill.
        var text = String(Math.round(pct));
        var tw = HaxrCorp4090FlipCTL.textWidth(text);
        var px = f.x + Math.round((f.w - 1 - tw) / 2);
        HaxrCorp4090FlipCTL.draw(ctx, text, px, PCT_Y, ink);
        if (fw > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(f.x, f.y, fw, f.h);
            ctx.clip();
            HaxrCorp4090FlipCTL.draw(ctx, text, px, PCT_Y, paper);
            ctx.restore();
        }
    }

    // A button: outline + label as drawn, or inverted when pressed.
    function drawButton(ctx, btn, pressed) {
        for (var r = 0; r < btn.rows.length; r++) {
            var row = btn.rows[r];
            for (var c = 0; c < row.length; c++) {
                var ch = row.charAt(c);
                if (ch === ' ') continue;
                var black = ch === '#' || (pressed ? ch === 'w' : ch === 't');
                ctx.fillStyle = black ? '#000' : '#fff';
                ctx.fillRect(btn.x + c, btn.y + r, 1, 1);
            }
        }
    }

    // The faint "Test" button: stock right-button outline (rounded top
    // left, open on the right), normal black / white while pressed.
    function drawTestButton(ctx, pressed) {
        var b = TEST_BTN, y = 144 - b.h;
        if (pressed) {
            ctx.fillStyle = '#000';
            ctx.fillRect(b.x + 3, y, b.w - 3, 1);
            ctx.fillRect(b.x + 2, y + 1, b.w - 2, 1);
            ctx.fillRect(b.x + 1, y + 2, b.w - 1, 1);
            ctx.fillRect(b.x, y + 3, b.w, b.h - 3);
        } else {
            ctx.fillStyle = COL_TEST_LINE;
            ctx.fillRect(b.x + 3, y, b.w - 3, 1);
            ctx.fillRect(b.x + 2, y + 1, 1, 1);
            ctx.fillRect(b.x + 1, y + 2, 1, 1);
            ctx.fillRect(b.x, y + 3, 1, b.h - 3);
        }
        var tw = HaxrCorp4090FlipCTL.textWidth(b.text);
        HaxrCorp4090FlipCTL.draw(ctx, b.text, b.x + Math.floor((b.w - tw) / 2), y + 2,
            pressed ? '#fff' : COL_TEST_TEXT);
    }

    // "USB-C1 IN: PD Ver2 [12V/36W]", right-aligned; without PD the "PD
    // Ver2" turns into "×PD" (the × 1 px lower).
    function drawUsbStatus(ctx, sim, d) {
        var H = HaxrCorp4090FlipCTL;
        var volts = d.portW <= 15 ? 5 : d.portW <= 27 ? 9 : 12;
        var boxText = volts + 'V/' + fmtW(d.portW);
        var bw = H.textWidth(boxText) + 1 + 2 * BOX.pad;
        var bx = BOX.right + 1 - bw;
        ctx.fillStyle = COL_BOX;
        ctx.fillRect(bx + 2, BOX.y, bw - 4, 1);
        ctx.fillRect(bx + 1, BOX.y + 1, bw - 2, 1);
        ctx.fillRect(bx, BOX.y + 2, bw, BOX.h - 4);
        ctx.fillRect(bx + 1, BOX.y + BOX.h - 2, bw - 2, 1);
        ctx.fillRect(bx + 2, BOX.y + BOX.h - 1, bw - 4, 1);
        H.draw(ctx, boxText, bx + BOX.pad, STATUS_Y, '#fff');

        var right = bx - STATUS_GAP;             // text advance ends here
        var head = 'USB-C1 ' + sim.dir.toUpperCase() + ':';
        if (sim.pd) {
            var t = head + ' PD Ver2';
            H.draw(ctx, t, right - H.textWidth(t) - 1, STATUS_Y, COL_STATUS);
        } else {
            // head, 3 px, ×, 1 px, PD
            var pdW = H.textWidth('PD') + 1;
            var px = right - pdW;
            var xx = px - 1 - GLYPH_X[0].length;
            drawMap(ctx, GLYPH_X, xx, STATUS_Y + 3, { '#': COL_STATUS });
            H.draw(ctx, 'PD', px, STATUS_Y, COL_STATUS);
            H.draw(ctx, head, xx - 3 - H.textWidth(head), STATUS_Y, COL_STATUS);
        }
    }

    function easeInOut(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // Dolphin x for `now`: centred, or at leftX while `left`; a change
    // starts a move from wherever it is.
    McuUiV002DemoScene.prototype._dolphinX = function(left, now) {
        var target = left ? DOLPHIN.leftX : DOLPHIN.centerX;
        if (this._dolphinLeft === null) {
            this._dolphinLeft = left;
            this._dolphinFrom = target;
            this._dolphinMoveAt = 0;
            return target;
        }
        if (left !== this._dolphinLeft) {
            this._dolphinFrom = this._dolphinX(this._dolphinLeft, now);
            this._dolphinLeft = left;
            this._dolphinMoveAt = now;
        }
        var t = Math.min(1, (now - this._dolphinMoveAt) / DOLPHIN.moveMs);
        return Math.round(this._dolphinFrom + (target - this._dolphinFrom) * easeInOut(t));
    };

    McuUiV002DemoScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        var sim = this._sim, d = derive(sim);
        var now = Date.now();
        canvas.clear('#fff');

        var dx = this._dolphinX(d.portW > 0, now);
        var img = this._dolphinImg;
        if (img && img.complete && img.naturalWidth) {
            var frame = Math.floor((now - this._startedAt) / DOLPHIN.frameMs) % DOLPHIN.frames;
            ctx.drawImage(img, 0, frame * DOLPHIN.h, DOLPHIN.w, DOLPHIN.h,
                dx, DOLPHIN.y, DOLPHIN.w, DOLPHIN.h);
        }

        // Plates start sliding when the state turns active on screen.
        if (d.active && !this._wasActive) this._activeAt = now;
        this._wasActive = d.active;
        var p = d.active ? Math.min(1, (now - this._activeAt) / SLIDE_MS) : 0;
        var slide = SLIDE_FROM - Math.floor(p * SLIDE_FROM);

        var autoOffS = AUTO_OFF[this._power.autoOff].s;
        if (!d.active && autoOffS > 0) {
            // Pill: rows inset 2 / 1 at the top and bottom (2 px corners).
            ctx.fillStyle = COL_PILL;
            ctx.fillRect(PILL.x + 2, PILL.y, PILL.w - 4, 1);
            ctx.fillRect(PILL.x + 1, PILL.y + 1, PILL.w - 2, 1);
            ctx.fillRect(PILL.x, PILL.y + 2, PILL.w, PILL.h - 4);
            ctx.fillRect(PILL.x + 1, PILL.y + PILL.h - 2, PILL.w - 2, 1);
            ctx.fillRect(PILL.x + 2, PILL.y + PILL.h - 1, PILL.w - 4, 1);
            HaxrCorp4090FlipCTL.draw(ctx, 'Auto Power OFF', PILL_TEXT_X, PILL_TEXT_Y, '#fff');
            HaxrCorp4090FlipCTL.draw(ctx, timeLeftText(autoOffS, now - this._autoOffAt), TIMER_X, TIMER_Y, '#000');
        }

        // "Discharge: 0.03W" — what the battery gives — right-aligned to
        // the battery; rides off to the right while the plates come in.
        var line = 'Discharge: ' + Math.max(0, d.usageW - d.watts).toFixed(2) + 'W';
        var lw = HaxrCorp4090FlipCTL.textWidth(line);
        var lx = DISCHARGE_RIGHT + 1 - (lw - 1) - 1;
        if (d.active) lx += Math.floor(p * (256 - lx));
        if (lx < 256) HaxrCorp4090FlipCTL.draw(ctx, line, lx, DISCHARGE_Y, '#000');

        if (d.active) {
            var info = infoLines(sim, d), L = info.layout;
            var box = L.box + slide;
            drawPlate(ctx, INFO_PLATE_X + box + L.plate, COL_INFO_PLATE);
            if (L === INFO.full) {
                HaxrCorp4090FlipCTL.draw(ctx, info.line1, box + L.line1, INFO_FULL_Y, '#000');
            } else {
                HaxrCorp4090FlipCTL.draw(ctx, info.line1, box + L.line1, INFO_LINE1_Y, '#000');
                HaxrCorp4090FlipCTL.draw(ctx, info.line2, box + L.line2, INFO_LINE2_Y, '#000');
                if (info.inf) {
                    var ix = box + L.line2 + HaxrCorp4090FlipCTL.textWidth(info.line2) + 1;
                    drawMap(ctx, GLYPH_INF, ix, INFO_LINE2_Y + 3, { '#': '#000' });
                }
            }
            var shift = d.discharging ? BG_SHIFT_DISCHARGE : d.full ? BG_SHIFT_FULL : 0;
            drawPlate(ctx, BG_PLATE_X + shift + slide, '#000');
        }

        drawBattery(canvas, sim.charge, d.active, !d.charging);
        if (d.charging && !d.full) {
            drawMap(ctx, SPARK.rows, SPARK.x, SPARK.y, { '#': '#000', w: '#fff' });
        }
        // Charge with hundredths on the plate, once it has slid in.
        if (d.charging && p >= 1) {
            var pct = d.full ? '100%' : sim.charge.toFixed(2) + '%';
            Born2bSportyV2FlipCTL.draw(ctx, pct,
                PLATE_PCT_RIGHT - Born2bSportyV2FlipCTL.textWidth(pct) + 1, PLATE_PCT_Y, '#fff');
        }
        if (d.portW > 0) drawUsbStatus(ctx, sim, d);

        HaxrCorp4090FlipCTL.draw(ctx, VERSION, VERSION_X, VERSION_Y, COL_VERSION);

        for (var name in BUTTONS) {
            drawButton(ctx, BUTTONS[name], this._pressed === name);
        }
        drawTestButton(ctx, this._pressed === 'test');

        if (this._helpMenu && !this._helpWin) this._drawHelpMenu(canvas);
        if (this._helpWin) this._drawHelpWindow(canvas);
        if (this._powerMenu) this._drawPowerMenu(canvas);
    };

    // Lays a help page out: draw ops { font | icon, text, x, y } with y
    // from the viewport top, and the content height.
    var helpLayouts = {};
    function layoutHelpPage(index) {
        if (helpLayouts[index]) return helpLayouts[index];
        var m = HELP_WINDOW, page = HELP_PAGES[index], ops = [];
        // Inline icons; gap = blank px on each side (3 is a plain space).
        var H = HaxrCorp4090FlipCTL, icons = {
            down: { map: HELP_DOWN_ICON, gap: 8 },
            router: { sprite: Icons.router_small, gap: 3 }
        };
        function tokenW(t) {
            var mt = /^\{(\w+)\}$/.exec(t);
            if (!mt) return haxrWidth(t);
            var ic = icons[mt[1]];
            return ic.map ? ic.map[0].length : ic.sprite.w;
        }
        function iconOf(t) {
            var mt = /^\{(\w+)\}$/.exec(t);
            return mt ? icons[mt[1]] : null;
        }
        // Advance from one token's left edge to the next one's: a space
        // between words, the icon's gap on each side of an icon.
        function advance(prev, next) {
            var ic = iconOf(prev) || iconOf(next);
            if (ic) return tokenW(prev) + ic.gap;
            return tokenW(prev) + 1 + H.textWidth(' ') + 1;
        }
        function lineW(words) {
            var w = 0;
            for (var i = 1; i < words.length; i++) w += advance(words[i - 1], words[i]);
            return w + tokenW(words[words.length - 1]);
        }
        var y = 1;
        ops.push({ font: Born2bSportyV2FlipCTL, text: page.title, x: m.textX, y: y });
        y += page.blocks.length && page.blocks[0].h ? m.titleGap : m.titleGapText;
        var first = true;
        page.blocks.forEach(function(b) {
            if (b.gap) { y += m.line; return; }
            if (b.qr) {
                // QR with its lines to the right, the pair centred in the
                // window; the lines are centred on the QR vertically as a
                // block (Haxrcorp caps of line 1 to those of the last line:
                // line × (n−1) + 7 px).
                var q = HELP_QR_DOCS, size = q.length * HELP_QR_SCALE;
                var lines = b.lines || [], n = lines.length, textW = 0;
                lines.forEach(function(t) { textW = Math.max(textW, haxrWidth(t)); });
                var blockW = size + (n ? HELP_QR_TEXT_GAP + textW : 0);
                var qx = m.view.x + Math.floor((m.view.w - blockW) / 2);
                y += 2;
                ops.push({ qr: q, x: qx, y: y });
                if (n) {
                    var textH = m.line * (n - 1) + 7;
                    var ty = y + Math.floor((size - textH) / 2) - 2;   // Haxrcorp caps start at draw y + 2
                    lines.forEach(function(t, k) {
                        ops.push({ haxr: true, text: t, x: qx + size + HELP_QR_TEXT_GAP, y: ty + k * m.line });
                    });
                }
                y += size + 6;
                return;
            }
            if (b.h) {
                if (!first) y += m.sectionGap;
                ops.push({ font: Helvb08Regular, text: b.h, x: m.textX, y: y });
                y += m.line;
                first = false;
                return;
            }
            first = false;
            // Word wrap, icons as words. A short word (1–2 characters:
            // "In", "a", "to", "4K", …) never ends a line — it moves down
            // to the word it belongs with.
            var words = b.p.split(' '), lines = [], cur = [];
            for (var i = 0; i < words.length; i++) {
                if (cur.length && lineW(cur.concat(words[i])) > m.wrapW) {
                    var carry = [];
                    while (cur.length > 1 && HELP_HANGING.test(cur[cur.length - 1])) carry.unshift(cur.pop());
                    lines.push(cur);
                    cur = carry;
                }
                cur.push(words[i]);
            }
            if (cur.length) lines.push(cur);
            lines.forEach(function(ws) {
                var x = m.textX;
                ws.forEach(function(w, k) {
                    if (k) x += advance(ws[k - 1], w);
                    var mt = /^\{(\w+)\}$/.exec(w);
                    if (mt) ops.push({ icon: icons[mt[1]], x: x, y: y });
                    else ops.push({ haxr: true, text: w, x: x, y: y });
                });
                y += m.line;
            });
        });
        return (helpLayouts[index] = { ops: ops, height: y });
    }

    // The help window's page tabs: the About tabs with a blunt arrow —
    // the tip's one 5 px row loses its outermost pixel (3 rows of 4).
    function bluntTab(map, right) {
        return map.map(function(row) {
            if ((row.match(/t/g) || []).length !== 5) return row;
            var i = right ? row.lastIndexOf('t') : row.indexOf('t');
            return row.slice(0, i) + 'w' + row.slice(i + 1);
        });
    }
    var HELP_TAB = bluntTab(ABOUT_TAB, true), HELP_TAB_LEFT = bluntTab(ABOUT_TAB_LEFT, false);

    // Touchpad drag-scrolls the help window: the absolute (x, y, touch)
    // feed of /api/touchpad/xy, read only while the window is open. A
    // fresh touch anchors; moving the finger up scrolls forward,
    // HELP_TOUCH_PX px per raw pad unit (~400 units end to end), with a
    // haptic tick per line and a thump at the ends.
    var HELP_TOUCH_PX = 0.5;
    McuUiV002DemoScene.prototype._helpTouchStart = function() {
        var self = this;
        if (this._touchES || typeof EventSource === 'undefined') return;
        try { this._touchES = new EventSource('/api/touchpad/xy'); }
        catch (e) { this._touchES = null; return; }
        var active = false, baseY = 0, scroll0 = 0, edgeBuzzed = false;
        this._touchES.onmessage = function(ev) {
            var hw = self._helpWin;
            var p = String(ev.data).split(',');
            if (!hw || self._powerMenu || p.length < 3) { active = false; return; }
            var ny = +p[1], touching = +p[2] === 1;
            if (ny !== ny) return;               // NaN
            if (!touching) { active = false; return; }
            if (!active) { active = true; baseY = ny; scroll0 = hw.scroll; edgeBuzzed = false; return; }
            var maxS = self._helpMaxScroll(hw.page);
            var want = Math.round(scroll0 + (baseY - ny) * HELP_TOUCH_PX);
            var next = Math.max(0, Math.min(maxS, want));
            // Haptics, as in the App Switcher: a tick per text line
            // scrolled past, one thump per touch on pushing into an end.
            if (next !== want && maxS > 0) {
                if (!edgeBuzzed) { playHaptic(3); edgeBuzzed = true; }
            } else {
                edgeBuzzed = false;
            }
            if (Math.floor(next / HELP_WINDOW.line) !== Math.floor(hw.scroll / HELP_WINDOW.line)) {
                playHaptic(3, 10);
            }
            if (next !== hw.scroll) { hw.scroll = next; repaint(); }
        };
    };
    // Fire-and-forget haptic: effectId from the library, durationMs
    // optional (omit for the effect's full waveform).
    function playHaptic(effectId, durationMs) {
        try {
            fetch('/api/haptic/play', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ effectId: effectId, durationMs: durationMs })
            }).catch(function() { /* desktop preview */ });
        } catch (e) { /* ignore */ }
    }
    McuUiV002DemoScene.prototype._helpTouchStop = function() {
        if (this._touchES) {
            try { this._touchES.close(); } catch (e) { /* ignore */ }
            this._touchES = null;
        }
    };

    var HELP_HANGING = /^[\w@&]{1,2}$/;

    McuUiV002DemoScene.prototype._helpMaxScroll = function(page) {
        var v = HELP_WINDOW.view;
        return Math.max(0, layoutHelpPage(page).height - v.h);
    };

    McuUiV002DemoScene.prototype._drawHelpWindow = function(canvas) {
        var ctx = canvas.ctx, m = HELP_WINDOW, hw = this._helpWin, H = HaxrCorp4090FlipCTL;
        canvas.clear('#fff');
        drawMenuWindow(canvas, m);
        drawBadge(ctx, Icons.help_question, m.iconX, m.iconY);
        // "Help > Quick start": the header follows the page.
        H.draw(ctx, 'Help > ' + HELP_PAGES[hw.page].title, m.titleX, m.titleY, '#000');
        var pg = 'Page ' + (hw.page + 1) + '/' + HELP_PAGES.length;
        H.draw(ctx, pg, m.pageRight - H.textWidth(pg), m.titleY, '#000');

        // Content, clipped to the viewport and scrolled.
        var v = m.view, lay = layoutHelpPage(hw.page);
        ctx.save();
        ctx.beginPath();
        ctx.rect(v.x, v.y, v.w, v.h);
        ctx.clip();
        lay.ops.forEach(function(op) {
            var y = v.y + op.y - hw.scroll;
            if (y > v.y + v.h || y < v.y - 16) return;
            if (op.qr) {
                // Whole pixels per module, so the code stays sharp.
                ctx.fillStyle = '#000';
                for (var r = 0; r < op.qr.length; r++) {
                    for (var c = 0; c < op.qr[r].length; c++) {
                        if (op.qr[r].charAt(c) === '#') {
                            ctx.fillRect(op.x + c * HELP_QR_SCALE, y + r * HELP_QR_SCALE, HELP_QR_SCALE, HELP_QR_SCALE);
                        }
                    }
                }
            } else if (op.icon) {
                // Icons sit on the Haxrcorp caps (rows y+2..y+8).
                if (op.icon.map) drawMap(ctx, op.icon.map, op.x, y + 2, { '#': '#000' });
                else canvas.drawSprite(op.icon.sprite, op.x, y + 2, '#000');
            } else if (op.haxr) {
                drawHaxr(ctx, op.text, op.x, y, '#000');
            } else {
                op.font.draw(ctx, op.text, op.x, y, '#000');
            }
        });
        ctx.restore();

        // Scrollbar (only when the page doesn't fit).
        var maxS = this._helpMaxScroll(hw.page), b = m.bar;
        if (maxS > 0) {
            ctx.fillStyle = '#000';
            for (var i = 0; i < b.h; i += 2) ctx.fillRect(b.x, b.y + i, 1, 1);
            var range = b.h - 2 * b.pad;
            var th = Math.max(5, Math.round(range * v.h / lay.height));
            var ty = b.y + b.pad + Math.round((range - th) * hw.scroll / maxS);
            ctx.fillRect(b.x - 1, ty, 3, th);
        }

        // Page tabs, flashing on a press.
        var drawTab = function(right, down) {
            var map = right ? HELP_TAB : HELP_TAB_LEFT, w = map[0].length;
            drawMap(ctx, map, right ? 256 - w : 0, ABOUT.tabY,
                down ? { '#': '#000', w: '#000', t: '#fff' } : { '#': '#000', w: '#fff', t: '#000' });
        };
        if (hw.page > 0 || hw.press === 'left') drawTab(false, hw.press === 'left');
        if (hw.page < HELP_PAGES.length - 1 || hw.press === 'right') drawTab(true, hw.press === 'right');

        // Quick start points at the Power button below the window.
        if (hw.page === 0) drawButton(ctx, BUTTONS.power, false);
    };

    // A menu window (Power / Help): the rounded frame, its shadow (the
    // same shape filled, m.shadow px right and down) and the header band.
    function drawMenuWindow(canvas, m) {
        [[m.shadow, COL_POWER_MENU_LINE], [0, '#fff']].forEach(function(layer) {
            new ResponsiveFrame({
                x: m.x + layer[0], y: m.y + layer[0], width: m.w, height: m.h,
                anchorH: 'left', anchorV: 'top',
                showStroke: true, strokeColor: COL_POWER_MENU_LINE,
                showFill: true, fillColor: layer[1],
                cornerRadius: m.radius,
                corners: { tl: true, tr: true, bl: true, br: true }
            }).render(canvas);
        });
        fillBand(canvas.ctx, m.x, m.y, m.w, m.band);
    }

    McuUiV002DemoScene.prototype._drawHelpMenu = function(canvas) {
        var ctx = canvas.ctx, m = HELP_MENU, sel = this._helpMenu.sel;
        ctx.fillStyle = HELP_WASH;
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        drawButton(ctx, BUTTONS.help, false);
        drawMenuWindow(canvas, m);
        drawBadge(ctx, Icons.help_question, m.iconX, m.iconY);
        HaxrCorp4090FlipCTL.draw(ctx, m.title, m.titleX, m.titleY, '#000');
        var f = m.rowFrame;
        for (var i = 0; i < m.items.length; i++) {
            var dy = i * m.rowPitch;
            if (i === sel) {
                new MenuSelectorFrame({
                    x: f.x, y: f.y + dy, width: f.w, height: f.h,
                    anchorH: 'left', anchorV: 'top',
                    strokeColor: '#000', showStroke: true, showFill: false
                }).render(canvas);
            }
            (i === sel ? Helvb08Regular : HaxrCorp4090FlipCTL).draw(ctx, m.items[i], m.textX, m.textY + dy, '#000');
        }
    };

    McuUiV002DemoScene.prototype._drawPowerMenu = function(canvas) {
        var ctx = canvas.ctx, m = POWER_MENU, sel = this._powerMenu.sel;
        ctx.fillStyle = HELP_WASH;
        ctx.fillRect(0, 0, canvas.w, canvas.h);
        drawButton(ctx, BUTTONS.power, false);
        drawMenuWindow(canvas, m);
        canvas.drawSprite(Icons.power_menu_icon, m.iconX, m.iconY, '#000');
        HaxrCorp4090FlipCTL.draw(ctx, 'Power Menu', m.titleX, m.titleY, '#000');
        var f = m.rowFrame, B8 = Helvb08Regular, H = HaxrCorp4090FlipCTL;
        var labels = ['Start', 'Power OFF'];
        for (var i = 0; i < 2; i++) {
            var dy = i * m.rowPitch, font = i === sel ? B8 : H;
            if (i === sel) {
                new MenuSelectorFrame({
                    x: f.x, y: f.y + dy, width: f.w, height: f.h,
                    anchorH: 'left', anchorV: 'top',
                    strokeColor: '#000', showStroke: true, showFill: false
                }).render(canvas);
            }
            font.draw(ctx, labels[i], (i === sel ? m.cx : m.regularCX) - Math.floor(font.textWidth(labels[i]) / 2),
                (i === sel ? m.boldY : m.regularY) + dy, '#000');
        }
    };

    // Power OFF: the screen and every LED go dark; Back brings it all
    // back and returns to the home screen.
    McuUiV002DemoScene.prototype._powerOffScene = function() {
        var self = this, savedPower = null;
        return {
            breadcrumbTitle: 'Power OFF',
            enter: function() {
                postBacklight({ action: 'off' });
                self._ledsHeld = true;
                self._ledsOff();
                netPost('/api/led/set', { led: 'link', on: false });
                fetch('/api/mcu/leds', { cache: 'no-store' })
                    .then(function(r) { return r.json(); })
                    .then(function(d) {
                        if (d && d.ok && d.leds) savedPower = d.leds.power;
                        postLeds({ leds: { power: 0 } });
                    })
                    .catch(function() { postLeds({ leds: { power: 0 } }); });
                repaint();
            },
            exit: function() {
                postBacklight({ action: 'on' });
                if (savedPower !== null) postLeds({ leds: { power: savedPower } });
                releaseNetLeds();                // link back to its auto state…
                setNetLedsOff();                 // …while Wi-Fi / Ethernet stay off
                self._ledsHeld = false;
                self._ledSent = null;
            },
            handleInput: function(action) {
                if (action === 'back' || action === 'esc') return 'pop';
            },
            render: function(canvas) { canvas.clear('#fff'); }
        };
    };

    return McuUiV002DemoScene;
})();
