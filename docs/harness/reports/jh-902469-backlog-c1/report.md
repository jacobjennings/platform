# JH-902469: rate budget comparison on the board load rig

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902469
Parent finding: JH-902458 (independent rate budgets per harness client), merged
in jake-harness at `b6f0fe9851`. Its review said the shared-account,
separate-account and raised-limit comparison was not run.

Status: measurement in progress. This file is updated as the run finishes.

## Run facts

- Worktree branch: `codex/jh-902469-backlog-c1`, base `45533155e` (`jj/activity-feed`).
- The rig from JH-902455 is in the base. Its tip `8deb9d1b2` is an ancestor of
  `45533155e`, merged through `ef85b1ae4`.
- Rig: `dev/board-load/run.sh`, unchanged. Only the scenario list was set.
- Scenarios run: `stall-shared`, `stall-raised`, `stall-separate`, `mixed`, `shared`.
- Node: `v22.23.3` from `~/.local/opt/node-v22.23.3-linux-x64/bin/node`. The
  default `node` is `v26.10.0`, and `rush.json` allows only `>=20.0.0 <25.0.0`.
- Docker runtime: `runc`. No device requests. `CUDA_VISIBLE_DEVICES` was empty.
- Raw results and fixture state stay in the ignored folders
  `dev/board-load/results/` and `dev/board-load/state/`. They are not committed.

## Deviations from the card

- **`origin/main` was not merged.** The merge (`e6da170c3`) was made as the card
  asked. The push guard refused it. The range `origin/jj/activity-feed..HEAD`
  included upstream commits from other authors, and `commit-identity-check.py`
  exited 100. The merge was dropped before any push with
  `git reset --hard 45533155e`. Nothing was pushed from it. The rig does not
  depend on `main`, so the comparison ran on the base. Resolving this needs the
  owner or the Director. Do not rewrite the identities of those commits.
- **The wave log folder is read-only** from this run's shell. Logs are in
  `/tmp/jake-harness-workers/opiWS8lJ/`.
- **Report path.** The card lists `docs/reports/...` under Files and
  `docs/harness/reports/...` under Finishing. This report is at the Finishing
  path, which matches the JH-902455 report location.
- **Account selector not exercised.** See the selector section below.

## RECOMMENDATIONS

To be completed after the measurement.
