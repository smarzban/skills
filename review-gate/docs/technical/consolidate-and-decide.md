# Consolidate & decide

These two pure modules are the spine. `consolidate` turns many reviewers' findings into clusters with
cross-model agreement; `decide` turns clusters + the agent's adjudications (+ run metadata for the
comment) into the verdict and the gate findings comment.

## `consolidate` (`src/consolidate.ts`)

Findings from **different models** at the same location are the "same" issue → one cluster. Clustering
is by **location**, not by the model's self-assigned `area` (the same bug gets tagged security vs
privacy vs correctness by different models, and we want those to converge).

- **Line window** — findings on the same file within `REVIEW_GATE_LINE_WINDOW` lines (default `15`)
  can merge. File-level findings (`line: 0`, e.g. path-based tool findings) cluster by title instead,
  so they don't mask a nearby lined finding.
- **Same-issue check** — co-location alone over-merges, so a merge also requires the titles to share a
  significant token (after stripping the `[area]` prefix and stopwords — including generic
  finding-descriptor words like "bug"/"issue" that carry no topical signal). If either title is
  uninformative, it falls back to the conservative location-only merge (under-merging is the safe
  direction). **Tool findings merge location-only** (a terse rule name won't share a model's prose).
- **Agreement** — `count` = distinct **models** that flagged it (tool findings never count toward it);
  `total` = the model panel size (tool outputs are excluded so they can't inflate `total` and falsely
  flip a unanimous finding to contested).
- **Contested** — `GATING && count > 0 && count < total`: a gating issue some models saw and others
  didn't. These most need the agent's eye. A unanimous gating finding just blocks; a tool-only finding
  (`count` 0) is a fact, not disagreement.

### The cluster-key contract

```
key = `${file}::${line}::${slug}`        // line is 0 for file-level findings
slug = the full normalized title (lowercased, [area] prefix stripped, non-alphanumerics → -)
```

The **full** title is in the key — no hash, no truncation — because the same line can carry two
distinct issues (the topical split emits two clusters there), and `decide` looks up adjudications **by
this exact key**. Without the title in the key, dismissing one would silently clear the other. (A hash
was rejected: a short hash is brute-forceable by an attacker-controlled title; identical full titles
aren't a useful collision — they're the same text.)

Clusters are returned sorted by severity (desc), then key.

## `decide` (`src/decide.ts`)

For each cluster (skipping `low`/`info` — advisory, never block):

1. **Deterministic (tool) cluster** → pushed to `blocking`. If an adjudication tries to dismiss it,
   that attempt is recorded in `rejectedOverrides` (surfaced in the comment) but the finding **stays
   blocking**. A cluster is "deterministic" if its representative or any member has `source: "tool"`.
2. **Model gating cluster with a `dismissed` adjudication + non-empty justification** → `dismissed`.
3. **Otherwise** (no adjudication, or a dismissal with an empty justification) → `blocking`.

`verdict = blocking.length > 0 ? "block" : "pass"`.

### Run metadata (`RunMeta`)

`decide` takes a third input, supplied by the trusted orchestrator (never a reviewer):
`{reviewers: [{reviewer, model}]}` — **every pass that ran**, including clean votes (a reviewer that
found nothing never reaches a cluster, so this is the only record of it). It feeds the comment's
"Reviewed by" line and is **provenance only — it never enters the verdict computation**. `decide`
rejects a falsy/non-object meta or a malformed reviewer entry (so a `null` `meta.json` can't silently
strip the roster), but an *omitted* meta is allowed for internal/unit use.

`RunMeta` also carries an optional `round` (1-based) — it numbers the comment heading
(`Review Gate — Round N`) and labels the progress delta. Like `reviewers`, it is provenance/display
only and never enters the verdict.

The orchestrator's **approval/sign-off is deliberately NOT part of `RunMeta`** — it is a separate,
free-form orchestrator review comment (see [../usage/review-gate.md](../usage/review-gate.md)), kept
out of the deterministic spine so it can be rich markdown and is never mistaken for a computed value.

### The PR comment & report

`decide` renders one `prComment` (the **gate findings comment**); the orchestrator posts a **fresh
comment on every run** (a run history, never an in-place edit):

- `## Review Gate` + a head line — `🚫 BLOCK — N blocking finding(s)…` or `✅ PASS — no blocking findings.`
- a severity tally (`N critical · N high · …`).
- **Reviewed by** — the distinct passes (holistic first, then lenses) across the distinct model roster,
  from `meta.reviewers`. The only place a **clean** reviewer is credited.
- **⚠️ Coverage** — planned reviewer passes with no usable vote this round (`meta.missing`): a thinned,
  auth-failed, or non-voting panel, made loud so it can't pass silently. Display only.
- **🔍 Scan tier degraded** — a deterministic scanner that ran but skipped a sub-scan (its tool absent,
  e.g. gitleaks → no secret scan), from `meta.scanWarnings`. Display only — never changes the verdict.
- **Must fix** (blocking), **Advisory (non-blocking)** (low/info).
- **⚠️ Deterministic findings — override NOT honored** — any attempted tool dismissals, still blocking.
- **Dismissed (with justification)** — honored model dismissals + their justifications.
- **Progress since Round N−1** — rendered only when `decide` is given the optional `previous` (the
  prior round's `blocking` clusters). A deterministic cluster-key set diff: ✅ resolved
  (`previous \ current`), ⏳ still-blocking (`previous ∩ current`), 🆕 new/regressed (current gating
  not in `previous`). Display + convergence signal only — it **never changes the verdict**, and
  "resolved" is purely set-difference against a real re-review, never an orchestrator assertion.

The orchestrator then posts a **second, separate comment** — its own review (what the PR implements,
what it doesn't cover, and an explicit Approve / Request-changes that must agree with `verdict`).

Agreement is labelled `tool` (a tool-only cluster), `k/N models`, or `k/N models + tool` (mixed) — a
tool-only cluster never shows "0/N models", which would wrongly imply models looked and disagreed. All
interpolated text is sanitized (see [trust-boundary.md](trust-boundary.md)).
