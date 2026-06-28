import { SEVERITY_RANK, GATING } from "./types.js";
// The deterministic spine: clusters + the agent's adjudications → a land verdict, plus the single
// PR comment. The ONLY model judgment that enters here is an Adjudication, and even that is
// constrained: a MODEL gating finding can be dismissed only with a non-empty justification (no silent
// dismissal), and a TOOL (deterministic) gating finding can't be dismissed at all — the spine keeps
// it blocking regardless. Everything else — what blocks, the report, the verdict — is pure code, so a
// prompt-injected diff or a steered agent cannot flip the gate, bury a finding, or wave away a fact.
export function decide(clusters, adjudications = [], meta, previous) {
    // The orchestrator's metadata is REQUIRED to be well-formed when supplied — the roster must name the
    // passes that ran (so the gate comment can't silently drop provenance). This guards the real entry
    // point: the CLI always passes meta (see cli.ts). The orchestrator's approval is NOT here — it's a
    // separate free-form review comment the skill posts.
    if (meta !== undefined) {
        // A provided-but-falsy/non-object meta (e.g. a meta.json whose content is `null`) is REJECTED, not
        // silently skipped — otherwise the CLI's "every gate comment names the reviewers that ran" guarantee
        // could be bypassed with a falsy file. (Omitting meta entirely is still allowed for internal use.)
        const m = meta;
        if (!m || typeof m !== "object" || Array.isArray(m))
            throw new Error("decide: meta must be an object {reviewers} when provided.");
        if (!Array.isArray(meta.reviewers) || meta.reviewers.length === 0)
            throw new Error("decide: meta.reviewers must list the reviewer/lens passes that ran.");
        for (const r of meta.reviewers) {
            if (!r || typeof r.reviewer !== "string" || !r.reviewer.trim() || typeof r.model !== "string" || !r.model.trim())
                throw new Error("decide: each meta.reviewers entry must name a non-empty reviewer and model.");
        }
        if (meta.round !== undefined && (!Number.isInteger(meta.round) || meta.round <= 0))
            throw new Error("decide: meta.round must be a positive integer when provided.");
        if (meta.missing !== undefined) {
            if (!Array.isArray(meta.missing))
                throw new Error("decide: meta.missing must be an array of lost reviewer/lens passes when provided.");
            for (const r of meta.missing) {
                if (!r || typeof r.reviewer !== "string" || !r.reviewer.trim() || typeof r.model !== "string" || !r.model.trim())
                    throw new Error("decide: each meta.missing entry must name a non-empty reviewer and model.");
                if (r.reason !== undefined && typeof r.reason !== "string")
                    throw new Error("decide: meta.missing reason must be a string when provided.");
            }
        }
        if (meta.scanWarnings !== undefined) {
            if (!Array.isArray(meta.scanWarnings))
                throw new Error("decide: meta.scanWarnings must be an array of scan-tier warning strings when provided.");
            for (const w of meta.scanWarnings)
                if (typeof w !== "string" || !w.trim())
                    throw new Error("decide: each meta.scanWarnings entry must be a non-empty string.");
        }
    }
    if (previous !== undefined) {
        if (!Array.isArray(previous))
            throw new Error("decide: previous (the prior round's blocking clusters) must be an array when provided.");
        for (const c of previous) {
            if (!c || typeof c !== "object" || typeof c.key !== "string" || !c.key.trim() ||
                !c.representative || typeof c.representative.title !== "string")
                throw new Error("decide: each previous entry must be a cluster with a non-empty key and a representative.title.");
        }
    }
    // An adjudication is the ONE place model judgment enters the verdict, so a malformed one must fail
    // LOUD, not be silently dropped: a typo'd verb ("dismiss" for "dismissed") used to fall through and
    // leave the finding blocking with no explanation. Reject unknown verbs / missing keys here.
    if (!Array.isArray(adjudications))
        throw new Error("decide: adjudications must be an array (use [] for none).");
    for (const raw of adjudications) {
        const a = raw;
        if (!a || typeof a !== "object" || typeof a.key !== "string" || !a.key.trim())
            throw new Error("decide: each adjudication needs a non-empty string key.");
        if (a.decision !== "confirmed" && a.decision !== "dismissed")
            throw new Error(`decide: adjudication decision must be "confirmed" or "dismissed" (got ${JSON.stringify(a.decision)} for key "${a.key}").`);
        if (a.justification !== undefined && typeof a.justification !== "string")
            throw new Error(`decide: adjudication justification must be a string when provided (key "${a.key}").`);
    }
    const adj = new Map(adjudications.map((a) => [a.key, a]));
    const blocking = [];
    const dismissed = [];
    const rejectedOverrides = [];
    for (const c of clusters) {
        if (!GATING.has(c.severity))
            continue; // low/info are advisory — never block
        const a = adj.get(c.key);
        if (isDeterministic(c)) {
            // A deterministic (tool) finding is a FACT — the spine never lets an adjudication clear it, so
            // a prompt-injected or steered agent can't dismiss a committed secret with one string. Resolve
            // it in code, or tune the scanner's config/allowlist so it stops firing.
            blocking.push(c);
            if (a?.decision === "dismissed")
                rejectedOverrides.push({ cluster: c, justification: (a.justification ?? "").trim() });
            continue;
        }
        if (a?.decision === "dismissed") {
            const j = (a.justification ?? "").trim();
            if (j) {
                dismissed.push({ cluster: c, justification: j });
                continue;
            }
            // unjustified dismissal of a gating finding ⇒ NOT honored; it still blocks.
        }
        blocking.push(c);
    }
    const verdict = blocking.length > 0 ? "block" : "pass";
    return {
        verdict, blocking, dismissed,
        report: renderReport(clusters, dismissed, rejectedOverrides),
        prComment: renderComment(verdict, clusters, blocking, dismissed, rejectedOverrides, meta, previous),
    };
}
const ICON = { critical: "🔴", high: "🔴", medium: "🟠", low: "⚪", info: "⚪" };
// Untrusted text (model-supplied titles/rationale, attacker-influenced paths, agent justifications) is
// interpolated into the gate findings comment — often at the START of its own line (a finding's
// rationale/suggestion). Collapsing newlines alone is NOT enough there, so we also escape the markdown
// metacharacters that build block/inline structure: backtick, `<`/`>`, `[`/`]`, backslash, AND `#`
// (headings), `*`/`_` (emphasis — the "✅ **PASS**" verdict spoof), `|` (tables), `~` (strikethrough).
// So untrusted text can't forge a header, a bold verdict line, a table, break out of a code span, or
// inject HTML/links into the posted comment.
const sanitize = (s) => s.replace(/\s+/g, " ").replace(/[`<>\[\]\\#*_|~]/g, "\\$&").trim();
// The reviewer ROLES that raised this cluster (holistic, lens-simplify, …) — distinct + sorted,
// carried through consolidate so one model run in several roles is attributable. This is display only:
// agreement (above) still counts distinct MODELS, so a model in three roles is one vote, not three.
// A tool member shows "tools". Empty (e.g. a previous-round cluster fed back in) → no label.
function raisedBy(c) {
    return [...new Set(c.members.map((m) => m.reviewer))].filter(Boolean).sort().map(sanitize).join(", ");
}
function line(c) {
    const f = c.representative;
    const ag = agreementLabel(c);
    const area = f.area ? ` _(${sanitize(f.area)})_` : "";
    const by = raisedBy(c);
    const byLabel = by ? ` · _by:_ ${by}` : "";
    return `- ${ICON[c.severity]} **[${c.severity.toUpperCase()}]** ${sanitize(f.title)} — \`${sanitize(f.file)}:${f.line}\` · ${ag}${byLabel}${area}\n` +
        `  ${sanitize(f.rationale)}\n  _Fix:_ ${sanitize(f.suggestion)}`;
}
function bySeverity(clusters) {
    return [...clusters].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.key.localeCompare(b.key));
}
// A cluster is deterministic when a TOOL (a scanner) produced any of its findings — a fact, not an
// opinion. Dismissing one is surfaced loudly and separately so the override is auditable.
const isDeterministic = (c) => c.representative.source === "tool" || c.members.some((m) => m.finding.source === "tool");
// Model agreement is a model-only signal. A tool-detected cluster with no model corroboration shows
// "tool" (not "0/N models", which would imply models looked and disagreed); a mixed one adds "+ tool".
function agreementLabel(c) {
    const tool = isDeterministic(c);
    if (c.agreement.count === 0 && tool)
        return "tool";
    const base = `${c.agreement.count}/${c.agreement.total} models`;
    return tool ? `${base} + tool` : base;
}
const dismissedLine = (x, label) => `- **[${x.cluster.severity.toUpperCase()}]** ${sanitize(x.cluster.representative.title)} — ` +
    `\`${sanitize(x.cluster.representative.file)}:${x.cluster.representative.line}\`\n  _${label}:_ ${sanitize(x.justification)}`;
export function renderReport(clusters, dismissed, rejectedOverrides = []) {
    const lines = bySeverity(clusters).map(line);
    const fmt = (x) => `- [${x.cluster.severity}] ${sanitize(x.cluster.representative.title)} — ${sanitize(x.justification)}`;
    const section = (title, items) => (items.length ? `\n## ${title}\n${items.map(fmt).join("\n")}` : "");
    return [`# Review (${clusters.length} clusters)`, ...lines,
        section("Deterministic overrides NOT honored (still blocking)", rejectedOverrides),
        section("Dismissed", dismissed)].filter(Boolean).join("\n");
}
// Provenance line: the distinct passes that ran (holistic first, then lenses sorted) across the
// distinct model roster. Built from the orchestrator-supplied roster — a clean vote never reaches a
// cluster, so this is the only place a reviewer that found nothing is still credited. All sanitized.
function reviewedBy(meta) {
    const passes = [...new Set(meta.reviewers.map((r) => r.reviewer))]
        .sort((a, b) => (a === "holistic" ? -1 : b === "holistic" ? 1 : a.localeCompare(b)))
        .map(sanitize);
    const models = [...new Set(meta.reviewers.map((r) => r.model))].map(sanitize);
    return `_Reviewed by:_ ${passes.join(" + ")} · models: ${models.join(", ")}`;
}
// Coverage line: the passes PLANNED but with no usable vote this round (a backend/auth failure, an
// unparseable non-vote, or a lens fired without its input — e.g. lens-spec with no spec). Built from
// orchestrator-supplied `meta.missing`; display only, never alters the verdict — so a thinned panel is
// LOUD in the deterministic comment, not left to the orchestrator's prose. Sanitized (a reason can
// carry a model's stderr).
function coverageLine(meta) {
    const miss = meta.missing ?? [];
    const voted = meta.reviewers.length;
    const total = voted + miss.length;
    const lost = miss.map((m) => `${sanitize(m.reviewer)}/${sanitize(m.model)}${m.reason ? ` (${sanitize(m.reason)})` : ""}`).join("; ");
    return `⚠️ **Coverage:** ${voted}/${total} planned reviewer passes voted — lost: ${lost}`;
}
// Scan-tier degradation: a deterministic scanner RAN but skipped a sub-scan (its tool absent — e.g.
// gitleaks → no secret scan) or otherwise warned. The scan still voted, so it is NOT in meta.missing,
// but a degraded FACT tier must be as loud as a lost reviewer — else a skipped secret scan reads as
// "clean" and the signing orchestrator writes "no secrets" (Episode 5 #2). Display only; never alters
// the verdict (graceful degradation, surfaced not silenced). Sanitized — a warning carries tool stderr.
function scanDegradedLine(meta) {
    return `🔍 **Scan tier degraded:** ${(meta.scanWarnings ?? []).map(sanitize).join("; ")}`;
}
function progressSince(previous, current, blocking) {
    const curKeys = new Set(current.map((c) => c.key));
    const blockingKeys = new Set(blocking.map((c) => c.key));
    const prevKeys = new Set(previous.map((c) => c.key));
    return {
        resolved: previous.filter((c) => !curKeys.has(c.key)), // genuinely gone at HEAD
        stillBlocking: previous.filter((c) => blockingKeys.has(c.key)), // still ACTUALLY blocking (not de-escalated)
        // new/regressed = current GATING clusters not in the prior *blocking* set — conservative: a re-escalated/previously-dismissed finding surfaces as churn rather than being hidden. Intentional; do not "fix" to compare against all prior clusters.
        newOrRegressed: current.filter((c) => GATING.has(c.severity) && !prevKeys.has(c.key)),
    };
}
function renderProgress(p, round) {
    const since = round && round > 1 ? `Round ${round - 1}` : "the previous round";
    const names = (cs) => cs.map((c) => sanitize(c.representative.title)).join("; ");
    const resolvedSuffix = p.resolved.length ? `: ${names(p.resolved)} — not present in this round's findings` : "";
    return [
        `\n### Progress since ${since}`,
        `✅ Resolved (${p.resolved.length})${resolvedSuffix}`,
        `⏳ Still blocking (${p.stillBlocking.length})${p.stillBlocking.length ? `: ${names(p.stillBlocking)}` : ""}`,
        `🆕 New / regressed (${p.newOrRegressed.length})${p.newOrRegressed.length ? `: ${names(p.newOrRegressed)}` : ""}`,
    ].join("\n");
}
export function renderComment(verdict, clusters, blocking, dismissed, rejectedOverrides = [], meta, previous) {
    const counts = {};
    for (const c of clusters)
        counts[c.severity] = (counts[c.severity] ?? 0) + 1;
    const tally = ["critical", "high", "medium", "low", "info"].map((s) => `${counts[s] ?? 0} ${s}`).join(" · ");
    const head = verdict === "block"
        ? `🚫 **BLOCK** — ${blocking.length} blocking finding(s) must be resolved or justified.`
        : `✅ **PASS** — no blocking findings.`;
    const heading = meta?.round ? `## Review Gate — Round ${meta.round}` : "## Review Gate";
    const parts = [heading, head, `\nFindings: ${clusters.length} total — ${tally}.`];
    if (meta)
        parts.push(reviewedBy(meta));
    if (meta?.missing?.length)
        parts.push(coverageLine(meta));
    if (meta?.scanWarnings?.length)
        parts.push(scanDegradedLine(meta));
    if (previous)
        parts.push(renderProgress(progressSince(previous, clusters, blocking), meta?.round));
    const blk = bySeverity(blocking);
    if (blk.length)
        parts.push("\n### Must fix\n" + blk.map(line).join("\n"));
    const advisory = bySeverity(clusters.filter((c) => !GATING.has(c.severity)));
    if (advisory.length)
        parts.push("\n### Advisory (non-blocking)\n" + advisory.map(line).join("\n"));
    if (rejectedOverrides.length) {
        parts.push(`\n### ⚠️ Deterministic findings — override NOT honored (${rejectedOverrides.length})\n` +
            "Exact tool detections; the spine does not let an adjudication clear a fact. Resolve each in code, or tune the scanner so it stops firing — they remain blocking.\n" +
            rejectedOverrides.map((x) => dismissedLine(x, "Attempted")).join("\n"));
    }
    if (dismissed.length) {
        parts.push("\n### Dismissed (with justification)\n" + dismissed.map((x) => dismissedLine(x, "Dismissed")).join("\n"));
    }
    // No orchestrator sign-off here: the orchestrator's approval is posted as a SEPARATE, free-form
    // review comment (see the review-gate skill). This comment stays the deterministic gate output —
    // verdict + provenance + findings — so nothing agent-authored can be mistaken for a computed value.
    return parts.join("\n");
}
