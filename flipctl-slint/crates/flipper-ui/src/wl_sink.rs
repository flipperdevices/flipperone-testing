//! The panel as a Wayland surface, for when a compositor owns the display.
//!
//! Two things present flipctl's frames now. `KmsSink` commits straight to the
//! panel and is what the boot menu, the installer and recovery use, since none of
//! them can carry a compositor. This one attaches the same frames to a fullscreen
//! surface, which is what flipctl uses when a compositor holds the panel and, with
//! no change at all, when flipctl runs in a window on someone's desktop.
//!
//! Measured on the device before writing it: sway driving the panel through this
//! path reaches 56 fps at the driver, against 51 to 53 for the KMS path, because
//! nobody expands a greyscale buffer in userspace on the way. The panel's own
//! ceiling is 67, the SPI transfer.

use std::collections::VecDeque;
use std::ffi::CString;
use std::io;
use std::os::fd::{AsFd, FromRawFd, OwnedFd};

use wayland_client::protocol::{
    wl_buffer, wl_compositor, wl_keyboard, wl_registry, wl_seat, wl_shm, wl_shm_pool, wl_surface,
};
use wayland_client::{delegate_noop, Connection, Dispatch, EventQueue, QueueHandle, WEnum};
use wayland_protocols::xdg::shell::client::{xdg_surface, xdg_toplevel, xdg_wm_base};

use crate::pixel::{Gray8, Rect};
use crate::platform::{Frame, FrameSink, InputSource};
use crate::{FlipperKey, KeyEvent};

/// Two buffers, so a frame can be written while the compositor still holds the
/// other. One would mean waiting for release on every frame.
const BUFFERS: usize = 2;

pub struct WlSink {
    conn: Connection,
    queue: EventQueue<State>,
    state: State,
    surface: wl_surface::WlSurface,
    buffers: Vec<Buffer>,
    next: usize,
    w: u16,
    h: u16,
}

struct Buffer {
    buffer: wl_buffer::WlBuffer,
    map: *mut u8,
    len: usize,
}

#[derive(Default)]
struct State {
    compositor: Option<wl_compositor::WlCompositor>,
    shm: Option<wl_shm::WlShm>,
    wm_base: Option<xdg_wm_base::XdgWmBase>,
    seat: Option<wl_seat::WlSeat>,
    configured: bool,
    closed: bool,
    // One keyboard, however many times the seat announces its capabilities. sway
    // re-announces as input devices appear, and the Flipper brings three, so
    // binding per announcement gives two or three wl_keyboards and every press
    // arrives that many times: one Down moves the selection twice, or acts on the
    // screen just left as well as the one arrived at.
    keyboard: Option<wl_keyboard::WlKeyboard>,
    busy: [bool; BUFFERS],
    keys: VecDeque<KeyEvent>,
}

impl WlSink {
    /// Connect to the compositor named by the environment and take a fullscreen
    /// surface of `w` by `h`.
    pub fn new(w: u16, h: u16) -> io::Result<Self> {
        let conn = Connection::connect_to_env().map_err(io::Error::other)?;
        let (globals, mut queue) =
            wayland_client::globals::registry_queue_init::<State>(&conn).map_err(io::Error::other)?;
        let qh = queue.handle();

        let mut state = State::default();
        for g in globals.contents().clone_list() {
            match g.interface.as_str() {
                "wl_compositor" => {
                    state.compositor = Some(globals.registry().bind(g.name, 4.min(g.version), &qh, ()))
                }
                "wl_shm" => state.shm = Some(globals.registry().bind(g.name, 1, &qh, ())),
                "xdg_wm_base" => {
                    state.wm_base = Some(globals.registry().bind(g.name, 1.min(g.version), &qh, ()))
                }
                "wl_seat" => {
                    state.seat = Some(globals.registry().bind(g.name, 5.min(g.version), &qh, ()))
                }
                _ => {}
            }
        }

        let missing = |what: &str| io::Error::other(format!("compositor has no {what}"));
        let compositor = state.compositor.clone().ok_or_else(|| missing("wl_compositor"))?;
        let shm = state.shm.clone().ok_or_else(|| missing("wl_shm"))?;
        let wm_base = state.wm_base.clone().ok_or_else(|| missing("xdg_wm_base"))?;

        let surface = compositor.create_surface(&qh, ());
        let xdg = wm_base.get_xdg_surface(&surface, &qh, ());
        let toplevel = xdg.get_toplevel(&qh, ());
        toplevel.set_app_id("net.flipper.flipctl".into());
        toplevel.set_title("FlipCTL".into());
        // Exactly panel-sized, and say so both ways: on the device the output is
        // 256x144 anyway, and on a desktop this keeps the window 1:1 rather than
        // stretching a 256 pixel wide UI across a monitor.
        toplevel.set_min_size(i32::from(w), i32::from(h));
        toplevel.set_max_size(i32::from(w), i32::from(h));
        toplevel.set_fullscreen(None);
        surface.commit();

        let mut buffers = Vec::with_capacity(BUFFERS);
        for i in 0..BUFFERS {
            buffers.push(Buffer::new(&shm, &qh, w, h, i)?);
        }

        let mut sink = Self {
            conn,
            queue,
            state,
            surface,
            buffers,
            next: 0,
            w,
            h,
        };
        // The first attach has to wait for the first configure, or the compositor
        // is entitled to ignore it.
        for _ in 0..50 {
            sink.pump()?;
            if sink.state.configured {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Ok(sink)
    }

    /// Read whatever the compositor has said, without blocking.
    pub fn pump(&mut self) -> io::Result<()> {
        self.conn.flush().map_err(io::Error::other)?;
        self.queue
            .dispatch_pending(&mut self.state)
            .map_err(io::Error::other)?;
        if let Some(guard) = self.conn.prepare_read() {
            match guard.read() {
                Ok(_) => {}
                Err(wayland_client::backend::WaylandError::Io(e))
                    if e.kind() == io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(io::Error::other(e)),
            }
            self.queue
                .dispatch_pending(&mut self.state)
                .map_err(io::Error::other)?;
        }
        Ok(())
    }

    /// True once the compositor or the user has asked us to go away.
    pub fn closed(&self) -> bool {
        self.state.closed
    }
}

impl FrameSink for WlSink {
    fn commit(&mut self, frame: Frame<'_>, damage: Rect) -> io::Result<()> {
        self.pump()?;
        // Whichever buffer the compositor is not holding. Both busy means it has
        // not caught up, and the frame is dropped rather than queued: the panel
        // shows the newest frame, never a backlog.
        let slot = (0..BUFFERS)
            .map(|i| (self.next + i) % BUFFERS)
            .find(|&i| !self.state.busy[i]);
        let Some(slot) = slot else { return Ok(()) };
        self.next = (slot + 1) % BUFFERS;

        let buf = &self.buffers[slot];
        let dst = unsafe { std::slice::from_raw_parts_mut(buf.map, buf.len) };
        let w = usize::from(self.w);
        for (y, row) in frame.pixels.chunks(w).enumerate() {
            let base = y * w * 4;
            for (x, &Gray8(v)) in row.iter().enumerate() {
                let p = base + x * 4;
                dst[p] = v;
                dst[p + 1] = v;
                dst[p + 2] = v;
                dst[p + 3] = 0xFF;
            }
        }

        self.state.busy[slot] = true;
        self.surface.attach(Some(&buf.buffer), 0, 0);
        self.surface.damage_buffer(
            i32::from(damage.x),
            i32::from(damage.y),
            i32::from(damage.w),
            i32::from(damage.h),
        );
        self.surface.commit();
        self.conn.flush().map_err(io::Error::other)?;
        Ok(())
    }
}

impl InputSource for WlSink {
    fn poll(&mut self) -> Option<KeyEvent> {
        if self.state.keys.is_empty() {
            let _ = self.pump();
        }
        self.state.keys.pop_front()
    }
}

impl Buffer {
    fn new(
        shm: &wl_shm::WlShm,
        qh: &QueueHandle<State>,
        w: u16,
        h: u16,
        index: usize,
    ) -> io::Result<Self> {
        let stride = usize::from(w) * 4;
        let len = stride * usize::from(h);
        let name = CString::new(format!("flipctl-frame-{index}")).map_err(io::Error::other)?;
        let raw = unsafe { libc::memfd_create(name.as_ptr(), 0) };
        if raw < 0 {
            return Err(io::Error::last_os_error());
        }
        let fd = unsafe { OwnedFd::from_raw_fd(raw) };
        if unsafe { libc::ftruncate(raw, len as libc::off_t) } < 0 {
            return Err(io::Error::last_os_error());
        }
        let pool = shm.create_pool(fd.as_fd(), len as i32, qh, ());
        let buffer = pool.create_buffer(
            0,
            i32::from(w),
            i32::from(h),
            stride as i32,
            wl_shm::Format::Xrgb8888,
            qh,
            index,
        );
        pool.destroy();
        let map = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                len,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                raw,
                0,
            )
        };
        if map == libc::MAP_FAILED {
            return Err(io::Error::last_os_error());
        }
        Ok(Self {
            buffer,
            map: map.cast(),
            len,
        })
    }
}

impl Drop for Buffer {
    fn drop(&mut self) {
        unsafe { libc::munmap(self.map.cast(), self.len) };
    }
}

impl Dispatch<xdg_wm_base::XdgWmBase, ()> for State {
    fn event(
        _: &mut Self,
        base: &xdg_wm_base::XdgWmBase,
        event: xdg_wm_base::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        // Answering the ping is not optional: a compositor is entitled to consider
        // a client that does not respond unresponsive, and kill it.
        if let xdg_wm_base::Event::Ping { serial } = event {
            base.pong(serial);
        }
    }
}

impl Dispatch<xdg_surface::XdgSurface, ()> for State {
    fn event(
        state: &mut Self,
        surface: &xdg_surface::XdgSurface,
        event: xdg_surface::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let xdg_surface::Event::Configure { serial } = event {
            surface.ack_configure(serial);
            state.configured = true;
        }
    }
}

impl Dispatch<xdg_toplevel::XdgToplevel, ()> for State {
    fn event(
        state: &mut Self,
        _: &xdg_toplevel::XdgToplevel,
        event: xdg_toplevel::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let xdg_toplevel::Event::Close = event {
            state.closed = true;
        }
    }
}

impl Dispatch<wl_buffer::WlBuffer, usize> for State {
    fn event(
        state: &mut Self,
        _: &wl_buffer::WlBuffer,
        event: wl_buffer::Event,
        index: &usize,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let wl_buffer::Event::Release = event {
            if let Some(busy) = state.busy.get_mut(*index) {
                *busy = false;
            }
        }
    }
}

impl Dispatch<wl_seat::WlSeat, ()> for State {
    fn event(
        state: &mut Self,
        seat: &wl_seat::WlSeat,
        event: wl_seat::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        if let wl_seat::Event::Capabilities {
            capabilities: WEnum::Value(caps),
        } = event
        {
            let has = caps.contains(wl_seat::Capability::Keyboard);
            match (has, state.keyboard.take()) {
                (true, None) => state.keyboard = Some(seat.get_keyboard(qh, ())),
                (true, Some(k)) => state.keyboard = Some(k),
                (false, Some(k)) => k.release(),
                (false, None) => {}
            }
        }
    }
}

impl Dispatch<wl_keyboard::WlKeyboard, ()> for State {
    fn event(
        state: &mut Self,
        _: &wl_keyboard::WlKeyboard,
        event: wl_keyboard::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        // Wayland carries evdev keycodes, which is the same space the panel's own
        // input driver uses, so the existing mapping applies unchanged.
        if let wl_keyboard::Event::Key { key, state: s, .. } = event {
            if let Ok(code) = u16::try_from(key) {
                if let Some(k) = FlipperKey::from_evdev(code) {
                    let down = matches!(s, WEnum::Value(wl_keyboard::KeyState::Pressed));
                    state.keys.push_back(KeyEvent { key: k, down });
                }
            }
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

delegate_noop!(State: ignore wl_compositor::WlCompositor);
delegate_noop!(State: ignore wl_shm::WlShm);
delegate_noop!(State: ignore wl_shm_pool::WlShmPool);
delegate_noop!(State: ignore wl_surface::WlSurface);
