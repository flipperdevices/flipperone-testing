#!/usr/bin/env python3
"""
Hand the Flipper One Power button to Linux, or back to the MCU
(RP2350, I2C slave 0x69).

Usage (needs root for /dev/i2c-N):
    mcu-power-key.py [--bus N] get   -> JSON {ok, bus, control, to_cpu}
    mcu-power-key.py [--bus N] on    -> Power goes to Linux as a key press
    mcu-power-key.py [--bus N] off   -> Power opens the MCU's own menu again

Register 0x0210 "Input control", bit 0 = POWER_TO_CPU. While it is set
the MCU skips its Power menu and the press reaches Linux through the
kernel's "Flipper One Buttons" input device (read it from evdev, never
from the MCU's interrupt register 0x0100 — the driver owns that). The
MCU clears the register on every CPU reset, so an app that wants the
button sets it after each boot, and clears it when it lets go.

Old firmware without this register reads back garbage (both bytes
equal, not 0x0000) instead of 0x0000 / 0x0001.

Wire format and bus lookup are the same as mcu-backlight.py (its
helpers are loaded from the file next to this one).

Output: one JSON line on stdout. Exit code 0 on success, 1 on error.
"""
import importlib.util
import json
import os
import sys

REG_INPUT_CONTROL = 0x0210
POWER_TO_CPU = 0x0001


def _load_mcu():
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location(
        'mcu_backlight', os.path.join(here, 'mcu-backlight.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def state(mcu, bus):
    control = mcu.read_regs(bus, REG_INPUT_CONTROL, 1)[0]
    return {'ok': True, 'bus': bus, 'control': control,
            'to_cpu': bool(control & POWER_TO_CPU)}


def main(argv):
    args = list(argv)
    mcu = _load_mcu()
    bus = None
    if len(args) >= 2 and args[0] == '--bus':
        bus = int(args[1])
        args = args[2:]
    if not args:
        raise ValueError('missing command')
    cmd = args[0]
    if bus is None:
        bus = mcu.find_bus()

    if cmd == 'on':
        mcu.write_reg(bus, REG_INPUT_CONTROL, POWER_TO_CPU)
    elif cmd == 'off':
        mcu.write_reg(bus, REG_INPUT_CONTROL, 0)
    elif cmd != 'get':
        raise ValueError('unknown command: ' + cmd)
    return state(mcu, bus)


if __name__ == '__main__':
    try:
        print(json.dumps(main(sys.argv[1:])))
    except Exception as e:  # noqa: BLE001 - report every failure as JSON
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)
