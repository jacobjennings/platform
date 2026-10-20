Merge.

Reviewed commit: f877ec6b56f939b2fbe314b342c09779acb3f77a
Applied-fix tip: ee63172b7ab34af99be5b18c39a230ebdc19443f

Source task: [JH-902454](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902454).
Range: 2a1d72f9e1acbc580dbb18eea1e79a6f4afbf4af..f877ec6b56f939b2fbe314b342c09779acb3f77a.

## Acceptance

The seven diagnostic events use the existing MeasureContext logger. The four configurable slow thresholds have the requested defaults. Rate limits, retry delays and response fields remain unchanged. Existing helper tests exercise each event. Database-backed acceptance remains unverified.

This is the Huly fork. Its settings name jj/activity-feed as the main branch. No harness launcher source changed. No frozen file changed. The dedicated harness worktree was refreshed to origin/main before the merge step.

## Findings fixed

The card requires, "Never log tokens, passwords or query parameter values."

- High. foundations/server/packages/postgres/src/diagnostics.ts:35 previously logged inline SQL values. storage.ts interpolates account identifiers and enum values into SQL. The smallest fix redacts inline literals and comments before normalization. Commit c403162ca45337deed3193a76ca95095e21b1983 applies it. The existing diagnostics.spec.ts passes, but does not cover every SQL quoting form.

The card requires, "log any statement" over the SQL threshold.

- Medium. foundations/server/packages/postgres/src/storage.ts:125 bypassed diagnostics for raw cursors. Slow cursor queries would remain invisible. Commit c403162ca45337deed3193a76ca95095e21b1983 times cursor database waits and counts rows. It excludes consumer processing time. The execute wrapper now also logs slow failed calls. Existing SQL diagnostics and conversion tests pass. Live cursor behavior was not checked.

The card requires "the number of requests waiting" and "queued (before execution starts) and execution."

- Medium. foundations/core/packages/client-resources/src/connection.ts:331 counted every outstanding request as waiting on rate limits. Commit c403162ca45337deed3193a76ca95095e21b1983 counts active retry waits instead.
- Medium. foundations/server/packages/server/src/sessionManager.ts:1666 counted pipeline initialization as execution. The same commit starts execution timing inside the ready pipeline callback. It also retains find class and query-key metadata for RPC requests.

The card requires a summary of sessions that "never completed a request."

- Medium. foundations/server/packages/server/src/diagnostics.ts:194 treated sessions with completed non-find requests as waiting. A failed find could also complete connect timing. Commit ee63172b7ab34af99be5b18c39a230ebdc19443f distinguishes successful responses from first find or load-model completion. Repeated hello resets both states. Server diagnostics and session-manager tests pass after the fix.
- Medium. foundations/server/packages/server/src/diagnostics.ts:122 discarded the true maximum after the sample cap. Commit c403162ca45337deed3193a76ca95095e21b1983 tracks maximum independently. P95 remains based on up to the first 20,000 samples per key per minute. The same commit disables the event-loop monitor at manager shutdown.

The guide rejects "unsafe or wrong behavior."

- Medium. foundations/core/packages/client-resources/src/connection.ts:140 failed under Node 26 because sessionStorage exists without window. The connection test produced "ReferenceError: window is not defined" in two cases. Commit 0a84f60aad98bc3db1483943f65ddde104bf0ee1 checks for window before browser session setup. The unchanged test then passed all four cases.

## Validation

Selection used `rg -n '(../client|../sessionManager|../connection|../storage|../diagnostics|../rateLimitWait)' foundations/server/packages/server/src/__tests__ foundations/server/packages/postgres/src/__tests__ foundations/core/packages/client-resources/src/__tests__`, plus test files added by the range and storage.test.ts importing the adapter through its index.

No test was added or edited. No full suite ran. No test ran on origin/main. Reruns followed reviewer implementation changes. Worker passes were not rerun solely to verify the worker.

The normal isolated file runner could not start tests. Each of diagnostics.test.ts, sessionManager.test.ts, rateLimitWait.test.ts, connection.test.ts, diagnostics.spec.ts, conversion.spec.ts and storage.test.ts recorded rc runner-fault with null counts. Each log says "suite-runner: gate.suite_jobs is required in harness.toml". Records are in the run evidence folder's gate-results.jsonl.

The required Rush install exited 1. Its error says Node v26.10.0 does not meet the repository range >=20.0.0 <25.0.0. The review then linked the worker's existing package dependencies locally and invoked package Jest through isolated_run.py --done. These temporary untracked dependency links explain dirty=true in those records. They are not source changes or reusable clean gate rows.

| Test file | Tested commit | Exit | Runner result |
| --- | --- | --- | --- |
| foundations/server/packages/server/src/__tests__/diagnostics.test.ts | ee63172b7ab34af99be5b18c39a230ebdc19443f | 0 | Tests: 12 passed, 12 total |
| foundations/server/packages/server/src/__tests__/sessionManager.test.ts | ee63172b7ab34af99be5b18c39a230ebdc19443f | 0 | Tests: 95 passed, 95 total |
| foundations/core/packages/client-resources/src/__tests__/rateLimitWait.test.ts | c403162ca45337deed3193a76ca95095e21b1983 | 0 | Tests: 2 passed, 2 total |
| foundations/core/packages/client-resources/src/__tests__/connection.test.ts | c403162ca45337deed3193a76ca95095e21b1983 | 1 | Tests: 2 failed, 2 passed, 4 total. ReferenceError: window is not defined |
| foundations/core/packages/client-resources/src/__tests__/connection.test.ts | 0a84f60aad98bc3db1483943f65ddde104bf0ee1 | 0 | Tests: 4 passed, 4 total |
| foundations/server/packages/postgres/src/__tests__/diagnostics.spec.ts | c403162ca45337deed3193a76ca95095e21b1983 | 0 | Tests: 4 passed, 4 total |
| foundations/server/packages/postgres/src/__tests__/conversion.spec.ts | c403162ca45337deed3193a76ca95095e21b1983 | 0 | Tests: 18 passed, 18 total |

Package typechecks used `/usr/bin/node node_modules/typescript/bin/tsc --noEmit --tsBuildInfoFile "$TMPDIR/package.tsbuildinfo"`. Server passed at ee63172b7ab34af99be5b18c39a230ebdc19443f. Client and postgres passed at 0a84f60aad98bc3db1483943f65ddde104bf0ee1. Each exited 0 with no diagnostics. Raw captures and direct-results.jsonl are under /home/jakej/.local/state/jake-harness/run-evidence/5cd340b316736df75e6380b3.

The context reader returned "selector line labels do not match source bytes" for the connection failure. The raw log was reopened directly. No reader output supplied a finding.

No worker gate row is reused. The worker report names ef3dac01c as its test commit but supplies no committed gate-results.jsonl. Its build and test claims are not independently certified by this review.

The prose checker exited 0. Its warnings were: "possible-jargon: Explain 'MeasureContext' in this sentence if it is a project term", "possible-jargon: Explain 'ReferenceError' in this sentence if it is a project term" twice, and "possible-jargon: Explain 'Full Rush' in this sentence if it is a project term". These name the logger, the literal runtime error and the build tool.

## Review binding and evidence

The local reviewed-task-ids.json names [JH-902454](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902454). The role-index row for this review names that same source task and the reviewmerge role. The implementation finished at 6:36 pm on 19 October. This review started at 9:18 pm that evening, after implementation finished.

The marked attachment comment lists report.md twice and no image captions. The local attachment receipt agrees. No worker PNG was available for visual inspection. The committed worker report was read. The attachment bytes were not downloaded. No screenshot was inferred from its text. This change has no user interface screen.

## Could not check

- storage.test.ts and integration.test.ts need a database and perform database administration. They were not executed against a real service. No service was launched or contacted.
- Full Rush build after the fixes could not run with the required system Node version. The package typechecks above passed using existing dependencies.
- The cursor timing addition has no dedicated existing unit test. No additional test was written under the brief's restriction.
- Actual log emission during a production incident and deployment were not checked.

## Merge record

Merge is pending execution of the approved script. This report was committed and pushed before that execution. No named merge test or done command is requested. Review checks above ran on the work branch.

## Critical caveats

Database-backed checks and deployment remain unverified. No live board write is authorized by this brief. The outcome command will use offline board configuration.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

Accept the diagnostics with the applied fixes. This run declares no follow-on and performs no deployment.

NOT MERGED
