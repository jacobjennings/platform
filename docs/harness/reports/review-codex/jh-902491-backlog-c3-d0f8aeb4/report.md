Merge.

Reviewed commit: d0f8aeb4e1b50ae68327bc01b64b2593e5c2f0d1

Source task: [JH-902491](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902491).

## Acceptance

The specified range adds the tags index through the existing table setup path. Existing and newly created tables reach the index creation call. Its columns exist in the default schema. The SQL uses fixed index definitions. Three failed attempts log the error and permit attachment to continue. No harness launcher, board label writer or frozen file changed. No implementation fix was needed.

The index narrows lookup by workspace and attached document. Ordering across multiple attached documents can still require sorting. This review accepts the index implementation and does not certify a board speed improvement.

## Applied correction

Reviewer commit 8c56299aa qualifies the worker report. Its opening claimed exact captured tag parameters despite its Limits section stating that a real card identifier was substituted. Its write section called samples with additional indexes an upper bound without evidence. The smallest fix was to qualify those claims and remove the unsupported latency conclusions.

The relevant rule is “Reject unsafe or wrong behavior and false claims about code or test results.” It is stated in the supplied ReviewMerge guide, section 1. The measurement rule in docs/reviewmerge-guide-detail.md requires interleaved repetitions and recorded host load. The worker report explicitly lacks those controls. Its figures remain reported observations rather than accepted performance measurements.

## Validation

No test ran in this review. Only report text changed. No tests were added or extended. The worker reports utils.spec.ts with 82 passing tests and one suite. No gate result record exists, so this is an unverified worker claim and no result is reused by the merge script.

Selection search: `rg -n 'createTables|schemas|utils' foundations/server/packages/postgres/src/__tests__/utils.spec.ts`. It identifies imports of both changed modules. The brief names no test. Passing worker tests were not rerun.

The provisional report was committed as 17ea89737 and pushed before this verdict. The source implementation finished at 12:34 pm America/Chicago. This review started at 12:46 pm. The run reviewed-task-ids.json and launcher/role-index.jsonl both assign this review to the same source task.

## Could not check

- Raw measurements for this implementation were not available in the committed range. A separate local evidence folder contains different index names and is not evidence for this tip. Reported counts, timings, index sizes and the live adapter recreation claim are not independently certified.
- The local capture attachment record says its marked comment was posted and lists two Markdown report attachments. It lists no PNG capture. The live card comment was not read because this brief forbids live board access. No image evidence was available to inspect.
- CockroachDB integration and storage tests were not run. No deployment or host installation was attempted.

No browser was started and no new capture was made. Report wording changes do not change rendered product behavior.

## Critical caveats

None.

## Merge record

The merge script pushed 51b5b2b444da43214fb005212e39f3a2cddd920e to origin/jj/activity-feed. Its parents include the submitted review tip 6bce6e93782395933ca32b60bc3acd3b0ef73e68. No conflict occurred and no named item ran. failing_after_merge and failing_checks are empty.

The frozen_files record is:

```json
"frozen_files": {"paths": ["orchestrator/merge-train.py", "orchestrator/train-queue.py"], "differing_before_merge": [], "restored": [], "differing_after_merge": []}
```

The prose checker exited 0 with these advisory warnings:

> possible-jargon: Explain 'ReviewMerge' in this sentence if it is a project term.

> paragraph-length: This paragraph has 101 words. The warning limit is 90.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

No follow-on is declared by this run. The evidence does not establish an end-to-end board latency improvement.

MERGED
