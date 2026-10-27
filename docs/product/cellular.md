# Cellular Connectivity and 5G Modem

The goal is for users to connect through the selected modem, transfer data,
control the radio, and see actual connection state in FlipCTL.
Test the modem, driver, ModemManager, and NetworkManager.
[Application requirements](https://docs.flipper.net/one/cpu-software/flipctl/5g-modem-app)
and [RM520N-GL results](https://docs.flipper.net/one/testing/network/cellular/rm520n-gl)
serve different purposes: expected behavior and observations on a specific device.

## Configuration

Record modem model and firmware, USB or PCIe, driver and local patches,
service versions, SIM/eSIM, carrier, APN, antennas, and reception conditions.
Verify the actual network route of test traffic.
Record the setup control channel separately.
Use test SIMs with known lock and profile states.

## Initial checks

1. Detect the modem; verify the driver, selected SIM, and registration state.
2. Connect and transfer reference data in both directions.
   Record the actual radio technology: successful LTE does not verify 5G.
3. Compare menu, status bar, and application states with service data.
4. Disable and enable the radio through a supported method;
   verify transfer stops and the connection recovers.
5. Reconnect or restart; verify the application still identifies
   the same physical modem after its ModemManager index changes.

## Extended coverage

| Area | Checks |
| --- | --- |
| SIM | No card, PIN/PUK, canceled switching, physical SIM/eSIM, and recovery after reset |
| Multiple modems | Separate entries, port association, changed detection order, and no USB/PCIe duplicates |
| UI data | Addresses, APN, counters, units, long values, and explicit indication of unavailable readings |
| Services and permissions | ModemManager loss, D-Bus or device access failure, and restored control |
| Transfer modes | LTE, 5G NSA/SA, bands, and USB/PCIe according to the declared matrix |

Check M.2 and USB differences:
slot hardware actions, including SIM switching, must not be offered
for an external modem without that control.

Compare radio readings with source data and measurement conditions.
Check the band and configuration before treating an unused antenna path
or missing reading as an antenna defect.
Test GNSS separately: an NMEA stream does not establish a position fix.

For eSIM, use a known profile state and an available network.
Record an empty chip, unavailable carrier service, or an untested combination
in the result.
A measurement with a workaround does not verify operation without it.

## Evidence

Retain configuration, route, registration, actual transfers, logs,
and states before and after failure.
Mask IMEI, ICCID, IMSI, and other identifiers in public materials.

Module detection is covered in [expansion](expansion.md),
system actions in [FlipCTL](flipctl.md),
and physical antennas in [mechanics](mechanics.md).
