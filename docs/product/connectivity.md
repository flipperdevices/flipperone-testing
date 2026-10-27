# Connectivity and USB

The goal is for the device and an external peer to establish the selected connection,
transfer reference data, and restore communication after a specified interruption.
Assess interface detection, configuration, and transfer separately.

## Initial checks

| Interface | Check |
| --- | --- |
| Ethernet | Each built-in port, addressing, transfer in both directions, and recovery |
| Wi-Fi | Selected mode and band, connection, traffic, and reconnection |
| Bluetooth | Pairing, the declared audio or BLE function, and recovery |
| USB host | Detection and operation of a connected device |
| USB device | Each declared composite device function on the host computer |

Record the revision, port, cable, peer device and OS,
MCU/Linux mode, and network settings.
Treat a built-in interface and an external USB/M.2 adapter
as different configurations.

## Wi-Fi

The [Wi-Fi methods](https://docs.flipper.net/one/testing/network/wifi)
separate STA, AP, concurrent operation, and monitor mode.
Select 2.4/5/6 GHz bands, channels, width, network security,
and region settings according to candidate capabilities.

For AP+STA, distinguish a shared channel (SCC)
from different channels with shared airtime (MCC).
Check supported combinations alongside the mt76/mt7921u version,
firmware, and patches.
Creating two interfaces does not verify transfer through both.

Test real client connections, transfer, and recovery for each role.
Use earlier results on another adapter or kernel to guide check selection,
retaining their original configuration.

## USB-C1 and composite device

Following the [USB function description](https://docs.flipper.net/one/dev-log/6),
test declared network adapter, serial port, Mass Storage, and MTP functions.
Use a reference action for each path:
packet transfer, a console command, or reading and writing a test file.

Record exported storage and directories, access permissions,
data visibility, and disconnect behavior.
Assess empty Mass Storage without selected media against the function settings.
During MCU/Linux transitions, check re-enumeration and control access.

## Extended coverage and evidence

Add hot reconnection, network or peer changes, addressing failure,
concurrent Wi-Fi/Bluetooth/USB, load, and restart.
Measure transfer rate in a defined direction and conditions;
link speed does not equal actual throughput.

Retain settings on both sides, driver and firmware versions,
transfer results, errors, and recovery.
Client traffic through the device is covered in [network modes](network-modes.md),
modems in [cellular connectivity](cellular.md),
and USB-C display output in [media](audio-video.md).
