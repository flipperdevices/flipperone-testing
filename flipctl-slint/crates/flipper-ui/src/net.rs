//! Radio state for the Network menu.
//!
//! Unlike `status`, this cannot come from sysfs. Airplane mode is not a kernel
//! concept: the prototype defines it as "NetworkManager has both the wifi and the
//! wwan radios disabled", and the only supported way to read or change that is
//! `nmcli`. So this module does shell out, on a background thread.
//!
//! Told rather than asked. The prototype polls every three seconds, which is two
//! `nmcli` processes every three seconds forever, and NetworkManager and dbus pay for
//! each one: it was the last of our periodic wakeups. `nmcli monitor` is a process
//! that says nothing until something changes, so the state is read once at startup
//! and then only when NetworkManager reports a change, which also means a radio
//! toggle shows up at once instead of up to three seconds later.
//!
//! Writes are optimistic exactly as they are in the prototype: the local value
//! flips immediately so the row redraws on the same frame as the key press, and
//! the next read reconciles if the radio refused.

use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// How long to wait before starting the monitor again after it ends.
///
/// It ends when NetworkManager restarts, and it never starts at all on a machine
/// without it: either way this is the interval between attempts, and a read goes with
/// each one so the state is still refreshed on a machine where the monitor cannot run.
const RETRY: Duration = Duration::from_secs(10);

/// How long to leave a change of ours before checking that it took.
const CONFIRM: Duration = Duration::from_millis(1500);

/// How long to wait for a burst of changes to finish before reading.
///
/// One connection coming up prints several lines, and each read costs two processes,
/// so they are coalesced into one.
const SETTLE: Duration = Duration::from_millis(300);

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
/// Why the watcher woke: NetworkManager said something, or we changed something and
/// want to see whether it took.
enum Wake {
    Told,
    Ours,
    /// The monitor's output ended, which is what NetworkManager restarting looks like.
    Ended,
}

pub struct NetSource {
    state: Arc<Mutex<Net>>,
    /// How a write asks the watcher to look again. A radio the hardware refuses
    /// produces no event at all, so the optimistic flip has to be checked by us.
    poke: std::sync::mpsc::Sender<Wake>,
    /// Set whenever the poller or a write changes the state, so the loop knows to
    /// repaint without diffing.
    dirty: Arc<AtomicBool>,
}

impl NetSource {
    pub fn spawn() -> Self {
        let state = Arc::new(Mutex::new(Net::default()));
        let dirty = Arc::new(AtomicBool::new(false));
        // One channel for the life of the watcher: the monitor's lines and our own
        // writes both arrive on it, and it is what the watcher blocks on.
        let (poke, wakes) = std::sync::mpsc::channel::<Wake>();
        let told = poke.clone();
        let (s, d) = (Arc::clone(&state), Arc::clone(&dirty));
        thread::Builder::new()
            .name("net-watch".into())
            .spawn(move || {
                let publish = |fresh: Net| {
                    let mut cur = s.lock().unwrap();
                    if *cur != fresh {
                        *cur = fresh;
                        d.store(true, Ordering::Relaxed);
                    }
                };
                loop {
                    publish(read_net());
                    let mut monitor = match Command::new("nmcli")
                        .arg("monitor")
                        .stdin(Stdio::null())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::null())
                        .spawn()
                    {
                        Ok(child) => child,
                        // No NetworkManager here, or no nmcli: nothing to watch and
                        // nothing to read, so wait rather than spin.
                        Err(_) => {
                            thread::sleep(RETRY);
                            continue;
                        }
                    };
                    if let Some(out) = monitor.stdout.take() {
                        // The lines are read on a thread of their own and this one
                        // waits: a burst then costs one read rather than one read per
                        // line, and the read happens after the burst rather than in the
                        // middle of it.
                        let lines = told.clone();
                        thread::Builder::new()
                            .name("net-monitor".into())
                            .spawn(move || {
                                use std::io::{BufRead, BufReader};
                                for line in BufReader::new(out).lines().map_while(Result::ok) {
                                    let _ = line;
                                    if lines.send(Wake::Told).is_err() {
                                        return;
                                    }
                                }
                                // The pipe closed. Said explicitly, because the channel
                                // itself never closes: a write holds a sender for the
                                // life of the source, so waiting for the receive to
                                // fail would wait forever and nothing would ever be
                                // read again.
                                let _ = lines.send(Wake::Ended);
                            })
                            .ok();
                        let mut ended = false;
                        while let Ok(wake) = wakes.recv() {
                            match wake {
                                // NetworkManager talks in bursts: wait for quiet. The
                                // burst is drained, but not the news that came with it:
                                // NetworkManager stopping is a burst of events followed
                                // by the pipe closing, and swallowing that last one left
                                // the watcher blocked on a monitor that had gone.
                                Wake::Told => {
                                    while let Ok(next) = wakes.recv_timeout(SETTLE) {
                                        ended |= matches!(next, Wake::Ended);
                                    }
                                }
                                // Our own change: give the radio a moment to refuse it.
                                Wake::Ours => thread::sleep(CONFIRM),
                                Wake::Ended => ended = true,
                            }
                            // Read before leaving: the radios going with NetworkManager
                            // is itself the state, and the screen should say so.
                            publish(read_net());
                            if ended {
                                break;
                            }
                        }
                    }
                    // The monitor ended, which NetworkManager restarting does.
                    let _ = monitor.wait();
                    thread::sleep(RETRY);
                }
            })
            .expect("spawn net watcher");
        Self { state, dirty, poke }
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
        // The row is showing what we asked for, not what happened: have the watcher
        // look again once the radio has had time to refuse.
        let _ = self.poke.send(Wake::Ours);
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
