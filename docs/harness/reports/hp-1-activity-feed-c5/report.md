# HP-1 Activity feed report

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/HP-1
Branch: codex/hp-1-activity-feed-c5
Base: e2dc43e23d58568fd34b8b844bf4857e8c30ee04
Code tip for the final test run: 5e7ae1323

## Status

The feed code is written, type checked, and unit tested. It is not yet run in a browser.
The local dev build and the screenshots of the all-projects and one-project views are not done.
See "Not done" below.

## What was built

A new navigator app called Activity sits next to Inbox in the app bar. It is built from the Inbox layout.

- Left side: a list with one card per document. Each card shows the document title, its newest activity, and an unread count.
- Right side: the document's own panel, opened the same way the Inbox opens it.
- Project picker: All, or one project. The choice is remembered per user in the browser.
- Unreads toggle: the same toggle the Inbox has. It shows only documents with unread activity.
- Mark all read: sets one read mark for the whole feed.
- Opening a card marks that document read.
- Paging: the feed loads 200 messages. "Show more" loads 200 more.
- Data source: `activity:class:ActivityMessage` across every space the server lets the user read. No notification contexts are used. The Inbox is unchanged.

## Files

New files:

- `plugins/notification-resources/src/components/feed/feed-query.ts`: pure helpers for the query, grouping, read state, project choice, and paging.
- `plugins/notification-resources/src/components/feed/feed-query.test.ts`: unit tests for those helpers.
- `plugins/notification-resources/src/components/feed/ActivityFeed.svelte`: the navigator and the right panel.
- `plugins/notification-resources/src/components/feed/ActivityFeedGroupedListView.svelte`: the grouped list, with keyboard navigation.
- `plugins/notification-resources/src/components/feed/ActivityFeedCard.svelte`: one card per document.
- `docs/harness/reports/hp-1-activity-feed-c5/report.md`: this report.

Upstream files touched (each change is additive):

- `plugins/notification-resources/src/index.ts`: one import and one `component.ActivityFeed` entry.
- `plugins/notification-resources/package.json`: adds the `@hcengineering/task` dependency, for the project class.
- `common/config/rush/pnpm-lock.yaml`: written by `rush update` for the new dependency. The diff is 5 lines.
- `plugins/notification/src/index.ts`: adds `ActivityFeed` to the `component` IDs.
- `models/notification/src/plugin.ts`: adds `ActivityFeed` to the `app` IDs.
- `models/notification/src/index.ts`: adds one `workbench.class.Application` doc for the feed.

`Inbox.svelte` and `InboxGroupedListView.svelte` are not changed. The feed copies their layout and styles into the new files.

Diff against the base: 11 files, 996 insertions, 2 deletions.

## Model change

This is a model change under `models/`. It needs a card and a named owner step.

- It creates one new `workbench.class.Application` document in the model space.
- Its alias is `activity-feed`. Its label is `activity.string.Activity`. Its icon is `activity.icon.Activity`. It is not hidden. Its order is 51.
- No existing data changes. No migration is needed.
- An existing workspace gets the new app only after the model is upgraded on huly.lan. That is an owner step after merge.
- The app has no `accessLevel` set. Guest accounts may see it. The server still limits which activity each account can read.

## Read state

- Stored in the browser's `localStorage`, keyed by account UUID.
- It holds one global mark and one mark per document.
- It is separate from Inbox notifications. The Inbox read state is not touched.
- It is not shared between browsers or devices.
- A server-side per-user state would need a new model class. That is an owner decision, listed in RECOMMENDATIONS.

## Checks run

Dependencies:

- `cd /home/jakej/gh/huly-platform-worktrees/hp-1-activity-feed-c5 && node common/scripts/install-run-rush.js install`: finished with exit 0.
- `test -d common/temp/node_modules && echo DEPS_READY` printed: `DEPS_READY`.
- The first install attempt stopped because the only Node on this machine is v26.10.0. `rush.json` allows `>=20.0.0 <25.0.0`. Rush's own override, `RUSH_ALLOW_UNSUPPORTED_NODEJS=1`, was set for the install, the update, the builds, the validates, and the tests. The Node version is a risk for the tests. See RECOMMENDATIONS.
- `rush update` was run once to link `@hcengineering/task`. It exited 0.

Validate, which also builds type declarations for the dependencies:

- `validate --to @hcengineering/notification-resources`: exit 0. Both `@hcengineering/activity-resources (validate)` and `@hcengineering/notification-resources (validate)` completed successfully.
- `validate --to @hcengineering/model-notification`: exit 0. `@hcengineering/model-notification (validate)` completed successfully.

Targeted tests. The search used to find them was `rg -ln "feed-query|components/feed" plugins models --glob '*.ts' --glob '*.svelte'`. The only test file for the changed code is `feed-query.test.ts`.

| Check | Command | Result |
|---|---|---|
| `feed-query.test.ts` on the code tip 5e7ae1323 | `cd plugins/notification-resources && npx jest src/components/feed/feed-query.test.ts` | Passed. 16 of 16 tests, 1 suite. |
| svelte-check on the code tip 5e7ae1323 | `cd plugins/notification-resources && npm run svelte-check` | Exit 0. No diagnostics printed. |

Earlier runs on the way to the tip:

- svelte-check, first run: failed with "Cannot find module" errors. The dependency type declarations were not built yet. The validate step fixed it.
- svelte-check, second run: one error, `Cyclical dependency detected: selectedProject → projectChoice → selectedProject`, in `ActivityFeed.svelte`. Fixed in commit 5e7ae1323.
- jest on commit 7affdca46, before the components were written: 16 of 16 passed. The helper code has not changed since, so the final run repeats that result on the final tip.

Test scope: the 16 tests cover the query, paging, grouping, unread counts, read marks, the stored read state, and the project choice. They do not render the Svelte components. Those are checked only by svelte-check.

## Not done

- Required gate and checks: the brief names a gate results file at `$HARNESS_RUN_EVIDENCE/gate-results.jsonl`. `HARNESS_RUN_EVIDENCE` is not set in this worker environment, so no gate results file exists. The checks named in the brief (configured-values, env-values evidence scan, home-access, no-project-names) were not run. I did not find their commands in the worker guide or in the worktree. The Director or the merge lane needs to run them.
- Full test suite: not run, as the guide requires.
- Local dev build against a fixture workspace: not done. Rendering the feed needs the local Huly stack (MongoDB, Elasticsearch, MinIO, and the services). That was not started in this run.
- Screenshots of the all-projects and one-project views: not taken, for the same reason. A browser check must use a hardware adapter that is not the NVIDIA GPU. The adapter must be named in the report.
- Browser behavior is not checked. The Svelte components have not been run in a browser.
- Live server: no check against huly.lan. Server-side access limits are assumed from the Huly design and not verified here.

## Known gaps in v1

- No URL sync. Selecting a card does not change the URL. A reload clears the selection.
- "Show more" re-queries with a larger message limit. It is not a cursor, so the query gets slower as the limit grows.
- A card shows only the messages inside the loaded window.
- Chat messages are included, because `ChatMessage` extends `ActivityMessage`. Direct messages and channel messages appear in the feed.
- The picker's "All" option reuses `notification.string.All`, which reads "All". A dedicated "All projects" string would need a translation entry.
- Projects come from `task.class.Project`. That is the generic project class, so it covers every project type, not only tracker projects.

## RECOMMENDATIONS

1. Director: confirm the Node version policy for workers. This machine has only Node 26. The repo allows Node 20 to 24. The override was used, so the test results on Node 26 are less certain than they would be on Node 22 or 24.
2. Director or merge lane: run the named checks (configured-values, env-values evidence scan, home-access, no-project-names) and produce the gate results file. This run did not produce one.
3. Next worker: build a fixture workspace locally, render the feed in a browser on a non-NVIDIA GPU, and take the two screenshots the card asks for. Name the adapter in that report.
4. Owner decision: keep read state in the browser, or add a model class for per-user server-side read state. The server-side option changes the model and needs its own card.
5. Owner decision: set `accessLevel` on the new app if guests should not see it.
6. Owner step after merge: upgrade the model on huly.lan so the new app appears. Then check the app bar and the Inbox on a test account.
7. Consider a URL route for the feed, so a selected document survives a reload.
8. Consider a dedicated "All projects" string, with translations.
