#!/usr/bin/env python3
"""flipctl's layout, in a terminal.

A console app is handed a character grid rather than a panel, so it cannot use any
of flipctl's components. It can keep the shape though, and that is what this does:
the inverted status bar across the top, a list whose selected row is inverted and
carries `<` `>` when it holds a value, dividers between groups, and the five soft
keys in their slots along the bottom, with the leftmost flush left, the next three
in the middle and the last flush right.

The numbers here are the same ones tokens.toml holds, converted from pixels to
characters: the panel's 5-slot soft bar becomes five labels on the bottom row, and
a 20px menu row becomes one line. Where a cell cannot express something, this drops
it rather than approximating: there are no rounded corners in a terminal and no
shadow under the selector.

Keys: the pad moves and adjusts, OK presses the highlighted soft key. Leaving is
Esc, which flipctl handles: a console app never sees it.
"""
import curses
import time

# The five soft-key slots, as flipctl arranges them: one flush left, three
# centred, one flush right. Empty means the slot is drawn but does nothing, which
# is what the panel does too.
BUTTONS = ["Close", "Reset", "Info", "", "Apply"]

ROWS = [
    {"label": "Wi-Fi", "values": ["Off", "On"], "at": 1},
    {"label": "Hostname", "values": ["flipperone"], "at": 0},
    {"label": "Brightness", "values": ["25%", "50%", "75%", "100%"], "at": 1},
    {"divider": True},
    {"label": "Sound", "values": ["Off", "On"], "at": 1},
    {"label": "Haptics", "values": ["Off", "Low", "High"], "at": 2},
    {"label": "Airplane mode", "values": ["Off", "On"], "at": 0},
]


def rows():
    return [r for r in ROWS if "label" in r]


class Screen:
    """The whole thing, drawn from scratch each time something changes.

    Redrawn whole rather than patched, for the same reason flipctl sends a scene
    rather than a diff: there is no state to get out of step, and a screen this
    size costs nothing to write.
    """

    def __init__(self, window):
        self.window = window
        self.selected = 0
        self.pressed = None
        self.pressed_at = 0.0
        self.message = ""

    def draw(self):
        self.window.erase()
        height, width = self.window.getmaxyx()
        self.status_bar(width)
        self.list(width, height)
        self.soft_bar(width, height)
        self.window.refresh()

    def status_bar(self, width):
        """Inverted across the full width, name on the left, clock on the right."""
        clock = time.strftime("%H:%M")
        left = " TUI Demo"
        gap = max(1, width - len(left) - len(clock) - 1)
        line = f"{left}{' ' * gap}{clock} "[:width]
        self.window.addstr(0, 0, line, curses.A_REVERSE)

    def list(self, width, height):
        """One line a row, with the selected one inverted and adjustable."""
        y = 2
        for row in ROWS:
            if y >= height - 2:
                break
            if row.get("divider"):
                # A rule, where the panel draws a 1px divider.
                self.window.addstr(y, 1, "-" * (width - 2), curses.A_DIM)
                y += 1
                continue
            index = rows().index(row)
            value = row["values"][row["at"]]
            chosen = index == self.selected
            if chosen:
                # The selector: inverted for the width of the row, with the
                # chevrons only where there is something to step through, and only
                # on the side that has somewhere to go.
                left = "<" if row["at"] > 0 else " "
                right = ">" if row["at"] < len(row["values"]) - 1 else " "
                if len(row["values"]) == 1:
                    left = right = " "
                text = f" {row['label']}"
                slot = f"{left} {value} {right}"
                pad = max(1, width - len(text) - len(slot) - 1)
                self.window.addstr(y, 0, f"{text}{' ' * pad}{slot}"[:width],
                                   curses.A_REVERSE)
            else:
                self.window.addstr(y, 1, row["label"][:width - 2])
                self.window.addstr(y, max(0, width - len(value) - 1), value)
            y += 1

        if self.message:
            self.window.addstr(height - 3, 1, self.message[:width - 2], curses.A_DIM)

    def soft_bar(self, width, height):
        """Five labels on the bottom row, in the panel's own slot layout."""
        row = height - 1
        labels = [f"[{b}]" if b else "" for b in BUTTONS]
        # Slot 0 flush left and slot 4 flush right, the middle three spread across
        # what is left, which is what SoftBar does in pixels.
        middle = labels[1:4]
        spare = width - len(labels[0]) - len(labels[4])
        step = max(1, spare // 3)
        columns = [0]
        for i in range(3):
            columns.append(len(labels[0]) + i * step + max(0, (step - len(middle[i])) // 2))
        columns.append(max(0, width - len(labels[4])))
        for slot, (label, column) in enumerate(zip(labels, columns)):
            if not label:
                continue
            flash = self.pressed == slot and time.monotonic() - self.pressed_at < 0.15
            self.window.addstr(row, min(column, max(0, width - len(label))), label,
                               curses.A_REVERSE if flash else curses.A_NORMAL)

    def press(self, slot):
        """Flash a soft key and act on it."""
        self.pressed = slot
        self.pressed_at = time.monotonic()
        label = BUTTONS[slot]
        if label == "Reset":
            for row in rows():
                row["at"] = 0
            self.message = "reset"
        elif label == "Info":
            self.message = f"{len(rows())} rows, pad adjusts, Esc leaves"
        elif label == "Apply":
            self.message = ", ".join(
                f"{r['label']}={r['values'][r['at']]}" for r in rows()[:2]
            )
        elif label == "Close":
            self.message = "Esc leaves: Close is flipctl's, not mine"

    def key(self, key):
        picked = rows()
        if key in (curses.KEY_DOWN, ord("j")):
            self.selected = (self.selected + 1) % len(picked)
        elif key in (curses.KEY_UP, ord("k")):
            self.selected = (self.selected - 1) % len(picked)
        elif key in (curses.KEY_RIGHT, ord("l")):
            row = picked[self.selected]
            row["at"] = min(row["at"] + 1, len(row["values"]) - 1)
        elif key in (curses.KEY_LEFT, ord("h")):
            row = picked[self.selected]
            row["at"] = max(row["at"] - 1, 0)
        elif key in (curses.KEY_ENTER, 10, 13):
            # The pad's centre presses the rightmost soft key, as OK does on the
            # panel when a screen has an action.
            self.press(4)


def main(window):
    curses.curs_set(0)
    window.nodelay(True)
    screen = Screen(window)
    while True:
        screen.draw()
        # A tenth of a second: enough for the press flash to come and go, and for
        # the clock to look live, without spinning.
        time.sleep(0.1)
        key = window.getch()
        if key != -1:
            screen.key(key)


if __name__ == "__main__":
    curses.wrapper(main)
