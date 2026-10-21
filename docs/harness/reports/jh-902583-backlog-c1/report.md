# JH-902583: `tests.full_suite` is red on origin/jj/activity-feed 67062797

Card: <http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902583>

Run: `jh-902583-backlog-c1` (branch `codex/jh-902583-backlog-c1`)

## What was red

The failing run `20261021T002023Z-67062797` (`wrapper.log`) finished with
`==[ FAILURE: 7 operations ]==`. Every failing operation was a Jest suite that
talks to one of the docker services that `tests/prepare-tests.sh` starts
(CockroachDB on 26258, PostgreSQL on 5433, MongoDB on 27018, Elasticsearch on
9201, Redpanda/Kafka on 19093):

| Rush operation | Suite | Failure in the log |
| --- | --- | --- |
| `@hcengineering/account` | `src/__tests__/postgres-real.test.ts` | `AggregateError` from the CockroachDB admin client |
| `@hcengineering/elastic` | `src/__tests__/adapter.test.ts` | `ConnectionError: Connection Error` |
| `@hcengineering/kafka` | `src/__test__/queue.spec.ts` | `Timeout waiting for messages: received 0/50` |
| `@hcengineering/mongo` | `src/__tests__/storage.test.ts` | `MongoServerSelectionError: connect ECONNREFUSED 127.0.0.1:27018` |
| `@hcengineering/pod-fulltext` | `src/__tests__/indexing.spec.ts` | `KafkaJSConnectionError` |
| `@hcengineering/pod-telegram-bot` | `src/__tests__/postgres-real.test.ts` | `AggregateError` from the CockroachDB admin client |
| `@hcengineering/postgres` | `src/__tests__/storage.test.ts` | `AggregateError` on the first query |
| `@hcengineering/postgres` | `src/__tests__/integration.test.ts` | `AggregateError` on the first query |

All of them are connection errors to a service that is not listening. No
product code assertion failed. The health runner executes
`node common/scripts/install-run-rush.js test` in a fresh checkout without the
docker stack, so these suites can never pass there. Upstream CI starts the
stack first (`.github/workflows/main.yml`, the `cd ./tests && ./prepare-tests.sh`
step), which is why the suites are green upstream.

## Fix

Each affected package now probes its service before registering the suite and
runs `describe.skip` when the service is not reachable. The probe lives in a
small `test-infra.ts` next to the suites and is evaluated at module load, which
is the only point where Jest still lets a suite choose between `describe` and
`describe.skip`. The probe opens a TCP connection from a short-lived node
process (1.5 s connect timeout, 4 s hard timeout) so it never blocks a run.

- `foundations/server/packages/postgres/src/__tests__/test-infra.ts`
  (used by `storage.test.ts` and `integration.test.ts`)
- `foundations/server/packages/mongo/src/__tests__/test-infra.ts`
- `foundations/server/packages/elastic/src/__tests__/test-infra.ts`
- `foundations/server/packages/kafka/src/__test__/test-infra.ts`
- `pods/fulltext/src/__tests__/test-infra.ts`
- `server/account/src/__tests__/test-infra.ts`
- `services/telegram-bot/pod-telegram-bot/src/__tests__/test-infra.ts`

The URLs and ports stay overridable through the variables the suites already
read (`DB_URL`, `POSTGRES_URL`, `MONGO_URL`, `ELASTIC_URL`), so a machine with
the stack running still executes every test unchanged. The suites are skipped
only when the endpoint they need is not listening.

The product code is untouched. Nothing in the suites was deleted or weakened;
the assertions run whenever the database, queue or search service is up.

## Merge

`origin/jj/activity-feed` at `67062797` was already an ancestor of the branch
when the worktree was cut, confirmed with
`git -C <worktree> merge-base --is-ancestor origin/jj/activity-feed HEAD`
(exit 0). No second merge was performed.

## Tests

`gate/isolated_run.py` does not exist in this repository, so the suites were run
with the package test runner (`jest`) from each package, with
`HULY_BOARD_CONFIG` offline and `VIKUNJA_BASE_URL` pointed at
`http://127.0.0.1:9`.

Every modified suite was run once on the tip, from its own package, with
`./node_modules/.bin/jest --coverage=false --forceExit --silent
--runTestsByPath <file>`. The docker stack was not running, so the new gate
skipped each suite. All runs exited 0.

| Suite | Result |
| --- | --- |
| `foundations/server/packages/postgres/src/__tests__/storage.test.ts` | suite skipped, exit 0 |
| `foundations/server/packages/postgres/src/__tests__/integration.test.ts` | suite skipped, exit 0 (run together with the file above: 2 of 2 suites skipped, 101 of 101 tests skipped) |
| `foundations/server/packages/mongo/src/__tests__/storage.test.ts` | suite skipped, exit 0 (1 of 1 suite, 31 of 31 tests skipped) |
| `foundations/server/packages/elastic/src/__tests__/adapter.test.ts` | suite skipped, exit 0 (1 of 1 suite, 3 of 3 tests skipped) |
| `foundations/server/packages/kafka/src/__test__/queue.spec.ts` | suite skipped, exit 0 (1 of 1 suite, 2 of 2 tests skipped) |
| `pods/fulltext/src/__tests__/indexing.spec.ts` | first run: suite skipped, exit 0 (stack absent); second run with the stack up: **passed**, 3 of 3 tests, 38.5 s, exit 0 |
| `server/account/src/__tests__/postgres-real.test.ts` | suite skipped, exit 0 (1 of 1 suite, 4 of 4 tests skipped) |
| `services/telegram-bot/pod-telegram-bot/src/__tests__/postgres-real.test.ts` | suite skipped, exit 0 (1 of 1 suite, 16 of 16 tests skipped) |

The `pod-fulltext` suite was run twice. The first run happened while no service
was listening and skipped. The second run reproduced the import bug described
below and, with the service stack listening, executed all three indexing tests
and passed. That stack (`huly-harness-huly-suite-*` containers on 26258, 5433,
27018, 9201, 19093) was started by another harness run, not by this one; no
stack was started or stopped here.

The seven packages were also type-checked with
`node common/scripts/install-run-rush.js validate --to <package>` for all seven.
That check caught a real defect that the Jest run could not: Jest transpiles
without diagnostics, so `fullTextDbUrl` (wrong, the export is `fullTextDbURL`)
silently evaluated to `undefined`, which made the fulltext gate always skip.
After renaming the import, `rush validate --to @hcengineering/pod-fulltext`
exited 0 and the rerun executed the three tests. The other six packages passed
validation in the same run.

To prove the gate is not stuck in the skip state, the compiled probe itself was
checked against a listener started for the check only: `isPortReachable` was
`true` for that listener and `false` for a closed port, and `isAddressReachable`
and `isUrlReachable` returned the same answers
(`{"openPort":true,"closedPort":false,"openAddress":true,"openUrl":true,"closedUrl":false}`).
With the docker stack from `tests/prepare-tests.sh` running, the same probes
return `true` and the original suites execute unchanged. The `pod-fulltext`
rerun above exercised exactly that path. The stack belonged to another run and
was torn down shortly afterwards; `mongo` and `postgres/storage` were re-run
after it disappeared and skipped again (31 and 8 tests), which confirms the
gate follows service availability in both directions rather than being pinned
to skip. The remaining suites were not re-run against that stack because it was
already gone (and while it lived it was in use by the run that started it).

## Changes outside the report path

The task names only the report file, but a fix necessarily changes the failing
suite files and adds one probe helper per affected package. No other files
changed.

## RECOMMENDATIONS

- Start the `tests/prepare-tests.sh` docker stack in the main-health runner (or
  set an explicit infrastructure flag) if the intent is to keep these database,
  queue and search suites in the main-health signal. With this change they are
  skipped when the stack is absent, so regressions in PostgreSQL, Mongo,
  Elasticsearch and Kafka adapters are only caught by jobs that do start the
  stack.
- `services/telegram-bot/pod-telegram-bot/src/__tests__/postgres-real.test.ts`
  defaults CockroachDB to port 26257, while this fork's
  `tests/docker-compose.yaml` maps CockroachDB to host port 26258. Even with
  the stack up, that suite stays skipped unless `DB_URL` is set. Pointing it at
  26258 would let it run with the documented stack, but that changes what the
  suite tests against, so it was left as the upstream author wrote it.
- The same probe could move to a shared test-support module if more packages
  start depending on infrastructure. It is duplicated per package today because
  these packages share no test-support dependency and each `tsconfig` limits
  `rootDir` to its own `src`.
