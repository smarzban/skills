# Simplicity — vertical slices and Rule-0 (implementer discipline)

Keep each task's change small, complete, and reversible. The plan already sized tasks to leave the
repo green; this discipline keeps the implementer honest while building one.

## Rule 0: simplicity first

Before writing, ask: **would a senior engineer look at this and say "why didn't you just…?"** If the
answer is plausibly yes, take the simpler path. The simplest change that satisfies the task's `AC-N`
and passes its test is the right one. Cleverness that the criteria did not ask for is a liability.

## The least-code path (stop at the first rung)

The task already earned its place — the plan justified it against an `AC-N` and the gate cleared any
orphan, so "does this even need to exist?" is settled before build. What is left is *how* to satisfy
it with the least new code. Once you know what the change must touch, walk these in order and stop at
the first that works:

1. **Reuse** -> a helper, pattern, or abstraction already in this codebase does it. Use it.
2. **Standard library** -> the language's stdlib covers it. Use it; do not hand-roll.
3. **Native capability** -> a platform, framework, or datastore feature covers it (a DB constraint
   over an app-level check, a built-in over a shim). Use it.
4. **Installed dependency** -> something already in the manifest solves it. Use it. Never pull in a
   new dependency for trivial work — a new one is a techstack decision, not an implementer's.
5. **One line** -> it collapses to a single clear line. Write that.
6. **Minimal code** -> only now, the shortest version that satisfies the `AC-N` and passes its test.

Earlier rungs win because they add the least to own forever. Jumping straight to rung 6 — writing
fresh code when rung 1 or 2 already held the answer — is the most common over-build.

## Vertical slices, not horizontal layers

Build one complete path through the system, not a layer at a time. A task should leave a thin,
working slice end-to-end (the bit of schema + the bit of API + the bit of UI that one behaviour
needs), each step green — not "all the schema", then "all the API". The plan's task ordering already
expresses this; honour it.

## Scope discipline

- **Touch only the task's named files.** The plan named exact files for a reason. Wandering into
  adjacent code is how an atomic task stops being atomic and a clean commit turns into a tangle.
- **No drive-by refactoring.** See something untidy nearby? It is not this task. Note it; do not fix
  it in this commit. (A real, blocking mess routes back through the plan, not into the diff.)
- **No gold-plating.** If no `AC-N` asks for it, it is not in scope. Speculative generality is the
  opposite of YAGNI.

## Safe and reversible

- Keep the repo green after the increment — that is what makes the commit a safe save-point.
- Prefer changes that are easy to revert. One atomic commit per task means the worst case is dropping
  one increment, never untangling several.
- Where a behaviour is half-built across tasks and would otherwise break the build, guard it (a flag,
  a default) so every commit stays shippable.

## Mark the ceilings

A deliberate simplification often carries a ceiling — a linear scan that holds until the list grows,
an in-memory store that is fine until there are many writers. The code is complete and shippable; the
limit is just worth stating rather than leaving silent. Drop a one-line marker at the site naming the
limit and the trigger to lift it:

    SHORTCUT(T-N): linear scan -- fine to ~1k entries; index it when the list can grow unbounded.

This is not a TODO and not unfinished work — it is a known, accepted ceiling. The conductor copies
each marker into `build-report.md` at commit time, so the shortcuts a build took are a harvestable
list, not something rediscovered the hard way later. A simplification with no real ceiling is just
simple code; it needs no marker.
