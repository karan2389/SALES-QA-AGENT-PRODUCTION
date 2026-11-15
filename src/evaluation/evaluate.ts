// Provider-independent evaluation orchestrator. No Cloudflare types here, so it runs unchanged in tests.
import { buildMessages, PROMPT_VERSION } from "./prompt.ts";
import { CALL_TYPES, CATEGORIES_EVALUATED, CATEGORIES_NOT_EVALUATED, CRITERIA, RUBRIC_VERSION } from "./rubric.ts";
import { computeQuality, formatTranscriptForPrompt, sha256Hex } from "./transcript.ts";
import { finalizeCriteria, parseModelJson, validateModelOutput } from "./validate.ts";
import type { Adjustment, CategoryResult, CriterionResult, EvaluationDocument, Segment, TranscriptQuality } from "./types.ts";

export interface CallInfo {
  id: number;
  callyzer_call_id: string;
  agent_id: number;
  duration_seconds: number;
}
export interface LoadedTranscript {
  source: string; // "production" or "experiment:<label>"
  language: string | null;
  segments: Segment[];
}
export interface StoredEvaluationRef {
  id: number;
  human_review_status: string;
  evaluated_at: string;
  /** True if the evaluation was marked test_only / invalidated / superseded (kept for audit, never valid). */
  invalidated: boolean;
}
/** The active HUMAN-CONFIRMED call-type label of a call, if any (rubric section 13). */
export interface ActiveCallTypeLabel {
  business_call_type: string;
  labelled_by: string;
  basis: string | null;
  labelled_at: string;
}
/** Prompt-version marker for stored not-applicable results: no prompt and no model were used. */
export const NA_PROMPT_VERSION = "not_applicable_no_model";
export interface SaveExtras {
  rawModelOutput: string | null;
  usage: unknown;
}
export interface EvaluationStore {
  loadCall(callyzerCallId: string): Promise<CallInfo | null>;
  loadTranscript(callId: number, source: string): Promise<LoadedTranscript | null>;
  getActiveCallTypeLabel(callId: number): Promise<ActiveCallTypeLabel | null>;
  findEvaluation(callId: number, rubricVersion: string, promptVersion: string): Promise<StoredEvaluationRef | null>;
  deleteEvaluation(id: number): Promise<void>;
  /** Must be atomic and must throw if (call, rubric, prompt) already exists. Returns the new evaluation id. */
  saveEvaluation(doc: EvaluationDocument, extras: SaveExtras): Promise<number>;
}
export interface ModelRequest {
  system: string;
  user: string;
}
export interface ModelResponse {
  text: string;
  finish_reason?: string | null;
  usage?: unknown;
}
export interface EvaluationModel {
  /** The exact model identifier; stored with every evaluation. */
  id: string;
  run(req: ModelRequest): Promise<ModelResponse>;
}
export class EvaluationModelError extends Error {
  kind: "timeout" | "model_error" | "empty_output" | "truncated";
  constructor(kind: "timeout" | "model_error" | "empty_output" | "truncated", message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface EvaluationRequest {
  callyzerCallId: string;
  callType: string | null | undefined;
  labelledBy: string | null | undefined;
  basis?: string | null;
  transcriptSource?: string; // default "production"
  replace?: boolean;
  dryRun?: boolean;
  /** A human has seen a suspected call-type conflict and re-confirms the label (rubric section 13). */
  acknowledgeConflict?: boolean;
}
export interface EvaluationDeps {
  store: EvaluationStore;
  model: EvaluationModel;
  now?: () => Date;
}

export type EvaluationResult =
  | { status: "hold"; reason: string; document?: EvaluationDocument }
  | { status: "exists"; evaluation_id: number; human_review_status: string; evaluated_at: string }
  | { status: "ready"; call_id: number; segments: number; quality: TranscriptQuality; transcript_source: string; existing_evaluation_id: number | null; call_type: string }
  | { status: "completed" | "not_applicable"; evaluation_id: number; document: EvaluationDocument }
  | { status: "failed"; error_kind: string; message: string; errors?: string[]; raw_output?: string };

const fail = (error_kind: string, message: string, extra: { errors?: string[]; raw_output?: string } = {}): EvaluationResult => ({ status: "failed", error_kind, message, ...extra });

function notApplicableDocument(base: Omit<EvaluationDocument, "categories" | "coaching" | "transcript_assessment" | "applicability" | "validation" | "human_review">, reason: string, labelledBy: string): EvaluationDocument {
  const explanation = `Not evaluated: the call type "${base.call_type.label}" is not covered by Category 01 or Category 02 in rubric v1 (reason: ${reason}). Call type was confirmed by ${labelledBy}. This is not a statement that such calls need no introduction or discovery.`;
  const criteria: CriterionResult[] = CRITERIA.map((c) => ({
    criterion_id: c.id,
    criterion_name: c.name,
    outcome: "N/A",
    score: null,
    applicable_status: "not_applicable",
    reason_code: reason,
    elements_met: [],
    elements_missing: [],
    elements_late: [],
    elements_not_observable: [],
    element_details: [],
    evidence: [],
    absence_record: null,
    evidence_confidence: "high",
    confidence_reason: "Applicability follows the human-confirmed call-type label; no model was used.",
    explanation,
    human_review_flags: [],
    model_original_outcome: null,
  }));
  return {
    ...base,
    applicability: { status: "not_applicable", reason_code: reason },
    categories: [
      ...CATEGORIES_EVALUATED.map((cat): CategoryResult => ({ category_id: cat.id, category_name: cat.name, status: "not_applicable", criteria: criteria.filter((c) => c.criterion_id.startsWith(cat.id)) })),
      ...CATEGORIES_NOT_EVALUATED.map((cat): CategoryResult => ({ category_id: cat.id, category_name: cat.name, status: "not_evaluated", criteria: [] })),
    ],
    coaching: null,
    transcript_assessment: null,
    validation: { warnings: [], adjustments: [] },
    human_review: { status: "pending" },
  };
}

export async function runEvaluation(deps: EvaluationDeps, req: EvaluationRequest): Promise<EvaluationResult> {
  const now = deps.now ?? (() => new Date());
  // 1. Load the call (its active human-confirmed label lives with it).
  const call = await deps.store.loadCall(req.callyzerCallId);
  if (!call) return fail("call_not_found", "no call with that Callyzer id");

  // 2. Call type is a required human-confirmed input (rubric section 13). An active confirmed label on file is authoritative:
  //    a request may not evaluate the call as a different type without an explicit, verified classification change first.
  const active = await deps.store.getActiveCallTypeLabel(call.id);
  let callType = req.callType;
  let labelledBy = req.labelledBy;
  let basis = req.basis ?? null;
  if (active) {
    if (req.callType && req.callType !== active.business_call_type)
      return { status: "hold", reason: `this call is labelled "${active.business_call_type}" (confirmed by ${active.labelled_by}); it cannot be evaluated as "${req.callType}" without an explicit, verified classification change (record a new human-confirmed call-type label first)` };
    callType = active.business_call_type;
    labelledBy = active.labelled_by;
    basis = active.basis;
  }
  if (!callType || !CALL_TYPES.includes(callType)) return { status: "hold", reason: `call type missing (no confirmed label on file) or not in the approved vocabulary (${CALL_TYPES.join(", ")})` };
  if (!labelledBy || labelledBy.trim() === "") return { status: "hold", reason: "call type must be human-confirmed: labelled_by is required" };
  const promptVersion = callType === "new_webinar_prospect" ? PROMPT_VERSION : NA_PROMPT_VERSION;

  // 3. Load the transcript; no model use unless it exists.
  const source = req.transcriptSource ?? "production";
  const transcript = await deps.store.loadTranscript(call.id, source);
  if (!transcript || transcript.segments.length === 0) return fail("transcript_missing", `no completed transcript with segments for source "${source}"`);

  // 3. Duplicate prevention (same call + rubric version + prompt version).
  const existing = await deps.store.findEvaluation(call.id, RUBRIC_VERSION, promptVersion);
  const quality = computeQuality(transcript.segments, call.duration_seconds, transcript.language);
  if (req.dryRun)
    return { status: "ready", call_id: call.id, segments: transcript.segments.length, quality, transcript_source: source, existing_evaluation_id: existing?.id ?? null, call_type: callType };
  if (existing) {
    if (existing.invalidated) return fail("invalidated_evaluation_exists", "an invalidated (audit-only) evaluation already occupies this call, rubric version and prompt version; it is never deleted or replaced");
    if (!req.replace) return { status: "exists", evaluation_id: existing.id, human_review_status: existing.human_review_status, evaluated_at: existing.evaluated_at };
    if (existing.human_review_status !== "pending") return fail("replace_refused", "an evaluation that a human has started to review cannot be replaced");
    await deps.store.deleteEvaluation(existing.id);
  }

  const sha = await sha256Hex(formatTranscriptForPrompt(transcript.segments));
  const base = {
    metadata: {
      call_id: call.id,
      callyzer_call_id: call.callyzer_call_id,
      agent_id: call.agent_id,
      model_id: null as string | null,
      evaluated_at: now().toISOString(),
      prompt_version: promptVersion,
      rubric_version: RUBRIC_VERSION,
      transcript_source: source,
      transcript_sha256: sha,
    },
    call_type: { label: callType, labelled_by: labelledBy.trim(), basis, conflict_suspected: null, conflict_acknowledged: false },
    transcript_quality: quality,
  };

  // 4. Applicability: only new webinar-attendee prospect calls are scored (rubric sections 7, 12.8, 13.5). No model call otherwise.
  if (callType !== "new_webinar_prospect") {
    const reason = callType === "no_conversation" ? "no_conversation" : "call_type_not_covered";
    const doc = notApplicableDocument(base, reason, labelledBy.trim());
    const id = await deps.store.saveEvaluation(doc, { rawModelOutput: null, usage: null });
    return { status: "not_applicable", evaluation_id: id, document: doc };
  }

  // 5. Model call (isolated behind EvaluationModel).
  const { system, user } = buildMessages({ callTypeLabel: callType, durationSeconds: call.duration_seconds, transcriptSource: source, segments: transcript.segments, quality });
  let response;
  try {
    response = await deps.model.run({ system, user });
  } catch (e) {
    if (e instanceof EvaluationModelError) return fail(e.kind, e.message);
    return fail("model_error", e instanceof Error ? e.message.slice(0, 300) : "unknown model error");
  }
  if (response.finish_reason === "length") return fail("truncated", "the model stopped at its output limit before finishing the JSON", { raw_output: response.text });

  // 6. Strict validation, evidence verification and rubric consistency.
  const parsed = parseModelJson(response.text);
  if (!parsed.ok) return fail("malformed_json", parsed.error, { raw_output: response.text });
  const valid = validateModelOutput(parsed.value, transcript.segments.length);
  if (!valid.ok) return fail("schema_invalid", `${valid.errors.length} validation problem(s)`, { errors: valid.errors.slice(0, 30), raw_output: response.text });
  const fin = finalizeCriteria(valid.value, transcript.segments);

  const adjustments: Adjustment[] = fin.adjustments;
  const warnings = [...fin.warnings];
  if (valid.value.transcript_assessment.reliability === "low") warnings.push("model rated the transcript reliability as low");
  const doc: EvaluationDocument = {
    ...base,
    metadata: { ...base.metadata, model_id: deps.model.id },
    call_type: { ...base.call_type, conflict_suspected: fin.conflict, conflict_acknowledged: Boolean(req.acknowledgeConflict) },
    applicability: { status: "evaluated", reason_code: null },
    categories: [
      ...CATEGORIES_EVALUATED.map((cat): CategoryResult => ({ category_id: cat.id, category_name: cat.name, status: "evaluated", criteria: fin.results.filter((c) => c.criterion_id.startsWith(cat.id)) })),
      ...CATEGORIES_NOT_EVALUATED.map((cat): CategoryResult => ({ category_id: cat.id, category_name: cat.name, status: "not_evaluated", criteria: [] })),
    ],
    coaching: fin.coaching,
    transcript_assessment: valid.value.transcript_assessment,
    validation: { warnings, adjustments },
    human_review: { status: "pending" },
  };

  // Rubric section 13: a transcript that indicates a different call type than the human label is a conflict. The label is never
  // overridden, but the call is held (not stored) until a human re-confirms it with the conflict visible.
  if (fin.conflict && !req.acknowledgeConflict)
    return {
      status: "hold",
      reason: `the transcript indicates this may be a "${fin.conflict.suspected_type}" call, not "${callType}" (call-type conflict). Confirm the label and re-run with acknowledge_conflict to store the evaluation. The evaluation below was NOT stored.`,
      document: doc,
    };

  // 7. Persist (atomic in the store).
  try {
    const id = await deps.store.saveEvaluation(doc, { rawModelOutput: response.text, usage: response.usage ?? null });
    return { status: "completed", evaluation_id: id, document: doc };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (/unique/i.test(msg)) {
      const again = await deps.store.findEvaluation(call.id, RUBRIC_VERSION, promptVersion);
      if (again) return { status: "exists", evaluation_id: again.id, human_review_status: again.human_review_status, evaluated_at: again.evaluated_at };
    }
    return fail("persist_failed", msg.slice(0, 300));
  }
}
