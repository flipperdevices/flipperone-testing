#!/usr/bin/env python3
"""flipctl's look, drawn by Qt as an ordinary Wayland client.

What this used to be is the interesting part. It rendered offscreen, wrote whole
frames into /dev/fb0 itself, read the buttons straight from evdev because an
offscreen Qt has no platform to read a keyboard from, and asked flipctl whether its
VT was the one being displayed before acting on a key. All of that was the price of
being handed the hardware.

Now it is a window. Qt draws it, the compositor shows it, keys arrive as key events,
and it cannot tell whether it is in front because it no longer needs to know: an app
that is not focused receives nothing. What is left is the drawing, which was always
the point.

One thing it does keep, and every app on this panel wants it: each frame is
thresholded to black and white. NoAntialias is a hint the font engine may ignore,
and here it does, so a 16 pixel glyph still comes out with forty shades of grey in
it. The panel has 64 grey levels and this design uses two.

The numbers are flipctl's, in pixels, because this draws in pixels: a 13px status
bar, 20px menu rows, a 14px soft strip of 48px buttons two apart. Where a widget
cannot express something it is drawn by hand, which is why the selector is a
paintEvent rather than a stylesheet: its corners are cut on the diagonal and no
border-radius does that.

Keys: the pad moves and adjusts, OK presses the rightmost soft key. Back and the app
switcher never arrive here at all, because the compositor keeps those two for
flipctl, which is what stops an app trapping the user inside it.
"""
import os
import sys
import time

from PyQt6.QtCore import Qt, QRect, QTimer
from PyQt6.QtGui import QColor, QFont, QFontDatabase, QImage, QPainter, QPen
from PyQt6.QtWidgets import QApplication, QWidget

# tokens.toml, in the units this draws in.
PANEL = (256, 144)
STATUS_H = 13
ROW_H = 20
SOFT_H = 14
SOFT_W = 48
SOFT_GAP = 2
MARGIN = 8
RADIUS = 3

BLACK = QColor(0, 0, 0)
WHITE = QColor(255, 255, 255)
DIVIDER = QColor(0xCC, 0xCC, 0xCC)
DIM = QColor(0x99, 0x99, 0x99)

# The device's own face, and only it: HaxrCorp 4090, which the status bar and every
# title on the panel are set in. Correct at 16px and nowhere else, because it is a
# bitmap font and any other size is an interpolation of one.
#
# Beside the app rather than reached for in the tree, so the directory is the whole
# app: copying it somewhere else takes its font with it.
SIZE = 16
FONT = "HaxrCorp4090-FlipCTL.ttf"

ROWS = [
    ("Wi-Fi", ["Off", "On"], 1),
    ("Brightness", ["25%", "50%", "75%", "100%"], 1),
    ("Sound", ["Off", "On"], 1),
    ("Haptics", ["Off", "Low", "High"], 2),
    ("Airplane mode", ["Off", "On"], 0),
]

# All five labelled, so pressing any of them does something visible. Two used to be
# blank, which made "the soft buttons do not work" indistinguishable from "these two
# buttons were never wired to anything".
BUTTONS = ["Esc", "Reset", "Info", "Edit", "Apply"]


def load_font():
    """The family name Qt gives HaxrCorp, or None if it would not load.

    From the app's own directory rather than from the system: the device installs no
    fonts, and a fallback face at 16px would be a blurry approximation of a font
    whose whole point is that it is exact. The family name is what Qt reports, not
    the file name: asking for the full name gets a substitute.
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), FONT)
    loaded = QFontDatabase.addApplicationFont(path)
    if loaded < 0:
        print(f"font not loaded: {path}", file=sys.stderr)
        return None
    found = QFontDatabase.applicationFontFamilies(loaded)
    return found[0] if found else None


class Screen(QWidget):
    def __init__(self, family):
        super().__init__()
        self.family = family
        self.selected = 0
        self.rows = [[label, values, at] for label, values, at in ROWS]
        self.pressed = None
        self.message = ""
        # Set by anything that changes what is on screen; cleared by presenting.
        self.changed = True
        self.setFixedSize(*PANEL)
        # Without this a QWidget takes no keyboard focus and every press goes
        # nowhere, which looks exactly like the compositor not delivering them.
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        # The press flash, as long as the panel's own: 30ms to show, and the action
        # lands with it.
        self.flash = QTimer(self)
        self.flash.setSingleShot(True)
        self.flash.setInterval(120)
        self.flash.timeout.connect(self.release)

    def font(self):
        font = QFont(self.family or "monospace")
        font.setPixelSize(SIZE)
        # It is a bitmap: smoothing it is what makes a pixel font look wrong.
        font.setStyleStrategy(QFont.StyleStrategy.NoAntialias)
        return font

    # ── drawing ────────────────────────────────────────────────────────────
    def paintEvent(self, _event):
        # Drawn offscreen and thresholded in one go, then blitted: one conversion
        # for the whole frame rather than hoping each glyph came out binary.
        canvas = QImage(self.width(), self.height(), QImage.Format.Format_RGB32)
        painter = QPainter(canvas)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, False)
        painter.setRenderHint(QPainter.RenderHint.TextAntialiasing, False)
        painter.fillRect(canvas.rect(), WHITE)
        self.status_bar(painter)
        self.list(painter)
        self.soft_bar(painter)
        painter.end()

        mono = canvas.convertToFormat(
            QImage.Format.Format_Mono,
            Qt.ImageConversionFlag.MonoOnly | Qt.ImageConversionFlag.ThresholdDither,
        ).convertToFormat(QImage.Format.Format_RGB32)
        out = QPainter(self)
        out.drawImage(0, 0, mono)

    # The device's buttons, as the compositor delivers them.
    #
    # The five soft keys are letters, not function keys: flipper-one-input.c sends
    # KEY_Z, KEY_X, KEY_C, KEY_V, KEY_B for esc, view, power, edit and run, and
    # KEY_A for push-to-talk. Guessing F1 to F5 is why this app looked deaf while
    # the clock, which counted any key at all, looked fine.
    #
    # Back and the app switcher never arrive: the compositor keeps those two for
    # flipctl, which is what stops an app trapping the user inside it.
    KEYS = {
        Qt.Key.Key_Up: "up",
        Qt.Key.Key_Down: "down",
        Qt.Key.Key_Left: "left",
        Qt.Key.Key_Right: "right",
        Qt.Key.Key_Return: "ok",
        Qt.Key.Key_Enter: "ok",
        Qt.Key.Key_Z: "esc",
        Qt.Key.Key_X: "view",
        Qt.Key.Key_C: "power",
        Qt.Key.Key_V: "edit",
        Qt.Key.Key_B: "run",
        Qt.Key.Key_A: "ptt",
    }

    def keyPressEvent(self, event):
        named = self.KEYS.get(Qt.Key(event.key()))
        print(f"key {event.key():#x} {event.text()!r} -> {named}", flush=True)
        if named:
            self.key(named)

    def status_bar(self, painter):
        painter.fillRect(0, 0, PANEL[0], STATUS_H, BLACK)
        painter.setFont(self.font())
        painter.setPen(QPen(WHITE))
        painter.drawText(QRect(4, 0, 200, STATUS_H),
                         Qt.AlignmentFlag.AlignVCenter, "Qt Demo")
        painter.drawText(QRect(PANEL[0] - 60, 0, 56, STATUS_H),
                         Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight,
                         "linuxfb")

    def list(self, painter):
        top = STATUS_H + 2
        for index, (label, values, at) in enumerate(self.rows):
            y = top + index * ROW_H
            chosen = index == self.selected
            value = values[at]
            painter.setFont(self.font())
            if chosen:
                self.selector(painter, y)
                painter.setPen(QPen(WHITE))
            else:
                painter.setPen(QPen(BLACK))
                # The rule under an unselected row, as the menu draws it.
                painter.fillRect(MARGIN, y + ROW_H - 1, PANEL[0] - 2 * MARGIN, 1, DIVIDER)
            painter.drawText(QRect(MARGIN + 4, y, 150, ROW_H - 1),
                             Qt.AlignmentFlag.AlignVCenter, label)
            # The value, with the chevrons only where there is somewhere to go.
            slot = value if len(values) == 1 else \
                f"{'<' if at > 0 else ' '} {value} {'>' if at < len(values) - 1 else ' '}"
            painter.drawText(QRect(PANEL[0] - MARGIN - 110, y, 106, ROW_H - 1),
                             Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight,
                             slot)

        if self.message:
            painter.setPen(QPen(DIM))
            painter.drawText(QRect(MARGIN, PANEL[1] - SOFT_H - 14, PANEL[0] - 2 * MARGIN, 12),
                             Qt.AlignmentFlag.AlignVCenter, self.message)

    def selector(self, painter, y):
        """The selected row's fill: a chamfered rectangle, cut on the diagonal.

        Drawn as rows rather than with a rounded rect, because the design's corner
        is a straight stair of three pixels and border-radius draws an arc.
        """
        x, w, h = MARGIN - 4, PANEL[0] - 2 * (MARGIN - 4), ROW_H - 2
        for row in range(h):
            inset = 0
            if row < RADIUS:
                inset = RADIUS - 1 - row
            elif row >= h - RADIUS:
                inset = row - (h - RADIUS)
            painter.fillRect(x + inset, y + row, w - 2 * inset, 1, BLACK)

    def soft_bar(self, painter):
        y = PANEL[1] - SOFT_H
        painter.setFont(self.font())
        for slot, label in enumerate(BUTTONS):
            if not label:
                continue
            x = self.slot_x(slot)
            down = self.pressed == slot
            painter.fillRect(x, y, SOFT_W, SOFT_H, BLACK if down else WHITE)
            painter.setPen(QPen(BLACK))
            painter.drawRect(x, y, SOFT_W - 1, SOFT_H - 1)
            painter.setPen(QPen(WHITE if down else BLACK))
            painter.drawText(QRect(x, y, SOFT_W, SOFT_H),
                             Qt.AlignmentFlag.AlignCenter, label)

    @staticmethod
    def slot_x(slot):
        """Slot 0 flush left, 4 flush right, the middle three spread between."""
        if slot == 0:
            return 0
        if slot == 4:
            return PANEL[0] - SOFT_W
        spare = PANEL[0] - 2 * (SOFT_W + SOFT_GAP)
        return SOFT_W + SOFT_GAP + (spare - 3 * SOFT_W) // 4 * slot + (slot - 1) * SOFT_W

    # ── keys ───────────────────────────────────────────────────────────────
    def key(self, name):
        row = self.rows[self.selected]
        if name == "down":
            self.selected = (self.selected + 1) % len(self.rows)
        elif name == "up":
            self.selected = (self.selected - 1) % len(self.rows)
        elif name == "right":
            row[2] = min(row[2] + 1, len(row[1]) - 1)
        elif name == "left":
            row[2] = max(row[2] - 1, 0)
        elif name in ("ok", "run"):
            self.press(4)
        elif name in ("esc", "view", "power", "edit"):
            self.press(("esc", "view", "power", "edit").index(name))
        else:
            return
        self.changed = True
        self.update()

    def press(self, slot):
        self.pressed = slot
        label = BUTTONS[slot]
        if label == "Apply":
            self.message = ", ".join(f"{r[0]}={r[1][r[2]]}" for r in self.rows[:2])
        elif label == "Reset":
            for r in self.rows:
                r[2] = 0
            self.message = "reset"
        else:
            # Every other button still says which one it was: a soft key that
            # flashes and reports itself is the difference between "does nothing"
            # and "does nothing yet".
            self.message = label.lower()
        self.flash.start()
        self.changed = True
        self.update()

    def release(self):
        self.pressed = None
        self.changed = True
        # Without this the flash stays lit until the next second's repaint, which
        # reads as a button that sticks.
        self.update()


def main():
    app = QApplication(sys.argv)
    screen = Screen(load_font())
    # A repaint when something changed, and once a second regardless so the clock in
    # the status bar moves. Presenting frames by hand is gone with the framebuffer.
    def tick():
        screen.update()

    timer = QTimer()
    timer.timeout.connect(tick)
    timer.start(1000)
    screen.showFullScreen()
    screen.setFocus()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
