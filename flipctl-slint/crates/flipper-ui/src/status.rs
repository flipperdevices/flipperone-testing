//! Live system status for the status bar.
//!
//! Read straight from sysfs and procfs. The prototype gets these values by
//! polling its Node server's `/api/power`, `/api/wifi` and `/api/ethernet`, which
//! shell out to `nmcli` and friends; a native flipctl has no reason to spawn a
//! process to learn its own battery level.

use std::path::Path;
use std::time::{Duration, Instant};

/// What the ethernet indicator should show.
///
/// The prototype distinguishes a real link from the USB gadget so the bar can
/// signal "back-channel only" rather than implying a network.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum Ethernet {
    #[default]
    Down,
    Real,
    Usb,
}

#[derive(Copy, Clone, PartialEq, Debug)]
pub struct Status {
    /// Battery charge 0..=100, or -1 while unknown. The bar shows `--%` for -1,
    /// which is what the prototype does before its first poll answers.
    pub battery: i32,
    pub charging: bool,
    pub wifi_connected: bool,
    /// Signal quality 0..=100.
    pub wifi_quality: i32,
    pub ethernet: Ethernet,
    /// No modem present means the whole signal-bars-and-tech block is hidden,
    /// rather than drawn empty.
    pub modem_available: bool,
    pub access_tech: &'static str,
    pub modem_quality: i32,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            battery: -1,
            charging: false,
            wifi_connected: false,
            wifi_quality: 0,
            ethernet: Ethernet::Down,
            modem_available: false,
            access_tech: "--",
            modem_quality: 0,
        }
    }
}

/// Polls sysfs on an interval and caches the result.
pub struct StatusSource {
    interval: Duration,
    last: Instant,
    current: Status,
}

impl StatusSource {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            // Force a read on the first poll rather than waiting out one interval.
            last: Instant::now() - interval,
            current: Status::default(),
        }
    }

    /// Returns `Some` only when something changed, so a caller can avoid marking
    /// the screen dirty for an unchanged battery reading.
    pub fn poll(&mut self) -> Option<Status> {
        if self.last.elapsed() < self.interval {
            return None;
        }
        self.last = Instant::now();

        let fresh = read_status();
        if fresh == self.current {
            return None;
        }
        self.current = fresh;
        Some(fresh)
    }

    pub fn current(&self) -> Status {
        self.current
    }
}

fn read(path: impl AsRef<Path>) -> Option<String> {
    std::fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

fn read_status() -> Status {
    let (battery, charging) = read_battery();
    let (wifi_connected, wifi_quality) = read_wifi();
    Status {
        battery,
        charging,
        wifi_connected,
        wifi_quality,
        ethernet: read_ethernet(),
        modem_available: modem_present(),
        access_tech: "--",
        modem_quality: 0,
    }
}

/// The pack, as opposed to the charger or the USB-C source.
///
/// `type` is the discriminator: this board exposes three supplies
/// (`bq257xx-charger`, `bq28z610-0`, `tcpm-source-psy-2-0022`) and only the fuel
/// gauge calls itself a Battery. One rule, used by everything that needs the pack.
pub fn battery_dir() -> Option<std::path::PathBuf> {
    std::fs::read_dir("/sys/class/power_supply")
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|dir| read(dir.join("type")).as_deref() == Some("Battery"))
}

/// Charge level and whether it is charging.
///
/// `status` is the authority on charging: this device reports `Not charging` when
/// a charger is attached but the pack is full enough to stop, which is not the
/// same as `Charging`.
fn read_battery() -> (i32, bool) {
    let Some(dir) = battery_dir() else {
        return (-1, false);
    };
    let level = read(dir.join("capacity"))
        .and_then(|s| s.parse::<i32>().ok())
        .map(|v| v.clamp(0, 100))
        .unwrap_or(-1);
    let charging = matches!(
        read(dir.join("status")).as_deref(),
        Some("Charging") | Some("Full")
    );
    (level, charging)
}

/// A wireless interface counts as connected only with a carrier, not merely up:
/// an associated-but-not-linked radio should not claim a connection.
fn read_wifi() -> (bool, i32) {
    let Ok(entries) = std::fs::read_dir("/sys/class/net") else {
        return (false, 0);
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.join("wireless").is_dir() {
            continue;
        }
        let up = read(dir.join("carrier")).as_deref() == Some("1")
            && read(dir.join("operstate")).as_deref() == Some("up");
        if !up {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        return (true, wifi_quality(&name));
    }
    (false, 0)
}

/// Link quality from `/proc/net/wireless`, third column.
///
/// Most drivers report it out of 70, which is what wireless-tools assumes, so it
/// is scaled to a percentage on that basis. The icon only has five buckets, so a
/// driver that reports a different ceiling shifts the picture by at most one step.
fn wifi_quality(iface: &str) -> i32 {
    let Some(text) = read("/proc/net/wireless") else {
        return 0;
    };
    for line in text.lines().skip(2) {
        let Some((name, rest)) = line.split_once(':') else {
            continue;
        };
        if name.trim() != iface {
            continue;
        }
        if let Some(link) = rest.split_whitespace().nth(1) {
            let link: f32 = link.trim_end_matches('.').parse().unwrap_or(0.0);
            return ((link / 70.0) * 100.0).clamp(0.0, 100.0) as i32;
        }
    }
    0
}

/// A real link wins over the USB gadget: if both are up the bar should say there
/// is a network, not just a back channel.
fn read_ethernet() -> Ethernet {
    let mut usb = false;
    // Hardware only, the same test the Ethernet page and the idle screen use: a docker
    // bridge, a VPN tun or a wireguard interface all carry, and none of them is a cable
    // in a socket.
    for name in crate::sysinfo::hardware_ifaces() {
        let dir = std::path::Path::new("/sys/class/net").join(&name);
        if dir.join("wireless").is_dir() {
            continue;
        }
        if read(dir.join("carrier")).as_deref() != Some("1") {
            continue;
        }
        // A gadget rather than a port: this machine is the USB device, so the link
        // goes to whatever it is plugged into. Asked of the interface rather than
        // guessed from its name, which read a PC's USB dongle as a gadget.
        if is_gadget(&name) {
            usb = true;
        } else {
            return Ethernet::Real;
        }
    }
    if usb {
        Ethernet::Usb
    } else {
        Ethernet::Down
    }
}

/// Whether `name` is a USB gadget interface: this machine acting as a USB device.
///
/// The gadget's netdev hangs off the UDC's gadget device, so the resolved
/// `/sys/class/net/<name>/device` path passes through a gadget node. A USB ethernet
/// adapter plugged into a host resolves under a usb device instead, which is why the
/// name is no help: both are called `usb0` about half the time.
fn is_gadget(name: &str) -> bool {
    std::fs::canonicalize(format!("/sys/class/net/{name}/device"))
        .map(|path| path.to_string_lossy().contains("/gadget"))
        .unwrap_or(false)
}

/// Whether a cellular modem exists at all.
///
/// Presence only. The tech label and signal bars need a modem to develop
/// against, and this board has none (`mmcli -L` reports no modems), so reading
/// them is left until there is hardware to verify against rather than written
/// blind. With no modem the prototype hides the whole block, which is what
/// `modem_available: false` reproduces.
fn modem_present() -> bool {
    let Ok(entries) = std::fs::read_dir("/sys/class/net") else {
        return false;
    };
    entries.flatten().any(|e| {
        let name = e.file_name().to_string_lossy().to_string();
        name.starts_with("wwan") || name.starts_with("wwp") || name.starts_with("ppp")
    })
}

/// One network interface worth showing on the idle screen.
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Link {
    pub name: String,
    pub v4: String,
    pub v6: String,
}

/// Everything the idle screen shows beyond the status bar.
#[derive(Clone, PartialEq, Debug, Default)]
pub struct Idle {
    /// Tenths of a degree C, or None while unknown.
    pub battery_temp: Option<i32>,
    pub cpu_temp: Option<i32>,
    /// Milliwatts. Positive is flowing into the battery.
    pub power_mw: Option<i32>,
    pub hostname: String,
    /// Booted btrfs subvolume with its leading `@` dropped, as the prototype
    /// displays it.
    pub profile: String,
    pub links: Vec<Link>,
}

impl Idle {
    /// Everything at once, for a first paint.
    pub fn read_all() -> Self {
        let mut idle = Self::default();
        idle.read_identity();
        idle.refresh_sensors();
        idle.refresh_links();
        idle
    }

    /// The fields that actually move: temperatures and power flow. Cheap, three
    /// small files. desktop.js polls these every 5s and so do we.
    ///
    /// Returns whether anything changed, so an unchanged reading never dirties the
    /// screen.
    pub fn refresh_sensors(&mut self) -> bool {
        let before = (self.battery_temp, self.cpu_temp, self.power_mw);
        self.battery_temp = battery_temp();
        self.cpu_temp = cpu_temp();
        self.power_mw = power_mw();
        before != (self.battery_temp, self.cpu_temp, self.power_mw)
    }

    /// Interface addresses. Worth re-reading because a cable or a DHCP renewal
    /// changes them, but far less often than the sensors: this walks
    /// /sys/class/net, parses /proc/net/if_inet6 and calls getifaddrs.
    pub fn refresh_links(&mut self) -> bool {
        let fresh = links();
        let changed = fresh != self.links;
        self.links = fresh;
        changed
    }

    /// Hostname and booted profile, read once.
    ///
    /// The profile is the `rootflags=subvol=` the kernel booted with, so it cannot
    /// change without a reboot. The hostname can in principle, but not without
    /// something restarting anyway, and polling either on a timer is pure waste.
    pub fn read_identity(&mut self) {
        self.hostname = read("/proc/sys/kernel/hostname").unwrap_or_default();
        self.profile = booted_profile();
    }
}

/// Millidegrees to tenths, rounded rather than truncated.
///
/// The prototype formats with `toFixed(1)`, so 60999 millidegrees reads 61.0.
/// Integer division gives 60.9, which is a visible disagreement with the device
/// for a reading that changes constantly.
fn tenths_from_milli(milli: i32) -> i32 {
    let sign = if milli < 0 { -1 } else { 1 };
    sign * ((milli.abs() + 50) / 100)
}

/// Temperature of the thermal zone whose type is `name`, in tenths.
fn zone_temp(name: &str) -> Option<i32> {
    let entries = std::fs::read_dir("/sys/class/thermal").ok()?;
    for entry in entries.flatten() {
        let dir = entry.path();
        if read(dir.join("type")).as_deref() != Some(name) {
            continue;
        }
        return Some(tenths_from_milli(read(dir.join("temp"))?.parse().ok()?));
    }
    None
}

/// The pack's temperature, in tenths of a degree.
///
/// Read from the thermal zone the fuel gauge registers, whose `type` is the
/// power-supply's own name (`bq28z610-0` here), which is how the prototype finds
/// it. `power_supply/*/temp` reports the same sensor but already quantised to
/// tenths, so going through the zone keeps the rounding identical to the CPU's.
fn battery_temp() -> Option<i32> {
    let dir = battery_dir()?;
    let name = dir.file_name()?.to_string_lossy().to_string();
    if let Some(t) = zone_temp(&name) {
        return Some(t);
    }
    // No matching zone: fall back to the gauge's own tenths.
    read(dir.join("temp"))?.parse().ok()
}

/// SoC package temperature, in tenths of a degree.
///
/// `package-thermal` is the one to report: this board also exposes bigcore,
/// littlecore, gpu, npu and ddr zones, plus a `bq28x610-0` zone that duplicates
/// the battery.
fn cpu_temp() -> Option<i32> {
    zone_temp("package-thermal").or_else(|| {
        // Any zone whose type mentions the package, as the prototype falls back
        // to: zone indices move between kernels but the type does not.
        let entries = std::fs::read_dir("/sys/class/thermal").ok()?;
        for entry in entries.flatten() {
            let dir = entry.path();
            if !read(dir.join("type"))?.contains("package") {
                continue;
            }
            return Some(tenths_from_milli(read(dir.join("temp"))?.parse().ok()?));
        }
        None
    })
}

/// Power into or out of the battery, in milliwatts.
///
/// `power_avg` first, which is what the prototype reads: the bq28z610 gauge
/// writes a smoothed average there, and the instantaneous product of
/// `current_now` and `voltage_now` visibly jitters by comparison. This gauge
/// exposes no `power_now`, so that is only a middle fallback.
///
/// Negative means the pack is discharging, matching the prototype's convention
/// that positive flows into the battery.
fn power_mw() -> Option<i32> {
    let entries = std::fs::read_dir("/sys/class/power_supply").ok()?;
    for entry in entries.flatten() {
        let dir = entry.path();
        if read(dir.join("type")).as_deref() != Some("Battery") {
            continue;
        }
        for field in ["power_avg", "power_now"] {
            if let Some(uw) = read(dir.join(field)).and_then(|s| s.parse::<i64>().ok()) {
                return Some((uw / 1000) as i32);
            }
        }
        let ua = read(dir.join("current_now"))?.parse::<i64>().ok()?;
        let uv = read(dir.join("voltage_now"))?.parse::<i64>().ok()?;
        // uA * uV = pW; /1_000_000_000 gives mW.
        return Some(((ua * uv) / 1_000_000_000) as i32);
    }
    None
}

/// Booted subvolume from `rootflags=subvol=...`, minus the leading `@`.
fn booted_profile() -> String {
    read("/proc/cmdline")
        .unwrap_or_default()
        .split_whitespace()
        .find_map(|arg| arg.strip_prefix("rootflags=")?.strip_prefix("subvol="))
        .map(|s| s.trim_start_matches('@').to_string())
        .unwrap_or_default()
}

/// Interfaces with a carrier, each with its addresses.
///
/// IPv6 comes from `/proc/net/if_inet6`, which is plain text. There is no
/// equivalent for IPv4, so that side uses `getifaddrs`; the alternative was
/// shelling out to `ip`, which a UI process has no business doing.
fn links() -> Vec<Link> {
    let mut out: Vec<Link> = Vec::new();
    let v6 = ipv6_by_interface();
    // The same interfaces the Ethernet page lists, plus wireless: hardware with a
    // live link. A machine's bridges, veths and VPN tunnels are not its network, and
    // a port with no address of its own has nothing to say on a screen that exists to
    // show addresses.
    for name in crate::sysinfo::hardware_ifaces() {
        let dir = std::path::Path::new("/sys/class/net").join(&name);
        if read(dir.join("carrier")).as_deref() != Some("1") {
            continue;
        }
        let v4 = ipv4_all(&name);
        if v4.is_empty() {
            continue;
        }
        // Labelled from the port's own name, by the same function the Ethernet page
        // uses, so the two screens agree about which port is which: end0 is ETH0 on
        // both and the gadget is USB ETH on both. Numbering the rows here instead
        // renamed every port below one that had no address yet, so a machine whose
        // first socket was empty called its second one ETH0.
        //
        // Wireless is the exception, because its name carries nothing a person can
        // use: wlxb06b11673af2 is one card, and what matters is that it is the wifi.
        let label = if dir.join("wireless").is_dir() {
            "WIFI".to_string()
        } else {
            crate::sysinfo::iface_display_name(&name)
        };
        out.push(Link {
            name: label,
            v4: v4.first().cloned().unwrap_or_default(),
            v6: v6.get(&name).cloned().unwrap_or_default(),
        });
    }
    out
}

/// Link-local and global IPv6 per interface, from procfs. The address arrives as
/// 32 hex digits with no separators.
fn ipv6_by_interface() -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for (iface, addr) in ipv6_list() {
        map.entry(iface).or_insert(addr);
    }
    map
}

/// Every global IPv6 address, as (interface, address).
///
/// Written out in shortest form by `sysinfo::format_ipv6`, which is the same
/// RFC 5952 collapse this used to carry its own copy of.
fn ipv6_list() -> Vec<(String, String)> {
    let mut out = Vec::new();
    let Some(text) = read("/proc/net/if_inet6") else {
        return out;
    };
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        let Some(hex) = fields.next() else { continue };
        let Some(iface) = fields.nth(4) else { continue };
        if iface == "lo" || hex.len() != 32 {
            continue;
        }
        let mut groups = [0u16; 8];
        for (i, g) in groups.iter_mut().enumerate() {
            *g = u16::from_str_radix(&hex[i * 4..i * 4 + 4], 16).unwrap_or(0);
        }
        out.push((iface.to_string(), crate::sysinfo::format_ipv6(&groups)));
    }
    out
}

/// Every IPv6 address on one interface.
pub fn ipv6_all(want: &str) -> Vec<String> {
    ipv6_list()
        .into_iter()
        .filter(|(iface, _)| iface == want)
        .map(|(_, addr)| addr)
        .collect()
}

/// Every IPv4 address on one interface, via `getifaddrs`.
pub fn ipv4_all(want: &str) -> Vec<String> {
    use std::ffi::CStr;

    let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs allocates the list and we free it below on every path.
    if unsafe { libc::getifaddrs(&mut head) } != 0 {
        return Vec::new();
    }
    let mut found = Vec::new();
    let mut cur = head;
    while !cur.is_null() {
        // SAFETY: cur is non-null and getifaddrs guarantees the field layout.
        let entry = unsafe { &*cur };
        if !entry.ifa_name.is_null() && !entry.ifa_addr.is_null() {
            // SAFETY: ifa_name is a NUL-terminated C string.
            let name = unsafe { CStr::from_ptr(entry.ifa_name) }.to_string_lossy();
            // SAFETY: sa_family is the first field of every sockaddr variant.
            let family = unsafe { (*entry.ifa_addr).sa_family };
            if name == want && i32::from(family) == libc::AF_INET {
                // SAFETY: family says this is a sockaddr_in.
                let sin = unsafe { &*(entry.ifa_addr as *const libc::sockaddr_in) };
                // s_addr already holds the address in network order, so read the
                // bytes as they sit in memory. to_be_bytes() would reverse them on
                // a little-endian host and turn 192.168.1.241 into 241.1.168.192.
                let octets = sin.sin_addr.s_addr.to_ne_bytes();
                found.push(format!(
                    "{}.{}.{}.{}",
                    octets[0], octets[1], octets[2], octets[3]
                ));
            }
        }
        cur = entry.ifa_next;
    }
    // SAFETY: head came from getifaddrs and is freed exactly once.
    unsafe { libc::freeifaddrs(head) };
    found
}
