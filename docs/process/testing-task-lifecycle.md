# Testing Task Lifecycle

A testing task covers independent work: a candidate run, feature exploration,
test case preparation, automation, or a test setup.
Track product defects in separate linked issues.

## Task content

Record the goal, expected deliverable, functional area, assignee,
priority and rationale, and reviewer.
A run needs a candidate, configurations, and plan;
exploration needs a goal, boundaries, and time limit.
Define completion criteria for cases, automation, and setups.
Link the task to its source change or requirement.

| Work | Deliverable for acceptance |
| --- | --- |
| Test run | Plan reconciled with execution; results, defects, and gaps retained |
| Exploration | Actions and observations recorded; the original question answered, or remaining unknowns and reasons described |
| Test case preparation | Source, conditions, actions, and criterion defined; another tester can repeat the check |
| Automation | The selected check is repeatable in the target environment, evaluates its criterion, and retains failure evidence |
| Test setup | A reference action is completed; configuration, limitations, and reset procedure are documented |

## Main path

| Stage | Responsible role | Condition for moving forward |
| --- | --- | --- |
| Queued | QA and requester | Goal, deliverable, and position in [priorities](../strategy/priorities.md) are clear |
| Preparation | Assignee | Scope, criteria, build, data, and setup are defined |
| Ready | Assignee | Resources and result recording are available; limitations are known |
| In progress | Assignee | Work is completed, or a scope change is accepted by the requester and recorded |
| Review | Reviewer | Goal, actual scope, evidence, defects, and remaining work are checked |
| Done | Reviewer | Task criteria are met; the result is accepted and linked to the report or evidence |

Mapping stages to Project columns: TBD.
Keep the current stage and next action in the issue.

## Waiting and scope changes

When waiting for a build, setup, requirement, or fix, record the reason,
owner, and condition for continuing.
Resume the interrupted work once the dependency is resolved.
Waiting does not count as test execution.

When reducing scope, retain the original plan, omitted checks,
reason, and reviewer's decision.
Without that decision, unfinished work remains incomplete.
Link remaining checks to separate tasks or explicitly accepted gaps
in the release report.

For canceled work, close with a cancellation reason and no run verdict.
Reopen a completed task if its criteria are unmet or its result is unreliable.
A new candidate or different scope normally gets a new task linked to the previous one.

## Completion and product results

A run task can finish with failed checks when its goal of executing,
analyzing, and reporting the selected scope is achieved.
The report must show failures and gaps.
Defects remain open under their own lifecycle.

Automation and coverage preparation tasks finish against their criteria;
the presence of code or a case alone is insufficient.
Completing a testing task does not authorize release:
the [release cycle](../release/cycle.md) governs that decision.
