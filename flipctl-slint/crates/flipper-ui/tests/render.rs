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
    .map(|(label, status, icon, frames)| ListItem {
        label: (*label).into(),
        status: (*status).into(),
        icon: *icon,
        frames: *frames,
    })
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
