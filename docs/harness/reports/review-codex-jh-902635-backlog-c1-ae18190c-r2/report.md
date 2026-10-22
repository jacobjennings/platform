Merge.

Reviewed commit: ae18190c5e6ceb401fd4fabc93141d7995ffbb00

Source task: [JH-902635](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902635).

## Acceptance

The timeout change is accepted. It raises Jest's limit to 60 seconds before the suite registers its hooks. The file creates and fills a database before each case and closes and drops it afterward. The change leaves all cases, assertions and fixtures intact. It changes no product code or launcher. No reviewer implementation fix is needed.

The original health capture at /home/jakej/.local/state/jake-harness/main-health/repo-huly-platform-5031b547/20261022T030404Z-67062797/wrapper.log names the failing file at line 11029. Lines 11658 through 11709 show 5000 ms hook timeouts at beforeEach and afterEach. Line 11714 reports 3 failed and 202 passed across 205 package cases. This supports extending the hook budget. It does not prove that every future run finishes within 60 seconds.

The later health run 20261022T034127Z-67062797 failed at wrapper.log:28 because port 26258 was allocated. A Jest timeout change cannot fix that infrastructure failure. It does not invalidate the earlier hook failure.

## Scope and evidence

The requested range contains one four-line test-file addition and three evidence files. The fresh three-dot comparison against origin/jj/activity-feed names the same files. No frozen file or settings file changed.

The source implementation finished at 10:48 pm on October 21, 2026. This review started at 10:56 pm that evening. The launcher's reviewed-task-ids.json and role-index.jsonl reviewmerge row both bind this review to the source task linked above.

The worker's record names commit 7be4b648676eb5459a88a54d579f4290dfd42f6e and tree 785a3fdcee3dcf9d86dfbb3248665de07e93d556. Its rc is 1 and dirty is false. This is not a reusable passing gate result.

The raw worker capture is /home/jakej/gh/huly-platform-worktrees/jh-902635-backlog-c1/docs/reports/jh-902635-backlog-c1/gate-run-logs/785a3fdc-jh-902635-backlog-c1-20261022T034217Z-7869-2ab1-foundations-server-packages-postgres-src-__tests__-integration.test.ts.log. Lines 12097 through 12101 report one passing suite, 93 passing cases and 67.777 seconds on that worker commit. Line 12454 says "Jest did not exit one second after the test run has completed." The record does not establish why the final rc is 1.

## Validation

Selection method: review the changed integration test and its direct evidence. The search was `rg -n 'integration.test|shared-integration' foundations/server/packages/postgres/src/__tests__`. The changed file imports the shared integration cases rather than changing their assertions.

No test ran in this verdict-only review. The changed integration file has the worker result above and no reviewer run on the tip or merge. No result is reused as passing. tests.full_suite is not run because reviews are forbidden to run the full suite. No done command is named. A missing run does not block the merge under section 3 of the supplied guide.

No browser, service, container or graphical application was started by this review. No deployment occurred. The card's validation comment attaches report.md rather than a PNG. There is no image capture to inspect and this change has no user interface.

## Could not check

The 60 second budget has not been exercised under the failing health run's exact contention. The database index shutdown problem remains outside this timeout change. The full-suite recovery and the later port conflict are not claimed fixed. The context reader refused the worker log with "source_path_outside_allowed_roots". The narrow summary spans above were checked directly in the raw file instead.

## Merge record

The prescribed merge script will merge the reviewed branch into the repository record's origin/jj/activity-feed. The report will record the resulting commit and ancestry outcome after the push.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

Accept the bounded timeout change. Main health provides the next full-suite result. No deployment or separate follow-on is requested.

NOT MERGED
