//! Layout arithmetic shared between the Rust side and the tests.
//!
//! The .slint components mirror these rules inline; the tests here are what stop
//! the two drifting.

use crate::theme::metric;
use crate::FlipperKey;

/// Left edge of bottom-bar slot `slot`, counting from 0.
///
/// A uniform grid, because the approved geometry adds up: 5 * 48 + 4 * 4 = 256,
/// so both outer edges land flush without special-casing either end.
///
/// ```text
///  0..47   52..99   104..151   156..203   208..255
/// ```
///
/// canvas.js did special-case it, tiling from the left with a 2px gap and then
/// anchoring the right button at `screenW - w`, which left a 10px hole before the
/// last slot. The approved design removes that asymmetry.
pub fn soft_slot_x(slot: usize) -> i32 {
    slot as i32 * (metric::BUTTON_W + metric::BUTTON_GAP)
}

/// Whether slot `slot` runs to a screen edge, and so drops the chamfer and the
/// vertical border on that side.
///
/// Measured from the design export: slot 0 carries a border only on its right and
/// its top edge starts at x0; slot 4 carries one only on its left and its top edge
/// runs to x255.
pub fn soft_slot_flush(slot: usize) -> (bool, bool) {
    let last = FlipperKey::SOFT_ROW.len() - 1;
    (slot == 0, slot == last)
}

/// Total width the slots occupy. Equal to the panel width by construction; the
/// test asserts it so a change to either token cannot silently break the fit.
pub fn soft_row_width() -> i32 {
    let n = FlipperKey::SOFT_ROW.len() as i32;
    n * metric::BUTTON_W + (n - 1) * metric::BUTTON_GAP
}
