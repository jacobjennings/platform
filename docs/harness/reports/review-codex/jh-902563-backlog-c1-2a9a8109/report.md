Merge.

Reviewed commit: 2a9a810930ce9de4dfa3e65a47c764f30ebaff4d

Source task: [JH-902563](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902563), "Index the activity JSON filter that dominates the whole-board read".

## Assessment

Accepted the index definition for merge, with the portability fix below. Full performance acceptance is not established. The restored-snapshot comments walk became slower. No deployment or live board measurement was performed.

The key is `collection`. In the refreshed harness, `board/huly-board.cjs:1202` requests the unscoped comments section with `collection: 'comments'`. `readProjectSnapshot` sends it through `client.findSnapshot`. `readBoardSnapshot` repeats this for each project. `storage.ts:1261` produces `data#>>'{collection}'`. `models/chunter/src/migration.ts:164` moves ChatMessage documents to the activity domain.

The index keys are workspace, that JSON expression and `_id`. They match the equality filters and cursor ordering. Carrying `_class` permits CockroachDB to filter the class before fetching the activity payload. Existing background index creation schedules this definition at workspace attach. No harness implementation or launcher changed.

## Applied fixes

Blocking defect, fixed in `b41e88825`: `foundations/server/packages/postgres/src/utils.ts:183` emitted `STORING` for every database. PostgreSQL rejects that clause, so its activity index would not build. The smallest fix emits `INCLUDE` instead. This preserves the index layout on CockroachDB and works on PostgreSQL. The enforcing code is `createDomainIndexes`. The relevant rule is "Reject unsafe or wrong behavior and false claims about code or test results."

The syntax is documented in [PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html) and [CockroachDB CREATE INDEX](https://www.cockroachlabs.com/docs/stable/create-index). CockroachDB documents `INCLUDE` as an alias for `STORING`.

The same commit corrected both worker report copies to distinguish two different page-nine captures. Commit `3b4283335` corrected their summed before count from 256,130 to 256,041. The raw captures were preserved. The reports now distinguish the original SQL capture from the reviewer's syntax change.

## Evidence and acceptance

The raw before plan records 164,295 total KV rows, including 164,190 activity rows and 105 space rows. It reports 118 ms. The raw after plan records 3,653 total KV rows and 13 ms. It names `activity@activity_workspace_collection_id` and a span constrained to the comments key and cursor. These plans support index selection and a smaller scan on this page.

The separate per-page files contain 21 pages each. Summing their rows gives 256,041 before and 181,458 after. The saved walk timings have medians of 293.2 ms before and 509.8 ms after. They do not establish a whole-board speed improvement. The raw after plan also warns that its row-count estimate is inaccurate.

The attachment comment supplied with the brief names two report.md attachments at the reviewed commit. It names no image capture. No image was available locally for visual review. This database change has no changed screen, and this review created no PNG capture.

## Validation

Selection command: `rg -n 'from .*utils|from .*schemas' foundations/server/packages/postgres/src/__tests__ --glob '*spec.ts'`. The affected existing files are `utils.spec.ts` and `conversion.spec.ts`. No test was added or extended. Both files and the conversion test's dummy database client were read before execution.

The worker reported 82 passing tests in `utils.spec.ts` at `cc88478b1`. Its committed row lacks a full tree hash, input list and clean-tree field, so it is not a reusable gate result. No worker result is claimed as reused. Rerunning the selected files is justified by the reviewer change to their imported `utils.ts`.

Applied-fix tip tested: 3b42833357db13a1ec8a0dda17a07a00894fb2e8.
Tested tree: 4428b3f6005ebaf0064ec68d2d80d5d3e2652264.

| Check | Result | Exit |
| --- | --- | --- |
| `foundations/server/packages/postgres/src/__tests__/utils.spec.ts` | `Tests: 82 passed, 82 total`. One suite passed. | 0 |
| `foundations/server/packages/postgres/src/__tests__/conversion.spec.ts` | `Tests: 18 passed, 18 total`. One suite passed. | 0 |
| `node common/scripts/install-run-rush.js build --to @hcengineering/postgres` | 11 build operations succeeded. The compiled utils.js emits `INCLUDE`. | 0 |

The two Jest commands used Node 22, `--runInBand --silent --forceExit` and their single file path. They ran through `gate/isolated_run.py --done` with `reviewer-change:portable-covering-index-syntax`. The runner provided fresh HOME, TMPDIR and XDG directories, guarded Git and refused board URLs. Raw records are in `reviewer-checks.jsonl`. Full check logs are copied into `validation/`. The records mark the tree dirty because this report was being edited. The implementation matched the tested commit. These records are not claimed as reusable merge-gate rows.

The first install attempt exited 1 after I stopped its own waiting Electron installer child, PID 1681. Its error was `Process terminated by SIGTERM`. Retrying the configured Rush install with `ELECTRON_SKIP_BINARY_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1` exited 0 and printed `Rush install finished successfully.` No browser was launched, so no browser process needed cleanup.

The first isolated build invocation exited 3 before running because HARNESS_CONFIG was absent. Its message was `checkout lacks harness.toml, and HARNESS_CONFIG names no settings file to read in its place`. Supplying the configured settings file fixed the invocation. The local context reader selected the first install error lines, which were checked against the raw log. Its retry-log selection failed with `selector did not return strict JSON`. The retry result was read directly from the raw log instead.

No test file or done command was named by the card for the merge. The merge script received no named items. No full suite ran, and no test ran on origin/jj/activity-feed. No test or implementation file was changed after these checks.

The prose checker exited 0. Its warnings were `possible-jargon: Explain 'ChatMessage' in this sentence if it is a project term` and `possible-jargon: Explain 'ReviewMerge' in this sentence if it is a project term`. These are code and tool names used with their call sites.

## Could not check

A full readSupervisionBoard-shaped timing is absent. The captures cover only the comments SQL walk. The exact executable measurement script and complete parameterized SQL text are not committed. The report does not record interleaved measurement arms or machine load. The saved times are observations, not an accepted performance comparison under the measuring rules.

The restored database's reported total population, index size and build duration were not independently reproduced. The unit tests do not directly assert index DDL emission or query planning. No new database measurement was made. The validation tests used the dummy database client. The outcome step contacted the board as described below.

The role index and reviewed-task-ids.json both name [JH-902563](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902563). Implementation finished at 5:06:48 pm on 20 October. Review started at 5:09:12 pm that day, in America/Chicago.

## Critical caveats

The saved full comments walk is slower after the index. A full board timing and the live outcome remain unverified. This run declares no follow-on card. The existing deployment handoff therefore has no linked follow-up card.

## Merge record

The provisional report was committed as `6c4bc1816` and pushed before any test ran. The final pre-merge report and validation logs were pushed in `9da9e78119cc41137e7cceebcab528401395e116`. The prescribed script merged that tip into fresh origin/jj/activity-feed and pushed `745f96d311a2a3caa7adf717e80066c33665e8e6`. Its parents are `8b7a0c39cb56836847149dd1eff97c75ab37b1bf` and the reviewed work-branch tip. There were no conflicts or moved-main retries.

A fresh fetch followed by `git merge-base --is-ancestor` confirmed both the source tip and the fixed review tip in origin/jj/activity-feed, with exit 0 for each check. The merge record has empty `failing_after_merge` and `failing_checks` lists. No tests ran during the merge. The script generated no gate-results.jsonl because it had no named items. The empty file beside this report records that absence. Post-merge records are committed only on the review branch.

No settings or frozen files changed. The frozen_files record is:

```json
"frozen_files": {"paths": ["orchestrator/merge-train.py", "orchestrator/train-queue.py"], "differing_before_merge": [], "restored": [], "differing_after_merge": []}
```

The outcome step exited 0 after checking ancestry. It queued `merged with critical caveats` for the Orchestrator. Its message is saved in outcome.txt.

Unexpected boundary mismatch: the required outcome command inherited the prescribed offline board variables, but its JavaScript board client reads the live settings and does not consult HULY_BOARD_CONFIG. The outcome returned without a stage caveat. Its code therefore reports a successful stage:merged write and readback. This contradicts the brief's no-board-contact restriction. I did not issue any further board commands. No deployment was performed.

Owner ruling, 11 October 2026, quoted separately from this analysis as supplied in the brief and recorded in docs/owner-preferences.md:

> "After the review, it gets merged."

The missing linked follow-up is recorded in Critical caveats. The script's handoff detector returned `unowned_handoff: null`, so it did not emit an uncovered-handoff alarm.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

Reduce repeated workspace-wide comments reads in the harness by fetching comments for the retained card identifiers. Preserve comments whose space differs from the card's space. This is a recommendation only, and no harness change or follow-on is assigned by this run.

MERGED
