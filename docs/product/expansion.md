# Expansion and External Devices

The goal is for an installed supported module to perform its main function
and remain controllable after a normal restart.
Test the combination of board, connector, module, driver, and power.
[M.2](https://docs.flipper.net/one/hardware/m2-port)
and [GPIO](https://docs.flipper.net/one/hardware/gpio-port)
have different electrical and mechanical limits.
A connector's presence does not imply support for every module.

## Initial checks

1. Record revision, module model and firmware, connection method, and power.
2. Verify keying, size, component height, and required module interfaces.
3. Check detection and driver selection.
4. Perform the main operation with reference data.
5. Restart the device and verify control and functionality remain available.

For M.2, account for Key B, supported form factor, mounting,
and any required adapter.
Record USB, PCIe, or SATA and the corresponding Device Tree configuration
in the plan.
USB detection does not verify the module's PCIe path.

## Extended coverage

Check CONFIG/disable/reset signals against module requirements,
re-detection, unsupported devices, transfer failures,
resource exhaustion, and concurrent operation.

For GPIO, select declared CPU/MCU signals, USB, power,
and the required device mode.
Verify a line through observable communication or measurement.
A Linux setting alone does not verify it.
Available functions differ when the CPU is powered off and the MCU is running.

SIM/eSIM, modem transfer, and GNSS are covered in [cellular connectivity](cellular.md).
For a satellite module, record the adapter, antenna, and service;
verify delivery of a reference message as well as module detection.
The target set of supported satellite and other modules is TBD.

Test hot plugging only where the interface and module support it.
A result using an adapter applies to that assembly.

## Evidence

Retain models and versions, adapters, driver, Device Tree,
wiring, reference data, errors, and recovery.
Test mounting, covers, and antenna cables under [mechanics](mechanics.md).

Standard transfer is covered in [connectivity](connectivity.md),
data integrity in [storage](compute-storage.md),
consumption in [power](power.md),
and acceleration in [NPU](npu.md).
