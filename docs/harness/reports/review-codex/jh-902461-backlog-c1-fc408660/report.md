Merge.

Reviewed commit: fc4086604bf515ec61a37d2563eedded565e1019
Applied-fix tip: b417f334bdb98bc2855b9d1d036024a8a606d6a5
Source task: [JH-902461](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902461).

## Acceptance

The reviewed range is 7a6e1dae..fc4086604bf515ec61a37d2563eedded565e1019. The change forwards optional cancellation signals through markup fetches and connection creation. It cancels collaborator retry delays and closes connections after model loading fails. Existing callers may omit the signal.

The supplied settings resolve this worktree to huly-platform and jj/activity-feed through lib/repo_routing.py. No harness launcher source changes in this range. Neither frozen file changes. The branch does not change settings. The existing deletion of harness.toml stays in place.

## Applied findings

- High severity, foundations/core/packages/client-resources/src/connection.ts:798. Aborting while waitOpenConnection is pending rejected a separate RequestPromise before any consumer awaited it. This could produce an unhandled rejection. The fix rejects that promise only after it enters the pending request map. The owning connection still rejects its open wait on closure.
- Medium severity, foundations/core/packages/client-resources/src/connection.ts:824. A reconnect callback could finish awaiting its retry decision after closure or request completion. Its sendData callback lacked a final state check. The fix checks closure, cancellation and request identity immediately before sending.

These findings enforce the ReviewMerge guide rule, "Reject unsafe or wrong behavior and false claims about code or test results." The enforcing implementation is connection.ts. Existing cancellation.test.ts exercises connection closure and retry cancellation. No test was added or extended.

## Validation

Selection method: select existing tests importing the reviewer-modified connection module. Search command: `rg -n "from ['\"].*connection|require\\(['\"].*connection" foundations/core/packages/client-resources -g '*test*'`.

The reviewer committed the fixes before attempting the selected checks on b417f334bdb98bc2855b9d1d036024a8a606d6a5. The isolated runner exited 3 with `isolated-run: checkout lacks harness.toml`.

| Selected file | Per-file result |
| --- | --- |
| foundations/core/packages/client-resources/src/__tests__/connection.test.ts | Not started. No test count or per-file exit status. |
| foundations/core/packages/client-resources/src/__tests__/cancellation.test.ts | Not started. No test count or per-file exit status. |

The required `/usr/bin/node common/scripts/install-run-rush.js install` exited 1. Its error was `Your dev environment is running Node.js version v26.10.0 which does not meet the requirements for building this repository.` The declared range is `>=20.0.0 <25.0.0`.

No worker passing result was rerun for verification. The worker report names code commit 7c84af76da73864fb777aa74a2132e51e5e21323. Its reported test results are not independently verified or claimed as reviewer passes. No reusable gate record was supplied.

The reviewed-task-ids.json and launcher role-index entry both name this source card. The implementation finished at 7:57 pm on October 19. This review started at 8:54 pm on October 19, America/Chicago.

The prose checker exited 0 and printed two warnings: `paragraph 7: possible-jargon: Explain 'RequestPromise' in this sentence if it is a project term.` and `paragraph 8: possible-jargon: Explain 'ReviewMerge' in this sentence if it is a project term.`

## Could not check

The targeted tests could not start for the reasons above. Worker raw test captures and their counts were not independently verified. The local capture attachment receipt lists only report.md, with no PNG. The marked board comment was not independently read. No user interface changes require a new screenshot.

## Critical caveats

The existing harness caller must pass the new signal before it receives cancellation benefits. The worker report describes that separate integration work without a follow-up card. This run declares no follow-on. Account service requests remain bounded by their own retry window and do not support aborting an in-flight request here.

## Merge outcome

The report was committed and pushed before the merge attempt. The required merge script exited 2 with `harness-reviewmerge: refused before any write: card repo lookup failed:`. The mandatory outcome step exited 2 with the same error. Neither step changed the board. No reviewmerge.json or gate-results.jsonl was produced. The raw install, targeted check, merge and outcome logs are saved locally beside this report. They are ignored by Git.

A separate explicit fetch of refs/heads/jj/activity-feed confirmed that the reviewed commit is not an ancestor of that target. The ancestry check exited 1. The merge did not happen. The Director needs to repair the card repository lookup used by the required merge path. This approval does not claim successful validation.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

Track the separate harness integration described in the worker report through the Director. Restore supported targeted test routing outside this card without restoring the deleted project settings file.

NOT MERGED
