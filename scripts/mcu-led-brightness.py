#!/usr/bin/env python3
"""
Wattmeter (power meter) LED group brightness of the Flipper One, through
the MCU (RP2350, I2C slave 0x69). Stock firmware register, unlike the
per-LED colour registers mcu-leds.py writes.

Usage (needs root for /dev/i2c-N):
    mcu-led-brightness.py [--bus N] get          -> JSON {ok, bus, level}
    mcu-led-brightness.py [--bus N] set <0..255> -> write the level (0 = dark)

Register (flipperone-mcu-firmware, i2c_registers_map.h):
    0x0304  wattmeter LED group brightness, 0..255 in the low byte

The MCU saves the level to its flash on every write, so clients must
debounce and send only the final value. 0 keeps every wattmeter LED
dark, also after a reboot, until a non-zero level is written (here or
in the MCU's Settings → LEDs).

Wire format and bus lookup are the same as mcu-backlight.py (its
helpers are loaded from the file next to this one).

Output: one JSON line on stdout. Exit code 0 on success, 1 on error.
"""
import importlib.util
import json
import os
import sys

REG_WATTMETER_BRIGHTNESS = 0x0304


def _load_mcu():
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location(
        'mcu_backlight', os.path.join(here, 'mcu-backlight.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def state(mcu, bus):
    level = mcu.read_regs(bus, REG_WATTMETER_BRIGHTNESS, 1)[0] & 0xFF
    return {'ok': True, 'bus': bus, 'level': level}


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

    if cmd == 'set':
        if len(args) < 2:
            raise ValueError('missing level')
        level = int(args[1])
        if not 0 <= level <= 255:
            raise ValueError('level must be 0..255')
        mcu.write_reg(bus, REG_WATTMETER_BRIGHTNESS, level)
    elif cmd != 'get':
        raise ValueError('unknown command: ' + cmd)
    return state(mcu, bus)


if __name__ == '__main__':
    try:
        print(json.dumps(main(sys.argv[1:])))
    except Exception as e:  # noqa: BLE001 - report every failure as JSON
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)
