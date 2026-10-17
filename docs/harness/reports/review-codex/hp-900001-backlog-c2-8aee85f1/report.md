Merge.

Reviewed commit: 8aee85f1e32b769c2cb7f0ae3699b18d8efe03cd

Accepted the route removal for http://huly.lan/workbench/hulyaccessevaluation/tracker/HP-900001.
The target is origin/jj/activity-feed in the platform fork, as the Director specified.
No data model or migration changes affect existing workspaces.

## Applied fix

Applied fix commit: 2d5194834.

AGENTS.md:20 now points directly to harness.toml, as authorized in the brief.
The pinned orchestrator/orch_config.py load() returned `orch_config.load: ok`, exit 0.
Assertions passed for the documentation pointer, absent jjpc routes, empty filler routes and empty deploy command.
The loader printed STATE PATH WARNING messages for configured cache paths.
No implementation code or tests were added.

## Evidence

The worker report explicitly says its gate did not finish. Its exit status is not proof of code completion.
Its direct check-settings-readers test reported 10 tests and OK. That checks fixtures in the pin.

The source diff sets both policy_file values to harness.toml and removes the duplicated markdown route blocks.
Provider implementation selects Haiku. Review and merge select gpt-6.1-sol at low effort.
The role index and reviewed-task-ids.json name the same source card.
The review started after the implementation report commit.
No newer commits to worker-model-policy.md appeared in the local target history since the base.

Selection: git diff --name-only origin/jj/activity-feed...HEAD and inspection of the changed configuration and route documents.
No test-named file was added or changed. No application package changed.
The merge script will run the brief-required home access check and the reported settings-reader check because no reusable gate record exists.

Prose checker, exit 0: `paragraph 7: paragraph-length: This paragraph has 106 words. The warning limit is 90.` The paragraph was split.

Commands so far: node --version returned v22.23.3, exit 0. git diff --check exited 0.
The range log, diff, status, role binding and repository reads succeeded.
Missing test paths in the dedicated harness returned exit 2 from ls and rg.
The provisional report was committed and pushed before any test.

## Could not check

- Board capture comments and attached captures were not read because this run forbids live board contact.
- No rendered UI was checked. The change affects harness configuration and documentation.
- No live worker launch, deployment or server access was performed.

## Failing after merge

- none

## Hygiene notes

- docs/harness/reports/hp-900001-backlog-c2/report.md:1: The record commit title does not start with Record, Log or Review.

## RECOMMENDATIONS

No follow-on is declared. The fork pin move remains outside this review under the Director ruling in the brief.
Merge execution and its recorded results will be appended after the script returns.

NOT MERGED
