# Task Workflow

GitHub issues hold tasks, discussions, and decisions. GitHub Projects show
the state of those tasks. TestOps holds cases, plans, and execution results.

## Where to look

| Question | Location |
| --- | --- |
| What testing work is planned? | [Testing Project](https://github.com/orgs/flipperdevices/projects/14) |
| Which areas come first? | [Priorities](../strategy/priorities.md) |
| What is changing in FlipCTL? | [FlipCTL Issues](https://github.com/flipperdevices/flipctl/issues) and tasks for the implementation under test |
| What is changing in Linux? | [Linux Project](https://github.com/orgs/flipperdevices/projects/11) |
| What is changing in MCU firmware? | [MCU Project](https://github.com/orgs/flipperdevices/projects/8) |
| Which UI requirements are changing? | [UI Project](https://github.com/orgs/flipperdevices/projects/12) |
| What is changing in electronics? | [Hardware Project](https://github.com/orgs/flipperdevices/projects/9) |
| What is changing in the enclosure and mounts? | [Mechanics Project](https://github.com/orgs/flipperdevices/projects/15) |
| What has been tested on a build? | [TestOps](https://flipper.testops.cloud/project/397), results for that build |

Start by reviewing assigned tasks, fixes awaiting verification,
and reasons the current run is blocked. In Issues, use
"is:open assignee:@me" and "is:open no:assignee".
In Projects, use available assignee and status filters.
For a release, review linked tasks and defects; use a milestone if one is assigned.

Track the [initial baseline](../strategy/baseline.md) in a testing task.
Record the device, build, results, and remaining work there.
Use separate tasks for later candidates, linking to the initial assessment.

Mapping workflow stages to Project fields and views: TBD.

## Responsibilities

The change author provides expected behavior and an available build.
The developer describes the fix and its impact; the component owner helps
analyze failures. QA selects scope, performs testing, and presents results.
The release owner decides according to the [release cycle](../release/cycle.md).

Assign an assignee and a reviewer to independent testing work.
They may differ from the assignee of the development task.

## From change to result

1. Link the change to its requirement, acceptance criteria, and affected areas.
2. Identify the version containing the change and the test conditions.
3. Select checks according to risk and [current priorities](../strategy/priorities.md).
4. Execute the plan and record results, defects, and untested scope.
5. Give the assessment to the change owner; link release work to the report.

Use an existing issue when appropriate. Create a separate testing task
when the work has its own scope, assignee, or completion criteria.
Link it to the change and add it to the Testing Project.
Keep each defect in one issue across repositories.

When waiting, record the missing build, setup, or decision, its owner,
and the condition for continuing. Keep decisions in the issue
and execution details in results and attachments.
Links connect the requirement, change, check, and defect.

The [testing task lifecycle](testing-task-lifecycle.md) covers preparation
and completion; the [defect lifecycle](bug-lifecycle.md) covers fixes
and verification. A merged PR does not establish that a fix was verified.
