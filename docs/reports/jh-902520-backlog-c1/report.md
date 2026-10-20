# Bound and decay adaptive client pacing

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902520

## Result

Complete. `foundations/core/packages/client-resources/src/connection.ts` now
bounds its adaptive per-request delay at 100 ms and lowers that delay by 10 ms
on every healthy response. A response showing less than a third of the account
budget left raises it by 10 ms. A recovered budget no longer carries a penalty
for the lifetime of the connection.

The old counter had two defects. It grew without a bound inside the pressure
branch. The only decrement sat behind `remaining < 50`, which the normal 1,500
request limit never reaches, so a single rejection left a growing delay on every
later request of that connection.

Focused pacing tests cover the delay rule and one persistent connection through
a healthy phase, a nearly spent budget, a rejection with a server retry, and
recovery. The committed mixed migration workload was rerun on the load rig
against the same snapshot and the same corrected server limiter.

## What changed

`nextSlowDownMs(current, rateLimit)` is a small exported function used by
`Connection.handleMsg`. It is the whole pacing policy:

- `remaining * 3 < limit` raises the delay by 10 ms, capped at 100 ms.
- Every other response, including a successful response at the normal limit,
  lowers the delay by 10 ms and never below zero.
- A response without rate-limit information counts as healthy and lowers the
  delay.

The cap keeps one scheduled wait far below an ordinary RPC deadline. The old
run recorded a single later read scheduling 74,070 ms. Ten healthy responses
remove a full 100 ms penalty. `slowDownTimer` keeps its name and meaning, so the
existing load-rig pacing counters still observe the real value.

The retry after a rejection still waits for the server's `retryAfter` and still
bypasses the local pacing delay, as before. The server limiter correction is a
separate change already present on the branch base.

## Measurement

Two layers were used. The first isolates the client pacing rule with the real
`Connection` class, a scripted socket and real timers. The second is the
committed mixed migration workload on the committed local rig.

### Focused pacing measurement

One persistent connection. Each phase sends real `loadModel` RPCs. The scheduled
pacing is read from `slowDownTimer` at the moment `sendRequest` admits a call.

| Phase | Logical RPCs | Wire attempts | Scheduled pacing | Deepest wait | Delay after phase |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before, budget healthy (1,400 of 1,500 left) | 4 | 4 | 0 ms | 0 ms | 0 ms |
| During, budget nearly spent (2 of 1,500 left) | 9 | 9 | 360 ms | 80 ms | 90 ms |
| Rejection (0 left, 25 ms retry) | 1 | 2 | 90 ms | 90 ms | 90 ms |
| After, budget healthy again | 12 | 12 | 450 ms | 90 ms | 0 ms |

The rejection call took at least 100 ms of wall time, from the 90 ms local wait
plus the 25 ms server retry. The last recovery call took under 50 ms. The delay
fell by exactly 10 ms per healthy response and reached zero after nine of them.
Total scheduled pacing over the sequence was 900 ms across 27 wire attempts.

A second test replays the mixed migration shape on one connection: 15 reads and
6 writes in card batches, one rejection, then recovery. It scheduled 420 ms
total, made exactly 22 wire attempts including the retry, and ended at zero
delay.

### Rig measurement

`dev/board-load/run.sh` with `BOARD_LOAD_SCENARIOS=mixed` on this tip, same
restored snapshot, same 1,000 card migration and the same 1,500 request limit.
The rig reads `slowDownTimer` in `instrument.cjs` and counts pacing requests,
scheduled pacing, maximum pacing, RPC sends and rate-limit responses.

| Run | Client pacing | Scheduled pacing | Max per-request pacing | Rate-limit responses | Migration elapsed | findAll | tx |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| JH-902455 before | old, unbounded, old server limiter | 505,965 ms | 76 ms | 1 | 645,392 ms | 5,134 | 2,000 |
| This tip, after | bounded, decaying, corrected server limiter | 164,840 ms | 100 ms | 0 | 293,279 ms | 5,135 | 2,000 |

The after migration sent the same work as the before run and finished 2.20 times
faster. Scheduled pacing on that connection fell 3.07 times. No rate-limit
rejection occurred, because the bounded pacing held the shared account below
the 1,500 requests per 30 second limit.

Per operation on this tip:

| Operation | Rows | Scheduled pacing | Paced requests | Max pacing | Rate-limit responses |
| --- | ---: | ---: | ---: | ---: | ---: |
| ping | 16 | 0 ms | 0 | 10 ms | 0 |
| launcher-read | 6 | 42,840 ms | 747 | 100 ms | 0 |
| sweep-read | 6 | 85,850 ms | 1,083 | 100 ms | 0 |
| mixed migration | 1 | 164,840 ms | 2,907 | 100 ms | 0 |

The ping lane had no scheduled pacing at all after the migration, and its calls
returned in 2 to 4 ms. That is the recovered state the old counter could not
reach.

The before row is the committed mixed run at `8deb9d1` from JH-902455. Its
source base `789f1bb61` has the same pacing block as this branch base
`c45f7774`. The diff between those commits in `connection.ts` adds only the
rate-limit wait diagnostics and abort-aware waiting, so the pacing comparison is
like for like on the client side. The historical run also predates the server
limiter correction, so its elapsed time is not a clean pacing-only baseline.
The local focused measurement above isolates the client change.

<ISOLATED_BEFORE_AND_AFTER>

## Tests

The gate runner named in the fleet brief (`gate/isolated_run.py`) is not present
in this repository, so the package tests were run directly with its own jest.
The search for tests that import the changed file was:

```sh
grep -rn "from '../connection'" foundations/core/packages/client-resources/src
```

It returned `src/__tests__/cancellation.test.ts`, `src/__tests__/connection.test.ts`
and the new `src/__tests__/pacing.test.ts`. `src/__tests__/integration.test.ts`
exercises the client stack through `core.createClient` and was run as well.

Package build: `rush build --to @hcengineering/client-resources`, success.
Package validate: `rush validate --to @hcengineering/client-resources`, success.

| Test file | Result | Counts |
| --- | --- | --- |
| `src/__tests__/pacing.test.ts` | passed | 7 tests, 1 suite |
| `src/__tests__/connection.test.ts` | passed | 3 suites, 22 tests together with the two files below |
| `src/__tests__/cancellation.test.ts` | passed | included above |
| `src/__tests__/integration.test.ts` | passed | included above |

The new `pacing.test.ts` holds five rule tests and two persistent-connection
measurement tests. Environment for every run had `HULY_BOARD_CONFIG` offline
and `VIKUNJA_BASE_URL` at `http://127.0.0.1:9`.

## Scope notes

- The legacy `plugins/client-resources/src/connection.ts` still contains the old
  increment rule. That folder is not a Rush project in `rush.json`, so it is not
  built or shipped by this branch.
- `foundations/core/packages/api-client/src/rest/rest.ts` has the same old
  counter for the HTTP REST client. It is outside this card.
- No server, model or migration change is included.
- The rig run uses Docker with `runtime: runc`, no device requests, no published
  ports and an internal network. It does not contact `huly.lan`.

## RECOMMENDATIONS

1. Fix the same counter in `api-client/src/rest/rest.ts` and in the legacy
   plugin connector, or delete the unused legacy copy. They can keep an obsolete
   penalty after one rate-limit response.
2. Treat the current delay as an admission delay, not a rate limit. Many calls
   admitted at once all wait the same delay and then travel together. If the
   board still bursts, a bounded token bucket or in-flight cap would control the
   wire rate.
3. Keep the rig's pacing counters in the acceptance for any later pacing change.
   Scheduled pacing and maximum per-request pacing are direct, cheap measures.
4. Review the interval between healthy decay steps after a larger sample. The
   10 ms step was chosen to clear a full penalty in ten healthy responses.
