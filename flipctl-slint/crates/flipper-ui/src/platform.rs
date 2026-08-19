//! Output sinks and input sources.
//!
//! The renderer draws once into a single greyscale frame and fans it out. That
//! is deliberately not the shape the original brief proposed
//! (`present(&[Rgb565Pixel], damage)`): output and input are separate concerns,
//! the panel has no RGB565 mode to present to, and more than one thing wants each
//! frame. The panel, the browser remote view and the golden-image harness are all
//! just sinks over the same bytes.

use crate::pixel::{Gray8, Rect};
use crate::KeyEvent;

/// One rendered frame, borrowed. Nothing copies unless a sink needs to.
#[derive(Copy, Clone)]
pub struct Frame<'a> {
    pub pixels: &'a [Gray8],
    pub w: u16,
    pub h: u16,
}

impl<'a> Frame<'a> {
    pub fn new(pixels: &'a [Gray8], w: u16, h: u16) -> Self {
        debug_assert_eq!(pixels.len(), usize::from(w) * usize::from(h));
        Self { pixels, w, h }
    }

    /// Rows of the frame covered by `damage`, as slices.
    pub fn rows(&self, damage: Rect) -> impl Iterator<Item = &'a [Gray8]> + '_ {
        let stride = usize::from(self.w);
        let x = usize::from(damage.x);
        let width = usize::from(damage.w);
        (damage.y..damage.y + damage.h).map(move |y| {
            let start = usize::from(y) * stride + x;
            &self.pixels[start..start + width]
        })
    }
}

/// Somewhere a frame can go.
pub trait FrameSink {
    /// Present `frame`. `damage` is what changed since the last commit; a sink
    /// that cannot do partial updates may ignore it.
    fn commit(&mut self, frame: Frame<'_>, damage: Rect) -> std::io::Result<()>;
}

/// Somewhere key events come from.
pub trait InputSource {
    /// Non-blocking. `None` when nothing is queued.
    fn poll(&mut self) -> Option<KeyEvent>;
}
