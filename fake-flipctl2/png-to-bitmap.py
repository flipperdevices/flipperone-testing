#!/usr/bin/env python3
"""
PNG to 6-bit Grayscale Bitmap Converter
Preserves 64 levels of gray (6 bits per pixel)
"""

import sys
from pathlib import Path
from PIL import Image

def png_to_bitmap(png_path, var_name=None):
    """
    Convert PNG to 6-bit grayscale bitmap (64 gray levels)

    Algorithm:
    1. Load PNG as RGBA
    2. For each pixel: blend with white background (considering alpha)
    3. Convert brightness (0-255) to 6-bit value (0-63)
    4. Pack 4 pixels (24 bits) into 3 bytes
    """

    path = Path(png_path)
    if not path.exists():
        print(f"Error: File not found: {png_path}", file=sys.stderr)
        sys.exit(1)

    # Load as RGBA
    img = Image.open(png_path).convert('RGBA')
    width, height = img.size
    pixels = img.load()

    if var_name is None:
        var_name = path.stem

    # Calculate brightness map (blend with white background)
    brightness_map = []

    for y in range(height):
        row = []
        for x in range(width):
            r, g, b, a = pixels[x, y]

            # Blend with white background
            alpha_norm = a / 255.0
            final_r = int(r * alpha_norm + 255 * (1 - alpha_norm))
            final_g = int(g * alpha_norm + 255 * (1 - alpha_norm))
            final_b = int(b * alpha_norm + 255 * (1 - alpha_norm))

            # Luminance (0-255)
            brightness = (final_r + final_g + final_b) // 3
            # Convert to 6-bit (0-63)
            value_6bit = brightness >> 2  # Divide by 4
            row.append(value_6bit)

        brightness_map.append(row)

    # Pack 4 pixels (24 bits) into 3 bytes
    hex_data = []

    for y in range(height):
        for x in range(0, width, 4):
            # Get up to 4 pixels
            pixels_chunk = []
            for i in range(4):
                if x + i < width:
                    pixels_chunk.append(brightness_map[y][x + i])
                else:
                    pixels_chunk.append(0)  # Pad with black

            # Pack into 3 bytes (6 bits each)
            # Byte 0: pixel0[5:0] | pixel1[5:4]
            # Byte 1: pixel1[3:0] | pixel2[5:2]
            # Byte 2: pixel2[1:0] | pixel3[5:0]

            byte0 = (pixels_chunk[0] << 2) | (pixels_chunk[1] >> 4)
            byte1 = ((pixels_chunk[1] & 0x0F) << 4) | (pixels_chunk[2] >> 2)
            byte2 = ((pixels_chunk[2] & 0x03) << 6) | pixels_chunk[3]

            hex_data.append(byte0 & 0xFF)
            hex_data.append(byte1 & 0xFF)
            hex_data.append(byte2 & 0xFF)

    # Output JavaScript code
    print(f"var {var_name} = (function() {{")
    print(f"    var sprite = {{")
    print(f"        w: {width},")
    print(f"        h: {height},")
    print(f"        bitsPerPixel: 6,")
    print(f"        grayscale: true,")
    print(f"        d: [")

    bytes_per_row_packed = ((width * 6) + 7) // 8

    for i, byte_val in enumerate(hex_data):
        hex_str = f"0x{byte_val:02x}"

        if i < len(hex_data) - 1:
            hex_str += ","
        else:
            hex_str += " "

        # Line break every bytes_per_row_packed
        if (i + 1) % bytes_per_row_packed == 0:
            row_num = (i + 1) // bytes_per_row_packed - 1
            print(f"            {hex_str}  // row {row_num}")
        else:
            print(f"            {hex_str}", end="")

    print()
    print("        ]")
    print("    };")
    print(f"    return {{ sprite: sprite }};")
    print("})();")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 png_to_bitmap.py image.png [var_name]", file=sys.stderr)
        sys.exit(1)

    png_path = sys.argv[1]
    var_name = sys.argv[2] if len(sys.argv) > 2 else None
    png_to_bitmap(png_path, var_name)
