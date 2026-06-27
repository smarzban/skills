import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercises the `prompt` verb end-to-end through the COMMITTED dist/ artifact — the build the
// installed plugin actually runs. Covers cli.ts dispatch + prompt-file resolution, which the
// prompts.ts unit tests (injected read) don't reach; doubles as a smoke test of the shipped binary.
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const run = (args: string[]) => execFileSync("node", [CLI, ...args], { encoding: "utf8" });

describe("cli `prompt` verb (committed dist/ artifact)", () => {
  it("emits a reviewer prompt followed by its output contract", () => {
    const out = run(["prompt", "holistic"]);
    expect(out).toContain("# Holistic code review");
    expect(out).toContain("# Output contract"); // the output-contract was appended
  });

  it("serves an audit pass + the audit output contract", () => {
    expect(run(["prompt", "audit-tests"])).toContain("# Audit: test suite quality");
  });

  it("serves the simplicity / over-engineering lens + the review output contract", () => {
    const out = run(["prompt", "lens-simplify"]);
    expect(out).toContain("# Lens: simplicity & over-engineering");
    expect(out).toContain("# Output contract"); // review contract appended
  });

  // Episode 4 (#1): a built-in verify pass — same clean-array contract the lenses use, so opus stops
  // prose-non-voting on round-N verification (a hand-written verify prompt was inviting the prose).
  it("serves the verify pass + the review output contract (not the audit one)", () => {
    const out = run(["prompt", "verify"]);
    expect(out).toContain("# Verification pass");
    expect(out).toContain("# Output contract");        // the REVIEW contract is appended
    expect(out).not.toContain("# Audit output contract");
  });

  it("serves the over-engineering audit pass + the audit output contract", () => {
    const out = run(["prompt", "audit-over-engineering"]);
    expect(out).toContain("# Audit: over-engineering & needless complexity");
    expect(out).toContain("# Audit output contract"); // audit contract appended
  });

  it("exits non-zero on an unsafe prompt name (no path traversal through the verb)", () => {
    expect(() => run(["prompt", "../../etc/passwd"])).toThrow();
  });
});

describe("cli `decide` verb — run metadata is required, the comment carries it (committed dist/)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rg-cli-decide-"));
  const clusters = join(dir, "clusters.json");
  const adj = join(dir, "adj.json");
  const meta = join(dir, "meta.json");
  writeFileSync(clusters, JSON.stringify([{
    key: "a.ts::1", severity: "low", contested: false, members: [], agreement: { count: 1, total: 4 },
    representative: { title: "minor nit", severity: "low", file: "a.ts", line: 1, rationale: "r", suggestion: "s" },
  }]));
  writeFileSync(adj, "[]");
  writeFileSync(meta, JSON.stringify({
    reviewers: [{ reviewer: "holistic", model: "kimi-k2.7" }, { reviewer: "lens-security", model: "opus-4.8" }],
  }));

  it("emits the comment with the reviewer roster (no embedded sign-off — that's a separate orchestrator comment)", () => {
    const decision = JSON.parse(run(["decide", clusters, adj, meta]));
    expect(decision.verdict).toBe("pass");
    expect(decision.prComment).toContain("_Reviewed by:_ holistic + lens-security");
    expect(decision.prComment).not.toMatch(/orchestrator|sign-off/i);
  });

  it("exits non-zero when the run metadata is omitted — a comment without provenance/sign-off is never produced", () => {
    expect(() => run(["decide", clusters, adj])).toThrow();
  });

  it("exits non-zero when meta.json content is falsy/invalid (`null`) — the guarantee can't be bypassed by a falsy file", () => {
    const bad = join(dir, "meta-null.json");
    writeFileSync(bad, "null");
    expect(() => run(["decide", clusters, adj, bad])).toThrow();
  });

  it("renders the Progress section when a previous-round blocking file is supplied", () => {
    const prev = join(dir, "prev.json");
    writeFileSync(prev, JSON.stringify([{
      key: "a.ts::9::old", severity: "high", contested: false, members: [], agreement: { count: 1, total: 4 },
      representative: { title: "old blocker", severity: "high", file: "a.ts", line: 9, rationale: "r", suggestion: "s" },
    }]));
    const metaR2 = join(dir, "meta-r2.json");
    writeFileSync(metaR2, JSON.stringify({ reviewers: [{ reviewer: "holistic", model: "kimi" }], round: 2 }));
    const decision = JSON.parse(run(["decide", clusters, adj, metaR2, prev]));
    expect(decision.prComment).toContain("## Review Gate — Round 2");
    expect(decision.prComment).toContain("### Progress since Round 1");
    expect(decision.prComment).toMatch(/✅ Resolved \(1\)/); // a.ts::9::old absent from current clusters → resolved
  });

  it("omits the Progress section when no previous-round file is supplied (backward-compat)", () => {
    const decision = JSON.parse(run(["decide", clusters, adj, meta]));
    expect(decision.prComment).not.toContain("Progress since");
  });
});

// Item 6 (Episode 2): the `adjudications` (and `previous`) args used to be file-path-only, so a caller
// with none had to write an empty `[]` file or hit `ENOENT: open '[]'`. Accept an inline literal too.
describe("cli `decide` verb — inline adjudications/previous (no empty-file dance) (committed dist/)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rg-cli-inline-"));
  const clusters = join(dir, "clusters.json");
  const meta = join(dir, "meta.json");
  writeFileSync(clusters, JSON.stringify([{
    key: "a.ts::1", severity: "low", contested: false, members: [], agreement: { count: 1, total: 4 },
    representative: { title: "minor nit", severity: "low", file: "a.ts", line: 1, rationale: "r", suggestion: "s" },
  }]));
  writeFileSync(meta, JSON.stringify({ reviewers: [{ reviewer: "holistic", model: "kimi" }] }));

  it("accepts an inline `[]` for adjudications instead of requiring a file path", () => {
    const decision = JSON.parse(run(["decide", clusters, "[]", meta]));
    expect(decision.verdict).toBe("pass");
  });

  it("accepts an inline `[]` for the previous-round arg too", () => {
    const metaR2 = join(dir, "meta-r2.json");
    writeFileSync(metaR2, JSON.stringify({ reviewers: [{ reviewer: "holistic", model: "kimi" }], round: 2 }));
    const decision = JSON.parse(run(["decide", clusters, "[]", metaR2, "[]"]));
    expect(decision.prComment).toContain("## Review Gate — Round 2");
  });
});

// Episode 4 (#3): "no adjudications" shouldn't need a hand-written `[]` file, and the previous-round
// arg as a bare 4th positional is easy to misorder against meta — accept an empty file / /dev/null and
// a --prev flag.
describe("cli `decide` verb — empty-file adjudications + --prev flag (committed dist/)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rg-cli-ergo-"));
  const clusters = join(dir, "clusters.json");
  const meta = join(dir, "meta.json");
  const empty = join(dir, "empty.json");
  writeFileSync(clusters, JSON.stringify([{
    key: "a.ts::1", severity: "low", contested: false, members: [], agreement: { count: 1, total: 4 },
    representative: { title: "minor nit", severity: "low", file: "a.ts", line: 1, rationale: "r", suggestion: "s" },
  }]));
  writeFileSync(meta, JSON.stringify({ reviewers: [{ reviewer: "holistic", model: "kimi" }] }));
  writeFileSync(empty, ""); // an empty file stands in for /dev/null — readJsonArg must treat it as []

  it("treats an EMPTY adjudications file as [] (no real `[]` file needed)", () => {
    const decision = JSON.parse(run(["decide", clusters, empty, meta]));
    expect(decision.verdict).toBe("pass");
  });

  it("treats /dev/null as [] for adjudications", () => {
    const decision = JSON.parse(run(["decide", clusters, "/dev/null", meta]));
    expect(decision.verdict).toBe("pass");
  });

  it("an empty/`/dev/null` adjudications file CANNOT clear a GATING finding — it still blocks (fail-safe)", () => {
    const gating = join(dir, "gating.json");
    writeFileSync(gating, JSON.stringify([{
      key: "a.ts::10::race", severity: "high", contested: false, members: [], agreement: { count: 1, total: 4 },
      representative: { title: "race", severity: "high", file: "a.ts", line: 10, rationale: "r", suggestion: "s" },
    }]));
    for (const adj of ["/dev/null", empty]) {
      const decision = JSON.parse(run(["decide", gating, adj, meta]));
      expect(decision.verdict, adj).toBe("block");      // no dismissals → the high finding still blocks
      expect(decision.blocking, adj).toHaveLength(1);
    }
  });

  it("accepts the previous-round set via --prev (order-independent, after meta)", () => {
    const prev = join(dir, "prev.json");
    writeFileSync(prev, JSON.stringify([{
      key: "a.ts::9::old", severity: "high", contested: false, members: [], agreement: { count: 1, total: 4 },
      representative: { title: "old blocker", severity: "high", file: "a.ts", line: 9, rationale: "r", suggestion: "s" },
    }]));
    const metaR2 = join(dir, "meta-r2.json");
    writeFileSync(metaR2, JSON.stringify({ reviewers: [{ reviewer: "holistic", model: "kimi" }], round: 2 }));
    const decision = JSON.parse(run(["decide", clusters, "[]", metaR2, "--prev", prev]));
    expect(decision.prComment).toContain("### Progress since Round 1");
    expect(decision.prComment).toMatch(/✅ Resolved \(1\)/);
  });
});

// Episode 4 (#2): `collect <dir>` gathers the per-pass out-*.json into outputs.json + meta.json,
// end-to-end through the committed dist/ — the deterministic replacement for the hand-rolled python glue.
describe("cli `collect` verb (committed dist/ artifact)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rg-cli-collect-"));
  const env = (name: string, obj: unknown) => writeFileSync(join(dir, name), JSON.stringify(obj));
  // inconsistent filenames on purpose — collect must read reviewer/model from CONTENTS, not the name
  env("out-holistic-codex.json", { reviewer: "holistic", backend: "codex", model: "gpt-5.5", output: { reviewer: "holistic", model: "codex:gpt-5.5", findings: [{ title: "race", severity: "high", file: "a.ts", line: 9, rationale: "r", suggestion: "s" }] }, warning: null });
  env("out-spec.json", { reviewer: "lens-spec", backend: "claude", model: "claude-opus-4-8", output: null, warning: "claude-opus-4-8: error_max_turns" });
  env("out-scan.json", { output: { reviewer: "tools", model: "deterministic", findings: [] }, warning: null });

  it("writes outputs.json + meta.json with derived reviewers + missing", () => {
    const res = JSON.parse(run(["collect", dir, "--round", "1"]));
    expect(res.voted).toBe(1);   // one model voter (codex); the scan isn't a 'reviewer pass'
    expect(res.missing).toBe(1); // the opus non-vote

    const outputs = JSON.parse(readFileSync(join(dir, "outputs.json"), "utf8"));
    expect(outputs.some((o: { reviewer: string }) => o.reviewer === "holistic")).toBe(true);
    expect(outputs.some((o: { reviewer: string }) => o.reviewer === "tools")).toBe(true); // scan folded in

    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    expect(meta.round).toBe(1);
    expect(meta.reviewers).toEqual([{ reviewer: "holistic", model: "codex:gpt-5.5" }]); // tools excluded
    expect(meta.missing).toEqual([{ reviewer: "lens-spec", model: "claude:claude-opus-4-8", reason: "claude-opus-4-8: error_max_turns" }]);
  });

  it("the collected outputs.json + meta.json drive consolidate + decide cleanly (round-trip)", () => {
    run(["collect", dir, "--round", "1"]);
    const clustersOut = run(["consolidate", join(dir, "outputs.json")]);
    writeFileSync(join(dir, "clusters.json"), clustersOut);
    const decision = JSON.parse(run(["decide", join(dir, "clusters.json"), "[]", join(dir, "meta.json")]));
    expect(decision.verdict).toBe("block"); // the high-severity race blocks
    expect(decision.prComment).toContain("⚠️ **Coverage:**"); // the opus non-vote surfaces in the Coverage line
    expect(decision.prComment).toContain("_by:_ holistic");    // reviewer attribution (#4) end-to-end
  });

  it("accepts an orchestrator --missing for a pass that produced no file", () => {
    const res = JSON.parse(run(["collect", dir, "--round", "2", "--missing", "lens-security|ollama:glm|backend skipped"]));
    expect(res.missing).toBe(2); // the opus non-vote file + the supplied one
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    expect(meta.missing).toContainEqual({ reviewer: "lens-security", model: "ollama:glm", reason: "backend skipped" });
  });

  it("rejects a non-positive-integer --round at the gatherer (not two steps later in decide)", () => {
    for (const bad of ["abc", "0", "2.5", "-1"]) {
      expect(() => run(["collect", dir, "--round", bad]), bad).toThrow();
    }
  });

  it("rejects a malformed --missing ('reviewer|model|reason' required)", () => {
    expect(() => run(["collect", dir, "--round", "1", "--missing", "onlyonefield"])).toThrow();
  });

  it("folds a --scan file in exactly once even when it also matches the out-*.json glob (dedup)", () => {
    // out-scan.json is already globbed; passing it again via --scan must not double-count it
    const res = JSON.parse(run(["collect", dir, "--round", "1", "--scan", join(dir, "out-scan.json")]));
    const outputs = JSON.parse(readFileSync(join(dir, "outputs.json"), "utf8"));
    expect(outputs.filter((o: { reviewer: string }) => o.reviewer === "tools")).toHaveLength(1);
    expect(res.voted).toBe(1);
  });
});
