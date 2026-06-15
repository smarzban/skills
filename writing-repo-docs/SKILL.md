---
name: writing-repo-docs
description: Use when asked to write, generate, or overhaul documentation for a codebase or repository — for end users, operators, and/or engineers. Produces a structured, source-grounded doc guide (a landing index + quickstart + install/setup + usage/how-to + technical/internals), adapted to the repo's type, with every concrete claim verified against the actual code. Also use when asked to make docs that can power an in-app/help-function corpus.
---

# Writing Repo Docs

Produce a documentation guide for a codebase that is **accurate**, **audience-separated**, and **adapted to what the repo actually is** — not a one-size template. The output is a tree of small, cross-linked Markdown files that double as an in-app help corpus.

**Announce at start:** "I'm using the writing-repo-docs skill to document this repository."

## The core principle

**Every concrete claim is grounded in the source.** Constants, function/module names, env vars, defaults, endpoints, commands, file paths, behavior — read the code and verify before you write it. Docs that confidently state wrong facts are worse than no docs. The verification pass (Phase 3) is not optional.

The second principle: **separate by audience.** People who *use* the thing, people who *install/operate* it, and people who *build on / maintain* it need different docs. Don't blend them.

## Checklist (turn each into a tracked task)

1. **Understand the repo** — what it is, its surface, its existing docs.
2. **Decide audiences + structure** — adapt the skeleton to the repo type.
3. **Write per-section, grounded in source** — small files, cross-linked.
4. **Verify** — link-check + fact-check pass; fix every inaccuracy.
5. **Index + report** — landing page, and tell the user what you built and any caveats.

## Phase 1 — Understand the repo (before writing anything)

Read enough to answer: *what is this, who uses it, and what are its moving parts?*

- **Project type** — library/SDK, CLI tool, web service/API, full application, framework, or monorepo. This drives everything (see `reference/structure-by-repo-type.md`).
- **Entry points & public surface** — the README, the package manifest (`pyproject.toml`/`package.json`/`Cargo.toml`/`go.mod`), the CLI command definitions, the exported API, the HTTP routes, the config/settings.
- **Existing docs** — README, `docs/`, `CLAUDE.md`/`AGENTS.md`, specs, ADRs, decision logs. Reuse canonical content, but **treat existing docs as suspect**: they drift. Note contradictions and stale claims rather than copying them forward (e.g. a README that describes a feature that was removed, or a stated default the code no longer uses).
- **Module/component map** — the main modules and what each is responsible for.
- **Audiences** — does this repo have end users? operators/deployers? API consumers? only maintainers? Decide which audience docs are warranted; don't write an "operator" section for a pure library.

Capture a short internal map (project type, audiences, module list, canonical sources) before structuring.

## Phase 2 — Decide audiences + structure (adapt, don't impose)

Start from the **default skeleton** and trim/extend it for the repo type. Read `reference/structure-by-repo-type.md` for the per-type layouts.

Default skeleton — rooted directly at `docs/` (files and folders live under
`docs/` itself; only nest under a subfolder if the repo already uses `docs/` for
something else):

```
docs/
README.md          landing page: what it is + a "who starts where" map + index
quickstart.md      the fastest path to a working result
install/           getting set up + configuration reference + (if applicable) deploy/ops
usage/             how to USE each feature — for the people who consume the thing
technical/         how it WORKS and WHY — architecture + per-subsystem, for maintainers
```

Adapt:
- A **library** has no "deploy"; its `usage/` is API usage and its `technical/` is concepts + internals + contributing.
- A **CLI** `usage/` is a command reference + recipes.
- A **service/app** keeps the full split (install + ops, how-to per feature, architecture).
- Name sections in the repo's own terms. Drop any section that doesn't apply (**YAGNI** — an empty "auth modes" page is worse than no page).

**Break docs into small, single-section files.** One concept per file: it's easier to keep accurate, easier to cross-link, and each can be surfaced individually by an in-app help function. Always include a top-level `README.md` index that routes the reader.

## Phase 3 — Write per-section, grounded in source

For each file:

- **Verify every concrete claim against the code as you write it.** Don't infer a default, an env var name, a constant, or a behavior — open the source and confirm. When you describe an endpoint list, a CLI command set, or a config table, check it against the actual definitions.
- **Explain the *why*, not just the *what*, in technical docs.** Design rationale, invariants, and trade-offs are the durable value; an engineer can read the code for the *what*.
- **Match the repo's terminology** and the surrounding doc voice.
- **Cross-link with relative paths** so the corpus navigates as one.
- **No filler, no placeholders.** No "TBD", no "add details here", no padding. If you can't verify something, find out or leave it out — don't guess.

Write in focused batches; keep any orchestrator/index file thin.

## Phase 4 — Verify (do not skip)

Read `reference/fact-check-and-verify.md` for the full checklist. At minimum:

- **Link check** — every internal relative link resolves to a real file (a tiny script that parses `[...](...)` and stats the target).
- **Fact-check pass** — re-read the technical docs against the source with fresh eyes and fix every inaccuracy. If a subagent / second agent is available, dispatch an adversarial fact-check ("find any statement contradicted by the code") — a second pass reliably catches wrong constants, renamed symbols, and stale defaults the author's eye skips. Record which source files were checked.
- **Placeholder scan** — no TBD/TODO/empty sections.

Fix everything the verification surfaces before declaring done.

## Phase 5 — Index + report

- Ensure the landing `README.md` indexes everything and tells each audience where to start.
- **Make the docs agent-discoverable (GEO).** The same small files + clear headings
  that help a reader also help AI search/agents retrieve and summarize. Use the real
  category/stack terms in the landing description so an agent can match what someone
  is looking for, and — when the docs are/will be published — add an
  [`llms.txt`](https://llmstxt.org/) at the root: a curated Markdown map linking the
  key pages (the GEO analog of `sitemap.xml`).
- Tell the user: where the docs live, the file tree, that they're per-section (help-function-ready), and **any caveats you found** — especially contradictions between existing docs/comments and the code (surface them; offer to fix the code separately rather than silently papering over them).

## Principles

- **Accuracy over completeness over polish** — a wrong fact undermines the whole guide; an unverified claim is a bug.
- **Audience separation** — use / install-operate / build are distinct readers.
- **Small files** — one section each; help-function-ready; easy to keep correct.
- **Adapt to the repo** — derive structure from what it *is*; don't force a template.
- **The "why" is the durable part** of technical docs.
- **Existing docs are suspect** — reuse canonical phrasing, but verify and flag drift.

## Red flags (stop and fix)

- Writing a default value, constant, env var, endpoint, or command **without opening the source** to confirm it.
- Copying a claim from an old README/comment without checking it still holds.
- One giant file that mixes user how-to and internals.
- Imposing the full skeleton on a repo that doesn't need half of it.
- Declaring done without a link check and a fact-check pass.
- Any "TBD"/placeholder shipped in the output.
