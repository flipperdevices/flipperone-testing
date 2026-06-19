#!/usr/bin/env python3
"""Inject synthetic key presses to a uinput keyboard on seat0.

A persistent "typer": creates ONE virtual keyboard, then reads key
specs line-by-line from stdin and taps them. Used by the TV Media Box
on-screen emulator keyboard — each on-screen key the user selects is
sent here and emitted to the system, so Kodi receives real keystrokes.

Line format (one spec per line):
    KEY_A            tap KEY_A
    shift KEY_A      tap KEY_A with Left-Shift held (uppercase 'A')
    KEY_SPACE | KEY_ENTER | KEY_BACKSPACE | KEY_0 ...

Unknown / non-KEY_ names are ignored. Exits on EOF (stdin closed),
which is how the server stops it when the keyboard view closes.
"""
import sys
import time
from evdev import UInput, ecodes


def build_caps():
    """Keys the virtual keyboard advertises: letters, digits, space,
    enter, backspace, the shift modifier, and the US-layout punctuation
    keys (whose shifted forms give the symbol set)."""
    keys = [ecodes.KEY_LEFTSHIFT, ecodes.KEY_SPACE,
            ecodes.KEY_ENTER, ecodes.KEY_BACKSPACE]
    for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        keys.append(getattr(ecodes, "KEY_" + c))
    for d in "0123456789":
        keys.append(getattr(ecodes, "KEY_" + d))
    # Punctuation keys; shifted = the symbol row (!@#... {}|:"~<>?+_).
    for name in ("KEY_MINUS", "KEY_EQUAL", "KEY_LEFTBRACE", "KEY_RIGHTBRACE",
                 "KEY_BACKSLASH", "KEY_SEMICOLON", "KEY_APOSTROPHE",
                 "KEY_GRAVE", "KEY_COMMA", "KEY_DOT", "KEY_SLASH"):
        keys.append(getattr(ecodes, name))
    return keys


def tap(ui, code, shift=False):
    if shift:
        ui.write(ecodes.EV_KEY, ecodes.KEY_LEFTSHIFT, 1)
        ui.syn()
    ui.write(ecodes.EV_KEY, code, 1)
    ui.syn()
    ui.write(ecodes.EV_KEY, code, 0)
    ui.syn()
    if shift:
        ui.write(ecodes.EV_KEY, ecodes.KEY_LEFTSHIFT, 0)
        ui.syn()


def main():
    ui = UInput({ecodes.EV_KEY: build_caps()}, name="flipper-type")
    # Give the compositor a moment to enumerate the new device,
    # otherwise the very first keystroke can be dropped.
    time.sleep(0.3)
    print("flipper-type uinput ready", flush=True)

    try:
        while True:
            line = sys.stdin.readline()
            if not line:                 # EOF — stdin closed -> exit
                break
            parts = line.split()
            if not parts:
                continue
            shift = False
            if parts[0] == "shift":
                shift = True
                parts = parts[1:]
            if not parts:
                continue
            name = parts[0]
            if not name.startswith("KEY_"):
                continue
            code = getattr(ecodes, name, None)
            if code is None:
                continue
            tap(ui, code, shift)
    except KeyboardInterrupt:
        pass
    finally:
        ui.close()


if __name__ == "__main__":
    main()
