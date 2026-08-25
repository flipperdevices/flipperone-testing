//! What the machine is doing: four pages, drawn by the app itself.
//!
//! Three of them are lists of rows and the fourth is a picture. The rows go into
//! flipctl's detail body and the picture into its canvas body, both from the
//! framework in crates/flipctl-app, so a gauge here is the gauge Settings draws.
//! The picture is painted with the same primitives and fonts, into a panel-sized
//! greyscale surface this app owns.
//!
//! Everything on screen comes out of /proc and /sys: no daemon, no sampling
//! thread, one read of each file a second.

use std::time::{Duration, Instant};

use flipctl_app::paint::Surface;
use flipctl_app::{theme, Key, StatusSource};
use slint::{ComponentHandle, ModelRc, SharedString, VecModel};

slint::include_modules!();

/// How often the numbers are re-read, and so how much time one column of the
/// graph stands for.
const TICK: Duration = Duration::from_secs(1);

/// Columns of history the graphs hold: the panel is 256 wide, the frames sit 2px
/// in from each edge and have their own border, so 248 samples fit. At a second
/// each that is four minutes, which is the useful window for "what just happened".
const HISTORY: usize = 248;

/// Rows a list body shows at once.
const WINDOW: usize = 8;

const PANEL_W: usize = theme::PANEL_W as usize;
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
enum Page {
    Cpu,
    Memory,
    Graph,
    Procs,
}

impl Page {
    /// The next page to the right, wrapping.
    fn next(self) -> Self {
        match self {
            Self::Cpu => Self::Memory,
            Self::Memory => Self::Graph,
            Self::Graph => Self::Procs,
            Self::Procs => Self::Cpu,
        }
    }

    fn previous(self) -> Self {
        match self {
            Self::Cpu => Self::Procs,
            Self::Memory => Self::Cpu,
            Self::Graph => Self::Memory,
            Self::Procs => Self::Graph,
        }
    }
}

struct Monitor {
    page: Page,
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
            page: Page::Cpu,
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


// ── the pages, which the app draws ─────────────────────────────────────────

/// One row of a page: a label and a value, a bar, or a rule between sections.
enum Row {
    Pair(String, String),
    /// Label and fill.
    Gauge(String, i32),
    Divider,
}

impl Row {
    /// The row as the detail body takes it: kind 0 a pair, 1 a divider, 2 a gauge.
    fn placed(&self) -> DetailRow {
        match self {
            Row::Pair(label, value) => DetailRow {
                kind: 0,
                label: label.into(),
                value: value.into(),
                percent: 0,
                dim: false,
            },
            Row::Gauge(label, percent) => DetailRow {
                kind: 2,
                label: label.into(),
                value: SharedString::new(),
                percent: (*percent).clamp(0, 100),
                dim: false,
            },
            Row::Divider => DetailRow {
                kind: 1,
                label: SharedString::new(),
                value: SharedString::new(),
                percent: 0,
                dim: false,
            },
        }
    }
}

/// The soft buttons, the same on every page so the app is one press from any of
/// its views. The page you are on is not offered again.
fn buttons(page: Page) -> Vec<SharedString> {
    let label = |want: Page, text: &str| {
        if page == want {
            SharedString::new()
        } else {
            text.into()
        }
    };
    vec![
        "Close".into(),
        label(Page::Cpu, "CPU"),
        label(Page::Memory, "Mem"),
        label(Page::Graph, "Graph"),
        label(Page::Procs, "Procs"),
    ]
}

fn cpu_rows(m: &Monitor) -> (String, Vec<Row>) {
    let rows = m
        .loads
        .iter()
        .skip(1)
        .enumerate()
        // Short labels on purpose: the bar starts clear of its label, so a label
        // carrying the reading would move the bar every second. The reading goes
        // in the title, where it holds still.
        .map(|(i, pct)| Row::Gauge(format!("C{i}"), *pct))
        .collect();
    (format!("CPU {}%", m.total_load()), rows)
}

fn memory_rows(m: &Monitor) -> (String, Vec<Row>) {
    let total = field(&m.mem, "MemTotal");
    let available = field(&m.mem, "MemAvailable");
    let used = total.saturating_sub(available);
    let swap_total = field(&m.mem, "SwapTotal");
    let swap_used = swap_total.saturating_sub(field(&m.mem, "SwapFree"));

    let mut rows = vec![
        Row::Pair("Used".into(), format!("{} / {}", size(used), size(total))),
        Row::Gauge("Memory".into(), m.mem_percent()),
    ];
    if swap_total > 0 {
        rows.push(Row::Gauge("Swap".into(), (swap_used * 100 / swap_total) as i32));
    } else {
        // Said rather than left out: an absent swap row reads as a screen that
        // forgot to look.
        rows.push(Row::Pair("Swap".into(), "none".into()));
    }
    rows.push(Row::Divider);
    rows.push(Row::Pair("Cached".into(), size(field(&m.mem, "Cached"))));
    rows.push(Row::Pair("Buffers".into(), size(field(&m.mem, "Buffers"))));
    rows.push(Row::Pair("Dirty".into(), size(field(&m.mem, "Dirty"))));
    rows.push(Row::Pair("Shared".into(), size(field(&m.mem, "Shmem"))));
    if !m.temps.is_empty() {
        rows.push(Row::Divider);
        for (name, celsius) in &m.temps {
            rows.push(Row::Pair(name.clone(), format!("{celsius}C")));
        }
    }
    ("Memory".into(), rows)
}

fn procs_rows(m: &Monitor) -> (String, Vec<Row>) {
    let rows: Vec<Row> = m
        .proc_load
        .iter()
        .take(24)
        .map(|(_, name, pct, rss)| Row::Pair(name.clone(), format!("{pct}% {}", size(*rss))))
        .collect();
    let rows = if rows.is_empty() {
        vec![Row::Pair("No readings yet".into(), String::new())]
    } else {
        rows
    };
    (format!("Processes {}", m.procs.len()), rows)
}

// ── the graphs, which the app paints itself ────────────────────────────────

/// The two frames: label row, then the graph under it.
const CPU_LABEL_Y: i32 = TOP as i32;
const CPU_GRAPH_Y: i32 = TOP as i32 + 11;
const GRAPH_H: i32 = 46;
const MEM_LABEL_Y: i32 = CPU_GRAPH_Y + GRAPH_H + 2;
const MEM_GRAPH_Y: i32 = MEM_LABEL_Y + 11;
const GRAPH_X: i32 = 2;
const GRAPH_W: i32 = PANEL_W as i32 - 2 * GRAPH_X;

/// One history, as a column per sample filled from the bottom.
///
/// Newest at the right, which is the way every graph of this kind reads, and a
/// history shorter than the frame leaves the left end empty rather than
/// stretching: the graph is a record of time, so a column has to mean the same
/// span wherever it sits.
fn graph(surface: &mut Surface, x: i32, y: i32, w: i32, h: i32, history: &[i32]) {
    surface.round_frame(x, y, w, h, 2, theme::color::BLACK);
    let (inner_w, inner_h) = (w - 2, h - 2);
    let shown = history.len().min(inner_w as usize);
    for (i, value) in history[history.len() - shown..].iter().enumerate() {
        let column = x + 1 + inner_w - shown as i32 + i as i32;
        let filled = (*value).clamp(0, 100) * inner_h / 100;
        // The tone says how hard it is working: the top of a tall column is ink,
        // the body of a quiet one is grey, so a glance reads the shape and a
        // closer look reads the level.
        let tone = if *value >= 80 {
            theme::color::BLACK
        } else {
            theme::color::STATUS_DIM
        };
        for row in 0..filled {
            surface.pixel(column, y + h - 2 - row, tone);
        }
    }
    // The half-way rule, so a column can be read against something.
    for i in (1..inner_w).step_by(4) {
        surface.pixel(x + i, y + h / 2, theme::color::STATUS_DIM);
    }
}

/// The graph page: the two pictures, and the readings that label them.
fn graph_page(m: &Monitor) -> (slint::Image, Vec<CanvasText>) {
    let mut surface = Surface::panel();
    surface.clear(theme::color::WHITE);
    graph(&mut surface, GRAPH_X, CPU_GRAPH_Y, GRAPH_W, GRAPH_H, &m.cpu_history);
    graph(&mut surface, GRAPH_X, MEM_GRAPH_Y, GRAPH_W, GRAPH_H, &m.mem_history);

    let total = field(&m.mem, "MemTotal");
    let used = total.saturating_sub(field(&m.mem, "MemAvailable"));
    // Labels above each frame rather than inside it: a graph at 100% would bury
    // text drawn over it, and the reading is the thing you came for.
    // align 1 ends the text at x, which is how a reading on the right edge stays put
    // as its digits change; -1 starts it there. Zero would centre it on x.
    let label = |x: i32, y: i32, text: String, ends_at_x: bool| CanvasText {
        x: x as f32,
        y: y as f32,
        text: text.into(),
        font: 0,
        align: if ends_at_x { 1 } else { -1 },
        white: false,
    };
    let texts = vec![
        label(4, CPU_LABEL_Y, format!("CPU {}%", m.total_load()), false),
        label(252, CPU_LABEL_Y, format!("{} min", m.cpu_history.len() / 60), true),
        label(4, MEM_LABEL_Y, format!("MEM {}%", m.mem_percent()), false),
        label(252, MEM_LABEL_Y, format!("{} / {}", size(used), size(total)), true),
    ];
    (flipctl_app::picture(&surface), texts)
}

/// Put the current page on screen.
fn draw(ui: &AppWindow, m: &Monitor) {
    ui.set_buttons(ModelRc::new(VecModel::from(buttons(m.page))));
    ui.set_graph(m.page == Page::Graph);
    if m.page == Page::Graph {
        let (picture, texts) = graph_page(m);
        ui.set_picture(picture);
        ui.set_texts(ModelRc::new(VecModel::from(texts)));
        return;
    }
    let (title, rows) = match m.page {
        Page::Cpu => cpu_rows(m),
        Page::Memory => memory_rows(m),
        Page::Procs => procs_rows(m),
        Page::Graph => unreachable!("the picture is drawn above"),
    };
    // The body shows a window of the rows and scrolls it, so the selection is what
    // decides where that window sits.
    let selected = m.selected.min(rows.len().saturating_sub(1));
    let offset = if rows.len() <= WINDOW {
        0
    } else {
        selected.saturating_sub(WINDOW - 1).min(rows.len() - WINDOW)
    };
    ui.set_heading(title.into());
    ui.set_offset(offset as i32);
    ui.set_rows(ModelRc::new(VecModel::from(
        rows.iter().map(Row::placed).collect::<Vec<_>>(),
    )));
}

fn main() -> Result<(), slint::PlatformError> {
    let ui = AppWindow::new()?;
    let m = Monitor::new();
    // The first reading has nothing to be a difference from, so a load cannot be
    // stated yet: the page fills in on the first tick.
    draw(&ui, &m);

    let mut status = StatusSource::new(Duration::from_secs(2));
    flipctl_app::apply_status!(&ui, PanelStatus, status.current());

    let monitor = std::rc::Rc::new(std::cell::RefCell::new(m));
    let ticking = ui.as_weak();
    let watched = monitor.clone();
    let mut last = Instant::now();
    let tick = slint::Timer::default();
    tick.start(slint::TimerMode::Repeated, TICK, move || {
        let Some(ui) = ticking.upgrade() else {
            return;
        };
        let elapsed = last.elapsed();
        last = Instant::now();
        let mut m = watched.borrow_mut();
        m.tick(elapsed);
        draw(&ui, &m);
        if let Some(now) = status.poll() {
            flipctl_app::apply_status!(&ui, PanelStatus, now);
        }
    });

    let keys = ui.as_weak();
    let pressed = monitor.clone();
    ui.on_keyed(move |text, down| {
        let Some(ui) = keys.upgrade() else {
            return;
        };
        let Some(key) = Key::from_slint(text.as_str()) else {
            return;
        };
        ui.set_pressed_slot(match (down, key.soft_slot()) {
            (true, Some(slot)) => slot as i32,
            _ => -1,
        });
        if !down {
            return;
        }
        let mut m = pressed.borrow_mut();
        let was = m.page;
        match key {
            Key::Escape | Key::Back => {
                let _ = slint::quit_event_loop();
                return;
            }
            Key::View => m.page = Page::Cpu,
            Key::Power => m.page = Page::Memory,
            Key::Edit => m.page = Page::Graph,
            Key::Run => m.page = Page::Procs,
            // Left and right walk the same four pages, for a hand that is already
            // on the D-pad.
            Key::Right => m.page = m.page.next(),
            Key::Left => m.page = m.page.previous(),
            Key::Down => m.selected += 1,
            Key::Up => m.selected = m.selected.saturating_sub(1),
            _ => return,
        }
        // Each page has its own list, so a selection carried across would land
        // somewhere arbitrary.
        if m.page != was {
            m.selected = 0;
        }
        draw(&ui, &m);
    });

    ui.run()
}
