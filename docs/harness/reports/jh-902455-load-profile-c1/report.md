# Local board API load and profiling report

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902455

## Result

Complete. The benchmark, comparisons, SQL plans and teardown are recorded.
No server optimization or production configuration change is included.

The 1,000-row page variant cut 16-client p95 attempt duration from 72.1 seconds
to 2.18 seconds, with zero failures instead of 32 and identical complete card
results. This measured 33.0-fold comparison uses an existing test configuration
option. The copied harness files remain unchanged. Draft follow-up cards cover
that configuration change and the independently observed stall mechanisms.

The local matrix recorded 580 attempts, 148 errors and one partial supervision
response. Errors are measured outcomes of the real client under load. They are
not successful calls. A 30 second timeout must not be treated as a fast read.

## Measurement limits

The reported ratios describe the recorded attempts in this exploratory run.
The comparison arms were not interleaved across at least three independent
repetitions with host load recorded. The review guide therefore does not accept
these ratios as established speedup measurements. Repeated samples inside one
arm do not replace independent repetitions. None of the ratios establishes a
production performance gain. The reviewer located the raw captures in the implementation worktree and
checked the attempt tables against those files.

## Environment and isolation

Server source base: `789f1bb61`, from the fork's `jj/activity-feed` branch.
The source-built account, transactor and collaborator bundles were mounted over
matching `v0.7.426` runtime images. The browser UI was replaced by a config-only
HTTP fixture. Fulltext and optional integrations were not started.

The runtime reports Node `v22.19.0`, x64, 48 available CPUs and 188.05 GiB RAM.
Builds used the supported local Node 22 toolchain. CockroachDB is `v24.2.10`,
restoring a `v24.2.4` snapshot. It has a 512 MiB
cache and 512 MiB SQL memory setting. Other services have no CPU or memory cap.
These are local measurements, not predictions of the production host's capacity.

The Docker network is internal. No test endpoint is published to the host.
All recorded containers use `runc`, with no device requests or device mappings.
`CUDA_VISIBLE_DEVICES` is empty. No live board, SSH, system service, graphical
application or NVIDIA device was contacted or inspected.

The two harness files were copied unchanged from the clean `main` checkout at
`90545543416a9a2702ef3c89999cf0967280e726`. Their source and fixture hashes are in
`dev/board-load/fixture-manifest.json` and `dev/board-load/PROVENANCE.md`.
The load compiles the copied client in memory with an explicit local config.
It uses its real native connector and operations. SSH and broker startup cost
are excluded. The copied CLI is retained alongside the client.

## Data

The supplied local CockroachDB and MinIO snapshot was restored. Its manifest
says it was taken on 19 October 2026. Counts measured before load mutations:

| Data | Rows or documents |
| --- | ---: |
| Issues | 11,120 |
| Transactions | 231,166 |
| Activity rows | 183,335 |
| Collaborator documents | 33,763 |
| Statuses returned by the real status catalog | 22 |
| Issues with descriptions | 11,119 |
| Issues with labels | 6,857 |
| Issues with comments | 10,603 |

The issue counts include VK8 6,914, JH 2,430, archived VK11 1,400 and smaller
projects. Four projects are active. Seventeen fresh local account identities
were created as local workspace owners with generated private credentials and
fixture project memberships. Production account permissions were not inspected.
No production credentials were read.

The migration fixture copies the shape of a real stage reference onto 4,800
VK8 cards and sets their local status to queued. Each client gets a disjoint
300-card slice. The fixture resets before each migration group. The mixed load
uses a 1,000-card slice. These direct SQL writes are test setup only. No index
or production schema behavior was changed.

## Bring-up and rerun

The reusable command, with a supported Node executable available, is:

```sh
bash dev/board-load/run.sh
```

`BOARD_LOAD_NODE=/path/to/node` can select Node 20 through 24.
`BOARD_LOAD_SNAPSHOT` can select the local snapshot directory. The default is
`~/.local/state/jake-harness/huly-snapshot/`.

The command installs missing dependencies, builds the named service and client
dependency closures, restores a fresh snapshot, runs the loads, prints the table
and stops its recorded resources. Each invocation gets unique ignored state and
results directories. It also performs a separate SQL-capture and EXPLAIN pass.

The equivalent bring-up used for this run was:

```sh
node common/scripts/install-run-rush.js install
node common/scripts/install-run-rush.js build --to @hcengineering/pod-server --to @hcengineering/pod-account --to @hcengineering/pod-collaborator --to @hcengineering/api-client --parallelism 8
node common/scripts/install-run-rush.js bundle --to @hcengineering/pod-server --to @hcengineering/pod-account --to @hcengineering/pod-collaborator --parallelism 8
mkdir -p dev/board-load/state/extern
tar -xf "$SNAPSHOT/cockroach-backup.tar" -C dev/board-load/state/extern
tar -xf "$SNAPSHOT/minio-files.tar" -C dev/board-load/state
docker compose -p jh-902455-local -f dev/board-load/compose.yaml up -d db queue
docker exec "$DB_ID" ./cockroach sql --insecure -e "RESTORE DATABASE defaultdb FROM LATEST IN 'nodelocal://1/huly-snapshot-20261019' WITH new_db_name = 'profile'"
```

Here `SNAPSHOT` names the supplied local folder and `DB_ID` is the recorded
container ID. Every build used empty `CUDA_VISIBLE_DEVICES` and
`PUPPETEER_SKIP_DOWNLOAD=1`. A local MinIO image was built from the pinned
`RELEASE.2025-04-22T22-12-26Z` source with CGO disabled. Registry image pulls and
the old binary release URL failed. The exact Go build and image commands are
in `dev/board-load/run.sh`.

The runner was created on the internal network with a bind mount of this
worktree and a four-hour sleep. It ran `seed-accounts.cjs`, `grant-fixture.cjs`,
`prepare-migration.cjs`. Services were then started with the same Compose
project. `worker.cjs` smoke mode verified the connection and fixture count before
`driver.cjs baseline` drove the matrix.
The runner, transactor and config service have explicit lifetimes.
The other containers rely on the runner's EXIT cleanup. Each operation has a forty-minute
worker bound and each scenario a ninety-minute bound.

## Method

The baseline has one shared account per concurrency group, fresh native
connections per operation and a 1,500-request limit in 30 seconds. It does not
inherit the dev Compose file's lower 250-request override. Later concurrency
groups use fresh account identities to isolate earlier rejection history.
The first one- and four-client groups reused one account after a 31 second gap.

There are three attempts per client for the short calls and project reads.
Supervision and migration have one attempt per client. Percentiles use nearest
rank. The one-client heavy-operation p95 is therefore a single observation,
not a statistically precise tail estimate. All attempts, including failures,
are included in the duration columns. Errors and partial responses are separate.

The operations run in a fixed sequence and share the group's budget. The matrix
therefore exposes cumulative saturation. It is not a set of independently
cooled single-operation microbenchmarks. A 31 second gap separates groups.
An initial empty read caused by missing fixture membership was rejected and
excluded. The memberships were corrected before the matrix.

The first driver stopped on the four-client migration errors. The harness was
changed to retain measured server errors and continue. A resume skipped all
completed attempts and finished the eight- and sixteen-client groups. No failed
write was automatically replayed. The raw baseline has exactly 580 attempts.

## Baseline

Durations are milliseconds. Partial means a returned full card list with
missing description content. A fully readable VK8 fixture returns 6,913
nonempty descriptions among 6,914 cards. The initial one-client run did not
record nonempty description counts, so its partial-response column is unknown
rather than a quality guarantee.

| Run | Operation | Clients | n | p50 ms | p95 ms | Max ms | Errors | Partial | Censored |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | connect | 1 | 3 | 97.6 | 455.8 | 455.8 | 0 | 0 | 0 |
| baseline | ping | 1 | 3 | 100.1 | 106.4 | 106.4 | 0 | 0 | 0 |
| baseline | resolveTask | 1 | 3 | 112.6 | 132.3 | 132.3 | 0 | 0 | 0 |
| baseline | readProjectTasks | 1 | 3 | 1784.0 | 2003.9 | 2003.9 | 0 | 0 | 0 |
| baseline | readSupervisionBoard | 1 | 1 | 49629.5 | 49629.5 | 49629.5 | 0 | n/a | 0 |
| baseline | setTaskStage | 1 | 3 | 131.4 | 196.8 | 196.8 | 0 | 0 | 0 |
| baseline | postTaskComment | 1 | 3 | 128.6 | 140.1 | 140.1 | 0 | 0 | 0 |
| baseline | migrateStageLabelsToStatus | 1 | 1 | 65243.2 | 65243.2 | 65243.2 | 0 | 0 | 0 |
| baseline | connect | 4 | 12 | 162.0 | 376.9 | 376.9 | 0 | 0 | 0 |
| baseline | ping | 4 | 12 | 148.5 | 173.7 | 173.7 | 0 | 0 | 0 |
| baseline | resolveTask | 4 | 12 | 196.9 | 240.5 | 240.5 | 0 | 0 | 0 |
| baseline | readProjectTasks | 4 | 12 | 2099.5 | 35860.6 | 35860.6 | 0 | 0 | 0 |
| baseline | readSupervisionBoard | 4 | 4 | 370802.8 | 388080.9 | 388080.9 | 0 | 1 | 0 |
| baseline | setTaskStage | 4 | 12 | 236.4 | 363.1 | 363.1 | 0 | 0 | 0 |
| baseline | postTaskComment | 4 | 12 | 199.1 | 244.8 | 244.8 | 0 | 0 | 0 |
| baseline | migrateStageLabelsToStatus | 4 | 4 | 191546.3 | 195283.1 | 195283.1 | 4 | 0 | 0 |
| baseline | connect | 8 | 24 | 231.4 | 417.2 | 435.7 | 0 | 0 | 0 |
| baseline | ping | 8 | 24 | 206.2 | 277.6 | 296.9 | 0 | 0 | 0 |
| baseline | resolveTask | 8 | 24 | 271.1 | 325.4 | 327.2 | 0 | 0 | 0 |
| baseline | readProjectTasks | 8 | 24 | 35287.9 | 52296.7 | 52301.5 | 8 | 0 | 0 |
| baseline | readSupervisionBoard | 8 | 8 | 30003.7 | 30004.6 | 30004.6 | 8 | 0 | 0 |
| baseline | setTaskStage | 8 | 24 | 30000.8 | 30001.7 | 30001.7 | 24 | 0 | 0 |
| baseline | postTaskComment | 8 | 24 | 323.3 | 29141.8 | 29141.8 | 0 | 0 | 0 |
| baseline | migrateStageLabelsToStatus | 8 | 8 | 64170.1 | 64190.8 | 64190.8 | 8 | 0 | 0 |
| baseline | connect | 16 | 48 | 527.5 | 1237.0 | 1241.3 | 0 | 0 | 0 |
| baseline | ping | 16 | 48 | 456.9 | 571.5 | 571.7 | 0 | 0 | 0 |
| baseline | resolveTask | 16 | 48 | 562.5 | 596.4 | 615.1 | 0 | 0 | 0 |
| baseline | readProjectTasks | 16 | 48 | 44593.0 | 72115.1 | 73065.3 | 32 | 0 | 0 |
| baseline | readSupervisionBoard | 16 | 16 | 30001.9 | 30025.0 | 30025.0 | 16 | 0 | 0 |
| baseline | setTaskStage | 16 | 48 | 30000.4 | 30001.2 | 30001.3 | 32 | 0 | 0 |
| baseline | postTaskComment | 16 | 48 | 715.4 | 980.9 | 1012.6 | 0 | 0 | 0 |
| baseline | migrateStageLabelsToStatus | 16 | 16 | 37363.0 | 37489.3 | 37489.3 | 16 | 0 | 0 |

## Request cost

Measured median outgoing counts from the one-client sequence:

| Operation | Native RPC sends | Client HTTP requests | Collaborator requests |
| --- | ---: | ---: | ---: |
| connect | 2 | 4 | 0 |
| ping | 3 | 4 | 0 |
| resolveTask | 5 | 4 | 0 |
| readProjectTasks | 196 | 4 | 0 |
| readSupervisionBoard | 964 | 6,918 | 6,914 |
| setTaskStage | 10 | 4 | 0 |
| postTaskComment | 7 | 4 | 0 |
| migrateStageLabelsToStatus, 300 cards | 2,849 | 56 | 0 |

RPC sends include hello and loadModel. Each native connection also performs
one websocket HTTP upgrade outside the fetch counter. These are application
round trips, not TCP packet counts. The four fetch requests on a short call
are config, login, selectWorkspace and getSocialIds. The JH read makes 194
findAll sends after connection setup. The VK8 supervision read makes exactly
one collaborator request per described card. Its 16 rate-limit responses are
included in its observed sends. Internal collaborator-to-accounts requests
are outside the client HTTP counter.

The migration opened 14 native connections, including per-batch and verification
work. It downloaded the model each time. The harness's one-second pauses account
for 11 seconds of this 12-batch operation, by code and batch count. That is a
calculated component, not a separately timed optimization experiment.

Failed markup fetches and timed-out connects can continue in the background.
Some later phase counters therefore include retries belonging to an earlier
call. The raw high-load counters are useful as process traffic totals, but must
not be read as exact ownership of every retry. The normal one-client counts
above avoid the observed late-work contamination in the four-client run.

## Profiles and diagnosis

All 32 per-operation baseline CPU profiles are retained under
`dev/board-load/results/baseline-<clients>-<operation>.cpuprofile`.
`event-loop.jsonl` records one-second CPU use, event loop utilization and delay.
The transactor also runs with `--cpu-prof`. Raw profiles, SQL and snapshot data
remain ignored and local.

Every completed model load returned 2,067,856 bytes as decoded JSON. A typical
binary protocol model message was about 1,346,110 bytes before websocket framing.
The first one- and four-client instrumentation timed the last model attempt.
Later
instrumentation preserves total wait across retries and records hello time.
The connect elapsed times always include the complete wait.

The source explains two distinct throttling hazards. The sliding limiter inserts
requests 150 seconds into the future once rejectedRequests exceeds twice the
1,500-request maximum. Rejected requests can consume slots. In the client,
slowDownTimer increases inside a remaining < 50 guard. At the normal maximum,
the branch that could decrease it is unreachable. The connection can retain
an added delay per RPC after the account budget recovers.

The old MongoDB index diagnosis does not identify the actual issue table.
The restored issues are in task. Tracker contains four component rows. The
restored task, activity and tags tables have only their primary indexes on
workspaceId and _id. Actual CockroachDB plans will be reported below.

## Controlled stall and comparisons

The burst configured 16 clients with 400 project reads each, then started a new
connect per client after a two-second offset. The shared run sent all 6,400 reads.
The inclusive burst spans recorded 30,201 RPC sends and 23,753 rate-limit responses.
The span includes connect probes and one later read per client.

| Run | Operation | Clients | n | p50 ms | p95 ms | Max ms | Errors | Partial | Censored |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| stall-shared | connect-after-exhaust | 16 | 16 | 28343.1 | 387815.9 | 387815.9 | 0 | 0 | 0 |
| stall-shared | read-after-exhaust | 16 | 16 | 3470.6 | 389687.3 | 389687.3 | 0 | 0 | 0 |
| stall-shared | exhaust-queries | 16 | 16 | 391640.1 | 419959.2 | 419959.2 | 0 | 0 | 0 |
| stall-separate | prime-connect | 16 | 11 | 514712.0 | 514723.0 | 514723.0 | 11 | 0 | 11 |
| stall-separate | connect-after-exhaust | 16 | 5 | 511350.5 | 511406.0 | 511406.0 | 5 | 0 | 5 |
| stall-raised | prime-connect | 16 | 16 | 759.5 | 768.8 | 768.8 | 0 | 0 | 0 |
| stall-raised | connect-after-exhaust | 16 | 16 | 309.8 | 462.7 | 462.7 | 0 | 0 | 0 |
| stall-raised | read-after-exhaust | 16 | 16 | 33.7 | 108.2 | 108.2 | 0 | 0 | 0 |
| stall-raised | exhaust-queries | 16 | 16 | 2419.2 | 2483.2 | 2483.2 | 0 | 0 | 0 |
| shared | ping | 1 | 20 | 1.3 | 2.2 | 410.0 | 0 | 0 | 0 |

The normal-limit connect p95 was 387,815.9 ms. Hello median was 15.9 ms and model
load p95 was 387,740.8 ms. The transactor averaged 2.33% of one CPU core over
these probe intervals. Event loop p95 delay was 10.6 ms. This reproduces a fast
hello followed by a multi-minute connect wait on an otherwise quiet transactor.
It does not establish the cause of the historical production incidents.

The separate-account attempt found an independent global stall. Eleven initial
connects never completed their model. Five clients reached the later connect
probe. Therefore this run did not put all 6,400 configured separate-account
queries on the wire. No observed rate-limit response or adaptive pacing
explained the pending model loads.

Those attempts were censored after sustained lack of progress. Their table
values are measured lower bounds, not completed response times. Initial-connect
bounds start at server hello, excluding earlier login time. Later-probe bounds
use the client's last measured elapsed time. The raw rows carry this distinction.
Only the recorded scenario processes in the dedicated runner were stopped.

CockroachDB then showed ten idle transactor sessions and no active transactor
query. A read-only debugger inspection saw 17 managed client_async contexts,
ten holding one idle connection each and seven holding none. The pool maximum
is ten. The captured call stack passed through OnUserStatus, syncChat, trigger
findAll and ConnectionMgr.retry. A diagnostic connection contributed to the
inspection state. Pool starvation is observed. The originating reservation cycle
still needs a focused follow-up to establish and repair its full cause.

After restarting only the owned transactor and raising the local limit to
1,000,000, the same shared-account workload completed without rate-limit responses.
Connect p95 was 462.7 ms, a measured 838.1-fold ratio against the normal-limit
burst. This is a diagnostic configuration comparison. It is not a server fix
or a production quota recommendation. The pool issue remains independently real.
The normal 1,500 limit was restored before the remaining workloads.

The post-burst read probe recorded up to 74,070 ms of scheduled client pacing.
Its total elapsed time also includes account-level waiting, so it is not a pure
pacing microbenchmark. The scheduled delay itself is observed by the client hook.

Twenty pings using the existing shared native connection had median 1.3 ms and
p95 2.2 ms. The maximum 410.0 ms includes the initial connection. The baseline
fresh-connection ping median was 100.1 ms, a measured 77.0-fold median ratio. This demonstrates the value of
reuse for cold callers. The production broker may already cover some callers,
so a coverage audit must precede claiming those savings there.

## Mixed load

The run used two launcher/sweep lanes for JH and VK8, two health lanes and one
migration of 1,000 cards on the shared account. Sweeps had two-minute pauses
between completed rounds. The initial health loop ran five rounds. Two
continuation workers added checks later in the long workload. The timestamped
samples preserve the exact schedule. The reusable driver now keeps health
checks running until the foreground work ends.

| Run | Operation | Clients | n | p50 ms | p95 ms | Max ms | Errors | Partial | Censored |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| mixed | ping | 5 | 10 | 1.9 | 503.4 | 503.4 | 0 | 0 | 0 |
| mixed | launcher-read | 5 | 6 | 2639.0 | 55400.6 | 55400.6 | 0 | 0 | 0 |
| mixed | sweep-read | 5 | 6 | 898.0 | 103623.6 | 103623.6 | 0 | 0 | 0 |
| mixed | migrateStageLabelsToStatus | 5 | 1 | 645392.1 | 645392.1 | 645392.1 | 0 | 0 | 0 |
| mixed-health | ping | 2 | 4 | 2.7 | 257.6 | 257.6 | 0 | 0 | 0 |

All 1,000 migration cards were verified applied. It took 645,392.1 ms and sent
5,134 findAll RPCs and 2,000 transaction RPCs, using one native connection.
Only one rate-limit rejection occurred, but the connection scheduled 505,965 ms
of client pacing. The retained per-request delay reached 76 ms. This is direct
evidence that a recovered budget can leave a long-lived connection persistently
slow. Scheduled delays are observed waits, not a separately measured optimization.

## Larger-page comparison

| Run | Operation | Clients | n | p50 ms | p95 ms | Max ms | Errors | Partial | Censored |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pages50 | readProjectTasks | 1 | 3 | 2122.1 | 2503.5 | 2503.5 | 0 | 0 | 0 |
| pages1000 | readProjectTasks | 16 | 48 | 1765.7 | 2182.9 | 2197.9 | 0 | 0 | 0 |

The 50-row control returned all 2,430 JH rows in three attempts. The 1,000-row
variant returned the same complete rows in 48 attempts at 16 clients. Canonical
hashes of the rows, labels and status facts were identical across all 51 samples.
The full project JSON was about 2.20 MB. FindAll sends fell from 194 to 20 per
call, a calculated 9.7-fold request reduction. There were no rate-limit responses
in either page-size variant.

Against the original 16-client, 50-row baseline, p95 attempt duration fell from
72,115.1 ms to 2,182.9 ms, a measured 33.0-fold ratio. The original baseline had
32 errors in 48 attempts. The larger-page variant had none. This is a saturation
comparison, not a claim that every unsaturated call becomes 33 times faster.
The paired control hashes establish equivalent results on the same fixture state.
The production harness configuration has not been changed.

## Model and event loop measurements

| Clients | Connect samples | Connect p50 ms | Model p50 ms | Model p95 ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 3 | 97.6 | 32.7 | 64.0 |
| 4 | 12 | 162.0 | 33.9 | 121.0 |
| 8 | 24 | 231.4 | 47.7 | 90.6 |
| 16 | 48 | 527.5 | 86.7 | 141.7 |

Model timings above use the connect-only samples before their group's budget
was spent. Every model was 2,067,856 decoded JSON bytes. The full VK8 diagnostic
response was 12,750,844 JSON bytes and retained 6,913 nonempty descriptions for
6,914 cards, with no HTTP failure. That diagnostic read took 40,005.3 ms without
a rate-limit response.

| Workload | Mean CPU, one-core % | One-second delay p95 ms | Max delay ms |
| --- | ---: | ---: | ---: |
| JH read, one client | 23.94 | 10.90 | 24.02 |
| VK8 supervision, one client | 7.30 | 10.68 | 85.66 |
| VK8 supervision, four clients | 5.07 | 10.58 | 103.42 |
| Stage writes after saturation, eight clients | 1.98 | 10.58 | 110.82 |
| Supervision after saturation, sixteen clients | 2.30 | 10.58 | 112.13 |
| Shared-account connect probes | 2.33 | 10.58 | 114.16 |

CPU is equivalent percent of one core, not percent of the whole host. Delay is
the p95 of the one-second p95 delay samples, at 10 ms histogram resolution. The
statistics use sample timestamps inside measured call windows. Per-phase CPU
profiles also include the phase boundaries. The first migration phase included
a cooldown before the next phase, so its profile's idle share is not an isolated
migration CPU measurement.


## SQL plans

The diagnostic pass captured real parameterized SELECTs from the source-built
transactor. Six plans were matched to the slowest available statement-statistics
fingerprints with captured parameters. Aggregate statistics were saved before
the diagnostic pass. EXPLAIN ANALYZE required quoted SQL literals because this
CockroachDB version rejects protocol placeholders in EXPLAIN.

| Captured query shape | Stats calls | Stats mean ms | Replay execution ms | Main rows scanned | Main KV bytes |
| --- | ---: | ---: | ---: | ---: | --- |
| Activity grouped by space, workspace initialization | 5 | 116.21 | 85 | 187,581 | 232 MiB |
| Activity page returning 50 rows | 3 | 106.93 | 4 | 2,048 | 2.0 MiB |
| Activity catch-up returning zero rows | 100 | 84.21 | 124 | 187,581 | 232 MiB |
| Exact count for an attached-card batch | 100 | 75.06 | 90 | 187,581 | 232 MiB |
| Exact count for zero-row catch-up | 100 | 74.67 | 90 | 187,581 | 232 MiB |
| Exact count during cursor recheck | 1,230 | 37.09 | 107 | 185,660 | 230 MiB |

The plans ran after the mutation workloads. Activity had grown from the initial
183,335 rows to 187,581. Replay values came from the diagnostic pass, so its
EXPLAIN execution time is a new measurement of the same SQL shape, not a replay
of an original slow request's exact timestamp or card list.

The zero-row catch-up scan and repeated counts read almost the entire activity
table. The paginated 50-row read can stop early through the primary key. A small
page result alone therefore hides the cost of its accompanying exact count and
catch-up scans. Index work must target the Postgres/CockroachDB expressions and
the actual task, tags and activity tables.

## Ranked improvements

Expected gains below are estimates unless explicitly labeled measured. Targets
for architectural changes are conditional engineering goals, not benchmarked
implementations. Each row has its own local draft body in
[follow-ups.md](follow-ups.md). No live cards were posted.

| Rank | Change and evidence | Expected gain and basis | Risk | Touches |
| ---: | --- | --- | --- | --- |
| 1 | Bound managed Postgres reservations. Ten cached idle leases exhausted the ten-connection pool while model loads waited without rate-limit responses | Remove global hangs. Target subsecond healthy connects instead of observed bounds above 511 seconds. No fix was benchmarked | High. Reservation and transaction lifetime | Fork |
| 2 | Correct limiter rejection accounting and future timestamps. Shared burst had 23,753 rejection responses | Raised-limit control measured 838.1x p95 ratio. At the same quota, eliminating the artificial 150-second extension is expected to yield roughly 2–6x on this burst, an estimate | Medium to high. Fairness and quota policy | Fork |
| 3 | Decay client pacing after healthy responses. One rejection left 506 seconds of scheduled pacing in the mixed migration | Estimated 3–5x on this steady workload, bounded by real quota and write cost. Not an implemented comparison | Medium. Congestion control | Fork client library |
| 4 | Increase validated page size through the existing harness setting. 194 findAll sends became 20 | Measured 33.0x p95 attempt ratio at 16 clients, with all 48 calls complete and matching hashes. Calculated 9.7x request reduction | Low to medium. Payload size, server caps and moving cards | Harness |
| 5 | Cancel retries, unfinished connects and HTTP work at the owning deadline. 569 late collaborator attempts appeared in a later phase | No isolated latency gain measured. Removes demonstrated stale traffic and makes deadlines and profiling ownership reliable | Medium. Uncertain writes require read-back | Both |
| 6 | Use existing fetchMarkups in bounded description batches. Current read made 6,914 collaborator requests | A batch of 50 would need 139 requests, a calculated 49.7x HTTP reduction. Estimated 1.2–3x whole-read gain after other bottlenecks are removed. Storage work remains per document | Medium. Completeness and failure semantics | Harness, using existing fork API |
| 7 | Add actual CockroachDB board indexes, especially activity attachedTo and catch-up predicates. Zero-row scans read 232 MiB | Estimated 10–100x on selective SQL components. Whole-call gain depends on pacing and round trips. Index benefit is not measured until the follow-up creates and tests it | Medium. Write cost, index size and upgrade rollout | Fork |
| 8 | Add a consistent bulk board snapshot API. Current project read makes 194 queries plus repeated exact counts | Target 10–100x full-read latency from far fewer calls. The measured full VK8 payload is 12.75 MB. This is an architectural target, not a measured implementation | High. Snapshot consistency, permissions and bounded responses | Both |
| 9 | Materialize a permission-aware board read model with explicit freshness | Target 0.5–5 second warm full reads versus the 49.6 second one-client baseline, about 10–100x. Basis is avoiding repeated joins, descriptions and network calls | High. Invalidation, collaborator revisions and revocation | Both |
| 10 | Batch guarded migration mutations and verified outcomes. A 300-card run made 2,849 RPC sends | Estimated 2–10x. Keeping eleven one-second pauses alone limits the 65.2 second baseline's gain to below 6x. Larger gains need fair scheduling to replace blind pauses | High. Partial success and idempotency | Both |
| 11 | Extend existing persistent-connection coverage where cold calls remain | Measured 77.0x median ping ratio in the local comparison. Much smaller gain for full reads. Fix pacing first and audit existing broker coverage | Medium. Cancellation, stale state and lifecycle | Harness |
| 12 | Separate service identities or choose explicit quotas. Separate identities removed observed throttling but exposed pool starvation | No reliable end-to-end gain established for separate accounts. Raising the local limit gave the measured 838.1x control, with capacity and fairness tradeoffs | Medium to high. More accounts do not fix the pool | Harness and fork settings |
| 13 | Persist a validated Node model snapshot. Each connect transferred 2.07 MB decoded JSON | Estimated 1.1–1.5x on an unsaturated single connect, using the measured 32.7 ms model portion of a 97.6 ms median connect as an upper-bound basis. A hash-check RPC is still rate-limited | Medium. Workspace keys, corruption and invalidation | Fork client library |

The shortest route to a measured improvement is the existing page-size option,
with rollout limits and completeness checks. Fix reservation starvation and
throttling correctness before relying on more accounts or broader connection
reuse. Bulk reads and a read-side view are the stronger architectural candidates
for another order of magnitude on full supervision exports.


## Validation

The source service and client dependency build passed. Service bundles passed.
Dependency installation passed with the supported Node and browser download
skipped. Standalone CJS syntax checks, shell syntax, Compose configuration and
Git whitespace checks passed. All 32 baseline CPU profile JSON files validated.
The page variants passed completeness and canonical-hash equality checks.
The copied client and CLI match the pinned harness commit byte for byte.
The emergency collector rejected execution outside its dedicated fixture runner.

The fresh one-command check used:

```sh
BOARD_LOAD_NODE=/path/to/supported/node BOARD_LOAD_SCENARIOS=shared bash dev/board-load/run.sh
```

It restored the snapshot into a new isolated stack, verified the 2,430-card
fixture, ran twenty shared pings, captured six matched SQL plans and removed
its containers and network. The full matrix and other scenarios were measured
individually in the main run. This shortened check validates the complete
bring-up and cleanup path without repeating the long saturation experiments.

An initial SQL-plan attempt failed because EXPLAIN rejects placeholders. SQL
literal quoting fixed it, and six actual-parameter plans then passed. A profiling
hook initially tried to replace a getter export. Wrapping cached module exports
fixed it and subsequent real runs exercised the hook. The first cleanup retained
two anonymous Redpanda volumes. Their recorded mount events identified them for
removal. Cleanup now uses docker rm -v, verified with a newly recorded disposable
container and anonymous volume. These fixture issues are fixed.

The 148 matrix errors, partial description response and censored pool-stall
probes are application findings retained in the report, not passing API results.

No new unit-test file was added. The card explicitly requests this load test.
The search for adjacent tests was:

```sh
rg -n '(board-load|server-hook|prepare-migration)' --glob '*test*' --glob '*spec*' dev docs/harness
```

It found no existing unit tests for these standalone files. The full suite was
not run. No test ran on another branch or against a live board.

## Artifacts and final state

The main raw artifacts remain local under `dev/board-load/results/`:

- `baseline.jsonl`, `stall-shared.jsonl`, `stall-separate.jsonl`, `stall-raised.jsonl`.
- `shared.jsonl`, `mixed.jsonl`, `mixed-health.jsonl`, `pages50.jsonl`, `pages1000.jsonl`.
- `baseline-<clients>-<operation>.cpuprofile` for all 32 matrix phases.
- `CPU.*.cpuprofile` from the transactor's --cpu-prof process runs.
- `event-loop.jsonl`, `metrics-summary.json`, `page-equivalence.json`.
- `statement-statistics-before-diagnostic.json`, `sql-selects.jsonl`, `explain-analyze.json`.
- `blocked-pool.json`, `blocked-transactor-sessions.tsv`, `separate-hellos.json`.
- `teardown-verification.json`, resource manifests, build and fixture logs.

The fresh-command verification is in `dev/board-load/results/run.iedylA/`.
Its original restored scale counts are in `fixture-scale.json`.

All 25 recorded containers, both recorded networks and all three recorded
anonymous volumes, including the cleanup check's temporary resources, are gone.
The original Redpanda volumes were matched to recorded container IDs through
Docker mount events before removal. Cleanup now removes owned anonymous volumes
with docker rm -v. Only resources created by this work were stopped or removed.

Exact teardown used the recorded live container IDs, kept the runner until the
artifact ownership was corrected, then removed its recorded network ID. The
reusable equivalent is in the runner's EXIT trap:

```sh
while IFS= read -r cid; do
  docker stop --time 30 "$cid"
  docker rm -v "$cid"
done < /path/to/run-state/container-ids
docker network rm "$(cat /path/to/run-state/network-id)"
```

The ignored fixture state remains, about 4.8 GiB, and raw results about 185 MiB
as measured by du after teardown. The local jh-902455-minio:local image remains
as a rerun cache, recorded as `sha256:28071b9340e2dd9a15e7f4c0cb54348795b3edd1b877fb7d6d74c0c675e25e9b`.
Source builds and dependency caches remain. No process or
container from this benchmark is intentionally left running. Snapshot data,
credentials and raw profiles were not committed or sent to an external service.
Pushes went only to the mktemp bare repository recorded in
`dev/board-load/push-target.local`, never to origin or a live board.


## RECOMMENDATIONS

Create the local draft follow-ups in the chosen board workflow after review.
Prioritize reservation lifetime, limiter behavior, client pacing and the measured
page-size configuration gain. Preserve the same snapshot and canonical-result
checks for each before and after run. Repeat promising changes with production
CPU and memory quotas before predicting production capacity. Keep all fixture
data and profiles local. No optimization should claim a speedup by returning less
description data.
