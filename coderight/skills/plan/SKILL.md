---
name: plan
description: "Turn settled criteria, design, and techstack into an implementation plan an agent can execute autonomously: dependency-ordered atomic tasks, each naming exact files, the failing test to write first, and the criterion and component it advances. Use AFTER techstack and BEFORE build. Triggers: 'plan', 'break this down', 'task breakdown', 'write the implementation plan', or any time the design and techstack are settled and you need executable tasks. This is the agent-owned stage; the plan must be followable with no extra context."
---

# Plan: break the shape into tasks an agent can execute alone

Turn the settled criteria, design, and techstack into a plan an agent can execute without you in
the loop. Each task is the smallest change that leaves the repo green, names the exact files, and
carries the failing test to write first. The plan is complete enough for an agent with no project
context to follow. This is the one stage the agent owns end to end.

<HARD-GATE>
Input is the `## Acceptance Criteria`, `## Design`, and `## Tech Stack` sections of
`specs/<feature>/<feature>.md`, plus `constitution.md`. Output is the `## Plan` section of the same
file. Produce the plan and task breakdown only;
do NOT write the product code (the build stage executes the tasks). Each task specifies the test
to write first, but the red-green-refactor loop runs in build, not here. If the inputs are
inconsistent or a criterion has no clear path to a task, STOP and loop back to the owning stage (or
run the gate). The terminal action is a plan handed to build, through the
gate.
</HARD-GATE>

## The task bar (when a task is build-ready)

A task is done being written only when:

1. **Atomic.** It is the smallest change that leaves the repo green. If it cannot finish green in
   one go, split it.
2. **Exact files.** It names the precise files to create or change. No "update the relevant
   module".
3. **Test-first.** It states the failing test to write first (the red of red-green), or the
   explicit verification for the rare untestable task.
4. **Traceable.** It references the `AC-N` it advances and the component (from design) it touches.
   A task that advances no criterion is gold-plating.
5. **Ordered.** It depends only on earlier tasks, never later ones.
6. **Self-contained.** An agent with no extra context could execute it from the task alone.

## Checklist (do in order)

1. **Load inputs** read the `## Acceptance Criteria`, `## Design`, and `## Tech Stack` sections of
   `specs/<feature>/<feature>.md`, root `CONTEXT.md`, and `constitution.md`. If they contradict each
   other, loop back to the owning stage or run the gate first.
2. **Derive tasks from the design** walk the components and their contracts; for each, produce the
   smallest tasks that build it up, test-first.
3. **Order by dependency** a task may depend only on tasks before it. Foundations (contracts,
   schemas) before the code that uses them.
4. **Specify each task** exact files, the failing test to write first, the `AC-N` advanced, the
   component touched, and its dependencies.
5. **Check coverage both ways** every `AC-N` is advanced by at least one task (no gap), and every
   task traces to a criterion (no gold-plating).
6. **Constitution Check** confirm no task implies a violation of a MUST principle.
7. **Write the `## Plan` section** the ordered task list plus the task-to-criterion coverage map.
8. **Hand off** the plan goes to the gate, then build. A human "go" is optional;
   the gate is the real checkpoint.

## Principles

- **Write for an enthusiastic junior with no context.** Poor taste, no judgement, an aversion to
  testing: the plan must leave nothing to their discretion.
- **Test-first, always.** Every task names its failing test before any code. Tasks written without
  a test get the test added or get cut.
- **Atomic and green between tasks.** The repo compiles and passes after every task.
- **Traceability is the spine.** Task -> criterion -> component. The gate walks it;
  keep it intact.
- **YAGNI and DRY.** Build only what a criterion needs; do not repeat what a prior task built.
- **Loop, don't guess.** Inconsistent inputs mean an earlier stage is unsettled. Go back.

## Rationalizations (excuses to skip the bar, and the rebuttal)

| Excuse | Rebuttal |
| --- | --- |
| "I'll figure out the test during build." | The plan must be executable without thinking. Name the failing test now. |
| "This task is big but cohesive." | Cohesive is not atomic. Split until each finishes green on its own. |
| "Skip the AC reference, it's obvious." | The gate walks task -> criterion. An unreferenced task is invisible to it. |
| "Add this nice-to-have while we're in here." | Not in any criterion means not a task. That is the definition of gold-plating. |
| "Exact file paths are overkill." | The agent has no project context. Vague paths are where autonomous runs derail. |

## Red flags (stop and fix)

- A task with no exact file path.
- A task with no test or verification named.
- A task that traces to no criterion, or a criterion advanced by no task.
- Tasks out of dependency order, or a task depending on a later one.
- A task too large to finish green in a single pass.

## Done when

- Every task is atomic, with exact files, a test-first step, an `AC-N`, and a component.
- Tasks are dependency-ordered.
- Every criterion is covered by at least one task; no task is uncovered by a criterion.
- The Constitution Check passes.
- the `## Plan` section is written, with the coverage map.

## The artifact (output)

The `## Plan` section of `specs/<feature>/<feature>.md`, containing only:
- **Tasks** ordered, each with: ID (`T-1`, `T-2`, ...), title, exact files, the failing test to
  write first, the `AC-N` advanced, the component touched, and dependencies.
- **Task-to-criterion coverage map** `AC-N` -> the tasks that advance it, so coverage is visible.
- **Notes** any sequencing or setup caveats the build agent needs.

No product code. Build executes the tasks via red-green-refactor.

## Conventions

- Lives as the `## Plan` section of `specs/<feature>/<feature>.md`. Kept out of the repo's product `docs/`.
- Reads the `## Acceptance Criteria`, `## Design`, and `## Tech Stack` sections of the same file;
  references `AC-N` IDs and design component names.
- Task IDs (`T-N`) are stable handles the gate and build reference.
- This is feature-scoped; at project level it is the plan for the first feature after the
  project-level idea and architecture.
- Downstream consumers: the gate (walks criterion -> component -> product -> task),
  the build stage (executes each task test-first), and the review panel.
