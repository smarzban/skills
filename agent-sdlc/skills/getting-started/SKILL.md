---
name: getting-started
description: "Entry point and operating rules for Agent SDLC, the pipeline that takes an idea to a reviewed PR. Use at the start of any project or feature to pick the right stage, understand the hand-offs, and follow the shared rules every stage obeys. Triggers: 'where do I start', 'what stage am I in', starting a new project or feature, 'use agent-sdlc', or deciding which Agent SDLC skill applies. Read this first; it routes to the others."
---

# Using Agent SDLC: idea to a reviewed PR

Agent SDLC takes an idea to a reviewed pull request. The **front half** is five thinking stages plus
a read-only gate: you own the thinking (intent, scope, criteria, shape, stack), the agent owns the
breakdown (plan), and the gate confirms it all hangs together before any code is written. The **back
half** is two agent-driven stages — `build` executes the plan test-first, `ship` opens the reviewed
PR. (Test and deploy are later additions to the same chain.)

## The stages

| # | Skill | Invoke | Owner | Reads | Writes |
| --- | --- | --- | --- | --- | --- |
| 1 | `idea` | `/agent-sdlc:idea` | you | the idea | `## Brief` (feature) — or `## Overview` + feature list (project) |
| 2 | `acceptance-criteria` | `/agent-sdlc:acceptance-criteria` | you review | `## Brief` | `## Acceptance Criteria` — the contract (`AC-N`) |
| 3 | `architecture-design` | `/agent-sdlc:architecture-design` | you (agent proposes) | `## Brief`, `## Acceptance Criteria` | `## Design` (`C-N`) — feature; `## Architecture` — project |
| 4 | `techstack` | `/agent-sdlc:techstack` | you (agent proposes) | `## Design`, `## Acceptance Criteria` | `## Tech Stack` (products per kind) |
| 5 | `plan` | `/agent-sdlc:plan` | agent | `## Acceptance Criteria`, `## Design`, `## Tech Stack` | `## Plan` — atomic tasks (`T-N`) |
| 6 | `build` | `/agent-sdlc:build` | agent | `## Plan`, `gate-report.md` | product code (a green branch) + `build-report.md` |
| 7 | `ship` | `/agent-sdlc:ship` | agent | `build-report.md`, the spec | a reviewed PR (invokes `review-gate`) |

Feature-tier sections live in `specs/<feature>/<feature>.md`; project-tier sections (`## Overview`,
`## Architecture`, `## Tech Stack`) live in `specs/overview.md`. Stages 1–5 each own and edit only
their own section; `build` writes product code + `build-report.md`, and `ship` opens the PR — neither
edits the spec.

Cross-cutting: **`constitution.md`** (standing guardrails, seeded by `idea`, checked at design and
plan) and the **`gate`** (`/agent-sdlc:gate`; read-only; walks the chain and writes
`gate-report.md`). The gate stands between plan and build: build runs only on a clean verdict.

The flow: `idea -> acceptance-criteria -> architecture-design -> techstack -> plan -> gate -> build -> ship`.

## Optional: Linear sync

If enabled in `.agent-sdlc/config.json` (`linear.enabled: true`), each stage mirrors its output into
Linear at its hand-off — initiative (product) → project (feature) → milestone (build phase) → issue
(task). `build` and `ship` transition those milestones and issues as code lands and the PR opens
(Backlog → In Progress → In Review → Done, plus PR attachment). The mechanics live in the
`linear-sync` skill; with the Linear MCP absent (e.g. headless runs) the steps are skipped. Off by
default — Agent SDLC runs identically without it.

## Shared operating rules (every stage obeys these)

Stated once here; the stage skills reference them by name rather than restating.

- **Recommend, don't just ask.** Every stage leads with the agent's recommended answer and the
  alternatives it considered with tradeoffs. You decide. This holds at every question in every
  stage. (The agent-driven stages — `plan`, `build`, `ship` — run autonomously; they stop and ask
  only at a genuine blocker.)
- **One question at a time.** Multiple-choice where possible. Walk the decision tree, do not dump.
- **Code over questions.** If the repo answers it, go read it instead of asking.
- **Loop, don't force.** When a stage exposes that an earlier one was not actually settled, go
  back and re-settle, then continue. A fuzzy input is never patched over.
- **Traceability is the spine.** criterion -> component -> product -> task. Each stage adds one
  link; the gate walks the whole chain, and build commits one task at a time against it. Anything
  unmapped surfaces before code.
- **YAGNI throughout.** Build only what the criteria need, at every stage: no aspirational
  criteria, no speculative components, no needless dependencies, no gold-plated tasks.
- **Stay in your stage.** Tech-agnostic until design; product-free until techstack; no code until
  build; no PR until ship. Each stage names the next thing down, not all of them.
- **Test-first in build.** Every task names its failing test in the plan; build writes that test
  before any code and keeps the repo green between tasks.
- **Ground in live docs over memory**, at techstack and again in build: verify current versions and
  APIs against official documentation, and record what you checked and when.
- **Evidence before "done".** Claim a suite green, a task complete, or a PR ready only after running
  the check and reading its output — never from memory or expectation.

## Routing: project vs feature

Decide the level the way `idea` does, and carry it through.

- **Project** (clean repo, building a whole app): `idea` writes `specs/overview.md` `## Overview`
  (incl. the feature list) and seeds `constitution.md` and `CONTEXT.md`. `architecture-design`
  writes the north-star `## Architecture`, and `techstack` the cross-cutting `## Tech Stack`, both
  in `overview.md`. Each feature then runs the full chain in its own `specs/<feature>/<feature>.md`.
- **Feature** (existing project, adding a piece): run the chain in `specs/<feature>/<feature>.md`,
  fitting the existing `overview.md` architecture and stack, justifying any deviation with an ADR
  in `specs/adr/`.

## File layout

```
/
├── constitution.md          ← standing principles (project-wide)
├── CONTEXT.md               ← glossary (project-wide)
└── specs/
    ├── overview.md          ← project tier: ## Overview · ## Architecture · ## Tech Stack
    ├── adr/                 ← decision records
    │   └── ADR-NNNN-<slug>.md
    └── <feature>/
        ├── <feature>.md     ← feature tier: ## Brief · ## Acceptance Criteria · ## Design · ## Tech Stack · ## Plan
        ├── gate-report.md   ← gate output (read-only)
        └── build-report.md  ← build output (the resumable ledger)
```

## Where to start

- A new app, vague idea: start at **`idea`**, project level.
- A new feature on an existing app: start at **`idea`**, feature level (often a light pass).
- You already have a settled problem and scope: start at **`acceptance-criteria`**.
- You have approved criteria: **`architecture-design`**, then **`techstack`**, then **`plan`**.
- A `## Plan` section exists in `<feature>.md`: run **`gate`**, then **`build`**.
- The branch is built and green (`build-report.md` all done): run **`ship`** to open the reviewed PR.

If you are unsure which stage you are in, you are probably one stage earlier than you think. The
cheapest fix is always upstream.
