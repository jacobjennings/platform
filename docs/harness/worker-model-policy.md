# Worker launch policy

The routes for this project are set in `harness.toml`, and only there. This file
names no model, route or preset. To change a route, edit `harness.toml`.

The launch gate, the route resolver and the dispatcher read `harness.toml`, because
`[policy] file` and `[supervision] policy_file` both name it. Each setting keeps the
owner ruling it came from as a comment beside it.

Jake chooses the Director and Orchestrator sessions. This file does not cover
them.

## Where each role is set

| Role | Setting in `harness.toml` |
| :--- | :--- |
| Hard implementation | `[fleet]` `tiers.hard` |
| Moderate implementation and fixes | `[fleet]` `tiers.moderate` |
| Small work | `[fleet]` `tiers.small` |
| Filler | Off: `[fleet]` `filler_routes` is empty |
| Implementation on every board priority | `[provider_worker]` primary |
| Implementation when the provider credit is used up | `[provider_worker]` fallback |
| Analysis | `[launch_policy.automatic_routes]` `analysis` |
| Review | `[launch_policy.automatic_routes]` `review` |
| Merge | `[launch_policy.automatic_routes]` `merge` |
| Sol overflow when no fitting local slot is free | `[overflow]` |
| Launch with no preset named | `[orchestrator]` `default_preset` and `[launch_policy.opencode]` `opencode_worker_default_preset` |

## Owner rulings

- Jake, 16 October 2026, verbatim: "All work goes to haiku regardless of size. ... the
  5090 is reserved for large content summarization, a skill which should be available to
  all roles."
- Filler is off for this project. Jake, 16 October 2026, verbatim: "Let's remove the
  filler process. Things have changed, we are not using the 5090 for workers."
- Implementation runs on Haiku through OpenCode with the API key. Jake, 2026-10-09,
  verbatim: "Let's run Haiku via opencode and API key for workers for a while, with Sol
  Low reviewers." Jake, 2026-10-10: "All projects."
- Reviews and merges run on Sol at low effort. Asked which reviews: "All reviews".
  Merges, Jake, 2026-10-05: "Merges can go to Sol Low."
- Sol overflow. Jake, 2026-10-04, verbatim: "'Waiting for worker slots' we should be
  overflowing to Sol Low/Medium. Waiting is not my strong suit". A free local slot on the
  card's route still comes first. Jake, 2026-10-07, verbatim: "Spark was always the
  priority over sol." The Orchestrator never requests Sol directly for implementation or
  fixes. When no local slot is free, the card runs on Codex `gpt-6.1-sol` instead of
  waiting:
  - **Medium effort** for named fixes and conflict work.
  - **Low effort** for small mechanical changes.

## Escalation to a stronger model

Haiku is the worker model for all sizes of work. If Haiku fails a task because the task
is too hard, report the failure and do not pick another model yourself. Jake, 16 October
2026, verbatim: "If haiku fails a task due to difficulty, it can be escalated to me for
one-off approval of better models for the hardest tasks." A stronger model runs only
with Jake's one-off approval.

## Other rules

- Hosted OpenRouter routes are not used for implementation or analysis. If a local
  inference server is down, the Orchestrator stops and asks. It never falls back to
  another route.
- Overflow covers a full route, not a down one. A down local server still means stop and
  ask.
- Workers never deploy. A deploy to huly.lan is an owner step after merge.
- Explicit native effort above medium needs a recorded reason of at least three words.
