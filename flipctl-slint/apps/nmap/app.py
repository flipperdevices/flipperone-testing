#!/usr/bin/env python3
"""nmap, as a flipctl app, drawn to the design in this directory.

Four screens, from image1 to image4: the scan form, the live host list, one host's
detail, and the advice popup with its portrait. None of them is a list of rows this
system already draws, so the app paints: it keeps a panel-sized buffer, draws into
it, and sends the bytes. flipctl blits them, draws its own status bar on top
because an app has no idea what the battery is doing, and draws the text, because
an app has no font and so cannot measure a string, let alone centre one.

    app -> flipctl   {"screen": {"type": "canvas", "status": true,
                                 "data": "<base64>", "text": [...],
                                 "buttons": [...]}}
    flipctl -> app   {"key": "down", "down": true}

The artwork comes out of the mockups themselves, via extract_art.py, so it cannot
drift from the design by being redrawn.

nmap is the real thing: `nmap -oX -` writes each host as it finishes, so the list
fills in while the scan runs rather than appearing at the end.
"""
import base64
import json
import os
import re
import selectors
import socket
import subprocess
import sys
import time

import art

APP_NAME = "nmap"
APP_APT = ["nmap"]

W, H = 256, 144
WHITE, BLACK = 0xFF, 0x00
# The filled bands (the title, the port rows) take flipctl's header tone: the value
# its boot-menu header uses and the one every flipctl2 app's title band is drawn in.
# Hardcoded because a canvas app is handed pixels and no palette. A band this light
# carries ink text, not white, and the dim tone a dim gauge uses is deliberately not
# it: 153 is right for a hairline beside a label and reads as a dark slab across the
# whole page.
GREY = 0xD9

# flipctl draws the status bar over the top of the picture, so the app owns
# everything below it.
TOP = 13
# The app title band: an icon and the app's name flush under the status bar, the
# shared idiom every flipctl2 app draws. 16 rows, as they all use.
TITLE_H = 16
# The soft buttons live in the bottom 14 rows, drawn by flipctl.
BOTTOM = H - 14

def local_range():
    """This machine's own /24, as an nmap range.

    The mockup's target is 192.168.0.0-255, which is a fine thing to draw and a
    poor thing to scan: on any other network it finds nothing, which looks exactly
    like a broken app. Asking the kernel which address it would use to reach the
    world gives the network the device is actually on.
    """
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Nothing is sent: a connect on a UDP socket only picks the route.
        probe.connect(("8.8.8.8", 53))
        address = probe.getsockname()[0]
    except OSError:
        return "192.168.0.0-255"
    finally:
        probe.close()
    parts = address.split(".")
    return ".".join(parts[:3]) + ".0-255"


HERE = local_range()

# The form's rows, from image1: a label on the left and a value on the right, with
# a divider before the last two.
FIELDS = [
    {"key": "target", "label": "IP/Host", "value": HERE,
     "values": [HERE, "127.0.0.1", "192.168.0.0-255", "192.168.1.0-255", "10.0.0.0-255"]},
    {"key": "scan", "label": "Scan type", "value": "TCP SYN (Stealth)",
     "values": ["TCP SYN (Stealth)", "TCP Connect", "Ping only"]},
    {"key": "timing", "label": "Timing", "value": "Aggressive",
     "values": ["Aggressive", "Normal", "Polite"]},
    {"key": "ports", "label": "Ports", "value": "Most common 1000 ports (default)",
     "values": ["Most common 1000 ports (default)", "Top 100", "All 65535"]},
    {"divider": True},
    {"key": "open_only", "label": "Only open ports", "value": "NO", "values": ["NO", "YES"]},
    {"key": "os", "label": "OS Detection", "value": "YES", "values": ["YES", "NO"]},
]

# What each choice means to nmap. The form is the design's wording; this is the
# translation, kept in one place so the two can be read against each other.
# The adjust affordance on the selected row. Fixed columns rather than measured
# ones: the value between them changes width with every press, and chevrons that
# move with it read as the row twitching. The same reasoning the menus' toggle rows
# use, which size their slot from the widest value they can hold.
CHEVRON_L = 88
CHEVRON_R = 250
VALUE_GAP = 6

SCAN_FLAG = {"TCP SYN (Stealth)": "-sS", "TCP Connect": "-sT", "Ping only": "-sn"}
TIMING_FLAG = {"Aggressive": "-T4", "Normal": "-T3", "Polite": "-T2"}
PORTS_FLAG = {"Most common 1000 ports (default)": [], "Top 100": ["--top-ports", "100"],
              "All 65535": ["-p-"]}

# The advice the portrait gives, by scan type: the mockup's copy for the stealth
# scan, and the same point made for the others.
ADVICE = {
    "TCP SYN (Stealth)": [
        "I see you're running a TCP SYN",
        "scan. But it only tells you if",
        "a port is open or not.",
        "",
        "If you switch to TCP Connect",
        "mode, I can detect service",
        "version and check",
        "for vulnerabilities.",
    ],
    "TCP Connect": [
        "TCP Connect completes every",
        "handshake, so it is louder than",
        "a SYN scan and shows up in",
        "the target's logs.",
        "",
        "In return I can read service",
        "banners and tell you what is",
        "actually listening.",
    ],
    "Ping only": [
        "Ping only asks who is there",
        "and nothing else: no ports,",
        "no services, no versions.",
        "",
        "It is the fastest way to map",
        "a network, and the right first",
        "step before scanning anything",
        "in detail.",
    ],
}


class Canvas:
    """A panel-sized greyscale buffer with the shapes these screens need."""

    def __init__(self):
        self.px = bytearray([WHITE]) * (W * H)

    def span(self, x0, x1, y, ink=BLACK):
        if not 0 <= y < H:
            return
        x0, x1 = max(0, min(x0, x1)), min(W - 1, max(x0, x1))
        if x1 < x0:
            return
        at = y * W + x0
        self.px[at:at + (x1 - x0 + 1)] = bytes([ink]) * (x1 - x0 + 1)

    def rect(self, x, y, w, h, ink=BLACK):
        for row in range(y, y + h):
            self.span(x, x + w - 1, row, ink)

    def frame(self, x, y, w, h, ink=BLACK, radius=0):
        """A one-pixel outline, with the corners cut by `radius`.

        Cut rather than curved: the design's corners are a straight stair, which is
        what every frame in this system uses.
        """
        for i in range(radius, w - radius):
            self.px[y * W + x + i] = ink
            self.px[(y + h - 1) * W + x + i] = ink
        for i in range(radius, h - radius):
            self.px[(y + i) * W + x] = ink
            self.px[(y + i) * W + x + w - 1] = ink
        for i in range(radius):
            inset = radius - 1 - i
            self.px[(y + i) * W + x + inset] = ink
            self.px[(y + i) * W + x + w - 1 - inset] = ink
            self.px[(y + h - 1 - i) * W + x + inset] = ink
            self.px[(y + h - 1 - i) * W + x + w - 1 - inset] = ink

    def blit(self, spec, x, y):
        """One of the extracted images, as its own pixels.

        Copied rather than stencilled: an image carries tones, where a sprite is one
        bit a pixel and takes whatever ink it is given.
        """
        w, h, data = spec
        pixels = base64.b64decode(data)
        for row in range(h):
            if not 0 <= y + row < H:
                continue
            at = (y + row) * W + x
            src = row * w
            span = min(w, W - x)
            self.px[at:at + span] = pixels[src:src + span]

    def sprite(self, spec, x, y, ink=BLACK):
        """One of the extracted sprites, painted in `ink`."""
        w, h, data = spec
        packed = base64.b64decode(data)
        stride = (w + 7) // 8
        for row in range(h):
            for col in range(w):
                if packed[row * stride + col // 8] >> (7 - col % 8) & 1:
                    if 0 <= x + col < W and 0 <= y + row < H:
                        self.px[(y + row) * W + x + col] = ink

    def data(self):
        return base64.b64encode(bytes(self.px)).decode("ascii")


def text(x, y, string, font="title", align="left", white=False):
    return {"x": x, "y": y, "text": string, "font": font, "align": align, "white": white}


class Host:
    """One host nmap has finished with."""

    def __init__(self, address, name="", vendor="", ports=None, os_name=""):
        self.address = address
        self.name = name
        self.vendor = vendor
        self.mac = ""
        self.os_name = os_name
        self.ports = ports or []

    @property
    def label(self):
        return self.name or self.address

    @property
    def open_ports(self):
        return [p for p in self.ports if p[1] == "open"]

    @property
    def icon(self):
        """The sprite for this host, for the screens the app paints itself."""
        return {"camera": art.CAMERA, "phone": art.PHONE}.get(self.kind, art.MONITOR)

    @property
    def kind(self):
        """Which of the design's three icons suits this host, by name.

        A guess from the vendor and the name, which is all the information a scan
        gives: nmap reports what answered, not what it is. A laptop uses the
        desktop's icon, as the design does.
        """
        haystack = f"{self.name} {self.vendor}".lower()
        if any(word in haystack for word in ("cam", "hikvision", "dahua", "shenzen")):
            return "camera"
        if any(word in haystack for word in ("phone", "android", "iphone", "pixel", "samsung")):
            return "phone"
        return "monitor"


HOST_BLOCK = re.compile(r"<host\b.*?</host>", re.S)
TASK_PROGRESS = re.compile(r'<taskprogress task="([^"]*)"[^>]*percent="([\d.]+)"[^>]*/>')


def parse_host(block):
    """One `<host>` element from nmap's XML, as a Host.

    A regex rather than an XML parser: nmap streams these one at a time, so what
    arrives is a fragment rather than a document, and the fields wanted are flat.
    """
    address = ""
    vendor = ""
    mac = ""
    for match in re.finditer(r'<address addr="([^"]+)" addrtype="([^"]+)"([^>]*)>', block):
        addr, kind, rest = match.groups()
        if kind == "ipv4":
            address = addr
        elif kind == "mac":
            mac = addr
            found = re.search(r'vendor="([^"]*)"', rest)
            vendor = found.group(1) if found else ""
    name = ""
    found = re.search(r'<hostname name="([^"]+)"', block)
    if found:
        name = found.group(1)
    os_name = ""
    found = re.search(r'<osmatch name="([^"]+)"', block)
    if found:
        os_name = found.group(1)
    ports = []
    for match in re.finditer(
            r'<port protocol="[^"]*" portid="(\d+)">\s*<state state="([^"]+)"'
            r'[^>]*>\s*(?:<service name="([^"]*)")?', block):
        port, state, service = match.groups()
        ports.append((int(port), state, service or ""))
    host = Host(address, name, vendor, ports, os_name)
    host.mac = mac
    return host


class Scan:
    """A running nmap, with its hosts arriving as it finishes them."""

    def __init__(self, form):
        self.hosts = []
        self.done = False
        self.error = ""
        self.note = ""
        self.rest = ""
        self.percent = 0.0
        self.task = ""
        self.started = time.monotonic()
        flag = SCAN_FLAG[form["scan"]]
        # A SYN scan sends raw packets, which needs root. Under flipctl it has it,
        # since the service holds the panel and the input devices; run by hand it
        # may not, and nmap then exits 1 with nothing on screen worth reading. A
        # Connect scan needs no privileges and answers the same question, so say so
        # and carry on rather than failing.
        if flag == "-sS" and os.geteuid() != 0:
            flag = "-sT"
            self.note = "no root: TCP Connect"
        # --stats-every asks for progress, and nmap answers with a <taskprogress>
        # line only when a phase runs long enough to have progress worth reporting:
        # a /24 of top-100 ports finishes its phases before that, and emits no task
        # lines at all. So the percentage is used when it arrives and never counted
        # on, and the screen's own cue is elapsed time and a moving marker.
        argv = ["nmap", "-oX", "-", "--stats-every", "1s",
                flag, TIMING_FLAG[form["timing"]]]
        argv += PORTS_FLAG[form["ports"]]
        if form["os"] == "YES" and form["scan"] != "Ping only":
            argv.append("-O")
        if form["open_only"] == "YES":
            argv.append("--open")
        argv.append(form["target"])
        self.argv = argv
        try:
            # Line buffered and unbuffered on the way out, so a host that finishes
            # is a host on screen rather than one sitting in a pipe buffer.
            self.child = subprocess.Popen(argv, stdout=subprocess.PIPE,
                                          stderr=subprocess.PIPE)
        except FileNotFoundError:
            self.child = None
            self.error = "nmap is not installed"
            self.done = True

    @property
    def elapsed(self):
        return time.monotonic() - self.started

    def fd(self):
        return None if self.child is None else self.child.stdout.fileno()

    def read(self):
        """Take whatever nmap has written. True if anything changed."""
        if self.child is None:
            return False
        chunk = os.read(self.child.stdout.fileno(), 65536)
        if not chunk:
            self.done = True
            self.child.wait()
            if self.child.returncode not in (0, None) and not self.hosts:
                # nmap's own last word, which says what went wrong; the exit code
                # on its own never does.
                said = self.child.stderr.read().decode("utf-8", "replace").strip()
                last = said.splitlines()[-1] if said else ""
                self.error = last or f"nmap exited {self.child.returncode}"
            return True
        self.rest += chunk.decode("utf-8", "replace")
        found = False
        for match in TASK_PROGRESS.finditer(self.rest):
            self.task = match.group(1)
            self.percent = float(match.group(2))
            found = True
        # Progress lines are not worth keeping once read, and leaving them in the
        # buffer would make every read rescan the whole scan's worth of them.
        self.rest = TASK_PROGRESS.sub("", self.rest)
        while True:
            match = HOST_BLOCK.search(self.rest)
            if not match:
                break
            host = parse_host(match.group(0))
            self.rest = self.rest[match.end():]
            if host.address:
                self.hosts.append(host)
                found = True
        return found

    def stop(self):
        if self.child and self.child.poll() is None:
            self.child.terminate()


class App:
    """The four screens, and which one is in front."""

    FORM, SCANNING, DETAIL, ADVICE = range(4)

    def __init__(self):
        self.where = self.FORM
        self.form = {f["key"]: f["value"] for f in FIELDS if "key" in f}
        self.selected = 0
        self.scan = None
        self.host = 0

    # ── the form, image1 ────────────────────────────────────────────────────
    def draw_form(self):
        canvas = Canvas()
        # The header: the app title band every flipctl2 app draws, 16 rows flush
        # under the status bar. 16 rather than 12 because the name is in the card
        # font, whose ink is 11 rows deep once a descender is in it, and a 12-row
        # band puts that ink inside the first row's frame.
        canvas.rect(0, TOP, W, TITLE_H, GREY)
        texts = [
            # The app's own name in the card font, as the design draws it and as
            # every app's title band in flipctl2 does. What it is about to do sits
            # beside it in the plain one.
            text(4, TOP, "nmap", font="row_active"),
            text(40, TOP + 3, "New scan"),
        ]

        y = TOP + TITLE_H + 3
        rows = []
        for field in FIELDS:
            if field.get("divider"):
                canvas.span(4, W - 5, y + 3, BLACK)
                y += 8
                continue
            rows.append((field, y))
            y += 13

        for field, row_y in rows:
            picked = self.form[field["key"]]
            chosen = rows[self.selected][0] is field
            texts.append(text(6, row_y, field["label"]))
            # The design sets the target in the card font and leaves the rest
            # plain: measured row by row off the mockup, only the first value has
            # the taller glyphs.
            value_font = "row_active" if field is FIELDS[0] else "title"
            # The card font's ink is 10 rows deep where the plain one is 7, so at
            # the same draw y it hangs below the row and into the frame's bottom
            # edge. Lifting it 2 puts its ink inside the frame and 2 above the
            # label's, which is where the mockup has it.
            lift = 4 if value_font == "row_active" else 0
            if chosen:
                # The selected row carries the adjust affordance, as every list in
                # this system does. The app draws it itself: a canvas gets pixels
                # and text, not components.
                canvas.frame(2, row_y - 2, W - 4, 13, BLACK, radius=3)
                texts.append(text(CHEVRON_L, row_y, "<"))
                texts.append(text(CHEVRON_R, row_y, ">"))
                texts.append(text(CHEVRON_R - VALUE_GAP, row_y - lift, picked,
                                  font=value_font, align="right"))
            else:
                texts.append(text(W - 6, row_y - lift, picked,
                                  font=value_font, align="right"))

        return canvas, texts, ["Home", "Help", "", "", "Scan"]

    # ── the host list, image2 ───────────────────────────────────────────────
    # Not painted: this page is flipctl's own card component, the one the Ethernet
    # screen is built from. The app says what each card holds and which is selected,
    # and the frame, the selector, the drill-in bar, the scrollbar and the marker's
    # movement all stay on that side, where every other list in the system gets
    # them. What the app would gain by drawing it itself is a card that drifts from
    # the rest of the device the first time the design moves.
    def scene_hosts(self):
        scan = self.scan
        hosts = scan.hosts if scan else []
        running = bool(scan) and not scan.done

        cards = [{
            "label": host.label,
            # The address is already the name when there is no hostname, so it
            # would be the same string twice.
            "info": " ".join(part for part in
                             (host.address if host.name else "", host.vendor) if part),
            "value": f"Ports: {len(host.open_ports)} open",
            "icon": f"icons/{host.kind}.png",
            "actionable": True,
        } for host in hosts]

        # Nothing found, or nothing to find: one dim card rather than an empty page,
        # which says the scan reported instead of leaving the screen to be read as
        # a scan that never started.
        if not cards and not running:
            cards = [{
                "label": "Scan failed" if scan and scan.error else "No hosts up",
                "info": (scan.error if scan and scan.error
                         else "Nothing answered on this range"),
                "dim": True,
            }]

        return {"screen": {
            "type": "cards",
            "title": f"{'Scanning' if running else 'Scanned'} {self.form['target']}",
            "note": f"{len(hosts)} hosts up",
            "busy": running,
            # nmap reports a percentage only for a phase that runs long enough to
            # have one; -1 leaves the track empty and lets the marker say that work
            # is going on, which is the honest reading.
            "percent": int(scan.percent) if running and scan.percent else -1,
            # Every host, and which one is selected: how many fit and where the
            # window sits are flipctl's business, as they are for its own lists.
            "selected": self.host,
            "cards": cards,
            "buttons": ["Stop" if running else "Close", "Help", "", "",
                        "View" if hosts else ""],
        }}

    # ── one host, image3 ────────────────────────────────────────────────────
    def draw_detail(self):
        canvas = Canvas()
        host = self.scan.hosts[self.host]
        canvas.rect(0, TOP, W, TITLE_H, GREY)
        canvas.sprite(host.icon, 3, TOP + 1)
        texts = [text(20, TOP, host.label, font="row_active")]

        y = TOP + TITLE_H + 3
        texts.append(text(4, y, f"IPv4:{host.address}"))
        if host.os_name:
            texts.append(text(130, y, f"OS:{host.os_name}"))
        y += 11
        if host.mac:
            texts.append(text(4, y, f"MAC:{host.mac}"))
        if host.vendor:
            texts.append(text(130, y, f"Vendor:{host.vendor}"))
        y += 13

        opened = host.open_ports
        texts.append(text(4, y, f"Ports: {len(opened)} open"))
        y += 12
        for port, state, service in opened[:5]:
            canvas.rect(2, y - 1, W - 4, 11, GREY)
            texts.append(text(6, y - 1, str(port)))
            texts.append(text(44, y - 1, state))
            texts.append(text(90, y - 1, service))
            y += 12

        return canvas, texts, ["Close", "", "", "", ""]

    # ── the advice, image4 ──────────────────────────────────────────────────
    def draw_advice(self):
        canvas = Canvas()
        # The picture on the left, the words on the right. No frame around the
        # picture: at its own scale it is 117 tall, which is exactly the room
        # between the status bar and the soft strip, and it brings its own ground.
        canvas.blit(art.DOLPHIN, 0, TOP)

        # Beside the drawing, not beside the image: the picture carries a column of
        # white to the right of the snout, and measuring from the image's edge puts
        # the balloon a finger's width away from what it is pointing at.
        panel_x = art.DOLPHIN_INK_W + 3
        canvas.frame(panel_x, TOP + 1, W - panel_x - 2, BOTTOM - TOP - 2, BLACK, radius=4)
        texts = [text(panel_x + 5, TOP + 3, "NMAP ADVICE")]
        y = TOP + 16
        for line in ADVICE[self.form["scan"]]:
            if line:
                texts.append(text(panel_x + 5, y, line))
            y += 10
            if y > BOTTOM - 10:
                break
        return canvas, texts, ["Close", "", "", "", ""]

    def screen(self):
        if self.where == self.SCANNING:
            return self.scene_hosts()
        canvas, texts, buttons = {
            self.FORM: self.draw_form,
            self.DETAIL: self.draw_detail,
            self.ADVICE: self.draw_advice,
        }[self.where]()
        return {
            "screen": {
                "type": "canvas",
                "status": True,
                "data": canvas.data(),
                "text": texts,
                "buttons": buttons,
            }
        }

    # ── keys ────────────────────────────────────────────────────────────────
    def rows(self):
        return [f for f in FIELDS if "key" in f]

    def key(self, name):
        """Handle a key. False to leave the app."""
        if self.where == self.FORM:
            fields = self.rows()
            if name == "down":
                self.selected = (self.selected + 1) % len(fields)
            elif name == "up":
                self.selected = (self.selected - 1) % len(fields)
            elif name in ("left", "right"):
                field = fields[self.selected]
                options = field["values"]
                at = options.index(self.form[field["key"]])
                step = 1 if name == "right" else -1
                self.form[field["key"]] = options[(at + step) % len(options)]
            elif name in ("run", "ok"):
                self.scan = Scan(self.form)
                self.host = 0
                self.where = self.SCANNING
            elif name == "view":
                self.where = self.ADVICE
            elif name in ("esc", "back"):
                return False
        elif self.where == self.SCANNING:
            hosts = self.scan.hosts if self.scan else []
            if name == "down" and hosts:
                self.host = min(len(hosts) - 1, self.host + 1)
            elif name == "up" and hosts:
                self.host = max(0, self.host - 1)
            elif name in ("run", "ok") and hosts:
                self.where = self.DETAIL
            elif name == "view":
                self.where = self.ADVICE
            elif name in ("esc", "back"):
                # Stop first, go back second: leaving a scan running behind the
                # form would keep the network busy for no one.
                if self.scan:
                    self.scan.stop()
                self.where = self.FORM
        elif self.where == self.DETAIL:
            if name in ("esc", "back"):
                self.where = self.SCANNING
        elif self.where == self.ADVICE:
            if name in ("esc", "back", "view", "ok", "run"):
                self.where = self.SCANNING if self.scan else self.FORM
        return True


class Keys:
    """Key events, read from the descriptor rather than through a text buffer.

    select(2) reports the descriptor, not Python's buffer, so a readline that took
    two events out of one read left the second unread with nothing to wake the app.
    """

    def __init__(self, fd=0):
        self.fd = fd
        self.rest = b""

    def read(self):
        chunk = os.read(self.fd, 65536)
        if not chunk:
            return None
        self.rest += chunk
        events = []
        while b"\n" in self.rest:
            line, self.rest = self.rest.split(b"\n", 1)
            if not line.strip():
                continue
            try:
                events.append(json.loads(line))
            except ValueError:
                continue
        return events


def main():
    app = App()
    keys = Keys()
    sel = selectors.DefaultSelector()
    sel.register(keys.fd, selectors.EVENT_READ)
    watching = None

    def send():
        sys.stdout.write(json.dumps(app.screen()) + "\n")
        sys.stdout.flush()

    send()
    while True:
        # nmap's output is watched alongside the keys, so a host that finishes
        # appears without waiting for a press.
        wanted = app.scan.fd() if app.scan and not app.scan.done else None
        if wanted != watching:
            if watching is not None:
                sel.unregister(watching)
            if wanted is not None:
                sel.register(wanted, selectors.EVENT_READ)
            watching = wanted

        # While a scan runs the screen has something moving on it, so it needs
        # frames even when neither nmap nor the user has said anything.
        alive = bool(app.scan) and not app.scan.done and app.where == app.SCANNING
        dirty = alive
        for event, _ in sel.select(timeout=0.25 if alive else None):
            if event.fd == keys.fd:
                events = keys.read()
                if events is None:
                    if app.scan:
                        app.scan.stop()
                    return
                for message in events:
                    if not message.get("down"):
                        continue
                    if not app.key(message.get("key")):
                        if app.scan:
                            app.scan.stop()
                        return
                    dirty = True
            elif app.scan and app.scan.read():
                dirty = True
        if dirty:
            send()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
