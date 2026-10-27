# Test Strategy

The goal is to verify that, on a target Flipper One revision, users can start
the system, control the device, complete the declared task of an OS profile,
and recover from a specified failure.
Assess data integrity against the requirements of each operation.

## Testing outcomes

For each selected build, provide:

- verified scenarios with their conditions and execution evidence;
- known failures, their impact, and linked issues;
- untested functions and configurations, with reasons and risks;
- a QA assessment and a separate release decision.

Development uses this information to select fixes, QA to choose the next checks,
and release users to understand the capabilities and limitations of their revision.

## Testing stages

| Stage | Goal | Completion criteria |
| --- | --- | --- |
| Basic operation — current stage | Establish a reproducible baseline for one device and build | The [initial plan](baseline.md) is executed and analyzed; results and gaps are recorded |
| User scenarios | Verify the main tasks of declared profiles and applications | Selected scenarios have criteria, configurations, and results for the full user journey |
| Supported releases | Preserve verified functions through changes | Stable revisions have a mandatory test matrix and agreed release criteria |

Work across stages may run in parallel. Completing the first stage establishes
the initial state; each observed failure keeps its status.
Extend coverage according to [priorities](priorities.md), product changes,
and previous results.

## Selecting scope

Start with power, boot, control, data, and recovery:
failures in these areas prevent use of the device and further testing.
Then select complete scenarios for profiles and applications.
Add compatibility, load, battery life, and extended operation checks
according to failure impact and declared conditions of use.

Use Component for an individual component, Integration for interactions,
and E2E for a complete user action.
For example, detecting an audio driver and playing a movie with audible sound
verify different scopes. [Product pages](../product/README.md) define the goals
for each area.

Automate repeatable checks with observable outcomes.
Assess physical input, sound, image output, and mechanical assembly
on the device manually or with measurement equipment.
Before detailed cases are available, use exploratory testing with a stated goal
and recorded conditions, actions, and observations.

## Limits of conclusions

A result applies to the recorded versions, revision, and conditions.
Link expected behavior to its [source](../reference/sources.md).
If a criterion is missing, record the observation and the requirement gap.

Voice AI remains an experiment outside product acceptance.
Test the [NPU](../product/npu.md) with reference data.
Product AI scenarios depend on a development solution and requirements;
their scope is TBD.

During hardware stabilization, known limitations and untested areas
do not automatically block RC or release. Include them in the report;
the release owner records accepted risks.
After stabilization, apply stricter [release criteria](../release/cycle.md).
