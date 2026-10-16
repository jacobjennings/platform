# HP-900000 report: API performance for bulk reads and short-lived clients

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/HP-900000
Branch: `codex/hp-900000-backlog-c2`
Base: `origin/jj/activity-feed` at `befa4c42284bcc528509dc40a65c136be57231a9` (`befa4c422`). The worktree was cut from the same commit.
Run start: 2026-10-16T23:11:04Z. Time limit: 120 minutes.

## Result

- Added a batch markup read. `PlatformClient.fetchMarkups` sends one collaborator RPC (`getContents`) for many documents, instead of one HTTP request and one accounts lookup per card.
- `connect()` makes one fewer accounts call, because it reuses the login info that `getWorkspaceToken` already fetched.
- Wrote the trace, the measured and estimated numbers, the database check and the exact harness calls to switch to in `docs/harness/api-performance.md`.
- Not done: a Node model cache for `connect()`, any database index change, and any measurement against a live or local server. Reasons are in the guide and below.
- Nothing was measured after the change. The numbers are the card's before numbers and estimates from the code.

## Commits

| Commit | Change |
| --- | --- |
| `f9ba23c53` | `api-client/src/client.ts`: reuse login info in `connect()` |
| `d7333cd91` | Batch markup read across api-client, collaborator-client and the collaborator RPC |
| `36a02253a` | Correct a comment in `getContents.ts` (per-request lookup, not two) |
| report commit | This report and `docs/harness/api-performance.md` |

## Startup checks

- `gh auth status` (run first): `Logged in to github.com account jacobjennings (GH_TOKEN)`, active. A second `default` entry for the same account reported an invalid token and is inactive. Workers use the `GH_TOKEN` login.
- Step zero, install, three attempts:
  1. Node 26.10.0 (the default `node` on this machine) was refused. `rush.json` allows `>=20.0.0 <25.0.0`.
  2. Node 22.23.3, the version pinned in `harness.toml` `[tests].node`. Failed in the puppeteer postinstall, because `~/.cache/puppeteer` has no runnable `chrome-headless-shell`.
  3. Node 22.23.3 with `PUPPETEER_SKIP_DOWNLOAD=1`. Exit 0.
- `DEPS_READY` (from `install3.log`): the install exited 0 and `common/temp/node_modules` exists.

Every install, validate and jest command ran with `env -i` and the variables from the brief, plus `PATH` with the Node 22 `bin` first and `PUPPETEER_SKIP_DOWNLOAD=1`. `git` commands and `git push` ran outside `env -i`, because the push needs `SSH_AUTH_SOCK`. `GIT_EDITOR` was set in the inherited environment. Every commit used `-m`, so no editor ran.

## Files changed

In the Files list:

- `foundations/core/packages/api-client/src/client.ts`: `connect()` reuses `getWorkspaceToken`'s info. `PlatformClientImpl.fetchMarkups` delegates to the markup layer.

Outside the Files list. Each one is needed, and each change is additive:

- `foundations/core/packages/collaborator-client/src/client.ts`: `getMarkups` on the `CollaboratorClient` interface and implementation, plus the request and response types. The listed `collaborator-client/src/index.ts` already re-exports this file, so the types are public without an index change.
- `server/collaborator/src/rpc/methods/getContents.ts` (new file): the `getContents` handler. A new file keeps `getContent.ts` unchanged.
- `server/collaborator/src/rpc/methods/index.ts`: registers `getContents` in the method table. The RPC route only finds methods through this table, so this change cannot be avoided.
- `foundations/core/packages/api-client/src/markup/types.ts`: `MarkupFetchItem` and `fetchMarkups` on `MarkupOperations`. `PlatformClient` is built from `MarkupOperations`, so this is how the method reaches the public type. `api-client/src/types.ts` did not change.
- `foundations/core/packages/api-client/src/markup/client.ts`: the single-document format switch moved into `convertMarkup`, and `fetchMarkups` reuses it. `fetchMarkup` behaves as before.

Not changed, though listed: `api-client/src/index.ts`, `collaborator-client/src/index.ts`, `server/collaborator/src/index.ts`, `server/collaborator/src/rpc/index.ts`, `docs/harness/worker-guide.md`. The existing re-exports already cover the new types and functions.

## Trace (summary)

The full trace is in `docs/harness/api-performance.md`. In short:

- Per connection: `GET /config.json`, three accounts calls before this change (two after), then the websocket to the transactor and a full `loadModel`. Node has no model store, so the model is always downloaded in full (`client-resources/src/index.ts:46-76`; checked that `localStorage` and `indexedDB` are `undefined` in Node 22.23.3).
- Per page of 50: one transactor `findAll`. About 48 pages for 2,351 cards.
- Per card: `fetchMarkup` is one HTTP request to the collaborator, one accounts lookup in `getContext` and one storage read for the Y document. Hocuspocus `openDirectConnection` does not run `onAuthenticate`, so the RPC path has no other auth work.
- Per card: comments and attachments, as the card describes. The existing `findAll` with `attachedTo: { $in }` can batch them with no server change.

## Measurements

No new measurements.

- Could not reach `huly.lan`. Director ruling.
- The local stack needs MongoDB. `command -v mongod` returned nothing on this machine. docker and podman exist, but building and running the whole stack was not attempted in this run.
- The numbers in the guide are the card's, measured 16 Oct 2026 23:02 to 23:05 UTC from jjpc to `huly.lan`. The per-card figure is 147,165 ms / 2,351 = 62.6 ms, which I checked with arithmetic.
- The batch saving per card is one HTTP round trip and one accounts round trip. Its size is not measured.

## Database check

Checked from the model source, not with `explain()` (no Mongo here).

- Issues by `space` and `status`: `DOMAIN_TRACKER` disables `{ space: 1 }` and `{ status: 1 }` (`models/tracker/src/index.ts:747-767`), so the `status` index in `models/tracker/src/types.ts:194` is never created. No compound index exists. A full scan is likely but not proven.
- Order by `number`: no index annotation on `number`.
- `TagReference` by `attachedTo`: no `@Index` on `attachedTo` found in `models/core` or `models/tags`. Unknown until `explain()` runs.
- No index was added. A model change needs a named card (worker guide), and the `disabled` list may be deliberate for write cost. The code does not say which.

## Tests

Run exactly as the brief names, once on the final code tip `36a02253a`:

```
cd foundations/core/packages/api-client && npx jest src/__tests__/markup-client.test.ts
```

- Result: `PASS src/__tests__/markup-client.test.ts`. `Tests: 14 passed, 14 total`. `Test Suites: 1 passed, 1 total`.
- An earlier run on `d7333cd91` also gave 14 of 14. It was rerun on the final tip, as the brief asks.
- No new tests were written (owner rule for this card).
- The test mocks the collaborator client, so it does not run the batch RPC.

Search for other tests that touch the changed code:

```
rg -ln "@hcengineering/collaborator-client|markup/client|rpc/methods|api-client" --type ts foundations/core/packages/api-client/src foundations/core/packages/collaborator-client server/collaborator/src | rg "__tests__|test\.ts"
```

Hits: `api-client/src/__tests__/markup-client.test.ts` (run, 14 of 14 passed) and `api-client/src/__tests__/markup-types.test.ts` (not run). The second file imports the markup types I changed. The brief names only the first file, so I did not run the second. The merge lane should run it.

## Validation

Targeted `rush validate` (not repo-wide, per the worker guide). The brief asked for the plain form, which is repo-wide, and the guide forbids that for workers.

- After the `connect()` change: `validate --to @hcengineering/api-client`, exit 0.
- After the batch change: `validate --to @hcengineering/api-client` and `validate --to @hcengineering/collaborator`, exit 0.
- After the comment fix: `validate --to @hcengineering/collaborator`, exit 0.

## Gate

Not run. The brief names `$HARNESS_RUN_EVIDENCE/gate-results.jsonl` as the gate results file. `HARNESS_RUN_EVIDENCE` is not set in this worker's environment, and neither the brief nor the worker guide gives the gate's command. No results file exists, so none is copied into this folder. The Director or the merge lane needs to run the gate.

## Findings outside this card

1. `getContent` takes the document name from the URL and opens it with no workspace check. Hocuspocus skips `onAuthenticate` for direct connections (`@hocuspocus/server` 2.15.3, `Hocuspocus.ts:634-650`). A token for one workspace may be able to read a document of another. Not tested here. The batch handler has the check. Fix in a separate card.
2. Node has no model store, so every short-lived process downloads the full model.
3. `getWorkspaceIds` in the collaborator has no cache, and its own TODO asks for one.
4. Harness problem for the JakeHarnessDirector session (not fixed here): on this machine the default `node` is 26.10.0, which `rush` refuses. The puppeteer postinstall also fails without a cached Chrome. Workers need Node 22 first on `PATH` and `PUPPETEER_SKIP_DOWNLOAD=1`, or the pinned Node set as the default.

## RECOMMENDATIONS

1. After merge and the owner's deploy, measure the batch as the guide describes: 50 `fetchMarkup` calls against one `fetchMarkups` call with the same 50 items, on the Huly host. Record both numbers.
2. File a separate client-resources card for a per-workspace model store for Node `connect()`. Use the existing `getLastHash` same-hash check. The owner picks the cache location and permissions.
3. File a separate security card for the workspace check in `getContent`. Use the check in `getContents` as the model.
4. Run `explain('executionStats')` on a seeded fixture of at least 2,000 issues for the three queries in the database section. If the plan is a collection scan, propose `{ space: 1, status: 1, number: 1 }` in a new card with the named model change.
5. The Director files the jake-harness client change: use `fetchMarkups` in pages of 50, and batch comments and attachments with `attachedTo: { $in }`. Plan a fallback to per-card `fetchMarkup` if a batch call fails.
6. The merge lane runs `markup-types.test.ts` and the gate.
7. Add the `getWorkspaceIds` cache from its TODO, as a small follow-up.

Review: not yet run.
