//! Uptime, as a flipctl app: the example of one written in Rust.
//!
//! An app never draws. It writes a scene description and reads key events, so it
//! links no GUI toolkit and needs no crates: the protocol is newline-delimited
//! JSON over stdin and stdout.
//!
//!     app -> flipctl   {"screen": {...}}
//!     flipctl -> app   {"key": "run", "down": true}
//!
//! It wraps `uptime`, which is why the manifest declares procps, and reads
//! /proc directly for the numbers that command rounds off.

use std::io::{BufRead, Write};

/// Rows the form body shows at once.
const WINDOW: usize = 5;

/// Escape the few characters a JSON string cannot hold literally.
///
/// Hand-written rather than pulled from a crate: the only strings here are
/// numbers, labels and one line of `uptime` output, and a dependency to quote
/// them would be larger than the program.
fn json(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' | '\r' | '\t' => out.push(' '),
            c if (c as u32) < 0x20 => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

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

fn draw(selected: usize) {
    let rows = rows();
    let mut body = String::new();
    for (i, (label, value)) in rows.iter().skip(offset(selected, rows.len())).take(WINDOW).enumerate() {
        if i > 0 {
            body.push(',');
        }
        body.push_str(&format!(
            "{{\"label\":\"{}\",\"value\":\"{}\"}}",
            json(label),
            json(value)
        ));
    }
    let off = offset(selected, rows.len());
    let mut out = std::io::stdout().lock();
    let _ = writeln!(
        out,
        "{{\"screen\":{{\"type\":\"form\",\"title\":\"Uptime\",\"rows\":[{body}],\
         \"selected\":{},\"total\":{},\"offset\":{off},\
         \"buttons\":[\"Back\",\"\",\"\",\"\",\"Refresh\"]}}}}",
        selected - off,
        rows.len()
    );
    let _ = out.flush();
}

/// First row to send, keeping the selection inside the window.
///
/// The app windows its own rows and says where they sit, which is what lets
/// flipctl draw a scrollbar without being handed every row every frame.
fn offset(selected: usize, total: usize) -> usize {
    if total <= WINDOW {
        0
    } else {
        selected.saturating_sub(WINDOW - 1).min(total - WINDOW)
    }
}

fn main() {
    let mut selected = 0usize;
    draw(selected);

    let total = rows().len();
    for line in std::io::stdin().lock().lines().map_while(Result::ok) {
        // The messages are small and their shape is fixed, so the two fields are
        // found by looking for them rather than by parsing.
        if !line.contains("\"down\":true") && !line.contains("\"down\": true") {
            continue;
        }
        let key = line
            .split("\"key\"")
            .nth(1)
            .and_then(|rest| rest.split('"').nth(1))
            .unwrap_or("");
        match key {
            "down" => selected = (selected + 1) % total,
            "up" => selected = (selected + total - 1) % total,
            // Every draw re-reads /proc, so this is the refresh.
            "run" | "ok" => {}
            "esc" | "back" => return,
            _ => continue,
        }
        draw(selected);
    }
}
