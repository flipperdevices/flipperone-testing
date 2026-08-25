//! Records where flipctl's UI library lives, for the build half of this crate.
//!
//! An app's build script needs two paths that are not its own: the widgets in
//! crates/flipper-ui/ui and the tokens they are themed from. Resolving them here
//! rather than in each app keeps the app's build script to one line and means an
//! app moved somewhere else in the tree still finds them.

fn main() {
    let ui = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/")
        .join("flipper-ui");
    println!("cargo:rustc-env=FLIPCTL_UI_DIR={}", ui.join("ui").display());
    println!("cargo:rustc-env=FLIPCTL_TOKENS={}", ui.join("tokens.toml").display());
    println!(
        "cargo:rustc-env=FLIPCTL_APP_DIR={}/ui",
        env!("CARGO_MANIFEST_DIR")
    );
}
