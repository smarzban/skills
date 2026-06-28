import { describe, it, expect } from "vitest";
import { buildCommand, parseFindings, parseClaudeResult, parseCodexFinal, runReview, isAffirmativelyEmpty, spawnWithDeadline, DEFAULT_ALLOWED_TOOLS, type ModelCall } from "../src/runner.js";

describe("buildCommand", () => {
  it("ollama backend launches claude via ollama with the model after `--`", () => {
    const { bin, args } = buildCommand("ollama", "kimi-k2.7-code:cloud", "review", "/repo");
    expect(bin).toBe("ollama");
    expect(args.slice(0, 5)).toEqual(["launch", "claude", "--model", "kimi-k2.7-code:cloud", "--"]);
    expect(args).toContain("--output-format"); expect(args).toContain("json");
    expect(args).toContain(DEFAULT_ALLOWED_TOOLS);
  });
  it("claude backend runs native claude with the model + read-only tools", () => {
    const { bin, args } = buildCommand("claude", "claude-opus-4-8", "review", "/repo");
    expect(bin).toBe("claude");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-4-8");
    expect(args).toContain("--output-format");
  });
  it("codex backend runs `codex exec` with high reasoning effort + read-only sandbox", () => {
    const { bin, args } = buildCommand("codex", "gpt-5.5", "review", "/repo");
    expect(bin).toBe("codex");
    expect(args.slice(0, 2)).toEqual(["exec", "-C"]);
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-5.5");
    expect(args.join(" ")).toMatch(/model_reasoning_effort="high"/);
    expect(args.join(" ")).toMatch(/sandbox_mode="read-only"/);
  });
  it("read-only tools never include write/edit", () => {
    expect(DEFAULT_ALLOWED_TOOLS).not.toMatch(/Write|Edit/);
  });
  it("ollama and claude cap the agent loop with --max-turns (cost circuit-breaker against runaway request loops)", () => {
    for (const b of ["ollama", "claude"] as const) {
      const { args } = buildCommand(b, "m", "review", "/repo");
      const i = args.indexOf("--max-turns");
      expect(i, b).toBeGreaterThan(-1);
      expect(Number(args[i + 1]), b).toBeGreaterThan(0);
    }
  });
  it("codex does not get --max-turns (different CLI)", () => {
    expect(buildCommand("codex", "m", "review", "/repo").args).not.toContain("--max-turns");
  });
  // Episode 3 (#1): kimi/glm on holistic/lens prompts legitimately need >25 turns to converge, so the
  // old cap recorded them as non-votes. Raised to 50 — still bounded; the 600s wall-clock + byte cap
  // remain the real runaway-cost backstops (this is the secondary guard). Assumes env unset in tests.
  it("the default agent-loop cap is raised to 50 turns (kimi/glm need >25 to converge)", () => {
    for (const b of ["ollama", "claude"] as const) {
      const { args } = buildCommand(b, "m", "review", "/repo");
      expect(Number(args[args.indexOf("--max-turns") + 1]), b).toBe(50);
    }
  });
  // Episode 3 (orchestrator note): a RELATIVE worktree path broke codex (its `-C <dir>` resolved
  // against a cwd that was already the worktree → doubled path → 2 failures). Defensive: absolutize.
  it("codex gets an ABSOLUTE -C path even when handed a relative repoDir", () => {
    const dir = buildCommand("codex", "m", "review", "some/rel/worktree").args[2]; // the value after `-C`
    expect(dir.startsWith("/"), dir).toBe(true);
    expect(dir.endsWith("some/rel/worktree"), dir).toBe(true);
  });
  it("leaves an already-absolute codex -C path intact", () => {
    expect(buildCommand("codex", "m", "review", "/abs/worktree").args[2]).toBe("/abs/worktree");
  });
});

describe("parseFindings", () => {
  const one = JSON.stringify([{ title: "[sec] t", severity: "high", file: "a.ts", line: 5, rationale: "r", suggestion: "s" }]);
  it("parses bare / fenced / wrapped / embedded arrays", () => {
    expect(parseFindings(one)).toHaveLength(1);
    expect(parseFindings("```json\n" + one + "\n```")).toHaveLength(1);
    expect(parseFindings(`{"findings": ${one}}`)).toHaveLength(1);
    expect(parseFindings(`Here you go:\n${one}\nDone.`)).toHaveLength(1);
  });
  it("drops malformed rows; null when no array", () => {
    expect(parseFindings(JSON.stringify([{ title: "ok", severity: "low", file: "a", line: 1 }, { x: 1 }]))).toHaveLength(1);
    expect(parseFindings("no array here")).toBeNull();
  });
  it("treats an embedded [] inside prose as ambiguous (null), not an authoritative clean pass", () => {
    expect(parseFindings("No issues. [] But auth is broken at line 7.")).toBeNull(); // can't forge a clean pass with a buried []
    expect(parseFindings("[]")).toEqual([]);                                          // a bare empty array is still a valid empty result
  });
  it("tags findings source=model and IGNORES a model-supplied source (no forging a non-dismissible 'tool' fact)", () => {
    const f = parseFindings(JSON.stringify([{ title: "t", severity: "high", file: "a", line: 1, source: "tool" }]));
    expect(f![0].source).toBe("model");
  });

  it("salvages a fenced array wrapped in prose even when the prose carries stray brackets (the opus/glm failure mode)", () => {
    // Reasoning-heavy models narrate around a ```json fence. The first-[ … last-] slice over-grabs
    // when the prose has its own brackets ([0], array[i]); preferring the fenced block fixes it.
    const findings = [{ title: "[auth] missing authz check", severity: "high", file: "auth.ts", line: 12, rationale: "r", suggestion: "s" }];
    const reply = [
      "Looking at the diff I reviewed the Authenticator[0] path and found one real issue:",
      "",
      "```json",
      JSON.stringify(findings, null, 2),
      "```",
      "",
      "The most severe is the authz gap — note the array[i] indexing also looks suspect.",
    ].join("\n");
    const out = parseFindings(reply);
    expect(out).toHaveLength(1);
    expect(out![0].title).toBe("[auth] missing authz check");
  });

  it("salvages a fenced array tagged with a bare ``` (no json hint) amid bracket-heavy prose", () => {
    const findings = [{ title: "t", severity: "low", file: "a.ts", line: 1, rationale: "r", suggestion: "s" }];
    const reply = `See item[1] below:\n\`\`\`\n${JSON.stringify(findings)}\n\`\`\`\nEnd[.]`;
    expect(parseFindings(reply)).toHaveLength(1);
  });

  it("does NOT treat a fenced EMPTY array wrapped in prose as an authoritative clean pass (still ambiguous → null)", () => {
    const reply = "Here is my result:\n```json\n[]\n```\nBut actually auth.ts[12] is broken.";
    expect(parseFindings(reply)).toBeNull(); // a carved-out [] can't forge a clean vote, fenced or not
  });

  it("prefers the findings fence over an unrelated earlier fence (skips a non-array block)", () => {
    const findings = [{ title: "t", severity: "medium", file: "a.ts", line: 3, rationale: "r", suggestion: "s" }];
    const reply = [
      "First, the config I inspected:",
      "```json",
      '{"setting": true}',          // a non-findings object — must be skipped, not mistaken for the answer
      "```",
      "Then my findings:",
      "```json",
      JSON.stringify(findings),
      "```",
    ].join("\n");
    expect(parseFindings(reply)).toHaveLength(1);
  });

  // The panel (kimi+glm+codex, 3/3) caught these on the FIRST salvage cut: a non-findings / empty /
  // example array in an EARLIER fence either forged a clean [] vote or masked the real findings in a
  // later fence. Fix: take the LAST fence that validates to ≥1 real finding.
  const real = [{ title: "[bug] real", severity: "high", file: "x.ts", line: 9, rationale: "r", suggestion: "s" }];

  it("a non-findings array fence BEFORE the real findings does not forge a clean vote (the medium)", () => {
    const reply = `Files I touched:\n\`\`\`json\n["a.ts","b.ts"]\n\`\`\`\nFindings:\n\`\`\`json\n${JSON.stringify(real)}\n\`\`\``;
    const out = parseFindings(reply);
    expect(out).toHaveLength(1);            // not [] (clean vote), not the string array
    expect(out![0].title).toBe("[bug] real");
  });

  it("surfaces findings from EVERY fence — an example before the real answer is surfaced too, never silently dropped", () => {
    const example = [{ title: "[example] format demo", severity: "info", file: "doc.md", line: 1, rationale: "", suggestion: "" }];
    const reply = `Format I'll use:\n\`\`\`json\n${JSON.stringify(example)}\n\`\`\`\nNow the actual review:\n\`\`\`json\n${JSON.stringify(real)}\n\`\`\``;
    const out = parseFindings(reply);
    expect(out!.some(f => f.title === "[bug] real")).toBe(true);    // the real finding survives
    expect(out).toHaveLength(2);                                    // union: example (advisory info) + real — orchestrator adjudicates the example
  });

  it("an empty [] fence does not shadow real findings in a later fence", () => {
    const reply = `No issues in module A:\n\`\`\`json\n[]\n\`\`\`\nBut module B:\n\`\`\`json\n${JSON.stringify(real)}\n\`\`\``;
    expect(parseFindings(reply)).toHaveLength(1);
  });

  it("a lone non-findings array fence (no real fence) stays a non-vote (null), never a forged clean []", () => {
    const reply = "Changed files:\n```json\n[\"a.ts\", \"b.ts\"]\n```\nThat's the scope.";
    expect(parseFindings(reply)).toBeNull(); // string arrays validate to 0 findings → not a clean vote
  });

  // lens-security (glm+codex): a trailing decoy fence MUST NOT mask a real critical in an earlier fence.
  it("UNIONs findings across fences so a trailing decoy cannot mask a real critical in an earlier fence", () => {
    const critical = [{ title: "[sec] RCE", severity: "critical", file: "x.ts", line: 1, rationale: "r", suggestion: "s" }];
    const decoy = [{ title: "[style] nit", severity: "low", file: "y.ts", line: 2, rationale: "r", suggestion: "s" }];
    const reply = `Serious:\n\`\`\`json\n${JSON.stringify(critical)}\n\`\`\`\nMinor:\n\`\`\`json\n${JSON.stringify(decoy)}\n\`\`\``;
    const out = parseFindings(reply);
    expect(out!.some(f => f.severity === "critical" && f.title.includes("RCE"))).toBe(true); // NOT dropped
    expect(out).toHaveLength(2);
  });

  // lens-security (codex high): a whole-message array of elements that validate to ZERO findings is
  // garbage, not "no findings" — it must be a surfaced non-vote, never a forged clean [] vote.
  it("a whole-message array with elements but ZERO valid findings is a non-vote (null), not a forged clean []", () => {
    expect(parseFindings('["a.ts","b.ts"]')).toBeNull();                    // a list of strings is not a clean result
    expect(parseFindings('{"findings":[{"severity":"high"}]}')).toBeNull(); // no title/file → 0 valid → non-vote
    expect(parseFindings("[]")).toEqual([]);                                // a GENUINE empty array is still a clean vote
    expect(parseFindings('{"findings":[]}')).toEqual([]);                   // …as is a genuine empty wrapper
  });
});

describe("parseClaudeResult / parseCodexFinal", () => {
  it("extracts the result field from a claude envelope", () => {
    const env = JSON.stringify({ is_error: false, result: "[]" });
    expect(parseClaudeResult(env).isError).toBe(false);
  });
  it("flags is_error / unparseable envelopes", () => {
    expect(parseClaudeResult(JSON.stringify({ is_error: true, result: "[]" })).isError).toBe(true);
    expect(parseClaudeResult("nope").isError).toBe(true);
  });
  // Episode 3 (#1): the harness envelope carries a `subtype` (e.g. error_max_turns). Surface it so a
  // non-vote names WHY it failed (max-turns vs other), instead of an opaque "harness reported is_error".
  it("surfaces the envelope subtype (error_max_turns) for diagnosable non-votes", () => {
    const r = parseClaudeResult(JSON.stringify({ is_error: true, subtype: "error_max_turns", result: "" }));
    expect(r.isError).toBe(true);
    expect(r.subtype).toBe("error_max_turns");
  });
  it("pulls the final assistant block out of a codex trace", () => {
    const trace = ["OpenAI Codex", "exec", "...tool output...", "codex", "thinking aloud", "codex", '[{"x":1}]', "tokens used", "2829"].join("\n");
    expect(parseCodexFinal(trace)).toBe('[{"x":1}]');
  });
});

describe("runReview", () => {
  const clean = JSON.stringify([{ title: "bug", severity: "high", file: "x.ts", line: 1, rationale: "r", suggestion: "s" }]);
  const claudeEnv = (result: string, is_error = false) => JSON.stringify({ is_error, result });
  const codexTrace = (result: string) => `exec\nfoo\ncodex\n${result}\ntokens used\n10`;

  it("parses an ollama/claude backend via the envelope", async () => {
    const call: ModelCall = async () => claudeEnv(clean);
    const { output } = await runReview("holistic", "ollama", "kimi-k2.7-code:cloud", "/repo", "p", { call });
    expect(output!.model).toBe("ollama:kimi-k2.7-code:cloud");
    expect(output!.findings).toHaveLength(1);
  });
  it("parses a codex backend via the trace footer", async () => {
    const call: ModelCall = async () => codexTrace(clean);
    const { output } = await runReview("holistic", "codex", "gpt-5.5", "/repo", "p", { call });
    expect(output!.model).toBe("codex:gpt-5.5");
    expect(output!.findings).toHaveLength(1);
  });
  it("passes backend + repoDir through to the call", async () => {
    let seen = { b: "", dir: "" };
    const call: ModelCall = async (b, _m, _p, dir) => { seen = { b, dir }; return claudeEnv("[]"); };
    await runReview("holistic", "claude", "claude-opus-4-8", "/work/pr", "p", { call });
    expect(seen).toEqual({ b: "claude", dir: "/work/pr" });
  });
  it("warns (never throws) on failure", async () => {
    const call: ModelCall = async () => { throw new Error("timed out after 600000ms"); };
    const { output, warning } = await runReview("holistic", "codex", "gpt-5.5", "/repo", "p", { call });
    expect(output).toBeNull();
    expect(warning).toMatch(/timed out/);
  });

  it("treats a completed 'no issues' prose reply as a 0-findings vote (not a failure)", async () => {
    const call: ModelCall = async () => claudeEnv("No issues found.");
    const { output, warning } = await runReview("holistic", "claude", "claude-opus-4-8", "/repo", "p", { call });
    expect(warning).toBeUndefined();
    expect(output!.findings).toEqual([]);
  });

  it("does NOT swallow a finding hidden behind a 'no issues … but …' reply (stays a non-vote)", async () => {
    const call: ModelCall = async () => claudeEnv("No critical issues, but bin/review-gate:7 is fragile under symlinks.");
    const { output, warning } = await runReview("holistic", "claude", "claude-opus-4-8", "/repo", "p", { call });
    expect(output).toBeNull();
    expect(warning).toMatch(/unparseable/);
  });

  it("also recognizes an empty 'no issues' reply on the codex trace path", async () => {
    const call: ModelCall = async () => codexTrace("No issues found in this change.");
    const { output } = await runReview("holistic", "codex", "gpt-5.5", "/repo", "p", { call });
    expect(output!.findings).toEqual([]);
  });

  // Episode 3 (#1): a harness error names its subtype in the warning (the Coverage line then says WHY
  // a reviewer was lost), not a generic "is_error". error_max_turns is NOT retried — retrying with the
  // same cap reproduces it; the raised cap (40) is the actual fix for a legit over-25-turn review.
  it("surfaces the harness error subtype (error_max_turns) in the warning, and does NOT retry it", async () => {
    let n = 0;
    const call: ModelCall = async () => { n++; return JSON.stringify({ is_error: true, subtype: "error_max_turns", result: "" }); };
    const { output, warning } = await runReview("holistic", "ollama", "kimi", "/repo", "p", { call });
    expect(output).toBeNull();
    expect(warning).toMatch(/error_max_turns/);
    expect(n).toBe(1); // a determined max-turns failure isn't retried (cost) — the raised cap is the fix
  });

  // Episode 3 (#4): a TRANSIENT spawn failure (non-zero exit / connection reset) is retried ONCE before
  // it's counted as lost coverage — flaky local backends shouldn't silently thin the panel.
  it("retries a transient spawn failure ONCE, then succeeds (no warning)", async () => {
    let n = 0;
    const call: ModelCall = async () => { n++; if (n === 1) throw new Error("exited 1: connection reset by peer"); return claudeEnv(clean); };
    const { output, warning } = await runReview("holistic", "ollama", "kimi", "/repo", "p", { call });
    expect(n).toBe(2);                         // retried once
    expect(output!.findings).toHaveLength(1);  // recovered
    expect(warning).toBeUndefined();
  });

  it("a transient failure that PERSISTS through the retry stays a surfaced non-vote (Coverage line intact)", async () => {
    let n = 0;
    const call: ModelCall = async () => { n++; throw new Error("exited 1: still flaky"); };
    const { output, warning } = await runReview("holistic", "ollama", "kimi", "/repo", "p", { call });
    expect(n).toBe(2);                  // tried twice, then gave up
    expect(output).toBeNull();
    expect(warning).toMatch(/still flaky/);
    expect(warning).toMatch(/retr/i);  // annotated as retried, for diagnosability
  });

  it("does NOT retry a timeout (deliberate runaway guard — a retry doubles GPU cost)", async () => {
    let n = 0;
    const call: ModelCall = async () => { n++; throw new Error("timed out after 600000ms"); };
    const { output, warning } = await runReview("holistic", "ollama", "kimi", "/repo", "p", { call });
    expect(n).toBe(1);                  // single attempt
    expect(output).toBeNull();
    expect(warning).toMatch(/timed out/);
  });

  it("does NOT retry a byte-cap abort (a hard failure, not transient)", async () => {
    let n = 0;
    const call: ModelCall = async () => { n++; throw new Error("output exceeded 1024 bytes"); };
    const { output } = await runReview("holistic", "ollama", "kimi", "/repo", "p", { call });
    expect(n).toBe(1);
    expect(output).toBeNull();
  });

  it("does NOT retry a missing binary (ENOENT) — retrying a config error is pointless", async () => {
    let n = 0;
    const call: ModelCall = async () => { n++; throw new Error("spawn codex ENOENT"); };
    const { output } = await runReview("holistic", "codex", "gpt-5.5", "/repo", "p", { call });
    expect(n).toBe(1);
    expect(output).toBeNull();
  });

  it("does NOT retry a model that RESPONDED but unparseably (a model-behavior issue, not a transient spawn failure)", async () => {
    let n = 0;
    const call: ModelCall = async () => { n++; return claudeEnv("rambling prose, no array at all"); };
    const { output, warning } = await runReview("holistic", "ollama", "kimi", "/repo", "p", { call });
    expect(n).toBe(1);                  // a parse non-vote is not a spawn failure → no retry
    expect(output).toBeNull();
    expect(warning).toMatch(/unparseable/);
  });

  // Episode 5 (#1): an "unparseable output" non-vote used to discard the model's raw reply entirely —
  // the saved envelope was just {output:null, warning:"unparseable output"}, so a later investigator
  // could not tell pure-prose from a buried-array-the-salvage-missed without RE-RUNNING (which can give
  // a different, non-reproducing answer). The non-vote now carries a bounded `rawTail` so every non-vote
  // self-diagnoses parser-vs-model from its own saved envelope. Model-agnostic — any flaky reviewer.
  it("a non-vote (unparseable) retains a bounded rawTail of the model's reply so it's diagnosable post-hoc", async () => {
    const reply = "I reviewed the diff carefully and concluded there is a subtle risk worth noting here.";
    const call: ModelCall = async () => claudeEnv(reply);
    const { output, warning, rawTail } = await runReview("verify", "claude", "claude-opus-4-8", "/repo", "p", { call });
    expect(output).toBeNull();
    expect(warning).toMatch(/unparseable/);
    expect(rawTail).toContain("subtle risk worth noting");
  });

  it("a clean vote carries NO rawTail (the raw is only retained when the vote was lost)", async () => {
    const call: ModelCall = async () => claudeEnv(clean);
    const { output, rawTail } = await runReview("holistic", "ollama", "kimi", "/repo", "p", { call });
    expect(output!.findings).toHaveLength(1);
    expect(rawTail).toBeUndefined();
  });

  it("the rawTail is bounded to a tail (a runaway reply can't bloat the saved envelope)", async () => {
    const reply = "PREAMBLE " + "blah ".repeat(1000) + "FINAL_TELL_AT_END";  // well over the cap
    const call: ModelCall = async () => claudeEnv(reply);
    const { rawTail } = await runReview("verify", "claude", "claude-opus-4-8", "/repo", "p", { call });
    expect(rawTail!.length).toBeLessThanOrEqual(1000);
    expect(rawTail).toContain("FINAL_TELL_AT_END");  // tail kept (the array, if any, lands at the end)
    expect(rawTail).not.toContain("PREAMBLE");        // head dropped
  });

  it("a harness-error non-vote with a partial result also retains the rawTail", async () => {
    const call: ModelCall = async () => JSON.stringify({ is_error: true, subtype: "error_during_execution", result: "got partway then the harness errored" });
    const { output, warning, rawTail } = await runReview("holistic", "claude", "claude-opus-4-8", "/repo", "p", { call });
    expect(output).toBeNull();
    expect(warning).toMatch(/error_during_execution/);
    expect(rawTail).toContain("got partway");
  });

  // The codex path has NO is_error branch — an unparseable codex trace reaches the rawTail attach via a
  // different control path (parseCodexFinal, not parseClaudeResult). Pin it so a future codex-branch
  // refactor can't silently drop the rawTail with the suite still green.
  it("a codex non-vote (unparseable trace) also retains a rawTail (codex has no is_error branch)", async () => {
    const call: ModelCall = async () => codexTrace("rambling prose, no array at all");
    const { output, warning, rawTail } = await runReview("verify", "codex", "gpt-5.5", "/repo", "p", { call });
    expect(output).toBeNull();
    expect(warning).toMatch(/unparseable/);
    expect(rawTail).toContain("rambling prose");
  });
});

// Episode 3 (#2): spawnWithDeadline threw `${stderr}.slice(0,200)` — the HEAD — so a benign leading
// warning hid the real error at the tail. It now routes stderr through errorTail (tail-preserving).
describe("spawnWithDeadline surfaces the real error at the tail of stderr", () => {
  const NODE = process.execPath;
  it("keeps the tail so a benign connectors warning at the head can't hide the real failure", async () => {
    const src = "process.stderr.write('warning: connector mcp-x failed\\n' + 'noise '.repeat(120) + '\\nFATAL_REAL_ERROR_AT_TAIL'); process.exit(1);";
    await expect(spawnWithDeadline(NODE, ["-e", src], { cwd: process.cwd(), timeoutMs: 5000 }))
      .rejects.toThrow(/FATAL_REAL_ERROR_AT_TAIL/);
  }, 8000);
});

describe("isAffirmativelyEmpty (fail-safe: only an UNAMBIGUOUS whole-message 'no issues' counts)", () => {
  it("accepts a clean, whole-message empty declaration", () => {
    for (const s of ["No issues found.", "no issues", "I found no problems in this change.", "Looks good.", "LGTM", "Nothing to report.", "No bugs found", "[]"]) {
      expect(isAffirmativelyEmpty(s), s).toBe(true);
    }
  });
  it("accepts a fenced empty array", () => {
    expect(isAffirmativelyEmpty("```json\n[]\n```")).toBe(true);
  });
  it("REJECTS anything that hedges or carries extra substance (fail-open traps)", () => {
    for (const s of [
      "No critical issues, but the symlink handling is fragile.",          // contrast → hidden finding
      "No issues. The dist/ drift is a minor nit.",                        // empty phrase + extra substance
      "Overall solid. One concern: committed dist can go stale.",          // a real finding, softly phrased
      "No high-severity issues; see bin/review-gate:7 for a low one.",     // file:line reference
      "Looks good overall, though tests are thin.",                        // 'though' hedge
      '[{"title":"x"}]',                                                    // an actual (malformed) finding attempt
      "No issues, but thin tests.",                                        // COMMA-joined short hedge (the dogfood-found hole)
      "No issues, auth is broken.",                                        // comma-joined finding, no period separator
      "Zero problems, although the regex is fragile.",                     // 'although' after a comma
      "No critical issues found.",                                         // SCOPED — says nothing about lower severities
      "No security vulnerabilities.",                                      // scoped to one dimension
      "No issues 权限绕过",                                                  // non-ASCII finding text after "no issues"
      "No issues. [] But auth is broken at line 7.",                       // embedded [] + a real prose finding
      "No vulnerabilities found in this change.",                          // dimension-SCOPED (says nothing of correctness/perf)
      "No security issues.",                                               // scoped to one dimension
    ]) {
      expect(isAffirmativelyEmpty(s), s).toBe(false);
    }
  });
  it("rejects an empty/blank reply from a 'successful' run (suspect, not confidently empty)", () => {
    expect(isAffirmativelyEmpty("")).toBe(false);
    expect(isAffirmativelyEmpty("   \n  ")).toBe(false);
  });
});
