// Human-validation framework for MRV1.0: a review template built from stored evaluations, and agreement metrics computed from human reviews.
// Pure and deterministic. It makes NO accuracy claim: it reports what a set of human reviews shows and whether the sample is too small to claim anything.
// Human category/overall scores are recomputed from the human outcomes with the same deterministic scoring code, never taken from the model.
import { fmtTime } from "../evaluation/transcript.ts";
import { SALES_STAGE_CRITERIA } from "./rubric.ts";
import { categoryScore, computePsychologyScore, computeSalesStageScore } from "./scoring.ts";
import type { ScoredCriterion } from "./scoring.ts";
import type { Mrv1Document } from "./types.ts";

export type OutcomeValue = "0" | "1" | "2" | "3" | "N/A" | "NE";
const OUTCOMES: OutcomeValue[] = ["0", "1", "2", "3", "N/A", "NE"];
const isNum = (o: string) => o === "0" || o === "1" || o === "2" || o === "3";
const cls = (o: string) => (isNum(o) ? "numeric" : o);

/** Minimum sample before any agreement figure may be quoted as evidence of accuracy. Provisional: the project owner must set the real thresholds. */
export const MIN_EVALUATIONS_FOR_CLAIMS = 10;
export const MIN_CRITERIA_FOR_CLAIMS = 300;

export interface HumanCriterionReview {
  evaluation_id: number;
  criterion_id: string;
  human_outcome: OutcomeValue;
  /** null = not assessed */
  evidence_quote_exists: boolean | null;
  timestamp_correct: boolean | null;
  speaker_correct: boolean | null;
  explanation_accurate: boolean | null;
  recommendation_relevant: boolean | null;
  disagreement_reason?: string;
}
export interface HumanFlagReview {
  evaluation_id: number;
  flag_id: string;
  /** a flag the model raised: is it supported by the evidence? */
  supported: boolean;
  /** human view of the severity, if different */
  human_severity?: string;
  /** the model said confirmed_conduct but the human reads it as ambiguous */
  should_be_ambiguous?: boolean;
}
export interface MissedFlag {
  evaluation_id: number;
  flag_id: string;
}

const rate = (n: number, d: number) => (d === 0 ? null : n / d);
const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

export interface ValidationMetrics {
  evaluations_reviewed: number;
  criteria_reviewed: number;
  sufficient_for_claims: boolean;
  caveat: string;
  exact_agreement: number | null;
  within_one_agreement: number | null;
  within_one_pairs: number;
  na_ne_class_agreement: number | null;
  class_confusion: Record<string, Record<string, number>>;
  evidence_traceability_rate: number | null;
  unsupported_evidence_rate: number | null;
  timestamp_accuracy: number | null;
  speaker_accuracy: number | null;
  explanation_accuracy: number | null;
  recommendation_relevance: number | null;
  flag_precision: number | null;
  flag_recall: number | null;
  flags_confirmed_but_ambiguous: number;
  mean_abs_category_diff: number | null;
  mean_abs_sales_stage_diff: number | null;
  mean_abs_psychology_diff: number | null;
  provisional_status_agreement: number | null;
  evaluations_fully_reviewed: number;
  per_criterion: Array<{ criterion_id: string; n: number; exact: number | null }>;
}

/** A stored evaluation document together with its database id (reviews refer to it by that id). */
export type ReviewedDocument = Mrv1Document & { evaluation_id: number };

export function computeValidationMetrics(input: { documents: ReviewedDocument[]; reviews: HumanCriterionReview[]; flagReviews?: HumanFlagReview[]; missedFlags?: MissedFlag[] }): ValidationMetrics {
  const byEval = new Map<number, Map<string, { outcome: string; evidenceVerified: boolean; category_id: string }>>();
  for (const d of input.documents) {
    const id = d.evaluation_id;
    const m = new Map<string, { outcome: string; evidenceVerified: boolean; category_id: string }>();
    for (const c of [...d.sales_stage, ...d.psychology]) m.set(c.criterion_id, { outcome: c.outcome, evidenceVerified: c.evidence.length > 0 && c.evidence.every((e) => e.verified), category_id: c.category_id });
    byEval.set(id, m);
  }
  const reviews = input.reviews.filter((r) => byEval.get(r.evaluation_id)?.has(r.criterion_id));
  for (const r of input.reviews) if (!OUTCOMES.includes(r.human_outcome)) throw new Error(`invalid human outcome ${r.human_outcome}`);
  const pairs = reviews.map((r) => ({ r, model: byEval.get(r.evaluation_id)!.get(r.criterion_id)!.outcome }));

  const exact = pairs.filter((p) => p.model === p.r.human_outcome).length;
  const numericPairs = pairs.filter((p) => isNum(p.model) && isNum(p.r.human_outcome));
  const within1 = numericPairs.filter((p) => Math.abs(Number(p.model) - Number(p.r.human_outcome)) <= 1).length;
  const sameClass = pairs.filter((p) => cls(p.model) === cls(p.r.human_outcome)).length;
  const confusion: Record<string, Record<string, number>> = {};
  for (const p of pairs) {
    const m = (confusion[cls(p.model)] ??= {});
    m[cls(p.r.human_outcome)] = (m[cls(p.r.human_outcome)] ?? 0) + 1;
  }

  // Evidence traceability: share of model-scored (numeric) criteria whose evidence is all code-verified against the transcript.
  const modelNumeric = reviews.filter((r) => isNum(byEval.get(r.evaluation_id)!.get(r.criterion_id)!.outcome));
  const traceable = modelNumeric.filter((r) => byEval.get(r.evaluation_id)!.get(r.criterion_id)!.evidenceVerified && byEval.get(r.evaluation_id)!.get(r.criterion_id)!.outcome !== "0").length;
  const nonZeroNumeric = modelNumeric.filter((r) => byEval.get(r.evaluation_id)!.get(r.criterion_id)!.outcome !== "0").length;
  const assessed = (f: (r: HumanCriterionReview) => boolean | null) => reviews.map(f).filter((v): v is boolean => v !== null);
  const trueShare = (xs: boolean[]) => rate(xs.filter(Boolean).length, xs.length);
  const evid = assessed((r) => r.evidence_quote_exists);

  // Flags
  const fr = input.flagReviews ?? [];
  const missed = input.missedFlags ?? [];
  const supported = fr.filter((f) => f.supported).length;

  // Score differences: only for evaluations in which every criterion was reviewed (otherwise the human score would mix in model outcomes).
  const catDiffs: number[] = [];
  const ssDiffs: number[] = [];
  const psyDiffs: number[] = [];
  const provAgree: boolean[] = [];
  let fully = 0;
  for (const d of input.documents) {
    const all = [...d.sales_stage, ...d.psychology];
    const mine = new Map(reviews.filter((r) => r.evaluation_id === d.evaluation_id).map((r) => [r.criterion_id, r.human_outcome]));
    if (all.some((c) => !mine.has(c.criterion_id))) continue;
    fully++;
    const human: ScoredCriterion[] = all.map((c) => ({ criterion_id: c.criterion_id, category_id: c.category_id, outcome: mine.get(c.criterion_id)! }));
    const humanStage = human.filter((c) => c.category_id !== "SP");
    const modelStage = computeSalesStageScore({ state: "valid", criteria: d.sales_stage.map((c) => ({ criterion_id: c.criterion_id, category_id: c.category_id, outcome: c.outcome })), expectedIds: SALES_STAGE_CRITERIA.map((c) => c.id) });
    const humanSs = computeSalesStageScore({ state: "valid", criteria: humanStage, expectedIds: SALES_STAGE_CRITERIA.map((c) => c.id) });
    for (const mc of modelStage.categories) {
      const hc = categoryScore(mc.category_id, mc.category_name, humanStage);
      if (mc.percent !== null && hc.percent !== null) catDiffs.push(Math.abs(mc.percent - hc.percent));
    }
    if (modelStage.percent !== null && humanSs.percent !== null) ssDiffs.push(Math.abs(modelStage.percent - humanSs.percent));
    const mp = computePsychologyScore(d.psychology.map((c) => ({ criterion_id: c.criterion_id, category_id: "SP", outcome: c.outcome })));
    const hp = computePsychologyScore(human.filter((c) => c.category_id === "SP"));
    if (mp.percent !== null && hp.percent !== null) psyDiffs.push(Math.abs(mp.percent - hp.percent));
    provAgree.push(modelStage.status === humanSs.status);
  }

  const per = new Map<string, { n: number; exact: number }>();
  for (const p of pairs) {
    const e = per.get(p.r.criterion_id) ?? { n: 0, exact: 0 };
    e.n++;
    if (p.model === p.r.human_outcome) e.exact++;
    per.set(p.r.criterion_id, e);
  }
  const evalsReviewed = new Set(reviews.map((r) => r.evaluation_id)).size;
  const sufficient = evalsReviewed >= MIN_EVALUATIONS_FOR_CLAIMS && reviews.length >= MIN_CRITERIA_FOR_CLAIMS;
  return {
    evaluations_reviewed: evalsReviewed,
    criteria_reviewed: reviews.length,
    sufficient_for_claims: sufficient,
    caveat: sufficient ? "Sample meets the provisional minimum; the owner must still decide acceptable thresholds before any accuracy claim." : `Sample too small (${evalsReviewed} evaluations, ${reviews.length} criteria; provisional minimum ${MIN_EVALUATIONS_FOR_CLAIMS} and ${MIN_CRITERIA_FOR_CLAIMS}). These figures describe this sample only and are NOT evidence that the model is accurate.`,
    exact_agreement: rate(exact, pairs.length),
    within_one_agreement: rate(within1, numericPairs.length),
    within_one_pairs: numericPairs.length,
    na_ne_class_agreement: rate(sameClass, pairs.length),
    class_confusion: confusion,
    evidence_traceability_rate: rate(traceable, nonZeroNumeric),
    unsupported_evidence_rate: rate(evid.filter((v) => !v).length, evid.length),
    timestamp_accuracy: trueShare(assessed((r) => r.timestamp_correct)),
    speaker_accuracy: trueShare(assessed((r) => r.speaker_correct)),
    explanation_accuracy: trueShare(assessed((r) => r.explanation_accurate)),
    recommendation_relevance: trueShare(assessed((r) => r.recommendation_relevant)),
    flag_precision: rate(supported, fr.length),
    flag_recall: rate(supported, supported + missed.length),
    flags_confirmed_but_ambiguous: fr.filter((f) => f.should_be_ambiguous).length,
    mean_abs_category_diff: mean(catDiffs),
    mean_abs_sales_stage_diff: mean(ssDiffs),
    mean_abs_psychology_diff: mean(psyDiffs),
    provisional_status_agreement: rate(provAgree.filter(Boolean).length, provAgree.length),
    evaluations_fully_reviewed: fully,
    per_criterion: [...per.entries()].map(([criterion_id, v]) => ({ criterion_id, n: v.n, exact: rate(v.exact, v.n) })).sort((a, b) => a.criterion_id.localeCompare(b.criterion_id)),
  };
}

// ---------- review template ----------
export const REVIEW_COLUMNS = [
  "evaluation_id", "criterion_id", "criterion_name", "model_outcome", "model_reason_code", "model_confidence", "model_evidence", "model_explanation", "model_improvement_recommendation",
  "human_outcome", "agreement", "evidence_quote_exists", "timestamp_correct", "speaker_correct", "explanation_accurate", "recommendation_relevant", "disagreement_reason",
];
export const FLAG_REVIEW_COLUMNS = ["evaluation_id", "flag_id", "model_severity", "model_interpretation", "model_evidence", "supported (yes/no)", "severity_appropriate (yes/no)", "should_be_ambiguous (yes/no)", "comment"];
export const MISSED_FLAG_COLUMNS = ["evaluation_id", "flag_id_missed", "segment_or_time", "comment"];

/** Rows for a reviewer: model output on the left, blank human columns on the right. The reviewer sees the evidence but fills in their own score first. */
export function buildReviewTemplate(doc: Mrv1Document, evaluationId: number): { criteria: string[][]; flags: string[][] } {
  const criteria = [...doc.sales_stage, ...doc.psychology].map((c) => [
    String(evaluationId), c.criterion_id, c.criterion_name, c.outcome, c.reason_code ?? "", c.evidence_confidence,
    c.evidence.map((e) => `[${fmtTime(e.start_s)}-${fmtTime(e.end_s)}] (${e.speaker}) ${e.quote}`).join(" | "),
    c.explanation, c.improvement_recommendation, "", "", "", "", "", "", "", "",
  ]);
  const flags = (doc.extras?.flags ?? []).map((f) => [String(evaluationId), f.flag_id, f.severity, f.interpretation, `${f.start_s !== null ? `[${fmtTime(f.start_s)}] ` : ""}${f.quote ?? ""}`, "", "", "", ""]);
  return { criteria, flags };
}

export function toCsv(header: string[], rows: string[][]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [header, ...rows].map((r) => r.map(q).join(",")).join("\n") + "\n";
}
