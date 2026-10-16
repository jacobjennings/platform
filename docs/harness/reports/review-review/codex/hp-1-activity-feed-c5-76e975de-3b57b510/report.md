Merge.

Reviewed commit: 3b57b510a0e2f836356410c05d1247263cffeb73
Applied-fix tip: 74c5c03f47267519aa00f6529cea6424cc4cc27f
Merged review tip: e6df283c16e7ecd18a8917da848a01c35130e6aa
Merged commit: 4772b0dd5868888f5ee267db762d1ffd92010cd6

Task: http://huly.lan/workbench/hulyaccessevaluation/tracker/HP-1

The model change adds an Activity application when existing workspaces next receive a model upgrade. It changes no existing documents and adds no migration.

## Acceptance

The Node setup finding is resolved. The feed tests, package Svelte check and home-access test passed on the exact merged commit above. No product behavior changed in this continuation.

The checkout is the platform repository, with shared Git at /home/jakej/gh/huly-platform/.git. The brief's generic jake-harness repository description is incorrect. The explicit source range and jj/activity-feed target were followed. Since the earlier preview fix, the reviewed source changed only its report. This narrow continuation does not reopen the earlier product review.

Local reviewed-task-ids.json and role-index.jsonl name the same task. Implementation finished at 1:07 am and this review started at 1:50 am on October 16, America/Chicago. The provisional report was committed and pushed before any test ran.

## Applied fix

harness.toml:40 pins /home/jakej/.local/opt/node-22/bin/node using the runner's supported tests.node setting. Without this setting, the runner discards the inherited PATH and selects system Node 26. The proving runner output says v22.23.3 and DEPS_READY. No Node version was installed and no compatibility override was used.

## Validation

Selection: git diff --name-only origin/jj/activity-feed...HEAD and rg -n 'feed-query|components/feed' plugins models --glob '*test*'. The search found feed-query.test.ts:39 importing ./feed-query. Both named package checks reran at the Director's request to clear the runtime finding. Home-access reran to correct its runner setup fault.

All following checks ran on commit 4772b0dd5868888f5ee267db762d1ffd92010cd6 in a fresh runner worktree with isolated HOME, XDG folders, guarded Git and offline board URLs:


- node common/scripts/install-run-rush.js install: exit 0 on both runner attempts. The first log says Node.js version is 22.23.3 (LTS) and Rush install finished successfully.

- node --version followed by the dependency directory check: exit 0. Output was v22.23.3 and DEPS_READY.

- node common/scripts/install-run-rush.js validate --to @hcengineering/notification-resources: exit 0. The notification-resources build and validation completed successfully. Rush reported SUCCESS: 128 operations for this target and its dependencies. No repo-wide build, validate or suite ran.

- From plugins/notification-resources, npx jest src/components/feed/feed-query.test.ts: exit 0. Test Suites: 1 passed, 1 total. Tests: 17 passed, 17 total.

- From plugins/notification-resources, npm run svelte-check: exit 0. The do-svelte-check wrapper propagates the underlying checker exit code. Its captured console output gives elapsed time, not warning counts.

- python3 <pinned harness>/checks/home-access-test.py as an explicit isolated done command: exit 0. Ran 23 tests in 8.541s. OK. HOME scan: 437 test files, 0 findings. Flagged files: none.

Other checks:


- python3 <pinned harness>/checks/check-repository-size.py --base e2dc43e23d58568fd34b8b844bf4857e8c30ee04 --head 4772b0dd5868888f5ee267db762d1ffd92010cd6: exit 0. passed:true, oversized:[], chargedBytes:2621125.

- git diff --check e2dc43e2 e6df283c16e7ecd18a8917da848a01c35130e6aa: exit 0.

- Fresh fetch and git merge-base --is-ancestor for the merged commit against origin/jj/activity-feed: exit 0.

- The history and file searches described above completed successfully. docs/launch.md was absent in the product checkout, so the pinned harness copy was read.

## Runner record

The first invocation refused before writing anything because the project configuration lacks reviewmerge_push_retries. A local runner-settings.toml supplied the pinned harness retry and marker lifetime values, with jj/activity-feed as the target. This file is evidence, not a product change.

The next runner completed the package checks and pushed the merge. Its --test invocation of home-access did not execute that test, reporting suite-runner: gate.suite_jobs is required in harness.toml. The runner then crashed while writing its final record with ValueError: after-merge record requires a full commit hash. I had passed a short hash. Neither event is described as a passing check.

The corrected invocation used the full reviewed tip and an explicit home-access command. It checked the same merged hash, passed all 23 tests and recorded outcome:pushed. The product checks were not repeated. The missing home-access check was completed after the initial push, which is a departure from the required pre-push order. The final checked hash and pushed hash are identical. No manual merge or push to the target branch was used.

Raw logs are under /home/jakej/.local/state/jake-harness/run-evidence/4d7e97c8a3cfe5b8c74fb2ae. merge/gate-results.jsonl holds the package results. home-retry/reviewmerge.json holds the completed runner record and an empty failing_after_merge list. There were no merge conflicts and no ruling file rewrite.

## Prose check

python3 <pinned harness>/board/board_text.py <report>: exit 0. Its first pass warned:

```
paragraph 6: possible-jargon: Explain 'The Node' in this sentence if it is a project term.
paragraph 10: possible-jargon: Explain 'No Node' in this sentence if it is a project term.
paragraph 14: paragraph-length: This paragraph has 144 words. The warning limit is 90.
paragraph 14: possible-jargon: Explain 'Test Suites' in this sentence if it is a project term.
paragraph 16: sentence-length: This sentence has 56 words. The warning limit is 45.
paragraph 19: possible-jargon: Explain 'ValueError' in this sentence if it is a project term.
```

Blank lines were added between validation items to reduce the paragraph warning. The remaining messages concern technical names and command lengths.

## Could not check


- Rendered feed acceptance is not checked. Browser launches are prohibited. The earlier report records no worker captures attached. No screenshot or caption is treated as proof.

- The outcome helper was not run because it writes board stages and messages. Git ancestry confirms the merge. No board, live server, deployment or NVIDIA access occurred.

## Failing after merge


- none

## Hygiene notes


- none

## RECOMMENDATIONS

No follow-on is declared. Acceptance is the completed targeted checks on the confirmed merged commit. Rendered acceptance remains unchecked.

MERGED
