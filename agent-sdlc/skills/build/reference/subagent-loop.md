# Subagent loop — dispatch mechanics for the build conductor

How the conductor runs the per-task loop: workspace isolation, the three subagent roles and their
file briefs, the bounded fix cycle, model selection, and ledger recovery. The conductor reads this;
the disciplines the subagents follow are in the sibling reference files.

## Workspace isolation (step 2 of the loop)

1. **Detect existing isolation first.** If already in a worktree, a sandbox, or a harness-managed
   branch, use it. Never nest isolation.
2. **Native tool, then fallback.** Use the platform's worktree/branch tool if there is one; else
   `git worktree add` under `.worktrees/<feature>` from the base branch.
3. **Baseline green.** Run the full green bar once before any task — the commands `## Tech Stack`
   declares (compile, test, lint, format-check). If the baseline is red, stop — you cannot tell your
   regressions from pre-existing ones. Report "baseline N passing" and proceed.
4. **Provenance for cleanup.** Note whether you created the worktree (`.worktrees/`) or inherited it.
   ship preserves the worktree on the PR path; only an explicitly created, finished one is cleaned.

## File briefs — the rule

A brief is written to a file (e.g. `.agent-sdlc/briefs/T-N.md` in the workspace) and the subagent is
told to read it. The dispatch prompt is one or two lines ("Implement task T-N. Read your brief at
<path>. Follow the disciplines it names."). Never paste the plan, the session history, or other
tasks into the prompt — that is the context bloat subagent-driven development exists to avoid.

## The three roles

### Implementer

**Brief contains only:**
- The task `T-N` verbatim from the `## Plan`: title, exact files, the failing test to write first,
  the `AC-N` advanced, the component touched, dependencies.
- The global constraints from `constitution.md` that bear on this task (not the whole file).
- Which disciplines to follow: `tdd.md` (red-green-refactor), `source-driven.md` (verify framework
  APIs against official docs before using them), `simplicity.md` (one vertical slice, Rule-0).

**Returns:** an uncommitted diff plus a one-line statement of which test now passes. Before
returning, the implementer runs the project's formatter and linter so the diff is already
format-clean and lint-clean — the conductor's green-bar check is the authoritative gate, not a
surprise. The implementer does **not** commit — the conductor commits after review, so the commit
reflects reviewed code.

### Reviewer

**Brief contains:** the diff, the task's contract (the `AC-N`, the named files, the test it had to
make pass), and the bearing global constraints. The reviewer runs the code, reads the changed files
and their call-sites, and returns a verdict: spec met (does the diff satisfy `T-N`'s contract?) plus
quality findings rated Critical / Important / Minor. One axis is always in scope: **over-build** — an
abstraction, indirection, layer, or dependency the `AC-N` did not call for, where a simpler form
passes the same test. Flag it like any other finding; the cheapest code to review is the code that
was never written.

**Never tell the reviewer what not to flag.** "Treat X as minor", "don't worry about Y" — pre-judging
disqualifies the review. State the contract and let it judge. Optionally add a **doubt lens**: a
second, adversarial pass that assumes the implementer was overconfident and hunts for what is wrong
rather than confirming what is right — useful for non-trivial or security-sensitive tasks, bounded so
it does not loop.

### Fixer (only when the reviewer finds Critical/Important)

**Brief contains:** the findings and the diff. The fixer follows `tdd.md` (a fix gets a guarding
test) and `debugging.md` (stop-the-line: root cause, not symptom). Re-review after each fix. **Bound
the cycle to ~2–3 rounds**; if it still fails, the task is blocked — record it and raise it, do not
grind.

## Commit (conductor, after the reviewer passes)

The conductor — not a subagent — verifies the green bar green (runs the full declared set — compile,
test, lint, format-check — and reads the output itself, never trusting a subagent's reported test
counts or pass/fail claim) and makes one atomic commit per task. One task = one commit. The message states the task and the `AC-N`
(e.g. `feat(T-3): root resolver — advances AC-1`). Then updates the ledger — including any
`SHORTCUT(T-N)` markers the diff introduced, so deferred ceilings are recorded beside the task in
`build-report.md` rather than buried in the code.

## Model selection (optional, platform-dependent)

Turn count beats token price: prefer a cheaper, faster model for mechanical implementer work, a
mid-tier or better for reviewers, and the most capable for the final whole-PR review (that one is
ship's `review-gate`). This is **guidance, not a requirement** — the per-dispatch model knob is
specific to some platforms (e.g. Claude Code's Agent tool) and absent in others. Where it is absent,
dispatch with the default model; the loop is unchanged.

## Ledger recovery (after a compaction or crash)

`build-report.md` is the durable record. On resume:
1. Read `build-report.md` for the per-task status.
2. Cross-check with `git log` — a task with a commit is done even if the ledger missed the write.
3. Resume at the first task not marked done. **Never re-run a done task.**
Trust the ledger and git history over any recollection of what happened before the break.
