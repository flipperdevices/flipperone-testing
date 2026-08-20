#!/usr/bin/env python3
"""Internet speed test, as a flipctl app.

Wraps the speedtest-cli package, which is the reason this app exists: it is the
first one to need a Python dependency, so it is what proves the install flow.
flipctl reads APP_PIP below without running this file, offers the install, and
puts the package in this directory's own .venv.

Protocol, newline-delimited JSON on stdin and stdout:

    app -> flipctl   {"screen": {...}}
    flipctl -> app   {"key": "run", "down": true}
"""
import json
import sys
import threading
import urllib.request

APP_NAME = "Speed Test"
APP_PIP = ["speedtest-cli"]

# Lines the log body shows.
WINDOW = 8

# Parallel connections per direction.
#
# The single biggest factor in the number this reports. speedtest-cli defaults to
# 8 for download and 2 for upload, and on this device that measured 166 Mbit/s
# down and 12 up against a link that does 424. One connection cannot fill a link
# with any real latency, and the servers reachable from here are 70ms away at
# best, so the window never opens far enough. 16 measured 327 down and 129 up.
CONNECTIONS = 16

# How many nearby servers to fetch and latency-test before picking one.
SERVER_CANDIDATES = 12

# Where to get the server list.
#
# Not from speedtest-cli, whose discovery is broken. It reads the legacy
# speedtest-servers-static.php catalogue, which now returns ten stale servers with
# nothing within 700km of here, so its "closest server" is whichever distant one
# answers. Its geolocation is right and its measurement code is fine; only the
# catalogue is stale.
#
# This is the endpoint the web client uses, and it returns the same servers the
# desktop app picks, including ones on the caller's own ISP a few km away.
SERVER_API = ("https://www.speedtest.net/api/js/servers"
              "?engine=js&limit={limit}&https_functional=true")


def emit(scene):
    sys.stdout.write(json.dumps({"screen": scene}) + "\n")
    sys.stdout.flush()


def mbit(bits_per_second):
    return f"{bits_per_second / 1_000_000:.1f} Mbit/s"


def nearby_servers():
    """Servers near this address, in the shape speedtest-cli expects.

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
                # speedtest-cli calls the distance "d" and sorts on it.
                "d": float(s.get("distance", 0)),
            })
        except KeyError:
            continue
    return out


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
            "buttons": ["Back", "", "", "", "" if self.running else "Start"],
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
            # Imported here rather than at the top so a missing package is a line
            # on screen instead of a traceback in the journal.
            import speedtest
        except ImportError as e:
            self.say(f"speedtest-cli missing: {e}")
            self.running = False
            self.draw()
            return
        try:
            # Plain HTTP, not secure=True. TLS costs about two thirds of the
            # result here: 220 Mbit/s becomes 75. curl reaches 424 Mbit/s over
            # HTTPS on this device, so it is not the crypto but the per-chunk cost
            # of pushing every byte through Python's ssl layer. Nothing secret is
            # being transferred either way.
            st = speedtest.Speedtest()
            self.say("finding server")
            candidates = nearby_servers()
            if candidates:
                best = st.get_best_server(candidates)
            else:
                # No list from the API: fall back to speedtest-cli's own
                # discovery, which at least measures something.
                self.say("using fallback list")
                st.get_servers()
                best = st.get_best_server()
            self.say(f"{best['sponsor']}")
            self.say(f"{best['name']}, {best['country']}")
            self.say(f"ping {best['latency']:.0f} ms")

            self.say(f"download... ({CONNECTIONS} conn)")
            down = st.download(threads=CONNECTIONS)
            self.lines[-1] = f"down {mbit(down)}"
            self.draw()

            self.say(f"upload... ({CONNECTIONS} conn)")
            up = st.upload(threads=CONNECTIONS)
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
