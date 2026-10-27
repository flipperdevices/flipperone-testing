# Test Runs and Result Analysis

A run records checks executed on a known candidate and configuration.
The plan defines scope; actual results show the completed part.

## Goals and methods

| Goal | Purpose |
| --- | --- |
| Baseline | Obtain results for the [initial plan](../strategy/baseline.md) on a selected device |
| Smoke | Assess basic functions and whether testing can continue on the build |
| Change verification | Repeat the fixed scenario and regression checks for affected areas |
| Technical assessment (Qualification) | Execute a selected set of technical checks |
| RC assessment | Present candidate results, limitations, and risks for a release decision |

Compatibility, load, extended operation, and exploratory testing are methods
selected by risk. Nightly defines a schedule, not scope completeness.
Manual and automated execution may share one plan.
The current device baseline does not verify installation of another candidate.

## Before execution

Record artifacts, board and enclosure revisions, OS profile, Mainline/BSP kernel,
Device Tree, patches, MCU and affected application versions, settings,
and peripherals.
A run needs data, a plan, and a versioned source for expected behavior.
For updates, record the starting version.
For actions changing firmware, data, or networking, define expected changes
and a way to restore the setup.
Define initial state and cleanup so later checks do not depend on a previous run.

Execute manual and automated checks against the selected plan.
When using CI or TestOps, confirm the actual test set:
UI filtering applies only when the job supports it.

## Analysis

1. Verify the candidate, configuration, and result set.
2. Reconcile execution with the plan, including skips, interruptions, and missing results.
3. Analyze deviations and link them to [issues](issues.md).
4. Retain evidence and retry reasons.
5. Report actual scope and remaining risks.

Passed means the check succeeded; Failed means it failed;
Broken means an execution error; Skipped means the check was skipped.
Account for planned but unexecuted checks as Not run,
even if they have no TestOps record.
Record measurements without criteria as observations, without a pass/fail result.

Tool status does not establish the cause:
Failed may result from a test error, and Broken from a product failure.
Keep the cause unknown until analysis establishes it.

Record retries separately with a reason and a link to the original result.
A successful retry does not erase a failure; show intermittent behavior
in the summary.
Excluding an unstable test requires a reason, linked task,
and the lost scope recorded in the report.

Retain historical logs, community experiments, and results from other devices
with their original versions and conditions.
Reusing a result for a candidate requires justification under
the [release rules](../release/cycle.md).

## Evidence and reporting

[TestOps](https://flipper.testops.cloud/project/397) holds results and defect links,
Allure holds execution details, and CI shows job status.
A publishing error does not invalidate collected results;
unavailable evidence limits the conclusion and must be noted.

For RC and release, prepare a [report](../release/report.md),
including areas without ready cases.
Keep result and decision links in the task.
Release evidence storage: TBD. Retention period: TBD.
