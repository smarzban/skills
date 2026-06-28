import { resolve } from "node:path";
import { envNum, errorTail, spawnBounded } from "./proc.js";
export const LAUNCHER = process.env.REVIEW_GATE_LAUNCHER ?? "ollama";
export const CLAUDE_BIN = process.env.REVIEW_GATE_CLAUDE ?? "claude";
export const CODEX_BIN = process.env.REVIEW_GATE_CODEX ?? "codex";
// Hard cap on the Claude-harness agent loop (ollama/claude backends). A model that doesn't converge
// would otherwise spin the loop — exploring, retrying, never finalizing — and on Ollama Cloud's
// GPU-TIME billing that is a runaway cost (the PR #4 dogfood: ~245 requests, one 38-min hang). The
// cap makes a non-converging run exit (with an error) instead of spinning. This is the SECONDARY guard
// — the 600s wall-clock (TIMEOUT_MS) + the byte cap are the real runaway backstops. Raised 25 -> 50 in
// Episode 3: kimi/glm on holistic/lens legitimately need >25 turns to converge, so 25 was recording
// real reviews as non-votes. Still bounded; tune via REVIEW_GATE_MAX_TURNS.
const MAX_TURNS = envNum(process.env.REVIEW_GATE_MAX_TURNS, 50);
// Read-only tool surface for the Claude-harness backends: inspect, never mutate; git read-only.
export const DEFAULT_ALLOWED_TOOLS = [
    "Read", "Grep", "Glob",
    "Bash(git diff:*)", "Bash(git show:*)", "Bash(git log:*)", "Bash(git status:*)", "Bash(git ls-files:*)",
].join(",");
export function buildCommand(backend, model, prompt, repoDir, allowedTools = DEFAULT_ALLOWED_TOOLS) {
    switch (backend) {
        case "ollama": // `--` separates ollama-launch's flags from the args passed to claude
            return { bin: LAUNCHER, args: ["launch", "claude", "--model", model, "--",
                    "-p", prompt, "--output-format", "json", "--allowedTools", allowedTools, "--max-turns", String(MAX_TURNS)] };
        case "claude":
            return { bin: CLAUDE_BIN, args: ["--model", model,
                    "-p", prompt, "--output-format", "json", "--allowedTools", allowedTools, "--max-turns", String(MAX_TURNS)] };
        case "codex": // high reasoning effort; read-only sandbox; prompt as arg (no stdin). `-C` is made
            // ABSOLUTE — a RELATIVE worktree path resolved against a cwd that was already the worktree, so
            // codex got a doubled path (the 2 codex failures in the Episode-3 dogfood). resolve() is a no-op
            // on an already-absolute path.
            return { bin: CODEX_BIN, args: ["exec", "-C", resolve(repoDir), "-m", model,
                    "-c", 'model_reasoning_effort="high"', "-c", 'sandbox_mode="read-only"', prompt] };
    }
}
const TIMEOUT_MS = envNum(process.env.REVIEW_GATE_TIMEOUT_MS, 600_000); // agent loop; envNum so a bad override can't fire the kill timers immediately
const stripCodeFence = (text) => text.trim().replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```$/, "").trim();
// Matches a ```json … ``` (or bare ``` … ```) fenced block; capture group 1 is the inner content.
// Lazy so matchAll yields each block separately and `g` so we can scan all of them.
const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/g;
/** A findings array out of a parsed JSON value: a bare array, or a `{findings:[…]}` wrapper. */
function asFindingsArray(parsed) {
    if (Array.isArray(parsed))
        return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.findings)) {
        return parsed.findings;
    }
    return null;
}
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
/** Validate raw rows into Findings, DROPPING any that lack the required shape (object with a known
 *  severity + string title + string file). `source` is ALWAYS forced to "model" — a model-supplied
 *  `source` is ignored so it can't forge a non-dismissible "tool" fact. A non-findings array (a list of
 *  strings/numbers, or all-malformed rows) yields []. */
function validateRows(arr) {
    const out = [];
    for (const f of arr) {
        if (!f || typeof f !== "object")
            continue;
        const r = f;
        const sev = String(r.severity ?? "").toLowerCase();
        if (!SEVERITIES.includes(sev))
            continue;
        if (typeof r.title !== "string" || typeof r.file !== "string")
            continue;
        out.push({
            title: r.title, severity: sev, file: r.file,
            line: Number.isFinite(Number(r.line)) ? Number(r.line) : 0,
            area: typeof r.area === "string" ? r.area : undefined,
            rationale: typeof r.rationale === "string" ? r.rationale : "",
            suggestion: typeof r.suggestion === "string" ? r.suggestion : "",
            confidence: ["high", "med", "low"].includes(String(r.confidence)) ? r.confidence : undefined,
            source: "model",
        });
    }
    return out;
}
/** Parse a findings array out of a model's text. Accepts a bare array, a `{findings:[…]}` wrapper, a
 *  ```json fence, or an array salvaged from prose. Drops malformed rows. Returns null when nothing
 *  authoritative or non-empty can be recovered — a surfaced non-vote, never a forged clean pass. */
export function parseFindings(text) {
    const t = stripCodeFence(text);
    // 1. Whole-message parse is AUTHORITATIVE — the model emitted exactly the array it was asked for.
    //    A GENUINELY empty array (zero elements) is a real "no findings" clean vote. But an array WITH
    //    elements that all fail validation ("["a.ts"]", "{findings:[{severity-only}]}") is garbage, not
    //    "no findings" — it must NOT be miscounted as a clean [] vote, so it falls through to a non-vote.
    //    (lens-security/codex: a non-findings array was being recorded as a clean reviewer vote.)
    try {
        const a = asFindingsArray(JSON.parse(t));
        if (a) {
            const rows = validateRows(a);
            if (a.length === 0 || rows.length > 0)
                return rows;
        }
    }
    catch { /* prose around the JSON — fall through to salvage */ }
    // 2. Salvage from a prose-wrapped reply — the opus/glm failure mode: a reasoning-heavy model narrates,
    //    then emits the findings in a ```json fence (preferred over the brittle first-`[`…last-`]` slice,
    //    which over-grabs when the prose carries its own brackets — [area] tags, array[i], [link]). A
    //    reply may carry SEVERAL fenced arrays (an example, a "changed files" list, a per-section split,
    //    a decoy). Take the UNION of valid findings across ALL fences — never pick one and drop the rest.
    //    Picking a single fence is gameable in BOTH directions (first-wins → an example/empty masks the
    //    answer; last-wins → a trailing decoy masks a real critical — the lens-security finding). Union
    //    closes the class: a real finding in ANY fence survives, and a forged/example finding only
    //    OVER-surfaces (orchestrator adjudicates it against the code → fails safe toward blocking, never
    //    toward a silent pass). Scan the ORIGINAL text — stripCodeFence may have eaten a leading marker.
    const union = [];
    for (const m of text.matchAll(FENCE_RE)) {
        let a;
        try {
            a = asFindingsArray(JSON.parse(m[1].trim()));
        }
        catch {
            continue;
        }
        if (a)
            union.push(...validateRows(a));
    }
    if (union.length > 0)
        return union;
    // 3. Last resort: a single array sliced out of prose (first-`[` … last-`]`). Below the fenced path
    //    because it over-grabs; recovers an un-fenced array only when it validates to ≥1 finding.
    const i = t.indexOf("["), j = t.lastIndexOf("]");
    if (i >= 0 && j > i) {
        try {
            const a = asFindingsArray(JSON.parse(t.slice(i, j + 1)));
            if (a) {
                const rows = validateRows(a);
                if (rows.length > 0)
                    return rows;
            }
        }
        catch { /* not a clean array */ }
    }
    // 4. Nothing authoritative or non-empty recovered. A carved-out empty [] is ambiguous — NEVER an
    //    authoritative clean pass; the caller's strict isAffirmativelyEmpty handles a real whole-message
    //    "no issues", and a pure-prose reply stays a surfaced non-vote.
    return null;
}
// A reviewer that found nothing should emit `[]` — but a model sometimes completes successfully and
// says so in PROSE ("No issues found."). parseFindings sees no array there and returns null, which
// would wrongly count a CLEAN reviewer as a failed one (inflating the thin-panel signal). This
// recognizes ONLY an unambiguous, whole-message "no issues" declaration as an empty result. It is
// deliberately fail-SAFE: extra substance, a location/object reference, or a hedge ("…but…") all
// fail to match, so a finding the model neglected to format is NEVER silently swallowed — it stays a
// non-vote (a surfaced failure), not a forged clean pass.
// A reviewer that found nothing should emit `[]`. Some still answer in PROSE ("No issues found."),
// which parseFindings can't see — so a CLEAN reviewer gets miscounted as a failed one. We recognize an
// empty result with an EXACT whitelist of whole-message declarations, NOT a fuzzy regex: a regex over
// untrusted model output proved adversarially leaky (a scoped "no critical issues", a non-ASCII finding
// after "no issues", a comma-joined hedge, a buried `[]` all slipped through). Exact-match can't be
// gamed — anything carrying extra substance simply isn't in the set, so it stays a surfaced non-vote.
// BLANKET phrases only — a clean reviewer speaks to the WHOLE change. Dimension-scoped declarations
// ("no vulnerabilities", "no errors") are intentionally NOT here: "no vulnerabilities found" says
// nothing about correctness/perf/etc., so counting it as a full clean vote would overstate coverage.
const EMPTY_PHRASES = new Set([
    "[]",
    "no issues", "no issues found", "no issue found", "no issues identified",
    "no findings", "no finding", "no findings found", "no findings identified",
    "no problems", "no problem found", "no problems found",
    "no bugs", "no bug found", "no bugs found",
    "nothing to report", "nothing found", "nothing of note",
    "looks good", "looks good to me", "lgtm", "all good", "all clear",
    "none", "none found", "none identified",
]);
export function isAffirmativelyEmpty(text) {
    const t = stripCodeFence(text).toLowerCase();
    if (!t || t.length > 200)
        return false; // blank (suspect) or too much to be a clean "nothing"
    const core = t
        .replace(/^(i\s+(found|see|identified|noticed)\s+)/, "") // drop a leading "I found "
        .replace(/[.!?,;:\s]+$/, "") // trailing punctuation / whitespace
        .replace(/\s+in\s+(this|the)\s+(change|changes|pr|diff|code|patch|codebase)$/, "") // drop a trailing scope phrase
        .replace(/[.!?,;:\s]+$/, "")
        .trim();
    return EMPTY_PHRASES.has(core);
}
/** Claude Code `--output-format json` → one envelope object; `result` is the final assistant text.
 *  `subtype` (e.g. `error_max_turns`, `error_during_execution`) is surfaced so a non-vote names WHY it
 *  failed instead of an opaque "is_error" — the Coverage line then shows e.g. a max-turns loss. */
export function parseClaudeResult(stdout) {
    let env;
    try {
        env = JSON.parse(stdout);
    }
    catch {
        return { findings: null, isError: true, subtype: "unparseable_envelope", resultText: "" };
    }
    const resultText = typeof env?.result === "string" ? env.result : "";
    const subtype = typeof env?.subtype === "string" ? env.subtype : undefined;
    return { findings: parseFindings(resultText), isError: env?.is_error === true, subtype, resultText };
}
/** codex exec prints an agentic trace plus the final message; the final assistant block is the last
 *  line that is exactly `codex`, up to the trailing `tokens used` footer (or EOF). */
export function parseCodexFinal(stdout) {
    const lines = stdout.split("\n");
    let start = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim() === "codex") {
            start = i + 1;
            break;
        }
    }
    const body = (start >= 0 ? lines.slice(start) : lines);
    const end = body.findIndex((l) => l.trim() === "tokens used");
    return (end >= 0 ? body.slice(0, end) : body).join("\n").trim();
}
const MAX_OUTPUT_BYTES = envNum(process.env.REVIEW_GATE_MAX_OUTPUT_BYTES, 64 * 1024 * 1024); // envNum so NaN can't disable the cap
/** Spawn a command under a HARD wall-clock deadline; resolve its stdout on a clean exit, throw on a
 *  spawn error / non-zero exit / byte-cap / timeout. A thin policy adapter over the shared, hardened
 *  `spawnBounded` (force-settle + process-group kill + stdio teardown live there — so a hung or
 *  orphaned model run can't keep the host alive; the PR #4/#5 fix). byteCap "abort": an over-cap reply
 *  is a hard failure, not silently truncated and parsed. */
export async function spawnWithDeadline(bin, args, opts) {
    const maxBytes = opts.maxBytes ?? MAX_OUTPUT_BYTES;
    const r = await spawnBounded(bin, args, { cwd: opts.cwd, timeoutMs: opts.timeoutMs, maxBytes, graceMs: opts.graceMs, byteCap: "abort", detached: true });
    if (r.byteAbort)
        throw new Error(`output exceeded ${maxBytes} bytes`);
    if (r.timedOut)
        throw new Error(`timed out after ${opts.timeoutMs}ms`);
    if (r.code === 0)
        return r.stdout; // a clean exit wins
    if (r.code === -1)
        throw new Error(errorTail(r.stderr) || "spawn failed"); // spawn error / signalled
    throw new Error(`exited ${r.code}: ${errorTail(r.stderr) || "(no stderr)"}`); // tail, not head — the real error is last
}
const spawnCall = (backend, model, prompt, repoDir, timeoutMs) => {
    const dir = resolve(repoDir); // absolute cwd + codex -C; robust to a relative caller
    const { bin, args } = buildCommand(backend, model, prompt, dir);
    return spawnWithDeadline(bin, args, { cwd: dir, timeoutMs });
};
/** A spawn failure worth ONE retry — a flaky/transient process error (non-zero exit, connection reset,
 *  signal). NOT retryable: a timeout or byte-cap (deliberate guards — a retry just doubles GPU cost or
 *  re-hits the cap) and ENOENT (a missing binary is a config error, not flakiness). */
const isTransientSpawnError = (msg) => !/timed out after|output exceeded|ENOENT/i.test(msg);
/** Episode 5 (#1): a non-vote keeps a bounded TAIL of the model's raw reply so it's diagnosable from
 *  its own saved envelope — was it pure prose (model behavior) or a buried array the salvage missed
 *  (a parser bug)? The TAIL is kept (a findings array lands at the END of a reply) within a small cap so
 *  a runaway reply can't bloat the envelope. Unfiltered, unlike `errorTail` (this is a faithful debug
 *  artifact of what the model said, not a stderr summary). */
const RAW_TAIL_MAX = 800;
const rawTail = (t) => (t.length > RAW_TAIL_MAX ? t.slice(-RAW_TAIL_MAX) : t);
/** Run ONE reviewer on ONE model+backend, in `repoDir` (the model explores the checked-out branch).
 *  Returns null + a warning on any failure so a dead/flaky model never throws the whole gate down — and
 *  that null still surfaces as lost coverage (the decide Coverage line), so a retry never masks a dead
 *  reviewer. A TRANSIENT spawn failure is retried ONCE before it counts as lost; a model that RESPONDED
 *  (harness error / unparseable) is NOT retried — that's model behavior, not flakiness. */
export async function runReview(reviewer, backend, model, repoDir, prompt, opts = {}) {
    const call = opts.call ?? spawnCall;
    const tag = `${reviewer}/${backend}:${model}`;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const stdout = await call(backend, model, prompt, repoDir, opts.timeoutMs ?? TIMEOUT_MS);
            let resultText;
            if (backend === "codex") {
                resultText = parseCodexFinal(stdout);
            }
            else {
                const r = parseClaudeResult(stdout);
                // Name the harness error subtype (e.g. error_max_turns) so the Coverage line says WHY it was
                // lost. Not retried — a determined max-turns repeats with the same cap; the raised cap is the fix.
                if (r.isError)
                    return { output: null, warning: `${tag}: ${r.subtype ?? "harness reported is_error"}`, ...(r.resultText ? { rawTail: rawTail(r.resultText) } : {}) };
                resultText = r.resultText;
            }
            let findings = parseFindings(resultText);
            // A completed run whose ENTIRE reply is an unambiguous "no issues" is a 0-findings vote, not a
            // failure — so a clean reviewer isn't mistaken for a dead one. Anything ambiguous stays null.
            if (findings === null && isAffirmativelyEmpty(resultText))
                findings = [];
            if (findings === null)
                return { output: null, warning: `${tag}: unparseable output`, ...(resultText ? { rawTail: rawTail(resultText) } : {}) };
            return { output: { reviewer, model: `${backend}:${model}`, findings } };
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (attempt === 1 && isTransientSpawnError(msg))
                continue; // retry a flaky spawn ONCE
            return { output: null, warning: `${tag}: ${msg}${attempt > 1 ? " (retried once)" : ""}` };
        }
    }
    return { output: null, warning: `${tag}: exhausted attempts` }; // unreachable; satisfies the type checker
}
