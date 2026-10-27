# Power and Temperature

The goal is for the device to operate from the selected source,
charge its battery, and complete expected transitions when power changes
or the battery discharges.
Assess battery life and temperature under a specific scenario.
Use the [power subsystem](https://docs.flipper.net/one/hardware/power-subsystem)
and [Power Meter](https://docs.flipper.net/one/hardware/power-meter) as sources.
Preliminary power values are not verified limits for a hardware revision.

## Initial checks

1. Record board and battery revisions, source, cable, enclosure, and mode.
2. Check power on, normal shutdown, and MCU/Linux transitions.
3. Connect and disconnect external power; check charging and system state.
4. Compare telemetry, screen, and physical indicators with actual state.
5. Measure temperature and consumption under defined idle and load conditions.

## Power Meter and sources

| Condition | Compare |
| --- | --- |
| Battery operation | Consumption, discharge, and indicators |
| USB powers the system and charges the battery | Input power, charging, and Power Meter readings |
| Battery full, USB connected | Charging stops while the system remains powered |
| Source power is insufficient | Combined USB/battery contribution, notification, and recovery after changing the source |

Compare colors, scale, and indicator transitions with revision requirements.
For USB PD, record direction, negotiated mode, cable, and load.
Test Power Bank operation separately from charging the device.
Measure physical current and voltage when the conclusion depends on them.

## Battery life and temperature

For battery life, record starting charge, scenario, brightness,
enabled interfaces, peripherals, and the completion condition.
Check low battery notification and the specified shutdown behavior.

For the accepted [movie scenario](audio-video.md), check charge before Linux starts,
storage, and the MCU Mode shutdown timer.
The original story expects a 3-hour timer; the plan defines applicability.
Permitted charge loss during storage: TBD.

Label runtime calculated from capacity and power as an estimate.
Verify actual battery life through a separate scenario run.

Compare temperatures under the same enclosure and cooling conditions.
Evaluate throttling, charge limiting, and load shutdown
against the required response.

Numerical consumption, charging, and temperature criteria by revision: TBD.
Define the range and stopping conditions before testing limits.

## Evidence

Retain the setup diagram, load, external conditions, duration,
measurement points, instrument and accuracy, telemetry,
and physical measurements.
Include additional prototype sensors in the setup description.

Logic is covered in [MCU](mcu.md), loads in [CPU and RAM](compute-storage.md),
and assembly and cooling in [mechanics](mechanics.md).
