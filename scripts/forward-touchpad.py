#!/usr/bin/env python3
"""Forward the Flipper One Touchpad (matched by phys) to a uinput clone on seat0.
Copies all capabilities + input properties so tap/scroll work."""
import sys
from evdev import InputDevice, UInput, list_devices, ecodes

WANT_PHYS = "flipper-one-input/input1"   # Flipper One Touchpad

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

def clone(src, name):
    caps = src.capabilities()
    caps.pop(ecodes.EV_SYN, None)   # UInput generates SYN itself
    caps.pop(ecodes.EV_FF, None)    # force-feedback can't be forwarded
    base = dict(name=name, vendor=src.info.vendor, product=src.info.product,
                version=src.info.version, bustype=src.info.bustype)
    try:
        props = src.input_props() or None
    except Exception:
        props = None
    try:
        return UInput(caps, input_props=props, **base)   # newer python-evdev
    except TypeError:
        return UInput(caps, **base)                       # older: no props kwarg

def main():
    args = sys.argv[1:]
    grab = "grab" in args
    phys = next((a for a in args if a != "grab"), WANT_PHYS)

    src = find_by_phys(phys)
    if src is None:
        sys.exit(f"no input device with phys '{phys}'")

    ui = clone(src, "forward-" + src.name.replace(" ", "-").lower())
    print(f"forwarding {src.path} ({src.name}, phys {src.phys}) -> seat0"
          + (" [grabbed]" if grab else ""))

    if grab:
        src.grab()
    try:
        for ev in src.read_loop():
            ui.write_event(ev)          # pass everything through (ABS, MT, KEY, SYN)
    except KeyboardInterrupt:
        pass
    finally:
        if grab:
            try: src.ungrab()
            except Exception: pass
        ui.close()
        src.close()

if __name__ == "__main__":
    main()
