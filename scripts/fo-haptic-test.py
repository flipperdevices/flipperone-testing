#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0
"""
Minimal tester for the Flipper One haptic driver.

Uploads an FF_PERIODIC/FF_CUSTOM effect whose custom_data carries a single
s16 library effect index, then plays it.

Usage:
    fo-haptic-test.py /dev/input/eventN <effect_id> [duration_ms]

    duration_ms: 0 or 1  -> play the full library waveform
                 2..255  -> play for that many milliseconds
    (defaults to 0 if omitted)

Requires python-evdev (https://python-evdev.readthedocs.io/):
    pip install evdev      # or: apt install python3-evdev
"""
import ctypes
import sys

from evdev import InputDevice, ecodes, ff


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: %s /dev/input/eventN <effect_id> [duration_ms]"
                 % sys.argv[0])

    dev = sys.argv[1]
    effect_id = int(sys.argv[2])
    duration = int(sys.argv[3]) if len(sys.argv) > 3 else 0

    device = InputDevice(dev)

    # The driver expects custom_data = one s16: the library index.
    # Keep a reference to the array so it stays alive while the kernel
    # reads it during upload_effect().
    custom = (ctypes.c_int16 * 1)(effect_id)

    periodic = ff.Periodic(
        waveform=ecodes.FF_CUSTOM,
        period=0, magnitude=0, offset=0, phase=0,
        envelope=ff.Envelope(0, 0, 0, 0),
        custom_len=1,
        custom_data=ctypes.cast(custom, ctypes.POINTER(ctypes.c_int16)),
    )

    effect = ff.Effect(
        ecodes.FF_PERIODIC, -1, 0,          # type, id (-1 = kernel assigns)
        ff.Trigger(0, 0),
        ff.Replay(duration, 0),             # length (ms; 0/1 = full), delay
        ff.EffectType(ff_periodic_effect=periodic),
    )

    try:
        ff_id = device.upload_effect(effect)
    except OSError as e:
        sys.exit("upload_effect failed: %s" % e)

    print("Uploaded effect id=%d (library #%d, duration=%u ms)"
          % (ff_id, effect_id, duration))

    device.write(ecodes.EV_FF, ff_id, 1)    # value != 0 -> start
    print("Playing... press Enter to stop and exit")
    try:
        input()
    except (EOFError, KeyboardInterrupt):
        print()

    try:
        device.write(ecodes.EV_FF, ff_id, 0)  # value == 0 -> stop
        device.erase_effect(ff_id)
    except OSError as e:
        print("cleanup failed: %s" % e, file=sys.stderr)


if __name__ == "__main__":
    main()
