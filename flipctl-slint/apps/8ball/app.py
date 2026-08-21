#!/usr/bin/env python3
"""Magic 8 Ball, drawn by the app rather than assembled from components.

Every other app in here describes a screen as rows and lets flipctl lay it out.
This one paints: it keeps a panel-sized greyscale buffer, draws a ball into it,
and sends the bytes. flipctl blits them and adds nothing of its own.

    app -> flipctl   {"screen": {"type": "canvas", "data": "<base64>",
                                 "text": [...], "buttons": [...]}}
    flipctl -> app   {"key": "ok", "down": true}

`data` is one byte per pixel, 256 x 144, 0 black and 255 white, base64 encoded.
Frames go out only while something moves: a shake runs at 15fps for about a
second, and then the screen holds still and nothing is sent at all.

`text` is the one thing the app does not draw. It has no font, so it cannot
measure a string and therefore cannot centre one; flipctl draws these with the
system fonts:

    {"x": 128, "y": 60, "text": "ASK AGAIN", "align": "center",
     "font": "title", "white": true}

align is left, center or right against x. font is title, row or row_active.
white is for text over something the app painted dark.
"""
import base64
import json
import math
import os
import random
import selectors
import sys
import time

APP_NAME = "8 Ball"

W, H = 256, 144
WHITE, BLACK = 0xFF, 0x00

# The ball: as big as the panel allows with the soft buttons left clear. The
# window is the triangle the answer appears in, which on the real toy is the
# flat face of a die floating in the ink.
BALL_X, BALL_Y, BALL_R = 128, 66, 59
WINDOW_R = 34

# The animation, in seconds. A shake that reads as a shake needs a few cycles, and
# the window opening afterwards is what makes the answer feel produced rather than
# switched on.
FPS = 15
SHAKE_S = 0.7
OPEN_S = 0.25
# How far the ball travels at the peak of a wobble, and how many wobbles it makes.
SHAKE_PX = 7
SHAKE_CYCLES = 4

# Short on purpose. The window is a triangle, so the room for text runs out as it
# goes down, and the app cannot measure a string to check: no font, no metrics.
# Two words at most, and nothing past eight characters, fits the widest rows with
# the panel's 6px-per-character title font.
ANSWERS = [
    "CERTAIN",
    "NO DOUBT",
    "YES",
    "LIKELY",
    "GOOD",
    "SIGNS YES",
    "HAZY",
    "ASK LATER",
    "NOT NOW",
    "NO IDEA",
    "NO CHANCE",
    "NO",
    "LOOKS BAD",
    "DOUBTFUL",
]


class Canvas:
    """A panel-sized greyscale buffer with the few shapes this app needs."""

    def __init__(self):
        self.px = bytearray([WHITE]) * (W * H)

    def dot(self, x, y, ink=BLACK):
        if 0 <= x < W and 0 <= y < H:
            self.px[y * W + x] = ink

    def span(self, x0, x1, y, ink=BLACK):
        """A horizontal run, clipped. Rows are contiguous, so this is a slice."""
        if not 0 <= y < H:
            return
        x0, x1 = max(0, min(x0, x1)), min(W - 1, max(x0, x1))
        if x1 < x0:
            return
        start = y * W + x0
        self.px[start:start + (x1 - x0 + 1)] = bytes([ink]) * (x1 - x0 + 1)

    def disc(self, cx, cy, r, ink=BLACK):
        """A filled circle, one span per row: no rasteriser needed for a circle."""
        for dy in range(-r, r + 1):
            dx = int((r * r - dy * dy) ** 0.5)
            self.span(cx - dx, cx + dx, cy + dy, ink)

    def ring(self, cx, cy, r, ink=BLACK):
        """The outline of one, plotted twice over so neither axis leaves gaps."""
        for dy in range(-r, r + 1):
            dx = int((r * r - dy * dy) ** 0.5)
            self.dot(cx - dx, cy + dy, ink)
            self.dot(cx + dx, cy + dy, ink)
        for dx in range(-r, r + 1):
            dy = int((r * r - dx * dx) ** 0.5)
            self.dot(cx + dx, cy - dy, ink)
            self.dot(cx + dx, cy + dy, ink)

    def triangle(self, cx, cy, r, ink=BLACK):
        """A downward triangle inscribed in a circle of radius r, filled."""
        top = cy - r
        for i in range(2 * r):
            y = top + i
            # The width shrinks linearly to a point at the bottom.
            half = r - (i * r) // (2 * r)
            self.span(cx - half, cx + half, y, ink)

    def data(self):
        return base64.b64encode(bytes(self.px)).decode("ascii")


class Ball:
    """The ball, and where it is in its shake.

    Three states, told apart by the clock rather than by a flag: nothing running,
    shaking, and opening the window. Anything after that is the answer sitting
    still, which is when the app stops sending frames.
    """

    def __init__(self):
        self.answer = None
        self.asked = 0
        self.started = None

    def shake(self):
        # Never the same answer twice running: a fortune teller that repeats
        # itself reads as broken rather than as chance.
        choices = [a for a in ANSWERS if a != self.answer]
        self.answer = random.choice(choices)
        self.asked += 1
        self.started = time.monotonic()

    def elapsed(self):
        return 0.0 if self.started is None else time.monotonic() - self.started

    def moving(self):
        """Whether a frame is still worth sending."""
        return self.started is not None and self.elapsed() < SHAKE_S + OPEN_S

    def offset(self):
        """How far the ball is from home, this instant.

        A sine damped to nothing over the shake, so it comes to rest rather than
        stopping mid-swing, and a vertical wobble at twice the rate so it does not
        read as a slider.
        """
        t = self.elapsed()
        if self.started is None or t >= SHAKE_S:
            return 0, 0
        fade = 1.0 - t / SHAKE_S
        phase = 2 * math.pi * SHAKE_CYCLES * (t / SHAKE_S)
        return (
            round(SHAKE_PX * fade * math.sin(phase)),
            round(SHAKE_PX / 3 * fade * math.sin(2 * phase)),
        )

    def window_r(self):
        """The window's radius: nothing while shaking, then it opens."""
        t = self.elapsed()
        if self.started is None or t < SHAKE_S:
            return 0
        open_t = min(1.0, (t - SHAKE_S) / OPEN_S)
        # Eased out, so it arrives rather than stops.
        return max(1, round(WINDOW_R * (1 - (1 - open_t) ** 3)))

    def screen(self):
        canvas = Canvas()
        dx, dy = self.offset()
        cx, cy = BALL_X + dx, BALL_Y + dy
        canvas.disc(cx, cy, BALL_R)
        # A highlight, where the light would be, so the ball reads as a sphere
        # rather than as a hole. It stays put while the ball moves under it, which
        # is what a fixed light does.
        canvas.disc(BALL_X - BALL_R // 2, BALL_Y - BALL_R // 2, 7, WHITE)

        texts = []
        if self.answer is None:
            # At rest, never asked: the white spot with its 8, as on the toy.
            canvas.disc(cx, cy, 22, WHITE)
            canvas.ring(cx, cy, 22)
            texts.append(
                {"x": cx, "y": cy - 9, "text": "8", "align": "center",
                 "font": "row_active"}
            )
        else:
            radius = self.window_r()
            if radius > 0:
                canvas.triangle(cx, cy + 6, radius, WHITE)
            # The words wait for the window to be nearly open: text drawn into a
            # window this small would be black on black.
            if radius >= WINDOW_R - 4:
                lines = self.answer.split(" ")
                for i, line in enumerate(lines):
                    texts.append(
                        {"x": cx, "y": cy - 20 + i * 12, "text": line,
                         "align": "center", "font": "title"}
                    )

        asked = f"{self.asked} asked" if self.asked else "ask a question"
        texts.append({"x": 4, "y": 2, "text": asked, "font": "title"})

        return {
            "screen": {
                "type": "canvas",
                "data": canvas.data(),
                "text": texts,
                "buttons": ["Close", "", "", "", "Shake"],
            }
        }


class Keys:
    """Key events, read without a text buffer in the way.

    select(2) reports the descriptor, not Python's buffer. A readline that pulled
    two events out of one read left the second sitting in the buffer with nothing
    to wake the app, so it ran an event behind and then stopped responding: a Back
    was acted on by the next press, and by then the app had exited on it.

    Reading the descriptor and splitting on newlines keeps the two in step.
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


def send(ball):
    sys.stdout.write(json.dumps(ball.screen()) + "\n")
    sys.stdout.flush()


def main():
    ball = Ball()
    send(ball)

    keys = Keys()
    sel = selectors.DefaultSelector()
    sel.register(keys.fd, selectors.EVENT_READ)
    frame = 1.0 / FPS
    next_frame = time.monotonic()

    while True:
        # A key or the next frame, whichever comes first. With nothing running there
        # is no next frame, so the app blocks and costs nothing until it is asked
        # something.
        #
        # The test is "a shake is in progress", not "something is still moving": the
        # frame that ends a shake is the one that matters, and waiting for a key
        # before sending it left the ball mid-wobble on screen.
        running = ball.started is not None
        timeout = max(0.0, next_frame - time.monotonic()) if running else None
        if sel.select(timeout=timeout):
            events = keys.read()
            if events is None:
                return
            for event in events:
                # Releases are reported too, and acting on both would shake twice.
                if not event.get("down"):
                    continue
                key = event.get("key")
                if key in ("esc", "back"):
                    return
                if key in ("run", "ok"):
                    ball.shake()
                    next_frame = time.monotonic()

        if ball.started is not None and time.monotonic() >= next_frame:
            next_frame += frame
            settled = not ball.moving()
            send(ball)
            if settled:
                # That frame was the ball at rest with its window open, so there is
                # nothing left to draw until the next question.
                ball.started = None


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
