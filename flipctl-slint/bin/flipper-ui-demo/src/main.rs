//! Walks the flipper-ui component set on the panel, or headlessly to a PNG.
//!
//! Modes:
//!   --panel        DRM/KMS + evdev on the device (needs the `device` feature)
//!   --png <path>   render one frame and exit (needs the `slint` feature)
//!
//! On the panel: up and down move the selection, ok flashes the press state,
//! back or esc exits.

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let has = |flag: &str| args.iter().any(|a| a == flag);
    let value = |flag: &str| {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };

    if has("--help") || args.is_empty() {
        eprintln!("{}", USAGE);
        return ExitCode::SUCCESS;
    }

    let result = if has("--panel") || has("--headless") {
        let frames = value("--frames").and_then(|v| v.parse::<u64>().ok());
        panel(
            value("--kms-device").as_deref(),
            frames,
            has("--auto") || has("--bench"),
            has("--bench"),
            value("--remote"),
            value("--assets"),
            has("--headless"),
            value("--peer"),
        )
    } else if let Some(path) = value("--png") {
        png(
            &path,
            value("--press").and_then(|v| v.parse::<i32>().ok()),
            value("--screen"),
            value("--select").and_then(|v| v.parse::<i32>().ok()),
            has("--modal"),
        )
    } else {
        eprintln!("{}", USAGE);
        return ExitCode::FAILURE;
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("flipper-ui-demo: {e}");
            ExitCode::FAILURE
        }
    }
}

/// The app list and an app form supply their own soft labels; the list has none.
#[cfg(feature = "slint")]
const EMPTY_HINTS: [String; 0] = [];

const USAGE: &str = "\
usage: flipper-ui-demo [--panel [--kms-device PATH]] [--png PATH]

  --panel        drive the real 256x144 SPI panel and its buttons
  --kms-device   override device autodetection (default: probe /dev/dri/card*
                 for the flipper_one_display driver)
  --frames N     exit after N committed frames, reporting timings
  --auto         advance the selection on a timer, so frames are produced
                 without anyone pressing a button
  --bench        redraw as fast as the panel accepts, to measure the ceiling
  --remote ADDR  also serve the browser view, e.g. 0.0.0.0:8080
  --headless     serve the browser view only: no KMS, no buttons. Lets cog keep
                 the panel, so the prototype and this can be compared live
  --peer H:P     a host:port running the fake-flipctl2 prototype; / then serves
                 the side-by-side comparison and /device the photo view
  --assets DIR   where device.png lives (default: crates/flipper-ui/assets/remote)
  --png PATH     render one frame headlessly and write an 8-bit greyscale PNG
  --screen NAME  with --png, render a menu level: main, network or settings
  --select N     with --screen, which row is selected
  --modal        with --png, draw the airplane-block dialog over the screen
  --press SLOT   with --png, draw soft slot SLOT in its pressed state. The real
                 flash is 30ms, too brief to catch over the remote view";

#[cfg(feature = "slint")]
mod demo {
    use flipper_ui::ui::{ListItem, Root};

    pub fn labels(list: &[&str]) -> slint::ModelRc<slint::SharedString> {
        slint::ModelRc::new(slint::VecModel::from(
            list.iter()
                .map(|s| slint::SharedString::from(*s))
                .collect::<Vec<_>>(),
        ))
    }

    /// The one window, holding both screens. Idle is the root: `view` opens the
    /// menu and `back` returns.
    pub fn build() -> Root {
        let screen = Root::new().expect("create Root");
        apply_menu(&screen, &MAIN, &flipper_ui::net::Net::default());
        screen.set_real_frame(true);
        screen.set_idle_hints(labels(&IDLE_LABELS));
        screen.set_menu_hints(labels(&SOFT_LABELS));
        screen
    }

    /// Split a status string into a chevron layout and the value inside it.
    ///
    /// The prototype decides this by matching the status string at draw time, so a
    /// row becomes adjustable purely by saying so in its status. That is a good
    /// contract to keep, because it means an app can ask for the control over the
    /// text protocol without any new field. The matching happens here rather than
    /// in Slint, which has no string predicates.
    ///
    /// Returns (0, status) for a plain status, (1, "ON"/"OFF") for the toggle whose
    /// chevrons hold still, and (2, inner) for any other bracketed value.
    pub fn chevrons_of(status: &str) -> (i32, String) {
        if status == "< ON >" || status == "< OFF >" {
            return (1, status.trim_matches(['<', '>', ' ']).to_string());
        }
        let inner = status
            .strip_prefix('<')
            .and_then(|s| s.strip_suffix('>'))
            .map(str::trim)
            .filter(|s| !s.is_empty());
        match inner {
            Some(v) => (2, v.to_string()),
            None => (0, status.to_string()),
        }
    }

    /// The breadcrumb for a screen opened from a menu stack, e.g.
    /// "> Settings > Battery info".
    ///
    /// SubMenuScene derives its trail from the scene stack rather than storing it,
    /// so a nested screen shows the whole path it was reached by.
    pub fn crumb(stack: &[(&'static Menu, i32, i32)], leaf: &str) -> String {
        let mut parts: Vec<&str> = stack
            .iter()
            .map(|(m, _, _)| m.title)
            .filter(|t| !t.is_empty())
            .collect();
        parts.push(leaf);
        format!("> {}", parts.join(" > "))
    }

    /// Put a menu level on the screen: its rows, its live statuses and its
    /// breadcrumb. Called on every navigation and whenever the radio state moves,
    /// since a status provider reads that.
    pub fn apply_menu(screen: &Root, menu: &'static Menu, net: &flipper_ui::net::Net) {
        let items: Vec<ListItem> = menu
            .rows
            .iter()
            .map(|r| {
                let status = row_status(&r.stat, net);
                let (chevrons, value) = chevrons_of(&status);
                ListItem {
                    label: r.label.into(),
                    status: status.as_str().into(),
                    icon: r.icon,
                    frames: r.frames,
                    chevrons,
                    value: value.as_str().into(),
                    at_start: false,
                    at_end: false,
                }
            })
            .collect();
        screen.set_total(items.len() as i32);
        screen.set_items(slint::ModelRc::new(slint::VecModel::from(items)));
        // The main menu's title is empty, which is also how MenuBody knows to use
        // the higher container anchor and draw no trail.
        screen.set_breadcrumb(
            if menu.title.is_empty() {
                String::new()
            } else {
                format!("> {}", menu.title)
            }
            .as_str()
            .into(),
        );
    }

    /// The idle screen's soft keys. desktop.js puts "Menu" in slot 1, whose key is
    /// `view`, and the boot target's shortcut on the right in slot 4, `run`.
    pub const IDLE_LABELS: [&str; 5] = ["", "Menu", "", "", "Desktop"];

    /// What activating a row does.
    ///
    /// The prototype expresses this as a factory function per row that returns a
    /// scene, plus `onToggle` for rows that flip a value instead. The set of
    /// things a factory can do is small and closed, so here it is an enum: a
    /// closure returning `Box<dyn Scene>` would buy nothing while there is no
    /// scene stack to put the result on.
    pub enum Act {
        /// Push a submenu.
        Sub(&'static Menu),
        /// Flip airplane mode. Responds to left, right and ok alike, because the
        /// prototype routes all three into `onToggle`.
        Airplane,
        /// The app list, which this binary discovers at startup rather than
        /// declaring in the table.
        Apps,
        /// Reboot. menu.js POSTs /api/system/reboot and pushes no scene.
        Reboot,
        /// Open one of the detail screens.
        Detail(Detail),
        /// A scene the prototype has and this port does not. Named so the dialog
        /// can say which one, rather than the row silently doing nothing.
        Unported,
        /// The prototype has no factory for this row either, so pressing it is a
        /// no-op there too. Kept distinct from `Unported`: nothing is missing.
        Nothing,
    }

    /// Which detail screen a row opens.
    ///
    /// Each one owns a background poller at the prototype's own cadence and a row
    /// builder that mirrors what its scene draws.
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub enum Detail {
        Ethernet,
        Routing,
        Disk,
        Battery,
        Modem,
        Update,
    }

    impl Detail {
        /// The breadcrumb crumb, which is also the screen's name.
        pub fn title(self) -> &'static str {
            match self {
                Detail::Ethernet => "Ethernet",
                Detail::Routing => "Routing info",
                Detail::Disk => "Disk info",
                Detail::Battery => "Battery info",
                Detail::Modem => "5G Modem",
                Detail::Update => "Update",
            }
        }
    }

    /// Where a row's status text comes from.
    ///
    /// The prototype attaches a `statusProvider` closure that runs every frame.
    /// These are the three it actually uses, named so the value can be computed
    /// from live state at apply time.
    pub enum Stat {
        None,
        /// `< ON >` / `< OFF >`, which MenuLine renders with chevrons.
        Airplane,
        /// OFF when the radio is off, else the SSID, else "not connected".
        Wifi,
        /// "Airplane mode" while that is what blocks the row.
        ModemBlocked,
    }

    pub struct Row {
        pub label: &'static str,
        /// Index into the icon table in list.slint. 0 draws no icon.
        pub icon: i32,
        /// Frames in the icon's strip, 1 for a static icon.
        pub frames: i32,
        pub stat: Stat,
        pub act: Act,
    }

    pub struct Menu {
        /// The breadcrumb crumb for this level. Empty for the main menu, which
        /// draws no trail and sits 3px higher because of it.
        pub title: &'static str,
        pub rows: &'static [Row],
    }

    /// The Network submenu, copied from menu.js `networkMenu`.
    ///
    /// Row order, icons and status providers are all as they are there. Airplane
    /// mode leads because it gates the two rows below it.
    pub static NETWORK: Menu = Menu {
        title: "Network",
        rows: &[
            Row { label: "Airplane mode", icon: 9, frames: 10, stat: Stat::Airplane, act: Act::Airplane },
            Row { label: "Routing info", icon: 10, frames: 1, stat: Stat::None, act: Act::Detail(Detail::Routing) },
            Row { label: "5G Modem", icon: 11, frames: 1, stat: Stat::ModemBlocked, act: Act::Detail(Detail::Modem) },
            Row { label: "Wi-Fi", icon: 12, frames: 1, stat: Stat::Wifi, act: Act::Unported },
            Row { label: "Ethernet", icon: 13, frames: 1, stat: Stat::None, act: Act::Detail(Detail::Ethernet) },
        ],
    };

    /// The Settings submenu, copied from menu.js `settingsMenu`.
    ///
    /// No icons: unlike `networkMenu`, that function sets no icon map, so every
    /// row here is label-only and the label starts where the icon would end.
    /// "System info" has no factory in the prototype either.
    pub static SETTINGS: Menu = Menu {
        title: "Settings",
        rows: &[
            Row { label: "System info", icon: 0, frames: 1, stat: Stat::None, act: Act::Nothing },
            Row { label: "Battery info", icon: 0, frames: 1, stat: Stat::None, act: Act::Detail(Detail::Battery) },
            Row { label: "Disk info", icon: 0, frames: 1, stat: Stat::None, act: Act::Detail(Detail::Disk) },
            Row { label: "Update", icon: 0, frames: 1, stat: Stat::None, act: Act::Detail(Detail::Update) },
            Row { label: "Reboot", icon: 0, frames: 1, stat: Stat::None, act: Act::Reboot },
        ],
    };

    /// The main menu, copied from fake-flipctl2's `menuItems` and its icon maps.
    ///
    /// Slot 0 is the active boot target's app, which is Desktop Computer on a
    /// desktop profile and TV Media Box on that target. Four rows have no static
    /// icon and fall back to frame 0 of their animated strip while unselected,
    /// which is exactly the look the prototype wants.
    ///
    /// No row carries status text: menu.js builds every MenuLine with just a
    /// label, an icon and the active-label nudge. Submenus use the status column;
    /// the main menu does not.
    ///
    /// Files, Router, Boot Menu, Testing and the two target apps have scenes in
    /// the prototype that this port has not taken yet.
    pub static MAIN: Menu = Menu {
        title: "",
        rows: &[
            Row { label: "Desktop Computer", icon: 1, frames: 1, stat: Stat::None, act: Act::Unported },
            Row { label: "Boot Menu", icon: 2, frames: 1, stat: Stat::None, act: Act::Unported },
            Row { label: "Apps", icon: 3, frames: 9, stat: Stat::None, act: Act::Apps },
            Row { label: "Files", icon: 4, frames: 10, stat: Stat::None, act: Act::Nothing },
            Row { label: "Network", icon: 5, frames: 10, stat: Stat::None, act: Act::Sub(&NETWORK) },
            Row { label: "Testing", icon: 6, frames: 9, stat: Stat::None, act: Act::Unported },
            Row { label: "Settings", icon: 7, frames: 10, stat: Stat::None, act: Act::Sub(&SETTINGS) },
        ],
    };

    /// The status string for a row, given the current radio state.
    ///
    /// Transcribed from the three `statusProvider` closures in networkMenu.
    pub fn row_status(stat: &Stat, net: &flipper_ui::net::Net) -> String {
        match stat {
            Stat::None => String::new(),
            // MenuLine keys its chevron layout off this exact string.
            Stat::Airplane => if net.airplane { "< ON >" } else { "< OFF >" }.into(),
            Stat::Wifi => {
                if !net.wifi_enabled {
                    "OFF".into()
                } else if !net.wifi_connected {
                    "not connected".into()
                } else if net.ssid.is_empty() {
                    "connected".into()
                } else {
                    net.ssid.clone()
                }
            }
            Stat::ModemBlocked => if net.airplane { "Airplane mode" } else { "" }.into(),
        }
    }

    /// Bottom-bar labels, one per physical soft key, in silkscreen order.
    ///
    /// Index i labels `FlipperKey::SOFT_ROW[i]`, so a label and the key beneath it
    /// are declared once and cannot drift apart. An empty string draws no button.
    ///
    /// The main menu shows none, matching the prototype: its MenuScene has no
    /// button bar at all, and only its power-off modal puts anything there.
    pub const SOFT_LABELS: [&str; 5] = ["", "", "", "", ""];
}

/// The five detail screens: their pollers and their row builders.
///
/// Each screen owns a `Watch` at the cadence its prototype scene uses, so opening
/// a screen starts polling and leaving it stops. The row builders mirror what the
/// scenes draw, in the same order, restyled onto label/value rows.
#[cfg(feature = "slint")]
mod detail {
    use std::time::Duration;

    use flipper_ui::sysinfo::{self, Battery, Disk, Modem, Route, UpdateStatus};
    use flipper_ui::ui::DetailRow;
    use flipper_ui::watch::Watch;

    use super::demo::Detail;

    /// The SD card. The partition is chosen by size, not hardcoded: see
    /// `one_disk`.
    const SD_DISK: &str = "/dev/mmcblk0";
    /// QMI control device for the cell-identity calls.
    const QMI_DEV: &str = "/dev/cdc-wdm0";
    /// The checkout the Update screen compares, and the unit to restart after.
    ///
    /// Overridable because the deployed tree is copied with tar, not cloned, so by
    /// default it is not a git repository at all and the screen reports the
    /// prototype's own "Cannot read local repo". Pointing these at a real checkout
    /// makes the screen work without a rebuild.
    fn update_repo() -> String {
        std::env::var("FLIPPER_UPDATE_REPO").unwrap_or_else(|_| "/home/user/flipctl-slint".into())
    }
    fn update_branch() -> String {
        std::env::var("FLIPPER_UPDATE_BRANCH").unwrap_or_else(|_| "dev".into())
    }
    fn update_unit() -> String {
        std::env::var("FLIPPER_UPDATE_UNIT").unwrap_or_else(|_| "flipper-ui-demo.service".into())
    }

    fn row(label: &str, value: &str) -> DetailRow {
        DetailRow {
            kind: 0,
            label: label.into(),
            value: value.into(),
            percent: 0,
            dim: false,
        }
    }

    /// A secondary row, in the dim tone.
    fn dim(label: &str, value: &str) -> DetailRow {
        DetailRow { dim: true, ..row(label, value) }
    }

    fn divider() -> DetailRow {
        DetailRow { kind: 1, ..row("", "") }
    }

    fn gauge(label: &str, percent: i32) -> DetailRow {
        DetailRow {
            kind: 2,
            percent: percent.clamp(0, 100),
            ..row(label, "")
        }
    }

    /// A full-width line with no value column.
    fn text(label: &str) -> DetailRow {
        DetailRow { kind: 3, ..row(label, "") }
    }

    /// The two disks the Disk info screen shows.
    ///
    /// The prototype shows only the SD card. The UFS is where the system actually
    /// lives, so it is the one a person is more likely to be asking about.
    #[derive(Clone, Default, PartialEq)]
    pub struct Disks {
        pub ufs: Disk,
        pub sd: Disk,
    }

    /// Read both, discovering the devices rather than hardcoding them: the root
    /// filesystem's own mount point for the UFS, and the card's largest partition
    /// for the SD.
    fn read_disks() -> Disks {
        let sd = sysinfo::largest_partition(SD_DISK)
            .map(|part| sysinfo::disk(&part))
            .unwrap_or_default();
        Disks {
            ufs: sysinfo::disk_at("/"),
            sd,
        }
    }

    /// Whichever screen is open, with its poller.
    ///
    /// One variant per screen rather than one struct with five options: only one
    /// screen is ever open, and dropping this stops exactly one thread.
    pub enum Live {
        Ethernet(Watch<Vec<flipper_ui::sysinfo::Iface>>),
        Routing(Watch<Vec<Route>>),
        Disk(Watch<Disks>),
        Battery(Watch<Battery>),
        Modem(Watch<Modem>),
        Update(Watch<UpdateStatus>),
    }

    /// Progress of an update the user started. Separate from the poller, which
    /// only ever checks.
    #[derive(Clone, PartialEq, Eq)]
    pub enum Applying {
        No,
        Running,
        Done,
        Failed(String),
    }

    impl Live {
        /// Start the poller for `which` at its prototype's cadence.
        pub fn open(which: Detail) -> Self {
            match which {
                // ethernet.js polls every two seconds.
                Detail::Ethernet => Live::Ethernet(Watch::spawn(
                    "watch-ethernet",
                    Duration::from_secs(2),
                    Vec::new(),
                    flipper_ui::sysinfo::ethernet,
                )),
                // routing.js polls every second.
                Detail::Routing => Live::Routing(Watch::spawn(
                    "watch-routing",
                    Duration::from_secs(1),
                    Vec::new(),
                    sysinfo::routes,
                )),
                // diskspace.js fetches once on enter; a slow re-read costs nothing
                // and picks up a card inserted while the screen is open.
                Detail::Disk => Live::Disk(Watch::spawn(
                    "watch-disk",
                    Duration::from_secs(5),
                    Disks::default(),
                    read_disks,
                )),
                // power.js polls every two seconds.
                Detail::Battery => Live::Battery(Watch::spawn(
                    "watch-battery",
                    Duration::from_secs(2),
                    Battery::default(),
                    sysinfo::battery,
                )),
                // modem5g.js polls every 500ms. Four subprocesses at 2Hz is what
                // the prototype does; the thread absorbs it.
                Detail::Modem => Live::Modem(Watch::spawn(
                    "watch-modem",
                    Duration::from_millis(500),
                    Modem::default(),
                    || sysinfo::modem(QMI_DEV),
                )),
                // update.js checks once on enter. A `git fetch` is not something to
                // repeat on a timer, so the interval is long enough to mean "once".
                Detail::Update => Live::Update(Watch::spawn(
                    "watch-update",
                    Duration::from_secs(3600),
                    UpdateStatus::default(),
                    || sysinfo::update_check(&update_repo(), &update_branch()),
                )),
            }
        }

        pub fn take_dirty(&self) -> bool {
            match self {
                Live::Ethernet(w) => w.take_dirty(),
                Live::Routing(w) => w.take_dirty(),
                Live::Disk(w) => w.take_dirty(),
                Live::Battery(w) => w.take_dirty(),
                Live::Modem(w) => w.take_dirty(),
                Live::Update(w) => w.take_dirty(),
            }
        }

        /// The screen's rows, newest data.
        pub fn rows(&self, applying: &Applying) -> Vec<DetailRow> {
            match self {
                // The Ethernet page draws cards, not rows.
                Live::Ethernet(_) => Vec::new(),
                Live::Routing(w) => routing_rows(&w.get()),
                Live::Disk(w) => disk_rows(&w.get()),
                Live::Battery(w) => battery_rows(&w.get()),
                Live::Modem(w) => modem_rows(&w.get()),
                Live::Update(w) => update_rows(&w.get(), applying),
            }
        }

        /// Soft-key labels. Only Update has a second action.
        pub fn hints(&self, applying: &Applying) -> [&'static str; 5] {
            match self {
                Live::Update(w) => {
                    let u = w.get();
                    if *applying == Applying::No && u.available {
                        ["Back", "", "", "", "Update"]
                    } else {
                        ["Back", "", "", "", ""]
                    }
                }
                _ => ["Back", "", "", "", ""],
            }
        }

        /// Start the update, on its own thread: `git pull` takes seconds.
        pub fn start_update(&self) -> Option<std::sync::mpsc::Receiver<Result<(), String>>> {
            let Live::Update(_) = self else { return None };
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::Builder::new()
                .name("update-apply".into())
                .spawn(move || {
                    let _ = tx.send(sysinfo::update_apply(
                        &update_repo(),
                        &update_branch(),
                        &update_unit(),
                    ));
                })
                .ok()?;
            Some(rx)
        }
    }

    /// routing.js: a "Default gateways:" heading, then one line per route.
    fn routing_rows(routes: &[Route]) -> Vec<DetailRow> {
        let mut out = vec![text("Default gateways:")];
        if routes.is_empty() {
            out.push(dim("No default routes", ""));
            return out;
        }
        for r in routes {
            out.push(row(&format!("{} via {}", r.family, r.dev), &r.gateway));
            if let Some(m) = r.metric {
                out.push(dim("metric", &m.to_string()));
            }
        }
        out
    }

    /// One disk: a used/total line, then its bar.
    ///
    /// Two divergences from diskspace.js, both because it runs `df -k <device>`
    /// and reads the second output line whatever it is. With no card mounted that
    /// line is the first filesystem df happens to list, so it reports udev as the
    /// SD card; and its hardcoded `/dev/mmcblk0p2` is the 4MB metadata partition
    /// on this board rather than the 29.7GB data one. Reading statvfs on the
    /// mount point, and picking the card's partition by size, fixes both.
    fn one_disk(label: &str, d: &Disk) -> Vec<DetailRow> {
        if !d.mounted {
            return vec![row(label, "Not mounted")];
        }
        let pct = if d.total_gb > 0.0 {
            (d.used_gb / d.total_gb * 100.0).round() as i32
        } else {
            0
        };
        vec![
            row(label, &format!("{:.1}/{:.1} GB", d.used_gb, d.total_gb)),
            gauge(&format!("{pct}%"), pct),
        ]
    }

    /// Both disks: the UFS the system runs from, then the SD card.
    fn disk_rows(d: &Disks) -> Vec<DetailRow> {
        let mut out = one_disk("UFS", &d.ufs);
        out.push(divider());
        out.extend(one_disk("SD Card", &d.sd));
        out
    }

    /// power.js: status and time left, the capacity bar, then the electricals.
    fn battery_rows(b: &Battery) -> Vec<DetailRow> {
        if !b.available {
            return vec![row("Battery", "Not found")];
        }
        let charging = b.status == "Charging";
        let full = b.status == "Full";
        // The prototype shows time-to-full while charging and time-to-empty while
        // discharging, and nothing at all when full.
        let left = if charging {
            b.time_to_full
        } else if full {
            None
        } else {
            b.time_to_empty
        };
        let time = match left {
            Some(_) => format!("{} left", sysinfo::fmt_time(left)),
            None => String::new(),
        };
        let cap = b.capacity.unwrap_or(0);

        let mut out = vec![row(&b.status, &time), gauge(&format!("{cap}%"), cap), divider()];
        out.push(row(
            "Charge",
            &match (b.charge_now, b.charge_full) {
                (Some(n), Some(f)) => format!("{n:.3}/{f:.3} Ah"),
                _ => "--".into(),
            },
        ));
        out.push(row(
            "Voltage",
            &b.voltage.map_or("--".into(), |v| format!("{v:.3} V")),
        ));
        out.push(row(
            "Current",
            &b.current.map_or("--".into(), |v| format!("{v:.3} A")),
        ));
        out.push(row(
            "Power",
            &b.power.map_or("-- W".into(), |v| format!("{v:.3} W")),
        ));
        if let Some(t) = b.temp {
            // sysfs reports tenths of a degree.
            out.push(row("Temp", &format!("{:.1} C", t as f32 / 10.0)));
        }
        out
    }

    /// modem5g.js, in its own row order: identity, signal, cell, then the link.
    fn modem_rows(m: &Modem) -> Vec<DetailRow> {
        if !m.available {
            return vec![row("Modem", "Not available")];
        }
        let dash = |s: &str| if s.is_empty() { "--".to_string() } else { s.to_string() };
        // techLabel in the prototype uppercases whatever ModemManager reports.
        let tech = if m.access_tech.is_empty() {
            "--".to_string()
        } else {
            m.access_tech.join("/").to_uppercase()
        };
        let mut out = vec![
            row(&dash(&m.operator), &tech),
            row(
                "Signal",
                &format!(
                    "{} ({}/5)",
                    m.signal_quality.map_or("--%".into(), |q| format!("{q}%")),
                    sysinfo::signal_bars(m.signal_quality)
                ),
            ),
        ];
        if !m.rsrp.is_empty() {
            out.push(dim("RSRP", &m.rsrp));
        }
        out.push(divider());
        out.push(row("TAC", &dash(&m.tac)));
        out.push(row("Cell ID", &dash(&m.cell_id)));
        out.push(row(
            "PLMN",
            &if m.mcc.is_empty() || m.mnc.is_empty() {
                "--".into()
            } else {
                format!("{}/{}", m.mcc, m.mnc)
            },
        ));
        out.push(row("PCI", &dash(&m.pci)));
        if !m.band.is_empty() {
            out.push(dim("Band", &m.band));
        } else if !m.earfcn.is_empty() {
            out.push(dim("EARFCN", &m.earfcn));
        }
        out.push(divider());
        out.push(row("Model", &dash(&m.model)));
        out.push(row("IP", &dash(&m.ip4)));
        out.push(row(
            "Link",
            &match m.dl_mbps {
                Some(v) => format!("{v:.0} Mbit/s"),
                None => "--".into(),
            },
        ));
        out
    }

    /// The Ethernet page's cards, formatted the way the prototype's tab expects
    /// them: already-rendered strings, so the component does no arithmetic.
    pub fn eth_links(ifaces: &[flipper_ui::sysinfo::Iface]) -> Vec<flipper_ui::ui::EthLink> {
        ifaces
            .iter()
            .map(|i| flipper_ui::ui::EthLink {
                name: sysinfo::iface_display_name(&i.name).as_str().into(),
                connected: i.connected,
                ipv4: i.ipv4.first().map_or("", |s| s.as_str()).into(),
                ipv6: i.ipv6.first().map_or("", |s| s.as_str()).into(),
                speed: sysinfo::format_speed(i.speed).as_str().into(),
                rx: if i.connected { sysinfo::format_bytes(i.rx_bytes) } else { String::new() }
                    .as_str()
                    .into(),
                tx: if i.connected { sysinfo::format_bytes(i.tx_bytes) } else { String::new() }
                    .as_str()
                    .into(),
                method: sysinfo::format_method(&i.method).as_str().into(),
            })
            .collect()
    }

    /// One row of the dump. Kinds are documented on EthDetailRow.
    fn drow(kind: i32, label: &str, value: &str) -> flipper_ui::ui::EthDetailRow {
        flipper_ui::ui::EthDetailRow {
            kind,
            top: 0.0,
            label: label.into(),
            value: value.into(),
            speed: "".into(),
            rx: "".into(),
            tx: "".into(),
        }
    }

    /// A section: written inline when it has one entry, as a header plus indented
    /// entries when it has more. The single-entry case is the common one for an
    /// address, and inlining it avoids a tabulation break for nothing.
    fn push_list(out: &mut Vec<flipper_ui::ui::EthDetailRow>, label: &str, items: &[String]) {
        match items {
            [] => {}
            [only] => out.push(drow(2, label, only)),
            many => {
                out.push(drow(3, label, ""));
                out.extend(many.iter().map(|item| drow(4, "", item)));
            }
        }
    }

    /// The verbose dump for one interface, from `buildDetailRows`.
    ///
    /// Section order is the prototype's: identity, link stats, addressing method,
    /// IPv4, IPv6, DNS, each behind a rule and each omitted when it has nothing to
    /// say.
    ///
    /// Returns the rows with their own y already filled in, and the total height:
    /// the renderer cannot accumulate across a loop, and the caller needs the total
    /// for the scroll limit anyway.
    pub fn eth_detail(iface: &sysinfo::Iface) -> (Vec<flipper_ui::ui::EthDetailRow>, f32) {
        use flipper_ui::theme::metric::{ETH_MODAL_DIVIDER_H, ETH_MODAL_LINE_H};

        let mut out = Vec::new();
        // The prototype cleans NetworkManager's state string; sysfs gives the plain
        // word already.
        let state = if iface.connected { "connected" } else { "disconnected" };
        out.push(drow(
            0,
            &format!("{}  {}", sysinfo::iface_display_name(&iface.name), state),
            "",
        ));

        let speed = sysinfo::format_speed(iface.speed);
        if !speed.is_empty() || iface.rx_bytes > 0 || iface.tx_bytes > 0 {
            out.push(drow(1, "", ""));
            out.push(flipper_ui::ui::EthDetailRow {
                speed: speed.as_str().into(),
                rx: sysinfo::format_bytes(iface.rx_bytes).as_str().into(),
                tx: sysinfo::format_bytes(iface.tx_bytes).as_str().into(),
                ..drow(5, "", "")
            });
        }

        let method = sysinfo::format_method(&iface.method);
        if !method.is_empty() {
            out.push(drow(1, "", ""));
            out.push(drow(2, "Method:", &method));
        }

        if !iface.ipv4.is_empty() || !iface.gateway.is_empty() {
            out.push(drow(1, "", ""));
            push_list(&mut out, "IPv4:", &iface.ipv4);
            if !iface.gateway.is_empty() {
                out.push(drow(2, "Gateway4:", &iface.gateway));
            }
        }
        if !iface.ipv6.is_empty() {
            out.push(drow(1, "", ""));
            push_list(&mut out, "IPv6:", &iface.ipv6);
        }
        if !iface.dns.is_empty() {
            out.push(drow(1, "", ""));
            push_list(&mut out, "DNS:", &iface.dns);
        }

        let mut top = 0.0f32;
        for row in &mut out {
            row.top = top;
            top += if row.kind == 1 {
                ETH_MODAL_DIVIDER_H as f32
            } else {
                ETH_MODAL_LINE_H as f32
            };
        }
        (out, top)
    }

    /// Cut `text` to the row width, ending in "..".
    ///
    /// update.js truncates at a fixed 42 characters because its font is fixed
    /// pitch at 6px. Busy9px is not, so a character count either overflows or
    /// wastes room; measuring against the real advance table is the only way to
    /// fill the row exactly. The budget is the row's own span, margin to margin.
    fn elide(text: &str) -> String {
        use flipper_ui::font::ROW;
        let budget = flipper_ui::theme::PANEL_W - 2 * flipper_ui::theme::metric::MARGIN_H as u16;
        if ROW.text_width(text) <= budget {
            return text.to_string();
        }
        let ellipsis = ROW.text_width("..");
        let mut out = String::new();
        for c in text.chars() {
            let mut probe = out.clone();
            probe.push(c);
            if ROW.text_width(&probe) + ellipsis > budget {
                break;
            }
            out = probe;
        }
        out.push_str("..");
        out
    }

    /// update.js, whose seven states this reproduces one for one.
    fn update_rows(u: &UpdateStatus, applying: &Applying) -> Vec<DetailRow> {
        match applying {
            Applying::Running => {
                return vec![row("Updating...", ""), dim("Do not power off", "")]
            }
            Applying::Done => {
                return vec![row("Update complete", ""), dim("Restarting...", "")]
            }
            Applying::Failed(e) => return vec![row("Update failed", ""), dim(e, "")],
            Applying::No => {}
        }
        if !u.checked {
            return vec![dim("Checking for updates...", "")];
        }
        if !u.error.is_empty() {
            return vec![row("Error", &u.error), dim(&elide(&u.current_commit), "")];
        }
        if !u.available {
            return vec![
                row("No updates available", ""),
                dim(&elide(&u.current_commit), ""),
            ];
        }
        let mut out = vec![row(
            &format!(
                "{} new commit{}",
                u.commits.len(),
                if u.commits.len() == 1 { "" } else { "s" }
            ),
            "",
        )];
        for c in &u.commits {
            out.push(dim(&elide(c), ""));
        }
        out
    }
}

/// Show a list of apps, or an app's own form, on the shared list body.
#[cfg(feature = "slint")]
fn apply_app_list(
    screen: &flipper_ui::ui::Root,
    rows: &[(String, String)],
    selected: i32,
    hints: &[String],
    // Per row, whether its value is at the low or high end of its range, so the
    // matching chevron is suppressed. Empty when the caller has no ranges.
    ends: &[(bool, bool)],
    // Real extent of the app's buffer and where the sent rows sit in it, for the
    // scrollbar. Equal to the row count and zero when the caller sends everything.
    bar: (i32, i32),
    // First visible row. The app list owns every row so it scrolls here; an app's
    // own form windows its rows before sending them, so it passes 0.
    scroll: i32,
) {
    let items: Vec<flipper_ui::ui::ListItem> = rows
        .iter()
        .enumerate()
        .map(|(i, (label, value))| {
            // A value the app wrapped in chevrons asks for the adjust control, the
            // same way a menu row does.
            let (chevrons, inner) = demo::chevrons_of(value);
            let (at_start, at_end) = ends.get(i).copied().unwrap_or((false, false));
            flipper_ui::ui::ListItem {
                label: label.as_str().into(),
                status: value.as_str().into(),
                // Apps have no icons yet. The column stays reserved so a manifest
                // can name one later without the labels shifting.
                icon: 0,
                frames: 1,
                chevrons,
                value: inner.as_str().into(),
                at_start,
                at_end,
            }
        })
        .collect();
    screen.set_app_total(items.len() as i32);
    screen.set_app_bar_total(if bar.0 > 0 { bar.0 } else { items.len() as i32 });
    screen.set_app_bar_offset(bar.1);
    screen.set_app_scroll(scroll);
    screen.set_app_selected(selected);
    screen.set_app_items(slint::ModelRc::new(slint::VecModel::from(items)));
    screen.set_app_hints(slint::ModelRc::new(slint::VecModel::from(
        hints
            .iter()
            .map(|h| slint::SharedString::from(h.as_str()))
            .collect::<Vec<_>>(),
    )));
}

/// Copy the idle screen's own fields across.
#[cfg(feature = "slint")]
fn apply_idle(screen: &flipper_ui::ui::Root, idle: &flipper_ui::status::Idle) {
    const UNKNOWN: i32 = -32768;
    screen.set_battery_temp(idle.battery_temp.unwrap_or(UNKNOWN));
    screen.set_cpu_temp(idle.cpu_temp.unwrap_or(UNKNOWN));
    screen.set_power_mw(idle.power_mw.unwrap_or(UNKNOWN));
    screen.set_hostname(idle.hostname.as_str().into());
    screen.set_profile(idle.profile.as_str().into());
    screen.set_links(slint::ModelRc::new(slint::VecModel::from(
        idle.links
            .iter()
            .map(|l| flipper_ui::ui::IdleLink {
                name: l.name.as_str().into(),
                v4: l.v4.as_str().into(),
                v6: l.v6.as_str().into(),
            })
            .collect::<Vec<_>>(),
    )));
}

/// Copy a status reading into the screen's properties.
#[cfg(feature = "slint")]
fn apply_status(screen: &flipper_ui::ui::Root, s: flipper_ui::Status) {
    use flipper_ui::Ethernet;
    use slint::ComponentHandle;
    let _ = screen.as_weak();
    screen.set_battery(s.battery);
    screen.set_charging(s.charging);
    screen.set_wifi_connected(s.wifi_connected);
    screen.set_wifi_quality(s.wifi_quality);
    screen.set_ethernet(match s.ethernet {
        Ethernet::Down => 0,
        Ethernet::Real => 1,
        Ethernet::Usb => 2,
    });
    screen.set_modem_available(s.modem_available);
    screen.set_access_tech(s.access_tech.into());
    screen.set_modem_quality(s.modem_quality);
}

#[cfg(feature = "slint")]
fn png(
    path: &str,
    press: Option<i32>,
    which: Option<String>,
    select: Option<i32>,
    modal: bool,
) -> std::io::Result<()> {
    use std::time::Duration;

    use flipper_ui::slint_render::{render_frame, FlipperSlintPlatform};
    use flipper_ui::ui::Screen;
    use flipper_ui::{PANEL_H, PANEL_W};
    use slint::ComponentHandle;

    let window = FlipperSlintPlatform::install();
    // Root defaults to the idle screen, which is what a headless render shows.
    let screen = demo::build();
    screen.show().expect("show");
    let mut status = flipper_ui::StatusSource::new(Duration::from_millis(0));
    if let Some(now) = status.poll() {
        apply_status(&screen, now);
    }
    apply_idle(&screen, &flipper_ui::status::Idle::read_all());
    if let Some(slot) = press {
        screen.set_idle_pressed_slot(slot);
    }

    // Any menu level can be rendered on its own, which is the only way to check a
    // submenu's geometry without a device in front of you.
    if let Some(name) = which.as_deref() {
        let net = flipper_ui::net::NetSource::spawn().get();
        let menu = match name {
            "network" => &demo::NETWORK,
            "settings" => &demo::SETTINGS,
            _ => &demo::MAIN,
        };
        demo::apply_menu(&screen, menu, &net);
        screen.set_selected(select.unwrap_or(0));
        screen.set_screen(Screen::Menu);
    }
    // Any detail screen can be rendered on its own, with whatever the host it
    // runs on actually reports.
    if let Some(name) = which.as_deref() {
        let want = match name {
            "ethernet" => Some(demo::Detail::Ethernet),
            "routing" => Some(demo::Detail::Routing),
            "disk" => Some(demo::Detail::Disk),
            "battery" => Some(demo::Detail::Battery),
            "modem" => Some(demo::Detail::Modem),
            "update" => Some(demo::Detail::Update),
            _ => None,
        };
        if let Some(want) = want {
            let open = detail::Live::open(want);
            // The pollers are threads; give the first fetch a moment to land.
            std::thread::sleep(Duration::from_millis(1200));
            let applying = detail::Applying::No;
            // Ethernet draws cards on its own screen rather than rows.
            if let detail::Live::Ethernet(w) = &open {
                screen.set_eth_links(slint::ModelRc::new(slint::VecModel::from(
                    detail::eth_links(&w.get()),
                )));
                screen.set_eth_selected(select.unwrap_or(0));
                screen.set_breadcrumb("> Network > Ethernet".into());
                screen.set_screen(Screen::Ethernet);
            }
            let rows = open.rows(&applying);
            screen.set_detail_rows(slint::ModelRc::new(slint::VecModel::from(rows)));
            screen.set_detail_offset(select.unwrap_or(0));
            screen.set_detail_hints(demo::labels(&open.hints(&applying)));
            // Routing info and 5G Modem live under Network, the rest under
            // Settings, which is what the real breadcrumb derives from the stack.
            let parent = match want {
                demo::Detail::Routing | demo::Detail::Modem | demo::Detail::Ethernet => "Network",
                _ => "Settings",
            };
            if !matches!(open, detail::Live::Ethernet(_)) {
                screen.set_breadcrumb(format!("> {parent} > {}", want.title()).as_str().into());
                screen.set_screen(Screen::Detail);
            }
        }
    }
    if modal {
        screen.set_modal_lines(slint::ModelRc::new(slint::VecModel::from(vec![
            slint::SharedString::from("To use 5G Modem you need"),
            slint::SharedString::from("to turn off Airplane mode"),
        ])));
        screen.set_modal_left("Cancel".into());
        screen.set_modal_right("Turn off".into());
    }
    slint::platform::update_timers_and_animations();

    let frame = render_frame(&window).expect("the first frame always paints");
    let bytes: Vec<u8> = frame.iter().map(|p| p.0).collect();

    let file = std::fs::File::create(path)?;
    let mut encoder = png::Encoder::new(
        std::io::BufWriter::new(file),
        u32::from(PANEL_W),
        u32::from(PANEL_H),
    );
    encoder.set_color(png::ColorType::Grayscale);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .map_err(std::io::Error::other)?
        .write_image_data(&bytes)
        .map_err(std::io::Error::other)?;

    eprintln!("wrote {path}");
    Ok(())
}

#[cfg(not(feature = "slint"))]
fn png(
    _path: &str,
    _press: Option<i32>,
    _which: Option<String>,
    _select: Option<i32>,
    _modal: bool,
) -> std::io::Result<()> {
    Err(std::io::Error::other("rebuild with --features slint"))
}

#[cfg(all(feature = "device", feature = "slint"))]
fn panel(
    kms_device: Option<&str>,
    max_frames: Option<u64>,
    auto: bool,
    bench: bool,
    remote: Option<String>,
    assets: Option<String>,
    headless: bool,
    peer: Option<String>,
) -> std::io::Result<()> {
    use std::time::{Duration, Instant};

    use flipper_ui::evdev::EvdevSource;
    use flipper_ui::kms::KmsSink;
    use flipper_ui::slint_render::{render_into, FlipperSlintPlatform};
    use flipper_ui::theme::timing;
    use flipper_ui::ui::Screen;
    use flipper_ui::{FlipperKey, Frame, FrameSink, InputSource, PANEL_H, PANEL_W};
    use slint::ComponentHandle;

    // Headless: the browser view is the only output and the only input, so cog
    // (or anything else) can keep the panel. Without it the panel is required.
    if headless && remote.is_none() {
        return Err(std::io::Error::other("--headless needs --remote ADDR"));
    }

    let mut sink = if headless {
        None
    } else {
        let sink = KmsSink::open(kms_device.map(std::path::Path::new))?;
        let (w, h) = sink.size();
        if (w, h) != (PANEL_W, PANEL_H) {
            return Err(std::io::Error::other(format!(
                "panel reports {w}x{h}, this build is compiled for {PANEL_W}x{PANEL_H}"
            )));
        }
        Some(sink)
    };
    // Buttons are left alone in headless mode: whoever owns the panel owns them
    // too, and two readers both reacting would be confusing.
    let mut input = if headless {
        None
    } else {
        Some(EvdevSource::open()?)
    };

    // The browser view is a second sink over the same frames and a second source
    // of the same key events, so nothing downstream can tell a remote click from
    // a finger.
    #[cfg(feature = "remote")]
    let mut web = match remote {
        Some(addr) => {
            let dir = assets
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| "crates/flipper-ui/assets/remote".into());
            let view = flipper_ui::remote::RemoteView::bind_with_peer(&addr, dir, peer.clone())?;
            eprintln!("remote view    http://{}/", view.addr());
            if peer.is_some() {
                eprintln!("comparison     /diff");
            }
            Some(view)
        }
        None => None,
    };
    #[cfg(not(feature = "remote"))]
    if remote.is_some() {
        return Err(std::io::Error::other("rebuild with --features remote"));
    }

    let window = FlipperSlintPlatform::install();
    let screen = demo::build();
    screen.show().expect("show");
    // Three cadences, by what actually moves: sensors every 5s as desktop.js
    // does, addresses every 30s because a cable or a lease can change them, and
    // hostname and profile once because the booted subvol cannot change without a
    // reboot.
    let mut idle = flipper_ui::status::Idle::read_all();
    apply_idle(&screen, &idle);
    let mut sensor_poll = Instant::now();
    let mut link_poll = Instant::now();

    // Apps live next to the binary's workspace root, so a deployed tree finds
    // them without configuration.
    let apps = flipper_ui::app::discover(std::path::Path::new("apps"));
    eprintln!(
        "apps           {} found: {:?}",
        apps.len(),
        apps.iter().map(|a| &a.name).collect::<Vec<_>>()
    );
    let mut app_selected = 0i32;
    // First visible row of the app list. More apps than the viewport holds means
    // the list scrolls and shows a bar, exactly as the menu does.
    let mut app_scroll = 0i32;
    let mut running: Option<flipper_ui::RunningApp> = None;

    // Frame buffer is allocated once and reused, so the steady state does not
    // allocate. flipctl inherits this requirement; the boot menu and the
    // installer benefit from it.
    let mut frame = Vec::new();

    // The menu navigation stack: one entry per level, holding that level's
    // selection and scroll. Pushing a submenu starts it at the top, which is what
    // the prototype does by constructing a fresh SubMenuScene; popping restores
    // the parent's position, which it gets for free by keeping the scene object.
    let mut stack: Vec<(&'static demo::Menu, i32, i32)> = vec![(&demo::MAIN, 0, 0)];
    // The top level's position, kept out of the stack while it is being edited so
    // the hot path is not a Vec index. Written back on push, read back on pop.
    let mut selected = 0i32;
    let mut scroll = 0i32;

    // Radio state for the Network rows. Polled off-thread: `nmcli` takes tens of
    // milliseconds at best and the render loop cannot wait on it.
    let net = flipper_ui::net::NetSource::spawn();
    let mut net_now = net.get();

    // The blocking dialog, when one is open. `right` is what the run key does; the
    // left key always just closes.
    struct Dialog {
        lines: Vec<&'static str>,
        left: &'static str,
        right: &'static str,
        act: DialogAct,
    }
    // What the dialog's right button does. Only one dialog has one so far: the
    // airplane block, whose "Turn off" clears airplane mode and then proceeds to
    // the row that was blocked.
    #[derive(PartialEq)]
    enum DialogAct {
        None,
        ClearAirplane,
    }
    let mut dialog: Option<Dialog> = None;
    let mut dialog_slot: Option<usize> = None;
    // What was last pushed to the window, so an unchanged dialog is not pushed
    // again. See the note at the push site.
    let mut last_dialog: Option<(Vec<&'static str>, &'static str, &'static str)> = None;

    // Which chevron of a selected toggle row is flashing, and until when.
    let mut arrow: Option<(i32, Instant)> = None;

    // The open detail screen and its poller, or None on a menu. Dropping this is
    // the equivalent of the prototype's `exit()`: the polling thread stops.
    let mut live: Option<detail::Live> = None;
    let mut detail_offset = 0i32;
    // The Ethernet page's selected card, and its open dump.
    let mut eth_selected = 0i32;
    let mut eth_open = false;
    let mut eth_scroll = 0.0f32;
    let mut eth_content_h = 0.0f32;
    // Set when a key moved the scroll, so the rows are rebuilt on the next frame
    // even though the poller has nothing new.
    let mut detail_dirty = true;
    let mut applying = detail::Applying::No;
    let mut apply_rx: Option<std::sync::mpsc::Receiver<Result<(), String>>> = None;
    // Animated icons advance while a row is selected. Driven here rather than by
    // Slint's animation-tick so the loop knows a repaint is due.
    let mut tick = 0i32;
    let mut icon_tick = Instant::now();
    let mut last_selected = -1i32;
    // Set when a key is handled, cleared by the next commit, so the log shows the
    // real key-to-frame delay rather than a guess.
    let mut key_at: Option<Instant> = None;
    let flash = Duration::from_millis(timing::PRESS_FLASH_MS as u64);
    let mut flash_until: Option<Instant> = None;
    // Which soft slot is showing its pressed state, and what to do when the flash
    // ends. The prototype flashes first and acts after: `btn.press()`, then a 30ms
    // timer calls `release()` and the handler. Acting immediately would switch the
    // screen before the inverted button was ever drawn.
    let mut pressed_slot: Option<usize> = None;
    let mut pending: Option<FlipperKey> = None;
    let mut frames = 0u64;
    // Commit latency is the number that matters: the SPI transfer alone is
    // 37152 bytes at 20MHz, about 14.9ms, and the driver re-sends the whole
    // frame on every atomic update.
    let mut render_total = Duration::ZERO;
    let mut commit_total = Duration::ZERO;
    let mut commit_worst = Duration::ZERO;
    let started = Instant::now();
    let mut last_auto = Instant::now();
    // The bar polls sysfs on its own cadence and only reports a change, so an
    // unchanged battery reading never dirties the screen.
    let mut status = flipper_ui::StatusSource::new(Duration::from_secs(1));
    // Merged queue so panel buttons and browser clicks take the same path.
    let mut pending_input: Vec<flipper_ui::KeyEvent> = Vec::new();

    let report = |frames: u64,
                  started: &Instant,
                  render_total: Duration,
                  commit_total: Duration,
                  commit_worst: Duration| {
        let elapsed = started.elapsed();
        eprintln!("frames        {frames}");
        eprintln!("elapsed       {:.2}s", elapsed.as_secs_f32());
        if frames > 0 {
            eprintln!(
                "render mean   {:.2}ms",
                render_total.as_secs_f32() * 1000.0 / frames as f32
            );
            eprintln!(
                "commit mean   {:.2}ms",
                commit_total.as_secs_f32() * 1000.0 / frames as f32
            );
            eprintln!("commit worst  {:.2}ms", commit_worst.as_secs_f32() * 1000.0);
            eprintln!(
                "throughput    {:.1} fps sustained",
                frames as f32 / elapsed.as_secs_f32()
            );
        }
    };

    loop {
        #[cfg(feature = "remote")]
        if let Some(view) = web.as_mut() {
            // A browser opening mid-idle needs the screen as it stands; nothing
            // has changed, so nothing would otherwise be sent.
            if view.take_new_viewer() && !frame.is_empty() {
                eprintln!("remote viewer  connected, sending the current frame");
                view.commit(
                    Frame::new(&frame, PANEL_W, PANEL_H),
                    flipper_ui::Rect::new(0, 0, PANEL_W, PANEL_H),
                )?;
            }
            while let Some(event) = view.poll() {
                pending_input.push(event);
            }
        }
        if let Some(input) = input.as_mut() {
            while let Some(event) = input.poll() {
                pending_input.push(event);
            }
        }

        for event in pending_input.drain(..) {
            if !event.down {
                continue;
            }
            key_at = Some(Instant::now());
            // Report which on-screen slot a soft key sits under, so the log
            // proves the labels line up with the hardware instead of us
            // assuming it.
            let slot = FlipperKey::SOFT_ROW.iter().position(|k| *k == event.key);
            match slot {
                Some(i) if demo::SOFT_LABELS[i].is_empty() => {
                    eprintln!("key {} -> slot {i}, no label", event.key.name())
                }
                Some(i) => eprintln!(
                    "key {} -> slot {i} \"{}\"",
                    event.key.name(),
                    demo::SOFT_LABELS[i]
                ),
                None => eprintln!("key {}", event.key.name()),
            }

            // A labelled soft key must do something, or the label is a lie.
            let on_menu_now = screen.get_screen() == Screen::Menu;
            let labels: &[&str; 5] = if on_menu_now {
                &demo::SOFT_LABELS
            } else {
                &demo::IDLE_LABELS
            };
            let labelled_soft = slot.is_some_and(|i| !labels[i].is_empty());

            // While an app is running it owns the keys, except Back, which is
            // the way out of an app that has stopped responding.
            if let Some(app) = running.as_mut() {
                if screen.get_screen() == Screen::AppForm && event.key == FlipperKey::Back {
                    app.stop();
                    running = None;
                    let rows: Vec<(String, String)> = apps
                        .iter()
                        .map(|a| (a.name.clone(), String::new()))
                        .collect();
                    apply_app_list(&screen, &rows, app_selected, &EMPTY_HINTS, &[], (0, 0), app_scroll);
                    screen.set_screen(Screen::Apps);
                } else {
                    app.send(event);
                }
                continue;
            }

            // The app list.
            if screen.get_screen() == Screen::Apps {
                match event.key {
                    FlipperKey::Down if !apps.is_empty() => {
                        app_selected = (app_selected + 1).rem_euclid(apps.len() as i32);
                    }
                    FlipperKey::Up if !apps.is_empty() => {
                        app_selected = (app_selected - 1).rem_euclid(apps.len() as i32);
                    }
                    FlipperKey::Ok | FlipperKey::Run => {
                        if let Some(entry) = apps.get(app_selected as usize) {
                            match flipper_ui::RunningApp::spawn(entry) {
                                Ok(app) => {
                                    eprintln!("app            started {}", entry.name);
                                    running = Some(app);
                                }
                                Err(e) => eprintln!("app            {} failed: {e}", entry.name),
                            }
                        }
                    }
                    FlipperKey::Back | FlipperKey::Escape => screen.set_screen(Screen::Menu),
                    _ => {}
                }
                let visible = flipper_ui::theme::count::LIST_VISIBLE_ROWS;
                app_scroll = app_scroll.clamp(
                    (app_selected - visible + 1).max(0),
                    app_selected.min((apps.len() as i32 - visible).max(0)),
                );
                let rows: Vec<(String, String)> = apps
                    .iter()
                    .map(|a| (a.name.clone(), String::new()))
                    .collect();
                apply_app_list(&screen, &rows, app_selected, &EMPTY_HINTS, &[], (0, 0), app_scroll);
                continue;
            }

            // A dialog owns every key while it is open, exactly as the
            // prototype's modal does: `handleInput` returns before the scene sees
            // anything. Both buttons flash for 30ms before acting.
            if dialog.is_some() {
                match event.key {
                    FlipperKey::Escape | FlipperKey::Back => {
                        dialog_slot = Some(0);
                        pending = Some(FlipperKey::Escape);
                        flash_until = Some(Instant::now() + flash);
                    }
                    FlipperKey::Ok | FlipperKey::Run
                        if !dialog.as_ref().unwrap().right.is_empty() =>
                    {
                        dialog_slot = Some(4);
                        pending = Some(FlipperKey::Run);
                        flash_until = Some(Instant::now() + flash);
                    }
                    _ => {}
                }
                continue;
            }

            // A detail screen owns its keys: up and down scroll, esc returns to
            // the menu that opened it, and Update's run key starts the update.
            if let Some(detail::Live::Ethernet(w)) = live.as_ref() {
                let ifaces = w.get();
                let count = ifaces.len() as i32;
                // The dump owns every key while it is open, and scrolls a row at a
                // time rather than a pixel: landing between rows would clip the
                // text at both ends of the viewport.
                if eth_open {
                    let step = flipper_ui::theme::metric::ETH_MODAL_LINE_H as f32;
                    let max = (eth_content_h
                        - (flipper_ui::theme::metric::ETH_MODAL_H
                            - 2 * flipper_ui::theme::metric::ETH_MODAL_PAD_Y)
                            as f32)
                        .max(0.0);
                    match event.key {
                        FlipperKey::Down => {
                            eth_scroll = (eth_scroll + step).min(max);
                            detail_dirty = true;
                        }
                        FlipperKey::Up => {
                            eth_scroll = (eth_scroll - step).max(0.0);
                            detail_dirty = true;
                        }
                        FlipperKey::Escape | FlipperKey::Back => {
                            eth_open = false;
                            eth_scroll = 0.0;
                            detail_dirty = true;
                        }
                        _ => {}
                    }
                    continue;
                }
                match event.key {
                    FlipperKey::Down if count > 0 => {
                        eth_selected = (eth_selected + 1).rem_euclid(count);
                        detail_dirty = true;
                    }
                    FlipperKey::Up if count > 0 => {
                        eth_selected = (eth_selected - 1).rem_euclid(count);
                        detail_dirty = true;
                    }
                    // Only a connected card opens: a disconnected one has nothing
                    // to show, which is also why its chevron is suppressed.
                    FlipperKey::Ok | FlipperKey::Run => {
                        if ifaces
                            .get(eth_selected as usize)
                            .is_some_and(|i| i.connected)
                        {
                            eth_open = true;
                            eth_scroll = 0.0;
                            detail_dirty = true;
                        }
                    }
                    FlipperKey::Escape | FlipperKey::Back => {
                        pressed_slot = Some(0);
                        pending = Some(FlipperKey::Escape);
                        flash_until = Some(Instant::now() + flash);
                    }
                    _ => {}
                }
                continue;
            }

            if let Some(open) = live.as_ref() {
                let total = open.rows(&applying).len() as i32;
                let max = (total - flipper_ui::theme::count::DETAIL_VISIBLE_ROWS).max(0);
                match event.key {
                    FlipperKey::Down => {
                        detail_offset = (detail_offset + 1).min(max);
                        detail_dirty = true;
                    }
                    FlipperKey::Up => {
                        detail_offset = (detail_offset - 1).max(0);
                        detail_dirty = true;
                    }
                    FlipperKey::Run | FlipperKey::Ok
                        if !open.hints(&applying)[4].is_empty() =>
                    {
                        pressed_slot = Some(4);
                        pending = Some(FlipperKey::Run);
                        flash_until = Some(Instant::now() + flash);
                    }
                    FlipperKey::Escape | FlipperKey::Back => {
                        pressed_slot = Some(0);
                        pending = Some(FlipperKey::Escape);
                        flash_until = Some(Instant::now() + flash);
                    }
                    _ => {}
                }
                continue;
            }

            let rows = stack.last().unwrap().0.rows.len() as i32;
            let row = &stack.last().unwrap().0.rows[selected as usize];
            let is_toggle = matches!(row.act, demo::Act::Airplane);

            match (on_menu_now, event.key) {
                // Back leaves the menu rather than the program: the menu is not
                // the root screen any more. Inside a submenu it pops one level,
                // which is what SubMenuScene returns 'pop' for.
                //
                // No panel key quits. This runs as a service, so a button that
                // kills the UI is a footgun: `esc` used to exit, which meant one
                // press of the leftmost soft key took the whole screen down.
                // systemctl stop, or --frames, ends it instead.
                (true, FlipperKey::Back) | (true, FlipperKey::Escape) => {
                    if stack.len() > 1 {
                        stack.pop();
                        let (menu, sel, scr) = *stack.last().unwrap();
                        selected = sel;
                        scroll = scr;
                        demo::apply_menu(&screen, menu, &net_now);
                        eprintln!("menu           back to {}", if menu.title.is_empty() { "main" } else { menu.title });
                    } else {
                        screen.set_screen(Screen::Idle);
                        eprintln!("screen         idle");
                    }
                }
                (true, FlipperKey::Down) => selected = (selected + 1).rem_euclid(rows),
                (true, FlipperKey::Up) => selected = (selected - 1).rem_euclid(rows),
                // Left and right adjust a toggle row and are ignored elsewhere.
                // The chevron flashes rather than the whole row: nothing is being
                // opened, so the selector must not fill.
                (true, FlipperKey::Left) | (true, FlipperKey::Right) if is_toggle => {
                    net.set_airplane(!net_now.airplane);
                    arrow = Some((
                        if event.key == FlipperKey::Left { 1 } else { 2 },
                        Instant::now()
                            + Duration::from_millis(timing::CHEVRON_FLASH_MS as u64),
                    ));
                }
                // A toggle flips on ok too, with no press flash and no scene
                // change, matching the onToggle branch in submenu.js.
                (true, FlipperKey::Ok) | (true, FlipperKey::Run) if is_toggle => {
                    net.set_airplane(!net_now.airplane);
                }
                (true, FlipperKey::Ok) | (true, FlipperKey::Run) => {
                    // The 30ms flash comes first and the row acts when it ends,
                    // so the inverted row is always drawn at least once.
                    pending = Some(FlipperKey::Ok);
                    flash_until = Some(Instant::now() + flash);
                }
                (_, FlipperKey::Ok) => flash_until = Some(Instant::now() + flash),
                // A labelled soft key inverts first and acts when the flash ends.
                _ if labelled_soft => {
                    pressed_slot = slot;
                    pending = Some(event.key);
                    flash_until = Some(Instant::now() + flash);
                }
                _ => {}
            }
        }

        if flash_until.is_some_and(|until| Instant::now() >= until) {
            flash_until = None;
            pressed_slot = None;
            let slot = dialog_slot.take();
            // The flash has been seen; now do what the button says. Idle's slot 1
            // is "Menu", which is where desktop.js puts it.
            if let Some(key) = pending.take() {
                // A dialog's own buttons, resolved before anything else since it
                // was holding every key.
                if let Some(d) = dialog.take() {
                    if slot == Some(4) && d.act == DialogAct::ClearAirplane {
                        net.set_airplane(false);
                        // menu.js proceeds to the action the dialog interrupted.
                        dialog = Some(Dialog {
                            lines: vec!["5G Modem", "is not ported yet"],
                            left: "Back",
                            right: "",
                            act: DialogAct::None,
                        });
                    }
                } else if matches!(screen.get_screen(), Screen::Detail | Screen::Ethernet) {
                    match key {
                        // Back to the menu that opened this screen. Dropping the
                        // watch stops its poller.
                        FlipperKey::Escape => {
                            live = None;
                            eth_open = false;
                            eth_scroll = 0.0;
                            let (menu, sel, scr) = *stack.last().unwrap();
                            selected = sel;
                            scroll = scr;
                            demo::apply_menu(&screen, menu, &net_now);
                            screen.set_breadcrumb(
                                if menu.title.is_empty() {
                                    String::new()
                                } else {
                                    format!("> {}", menu.title)
                                }
                                .as_str()
                                .into(),
                            );
                            screen.set_screen(Screen::Menu);
                        }
                        FlipperKey::Run => {
                            if let Some(rx) = live.as_ref().and_then(|l| l.start_update()) {
                                applying = detail::Applying::Running;
                                apply_rx = Some(rx);
                                eprintln!("action         update starting");
                            }
                        }
                        _ => {}
                    }
                } else if key == FlipperKey::View && screen.get_screen() == Screen::Idle {
                    screen.set_screen(Screen::Menu);
                    eprintln!("screen         menu");
                } else if key == FlipperKey::Ok && screen.get_screen() == Screen::Menu {
                    let row = &stack.last().unwrap().0.rows[selected as usize];
                    match &row.act {
                        demo::Act::Sub(next) => {
                            stack.last_mut().unwrap().1 = selected;
                            stack.last_mut().unwrap().2 = scroll;
                            stack.push((next, 0, 0));
                            selected = 0;
                            scroll = 0;
                            demo::apply_menu(&screen, next, &net_now);
                            eprintln!("menu           {}", next.title);
                        }
                        demo::Act::Apps => {
                            let rows: Vec<(String, String)> = apps
                                .iter()
                                .map(|a| (a.name.clone(), String::new()))
                                .collect();
                            apply_app_list(&screen, &rows, app_selected, &EMPTY_HINTS, &[], (0, 0), app_scroll);
                            screen.set_screen(Screen::Apps);
                            eprintln!("screen         apps");
                        }
                        demo::Act::Detail(which) => {
                            live = Some(detail::Live::open(*which));
                            detail_offset = 0;
                            // Build the rows now rather than waiting for the
                            // poller: its first fetch can equal the value the
                            // watch started with, in which case it never reports
                            // dirty and the previous screen's rows would stay.
                            detail_dirty = true;
                            applying = detail::Applying::No;
                            apply_rx = None;
                            // Push the crumb so the trail reads
                            // "> Settings > Battery info", which is what the
                            // prototype's stack-derived breadcrumb gives.
                            stack.last_mut().unwrap().1 = selected;
                            stack.last_mut().unwrap().2 = scroll;
                            let trail = demo::crumb(&stack, which.title());
                            screen.set_breadcrumb(trail.as_str().into());
                            screen.set_screen(if *which == demo::Detail::Ethernet {
                                Screen::Ethernet
                            } else {
                                Screen::Detail
                            });
                            eprintln!("detail         {}", which.title());
                        }
                        demo::Act::Reboot => {
                            eprintln!("action         reboot");
                            flipper_ui::net::reboot();
                        }
                        // The prototype blocks this row while airplane mode is on
                        // and offers to turn it off, rather than failing silently.
                        demo::Act::Unported if row.label == "5G Modem" && net_now.airplane => {
                            dialog = Some(Dialog {
                                lines: vec![
                                    "To use 5G Modem you need",
                                    "to turn off Airplane mode",
                                ],
                                left: "Cancel",
                                right: "Turn off",
                                act: DialogAct::ClearAirplane,
                            });
                        }
                        // Say so rather than doing nothing: a row that swallows
                        // the key looks like a bug, and the prototype does have a
                        // scene here.
                        demo::Act::Unported => {
                            dialog = Some(Dialog {
                                lines: vec![row.label, "is not ported yet"],
                                left: "Back",
                                right: "",
                                act: DialogAct::None,
                            });
                        }
                        // No factory in the prototype either.
                        demo::Act::Nothing | demo::Act::Airplane => {}
                    }
                }
            }
        }

        // The chevron flash is its own timer: it is shorter-lived than a scene
        // change and must not be tangled up with the press flash.
        if arrow.is_some_and(|(_, until)| Instant::now() >= until) {
            arrow = None;
        }

        // An open detail screen repaints when its poller has something new, and
        // on the frame after a key moved its scroll.
        if let Some(detail::Live::Ethernet(w)) = live.as_ref() {
            if w.take_dirty() || detail_dirty {
                detail_dirty = false;
                let ifaces = w.get();
                eth_selected = eth_selected.clamp(0, (ifaces.len() as i32 - 1).max(0));
                screen.set_eth_links(slint::ModelRc::new(slint::VecModel::from(
                    detail::eth_links(&ifaces),
                )));
                screen.set_eth_selected(eth_selected);
                // The dump reads the page's own poll, so it stays live while open.
                let (rows, total) = match ifaces.get(eth_selected as usize) {
                    Some(iface) if eth_open => detail::eth_detail(iface),
                    _ => (Vec::new(), 0.0),
                };
                eth_content_h = total;
                screen.set_eth_detail_content_h(total);
                screen.set_eth_detail_offset(eth_scroll);
                screen.set_eth_detail_rows(slint::ModelRc::new(slint::VecModel::from(rows)));
            }
        } else if let Some(open) = live.as_ref() {
            if open.take_dirty() || detail_dirty {
                detail_dirty = false;
                let rows = open.rows(&applying);
                let max = (rows.len() as i32 - flipper_ui::theme::count::DETAIL_VISIBLE_ROWS).max(0);
                detail_offset = detail_offset.clamp(0, max);
                screen.set_detail_rows(slint::ModelRc::new(slint::VecModel::from(rows)));
                screen.set_detail_offset(detail_offset);
                screen.set_detail_hints(demo::labels(&open.hints(&applying)));
            }
            if let Some(rx) = apply_rx.as_ref() {
                match rx.try_recv() {
                    Ok(Ok(())) => {
                        applying = detail::Applying::Done;
                        apply_rx = None;
                        detail_dirty = true;
                    }
                    Ok(Err(e)) => {
                        eprintln!("action         update failed: {e}");
                        applying = detail::Applying::Failed(e);
                        apply_rx = None;
                        detail_dirty = true;
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => {}
                    Err(_) => apply_rx = None,
                }
            }
        }

        // Radio state moved, so any row whose status reads it has to be rebuilt.
        if net.take_dirty() {
            net_now = net.get();
            demo::apply_menu(&screen, stack.last().unwrap().0, &net_now);
        }

        // Nothing repaints unless something changed, so an unattended run needs
        // a reason to redraw. Reuse the animated-icon cadence.
        let auto_period = if bench {
            Duration::ZERO
        } else {
            Duration::from_millis(timing::ICON_FRAME_MS as u64)
        };
        if auto && last_auto.elapsed() >= auto_period {
            selected = (selected + 1).rem_euclid(stack.last().unwrap().0.rows.len() as i32);
            last_auto = Instant::now();
        }

        if let Some(now) = status.poll() {
            apply_status(&screen, now);
            
            eprintln!(
                "status         battery {}% charging={} eth={:?} wifi={} modem={}",
                now.battery, now.charging, now.ethernet, now.wifi_connected, now.modem_available
            );
        }

        // An app's scenes arrive on their own schedule, so they are pulled every
        // iteration rather than on a timer.
        if let Some(app) = running.as_mut() {
            if app.poll().is_some() {
                let scene = app.scene().clone();
                screen.set_app_title(scene.title.as_str().into());
                match scene.kind {
                    flipper_ui::SceneKind::Log => {
                        screen.set_app_lines(slint::ModelRc::new(slint::VecModel::from(
                            scene
                                .rows
                                .iter()
                                .map(|(l, _)| slint::SharedString::from(l.as_str()))
                                .collect::<Vec<_>>(),
                        )));
                        screen.set_app_hints(slint::ModelRc::new(slint::VecModel::from(
                            scene
                                .hints
                                .iter()
                                .map(|h| slint::SharedString::from(h.as_str()))
                                .collect::<Vec<_>>(),
                        )));
                        screen.set_app_log_total(scene.total);
                        screen.set_app_log_offset(scene.offset);
                        screen.set_screen(Screen::AppLog);
                    }
                    flipper_ui::SceneKind::Form => {
                        apply_app_list(
                            &screen,
                            &scene.rows,
                            scene.selected,
                            &scene.hints,
                            &scene.ends,
                            (scene.total, scene.offset),
                            0,
                        );
                        screen.set_screen(Screen::AppForm);
                    }
                }
            }
            // An app that exits returns the user to the list rather than leaving
            // its last frame on screen forever.
            if app.finished() {
                eprintln!("app            exited");
                running = None;
                let rows: Vec<(String, String)> = apps
                    .iter()
                    .map(|a| (a.name.clone(), String::new()))
                    .collect();
                apply_app_list(&screen, &rows, app_selected, &EMPTY_HINTS, &[], (0, 0), app_scroll);
                screen.set_screen(Screen::Apps);
            }
        }

        if sensor_poll.elapsed() >= Duration::from_secs(5) {
            sensor_poll = Instant::now();
            if idle.refresh_sensors() {
                apply_idle(&screen, &idle);
            }
        }
        if link_poll.elapsed() >= Duration::from_secs(30) {
            link_poll = Instant::now();
            if idle.refresh_links() {
                apply_idle(&screen, &idle);
                eprintln!("links          {} interface(s)", idle.links.len());
            }
        }

        // Keep the selection inside the viewport. Navigation wraps, so jumping
        // from the last row to the first has to scroll all the way back.
        let visible = flipper_ui::theme::count::LIST_VISIBLE_ROWS;
        scroll = scroll.clamp(
            (selected - visible + 1).max(0),
            selected.min((stack.last().unwrap().0.rows.len() as i32 - visible).max(0)),
        );

        screen.set_selected(selected);
        screen.set_scroll(scroll);
        // A dialog's press flash belongs to its own button, so the row underneath
        // must not fill at the same time.
        screen.set_pressed(
            flash_until.is_some() && pressed_slot.is_none() && dialog_slot.is_none(),
        );
        screen.set_arrow_pressed(arrow.map_or(0, |(dir, _)| dir));
        // Only when the dialog actually changed.
        //
        // Handing Slint a freshly built model is a change even when its contents
        // are identical, so doing this every iteration marked the whole window
        // dirty every iteration and the panel repainted forever. On a static
        // screen that pinned the remote view at its 10fps cap and kept the SPI
        // bus busy for nothing. Setting a scalar property to the same value is
        // free, because Slint compares it; a model is not.
        let dialog_key = dialog
            .as_ref()
            .map(|d| (d.lines.clone(), d.left, d.right));
        if dialog_key != last_dialog {
            last_dialog = dialog_key;
            screen.set_modal_lines(slint::ModelRc::new(slint::VecModel::from(
                dialog
                    .as_ref()
                    .map(|d| {
                        d.lines
                            .iter()
                            .map(|l| slint::SharedString::from(*l))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default(),
            )));
            screen.set_modal_left(dialog.as_ref().map_or("", |d| d.left).into());
            screen.set_modal_right(dialog.as_ref().map_or("", |d| d.right).into());
        }
        screen.set_modal_pressed_slot(dialog_slot.map_or(-1, |i| i as i32));
        screen.set_detail_pressed_slot(
            if screen.get_screen() == Screen::Detail {
                pressed_slot.map_or(-1, |i| i as i32)
            } else {
                -1
            },
        );
        screen.set_idle_pressed_slot(pressed_slot.map_or(-1, |i| i as i32));
        // The strip's phase restarts whenever the selection moves. MenuLine.js
        // measures elapsed time from `_selectedAt`, not from a global clock, so the
        // first frame drawn after a row lights up is frame 1. Without the reset a
        // newly selected row can land on frame 0, which is what the unselected row
        // was already showing, and the motion is missed entirely.
        if selected != last_selected {
            last_selected = selected;
            tick = 0;
            icon_tick = Instant::now();
            screen.set_tick(tick);
        } else if icon_tick.elapsed() >= Duration::from_millis(timing::ICON_FRAME_MS as u64) {
            icon_tick = Instant::now();
            tick += 1;
            screen.set_tick(tick);
        }
        slint::platform::update_timers_and_animations();

        // Latency instrumentation: how long from a key being handled to the frame
        // that reflects it being handed to the sinks.
        let render_start = Instant::now();
        let damage = render_into(&window, &mut frame);
        render_total += render_start.elapsed();

        if let Some(damage) = damage {
            let commit_start = Instant::now();
            let composed = Frame::new(&frame, PANEL_W, PANEL_H);
            if let Some(sink) = sink.as_mut() {
                sink.commit(composed, damage)?;
            }
            #[cfg(feature = "remote")]
            if let Some(view) = web.as_mut() {
                view.commit(composed, damage)?;
            }
            let took = commit_start.elapsed();
            commit_total += took;
            commit_worst = commit_worst.max(took);
            frames += 1;

            if frames == 1 {
                eprintln!(
                    "first frame committed: {}x{} panel, damage {}x{} at ({}, {})",
                    PANEL_W, PANEL_H, damage.w, damage.h, damage.x, damage.y
                );
            }
            if let Some(t) = key_at.take() {
                eprintln!(
                    "latency        key -> commit {:.1}ms (render {:.1} commit {:.1})",
                    t.elapsed().as_secs_f32() * 1000.0,
                    render_total.as_secs_f32() * 0.0,
                    took.as_secs_f32() * 1000.0
                );
            }
            if frames == 2 {
                match sink.as_ref() {
                    Some(sink) => {
                        eprintln!("flush path    {}", sink.flush_path());
                        eprintln!("fb format     {}", sink.format());
                    }
                    None => eprintln!("flush path    headless, browser only"),
                }
            }
            if max_frames.is_some_and(|max| frames >= max) {
                report(frames, &started, render_total, commit_total, commit_worst);
                return Ok(());
            }
        }

        // Headless has no SPI transfer to pace the loop, so without a sleep it
        // would spin a core rendering frames nobody asked for.
        // The panel has no vblank to wait on and the SPI transfer already costs
        // about 15ms, so a short sleep is enough to keep the loop from spinning
        // on the input fds. A blocking poll(2) over EvdevSource::fds() is the
        // next step, once there is a timer source to fold into it.
        if !bench {
            std::thread::sleep(Duration::from_millis(8));
        }
    }
}

#[cfg(not(all(feature = "device", feature = "slint")))]
fn panel(
    _kms_device: Option<&str>,
    _max_frames: Option<u64>,
    _auto: bool,
    _bench: bool,
    _remote: Option<String>,
    _assets: Option<String>,
    _headless: bool,
    _peer: Option<String>,
) -> std::io::Result<()> {
    Err(std::io::Error::other(
        "rebuild with --features device,slint",
    ))
}
