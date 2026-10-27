# Product Test Areas

The main outcome is a complete user action on a known configuration.
Component checks help detect and explain failures within that action.

## User scenarios

| User goal | Test areas |
| --- | --- |
| Install the system, select a profile, and gain control | [Boot and recovery](linux/boot-recovery.md), [Linux](linux/README.md), [profiles](linux/profiles.md), [MCU](mcu.md) |
| Control the device and complete an application action | [FlipCTL](flipctl.md), [applications and input](applications-ui.md), [mechanics](mechanics.md) |
| Watch a movie on an external display | [Audio, video, and Media Box](audio-video.md), [power](power.md), [profiles](linux/profiles.md) |
| Connect the device or an external client to a network | [Connectivity and USB](connectivity.md), [network modes](network-modes.md), [cellular connectivity](cellular.md) |
| Connect a module and use its function | [Expansion](expansion.md), [connectivity](connectivity.md), [mechanics](mechanics.md) |

For each selected scenario, define the action, observable outcome,
configuration, failures, and recovery.
For example, detecting a sound card assesses initialization;
movie playback needs physical sound, image output, and control.

## System and hardware areas

| Area | Goal |
| --- | --- |
| [Linux](linux/README.md) and [profiles](linux/profiles.md) | Correct system composition, control, and expected data state |
| [MCU](mcu.md) | Working modes, input, display, and Linux interaction |
| [FlipCTL](flipctl.md) and [applications](applications-ui.md) | User actions match actual system state |
| [CPU, RAM, and storage](compute-storage.md) | Correct computation and stored data |
| [Power](power.md) | Operation from the selected source, charging, and expected transitions |
| [Audio and video](audio-video.md) | Physical output through the selected path |
| [Connectivity](connectivity.md) and [cellular modems](cellular.md) | Actual data transfer and connection recovery |
| [Network modes](network-modes.md) | Correct traffic path for an external client |
| [Mechanics](mechanics.md) and [expansion](expansion.md) | Functional assembly and connected module operation |
| [NPU](npu.md) | Correct computation on the accelerator itself |

## Using these pages

Each page defines the goal, initial checks, extended coverage, and evidence.
The [baseline plan](../strategy/baseline.md) limits the initial scope;
select further checks according to [priorities](../strategy/priorities.md)
and candidate content.

Record supported functions and revisions in the plan.
The overall support matrix is TBD.
A declared function that does not work remains a failure or limitation.

Link expected behavior to a [source](../reference/sources.md).
Keep cases and results in TestOps, and exploration and gaps in linked tasks.
Verified scope is determined by executed checks under recorded conditions.
