# Linux and Base System

The goal is a system with the selected versions, working profile services,
and available control after boot and a normal restart.
Assess the kernel, base OS, and system dependencies.

## Scope

Record the Flipper OS build, kernel version and Mainline/BSP branch,
Device Tree, local patches, RootFS and MCU versions, board revision,
and OS profile.
Determine expected devices, mounts, and services from candidate content
and requirements.

[Profiles](profiles.md), [updates](boot-recovery.md), [MCU](../mcu.md),
and [FlipCTL](../flipctl.md) have separate checks.
Also assess dependencies here: a service runs in the required profile,
receives its resources, and recovers as specified.

## Initial checks

1. Boot the selected image and compare observed versions with the candidate.
2. Check devices, mounts, and services in the active profile.
3. Verify the control channel and a main system action.
4. Restart normally and check settings and state.
5. Analyze boot and service errors; link deviations to issues.

## Extended coverage

Check dependency failure, storage exhaustion, connection loss,
service restart, and recovery after load.
Evaluate the response against function requirements:
handling an expected failure does not require every part of the system
to continue unchanged.

When the kernel, Device Tree, or patches change, review affected interfaces,
boot, graphics, and power management.
A capability working in BSP does not establish support
in the selected Mainline build.

## Evidence

Retain versions, boot ID, service states, logs,
and state before and after the action.
Analyze loss of access as an observation:
the cause may be the device, network, or setup.
Checks that cannot continue without access remain unexecuted;
retain the observed failure separately.
