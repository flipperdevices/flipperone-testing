//! System information for the Settings and Network detail screens.
//!
//! The prototype gets all of this from its Node server, which shells out to `ip`,
//! `df`, `mmcli`, `qmicli` and `git`. Where the kernel exposes the same fact
//! directly this reads it directly: routes come from procfs and the disk from
//! `statvfs`, because spawning a process to learn the size of a filesystem is
//! silly. Where there is no interface but a tool, the tool is run, on a
//! background thread (see `watch`).

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

/// Run a command and return stdout, or None if it could not be run or failed.
///
/// Every failure means the same thing to a detail screen: the field is unknown and
/// shows as `--`. There is nothing useful to distinguish a missing binary from a
/// refused D-Bus call here.
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

fn read_i64(path: impl AsRef<Path>) -> Option<i64> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}

fn read_str(path: impl AsRef<Path>) -> Option<String> {
    Some(fs::read_to_string(path).ok()?.trim().to_string())
}

// ── Routing ────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Route {
    /// "IPv4" or "IPv6", as the prototype labels them.
    pub family: &'static str,
    pub gateway: String,
    pub dev: String,
    pub metric: Option<i32>,
}

/// Default routes, newest kernel view.
///
/// The prototype runs `ip -4 route show default` and `ip -6 route show default`
/// and regexes `default via <gw> dev <dev> ... metric <n>`. Reading procfs
/// instead avoids two subprocesses on a 1-second poll: `/proc/net/route` carries
/// the v4 table and `/proc/net/ipv6_route` the v6 one, both in hex.
pub fn routes() -> Vec<Route> {
    let mut out = Vec::new();

    // /proc/net/route: Iface Destination Gateway Flags RefCnt Use Metric Mask ...
    // A default route is the one whose destination is 0.0.0.0. Values are
    // little-endian hex, which is why the octets come out reversed.
    if let Ok(text) = fs::read_to_string("/proc/net/route") {
        for line in text.lines().skip(1) {
            let f: Vec<&str> = line.split_whitespace().collect();
            if f.len() < 8 || f[1] != "00000000" {
                continue;
            }
            let Ok(gw) = u32::from_str_radix(f[2], 16) else {
                continue;
            };
            let b = gw.to_le_bytes();
            out.push(Route {
                family: "IPv4",
                gateway: format!("{}.{}.{}.{}", b[0], b[1], b[2], b[3]),
                dev: f[0].to_string(),
                metric: f[6].parse().ok(),
            });
        }
    }

    // /proc/net/ipv6_route: dest plen src plen nexthop metric refcnt use flags dev
    // The default route has a zero destination and a zero prefix length.
    if let Ok(text) = fs::read_to_string("/proc/net/ipv6_route") {
        for line in text.lines() {
            let f: Vec<&str> = line.split_whitespace().collect();
            if f.len() < 10 || f[1] != "00" || f[0] != "00000000000000000000000000000000" {
                continue;
            }
            let Some(gw) = ipv6_from_hex(f[4]) else {
                continue;
            };
            // A default route with no next hop is not a gateway route.
            if gw == "::" {
                continue;
            }
            out.push(Route {
                family: "IPv6",
                gateway: gw,
                dev: f[9].to_string(),
                metric: i32::from_str_radix(f[5], 16).ok(),
            });
        }
    }
    out
}

/// 32 hex characters to a shortest-form IPv6 literal, per RFC 5952.
fn ipv6_from_hex(hex: &str) -> Option<String> {
    if hex.len() != 32 {
        return None;
    }
    let mut groups = [0u16; 8];
    for (i, g) in groups.iter_mut().enumerate() {
        *g = u16::from_str_radix(&hex[i * 4..i * 4 + 4], 16).ok()?;
    }
    Some(format_ipv6(&groups))
}

/// Collapse the longest run of zero groups, which is what makes an address
/// readable on a 256px panel.
pub fn format_ipv6(groups: &[u16; 8]) -> String {
    let mut best = (0usize, 0usize);
    let mut i = 0;
    while i < 8 {
        if groups[i] == 0 {
            let start = i;
            while i < 8 && groups[i] == 0 {
                i += 1;
            }
            if i - start > best.1 {
                best = (start, i - start);
            }
        } else {
            i += 1;
        }
    }
    // A single zero group is written out; only a run of two or more collapses.
    if best.1 < 2 {
        return groups
            .iter()
            .map(|g| format!("{g:x}"))
            .collect::<Vec<_>>()
            .join(":");
    }
    let head: Vec<String> = groups[..best.0].iter().map(|g| format!("{g:x}")).collect();
    let tail: Vec<String> = groups[best.0 + best.1..]
        .iter()
        .map(|g| format!("{g:x}"))
        .collect();
    format!("{}::{}", head.join(":"), tail.join(":"))
}

// ── Disk ───────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Disk {
    pub device: String,
    pub mounted: bool,
    pub used_gb: f32,
    pub total_gb: f32,
}

/// Usage of the filesystem on `device`.
///
/// The prototype runs `df -k <device>`. `statvfs` is the same numbers without the
/// subprocess, but it takes a path rather than a device, so the mount point comes
/// out of /proc/mounts first. Used is total minus free-to-root, matching how df
/// computes it, not total minus available.
/// Usage of the filesystem mounted at `point`.
pub fn disk_at(point: &str) -> Disk {
    let mut d = Disk {
        device: point.to_string(),
        ..Default::default()
    };
    let Ok(c) = std::ffi::CString::new(point) else {
        return d;
    };
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return d;
    }
    let frsize = st.f_frsize as f64;
    let total = st.f_blocks as f64 * frsize;
    // Used is total minus free-to-root, which is how df computes it, rather than
    // total minus available.
    let used = (st.f_blocks - st.f_bfree) as f64 * frsize;
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    d.mounted = st.f_blocks > 0;
    d.total_gb = ((total / GB) * 10.0).round() as f32 / 10.0;
    d.used_gb = ((used / GB) * 10.0).round() as f32 / 10.0;
    d
}

/// The device backing a mount point, from /proc/mounts.
pub fn device_at(point: &str) -> Option<String> {
    let mounts = fs::read_to_string("/proc/mounts").ok()?;
    mounts.lines().find_map(|l| {
        let mut f = l.split_whitespace();
        let dev = f.next()?;
        let at = f.next()?;
        (at.replace("\\040", " ") == point).then(|| dev.to_string())
    })
}

/// The largest partition of `disk`, which is the data partition on a card whose
/// other partitions are boot and metadata.
///
/// The prototype hardcodes `/dev/mmcblk0p2`, which on this board is the 4MB
/// metadata partition rather than the 29.7GB data one, so a mounted card would be
/// reported as 4MB. Picking by size gets the partition a person means.
pub fn largest_partition(disk: &str) -> Option<String> {
    let base = disk.rsplit('/').next()?;
    let dir = format!("/sys/class/block/{base}");
    let mut best: Option<(u64, String)> = None;
    for entry in fs::read_dir(&dir).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(base) {
            continue;
        }
        // Size is in 512-byte sectors.
        let Some(sectors) = read_i64(entry.path().join("size")) else {
            continue;
        };
        let sectors = sectors as u64;
        if best.as_ref().is_none_or(|(b, _)| sectors > *b) {
            best = Some((sectors, format!("/dev/{name}")));
        }
    }
    best.map(|(_, n)| n)
}

pub fn disk(device: &str) -> Disk {
    let mut d = Disk {
        device: device.to_string(),
        ..Default::default()
    };
    let Ok(mounts) = fs::read_to_string("/proc/mounts") else {
        return d;
    };
    let Some(point) = mounts.lines().find_map(|l| {
        let mut f = l.split_whitespace();
        (f.next()? == device).then(|| f.next().map(|s| s.to_string()))?
    }) else {
        return d;
    };

    // Mount points in /proc/mounts escape spaces as \040.
    let point = point.replace("\\040", " ");
    let Ok(c) = std::ffi::CString::new(point) else {
        return d;
    };
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return d;
    }
    let frsize = st.f_frsize as f64;
    let total = st.f_blocks as f64 * frsize;
    let used = (st.f_blocks - st.f_bfree) as f64 * frsize;
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    d.mounted = true;
    // One decimal, as the prototype's toFixed(1) gives.
    d.total_gb = ((total / GB) * 10.0).round() as f32 / 10.0;
    d.used_gb = ((used / GB) * 10.0).round() as f32 / 10.0;
    d
}

// ── Battery ────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Battery {
    pub available: bool,
    /// "Charging", "Discharging", "Full", ... straight from sysfs.
    pub status: String,
    pub capacity: Option<i32>,
    /// Volts, amps and watts, each to three decimals as the prototype reports.
    pub voltage: Option<f32>,
    pub current: Option<f32>,
    pub power: Option<f32>,
    /// Amp-hours.
    pub charge_now: Option<f32>,
    pub charge_full: Option<f32>,
    pub time_to_empty: Option<i64>,
    pub time_to_full: Option<i64>,
    /// Tenths of a degree Celsius, as sysfs reports it.
    pub temp: Option<i64>,
}

pub fn battery() -> Battery {
    let Some(p) = crate::status::battery_dir() else {
        return Battery::default();
    };
    let micro = |name: &str| read_i64(p.join(name)).map(|v| v as f32 / 1_000_000.0);
    let v = micro("voltage_now");
    let i = micro("current_now");
    Battery {
        available: true,
        status: read_str(p.join("status")).unwrap_or_else(|| "Unknown".into()),
        capacity: read_i64(p.join("capacity")).map(|v| v as i32),
        voltage: v,
        current: i,
        // power_now if the gauge reports it, else V*I, which is what the
        // prototype falls back to.
        power: micro("power_now").or_else(|| match (v, i) {
            (Some(v), Some(i)) => Some(v * i),
            _ => None,
        }),
        charge_now: micro("charge_now"),
        charge_full: micro("charge_full"),
        time_to_empty: read_i64(p.join("time_to_empty_now")),
        time_to_full: read_i64(p.join("time_to_full_now")),
        temp: read_i64(p.join("temp")),
    }
}

/// Seconds as the prototype's `fmtTime`: hours and minutes, or minutes and
/// seconds, or seconds.
pub fn fmt_time(sec: Option<i64>) -> String {
    let Some(sec) = sec.filter(|s| *s >= 0) else {
        return "--".into();
    };
    let (h, m, s) = (sec / 3600, (sec % 3600) / 60, sec % 60);
    if h > 0 {
        format!("{h}h {m:02}m")
    } else if m > 0 {
        format!("{m}m {s:02}s")
    } else {
        format!("{s}s")
    }
}

// ── Modem ──────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Modem {
    pub available: bool,
    pub model: String,
    pub operator: String,
    pub state: String,
    /// Access technologies as ModemManager reports them, e.g. ["lte"].
    pub access_tech: Vec<String>,
    pub signal_quality: Option<i32>,
    pub ip4: String,
    pub iface: String,
    /// Cell identity, from qmicli's serving-system and cell-location views.
    pub cell_id: String,
    pub tac: String,
    pub mcc: String,
    pub mnc: String,
    pub pci: String,
    pub earfcn: String,
    pub band: String,
    pub rsrp: String,
    pub rsrq: String,
    pub sinr: String,
    /// Negotiated link rates in Mbit/s.
    pub dl_mbps: Option<f32>,
    pub ul_mbps: Option<f32>,
}

/// The value of a `"key": ...` pair in a flat-ish JSON blob.
///
/// mmcli's `-J` output is nested, but every field this screen wants has a unique
/// key name, so a scan for the key beats carrying a JSON parser. Values are
/// returned verbatim minus surrounding quotes; `--` and empty string both become
/// empty, since mmcli uses `--` for "not applicable".
fn json_value(src: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\":");
    let mut at = src.find(&needle)? + needle.len();
    let bytes = src.as_bytes();
    while at < bytes.len() && (bytes[at] as char).is_whitespace() {
        at += 1;
    }
    let rest = &src[at..];
    let raw = if rest.starts_with('"') {
        let end = rest[1..].find('"')? + 1;
        rest[1..end].to_string()
    } else {
        let end = rest
            .find([',', '}', ']', '\n'])
            .unwrap_or(rest.len());
        rest[..end].trim().to_string()
    };
    (raw != "--" && !raw.is_empty() && raw != "null").then_some(raw)
}

/// `json_value`, but only searching after `scope`.
///
/// Needed because a few key names are not unique in mmcli's output: `value`
/// appears under both signal-quality and other blocks, and `address` under both
/// ipv4-config and ipv6-config. Anchoring on the parent key first is enough to
/// disambiguate without a real parser.
fn json_value_in(src: &str, scope: &str, key: &str) -> Option<String> {
    let at = src.find(&format!("\"{scope}\""))?;
    json_value(&src[at..], key)
}

/// The strings of a `"key": [...]` array.
fn json_array(src: &str, key: &str) -> Vec<String> {
    let needle = format!("\"{key}\":");
    let Some(at) = src.find(&needle) else {
        return Vec::new();
    };
    let rest = &src[at + needle.len()..];
    let Some(open) = rest.find('[') else {
        return Vec::new();
    };
    let Some(close) = rest[open..].find(']') else {
        return Vec::new();
    };
    rest[open + 1..open + close]
        .split(',')
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty() && s != "--")
        .collect()
}

/// The first capture of a pattern shaped `<label><ws>'<value>'`.
///
/// qmicli prints human-readable output, not JSON, so the prototype regexes it.
/// Every field it wants has the same shape, so one scan for the label followed by
/// the next quoted run replaces the regex engine.
fn quoted_after(src: &str, label: &str) -> String {
    let Some(at) = src.find(label) else {
        return String::new();
    };
    let rest = &src[at + label.len()..];
    let Some(open) = rest.find('\'') else {
        return String::new();
    };
    let Some(close) = rest[open + 1..].find('\'') else {
        return String::new();
    };
    rest[open + 1..open + 1 + close].to_string()
}

/// Negotiated speed of `iface`, from sysfs rather than ethtool.
fn link_mbps(iface: &str) -> Option<f32> {
    read_i64(format!("/sys/class/net/{iface}/speed")).map(|v| v as f32)
}

pub fn modem(qmi_dev: &str) -> Modem {
    let mut m = Modem::default();
    let Some(mm) = output(&["mmcli", "-m", "0", "-J"]) else {
        return m;
    };
    m.available = true;
    m.model = json_value(&mm, "model").unwrap_or_default();
    m.operator = json_value(&mm, "operator-name").unwrap_or_default();
    m.state = json_value(&mm, "state").unwrap_or_default();
    m.access_tech = json_array(&mm, "access-technologies");
    m.signal_quality = json_value_in(&mm, "signal-quality", "value").and_then(|v| v.parse().ok());

    // The newest bearer carries the active connection's addresses.
    if let Some(path) = json_array(&mm, "bearers").last() {
        if let Some(num) = path.rsplit('/').next() {
            if let Some(b) = output(&["mmcli", "-b", num, "-J"]) {
                m.ip4 = json_value_in(&b, "ipv4-config", "address").unwrap_or_default();
                m.iface = json_value(&b, "interface").unwrap_or_default();
            }
        }
    }
    if !m.iface.is_empty() {
        m.dl_mbps = link_mbps(&m.iface);
        m.ul_mbps = m.dl_mbps;
    }

    // Cell identity. These three calls are why the whole struct is refreshed on a
    // background thread: each opens the QMI device and takes ~100ms.
    let qmi = |arg: &str| {
        output(&[
            "qmicli",
            "-d",
            qmi_dev,
            "--device-open-proxy",
            arg,
        ])
        .unwrap_or_default()
    };
    let ss = qmi("--nas-get-serving-system");
    m.cell_id = quoted_after(&ss, "3GPP cell ID:");
    m.tac = quoted_after(&ss, "LTE tracking area code:");
    m.mcc = quoted_after(&ss, "MCC:");
    m.mnc = quoted_after(&ss, "MNC:");

    let cl = qmi("--nas-get-cell-location-info");
    m.pci = quoted_after(&cl, "Serving Cell ID:");
    // The channel number's parenthetical is the band, e.g. "1850" (Band 3).
    if let Some(at) = cl.find("EUTRA Absolute RF Channel Number:") {
        let rest = &cl[at..];
        m.earfcn = quoted_after(rest, "EUTRA Absolute RF Channel Number:");
        if let (Some(o), Some(c)) = (rest.find('('), rest.find(')')) {
            if o < c {
                m.band = rest[o + 1..c].to_string();
            }
        }
    }

    let sig = qmi("--nas-get-signal-strength");
    m.rsrp = quoted_after(&sig, "RSRP:");
    m.rsrq = quoted_after(&sig, "RSRQ:");
    m.sinr = quoted_after(&sig, "SINR");
    m
}

/// Bars 0..=5 from a signal quality percentage, as the modem screen shows them.
pub fn signal_bars(quality: Option<i32>) -> i32 {
    match quality {
        None => 0,
        Some(q) => match q {
            0 => 0,
            1..=20 => 1,
            21..=40 => 2,
            41..=60 => 3,
            61..=80 => 4,
            _ => 5,
        },
    }
}

// ── Update ─────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UpdateStatus {
    /// None while the check is still running, which is a distinct state from
    /// "checked, nothing available".
    pub checked: bool,
    pub available: bool,
    pub current_commit: String,
    /// One line per commit between HEAD and the remote branch.
    pub commits: Vec<String>,
    pub error: String,
}

/// Compare the deployed checkout against its remote branch.
///
/// Same three git calls the prototype's `getUpdateStatus` makes, and the same
/// three failure messages, because they are the ones that tell the difference
/// between "not a repo", "no internet" and "cannot compare".
pub fn update_check(repo: &str, branch: &str) -> UpdateStatus {
    let mut u = UpdateStatus {
        checked: true,
        ..Default::default()
    };
    let git = |args: &[&str]| {
        let mut v = vec!["git", "-C", repo];
        v.extend_from_slice(args);
        output(&v)
    };
    match git(&["log", "--oneline", "-1"]) {
        Some(s) => u.current_commit = s.trim().to_string(),
        None => {
            u.error = "Cannot read local repo".into();
            return u;
        }
    }
    if git(&["fetch", "origin", branch]).is_none() {
        u.error = "No internet".into();
        return u;
    }
    match git(&["log", "--oneline", &format!("HEAD..origin/{branch}")]) {
        Some(log) => {
            let lines: Vec<String> = log.lines().map(|l| l.to_string()).collect();
            u.available = !lines.is_empty();
            u.commits = lines;
        }
        None => u.error = "Cannot compare branches".into(),
    }
    u
}

/// Fast-forward the checkout, then restart the unit that runs it.
///
/// The restart is detached into a transient unit for the same reason the reboot
/// is: systemd tearing this process down must not kill the command mid-flight.
pub fn update_apply(repo: &str, branch: &str, unit: &str) -> Result<(), String> {
    let out = Command::new("git")
        .args(["-C", repo, "pull", "--ff-only", "origin", branch])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(err.lines().next().unwrap_or("pull failed").to_string());
    }
    crate::net::spawn_detached(&[
        "systemd-run",
        "--collect",
        "--no-block",
        "sh",
        "-c",
        &format!("systemctl daemon-reload && systemctl restart {unit}"),
    ]);
    Ok(())
}

// ── Ethernet ───────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Iface {
    /// Kernel name, e.g. `end0` or `flipusb0`.
    pub name: String,
    /// True only with a carrier: an interface that is up but unplugged is not a
    /// connection, and the prototype's `isConnected` says the same.
    pub connected: bool,
    /// Negotiated link rate in Mbit/s, or None when down.
    pub speed: Option<i64>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub ipv4: Vec<String>,
    pub ipv6: Vec<String>,
    /// NetworkManager's `ipv4.method`: auto, manual, shared, link-local.
    pub method: String,
    pub gateway: String,
    pub dns: Vec<String>,
    pub mac: String,
    pub mtu: Option<i64>,
}

/// The interfaces the Ethernet page shows, in the prototype's own order.
///
/// `ETH_IFACES` there is a fixed list rather than a scan, because the page is
/// about the two physical ports and the USB gadget specifically: a scan would also
/// pull in wlan, the modem's wwan and any bridge, none of which belong on this
/// screen. Absent interfaces are skipped.
pub const ETH_IFACES: [&str; 3] = ["end0", "end1", "flipusb0"];

/// Display name, from `ifaceDisplayName`: `end0` reads as ETH0 and the USB gadget
/// as USB ETH, because "flipusb0" means nothing to a person holding the device.
pub fn iface_display_name(name: &str) -> String {
    if name.starts_with("flipusb") {
        return "USB ETH".into();
    }
    match name.strip_prefix("end") {
        Some(n) => format!("ETH{n}"),
        None => name.to_uppercase(),
    }
}


/// One nmcli call for every interface's addressing method.
///
/// `nmcli -t -f DEVICE,NAME connection show --active` pairs devices with
/// connection names, and the method is a per-connection setting, so this is two
/// calls total rather than two per interface.
fn ipv4_methods() -> Vec<(String, String)> {
    let Some(active) = output(&[
        "nmcli", "-t", "-f", "DEVICE,NAME", "connection", "show", "--active",
    ]) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in active.lines() {
        let Some((dev, conn)) = line.split_once(':') else {
            continue;
        };
        if dev.is_empty() || dev == "lo" {
            continue;
        }
        let method = output(&[
            "nmcli", "-t", "-f", "ipv4.method", "connection", "show", conn,
        ])
        .and_then(|s| {
            s.lines()
                .next()
                .and_then(|l| l.split_once(':'))
                .map(|(_, v)| v.trim().to_string())
        })
        .unwrap_or_default();
        out.push((dev.to_string(), method));
    }
    out
}

/// Addresses, gateways and resolvers for one interface, from
/// `nmcli -t device show <name>`.
///
/// This has to come from NetworkManager rather than the system: on a
/// systemd-resolved host /etc/resolv.conf names the local stub (127.0.0.53), not
/// the servers actually in use, so reading it reports the wrong DNS. NM knows the
/// real ones per interface, which is why the prototype asks it.
///
/// Returns (state, ipv4, ipv6, gateway4, dns). Addresses arrive with a prefix
/// length attached and are stripped, as `stripCidr` does.
fn nmcli_device(name: &str) -> Option<(String, Vec<String>, Vec<String>, String, Vec<String>)> {
    let text = output(&["nmcli", "-t", "device", "show", name])?;
    let mut state = String::new();
    let (mut v4, mut v6, mut dns) = (Vec::new(), Vec::new(), Vec::new());
    let mut gw4 = String::new();
    for line in text.lines() {
        // A value may itself contain a colon (an IPv6 address does), so split once
        // and keep the rest.
        let Some((key, val)) = line.split_once(':') else {
            continue;
        };
        let val = val.trim();
        if val.is_empty() {
            continue;
        }
        let bare = || val.split('/').next().unwrap_or(val).to_string();
        match key {
            "GENERAL.STATE" => state = val.to_string(),
            "IP4.GATEWAY" => gw4 = bare(),
            k if k.starts_with("IP4.ADDRESS") => v4.push(bare()),
            k if k.starts_with("IP6.ADDRESS") => v6.push(bare()),
            k if k.starts_with("IP4.DNS") || k.starts_with("IP6.DNS") => dns.push(val.to_string()),
            _ => {}
        }
    }
    Some((state, v4, v6, gw4, dns))
}

pub fn ethernet() -> Vec<Iface> {
    let methods = ipv4_methods();
    let mut out = Vec::new();
    for name in ETH_IFACES {
        let dir = format!("/sys/class/net/{name}");
        if !Path::new(&dir).exists() {
            continue;
        }
        // carrier is 1 only with a live link. operstate alone says "up" for a
        // configured-but-unplugged port.
        let connected = read_i64(format!("{dir}/carrier")) == Some(1);
        let (_, mut ipv4, mut ipv6, gateway, dns) =
            nmcli_device(name).unwrap_or_default();
        // NetworkManager leaves an unmanaged interface out, which is the normal
        // state for the USB gadget, so fall back to asking the kernel directly.
        if ipv4.is_empty() {
            ipv4 = crate::status::ipv4_all(name);
        }
        if ipv6.is_empty() {
            ipv6 = crate::status::ipv6_all(name);
        }
        out.push(Iface {
            connected,
            speed: connected.then(|| read_i64(format!("{dir}/speed"))).flatten(),
            rx_bytes: read_i64(format!("{dir}/statistics/rx_bytes")).unwrap_or(0) as u64,
            tx_bytes: read_i64(format!("{dir}/statistics/tx_bytes")).unwrap_or(0) as u64,
            ipv4,
            ipv6,
            method: methods
                .iter()
                .find(|(dev, _)| dev == name)
                .map(|(_, m)| m.clone())
                .unwrap_or_default(),
            gateway,
            dns,
            mac: read_str(format!("{dir}/address")).unwrap_or_default(),
            mtu: read_i64(format!("{dir}/mtu")),
            name: name.to_string(),
        });
    }
    out
}

/// A byte count as the prototype's `formatBytes`: three significant figures, with
/// the decimals dropped once the number is big enough not to need them.
pub fn format_bytes(n: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut num = n as f64;
    let mut u = 0;
    while num >= 1024.0 && u < UNITS.len() - 1 {
        num /= 1024.0;
        u += 1;
    }
    let s = if num >= 100.0 || u == 0 {
        format!("{num:.0}")
    } else if num >= 10.0 {
        format!("{num:.1}")
    } else {
        format!("{num:.2}")
    };
    format!("{s} {}", UNITS[u])
}

/// A link rate as `formatSpeed`: megabits until it reaches a gigabit.
pub fn format_speed(mbps: Option<i64>) -> String {
    let Some(mb) = mbps.filter(|v| *v > 0) else {
        return String::new();
    };
    if mb >= 1000 {
        let gb = mb as f64 / 1000.0;
        if gb.fract() == 0.0 {
            format!("{gb:.0}Gb/s")
        } else {
            format!("{gb:.1}Gb/s")
        }
    } else {
        format!("{mb}Mb/s")
    }
}

/// NetworkManager's method name as the page labels it, from `formatDhcp`.
pub fn format_method(method: &str) -> String {
    match method {
        "auto" => "DHCP Client".into(),
        "manual" => "Static".into(),
        "shared" => "DHCP Server".into(),
        "link-local" => "Link-local".into(),
        "disabled" | "" => String::new(),
        other => other.into(),
    }
}
