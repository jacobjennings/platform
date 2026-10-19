# Local board API load and profiling report

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902455

## Result

The matrix is complete. The controlled comparisons and SQL analysis are still
running. This report will be finalized after teardown. No server optimization
is included.

The local matrix recorded 580 attempts, 148 errors and one partial supervision
response. Errors are measured outcomes of the real client under load. They are
not successful calls. A 30 second timeout must not be treated as a fast read.

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

The issue counts include VK8 6,914, JH 2,430, archived VK11 1,400 and smaller
projects. Four projects are active. Seventeen fresh local account identities
were created with generated private credentials and fixture project memberships.
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
The runner and server have explicit lifetimes. Each operation has a forty-minute
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

| Run | Operation | Clients | n | p50 ms | p95 ms | Max ms | Errors | Partial |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | connect | 1 | 3 | 97.6 | 455.8 | 455.8 | 0 | 0 |
| baseline | ping | 1 | 3 | 100.1 | 106.4 | 106.4 | 0 | 0 |
| baseline | resolveTask | 1 | 3 | 112.6 | 132.3 | 132.3 | 0 | 0 |
| baseline | readProjectTasks | 1 | 3 | 1784.0 | 2003.9 | 2003.9 | 0 | 0 |
| baseline | readSupervisionBoard | 1 | 1 | 49629.5 | 49629.5 | 49629.5 | 0 | 0 |
| baseline | setTaskStage | 1 | 3 | 131.4 | 196.8 | 196.8 | 0 | 0 |
| baseline | postTaskComment | 1 | 3 | 128.6 | 140.1 | 140.1 | 0 | 0 |
| baseline | migrateStageLabelsToStatus | 1 | 1 | 65243.2 | 65243.2 | 65243.2 | 0 | 0 |
| baseline | connect | 4 | 12 | 162.0 | 376.9 | 376.9 | 0 | 0 |
| baseline | ping | 4 | 12 | 148.5 | 173.7 | 173.7 | 0 | 0 |
| baseline | resolveTask | 4 | 12 | 196.9 | 240.5 | 240.5 | 0 | 0 |
| baseline | readProjectTasks | 4 | 12 | 2099.5 | 35860.6 | 35860.6 | 0 | 0 |
| baseline | readSupervisionBoard | 4 | 4 | 370802.8 | 388080.9 | 388080.9 | 0 | 1 |
| baseline | setTaskStage | 4 | 12 | 236.4 | 363.1 | 363.1 | 0 | 0 |
| baseline | postTaskComment | 4 | 12 | 199.1 | 244.8 | 244.8 | 0 | 0 |
| baseline | migrateStageLabelsToStatus | 4 | 4 | 191546.3 | 195283.1 | 195283.1 | 4 | 0 |
| baseline | connect | 8 | 24 | 231.4 | 417.2 | 435.7 | 0 | 0 |
| baseline | ping | 8 | 24 | 206.2 | 277.6 | 296.9 | 0 | 0 |
| baseline | resolveTask | 8 | 24 | 271.1 | 325.4 | 327.2 | 0 | 0 |
| baseline | readProjectTasks | 8 | 24 | 35287.9 | 52296.7 | 52301.5 | 8 | 0 |
| baseline | readSupervisionBoard | 8 | 8 | 30003.7 | 30004.6 | 30004.6 | 8 | 0 |
| baseline | setTaskStage | 8 | 24 | 30000.8 | 30001.7 | 30001.7 | 24 | 0 |
| baseline | postTaskComment | 8 | 24 | 323.3 | 29141.8 | 29141.8 | 0 | 0 |
| baseline | migrateStageLabelsToStatus | 8 | 8 | 64170.1 | 64190.8 | 64190.8 | 8 | 0 |
| baseline | connect | 16 | 48 | 527.5 | 1237.0 | 1241.3 | 0 | 0 |
| baseline | ping | 16 | 48 | 456.9 | 571.5 | 571.7 | 0 | 0 |
| baseline | resolveTask | 16 | 48 | 562.5 | 596.4 | 615.1 | 0 | 0 |
| baseline | readProjectTasks | 16 | 48 | 44593.0 | 72115.1 | 73065.3 | 32 | 0 |
| baseline | readSupervisionBoard | 16 | 16 | 30001.9 | 30025.0 | 30025.0 | 16 | 0 |
| baseline | setTaskStage | 16 | 48 | 30000.4 | 30001.2 | 30001.3 | 32 | 0 |
| baseline | postTaskComment | 16 | 48 | 715.4 | 980.9 | 1012.6 | 0 | 0 |
| baseline | migrateStageLabelsToStatus | 16 | 16 | 37363.0 | 37489.3 | 37489.3 | 16 | 0 |

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
fresh-connection ping median was about 132 ms. This demonstrates the value of
reuse for cold callers. The production broker may already cover some callers,
so a coverage audit must precede claiming those savings there.

## Mixed load

Pending completion.

## SQL plans and ranked follow-ups

Pending completion. Draft bodies are in [follow-ups.md](follow-ups.md).

## Validation and final state

Pending final checks and teardown. State and recorded resource IDs are in the
ignored `dev/board-load/state` directory. Only recorded resources from this run
will be stopped. Pushes go only to the recorded mktemp bare repository.

## RECOMMENDATIONS

Finish the controlled comparisons and use their evidence to order the local
draft cards. No change should claim a speedup by returning less description data.
