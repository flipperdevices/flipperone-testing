#!/usr/bin/env python3
"""Forward an evdev device (matched by phys) to a uinput clone on seat0."""
import sys
from evdev import InputDevice, UInput, list_devices

WANT_PHYS = "flipper-one-input/input0"

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

def main():
    args = sys.argv[1:]
    grab = "grab" in args
    phys = next((a for a in args if a != "grab"), WANT_PHYS)

    src = find_by_phys(phys)
    if src is None:
        sys.exit(f"no input device with phys '{phys}'")

    ui = UInput.from_device(src, name="flipper-forward")   # clone caps -> seat0
    print(f"forwarding {src.path} (phys {src.phys}) -> seat0"
          + (" [grabbed]" if grab else ""))

    if grab:
        src.grab()
    try:
        for ev in src.read_loop():
            ui.write_event(ev)          # pass each event straight through (SYN included)
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
