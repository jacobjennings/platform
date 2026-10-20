Merge.

Reviewed commit: abe6f38649dc8cc9488697a12618e5913dc98b0a

Source task: [JH-902460](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902460).
Applied-fix tip: 6b76543b18e8fa0174dbdbac792140f496caf6bb.
Merge target: origin/jj/activity-feed in jacobjennings/platform.

The bounded lease change is accepted with the reviewer fixes below. No design decision remains. No launcher source or frozen file changed. No deployment was performed.

## Findings fixed

The review rule is “Reject unsafe or wrong behavior and false claims about code or test results.” The enforcing implementation is ConnectionInfo.withReserve in foundations/core/packages/postgres-base/src/index.ts.

- High severity, foundations/core/packages/postgres-base/src/index.ts:345. Concurrent writes on one managed context could finish with two reservations. Each assigned its lease to the same idle field. The second assignment lost the first lease. The fix caches only when the idle field is empty and releases the other lease.
- High severity, foundations/core/packages/postgres-base/src/index.ts:559. Closing a manager during a transaction removed the context without marking it released. The transaction could subsequently cache its lease outside the manager map. The fix marks the context released before dropping its idle lease.
- Medium severity, foundations/core/packages/postgres-base/src/index.ts:329. Reusing an idle lease omitted the active counter increment. Statistics could report no active leases during a transaction. The fix counts every acquired lease, including reuse, and balances that increment in finally.

All three fixes are in 6b76543b18e8fa0174dbdbac792140f496caf6bb. The existing tests exercise reservation limits, late reservation release, context cancellation and adapter conversion. They do not directly assert the newly found concurrent completion or close scenarios. No tests were added or extended, as instructed.

## Validation

Selection used the requested range and the three-dot diff against origin/jj/activity-feed. Import search: `rg -n 'ConnectionMgr|postgres-base|../index' foundations/core/packages/postgres-base/src/__tests__ foundations/server/packages/postgres/src/__tests__`.

Both selected files ran through gate/isolated_run.py with fresh HOME, TMPDIR and XDG directories, the Git guard and refused board URLs. The reason for both reruns was reviewer-change:reservation-bookkeeping. No full suite ran.

Tested commit: 6b76543b18e8fa0174dbdbac792140f496caf6bb.
Tested tree: 280c16bf2a8a2e6553bee3acc749f4cd06a70a79.

| Test file | Exit status | Result |
|---|---|---|
| foundations/core/packages/postgres-base/src/__tests__/connection.test.ts | 0 | Tests: 6 passed, 6 total. Test Suites: 1 passed, 1 total. |
| foundations/server/packages/postgres/src/__tests__/conversion.spec.ts | 0 | Tests: 18 passed, 18 total. Test Suites: 1 passed, 1 total. |

Each raw capture ends with its matching `Ran all test suites matching` line. The gate records have null parsed counts for Jest. Counts above come from the saved raw captures, not those null fields.

The worker records report both files passing at aa60142a4ae445b76fbd9cdce3a557273681320a, tree 3ff8b87f9bc3ecc1c981648c108bc1abca4575de. Those results were not reused because the reviewer changed their implementation input.

The first dependency installation exited 1 because /usr/bin/node is version 26 and Rush accepts versions 20 through 24. Retrying with RUSH_ALLOW_UNSUPPORTED_NODEJS=1 succeeded with exit 0. The required /usr/bin/node executable was retained. The targeted build command `RUSH_ALLOW_UNSUPPORTED_NODEJS=1 /usr/bin/node common/scripts/install-run-rush.js build --to @hcengineering/postgres` exited 0.

The context reader returned “selector did not return strict JSON” for the large install log. Direct inspection of the raw capture confirmed “Rush install finished successfully.” The report folder retains the raw installation, build and test captures.

The uncommitted local harness.toml supplies only the two Jest runners and gate settings. It is ignored and is not part of the merge. No committed settings file changed.

The prose checker exited 0. Its advisory warnings were “possible-jargon: Explain 'ConnectionInfo'”, “paragraph-length: This paragraph has 115 words. The warning limit is 90.” and “possible-jargon: Explain 'Test Suites'”. The same two possible-jargon warnings also appeared in the paragraph quoting these warnings. These refer to implementation and runner names retained for traceability.

## Evidence and identity

The run's reviewed-task-ids.json lists the source card. The role-index entry assigns the same card to this reviewmerge run. Implementation finished at 7:53 pm on October 19, America/Chicago. Review started at 8:54 pm, after implementation finished.

The marked card comment “Validation captures from run” names the worker report at the reviewed commit. It attaches report.md without a caption. It lists no PNG captures. This is a backend change and the reviewer fixes do not change a screen.

## Could not check

The local sixteen-user acceptance matrix was not run. No local server and load rig were prepared for this review. Shared-account bursts, separate-account bursts, SQL activity, blocked model loads and health reads during presence triggers remain unverified. The focused fixture tests do not establish production stall resolution.

## Critical caveats

None.

## Merge record

The report and reviewer fixes were pushed in 88f7a98fa4f1a2b5f6867af4df7d1a56500a1b71 before the merge. The required script pushed merge commit 45533155e932bed30bcc996413362b12e2df3cac to jj/activity-feed. Its fresh base was 73fa1a91ecc22140aabefffe180b5ddaca1aee4f. No conflict required resolution.

Both named tests reused the reviewer results from commit 6b76543b18e8fa0174dbdbac792140f496caf6bb and tree 280c16bf2a8a2e6553bee3acc749f4cd06a70a79. Each decision reason is “the merge is clean, so the worker result stands”. No test ran on origin/main or origin/jj/activity-feed.

The frozen_files record is quoted below. No restoration commit was needed.

```json
"frozen_files": {"paths": ["orchestrator/merge-train.py", "orchestrator/train-queue.py"], "differing_before_merge": [], "restored": [], "differing_after_merge": []}
```

Fresh fetch and merge-base --is-ancestor checks returned 0 for the original reviewed tip and the applied-fix tip against origin/jj/activity-feed. The script record has no failing_after_merge or failing_checks entries.

Two invocations using the full card URL refused before any write with “card repo lookup failed:”. Using the supported card identifier succeeded. Temporary checkout links supplied the configured tilde paths under the throwaway HOME. No configured repository or merge destination was changed.

The outcome step verified ancestry and set the card to stage:merged. A separate read-back confirmed stage:merged. It then exited 1 because the Orchestrator socket was absent. Its exact notification was “merged JH-902460”. Delivery was not confirmed. The error was “cannot send to session 'JakeHarnessOrchestrator' at /run/user/1000/cc-socks/43843.sock: [Errno 2] No such file or directory”. No alternative session was contacted.

The script emitted no gate-results.jsonl because both named tests were reused. reviewer-gate-results.jsonl and the copied raw test captures hold the results. reviewmerge.json records both reuse decisions. The final script records and updated report are committed only on the review branch.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

No follow-on is declared. Do not treat the production stall as measured resolved without the local acceptance evidence described above.

MERGED
