//! Apps hosted in a compositor of their own.
//!
//! An app gets a `cage` instance with one headless output the size of the panel,
//! and nothing else: no DRM device, no framebuffer, no VT, no input device. It
//! draws as an ordinary Wayland client, we read its output with wlr-screencopy and
//! we drive it with a virtual keyboard. flipctl keeps the panel throughout, so
//! there is no handover to get wrong and no way for an app to reach HDMI.
//!
//! Why not the kernel's VT, which this replaces: fbcon paints only the globally
//! active console, whatever framebuffer a console is mapped to, and on a machine
//! with a desktop the active VT belongs to that desktop's session. Taking it makes
//! logind pause the session's devices, which blanks the desktop. Measured, on a
//! `@Desktop` build, with the television going black.

use std::ffi::CString;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::os::fd::{AsFd, FromRawFd, OwnedFd};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use wayland_client::protocol::{
    wl_buffer, wl_output, wl_registry, wl_seat, wl_shm, wl_shm_pool,
};
use wayland_client::{delegate_noop, Connection, Dispatch, EventQueue, QueueHandle};
#[cfg(feature = "gpu")]
use wayland_protocols::wp::linux_dmabuf::zv1::client::{
    zwp_linux_buffer_params_v1::{self, ZwpLinuxBufferParamsV1},
    zwp_linux_dmabuf_v1::ZwpLinuxDmabufV1,
};
use wayland_protocols_misc::zwp_virtual_keyboard_v1::client::{
    zwp_virtual_keyboard_manager_v1::ZwpVirtualKeyboardManagerV1,
    zwp_virtual_keyboard_v1::ZwpVirtualKeyboardV1,
};
use wayland_protocols_wlr::screencopy::v1::client::{
    zwlr_screencopy_frame_v1::{self, ZwlrScreencopyFrameV1},
    zwlr_screencopy_manager_v1::ZwlrScreencopyManagerV1,
};

/// How often a hosted app's own output refreshes, in Hz.
///
/// This is the app's pace, not the panel's, and it sets the floor under a frame's
/// latency: the reader waits for the app to draw, so at 60 Hz up to 16.6 ms of every
/// frame is spent waiting. Measured with Doom at 60 Hz: a frame arrived every 28.6 ms,
/// 16.6 of it the wait and 12 the conversion. Raising it shortens only the wait, and
/// costs the app whatever it spends drawing more often.
///
/// `FLIPCTL_APP_HZ` overrides it, which is how the numbers above were taken.
pub fn app_refresh() -> u32 {
    std::env::var("FLIPCTL_APP_HZ")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|hz| (1..=240).contains(hz))
        .unwrap_or(60)
}

/// The keymap handed to the virtual keyboard, and so to the app.
///
/// Written out rather than compiled from xkeyboard-config, both to keep
/// libxkbcommon and its data files off the dependency list and because the device
/// has ten keys, not a hundred. Keycodes are evdev codes plus 8, which is what XKB
/// counts in; the protocol carries the evdev code and the compositor adds the
/// offset. One level, no modifiers: there is no shift key to hold.
pub(crate) const KEYMAP: &str = r#"xkb_keymap {
xkb_keycodes "flipctl" {
    minimum = 8;
    maximum = 255;
    <ESC>  =   9;
    <BKSP> =  22;
    <TAB>  =  23;
    <RTRN> =  36;
    <FK01> =  67;
    <FK02> =  68;
    <FK03> =  69;
    <FK04> =  70;
    <FK05> =  71;
    <AC01> =  38;
    <AB01> =  56;
    <AB02> =  54;
    <AB03> =  52;
    <AB04> =  53;
    <AB05> =  55;
    <UP>   = 111;
    <LEFT> = 113;
    <RGHT> = 114;
    <DOWN> = 116;
};
xkb_types "flipctl" {
    type "ONE_LEVEL" {
        modifiers = none;
        level_name[Level1] = "Any";
    };
};
xkb_compat "flipctl" {
    interpret Any + AnyOf(all) { action = NoAction(); };
};
xkb_symbols "flipctl" {
    key <ESC>  { [ Escape ] };
    key <BKSP> { [ BackSpace ] };
    key <TAB>  { [ Tab ] };
    key <RTRN> { [ Return ] };
    key <UP>   { [ Up ] };
    key <DOWN> { [ Down ] };
    key <LEFT> { [ Left ] };
    key <RGHT> { [ Right ] };
    key <FK01> { [ F1 ] };
    key <FK02> { [ F2 ] };
    key <FK03> { [ F3 ] };
    key <FK04> { [ F4 ] };
    key <FK05> { [ F5 ] };
    key <AC01> { [ a ] };
    key <AB01> { [ b ] };
    key <AB02> { [ c ] };
    key <AB03> { [ z ] };
    key <AB04> { [ x ] };
    key <AB05> { [ v ] };
};
};
"#;

/// An app running in its own compositor.
///
/// Frames are read on a thread of their own, not on the caller's. The two costs of
/// showing a hosted app are a readback from its compositor and a transfer to the
/// panel, measured at 14.6 ms and 20.7 ms, and they used to happen one after the
/// other for a total of 35 ms a frame. They contend for nothing: one waits on the
/// GPU, the other on a 20 MHz SPI bus. Read on a thread, the next frame arrives while
/// the last one is still going out, and the ceiling becomes the slower of the two
/// rather than their sum.
pub struct Session {
    cage: Child,
    keyboard: ZwpVirtualKeyboardV1,
    started: Instant,
    dir: PathBuf,
    conn: Connection,
    frames: Arc<Frames>,
    reader: Option<std::thread::JoinHandle<()>>,
    /// The generation this session last handed out, so a caller can be told "nothing
    /// new" without comparing 36KB.
    seen: u64,
    /// What the reader was last told, so telling it again is free.
    streaming: bool,
}

/// The handover between the thread that reads frames and the loop that shows them.
///
/// Latest-wins rather than a queue: a frame nobody managed to show is worth nothing,
/// and holding it would only delay the one after it.
struct Frames {
    latest: Mutex<Option<(u64, Arc<Vec<u8>>)>>,
    want: Mutex<Want>,
    woken: Condvar,
    stop: AtomicBool,
}

/// What the reader has been asked for. Continuous while an app is on the panel, one
/// frame at a time for a card, and nothing at all otherwise: a capture nobody is
/// waiting for is the cost we deliberately stopped paying.
#[derive(Default)]
struct Want {
    streaming: bool,
    once: bool,
}

/// One connection, and what it takes to read frames over it.
///
/// Shared by two callers with the same need and different reasons: an app in its
/// own cage, and the compositor that owns the panel, whose output is whatever is in
/// front. Both want "give me the current frame as grey8", and neither wants to know
/// how screencopy negotiates a buffer.
struct Grab {
    conn: Connection,
    queue: EventQueue<State>,
    state: State,
    shm_global: wl_shm::WlShm,
    shm: Option<Shm>,
    /// What the app draws at, which is what the capture is.
    w: u32,
    h: u32,
    /// What the panel takes.
    dw: u32,
    dh: u32,
    /// The two buffers screencopy copies into, and the request outstanding on each.
    #[cfg(feature = "gpu")]
    buffers: [Option<Copied>; 2],
    #[cfg(feature = "gpu")]
    pending: [Option<ZwlrScreencopyFrameV1>; 2],
}

/// A `wl_buffer` over the dmabuf we allocated, and the size it was made for.
#[cfg(feature = "gpu")]
struct Copied {
    buffer: wl_buffer::WlBuffer,
    size: (u32, u32),
}

/// Shared memory the compositor copies a frame into.
///
/// Built to screencopy's own description rather than to what we would have
/// guessed: it names the format and stride it will write, and refuses a buffer
/// that disagrees. On this device it asks for XBGR8888, not the XRGB the panel
/// takes, which is why the conversion reads the channel order from here.
struct Shm {
    buffer: wl_buffer::WlBuffer,
    map: *mut u8,
    len: usize,
    format: wl_shm::Format,
    stride: u32,
}

// Safety: the mapping is created, used and unmapped by the `Shm` that owns it, and a
// `Grab` (which owns the `Shm`) is moved onto the reader thread and touched from
// nowhere else. Nothing here is shared between threads; it is handed over.
unsafe impl Send for Shm {}

impl Drop for Shm {
    fn drop(&mut self) {
        unsafe { libc::munmap(self.map.cast(), self.len) };
    }
}

#[derive(Default)]
struct Capture {
    format: Option<wl_shm::Format>,
    stride: u32,
    width: u32,
    height: u32,
    ready: bool,
    failed: bool,
    described: bool,
}

struct State {
    output: Option<wl_output::WlOutput>,
    seat: Option<wl_seat::WlSeat>,
    shm: Option<wl_shm::WlShm>,
    screencopy: Option<ZwlrScreencopyManagerV1>,
    keyboards: Option<ZwpVirtualKeyboardManagerV1>,
    /// One per buffer, because a request is outstanding on each: a single set of flags
    /// would have the two frames answering for each other.
    capture: [Capture; 2],
    /// The factory for wrapping our dmabuf as a `wl_buffer`.
    #[cfg(feature = "gpu")]
    dmabuf: Option<ZwpLinuxDmabufV1>,
    /// What screencopy says a dmabuf copy needs: format and size.
    #[cfg(feature = "gpu")]
    offered: Option<(u32, u32, u32)>,
}

impl Grab {
    /// Read whatever the compositor has to say, waiting at most until `deadline`.
    ///
    /// Returns false when the wait ran out. `blocking_dispatch` cannot do this: it
    /// has no deadline, so a compositor with nothing to say blocks forever and the
    /// caller's timeout never gets a chance to fire.
    fn pump(&mut self, deadline: Instant) -> io::Result<bool> {
        self.conn.flush().map_err(io::Error::other)?;
        if let Some(guard) = self.conn.prepare_read() {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Ok(false);
            }
            let mut fd = libc::pollfd {
                fd: {
                    use std::os::fd::AsRawFd;
                    self.conn.as_fd().as_raw_fd()
                },
                events: libc::POLLIN,
                revents: 0,
            };
            let ms = left.as_millis().min(i32::MAX as u128) as i32;
            let n = unsafe { libc::poll(&mut fd, 1, ms) };
            if n < 0 {
                return Err(io::Error::last_os_error());
            }
            if n == 0 {
                return Ok(false);
            }
            guard.read().map_err(io::Error::other)?;
        }
        self.queue
            .dispatch_pending(&mut self.state)
            .map_err(io::Error::other)?;
        Ok(true)
    }


    /// Capture as soon as the app draws something new, or give up at `timeout`.
    ///
    /// This is a frame callback rather than a poll: the compositor holds the copy
    /// until the output actually changes, so an idle app costs nothing, a busy one
    /// is read once per frame we ask for, and a starting one is waited for rather
    /// than captured blank.
    pub fn frame(&mut self, timeout: Duration, out: &mut [u8]) -> io::Result<bool> {
        self.capture(timeout, true, out)
    }

    /// Capture whatever is on the output now, changed or not.
    pub fn frame_now(&mut self, timeout: Duration, out: &mut [u8]) -> io::Result<bool> {
        self.capture(timeout, false, out)
    }

    /// Ask the compositor to copy the next frame into the buffer in `slot`.
    ///
    /// Returns without waiting: the point of two buffers is that the copy runs while
    /// the other frame is being converted and put on the panel.
    #[cfg(feature = "gpu")]
    fn request_copy(
        &mut self,
        converter: &mut crate::gpu::Converter,
        slot: usize,
        timeout: Duration,
    ) -> io::Result<bool> {
        let manager = self.state.screencopy.clone().unwrap();
        let output = self.state.output.clone().unwrap();
        let Some(dmabuf) = self.state.dmabuf.clone() else {
            return Err(io::Error::other("compositor has no linux-dmabuf"));
        };
        let qh = self.queue.handle();

        self.state.capture[slot] = Capture::default();
        self.state.offered = None;
        let frame = manager.capture_output(0, &output, &qh, slot);

        // The compositor says what a dmabuf copy needs before anything is allocated.
        let deadline = Instant::now() + timeout;
        while !self.state.capture[slot].described {
            if !self.pump(deadline)? || self.state.capture[slot].failed {
                frame.destroy();
                return Ok(false);
            }
        }
        let Some((fourcc, w, h)) = self.state.offered else {
            frame.destroy();
            return Err(io::Error::other("screencopy offered no dmabuf"));
        };

        // One buffer per slot for as long as the size holds: allocating is an export
        // and a round trip, and the size changes only when the app's output does.
        if self.buffers[slot].as_ref().is_none_or(|b| b.size != (w, h)) {
            // In the format screencopy named, because a buffer the compositor will not
            // take is a fatal protocol error rather than a refusal.
            let target = converter.allocate(slot, fourcc, w, h)?;
            let params = dmabuf.create_params(&qh, ());
            for (index, plane) in target.planes.iter().enumerate() {
                params.add(
                    plane.fd.as_fd(),
                    index as u32,
                    plane.offset,
                    plane.stride,
                    (target.modifier >> 32) as u32,
                    (target.modifier & 0xffff_ffff) as u32,
                );
            }
            let buffer = params.create_immed(
                w as i32,
                h as i32,
                target.fourcc,
                zwp_linux_buffer_params_v1::Flags::empty(),
                &qh,
                (),
            );
            params.destroy();
            self.buffers[slot] = Some(Copied { buffer, size: (w, h) });
        }
        let buffer = self.buffers[slot].as_ref().unwrap().buffer.clone();

        // Plain `copy`, always. `copy_with_damage` waits for damage *after* the request
        // and copies on the repaint after that, so two of the compositor's frames go by
        // for each of ours: it measured 30ms a frame where a plain copy needs one
        // repaint. A still app then produces identical frames, which is answered by not
        // publishing a frame that has not changed.
        frame.copy(&buffer);
        self.pending[slot] = Some(frame);
        Ok(true)
    }

    /// Wait for the copy in `slot`, then convert it into `out`.
    ///
    /// `zwlr_screencopy` rather than the deprecated `zwlr_export_dmabuf`: the export
    /// protocol hands over the compositor's front buffer, which it goes on drawing
    /// into, so a converted frame can be from another moment. A copy into a buffer we
    /// own is finished when `ready` arrives. It costs a wait for the compositor's next
    /// repaint, which is what the second buffer is for.
    #[cfg(feature = "gpu")]
    fn collect_copy(
        &mut self,
        converter: &mut crate::gpu::Converter,
        slot: usize,
        timeout: Duration,
        out: &mut [u8],
    ) -> io::Result<bool> {
        let Some(frame) = self.pending[slot].take() else {
            return Ok(false);
        };
        let deadline = Instant::now() + timeout;
        while !self.state.capture[slot].ready {
            if !self.pump(deadline)? || self.state.capture[slot].failed {
                frame.destroy();
                return Ok(false);
            }
        }
        frame.destroy();
        converter.convert_into(slot, false, out)?;
        Ok(true)
    }

    fn capture(
        &mut self,
        timeout: Duration,
        on_change: bool,
        out: &mut [u8],
    ) -> io::Result<bool> {
        let manager = self.state.screencopy.clone().unwrap();
        let output = self.state.output.clone().unwrap();
        let qh = self.queue.handle();

        self.state.capture[0] = Capture::default();
        let frame = manager.capture_output(0, &output, &qh, 0usize);

        let deadline = Instant::now() + timeout;
        while !self.state.capture[0].described {
            if !self.pump(deadline)? || self.state.capture[0].failed {
                frame.destroy();
                return Ok(false);
            }
        }
        if !self.state.capture[0].described {
            frame.destroy();
            return Ok(false);
        }

        let format = match self.state.capture[0].format {
            Some(f) => f,
            None => {
                frame.destroy();
                return Err(io::Error::other("screencopy named no format"));
            }
        };
        let stride = self.state.capture[0].stride;
        let height = self.state.capture[0].height;
        let stale = self
            .shm
            .as_ref()
            .is_none_or(|s| s.format != format || s.stride != stride);
        if stale {
            self.shm = Some(Shm::new(&self.shm_global, &qh, format, stride, height)?);
        }
        let buffer = self.shm.as_ref().unwrap().buffer.clone();

        if on_change {
            frame.copy_with_damage(&buffer);
        } else {
            frame.copy(&buffer);
        }
        while !self.state.capture[0].ready {
            if !self.pump(deadline)? || self.state.capture[0].failed {
                frame.destroy();
                return Ok(false);
            }
        }
        frame.destroy();

        self.to_panel(out);
        Ok(true)
    }

    /// The capture, scaled to the panel and greyed, in one pass.
    ///
    /// Everything the panel needs and nothing it does not. The frame arrives 32-bit
    /// and at the app's own size; it used to be greyed at that size, scaled in a
    /// second pass, expanded back to 32-bit for the dumb buffer and reduced again by
    /// the driver. The luma is the kernel's own, so a frame we grey and a frame
    /// `drm_fb_xrgb8888_to_gray8` greys agree.
    fn to_panel(&mut self, out: &mut [u8]) {
        let Some(shm) = self.shm.as_ref() else { return };
        let bgr = matches!(
            shm.format,
            wl_shm::Format::Xrgb8888 | wl_shm::Format::Argb8888
        );
        let src = unsafe { std::slice::from_raw_parts(shm.map, shm.len) };
        // Letterbox bars are the caller's black, not the last frame's edges.
        out.fill(0);
        crate::scale::fit_from_xrgb(
            src,
            shm.stride,
            bgr,
            self.w,
            self.h,
            crate::pixel::from_bytes_mut(out),
            self.dw,
            self.dh,
        );
    }
}

impl Session {
    /// Launch `command` inside its own compositor, sized `w` by `h`.
    ///
    /// The command runs under `cage`, which hosts exactly one app and exits with
    /// it, so a dead app is a closed socket rather than something to reap and
    /// notice. The headless output starts at cage's default size and is set to
    /// ours with `wlr-randr`, the one part still shelling out: output management is
    /// a protocol we could speak directly, and it happens once per launch.
    pub fn launch(command: &str, w: u32, h: u32) -> io::Result<Self> {
        Self::launch_in(command, Path::new("."), w, h, &[])
    }

    /// The same, from `dir`, with `env` as `KEY=VALUE` pairs from the manifest.
    ///
    /// The directory matters more than it looks: an app's own config files are
    /// named relative to it, so Doom reads its key bindings only from its app
    /// directory.
    pub fn launch_in(
        command: &str,
        dir_of_app: &Path,
        w: u32,
        h: u32,
        env: &[String],
    ) -> io::Result<Self> {
        // A runtime directory per app, so the socket path is ours to know rather
        // than ours to guess. Watching XDG_RUNTIME_DIR for a new `wayland-N` looks
        // simpler and does not work: a killed compositor leaves its socket file
        // behind with no live lock holder, so the next one rebinds the same name and
        // a directory diff sees nothing appear. An empty directory has no such
        // history, and the app gets a runtime dir of its own into the bargain.
        let dir = private_runtime_dir()?;
        let socket = dir.join("wayland-0");

        // The app waits for us to size its output before it starts. Without the gate
        // it maps against cage's 1280x720 default and only then gets a configure for
        // the real size, which a terminal takes as a grid of the wrong shape: mc came
        // up sized for a screen it never had.
        let go = dir.join("go");
        let gated = format!(
            "while [ ! -e {} ]; do sleep 0.02; done; exec {command}",
            go.display()
        );

        let mut cmd = Command::new("cage");
        cmd.arg("--")
            .arg("/bin/sh")
            .arg("-c")
            .arg(&gated)
            .current_dir(dir_of_app)
            .env("WLR_BACKENDS", "headless")
            .env("WLR_LIBINPUT_NO_DEVICES", "1")
            .env("WLR_HEADLESS_OUTPUTS", "1")
            .env("XDG_RUNTIME_DIR", &dir)
            // What each toolkit needs to pick the Wayland backend rather than
            // looking for a DRM device or an X server. Set here because it is what
            // hosting means: an app in a cage has no other way out.
            .env("QT_QPA_PLATFORM", "wayland")
            .env("SDL_VIDEODRIVER", "wayland")
            // SDL prefers libdecor for client-side decorations whenever the library
            // is present, and `libdecor-0-0` is installed here while none of its
            // plugin packages are. It then reports "no plugins found, falling back on
            // no decorations" and never completes the configure handshake, so the
            // client never commits a buffer: Doom reached window creation, drew
            // nothing, and the cage's output read back as 320x200 of pure black.
            // The compositor offers server-side decorations anyway, and an app here
            // has no titlebar to draw in the first place.
            .env("SDL_VIDEO_WAYLAND_ALLOW_LIBDECOR", "0")
            .env("GDK_BACKEND", "wayland")
            .env("CLUTTER_BACKEND", "wayland")
            .env_remove("WAYLAND_DISPLAY")
            .env_remove("WAYLAND_SOCKET")
            .stdin(Stdio::null());
        for pair in env {
            if let Some((name, value)) = pair.split_once('=') {
                cmd.env(name, value);
            }
        }
        // Its own process group, so stopping the app means stopping the group. The
        // cage is the direct child, the shell is its child and the program is the
        // shell's, and killing only what we spawned leaves a game running with no
        // window and no card.
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        // `panic = "abort"` means no Drop runs on a panic, so a crash would leave a
        // compositor and its app behind. The kernel can promise what Drop cannot.
        unsafe {
            use std::os::unix::process::CommandExt;
            cmd.pre_exec(|| {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let cage = cmd.spawn()?;

        if !wait_for(&socket, Duration::from_secs(10)) {
            return Err(io::Error::other(format!(
                "cage never bound {}",
                socket.display()
            )));
        }

        // With a refresh rate, always. A custom mode with none leaves the headless
        // output's frame timer at whatever wlroots makes of a zero, and a client that
        // paces itself on frame callbacks then draws once and waits: Doom came out at
        // 0.2 fps and a blank panel, its first frame captured before it had drawn
        // anything.
        let status = Command::new("wlr-randr")
            .args(["--output", "HEADLESS-1", "--custom-mode"])
            .arg(format!("{w}x{h}@{}", app_refresh()))
            .env("WAYLAND_DISPLAY", "wayland-0")
            .env("XDG_RUNTIME_DIR", &dir)
            .stdout(Stdio::null())
            .status();
        if !matches!(status, Ok(s) if s.success()) {
            eprintln!("wl: could not set {w}x{h}, output stays at cage's default");
        }
        // Sized, so the app may start.
        std::fs::write(&go, b"")?;

        let stream = UnixStream::connect(&socket)?;
        let conn = Connection::from_socket(stream).map_err(io::Error::other)?;
        let (globals, mut queue) = wayland_client::globals::registry_queue_init::<State>(&conn)
            .map_err(io::Error::other)?;
        let qh = queue.handle();

        let mut state = State {
            output: None,
            seat: None,
            shm: None,
            screencopy: None,
            keyboards: None,
            capture: [Capture::default(), Capture::default()],
            #[cfg(feature = "gpu")]
            dmabuf: None,
            #[cfg(feature = "gpu")]
            offered: None,
        };
        for g in globals.contents().clone_list() {
            match g.interface.as_str() {
                "wl_output" => {
                    state.output = Some(globals.registry().bind(g.name, 1.min(g.version), &qh, ()))
                }
                "wl_seat" => {
                    state.seat = Some(globals.registry().bind(g.name, 1.min(g.version), &qh, ()))
                }
                "wl_shm" => {
                    state.shm = Some(globals.registry().bind(g.name, 1.min(g.version), &qh, ()))
                }
                "zwlr_screencopy_manager_v1" => {
                    state.screencopy =
                        Some(globals.registry().bind(g.name, 3.min(g.version), &qh, ()))
                }
                #[cfg(feature = "gpu")]
                "zwp_linux_dmabuf_v1" if g.version >= 3 => {
                    state.dmabuf = Some(globals.registry().bind(g.name, 3.min(g.version), &qh, ()))
                }
                "zwp_virtual_keyboard_manager_v1" => {
                    state.keyboards =
                        Some(globals.registry().bind(g.name, 1.min(g.version), &qh, ()))
                }
                _ => {}
            }
        }

        let missing = |what: &str| io::Error::other(format!("compositor has no {what}"));
        let seat = state.seat.clone().ok_or_else(|| missing("wl_seat"))?;
        let manager = state.keyboards.clone().ok_or_else(|| missing("virtual keyboard"))?;
        let shm_global = state.shm.clone().ok_or_else(|| missing("wl_shm"))?;
        state.screencopy.clone().ok_or_else(|| missing("screencopy"))?;
        state.output.clone().ok_or_else(|| missing("wl_output"))?;

        let keyboard = manager.create_virtual_keyboard(&seat, &qh, ());
        let keymap = memfd("flipctl-keymap", KEYMAP.as_bytes())?;
        keyboard.keymap(1, keymap.as_fd(), KEYMAP.len() as u32);

        conn.roundtrip().map_err(io::Error::other)?;
        queue.roundtrip(&mut state).map_err(io::Error::other)?;

        let grab = Grab {
            conn: conn.clone(),
            queue,
            state,
            shm_global,
            shm: None,
            w,
            h,
            dw: u32::from(crate::PANEL_W),
            dh: u32::from(crate::PANEL_H),
            #[cfg(feature = "gpu")]
            buffers: [None, None],
            #[cfg(feature = "gpu")]
            pending: [None, None],
        };

        let frames = Arc::new(Frames {
            latest: Mutex::new(None),
            want: Mutex::new(Want::default()),
            woken: Condvar::new(),
            stop: AtomicBool::new(false),
        });
        let reader = std::thread::Builder::new()
            .name("flipctl-capture".into())
            .spawn({
                let frames = frames.clone();
                move || read_frames(grab, frames)
            })?;

        Ok(Self {
            cage,
            keyboard,
            started: Instant::now(),
            dir,
            conn,
            frames,
            reader: Some(reader),
            seen: 0,
            streaming: false,
        })
    }

    /// True while the app is still running.
    pub fn alive(&mut self) -> bool {
        matches!(self.cage.try_wait(), Ok(None))
    }

    /// Press or release one key, by evdev code.
    pub fn key(&mut self, code: u32, down: bool) {
        let ms = self.started.elapsed().as_millis() as u32;
        self.keyboard.key(ms, code, u32::from(down));
        let _ = self.conn.flush();
    }

    /// Read frames continuously, or stop. Set for the app on the panel and cleared
    /// when it leaves, so a backgrounded app costs nothing.
    pub fn stream(&mut self, on: bool) {
        if self.streaming == on {
            return;
        }
        self.streaming = on;
        if let Ok(mut want) = self.frames.want.lock() {
            want.streaming = on;
        }
        self.frames.woken.notify_all();
    }

    /// Ask for one frame, whether the app has drawn or not. For a card.
    pub fn snap(&self) {
        if let Ok(mut want) = self.frames.want.lock() {
            want.once = true;
        }
        self.frames.woken.notify_all();
    }

    /// The newest frame, if it is one this session has not handed out before.
    pub fn fresh(&mut self) -> Option<Arc<Vec<u8>>> {
        let (gen, frame) = self.frames.latest.lock().ok()?.clone()?;
        if gen == self.seen {
            return None;
        }
        self.seen = gen;
        Some(frame)
    }

    /// The newest frame, new or not. For the moment an app comes to the front, where
    /// what matters is that something is shown rather than that it has changed.
    pub fn latest(&mut self) -> Option<Arc<Vec<u8>>> {
        let (gen, frame) = self.frames.latest.lock().ok()?.clone()?;
        self.seen = gen;
        Some(frame)
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // The reader first, or it would go on reading from a compositor being killed.
        self.frames.stop.store(true, Ordering::Release);
        self.frames.woken.notify_all();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        // The group next: a killed cage cannot take its app with it, so signalling
        // only the cage leaves the program behind, holding whatever it holds.
        crate::app::stop_group(self.cage.id());
        let _ = self.cage.kill();
        let _ = self.cage.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

impl Shm {
    fn new(
        shm: &wl_shm::WlShm,
        qh: &QueueHandle<State>,
        format: wl_shm::Format,
        stride: u32,
        height: u32,
    ) -> io::Result<Self> {
        let len = (stride * height) as usize;
        let fd = memfd("flipctl-frame", &vec![0u8; len])?;
        let pool = shm.create_pool(fd.as_fd(), len as i32, qh, ());
        let buffer = pool.create_buffer(
            0,
            (stride / 4) as i32,
            height as i32,
            stride as i32,
            format,
            qh,
            (),
        );
        pool.destroy();
        let map = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                len,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                fd.as_raw_fd_compat(),
                0,
            )
        };
        if map == libc::MAP_FAILED {
            return Err(io::Error::last_os_error());
        }
        Ok(Self { buffer, map: map.cast(), len, format, stride })
    }
}

trait RawFdCompat {
    fn as_raw_fd_compat(&self) -> i32;
}
impl RawFdCompat for OwnedFd {
    fn as_raw_fd_compat(&self) -> i32 {
        use std::os::fd::AsRawFd;
        self.as_raw_fd()
    }
}

/// Read frames for one app until its session goes away.
///
/// Waits rather than polls: with nothing wanted the thread sleeps on the condvar, and
/// while streaming it blocks in the compositor's own damage report, so an app that is
/// not drawing costs nothing and one that is costs a readback.
fn read_frames(mut grab: Grab, frames: Arc<Frames>) {
    let mut generation = 0u64;
    // Which of the two buffers the outstanding request belongs to.
    #[cfg(feature = "gpu")]
    let mut slot = 0usize;
    // Built here rather than handed over: an EGL context is current on the thread that
    // created it, and this is the thread that will use it.
    // FLIPCTL_NO_GPU takes the CPU pass instead, which is how "is it the GPU path or
    // the capture" gets answered in one binary.
    #[cfg(feature = "gpu")]
    let mut gpu = if std::env::var_os("FLIPCTL_NO_GPU").is_some() {
        eprintln!("wl: GPU conversion disabled, reading on the CPU");
        None
    } else {
        match crate::gpu::Converter::new(
        u32::from(crate::PANEL_W),
        u32::from(crate::PANEL_H),
    ) {
            Ok(c) => {
                eprintln!("wl: frames converted on the GPU");
                Some(c)
            }
            Err(e) => {
                eprintln!("wl: no GPU conversion ({e}), reading on the CPU");
                None
            }
        }
    };
    // One request in flight before the first collection, or there would be nothing to
    // collect and every frame would pay the compositor's wait in full.
    #[cfg(feature = "gpu")]
    if let Some(converter) = gpu.as_mut() {
        if let Err(e) = grab.request_copy(converter, slot, Duration::from_millis(120)) {
            eprintln!("wl: GPU capture unusable ({e}), reading on the CPU");
            gpu = None;
        }
    }

    loop {
        if frames.stop.load(Ordering::Acquire) {
            return;
        }
        let (streaming, once) = {
            let Ok(mut want) = frames.want.lock() else {
                return;
            };
            while !want.streaming && !want.once && !frames.stop.load(Ordering::Acquire) {
                let Ok((guard, _)) = frames.woken.wait_timeout(want, Duration::from_millis(200))
                else {
                    return;
                };
                want = guard;
            }
            let asked = (want.streaming, want.once);
            want.once = false;
            asked
        };
        if frames.stop.load(Ordering::Acquire) {
            return;
        }
        // Streaming waits for the app to draw; a one-off takes what is there, because
        // a card wants a picture rather than a change.
        // The GPU path takes whatever the compositor has, so a still app costs a frame
        // rather than a wait. Damage-waiting stays on the CPU path, which is the one
        // that cannot afford a frame it does not need.
        let mut next = vec![0u8; usize::from(crate::PANEL_W) * usize::from(crate::PANEL_H)];
        #[cfg(feature = "gpu")]
        let taken = match gpu.as_mut() {
            Some(converter) => {
                // Collect the copy that was asked for last time round, then ask for the
                // next one straight away, so the compositor's copy overlaps the
                // conversion and the panel commit rather than following them.
                let ready = grab.collect_copy(
                    converter,
                    slot,
                    Duration::from_millis(120),
                    &mut next,
                );
                let outcome = match ready {
                    Ok(got) => {
                        slot = 1 - slot;
                        match grab.request_copy(converter, slot, Duration::from_millis(120)) {
                            Ok(_) => Ok(got),
                            Err(e) => Err(e),
                        }
                    }
                    Err(e) => Err(e),
                };
                match outcome {
                    Ok(got) => Ok(got),
                    Err(e) => {
                        // Said once: a capture that cannot work will not start working,
                        // and the CPU path shows the app meanwhile.
                        eprintln!("wl: GPU capture unusable ({e}), reading on the CPU");
                        gpu = None;
                        grab.frame(Duration::from_millis(120), &mut next)
                    }
                }
            }
            None => {
                if once && !streaming {
                    grab.frame_now(Duration::from_millis(120), &mut next)
                } else {
                    grab.frame(Duration::from_millis(120), &mut next)
                }
            }
        };
        #[cfg(not(feature = "gpu"))]
        let taken = if once && !streaming {
            grab.frame_now(Duration::from_millis(120), &mut next)
        } else {
            grab.frame(Duration::from_millis(120), &mut next)
        };
        match taken {
            Ok(true) => {
                generation += 1;
                // Is there a picture in it at all? Counted only when asked for, since
                // it is a pass over the frame: FLIPCTL_FRAMELOG=1.
                if std::env::var_os("FLIPCTL_FRAMELOG").is_some() && generation % 10 == 1 {
                    let lit = next.iter().filter(|b| **b != 0).count();
                    eprintln!(
                        "frame          {generation}: {lit} of {} bytes are not black",
                        next.len()
                    );
                }
                let frame = Arc::new(next);
                if let Ok(mut latest) = frames.latest.lock() {
                    *latest = Some((generation, frame));
                }
            }
            Ok(false) => {}
            Err(e) => {
                eprintln!("wl: capture stopped: {e}");
                return;
            }
        }
    }
}

/// A sealed anonymous file holding `bytes`, for handing to the compositor.
pub(crate) fn memfd(name: &str, bytes: &[u8]) -> io::Result<OwnedFd> {
    let cname = CString::new(name).map_err(io::Error::other)?;
    let raw = unsafe { libc::memfd_create(cname.as_ptr(), 0) };
    if raw < 0 {
        return Err(io::Error::last_os_error());
    }
    let fd = unsafe { OwnedFd::from_raw_fd(raw) };
    if unsafe { libc::ftruncate(raw, bytes.len() as libc::off_t) } < 0 {
        return Err(io::Error::last_os_error());
    }
    let mut written = 0;
    while written < bytes.len() {
        let n = unsafe {
            libc::pwrite(
                raw,
                bytes[written..].as_ptr().cast(),
                bytes.len() - written,
                written as libc::off_t,
            )
        };
        if n <= 0 {
            return Err(io::Error::last_os_error());
        }
        written += n as usize;
    }
    Ok(fd)
}

fn runtime_dir() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(format!("/run/user/{}", unsafe { libc::getuid() })))
}

/// An empty 0700 directory under the user's runtime dir, for one app's socket.
fn private_runtime_dir() -> io::Result<PathBuf> {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = runtime_dir().join(format!("flipctl-app-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)?;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    Ok(dir)
}

fn wait_for(path: &Path, wait: Duration) -> bool {
    let deadline = Instant::now() + wait;
    while Instant::now() < deadline {
        if path.exists() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}

impl Dispatch<ZwlrScreencopyFrameV1, usize> for State {
    fn event(
        state: &mut Self,
        _: &ZwlrScreencopyFrameV1,
        event: zwlr_screencopy_frame_v1::Event,
        slot: &usize,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            zwlr_screencopy_frame_v1::Event::Buffer {
                format,
                width,
                height,
                stride,
            } => {
                state.capture[(*slot).min(1)].format = format.into_result().ok();
                state.capture[(*slot).min(1)].width = width;
                state.capture[(*slot).min(1)].height = height;
                state.capture[(*slot).min(1)].stride = stride;
            }
            #[cfg(feature = "gpu")]
            zwlr_screencopy_frame_v1::Event::LinuxDmabuf { format, width, height } => {
                state.offered = Some((format, width, height));
            }
            zwlr_screencopy_frame_v1::Event::BufferDone => state.capture[(*slot).min(1)].described = true,
            zwlr_screencopy_frame_v1::Event::Ready { .. } => state.capture[(*slot).min(1)].ready = true,
            zwlr_screencopy_frame_v1::Event::Failed => state.capture[(*slot).min(1)].failed = true,
            _ => {}
        }
    }
}

impl Dispatch<wl_registry::WlRegistry, wayland_client::globals::GlobalListContents> for State {
    fn event(
        _: &mut Self,
        _: &wl_registry::WlRegistry,
        _: wl_registry::Event,
        _: &wayland_client::globals::GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

delegate_noop!(State: ignore wl_output::WlOutput);
delegate_noop!(State: ignore wl_seat::WlSeat);
delegate_noop!(State: ignore wl_shm::WlShm);
delegate_noop!(State: ignore wl_shm_pool::WlShmPool);
delegate_noop!(State: ignore wl_buffer::WlBuffer);
delegate_noop!(State: ignore ZwlrScreencopyManagerV1);
delegate_noop!(State: ignore ZwpVirtualKeyboardManagerV1);
delegate_noop!(State: ignore ZwpVirtualKeyboardV1);
#[cfg(feature = "gpu")]
delegate_noop!(State: ignore ZwpLinuxDmabufV1);
#[cfg(feature = "gpu")]
delegate_noop!(State: ignore ZwpLinuxBufferParamsV1);
