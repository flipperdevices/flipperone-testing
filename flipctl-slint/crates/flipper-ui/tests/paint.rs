//! Primitive geometry, pinned against the prototype.
//!
//! `paint.rs` is the oracle the Slint components are checked against, so its
//! output has to match fake-flipctl2 pixel for pixel.

use flipper_ui::paint::Corners;
use flipper_ui::pixel::Gray8;
use flipper_ui::Surface;

const INK: Gray8 = Gray8::BLACK;

/// Render a region as a string, `#` for ink and `.` for ground.
fn region(s: &Surface, x0: u16, y0: u16, w: u16, h: u16) -> Vec<String> {
    (0..h)
        .map(|r| {
            (0..w)
                .map(|c| if s.get(x0 + c, y0 + r) == INK { '#' } else { '.' })
                .collect()
        })
        .collect()
}

/// The single corner rule must reproduce MenuSelectorFrame's r = 3 corner.
///
/// canvas.js carried two different corner tables for the same radius. They were
/// collapsed onto the 45-degree diagonal, which has to be output-preserving for
/// the selector or the most repeated element on the device silently changes.
#[test]
fn selector_corner_is_a_contiguous_diagonal() {
    let mut s = Surface::panel();
    s.clear(Gray8::WHITE);
    s.selector_frame(0, 0, 40, 22, 3, Corners::default(), None, INK);

    assert_eq!(
        region(&s, 0, 0, 6, 6),
        [
            "..####",
            ".#....",
            "#.....",
            "#.....",
            "#.....",
            "#.....",
        ],
        "top-left corner"
    );
}

/// The r = 4 soft-button stair is the same rule at a different radius: the fill
/// steps in 3, 2, 1, 0 over the first four rows.
#[test]
fn soft_button_stair_is_the_same_rule_at_r4() {
    let mut s = Surface::panel();
    s.clear(Gray8::WHITE);
    s.round_rect(0, 0, 20, 14, 4, INK);

    assert_eq!(
        region(&s, 0, 0, 6, 6),
        [
            "...###",
            "..####",
            ".#####",
            "######",
            "######",
            "######",
        ],
        "filled r=4 corner steps in 3, 2, 1, 0"
    );
}

/// The drop shadow lies outside the frame, one row below and one column right.
/// This is the part `border-radius` cannot express, so it gets its own test.
#[test]
fn selector_frame_has_a_drop_shadow_outside_its_bounds() {
    let (w, h, r) = (40u16, 22u16, 3);
    let mut s = Surface::panel();
    s.clear(Gray8::WHITE);
    s.selector_frame(0, 0, i32::from(w), i32::from(h), r, Corners::default(), None, INK);

    for x in u16::from(r as u16)..w - r as u16 {
        assert_eq!(s.get(x, h), INK, "shadow row missing at x={x}, y={h}");
    }
    for y in u16::from(r as u16)..h - r as u16 {
        assert_eq!(s.get(w, y), INK, "shadow column missing at x={w}, y={y}");
    }
    assert_eq!(s.get(w - 2, h - 1), INK, "bottom-right weight pixel");
    assert_eq!(s.get(w - 1, h - 2), INK, "bottom-right weight pixel");
}

/// Every primitive clips, so a caller may lay out partially off-screen content
/// without guarding each call. A panic here would show up as a crash the first
/// time a list scrolled.
#[test]
fn primitives_clip_instead_of_panicking() {
    let mut s = Surface::panel();
    s.clear(Gray8::WHITE);
    s.rect(-50, -50, 30, 30, INK);
    s.rect(250, 140, 40, 40, INK);
    s.round_frame(-5, -5, 300, 200, 3, INK);
    s.text(&flipper_ui::font::TITLE, "off the edge", -20, 138, INK);
    s.selector_frame(-4, 138, 300, 22, 3, Corners::default(), None, INK);
    assert_eq!(s.get(255, 143), INK, "the bottom-right corner was reachable");
}
