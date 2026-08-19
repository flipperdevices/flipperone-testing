//! The greyscale surface and its drawing primitives.
//!
//! This is the whole vocabulary the prototype draws with: filled and outlined
//! rectangles, three rounded-corner radii, single-pixel lines, glyph blits and
//! sprite blits. Reproduced pixel for pixel from fake-flipctl2's canvas.js,
//! including its corner-pixel tables, because the design's stated invariant is
//! "everything renders on pixel boundaries, no antialiasing".
//!
//! Coordinates are signed and every primitive clips, so callers may lay out
//! partially off-screen content (a scrolling viewport, a marquee) without
//! guarding every call.

use crate::pixel::{Gray8, Rect};
use crate::theme::{PANEL_H, PANEL_W};

/// A greyscale drawing surface with damage tracking.
pub struct Surface {
    pixels: Vec<Gray8>,
    w: u16,
    h: u16,
    damage: Rect,
}

impl Surface {
    /// A panel-sized surface, initially all white and fully damaged.
    pub fn panel() -> Self {
        Self::new(PANEL_W, PANEL_H)
    }

    pub fn new(w: u16, h: u16) -> Self {
        Self {
            pixels: vec![Gray8::WHITE; usize::from(w) * usize::from(h)],
            w,
            h,
            damage: Rect::new(0, 0, w, h),
        }
    }

    pub fn width(&self) -> u16 {
        self.w
    }

    pub fn height(&self) -> u16 {
        self.h
    }

    pub fn pixels(&self) -> &[Gray8] {
        &self.pixels
    }

    /// The region touched since the last `reset_damage`. Sinks commit this and
    /// then clear it.
    pub fn damage(&self) -> Rect {
        self.damage
    }

    pub fn reset_damage(&mut self) {
        self.damage = Rect::default();
    }

    pub fn get(&self, x: u16, y: u16) -> Gray8 {
        self.pixels[usize::from(y) * usize::from(self.w) + usize::from(x)]
    }

    #[inline]
    fn mark(&mut self, r: Rect) {
        self.damage = self.damage.union(r);
    }

    /// Clip a signed rectangle to the surface. Returns `None` when nothing of it
    /// lands on screen.
    fn clip(&self, x: i32, y: i32, w: i32, h: i32) -> Option<Rect> {
        if w <= 0 || h <= 0 {
            return None;
        }
        let x0 = x.max(0);
        let y0 = y.max(0);
        let x1 = (x + w).min(i32::from(self.w));
        let y1 = (y + h).min(i32::from(self.h));
        if x1 <= x0 || y1 <= y0 {
            return None;
        }
        Some(Rect::new(
            x0 as u16,
            y0 as u16,
            (x1 - x0) as u16,
            (y1 - y0) as u16,
        ))
    }

    pub fn clear(&mut self, colour: Gray8) {
        self.pixels.fill(colour);
        self.damage = Rect::new(0, 0, self.w, self.h);
    }

    pub fn pixel(&mut self, x: i32, y: i32, colour: Gray8) {
        self.rect(x, y, 1, 1, colour);
    }

    /// Filled rectangle.
    pub fn rect(&mut self, x: i32, y: i32, w: i32, h: i32, colour: Gray8) {
        let Some(r) = self.clip(x, y, w, h) else { return };
        let stride = usize::from(self.w);
        for row in r.y..r.y + r.h {
            let start = usize::from(row) * stride + usize::from(r.x);
            self.pixels[start..start + usize::from(r.w)].fill(colour);
        }
        self.mark(r);
    }

    /// One-pixel rectangle outline.
    pub fn frame(&mut self, x: i32, y: i32, w: i32, h: i32, colour: Gray8) {
        if w <= 0 || h <= 0 {
            return;
        }
        self.rect(x, y, w, 1, colour);
        self.rect(x, y + h - 1, w, 1, colour);
        self.rect(x, y + 1, 1, h - 2, colour);
        self.rect(x + w - 1, y + 1, 1, h - 2, colour);
    }

    pub fn hline(&mut self, x: i32, y: i32, w: i32, colour: Gray8) {
        self.rect(x, y, w, 1, colour);
    }

    pub fn vline(&mut self, x: i32, y: i32, h: i32, colour: Gray8) {
        self.rect(x, y, 1, h, colour);
    }

    /// A dotted vertical line, every other pixel. The scrollbar track.
    pub fn dotted_vline(&mut self, x: i32, y: i32, h: i32, colour: Gray8) {
        let mut i = 0;
        while i < h {
            self.pixel(x, y + i, colour);
            i += 2;
        }
    }

    /// Filled rounded rectangle.
    ///
    /// The corner is a straight 45-degree diagonal of `r` pixels. canvas.js had
    /// two different corner tables for the same radius; the diagonal is the one
    /// we standardised on, and it reproduces both the selector frame and the
    /// soft-button stair exactly.
    pub fn round_rect(&mut self, x: i32, y: i32, w: i32, h: i32, r: i32, colour: Gray8) {
        if r <= 0 || w <= 2 * r || h <= 2 * r {
            self.rect(x, y, w, h, colour);
            return;
        }
        // Body inside the chamfer, then the r chamfered rows at each end. Each
        // chamfered row steps in by one pixel, following the same diagonal as
        // the stroke, so cut corners are never painted.
        self.rect(x, y + r, w, h - 2 * r, colour);
        for i in 0..r {
            let inset = r - 1 - i;
            self.rect(x + inset, y + i, w - 2 * inset, 1, colour);
            self.rect(x + inset, y + h - 1 - i, w - 2 * inset, 1, colour);
        }
    }

    /// One-pixel rounded outline. Same 45-degree corner as `round_rect`.
    pub fn round_frame(&mut self, x: i32, y: i32, w: i32, h: i32, r: i32, colour: Gray8) {
        if r <= 0 || w <= 2 * r || h <= 2 * r {
            self.frame(x, y, w, h, colour);
            return;
        }
        self.rect(x + r, y, w - 2 * r, 1, colour);
        self.rect(x + r, y + h - 1, w - 2 * r, 1, colour);
        self.rect(x, y + r, 1, h - 2 * r, colour);
        self.rect(x + w - 1, y + r, 1, h - 2 * r, colour);
        for (dx, dy) in diagonal(r) {
            self.pixel(x + dx, y + dy, colour);
            self.pixel(x + w - 1 - dx, y + dy, colour);
            self.pixel(x + dx, y + h - 1 - dy, colour);
            self.pixel(x + w - 1 - dx, y + h - 1 - dy, colour);
        }
    }

    /// Composite `colour` over the whole surface at `alpha`. The modal scrim.
    pub fn scrim(&mut self, colour: Gray8, alpha: u8) {
        for p in &mut self.pixels {
            *p = p.blend(colour, alpha);
        }
        self.damage = Rect::new(0, 0, self.w, self.h);
    }

    /// Draw `text` with its glyph frames' top-left at `(x, y)`.
    pub fn text(&mut self, font: &crate::font::BitmapFont, text: &str, x: i32, y: i32, colour: Gray8) {
        let mut plots: Vec<(i32, i32)> = Vec::new();
        font.for_each_pixel(text, x, y, |px, py| plots.push((px, py)));
        for (px, py) in plots {
            self.pixel(px, py, colour);
        }
    }
}

/// The corner diagonal for radius `r`, relative to the top-left corner. Mirrored
/// by the caller for the other three corners.
///
/// One rule for every radius: pixel `i` sits at `(i, r - 1 - i)`. Combined with
/// straight edges that begin `r` pixels in, this is a contiguous 45-degree cut.
/// It reproduces MenuSelectorFrame at r = 3 and the soft-button stair at r = 4
/// with the same code, which is why the two corner tables canvas.js carried were
/// collapsed into it.
fn diagonal(r: i32) -> impl Iterator<Item = (i32, i32)> {
    (0..r).map(move |i| (i, r - 1 - i))
}

/// Per-corner rounding flags, matching ResponsiveFrame's `corners` option.
#[derive(Copy, Clone, Debug)]
pub struct Corners {
    pub tl: bool,
    pub tr: bool,
    pub bl: bool,
    pub br: bool,
}

impl Default for Corners {
    fn default() -> Self {
        Self { tl: true, tr: true, bl: true, br: true }
    }
}

impl Surface {
    /// The menu selection frame.
    ///
    /// Not a rounded rectangle: corners are straight 45-degree stairs, each
    /// independently enabled, and the frame carries a drop shadow one row below
    /// and one column right of itself plus two hand-placed pixels weighting the
    /// bottom-right. `border-radius` cannot express any of that, which is why
    /// this is built from primitives.
    pub fn selector_frame(
        &mut self,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        r: i32,
        corners: Corners,
        fill: Option<Gray8>,
        stroke: Gray8,
    ) {
        let pick = |on: bool| if r > 0 && on { r } else { 0 };
        let (tl, tr, bl, br) = (
            pick(corners.tl),
            pick(corners.tr),
            pick(corners.bl),
            pick(corners.br),
        );

        // Body, row by row. Cut-corner pixels are never touched, so whatever is
        // underneath shows through.
        if let Some(fill) = fill {
            for dy in 0..h {
                let mut left = 0;
                let mut right = 0;
                if dy < tl {
                    left = left.max(tl - 1 - dy);
                }
                if dy >= h - bl {
                    left = left.max(dy - (h - bl));
                }
                if dy < tr {
                    right = right.max(tr - 1 - dy);
                }
                if dy >= h - br {
                    right = right.max(dy - (h - br));
                }
                self.rect(x + left, y + dy, w - left - right, 1, fill);
            }
        }

        self.rect(x + tl, y, w - tl - tr, 1, stroke);
        self.rect(x + bl, y + h - 1, w - bl - br, 1, stroke);
        self.rect(x, y + tl, 1, h - tl - bl, stroke);
        self.rect(x + w - 1, y + tr, 1, h - tr - br, stroke);

        for (dx, dy) in diagonal(tl) {
            self.pixel(x + dx, y + dy, stroke);
        }
        for i in 0..tr {
            self.pixel(x + w - tr + i, y + i, stroke);
        }
        for i in 0..bl {
            self.pixel(x + i, y + h - bl + i, stroke);
        }
        for i in 0..br {
            self.pixel(x + w - br + i, y + h - 1 - i, stroke);
        }

        // Drop shadow, one row below and one column right, each a corner-radius
        // in from its near end and one pixel long past the far end so the two
        // meet at the bottom-right stair.
        self.rect(x + r, y + h, w - 2 * r + 1, 1, stroke);
        self.rect(x + w, y + r, 1, h - 2 * r + 1, stroke);

        // Two pixels weighting the bottom-right cut.
        self.pixel(x + w - 2, y + h - 1, stroke);
        self.pixel(x + w - 1, y + h - 2, stroke);
    }
}
