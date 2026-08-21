//! Handing the panel to the kernel's own terminal.
//!
//! A curses program draws into a terminal, not onto a panel, so the way to run
//! one here is to let the thing that already knows how to be a terminal do it:
//! the kernel's VT. flipctl releases DRM master, the framebuffer console paints
//! the panel, the program runs on a VT of its own, and when it ends the panel
//! comes back. Nothing in this file emulates a terminal, and that is the point.
//!
//! Everything is done by ioctl rather than by shelling out to the kbd tools, so
//! this needs no packages installed on the device. The two cosmetic steps that do
//! want a tool, loading a smaller console font and greying the palette, are
//! optional and say so.
//!
//! This depends on the panel driver pushing fbdev writes, which needs
//! `drm_gem_fb_create_with_dirty` in flipper-one-display: without it the console
//! draws into a buffer nothing sends and the panel keeps the last frame flipctl
//! left behind.
use std::fs::{File, OpenOptions};
use std::io;
use std::os::fd::AsRawFd;

// linux/vt.h
const VT_SETMODE: libc::c_ulong = 0x5602;
const VT_GETSTATE: libc::c_ulong = 0x5603;
const VT_ACTIVATE: libc::c_ulong = 0x5606;
const VT_WAITACTIVE: libc::c_ulong = 0x5607;
// linux/fb.h
const FBIOGET_VSCREENINFO: libc::c_ulong = 0x4600;
const FBIOPUT_VSCREENINFO: libc::c_ulong = 0x4601;
const FBIOGET_CON2FBMAP: libc::c_ulong = 0x460F;
const FBIOPUT_CON2FBMAP: libc::c_ulong = 0x4610;

/// `struct fb_var_screeninfo`, as bytes.
///
/// Forty fields of which one matters here, so it is read and written back as an
/// opaque block rather than transcribed: xres and the rest come back exactly as
/// the driver reported them, and only `activate` is touched.
const VSCREENINFO_SIZE: usize = 160;
/// Where `activate` sits: eight u32s, four bitfields of three u32s, then nonstd.
const VSCREENINFO_ACTIVATE: usize = 84;
/// FB_ACTIVATE_NOW with FB_ACTIVATE_FORCE, so set_par runs even though nothing
/// about the mode has changed.
const FB_ACTIVATE_FORCE: u32 = 128;
// linux/kd.h
const KDSETMODE: libc::c_ulong = 0x4B3A;
const KD_TEXT: libc::c_int = 0x00;
const KD_GRAPHICS: libc::c_int = 0x01;
const KDSKBMODE: libc::c_ulong = 0x4B45;
/// Keys become characters, which is what a terminal program needs.
const K_XLATE: libc::c_int = 0x01;
/// No keyboard at all: what a program that reads evdev itself wants, so its keys do
/// not also type into the console behind it.
const K_OFF: libc::c_int = 0x04;
const PIO_CMAP: libc::c_ulong = 0x4B71;
const KDFONTOP: libc::c_ulong = 0x4B72;
const KD_FONT_OP_SET: libc::c_uint = 0;

/// The console fonts, by the cell they draw in, smallest first.
///
/// The kernel's built-in font is 8x16, which is 32 columns by 9 rows here: enough
/// for a dialog, no use to anything that draws a table. Which of these suits an
/// app is the app's business, so a manifest names one and this is the list it may
/// name. Embedded rather than read from disk so a profile with no kbd package, and
/// no way to install one, still gets a usable console.
///
///   4x6   64x24  every column htop has, at four pixels a glyph
///   5x8   51x18  the default: htop's meters and six process rows
///   6x12  42x12  comfortable, for something that draws dialogs
///   7x14  36x10  the same, one step larger
///   8x16  32x9   as large as the panel can hold
const FONTS: [(&str, &[u8]); 5] = [
    ("4x6", include_bytes!("../assets/console/mini4x6.psf")),
    ("5x8", include_bytes!("../assets/console/spleen-5x8.psfu")),
    ("6x12", include_bytes!("../assets/console/spleen-6x12.psfu")),
    ("7x14", include_bytes!("../assets/console/7x14.psf")),
    ("8x16", include_bytes!("../assets/console/spleen-8x16.psfu")),
];

/// What an app gets when it names nothing.
const DEFAULT_FONT: &str = "5x8";

/// A console font as the kernel wants it: (width, height, glyphs padded to 32
/// bytes apiece).
///
/// Both PSF versions, because the fonts worth having come in both: PSF1 is a
/// four-byte header and 8-pixel-wide glyphs, PSF2 says its own cell size.
///
/// Two things stop this being a copy. The console addresses 256 glyphs and some of
/// these fonts carry 512, so half of a large one is dropped. And a font may carry a
/// table saying which character each glyph is for, in which case index does not
/// mean character and the table decides: without reading it, a 512-glyph font comes
/// out as the wrong letters in the right shapes, which is the kind of bug that only
/// shows up as garbage on a device.
fn glyphs_of(font: &[u8]) -> io::Result<(usize, usize, Vec<u8>)> {
    const PSF2: [u8; 4] = [0x72, 0xb5, 0x4a, 0x86];
    const PSF1: [u8; 2] = [0x36, 0x04];
    /// PSF2's flags bit 0, and PSF1's mode bit 1: a unicode table follows.
    const HAS_TABLE: usize = 1;

    if font.len() > 4 && font[..2] == PSF1 {
        // mode, then the bytes per glyph. Always eight wide, so a byte a row.
        let mode = usize::from(font[2]);
        let charsize = usize::from(font[3]);
        let count = if mode & 1 != 0 { 512 } else { GLYPHS };
        let table = if mode & 2 != 0 { HAS_TABLE } else { 0 };
        // PSF1's table is UTF-16, where PSF2's is UTF-8.
        return map_glyphs(font, 4, table, count, charsize, charsize, 8, true);
    }
    if font.len() < 32 || font[..4] != PSF2 {
        return Err(io::Error::other("console font is not PSF1 or PSF2"));
    }
    let word = |at: usize| {
        u32::from_le_bytes([font[at], font[at + 1], font[at + 2], font[at + 3]]) as usize
    };
    let (header, flags, count, charsize, height, width) =
        (word(8), word(12), word(16), word(20), word(24), word(28));
    map_glyphs(font, header, flags & HAS_TABLE, count, charsize, height, width, false)
}

/// The half of the parse both versions share.
fn map_glyphs(
    font: &[u8],
    header: usize,
    table: usize,
    count: usize,
    charsize: usize,
    height: usize,
    width: usize,
    utf16: bool,
) -> io::Result<(usize, usize, Vec<u8>)> {
    const PER_GLYPH: usize = 32;
    const HAS_TABLE: usize = 1;
    {
    }
    if width == 0 || width > 8 || height == 0 || height > PER_GLYPH {
        return Err(io::Error::other("console font does not fit a cell"));
    }
    if charsize < height || header + count * charsize > font.len() {
        return Err(io::Error::other("console font is truncated"));
    }

    // Which glyph draws each character. By index unless the font says otherwise.
    let mut which: Vec<usize> = (0..GLYPHS).collect();
    if table & HAS_TABLE != 0 {
        which = vec![usize::MAX; GLYPHS];
        let mut at = header + count * charsize;
        let mut glyph = 0;
        // Per glyph, the characters it draws, then a terminator: an entry ends at
        // 0xFF and a run of several characters is separated by 0xFE. PSF1 writes
        // both, and its characters, as 16-bit words; PSF2 writes bytes and UTF-8.
        let mut pending: Vec<u8> = Vec::new();
        let step = if utf16 { 2 } else { 1 };
        let claim = |c: usize, which: &mut Vec<usize>, glyph: usize| {
            if c < GLYPHS && which[c] == usize::MAX {
                which[c] = glyph;
            }
        };
        while at + step <= font.len() && glyph < count {
            let unit = if utf16 {
                usize::from(u16::from_le_bytes([font[at], font[at + 1]]))
            } else {
                usize::from(font[at])
            };
            let (end, separator) = if utf16 {
                (unit == 0xFFFF, unit == 0xFFFE)
            } else {
                (unit == 0xFF, unit == 0xFE)
            };
            if end || separator {
                if utf16 {
                    // Already a character apiece; only the first of a sequence is
                    // the one this glyph is named by.
                    if let Some(first) = pending.chunks_exact(2).next() {
                        claim(
                            usize::from(u16::from_le_bytes([first[0], first[1]])),
                            &mut which,
                            glyph,
                        );
                    }
                } else if let Ok(text) = std::str::from_utf8(&pending) {
                    for c in text.chars() {
                        claim(c as usize, &mut which, glyph);
                    }
                }
                pending.clear();
                if end {
                    glyph += 1;
                }
            } else if utf16 {
                pending.extend_from_slice(&font[at..at + 2]);
            } else {
                pending.push(font[at]);
            }
            at += step;
        }
    }

    let mut out = vec![0u8; GLYPHS * PER_GLYPH];
    for (character, glyph) in which.iter().enumerate() {
        if *glyph >= count {
            continue;
        }
        let from = header + glyph * charsize;
        out[character * PER_GLYPH..character * PER_GLYPH + height]
            .copy_from_slice(&font[from..from + height]);
    }
    Ok((width, height, out))
}

/// Glyphs a console can address: one byte's worth.
const GLYPHS: usize = 256; // not-a-panel-dimension

/// linux/vt.h's vt_mode. Only the first field is set here, to VT_AUTO.
#[repr(C)]
#[derive(Default)]
struct VtMode {
    mode: libc::c_char,
    waitv: libc::c_char,
    relsig: libc::c_short,
    acqsig: libc::c_short,
    frsig: libc::c_short,
}

#[repr(C)]
#[derive(Default)]
struct VtStat {
    active: u16,
    signal: u16,
    state: u16,
}

/// linux/kd.h's console_font_op. The kernel takes the glyphs padded to 32 bytes
/// each whatever the real height is.
#[repr(C)]
struct ConsoleFontOp {
    op: libc::c_uint,
    flags: libc::c_uint,
    width: libc::c_uint,
    height: libc::c_uint,
    charcount: libc::c_uint,
    data: *mut u8,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Con2FbMap {
    console: u32,
    framebuffer: u32,
}

/// The sixteen console colours as greys.
///
/// The panel takes one byte a pixel and the driver derives it from luma, so a
/// terminal's red on black lands at 76 of 255 and is barely there. Every entry
/// here has r == g == b, so what the console asks for is what the panel shows:
/// the eight normal colours are mid greys far enough apart to tell apart, and the
/// bright eight are near white. Black stays black and white stays white, because
/// those two carry most of the screen.
const GREYS: [u8; 16] = [0, 120, 150, 170, 110, 140, 160, 200, 80, 210, 230, 245, 200, 225, 240, 255];

/// Wait for a VT to come to the front, but not for ever.
///
/// VT_WAITACTIVE is the obvious way and the wrong one: it blocks with no timeout,
/// and the kernel drops a switch request outright in several cases, so a switch that
/// will never happen parks the caller for good. flipctl hung three times on that
/// today, once for twenty minutes, and every one of them looked to a person like the
/// whole device had died.
///
/// So the switch is asked for and then watched. sysfs names the console that is in
/// front; a tenth of a second is far longer than a switch takes, and a failure here
/// is worth reporting rather than waiting out.
fn wait_active(vt: u16) -> io::Result<()> {
    use std::time::{Duration, Instant};

    let want = format!("tty{vt}");
    let deadline = Instant::now() + Duration::from_millis(500);
    while Instant::now() < deadline {
        let active = std::fs::read_to_string("/sys/class/tty/tty0/active")?;
        if active.trim() == want {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Err(io::Error::other(format!("{want} did not come to the front")))
}

/// Make the console that is on screen right now switchable.
///
/// Two things stop a switch: the kernel ignores one away from a VT in graphics
/// mode, and a VT whose switching a program took control of waits for that program
/// to agree, for ever if it has died. Both belong to the VT and outlive whatever
/// set them, so both are undone before every switch.
///
/// The VT is looked up by name rather than through /dev/tty0, which resolves to the
/// console that was current when it was opened: a handle kept from earlier changes
/// the mode of the wrong console, which is a switch that hangs and a reason that is
/// nowhere near the symptom.
fn release_current_vt() -> io::Result<()> {
    let active = std::fs::read_to_string("/sys/class/tty/tty0/active")?;
    let name = active.trim();
    if name.is_empty() {
        return Err(io::Error::other("no active VT"));
    }
    let tty = OpenOptions::new()
        .read(true)
        .write(true)
        .open(format!("/dev/{name}"))?;
    set_mode(&tty, KD_TEXT)?;
    let mut auto = VtMode::default();
    ioctl(&tty, VT_SETMODE, &mut auto)
}

/// KDSETMODE on an open console.
fn set_mode(tty: &File, mode: libc::c_int) -> io::Result<()> {
    // SAFETY: KDSETMODE takes the mode by value, not by pointer.
    if unsafe { libc::ioctl(tty.as_raw_fd(), KDSETMODE, mode) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn ioctl<T>(fd: &File, request: libc::c_ulong, arg: &mut T) -> io::Result<()> {
    // SAFETY: `arg` is the type the request documents and outlives the call.
    let ret = unsafe { libc::ioctl(fd.as_raw_fd(), request, arg as *mut T as *mut libc::c_void) };
    if ret < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// What the console has drawn, read back as the panel's own greyscale.
///
/// While a console app owns the screen flipctl draws nothing, so the browser view
/// and the switcher's card would both go stale. The way out is that fbdev keeps a
/// shadow of the console in memory and it can simply be read: one frame is 147 kB
/// of XRGB, which comes back as 36 kB of grey.
pub struct Mirror {
    fb: File,
    stride: usize,
    w: usize,
    h: usize,
    xrgb: Vec<u8>,
    grey: Vec<u8>,
}

/// A framebuffer's width, height and stride, from sysfs.
///
/// From sysfs rather than by ioctl because the two structs the ioctls want are
/// forty fields between them, and all that is needed here is a size and a stride.
fn geometry(fb: u32) -> io::Result<(usize, usize, usize)> {
    let read = |what: &str| {
        std::fs::read_to_string(format!("/sys/class/graphics/fb{fb}/{what}"))
            .map(|s| s.trim().to_string())
    };
    let size = read("virtual_size")?;
    let (w, h) = size
        .split_once(',')
        .ok_or_else(|| io::Error::other(format!("fb{fb} size is {size:?}")))?;
    let parse = |v: &str| {
        v.parse::<usize>()
            .map_err(|_| io::Error::other(format!("fb{fb} reports {v:?}")))
    };
    Ok((parse(w)?, parse(h)?, parse(&read("stride")?)?))
}

impl Mirror {
    /// Open framebuffer `fb` for reading.
    pub fn open(fb: u32) -> io::Result<Self> {
        let (w, h, stride) = geometry(fb)?;
        Ok(Self {
            fb: OpenOptions::new().read(true).open(format!("/dev/fb{fb}"))?,
            stride,
            w,
            h,
            xrgb: vec![0; stride * h],
            grey: vec![0; w * h],
        })
    }

    pub fn size(&self) -> (u16, u16) {
        (self.w as u16, self.h as u16)
    }

    /// Read the current frame, as one byte a pixel.
    ///
    /// The same weights the panel's driver uses to derive grey from colour, so
    /// what this returns is what the panel is showing rather than an
    /// interpretation of it.
    pub fn frame(&mut self) -> io::Result<&[u8]> {
        use std::io::{Read, Seek, SeekFrom};
        self.fb.seek(SeekFrom::Start(0))?;
        self.fb.read_exact(&mut self.xrgb)?;
        for y in 0..self.h {
            let row = y * self.stride;
            for x in 0..self.w {
                let at = row + x * 4;
                let (b, g, r) = (
                    u32::from(self.xrgb[at]),
                    u32::from(self.xrgb[at + 1]),
                    u32::from(self.xrgb[at + 2]),
                );
                self.grey[y * self.w + x] = ((r * 299 + g * 587 + b * 114) / 1000) as u8;
            }
        }
        Ok(&self.grey)
    }
}

/// A VT holding the panel, and what it took to get there.
///
/// Dropping this puts everything back: the console's own framebuffer, and the VT
/// that was in front before. Dropping it does not stop whatever was running on
/// the VT, because ending the program is the caller's business and it has to know
/// whether the program ended by itself.
pub struct Console {
    /// The VT this session runs on.
    pub vt: u16,
    /// The framebuffer it is pointed at while it is in front.
    fb_index: u32,
    /// The one that was in front, to go back to.
    previous: u16,
    /// The console index that was remapped, and the framebuffer it pointed at.
    remapped: Option<(u32, u32)>,
    tty0: File,
    fb: File,
}

impl Console {
    /// Put `vt` in front, painting on framebuffer `fb`.
    ///
    /// The mapping is per console and has to be set while the VT is not the one
    /// being drawn, so it is done before the switch. `/dev/tty0` is the current
    /// VT whichever it is, which is how the previous one is found without knowing
    /// it in advance.
    pub fn take(vt: u16, fb: u32, graphics: bool) -> io::Result<Self> {
        let tty0 = OpenOptions::new().read(true).write(true).open("/dev/tty0")?;
        let fb_dev = OpenOptions::new()
            .read(true)
            .write(true)
            .open(format!("/dev/fb{fb}"))?;

        let mut state = VtStat::default();
        ioctl(&tty0, VT_GETSTATE, &mut state)?;

        if let Err(e) = release_current_vt() {
            eprintln!("console        current VT not released: {e}");
        }

        // Everything about the VT is settled before it is switched to, because the
        // switch itself is when fbcon paints. A VT keeps its text and this pool is
        // reused, so switching to one htop had earlier makes fbcon repaint htop's old
        // screen and push it to the panel: that is the glimpse of the previous app.
        //
        // A program that paints its own pixels puts its VT in graphics mode here, so
        // fbcon never paints it at all and the first thing shown is what this session
        // draws. A terminal's VT is cleared instead, so it starts blank rather than
        // showing the last program's output.
        {
            let tty = OpenOptions::new()
                .read(true)
                .write(true)
                .open(format!("/dev/tty{vt}"))?;
            {
                use std::io::Write;
                // Home, clear, and clear the scrollback: the first two on their own
                // leave the previous screen one keypress away. Then hide the cursor
                // for a program that paints pixels, or the console's own cursor goes
                // on blinking over its frame. A terminal keeps its cursor: a shell
                // needs one, and a curses program turns it off itself.
                let _ = (&tty).write_all(if graphics {
                    b"\x1b[H\x1b[2J\x1b[3J\x1b[?25l".as_slice()
                } else {
                    b"\x1b[H\x1b[2J\x1b[3J".as_slice()
                });
            }
            let _ = set_mode(&tty, if graphics { KD_GRAPHICS } else { KD_TEXT });
        }

        // The console index is 1-based here, as it is in con2fbmap(1).
        let mut map = Con2FbMap { console: u32::from(vt), framebuffer: fb };
        let mut previous_map = Con2FbMap { console: u32::from(vt), framebuffer: 0 };
        ioctl(&fb_dev, FBIOGET_CON2FBMAP, &mut previous_map)?;
        let remapped = if previous_map.framebuffer == fb {
            None
        } else {
            ioctl(&fb_dev, FBIOPUT_CON2FBMAP, &mut map)?;
            Some((u32::from(vt), previous_map.framebuffer))
        };

        let want = libc::c_int::from(vt);
        // SAFETY: VT_ACTIVATE takes the number by value, not by pointer, which is
        // why it does not go through `ioctl` above.
        let activated = unsafe { libc::ioctl(tty0.as_raw_fd(), VT_ACTIVATE, want) >= 0 }
            && wait_active(vt).is_ok();
        if !activated {
            let error = io::Error::other(format!("tty{vt} did not come to the front"));
            if let Some((console, framebuffer)) = remapped {
                let mut back = Con2FbMap { console, framebuffer };
                let _ = ioctl(&fb_dev, FBIOPUT_CON2FBMAP, &mut back);
            }
            return Err(error);
        }

        let console = Self {
            vt,
            fb_index: fb,
            previous: state.active,
            remapped,
            tty0,
            fb: fb_dev,
        };
        // And on the VT just taken, so a program that takes control of switching
        // and then dies does not strand it: this runs before every session.
        if let Err(e) = console.release_switching() {
            eprintln!("console        switching not released on tty{vt}: {e}");
        }
        // Text mode first, because a VT does not necessarily come back the way it
        // was left: a program that draws through KMS puts its VT in graphics mode,
        // and a VT still in graphics mode refuses a font outright, so the next app
        // to land on it runs in the built-in 8x16 whatever it asked for.
        if let Err(e) = console.text_mode() {
            eprintln!("console        tty{vt} not in text mode: {e}");
        }
        console.grey_palette();
        Ok(console)
    }

    /// Point this VT at the panel's framebuffer.
    ///
    /// Only for the one in front. Every console mapped here draws into the same
    /// buffer, so a background app's output lands on top of whatever the foreground
    /// one is painting: htop repainting its screen every few seconds showed through
    /// a Qt app in patches. The rest keep the framebuffer they had, which is the one
    /// nobody is looking at.
    pub fn attach_fb(&self) -> io::Result<()> {
        let mut map = Con2FbMap { console: u32::from(self.vt), framebuffer: self.fb_index };
        ioctl(&self.fb, FBIOPUT_CON2FBMAP, &mut map)
    }

    /// Point it back where it was, so it stops writing into the panel's buffer.
    pub fn detach_fb(&self) -> io::Result<()> {
        let Some((console, framebuffer)) = self.remapped else {
            return Ok(());
        };
        let mut map = Con2FbMap { console, framebuffer };
        ioctl(&self.fb, FBIOPUT_CON2FBMAP, &mut map)
    }

    /// Say what this VT should do with the keyboard.
    ///
    /// Per-VT state that outlives whatever set it, like the graphics mode. A program
    /// that reads input devices itself turns the console keyboard off so its
    /// keystrokes do not also type into the shell behind it, and Qt does exactly
    /// that; leave it that way and the next program to run on that VT never sees a
    /// key, with nothing anywhere to say why. So it is set for every session rather
    /// than assumed.
    pub fn keyboard(&self, on: bool) -> io::Result<()> {
        let tty = OpenOptions::new().read(true).write(true).open(self.tty_path())?;
        // SAFETY: KDSKBMODE takes the mode by value.
        if unsafe { libc::ioctl(tty.as_raw_fd(), KDSKBMODE, if on { K_XLATE } else { K_OFF }) } < 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    /// Give VT switching back to the kernel on this VT.
    fn release_switching(&self) -> io::Result<()> {
        let tty = OpenOptions::new().read(true).write(true).open(self.tty_path())?;
        let mut auto = VtMode::default();
        ioctl(&tty, VT_SETMODE, &mut auto)
    }

    /// Put this VT back in text mode.
    ///
    /// Whoever had it last may have left it in graphics mode, and a console in
    /// graphics mode takes no font: con_font_set refuses with EINVAL, which is not
    /// a message anybody would connect to the mode.
    fn text_mode(&self) -> io::Result<()> {
        self.set_mode(KD_TEXT)
    }

    /// Stop the console drawing on this VT.
    ///
    /// For a program that paints its own pixels. Without it fbcon keeps repainting
    /// the text the VT holds, on a cursor blink or on anything written to it, and
    /// the panel flickers between the program's frame and an old screenful of
    /// somebody else's output.
    pub fn graphics_mode(&self) -> io::Result<()> {
        self.set_mode(KD_GRAPHICS)
    }

    fn set_mode(&self, mode: libc::c_int) -> io::Result<()> {
        let tty = OpenOptions::new().read(true).write(true).open(self.tty_path())?;
        set_mode(&tty, mode)
    }

    /// Put one greyscale frame into the framebuffer.
    ///
    /// For the moment of handover. Claiming the display shows whatever the
    /// framebuffer already holds, which is the last thing written there by anything
    /// at all: for a program that paints pixels, and so has told the console to stay
    /// quiet, that is another app's last frame, and it flashes up until the new one
    /// draws a second later while its runtime starts. Writing the screen the user
    /// was just looking at makes the wait look like a wait.
    pub fn paint(&self, grey: &[u8]) -> io::Result<()> {
        use std::io::Write;

        let (w, h, stride) = geometry(0)?;
        let mut rows = vec![0u8; stride * h];
        for y in 0..h {
            for x in 0..w {
                let value = grey.get(y * w + x).copied().unwrap_or(0xFF);
                let at = y * stride + x * 4;
                // XRGB8888, the only format this panel takes.
                rows[at] = value;
                rows[at + 1] = value;
                rows[at + 2] = value;
            }
        }
        let mut fb = OpenOptions::new().write(true).open("/dev/fb0")?;
        fb.write_all(&rows)?;
        // fbdev has collected the pages and is waiting on a timer; this sends them.
        fb.sync_all()
    }

    /// Make the framebuffer's own client put its framebuffer on the display.
    ///
    /// Dropping DRM master is not enough on its own. The display goes on holding
    /// whatever flipctl last committed, and everything the console writes lands in
    /// a buffer nothing is showing, so the panel sits on a stale frame. Switching
    /// VT happens to fix it, because fbcon claims the display when it switches, but
    /// that only works when the switch is a real change: the second app to run on
    /// the same VT gets nothing.
    ///
    /// So it is asked for directly. Forcing set_par on the framebuffer runs the
    /// fbdev client's modeset, which puts its buffer on the display, after which
    /// every write to /dev/fb0 reaches the panel: the console's, and a program's
    /// that draws its own pixels there.
    fn claim_display(&self) -> io::Result<()> {
        let mut var = [0u8; VSCREENINFO_SIZE];
        ioctl(&self.fb, FBIOGET_VSCREENINFO, &mut var)?;
        var[VSCREENINFO_ACTIVATE..VSCREENINFO_ACTIVATE + 4]
            .copy_from_slice(&FB_ACTIVATE_FORCE.to_ne_bytes());
        ioctl(&self.fb, FBIOPUT_VSCREENINFO, &mut var)
    }

    /// Put the VT that was in front back, without giving up ours.
    ///
    /// What backgrounding a console app is: the program keeps running on its own
    /// VT, unaware, because an inactive VT is simply not drawn. Returning is the
    /// same switch the other way, which is why the mapping is left alone here and
    /// only undone on drop.
    pub fn background(&self) -> io::Result<()> {
        self.activate(self.previous)
    }

    pub fn foreground(&self) -> io::Result<()> {
        self.activate(self.vt)?;
        // flipctl had the display in the meantime, so it has to be claimed again.
        self.claim_display()
    }

    fn activate(&self, vt: u16) -> io::Result<()> {
        if let Err(e) = release_current_vt() {
            eprintln!("console        current VT not released: {e}");
        }
        let want = libc::c_int::from(vt);
        // SAFETY: VT_ACTIVATE takes the number by value.
        if unsafe { libc::ioctl(self.tty0.as_raw_fd(), VT_ACTIVATE, want) } < 0 {
            return Err(io::Error::last_os_error());
        }
        wait_active(vt)
    }

    /// The device file for this VT, for a child's stdio.
    pub fn tty_path(&self) -> String {
        format!("/dev/tty{}", self.vt)
    }

    /// Ask for a colourless palette, and carry on if the kernel will not.
    ///
    /// Cosmetic: without it a terminal is still readable, just poorly, so a
    /// failure here is not worth refusing to run the program over.
    fn grey_palette(&self) {
        let mut cmap = [0u8; 48];
        for (i, grey) in GREYS.iter().enumerate() {
            cmap[i * 3] = *grey;
            cmap[i * 3 + 1] = *grey;
            cmap[i * 3 + 2] = *grey;
        }
        let _ = ioctl(&self.tty0, PIO_CMAP, &mut cmap);
    }

    /// Load the embedded console font onto this VT.
    ///
    /// PSF2 is a 32-byte header and then one glyph after another, each `charsize`
    /// bytes, rows padded to whole bytes. The kernel wants the same glyphs padded
    /// to 32 bytes apiece, so this is a header parse and a copy.
    ///
    /// Cosmetic in the same sense the palette is: a failure leaves the built-in
    /// font, which is legible and merely too big to be useful.
    /// Load a console font onto this VT, by the cell an app asked for.
    ///
    /// Cosmetic in the same sense the palette is: a failure leaves the built-in
    /// font, which is legible and merely too big to be useful.
    pub fn set_font(&self, want: &str) -> io::Result<()> {
        let name = if want.is_empty() { DEFAULT_FONT } else { want };
        let font = match FONTS.iter().find(|(n, _)| *n == name) {
            Some((_, font)) => *font,
            // Named something we do not carry: say so and use the default rather
            // than leaving the console at 32 columns without explanation.
            None => {
                eprintln!(
                    "console        no {name} font, using {DEFAULT_FONT}; have {}",
                    FONTS.iter().map(|(n, _)| *n).collect::<Vec<_>>().join(" ")
                );
                FONTS
                    .iter()
                    .find(|(n, _)| *n == DEFAULT_FONT)
                    .expect("default font")
                    .1
            }
        };
        let (width, height, mut glyphs) = glyphs_of(font)?;

        let mut op = ConsoleFontOp {
            op: KD_FONT_OP_SET,
            flags: 0,
            width: width as libc::c_uint,
            height: height as libc::c_uint,
            charcount: GLYPHS as libc::c_uint,
            data: glyphs.as_mut_ptr(),
        };
        // On the VT itself: the font is per console, and tty0 would set it on
        // whichever happens to be in front.
        let tty = OpenOptions::new().read(true).write(true).open(self.tty_path())?;
        ioctl(&tty, KDFONTOP, &mut op)
    }
}

impl Drop for Console {
    fn drop(&mut self) {
        // Same reason as everywhere else: this VT may be in graphics mode, and a
        // switch away from one is ignored, which would strand the panel here.
        let _ = release_current_vt();
        let previous = libc::c_int::from(self.previous);
        // SAFETY: VT_ACTIVATE takes the number by value.
        unsafe {
            libc::ioctl(self.tty0.as_raw_fd(), VT_ACTIVATE, previous);
        }
        let _ = wait_active(self.previous);
        if let Some((console, framebuffer)) = self.remapped {
            let mut back = Con2FbMap { console, framebuffer };
            let _ = ioctl(&self.fb, FBIOPUT_CON2FBMAP, &mut back);
        }
    }
}

/// The VTs console apps may use.
///
/// Above logind's NAutoVTs, which is 6 by default: activating any VT at or below it
/// makes logind start a getty there, and that getty owns the terminal, so a program
/// cannot take it as its controlling terminal. A login prompt on the panel is the
/// same bug seen from the front.
///
/// Five of them, which is more console apps than a 256x144 panel will ever have
/// open at once.
pub const VTS: std::ops::RangeInclusive<u16> = 8..=12;

/// A console app, running.
///
/// Not modal: the program lives on a VT of its own and flipctl can take the panel
/// back whenever it likes, which is what makes switching away from one possible.
/// An inactive VT is not drawn and the program never knows, so backgrounding costs
/// nothing and needs no cooperation from it.
///
/// Ending it is the caller's decision. Dropping this puts the VT and its mapping
/// back but leaves the program alone, so a session can be dropped after the
/// program has already gone.
pub struct Session {
    /// The app's name, as the switcher knows it.
    pub name: String,
    /// Whether it paints its own pixels, so the console stays quiet for it.
    graphics: bool,
    console: Console,
    child: std::process::Child,
    mirror: Option<Mirror>,
}

impl Session {
    /// Take the panel and start `entry`'s command on a VT.
    ///
    /// The caller has to have let go of the panel first: one client owns a card at
    /// a time, and until flipctl drops master the console cannot paint.
    pub fn start(
        entry: &crate::app::AppEntry,
        vt: u16,
        // The screen the user was looking at, to hold until the program draws.
        handover: Option<&[u8]>,
    ) -> io::Result<Self> {
        use std::os::unix::process::CommandExt;

        let console = Console::take(vt, 0, entry.graphics)?;
        // What the panel shows until the program draws.
        //
        // A program that paints pixels gets the screen the user was looking at, so
        // the wait for its runtime to start looks like a wait rather than a glitch.
        //
        // A terminal cannot use that: fbcon repaints the cells that changed and
        // nothing else, so the frame underneath shows through the gaps and flipctl's
        // own screen appears mixed into htop. It gets black instead, which is a
        // console's own background and is what a fresh VT should look like. Without
        // it the framebuffer keeps the last app's pixels until fbcon gets around to
        // painting, which shows up as a flash of whatever ran before.
        let blank = vec![0u8; usize::from(crate::theme::PANEL_W) * usize::from(crate::theme::PANEL_H)];
        let first = if entry.graphics { handover } else { Some(blank.as_slice()) };
        if let Some(grey) = first {
            if let Err(e) = console.paint(grey) {
                eprintln!("console        first frame not drawn: {e}");
            }
        }
        // A terminal program needs the console keyboard; one that reads evdev
        // itself does not, and is better without it.
        if let Err(e) = console.keyboard(!entry.graphics) {
            eprintln!("console        keyboard mode not set on tty{vt}: {e}");
        }
        // Asserted after the switch as well as before it. Before is what stops fbcon
        // repainting the old text as it changes console; again afterwards because the
        // switch is the kernel's own redraw, and it leaves the console drawing its
        // cursor over the program's frame.
        if entry.graphics {
            if let Err(e) = console.graphics_mode() {
                eprintln!("console        tty{vt} not in graphics mode: {e}");
            }
        }
        // A font is for a terminal only, and only means anything in text mode.
        if !entry.graphics {
            if let Err(e) = console.set_font(&entry.font) {
                // Whichever cell the app asked for, or the default. Not fatal: a
                // console with the wrong font is still a console.
                eprintln!("console        font not loaded: {e}");
            }
        }
        // Last, so what appears is the frame painted above rather than whatever the
        // framebuffer happened to hold.
        if let Err(e) = console.claim_display() {
            eprintln!("console        display not claimed: {e}");
        }

        let tty = console.tty_path();
        let opened = |path: &str| OpenOptions::new().read(true).write(true).open(path);
        let (program, args) = entry.command();
        let mut command = std::process::Command::new(program);
        command
            .args(args)
            .current_dir(&entry.dir)
            .env("TERM", "linux")
            .stdin(opened(&tty)?)
            .stdout(opened(&tty)?)
            .stderr(opened(&tty)?);
        // Its own session with the VT as the controlling terminal, so curses can
        // size itself and so the whole thing can be signalled as one group: a
        // command line is run through a shell and may leave children behind.
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 {
                    return Err(io::Error::last_os_error());
                }
                // Stealing, and best effort. The 1 takes the terminal from another
                // session if one has it, which root may do; and a program with no
                // controlling terminal still draws, it only loses job control.
                libc::ioctl(0, libc::TIOCSCTTY, 1);
                Ok(())
            });
        }

        // Whatever the manifest asked for, after TERM so an app can override even
        // that: a framebuffer program has no use for it.
        for entry in &entry.env {
            if let Some((name, value)) = entry.split_once('=') {
                command.env(name, value);
            }
        }

        let child = command.spawn()?;
        eprintln!("console        {} on tty{vt}", entry.name);
        Ok(Self {
            name: entry.name.clone(),
            graphics: entry.graphics,
            console,
            child,
            // Best effort: without the mirror the browser view is blank, which is
            // not worth refusing to run a program over.
            //
            // Only for a program whose pixels land in the framebuffer. One that
            // takes DRM master draws somewhere flipctl cannot read, and reading
            // the fbdev shadow anyway returns the last thing written there, which
            // shows up in the browser view as another app entirely.
            mirror: entry
                .mirror
                .then(|| {
                    Mirror::open(0)
                        .inspect_err(|e| eprintln!("console        not mirrored: {e}"))
                        .ok()
                })
                .flatten(),
        })
    }

    /// Whether the program has ended, and with what.
    pub fn finished(&mut self) -> Option<std::process::ExitStatus> {
        self.child.try_wait().ok().flatten()
    }

    /// What the console has drawn, for the browser view and the switcher's card.
    ///
    /// None for an app that draws where flipctl cannot read, in which case there is
    /// nothing to show and saying so is the caller's business.
    pub fn frame(&mut self) -> Option<&[u8]> {
        self.mirror.as_mut().and_then(|m| m.frame().ok())
    }

    /// Whether there is any point asking for a frame.
    pub fn mirrored(&self) -> bool {
        self.mirror.is_some()
    }

    /// Put it in front. The caller drops DRM master first.
    ///
    /// There is no matching background: flipctl taking the panel back is what puts
    /// a console app away, since the console cannot paint while another client is
    /// master, whatever VT is in front. Which also means two console apps swap with
    /// a single switch, without the panel changing hands.
    pub fn foreground(&mut self, showing: Option<&[u8]>) -> io::Result<()> {
        // Pointed at the panel again first: only the app in front writes there.
        self.console.attach_fb()?;
        // The switch itself is what puts a terminal program back on the screen:
        // fbcon repaints the whole console from the characters the VT holds, which is
        // complete and immediate and needs nothing from the program. So a terminal
        // app is left alone from here. Painting over that redraw is what made htop
        // come back in pieces with black where it had not reached yet, because the
        // program was then made to draw a screen fbcon had already drawn correctly.
        self.console.foreground()?;
        // Re-asserted on every return: another program may have run on this VT in
        // the meantime and turned the keyboard off behind itself.
        if let Err(e) = self.console.keyboard(!self.graphics) {
            eprintln!("console        keyboard mode not set: {e}");
        }
        if self.graphics {
            // A program that paints pixels gets the opposite: the console is told to
            // stay quiet, and its own last frame goes up, so what appears is that
            // app rather than whatever the framebuffer held. It draws over this
            // within a frame or two.
            self.console.graphics_mode()?;
            if let Some(frame) = showing {
                if let Err(e) = self.console.paint(frame) {
                    eprintln!("console        handover frame not drawn: {e}");
                }
            }
        }
        Ok(())
    }

    /// Stop it drawing on the panel, without stopping it running.
    ///
    /// Its console is pointed back at the framebuffer it came from, which is the
    /// whole of it for a terminal program: all it does is write to its tty.
    ///
    /// A program that paints pixels opens /dev/fb0 itself, and there is one of those
    /// for the whole device, so nothing here can stop it writing where the app in
    /// front is drawing. That one is on the program: a pixel app checks whether its
    /// own VT is the one being displayed and skips the write if it is not, which
    /// costs a small read of sysfs per frame and leaves it running and up to date.
    /// Both of the Qt apps here do it, and it is the rule for anything we write.
    pub fn background(&mut self) -> io::Result<()> {
        // Deaf while it is not in front. Backgrounding takes the panel back but
        // leaves this VT the active console, so without this every key pressed while
        // browsing the deck is typed into the program: arrows moved mc's cursor while
        // the user was choosing which app to switch to. Foregrounding turns it back
        // on, which it already does for its own reasons.
        if let Err(e) = self.console.keyboard(false) {
            eprintln!("console        keyboard not silenced: {e}");
        }
        self.console.detach_fb()
    }

    /// The VT it runs on, so a caller handing out VTs knows which are taken.
    pub fn vt(&self) -> u16 {
        self.console.vt
    }

    /// End it: the group rather than the process, since the command line was run
    /// through a shell and the program is its child.
    pub fn stop(&mut self) {
        use std::time::{Duration, Instant};

        let group = -(self.child.id() as i32);
        // SAFETY: a negative pid signals the process group.
        unsafe {
            libc::kill(group, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        unsafe {
            libc::kill(group, libc::SIGKILL);
        }
        let _ = self.child.wait();
    }
}

/// A virtual keyboard, for keys that did not come from the buttons.
///
/// The physical buttons reach a console app on their own: the kernel's own
/// keyboard handler is attached to the MCU's input device, so a press goes to
/// whichever VT is in front without anything asking. What does not arrive is
/// anything flipctl was handed rather than read, above all the browser view's
/// simulated presses, which arrive on a socket and would otherwise stop at
/// flipctl's own key queue.
///
/// So those are put back into the input core through /dev/uinput, and the kernel
/// delivers them exactly as it delivers a real press.
pub struct Keyboard {
    fd: File,
}

// linux/uinput.h
const UI_DEV_CREATE: libc::c_ulong = 0x5501;
const UI_DEV_DESTROY: libc::c_ulong = 0x5502;
const UI_SET_EVBIT: libc::c_ulong = 0x40045564;
const UI_SET_KEYBIT: libc::c_ulong = 0x40045565;
const EV_SYN: u16 = 0x00;
const EV_KEY: u16 = 0x01;

/// What a console app is given: the pad and its centre, and nothing else.
///
/// Deliberately narrow. Everything else on the device belongs to flipctl while an
/// app is running: Escape leaves, Back leaves when held, and the soft keys are
/// flipctl's to reassign. The centre is in because a pad that cannot choose
/// anything is no use in a menu.
const FORWARDED: [(crate::FlipperKey, u16); 5] = [
    (crate::FlipperKey::Up, 103),
    (crate::FlipperKey::Down, 108),
    (crate::FlipperKey::Left, 105),
    (crate::FlipperKey::Right, 106),
    (crate::FlipperKey::Ok, 28),
];

impl Keyboard {
    pub fn open() -> io::Result<Self> {
        let fd = OpenOptions::new().write(true).open("/dev/uinput")?;
        // By value: uinput's ioctls take the bit to set in the argument itself,
        // unlike every other one here. Passed as a pointer, the kernel sets a bit
        // numbered by the address, which fails or enables something absurd, and
        // the device then looks like a keyboard with no keys.
        let set = |request: libc::c_ulong, value: libc::c_int| -> io::Result<()> {
            // SAFETY: the request takes an int, which is what is passed.
            if unsafe { libc::ioctl(fd.as_raw_fd(), request, value) } < 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        };
        set(UI_SET_EVBIT, libc::c_int::from(EV_KEY as i16))?;
        for (_, code) in FORWARDED {
            set(UI_SET_KEYBIT, libc::c_int::from(code as i16))?;
        }
        // struct uinput_user_dev: a name, an input_id, the force-feedback count,
        // and four absolute-axis tables this has no use for.
        let mut setup = Vec::with_capacity(1116);
        let mut name = [0u8; 80];
        let label = b"flipctl forwarded keys";
        name[..label.len()].copy_from_slice(label);
        setup.extend_from_slice(&name);
        // BUS_VIRTUAL, and a vendor and product of our own so this device is
        // recognisable in a log or an evdev listing.
        for word in [0x06u16, 0xf11c, 0x0001, 0x0001] {
            setup.extend_from_slice(&word.to_ne_bytes());
        }
        setup.extend_from_slice(&0u32.to_ne_bytes());
        setup.resize(1116, 0);
        {
            use std::io::Write;
            (&fd).write_all(&setup)?;
        }
        // SAFETY: UI_DEV_CREATE takes no argument.
        if unsafe { libc::ioctl(fd.as_raw_fd(), UI_DEV_CREATE, 0) } < 0 {
            return Err(io::Error::last_os_error());
        }
        // The kernel announces the device and udev settles it; a press written
        // before that is delivered to nothing.
        std::thread::sleep(std::time::Duration::from_millis(200));
        Ok(Self { fd })
    }

    /// Press or release a key, if it is one a console app is given.
    ///
    /// Returns whether it was forwarded, so a caller can tell the difference
    /// between a key meant for the app and one meant for flipctl.
    pub fn forward(&mut self, event: crate::KeyEvent) -> io::Result<bool> {
        let Some((_, code)) = FORWARDED.iter().find(|(key, _)| *key == event.key) else {
            return Ok(false);
        };
        self.emit(EV_KEY, *code, i32::from(event.down))?;
        // Without the report the kernel holds the change: an input frame is only
        // complete at its SYN.
        self.emit(EV_SYN, 0, 0)?;
        Ok(true)
    }

    fn emit(&mut self, kind: u16, code: u16, value: i32) -> io::Result<()> {
        use std::io::Write;
        // struct input_event: a timeval the kernel fills in for us, then the
        // three fields that matter.
        let mut event = Vec::with_capacity(24);
        event.extend_from_slice(&0i64.to_ne_bytes());
        event.extend_from_slice(&0i64.to_ne_bytes());
        event.extend_from_slice(&kind.to_ne_bytes());
        event.extend_from_slice(&code.to_ne_bytes());
        event.extend_from_slice(&value.to_ne_bytes());
        self.fd.write_all(&event)
    }
}

impl Drop for Keyboard {
    fn drop(&mut self) {
        // SAFETY: UI_DEV_DESTROY takes no argument.
        unsafe {
            libc::ioctl(self.fd.as_raw_fd(), UI_DEV_DESTROY, 0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{glyphs_of, DEFAULT_FONT, FONTS};

    /// Every embedded font arrives at the console as the characters it claims.
    ///
    /// These are generated by the two scripts in tools/, and a bad conversion is
    /// invisible until a console comes up full of garbage on a device: the console
    /// draws whatever bytes it is given. The checks that matter are on the mapped
    /// result rather than the file, because the mapping is where it goes wrong: a
    /// stray hex byte per glyph shifted every character by one in the first cut of
    /// the kernel-font script, and a 512-glyph font carries a table that decides
    /// which glyph is which letter.
    #[test]
    fn the_embedded_fonts_are_usable() {
        for (name, font) in FONTS {
            let (width, height, glyphs) = glyphs_of(font).expect(name);
            // The name says the cell, so a mislabelled file is a wrong screen size.
            assert_eq!(name, format!("{width}x{height}"), "{name}: mislabelled");
            let of = |c: char| {
                let at = (c as usize) * 32;
                &glyphs[at..at + height]
            };
            // Space blank, or the console draws a block behind every gap.
            assert!(of(' ').iter().all(|b| *b == 0), "{name}: space is not blank");
            // And the letters have to be there: a file of zeroes passes anything
            // that only looks at sizes.
            for c in ['A', 'z', '0', '%'] {
                assert!(of(c).iter().any(|b| *b != 0), "{name}: {c:?} is blank");
            }
            // A is symmetric in every one of these fonts, and its top row is not
            // its widest: a glyph pulled from the wrong offset fails this long
            // before anyone looks at a panel.
            let a = of('A');
            let ink = a.iter().filter(|b| **b != 0).count();
            assert!(ink >= height / 2, "{name}: A has ink on {ink} of {height} rows");
        }
        assert!(FONTS.iter().any(|(n, _)| *n == DEFAULT_FONT), "no default font");
    }
}
