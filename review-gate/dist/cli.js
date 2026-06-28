#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runReview } from "./runner.js";
import { runScan, ALL_SCANNERS } from "./scan.js";
import { consolidate } from "./consolidate.js";
import { decide } from "./decide.js";
import { collect } from "./collect.js";
import { assemblePrompt } from "./prompts.js";
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
// Accept a small INLINE JSON literal (e.g. `[]`) as well as a file path for the optional, often-empty
// args (adjudications / previous), so a caller with none isn't forced to write an empty file just to
// pass `[]` — which otherwise hit `ENOENT: open '[]'`. A value starting with `[` or `{` is parsed
// inline; anything else is read from disk, and an EMPTY file (or `/dev/null`) reads as `[]` — "no
// adjudications" shouldn't require hand-writing a real `[]` file (Episode 4). Empty = [] is fail-safe:
// no dismissals means nothing is cleared, so the gate only ever blocks MORE, never less.
const readJsonArg = (arg) => {
    const t = arg.trim();
    if (t.startsWith("[") || t.startsWith("{"))
        return JSON.parse(t);
    const raw = readFileSync(arg, "utf8").trim();
    return raw === "" ? [] : JSON.parse(raw);
};
// Split argv into ordered positionals + named flags. Supports `--flag value` and repeatable flags
// (`--missing a --missing b` → {missing:["a","b"]}); a flag with no value is `""`. Lets `decide`/`collect`
// take robust named args (e.g. --prev) instead of brittle, easy-to-misorder positionals.
const parseArgs = (argv) => {
    const positionals = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const next = argv[i + 1];
            const val = next !== undefined && !next.startsWith("--") ? (i++, next) : "";
            (flags[a.slice(2)] ??= []).push(val);
        }
        else
            positionals.push(a);
    }
    return { positionals, flags };
};
// A `--missing` value for a pass that produced NO file (a backend planned then skipped, a lens with no
// input) — collect can't see those, so the orchestrator names them. Pipe-delimited `reviewer|model|reason`,
// NOT colon-delimited, because a model string carries colons (e.g. `ollama:kimi-k2.7-code:cloud`).
const parseMissing = (s) => {
    const [reviewer, model, ...rest] = s.split("|");
    if (!reviewer?.trim() || !model?.trim())
        throw new Error(`collect: --missing must be 'reviewer|model|reason' (got ${JSON.stringify(s)})`);
    const reason = rest.join("|").trim();
    return { reviewer: reviewer.trim(), model: model.trim(), ...(reason ? { reason } : {}) };
};
const print = (o) => process.stdout.write(JSON.stringify(o, null, 2) + "\n");
// prompts/ ships beside this binary — resolve relative to THIS file, not the cwd, so the CLI serves
// its bundled prompts from wherever the plugin is installed. (src/cli.ts in dev and dist/cli.js in a
// build are both one level under the package root, so `..` lands on it either way.)
const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");
async function main() {
    const [cmd, ...args] = process.argv.slice(2);
    switch (cmd) {
        case "run": {
            // run <reviewer> <backend> <model> <repoDir> <promptFile>
            // backend = ollama | claude | codex. Runs ONE reviewer in <repoDir> (the checked-out PR
            // branch) — the model explores the repo itself. The orchestrator calls this once per
            // (reviewer × model) and collects the printed outputs. Untrusted: a model call.
            const [reviewer, backend, model, repoDir, promptFile] = args;
            const prompt = readFileSync(promptFile, "utf8");
            const { output, warning, rawTail } = await runReview(reviewer, backend, model, repoDir, prompt);
            // rawTail is present ONLY on a non-vote (Episode 5 #1) — kept in the saved envelope so a lost vote
            // is diagnosable post-hoc (pure prose vs a buried array) without a non-reproducing re-run.
            print({ reviewer, backend, model, output, warning: warning ?? null, ...(rawTail ? { rawTail } : {}) });
            break;
        }
        case "scan": {
            // scan <repoDir> <baseRef>   — the deterministic tier (no LLM). Runs `git diff <baseRef>...HEAD`
            // and the scanners; emits a ReviewerOutput {reviewer:"tools", model:"deterministic"} that the
            // orchestrator merges into the same outputs pool as the model reviewers. Trusted, exact, cheap.
            const [repoDir, baseRef] = args;
            const { output, warning } = await runScan(repoDir, baseRef, { scanners: ALL_SCANNERS });
            print({ output, warning: warning ?? null });
            break;
        }
        case "prompt": {
            // prompt <name>   — print the named reviewer/audit prompt + its output contract to stdout, so a
            // skill can build a prompt file with no path to the plugin: `review-gate prompt holistic > f`.
            // The per-invocation scope line ("review THIS PR …") is appended by the caller, not here.
            const [name] = args;
            if (!name) {
                process.stderr.write("usage: review-gate prompt <name>\n");
                process.exit(2);
            }
            process.stdout.write(assemblePrompt(name, (b) => readFileSync(join(PROMPTS_DIR, `${b}.md`), "utf8")));
            break;
        }
        case "consolidate": {
            // consolidate <outputs.json>   — outputs.json = array of ReviewerOutput
            print(consolidate(readJson(args[0])));
            break;
        }
        case "collect": {
            // collect <dir> [--round N] [--scan <f> ...] [--missing 'reviewer|model|reason' ...]  — gather the
            // per-pass `out-*.json` envelopes in <dir> (plus any --scan output) into outputs.json (→ consolidate)
            // + meta.json (→ decide). Reads reviewer/model from file CONTENTS (filenames vary across rounds),
            // folds the scan into outputs, derives meta.missing from null-vote files. Removes the fiddliest,
            // most mistake-prone manual step; a deterministic meta.missing means a thinned panel can't slip past.
            const { positionals, flags } = parseArgs(args);
            const dir = positionals[0];
            if (!dir) {
                process.stderr.write("usage: review-gate collect <dir> [--round N] [--scan <f>] [--missing 'reviewer|model|reason']\n");
                process.exit(2);
            }
            const names = readdirSync(dir, { withFileTypes: true })
                .filter((d) => d.isFile() && /^out-.*\.json$/.test(d.name)) // regular files only — a dir named out-x.json isn't a pass
                .map((d) => join(dir, d.name)).sort();
            for (const s of flags.scan ?? [])
                if (s)
                    names.push(s); // explicit scan file(s), if stored elsewhere
            const seen = new Set();
            const files = names
                .filter((p) => !seen.has(p) && (seen.add(p), true)) // dedup (a scan globbed AND passed via --scan)
                .map((p) => {
                try {
                    return { name: p, json: JSON.parse(readFileSync(p, "utf8")) };
                }
                catch (e) {
                    throw new Error(`collect: cannot parse ${p}: ${e instanceof Error ? e.message : String(e)}`);
                }
            });
            // Validate --round at the gatherer (decide requires a positive integer): a bad value would
            // otherwise be silently dropped (NaN/0 are falsy) or fail confusingly two steps later in decide.
            let round;
            if (flags.round?.[0] !== undefined && flags.round[0] !== "") {
                round = Number(flags.round[0]);
                if (!Number.isInteger(round) || round <= 0) {
                    process.stderr.write(`collect: --round must be a positive integer (got ${JSON.stringify(flags.round[0])})\n`);
                    process.exit(2);
                }
            }
            const missing = (flags.missing ?? []).filter(Boolean).map(parseMissing);
            const { outputs, meta } = collect(files, { round, missing });
            const outputsPath = join(dir, "outputs.json");
            const metaPath = join(dir, "meta.json");
            writeFileSync(outputsPath, JSON.stringify(outputs, null, 2) + "\n");
            writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
            print({ outputs: outputsPath, meta: metaPath, voted: meta.reviewers.length, missing: meta.missing?.length ?? 0 });
            break;
        }
        case "decide": {
            // decide <clusters.json> <adjudications.json> <meta.json> [previous.json | --prev <f>]  — the
            // deterministic verdict + the gate findings comment. meta.json = {reviewers:[{reviewer,model}], round?}.
            // The PRIOR round's `blocking` array (optional) adds the "Progress since Round N−1" section; pass
            // it as `--prev <f>` (preferred — the bare 4th positional is easy to misorder against meta) or as
            // the 4th positional. adjudications may be inline `[]`, a file, or an empty file (= no dismissals).
            // The first three are required so every comment names the reviewers that ran.
            const { positionals, flags } = parseArgs(args);
            const [clustersF, adjF, metaF, prevPos] = positionals;
            if (!clustersF || !adjF || !metaF) {
                process.stderr.write("usage: review-gate decide <clusters.json> <adjudications.json> <meta.json> [previous.json | --prev <f>]\n");
                process.exit(2);
            }
            const prevArg = flags.prev?.[0] || prevPos; // --prev wins; falls back to the positional [previous]
            const previous = prevArg ? readJsonArg(prevArg) : undefined;
            print(decide(readJson(clustersF), readJsonArg(adjF), readJson(metaF), previous));
            break;
        }
        default:
            process.stderr.write("usage: review-gate <prompt|run|scan|collect|consolidate|decide> ...\n");
            process.exit(2);
    }
}
main().catch((e) => { process.stderr.write(String(e instanceof Error ? e.stack : e) + "\n"); process.exit(1); });
