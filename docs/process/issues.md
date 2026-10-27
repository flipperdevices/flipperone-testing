# Defects and Other Issues

A defect is a difference between observed and expected behavior.
Report a missing or conflicting criterion as a requirement question,
and a new capability as a development task.
Until the criterion is defined, retain the observation without marking it passed or failed.

## Where to report

Before creating an issue, search for similar problems by symptom, version,
and conditions.

| Area | Repository |
| --- | --- |
| MCU firmware | [MCU Issues](https://github.com/flipperdevices/flipperone-mcu-firmware/issues) |
| FlipCTL | [FlipCTL Issues](https://github.com/flipperdevices/flipctl/issues); for an implementation in the testing repository, use [Testing Issues](https://github.com/flipperdevices/flipperone-testing/issues) |
| Linux image and system integration | [Linux Issues](https://github.com/flipperdevices/flipperone-linux-build-scripts/issues); use the component repository for a separate component |
| UI requirements and design | [UI Issues](https://github.com/flipperdevices/flipperone-ui/issues) |
| Electronics | [Hardware Issues](https://github.com/flipperdevices/flipperone-hardware/issues) |
| Enclosure, mounts, and mechanics | [Mechanics Issues](https://github.com/flipperdevices/flipperone-mechanics/issues) |
| Test method, setup, or manual testing | [Testing Issues](https://github.com/flipperdevices/flipperone-testing/issues) |
| Test tool | The tool's repository; use [Testing Issues](https://github.com/flipperdevices/flipperone-testing/issues) if the owner is unknown |

Report UI behavior against its implementation. If the component is unknown,
create a Testing issue with observations and identify the owner during triage.
Preserve links and history when transferring an issue.

Track one problem in one issue. If separate causes are not yet established,
link observations without assuming a shared cause.
For a problem spanning components, assign a lead owner and link individual tasks.

## What to record

~~~text
Title: [area] observed failure during a specific action
Versions: Linux, MCU, affected applications, and source version for an update
Configuration: board revision, profile, peripherals, and connection diagram
Preconditions:
Actions:
Expected result: behavior and requirement source
Actual result:
Reproducibility: occurrences / attempts
Impact: consequences, affected functions, and workaround
Evidence: specific TestOps execution, logs, video, or measurements
~~~

For an intermittent failure, retain conditions for successful and failed attempts.
Separate suspected causes from facts. Remove secrets and personal data
from attachments.

## Triage

Identify the component, owner, impact, fix priority, and release implications.
Severity describes impact; priority determines work order.
The severity scale and corresponding GitHub fields are TBD.
Until defined, describe impact in words, including data loss,
function availability, and workarounds.

A result status does not establish the cause. A failure may come from
the product, tool, test setup, or an external system.
State explicitly when the cause is unknown.

For a limitation, record versions, revisions, and functions.
Accepting release risk does not verify a fix.
Verify fixes under the original conditions, with regression checks
for the affected area, and add results to the issue.

The [defect lifecycle](bug-lifecycle.md) covers closure, reopening,
duplicates, and deferral.
A [testing task](testing-task-lifecycle.md) has separate completion criteria.
