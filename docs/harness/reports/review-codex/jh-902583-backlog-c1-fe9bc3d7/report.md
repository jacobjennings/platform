Director decision.

Reviewed commit: fe9bc3d7552fa6393bfae9363267e6de2cd566e1

Source task: [JH-902583](http://huly.lan/workbench/hulyaccessevaluation/tracker/JH-902583).

## Decision needed

The card asks to fix a failing infrastructure test run. The branch instead makes eight infrastructure suites optional whenever a TCP probe fails. The Director must decide whether that coverage reduction is within the card's scope. No recorded ruling in this brief approves replacing infrastructure failures with skipped suites. This is a design choice, not a missing-test merge requirement.

Evidence: `foundations/server/packages/postgres/src/__tests__/integration.test.ts:54` selects `describe.skip` on a failed probe. The same pattern appears in the other seven changed suites. `pods/fulltext/src/__tests__/indexing.spec.ts:40` skips all indexing tests if any of three endpoints is unreachable. An unavailable service in CI now skips the assertions instead of failing the job. This affects every runner, not only the health runner.

The smallest decision is whether to accept automatic skipping in all runners or require infrastructure suites to remain mandatory where infrastructure is expected. The card does not specify which behavior is intended. The guide says, "Narrowing a test's inputs is deleting coverage" in `docs/reviewmerge-guide-detail.md`, Conditional review rules. The reduction is recorded here explicitly. A Director ruling can accept this scope choice. No worker fix round is requested.

## Code review

Reviewed only `67062797f34d3c5cff44505590e752564642371e..fe9bc3d7552fa6393bfae9363267e6de2cd566e1`. The implementation changes suite registration and adds identical synchronous TCP probe helpers in seven packages. Product implementation files are unchanged. Each probe has a 1.5 second socket timeout and a 4 second child-process timeout. An open port is not a service-readiness check. Probe failures, including child-process failures, select the skip path.

The default endpoints in the changed registrations match the endpoints previously used by their suites. The telegram suite retains its existing CockroachDB default of port 26257. The documented stack maps port 26258. The worker report discloses this mismatch. The generic URL helper also assumes port 80 for non-HTTPS URLs without explicit ports. That limits support for database URLs relying on their protocol's default port. These are considerations for the Director's choice of a skip policy.

No launcher, board client, label, stage, frozen file, settings file or user interface changed in the reviewed range. No screenshots are suggested for this test-only change.

## Applied report correction

Suggestion, `docs/harness/reports/jh-902583-backlog-c1/report.md:56` and its duplicate under `docs/reports/`: the statement that nothing was weakened contradicted the skip behavior. Removed that claim and explicitly described the lost coverage and TCP readiness limit. This implements the guide's rule to reject "false claims about code or test results". Applied-fix tip: 16387fa7f7b7422fe976513079b7005c9baa6f9f. Only report prose changed during review. No implementation or test was added or extended.

## Validation

Selection method: inspected every changed test registration and the shared helper text, with no test execution in this verdict-only review. Import search: `rg -n "test-infra" foundations/server/packages/{postgres,mongo,elastic,kafka}/src server/account/src pods/fulltext/src services/telegram-bot/pod-telegram-bot/src`.

The worker reports these results. They are claims from its committed report, not independently verified runner records:

| Changed test file | Worker-reported result |
| --- | --- |
| `foundations/server/packages/postgres/src/__tests__/storage.test.ts` | Exit 0, skipped. Combined with integration: 101 tests skipped. |
| `foundations/server/packages/postgres/src/__tests__/integration.test.ts` | Exit 0, skipped in the same combined run. |
| `foundations/server/packages/mongo/src/__tests__/storage.test.ts` | Exit 0, 31 tests skipped. |
| `foundations/server/packages/elastic/src/__tests__/adapter.test.ts` | Exit 0, 3 tests skipped. |
| `foundations/server/packages/kafka/src/__test__/queue.spec.ts` | Exit 0, 2 tests skipped. |
| `pods/fulltext/src/__tests__/indexing.spec.ts` | Exit 0, 3 skipped initially. Later reported 3 passed with services present. |
| `server/account/src/__tests__/postgres-real.test.ts` | Exit 0, 4 tests skipped. |
| `services/telegram-bot/pod-telegram-bot/src/__tests__/postgres-real.test.ts` | Exit 0, 16 tests skipped. |

No worker result was reused as a verified gate row. The report associates these claims with the reviewed branch. Its final tip tree is `872a1c289cfdf85d13d228665480d5a9a36aa231`. Per-run tested commits and raw runner output were not established. No full suite, live launch, browser, service, deployment or control board write ran here. There were no browser processes to clean up.

The source binding agrees: `reviewed-task-ids.json` and launcher role-index row 5119 both bind this review to the source card. Implementation finished at 8:06 pm on October 20, 2026. Review started at 8:08 pm that day, after implementation finished.

Prose check: `python3 board/board_text.py <report>` exited 0 and warned: "paragraph 5: possible-jargon: Explain 'The Director' in this sentence if it is a project term."

## Could not check

- The validation attachment is a Markdown report only. No image capture was attached. The local review evidence folder is empty.
- The worker's per-file test counts, live-service pass and probe-control claims lack raw evidence inspected in this review. They are not acceptance proof.
- No service-backed execution or full-suite recovery was checked. Passing by skipping does not prove infrastructure assertions pass.

## Merge state

No merge was attempted because the verdict requires a Director decision. A fresh fetch found `origin/jj/activity-feed` at `67062797f34d3c5cff44505590e752564642371e`. The reviewed tip is not its ancestor. The project's run repo record names `jj/activity-feed` as its main branch. No deployment ran. The required outcome command exited 1 for the non-merge verdict and queued "not merged: verdict is Director decision." with the source card link for host-side delivery to the Orchestrator and Director.

## Failing after merge

- none

## Hygiene notes

- docs/harness/reports/jh-902583-backlog-c1/report.md:1: The heading uses a bare task identifier instead of a full task link.
- docs/reports/jh-902583-backlog-c1/report.md:1: The duplicate heading uses a bare task identifier instead of a full task link.

## RECOMMENDATIONS

Director decision: record whether unavailable infrastructure may skip these suites in every runner. Keep this review unmerged until that scope choice is settled. This run declares no follow-on.

NOT MERGED
