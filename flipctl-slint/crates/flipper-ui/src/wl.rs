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
use wayland_protocols_misc::zwp_virtual_keyboard_v1::client::{
    zwp_virtual_keyboard_manager_v1::ZwpVirtualKeyboardManagerV1,
    zwp_virtual_keyboard_v1::ZwpVirtualKeyboardV1,
};
use wayland_protocols_wlr::screencopy::v1::client::{
    zwlr_screencopy_frame_v1::{self, ZwlrScreencopyFrameV1},
    zwlr_screencopy_manager_v1::ZwlrScreencopyManagerV1,
};

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
pub struct Session {
    cage: Child,
    keyboard: ZwpVirtualKeyboardV1,
    started: Instant,
    dir: PathBuf,
    grab: Grab,
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
    grey: Vec<u8>,
    w: u32,
    h: u32,
}

/// The panel, as the compositor sees it.
///
/// Reads whatever is on the output: flipctl's own surface when nothing is in front,
/// and the app's when one is. That is what the browser view and the switcher's cards
/// want, and it is the thing the old arrangement could not do at all for an app that
/// took DRM master, because its pixels never reached anything we could read.
pub struct Mirror {
    grab: Grab,
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
    capture: Capture,
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
    pub fn frame(&mut self, timeout: Duration) -> io::Result<Option<&[u8]>> {
        self.capture(timeout, true)
    }

    /// Capture whatever is on the output now, changed or not.
    pub fn frame_now(&mut self, timeout: Duration) -> io::Result<Option<&[u8]>> {
        self.capture(timeout, false)
    }

    fn capture(&mut self, timeout: Duration, on_change: bool) -> io::Result<Option<&[u8]>> {
        let manager = self.state.screencopy.clone().unwrap();
        let output = self.state.output.clone().unwrap();
        let qh = self.queue.handle();

        self.state.capture = Capture::default();
        let frame = manager.capture_output(0, &output, &qh, ());

        let deadline = Instant::now() + timeout;
        while !self.state.capture.described {
            if !self.pump(deadline)? || self.state.capture.failed {
                frame.destroy();
                return Ok(None);
            }
        }
        if !self.state.capture.described {
            frame.destroy();
            return Ok(None);
        }

        let format = match self.state.capture.format {
            Some(f) => f,
            None => {
                frame.destroy();
                return Err(io::Error::other("screencopy named no format"));
            }
        };
        let stride = self.state.capture.stride;
        let height = self.state.capture.height;
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
        while !self.state.capture.ready {
            if !self.pump(deadline)? || self.state.capture.failed {
                frame.destroy();
                return Ok(None);
            }
        }
        frame.destroy();

        self.to_grey();
        Ok(Some(&self.grey))
    }

    /// The panel's own luma, so a captured frame greys exactly as the driver would
    /// have greyed it: 299/587/114 over the transmit buffer.
    fn to_grey(&mut self) {
        let Some(shm) = self.shm.as_ref() else { return };
        let stride = shm.stride as usize;
        let bgr = matches!(
            shm.format,
            wl_shm::Format::Xrgb8888 | wl_shm::Format::Argb8888
        );
        let src = unsafe { std::slice::from_raw_parts(shm.map, shm.len) };
        for y in 0..self.h as usize {
            let row = y * stride;
            for x in 0..self.w as usize {
                let p = row + x * 4;
                if p + 3 > src.len() {
                    break;
                }
                let (a, b) = (u32::from(src[p]), u32::from(src[p + 2]));
                let (r, g, bl) = if bgr {
                    (b, u32::from(src[p + 1]), a)
                } else {
                    (a, u32::from(src[p + 1]), b)
                };
                self.grey[y * self.w as usize + x] =
                    ((r * 299 + g * 587 + bl * 114) / 1000).min(255) as u8;
            }
        }
    }
}

impl Grab {
    /// Attach to the compositor named by the environment.
    ///
    /// For the panel's own compositor, which flipctl is already a client of: there
    /// is nothing to spawn and nothing to configure, only an output to read.
    fn attach(w: u32, h: u32) -> io::Result<Self> {
        let conn = Connection::connect_to_env().map_err(io::Error::other)?;
        let (globals, mut queue) = wayland_client::globals::registry_queue_init::<State>(&conn)
            .map_err(io::Error::other)?;
        let qh = queue.handle();

        let mut state = State {
            output: None,
            seat: None,
            shm: None,
            screencopy: None,
            keyboards: None,
            capture: Capture::default(),
        };
        for g in globals.contents().clone_list() {
            match g.interface.as_str() {
                "wl_output" => {
                    state.output = Some(globals.registry().bind(g.name, 1.min(g.version), &qh, ()))
                }
                "wl_shm" => {
                    state.shm = Some(globals.registry().bind(g.name, 1.min(g.version), &qh, ()))
                }
                "zwlr_screencopy_manager_v1" => {
                    state.screencopy =
                        Some(globals.registry().bind(g.name, 3.min(g.version), &qh, ()))
                }
                _ => {}
            }
        }
        let missing = |what: &str| io::Error::other(format!("compositor has no {what}"));
        let shm_global = state.shm.clone().ok_or_else(|| missing("wl_shm"))?;
        state.screencopy.clone().ok_or_else(|| missing("screencopy"))?;
        state.output.clone().ok_or_else(|| missing("wl_output"))?;
        queue.roundtrip(&mut state).map_err(io::Error::other)?;

        Ok(Self {
            conn,
            queue,
            state,
            shm_global,
            shm: None,
            grey: vec![0; (w * h) as usize],
            w,
            h,
        })
    }
}

impl Mirror {
    /// Read the panel's own compositor.
    pub fn attach(w: u32, h: u32) -> io::Result<Self> {
        Ok(Self {
            grab: Grab::attach(w, h)?,
        })
    }

    /// Whatever is on the output right now: our own surface, or an app's.
    ///
    /// Immediate rather than damage-driven, because the caller decides the rate: the
    /// browser view asks about ten times a second and the switcher once, and neither
    /// wants to be blocked until something moves.
    pub fn frame(&mut self, timeout: Duration) -> io::Result<Option<&[u8]>> {
        self.grab.frame_now(timeout)
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
        // A runtime directory per app, so the socket path is ours to know rather
        // than ours to guess. Watching XDG_RUNTIME_DIR for a new `wayland-N` looks
        // simpler and does not work: a killed compositor leaves its socket file
        // behind with no live lock holder, so the next one rebinds the same name and
        // a directory diff sees nothing appear. An empty directory has no such
        // history, and the app gets a runtime dir of its own into the bargain.
        let dir = private_runtime_dir()?;
        let socket = dir.join("wayland-0");

        let mut cmd = Command::new("cage");
        cmd.arg("--")
            .arg("/bin/sh")
            .arg("-c")
            .arg(command)
            .env("WLR_BACKENDS", "headless")
            .env("WLR_LIBINPUT_NO_DEVICES", "1")
            .env("WLR_HEADLESS_OUTPUTS", "1")
            .env("XDG_RUNTIME_DIR", &dir)
            .env_remove("WAYLAND_DISPLAY")
            .env_remove("WAYLAND_SOCKET")
            .stdin(Stdio::null());
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

        let status = Command::new("wlr-randr")
            .args(["--output", "HEADLESS-1", "--custom-mode"])
            .arg(format!("{w}x{h}"))
            .env("WAYLAND_DISPLAY", "wayland-0")
            .env("XDG_RUNTIME_DIR", &dir)
            .stdout(Stdio::null())
            .status();
        if !matches!(status, Ok(s) if s.success()) {
            eprintln!("wl: could not set {w}x{h}, output stays at cage's default");
        }

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
            capture: Capture::default(),
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

        Ok(Self {
            cage,
            keyboard,
            started: Instant::now(),
            dir,
            grab: Grab {
                conn,
                queue,
                state,
                shm_global,
                shm: None,
                grey: vec![0; (w * h) as usize],
                w,
                h,
            },
        })
    }

    /// True while the app is still running.
    pub fn alive(&mut self) -> bool {
        matches!(self.cage.try_wait(), Ok(None))
    }

    /// Capture as soon as the app draws something new, or give up at `timeout`.
    pub fn frame(&mut self, timeout: Duration) -> io::Result<Option<&[u8]>> {
        self.grab.frame(timeout)
    }

    /// Capture whatever is on the output now, changed or not.
    pub fn frame_now(&mut self, timeout: Duration) -> io::Result<Option<&[u8]>> {
        self.grab.frame_now(timeout)
    }

    /// Press or release one key, by evdev code.
    pub fn key(&mut self, code: u32, down: bool) {
        let ms = self.started.elapsed().as_millis() as u32;
        self.keyboard.key(ms, code, u32::from(down));
        let _ = self.grab.conn.flush();
    }

}

impl Drop for Session {
    fn drop(&mut self) {
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

impl Dispatch<ZwlrScreencopyFrameV1, ()> for State {
    fn event(
        state: &mut Self,
        _: &ZwlrScreencopyFrameV1,
        event: zwlr_screencopy_frame_v1::Event,
        _: &(),
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
                state.capture.format = format.into_result().ok();
                state.capture.width = width;
                state.capture.height = height;
                state.capture.stride = stride;
            }
            zwlr_screencopy_frame_v1::Event::BufferDone => state.capture.described = true,
            zwlr_screencopy_frame_v1::Event::Ready { .. } => state.capture.ready = true,
            zwlr_screencopy_frame_v1::Event::Failed => state.capture.failed = true,
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
