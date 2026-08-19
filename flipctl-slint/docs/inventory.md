# Design system inventory

Phase 0 deliverable. The normative record of what the Flipper One UI looks like,
extracted from `fake-flipctl2`.

`tokens.toml` is the machine-readable half of this document. Every value in it
was read out of prototype **source**, never out of
`fake-flipctl2/fake_flipctl2_CLAUDE.md`, because that document has drifted from
the code in a dozen places. The drift is catalogued below so nobody re-derives
values from it by mistake.

## Rendering invariants

The panel is a 256x144 8-bit greyscale device: `flipper-one-display.c` advertises
`DRM_FORMAT_XRGB8888` only and converts what it is handed with
`drm_fb_xrgb8888_to_gray8`.

1. **Every pixel holds a design-token value.** Enforced by
   `tests/render.rs::rendered_frames_use_only_design_tokens`, which renders each
   screen and fails on any grey level absent from `tokens.toml`, naming the
   offending coordinates. The reference list screen resolves to exactly four
   values: `#000000`, `#ffffff`, `#cccccc` (divider), `#999999` (status text).
2. **No antialiasing.** Consequence of (1). The three practical causes of a
   violation are a `border-radius` corner, a `Text` at a fractional offset, and a
   `font-family` that silently fell back to a substitute face.
3. **Integer pixels only.** No fractional layout, no scale factor.
4. **Font size is always 16px.** The FlipCTL fonts sit on a 64-unit design-pixel
   grid at 1024 units/em, so they rasterise with zero partial coverage at 16px
   and antialias at 8, 15 or 17px. `SLINT_FONT_SIZES` is pinned to 16 in
   `build.rs`.
5. **`font-family` takes the family name, not the full name.** `"HaxrCorp 4090"`,
   `"Busy9px"`, `"Born2bSportyV2"`. Passing `"HaxrCorp 4090 FlipCTL"` substitutes
   a fallback face with no warning and antialiases every glyph.

## Fonts

All 282 printable-ASCII glyph shapes in the prototype's packed 1bpp tables
(`haxrcorp16.js`, `busy9.js`, `born2bsportyv2.js`) are **byte-identical** to the
`flipctl-fonts` TTFs rasterised at 16px and thresholded at >= 128. At that size
the threshold is a no-op, so the JS tables and the TTFs are interchangeable. The
tables are vendored as Rust arrays by `tools/js-font-to-rust.py` and serve as the
measurement oracle; Slint renders from the TTFs.

| Role | Family | Frame | Used by |
|---|---|---|---|
| title | HaxrCorp 4090 | 13 rows x 16 cols | status bar, titles, dialogs, message box |
| row | Busy9px | 16 x 16 | `MenuLine` label and status, DEFAULT state |
| row_active | Born2bSportyV2 | 18 x 16 | `MenuLine`, SELECTED and PRESSED states |

The font swap on selection is load-bearing: a selected row changes typeface, not
just weight.

## Elements that are not rounded rectangles

Three prototype components are built from hand-placed pixels and cannot be
expressed with `border-radius`. Transcribed in `ui/frame.slint`, with
`paint.rs` holding the same geometry as the test oracle.

**`MenuSelectorFrame`** (`component-library/MenuSelectorFrame.js`)
- corners are straight 45-degree stairs, `(x + i, y + r - 1 - i)` for `i` in `0..r`
- a 1px drop shadow at `y + h` and at `x + w`, both *outside* the frame, each
  inset by the radius and one pixel longer than the edge it shadows so the two
  runs meet at the bottom-right stair
- two extra pixels at `(x + w - 2, y + h - 1)` and `(x + w - 1, y + h - 2)`
  weighting the bottom-right cut
- per-corner enable flags, so a frame can round any subset of its corners
- the fill is chamfered along the same diagonal as the stroke, row by row, so cut
  corners stay transparent

**Bottom-bar soft buttons** (`canvas.js` `drawMiddleButton` and friends)
- four-step stair: the fill steps in 3, 2, 1, 0 pixels over the first four rows
- two explicit border pixels per rounded corner, at `(2, 1)` and `(1, 2)`
- no bottom border; the button sits flush against the bottom of the panel
- outer slots run flush to the screen edge, losing both the stair and the
  vertical border on that side

**`MessageBox`**, keyboard container, `PopupMenuLeft` - same situation, not yet
transcribed.

Note that `drawRoundRect` / `drawRoundFrame` use a **different** corner treatment
from `MenuSelectorFrame`: two pixels at `(2, 1)` and `(1, 2)` for `r = 3`, versus
the selector's three-pixel diagonal. Both are in use. Dialogs and popups take the
`drawRoundFrame` form.

## Where the prototype's CLAUDE.md is wrong

Verified against the code on 2026-08-19. Code wins in every row.

| Claim in the doc | Actually in the code | Source |
|---|---|---|
| divider `#EDEDED` | `#CCCCCC` | `apps/menu.js` `DIVIDER_COLOR` |
| "Unselected `#EAEAEA`" | no such colour anywhere | - |
| `TEXT_DRAW_Y = 2`, cap top at y+5 | `3`, cap top at y+6 | `MenuLine.js` |
| `STATUS_PAD_R = 3` | `5` | `MenuLine.js` |
| `CONTAINER_X = 16` | `5` | `apps/menu.js` |
| `SELECTOR_X = 10`, `W = 232` | `4`, `244` with scrollbar / `247` without | `apps/menu.js` |
| fonts named `HaxrcorpFont16`, `BusyFont9`, `Born2bSportyV2Medium` | `HaxrCorp4090FlipCTL`, `Busy9pxFlipCTL`, `Born2bSportyV2FlipCTL` | `js/*.js` |
| status bar 0-11px, 2px divider gap, clock centred | `STATUS_BAR_H = 13`, no clock rendered | `ui.js` |
| disabled = `#CCC` ground, `#999` text | `drawMiddleButton` keeps a **white** ground and greys only outline and text; `drawLeftButton` / `drawRightButton` do use `#CCC` | `canvas.js` |

That last row is a genuine inconsistency between components, not a documentation
error. It needs a decision: pick one disabled treatment.

## Decisions, resolved 2026-08-19

**No grey that is not a token.** The selection frame keeps its raised look and
every rounded element is transcribed rather than approximated with
`border-radius`. The reference list screen renders in exactly four values.
Enforced by `tests/render.rs`.

**One corner rule: the 45-degree diagonal.** canvas.js carried two corner tables
for the same radius; `drawRoundFrame`'s tighter two-pixel step is retired and
everything uses `MenuSelectorFrame`'s diagonal, generalised to any radius as
`(i, r - 1 - i)` for `i` in `0..r` with straight edges beginning `r` pixels in.
That single rule reproduces the r=3 selector corner and the r=4 soft-button stair
byte for byte, which `tests/paint.rs` pins. Dialogs, `MessageBox` and
`PopupMenuLeft` change slightly when they are built; the selector does not change
at all.

**Disabled: outline only.** White ground, `#999999` outline and label. The
`#cccccc` ground the left and right slots used is retired, so all five slots now
match. Recorded as `rule.disabled = "outline-only"`.

**Overflow: wrap to a second line.** Recorded as `rule.overflow = "wrap"`, applied
wherever there is vertical room: dialogs, `MessageBox`, titles, detail screens.
`MenuLine` is the one place it cannot apply, because a 20px row cannot hold two
16px lines and growing the row would make list height variable and break the
five-row viewport; a label longer than its row truncates there. This matches what
fake-flipctl2 actually does, since its wrapping commits targeted dialog text and
the booting profile name, never menu rows.

**Soft-key row: esc, view, power, edit, run**, left to right. This confirms
`drivers/input/misc/flipper-one-input.c` (`KEY_Z`, `KEY_X`, `KEY_C`, `KEY_V`,
`KEY_B`) and retires `fake-flipctl2/js/input.js`, which named two of them `edit`
and `del`. `src/key.rs` is the single mapping; `tests/tokens.rs` asserts the order
and that no `del` key exists.

## Soft-button strip, approved 2026-08-19

Measured pixel by pixel from the Figma export `soft_button_bar`, which is kept as
`tests/reference/soft_button_bar.png`.

| | value |
|---|---|
| button width | 48 |
| gap | 4 |
| pitch | 52, slots at 0, 52, 104, 156, 208 |
| height | 14 |
| corner | 3px 45-degree diagonal, top corners only |
| bottom border | none, the strip runs to the panel bottom |
| label | centred, `y + 2`, caps on strip rows 4..10, 8-character budget (37px) |

`5 * 48 + 4 * 4 = 256` exactly, so the row fills the panel and both outer edges
land flush. This replaces canvas.js's arrangement, which tiled from the left with
a 2px gap and then anchored the right button at `screenW - w`, leaving a 10px hole
before the last slot.

**The outer two slots are special.** Slot 0 has no left border and its top edge
starts at x0; slot 4 has no right border and its top edge runs to x255. The three
inner slots are outlined on both sides. The set of columns carrying a border down
the straight body is therefore `47, 52, 99, 104, 151, 156, 203, 208`, and
`tests/render.rs` asserts exactly that.

The strip starts at y130, so the list occupies y26..y129: five 20px rows plus four
dividers is 104px, and `26 + 104 = 130` meets the strip with no wasted row.
menu.js used 25, which left row 129 unused.

Height is the one place the Figma export and the shipping device disagree: the
export is 17 rows, the device is 14, and **14 is the decision**. The reference
test therefore compares rows 0..3 exactly and then the border-column set, both of
which are height independent; replace the reference with a 14-row export to
compare the whole strip again.

## Which source is normative

This document treats **fake-flipctl2 source** as normative for measurements and
**Vlad's Figma exports** as the design authority, and on the soft-button height
those two disagreed, with the prototype winning. That makes the other numbers taken
from prototype source worth one deliberate pass rather than element-by-element
discovery: `MenuSelectorFrame`'s drop shadow, the 20px `MenuLine`, the `#CCCCCC`
divider, `TEXT_DRAW_Y = 3`, and the disabled-state treatment.

A design export saved as a test fixture is the only kind of golden here that can
catch an implementation being self-consistently wrong; every other golden is
generated from our own output. Exports dropped in at 1x, or a clean integer
multiple, can each become one.

## Open questions

None blocking. Still to decide when the components are built: whether
`PopupMenuLeft`'s `#d0d0d0` shadow edge survives the no-grey rule, since it is a
token but a very light one.

## Renders

In `docs/inventory/`, all 8-bit greyscale PNGs at 256x144 unless the name says
otherwise. These are the exact bytes the panel receives.

| File | Content |
|---|---|
| `list-no-grey.png` | reference list screen, 4 token values, zero antialiasing |
| `list-no-grey-4x.png` | the same at 4x for reading |
| `selector-menuselectorframe.png` | transcribed selector frame |
| `selector-border-radius.png` | `border-radius`, for comparison |
| `*-pressed.png` | press-flash variants |
| `compare-row-1x-2x-4x.png` | selector row, both treatments, three scales |
| `compare-corner-22x.png` | bottom-right corner at 22x |
| `compare-full-4x.png` | both full screens |
| `compare-grey-vs-none-3x.png` | before and after the grey was removed |

`tests/golden/list.png` and `list-pressed.png` are the committed goldens.
Regenerate with `FLIPPER_UI_BLESS=1 cargo test --features slint`.

## Still to inventory

Status-bar badges (5G bars and tech label, wifi 7x7, ethernet 13x7, recording
dot, battery 16x9 with charging overlay and percentage), scrollbar with dotted
track, `PopupMenuLeft`, `DeleteConfirmDialog`, virtual keyboard (15x16 keys in a
250x77 container), `TextInputBox` / `InputField`, `MessageBox` and its tail,
`ResponsiveFrame`, `TabHeader`, roughly 35 static 6-bit greyscale icons and 10
animated vertical strips at 200ms per frame.

## Driver gaps found on the device

Both are userspace-visible and neither is worked around in the kernel, per the
decision to keep kernel changes out of scope.

**No `dirty_fb`.** `flipper-one-display.c` sets `.fb_create = drm_gem_fb_create`
and no `dirty_fb`, so `DRM_IOCTL_MODE_DIRTYFB` returns `ENOSYS`. Every other
mipi-dbi tiny driver wires `drm_atomic_helper_dirtyfb`. `KmsSink` probes once and
falls back to re-issuing `set_crtc` with the same mode and framebuffer: mode and fb
are unchanged so the helpers set no `mode_changed` and there is no disable/enable
cycle, and `fo_crtc_check` calls `drm_atomic_add_affected_planes`, so the plane
lands in the commit and `fo_plane_atomic_update` writes the SPI buffer.
`KmsSink::flush_path()` reports which path was taken, so a driver that later gains
`dirty_fb` becomes visible instead of silently unused.

**No damage clipping and no `DRM_FORMAT_R8`.** As recorded in the plan.
`fo_set_tx_buffer_data` hardcodes the clip to the whole framebuffer and
retransmits all 37152 bytes per commit, and the only advertised format is
`XRGB8888`, so userspace expands greyscale to 32bpp and the kernel converts it
straight back. Together these account for most of the ~4 ms of non-SPI commit
time.
