# Agent SDLC

A pipeline for AI coding agents that takes an idea to a reviewed pull request. The front half
settles intent, a checkable contract, a sound architecture, a grounded stack, and an atomic task
plan, with a read-only gate that confirms it all hangs together before a line of code is written.
The back half executes it: `build` runs the plan test-first — one fresh subagent per task, green
between each — and `ship` opens the reviewed PR.

Test and deploy are the next stages downstream, extending the same chain.

The bundle also ships two standalone documentation skills — `writing-readmes` and
`writing-repo-docs` — for the downstream job of documenting what you build. They sit outside the
pipeline spine and can be used on their own, on any repo.

## The idea

You own the thinking. The agent owns the breakdown. Every stage leads with a recommendation and
the alternatives, and you decide. A single traceability spine runs through the whole pipeline:

```
criterion -> component -> product -> task
```

Each stage adds one link; the gate walks the whole chain, so anything unmapped surfaces before
code rather than during it.

## Stages

| Skill | Invoke explicitly | Owner | Output |
| --- | --- | --- | --- |
| `idea` | `/agent-sdlc:idea` | you | `## Brief` (problem + scope) |
| `acceptance-criteria` | `/agent-sdlc:acceptance-criteria` | you review | `## Acceptance Criteria` (the contract) |
| `architecture-design` | `/agent-sdlc:architecture-design` | you, agent proposes | `## Design` (`## Architecture` at project level) |
| `techstack` | `/agent-sdlc:techstack` | you, agent proposes | `## Tech Stack` |
| `plan` | `/agent-sdlc:plan` | agent | `## Plan` (atomic tasks) |
| `gate` | `/agent-sdlc:gate` | automated (read-only) | `gate-report.md` |
| `build` | `/agent-sdlc:build` | agent | product code (a green branch) + `build-report.md` |
| `ship` | `/agent-sdlc:ship` | agent | a reviewed PR (invokes `review-gate`) |
| `getting-started` | auto / `/agent-sdlc:getting-started` | router | this is the entry point |

Start with `getting-started`; it routes you to the right stage and states the shared rules.

**Start anywhere.** Run the whole chain, or invoke any stage on its own — each resolves its input
from whatever you give it (the spec, a prompt, a doc, a Linear issue set, a repo artifact),
materializes it into the spec with a provenance marker, then runs. A plan already in Linear? `build`
ingests it, runs the `gate` inline, and builds — you don't have to hand-run the front half first. The
gate, the per-task TDD loop, and traceability are never skipped; a missing upstream link is marked
*untraced* and surfaced, never invented.

> **Invocation.** Installed as a plugin, every skill auto-activates when your request matches its
> `description` — that's the primary path, and you rarely type a command. To invoke one explicitly,
> use the **mandatory** plugin namespace, e.g. `/agent-sdlc:idea`. Bare names like `/idea` resolve
> only to *personal* skills (`~/.claude/skills/`), never to plugin skills — the `agent-sdlc:` prefix
> can't be dropped. Want shorter explicit names (e.g. `/agent-sdlc:criteria`)? Add a
> `commands/<name>.md` file to the plugin; it's still namespaced as `/agent-sdlc:<name>`.

## Documentation skills

Two skills outside the pipeline, for documenting a codebase. They are source-grounded (every
concrete claim is checked against the actual code) and adapt their structure to the repo's type.

| Skill | What it does |
| --- | --- |
| `writing-readmes` | Write/overhaul a project's front-door `README.md` — leads with what/why, keeps a lean quickstart distinct from full install, links out to deeper docs instead of inlining them. |
| `writing-repo-docs` | Write/overhaul full repository documentation — a landing index + quickstart + install + usage + technical/internals, shaped to the repo type. |

## Layout

```
agent-sdlc/
├── README.md
├── .claude-plugin/plugin.json   ← Claude Code manifest
├── .cursor-plugin/plugin.json   ← Cursor manifest
└── skills/
    ├── idea/SKILL.md
    ├── acceptance-criteria/SKILL.md
    ├── architecture-design/SKILL.md
    ├── techstack/SKILL.md
    ├── plan/SKILL.md
    ├── gate/SKILL.md
    ├── build/                         ← SKILL.md + reference/ (subagent-loop · tdd · source-driven · simplicity · debugging)
    ├── ship/                          ← SKILL.md + reference/finishing.md
    ├── getting-started/SKILL.md
    ├── linear-sync/                   ← SKILL.md + reference/mapping.md (optional engine)
    ├── writing-readmes/SKILL.md       ← documentation skill
    └── writing-repo-docs/SKILL.md     ← documentation skill
```

A run produces, per feature:

```
specs/<feature>/
├── <feature>.md      ← ## Brief · ## Acceptance Criteria · ## Design · ## Tech Stack · ## Plan
├── gate-report.md    ← gate output (read-only)
└── build-report.md   ← build output (the resumable task ledger)
```

plus, at project level, `specs/overview.md` (`## Overview` · `## Architecture` · `## Tech Stack`)
and `specs/adr/` for decision records, and root-level `constitution.md` + `CONTEXT.md` (glossary).
`build` then lands the code on a feature branch and `ship` opens the reviewed PR — neither edits the
spec.

## Linear sync (optional)

Agent SDLC can mirror each stage into [Linear](https://linear.app) as you go — initiative (product)
→ project (feature) → milestone (build phase) → issue (task) — driven by the `linear-sync` skill. As
you build and ship, the `T-N` issues advance (Backlog → In Progress → In Review → Done) and the PR
is attached to them. It's **off by default**; enable it by setting `linear.enabled: true` in `.agent-sdlc/config.json`
(with the product's `initiative` and `team`). When the Linear MCP isn't connected, the steps are
skipped, so an Agent SDLC run never depends on it.

## Install

This bundle ships from the [`smarzban-skills`](../README.md) marketplace at the repo root, which
is installable in both Claude Code and Cursor. See that README for one-time setup, then:

```text
/plugin install agent-sdlc@smarzban-skills      # Claude Code
```

In Cursor, import the repo as a team marketplace (Settings → Plugins → Import) and enable
`agent-sdlc`. The skills are plain Markdown to the open `SKILL.md` standard, so they also work with
any other agent that reads instruction files — drop the `skills/<name>` dirs where that harness
discovers skills.
