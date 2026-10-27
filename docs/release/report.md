# Release Test Report

The report answers four questions: what users can do on the candidate,
what failed, what is unknown, and which risks were accepted.
Include declared functions outside the executed plan.

## Candidate and assessment

| Field | Value |
| --- | --- |
| Candidate: channel, artifacts, Linux, MCU, applications | TBD |
| Target revisions and declared functions | TBD |
| Tested configurations: profile, enclosure, battery, peripherals | TBD |
| Software stack: kernel, Device Tree, patches, drivers, FlipCTL implementation | TBD |
| Plan and requirement version; dates and assignees | TBD |
| QA assessment: verified scenarios and main risks | TBD |
| Links to the task, TestOps, and evidence | TBD |

Detailed configuration information may be attached as a separate file.
For measurements, record the method, load, and conditions.
Label calculated values as estimates.

## Functionality and gaps

| Scenario / function and configuration | Tested scope, result, and evidence | Untested scope and reason | Impact or uncertainty |
| --- | --- | --- | --- |
| TBD | TBD | TBD | TBD |

For example, a Wi-Fi row records verified STA connection and data transfer,
with untested bands or AP mode in the adjacent column.
A successful STA run applies only to the executed scope.

Distinguish a failed check, an unexecuted check, a missing case,
and a missing criterion. Give a reason for inapplicability.
Describe exploratory work through actual actions and observations.
For reused results, retain the source and the reason they apply.

## Plan summary

| Planned | Passed | Failed | Broken | Skipped | Not run |
| --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD |

Count a case with specific parameters on a specific configuration.
Status totals must match the plan; retries do not increase its scope.
Keep attempts and show intermittent failures explicitly.
For a reduced plan, retain the original scope, reason, and decision.
Areas without cases remain in the previous table.

## Known limitations

| Failure and issue | Affected versions, revisions, and functions | Impact and workaround |
| --- | --- | --- |
| TBD | TBD | TBD |

Include all known candidate limitations.
Record a confirmed hardware or software cause; use TBD if it is unknown.
Workarounds and patches are part of the result conditions.

## Release decision

- Stage: stabilization or criteria after stabilization — TBD.
- Decision: release / release with limitations / defer — TBD.
- Responsible person, date, and decision link — TBD.

| Limitation or gap | Accepted risk and rationale | Follow-up task and review trigger |
| --- | --- | --- |
| TBD | TBD | TBD |

The release owner decides according to the [release cycle](cycle.md).
Release notes list applicable revisions, limitations,
and untested functions, with a link to the report.
