# skills

A personal collection of reusable agent skills, packaged as an installable
**plugin** for both [Claude Code](https://claude.com/claude-code) and
[Cursor](https://cursor.com). One source of truth, dual-wrapped: the skills live
in a standard `skills/<name>/SKILL.md` layout, and a thin manifest per tool makes
the repo installable natively in each.

A *skill* is a directory containing a `SKILL.md` (with `name` + `description`
frontmatter) and optional supporting files. The `description` is what the agent
matches on to trigger the skill. Skills are an open standard, so the `SKILL.md`
content is portable across agents even where the packaging differs.

## Plugin: `agent-sdlc`

A pipeline that takes an idea to a reviewed PR — plan it, build it test-first,
open the PR — plus skills for writing the project's docs. See
[`agent-sdlc/README.md`](agent-sdlc/README.md) for the full pipeline and the
traceability spine that runs through it.

| Skill | What it does |
|---|---|
| `getting-started` | Entry point and operating rules — routes you to the right stage. |
| `idea` | Turn a fuzzy idea or feature request into a settled problem + scope. |
| `acceptance-criteria` | Turn the idea into a checkable contract. |
| `architecture-design` | Turn criteria into a logical architecture shape. |
| `techstack` | Turn the design into concrete product/library choices. |
| `plan` | Turn it all into an atomic, agent-executable task plan. |
| `gate` | Read-only: walk the whole chain before any code. |
| `build` | Execute the plan test-first, one subagent per task, to a green branch. |
| `ship` | Open a PR from the spec and hand it to review-gate. |
| `writing-readmes` | Write/overhaul a project's front-door `README.md`. |
| `writing-repo-docs` | Write/overhaul full source-grounded repository documentation. |

## Install

The repo is both a Claude Code marketplace (`.claude-plugin/marketplace.json`)
and a Cursor marketplace (`.cursor-plugin/marketplace.json`), named
`smarzban-skills`.

### Claude Code

```text
/plugin marketplace add smarzban/skills
/plugin install agent-sdlc@smarzban-skills
```

Skills then trigger on their `description`, or invoke explicitly with the plugin
namespace, e.g. `/agent-sdlc:idea` or `/agent-sdlc:writing-readmes`.

### Cursor

Settings → Plugins → **Import** under Team Marketplaces, paste the repo URL
(`https://github.com/smarzban/skills`), review the parsed plugin, and enable it.
Cursor tracks the default branch automatically; **re-import to pick up newly
added plugins.** Skills auto-activate by context, or invoke them by name via
`@` / slash.

### Any other agent

The skills are plain Markdown to the open `SKILL.md` standard, so they work with
any agent that reads instruction files (e.g. Codex reads `SKILL.md` from
`.codex/skills/`). Copy or symlink the individual `agent-sdlc/skills/<name>`
directories into wherever your harness discovers skills; the `.claude-plugin/`
and `.cursor-plugin/` wrappers are simply ignored elsewhere.

## Layout

```
skills/                              ← repo root = a marketplace for two tools
├── .claude-plugin/marketplace.json  ← Claude Code install index
├── .cursor-plugin/marketplace.json  ← Cursor install index
└── agent-sdlc/                       ← the plugin
    ├── .claude-plugin/plugin.json
    ├── .cursor-plugin/plugin.json
    ├── README.md
    └── skills/<name>/SKILL.md        ← 12 skills
```

## Adding a skill

Skills live inside the plugin's `skills/` directory. To add one, create
`agent-sdlc/skills/<skill-name>/SKILL.md`:

```markdown
---
name: <skill-name>
description: Use when … — a precise trigger so the right tasks pick it up.
---

# <Skill Name>

…the method…
```

Keep `SKILL.md` focused; put long templates/checklists in a `reference/` subdir
the skill points to on demand. Both Claude Code and Cursor auto-discover any
subdirectory of `skills/` that contains a `SKILL.md`, so no manifest edit is
needed for a new skill.

### Adding a new plugin

Create `<plugin-name>/` with a `skills/` dir plus two manifests
(`.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json`), then add an
entry to both root marketplace files. Commit and push. (In Cursor, re-import the
repo to pick up the new plugin.)
