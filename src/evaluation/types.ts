// Shared types for the transcript evaluation pipeline (Phase 1 prototype).
// Plain type-only syntax so the files also run under Node's type stripping (tests).

export type Outcome = "0" | "1" | "2" | "3" | "N/A" | "NE";
export type Confidence = "high" | "medium" | "low";
export type Speaker = "salesperson" | "prospect" | "unclear";
export type ElementState = "demonstrated" | "partial" | "on_time" | "late" | "never" | "not_observable";
export type Established = "yes" | "partial" | "no" | "not_transcribed";

export interface Segment {
  index: number; // 0-based, stable within one transcript
  start: number; // seconds from start of recording
  end: number;
  text: string;
}

// ---- what the model returns (validated before use) ----
export interface ModelEvidence {
  segment_start: number;
  segment_end: number;
  quote: string;
  speaker: Speaker;
  speaker_basis: string;
}
export interface ModelElement {
  code: string;
  state: ElementState;
  prompted_by_prospect?: boolean | null;
}
export interface ElementDetail {
  element: string;
  asked: boolean;
  volunteered: boolean;
  established: Established;
  quote: string | null;
  segment: number | null;
}
export interface ModelAbsenceRecord {
  window_start_segment: number;
  window_end_segment: number;
  progression_excerpts: Array<{ segment: number; quote: string; speaker: Speaker }>;
  absence_explanation: string;
}
export interface C0204Counts {
  substantive_answers: number;
  reflected_answers: number;
  neutral_followups_on_distinct_answers: number;
}
export interface ModelCriterion {
  criterion_id: string;
  outcome: Outcome;
  reason_code: string | null;
  elements: ModelElement[];
  element_details: ElementDetail[];
  understanding_check_passed: boolean | null;
  counts: C0204Counts | null;
  evidence: ModelEvidence[];
  absence_record: ModelAbsenceRecord | null;
  evidence_confidence: Confidence;
  confidence_reason: string;
  explanation: string;
  human_review_flags: string[];
}
export interface CoachingPoint {
  text: string;
  segments: number[];
}
export interface CriticalFlag {
  flag: string;
  explanation: string;
  segments: number[];
  quote: string | null;
}
export interface Coaching {
  key_strengths: CoachingPoint[];
  missed_opportunities: CoachingPoint[];
  improvement_recommendations: CoachingPoint[];
  critical_flags: CriticalFlag[];
  needs_human_verification: string[];
}
export interface CallTypeConflict {
  suspected_type: string;
  segment: number;
  quote: string;
  explanation: string;
}
export interface TranscriptAssessment {
  reliability: Confidence;
  notes: string;
  /** Does the transcript capture the start of the call (the opening phase)? */
  call_opening_observable: "yes" | "no" | "unclear";
  /** Set only if the transcript strongly indicates a different call type than the human-confirmed label. */
  call_type_conflict: CallTypeConflict | null;
}
export interface ModelOutput {
  criteria: ModelCriterion[];
  coaching: Coaching;
  transcript_assessment: TranscriptAssessment;
}

// ---- the stored, validated evaluation document ----
export interface EvidenceItem extends ModelEvidence {
  start_s: number; // derived by code from the cited segments, never taken from the model
  end_s: number;
  verified: boolean;
}
export interface AbsenceRecord {
  window_start_s: number;
  window_end_s: number;
  progression_excerpts: Array<{ segment: number; start_s: number; end_s: number; quote: string; speaker: Speaker; verified: boolean }>;
  absence_explanation: string;
}
export interface CriterionResult {
  criterion_id: string;
  criterion_name: string;
  outcome: Outcome;
  score: number | null; // 0-3 only when outcome is "0".."3"
  applicable_status: "applicable" | "not_applicable";
  reason_code: string | null; // N/A and NE reasons
  elements_met: string[];
  elements_missing: string[];
  elements_late: string[];
  elements_not_observable: string[];
  element_details: ElementDetail[];
  evidence: EvidenceItem[];
  absence_record: AbsenceRecord | null;
  evidence_confidence: Confidence;
  confidence_reason: string;
  explanation: string;
  human_review_flags: string[];
  /** Set when code changed the model's outcome (cap, unverifiable evidence, inconsistency). */
  model_original_outcome: Outcome | null;
}
export interface CategoryResult {
  category_id: string;
  category_name: string;
  status: "evaluated" | "not_applicable" | "not_evaluated";
  criteria: CriterionResult[];
}
export interface Adjustment {
  criterion_id: string;
  from: Outcome;
  to: Outcome;
  reason: string;
  /** MRV1.0: what kind of rule changed the outcome, and for flag caps the flags responsible (so a human decision can reverse it). */
  kind?: "flag_cap" | "prospect_answer_cap" | "evidence" | "element_cap" | "other";
  flag_refs?: Array<{ flag_id: string; segments: number[] }>;
}
export interface TranscriptQuality {
  language: string | null;
  duration_s: number;
  segment_count: number;
  coverage_pct: number; // share of the duration covered by segments (NOT accuracy)
  last_segment_end_s: number | null;
  gaps_over_5s: Array<{ start_s: number; end_s: number }>;
  broken_char_segments: number[];
  notes: string[];
}
export interface EvaluationDocument {
  metadata: {
    call_id: number;
    callyzer_call_id: string;
    agent_id: number;
    model_id: string | null;
    evaluated_at: string;
    prompt_version: string;
    rubric_version: string;
    transcript_source: string;
    transcript_sha256: string;
  };
  call_type: { label: string; labelled_by: string; basis: string | null; conflict_suspected: (CallTypeConflict & { start_s: number }) | null; conflict_acknowledged: boolean };
  applicability: { status: "evaluated" | "not_applicable"; reason_code: string | null };
  categories: CategoryResult[];
  coaching: Coaching | null;
  transcript_quality: TranscriptQuality;
  transcript_assessment: TranscriptAssessment | null;
  validation: { warnings: string[]; adjustments: Adjustment[] };
  human_review: { status: "pending" };
}
