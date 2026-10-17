# huly-platform worker guide

You are a worker on one task in the huly-platform fleet. This short guide
replaces the full `AGENTS.md` for workers, because the full guide would fill
most of your context before you read any code. Your brief is your task. This
guide is the rules around it. The owner's personal guide is also loaded, and
it applies in full.

## What huly-platform is

The owner's fork of the Huly platform (https://github.com/jacobjennings/platform),
on the branch `jj/activity-feed`. It is a TypeScript and Svelte monorepo built
with Rush. The current work is the Activity feed. The fork is deployed to the
owner's own Huly server, `huly.lan`, but only the owner deploys it.

Main directories: `packages/` (shared libraries), `plugins/` (client plugins,
including the activity plugins), `models/` (data models), `server/` and
`server-plugins/` (server side), `services/` and `pods/` (services),
`dev/` (dev tooling and the local stack), `tests/` and `ws-tests/` (end to end
tests), `docs/` (upstream docs) and `docs/harness/` (harness files).

## Your working rules

- **Stay inside your worktree.** Read and change only what your brief names,
  plus what you must read to do it.
- **Commit early and push often.** Make a real commit within your first ten
  minutes, then commit and push after each meaningful step.
- **Every git command carries `-C <worktree>`.** Your shell's working
  directory does not persist between commands.
- **Commit as the configured identity.** Never add AI attribution or
  co-author trailers, and never name a vendor or model in a commit message.
  Never force-push or rewrite pushed history.
- **Run only the tests near your change.** The full suite belongs to the merge
  gate. Your targeted checks are below.
- **Nothing you run contacts `huly.lan`.** Tests and local builds use a local
  fixture workspace or mocks. Never point a client, test or script at the
  owner's live server, and never read its credentials.
- **Never launch a graphical application.**
- **You run directly on the owner's machine, with no sandbox.** You have his
  home folder, keys, git, the `gh` CLI and the network. These are forbidden
  because workers have caused damage with them before:
  - **Never kill, stop or signal a process you did not start.** No `kill`,
    `pkill`, `killall`, `tmux kill-*`, `systemctl stop` or restarts of other
    sessions, servers or workers. If something is in your way, report it.
  - **Never force-push or rewrite pushed history.** No `push --force`,
    `--force-with-lease`, `+refspec`, deleting remote branches you did not
    create, or rebasing or amending commits that are already pushed. Never
    push to `main` or to the upstream repository.
  - **Never run anything on an NVIDIA GPU.** The RTX 5090 (jjpc) and RTX 3090
    (bb) serve inference only. Keep `CUDA_VISIBLE_DEVICES` empty, and use the
    AMD or Intel GPU or the CPU for browsers, captures, benchmarks and tests.
  - **Never open, stat-probe or enumerate NVIDIA device nodes, for any reason.**
    Tests and probes use stand-in device nodes or fixtures.
  - **Chrome's software renderer is not acceptable.** Any browser check must
    show a hardware adapter that is not a fallback, and the report names the
    adapter it saw.
- **Never run a destructive command for real, not even in a test.** No
  `kill -1`, `kill 0`, `pkill` or `killall` by name, `tmux kill-server`,
  `systemctl stop` or force-push to a real remote. Test a guard through its
  decision function, or with stub binaries first on `PATH`.
- **Finish with a report when your brief asks for one**, committed and pushed,
  and name its path in your last message. End it with a RECOMMENDATIONS
  section for anything outside your scope.
- **Your run is not done until your targeted checks pass and your commit is
  pushed.** Never end with a test still running in the background.
- **Do not merge into main and do not push to main.** Work stays on your
  branch. Merged means it is in `origin/jj/activity-feed`, and the merge lane does that.
- **Keep large files out of the repository.** A new file over 10 MB, or more
  than 50 MB of new content in total, fails the merge gate.
- **Name a card by its full link**, such as
  `http://huly.lan/workbench/hulyaccessevaluation/tracker/HP-1`. Never a bare
  number, and never guess the prefix.
- **Times in files that scripts read stay in UTC.** Only prose the owner reads
  uses Chicago time.
- **You cannot edit `AGENTS.md` or `CLAUDE.md`.** They are left out of your
  checkout. If your task needs a guide change, say so in your report.

## Build and test override

The upstream `AGENTS.md` says not to run build commands for verification and to
ask the user to verify manually. That rule is for a person working in an editor.
**It does not apply to harness workers.** No person is watching your run, so you
verify your own change with the targeted checks below, and you report each
result. Your final message says what you ran and what passed. It does not ask
the owner to verify by hand.

## Targeted checks

Run these from your worktree. Install once with
`node common/scripts/install-run-rush.js install` if `common/temp` is missing.

- **Build only the package you changed, and what depends on it:**
  `node common/scripts/install-run-rush.js build --to <package-name>` or
  `--from <package-name>` for dependents. Package names are in `rush.json`.
- **Type check and validate the same packages:**
  `node common/scripts/install-run-rush.js validate --to <package-name>`.
- **Test only the package you changed:**
  `cd <package-dir> && npm run test` (or `rushx test` from that directory).
  A filtered run such as `npx jest <file>` is better when one file is enough.
- **Svelte files:** run `rushx svelte-check` in the changed package.
- **Local dev stack, when your brief names it:** use the compose files under
  `dev/` against a fixture workspace on localhost. Never against `huly.lan`.

## Test scope

Jake, 5 October 2026, his words: "Full suite tests should only run on the train. impl/review should run targeted tests actually affected by the changed code."

- **Never run the full suite.** Here that is `node common/scripts/install-run-rush.js test`
  or a repo-wide `rush build`, `rush validate` or `rush rebuild`. They run only at merge time.
- **Run targeted tests only.** That means the tests of the files you changed, the
  tests that import or execute the code you changed, and the tests the card names.
  Show the search you used to find them, such as the `grep -rn` command and its hits.
- **List each targeted test in the report with its result**: passed, failed, or could
  not run and why.

## Keep your context small

Your model forgets the start of the conversation when its context fills.

- **Read ranges, not files.** Find what you need with `rg -n`, then read the
  lines around it with `sed -n '120,180p' <file>`. Never print a whole file
  longer than about 200 lines.
- **Pipe long output through `tail -40`.** Rush builds are verbose.
- **Do not re-read what you have already read.** Keep notes in your commits.
- **Commit and push after the first working edit, and after every test run.**
  A run that hits its time limit keeps only what is committed.
- **Stop at your brief's one change.** If the task needs more, say so in your
  final message and name the next step. The Orchestrator will launch it.

## Side jobs on the local cluster

The routes for these modes are set in `harness.toml`, not here.

- `local-subagent.sh '<question>'` runs a small isolated job, for a summary, a
  classification or a quick lookup.
- `local-subagent.sh --deep '<question>'` runs a larger job on the deep route.
- `local-subagent.sh --vision <image> '<question>'` asks the vision route
  about an image.
- The side job sees only your question, so write it so it stands alone.
- Exit 75 means that machine is full. Exit 65 means it is down. Do not retry
  in a loop. Carry on without it and say so in your report.

## Routes and escalation

Routes are set only in `harness.toml`. Haiku is the worker model for all sizes of work.
If Haiku fails a task because it is too hard, say so in your final message. The owner
decides whether a stronger model may run it, one approved job at a time. See
`docs/harness/worker-model-policy.md`.

## Tests that fail by design

None are known. Any failure is real. If a build step cannot run because a
service is missing (MongoDB, Elasticsearch, MinIO), say so in your report.

## Product rules that must never break

- **Keep the fork mergeable with upstream.** Prefer additive changes in the
  activity plugins over edits to shared code. Do not reformat files you are not
  changing, because that makes later upstream merges painful.
- **Never touch the live server.** Do not contact `huly.lan`, and never run a
  deploy, migration or upgrade against it. Deploys belong to the owner.
- **Never write a secret.** Never hard-code a token, password or account file,
  and never commit one.
- **Data model and migration changes need a named card.** A change to a model
  in `models/` or a migration must say so in the report, with what it does to
  existing workspaces.
- **Do not change the upstream license, or any license text.**

## Writing

Plain short sentences, one idea each. In anything the owner reads: no
semicolons, no em dashes, never the words "honest" or "durable", and times in
America/Chicago written like `9:53 pm`.

## When you need more

The full guide is `AGENTS.md` on the main branch. Read one section of it with
`git -C <worktree> show origin/jj/activity-feed:AGENTS.md | sed -n '/^## <heading>/,/^## /p'`
only when your brief sends you there. `ARCHITECTURE_OVERVIEW.md` and `docs/`
hold the upstream architecture notes.
