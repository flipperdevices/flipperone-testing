//! The framework a hosted app draws itself with.
//!
//! flipctl no longer describes an app's screen for it: an app is a Wayland client
//! on the compositor flipctl runs, and it owns every pixel of its surface. What it
//! takes from here is the interface: the same widgets flipctl's own screens are
//! built from, the same tokens, the same two fonts, and the panel's buttons as
//! names rather than as scancodes.
//!
//! An app is a `.slint` file composing the widgets, plus a `main` that fills in
//! the properties:
//!
//! ```ignore
//! // build.rs
//! fn main() {
//!     flipctl_app::build::compile("ui/app.slint");
//! }
//! ```
//!
//! ```ignore
//! slint::include_modules!();
//!
//! fn main() -> Result<(), slint::PlatformError> {
//!     let app = AppWindow::new()?;
//!     flipctl_app::keys(&app.window(), |key, down| { .. });
//!     app.run()
//! }
//! ```

pub use flipper_ui::status::{Status, StatusSource};
pub use flipper_ui::{font, paint, pixel, theme};
pub use flipper_ui::Ethernet;

/// Put a status reading on the panel's bar.
///
/// A macro because the global it writes to belongs to the app's own compiled
/// components, so no function here can name its type.
///
///     let mut source = flipctl_app::StatusSource::new(Duration::from_secs(2));
///     if let Some(now) = source.poll() {
///         flipctl_app::apply_status!(ui, PanelStatus, now);
///     }
#[macro_export]
macro_rules! apply_status {
    ($ui:expr, $global:ident, $status:expr) => {{
        let s = $status;
        let bar = $ui.global::<$global>();
        bar.set_battery(s.battery);
        bar.set_charging(s.charging);
        bar.set_wifi_connected(s.wifi_connected);
        bar.set_wifi_quality(s.wifi_quality);
        bar.set_ethernet(match s.ethernet {
            $crate::Ethernet::Down => 0,
            $crate::Ethernet::Real => 1,
            $crate::Ethernet::Usb => 2,
        });
        bar.set_modem_available(s.modem_available);
        bar.set_access_tech(s.access_tech.into());
        bar.set_modem_quality(s.modem_quality);
    }};
}

/// A greyscale picture as an image Slint can draw.
///
/// For an app that draws pixels rather than rows: it paints into a `paint::Surface`
/// with the same primitives and fonts flipctl's own screens use, and hands the
/// result over here. The grey is expanded to RGB because that is what an image
/// takes, and the panel converts it back on the way out; one panel-sized picture
/// is 110KB, which at the rate a graph changes is nothing.
pub fn picture(surface: &paint::Surface) -> slint::Image {
    let (w, h) = (surface.width(), surface.height());
    let mut buffer =
        slint::SharedPixelBuffer::<slint::Rgb8Pixel>::new(u32::from(w), u32::from(h));
    for (px, grey) in buffer.make_mut_slice().iter_mut().zip(surface.pixels()) {
        *px = slint::Rgb8Pixel { r: grey.0, g: grey.0, b: grey.0 };
    }
    slint::Image::from_rgb8(buffer)
}

/// The panel's buttons, as they arrive from the compositor.
///
/// flipctl forwards the panel's evdev codes to the focused app, so what reaches a
/// client is an ordinary key: the D-pad as arrows, Enter and Backspace, and the
/// five soft buttons as the letters `key.rs` maps them to. An app should never
/// have to know that, which is what this enum is for.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Key {
    Up,
    Down,
    Left,
    Right,
    Ok,
    Back,
    /// The five soft buttons, in silkscreen order.
    Escape,
    View,
    Power,
    Edit,
    Run,
    /// Push to talk. AppSwitch never reaches an app: flipctl keeps it.
    Ptt,
}

impl Key {
    /// The key behind a Slint key event, or `None` for one the panel has no
    /// button for.
    pub fn from_slint(text: &str) -> Option<Self> {
        use slint::platform::Key as K;
        let mut chars = text.chars();
        let (first, rest) = (chars.next()?, chars.next());
        if rest.is_some() {
            return None;
        }
        let named = |k: K| -> char { k.into() };
        Some(match first {
            c if c == named(K::UpArrow) => Self::Up,
            c if c == named(K::DownArrow) => Self::Down,
            c if c == named(K::LeftArrow) => Self::Left,
            c if c == named(K::RightArrow) => Self::Right,
            c if c == named(K::Return) => Self::Ok,
            c if c == named(K::Backspace) => Self::Back,
            'z' | 'Z' => Self::Escape,
            'x' | 'X' => Self::View,
            'c' | 'C' => Self::Power,
            'v' | 'V' => Self::Edit,
            'b' | 'B' => Self::Run,
            'a' | 'A' => Self::Ptt,
            _ => return None,
        })
    }

    /// Whether this is one of the five soft buttons, and which, from the left.
    pub const fn soft_slot(self) -> Option<usize> {
        Some(match self {
            Self::Escape => 0,
            Self::View => 1,
            Self::Power => 2,
            Self::Edit => 3,
            Self::Run => 4,
            _ => return None,
        })
    }
}

/// The build half: what an app's build script calls.
///
/// Generating the theme here rather than shipping a generated file keeps one
/// parse of tokens.toml behind every theme in the tree, flipctl's and every app's.
#[cfg(feature = "build")]
pub mod build {
    use std::collections::HashMap;
    use std::path::PathBuf;

    /// Compile an app's components against flipctl's widget library.
    ///
    /// The app's `.slint` imports the widgets it wants from `@flipctl` and the
    /// tokens from `@theme`:
    ///
    /// ```slint
    /// import { DetailBody, DetailRow } from "@flipctl/detail.slint";
    /// import { SoftBar } from "@flipctl/frame.slint";
    /// import { FlipperTheme } from "@theme";
    /// ```
    pub fn compile(entry: &str) {
        let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"));
        let tokens = PathBuf::from(env!("FLIPCTL_TOKENS"));
        let ui = PathBuf::from(env!("FLIPCTL_UI_DIR"));
        println!("cargo:rerun-if-changed={}", tokens.display());
        println!("cargo:rerun-if-changed={}", ui.display());
        println!("cargo:rerun-if-changed={}", env!("FLIPCTL_APP_DIR"));
        println!("cargo:rerun-if-changed={entry}");

        let doc = flipper_tokens::parse(&std::fs::read_to_string(&tokens).expect("tokens.toml"));
        let theme = out.join("theme.slint");
        flipper_tokens::write_if_changed(&theme, &flipper_tokens::slint_theme(&doc));

        // Pinned at 16, and it must stay there: the panel's fonts are pixel fonts
        // that rasterise with zero partial coverage at 16px and antialias at any
        // other size.
        std::env::set_var("SLINT_FONT_SIZES", "16");

        let libs = HashMap::from([
            ("theme".to_string(), theme),
            ("flipctl".to_string(), ui),
            ("app".to_string(), PathBuf::from(env!("FLIPCTL_APP_DIR"))),
        ]);
        let config = slint_build::CompilerConfiguration::new()
            .embed_resources(slint_build::EmbedResourcesKind::EmbedForSoftwareRenderer)
            .with_library_paths(libs);
        slint_build::compile_with_config(entry, config)
            .unwrap_or_else(|e| panic!("compile {entry}: {e}"));
    }
}
