# JH-902454 backlog c5: rebuild of the reviewed diagnostics change

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902454
Branch: `codex/jh-902454-backlog-c5`
Base: `origin/jj/activity-feed` at `45533155e932bed30bcc996413362b12e2df3cac`
Source: reviewed commits `2a1d72f9e..9cc7f6ffb49e` (branch `codex/jh-902454-backlog-c3`)

## What this run did

The reviewed change was rebuilt as owner-authored commits on top of the base.
No new code was written. Only the two conflicts described below needed a
decision.

## Brief deviations

- **origin/main was not merged.** The brief has a "Merge origin/main once"
  heading, but its "DO NOT merge origin/main" note and the orchestrator note
  both say not to. This run followed the "do not merge" rule. No `merged main`
  line applies.
- **Report path.** The Files list names `docs/reports/jh-902454-backlog-c5/report.md`.
  The finishing section names `docs/harness/reports/jh-902454-backlog-c5/report.md`.
  This report is written to both paths with the same content. The reviewed
  branch also carries both paths for its c3 report.
- **Run log directory is read-only.** `/home/jakej/.local/state/jake-harness/waves/jh-902454-backlog-c5`
  returned "Read-only file system" for a log write. Logs went to the run temp
  directory instead.
- **Node version.** `rush.json` requires Node `>=20.0.0 <25.0.0`. The default
  Node on this machine is 26.10.0, and rush refused to run under it. See
  "Toolchain" below.

## Commits

Eleven non-merge commits were cherry-picked oldest first. Each keeps the
original author (Jacob Jennings) and message. The commit message check found no
AI attribution, co-author trailer, or vendor or model name.

| Reviewed commit | Rebuilt commit | Subject |
| --- | --- | --- |
| 6cb719168 | d79300d83 | Log rate limit waits, slow requests, slow SQL and minute diagnostics (JH-902454) |
| 9f05bd489 | b0f049dd6 | Add targeted diagnostics tests and keep the minute summary type at module scope |
| ef3dac01c | 964dc3b5b | Keep the rate limit key in the minute summary for system sessions |
| f877ec6b5 | 9789ea323 | Add the JH-902454 diagnostics report |
| 56e79955c | c5a6eea2c | Review diagnostics branch in progress |
| c403162ca | 81fc10cdb | Fix diagnostic redaction and request accounting |
| 0a84f60aa | 233c11b52 | Guard browser session setup when Node exposes storage |
| ee63172b7 | cb6d61e0e | Count completed responses separately from connect readiness |
| 36aa43c82 | cd1bdc4bc | Review diagnostics branch with applied fixes |
| ac31a81ef | 9294b6175 | Record review checks and offline routing refusal |
| 9cc7f6ffb | 83fd2c2f3 | Record final prose checker warnings |

Tip: `83fd2c2f3`. Pushed with
`git -C <worktree> push origin HEAD:refs/heads/codex/jh-902454-backlog-c5`
as a fast-forward from `45533155e`. The push went in two steps, `d79300d83`
first and then `83fd2c2f3`.

Commits after the last code commit `cb6d61e0e` change only docs. Checked with
`git diff --stat cb6d61e0e HEAD`, which lists three files under `docs/`.

## Conflict resolutions

### 1. `6cb719168`, `sessionManager.ts` (two spots)

HEAD used `if (rateLimit?.retryAfter !== undefined)`. The reviewed commit used
`remaining === 0`. Per the brief, HEAD's condition was kept. The card's
`this.logRateLimitRefusal(...)` call was added as the first statement inside
that `if` in both places:

- `checkRate` path in the request handler, `logRateLimitRefusal(service, rateLimit, request.method)`
- `handleRPC`, `logRateLimitRefusal(service, rateLimitStatus, method)`

### 2. `6cb719168`, `connection.ts`

HEAD (JH-902461) kept the timers in `retryTimers`, deleted each timer when it
fires, and skipped the retry when `this.closed` is set. Those were kept. The
card's counting was added on top:

- `private rateLimitWaiting = 0` next to `rateLimitWaits`.
- When a retry timer is set: `this.rateLimitWaits.wait(retryAfterMs, ++this.rateLimitWaiting)`.
- When a retry timer fires: `this.rateLimitWaiting--`, before the `!this.closed` guard.
- In `clearRetryTimers()`, which `close()` calls: `this.rateLimitWaiting--` for each
  timer cleared. Each timer that is cleared was counted once when it was set, so
  the counter comes back down when a closed connection's timers are cleared.

The `setTimeout` now uses `retryAfterMs`, which is `retryAfter ?? 1`, the same value
HEAD used.

### 3. `c403162ca`, `connection.ts`

The reviewed commit replaced HEAD's timer with a plain promise and kept the
`rateLimitWaiting--`. The resolution kept HEAD's timer code, which has the
`retryTimers` set and the `!this.closed` guard. It already had the same
`rateLimitWaiting--`, so the reviewed commit's counting was preserved. Nothing
else from that commit was lost.

## Net change against the base

`git diff --stat 45533155e HEAD` shows 15 files, 1526 insertions and 21 deletions.
Code files:

- `foundations/core/packages/client-resources/src/connection.ts`
- `foundations/core/packages/client-resources/src/rateLimitWait.ts` (new)
- `foundations/core/packages/client-resources/src/__tests__/rateLimitWait.test.ts` (new)
- `foundations/server/packages/postgres/src/diagnostics.ts` (new)
- `foundations/server/packages/postgres/src/storage.ts`
- `foundations/server/packages/postgres/src/__tests__/diagnostics.spec.ts` (new)
- `foundations/server/packages/server/src/client.ts`
- `foundations/server/packages/server/src/diagnostics.ts` (new)
- `foundations/server/packages/server/src/sessionManager.ts`
- `foundations/server/packages/server/src/__tests__/diagnostics.test.ts` (new)

Docs: the c3 diagnostics report, the review folder, and the c3 report copies.

Files outside the brief's Files list changed. The reviewed change needs them,
so the rebuild keeps them. The files are the cherry-picked change itself, not
new edits.

Comparison with the reviewed change: `git diff 2a1d72f9e 9cc7f6ffb49e -- foundations`
against `git diff 45533155e HEAD -- foundations`. They differ only in these spots.
In `connection.ts`, the JH-902461 retry timers with the `!closed` guard are kept,
and `clearRetryTimers()` lowers `rateLimitWaiting` for each timer it clears.
In `sessionManager.ts`, HEAD's `retryAfter !== undefined` condition replaces the
reviewed `remaining === 0` condition in both places. Nothing else differs.

## Toolchain

- `node common/scripts/install-run-rush.js install` under the default Node 26.10.0
  exited 1 with the rush engine error (`nodeSupportedVersionRange ">=20.0.0 <25.0.0"`).
- Fix used: the `node-linux-x64@22.23.3` package was installed with npm into
  `/tmp/jake-harness-workers/opFo5EeR/node22`. Its `bin` directory was put first
  on `PATH` for rush commands only. The system Node was not changed.
- The second install attempt failed in the puppeteer postinstall. Its Chrome
  download failed because `/home/jakej/.cache/puppeteer/chrome/linux-142.0.7444.61`
  exists without its executable. The third attempt set `PUPPETEER_SKIP_DOWNLOAD=1`
  and exited 0. The existing cache folder was not changed. No browser is needed
  for the targeted tests.
- Jest cannot resolve workspace packages until they are built. The first
  test run failed with `Cannot find module '@hcengineering/client'` and
  `Cannot find module '@hcengineering/account-client'`. A targeted
  `rush build --to` for the three packages fixed this. The build ran 15 operations
  and succeeded.
- No sudo, pkexec or package manager changes were used.

## Tests and typecheck

Tip tested: `83fd2c2f3`. The last code commit is `cb6d61e0e`. Every commit
after it changes only docs, so the tested code is the same as `cb6d61e0e`.

Targeted test search, run from the worktree:

    grep -rln -E "connection'|sessionManager|rateLimitWait|diagnostics'" foundations/core/packages/client-resources/src foundations/server/packages/server/src foundations/server/packages/postgres/src --include=*.ts

Test files that import or run the changed code: seven files. Each ran with
`npx jest <file>` in its package directory, under Node 22.23.3, with the brief's
environment variables and `CUDA_VISIBLE_DEVICES` empty.

| Package | Test file | Result | Count | Note |
| --- | --- | --- | --- | --- |
| client-resources | `src/__tests__/rateLimitWait.test.ts` | passed | 2 of 2 | First run |
| client-resources | `src/__tests__/connection.test.ts` | passed | 4 of 4 | First run did not start (missing build). Passed on rerun. |
| client-resources | `src/__tests__/cancellation.test.ts` | passed | 4 of 4 | Run after the build |
| client-resources | `src/__tests__/integration.test.ts` | passed | 14 of 14 | Run after the build |
| postgres | `src/__tests__/diagnostics.spec.ts` | passed | 4 of 4 | First run |
| server | `src/__tests__/diagnostics.test.ts` | passed | 12 of 12 | First run did not start (missing build). Passed on rerun. |
| server | `src/__tests__/sessionManager.test.ts` | passed | 95 of 95 | First run did not start (missing build). Passed on rerun. |

Totals: 7 files, 135 tests, all passed on the tip.

Typecheck:

- `rush build --to @hcengineering/client-resources --to @hcengineering/server --to @hcengineering/postgres`:
  15 operations, success. This was a fresh build.
- `rush validate` with the same targets: 15 operations, all restored from the rush
  build cache. This is not a fresh compile, so it is not counted as evidence.
- `compile validate` run directly in `client-resources`, `server` and `postgres`
  (the package's own `_phase:validate`): exit 0 for all three. Each log has one
  line, the validate time, and no error lines. This is the fresh typecheck.
- No negative control was run. A deliberate type error was not added to show
  that validate fails on bad code.

Not run: the full suite, because the worker guide keeps it for the merge lane.
No other test in these packages was run.

## RECOMMENDATIONS

- **Brief text conflicts.** The brief says both to merge `origin/main` and not to.
  It also gives two report paths and an empty "Tests" list. The Director should
  fix the brief template so one instruction stands.
- **Run log directory is read-only.** Workers cannot write to
  `/home/jakej/.local/state/jake-harness/waves/jh-902454-backlog-c5`. The Director
  should check the mount or the permissions. Logs for this run are in the worker's temp directory.
- **Default Node is outside the repo's range.** `rush.json` allows Node
  `>=20.0.0 <25.0.0`, and the machine default is 26.10.0. Harness workers need a
  pinned Node 22 or 24 route. This is an owner decision. Nothing was changed here.
- **Puppeteer cache can break installs.** The folder
  `~/.cache/puppeteer/chrome/linux-142.0.7444.61` exists without its executable,
  so `rush install` fails until the download is skipped. The owner may want to
  clear that folder. It was not touched.
- **Rush validate can hide a fresh typecheck.** The cache restored all 15 validate
  operations. Merge checks should run `compile validate` directly, or disable the
  cache, before counting a typecheck as fresh.
- **Two report paths.** This report is written to both `docs/reports/` and
  `docs/harness/reports/`. The reviewer should keep one and remove the other.
- **Reviewer focus.** Read the two resolved places. In `connection.ts`, check the
  retry-timer block and the `rateLimitWaiting--` in `clearRetryTimers()`. In
  `sessionManager.ts`, check that the `retryAfter !== undefined` condition in both
  places has `logRateLimitRefusal` inside it.
