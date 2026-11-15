// Strict validation of the model's JSON, then evidence verification and rubric consistency checks.
// The model is never trusted: structure is validated, quotations must exist in the cited segments,
// timestamps are derived from segment indices, and scores that exceed what the reported elements allow are capped.
import { CALL_TYPES, CRITERIA, NE_REASONS } from "./rubric.ts";
import type { CriterionDef } from "./rubric.ts";
import { quoteInSegments } from "./transcript.ts";
import type {
  AbsenceRecord, Adjustment, CallTypeConflict, Coaching, Confidence, CriterionResult, EvidenceItem, ModelCriterion,
  ModelOutput, Outcome, Segment, Speaker,
} from "./types.ts";

const OUTCOMES: Outcome[] = ["0", "1", "2", "3", "N/A", "NE"];
const CONFIDENCES: Confidence[] = ["high", "medium", "low"];
const SPEAKERS: Speaker[] = ["salesperson", "prospect", "unclear"];
const ESTABLISHED = ["yes", "partial", "no", "not_transcribed"];

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** Extract a JSON object from model text (tolerates code fences or leading/trailing prose). */
export function parseModelJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!isStr(text) || text.trim() === "") return { ok: false, error: "empty model output" };
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return { ok: false, error: "no JSON object found in model output" };
  try {
    return { ok: true, value: JSON.parse(t.slice(a, b + 1)) };
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e instanceof Error ? e.message.slice(0, 120) : "parse error"}` };
  }
}

function validateCoaching(c: unknown, errors: string[]): void {
  if (!isObj(c)) {
    errors.push("coaching: missing or not an object");
    return;
  }
  for (const k of ["key_strengths", "missed_opportunities", "improvement_recommendations"]) {
    const arr = c[k];
    if (!Array.isArray(arr)) {
      errors.push(`coaching.${k}: must be an array`);
      continue;
    }
    arr.forEach((p, i) => {
      if (!isObj(p) || !isStr(p.text) || p.text.trim() === "" || !Array.isArray(p.segments) || !p.segments.every(isInt)) errors.push(`coaching.${k}[${i}]: needs text (string) and segments (integers)`);
    });
  }
  if (!Array.isArray(c.critical_flags)) errors.push("coaching.critical_flags: must be an array");
  else
    c.critical_flags.forEach((f: unknown, i: number) => {
      if (!isObj(f) || !isStr(f.flag) || !isStr(f.explanation) || !Array.isArray(f.segments) || !f.segments.every(isInt) || !(f.quote === null || isStr(f.quote)))
        errors.push(`coaching.critical_flags[${i}]: needs flag, explanation, segments (integers), quote (string or null)`);
    });
  if (!isStrArr(c.needs_human_verification)) errors.push("coaching.needs_human_verification: must be an array of strings");
}

export function validateCriterion(c: unknown, def: CriterionDef, segCount: number, errors: string[]): void {
  const p = `criteria[${def.id}]`;
  if (!isObj(c)) {
    errors.push(`${p}: not an object`);
    return;
  }
  if (!OUTCOMES.includes(c.outcome)) {
    errors.push(`${p}.outcome: must be one of 0,1,2,3,N/A,NE (got ${JSON.stringify(c.outcome)})`);
    return;
  }
  const numeric = c.outcome === "0" || c.outcome === "1" || c.outcome === "2" || c.outcome === "3";
  if (!(c.reason_code === null || isStr(c.reason_code))) errors.push(`${p}.reason_code: string or null`);
  if (c.outcome === "N/A" && !(isStr(c.reason_code) && def.na_reasons.includes(c.reason_code)))
    errors.push(`${p}: N/A requires reason_code in [${def.na_reasons.join(", ") || "none allowed for this criterion"}]`);
  if (c.outcome === "NE" && !(isStr(c.reason_code) && NE_REASONS.includes(c.reason_code))) errors.push(`${p}: NE requires reason_code in [${NE_REASONS.join(", ")}]`);

  if (!Array.isArray(c.elements)) errors.push(`${p}.elements: must be an array`);
  else {
    const seen = new Set<string>();
    c.elements.forEach((e: unknown, i: number) => {
      if (!isObj(e) || !isStr(e.code) || !def.elements.includes(e.code)) errors.push(`${p}.elements[${i}].code: must be one of ${def.elements.join(",")}`);
      else if (seen.has(e.code)) errors.push(`${p}.elements: duplicate code ${e.code}`);
      else seen.add(e.code);
      if (isObj(e) && !def.states.includes(e.state)) errors.push(`${p}.elements[${i}].state: must be one of ${def.states.join(",")}`);
    });
    if (numeric) for (const code of def.elements) if (!seen.has(code)) errors.push(`${p}.elements: missing element ${code}`);
  }
  if (!Array.isArray(c.evidence)) errors.push(`${p}.evidence: must be an array (may be empty only for 0, N/A, NE)`);
  else
    c.evidence.forEach((e: unknown, i: number) => {
      const q = `${p}.evidence[${i}]`;
      if (!isObj(e)) return void errors.push(`${q}: not an object`);
      if (!isInt(e.segment_start) || !isInt(e.segment_end) || e.segment_start < 0 || e.segment_end >= segCount || e.segment_start > e.segment_end) errors.push(`${q}: segment_start/segment_end must be valid segment numbers (0..${segCount - 1}) with start <= end`);
      if (!isStr(e.quote) || e.quote.trim() === "") errors.push(`${q}.quote: required non-empty string`);
      if (!SPEAKERS.includes(e.speaker)) errors.push(`${q}.speaker: must be one of ${SPEAKERS.join(",")}`);
      if (!isStr(e.speaker_basis)) errors.push(`${q}.speaker_basis: string required`);
    });
  if (!(c.absence_record === null || c.absence_record === undefined)) {
    const a = c.absence_record;
    if (!isObj(a) || !isInt(a.window_start_segment) || !isInt(a.window_end_segment) || !Array.isArray(a.progression_excerpts) || !isStr(a.absence_explanation)) errors.push(`${p}.absence_record: needs window_start_segment, window_end_segment, progression_excerpts[], absence_explanation`);
    else
      a.progression_excerpts.forEach((x: unknown, i: number) => {
        if (!isObj(x) || !isInt(x.segment) || x.segment < 0 || x.segment >= segCount || !isStr(x.quote) || !SPEAKERS.includes(x.speaker)) errors.push(`${p}.absence_record.progression_excerpts[${i}]: needs valid segment, quote, speaker`);
      });
  }
  if (!CONFIDENCES.includes(c.evidence_confidence)) errors.push(`${p}.evidence_confidence: must be high, medium or low`);
  if (!isStr(c.confidence_reason)) errors.push(`${p}.confidence_reason: string required`);
  if (!isStr(c.explanation) || c.explanation.trim() === "") errors.push(`${p}.explanation: required non-empty string`);
  if (!isStrArr(c.human_review_flags)) errors.push(`${p}.human_review_flags: array of strings required`);

  if (numeric) {
    if (def.understanding_check && c.outcome !== "0" && typeof c.understanding_check_passed !== "boolean") errors.push(`${p}.understanding_check_passed: boolean required for scores 1-3 (nothing was established when the score is 0)`);
    if (def.counts) {
      const k = c.counts;
      if (!isObj(k) || !isInt(k.substantive_answers) || !isInt(k.reflected_answers) || !isInt(k.neutral_followups_on_distinct_answers) || k.substantive_answers < 0 || k.reflected_answers < 0 || k.neutral_followups_on_distinct_answers < 0)
        errors.push(`${p}.counts: needs non-negative integers substantive_answers, reflected_answers, neutral_followups_on_distinct_answers`);
    }
    if (def.element_details.length > 0) {
      if (!Array.isArray(c.element_details)) errors.push(`${p}.element_details: array required`);
      else {
        const got = new Set<string>();
        c.element_details.forEach((d: unknown, i: number) => {
          if (!isObj(d) || !isStr(d.element) || !def.element_details.includes(d.element) || typeof d.asked !== "boolean" || typeof d.volunteered !== "boolean" || !ESTABLISHED.includes(d.established) || !(d.quote === null || isStr(d.quote)) || !(d.segment === null || isInt(d.segment)))
            errors.push(`${p}.element_details[${i}]: needs element (${def.element_details.join("/")}), asked, volunteered, established, quote|null, segment|null`);
          else got.add(d.element);
        });
        for (const e of def.element_details) if (!got.has(e)) errors.push(`${p}.element_details: missing ${e}`);
      }
    }
  }
}

/** Structural validation. Returns every problem found (not just the first). */
export function validateModelOutput(raw: unknown, segCount: number): { ok: true; value: ModelOutput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["root: not a JSON object"] };
  if (!Array.isArray(raw.criteria)) errors.push("criteria: must be an array");
  else {
    const byId = new Map<string, unknown>();
    for (const c of raw.criteria) {
      const id = isObj(c) && isStr(c.criterion_id) ? c.criterion_id : "";
      if (!CRITERIA.some((d) => d.id === id)) errors.push(`criteria: unknown or missing criterion_id ${JSON.stringify(id)}`);
      else if (byId.has(id)) errors.push(`criteria: duplicate ${id}`);
      else byId.set(id, c);
    }
    for (const def of CRITERIA) {
      if (!byId.has(def.id)) errors.push(`criteria: missing ${def.id}`);
      else validateCriterion(byId.get(def.id), def, segCount, errors);
    }
  }
  validateCoaching(raw.coaching, errors);
  const t = raw.transcript_assessment;
  if (!isObj(t) || !CONFIDENCES.includes(t.reliability) || !isStr(t.notes) || !["yes", "no", "unclear"].includes(t.call_opening_observable))
    errors.push("transcript_assessment: needs reliability (high|medium|low), notes (string) and call_opening_observable (yes|no|unclear)");
  else if (!(t.call_type_conflict === null || t.call_type_conflict === undefined)) {
    const c = t.call_type_conflict;
    if (!isObj(c) || !isStr(c.suspected_type) || !CALL_TYPES.includes(c.suspected_type) || c.suspected_type === "new_webinar_prospect" || !isInt(c.segment) || c.segment < 0 || c.segment >= segCount || !isStr(c.quote) || !isStr(c.explanation))
      errors.push("transcript_assessment.call_type_conflict: null, or { suspected_type (a call type other than new_webinar_prospect), segment, quote, explanation }");
  }
  if (errors.length > 0) return { ok: false, errors };
  // normalise optional fields now that the shape is known
  for (const c of raw.criteria as any[]) {
    c.reason_code = c.reason_code ?? null;
    c.absence_record = c.absence_record ?? null;
    c.element_details = Array.isArray(c.element_details) ? c.element_details : [];
    c.understanding_check_passed = typeof c.understanding_check_passed === "boolean" ? c.understanding_check_passed : null;
    c.counts = c.counts ?? null;
  }
  raw.transcript_assessment.call_type_conflict = raw.transcript_assessment.call_type_conflict ?? null;
  return { ok: true, value: raw as unknown as ModelOutput };
}

// ---- code-enforced rubric consistency ----
const count = (c: ModelCriterion, state: string) => c.elements.filter((e) => e.state === state).length;
const stateOf = (c: ModelCriterion, code: string) => c.elements.find((e) => e.code === code)?.state;

/** Highest score the reported elements allow, or null when the rubric imposes no element-based cap. */
export function maxScoreAllowed(def: CriterionDef, c: ModelCriterion): number | null {
  const on = count(c, "on_time");
  const late = count(c, "late");
  switch (def.id) {
    case "C01-01":
      return on >= 3 ? 3 : on === 2 ? 2 : on === 1 ? 1 : late > 0 ? 1 : 0;
    case "C01-02":
    case "C01-03":
      return on === 2 ? 3 : on === 1 ? 2 : 1;
    case "C02-01":
    case "C02-02": {
      const a = stateOf(c, "A");
      let cap = a === "demonstrated" ? 3 : a === "partial" ? 2 : 1;
      if (c.understanding_check_passed === false) cap = Math.min(cap, 2);
      return cap;
    }
    case "C02-03": {
      const full = count(c, "demonstrated");
      const addressed = full + count(c, "partial");
      const anyAsked = c.element_details.some((d) => d.asked || d.volunteered);
      let cap = full === 3 ? 3 : addressed >= 2 ? 2 : addressed === 1 ? 1 : anyAsked ? 1 : 0;
      if (c.understanding_check_passed === false) cap = Math.min(cap, 2);
      return cap;
    }
    case "C02-04": {
      const k = c.counts;
      if (!k) return null;
      const n = k.substantive_answers;
      const required = n <= 2 ? n : Math.ceil(0.75 * n);
      const followNeeded = Math.min(2, n);
      return k.reflected_answers >= required && k.neutral_followups_on_distinct_answers >= followNeeded ? 3 : 2;
    }
    default:
      return null;
  }
}

function demonstratedAnything(def: CriterionDef, c: ModelCriterion): boolean {
  if (c.elements.some((e) => ["on_time", "late", "demonstrated", "partial"].includes(e.state))) return true;
  if (def.id === "C02-03" && c.element_details.some((d) => d.asked || d.volunteered)) return true;
  return false;
}

function asNE(c: CriterionResult, reason: string, adjustments: Adjustment[], why: string): void {
  adjustments.push({ criterion_id: c.criterion_id, from: c.outcome, to: "NE", reason: why });
  c.model_original_outcome = c.model_original_outcome ?? c.outcome;
  c.outcome = "NE";
  c.score = null;
  c.applicable_status = "applicable";
  c.reason_code = reason;
  c.evidence_confidence = "low";
}

/** Verify evidence against the transcript, derive timestamps, enforce caps. Never keeps an unverifiable quotation. */
export function finalizeCriteria(model: ModelOutput, segments: Segment[]): { results: CriterionResult[]; adjustments: Adjustment[]; warnings: string[]; coaching: Coaching; conflict: (CallTypeConflict & { start_s: number }) | null } {
  const adjustments: Adjustment[] = [];
  const warnings: string[] = [];
  const results: CriterionResult[] = [];
  for (const def of CRITERIA) {
    const mc = model.criteria.find((c) => c.criterion_id === def.id) as ModelCriterion;
    const verified: EvidenceItem[] = [];
    let dropped = 0;
    for (const e of mc.evidence) {
      if (quoteInSegments(e.quote, segments, e.segment_start, e.segment_end)) {
        verified.push({ ...e, start_s: segments[e.segment_start].start, end_s: segments[e.segment_end].end, verified: true });
      } else dropped++;
    }
    if (dropped > 0) warnings.push(`${def.id}: ${dropped} quotation(s) could not be found in the cited segments and were removed`);
    const met = mc.elements.filter((e) => e.state === "on_time" || e.state === "demonstrated").map((e) => e.code);
    const missing = mc.elements.filter((e) => e.state === "never").map((e) => e.code);
    const late = mc.elements.filter((e) => e.state === "late").map((e) => e.code);
    const unobs = mc.elements.filter((e) => e.state === "not_observable").map((e) => e.code);
    const numeric = mc.outcome === "0" || mc.outcome === "1" || mc.outcome === "2" || mc.outcome === "3";
    const r: CriterionResult = {
      criterion_id: def.id,
      criterion_name: def.name,
      outcome: mc.outcome,
      score: numeric ? Number(mc.outcome) : null,
      applicable_status: mc.outcome === "N/A" ? "not_applicable" : "applicable",
      reason_code: mc.reason_code,
      elements_met: met,
      elements_missing: missing,
      elements_late: late,
      elements_not_observable: unobs,
      element_details: mc.element_details,
      evidence: verified,
      absence_record: null,
      evidence_confidence: mc.evidence_confidence,
      confidence_reason: mc.confidence_reason,
      explanation: mc.explanation.trim(),
      human_review_flags: [...new Set(mc.human_review_flags)],
      model_original_outcome: null,
    };
    if (numeric) {
      if (mc.outcome === "0") {
        const ar = mc.absence_record;
        const ex = ar
          ? ar.progression_excerpts
              .filter((x) => quoteInSegments(x.quote, segments, x.segment, x.segment, 0))
              .map((x) => ({ segment: x.segment, start_s: segments[x.segment].start, end_s: segments[x.segment].end, quote: x.quote, speaker: x.speaker, verified: true }))
          : [];
        if (demonstratedAnything(def, mc)) asNE(r, "inconsistent_model_output", adjustments, "model gave 0 but also reported demonstrated elements");
        else if (!ar || ex.length === 0) asNE(r, "absence_record_insufficient", adjustments, "0 requires an absence record with at least one verifiable excerpt");
        else {
          const record: AbsenceRecord = {
            window_start_s: segments[Math.min(Math.max(ar.window_start_segment, 0), segments.length - 1)].start,
            window_end_s: segments[Math.min(Math.max(ar.window_end_segment, 0), segments.length - 1)].end,
            progression_excerpts: ex,
            absence_explanation: ar.absence_explanation,
          };
          r.absence_record = record;
        }
      } else {
        if (verified.length === 0) asNE(r, mc.evidence.length === 0 ? "missing_evidence" : "quote_not_verifiable", adjustments, "scores 1-3 need at least one verifiable quotation");
        else {
          const cap = maxScoreAllowed(def, mc);
          const score = Number(mc.outcome);
          if (def.id === "C02-04" && mc.counts && mc.counts.substantive_answers === 0) asNE(r, "inconsistent_model_output", adjustments, "C02-04 scored although zero substantive answers were reported (should be N/A)");
          else if (cap !== null && score > cap) {
            if (cap === 0) asNE(r, "inconsistent_model_output", adjustments, "reported elements allow no score above 0");
            else {
              adjustments.push({ criterion_id: def.id, from: mc.outcome, to: String(cap) as Outcome, reason: "score capped to what the reported elements, counts or understanding check allow" });
              r.model_original_outcome = mc.outcome;
              r.outcome = String(cap) as Outcome;
              r.score = cap;
            }
          }
        }
      }
    }
    // Rubric section 5.3: if the transcript does not capture the call opening, absent or partial behaviour cannot be established.
    const isNumeric = r.outcome === "0" || r.outcome === "1" || r.outcome === "2" || r.outcome === "3";
    if (model.transcript_assessment.call_opening_observable !== "yes" && isNumeric) {
      const partialIntro = def.category_id === "C01" && r.outcome !== "3";
      const zeroStage = def.category_id === "C02" && r.outcome === "0";
      if (partialIntro || zeroStage) asNE(r, "recording_begins_midway", adjustments, "the transcript does not capture the call opening, so absent or partial behaviour cannot be established (rubric section 5.3)");
    }
    results.push(r);
  }

  // Coaching: keep only valid segment numbers; drop any critical-flag quotation that cannot be found in the cited segments.
  const n = segments.length;
  const okSegs = (xs: number[]) => xs.filter((i) => i >= 0 && i < n);
  const coaching: Coaching = {
    key_strengths: model.coaching.key_strengths.map((p) => ({ text: p.text, segments: okSegs(p.segments) })),
    missed_opportunities: model.coaching.missed_opportunities.map((p) => ({ text: p.text, segments: okSegs(p.segments) })),
    improvement_recommendations: model.coaching.improvement_recommendations.map((p) => ({ text: p.text, segments: okSegs(p.segments) })),
    critical_flags: model.coaching.critical_flags.map((f) => {
      const segs = okSegs(f.segments);
      let quote = f.quote;
      if (quote !== null && (segs.length === 0 || !quoteInSegments(quote, segments, Math.min(...segs), Math.max(...segs), 2))) {
        warnings.push(`critical flag "${f.flag}": quotation could not be verified in the cited segments and was removed`);
        quote = null;
      }
      return { flag: f.flag, explanation: f.explanation, segments: segs, quote };
    }),
    needs_human_verification: model.coaching.needs_human_verification,
  };

  // Safeguard (does not change scores): a call where every introduction criterion scored 0 is more likely a recording that starts
  // mid-call or a mislabelled call type than a salesperson who omitted every element, so a human must verify before relying on it.
  const c01 = results.filter((r) => r.criterion_id.startsWith("C01"));
  if (c01.length === 3 && c01.every((r) => r.outcome === "0")) {
    const msg = "All three introduction criteria scored 0: verify that the recording captures the start of the call and that the call-type label is correct before relying on these scores.";
    warnings.push(msg);
    coaching.needs_human_verification.unshift(msg);
    for (const r of c01) if (!r.human_review_flags.includes("verify_call_opening_and_type")) r.human_review_flags.push("verify_call_opening_and_type");
  }

  // Call-type conflict (transcript indicators only; the human label is never overridden).
  let conflict: (CallTypeConflict & { start_s: number }) | null = null;
  const cc = model.transcript_assessment.call_type_conflict;
  if (cc) {
    if (quoteInSegments(cc.quote, segments, cc.segment, cc.segment, 1)) conflict = { ...cc, start_s: segments[cc.segment].start };
    else warnings.push("a call-type conflict was claimed but its quotation could not be verified; the claim was ignored");
  }
  return { results, adjustments, warnings, coaching, conflict };
}
