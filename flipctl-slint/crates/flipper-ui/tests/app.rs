//! The app scene parser and app discovery.
//!
//! The parser reads whatever an app writes, so its failure mode matters: a
//! malformed line must be ignored, never panic and never take the UI down.

use flipper_ui::app::{self, SceneKind};

/// Exactly what apps/ping/ping.py emits for its parameter form.
const FORM: &str = r#"{"screen": {"type": "form", "title": "Ping", "rows": [{"label": "Host", "value": "1.1.1.1"}, {"label": "Count", "value": "5"}, {"label": "Interval", "value": "1.0s"}, {"label": "Size", "value": "56"}], "selected": 2, "hints": ["Back", "", "", "", "Start"]}}"#;

const LOG: &str = r#"{"screen": {"type": "log", "title": "Ping 1.1.1.1", "lines": ["PING 1.1.1.1", "seq 1  ttl 59  2.60 ms", "5/5 received, 0% loss"], "hints": ["Back", "", "", "", "Again"]}}"#;

#[test]
fn parses_a_form_scene() {
    let scene = app::parse_line(FORM).expect("form parses");
    assert_eq!(scene.kind, SceneKind::Form);
    assert_eq!(scene.title, "Ping");
    assert_eq!(scene.selected, 2);
    assert_eq!(
        scene.rows,
        vec![
            ("Host".into(), "1.1.1.1".into()),
            ("Count".into(), "5".into()),
            ("Interval".into(), "1.0s".into()),
            ("Size".into(), "56".into()),
        ]
    );
    assert_eq!(scene.hints, vec!["Back", "", "", "", "Start"]);
}

#[test]
fn parses_a_log_scene() {
    let scene = app::parse_line(LOG).expect("log parses");
    assert_eq!(scene.kind, SceneKind::Log);
    assert_eq!(scene.title, "Ping 1.1.1.1");
    assert_eq!(scene.rows.len(), 3);
    assert_eq!(scene.rows[1].0, "seq 1  ttl 59  2.60 ms");
    // A log row carries no value; only forms use the second column.
    assert!(scene.rows.iter().all(|(_, v)| v.is_empty()));
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
    assert_eq!(scene.rows[0].0, "a \" b");
    assert_eq!(scene.rows[1].0, "c \\ d");
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
        apps.iter().any(|a| a.name == "Ping" && a.exec == "ping.py"),
        "expected the ping app, found {:?}",
        apps.iter().map(|a| &a.name).collect::<Vec<_>>()
    );
    let names: Vec<&String> = apps.iter().map(|a| &a.name).collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted, "apps should be sorted by name");
}

/// A directory with no manifest is skipped rather than breaking the listing.
#[test]
fn a_directory_without_a_manifest_is_skipped() {
    let tmp = std::env::temp_dir().join("flipper-ui-app-discovery-test");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(tmp.join("broken")).expect("mkdir");
    std::fs::create_dir_all(tmp.join("good")).expect("mkdir");
    std::fs::write(
        tmp.join("good/app.toml"),
        "name = \"Good\"\nexec = \"run.sh\"\n",
    )
    .expect("write");

    let apps = app::discover(&tmp);
    assert_eq!(apps.len(), 1);
    assert_eq!(apps[0].name, "Good");
    let _ = std::fs::remove_dir_all(&tmp);
}

/// An entry's directory must be absolute.
///
/// `spawn` sets the child's working directory to it, and exec resolves a relative
/// program path against that new directory, so a relative entry turns
/// `apps/ping` + `apps/ping/ping.py` into `apps/ping/apps/ping/ping.py` and fails
/// with ENOENT.
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
        assert!(
            entry.dir.join(&entry.exec).is_file(),
            "{} points at a missing executable: {}",
            entry.name,
            entry.dir.join(&entry.exec).display()
        );
    }
}
