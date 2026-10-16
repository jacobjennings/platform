Merge after a named change.

Reviewed commit: 76e975de83491401191ae363a07e183fbfefdf42
Applied-fix tip: 52f48cbb6c3b3c873f498e397d365df1ce6efd1d

Task: http://huly.lan/workbench/hulyaccessevaluation/tracker/HP-1

The model change adds an Activity application when existing workspaces next receive a model upgrade. It changes no existing documents and adds no migration. Deployment and model upgrade are outside this review.

The source is huly-platform. Git resolves its common directory to /home/jakej/gh/huly-platform/.git. The target is jj/activity-feed, as the Director specifies. The generic brief's jake-harness repository description is incorrect.

## Acceptance and Applied fix

The diff adds a separate feed with project filtering, document grouping, paging and browser read marks. Inbox code is unchanged. No secret or existing license text change was found. No owner ruling file was rewritten.

Applied fix at plugins/notification-resources/src/components/feed/ActivityFeedCard.svelte:70. Combining messages sorts them oldest first. Selecting the first result showed the oldest preview on a card ordered by its newest activity. The card now uses newestFeedMessage, with a regression test that checks both orders and an empty result.

Temporarily restoring first-result selection made that test fail with Expected: "newer" and Received: "older". The original source was restored afterward. The control had 1 failed test and 16 skipped tests, exit 1 as expected.

## Validation

Selection: git diff --name-only origin/jj/activity-feed...HEAD, followed by rg -n 'feed-query|components/feed' plugins models --glob '*test*'. The only matching test imports ./feed-query at feed-query.test.ts:39. Named checks also include the package Svelte check and the harness home-access test. Checks rerun because this review changed the helper and card.

On applied-fix tip 52f48cbb6c3b3c873f498e397d365df1ce6efd1d:

- npx jest src/components/feed/feed-query.test.ts from plugins/notification-resources: exit 0. `Test Suites: 1 passed, 1 total`. `Tests: 17 passed, 17 total`.

- npm run svelte-check from plugins/notification-resources: exit 0. The underlying log says svelte-check found 0 errors and 46 warnings in 31 files.

- /usr/bin/node common/scripts/install-run-rush.js validate --to @hcengineering/notification-resources with RUSH_ALLOW_UNSUPPORTED_NODEJS=1: exit 0. The final notification-resources validation completed successfully. This prepared dependency declarations for the named checks.

- python3 <harness>/checks/home-access-test.py with isolated HOME and fresh XDG paths: exit 0. Ran 23 tests. OK. Flagged files: none.

- Direct /usr/bin/node helper assertions: exit 0. Newest preview passed in both orders and with empty input.

- git diff --check: exit 0.

The harness for this report is /home/jakej/gh/huly-platform-worktrees/review-codex-hp-1-activity-feed-c5-76e975de-harness.

Setup: /usr/bin/node common/scripts/install-run-rush.js install first exited 1 because Node 26.10.0 is outside >=20.0.0 <25.0.0. Retrying with RUSH_ALLOW_UNSUPPORTED_NODEJS=1 exited 0 and the dependency confirmation printed DEPS_READY. Missing dependencies were treated as setup work. No full suite ran.

Raw logs and runner rows are local at /home/jakej/.local/state/jake-harness/run-evidence/3efb83dfb4171d504ec90a6f. Setup, validate, negative control and home-access logs were copied into that evidence folder as hp1-review-*.log.

Local launcher records show implementation finished at 1:07 am and review started at 1:18 am on October 16, America/Chicago. reviewed-task-ids.json and role-index.jsonl both name the same task. The worker's missing gate record was not treated as a completed gate.

## Could not check

- Rendered feed behavior is not checked. This brief prohibits browser launches. No screenshot was taken.
- The worker capture-attachments.json records comment:null and no attached capture. The worker report also says no screenshots exist. No live card was read and no caption was treated as proof.
- The worker reported model-notification validation passing. It was not rerun because the review fix does not change that package.
- The installed Node version is outside the repository's supported range.

Prose checker: exit 0. The initial warnings were:

```
paragraph-length: This paragraph has 97 words. The warning limit is 90.
possible-jargon: Explain 'Test Suites' in this sentence if it is a project term.
```

The validation list was spaced into separate items and raw test output marked as code. Configuration warnings about cache state paths being excluded from backups are preserved in prose-check.log.


## Merge status and named change

Director decision: provide Node 20 through 24 at /usr/bin/node, satisfying rush.json:45, then rerun the prescribed merge runner with the same named checks. The system runtime needs the Director because privilege escalation is prohibited. No product change remains requested.

Blocking setup finding at harness.toml:130: the prescribed setup command runs without the compatibility override in the merge runner's fresh environment. It exits 1 on this machine before the named checks. The exact error is:

```
ERROR: Your dev environment is running Node.js version v26.10.0 which does not
meet the requirements for building this repository. (The rush.json
configuration requires nodeSupportedVersionRange=">=20.0.0 <25.0.0")
```

The first runner invocation exited 1 because --worker-report was missing. The corrected invocation supplied docs/harness/reports/hp-1-activity-feed-c5/report.md and also exited 1, this time at setup. Its record is merge-attempt2/reviewmerge.json in the evidence folder. It records outcome not-pushed, pushed:null, no conflicts and an empty failing_after_merge list.

The proposed merge was fdb9c64c55c3e437feaccfa299e332340087190a, based on e2dc43e23d58568fd34b8b844bf4857e8c30ee04 and review report commit f66bd6f3c. No named check ran on that merge because setup stopped first. The passing checks above ran on the applied-fix branch tip only.

The repository-size check against that proposed merge exited 0 with passed:true, oversized:[] and chargedBytes:2597832. Command: python3 <harness>/checks/check-repository-size.py --base e2dc43e23d58568fd34b8b844bf4857e8c30ee04 --head fdb9c64c55c3e437feaccfa299e332340087190a.

A fresh fetch of origin/jj/activity-feed exited 0. The ancestry check for f66bd6f3c against that ref exited 1, confirming the reviewed changes are not merged.

The outcome command was not run because it writes board stages and sends session messages. This brief prohibits board writes and tmux. No board or live-server contact occurred.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

No follow-on is declared. Complete the named runtime setup step and rerun the merge runner. Rendered acceptance remains unchecked.

NOT MERGED
