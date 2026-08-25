//! Uptime, as a flipctl app: the example of one written in Rust.
//!
//! The app draws its own screen. It composes flipctl's list body from the
//! framework in crates/flipctl-app, fills in the rows it reads out of /proc, and
//! paints them into its own Wayland surface: no protocol, no scene, and the same
//! interface as the rest of the device because the widget and the tokens are the
//! same ones flipctl's menus use.
//!
//! It wraps `uptime`, which is why the manifest declares procps, and reads
//! /proc directly for the numbers that command rounds off.

use std::time::Duration;

use flipctl_app::{Key, StatusSource};
use slint::{ComponentHandle, Model, ModelRc, VecModel};

slint::include_modules!();

/// Seconds as a person reads a duration: the two largest units that matter.
fn duration(total: f64) -> String {
    let secs = total as u64;
    let (d, h, m) = (secs / 86400, (secs % 86400) / 3600, (secs % 3600) / 60);
    if d > 0 {
        format!("{d}d {h}h")
    } else if h > 0 {
        format!("{h}h {m}m")
    } else {
        format!("{m}m {}s", secs % 60)
    }
}

fn read(path: &str) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

/// Run `uptime` with the given flags and return its one line of output.
fn run_uptime(args: &[&str]) -> String {
    std::process::Command::new("uptime")
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "--".into())
}

fn rows() -> Vec<(String, String)> {
    let proc_uptime = read("/proc/uptime");
    let mut fields = proc_uptime.split_whitespace();
    let up: f64 = fields.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let idle: f64 = fields.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);

    let load = read("/proc/loadavg");
    let mut load_fields = load.split_whitespace();
    let one = load_fields.next().unwrap_or("--").to_string();
    let five = load_fields.next().unwrap_or("--").to_string();
    let fifteen = load_fields.next().unwrap_or("--").to_string();
    // The fourth field is running/total tasks.
    let tasks = load_fields.next().unwrap_or("--").to_string();

    // Idle time is summed across cores, so it exceeds uptime on anything with
    // more than one. Divided back down it reads as the share of a core that went
    // unused, which is the useful figure.
    let cores = std::thread::available_parallelism().map_or(1.0, |n| n.get() as f64);
    let busy = if up > 0.0 {
        format!("{:.0}%", (1.0 - (idle / cores / up).min(1.0)) * 100.0)
    } else {
        "--".into()
    };

    vec![
        ("Uptime".into(), duration(up)),
        ("Load".into(), format!("{one} {five} {fifteen}")),
        ("Tasks".into(), tasks),
        ("Busy since boot".into(), busy),
        ("Booted".into(), boot_time()),
    ]
}

/// When the machine came up, straight from `uptime -s`.
///
/// procps already turns /proc/stat's btime into a date, so wrapping it beats
/// carrying a days-to-civil conversion here. This is the part of the command that
/// is genuinely worth wrapping.
fn boot_time() -> String {
    run_uptime(&["-s"])
}


/// The rows as the list body wants them: a label on the left, a value on the
/// right, and no icon or chevrons.
fn items() -> Vec<ListItem> {
    rows()
        .into_iter()
        .map(|(label, value)| ListItem {
            label: label.into(),
            status: value.into(),
            icon: 0,
            frames: 1,
            chevrons: 0,
            value: Default::default(),
            at_start: false,
            at_end: false,
        })
        .collect()
}

/// Re-read /proc and put the numbers on screen, keeping the selection.
fn refresh(ui: &AppWindow) {
    let rows = items();
    ui.set_total(rows.len() as i32);
    ui.set_rows(ModelRc::new(VecModel::from(rows)));
}

fn main() -> Result<(), slint::PlatformError> {
    let ui = AppWindow::new()?;
    refresh(&ui);

    // The panel's own bar, read here rather than handed over: an app has the same
    // access to sysfs that flipctl does.
    let mut status = StatusSource::new(Duration::from_secs(2));
    flipctl_app::apply_status!(&ui, PanelStatus, status.current());

    let tick = slint::Timer::default();
    let refreshing = ui.as_weak();
    tick.start(slint::TimerMode::Repeated, Duration::from_secs(1), move || {
        let Some(ui) = refreshing.upgrade() else {
            return;
        };
        refresh(&ui);
        if let Some(now) = status.poll() {
            flipctl_app::apply_status!(&ui, PanelStatus, now);
        }
    });

    let keys = ui.as_weak();
    ui.on_keyed(move |text, down| {
        let Some(ui) = keys.upgrade() else {
            return;
        };
        let Some(key) = Key::from_slint(text.as_str()) else {
            return;
        };
        // The soft bar shows which button is held, as it does everywhere else.
        ui.set_pressed_slot(match (down, key.soft_slot()) {
            (true, Some(slot)) => slot as i32,
            _ => -1,
        });
        if !down {
            return;
        }
        let total = ui.get_rows().row_count() as i32;
        match key {
            Key::Down if total > 0 => ui.set_selected((ui.get_selected() + 1).rem_euclid(total)),
            Key::Up if total > 0 => ui.set_selected((ui.get_selected() - 1).rem_euclid(total)),
            // Every draw re-reads /proc, so Run is the refresh.
            Key::Run | Key::Ok => refresh(&ui),
            Key::Escape | Key::Back => {
                let _ = slint::quit_event_loop();
            }
            _ => {}
        }
    });

    ui.run()
}
