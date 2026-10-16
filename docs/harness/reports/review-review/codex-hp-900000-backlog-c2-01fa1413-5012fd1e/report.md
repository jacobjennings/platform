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
Both Jest files will run on the merge candidate because no reusable gate row exists.
Targeted validation and the repository size check will run there too.
The merge script supplies isolated HOME, XDG folders and refused board URLs.
The report will be updated with exact results and ancestry after the script finishes.

## Could not check

- checks/home-access-test.py is absent from the pinned harness, so that named check cannot run.
- docs/launch.md is absent from the product worktree. The pinned harness README and launch guide were read.
- The prior review says no capture comment appeared in its supplied card snapshot. This run has no card snapshot or attached images and makes no live board request.
- No rendered workspace, batch RPC integration, database query plan or performance measurement was checked.
- The outcome command writes a board stage and sends a message. The explicit no-board-write and no-message scope prevents running it. Fresh Git ancestry will establish the merge instead.

## Failing after merge

- none

## Hygiene notes

- docs/harness/api-performance.md:3: The task reference is plain text rather than a full clickable task link.
- docs/harness/api-performance.md:65: The recorded measurement time uses UTC rather than the owner local clock.

## RECOMMENDATIONS

No follow-on is declared by this run. This verdict accepts the partial API improvement and makes no claim about measured speedup.

NOT MERGED
