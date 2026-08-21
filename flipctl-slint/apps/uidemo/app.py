#!/usr/bin/env python3
"""Every UI element an app can ask for, as a scrolling list.

This is the reference for what the scene vocabulary actually offers, kept as a
running app rather than a document so it cannot drift from the renderer: if an
element is listed here and does not draw, the demo shows it.

Each row names an element and shows it in the value column, which is the only
place a form row can render one. Select a row and press OK to open a screen
devoted to that element, where its behaviour is described in full.

Protocol, newline-delimited JSON on stdin and stdout:

    app -> flipctl   {"screen": {...}}
    flipctl -> app   {"key": "down", "down": true}

    {"type": "form", "title", "rows": [{"label", "value"}], "selected", "buttons"}
    {"type": "log",  "title", "lines": [...], "total", "offset", "buttons"}
"""
import json
import sys

APP_NAME = "UI Demo"

# Rows the list shows at once. flipctl clips to what fits regardless; knowing the
# number lets the app send a window and report where it sits so a scrollbar can be
# drawn.
WINDOW = 5

# Lines a log screen shows.
LOG_WINDOW = 8

# The vocabulary. Each entry is the element's name, a sample rendered in the value
# column, and the detail screen's text.
#
# `value` is deliberately the same mechanism every row uses: a form row is a label
# and a value, and every element below is a way of filling that value. That is the
# whole surface an app has today, which is worth being blunt about.
ELEMENTS = [
    ("Text", "plain", [
        "A value is drawn as text.",
        "Busy9px when the row is not",
        "selected, Born2bSportyV2 when",
        "it is. The label swaps too.",
        "",
        "8 characters is the budget for",
        "a soft-key label; a value can",
        "be wider.",
    ]),
    ("Number", "42", [
        "Nothing special: a number is",
        "text. The app formats it.",
        "",
        "Beware digit widths. In",
        "HaxrCorp 4090 the digit 1 is",
        "3px wide and every other digit",
        "is 6, so a changing number",
        "changes width. Never position",
        "anything from a measured value.",
    ]),
    ("Toggle", "< ON >", [
        "A toggle is a value with",
        "chevrons, adjusted with left",
        "and right.",
        "",
        "The chevrons are the",
        "prototype's convention for",
        "'this row has more than one",
        "state'.",
    ]),
    ("Choice", "1.1.1.1", [
        "A value cycled through a list",
        "with left and right.",
        "",
        "The Ping app uses this for its",
        "host field. The app owns the",
        "list and the wrapping.",
    ]),
    ("Range", "56 px", [
        "A number with a step, a minimum",
        "and a maximum, adjusted with",
        "left and right.",
        "",
        "Clamping is the app's job: the",
        "renderer draws whatever string",
        "it is handed.",
    ]),
    ("Selection", "row 6 of 8", [
        "The selected row is drawn with",
        "the selector frame: a 45 degree",
        "corner and a drop shadow one",
        "pixel outside it.",
        "",
        "Up and down move it. It wraps",
        "at both ends.",
    ]),
    ("Scrollbar", "auto", [
        "Appears when there are more",
        "rows than fit, and only then.",
        "",
        "A dotted 1px track with a 3px",
        "thumb, height",
        "max(5, range * shown / total).",
        "",
        "This list has more rows than",
        "the five that fit, so you are",
        "looking at one.",
    ]),
    ("Soft keys", "5 slots", [
        "Five labels, one per physical",
        "key: esc view power edit run.",
        "",
        "Slot order is the silkscreen",
        "order, so a label always sits",
        "over the key that triggers it.",
        "An empty label draws no button.",
        "",
        "Pressed inverts: black fill,",
        "white text.",
    ]),
    ("Log", "8 lines", [
        "A scrolling text body, 12px",
        "lines, for output that arrives",
        "over time.",
        "",
        "The app keeps the buffer and",
        "sends a window plus its offset,",
        "so a long run costs one screen",
        "per frame rather than its whole",
        "history.",
        "",
        "Up and down scroll a line,",
        "left and right a page. Reaching",
        "the bottom resumes following",
        "new output.",
    ]),
    ("Status bar", "system", [
        "Not an app element: flipctl",
        "owns it and draws it on every",
        "screen.",
        "",
        "Battery, charging bolt, wifi,",
        "ethernet and the cellular block",
        "come from sysfs, not from the",
        "app.",
    ]),
    ("Title", "this screen", [
        "One line above the body,",
        "supplied by the scene.",
        "",
        "A form draws it as the screen's",
        "heading; a log draws it above",
        "the rule.",
    ]),
    ("Not yet", "canvas, icon", [
        "Two things the plan has and the",
        "protocol does not.",
        "",
        "Icon: rows reserve the 14px",
        "column but an app cannot name",
        "an icon yet.",
        "",
        "Canvas: raw pixels for",
        "waveforms, spectra and games.",
        "Needs shared memory rather than",
        "JSON, so it waits for the CBOR",
        "transport.",
    ]),
]


def emit(scene):
    sys.stdout.write(json.dumps({"screen": scene}) + "\n")
    sys.stdout.flush()


class App:
    def __init__(self):
        self.selected = 0
        self.offset = 0
        # None on the list, otherwise the index of the element being shown.
        self.detail = None

    def list_screen(self):
        # Keep the selection inside the window.
        if self.selected < self.offset:
            self.offset = self.selected
        elif self.selected >= self.offset + WINDOW:
            self.offset = self.selected - WINDOW + 1

        emit({
            "type": "form",
            "title": "UI Demo",
            "rows": [
                {"label": name, "value": value}
                for name, value, _ in ELEMENTS[self.offset:self.offset + WINDOW]
            ],
            # The renderer indexes rows within the window it was sent.
            "selected": self.selected - self.offset,
            "total": len(ELEMENTS),
            "offset": self.offset,
            "buttons": ["Close", "", "", "", "Open"],
        })

    def detail_screen(self):
        name, value, lines = ELEMENTS[self.detail]
        emit({
            "type": "log",
            "title": f"{name}: {value}",
            "lines": lines[:LOG_WINDOW],
            "total": len(lines),
            "offset": 0,
            "buttons": ["Close", "", "", "", ""],
        })


def main():
    app = App()
    app.list_screen()

    for raw in sys.stdin:
        try:
            msg = json.loads(raw)
        except ValueError:
            continue
        if not msg.get("down"):
            continue
        key = msg.get("key")

        if app.detail is not None:
            # Any way out returns to the list; the detail screen has no state.
            if key in ("esc", "back", "ok", "left"):
                app.detail = None
                app.list_screen()
            continue

        if key == "down":
            app.selected = (app.selected + 1) % len(ELEMENTS)
            app.list_screen()
        elif key == "up":
            app.selected = (app.selected - 1) % len(ELEMENTS)
            app.list_screen()
        elif key in ("ok", "run", "right"):
            app.detail = app.selected
            app.detail_screen()
        elif key in ("esc", "back"):
            return


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
