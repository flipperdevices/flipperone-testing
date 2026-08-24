//! Talking to the compositor that owns the panel.
//!
//! sway's IPC is a unix socket and a six-byte magic, which is little enough to
//! speak directly rather than shelling out to `swaymsg` per press: a switch should
//! cost one write, not a process.
//!
//! What flipctl needs from it is small. An app is launched as a client of the same
//! compositor and put on a workspace of its own; showing an app is making its
//! workspace the visible one; going back to our own UI is making ours visible
//! again. Nothing here hands over a device, and nothing here can fail in a way
//! that leaves the panel in someone else's hands.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;

const MAGIC: &[u8; 6] = b"i3-ipc";
const RUN_COMMAND: u32 = 0;
const GET_WORKSPACES: u32 = 1;

/// flipctl's own workspace. Apps get 2 and up.
pub const HOME: u32 = 1;

pub struct Sway {
    socket: UnixStream,
}

/// One workspace, as sway describes it. Only the fields that answer a question.
#[derive(serde::Deserialize)]
struct Workspace {
    num: Option<i64>,
    #[serde(default)]
    focus: Vec<i64>,
}

impl Sway {
    /// Connect to the compositor named by `SWAYSOCK`, or the newest socket in the
    /// runtime directory when the variable is missing, which is the case for a
    /// process the compositor did not itself spawn.
    pub fn connect() -> std::io::Result<Self> {
        let path = std::env::var_os("SWAYSOCK")
            .map(PathBuf::from)
            .or_else(newest_socket)
            .ok_or_else(|| std::io::Error::other("no SWAYSOCK and none found"))?;
        Ok(Self {
            socket: UnixStream::connect(path)?,
        })
    }

    fn send(&mut self, kind: u32, payload: &str) -> std::io::Result<String> {
        let mut msg = Vec::with_capacity(14 + payload.len());
        msg.extend_from_slice(MAGIC);
        msg.extend_from_slice(&(payload.len() as u32).to_ne_bytes());
        msg.extend_from_slice(&kind.to_ne_bytes());
        msg.extend_from_slice(payload.as_bytes());
        self.socket.write_all(&msg)?;

        let mut head = [0u8; 14];
        self.socket.read_exact(&mut head)?;
        if &head[..6] != MAGIC {
            return Err(std::io::Error::other("not an i3-ipc reply"));
        }
        let len = u32::from_ne_bytes(head[6..10].try_into().unwrap()) as usize;
        let mut body = vec![0u8; len];
        self.socket.read_exact(&mut body)?;
        Ok(String::from_utf8_lossy(&body).into_owned())
    }

    /// Run one sway command. The reply says whether it took.
    pub fn run(&mut self, command: &str) -> std::io::Result<bool> {
        let reply = self.send(RUN_COMMAND, command)?;
        Ok(reply.contains("\"success\":true") || reply.contains("\"success\": true"))
    }

    /// Show a workspace, creating it if it does not exist yet.
    pub fn show(&mut self, workspace: u32) -> std::io::Result<bool> {
        self.run(&format!("workspace number {workspace}"))
    }

    /// Move whatever has focus to `workspace` and follow it there.
    ///
    /// Used the moment an app maps its window: sway puts a new client on the
    /// visible workspace, which is ours, so it has to be moved off before it
    /// covers the UI.
    pub fn move_focused(&mut self, workspace: u32) -> std::io::Result<bool> {
        self.run(&format!(
            "move container to workspace number {workspace}; workspace number {workspace}"
        ))
    }

    /// Scale the output, so a client that insists on a bigger window fits.
    ///
    /// The compositor's own scaling is the only thing that can help here: a client
    /// asking for 320x200 on a 256x144 panel is not going to be talked down, and
    /// sway will happily clip it forever. At scale 0.72 the output is 355x200
    /// logical pixels, the window fits, and what reaches the panel is the whole
    /// picture at 230x144, which is Doom's aspect ratio rather than ours.
    pub fn scale(&mut self, factor: f32) -> std::io::Result<bool> {
        self.run(&format!("output * scale {factor:.3}"))
    }

    /// Let the window on `workspace` keep its own size, centred.
    ///
    /// A tiled window is given the whole output whether it asked for it or not, so
    /// an app that renders one size and is handed another stretches to fill. Floating
    /// it at exactly the size it wants leaves the spare as background, which is what
    /// letterboxing is.
    pub fn shape(&mut self, workspace: u32, w: u32, h: u32) -> std::io::Result<bool> {
        self.run(&format!(
            "[workspace=\"{workspace}\"] floating enable, resize set width {w} height {h}, move position center"
        ))
    }

    /// Close whatever is on `workspace`, politely.
    pub fn close(&mut self, workspace: u32) -> std::io::Result<bool> {
        self.run(&format!("[workspace=\"{workspace}\"] kill"))
    }

    /// Every workspace the compositor knows about.
    ///
    /// Asked before choosing where to put an app, because flipctl's own list is not
    /// the truth: a program that outlived the shell we killed leaves a window behind,
    /// and putting the next app on "the free workspace" then tiles the two together.
    pub fn workspaces(&mut self) -> std::io::Result<Vec<u32>> {
        Ok(self
            .list()?
            .into_iter()
            .filter_map(|w| w.num)
            .filter(|n| *n >= 0)
            .map(|n| n as u32)
            .collect())
    }

    fn list(&mut self) -> std::io::Result<Vec<Workspace>> {
        let reply = self.send(GET_WORKSPACES, "")?;
        serde_json::from_str(&reply).map_err(std::io::Error::other)
    }

    /// Whether any client is on `workspace`.
    ///
    /// A workspace with nothing on it has an empty `focus` list. Asked of
    /// `get_workspaces` rather than of the tree, which is nested and carries a `num`
    /// field on every node.
    pub fn occupied(&mut self, workspace: u32) -> std::io::Result<bool> {
        Ok(self
            .list()?
            .into_iter()
            .find(|w| w.num == Some(workspace as i64))
            .is_some_and(|w| !w.focus.is_empty()))
    }
}

fn newest_socket() -> Option<PathBuf> {
    let dir = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from)?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("sway-ipc.") {
            continue;
        }
        let when = entry.metadata().and_then(|m| m.modified()).ok()?;
        if best.as_ref().is_none_or(|(t, _)| when > *t) {
            best = Some((when, entry.path()));
        }
    }
    best.map(|(_, p)| p)
}

#[cfg(test)]
mod tests {
    use super::Workspace;

    /// sway pretty-prints its replies, which is what broke the substring search this
    /// parser replaced: nothing in the reply looks like `{"num":2,`.
    #[test]
    fn a_reply_is_read_as_sway_actually_writes_it() {
        let reply = r#"[
  {
    "id": 4,
    "type": "workspace",
    "num": 1,
    "name": "1",
    "focus": [ 12 ]
  },
  {
    "id": 9,
    "type": "workspace",
    "num": 2,
    "name": "2",
    "focus": []
  }
]"#;
        let spaces: Vec<Workspace> = serde_json::from_str(reply).expect("sway's own shape");
        let numbers: Vec<Option<i64>> = spaces.iter().map(|w| w.num).collect();
        assert_eq!(numbers, vec![Some(1), Some(2)], "both workspaces are seen");
        assert!(!spaces[0].focus.is_empty(), "workspace 1 holds a window");
        assert!(spaces[1].focus.is_empty(), "workspace 2 is free to take");
    }
}
