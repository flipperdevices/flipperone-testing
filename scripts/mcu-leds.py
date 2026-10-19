#!/usr/bin/env python3
"""
Power / wattmeter LEDs of the Flipper One through the MCU (RP2350,
I2C slave 0x69).

Usage (needs root for /dev/i2c-N):
    mcu-leds.py [--bus N] get                 -> JSON {ok, bus, leds: {name: rgb565}}
    mcu-leds.py [--bus N] set NAME=VALUE ...  -> write RGB565 colours (0 = off)
    mcu-leds.py [--bus N] off                 -> every wattmeter LED off (not power)

VALUE is RGB565 in decimal or 0x hex: red 0xF800, green 0x07E0,
blue 0x001F, white 0xFFFF.

Registers (one 16-bit RGB565 colour each):
    0x0320 power          0x032C usb_charging
    0x0322 bat_outline    0x032E usb_watt1
    0x0324 bat_watt1      0x0330 usb_watt2
    0x0326 bat_watt2      0x0332 usb_watt3
    0x0328 bat_watt3      0x0334 usb_watt4
    0x032A bat_watt4      0x0336 bat_center

Brightness lives in 0x0302 (power) / 0x0304 (wattmeter) and is saved
to the MCU's flash, so this script never touches it.

Wire format and bus lookup are the same as mcu-backlight.py (its
helpers are loaded from the file next to this one): 2-byte register
address big-endian, value little-endian, all four bytes in one message.
The MCU (bus 0, 0-0069) is bound by the flipper-one-mcu driver, whose
regmap treats these registers as read-only and has no LED class for
them, so raw I2C is the only way in. I2C_RDWR does not claim the
address, so it works next to the driver (what `i2ctransfer -f` does).
A written colour stays until the next write or an MCU reset; the
MCU's Settings → LEDs preset overwrites it.

Output: one JSON line on stdout. Exit code 0 on success, 1 on error.
"""
import importlib.util
import json
import os
import sys

LEDS = {
    'power':        0x0320,
    'bat_outline':  0x0322,
    'bat_watt1':    0x0324,
    'bat_watt2':    0x0326,
    'bat_watt3':    0x0328,
    'bat_watt4':    0x032A,
    'usb_charging': 0x032C,
    'usb_watt1':    0x032E,
    'usb_watt2':    0x0330,
    'usb_watt3':    0x0332,
    'usb_watt4':    0x0334,
    'bat_center':   0x0336,
}
FIRST_REG = 0x0320
COUNT = len(LEDS)


def _load_mcu():
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location(
        'mcu_backlight', os.path.join(here, 'mcu-backlight.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def state(mcu, bus):
    values = mcu.read_regs(bus, FIRST_REG, COUNT)
    leds = {}
    for name, reg in LEDS.items():
        leds[name] = values[(reg - FIRST_REG) // 2]
    return {'ok': True, 'bus': bus, 'leds': leds}


def parse_pairs(args):
    pairs = []
    for arg in args:
        name, sep, value = arg.partition('=')
        if not sep or name not in LEDS:
            raise ValueError('expected NAME=VALUE with a known LED name: ' + arg)
        v = int(value, 0)
        if not 0 <= v <= 0xFFFF:
            raise ValueError('RGB565 value out of range: ' + arg)
        pairs.append((name, v))
    return pairs


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

    if cmd == 'get':
        return state(mcu, bus)
    if cmd == 'set':
        pairs = parse_pairs(args[1:])
    elif cmd == 'off':
        pairs = [(name, 0) for name in LEDS if name != 'power']
    else:
        raise ValueError('unknown command: ' + cmd)
    for name, v in pairs:
        mcu.write_reg(bus, LEDS[name], v)
    return {'ok': True, 'bus': bus, 'written': dict(pairs)}


if __name__ == '__main__':
    try:
        print(json.dumps(main(sys.argv[1:])))
    except Exception as e:  # noqa: BLE001 - report every failure as JSON
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)
