# Record JH-902570 tests.full_suite on 745f96d3

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902570

- Parent branch: `origin/jj/activity-feed` at `745f96d311a2a3caa7adf717e80066c33665e8e6`
- Run branch: `codex/jh-902570-backlog-c1`
- Tip tested and pushed: `ffd94af3570ce77d65f19ae395671e02a62979d6`
- Base check: `git merge-base --is-ancestor 745f96d311a2... HEAD` exited 0, so the parent tip is in this branch. No merge was needed at the start. The branch was already at the parent tip.
- No contact with `huly.lan`. Every test ran with `HULY_BOARD_CONFIG` at the offline port 9 and `VIKUNJA_BASE_URL=http://127.0.0.1:9`.

## What the card said, checked against the tree

The card names nine jest files across the fork. All nine exist at these paths on `745f96d3`:

- `server/account/src/__tests__/postgres-real.test.ts`
- `services/telegram-bot/pod-telegram-bot/src/__tests__/postgres-real.test.ts`
- `plugins/calendar/src/__tests__/utils.test.ts`
- `foundations/server/packages/elastic/src/__tests__/adapter.test.ts`
- `foundations/server/packages/kafka/src/__test__/queue.spec.ts`
- `pods/fulltext/src/__tests__/indexing.spec.ts`
- `pods/server/src/__tests__/compression.spec.ts`
- `foundations/server/packages/postgres/src/__tests__/storage.test.ts`
- `foundations/server/packages/postgres/src/__tests__/integration.test.ts`
- `foundations/core/packages/core/src/__tests__/time.test.ts`

The JH-902563 merge that the card points at changed only `foundations/server/packages/postgres/src/schemas.ts`, `foundations/server/packages/postgres/src/utils.ts` and report files. It did not touch any of these tests. Main and the card do not disagree about the failing files.

## Cause

There were three separate causes. Two are test portability defects in the repository. The third is the harness full-suite command running without the preparation that the repository's CI does.

### 1. Host timezone, in `@hcengineering/core` and `@hcengineering/calendar`

The main-health runner starts the suite under `env -i` and does not set `TZ` (`health/main-health-run.py`, `run_suite`). The host timezone is `America/Chicago`. The core time tests compare calendar days in many timezones and the calendar recurrence tests build dates from UTC midnight. Both assume the runner's local day is UTC, as the GitHub Ubuntu runner is.

On the host, `new Date(Date.UTC(2024, 7, 0))` has local day 30, while the tests expect the UTC day 31. That produced 658 failing core tests and 7 failing calendar tests. A direct check with the pinned Node showed `process.env.TZ='UTC'` changes the result from `7/30/2024` to `7/31/2024`.

Fix: pin `process.env.TZ = 'UTC'` in the two package jest configs. The assertions are unchanged and every case still runs.

### 2. Missing model bundle, in `@hcengineering/pod-server`

`compression.spec.ts` reads `./bundle/model.json`. That file is produced by `_phase:bundle` (`rushx bundle`), not by `_phase:build`. `rush test` runs build then test, so the file was absent and the test failed with `ENOENT`. The repository CI runs `rush bundle` before `rush test` (`.github/workflows/main.yml:120-121`), which is why CI never saw this.

Fix: the pod-server `test` and `_phase:test` scripts run `rushx bundle` first. On the test host the bundle takes about 2 seconds after the build phase. The compression assertions are unchanged.

### 3. Services and connection environment, in the integration files

`postgres-real.test.ts`, `storage.test.ts`, `integration.test.ts`, `adapter.test.ts`, `queue.spec.ts` and `indexing.spec.ts` connect to real CockroachDB, PostgreSQL, MongoDB, Redpanda and Elasticsearch. The defaults point at the ports in `tests/docker-compose.yaml` (26258, 5433, 27018, 19093, 9201, with the telegram test using 26257 unless `DB_URL` is set).

The repository CI starts those services with `cd tests && ./prepare-tests.sh` and sets `DB_URL`, `ELASTIC_URL` and `MONGO_URL` before `rush test` (`.github/workflows/main.yml:223-231`). The main-health command is only `node common/scripts/install-run-rush.js test` (`harness.toml` `[repos.huly-platform] full_suite`, line 808 of the harness settings file, which is not in this repository). With no services listening, every connection was refused. That is not a product-code defect.

I started the repository's own test stack under a private compose project name, `jh902570`, from `tests/docker-compose.yaml` (elastic, mongodb, cockroach, postgres, redpanda). I did not run `tests/prepare-tests.sh`, because it kills and removes the shared `sanity` project. Every named file then passed, including the Mongo package case that crashed the health run without naming a file. I removed the stack afterwards and confirmed no `jh902570` containers remain.

## Files changed

- `foundations/core/packages/core/jest.config.js:4` adds `process.env.TZ = 'UTC'` with a comment explaining the day comparison.
- `plugins/calendar/jest.config.js:4` adds the same pin for the recurrence tests.
- `pods/server/package.json:28` and `pods/server/package.json:30` make `test` and `_phase:test` run `rushx bundle` before jest.

No product code changed. No assertion was skipped or weakened.

## Tests on the tip

The project has no `[tests] file_command` mapping in the harness settings for `repo:huly-platform`, so `gate/isolated_run.py` fell back to `node --test` for a `.ts` file. That fallback cannot resolve TypeScript imports. The first row of the table below records that refusal on tree `51f4512a`. Every real run after it used the same runner's `--done` mode, which applies the gate isolation (guard git first on PATH, `env -i`, fresh HOME, short TMPDIR, pinned Node) to a jest command. The counts below are copied from each run's jest summary in its gate log, not typed by hand.

Table from `python3 /home/jakej/gh/jake-harness/gate/isolated_run.py --table docs/reports/jh-902570-backlog-c1/gate-results.jsonl`:

| File | Tree | rc | Ran | Failures | Errors | Skipped | Excluded | Seconds | Jobs | Batch seconds |
|---|---|---|---|---|---|---|---|---|---|---|
| foundations/core/packages/core/src/__tests__/time.test.ts | 51f4512a | 1 | 1 | 1 | 0 | 0 | None | 0 | 8 | 0 |
| foundations/core/packages/core/src/__tests__/time.test.ts | 51f4512a | 0 | None | None | None | None | None | 1 | - | - |
| plugins/calendar/src/__tests__/utils.test.ts | 51f4512a | 0 | None | None | None | None | None | 1 | - | - |
| pods/server/src/__tests__/compression.spec.ts | 51f4512a | 0 | None | None | None | None | None | 8 | - | - |
| foundations/server/packages/elastic/src/__tests__/adapter.test.ts | 51f4512a | 0 | None | None | None | None | None | 1 | - | - |
| foundations/server/packages/kafka/src/__test__/queue.spec.ts | 51f4512a | 0 | None | None | None | None | None | 3 | - | - |
| pods/fulltext/src/__tests__/indexing.spec.ts | 51f4512a | 0 | None | None | None | None | None | 38 | - | - |
| foundations/server/packages/postgres/src/__tests__/storage.test.ts | 51f4512a | 0 | None | None | None | None | None | 4 | - | - |
| foundations/server/packages/postgres/src/__tests__/integration.test.ts | 51f4512a | 0 | None | None | None | None | None | 68 | - | - |
| server/account/src/__tests__/postgres-real.test.ts | 51f4512a | 0 | None | None | None | None | None | 25 | - | - |
| services/telegram-bot/pod-telegram-bot/src/__tests__/postgres-real.test.ts | 51f4512a | 0 | None | None | None | None | None | 6 | - | - |
| foundations/server/packages/mongo/src/__tests__/storage.test.ts | 51f4512a | 0 | None | None | None | None | None | 3 | - | - |

Jest counts from those gate logs, on tip `ffd94af3570ce77d65f19ae395671e02a62979d6`:

| File | rc | Jest summary from gate log |
|---|---|---|
| foundations/core/packages/core/src/__tests__/time.test.ts | 0 | Tests:       662 passed, 662 total |
| plugins/calendar/src/__tests__/utils.test.ts | 0 | Tests:       13 passed, 13 total |
| pods/server/src/__tests__/compression.spec.ts | 0 | Tests:       5 passed, 5 total |
| foundations/server/packages/elastic/src/__tests__/adapter.test.ts | 0 | Tests:       3 passed, 3 total |
| foundations/server/packages/kafka/src/__test__/queue.spec.ts | 0 | Tests:       2 passed, 2 total |
| pods/fulltext/src/__tests__/indexing.spec.ts | 0 | Tests:       3 passed, 3 total |
| foundations/server/packages/postgres/src/__tests__/storage.test.ts | 0 | Tests:       8 passed, 8 total |
| foundations/server/packages/postgres/src/__tests__/integration.test.ts | 0 | Tests:       93 passed, 93 total |
| server/account/src/__tests__/postgres-real.test.ts | 0 | Tests:       4 passed, 4 total |
| services/telegram-bot/pod-telegram-bot/src/__tests__/postgres-real.test.ts | 0 | Tests:       16 passed, 16 total |
| foundations/server/packages/mongo/src/__tests__/storage.test.ts | 0 | Tests:       31 passed, 31 total |

The compression row is one jest run of two files, `compression.spec.ts` and `server.test.ts`, because the package script change covers both. The failed first row is the unmodified gate path, kept here so the harness gap is visible. It is not a test result.

## What is still red and why

The card's acceptance is a green `tests.full_suite`. That unit is the bare command `node common/scripts/install-run-rush.js test` under `env -i`. With no database, Kafka or Elasticsearch listening and no `DB_URL`, `ELASTIC_URL` or `MONGO_URL`, that command still fails the integration files on this host. The repository cannot start those services from `rush test` without changing every package's test script or adding a root-level hook. I did not do that, because it would change shared upstream files for a harness provisioning gap, and problems with the harness belong to the Director.

The repository's own CI command is green by construction, and every named card case passes on this tip when the stack and environment from `.github/workflows/main.yml` are present.

## RECOMMENDATIONS

1. Director or owner: change `[repos.huly-platform] full_suite` in the harness settings to prepare the suite the way the repository CI does. It needs `cd tests && ./prepare-tests.sh`, then `node common/scripts/install-run-rush.js bundle`, then `node common/scripts/install-run-rush.js test`, with `DB_URL=postgresql://root@localhost:26258/defaultdb?sslmode=disable`, `ELASTIC_URL=http://localhost:9201` and `MONGO_URL=mongodb://localhost:27018`. Note that `prepare-tests.sh` runs `docker compose -p sanity kill` and `down --volumes`, so it will remove any other `sanity` compose project on the host. A non-destructive variant should use its own compose project name.
2. Director: add a `[[repos.huly-platform.tests.runners]]` entry for jest so `gate/isolated_run.py` and the merge gate do not fall back to `node --test` on TypeScript files. The refusal is in `docs/reports/jh-902570-backlog-c1/gate-run-logs/51f4512a-...-time.test.ts.log`.
3. Director: consider passing `TZ=UTC` in the main-health child environment as a second line of defence. The jest config pins in this change already make these two packages independent of the host timezone.

Review: not yet run.
