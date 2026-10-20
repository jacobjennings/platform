Merge.

Reviewed commit: 8deb9d1b2ac4edee3c5101e1766c4d71317a53f6
Applied-fix tip: 2f62bd8f445075972ca17420846937848635d816

Source task: [JH-902455](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902455).

## Acceptance

The change adds an isolated local board workload and profiling tools to the Huly fork.
It changes no production service implementation or harness launcher.
The review covers 789f1bb6..8deb9d1b2ac4edee3c5101e1766c4d71317a53f6.
The Director's explicit target is jj/activity-feed in the fork.
The checkout settings and origin agree with that target.
The generic jake-harness repository wording in the brief does not describe this checkout.

The provisional report was committed as 57df4bcc1 and pushed before any check ran.
The implementation tip was committed at 7:11 pm on October 19.
The review assignment was recorded at 8:52 pm that evening.
reviewed-task-ids.json and the role-index row both name the source task above.

## Applied findings

Blocking, fixed: dev/board-load/collect-censored.cjs:23.
The original collector discovered processes through command lines and signaled them directly.
Matching a command line does not establish that the collector started a process.
The command rule says, "Stop only processes you started, by the exact PID you recorded."
The collector now writes an exclusive stop request.
The driver signals only its own child objects.
The driver suppresses later result messages after collection starts to avoid duplicate outcomes.
The enforcing code is dev/board-load/driver.cjs.

Blocking, fixed: dev/board-load/run.sh:26.
SQL diagnostics modified the built server bundle and left that instrumentation in place.
A later cached build could reuse it during a latency baseline.
The runner now saves the original bundle before patching and restores it in EXIT cleanup.
A restoration failure is reported without skipping container cleanup.
The enforcing code is dev/board-load/run.sh.

Blocking, fixed: docs/harness/reports/jh-902455-load-profile-c1/report.md:21.
The comparison ratios were described as measured gains without independent interleaved repetitions.
The measuring rule says, "Performance on a shared machine is not a measurement until it is repeated."
The report now identifies the ratios as exploratory observations.
It explicitly states that the required repetitions and host-load record are absent.
The README also now names which services actually have lifetime timers.

## Evidence

The implementation worktree retains raw results under dev/board-load/results.
A deterministic comparison checked all 49 attempt-table rows against those JSONL files.
Sample counts, error counts, nearest-rank p50, p95 and maxima match.
The baseline contains 580 attempts and 148 errors.
The separate-account scenario contains 16 censored failures.
These are workload outcomes, not passing checks.

All three 50-row samples and all 48 larger-page samples returned 2,430 rows.
Every sample has SHA-256 afccd470cee67a1edbc11b0282999b94e2427f5363a43de7b429580a38480d2c.
The fresh-run fixture-scale.json agrees with the seven reported SQL fixture counts.
The saved teardown record lists 25 containers, three anonymous volumes and two networks.
Its remaining-resource lists are empty.
That is saved worker evidence, not a new live resource inspection.

Both vendored client files match the pinned harness commit 90545543416a9a2702ef3c89999cf0967280e726 byte for byte.
SHA-256 values agree with PROVENANCE.md and fresh hashes of git show output.
The local adapter injects explicit fixture settings and rejects non-fixture fetch and websocket hosts.
Compose uses an internal network and publishes no ports.
Fixture writes use generated local accounts and the local database.

No frozen file changed in the reviewed range.
The fork's main-branch settings deletion must remain in the merge candidate.
This change adds no required project setting and does not edit a settings file.

## Checks

Selection method: search existing test and spec files for references to the changed profiling tools.

Search command:
rg -n '(board-load|collect-censored|patch-sql-profile)' --glob '*test*' --glob '*spec*' dev tests docs/harness

The search returned no matches, with exit status 1.
No existing adjacent unit test was found.
No new test was written.
No worker passing gate was rerun.
No full suite, live load, browser, deployment or real board write ran.

The isolated runner checked the reviewer changes on 2f62bd8f445075972ca17420846937848635d816.
Tree: 7af7551cbf19ff044671b53fd822a970b7083de6.
Reason: reviewer-change:profiling-cleanup-ownership.

dev/board-load/collect-censored.cjs passed /usr/bin/node --check, exit 0.
dev/board-load/driver.cjs passed /usr/bin/node --check, exit 0.
dev/board-load/run.sh passed bash -n, exit 0.
Runner result: PASS: collector syntax, driver syntax, runner shell syntax.
These are syntax checks, so test counts are unavailable.
The runner recorded dirty=true because of a temporary local HOME pointer.
That untracked pointer was removed.
This record is disclosed and is not offered as a reusable worker pass.

Prose checker warnings from the first pass:

"paragraph 5: possible-jargon: Explain 'The Director' in this sentence if it is a project term."

"paragraph 22: paragraph-length: This paragraph has 99 words. The warning limit is 90."

The long check paragraph was split. Director names the role assigned in the brief.

## Could not check

The review did not rerun the Docker workload or establish production capacity.
The cleanup changes have syntax coverage and code review, without a new live fixture run.
The worker report has no committed gate-results.jsonl to reuse.
The source card's attachment comment was not read.
No claim is made that the card has or lacks validation captures.
The review evidence folder contains no images.
No changed user interface needs a screenshot suggestion.
Host-load controls and independently repeated comparisons remain absent.
SQL execution plans, debugger snapshots and CPU tables were read as worker evidence rather than reproduced measurements.

## Critical caveats

The performance ratios are exploratory observations.
They do not establish production speedups or repair the underlying pool and limiter behavior.

## Merge outcome

The final verdict is approved for the prescribed merge script.
The merge has not yet been confirmed.
Board writes remain prohibited by this brief.
The outcome command will use offline board settings.

## Failing after merge

- none

## Hygiene notes

- none

## RECOMMENDATIONS

Use the local draft follow-ups as planning material.
This review creates no follow-on and makes no live board changes.

NOT MERGED
