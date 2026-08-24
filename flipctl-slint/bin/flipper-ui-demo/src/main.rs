//! Walks the flipper-ui component set on the panel, or headlessly to a PNG.
//!
//! Modes:
//!   --panel        DRM/KMS + evdev on the device (needs the `device` feature)
//!   --wayland      a compositor owns the panel; we are a client of it
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

    let result = if has("--panel") || has("--headless") || has("--wayland") {
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
            has("--wayland"),
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
const EMPTY_BUTTONS: [String; 0] = [];

const USAGE: &str = "\
usage: flipper-ui-demo [--panel [--kms-device PATH]] [--png PATH]

  --panel        drive the real 256x144 SPI panel and its buttons
  --wayland      present to the compositor that owns the panel, and take its keys
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
        screen.set_idle_buttons(labels(&IDLE_LABELS));
        screen.set_menu_buttons(labels(&SOFT_LABELS));
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
        /// The boot menu, which lists the bootable profiles.
        Boot,
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
    /// Whether a submenu is one the app switcher tracks.
    ///
    /// Network and Settings, which is what the prototype marks as apps: they are
    /// places a person settles into and comes back to, unlike Files or the boot
    /// menu, which are errands.
    pub fn is_card_menu(menu: &'static Menu) -> bool {
        std::ptr::eq(menu, &NETWORK) || std::ptr::eq(menu, &SETTINGS)
    }

    /// The tracked submenu with this title.
    pub fn card_menu(title: &str) -> Option<&'static Menu> {
        [&NETWORK, &SETTINGS]
            .into_iter()
            .find(|menu| menu.title == title)
    }

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
            Row { label: "Boot Menu", icon: 2, frames: 1, stat: Stat::None, act: Act::Boot },
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
        pub fn buttons(&self, applying: &Applying) -> [&'static str; 5] {
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

/// Break one line of output into lines that fit the log body.
///
/// `[rule] overflow = "wrap"` says long text wraps wherever there is vertical
/// room, and a scrolling log has plenty. Clipping instead loses the end of exactly
/// the lines that matter: apt reports its real problem in one long sentence, and
/// "E: Unable to locate package definitely-not-a-real-packa" is not an error
/// message.
///
/// Breaks at spaces, and splits a single token that cannot fit on its own, because
/// a package name or a path is often longer than the screen and dropping the tail
/// of it would be the same bug again.
#[cfg(feature = "slint")]
fn wrap_log(line: &str) -> Vec<String> {
    use flipper_ui::font::TITLE;
    use flipper_ui::theme::metric::MARGIN_H;

    let budget = flipper_ui::theme::PANEL_W - 2 * MARGIN_H as u16;
    let fits = |s: &str| TITLE.text_width(s) <= budget;

    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    for word in line.split_whitespace() {
        let candidate = if cur.is_empty() {
            word.to_string()
        } else {
            format!("{cur} {word}")
        };
        if fits(&candidate) {
            cur = candidate;
            continue;
        }
        if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        // A word too long for a line of its own is cut at the last character that
        // fits, and continues on the next.
        let mut rest = word;
        while !fits(rest) {
            let mut take = rest.len();
            while take > 1 && !fits(&rest[..take]) {
                take -= 1;
                while take > 1 && !rest.is_char_boundary(take) {
                    take -= 1;
                }
            }
            out.push(rest[..take].to_string());
            rest = &rest[take..];
        }
        cur = rest.to_string();
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

/// Which popup is open over the boot menu, and what it is doing.
///
/// Info is read-only. Edit lists the actions for the selected profile, asks before
/// the destructive ones, and reports what happened: the tools take tens of seconds,
/// so "working" and "failed" are states the screen has to have.
#[cfg(feature = "slint")]
enum Popup {
    Info,
    Edit,
    /// Waiting for a yes on the action at this index.
    Confirm(usize),
    /// An action is running; the string is what to call it while it does. No
    /// receiver means there is nothing left to wait for: the device is on its way
    /// down, so the message stays up until it goes.
    Busy(String, Option<std::sync::mpsc::Receiver<Result<bool, String>>>),
    /// Finished: what to say. The message is the tool's own words either way, so
    /// there is nothing else to vary on.
    Said(String),
}

/// Go back to a card: an app takes the keys, one of our screens is navigated to.
///
/// Both live in the same stack, so the switcher does not have to know the
/// difference; this is the one place that does.
#[cfg(feature = "slint")]
#[allow(clippy::too_many_arguments)]
fn launch_card(
    screen: &flipper_ui::ui::Root,
    live: &mut [(String, flipper_ui::RunningApp)],
    focused: &mut Option<usize>,
    recents: &mut flipper_ui::switcher::Recents,
    stack: &mut Vec<(&'static demo::Menu, i32, i32)>,
    name: &str,
    kind: flipper_ui::switcher::Kind,
    net: &flipper_ui::net::Net,
) {
    use flipper_ui::ui::Screen;
    if kind == flipper_ui::switcher::Kind::App {
        if live.iter().any(|(n, _)| n == name) {
            focus_app(live, focused, recents, name);
            // Its own next scene puts the screen right; until then the list is a
            // safe place to be.
            screen.set_screen(Screen::Apps);
        } else {
            // No process behind this card: it is an app that was started and is
            // still waiting on a question, so going back to it means going back to
            // where the question is. Uncovering it is enough, since the question
            // itself was never answered.
            recents.open(name, flipper_ui::switcher::Kind::App);
            *focused = None;
            screen.set_screen(Screen::Apps);
        }
        return;
    }
    let Some(menu) = demo::card_menu(name) else {
        eprintln!("switcher       no screen called {name}");
        recents.close(name);
        return;
    };
    recents.open(name, kind);
    *focused = None;
    // Back out to the main menu first, so the trail reads the same as it would
    // have if the user had walked here.
    stack.truncate(1);
    stack.push((menu, 0, 0));
    demo::apply_menu(screen, menu, net);
    screen.set_screen(Screen::Menu);
}

/// Bring `name` to the front: the switcher's stack, and the keys.
#[cfg(feature = "slint")]
fn focus_app(
    live: &mut [(String, flipper_ui::RunningApp)],
    focused: &mut Option<usize>,
    recents: &mut flipper_ui::switcher::Recents,
    name: &str,
) {
    recents.open(name, flipper_ui::switcher::Kind::App);
    *focused = live.iter().position(|(n, _)| n == name);
    if focused.is_none() {
        eprintln!("switcher       {name} has no process yet");
    }
}

/// Stop `name` and drop it from everything that tracks it.
///
/// The only thing that ends an app. Backing out of one leaves it running, so if
/// this misses a child it is a process nobody can reach any more.
#[cfg(feature = "slint")]
fn kill_app(
    live: &mut Vec<(String, flipper_ui::RunningApp)>,
    focused: &mut Option<usize>,
    recents: &mut flipper_ui::switcher::Recents,
    name: &str,
) {
    if let Some(i) = live.iter().position(|(n, _)| n == name) {
        live[i].1.stop();
        live.remove(i);
        eprintln!("switcher       killed {name}");
    }
    recents.close(name);
    *focused = None;
}

/// The tracked screen the user is looking at, if that is what they are looking at.
///
/// Derived from the navigation rather than stored: a single slot could hold one
/// name, so opening Network forgot that Settings was open, and both belong in the
/// stack at once the way two apps do. Settings and Network are cards the way the
/// prototype's marked-as-app submenus are.
#[cfg(feature = "slint")]
fn open_screen(
    screen: flipper_ui::ui::Screen,
    stack: &[(&'static demo::Menu, i32, i32)],
) -> Option<&'static str> {
    if screen != flipper_ui::ui::Screen::Menu {
        return None;
    }
    stack
        .last()
        .map(|(menu, _, _)| *menu)
        .filter(|menu| demo::is_card_menu(menu))
        .map(|menu| menu.title)
}

/// Which card the panel is showing, if any.
///
/// In order of precedence: a focused app, then an app whose question is on screen,
/// then one of our tracked screens. A focused app comes first because a question
/// outlives the screen it was asked on: `deps` stays set while an install log sits
/// unread, and treating that as "in front" while the user is inside another app
/// put the wrong card at the top of the stack, which sent every switch to whatever
/// happened to be second.
///
/// This decides both what gets photographed and where the switcher's focus starts,
/// and those two have to agree or the stack lies about what you were doing.
#[cfg(feature = "slint")]
fn front_card(
    pending: Option<&str>,
    live: &[(String, flipper_ui::RunningApp)],
    focused: Option<usize>,
    screen_card: Option<&'static str>,
) -> Option<String> {
    if let Some((name, _)) = focused.and_then(|i| live.get(i)) {
        return Some(name.clone());
    }
    if let Some(name) = pending {
        return Some(name.to_string());
    }
    screen_card.map(str::to_string)
}

/// Keep the panel as the thumbnail of whatever card is in front.
///
/// Called wherever the front changes, and once a second while it does not: a
/// card's picture is what the user last saw of it, and a card with no picture is a
/// white rectangle with a name on it.
#[cfg(feature = "slint")]
fn stash_front(
    recents: &mut flipper_ui::switcher::Recents,
    front: Option<String>,
    frame: &[flipper_ui::pixel::Gray8],
) {
    if let Some(name) = front {
        recents.snapshot(&name, snapshot_of(frame));
    }
}

/// The panel as it stands, kept as a card's thumbnail.
#[cfg(feature = "slint")]
fn snapshot_of(frame: &[flipper_ui::pixel::Gray8]) -> flipper_ui::switcher::Snapshot {
    std::sync::Arc::new(frame.iter().map(|p| p.0).collect())
}

/// An app's canvas as an image, or None when it sent the wrong number of bytes.
///
/// One byte per pixel in, three out: the panel is greyscale but Slint's software
/// renderer takes RGB, and expanding here is what keeps the app's side of the
/// protocol one byte per pixel.
#[cfg(feature = "slint")]
fn canvas_image(grey: &[u8]) -> Option<slint::Image> {
    use flipper_ui::theme::{PANEL_H, PANEL_W};
    let expected = usize::from(PANEL_W) * usize::from(PANEL_H);
    if grey.len() != expected {
        // Said once, not per frame: an app that gets this wrong gets it wrong
        // every frame.
        static WARNED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if !WARNED.swap(true, std::sync::atomic::Ordering::Relaxed) {
            eprintln!(
                "app            canvas is {} bytes, expected {expected}",
                grey.len()
            );
        }
        return None;
    }
    let mut buffer =
        slint::SharedPixelBuffer::<slint::Rgb8Pixel>::new(u32::from(PANEL_W), u32::from(PANEL_H));
    for (px, v) in buffer.make_mut_slice().iter_mut().zip(grey.iter()) {
        *px = slint::Rgb8Pixel { r: *v, g: *v, b: *v };
    }
    Some(slint::Image::from_rgb8(buffer))
}

/// Start a console app, or bring the one already running forward.
///
/// Where frames go: the card itself, or a compositor that holds it.
///
/// `KmsSink` is what the boot menu, the installer and recovery use, and it is what
/// flipctl uses with no compositor around. `WlSink` is the same frames attached to a
/// surface, which is how flipctl runs under a compositor that owns the panel and,
/// unchanged, in a window on a desktop. Only the last step differs; the renderer
/// above knows nothing about either.
#[cfg(all(feature = "device", feature = "slint"))]
enum PanelOut {
    Kms(flipper_ui::kms::KmsSink),
    #[cfg(feature = "wayland")]
    Wl(flipper_ui::wl_sink::WlSink),
}

#[cfg(all(feature = "device", feature = "slint"))]
impl PanelOut {
    fn commit(
        &mut self,
        frame: flipper_ui::Frame<'_>,
        damage: flipper_ui::pixel::Rect,
    ) -> std::io::Result<()> {
        use flipper_ui::FrameSink;
        match self {
            Self::Kms(s) => s.commit(frame, damage),
            #[cfg(feature = "wayland")]
            Self::Wl(s) => s.commit(frame, damage),
        }
    }

    /// Put a simulated press on the compositor's wire, for the app that has focus.
    ///
    /// Only the Wayland sink can: with the KMS path flipctl *is* the only thing on
    /// the panel, so a simulated press has nowhere else to go and is handled by the
    /// UI directly.
    fn inject(&mut self, code: u16, down: bool) -> bool {
        match self {
            Self::Kms(_) => false,
            #[cfg(feature = "wayland")]
            Self::Wl(s) => s.inject(code, down),
        }
    }

    /// Keys, for the sink that also carries them. The KMS path reads evdev itself.
    fn poll_key(&mut self) -> Option<flipper_ui::KeyEvent> {
        match self {
            Self::Kms(_) => None,
            #[cfg(feature = "wayland")]
            Self::Wl(s) => {
                use flipper_ui::InputSource;
                s.poll()
            }
        }
    }

    /// Hand the card over to a program that draws for itself.
    ///
    /// Refused under a compositor, and that is the point: the console kind exists
    /// because a program had to be given the hardware, and a compositor makes that
    /// both unnecessary and destructive, since letting go would take the panel from
    /// the compositor rather than from us.
    fn detach(&mut self) -> std::io::Result<()> {
        match self {
            Self::Kms(s) => s.detach(),
            #[cfg(feature = "wayland")]
            Self::Wl(_) => Err(std::io::Error::other(
                "a compositor owns the panel; console apps need --panel",
            )),
        }
    }

    fn attach(&mut self) -> std::io::Result<()> {
        match self {
            Self::Kms(s) => s.attach(),
            #[cfg(feature = "wayland")]
            Self::Wl(_) => Ok(()),
        }
    }

    fn is_detached(&self) -> bool {
        match self {
            Self::Kms(s) => s.is_detached(),
            #[cfg(feature = "wayland")]
            Self::Wl(_) => false,
        }
    }

    fn flush_path(&self) -> String {
        match self {
            Self::Kms(s) => s.flush_path().to_string(),
            #[cfg(feature = "wayland")]
            Self::Wl(_) => "compositor".to_string(),
        }
    }

    fn format(&self) -> String {
        match self {
            Self::Kms(s) => s.format().to_string(),
            #[cfg(feature = "wayland")]
            Self::Wl(_) => "XRGB8888 via wl_shm".to_string(),
        }
    }
}

/// An app running as a client of the compositor that owns the panel.
///
/// There is no session to set up and nothing to hand over: the app is spawned into
/// the same compositor on a workspace of its own, and showing it is making that
/// workspace visible. It gets no DRM device, no framebuffer, no VT and no input
/// device, which is stronger isolation than the console kind could offer even with
/// a device cgroup, because there is nothing to deny.
#[cfg(all(feature = "device", feature = "slint", feature = "wayland"))]
struct WlApp {
    name: String,
    child: std::process::Child,
    workspace: u32,
    /// The size it insists on, and whether its window has been given it yet. The
    /// window does not exist at launch, so this cannot be done there.
    size: Option<(u32, u32)>,
    shaped: bool,
}

/// Launch a Wayland app, or show it again if it is already running.
///
/// The workspace is made visible *before* spawning: sway puts a new client on
/// whichever workspace is visible, so switching first is what keeps the app off
/// flipctl's own workspace, with no window-management race to lose.
#[cfg(all(feature = "device", feature = "slint", feature = "wayland"))]
fn start_wayland(
    entry: &flipper_ui::app::AppEntry,
    sway: &mut Option<flipper_ui::sway::Sway>,
    running: &mut Vec<WlApp>,
) -> Option<u32> {
    if entry.kind != flipper_ui::app::Kind::Wayland {
        return None;
    }
    let Some(sway) = sway.as_mut() else {
        eprintln!("app            {} needs a compositor; run with --wayland", entry.name);
        return None;
    };

    // Only ever one copy. Without this a lost bookkeeping entry means the next
    // launch starts a second instance, both land on the same workspace, and the
    // compositor tiles them: two half windows, each redrawing, which looks exactly
    // like a broken app rather than two of them.
    if let Some(at) = running.iter().position(|a| a.name == entry.name) {
        let ws = running[at].workspace;
        match sway.show(ws) {
            Ok(true) => {
                eprintln!("app            front is {} (workspace {ws})", entry.name);
                return Some(ws);
            }
            other => {
                eprintln!("app            {} could not be shown: {other:?}", entry.name);
                return None;
            }
        }
    }

    // Free according to the compositor as well as to us. Trusting only our own list
    // put a second app on a workspace that still had a window on it, and sway tiled
    // the two side by side: half a game next to half a file manager.
    let mut taken: Vec<u32> = running.iter().map(|a| a.workspace).collect();
    taken.extend(sway.workspaces().unwrap_or_default());
    let workspace = (flipper_ui::sway::HOME + 1..=32)
        .find(|w| !taken.contains(w))
        .unwrap_or(flipper_ui::sway::HOME + 1);
    if !matches!(sway.show(workspace), Ok(true)) {
        eprintln!("app            no workspace {workspace} for {}", entry.name);
        return None;
    }

    let (program, args) = entry.command();
    let mut cmd = std::process::Command::new(program);
    cmd.args(args).current_dir(&entry.dir);
    // Its own process group, so stopping it stops the program rather than the shell
    // that started it. `sh -c` is the parent here, and killing that left Doom running
    // with a window on a workspace flipctl believed to be free.
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    for pair in &entry.env {
        if let Some((name, value)) = pair.split_once('=') {
            cmd.env(name, value);
        }
    }
    // Toolkits that need telling. Set here rather than in every manifest, since
    // the answer is the same for all of them and getting it wrong means an app
    // silently trying to open a DRM device it cannot see.
    cmd.env("QT_QPA_PLATFORM", "wayland");
    cmd.env("SDL_VIDEODRIVER", "wayland");
    cmd.env("GDK_BACKEND", "wayland");
    // The compositor's socket is the app's whole world, and the IPC socket is not
    // part of it: an app that could talk to sway could switch workspaces and read
    // the panel behind our back.
    cmd.env_remove("SWAYSOCK");

    match cmd.spawn() {
        Ok(child) => {
            eprintln!(
                "app            {} started on workspace {workspace}",
                entry.name
            );
            if let Some((w, h)) = entry.size {
                // Scaled to fit the whole of what it draws, not to match one axis:
                // the smaller of the two ratios keeps the aspect and letterboxes the
                // spare.
                let fit = (f32::from(flipper_ui::PANEL_W) / w as f32)
                    .min(f32::from(flipper_ui::PANEL_H) / h as f32);
                match sway.scale(fit) {
                    Ok(true) => eprintln!(
                        "app            {} wants {w}x{h}, output scaled to {fit:.3}",
                        entry.name
                    ),
                    other => eprintln!("app            output would not scale: {other:?}"),
                }
            }
            running.push(WlApp {
                name: entry.name.clone(),
                child,
                workspace,
                size: entry.size,
                shaped: false,
            });
            Some(workspace)
        }
        Err(e) => {
            eprintln!("app            {} did not start: {e}", entry.name);
            let _ = sway.show(flipper_ui::sway::HOME);
            None
        }
    }
}

/// Returns which session is in front now, or None when the entry is not a console
/// app at all. Not blocking and not modal: the program runs on its own VT and the
/// main loop keeps turning, which is what lets Tab and Back work while it is in
/// front.
#[cfg(all(feature = "device", feature = "slint"))]
fn start_console(
    entry: &flipper_ui::app::AppEntry,
    sink: Option<&mut PanelOut>,
    running: &mut Vec<flipper_ui::console::Session>,
    // Opened here rather than per session, and only once there is a session.
    keys: &mut Option<flipper_ui::console::Keyboard>,
    // What is on the panel right now, to hold until the program draws its own.
    showing: &[flipper_ui::Gray8],
) -> Option<usize> {
    if entry.kind != flipper_ui::app::Kind::Console {
        return None;
    }
    let Some(sink) = sink else {
        // Headless: the panel is somebody else's, and handing over what we do not
        // hold would take the screen from whoever does.
        eprintln!("console        {} needs the panel", entry.name);
        return None;
    };
    // The console cannot paint until flipctl lets go of the card. Dropped before
    // anything else, and taken back by every path out of here that fails.
    if let Err(e) = sink.detach() {
        eprintln!("console        {} cannot have the panel: {e}", entry.name);
        return None;
    }

    // Already running: opening it again is a switch, not a second copy.
    if let Some(at) = running.iter().position(|s| s.name == entry.name) {
        eprintln!("console        front is {} (relaunch)", entry.name);
        if let Err(e) = running[at].foreground(None) {
            eprintln!("console        {} cannot be shown: {e}", entry.name);
            let _ = sink.attach();
            return None;
        }
        return Some(at);
    }

    let taken: Vec<u16> = running.iter().map(|s| s.vt()).collect();
    let Some(vt) = flipper_ui::console::VTS.filter(|vt| !taken.contains(vt)).next() else {
        eprintln!("console        no free VT for {}", entry.name);
        let _ = sink.attach();
        return None;
    };
    // Whatever was in front is put away: the new session is about to own the panel,
    // and two programs painting into the same framebuffer flicker through each
    // other.
    for other in running.iter_mut() {
        let _ = other.background();
    }
    let handover: Vec<u8> = showing.iter().map(|p| p.0).collect();
    match flipper_ui::console::Session::start(entry, vt, Some(&handover)) {
        Ok(session) => {
            if keys.is_none() {
                *keys = flipper_ui::console::Keyboard::open()
                    .inspect_err(|e| eprintln!("console        keys not forwarded: {e}"))
                    .ok();
            }
            running.push(session);
            eprintln!("console        front is {} (launched)", entry.name);
            Some(running.len() - 1)
        }
        Err(e) => {
            eprintln!("console        {} failed: {e}", entry.name);
            let _ = sink.attach();
            None
        }
    }
}

/// A panel-sized frame saying an app has the screen and we cannot see it.
///
/// For the browser view and the switcher's card while a program that takes DRM
/// master is running: its pixels never reach the framebuffer flipctl reads, and the
/// last frame that did would otherwise stand in for it and look like the app.
#[cfg(all(feature = "device", feature = "slint"))]
fn detached_notice(name: &str) -> Vec<u8> {
    use flipper_ui::font;
    use flipper_ui::theme::{PANEL_H, PANEL_W};
    use flipper_ui::Gray8;

    let mut surface = flipper_ui::Surface::panel();
    surface.clear(Gray8::WHITE);
    let lines = [
        format!("{name} has the panel"),
        "It draws through KMS, which".to_string(),
        "cannot be read back from here.".to_string(),
        "Esc on the device leaves it.".to_string(),
    ];
    for (i, line) in lines.iter().enumerate() {
        let font = if i == 0 { &font::ROW_ACTIVE } else { &font::TITLE };
        let width = font.text_width(line);
        let x = (i32::from(PANEL_W) - i32::from(width)) / 2;
        let y = i32::from(PANEL_H) / 2 - 26 + (i as i32) * 13;
        surface.text(font, line, x, y, if i == 0 { Gray8::BLACK } else { Gray8(0x99) });
    }
    surface.pixels().iter().map(|p| p.0).collect()
}

/// A card's icon, loaded from the app's own directory and cached by path./// A card's icon, loaded from the app's own directory and cached by path./// A card's icon, loaded from the app's own directory and cached by path.
///
/// Cached because it is the same handful of 14x14 sprites on every frame, and a
/// scanning app resends its scene several times a second. Loaded as RGBA rather
/// than greyscale so `colorize` has an alpha channel to work with: a card in the
/// dim tone dims its icon too, and the same sprite is drawn white on a dark band.
#[cfg(feature = "slint")]
fn card_icon(
    dir: &std::path::Path,
    name: &str,
    cache: &mut Vec<(std::path::PathBuf, slint::Image)>,
) -> slint::Image {
    if name.is_empty() {
        return slint::Image::default();
    }
    let path = dir.join(name);
    if let Some((_, image)) = cache.iter().find(|(p, _)| *p == path) {
        return image.clone();
    }
    let image = load_rgba(&path).unwrap_or_default();
    // An app with more icons than this is drawing something other than a list.
    if cache.len() >= 16 {
        cache.remove(0);
    }
    cache.push((path, image.clone()));
    image
}

/// One RGBA PNG as a Slint image, or `None` if it will not read.
///
/// A missing or broken icon leaves the card without one rather than taking the
/// app's screen down: the row still says what it is, in words.
#[cfg(feature = "slint")]
fn load_rgba(path: &std::path::Path) -> Option<slint::Image> {
    let file = std::fs::File::open(path).ok()?;
    let decoder = png::Decoder::new(std::io::BufReader::new(file));
    let mut reader = decoder.read_info().ok()?;
    let mut raw = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut raw).ok()?;
    let (w, h) = (info.width, info.height);
    let mut buffer = slint::SharedPixelBuffer::<slint::Rgba8Pixel>::new(w, h);
    let out = buffer.make_mut_slice();
    match info.color_type {
        png::ColorType::Rgba => {
            for (px, chunk) in out.iter_mut().zip(raw.chunks_exact(4)) {
                *px = slint::Rgba8Pixel {
                    r: chunk[0],
                    g: chunk[1],
                    b: chunk[2],
                    a: chunk[3],
                };
            }
        }
        // Greyscale, the format the panel itself speaks: ink is opaque and the
        // ground is transparent, so an icon lifted straight out of a mockup can be
        // colorized like any other.
        png::ColorType::Grayscale => {
            for (px, v) in out.iter_mut().zip(raw.iter()) {
                *px = slint::Rgba8Pixel { r: 0, g: 0, b: 0, a: 255 - *v };
            }
        }
        _ => return None,
    }
    Some(slint::Image::from_rgba8(buffer))
}

/// A placed card, ready for Slint, with its thumbnail as an image.
///
/// The images are cached against the buffer they came from: an animation asks for
/// the same handful thirty times a second, and expanding greyscale to RGB each
/// time would allocate about a megabyte a frame to draw the same pixels.
#[cfg(feature = "slint")]
fn card_of(
    p: &flipper_ui::switcher::Placed,
    cache: &mut Vec<(usize, slint::Image)>,
) -> flipper_ui::ui::SwitchCard {
    use flipper_ui::switcher::Edge;
    use flipper_ui::theme::{PANEL_H, PANEL_W};

    let image = match p.snapshot.as_ref() {
        Some(grey) => {
            let key = std::sync::Arc::as_ptr(grey) as usize;
            if let Some((_, image)) = cache.iter().find(|(k, _)| *k == key) {
                image.clone()
            } else {
                let mut buffer = slint::SharedPixelBuffer::<slint::Rgb8Pixel>::new(
                    u32::from(PANEL_W),
                    u32::from(PANEL_H),
                );
                for (px, v) in buffer.make_mut_slice().iter_mut().zip(grey.iter()) {
                    *px = slint::Rgb8Pixel { r: *v, g: *v, b: *v };
                }
                let image = slint::Image::from_rgb8(buffer);
                // A couple of cards' worth is all that is ever live; anything
                // older belongs to a snapshot nothing points at any more.
                if cache.len() >= 8 {
                    cache.remove(0);
                }
                cache.push((key, image.clone()));
                image
            }
        }
        None => slint::Image::default(),
    };

    flipper_ui::ui::SwitchCard {
        name: p.name.as_str().into(),
        x: p.state.x as f32,
        y: p.state.y as f32,
        w: p.state.w as f32,
        h: p.state.h as f32,
        r_tl: p.state.r_tl as f32,
        r_tr: p.state.r_tr as f32,
        r_bl: p.state.r_bl as f32,
        r_br: p.state.r_br as f32,
        alpha: p.alpha,
        pos_clamped: p.pos_clamped,
        image,
        image_alpha: p.image_alpha,
        img_x: p.img_x as f32,
        img_y: p.img_y as f32,
        tab: p.tab,
        tab_deep: p.tab_deep,
        open_edge: match p.open_edge {
            Edge::None => 0,
            Edge::Top => 1,
            Edge::Bottom => 2,
        },
        label_dx: p.label_dx as f32,
        label_dy: p.label_dy as f32,
        deep: p.deep,
        killing: p.killing,
    }
}

/// Why the current name cannot be used, or an empty string.
///
/// Recomputed on every key, as the prototype's validator is, so the warning and
/// the refusal of Done are always the same verdict.
#[cfg(feature = "slint")]
fn rename_warning(
    input: &flipper_ui::keyboard::TextInput,
    profile: &flipper_ui::boot::Profile,
    existing: &[flipper_ui::boot::Profile],
) -> String {
    let dest = flipper_ui::boot::rename_dest(profile, &input.text);
    if dest.is_empty() {
        return "Name required".into();
    }
    if dest != profile.name && existing.iter().any(|p| p.name == dest) {
        return "Name already exists".into();
    }
    String::new()
}

/// Hand the placed keyboard and the field to Slint.
#[cfg(feature = "slint")]
fn apply_text_input(
    screen: &flipper_ui::ui::Root,
    input: &flipper_ui::keyboard::TextInput,
    warning: &str,
    cursor_on: bool,
) {
    use flipper_ui::keyboard::{self, Focus};
    use flipper_ui::theme::metric::KB_INPUT_PAD;
    let field_w = keyboard::field_w(i32::from(flipper_ui::font::TITLE.text_width(&input.text)));
    let fitted = keyboard::fit_input(
        &input.text,
        input.cursor,
        field_w - 2 * KB_INPUT_PAD,
    );
    let cells: Vec<flipper_ui::ui::KbCell> = input
        .placed()
        .into_iter()
        .map(|c| flipper_ui::ui::KbCell {
            x: c.x as f32,
            y: c.y as f32,
            w: c.w as f32,
            text: c.text.as_str().into(),
            icon: c.icon,
            icon_w: c.icon_w as f32,
            icon_h: c.icon_h as f32,
            selected: c.selected,
            pressed: c.pressed,
            clip_h: c.clip_h as f32,
        })
        .collect();
    let (cx, cy, cw, ch) = input.chrome();

    screen.set_kb_title(input.title.as_str().into());
    screen.set_kb_text(fitted.visible.as_str().into());
    screen.set_kb_field_w(field_w as f32);
    screen.set_kb_cursor_dx(fitted.cursor_dx as f32);
    screen.set_kb_cursor_on(cursor_on);
    screen.set_kb_field_focused(input.focus == Focus::Field);
    screen.set_kb_warning(warning.into());
    screen.set_kb_cells(slint::ModelRc::new(slint::VecModel::from(cells)));
    screen.set_kb_chrome_x(cx as f32);
    screen.set_kb_chrome_y(cy as f32);
    screen.set_kb_chrome_w(cw as f32);
    screen.set_kb_chrome_h(ch as f32);
    screen.set_kb_lang_label(input.layout.label().into());
    screen.set_kb_tab_label(input.layout.tab_label().into());
    screen.set_kb_tab_focus(input.tab_focus());
    screen.set_kb_tab_pressed(input.tab_pressed());
    screen.set_kb_buttons(demo::labels(&["Cancel", "", "", "", "Done"]));
    screen.set_kb_discard(input.discard.map_or(-1, |at| at as i32));
}

/// Start a rename on a thread, the way every other profile action runs.
#[cfg(feature = "slint")]
fn start_rename(name: String, dest: String) -> Popup {
    let (tx, rx) = std::sync::mpsc::channel();
    if std::thread::Builder::new()
        .name("boot-rename".into())
        .spawn(move || {
            let _ = tx.send(flipper_ui::boot::rename(&name, &dest).map(|()| false));
        })
        .is_err()
    {
        return Popup::Said("could not start rename".into());
    }
    Popup::Busy("Renaming".into(), Some(rx))
}

/// Read the profile list on a thread.
///
/// The two sudo tools take 650ms together, which blocked the loop long enough that
/// the press flash sat on screen for the whole read and the menu looked slow to
/// open. Both the menu opening and an action finishing go through here, so the
/// list after a Clone or a Delete is read exactly the way the first one was.
#[cfg(feature = "slint")]
fn start_profiles_read() -> Option<std::sync::mpsc::Receiver<Vec<flipper_ui::boot::Profile>>> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("boot-profiles".into())
        .spawn(move || {
            let _ = tx.send(flipper_ui::boot::profiles());
        })
        .ok()
        .map(|_| rx)
}

/// Start one of the Edit actions on a thread, returning the popup state to show.
///
/// Every one of these shells out to a tool that takes seconds to a minute, so none
/// of them can run on the render loop. The message each reports is the tool's own
/// last line, because that is where these tools put the reason.
#[cfg(feature = "slint")]
fn start_boot_action(
    action: &str,
    profile: Option<flipper_ui::boot::Profile>,
    existing: Vec<flipper_ui::boot::Profile>,
) -> Option<Popup> {
    use flipper_ui::boot;

    let p = profile?;
    let (busy, work): (&str, Box<dyn FnOnce() -> Result<bool, String> + Send>) = match action {
        "Auto Start" => (
            "Saving",
            Box::new(move || boot::set_auto_start(&p.id).map(|_| false)),
        ),
        "Clone" => {
            let dest = boot::clone_dest(&p, &existing);
            (
                "Cloning",
                Box::new(move || boot::clone(&p.name, &dest).map(|_| false)),
            )
        }
        "Delete" => (
            "Deleting",
            Box::new(move || boot::delete(&p.name).map(|_| false)),
        ),
        // The one action that can answer "and now the device has to reboot": the
        // running root is the copy moved aside, so the fresh one is only reachable
        // through a reboot.
        "Factory Reset" => (
            "Resetting",
            Box::new(move || boot::factory_reset(&p.name, &p.origin)),
        ),
        // Rename is not started here: it needs a name first, so the caller opens
        // the keyboard and starts the action when that comes back.
        _ => return Some(Popup::Edit),
    };

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("boot-action".into())
        .spawn(move || {
            let _ = tx.send(work());
        })
        .ok()?;
    Some(Popup::Busy(busy.to_string(), Some(rx)))
}

/// Read the selected profile's disk space on a thread.
///
/// btrfs-show-space measures every subvolume with du and compsize, which takes
/// tens of seconds, so the popup opens with the line blank and fills it in.
#[cfg(feature = "slint")]
/// Start the popup's two reads.
///
/// Separate threads on purpose. The overlays are a directory listing and land at
/// once; the space measurement runs du and compsize over every subvolume and takes
/// about a minute. Sharing a thread would hold the instant one behind the slow one,
/// so both lines would sit on the spinner for the whole minute.
#[cfg(feature = "slint")]
fn spawn_popup_reads(
    profiles: &[flipper_ui::boot::Profile],
    selected: i32,
) -> (
    Option<std::sync::mpsc::Receiver<Option<flipper_ui::boot::Space>>>,
    Option<std::sync::mpsc::Receiver<(Vec<String>, Vec<String>)>>,
) {
    let Some(name) = profiles.get(selected as usize).map(|p| p.name.clone()) else {
        return (None, None);
    };

    let (space_tx, space_rx) = std::sync::mpsc::channel();
    let for_space = name.clone();
    let space = std::thread::Builder::new()
        .name("boot-space".into())
        .spawn(move || {
            let _ = space_tx.send(flipper_ui::boot::space(&for_space));
        })
        .ok()
        .map(|_| space_rx);

    let (dtbo_tx, dtbo_rx) = std::sync::mpsc::channel();
    let dtbo = std::thread::Builder::new()
        .name("boot-dtbo".into())
        .spawn(move || {
            let _ = dtbo_tx.send(flipper_ui::boot::dtbo(&name));
        })
        .ok()
        .map(|_| dtbo_rx);

    (space, dtbo)
}

/// The package names, wrapped to lines that fit the dialog.
///
/// Measured against the frame's inner width with the real advance table, because a
/// character count either overflows or wastes room: HaxrCorp is not fixed pitch.
/// At most three lines, so the dialog cannot grow past its frame; anything beyond
/// that is summarised.
#[cfg(feature = "slint")]
fn dialog_wrap(apt: &[String], pip: &[String]) -> Vec<String> {
    use flipper_ui::font::TITLE;
    use flipper_ui::theme::metric::{MODAL_W, PAD_LEFT};

    const MAX_LINES: usize = 3;
    let budget = (MODAL_W - 2 * PAD_LEFT) as u16;
    // pip packages are marked, because "requests" from pip and from apt are not
    // the same thing and the user is being asked to approve one of them.
    let names: Vec<String> = apt
        .iter()
        .cloned()
        .chain(pip.iter().map(|p| format!("{p} (pip)")))
        .collect();

    let mut lines: Vec<String> = Vec::new();
    for name in &names {
        match lines.last_mut() {
            Some(last) if TITLE.text_width(&format!("{last} {name}")) <= budget => {
                last.push(' ');
                last.push_str(name);
            }
            _ => {
                if lines.len() == MAX_LINES {
                    let shown: usize = lines.iter().map(|l| l.split(' ').count()).sum();
                    let rest = names.len() - shown;
                    let last = lines.last_mut().expect("MAX_LINES > 0");
                    *last = format!("{} and {rest} more", last);
                    break;
                }
                lines.push(name.clone());
            }
        }
    }
    lines
}

/// Show a list of apps, or an app's own form, on the shared list body.
#[cfg(feature = "slint")]
fn apply_app_list(
    screen: &flipper_ui::ui::Root,
    rows: &[flipper_ui::app::Row],
    selected: i32,
    buttons: &[String],
    // Real extent of the app's buffer and where the sent rows sit in it, for the
    // scrollbar. Equal to the row count and zero when the caller sends everything.
    bar: (i32, i32),
    // First visible row. The app list owns every row so it scrolls here; an app's
    // own form windows its rows before sending them, so it passes 0.
    scroll: i32,
) {
    let items: Vec<flipper_ui::ui::ListItem> = rows
        .iter()
        .map(|row| {
            // A value the app wrapped in chevrons asks for the adjust control, the
            // same way a menu row does.
            let (chevrons, inner) = demo::chevrons_of(&row.value);
            let (at_start, at_end) = (row.at_start, row.at_end);
            flipper_ui::ui::ListItem {
                label: row.label.as_str().into(),
                status: row.value.as_str().into(),
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
    // A caller that windows its own rows sends the real extent and where the window
    // sits; one that sends everything and scrolls here has to hand the scroll over
    // as the bar's offset, or the thumb sits at the top while the rows move.
    let owns_window = bar.0 > 0;
    screen.set_app_bar_total(if owns_window { bar.0 } else { items.len() as i32 });
    screen.set_app_bar_offset(if owns_window { bar.1 } else { scroll });
    screen.set_app_scroll(scroll);
    screen.set_app_selected(selected);
    screen.set_app_items(slint::ModelRc::new(slint::VecModel::from(items)));
    screen.set_app_buttons(slint::ModelRc::new(slint::VecModel::from(
        buttons
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
            screen.set_detail_buttons(demo::labels(&open.buttons(&applying)));
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
    wayland: bool,
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
    } else if wayland {
        #[cfg(feature = "wayland")]
        {
            let sink = flipper_ui::wl_sink::WlSink::new(PANEL_W, PANEL_H)?;
            eprintln!("surface        {PANEL_W}x{PANEL_H} on the compositor");
            Some(PanelOut::Wl(sink))
        }
        #[cfg(not(feature = "wayland"))]
        return Err(std::io::Error::other("rebuild with --features wayland"));
    } else {
        let sink = KmsSink::open(kms_device.map(std::path::Path::new))?;
        let (w, h) = sink.size();
        if (w, h) != (PANEL_W, PANEL_H) {
            return Err(std::io::Error::other(format!(
                "panel reports {w}x{h}, this build is compiled for {PANEL_W}x{PANEL_H}"
            )));
        }
        Some(PanelOut::Kms(sink))
    };
    // Buttons are left alone in headless mode: whoever owns the panel owns them
    // too, and two readers both reacting would be confusing.
    // Under a compositor the keys come with the frames: it holds the input devices
    // and hands us key events on the same connection, so reading evdev as well would
    // be two readers of one press.
    let mut input = if headless || wayland {
        None
    } else {
        Some(EvdevSource::open()?)
    };

    // The browser view is a second sink over the same frames and a second source
    // of the same key events, so nothing downstream can tell a remote click from
    // a finger.
    #[cfg(feature = "remote")]
    let assets_dir: std::path::PathBuf = assets
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| "crates/flipper-ui/assets/remote".into());
    #[cfg(feature = "remote")]
    let mut web = match remote.clone() {
        Some(addr) => {
            let dir = assets_dir.clone();
            // A port that is already taken must not cost the panel. It happened
            // repeatedly during development: a forgotten instance held 9999, every
            // start after that died here, and the panel went black with the real
            // fault three layers away. The browser view is a convenience; the panel
            // is the product.
            match flipper_ui::remote::RemoteView::bind_with_peer(&addr, dir, peer.clone()) {
                Ok(view) => {
                    eprintln!("remote view    http://{}/", view.addr());
                    if peer.is_some() {
                        eprintln!("comparison     /diff");
                    }
                    Some(view)
                }
                Err(e) => {
                    // Retried below rather than given up on. Not serving is worse
                    // than it looks: the compositor hands Back and the app switcher
                    // to flipctl through this endpoint, so without it those two keys
                    // stop working while everything else carries on, which reads as
                    // a UI bug rather than a bind that failed minutes earlier.
                    eprintln!("remote view    not serving on {addr} yet: {e}");
                    None
                }
            }
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
    // Re-read whenever the Apps screen opens, so an app copied onto the device
    // shows up without restarting this. Discovery is a directory listing and a
    // manifest scan per app, which is nothing next to opening a menu.
    let apps_dir = std::path::PathBuf::from("apps");
    let mut apps = flipper_ui::app::discover(&apps_dir);
    eprintln!(
        "apps           {} found: {:?}",
        apps.len(),
        apps.iter().map(|a| &a.name).collect::<Vec<_>>()
    );
    let mut app_selected = 0i32;
    // First visible row of the app list. More apps than the viewport holds means
    // the list scrolls and shows a bar, exactly as the menu does.
    let mut app_scroll = 0i32;
    // The apps that are alive. More than one can be: switching away leaves an app
    // running and its output still drained, so coming back shows what it is doing
    // now rather than the thumbnail it left behind. Only the focused one is sent
    // keys and only its scene reaches the screen.
    let mut apps_live: Vec<(String, flipper_ui::RunningApp)> = Vec::new();
    let mut focused_app: Option<usize> = None;
    // The switcher's own stack, which outlives any one switcher session, and the
    // session itself while it is open.
    let mut recents = flipper_ui::switcher::Recents::default();
    let mut switcher: Option<flipper_ui::switcher::Switcher> = None;

    // Snapshots turned into images, keyed by the buffer they came from: an
    // animation asks for the same four images thirty times a second, and building
    // them each time would allocate a megabyte a frame for nothing.
    let mut card_images: Vec<(usize, slint::Image)> = Vec::new();
    // A cards scene's icons, by path. Separate from the switcher's thumbnails
    // above: those are keyed on the buffer they came from and die with it, these
    // are files that outlive any one frame.
    let mut card_icons: Vec<(std::path::PathBuf, slint::Image)> = Vec::new();
    // The console apps that are running, each on a VT of its own, and which of them
    // has the panel. Backgrounded one keeps running, unaware, because an inactive
    // VT is not drawn and a console cannot paint while flipctl is DRM master. Two
    // of them therefore swap with a single VT switch and no change of panel owner.
    let mut consoles: Vec<flipper_ui::console::Session> = Vec::new();
    let mut console_front: Option<usize> = None;
    // One virtual keyboard for all of them, opened with the first session and
    // dropped with the last. Per session it would be several, and every app that
    // reads evdev would see all of them, which is every app that draws its own
    // pixels: an offscreen toolkit has no platform to read a keyboard from.
    let mut console_keys: Option<flipper_ui::console::Keyboard> = None;
    // The screen the deck was opened over, to go back to when it is dismissed.
    // Leaving always landed on the menu, which is a level above the Apps list and so
    // not where the user was: dismissing a deck should undo opening it and nothing
    // else.
    // The screen an app was started from, which is where Back goes: from an app, or
    // from the deck opened over it. Never the deck itself, which is not a place the
    // user was.
    let mut before_switcher = Screen::Menu;
    let mut launched_from = Screen::Apps;
    // When this turn of the loop began, for the watchdog below.
    let mut turn = Instant::now();
    // A key whose release belongs to nobody: the one that opened the deck.
    //
    // The deck acts on releases, so the release of the very press that opened it
    // was arriving as "choose the focused card", and one Tab both opened the deck
    // and relaunched what was already in front. Every complaint today about the
    // switcher hanging or landing in the wrong place came from that.
    let mut swallow_release: Option<FlipperKey> = None;
    // When its picture was last read back, for the browser view and its card, and
    // whether the standing notice has been sent for one that cannot be read.
    let mut console_mirror = Instant::now();
    let mut console_notice = false;
    // Where a cards page's window sits. Kept here rather than in the app for the
    // reason the detail body's offset is: the app does not know how much fits.
    let mut app_cards_scroll = 0i32;
    // Where the busy marker on a cards page counts from, and when it last moved.
    let slide_at = Instant::now();
    let mut slide_shown = Instant::now();

    // Whether the switcher's cards need handing over again. Slint compares a
    // scalar but not a model, so a fresh model every pass marks the whole window
    // dirty every pass: opening the switcher pinned the panel at its frame cap
    // and 18% of a core while nothing moved.
    let mut switch_dirty = false;

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
        lines: Vec<String>,
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
        InstallDeps,
    }
    let mut dialog: Option<Dialog> = None;
    // What was last pushed to the window, so an unchanged dialog is not pushed
    // again. See the note at the push site.
    // The dialog as it was last handed over, plus whether the switcher was up:
    // the cards hide it, and closing them has to put it back.
    // The dialog as it was last handed over, plus whether anything is covering
    // it: the switcher's cards, or an app in front. Both hide the question
    // without answering it, and uncovering has to bring it back.
    let mut last_dialog: (bool, Option<(Vec<String>, &'static str, &'static str)>) =
        (false, None);

    // Which chevron of a selected toggle row is flashing, and until when.
    let mut arrow: Option<(i32, Instant)> = None;

    // The open detail screen and its poller, or None on a menu. Dropping this is
    // the equivalent of the prototype's `exit()`: the polling thread stops.
    let mut live: Option<detail::Live> = None;
    let mut detail_offset = 0i32;
    // Installing an app's dependencies.
    //
    // Three stages, each off the render loop because dpkg-query, apt and pip all
    // block for a long time: a check when the app is opened, a dialog asking the
    // user, then the install itself with its output on a log screen.
    enum Deps {
        /// A check is running for the app at this index.
        Checking(i32, std::sync::mpsc::Receiver<flipper_ui::app::Missing>),
        /// The dialog is up, waiting for an answer.
        Asking(i32, flipper_ui::app::Missing),
        /// Installing, with output arriving and a result at the end.
        Installing(
            i32,
            std::sync::mpsc::Receiver<String>,
            std::sync::mpsc::Receiver<Result<(), String>>,
        ),
        /// Finished, with the log left on screen.
        Done(i32, Result<(), String>),
    }
    let mut deps: Option<Deps> = None;
    let mut deps_log: Vec<String> = Vec::new();
    let mut deps_offset = 0i32;
    // Stick to the tail while output arrives, until the user scrolls back. Same
    // behaviour as an app's own log: watch it live, or read what went past.
    let mut deps_follow = true;

    // The boot menu.
    //
    // The countdown starts when the profiles have been read, not when the screen
    // opens: counting down to boot something not yet listed would be a race. Any
    // key cancels it, because a person pressing buttons is not waiting for the
    // default to be chosen for them.
    let mut boot_profiles: Vec<flipper_ui::boot::Profile> = Vec::new();
    let mut boot_selected = 0i32;
    let mut boot_scroll = 0i32;
    let mut boot_started: Option<Instant> = None;
    // Where the load spinner counts its frames from.
    let boot_spin_at = Instant::now();
    let mut boot_cancelled = false;
    // The last countdown percentage pushed, so the rows are rebuilt when the bar
    // moves and not on every iteration.
    let mut boot_last_shown = -2i32;
    // The profile read in flight, if any.
    let mut boot_pending: Option<std::sync::mpsc::Receiver<Vec<flipper_ui::boot::Profile>>> = None;

    let mut popup: Option<Popup> = None;
    let mut popup_index = 0usize;
    // The text-input screen, open only while something is being named. It carries
    // the profile it will rename, because the list can be re-read while it is up.
    let mut kb: Option<flipper_ui::keyboard::TextInput> = None;
    let mut kb_profile = flipper_ui::boot::Profile::default();
    let mut kb_dirty = false;
    let mut kb_cursor_shown = false;
    // Where an app's detail screen is scrolled to, and how many rows its last
    // scene had. The server owns scrolling: an app describes its rows and never
    // has to implement a viewport, which is also why Up and Down are not
    // forwarded to it on that screen.
    // Set when an app has just been brought forward: its own last scene is put
    // back at once. Waiting for the next one leaves the app list on screen for as
    // long as the app has nothing new to say, which for an app sitting on a form
    // is forever.
    let mut redraw_app = false;
    // When the card in front was last photographed. Cards are refreshed as the
    // user works, not only when they switch away, so opening the switcher shows
    // what each app is doing now rather than what it was doing when it lost focus.
    let mut card_stash = Instant::now();
    // The app a pending question belongs to, by name. Its card is what the user is
    // looking at while the question is up.
    macro_rules! pending_app {
        () => {
            match deps.as_ref() {
                Some(
                    Deps::Checking(i, _)
                    | Deps::Asking(i, _)
                    | Deps::Installing(i, ..)
                    | Deps::Done(i, _),
                ) => apps.get(*i as usize).map(|a| a.name.as_str()),
                None => None,
            }
        };
    }
    let mut app_detail_offset = 0i32;
    let mut app_detail_rows = 0i32;
    // Space and overlays for the selected profile, read on a thread because
    // btrfs-show-space measures every subvolume.
    let mut popup_space: Option<flipper_ui::boot::Space> = None;
    // Whether the read has come back at all, which is not the same as it having
    // found something: btrfs-show-space refuses some subvolume names it lists in
    // its own whole-filesystem report. Without this the spinner cannot tell "still
    // measuring" from "measured, no answer" and spins forever.
    let mut popup_space_done = false;
    let mut popup_space_rx: Option<std::sync::mpsc::Receiver<Option<flipper_ui::boot::Space>>> = None;
    let mut popup_dtbo_rx: Option<std::sync::mpsc::Receiver<(Vec<String>, Vec<String>)>> = None;
    let mut popup_dirty = false;
    // Overlays for the selected profile, read with the space.
    let mut popup_dtbo: Option<(Vec<String>, Vec<String>)> = None;
    // Drives the "-\|/" frames while a value is still being read.
    let spin_at = Instant::now();
    // When the spinner frame was last pushed, so it advances on its own.
    let mut spin_shown = Instant::now();

    /// How long the boot menu waits before starting the default.
    const BOOT_TIMEOUT: Duration = Duration::from_secs(5);

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
    /// A press that is shown before it is acted on.
    ///
    /// The prototype does this with `btn.press()` and a 30ms timer that calls
    /// `release()` and only then the handler, so the inverted state is always drawn
    /// at least once. Two halves have to agree: what renders as pressed, and when
    /// the action fires.
    ///
    /// Owned here rather than by the components, which stay pure functions of a
    /// `pressed` flag, because the action is on this side: opening a submenu,
    /// spawning an app, starting a dependency check. Slint could own the animation
    /// but not the deferral, and the loop repaints only when something changed, so
    /// it would have to know about the flash anyway.
    ///
    /// Owned in one place rather than per screen because the wiring was four
    /// copies of the same three assignments, and the app list shipped without one:
    /// its rows never inverted, and what looked like a flash was the menu's own,
    /// still running as the screen changed.
    #[derive(Default)]
    struct Flash {
        until: Option<Instant>,
        key: Option<FlipperKey>,
        /// Which soft slot inverts, when the press was a soft key rather than a
        /// row. `None` means the selected row inverts instead.
        slot: Option<usize>,
        /// True when the flash belongs to a dialog's buttons, which are drawn by
        /// the dialog rather than the screen underneath.
        dialog: bool,
    }

    impl Flash {
        /// Flash the selected row, then act.
        fn row(&mut self, key: FlipperKey, now: Instant) {
            *self = Flash { until: Some(now), key: Some(key), slot: None, dialog: false };
        }
        /// Flash one soft-key slot, then act.
        fn soft(&mut self, key: FlipperKey, slot: usize, now: Instant) {
            *self = Flash { until: Some(now), key: Some(key), slot: Some(slot), dialog: false };
        }
        /// Flash one slot and act on nothing: the key has already been handled
        /// elsewhere, which is the case for a key an app owns.
        fn only(&mut self, slot: usize, now: Instant) {
            *self = Flash { until: Some(now), key: None, slot: Some(slot), dialog: false };
        }
        /// Flash one of a dialog's buttons, then act.
        fn button(&mut self, key: FlipperKey, slot: usize, now: Instant) {
            *self = Flash { until: Some(now), key: Some(key), slot: Some(slot), dialog: true };
        }
        /// Drop a flash without acting on it, for a screen change that has already
        /// happened.
        fn cancel(&mut self) {
            *self = Flash::default();
        }
        fn showing(&self) -> bool {
            self.until.is_some()
        }
        /// The selected row inverts only for a row press.
        fn row_pressed(&self) -> bool {
            self.showing() && self.slot.is_none()
        }
        /// The slot to invert on a screen's own soft bar, or -1.
        fn soft_slot(&self) -> i32 {
            match self.slot {
                Some(i) if !self.dialog => i as i32,
                _ => -1,
            }
        }
        /// The slot to invert on a dialog's buttons, or -1.
        fn dialog_slot(&self) -> i32 {
            match self.slot {
                Some(i) if self.dialog => i as i32,
                _ => -1,
            }
        }
        /// Once the flash has been seen, the key to act on and the slot it was.
        fn expired(&mut self, now: Instant) -> Option<(FlipperKey, Option<usize>)> {
            if self.until.is_some_and(|until| now >= until) {
                let taken = std::mem::take(self);
                return taken.key.map(|k| (k, taken.slot));
            }
            None
        }
    }

    let flash = Duration::from_millis(timing::PRESS_FLASH_MS as u64);
    let mut press = Flash::default();
    // Which soft slot is showing its pressed state, and what to do when the flash
    // ends. The prototype flashes first and acts after: `btn.press()`, then a 30ms
    // timer calls `release()` and the handler. Acting immediately would switch the
    // screen before the inverted button was ever drawn.
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
    // The browser view's presses, kept apart only so a console app in front can tell
    // them from the buttons: those it has to be handed, these the kernel has already
    // delivered. Everywhere else the two are the same thing and are read together.
    let mut pending_remote: Vec<flipper_ui::KeyEvent> = Vec::new();
    let keylog = std::env::var_os("FLIPCTL_KEYLOG").is_some();
    // Apps hosted by the compositor, and which of them is in front. The IPC
    // connection is opened once and kept: a switch should cost one write.
    #[cfg(feature = "wayland")]
    let mut wl_apps: Vec<WlApp> = Vec::new();
    #[cfg(feature = "wayland")]
    let mut wl_front: Option<u32> = None;
    // When the front app was launched, so an app that never manages to put a window
    // on its workspace gives the panel back rather than holding it dark.
    #[cfg(feature = "wayland")]
    let mut wl_since = Instant::now();
    // The panel as the compositor sees it, which is our own surface when nothing is
    // in front and the app's when one is. Attached lazily, because reading the output
    // is only worth doing while a browser view or the deck is watching.
    #[cfg(feature = "wayland")]
    let mut mirror: Option<flipper_ui::wl::Mirror> = None;
    #[cfg(feature = "wayland")]
    let mut mirrored = Instant::now();
    // When the front app's card was last refreshed. Once a second while it is in
    // front, so the deck shows what it looked like a moment ago rather than
    // whenever it was last left.
    #[cfg(feature = "wayland")]
    let mut carded = Instant::now();
    #[cfg(feature = "remote")]
    let mut rebind = Instant::now();
    #[cfg(feature = "wayland")]
    let mut sway = if wayland {
        match flipper_ui::sway::Sway::connect() {
            Ok(s) => {
                eprintln!("compositor     talking to sway");
                Some(s)
            }
            Err(e) => {
                eprintln!("compositor     no IPC ({e}); apps cannot be hosted");
                None
            }
        }
    } else {
        None
    };

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
                // Kept apart from the buttons until the console block has had them:
                // a simulated press has reached nothing yet, where a real one has
                // already been delivered to the VT by the kernel.
                pending_remote.push(event);
            }
        }
        if let Some(sink) = sink.as_mut() {
            while let Some(event) = sink.poll_key() {
                pending_input.push(event);
            }
        }
        if let Some(input) = input.as_mut() {
            while let Some(event) = input.poll() {
                pending_input.push(event);
            }
        }

        // A console app in front takes the keys first, and takes most of them: the
        // pad and its centre go to the program, and three of ours stay ours. Esc
        // ends it, Back leaves it running and goes back to the list, and Tab does
        // the same and opens the deck. Nothing here waits on a button being held.
        if let Some(at) = console_front {
            let mut end = false;
            let mut leave = None;
            // Simulated presses are put into the input core, where the kernel
            // delivers them to the VT exactly as it delivers a real one. Physical
            // presses are not: the kernel has already given them to the VT, and
            // forwarding those as well made every pad press act twice.
            for event in pending_remote.drain(..) {
                let forwarded = console_keys
                    .as_mut()
                    .is_some_and(|k| k.forward(event).unwrap_or(false));
                if forwarded {
                    continue;
                }
                if event.down {
                    match event.key {
                        FlipperKey::Escape => end = true,
                        FlipperKey::Back => leave = Some(false),
                        FlipperKey::AppSwitch => leave = Some(true),
                        _ => {}
                    }
                }
            }
            for event in pending_input.drain(..) {
                if !event.down {
                    continue;
                }
                match event.key {
                    FlipperKey::Escape => end = true,
                    FlipperKey::Back => leave = Some(false),
                    FlipperKey::AppSwitch => leave = Some(true),
                    _ => {}
                }
            }

            // Its picture, for the browser view and for the card it leaves behind.
            // Ten a second, which is the view's own cap.
            if console_mirror.elapsed() >= Duration::from_millis(100) {
                console_mirror = Instant::now();
                let grey = if consoles[at].mirrored() {
                    consoles[at].frame().map(|f| f.to_vec())
                } else {
                    // Nothing to read: this one draws through KMS, where flipctl
                    // cannot see. Say that, once, rather than leaving whatever
                    // frame was last in the framebuffer to be mistaken for it.
                    (!console_notice).then(|| {
                        console_notice = true;
                        detached_notice(&consoles[at].name)
                    })
                };
                if let Some(grey) = grey {
                    let grey = grey.as_slice();
                    let snapshot = std::sync::Arc::new(grey.to_vec());

                    #[cfg(feature = "remote")]
                    {
                        let pixels: Vec<flipper_ui::Gray8> =
                            grey.iter().map(|v| flipper_ui::Gray8(*v)).collect();
                        if let Some(view) = web.as_mut() {
                            view.commit(
                                Frame::new(&pixels, PANEL_W, PANEL_H),
                                flipper_ui::Rect::new(0, 0, PANEL_W, PANEL_H),
                            )?;
                        }
                    }
                    let name = consoles[at].name.clone();
                    recents.snapshot(&name, snapshot);
                }
            }

            // Ended by itself, or ended by Esc: either way the card goes with it.
            let over = consoles[at].finished().is_some();
            if end || over {
                let mut session = consoles.remove(at);
                if !over {
                    session.stop();
                }
                let name = session.name.clone();
                eprintln!("console        {name} ended");
                // Dropped before the panel is taken back, and the order matters:
                // dropping a session switches VT, and a VT switch makes the console
                // claim the display. Done afterwards it would take the panel
                // straight back off us, leaving flipctl drawing into a framebuffer
                // nothing is showing and the app's last frame on the screen.
                drop(session);
                recents.close(&name);
                if let Some(sw) = switcher.as_mut() {
                    sw.drop_card(&name);
                }
                eprintln!("console        front is nobody (ended)");
                console_front = None;
                console_notice = false;
                if consoles.is_empty() {
                    console_keys = None;
                }
                redraw_app = true;
            } else if let Some(deck) = leave {
                // Put away rather than ended: its console stops pointing at the
                // panel's framebuffer, and if it paints pixels it is frozen, since
                // nothing else can stop it writing there. Its card brings it back.
                if let Err(e) = consoles[at].background() {
                    eprintln!("console        not put away: {e}");
                }
                eprintln!(
                    "console        front is nobody ({})",
                    if deck { "tab" } else { "back" }
                );
                console_front = None;
                console_notice = false;
                if deck {
                    swallow_release = Some(FlipperKey::AppSwitch);
                    switcher = Some(flipper_ui::switcher::Switcher::open(&recents, true));
                    switch_dirty = true;
                    screen.set_screen(Screen::Switcher);
                } else {
                    // Back from an app lands where it was started from.
                    screen.set_screen(launched_from);
                }
                redraw_app = true;
            }

            if console_front.is_some() {
                // The panel is not ours to draw on, so the rest of the loop has
                // nothing to do but keep the pipes clear.
                for (_, app) in apps_live.iter_mut() {
                    app.poll();
                }
                std::thread::sleep(Duration::from_millis(30));
                continue;
            }
        }

        // How long the last turn of the loop took. A frame is a few milliseconds and
        // a sleep is eight, so anything above a quarter of a second is something
        // waiting on the world, and knowing whether the loop is slow or stopped is
        // the difference between a bug in here and a blocking call.
        if turn.elapsed() > Duration::from_millis(250) {
            eprintln!("loop           turn took {}ms", turn.elapsed().as_millis());
        }
        turn = Instant::now();

        // The panel has an owner, and when no console app is in front that owner is
        // flipctl. Checked here rather than remembered at every path that puts one
        // away, because forgetting once is silent: rendering carries on into a
        // framebuffer nothing is showing, no call fails, and the device looks dead.
        if console_front.is_none() {
            if let Some(sink) = sink.as_mut() {
                if sink.is_detached() {
                    eprintln!(
                        "panel          taking it back, {} session(s) running",
                        consoles.len()
                    );
                    if let Err(e) = sink.attach() {
                        eprintln!("panel          not taken back: {e}");
                    }
                    // And redrawn, because Slint reports damage only when something
                    // it knows about changed. Somebody else drew on the panel while
                    // it was theirs, so every pixel is stale even though our own
                    // screen has not moved. Without this the panel keeps the app's
                    // last frame until a key happens to change something, which is
                    // exactly "I pressed Back and it still shows mc", and "the first
                    // Back did nothing, the second worked".
                    window.request_redraw();
                }
            }
        }

        // An app hosted by the compositor has the keyboard while it is in front, so
        // the only presses that arrive here are the two sway is configured to keep
        // for us. That is the whole of the forwarding policy now: no allowlist, no
        // held-key rules, no deciding whether the kernel already delivered a press.
        #[cfg(feature = "wayland")]
        if let Some(ws) = wl_front {
            let mut leave = None;
            // A physical press reaches the app through the compositor without us:
            // it has the keyboard, we do not. A simulated one arrives here instead,
            // so it has to be put back on the wire as a virtual keyboard on the same
            // seat, or the browser view can drive our own screens and nothing else.
            let simulated: Vec<flipper_ui::KeyEvent> = pending_remote.clone();
            for event in &simulated {
                if matches!(event.key, FlipperKey::Back | FlipperKey::AppSwitch) {
                    continue;
                }
                let sent = sink
                    .as_mut()
                    .is_some_and(|s| s.inject(event.key.to_evdev(), event.down));
                if keylog {
                    eprintln!(
                        "key            {:?} down={} injected={sent}",
                        event.key, event.down
                    );
                }
            }
            for event in pending_input.drain(..).chain(pending_remote.drain(..)) {
                if keylog {
                    eprintln!(
                        "key            {:?} down={} taken by the app in front (ws {ws})",
                        event.key, event.down
                    );
                }
                if !event.down {
                    continue;
                }
                match event.key {
                    FlipperKey::Back => leave = Some(false),
                    FlipperKey::AppSwitch => leave = Some(true),
                    _ => {}
                }
            }

            // A window that wants its own size gets it once it exists. Tried on every
            // turn until it takes, because at launch there is no window to shape and
            // the app decides when there is.
            if let Some((want_w, want_h)) = wl_apps
                .iter()
                .find(|a| a.workspace == ws && !a.shaped && a.size.is_some())
                .and_then(|a| a.size)
            {
                let ready = sway
                    .as_mut()
                    .and_then(|s| s.occupied(ws).ok())
                    .unwrap_or(false);
                if ready {
                    let done = sway
                        .as_mut()
                        .and_then(|s| s.shape(ws, want_w, want_h).ok())
                        .unwrap_or(false);
                    if done {
                        eprintln!("app            window on workspace {ws} held at {want_w}x{want_h}");
                        if let Some(app) = wl_apps.iter_mut().find(|a| a.workspace == ws) {
                            app.shaped = true;
                        }
                    }
                }
            }

            // The card, kept current while the app is the thing on the output. It
            // cannot be done from the deck: screencopy captures an output, not a
            // window, and there is one output, so while the deck is showing the
            // output *is* the deck. A second old is as fresh as this can honestly
            // be.
            #[cfg(feature = "remote")]
            if carded.elapsed() >= Duration::from_secs(1) {
                carded = Instant::now();
                if let Some(name) = wl_apps
                    .iter()
                    .find(|a| a.workspace == ws)
                    .map(|a| a.name.clone())
                {
                    if mirror.is_none() {
                        mirror = flipper_ui::wl::Mirror::attach(
                            u32::from(PANEL_W),
                            u32::from(PANEL_H),
                        )
                        .ok();
                    }
                    if let Some(seen) = mirror
                        .as_mut()
                        .and_then(|m| m.frame(Duration::from_millis(120)).ok().flatten())
                    {
                        recents.snapshot(&name, std::sync::Arc::new(seen.to_vec()));
                        switch_dirty = true;
                    }
                }
            }

            // An app that has exited, or one that never showed a window, must not
            // keep the panel: the compositor would go on showing an empty workspace
            // and the only way out would be a key the user has no reason to press.
            let gone = !wl_apps.iter().any(|a| a.workspace == ws);
            // Only for an app whose process is still alive but has put nothing on
            // screen, and only while it is starting: a wrong answer from the
            // compositor must not be able to take the panel from a running app,
            // which is exactly what happened when the occupancy check was reading
            // the tree wrongly. Ten seconds after launch, then never again.
            let starting = wl_since.elapsed() > Duration::from_secs(10)
                && wl_since.elapsed() < Duration::from_secs(30);
            let silent = starting
                && sway
                    .as_mut()
                    .and_then(|s| s.occupied(ws).ok())
                    .is_some_and(|busy| !busy);
            if gone || silent {
                // Both cases used to be silent, which made "the panel came back on
                // its own" impossible to explain and let a second copy of an app be
                // started as though the first had never existed.
                if gone {
                    eprintln!("app            no app left on workspace {ws}, giving the panel back");
                } else {
                    eprintln!("app            nothing on workspace {ws} after 10s, giving the panel back");
                }
                if let Some(sway) = sway.as_mut() {
                    let _ = sway.scale(1.0);
                    let _ = sway.show(flipper_ui::sway::HOME);
                }
                wl_front = None;
                screen.set_screen(launched_from);
                window.request_redraw();
            }

            if let Some(deck) = leave {
                // The card wants the app's last frame, and the app's pixels are the
                // compositor's to give: our own frame is our UI, which is not what
                // was on the panel. Grabbed before switching away, while it is still
                // the thing on the output.
                #[cfg(feature = "remote")]
                if let Some(name) = wl_apps
                    .iter()
                    .find(|a| a.workspace == ws)
                    .map(|a| a.name.clone())
                {
                    if mirror.is_none() {
                        mirror = flipper_ui::wl::Mirror::attach(
                            u32::from(PANEL_W),
                            u32::from(PANEL_H),
                        )
                        .ok();
                    }
                    if let Some(seen) = mirror
                        .as_mut()
                        .and_then(|m| m.frame(Duration::from_millis(300)).ok().flatten())
                    {
                        recents.snapshot(&name, std::sync::Arc::new(seen.to_vec()));
                    }
                }
                if let Some(sway) = sway.as_mut() {
                    // Our own UI is drawn for this panel and no other, so the scale
                    // goes back with the app.
                    let _ = sway.scale(1.0);
                    let _ = sway.show(flipper_ui::sway::HOME);
                }
                // Left running, not stopped: an app in the background is the point
                // of a switcher, and its workspace holds its window until the card
                // is killed.
                let name = wl_apps
                    .iter()
                    .find(|a| a.workspace == ws)
                    .map(|a| a.name.clone())
                    .unwrap_or_default();
                eprintln!("app            {name} to the background");
                wl_front = None;
                window.request_redraw();
                if deck {
                    // The deck opens over the screen the app was started from, not
                    // over the app: Back from the deck is the way out, and it must
                    // not land back inside what it was opened over.
                    before_switcher = launched_from;
                    swallow_release = Some(FlipperKey::AppSwitch);
                    switcher = Some(flipper_ui::switcher::Switcher::open(&recents, true));
                    switch_dirty = true;
                    screen.set_screen(Screen::Switcher);
                } else {
                    // Back from an app lands where it was started from, the same as
                    // it does for every other kind.
                    screen.set_screen(launched_from);
                }
            }
            // Reap anything that exited on its own, so its workspace can be reused
            // and its card stops claiming it is running.
            wl_apps.retain_mut(|a| match a.child.try_wait() {
                Ok(Some(status)) => {
                    eprintln!("app            {} exited ({status})", a.name);
                    false
                }
                Err(e) => {
                    eprintln!("app            {} cannot be waited on: {e}", a.name);
                    true
                }
                Ok(None) => true,
            });
            // Deliberately no `continue`: our own surface is on another workspace,
            // so drawing it costs the panel nothing and keeps the status, the clock
            // and the browser view alive while an app is in front. Skipping the rest
            // of the loop is how the console kind had to work, and it is why a
            // failed launch used to freeze the panel with no way back.
        }

        // Nothing of ours can tell a simulated press from a real one, and nothing of
        // ours should: only the console block cares, because only it has to decide
        // whether the kernel has already delivered the key.
        pending_input.append(&mut pending_remote);

        for event in pending_input.drain(..) {
            // Every key, with the state that decides what happens to it. Behind an
            // environment variable because it is one line per press and the useful
            // question is always "did this reach us at all, and what were we
            // showing": FLIPCTL_KEYLOG=1.
            if keylog {
                eprintln!(
                    "key            {:?} down={} screen={:?} switcher={} front={:?}",
                    event.key,
                    event.down,
                    screen.get_screen(),
                    switcher.is_some(),
                    {
                        #[cfg(feature = "wayland")]
                        {
                            wl_front
                        }
                        #[cfg(not(feature = "wayland"))]
                        {
                            Option::<u32>::None
                        }
                    }
                );
            }
            // The keyboard is the one screen that cares when a key is let go: a
            // held OK on the shift key latches caps lock.
            if !event.down {
                if swallow_release == Some(event.key) {
                    swallow_release = None;
                    continue;
                }
                if let Some(sw) = switcher.as_mut() {
                switch_dirty = true;
                match sw.key(event.key) {
                    Some(flipper_ui::switcher::Action::Close) => {
                        eprintln!("switcher       closing back to {:?}", before_switcher);
                        switcher = None;
                        // Back to the screen the deck was opened over. Nothing is
                        // focused and the recents order is untouched, so every app
                        // that was running still is, one Tab away. A question that
                        // was waiting when the deck opened is still waiting, so that
                        // comes back instead, wherever it was asked.
                        screen.set_screen(if deps.is_some() || dialog.is_some() {
                            Screen::Apps
                        } else {
                            before_switcher
                        });
                    }
                    Some(flipper_ui::switcher::Action::Launch(name, kind)) => {
                        switcher = None;
                        // A console app is still running on its VT: bringing it
                        // back is a switch, not a launch. The panel only changes
                        // hands when it was not already a console app in front.
                        if let Some(at) = consoles.iter().position(|s| s.name == name) {
                            if console_front.is_none() {
                                if let Some(sink) = sink.as_mut() {
                                    let _ = sink.detach();
                                }
                            }
                            for (i, other) in consoles.iter_mut().enumerate() {
                                if i != at {
                                    let _ = other.background();
                                }
                            }
                            let last = recents.frame_of(&name);
                            if let Err(e) =
                                consoles[at].foreground(last.as_ref().map(|f| f.as_slice()))
                            {
                                eprintln!("console        {name} cannot be shown: {e}");
                            }
                            console_front = Some(at);
                            focused_app = None;
                            recents.open(&name, kind);
                            eprintln!("console        front is {name} (card)");
                            continue;
                        }
                        launch_card(
                            &screen,
                            &mut apps_live,
                            &mut focused_app,
                            &mut recents,
                            &mut stack,
                            &name,
                            kind,
                            &net_now,
                        );
                        redraw_app = focused_app.is_some();
                    }
                    Some(flipper_ui::switcher::Action::Kill(name, kind)) => {
                    // A hosted app is a process of ours and a window of the
                        // compositor's, so both have to go: the child, because nothing
                        // else will reap it, and the workspace, because an empty one
                        // left visible is a black panel.
                        #[cfg(feature = "wayland")]
                        if let Some(at) = wl_apps.iter().position(|a| a.name == name) {
                            let app = wl_apps.remove(at);
                            let ws = app.workspace;
                            let mut child = app.child;
                            let _ = child.kill();
                            let _ = child.wait();
                            if let Some(sway) = sway.as_mut() {
                                let _ = sway.close(ws);
                                if wl_front == Some(ws) {
                                    let _ = sway.scale(1.0);
                                    let _ = sway.show(flipper_ui::sway::HOME);
                                }
                            }
                            if wl_front == Some(ws) {
                                wl_front = None;
                                screen.set_screen(launched_from);
                                window.request_redraw();
                            }
                            recents.close(&name);
                            eprintln!("app            {name} killed, workspace {ws} freed");
                            continue;
                        }
                        // A console app is a process too, just not one of ours to
                        // draw for.
                        if let Some(at) = consoles.iter().position(|s| s.name == name) {
                            let was_front = console_front == Some(at);
                            let mut session = consoles.remove(at);
                            session.stop();
                            drop(session);
                            console_front = None;
                            let _ = was_front;
                            recents.close(&name);
                        } else if kind == flipper_ui::switcher::Kind::App {
                            kill_app(&mut apps_live, &mut focused_app, &mut recents, &name);
                        } else {
                            // Nothing to stop: a screen leaves the stack and that
                            // is the whole of it.
                            recents.close(&name);
                        }
                    }
                    None => {}
                }
                continue;
            }

            if screen.get_screen() == Screen::TextInput {
                    if let Some(input) = kb.as_mut() {
                        if input.release(event.key) {
                            kb_dirty = true;
                        }
                    }
                }
                continue;
            }
            // With the deck open, nothing underneath sees a press.
            //
            // The switcher acts on releases, so a press went straight past it to
            // whatever it was drawn over: Back closed the deck on its release and
            // popped a menu level on its press, landing a level above where the
            // user had been. Everything the deck does with a key it does on the way
            // up, so a press has nowhere else to go.
            if switcher.is_some() {
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
            eprintln!(
                "  handled on   screen={:?} switcher={} console_front={} stack={}",
                screen.get_screen(),
                if switcher.is_some() { "open" } else { "closed" },
                console_front
                    .and_then(|at| consoles.get(at))
                    .map_or("none".to_string(), |s| s.name.clone()),
                stack.len()
            );

            // A labelled soft key must do something, or the label is a lie.
            let on_menu_now = screen.get_screen() == Screen::Menu;
            let labels: &[&str; 5] = if on_menu_now {
                &demo::SOFT_LABELS
            } else {
                &demo::IDLE_LABELS
            };
            let labelled_soft = slot.is_some_and(|i| !labels[i].is_empty());

            // Tab belongs to the system, not to whatever is in front. It is
            // handled before the focused app is offered the key, which is what
            // lets a second app be brought forward at all. With nothing running
            // there is nothing to switch between, so it does nothing.
            // Say why nothing happened: an empty stack is a state the user cannot
            // see, and a key that silently does nothing is the hardest kind of
            // thing to report.
            if event.key == FlipperKey::AppSwitch && switcher.is_none() && recents.is_empty() {
                eprintln!("switcher       nothing running to switch to");
            }
            if event.key == FlipperKey::AppSwitch && switcher.is_none() && !recents.is_empty() {
                // A question stays asked. Switching away hides it, dismissing the
                // switcher brings it back, and it is still waiting for the same
                // answer: an install that needed approving is not something to lose
                // because the user looked at something else first.
                let inside_app = matches!(
                    screen.get_screen(),
                    Screen::AppForm
                        | Screen::AppDetail
                        | Screen::AppLog
                        | Screen::AppCanvas
                        | Screen::AppCards
                );
                // What the user is looking at is the top card when it is a focused
                // app or one of our tracked screens, and either way that is what
                // the panel is showing right now.
                let front = front_card(
                        pending_app!(),
                        &apps_live,
                        focused_app,
                        open_screen(screen.get_screen(), &stack),
                    );
                // Something of ours in front means the focus starts one below it,
                // which is what makes Tab twice a switch to the previous app. An
                // app waiting on a question counts: it is what the user is looking
                // at.
                let on_top = front.is_some() || inside_app;
                // And it is the most recent thing by definition. Without this the
                // stack keeps whatever order it had, so a card that was in front
                // without being launched sat in the second slot: the very slot the
                // focus starts on, which made every switch land back on it.
                if let Some(name) = front.as_deref() {
                    let kind = recents
                        .kind(name)
                        .unwrap_or(flipper_ui::switcher::Kind::App);
                    recents.open(name, kind);
                }
                stash_front(&mut recents, front, &frame);
                // Where dismissing the deck lands: the last screen of ours the user
                // was on, which is never an app and never the deck itself. Recording
                // the screen as it stands sent Back into the app the deck had been
                // opened over, which is the one thing Back from the deck must not do:
                // it is the way out, and the app stays running either way.
                before_switcher = match screen.get_screen() {
                    Screen::AppForm
                    | Screen::AppLog
                    | Screen::AppDetail
                    | Screen::AppCanvas
                    | Screen::AppCards
                    | Screen::Switcher => launched_from,
                    other => other,
                };
                eprintln!("switcher       opened over {:?}", before_switcher);
                swallow_release = Some(FlipperKey::AppSwitch);
                switcher = Some(flipper_ui::switcher::Switcher::open(&recents, on_top));
                switch_dirty = true;
                focused_app = None;
                press.cancel();
                screen.set_screen(Screen::Switcher);
                continue;
            }

            // While an app is running it owns the keys, except Back, which is
            // the way out of an app that has stopped responding.
            if let Some(app) = focused_app.and_then(|i| apps_live.get_mut(i)).map(|(_, a)| a) {
                // Every screen an app can be showing, the log included: leaving
                // it was forwarded to the app there, and an app that does not treat
                // Back as "put me away" then looked stuck.
                if matches!(
                    screen.get_screen(),
                    Screen::AppForm
                        | Screen::AppDetail
                        | Screen::AppLog
                        | Screen::AppCanvas
                        | Screen::AppCards
                ) && event.key == FlipperKey::Back
                {
                    // Back leaves the app running and puts the user back in the
                    // list. Stopping it belongs to Kill in the switcher, which is
                    // the only thing that claims to end an app.
                    let front = front_card(
                        pending_app!(),
                        &apps_live,
                        focused_app,
                        open_screen(screen.get_screen(), &stack),
                    );
                    stash_front(&mut recents, front, &frame);
                    focused_app = None;
                    let rows: Vec<flipper_ui::app::Row> = apps
                        .iter()
                        .map(|a| flipper_ui::app::Row::pair(&a.name, ""))
                        .collect();
                    apply_app_list(&screen, &rows, app_selected, &EMPTY_BUTTONS, (0, 0), app_scroll);
                    // The detail body has its own labels, and an app that drew
                    // through it leaves them set: Resources' soft keys outlived it
                    // on the screen it was left for. Cleared with the rest of the
                    // app's state rather than left for the next screen to overwrite.
                    screen.set_detail_buttons(slint::ModelRc::new(slint::VecModel::from(
                        Vec::<slint::SharedString>::new(),
                    )));
                    screen.set_screen(Screen::Apps);
                } else if screen.get_screen() == Screen::AppDetail
                    && matches!(event.key, FlipperKey::Up | FlipperKey::Down)
                {
                    // Scrolled here, not by the app. The scrollbar is drawn from
                    // the row count, so the keys that move it have to act on the
                    // same side that draws it.
                    let visible = flipper_ui::theme::count::DETAIL_VISIBLE_ROWS;
                    let max = (app_detail_rows - visible).max(0);
                    app_detail_offset = match event.key {
                        FlipperKey::Down => (app_detail_offset + 1).min(max),
                        _ => (app_detail_offset - 1).max(0),
                    };
                    screen.set_detail_offset(app_detail_offset);
                } else {
                    // Flash here rather than waiting for the app: its answer is a
                    // scene that arrives on its own schedule, and a button that
                    // does not invert until then reads as a key that was missed.
                    if let Some(i) = FlipperKey::SOFT_ROW.iter().position(|k| *k == event.key) {
                        if app.scene().buttons.get(i).is_some_and(|h| !h.is_empty()) {
                            press.only(i, Instant::now() + flash);
                        }
                    }
                    app.send(event);
                }
                continue;
            }

            // The dependency flow owns the keys while it is on screen. Its dialog
            // goes through the normal dialog path below; the log does not, because
            // it scrolls.
            if let Some(stage) = deps.as_ref() {
                match stage {
                    Deps::Checking(..) => continue,
                    Deps::Installing(..) => {
                        // Scroll only: cancelling an apt run halfway would leave
                        // packages half configured.
                        match event.key {
                            FlipperKey::Down => deps_offset += 1,
                            FlipperKey::Up => {
                                deps_offset = (deps_offset - 1).max(0);
                                deps_follow = false;
                            }
                            _ => {}
                        }
                        continue;
                    }
                    Deps::Done(idx, result) => {
                        let idx = *idx;
                        let ok = result.is_ok();
                        match event.key {
                            FlipperKey::Down => deps_offset += 1,
                            FlipperKey::Up => deps_offset = (deps_offset - 1).max(0),
                            FlipperKey::Escape | FlipperKey::Back => {
                                deps = None;
                                // Leaving without starting it: the card goes with
                                // the question. A card is something the user has
                                // running or a question they still owe an answer
                                // to, and this is neither.
                                if !ok {
                                    if let Some(entry) = apps.get(idx as usize) {
                                        if !apps_live.iter().any(|(n, _)| *n == entry.name) {
                                            recents.close(&entry.name);
                                        }
                                    }
                                }
                                screen.set_screen(Screen::Apps);
                            }
                            // A successful install runs the app it was for.
                            FlipperKey::Ok | FlipperKey::Run if ok => {
                                deps = None;
                                if let Some(entry) = apps.get(idx as usize) {
                                    // An app that draws for itself, on a VT or as a
                                    // client of the compositor, never becomes a child
                                    // we draw for, so it does not reach the registry.
                                    if matches!(
                                        entry.kind,
                                        flipper_ui::app::Kind::Console
                                            | flipper_ui::app::Kind::Wayland
                                    ) {
                                        launched_from = Screen::Apps;
                                        #[cfg(feature = "wayland")]
                                        {
                                            wl_front = start_wayland(
                                                entry,
                                                &mut sway,
                                                &mut wl_apps,
                                            );
                                            wl_since = Instant::now();
                                        }
                                        console_front = start_console(
                                            entry,
                                            sink.as_mut(),
                                            &mut consoles,
                                            &mut console_keys,
                                            &frame,
                                        );
                                        #[cfg(feature = "wayland")]
                                        if wl_front.is_some() {
                                            recents.open(
                                                &entry.name,
                                                flipper_ui::switcher::Kind::App,
                                            );
                                            focused_app = None;
                                            continue;
                                        }
                                        if console_front.is_some() {
                                            recents.open(
                                                &entry.name,
                                                flipper_ui::switcher::Kind::App,
                                            );
                                            focused_app = None;
                                        }
                                        continue;
                                    }
                                    match flipper_ui::RunningApp::spawn(entry) {
                                        Ok(app) => {
                                            eprintln!("app            started {}", entry.name);
                                            recents.open(&entry.name, flipper_ui::switcher::Kind::App);
                                            apps_live.retain(|(n, _)| n != &entry.name);
                                            apps_live.push((entry.name.clone(), app));
                                            focused_app = Some(apps_live.len() - 1);
                                        }
                                        Err(e) => {
                                            eprintln!("app            {} failed: {e}", entry.name)
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                        continue;
                    }
                    Deps::Asking(..) => {}
                }
            }

            // A dialog owns every key while it is open, exactly as the
            // prototype's modal does: `handleInput` returns before the scene sees
            // anything. Both buttons flash for 30ms before acting.
            if dialog.is_some() {
                match event.key {
                    FlipperKey::Escape | FlipperKey::Back => {
                        press.button(FlipperKey::Escape, 0, Instant::now() + flash);
                    }
                    FlipperKey::Ok | FlipperKey::Run
                        if !dialog.as_ref().unwrap().right.is_empty() =>
                    {
                        press.button(FlipperKey::Run, 4, Instant::now() + flash);
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
                        press.soft(FlipperKey::Escape, 0, Instant::now() + flash);
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
                        if !open.buttons(&applying)[4].is_empty() =>
                    {
                        press.soft(FlipperKey::Run, 4, Instant::now() + flash);
                    }
                    FlipperKey::Escape | FlipperKey::Back => {
                        press.soft(FlipperKey::Escape, 0, Instant::now() + flash);
                    }
                    _ => {}
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
                    // Flash the row first and act when the flash ends, which is
                    // what a menu row does. Without it the only feedback was the
                    // screen changing, so an app that opens a dialog instead
                    // looked like it had ignored the key.
                    FlipperKey::Ok | FlipperKey::Run if !apps.is_empty() => {
                        press.row(FlipperKey::Ok, Instant::now() + flash);
                    }
                    FlipperKey::Back | FlipperKey::Escape => screen.set_screen(Screen::Menu),
                    _ => {}
                }
                let visible = flipper_ui::theme::count::LIST_VISIBLE_ROWS;
                app_scroll = app_scroll.clamp(
                    (app_selected - visible + 1).max(0),
                    app_selected.min((apps.len() as i32 - visible).max(0)),
                );
                let rows: Vec<flipper_ui::app::Row> = apps
                    .iter()
                    .map(|a| flipper_ui::app::Row::pair(&a.name, ""))
                    .collect();
                apply_app_list(&screen, &rows, app_selected, &EMPTY_BUTTONS, (0, 0), app_scroll);
                continue;
            }


            if screen.get_screen() == Screen::TextInput {
                if let Some(input) = kb.as_mut() {
                    // The two labelled keys invert their own button. The action is
                    // not deferred: this screen answers every key itself, so there
                    // is nothing for the flash to hand back.
                    match event.key {
                        FlipperKey::Escape => press.only(0, Instant::now() + flash),
                        FlipperKey::Run => press.only(4, Instant::now() + flash),
                        _ => {}
                    }
                    let warning = rename_warning(input, &kb_profile, &boot_profiles);
                    match input.key(event.key, warning.is_empty()) {
                        Some(flipper_ui::keyboard::Exit::Save(text)) => {
                            let dest = flipper_ui::boot::rename_dest(&kb_profile, &text);
                            // Saving the name it already has is not a rename.
                            popup = if dest.is_empty() || dest == kb_profile.name {
                                Some(Popup::Edit)
                            } else {
                                eprintln!("boot action    rename {} -> {dest}", kb_profile.name);
                                Some(start_rename(kb_profile.name.clone(), dest))
                            };
                            kb = None;
                            press.cancel();
                            popup_dirty = true;
                            screen.set_screen(Screen::Boot);
                            boot_last_shown = -2;
                        }
                        Some(flipper_ui::keyboard::Exit::Cancel) => {
                            kb = None;
                            press.cancel();
                            popup_dirty = true;
                            screen.set_screen(Screen::Boot);
                            boot_last_shown = -2;
                        }
                        None => kb_dirty = true,
                    }
                }
                continue;
            }

            if screen.get_screen() == Screen::Boot {
                // Any key cancels the countdown, including the one that moves the
                // selection: a person choosing a profile is not waiting for the
                // default to be chosen for them.
                boot_cancelled = true;

                if let Some(open) = popup.take() {
                    let profile = boot_profiles.get(boot_selected as usize).cloned();
                    let actions = profile
                        .as_ref()
                        .map(flipper_ui::boot::edit_actions)
                        .unwrap_or_default();
                    popup_dirty = true;
                    match open {
                        // Read-only: any way out closes it.
                        Popup::Info => match event.key {
                            FlipperKey::Escape
                            | FlipperKey::Back
                            | FlipperKey::Ok
                            | FlipperKey::Run
                            | FlipperKey::Edit => {}
                            _ => popup = Some(Popup::Info),
                        },
                        Popup::Edit => match event.key {
                            FlipperKey::Down => {
                                popup_index = (popup_index + 1) % actions.len().max(1);
                                popup = Some(Popup::Edit);
                            }
                            FlipperKey::Up => {
                                popup_index =
                                    (popup_index + actions.len().saturating_sub(1))
                                        % actions.len().max(1);
                                popup = Some(Popup::Edit);
                            }
                            FlipperKey::Ok | FlipperKey::Run => {
                                // Auto Start is reversible and immediate; the rest
                                // change or destroy a profile, so they ask first.
                                match actions.get(popup_index).copied() {
                                    Some("Auto Start") => {
                                        popup = start_boot_action(
                                            "Auto Start",
                                            profile.clone(),
                                            boot_profiles.clone(),
                                        );
                                    }
                                    // Rename asks for the name first. The popup
                                    // stays as it was, so backing out of the
                                    // keyboard returns to the same list of
                                    // actions.
                                    Some("Rename") => {
                                        let p = profile.clone().unwrap_or_default();
                                        kb = Some(flipper_ui::keyboard::TextInput::new(
                                            "Profile name",
                                            &flipper_ui::boot::profile_label(&p.name),
                                        ));
                                        kb_profile = p;
                                        kb_dirty = true;
                                        popup = Some(Popup::Edit);
                                        screen.set_screen(Screen::TextInput);
                                    }
                                    Some(_) => popup = Some(Popup::Confirm(popup_index)),
                                    None => {}
                                }
                            }
                            FlipperKey::Escape | FlipperKey::Back => {}
                            _ => popup = Some(Popup::Edit),
                        },
                        Popup::Confirm(at) => match event.key {
                            FlipperKey::Ok | FlipperKey::Run => {
                                popup = start_boot_action(
                                    actions.get(at).copied().unwrap_or(""),
                                    profile.clone(),
                                    boot_profiles.clone(),
                                );
                            }
                            // Anything else is a no, and returns to the list.
                            _ => popup = Some(Popup::Edit),
                        },
                        // Not interruptible: stopping a create-profile halfway
                        // would leave a half-made subvolume.
                        Popup::Busy(what, rx) => popup = Some(Popup::Busy(what, rx)),
                        // The only thing this says is why an action failed, so
                        // any key dismisses it and the list stands: a failed
                        // action changed nothing to re-read.
                        Popup::Said(_) => {}
                    }
                    continue;
                }

                let count = boot_profiles.len() as i32;
                match event.key {
                    FlipperKey::Down if count > 0 => {
                        boot_selected = (boot_selected + 1).rem_euclid(count);
                    }
                    FlipperKey::Up if count > 0 => {
                        boot_selected = (boot_selected - 1).rem_euclid(count);
                    }
                    // Info is slot 1 and Edit slot 3, the two labelled keys.
                    FlipperKey::View if count > 0 => {
                        popup = Some(Popup::Info);
                        popup_index = 0;
                        popup_dirty = true;
                        popup_space = None;
                        popup_space_done = false;
                        popup_dtbo = None;
                        let (sp, dt) = spawn_popup_reads(&boot_profiles, boot_selected);
                        popup_space_rx = sp;
                        popup_dtbo_rx = dt;
                    }
                    FlipperKey::Edit if count > 0 => {
                        popup = Some(Popup::Edit);
                        popup_index = 0;
                        popup_dirty = true;
                        popup_space = None;
                        popup_space_done = false;
                        popup_dtbo = None;
                        let (sp, dt) = spawn_popup_reads(&boot_profiles, boot_selected);
                        popup_space_rx = sp;
                        popup_dtbo_rx = dt;
                    }
                    FlipperKey::Escape | FlipperKey::Back => {
                        // The selection is left as it was. This screen never moved
                        // it, so restoring the stack's copy would put the cursor
                        // wherever the last drill-in happened to store.
                        let menu = stack.last().unwrap().0;
                        demo::apply_menu(&screen, menu, &net_now);
                        screen.set_screen(Screen::Menu);
                    }
                    _ => {}
                }
                let visible = flipper_ui::theme::count::BOOT_VISIBLE_ROWS;
                boot_scroll = boot_scroll.clamp(
                    (boot_selected - visible + 1).max(0),
                    boot_selected.min((count - visible).max(0)),
                );
                boot_last_shown = -2;
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
                    press.row(FlipperKey::Ok, Instant::now() + flash);
                }
                (_, FlipperKey::Ok) => press.row(FlipperKey::Ok, Instant::now() + flash),
                // A labelled soft key inverts first and acts when the flash ends.
                _ if labelled_soft => {
                    match slot {
                        Some(i) => press.soft(event.key, i, Instant::now() + flash),
                        None => press.row(event.key, Instant::now() + flash),
                    }
                }
                _ => {}
            }
        }

        if let Some((pressed_key, pressed_slot)) = press.expired(Instant::now()) {
            let slot = pressed_slot;
            // The flash has been seen; now do what the button says. Idle's slot 1
            // is "Menu", which is where desktop.js puts it.
            {
                let key = pressed_key;
                // A dialog's own buttons, resolved before anything else since it
                // was holding every key. Only while it is actually on screen: with
                // an app or the switcher in front it is covered, not asked, and a
                // soft key pressed over there is not an answer to it.
                let covered = switcher.is_some() || focused_app.is_some();
                if let Some(d) = dialog.take().filter(|_| !covered) {
                    if d.act == DialogAct::InstallDeps {
                        match (slot, deps.take()) {
                            // Install: run it, streaming output to the log.
                            (Some(4), Some(Deps::Asking(idx, m))) => {
                                if let Some(entry) = apps.get(idx as usize).cloned() {
                                    let (log_tx, log_rx) = std::sync::mpsc::channel();
                                    let (done_tx, done_rx) = std::sync::mpsc::channel();
                                    std::thread::Builder::new()
                                        .name("dep-install".into())
                                        .spawn(move || {
                                            let r = flipper_ui::app::install(&entry, &m, |line| {
                                                let _ = log_tx.send(line);
                                            });
                                            let _ = done_tx.send(r);
                                        })
                                        .ok();
                                    deps_log.clear();
                                    deps_offset = 0;
                                    deps_follow = true;
                                    deps = Some(Deps::Installing(idx, log_rx, done_rx));
                                }
                            }
                            // Cancel, or a dialog with nothing behind it. The app
                            // never started, so its card goes: a card that leads
                            // back to a question nobody is asking any more is a
                            // dead end.
                            (_, stage) => {
                                if let Some(idx) = stage.as_ref().map(|s| match s {
                                    Deps::Checking(i, _)
                                    | Deps::Asking(i, _)
                                    | Deps::Installing(i, ..)
                                    | Deps::Done(i, _) => *i,
                                }) {
                                    if let Some(entry) = apps.get(idx as usize) {
                                        recents.close(&entry.name);
                                    }
                                }
                                screen.set_screen(Screen::Apps);
                            }
                        }
                    } else if slot == Some(4) && d.act == DialogAct::ClearAirplane {
                        net.set_airplane(false);
                        // menu.js proceeds to the action the dialog interrupted.
                        dialog = Some(Dialog {
                            lines: vec!["5G Modem".into(), "is not ported yet".into()],
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
                            let menu = stack.last().unwrap().0;
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
                } else if key == FlipperKey::Ok && screen.get_screen() == Screen::Apps {
                    // Check what it needs before starting it. An app whose
                    // packages are missing would otherwise die on import with its
                    // traceback in the journal and nothing on screen.
                    if let Some(entry) = apps.get(app_selected as usize).cloned() {
                        let (tx, rx) = std::sync::mpsc::channel();
                        let for_check = entry.clone();
                        std::thread::Builder::new()
                            .name("dep-check".into())
                            .spawn(move || {
                                let _ = tx.send(flipper_ui::app::missing(&for_check));
                            })
                            .ok();
                        app_detail_offset = 0;
                        let front =
                            front_card(
                        pending_app!(),
                        &apps_live,
                        focused_app,
                        open_screen(screen.get_screen(), &stack),
                    );
                        stash_front(&mut recents, front, &frame);
                        // In the stack from the moment it is started, not from the
                        // moment it succeeds: an app waiting to be built is
                        // something the user set going, and its card is how they
                        // get back to the question.
                        recents.open(&entry.name, flipper_ui::switcher::Kind::App);
                        deps = Some(Deps::Checking(app_selected, rx));
                        deps_log.clear();
                        deps_offset = 0;
                    }
                } else if key == FlipperKey::View && screen.get_screen() == Screen::Idle {
                    screen.set_screen(Screen::Menu);
                    eprintln!("screen         menu");
                } else if key == FlipperKey::Ok && screen.get_screen() == Screen::Menu {
                    let row = &stack.last().unwrap().0.rows[selected as usize];
                    match &row.act {
                        demo::Act::Sub(next) => {
                            // A submenu the switcher tracks joins the stack, and
                            // stays there: leaving it is not closing it, any more
                            // than backing out of an app stops the app. Kill in the
                            // switcher is what removes one.
                            if demo::is_card_menu(next) {
                                recents.open(next.title, flipper_ui::switcher::Kind::Screen);
                            }
                            stack.last_mut().unwrap().1 = selected;
                            stack.last_mut().unwrap().2 = scroll;
                            stack.push((next, 0, 0));
                            selected = 0;
                            scroll = 0;
                            demo::apply_menu(&screen, next, &net_now);
                            eprintln!("menu           {}", next.title);
                        }
                        demo::Act::Apps => {
                            // Read the directory again: an app copied onto the
                            // device between two visits belongs in this list.
                            apps = flipper_ui::app::discover(&apps_dir);
                            app_selected = app_selected.min((apps.len() as i32 - 1).max(0));
                            let rows: Vec<flipper_ui::app::Row> = apps
                                .iter()
                                .map(|a| flipper_ui::app::Row::pair(&a.name, ""))
                                .collect();
                            apply_app_list(&screen, &rows, app_selected, &EMPTY_BUTTONS, (0, 0), app_scroll);
                            screen.set_screen(Screen::Apps);
                            // `pressed` is shared by both lists, so a flash still
                            // running here would land on whichever app row is
                            // selected on arrival.
                            press.cancel();
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
                        demo::Act::Boot => {
                            boot_pending = start_profiles_read();
                            boot_profiles.clear();
                            boot_selected = 0;
                            boot_scroll = 0;
                            boot_cancelled = false;
                            // The countdown starts when the list lands, not now:
                            // counting down to boot something not yet read would be
                            // a race.
                            boot_started = None;
                            boot_last_shown = -2;
                            screen.set_breadcrumb("".into());
                            screen.set_screen(Screen::Boot);
                            eprintln!("screen         boot menu, {} profiles", boot_profiles.len());
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
                                    "To use 5G Modem you need".into(),
                                    "to turn off Airplane mode".into(),
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
                                lines: vec![row.label.into(), "is not ported yet".into()],
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

        // A second's worth of staleness at most, and only a 36KB copy when there is
        // something in front worth photographing.
        if switcher.is_none() && card_stash.elapsed() >= Duration::from_secs(1) {
            card_stash = Instant::now();
            let front = front_card(
                        pending_app!(),
                        &apps_live,
                        focused_app,
                        open_screen(screen.get_screen(), &stack),
                    );
            stash_front(&mut recents, front, &frame);
        }

        // The switcher, while it is open. Its cards are rebuilt on every frame of
        // an animation, which is what an animation is; at rest nothing changes and
        // the loop settles.
        if let Some(sw) = switcher.as_mut() {
            match sw.tick() {
                Some(flipper_ui::switcher::Action::Launch(name, kind)) => {
                    switcher = None;
                    // An app hosted by the compositor is still on its own
                    // workspace, so bringing it back is one IPC call: nothing is
                    // started, restarted or handed over.
                    #[cfg(feature = "wayland")]
                    if let Some(ws) = wl_apps.iter().find(|a| a.name == name).map(|a| a.workspace) {
                        if let Some(sway) = sway.as_mut() {
                            match sway.show(ws) {
                                Ok(true) => {
                                    wl_front = Some(ws);
                                    wl_since = Instant::now();
                                    focused_app = None;
                                    if let Some((w, h)) = apps
                                        .iter()
                                        .find(|a| a.name == name)
                                        .and_then(|a| a.size)
                                    {
                                        let fit = (f32::from(PANEL_W) / w as f32)
                                            .min(f32::from(PANEL_H) / h as f32);
                                        let _ = sway.scale(fit);
                                    }
                                    // Back from here goes where the deck was opened
                                    // over, not where the app happened to be started
                                    // an hour ago.
                                    launched_from = before_switcher;
                                    recents.open(&name, kind);
                                    eprintln!(
                                        "app            front is {name} (card, back goes to {:?})",
                                        launched_from
                                    );
                                    continue;
                                }
                                other => {
                                    eprintln!("app            {name} cannot be shown: {other:?}")
                                }
                            }
                        }
                    }
                    if let Some(at) = consoles.iter().position(|s| s.name == name) {
                        if console_front.is_none() {
                            if let Some(sink) = sink.as_mut() {
                                let _ = sink.detach();
                            }
                        }
                        for (i, other) in consoles.iter_mut().enumerate() {
                            if i != at {
                                let _ = other.background();
                            }
                        }
                        let last = recents.frame_of(&name);
                        if let Err(e) =
                            consoles[at].foreground(last.as_ref().map(|f| f.as_slice()))
                        {
                            eprintln!("console        {name} cannot be shown: {e}");
                        }
                        console_front = Some(at);
                        focused_app = None;
                        recents.open(&name, kind);
                        eprintln!("console        front is {name} (card, tick)");
                        continue;
                    }
                    launch_card(
                        &screen,
                        &mut apps_live,
                        &mut focused_app,
                        &mut recents,
                        &mut stack,
                        &name,
                        kind,
                        &net_now,
                    );
                    redraw_app = focused_app.is_some();
                }
                Some(flipper_ui::switcher::Action::Close) => {
                    eprintln!("switcher       closing back to {:?} (tick)", before_switcher);
                    switcher = None;
                    screen.set_screen(if deps.is_some() || dialog.is_some() {
                        Screen::Apps
                    } else {
                        before_switcher
                    });
                }
                Some(flipper_ui::switcher::Action::Kill(name, kind)) => {
                    // A hosted app is a process of ours and a window of the
                    // compositor's, so both have to go: the child, because nothing
                    // else will reap it, and the workspace, because an empty one
                    // left visible is a black panel.
                    #[cfg(feature = "wayland")]
                    if let Some(at) = wl_apps.iter().position(|a| a.name == name) {
                        let app = wl_apps.remove(at);
                        let ws = app.workspace;
                        let mut child = app.child;
                        // The group, not the process: the direct child is the shell,
                        // and the program is its child.
                        flipper_ui::app::stop_group(child.id());
                        let _ = child.kill();
                        let _ = child.wait();
                        if let Some(sway) = sway.as_mut() {
                            let _ = sway.close(ws);
                            if wl_front == Some(ws) {
                                let _ = sway.scale(1.0);
                                let _ = sway.show(flipper_ui::sway::HOME);
                            }
                        }
                        if wl_front == Some(ws) {
                            wl_front = None;
                            screen.set_screen(launched_from);
                            window.request_redraw();
                        }
                        recents.close(&name);
                        eprintln!("app            {name} killed, workspace {ws} freed");
                        continue;
                    }
                    if let Some(at) = consoles.iter().position(|s| s.name == name) {
                        let was_front = console_front == Some(at);
                        let mut session = consoles.remove(at);
                        session.stop();
                        drop(session);
                        console_front = None;
                        let _ = was_front;
                        recents.close(&name);
                    } else if kind == flipper_ui::switcher::Kind::App {
                        kill_app(&mut apps_live, &mut focused_app, &mut recents, &name);
                    } else {
                        recents.close(&name);
                    }
                }
                None => {}
            }
        }
        if let Some(sw) = switcher.as_ref().filter(|sw| sw.animating() || switch_dirty) {
            switch_dirty = sw.animating();
            let cards: Vec<flipper_ui::ui::SwitchCard> = sw
                .placed()
                .into_iter()
                .map(|p| card_of(&p, &mut card_images))
                .collect();
            screen.set_switch_cards(slint::ModelRc::new(slint::VecModel::from(cards)));
            screen.set_switch_can_kill(sw.can_kill());
            screen.set_switch_pressed_slot(press.soft_slot());
            screen.set_switch_empty("No running apps".into());
        }

        // The text-input screen. Its cells are rebuilt only when something moved:
        // the number row's wave, a press flash and the caret's blink are the only
        // things that change on their own, and each says so.
        if screen.get_screen() == Screen::TextInput {
            if let Some(input) = kb.as_mut() {
                let cursor_on = input.cursor_visible();
                if input.animating() || cursor_on != kb_cursor_shown {
                    kb_dirty = true;
                }
                if kb_dirty {
                    kb_dirty = false;
                    kb_cursor_shown = cursor_on;
                    let warning = rename_warning(input, &kb_profile, &boot_profiles);
                    apply_text_input(&screen, input, &warning, cursor_on);
                }
            }
        }

        // The boot menu's countdown, and its rows when something moved.
        if screen.get_screen() == Screen::Boot {
            if let Some(rx) = boot_pending.as_ref() {
                match rx.try_recv() {
                    Ok(list) => {
                        eprintln!("boot menu      {} profiles", list.len());
                        boot_profiles = list;
                        boot_pending = None;
                        boot_last_shown = -2;
                        if !boot_cancelled {
                            boot_started = Some(Instant::now());
                        }
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => {}
                    Err(_) => boot_pending = None,
                }
            }
            // The load spinner picks its frame from the clock, so it needs a
            // repaint asked for while the read runs: nothing else changes, and
            // without one the strip sits on a single frame for the whole read.
            {
                use flipper_ui::theme::{metric::BOOT_SPIN_FRAMES, timing::SPIN_FRAME_MS};
                let loading = boot_pending.is_some();
                screen.set_boot_loading(loading);
                if loading {
                    let frame = (boot_spin_at.elapsed().as_millis() / SPIN_FRAME_MS as u128)
                        % BOOT_SPIN_FRAMES as u128;
                    screen.set_boot_spin_frame(frame as i32);
                }
            }
            let percent = match boot_started {
                Some(at) if !boot_cancelled => {
                    let elapsed = at.elapsed().min(BOOT_TIMEOUT);
                    (elapsed.as_secs_f32() / BOOT_TIMEOUT.as_secs_f32() * 100.0) as i32
                }
                // Cancelled, or never started: no bar and no countdown text.
                _ => -1,
            };
            let remaining = match boot_started {
                Some(at) if !boot_cancelled => {
                    (BOOT_TIMEOUT.saturating_sub(at.elapsed()).as_secs_f32().ceil()) as i32
                }
                _ => 0,
            };
            // The popup's own state: the space read landing, an action finishing,
            // and the rows it shows.
            if let Some(rx) = popup_space_rx.as_ref() {
                if let Ok(space) = rx.try_recv() {
                    popup_space = space;
                    popup_space_done = true;
                    popup_space_rx = None;
                    popup_dirty = true;
                }
            }
            // The spinner is a frame of "-\|/" chosen by elapsed time, so it only
            // changes if something asks for a repaint. Nothing else does while a
            // read is in flight, so it has to be asked for here or the frame sits
            // still for the whole minute the measurement takes.
            if (popup_space_rx.is_some()
                || popup_dtbo_rx.is_some()
                || matches!(popup, Some(Popup::Busy(..))))
                && spin_shown.elapsed() >= Duration::from_millis(120)
            {
                spin_shown = Instant::now();
                popup_dirty = true;
            }
            if let Some(rx) = popup_dtbo_rx.as_ref() {
                if let Ok(dtbo) = rx.try_recv() {
                    popup_dtbo = Some(dtbo);
                    popup_dtbo_rx = None;
                    popup_dirty = true;
                }
            }
            // A finished action says nothing: the popup closes and the list is
            // read again, which is the answer. Only a failure has something to
            // report, and it waits for a key.
            if let Some(Popup::Busy(what, Some(rx))) = popup.as_ref() {
                match rx.try_recv() {
                    Ok(Ok(rebooting)) => {
                        eprintln!("boot action    {what} done, rebooting={rebooting}");
                        popup = if rebooting {
                            Some(Popup::Busy("Rebooting".into(), None))
                        } else {
                            popup_index = 0;
                            boot_pending = start_profiles_read();
                            boot_profiles.clear();
                            boot_selected = 0;
                            boot_scroll = 0;
                            boot_last_shown = -2;
                            None
                        };
                        popup_dirty = true;
                    }
                    Ok(Err(e)) => {
                        eprintln!("boot action    {what} failed: {e}");
                        popup = Some(Popup::Said(e));
                        popup_dirty = true;
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => {}
                    Err(_) => {
                        popup = Some(Popup::Said("action stopped".into()));
                        popup_dirty = true;
                    }
                }
            }

            if popup_dirty {
                popup_dirty = false;
                let profile = boot_profiles.get(boot_selected as usize).cloned().unwrap_or_default();
                // The popup header uses the larger 14px icons, not the row's.
                // headerIcon's set: every one of these is 14x14.
                let icon = match flipper_ui::boot::icon_key(&profile.name, &profile.origin) {
                    "minimal" => 1,
                    "desktop" => 2,
                    "router" => 3,
                    "media" => 4,
                    "graphics" => 5,
                    _ => 6,
                };
                let size = (14.0, 14.0);
                let mut rows: Vec<flipper_ui::ui::BootPopupRow> = Vec::new();
                let mut message: Vec<slint::SharedString> = Vec::new();
                let mut button = String::new();

                let line = |text: String| flipper_ui::ui::BootPopupRow {
                    kind: 0,
                    text: text.as_str().into(),
                    selected: false,
                    heart: false,
                };
                // A value still being read shows a spinner frame, as the prototype
                // does, so the line does not change width as it lands.
                let spin = ["-", "\\", "|", "/"][(spin_at.elapsed().as_millis() / 120) as usize % 4];

                match popup.as_ref() {
                    Some(Popup::Info) => {
                        let dt = popup_dtbo.as_ref();
                        let joined = |v: &Vec<String>| {
                            if v.is_empty() { "none".to_string() } else { v.join(" ") }
                        };
                        rows.push(line(format!(
                            "Cloned from: {}",
                            if profile.parent.is_empty() {
                                "-".to_string()
                            } else {
                                flipper_ui::boot::display_name(&profile.parent)
                            }
                        )));
                        rows.push(line(format!(
                            "Factory: {}",
                            if profile.origin.is_empty() {
                                "-".to_string()
                            } else {
                                profile.origin.trim_start_matches('@').to_string()
                            }
                        )));
                        rows.push(line(format!(
                            "Last used: {}",
                            flipper_ui::boot::info_last_used(
                                &profile.last_used,
                                std::time::SystemTime::now()
                            )
                        )));
                        rows.push(line(format!(
                            "DTBO system: {}",
                            dt.map_or(spin.to_string(), |(sys, _)| joined(sys))
                        )));
                        rows.push(line(format!(
                            "DTBO user: {}",
                            dt.map_or(spin.to_string(), |(_, usr)| joined(usr))
                        )));
                    }
                    Some(Popup::Edit) => {
                        for (i, action) in flipper_ui::boot::edit_actions(&profile).iter().enumerate() {
                            rows.push(flipper_ui::ui::BootPopupRow {
                                kind: 1,
                                text: (*action).into(),
                                selected: i == popup_index,
                                heart: *action == "Auto Start" && profile.auto_boot,
                            });
                        }
                    }
                    Some(Popup::Confirm(at)) => {
                        let action = flipper_ui::boot::edit_actions(&profile)
                            .get(*at)
                            .copied()
                            .unwrap_or("");
                        message.push(format!("{action}").as_str().into());
                        message.push(
                            flipper_ui::boot::display_name(&profile.name).as_str().into(),
                        );
                        button = "OK = yes    Back = no".into();
                    }
                    Some(Popup::Busy(what, _)) => {
                        message.push(format!("{what} {spin}").as_str().into());
                    }
                    Some(Popup::Said(msg)) => {
                        message.push(msg.as_str().into());
                        button = "Press any key".into();
                    }
                    None => {}
                }

                // The exclusive size: what deleting this profile alone would free,
                // which is the number the popup labels "Size".
                let (num, unit) = match (popup_space.as_ref(), popup_space_done) {
                    (Some(sp), _) => flipper_ui::boot::size_parts(&sp.unique),
                    // Asked and got nothing: "?" as sizeParts gives for a null,
                    // rather than a spinner that never stops.
                    (None, true) => ("?".to_string(), String::new()),
                    (None, false) => (spin.to_string(), String::new()),
                };
                screen.set_boot_popup_open(popup.is_some());
                screen.set_boot_popup_title(
                    flipper_ui::boot::display_name(&profile.name)
                        .trim_matches(['[', ']'])
                        .into(),
                );
                screen.set_boot_popup_icon(icon);
                screen.set_boot_popup_icon_w(size.0);
                screen.set_boot_popup_icon_h(size.1);
                // While loading, the slot is the widest spinner frame; once the
                // value lands it is the value's own width.
                screen.set_boot_popup_size_slot_w(if popup_space.is_some() || popup_space_done {
                    0.0
                } else {
                    let w = ["-", "\\", "|", "/"]
                        .iter()
                        .map(|f| flipper_ui::font::TITLE.text_width(f))
                        .max()
                        .unwrap_or(0);
                    f32::from(w)
                });
                screen.set_boot_popup_size_number(num.as_str().into());
                screen.set_boot_popup_size_unit(unit.as_str().into());
                // The frame is sized to its content, as boot_menu.js does:
                //
                //     min(252, max(sizeLine, nameLine, body + 2 * padH) + 12)
                //
                // Measured here because Slint cannot take a maximum across a model,
                // and because the advance tables are on this side. The name is in
                // Born2bSportyV2 and everything else in HaxrCorp, so two tables are
                // involved.
                {
                    use flipper_ui::font::{ROW_ACTIVE, TITLE};
                    use flipper_ui::theme::metric::{POPUP_MAX_W, POPUP_PAD_H, SIZE_GAP};

                    let size_line = TITLE.text_width("Size:")
                        + SIZE_GAP as u16
                        + TITLE.text_width(&num)
                        + if unit.is_empty() {
                            0
                        } else {
                            SIZE_GAP as u16 + TITLE.text_width(&unit)
                        };
                    let name_line = POPUP_PAD_H as u16
                        + size.0 as u16
                        + 4
                        + ROW_ACTIVE.text_width(&flipper_ui::boot::display_name(&profile.name))
                        + POPUP_PAD_H as u16;
                    // The body is whichever of the two lists is showing.
                    let mut body = 0u16;
                    for row in &rows {
                        body = body.max(TITLE.text_width(row.text.as_str()));
                    }
                    for line in &message {
                        body = body.max(TITLE.text_width(line.as_str()));
                    }
                    if !button.is_empty() {
                        body = body.max(TITLE.text_width(&button));
                    }
                    let widest = size_line
                        .max(name_line)
                        .max(body + 2 * POPUP_PAD_H as u16);
                    screen.set_boot_popup_w(
                        f32::from((widest + 12).min(POPUP_MAX_W as u16)),
                    );
                }
                screen.set_boot_popup_hint(button.as_str().into());
                screen.set_boot_popup_message(slint::ModelRc::new(slint::VecModel::from(message)));
                screen.set_boot_popup_rows(slint::ModelRc::new(slint::VecModel::from(rows)));
            }

            if percent != boot_last_shown {
                boot_last_shown = percent;
                let rows: Vec<flipper_ui::ui::BootRow> = boot_profiles
                    .iter()
                    .map(|p| {
                        let (icon, size) = match flipper_ui::boot::icon_key(&p.name, &p.origin) {
                            "minimal" => (1, (10.0, 8.0)),
                            "desktop" => (2, (10.0, 8.0)),
                            "router" => (3, (9.0, 7.0)),
                            "media" => (4, (10.0, 8.0)),
                            "graphics" => (5, (10.0, 8.0)),
                            _ => (6, (14.0, 14.0)),
                        };
                        flipper_ui::ui::BootRow {
                        label: flipper_ui::boot::display_name(&p.name).as_str().into(),
                        status: flipper_ui::boot::used_ago(&p.last_used, std::time::SystemTime::now())
                            .as_str()
                            .into(),
                        icon: icon,
                        // Each sprite's own size, so none is stretched.
                        icon_w: size.0,
                        icon_h: size.1,
                        auto: p.auto_boot,
                        }
                    })
                    .collect();
                screen.set_boot_rows(slint::ModelRc::new(slint::VecModel::from(rows)));
                screen.set_boot_selected(boot_selected);
                screen.set_boot_scroll(boot_scroll);
                screen.set_boot_countdown(percent);
                screen.set_boot_remaining(remaining);
                screen.set_boot_buttons(demo::labels(&["", "Info", "", "Edit", ""]));
            }
        }

        // Advance the dependency flow. Each stage hands over on its own channel,
        // so nothing here waits on a subprocess.
        match deps.take() {
            Some(Deps::Checking(idx, rx)) => match rx.try_recv() {
                Ok(m) if m.is_empty() => {
                    // Nothing missing: start it, no questions.
                    if let Some(entry) = apps.get(idx as usize) {
                        if matches!(
                            entry.kind,
                            flipper_ui::app::Kind::Console | flipper_ui::app::Kind::Wayland
                        ) {
                            launched_from = Screen::Apps;
                            #[cfg(feature = "wayland")]
                            {
                                wl_front = start_wayland(entry, &mut sway, &mut wl_apps);
                                wl_since = Instant::now();
                                if wl_front.is_some() {
                                    recents.open(&entry.name, flipper_ui::switcher::Kind::App);
                                    focused_app = None;
                                    continue;
                                }
                            }
                            console_front = start_console(
                                entry,
                                sink.as_mut(),
                                &mut consoles,
                                &mut console_keys,
                                &frame,
                            );
                            if console_front.is_some() {
                                recents.open(&entry.name, flipper_ui::switcher::Kind::App);
                                focused_app = None;
                            }
                            continue;
                        }
                        match flipper_ui::RunningApp::spawn(entry) {
                            Ok(app) => {
                                eprintln!("app            started {}", entry.name);
                                recents.open(&entry.name, flipper_ui::switcher::Kind::App);
                                apps_live.retain(|(n, _)| n != &entry.name);
                                apps_live.push((entry.name.clone(), app));
                                focused_app = Some(apps_live.len() - 1);
                            }
                            Err(e) => eprintln!("app            {} failed: {e}", entry.name),
                        }
                    }
                }
                Ok(m) => {
                    eprintln!("app            {} needs {}", 
                        apps.get(idx as usize).map_or("?", |a| a.name.as_str()), m.summary());
                    // Name what is being agreed to: consenting to an install
                    // without being told what is not consent. A Rust app that only
                    // needs compiling is asked about as a build, because calling
                    // that "0 packages" says nothing.
                    let apt = m.apt_all();
                    let count = apt.len() + m.pip.len();
                    let mut lines = Vec::new();
                    let right = if count == 0 && m.needs_build {
                        lines.push("Build this app?".to_string());
                        lines.push("Compiling takes a minute.".to_string());
                        "Build"
                    } else {
                        lines.push(format!(
                            "Install {count} package{}{}?",
                            if count == 1 { "" } else { "s" },
                            if m.needs_build { " and build" } else { "" }
                        ));
                        lines.extend(dialog_wrap(&apt, &m.pip));
                        "Install"
                    };
                    dialog = Some(Dialog {
                        lines,
                        left: "Cancel",
                        right,
                        act: DialogAct::InstallDeps,
                    });
                    deps = Some(Deps::Asking(idx, m));
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {
                    deps = Some(Deps::Checking(idx, rx));
                }
                Err(_) => {}
            },
            Some(Deps::Installing(idx, log_rx, done_rx)) => {
                while let Ok(line) = log_rx.try_recv() {
                    deps_log.extend(wrap_log(&line));
                }
                match done_rx.try_recv() {
                    Ok(result) => {
                        if let Err(e) = &result {
                            eprintln!("app            install failed: {e}");
                            // Only when it is not already there: stderr is
                            // streamed into the log, so the reason for a failed
                            // apt run has usually been shown once already and the
                            // title says it failed.
                            if !deps_log.iter().any(|l| e.contains(l.trim())) {
                                deps_log.extend(wrap_log(e));
                            }
                        }
                        deps = Some(Deps::Done(idx, result));
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => {
                        deps = Some(Deps::Installing(idx, log_rx, done_rx));
                    }
                    Err(_) => deps = Some(Deps::Done(idx, Err("install thread died".into()))),
                }
            }
            other => deps = other,
        }

        // The install log is its own screen: it can outlast several frames and has
        // more lines than a dialog can hold.
        if switcher.is_none()
            && focused_app.is_none()
            && matches!(deps, Some(Deps::Installing(..)) | Some(Deps::Done(..)))
        {
            let visible = flipper_ui::theme::count::LOG_VISIBLE_LINES;
            let total = deps_log.len() as i32;
            let bottom = (total - visible).max(0);
            // Following stops when the user scrolls back and resumes when they
            // return to the bottom, so a long apt run can be read as it goes.
            if deps_offset >= bottom {
                deps_follow = true;
            }
            // Follow in both stages, not just while installing: the last lines
            // arrive in the same iteration as the result, so a check for
            // Installing here leaves them off the bottom of the screen for good.
            if deps_follow {
                deps_offset = bottom;
            }
            deps_offset = deps_offset.clamp(0, bottom);
            let window: Vec<slint::SharedString> = deps_log
                .iter()
                .skip(deps_offset as usize)
                .take(visible as usize)
                .map(|l| slint::SharedString::from(l.as_str()))
                .collect();
            let done = matches!(deps, Some(Deps::Done(_, Ok(()))));
            screen.set_app_title(
                match &deps {
                    Some(Deps::Done(_, Ok(()))) => "Ready",
                    Some(Deps::Done(_, Err(_))) => "Failed",
                    _ => "Working",
                }
                .into(),
            );
            screen.set_app_lines(slint::ModelRc::new(slint::VecModel::from(window)));
            screen.set_app_log_total(total);
            screen.set_app_log_offset(deps_offset);
            screen.set_app_buttons(demo::labels(&if done {
                ["Back", "", "", "", "Run"]
            } else {
                ["Back", "", "", "", ""]
            }));
            screen.set_screen(Screen::AppLog);
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
                screen.set_detail_buttons(demo::labels(&open.buttons(&applying)));
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
        // Every app is polled, focused or not: an unread pipe fills and stops the
        // app that is writing to it, which would make a backgrounded app freeze
        // rather than keep working.
        for (i, (_, app)) in apps_live.iter_mut().enumerate() {
            if Some(i) != focused_app {
                let _ = app.poll();
            }
        }
        // Reap whatever has ended, in front or not. An app that exits or crashes
        // leaves nothing behind: not a card that leads to a dead process, and not
        // its last screen sitting there while every press only flashes a button.
        let mut gone: Vec<String> = Vec::new();
        for (name, app) in apps_live.iter_mut() {
            if app.finished() {
                gone.push(name.clone());
            }
        }
        // A backgrounded console app can end on its own too: nothing is watching
        // its VT, so the check belongs beside the one for scene apps.
        {
            let mut at = 0;
            while at < consoles.len() {
                if console_front == Some(at) || consoles[at].finished().is_none() {
                    at += 1;
                    continue;
                }
                let session = consoles.remove(at);
                let name = session.name.clone();
                drop(session);
                eprintln!("console        {name} ended in the background");
                recents.close(&name);
                if let Some(sw) = switcher.as_mut() {
                    if sw.drop_card(&name) {
                        switch_dirty = true;
                    }
                }
                // The one in front is indexed too, and removing from under it
                // would point it at the wrong app.
                if let Some(front) = console_front.as_mut() {
                    if *front > at {
                        *front -= 1;
                    }
                }
            }
        }

        for name in &gone {
            eprintln!("app            {name} ended");
            if let Some(at) = apps_live.iter().position(|(n, _)| n == name) {
                apps_live.remove(at);
                if focused_app == Some(at) {
                    focused_app = None;
                    let rows: Vec<flipper_ui::app::Row> = apps
                        .iter()
                        .map(|a| flipper_ui::app::Row::pair(&a.name, ""))
                        .collect();
                    apply_app_list(&screen, &rows, app_selected, &EMPTY_BUTTONS, (0, 0), app_scroll);
                    screen.set_screen(Screen::Apps);
                } else if focused_app.is_some_and(|f| f > at) {
                    // The list shifted under the focus.
                    focused_app = focused_app.map(|f| f - 1);
                }
            }
            recents.close(name);
            // A card on screen for something that has just ended is worse than one
            // vanishing: the stack closes up around it.
            if let Some(sw) = switcher.as_mut() {
                if sw.drop_card(name) {
                    switch_dirty = true;
                    if sw.is_empty() {
                        switcher = None;
                        screen.set_screen(Screen::Menu);
                    }
                }
            }
        }

        if let Some(app) = focused_app.and_then(|i| apps_live.get_mut(i)).map(|(_, a)| a) {
            let fresh = app.poll().is_some();
            if fresh || std::mem::take(&mut redraw_app) {
                let scene = app.scene().clone();
                screen.set_app_title(scene.title.as_str().into());
                match scene.kind {
                    flipper_ui::SceneKind::Log => {
                        screen.set_app_lines(slint::ModelRc::new(slint::VecModel::from(
                            scene
                                .rows
                                .iter()
                                .map(|row| slint::SharedString::from(row.label.as_str()))
                                .collect::<Vec<_>>(),
                        )));
                        screen.set_app_buttons(slint::ModelRc::new(slint::VecModel::from(
                            scene
                                .buttons
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
                            &scene.buttons,
                            (scene.total, scene.offset),
                            0,
                        );
                        screen.set_screen(Screen::AppForm);
                    }
                    // Framed rows, the Ethernet page's card generalised. The
                    // page is ours: the app says what each card holds and which
                    // one is selected, and the scrolling, the clipping and the
                    // marker's movement stay on this side.
                    flipper_ui::SceneKind::Cards => {
                        let dir = app.dir().to_path_buf();
                        let cards: Vec<flipper_ui::ui::CardItem> = scene
                            .rows
                            .iter()
                            .map(|r| flipper_ui::ui::CardItem {
                                icon: card_icon(&dir, &r.icon, &mut card_icons),
                                name: r.label.as_str().into(),
                                info: r.info.as_str().into(),
                                right: r.value.as_str().into(),
                                pill: r.pill,
                                dim: r.dim,
                                actionable: r.actionable,
                            })
                            .collect();
                        // The viewport is ours. How many cards fit depends on
                        // whether the page is showing a progress track, which the
                        // app has no way of working out, so it sends every card and
                        // says which one is selected.
                        let count = cards.len() as i32;
                        screen.set_app_cards(slint::ModelRc::new(slint::VecModel::from(cards)));
                        screen.set_app_note(scene.note.as_str().into());
                        let shown = {
                            use flipper_ui::theme::metric::{
                                CARDS_BAR_GAP, CARDS_TOP_PAD, CARD_GAP, CARD_H, GAUGE_H,
                                STATUS_BAR_H,
                            };
                            // The bar is a gauge: its fill plus the frame around it.
                            let top = STATUS_BAR_H
                                + CARDS_TOP_PAD
                                + if scene.busy { GAUGE_H + 2 + CARDS_BAR_GAP } else { 0 };
                            (130 - top) / (CARD_H + CARD_GAP)
                        };
                        let selected = scene.selected.clamp(0, (count - 1).max(0));
                        app_cards_scroll = app_cards_scroll.clamp(
                            (selected - shown + 1).max(0),
                            selected.min((count - shown).max(0)),
                        );
                        screen.set_app_selected(selected);
                        screen.set_app_scroll(app_cards_scroll);
                        screen.set_app_total(count);
                        screen.set_app_busy(scene.busy);
                        screen.set_app_percent(scene.percent);
                        screen.set_app_buttons(slint::ModelRc::new(slint::VecModel::from(
                            scene
                                .buttons
                                .iter()
                                .map(|b| slint::SharedString::from(b.as_str()))
                                .collect::<Vec<_>>(),
                        )));
                        screen.set_screen(Screen::AppCards);
                    }
                    // The app painted it: hand the bitmap over as an image and
                    // let it have the whole panel.
                    flipper_ui::SceneKind::Canvas => {
                        if let Some(image) = canvas_image(&scene.canvas) {
                            screen.set_app_bitmap(image);
                        }
                        let texts: Vec<flipper_ui::ui::CanvasText> = scene
                            .texts
                            .iter()
                            .map(|t| flipper_ui::ui::CanvasText {
                                x: t.x as f32,
                                y: t.y as f32,
                                text: t.text.as_str().into(),
                                font: t.font,
                                align: t.align,
                                white: t.white,
                            })
                            .collect();
                        screen.set_app_texts(slint::ModelRc::new(slint::VecModel::from(texts)));
                        screen.set_app_status_bar(scene.status_bar);
                        screen.set_app_buttons(slint::ModelRc::new(slint::VecModel::from(
                            scene
                                .buttons
                                .iter()
                                .map(|b| slint::SharedString::from(b.as_str()))
                                .collect::<Vec<_>>(),
                        )));
                        screen.set_screen(Screen::AppCanvas);
                    }
                    // Rows that can be a gauge, a divider or a line of text, drawn
                    // by the same body the Settings screens use. An app reporting
                    // progress needs a bar, and this is where the bar already is.
                    flipper_ui::SceneKind::Detail => {
                        let rows: Vec<flipper_ui::ui::DetailRow> = scene
                            .rows
                            .iter()
                            .map(|r| flipper_ui::ui::DetailRow {
                                kind: r.kind,
                                label: r.label.as_str().into(),
                                value: r.value.as_str().into(),
                                percent: r.percent,
                                dim: r.dim,
                            })
                            .collect();
                        app_detail_rows = rows.len() as i32;
                        screen.set_detail_rows(slint::ModelRc::new(slint::VecModel::from(rows)));
                        // Clamped rather than reset: an app resending its scene ten
                        // times a second must not drag the view back to the top
                        // under someone who has scrolled down.
                        let visible = flipper_ui::theme::count::DETAIL_VISIBLE_ROWS;
                        app_detail_offset =
                            app_detail_offset.clamp(0, (app_detail_rows - visible).max(0));
                        screen.set_detail_offset(app_detail_offset);
                        screen.set_detail_buttons(slint::ModelRc::new(slint::VecModel::from(
                            scene
                                .buttons
                                .iter()
                                .map(|h| slint::SharedString::from(h.as_str()))
                                .collect::<Vec<_>>(),
                        )));
                        screen.set_breadcrumb(
                            if scene.title.is_empty() {
                                String::new()
                            } else {
                                format!("> {}", scene.title)
                            }
                            .as_str()
                            .into(),
                        );
                        screen.set_screen(Screen::AppDetail);
                    }
                }
            }
        }

        // The marker on a busy cards page moves on the clock, so it needs a
        // repaint asked for: an app scanning a network sends a scene a second at
        // best, and between those the panel would sit still while work goes on.
        if screen.get_screen() == Screen::AppCards
            && screen.get_app_busy()
            && slide_shown.elapsed() >= Duration::from_millis(33)
        {
            slide_shown = Instant::now();
            // 60px a second along the track, which is the speed the painted
            // version ran at.
            // Inside the frame, so the marker never sits on the border.
            let span = flipper_ui::theme::metric::CARD_W
                - flipper_ui::theme::metric::CARDS_MARKER_W
                - 2;
            screen.set_app_slide(((slide_at.elapsed().as_millis() / 17) % span as u128) as i32);
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
        screen.set_pressed(press.row_pressed());
        screen.set_arrow_pressed(arrow.map_or(0, |(dir, _)| dir));
        // Only when the dialog actually changed.
        //
        // Handing Slint a freshly built model is a change even when its contents
        // are identical, so doing this every iteration marked the whole window
        // dirty every iteration and the panel repainted forever. On a static
        // screen that pinned the remote view at its 10fps cap and kept the SPI
        // bus busy for nothing. Setting a scalar property to the same value is
        // free, because Slint compares it; a model is not.
        // The switcher is part of the key: a dialog does not draw over the cards,
        // and closing the switcher has to put it back, which means the comparison
        // has to notice the switcher opening and closing.
        let covered = switcher.is_some() || focused_app.is_some();
        let dialog_key = (
            covered,
            dialog
                .as_ref()
                .filter(|_| !covered)
                .map(|d| (d.lines.clone(), d.left, d.right)),
        );
        if dialog_key != last_dialog {
            last_dialog = dialog_key;
            screen.set_modal_lines(slint::ModelRc::new(slint::VecModel::from(
                dialog
                    .as_ref()
                    .filter(|_| !covered)
                    .map(|d| {
                        d.lines
                            .iter()
                            .map(|l| slint::SharedString::from(l.as_str()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default(),
            )));
            screen.set_modal_left(dialog.as_ref().map_or("", |d| d.left).into());
            screen.set_modal_right(dialog.as_ref().map_or("", |d| d.right).into());
        }
        screen.set_modal_pressed_slot(press.dialog_slot());
        screen.set_detail_pressed_slot(if screen.get_screen() == Screen::Detail {
            press.soft_slot()
        } else {
            -1
        });
        screen.set_idle_pressed_slot(press.soft_slot());
        screen.set_menu_pressed_slot(press.soft_slot());
        screen.set_app_pressed_slot(press.soft_slot());
        screen.set_kb_pressed_slot(press.soft_slot());
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
                // Under a compositor the browser view is fed from the mirror instead,
                // so it shows whatever is on the panel rather than only what we drew.
                // Our own frames still go there when there is no compositor to ask.
                #[cfg(feature = "wayland")]
                let ours = !wayland;
                #[cfg(not(feature = "wayland"))]
                let ours = true;
                if ours {
                    view.commit(composed, damage)?;
                }
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

        // What the panel actually shows, for anything watching it. Ten times a
        // second is what the browser view asks of the old path, and the cost is one
        // screencopy of 147KB plus a grey conversion, against the panel's own 16ms
        // for a commit.
        #[cfg(all(feature = "wayland", feature = "remote"))]
        if wayland && mirrored.elapsed() >= Duration::from_millis(100) {
            let watching = web.as_ref().is_some_and(|v| v.viewers() > 0);
            if watching {
                if mirror.is_none() {
                    match flipper_ui::wl::Mirror::attach(
                        u32::from(PANEL_W),
                        u32::from(PANEL_H),
                    ) {
                        Ok(m) => {
                            eprintln!("mirror         reading the panel through the compositor");
                            mirror = Some(m);
                        }
                        Err(e) => eprintln!("mirror         unavailable: {e}"),
                    }
                }
                if let Some(m) = mirror.as_mut() {
                    match m.frame(Duration::from_millis(200)) {
                        Ok(Some(grey)) => {
                            let seen: Vec<flipper_ui::Gray8> =
                                grey.iter().map(|&v| flipper_ui::Gray8(v)).collect();
                            if let Some(view) = web.as_mut() {
                                view.commit(
                                    Frame::new(&seen, PANEL_W, PANEL_H),
                                    flipper_ui::Rect::new(0, 0, PANEL_W, PANEL_H),
                                )?;
                            }
                        }
                        Ok(None) => {}
                        Err(e) => {
                            eprintln!("mirror         dropped: {e}");
                            mirror = None;
                        }
                    }
                }
            } else if mirror.is_some() {
                // Nobody is looking: stop reading the output rather than paying for
                // frames no one collects.
                eprintln!("mirror         released, nothing watching");
                mirror = None;
            }
            mirrored = Instant::now();
        }

        // A port that was taken at startup will not stay taken: the usual cause is
        // an older instance still shutting down, and the endpoint carries the two
        // keys the compositor reserves for us, so keep trying rather than running on
        // half deaf.
        #[cfg(feature = "remote")]
        if web.is_none() && remote.is_some() && rebind.elapsed() >= Duration::from_secs(5) {
            rebind = Instant::now();
            let addr = remote.clone().unwrap_or_default();
            let dir = assets_dir.clone();
            if let Ok(view) = flipper_ui::remote::RemoteView::bind_with_peer(&addr, dir, peer.clone())
            {
                eprintln!("remote view    http://{}/ (bound on retry)", view.addr());
                web = Some(view);
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
    _wayland: bool,
) -> std::io::Result<()> {
    Err(std::io::Error::other(
        "rebuild with --features device,slint",
    ))
}
