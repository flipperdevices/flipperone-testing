# Boot, Installation, and Recovery

The goal is for users to install the selected image, boot the required profile,
and restore the system through the specified method with known effects on data.
Record implemented mechanisms in the plan:
[installer](https://docs.flipper.net/one/cpu-software/how-to-install-linux-image),
[Boot Menu](https://docs.flipper.net/one/dev-log/9),
and [Recovery OS](https://docs.flipper.net/one/dev-log/7).

## Mechanisms

| Mechanism | Checks |
| --- | --- |
| Flipper OS Installer | Channel, build, target storage, and profile selection; download and write |
| Boot Menu | UFS/microSD source, selected and preferred profile, kernel, and Device Tree |
| Falcon / kexec / pivot | Actual boot path and handover to the profile |
| Recovery OS | Available entry method, recovery environment, and access to required data |
| Rockchip MaskROM | CPU detection and recovery tool loading through the correct USB port |
| MCU BOOTSEL/UF2 | Separate firmware recovery path for the hardware revision |

Check Recovery OS entry against candidate capabilities.
Treat entry through the MCU menu and through Boot Menu as separate paths.
Test CPU and MCU recovery separately.

## Initial checks

1. Record starting versions, revision, storage device, and installation method.
2. Select the channel, specific build, and profiles; verify target storage.
3. Install and verify Linux/MCU versions, profile, and available control.
4. Check normal restart and the profile's main action.
5. Verify the specified return to a known working state.

The Release, Release candidate, Nightly, or Dev channel identifies
the image source; it differs from a test set or execution schedule.

## Extended coverage

Check Download & verify and Stream in the installer:
data integrity, network interruption, verification failure, and storage exhaustion.
Retain differences in error handling and warnings.
Check mandatory Minimal and selected additional profiles.

For UFS, account for logical unit changes through Reprovision UFS.
Before the operation, identify data to be removed and data to be retained.
Compare the actual state after installation.

For Boot Menu, check preferred profile autostart, kernel selection,
and video settings.
Test kexec and pivot separately; the fast transition requires compatible
kernel and Device Tree.

Add updates from supported versions, reinstallation, corrupted images,
and interrupted operations.
Assess authenticity, rollback, and atomicity against mechanism requirements.
Check data integrity after restart.
Linux restart, MCU reset, and power loss have different expected outcomes.

## Evidence

Retain artifacts, versions, channel, image verification mode, target device,
boot path, logs, and recovery results.
Include limitations and unexecuted paths in the [release report](../../release/report.md).

Data and snapshots are covered in [profiles](profiles.md);
MCU firmware is covered in [MCU testing](../mcu.md).
