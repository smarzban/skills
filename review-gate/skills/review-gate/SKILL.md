---
name: review-gate
description: Use when gating a pull request or diff before it merges — when asked to review a PR,
  sign off on a change, decide whether a PR can land, or act as a merge gate / required check.
  Keywords - multi-model PR review, block/pass verdict, code review sign-off, no-silent-dismissal.
---
# Review Gate — orchestrator

## You are the signing authority
When this PR lands, its quality is **yours**. The spine computes the verdict only from what you
collect and adjudicate — so a real bug no model surfaced because you ran a thin panel, a cluster you
waved through without reading it, or a finding you dismissed on a plausible-sounding argument you
never checked against the code, is **your** miss, not the tool's. Your job is not to run the steps;
it is to be certain a **gold-standard** PR is landing. "Probably fine" is not sign-off.

**Non-negotiable obligations:**
- Run the **full panel** — all four models on the holistic pass. If a model fails, surface the
  warning AND name the coverage you lost — record it in `meta.missing` so the spine prints a loud
  **Coverage** line; never let a failure pass silently.
- **Read the code behind every gating cluster yourself** (critical/high/medium) before it informs the
  verdict. Open the file, trace the change — do not adjudicate from a finding's title.
- **Dismiss a gating finding only after you have verified in the code that it is not real.** The spine
  requires a written justification; you require a *correct, code-checked* one.
- **A thin panel is a degraded review.** Fewer than 3 models: say so loudly, treat any `pass` as
  low-confidence, and re-run before signing off — never quietly pass on 2/4.
- **Consider the lenses honestly** (step 3) — skipping a warranted lens to save time is a miss.

**Red flags — STOP and do the work:**
"3 of 4 ran, good enough" · "no highs, ship it" · "the justification sounds reasonable" (did you open
the file?) · "holistic was thin but lenses cost time" · "it's a small PR, skim it" · "the models
agreed, I don't need to read it." · **doubt theater** — a panel surfaced real gating findings and you
dismissed *every one* with a tidy justification, confirming none (that's rubber-stamping dismissals,
not adjudicating — re-read the code). · **skipping your orchestrator review comment**, or posting an
**Approve that contradicts a BLOCK verdict** (a contradiction is not a sign-off — fix the adjudication
or the decision). **All of these mean you have not finished — a perfunctory pass is a failed sign-off.**
· **clearing a finding by not re-reviewing it** ("it was probably fixed" — re-review its location or it stays blocking) · **merging on a `block` verdict** or on "I'm satisfied" without a `pass` · **spinning rounds** — if 🆕 new/regressed keeps appearing, your fixes are causing regressions; slow down and verify, don't churn.

**Principle:** you orchestrate the *reviewing* — flexible judgment. The deterministic spine
(`consolidate` + `decide`) owns the *verdict* and the *trust boundary*. The verdict is computed by
code from structured findings, and a gating finding can be dismissed ONLY with a written
justification — so a prompt-injected diff or a steered agent cannot flip the gate or bury a finding.

**Reviewers are untrusted, read-only.** Each is a model running in Claude Code's harness with
read-only tools (Read/Grep/Glob + git read), told *"review this PR"* — it explores the checked-out
branch itself. Only you and the spine (trusted) act: persist, comment, set the merge status.

Run the spine with the **`review-gate`** command — it's on your `PATH` once this plugin is installed,
so call it from any directory: `review-gate <prompt|run|scan|collect|consolidate|decide> …`. It also *serves
its own reviewer prompts*: `review-gate prompt <name>` prints that prompt **plus its output contract**
to stdout, so you never need a filesystem path to the prompt files.

## Models
The lineage table and per-backend behaviour are the **canonical roster** — fetch it with
`review-gate prompt backends` (shared with repo-audit, so it never drifts). For the gate, run the
**holistic pass on all four** lineages: recall on *flaky* findings (e.g. "logout doesn't clear") comes
from independent diverse shots, not one model. Drop/keep models per cost; the gate degrades gracefully
if a backend is unavailable.

## The loop
The gate runs as a **multi-round loop with a deliberately asymmetric design — round 1 *discovers*,
later rounds only *verify*** — so it **converges** instead of spiralling:

- **Round 1 — discovery: the full panel.** All four models on holistic + any warranted lenses + the
  deterministic scan. This is where issues are found.
- **Round 2+ — verification: a SINGLE model.** After you fix round 1's findings, **one** model
  validates: for each prior-round finding, is it resolved at HEAD, and did a fix introduce a direct
  **regression**? It is **NOT** a fresh adversarial sweep — later rounds **confirm, they do not
  re-discover**. This is the convergence mechanism: an adversarial "find everything" panel on
  trust-boundary code never runs dry, so re-running the full panel every round never terminates;
  bounding rounds 2+ to verification bounds the loop to round 1's finding set (+ direct regressions).

Per round: run reviewers → consolidate → adjudicate → `decide` → **post two round-numbered comments**
→ if `verdict == pass` and no real blocker is deferred, **finalize and merge**; else fix, commit, next round.

**Converge — do not chase a clean panel; it does not exist.** Stop when verification shows round 1's
findings resolved and **no new regression**. The adversarial dogfood ALWAYS finds one more
defense-in-depth nit; "every probe clean across every model" is unreachable. Fix what blocks, verify,
**STOP** — don't spiral (this gate's own dogfood once ran 4 rounds chasing theoretical mediums before
this rule was written).

**Gating calibration — so the blocker set is finite and shrinks.** Block on: critical/high · **all**
tool findings · and mediums **corroborated by ≥2 models**. A **single-model, contested** medium is
**advisory by default** — dismiss it with a one-line code-checked reason (or log it as a follow-up),
and promote it to blocking only when, reading the code, you judge it a genuine merge-blocker. This is
what stops a lone adversarial "what if the attacker controls X" medium from blocking forever.

**Carry-forward (skill-enforced):** you cannot clear a finding by not looking at it. Round 2+ must
verify every still-open finding (or fix it); an open finding neither fixed nor verified-resolved stays
blocking. The spine computes the verdict from what you collect — honest collection is your job.

## Procedure

1. **Check out the PR branch** in an isolated worktree the reviewers will explore:
   `git worktree add /tmp/rg-wt <head-ref>`. Note the base ref (e.g. `origin/main`). (For an
   uncommitted local diff, just use the working tree + its diff.) **Pass the worktree path ABSOLUTE**
   to `run` (e.g. `/tmp/rg-wt`, not `./rg-wt`) — a relative path broke the codex backend in the
   Episode-3 dogfood (it resolved `-C` against a cwd that was already the worktree). The runner now
   absolutizes defensively, but pass absolute so every backend agrees on the dir.

2. **Build each reviewer prompt** = the reviewer instructions + the output contract + a one-line
   scope: `review-gate prompt <holistic|lens-…> > /tmp/rg-<id>.txt` (this emits the reviewer prompt
   AND its output contract), then append: *"Review THIS PR — the change is `git diff <base>...HEAD`. Run it, read the changed files
   and relevant call-sites, then review. Output ONLY the JSON array."* No diff/file blobs — the
   model reads the repo. **Build on the emitted contract — don't hand-write a prompt full of literal
   `[...]` example tokens.** A reasoning model echoes those brackets into its prose, where they defeat
   array salvage; the safe instruction is *"output the JSON array as your WHOLE final message (`[]` if
   nothing)"*, which steps 1's parser trusts authoritatively. This matters most for a custom round-N
   verify prompt you write yourself.

3. **Run the reviews** — `review-gate run <reviewerId> <backend> <model> /tmp/rg-wt /tmp/rg-<id>.txt`:
   - **Deterministic scan first (cheap, $0, no LLM):** `review-gate scan /tmp/rg-wt <base>` → a ReviewerOutput
     `{reviewer:"tools", model:"deterministic"}`; merge its `output` into `/tmp/rg-outputs.json` like
     any reviewer. These are **exact tool detections** (conflict markers, focused tests, committed
     secrets/artifacts) — facts, not opinions; they are **not** sent to the models. Run it alongside
     the model pass; if it returns a blocking finding (e.g. a committed secret), you may **fast-fail**
     the gate before paying for the models. **A scanner whose tool is absent (e.g. gitleaks → no secret
     scan) SKIPS with a warning, not a finding** — `collect` folds that into `meta.scanWarnings` and
     `decide` renders a `🔍 Scan tier degraded` line, so a skipped secret/dependency scan is **loud in the
     verdict**. NEVER write "scan clean / no secrets" when a scanner was skipped — that tier didn't run,
     and claiming it did is a false sign-off (Episode 5).
   - **holistic × all four models** (the core pass) — e.g. `review-gate run holistic ollama kimi-k2.7-code:cloud …`,
     `… ollama glm-5.2:cloud …`, `… claude claude-opus-4-8 …`, `… codex gpt-5.5 …`.
     For the `claude`/opus reviewer, append a `Think hard about lifecycle/edge cases.` line to its
     prompt (high thinking). codex effort is set high by the runner.
   - **Round N>1 = verification by a SINGLE model, not a fresh panel.** After fixing, run ONE reviewer
     from the roster — pick **whichever model reliably emits the clean-array contract on the verify
     pass** (a non-vote wastes the round; see the guard below). Don't hard-wire a model: a model that
     proses on verify today may be replaced tomorrow — the requirement is a clean-array voter, not a
     name. Scope it to the prior-round findings + `git diff <prevHead>...HEAD`: for EACH prior finding, does it still hold at HEAD, and
     did a fix introduce a direct regression? **Do NOT ask it to re-scan the whole PR for new issues**
     — that re-opens discovery and the loop stops converging. Run the full deterministic `scan` every
     round regardless ($0). Escalate to a fuller panel only if a fix was large/risky — the exception.
     - **Build the verify prompt from `review-gate prompt verify`** — do NOT hand-write it. The built-in
       template carries the *same clean-array output contract the lenses use* and puts the prior findings
       AFTER it. This is necessary but **not sufficient**: a hand-written prompt makes a prose non-vote
       MORE likely (a per-finding narrative above the contract, repeated inline `[]`/`{}` tokens, or a
       trailing "think hard" line all pull a model into prose), but **even the built-in template can draw
       an intermittent non-vote** — that's model behavior on the discursive "re-check these" task, not a
       prompt defect (Episode 5). Append the prior findings (and the `git diff <prevHead>...HEAD` scope)
       after the emitted prompt — like `lens-spec` takes its spec.
     - **Non-vote guard (still applies):** ANY model can intermittently return a pure-prose **non-vote**
       (`parseFindings` can't salvage a no-array reply) — reasoning-heavy ones more so on the discursive
       verify task. A verifier non-vote is **NOT a clean pass** — it is zero coverage. Surface the
       `warning` and re-run, or fall back to a **different roster model**. The saved non-vote envelope now
       carries a **`rawTail`** (the tail of the model's actual reply) — read it to tell whether the model
       prosed (model behavior → switch model) or emitted something the parser should have caught (a parser
       bug → fix the spine), instead of guessing or re-running blind. NEVER let an unparseable reply
       convert a still-open finding into "resolved" or a `block` into `pass`.
   - **Lenses are CONDITIONAL, not always-on** — a targeted backfill on 1–2 models, fired ONLY when
     (a) holistic came back **thin on that dimension** (a silence you don't trust — e.g. zero test
     findings on a PR that clearly needs tests), OR (b) the PR is **high-stakes for that dimension**
     and you want a dedicated independent shot. Holistic ×4 already covers the core; with ≥3 diverse
     shots the common dimensions usually come through — then **skip the lens**; re-running it is a
     tax, not a backfill. Fire by trigger:

     | lens | fire when |
     |---|---|
     | `lens-tests` | tests are thin/weak, or behavior changed with little/no test change |
     | `lens-spec` | a spec / acceptance criteria / ticket exists — **append it to the prompt** (it returns `[]` without one). If you can't supply the spec, do **not** count conformance as checked — record the pass in `meta.missing` so the Coverage line shows it |
     | `lens-security` | a sensitive surface — auth, input handling, crypto, deserialization, **shelling out to a subprocess, or parsing untrusted input** (its adversarial framing catches argument/option injection holistic misses) |
     | `lens-privacy` | the change stores, logs, or transmits personal/sensitive data |
     | `lens-contracts` | a public HTTP API, or an async event/message schema, changed |
     | `lens-migrations` | a DB schema migration / DDL is in the change |
     | `lens-subtle-correctness` | concurrency/async, caching, or date/time/timezone logic is touched |
     | `lens-simplify` | the change adds notable new abstraction, indirection, a new pattern, or complex logic, and you want a dedicated "is this the *simplest correct* form?" shot — **mostly advisory** (findings are usually low/info; `medium`+ only when complexity concretely risks a bug or burdens central code) |

     Most PRs fire **0–2** lenses. `lens-subtle-correctness` self-scopes to whichever of its three
     sections apply (returns `[]` if none); `lens-simplify` returns `[]` when the change adds no
     needless complexity. Run a fired lens on 1–2 diverse models, not all four.

     **MANDATORY before step 4 — write the lens decision out loud.** Go down the table row by row and
     state, in one line each, whether the trigger matched and whether you **fired or skipped** it. Do
     not default to holistic-only. A thick holistic panel is *not* a substitute for a lens's framing:
     in this gate's own dogfood, an orchestrator that ran holistic ×4 and never weighed the lenses
     **missed a HIGH `baseRef` argument-injection** that `lens-security` caught on the first try — the
     adversarial "assume the attacker controls every input" framing finds what "review this change"
     skims. **Silently skipping the lens evaluation is a sign-off failure, not a shortcut.**
   - Run reviewers as parallel background subprocesses (modest concurrency — a few at a time). **Save
     each call's full stdout to `/tmp/rg-wt-out/out-<id>.json`** (the whole `{reviewer, backend, model,
     output, warning}` envelope, votes AND non-votes) and the `scan` output to the **same dir as
     `out-scan.json`** (it MUST match `out-*.json` for `collect` to fold it in, or pass it via `--scan
     <f>` — a misnamed scan is silently absent, and the deterministic tier is the one you can't lose).
     Don't hand-assemble the pool — `collect` (step 3a) does it deterministically.

3a. **Collect:** `review-gate collect /tmp/rg-wt-out --round N [--scan <f>] [--missing 'reviewer|model|reason']`
   → writes `outputs.json` (→ consolidate) + `meta.json` (→ decide) into that dir. It reads reviewer/model
   from file **contents** (filenames may vary), folds the scan into `outputs`, and derives `meta.missing`
   from every `output:null` file (reason = its `warning`) — so a thinned panel **can't** be silently
   dropped from the Coverage line. It also folds a **degraded scan** (a scan that voted but carried a
   warning — a skipped sub-scanner) into `meta.scanWarnings`, which `decide` renders as the `🔍 Scan tier
   degraded` line. Pass `--missing 'reviewer|model|reason'` only for a pass that produced
   *no file at all* (a backend you planned then skipped, or a lens fired without its input — e.g. `lens-spec`
   with no spec). A malformed `out-*.json` makes `collect` fail loud rather than quietly thin the panel.

4. **Consolidate:** `review-gate consolidate /tmp/rg-wt-out/outputs.json > /tmp/rg-clusters.json` — clusters by
   location across models (agreement counts distinct **models**), with a `contested` flag. Each cluster now
   carries the reviewer **roles** that raised it, so the comment attributes one model run in several roles.

5. **Adjudicate** (your only input to the verdict — treat it as such). Read **every** cluster, and
   for every gating cluster **open the code and confirm the finding for yourself** before you act on
   it — `contested` clusters most of all. Emit `/tmp/rg-adjudications.json`
   (`[{key, decision, justification?}]`) for any cluster you **dismiss** or explicitly confirm. A
   gating dismissal MUST carry a non-empty `justification` — and that justification must state **what
   you checked in the code** that proves the finding is not real, not merely why it sounds unlikely. A
   dismissal you cannot back with a code-level reason is a finding you must let block. Unlisted
   clusters default to: gating → blocks, low/info → advisory.
   - **Classify each gating finding against the code — and don't rubber-stamp in *either* direction.**
     A fresh reviewer can be wrong for lack of your context *and* right despite your confidence; re-read
     the change itself before deciding. A finding is either **not real** under code/conventions the
     model couldn't see — dismiss it, with a justification stating what in the code makes it safe — or
     it is **real**, and then it blocks until fixed. A real gating issue someone would rather *accept*
     than fix is **not yours to silently dismiss**: the gate fails safe toward blocking, so leave it
     blocking and surface it for the PR owner's explicit sign-off — never clear it with a "trade-off"
     justification, which is exactly the silent-dismissal hole the spine exists to prevent.
   - **Calibrate gating — don't let lone adversarial mediums block forever (see "The loop").**
     Critical/high and **all tool** findings block. A medium **corroborated by ≥2 models** blocks. A
     **single-model, contested medium is advisory by default** — dismiss it with a one-line
     code-checked reason or log it as a follow-up; promote it to blocking only when the code convinces
     you it's a genuine merge-blocker. On trust-boundary code the adversarial lens manufactures lone
     "what if X is attacker-controlled" mediums without end — treating every one as blocking is why a
     gate fails to converge. (This calibration is orchestrator discipline today; a spine-level
     threshold is a tracked follow-up.)
   - **Deterministic (tool) findings are facts — the spine will NOT honor a dismissal of one.** A
     tool gating finding always blocks; an adjudication can't clear it (so a prompt-injected or steered
     agent can't dismiss a committed secret with a string). To clear one, **fix it in code, or tune the
     scanner's config/allowlist** so it stops firing. An attempted override is surfaced loudly in the
     comment as **"⚠️ Deterministic findings — override NOT honored"** but the finding stays blocking.

6. **Decide.** `meta.json` is already built by `collect` (step 3a) = `{reviewers, missing, round}` —
   `reviewers` is every reviewer×model pass that **voted** (clean votes included; the deterministic scan
   is excluded — it can't be "lost"); **`missing`** is every planned pass with no usable vote (derived
   from the `output:null` files, plus any `--missing` you supplied). The spine renders a loud **Coverage**
   line from `missing`, so a thinned panel shows in the *deterministic* comment, not only your prose. For
   round **N>1**, save the **previous round's blocking findings** (last decision's `blocking` array) and
   pass them with **`--prev`**.

   Run: `review-gate decide /tmp/rg-clusters.json /tmp/rg-adjudications.json /tmp/rg-wt-out/meta.json [--prev /tmp/rg-prev.json] > /tmp/rg-decision.json`
   (Adjudications may be a file, an inline `[]`, or an empty file / `/dev/null` when you dismissed nothing.
   Prefer `--prev <f>` over a bare 4th positional — it's order-independent against `meta.json`.)
   → `{verdict, blocking, dismissed, prComment}`, all deterministic. With `previous` supplied,
   `prComment` gains a **Progress since Round N−1** section (✅ resolved · ⏳ still-blocking · 🆕
   new/regressed), computed by the spine. **Save this round's `blocking`** — it is the next round's
   `previous`.

7. **Act (trusted — you, not a reviewer).** Post **two fresh, round-numbered comments every round**
   (never edit a prior round's — the run history is the audit trail):
   1. **Gate findings comment** — post `prComment` exactly as emitted (`## Review Gate — Round N` +
      the "Reviewed by" roster + the Progress-since-last-round delta + findings). One per round.
   2. **Orchestrator review comment** — a *separate* `gh pr comment`, in your own words, REQUIRED
      every round:
      - **While looping (verdict `block`):** what this round found · what you agree with and are fixing
        · what you dismissed (with a code-checked reason) · **Decision: 🔴 Request changes** (must
        agree with the `block` verdict). Then implement the fixes, commit, and start round N+1.
      - **Final round (verdict `pass`, nothing real deferred):** the **approval + cumulative summary**
        — what the PR implements · **Fixed** (cumulative across all rounds) · **Deferred / not covered**
        · **Decision: ✅ Approve** (must agree with the `pass` verdict).

   **Finalize + merge** — ONLY when `verdict == pass` on the current HEAD and you are deferring no real
   blocker: after posting the final approval/summary comment, **programmatically re-read `verdict` from
   the decision file** — run `jq -e '.verdict=="pass"' /tmp/rg-decision.json` and confirm it succeeds
   before calling `gh pr merge`. Never merge from memory or a remembered verdict. (The eventual
   deterministic enforcement is a **CI required-check** that refuses the merge unless `verdict == pass`
   — currently deferred per the project plan; this programmatic re-read is the interim guard.) The
   verdict being `pass` is a hard precondition — your satisfaction never substitutes for it. On a
   `block` verdict you are not done: fix and loop.

   Persist the dismissal log under `.review-gate/`.

8. **Clean up** the worktree: `git worktree remove /tmp/rg-wt`.

## Done when (the gold-standard gate)
You have signed off ONLY when all of these hold — otherwise you are not finished:
- [ ] The deterministic `scan` ran and its findings are in the pool.
- [ ] **Round 1 ran the full panel** (all four holistic + warranted lenses), OR every missing model is surfaced with the coverage lost named (recorded in `meta.missing` → the **Coverage** line). **Rounds 2+ were single-model verification of the prior findings + fixes — not a fresh discovery panel.**
- [ ] Round 1's panel is not thin (≥3 models), OR a thin panel is flagged and the verdict marked low-confidence.
- [ ] Every gating cluster was read **in the code**, not just by title.
- [ ] Every dismissal carries a code-checked justification — you confirmed the finding is not real.
- [ ] The lens decision was **written out** (step 3) — every trigger row evaluated, each fired or skipped with a reason. Holistic-only on a PR that matched a trigger is NOT done.
- [ ] **Two fresh round-numbered comments** are posted this round (never editing a prior round's): the gate `prComment` (verdict + **reviewer/model roster** + findings) AND a separate **orchestrator review comment** (what the PR implements · what it doesn't cover / deferred · an explicit **Approve / Request-changes** that AGREES with `verdict`). The verdict reflects what you actually verified.
- [ ] Every still-open finding was re-reviewed (or fixed) this round — none cleared by being ignored (carry-forward).
- [ ] Gating was **calibrated**: single-model contested mediums were advisory-by-default (dismissed with a code-checked reason or logged as follow-up) unless promoted to a real blocker — not left to block as adversarial noise.
- [ ] You **converged**: you stopped when round 1's findings were resolved with no new regression, not chased an unreachable "clean across every model" panel.
- [ ] The merge happened ONLY at `verdict == pass` on the current HEAD, with the final approval/summary comment posted and no real blocker deferred.

If any box is unchecked, keep working. A `pass` you are not certain of is not a `pass`.

## Runner facts (learned the hard way — don't relearn them)
- Backends (see `src/runner.ts` → `buildCommand`): `ollama` → `ollama launch claude --model <m>:cloud
  -- -p … --output-format json --allowedTools <ro>`; `claude` → native `claude --model <m> -p … 
  --output-format json --allowedTools <ro>`; `codex` → `codex exec -C <repo> -m <m> -c
  model_reasoning_effort="high" -c sandbox_mode="read-only" "<prompt>"`.
- For ollama/claude, collect findings from the JSON envelope's `result`; for codex, from the final
  `codex` block of the trace. No diff blob, no event-stream scraping.
- **Output salvage (`parseFindings`):** reasoning-heavy models (opus, glm) often narrate around the
  array. The runner parses the whole message authoritatively first, then takes the **UNION of valid
  findings across ALL ```json fences** — never just one. Picking a single fence is gameable in both
  directions (an example/empty fence could mask the answer; a trailing decoy could mask a real
  critical), so the union lets a real finding in *any* fence survive; a first-`[`…last-`]` slice is the
  last resort. A *whole-message* `[]`/“no issues” is a 0-finding vote, but a non-empty array that
  validates to zero findings (or a *carved-out* empty `[]` amid prose) is garbage — never an
  authoritative clean pass. A pure-prose reply with no array stays a surfaced non-vote (never silently
  dropped).
- The `--` after `ollama launch claude` is required (separates ollama-launch flags from claude's).
- **Cost guards (each `run` is a full agent loop = many model requests, not one):** ollama/claude carry
  `--max-turns` (default **50**, `REVIEW_GATE_MAX_TURNS`) so a non-converging model can't spin a runaway
  request loop — on Ollama Cloud's GPU-time billing that once burned ~245 requests + a 38-min hang. This
  is the *secondary* guard (raised 25→50 in Episode 3 — kimi/glm on holistic/lens legitimately need >25
  turns, so 25 was logging real reviews as non-votes). The **hard wall-clock timeout**
  (`REVIEW_GATE_TIMEOUT_MS`, default 10m) is the real backstop — it force-settles even if the child
  orphans a grandchild holding the pipe. Hitting *either* ⇒ that reviewer fails (surfaced warning, lost
  vote) — not a runaway.
- **Transient-failure retry + diagnosable non-votes (Episode 3):** a flaky spawn (non-zero exit / reset)
  is retried **once** inside `run` before it counts as lost coverage — but a *persistent* failure, a
  timeout, a byte-cap, a missing binary (ENOENT), and a determined `error_max_turns` are **not** retried
  and still surface as a `warning` → `meta.missing` → the Coverage line (a retry never masks a dead
  reviewer). The `warning` now names the harness error **subtype** (e.g. `error_max_turns`) and carries
  the **tail** of stderr (the real error), so a benign leading "connectors" warning can't hide it. The roster is all "high"-tier Ollama models now
  (deepseek's "extra high" tier was the heaviest/least-convergent and drove that runaway — swapped out
  for `glm-5.2`, a "high" tier that leads SWE-bench Pro).
- Thinking: not needed as a flag for ollama/claude (Claude Code's harness doesn't starve the answer
  the way omp did); bump the opus reviewer via a `Think hard` prompt line. codex effort is set high.
- omp is OUT (agentic mode requests `max_tokens` > the ollama models' output cap → HTTP 400); opencode
  works but needs event-stream extraction. This path avoids both.
