---
name: ship
description: "Turn a green, build-finished branch into a reviewed pull request: verify, push, open a PR built from the spec, and hand the PR to review-gate. Use AFTER build reports the branch ready. Triggers: 'ship', 'open the PR', 'raise the pull request', 'send for review', or a build-report.md with every task done. Terminal stage of the build half; it does not merge."
---

# Ship: branch to reviewed PR

Take the branch `build` finished and open a pull request for it, reviewed. Verify the suite is green,
push, synthesize the PR from the spec, and hand the open PR to the `review-gate` for the whole-PR
merge review. The terminal artifact is a *reviewed* PR — ship does not merge; that stays with a human
or review-gate's own merge step, and promotion belongs to a later `deploy` stage.

<HARD-GATE>
Precondition: `specs/<feature>/build-report.md` shows every task done and the working tree clean. If
a task is in-progress or blocked, STOP and route back to `/agent-sdlc:build`. Input is the green
feature branch plus the spec (for the PR body). Output is a pushed branch, an open PR, and a
review-gate verdict. ship creates and reviews the PR; it does NOT merge. On a blocking verdict it
stops and asks before changing anything — a PR is an outward artifact.
</HARD-GATE>

## The sequence

1. **Precondition** `build-report.md` all-done and the working tree clean. Else stop → build.
2. **Verify** run the full suite fresh and read the output (verification-before-completion). Red →
   stop; do not push a red branch.
3. **Push** push the feature branch to the remote.
4. **PR** open it with `gh pr create`. Synthesize the title and body from the spec — the `## Brief`
   summary, the `AC-N` list, the task→criterion coverage, any `SHORTCUT(T-N)` ceilings the build
   recorded in `build-report.md` (surface the known compromises so the reviewer sees them), and a
   link to the spec. (Mechanics + template in [reference/finishing.md](reference/finishing.md).)
5. **Linear** if sync is enabled in `.agent-sdlc/config.json`, attach the PR url to the feature's
   issues, post a project status update, and move the project to In Review — via the `linear-sync`
   skill.
6. **Review** invoke `/review-gate:review-gate` on the open PR, passing it the spec explicitly — the
   `## Acceptance Criteria` and the design — because its reviewers explore the committed worktree,
   where a gitignored or uncommitted spec is invisible and the conformance lens would otherwise check
   against nothing. It diffs the PR against the base, reviews, posts a verdict comment, and returns
   **pass** or **block**. If review-gate is not installed (e.g. Cursor/Codex without the Node CLI),
   fall back to a dispatched whole-PR reviewer subagent and say so — the PR is still created and
   reviewed, by the portable path.
7. **Verdict** **pass** → report "PR ready, review-gate ✅" with the URL. **block** → surface the
   blocking findings and recommended fixes, then STOP and ask whether to dispatch fixers and
   re-push, or hand it back. Do not auto-loop on an outward artifact.
8. **Leave the worktree** the PR is open; do not clean up the workspace on the PR path.

## Principles

- **A reviewed PR is the finish line.** Not a merge. ship hands off a PR that has passed (or
  explicitly deferred) review; the merge decision is someone else's.
- **PR first, then review.** review-gate is a post-PR merge gate — it operates on an existing PR and
  comments on it. Create the PR, then hand it over.
- **Never push or PR a red branch.** Re-run the suite at ship and read the output. The branch was
  green at build; confirm it still is before going outward.
- **Stop before mutating outward.** A blocking verdict is a checkpoint, not a loop. Surface it and
  ask. Re-pushing fixes to an open PR is a real, visible change.
- **Build the PR from the spec, not from memory.** The Brief, the criteria, and the coverage map are
  the truthful description of what shipped. Synthesize the body from them.
- **Degrade, never block.** No review-gate, no Linear — ship still produces a PR. Optional
  dependencies are optional; say what was skipped and carry on.

## Rationalizations (excuses to skip the bar, and the rebuttal)

| Excuse | Rebuttal |
| --- | --- |
| "build said green, no need to re-verify." | Verify at the boundary. The cost of one suite run is nothing against pushing a red branch. |
| "Review the branch, then open the PR." | review-gate reviews an existing PR and comments on it. PR first, then review. |
| "It blocked, I'll just fix and re-push." | A PR is outward. Surface the findings and ask first — do not silently rewrite an open PR. |
| "Merge it, the review passed." | ship's finish line is a *reviewed* PR. Merging is a human's or review-gate's call, not ship's. |
| "review-gate isn't installed, skip the review." | Degrade to the portable reviewer subagent. A PR ships reviewed, one way or another. |

## Red flags (stop and fix)

- A branch pushed or a PR opened without re-running the suite at ship.
- A PR body written from memory instead of synthesized from the spec.
- Auto-looping fixes onto an open PR after a blocking verdict without asking.
- ship merging the PR.
- The review step silently skipped because review-gate was absent (degrade instead).
- The workspace cleaned up while the PR is still open.

## Done when

- The suite is verified green and the branch is pushed.
- A PR is open with a body synthesized from the spec (Brief, `AC-N` list, coverage, spec link) plus
  any `SHORTCUT(T-N)` ceilings recorded in `build-report.md`.
- review-gate (or the fallback reviewer) has returned a verdict, posted on the PR.
- On pass: the PR URL and the ✅ verdict are reported. On block: findings surfaced and the user asked.
- Linear PR attachment + project status update done where sync is enabled (or skipped cleanly).

## The artifact (output)

- An open pull request with the spec-derived description and a review-gate verdict comment.
- No new files in the repo; ship's output is the PR and the review, not a document.

## Conventions

- Reads `build-report.md` and the spec; references `AC-N` and the feature branch.
- Invokes `/review-gate:review-gate` (a sibling plugin in this marketplace) for the whole-PR review,
  with a portable reviewer-subagent fallback when it is absent.
- Does not merge and does not clean the worktree on the PR path.
- Downstream consumer: a human or review-gate merges; a later `deploy` stage owns promotion.
