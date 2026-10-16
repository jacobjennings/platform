# Worker launch policy

This file is the checked-in authority for which routes harness workers may use
in huly-platform. The launchers and the policy checker read the
marked blocks below. A registered route is not authorization by itself. Only
routes listed here may be launched for this project.

Jake chooses the Director and Orchestrator sessions. This file does not cover
them.

## Who does what

| Role | Route | Launcher |
| :--- | :--- | :--- |
| Hard implementation and analysis | `spark/qwen3.8-flash-next` | `run-opencode-worker.sh` |
| Moderate implementation and analysis | `jjpc/qwen3.8-27b`, then `spark/qwen3.8-flash-next` | `run-opencode-worker.sh` |
| Filler and small work | `bb/qwen3.8-27b-awq`, also any filler route | `run-opencode-worker.sh` |
| Review | Codex `gpt-6.1-sol`, low effort | `run-native-worker.sh` |
| Merge | Codex `gpt-6.1-sol`, low effort | `run-native-worker.sh` |
| Overflow when no fitting local slot is free | Codex `gpt-6.1-sol`, medium or low effort | `run-native-worker.sh` |
| Small isolated side jobs | `jjpc/qwen3.8-27b-small` | local subagent |
| Reading an image | `spark/qwen3.8-flash-next` | local subagent with vision |

Hosted OpenRouter routes are not used for implementation or analysis. If a
local inference server is down, the Orchestrator stops and asks. It never falls
back to another route.

Sol overflow. Jake, 2026-10-04, verbatim: "'Waiting for worker slots' we should
be overflowing to Sol Low/Medium. Waiting is not my strong suit". A free local
slot on the card's route still comes first. Moderate work tries jjpc, then Spark,
before Sol. Jake, 2026-10-07, verbatim: "Spark was always the priority over sol." The
Orchestrator never requests Sol directly for implementation or fixes. When no local
slot is free, the card runs on Codex `gpt-6.1-sol` instead of waiting:

- **Medium effort** for named fixes and conflict
  work.
- **Low effort** for small mechanical changes.

Reviews and merges run on Sol at low effort. Jake, 2026-10-09, verbatim: "Let's run Haiku via
opencode and API key for workers for a while, with Sol Low reviewers." Asked which reviews:
"All reviews". Merges, Jake, 2026-10-05: "Merges can go to Sol Low."
Overflow covers a full route, not a down one. A down local server still means
stop and ask.

Workers never deploy. A deploy to huly.lan is an owner step after merge.

Explicit native effort above medium needs a recorded reason of at least three
words.

<!-- automatic-role-routes:start -->
```json
{
  "implementation_hard": {"launcher": "opencode", "routes": ["spark/qwen3.8-flash-next"], "effort": "default"},
  "implementation_moderate": {"launcher": "opencode", "routes": ["jjpc/qwen3.8-27b", "spark/qwen3.8-flash-next"], "effort": "default"},
  "analysis": {"launcher": "opencode", "model": "jjpc/qwen3.8-27b", "effort": "default"},
  "analysis_hard": {"launcher": "opencode", "routes": ["spark/qwen3.8-flash-next"], "effort": "default"},
  "analysis_moderate": {"launcher": "opencode", "routes": ["jjpc/qwen3.8-27b", "spark/qwen3.8-flash-next"], "effort": "default"},
  "review": {"launcher": "native", "model": "gpt-6.1-sol", "effort": "low"},
  "merge": {"launcher": "native", "model": "gpt-6.1-sol", "effort": "low"},
  "filler": {"launcher": "opencode", "routes": ["spark/qwen3.8-flash-next", "jjpc/qwen3.8-27b", "bb/qwen3.8-27b-awq"], "effort": "default"}
}
```
<!-- automatic-role-routes:end -->

Implementation on every board priority runs on Haiku through OpenCode with the API key, and
filler stays on the local routes. Jake, 2026-10-09, verbatim: "Let's run Haiku via opencode and
API key for workers for a while, with Sol Low reviewers." Jake, 2026-10-10: "All projects."

<!-- BEGIN ACTIVE ANTHROPIC LAUNCH POLICY -->
anthropic_model: anthropic/claude-haiku-5-5
anthropic_permitted_roles: implementation
<!-- END ACTIVE ANTHROPIC LAUNCH POLICY -->

<!-- BEGIN ACTIVE CLAUDE LAUNCH POLICY VERSION 4 -->
claude_new_launch_not_before_utc: 2026-09-05T06:33:48Z
claude_allowance_status: available
claude_permitted_roles: review,implementation,analysis
<!-- END ACTIVE CLAUDE LAUNCH POLICY VERSION 4 -->

<!-- BEGIN ACTIVE OPENCODE LAUNCH POLICY VERSION 4 -->
opencode_worker_default_preset: jjpc/qwen3.8-27b
opencode_reviewer_fallback_preset: openrouter/@preset/glm-5-3-flash-fast
opencode_glm_prohibited_roles: implementation,analysis
opencode_qwen_model: openrouter/qwen/qwen3.7-flash
opencode_qwen_permitted_purpose: image-understanding
opencode_qwen_prohibited_roles: implementation,analysis,review,merge
opencode_local_routes: jjpc/qwen3.8-27b,spark/qwen3.8-flash-next,bb/qwen3.8-27b-awq
opencode_local_permitted_roles: implementation,analysis
<!-- END ACTIVE OPENCODE LAUNCH POLICY VERSION 4 -->
