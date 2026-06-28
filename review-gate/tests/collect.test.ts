import { describe, it, expect } from "vitest";
import { collect, type CollectInput } from "../src/collect.js";
import type { Finding } from "../src/types.js";

// Episode 4 (#2): collect inverts what `run`/`scan` print into the two pipeline artifacts
// (outputs.json → consolidate, meta.json → decide), deterministically — so hand-assembling meta.missing
// (where a non-vote can be silently dropped) is no longer a manual step.

const finding = (file: string): Finding => ({ title: "t", severity: "high", file, line: 1, rationale: "r", suggestion: "s" });
// a `run` envelope (vote): top-level provenance + the inner ReviewerOutput
const vote = (reviewer: string, backend: string, model: string, files: string[]): CollectInput => ({
  name: `out-${reviewer}.json`,
  json: { reviewer, backend, model, output: { reviewer, model: `${backend}:${model}`, findings: files.map(finding) }, warning: null },
});
// a `run` envelope (non-vote): output null, a warning to attribute the loss
const nonVote = (reviewer: string, backend: string, model: string, warning: string): CollectInput => ({
  name: `out-${reviewer}.json`,
  json: { reviewer, backend, model, output: null, warning },
});
// a `scan` envelope: just {output: tools ReviewerOutput, warning}
const scan = (files: string[]): CollectInput => ({
  name: "out-scan.json",
  json: { output: { reviewer: "tools", model: "deterministic", findings: files.map((f) => ({ ...finding(f), source: "tool" as const })) }, warning: null },
});

describe("collect", () => {
  it("gathers voter outputs and builds the reviewers roster from file contents", () => {
    const { outputs, meta } = collect([
      vote("holistic", "ollama", "kimi", ["a.ts"]),
      vote("lens-simplify", "claude", "claude-opus-4-8", ["b.ts"]),
    ], { round: 1 });
    expect(outputs).toHaveLength(2);
    expect(meta.reviewers).toEqual([
      { reviewer: "holistic", model: "ollama:kimi" },
      { reviewer: "lens-simplify", model: "claude:claude-opus-4-8" },
    ]);
    expect(meta.round).toBe(1);
    expect(meta.missing).toBeUndefined(); // nothing lost
  });

  it("folds the scan into outputs but keeps it OUT of the reviewers roster (the scan can't be 'lost')", () => {
    const { outputs, meta } = collect([vote("holistic", "ollama", "kimi", ["a.ts"]), scan(["secrets.env"])]);
    expect(outputs).toHaveLength(2);                                  // model vote + scan, both for consolidate
    expect(outputs.some((o) => o.reviewer === "tools")).toBe(true);
    expect(meta.reviewers).toEqual([{ reviewer: "holistic", model: "ollama:kimi" }]); // tools excluded
  });

  it("derives meta.missing from null-vote files — model = backend:model, reason = the warning", () => {
    const { meta } = collect([
      vote("holistic", "ollama", "kimi", ["a.ts"]),
      nonVote("lens-spec", "claude", "claude-opus-4-8", "claude-opus-4-8: error_max_turns"),
    ]);
    expect(meta.missing).toEqual([
      { reviewer: "lens-spec", model: "claude:claude-opus-4-8", reason: "claude-opus-4-8: error_max_turns" },
    ]);
  });

  it("appends orchestrator-supplied missing (a pass that produced NO file)", () => {
    const { meta } = collect(
      [vote("holistic", "ollama", "kimi", ["a.ts"])],
      { missing: [{ reviewer: "lens-security", model: "ollama:glm", reason: "planned, backend skipped" }] },
    );
    expect(meta.missing).toEqual([{ reviewer: "lens-security", model: "ollama:glm", reason: "planned, backend skipped" }]);
  });

  it("throws LOUD on a non-vote with no provenance to attribute the loss (never silently drops it)", () => {
    expect(() => collect([{ name: "out-bad.json", json: { output: null } }])).toThrow(/no reviewer\/backend\/model/);
  });

  it("throws on a non-vote missing `backend` — its model string would diverge from how a vote names it", () => {
    expect(() => collect([{ name: "out-nb.json", json: { reviewer: "holistic", model: "kimi", output: null, warning: "x" } }]))
      .toThrow(/reviewer\/backend\/model/);
  });

  it("throws on a malformed envelope (not an object / malformed output)", () => {
    expect(() => collect([{ name: "out-x.json", json: 42 as never }])).toThrow(/not a run\/scan envelope/);
    expect(() => collect([{ name: "out-y.json", json: { reviewer: "h", model: "m", output: { nope: true } as never } }])).toThrow(/malformed/);
  });

  it("throws on an empty model-reviewer roster (only a scan, or every pass failed) — fails at the gatherer, not two steps later", () => {
    expect(() => collect([scan(["secrets.env"])])).toThrow(/no model reviewer votes/);
  });

  // Episode 5 (#2): a scan that VOTED but carried a warning ran DEGRADED (a sub-scanner skipped — e.g.
  // gitleaks absent). Its warning used to be dropped here (the scan output is a valid vote), so a
  // skipped secret tier vanished from the verdict and read as "clean". Capture it into meta.scanWarnings.
  it("captures a DEGRADED scan tier's warning into meta.scanWarnings (a skipped sub-scanner can't vanish)", () => {
    const degradedScan: CollectInput = {
      name: "out-scan.json",
      json: { output: { reviewer: "tools", model: "deterministic", findings: [] }, warning: "secrets: gitleaks not on PATH — skipped (install gitleaks to enable secret scanning)" },
    };
    const { outputs, meta } = collect([vote("holistic", "ollama", "kimi", ["a.ts"]), degradedScan]);
    expect(outputs.some((o) => o.reviewer === "tools")).toBe(true);                     // the scan still VOTES
    expect(meta.reviewers).toEqual([{ reviewer: "holistic", model: "ollama:kimi" }]);   // still not a reviewer
    expect(meta.scanWarnings).toEqual(["secrets: gitleaks not on PATH — skipped (install gitleaks to enable secret scanning)"]);
    expect(meta.missing).toBeUndefined();                                               // a degraded scan is NOT a lost vote
  });

  it("a clean scan (no warning) yields no scanWarnings", () => {
    const { meta } = collect([vote("holistic", "ollama", "kimi", ["a.ts"]), scan(["x.ts"])]);
    expect(meta.scanWarnings).toBeUndefined();
  });

  // A lost reviewer (non-vote) and a degraded scan can happen in the SAME round — they travel different
  // branches of the per-file loop, so pin that BOTH surface (distinct), not one masking the other.
  it("a lost reviewer AND a degraded scan in one round BOTH surface (missing + scanWarnings, distinct)", () => {
    const degradedScan: CollectInput = {
      name: "out-scan.json",
      json: { output: { reviewer: "tools", model: "deterministic", findings: [] }, warning: "secrets: gitleaks not on PATH — skipped" },
    };
    const { meta } = collect([
      vote("holistic", "ollama", "kimi", ["a.ts"]),
      nonVote("lens-spec", "claude", "claude-opus-4-8", "claude-opus-4-8: error_max_turns"),
      degradedScan,
    ]);
    expect(meta.missing).toEqual([{ reviewer: "lens-spec", model: "claude:claude-opus-4-8", reason: "claude-opus-4-8: error_max_turns" }]);
    expect(meta.scanWarnings).toEqual(["secrets: gitleaks not on PATH — skipped"]);
  });
});
