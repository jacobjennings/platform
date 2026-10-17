# HP-900001: remove jjpc worker routes from the fork harness.toml

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/HP-900001 (priority HIGH)
Base: origin/jj/activity-feed tip 8cce4e86f7 (the fork has no main branch)
Branch: codex/hp-900001-backlog-c2
Reference for routes: jake-harness origin/main 5c5d5d9fde (pinned harness is d765b05b0e)

## Summary

- `harness.toml` no longer names a jjpc model in any worker, filler, overflow,
  analysis or default route. `alert_instance = "jjpc"` is unchanged, as the card asks.
- Non-review work routes to Haiku through `[provider_worker]`. Reviews and merges stay on
  `gpt-6.1-sol` at low effort.
- Filler is off (`filler_routes = []`).
- The route lists in `docs/harness/worker-model-policy.md` and the side-job section of
  `docs/harness/worker-guide.md` are replaced with pointers to `harness.toml`.
- The pinned loader accepts the file. The card's test passes (10 tests).
- The required checks did not run through the gate. The gate refused (see Gate). The four
  required-check scripts pass when run directly in the pin, which does not test this fork.

## Commits

- `ab6e1747f` Route fork workers to jake-harness routes and turn filler off
- `457717f7d` Add spark preparation route to fleet card_preparation
- `aaf836b86` Point harness route docs at harness.toml
- this commit: this report

## Step 1: gh auth status

```
gh auth status
```

Exit 1. Result: `Logged in to github.com account jacobjennings (GH_TOKEN)`, active account
true, scopes gist, read:org and repo. The default account reports `The token in default is
invalid`. Nothing was changed. The token value is not recorded here.

## Acceptance 1: worker routing matches jake-harness origin/main

Lines quoted from jake-harness origin/main `harness.toml`:

- line 75: `claude_permitted_models = "claude-haiku-5-5"`
- line 98: `anthropic_model = "anthropic/claude-haiku-5-5"`
- line 746: `model = "anthropic/claude-haiku-5-5"` (`[provider_worker.primary]`)
- line 754: `model = "claude-haiku-5-5"` (`[provider_worker.fallback]`)
- line 109: `review = { launcher = "opus", model = "gpt-6.1-sol", effort = "low", ... }`
- line 110: `merge = { launcher = "native", model = "gpt-6.1-sol", effort = "low", ... }`
- line 605: `review_model = "gpt-6.1-sol"`, line 606: `review_effort = "low"`

Fork changes, each matched to origin/main:

| Fork key (base line) | Base value | New value | origin/main line |
| :--- | :--- | :--- | :--- |
| `[orchestrator] default_preset` (159) | `jjpc/qwen3.8-27b` | `spark/qwen3.8-flash-next` | 594 `default_preset = "spark/qwen3.8-flash-next"` |
| `[orchestrator] routes_moderate` (169) | jjpc, spark, bb | key removed, follows `tiers.moderate` | none. origin/main sets no `routes_moderate` |
| `[fleet] tiers` (206) | moderate jjpc+spark, small bb+jjpc+spark | moderate spark, small bb+spark | 706 `tiers = { hard = ["spark/qwen3.8-flash-next"], moderate = ["spark/qwen3.8-flash-next"], small = ["bb/qwen3.8-27b-awq", "spark/qwen3.8-flash-next"] }` |
| `[fleet] forbidden_tier_routes` (absent) | none | bb forbidden for hard and moderate | 707 `forbidden_tier_routes = { hard = ["bb/qwen3.8-27b-awq"], moderate = ["bb/qwen3.8-27b-awq"] }` |
| `[fleet] filler_routes` (209) | spark, jjpc, bb | `[]` | none. origin/main has no filler keys |
| `[fleet.card_preparation] routes` (absent) | none | spark | 719 `routes = ["spark/qwen3.8-flash-next"]` |
| `[overflow] local_routes` (236) | spark, jjpc | spark | 730 `local_routes = ["spark/qwen3.8-flash-next"]` |
| `[launch_policy.opencode] opencode_worker_default_preset` (253) | jjpc | spark | 79 `opencode_worker_default_preset = "spark/qwen3.8-flash-next"` |
| `[launch_policy.opencode] opencode_local_routes` (264) | jjpc, spark, bb | spark, bb | 90 `opencode_local_routes = "spark/qwen3.8-flash-next,bb/qwen3.8-27b-awq"` |
| `[launch_policy.automatic_routes] analysis` (282) | jjpc | spark | 108 `analysis = { launcher = "opencode", model = "spark/qwen3.8-flash-next", effort = "default" }` |
| `[provider_worker]` (absent) | inherited from the pinned shared harness.toml | added, same values as origin/main | 740-754 |
| `policy_file` in `[supervision]` (104) and `[orchestrator]` (179) | `docs/harness/worker-model-policy.md` | `harness.toml` | 392 `policy_file = "harness.toml"` |

Where the fork needed a value jake-harness does not have, I used the jake-harness default
or the form the pinned loader accepts:

- `routes_moderate` is not in origin/main. The key is removed, so the loader derives it from
  `tiers.moderate` (`orch_config.py` `_moderate_routes`).
- `filler_routes` is not in origin/main. The pinned reader requires the key and allows it
  to be empty (`fleet/fleet_settings.py` line 571). `filler_time_limits` stays because the
  reader requires a `default` entry.
- `[fleet.card_preparation] routes` is required by the pinned loader even while
  `enabled = false`. The loader raised `SettingsError: fleet.card_preparation.routes is not
  set` until the key was added.

Already matching in the base, unchanged: `claude_permitted_models` (haiku), `anthropic_model`
(haiku), `review`/`merge` automatic routes (sol low), `review_model`, `merge_preset = "none"`.

Open design point: origin/main still sends the local tiers, the default preset and analysis
to Spark. Haiku takes every board priority through `[provider_worker]`. Jake's 16 October
ruling reads "All work goes to haiku regardless of size", which would also move the local
tier routes to Haiku. I followed origin/main, as the card asks. See RECOMMENDATIONS.

## Acceptance 2: filler off

`filler_routes = []` in `[fleet]`. The pinned reader `fleet_settings.load` returns
`fleet.filler_routes = []`.

## Acceptance 3: routes live only in harness.toml

Changed:

- `docs/harness/worker-model-policy.md` is rewritten. The role table and the Sol overflow
  text no longer name a model route. The `automatic-role-routes` JSON block and the
  `ACTIVE OPENCODE`, `ACTIVE CLAUDE` and `ACTIVE ANTHROPIC` blocks are removed. They held
  the only route copies in that file, and the pinned readers now read `harness.toml`
  (see below). Owner rulings are kept with their quotes. Escalation guidance is added: a
  stronger model needs one-off owner approval.
- `docs/harness/worker-guide.md`: the side-job bullets name no route. A new "Routes and
  escalation" section points at `harness.toml`.

Outside the brief's Files list: `docs/harness/worker-model-policy.md`. Acceptance 3 and the
card's Files paragraph both name `docs/harness/*.md`, so the change is needed.

Not changed, and why:

- `AGENTS.md` names no route. Line 20 says "Worker routes are in
  `docs/harness/worker-model-policy.md`", which is now only a pointer. I cannot edit
  `AGENTS.md` under the worker guide, so this is a recommendation.
- `docs/harness/api-performance.md` line 60 says "from jjpc to huly.lan". That is a host
  name, not a route.
- `docs/harness/worker-guide.md` line 49 says "The RTX 5090 (jjpc)". That is hardware.
- `docs/harness/reports/hp-900000-backlog-c2/report.md` is an earlier report. It is a record,
  so it is not rewritten.

Why `policy_file` changed. The pinned readers pick their source from `policy_file`.
`supervision/worker_routes.py` `read_routes` reads the markdown JSON block when the file is
markdown, and `[launch_policy.automatic_routes]` when it is `.toml`. The pinned checkers read
their tables from `harness.toml`: `check-opencode-launch-policy.py` `read_policy` and
`check-claude-launch-policy.py` `read_policy`. origin/main and the pinned `project-example`
both use `policy_file = "harness.toml"`. The markdown blocks were stale copies, so they
were removed.

Behavior change to know about: `launch/run-opencode-worker.sh` reads
`WORKER_MODEL_POLICY_FILE`, then `HARNESS_POLICY_FILE`. If a manual launch exports
`HARNESS_POLICY_FILE` as the markdown doc, it now finds no active block and refuses. That is
the fail-closed direction. I did not run a live launch to confirm it.

## Acceptance 4: host names unchanged

`alert_instance = "jjpc"` (line 72) is unchanged.

## Acceptance 5: validation

The validation scripts are in `/tmp/huly-platform-workers/opx5mp3S`. They are not committed.
Each command ran under `env -i` with `HOME`, `PATH`, `HARNESS_GUARDED_GIT`,
`HULY_BOARD_CONFIG=http://127.0.0.1:9` and `VIKUNJA_BASE_URL=http://127.0.0.1:9`.

1. Pinned `orch_config.load()` on the fork file:

   ```
   python3 validate-fork-toml.py /home/jakej/gh/huly-platform-worktrees/hp-900001-backlog-c2/harness.toml
   ```

   Result: `orch_config.load: ok`, exit 0. `default_preset = 'spark/qwen3.8-flash-next'`,
   `routes_hard = ['spark/qwen3.8-flash-next']`, `routes_moderate = ['spark/qwen3.8-flash-next']`,
   `small_only_hosts = ['bb']`, `launcher_limit_hosts = ['spark']`, `review_model =
   'gpt-6.1-sol'`, `merge_train_model = 'gpt-6.1-sol'`, `policy_file =` the fork's
   `harness.toml`, overflow `local_routes = ['spark/qwen3.8-flash-next']`. The provider
   selection is `anthropic/claude-haiku-5-5` (primary) and `claude-haiku-5-5` (fallback).
   Only `STATE PATH WARNING` lines about `~/.cache` paths were printed. They come from the
   pinned `lib/state_paths.py`.

2. Pinned fleet reader, route resolver and launch gates on the fork file:

   ```
   python3 validate-fork-gates.py /home/jakej/gh/huly-platform-worktrees/hp-900001-backlog-c2/harness.toml
   ```

   Results:
   - `fleet_settings.load: ok`. `tiers` as above, `forbidden_tier_routes` as above,
     `filler_routes = []`, `filler_time_limits = {'default': '20m', 'spark/': '40m'}`.
   - `resolve_route(analysis)` gives `opencode`, `spark/qwen3.8-flash-next`, `default`.
   - `resolve_route(review)` gives `opus`, `gpt-6.1-sol`, `low`.
   - `resolve_route(merge)` gives `native`, `gpt-6.1-sol`, `low`.
   - `read_local_routes` gives `{spark/qwen3.8-flash-next, bb/qwen3.8-27b-awq}`.
   - `check-opencode-launch-policy.py <fork toml> --print-reviewer-fallback-preset` prints
     `none`, exit 0.
   - `check-opencode-launch-policy.py <fork toml> --role analysis --preset
     spark/qwen3.8-flash-next` exits 0: "local route ... is allowed ... for role 'analysis'".
   - The same command with `--role implementation` exits 0.
   - `check-opencode-launch-policy.py <fork toml> --print-merge-preset` exits 2. The pinned
     `harness.toml` gives the same result (see RECOMMENDATIONS).
   - `check-claude-launch-policy.py <fork toml> --role implementation --model
     claude-haiku-5-5` exits 0.
   - `check-claude-launch-policy.py <fork toml> --role review --model claude-haiku-5-5` exits 1
     as a known refusal: the policy permits only implementation on the Claude route.

The first attempt at step 2 failed on `fleet.card_preparation.routes`. The fix is in
`457717f7d`, and the rerun passed.

## Card's test (after the last code commit, `aaf836b86`)

```
cd /home/jakej/gh/jake-harness-worktrees/huly-platform-pin-d765b05 && env -i HOME=... PATH=... \
  HARNESS_GUARDED_GIT=... HULY_BOARD_CONFIG=http://127.0.0.1:9 VIKUNJA_BASE_URL=http://127.0.0.1:9 \
  python3 orchestrator/check-settings-readers-test.py
```

Result: `Ran 10 tests in 1.676s`, `OK`, exit 0. This file builds its own fixtures and tests the
pinned readers. It does not read the fork file.

## Required checks

### Gate

The gate in the pin is `gate/isolated_run.py`. Its results default to
`$HARNESS_RUN_EVIDENCE/gate-results.jsonl`. Here `HARNESS_RUN_EVIDENCE` was not set, and the
run log directory was read-only:

```
mkdir -p /home/jakej/.cache/huly-platform/waves/hp-900001-backlog-c2/evidence
mkdir: cannot create directory ...: Read-only file system
```

The first gate run was refused before it ran anything:

```
HARNESS_CONFIG=<fork>/harness.toml HARNESS_RUN_EVIDENCE=<evidence dir> \
  python3 gate/isolated_run.py --reason required-check:checks/configured-values-test.py \
  checks/configured-values-test.py
isolated-run: refused: could not verify required-check:checks/configured-values-test.py.
git diff origin/main...HEAD failed: fatal: ambiguous argument 'origin/main...HEAD'
```

No `gate-results.jsonl` was written, so none is copied into this folder.

### Direct runs in the pin

These four scripts check the pinned harness tree. They do not check this fork. Each ran once
with the `env -i` settings above:

| Check | Result |
| :--- | :--- |
| `checks/configured-values-test.py` | `Ran 28 tests`, `OK`, exit 0 |
| `tests/env-values-evidence-scan-test.py` | `Ran 13 tests`, `OK`, exit 0 |
| `checks/home-access-test.py` | `Ran 23 tests`, `OK`, exit 0 |
| `launch/no-project-names-test.py` | `Ran 19 tests`, `OK`, exit 0 |
| `tests/env-values-evidence-scan-test.py` with `JH_SCAN_TARGET` set to the fork | exit 1: `FileNotFoundError` for harness files the fork does not have (for example `cluster/local-subagent-test.py`, `tests/local-launch-fixture.py`). The fork worktree stayed clean. |

I scanned the four scripts for destructive process calls (`kill`, `pkill`, `killall`,
`killpg`, `systemctl`, `tmux kill`). None matched.

## Not run

- The full test suite. Workers must not run it.
- Any live Huly server, deploy, or board write. Nothing touched huly.lan.
- A live worker launch. The routing change is checked by the dry checks above only.

## Observations

- The pinned harness (`d765b05`) is behind origin/main (`5c5d5d9fde`). Its own `harness.toml`
  still names jjpc at line 575 (`default_preset`), line 689 (`tiers`) and line 695
  (`filler_routes`). `fleet_settings.py` falls back to that shared `[fleet]` table when a
  project omits a tier. The fork sets every tier, so the fallback should not be used. I did
  not prove that.
- `check-opencode-launch-policy.py --print-merge-preset` exits 2 for the fork and for the
  pinned `harness.toml`. The checker expects a prose sentence `Merges route to ...` in the
  policy document. No non-test code in the pin calls the flag.
- The `run-opencode-worker.sh` comment still says it reads `docs/worker-model-policy.md`.
- `[fleet] blocking_labels` lists `paused`. The loader warns that it is retired. I did not
  change it, because it is not a route.
- The fork has no `origin/main`, so the gate's `changed-file` and `required-check` reasons
  cannot be verified.
- The run log directory is read-only.

## Changed files

- `harness.toml`
- `docs/harness/worker-model-policy.md` (outside the brief's list, see Acceptance 3)
- `docs/harness/worker-guide.md`
- `docs/harness/reports/hp-900001-backlog-c2/report.md` (this file)

## RECOMMENDATIONS

1. Director: move the pin to origin/main, or fix its own `harness.toml` lines 575, 689 and
   695. The fork's readers can fall back to that table.
2. Owner: decide whether the local tiers, the default preset and analysis move from Spark to
   Haiku. Jake's 16 October ruling points that way. origin/main does not. Recommendation: keep
   origin/main for now, then change the `tiers`, `default_preset` and `analysis` lines together
   in one commit once the owner decides.
3. Director: make `check-opencode-launch-policy.py --print-merge-preset` read `merge_preset`
   from the toml, or confirm it can stay unused. Also fix the stale
   `docs/worker-model-policy.md` comment in `run-opencode-worker.sh`.
4. Owner or Director: point `AGENTS.md` line 20 at `harness.toml`. I could not edit it.
5. Director: decide how the gate should check a fork that has no `origin/main`. Until then,
   required checks can only run directly.
6. Owner: decide whether the side-job section of `worker-guide.md` stays. The global ruling of
   16 October says the lab's models do not serve workers, and the side jobs use local models.
7. Director: check why `/home/jakej/.cache/huly-platform/waves` is read-only, because the run
   log directory cannot be written.
