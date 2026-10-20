Merge.

Reviewed commit: 704bdf537992585d7c31507c3bb36434c045de1d

Source task: [JH-902544](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902544).

Applied-fix tip: c57f88113538be0125205424ab81e3f5d8a62799.

## Decision

The background scheduling change removes the awaited index build from createTables.
No blocking implementation defect was observed in the requested range.
The measurement does not establish the card's acceptance criteria.
I corrected both worker report copies to withdraw unsupported conclusions.
No implementation or test file changed during review.

Owner ruling, 11 October 2026, quoted in the supplied brief:

> After the review, it gets merged.

The supplied review and merge guide says, "No test or done command is required for a `Merge.` verdict."
This merge does not establish deployment acceptance.

## Critical caveats

The requested controlled application matrix remains unproven.
The host was shared and the measured generated index set had 190 statements.
The adapter attempted 195 statements, with the five differences unidentified.
The base arm was a primary-key-only snapshot, not a demonstrated run of base revision 13d7c1e74.
The measured clients were SQL sessions, not application clients.

The original project-read slowdown remains unattributed.
Unchanged query plans do not exclude cache, I/O, contention or application effects.
The report provides summarized plans without raw EXPLAIN ANALYZE captures.
The complete index list with bytes per index is absent.
The size table contains only eight named indexes in rounded MB.

The attach probe calls createTables without a full transactor attach.
Its second getDBClient call shares the existing pool for the URL.
The second argument is a database name, so it does not configure connect_timeout.
The probe therefore does not prove an independent connection or full transactor timeout acceptance.

## Findings and applied corrections

Blocking claim defect, corrected: docs/reports/jh-902544-backlog-c1/report.md:7.
The original result claimed the shipped index set did not slow reads.
The shared host and mismatched index set cannot establish that conclusion.
The smallest fix was to withdraw the conclusion and state the measurement limits.
The same correction appears in docs/harness/reports/jh-902544-backlog-c1/report.md.
The supplied guide enforces "Reject unsafe or wrong behavior and false claims about code or test results."

Blocking claim defect, corrected: docs/reports/jh-902544-backlog-c1/attach-probe.cjs:37.
The evidence narrative described an independent connection with a five second timeout.
The pool implementation in foundations/core/packages/postgres-base/src/index.ts:198 contradicts that interpretation.
The smallest fix was to correct the report rather than rerun or modify the historical probe.
Both corrections are in c57f88113538be0125205424ab81e3f5d8a62799.

## Evidence and checks

I read the requested commit log, the implementation diff, the changed evidence scripts and both report copies.
I inspected createTables callers and the pool reference lifecycle.
The report copies were identical before the correction.

The matrix has 252 rows and 84 arm, client and shape cells.
Every cell contains three repetitions.
Independent recomputation gives median sums of 183.093, 169.907 and 168.511 ms at one client.
At four clients the sums are 236.530, 232.235 and 253.666 ms.
At eight clients they are 436.442, 420.510 and 467.560 ms.
At sixteen clients they are 941.849, 945.162 and 1096.224 ms.
Each line orders the arms as base, full and reduced.
These agree with the rounded report table.
The generated SQL contains 190 CREATE INDEX statements.
These are arithmetic checks of saved evidence, not new performance measurements.

Selection method: report-only reviewer fixes require no implementation tests.
The import search was `rg -n 'createTables|scheduleDomainIndexes' foundations/server/packages/postgres/src/__tests__ foundations/server/packages/postgres/src --glob '*.ts'`.
No reviewer test ran and no test was added or extended.
No test or done command was named for the merge.
No worker result is claimed as reused by the merge runner.

Worker-reported results at 2fab665d550a759421b894324902527952479f9c:

| File under foundations/server/packages/postgres/src/__tests__/ | Exit | Passed | Failed |
| --- | ---: | ---: | ---: |
| utils.spec.ts | 0 | 82 | 0 |
| storage.test.ts | 0 | 8 | 0 |
| integration.test.ts | 0 | 93 | 0 |

The rows total 183 reported passes.
Raw runner result lines, tested tree and input lists are absent.
Those records are not independently verified passes or reusable gate evidence.
The reviewer did not rerun a reported passing worker gate.

The reviewed-task-ids.json entry and reviewmerge role-index row both name the source task.
The review role began at 4:09 pm America/Chicago after the worker's 4:06 pm evidence comment.
The source role-index entry identifies implementation.
No frozen file was changed in the requested range.
No project settings changed, so candidate settings loading is not applicable.
The dedicated harness worktree was refreshed to fresh origin/main before use.
The target repository's recorded main branch is jj/activity-feed.

The prose checker exited 0. It warned, "This paragraph has 110 words. The warning limit is 90."
The warning concerns the compact evidence table paragraph and is retained.

## Could not check

The exclusive-host application matrix, raw plan captures and complete byte inventory were not available.
The full transactor attach and independent connection were not demonstrated.
The embedded capture comment lists two report.md attachments and no PNG capture.
I did not contact the live board to retrieve attachments.
No browser, graphical application, deployment or GPU process was started.
No live Huly stack was contacted.
No new validation capture was made because the reviewer changed only prose.

## Merge record

The final verdict report is committed and pushed before the merge script runs.
Merge execution and fresh ancestry confirmation are pending.
The outcome step remains required.

## Failing after merge

- none

## Hygiene notes

- docs/reports/jh-902544-backlog-c1/report.md:44: The preserved historical narrative contains bare task identifiers and long sentences.
- docs/harness/reports/jh-902544-backlog-c1/report.md:44: The duplicate historical narrative retains the same writing issues.

## RECOMMENDATIONS

Keep the distinction between merged code and unproven deployment acceptance explicit.
This run assigns no follow-on and authorizes no deployment.

NOT MERGED
