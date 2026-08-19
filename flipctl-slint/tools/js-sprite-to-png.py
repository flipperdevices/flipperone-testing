#!/usr/bin/env python3
"""Convert fake-flipctl2's 6-bit greyscale sprites into PNGs Slint can tint.

The prototype packs 4 pixels into 3 bytes, 6 bits each, where 0 is black and 63
is white, and `drawSprite` paints each pixel in the scene's ink colour at
`opacity = (63 - grey) / 63`. That is precisely an alpha mask, so the faithful
representation for Slint is a black RGBA image whose alpha carries the coverage;
`Image.colorize` then supplies the ink colour, which is white on the status bar
and black elsewhere.

`charging_status_bar` is the exception: the prototype draws it with
`drawSpriteLiteral`, keeping each pixel's own value and treating grey 63 as
transparent, so it becomes a real greyscale RGBA image and is not colorized.

Usage: js-sprite-to-png.py <icons.js|sprites.js> <outdir> <name> [name...]
       js-sprite-to-png.py --literal <file> <outdir> <name>
"""
import re
import sys
import zlib
import struct


def find_sprite(src, name):
    """Pull `w`, `h` and the data bytes out of a `var <name> = { ... }` block."""
    m = re.search(r"\b" + re.escape(name) + r"\s*=\s*\{(.*?)\n    \}", src, re.S)
    if not m:
        m = re.search(r"\b" + re.escape(name) + r"\s*=\s*\{(.*?)\}\s*;", src, re.S)
    if not m:
        raise SystemExit(f"sprite {name!r} not found")
    body = m.group(1)
    w = int(re.search(r"\bw:\s*(\d+)", body).group(1))
    h = int(re.search(r"\bh:\s*(\d+)", body).group(1))
    six = "bitsPerPixel" in body and re.search(r"bitsPerPixel:\s*(\d+)", body).group(1) == "6"
    data = re.search(r"\bd:\s*\[(.*?)\]", body, re.S).group(1)
    # Strip line comments first: the prototype annotates each row with
    # `// row 3`, and those digits would otherwise be read as pixel data and
    # shift every row by one byte.
    data = re.sub(r"//[^\n]*", "", data)
    values = [int(v, 0) for v in re.findall(r"0x[0-9a-fA-F]+|\d+", data)]
    return w, h, six, values


def unpack6(w, h, data):
    """Undo the 4-pixels-per-3-bytes packing. Mirrors _drawGrayscaleSprite."""
    out = []
    i = 0
    for _ in range(h):
        row = []
        col = 0
        while col < w:
            b0 = data[i] if i < len(data) else 0
            b1 = data[i + 1] if i + 1 < len(data) else 0
            b2 = data[i + 2] if i + 2 < len(data) else 0
            i += 3
            row += [
                (b0 >> 2) & 0x3F,
                (((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0F)) & 0x3F,
                (((b1 & 0x0F) << 2) | ((b2 >> 6) & 0x03)) & 0x3F,
                b2 & 0x3F,
            ]
            col += 4
        out.append(row[:w])
    return out


def unpack1(w, h, data):
    """Binary sprites: one integer per row, MSB is the leftmost pixel."""
    return [[0 if (data[r] >> (w - 1 - c)) & 1 else 63 for c in range(w)] for r in range(h)]


def write_png(path, w, h, rgba):
    raw = b"".join(b"\x00" + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(tag, payload):
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    open(path, "wb").write(png)


def main():
    literal = sys.argv[1] == "--literal"
    args = sys.argv[2:] if literal else sys.argv[1:]
    src_path, outdir, names = args[0], args[1], args[2:]
    src = open(src_path, encoding="utf-8").read()

    for name in names:
        w, h, six, data = find_sprite(src, name)
        grey = unpack6(w, h, data) if six else unpack1(w, h, data)

        rgba = []
        for row in grey:
            for g in row:
                if literal:
                    # Keep the pixel's own value; 63 is the transparent sentinel.
                    if g >= 63:
                        rgba += [0, 0, 0, 0]
                    else:
                        v = round(g * 255 / 63)
                        rgba += [v, v, v, 255]
                else:
                    # Alpha mask: coverage is (63 - g) / 63, ink comes from colorize.
                    rgba += [0, 0, 0, round((63 - g) * 255 / 63)]

        out = f"{outdir}/{name}.png"
        write_png(out, w, h, rgba)
        print(f"{name}: {w}x{h} {'6-bit' if six else 'binary'} -> {out}")


if __name__ == "__main__":
    main()
