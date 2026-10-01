#!/usr/bin/env python3
"""
Watch the "connected" bit of every USB hub port and print the set of
occupied ports as one JSON line whenever it changes:

    {"ok": true, "ports": ["usb2-port1", "1-1-port3", ...]}

Port names follow sysfs: <hub device name>-port<N>.

Why: a hub sets the port's CONNECTION bit as soon as a device shows up
electrically, before the kernel debounces, resets and enumerates it.
Reading that bit (GET_STATUS to the hub, the same request `lsusb -v`
uses for "Hub Port Status") reacts earlier than waiting for the device
to appear in /sys/bus/usb/devices.

It cannot see a bare cable: without a device at the far end nothing
pulls the data lines, so the port stays empty.

Needs root (/dev/bus/usb/* control transfers). Runs until killed, or
until stdout goes away: an empty heartbeat line every HEARTBEAT_S fails
with a broken pipe once the reader (server.js) is gone, so a restarted
server never leaves a stray watcher behind. Hubs are rescanned every
RESCAN_S so hubs plugged in later are covered.
"""
import ctypes
import fcntl
import json
import os
import sys
import time

SYSFS = '/sys/bus/usb/devices'
POLL_S = 0.05
RESCAN_S = 1.0
HEARTBEAT_S = 1.0

# GET_STATUS, class request, recipient "other" (= port), 4 bytes back.
REQ_TYPE = 0xA3
REQ_GET_STATUS = 0x00
PORT_CONNECTION = 0x0001


class CtrlTransfer(ctypes.Structure):
    _fields_ = [('bRequestType', ctypes.c_uint8),
                ('bRequest', ctypes.c_uint8),
                ('wValue', ctypes.c_uint16),
                ('wIndex', ctypes.c_uint16),
                ('wLength', ctypes.c_uint16),
                ('timeout', ctypes.c_uint32),
                ('data', ctypes.c_void_p)]


# _IOWR('U', 0, struct usbdevfs_ctrltransfer)
USBDEVFS_CONTROL = (3 << 30) | (ctypes.sizeof(CtrlTransfer) << 16) | (ord('U') << 8) | 0


def read_attr(dev, name):
    try:
        with open(os.path.join(SYSFS, dev, name)) as f:
            return f.read().strip()
    except OSError:
        return ''


def scan_hubs():
    """[(sysfs name, bus, devnum, nports)] for every hub, root hubs included."""
    hubs = []
    try:
        names = os.listdir(SYSFS)
    except OSError:
        return hubs
    for n in names:
        if ':' in n:
            continue                      # interfaces
        if read_attr(n, 'bDeviceClass') != '09':
            continue
        try:
            nports = int(read_attr(n, 'maxchild') or '0')
            bus = int(read_attr(n, 'busnum'))
            devnum = int(read_attr(n, 'devnum'))
        except ValueError:
            continue
        if nports > 0:
            hubs.append((n, bus, devnum, nports))
    return sorted(hubs)


def port_connected(fd, port):
    buf = (ctypes.c_uint8 * 4)()
    xfer = CtrlTransfer(REQ_TYPE, REQ_GET_STATUS, 0, port, 4, 200,
                        ctypes.cast(buf, ctypes.c_void_p))
    fcntl.ioctl(fd, USBDEVFS_CONTROL, xfer)
    return bool((buf[0] | (buf[1] << 8)) & PORT_CONNECTION)


def main():
    fds = {}          # sysfs name -> (fd, nports)
    last = None
    next_rescan = 0.0
    next_beat = 0.0
    while True:
        now = time.monotonic()
        if now >= next_rescan:
            next_rescan = now + RESCAN_S
            hubs = scan_hubs()
            wanted = set(h[0] for h in hubs)
            for name in list(fds):
                if name not in wanted:
                    os.close(fds.pop(name)[0])
            for name, bus, devnum, nports in hubs:
                if name in fds:
                    continue
                try:
                    fd = os.open('/dev/bus/usb/%03d/%03d' % (bus, devnum), os.O_RDWR)
                except OSError:
                    continue
                fds[name] = (fd, nports)
        ports = []
        for name, (fd, nports) in sorted(fds.items()):
            for p in range(1, nports + 1):
                try:
                    if port_connected(fd, p):
                        ports.append('%s-port%d' % (name, p))
                except OSError:
                    pass          # hub went away / suspended; rescan picks it up
        if ports != last:
            last = ports
            print(json.dumps({'ok': True, 'ports': ports}), flush=True)
        if now >= next_beat:
            next_beat = now + HEARTBEAT_S
            print('', flush=True)
        time.sleep(POLL_S)


if __name__ == '__main__':
    try:
        main()
    except (KeyboardInterrupt, BrokenPipeError):
        pass
    except Exception as e:  # noqa: BLE001 - report as JSON, server restarts us
        print(json.dumps({'ok': False, 'error': str(e)}), flush=True)
        sys.exit(1)
