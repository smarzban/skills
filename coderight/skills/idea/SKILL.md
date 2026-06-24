---
name: idea
description: "Turn a fuzzy idea or a specific feature request into a settled problem statement, scope, and resolved key decisions, through divergent exploration then relentless one-at-a-time grilling, capturing canonical terminology as you go. Use at the very start of any feature or project, BEFORE acceptance criteria or any design. Triggers: 'shape this idea', 'scope this out', 'frame the problem', 'I want to build', 'I want to add a feature', 'let's think through'. Deliberately distinct from generic brainstorming: it stops at settled intent and scope."
---

# Idea: shape intent before criteria

Turn an idea or feature request into a settled, agreed problem and scope. The output is shared
understanding plus a short artifact the acceptance-criteria stage can consume. This phase explores
and converges; it does not specify.

<HARD-GATE>
Stop at settled intent and scope. Do NOT write acceptance criteria, functional requirements,
success criteria, a design doc, or any code. Those belong to later stages. The terminal action of
this skill is a settled idea artifact the user has approved, handed to the acceptance-criteria
step.
</HARD-GATE>

## Checklist (do in order)

1. **Explore context** files, docs, recent commits, and whether this is an existing project: look
   for `specs/overview.md`, a `constitution.md`, and a `CONTEXT.md`.
2. **Set level and depth** *level*: **project** (clean repo, no overview/constitution, so you are
   shaping a whole app) or **feature** (existing project, so you are shaping one piece); *depth*:
   vague idea (diverge first) or specific (converge fast). Level decides what you produce and where
   it lands (see Two levels); depth scales step 4. A specific-sounding ask still gets a short pass
   to pressure-test scope.
3. **Scope-check / decompose** if the ask spans several independent pieces, flag it and decompose.
   At project level this decomposition is a main output (the feature list). At feature level, if it
   is really several features, split and shape the first.
4. **Diverge** propose 2-3 approaches with tradeoffs, leading with your recommendation and why.
   Heavy for a vague idea, light for a specific feature.
5. **Grill to converge** interview one question at a time, walking down the decision tree and
   resolving dependencies between decisions one by one. Give a recommended answer with every
   question. Prefer multiple-choice. If the codebase can answer it, explore the code instead of
   asking.
6. **Keep terminology sharp** (throughout step 5) sharpen fuzzy or overloaded terms into a single
   canonical term, challenge anything that conflicts with the glossary, stress-test relationships
   with concrete scenarios, and cross-check the user's claims against the code.
7. **Capture inline** (as terms/decisions resolve, never batched) update `CONTEXT.md` (glossary
   only, no implementation detail), and offer an ADR only when the decision is *hard to reverse*
   AND *surprising without context* AND *a real tradeoff*. Flag any conflict with the constitution
   immediately.
8. **Settle and write the artifact** present the settled problem, scope, non-goals, chosen
   approach, and resolved decisions in sections scaled to complexity, and get approval. Where it
   lands depends on the level (see Two levels): a **feature** writes the `## Brief` section of
   `specs/<feature>/<feature>.md` and appends the feature to `overview.md`'s feature list; a
   **project** writes the `## Overview` section of `specs/overview.md` and seeds root-level
   `constitution.md` and `CONTEXT.md`. Either way, keep it out of the repo's product `docs/`.
9. **Hand off** for a **feature**, tell the user it is ready for the acceptance-criteria step. For
   a **project**, hand back the feature list and offer to shape the first feature next (its own
   `specs/<feature>/<feature>.md` pass). Do not start the next step yourself.

## Principles

- **One question at a time.** Multiple-choice when you can; always give your recommended answer
  (the system-wide recommend-and-alternatives rule).
- **Code over questions.** If the codebase answers it, go look instead of asking.
- **YAGNI.** Cut anything the problem doesn't actually need.
- **Terms before details.** A decision phrased in fuzzy language isn't resolved.
- **Loop when grilling exposes a fuzzy problem.** Drafting a decision often reveals the framing
  wasn't settled; go back, re-settle, then continue.
- **Recommend, don't just ask.** Every open question carries your proposed answer and why.

## Done when

- You can state the problem and scope in a few crisp sentences.
- The terms in play are canonical and captured in `CONTEXT.md`.
- Every key decision is resolved, or explicitly deferred with the reason.
- The user has approved the settled artifact.

## The artifact (output)

A short file containing only:
- **Problem / intent**
- **Scope & non-goals**
- **Chosen approach** and why, over the alternatives considered
- **Resolved key decisions**
- **Glossary terms touched**
- **Any ADRs**

No requirements, no success criteria, no design detail. Those are the next stage. This content is
the `## Brief` section of `specs/<feature>/<feature>.md`. At **project** level the same shape is
the `## Overview` section of `specs/overview.md`, plus the feature decomposition (the list of
features the project breaks into).

## Two levels: project vs feature

The same skill runs at two scopes, decided in step 2.

**Project** (clean repo, "I want to build an app for X"): you are shaping the whole project.
Outputs are the north-star plus the breakdown into features:
- `specs/overview.md` `## Overview` problem, scope, overall shape, and the feature decomposition
- `constitution.md` (root) standing principles, seeded here
- `CONTEXT.md` (root) the initial glossary

A project pass ends by handing over the feature list; each feature is then its own feature-level
pass.

**Feature** (existing project, "I want to add X"): you are shaping one piece:
- the `## Brief` section of `specs/<feature>/<feature>.md` — this feature's settled intent (later
  joined by the `## Acceptance Criteria`, `## Design`, `## Tech Stack`, and `## Plan` sections in
  the same file).

Layout:
```
/
├── constitution.md          ← standing principles (project-wide)
├── CONTEXT.md               ← glossary (project-wide)
└── specs/
    ├── overview.md          ← project tier: ## Overview · ## Architecture · ## Tech Stack
    ├── adr/                 ← decision records
    └── <feature>/
        ├── <feature>.md     ← ## Brief (here) · ## Acceptance Criteria · ## Design · ## Tech Stack · ## Plan
        └── gate-report.md   ← gate output
```

## Conventions

- `CONTEXT.md` is a glossary and nothing else, devoid of implementation detail, not a spec or
  scratchpad. It lives at the repo root (canonical vocabulary the whole repo shares). Create it
  lazily, when the first term is resolved.
- ADRs live under `specs/adr/` and are created only when the three-part test above is met.
- If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts; resolve terms in the
  context they belong to.
- Keep the trigger distinct from any `brainstorming` skill you may also have installed, so this
  one fires when you mean to run the CodeRight pipeline.
