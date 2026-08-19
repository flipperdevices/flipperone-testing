//! The button source: raw evdev, no libinput.
//!
//! The MCU input driver registers `Flipper One Buttons` and `Flipper One Software
//! Buttons` with identical keycodes, one carrying physical presses and one
//! carrying injected ones, so a remote viewer's click and a finger are
//! indistinguishable downstream. Both are opened. The touchpad and headset
//! devices are ignored here.
//!
//! libinput is deliberately absent: it would drag libwacom and glib into a
//! maskrom-loaded initramfs to service thirteen buttons, and libxkbcommon would
//! compile a keymap for a device with no keyboard. Enumeration goes through sysfs
//! instead of udev, which is safe because these buttons are soldered on and
//! cannot hotplug.

use std::fs::{File, OpenOptions};
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

use crate::platform::InputSource;
use crate::{FlipperKey, KeyEvent};

/// `struct input_event` on 64-bit Linux: a 16-byte timeval, then type, code and
/// value. Read in whole units; a short read means the device went away.
const EVENT_SIZE: usize = 24;
const EV_KEY: u16 = 1;

/// Devices whose names start and end like this are button devices.
const NAME_PREFIX: &str = "Flipper One";
const NAME_SUFFIX: &str = "Buttons";

pub struct EvdevSource {
    devices: Vec<File>,
    queue: std::collections::VecDeque<KeyEvent>,
    buf: [u8; EVENT_SIZE * 32],
}

impl EvdevSource {
    /// Open every Flipper One button device.
    ///
    /// Fails only when none is found; a device that exists but cannot be opened
    /// is skipped, so a permissions problem on one node does not take out the
    /// whole UI.
    pub fn open() -> std::io::Result<Self> {
        let paths = Self::find_devices()?;
        if paths.is_empty() {
            return Err(std::io::Error::other(format!(
                "no input device named {NAME_PREFIX} ... {NAME_SUFFIX}"
            )));
        }

        let devices: Vec<File> = paths
            .iter()
            .filter_map(|path| {
                OpenOptions::new()
                    .read(true)
                    .custom_flags(libc_o_nonblock())
                    .open(path)
                    .ok()
            })
            .collect();

        if devices.is_empty() {
            return Err(std::io::Error::other(
                "found button devices but could not open any of them",
            ));
        }

        Ok(Self {
            devices,
            queue: std::collections::VecDeque::new(),
            buf: [0; EVENT_SIZE * 32],
        })
    }

    /// `/dev/input/eventN` for every `/sys/class/input/eventN/device/name` that
    /// looks like a Flipper One button device.
    fn find_devices() -> std::io::Result<Vec<PathBuf>> {
        let mut found = Vec::new();
        for entry in std::fs::read_dir("/sys/class/input")? {
            let entry = entry?;
            let node = entry.file_name();
            let Some(node) = node.to_str() else { continue };
            if !node.starts_with("event") {
                continue;
            }
            let Ok(name) = std::fs::read_to_string(entry.path().join("device/name")) else {
                continue;
            };
            let name = name.trim();
            if name.starts_with(NAME_PREFIX) && name.ends_with(NAME_SUFFIX) {
                found.push(PathBuf::from("/dev/input").join(node));
            }
        }
        found.sort();
        Ok(found)
    }

    /// Drain every device once, appending to the queue.
    fn drain(&mut self) {
        for i in 0..self.devices.len() {
            loop {
                let read = match self.devices[i].read(&mut self.buf) {
                    Ok(0) => break,
                    Ok(n) => n,
                    // WouldBlock is the normal way to find out there is nothing
                    // left; anything else means this device is done for now.
                    Err(_) => break,
                };
                for chunk in self.buf[..read].chunks_exact(EVENT_SIZE) {
                    let kind = u16::from_ne_bytes([chunk[16], chunk[17]]);
                    let code = u16::from_ne_bytes([chunk[18], chunk[19]]);
                    let value = i32::from_ne_bytes([chunk[20], chunk[21], chunk[22], chunk[23]]);
                    if kind != EV_KEY {
                        continue;
                    }
                    // value 2 is auto-repeat. The UI wants held state, which it
                    // already has from the down event, so repeats are dropped.
                    let down = match value {
                        0 => false,
                        1 => true,
                        _ => continue,
                    };
                    if let Some(key) = FlipperKey::from_evdev(code) {
                        self.queue.push_back(KeyEvent { key, down });
                    }
                }
                if read < EVENT_SIZE {
                    break;
                }
            }
        }
    }

    /// Raw fds, for a caller that wants to block in `poll(2)` rather than spin.
    pub fn fds(&self) -> Vec<std::os::fd::BorrowedFd<'_>> {
        use std::os::fd::AsFd;
        self.devices.iter().map(|f| f.as_fd()).collect()
    }
}

impl InputSource for EvdevSource {
    fn poll(&mut self) -> Option<KeyEvent> {
        if self.queue.is_empty() {
            self.drain();
        }
        self.queue.pop_front()
    }
}

/// `O_NONBLOCK`, without taking a dependency on libc for one constant.
const fn libc_o_nonblock() -> i32 {
    0o4000
}
