Merge.

Reviewed commit: c6738982820cf217ea0c30142d1711b275088e36
Source task: [JH-902570](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902570).
Applied report correction: 528cbf3ab.

## Acceptance

The UTC pins make the existing date assertions independent of the host timezone. They leave the timezone cases and assertions in place. The server test commands build the model bundle before compression reads it. The existing bundle command does not invoke tests. No launcher, product behavior, board label or board stage code changed.

I accept these repository fixes. They do not establish that the bare full-suite command is green. The remaining service preparation belongs to the harness settings outside this review range.

## Critical caveats

The worker reports that the bare full-suite command still fails without database, Kafka and Elasticsearch services. The checked CI workflow prepares those services and sets connection URLs. This review neither runs the full suite nor changes that external preparation. A green full-suite acceptance result remains unverified.

## Review evidence

I reviewed 745f96d311a2a3caa7adf717e80066c33665e8e6..c6738982820cf217ea0c30142d1711b275088e36. The implementation changes only two Jest configurations and the pod-server package scripts. The other files are reports and a worker record.

The launcher's reviewed-task-ids.json and the local role-index.jsonl both assign this review to the source task above. The implementation tip was committed at 7:07 pm on October 20. This review started at 7:10 pm on October 20, America/Chicago.

The repository record routes the merge to jj/activity-feed in jacobjennings/platform. That is the configured main branch for this repository. The dedicated harness worktree was refreshed to its own origin/main before the merge step.

Reviewer correction 528cbf3ab fixes the worker reports' file count and report-only commit history. Nine failing basenames resolve to ten files. Three report-only commits follow the tested code commit. No implementation changed during review.

Selection method: read the changed configurations, package commands and directly affected tests, then compare worker results with their raw logs.

Search used: `rg -n 'TZ|timezone|jest|bundle/model.json' foundations/core/packages/core/src/__tests__ plugins/calendar/src/__tests__ pods/server/src/__tests__`.

No reviewer test ran. No full suite ran. Passing worker tests were not rerun. Report-only corrections require no implementation test. The diagnostic failing-case list is not a command to run the prohibited full suite.

## Worker test evidence

These results are from worker commit ffd94af3570ce77d65f19ae395671e02a62979d6 and tree 51f4512aebb68f12dda047e1f5601ba65ed1b21c. I checked the Jest result lines in the raw log paths recorded in docs/reports/jh-902570-backlog-c1/gate-results.jsonl. They are worker evidence retained without rerunning, not formal merge-script reuse decisions. The passing done-mode rows have no input-file lists for formal reuse.

| File | Exit status | Checked runner result |
|---|---|---|
| foundations/core/packages/core/src/__tests__/time.test.ts | 0 | Tests: 662 passed, 662 total |
| plugins/calendar/src/__tests__/utils.test.ts | 0 | Tests: 13 passed, 13 total |
| pods/server/src/__tests__/compression.spec.ts | 0 | Tests: 5 passed, 5 total |
| foundations/server/packages/elastic/src/__tests__/adapter.test.ts | 0 | Tests: 3 passed, 3 total |
| foundations/server/packages/kafka/src/__test__/queue.spec.ts | 0 | Tests: 2 passed, 2 total |
| pods/fulltext/src/__tests__/indexing.spec.ts | 0 | Tests: 3 passed, 3 total |
| foundations/server/packages/postgres/src/__tests__/storage.test.ts | 0 | Tests: 8 passed, 8 total |
| foundations/server/packages/postgres/src/__tests__/integration.test.ts | 0 | Tests: 93 passed, 93 total |
| server/account/src/__tests__/postgres-real.test.ts | 0 | Tests: 4 passed, 4 total |
| services/telegram-bot/pod-telegram-bot/src/__tests__/postgres-real.test.ts | 0 | Tests: 16 passed, 16 total |
| foundations/server/packages/mongo/src/__tests__/storage.test.ts | 0 | Tests: 31 passed, 31 total |

The compression row also includes pods/server/src/__tests__/server.test.ts. Its raw log says two suites passed and five tests passed in total. The other passing rows each say one suite passed. The initial core attempt exited 1 under node --test with ERR_MODULE_NOT_FOUND for the extensionless classes import. The subsequent Jest run passed all 662 cases. That initial runner failure is not hidden.

## Could not check

The full suite remains unrun under the review rules. The service lifecycle and original fail-before counts were not independently reproduced. The raw logs support the targeted passes, not a full-suite pass or a coverage improvement.

The marked card comment attaches report.md twice with no caption. It names no PNG capture. The matching local worker report was read as text evidence. There is no changed screen to suggest capturing. No browser or service was started by this review.

No frozen file changed in this branch. No harness settings file changed, so candidate settings loading is not applicable. The merge record will supply the exact frozen_files result.

The worker recommendations identify harness work without a follow-up card. This is an uncovered handoff. It does not stop the merge, and this run declares no follow-on.

## Merge record

The final report is committed and pushed before invoking the merge script. The script alone merges and pushes. The merge hash and ancestry outcome will be recorded here after execution.

Prose check exited 0. It reported these advisory warnings:

> paragraph 18: sentence-length: This sentence has 72 words. The warning limit is 45.

> paragraph 33: possible-jargon: Explain 'The Director' in this sentence if it is a project term.

The length warning concerns the test table. Director names the role responsible for external harness changes.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

The Director should track the external service preparation gap with a follow-up card. This run does not create one. No deployment was performed.

NOT MERGED
