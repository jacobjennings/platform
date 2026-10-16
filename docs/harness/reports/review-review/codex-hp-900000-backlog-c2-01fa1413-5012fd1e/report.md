Merge.

Reviewed commit: 5012fd1e81a4c96d69fb580fb62a5152ba0f7f5d

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/HP-900000

No models or migrations change. Existing workspaces need no data conversion.
This is the merge review of the prior Merge verdict. No behavior change was made.
The actual repository is the Huly fork, with target origin/jj/activity-feed.
The brief calls it jake-harness, but the shared Git directory and settings identify Huly.

## Assessment

Accepted by inspection. The workspace login result is already checked by getWorkspaceToken.
The new batch path preserves input order and checks workspace identity before opening each document.
Its connections disconnect in finally blocks. The single-item format conversion remains equivalent.
No launcher, ruling, LICENSE or existing licensing text changes. The new file uses the existing source header.
No board writer is added. No live server, browser, NVIDIA device or deployment is used.

The source task file and role index both name the same card. The prior implementation and review finished before this run.
The implementation report has no completed gate record, so this review does not call that run code complete.
No performance speedup has been measured. Batch RPC execution remains unchecked by the mocked markup test.

## Checks

Node first reported v22.23.3. The provisional report was committed and pushed before any test.
The pinned harness was refreshed to origin/main. The supplied main-branch review guide was used.
The project merge guide was read. The later brief rule forbids a full suite, so only targeted checks are selected.

Selection method: search importing tests for the changed markup modules, plus the named markup test.

```sh
rg -n 'getContents|getMarkups|fetchMarkups|markup/client|markup/types|createMarkupOperations' foundations/core/packages/api-client/src/__tests__ foundations/core/packages/collaborator-client server/collaborator --glob '*test*'
```

Exit 0. Hits include markup-client.test.ts:5 and markup-types.test.ts:5.
No changed or added test files occur in the reviewed range.
The two test files ran because no reusable gate row exists.
The merge script supplied isolated HOME, XDG folders and refused board URLs.
No implementation or test was edited. No test coverage was removed.

All final checks ran on the exact pushed merge commit:
`8cce4e86f7eb92ea3a56dfe65ccce011e248e34a`.
Its tree is `ae06597e3382b47ca52f34f515ba7d710c23ff0b`.
No conflict occurred. Main was still the branch base, so no intervening owner ruling could be lost.

| Command | Exit | Result |
| --- | --- | --- |
| `node --version` | 0 | v22.23.3 before any install |
| `node common/scripts/install-run-rush.js install` | 0 | Setup finished |
| `test -d common/temp/node_modules && echo DEPS_READY` | 0 | DEPS_READY |
| `node common/scripts/install-run-rush.js validate --to @hcengineering/api-client --to @hcengineering/collaborator` | 0 | 402 successful operations, two operations with no work |
| `cd foundations/core/packages/api-client && npx jest src/__tests__/markup-client.test.ts` | 0 | 14 passed, 14 total |
| `cd foundations/core/packages/api-client && npx jest src/__tests__/markup-types.test.ts` | 0 | 14 passed, 14 total |
| Pinned `checks/check-repository-size.py --base origin/jj/activity-feed --head HEAD` | 0 | 12 new blobs, 78,069 bytes, no oversized blobs |

The validation names api-client, collaborator-client and collaborator among its successful build and validate operations.
Each Jest log reports `Test Suites: 1 passed, 1 total` and `Tests: 14 passed, 14 total`.
These results check existing markup conversion and types. They do not test the new batch RPC.

## Setup correction

The first candidate was `453c203160d0d3caa0baffc85a5e2fdf756e70a3`.
Setup passed, but markup-client exited 1 with zero tests run:

> Cannot find module '@hcengineering/collaborator-client' from 'src/__tests__/markup-client.test.ts'

The types test passed 14 tests. Validation and the size check also passed.
The first merge tool call exited 1 and pushed nothing.
Validation generates the dependency build outputs needed by Jest.
The second call placed validation before Jest, correcting this setup error without a source change.
The two tests reran because they were mandatory done commands on the new merge candidate.
No run was made on the target branch to compare failures.

## Merge evidence

The only merge and main push came from the pinned `orchestrator/harness-reviewmerge.py`.
It used the source tip, this report, the implementation report, the card link and five ordered done commands from the table.
The tool exited 0. Its record says tested and pushed are both `8cce4e86f7eb92ea3a56dfe65ccce011e248e34a`.
A fresh `fetch origin jj/activity-feed` exited 0.
`merge-base --is-ancestor 5012fd1e81a4c96d69fb580fb62a5152ba0f7f5d origin/jj/activity-feed` exited 0.
The fetched target tip equals the tested and pushed commit.

The frozen-files record is:

```json
"frozen_files": {"paths": [], "differing_before_merge": [], "restored": [], "differing_after_merge": []}
```

The complete machine records and raw logs remain local at
`/home/jakej/.local/state/jake-harness/run-evidence/d58bcd3a613bef32a77bf3f9/ordered/`.
The first attempt records remain in its parent folder.
No applied product fix was needed.

## Other commands

The range log, diff, three-dot file list, diff check, status and source-task reads exited 0.
The pinned harness fetch and clean detached checkout exited 0.
The source-task JSON and role index agree on the card.
The implementation and prior review predate this review role record at 6:43 pm on 16 October 2026.
Exploratory reads of absent report paths and docs/launch.md exited 1 or 2.
The correct report paths were then read. The home-access existence check exited 1.
The initial broad documentation search was too large and was replaced by direct guide reads.
No conclusion relies on its truncated output.

## Could not check

- checks/home-access-test.py is absent from the pinned harness, so that named check cannot run.
- docs/launch.md is absent from the product worktree. The pinned harness README and launch guide were read.
- The prior review says no capture comment appeared in its supplied card snapshot. This run has no card snapshot or attached images and makes no live board request.
- No rendered workspace, batch RPC integration, database query plan or performance measurement was checked.
- The outcome command writes a board stage and sends a message. The explicit no-board-write and no-message scope prevents running it. Fresh Git ancestry will establish the merge instead.

## Prose checker

The pinned `python3 board/board_text.py <report>` exited 0 on both report versions.
The final check warnings were:

```text
paragraph 14: possible-jargon: Explain 'Each Jest' in this sentence if it is a project term.
paragraph 24: paragraph-length: This paragraph has 103 words. The warning limit is 90.
paragraph 26: paragraph-length: This paragraph has 100 words. The warning limit is 90.
paragraph 26: possible-jargon: Explain 'Fresh Git' in this sentence if it is a project term.
paragraph 29: possible-jargon: Explain 'Both Jest' in this sentence if it is a project term.
paragraph 31: possible-jargon: Explain 'Fresh Git' in this sentence if it is a project term.
```

The acceptance version also warned about paragraphs of 100 words and the phrases Both Jest and Fresh Git.
These are non-blocking wording notes.

## Failing after merge

- none

## Hygiene notes

- docs/harness/api-performance.md:3: The task reference is plain text rather than a full clickable task link.
- docs/harness/api-performance.md:65: The recorded measurement time uses UTC rather than the owner local clock.

## RECOMMENDATIONS

No follow-on is declared by this run. This verdict accepts the partial API improvement and makes no claim about measured speedup.

MERGED
