//! The canonical pixel format.
//!
//! flipper-one-display.c advertises `DRM_FORMAT_XRGB8888` only and converts what
//! it is handed with `drm_fb_xrgb8888_to_gray8`, so the panel is an 8-bit
//! greyscale device wearing a 32-bit costume. Every token in tokens.toml is a
//! pure grey, so `Gray8` is lossless for the whole design system and one quarter
//! the memory of the buffer the kernel actually wants.
//!
//! One 256x144 frame is 36864 bytes here and 147456 bytes in the dumb buffer.
//! The panel sink expands on commit; every other sink consumes `Gray8` directly.

/// One greyscale sample. 0 is black, 255 is white.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Default, Hash)]
pub struct Gray8(pub u8);

impl Gray8 {
    pub const BLACK: Self = Self(0);
    pub const WHITE: Self = Self(255);

    /// Rec.601 luma, matching `drm_fb_xrgb8888_to_gray8` in the kernel so a
    /// value we compute here and a value the kernel computes agree.
    ///
    /// The kernel uses `(3 * r + 6 * g + b) / 10`; reproducing it exactly keeps
    /// the golden images honest.
    #[inline]
    pub const fn from_rgb(r: u8, g: u8, b: u8) -> Self {
        Self(((3 * r as u16 + 6 * g as u16 + b as u16) / 10) as u8)
    }

    /// Expand to the `XRGB8888` word the dumb buffer wants, little-endian
    /// `0x00RRGGBB`.
    #[inline]
    pub const fn to_xrgb8888(self) -> u32 {
        let v = self.0 as u32;
        (v << 16) | (v << 8) | v
    }

    /// Blend `over` on top of `self` with `alpha` in 0..=255. Used for the
    /// 75 percent white modal scrim and for the alpha edges of the 6-bit
    /// greyscale sprites.
    #[inline]
    pub fn blend(self, over: Gray8, alpha: u8) -> Gray8 {
        let a = alpha as u16;
        Gray8((((over.0 as u16 * a) + (self.0 as u16 * (255 - a))) / 255) as u8)
    }
}

/// A rectangle in panel coordinates. Half-open: `x .. x + w`.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct Rect {
    pub x: u16,
    pub y: u16,
    pub w: u16,
    pub h: u16,
}

impl Rect {
    pub const fn new(x: u16, y: u16, w: u16, h: u16) -> Self {
        Self { x, y, w, h }
    }

    pub const fn is_empty(&self) -> bool {
        self.w == 0 || self.h == 0
    }

    /// Smallest rectangle covering both. An empty operand is ignored, so
    /// folding over damage rects starting from `Rect::default()` works.
    pub fn union(self, other: Rect) -> Rect {
        if self.is_empty() {
            return other;
        }
        if other.is_empty() {
            return self;
        }
        let x = self.x.min(other.x);
        let y = self.y.min(other.y);
        let r = (self.x + self.w).max(other.x + other.w);
        let b = (self.y + self.h).max(other.y + other.h);
        Rect::new(x, y, r - x, b - y)
    }
}
