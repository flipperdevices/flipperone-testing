# flipctl-slint

Slint implementation of the Flipper One UI: the shared component library plus a
demo binary that drives the 256x144 SPI panel, its buttons, and a browser view.

This is Phase 0 and Phase 1 of the flipctl UI plan. The library is intended to be
shared by `flipperos-installer`, `flipper-boot-menu` and `flipctl`; only the demo
consumer exists so far.

## Layout

| Path | What |
|---|---|
| `crates/flipper-ui/tokens.toml` | Every colour, offset, radius, timing and count. The single source of truth. |
| `crates/flipper-ui/build.rs` | Generates the Rust and Slint themes from it, and compiles the components. |
| `crates/flipper-ui/ui/` | `root.slint` (the one window), `idle.slint`, `list.slint`, `statusbar.slint`, `frame.slint`. |
| `crates/flipper-ui/src/status.rs` | Live battery, temperatures, power, hostname, profile and addresses, from sysfs and procfs. |
| `crates/flipper-ui/src/kms.rs` | DRM/KMS panel sink. |
| `crates/flipper-ui/src/evdev.rs` | Raw evdev button reader, no libinput. |
| `crates/flipper-ui/src/remote/` | Browser view: frame stream, input endpoint, comparison page. |
| `tools/` | Converters for the prototype's packed fonts and 6-bit greyscale sprites. |
| `crates/flipper-tokens/` | The theme generators, as a library both flipctl's build script and an app's can call. |
| `crates/flipctl-app/` | The framework a hosted app draws itself with: the window, the keys, the status global, and the widget library. |
| `docs/apps.md` | How to write an app. |
| `docs/inventory.md` | The design system as measured, and where fake-flipctl2's own docs have drifted from its code. |
| `docs/dependencies.md` | What the binary links, and why, with measurements. |

## Build

The host toolchain usually has no aarch64 std, so this is built on the device or
in the dev container, never on the local host.

    export CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
    cargo build --release -p flipper-ui-demo --features device,slint,remote

LTO off and 16 codegen units are for build speed while iterating; drop both for a
size-measured build.

## Run

On the panel, which needs `cog-seat1.service` stopped first because it holds
`card0`:

    sudo systemctl stop cog-seat1.service
    sudo ./target/release/flipper-ui-demo --panel

Browser only, leaving the panel to whatever owns it, with a side-by-side against
the fake-flipctl2 prototype:

    sudo systemd-run --unit=flipper-ui-demo --collect \
      --working-directory=$PWD \
      $PWD/target/release/flipper-ui-demo --headless \
      --remote 0.0.0.0:9999 --peer 127.0.0.1:8899 \
      --assets crates/flipper-ui/assets/remote

Then open `http://<device>:9999/`: both screens side by side, an overlay that
counts differing pixels, and a control pad laid out like the hardware.
`--frames N` exits after N commits and reports timings; `--bench` measures the
ceiling.

## Tests

    cargo test -p flipper-ui --features slint,remote

`FLIPPER_UI_BLESS=1` regenerates the goldens. Most goldens come from our own
output, so they only prove self-consistency; `tests/reference/soft_button_bar.png`
is derived from the design export instead, and is the one fixture that can catch
the implementation being confidently wrong.
