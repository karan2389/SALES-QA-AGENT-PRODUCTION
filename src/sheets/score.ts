// Phase 1 Overall Call Score. Pure; no Cloudflare types.
//
//   Category % = sum of applicable criterion scores / (3 x applicable criteria) x 100; legacy score = average of the C01 and C02 category percentages\n//   (equal category weight, never pooled across categories). Shown as partial: it covers 2 of the 19 MRV1.0 categories.\n//   MRV1.0 evaluations do NOT use this function: see scoreForRecord in rows.ts and src/mrv1/scoring.ts.
//
// Only approved Categories 01 and 02 count. N/A and NE criteria are excluded from numerator AND denominator (never zero).
// No applicable evaluated criteria -> "N/A". Incomplete, invalidated, test-only or transcript-blocked evaluations never get a number.
// This is a rubric score for human review; it says nothing about conversion or revenue.

export const SCORED_CATEGORIES = ["C01", "C02"] as const;
export const EXPECTED_CRITERIA = 9; // C01-01..03 and C02-01..06 in rubric v1
export const NOT_PUBLISHED = "Not published";

export type EvaluationState = "valid" | "incomplete" | "invalidated" | "test_only" | "blocked";
export interface ScoreCriterion {
  category_id: string;
  outcome: string; // '0'..'3' | 'N/A' | 'NE'
  applicable_status: string;
  score: number | null;
}
export interface ScoreResult {
  /** Full-precision percentage, or null when no number may be published. */
  score: number | null;
  /** What the sheet shows: "66.7%", "N/A" or "Not published". */
  display: string;
  /** Evaluation Status column. */
  status: "Evaluated" | "N/A" | "Insufficient evidence" | "Incomplete" | "Blocked" | "Invalidated" | "Test-only";
  applicable_criteria: number;
  score_sum: number;
}

const isScored = (c: ScoreCriterion) =>
  (SCORED_CATEGORIES as readonly string[]).includes(c.category_id) &&
  c.applicable_status === "applicable" &&
  ["0", "1", "2", "3"].includes(c.outcome) &&
  typeof c.score === "number" && Number.isInteger(c.score) && c.score >= 0 && c.score <= 3;

export function computeOverallScore(input: { state: EvaluationState; criteria: ScoreCriterion[] }): ScoreResult {
  const blocked = (status: ScoreResult["status"]): ScoreResult => ({ score: null, display: NOT_PUBLISHED, status, applicable_criteria: 0, score_sum: 0 });
  if (input.state === "invalidated") return blocked("Invalidated");
  if (input.state === "test_only") return blocked("Test-only");
  if (input.state === "blocked") return blocked("Blocked");
  const inScope = input.criteria.filter((c) => (SCORED_CATEGORIES as readonly string[]).includes(c.category_id));
  const wellFormed = inScope.every((c) => ["0", "1", "2", "3", "N/A", "NE"].includes(c.outcome));
  if (input.state === "incomplete" || inScope.length < EXPECTED_CRITERIA || !wellFormed) return blocked("Incomplete");

  const scored = inScope.filter(isScored);
  if (scored.length === 0) {
    const allNA = inScope.every((c) => c.outcome === "N/A");
    return { score: null, display: "N/A", status: allNA ? "N/A" : "Insufficient evidence", applicable_criteria: 0, score_sum: 0 };
  }
  const sum = scored.reduce((n, c) => n + (c.score as number), 0);
  // Equal weight per category (not pooled across categories): average of the C01 and C02 percentages that have scored criteria.
  const catPcts = SCORED_CATEGORIES.map((id) => scored.filter((c) => c.category_id === id)).filter((cs) => cs.length > 0).map((cs) => (cs.reduce((n, c) => n + (c.score as number), 0) / (3 * cs.length)) * 100);
  const pct = catPcts.reduce((a, b) => a + b, 0) / catPcts.length;
  // Only two of 19 categories exist in this legacy rubric: label the number so it cannot be read as a full sales-stage score.
  return { score: pct, display: `${(Math.round(pct * 10) / 10).toFixed(1)}% (partial: C01-C02 only)`, status: "Evaluated", applicable_criteria: scored.length, score_sum: sum };
}

