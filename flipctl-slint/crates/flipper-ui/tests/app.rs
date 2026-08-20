//! The app scene parser and app discovery.
//!
//! The parser reads whatever an app writes, so its failure mode matters: a
//! malformed line must be ignored, never panic and never take the UI down.

use flipper_ui::app::{self, SceneKind};

/// Exactly what apps/ping/app.py emits for its parameter form.
const FORM: &str = r#"{"screen": {"type": "form", "title": "Ping", "rows": [{"label": "Host", "value": "1.1.1.1"}, {"label": "Count", "value": "5"}, {"label": "Interval", "value": "1.0s"}, {"label": "Size", "value": "56"}], "selected": 2, "buttons": ["Back", "", "", "", "Start"]}}"#;

const LOG: &str = r#"{"screen": {"type": "log", "title": "Ping 1.1.1.1", "lines": ["PING 1.1.1.1", "seq 1  ttl 59  2.60 ms", "5/5 received, 0% loss"], "buttons": ["Back", "", "", "", "Again"]}}"#;

#[test]
fn parses_a_form_scene() {
    let scene = app::parse_line(FORM).expect("form parses");
    assert_eq!(scene.kind, SceneKind::Form);
    assert_eq!(scene.title, "Ping");
    assert_eq!(scene.selected, 2);
    let pairs: Vec<(&str, &str)> = scene
        .rows
        .iter()
        .map(|r| (r.label.as_str(), r.value.as_str()))
        .collect();
    assert_eq!(
        pairs,
        [
            ("Host", "1.1.1.1"),
            ("Count", "5"),
            ("Interval", "1.0s"),
            ("Size", "56"),
        ]
    );
    assert_eq!(scene.buttons, vec!["Back", "", "", "", "Start"]);
}

#[test]
fn parses_a_log_scene() {
    let scene = app::parse_line(LOG).expect("log parses");
    assert_eq!(scene.kind, SceneKind::Log);
    assert_eq!(scene.title, "Ping 1.1.1.1");
    assert_eq!(scene.rows.len(), 3);
    assert_eq!(scene.rows[1].label, "seq 1  ttl 59  2.60 ms");
    // A log row carries no value; only forms use the second column.
    assert!(scene.rows.iter().all(|r| r.value.is_empty()));
}

/// An app writing nonsense must not be able to crash the UI. Every one of these
/// should return None or a partial scene, and none should panic.
#[test]
fn malformed_input_is_ignored_not_fatal() {
    for line in [
        "",
        "not json at all",
        "{}",
        r#"{"screen": {}}"#,
        r#"{"screen": {"type": "log", "lines": ["unterminated}"#,
        r#"{"screen": {"type": "form", "rows": [{"label": "a"}]}}"#,
        r#"{"screen": {"type": "log", "lines": [], "selected": -}}"#,
        r#"{"screen":{"type":"log","lines":["a \" quoted \" line"]}}"#,
        // A long line must not be special.
        &format!(r#"{{"screen": {{"type": "log", "lines": ["{}"]}}}}"#, "x".repeat(5000)),
    ] {
        let _ = app::parse_line(line);
    }
}

/// Escapes survive, because ping output can contain quotes and backslashes.
#[test]
fn unescapes_strings() {
    let line = r#"{"screen":{"type":"log","lines":["a \" b","c \\ d"]}}"#;
    let scene = app::parse_line(line).expect("parses");
    assert_eq!(scene.rows[0].label, "a \" b");
    assert_eq!(scene.rows[1].label, "c \\ d");
}

/// Discovery reads the manifests in `apps/` and sorts by name, so the menu order
/// does not depend on directory order.
#[test]
fn discovers_the_apps_directory() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps")
        .canonicalize()
        .expect("apps dir");
    let apps = app::discover(&root);
    assert!(
        apps.iter().any(|a| a.name == "Ping" && a.apt == ["iputils-ping"]),
        "expected the ping app, found {:?}",
        apps.iter().map(|a| &a.name).collect::<Vec<_>>()
    );
    let names: Vec<&String> = apps.iter().map(|a| &a.name).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted, "apps should be sorted by name");
}

/// A fresh empty directory under the system temp dir.
fn tempdir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("flipper-ui-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir");
    dir
}

/// A directory with no app.py is skipped rather than breaking the listing.
#[test]
fn a_directory_without_an_entry_is_skipped() {
    let tmp = tempdir("app-discovery");
    std::fs::create_dir_all(tmp.join("broken")).expect("mkdir");
    std::fs::create_dir_all(tmp.join("good")).expect("mkdir");
    std::fs::write(tmp.join("good/app.py"), "APP_NAME = \"Good\"\n").expect("write");

    let apps = app::discover(&tmp);
    assert_eq!(apps.len(), 1);
    assert_eq!(apps[0].name, "Good");
    let _ = std::fs::remove_dir_all(&tmp);
}

/// An entry's directory must be absolute.
///
/// `spawn` sets the child's working directory to it, and a relative script path
/// resolves against that new directory, so a relative entry turns `apps/ping` +
/// `apps/ping/app.py` into `apps/ping/apps/ping/app.py` and fails with ENOENT.
#[test]
fn discovered_paths_are_absolute() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps");
    let apps = app::discover(&root);
    assert!(!apps.is_empty(), "expected at least the ping app");
    for entry in &apps {
        assert!(
            entry.dir.is_absolute(),
            "{} has a relative dir: {}",
            entry.name,
            entry.dir.display()
        );
        // What must exist depends on the kind. A Python app's entry is its
        // source; a Rust app's is a binary that may not be built yet, so the
        // manifest is what proves the directory is an app.
        let proof = match entry.kind {
            app::Kind::Python => entry.entry(),
            app::Kind::Rust => entry.dir.join("Cargo.toml"),
        };
        assert!(
            proof.is_file(),
            "{} points at a missing file: {}",
            entry.name,
            proof.display()
        );
    }
}

/// The manifest is read out of the source, not by running it.
///
/// This is the whole point of scanning: an app that needs a package which is not
/// installed fails on import, so anything that executes it to ask what it needs
/// cannot work. The test therefore uses a file that would not survive being run.
#[test]
fn a_manifest_is_read_without_executing_the_app() {
    let dir = tempdir("manifest-scan");
    let app = dir.join("thing");
    std::fs::create_dir_all(&app).unwrap();
    std::fs::write(
        app.join("app.py"),
        r#"import nonexistent_module_that_would_fail
APP_NAME = "Thing"
APP_ICON = 'thing.png'
APP_APT = ["iputils-ping", "curl"]
APP_PIP = [
    "requests",
    "rich",
]

def helper():
    # Indented assignments are not the manifest.
    APP_NAME = "wrong"
    return APP_NAME
"#,
    )
    .unwrap();

    let found = flipper_ui::app::discover(&dir);
    assert_eq!(found.len(), 1);
    let a = &found[0];
    assert_eq!(a.name, "Thing");
    assert_eq!(a.icon, "thing.png", "single quotes count too");
    assert_eq!(a.apt, ["iputils-ping", "curl"]);
    assert_eq!(a.pip, ["requests", "rich"], "a list may span lines");
    assert_eq!(
        a.icon_path(),
        Some(app.canonicalize().unwrap().join("thing.png"))
    );
}

/// A directory with no app.py is not an app, and one with no APP_NAME is named
/// after its directory.
#[test]
fn discovery_needs_app_py_and_falls_back_to_the_directory_name() {
    let dir = tempdir("manifest-fallback");
    std::fs::create_dir_all(dir.join("empty")).unwrap();
    std::fs::create_dir_all(dir.join("unnamed")).unwrap();
    std::fs::write(dir.join("unnamed").join("app.py"), "print('hi')\n").unwrap();

    let found = flipper_ui::app::discover(&dir);
    assert_eq!(found.len(), 1, "the directory with no app.py is skipped");
    assert_eq!(found[0].name, "unnamed");
    assert!(found[0].apt.is_empty());
    assert!(found[0].pip.is_empty());
    assert_eq!(found[0].icon, "");
}

/// A directory with a Cargo.toml is a Rust app, and its manifest is read from
/// `[package.metadata.flipctl]` without building it.
///
/// Reading rather than building is the point: a Rust app has no binary at all
/// until it is compiled, so anything that runs an app to ask what it needs cannot
/// list one.
#[test]
fn a_rust_app_is_read_from_its_cargo_manifest() {
    let dir = tempdir("rust-app");
    let app = dir.join("thing");
    std::fs::create_dir_all(app.join("src")).unwrap();
    std::fs::write(
        app.join("Cargo.toml"),
        r#"[workspace]

[package]
name = "thing-app"
version = "0.1.0"
edition = "2021"

[package.metadata.flipctl]
name = "Thing"
icon = "thing.png"
apt = ["procps", "curl"]

[dependencies]
"#,
    )
    .unwrap();
    std::fs::write(app.join("src/main.rs"), "fn main() {}\n").unwrap();

    let found = app::discover(&dir);
    assert_eq!(found.len(), 1);
    let a = &found[0];
    assert_eq!(a.kind, app::Kind::Rust);
    assert_eq!(a.name, "Thing", "the display name, not the crate name");
    assert_eq!(a.bin, "thing-app", "the crate name, which is what cargo builds");
    assert_eq!(a.icon, "thing.png");
    assert_eq!(a.apt, ["procps", "curl"]);
    assert!(a.pip.is_empty(), "pip is a Python notion");

    // It runs as its own binary, with no interpreter in front of it.
    let (program, args) = a.command();
    assert_eq!(program, a.dir.join("target/release/thing-app"));
    assert!(args.is_empty());

    // With no binary built, the app needs one, and that is not a package to fetch.
    let m = app::missing(a);
    assert!(m.needs_build);
    assert!(!m.is_empty());
    assert!(m.pip.is_empty());
}

/// The section scanner must not confuse `name` under [package] with the display
/// name under [package.metadata.flipctl].
///
/// Both keys are called `name` at column zero, so a scan that ignores which table
/// it is in reads the crate name as the app's title.
#[test]
fn the_crate_name_and_the_display_name_are_kept_apart() {
    let dir = tempdir("rust-app-names");
    let app = dir.join("thing");
    std::fs::create_dir_all(&app).unwrap();
    std::fs::write(
        app.join("Cargo.toml"),
        "[workspace]\n\n[package]\nname = \"crate-name\"\n\n\
         [package.metadata.flipctl]\nname = \"Display Name\"\n",
    )
    .unwrap();

    let found = app::discover(&dir);
    assert_eq!(found[0].name, "Display Name");
    assert_eq!(found[0].bin, "crate-name");
}

/// A Rust app with no [package.metadata.flipctl] is still an app, named after its
/// directory.
#[test]
fn a_rust_app_without_a_manifest_section_still_works() {
    let dir = tempdir("rust-app-bare");
    let app = dir.join("bare");
    std::fs::create_dir_all(&app).unwrap();
    std::fs::write(
        app.join("Cargo.toml"),
        "[workspace]\n\n[package]\nname = \"bare\"\nversion = \"0.1.0\"\n",
    )
    .unwrap();

    let found = app::discover(&dir);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].name, "bare");
    assert_eq!(found[0].kind, app::Kind::Rust);
    assert!(found[0].apt.is_empty());
}

/// A detail scene: rows that are gauges, dividers and full-width lines, which is
/// what an app reporting progress sends.
///
/// The row kinds are the numbers DetailRow uses, because that is what draws them,
/// so this pins the mapping rather than the rendering.
#[test]
fn parses_a_detail_scene() {
    let line = r#"{"screen": {"type": "detail", "title": "Progress", "rows": [
        {"kind": "text", "label": "Running  21% of two jobs"},
        {"kind": "divider"},
        {"kind": "gauge", "label": "Download", "percent": 42},
        {"label": "", "value": "42%", "dim": true},
        {"label": "Elapsed", "value": "12.4s"}
    ], "buttons": ["Back", "", "Reset", "", "Pause"]}}"#;

    let scene = app::parse_line(line).expect("detail parses");
    assert_eq!(scene.kind, SceneKind::Detail);
    assert_eq!(scene.title, "Progress");
    assert_eq!(scene.buttons, ["Back", "", "Reset", "", "Pause"]);
    assert_eq!(scene.rows.len(), 5, "a divider is a row of its own");

    assert_eq!(scene.rows[0].kind, 3);
    assert_eq!(scene.rows[0].label, "Running  21% of two jobs");

    assert_eq!(scene.rows[1].kind, 1);
    assert_eq!(scene.rows[1].label, "", "a divider carries no label");

    assert_eq!(scene.rows[2].kind, 2);
    assert_eq!(scene.rows[2].label, "Download");
    assert_eq!(scene.rows[2].percent, 42);

    assert!(scene.rows[3].dim);
    assert_eq!(scene.rows[3].value, "42%");

    // No kind named means a label and a value, which is what a form row is.
    assert_eq!(scene.rows[4].kind, 0);
    assert!(!scene.rows[4].dim);
}

/// A gauge outside 0..=100 is clamped rather than trusted: the fill is a width,
/// and a negative or oversized one would draw outside the frame.
#[test]
fn a_gauge_percent_is_clamped() {
    let over = r#"{"screen":{"type":"detail","rows":[{"kind":"gauge","label":"a","percent":140}]}}"#;
    let under = r#"{"screen":{"type":"detail","rows":[{"kind":"gauge","label":"a","percent":-20}]}}"#;
    assert_eq!(app::parse_line(over).unwrap().rows[0].percent, 100);
    assert_eq!(app::parse_line(under).unwrap().rows[0].percent, 0);
}

/// The Progress app is discovered like any other, and needs nothing installed.
#[test]
fn the_progress_app_is_listed() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps")
        .canonicalize()
        .expect("apps dir");
    let apps = app::discover(&root);
    let progress = apps
        .iter()
        .find(|a| a.name == "Progress")
        .expect("the progress app");
    assert_eq!(progress.kind, app::Kind::Python);
    assert!(progress.apt.is_empty() && progress.pip.is_empty(), "stdlib only");
}
