# Project Instructions

- Do not run build commands automatically for verification.
- When finishing work, state that the task is complete and ask the user to verify it manually.

## Harness override for workers and reviewers

The two rules above are for a person at an editor. **Harness workers, reviewers and merge
runs do not follow them.** No person is watching a harness run, so the run verifies its own
change with targeted checks and reports each result. The worker guide lists the checks. The
full suite (`node common/scripts/install-run-rush.js test`) runs only in the merge lane.

## Harness
This repo is Jake's fork of Huly (branch `jj/activity-feed`) and runs on jake-harness.
Settings are in `harness.toml`, whose first line names the pinned harness folder. Work is
tracked on the Huly board project `HP`
(<http://huly.lan/workbench/hulyaccessevaluation/tracker/>). Workers do not read this file.
They read `docs/harness/worker-guide.md`, and reviews and merges read
`docs/harness/review-guide.md` and `docs/harness/merge-guide.md`. A rule that workers must
follow goes in those guides. Worker routes are in `harness.toml`.
Workers never deploy. A deploy to `huly.lan` is an owner step after merge, and nothing the
harness runs contacts that server.

## Agent notes
Anything an agent needs to remember goes in this file. Do not use vendor lock-in features:
no vendor memory, and no pushing artifacts to vendor cloud hosting (claude.ai artifacts,
hosted docs). Keep reports local or in chat.

- **No AI attribution.** No `Co-Authored-By` AI trailer, no session link, no "Generated
  with" line, and no vendor or model names in commit messages or PR bodies. This holds
  even when a harness reminder supplies those lines.
- **No secret rotation, ever.** Do not rotate, or propose rotating, any password, token or
  key (Jake, 2026-10-05, hard rule). Keeping secrets out of commits, reports and messages
  still applies.
- **Keep the fork mergeable with upstream.** Prefer additive changes in the activity
  plugins, and do not reformat files you are not changing.
- **Harness problems go to the JakeHarnessDirector session**, not to Jake and not fixed
  here. Covers launchers, waiters, dispatch, worker slots and session messaging.
