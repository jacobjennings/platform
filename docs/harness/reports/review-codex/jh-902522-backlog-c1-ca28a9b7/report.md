Merge.

Reviewed commit: ca28a9b7793eacbce8e8b89c922faf9a44392108
Applied-fix tip: d5b670ce965f486b9222e38c5bd91295b5e8730e

Source task: [JH-902522](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902522).
Source branch: `codex/jh-902522-backlog-c1`.
Reviewed range: `c45f7774..ca28a9b7793eacbce8e8b89c922faf9a44392108`.

The change is accepted with the reviewer fixes. It adds a bounded live continuation
read through the existing permission pipeline. It adds no model migration and
changes no harness launcher. The saved source brief permits either a consistent
snapshot or a continuation token. The API documents that its version is a start
timestamp and does not pin database contents. Callers must reconcile change hints
and inspect every page for partial results.

The provisional report was committed and pushed as `f18ce1603548e7c7d9959d24396cca79059643db`.
The implementation finished at 12:40 pm CDT. This review started at 12:47 pm CDT.
The implementation completion marker, launcher role index and this run's
`reviewed-task-ids.json` agree on the source card. The source card is also the
review card. No follow-on is declared.

## Findings fixed

All findings below were blocking defects before the applied-fix commit. The rule
is “Reject unsafe or wrong behavior and false claims about code or test results.”
The enforcing rules are in section 1 of the supplied merge review guide.


- `foundations/core/packages/core/src/snapshot.ts:17`: The new type imported `DocumentQuery` from a module that does not export it. Targeted validation failed with TS2459. The fix imports it from `storage`. The string identity cursor also needed an explicit storage-query type conversion. Final targeted validation passes.

- `foundations/server/packages/server/src/client.ts:147`: Continuation replaced an exact identity constraint with a range. A second page could return unrelated rows. The fix preserves the original identity constraint and the stricter lower bound.

- `foundations/server/packages/server/src/client.ts:415`: Non-finite or non-numeric limits could bypass the promised page bound. The fix refuses them before normalization.

- `foundations/server/packages/server/src/client.ts:425`: Tokens checked section names but allowed the class or filter to change. The fix binds normalized sections to the token. It also validates cursor values and uses maps without inherited property names.

- `foundations/server/packages/server/src/client.ts:448`: Failed first-page-only sections were skipped on retry. A final failed section could also return no continuation. The fix retries failed reads and skips a first-page-only section only after its successful read.

- `foundations/server/packages/server/src/client.ts:472`: Reference sections and change sets silently truncated at their caps. The fix reports partial data at those bounds and caps the combined change hints per section.

- `foundations/server/packages/server/src/client.ts:495`: The old change query reapplied the original filter, so rows that left it were never reported. Removal lookup used `createdOn` and transaction `space`, although removal transactions carry `modifiedOn` and `objectSpace`. The fix reads changed rows without the original filter and rechecks transaction identities through the permission pipeline. It includes subclasses and rows moved out of the original space.

- `dev/board-load/worker.cjs:140`: The benchmark counted change hints without applying them. It now reconciles identities, refuses partial reads and rejects duplicate identities.

- `dev/board-load/driver.cjs:95`: A failed concurrent mover only printed an error. The benchmark now propagates that failure.

- `docs/harness/reports/jh-902522-backlog-c1/report.md:3`: The report claimed a pinned database snapshot and wire payload measurements that the code did not provide. A review correction supersedes those claims. The short report points to the correction. Historical measurements predate these fixes and establish no current performance target.

## Validation

Selection used the branch's three-dot changed-file list and direct import searches.
Commands included `git diff --name-only origin/jj/activity-feed...HEAD` and
`rg -n 'ClientSession|snapshot|../client|../snapshot' foundations/server/packages/server/src/__tests__ foundations/core/packages/core/src/__tests__ --glob '*test*'`.
A bounded search of test-named files under `dev/board-load` found no matching tests.
No test file was added or extended. Changed source was read directly because exact
code inspection and reviewer edits require it.

Final checks ran through `gate/isolated_run.py --reason reviewer-change:committed-snapshot-corrections`
on clean commit `d5b670ce965f486b9222e38c5bd91295b5e8730e`, tree
`99df5b93af29e65c3cab657067815602bb968b37`. Each had fresh HOME, TMPDIR and XDG
folders, guarded Git and refused board URLs. Dependency installation succeeded.

| File or command | Exit | Runner result |
| --- | ---: | --- |
| `node common/scripts/install-run-rush.js validate --to @hcengineering/server` | 0 | Server build and validation succeeded. Dependency operations were reused by Rush. |
| `foundations/server/packages/server/src/__tests__/sessionManager.test.ts` | 0 | Test Suites: 1 passed, 1 total. Tests: 95 passed, 95 total. |
| `foundations/server/packages/server/src/__tests__/diagnostics.test.ts` | 0 | Test Suites: 1 passed, 1 total. Tests: 12 passed, 12 total. |
| `node --check dev/board-load/worker.cjs` and `node --check dev/board-load/driver.cjs` | 0 | Both parsed. |
| `bash -n dev/board-load/run.sh` | 0 | Shell syntax passed. |

Raw captures are in `checks/`. The local context reader selected validation result
lines 122 and 125 to 126, which were reopened in the raw log. It was busy for the
session-manager capture, so its raw result lines were read directly.
The server tests mock the session implementation. Their 107 passing tests protect existing
callers but do not establish runtime coverage of snapshot reconciliation.

Earlier validation failures were fixed. They included TS2459 for the original
import and TS2322 or TS2352 for query typing during the review. The final clean
check supersedes those attempts. No full suite or test on the main branch ran.

The worker records claim 2 passing core client tests, 4 passing connection tests
and 14 passing markup client tests on `2c20cae52110a4ff3953a492b5d67d08cbbd973d`.
They lack tree and input provenance for automated reuse. Those passes were not
rerun to verify them and are not claimed as reusable merge results.

The prose checker reported: "possible-jargon: Explain 'Test Suites' in this sentence if it is a project term." These are Jest's runner result labels. Earlier paragraph-length warnings were addressed by separating the findings.
No browser was started. No graphical application or GPU was used.

## Could not check


- Runtime behavior of the corrected endpoint against a restored stack was not checked. No new test was authorized, and this review did not run a fixture that writes board data.

- Concurrent membership changes were not measured. Each request and recheck uses the existing permission pipeline, but this is not an atomic permissions snapshot.

- Historical measurement artifacts were not present in the source worktree's results folder. The benchmark's result JSON bytes are not RPC payload bytes. The historical page-size comparison also changes page size from 50 to 1000. No current tenfold claim is accepted.

- The source run's capture attachment receipt lists two Markdown reports and no PNG. The live card comment and images were not retrieved because this review keeps board access offline. No new capture was made and no UI screen changed.

## Critical caveats

The corrected endpoint has no restored-stack runtime measurement in this review.
It performs live reads with timestamp-based change hints. Historical performance
figures do not establish the corrected endpoint's performance or wire payload.

## Merge record

The dedicated harness worktree was refreshed to its fresh `origin/main`.
No frozen path or settings file changed in this branch.
The approved script made and pushed merge commit
`13d7c1e7418474158f03250e17fd68fb28da0877` onto `origin/jj/activity-feed`.
Its first parent was fresh main `51b5b2b444da43214fb005212e39f3a2cddd920e`.
Its reviewed tip was `f94302490`, which includes the source and the reviewer fixes.
There were no conflicts and no tracked tree changes from the checks.

The run folder was read-only to the merge script. It saved records under
`/tmp/jake-harness-workers/native-run-wSSKQ1/reviewmerge-records-e43umxfc`.
Copies of `reviewmerge.json`, `gate-results.jsonl` and the raw merge logs are
beside this report. Record commits remain on the review branch.

The frozen-file field from the script record is:

```json
"frozen_files": {"paths": ["orchestrator/merge-train.py", "orchestrator/train-queue.py"], "differing_before_merge": [], "restored": [], "differing_after_merge": []}
```

All five done commands ran on the pushed merge commit, tree
`e5c816cf6489bae7bc3d0c9e93f80bca95f1d8b6`, with exit status 0.
The reason for every run was “a done command runs on every merge.”

| Merge check | Exit | Result line |
| --- | ---: | --- |
| Dependency install | 0 | Rush install finished successfully. |
| Targeted server validation | 0 | SUCCESS: 22 operations. |
| `foundations/server/packages/server/src/__tests__/sessionManager.test.ts` | 0 | Tests: 95 passed, 95 total. |
| `foundations/server/packages/server/src/__tests__/diagnostics.test.ts` | 0 | Tests: 12 passed, 12 total. |
| Node and shell syntax checks | 0 | No error output. |

No result was reused. `failing_checks` and `failing_after_merge` are empty.
The context reader selected the merged validation success lines and session test
result lines. Each was checked against the raw capture. Its install-log selection
failed to return JSON, so the install success line was checked directly.

The required outcome command freshly fetched main and confirmed the reviewed tip
by ancestry. Its merged-stage write and read-back completed without a stage error.
It queued exactly one message for the host relay, beginning “merged with critical
caveats” and naming the evidence limits above. The queue receipt is
`worker/session-outcome.json` in this run folder. Relay delivery itself was not
checked. No direct board command, browser, real launch or deployment was run.

## Failing after merge


- none

## Hygiene notes


- none

## RECOMMENDATIONS

No follow-on is declared. The evidence limits above remain explicit and do not
create a new gate or a handoff.

MERGED
