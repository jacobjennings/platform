#!/usr/bin/env bash
set -euo pipefail
export CUDA_VISIBLE_DEVICES=
export PUPPETEER_SKIP_DOWNLOAD=1
folder=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$folder/../.." && pwd)
cd "$repo"
node_bin=${BOARD_LOAD_NODE:-node}
node_bin=$(command -v "$node_bin")
export PATH="$(dirname "$node_bin"):$PATH"
snapshot=${BOARD_LOAD_SNAPSHOT:-"$HOME/.local/state/jake-harness/huly-snapshot"}
test -f "$snapshot/cockroach-backup.tar"
test -f "$snapshot/minio-files.tar"
mkdir -p "$folder/state" "$folder/results"
run_state=$(mktemp -d "$folder/state/run.XXXXXX")
run_results=$(mktemp -d "$folder/results/run.XXXXXX")
export PROFILE_STATE=$run_state
export PROFILE_RESULTS=$run_results
project="board-load-$(basename "$run_state" | tr '[:upper:].' '[:lower:]-')"
compose=(docker compose -p "$project" -f "$folder/compose.yaml")
ids="$run_state/container-ids"
: > "$ids"
cleanup() {
  result=$?
  trap - EXIT INT TERM
  # Restore the bundle this invocation instrumented, including on failure.
  if test -f "$run_state/bundle-before-sql.js"; then
    if ! cp "$run_state/bundle-before-sql.js" "$repo/pods/server/bundle/bundle.js"; then
      printf 'Failed to restore the pre-diagnostic bundle\n' >&2
      result=1
    fi
  fi
  # Only resources explicitly recorded for this invocation are touched.
  while IFS= read -r cid; do
    test -n "$cid" || continue
    if [[ "$cid" == "${runner:-}" ]]; then continue; fi
    docker logs "$cid" > "$run_results/container-$cid.log" 2>&1 || true
    docker stop --time 30 "$cid" >/dev/null 2>&1 || true
    docker rm -v "$cid" >/dev/null 2>&1 || true
  done < <(sort -u "$ids")
  if test -n "${runner:-}"; then
    docker exec --user 0 "$runner" chown -R "$(id -u):$(id -g)" "$runner_results" "$runner_state" >/dev/null 2>&1 || true
    docker stop --time 30 "$runner" >/dev/null 2>&1 || true
    docker rm -v "$runner" >/dev/null 2>&1 || true
  fi
  if test -s "$run_state/network-id"; then docker network rm "$(cat "$run_state/network-id")" >/dev/null 2>&1 || true; fi
  printf 'Local state: %s\nResults: %s\n' "$run_state" "$run_results"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
if ! test -d common/temp/node_modules; then timeout 1200 "$node_bin" common/scripts/install-run-rush.js install > "$run_results/install.log" 2>&1; fi
timeout 1200 "$node_bin" common/scripts/install-run-rush.js build --to @hcengineering/pod-server --to @hcengineering/pod-account --to @hcengineering/pod-collaborator --to @hcengineering/api-client --parallelism 8 > "$run_results/build.log" 2>&1
timeout 300 "$node_bin" common/scripts/install-run-rush.js bundle --to @hcengineering/pod-server --to @hcengineering/pod-account --to @hcengineering/pod-collaborator --parallelism 8 > "$run_results/bundle.log" 2>&1
"$node_bin" "$folder/prepare-secrets.cjs" "$run_state"
mkdir -p "$run_state/extern"
tar -xf "$snapshot/cockroach-backup.tar" -C "$run_state/extern"
tar -xf "$snapshot/minio-files.tar" -C "$run_state"
# MinIO images and prebuilt release binaries are no longer available on the
# registries used by this fixture. Build the pinned source with the local Go toolchain.
if ! docker image inspect jh-902455-minio:local >/dev/null 2>&1; then
  mkdir -p "$run_state/minio-src" "$run_state/minio-image"
  curl -fL --max-time 120 -o "$run_state/minio-source.tar.gz" https://codeload.github.com/minio/minio/tar.gz/refs/tags/RELEASE.2025-04-22T22-12-26Z > "$run_results/minio-download.log" 2>&1
  tar -xf "$run_state/minio-source.tar.gz" --strip-components=1 -C "$run_state/minio-src"
  (cd "$run_state/minio-src" && CGO_ENABLED=0 GOMAXPROCS=8 timeout 900 go build -o ../minio-image/minio .) > "$run_results/minio-build.log" 2>&1
  printf 'FROM alpine:3.20\nCOPY minio /usr/bin/minio\nENTRYPOINT ["/usr/bin/minio"]\n' > "$run_state/minio-image/Dockerfile"
  docker build -t jh-902455-minio:local "$run_state/minio-image" > "$run_results/minio-image.log" 2>&1
fi
# Record even partially created resources if Compose fails.
if ! "${compose[@]}" up -d db queue > "$run_results/infra.log" 2>&1; then
  "${compose[@]}" ps -aq >> "$ids"
  docker network inspect "${project}_default" --format '{{.Id}}' > "$run_state/network-id" 2>/dev/null || true
  exit 1
fi
"${compose[@]}" ps -aq >> "$ids"
docker network inspect "${project}_default" --format '{{.Id}}' > "$run_state/network-id"
db=$("${compose[@]}" ps -q db)
for attempt in $(seq 1 30); do
  if docker exec "$db" ./cockroach sql --insecure -e 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
# Discover the backup collection name from the supplied archive.
collection=$(tar -tf "$snapshot/cockroach-backup.tar" | sed -n '1s|/.*||p')
[[ "$collection" =~ ^[a-zA-Z0-9_-]+$ ]]
docker exec "$db" ./cockroach sql --insecure -e "RESTORE DATABASE defaultdb FROM LATEST IN 'nodelocal://1/$collection' WITH new_db_name = 'profile'" > "$run_results/restore.log" 2>&1
runner_state="/repo/${run_state#"$repo/"}"
runner_results="/repo/${run_results#"$repo/"}"
runner=$(docker create --runtime runc --network "${project}_default" -e CUDA_VISIBLE_DEVICES= -e BOARD_LOAD_RUNNER=1 -e "BOARD_LOAD_STATE=$runner_state" -e "BOARD_LOAD_RESULTS=$runner_results" -v "$repo:/repo" -w /repo --entrypoint /bin/sh hardcoreeng/transactor:v0.7.426 -c 'sleep 14400')
printf '%s\n' "$runner" >> "$ids"
docker start "$runner" >/dev/null
exec_node() { local script=$1; shift; docker exec -e BOARD_LOAD_MOVER -e BOARD_LOAD_ITERATIONS "$runner" node "/repo/dev/board-load/$script" "$@"; }
exec_node inspect-fixture.cjs > "$run_results/fixture-scale.log" 2>&1
exec_node seed-accounts.cjs > "$run_results/accounts.log" 2>&1
exec_node grant-fixture.cjs > "$run_results/grant.log" 2>&1
exec_node prepare-migration.cjs > "$run_results/migration-setup.log" 2>&1
if ! "${compose[@]}" up -d account transactor collaborator config files > "$run_results/services.log" 2>&1; then
  "${compose[@]}" ps -aq >> "$ids"
  docker network inspect "${project}_default" --format '{{.Id}}' > "$run_state/network-id" 2>/dev/null || true
  exit 1
fi
"${compose[@]}" ps -aq >> "$ids"
# Service readiness uses only the local config endpoint and account TCP port.
docker exec "$runner" node /repo/dev/board-load/wait-ready.cjs
# MEASUREMENT-ONLY (reverted after this run): wait for the workspace attach that
# creates the schema indexes, which otherwise exceeds the smoke connect timeout.
printf 'attach wait start %s\n' "$(date -u +%H:%M:%S)"
previous=-1
stable=0
for attempt in $(seq 1 300); do
  count=$(docker exec "$db" ./cockroach sql --insecure -d profile --format=tsv -e "SELECT count(*) FROM information_schema.statistics WHERE table_schema = 'public' AND index_name NOT LIKE '%_pkey'" 2>/dev/null | tail -1 | tr -d '[:space:]')
  if [ "$count" = "$previous" ] && [ "${count:-0}" -ge 60 ]; then
    stable=$((stable + 1))
  else
    stable=0
  fi
  if [ "$stable" -ge 3 ]; then
    printf 'attach indexes stable at %s count %s %s\n' "$count" "$(date -u +%H:%M:%S)" "$(date -u +%H:%M:%S)"
    break
  fi
  previous=$count
  sleep 5
done
exec_node 'worker.cjs' '{"mode":"smoke"}' > "$run_results/smoke.log" 2>&1
for scenario in ${BOARD_LOAD_SCENARIOS:-baseline stall-shared stall-separate stall-raised shared mixed pages50 pages1000}; do
  rate_limit=1500
  if [[ "$scenario" == stall-raised ]]; then rate_limit=1000000; fi
  PROFILE_RATE_LIMIT_MAX=$rate_limit "${compose[@]}" up -d --no-deps --force-recreate transactor > "$run_results/reset-$scenario.log" 2>&1
  "${compose[@]}" ps -aq >> "$ids"
  docker exec "$runner" node /repo/dev/board-load/wait-ready.cjs
  printf 'Running %s\n' "$scenario"
  exec_node driver.cjs "$scenario" > "$run_results/$scenario-progress.log" 2>&1
  sleep 31
done
exec_node sql-diagnostics.cjs > "$run_results/sql-statistics.log" 2>&1
cp "$run_results/statement-statistics.json" "$run_results/statement-statistics-before-diagnostic.json"
cp "$repo/pods/server/bundle/bundle.js" "$run_state/bundle-before-sql.js"
"$node_bin" "$folder/patch-sql-profile.cjs"
PROFILE_SQL=true "${compose[@]}" up -d --no-deps transactor > "$run_results/sql-service.log" 2>&1
"${compose[@]}" ps -aq >> "$ids"
docker exec "$runner" node /repo/dev/board-load/wait-ready.cjs
exec_node driver.cjs diagnostic > "$run_results/diagnostic-progress.log" 2>&1
exec_node sql-diagnostics.cjs > "$run_results/sql-plans.log" 2>&1
# Flush the last per-phase inspector profile before shutting down the source transactor.
result_files=()
for scenario in ${BOARD_LOAD_SCENARIOS:-baseline stall-shared stall-separate stall-raised shared mixed pages50 pages1000}; do result_files+=("$scenario.jsonl"); done
exec_node summarize.cjs "${result_files[@]}" | tee "$run_results/table.md"
printf '%s\n' "$run_results" > "$folder/latest-results.local"
