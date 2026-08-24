#!/usr/bin/env python3
"""A clock, drawn by Qt as an ordinary Wayland client.

What this app used to be is worth knowing, because the difference is the point of
the change: it rendered offscreen, wrote whole frames into /dev/fb0 itself, read
the pad straight from evdev, and asked flipctl whether its VT was the one on the
panel before drawing anything. All of that was the price of being handed the
hardware.

Now it is a window. Qt draws it, the compositor shows it, keys arrive as key
events, and the app has no idea whether it is in front. Nothing here touches a
device, and there is nothing to check.
"""

import sys
from datetime import datetime

from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QColor, QFont, QFontDatabase, QImage, QPainter, QPen
from PyQt6.QtWidgets import QApplication, QWidget

PANEL_W, PANEL_H = 256, 144
FONT_FILE = "HaxrCorp4090-FlipCTL.ttf"
# The font is a pixel font: binary at 16 pixels and mush at any other size. So the
# size is in pixels, never points, and it is always 16. A bigger clock comes from
# scaling whole pixels afterwards, not from asking for a bigger font.
CELL = 16


def pixel_font(family, size=CELL):
    font = QFont(family)
    font.setPixelSize(size)
    # Antialiasing is what makes a pixel font look blurred on a panel with 64 grey
    # levels and no subpixels to hide it in: every glyph edge becomes a grey ramp.
    font.setStyleStrategy(QFont.StyleStrategy.NoAntialias)
    font.setHintingPreference(QFont.HintingPreference.PreferFullHinting)
    return font


def crisp(painter):
    """Turn off every kind of smoothing Qt does by default."""
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
    painter.setRenderHint(QPainter.RenderHint.TextAntialiasing, False)
    painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, False)


def binary(image):
    """Force an image to black and white.

    NoAntialias is a hint the font engine is free to ignore, and on this device it
    does: a 16 pixel glyph still came out with forty shades of grey in it, and
    scaling by whole pixels then preserved every one of them faithfully. Thresholding
    the finished frame does not depend on being obeyed. It is also the right model
    for this panel, which is a grey ramp the UI never uses: everything flipctl draws
    is ink or paper.
    """
    mono = image.convertToFormat(
        QImage.Format.Format_Mono,
        Qt.ImageConversionFlag.MonoOnly | Qt.ImageConversionFlag.ThresholdDither,
    )
    return mono.convertToFormat(QImage.Format.Format_RGB32)


class Clock(QWidget):
    def __init__(self, family):
        super().__init__()
        self.family = family
        self.presses = 0
        self.setWindowTitle("Qt Clock")
        tick = QTimer(self)
        tick.timeout.connect(self.update)
        tick.start(200)

    def big(self, text, scale=3):
        """Text at 16 pixels, then scaled by whole pixels.

        Asking for a 48 pixel font and letting the rasteriser interpolate is what
        makes a pixel font look like a photograph of a pixel font. Rendering at its
        own size and tripling each pixel keeps every edge where the designer put it.
        """
        font = pixel_font(self.family)
        probe = QImage(1, 1, QImage.Format.Format_RGB32)
        measure = QPainter(probe)
        measure.setFont(font)
        width = measure.fontMetrics().horizontalAdvance(text)
        height = measure.fontMetrics().height()
        measure.end()

        small = QImage(max(1, width), max(1, height), QImage.Format.Format_RGB32)
        small.fill(QColor(255, 255, 255))
        into = QPainter(small)
        crisp(into)
        into.setFont(font)
        into.setPen(QColor(0, 0, 0))
        into.drawText(0, into.fontMetrics().ascent(), text)
        into.end()
        return binary(small).scaled(
            small.width() * scale,
            small.height() * scale,
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.FastTransformation,
        )

    def paintEvent(self, _event):
        # Draw the whole frame offscreen, threshold it, then blit: one conversion for
        # everything, rather than hoping each glyph came out binary.
        canvas = QImage(self.width(), self.height(), QImage.Format.Format_RGB32)
        p = QPainter(canvas)
        crisp(p)
        p.fillRect(canvas.rect(), QColor(255, 255, 255))
        p.setPen(QPen(QColor(0, 0, 0), 1))
        p.drawRect(0, 0, self.width() - 1, self.height() - 1)

        now = datetime.now()
        clock = self.big(now.strftime("%H:%M:%S"), scale=3)
        p.drawImage(
            (self.width() - clock.width()) // 2,
            (self.height() - clock.height()) // 2 - 12,
            clock,
        )

        p.setFont(pixel_font(self.family))
        p.setPen(QColor(0, 0, 0))
        p.drawText(
            canvas.rect().adjusted(0, 46, 0, 46),
            Qt.AlignmentFlag.AlignCenter,
            now.strftime("%a %d %b"),
        )

        # A press counter, so it is obvious at a glance whether keys arrive.
        p.drawText(6, self.height() - 8, f"keys {self.presses}")

        # A second hand as a bar, because a 256x144 panel has no room for a dial.
        span = int(self.width() * (now.second % 60) / 60)
        p.fillRect(0, self.height() - 4, span, 4, QColor(0, 0, 0))
        p.end()

        out = QPainter(self)
        crisp(out)
        out.drawImage(0, 0, binary(canvas))

    def keyPressEvent(self, event):
        self.presses += 1
        print(f"key {event.key():#x} -> {self.presses}", flush=True)
        self.update()


def main():
    app = QApplication(sys.argv)
    family = "monospace"
    loaded = QFontDatabase.addApplicationFont(FONT_FILE)
    if loaded != -1:
        families = QFontDatabase.applicationFontFamilies(loaded)
        if families:
            family = families[0]
    window = Clock(family)
    window.resize(PANEL_W, PANEL_H)
    window.showFullScreen()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
