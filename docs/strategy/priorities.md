# Current Priorities

Updated: 2026-10-27. Stage: hardware stabilization and initial coverage.

The table defines the default testing order. Track tasks, assignees,
and dependencies in the [Testing Project](https://github.com/orgs/flipperdevices/projects/14).
Save the selected priorities with each candidate plan.

## Functional areas

| Priority | Area and immediate scope | Reason |
| --- | --- | --- |
| P0 | [Boot, installation, and recovery](../product/linux/boot-recovery.md), basic Linux services | Obtain an operational system and continue testing |
| P0 | [Power](../product/power.md), [MCU](../product/mcu.md), [FlipCTL](../product/flipctl.md), physical controls | Power on, control, and shut down the device |
| P0 | [Data and computation](../product/compute-storage.md): reference correctness and persistence | Risk of losing or corrupting results and user data |
| P0 | [Connectivity](../product/connectivity.md): Wi-Fi STA and the selected USB function | Device access and basic data transfer |
| P1 | [Profiles](../product/linux/profiles.md) and [applications](../product/applications-ui.md): the main action of each selected scenario | Verify a useful user outcome |
| P1 | [Media Box](../product/audio-video.md), [network modes](../product/network-modes.md), [cellular connectivity](../product/cellular.md) | Main declared functions of the selected candidate |
| P1 | [Mechanics](../product/mechanics.md): assembly, cables, mounts, and access to controls | Establish whether results apply to the assembled device |
| P2 | [Expansion](../product/expansion.md), [NPU](../product/npu.md), additional hardware combinations | Extend the verified configuration matrix |
| P2 | Extended operation, broader compatibility, performance and battery life measurements, mechanical endurance | Assess limits and stability under selected conditions |

P0 is the initial basic operation scope. P1 covers the next product scenarios.
P2 extends configurations and operating conditions.
The [initial plan](baseline.md) defines the specific P0 scope;
other checks in the same areas may have a different priority.

Within a priority, test candidate changes and fixes first,
then main actions that have not yet been tested.
Move a function up the queue if it is a main goal of the release,
regardless of its table position. Data loss or loss of control also raises priority.

## Updating the queue

QA reviews priorities for a new candidate, hardware revision, significant failure,
or change in test setup availability. Record the reason and new order in the task.
The release owner approves changes to release test scope.
Update this page and its date when the overall order changes.

An unavailable check keeps its priority and waiting reason.
Continue available work while its dependency is unresolved.

Testing priority determines work order. Track defect severity, fix priority,
and a case's Release Criticality separately.
The [release cycle](../release/cycle.md) defines acceptance during stabilization.
