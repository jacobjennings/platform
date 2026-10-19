# Draft follow-up cards

These are local drafts. No card has been posted to a live board. Measurements
and prioritization are in report.md. Speedup figures in that report are estimates
unless a comparison run is explicitly identified.

## Correct rate-limit rejection behavior and expose throttling

Problem: the limiter shares a budget across connections for the same account
and service. It also inserts future timestamps after excessive rejections.
The client silently retries throttled RPCs, including model loads.

Scope: the fork's sliding limiter, session rate-limit response and client retry
handling. Separate the policy choice about quotas from correctness. A rejected
request must not consume new capacity or extend the observation window into the
future. Publish bounded retry delays and surface throttling in connect diagnostics.
Ensure client pacing decays on healthy responses. Its current decrease branch is
unreachable at the normal 1,500-request limit because it is inside a remaining < 50
guard. Retain the intended per-account policy unless the owner chooses a new quota model.

Acceptance: reproduce the local shared-account burst before and after. Compare
separate accounts. Check hello latency, loadModel latency, retry counts, recovery
time and transactor idle time. Add focused limiter and retry tests under this card.
A lost connection must cancel outstanding retries.

## Add CockroachDB indexes for board query shapes

Problem: issue queries use task, and comment queries use activity. The restored
fixture has primary indexes on workspaceId and _id. MongoDB domain conclusions
are not sufficient evidence for this adapter.

Scope: use the captured slow SQL and EXPLAIN ANALYZE plans to select indexes.
Evaluate workspaceId plus space and _id for project pagination, attachedTo and
_id for activity and tags, and the status JSON expression for staged issue reads.
Implement through the fork's supported index and workspace-upgrade mechanisms.
Do not add every possible index without a query that demonstrates its value.

Acceptance: plans show fewer rows scanned on the exact captured parameters.
Rerun the committed matrix. Report index bytes, creation time, write throughput
and read p50 and p95. Explain rollout and effects on existing workspaces.

## Batch description reads in the harness

Problem: readSupervisionBoard makes one collaborator HTTP request per described
card. The fork already exposes fetchMarkups/getContents.

Scope: the harness client. Fetch descriptions in bounded batches, retaining card
order and explicit unreadable-description reporting. Use the existing bulk API.
Bound the pool across concurrent readers rather than issuing thousands of HTTP
requests at once. Keep a compatibility path only when it is explicitly required.

Acceptance: the 6,914-card fixture returns equivalent descriptions and comments.
Record collaborator and accounts request counts, empty descriptions, errors and
latency at all four client counts. A faster partial response must not pass.

## Remove redundant pagination work with a board snapshot API

Problem: the client performs a cursor walk, change catch-up and id recheck, while
requesting exact totals on each page. These safeguards cost many round trips.

Scope: both the fork and harness. Design a versioned board read that applies
workspace and project permissions on the server and returns cards, status and
label facts, comments and description revisions. Use a consistent snapshot or
continuation token so cards moving during the read do not disappear or duplicate.
Use bounded responses or a stream for large boards. Define partial failure behavior.

Acceptance: compare full and filtered reads under concurrent card moves, writes
and membership changes. Record round trips, payload bytes, server CPU and p95.
Rerun the load matrix against the same fixture. Demonstrate a measured tenfold
improvement on the expensive read before claiming this target is achieved.

## Keep native connections alive across harness calls

Problem: short native calls pay accounts requests, websocket setup and a complete
Node model load. The client already has a shared-session path.

Scope: the harness broker and call lifetimes. Reuse one authenticated native
connection where process ownership permits it. Define shutdown, reconnect, write
serialization and cancellation. Preserve renewal and deadline behavior.

Acceptance: compare cold and warm ping, resolve, read and write latencies with
request counts. Exercise close during connect, lost sessions and pending writes.
Check that no stale account or workspace is reused.

## Persist a validated model snapshot for Node clients

Problem: Node clients start with an empty model store and repeatedly download
the full model. A persistent connection does not cover every short-lived client.

Scope: the fork's persistence-store hook and API client. Key snapshots by server,
workspace and model identity, validate the server hash, replace files atomically
and fall back safely after corrupt data or upgrades. Keep permissions private.

Acceptance: measure cold, unchanged and changed-model connects. Check multiple
workspaces in one process and across processes. Show actual transferred bytes
and time saved without bypassing access checks.

## Materialize a board read model with explicit freshness

Problem: even batched reads repeatedly assemble the same card, label, comment
and collaborator facts for launchers and sweeps.

Scope: architectural work across fork and harness. Define an initial snapshot
plus ordered change feed, version and freshness contract. Incrementally maintain
a permission-aware board view. Handle collaborator changes, removals, archive,
workspace upgrades and membership revocation. Choose storage only after defining
invalidation and recovery. Separate cache-build time from warm-read time.

Acceptance: compare the materialized view with source reads during concurrent
writes and reconnects. Bound staleness and prove permission revocation behavior.
Measure warm latency, cold rebuild, memory, DB work and recovery from missed events.

## Batch guarded migration writes

Problem: the harness writes 25 cards per batch but each card still makes multiple
native reads and writes. Batches also pause one second and perform large final reads.

Scope: both fork and harness. Introduce a bounded batch mutation that validates
expected stage and labels, applies a set of changes and returns verified per-card
outcomes. Define retry keys and recovery for partial success. Keep normal board
reads responsive during migrations.

Acceptance: migrate disjoint 300-card slices at 1, 4, 8 and 16 clients. Compare
request counts, completion time, read tail latency and conflict outcomes. Test a
lost reply and prove the retry does not duplicate comments or mutations.

## Give independent harness clients independent rate budgets

Problem: independent launchers, sweeps and health checks currently spend the
same account budget. One migration can delay unrelated readers and connections.

Scope: the harness account selection and the fork's documented quota settings.
Choose explicit service identities or supported per-client quotas. Preserve
workspace membership and audit attribution. Treat raising RATE_LIMIT_MAX as an
operational alternative that must be capacity-tested, rather than as proof that
the underlying rejection behavior is correct. Do not modify existing secrets.

Acceptance: compare the same shared-account burst with separate local accounts
and a raised local limit. Show connects, request counts, error rate and event loop
delay. Verify that one migration cannot starve a health check. State the account
provisioning and ongoing access-management cost before a production change.

## Bound Postgres reservations across asynchronous presence triggers

Problem: the separate-account load reached a second global stall with no
rate-limit responses. CockroachDB showed ten idle transactor sessions. Read-only
debugger inspection found ten SQL connections cached in managed client_async
contexts and seven more managed contexts without a connection. The captured
stack ran through OnUserStatus, syncChat, trigger findAll and ConnectionMgr.retry.
New model loads could not obtain SQL capacity.

Scope: the fork's postgres-base ConnectionInfo and ConnectionMgr lifecycle,
server async transaction contexts and presence-trigger lookups. Trace the
reservation cycle, then bound held reservations and release idle leases before
waiting on work that can require the same pool. Preserve transaction semantics.
Use explicit cancellation and admission control where needed. Increasing the
pool alone is not an accepted fix for an unbounded reservation cycle.

Acceptance: reproduce with the default ten-connection pool and sixteen distinct
local users entering and leaving. Include fresh and existing contact records.
Record managed contexts, held and free leases, SQL activity and blocked model
loads. Verify that connects and health reads continue while presence triggers
run, including after a client disconnects. Run the committed matrix and both
shared- and separate-account bursts. Add focused reservation and cancellation
tests under this follow-up card.
