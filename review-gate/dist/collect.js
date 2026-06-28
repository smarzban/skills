const isReviewerOutput = (o) => !!o && typeof o === "object" &&
    typeof o.reviewer === "string" &&
    typeof o.model === "string" &&
    Array.isArray(o.findings);
// The deterministic (scan) output joins `outputs` (consolidate needs it) but is NOT a model reviewer
// pass, so it's kept OUT of the `reviewers` roster + the Coverage denominator — the scan is always-on
// and can't be "lost". Kept IDENTICAL to consolidate's isToolOutput so the two classifiers can't
// diverge: the same rule excludes the scan from the roster HERE and from the agreement denominator
// THERE, and (Episode 5 #2) routes a degraded scan's warning to scanWarnings. The 3rd clause
// future-proofs a tool producer that omits the identity fields; today only scan.ts emits tool findings
// and it always matches clause 1.
const isTool = (o) => o.reviewer === "tools" || o.model === "deterministic" ||
    (o.findings.length > 0 && o.findings.every((f) => f.source === "tool"));
/** Gather saved run/scan envelopes into {outputs, meta}. Voters (incl. the scan) → outputs; null votes →
 *  meta.missing (reason = the envelope's warning); `opts.missing` adds passes that produced NO file at all
 *  (a backend planned then skipped, a lens with no input) — collect can't see those. Throws LOUD on a
 *  malformed file or a non-vote with no provenance: a silently-dropped file is exactly the panel-thinning
 *  this verb exists to prevent. */
export function collect(files, opts = {}) {
    const outputs = [];
    const missing = [];
    const scanWarnings = [];
    for (const { name, json } of files) {
        if (!json || typeof json !== "object" || Array.isArray(json))
            throw new Error(`collect: ${name} is not a run/scan envelope object`);
        if (isReviewerOutput(json.output)) {
            outputs.push(json.output); // a vote — a model reviewer OR the scan
            // A scan that VOTED but carried a warning ran DEGRADED (a sub-scanner skipped — e.g. gitleaks
            // absent → no secret scan). Its other findings still count, but a degraded fact-tier must reach
            // the verdict, not vanish into a dropped warning and read as "clean" (Episode 5 #2). Scoped to the
            // scan: a model vote never carries a warning (runner returns one only on a non-vote).
            if (isTool(json.output) && typeof json.warning === "string" && json.warning.trim())
                scanWarnings.push(json.warning.trim());
        }
        else if (json.output === null || json.output === undefined) {
            // a non-vote: attribute the lost coverage from the envelope's top-level provenance + warning. We
            // require `backend` AND `model` so the missing entry's model is ALWAYS `backend:model` — exactly
            // how the same pass's VOTE would name it (runner.ts) — otherwise the Coverage line and any
            // round-over-round key-match would diverge for a backend-less envelope. `run` always emits all three.
            const { reviewer, backend, model } = json;
            if (typeof reviewer !== "string" || !reviewer.trim() ||
                typeof backend !== "string" || !backend.trim() ||
                typeof model !== "string" || !model.trim())
                throw new Error(`collect: ${name} is a non-vote but carries no reviewer/backend/model to attribute the lost coverage to`);
            missing.push({ reviewer, model: `${backend}:${model}`, ...(json.warning ? { reason: json.warning } : {}) });
        }
        else {
            throw new Error(`collect: ${name} has a malformed "output" (neither a reviewer output nor null)`);
        }
    }
    if (opts.missing)
        missing.push(...opts.missing);
    const reviewers = outputs.filter((o) => !isTool(o)).map((o) => ({ reviewer: o.reviewer, model: o.model }));
    // A roster with zero MODEL passes is not a review — decide rejects it anyway (meta.reviewers must be
    // non-empty), so fail HERE, at the gatherer, with a clear cause instead of a confusing error two steps
    // later. (All model passes failed, or only a scan was collected.)
    if (reviewers.length === 0)
        throw new Error("collect: no model reviewer votes — a review needs at least one model pass (did every pass fail, or was only a scan collected?)");
    const meta = {
        reviewers,
        ...(missing.length ? { missing } : {}),
        ...(scanWarnings.length ? { scanWarnings } : {}),
        ...(opts.round ? { round: opts.round } : {}),
    };
    return { outputs, meta };
}
