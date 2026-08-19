//! The panel sink: DRM/KMS straight to the Flipper One display.
//!
//! Talks to the DRM device through the `drm` crate and nothing else. No
//! libinput, no libudev, no libxkbcommon: the panel has one fixed mode and the
//! buttons are a handful of keys, so none of that tree earns its place in an
//! initramfs.
//!
//! `flipper-one-display.c` advertises `DRM_FORMAT_XRGB8888` only and converts
//! with `drm_fb_xrgb8888_to_gray8`, so we expand our greyscale frame into a
//! 32-bit dumb buffer on commit. Damage is tracked and reported, but the driver
//! clips to the whole framebuffer and re-transmits all 37152 SPI bytes on every
//! atomic update, so it currently only lets us skip a commit entirely when
//! nothing moved.

use std::fs::{File, OpenOptions};
use std::os::fd::{AsFd, BorrowedFd};
use std::path::{Path, PathBuf};

use drm::buffer::{Buffer, DrmFourcc};
use drm::control::dumbbuffer::DumbBuffer;
use drm::control::{connector, crtc, framebuffer, Device as ControlDevice, Mode};
use drm::Device as DrmDevice;

use crate::pixel::Rect;
use crate::platform::{Frame, FrameSink};

/// The driver name `flipper-one-display.c` registers.
const DRIVER: &str = "flipper_one_display";

struct Card(File);

impl AsFd for Card {
    fn as_fd(&self) -> BorrowedFd<'_> {
        self.0.as_fd()
    }
}
impl DrmDevice for Card {}
impl ControlDevice for Card {}

pub struct KmsSink {
    card: Card,
    crtc: crtc::Handle,
    connector: connector::Handle,
    mode: Mode,
    buffer: DumbBuffer,
    fb: framebuffer::Handle,
    modeset_done: bool,
    flush: Flush,
}

/// How to make the driver transmit a frame we have already written into the
/// mapped dumb buffer.
///
/// `DIRTYFB` is the right answer and what every other mipi-dbi tiny driver
/// implements via `drm_atomic_helper_dirtyfb`. `flipper-one-display.c` sets
/// `.fb_create = drm_gem_fb_create` and no `dirty_fb`, so the ioctl returns
/// ENOSYS on this panel. We probe once and remember.
///
/// The fallback re-runs `set_crtc` with the same mode and framebuffer. Mode and
/// fb are unchanged so the atomic helpers set no `mode_changed` and there is no
/// disable/enable cycle; `fo_crtc_check` calls `drm_atomic_add_affected_planes`,
/// which pulls the plane into the commit, so `fo_plane_atomic_update` runs and
/// writes the SPI buffer. Same effect, one extra ioctl.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Flush {
    Probe,
    DirtyFb,
    SetCrtc,
}

impl KmsSink {
    /// Open the panel.
    ///
    /// `explicit` is honoured when given. Otherwise every `/dev/dri/card*` is
    /// probed and the one whose driver name is `flipper_one_display` wins.
    /// Auto-detection matters because card numbers are renumbered by kernel
    /// rebuilds, which has already broken flipctl once; a by-path symlink is
    /// stable but only if the SPI address never changes.
    pub fn open(explicit: Option<&Path>) -> std::io::Result<Self> {
        let path = match explicit {
            Some(p) => p.to_path_buf(),
            None => Self::find_panel()?,
        };

        let card = Card(OpenOptions::new().read(true).write(true).open(&path)?);

        let name = card.get_driver()?.name;
        if explicit.is_none() && name != DRIVER {
            return Err(std::io::Error::other(format!(
                "{} is driven by {name:?}, expected {DRIVER:?}",
                path.display()
            )));
        }

        let resources = card.resource_handles()?;

        // The panel is a fixed-mode SPI connector, so take the first connected
        // one and its first mode rather than scoring a list.
        let (connector, mode) = resources
            .connectors()
            .iter()
            .filter_map(|handle| card.get_connector(*handle, false).ok())
            .find(|info| info.state() == connector::State::Connected)
            .and_then(|info| info.modes().first().copied().map(|m| (info.handle(), m)))
            .ok_or_else(|| std::io::Error::other("no connected connector with a mode"))?;

        let crtc = *resources
            .crtcs()
            .first()
            .ok_or_else(|| std::io::Error::other("no CRTC"))?;

        let (w, h) = mode.size();
        let mut buffer =
            card.create_dumb_buffer((u32::from(w), u32::from(h)), DrmFourcc::Xrgb8888, 32)?;
        let fb = card.add_framebuffer(&buffer, 24, 32)?;

        // Start from a known frame: an uninitialised dumb buffer is whatever the
        // allocator left behind, and on a device with no vblank that garbage
        // would be visible until the first real commit.
        {
            let mut map = card.map_dumb_buffer(&mut buffer)?;
            map.as_mut().fill(0xff);
        }

        Ok(Self {
            card,
            crtc,
            connector,
            mode,
            buffer,
            fb,
            modeset_done: false,
            flush: Flush::Probe,
        })
    }

    fn find_panel() -> std::io::Result<PathBuf> {
        let mut candidates: Vec<PathBuf> = std::fs::read_dir("/dev/dri")?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("card"))
            })
            .collect();
        candidates.sort();

        for path in &candidates {
            let Ok(file) = OpenOptions::new().read(true).write(true).open(path) else {
                continue;
            };
            if Card(file).get_driver().is_ok_and(|d| d.name == DRIVER) {
                return Ok(path.clone());
            }
        }

        Err(std::io::Error::other(format!(
            "no /dev/dri/card* is driven by {DRIVER:?} (tried {})",
            candidates.len()
        )))
    }

    pub fn size(&self) -> (u16, u16) {
        self.mode.size()
    }
}

impl FrameSink for KmsSink {
    fn commit(&mut self, frame: Frame<'_>, damage: Rect) -> std::io::Result<()> {
        if damage.is_empty() && self.modeset_done {
            return Ok(());
        }

        let (w, h) = self.mode.size();
        if (frame.w, frame.h) != (w, h) {
            return Err(std::io::Error::other(format!(
                "frame is {}x{}, panel is {w}x{h}",
                frame.w, frame.h
            )));
        }

        let pitch = self.buffer.pitch() as usize;
        {
            let mut map = self.card.map_dumb_buffer(&mut self.buffer)?;
            let dst = map.as_mut();

            for (row, pixels) in (damage.y..damage.y + damage.h).zip(frame.rows(damage)) {
                let start = usize::from(row) * pitch + usize::from(damage.x) * 4;
                let words = &mut dst[start..start + pixels.len() * 4];
                for (word, px) in words.chunks_exact_mut(4).zip(pixels) {
                    word.copy_from_slice(&px.to_xrgb8888().to_le_bytes());
                }
            }
        }

        if !self.modeset_done {
            self.set_crtc()?;
            self.modeset_done = true;
            return Ok(());
        }

        if self.flush != Flush::SetCrtc {
            // The driver ignores the clip list and retransmits the whole frame,
            // but reporting real damage costs nothing and is correct the day it
            // stops.
            let clip = drm::control::ClipRect::new(
                damage.x,
                damage.y,
                damage.x + damage.w,
                damage.y + damage.h,
            );
            match self.card.dirty_framebuffer(self.fb, &[clip]) {
                Ok(()) => {
                    self.flush = Flush::DirtyFb;
                    return Ok(());
                }
                Err(e) if self.flush == Flush::Probe && is_unsupported(&e) => {
                    self.flush = Flush::SetCrtc;
                }
                Err(e) => return Err(e),
            }
        }

        self.set_crtc()
    }
}

impl KmsSink {
    fn set_crtc(&self) -> std::io::Result<()> {
        self.card.set_crtc(
            self.crtc,
            Some(self.fb),
            (0, 0),
            &[self.connector],
            Some(self.mode),
        )
    }

    /// Which flush path the panel ended up on. Reported by the demo so a driver
    /// gaining `dirty_fb` is visible rather than silently unused.
    pub fn flush_path(&self) -> &'static str {
        match self.flush {
            Flush::Probe => "unprobed",
            Flush::DirtyFb => "DIRTYFB",
            Flush::SetCrtc => "set_crtc (driver has no dirty_fb)",
        }
    }
}

/// ENOSYS or EOPNOTSUPP: the driver does not implement the ioctl at all, as
/// opposed to rejecting these particular arguments.
fn is_unsupported(e: &std::io::Error) -> bool {
    matches!(e.raw_os_error(), Some(38) | Some(95))
}
