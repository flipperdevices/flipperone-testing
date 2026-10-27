# Release Cycle

Release testing gives the release owner information about candidate behavior,
known failures, and untested scope.
QA provides an assessment; the release owner makes the decision.

Release owner and schedule: TBD.
Record the decision in the release GitHub issue with a link to the [report](report.md),
the date, the responsible person, and accepted risks.
Use a Testing issue if there is no separate release task.

## From change to release

| Stage | Work | Outcome |
| --- | --- | --- |
| Change | Define expected behavior, affected areas, and version | The test scope and criteria are clear |
| Development build | Run Smoke, change verification, and selected regression checks | Main failures and the ability to continue testing are known |
| RC | Freeze artifacts, declared functions, target revisions, and plan; execute the available scope | A report for the specific candidate |
| Decision | Review results and risks against the current rules | Release, release with limitations, or defer |
| Release | Compare published artifacts with tested artifacts and verify installation on a selected configuration | Artifacts and the report are available; release notes list limitations |
| After release | Review new reports and return discovered gaps to the queue | Related defects and tasks have next actions |

The image channel Release/RC/Nightly/Dev identifies the build source.
Record executed checks and the release decision separately.

## RC and release during stabilization

While hardware is stabilizing and coverage is being developed,
known limitations and untested areas do not automatically block release.

A decision requires:

- exact artifacts, target revisions, and declared functions;
- the plan, actual tested scope, and results;
- all known candidate limitations, their impact, and workarounds;
- untested functions and configurations, including missing cases and criteria;
- the release owner's decision, accepted risks, and remaining uncertainty.

A declared function that does not work remains a failure or limitation.
Accepting risk preserves the original Failed, Broken, and Not run statuses.
Justify inapplicability against the target functions.

Include Smoke, changes, fixes, and related regression checks in the plan.
Select installation, update, recovery, compatibility, and extended operation
checks according to changes and risks; show omitted scope in the report.
Use the [current priorities](../strategy/priorities.md) to order work.

## New candidates and hotfixes

When an artifact changes, repeat affected checks and review the decision.
Reuse a previous result only with its original configuration
and a reason it applies. Without that basis, the check remains unexecuted
for the new candidate. A new significant failure also requires a decision review.

For a hotfix, identify the candidate and run fix verification, Smoke,
and affected regression checks. Record reduced scope and its impact in the report.

## After stabilization

Stable revisions, transition date, mandatory matrix, and release criteria: TBD.

Record a transition decision with those values.
Mandatory checks must pass on target configurations;
an unexecuted check requires execution or a documented exception.
Defects unacceptable under the approved criteria block RC and release.
The stabilization rules apply until that transition.
