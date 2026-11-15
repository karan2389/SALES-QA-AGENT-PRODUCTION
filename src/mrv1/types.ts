// Types for the MRV1.0 evaluation document. Plain type syntax so tests run under Node type stripping.
import type { Adjustment, CriterionResult, Confidence, Segment, TranscriptQuality } from "../evaluation/types.ts";
import type { FlagId, FlagSeverity } from "./rubric.ts";
import type { PsychologyScore, SalesStageScore } from "./scoring.ts";

export type { Segment, Confidence };

export interface Mrv1Criterion extends CriterionResult {
  category_id: string;
  category_name: string;
  improvement_recommendation: string;
  /** Every criterion starts as pending; a human reviewer changes it through evaluation_reviews / score corrections. */
  review_status: "pending";
}

/** `start_s` is derived by code from the first cited segment; never taken from the model. */
export interface Point {
  text: string;
  segments: number[];
  start_s?: number;
}
export interface CoachingPriority {
  observed_issue: string;
  recommended_action: string;
  better_behaviour_example: string;
  segments: number[];
  start_s?: number;
}
export interface ProfileField {
  value: string | null; // null renders as "Not established"
  segments: number[];
  start_s?: number;
}
export interface ObjectionRecord {
  objection: string;
  segments: number[];
  start_s?: number;
  handling_summary: string;
  outcome: "resolved" | "unresolved" | "unclear";
}
export interface Mrv1Flag {
  flag_id: FlagId;
  severity: FlagSeverity;
  start_s: number | null;
  end_s: number | null;
  segments: number[];
  quote: string | null;
  explanation: string;
  /** confirmed_conduct: the transcript shows it. ambiguous: a plausible but unconfirmed reading. */
  interpretation: "confirmed_conduct" | "ambiguous";
  verification_status: "quote_verified" | "quote_unverified" | "needs_human_review";
  human_review_decision: "pending";
  notes: string[];
}
export interface TranscriptAssessment {
  reliability: Confidence;
  notes: string;
  call_opening_observable: "yes" | "no" | "unclear";
  speaker_attribution: "clear" | "uncertain" | "poor";
  language_ok: boolean;
  call_type_conflict: { suspected_type: string; segment: number; quote: string; explanation: string } | null;
}
export interface Extras {
  flags: Mrv1Flag[];
  strengths: Point[];
  missed_opportunities: Point[];
  coaching_priorities: CoachingPriority[];
  prospect_profile: Record<string, ProfileField>;
  objections: ObjectionRecord[];
  executive_summary: string;
  final_coaching_note: string;
  needs_human_verification: string[];
}

export interface Mrv1Document {
  metadata: {
    rubric_version: string;
    prompt_version: string;
    model_id: string | null;
    evaluated_at: string;
    call_id: number;
    callyzer_call_id: string;
    agent_id: number;
    transcript_source: string;
    transcript_sha256: string;
    passes: string[];
  };
  call_type: { label: string; labelled_by: string; basis: string | null };
  applicability: { status: "evaluated" | "not_applicable"; reason_code: string | null; na_categories: string[] };
  sales_stage: Mrv1Criterion[];
  psychology: Mrv1Criterion[];
  scores: { sales_stage: SalesStageScore; psychology: PsychologyScore };
  extras: Extras | null;
  transcript_assessment: TranscriptAssessment | null;
  transcript_quality: TranscriptQuality;
  validation: { warnings: string[]; adjustments: Adjustment[] };
  human_review: { status: "pending" };
}
