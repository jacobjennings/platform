# JH-902469: rate budget comparison on the board load rig

Card: http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902469
Parent finding: JH-902458 (independent rate budgets per harness client), merged
in jake-harness at `b6f0fe9851`. Its review said the shared-account,
separate-account and raised-limit comparison was not run.

Status: the comparison and the attribution check ran on the local rig. The
account selector was not exercised. No product code changed. The `origin/main`
merge was refused by the push guard and is not in this branch. See Deviations.

## Answer in brief

- **Shared budget versus separate accounts.** The same 16-client burst (6,400
  project reads) on one account hit 35,259 rate-limit responses and waited up to
  118 s to connect. On separate accounts it had zero throttling and every connect
  finished in under 0.4 s after the burst.
- **Raised limit.** A local limit of 1,000,000 per window also removed the
  throttling. Its connect times were slower than separate accounts but far
  faster than the shared budget.
- **One migration and a health check.** On one shared account, a 1,000-card
  migration did not starve the health pings. All 24 pings succeeded, and 22 of
  them took 4 ms or less. Heavy sweep reads on the same account did slow down a
  lot. Isolation holds for the light health call only.
- **Membership.** All 17 test identities had workspace membership with the OWNER
  role and were members of all 39 spaces.
- **Audit attribution.** Each of the 17 identities wrote a comment through its
  own connection. Each write was attributed to that identity's own social id.
- **Selector.** The rig does not use the harness board client, so the
  `HULY_BOARD_SERVICE` selector did not run. No code was changed.
- **Production cost.** The steps and ongoing access cost are in the provisioning
  section. Creating the accounts on huly.lan is the owner's step.

## Run facts

- Worktree branch: `codex/jh-902469-backlog-c1`, base `45533155e` (`jj/activity-feed`).
- The rig from JH-902455 is in the base. Its tip `8deb9d1b2` is an ancestor of
  `45533155e`, merged through `ef85b1ae4`.
- Rig: `dev/board-load/run.sh`, unchanged. Only the scenario list was set.
- Run 1 scenarios: `stall-shared`, `stall-raised`, `stall-separate`, `mixed`,
  `shared`. Results folder: `dev/board-load/results/run.oiDjxL` (ignored).
  Run 1 started at 9:11 pm CDT on Oct 19. The `stall-shared` burst began at 9:12 pm.
- Run 2 scenario: `shared`, followed by the per-account comment check. Results
  folder: `dev/board-load/results/run.2SraJl` (ignored). It started at 9:33 pm CDT.
- Node: `v22.23.3` from `~/.local/opt/node-v22.23.3-linux-x64/bin/node`. The
  default `node` is `v26.10.0`, and `rush.json` allows `>=20.0.0 <25.0.0`.
- Docker runtime: `runc`. No device requests. `CUDA_VISIBLE_DEVICES` was empty.
- Not run: the baseline matrix, the `pages50` and `pages1000` cases, and the
  rest of the card's follow-ups. The `diagnostic` pass ran as part of the rig
  but is not reported here.

## Comparison: the same 16-client burst

Each of 16 worker processes sent 400 project reads, then opened a new connection
two seconds after the burst started. Latencies are in milliseconds. Each row
comes from the rig's own counters.

| Metric | Shared account, limit 1,500 per 30 s | Separate accounts, limit 1,500 | Raised limit, 1,000,000 per 30 s |
| --- | ---: | ---: | ---: |
| Workers | 16 | 16 | 16 |
| Connects completed (first, after burst) | 16 of 16, 16 of 16 | 16 of 16, 16 of 16 | 16 of 16, 16 of 16 |
| Connect errors or censored | 0, 0 | 0, 0 | 0, 0 |
| RPC sends, summed over workers | 41,607 | 6,448 | 6,448 |
| Rate-limit responses | 35,259 | 0 | 0 |
| Share of sends throttled | 84.7% | 0% | 0% |
| Client pacing scheduled, summed | 420.8 s | 0 s | 0 s |
| Largest single pacing delay | 5.8 s | 0 s | 0 s |
| Connect after burst, p50 | 28,443.4 | 194.2 | 387.6 |
| Connect after burst, p95 | 118,180.4 | 323.8 | 486.8 |
| Read after burst, p95 | 59,896.7 | 39.9 | 70.5 |
| Whole burst, p95 | 125,838.6 | 2,344.7 | 2,507.7 |
| First connect, p95 | 1,126.1 | 994.8 | 818.5 |
| Operation errors | 0 | 0 | 0 |

Notes on the table:

- No operation failed in any arm. On the shared budget, the client absorbed
  35,259 throttled responses by retrying them. Those retries are the cost of
  the shared budget.
- The separate-account and raised-limit bursts lasted about 2.3 s. The shared
  burst lasted about 2 minutes.
- The shared account was the dedicated account for this burst, not one of the
  16 lane accounts.

### Event loop delay on the transactor

The transactor sampled its event loop once per second. The values below are per
phase. Each phase value is the median or maximum of those per-second p95 readings.

| Phase | Seconds sampled | Median p95 delay (ms) | Max p95 delay (ms) | Max single delay (ms) | Mean CPU utilization |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shared burst | 126 | 10.6 | 41.3 | 258.7 | 6.2% |
| Separate burst | 3 | 30.6 | 114.0 | 160.7 | 39% |
| Raised burst | 3 | 29.9 | 88.2 | 251.1 | 38% |
| Mixed migration | 721 | 10.6 | 14.5 | 107.7 | 10.7% |

The separate and raised phases have only three samples each, because the burst
was short. The event loop was not blocked during the shared burst. Its p95 stayed
under 42 ms. The 118 s connects happened while the server was lightly loaded.
So the delay came from the client pacing and the limiter, not from a busy
server. This run did not isolate which part of the limiter path added the time.

The unthrottled bursts raised event loop delay to about 30 ms at the median.
Throttling kept the shared burst lighter on the server, at the cost of client time.

### Connects and error rate

- Each burst completed 32 connects, 16 before the burst and 16 after it, with
  no failures. That is the same count in all three arms.
- JH-902455 recorded 11 of 16 first connects that never completed on separate
  accounts. In this run all 16 completed. See "Earlier findings" below.

## One migration and a health check

The `mixed` scenario ran five clients on one shared account (`account-0`):

- Two sweep lanes, each reading a project and its board.
- One migration of 1,000 cards in batches of 25.
- Two health lanes, each pinging about once per minute.

Results:

- The migration applied 1,000 of 1,000 cards in 699.5 s. It received 2
  rate-limit responses and sent 7,138 RPCs.
- The two health lanes sent 24 pings during the migration window. All 24
  succeeded. Median 2.5 ms, p95 553.7 ms, max 572.8 ms. The two slowest pings
  were the first two, at the start of the migration (554 ms and 573 ms). The other
  22 took 1 to 4 ms.
- On the same account, sweep reads were much slower. Launcher reads took between
  2.1 s and 53.3 s. Sweep reads took between 0.3 s and 104.3 s. The rig did not
  isolate the cause of the sweep slowdown.

Reading: a migration on a shared budget did not starve a light health call.
Heavy board reads on that budget did slow down. This run only tested the shared
case. A separate health identity was not part of this run, so the isolation
the card asks for is only partly shown.

Run 1's `shared` scenario sent 20 pings on the dedicated shared account.
p50 was 2.2 ms, p95 3.8 ms, max 464.7 ms, with no errors and no throttling.
Run 2 repeated it: p50 2.1 ms, p95 3.8 ms, max 476.4 ms.

## Workspace membership and audit attribution

Both checks ran as read-only SQL on the rig database. The identities were the 17
fixture accounts from the rig's seed step. I found them by their fixture email
domain in the database, not by reading the credential files.

### Membership (run 1)

- 17 of 17 identities have a workspace membership row in the fixture workspace.
  Every one has the role OWNER. The seed step grants OWNER, so this matches
  what was set up.
- 17 of 17 identities are members of all 39 spaces in the workspace. None are
  members of no space.

### Attribution, migration writes (run 1)

- The migration wrote 2,000 transactions in its window: 1,000 `TxUpdateDoc` and
  1,000 `TxRemoveDoc`.
- All 2,000 carry one `modifiedBy` value. That value is a social id of type
  `huly`. Its value equals the `account` field of `account-0.json`. I read only
  that field.
- No other author wrote in the window.

### Attribution, one write per identity (run 2)

- The check opened a separate connection for each of the 17 identities and
  posted one comment through it.
- 17 of 17 comments succeeded.
- Each identity's transaction is attributed to that identity's own social id.
  There are 17 distinct social ids, one transaction each, and no transactions
  from any other author.

Limits of the attribution check:

- Transactions were checked. Activity rows and the chat-message records were not
  checked separately.
- The separate-account burst is read only. Run 2 is the only write check for the
  separate identities.
- The launcher's card assignment uses `HULY_AGENT_ACCOUNT`. That path was not
  tested here.

## Account selector (JH-902458)

The selector is in jake-harness at `b6f0fe9851`:

- `HULY_BOARD_SERVICE` names a file under `[board.accounts_by_service]` in
  `harness.toml`. Unset keeps the single `[board] accounts` file.
- An unknown name refuses before any connection is made.
- The validation is in `lib/harness_config.py` and `board/huly-board.cjs`.

This selector did not run in the rig:

- The rig does not use the harness board client. `dev/board-load/PROVENANCE.md`
  says its vendored `huly-board.cjs` is from jake-harness commit `90545543`.
  That predates the selector.
- The rig gives each lane its own account file directly, in `worker.cjs`.

So the selector's file resolution was not tested. Per the card, code changes are
only for a measured selector failure. None was measured, so no code changed.

## Account provisioning and ongoing cost (for huly.lan)

Nothing was created on huly.lan. The steps below are what the rig did locally,
and what production would need. Each step is the owner's to run.

1. **Create one account per service identity.** Launcher, sweep, health and
   migration. The rig used the account sign-up function with generated `.invalid`
   emails. Production uses the owner's normal account process. Not timed.
2. **Give each identity a workspace role.** The rig gave OWNER to all 17. I did
   not test a lower role. OWNER is broader than a read and write harness should
   need. Test a lower role, such as USER, before the rollout.
3. **Add each identity to every space the harness reads or writes.** The rig did
   this with SQL on 39 spaces, which is 663 grants for 17 identities. Production
   should use the supported membership path. Each new space then needs one grant
   per identity, so four grants for four identities. Whether new spaces inherit
   membership was not checked.
4. **Store one credential file per identity.** Mode `0600`, outside the repo.
   List the files under `[board.accounts_by_service]`. Set `HULY_AGENT_ACCOUNT`
   in each launcher to its identity's own account UUID.
5. **Do not use the raised limit in production from this result.** The raised
   limit removed the throttling in a local diagnostic. A production
   `RATE_LIMIT_MAX` change needs its own capacity test on the transactor. That
   change is the owner's deploy step.

Ongoing cost:

- Each identity is one account, one role, one membership per space and one
  credential file to keep private. Review access when the identity list changes.
- Audit reports must map each social id to its identity. The mapping used here
  is one query, kept in scratch files outside the repo.
- Separate identities removed throttling in this run. They did not remove the
  pool stall that JH-902455 found, because that stall did not reproduce here.
  The cause is still open.

## Earlier findings (JH-902455), still open

These come from `docs/harness/reports/jh-902455-load-profile-c1/`. They are
not closed by this run.

- **Throttling counts.** JH-902455 counted 23,753 rate-limit responses in its
  inclusive span. This run counts 35,259 across the worker counters. The windows
  differ, so compare rates, not totals.
- **Shared-burst connect p95.** JH-902455 recorded 387,816 ms with the same
  1,500 limit and burst. This run recorded 118,180 ms. The gap between runs is
  not explained.
- **Raised-limit ratio.** JH-902455 reported 838.1 times on connect p95. This run
  gives 243 times for connect after burst (118,180.4 over 486.8), and 50 times
  for the whole burst (125,838.6 over 2,507.7).
- **Separate-account stall.** JH-902455 saw 11 of 16 first connects never
  complete, with ten idle transactor sessions. This run completed all 16. The
  follow-up "Bound Postgres reservations across asynchronous presence triggers"
  stays open. This run did not capture the managed-context state.
- **Scheduled pacing.** JH-902455 recorded 506 s of pacing after one rejection
  in the mixed migration. This run recorded 420.8 s across 16 workers in the
  shared burst, with a single largest delay of 5.8 s. These are different
  measurements and do not confirm each other.
- **Drafts.** The follow-up drafts in `follow-ups.md` are still drafts. Nothing
  was posted to a board.

## Deviations and blockers

- **`origin/main` was not merged.** The card asked for one merge of `origin/main`
  at the start. The merge (`e6da170c3`) was made. The push guard refused it,
  because the range `origin/jj/activity-feed..HEAD` included upstream commits by
  other authors, and `commit-identity-check.py` exited 100. The merge was
  dropped before any push with `git reset --hard 45533155e`. Nothing from it was
  pushed. The rig does not depend on `main`, so the comparison ran on the base.
  Resolving this is a decision for the owner or the Director. The identities of
  those commits must not be rewritten.
- **Wave log folder is read-only** from this worker's shell. Logs are in
  `/tmp/jake-harness-workers/opiWS8lJ/`.
- **Default Node is unsupported.** The rig needs Node 20 to 24. The default
  `node` is 26, so `rush install` refused it. The run used Node 22.23.3.
- **Attribution step timing.** The first waiter script had a bug. It filtered
  containers by name, and the rig's runner container has a random name. The
  attribution step ran by hand, with the same script after the fix. It started
  as soon as the shared scenario finished and completed 17 of 17 writes while
  the rig was still up.
- **Report path.** The card lists `docs/reports/...` under Files and
  `docs/harness/reports/...` under Finishing. This report is at the Finishing
  path, which matches the JH-902455 report location.
- **No tests ran.** No code changed, so no targeted test file applied. The card
  allows tests only for changed files. The full suite was not run.

## Limits of this measurement

- One local fixture, one run per arm for the bursts. This is not a production
  capacity test.
- The raised limit is a local diagnostic of 1,000,000 per 30 s. It is not a
  setting to copy.
- Health isolation was tested only on a shared budget.
- The separate and raised bursts had about three event loop samples each.
- Attribution was checked on transactions, not on activity rows.

## RECOMMENDATIONS

1. **Decide the `origin/main` merge.** The identity guard refuses any push that
   carries upstream commits by other authors. The owner or the Director needs to
   either allow that push or accept a branch that does not include `main`.
2. **Test health on its own identity.** Rerun the `mixed` scenario with the health
   lanes on a separate account. This run only shows the shared case.
3. **Test a lower workspace role** than OWNER for the four service identities.
   Do this before any huly.lan setup.
4. **Test the `HULY_BOARD_SERVICE` selector** on a stub config. Set one valid
   name and one unknown name, and check that the unknown name refuses before any
   connection. This needs a card in jake-harness, since the code lives there.
5. **Keep the reservation follow-up open.** Rerun the separate burst with the
   managed-context inspection. Check whether the 11 of 16 stall returns.
6. **Re-vendor the rig's client after the selector lands,** if the rig should
   exercise the selector.
7. **Document the Node requirement.** The rig and `rush install` need Node 20 to
   24. The default Node here is 26.
8. **Promote the attribution helper only with a card.** The mapping script is a
   scratch file outside the repo. If it is wanted, it needs its own card.
