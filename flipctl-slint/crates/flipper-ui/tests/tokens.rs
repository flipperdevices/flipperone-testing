//! Invariants on the generated theme. These are the tests that stop the design
//! system drifting away from what the panel can actually display.

use flipper_ui::pixel::Gray8;
use flipper_ui::theme;

/// The panel is 8-bit greyscale. A token whose channels differ would be
/// silently shifted by drm_fb_xrgb8888_to_gray8, so the value a designer picked
/// and the value on glass would not match. Reject non-greys at build time
/// instead of discovering it on a device.
#[test]
fn every_colour_is_a_pure_grey() {
    for (name, hex, r, g, b) in theme::ALL_COLORS {
        assert!(
            r == g && g == b,
            "token `{name}` = {hex} is not a pure grey ({r}, {g}, {b}); \
             the panel is 8-bit greyscale and would shift it"
        );
    }
}

/// A token must survive the trip to the dumb buffer and back byte-identically.
#[test]
fn colours_round_trip_through_xrgb8888() {
    for (name, hex, r, g, b) in theme::ALL_COLORS {
        let grey = Gray8::from_rgb(r, g, b);
        assert_eq!(
            grey.0, r,
            "token `{name}` = {hex} does not survive the luma conversion"
        );

        let word = grey.to_xrgb8888();
        let back = Gray8::from_rgb(
            ((word >> 16) & 0xff) as u8,
            ((word >> 8) & 0xff) as u8,
            (word & 0xff) as u8,
        );
        assert_eq!(back, grey, "token `{name}` = {hex} does not round-trip");
    }
}

/// Fractional layout is not representable on this panel. Every spacing value is
/// an integer pixel count and build.rs already refuses anything else; this
/// pins the sign conventions we do allow.
#[test]
fn metrics_are_sane_pixel_counts() {
    for (name, value) in theme::ALL_METRIC {
        assert!(
            value > -32 && value < 512,
            "metric `{name}` = {value} is not a plausible pixel count for a 256x144 panel"
        );
    }
    for (name, value) in theme::ALL_RADIUS {
        // drawRoundRect implements 2, 3 and 4 only, and every shape it draws is
        // limited to those. ResponsiveFrame generates its corners for any radius,
        // and the boot menu's popup is the one shape that uses it, at 5.
        let allowed: &[i32] = if name == "popup" { &[5] } else { &[0, 2, 3, 4] };
        assert!(
            allowed.contains(&value),
            "radius `{name}` = {value}, expected one of {allowed:?}"
        );
    }
    for (name, value) in theme::ALL_TIMING {
        assert!(value > 0, "timing `{name}` = {value} must be positive");
    }
}

/// Both generated files come from one parse, so a token can only be missing
/// from one of them if the generator itself is wrong. Check anyway: this is the
/// test that catches a future split into two generators.
#[test]
fn rust_and_slint_themes_declare_the_same_tokens() {
    let slint = include_str!(concat!(env!("OUT_DIR"), "/theme.slint"));

    for (name, ..) in theme::ALL_COLORS {
        assert!(
            slint.contains(&format!(" {name}: ")),
            "colour `{name}` is in the Rust theme but not the Slint theme"
        );
    }
    for (name, _) in theme::ALL_METRIC {
        assert!(
            slint.contains(&format!(" {name}: ")),
            "metric `{name}` is in the Rust theme but not the Slint theme"
        );
    }
    for (name, _) in theme::ALL_TIMING {
        assert!(
            slint.contains(&format!(" {name}: ")),
            "timing `{name}` is in the Rust theme but not the Slint theme"
        );
    }
}

/// The panel geometry is fixed in the driver: DRM_MODE_INIT(60, 256, 144, ...)
/// with min == max width and height, so there is no mode to negotiate.
#[test]
fn panel_geometry_matches_the_driver() {
    assert_eq!((theme::PANEL_W, theme::PANEL_H), (256, 144));
}

/// The bottom row reads esc, view, power, edit, run left to right on the
/// hardware, and the kernel driver's keycodes must line up with that order.
/// fake-flipctl2's input.js disagrees on two keys and is not the authority.
#[test]
fn soft_key_row_matches_the_hardware_order() {
    use flipper_ui::FlipperKey;

    let names: Vec<&str> = FlipperKey::SOFT_ROW.iter().map(|k| k.name()).collect();
    assert_eq!(names, ["esc", "view", "power", "edit", "run"]);

    // KEY_Z, KEY_X, KEY_C, KEY_V, KEY_B in that order, per flipper-one-input.c.
    let codes = [44u16, 45, 46, 47, 48];
    for (code, expected) in codes.iter().zip(FlipperKey::SOFT_ROW) {
        assert_eq!(
            FlipperKey::from_evdev(*code),
            Some(expected),
            "keycode {code} should be {}",
            expected.name()
        );
    }
}

/// Names are the remote view's wire format, so they must round-trip and be
/// unique.
#[test]
fn key_names_round_trip() {
    use flipper_ui::FlipperKey;

    let mut seen = std::collections::HashSet::new();
    for key in FlipperKey::ALL {
        assert!(seen.insert(key.name()), "duplicate key name {}", key.name());
        assert_eq!(FlipperKey::from_name(key.name()), Some(key));
    }
    assert_eq!(FlipperKey::from_name("del"), None, "there is no Del key");
}

/// The bottom bar has one slot per physical soft key, and slot `i` labels
/// `SOFT_ROW[i]`. A buttons model of any other length would silently shift every
/// label away from the key underneath it, which is exactly the defect this pins:
/// a "Menu" label sat over the `view` key while the handler answered only `ok`
/// and `run`, so pressing the labelled key did nothing.
#[test]
fn the_button_bar_has_one_slot_per_soft_key() {
    use flipper_ui::layout::{soft_row_width, soft_slot_x};
    use flipper_ui::theme::metric;
    use flipper_ui::FlipperKey;

    let slots = FlipperKey::SOFT_ROW.len() as i32;
    assert_eq!(slots, 5);

    // The approved geometry tiles evenly and fills the panel exactly, which is
    // what lets every button carry the same outline instead of the outer two
    // dropping their outer edge.
    assert_eq!(
        [0, 1, 2, 3, 4].map(soft_slot_x),
        [0, 52, 104, 156, 208],
        "slot left edges"
    );
    assert_eq!(
        soft_row_width(),
        i32::from(flipper_ui::PANEL_W),
        "{slots} slots of {}px with {}px gaps must fill the panel exactly",
        metric::BUTTON_W,
        metric::BUTTON_GAP
    );
    assert_eq!(
        soft_slot_x(4) + metric::BUTTON_W,
        i32::from(flipper_ui::PANEL_W),
        "the last slot must land flush with the right edge"
    );

}

/// The bottom strip is 17px, so the content area ends at y126 and the list has to
/// fit above it. Five 20px rows with four 1px dividers is 104px.
#[test]
fn the_list_fits_above_the_soft_button_strip() {
    use flipper_ui::theme::{count, metric};

    let rows = count::LIST_VISIBLE_ROWS;
    let viewport = rows * metric::MENU_LINE_H + (rows - 1);
    assert_eq!(viewport, metric::LIST_VIEWPORT_H, "{rows} rows plus dividers");

    let list_bottom = metric::LIST_CONTAINER_Y + viewport;
    let strip_top = i32::from(flipper_ui::PANEL_H) - metric::BUTTON_H;
    assert!(
        list_bottom <= strip_top,
        "the list ends at y{list_bottom} but the {}px strip starts at y{strip_top}",
        metric::BUTTON_H
    );

    // One blank row between the last item and the strip, as the device has it.
    // An earlier version of this test demanded the list use every available row,
    // which closed the gap and put every row a pixel below the device.
    assert_eq!(
        strip_top - list_bottom,
        1,
        "there should be exactly one blank row above the soft-button strip"
    );
}
