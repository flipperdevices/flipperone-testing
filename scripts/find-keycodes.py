#!/usr/bin/env python3
"""Discover Flipper One keypad evdev keycodes.

Lists every input device, then reads them ALL at once and prints the
code + KEY_* name of each button press. Press a button and read off
its code — no need to know which device is the keypad up front.

    sudo python3 find-keycodes.py          # watch all devices live
    sudo python3 find-keycodes.py list     # just list devices and exit

Use the printed phys to fix WANT_PHYS, and the code names to fix
ALLOW_NAMES, in forward-remote.py.
"""
import sys
import selectors
from evdev import InputDevice, list_devices, ecodes, categorize


def open_all():
    devs = []
    for path in list_devices():
        try:
            devs.append(InputDevice(path))
        except OSError:
            pass            # no permission / busy — skip
    return devs


def keyname(ev):
    """Human name(s) for a key event's code, e.g. 'KEY_UP'."""
    try:
        kc = categorize(ev).keycode
    except Exception:
        return f"code {ev.code}"
    if isinstance(kc, (list, tuple)):
        return "/".join(kc)
    return kc


def main():
    args = sys.argv[1:]
    devs = open_all()
    if not devs:
        sys.exit("no input devices found (run with sudo?)")

    print("== input devices ==")
    for d in devs:
        print(f"  {d.path:<20} phys={d.phys!r:<30} name={d.name!r}")
    print()

    if "list" in args:
        for d in devs:
            d.close()
        return

    print("Press keypad buttons (Ctrl-C to quit). Showing presses only:\n")
    sel = selectors.DefaultSelector()
    for d in devs:
        sel.register(d, selectors.EVENT_READ)

    try:
        while True:
            for key, _ in sel.select():
                dev = key.fileobj
                try:
                    events = list(dev.read())
                except OSError:
                    continue
                for ev in events:
                    # value 1 = press (ignore 0 release / 2 autorepeat)
                    if ev.type == ecodes.EV_KEY and ev.value == 1:
                        src = dev.phys or dev.path
                        print(f"  {src:<28} code={ev.code:<4} {keyname(ev)}")
    except KeyboardInterrupt:
        pass
    finally:
        for d in devs:
            d.close()


if __name__ == "__main__":
    main()
