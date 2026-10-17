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
No newer commits to the touched ruling files appeared in target history since the base.

At the merged tip, rg found the retained phrases for waiting for worker slots, Spark priority, all reviews, merges at low effort and all projects.

Selection: git diff --name-only origin/jj/activity-feed...HEAD and inspection of the changed configuration and route documents.
No test-named file was added or changed. No application package changed.
The merge script selected the brief-required home access check and the reported settings-reader check because no reusable gate record exists. Both stopped in the runner before any test case ran.

Prose checker, exit 0: `paragraph 7: paragraph-length: This paragraph has 106 words. The warning limit is 90.` The paragraph was split.

Commands so far: node --version returned v22.23.3, exit 0. git diff --check exited 0.
The range log, diff, status, role binding and repository reads succeeded.
Missing test paths in the dedicated harness returned exit 2 from ls and rg.
The provisional report was committed and pushed before any test.

## Could not check

- Board capture comments and attached captures were not read because this run forbids live board contact.
- No rendered UI was checked. The change affects harness configuration and documentation.
- No live worker launch, deployment or server access was performed.

## Merge results

Applied fix commit: 2d5194834d996a255e0cacb359d8aa4f7868f0e2.
The merge script reviewed tip b11198b62e4181dc23fbb1c8a4b946cccd4af37a.
It pushed merge commit 91049b4774bf042f2033eedfe29cb5bfa875d8c0 into jj/activity-feed, exit 0.
Fresh fetch and ancestry checks for the merge and original reviewed commit both exited 0.
No conflicts occurred.

The script record says `"frozen_files": {"paths": [], "differing_before_merge": [], "restored": [], "differing_after_merge": []}`.

On that merge commit:

- `node common/scripts/install-run-rush.js install` exited 0. This was setup, with no test count.
- The pinned `checks/home-access-test.py` runner exited 1. No cases ran. Its log says `suite-runner: gate.suite_jobs is required in harness.toml`.
- The pinned `orchestrator/check-settings-readers-test.py` runner exited 1. No cases ran. Its log has the same error.
- The done command imported the pin's `orchestrator/orch_config.py` and called `orch_config.load('harness.toml')`. Exit 0. The raw log contains `orch_config.load: ok`.
- `python3 <harness>/checks/check-repository-size.py` exited 0. Its result was `passed: true`, with 8 new blobs and 64,334 charged bytes.

The test failures are runner setup failures, not passing test evidence.
The dedicated harness lacks these files, so the named paths use the fork's pin.
The fork integration change is outside this card under the Director ruling in the brief.
No tests were run on the target branch to establish prior failures.
The full suite was not run.
The prose checker and git diff --check exited 0.
An intermediate prose check also warned:

```
paragraph 9: paragraph-length: This paragraph has 92 words. The warning limit is 90.
paragraph 9: possible-jargon: Explain 'Sol Low' in this sentence if it is a project term.
```

The paragraph was split and the model effort phrase was expanded.

The outcome subcommand was not run because it writes a board stage and sends messages.
This brief forbids board writes. Ancestry was checked directly without contacting the board.

## Failing after merge

- /home/jakej/gh/jake-harness-worktrees/huly-platform-pin-d765b05/checks/home-access-test.py: exit 1, `exit status 1`.
- /home/jakej/gh/jake-harness-worktrees/huly-platform-pin-d765b05/orchestrator/check-settings-readers-test.py: exit 1, `exit status 1`.

These entries copy failing_after_merge in merge-run/reviewmerge.json.
The detailed runner error for each is quoted above.

## Hygiene notes

- docs/harness/reports/hp-900001-backlog-c2/report.md:1: The record commit title does not start with Record, Log or Review.

## RECOMMENDATIONS

No follow-on is declared. The fork pin move remains outside this review under the Director ruling in the brief.
The route change is merged. The failed runner results remain recorded without a claim that tests passed.

MERGED
