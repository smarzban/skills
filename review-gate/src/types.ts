// The data model for the gate. Deliberately small: a reviewer produces Findings; the spine
// clusters them, computes cross-model agreement, takes the agent's adjudication of contested
// clusters, and emits a deterministic verdict + one PR comment.

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Confidence = "high" | "med" | "low";

/** Where a finding came from. `model` = an untrusted LLM reviewer's opinion (the default).
 *  `tool` = a deterministic scanner's exact match — a fact, not a judgment. A model gating finding is
 *  dismissible with a justification; a `tool` gating finding is NOT — the spine refuses to honor its
 *  dismissal and keeps it blocking, so a prompt-injected/steered agent can't clear a committed secret
 *  with one string. To clear a tool finding, fix the code or tune the scanner. (see decide.ts) */
export type FindingSource = "model" | "tool";

/** A single issue from one reviewer (a model) or scanner (a tool). `area` is the concern label
 *  (security, privacy, …) the source self-tags; it's advisory only and never used for the gate
 *  decision. `source` defaults to a model finding when absent. */
export interface Finding {
  title: string;
  severity: Severity;
  file: string;
  line: number;
  area?: string;
  rationale: string;
  suggestion: string;
  confidence?: Confidence;
  source?: FindingSource;
}

/** One model's full review (a holistic pass or a targeted lens). `reviewer` is the prompt id
 *  used ("holistic", "lens:test-coverage", …); `model` is the actual model that ran. */
export interface ReviewerOutput {
  reviewer: string;
  model: string;
  findings: Finding[];
}

/** Findings from different MODELS that land on the same file + nearby lines are clustered.
 *  `agreement.count` = distinct models that flagged it; `total` = models whose review we have.
 *  A cluster is `contested` when models disagree (count < total) OR only one model saw it on a
 *  gating-severity issue — those require the agent to adjudicate. Each member carries its `reviewer`
 *  (the prompt role: holistic, lens-simplify, …) AND its `model`, so one model run in several roles is
 *  attributable — agreement still counts distinct MODELS (a model in N roles is ONE vote), but the
 *  comment can show which roles raised it. */
export interface FindingCluster {
  key: string;                 // file::line::slug
  representative: Finding;      // highest-severity member, for display
  members: { reviewer: string; model: string; finding: Finding }[];
  agreement: { count: number; total: number };
  severity: Severity;          // max severity across members
  contested: boolean;
}

export type AdjudicationDecision = "confirmed" | "dismissed";

/** The agent's call on a contested cluster. Dismissing a GATING finding (critical/high/medium)
 *  REQUIRES a non-empty justification — the spine treats an unjustified dismissal as still
 *  blocking (no silent dismissal). This is the one place model judgment enters the verdict. */
export interface Adjudication {
  key: string;
  decision: AdjudicationDecision;
  justification?: string;
}

/** Run provenance supplied by the TRUSTED orchestrator (never a reviewer): every reviewer/lens pass
 *  that ran — including clean votes, which never reach a cluster — for the gate comment's "Reviewed by"
 *  line. Provenance only; it never alters the verdict. The orchestrator's approval/sign-off is NOT here
 *  — it is a separate, free-form orchestrator review comment the review-gate skill requires (kept out
 *  of the deterministic spine so it can be rich markdown and is never mistaken for a gate-computed
 *  value). */
export interface RunMeta {
  reviewers: { reviewer: string; model: string }[];
  /** Reviewer/lens passes that were PLANNED but produced no usable vote this round — a backend/auth
   *  failure, an unparseable non-vote, or a lens fired without its required input (e.g. `lens-spec`
   *  with no spec). The spine renders a loud `Coverage` line from this so a thinned panel can't pass
   *  silently. Provenance/display only — like `reviewers`, it never enters the verdict. */
  missing?: { reviewer: string; model: string; reason?: string }[];
  /** 1-based round number for the multi-round loop. When set, the gate comment heading reads
   *  "Review Gate — Round N"; the Progress section (when `previous` is supplied to decide) compares
   *  against round N−1. Provenance/display only — like `reviewers`, it never enters the verdict. */
  round?: number;
  /** Scan-tier (deterministic) warnings: a scanner that RAN but degraded — a sub-scan skipped because
   *  its tool isn't installed (e.g. gitleaks absent → no secret scan), or any scanner warning. The scan
   *  still votes (its other findings count, so it is NOT in `missing`), but a degraded fact-tier must be
   *  as VISIBLE as a lost reviewer pass — else a skipped secret scan reads as "clean" (Episode 5 #2).
   *  Display only — like the rest of meta, it never alters the verdict: graceful degradation, surfaced
   *  not silenced. */
  scanWarnings?: string[];
}

export type Verdict = "pass" | "block";

export interface Decision {
  verdict: Verdict;
  blocking: FindingCluster[];
  dismissed: { cluster: FindingCluster; justification: string }[];
  report: string;     // human-readable, severity-sorted
  prComment: string;  // the single consolidated PR comment
}

/** Severity rank: higher = worse. Gating = critical/high/medium. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
};
export const GATING: ReadonlySet<Severity> = new Set<Severity>(["critical", "high", "medium"]);
