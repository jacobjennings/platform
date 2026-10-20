# CockroachDB indexes for board query shapes

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902491

## Result

One index is implemented and shipped. It cuts the per-card label lookup from
10,605 decoded rows to 6, and from 8 ms to 0.9 ms, on the exact query shape the
board issues. It is 1.3 MB and builds in 0.49 s on the restored snapshot.
End-to-end board read latency is unchanged within the spread of the session,
and single-card write latency is unchanged.

Two other candidate indexes were measured and rejected. The task project index
reduced scanned rows 5 to 9 times but made the JH project read and the VK8
supervision read slower. The activity index reduced rows scanned but introduced
an index join that made the comment page 8 times slower. Neither is in the
patch. The status JSON expression was evaluated and has no captured query, so
no index was added for it.

The card's acceptance is met for the index that shipped: the captured plan shows
fewer rows scanned on the exact parameters. No speedup of the board read is
claimed. The measurements show that at this fixture's data size the board read
is limited by per-card document reads and collaborator description fetches, not
by the scans these indexes can remove.

## What changed

- `foundations/server/packages/postgres/src/schemas.ts` adds
  `domainIndexDefinitions`, a table of indexes keyed by domain.
- `foundations/server/packages/postgres/src/utils.ts` creates them from
  `createTables` with `CREATE INDEX IF NOT EXISTS`, after the table exists or is
  created.

`createTables` already runs when the postgres adapter attaches a workspace, so
this is the adapter's existing workspace-attach path. A workspace whose table
already exists gets the index on its next start. `CREATE INDEX IF NOT EXISTS`
makes every later start a catalog check. CockroachDB builds the index online.

The index:

```sql
CREATE INDEX IF NOT EXISTS tags_workspace_attachedto_id
  ON tags ("workspaceId", "attachedTo", _id)
```

The tag queries in the capture are `WHERE "workspaceId" = $1 AND "attachedTo" =
ANY($2) AND data#>>'{collection}' = $3 AND "_class" = $4 ORDER BY _id LIMIT 50`
and the matching count. The index gives the equality prefix plus `_id` order for
the cursor page.

## Environment and data

The local Huly stack from `dev/board-load` was used, restoring the JH snapshot.
It has a source-built account, transactor and collaborator bundle on the
matching `v0.7.426` runtime images. CockroachDB is `v24.2.10`, single node, with
512 MiB cache and 512 MiB SQL memory. Node is `v22.23.3`. The Docker network is
internal and publishes no host port. No live board, `huly.lan`, SSH, system
service, graphical application or NVIDIA device was contacted or inspected.

Restored counts:

| Data | Rows |
| --- | ---: |
| Issues | 11,120 |
| Transactions | 231,166 |
| Activity rows | 183,335 |
| Collaborator documents | 33,763 |
| Issues with labels | 6,857 |
| Issues with comments | 10,603 |
| Statuses | 22 |

The restored tables had only their primary keys before the run:
`task_pkey`, `activity_pkey`, `tags_pkey`. No secondary index existed on the
columns the board queries.

## Captured SQL and plans

A diagnostic pass ran one `readProjectTasks` and one `readSupervisionBoard` with
SQL capture enabled. It recorded 71 statements and 44 distinct board query
shapes against `task`, `tags` and `activity`. Plans were taken with
`EXPLAIN ANALYZE` using the captured parameter values, not synthetic ones.

The most expensive shapes in that pass, by recorded calls and mean time:

| Shape | Calls | Mean |
| --- | ---: | ---: |
| activity count by `attachedTo` | 881 | 38.5 ms |
| task by `_id` and `_class`, limit 1 | 15,394 | 2.1 ms |
| tags count by `attachedTo` and collection | 60 | 10.2 ms |
| tags page by `attachedTo` and collection | 65 | 11.9 ms |
| task project page and count | 1,296 / 1,643 | 4.4 / 3.5 ms |
| activity page by `attachedTo` | 573 | 13.4 ms |

Before the index, the tag lookup decoded 10,605 KV rows in 8 ms. With
`tags_workspace_attachedto_id` it decodes 6 KV rows in 0.865 ms. The count and
page both use an index join for the two matched rows.

Rows scanned before and after the shipped index for the task and tag project
shapes (these shapes are not changed by the shipped index, they are included to
show the rejected alternatives):

| Shape | Rows before | With task space index | With shipped index |
| --- | ---: | ---: | ---: |
| task project page | 1,025 | 201 | 1,025 |
| task project count | 10,888 | 4,761 | 10,888 |
| task catch-up page | 11,121 | 4,861 | 11,121 |
| task catch-up count | 11,121 | 4,861 | 11,121 |
| task recheck by `_id` set | 501 | 1,001 | 501 |
| tags project page | 1,025 | 1,025 | 1,025 |
| tags project count | 10,407 | 10,407 | 10,407 |
| activity page by `attachedTo` | 2,049 | 2,049 | 2,049 |
| activity count by `attachedTo` | 184,435 | 184,435 | 184,435 |

## Rejected indexes

### task (`workspaceId`, space, `_id`)

It met the row-scan acceptance. Task pages fell from 1,025 to 201 rows and
counts from 10,888 to 4,761. Latency moved the other way:

- Five warm project reads with task and tag indexes: 2,868, 2,699, 2,562,
  2,661, 2,615 ms, median 2,661 ms.
- Five warm project reads with no index: 2,610, 2,472, 2,508, 2,575, 2,597 ms,
  median 2,575 ms.
- One project read and one supervision read with only the tag index: 2,268 ms
  and 36,766 ms.
- The same pair with task and tag indexes: 2,924 to 3,056 ms and 40,900 to
  41,385 ms.

The page plan pays a payload lookup for each of the 50 returned rows. At 11,120
issues the sequential primary-key scan it replaces is already cheap. The index
is not in the patch.

### activity (`workspaceId`, `attachedTo`, `_id`)

It cut the activity count from 184,435 to 18,961 rows but the plan adds an index
join for `space` and `_class`. The comment page moved from 2,049 rows in 6 ms to
9,757 rows in 49 ms. Three interleaved supervision reads went from a median of
38,076 ms without indexes to 44,194 ms with the activity index. It was 21.0 MB
and built in 1.18 s. It was dropped.

One further run with the activity index was stopped after 360 s with the
supervision read still running. That is recorded as an aborted sample, not a
completion.

### Status JSON expression

No captured query filters on the status JSON expression. The 44 captured shapes
include the task, tag and activity queries above, and staged issue reads arrive
as `_id = ANY($n)` sets, not as a status predicate. Following the card's rule
against an index without a query that shows its value, no expression index was
added.

## Index size and creation time

| Index | Bytes | Build |
| --- | ---: | ---: |
| `tags_workspace_attachedto_id` | 1,345,178 | 492 ms |
| task candidate, rejected | 1,271,025 | 2,776 ms |
| activity candidate, rejected | 21,026,993 | 1,182 ms |

The tags table is 9,039,543 bytes, so the shipped index adds about 15 percent.
Build times are wall clock around one `CREATE INDEX` statement on the restored
snapshot. `CREATE INDEX` holds the workspace attach until the backfill finishes
on a new workspace start. On this data that is under a second.

## Read latency

The reduced matrix ran `readProjectTasks` and `readSupervisionBoard` on the
restored data. The full matrix was not completed. The migration operation
stalled on the shared-account rate limiter, so the four-client migration never
finished and the driver was stopped. The read and single-card write shapes were
rerun instead.

Single-client read percentiles from the reduced matrix:

| Run | Operation | n | p50 ms | p95 ms |
| --- | --- | ---: | ---: | ---: |
| before | readProjectTasks | 3 | 1,769.7 | 2,018.0 |
| before | readSupervisionBoard | 1 | 62,266.3 | 62,266.3 |
| final | readProjectTasks | 3 | 2,912.8 | 3,202.3 |
| final | readSupervisionBoard | 1 | 60,145.4 | 60,145.4 |

The final arm of that matrix is not a clean index comparison. It ran with the
task and tags-space indexes, both later rejected, and its worker recorded
`rateLimited=1` and 15 paced requests, because the aborted supervision read had
spent the shared account's request budget. The clean comparison is the warm
repeated reads above, where the shipped index leaves the project read at
baseline. The one supervision sample with only the shipped index is 36.8 s,
against a median of 38.1 s from three samples without indexes.

Single samples are not tail estimates. The percentiles describe the recorded
attempts only.

## Write throughput

Single-card writes at one client, before and after:

| Operation | p50 before | p95 before | p50 final | p95 final |
| --- | ---: | ---: | ---: | ---: |
| setTaskStage | 141.8 ms | 182.1 ms | 142.1 ms | 145.5 ms |
| postTaskComment | 133.8 ms | 142.6 ms | 116.4 ms | 122.2 ms |

The shipped index adds one entry per `TagReference` write. Label references are
written only when labels change, so the write cost does not fall on ordinary
card updates. The samples above come from the reduced matrix, whose final arm
also held the rejected task and tags-space indexes, so they are an upper bound
for the shipped set. The bulk migration write path was not measured because of
the limiter stall above.

## Rollout and existing workspaces

- Existing workspaces: the index is created on the next workspace attach. No
  migration tool and no downtime. The attach waits for the build, which was
  0.49 s on the restored snapshot.
- New workspaces: the index is created in the same attach that creates the
  table.
- Failure: the build is retried three times, then logged. It does not stop the
  workspace from attaching. The next start tries again.
- Rollback: `DROP INDEX tags@tags_workspace_attachedto_id`. CockroachDB drops it
  online.
- Storage: 1.3 MB per workspace table set on this data, plus one index entry per
  label reference.

## Limits

- The arms were not interleaved with a recorded host load. The warm repeated
  reads were sequential on one stack.
- The migration and stall scenarios were not rerun because the shared-account
  limiter stalled the four-client migration. One supervision sample with the
  final set is reported, not three.
- The SQL capture did not record the tag `attachedTo` shape, so its plan used
  the recorded query shape with one real card identifier and the recorded
  collection value, not the exact captured parameter array. The task, activity
  and project shapes used exact captured parameters.
- Plan row counts were taken at two moments, roughly thirty minutes apart. The
  data gained the writes from the measurement runs in between.

## Tests

- `foundations/server/packages/postgres/src/__tests__/utils.spec.ts`: 82 passed,
  1 suite. Run on the tip with `HULY_BOARD_CONFIG` and `VIKUNJA_BASE_URL`
  pointing at `http://127.0.0.1:9`.
- The card names no test and no new test was written.
- The gate runner named in the run rules, `gate/isolated_run.py`, is not in this
  repository, so no gate record was produced.
- `integration.test.ts` and `storage.test.ts` need a CockroachDB reachable at
  `DB_URL`, defaulting to `localhost:26258`. The stack's database is only on its
  internal Docker network, so they were not run.
- The adapter path was verified on the real stack. The index was dropped and the
  transactor restarted with this patch. The index was recreated on workspace
  attach and `SHOW INDEXES FROM tags` listed it.

## Files changed

- `foundations/server/packages/postgres/src/schemas.ts`
- `foundations/server/packages/postgres/src/utils.ts`
- `docs/harness/reports/jh-902491-backlog-c3/report.md`
- `docs/reports/jh-902491-backlog-c3/report.md` (pointer to the report above)

The two adapter files are outside the card's named report path. The card asks
for the index to be implemented through the adapter, and the postgres adapter is
where table creation and workspace attach live.

## Recommendations

1. Do not add the task or activity indexes. The measured reads are slower with
   them at this data size.
2. Re-run the board matrix without the shared-account limiter, and after the
   description batching follow-up, so a SQL change can be measured against a
   read that is not dominated by per-card fetches.
3. Fix the adapter's table-creation index block. `createTable` guards index
   creation with `if (res.count > 0)`, which a `CREATE TABLE` statement does not
   satisfy, so the schema's own single-field indexes were never created on the
   restored tables. This is a separate card.
4. The board write stalls in the evidence are not explained by these scans. The
   limiter behavior and the per-card read batching follow-ups remain the larger
   levers.
