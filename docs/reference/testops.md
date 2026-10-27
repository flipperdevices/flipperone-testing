# Test Cases and Results in TestOps

Use the [FlipperOne project](https://flipper.testops.cloud/project/397).
Track tasks and defects in GitHub Issues.
Field names, values, and views below match TestOps.

## Where to look

| Task | View |
| --- | --- |
| Find a user scenario | Features: Story → Epic → Feature |
| Find component checks | Engineering View: Component → Suite → Test Level |
| Select cases for a release plan | Release Planning View: Release Lane → Release Criticality → Primary System |
| Review execution on a build | Launch and its individual results |

The tree classifies cases; it does not show how completely a candidate was tested.
A case's latest result may belong to another version or configuration.

## Case content

Record the goal, expected behavior source, preconditions, actions,
and observable result.
A step is an action within a case. A suite groups cases.
Keep related actions within a scenario as steps;
separate independent goals or incompatible conditions into cases.

Use parameters for data and setup variants when the goal and criterion are shared.
For example, tv_setup can describe a TV model and CEC mode.
Record the build and execution environment in the result.

| Field | Purpose |
| --- | --- |
| Epic / Feature / Story | Product area, capability, and requirement or scenario |
| Component / Suite | Technical area and stable group of checks |
| Test Level | Component, Integration, or E2E |
| Test Intent | Business, Technical, or Hybrid |
| Primary System / Systems Involved | Main system under test and all participating systems |
| Interface | Execution and observation channels |
| Execution | Manual, Automated, or Manual + Automated |
| Release Lane / Release Criticality | Set membership and importance to release acceptance |

Primary System must be included in Systems Involved.
Set Story when a corresponding requirement exists.
The [strategy](../strategy/overview.md) defines test levels;
Component does not mean a test of the framework itself.

A suite such as Hardware or Playback is a stable group.
Smoke and RC concern planning; Nightly concerns execution frequency.
Release Lane helps select cases, while the candidate plan and release decision
define actual scope and acceptance.
Track work priority separately.

## Example

Audio recovery after HDMI reconnection: Epic — Media Box,
Feature — Movie audio, Story — Watching a movie on TV;
Component — Audio, Suite — Playback, Test Level — E2E, Test Intent — Hybrid.
This level requires the complete scenario with physical output;
checking ALSA nodes alone covers a different scope.

## Links and maintenance

Matching fields do not automatically link a manual case to automation.
A numeric TestOps ID is not required in code.
When renaming or moving an automated check, preserve its result history link.

Before adding a case to a regular plan, review its criterion,
executability, and setup parameters.
An unexecuted case does not verify product readiness.
Link a defect to the specific result and add a backlink in the issue.

When a requirement changes, update the case and plans while retaining result history.
Remove obsolete checks from regular sets.
Account for test tool checks separately from product tests.
