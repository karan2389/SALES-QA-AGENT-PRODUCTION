// Structural validation, evidence verification and rubric-consistency enforcement for MRV1.0 model output.
// The model is never trusted: IDs must match the rubric, quotations must exist in the cited segments, timestamps are derived from segment
// numbers by code, and scores above what the C01/C02 element rules allow are capped. A failed pass is never stored.
import { maxScoreAllowed, validateCriterion } from "../evaluation/validate.ts";
import type { CriterionDef } from "../evaluation/rubric.ts";
import { quoteInSegments } from "../evaluation/transcript.ts";
import type { Adjustment, EvidenceItem, ModelCriterion, Outcome, Segment } from "../evaluation/types.ts";
import { validateFlags } from "./flags.ts";
import { FLAG_CRITERIA, PROSPECT_ANSWER_REQUIRED } from "./anchors.ts";
import { ELEMENT_RULE_DEFS, NA_REASONS_GENERAL, criteriaForPass } from "./rubric.ts";
import type { Pass } from "./rubric.ts";
import type { Confidence, Extras, Mrv1Criterion, ProfileField, TranscriptAssessment } from "./types.ts";

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const segsOk = (v: unknown, n: number) => Array.isArray(v) && v.every((s) => isInt(s) && s >= 0 && s < n);
const CONF: Confidence[] = ["high", "medium", "low"];

export const PROFILE_FIELDS = ["occupation", "business_and_offer", "marketing_channels", "target_customers", "sales_channels", "price_range", "monthly_customers", "annual_revenue", "team_size", "goals", "challenges"];

/** The element definition used to validate a criterion: the approved C01/C02 rules, or a generic definition. */
export function defFor(id: string, categoryId: string, categoryName: string, name: string): CriterionDef {
  const approved = ELEMENT_RULE_DEFS.find((d) => d.id === id);
  if (approved) return approved;
  return { id, category_id: categoryId, category_name: categoryName, name, elements: [], states: [], na_reasons: NA_REASONS_GENERAL, understanding_check: false, element_details: [], counts: false };
}

export interface PassValue {
  criteria: ModelCriterion[];
  assessment: TranscriptAssessment;
  extras: Omit<Extras, "flags"> & { raw_flags: unknown } | null;
}

/** Validate one model response for a pass. `expectedIds` excludes criteria that code already set (call-type N/A). */
export function validatePass(raw: unknown, pass: Pass, expectedIds: string[], segCount: number): { ok: true; value: PassValue } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["root: not a JSON object"] };
  const defs = criteriaForPass(pass).filter((c) => expectedIds.includes(c.id));
  if (!Array.isArray(raw.criteria)) errors.push("criteria: must be an array");
  else {
    const byId = new Map<string, unknown>();
    for (const c of raw.criteria) {
      const id = isObj(c) && isStr(c.criterion_id) ? c.criterion_id : "";
      if (!defs.some((d) => d.id === id)) errors.push(`criteria: unknown, unexpected or missing criterion_id ${JSON.stringify(id)}`);
      else if (byId.has(id)) errors.push(`criteria: duplicate ${id}`);
      else byId.set(id, c);
    }
    for (const d of defs) {
      if (!byId.has(d.id)) {
        errors.push(`criteria: missing ${d.id}`);
        continue;
      }
      const c = byId.get(d.id) as Record<string, any>;
      const def = defFor(d.id, d.category_id, d.category_name, d.name);
      if (def.elements.length === 0) {
        c.elements = Array.isArray(c.elements) ? c.elements : [];
      }
      if (c.human_review_flags === undefined) c.human_review_flags = [];
      validateCriterion(c, def, segCount, errors);
      if (!isStr(c.improvement_recommendation) || (["0", "1", "2"].includes(c.outcome) && c.improvement_recommendation.trim() === ""))
        errors.push(`criteria[${d.id}].improvement_recommendation: required (non-empty for scores 0, 1 and 2)`);
    }
  }
  const t = raw.transcript_assessment;
  if (!isObj(t) || !CONF.includes(t.reliability) || !isStr(t.notes) || !["yes", "no", "unclear"].includes(t.call_opening_observable) || !["clear", "uncertain", "poor"].includes(t.speaker_attribution) || typeof t.language_ok !== "boolean")
    errors.push("transcript_assessment: needs reliability, notes, call_opening_observable (yes|no|unclear), speaker_attribution (clear|uncertain|poor) and language_ok (boolean)");
  let extras: PassValue["extras"] = null;
  if (pass.extras) {
    const x = validateExtras(raw, segCount, errors);
    extras = x;
  }
  if (errors.length > 0) return { ok: false, errors };
  for (const c of raw.criteria as any[]) {
    c.reason_code = c.reason_code ?? null;
    c.absence_record = c.absence_record ?? null;
    c.element_details = Array.isArray(c.element_details) ? c.element_details : [];
    c.understanding_check_passed = typeof c.understanding_check_passed === "boolean" ? c.understanding_check_passed : null;
    c.counts = c.counts ?? null;
  }
  const a = raw.transcript_assessment;
  a.call_type_conflict = isObj(a.call_type_conflict) && isStr(a.call_type_conflict.suspected_type) && isInt(a.call_type_conflict.segment) && a.call_type_conflict.segment >= 0 && a.call_type_conflict.segment < segCount && isStr(a.call_type_conflict.quote) ? a.call_type_conflict : null;
  return { ok: true, value: { criteria: raw.criteria as ModelCriterion[], assessment: a as TranscriptAssessment, extras } };
}

function validateExtras(raw: Record<string, any>, segCount: number, errors: string[]): NonNullable<PassValue["extras"]> {
  const points = (key: string): Array<{ text: string; segments: number[] }> => {
    const v = raw[key];
    if (!Array.isArray(v)) {
      errors.push(`${key}: must be an array`);
      return [];
    }
    v.forEach((p: unknown, i: number) => {
      if (!isObj(p) || !isStr(p.text) || p.text.trim() === "" || !segsOk(p.segments, segCount) || (p.segments as number[]).length === 0) errors.push(`${key}[${i}]: needs text and at least one valid segment number (findings must be evidence-backed)`);
    });
    return v as any;
  };
  const strengths = points("what_went_well");
  const missed = points("missed_opportunities");
  const pri = raw.coaching_priorities;
  if (!Array.isArray(pri)) errors.push("coaching_priorities: must be an array");
  else
    pri.forEach((p: unknown, i: number) => {
      if (!isObj(p) || !isStr(p.observed_issue) || !isStr(p.recommended_action) || !isStr(p.better_behaviour_example) || [p.observed_issue, p.recommended_action, p.better_behaviour_example].some((s: string) => s.trim() === "") || !segsOk(p.segments, segCount) || p.segments.length === 0)
        errors.push(`coaching_priorities[${i}]: needs observed_issue, recommended_action, better_behaviour_example (all non-empty) and at least one valid segment`);
    });
  const prof = raw.prospect_profile;
  if (!isObj(prof)) errors.push("prospect_profile: must be an object");
  else
    for (const k of PROFILE_FIELDS) {
      const f = prof[k];
      if (!(f === null || f === undefined || (isObj(f) && (f.value === null || isStr(f.value)) && segsOk(f.segments ?? [], segCount)))) errors.push(`prospect_profile.${k}: null or { value (string|null), segments[] }`);
    }
  const obj = raw.objections;
  if (!Array.isArray(obj)) errors.push("objections: must be an array");
  else
    obj.forEach((o: unknown, i: number) => {
      if (!isObj(o) || !isStr(o.objection) || !isStr(o.handling_summary) || !["resolved", "unresolved", "unclear"].includes(o.outcome) || !segsOk(o.segments, segCount) || o.segments.length === 0)
        errors.push(`objections[${i}]: needs objection, handling_summary, outcome (resolved|unresolved|unclear) and at least one valid segment`);
    });
  if (!isStr(raw.executive_summary) || raw.executive_summary.trim() === "") errors.push("executive_summary: required");
  if (!isStr(raw.final_coaching_note) || raw.final_coaching_note.trim() === "") errors.push("final_coaching_note: required");
  const need = raw.needs_human_verification;
  if (!Array.isArray(need) || !need.every(isStr)) errors.push("needs_human_verification: array of strings");
  const profile: Record<string, ProfileField> = {};
  for (const k of PROFILE_FIELDS) {
    const f = isObj(prof) ? prof[k] : null;
    // Unknown prospect information stays "Not established": a value without evidence is dropped, never kept.
    profile[k] = isObj(f) && isStr(f.value) && f.value.trim() !== "" && Array.isArray(f.segments) && f.segments.length > 0 ? { value: f.value.trim(), segments: f.segments } : { value: null, segments: [] };
  }
  return {
    raw_flags: raw.critical_flags,
    strengths,
    missed_opportunities: missed,
    coaching_priorities: Array.isArray(pri) ? pri : [],
    prospect_profile: profile,
    objections: Array.isArray(obj) ? obj : [],
    executive_summary: isStr(raw.executive_summary) ? raw.executive_summary.trim() : "",
    final_coaching_note: isStr(raw.final_coaching_note) ? raw.final_coaching_note.trim() : "",
    needs_human_verification: Array.isArray(need) ? need : [],
  } as any;
}

const numericOutcome = (o: string) => o === "0" || o === "1" || o === "2" || o === "3";

function asNE(c: Mrv1Criterion, reason: string, adjustments: Adjustment[], why: string): void {
  adjustments.push({ criterion_id: c.criterion_id, from: c.outcome, to: "NE", reason: why });
  c.model_original_outcome = c.model_original_outcome ?? c.outcome;
  c.outcome = "NE";
  c.score = null;
  c.applicable_status = "applicable";
  c.reason_code = reason;
  c.evidence_confidence = "low";
}

/** Verify evidence, derive timestamps, enforce caps. Never keeps an unverifiable quotation; never turns a failure into 0. */
export function finalizePass(value: PassValue, pass: Pass, expectedIds: string[], segments: Segment[], openingObservable: "yes" | "no" | "unclear"): { results: Mrv1Criterion[]; adjustments: Adjustment[]; warnings: string[] } {
  const adjustments: Adjustment[] = [];
  const warnings: string[] = [];
  const results: Mrv1Criterion[] = [];
  for (const d of criteriaForPass(pass).filter((c) => expectedIds.includes(c.id))) {
    const mc = value.criteria.find((c) => c.criterion_id === d.id) as ModelCriterion & { improvement_recommendation: string };
    const def = defFor(d.id, d.category_id, d.category_name, d.name);
    const verified: EvidenceItem[] = [];
    let dropped = 0;
    for (const e of mc.evidence) {
      if (quoteInSegments(e.quote, segments, e.segment_start, e.segment_end)) verified.push({ ...e, start_s: segments[e.segment_start].start, end_s: segments[e.segment_end].end, verified: true });
      else dropped++;
    }
    if (dropped > 0) warnings.push(`${d.id}: ${dropped} quotation(s) could not be found in the cited segments and were removed`);
    const numeric = numericOutcome(mc.outcome);
    const r: Mrv1Criterion = {
      criterion_id: d.id,
      criterion_name: d.name,
      category_id: d.category_id,
      category_name: d.category_name,
      outcome: mc.outcome,
      score: numeric ? Number(mc.outcome) : null,
      applicable_status: mc.outcome === "N/A" ? "not_applicable" : "applicable",
      reason_code: mc.reason_code,
      elements_met: mc.elements.filter((e) => e.state === "on_time" || e.state === "demonstrated").map((e) => e.code),
      elements_missing: mc.elements.filter((e) => e.state === "never").map((e) => e.code),
      elements_late: mc.elements.filter((e) => e.state === "late").map((e) => e.code),
      elements_not_observable: mc.elements.filter((e) => e.state === "not_observable").map((e) => e.code),
      element_details: mc.element_details,
      evidence: verified,
      absence_record: null,
      evidence_confidence: mc.evidence_confidence,
      confidence_reason: mc.confidence_reason,
      explanation: mc.explanation.trim(),
      human_review_flags: [...new Set(mc.human_review_flags)],
      model_original_outcome: null,
      improvement_recommendation: (mc.improvement_recommendation ?? "").trim(),
      review_status: "pending",
    };
    if (numeric) {
      if (mc.outcome === "0") {
        const ar = mc.absence_record;
        const ex = ar ? ar.progression_excerpts.filter((x) => quoteInSegments(x.quote, segments, x.segment, x.segment, 0)).map((x) => ({ segment: x.segment, start_s: segments[x.segment].start, end_s: segments[x.segment].end, quote: x.quote, speaker: x.speaker, verified: true })) : [];
        const showedSomething = mc.elements.some((e) => ["on_time", "late", "demonstrated", "partial"].includes(e.state));
        if (showedSomething) asNE(r, "inconsistent_model_output", adjustments, "model gave 0 but also reported demonstrated elements");
        else if (!ar || ex.length === 0) asNE(r, "absence_record_insufficient", adjustments, "0 requires an absence record with at least one verifiable excerpt");
        else
          r.absence_record = {
            window_start_s: segments[Math.min(Math.max(ar.window_start_segment, 0), segments.length - 1)].start,
            window_end_s: segments[Math.min(Math.max(ar.window_end_segment, 0), segments.length - 1)].end,
            progression_excerpts: ex,
            absence_explanation: ar.absence_explanation,
          };
      } else if (verified.length === 0) asNE(r, mc.evidence.length === 0 ? "missing_evidence" : "quote_not_verifiable", adjustments, "scores 1-3 need at least one verifiable quotation");
      else {
        const cap = maxScoreAllowed(def, mc); // null for criteria without approved element rules
        const score = Number(mc.outcome);
        if (def.id === "C02-04" && mc.counts && mc.counts.substantive_answers === 0) asNE(r, "inconsistent_model_output", adjustments, "C02-04 scored although zero substantive answers were reported (should be N/A)");
        else if (cap !== null && score > cap) {
          if (cap === 0) asNE(r, "inconsistent_model_output", adjustments, "reported elements allow no score above 0");
          else {
            adjustments.push({ criterion_id: d.id, from: mc.outcome, to: String(cap) as Outcome, reason: "score capped to what the reported elements, counts or understanding check allow" });
            r.model_original_outcome = mc.outcome;
            r.outcome = String(cap) as Outcome;
            r.score = cap;
          }
        }
      }
    }
    // Information the prospect must supply: a question alone (or a salesperson restatement) never earns 2 or 3.
    if (PROSPECT_ANSWER_REQUIRED.includes(d.id) && (r.outcome === "2" || r.outcome === "3") && !verified.some((e) => e.speaker === "prospect")) {
      adjustments.push({ criterion_id: d.id, from: r.outcome, to: "1", reason: "a score of 2 or 3 needs a verified quotation attributed to the prospect: a question alone does not establish an answer" });
      r.model_original_outcome = r.model_original_outcome ?? r.outcome;
      r.outcome = "1";
      r.score = 1;
    }
    // C18: the approved Objection Doc has not been supplied, so policy compliance can never be confirmed by the engine.
    if (d.category_id === "C18" && numericOutcome(r.outcome) && !r.human_review_flags.includes("objection_policy_unverified")) r.human_review_flags.push("objection_policy_unverified");
    // Approved rule (rubric 5.3): without the call opening, absent or partial C01/C02 behaviour cannot be established.
    if (openingObservable !== "yes" && numericOutcome(r.outcome)) {
      const partialIntro = d.category_id === "C01" && r.outcome !== "3";
      const zeroIntent = d.category_id === "C02" && r.outcome === "0";
      if (partialIntro || zeroIntent) asNE(r, "recording_begins_midway", adjustments, "the transcript does not capture the call opening, so absent or partial behaviour cannot be established");
    }
    // A criterion may never rest on a personal characteristic of the prospect.
    results.push(r);
  }
  return { results, adjustments, warnings };
}

export function finalizeExtras(x: NonNullable<PassValue["extras"]>, segments: Segment[]): { extras: Extras; warnings: string[]; errors: string[] } {
  const n = segments.length;
  const ok = (xs: number[]) => xs.filter((i) => i >= 0 && i < n);
  const f = validateFlags(x.raw_flags, segments);
  const at = (segs: number[]) => {
    const s = ok(segs);
    return { segments: s, start_s: s.length ? segments[Math.min(...s)].start : undefined };
  };
  const extras: Extras = {
    flags: f.flags,
    strengths: x.strengths.map((p) => ({ text: p.text, ...at(p.segments) })),
    missed_opportunities: x.missed_opportunities.map((p) => ({ text: p.text, ...at(p.segments) })),
    coaching_priorities: x.coaching_priorities.slice(0, 3).map((p) => ({ ...p, ...at(p.segments) })),
    prospect_profile: Object.fromEntries(Object.entries(x.prospect_profile).map(([k, v]) => [k, { ...v, ...at(v.segments) }])),
    objections: x.objections.map((o) => ({ ...o, ...at(o.segments) })),
    executive_summary: x.executive_summary,
    final_coaching_note: x.final_coaching_note,
    needs_human_verification: x.needs_human_verification,
  };
  const warnings = [...f.warnings];
  if (x.coaching_priorities.length > 3) warnings.push(`the model returned ${x.coaching_priorities.length} coaching priorities; only the first three are kept`);
  return { extras, warnings, errors: f.errors };
}

/**
 * A confirmed, quote-verified flag caps at 1 every flag-linked criterion whose cited evidence overlaps the flagged segments:
 * manufactured urgency, pressure, fabricated proof, earnings promises, misrepresented support and disregarded refusals are never rewarded.
 */
export function applyFlagCaps(criteria: Mrv1Criterion[], flags: Extras["flags"], adjustments: Adjustment[]): void {
  for (const f of flags) {
    if (f.interpretation !== "confirmed_conduct" || f.verification_status !== "quote_verified") continue;
    const linked = FLAG_CRITERIA[f.flag_id] ?? [];
    for (const c of criteria) {
      if (!linked.includes(c.criterion_id) || !(c.outcome === "2" || c.outcome === "3")) continue;
      const overlaps = c.evidence.some((e) => f.segments.some((s) => s >= e.segment_start && s <= e.segment_end));
      if (!overlaps) continue;
      adjustments.push({ criterion_id: c.criterion_id, from: c.outcome, to: "1", reason: `capped at 1: the cited evidence overlaps a confirmed ${f.flag_id} flag` });
      c.model_original_outcome = c.model_original_outcome ?? c.outcome;
      c.outcome = "1";
      c.score = 1;
    }
  }
}

