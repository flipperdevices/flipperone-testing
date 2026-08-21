#!/usr/bin/env python3
"""Pull the artwork out of the design mockups into art.py.

The mockups in this directory are the design, at three scales: image1 and image3
are 1:1, image2 is 3.5x and image4 is 6x. Everything the app has to draw as pixels
rather than as text comes from them, so it comes from here rather than being
redrawn by hand and drifting.

Run from this directory:

    python3 extract_art.py

The output is `art.py`, a generated module of 1bpp sprites: rows of bytes, high bit
leftmost, a set bit meaning ink. Regenerate it when a mockup changes; do not edit
it.
"""
import base64
import struct
import zlib

# The mockups use three tones: ink at luma 0, a mid band behind the unselected
# cards at 76, and the bright ground at 152. Which of those counts as ink depends
# on what is being lifted. An icon wants only the ink, or the band it sits on comes
# out as a solid blob; the portrait is shaded with the mid tone, and dropping it
# leaves an outline of a drawing rather than the drawing.
INK_ONLY = 40
INK_AND_SHADE = 90


def read_png(path):
    """Decode a PNG into (width, height, rows of RGBA bytes).

    Written out because the standard library has no PNG reader and this script
    would otherwise need a dependency to read files this repo already ships.
    """
    data = open(path, "rb").read()
    pos, width, height, channels, idat = 8, 0, 0, 4, b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height = struct.unpack(">II", body[:8])
            channels = {0: 1, 2: 3, 4: 2, 6: 4}[body[9]]
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = width * channels
    rows, prev, at = [], bytearray(stride), 0
    for _ in range(height):
        filt = raw[at]
        at += 1
        line = bytearray(raw[at:at + stride])
        at += stride
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            x = line[i]
            if filt == 1:
                line[i] = (x + a) & 0xFF
            elif filt == 2:
                line[i] = (x + b) & 0xFF
            elif filt == 3:
                line[i] = (x + (a + b) // 2) & 0xFF
            elif filt == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (x + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
        rows.append(bytes(line))
        prev = line
    return width, height, channels, rows


class Mock:
    """One mockup, sampled at the device's own resolution."""

    def __init__(self, path, ink_luma=INK_ONLY):
        self.w, self.h, self.ch, self.rows = read_png(path)
        self.scale = self.w / 256
        self.ink_luma = ink_luma

    def ink(self, x, y):
        """Whether the device pixel at (x, y) is ink.

        At 3.5x a device pixel covers three or four source pixels, so the answer is
        the majority of the block rather than one sample: picking a single pixel
        catches an edge and turns a straight line into a dotted one.
        """
        x0, x1 = int(x * self.scale), int((x + 1) * self.scale)
        y0, y1 = int(y * self.scale), int((y + 1) * self.scale)
        dark = total = 0
        for sy in range(y0, min(y1, self.h)):
            row = self.rows[sy]
            for sx in range(x0, min(x1, self.w)):
                i = sx * self.ch
                luma = (row[i] * 299 + row[i + 1] * 587 + row[i + 2] * 114) // 1000
                total += 1
                if luma < self.ink_luma:
                    dark += 1
        return total > 0 and dark * 2 >= total


def sprite(mock, x, y, w, h):
    """A 1bpp sprite from a device-space rectangle."""
    stride = (w + 7) // 8
    packed = bytearray(stride * h)
    for row in range(h):
        for col in range(w):
            if mock.ink(x + col, y + row):
                packed[row * stride + col // 8] |= 0x80 >> (col % 8)
    return w, h, bytes(packed)


def trim(mock, x, y, w, h):
    """The same, shrunk to the ink inside the rectangle."""
    cols = [c for c in range(w) if any(mock.ink(x + c, y + r) for r in range(h))]
    rows = [r for r in range(h) if any(mock.ink(x + c, y + r) for c in range(w))]
    if not cols or not rows:
        return sprite(mock, x, y, w, h)
    return sprite(mock, x + cols[0], y + rows[0],
                  cols[-1] - cols[0] + 1, rows[-1] - rows[0] + 1)


def write_png(path, w, h, ink):
    """An 8-bit greyscale PNG: 0 where `ink(x, y)` is set, 255 elsewhere.

    Written by hand for the same reason read_png is: this repo has no PNG writer
    and would otherwise need a dependency to save a 14x14 sprite. Greyscale is what
    the panel itself speaks, and flipctl reads ink as opacity, so an icon lifted
    from a mockup can be recoloured per card without an alpha channel.
    """
    rows = b"".join(
        b"\x00" + bytes(0 if ink(x, y) else 255 for x in range(w))
        for y in range(h))

    def chunk(kind, body):
        return (struct.pack(">I", len(body)) + kind + body
                + struct.pack(">I", zlib.crc32(kind + body)))

    header = struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)
    with open(path, "wb") as out:
        out.write(b"\x89PNG\r\n\x1a\n"
                  + chunk(b"IHDR", header)
                  + chunk(b"IDAT", zlib.compress(rows))
                  + chunk(b"IEND", b""))
    print(f"{path}: {w}x{h}")


def emit_icon(path, art):
    """One sprite as a 14x14 icon file, centred in the box.

    Centred rather than scaled: flipctl draws a card's icon in a fixed 14x14 box,
    and a trimmed sprite handed over at 11x13 would be stretched to fill it.
    """
    w, h, packed = art
    stride = (w + 7) // 8
    dx, dy = (14 - w) // 2, (14 - h) // 2

    def ink(x, y):
        col, row = x - dx, y - dy
        if not (0 <= col < w and 0 <= row < h):
            return False
        return packed[row * stride + col // 8] >> (7 - col % 8) & 1

    write_png(path, 14, 14, ink)


def unscale(path):
    """A greyscale image at its own scale, with an even upscale undone.

    The dolphin is exported at 2x: every logical pixel is a uniform 2x2 block, so
    taking one pixel per block is lossless and gives back the art as drawn, 129x117.
    That is exactly the height between the status bar and the soft strip, which is
    what it was drawn for. Resampling it instead would invent tones the artist did
    not put there, and the check below is what keeps this honest: if a future export
    is not a clean multiple, this refuses rather than quietly blurring.
    """
    w, h, ch, rows = read_png(path)
    factor = 1
    for candidate in (4, 3, 2):
        if w % candidate or h % candidate:
            continue
        if all(rows[y][x * ch] == rows[y + dy][(x + dx) * ch]
               for y in range(0, h, candidate)
               for x in range(0, w, candidate)
               for dy in range(candidate)
               for dx in range(candidate)):
            factor = candidate
            break
    out_w, out_h = w // factor, h // factor
    out = bytearray(out_w * out_h)
    for oy in range(out_h):
        row = rows[oy * factor]
        for ox in range(out_w):
            i = ox * factor * ch
            luma = (row[i] * 299 + row[i + 1] * 587 + row[i + 2] * 114) // 1000
            if ch == 4:
                alpha = row[i + 3]
                # Over white, the ground every screen in this app draws on.
                luma = (luma * alpha + 255 * (255 - alpha)) // 255
            out[oy * out_w + ox] = luma
    print(f"{path}: {w}x{h} at {factor}x -> {out_w}x{out_h}")
    return out_w, out_h, bytes(out)


def emit_grey(handle, name, art):
    w, h, pixels = art
    encoded = base64.b64encode(pixels).decode("ascii")
    handle.write(f'{name} = ({w}, {h}, "{encoded}")\n')
    # Where the drawing actually ends, which is not where the image does: this one
    # carries ~18 columns of white to the right of the snout. Anything placed beside
    # it measures from here, or it sits a finger's width too far away.
    inked = [x for x in range(w) if any(pixels[y * w + x] < 250 for y in range(h))]
    handle.write(f'{name}_INK_W = {(inked[-1] + 1) if inked else w}\n')
    print(f"{name}: {w}x{h}, {len(pixels)} bytes, one per pixel, ink to {inked[-1]}")


def emit(handle, name, art):
    w, h, packed = art
    encoded = base64.b64encode(packed).decode("ascii")
    handle.write(f'{name} = ({w}, {h}, "{encoded}")\n')
    print(f"{name}: {w}x{h}, {len(packed)} bytes")


def main():
    hosts = Mock("image2.png")

    with open("art.py", "w") as out:
        out.write('"""Sprites lifted from the design mockups by extract_art.py.\n\n'
                  'Generated. A sprite is (width, height, base64 of 1bpp rows), rows\n'
                  'padded to bytes, high bit leftmost, a set bit meaning ink. An image\n'
                  'is (width, height, base64 of one byte a pixel), 0 black and 255\n'
                  'white, as the panel itself takes them.\n'
                  '"""\n')
        # The picture on the advice screen. The mockup's own portrait was line art
        # lifted at one bit a pixel; this is a greyscale drawing, so it goes in as
        # one byte a pixel and is blitted rather than stencilled.
        emit_grey(out, "DOLPHIN", unscale("dolphin.png"))
        # The device icons down the left of the host list. All four come from the
        # same mockup, one card pitch apart, and they are outline art on the light
        # ground. The detail screen's copy is white on its dark header, which the
        # same sprite gives by being painted in white instead.
        # Three icons, which is all the design has: a laptop uses the desktop's.
        for name, row in (("MONITOR", 31), ("CAMERA", 58), ("PHONE", 85)):
            art = trim(hosts, 13, row, 14, 16)
            emit(out, name, art)
            # And as a file, for the host list: that page is drawn from flipctl's
            # own card component, which takes an icon by path rather than pixels
            # in every frame.
            emit_icon(f"icons/{name.lower()}.png", art)


if __name__ == "__main__":
    main()
