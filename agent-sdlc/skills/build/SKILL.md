---
name: build
description: "Execute a gate-passed plan autonomously: one fresh subagent per task, test-first, committing green between tasks, until the branch is ready to ship. Use AFTER the gate verdict is 'ready to build' and BEFORE ship. Triggers: 'build', 'implement the plan', 'execute the tasks', 'start building', or a clean gate-report.md with a settled `## Plan`. This is the conductor: it dispatches and gates, it does not write code itself."
---

# Build: conduct the plan into a green branch

Execute the `## Plan` task list without a human in the loop. For each task, dispatch a fresh
implementer subagent that writes the failing test first, then the minimal code; review the diff;
commit only when it is green. The skill is a conductor — it holds the task list and a resumable
ledger, and delegates every line of code to a subagent. The disciplines live in reference files the
subagents read, not here.

<HARD-GATE>
Precondition: `specs/<feature>/gate-report.md` exists with the verdict **ready to build** (no
Critical or High findings). If it does not, STOP and route back to `/agent-sdlc:gate` — never build
on an unblessed chain. Input is the `## Plan` section of `specs/<feature>/<feature>.md` (plus the
sections it references) and the gate report. Output is product code on a feature branch, one atomic
commit per task, and `specs/<feature>/build-report.md` (the ledger). The terminal action is a green
branch handed to `/agent-sdlc:ship`. Do NOT open the PR — that is ship's job.
</HARD-GATE>

## The loop (the conductor's whole job)

1. **Precondition** confirm the gate verdict is ready to build. Else stop.
2. **Isolate** set up an isolated workspace (detect existing isolation → native worktree tool → `git
   worktree` fallback). Run the **green bar** once — the commands `## Tech Stack` declares (compile,
   test, lint, format-check): the baseline MUST be green before touching anything.
3. **Ledger** open `build-report.md`. If it already exists, resume from it plus `git log` — never
   re-run a task already marked done. Re-doing completed work is the most expensive failure here.
4. **For each task `T-N`, in dependency order:**
   a. Dispatch the **implementer** subagent with a file brief for `T-N` only.
   b. Dispatch the **reviewer** subagent on the resulting diff.
   c. If the reviewer finds Critical/Important issues, dispatch a **fixer** and re-review (bounded).
   d. Verify the **green bar** is green — run the full declared set (compile, test, lint,
      format-check), read the output (verification-before-completion). Not just tests: lint or
      format drift caught now is a clean commit; caught later is a reactive scramble.
   e. Commit: one atomic commit for the task, reflecting the reviewed code.
   f. Update `build-report.md`: `T-N` done, the commit SHA, the `AC-N` it advanced.
   g. If Linear sync is enabled in `.agent-sdlc/config.json`, transition `T-N`'s issue via the
      `linear-sync` skill.
5. **Hand off** when every task is done and green: report "branch ready, run `/agent-sdlc:ship`".

The dispatch mechanics, the three subagent briefs, the bounded fix cycle, and ledger recovery are in
[reference/subagent-loop.md](reference/subagent-loop.md). The disciplines the subagents follow are in
[reference/tdd.md](reference/tdd.md), [reference/source-driven.md](reference/source-driven.md),
[reference/simplicity.md](reference/simplicity.md), and [reference/debugging.md](reference/debugging.md).

## Principles

- **Conduct, do not perform.** The conductor never writes product code. Every change comes from a
  subagent with a one-task brief. If you find yourself editing source directly, stop and dispatch.
- **One task, one green commit.** The repo compiles, passes, lints, and is formatted after every
  task — the whole green bar, not just the suite. A task that cannot finish green was mis-sized in
  planning — loop back, do not force it through.
- **Test-first is the subagent's contract.** The plan named the failing test; the implementer writes
  it and watches it fail before any code. Tests-after is a violation, not a shortcut.
- **Context hygiene.** A brief describes one task, never the session history or the whole plan. Hand
  artifacts (brief, diff, findings) through files, not by pasting them into prompts.
- **The ledger is truth after a compaction.** Trust `build-report.md` + `git log` over memory. They
  survive context loss; your recollection does not.
- **Stop at a blocker, do not improvise.** Ambiguity, a contradicted plan, or a task that will not go
  green after bounded fixes: record it blocked and ask. Do not paper over an unsettled plan.
- **Review at two scales.** Every task gets a cheap reviewer subagent here; the whole PR gets the
  heavy `review-gate` once, at ship. Both are real gates; neither replaces the other.

## Rationalizations (excuses to skip the bar, and the rebuttal)

| Excuse | Rebuttal |
| --- | --- |
| "I'll just edit this file directly, it's faster." | The conductor delegates. Direct edits skip the review gate and bloat its context. Dispatch. |
| "Write the code, add the test after." | Tests-after answers "what does it do"; tests-first answers "what should it do". The plan named the failing test — write it first. |
| "Give the subagent the whole plan for context." | One brief = one task. The whole plan is noise that derails an autonomous run. |
| "Skip the per-task review, review-gate catches it at ship." | A whole-PR gate cannot localize a per-task drift cheaply. Review early; fix while it is small. |
| "This task won't go green, I'll wire the next one and come back." | Errors compound. Stop the line: a blocked task is recorded and raised, not deferred. |
| "Trust my memory of what's done after the compaction." | Re-running a done task is the costliest failure. Read the ledger and `git log`. |

## Red flags (stop and fix)

- The conductor edited product code itself instead of dispatching a subagent.
- A commit with a red or unrun green bar (tests, lint, or format-check failing or never run), or
  more than one task in a single commit.
- An implementer that wrote code before a failing test, or whose brief carried the whole plan.
- A reviewer prompt told what *not* to flag (pre-judging disqualifies the review).
- A task marked done with no commit SHA, or work re-run because the ledger was not consulted.
- Building past a blocked task instead of stopping to ask.

## Done when

- Every `T-N` is implemented test-first, reviewed, and committed atomically, the green bar green
  (tests, lint, format-check) between each.
- `build-report.md` records every task done with its SHA and `AC-N`; no task left in-progress.
- The branch is green end to end.
- Linear issues are transitioned to Done where sync is enabled (or skipped cleanly where it is not).
- The hand-off to `/agent-sdlc:ship` is stated.

## The artifact (output)

- Product code on a feature branch: one atomic, reviewed, green commit per task.
- `specs/<feature>/build-report.md` — the resumable ledger: per task `T-N` its status (done /
  in-progress / blocked), commit SHA, the `AC-N` advanced, any blocker note, and any
  deferred-shortcut ceilings (`SHORTCUT(T-N)`) the task left in the code. Mirrors
  `gate-report.md`'s role — process state beside the spec, never inside it.

## Conventions

- Reads the `## Plan` and `## Tech Stack` sections of `specs/<feature>/<feature>.md` (the latter for
  the green bar — the commands that define a passing build) and `gate-report.md`; references `T-N`
  and `AC-N` IDs.
- Writes only product code + `build-report.md`. Does not edit the spec sections (the front half owns
  those) and does not open the PR (ship owns that).
- Runs after a clean gate verdict; re-run is safe and resumes from the ledger.
- Downstream consumer: `/agent-sdlc:ship` takes the green branch to a reviewed PR.
