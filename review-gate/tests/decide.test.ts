import { describe, it, expect } from "vitest";
import { decide } from "../src/decide.js";
import type { FindingCluster, Severity, RunMeta } from "../src/types.js";

const cluster = (key: string, severity: Severity): FindingCluster => ({
  key,
  representative: { title: `t-${key}`, severity, file: key.split("::")[0], line: 1, rationale: "r", suggestion: "s" },
  members: [],
  agreement: { count: 1, total: 3 },
  severity,
  contested: true,
});

describe("decide", () => {
  it("blocks on any gating cluster with no adjudication", () => {
    const d = decide([cluster("a.ts::1", "high")]);
    expect(d.verdict).toBe("block");
    expect(d.blocking).toHaveLength(1);
  });

  it("passes when all clusters are low/info (advisory)", () => {
    const d = decide([cluster("a.ts::1", "low"), cluster("b.ts::1", "info")]);
    expect(d.verdict).toBe("pass");
    expect(d.blocking).toHaveLength(0);
  });

  it("honors a dismissal WITH justification (does not block, logs it)", () => {
    const d = decide([cluster("a.ts::1", "high")], [{ key: "a.ts::1", decision: "dismissed", justification: "intended; aligns with documented contract" }]);
    expect(d.verdict).toBe("pass");
    expect(d.dismissed).toHaveLength(1);
    expect(d.dismissed[0].justification).toMatch(/documented contract/);
  });

  it("NO SILENT DISMISSAL: an unjustified dismissal of a gating finding still blocks", () => {
    const d = decide([cluster("a.ts::1", "high")], [{ key: "a.ts::1", decision: "dismissed" }]);
    expect(d.verdict).toBe("block");
    expect(d.blocking).toHaveLength(1);
    expect(d.dismissed).toHaveLength(0);
  });

  it("an empty-string justification is treated as no justification (still blocks)", () => {
    const d = decide([cluster("a.ts::1", "critical")], [{ key: "a.ts::1", decision: "dismissed", justification: "   " }]);
    expect(d.verdict).toBe("block");
  });

  it("a confirmed adjudication blocks", () => {
    const d = decide([cluster("a.ts::1", "medium")], [{ key: "a.ts::1", decision: "confirmed" }]);
    expect(d.verdict).toBe("block");
  });

  it("renders one PR comment with verdict + the blocking findings", () => {
    const d = decide([cluster("a.ts::1", "high")]);
    expect(d.prComment).toContain("Review Gate");
    expect(d.prComment).toContain("BLOCK");
    expect(d.prComment).toContain("Must fix");
  });
});

const toolCluster = (key: string, severity: Severity): FindingCluster => {
  const base = cluster(key, severity);
  const finding = { ...base.representative, source: "tool" as const };
  return { ...base, representative: finding, members: [{ reviewer: "tools", model: "deterministic", finding }] };
};

// Episode 4 (#4): the gate comment attributes each cluster to the reviewer ROLES that raised it, so
// one model run in several roles (opus as holistic + lens-spec + lens-simplify) is no longer a blur.
describe("decide — reviewer attribution in the comment", () => {
  it("shows the distinct reviewer roles that raised a cluster (_by:_), without changing agreement", () => {
    const c: FindingCluster = {
      key: "a.ts::10", severity: "high", contested: false, agreement: { count: 1, total: 4 },
      representative: { title: "race on shared state", severity: "high", file: "a.ts", line: 10, rationale: "r", suggestion: "s" },
      members: [
        { reviewer: "holistic", model: "claude:claude-opus-4-8", finding: { title: "race on shared state", severity: "high", file: "a.ts", line: 10, rationale: "r", suggestion: "s" } },
        { reviewer: "lens-simplify", model: "claude:claude-opus-4-8", finding: { title: "race on shared state", severity: "high", file: "a.ts", line: 11, rationale: "r", suggestion: "s" } },
      ],
    };
    const d = decide([c], [], { reviewers: [{ reviewer: "holistic", model: "claude:claude-opus-4-8" }] });
    expect(d.prComment).toContain("_by:_ holistic, lens-simplify"); // both roles attributed
    expect(d.prComment).toContain("1/4 models");                    // agreement unchanged (one model)
  });
});

describe("decide — deterministic (tool) findings", () => {
  it("does NOT honor a dismissal of a deterministic gating finding — a fact still blocks (no steered override)", () => {
    const c = toolCluster("config.ts::1", "high");
    const d = decide([c], [{ key: c.key, decision: "dismissed", justification: "looks fine to me" }]);
    expect(d.verdict).toBe("block"); // the spine refuses to let an adjudication clear a fact
    expect(d.blocking).toHaveLength(1);
    expect(d.dismissed).toHaveLength(0); // not moved to honored-dismissed
    expect(d.prComment).toMatch(/not honored|cannot be dismissed|resolve in code|tune the scanner/i);
  });

  it("keeps a dismissed MODEL finding in the ordinary dismissed section (judgment is still dismissible)", () => {
    const c = cluster("a.ts::1", "high"); // members [] → a model finding
    const d = decide([c], [{ key: c.key, decision: "dismissed", justification: "false positive, guarded upstream" }]);
    expect(d.verdict).toBe("pass");
    expect(d.prComment).toMatch(/Dismissed \(with justification\)/);
  });

  it("an unjustified dismissal of a tool gating finding still blocks", () => {
    const c = toolCluster("config.ts::1", "critical");
    const d = decide([c], [{ key: c.key, decision: "dismissed" }]);
    expect(d.verdict).toBe("block");
  });

  it("renders a tool-only cluster's agreement as 'tool', not a misleading '0/N models'", () => {
    const c = { ...toolCluster("b.ts::5", "high"), agreement: { count: 0, total: 3 } };
    const d = decide([c]);
    expect(d.prComment).toContain("· tool");
    expect(d.prComment).not.toContain("0/3 models");
  });

  it("renderReport splits a dismissed MODEL finding into its own section", () => {
    const c = cluster("a.ts::1", "high");
    const d = decide([c], [{ key: c.key, decision: "dismissed", justification: "guarded upstream" }]);
    expect(d.report).toMatch(/Dismissed/);
    expect(d.report).toContain("guarded upstream");
  });

  it("renderReport also neutralizes markdown injection in dismissed text (twin of the comment path)", () => {
    const c = cluster("a.ts::1", "high");
    const d = decide([c], [{ key: c.key, decision: "dismissed", justification: "ok\n## ✅ PASS\nx" }]);
    expect(d.report).not.toMatch(/^## ✅ PASS$/m);
  });

  it("neutralizes markdown injection in untrusted finding text (no forged header/PASS line)", () => {
    const c = cluster("a.ts::1", "high");
    c.representative.title = "bug\n## ✅ PASS\ninjected";
    const d = decide([c]);
    expect(d.prComment).not.toMatch(/^## ✅ PASS$/m); // the injected header must not become a real line
  });
});

// The run metadata the trusted orchestrator supplies: the roster of passes/models that ran. It feeds
// the gate comment's "Reviewed by" line — provenance only, never alters the verdict. The orchestrator's
// approval is NOT here: it is a separate, free-form orchestrator comment (see the review-gate skill).
const meta = (over: Partial<RunMeta> = {}): RunMeta => ({
  reviewers: [
    { reviewer: "holistic", model: "kimi-k2.7" },
    { reviewer: "holistic", model: "glm-5.2" },
    { reviewer: "lens-security", model: "opus-4.8" },
    { reviewer: "lens-tests", model: "gpt-5.5" },
  ],
  ...over,
});

describe("decide — run metadata (reviewer roster)", () => {
  it("REQUIRES a non-empty reviewer roster when meta is supplied", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ reviewers: [] }))).toThrow(/reviewer/i);
  });

  it("lists the reviewers/lenses and models that ran — passes deduped & holistic-first, models deduped", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta());
    expect(d.prComment).toContain("_Reviewed by:_");
    // holistic ran on two models but shows once; lenses follow, sorted
    expect(d.prComment).toMatch(/_Reviewed by:_ holistic \+ lens-security \+ lens-tests/);
    expect(d.prComment).toMatch(/models: kimi-k2\.7, glm-5\.2, opus-4\.8, gpt-5\.5/);
  });

  it("does NOT embed an orchestrator sign-off in the gate comment — that is a SEPARATE orchestrator comment", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta());
    expect(d.prComment).not.toMatch(/sign-off|orchestrator/i);
  });

  it("the roster is provenance only — it never changes the verdict", () => {
    const d = decide([cluster("a.ts::1", "high")], [], meta()); // gating, unadjudicated → BLOCK
    expect(d.verdict).toBe("block");
  });

  it("numbers the gate-comment heading with the round when one is supplied (multi-round loop)", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta({ round: 2 }));
    expect(d.prComment).toContain("## Review Gate — Round 2");
  });

  it("omits the round number from the heading when none is supplied (single-pass / backward-compat)", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta());
    expect(d.prComment).toMatch(/^## Review Gate$/m);
    expect(d.prComment).not.toMatch(/Review Gate — Round/);
  });

  it("rejects meta.round that is not a positive integer — non-numeric string", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ round: "2\n## ✅ PASS" as any }))).toThrow(/round/i);
  });

  it("rejects meta.round = 0 (not positive)", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ round: 0 }))).toThrow(/round/i);
  });

  it("rejects meta.round = -1 (negative)", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ round: -1 }))).toThrow(/round/i);
  });

  it("rejects meta.round = 1.5 (non-integer float)", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ round: 1.5 }))).toThrow(/round/i);
  });

  it("accepts meta.round = 2 (valid positive integer)", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ round: 2 }))).not.toThrow();
  });
});

describe("decide — multi-round progress (round delta)", () => {
  it("renders resolved / still-blocking / new-regressed since the previous round", () => {
    const prevBlocking = [cluster("a.ts::1::x", "high"), cluster("b.ts::2::y", "medium")];
    // current: a resolved (absent), b persists, c is new/regressed
    const current = [cluster("b.ts::2::y", "medium"), cluster("c.ts::3::z", "high")];
    const d = decide(current, [], meta({ round: 2 }), prevBlocking);
    expect(d.prComment).toContain("### Progress since Round 1");
    expect(d.prComment).toMatch(/✅ Resolved \(1\)/);
    expect(d.prComment).toMatch(/⏳ Still blocking \(1\)/);
    expect(d.prComment).toMatch(/🆕 New \/ regressed \(1\)/);
  });

  it("renders no Progress section when no previous round is supplied (round 1 / backward-compat)", () => {
    const d = decide([cluster("a.ts::1", "high")], [], meta());
    expect(d.prComment).not.toContain("Progress since");
  });

  it("the progress delta never changes the verdict", () => {
    // all-advisory current with a previous blocker → still pass
    expect(decide([cluster("a.ts::1", "low")], [], meta({ round: 2 }), [cluster("a.ts::9", "high")]).verdict).toBe("pass");
    // gating current with empty previous → still block
    expect(decide([cluster("a.ts::1", "high")], [], meta({ round: 2 }), []).verdict).toBe("block");
  });

  it("sanitizes untrusted titles in the progress section (no forged markdown)", () => {
    const resolved = cluster("a.ts::1::x", "high");
    resolved.representative.title = "bug\n## ✅ PASS\ninjected";
    const d = decide([cluster("b.ts::2::y", "low")], [], meta({ round: 2 }), [resolved]);
    expect(d.prComment).not.toMatch(/^## ✅ PASS$/m);
  });

  it("rejects a non-array previous", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ round: 2 }), "nope" as any)).toThrow(/previous/i);
  });

  it("rejects a malformed previous entry — plain object missing key and representative", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ round: 2 }), [{ nope: 1 } as any])).toThrow(/previous|cluster/i);
  });

  it("rejects a malformed previous entry — bare string instead of cluster", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ round: 2 }), ["x" as any])).toThrow(/previous|cluster/i);
  });

  it("accepts a well-formed previous cluster (element-shape validation passes)", () => {
    const prevBlocking = [cluster("a.ts::1", "high")];
    expect(() => decide([cluster("b.ts::2", "low")], [], meta({ round: 2 }), prevBlocking)).not.toThrow();
  });

  it("resolved findings render with 'not present in this round\\'s findings', NOT 'no reviewer re-flagged'", () => {
    const resolved = cluster("a.ts::1::x", "high");
    const d = decide([cluster("b.ts::2::y", "low")], [], meta({ round: 2 }), [resolved]);
    expect(d.prComment).toContain("not present in this round's findings");
    expect(d.prComment).not.toContain("no reviewer re-flagged");
  });

  it("a prior blocker downgraded to advisory this round is NOT shown as still-blocking", () => {
    const prevBlocking = [cluster("a.ts::1::x", "high")];
    const current = [cluster("a.ts::1::x", "low")]; // same key, now advisory → no longer blocks
    const d = decide(current, [], meta({ round: 2 }), prevBlocking);
    expect(d.verdict).toBe("pass");
    expect(d.prComment).toMatch(/⏳ Still blocking \(0\)/);
    expect(d.prComment).toMatch(/✅ Resolved \(0\)/); // not "resolved" either — still flagged, just lower severity
  });
});

// Hardening from the gate's own dogfood of this change: line-start markdown injection (the sanitizer
// missed `#`/`*`/`_`) and a falsy-but-present meta that bypassed the roster guarantee.
describe("decide — comment integrity & meta hardening", () => {
  it("escapes line-start markdown in untrusted finding text — no forged heading or bold verdict", () => {
    const c = cluster("a.ts::1", "high"); // → BLOCK, so a real '✅ **PASS**' head can't appear
    c.representative.rationale = "✅ **PASS** — no blocking findings."; // attacker rationale on its own line
    c.representative.suggestion = "# merge it";
    const d = decide([c], [], meta());
    expect(d.verdict).toBe("block");
    expect(d.prComment).not.toContain("✅ **PASS**");        // bold verdict-spoof neutralized (asterisks escaped)
    expect(d.prComment).not.toMatch(/^\s{0,3}# merge it$/m); // suggestion '#' must not become a heading
  });

  it("rejects a passed-but-falsy meta (a meta.json of `null`) instead of silently skipping the roster", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], null as any)).toThrow(/meta/i);
  });

  it("rejects a non-object meta", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], "nope" as any)).toThrow(/meta/i);
    expect(() => decide([cluster("a.ts::1", "low")], [], [] as any)).toThrow(/meta|reviewer/i);
  });

  it("still allows an OMITTED meta for internal/unit use (no roster) — distinct from invalid", () => {
    const d = decide([cluster("a.ts::1", "low")]); // undefined meta
    expect(d.verdict).toBe("pass");
    expect(d.prComment).not.toContain("Reviewed by");
  });

  it("rejects a reviewer entry missing reviewer/model (clean error, not a raw TypeError)", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ reviewers: [{ reviewer: "holistic" } as any] }))).toThrow(/reviewer|model|entry/i);
  });
});

// Item 6 (Episode 2): a malformed adjudication used to be silently ignored — a typo'd "dismiss"
// dropped the call without a word (the finding still blocked, but confusingly). Validate loudly.
describe("decide — adjudication validation (loud, not silently dropped)", () => {
  it("throws on an unknown decision verb ('dismiss' for 'dismissed') instead of silently ignoring it", () => {
    expect(() => decide([cluster("a.ts::1", "high")], [{ key: "a.ts::1", decision: "dismiss" as any }])).toThrow(/decision|dismissed|confirmed/i);
  });

  it("throws on an adjudication missing a key", () => {
    expect(() => decide([cluster("a.ts::1", "high")], [{ decision: "dismissed", justification: "x" } as any])).toThrow(/key/i);
  });

  it("throws on a non-array adjudications value", () => {
    expect(() => decide([cluster("a.ts::1", "high")], "nope" as any)).toThrow(/array/i);
  });

  it("throws on a non-string justification", () => {
    expect(() => decide([cluster("a.ts::1", "high")], [{ key: "a.ts::1", decision: "dismissed", justification: 5 as any }])).toThrow(/justification/i);
  });

  it("accepts well-formed adjudications (confirmed / dismissed-with-justification / justification-less)", () => {
    expect(() => decide([cluster("a.ts::1", "high")], [{ key: "a.ts::1", decision: "dismissed", justification: "checked: guarded upstream" }])).not.toThrow();
    expect(() => decide([cluster("a.ts::1", "high")], [{ key: "a.ts::1", decision: "confirmed" }])).not.toThrow();
    // a justification-LESS dismissal is well-formed (it just won't be honored — no silent dismissal)
    expect(() => decide([cluster("a.ts::1", "high")], [{ key: "a.ts::1", decision: "dismissed" }])).not.toThrow();
  });
});

// Item 4 (Episode 2): a thinned panel (a backend/auth failure, an unparseable non-vote, or a lens
// fired without its input — e.g. lens-spec with no spec) used to be visible only in the orchestrator's
// free-form prose. Make the loss a first-class, deterministic line so a degraded panel can't pass
// silently. meta.missing is provenance only — like reviewers/round, it never alters the verdict.
describe("decide — coverage loss (a degraded panel is loud, not silent)", () => {
  it("renders a Coverage line naming the lost passes when meta.missing is present", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta({
      missing: [{ reviewer: "holistic", model: "kimi-k2.7", reason: "auth failure" }, { reviewer: "lens-spec", model: "opus-4.8", reason: "no spec supplied" }],
    }));
    expect(d.prComment).toMatch(/Coverage/);
    expect(d.prComment).toContain("kimi-k2.7");
    expect(d.prComment).toContain("no spec supplied");
  });

  it("shows voted/planned (reviewers that voted vs voted+missing)", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta({ missing: [{ reviewer: "holistic", model: "glm-5.2", reason: "non-vote" }] }));
    expect(d.prComment).toMatch(/4\/5/); // meta() = 4 voted; +1 missing = 5 planned
  });

  it("omits the Coverage line on a full panel (nothing missing)", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta());
    expect(d.prComment).not.toMatch(/Coverage:/);
  });

  it("coverage is provenance only — it never changes the verdict", () => {
    const d = decide([cluster("a.ts::1", "high")], [], meta({ missing: [{ reviewer: "holistic", model: "x" }] }));
    expect(d.verdict).toBe("block");
  });

  it("rejects a malformed missing entry (no model)", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ missing: [{ reviewer: "holistic" } as any] }))).toThrow(/missing|model|reviewer/i);
  });

  it("rejects a non-array meta.missing", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ missing: "nope" as any }))).toThrow(/missing|array/i);
  });

  it("sanitizes untrusted reason text in the Coverage line (no forged markdown)", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta({ missing: [{ reviewer: "holistic", model: "x", reason: "x\n## ✅ PASS\ny" }] }));
    expect(d.prComment).not.toMatch(/^## ✅ PASS$/m);
  });
});

// Episode 5 (#2): a deterministic scan that ran but DEGRADED (a sub-scanner's tool absent — e.g.
// gitleaks → no secret scan) surfaced only in the scan envelope's warning, invisible in the rendered
// verdict — so a skipped secret scan read as "clean" and the signing orchestrator wrote "no secrets".
// Surface it as a first-class line. Like the Coverage line: display only, never alters the verdict
// (graceful degradation, made loud). The scan still VOTED, so this is distinct from meta.missing.
describe("decide — scan-tier degradation (a skipped fact-tier scanner is loud, not silent)", () => {
  it("renders a degradation line naming the skipped scanner", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta({ scanWarnings: ["secrets: gitleaks not on PATH — skipped"] }));
    expect(d.prComment).toMatch(/Scan tier degraded/);
    expect(d.prComment).toContain("gitleaks");
  });

  it("omits the degradation line when the scan ran clean (no scanWarnings)", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta());
    expect(d.prComment).not.toMatch(/Scan tier degraded/);
  });

  it("is provenance only — a degraded scan never changes the verdict", () => {
    const d = decide([], [], meta({ scanWarnings: ["secrets: gitleaks not on PATH — skipped"] }));
    expect(d.verdict).toBe("pass");
  });

  it("rejects a non-array meta.scanWarnings", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ scanWarnings: "nope" as any }))).toThrow(/scanWarnings|array/i);
  });

  it("rejects an empty / non-string scanWarnings entry", () => {
    expect(() => decide([cluster("a.ts::1", "low")], [], meta({ scanWarnings: [""] as any }))).toThrow(/scanWarnings|non-empty|string/i);
  });

  it("sanitizes untrusted warning text (no forged markdown)", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta({ scanWarnings: ["x\n## ✅ PASS\ny"] }));
    expect(d.prComment).not.toMatch(/^## ✅ PASS$/m);
  });

  it("an empty scanWarnings array renders no degradation line and does not throw (render gated on .length)", () => {
    const d = decide([cluster("a.ts::1", "low")], [], meta({ scanWarnings: [] }));
    expect(d.prComment).not.toMatch(/Scan tier degraded/);
    expect(d.verdict).toBe("pass");
  });
});
