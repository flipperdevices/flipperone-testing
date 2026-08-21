#!/usr/bin/env python3
"""A clock and a load meter, drawn by Qt into the panel's framebuffer.

The other Qt app is a menu: static, and presented only when a key changes
something. This one moves, which is the point of it. Switch away with Tab and back
again and the second hand has gone on sweeping, because a backgrounded console app
is not frozen: its VT simply is not being drawn.

Same arrangement as its sibling, rendered offscreen and written to /dev/fb0 one
whole frame at a time so a flush cannot catch a half-drawn screen, with the buttons
read straight from evdev because an offscreen Qt has no platform to read them from.
"""
import glob
import math
import os
import struct
import sys
import time

from PyQt6.QtCore import QRect, Qt, QSocketNotifier, QTimer
from PyQt6.QtGui import QColor, QFont, QFontDatabase, QImage, QPainter, QPen
from PyQt6.QtWidgets import QApplication, QWidget

PANEL = (256, 144)
STATUS_H = 13
SOFT_H = 14
SIZE = 16
FONT = "HaxrCorp4090-FlipCTL.ttf"

BLACK = QColor(0, 0, 0)
WHITE = QColor(255, 255, 255)
DIM = QColor(0x99, 0x99, 0x99)
PILL = QColor(0xCC, 0xCC, 0xCC)

# The dial: centred in the space between the bars, as large as fits.
FACE_R = 52
FACE = (60, STATUS_H + (PANEL[1] - STATUS_H - SOFT_H) // 2)


class Panel:
    """The framebuffer, written one whole frame at a time."""

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
        if image.format() != QImage.Format.Format_RGB32:
            image = image.convertToFormat(QImage.Format.Format_RGB32)
        rows = bytearray(self.stride * self.height)
        span = min(self.stride, image.bytesPerLine())
        for y in range(min(self.height, image.height())):
            start = y * self.stride
            rows[start:start + span] = image.constScanLine(y).asstring(span)
        os.lseek(self.fd, 0, os.SEEK_SET)
        os.write(self.fd, bytes(rows))
        # fbdev has collected the written pages and is waiting on a timer; this is
        # what sends them now, and what makes the frame land in one piece.
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
    """The pad, read from evdev, where flipctl's forwarded presses arrive too."""

    EVENT = struct.Struct("qqHHi")
    EV_KEY = 0x01
    KEYS = {103: "up", 108: "down", 105: "left", 106: "right", 28: "ok"}

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
            if kind == self.EV_KEY and value in (1, 2) and code in self.KEYS:
                self.on_key(self.KEYS[code])


def load_font():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), FONT)
    loaded = QFontDatabase.addApplicationFont(path)
    if loaded < 0:
        print(f"font not loaded: {path}", file=sys.stderr)
        return None
    families = QFontDatabase.applicationFontFamilies(loaded)
    return families[0] if families else None


def load():
    """The one-minute load average, and memory used as a fraction.

    Straight from /proc, as everything on this device reads it: no dependency, and
    the numbers are the same ones the Resources app shows.
    """
    with open("/proc/loadavg") as handle:
        one = float(handle.read().split()[0])
    total = available = 0
    with open("/proc/meminfo") as handle:
        for line in handle:
            if line.startswith("MemTotal:"):
                total = int(line.split()[1])
            elif line.startswith("MemAvailable:"):
                available = int(line.split()[1])
    used = (total - available) / total if total else 0.0
    return one, used


class Screen(QWidget):
    def __init__(self, family, panel=None):
        super().__init__()
        # Asked whether this program is the one being displayed.
        self.panel = panel
        self.family = family
        # The dial can show seconds sweeping or stepping, which is the one thing
        # the pad changes: a sweep says the app is alive at a glance.
        self.sweep = True
        self.setFixedSize(*PANEL)

    def font(self, size=SIZE):
        font = QFont(self.family or "monospace")
        font.setPixelSize(size)
        font.setStyleStrategy(QFont.StyleStrategy.NoAntialias)
        return font

    def key(self, name):
        # Keys arrive whether or not this program is on screen: it reads the input
        # devices itself, and the kernel hands every event to every reader. Acting on
        # them while hidden means the pad used to choose an app in the switcher also
        # drives whatever is behind it.
        if self.panel is not None and not self.panel.visible():
            return
        if name in ("left", "right", "ok"):
            self.sweep = not self.sweep

    def paintEvent(self, _event):
        painter = QPainter(self)
        painter.fillRect(self.rect(), WHITE)
        self.status_bar(painter)
        self.dial(painter)
        self.readouts(painter)

    def status_bar(self, painter):
        painter.fillRect(0, 0, PANEL[0], STATUS_H, BLACK)
        painter.setFont(self.font())
        painter.setPen(QPen(WHITE))
        painter.drawText(QRect(4, 0, 160, STATUS_H),
                         Qt.AlignmentFlag.AlignVCenter, "Qt Clock")
        painter.drawText(QRect(PANEL[0] - 80, 0, 76, STATUS_H),
                         Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignRight,
                         "sweep" if self.sweep else "step")

    def dial(self, painter):
        """A face with three hands, drawn as lines: no arcs, no antialiasing."""
        cx, cy = FACE
        painter.setPen(QPen(PILL))
        for tick in range(12):
            angle = math.radians(tick * 30 - 90)
            outer, inner = FACE_R // 2, FACE_R // 2 - (5 if tick % 3 == 0 else 3)
            painter.drawLine(int(cx + math.cos(angle) * inner),
                             int(cy + math.sin(angle) * inner),
                             int(cx + math.cos(angle) * outer),
                             int(cy + math.sin(angle) * outer))

        now = time.localtime()
        fraction = time.time() % 1.0 if self.sweep else 0.0
        seconds = now.tm_sec + fraction
        hands = (
            # angle, length, colour
            ((now.tm_hour % 12 + now.tm_min / 60) * 30 - 90, FACE_R // 3, BLACK),
            ((now.tm_min + seconds / 60) * 6 - 90, FACE_R // 2 - 6, BLACK),
            (seconds * 6 - 90, FACE_R // 2 - 4, DIM),
        )
        for degrees, length, colour in hands:
            angle = math.radians(degrees)
            painter.setPen(QPen(colour))
            painter.drawLine(cx, cy,
                             int(cx + math.cos(angle) * length),
                             int(cy + math.sin(angle) * length))

    def readouts(self, painter):
        """The time in words, and two bars: load and memory."""
        x = FACE[0] + FACE_R // 2 + 12
        painter.setFont(self.font())
        painter.setPen(QPen(BLACK))
        painter.drawText(QRect(x, STATUS_H + 6, PANEL[0] - x - 4, 14),
                         Qt.AlignmentFlag.AlignVCenter, time.strftime("%H:%M:%S"))
        painter.setPen(QPen(DIM))
        painter.drawText(QRect(x, STATUS_H + 20, PANEL[0] - x - 4, 12),
                         Qt.AlignmentFlag.AlignVCenter, time.strftime("%a %d %b"))

        one, used = load()
        # The same gauge shape the panel's own screens draw: a 1px frame with the
        # fill one pixel inside it.
        for i, (label, fraction) in enumerate((("Load", min(one / 4, 1.0)),
                                               ("Mem", used))):
            y = STATUS_H + 44 + i * 22
            painter.setPen(QPen(BLACK))
            painter.drawText(QRect(x, y, 40, 12), Qt.AlignmentFlag.AlignVCenter, label)
            bar = QRect(x + 34, y + 2, PANEL[0] - x - 38, 9)
            painter.drawRect(bar)
            painter.fillRect(bar.x() + 1, bar.y() + 1,
                             max(0, int((bar.width() - 2) * fraction)), 7, BLACK)

    def present(self, panel):
        image = QImage(*PANEL, QImage.Format.Format_RGB32)
        self.render(image)
        panel.present(image)


def main():
    app = QApplication(sys.argv)
    panel = Panel()
    screen = Screen(load_font(), panel)
    # Held, or the notifiers watching the input devices are collected with it.
    buttons = Buttons(screen.key)

    # Four times a second: enough for a sweeping hand to look like one, and little
    # enough that the SPI bus is idle most of the time. Every frame is presented
    # whether or not anything changed, which is also what puts the app back on the
    # panel after flipctl has drawn its own screen there.
    timer = QTimer()
    timer.timeout.connect(lambda: screen.present(panel))
    timer.start(250)
    status = app.exec()
    del buttons
    return status


if __name__ == "__main__":
    sys.exit(main())
