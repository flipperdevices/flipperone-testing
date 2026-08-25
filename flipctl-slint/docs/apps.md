# Writing an app

An app is an ordinary Wayland client. flipctl runs a headless compositor, gives the
app an output sized to what it draws and a workspace of its own, reads its frames
and puts them on the panel. Nothing describes the app's screen to flipctl: the app
owns every pixel of its surface, and what keeps it looking like the device is that
it draws with flipctl's own widgets.

## The manifest

`app.toml` beside the program:

| Field | What |
|---|---|
| `name` | What the Apps menu shows. |
| `wayland` | The command, run with the app's own directory as the working directory. |
| `size` | `"320x200"` for a program that insists on drawing at its own size. The output is made that shape and the frame is scaled to the panel. |
| `apt` | Debian packages the app needs. |
| `audio` | Links the PipeWire sockets into the app's runtime directory and pins the panel's sink. |
| `status` | flipctl paints its own status strip over the app's frame, for a program that cannot draw one. An app on the framework draws the real bar itself and leaves this off. |
| `rotate` | `"left"` or `"right"` for a portrait app. |
| `env` | Extra environment, one `"KEY=value"` per entry. |

## The framework

`crates/flipctl-app` is what an app draws with. A Rust app takes it as a dependency
and as a build dependency:

    [dependencies]
    flipctl-app = { path = "../../crates/flipctl-app" }
    slint = { version = "1.17", default-features = false, features = [
        "compat-1-2", "backend-winit-wayland", "renderer-software", "std" ] }

    [build-dependencies]
    flipctl-app = { path = "../../crates/flipctl-app", features = ["build"] }

`build.rs` is one line, and it puts the widget library under `@flipctl` and the
generated theme under `@theme`:

    fn main() {
        flipctl_app::build::compile("ui/app.slint");
    }

What the crate gives the app:

| Item | What |
|---|---|
| `Shell` | The 256x144 window, the panel's fonts, and the keyboard wired up. Inherit it and forward its `key` callback to one of your own, which is what Rust can then bind. |
| `PanelStatus` | A Slint global the status bar reads. Set it once and every bar in the app shows it. |
| `Key::from_slint` | The panel's buttons by name. They arrive as ordinary keys: the D-pad as arrows, Ok as Return, Back as Backspace, and the five soft buttons as z x c v b. |
| `Key::soft_slot` | Which soft key was pressed, for the pressed state on the bar. |
| `apply_status!` | Fills `PanelStatus` from a `StatusSource`, which reads sysfs. An app has the same access flipctl does. |
| `picture` | A `paint::Surface` as an image, for an app that draws pixels. |
| `paint`, `font`, `pixel`, `theme` | The primitives, the panel's bitmap fonts, and every token. |

## The widgets

Imported from `@flipctl`, the same components flipctl's own screens are built from:

| Component | For |
|---|---|
| `MenuBody` (`list.slint`) | A list of rows with a selector, a scrollbar and the soft bar. |
| `DetailBody` (`detail.slint`) | Rows that can be a pair, a gauge or a rule. Set `fit_gauges` so the bars are sized around your labels. |
| `CardsBody` (`card.slint`) | Framed cards, each worth two lines, stacked down the page. |
| `LogBody` (`log.slint`) | Lines of output with a scrollbar. |
| `CanvasBody` (`canvas.slint`) | Your own picture, with text placed and measured on this side, and the soft bar over it. |
| `TextInputBody` (`keyboard.slint`) | The on-screen keyboard. |
| `Modal` (`modal.slint`) | A dialog over whatever is behind it. |
| `SoftBar`, `SoftButton` (`frame.slint`) | The five soft keys on their own. |
| `StatusBar` (`statusbar.slint`) | The top row, if you are not using a body that draws it. |

## The two examples

`apps/uptime` is the smallest one: five rows in `MenuBody`, a timer that re-reads
`/proc`, and Close and Refresh on the soft bar.

`apps/resmon` is the fuller one: four pages, three of rows in `DetailBody` and one
that paints two graphs into a `Surface` and shows them through `CanvasBody`, with
the soft keys switching pages.

## What it costs

Slint links statically, so an app's binary is around 13MB against 300KB for one
that only wrote JSON, and the first build on the device takes about twelve minutes.
After that only the app's own crate rebuilds, in seconds.
