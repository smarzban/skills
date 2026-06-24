# CodeRight

A planning pipeline for AI coding agents. CodeRight takes an idea to the point where an agent can
build it autonomously and well: settled intent, a checkable contract, a sound architecture, a
grounded stack, and an atomic task plan, with a read-only gate that confirms it all hangs together
before a line of code is written.

It is the front half of the lifecycle. Build, test, and deploy are downstream and extend the same
chain (the gate already guards build; the task plan feeds it).

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
| `idea` | `/coderight:idea` | you | `brief.md` (problem + scope) |
| `acceptance-criteria` | `/coderight:acceptance-criteria` | you review | `acceptance-criteria.md` (the contract) |
| `architecture-design` | `/coderight:architecture-design` | you, agent proposes | `design.md` / `architecture.md` |
| `techstack` | `/coderight:techstack` | you, agent proposes | `techstack.md` |
| `plan` | `/coderight:plan` | agent | `plan.md` (atomic tasks) |
| `gate` | `/coderight:gate` | automated (read-only) | `verify-report.md` |
| `using-coderight` | auto / `/coderight:using-coderight` | router | this is the entry point |

Start with `using-coderight`; it routes you to the right stage and states the shared rules.

> **Invocation.** Installed as a plugin, every skill auto-activates when your request matches its
> `description` — that's the primary path, and you rarely type a command. To invoke one explicitly,
> use the **mandatory** plugin namespace, e.g. `/coderight:idea`. Bare names like `/idea` resolve
> only to *personal* skills (`~/.claude/skills/`), never to plugin skills — the `coderight:` prefix
> can't be dropped. Want shorter explicit names (e.g. `/coderight:criteria`)? Add a
> `commands/<name>.md` file to the plugin; it's still namespaced as `/coderight:<name>`.

## Documentation skills

Two skills outside the pipeline, for documenting a codebase. They are source-grounded (every
concrete claim is checked against the actual code) and adapt their structure to the repo's type.

| Skill | What it does |
| --- | --- |
| `writing-readmes` | Write/overhaul a project's front-door `README.md` — leads with what/why, keeps a lean quickstart distinct from full install, links out to deeper docs instead of inlining them. |
| `writing-repo-docs` | Write/overhaul full repository documentation — a landing index + quickstart + install + usage + technical/internals, shaped to the repo type. |

## Layout

```
coderight/
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
    ├── using-coderight/SKILL.md
    ├── writing-readmes/SKILL.md       ← documentation skill
    └── writing-repo-docs/SKILL.md     ← documentation skill
```

A run produces, per feature:

```
specs/<feature>/
├── <feature>.md      ← ## Brief · ## Acceptance Criteria · ## Design · ## Tech Stack · ## Plan
└── gate-report.md    ← gate output (read-only)
```

plus, at project level, `specs/overview.md` (`## Overview` · `## Architecture` · `## Tech Stack`)
and `specs/adr/` for decision records, and root-level `constitution.md` + `CONTEXT.md` (glossary).

## Install

This bundle ships from the [`smarzban-skills`](../README.md) marketplace at the repo root, which
is installable in both Claude Code and Cursor. See that README for one-time setup, then:

```text
/plugin install coderight@smarzban-skills      # Claude Code
```

In Cursor, import the repo as a team marketplace (Settings → Plugins → Import) and enable
`coderight`. The skills are plain Markdown to the open `SKILL.md` standard, so they also work with
any other agent that reads instruction files — drop the `skills/<name>` dirs where that harness
discovers skills.
