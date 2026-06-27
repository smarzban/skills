const isReviewerOutput = (o) => !!o && typeof o === "object" &&
    typeof o.reviewer === "string" &&
    typeof o.model === "string" &&
    Array.isArray(o.findings);
// The deterministic (scan) output joins `outputs` (consolidate needs it) but is NOT a model reviewer
// pass, so it's kept OUT of the `reviewers` roster + the Coverage denominator — the scan is always-on
// and can't be "lost". (Mirrors consolidate's own isToolOutput.)
const isTool = (o) => o.reviewer === "tools" || o.model === "deterministic";
/** Gather saved run/scan envelopes into {outputs, meta}. Voters (incl. the scan) → outputs; null votes →
 *  meta.missing (reason = the envelope's warning); `opts.missing` adds passes that produced NO file at all
 *  (a backend planned then skipped, a lens with no input) — collect can't see those. Throws LOUD on a
 *  malformed file or a non-vote with no provenance: a silently-dropped file is exactly the panel-thinning
 *  this verb exists to prevent. */
export function collect(files, opts = {}) {
    const outputs = [];
    const missing = [];
    for (const { name, json } of files) {
        if (!json || typeof json !== "object" || Array.isArray(json))
            throw new Error(`collect: ${name} is not a run/scan envelope object`);
        if (isReviewerOutput(json.output)) {
            outputs.push(json.output); // a vote — a model reviewer OR the scan
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
        ...(opts.round ? { round: opts.round } : {}),
    };
    return { outputs, meta };
}
