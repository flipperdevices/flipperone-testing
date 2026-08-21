//! Running user applications.
//!
//! An app is a directory under `apps/`. It does not draw: it writes a scene
//! description and reads key events, so it links no GUI toolkit and can be written
//! in any language that can read a line and print one.
//!
//! Two kinds are recognised, by what the directory contains:
//!
//!   * `app.py`, a Python app, started through an interpreter. Its manifest is
//!     module-level constants: APP_NAME, APP_ICON, APP_APT, APP_PIP.
//!   * `Cargo.toml`, a Rust app, started as the binary cargo builds. Its manifest
//!     is `[package.metadata.flipctl]`, which is where Cargo already expects
//!     third-party keys to live.
//!
//! Either way the manifest is read by scanning the file, never by running or
//! building anything. That matters: an app whose dependencies are missing fails on
//! import, and a Rust app has no binary at all until it is built, so anything that
//! executes an app to ask what it needs cannot work. Scanning also means the list
//! of apps is available without starting an interpreter or a compiler.
//!
//! Transport is newline-delimited JSON over the child's stdin and stdout. That is
//! a deliberate v0, not the end state: the plan calls for CBOR over a
//! `SOCK_SEQPACKET` socketpair, which brings framing and fd-passing for a shared
//! canvas buffer. JSON over pipes is legible from a terminal, has no framing to
//! get wrong, and lets an app be tested by piping to it, which is worth a lot
//! while the scene vocabulary is still being discovered.
//!
//! Whole scenes, never diffs. A screen is a few hundred bytes, so sending
//! everything removes handle lifecycles, leaked ids, and desync-after-restart as
//! categories: an app that dies and respawns puts the screen right with its first
//! message.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};

use crate::KeyEvent;

/// The file a Python app is started from.
pub const ENTRY: &str = "app.py";

/// What language an app is written in, which decides how it starts and what
/// "install its dependencies" means.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
pub enum Kind {
    #[default]
    Python,
    Rust,
}

/// The per-app virtualenv, inside the app's own directory.
pub const VENV: &str = ".venv";

/// An app found on disk, before it runs.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct AppEntry {
    /// The declared name, or the directory name when it says nothing.
    pub name: String,
    pub dir: PathBuf,
    pub kind: Kind,
    /// A file in the app's own directory. Empty when absent.
    pub icon: String,
    /// Debian packages the app needs.
    pub apt: Vec<String>,
    /// Python packages, installed into the app's own venv. Python apps only.
    pub pip: Vec<String>,
    /// The binary cargo produces, from the crate's name. Rust apps only.
    pub bin: String,
}

impl AppEntry {
    /// The program to run and the arguments to pass it.
    ///
    /// A Python app is started through an interpreter rather than as an
    /// executable, so `app.py` needs no shebang and no execute bit, and so the
    /// app's own venv is used when it has one. A Rust app is its own binary.
    pub fn command(&self) -> (PathBuf, Vec<PathBuf>) {
        match self.kind {
            Kind::Python => (self.python(), vec![self.entry()]),
            Kind::Rust => (self.binary(), Vec::new()),
        }
    }

    /// Where cargo puts the binary for a Rust app.
    pub fn binary(&self) -> PathBuf {
        self.dir.join("target").join("release").join(&self.bin)
    }

    /// The interpreter to start it with.
    ///
    /// The app's own venv when it has one, so its packages are visible and no
    /// other app's are. Falling back to the system interpreter is what lets a
    /// stdlib-only app run with no venv at all.
    pub fn python(&self) -> PathBuf {
        let venv = self.dir.join(VENV).join("bin").join("python3");
        if venv.exists() {
            venv
        } else {
            PathBuf::from("python3")
        }
    }

    pub fn entry(&self) -> PathBuf {
        self.dir.join(ENTRY)
    }

    pub fn icon_path(&self) -> Option<PathBuf> {
        (!self.icon.is_empty()).then(|| self.dir.join(&self.icon))
    }
}

/// The body of a TOML table, e.g. everything under `[package.metadata.flipctl]`.
///
/// Returned as text so the same key scanners work on it. A section ends at the
/// next line that opens a table, which is all the structure this needs: the
/// manifest is a handful of strings and arrays.
fn toml_section<'a>(src: &'a str, header: &str) -> Option<&'a str> {
    let at = src.find(&format!("[{header}]"))? + header.len() + 2;
    let rest = &src[at..];
    let end = rest
        .lines()
        .scan(0usize, |off, line| {
            let start = *off;
            *off += line.len() + 1;
            Some((start, line))
        })
        .find(|(start, line)| *start > 0 && line.trim_start().starts_with('['))
        .map_or(rest.len(), |(start, _)| start);
    Some(&rest[..end])
}

/// A module-level string assignment, e.g. `APP_NAME = "Ping"`.
///
/// Only column zero counts, so an assignment inside a function or a class is not
/// mistaken for the manifest. Both quote styles are accepted, and a trailing
/// comment is ignored.
fn py_string(src: &str, key: &str) -> Option<String> {
    src.lines()
        .filter(|l| !l.starts_with(char::is_whitespace))
        .find_map(|line| {
            let (k, v) = line.split_once('=')?;
            if k.trim() != key {
                return None;
            }
            let v = v.trim();
            let quote = v.chars().next().filter(|c| *c == '"' || *c == '\'')?;
            let rest = &v[1..];
            let end = rest.find(quote)?;
            Some(rest[..end].to_string())
        })
}

/// A module-level list of strings, e.g. `APP_APT = ["a", "b"]`.
///
/// Written across as many lines as the author likes, with or without a trailing
/// comma, because that is how a list of packages tends to grow.
fn py_list(src: &str, key: &str) -> Vec<String> {
    let Some(at) = src.find(&format!("\n{key}")).map(|i| i + 1).or_else(|| {
        src.starts_with(key).then_some(0)
    }) else {
        return Vec::new();
    };
    let rest = &src[at..];
    let Some(open) = rest.find('[') else {
        return Vec::new();
    };
    // A list of string literals cannot contain a bracket, so the first one closes
    // it.
    let Some(close) = rest[open..].find(']') else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let body = &rest[open + 1..open + close];
    let mut chars = body.char_indices();
    while let Some((i, c)) = chars.next() {
        if c != '"' && c != '\'' {
            continue;
        }
        if let Some(end) = body[i + 1..].find(c) {
            let item = &body[i + 1..i + 1 + end];
            if !item.is_empty() {
                out.push(item.to_string());
            }
            // Skip past the closing quote.
            for _ in 0..=end {
                chars.next();
            }
        }
    }
    out
}

/// What an app asked to be shown.
///
/// One variant per scene type the vocabulary admits. Adding one is a deliberate
/// act: every entry here is a permanent commitment across the renderer, the Rust
/// side and every language binding.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Scene {
    pub kind: SceneKind,
    pub title: String,
    pub rows: Vec<Row>,
    pub selected: i32,
    /// `log`: how many lines exist in total, and the index of the first one sent.
    /// The app keeps the buffer and sends a window; these let the renderer draw a
    /// scrollbar without being sent the whole history on every frame. A `detail`
    /// scene uses `offset` the same way.
    pub total: i32,
    pub offset: i32,
    /// One per physical soft key, in silkscreen order.
    pub buttons: Vec<String>,
    /// `canvas`: one byte per pixel, panel-sized, 0 black and 255 white. Empty for
    /// every other kind.
    pub canvas: Vec<u8>,
    /// `canvas`: text for flipctl to draw over the bitmap.
    pub texts: Vec<CanvasText>,
    /// `canvas`: draw the system status bar over the app's picture. An app cannot
    /// draw it itself, having no idea what the battery or the radios are doing, so
    /// a canvas that wants the panel's usual top row asks for it.
    pub status_bar: bool,
    /// `cards`: a short right-aligned line beside the title. A count, a state, a
    /// total: whatever the title's sentence ends with.
    pub note: String,
    /// `cards`: work is still going on, so the page draws the track that says so.
    pub busy: bool,
    /// `cards`: how far along that work is, or -1 for an app that cannot say. The
    /// marker runs either way; the fill only appears when there is a number.
    pub percent: i32,
}

/// One row of a scene, whatever kind of scene it belongs to.
///
/// A single type rather than one per scene kind, because the fields a kind does
/// not use cost nothing and the alternative was a second vector running alongside
/// `rows` that had to be kept the same length by hand.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Row {
    /// `log`: the whole line. `form` and `detail`: the label.
    pub label: String,
    pub value: String,
    /// `form`: the value sits at the low or the high end of its range, so that
    /// chevron is suppressed and the control shows which way is still open.
    pub at_start: bool,
    pub at_end: bool,
    /// `detail`: 0 label and value, 1 divider, 2 gauge, 3 full-width text. The
    /// same numbering the renderer's DetailRow uses, because that is what draws it.
    pub kind: i32,
    /// `detail`: a gauge's fill, 0..=100.
    pub percent: i32,
    /// `detail` and `cards`: draw in the dim tone rather than in ink.
    pub dim: bool,
    /// `cards`: the second line, under the name. Empty for a one-line card.
    pub info: String,
    /// `cards`: the card's icon, as a path relative to the app's own directory.
    /// A path rather than pixels because it is the same 14x14 every frame, and a
    /// bitmap per card per frame would be a kilobyte of nothing changing.
    pub icon: String,
    /// `cards`: opening this card does something, so the selected card shows the
    /// drill-in bar. A card that is only a readout says nothing by leaving it off.
    pub actionable: bool,
    /// `cards`: put the right-hand column on the grey pill.
    pub pill: bool,
}

impl Row {
    /// A plain label-and-value row, which is what a form is made of.
    pub fn pair(label: &str, value: &str) -> Self {
        Self { label: label.into(), value: value.into(), ..Self::default() }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
pub enum SceneKind {
    #[default]
    Form,
    Log,
    /// Rows that can be a gauge, a divider or a full-width line, which is what a
    /// screen reporting progress needs. Same body the Settings and Network
    /// screens draw with.
    Detail,
    /// Framed rows with an icon, a name, a line under it and a right-hand column,
    /// stacked down the page. The Ethernet page's card, generalised: what a list of
    /// things each worth two lines wants, where the menu's one-line row is not
    /// enough and a detail screen is too much.
    Cards,
    /// The app owns every pixel: it sends a panel-sized greyscale bitmap and
    /// flipctl blits it. For anything that is not a list, and the only scene where
    /// the app decides what the screen looks like rather than what it contains.
    Canvas,
}

/// A line of text drawn onto a canvas by flipctl rather than by the app.
///
/// The app has no font: it cannot measure a string, so it cannot centre one, and
/// baking a font into every app would make each one carry its own idea of what the
/// system looks like. So the app says what and where, in its own coordinates, and
/// the three fonts stay on this side.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct CanvasText {
    pub x: i32,
    pub y: i32,
    pub text: String,
    /// 0 the title font, 1 a list row, 2 a selected row.
    pub font: i32,
    /// -1 right of x, 0 centred on x, 1 left of x.
    pub align: i32,
    /// White ink, for text on something the app painted dark.
    pub white: bool,
}

/// Apps in `dir`, sorted by name so the menu order is stable.
///
/// A directory without a readable `app.toml` is skipped rather than reported: a
/// half-installed app should not keep the menu from opening.
pub fn discover(dir: &Path) -> Vec<AppEntry> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut apps: Vec<AppEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let dir = entry.path();
            let fallback = dir.file_name()?.to_string_lossy().to_string();

            // Python first: a directory with both is a Python app that happens to
            // vendor a crate.
            if let Ok(src) = std::fs::read_to_string(dir.join(ENTRY)) {
                return Some(AppEntry {
                    name: py_string(&src, "APP_NAME").unwrap_or(fallback),
                    kind: Kind::Python,
                    icon: py_string(&src, "APP_ICON").unwrap_or_default(),
                    apt: py_list(&src, "APP_APT"),
                    pip: py_list(&src, "APP_PIP"),
                    bin: String::new(),
                    dir: dir.canonicalize().unwrap_or(dir),
                });
            }

            let cargo = std::fs::read_to_string(dir.join("Cargo.toml")).ok()?;
            // The binary cargo will produce. `name` under [package], not the
            // manifest's display name.
            let bin = toml_section(&cargo, "package")
                .and_then(|s| py_string(s, "name"))
                .unwrap_or_else(|| fallback.clone());
            let meta = toml_section(&cargo, "package.metadata.flipctl").unwrap_or("");
            Some(AppEntry {
                name: py_string(meta, "name").unwrap_or(fallback),
                kind: Kind::Rust,
                icon: py_string(meta, "icon").unwrap_or_default(),
                apt: py_list(meta, "apt"),
                pip: Vec::new(),
                bin,
                // Absolute, because spawn sets the child's working directory to
                // this and a relative program path would then be resolved against
                // the new directory rather than ours: apps/ping plus
                // apps/ping/app.py becomes apps/ping/apps/ping/app.py.
                dir: dir.canonicalize().unwrap_or(dir),
            })
        })
        .collect();
    apps.sort_by(|a, b| a.name.cmp(&b.name));
    apps
}

/// A running app.
pub struct RunningApp {
    child: Child,
    stdin: ChildStdin,
    scenes: Receiver<Scene>,
    latest: Scene,
    /// Where the app lives, so the paths in its scenes can be resolved. A card's
    /// icon is named relative to this, as the app's own entry icon is.
    dir: PathBuf,
}

impl RunningApp {
    /// Spawn `entry`, with its own directory as the working directory so a script
    /// can find its files by relative path.
    ///
    /// Started through an interpreter rather than as an executable, so `app.py`
    /// needs no shebang and no execute bit, and so the app's own venv is used when
    /// it has one.
    pub fn spawn(entry: &AppEntry) -> std::io::Result<Self> {
        let (program, args) = entry.command();
        let mut child = Command::new(program)
            .args(args)
            .current_dir(&entry.dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // stderr is left inherited on purpose: an app's tracebacks land in
            // the journal next to ours, which is where you look when a screen
            // stays blank.
            .spawn()?;

        let stdin = child.stdin.take().expect("piped");
        let stdout = child.stdout.take().expect("piped");
        let (tx, scenes) = mpsc::channel();

        // A reader thread, because an app emits on its own schedule: ping pushes a
        // line per reply and the UI loop must not block waiting for one.
        std::thread::Builder::new()
            .name("app-reader".into())
            .spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if let Some(scene) = parse_line(&line) {
                        if tx.send(scene).is_err() {
                            return;
                        }
                    }
                }
            })?;

        Ok(Self {
            child,
            stdin,
            scenes,
            latest: Scene::default(),
            dir: entry.dir.clone(),
        })
    }

    /// Where the app lives. Paths in its scenes are relative to this.
    pub fn dir(&self) -> &std::path::Path {
        &self.dir
    }

    /// The newest scene, or `None` if nothing arrived.
    ///
    /// Drains the channel rather than taking one: ping can emit several lines
    /// between two frames and only the last is worth drawing.
    pub fn poll(&mut self) -> Option<&Scene> {
        let mut fresh = false;
        while let Ok(scene) = self.scenes.try_recv() {
            self.latest = scene;
            fresh = true;
        }
        fresh.then_some(&self.latest)
    }

    pub fn scene(&self) -> &Scene {
        &self.latest
    }

    /// Forward a key. An app that has exited is not an error here; the caller
    /// notices through `finished`.
    pub fn send(&mut self, event: KeyEvent) {
        let line = format!(
            "{{\"key\":\"{}\",\"down\":{}}}\n",
            event.key.name(),
            event.down
        );
        let _ = self.stdin.write_all(line.as_bytes());
        let _ = self.stdin.flush();
    }

    pub fn finished(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(Some(_)) | Err(_))
    }

    /// Ask the app to stop, then make sure it has.
    pub fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for RunningApp {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Pull a scene out of one JSON line.
///
/// Deliberately not a JSON parser: this reads five known fields out of a shape we
/// define, and anything it does not recognise is ignored rather than fatal. When
/// the transport moves to CBOR this goes away in favour of a real decoder; until
/// then a malformed line from an app must not be able to take the UI down.
pub fn parse_line(line: &str) -> Option<Scene> {
    let body = line.split_once("\"screen\"")?.1;
    // The scene's own fields, read from the body with the rows' objects taken out.
    // Names repeat between the two levels by design (`percent` is how far a page
    // has got and how full a gauge is), and a first-match scan over the whole line
    // otherwise answers a question about the page with a number from a card.
    let scalars = outside_objects(body);
    let scalars = scalars.as_str();
    let kind = match string_field(scalars, "type")?.as_str() {
        "log" => SceneKind::Log,
        "detail" => SceneKind::Detail,
        "cards" => SceneKind::Cards,
        "canvas" => SceneKind::Canvas,
        _ => SceneKind::Form,
    };
    let mut scene = Scene {
        kind,
        title: string_field(scalars, "title").unwrap_or_default(),
        selected: int_field(scalars, "selected").unwrap_or(0),
        total: int_field(scalars, "total").unwrap_or(0),
        offset: int_field(scalars, "offset").unwrap_or(0),
        buttons: string_array(scalars, "buttons"),
        rows: Vec::new(),
        canvas: Vec::new(),
        texts: Vec::new(),
        status_bar: false,
        note: string_field(scalars, "note").unwrap_or_default(),
        busy: bool_field(scalars, "busy"),
        percent: int_field(scalars, "percent").unwrap_or(-1),
    };
    match kind {
        SceneKind::Log => {
            scene.rows = string_array(scalars, "lines")
                .into_iter()
                .map(|l| Row { label: l, ..Row::default() })
                .collect();
        }
        SceneKind::Form | SceneKind::Detail => scene.rows = object_array(body, "rows"),
        SceneKind::Cards => scene.rows = object_array(body, "cards"),
        SceneKind::Canvas => {
            scene.status_bar = bool_field(scalars, "status");
            scene.canvas = string_field(scalars, "data").map(|d| unbase64(&d)).unwrap_or_default();
            scene.texts = object_chunks(body, "text")
                .iter()
                .map(|chunk| CanvasText {
                    x: int_field(chunk, "x").unwrap_or(0),
                    y: int_field(chunk, "y").unwrap_or(0),
                    text: string_field(chunk, "text").unwrap_or_default(),
                    font: match string_field(chunk, "font").unwrap_or_default().as_str() {
                        "row" => 1,
                        "row_active" => 2,
                        _ => 0,
                    },
                    align: match string_field(chunk, "align").unwrap_or_default().as_str() {
                        "center" | "centre" => 0,
                        "right" => 1,
                        _ => -1,
                    },
                    white: bool_field(chunk, "white"),
                })
                .collect();
        }
    }
    Some(scene)
}

fn unescape(s: &str) -> String {
    s.replace("\\\"", "\"").replace("\\\\", "\\")
}

fn string_field(body: &str, key: &str) -> Option<String> {
    let at = body.find(&format!("\"{key}\""))? + key.len() + 2;
    let rest = &body[at..];
    let open = rest.find('"')? + 1;
    let close = rest[open..].find('"')? + open;
    Some(unescape(&rest[open..close]))
}

fn int_field(body: &str, key: &str) -> Option<i32> {
    let at = body.find(&format!("\"{key}\""))? + key.len() + 2;
    let rest = body[at..].trim_start_matches([':', ' ']);
    let end = rest
        .find(|c: char| !c.is_ascii_digit() && c != '-')
        .unwrap_or(rest.len());
    rest[..end].parse().ok()
}

/// Strings inside `"key": [ ... ]`.
fn string_array(body: &str, key: &str) -> Vec<String> {
    let Some(at) = body.find(&format!("\"{key}\"")) else {
        return Vec::new();
    };
    let rest = &body[at..];
    let Some(open) = rest.find('[') else {
        return Vec::new();
    };
    let Some(close) = rest[open..].find(']') else {
        return Vec::new();
    };
    let inner = &rest[open + 1..open + close];
    let mut out = Vec::new();
    let mut chars = inner.char_indices();
    while let Some((i, c)) = chars.next() {
        if c != '"' {
            continue;
        }
        // Find the closing quote, honouring a backslash escape.
        let mut end = None;
        let mut escaped = false;
        for (j, d) in inner[i + 1..].char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            match d {
                '\\' => escaped = true,
                '"' => {
                    end = Some(i + 1 + j);
                    break;
                }
                _ => {}
            }
        }
        let Some(end) = end else { break };
        out.push(unescape(&inner[i + 1..end]));
        while let Some((k, _)) = chars.next() {
            if k >= end {
                break;
            }
        }
    }
    out
}

/// Decode base64, ignoring anything that is not part of the alphabet.
///
/// Written out rather than pulled in: it is twenty lines, and a canvas scene is
/// the only thing that needs it. Padding is implied by the length, so `=` is just
/// another character to skip.
fn unbase64(src: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(src.len() / 4 * 3);
    let mut acc = 0u32;
    let mut bits = 0u32;
    for b in src.bytes() {
        let value = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => continue,
        };
        acc = (acc << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
        }
    }
    out
}

/// The objects inside `"key": [ {...}, {...} ]`, as the text between the braces.
///
/// A string literal in this protocol never contains a brace, so splitting on one
/// is enough structure for a list of flat objects.
fn object_chunks(body: &str, key: &str) -> Vec<String> {
    let Some(at) = body.find(&format!("\"{key}\"")) else {
        return Vec::new();
    };
    let rest = &body[at..];
    let Some(open) = rest.find('[') else {
        return Vec::new();
    };
    let Some(close) = rest[open..].find(']') else {
        return Vec::new();
    };
    rest[open + 1..open + close]
        .split('}')
        .filter(|obj| obj.contains('{'))
        .map(str::to_string)
        .collect()
}

/// The body with every nested object removed.
///
/// The scene is one object, so its own fields are whatever sits at depth one; the
/// rows, cards and text runs inside it are all one level deeper. Cutting them out
/// leaves the page's own fields and nothing that could be mistaken for them.
fn outside_objects(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut depth = 0;
    for ch in body.chars() {
        match ch {
            '{' => {
                depth += 1;
                if depth == 1 {
                    out.push(ch);
                }
            }
            '}' => {
                if depth == 1 {
                    out.push(ch);
                }
                depth -= 1;
            }
            _ if depth <= 1 => out.push(ch),
            _ => {}
        }
    }
    out
}

/// The row objects inside `"rows": [ ... ]`.
///
/// Every field but the label is optional: a form row says `value` and possibly
/// which end of its range it is at, and a detail row says what `kind` it is and,
/// for a gauge, how full. A row that names no kind is a label and a value, which
/// is what a form is made of.
///
/// A divider carries no label at all, so the label is optional here too, unlike
/// the form-only parser this replaced.
fn object_array(body: &str, key: &str) -> Vec<Row> {
    let Some(at) = body.find(&format!("\"{key}\"")) else {
        return Vec::new();
    };
    let rest = &body[at..];
    let Some(open) = rest.find('[') else {
        return Vec::new();
    };
    let Some(close) = rest[open..].find(']') else {
        return Vec::new();
    };
    rest[open + 1..open + close]
        .split('}')
        .filter(|obj| obj.contains('{'))
        .map(|obj| Row {
            label: string_field(obj, "label").unwrap_or_default(),
            value: string_field(obj, "value").unwrap_or_default(),
            at_start: bool_field(obj, "at_start"),
            at_end: bool_field(obj, "at_end"),
            kind: match string_field(obj, "kind").unwrap_or_default().as_str() {
                "divider" => 1,
                "gauge" => 2,
                "text" => 3,
                // Anything else, including nothing, is a label and a value.
                _ => 0,
            },
            percent: int_field(obj, "percent").unwrap_or(0).clamp(0, 100),
            dim: bool_field(obj, "dim"),
            info: string_field(obj, "info").unwrap_or_default(),
            icon: string_field(obj, "icon").unwrap_or_default(),
            actionable: bool_field(obj, "actionable"),
            pill: bool_field(obj, "pill"),
        })
        .collect()
}

/// A `"key": true` flag. Absent or anything else reads as false.
fn bool_field(body: &str, key: &str) -> bool {
    let Some(at) = body.find(&format!("\"{key}\"")) else {
        return false;
    };
    body[at + key.len() + 2..]
        .trim_start_matches([':', ' '])
        .starts_with("true")
}

/// What an app still needs before it can run.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Missing {
    /// Debian packages that are not installed.
    pub apt: Vec<String>,
    /// Python packages, when the app's venv does not already have exactly them.
    pub pip: Vec<String>,
    /// True when a Rust app has no binary yet, so it has to be built.
    ///
    /// Not a package to fetch but a compile, which is why it is a flag rather than
    /// a list: cargo works out what to download from the crate's own manifest.
    pub needs_build: bool,
    /// True when Python packages are wanted but `uv` is not installed.
    ///
    /// Not something the user can be offered, because uv is not in the Debian
    /// archive: it is installed with the image. Reported rather than attempted, so
    /// the failure is stated up front instead of halfway through an install.
    pub needs_uv: bool,
}

impl Missing {
    pub fn is_empty(&self) -> bool {
        self.apt.is_empty() && self.pip.is_empty() && !self.needs_build
    }

    /// Everything to install with apt.
    pub fn apt_all(&self) -> Vec<String> {
        self.apt.clone()
    }

    /// One line for a log, e.g. "2 packages: curl, requests".
    pub fn summary(&self) -> String {
        let apt = self.apt_all();
        let n = apt.len() + self.pip.len();
        let mut names = apt;
        names.extend(self.pip.iter().cloned());
        if n == 0 && self.needs_build {
            return "a build".into();
        }
        let build = if self.needs_build { " and a build" } else { "" };
        format!(
            "{n} package{}: {}{build}",
            if n == 1 { "" } else { "s" },
            names.join(", ")
        )
    }
}

/// Which of `packages` dpkg does not have installed.
///
/// One query for the lot: dpkg-query takes several names and reports a line each,
/// and an unknown package makes it exit non-zero while still printing the ones it
/// does know, so the output is parsed either way.
fn missing_apt(packages: &[String]) -> Vec<String> {
    if packages.is_empty() {
        return Vec::new();
    }
    let out = Command::new("dpkg-query")
        .arg("-W")
        .arg("-f=${binary:Package} ${db:Status-Status}\n")
        .args(packages)
        .stderr(Stdio::null())
        .output();
    let Ok(out) = out else {
        // No dpkg at all: nothing can be checked, so claim nothing is missing
        // rather than blocking every app behind an install that cannot work.
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let installed: Vec<&str> = text
        .lines()
        .filter_map(|l| {
            let (name, status) = l.split_once(' ')?;
            (status.trim() == "installed").then_some(name)
        })
        .collect();
    packages
        .iter()
        .filter(|p| !installed.contains(&p.as_str()))
        .cloned()
        .collect()
}

/// The uv binary, if it is installed.
///
/// uv rather than venv and pip: this image has neither pip nor `ensurepip`, so the
/// stock interpreter cannot build a working virtualenv at all, and uv is one static
/// binary that does it without either. It is also far faster at resolving, which
/// matters on this board.
///
/// PATH is searched, plus the place a manual install puts it, because a service
/// started by systemd does not necessarily inherit a login shell's PATH.
/// Where cargo is, for building a Rust app.
///
/// Searched rather than assumed, because this runs as a systemd unit whose PATH is
/// the unit's, not a login shell's: a rustup toolchain lives in a home directory
/// that PATH knows nothing about, and `Command::new("cargo")` then fails with
/// ENOENT, which reads as "the app is broken" rather than "the toolchain is not on
/// the path".
fn cargo() -> Option<PathBuf> {
    if let Some(from_env) = std::env::var_os("CARGO").map(PathBuf::from) {
        if from_env.exists() {
            return Some(from_env);
        }
    }
    let mut candidates = vec![
        PathBuf::from("/usr/local/bin/cargo"),
        PathBuf::from("/usr/bin/cargo"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        candidates.insert(0, PathBuf::from(home).join(".cargo/bin/cargo"));
    }
    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }
    Command::new("cargo")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .filter(|s| s.success())
        .map(|_| PathBuf::from("cargo"))
}

fn uv() -> Option<PathBuf> {
    let candidates = [PathBuf::from("/usr/local/bin/uv"), PathBuf::from("/usr/bin/uv")];
    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }
    Command::new("uv")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .filter(|s| s.success())
        .map(|_| PathBuf::from("uv"))
}

/// The most recent modification time among an app's sources.
///
/// Walks the crate but skips `target`, which is where the binary being compared
/// against lives: including it would always look newer than itself.
fn newest_source(dir: &Path) -> Option<std::time::SystemTime> {
    let mut newest = None;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(at) = stack.pop() {
        for entry in std::fs::read_dir(&at).ok()?.flatten() {
            let path = entry.path();
            if path.file_name().is_some_and(|n| n == "target" || n == ".git") {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(path);
            } else if let Ok(t) = meta.modified() {
                newest = newest.max(Some(t));
            }
        }
    }
    newest
}

/// The file recording what was installed into an app's venv.
fn venv_stamp(dir: &Path) -> PathBuf {
    dir.join(VENV).join("flipctl-installed")
}

/// What `entry` still needs.
///
/// Blocking: it runs dpkg-query and the interpreter, so callers put it on a
/// thread rather than in a render loop.
pub fn missing(entry: &AppEntry) -> Missing {
    let mut m = Missing {
        apt: missing_apt(&entry.apt),
        ..Default::default()
    };
    if entry.kind == Kind::Rust {
        // Rebuild when the binary is absent or older than any source file. Cargo
        // decides what actually needs recompiling; this only decides whether to
        // ask, and asking after every edit is what a person expects.
        m.needs_build = match entry.binary().metadata().and_then(|m| m.modified()) {
            Err(_) => true,
            Ok(built) => newest_source(&entry.dir).is_some_and(|src| src > built),
        };
        return m;
    }
    if entry.pip.is_empty() {
        return m;
    }
    // The venv is satisfied when it exists and was built for exactly this list.
    // A stamp rather than asking pip: `pip show` costs a fresh interpreter per
    // package, and this runs every time an app is opened.
    let want = {
        let mut w = entry.pip.clone();
        w.sort();
        w.join("\n")
    };
    let have = std::fs::read_to_string(venv_stamp(&entry.dir)).unwrap_or_default();
    if have.trim() != want {
        m.pip = entry.pip.clone();
        m.needs_uv = uv().is_none();
    }
    m
}

/// Install what an app needs, reporting progress as lines.
///
/// Blocking and slow: apt reaches the network. `log` is called per output line so
/// a caller can show it while it runs, which matters because this can take a
/// minute and a frozen screen looks broken.
pub fn install(entry: &AppEntry, missing: &Missing, mut log: impl FnMut(String)) -> Result<(), String> {
    let apt = missing.apt_all();
    if !apt.is_empty() {
        log(format!("apt: {}", apt.join(" ")));
        run_logged(
            Command::new("sudo")
                .args(["apt-get", "install", "-y", "--no-install-recommends"])
                .args(&apt)
                // Non-interactive: a package that stops to ask a question would
                // hang here with nobody able to answer it.
                .env("DEBIAN_FRONTEND", "noninteractive"),
            &mut log,
        )?;
    }

    if missing.needs_build {
        let Some(cargo) = cargo() else {
            return Err("cargo is not installed, or not on this service's PATH".into());
        };
        log(format!("{} build --release", cargo.display()));
        run_logged(
            Command::new(&cargo)
                .args(["build", "--release"])
                .current_dir(&entry.dir)
                // Cargo colours and redraws its progress, which a line-oriented
                // log cannot show.
                .env("CARGO_TERM_COLOR", "never")
                .env("CARGO_TERM_PROGRESS_WHEN", "never"),
            &mut log,
        )?;
        log("done".into());
        return Ok(());
    }

    if missing.pip.is_empty() {
        return Ok(());
    }

    let Some(uv) = uv() else {
        return Err("uv is not installed".into());
    };
    let venv = entry.dir.join(VENV);
    let python = venv.join("bin").join("python3");
    if !python.exists() {
        log("creating venv".into());
        run_logged(
            Command::new(&uv)
                .arg("venv")
                .arg(&venv)
                // The system interpreter, not one uv downloads: an app runs
                // against the same Python the rest of the device has.
                .args(["--python", "python3"]),
            &mut log,
        )?;
    }

    log(format!("uv pip: {}", missing.pip.join(" ")));
    run_logged(
        Command::new(&uv)
            .args(["pip", "install", "--python"])
            .arg(&python)
            .args(&missing.pip),
        &mut log,
    )?;

    // Record what the venv now holds, so the next launch does not ask again.
    let mut want = entry.pip.clone();
    want.sort();
    std::fs::write(venv_stamp(&entry.dir), want.join("\n"))
        .map_err(|e| format!("cannot record the install: {e}"))?;
    log("done".into());
    Ok(())
}

/// Run a command, passing each output line to `log`, and fail on a non-zero exit.
fn run_logged(cmd: &mut Command, log: &mut impl FnMut(String)) -> Result<(), String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot start: {e}"))?;

    // stderr is merged in rather than dropped: apt and pip report their real
    // problems there, and a failure with no reason on screen is useless.
    let err = child.stderr.take().map(|e| {
        std::thread::spawn(move || {
            BufReader::new(e)
                .lines()
                .map_while(Result::ok)
                .collect::<Vec<_>>()
        })
    });
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                log(line);
            }
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let stderr = err.and_then(|h| h.join().ok()).unwrap_or_default();
    for line in &stderr {
        if !line.trim().is_empty() {
            log(line.clone());
        }
    }
    if status.success() {
        Ok(())
    } else {
        Err(stderr
            .iter()
            .rev()
            .find(|l| !l.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| format!("exited with {status}")))
    }
}
