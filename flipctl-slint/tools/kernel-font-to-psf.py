#!/usr/bin/env python3
"""Convert one of the kernel's built-in console fonts to a PSF2 file.

The kernel carries a handful of bitmap fonts in lib/fonts as C tables, one byte
per row of each glyph, 256 glyphs. They are the smallest console fonts that
exist, which is what a 256x144 panel wants, and mini_4x6 in particular is public
domain.

    ./tools/kernel-font-to-psf.py ../flipper-linux-kernel/lib/fonts/font_mini_4x6.c \
        4 6 crates/flipper-ui/assets/console/mini4x6.psf

Two details the tables hide. Every glyph is labelled with its own index in a
comment ("/* 0 0x00 '^@' */"), which is another byte if comments are not stripped
first, and every glyph then lands one byte into the one before it. And mini_4x6
stores the same four bits in both nybbles of each row, so the glyph is the top
one.
"""
import re
import struct
import sys


def main():
    if len(sys.argv) != 5:
        print(__doc__)
        return 1
    src, width, height, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    text = re.sub(r"/\*.*?\*/", "", open(src).read(), flags=re.S)
    found = [int(m, 16) for m in re.findall(r"0x([0-9a-fA-F]{2})", text)]
    if len(found) != 256 * height:
        print(f"{src}: {len(found)} bytes, expected {256 * height}")
        return 1
    # Narrower than a byte means the row is stored twice over; the glyph is the
    # high nybble.
    mask = 0xF0 if width <= 4 else 0xFF
    data = bytes(b & mask for b in found)
    if any(data[32 * height:33 * height]):
        print(f"{src}: space is not blank, so the parse is wrong")
        return 1
    header = struct.pack("<4sIIIIIII",
                         b"\x72\xb5\x4a\x86", 0, 32, 0, 256, height, height, width)
    open(out, "wb").write(header + data)
    print(f"{out}: {width}x{height}, grid {256 // width}x{144 // height}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
