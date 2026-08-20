//! The detail screen's gauge rows, rendered.
//!
//! A gauge shares its row with a label, and the bar used to start in a fixed
//! column that a long label ran straight into. The check is on real pixels: find
//! the bar's own border, then look for ink to the left of it. A structural
//! argument about the layout would have passed while the screen was wrong.

#![cfg(feature = "slint")]

use flipper_ui::slint_render::{render_frame, FlipperSlintPlatform};
use flipper_ui::theme::{self, metric};
use flipper_ui::ui::{DetailRow, Root, Screen};
use slint::ComponentHandle;

/// Where the bar in row `index` starts, read off the rendered frame.
///
/// A bar is the longest horizontal run of ink in the row's band: the label is
/// glyphs with gaps, the bar's border is one unbroken line. Reading the pixels
/// rather than the properties is the point, since the bug was in what got drawn.
fn bar_column(frame: &[flipper_ui::pixel::Gray8], index: usize) -> i32 {
    let w = usize::from(theme::PANEL_W);
    // Anything that is not the white ground: a dim gauge draws in the grey tone,
    // and a threshold at black would not find its bar at all.
    let inked = |x: usize, y: usize| frame[y * w + x].0 < 0xd0;
    let top = usize::from(metric::SUBMENU_CONTAINER_Y as u16)
        + index * usize::from(metric::ITEM_H as u16);

    let (x, run) = (top..top + usize::from(metric::ITEM_H as u16))
        .map(|y| {
            let mut best = (0usize, 0usize);
            let mut start = None;
            for x in 0..=w {
                match (x < w && inked(x, y), start) {
                    (true, None) => start = Some(x),
                    (false, Some(s)) => {
                        if x - s > best.1 {
                            best = (s, x - s);
                        }
                        start = None;
                    }
                    _ => {}
                }
            }
            best
        })
        .max_by_key(|(_, run)| *run)
        .expect("the band has rows");

    assert!(run > 20, "row {index}: no bar, longest run was {run}px");
    x as i32
}

/// True if anything is inked in the column `x` within row `index`.
fn ink_in_column(frame: &[flipper_ui::pixel::Gray8], index: usize, x: usize) -> bool {
    let w = usize::from(theme::PANEL_W);
    let top = usize::from(metric::SUBMENU_CONTAINER_Y as u16)
        + index * usize::from(metric::ITEM_H as u16);
    (top..top + usize::from(metric::ITEM_H as u16)).any(|y| frame[y * w + x].0 < 0xd0)
}

fn row(kind: i32, label: &str, value: &str, percent: i32) -> DetailRow {
    DetailRow {
        kind,
        label: label.into(),
        value: value.into(),
        percent,
        dim: false,
    }
}

/// Gauges an app might send: a word, a long sentence, and none at all. Each bar
/// clears its own label, so the three start in three different columns.
fn gauge_rows() -> Vec<DetailRow> {
    vec![
        row(3, "Running  21% of two jobs", "", 0),
        row(1, "", "", 0),
        row(2, "Download", "", 42),
        row(2, "Download progress bar with long text", "", 42),
        row(2, "", "", 42),
        row(1, "", "", 0),
        row(0, "Elapsed", "12.4s", 0),
    ]
}

#[test]
fn a_gauge_bar_starts_clear_of_its_label() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().expect("create Root");

    let rows = gauge_rows();
    // An app's scene, which is the only kind that sizes its gauges.
    screen.set_screen(Screen::AppDetail);
    screen.set_breadcrumb("> Progress".into());
    screen.set_detail_rows(slint::ModelRc::new(slint::VecModel::from(rows.clone())));
    screen.set_detail_offset(0);
    screen.show().expect("show");
    slint::platform::update_timers_and_animations();

    let frame = render_frame(&window).expect("a fresh screen always paints");

    let mut columns = Vec::new();
    for (i, r) in rows.iter().enumerate() {
        if r.kind != 2 {
            continue;
        }
        // Each bar clears its own label, so the column is this row's business.
        let expected = metric::MARGIN_H
            + flipper_ui::layout::gauge_col_fit(flipper_ui::font::ROW.text_width(r.label.as_str()));
        columns.push(expected);

        assert_eq!(
            bar_column(&frame, i),
            expected,
            "{}: bar is not where the arithmetic puts it",
            r.label
        );
        // Nothing of the label may reach the bar: the pixel column before it is
        // the gap, so ink there means the two are touching.
        if expected > metric::MARGIN_H {
            assert!(
                !ink_in_column(&frame, i, expected as usize - 1),
                "{}: label ink touches the bar at {expected}",
                r.label
            );
        }
    }

    // The long label really does push its own bar right, and only its own: an
    // unlabelled gauge stays in the minimum column beside a short-labelled one.
    assert_eq!(columns.len(), 3);
    assert!(
        columns[1] > columns[0],
        "the long label should move its bar: {columns:?}"
    );
    assert_eq!(
        columns[2], metric::MARGIN_H,
        "an unlabelled gauge has nothing to clear and takes the whole line"
    );
}

/// A sized column is the wider of the fixed column and what the label needs.
#[test]
fn a_sized_gauge_column_clears_its_label() {
    // A short percentage fits the fixed column, so an app labelling its gauge the
    // way the battery screen does lines up with it.
    let pct = flipper_ui::font::ROW.text_width("99%");
    assert_eq!(flipper_ui::layout::gauge_col_fit(pct), metric::GAUGE_COL);

    // "100%" does not fit, and a sized gauge moves rather than overlapping: 2px,
    // once, as the reading tops out. An app that wants the bar to hold still pads
    // the label to a fixed width, which is the app's call to make. A first-party
    // screen never moves, which is what the fixed column is for.
    let full = flipper_ui::font::ROW.text_width("100%");
    assert_eq!(
        flipper_ui::layout::gauge_col_fit(full),
        i32::from(full) + metric::GAUGE_LABEL_GAP
    );

    // No label, no column: the bar starts at the margin.
    assert_eq!(flipper_ui::layout::gauge_col_fit(0), 0);

    // A word does not fit, and pushes the bar right by its own width plus the gap.
    let word = flipper_ui::font::ROW.text_width("Download");
    assert_eq!(
        flipper_ui::layout::gauge_col_fit(word),
        i32::from(word) + metric::GAUGE_LABEL_GAP
    );
    assert!(
        i32::from(word) + metric::GAUGE_LABEL_GAP > metric::GAUGE_COL,
        "the test is pointless if the word fits the fixed column"
    );
}

/// A first-party screen pins its gauges to the approved column whatever the
/// label says. This is the regression that mattered: sizing them moved the
/// battery and disk bars two pixels, on screens that are fixed geometry.
#[test]
fn a_first_party_gauge_sits_in_the_approved_column() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().expect("create Root");

    // The battery screen's shape: a status row, its gauge, a divider.
    for label in ["0%", "100%"] {
        let rows = vec![
            row(0, "Discharging", "3h left", 0),
            row(2, label, "", 61),
            row(1, "", "", 0),
        ];
        screen.set_screen(Screen::Detail);
        screen.set_breadcrumb("> Battery info".into());
        screen.set_detail_rows(slint::ModelRc::new(slint::VecModel::from(rows)));
        screen.set_detail_offset(0);
        screen.show().expect("show");
        slint::platform::update_timers_and_animations();

        let frame = render_frame(&window).expect("a fresh screen always paints");
        let bar = bar_column(&frame, 1);
        assert_eq!(
            bar,
            metric::MARGIN_H + metric::GAUGE_COL,
            "gauge labelled {label} moved off the approved column"
        );
    }
}

/// A dim row dims all of it. The label already did; the bar was drawn in ink
/// whatever the row said, so a dim gauge read as a black bar under a grey label.
#[test]
fn a_dim_gauge_draws_in_the_dim_tone() {
    let window = FlipperSlintPlatform::install();
    let screen = Root::new().expect("create Root");

    let rows = vec![
        row(2, "Download", "", 60),
        DetailRow { dim: true, ..row(2, "Verify", "", 60) },
    ];
    screen.set_screen(Screen::AppDetail);
    screen.set_detail_rows(slint::ModelRc::new(slint::VecModel::from(rows)));
    screen.set_detail_offset(0);
    screen.show().expect("show");
    slint::platform::update_timers_and_animations();

    let frame = render_frame(&window).expect("a fresh screen always paints");
    let w = usize::from(theme::PANEL_W);
    let tone = |index: usize| {
        let x = bar_column(&frame, index) as usize + 4;
        let top = usize::from(metric::SUBMENU_CONTAINER_Y as u16)
            + index * usize::from(metric::ITEM_H as u16);
        // The border's own row: the fill sits inside it and the value is the same
        // tone either way, so the border is the honest sample.
        (top..top + usize::from(metric::ITEM_H as u16))
            .map(|y| frame[y * w + x].0)
            .min()
            .expect("the band has rows")
    };

    assert_eq!(tone(0), 0x00, "an ordinary gauge is ink");
    assert_eq!(
        tone(1),
        theme::color::STATUS_DIM.0,
        "a dim gauge is the dim tone"
    );
}
