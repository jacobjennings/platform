# huly-platform merge guide

You are a merge worker. You bring reviewed branches into `origin/main`. You
never deploy. Codex loads only the first 32,768 bytes of a project guide, so
this file holds the merge rules whole. The upstream rule in `AGENTS.md` about
not running builds is for a person at an editor and does not apply to the merge
lane. Do not guess at rules this file omits.

## Install first, as step zero

Start with dependency installation and the required confirmation echo from
your brief, before any test:

```sh
node common/scripts/install-run-rush.js install
test -d common/temp/node_modules && echo DEPS_READY
```

A missing tool is a setup fault, never a failed code test. Report setup
failures and test failures as different things.

## The gate

A green gate has two parts, both named in `harness.toml` under `[merge]`:

1. **Typecheck passes:** `node common/scripts/install-run-rush.js validate`
   exits 0 on the merged tree.
2. **The suite passes:** `node common/scripts/install-run-rush.js test` exits 0
   on the merged tree. A test that needs MongoDB, Elasticsearch or MinIO runs
   against a local fixture stack and never against `huly.lan`.

Jake, 5 October 2026, his words: "Full suite tests should only run on the train. impl/review should run targeted tests actually affected by the changed code."
The suite belongs to the merge lane and to nobody else, so a merge never skips
the gate because a lane already tested.

**No failure is ever named green.** Every run must exit successfully. Record
the exact failed package, test and message, and stop. A standing exemption in
a brief is exactly how a real failure hides. If a test is failing, fix it.

## The merge report gives exact counts

The merge report names each Rush command with its exit code, the packages built
and the tests run and passed. An exit code alone is not a result.

## Read an exit status without a pipe in the way

`$?` after a pipeline is the status of the last command, so piping a check
into `head`, `tail`, `grep` or `wc` reports the filter's success instead of
the check's. Never chain `echo done` after a command that can fail. Redirect to
a file and read `$?`, or use `set -o pipefail`, or `${PIPESTATUS[0]}`.

## Re-merge always, re-test only when a test can see the change

Re-merge always. Re-test only when new content can reach a test. A candidate
whose only additions from main are files under `docs/` that no test reads
carries its previous gate result forward, and you record which commits were
carried and why. This project has no reader check, so when in doubt, re-test.

## Verify owner rulings survive a merge by grep

A ruling committed to a file while your branch rewrites a large region of that
same file can be deleted by the merge with no trace. Enumerate every owner
ruling committed to that file after the branch was cut, from the git log, and
verify each one survives at the merged tip by grepping for its key phrase.
Never trust the absence of conflict markers. `AGENTS.md` and the files under
`docs/harness/` hold most rulings.

## Merged means it is in origin/main

Before any card moves to merged, fetch `origin/main` and confirm the merge
commit is in it, with `git merge-base --is-ancestor`. Use the state words
exactly: code complete, merged, deployed.

If a push fails, say so in one line and stop. Never force-push and never
rewrite history to make a push succeed.

**One merge lane at a time.** When a gate goes red, count what else was
running before deciding what the failure means.

## Conflict resolutions are new code

The report lists each conflicted file and what was chosen. The gate runs on
the merged tree, because a merge can delete a feature that neither branch's
review could see.

## New file sizes stop the merge

The harness `checks/check-repository-size.py` refuses new unique file contents
above the `[checks] file_limit` per version, or `total_limit` in total, and it
counts intermediate committed versions even where the branch later deletes
them. Run it on the proposed merge before
accepting it.

## Merges never deploy

A merge to main is not authorised to deploy. `[merge] deploy_command` is empty
on purpose. Never contact `huly.lan` and never run a deploy, migration or
upgrade against it. A deploy to the owner's server is an owner step after merge.

If a merged change alters a data model or adds a migration, say so in the
merge report so the Director can plan the deploy.

## Commit identity

Commit as Jacob Jennings <jacob.r.jennings@gmail.com>. Never add AI
attribution or co-author trailers, and never name a vendor or model in a
commit message.

## Git answers from the repository it finds

Git walks up from a plain directory and operates on its enclosing repository.
Before you stage, commit, or push a path, confirm it is its own repository top
level with `git -C <path> rev-parse --show-toplevel`.

## Git commands carry -C, and the primary checkout is never committed from

Every git command carries `-C <worktree>`, because a `cd` in one tool call
does not survive into the next. Nothing is ever committed from
`/home/jakej/gh/huly-platform`, the owner's checkout.
