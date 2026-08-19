//! Bitmap fonts.
//!
//! The three fonts are the prototype's packed 1bpp tables, converted verbatim by
//! tools/js-font-to-rust.py. They were generated from the flipctl-fonts TTFs
//! with a hard threshold, and "everything renders on pixel boundaries, no
//! antialiasing" is a stated invariant of the design, so the tables are the
//! contract rather than the TTFs.
//!
//! Advance width is per glyph, so text width is a sum and never a
//! multiplication. Codepoints outside ASCII 32..=126 render as `?`, matching the
//! prototype.

/// One glyph. `rows` is `BitmapFont::rows` long; within a row, bit
/// `cols - 1 - col` is the pixel at `col`.
pub struct Glyph {
    pub advance: u8,
    pub rows: &'static [u16],
}

pub struct BitmapFont {
    pub rows: u8,
    pub cols: u8,
    /// Codepoint of `glyphs[0]`.
    pub first: u8,
    pub glyphs: &'static [Glyph],
}

const FALLBACK: u8 = b'?';

impl BitmapFont {
    pub fn glyph(&self, c: char) -> &Glyph {
        let code = u32::from(c);
        let index = code
            .checked_sub(u32::from(self.first))
            .filter(|i| (*i as usize) < self.glyphs.len())
            .unwrap_or(u32::from(FALLBACK - self.first));
        &self.glyphs[index as usize]
    }

    /// Width of `text` in pixels.
    ///
    /// The prototype sums the advances and subtracts one, because each advance
    /// includes a trailing spacing column that the last glyph does not need.
    /// Reproduced exactly: status-bar right alignment depends on it.
    pub fn text_width(&self, text: &str) -> u16 {
        let sum: u16 = text.chars().map(|c| u16::from(self.glyph(c).advance)).sum();
        sum.saturating_sub(1)
    }

    /// Visit every set pixel of `text` drawn with its top-left at `(x, y)`.
    ///
    /// Coordinates may fall outside the panel; clipping belongs to the caller so
    /// this stays allocation-free and usable for measurement.
    pub fn for_each_pixel(&self, text: &str, x: i32, y: i32, mut plot: impl FnMut(i32, i32)) {
        let mut cx = x;
        for c in text.chars() {
            let glyph = self.glyph(c);
            for (row, bits) in glyph.rows.iter().enumerate() {
                if *bits == 0 {
                    continue;
                }
                for col in 0..self.cols {
                    if bits & (1 << (self.cols - 1 - col)) != 0 {
                        plot(cx + i32::from(col), y + row as i32);
                    }
                }
            }
            cx += i32::from(glyph.advance);
        }
    }
}

include!("font/title.rs");
include!("font/row.rs");
include!("font/row_active.rs");
