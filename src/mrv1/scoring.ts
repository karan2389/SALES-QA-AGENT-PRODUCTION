// Deterministic MRV1.0 scoring. The model never calculates scores; this module does, with full precision (display rounding is separate).
//   category % = sum of numeric criterion scores / (3 x count of numeric criteria) x 100
//   sales-stage score = average of the applicable category percentages (equal category weight, equal criteria weight)
//   Sales Psychology is calculated independently and is NEVER combined with the sales-stage score.
// N/A and NE are never zero. N/A leaves numerator and denominator; NE does too and marks the category provisional.
import { CATEGORIES, SP_CRITERIA } from "./rubric.ts";

export interface ScoredCriterion {
  criterion_id: string;
  category_id: string;
  outcome: string; // "0".."3" | "N/A" | "NE"
}

export type CategoryStatus = "scored" | "provisional" | "not_applicable" | "not_evaluable";
export interface CategoryScore {
  category_id: string;
  category_name: string;
  percent: number | null;
  display: string;
  status: CategoryStatus;
  numeric_count: number;
  na_count: number;
  ne_count: number;
  provisional: boolean;
}
export type OverallStatus = "definitive" | "provisional" | "not_applicable" | "held" | "unsupported" | "incomplete" | "invalidated" | "blocked";
export interface SalesStageScore {
  percent: number | null;
  display: string;
  status: OverallStatus;
  applicable_categories: number;
  categories: CategoryScore[];
  /** Why no definitive number is published (empty when definitive). */
  notes: string[];
}
export interface PsychologyScore {
  percent: number | null;
  display: string;
  status: "definitive" | "provisional" | "not_applicable" | "incomplete";
  numeric_count: number;
  na_count: number;
  ne_count: number;
}

export const NOT_PUBLISHED = "Not published";
const isNumeric = (o: string) => o === "0" || o === "1" || o === "2" || o === "3";
const fmt = (p: number) => `${p.toFixed(1)}%`;

export function categoryScore(categoryId: string, categoryName: string, criteria: ScoredCriterion[]): CategoryScore {
  const own = criteria.filter((c) => c.category_id === categoryId);
  const numeric = own.filter((c) => isNumeric(c.outcome));
  const na = own.filter((c) => c.outcome === "N/A").length;
  const ne = own.filter((c) => c.outcome === "NE").length;
  const base = { category_id: categoryId, category_name: categoryName, numeric_count: numeric.length, na_count: na, ne_count: ne };
  if (numeric.length === 0) {
    // entirely N/A: excluded; has NE and nothing numeric: cannot be evaluated (never zero).
    if (ne === 0) return { ...base, percent: null, display: "N/A", status: "not_applicable", provisional: false };
    return { ...base, percent: null, display: "NE", status: "not_evaluable", provisional: true };
  }
  const sum = numeric.reduce((s, c) => s + Number(c.outcome), 0);
  const percent = (sum / (3 * numeric.length)) * 100;
  const provisional = ne > 0;
  return { ...base, percent, display: provisional ? `${fmt(percent)} (provisional)` : fmt(percent), status: provisional ? "provisional" : "scored", provisional };
}

export type EvaluationState = "valid" | "held" | "unsupported" | "incomplete" | "invalidated" | "test_only" | "blocked";

/**
 * @param expectedCriteria the full list of sales-stage criterion ids that must be present (all 19 categories) for a complete evaluation
 */
export function computeSalesStageScore(input: { state: EvaluationState; criteria: ScoredCriterion[]; expectedIds: string[] }): SalesStageScore {
  const none = (status: OverallStatus, note: string): SalesStageScore => ({ percent: null, display: NOT_PUBLISHED, status, applicable_categories: 0, categories: [], notes: [note] });
  switch (input.state) {
    case "held": return none("held", "evaluation held: no completed score");
    case "unsupported": return none("unsupported", "call type unsupported: no sales-stage evaluation");
    case "invalidated":
    case "test_only": return none("invalidated", "evaluation is invalidated or test-only");
    case "blocked": return none("blocked", "a gate blocked this evaluation");
    case "incomplete": return none("incomplete", "evaluation incomplete");
  }
  const have = new Set(input.criteria.map((c) => c.criterion_id));
  const missing = input.expectedIds.filter((id) => !have.has(id));
  const malformed = input.criteria.some((c) => !(isNumeric(c.outcome) || c.outcome === "N/A" || c.outcome === "NE"));
  if (missing.length > 0 || malformed) return none("incomplete", missing.length ? `${missing.length} expected criteria are missing` : "malformed outcome");

  const cats = CATEGORIES.map((c) => categoryScore(c.id, c.name, input.criteria));
  const applicable = cats.filter((c) => c.percent !== null);
  const notes: string[] = [];
  const provisionalCats = cats.filter((c) => c.provisional);
  for (const c of provisionalCats) notes.push(`${c.category_id} ${c.category_name} contains NE (insufficient evidence)${c.percent === null ? " in every criterion and cannot be scored" : ""}`);
  if (applicable.length === 0) return { percent: null, display: "N/A", status: "not_applicable", applicable_categories: 0, categories: cats, notes: ["no applicable scored category"] };
  const percent = applicable.reduce((s, c) => s + (c.percent as number), 0) / applicable.length;
  const provisional = provisionalCats.length > 0;
  return {
    percent,
    display: provisional ? `${fmt(percent)} (provisional)` : fmt(percent),
    status: provisional ? "provisional" : "definitive",
    applicable_categories: applicable.length,
    categories: cats,
    notes,
  };
}

export function computePsychologyScore(criteria: ScoredCriterion[]): PsychologyScore {
  const sp = criteria.filter((c) => c.category_id === "SP");
  const have = new Set(sp.map((c) => c.criterion_id));
  if (SP_CRITERIA.some((c) => !have.has(c.id)) || sp.some((c) => !(isNumeric(c.outcome) || c.outcome === "N/A" || c.outcome === "NE")))
    return { percent: null, display: NOT_PUBLISHED, status: "incomplete", numeric_count: 0, na_count: 0, ne_count: 0 };
  const numeric = sp.filter((c) => isNumeric(c.outcome));
  const ne = sp.filter((c) => c.outcome === "NE").length;
  const na = sp.filter((c) => c.outcome === "N/A").length;
  if (numeric.length === 0) return { percent: null, display: "N/A", status: "not_applicable", numeric_count: 0, na_count: na, ne_count: ne };
  const percent = (numeric.reduce((s, c) => s + Number(c.outcome), 0) / (3 * numeric.length)) * 100;
  return { percent, display: ne > 0 ? `${fmt(percent)} (provisional)` : fmt(percent), status: ne > 0 ? "provisional" : "definitive", numeric_count: numeric.length, na_count: na, ne_count: ne };
}
