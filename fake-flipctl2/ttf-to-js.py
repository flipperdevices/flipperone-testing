"""Convert a 9px TTF to the glyph format used by haxrcorp16.js.

Output format matches HaxrcorpFont16:
- `glyphs[code] = { r: [row0, row1, ..., row_N-1], a: advance }`
- Each row is one byte; bit7 = leftmost pixel.
- All glyphs share the same row count (padded with zeros).

Writes a self-contained JS file exposing `BusyFont9` with draw/textWidth,
mirroring the HaxrcorpFont16 surface.
"""
from PIL import Image, ImageDraw, ImageFont

TTF_PATH = "/Users/vladpetrenko/Downloads/busy-regular_9px.ttf"
OUT_PATH = "/Users/vladpetrenko/flipper/flipperone-testing/fake-flipctl2/js/busy9.js"
# Rasterization size chosen so capital R renders 9px tall (per spec).
SIZE = 15
ROWS = 14   # fits ascenders + descenders with 1px padding top & bottom
COLS = 16   # two-byte rows; handles glyphs up to 16px wide

font = ImageFont.truetype(TTF_PATH, SIZE)
ascent, descent = font.getmetrics()  # e.g. (11, 2)

# Render each glyph into a wide canvas, threshold, crop horizontally.
# Text is drawn so its box sits 1px down from the top of the output
# frame, keeping 1 row of padding above cap-height and 1 row below
# descenders.
CANVAS_W = 40
CANVAS_H = ROWS + 4
TEXT_Y = 1

glyphs = {}

for code in range(32, 127):
    ch = chr(code)
    img = Image.new("L", (CANVAS_W, CANVAS_H), 0)
    d = ImageDraw.Draw(img)
    d.text((1, TEXT_Y), ch, fill=255, font=font)

    pixels = img.load()
    bits = [[1 if pixels[x, y] >= 128 else 0 for x in range(CANVAS_W)] for y in range(CANVAS_H)]

    # Horizontal extent (for cropping the leftmost whitespace column).
    col_has = [any(bits[y][x] for y in range(CANVAS_H)) for x in range(CANVAS_W)]
    if any(col_has):
        left = col_has.index(True)
    else:
        left = 1

    # Advance width from font metrics.
    try:
        adv = int(round(font.getlength(ch)))
    except Exception:
        adv = 2
    if adv <= 0:
        adv = 3

    # Pack ROWS rows × COLS columns. Each row encoded as a single integer
    # with bit (COLS-1) = leftmost pixel (MSB-first packing).
    rows_out = []
    for r in range(ROWS):
        row_val = 0
        for c in range(COLS):
            x = left + c
            if 0 <= x < CANVAS_W and 0 <= r < CANVAS_H and bits[r][x]:
                row_val |= (1 << (COLS - 1 - c))
        rows_out.append(row_val)

    if code == 32:
        rows_out = [0] * ROWS

    glyphs[code] = {"r": rows_out, "a": adv}

# Emit JS file mirroring haxrcorp16.js shape.
def row_list(rs):
    return "[" + ", ".join(str(b) for b in rs) + "]"

lines = []
lines.append("// Busy Regular 9px-cap bitmap font — converted from TTF")
lines.append(f"// {ROWS} rows × {COLS} bits (MSB=left), variable advance width")
lines.append("var BusyFont9 = (function() {")
lines.append(f"    var COLS = {COLS};")
lines.append(f"    var ROWS = {ROWS};")
lines.append("    var glyphs = {")
for code in sorted(glyphs):
    g = glyphs[code]
    lines.append(f"        {code}: {{r:{row_list(g['r'])}, a:{g['a']}}},")
lines.append("    };")
lines.append("")
lines.append("    function draw(ctx, text, x, y, color, scale) {")
lines.append("        var s = scale || 1;")
lines.append("        ctx.fillStyle = color || '#000';")
lines.append("        var cx = x;")
lines.append("        for (var i = 0; i < text.length; i++) {")
lines.append("            var code = text.charCodeAt(i);")
lines.append("            var g = glyphs[code] || glyphs[63];")
lines.append("            for (var row = 0; row < ROWS; row++) {")
lines.append("                var bits = g.r[row];")
lines.append("                for (var col = 0; col < COLS; col++) {")
lines.append("                    if (bits & (1 << (COLS - 1 - col))) {")
lines.append("                        ctx.fillRect(cx + col * s, y + row * s, s, s);")
lines.append("                    }")
lines.append("                }")
lines.append("            }")
lines.append("            cx += g.a * s;")
lines.append("        }")
lines.append("    }")
lines.append("")
lines.append("    function textWidth(text, scale) {")
lines.append("        var s = scale || 1, w = 0;")
lines.append("        for (var i = 0; i < text.length; i++) {")
lines.append("            var g = glyphs[text.charCodeAt(i)] || glyphs[63];")
lines.append("            w += g.a * s;")
lines.append("        }")
lines.append("        return w - s;")
lines.append("    }")
lines.append("")
lines.append("    return { draw: draw, textWidth: textWidth };")
lines.append("})();")
lines.append("")

with open(OUT_PATH, "w") as f:
    f.write("\n".join(lines))

# Quick self-check — render "Settings" as ASCII art.
print(f"wrote {OUT_PATH}")
print("Sample render of 'Settings':")
sample = Image.new("L", (CANVAS_W * 3, ROWS), 0)
dd = ImageDraw.Draw(sample)
cx = 1
for ch in "Settings":
    dd.text((cx, TEXT_Y), ch, fill=255, font=font)
    cx += int(round(font.getlength(ch)))
grid = sample.load()
for y in range(ROWS):
    row = ""
    for x in range(cx + 2):
        row += "#" if grid[x, y] >= 128 else "."
    print(row)
