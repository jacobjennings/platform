# JH-902454 backlog c4: merge origin/jj/activity-feed into the JH-902454 branch

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902454
(Huly fork logging of rate-limit refusals, slow requests, slow connects, event loop delay and slow SQL)

Branch: `codex/jh-902454-backlog-c4`
Start tip: `9cc7f6ffb` (reviewed tip, verdict Merge)

## Status

- Merge of `origin/main` at `33f141364`: done. `git merge-base --is-ancestor origin/main HEAD` returned true.
- Merge of `origin/jj/activity-feed` at `45533155e`: done, commit `618ddec36`.
  `git merge-base --is-ancestor origin/jj/activity-feed HEAD` returned true.
- Push to `origin codex/jh-902454-backlog-c4`: **blocked**. The push guard refused it (see "Push blocked").
- Tests and typecheck: see "Checks run".

## Conflicts resolved

Two files conflicted. Three hunks in total.

### foundations/server/packages/server/src/sessionManager.ts (2 hunks, JH-902459)

Both hunks in `handleRequest` (websocket path, around line 1622) and `handleRPC` (around line 1731).

- Kept the refusal test `rateLimit?.retryAfter !== undefined` (and `rateLimitStatus?.retryAfter !== undefined` in `handleRPC`).
- Added `this.logRateLimitRefusal(...)` as the first statement inside each branch.
- Dropped this card's `remaining === 0` test.

Why `retryAfter`, not `remaining === 0`: `checkRateLimit` in
`foundations/core/packages/rpc/src/sliding.ts` returns `remaining: 0` for the last
accepted request, with no `retryAfter`. Only a refusal sets `retryAfter` (lines 27 to 47 of that file).
A `remaining === 0` test would refuse that accepted request.

Brief note: the brief said to keep "HEAD's `retryAfter !== undefined` condition". In the
conflict markers that condition is on the `origin/jj/activity-feed` side. HEAD had
`remaining === 0`. I kept the `retryAfter` condition because that is what the brief intends.

### foundations/core/packages/client-resources/src/connection.ts (1 hunk, JH-902461)

Rate-limit retry in `handleMsg`, around line 407.

- Kept JH-902461's `retryTimers` set and its `if (!this.closed)` guard inside the timer.
- Added this card's `retryAfterMs` variable, the `rateLimitWaits.wait(retryAfterMs, ++this.rateLimitWaiting)` call, and `this.rateLimitWaiting--` when the timer fires.
- `clearRetryTimers()` now also does `this.rateLimitWaiting--` for each timer it cancels. The counter stays in step when a closed connection drops its timers. `clearRetryTimers()` is called only from `close()`.
- The timer deletes itself from `retryTimers` when it fires, so a fired timer is never decremented twice.

## Other things in the merge

- `harness.toml` is deleted by `origin/jj/activity-feed` (commit `7a6e1daee`, "Remove the fork harness settings: huly-platform work runs under jake-harness settings via [repos.huly-platform] (owner, 19 Oct 2026)"). This is not a conflict. The merge applies the branch's deletion as it is. Check with the reviewer before merge.
- `origin/jj/activity-feed` adds a `dev/board-load/` tree. The largest file it adds is `dev/board-load/vendor/huly-board.cjs` at 244,515 bytes. No added file is over the 10 MB merge-gate limit. Measured with `git cat-file -s` on the added files.
- The merge brings in 64 changed files. The merge diff is `git diff --stat 9cc7f6ffb 618ddec36` if the reviewer wants it.

## Push blocked

`git push origin HEAD:refs/heads/codex/jh-902454-backlog-c4` was refused by the git force-push guard:

```
commit-identity-check.py: refusing. Correct the identities with a follow-up rewrite only under the owner's direction; there is no override flag.
```

The guard checks `origin/jj/activity-feed..HEAD`. Five commits in that range were
authored by others. They came into the branch from `origin/main` through the required
merge. They are not commits this worker made:

| commit | author | committer |
|---|---|---|
| 33f141364 | Artyom Savchenko <armisav@gmail.com> | Artyom Savchenko <armisav@gmail.com> |
| 8541588be | Artyom Savchenko <armisav@gmail.com> | GitHub <noreply@github.com> |
| 9f476206d | Artyom Savchenko <armisav@gmail.com> | Artyom Savchenko <armisav@gmail.com> |
| 5bda0e790 | Artyom Savchenko <armisav@gmail.com> | GitHub <noreply@github.com> |
| 1af4f1017 | shanzez <78763240+shanzez@users.noreply.github.com> | GitHub <noreply@github.com> |

The other 13 commits in the range (this card's commits and the two merges) use Jacob Jennings
<jacob.r.jennings@gmail.com>, which is the configured identity. Checked with
`git log --format='%h | author %an <%ae> | committer %cn <%ce>' origin/jj/activity-feed..HEAD`.

I did not bypass the guard, did not rewrite any commit, and did not change any identity.
The run branch is committed locally at `618ddec36` (plus this report commit) and is not pushed.

Decision for the owner: either allow the five upstream `origin/main` commits to be pushed
from this worktree, or drop the `origin/main` merge from this run branch and push only the
`origin/jj/activity-feed` merge. My recommendation is the first. The brief requires the
`origin/main` merge, the reviewer expects it, and the commits are upstream history, not worker
edits. The guard message says that only the owner can decide this.

## Environment notes

- The default `node` on this machine is v26.10.0 (`/usr/bin/node`). The repo supports `>=20.0.0 <25.0.0`. The first `install-run-rush.js install` refused to run under it.
- I downloaded the official Node 24 LTS binary, `node-v24.22.0-linux-x64.tar.xz`, from nodejs.org. I checked it against `SHASUMS256.txt` from the same release directory. It is extracted under `/tmp/jake-harness-workers/opiuUv0Z/node24`, outside the repo. I did not install it system-wide.
- The first Node 24 install failed in the puppeteer postinstall. It tried to download headless Chrome, and `~/.cache/puppeteer/chrome-headless-shell/linux-142.0.7444.61` exists without its executable. I left that cache directory alone and reran with `PUPPETEER_SKIP_DOWNLOAD=1`. The unit tests here do not use a browser.
- The install ran with `CUDA_VISIBLE_DEVICES` set empty, and with `HULY_BOARD_CONFIG` and `VIKUNJA_BASE_URL` pointed at `127.0.0.1:9`. No command contacted `huly.lan`.

## Checks run

All checks ran on the merge commit `618ddec36`, the last code commit. Nothing was run on `origin/main`.

Typecheck (rush validate, Node 24.22.0):

| target | command | result |
|---|---|---|
| @hcengineering/server | `node common/scripts/install-run-rush.js validate --to @hcengineering/server` | exit 0, build and validate both completed |
| @hcengineering/client-resources | `node common/scripts/install-run-rush.js validate --to @hcengineering/client-resources` | exit 0, build and validate both completed |

Direct typecheck, to confirm the changed files are in the program:

- `tsc --noEmit -p tsconfig.json` in the server package: exit 0. The program lists 290 files, including `src/sessionManager.ts`.
- `tsc --noEmit -p tsconfig.json` in the client-resources package: exit 0. The program lists 147 files, including `src/connection.ts` and `src/rateLimitWait.ts`.

Targeted jest files, each run once (`./node_modules/.bin/jest --silent <file>`), with the Node 24 PATH:

| package | file | suites | tests | result |
|---|---|---|---|---|
| server | `src/__tests__/sessionManager.test.ts` | 1 passed | 95 passed | pass |
| server | `src/__tests__/diagnostics.test.ts` | 1 passed | 12 passed | pass |
| client-resources | `src/__tests__/connection.test.ts` | 1 passed | 4 passed | pass |
| client-resources | `src/__tests__/cancellation.test.ts` | 1 passed | 4 passed | pass |
| client-resources | `src/__tests__/rateLimitWait.test.ts` | 1 passed | 2 passed | pass |

Totals: 5 files, 117 tests, 0 failed.

Search that found the test files: `rg -ln 'sessionManager|SessionManager|rateLimitWait|RateLimitWait|connection' --glob '*.test.ts' foundations/server/packages/server foundations/core/packages/client-resources`, then `rg -n "from '\.\./(sessionManager|connection|rateLimitWait)'"` on the `__tests__` folders. The two server tests import `TSessionManager`. `connection.test.ts` and `cancellation.test.ts` import `connect`. `rateLimitWait.test.ts` imports `RateLimitWaitLogger`.

Not run: the full suite, and the `integration.test.ts` file in client-resources. The brief excluded the full suite. I did not run `integration.test.ts` because it is not one of the files named for the two changed modules.

No new tests were written.

## RECOMMENDATIONS

1. **Owner decision on the identity guard.** The run branch cannot be pushed while the five upstream `origin/main` commits are in `origin/jj/activity-feed..HEAD`. Choose one: allow those upstream commits through the guard, or drop the `origin/main` merge from this run branch. I recommend allowing them. The brief requires the `origin/main` merge, the reviewer expects it, and the commits are upstream history. Nothing here was rewritten.
2. **`harness.toml` is gone on the branch.** `origin/jj/activity-feed` deletes it (commit `7a6e1daee`). `docs/harness/worker-guide.md` still says worker routes are in `harness.toml`. The reviewer should decide whether the guides need an update.
3. **Brief label mismatch.** The brief said to keep HEAD's `retryAfter !== undefined` condition in `sessionManager.ts`. That condition was on the incoming side. I kept `retryAfter`, for the reason given under "Conflicts resolved". Future briefs should name the side by branch, not as HEAD.
4. **Two report paths in the brief.** The Files list names `docs/reports/jh-902454-backlog-c4/report.md`. The finishing section names `docs/harness/reports/jh-902454-backlog-c4/report.md`. This report is written to both paths with the same content. Pick one path for future briefs.
5. **Default Node is outside the supported range.** `/usr/bin/node` is v26.10.0 and `rush.json` allows `>=20.0.0 <25.0.0`. Rush refuses to install under it. A harness launcher should put a supported Node on PATH. This is a harness setting, so it goes to the JakeHarnessDirector.
6. **Partial puppeteer cache.** The puppeteer postinstall failed on `~/.cache/puppeteer/chrome-headless-shell/linux-142.0.7444.61`, which exists without its executable. I did not touch it. The owner may want to clear it, or the install step may want `PUPPETEER_SKIP_DOWNLOAD=1`.
7. **Owner review of the merge.** The merge brings in the `dev/board-load/` tree and its vendored `huly-board.cjs` (244,515 bytes, under the 10 MB limit). Nothing was reviewed beyond that size check.
