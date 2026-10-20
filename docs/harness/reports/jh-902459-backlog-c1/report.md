# Record: JH-902459 correct rate-limit rejection accounting. Review: not yet run.

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902459
Repository: jacobjennings/platform (huly-platform fork)
Parent branch: jj/activity-feed at 7a6e1daee2992391fe920fe382c5c119ac8f2bbf
Branch: codex/jh-902459-backlog-c1
Code tip tested: 28cd29c3d89bfe2f5b980cc09c7a790d17cc5a9e

## Base note

The brief named origin/main 694ba075c47702fbfb792f957903832fb97e0907 as the
base. That commit is not in this repository. The fork has no main branch. The
pinned harness sets `[repos.huly-platform] main_branch = "jj/activity-feed"`
(jake-harness `harness.toml` line 756), and commit 7a6e1daee removed the fork's
own `harness.toml` under the 19 Oct owner decision. The worktree was cut from
jj/activity-feed 7a6e1daee, which is the fork's main branch tip.

I merged upstream origin/main 33f141364 once at the start, as the brief asked.
The push guard refused that result with exit 100 from
`launch/commit-identity-check.py` because the five upstream huly commits it
brought in carry their own authors. I removed the unpushed merge and kept the
branch on jj/activity-feed. Nothing from upstream origin/main is in this branch.
The card's own base line names branch base jj/activity-feed, and the parent tip
above is that branch.

## What changed

`foundations/core/packages/rpc/src/sliding.ts`

- Lines 35-49: capacity is checked before anything is recorded. A rejected
  request does not consume a slot and does not increment a rejection counter.
- Line 47: retryAfter is clamped to the window. It is at least 1 ms and at most
  one window, so a client retry, including a model load retry, is bounded.
- Lines 31-33 and 51: only accepted requests are stored, always at their own
  check time. The old rejectedRequests counter and the five-window future
  timestamp are removed. No stored time is later than now.
- Lines 40 and 46: reset names the time the oldest accepted request leaves the
  window, so the response points at real capacity.

The account and service scope is unchanged. `sessionManager.ts:1378-1397` still
keys user budgets by account plus service and system budgets by service plus
workspace, with the same 1,500 request and 30,000 ms defaults.

`foundations/core/packages/rpc/src/test/rateLimit.spec.ts`

- Lines 130-251: five focused tests for exact capacity, window boundaries, a
  1,500-request burst with a rejection storm, a throttled model load, and the
  account and service key scope.

## Before and after at the 1,500 limit

Live rig: not run. `dev/board-load` is on branch codex/jh-902455-load-profile-c1
and needs the local Huly stack. This worktree has no stack, and the card forbids
huly.lan contact. The comparison below is a deterministic run of the old and new
limiter code over the same input, 1,500 requests in a 30,000 ms window followed
by 20,000 sends inside the window. The fixed side imports the built `sliding.js`
from this tip.

| Measure | Before | After |
| --- | ---: | ---: |
| Accepted in the first 1,500 sends | 1,499 | 1,500 |
| Rejected in the first 1,500 sends | 1 | 0 |
| Refill accepted at the window boundary | 1,498 | 1,500 |
| Stored timestamps later than now | 1,500 | 0 |
| Largest retryAfter | 179,001 ms | 29,999 ms |
| First accept after the refill | 180,000 ms | 30,000 ms |

The old limiter rejected the 1,500th fitting request, stored every refill
timestamp 150 s in the future after the storm, and made the next usable slot
arrive six windows late. The new limiter accepts exactly 1,500, stores only real
times, and releases the budget one window after the last accepted send.

## Tests

Run from `foundations/core/packages/rpc` under a fresh isolated HOME and TMPDIR,
with HULY_BOARD_CONFIG as the offline JSON object and VIKUNJA_BASE_URL at the
refused loopback port. No PATH or other environment values are recorded here.

```
./node_modules/.bin/jest src/test/rateLimit.spec.ts --runInBand --colors=false --coverage=false
```

| Test file | Commit tested | rc | Suites | Tests |
| --- | --- | ---: | --- | --- |
| foundations/core/packages/rpc/src/test/rateLimit.spec.ts | 28cd29c3d89bfe2f5b980cc09c7a790d17cc5a9e | 0 | 1 passed, 1 total | 11 passed, 11 total |

Exact output lines:

```
PASS src/test/rateLimit.spec.ts
  SlidingWindowRateLimitter
    ✓ should allow requests within the limit (2 ms)
    ✓ should reject requests beyond the limit
    ✓ should allow new requests as the window slides
    ✓ should handle different identifiers separately
    ✓ should handle sliding window correctly
    ✓ check for ban
  SlidingWindowRateLimitter capacity accounting
    ✓ accepts exactly the limit and rejects without consuming capacity (10 ms)
    ✓ releases capacity at the window boundary
    ✓ bounds retry delays and recovers after a 1,500-request burst and rejection storm (399 ms)
    ✓ lets a throttled model load retry after no more than one window (5 ms)
    ✓ keeps the account and service scope of the budget key

Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
Snapshots:   0 total
Time:        0.809 s
Ran all test suites matching /src\/test\/rateLimit.spec.ts/i.
```

Type check: `rush validate --to @hcengineering/rpc` exited 0 with five validate
operations successful. The package tsconfig includes the test file.

`foundations/server/packages/server/src/__tests__/sessionManager.test.ts` was
also attempted because it calls `checkRate`. It could not load with `Cannot find
module '@hcengineering/account-client'` because the rest of the workspace libs
are not built in this worktree. That file does not test a changed file, no
assertion failed, and it is not in the changed-file test set.

## Gate

`gate/isolated_run.py` cannot run in this checkout. It refuses a checkout that
lacks `harness.toml`, and the fork removed that file in 7a6e1daee. The refusal
is:

```
isolated-run: checkout lacks harness.toml
rc=3
```

The same package jest runner the merge gate would call is used above. The test
ran on the code tip, with a fresh isolated HOME and TMPDIR.

## Required checks

`launch/no-project-names-test.py` and `checks/configured-values-test.py` are not
present in huly-platform. Both are jake-harness checks. Neither exists here to
run, and no file in this change adds a project name or a configured value.

## Board and devices

No board contact, no board write and no huly.lan contact. No NVIDIA device was
opened, stat-probed or enumerated. No test used systemctl, systemd-run,
loginctl, a real remote push or HOME=/home/jakej.

## RECOMMENDATIONS

- Run the live `dev/board-load` shared-account burst on the same 1,500 limit
  after merge to confirm the simulated 6x recovery improvement end to end.
- Keep the client pacing decay and retry cancellation work in their own cards.
  This card changes only the server limiter and its bounded response.
- Consider a separate card for limiter metrics, such as accepted and rejected
  counts per account and service. That would expose throttling without changing
  the quota policy.
