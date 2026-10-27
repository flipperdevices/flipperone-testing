# Initial Baseline: Basic Operation

The goal is to establish the state of one test device on a fixed build
and a repeatable set of checks for comparing later changes.

## Configuration and preparation

Use one hardware revision, one selected Linux profile,
and specific Linux, MCU, and FlipCTL versions.
Record the board, enclosure, battery, kernel, Device Tree, patches,
and peripherals in the task and results.
The selected configuration and first run assignee are TBD.

Before execution, define test cases or an exploratory plan for each row below,
expected results with their sources, and the initial state.
Select a specific USB function, reference data, and recovery path.
An unavailable declared function stays in scope, with a reason it cannot be tested.

## Scope

| Area | Actions | Expected outcome |
| --- | --- | --- |
| [Linux and MCU startup](../product/linux/README.md) | Power on, select a profile, boot, and check versions | The selected versions and profile are running; required services and control are available |
| [FlipCTL and physical input](../product/flipctl.md) | Navigate with buttons and the touchpad, perform one system action, launch an application, and return | Display and behavior match the input; the system effect is verified independently; control returns |
| [Wi-Fi and USB](../product/connectivity.md) | Connect in STA mode, transfer reference data, reconnect, and transfer data through the selected USB function | Data uses the intended path; the connection recovers after interruption |
| [Data](../product/compute-storage.md) | Write and read a test file, restart normally, and read it again | Content matches; required data persistence is preserved |
| [CPU and RAM](../product/compute-storage.md) | Run a reference computation and test an allocated memory region | Output matches the reference; the tested memory range and completion status are known |
| [Power and shutdown](../product/power.md) | Connect and disconnect external power, then shut down normally | State and indicators match the power source; control is retained; shutdown completes |
| [Installation and recovery](../product/linux/boot-recovery.md) | Install a known image and restore it using the method supported by the revision | The system is operational with the expected data state |

Specify the RAM test size, the application action, and the recovery starting state
and permitted data changes.
Perform installation testing on a prepared device; account for existing user data
before overwriting it.

## Completion criteria

1. The recorded configuration and initial conditions allow the checks to be repeated.
2. Actual results and evidence are recorded for every row.
3. Failures are analyzed and linked to issues; unknown causes are stated explicitly.
4. Unexecuted checks have a reason, impact, and a follow-up task.
5. A Smoke set is selected from executed checks and repeated on the same configuration;
   differences between attempts are analyzed.
6. The summary is accepted in the testing task, with links to results and remaining work.

An unexecuted check remains a gap. The task requester approves any reduction
of the original scope, with the reason and remaining work recorded.
Report product results separately from completion of the assessment.

## Next scope

The next plan selects the main actions of declared profiles and applications,
such as movie playback, traffic forwarding for an external client, or modem use.
Add failure and recovery scenarios for those actions.

The initial baseline covers one configuration. It does not verify other profiles,
all ports and radio bands, extended operation, the full RAM or storage capacity,
or compliance with numerical performance and battery life limits.
Keep those areas visible in the report.
