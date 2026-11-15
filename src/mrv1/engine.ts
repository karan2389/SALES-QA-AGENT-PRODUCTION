// MRV1.0 evaluation orchestrator. Provider-independent (no Cloudflare types) so it runs unchanged in tests.
// Gates: 1 recording, 2 transcript, 3 call type (human-confirmed), 4 evaluation (several model passes), 5 output validation, 6 human review
// (stored pending), 7 export eligibility (see exportEligibility). A failed or partial model response is never stored as a completed evaluation.
import { EvaluationModelError } from "../evaluation/evaluate.ts";
import type { ActiveCallTypeLabel, CallInfo, EvaluationModel, LoadedTranscript, StoredEvaluationRef } from "../evaluation/evaluate.ts";
import { computeQuality, formatTranscriptForPrompt, quoteInSegments, sha256Hex } from "../evaluation/transcript.ts";
import type { Adjustment, TranscriptQuality } from "../evaluation/types.ts";
import { parseModelJson } from "../evaluation/validate.ts";
import { recordingCompleteness } from "../transcript-quality.ts";
import { buildPassMessages } from "./prompt.ts";
import { ALL_CRITERIA, MRV1_PROMPT_VERSION, MRV1_VERSION, PASSES, SALES_STAGE_CRITERIA, applicabilityFor, criteriaForPass } from "./rubric.ts";
import type { Applicability } from "./rubric.ts";
import { computePsychologyScore, computeSalesStageScore } from "./scoring.ts";
import type { EvaluationState } from "./scoring.ts";
import type { Extras, Mrv1Criterion, Mrv1Document, TranscriptAssessment } from "./types.ts";
import { assessTranscript } from "./transcript-gate.ts";
import type { TranscriptDecision } from "./transcript-gate.ts";
import { applyFlagCaps, finalizeExtras, finalizePass, validatePass } from "./validate.ts";

/** Recordings are 32 kbps constant-bitrate MP3 (verified in the transcription recovery work), so size gives duration. */
export const RECORDING_BITRATE_BPS = 32000;
export const MIN_TRANSCRIPT_SEGMENTS = 5;
export const MIN_LAST_SEGMENT_RATIO = 0.8;
export const MAX_BROKEN_SEGMENT_RATIO = 0.05;
const MAX_REVISIONS = 20;

export interface Mrv1CallInfo extends CallInfo {
  audio_size_bytes: number | null;
}
export interface SaveExtras {
  rawModelOutputs: string[];
  usage: unknown[];
}
export interface Mrv1Store {
  loadCall(callyzerCallId: string): Promise<Mrv1CallInfo | null>;
  loadTranscript(callId: number, source: string): Promise<LoadedTranscript | null>;
  getActiveCallTypeLabel(callId: number): Promise<ActiveCallTypeLabel | null>;
  findEvaluation(callId: number, rubricVersion: string, promptVersion: string): Promise<StoredEvaluationRef | null>;
  /** Atomic; must throw if (call, rubric, prompt) already exists. Returns the evaluation id. */
  saveEvaluation(doc: Mrv1Document, extras: SaveExtras): Promise<number>;
}
export interface Mrv1Deps {
  store: Mrv1Store;
  model: EvaluationModel;
  now?: () => Date;
  /** Attempts per pass for transient failures (timeout, model error, empty/malformed JSON, schema violations). Default 2. */
  maxAttempts?: number;
}
export interface Mrv1Request {
  callyzerCallId: string;
  transcriptSource?: string;
  dryRun?: boolean;
  acknowledgeConflict?: boolean;
  /** A human has reviewed a transcript whose gate decision is "requires_human_review". Never overrides a blocking decision. */
  acknowledgeTranscriptReview?: boolean;
}

export type Mrv1Result =
  | { status: "hold"; gate: 1 | 2 | 3; reason: string; /** machine-readable gate-2 outcome and reason codes */ decision?: TranscriptDecision; reason_codes?: string[]; document?: Mrv1Document }
  | { status: "exists"; evaluation_id: number; human_review_status: string; evaluated_at: string }
  | { status: "ready"; call_id: number; call_type: string; applicability: Applicability["kind"]; quality: TranscriptQuality; passes: string[] }
  | { status: "unsupported"; evaluation_id: number; document: Mrv1Document }
  | { status: "completed"; evaluation_id: number; document: Mrv1Document }
  | { status: "failed"; gate: 4 | 5; error_kind: string; pass?: string; message: string; errors?: string[]; raw_output?: string };

const failed = (gate: 4 | 5, error_kind: string, message: string, extra: { pass?: string; errors?: string[]; raw_output?: string } = {}): Mrv1Result => ({ status: "failed", gate, error_kind, message, ...extra });

/** Code-set N/A criteria for categories the call type does not cover (never scored, never zero). */
export function naCriteria(categoryIds: string[], reason: string, labelledBy: string): Mrv1Criterion[] {
  return SALES_STAGE_CRITERIA.filter((c) => categoryIds.includes(c.category_id)).map((c) => ({
    criterion_id: c.id,
    criterion_name: c.name,
    category_id: c.category_id,
    category_name: criteriaForPass({ key: "x", categories: [c.category_id], extras: false })[0]?.category_name ?? c.category_id,
    outcome: "N/A" as const,
    score: null,
    applicable_status: "not_applicable" as const,
    reason_code: reason,
    elements_met: [],
    elements_missing: [],
    elements_late: [],
    elements_not_observable: [],
    element_details: [],
    evidence: [],
    absence_record: null,
    evidence_confidence: "high" as const,
    confidence_reason: `Applicability follows the human-confirmed call type (confirmed by ${labelledBy}); no model was used for this criterion.`,
    explanation: `Not applicable (${reason}): this category is not covered for this call type. This is not a statement of poor performance.`,
    human_review_flags: [],
    model_original_outcome: null,
    improvement_recommendation: "",
    review_status: "pending" as const,
  }));
}

/** Gate 1: the stored recording must exist and be complete enough (>= 90% of the logged duration). */
export function recordingGate(call: Mrv1CallInfo): { ok: true; audio_s: number } | { ok: false; reason: string } {
  if (!call.audio_size_bytes || call.audio_size_bytes <= 0) return { ok: false, reason: "recording is not available (no stored audio)" };
  const audio_s = (call.audio_size_bytes * 8) / RECORDING_BITRATE_BPS;
  const c = recordingCompleteness(audio_s, call.duration_seconds);
  if (!c.complete) return { ok: false, reason: `recording is incomplete: stored audio is about ${Math.round(audio_s)} s but the call log says ${call.duration_seconds} s (${c.ratio_pct}%)` };
  return { ok: true, audio_s };
}

/** Export eligibility (gate 7): valid evaluations only, never held, unsupported, invalidated or test-only ones. */
export function exportEligibility(e: { invalidated: boolean; applicability_status: string; applicability_reason: string | null }): { eligible: boolean; reason: string | null } {
  if (e.invalidated) return { eligible: false, reason: "evaluation is invalidated or test-only" };
  if (e.applicability_status === "not_applicable" && e.applicability_reason === "unsupported_call_type") return { eligible: false, reason: "unsupported call type: no normal evaluation to export" };
  return { eligible: true, reason: null };
}

async function runPass(deps: Mrv1Deps, system: string, user: string, validate: (parsed: unknown) => { ok: true; value: any } | { ok: false; errors: string[] }, passKey: string): Promise<{ ok: true; value: any; raw: string; usage: unknown } | { ok: false; result: Mrv1Result }> {
  const attempts = Math.max(1, deps.maxAttempts ?? 2);
  let last: Mrv1Result = failed(4, "model_error", "no attempt made", { pass: passKey });
  for (let i = 0; i < attempts; i++) {
    let resp;
    try {
      resp = await deps.model.run({ system, user });
    } catch (e) {
      last = failed(4, e instanceof EvaluationModelError ? e.kind : "model_error", e instanceof Error ? e.message.slice(0, 300) : "unknown model error", { pass: passKey });
      continue;
    }
    if (resp.finish_reason === "length") return { ok: false, result: failed(4, "truncated", "the model stopped at its output limit before finishing the JSON", { pass: passKey, raw_output: resp.text }) };
    const parsed = parseModelJson(resp.text);
    if (!parsed.ok) {
      last = failed(5, "malformed_json", parsed.error, { pass: passKey, raw_output: resp.text });
      continue;
    }
    const v = validate(parsed.value);
    if (!v.ok) {
      last = failed(5, "schema_invalid", `${v.errors.length} validation problem(s)`, { pass: passKey, errors: v.errors.slice(0, 30), raw_output: resp.text });
      continue;
    }
    return { ok: true, value: v.value, raw: resp.text, usage: resp.usage ?? null };
  }
  return { ok: false, result: last };
}

export async function runMrv1Evaluation(deps: Mrv1Deps, req: Mrv1Request): Promise<Mrv1Result> {
  const now = deps.now ?? (() => new Date());
  const call = await deps.store.loadCall(req.callyzerCallId);
  if (!call) return failed(4, "call_not_found", "no call with that Callyzer id");

  // Gate 1: recording.
  const rec = recordingGate(call);
  if (!rec.ok) return { status: "hold", gate: 1, reason: rec.reason };

  // Gate 3 is checked before the transcript so an unconfirmed call is never prepared for evaluation (order of reporting only).
  const label = await deps.store.getActiveCallTypeLabel(call.id);
  const app = applicabilityFor(label?.business_call_type, Boolean(label && label.labelled_by.trim() !== ""));
  if (app.kind === "hold") return { status: "hold", gate: 3, reason: app.reason };
  const callType = label!.business_call_type;
  const labelledBy = label!.labelled_by.trim();

  // Gate 2: transcript.
  const source = req.transcriptSource ?? "production";
  const transcript = await deps.store.loadTranscript(call.id, source);
  if (!transcript || transcript.segments.length === 0) return { status: "hold", gate: 2, reason: `no completed transcript with segments for source "${source}"` };
  const quality = computeQuality(transcript.segments, call.duration_seconds, transcript.language);
  const tg = assessTranscript(transcript.segments, rec.audio_s, transcript.language);
  const gateWarnings: string[] = tg.reasons.filter((r) => r.severity === "note").map((r) => `transcript gate note ${r.code}: ${r.detail}`);
  if (tg.decision !== "eligible") {
    const codes = tg.reasons.filter((r) => r.severity !== "note").map((r) => r.code);
    if (!(tg.decision === "requires_human_review" && req.acknowledgeTranscriptReview))
      return { status: "hold", gate: 2, decision: tg.decision, reason_codes: codes, reason: `transcript is not eligible (${tg.decision}): ${tg.reasons.filter((r) => r.severity !== "note").map((r) => r.detail).join("; ")}` };
    gateWarnings.push(`transcript gate: human review acknowledged (${codes.join(", ")})`);
  }

  // Duplicate prevention: a free revision slot of (call, MRV1.0, prompt version). Invalidated evaluations are never replaced; a new revision is used.
  let promptVersion = MRV1_PROMPT_VERSION;
  for (let rev = 1; ; rev++) {
    if (rev > MAX_REVISIONS) return failed(4, "too_many_revisions", "too many invalidated MRV1.0 revisions exist for this call");
    promptVersion = rev === 1 ? MRV1_PROMPT_VERSION : `${MRV1_PROMPT_VERSION}#r${rev}`;
    const ex = await deps.store.findEvaluation(call.id, MRV1_VERSION, promptVersion);
    if (!ex) break;
    if (!ex.invalidated) return { status: "exists", evaluation_id: ex.id, human_review_status: ex.human_review_status, evaluated_at: ex.evaluated_at };
  }
  if (req.dryRun) return { status: "ready", call_id: call.id, call_type: callType, applicability: app.kind, quality, passes: app.kind === "evaluate" ? PASSES.map((p) => p.key) : [] };

  const sha = await sha256Hex(formatTranscriptForPrompt(transcript.segments));
  const meta = { rubric_version: MRV1_VERSION, prompt_version: promptVersion, model_id: null as string | null, evaluated_at: now().toISOString(), call_id: call.id, callyzer_call_id: call.callyzer_call_id, agent_id: call.agent_id, transcript_source: source, transcript_sha256: sha, passes: [] as string[] };
  const callTypeDoc = { label: callType, labelled_by: labelledBy, basis: label!.basis };

  // Unsupported call type: no normal evaluation. Record the reason and require human review.
  if (app.kind === "unsupported") {
    const doc: Mrv1Document = {
      metadata: meta, call_type: callTypeDoc, applicability: { status: "not_applicable", reason_code: "unsupported_call_type", na_categories: [] },
      sales_stage: [], psychology: [], scores: { sales_stage: computeSalesStageScore({ state: "unsupported", criteria: [], expectedIds: [] }), psychology: computePsychologyScore([]) },
      extras: null, transcript_assessment: null, transcript_quality: quality, validation: { warnings: [app.reason], adjustments: [] }, human_review: { status: "pending" },
    };
    try {
      const id = await deps.store.saveEvaluation(doc, { rawModelOutputs: [], usage: [] });
      return { status: "unsupported", evaluation_id: id, document: doc };
    } catch (e) {
      return failed(5, "persist_failed", e instanceof Error ? e.message.slice(0, 300) : "unknown");
    }
  }

  // Gate 4 and 5: model passes, each validated; nothing is stored unless every pass is valid.
  const naCats = app.na_categories;
  const expectedAll = ALL_CRITERIA.filter((c) => !naCats.includes(c.category_id)).map((c) => c.id);
  const sales: Mrv1Criterion[] = [...naCriteria(naCats, app.na_reason ?? "call_type_not_covered", labelledBy)];
  const psych: Mrv1Criterion[] = [];
  const adjustments: Adjustment[] = [];
  const warnings: string[] = [...gateWarnings];
  const raws: string[] = [];
  const usages: unknown[] = [];
  const assessments: TranscriptAssessment[] = [];
  let extras: Extras | null = null;
  let openingObservable: "yes" | "no" | "unclear" = "yes";
  let conflict: TranscriptAssessment["call_type_conflict"] = null;

  for (const pass of PASSES) {
    const expectedIds = criteriaForPass(pass).filter((c) => expectedAll.includes(c.id)).map((c) => c.id);
    if (expectedIds.length === 0) continue;
    const { system, user } = buildPassMessages({ pass, expectedIds, naCategories: naCats, callTypeLabel: callType, durationSeconds: call.duration_seconds, transcriptSource: source, segments: transcript.segments, quality });
    const out = await runPass(deps, system, user, (parsed) => validatePass(parsed, pass, expectedIds, transcript.segments.length), pass.key);
    if (!out.ok) return out.result;
    raws.push(out.raw);
    usages.push(out.usage);
    meta.passes.push(pass.key);
    const value = out.value;
    assessments.push(value.assessment);
    if (pass.key === PASSES[0].key) {
      openingObservable = value.assessment.call_opening_observable;
      const cc = value.assessment.call_type_conflict;
      if (cc && quoteInSegments(cc.quote, transcript.segments, cc.segment, cc.segment, 1)) conflict = cc;
      else if (cc) warnings.push("a call-type conflict was claimed but its quotation could not be verified; the claim was ignored");
    }
    const fin = finalizePass(value, pass, expectedIds, transcript.segments, openingObservable);
    adjustments.push(...fin.adjustments);
    warnings.push(...fin.warnings);
    for (const r of fin.results) (r.category_id === "SP" ? psych : sales).push(r);
    if (value.extras) {
      const fx = finalizeExtras(value.extras, transcript.segments);
      if (fx.errors.length > 0) return failed(5, "schema_invalid", `${fx.errors.length} validation problem(s)`, { pass: pass.key, errors: fx.errors.slice(0, 30), raw_output: out.raw });
      extras = fx.extras;
      warnings.push(...fx.warnings);
    }
  }
  // Confirmed ethical flags cap the criteria they overlap (flags come from the last pass, criteria from all passes).
  if (extras) applyFlagCaps([...sales, ...psych], extras.flags, adjustments);
  // Final structural check: every expected criterion present exactly once.
  const got = new Set([...sales, ...psych].map((c) => c.criterion_id));
  const missing = ALL_CRITERIA.filter((c) => !got.has(c.id));
  if (missing.length > 0) return failed(5, "incomplete_output", `${missing.length} criteria missing after validation`, { errors: missing.map((m) => m.id) });
  sales.sort((a, b) => a.criterion_id.localeCompare(b.criterion_id));
  psych.sort((a, b) => a.criterion_id.localeCompare(b.criterion_id));

  // Reliability gate on the model's own assessment: low reliability, poor speaker attribution or a wrong language blocks any published number.
  const worst = assessments.some((a) => a.reliability === "low") || assessments.some((a) => a.speaker_attribution === "poor") || assessments.some((a) => !a.language_ok);
  if (worst) warnings.push("the model rated the transcript as unreliable (low reliability, poor speaker attribution or wrong language): no overall number is published");
  if (assessments.some((a) => a.speaker_attribution === "uncertain")) warnings.push("speaker attribution is uncertain: findings that depend on who spoke need human review");
  const state: EvaluationState = worst ? "blocked" : "valid";
  const criteriaForScore = [...sales, ...psych].map((c) => ({ criterion_id: c.criterion_id, category_id: c.category_id, outcome: c.outcome }));
  const doc: Mrv1Document = {
    metadata: { ...meta, model_id: deps.model.id },
    call_type: callTypeDoc,
    applicability: { status: "evaluated", reason_code: null, na_categories: naCats },
    sales_stage: sales,
    psychology: psych,
    scores: {
      sales_stage: computeSalesStageScore({ state, criteria: criteriaForScore.filter((c) => c.category_id !== "SP"), expectedIds: SALES_STAGE_CRITERIA.map((c) => c.id) }),
      psychology: state === "valid" ? computePsychologyScore(criteriaForScore) : { percent: null, display: "Not published", status: "incomplete", numeric_count: 0, na_count: 0, ne_count: 0 },
    },
    extras,
    transcript_assessment: assessments[0] ? { ...assessments[0], reliability: assessments.some((a) => a.reliability === "low") ? "low" : assessments.some((a) => a.reliability === "medium") ? "medium" : "high", call_type_conflict: conflict } : null,
    transcript_quality: quality,
    validation: { warnings, adjustments },
    human_review: { status: "pending" },
  };

  // A transcript that indicates a different call type than the human label is a conflict: hold (not stored) until a human re-confirms.
  if (conflict && !req.acknowledgeConflict)
    return { status: "hold", gate: 3, reason: `the transcript indicates this may be a "${conflict.suspected_type}" call, not "${callType}" (call-type conflict). Confirm the label and re-run with acknowledge_conflict. The evaluation was NOT stored.`, document: doc };

  try {
    const id = await deps.store.saveEvaluation(doc, { rawModelOutputs: raws, usage: usages });
    return { status: "completed", evaluation_id: id, document: doc };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (/unique/i.test(msg)) {
      const again = await deps.store.findEvaluation(call.id, MRV1_VERSION, promptVersion);
      if (again) return { status: "exists", evaluation_id: again.id, human_review_status: again.human_review_status, evaluated_at: again.evaluated_at };
    }
    return failed(5, "persist_failed", msg.slice(0, 300));
  }
}
