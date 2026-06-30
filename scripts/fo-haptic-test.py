#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0
"""
Haptic daemon for the Flipper One.

Opens the force-feedback (FF) input device ONCE and keeps it open for
the process lifetime, then plays library effects on demand: read one
command per line from stdin and play it.

Each line is:  <index> [duration_ms]
    <index>            play library effect <index> for its full waveform
    <index> <ms>       play it for <ms> milliseconds (2..255)
The fd stays open for the daemon's lifetime, so the kernel runs the
effect for the requested Replay length (full, or the given ms).

Run it once (e.g. at system start) and feed it lines:

    fo-haptic-test.py [/dev/input/eventN]     # device auto-detected if omitted
    # then, one command per line on stdin:
    5
    12 100

Requires python-evdev:  pip install evdev   (or: apt install python3-evdev)
"""
import ctypes
import sys

from evdev import InputDevice, list_devices, ecodes, ff


def find_ff_device():
    """First input device that advertises force-feedback (EV_FF)."""
    for path in list_devices():
        try:
            d = InputDevice(path)
        except OSError:
            continue
        if ecodes.EV_FF in d.capabilities():
            return d
        d.close()
    return None


def upload_library_effect(device, index, duration=0):
    """Upload an FF_PERIODIC/FF_CUSTOM effect whose custom_data is the
    single s16 library index. Replay length `duration` ms (0 = full
    library waveform). Returns the kernel-assigned effect id."""
    # Keep `custom` referenced until upload_effect() returns — the
    # kernel reads custom_data during the upload ioctl.
    custom = (ctypes.c_int16 * 1)(index)
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
        ff.Replay(duration, 0),             # length ms (0 = full waveform)
        ff.EffectType(ff_periodic_effect=periodic),
    )
    return device.upload_effect(effect)


def main():
    args = sys.argv[1:]
    if args:
        device = InputDevice(args[0])
    else:
        device = find_ff_device()
        if device is None:
            sys.exit("no FF-capable input device found")

    print("haptic daemon ready on %s (phys %s)" % (device.path, device.phys),
          flush=True)

    last_id = None
    try:
        while True:
            line = sys.stdin.readline()
            if not line:                    # EOF — stdin closed -> exit
                break
            parts = line.split()
            if not parts:
                continue
            try:
                index = int(parts[0])
                duration = int(parts[1]) if len(parts) > 1 else 0
            except ValueError:
                continue
            try:
                # One effect slot at a time: erase the previous (also
                # stops it if still running), then upload + play the new.
                if last_id is not None:
                    device.erase_effect(last_id)
                    last_id = None
                last_id = upload_library_effect(device, index, duration)
                device.write(ecodes.EV_FF, last_id, 1)   # value != 0 -> start
            except OSError as e:
                print("play #%d failed: %s" % (index, e), file=sys.stderr, flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        if last_id is not None:
            try:
                device.erase_effect(last_id)
            except Exception:
                pass
        device.close()


if __name__ == "__main__":
    main()
