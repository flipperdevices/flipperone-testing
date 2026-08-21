#!/usr/bin/env python3
"""Ping, as a flipctl app.

Apps do not draw. They describe a screen and flipctl renders it, which is what
keeps an app free of any GUI toolkit: this file is stdlib-only and would work
unchanged in any language that can write a line of JSON.

Protocol, newline-delimited JSON on stdin and stdout:

    app -> flipctl   {"screen": {...}}      a complete scene, sent on every change
    flipctl -> app   {"key": "down", "down": true}

The whole scene goes out every time rather than a diff. A screen is a few hundred
bytes, and sending everything means there is no handle lifecycle to leak and no
way to desync: if the app restarts, its first scene puts the screen right.

Two scene types are used here:

    {"type": "form", "title", "rows": [{"label", "value", "at_start", "at_end"}],
     "selected", "buttons"}
    {"type": "log",  "title", "lines": [...], "total", "offset", "buttons"}

A log sends a window rather than its whole history: `total` and `offset` tell
flipctl where that window sits so it can draw a scrollbar, without the app having
to resend hundreds of lines on every reply.
"""
import json
import os
import selectors
import shutil
import subprocess
import sys
import threading

# Read by flipctl without running this file, so an app whose dependencies are
# missing can still be listed and offered an install. Only APP_NAME is required.
#
#   APP_NAME  what the Apps menu shows
#   APP_ICON  a file in this directory, 14x14
#   APP_APT   Debian packages
#   APP_PIP   Python packages, installed into this app's own .venv
APP_NAME = "Ping"
APP_APT = ["iputils-ping"]

# Editable parameters. `values` makes a field a cycle; `step` makes it numeric.
FIELDS = [
    {"label": "Host", "value": "1.1.1.1",
     "values": ["1.1.1.1", "8.8.8.8", "127.0.0.1", "flipperdevices.com", "google.com"]},
    {"label": "Count", "value": 5, "step": 1, "min": 1, "max": 99},
    {"label": "Interval", "value": 1.0, "step": 0.2, "min": 0.2, "max": 5.0},
    {"label": "Size", "value": 56, "step": 8, "min": 8, "max": 1024},
]

# The screen shows eight 12px lines under a title. flipctl clips to what fits
# regardless, but knowing the window size lets the app send only those lines
# instead of its whole history on every reply.
WINDOW = 8

# How much history to keep. Bounded, because an unbounded buffer on a device with
# one screen is a leak with extra steps; a few hundred lines is more than a ping
# run produces and costs a few kilobytes.
BUFFER = 200


def emit(scene):
    sys.stdout.write(json.dumps({"screen": scene}) + "\n")
    sys.stdout.flush()


def shown(field):
    """The field's value, wrapped in chevrons to ask for the adjust control.

    A value the renderer sees as "< ... >" is drawn with chevrons either side while
    its row is selected, and collapses to the bare value when it is not. That is
    how the row says "left and right change me" without the protocol needing a
    field for it.
    """
    v = field["value"]
    if isinstance(v, float):
        return f"< {v:.1f}s >"
    return f"< {v} >"


def at_ends(field):
    """Whether the value sits at the low or high end of its range.

    The chevron at an exhausted end is suppressed, so the control shows which
    directions are still available. A cycling field (the host list) wraps, so it
    never runs out in either direction.
    """
    if "values" in field:
        return False, False
    v = field["value"]
    return v <= field["min"], v >= field["max"]


class App:
    def __init__(self):
        self.selected = 0
        self.lines = []
        self.proc = None
        self.reader = None
        self.title = "Ping"
        # First visible line. `follow` keeps it pinned to the tail so new output
        # scrolls into view, and turns off as soon as the user scrolls back, which
        # is the behaviour a log wants: watch it live, or read what went past.
        self.offset = 0
        self.follow = True

    # ---- scenes ----

    def form(self):
        emit({
            "type": "form",
            "title": "Ping",
            "rows": [
                {
                    "label": f["label"],
                    "value": shown(f),
                    "at_start": at_ends(f)[0],
                    "at_end": at_ends(f)[1],
                }
                for f in FIELDS
            ],
            "selected": self.selected,
            # One entry per physical soft key: esc, view, power, edit, run.
            "buttons": ["Close", "", "", "", "Start"],
        })

    def log(self):
        if self.follow:
            self.offset = max(0, len(self.lines) - WINDOW)
        self.offset = max(0, min(self.offset, max(0, len(self.lines) - WINDOW)))
        emit({
            "type": "log",
            "title": self.title,
            "lines": self.lines[self.offset:self.offset + WINDOW],
            "total": len(self.lines),
            "offset": self.offset,
            "buttons": ["Close", "", "", "", "Stop" if self.running() else "Again"],
        })

    def scroll(self, delta):
        limit = max(0, len(self.lines) - WINDOW)
        self.offset = max(0, min(self.offset + delta, limit))
        # Reaching the bottom resumes following; anywhere else pins the view.
        self.follow = self.offset >= limit
        self.log()

    def running(self):
        return self.proc is not None and self.proc.poll() is None

    # ---- editing ----

    def adjust(self, delta):
        f = FIELDS[self.selected]
        if "values" in f:
            options = f["values"]
            i = (options.index(f["value"]) + delta) % len(options)
            f["value"] = options[i]
        else:
            v = f["value"] + delta * f["step"]
            v = max(f["min"], min(f["max"], v))
            f["value"] = round(v, 1) if isinstance(f["step"], float) else int(v)

    # ---- the ping itself ----

    def start(self):
        self.stop()
        host = FIELDS[0]["value"]
        count = FIELDS[1]["value"]
        interval = FIELDS[2]["value"]
        size = FIELDS[3]["value"]
        self.title = f"Ping {host}"
        self.lines = []
        self.offset = 0
        self.follow = True

        binary = shutil.which("ping")
        if not binary:
            self.lines = ["ping not installed"]
            self.log()
            return

        # -n skips reverse lookups, which would otherwise stall each line for as
        # long as the resolver takes.
        argv = [binary, "-n", "-c", str(count), "-i", str(interval),
                "-s", str(size), str(host)]
        self.proc = subprocess.Popen(
            argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1)

        # A thread per run, because the main loop has to stay responsive to keys
        # while ping is producing lines on its own schedule.
        self.reader = threading.Thread(target=self._pump, daemon=True)
        self.reader.start()
        self.log()

    def _pump(self):
        proc = self.proc
        for raw in proc.stdout:
            if proc is not self.proc:
                return          # superseded by a newer run
            line = raw.rstrip()
            if not line:
                continue
            shown_line = compress(line)
            if shown_line is None:
                continue
            self.lines.append(shown_line)
            del self.lines[:-BUFFER]
            self.log()
        # Reap before the final redraw. Reaching EOF on stdout does not mean the
        # child has exited, so `poll()` can still return None here and `running()`
        # would report true: the soft key would stay on Stop until some unrelated
        # keypress caused another redraw.
        proc.wait()
        if proc is self.proc:
            self.log()

    def stop(self):
        if self.running():
            self.proc.terminate()
        self.proc = None


def compress(line):
    """Trim ping's output to something a 256px screen can show.

    `64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=12.3 ms` is far wider than the
    screen, and the parts that change are the sequence number and the time.

    Returns None for a line worth dropping entirely. With eight lines on screen,
    a line that carries no information is expensive:

      * `PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data` repeats the title.
      * `--- 1.1.1.1 ping statistics ---` is a delimiter; the host is in the title
        and the summary line that follows says the run finished.
    """
    if line.startswith("PING"):
        return None
    if "ping statistics" in line:
        return None
    if "icmp_seq=" in line and "time=" in line:
        seq = line.split("icmp_seq=")[1].split()[0]
        ttl = line.split("ttl=")[1].split()[0] if "ttl=" in line else "?"
        ms = line.split("time=")[1].split()[0]
        return f"seq {seq}  ttl {ttl}  {ms} ms"
    if "packets transmitted" in line:
        parts = line.split(",")
        tx = parts[0].split()[0]
        rx = parts[1].split()[0]
        loss = parts[2].strip().split()[0]
        return f"{rx}/{tx} received, {loss} loss"
    if "=" in line and ("rtt" in line or "round-trip" in line):
        return rtt_summary(line)
    return line


def rtt_summary(line):
    """Label ping's timing summary.

    `rtt min/avg/max/mdev = 2.690/2.720/2.777/0.030 ms` says nothing about which
    number is which once the labels are dropped, and the raw form is what a screen
    this size cannot afford to leave unexplained.

    The labels are read out of the line rather than assumed, because implementations
    differ on both the wording and the order: iputils says `rtt min/avg/max/mdev`
    and BusyBox `round-trip min/avg/max`.
    """
    head, values = line.split("=", 1)
    names = [n.strip() for n in head.split()[-1].split("/")]
    numbers = [v.strip() for v in values.strip().split()[0].split("/")]
    if len(names) != len(numbers):
        return values.strip()

    pretty = {"mdev": "jitter", "stddev": "jitter"}
    # Average first: it is the number anyone reads, and min and max frame it.
    order = ["avg", "min", "max", "mdev", "stddev"]
    pairs = sorted(
        zip(names, numbers),
        key=lambda kv: order.index(kv[0]) if kv[0] in order else len(order),
    )
    # Two decimals, matching the per-reply lines; ping prints three.
    return "  ".join(
        f"{pretty.get(name, name)} {float(value):.2f}" for name, value in pairs
    )


class Keys:
    """Key events, read without a text buffer in the way.

    select(2) reports the descriptor, not Python's buffer. A readline that pulled
    two events out of one read left the second sitting in the buffer with nothing
    to wake the app, so it ran an event behind: a press was acted on by the next
    press. Reading the descriptor and splitting on newlines keeps the two in step.
    """

    def __init__(self, fd=0):
        self.fd = fd
        self.rest = b""

    def read(self):
        """Every event that has arrived, or None once flipctl closes the pipe."""
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
    app.form()
    on_log = False

    sel = selectors.DefaultSelector()
    keys = Keys()
    sel.register(keys.fd, selectors.EVENT_READ)

    while True:
        if sel.select(timeout=None):
            events = keys.read()
            if events is None:
                app.stop()
                return
            for msg in events:
                if not msg.get("down"):
                    continue
                key = msg.get("key")

                if on_log:
                    if key == "down":
                        app.scroll(+1)
                    elif key == "up":
                        app.scroll(-1)
                    elif key == "right":
                        app.scroll(+WINDOW)
                    elif key == "left":
                        app.scroll(-WINDOW)
                    elif key == "esc":
                        app.stop()
                        on_log = False
                        app.form()
                    elif key == "run":
                        if app.running():
                            app.stop()
                            app.log()
                        else:
                            app.start()
                    elif key == "back":
                        app.stop()
                        return
                else:
                    if key == "down":
                        app.selected = (app.selected + 1) % len(FIELDS)
                        app.form()
                    elif key == "up":
                        app.selected = (app.selected - 1) % len(FIELDS)
                        app.form()
                    elif key == "right":
                        app.adjust(+1)
                        app.form()
                    elif key == "left":
                        app.adjust(-1)
                        app.form()
                    elif key in ("run", "ok"):
                        on_log = True
                        app.start()
                    elif key in ("esc", "back"):
                        return


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
