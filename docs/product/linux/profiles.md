# Linux Profiles

The goal is for users to select, boot, change, and restore a profile
with the expected private and shared data state.
In the [documented Btrfs implementation](https://docs.flipper.net/one/cpu-software/profiles),
each profile has its own root filesystem and kernel;
/home, /var/log, /var/cache, and /boot are shared.
Record the actual layout and requirement version for the candidate.

Record the OS profile, boot target, MCU/Linux mode,
and execution profile separately.

## Initial checks

| Profile, if declared | Main outcome |
| --- | --- |
| Minimal | Expected services and available control |
| No Graphics | Control with graphics services and video outputs disabled |
| Desktop | Working session, input, application action, and exit |
| TV Media Box | Media player launch, display, audio, and control |
| Router | WAN/LAN, client connection, and traffic transfer |
| Network Sniffer | Interface selection, capture, and access to results |
| Custom or on removable storage | Storage selection, booting the intended state, and data access |

For each selected profile, verify its name, storage device, kernel,
Device Tree, and services. Perform its main action, restart, and check state.
Retain the original profile list with the plan.

## Profiles and snapshots

Check profile creation from a stock snapshot and user state,
renaming, reset, and deletion, including Boot Menu entries.
A snapshot is a saved state; create a profile from it to boot.

For supported operations, check confirmation, cancellation, failure,
permissions, storage exhaustion, and recovery.
Check restrictions on the active profile and read-only or stock state separately.
Test snapshot export and import with data and incremental copy dependencies
when included in the plan.

## Shared data and isolation

Changes to private profile files must not affect another profile
beyond the requirements.
Check shared user data and log persistence after switching,
resetting, and deleting profiles.

Verify account, access, and device identity rules across profiles.
A shared /home alone does not establish identical /etc settings.
Check updates, unavailable storage, and recovery from a full filesystem.
A profile snapshot is not a backup of shared directories.

## Evidence

Retain the profile, its source, kernel and Device Tree,
private and shared data before and after operations, boot entries, and errors.

Boot Menu selection and startup are covered in [boot testing](boot-recovery.md).
Profile scenarios are covered in [applications](../applications-ui.md),
[media](../audio-video.md), and [network modes](../network-modes.md).
