//! An app's own size, fitted to the panel.
//!
//! A hosted app draws at whatever size it insists on: Doom renders 320x200 and
//! cannot be told otherwise, since the port sizes its window to its render buffer.
//! When flipctl composites the app rather than letting the compositor put it on the
//! panel directly, that fitting becomes ours to do.
//!
//! Box average rather than nearest, because dropping rows and columns of a 320x200
//! frame loses whole pixels of a game that has few to spare, and averaging costs one
//! pass over the source. Aspect ratio is kept and the remainder is left as it was,
//! so a caller that clears once gets letterbox bars for free.

use crate::pixel::Gray8;

/// Scale `src` to fit `dw` by `dh`, centred, keeping its aspect ratio.
///
/// `dst` is not cleared: the fitted image lands in the middle and whatever the
/// caller put in the margins stays there.
pub fn fit(src: &[Gray8], sw: u32, sh: u32, dst: &mut [Gray8], dw: u32, dh: u32) {
    if sw == 0 || sh == 0 || dw == 0 || dh == 0 {
        return;
    }
    if src.len() < (sw * sh) as usize || dst.len() < (dw * dh) as usize {
        return;
    }

    // Whole-pixel arithmetic: the largest box that fits, then the offset that
    // centres it. Anything else puts the image half a pixel off and blurs a panel
    // whose pixels are individually visible.
    let (w, h) = if sw * dh > dw * sh {
        (dw, (sh * dw / sw).max(1))
    } else {
        ((sw * dh / sh).max(1), dh)
    };
    let (ox, oy) = ((dw - w) / 2, (dh - h) / 2);

    for y in 0..h {
        // The source rows this destination row covers, at least one.
        let y0 = y * sh / h;
        let y1 = (((y + 1) * sh / h).max(y0 + 1)).min(sh);
        for x in 0..w {
            let x0 = x * sw / w;
            let x1 = (((x + 1) * sw / w).max(x0 + 1)).min(sw);
            let mut sum = 0u32;
            let mut n = 0u32;
            for sy in y0..y1 {
                let row = (sy * sw) as usize;
                for sx in x0..x1 {
                    sum += u32::from(src[row + sx as usize].0);
                    n += 1;
                }
            }
            dst[((oy + y) * dw + ox + x) as usize] = Gray8((sum / n.max(1)) as u8);
        }
    }
}

/// Scale a 32-bit capture straight into greyscale, fitted to `dw` by `dh`.
///
/// One pass where there used to be four. A hosted app's frame arrived as XRGB, was
/// converted to grey at full size, scaled in a second pass, expanded back to XRGB for
/// the dumb buffer and reduced to gray8 again by the driver. Nothing about that is
/// necessary: the only greyscale anyone needs is the panel-sized one, and this writes
/// it directly from the capture.
///
/// `stride` is the capture's own row length in bytes, `bgr` says its first channel is
/// blue, and the luma is the kernel's own 299/587/114 so a frame we grey and a frame
/// `drm_fb_xrgb8888_to_gray8` greys agree.
pub fn fit_from_xrgb(
    src: &[u8],
    stride: u32,
    bgr: bool,
    sw: u32,
    sh: u32,
    dst: &mut [Gray8],
    dw: u32,
    dh: u32,
) {
    if sw == 0 || sh == 0 || dw == 0 || dh == 0 || dst.len() < (dw * dh) as usize {
        return;
    }
    if src.len() < (stride * sh) as usize {
        return;
    }

    let (w, h) = if sw * dh > dw * sh {
        (dw, (sh * dw / sw).max(1))
    } else {
        ((sw * dh / sh).max(1), dh)
    };
    let (ox, oy) = ((dw - w) / 2, (dh - h) / 2);

    for y in 0..h {
        let y0 = y * sh / h;
        let y1 = (((y + 1) * sh / h).max(y0 + 1)).min(sh);
        for x in 0..w {
            let x0 = x * sw / w;
            let x1 = (((x + 1) * sw / w).max(x0 + 1)).min(sw);
            let mut sum = 0u32;
            let mut n = 0u32;
            for sy in y0..y1 {
                let row = (sy * stride) as usize;
                for sx in x0..x1 {
                    let p = row + (sx * 4) as usize;
                    let (first, third) = (u32::from(src[p]), u32::from(src[p + 2]));
                    let (r, g, b) = if bgr {
                        (third, u32::from(src[p + 1]), first)
                    } else {
                        (first, u32::from(src[p + 1]), third)
                    };
                    sum += ((r * 299 + g * 587 + b * 114) / 1000).min(255);
                    n += 1;
                }
            }
            dst[((oy + y) * dw + ox + x) as usize] = Gray8((sum / n.max(1)) as u8);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fit;
    use crate::pixel::Gray8;

    fn grey(v: &[u8]) -> Vec<Gray8> {
        v.iter().copied().map(Gray8).collect()
    }

    #[test]
    fn a_frame_of_one_value_keeps_it() {
        // Doom's size onto the panel's, which is the case this exists for. The panel
        // is named rather than written out, both because it is the rule here and
        // because the fit has to hold if it ever changes.
        let (pw, ph) = (u32::from(crate::PANEL_W), u32::from(crate::PANEL_H));
        let src = grey(&vec![200; 320 * 200]);
        let mut dst = grey(&vec![0; (pw * ph) as usize]);
        fit(&src, 320, 200, &mut dst, pw, ph);
        let middle = (ph / 2 * pw + pw / 2) as usize;
        assert_eq!(dst[middle].0, 200, "the middle is the image");
        assert_eq!(dst[(ph / 2 * pw) as usize].0, 0, "the left margin is untouched");
    }

    #[test]
    fn averaging_halves_a_checkerboard() {
        // 4x4 alternating 0 and 255 down to 2x2: every box holds one of each.
        let src = grey(&[
            0, 255, 0, 255, 255, 0, 255, 0, 0, 255, 0, 255, 255, 0, 255, 0,
        ]);
        let mut dst = grey(&[9; 4]);
        fit(&src, 4, 4, &mut dst, 2, 2);
        assert!(
            dst.iter().all(|p| p.0 == 127),
            "each pixel is the average of its box, got {:?}",
            dst.iter().map(|p| p.0).collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_frame_the_size_of_the_panel_is_copied_across() {
        let mut src = grey(&[0; 8 * 4]);
        src[10] = Gray8(64);
        let mut dst = grey(&[0; 8 * 4]);
        fit(&src, 8, 4, &mut dst, 8, 4);
        assert_eq!(dst[10].0, 64, "no scaling, no offset, no averaging");
    }

    #[test]
    fn a_capture_greys_as_the_driver_would() {
        use super::fit_from_xrgb;
        // One 2x2 capture of a single colour, XRGB order, into a 2x2 destination: no
        // scaling, so each pixel is its own luma and can be checked against the
        // kernel's formula directly.
        let (r, g, b) = (200u8, 100u8, 50u8);
        let src: Vec<u8> = std::iter::repeat([b, g, r, 0]).take(4).flatten().collect();
        let mut dst = grey(&[0; 4]);
        fit_from_xrgb(&src, 8, true, 2, 2, &mut dst, 2, 2);
        let want = Gray8::from_rgb(r, g, b);
        assert!(
            dst.iter().all(|p| p.0.abs_diff(want.0) <= 1),
            "expected about {}, got {:?}",
            want.0,
            dst.iter().map(|p| p.0).collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_capture_of_the_wrong_size_is_refused() {
        use super::fit_from_xrgb;
        let src = vec![255u8; 16];
        let mut dst = grey(&[0; 4]);
        fit_from_xrgb(&src, 8, true, 40, 40, &mut dst, 2, 2);
        assert!(dst.iter().all(|p| p.0 == 0), "nothing written");
    }

    #[test]
    fn a_short_buffer_is_refused_rather_than_panicking() {
        let src = grey(&[1; 4]);
        let mut dst = grey(&[0; 4]);
        fit(&src, 100, 100, &mut dst, 2, 2);
        assert!(dst.iter().all(|p| p.0 == 0), "nothing written");
    }
}
