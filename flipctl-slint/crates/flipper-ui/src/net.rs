//! Radio state for the Network menu.
//!
//! Unlike `status`, this cannot come from sysfs. Airplane mode is not a kernel
//! concept: the prototype defines it as "NetworkManager has both the wifi and the
//! wwan radios disabled", and the only supported way to read or change that is
//! `nmcli`. So this module does shell out, on a background thread, at the
//! prototype's own 3-second cadence.
//!
//! Writes are optimistic exactly as they are in the prototype: the local value
//! flips immediately so the row redraws on the same frame as the key press, and
//! the next poll reconciles if the radio refused.

use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// The prototype's poll interval for `/api/airplane` and `/api/wifi`.
const POLL: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Net {
    /// Both radios off. `nmcli radio all off` is what sets it.
    pub airplane: bool,
    pub wifi_enabled: bool,
    pub wifi_connected: bool,
    /// Empty when not connected, or when the active connection has no name.
    pub ssid: String,
}

/// Run a command and return its stdout, or None if it could not be run.
///
/// Every failure is the same as "unknown" here: a missing nmcli, a refused
/// D-Bus call and a timeout all mean the same thing to the menu, which keeps
/// showing its last known value.
fn output(args: &[&str]) -> Option<String> {
    let out = Command::new(args[0])
        .args(&args[1..])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout).ok()
}

/// `nmcli -t -f WIFI,WWAN radio` prints one line, `<wifi>:<wwan>`.
fn read_radio() -> Option<(bool, bool)> {
    let s = output(&["nmcli", "-t", "-f", "WIFI,WWAN", "radio"])?;
    let line = s.lines().next()?;
    let (wifi, wwan) = line.split_once(':')?;
    Some((wifi.trim() == "enabled", wwan.trim() == "enabled"))
}

/// The SSID of the active wireless connection, if there is one.
///
/// `nmcli -t -f NAME,TYPE,STATE c show --active` prints one line per active
/// connection. The wireless one's NAME is the connection's name, which for a
/// normal `nmcli dev wifi connect` is the SSID.
fn read_wifi_connection() -> Option<String> {
    let s = output(&["nmcli", "-t", "-f", "NAME,TYPE,STATE", "c", "show", "--active"])?;
    for line in s.lines() {
        // NAME may itself contain an escaped colon, so split from the right: the
        // last two fields are TYPE and STATE.
        let mut parts = line.rsplitn(3, ':');
        let state = parts.next()?;
        let kind = parts.next()?;
        let name = parts.next()?;
        if kind == "802-11-wireless" && state == "activated" {
            return Some(name.replace("\\:", ":"));
        }
    }
    None
}

fn read_net() -> Net {
    let (wifi_enabled, wwan_enabled) = read_radio().unwrap_or((false, false));
    let ssid = read_wifi_connection();
    Net {
        airplane: !wifi_enabled && !wwan_enabled,
        wifi_enabled,
        wifi_connected: ssid.is_some(),
        ssid: ssid.unwrap_or_default(),
    }
}

/// Polls nmcli on its own thread so the render loop never waits on a subprocess.
pub struct NetSource {
    state: Arc<Mutex<Net>>,
    /// Set whenever the poller or a write changes the state, so the loop knows to
    /// repaint without diffing.
    dirty: Arc<AtomicBool>,
}

impl NetSource {
    pub fn spawn() -> Self {
        let state = Arc::new(Mutex::new(Net::default()));
        let dirty = Arc::new(AtomicBool::new(false));
        let (s, d) = (Arc::clone(&state), Arc::clone(&dirty));
        thread::Builder::new()
            .name("net-poll".into())
            .spawn(move || loop {
                let fresh = read_net();
                let mut cur = s.lock().unwrap();
                if *cur != fresh {
                    *cur = fresh;
                    d.store(true, Ordering::Relaxed);
                }
                drop(cur);
                thread::sleep(POLL);
            })
            .expect("spawn net poller");
        Self { state, dirty }
    }

    pub fn get(&self) -> Net {
        self.state.lock().unwrap().clone()
    }

    /// True once per change, so the caller can repaint only when something moved.
    pub fn take_dirty(&self) -> bool {
        self.dirty.swap(false, Ordering::Relaxed)
    }

    /// Turn airplane mode on or off.
    ///
    /// Airplane on means both radios off, so the nmcli argument is inverted. The
    /// local value flips first and the command runs detached: `nmcli radio all`
    /// takes a few hundred milliseconds and the row must not wait for it.
    pub fn set_airplane(&self, on: bool) {
        {
            let mut cur = self.state.lock().unwrap();
            cur.airplane = on;
            cur.wifi_enabled = !on;
            if on {
                cur.wifi_connected = false;
                cur.ssid.clear();
            }
        }
        self.dirty.store(true, Ordering::Relaxed);
        spawn_detached(&["nmcli", "radio", "all", if on { "off" } else { "on" }]);
    }
}

/// Start a command and do not wait for it.
///
/// The child is deliberately left unreaped: it outlives the call by design and
/// the process count here is bounded by how fast a person can press a key.
pub fn spawn_detached(args: &[&str]) {
    let _ = Command::new(args[0])
        .args(&args[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

/// Reboot, the way the prototype's `/api/system/reboot` does it.
///
/// The command goes into a transient unit rather than running as our child, so
/// systemd tearing this process down does not kill the reboot mid-flight.
pub fn reboot() {
    spawn_detached(&[
        "systemd-run",
        "--collect",
        "--no-block",
        "sh",
        "-c",
        "sudo reboot",
    ]);
}
