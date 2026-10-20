# JH-902522: a versioned snapshot read on the Huly server

Run: `jh-902522-backlog-c1`, branch `codex/jh-902522-backlog-c1`.
Fork half of JH-902493. Base `jj/activity-feed` at `c45f7774b`. `git merge-base
--is-ancestor origin/jj/activity-feed HEAD` passed, so the base is merged and no
merge commit was needed.

## What this adds

The server now offers one bounded, resumable read that returns several
queries from the same pinned version, so a client stops walking a cursor,
catching up and rechecking ids over many round trips.

**Wire call:** `findSnapshot(request: SnapshotRequest): Promise<SnapshotPage>`.

A request names a space and up to 16 sections. A section is a class, a query
and a page limit. A section whose class has a space attribute is scoped to the
request space by the server (`scoped` defaults to true). A section can be
`firstPageOnly`, for small reference data such as statuses and the label
catalog.

```ts
await client.findSnapshot({
  space: project._id,
  includeChanges: true,
  sections: [
    { key: 'cards', _class: tracker.class.Issue, query: {}, limit: 1000 },
    { key: 'labels', _class: tags.class.TagReference, query: { collection: 'labels' }, limit: 1000 },
    { key: 'comments', _class: chunter.class.ChatMessage, query: { collection: 'comments' }, limit: 1000 },
    { key: 'statuses', _class: tracker.class.IssueStatus, query: {}, limit: 500, firstPageOnly: true, scoped: false }
  ]
})
// { version, space, sections: [{ key, docs, total, more }], changes?, next?, failures, partial }
```

**Version and cursor.** The first page pins a server timestamp as `version` and
returns exact counts (`total`) per section. Pages continue from an opaque token
that carries the version, the space, the section keys and one `_id` cursor per
section. Rows are read in `_id` order with a strict `_id > cursor` filter, so a
row cannot be returned twice, whatever writes happen during the read.

**Disappearance.** A card that moves out of a filtered query behind the cursor
would otherwise vanish. On the last page the server reads every row of each
section modified at or after `version` and reports it in `changes` with whether
it still matches the section query, plus rows removed by `TxRemoveDoc`. A
caller reconciles those ids instead of restarting the read. The boundary is
explicit: `changes` covers writes committed before that final query.

**Permissions.** Every section query goes through the same pipeline as
`findAll`, so workspace membership and the existing space read security apply
unchanged. The server also loads the request space through that pipeline and
refuses the read when the space is not visible, and it pins scoped sections to
the request space so a caller cannot widen the read into another project. The
call grants no access that `findAll` does not already grant.

**Bounds and partial failure.** At most 16 sections, a per-section limit clamped
to 1 to 1000 (default 200), and at most 2000 rows per section in the change set.
A failed section is reported in `failures`, returns no rows and does not advance
its cursor, and the other sections still return rows. If no other section has
more rows the page has no `next`, so the caller retries the same cursor, or
reads the failed section again on its own. `partial` is true when any section
failed. Every page is bounded, so a large board is a sequence of pages rather
than one unbounded response.

**Description revisions.** A card document carries its `description` revision
reference, and the snapshot returns the card unchanged, so the reference is in
the read. The text of a revision lives in the collaborator's document store,
not in the transactor, so the snapshot does not inline it. The caller fetches
text in batches through the collaborator's existing bulk `getContents` path,
which keeps document access on the service that owns it. Comments are returned
as their own section from the transactor.

## Files changed

- `foundations/core/packages/core/src/snapshot.ts` (new): request, page, change and failure types.
- `foundations/core/packages/core/src/client.ts`: optional `findSnapshot` on `Client` and `ClientConnection`, delegated by `ClientImpl`.
- `foundations/core/packages/client-resources/src/connection.ts`: sends the `findSnapshot` request.
- `foundations/core/packages/api-client/src/types.ts` and `client.ts`: `PlatformClient.findSnapshot`.
- `foundations/server/packages/server/src/client.ts`: `ClientSession.findSnapshot` and `findSnapshotRaw`, the version, cursor, scope, bounds, change set and partial-failure logic.
- `dev/board-load/worker.cjs`, `driver.cjs`, `run.sh`: a `snapshot` scenario on the existing load rig, so before and after run on the same fixture and the same client. No server behavior is special-cased for it.

No model change and no migration. Nothing contacts `huly.lan`.

## Measurement setup

Local Huly stack from `dev/board-load`, restored JH snapshot
(`~/.local/state/jake-harness/huly-snapshot/`), on this worktree's tip. The
transactor, account, collaborator, config and files services are built from
this checkout. Snapshot restored into a fresh CockroachDB. Fixture: 2,430 JH
cards, 2,063 label references, about 5,600 comments, 22 statuses, 75 label
catalog rows. One client process, one native connection, page size 50 for the
client walk and 1,000 for the snapshot. Three samples per read, so a reported
p95 is the largest of three samples: this is an exploratory tail, not a
statistical one. Host was shared with another local board-load stack during the
concurrent run; the quiet run below is the one used for CPU.

Commands (both pushed commits):

```sh
BOARD_LOAD_NODE=$HOME/.local/opt/node-v22.23.3-linux-x64/bin/node \
  BOARD_LOAD_SCENARIOS=snapshot bash dev/board-load/run.sh
BOARD_LOAD_NODE=$HOME/.local/opt/node-v22.23.3-linux-x64/bin/node \
  BOARD_LOAD_SCENARIOS=snapshot BOARD_LOAD_MOVER=0 BOARD_LOAD_ITERATIONS=3 \
  bash dev/board-load/run.sh
```

The rig creates a fresh CockroachDB stack, restores the snapshot, builds
`pod-server`, `pod-account`, `pod-collaborator` and `api-client` from the
checkout, seeds local accounts, and stops only the containers it recorded. The
run's `snapshot.jsonl`, `event-loop.jsonl` and percentile table are local,
ignored artifacts.

"Client walk" is the existing harness read: `_id` cursor walk with exact totals,
a catch-up walk for rows written since the read began, and a batched id recheck.
"Snapshot" is the new server read. Round trips are the RPC counts recorded by
the rig's existing counters, not estimates.

### Full board read, quiet, 3 samples

| Read | Round trips | p50 ms | p95 ms | Payload bytes |
| --- | ---: | ---: | ---: | ---: |
| Client walk, 2,430 cards | 194 | 2088.8 | 2592.9 | 94,780 |
| Snapshot, 6 pages | 7 | 1017.1 | 1479.6 | 94,919 |

Round trips 194 to 7, **27.7x**. Wall clock 2.59 s to 1.48 s, 1.75x.

### Filtered read, quiet, 3 samples (1,811 cards, two largest statuses)

| Read | Round trips | p50 ms | p95 ms | Payload bytes |
| --- | ---: | ---: | ---: | ---: |
| Client walk | 79 to 101 | 977.0 | 1268.4 | 70,650 |
| Snapshot with facts (6 pages) | 7 | 988.5 | 1021.7 | 70,755 |
| Snapshot cards only (2 pages) | 3 | 167.5 | 175.1 | 70,698 |

Round trips 79 to 3, **26x**; wall clock 1.27 s to 0.18 s, **7.2x**. The
six-page variant also returns every label, comment, status and catalog row, so
it is not a like-for-like latency comparison: its payload is the whole fact set
and its wall clock matches the walk.

### Concurrent moves and writes, 3 samples

One client toggles card stages and posts comments in a tight loop while the
other performs the reads on the same board.

| Read | Round trips | p95 ms | Errors | Changed rows reported |
| --- | ---: | ---: | ---: | ---: |
| Client walk, full | 194 | 3623.0 | 0 | n/a |
| Snapshot, full | 7 | 15540.1 | 0 | 4 |
| Client walk, filtered | 79 to 101 | 5417.6 | 0 | n/a |
| Snapshot, filtered with facts | 7 | 1471.1 | 0 | 4 |

One full snapshot sample contains a stalled 15.5 s request (the project lookup
was retried, two `findAll` calls in the same sample). The mover's `setTaskStage`
has a 14.6 s maximum in the same run, so the stall is shared with the write
path, not evidence that the snapshot read is slow on its own. Three samples
cannot say whether it is the limiter, a garbage collection pause or a slow
query. Every other concurrent sample is between 1.0 s and 1.5 s. The full card
identity set matched the client walk in all three rounds, with 2,430 rows, no
duplicates and an explicit `changes` set of 2 to 4 rows per read. The filtered
set was 1,811 rows on both paths.

### Server CPU

Transactor CPU per second, from the rig's existing event-loop hook, attributed
to the read that was running in that second. Quiet run, three reads each.

| Read | CPU per read |
| --- | ---: |
| Client walk, full | 0.63 s |
| Snapshot, full | 0.28 s |
| Client walk, filtered | 0.12 s |
| Snapshot, cards only | 0.08 s |

Full read CPU falls 2.3x. On this local network the round trips are cheap, so
CPU and wall clock improve far less than round trips. The round-trip result is
the one that moves when the client is remote, which is the situation behind the
40 to 68 s board writes in the card.

## What is achieved and what is not

- **Tenfold round-trip target: achieved.** The full expensive read drops from
  194 to 7 RPCs (27.7x) and the filtered cards read from 79 to 3 (26x), measured
  on the same fixture, client and stack, with no failed samples.
- **Tenfold wall-clock target: not achieved.** Locally the full read is 1.75x
  faster and the filtered cards read 7.2x faster. I do not claim a tenfold
  latency improvement. The payloads are unchanged because the read returns the
  same documents.
- **Membership changes: not measured.** Tracker `Project` has no members
  attribute in this model, so there is no project-membership change to make.
  Workspace membership is enforced by the transactor session and the space read
  security, and the snapshot call adds no path around it. Changing workspace
  membership needs account-service writes outside this card's fixture, and was
  not done. The server refuses a space the account cannot see, which the code
  does through the same pipeline as `findAll`.
- The harness client change (JH-902493) is untouched. This report covers the
  server half only.

## Tests

The harness `gate/isolated_run.py` named in the run rules does not exist in this
repository, so the test files were run directly with the package jest and the
results are recorded in `docs/reports/jh-902522-backlog-c1/gate-results.jsonl`.
Each file ran once on tip `75c3a975d`, with `HULY_BOARD_CONFIG` offline and
`VIKUNJA_BASE_URL` at `http://127.0.0.1:9`.

| Test file | Result |
| --- | --- |
| `foundations/core/packages/core/src/__tests__/client.test.ts` | 2 passed, 0 failed |
| `foundations/core/packages/client-resources/src/__tests__/connection.test.ts` | 4 passed, 0 failed |
| `foundations/core/packages/api-client/src/__tests__/markup-client.test.ts` | 14 passed, 0 failed |

`foundations/server/packages/server/src/client.ts` has no test file that
directly tests it. The server package was built as part of the load rig's
`rush build --to @hcengineering/pod-server` in every measurement run, which
type-checks the file. The end-to-end check for the change is the snapshot
scenario above, which fails if the read returns a different card set or reports
a failed section.

## RECOMMENDATIONS

1. **JH-902493 should call `findSnapshot` with cards only when it wants card
   rows,** and add fact sections only when the facts are needed. That variant is
   3 round trips and 175 ms against 79 and 1,268 ms for the walk.
2. **Push fact filtering into the sections.** The six-page filtered read still
   returns every label and comment for the project. A later change could accept
   an id set per section (`attachedTo: {$in: [...]}`) so a filtered read carries
   only the facts of the selected cards.
3. **Add a `since` read.** The last-page change set already carries modified and
   removed ids. A follow-up can accept the previous `version` as the read
   version, turning board catch-up into one call.
4. **Investigate the 15.5 s stalled sample** under concurrent writes with more
   samples before relying on the tail.
5. **Add a server unit test for `findSnapshotRaw`** covering scope rejection, the
   cursor, the change set and a failed section. The card did not ask for one and
   the run rules forbid new tests, so none was added.

## Report paths

This file is the full report and lives where the other harness reports live. The
run brief also names `docs/reports/jh-902522-backlog-c1/report.md`, which holds a
short pointer to this file. Both are committed on the run branch.
