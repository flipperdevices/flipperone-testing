//! Rendering invariants for the panel.
//!
//! Only built with `--features slint`, since it needs the compiled components.

#![cfg(feature = "slint")]

mod support;

use flipper_ui::slint_render::{render_frame, FlipperSlintPlatform};
use flipper_ui::theme;
use flipper_ui::Surface;

use flipper_ui::ui::{ListItem, Root, Screen};
use slint::ComponentHandle;

/// A row, with the chevron affordance parsed out of the status the way the demo
/// binary does it. Keeps the tests declaring rows the way a caller does.
fn item(label: &str, status: &str, icon: i32, frames: i32) -> ListItem {
    let (chevrons, value) = match status {
        "< ON >" | "< OFF >" => (1, status.trim_matches(['<', '>', ' ']).to_string()),
        s if s.starts_with('<') && s.ends_with('>') && s.len() > 2 => {
            (2, s[1..s.len() - 1].trim().to_string())
        }
        s => (0, s.to_string()),
    };
    ListItem {
        label: label.into(),
        status: status.into(),
        icon,
        frames,
        chevrons,
        value: value.as_str().into(),
        at_start: false,
        at_end: false,
    }
}

fn list_screen(screen: &Root, pressed: bool) {
    let items: Vec<ListItem> = [
        ("Desktop Computer", "", 1, 1),
        ("Boot Menu", "", 2, 1),
        ("Apps", "", 3, 9),
        ("Files", "", 4, 10),
        ("Network", "", 5, 10),
        ("Testing", "", 6, 9),
        ("Settings", "", 7, 10),
    ]
    .iter()
    .map(|(label, status, icon, frames)| item(label, status, *icon, *frames))
    .collect();

    screen.set_total(items.len() as i32);
    screen.set_items(slint::ModelRc::new(slint::VecModel::from(items)));
    screen.set_selected(0);
    screen.set_pressed(pressed);
    screen.set_real_frame(true);
    // A fixed reading, so the golden does not move with the real battery.
    // A fixed reading so the golden does not move with the real battery, and a
    // live ethernet link so the left cluster is exercised.
    screen.set_battery(87);
    screen.set_ethernet(1);
    screen.set_menu_hints(slint::ModelRc::new(slint::VecModel::from(
        // The menu shows no soft buttons, as the prototype's MenuScene does not.
        ["", "", "", "", ""]
            .iter()
            .map(|s| slint::SharedString::from(*s))
            .collect::<Vec<_>>(),
    )));
}

/// Every pixel the panel receives must hold a design-token value, outside the
/// sprite boxes.
///
/// This is the invariant that keeps antialiasing out of the *geometry*. Rounded
/// corners drawn with `border-radius`, text at a fractional offset, or a
/// font-family that silently falls back all show up here as grey levels that are
/// not in tokens.toml. On a panel whose design language is hard pixels, an
/// unintended grey is a visual bug and it is invisible until someone zooms in.
///
/// Sprites are exempt, and deliberately so. The prototype's icons are 6-bit
/// greyscale precisely so their anti-aliased edges survive, and `drawSprite`
/// blends them at `opacity = (63 - grey) / 63`. Measured against the device, the
/// prototype's own main menu contains the tones 49, 125, 162, 219 and 247, and
/// ours contains exactly the same set. Snapping them to tokens was tried and
/// reverted: it made us differ from the device for no gain.
///
/// Both states are checked in one test because Slint's platform is global and
/// can only be installed once per process.
#[test]
fn rendered_frames_use_only_design_tokens() {
    let allowed: Vec<(u8, &str)> = theme::ALL_COLORS
        .iter()
        .map(|(name, _, r, ..)| (*r, *name))
        .collect();

    let window = FlipperSlintPlatform::install();
    let screen = Root::new().expect("create Root");
    screen.set_screen(Screen::Menu);

    // Charging is checked too: the bolt is the one sprite drawn with the
    // prototype's literal three-tone path rather than tinted, so it is the most
    // likely place for an off-palette grey to appear. It did: the 6-bit source
    // quantises its white interior to 247, which the converter now snaps.
    for (pressed, charging) in [(false, false), (true, false), (false, true)] {
        list_screen(&screen, pressed);
        screen.set_charging(charging);
        screen.show().expect("show");
        slint::platform::update_timers_and_animations();

        let frame = render_frame(&window).expect("a state change always needs painting");

        // Boxes whose contents come from a sprite, so may hold any tone: each
        // visible row's 14px icon, and the status bar's left cluster and battery.
        let stride = usize::from(theme::PANEL_W);
        let mut sprite_boxes: Vec<(i32, i32, i32, i32)> = vec![
            (0, 0, 48, theme::metric::STATUS_BAR_H),
            (
                i32::from(theme::PANEL_W) - 20,
                0,
                20,
                theme::metric::STATUS_BAR_H,
            ),
        ];
        for row in 0..theme::count::LIST_VISIBLE_ROWS {
            sprite_boxes.push((
                theme::metric::LIST_CONTAINER_X + theme::metric::ICON_PAD,
                theme::metric::LIST_CONTAINER_Y
                    + row * (theme::metric::MENU_LINE_H + 1)
                    + theme::metric::ICON_PAD,
                14,
                14,
            ));
        }
        let in_sprite_box = |x: i32, y: i32| {
            sprite_boxes
                .iter()
                .any(|(bx, by, bw, bh)| x >= *bx && x < bx + bw && y >= *by && y < by + bh)
        };

        let mut offenders: Vec<(usize, u8)> = Vec::new();
        for (i, px) in frame.iter().enumerate() {
            let x = (i % stride) as i32;
            let y = (i / stride) as i32;
            if in_sprite_box(x, y) {
                continue;
            }
            if !allowed.iter().any(|(value, _)| *value == px.0) {
                offenders.push((i, px.0));
            }
        }

        if !offenders.is_empty() {
            let listed: Vec<String> = offenders
                .iter()
                .take(8)
                .map(|(i, v)| format!("({}, {}) = {v}", i % stride, i / stride))
                .collect();
            panic!(
                "pressed={pressed} charging={charging}: {} of {} pixels hold a value \
                 that is not a design token.\n\
                 First offenders: {}\n\
                 Allowed values: {:?}\n\
                 Usual causes: a `border-radius` corner, a Text at a fractional offset, \
                 or a font-family that fell back to a substitute face.",
                offenders.len(),
                frame.len(),
                listed.join(", "),
                allowed.iter().map(|(v, n)| format!("{n}={v}")).collect::<Vec<_>>(),
            );
        }

        // Status bar geometry, checked from the pixels rather than trusted.
        #[allow(clippy::let_and_return)]
        //
        // The bar is 13px of solid ink and the caps sit on rows 5..11. Getting
        // this wrong is invisible in a thumbnail and obvious on the device, and it
        // did go wrong once: a hand-tuned text offset put the ink on rows 1..7.
        let stride = usize::from(theme::PANEL_W);
        // The bar spans the full width, so its extent is the leading run of rows
        // whose first pixel is bar ink.
        let bar_h = (0..usize::from(theme::PANEL_H))
            .take_while(|y| frame[y * stride] == theme::color::BAR_BG)
            .count();
        assert_eq!(
            i32::try_from(bar_h).unwrap(),
            theme::metric::STATUS_BAR_H,
            "the status bar must be {} rows of solid ink",
            theme::metric::STATUS_BAR_H
        );

        let ink_rows = |x0: usize, x1: usize| -> Vec<usize> {
            (0..usize::try_from(theme::metric::STATUS_BAR_H).unwrap())
                .filter(|y| (x0..x1).any(|x| frame[y * stride + x] == theme::color::BAR_FG))
                .collect()
        };

        // The battery percentage is raised two pixels relative to everything
        // else, so it reads level with the glyph: the prototype draws it at
        // `top - 2`, putting caps on rows 3..9 rather than 5..11.
        assert_eq!(
            ink_rows(200, 236),
            vec![3, 4, 5, 6, 7, 8, 9],
            "battery percentage caps must sit on rows 3..9, per drawBattery"
        );

        // The 16x9 glyph is raised one pixel, so it spans rows 2..10, and its
        // outline means the first and last of those rows carry ink.
        let glyph = ink_rows(239, 255);
        assert_eq!(
            (glyph.first().copied(), glyph.last().copied()),
            (Some(2), Some(10)),
            "the battery glyph must span rows 2..10, per drawBattery"
        );

        // The left cluster sits at `top` with no lift, so a 7px icon covers
        // rows 3..9.
        assert_eq!(
            ink_rows(0, 40),
            vec![3, 4, 5, 6, 7, 8, 9],
            "left-cluster icons must sit on rows 3..9"
        );

        // Dividers span the selector's straight edges, not the row container.
        // menu.js: dividerX = SELECTOR_X + SELECTOR_CORNER_R, and
        // dividerW = selectorW - 2 * SELECTOR_CORNER_R. Using the row width
        // instead makes them 14px short, which is invisible until compared
        // against the device.
        let divider_runs: Vec<(usize, usize)> = (0..usize::from(theme::PANEL_H))
            .filter_map(|y| {
                let row: Vec<usize> = (0..stride)
                    .filter(|x| frame[y * stride + x] == theme::color::DIVIDER)
                    .collect();
                (row.len() > 50).then(|| (row[0], row[row.len() - 1]))
            })
            .collect();
        let expected_x = usize::try_from(theme::metric::SELECTOR_X + theme::radius::MENU).unwrap();
        let expected_end = expected_x
            + usize::try_from(theme::metric::SELECTOR_W_SCROLL - 2 * theme::radius::MENU).unwrap()
            - 1;
        assert!(!divider_runs.is_empty(), "the menu should have dividers");
        for (start, end) in &divider_runs {
            assert_eq!(
                (*start, *end),
                (expected_x, expected_end),
                "divider must span the selector's straight edges"
            );
        }

        // Same frame, compared against the committed golden.
        let mut surface = Surface::panel();
        for (i, px) in frame.iter().enumerate() {
            let x = (i % usize::from(theme::PANEL_W)) as i32;
            let y = (i / usize::from(theme::PANEL_W)) as i32;
            surface.pixel(x, y, *px);
        }
        let name = match (pressed, charging) {
            (true, _) => "list-pressed",
            (_, true) => "list-charging",
            _ => "list",
        };
        support::assert_golden(name, &surface);
    }
}

/// The soft-button strip must match the design export's horizontal geometry.
///
/// `tests/reference/soft_button_bar.png` comes from the Figma export, not from our
/// own output, so it is the one fixture in the suite that can catch us being
/// self-consistently wrong. It is what found the outer slots' missing outer
/// borders and a 1px label offset.
///
/// The export is 17 rows tall and the decision is 14, so the comparison covers
/// what the two agree on and what the export alone settles: the top border row,
/// the three chamfer rows, and the set of border columns down the straight body.
/// Every horizontal measurement is checked; only the number of straight rows is
/// not. Replace the reference with a 14-row export to compare the whole strip
/// again.
#[test]
fn the_soft_button_strip_matches_the_design_export() {
    let (ref_w, ref_h, reference) = {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/reference/soft_button_bar.png");
        let decoder = png::Decoder::new(std::io::BufReader::new(
            std::fs::File::open(path).expect("reference png"),
        ));
        let mut reader = decoder.read_info().expect("png info");
        let mut buf = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut buf).expect("png frame");
        buf.truncate(info.buffer_size());
        (info.width as usize, info.height as usize, buf)
    };
    assert_eq!(ref_w, usize::from(theme::PANEL_W), "reference spans the panel");

    let window = FlipperSlintPlatform::install();
    let screen = Root::new().expect("create Root");
    screen.set_screen(Screen::Menu);
    list_screen(&screen, false);
    // The export labels every slot with the 8-character budget it was drawn for.
    screen.set_menu_hints(slint::ModelRc::new(slint::VecModel::from(
        std::iter::repeat(slint::SharedString::from("8chartxt"))
            .take(5)
            .collect::<Vec<_>>(),
    )));
    screen.show().expect("show");
    slint::platform::update_timers_and_animations();
    let frame = render_frame(&window).expect("first frame paints");

    let stride = usize::from(theme::PANEL_W);
    let strip_h = usize::try_from(theme::metric::BUTTON_H).unwrap();
    let strip_top = usize::from(theme::PANEL_H) - strip_h;

    let ink_runs = |row: &dyn Fn(usize) -> u8| -> Vec<(usize, usize)> {
        let mut runs = Vec::new();
        let mut start = None;
        for x in 0..stride {
            match (row(x) == 0, start) {
                (true, None) => start = Some(x),
                (false, Some(s)) => {
                    runs.push((s, x - 1));
                    start = None;
                }
                _ => {}
            }
        }
        if let Some(s) = start {
            runs.push((s, stride - 1));
        }
        runs
    };

    // Rows 0..3 carry the top border and the whole chamfer, and are where the
    // outer slots differ from the inner three.
    for row in 0..4 {
        let want = ink_runs(&|x| reference[row * stride + x]);
        let got = ink_runs(&|x| frame[(strip_top + row) * stride + x].0);
        assert_eq!(
            got, want,
            "strip row {row}: ink runs differ from the design export"
        );
    }

    // Below the chamfer, the only ink that appears in every row is the vertical
    // borders; the label occupies some rows and not others. So compare the set of
    // columns that are ink in all body rows, which is height independent and is
    // exactly what encodes the slot edges and the outer slots' missing outer
    // borders.
    let border_columns = |data: &dyn Fn(usize, usize) -> u8, rows: std::ops::Range<usize>| {
        (0..stride)
            .filter(|x| rows.clone().all(|row| data(row, *x) == 0))
            .collect::<Vec<_>>()
    };
    let want = border_columns(&|row, x| reference[row * stride + x], 4..ref_h);
    let got = border_columns(
        &|row, x| frame[(strip_top + row) * stride + x].0,
        4..strip_h,
    );
    assert_eq!(
        got, want,
        "border columns down the straight body differ from the design export"
    );
    // Spelled out, so a regression names the thing that broke rather than just
    // showing two lists: slot 0 has no border at x0 and slot 4 none at x255.
    assert_eq!(
        got,
        vec![47, 52, 99, 104, 151, 156, 203, 208],
        "the outer slots must have no outer border"
    );
}

/// A pressed menu row fills black and inverts its label and icon to white.
///
/// The fill has to be painted behind the row and the outline over it, exactly as
/// the prototype's scene does. Drawing one filled selector after the row instead
/// buries the row's own content: the label and the icon vanish into the fill
/// rather than inverting, which measures as a solid black band.
#[test]
fn a_pressed_row_inverts_its_label_and_icon() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().expect("create Root");
    screen.set_screen(Screen::Menu);
    list_screen(&screen, false);
    screen.show().expect("show");

    let stride = usize::from(theme::PANEL_W);
    // Row 0's icon box and label area.
    let icon = (8usize..22, 28usize..42);
    let label = (24usize..120, 28usize..42);
    let count = |frame: &[flipper_ui::Gray8], (xs, ys): (std::ops::Range<usize>, std::ops::Range<usize>), want: u8| {
        ys.clone()
            .flat_map(|y| xs.clone().map(move |x| (x, y)))
            .filter(|(x, y)| frame[y * stride + x].0 == want)
            .count()
    };

    screen.set_pressed(false);
    slint::platform::update_timers_and_animations();
    let rest = render_frame(&window).expect("rest");
    let rest_icon_ink = count(&rest, icon.clone(), 0);
    let rest_label_ink = count(&rest, label.clone(), 0);
    assert!(rest_icon_ink > 0 && rest_label_ink > 0, "the row draws at rest");

    screen.set_pressed(true);
    slint::platform::update_timers_and_animations();
    let down = render_frame(&window).expect("pressed");

    assert!(
        count(&down, icon.clone(), 255) > 0,
        "the icon must invert to white, not vanish into the fill"
    );
    assert!(
        count(&down, label.clone(), 255) > 0,
        "the label must invert to white, not vanish into the fill"
    );
    // And it really is an inversion: what was ink is now ground and vice versa.
    assert_eq!(
        count(&down, label.clone(), 255),
        rest_label_ink,
        "the pressed label's white pixels should match the resting label's ink"
    );
}

/// A pressed soft button fills black and inverts its label to white.
///
/// Checked from the pixels because the flash lasts 30ms on the device, which is
/// far too short to catch over the remote view. The button's interior must be
/// mostly ink with white glyphs inside it, which is the exact inverse of its
/// resting state.
#[test]
fn a_pressed_soft_button_inverts() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().expect("create Root");
    screen.set_idle_hints(slint::ModelRc::new(slint::VecModel::from(
        ["", "Menu", "", "", "Desktop"]
            .iter()
            .map(|s| slint::SharedString::from(*s))
            .collect::<Vec<_>>(),
    )));
    screen.show().expect("show");

    let stride = usize::from(theme::PANEL_W);
    let strip_top = usize::from(theme::PANEL_H) - usize::try_from(theme::metric::BUTTON_H).unwrap();
    // Slot 1's interior, inside its 1px border.
    let slot1 = usize::try_from(flipper_ui::layout::soft_slot_x(1)).unwrap();
    let interior = (slot1 + 2)..(slot1 + usize::try_from(theme::metric::BUTTON_W).unwrap() - 2);

    let census = |frame: &[flipper_ui::Gray8]| {
        let mut ink = 0;
        let mut white = 0;
        for row in (strip_top + 4)..usize::from(theme::PANEL_H) {
            for col in interior.clone() {
                match frame[row * stride + col] {
                    flipper_ui::Gray8(0) => ink += 1,
                    flipper_ui::Gray8(255) => white += 1,
                    _ => {}
                }
            }
        }
        (ink, white)
    };

    screen.set_idle_pressed_slot(-1);
    slint::platform::update_timers_and_animations();
    let (rest_ink, rest_white) = census(&render_frame(&window).expect("rest frame"));

    screen.set_idle_pressed_slot(1);
    slint::platform::update_timers_and_animations();
    let (down_ink, down_white) = census(&render_frame(&window).expect("pressed frame"));

    assert!(
        rest_white > rest_ink,
        "at rest the button is mostly white: {rest_white} white, {rest_ink} ink"
    );
    assert!(
        down_ink > down_white,
        "pressed the button is mostly ink: {down_ink} ink, {down_white} white"
    );
    // The label survives the inversion rather than vanishing into the fill.
    assert!(
        down_white > 0,
        "the pressed label must be white ink on the black fill, not absent"
    );
    // Inverting swaps the counts rather than merely darkening: the ink pressed
    // should be about what was white at rest, and vice versa.
    assert_eq!(
        (rest_ink, rest_white),
        (down_white, down_ink),
        "pressed should be the exact inverse of resting"
    );
}

/// The power-flow block must not move when the CPU reading's width changes.
///
/// In HaxrCorp `1` has an advance of 3 while every other digit has 6, so a reading
/// of 61.0 is three pixels narrower than 60.0. desktop.js positions the power block
/// from the reading's measured width (`cpuTempEndX(...) + 34`), which makes the
/// icon slide sideways as the temperature drifts. This pins it.
#[test]
fn the_power_block_does_not_move_with_the_cpu_reading() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().expect("create Root");
    screen.show().expect("show");

    let stride = usize::from(theme::PANEL_W);
    // First ink column right of the CPU reading, which is where the power icon and
    // its value live.
    let first_ink_col = |frame: &[flipper_ui::Gray8]| {
        (140..stride).find(|col| {
            (usize::try_from(theme::metric::STATUS_BAR_H).unwrap()..46)
                .any(|row| frame[row * stride + col] == flipper_ui::Gray8(0))
        })
    };

    let mut seen = std::collections::BTreeSet::new();
    // 611 and 601 differ only in a digit whose advance differs, and 1000 adds one.
    for tenths in [600, 611, 655, 1000, 599] {
        screen.set_cpu_temp(tenths);
        screen.set_power_mw(-20);
        slint::platform::update_timers_and_animations();
        let frame = render_frame(&window).expect("frame");
        seen.insert(first_ink_col(&frame));
    }

    assert_eq!(
        seen.len(),
        1,
        "the power block moved as the CPU reading changed: leftmost ink columns {seen:?}"
    );
    assert_eq!(
        seen.into_iter().next().flatten(),
        Some(usize::try_from(theme::metric::POWER_ICON_X).unwrap()),
        "the power block should sit at the pinned x"
    );
}

/// An app's log shows a scrollbar exactly when its buffer is deeper than the
/// window, and the thumb tracks the offset.
///
/// The bar hides when everything fits, which is the menu's rule too
/// (`Scrollbar.shouldShow()` is `totalItems > visibleItems`). A default ping run
/// produces seven lines against a window of eight, so no bar: that is correct, and
/// it is why one is not visible without turning the count up.
#[test]
fn an_app_log_scrolls_when_it_overflows() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().expect("create Root");
    screen.set_screen(Screen::AppLog);
    screen.set_app_title("Ping 1.1.1.1".into());
    screen.show().expect("show");

    let stride = usize::from(theme::PANEL_W);
    // The bar sits one pixel left of scrollbar_x so the 3px thumb is centred on
    // the dotted track, matching UI.Scrollbar.
    let bar_x = usize::try_from(theme::metric::SCROLLBAR_X).unwrap() - 1;
    let bar_w = usize::try_from(theme::metric::SCROLLBAR_W).unwrap();
    let strip_top = usize::from(theme::PANEL_H) - usize::try_from(theme::metric::BUTTON_H).unwrap();
    // Only the log area: the status bar is solid ink, so scanning from row 0 would
    // report every one of its rows as thumb.
    let thumb_rows = |frame: &[flipper_ui::Gray8]| -> Vec<usize> {
        (usize::try_from(theme::metric::STATUS_BAR_H).unwrap()..strip_top)
            .filter(|y| (bar_x..bar_x + bar_w).all(|x| frame[y * stride + x] == flipper_ui::Gray8(0)))
            .collect()
    };
    let lines = |n: usize| {
        slint::ModelRc::new(slint::VecModel::from(
            (0..n)
                .map(|i| slint::SharedString::from(format!("seq {i}")))
                .collect::<Vec<_>>(),
        ))
    };

    // Fits: no bar.
    screen.set_app_lines(lines(7));
    screen.set_app_log_total(7);
    screen.set_app_log_offset(0);
    slint::platform::update_timers_and_animations();
    let fits = render_frame(&window).expect("frame");
    assert!(
        thumb_rows(&fits).is_empty(),
        "no scrollbar when everything fits"
    );

    // Overflows, at the top: a thumb, high up.
    screen.set_app_lines(lines(8));
    screen.set_app_log_total(50);
    screen.set_app_log_offset(0);
    slint::platform::update_timers_and_animations();
    let top = thumb_rows(&render_frame(&window).expect("frame"));
    assert!(!top.is_empty(), "a deeper buffer must show a scrollbar");

    // Same buffer, scrolled to the end: the thumb moves down.
    screen.set_app_log_offset(42);
    slint::platform::update_timers_and_animations();
    let bottom = thumb_rows(&render_frame(&window).expect("frame"));
    assert!(!bottom.is_empty(), "still a scrollbar at the bottom");
    assert!(
        bottom[0] > top[0],
        "the thumb must track the offset: top started at {}, bottom at {}",
        top[0],
        bottom[0]
    );
    // And it stays inside the log area, clear of the status bar and the buttons.
    for rows in [&top, &bottom] {
        assert!(
            rows[0] >= usize::try_from(theme::metric::STATUS_BAR_H).unwrap()
                && *rows.last().unwrap() < strip_top,
            "the thumb must stay between the status bar and the strip: {rows:?}"
        );
    }
}

/// A submenu on screen: five rows, a breadcrumb, and a toggle in the first row.
fn submenu_screen(screen: &Root, selected: i32) {
    let items: Vec<ListItem> = [
        ("Airplane mode", "< OFF >", 9, 10),
        ("Routing info", "", 10, 1),
        ("5G Modem", "", 11, 1),
        ("Wi-Fi", "not connected", 12, 1),
        ("Ethernet", "", 13, 1),
    ]
    .iter()
    .map(|(label, status, icon, frames)| item(label, status, *icon, *frames))
    .collect();
    screen.set_total(items.len() as i32);
    screen.set_items(slint::ModelRc::new(slint::VecModel::from(items)));
    screen.set_selected(selected);
    screen.set_real_frame(true);
    screen.set_battery(87);
    screen.set_breadcrumb("> Network".into());
    screen.set_screen(Screen::Menu);
}

const BAR_H: usize = theme::metric::STATUS_BAR_H as usize;
const SUB_TOP: usize = theme::metric::SUBMENU_CONTAINER_Y as usize;
const ROW_H: usize = theme::metric::MENU_LINE_H as usize;

/// The breadcrumb occupies the band between the status bar and the list, in the
/// divider tone, starting at x4.
///
/// submenu.js puts it at (breadcrumbX 4, breadcrumbY STATUS_BAR_H + 2) in
/// #CCCCCC. A breadcrumb in black, or one overlapping either neighbour, means the
/// submenu anchor and the main menu's have been confused.
#[test]
fn breadcrumb_sits_between_bar_and_list() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().unwrap();
    screen.show().unwrap();
    submenu_screen(&screen, 0);
    let frame = render_frame(&window).unwrap();
    let stride = usize::from(theme::PANEL_W);

    // The selector is drawn one pixel above the container (selector_y_offset), so
    // its top edge lands on the band's last row and is not breadcrumb ink.
    let band_end = (SUB_TOP as i32 + theme::metric::SELECTOR_Y_OFFSET) as usize;
    let mut inked = Vec::new();
    for y in BAR_H..band_end {
        for x in 0..stride {
            let v = frame[y * stride + x].0;
            if v != 255 {
                inked.push((x, y, v));
            }
        }
    }
    assert!(!inked.is_empty(), "the breadcrumb drew nothing");
    // Every pixel of it is the divider tone: the trail is dim, not ink.
    let dim = theme::color::DIVIDER.0;
    for (x, y, v) in &inked {
        assert_eq!(*v, dim, "breadcrumb pixel at ({x},{y}) is {v}, not {dim}");
    }
    assert_eq!(
        inked.iter().map(|(x, _, _)| *x).min().unwrap(),
        theme::metric::BREADCRUMB_X as usize,
        "the trail must start at breadcrumb_x"
    );
}

/// A submenu's rows sit 3px below a main menu's.
///
/// The main menu anchors at 25 and a submenu at 28, because the breadcrumb needs
/// the band in between. Reusing the main menu's constant shifts every row.
#[test]
fn submenu_rows_sit_below_the_main_menu() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().unwrap();
    screen.show().unwrap();
    submenu_screen(&screen, 0);
    let frame = render_frame(&window).unwrap();
    let stride = usize::from(theme::PANEL_W);

    // Dividers fall one pixel above each row after the first. The one above row 1
    // is covered by the selector while row 0 is selected, as it is in the
    // prototype, so the first visible divider belongs to row 2.
    let dim = theme::color::DIVIDER.0;
    let found: Vec<usize> = (SUB_TOP..usize::from(theme::PANEL_H))
        .filter(|y| (0..stride).filter(|x| frame[y * stride + x].0 == dim).count() > 100)
        .collect();
    let expected: Vec<usize> = (2..5).map(|i| SUB_TOP + i * (ROW_H + 1) - 1).collect();
    assert_eq!(found, expected, "divider rows moved");
}

/// Columns holding ink in the selected row, right of the label.
fn status_columns(frame: &[flipper_ui::Gray8], row: usize, threshold: u8) -> Vec<usize> {
    let stride = usize::from(theme::PANEL_W);
    let top = SUB_TOP + row * (ROW_H + 1);
    // Stop short of the selector's right edge and corner stairs, which are ink but
    // not status: with no scrollbar the frame runs to x250.
    (140..246)
        .filter(|x| (top..top + ROW_H).any(|y| frame[y * stride + x].0 < threshold))
        .collect()
}

/// The chevrons of a `< ON >` status hold still when the value changes width.
///
/// MenuLine.js measures the middle slot from "OFF" whichever value is showing and
/// centres the value inside it, so ON (15px) and OFF (21px) leave both chevrons
/// where they are. Measuring the value itself is the bug this pins: it would move
/// both chevrons by 3px every time the toggle flipped.
#[test]
fn toggle_chevrons_do_not_move_with_the_value() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().unwrap();
    screen.show().unwrap();

    let mut ends = |status: &str| -> (usize, usize) {
        submenu_screen(&screen, 0);
        screen.set_items(slint::ModelRc::new(slint::VecModel::from(vec![item(
            "Airplane mode",
            status,
            9,
            10,
        )])));
        screen.set_total(1);
        let frame = render_frame(&window).unwrap();
        let cols = status_columns(&frame, 0, 64);
        (*cols.first().unwrap(), *cols.last().unwrap())
    };

    let off = ends("< OFF >");
    let on = ends("< ON >");
    assert_eq!(off, on, "the chevrons moved when the value changed width");
    // And they land where MenuLine.js's arithmetic puts them: the row is 224 wide
    // at x5, '>' sits against x224 - status_pad_r, and '<' is
    // spacing + textWidth("OFF") + spacing further left.
    assert_eq!(off.0, 165, "left chevron starts");
    assert_eq!(off.1, 223, "right chevron ends");
}

/// An unfocused toggle shows the bare value, right-aligned, with no chevrons.
///
/// The arrows are an affordance for left and right, which act on the focused row
/// only, so drawing them on every row would promise input that does nothing.
#[test]
fn unfocused_toggle_drops_its_chevrons() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().unwrap();
    screen.show().unwrap();
    // Row 0 is the toggle; select row 1 so it is not focused.
    submenu_screen(&screen, 1);
    let frame = render_frame(&window).unwrap();

    // Unfocused status is the dim tone, so anything not white counts.
    let cols = status_columns(&frame, 0, 255);
    let (first, last) = (*cols.first().unwrap(), *cols.last().unwrap());
    assert_eq!(last, 223, "the value must be flush with status_pad_r");
    assert_eq!(last - first + 1, 21, "only \"OFF\" should be drawn, 21px wide");
}

/// An adjustable value's chevrons hug it, unlike a toggle's.
///
/// MenuLine.js has two layouts and they differ in more than spacing: the ON/OFF
/// toggle gets a fixed slot measured from "OFF" with 15px gaps, while any other
/// bracketed value is measured directly with 6px gaps. Using the toggle's geometry
/// for a value leaves a visible hole either side of short values like "5".
#[test]
fn an_adjustable_value_uses_the_tighter_spacing() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().unwrap();
    screen.show().unwrap();

    let ends = |status: &str| -> (usize, usize) {
        submenu_screen(&screen, 0);
        screen.set_items(slint::ModelRc::new(slint::VecModel::from(vec![item(
            "Count", status, 0, 1,
        )])));
        screen.set_total(1);
        let frame = render_frame(&window).unwrap();
        let cols = status_columns(&frame, 0, 64);
        (*cols.first().unwrap(), *cols.last().unwrap())
    };

    // Both end flush against status_pad_r, so only the left edge moves.
    let (toggle_left, toggle_right) = ends("< OFF >");
    let (value_left, value_right) = ends("< 5 >");
    assert_eq!(toggle_right, value_right, "both are right-aligned");
    assert!(
        value_left > toggle_left,
        "a measured value should start further right than the toggle's fixed slot: \
         value at {value_left}, toggle at {toggle_left}"
    );

    // "5" is 6px wide and each chevron 4px, with 6px gaps:
    // 4 + 6 + 6 + 6 + 4 = 26px from the left chevron to the right one.
    assert_eq!(value_right - value_left + 1, 26, "value layout width");
}

/// A value at the end of its range loses that chevron, and only that chevron.
///
/// The value must not move when an arrow is suppressed: the prototype hides the
/// glyph and leaves the layout alone, so the number stays put as you hold a key
/// into the stop.
#[test]
fn a_value_at_its_limit_drops_one_chevron() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().unwrap();
    screen.show().unwrap();

    let value_cols = |at_start: bool, at_end: bool| -> Vec<usize> {
        submenu_screen(&screen, 0);
        let mut row = item("Count", "< 5 >", 0, 1);
        row.at_start = at_start;
        row.at_end = at_end;
        screen.set_items(slint::ModelRc::new(slint::VecModel::from(vec![row])));
        screen.set_total(1);
        let frame = render_frame(&window).unwrap();
        status_columns(&frame, 0, 64)
    };

    let both = value_cols(false, false);
    let no_left = value_cols(true, false);
    let no_right = value_cols(false, true);

    // Suppressing the left chevron removes ink from the left end only.
    assert!(
        no_left.first() > both.first(),
        "the left chevron should be gone"
    );
    assert_eq!(no_left.last(), both.last(), "the right chevron stays");
    assert_eq!(no_right.first(), both.first(), "the left chevron stays");
    assert!(
        no_right.last() < both.last(),
        "the right chevron should be gone"
    );

    // And the value itself has not moved: its columns are a subset of the
    // both-chevrons render in every case.
    for cols in [&no_left, &no_right] {
        for c in cols.iter() {
            assert!(both.contains(c), "column {c} appeared when a chevron was hidden");
        }
    }
}
