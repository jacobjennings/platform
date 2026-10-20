# Board schema indexes created on workspace attach

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902531

## Result

The postgres adapter now creates the domain schema's single-field indexes when
it attaches a workspace, for tables that already exist as well as new ones. On
the restored JH snapshot the 62 domain tables had only their primary keys,
except `tags`, which had the one index JH-902491 added. One attach created 197
secondary indexes, and the build took about 100 seconds on that data.

The measurements do not show a read improvement. With the full set, the
supervision read at one client went from 56.9 s to 490.3 s, an 8.6 fold
regression. That index is left out.

Two indexes are left out of the shipped set, `activity.attachedTo` and
`task.space`. Both changed a measured read for the worse. Every other schema
index is created.

The after matrix was not completed. Groups at 1 and 4 clients were measured.
The 8 and 16 client groups were stopped when the run budget ran out, and the
last part of the 4 client group was measured after the two indexes under test
had been dropped in the live database, as described below.

## The bug

`createTable` in `foundations/server/packages/postgres/src/utils.ts` issued
`CREATE TABLE IF NOT EXISTS` and then created the schema indexes only inside
`if (res.count > 0)`. `CREATE TABLE` does not report an affected row count, so
that branch never ran. No index marked `index` in the domain schemas existed on
a restored table.

## What changed

- `foundations/server/packages/postgres/src/utils.ts`
  `createDomainIndexes` now creates every field the domain schema marks with
  `index: true`, then the query-shaped entries from `domainIndexDefinitions`.
  It runs from `createTables`, which is the existing workspace-attach path, so
  an existing table gets the indexes on its next start. Each statement is
  `CREATE INDEX IF NOT EXISTS` and keeps the three-attempt retry. A failure is
  reported and does not stop the attach.
- The dead `if (res.count > 0)` branch in `createTable` is removed. It also
  pushed every field a second time, which is gone with it.
- `foundations/server/packages/postgres/src/schemas.ts` adds
  `declaredSchemas`, a copy of the declared schemas taken at load time.
  `getTableSchema` replaces `domainSchemas` entries with columns read from an
  existing table, and those fields all carry `index: false`. Without the copy,
  an existing table would get no indexes. `getSchemaIndexDefinitions(domain)`
  reads the declared copy and returns `<domain>_<field>` definitions, including
  `USING gin` where the schema sets `indexType`.
- `schemaIndexExclusions` names the fields whose index was measured slower and
  is therefore not created.

No data model or migration file changed. Existing workspaces get the indexes on
the next transactor start. Writing a `data` row is now also writing about three
secondary index entries per table.

## Missing indexes found before the change

`information_schema.statistics` on the restored snapshot listed 63 indexes over
62 tables. 62 were primary keys and one was `tags_workspace_attachedto_id`. So
every schema index was missing.

Capture: `before-indexes.csv` in the run evidence folder.

## Indexes after one attach

After the first attach the same query listed 197 secondary indexes. Examples
from `after-indexes.csv`:

| Table | Indexes created |
| --- | --- |
| `task` | `task__class`, `task_space`, `task_attachedto` |
| `tx` | `tx__class`, `tx_space`, `tx_attachedto`, `tx_objectspace` |
| `activity` | `activity__class`, `activity_space`, `activity_attachedto` |
| `collaborator` | `collaborator__class`, `collaborator_space`, `collaborator_attachedto`, `collaborator_attachedtoclass`, `collaborator_collaborator` |
| `space` | `space__class`, `space_space`, `space_private`, `space_members` (inverted), `space_archived` |

`space_members` is an inverted index, so `USING gin` from the schema reached
CockroachDB. No `createDomainIndexes` failure was logged.

## Indexes left out

Both were dropped in the live measurement stack and are not in the patch.

### `activity.attachedTo`

The supervision read at one client took 490.3 s with it, against 56.9 s before
any schema index existed. The activity queries in the statement statistics took
2.2 s to 3.0 s each, over about 165 count and 142 page calls, and used the new
index through an index join. Dropping it and `task.space` brought the same read
back to 61.8 s. This matches the activity index JH-902491 rejected.

### `task.space`

The one client project read took 3.49 s with the full set against 1.87 s
before. After dropping it and the activity index the same read was 3.04 s, so
it did not account for all of the change. JH-902491 also measured this shape,
`task (workspaceId, space, _id)`, and rejected it on latency. It is left out on
both grounds. The remaining 1.87 s to 3.04 s difference is not attributed.

## Rig numbers

Medians in milliseconds. `n` is the number of samples in the group. A sample is
one operation from one client. Supervision and migration have one sample per
client, so the group median is over 1, 4 or 8 samples. The rig rate limits each
group's account at 1,500 requests per 30 s, so project reads at 4 clients are
bimodal: four lanes finish in about 3 s, four wait about 29 s, four about 12 s.
The group median of 12 all-sample values is therefore a rate limit figure, not
a query figure.

| clients | operation | before | after, full set | after, shipped set |
| ---: | --- | ---: | ---: | ---: |
| 1 | connect | 104 | 96 | not measured |
| 1 | ping | 104 | 96 | not measured |
| 1 | resolveTask | 111 | 108 | not measured |
| 1 | readProjectTasks | 1,870 | 3,485 | 3,042 |
| 1 | readSupervisionBoard | 56,876 | 490,311 | 61,790 |
| 1 | setTaskStage | 116 | 159 | not measured |
| 1 | postTaskComment | 111 | 141 | not measured |
| 1 | migrateStageLabelsToStatus | 81,793 | 114,697 | not measured |
| 4 | connect | 214 | not measured | 238 |
| 4 | ping | 184 | not measured | 178 |
| 4 | resolveTask | 240 | not measured | 242 |
| 4 | readProjectTasks | 12,176 | not measured | 13,037 |
| 4 | readSupervisionBoard | 155,367 | not measured | 160,212 |
| 4 | setTaskStage | 260 | not measured | 248 |
| 4 | postTaskComment | 276 | not measured | 224 |
| 4 | migrateStageLabelsToStatus | 293,598 | not measured | 260,281 |
| 8 | readProjectTasks | 30,977 | not measured | not measured |
| 8 | readSupervisionBoard | 197,357 | not measured | not measured |
| 16 | readProjectTasks | 61,080 | not measured | not measured |
| 16 | readSupervisionBoard | 342,183 | not measured | not measured |

Before, the 8 and 16 client groups are complete for every operation except the
16 client migration, which was stopped after 11 minutes. The full before group
is in `run.kgax5B/baseline.jsonl` in the worktree's ignored `dev/board-load/results`.

The after run (`run.bY0Ijj`) reached group 1 with the full set and group 4 with
the shipped set. The one client shipped-set values come from a separate
`driver.cjs diagnostic` and two `driver.cjs pages50` probes on the same live
stack. Group 4 ran entirely after `activity.attachedTo` and `task.space` were
dropped, so it is the shipped set. Its project read median of 13,037 is 13
percent above the before group median of 12,176, while its single fast batch
moved from 3.0 s to 3.4 s and its slow batch from 29.0 s to 28.7 s.

A probe after also dropping the three `tags` schema indexes read 4,171, 3,142
and 2,513 ms at one client. It overlapped the start of group 8, so it is not
used for a conclusion. The groups at 8 and 16 clients are not reported for the
after side.

## Index bytes and build time

Sizes are `range_size_mb` from `SHOW RANGES FROM DATABASE profile WITH DETAILS,
INDEXES` on the live restored database. The capture was taken after the two
excluded indexes were dropped, so their size is not included. The 30 largest
secondary indexes total 145.2 MB. Primary keys are filtered out of that sum.
They are large on their own, 259.9 MB for `tx` and 241.7 MB for `activity`.
Every remaining secondary index is below 0.1 MB.

| Table | Index | MB |
| --- | --- | ---: |
| `tx` | `tx_objectspace` | 22.856 |
| `tx` | `tx_attachedto` | 21.954 |
| `tx` | `tx__class` | 21.780 |
| `tx` | `tx_space` | 19.673 |
| `activity` | `activity__class` | 19.114 |
| `activity` | `activity_space` | 18.512 |
| `task` | `task__class` | 1.127 |

The build ran inside the first attach. It started when the first client opened
the workspace at 19:13:06 UTC and the catalog count was stable at 197 indexes at
19:15:01 UTC. The wait loop polled every 5 s and required 15 s of stability, so
the build is between 95 and 115 seconds for the full set on this snapshot.

That build blocks the attach. The rig's smoke step connects with a 30 second
client timeout and failed on the first after run while the indexes were still
being built. The workaround for measurement was a temporary wait in
`dev/board-load/run.sh`, which is reverted and not part of this branch.

## Environment

The local Huly stack from `dev/board-load` ran with the restored JH snapshot at
workspace `hulyaccessevaluation`. CockroachDB `v24.2` single node with 512 MiB
cache. Node `v22.23.3`. The host has 48 CPUs and 188 GiB. Load average during
the before arm was 13.90, 8.66 and 8.75 on a 48 thread machine, so other work
shared the host. The after arm samples are in `host-load-after.txt` in the run
evidence folder. No `huly.lan` contact, no SSH, no systemd, no graphical
application and no NVIDIA device. The compose file uses `runc` with an empty
`CUDA_VISIBLE_DEVICES` and no device requests.

The two arms were not interleaved. The before arm ran first and the after arm
second, so host load drift is not controlled. The rig's own repeats give three
samples per operation per process, which is not a substitute for independent
interleaved runs.

## Checks

- Changed package build through the rig: `rush build` transpile completed and
  the bundle contained `getSchemaIndexDefinitions`. The attach then created the
  indexes, which is the end to end check.
- Type check: `npx tsc --noEmit -p tsconfig.json` reports pre-existing
  `implicitly has an 'any' type` errors and missing declaration files for
  workspace packages whose `types` were not built. None point at a changed
  line. The repo's package build script is `compile transpile src`, which
  transpiles only.
- Exclusion logic: after emitting the package with
  `npx tsc -p tsconfig.json --noCheck`, `getSchemaIndexDefinitions` returns
  `activity__class activity_space` for `activity` and
  `task__class task_attachedTo` for `task`, so the two exclusions apply.
- `storage.test.ts`: 8 of 8 failed with `AggregateError`. The test connects to
  a CockroachDB fixture started by `tests/prepare-tests.sh`, which was not
  started. Not a result about this change.
- `integration.test.ts`: not run, it states it needs a running CockroachDB
  instance from `tests/prepare-tests.sh`.

## Notes for the reviewer

The measurement stack was changed after group 4 began. I dropped
`activity.attachedTo` and `task.space` at 19:23:09 UTC to test the regression,
and dropped the three `tags` indexes at 19:34:37 UTC for one probe. The
`after-indexes.csv` capture was taken at 19:16 UTC and is the full set. The size
capture was taken at 19:35 UTC after the drops. The after run was stopped at
19:36 UTC.

RECOMMENDATIONS

- Run a full 1, 4, 8 and 16 client before and after matrix on an idle host,
  with the after set in the patch, before treating any of these numbers as a
  latency result. The arms here were single, sequential and shared the host.
- Attribute the remaining one client project read change, 1.87 s to 3.04 s.
  Candidate indexes are `task_attachedTo`, `tags__class`, `tags_space` and
  `tags_attachedto`. The probe that dropped the tags indexes was too noisy.
- Consider moving the index build off the attach path, for example a background
  job after the workspace starts serving. The current build holds the attach for
  about 100 seconds on this data and a client that connects meanwhile times out.
- If any further index here is found to hurt, add its field to
  `schemaIndexExclusions` and record the measurement in this report.
