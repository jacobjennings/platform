# JH-902635: tests.full_suite red on 67062797

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902635
Health run: 20261022T030404Z-67062797 (`wrapper.log` in the main-health run folder)
Run branch: `codex/jh-902635-backlog-c1`
Code tip: `7be4b6486`, one code commit on top of `67062797`

## Summary

- The red file is `foundations/server/packages/postgres/src/__tests__/integration.test.ts`. The card says "vitest". That label is wrong. The repo has no vitest, and the log shows Jest.
- Three of 93 cases failed in the red run. They were `should handle combined projection, sorting, limit and filter`, `should handle $in with empty array` and `should handle $nin (not in) operator`.
- The cause in the log is a 5 second Jest hook timeout. The fix raises the file's Jest timeout to 60 seconds. No assertion, case or fixture changed.
- On the tip, the gate ran the file. All 93 cases passed. The gate record still has rc 1, which I explain below.
- I did not reproduce the red result on this machine. Details are below.
- I did not run `tests.full_suite`. The full suite belongs to the merge lane.

## What the red run shows

Source: `wrapper.log` in the run folder named above.

- Line 11029: `FAIL src/__tests__/integration.test.ts (132.305 s)`.
- Lines 11041 to 11042: `Tests: 3 failed, 202 passed, 205 total` for the postgres package.
- Line 11674: `PostgresError: database "d5eea4fa-..." does not exist`.
- The hook errors read `Exceeded timeout of 5000 ms for a hook`. They are at `integration.test.ts:79` (beforeEach) and `integration.test.ts:99` (afterEach).
- The green run `20261022T022227Z-67062797` ran the same tree. It passed the same file in 93.668 s.

The card's "last 40 lines" do not show the failure. The failing cases are in the package block near line 11021 of the same log.

## Cause

What the evidence supports:

- The file creates a new database in each `beforeEach`. It loads the model and starts two adapters there. It drops the database in `afterEach`.
- Jest's default hook limit is 5 seconds. One hook over 5 seconds fails the case.
- The same tree passed in 93.7 s and failed in 132.3 s. So the failure depends on timing.
- Jest moved on after the 5 second `beforeEach` timeout. The timed-out setup kept running. The `afterEach` then dropped the database, and the next case failed with `database ... does not exist`. This is the likely reason for the cascade in the log. I did not prove it.

What I could not reproduce:

| Run on this machine | Result | Time |
|---|---|---|
| The file alone, unmodified tip `67062797` | 93 of 93 passed | 68.5 s |
| The postgres package test, unmodified tip | 205 of 205 passed in 5 suites | 72.7 s |
| Three copies of the file at once, one CockroachDB | 93 of 93 passed in each copy | 75.8 to 77.0 s |

So I did not reproduce a hook over 5 seconds. The red run shared its CockroachDB with other suites on the health host. I think that load is the likely trigger. The red run has no per-hook timings, so this is not proven.

The card says "Rerun alone: also red." I could not check that claim. `health.json` has an empty `alone_log`, and the run folder has no alone log.

## Change

File: `foundations/server/packages/postgres/src/__tests__/integration.test.ts`, lines 51 to 53.

```ts
// Each test creates, fills and drops its own database. Suites that run in
// parallel share one CockroachDB, so that setup can pass Jest's 5 second default.
jest.setTimeout(60000)
```

Why file scope: Jest reads the hook limit when the hook starts. A call inside `beforeEach` would not extend the hook that is already running. The same file-level call is used in `server/account/src/__tests__/postgres-real.test.ts:11`.

Why 60 seconds: a normal case takes under 1 second on average (68.5 s for 93 cases). 60 seconds covers the slowdown seen in the red run. It is still short enough that a real hang fails in a minute.

Not done:

- I did not change the product code. The index build in `foundations/server/packages/postgres/src/utils.ts` keeps running after the pool closes. That is outside this card.
- The fix does not remove the cascade. A setup that runs past 60 seconds would still cause it.

## Gate run on tip `7be4b6486`

Command, run from the worktree root:

```
HARNESS_CONFIG=/home/jakej/gh/jake-harness/harness.toml python3 /home/jakej/gh/jake-harness/gate/isolated_run.py --reason changed-file:foundations/server/packages/postgres/src/__tests__/integration.test.ts foundations/server/packages/postgres/src/__tests__/integration.test.ts docs/reports/jh-902635-backlog-c1/gate-results.jsonl
```

Notes on the command:

- `gate/isolated_run.py` is not in this checkout. I used the copy in the harness repo.
- This worktree has no `harness.toml`. The gate reads the project settings from `HARNESS_CONFIG`, so I pointed it at the harness repo's file.

Table, copied from `python3 /home/jakej/gh/jake-harness/gate/isolated_run.py --table docs/reports/jh-902635-backlog-c1/gate-results.jsonl`:

| File | Tree | rc | Ran | Failures | Errors | Skipped | Excluded | Seconds | Jobs | Batch seconds |
|---|---|---|---|---|---|---|---|---|---|---|
| foundations/server/packages/postgres/src/__tests__/integration.test.ts | 785a3fdc | 1 | None | None | None | None | None | 212 | 8 | 212 |

1 runs, 0 rc 0, 1 not rc 0 (counted from docs/reports/jh-902635-backlog-c1/gate-results.jsonl).

The gate did not read a count from this Jest log, so `Ran` is `None`. The counts below come from the gate log itself:

- `Test Suites: 1 passed, 1 total`
- `Tests: 93 passed, 93 total`
- `Time: 67.777 s`

The gate log is in `docs/reports/jh-902635-backlog-c1/gate-run-logs/`. The repo ignores `*.log`, so that log stays local and is not committed.

Why rc is 1 although all 93 pass:

- The log shows `Jest did not exit one second after the test run has completed.`
- Warnings from the package's background index build keep printing after the summary.
- The gate's `file_command` for this repo has no `--forceExit`. The package's own `test` script does have it (`foundations/server/packages/postgres/package.json`, line 13).
- Before my change, the file's runs without `--forceExit` ended without the script's exit line. The package run with `--forceExit` printed `jest exit=0`. So the non-zero exit is not new.
- I did not capture the code path that sets rc 1. The missing `--forceExit` is the likely cause. I did not prove it.

## Tests by file

| File | Where it ran | Result |
|---|---|---|
| `foundations/server/packages/postgres/src/__tests__/integration.test.ts` | Gate, tip `7be4b6486` | 93 of 93 passed. Gate rc 1, explained above. |
| `diagnostics.spec.ts`, `utils.spec.ts`, `conversion.spec.ts`, `storage.test.ts` | Unmodified tip `67062797`, inside the package run | Passed. These files are not changed and the card does not name them. Not run on the tip. |

Other runs on the unmodified tip, before my change, are listed in the table in "What I could not reproduce."

## Environment

- Harness rule for installs and tests: a fresh `HOME` under my temp folder, `env -i`, offline `HULY_BOARD_CONFIG`, `VIKUNJA_BASE_URL` at port 9, and `CUDA_VISIBLE_DEVICES` empty.
- Install: `node common/scripts/install-run-rush.js install`, then `build --to @hcengineering/postgres` (exit 0). The install used a Node 22 folder copied from the mise install, because the mise install was missing its npm. System Node 26 is refused by the repo's `nodeSupportedVersionRange`.
- Database: one CockroachDB v24.1.2 single-node container named `jh902635-crdb` on `127.0.0.1:26258`. This is the same image and port as `tests/docker-compose.yaml`. I started it for this run and removed it at the end. I did not run `tests/prepare-tests.sh`, because that script stops the shared `sanity` compose project.
- No NVIDIA device was touched. No contact with `huly.lan`. No real board write.

## Merge and base

- `git merge-base --is-ancestor origin/jj/activity-feed HEAD` exited 0. The branch already contained `67062797`, so no merge was needed.
- `origin/main` is `33f141364`, an upstream sync. It is not an ancestor of this branch. The brief said to merge `origin/main` once and also said to merge only `origin/jj/activity-feed`. I followed the second rule and did not merge `origin/main`.

## Deviations

- The card's "vitest" label is wrong. The test is Jest.
- The gate runner was used from the harness repo, with `HARNESS_CONFIG` set. It is not in this checkout.
- The gate record has rc 1, although all 93 cases pass.
- The brief names two report paths, `docs/reports/jh-902635-backlog-c1/report.md` and `docs/harness/reports/jh-902635-backlog-c1/report.md`. I wrote the same content to both.

## RECOMMENDATIONS

1. Director: add `--forceExit` to the jest `file_command` for `repo:huly-platform` in the harness settings. The package's own test script uses it. Without it, the gate records rc 1 for a file that passed.
2. Director: record per-hook timings in the main-health log. That would show whether the red run hit a slow `beforeEach`, `afterEach` or the test body.
3. Product, outside this card: the background index build in `foundations/server/packages/postgres/src/utils.ts` should stop when the pool closes. Right now it keeps Jest alive and prints warnings after the tests end.
4. Director: check the filed card text. The "vitest" label and the "Rerun alone: also red" claim do not match the logs I could read.
