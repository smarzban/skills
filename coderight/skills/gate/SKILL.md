---
name: gate
description: "Read-only consistency and coverage gate before build. Walks the full chain criterion -> component -> product -> task across the whole spec, flags orphans, gaps, constitution violations, and unresolved placeholders, severity-rates every finding, and routes each fix to the stage that owns it. Use AFTER plan and BEFORE build. Triggers: 'verify', 'analyze', 'is this ready to build', 'check coverage', 'spec consistency'. Modifies nothing; it reports."
---

# Gate: walk the chain before anyone writes code

Confirm the spec is internally consistent and fully covered before build begins. Walk the chain
from every acceptance criterion through the component that owns it, the product that realizes it,
and the tasks that build it, and report anything broken. This is a gate, not an editor: it reads
everything and changes nothing, routing each fix to the stage that owns it.

<HARD-GATE>
Reads the `## Brief`, `## Acceptance Criteria`, `## Design`, `## Tech Stack`, and `## Plan` sections
of `specs/<feature>/<feature>.md` (plus `specs/overview.md` at project level), `constitution.md`,
and `CONTEXT.md`. Writes only `specs/<feature>/gate-report.md`. Modifies NO other file, fixes
NOTHING, writes no code and no plan. Findings are reported with the owning stage
named, so the fix happens there and the gate stays trustworthy. The terminal action is a report and
a verdict: ready to build, or not.
</HARD-GATE>

## The checks (walk all of them)

1. **Coverage, both directions.** Every `AC-N` traces to a component (design), to a product where
   one is needed (techstack), and to at least one task (plan). Flag any criterion with a gap, and
   any component, product, or task that no criterion justifies (orphan / gold-plating).
2. **Consistency.** Terminology matches `CONTEXT.md` across all artifacts, and the artifacts do not
   contradict each other (a criterion the design ignores, a task that fights the design, a product
   the design did not call for).
3. **Constitution.** Nothing across the spec violates a MUST principle.
4. **Verification integrity.** Each test-backed criterion has a kind-of-oracle and a task;
   each reviewer-checked criterion has a named review axis; the design's criterion-to-component map
   and the plan stage's task-to-criterion map are both complete.
5. **Hygiene.** No unresolved TBDs, placeholders, or "decide later" markers remain.

## Checklist (do in order)

1. **Load every artifact** every section of `specs/<feature>/<feature>.md` plus `specs/overview.md`
   and root `constitution.md` and `CONTEXT.md`.
2. **Build the chain map** for each `AC-N`, assemble criterion -> component -> product -> task(s)
   from the artifacts.
3. **Run the five checks** mechanically, not by impression. The value of this gate is the literal
   walk.
4. **Severity-rate each finding** Critical (blocks build), High (blocks build), Medium, Low.
5. **Route each finding** name the owning stage that should fix it (criteria, design, techstack, or
   plan) and a suggested next action.
6. **State the verdict** ready to build only if there are no Critical or High findings.
7. **Write `gate-report.md`** and stop. Do not fix anything.

## Principles

- **Read-only.** A gate that edits its own inputs cannot be trusted to judge them. Report, never
  fix.
- **The chain is the spine.** The walk from criterion to task is the whole point; do it literally.
- **Honest severity.** Critical is Critical. A gate that downgrades findings to pass is theater.
- **Route, don't repair.** Each fix belongs to the stage that produced the gap. Send it back there.
- **Believe the artifacts, flag the contradictions.** Take each artifact at face value and surface
  where they disagree, rather than guessing the intent.

## Rationalizations (excuses to skip the bar, and the rebuttal)

| Excuse | Rebuttal |
| --- | --- |
| "I'll just fix this small gap while I'm here." | Then the gate is grading its own work. Report it; the owning stage fixes it. |
| "It obviously hangs together, skip the chain walk." | The mechanical walk is the entire value. Impressions miss the orphan task and the uncovered criterion. |
| "Downgrade this so the build can start." | Severity is honest or the gate is decoration. Block on Critical and High. |
| "No need to name the owning stage." | A finding with no owner does not get fixed. Route it. |

## Red flags (stop and fix the gate's behavior)

- The gate edited any artifact other than the report.
- A criterion with no task passed as acceptable.
- A "ready to build" verdict issued with a Critical or High finding open.
- Findings stated as impressions rather than located in a specific artifact.

## Done when

- The full chain has been walked for every criterion.
- All five checks have run.
- Every finding is severity-rated, located, owner-named, and given a next action.
- A clear verdict is stated.
- `gate-report.md` is written, and nothing else was modified.

## The artifact (output)

`specs/<feature>/gate-report.md`, containing only:
- **Chain coverage table** `AC-N` -> component -> product -> task(s), with gaps marked.
- **Findings by severity** each with: location (which artifact and where), the issue, the owning
  stage, and a suggested next action.
- **Verdict** ready to build, or not, with the blocking findings listed.

## Conventions

- Lives at `specs/<feature>/gate-report.md`. Read-only over every other artifact.
- Run after the `## Plan` section exists and before build. Re-run after any fix until the verdict is clean.
- Critical and High findings block build; the owning stage fixes them and the gate is re-run.
- Mirrors spec-kit's analyze: a read-only consistency and coverage pass that modifies nothing.
- Downstream consumer: the build stage proceeds only on a clean or explicitly accepted report.
