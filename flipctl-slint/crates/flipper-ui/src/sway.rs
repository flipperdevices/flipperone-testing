//! One compositor for every hosted app, and an output each.
//!
//! The alternative this replaces gave each app a `cage` of its own: simple, and
//! isolated by construction, but a compositor per app. Measured on the device, a cage
//! costs 11.7MB of private memory each where one sway costs 15.6MB however many apps
//! it hosts, so the second app pays for the change and the third profits from it.
//!
//! Apps are separated by *output* rather than by workspace, and that is the decision
//! the rest of this file follows from. sway renders an unfocused headless output, which
//! was measured rather than assumed: with two outputs and the second focused, both
//! captured real content. So a backgrounded app keeps drawing and its card stays live,
//! and each app can have the size it insists on rather than sharing one output's mode.
//!
//! What stops a hidden app burning power is the refresh rate, not visibility. An output
//! at 1Hz hands its client frame callbacks once a second and the client idles: the same
//! app went from 1.9% to 0.8% of a core when its output was slowed, and stayed
//! capturable. Disabling the output would be the obvious alternative and is unusable,
//! because sway moves the workspace elsewhere when an output goes away, which was also
//! measured.
//!
//! flipctl owns the panel throughout. sway never touches a DRM device: it runs on the
//! headless backend, and its frames reach the panel only because flipctl captures them.

use std::io::{self, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// How fast an output runs, by what is looking at it.
///
/// One mechanism for three cases, since it is the same IPC call each time.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Attention {
    /// On the panel: as fast as the panel can take frames.
    Front,
    /// Being shown as a card in the deck: fresh enough to look alive.
    Card,
    /// Running, nobody watching.
    Idle,
}

impl Attention {
    const fn hz(self) -> u32 {
        match self {
            Self::Front => 63,
            Self::Card => 10,
            Self::Idle => 1,
        }
    }
}

/// The compositor the apps live in.
pub struct Host {
    sway: Child,
    dir: PathBuf,
    display: String,
    ipc: UnixStream,
    /// Outputs handed out so far, so the next app gets a fresh one.
    outputs: u32,
    /// Places whose app has gone. sway can create an output and cannot destroy one, so
    /// a killed app's output is reused rather than leaked: launching and killing apps
    /// all afternoon would otherwise leave HEADLESS-40 behind.
    free: Vec<Placement>,
}

/// An app's place in the host: which output shows it and which workspace holds it.
#[derive(Clone, Debug)]
pub struct Placement {
    pub output: String,
    pub workspace: u32,
}

const RUN_COMMAND: u32 = 0;
const GET_WORKSPACES: u32 = 1;

impl Host {
    /// Start sway on the headless backend, with a configuration of our own.
    ///
    /// A private runtime directory, as the per-app cages had, so the socket names are
    /// ours to know rather than ours to guess. sway takes `wayland-1` there, its IPC
    /// socket sits beside it, and neither is handed to an app.
    pub fn start() -> io::Result<Self> {
        let dir = crate::wl::private_runtime_dir()?;
        let config = dir.join("sway.conf");
        // No decorations, no bar, no cursor, no Xwayland: a hosted app is one window on
        // an output nobody clicks. The ground is the panel's own ink, so an app that
        // does not cover its surface leaves black rather than sway's grey.
        let ground = crate::theme::color::BLACK.0;
        std::fs::write(
            &config,
            format!(
                "output * bg #{ground:02x}{ground:02x}{ground:02x} solid_color\n\
             default_border none\n\
             default_floating_border none\n\
             titlebar_padding 1\n\
             seat * hide_cursor 1\n\
             xwayland disable\n"
            ),
        )?;

        let mut cmd = Command::new("sway");
        cmd.arg("-c")
            .arg(&config)
            .env("XDG_RUNTIME_DIR", &dir)
            .env("WLR_BACKENDS", "headless")
            .env("WLR_LIBINPUT_NO_DEVICES", "1")
            .env_remove("WAYLAND_DISPLAY")
            .env_remove("WAYLAND_SOCKET")
            .stdin(Stdio::null());
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        unsafe {
            use std::os::unix::process::CommandExt;
            cmd.pre_exec(|| {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let sway = cmd.spawn()?;

        // Both sockets appear when it is ready, so waiting for the IPC one is waiting
        // for the compositor.
        let deadline = Instant::now() + Duration::from_secs(10);
        let (display, ipc_path) = loop {
            if let Some(found) = Self::sockets(&dir) {
                break found;
            }
            if Instant::now() > deadline {
                return Err(io::Error::other("sway never bound its sockets"));
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        let ipc = UnixStream::connect(&ipc_path)?;

        Ok(Self {
            sway,
            dir,
            display,
            ipc,
            outputs: 1,
            free: Vec::new(),
        })
    }

    /// The Wayland and IPC socket names in `dir`, once both exist.
    fn sockets(dir: &Path) -> Option<(String, PathBuf)> {
        let mut display = None;
        let mut ipc = None;
        for entry in std::fs::read_dir(dir).ok()?.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with("wayland-") && !name.ends_with(".lock") {
                display = Some(name);
            } else if name.starts_with("sway-ipc.") {
                ipc = Some(entry.path());
            }
        }
        Some((display?, ipc?))
    }

    /// Where the app's socket is, for handing to a client.
    pub fn display(&self) -> (&Path, &str) {
        (&self.dir, &self.display)
    }

    /// Make room for one app: an output of its own, sized to what it draws, with a
    /// workspace pinned to it.
    ///
    /// The workspace is pinned *before* anything is placed on it, because sway puts a
    /// new window wherever the focus is, and a race there is how apps ended up sharing
    /// a workspace the last time this was built.
    pub fn place(&mut self, w: u32, h: u32) -> io::Result<Placement> {
        if let Some(again) = self.free.pop() {
            self.run(&format!(
                "output {} mode {w}x{h}@{}Hz",
                again.output,
                Attention::Front.hz()
            ))?;
            self.run(&format!("workspace {}", again.workspace))?;
            return Ok(again);
        }
        let workspace = self.outputs;
        // HEADLESS-1 exists already; every app after the first asks for one.
        if workspace > 1 {
            self.run("create_output")?;
        }
        let output = format!("HEADLESS-{workspace}");
        self.outputs += 1;

        self.run(&format!(
            "output {output} mode {w}x{h}@{}Hz",
            Attention::Front.hz()
        ))?;
        self.run(&format!("workspace {workspace} output {output}"))?;
        self.run(&format!("workspace {workspace}"))?;
        Ok(Placement { output, workspace })
    }

    /// Set how fast an app's output runs, which is what throttles a client nobody is
    /// watching.
    pub fn attend(&mut self, at: &Placement, how: Attention, w: u32, h: u32) -> io::Result<()> {
        self.run(&format!(
            "output {} mode {w}x{h}@{}Hz",
            at.output,
            how.hz()
        ))
    }

    /// Give an app the keyboard by focusing its workspace. There is one seat, so focus
    /// is the routing.
    pub fn focus(&mut self, at: &Placement) -> io::Result<()> {
        self.run(&format!("workspace {}", at.workspace))
    }

    /// Give a place back, for the next app to take.
    ///
    /// Its output stays at a crawl until then: an output with nothing on it costs
    /// nothing to composite, but there is no reason for it to tick at 63Hz.
    pub fn release(&mut self, at: Placement, w: u32, h: u32) {
        let _ = self.attend(&at, Attention::Idle, w, h);
        self.free.push(at);
    }

    /// Whether the compositor is still there.
    ///
    /// Asked every turn, because every app dies with it: a hosted app is a client, so a
    /// compositor fault is not one app's problem but all of them at once. flipctl's job
    /// is to notice, say which apps went, and start another one.
    pub fn alive(&mut self) -> bool {
        matches!(self.sway.try_wait(), Ok(None))
    }

    /// Close whatever is on an app's workspace, for a card that was killed.
    pub fn close(&mut self, at: &Placement) -> io::Result<()> {
        self.run(&format!(
            "[workspace=\"{}\"] kill",
            at.workspace
        ))
    }

    /// Whether anything is on an app's workspace, which answers "did it ever draw".
    pub fn occupied(&mut self, at: &Placement) -> io::Result<bool> {
        let reply = self.send(GET_WORKSPACES, "")?;
        #[derive(serde::Deserialize)]
        struct Workspace {
            num: Option<i64>,
            #[serde(default)]
            focus: Vec<i64>,
        }
        let spaces: Vec<Workspace> = serde_json::from_str(&reply).map_err(io::Error::other)?;
        Ok(spaces
            .into_iter()
            .find(|w| w.num == Some(i64::from(at.workspace)))
            .is_some_and(|w| !w.focus.is_empty()))
    }

    fn run(&mut self, command: &str) -> io::Result<()> {
        let reply = self.send(RUN_COMMAND, command)?;
        // sway answers with a list of results, and a refusal is a message rather than
        // an error on the socket.
        if reply.contains("\"success\": false") || reply.contains("\"success\":false") {
            return Err(io::Error::other(format!("sway refused: {command}")));
        }
        Ok(())
    }

    /// One i3-ipc exchange: a header, a payload, and the reply.
    fn send(&mut self, kind: u32, payload: &str) -> io::Result<String> {
        let mut message = Vec::with_capacity(14 + payload.len());
        message.extend_from_slice(b"i3-ipc");
        message.extend_from_slice(&(payload.len() as u32).to_ne_bytes());
        message.extend_from_slice(&kind.to_ne_bytes());
        message.extend_from_slice(payload.as_bytes());
        self.ipc.write_all(&message)?;
        self.ipc.flush()?;

        let mut header = [0u8; 14];
        self.ipc.read_exact(&mut header)?;
        if &header[..6] != b"i3-ipc" {
            return Err(io::Error::other("not an i3-ipc reply"));
        }
        let len = u32::from_ne_bytes(header[6..10].try_into().unwrap()) as usize;
        let mut body = vec![0u8; len];
        self.ipc.read_exact(&mut body)?;
        Ok(String::from_utf8_lossy(&body).into_owned())
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        // The group, because sway is the parent of every app it hosts and killing only
        // the compositor leaves them running with nowhere to draw.
        crate::app::stop_group(self.sway.id());
        let _ = self.sway.kill();
        let _ = self.sway.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}
