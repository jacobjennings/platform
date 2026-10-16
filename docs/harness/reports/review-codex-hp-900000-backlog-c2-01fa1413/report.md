Merge.

Reviewed commit: 01fa1413dd383340798cbeefeb963b5ba1f2d417

Reviewed branch: `codex/hp-900000-backlog-c2`.
Range: `befa4c42284bcc528509dc40a65c136be57231a9..01fa1413dd383340798cbeefeb963b5ba1f2d417`.
Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/HP-900000

This is a verdict-only review under the supplied main-branch review guide. No merge was performed. Implementation finished before this review started. No models or migrations change, so existing workspaces need no data conversion. No launcher files, owner rulings, LICENSE files or existing license wording change. The new source file uses the existing source header.

## Assessment

The additive batch API removes separate collaborator requests and workspace lookups for each description. It preserves input order at the client and uses the existing document transformer. Each batch item is checked against the authenticated workspace before opening its connection. Opened connections disconnect in a finally block. The existing single-document operation retains its conversion behavior.

The connection change safely reuses the workspace login result. `getWorkspaceToken` already calls `selectWorkspace`, rejects a missing workspace, and returns the login information consumed by `connect`.

Comments and attachment metadata can use the existing `findAll` path with `attachedTo: { $in: ids }`. The documentation gives the harness migration calls. No new model cache or database index was implemented. The documentation explains those omissions. This is a partial performance improvement, with no measured speedup established.

No blocking defect found by inspection. No board label or stage writer is added. No live server was contacted.

## Suggestions

- Suggestion, `server/collaborator/src/rpc/methods/getContents.ts:36`. All requested documents load concurrently. A caller following the unrestricted API with thousands of items can create thousands of simultaneous document loads. The HTTP body limit bounds bytes, not concurrent work. Add an item limit and a small concurrency pool in a follow-up. The recommended page size of 50 is caller guidance only. Resource exhaustion was not reproduced in this review.
- Suggestion, `docs/harness/api-performance.md:165`. Acceptance asks for a measured or estimated model-load cost. The report supplies neither and explains why the whole-call timing cannot isolate it. Measure that component on an authorized fixture before using this card as evidence that connection performance is solved.
- Suggestion, `docs/harness/reports/hp-900000-backlog-c2/report.md:1`. The worker report says the gate was not run and says the importing markup-types test was omitted. Do not describe this worker run as code complete. Preserve those gaps in the follow-up validation.

## Tests and evidence

Selection method: compare the eight three-dot changed files, then search test files for imports or execution of the changed modules.

Search run:

```sh
rg -n 'getContents|getMarkups|fetchMarkups|markup/client|markup/types|createMarkupOperations|connect\(' foundations/core/packages/api-client/src/__tests__ foundations/core/packages/collaborator-client server/collaborator --glob '*test*'
```

Exit 0. Relevant hits are the imports in `markup-client.test.ts:5` and `markup-types.test.ts:5`. No added or changed test-named files occur in the diff. No test was run in this verdict-only review, and no implementation was changed.

Worker evidence read from `docs/harness/reports/hp-900000-backlog-c2/report.md`:

| Target | Recorded result | Review limit |
| --- | --- | --- |
| `foundations/core/packages/api-client/src/__tests__/markup-client.test.ts` | Reported pass, 14 of 14 at `36a02253a` | Not rerun. Mocks collaborator and does not exercise batch RPC |
| `foundations/core/packages/api-client/src/__tests__/markup-types.test.ts` | Not run | Importing test omitted by worker |
| Targeted validate for api-client and collaborator | Reported exit 0 | Type checks only |
| Worker gate | Not run | No committed gate result available |

These are reported results, not independently verified raw logs. A worker exit status does not establish a completed gate. No home-access test was required because this review ran no tests.

## Commands

- First command, `gh auth status`: exit 1. Active GH_TOKEN account authenticated successfully. An inactive default credential was invalid. No credential value is recorded here.
- `cat docs/review-guide.md`: exit 1, file absent. Used the supplied authoritative main-branch guide as instructed.
- `git -C <worktree> status --short`: exit 0, clean before report creation.
- `git -C <worktree> diff --stat <base>..<tip>` and `diff <base>..<tip> -- foundations server`: exit 0.
- `git -C <worktree> diff --name-only origin/jj/activity-feed...HEAD`: exit 0, eight files matching the review range.
- `git -C <worktree> diff --check <base>..<tip>`: exit 0.
- `git -C <worktree> log -1 --format='%H %cI %s'`: exit 0, implementation tip recorded at 6:22 pm on 16 October 2026, America/Chicago.
- Targeted `cat`, `sed`, `nl`, `rg`, `head` and `ls` inspected instructions, changed files, RPC routing, workspace tokens, storage loading and model persistence. Successful reads exited 0. Exploratory lookups for nonexistent `storage.ts`, `rpc/routes.ts` and an uppercase ReviewMerge guide failed with exits 1 or 2. Existing files were then located and read. No checks depend on those failed lookups.
- Pinned prose checker command and result are recorded below.

## Could not check

- No validation-capture comment appears in the supplied card snapshot, so no worker captures were attached in that snapshot. No captions were treated as visual proof and no new captures were made.
- Batch RPC execution, rendering and performance were not checked. This change adds no UI.
- No seeded local workspace or database query plan was checked. Index suitability remains unverified.
- No raw worker validation logs or finished gate record were available in the committed evidence reviewed.
- The card was assessed from the supplied snapshot. No live board request was made.

## Prose checker

`python3 /home/jakej/gh/jake-harness-worktrees/huly-platform-pin-d765b05/board/board_text.py <report>` exited 0. Warnings from the first run:

> paragraph 11: paragraph-length: This paragraph has 142 words. The warning limit is 90.

> paragraph 20: paragraph-length: This paragraph has 123 words. The warning limit is 90.

> paragraph 20: sentence-length: This sentence has 56 words. The warning limit is 45.

> paragraph 20: possible-jargon: Explain 'ReviewMerge' in this sentence if it is a project term.

The last warning refers to an unsuccessful filename search for the harness review guide. These are non-blocking prose notes.

## RECOMMENDATIONS

Use the batch API in pages of 50 when the separate harness client change is implemented. Keep model caching and database query-plan work explicit as unfinished follow-ups. Validate batch behavior and measure the model-load component on a local fixture before claiming a speedup. Deployment and live-server measurements remain post-merge Director work.
