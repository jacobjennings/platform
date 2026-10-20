Merge.

Reviewed commit: 79736ca6f34cbed87a126f562cafc0bc291bb4f2
Applied-fix tip: e4176ea6fcbe978c4a89d8eb1bca33afbbbd049f

Source task: [JH-902454](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902454).
Reviewed range: 45533155..79736ca6f34cbed87a126f562cafc0bc291bb4f2.

## Acceptance

The change adds rate-limit refusal and wait logging, slow request and connect timing, event-loop delay, minute summaries and slow SQL logging. The code preserves the existing rate-limit decisions and retry delays. Query values are redacted from SQL diagnostics after the reviewer fix below. No harness launcher source or frozen file changed. The shared settings route this fork to jj/activity-feed. The fork has no harness.toml to restore or load.

Director instruction, verbatim:

> Merge target is jj/activity-feed in the Huly fork repo. The fork's own harness.toml was removed on that branch (commit 7a6e1daee). If the merge conflicts on harness.toml, take the deletion. If the fix lies outside the Files list, that is not a reason for NOT MERGED.

## Finding fixed

High severity. foundations/server/packages/postgres/src/diagnostics.ts:36 used one regular expression for SQL strings and comments. An ordinary PostgreSQL string ending in a backslash caused the next literal to appear in the log. Nested block comments also exposed comment text after the first closing delimiter. Synthetic inputs reproduced both leaks with the marker fixture-private.

The guide requires reviewers to reject "secret exposure". The existing diagnostics.spec.ts covers SQL normalization but does not exercise these cases. Commit e4176ea6fcbe978c4a89d8eb1bca33afbbbd049f replaces that expression with token scanning. It distinguishes ordinary strings from E strings and consumes nested comments completely. Manual inspection after the fix returned `SELECT ?, ?` and `SELECT ? ?` for the two inputs. Quoted identifiers and bound placeholders remain visible. No test was added or extended.

## Validation

Selection used `rg -n '(../client|../sessionManager|../connection|../storage|../diagnostics|../rateLimitWait)' foundations/server/packages/server/src/__tests__ foundations/server/packages/postgres/src/__tests__ foundations/core/packages/client-resources/src/__tests__`, plus the three added test files and storage.test.ts importing through the package index. The reviewed file set was checked with `git diff --name-only origin/jj/activity-feed...79736ca6`.

The reviewer reran only the existing tests affected by the SQL redaction fix. Both ran on e4176ea6fcbe978c4a89d8eb1bca33afbbbd049f, tree 33c884d38431cb86f8a54bf65a95d670e4a6d9e1. The reason was reviewer-change:sql-literal-redaction.

| Test file | Exit | Result line |
| --- | --- | --- |
| foundations/server/packages/postgres/src/__tests__/diagnostics.spec.ts | 0 | Tests: 4 passed, 4 total |
| foundations/server/packages/postgres/src/__tests__/conversion.spec.ts | 0 | Tests: 18 passed, 18 total |

The file runner and its install command each refused with exit 3 and "isolated-run: checkout lacks harness.toml". The required install then ran under a clean environment and exited 1. Its error says Node v26.10.0 does not meet >=20.0.0 <25.0.0. Existing worker dependencies were linked temporarily into this worktree.

The package test runner ran with /usr/bin/node using gate/isolated_run.py's make_shim and isolated_env helpers. Each file had fresh HOME, TMPDIR and XDG folders, guarded Git and both offline board URLs. Coverage collection was disabled. No full suite ran. No test ran on origin/main.

Raw reviewer logs and review-checks.jsonl are in /home/jakej/.local/state/jake-harness/run-evidence/812fcbdfc66f9a4e90da3f27. The temporary dependency link is not a source change. The context reader returned "selector did not return strict JSON" for the worker session-manager log and the install log. Their relevant raw lines were read directly. No reader answer supplied a finding.

The worker report names 83fd2c2f3 as its tested commit. Later source commits change reports only. Its raw logs under /tmp/jake-harness-workers/opFo5EeR were checked without rerunning passing tests:

- client-resources rateLimitWait.test.ts: PASS, 2 passed, 2 total. The combined command exited 1 because connection.test.ts could not resolve a dependency.

- client-resources connection.test.ts: rerun exit 0, 4 passed, 4 total.

- client-resources cancellation.test.ts: exit 0, 4 passed, 4 total.

- client-resources integration.test.ts: exit 0, 14 passed, 14 total.

- postgres diagnostics.spec.ts: exit 0, 4 passed, 4 total.

- server diagnostics.test.ts: rerun exit 0, 12 passed, 12 total.

- server sessionManager.test.ts: rerun exit 0, 95 passed, 95 total.

Those logs support 135 passing cases across seven files after dependency preparation. They do not provide a clean reusable gate row for this tip. No worker gate row is claimed as formally reused. Historical records under the earlier review folder describe older commits and were read as evidence only.

The final prose checker exited 0 with no warnings.

## Review binding

reviewed-task-ids.json and the launcher role-index row both name the source task linked above and the reviewmerge role. The implementation finished at 9:47 pm on 19 October. This review started at 9:49 pm that evening, after implementation finished. The provisional report was committed and pushed before the code review finished.

## Could not check


- storage.test.ts performs database administration against a configured service. It was read but not run. No database was contacted.

- The marked board attachment comment was unavailable under the required offline configuration. No worker image was inspected and no caption was treated as proof. No user interface screen changed.

- Production log emission, deployment and exhaustive SQL lexical coverage were not checked.

- No reusable worker gate record binds the rebuilt tip to its test tree. The raw logs support the test results above, but do not independently certify their commit binding or the worker's build claims.

## Merge record

The final verdict report was committed as 1177f6130 and pushed before the required merge command. The dedicated harness worktree was refreshed to origin/main. The script received that review tip, the source card link, the prescribed shared settings, and the three added test files. No named test ran because repository routing failed first.

The merge command exited 2 before any write with "harness-reviewmerge: refused before any write: card repo lookup failed: ". The outcome command exited 2 with the same error. lib/repo_routing.py requires a board read to select this card's repository. The brief requires offline board access. No alternate merge command, settings substitution or routing bypass was used.

No reviewmerge.json or merge gate-results.jsonl was produced because routing failed before record creation. There is no frozen_files line to quote. Neither frozen path changed in the reviewed range or reviewer fix. review-checks.jsonl records the two reviewer test runs and is not a merge record.

A fresh fetch resolved origin/jj/activity-feed to 631204754d646a58d9b333d6daca39b934c6eccc. Ancestry checks returned 1 for both the source tip and the applied-fix tip. Neither is merged. No card stage changed and no outcome message was delivered. The temporary dependency link was removed.

## Critical caveats

The required merge and outcome commands could not pass repository routing under the required offline configuration. Database-backed acceptance and production behavior remain unverified.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

Accept the change with the SQL redaction fix. The director needs to reconcile the offline-board instruction with the merge script's required card lookup. This run declares no follow-on and performs no deployment.

NOT MERGED
