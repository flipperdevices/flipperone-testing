#!/usr/bin/env python3
"""Forward ONLY the Flipper One d-pad + OK + Back keys to a uinput
clone on seat0. A filtered copy of forward-keys.py: same phys match
and passthrough, but every event that isn't one of the six allowed
navigation keys is dropped.

Used by the TV Media Box "Kodi remote" and "Adjust screen" popups,
where the d-pad / OK / Back must reach Kodi but the other keypad
keys (Tab, Esc, the app-button letters, …) must NOT.

Modes:
    python3 forward-remote.py            # filter + forward
    python3 forward-remote.py grab       # …and grab the source device
    python3 forward-remote.py debug      # print each key code, forward nothing

`debug` is the way to confirm the real hardware codes: run it, press
each button, and copy the reported codes into ALLOW_NAMES below if
they differ from these defaults.
"""
import sys
from evdev import InputDevice, UInput, list_devices, ecodes, categorize

WANT_PHYS = "flipper-one-input/input0"   # Flipper One keypad

# The only keys we forward: d-pad + OK (Enter) + Back. Anything not
# resolvable on this evdev build is skipped. Edit via `debug` mode if
# the hardware reports different codes.
ALLOW_NAMES = [
    "KEY_UP", "KEY_DOWN", "KEY_LEFT", "KEY_RIGHT",   # d-pad   103/108/105/106
    "KEY_ENTER",                                     # OK      28
    "KEY_BACKSPACE",                                 # Back    14
]
ALLOW = {getattr(ecodes, n) for n in ALLOW_NAMES if hasattr(ecodes, n)}


def find_by_phys(want):
    for path in list_devices():
        try:
            dev = InputDevice(path)
        except OSError:
            continue
        if dev.phys == want:
            return dev
        dev.close()
    return None


def run_debug(src):
    print(f"debug: {src.path} (phys {src.phys}) — press keys, Ctrl-C to quit")
    try:
        for ev in src.read_loop():
            if ev.type == ecodes.EV_KEY:
                k = categorize(ev)
                print(f"  code={ev.code:<4} {k.keycode}  value={ev.value}")
    except KeyboardInterrupt:
        pass
    finally:
        src.close()


def main():
    args = sys.argv[1:]
    grab  = "grab" in args
    debug = "debug" in args
    phys = next((a for a in args if a not in ("grab", "debug")), WANT_PHYS)

    src = find_by_phys(phys)
    if src is None:
        sys.exit(f"no input device with phys '{phys}'")

    if debug:
        run_debug(src)
        return

    # Virtual device advertises ONLY the allowed keys, so seat0 sees a
    # tidy 6-key remote rather than a full keyboard clone.
    ui = UInput({ecodes.EV_KEY: sorted(ALLOW)}, name="flipper-remote",
                vendor=src.info.vendor, product=src.info.product,
                version=src.info.version, bustype=src.info.bustype)
    print(f"forwarding {src.path} (phys {src.phys}) -> seat0 "
          f"[remote: {','.join(ALLOW_NAMES)}]" + (" [grabbed]" if grab else ""))

    if grab:
        src.grab()
    try:
        for ev in src.read_loop():
            if ev.type == ecodes.EV_SYN:
                ui.write_event(ev)                  # keep frame boundaries
            elif ev.type == ecodes.EV_KEY and ev.code in ALLOW:
                ui.write_event(ev)                  # allowed nav key
            # everything else (Esc, Tab, letters, MSC scan, …) is dropped
    except KeyboardInterrupt:
        pass
    finally:
        if grab:
            try:
                src.ungrab()
            except Exception:
                pass
        ui.close()
        src.close()


if __name__ == "__main__":
    main()
