Merge.

Reviewed commit: 90232af7f4e521af883b72f378d79adda8690bfc
Applied-fix tip: 5aed1eac7b24451e766b113f3ce253a80635e9ba
Source task: [JH-902459](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902459).

## Acceptance and correction

The limiter now records accepted requests at their actual time. Rejections consume no capacity. Retry delays point to the oldest accepted request leaving the window and stay within one positive window.

Severity high, corrected: foundations/server/packages/server/src/sessionManager.ts:1456 and :1544 rejected the last fitting request because both dispatch paths treated zero remaining capacity as rejection. At a limit of 1,500, the limiter accepted and recorded that request but the server rejected it. The smallest fix makes both callers reject only when retryAfter is defined. Commit 5aed1eac7b24451e766b113f3ce253a80635e9ba applies that fix.

The governing rule is "Reject unsafe or wrong behavior and false claims about code or test results." The enforcing callers are handleRequest and handleRPC. The new limiter tests establish that the last fitting result has zero remaining capacity and no retryAfter.

No launcher, board label, board stage, settings file or frozen file changes in this range. The repository is the Huly fork despite the brief's jake-harness description. The configured merge target is jj/activity-feed. The deletion of harness.toml predates this range and remains intact.

## Evidence and validation

Selection uses the three-dot changed-file list and searches for tests importing or executing changed code. Search commands: `rg -l 'sessionManager' foundations --glob '*test*' --glob '*spec*'` and `rg -n 'SlidingWindowRateLimitter|checkRateLimit' foundations --glob '*test*' --glob '*spec*'`.

The worker reports foundations/core/packages/rpc/src/test/rateLimit.spec.ts passing with exit 0, one suite and 11 tests at 28cd29c3d89bfe2f5b980cc09c7a790d17cc5a9e, tree e4ca20168c48c44617fb36f1bb3db63c33903c44. Its result lines are `Test Suites: 1 passed, 1 total` and `Tests: 11 passed, 11 total`. This is reported worker evidence, not an independently verified run or a reusable gate record. The reviewer did not rerun that passing test.

The reviewer selected foundations/server/packages/server/src/__tests__/sessionManager.test.ts because the reviewer changed its imported sessionManager module. At 5aed1eac7b24451e766b113f3ce253a80635e9ba, gate/isolated_run.py exited 3 before collecting tests with `isolated-run: checkout lacks harness.toml`. No assertions ran and no test counts were produced. Raw capture: /home/jakej/.local/state/jake-harness/run-evidence/949210448f475b110741be04/server-tip.log.

Dependency installation was attempted with the prescribed /usr/bin/node and TMPDIR. It exited 1 because Node v26.10.0 does not meet the checkout's >=20.0.0 <25.0.0 requirement. Raw capture: /home/jakej/.local/state/jake-harness/run-evidence/949210448f475b110741be04/install.log. The context reader returned unavailable. The error was checked in the raw log.

The role index and reviewed-task-ids.json both assign this review to the source card. Implementation finished at 2026-10-20T00:54:31Z. Review assignment was recorded at 2026-10-20T01:54:38.620641+00:00, after implementation finished.

The prose checker exited 0 and printed no warnings.

## Could not check

The server test could not start. No new tests were added or extended. The worker's numerical comparison lacks a committed raw measurement capture and is not accepted as measured performance. Live load recovery and deployment were not checked. Attached validation captures and their marked board comment were not available in the local evidence inspected. Their absence from local files does not prove the card has no attachments. No UI was changed.

## Merge status

The provisional report was committed and pushed before this verdict. The merge script and outcome step are pending. No merge is claimed yet.

## Critical caveats

Server tests could not start because the fork has no harness.toml and dependency installation rejects the prescribed Node version.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

Accept the limiter correction and the caller fix. This run declares no follow-on.

NOT MERGED
