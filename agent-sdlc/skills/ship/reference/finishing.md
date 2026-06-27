# Finishing — push, PR, and review-gate invocation

Mechanics for ship: synthesizing the PR from the spec, the `review-gate` invocation contract, the
portable fallback, and the worktree rule.

## PR body — synthesized from the spec

Build the PR title and body from `specs/<feature>/<feature>.md` (and the `SHORTCUT` ceilings from
`build-report.md`), never from memory:

- **Title:** the feature name (concise), e.g. `feat: <feature>`.
- **Body:**
  - **Summary** — the `## Brief` in a sentence or two.
  - **Acceptance criteria** — the `AC-N` list (the contract this PR claims to meet).
  - **Coverage** — the task→criterion map from the `## Plan`: which `T-N` advanced which `AC-N`.
  - **Known compromises** — any `SHORTCUT(T-N)` ceilings recorded in `build-report.md` (the
    deferred-but-bounded simplifications the build accepted); omit the section if there are none.
  - **Spec** — a link or path to `specs/<feature>/<feature>.md`.
- Base branch: the project's default (e.g. `main`) unless configured otherwise.

```bash
gh pr create --base <base> --head <branch> --title "<title>" --body-file <generated-body.md>
```

Write the body to a file and pass `--body-file` — it keeps newlines and markdown intact.

## review-gate invocation contract

review-gate is a **post-PR merge gate**. It checks out the PR branch in its own worktree, diffs
against the base, runs its reviewers, and returns a deterministic verdict:

- Invoke: `/review-gate:review-gate` against the open PR.
- **Supply the spec explicitly.** review-gate's reviewers explore the checked-out worktree; a spec
  that is gitignored or uncommitted is *absent* there, and the conformance (`lens-spec`) pass then
  has nothing to check and silently returns empty. Pass the feature's `## Acceptance Criteria` (and
  the design / ADRs) into the invocation so the contract review is real, not blind — never assume the
  worktree contains the spec.
- **Verdict vocabulary:** `pass` (no blocking findings) or `block` (blocking findings must be
  resolved or justified).
- **Severity:** `critical` · `high` · `medium` gate (block); `low` · `info` are advisory.
- It posts the verdict as a PR comment.

**Branch on the verdict, not on memory:** treat only an explicit `pass` as ready. On `block`, surface
the blocking findings to the user and ask before any fix-and-re-push. ship never merges — even on a
clean pass, the merge is a human's or review-gate's own step.

review-gate depends on Node (its CLI) plus a backend CLI (`claude` / `codex` / `ollama`). It runs
where those are present.

## Portable fallback (review-gate absent)

If `/review-gate:review-gate` is not installed or its prerequisites are missing (common in
Cursor/Codex), do not skip the review — dispatch a **whole-PR reviewer subagent**:

- Brief: the PR diff (base..head), the feature's `## Acceptance Criteria`, and the global
  constraints.
- It reviews across correctness, the criteria, security, and quality; returns findings by severity.
- Map its result to the same pass/block decision and report which reviewer ran. Say plainly that the
  portable path was used.

## Worktree rule

On the PR path the workspace is **preserved** — the PR is open and may need fixes. Do not run
`git worktree remove`. Only an explicitly-created worktree that is being merged or discarded gets
cleaned up, and that is not ship's job (a later `deploy`/merge step or a human owns it).
