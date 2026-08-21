# Console font

`spleen-5x8.psfu` is Spleen 5x8 by Frederic Cambus, 2-clause BSD, see
`LICENSE.spleen`. Upstream: https://github.com/fcambus/spleen

It is here because a console app hands the panel to the kernel's VT, and the
kernel's built-in font is 8x16: 32 columns by 9 rows on a 256x144 panel, which no
terminal program can work in. At 5x8 the same panel is 51x18, which htop fills
with its meters and six process rows.

`7x14.psf` is X11's misc-fixed 7x14, public domain ("Public domain font. Share and
enjoy.", see `LICENSE.x11-misc`), from font-misc-misc, converted by
`tools/bdf-to-psf.py`. The kernel has a 7x14 of its own but it is SPDX GPL-2.0,
and these are embedded in a binary that links Slint under GPL-3.0-only.

`mini4x6.psf` is the kernel's `lib/fonts/font_mini_4x6.c` by Kenneth Albanowski,
released to the public domain, converted by `tools/kernel-font-to-psf.py`.

Sizes were measured on the device rather than guessed. The kernel's own
`lib/fonts/font_mini_4x6.c` gives 64x24, enough for htop's whole table, but four
pixels a glyph reads as small; `font_6x8.c` gives 42x18 with the largest glyphs
and loses htop's right-hand columns. Both convert to PSF2 with a short script if
either is ever wanted: one byte per row in the C table, 256 glyphs, and mini_4x6
carries the same four bits in both nybbles so the glyph is the top one.

Which font an app runs in is the app's own business, so `app.toml` names one with
`font = "6x12"` and this list is what it may name.

The font is loaded with the KDFONTOP ioctl rather than by running setfont, so the
device needs no kbd package. Minimal profiles do not have one and cannot install
it.
