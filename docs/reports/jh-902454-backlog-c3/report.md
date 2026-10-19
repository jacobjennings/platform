# JH-902454: transactor stall diagnostics

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902454
Branch: `codex/jh-902454-backlog-c3`
Base: `2a1d72f9e1acbc580dbb18eea1e79a6f4afbf4af`

## What changed

Additive logging only. No rate limit, timeout, retry or response was changed.

### 1. Rate limit refusals (server)

`foundations/server/packages/server/src/diagnostics.ts:63` adds `RateLimitRefusalLogger`.
It emits `rate limit refused` through `ctx.warn` with the user, the service, the
limit, the window, `retryAfter`, the request method and a refusal count. It emits
at most one line per limiter key per 10 seconds. Refusals suppressed since the
previous line are counted into the next line.

`foundations/server/packages/server/src/sessionManager.ts:1490` wires it into the
websocket path at `:1615` and into the RPC path at `:1718`.

### 2. Rate limit waits (client)

`foundations/core/packages/client-resources/src/rateLimitWait.ts:21` adds
`RateLimitWaitLogger`. It emits one `rate limit wait` warning per wait burst with
`retryAfterMs`, the number of requests waiting and the burst refusal count.

`foundations/core/packages/client-resources/src/connection.ts:290` creates the
logger and `:330` calls it in the existing `remaining === 0` retry branch. The
retry timer and resend are unchanged.

### 3. Slow requests (server)

`foundations/server/packages/server/src/sessionManager.ts:1503` logs `slow request`
when total time reaches `HULY_SLOW_REQUEST_MS` (default 2000). The line carries
the method, class and query keys for `findAll`, result count, user, service,
session id, and queued time (receipt to execution start) and execution time.

The result count comes from `foundations/server/packages/server/src/client.ts:83`
and `:228`, which records the length of the find result per request id. The value
is removed after it is logged.

### 4. Connect timing (server)

`diagnostics.ts:166` adds `ConnectTimings`. The manager records hello time at
`sessionManager.ts:1824` and clears it on close at `:1195`. The first completed
`findAll` or `loadModel` response is timed. A time over `HULY_SLOW_CONNECT_MS`
(default 5000) logs `slow connect` with the session id and the elapsed time.

### 5. Event loop delay (server)

`diagnostics.ts:203` wraps `perf_hooks.monitorEventLoopDelay`. At each minute
boundary the manager reads p50 and p99 and resets the histogram. A p99 at or over
`HULY_EVENT_LOOP_WARN_MS` (default 200) logs `event loop delay`
(`sessionManager.ts:403`).

### 6. Per-minute summary (server)

`diagnostics.ts:106` adds `MinuteRequestStats`. `sessionManager.ts:359` logs one
`minute summary` line per minute. For each user and service key it includes
requests, refusals, max and p95 request time, open sessions and sessions that sent
hello but never completed a find or load model. It also includes event loop p50,
p99 and heap used.

### 7. Slow SQL (postgres)

`foundations/server/packages/postgres/src/diagnostics.ts:62` wraps `DBClient.execute`
and `:92` wraps `ConnectionMgr.retry` and `write`, so statements through the
adapter client and the manager callbacks are timed. A statement at or over
`HULY_SLOW_SQL_MS` (default 1000) logs `slow sql` with the whitespace-normalized
statement, row count and duration. Parameter values stay in the parameters array,
so the statement text carries only `$n` placeholders.

Wiring is in `foundations/server/packages/postgres/src/storage.ts:2168` and `:2191`.

## Limits

- The raw cursor path (`connection.raw().unsafe(...).cursor(...)` in
  `findAll` with a memory limit, and `createCursorGenerator`) is not timed. The
  normal `connection.execute` find path and all transaction writes are timed.
- The client-side wait line uses the existing client `MeasureContext`, not a new
  logger, so it appears in the same JSON stream as other client warnings.

## Merge base

This fork has no `origin/main`. Its base branch is `origin/jj/activity-feed`, and
`harness.toml` names it as `[checks] base`. `git merge-base --is-ancestor
origin/jj/activity-feed HEAD` succeeded at `2a1d72f9e`, so no merge was needed and
none was made. No later merge was made either.

## Measurements

- `git diff --name-only origin/jj/activity-feed...HEAD`: 10 files, all under the
  three changed packages. No files outside the task were touched.
- Build: `node common/scripts/install-run-rush.js build --to @hcengineering/server
  --to @hcengineering/client-resources --to @hcengineering/postgres` exited 0.
- Validate: `node common/scripts/install-run-rush.js validate --to ...` for the
  same three packages exited 0.

## Tests

All commands ran on the tip `ef3dac01c`, with
`HULY_BOARD_CONFIG={"url":"http://127.0.0.1:9","offline":true}` and
`VIKUNJA_BASE_URL=http://127.0.0.1:9`.

| Test file | Command | Result |
| --- | --- | --- |
| `foundations/server/packages/server/src/__tests__/diagnostics.test.ts` | `npx jest src/__tests__/diagnostics.test.ts --silent --forceExit` | passed, 12 tests |
| `foundations/server/packages/server/src/__tests__/sessionManager.test.ts` | `npx jest src/__tests__/sessionManager.test.ts --silent --forceExit` | passed, 95 tests |
| `foundations/core/packages/client-resources/src/__tests__/rateLimitWait.test.ts` | `npx jest src/__tests__/rateLimitWait.test.ts --silent --forceExit` | passed, 2 tests |
| `foundations/core/packages/client-resources/src/__tests__/connection.test.ts` | `npx jest src/__tests__/connection.test.ts --silent --forceExit` | passed, 4 tests |
| `foundations/server/packages/postgres/src/__tests__/diagnostics.spec.ts` | `npx jest src/__tests__/diagnostics.spec.ts --silent --forceExit` | passed, 4 tests |
| `foundations/server/packages/postgres/src/__tests__/storage.test.ts` | `npx jest src/__tests__/storage.test.ts --silent --forceExit` | could not run, `ECONNREFUSED` on `localhost:26258`, no PostgreSQL service in this run |

The new tests drive each of the seven log lines:

1. `rate limit refused` from `RateLimitRefusalLogger` and from the manager method.
2. `rate limit wait` from `RateLimitWaitLogger`.
3. `slow request` from the manager method with queued and execution time.
4. `slow connect` from the manager method after hello.
5. `event loop delay` from the manager minute boundary with a fake histogram.
6. `minute summary` from the manager minute boundary.
7. `slow sql` from the wrapped client with a stubbed slow statement.

## Harness checks

- The gate runner refused this repository before any test started:
  `isolated-run: refused: could not verify changed-file:... git diff
  origin/main...HEAD failed: fatal: ambiguous argument 'origin/main...HEAD'`.
  The fork has no `origin/main`, so `gate/isolated_run.py` cannot run here and no
  `gate-results.jsonl` exists. The same files were run directly with the package
  jest runner, as listed above.
- `python3 launch/no-project-names-test.py` and
  `python3 checks/configured-values-test.py` are not present in the pinned harness
  folder (`huly-platform-pin-9054554`), so neither could run. The changed files
  contain no machine-specific project names or configured limits.

## RECOMMENDATIONS

- On the next incident, read `minute summary` first. A rising refusal count with a
  falling request count and open sessions that never complete a find points at the
  shared per account rate limit. A rising event loop p99 with slow SQL rows points
  at the transactor or database instead.
- Consider extending the slow SQL timer to the raw cursor path if the next
  investigation involves memory-limited finds.
- The harness gate for this fork needs a `[tests] file_pattern` and `file_command`
  that run jest, and a base ref other than `origin/main`, before per-card gate
  runs can produce `gate-results.jsonl`.
