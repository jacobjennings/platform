# API performance for bulk reads and short-lived clients

This page covers the server and client changes for HP-900000. It explains where
the time goes for a whole-project read, what changed, the new bulk call, and
the calls the harness client should switch to after the change is deployed.

Deploying to `huly.lan` is an owner step after merge. Nothing in this change
contacts a live server.

## Status

| Item | State |
| --- | --- |
| Batch markup read (`fetchMarkups`, RPC `getContents`) | Added |
| One fewer account call per `connect()` | Done |
| Node model cache for `connect()` | Not changed. Design needs a decision, see below |
| Database indexes for harness queries | Not changed. Needs `explain()` on a fixture first |
| Comments and attachments in one call | No server change needed. Use `findAll` with `attachedTo: { $in: ids }` |

## Where the time goes

Trace of one whole-project read as the harness does it. The scope column says
whether a cost is paid once per connection, once per page of 50, or once per
card.

| Step | Server path | Round trips | Scope |
| --- | --- | --- | --- |
| Start `node`, ssh, module load | Harness host only | 0 on the server | Per call |
| `GET /config.json` in `loadServerConfig` | Front or accounts HTTP | 1 | Per connection |
| `selectWorkspace` in `getWorkspaceToken` | Accounts service | 1 | Per connection |
| `getSocialIds` in `connect` | Accounts service | 1 | Per connection |
| `selectWorkspace` again in `connect` | Accounts service | 1 | Per connection. Removed by this change |
| `GetClient`: websocket and `loadModel` | Transactor | 1 handshake plus the full model | Per connection |
| `findAll(tracker.class.Issue)` with limit 50 | Transactor, Mongo `DOMAIN_TRACKER` | 1 | Per page, about 48 pages for 2,351 cards |
| `findAll(TagReference)` with `attachedTo: { $in }` | Transactor, Mongo `DOMAIN_TAGS` | 1 | Per page when batched |
| `fetchMarkup(Issue, id, 'description', ref, format)` | Collaborator `POST /rpc/:id` | 1 HTTP | Per card |
| Account lookup inside the collaborator RPC (`getContext`) | Accounts service | 1 | Per card |
| Y document load (`openDirectConnection`) | Collaborator, storage adapter | Storage read | Per card |
| Comments and attachments, one `findAll` per kept card | Transactor | 1 each | Per card, as the card describes |

Notes on the trace:

- `connect()` runs the `loadModel` handshake on every new connection. The
  client has a same-hash short cut and an incremental `loadModel(lastTxTime,
  hash)` path, but both need a persistence store. In Node that store is always
  empty. `foundations/core/packages/client-resources/src/index.ts:46-76` creates
  the IndexedDB store only when `localStorage` exists. I checked on the pinned
  Node 22.23.3 that `typeof localStorage` and `typeof indexedDB` are both
  `undefined`. Every api-client connect therefore downloads the full model.
- The collaborator RPC path for one card is `getContent`. Hocuspocus
  `openDirectConnection` does not run `onAuthenticate`
  (`@hocuspocus/server` 2.15.3, `Hocuspocus.ts:634-650`). The only auth work
  per RPC is the accounts lookup in `getContext`
  (`server/collaborator/src/server.ts`, `getWorkspaceIds`, which has no cache).
- Each card's description costs one HTTP round trip, one accounts lookup and one
  storage read. The storage read is the part that the batch does not remove.

## Measured numbers

Measured by the card on 16 Oct 2026, 23:02 to 23:05 UTC, from jjpc to
`huly.lan` (12 cores, 16 GB RAM, load average about 4.6):

| Read | Before |
| --- | --- |
| One card stage | 314 to 386 ms (3 runs) |
| Stage filter returning 2 cards | 2,255 to 2,405 ms (2 runs). Almost all fixed cost |
| Whole JH project, 2,351 cards, 5.99 MB JSON | 147,165 ms, about 62.6 ms per card |
| Stage filter, 320 VK8 cards | 12 s |
| Whole VK8 project | More than 600 s, timed out three times |

After numbers: not measured. The worker could not reach `huly.lan`, and the
local stack needs MongoDB, which is not installed on this machine
(`command -v mongod` returned nothing). The estimates below come from the code.

Estimate for the markup part of the whole-project read:

- Before: 2,351 HTTP requests, 2,351 accounts lookups and 2,351 storage reads.
- After, with batches of 50: 48 HTTP requests, 48 accounts lookups and still
  2,351 storage reads.
- The saving is one HTTP round trip and one accounts round trip per card. The
  size of that saving against the 62.6 ms per card average is not measured, and
  the card's numbers do not split markup from `findAll`.

Measure it after deploy on the Huly host, with the same 50 cards:

1. Time 50 calls of `fetchMarkup` in a loop.
2. Time one `fetchMarkups` call with the same 50 items.
3. Compare the two. Both use the same format.

## New bulk call: `fetchMarkups`

Added to `MarkupOperations`, so it is on `PlatformClient`:

```ts
fetchMarkups: (
  objectClass: Ref<Class<Doc>>,
  objectAttr: string,
  items: MarkupFetchItem[],
  format: MarkupFormat
) => Promise<string[]>

interface MarkupFetchItem {
  objectId: Ref<Doc>
  markup: MarkupRef
}
```

- `items[i].markup` is the same value the harness passes to `fetchMarkup` as
  the markup reference (the issue's description reference).
- The result is in the same order as `items`. A missing markup comes back as
  `''`.
- `format` is `markup`, `html` or `markdown`. Any other value throws.
- No cap is set on the number of items. The caller should page, for example 50
  per call, to keep requests and responses moderate.
- If one document is outside the token's workspace, the whole call fails.

Example for the harness client:

```ts
const items = page.map((issue) => ({ objectId: issue._id, markup: issue.description }))
const descriptions = await client.fetchMarkups(tracker.class.Issue, 'description', items, 'markdown')
```

### Collaborator RPC

`POST /rpc/<id>` with `Authorization: Bearer <token>` and body:

```json
{
  "method": "getContents",
  "payload": {
    "documents": [
      { "documentId": "<workspaceUuid>|<objectClass>|<objectId>|<objectAttr>", "source": "<optional blob ref>" }
    ]
  }
}
```

The response is `{ "contents": { "<documentId>": { "<attr>": "<markup>" } } }`.
The `<id>` in the URL is the first document id. The server ignores it for this
method.

The server checks each `documentId` against the workspace in the token and
returns an error for any other workspace. The single-document `getContent` path
does not do that check (see findings).

## Connection cost

Change: `connect()` reuses the workspace login info from `getWorkspaceToken`
and no longer calls `selectWorkspace` a second time. That removes one accounts
round trip per connection. The removed `Workspace ... not found` branch could
not run before this change, because `getWorkspaceToken` throws first.

Not changed: the model load. Options and why the change is not made here:

1. A Node model store that keeps the last model per workspace on disk. The
   core client already uses it. With a stored hash that matches, the connection
   skips the transfer (`foundations/core/packages/core/src/client.ts:374-400`).
   The hook is `OverridePersistenceStore` metadata (`plugins/client/src/index.ts:93`).
   That hook is global, not per workspace, and it is read inside the
   client-resources module, which is outside this card's file list. A process
   that connects to two workspaces would share one store.
2. Where to put the cache file, its permissions, and when to drop it after a
   model upgrade are policy choices for the owner.
3. Cost of the full model load: not measured, and not estimable from the code,
   because the size of the model is not in the repo. The card's 2.2 seconds of
   fixed cost includes ssh, node start, the accounts calls, the websocket and
   `loadModel`, and the card does not split them. To measure it on the host,
   once per connection, log the byte size of the `loadModel` response and the
   time that `GetClient` takes.

Recommendation: a separate card that adds a per-workspace model store to
client-resources, keyed by workspace, with the same-hash check and a file in a
location the owner picks.

## Database side

Checked from the model source. Mongo is not available here, so no `explain()`
was run.

| Harness query | Index in code | Verdict |
| --- | --- | --- |
| Issues by `space` and `status` | `DOMAIN_TRACKER` disables `{ space: 1 }` and `{ status: 1 }` (`models/tracker/src/index.ts:747-767`). The `@Index(IndexKind.Indexed)` on `status` (`models/tracker/src/types.ts:194`) is therefore skipped (`foundations/server/packages/core/src/domainHelper.ts:118-135`). No compound index is declared | No index in code that serves this filter. A full scan is likely but not proven |
| Order by `number` | `number` has no index annotation in `models/tracker/src/types.ts` | Sort after the match. No index |
| `TagReference` by `attachedTo: { $in }` | `DOMAIN_TAGS` disables `space` and `attachedToClass` (`models/tags/src/index.ts:148-160`). No `@Index` on `attachedTo` was found in `models/core` or `models/tags` | Unknown until `explain()` runs |

No index was added. Reasons:

- A model change under `models/` needs a named card and a statement of what it
  does to existing workspaces (worker guide). Index creation runs on workspace
  upgrade.
- The `disabled` list may be deliberate, for write cost. The code does not say.
- The trace shows the index is absent. It does not show a full scan.

Next step: run `explain('executionStats')` on a seeded fixture of at least
2,000 issues, for the three queries above. If the plan is a collection scan,
propose `{ space: 1, status: 1, number: 1 }` in a new card.

## Calls the harness client should switch to

These change the harness client, which the Director files as a separate card
after this change is merged and deployed.

1. Descriptions: replace the per-card loop
   `client.fetchMarkup(tracker.class.Issue, id, 'description', ref, fmt)` with
   one `client.fetchMarkups(tracker.class.Issue, 'description', items, fmt)` per
   page of 50 items.
2. Comments and attachments: replace one `findAll` per kept card with one
   `findAll` per page, `attachedTo: { $in: ids }`, then group the results by
   `attachedTo`. This uses the existing server path, so no server change is
   needed.
3. Connections: keep one connection per process where possible. The connect
   path is one account call cheaper once deployed. No client code change is
   needed for that.
4. `findAll` page size stays 50 for now.

## Findings outside this card

- `getContent` (`server/collaborator/src/rpc/methods/getContent.ts`) takes the
  document name from the URL and opens it without a workspace check. Hocuspocus
  skips `onAuthenticate` for direct connections. A token for one workspace may be
  able to name a document in another. Whether content is returned depends on
  whether that document is already in memory. Not tested here. Fix in a separate
  card, with the same check that `getContents` uses.
- Node has no model store, so each short-lived process downloads the full model.
  See Connection cost.
- `getWorkspaceIds` in the collaborator has no cache. Its own TODO asks for one.

## Tests

- `foundations/core/packages/api-client/src/__tests__/markup-client.test.ts`:
  14 of 14 passed on `36a02253a`. The test mocks the collaborator client, so it
  does not exercise the batch RPC.
- No new tests were written, per the owner rule for this card.
- Targeted validation: `rush validate --to @hcengineering/api-client`,
  `--to @hcengineering/collaborator` and `--to @hcengineering/collaborator-client`
  passed.
