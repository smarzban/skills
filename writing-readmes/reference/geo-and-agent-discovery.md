# GEO / SEO / agent discoverability

How to make a project findable and correctly summarizable by AI search engines,
coding agents, and crawlers — not just readable by a human. "GEO" = Generative
Engine Optimization (the LLM-era analog of SEO).

## The honest mental model

Two different things, often conflated:

- **Discovery** — can an agent/search *find* the repo when someone asks for
  "something like this"? Driven mostly by signals **outside** the README.
- **Matching & summarization** — once found, does the content match the query and
  get summarized accurately? Driven by the README/doc **text and structure**.

A great README improves matching/summarization; it does **not** by itself make a
private or metadata-less repo discoverable. Be honest about this with the user.

## The levers, ranked

1. **Public.** A private repo is crawled/indexed by nobody. This usually gates
   everything else; if the repo is private, say so and treat GEO as "prepare now,
   effective when public." (Owner decision.)
2. **Repo metadata.** The GitHub `description` + `topics`/tags, and the package
   manifest (`pyproject.toml`/`package.json`) description + keywords. For an agent
   searching GitHub or a registry, this is often the strongest single lever — set
   it with the same high-intent terms as the README.
3. **README clarity, terminology & structure.** What this skill mostly controls
   (below).
4. **`llms.txt`.** For a project with a docs tree/site, a curated agent-facing map
   (below).
5. **External presence.** Backlinks, "awesome-*" lists, blog posts, package-registry
   listing. Outside the repo, but the highest-ceiling lever long-term.

## Make the README itself GEO-strong

- **First sentence is a keyword-true, declarative "what is this."** Name the
  category in the words people search: "retrieval-augmented generation (RAG)",
  "CLI tool", "ORM", "feature-flag service". Avoid leading with a clever tagline
  that hides the category.
- **Use the terms of the need, not just the build.** Include the stack/protocol
  names (e.g. `MCP`, `FastAPI`, `sqlite-vec`, `OpenAI`/`Ollama`) *and* the
  problem/category words (`self-hosted`, `knowledge base`, `semantic search`,
  `RBAC`). Agents match on both.
- **"Alternative to X" framing when honest.** "A self-hosted, open-source
  alternative to hosted RAG / 'chat-with-your-docs' tools" matches a very common
  query shape. Only when true.
- **Structure for retrieval.** Short, self-contained sections under clear headings;
  bullets, tables, fenced code. These are the chunks an LLM lifts verbatim.
- **Specific and current beats vague.** Concrete commands, real defaults, real
  numbers, dates. GEO rewards authoritative specificity; vague marketing gets
  ignored or paraphrased wrong.
- **Accurate** — a wrong fact gets quoted wrong by every agent that reads it.

## Set repo metadata (do this, it's cheap)

GitHub:

```bash
gh repo edit <owner>/<repo> \
  --description "<one keyword-rich sentence — same terms as the README>"
gh repo edit <owner>/<repo> \
  --add-topic <term> --add-topic <term> ...     # lowercase, hyphenated, up to 20
```

Pick topics from: the category (`rag`, `knowledge-base`), the deployment model
(`self-hosted`), the stack (`fastapi`, `sqlite-vec`, `react`), the
protocols/integrations (`mcp`, `slack-bot`), and the domain (`llm`, `semantic-search`,
`vector-search`, `rbac`). Mirror the package manifest's description/keywords.

## Add an `llms.txt` (when there's a docs tree)

[`llms.txt`](https://llmstxt.org/) is an emerging convention: a top-level Markdown
file that gives LLMs a curated, link-rich map of the project's docs — the GEO
analog of `sitemap.xml`/`robots.txt`. Shape:

```markdown
# Project Name

> One-sentence description (same as the README's).

Optional short paragraph of orienting context.

## Docs
- [Quick start](path-or-url): the fastest path to a result.
- [Install guide](path-or-url): setup, configuration, deployment.
- [User guide](path-or-url): how to use each feature.
- [Technical docs](path-or-url): architecture and internals.

## Optional
- [Lower-priority links an agent can skip if short on context]
```

Use full URLs once docs are hosted; relative repo paths are a reasonable stand-in
for an unpublished repo. Keep it in sync with the docs it maps.

## What needs the owner (flag, don't fake)

- Making the repo **public**.
- Final wording of the **description/tagline** and the **topic** set (propose a
  set; let them confirm).
- A **screenshot/social-preview image** if no asset exists (don't link a missing file).
