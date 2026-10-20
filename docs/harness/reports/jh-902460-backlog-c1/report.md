# Record JH-902460: bound Postgres reservation leases

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902460
Run: `jh-902460-backlog-c1`
Run branch: `codex/jh-902460-backlog-c1`
Tip tested: `38c4ec81912f2dfd6556483df995b7ce6227e51b`
Parent branch: `jj/activity-feed`, tip `7a6e1daee2992391fe920fe382c5c119ac8f2bbf`
Worktree: `/home/jakej/gh/huly-platform-worktrees/jh-902460-backlog-c1`

## Base and merge note

The brief opens with `branch base jj/activity-feed` and then names
`origin/main` tip `694ba075c47702fbfb792f957903832fb97e0907` as the start. That
object does not exist in this repository. `git cat-file -t 694ba075...` returns
"could not get object info". In `jacobjennings/platform`, `origin/main` is the
upstream Huly mirror at `33f141364aeef905ac6fbf029a46e3bc123239ae` from
2026-07-03, not the fork integration branch. The fork integration branch is
`jj/activity-feed`, which is the branch this worktree was cut from. No
`origin/main` merge was done. Merging upstream Huly main into a fork branch
would not be the same change, and the branch would inherit months of upstream
conflicts unrelated to this card.

## What the card claimed, checked against the branch

- `foundations/core/packages/postgres-base/src/index.ts` had a `ConnectionInfo`
  per managed context. `withReserve` kept one reserved connection in
  `available` after each call, so every live managed context could cache one
  pool lease indefinitely.
- `foundations/server/packages/postgres/src/storage.ts:232` registers a managed
  context for `client_` and `client_async_` request ids through
  `reserveContext`.
- `foundations/server/packages/server/src/client.ts:272` and `:291` reserve the
  synchronous transaction context and the asynchronous context. The
  asynchronous `onEnd` runs only when every async request settles, so a long
  presence chain kept its cached lease for the life of the chain.
- `server-plugins/chunter-resources/src/index.ts:436` (`syncChat`) and `:497`
  (`OnUserStatus`) run `findAll` lookups under that asynchronous context. These
  are reads and do not need a dedicated connection.

The reported cycle is therefore real on this branch. Ten idle contexts could
own all ten pool connections, and a new model load's transaction waited for a
reservation that no idle context would release.

## What changed

`foundations/core/packages/postgres-base/src/index.ts`

- `ConnectionInfo.withReserve` (`:291`) now holds a reservation only while an
  action runs. Reads run on the pool and never cache a connection.
- A transaction takes an idle lease if the context already owns one. Otherwise
  it calls `ConnectionMgr.releaseIdleLeases` (`:325`, `:418`) before waiting for
  a pool connection, so a wait is never queued behind idle reservations.
- `ConnectionMgr` bounds idle leases with `maxIdleLeases` (`:398`, `:402`). The
  pool factory passes `Math.floor(poolMax / 2)` (`:241`), so a ten connection
  pool keeps at most five idle leases even if nothing asks for capacity.
- `reserveWithTimeout` (`:351`) cancels a reservation wait after
  `reserveTimeoutMs`, 30 seconds by default, configurable with
  `POSTGRES_RESERVE_TIMEOUT_MS`. A reservation that resolves after the timeout
  is released, so cancellation cannot leak a connection.
- `ConnectionMgr.stats` (`:432`) reports managed contexts, idle leases and
  active leases. The tests use it to assert the reservation state.
- `release(id)` and `close(mgrId)` still mark the context released and drop any
  idle lease. An active lease is released when its action finishes.

Transaction semantics are unchanged. `write` still reserves one connection for
`BEGIN`, the transaction body and `COMMIT`. `retry` still runs read SQL on the
pool. The only removed behavior is caching a pool connection in an idle managed
context.

No server file needed a change. `reserveContext` still registers each request
context and `onEnd` still releases it. The leak was the cached lease inside
`ConnectionInfo`, not the registration.

## Tests

New file: `foundations/core/packages/postgres-base/src/__tests__/connection.test.ts`

It covers the reported cycle and cancellation:

1. an idle lease is released before a transaction waits,
2. idle leases are bounded per manager,
3. sixteen managed contexts share a ten connection pool through five presence
   lookup and derived write rounds,
4. a presence lookup on an asynchronous context holds no lease while idle,
5. a reservation that cannot get a connection is cancelled and the late
   reservation is released,
6. a context released during a transaction releases its lease.

The existing storage suite `foundations/server/packages/postgres/src/__tests__/conversion.spec.ts`
constructs `ConnectionMgr` and exercises the adapter, so it was run as well.

Gate table, from
`docs/harness/reports/jh-902460-backlog-c1/gate-results.jsonl` on commit
`38c4ec81912f2dfd6556483df995b7ce6227e51b`:

```
| File | Tree | rc | Ran | Failures | Errors | Skipped | Excluded | Seconds | Jobs | Batch seconds |
|---|---|---|---|---|---|---|---|---|---|---|
| foundations/core/packages/postgres-base/src/__tests__/connection.test.ts | 524c0cb4 | 0 | None | None | None | None | None | 1 | 1 | 1 |
| foundations/server/packages/postgres/src/__tests__/conversion.spec.ts | 524c0cb4 | 0 | None | None | None | None | None | 1 | 1 | 1 |

2 runs, 2 rc 0, 0 not rc 0
```

The gate stores `None` for these Jest runs because its count parser does not
read Jest's summary. The raw log lines from those two gate runs are:

```
Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Ran all test suites matching /connection.test.ts/i.
```

```
Test Suites: 1 passed, 1 total
Tests:       18 passed, 18 total
Ran all test suites matching /conversion.spec.ts/i.
```

Superseded gate attempts are not in the retained results file. Two connection
attempts were runner faults before the test ran: the first needed
`[gate] suite_jobs`, the second left Jest's cache folder in the gate TMPDIR.
The cache directory is now inside the package's ignored `.build` folder. One
conversion attempt failed to resolve `@hcengineering/core` before workspace
dependencies were built. After
`node common/scripts/install-run-rush.js build --to @hcengineering/postgres`
succeeded, the same file passed on the same commit.

Other checks on the tip:

- `rush build --to @hcengineering/postgres`: success, 11 operations.
- `compile` in `foundations/core/packages/postgres-base`: rc 0.
- `python3 launch/no-project-names-test.py`: not present in this repository,
  so it could not run. The same is true of
  `python3 checks/configured-values-test.py`. Both paths exist in the
  jake-harness repository, not in huly-platform.

The gate needs a `harness.toml` in the checkout. This branch has none, because
commit `7a6e1daee` removed the fork harness settings. A local, uncommitted
`harness.toml` was used only to run the gate. It contains the Jest commands
above and is excluded from `git status`. It is not part of this branch.

## Not run

The measured acceptance matrix was not run. It needs the `dev/board-load` rig
from `codex/jh-902455-load-profile-c1` against a running local server, sixteen
distinct local users, contact records and a CockroachDB instance. This worker
has no such stack in its worktree, and the card forbids contacting `huly.lan`.
So these acceptance items remain unverified here:

- the before and after ten connection pool reproduction,
- shared-account and separate-account bursts,
- connects and health reads during presence triggers and after a disconnect,
- SQL activity and blocked model load counts on the real server.

The focused reservation and cancellation tests above are the part this change
can verify without that rig.

## Files changed

- `foundations/core/packages/postgres-base/src/index.ts`
- `foundations/core/packages/postgres-base/src/__tests__/connection.test.ts`
- `docs/harness/reports/jh-902460-backlog-c1/report.md`
- `docs/harness/reports/jh-902460-backlog-c1/gate-results.jsonl`
- `docs/harness/reports/jh-902460-backlog-c1/gate-run-logs/` (two logs)

## RECOMMENDATIONS

- Run the `dev/board-load` matrix on a local stack at `38c4ec8` before treating
  the production stall as closed. Record idle and active leases with
  `ConnectionMgr.stats`, plus SQL session counts and model load latency.
- Consider making `POSTGRES_RESERVE_TIMEOUT_MS` part of the server settings
  rather than an environment variable if operators need a different value.
- Watch write latency after this change. Each transaction now reserves a pool
  connection instead of reusing an idle cached one. The pool already served
  unmanaged writes this way, so the added cost should be small, but the load
  matrix should confirm it.

Review: not yet run.
