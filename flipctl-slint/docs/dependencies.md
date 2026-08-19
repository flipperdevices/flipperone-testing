# Dependency surface

Phase 1 acceptance requires that the aarch64 build link none of libinput,
libudev, libxkbcommon, libfontconfig or libfreetype. Measured on the host build,
which is the same crate graph.

## Before

```
libbrotlicommon.so.1  libbrotlidec.so.1  libbz2.so.1.0  libc.so.6
libexpat.so.1  libfontconfig.so.1  libfreetype.so.6  libgcc_s.so.1
libm.so.6  libpng16.so.16  libz.so.1
```

Taking `renderer-software` on its own and refusing every backend is **not
sufficient**. `i-slint-core` depends on `parley` for text layout, `parley` pulls
`fontique`, and `fontique` links `yeslogic-fontconfig-sys`, which drags
fontconfig, freetype, expat, png, brotli and bz2 onto the link line. None of that
is a backend, so none of it is avoidable by backend selection:

```
yeslogic-fontconfig-sys -> fontique -> parley -> i-slint-core -> slint
```

This is also the real cause of the panic `flipperos-installer` works around. Its
`main.slint` blames the LinuxKMS backend and its `.mk` ships three TTFs into
`/usr/share/fonts/flipctl` purely so fontconfig resolves at least one font. The
font engine is in `i-slint-core`, not the backend, so switching backends was never
going to help.

## After

```
libc.so.6  libgcc_s.so.1  libm.so.6
```

`i-slint-common` has a `fontconfig-dlopen` feature that switches fontique's
binding from link-time to `dlopen`. The `slint` facade does not re-export it, so
`flipper-ui` takes a direct dependency on `i-slint-common` for that feature alone
and lets Cargo's feature unification apply it to the fontique already in the
graph. Nothing looks for the library at runtime either, because glyphs are
pre-rasterised at compile time and we never enumerate system fonts.

Verified: all 16 tests pass and the rendered frame is byte-identical before and
after the switch.

## Consequences for Phase 2

`flipperos-installer.mk` can drop all five link-time dependencies:

```
FLIPPEROS_INSTALLER_DEPENDENCIES = host-pkgconf libinput libxkbcommon \
                                   fontconfig freetype udev
```

and `FLIPPEROS_INSTALLER_INSTALL_FONTS`, the hook that exists only to stop the
fontique panic. Whether `BR2_ROOTFS_DEVICE_CREATION_DYNAMIC_EUDEV` can also go is
a separate question: dropping the libudev *library* does not remove eudev, and
that package may be the larger win.

## Remaining mass

The stripped host release binary is 7.4 MB, of which **4.2 MB is `.rodata`**. The
prime suspect is `icu_normalizer`, pulled in by `i-slint-core`'s `shared-parley`
feature, which hardcodes `parley/complex-scripts`. Cargo features are additive, so
a downstream crate cannot subtract it.

Several megabytes of Unicode normalisation tables to render printable ASCII in
three pixel fonts is exactly the kind of waste Phase 2 is meant to find. Measure
with `cargo bloat` before deciding whether it is worth pursuing upstream.

| | size |
|---|---|
| `.rodata` | 4197661 |
| `.text` | 2393366 |
| `.eh_frame` | 317400 |
| total | 7382700 |

## Measured on the device

Built on the Flipper One itself (aarch64, 8 cores), since the host toolchain has
only `x86_64-unknown-linux-gnu` std. rustc 1.97.1 via rustup; that profile has no
`rustc`/`cargo` in apt.

    cargo build --release -p flipper-ui-demo --features device,slint
    # 8m21s cold, 23s incremental, with CARGO_PROFILE_RELEASE_LTO=false
    # and CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 for build speed

    readelf -d target/release/flipper-ui-demo | grep NEEDED
    NEEDED  libgcc_s.so.1
    NEEDED  libm.so.6
    NEEDED  libc.so.6

None of libinput, libudev, libxkbcommon, libfontconfig or libfreetype. 8.1 MB,
`.rodata` 4.3 MB.

| | |
|---|---|
| render mean | 2.07 ms |
| commit mean | 18.81 ms |
| commit worst | 23.11 ms |
| sustained | 47.7 fps |

The SPI transfer alone is 37152 bytes at 20 MHz, about 14.9 ms, so the commit path
adds roughly 4 ms for the gray8 to XRGB expansion, the kernel's
`drm_fb_xrgb8888_to_gray8`, and the ioctl.

Measure with `--panel --bench --frames N`. Without `--bench` the loop only
repaints on a state change, so frame counts track input rather than capability and
the throughput figure is meaningless.

```
rustup target add aarch64-unknown-linux-musl
cargo build --release --target aarch64-unknown-linux-musl \
    -p flipper-ui-demo --features device,slint
aarch64-linux-gnu-readelf -d target/aarch64-unknown-linux-musl/release/flipper-ui-demo \
    | grep NEEDED
```

A static musl build should report no `NEEDED` entries at all. A glibc cross build
should report only libc, libgcc_s and libm, matching the host result above.
