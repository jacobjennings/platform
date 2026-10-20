# Record: JH-902461 cancel collaborator reads and model connects at the owning deadline

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902461

Branch: `codex/jh-902461-backlog-c1`
Tip tested and pushed: `7c84af76da73864fb777aa74a2132e51e5e21323`
Parent branch: `jj/activity-feed`, tip `7a6e1daee2992391fe920fe382c5c119ac8f2bbf`

## Merge status

The brief named `origin/main` tip `694ba075c47702fbfb792f957903832fb97e0907`.
That object is not in this repository (`git cat-file -t` reports it missing).
The live `origin/main` was `33f141364aeef905ac6fbf029a46e3bc123239ae`.

I merged `origin/main` once at the start. The push was then refused by
`git-force-push-guard` because the merge brought upstream commits whose author
and committer identities are not the owner's (`commit-identity-check.py` exit
100). That guard has no override and the checker states the historical
exception cannot be reconstructed. To deliver the work I reset to the parent
tip and cherry-picked the card commit, so this branch does not contain
`origin/main`. It contains only this card's commits on top of
`jj/activity-feed` at `7a6e1daee`. Nothing was rewritten on a pushed branch;
the refused merge never left this worktree.

## Card against the current tree

- The fork branch, not `origin/main`, carries the batch markup API the card
  depends on (`server/collaborator/src/rpc/methods/getContents.ts` and
  `fetchMarkups`). `origin/main` does not have that file or those methods.
- The card's named base commit is absent, so the parent branch above is the
  effective base. Main wins no line in this change because main has no version
  of these files.

## What changed

Cancellation is now owned by an `AbortSignal` from the call that started the
work. Aborting stops further attempts, aborts supported HTTP fetches, closes
the websocket and rejects work that is still pending.

### Collaborator HTTP reads and retries

`foundations/core/packages/collaborator-client/src/client.ts`

- `73-83`: `getMarkup`, `getMarkups`, `createMarkup`, `updateMarkup` and
  `copyContent` take an optional `signal`.
- `102-119`: `rpc` checks the signal before sending and passes it to `fetch`,
  so an in-flight description fetch is aborted rather than left running.
- `134-217`: every read and write passes the signal into the retry loop.
- `221-287`: the retry delay is abortable and clears its timer. After an abort,
  no new attempt is started, including for a write. This preserves the
  uncertain-write rule: the caller reads back, and the client does not replay a
  timed-out write automatically. Non-abort retry behaviour is unchanged.

### Native connection, model load and retry timers

`foundations/core/packages/client-resources/src/connection.ts`

- `67-110`: abort helpers and an abortable wait for the client pacing delay.
- `112-149`: each pending request records its reconnect timer; the connection
  tracks rate-limit retry timers.
- `205-215`: the connection listens to `ClientFactoryOptions.signal` and closes
  itself when the owning call is aborted.
- `224-226`: `getLastHash` refuses a cancelled call before and after waiting
  for the socket.
- `271-302`: `close()` clears reconnect and rate-limit timers, rejects and drops
  all pending requests, and closes the socket. Previously rejected requests
  stayed in the map and their retry timers could still fire.
- `400-412`: a rate-limit retry timer is tracked and does nothing after close.
- `758-880`: `sendRequest` accepts a signal, refuses a cancelled call, removes
  the pending request and clears its retry timer on abort, and removes its
  abort listener when the request settles. `loadModel` uses
  `ClientFactoryOptions.signal`, so an aborted connect rejects a model load
  that is still pending.

`foundations/core/packages/core/src/client.ts:294-303`

- If the model load fails, `createClient` closes the connection before
  rethrowing. A failed connect no longer leaves its websocket behind.

### API client plumbing

- `foundations/core/packages/client/src/index.ts:66-74`: `ClientFactoryOptions`
  gains `signal`.
- `foundations/core/packages/api-client/src/types.ts:216-223`: `ConnectOptions`
  gains `signal`.
- `foundations/core/packages/api-client/src/config.ts:25`: the server config
  fetch accepts the signal.
- `foundations/core/packages/api-client/src/utils.ts:28-90`:
  `getWorkspaceToken` checks the signal between the accounts calls so a
  cancelled connect starts no further account request.
- `foundations/core/packages/api-client/src/client.ts:60-113, 286-315`:
  `connect` and the markup methods pass the signal through.
- `foundations/core/packages/api-client/src/markup/types.ts` and
  `markup/client.ts`: `fetchMarkup`, `fetchMarkups` and `uploadMarkup` take and
  forward the optional signal.

The accounts client itself has no signal parameter. Its login and workspace
selection requests are bounded by that client's own retry window, and the card
names the harness lifecycle as a separate follow-up. This is recorded under
recommendations.

## Tests

New focused cancellation tests, each passing on the tip:

- `foundations/core/packages/collaborator-client/src/__tests__/cancellation.test.ts`:
  abort during the retry delay, abort of an in-flight read, a write that is not
  replayed after abort, an already-cancelled batch read, and signal forwarding.
- `foundations/core/packages/client-resources/src/__tests__/cancellation.test.ts`:
  close while `loadModel` is pending, close during a reconnect retry, close
  during a rate-limit retry, and abort of a pending model load. The tests count
  wire sends before and after close and assert the socket is closed, so they
  cover sockets and pending work as well as traffic.

Existing tests were updated only where the added optional argument changes a
call assertion (three calls in `api-client/src/__tests__/markup-client.test.ts`
and one in `api-client/src/__tests__/utils.test.ts`). No assertion was
weakened.

Final run, whole files, one at a time, on
`7c84af76da73864fb777aa74a2132e51e5e21323`:

| Test file | rc | Result |
| --- | ---: | --- |
| `foundations/core/packages/collaborator-client/src/__tests__/cancellation.test.ts` | 0 | 5 passed, 5 total |
| `foundations/core/packages/client-resources/src/__tests__/connection.test.ts` | 0 | 4 passed, 4 total |
| `foundations/core/packages/client-resources/src/__tests__/cancellation.test.ts` | 0 | 4 passed, 4 total |
| `foundations/core/packages/api-client/src/__tests__/markup-client.test.ts` | 0 | 14 passed, 14 total |
| `foundations/core/packages/api-client/src/__tests__/config.test.ts` | 0 | 5 passed, 5 total |
| `foundations/core/packages/api-client/src/__tests__/utils.test.ts` | 0 | 11 passed, 11 total |
| `foundations/core/packages/api-client/src/__tests__/markup-types.test.ts` | 0 | 14 passed, 14 total |
| `foundations/core/packages/client/src/__tests__/client.test.ts` | 0 | 13 passed, 13 total |
| `foundations/core/packages/core/src/__tests__/client.test.ts` | 0 | 2 passed, 2 total |

72 tests passed, 0 failed, `rc=0` for every file.

How they ran, in each package folder, with a fresh HOME and TMPDIR per file:

```
env -i HOME=<fresh> TMPDIR=<fresh> PATH=<node-22-bin>:$PATH \
  HARNESS_GUARDED_GIT=<guard value> \
  HULY_BOARD_CONFIG='{"url":"http://127.0.0.1:9","offline":true}' \
  VIKUNJA_BASE_URL=http://127.0.0.1:9 \
  node_modules/.bin/jest <file> --silent
```

Node used: `22.22.2`, inside the repository's required range
`>=20.0.0 <25.0.0`. The system Node 26 is outside the range and makes the
existing connection test fail on `sessionStorage` before any card assertion
runs, so it was not used.

### Gate runner

`gate/isolated_run.py` cannot run here: this checkout has no `gate/`, no
`lib/suite-runner.sh` and no `harness.toml`. The fork removed `harness.toml` in
`7a6e1daee` (owner, 19 Oct 2026) and jake-harness carries huly settings under
`[repos.huly-platform]`, which defines `worker_setup`, `typecheck` and
`full_suite` but no per-file test command. Restoring a deleted settings file
only to satisfy the runner would be outside this card, so the table above is
the direct jest output on the pushed tip.

`launch/no-project-names-test.py` and `checks/configured-values-test.py` are
jake-harness files and do not exist in this repository (`ls` reports both
missing), so they were not run against this tree.

Type checking was not run separately. The dependency packages in this worktree
have `lib/` but no generated `types/` for their dependencies, and
`rush build --to @hcengineering/api-client` needs a `rush install` state that
is absent. `rush` refuses Node 26 and the pinned Node 22 install has no working
npm. The changed files were compiled by ts-jest in the runs above, which caught
one real problem (a shadowed `model` identifier) that is fixed in the tip.

## Harness follow-up

The harness side does need its own change. On commit
`8deb9d1b2ac4edee3c5101e1766c4d71317a53f6`, `dev/board-load/vendor/huly-board.cjs`
lines 413-420 implement `bounded()` as a 30-second `Promise.race` that clears
only its own timer. It does not abort the `work()` promise, close the native
connection or cancel collaborator retries. It also calls `api.connect` at line
426 without a signal. The client support in this card only takes effect when
the harness passes an `AbortController` signal into `api.connect` and into the
markup calls, or closes the client on timeout. File that as a separate JH card
for the harness repository.

## RECOMMENDATIONS

1. Harness card: pass an `AbortSignal` through `bounded()` into `api.connect`
   and collaborator reads, and close retired connections on timeout. Without
   it, the observed 30-second orphan work remains.
2. Add signal support to `@hcengineering/account-client` login and workspace
   selection so a cancelled connect aborts those HTTP requests too. They are
   currently only bounded by that client's retry window.
3. Reconcile the huly per-card gate: either restore a supported `harness.toml`
   for `isolated_run.py` or add a `[repos.huly-platform]` per-file jest
   command. The current settings allow only the merge-lane full suite.
4. Record the `origin/main` merge/identity-guard conflict once for huly cards.
   Merging the upstream mirror always carries foreign-authored commits into
   `origin/jj/activity-feed..HEAD`, which the push guard refuses.

Review: not yet run.
