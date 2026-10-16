# Launch brief template

Brief kind: <implementation, analysis, review, or merge>

Worktree: <absolute worktree path>

Put `-C <absolute worktree path>` on every Git command.
Make a real commit within your first ten minutes and push frequently.
Use the repository owner's Git identity. Never add AI attribution.

## Reading list

Read AGENTS.md and the task's named source files. Read the project's
harness.toml for its test setup, commands, policy, board and host settings.

## Scope

Name the files that may change and the source revision. Put required reading
inside the worker worktree. Home paths, other checkouts and `/tmp` inputs are
hidden by the worker boundary, and the checker refuses a read of them. Writable
scratch assigned with `TMPDIR=<path>` stays allowed. State what the worker
cannot write. Describe the bounded work and its acceptance criteria.

## Dependency setup

Insert the actual commands from tests.setup in harness.toml before any test
commands. Name the prerequisite checks that prove the setup succeeded.
Tests must use board.offline = true and unroutable board addresses.

## Deliverable

Write the report to `<exact report path>.md`. State whether it is to be committed.
Ensure the path is visible in the worktree before writing it.

## Verification and delivery

Name concrete targeted test files and commands, for example `tests/<target>.test.py`,
a filtered vitest run, or a single-purpose test script. Only the merge role runs the
configured tests.full_suite. Every other brief is refused when it names a whole-suite
command as a target: tests.full_suite, `npm test`, `npm run test`, an unfiltered
`vitest run`, a script in briefs.suite_runners without a file or `-t` filter, or a
`test:` script in package.json that runs other test scripts. A sentence that forbids
one of them is prose and is not refused. Use tests.typecheck when applicable.
Confirm each push against the remote branch tip. Never force push.
Name the absolute report path in the closing message.
End the report with a RECOMMENDATIONS section.
