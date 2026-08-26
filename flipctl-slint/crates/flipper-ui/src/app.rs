//! Running user applications.
//!
//! An app is a directory under `apps/` with an `app.toml` in it. It draws its own
//! screen: flipctl runs a compositor, gives the app an output of its own and reads
//! its frames, and nothing describes a screen to flipctl or asks it to lay one out.
//! What an app takes from us is the look, through the widget library in
//! crates/flipctl-app, and that is a dependency of the app rather than a protocol
//! between us.
//!
//! The manifest names a command and what the app needs installed. It is read by
//! scanning the file, never by running or building anything: an app whose packages
//! are missing fails on import, and an app built from a crate has no binary at all
//! until it is built, so anything that executes an app to ask what it needs cannot
//! work. Scanning also means the list of apps is available without starting an
//! interpreter or a compiler.
//!
//! What used to be here was a protocol: an app wrote scenes as JSON lines and
//! flipctl laid them out as rows, cards, logs or a blitted canvas. It is gone, with
//! the screens that drew it. An app that wants those widgets links them.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The file a Python app is started from.
/// The manifest an app with no code of its own is declared in.
pub const MANIFEST: &str = "app.toml";

/// The per-app virtualenv, inside the app's own directory.
pub const VENV: &str = ".venv";

/// Which edge of the panel is the app's own top.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum Rotate {
    /// Landscape, like the panel and like flipctl.
    #[default]
    None,
    /// Portrait, read with the device turned so the panel's left edge is up.
    Left,
    /// Portrait the other way, the panel's right edge up.
    Right,
}

/// An app found on disk, before it runs.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct AppEntry {
    /// The declared name, or the directory name when it says nothing.
    pub name: String,
    pub dir: PathBuf,
    /// The folders this app sits in under `apps/`, outermost first, empty at the
    /// top level. Apps are grouped by where they live rather than by a category in
    /// the manifest: the directory is already the answer, and two apps cannot
    /// disagree about which folder they are in.
    pub group: Vec<String>,
    /// A file in the app's own directory. Empty when absent.
    pub icon: String,
    /// Debian packages the app needs.
    pub apt: Vec<String>,
    /// Python packages, installed into the app's own venv. Python apps only.
    pub pip: Vec<String>,
    /// The binary cargo produces, from the crate's name. Rust apps only.
    pub bin: String,
    /// The command line to run as a Wayland client. Wayland apps only.
    pub wayland: String,
    /// The size the program insists on drawing, when it is not the panel's.
    ///
    /// Doom is the case this exists for: it renders 320x200 and will not accept a
    /// smaller window, so tiling it into a 256x144 output shows a corner of the
    /// frame rather than the frame. Declaring the size lets flipctl scale the
    /// output while that app is in front, so the compositor fits the whole picture
    /// onto the panel instead.
    pub size: Option<(u32, u32)>,
    /// Whether the app is allowed to reach the sound server.
    ///
    /// Off by default, because a hosted app gets a runtime directory of its own and
    /// the sockets live in the real one: silence is what absence produces. Declaring
    /// it links PipeWire's sockets in and pins the app to the panel's own speaker, so
    /// it plays there rather than following whatever sink the desktop chose, which on
    /// this device is usually HDMI.
    ///
    /// It covers capture as well as playback: a client that can reach the socket can
    /// record, and separating the two would mean PipeWire access rules rather than
    /// anything of ours.
    pub audio: bool,
    /// Whether flipctl paints its own status bar over the app's picture.
    ///
    /// For an app that cannot draw the bar itself: it has no idea what the battery or
    /// the radios are doing, so it asks flipctl for the panel's usual top row rather
    /// than drawing a picture of one, and simply loses its top 13 pixels. An app on the
    /// framework fills the real bar in itself and leaves this off.
    pub status: bool,
    /// Which way the app's picture is turned relative to the panel.
    ///
    /// The panel is landscape and some apps are drawn portrait, to be read with the
    /// device turned. flipctl needs to know because it paints over their frames: a
    /// status bar belongs on the edge that is the app's top, not on the panel's.
    pub rotate: Rotate,
    /// Environment for the command, each entry `NAME=value`.
    ///
    /// What turns the console kind into something more general: the arrangement it
    /// sets up is a VT with the panel handed over, and a program that draws into
    /// the framebuffer rather than into the terminal wants the same thing plus a
    /// variable or two. `QT_QPA_PLATFORM=linuxfb` is the case it was added for.
    pub env: Vec<String>,
}

impl AppEntry {
    /// The program to run and the arguments to pass it.
    ///
    /// Through a shell, because the manifest names a command line rather than a
    /// program: "foot -e htop" is one field, not two.
    pub fn command(&self) -> (PathBuf, Vec<PathBuf>) {
        (
            PathBuf::from("/bin/sh"),
            vec![PathBuf::from("-c"), PathBuf::from(&self.wayland)],
        )
    }

    /// Where cargo puts the binary, for an app that carries a crate.
    pub fn binary(&self) -> PathBuf {
        self.dir.join("target").join("release").join(&self.bin)
    }

    pub fn icon_path(&self) -> Option<PathBuf> {
        (!self.icon.is_empty()).then(|| self.dir.join(&self.icon))
    }
}

/// The body of a TOML table, e.g. everything under `[package]`.
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

/// A boolean field, e.g. `audio = true`. None when the key is absent, so a
/// caller can tell "said no" from "said nothing".
fn py_bool(src: &str, key: &str) -> Option<bool> {
    src.lines()
        .filter(|l| !l.starts_with(char::is_whitespace))
        .find_map(|line| {
            let (k, v) = line.split_once('=')?;
            if k.trim() != key {
                return None;
            }
            match v.trim().trim_end_matches(|c: char| c == ',').to_ascii_lowercase().as_str() {
                "true" | "yes" | "1" => Some(true),
                "false" | "no" | "0" => Some(false),
                _ => None,
            }
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

/// The crate an app is built from, by the name under `[package]`.
///
/// Only for deciding whether to offer a build and where the binary lands: what
/// actually runs is the command line in the manifest.
fn crate_name(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("Cargo.toml"))
        .ok()
        .as_deref()
        .and_then(|src| toml_section(src, "package").and_then(|s| py_string(s, "name")))
        .unwrap_or_default()
}

/// Apps under `root`, at any depth, sorted by name so the menu order is stable.
///
/// A directory with a manifest is an app; one without is a folder to look inside,
/// which is what lets apps be grouped rather than listed as one long roll. An app
/// stops the walk, so nothing goes rummaging through a `target` or a `.venv`.
///
/// Nested as deeply as anyone cares to nest it. The walk cannot run away, because a
/// symlinked directory is not followed: that is the only way a directory tree loops,
/// and depth was never the thing worth limiting.
///
/// A directory that is neither is skipped rather than reported: a half-installed
/// app should not keep the menu from opening.
pub fn discover(root: &Path) -> Vec<AppEntry> {
    let mut apps = Vec::new();
    walk(root, &[], &mut apps);
    apps.sort_by(|a, b| (&a.group, &a.name).cmp(&(&b.group, &b.name)));
    apps
}

fn walk(dir: &Path, group: &[String], out: &mut Vec<AppEntry>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        // `file_type` rather than `is_dir`: it reports the entry itself, so a symlink
        // to a directory is not a directory here and the walk cannot be sent round a
        // loop or off into the rest of the filesystem.
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let dir = entry.path();
        let Some(name) = dir.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };
        // Nothing hidden, and nothing named as build output: an app's own crate
        // has a target directory and it is not a folder of apps.
        if name.starts_with('.') || name == "target" {
            continue;
        }
        if let Some(app) = read_manifest(&dir, group) {
            out.push(app);
        } else {
            let mut deeper = group.to_vec();
            deeper.push(name);
            walk(&dir, &deeper, out);
        }
    }
}

/// One app, from its manifest, or `None` if the directory has none.
fn read_manifest(dir: &Path, group: &[String]) -> Option<AppEntry> {
    let dir = dir.to_path_buf();
    let fallback = dir.file_name()?.to_string_lossy().to_string();

    // A manifest first: it is the only thing a console app has, and an
    // app that carries one has said what it is.
    if let Ok(src) = std::fs::read_to_string(dir.join(MANIFEST)) {
        let wayland = py_string(&src, "wayland").unwrap_or_default();
        if !wayland.is_empty() {
            return Some(AppEntry {
                name: py_string(&src, "name").unwrap_or(fallback),
                icon: py_string(&src, "icon").unwrap_or_default(),
                apt: py_list(&src, "apt"),
                pip: py_list(&src, "pip"),
                // The crate this app is built from, if it carries one: the
                // name under [package], which is what cargo names the
                // binary. Empty for an app that is a script or a program
                // out of the archive.
                bin: crate_name(&dir),
                wayland,
                size: py_size(&src, "size"),
                audio: py_bool(&src, "audio").unwrap_or(false),
                status: py_bool(&src, "status").unwrap_or(false),
                rotate: match py_string(&src, "rotate").unwrap_or_default().as_str() {
                    "left" => Rotate::Left,
                    "right" => Rotate::Right,
                    _ => Rotate::None,
                },
                env: py_list(&src, "env"),
                group: group.to_vec(),
                dir: dir.canonicalize().unwrap_or(dir),
            });
        }
    }

    // No manifest, no app: an app is a program that draws itself, and a directory of
    // source with nothing declaring how to run it is not that.
    None
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
            // Without the architecture: dpkg prints `qt6-wayland:arm64` for anything
            // marked Multi-Arch: same, and a manifest names the package, not the
            // build of it. Comparing the two verbatim reported every multi-arch
            // dependency as missing however many times it was installed.
            let name = name.split(':').next()?;
            (status.trim() == "installed").then_some(name)
        })
        .collect();
    packages
        .iter()
        .filter(|p| !installed.contains(&p.as_str()))
        .cloned()
        .collect()
}

/// Stop a program and everything it started.
///
/// The direct child of a launch is `/bin/sh`, and the program is its child, so
/// killing the child leaves the program running: with a window still on a workspace
/// flipctl then believes is free, which is how a game ended up tiled beside a file
/// manager. Launches put the app in its own process group so the whole group can be
/// signalled here.
///
/// TERM first, because a program that has a chance to exit tidily takes its
/// temporary files with it, then KILL for whatever ignored it.
pub fn stop_group(pid: u32) {
    let group = -(pid as i32);
    unsafe {
        libc::kill(group, libc::SIGTERM);
    }
    std::thread::sleep(std::time::Duration::from_millis(200));
    unsafe {
        libc::kill(group, libc::SIGKILL);
    }
}

/// A `size = "320x200"` field, as a pair.
fn py_size(src: &str, key: &str) -> Option<(u32, u32)> {
    let raw = py_string(src, key)?;
    let (w, h) = raw.split_once(['x', 'X'])?;
    Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
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
    if !entry.bin.is_empty() {
        // Rebuild when the binary is absent or older than any source file. Cargo
        // decides what actually needs recompiling; this only decides whether to
        // ask, and asking after every edit is what a person expects.
        m.needs_build = match entry.binary().metadata().and_then(|m| m.modified()) {
            Err(_) => true,
            Ok(built) => newest_source(&entry.dir).is_some_and(|src| src > built),
        };
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
        // Not the end of the job: an app can carry a crate and want Python packages
        // too, and returning here left it with a binary and no venv.
        log("built".into());
    }

    if missing.pip.is_empty() {
        log("done".into());
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
