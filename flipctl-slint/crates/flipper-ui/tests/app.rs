//! App discovery.
//!
//! An app is a directory with an `app.toml` in it, and what is read from that
//! manifest decides whether the app can be listed, started and built at all. Every
//! test here reads a manifest without running or building anything, which is the
//! property that lets the list open before an app's dependencies exist.

use flipper_ui::app;







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
        apps.iter().any(|a| a.name == "Uptime" && a.apt == ["procps"]),
        "expected the uptime app, found {:?}",
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

/// A directory with no manifest is skipped rather than breaking the listing.
///
/// Source with nothing declaring how to run it is not an app: half an app, an
/// abandoned experiment or a directory of assets should not stop the list opening.
#[test]
fn a_directory_without_a_manifest_is_skipped() {
    let tmp = tempdir("app-discovery");
    std::fs::create_dir_all(tmp.join("broken")).expect("mkdir");
    std::fs::write(tmp.join("broken/app.py"), "print(\"hello\")\n").expect("write");
    std::fs::create_dir_all(tmp.join("good")).expect("mkdir");
    std::fs::write(
        tmp.join("good/app.toml"),
        "name = \"Good\"\nwayland = \"python3 app.py\"\n",
    )
    .expect("write");

    let apps = app::discover(&tmp);
    assert_eq!(apps.len(), 1);
    assert_eq!(apps[0].name, "Good");
    let _ = std::fs::remove_dir_all(&tmp);
}

/// An entry's directory must be absolute.
///
/// An app runs with its own directory as the working directory, and a relative
/// program path would then resolve against that new directory: `apps/uptime` plus
/// `./target/release/uptime-app` would become
/// `apps/uptime/apps/uptime/target/release/uptime-app` and fail with ENOENT.
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
        // The manifest is the whole proof: what an app runs is a command line, and
        // the program behind it may be the system's or a binary that is not built
        // yet.
        let proof = entry.dir.join(app::MANIFEST);
        assert!(
            proof.is_file(),
            "{} points at a missing file: {}",
            entry.name,
            proof.display()
        );
    }
}

/// The manifest is read as text, not by running anything.
///
/// This is the whole point of scanning: an app that needs a package which is not
/// installed fails on import, and an app built from a crate has no binary at all
/// until it is built, so anything that executes an app to ask what it needs cannot
/// work.
#[test]
fn a_manifest_is_read_without_executing_the_app() {
    let dir = tempdir("manifest-scan");
    let app = dir.join("thing");
    std::fs::create_dir_all(&app).unwrap();
    std::fs::write(
        app.join("app.toml"),
        r#"# A comment, and a key that only looks like one: not_name = "wrong"
name = "Thing"
icon = 'thing.png'
wayland = "python3 app.py"
apt = ["iputils-ping", "curl"]
pip = [
    "requests",
    "rich",
]
audio = true
"#,
    )
    .unwrap();

    let found = flipper_ui::app::discover(&dir);
    assert_eq!(found.len(), 1);
    let a = &found[0];
    assert_eq!(a.name, "Thing");
    assert_eq!(a.wayland, "python3 app.py");
    assert_eq!(a.icon, "thing.png", "single quotes count too");
    assert_eq!(a.apt, ["iputils-ping", "curl"]);
    assert_eq!(a.pip, ["requests", "rich"], "a list may span lines");
    assert!(a.audio);
    assert_eq!(
        a.icon_path(),
        Some(app.canonicalize().unwrap().join("thing.png"))
    );
}

/// An app built from a crate: the manifest names it and the crate names the binary.
///
/// Both files have a `name` at column zero, and the one that decides what to build
/// is the crate's. Reading the wrong one offers a build that produces a binary
/// nobody looks for.
#[test]
fn a_crate_gives_the_binary_its_name() {
    let dir = tempdir("crate-app-names");
    let app = dir.join("thing");
    std::fs::create_dir_all(&app).unwrap();
    std::fs::write(
        app.join("app.toml"),
        "name = \"Display Name\"\nwayland = \"./target/release/crate-name\"\n",
    )
    .unwrap();
    std::fs::write(
        app.join("Cargo.toml"),
        "[workspace]\n\n[package]\nname = \"crate-name\"\n",
    )
    .unwrap();

    let found = app::discover(&dir);
    assert_eq!(found[0].name, "Display Name");
    assert_eq!(found[0].bin, "crate-name");
    assert_eq!(found[0].binary(), found[0].dir.join("target/release/crate-name"));
}









/// A hosted app is a manifest and nothing else.
///
/// htop is the case this exists for: a program that draws into a terminal, which
/// this repo does not ship, wrap or build. It used to be handed the kernel's VT and
/// the panel with it; now it runs in a terminal emulator that is itself a Wayland
/// client, so several can run at once and nothing but flipctl touches the panel.
/// What the manifest declares either way is a command line.
#[test]
fn the_htop_app_is_a_manifest() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps")
        .canonicalize()
        .expect("apps dir");
    let apps = app::discover(&root);
    let htop = apps.iter().find(|a| a.name == "htop").expect("the htop app");

    assert!(htop.wayland.contains("htop"), "the command runs htop");
    assert!(
        htop.wayland.starts_with("foot"),
        "in a terminal of its own, not on a VT: {}",
        htop.wayland
    );
    assert_eq!(
        htop.apt,
        ["foot", "htop"],
        "both declared, so they can be installed on demand"
    );
    assert!(htop.pip.is_empty());
    assert!(!htop.dir.join("app.py").exists(), "no code of ours");

    // Run through a shell, because the manifest names a command line: the day one
    // of these says "journalctl -f" it has to stay one command, not two.
    let (program, args) = htop.command();
    assert_eq!(program, std::path::Path::new("/bin/sh"));
    assert_eq!(
        args,
        [
            std::path::Path::new("-c"),
            std::path::Path::new(htop.wayland.as_str())
        ]
    );
}


/// Apps are found in folders at any depth, and a folder is only a folder until it
/// has a manifest: an app's own directory stops the walk, so its `target` and
/// `.venv` are never rummaged through. A symlinked directory is not followed, which
/// is what keeps an unbounded walk from looping.
#[test]
fn apps_are_found_in_folders() {
    let tmp = tempdir("app-folders");
    let write = |at: &std::path::Path, body: &str| {
        std::fs::create_dir_all(at).expect("mkdir");
        std::fs::write(at.join("app.toml"), body).expect("write");
    };
    write(&tmp.join("loose"), "name = \"Loose\"\nwayland = \"true\"\n");
    write(&tmp.join("net/ping"), "name = \"Ping\"\nwayland = \"true\"\n");
    write(&tmp.join("net/deeper/nmap"), "name = \"Nmap\"\nwayland = \"true\"\n");
    // Build output inside an app, which must not be read as a folder of apps.
    write(
        &tmp.join("built/target/release/decoy"),
        "name = \"Decoy\"\nwayland = \"true\"\n",
    );
    std::fs::write(
        tmp.join("built/app.toml"),
        "name = \"Built\"\nwayland = \"true\"\n",
    )
    .expect("write");

    // A loop, which an unbounded walk has to survive.
    std::os::unix::fs::symlink(&tmp, tmp.join("net/loop")).expect("symlink");

    let apps = app::discover(&tmp);
    let found: Vec<(&str, Vec<&str>)> = apps
        .iter()
        .map(|a| {
            (
                a.name.as_str(),
                a.group.iter().map(String::as_str).collect::<Vec<_>>(),
            )
        })
        .collect();
    assert_eq!(
        found,
        vec![
            ("Built", vec![]),
            ("Loose", vec![]),
            ("Ping", vec!["net"]),
            ("Nmap", vec!["net", "deeper"]),
        ],
        "sorted by folder then name, with the decoy behind an app's manifest unseen"
    );
    let _ = std::fs::remove_dir_all(&tmp);
}
