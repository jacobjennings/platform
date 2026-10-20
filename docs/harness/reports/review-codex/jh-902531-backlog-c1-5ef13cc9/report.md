Merge.

Reviewed commit: 5ef13cc99cb3ecea1f0076d65c0265c4d998caab

Source task: [JH-902531](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902531).

## Assessment

The retained index definitions reach the existing workspace-attach path for both existing and new tables. The declaration snapshot preserves index flags when catalog discovery replaces the runtime schemas. Index creation preserves the declared access method and retries failed statements. The two excluded fields are omitted from generated definitions. No launcher, board-writing code, settings or frozen file changed.

Code behavior is accepted. Measurement acceptance is incomplete. This verdict does not accept the reported timings as a controlled performance comparison. Missing evidence does not become a merge requirement under the supplied guide.

## Critical caveats

The required interleaved before and after matrix at 1, 4, 8 and 16 clients was not completed. The arms ran sequentially on a shared host. The shipped-set project-read median is 3,211 ms against 1,870 ms before. The cause remains unisolated. Index creation is awaited during attach. The worker reports a two to three minute first build and a connection timeout during that build. This merge is not a deployment approval or evidence of a read improvement.

## Findings and applied fixes

Suggestion, docs/harness/reports/jh-902531-backlog-c1/report.md:161 and the duplicate report. The claimed 13 percent increase from 12,176 ms to 13,037 ms is 7.1 percent. Both copies now give 7.1 percent.

Suggestion, docs/harness/reports/jh-902531-backlog-c1/report.md:158 and the duplicate report. The saved diagnostic contains 4,707.757 ms for the project read, rather than the claimed 3,042 ms. Both copies now name the saved 4,708 ms result. They no longer claim that this probe isolated an improvement from dropping task.space.

The enforcing rule is the supplied ReviewMerge guide section 4, "Check every reported count against its evidence." These are report corrections. No implementation fix or test change was made.

## Evidence checked

The requested range is 13d7c1e7418474158f03250e17fd68fb28da0877 through the reviewed commit. The fresh destination branch is origin/jj/activity-feed, as the launcher's repo.json specifies. Its pre-merge commit is 13d7c1e7418474158f03250e17fd68fb28da0877.

The worker finished at 2:47 pm on October 20. The review role was recorded at 2:55 pm. The launcher's reviewed-task-ids.json and launcher/role-index.jsonl both assign this review to the linked source card.

I recomputed grouped sample counts and medians directly from the worker worktree's ignored dev/board-load/results logs. These were read-only calculations, with no rig or test execution. run.kgax5B/baseline.jsonl confirms the reported before medians. run.bY0Ijj/baseline.jsonl confirms the reported full-set and four-client medians. run.7QzLu0/pages50.jsonl has three project-read samples with median 3,211.219 ms. run.bY0Ijj/diagnostic.jsonl has one project read at 4,707.757 ms and one supervision read at 61,789.529 ms. run.efLAJX/smoke.log:3 says "connect: Connection timeout, and no connection established to ws://transactor:3332".

The marked worker attachment comment lists two report.md attachments, each 13,581 bytes. It lists no PNG captures. I read the committed reports and local raw rig logs. No caption was treated as image proof. No UI changed and no new capture was needed.

## Validation

No reviewer test ran. No passing gate result was rerun or claimed as reused. No named test or done command was supplied. Only report text changed during review. The merge therefore names no test or done command, under sections 3 and 7 of the supplied guide.

The test-selection search was `rg -n 'addSchema\(|getSchemaIndexDefinitions|createTables|schemas|utils' foundations/server/packages/postgres/src/__tests__`. It found utils.spec.ts and conversion.spec.ts importing the changed modules. Neither was run because implementation was unchanged during review and this is a verdict review. No tests were added or extended.

The worker reports storage.test.ts as 8 failures from 8 cases with AggregateError and no running database fixture. Its exit status and tested tree are not recorded in a reusable gate row. integration.test.ts was not run. These are worker statements, not reviewer results or named merge checks.

The prose checker exited 0 with no warnings on the provisional report. The draft checker exited 0 with three advisory warnings: "possible-jargon: Explain 'ReviewMerge' in this sentence if it is a project term.", "sentence-length: This sentence has 63 words. The warning limit is 45.", and "possible-jargon: Explain 'AggregateError' in this sentence if it is a project term."

The later scan also exited 0. It repeated the three warnings above and flagged the quoted names again. Its additional warnings were "possible-jargon: Explain 'ReviewMerge' in this sentence if it is a project term.", "possible-jargon: Explain 'AggregateError' in this sentence if it is a project term.", and "paragraph-length: This paragraph has 102 words. The warning limit is 90." These are advisory prose warnings.

## Could not check

The complete interleaved three-repetition matrix, the attribution of the remaining read difference and the shipped-set high-concurrency behavior remain unchecked. The local SQL catalog captures and size capture were not found alongside the reviewed reports. The claimed 62 tables, 197 secondary indexes, 585 index-column rows, 145.2 MB subtotal and build durations remain worker-reported figures. I did not independently reproduce them. No local stack, browser or deployment was started. The outcome step attempted a board-stage command despite the offline environment. No reply or stage read-back was obtained, so a board change cannot be confirmed or excluded.

## Owner rulings

> 11 October 2026: "After the review, it gets merged."

> 16 October 2026: "no requirements for merge"

These quotations come from the supplied brief. They are separate from the assessment above.

## Merge record

The applied report-fix tip is 4955da3af36ad22b725d7ff2dc3d757d5d140afc. It was pushed before the merge. The dedicated harness worktree's orchestrator/harness-reviewmerge.py exited 0 and pushed merge commit d66ec41654a3cff3f3a8860b0ae57ca5ffda05e2 to jj/activity-feed. The merge has no conflicts. The tested and pushed hashes match. No named check ran, so the records folder contains no gate-results.jsonl. The complete reviewmerge.json is saved beside this report.

The frozen-file record is `"frozen_files": {"paths": ["orchestrator/merge-train.py", "orchestrator/train-queue.py"], "differing_before_merge": [], "restored": [], "differing_after_merge": []}`. No restore commit was needed.

The outcome step exited 0 after confirming ancestry against a fresh fetch. It queued "merged with critical caveats" in the launcher's worker/session-outcome.json. It also reported "the stage is not set: board stage printed no reply:".

The outcome helper launched its board-stage child despite HULY_BOARD_CONFIG being set to the refused offline port. Inspection showed the positional CLI does not read that environment setting. I stopped the exact child PID 1803 that this run started. No stage read-back was obtained. The report makes no claim that the card moved or that the attempted helper made no network contact. This harness behavior is outside the reviewed platform range. No browser process was started, so no browser cleanup was needed.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

No follow-on is declared by this run. The measurements support no performance improvement claim. Completing the controlled matrix and isolating the remaining project-read difference would supply the missing acceptance evidence.

MERGED
