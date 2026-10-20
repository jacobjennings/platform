# Activity index for the board comments JSON query

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902563

Code tip: `cc88478b1`, also the pushed branch tip for the code change. Everything
below ran on the restored JH snapshot in a local CockroachDB node. No
`huly.lan` contact, no SSH, no systemd, no GPU.

## What the query is

The `data#>>` key is `collection`. The server builds it from
`transformKey` in `foundations/server/packages/postgres/src/storage.ts:1261`
(non-array data field, so `data#>>'{collection}'`).

The call site is the harness board snapshot read, not the fork's server:

- `board/huly-board.cjs`, `snapshotSectionList` line 1221:
  `{ key: 'comments', _class: chunter.class.ChatMessage, query: { collection: 'comments' }, ... }`.
- That request is sent by `readProjectSnapshot` -> `client.findSnapshot`, called
  once per project space from `readBoardSnapshot`, which serves
  `readSupervisionBoard`, `readSelectedBoard` and `readPreparerBoard`.
- The server side is `findSnapshotRaw` in
  `foundations/server/packages/server/src/client.ts:371`.

`chunter.class.ChatMessage` moved to the `activity` domain in
`models/chunter/src/migration.ts:164`, so the query runs on the `activity`
table. `activity` has no `collection` column (columns are `workspaceId`, `_id`,
`_class`, `space`, `modifiedBy`, `createdBy`, `modifiedOn`, `createdOn`,
`%hash%`, `attachedTo`, `data`), so the filter is the JSON expression.

The section is `scoped: false`, so every project's snapshot read fetches every
comment in the workspace, 21 pages of 1000, then filters by `attachedTo` in the
client. That is why each project costs 21 pages.

## What changed

`foundations/server/packages/postgres/src/schemas.ts`

- `DomainIndexDefinition` gains an optional `storing` string.
- `domainIndexDefinitions.activity` gains
  `activity_workspace_collection_id` on
  `("workspaceId", (data#>>'{collection}'), _id) STORING (_class)`.

`foundations/server/packages/postgres/src/utils.ts`

- `createDomainIndexes` appends ` STORING (...)` when a definition sets it.

The `STORING (_class)` part is required. Without it the planner applies the
`_class` filter above the primary key lookup and fetches the row payload for
every remaining matching entry. On page 3 that was 13,060 decoded rows and
54 ms, against 2,048 rows and 15 ms with `_class` carried in the index.

The adapter's statement is in `index-statement.sql`. It issued and built in
0.7 s on the restored snapshot. The index is 22.10 MB. The built
`lib/schemas.js` emits exactly this statement:

```
CREATE INDEX IF NOT EXISTS activity_workspace_collection_id ON activity ("workspaceId", (data#>>'{collection}'), _id) STORING (_class)
```

## Measurement

Snapshot: `~/.local/state/jake-harness/huly-snapshot`, restored with
`RESTORE DATABASE defaultdb FROM LATEST IN 'nodelocal://1/huly-snapshot-20261019'
WITH new_db_name = 'jh563'` into CockroachDB v24.2.10, single node, `--runtime
runc`, memory store, 6 GiB, no devices. The restore reported 469,943 rows,
fraction 1.

Sizes: `activity` 183,335 rows, of which 20,669 have
`data->>'collection' = 'comments'`, all `chunter:class:ChatMessage`. There are
10 spaces with comments. The workspace is
`4663bf36-78fb-4c61-b3af-93a577fe844a`, the account used in the security
predicate is a member of 23 of 64 spaces.

The query is the statement from the card's evidence, with real parameters:
workspace id, `'comments'`, a real `_id` cursor, `_class = ANY` on
`chunter:class:ChatMessage`, and the `space` security `EXISTS` with a real
member uuid. A page is `ORDER BY _id LIMIT 1000`.

### Worst page, page 9 of 21

Page 9 is the page where the comments stop being dense. Raw output is in
`explain-analyze-before.txt` and `explain-analyze-after.txt`.

| | rows decoded from KV | execution |
| --- | ---: | ---: |
| before | 164,295 | 118 ms |
| after | 3,653 | 13 ms |

The after plan scans `activity@activity_workspace_collection_id` with
`spans: [/'...'/'comments'/e'<cursor>\x00' - /'...'/'comments']`, filters
`_class` on the index, then joins the primary key for 1,500 rows and the
`space` table for 1,000. The before plan scans `activity@activity_pkey` from
the cursor and decodes the JSON path on 164,190 activity rows to find 1,000 matches.

The separate per-page capture records 164,275 total KV rows on page 9.
The raw before plan above records 164,295 total KV rows, including 105 space
rows. These are different executions.

Per-page rows and times for all 21 pages are in `per-page-before.tsv` and
`per-page-after.tsv`.

### Whole comments walk, 21 pages

`walk-before.txt` and `walk-after.txt`, three runs each, one psql session,
`\timing`, same cursor values on both arms.

| arm | run 1 | run 2 | run 3 | median |
| --- | ---: | ---: | ---: | ---: |
| before | 300.4 ms | 275.1 ms | 293.2 ms | 293.2 ms |
| after | 561.7 ms | 509.8 ms | 471.5 ms | 509.8 ms |

Total rows decoded across the 21 pages: 256,130 before, 181,458 after, a 29
percent drop. The worst page falls 45 times.

The wall time is worse on this node. The node holds the table in memory, so the
before plan's scan of 164,275 primary key rows is cheap and sequential. After
the index, pages 10 to 18 switch from a streaming lookup join to a hash semi
join and decode 9,668 to 23,375 rows each instead of 1,000 to 11,707. The index
is a clear win only on the page that scans the sparse tail. The live node's
per-row cost is much higher than this node's, but I did not measure the live
node, so the Director's live whole-board read is the outcome check.

## Recommendation: the read should not send this query per project

The comments section is unscoped, so each project's snapshot read pages all
20,669 workspace comments. With the board reading several projects, that is
21 pages times the project count. The same comments are then filtered by
`attachedTo` in the client.

The harness can avoid most of it without changing the response shape:

- Scope the comments section to the project's space, the way the cards section
  is scoped. Comments whose space differs from the card's space would need the
  by-`attachedTo` fallback the cursor walk already has for them.
- Or fetch comments and attachments by the kept card ids in the snapshot
  request, as `cursorProject` already does with
  `{ attachedTo: { $in: ids }, collection: 'comments' }`.

Either change removes the 21-page walk per project and with it most of this
query's cost. That change belongs to the harness repository, not this card.

## Tests

Search used: `ls foundations/server/packages/postgres/src/__tests__/` and
`grep -rn "domainIndexDefinitions\|schemaIndexExclusions" .../src/__tests__/`
(no hits, so no test file directly tests `schemas.ts`). `utils.spec.ts` is the
direct test of the changed `utils.ts`.

| test file | suites | tests | passed | failed | exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| `foundations/server/packages/postgres/src/__tests__/utils.spec.ts` | 1 | 82 | 82 | 0 | 0 |

`gate/isolated_run.py` was tried on this tip with
`HARNESS_CONFIG=/home/jakej/gh/jake-harness/harness.toml`. It applied the
jake-harness default TypeScript runner (`node --test`) because huly-platform
has no `[[tests.runners]]` settings, and that runner cannot load this jest file
(`ERR_MODULE_NOT_FOUND` on `src/utils`). The card says the jake-harness test
rules do not apply to this fork, so the jest run is the record here. The record
in `gate-results.jsonl` is the worker's record of that jest run on tip
`cc88478b1`, in the same shape as earlier cards.

Test setup: `rush install` needed `PUPPETEER_SKIP_DOWNLOAD=1` because the
sandbox has no browser download, then `rush build --to @hcengineering/postgres`
succeeded. The test ran with the offline board settings at
`http://127.0.0.1:9`.

## What ran

- `docker run cockroachdb/cockroach:latest-v24.2`, single node, `runc`, memory
  store, no devices, port 26357 on loopback.
- One `RESTORE DATABASE` from the local snapshot into `jh563`.
- `EXPLAIN ANALYZE` of the comments query on 21 pages with real cursor values,
  before and after the index.
- 21-page `psql` walks, three runs per arm.
- The adapter's `CREATE INDEX ... STORING (_class)` statement.
- `rush install`, `rush build --to @hcengineering/postgres`, `npx jest
  src/__tests__/utils.spec.ts`.

## Files changed

- `foundations/server/packages/postgres/src/schemas.ts`
- `foundations/server/packages/postgres/src/utils.ts`
- `docs/reports/jh-902563-backlog-c1/` (report pointer, evidence, gate record)
- `docs/harness/reports/jh-902563-backlog-c1/report.md`

## Review correction

The reviewer changed the emitted covering-column clause from `STORING` to
`INCLUDE` for PostgreSQL compatibility. CockroachDB treats `INCLUDE` as an
alias for `STORING`. The SQL capture and timings above describe the original
worker run, not a new run of the reviewer change.

## RECOMMENDATIONS

- Change the harness snapshot read so the comments and attachments sections are
  scoped to the project or fetched by card id. That removes the repeated
  21-page walk and is the larger fix.
- If the Director's live read does not improve, drop
  `activity_workspace_collection_id`. Its page-9 win is real but its aggregate
  effect on a fast node is negative.
- Consider indexing `activity` on a real `collection` column instead of a JSON
  expression. That needs a migration and a card of its own.
- The card's evidence says every page scans the whole table. That is true of
  one page in 21 on this snapshot, page 9, whose raw before plan scans 164,190 activity rows out of the reported
  183,335 activity rows.
  The other 20 pages stop early because comments are dense in the early `_id`
  order.
