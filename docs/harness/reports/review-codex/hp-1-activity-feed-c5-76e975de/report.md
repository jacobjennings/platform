Merge.

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

- npx jest src/components/feed/feed-query.test.ts from plugins/notification-resources: exit 0. Test Suites: 1 passed, 1 total. Tests: 17 passed, 17 total.
- npm run svelte-check from plugins/notification-resources: exit 0. The underlying log says svelte-check found 0 errors and 46 warnings in 31 files.
- /usr/bin/node common/scripts/install-run-rush.js validate --to @hcengineering/notification-resources with RUSH_ALLOW_UNSUPPORTED_NODEJS=1: exit 0. The final notification-resources validation completed successfully. This prepared dependency declarations for the named checks.
- python3 <harness>/checks/home-access-test.py with isolated HOME and fresh XDG paths: exit 0. Ran 23 tests. OK. Flagged files: none.
- Direct /usr/bin/node helper assertions: exit 0. Newest preview passed in both orders and with empty input.
- git diff --check: exit 0.

The harness for this report is /home/jakej/gh/huly-platform-worktrees/review-codex-hp-1-activity-feed-c5-76e975de-harness.

Setup: /usr/bin/node common/scripts/install-run-rush.js install first exited 1 because Node 26.10.0 is outside >=20.0.0 <25.0.0. Retrying with RUSH_ALLOW_UNSUPPORTED_NODEJS=1 exited 0 and the dependency confirmation printed DEPS_READY. Missing dependencies were treated as setup work. No full suite ran.

Raw logs and runner rows are local at /home/jakej/.local/state/jake-harness/run-evidence/3efb83dfb4171d504ec90a6f. Setup, validate, negative control and home-access logs are under /tmp/huly-platform-workers/hp1-review-*.log.

Local launcher records show implementation finished at 1:07 am and review started at 1:18 am on October 16, America/Chicago. reviewed-task-ids.json and role-index.jsonl both name the same task. The worker's missing gate record was not treated as a completed gate.

## Could not check

- Rendered feed behavior is not checked. This brief prohibits browser launches. No screenshot was taken.
- The worker capture-attachments.json records comment:null and no attached capture. The worker report also says no screenshots exist. No live card was read and no caption was treated as proof.
- The worker reported model-notification validation passing. It was not rerun because the review fix does not change that package.
- The installed Node version is outside the repository's supported range.

Prose checker: exit 0. Its initial warnings were "paragraph-length: This paragraph has 97 words. The warning limit is 90." and "possible-jargon: Explain 'Test Suites' in this sentence if it is a project term." The long paragraph was split. Test Suites is quoted test-runner output. The checker also emitted configuration warnings that cache state paths are excluded from backups.

## Merge status

The report is pushed before invoking the prescribed merge runner. Merge results will be recorded afterward. No board write or live-server contact is authorized.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

No follow-on is declared. Rendered acceptance remains unchecked.

NOT MERGED
