//! A resource monitor, in the shape btop draws one: what every core is doing,
//! what memory is doing, both of them over the last few minutes, and which
//! processes are responsible.
//!
//! An app never draws. It writes a scene description and reads key events, so it
//! links no GUI toolkit and needs no crates: the protocol is newline-delimited
//! JSON over stdin and stdout.
//!
//!     app -> flipctl   {"screen": {...}}
//!     flipctl -> app   {"key": "run", "down": true}
//!
//! Four screens. Three of them are lists of rows with bars, which flipctl already
//! knows how to draw, so they are described rather than painted and come out
//! looking like the rest of the device. The fourth is a pair of history graphs,
//! which is not a list of anything, so that one the app paints: a panel-sized
//! greyscale bitmap with the labels left to flipctl, since an app has no font.

use std::io::{BufRead, Write};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// How often the numbers are re-read, and so how much time one column of the
/// graph stands for.
const TICK: Duration = Duration::from_secs(1);

/// Columns of history the graphs hold: the panel is 256 wide, the frames sit 2px
/// in from each edge and have their own border, so 248 samples fit. At a second
/// each that is four minutes, which is the useful window for "what just happened".
const HISTORY: usize = 248;

/// Rows a list body shows at once.
const WINDOW: usize = 8;

const PANEL_W: usize = 256;
const PANEL_H: usize = 144;
/// The system's status bar owns the rows above this, and its soft buttons the
/// bottom 14, which is what the graphs are laid out inside.
const TOP: usize = 13;

// ── /proc ──────────────────────────────────────────────────────────────────

fn read(path: &str) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

/// One reading of every core's busy and total jiffies.
///
/// Jiffies since boot, which say nothing on their own: a load is the difference
/// between two readings, which is why these are kept rather than used.
#[derive(Clone, Default)]
struct Cpu {
    /// Index 0 is the "cpu" aggregate line, the rest are the cores in order.
    busy: Vec<u64>,
    total: Vec<u64>,
}

fn read_cpu() -> Cpu {
    let stat = read("/proc/stat");
    let mut cpu = Cpu::default();
    for line in stat.lines() {
        if !line.starts_with("cpu") {
            break;
        }
        let fields: Vec<u64> = line
            .split_whitespace()
            .skip(1)
            .filter_map(|f| f.parse().ok())
            .collect();
        if fields.len() < 5 {
            continue;
        }
        let total: u64 = fields.iter().sum();
        // Idle and iowait are both the core having nothing to do; every other
        // field is work of some kind, steal and guest included.
        let idle = fields[3] + fields[4];
        cpu.busy.push(total - idle);
        cpu.total.push(total);
    }
    cpu
}

/// Busy share per entry between two readings, as whole percentages.
fn load(now: &Cpu, before: &Cpu) -> Vec<i32> {
    now.busy
        .iter()
        .zip(now.total.iter())
        .enumerate()
        .map(|(i, (busy, total))| {
            let (was_busy, was_total) = match (before.busy.get(i), before.total.get(i)) {
                (Some(b), Some(t)) => (*b, *t),
                _ => return 0,
            };
            let span = total.saturating_sub(was_total);
            if span == 0 {
                return 0;
            }
            (busy.saturating_sub(was_busy) * 100 / span).min(100) as i32
        })
        .collect()
}

/// What /proc/meminfo says, in kB, by the names it uses.
fn meminfo() -> Vec<(String, u64)> {
    read("/proc/meminfo")
        .lines()
        .filter_map(|line| {
            let (name, rest) = line.split_once(':')?;
            let value = rest.split_whitespace().next()?.parse().ok()?;
            Some((name.to_string(), value))
        })
        .collect()
}

fn field(info: &[(String, u64)], name: &str) -> u64 {
    info.iter().find(|(n, _)| n == name).map_or(0, |(_, v)| *v)
}

/// kB as a person reads a size, to one decimal where that helps.
fn size(kb: u64) -> String {
    if kb >= 1024 * 1024 {
        format!("{:.1}G", kb as f64 / (1024.0 * 1024.0))
    } else if kb >= 1024 {
        format!("{}M", kb / 1024)
    } else {
        format!("{kb}K")
    }
}

/// Every thermal zone the kernel exposes, by its own name.
///
/// Read fresh each tick rather than enumerated once: a zone can appear when a
/// driver loads, and the cost is a handful of small reads.
fn temperatures() -> Vec<(String, i32)> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir("/sys/class/thermal") else {
        return out;
    };
    let mut zones: Vec<std::path::PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("thermal_zone"))
        })
        .collect();
    zones.sort();
    for zone in zones {
        let name = read(&zone.join("type").to_string_lossy()).trim().to_string();
        let milli: i32 = read(&zone.join("temp").to_string_lossy())
            .trim()
            .parse()
            .unwrap_or(0);
        if !name.is_empty() && milli != 0 {
            out.push((name, milli / 1000));
        }
    }
    out
}

/// One process, and enough of its /proc/<pid>/stat to charge it for CPU time.
#[derive(Clone)]
struct Proc {
    pid: u32,
    name: String,
    jiffies: u64,
    rss_kb: u64,
}

fn processes() -> Vec<Proc> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|n| n.parse::<u32>().ok())
        else {
            continue;
        };
        let stat = read(&format!("/proc/{pid}/stat"));
        // The command is in parentheses and can itself contain spaces and
        // parentheses, so the fields after it are found from the last ')' rather
        // than by splitting the whole line.
        let (Some(open), Some(close)) = (stat.find('('), stat.rfind(')')) else {
            continue;
        };
        let name = stat[open + 1..close].to_string();
        let rest: Vec<&str> = stat[close + 1..].split_whitespace().collect();
        // stat's fields are 1-based and comm is field 2, so utime (14) and stime
        // (15) are the 11th and 12th of what follows, and rss (24) the 21st.
        if rest.len() < 21 {
            continue;
        }
        let utime: u64 = rest[11].parse().unwrap_or(0);
        let stime: u64 = rest[12].parse().unwrap_or(0);
        let rss_pages: u64 = rest[21].parse().unwrap_or(0);
        out.push(Proc {
            pid,
            name,
            jiffies: utime + stime,
            rss_kb: rss_pages * 4,
        });
    }
    out
}

// ── the state the screens read ─────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq)]
enum Screen {
    Cpu,
    Memory,
    Graph,
    Procs,
}

struct Monitor {
    screen: Screen,
    selected: usize,
    cpu: Cpu,
    /// Busy share per core, aggregate first, from the last two readings.
    loads: Vec<i32>,
    mem: Vec<(String, u64)>,
    temps: Vec<(String, i32)>,
    procs: Vec<Proc>,
    /// Share of one core per process since the last reading, by pid.
    proc_load: Vec<(u32, String, i32, u64)>,
    /// The graphs' columns, oldest first.
    cpu_history: Vec<i32>,
    mem_history: Vec<i32>,
    /// Ticks per second, for charging processes their share.
    hz: u64,
}

impl Monitor {
    fn new() -> Self {
        Self {
            screen: Screen::Cpu,
            selected: 0,
            cpu: read_cpu(),
            loads: Vec::new(),
            mem: meminfo(),
            temps: temperatures(),
            procs: processes(),
            proc_load: Vec::new(),
            cpu_history: Vec::new(),
            mem_history: Vec::new(),
            // USER_HZ, which the kernel fixes at 100 on every architecture Linux
            // reports jiffies in. sysconf would be a libc call for a constant.
            hz: 100,
        }
    }

    /// Re-read everything and fold the readings into the histories.
    fn tick(&mut self, elapsed: Duration) {
        let cpu = read_cpu();
        self.loads = load(&cpu, &self.cpu);
        self.cpu = cpu;
        self.mem = meminfo();
        self.temps = temperatures();

        let procs = processes();
        // A process is charged the jiffies it gained, as a share of one core, so
        // a thread-hungry process can read over 100 the way top reports it.
        let span = (elapsed.as_secs_f64() * self.hz as f64).max(1.0);
        let mut charged: Vec<(u32, String, i32, u64)> = procs
            .iter()
            .filter_map(|p| {
                let before = self.procs.iter().find(|old| old.pid == p.pid)?;
                let gained = p.jiffies.saturating_sub(before.jiffies);
                Some((
                    p.pid,
                    p.name.clone(),
                    (gained as f64 / span * 100.0).round() as i32,
                    p.rss_kb,
                ))
            })
            .collect();
        // Busiest first, and memory decides ties: at idle every process has
        // gained nothing, and a list ordered by pid then tells you nothing.
        charged.sort_by(|a, b| b.2.cmp(&a.2).then(b.3.cmp(&a.3)));
        self.proc_load = charged;
        self.procs = procs;

        let cpu_now = self.loads.first().copied().unwrap_or(0);
        self.push(cpu_now);
    }

    /// Fold this tick's readings onto the graphs.
    fn push(&mut self, cpu_now: i32) {
        let total = field(&self.mem, "MemTotal");
        let available = field(&self.mem, "MemAvailable");
        let used = total.saturating_sub(available);
        let mem_pct = if total > 0 {
            (used * 100 / total) as i32
        } else {
            0
        };
        for (history, value) in [
            (&mut self.cpu_history, cpu_now),
            (&mut self.mem_history, mem_pct),
        ] {
            history.push(value);
            if history.len() > HISTORY {
                let excess = history.len() - HISTORY;
                history.drain(0..excess);
            }
        }
    }

    fn total_load(&self) -> i32 {
        self.loads.first().copied().unwrap_or(0)
    }

    fn mem_percent(&self) -> i32 {
        self.mem_history.last().copied().unwrap_or(0)
    }
}

// ── writing scenes ─────────────────────────────────────────────────────────

/// Escape the few characters a JSON string cannot hold literally.
///
/// Hand-written rather than pulled from a crate: the only strings here are
/// labels, sizes and process names, and a dependency to quote them would be
/// larger than the program.
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

/// One row of a detail scene: a label and a value, a bar, a divider or a line.
enum Row {
    Pair(String, String),
    /// Label, fill, and whether it draws in the dim tone.
    Gauge(String, i32, bool),
    Divider,
}

impl Row {
    fn write(&self, out: &mut String) {
        match self {
            Row::Pair(label, value) => out.push_str(&format!(
                "{{\"label\":\"{}\",\"value\":\"{}\"}}",
                json(label),
                json(value)
            )),
            Row::Gauge(label, percent, dim) => out.push_str(&format!(
                "{{\"kind\":\"gauge\",\"label\":\"{}\",\"percent\":{},\"dim\":{}}}",
                json(label),
                (*percent).clamp(0, 100),
                dim
            )),
            Row::Divider => out.push_str("{\"kind\":\"divider\"}"),
        }
    }
}

/// The soft buttons, the same on every screen so the app is one press from any of
/// its views. The screen you are on is not offered again.
fn buttons(screen: Screen) -> String {
    let label = |want: Screen, text: &str| {
        if screen == want {
            String::new()
        } else {
            text.to_string()
        }
    };
    let slots = [
        "Close".to_string(),
        label(Screen::Cpu, "CPU"),
        label(Screen::Memory, "Mem"),
        label(Screen::Graph, "Graph"),
        label(Screen::Procs, "Procs"),
    ];
    slots
        .iter()
        .map(|s| format!("\"{}\"", json(s)))
        .collect::<Vec<_>>()
        .join(",")
}

fn detail(title: &str, rows: &[Row], selected: usize, screen: Screen) {
    // The window the app sends, and where it sits, so flipctl can draw a
    // scrollbar without being handed every row.
    let offset = if rows.len() <= WINDOW {
        0
    } else {
        selected.saturating_sub(WINDOW - 1).min(rows.len() - WINDOW)
    };
    let mut body = String::new();
    for (i, row) in rows.iter().skip(offset).take(WINDOW).enumerate() {
        if i > 0 {
            body.push(',');
        }
        row.write(&mut body);
    }
    let mut out = std::io::stdout().lock();
    let _ = writeln!(
        out,
        "{{\"screen\":{{\"type\":\"detail\",\"title\":\"{}\",\"rows\":[{body}],\
         \"selected\":{},\"total\":{},\"offset\":{offset},\"buttons\":[{}]}}}}",
        json(title),
        selected.saturating_sub(offset),
        rows.len(),
        buttons(screen)
    );
    let _ = out.flush();
}

fn cpu_screen(m: &Monitor) {
    let mut rows = Vec::new();
    for (i, pct) in m.loads.iter().skip(1).enumerate() {
        // Short labels on purpose: flipctl starts an app's bar clear of its own
        // label, so a label carrying the reading would move the bar every second.
        // The reading goes in the title, where it holds still.
        rows.push(Row::Gauge(format!("C{i}"), *pct, false));
    }
    detail(
        &format!("CPU {}%", m.total_load()),
        &rows,
        m.selected.min(rows.len().saturating_sub(1)),
        Screen::Cpu,
    );
}

fn memory_screen(m: &Monitor) {
    let total = field(&m.mem, "MemTotal");
    let available = field(&m.mem, "MemAvailable");
    let used = total.saturating_sub(available);
    let swap_total = field(&m.mem, "SwapTotal");
    let swap_used = swap_total.saturating_sub(field(&m.mem, "SwapFree"));

    let mut rows = vec![
        Row::Pair("Used".into(), format!("{} / {}", size(used), size(total))),
        Row::Gauge("Memory".into(), m.mem_percent(), false),
    ];
    if swap_total > 0 {
        rows.push(Row::Gauge(
            "Swap".into(),
            (swap_used * 100 / swap_total) as i32,
            false,
        ));
    } else {
        // Said rather than left out: an absent swap row reads as a screen that
        // forgot to look.
        rows.push(Row::Pair("Swap".into(), "none".into()));
    }
    rows.push(Row::Divider);
    rows.push(Row::Pair("Cached".into(), size(field(&m.mem, "Cached"))));
    rows.push(Row::Pair("Buffers".into(), size(field(&m.mem, "Buffers"))));
    rows.push(Row::Pair("Dirty".into(), size(field(&m.mem, "Dirty"))));
    rows.push(Row::Pair(
        "Shared".into(),
        size(field(&m.mem, "Shmem")),
    ));
    if !m.temps.is_empty() {
        rows.push(Row::Divider);
        for (name, celsius) in &m.temps {
            rows.push(Row::Pair(name.clone(), format!("{celsius}C")));
        }
    }
    detail("Memory", &rows, m.selected.min(rows.len() - 1), Screen::Memory);
}

fn procs_screen(m: &Monitor) {
    let rows: Vec<Row> = m
        .proc_load
        .iter()
        .take(24)
        .map(|(_, name, pct, rss)| {
            Row::Pair(name.clone(), format!("{pct}% {}", size(*rss)))
        })
        .collect();
    let rows = if rows.is_empty() {
        vec![Row::Pair("No readings yet".into(), String::new())]
    } else {
        rows
    };
    detail(
        &format!("Processes {}", m.procs.len()),
        &rows,
        m.selected.min(rows.len() - 1),
        Screen::Procs,
    );
}

// ── the graphs, which the app paints ───────────────────────────────────────

/// The two frames: label row, then the graph under it.
const CPU_LABEL_Y: usize = TOP;
const CPU_GRAPH_Y: usize = TOP + 11;
const GRAPH_H: usize = 46;
const MEM_LABEL_Y: usize = CPU_GRAPH_Y + GRAPH_H + 2;
const MEM_GRAPH_Y: usize = MEM_LABEL_Y + 11;
const GRAPH_X: usize = 2;
const GRAPH_W: usize = PANEL_W - 2 * GRAPH_X;

struct Canvas {
    px: Vec<u8>,
}

impl Canvas {
    fn new() -> Self {
        Self {
            px: vec![255; PANEL_W * PANEL_H],
        }
    }

    fn set(&mut self, x: usize, y: usize, v: u8) {
        if x < PANEL_W && y < PANEL_H {
            self.px[y * PANEL_W + x] = v;
        }
    }

    /// A one-pixel outline with its corners cut, which is the corner every frame
    /// in this system has.
    fn frame(&mut self, x: usize, y: usize, w: usize, h: usize, radius: usize) {
        for i in radius..w - radius {
            self.set(x + i, y, 0);
            self.set(x + i, y + h - 1, 0);
        }
        for i in radius..h - radius {
            self.set(x, y + i, 0);
            self.set(x + w - 1, y + i, 0);
        }
        for i in 0..radius {
            let inset = radius - 1 - i;
            self.set(x + inset, y + i, 0);
            self.set(x + w - 1 - inset, y + i, 0);
            self.set(x + inset, y + h - 1 - i, 0);
            self.set(x + w - 1 - inset, y + h - 1 - i, 0);
        }
    }

    /// One history, as a column per sample filled from the bottom.
    ///
    /// Newest at the right, which is the way every graph of this kind reads, and
    /// a history shorter than the frame leaves the left end empty rather than
    /// stretching: the graph is a record of time, so a column has to mean the
    /// same span wherever it sits.
    fn graph(&mut self, x: usize, y: usize, w: usize, h: usize, history: &[i32]) {
        self.frame(x, y, w, h, 2);
        let inner_w = w - 2;
        let inner_h = h - 2;
        let shown = history.len().min(inner_w);
        for (i, value) in history[history.len() - shown..].iter().enumerate() {
            let column = x + 1 + inner_w - shown + i;
            let filled = (*value as usize * inner_h) / 100;
            for row in 0..filled {
                // The tone says how hard it is working: the top of a tall column
                // is ink, the body of a quiet one is grey, so a glance reads the
                // shape and a closer look reads the level.
                let tone = if *value >= 80 { 0 } else { 0x99 };
                self.set(column, y + h - 2 - row, tone);
            }
        }
        // The half-way rule, so a column can be read against something.
        for i in (1..inner_w).step_by(4) {
            self.set(x + i, y + h / 2, 0x99);
        }
    }

    fn base64(&self) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity(self.px.len().div_ceil(3) * 4);
        for chunk in self.px.chunks(3) {
            let b = [
                chunk[0],
                chunk.get(1).copied().unwrap_or(0),
                chunk.get(2).copied().unwrap_or(0),
            ];
            let bits = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            out.push(ALPHABET[(bits >> 18 & 63) as usize] as char);
            out.push(ALPHABET[(bits >> 12 & 63) as usize] as char);
            out.push(if chunk.len() > 1 {
                ALPHABET[(bits >> 6 & 63) as usize] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                ALPHABET[(bits & 63) as usize] as char
            } else {
                '='
            });
        }
        out
    }
}

fn graph_screen(m: &Monitor) {
    let mut canvas = Canvas::new();
    canvas.graph(GRAPH_X, CPU_GRAPH_Y, GRAPH_W, GRAPH_H, &m.cpu_history);
    canvas.graph(GRAPH_X, MEM_GRAPH_Y, GRAPH_W, GRAPH_H, &m.mem_history);

    let total = field(&m.mem, "MemTotal");
    let used = total.saturating_sub(field(&m.mem, "MemAvailable"));
    // Labels above each frame rather than inside it: a graph at 100% would bury
    // text drawn over it, and the reading is the thing you came for.
    let minutes = m.cpu_history.len() / 60;
    let texts = format!(
        "{{\"x\":4,\"y\":{CPU_LABEL_Y},\"text\":\"CPU {}%\"}},\
         {{\"x\":252,\"y\":{CPU_LABEL_Y},\"text\":\"{} min\",\"align\":\"right\"}},\
         {{\"x\":4,\"y\":{MEM_LABEL_Y},\"text\":\"MEM {}%\"}},\
         {{\"x\":252,\"y\":{MEM_LABEL_Y},\"text\":\"{} / {}\",\"align\":\"right\"}}",
        m.total_load(),
        minutes,
        m.mem_percent(),
        size(used),
        size(total)
    );

    let mut out = std::io::stdout().lock();
    let _ = writeln!(
        out,
        "{{\"screen\":{{\"type\":\"canvas\",\"status\":true,\"data\":\"{}\",\
         \"text\":[{texts}],\"buttons\":[{}]}}}}",
        canvas.base64(),
        buttons(Screen::Graph)
    );
    let _ = out.flush();
}

fn draw(m: &Monitor) {
    match m.screen {
        Screen::Cpu => cpu_screen(m),
        Screen::Memory => memory_screen(m),
        Screen::Graph => graph_screen(m),
        Screen::Procs => procs_screen(m),
    }
}

fn main() {
    let mut m = Monitor::new();
    // The first reading has nothing to be a difference from, so a load cannot be
    // stated yet. One tick's wait buys every number on the screen.
    std::thread::sleep(TICK);
    m.tick(TICK);
    draw(&m);

    // Keys arrive on their own schedule and the numbers on ours, so stdin is read
    // by a thread and the loop waits on whichever comes first.
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                return;
            }
        }
    });

    let mut last = Instant::now();
    loop {
        let waited = TICK.saturating_sub(last.elapsed());
        match rx.recv_timeout(waited) {
            Ok(line) => {
                // The messages are small and their shape is fixed, so the two
                // fields are found by looking for them rather than by parsing.
                if !line.contains("\"down\":true") && !line.contains("\"down\": true") {
                    continue;
                }
                let key = line
                    .split("\"key\"")
                    .nth(1)
                    .and_then(|rest| rest.split('"').nth(1))
                    .unwrap_or("");
                match key {
                    "esc" | "back" => return,
                    "ptt" => m.screen = Screen::Cpu,
                    "edit" => m.screen = Screen::Memory,
                    "view" => m.screen = Screen::Graph,
                    "run" => m.screen = Screen::Procs,
                    // Left and right walk the same four screens, for a hand that
                    // is already on the D-pad.
                    "right" => {
                        m.screen = match m.screen {
                            Screen::Cpu => Screen::Memory,
                            Screen::Memory => Screen::Graph,
                            Screen::Graph => Screen::Procs,
                            Screen::Procs => Screen::Cpu,
                        }
                    }
                    "left" => {
                        m.screen = match m.screen {
                            Screen::Cpu => Screen::Procs,
                            Screen::Memory => Screen::Cpu,
                            Screen::Graph => Screen::Memory,
                            Screen::Procs => Screen::Graph,
                        }
                    }
                    "down" => m.selected += 1,
                    "up" => m.selected = m.selected.saturating_sub(1),
                    _ => continue,
                }
                if matches!(key, "left" | "right" | "ptt" | "edit" | "view" | "run") {
                    // Each screen has its own list, so a selection carried across
                    // would land somewhere arbitrary.
                    m.selected = 0;
                }
                draw(&m);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let elapsed = last.elapsed();
                last = Instant::now();
                m.tick(elapsed);
                draw(&m);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}
