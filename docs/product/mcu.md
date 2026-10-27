# MCU Firmware

The goal is for the device to complete selected MCU/Linux transitions,
process physical input, and display the corresponding state.
Test standalone Raspberry Pi RP2350 operation and Linux interaction:
power, display, input, and LEDs.
The [MCU architecture](https://docs.flipper.net/one/mcu-firmware/architecture)
describes responsibilities; the [MCU↔CPU interface](https://docs.flipper.net/one/mcu-firmware/mcu-cpu-interconnect)
describes communication paths.

## Initial checks

1. Verify the revision, firmware target, version, and diagnostic interface.
2. Run status commands and compare responses with physical state.
3. Check the display, buttons, touchpad, backlight, and available MCU Mode actions.
4. Execute declared transitions Power OFF → MCU Mode → Boot Menu → Linux
   and reverse transitions; check control and indicators.
5. Restart Linux and check MCU behavior. Where continuity is required,
   compare MCU uptime before and after the action.

## Communication and events

Check image transfer over SPI, commands and events over I²C,
MCU notifications, and UART availability according to candidate functions.
When changing mode, check USB ownership and available control.

Add invalid and repeated commands, connection loss, restart of either side,
and recovery.
Check press, release, and hold handling, duplicate event suppression,
feedback, and input switching.
Include audio jack events, backlight, vibration, and LEDs
according to the revision's declared capabilities.

## Updates and recovery

For BOOTSEL/UF2, use the [revision's instructions](https://docs.flipper.net/one/mcu-firmware/firmware-update).
Verify the artifact, entry method, host detection, flashing,
restart, and resulting version.
Test menu entry and the physical button sequence separately.

Take expected button combinations and USB identity from revision requirements.
Check applicability before using one revision's method on another.

## Evidence

Retain versions, revision, mode, communication path, commands,
events, frames, and observations from both sides.
A built-in self-test verifies its own scope.
CLI input checks the software path; physical controls are covered in
[mechanics](mechanics.md) and [user input](applications-ui.md).

Use [power testing](power.md) for power behavior,
[FlipCTL](flipctl.md) for Linux actions,
and [boot and recovery](linux/boot-recovery.md) for system installation.
