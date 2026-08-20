#!/usr/bin/env python3
"""Buttons and a progress bar, as a flipctl app.

A demonstration of the `detail` scene: rows that are gauges, dividers or plain
lines of text, plus the five soft buttons. Nothing here draws anything; the app
describes a screen and flipctl renders it, so this file is stdlib-only.

    app -> flipctl   {"screen": {"type": "detail", "title", "rows": [...],
                                 "buttons": [...]}}
    flipctl -> app   {"key": "run", "down": true}

A row says what kind it is:

    {"kind": "gauge",   "label": "Download", "percent": 42}
    {"kind": "divider"}
    {"kind": "text",    "label": "a full-width line"}
    {"label": "Elapsed", "value": "12.4s"}      a label and a value, the default

`dim` draws a row in the grey tone rather than in ink.

The work here is fake on purpose: two counters at different rates, so the two
bars visibly disagree, and a job that finishes. What matters is the shape, which
is what a real long-running app would send.
"""
import json
import selectors
import sys
import time

APP_NAME = "Progress"

# One tick of fake work. 100ms is fast enough to read as motion and slow enough
# that the panel is nowhere near its limit: the bar moves 1px every other tick.
TICK_S = 0.1
# Percent per tick for the two jobs, chosen so they finish at different times.
RATE = {"download": 1.7, "verify": 0.8}


class Job:
    """A percentage that advances while it is running."""

    def __init__(self, name, rate):
        self.name = name
        self.rate = rate
        self.percent = 0.0

    def tick(self):
        if self.percent < 100:
            self.percent = min(100.0, self.percent + self.rate)

    @property
    def done(self):
        return self.percent >= 100


class App:
    def __init__(self):
        self.jobs = [Job("Download", RATE["download"]), Job("Verify", RATE["verify"])]
        self.running = False
        self.started_at = None
        # Wall-clock time spent running, which is not the same as time since the
        # app opened: pausing has to stop the clock or the rate reads as a lie.
        self.elapsed = 0.0

    @property
    def finished(self):
        return all(j.done for j in self.jobs)

    def start(self):
        if self.finished:
            self.reset()
        self.running = True
        self.started_at = time.monotonic()

    def pause(self):
        if self.running:
            self.elapsed += time.monotonic() - self.started_at
        self.running = False
        self.started_at = None

    def reset(self):
        self.pause()
        self.elapsed = 0.0
        for job in self.jobs:
            job.percent = 0.0

    def tick(self):
        if not self.running:
            return
        for job in self.jobs:
            job.tick()
        if self.finished:
            self.pause()

    def seconds(self):
        if self.running:
            return self.elapsed + (time.monotonic() - self.started_at)
        return self.elapsed

    def state(self):
        if self.finished:
            return "Done"
        if self.running:
            return "Running"
        if self.seconds() > 0:
            return "Paused"
        return "Idle"

    def screen(self):
        total = sum(j.percent for j in self.jobs) / len(self.jobs)
        secs = self.seconds()
        rows = [
            {"kind": "text", "label": f"{self.state()}  {total:.0f}% of two jobs"},
            {"kind": "divider"},
        ]
        for job in self.jobs:
            rows.append({"kind": "gauge", "label": job.name, "percent": int(job.percent)})
            rows.append({"kind": "gauge", "label": job.name+" progress bar with long text", "percent": int(job.percent)})
            rows.append({"kind": "gauge", "percent": int(job.percent), "dim": True})

            rows.append(
                {
                    "label": "",
                    "value": "done" if job.done else f"{job.percent:.0f}%",
                    "dim": True,
                }
            )
        rows += [
            {"kind": "divider"},
            {"label": "Elapsed", "value": f"{secs:.1f}s"},
            {"label": "Rate", "value": f"{RATE['download']:.1f} %/tick", "dim": True},
        ]
        # One entry per physical soft key, in silkscreen order: esc, view, power,
        # edit, run. Empty draws no button, which is how a screen uses only some
        # of them.
        start_label = "Start" if not self.running else "Pause"
        buttons = ["Back", "", "Reset", "", start_label]
        return {
            "screen": {
                "type": "detail",
                "title": "Progress",
                "rows": rows,
                "buttons": buttons,
            }
        }


def send(app):
    sys.stdout.write(json.dumps(app.screen()) + "\n")
    sys.stdout.flush()


def main():
    app = App()
    send(app)

    sel = selectors.DefaultSelector()
    sel.register(sys.stdin, selectors.EVENT_READ)
    next_tick = time.monotonic() + TICK_S

    while True:
        # Wait for a key or for the next tick, whichever comes first, so a paused
        # app costs nothing and a running one still advances on time.
        timeout = max(0.0, next_tick - time.monotonic())
        dirty = False
        for _ in sel.select(timeout=timeout):
            line = sys.stdin.readline()
            if not line:
                return
            try:
                event = json.loads(line)
            except ValueError:
                continue
            # Releases are reported too; acting on both would do everything twice.
            if not event.get("down"):
                continue
            key = event.get("key")
            if key in ("run", "ok"):
                app.pause() if app.running else app.start()
            elif key == "power":
                app.reset()
            elif key in ("esc", "back"):
                return
            dirty = True

        if time.monotonic() >= next_tick:
            next_tick += TICK_S
            if app.running:
                app.tick()
                dirty = True

        if dirty:
            send(app)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
