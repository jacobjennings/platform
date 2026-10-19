# Local board API load test

Run from a fork checkout with Node 20 through 24, Go, curl and Docker available:

```sh
bash dev/board-load/run.sh
```

`BOARD_LOAD_NODE` selects the supported Node executable. Put its directory first
on `PATH` too, because package scripts invoke `node`. `BOARD_LOAD_SNAPSHOT`
selects a local snapshot directory. The default is
`~/.local/state/jake-harness/huly-snapshot/`. The snapshot must contain
`cockroach-backup.tar` and `minio-files.tar`. No production account file is used.

The command installs missing dependencies, builds only the service and client
package dependency closures, creates an isolated CockroachDB stack, restores
the supplied snapshot, generates local accounts, runs the matrix and comparison
loads, prints a Markdown percentile table and stops its recorded container IDs.
It retains private fixture data and raw results in ignored directories. Each run
gets new state and results folders. Container IDs and the network ID are recorded
there. It never tears down a shared Compose project or selects containers by name.

The Compose network is internal. No service port is published. The source-built
account, transactor and collaborator bundles run on the cached matching release
base images. The small config service supplies the API configuration normally
served by the front end. The browser UI, fulltext and optional integrations are
not part of this board workload. All containers explicitly use `runc`, without
device requests. The services and runner have four-hour lifetimes. Each worker
has a twenty-minute deadline and each scenario a ninety-minute deadline.

The first pass uses one shared local account, a fresh native connection per
operation, a 1,500 request budget and a 30 second window. The matrix is 1, 4, 8
and 16 independent processes. Cheap operations and project reads have three
samples per process. Supervision reads and migrations have one per process.
Percentiles use nearest rank. A one-sample percentile is that sample, so this is
an exploratory baseline rather than a statistically precise tail estimate.
The table includes failed attempt durations and an explicit error count.
Operations run in a fixed sequence and share the account budget. There is a
31 second cooldown between concurrency groups and scenarios.

`readProjectTasks` must return every JH fixture card. `readSupervisionBoard`
reads VK8 and checks the snapshot count. No response documents are written into
the measurements. Only counts, elapsed times and profiling metadata are saved.
The markup instrumentation records successful, empty and rejected calls. The
harness itself can return empty descriptions after a failed markup fetch.

The migration setup creates 4,800 local VK8 fixture cards' stage references by
copying the shape of a real stage reference. It sets those cards to queued.
Each measured client migrates a disjoint 300-card slice in the harness's real
25-card batches, including its one-second pauses and final verification read.
The fixture resets before each concurrency group and before the mixed load.
No server behavior is optimized. Direct SQL writes are confined to fixture setup.

The mixed load runs two launcher/sweep pairs every two minutes, two health
checks every minute and one 300-card migration. Its three sweep rounds span at
least four minutes. The rate-limit comparison issues 1,760 real project reads
from sixteen clients, then measures connects, once with a shared account and
once with separate accounts. A persistent-session ping comparison is also saved.

The copied client files remain unchanged. `instrument.cjs` compiles the client
in memory with its configuration reader replaced by explicit local settings and
exports its native connector. It counts the real RPC serializer and fetch calls.
No SSH process or host broker is used. This excludes SSH startup and broker
scheduling from the measured native API latency. A websocket factory rejects
hosts outside the four named fixture services. Model sizes are decoded JSON
bytes and protocol message bytes before websocket transport framing.

`server-hook.cjs` records event loop delay and CPU use each second. It also saves
one inspector CPU profile per phase. The transactor additionally runs with
`--cpu-prof`. Profiles and event loop records are ignored local artifacts.
`patch-sql-profile.cjs` optionally instruments the ignored server bundle for a
separate SQL diagnostic pass. It records the first parameterized SELECT of each
shape. It does not change source or record writes. SQL capture is disabled in
the latency baseline.

To print an existing run again:

```sh
BOARD_LOAD_RESULTS=/absolute/path/to/results node dev/board-load/summarize.cjs baseline.jsonl
```

To tear down an interrupted run, use only the IDs in that run's state folder:

```sh
while IFS= read -r cid; do
  docker stop --time 30 "$cid"
  docker rm "$cid"
done < /absolute/path/to/state/container-ids
docker network rm "$(cat /absolute/path/to/state/network-id)"
```

Raw database snapshots, credentials, logs and profiles must stay local. The
committed report contains aggregate measurements and draft follow-up work.
