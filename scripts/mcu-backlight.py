#!/usr/bin/env python3
"""
LCD backlight control through the Flipper One MCU (RP2350, I2C slave 0x69).

Usage (needs root for /dev/i2c-N):
    mcu-backlight.py [--bus N] get              -> JSON {bus, level, timeout, control}
    mcu-backlight.py [--bus N] off              -> backlight off now (clears always-on)
    mcu-backlight.py [--bus N] on               -> on at saved level, MCU idle timer restarts
    mcu-backlight.py [--bus N] always-on        -> on, MCU idle timer ignored
    mcu-backlight.py [--bus N] level <1..255>   -> brightness (saved to MCU flash)
    mcu-backlight.py [--bus N] timeout <0..65535> -> auto-off in 100 ms steps, 0 = never
                                                   (saved to MCU flash)

Registers (flipperone-mcu-firmware, i2c_registers_map.h):
    0x0350  brightness level, 0..255 in the low byte
    0x0352  auto-off timeout, 100 ms steps, 0 = never
    0x0354  control: bit0 = OVERRIDE (always on), bit1 = PING (turn on)

Wire format: 2-byte register address, big-endian; 16-bit values,
little-endian. A write is applied when the high byte arrives, so the
address and both value bytes go out in ONE message. Reads are
address write + repeated start + read, in one I2C_RDWR call.

The MCU address is normally bound by the kernel driver that exposes
the buttons / touchpad / LEDs, so I2C_SLAVE would fail with EBUSY.
I2C_RDWR does not take the address, so it works alongside the driver.

Level 0 is refused on purpose: it would be saved to flash and the
screen would stay dark after reboot. Use `off` to blank the screen.

Output: one JSON line on stdout. Exit code 0 on success, 1 on error.
"""
import ctypes
import fcntl
import glob
import json
import os
import sys

MCU_ADDR = 0x69
REG_LEVEL = 0x0350
REG_TIMEOUT = 0x0352
REG_CONTROL = 0x0354

CTRL_OFF = 0x0000
CTRL_ALWAYS_ON = 0x0001
CTRL_ON = 0x0002

I2C_RDWR = 0x0707
I2C_M_RD = 0x0001


class I2cMsg(ctypes.Structure):
    _fields_ = [('addr', ctypes.c_uint16),
                ('flags', ctypes.c_uint16),
                ('len', ctypes.c_uint16),
                ('buf', ctypes.POINTER(ctypes.c_uint8))]


class I2cRdwrData(ctypes.Structure):
    _fields_ = [('msgs', ctypes.POINTER(I2cMsg)),
                ('nmsgs', ctypes.c_uint32)]


MCU_CLIENT_NAME = 'one-mcu'   # i2c client name of the MCU (driver flipper-one-mcu)


def find_bus():
    """Bus number of the MCU: FLIPPER_MCU_I2C_BUS, else the kernel's
    /sys/bus/i2c/devices/<bus>-0069 entry. An entry whose name is
    MCU_CLIENT_NAME wins; any other 0x69 client is the fallback.
    On the device it is 0-0069 (bus 0)."""
    env = os.environ.get('FLIPPER_MCU_I2C_BUS')
    if env:
        return int(env)
    fallback = None
    for p in sorted(glob.glob('/sys/bus/i2c/devices/*-%04x' % MCU_ADDR)):
        bus = os.path.basename(p).split('-')[0]
        if not bus.isdigit():
            continue
        try:
            with open(os.path.join(p, 'name')) as f:
                name = f.read().strip()
        except OSError:
            name = ''
        if name == MCU_CLIENT_NAME:
            return int(bus)
        if fallback is None:
            fallback = int(bus)
    if fallback is not None:
        return fallback
    raise RuntimeError('MCU at 0x%02x not found in /sys/bus/i2c/devices; '
                       'pass --bus N or set FLIPPER_MCU_I2C_BUS' % MCU_ADDR)


def _buf(data):
    return (ctypes.c_uint8 * len(data))(*data)


def transfer(bus, msgs):
    """msgs: list of (flags, bytes-or-length). Returns read buffers."""
    arr = (I2cMsg * len(msgs))()
    bufs = []
    for i, (flags, payload) in enumerate(msgs):
        if flags & I2C_M_RD:
            b = (ctypes.c_uint8 * payload)()
            n = payload
        else:
            b = _buf(payload)
            n = len(payload)
        bufs.append(b)
        arr[i].addr = MCU_ADDR
        arr[i].flags = flags
        arr[i].len = n
        arr[i].buf = ctypes.cast(b, ctypes.POINTER(ctypes.c_uint8))
    data = I2cRdwrData(ctypes.cast(arr, ctypes.POINTER(I2cMsg)), len(msgs))
    fd = os.open('/dev/i2c-%d' % bus, os.O_RDWR)
    try:
        fcntl.ioctl(fd, I2C_RDWR, data)
    finally:
        os.close(fd)
    return [bytes(b) for (flags, _), b in zip(msgs, bufs) if flags & I2C_M_RD]


def write_reg(bus, reg, value):
    value &= 0xFFFF
    transfer(bus, [(0, [reg >> 8, reg & 0xFF, value & 0xFF, value >> 8])])


def read_regs(bus, reg, count):
    """Read `count` consecutive 16-bit registers starting at `reg`."""
    raw = transfer(bus, [(0, [reg >> 8, reg & 0xFF]),
                         (I2C_M_RD, 2 * count)])[0]
    return [raw[2 * i] | (raw[2 * i + 1] << 8) for i in range(count)]


def state(bus):
    level, timeout, control = read_regs(bus, REG_LEVEL, 3)
    return {'ok': True, 'bus': bus, 'level': level & 0xFF,
            'timeout': timeout, 'control': control}


def main(argv):
    args = list(argv)
    bus = None
    if len(args) >= 2 and args[0] == '--bus':
        bus = int(args[1])
        args = args[2:]
    if not args:
        raise ValueError('missing command')
    cmd = args[0]
    if bus is None:
        bus = find_bus()

    if cmd == 'get':
        return state(bus)
    if cmd == 'off':
        write_reg(bus, REG_CONTROL, CTRL_OFF)
    elif cmd == 'on':
        write_reg(bus, REG_CONTROL, CTRL_ON)
    elif cmd == 'always-on':
        write_reg(bus, REG_CONTROL, CTRL_ALWAYS_ON)
    elif cmd == 'level':
        v = int(args[1])
        if not 1 <= v <= 255:
            raise ValueError('level must be 1..255 (use "off" to blank)')
        write_reg(bus, REG_LEVEL, v)
    elif cmd == 'timeout':
        v = int(args[1])
        if not 0 <= v <= 0xFFFF:
            raise ValueError('timeout must be 0..65535 (100 ms steps)')
        write_reg(bus, REG_TIMEOUT, v)
    else:
        raise ValueError('unknown command: ' + cmd)
    return state(bus)


if __name__ == '__main__':
    try:
        print(json.dumps(main(sys.argv[1:])))
    except Exception as e:  # noqa: BLE001 - report every failure as JSON
        print(json.dumps({'ok': False, 'error': str(e)}))
        sys.exit(1)
