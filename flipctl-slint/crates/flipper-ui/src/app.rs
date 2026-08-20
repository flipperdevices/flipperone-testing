//! Running user applications.
//!
//! An app is a directory under `apps/` with an `app.toml` naming it and an
//! executable to run. It does not draw: it writes a scene description and reads
//! key events, so it links no GUI toolkit and can be written in any language. The
//! ping app is 250 lines of stdlib-only Python.
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

/// An app found on disk, before it runs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppEntry {
    pub name: String,
    pub dir: PathBuf,
    pub exec: String,
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
    /// `form`: label and value per row. `log`: the value is empty.
    pub rows: Vec<(String, String)>,
    pub selected: i32,
    /// `log`: how many lines exist in total, and the index of the first one sent.
    /// The app keeps the buffer and sends a window; these let the renderer draw a
    /// scrollbar without being sent the whole history on every frame.
    pub total: i32,
    pub offset: i32,
    /// One per physical soft key, in silkscreen order.
    pub hints: Vec<String>,
    /// Per row, whether its value sits at the low or high end of its range. A row
    /// at an end has that chevron suppressed, so the control shows which
    /// directions are still available.
    pub ends: Vec<(bool, bool)>,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Default)]
pub enum SceneKind {
    #[default]
    Form,
    Log,
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
            let manifest = std::fs::read_to_string(dir.join("app.toml")).ok()?;
            let field = |key: &str| {
                manifest.lines().find_map(|line| {
                    let (k, v) = line.split_once('=')?;
                    (k.trim() == key).then(|| v.trim().trim_matches('"').to_string())
                })
            };
            Some(AppEntry {
                name: field("name")?,
                exec: field("exec")?,
                // Absolute, because spawn sets the child's working directory to
                // this and a relative program path would then be resolved against
                // the new directory rather than ours: apps/ping plus
                // apps/ping/ping.py becomes apps/ping/apps/ping/ping.py.
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
}

impl RunningApp {
    /// Spawn `entry`, with its own directory as the working directory so a script
    /// can find its files by relative path.
    pub fn spawn(entry: &AppEntry) -> std::io::Result<Self> {
        let program = entry.dir.join(&entry.exec);
        let mut child = Command::new(&program)
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
        })
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
    let kind = match string_field(body, "type")?.as_str() {
        "log" => SceneKind::Log,
        _ => SceneKind::Form,
    };
    let mut scene = Scene {
        kind,
        title: string_field(body, "title").unwrap_or_default(),
        selected: int_field(body, "selected").unwrap_or(0),
        total: int_field(body, "total").unwrap_or(0),
        offset: int_field(body, "offset").unwrap_or(0),
        hints: string_array(body, "hints"),
        rows: Vec::new(),
        ends: Vec::new(),
    };
    match kind {
        SceneKind::Log => {
            scene.rows = string_array(body, "lines")
                .into_iter()
                .map(|l| (l, String::new()))
                .collect();
        }
        SceneKind::Form => {
            for (label, value, at_start, at_end) in object_array(body, "rows") {
                scene.rows.push((label, value));
                scene.ends.push((at_start, at_end));
            }
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

/// The row objects inside `"rows": [ ... ]`, as (label, value, at_start, at_end).
///
/// `at_start` and `at_end` are optional and default to false, so a row that has no
/// range says nothing and gets both chevrons.
fn object_array(body: &str, key: &str) -> Vec<(String, String, bool, bool)> {
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
        .filter_map(|obj| {
            Some((
                string_field(obj, "label")?,
                string_field(obj, "value").unwrap_or_default(),
                bool_field(obj, "at_start"),
                bool_field(obj, "at_end"),
            ))
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
