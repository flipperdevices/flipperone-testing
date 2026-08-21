#!/usr/bin/env python3
"""Convert a BDF bitmap font to a PSF2 console font.

For the sizes the kernel does not carry under a licence we can embed. X11's
misc-fixed family is public domain and has a 7x14, which is 36 columns by 10 rows
on this panel: fewer and larger than Spleen 5x8, more and smaller than 8x16.

    ./tools/bdf-to-psf.py 7x14.bdf crates/flipper-ui/assets/console/7x14.psf

Only the first 256 code points are taken, because that is what a Linux console can
address; a BDF encoded in ISO10646 therefore contributes its Latin-1 range and the
rest is left blank.
"""
import re
import struct
import sys

# The console holds one byte's worth of glyphs, each padded to 32 bytes.
GLYPHS = 256


def parse(path):
    """(cell width, cell height, ascent, {code: [row bytes]})."""
    cell_w = cell_h = base = 0
    glyphs = {}
    code = None
    bbx = None
    rows = None
    for line in open(path, encoding="latin-1"):
        parts = line.split()
        if not parts:
            continue
        key = parts[0]
        if key == "FONTBOUNDINGBOX":
            cell_w, cell_h, _, y_off = (int(v) for v in parts[1:5])
            # The baseline sits this far up from the bottom of the cell.
            base = cell_h + y_off
        elif key == "ENCODING":
            code = int(parts[1])
        elif key == "BBX":
            bbx = tuple(int(v) for v in parts[1:5])
        elif key == "BITMAP":
            rows = []
        elif key == "ENDCHAR":
            if code is not None and 0 <= code < GLYPHS and bbx and rows is not None:
                glyphs[code] = (bbx, rows)
            code, bbx, rows = None, None, None
        elif rows is not None and re.fullmatch(r"[0-9A-Fa-f]+", key):
            rows.append(key)
    return cell_w, cell_h, base, glyphs


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 1
    src, out = sys.argv[1], sys.argv[2]
    cell_w, cell_h, base, glyphs = parse(src)
    if not cell_w or not glyphs:
        print(f"{src}: no font in there")
        return 1
    if cell_w > 8:
        print(f"{src}: {cell_w} px wide, and this writes one byte a row")
        return 1

    data = bytearray(GLYPHS * cell_h)
    for code, ((bw, bh, bx, by), rows) in glyphs.items():
        # Where the glyph's own box sits inside the cell: down from the top by the
        # part of the cell above it, and across by its own left bearing.
        top = base - (by + bh)
        for i, row in enumerate(rows[:bh]):
            y = top + i
            if not 0 <= y < cell_h:
                continue
            # BDF pads each row to whole bytes, high bit leftmost, so the first
            # byte already holds the leftmost eight pixels.
            bits = int(row[:2], 16) if row else 0
            if bx > 0:
                bits >>= bx
            elif bx < 0:
                bits = (bits << -bx) & 0xFF
            data[code * cell_h + y] |= bits
    if any(data[32 * cell_h:33 * cell_h]):
        print(f"{src}: space is not blank, so the parse is wrong")
        return 1

    header = struct.pack("<4sIIIIIII",
                         b"\x72\xb5\x4a\x86", 0, 32, 0, GLYPHS, cell_h, cell_h, cell_w)
    open(out, "wb").write(header + bytes(data))
    print(f"{out}: {cell_w}x{cell_h}, grid {256 // cell_w}x{144 // cell_h}, "
          f"{len(glyphs)} glyphs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
