# huly-platform review guide

You are reviewing a change. `AGENTS.md` may be longer than your client loads,
so this guide carries the whole rule set a reviewer needs. The upstream rule in
`AGENTS.md` about not running builds is for a person at an editor and does not
apply to harness reviewers. Run the targeted checks below.

## 1. Hard rules that decide a diff

Reject a change that breaks one.

- **Keep the fork mergeable with upstream**. A change should be additive in the
  activity plugins. Reject whole-file reformatting, renames of shared code and
  edits to unrelated packages, because they make the next upstream merge hard.

- **A review never contacts `huly.lan`**. A deploy to the owner's server is an
  owner step after merge. Reject any test, script or doc step that points at
  the live server or reads its credentials.

- **Data model and migration changes need extra scrutiny**. A change under
  `models/` or a migration must say what it does to existing workspaces. Name
  it near the top of the report.

- **No secrets in a diff**. Reject any literal password, token, account file or
  key in committed files.

- **Do not change license text**. Flag any edit to a LICENSE file.

These fleet rules apply to every project:

- **A merge can silently delete an owner ruling that was committed while the
  branch was open**. A merge over a large rewrite of a rulings file must
  enumerate every ruling committed to that file after the branch was cut and
  verify each survives at the merged tip. Verify by grep for the key phrase.
  The absence of conflict markers proves nothing.

- **A card carrying an owner ruling shows his words verbatim and set apart**.
  Numbers, history and expected consequences sit separately under our name.

- **Three words describe work state, and "landed" is banned**. Code complete
  means a branch is finished and its gate finished. Merged means it is in
  `origin/main`. Deployed means the change is live on a server.

- **A record commit title starts with Record, Log or Review**. The product
  voice is reserved for product changes.

- **A worker that exits 0 with an unfinished gate is not code complete**.
  Check the gate evidence in the run you review.

- **Legal and licensing text needs the owner's approval**. Flag any edit to
  a LICENSE or licensing wording.

## 2. Ways a check can pass while proving nothing

A green result of this shape is a finding.

- **A type check proves types only**. A green `validate` says nothing about
  runtime behavior, Svelte reactivity or what a user sees.

- **A test that mocks the thing under change proves nothing about it**.
  Confirm the test reaches the changed code.

- **A build of the wrong package proves nothing**. Confirm the build named the
  package the diff changed, and its dependents.

- **A passing unit test does not show the Activity feed renders**. A change to
  what a user sees needs a rendered check against a local fixture workspace,
  or the report says "not checked".

## 3. Test rules

**A reviewer runs targeted tests for the changed area only, and never the
full suite**. The owner's ruling, 14 September 2026, his words:
**"implementers should not (and in fact, should be forbidden from) running
full test suites. that's why we have a CI at merge time. They should be
running targeted tests in related areas only."**

A reviewer does not re-run the worker's own gate to verify it. It inspects
code, diffs and artifacts. The report lists each command run with its exit
status. Useful targeted checks:

- `node common/scripts/install-run-rush.js build --to <package-name>`
- `node common/scripts/install-run-rush.js validate --to <package-name>`
- `cd <package-dir> && npm run test`, or one test file with `npx jest <file>`

Rules:

- **A test must be able to fail for the reason its name gives**. Treat an
  untested claim about a test as unevidenced.

- **Narrowing a test's inputs is deleting coverage**. It must be reported like
  a deletion, never done silently.

- **A control's expected value comes from somewhere the code under test
  cannot reach**. A control built from the output being checked asserts a
  tautology.

- **A count produced by a text pattern gets two control cases before it is
  reported**. One item known to be present that it must match, and one known
  to be absent that it must not.

- **Never conclude that a run's gate passed from its exit status alone**.

## 4. Measuring rules

- **Two instruments disagreeing is a dependency**, not two findings.

- **Performance on a shared machine is not a measurement until it is
  repeated**. Take medians of at least three repetitions and record the load.

- **An acceptance measurement that cannot fail is not evidence**. Before
  trusting one, find the input that would make it move.

- **A red suite can be contention, not a defect**. Count what else was
  running before deciding what a failure means.

## Test scope and what blocks

Jake, 5 October 2026, his words: "Full suite tests should only run on the train. impl/review should run targeted tests actually affected by the changed code."

- **Never run the full suite.** Here that is `node common/scripts/install-run-rush.js test` or a repo-wide Rush build or validate. It runs only at merge time.
- **Run targeted tests only.** That means the tests of the files you changed, the
  tests that import or execute the code you changed, and the tests the card names.
  Show the search you used to find them, such as the `grep -rn` command and its hits.
- **List each targeted test in the report with its result**: passed, failed, or could
  not run and why.
- **Only real defects block.** A real defect makes the change wrong or unsafe: wrong
  behavior, a failing targeted test, lost coverage, a secret, a production risk, or a
  broken rule about what the product does. Text that players or site visitors see is
  product, not hygiene.
- **GPU rule breaks block.** A change, test or probe that opens, stat-probes or
  enumerates NVIDIA device nodes is a blocking finding. So is a browser or WebGPU
  check that ran on a software or fallback adapter.
- **Hygiene never blocks.** Report wording, semicolons, banned words, and card IDs in
  comments or docs are non-blocking notes. A review whose only findings are hygiene
  says `Merge.` and lists them as notes.
- **A re-review after a named fix checks only that fix and its targeted tests.** It
  does not reopen the rest of the diff.

## 5. Review report rules

- **The report's first line is exactly one verdict word**: `Merge.`, `Merge
  after a named change.` or `Close.`. The named change must be concrete
  enough for a worker to make it without asking: the file, the line and what
  to change.

- **Each finding gives its severity (blocking or suggestion), the file and
  line, a concrete failure scenario, and the smallest fix**. Anything you
  could not check goes in a "Could not check" list.

- **The report goes at `docs/harness/reports/review-<description>/report.md`,
  committed and pushed**. The dispatcher reads the verdict from the pushed
  branch's commit.

- **The report names the run or commit it reviewed**, by branch or commit.

- **A review's deliverable is a verdict, not a merge**.

- **A review must start after the implementation it covers finishes**. Never
  infer a source task from a branch name or from prose.

- **For a change that alters data or a migration**, the report says so in plain words near the top: what happens to existing workspaces.

## 6. Writing rules for your report

- **Write it simply. Density is the defect, not word choice**. The owner's
  rule, his words: **"english, boss. I'm just a meat computer."**

- **In anything the owner reads: no semicolons, no em dashes**. Never use the
  words "honest" or "durable" in any form.

- **Every task reference the owner reads is a full clickable link**, such as
  `http://huly.lan/workbench/hulyaccessevaluation/tracker/HP-1`.

- **Times the owner reads are his local clock, never UTC**. Write them like
  `9:53 pm` in America/Chicago.

- **Run the harness prose checker** `board/board_text.py <file>` from the
  pinned harness checkout and quote its warnings.

## Where to read more

`AGENTS.md` on main is canonical. `ARCHITECTURE_OVERVIEW.md` and `docs/` hold the upstream notes.
