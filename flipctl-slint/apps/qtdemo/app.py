#!/usr/bin/env python3
"""flipctl's screen, in Qt widgets, on the panel's framebuffer.

Qt rasterises in software and this writes the result to /dev/fb0, so it needs no
compositor and never opens the GPU. What it demonstrates is that a real toolkit can
draw the device's own design: the same fonts, the same status bar, the same selector
and the same five soft keys.

Rendered offscreen and presented by hand, one whole frame at a time, rather than
through Qt's linuxfb platform. linuxfb paints directly into the framebuffer while
fbdev flushes whatever it finds there on a 50ms timer, so a flush landing mid-paint
puts half of one frame and half of the next on the panel. A single write of the
finished image cannot be caught halfway, and an fsync pushes it out at once instead
of waiting for the timer.

Which also means input is this program's own business, since an offscreen Qt has no
platform to read a keyboard from: it reads the buttons from evdev, where flipctl's
forwarded presses arrive too.

The numbers are flipctl's, in pixels, because this draws in pixels: a 13px status
bar, 20px menu rows, a 14px soft strip of 48px buttons two apart. Where a widget
cannot express something it is drawn by hand instead, which is why the selector is
a paintEvent rather than a stylesheet: its corners are cut on the diagonal and no
border-radius does that.

Keys: the pad moves and adjusts, OK presses the rightmost soft key. Esc leaves, and
this never sees it: flipctl takes the panel back and ends the program.
"""
import glob
import os
import struct
import sys
import time

from PyQt6.QtCore import Qt, QRect, QSocketNotifier, QTimer
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

BUTTONS = ["Close", "Reset", "", "", "Apply"]


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


class Panel:
    """The framebuffer, written one whole frame at a time.

    XRGB8888 with a stride of its own, both read from sysfs rather than by ioctl,
    because those two structs are forty fields between them and this needs a size
    and a stride. The fsync is what makes the frame appear now: fbdev has collected
    the written pages and is waiting on a timer, and its fsync flushes them.
    """

    def __init__(self, index=0):
        base = f"/sys/class/graphics/fb{index}"
        with open(f"{base}/virtual_size") as handle:
            self.width, self.height = (int(v) for v in handle.read().strip().split(","))
        with open(f"{base}/stride") as handle:
            self.stride = int(handle.read().strip())
        self.fd = os.open(f"/dev/fb{index}", os.O_RDWR)
        # Which VT this program is on, for the visibility check below. stdin is the
        # tty flipctl gave it.
        try:
            self.tty = os.path.basename(os.ttyname(0))
        except OSError:
            self.tty = ""


    def present(self, image):
        if not self.visible():
            return
        """One QImage, converted and written in a single pass."""
        if image.format() != QImage.Format.Format_RGB32:
            image = image.convertToFormat(QImage.Format.Format_RGB32)
        rows = bytearray(self.stride * self.height)
        bytes_per_row = min(self.stride, image.bytesPerLine())
        for y in range(min(self.height, image.height())):
            start = y * self.stride
            line = image.constScanLine(y).asstring(bytes_per_row)
            rows[start:start + bytes_per_row] = line
        os.lseek(self.fd, 0, os.SEEK_SET)
        os.write(self.fd, bytes(rows))
        os.fsync(self.fd)

    def visible(self):
        """Whether this program's VT is the one being displayed.

        There is one framebuffer for the device, not one per VT, so a program that
        keeps writing while another is in front draws into the app on screen: two of
        these flicker through each other. Nothing outside the program can prevent
        that, since it opens the framebuffer itself, so the check belongs here.

        It costs one small read of sysfs per frame, and it leaves the program
        running: a clock backgrounded this way is still right when it comes back.
        """
        try:
            with open("/sys/class/tty/tty0/active") as handle:
                return handle.read().strip() == self.tty
        except OSError:
            # No way to tell: draw, because not drawing at all is worse.
            return True


class Buttons:
    """The device's buttons, read straight from evdev.

    An offscreen Qt has no platform plugin to read a keyboard, so this does it: the
    physical buttons and flipctl's forwarded ones arrive on the same devices, since
    a forwarded press is put back into the input core and is indistinguishable from
    a real one by the time it gets here.
    """

    # linux/input-event-codes.h, and struct input_event: two words of timestamp,
    # then type, code and value.
    EVENT = struct.Struct("qqHHi")
    EV_KEY = 0x01
    KEYS = {
        103: Qt.Key.Key_Up,
        108: Qt.Key.Key_Down,
        105: Qt.Key.Key_Left,
        106: Qt.Key.Key_Right,
        28: Qt.Key.Key_Return,
    }

    def __init__(self, on_key):
        self.on_key = on_key
        self.notifiers = []
        for path in sorted(glob.glob("/dev/input/event*")):
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except OSError:
                continue
            notifier = QSocketNotifier(fd, QSocketNotifier.Type.Read)
            notifier.activated.connect(lambda _, fd=fd: self.read(fd))
            self.notifiers.append(notifier)

    def read(self, fd):
        try:
            data = os.read(fd, self.EVENT.size * 32)
        except OSError:
            return
        for at in range(0, len(data) - self.EVENT.size + 1, self.EVENT.size):
            _, _, kind, code, value = self.EVENT.unpack_from(data, at)
            # 1 is a press and 2 is auto-repeat, which a menu wants to act on too.
            if kind == self.EV_KEY and value in (1, 2) and code in self.KEYS:
                self.on_key(self.KEYS[code])


class Screen(QWidget):
    def __init__(self, family, panel=None):
        super().__init__()
        # Asked whether this program is the one being displayed.
        self.panel = panel
        self.family = family
        self.selected = 0
        self.rows = [[label, values, at] for label, values, at in ROWS]
        self.pressed = None
        self.message = ""
        # Set by anything that changes what is on screen; cleared by presenting.
        self.changed = True
        self.setFixedSize(*PANEL)
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
        painter = QPainter(self)
        painter.fillRect(self.rect(), WHITE)
        self.status_bar(painter)
        self.list(painter)
        self.soft_bar(painter)

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
    def present(self, panel):
        """Render into an image and put it on the panel."""
        image = QImage(*PANEL, QImage.Format.Format_RGB32)
        self.render(image)
        panel.present(image)

    def key(self, key):
        # Keys arrive whether or not this program is on screen: it reads the input
        # devices itself, and the kernel hands every event to every reader. Acting on
        # them while hidden means the pad used to choose an app in the switcher also
        # drives whatever is behind it.
        if self.panel is not None and not self.panel.visible():
            return
        row = self.rows[self.selected]
        if key == Qt.Key.Key_Down:
            self.selected = (self.selected + 1) % len(self.rows)
        elif key == Qt.Key.Key_Up:
            self.selected = (self.selected - 1) % len(self.rows)
        elif key == Qt.Key.Key_Right:
            row[2] = min(row[2] + 1, len(row[1]) - 1)
        elif key == Qt.Key.Key_Left:
            row[2] = max(row[2] - 1, 0)
        elif key in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            self.press(4)
        else:
            return
        self.changed = True

    def press(self, slot):
        self.pressed = slot
        label = BUTTONS[slot]
        if label == "Apply":
            self.message = ", ".join(f"{r[0]}={r[1][r[2]]}" for r in self.rows[:2])
        elif label == "Reset":
            for r in self.rows:
                r[2] = 0
            self.message = "reset"
        self.flash.start()
        self.changed = True

    def release(self):
        self.pressed = None
        self.changed = True


def main():
    app = QApplication(sys.argv)
    panel = Panel()
    screen = Screen(load_font(), panel)
    # Held in a variable, and not because it is used again: the notifiers watching
    # the input devices belong to it, and a temporary is collected the moment it is
    # built, taking them with it. Which looks exactly like the buttons not working.
    buttons = Buttons(screen.key)

    # Presented when something changed, which for this app is a key or the press
    # flash expiring, and otherwise once a second. A menu that redraws thirty times
    # a second to show the same thing would keep the SPI bus busy for nothing; but
    # the framebuffer is not ours alone, and flipctl draws its own screen there
    # whenever this app is put away, so a frame every second is what puts the app
    # back on the panel when it comes forward again without waiting for a keypress.
    last = [0.0]

    def tick():
        now = time.monotonic()
        if screen.changed or now - last[0] >= 1.0:
            screen.changed = False
            last[0] = now
            screen.present(panel)

    timer = QTimer()
    timer.timeout.connect(tick)
    timer.start(33)
    status = app.exec()
    del buttons
    return status


if __name__ == "__main__":
    sys.exit(main())
