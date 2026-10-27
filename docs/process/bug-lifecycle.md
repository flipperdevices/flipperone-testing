# Defect Lifecycle

A GitHub issue tracks a defect until a fix or another justified resolution.
Record the detailed stage in the Project or issue.
Mapping stages to Project columns: TBD.

## Main path

| Stage | Responsible role | Condition for moving forward |
| --- | --- | --- |
| Reported | Reporter | Observation, expected behavior, versions, and conditions follow the [template](issues.md) |
| Triage | QA and component owner | The discrepancy, owner, impact, and priority are identified |
| Planned | Component owner | Fix scope and work order are defined |
| In progress | Developer | The fix is ready and the PR or commit is linked |
| Ready for verification | Developer | A build with the fix is available; reproduction conditions and affected areas are listed |
| Verification | Tester | Original conditions and required regression checks are repeated; results are retained |
| Closed: verified fix | Tester | The failure no longer occurs under tested conditions; the build and evidence are recorded |

Keep the issue open until verification. If merging a PR closes it automatically,
reopen it until verification is complete.
GitHub closure or a successful build alone does not verify a fix.

If the failure persists, return the issue for fixing with the new result.
If the same defect returns after closure, reopen it and identify
the first known affected version.
Track an independent new cause separately, with a link to the earlier issue.

## Other resolutions

| Resolution | Action |
| --- | --- |
| Insufficient data or not reproduced | Keep open; record attempts, missing data, an owner, and a retest condition |
| Duplicate | Close with a link to the main issue; transfer or link evidence |
| Matches the requirement | Close with an explanation and requirement link; track requirement changes separately |
| Deferred or limited by hardware revision | Keep open; record functions, reason, and a review trigger |
| Fix not planned | The component owner records the closure reason; this is not a successful test result |

"Not reproduced" alone does not establish a fix.
If investigation stops, record the decision and reason without closing
the defect as a verified fix.

Accepting a limitation for release does not close the defect.
Link the decision to the [release report](../release/report.md)
and track fix status separately.

## Recording transitions

Record the stage, next responsible person, and basis: observation, change,
build, verification result, or decision.
Waiting requires a reason and a condition for continuing.
Explain changes to severity, fix priority, or test order.
