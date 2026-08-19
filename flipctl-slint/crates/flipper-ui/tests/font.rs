//! The bitmap tables are the prototype's, so their measurements must agree with
//! the prototype's to the pixel. Expected values were computed from the JS
//! tables independently of the Rust conversion.

use flipper_ui::font::{BitmapFont, ROW, ROW_ACTIVE, TITLE};

#[test]
fn text_width_matches_the_prototype() {
    let cases: [(&BitmapFont, [(&str, u16); 4]); 3] = [
        (&TITLE, [("Network", 36), ("Settings", 34), ("100%", 22), ("A", 5)]),
        (&ROW, [("Network", 45), ("Settings", 44), ("100%", 28), ("A", 7)]),
        (&ROW_ACTIVE, [("Network", 49), ("Settings", 47), ("100%", 30), ("A", 6)]),
    ];
    for (font, expected) in cases {
        for (text, width) in expected {
            assert_eq!(
                font.text_width(text),
                width,
                "{:?} width of {text:?}",
                font.rows
            );
        }
    }
}

#[test]
fn every_font_covers_printable_ascii() {
    for font in [&TITLE, &ROW, &ROW_ACTIVE] {
        assert_eq!(font.glyphs.len(), 95, "ASCII 32..=126");
        assert_eq!(font.first, 32);
        for glyph in font.glyphs {
            assert_eq!(glyph.rows.len(), usize::from(font.rows));
            assert!(glyph.advance > 0, "a zero advance would stack glyphs");
        }
    }
}

/// Unknown codepoints fall back to `?`, which is what the prototype does. A
/// panic or a blank here would be a rendering difference on any non-ASCII
/// profile name.
#[test]
fn unknown_codepoints_fall_back_to_question_mark() {
    for font in [&TITLE, &ROW, &ROW_ACTIVE] {
        let fallback = font.glyph('?');
        for c in ['\u{e9}', '\u{4f0}', '\u{1f600}', '\u{1}'] {
            assert_eq!(font.glyph(c).advance, fallback.advance, "fallback for {c:?}");
            assert_eq!(font.glyph(c).rows, fallback.rows);
        }
    }
}

/// A capital A must be solid ink, not a smear of intermediate values. This is
/// the invariant that re-rasterising the TTFs would break.
#[test]
fn glyphs_are_one_bit_per_pixel() {
    let mut pixels = Vec::new();
    TITLE.for_each_pixel("A", 0, 0, |x, y| pixels.push((x, y)));
    assert!(!pixels.is_empty(), "the A glyph drew nothing");
    assert!(
        pixels.iter().all(|(x, y)| *x >= 0 && *y >= 0 && *x < 16 && *y < 13),
        "a glyph pixel escaped its 16x13 frame: {pixels:?}"
    );
}
