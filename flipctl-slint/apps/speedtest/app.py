#!/usr/bin/env python3
"""Internet speed test, as a flipctl app.

Measures against Ookla's servers directly, with nothing but the standard library.
It used to wrap speedtest-cli, and everything that made the numbers worth trusting
turned out to be the parts that worked around it: its server catalogue is stale
(the legacy list has nothing within 700km of here), its TLS path costs two thirds
of the result on this device, and its default two upload connections cannot fill a
link with 70ms of latency. What was left of the package was an HTTP GET and an
HTTP POST, which is what this does.

Protocol, newline-delimited JSON on stdin and stdout:

    app -> flipctl   {"screen": {...}}
    flipctl -> app   {"key": "run", "down": true}
"""
import json
import random
import sys
import threading
import time
import urllib.request

APP_NAME = "Speed Test"

# Lines the log body shows.
WINDOW = 8

# Parallel connections per direction.
#
# The single biggest factor in the number this reports. Eight down and two up, as
# speedtest-cli defaults to, measured 166 Mbit/s down and 12 up on this device
# against a link that does 424: one connection cannot fill a link with any real
# latency, and the nearest servers here are 70ms away. 16 measured 327 down and
# 129 up.
CONNECTIONS = 16

# How many nearby servers to fetch and latency-test before picking one.
SERVER_CANDIDATES = 12

# Where to get the server list.
#
# The endpoint the web client uses. It returns the same servers the desktop app
# picks, including ones on the caller's own ISP a few km away, and it geolocates
# from the caller's address so there is nothing to configure. The legacy
# speedtest-servers-static.php catalogue is the one to avoid: it answers with ten
# stale servers, none within 700km of here.
SERVER_API = ("https://www.speedtest.net/api/js/servers"
              "?engine=js&limit={limit}&https_functional=true")


# How long each direction runs. Long enough for a link with real latency to open
# its window, short enough that nobody wonders whether the app has hung.
DURATION = 5.0
# The download file every Ookla server serves. 4000x4000 is about 20MB, so a fast
# link needs several per connection and a slow one never finishes one, which is
# what the deadline is for.
DOWNLOAD_FILE = "random4000x4000.jpg"
# Upload payload per request. Small enough that the byte count moves smoothly,
# large enough that the per-request overhead does not dominate.
UPLOAD_CHUNK = 1 << 20


def emit(scene):
    sys.stdout.write(json.dumps({"screen": scene}) + "\n")
    sys.stdout.flush()


def mbit(bits_per_second):
    return f"{bits_per_second / 1_000_000:.1f} Mbit/s"


def nearby_servers():
    """Servers near this address, nearest first.

    Returns [] on any failure, so a fetch problem falls back rather than
    stopping the test.
    """
    try:
        req = urllib.request.Request(
            SERVER_API.format(limit=SERVER_CANDIDATES),
            headers={"User-Agent": "flipctl-speedtest"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            listing = json.load(r)
    except Exception:
        return []

    out = []
    for s in listing:
        try:
            out.append({
                "url": s["url"],
                "lat": s["lat"],
                "lon": s["lon"],
                "name": s["name"],
                "country": s["country"],
                "cc": s["cc"],
                "sponsor": s["sponsor"],
                "id": s["id"],
                "host": s["host"],
                # The listing calls the distance "d", and is sorted on it.
                "d": float(s.get("distance", 0)),
            })
        except KeyError:
            continue
    return out


def base_url(server):
    """The server's directory, from the upload endpoint its listing gives."""
    url = server.get("url") or ""
    return url.rsplit("/", 1)[0] + "/" if "/" in url else url


def latency_of(server):
    """Round trip to a server, in milliseconds, or None if it does not answer.

    The smallest of three: one sample measures whatever the network was doing at
    that instant, and the smallest is the closest thing to the path's own cost.
    """
    url = base_url(server) + "latency.txt"
    best = None
    for _ in range(3):
        started = time.monotonic()
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                response.read(64)
        except Exception:
            return None
        took = (time.monotonic() - started) * 1000
        best = took if best is None else min(best, took)
    return best


def pick_server(candidates):
    """The nearest candidate that answers, by measured round trip.

    Distance is a guess about the path; latency is the path. The list arrives
    sorted by distance, so this only has to test the head of it.
    """
    best = None
    for server in candidates[:CONNECTIONS // 2]:
        ms = latency_of(server)
        if ms is None:
            continue
        server = dict(server, latency=ms, base=base_url(server))
        if best is None or ms < best["latency"]:
            best = server
    return best


def download_worker(base, deadline, counted):
    """Pull the test file until the deadline, counting bytes.

    Plain HTTP, not HTTPS. TLS costs about two thirds of the result on this
    device: 220 Mbit/s becomes 75, while curl reaches 424 over HTTPS, so it is not
    the crypto but the per-chunk cost of pushing every byte through Python's ssl
    layer. Nothing secret is being transferred.
    """
    while time.monotonic() < deadline:
        # A fresh query string per request, so nothing between here and the server
        # can answer from a cache.
        url = f"{base}{DOWNLOAD_FILE}?x={random.random()}"
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                while time.monotonic() < deadline:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    counted.append(len(chunk))
        except Exception:
            return


def upload_worker(base, deadline, counted):
    """Push a payload at the server until the deadline, counting bytes."""
    payload = b"0" * UPLOAD_CHUNK
    url = base + "upload.php"
    while time.monotonic() < deadline:
        request = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/octet-stream"})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                response.read(64)
        except Exception:
            return
        counted.append(len(payload))


def measure(worker, base):
    """Run `worker` on every connection for DURATION, and return bits per second.

    The counters are plain lists, one append per chunk: CPython's list append is
    atomic, so the threads need no lock and the total is a sum at the end.
    """
    counted = []
    deadline = time.monotonic() + DURATION
    started = time.monotonic()
    threads = [
        threading.Thread(target=worker, args=(base, deadline, counted), daemon=True)
        for _ in range(CONNECTIONS)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=DURATION + 10)
    took = max(0.001, time.monotonic() - started)
    return sum(counted) * 8 / took


class App:
    def __init__(self):
        self.lines = ["Press Start to measure."]
        self.running = False
        self.offset = 0
        # Pinned to the tail while a test runs, released when the user scrolls up.
        self.follow = True

    def draw(self):
        total = len(self.lines)
        if self.follow:
            self.offset = max(0, total - WINDOW)
        self.offset = max(0, min(self.offset, max(0, total - WINDOW)))
        emit({
            "type": "log",
            "title": "Speed Test",
            "lines": self.lines[self.offset:self.offset + WINDOW],
            "total": total,
            "offset": self.offset,
            # Nothing to press while a test is in flight: it cannot be cancelled
            # part way through without leaving a half-finished measurement.
            "buttons": ["Close", "", "", "", "" if self.running else "Start"],
        })

    def say(self, line):
        self.lines.append(line)
        self.draw()

    def start(self):
        if self.running:
            return
        self.running = True
        self.lines = []
        self.follow = True
        self.say("starting")
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            self.say("finding server")
            candidates = nearby_servers()
            if not candidates:
                self.say("no servers listed")
                return
            best = pick_server(candidates)
            if best is None:
                self.say("no server answered")
                return
            self.say(f"{best['sponsor']} {best['name']}, {best['country']}")
            self.say(f"ping {best['latency']:.0f} ms")

            self.say(f"download... ({CONNECTIONS} conn)")
            down = measure(download_worker, best["base"])
            self.lines[-1] = f"down {mbit(down)}"
            self.draw()

            self.say(f"upload... ({CONNECTIONS} conn)")
            up = measure(upload_worker, best["base"])
            self.lines[-1] = f"up   {mbit(up)}"
            self.draw()

            self.say("done")
        except Exception as e:
            # Any failure here is a network or server problem, and the message is
            # the only useful thing to show.
            self.say(f"failed: {type(e).__name__}")
            for part in str(e).split(": "):
                if part:
                    self.say(part)
        finally:
            self.running = False
            self.draw()


def main():
    app = App()
    app.draw()
    for raw in sys.stdin:
        try:
            msg = json.loads(raw)
        except ValueError:
            continue
        if not msg.get("down"):
            continue
        key = msg.get("key")
        if key in ("run", "ok"):
            app.start()
        elif key == "up":
            app.offset = max(0, app.offset - 1)
            app.follow = False
            app.draw()
        elif key == "down":
            app.offset += 1
            app.draw()
        elif key in ("esc", "back"):
            return


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
