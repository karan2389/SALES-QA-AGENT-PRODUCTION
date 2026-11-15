// Types for the durable MRV1.0 evaluation job pipeline. Plain type syntax so tests run under Node type stripping.
export const JOB_STAGES = ["gate", "stages_01_06", "stages_07_12", "stages_13_19", "psychology_report", "finalize"] as const;
export type JobStage = (typeof JOB_STAGES)[number];
export const PASS_STAGES: JobStage[] = ["stages_01_06", "stages_07_12", "stages_13_19", "psychology_report"];

export type JobStatus = "queued" | "running" | "retrying" | "partially_completed" | "completed" | "failed" | "requires_human_review" | "cancelled" | "invalidated";
export const TERMINAL_STATUSES: JobStatus[] = ["completed", "failed", "cancelled", "invalidated", "partially_completed", "requires_human_review"];
export const ACTIVE_STATUSES: JobStatus[] = ["queued", "running", "retrying"];
export type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface JobRecord {
  id: number;
  call_id: number;
  callyzer_call_id: string;
  rubric_version: string;
  prompt_version: string;
  idempotency_key: string;
  transcript_source: string;
  transcript_sha256: string;
  call_type_label: string;
  call_type_labelled_at: string;
  acknowledge_conflict: boolean;
  acknowledge_transcript_review: boolean;
  status: JobStatus;
  current_stage: string | null;
  attempt_count: number;
  evaluation_id: number | null;
  last_error_code: string | null;
  last_error: string | null;
  retry_eligible: boolean;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}
export interface StageRecord {
  job_id: number;
  stage: JobStage;
  ordinal: number;
  status: StageStatus;
  attempts: number;
  lease_expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  raw_output: string | null;
  usage_json: string | null;
}
export interface NewJob {
  call_id: number;
  callyzer_call_id: string;
  rubric_version: string;
  prompt_version: string;
  transcript_source: string;
  transcript_sha256: string;
  call_type_label: string;
  call_type_labelled_at: string;
  acknowledge_conflict: boolean;
  acknowledge_transcript_review: boolean;
  requested_by: string | null;
  /** stages that do not apply (e.g. a pass with no applicable criteria) start as 'skipped' */
  skipped_stages: JobStage[];
}

/** The queue message: only identifiers. Never transcript text, prompts or model output. */
export interface JobMessage {
  v: 1;
  job_id: number;
  stage: JobStage;
}
export interface JobQueue {
  send(msg: JobMessage, opts?: { delaySeconds?: number }): Promise<void>;
}

export type ClaimResult = "claimed" | "already_completed" | "held_by_other" | "missing" | "job_closed";

export interface JobStore {
  /** Idempotent on the job's idempotency key; also returns the existing non-terminal job of the call if another key is in flight. */
  createJob(job: NewJob, nowIso: string): Promise<{ job: JobRecord; created: boolean }>;
  getJob(id: number): Promise<JobRecord | null>;
  listStages(jobId: number): Promise<StageRecord[]>;
  /** Compare-and-set claim of a stage: only one delivery can hold the lease. Increments attempts when claimed. */
  claimStage(jobId: number, stage: JobStage, nowIso: string, leaseUntilIso: string): Promise<{ result: ClaimResult; stage: StageRecord | null }>;
  completeStage(jobId: number, stage: JobStage, nowIso: string, out: { raw_output: string | null; usage_json: string | null }): Promise<void>;
  /** Records a failed attempt and releases the lease. */
  failStage(jobId: number, stage: JobStage, nowIso: string, err: { code: string; message: string }): Promise<void>;
  /** Puts failed or lease-expired stages back to pending for a manual retry; completed stages are kept. */
  resetStagesForRetry(jobId: number, nowIso: string): Promise<void>;
  setJobStatus(jobId: number, nowIso: string, patch: { status: JobStatus; current_stage?: string | null; error_code?: string | null; error?: string | null; retry_eligible?: boolean; evaluation_id?: number | null; completed?: boolean }): Promise<void>;
  addAttempt(jobId: number): Promise<void>;
  /** A human has acknowledged a call-type conflict or a transcript that needed review (recorded on the job, used when it resumes). */
  setAcknowledgements(jobId: number, ack: { conflict: boolean; review: boolean }): Promise<void>;
  /** True if the evaluation was invalidated after it was written. */
  isEvaluationInvalidated(evaluationId: number): Promise<boolean>;
  /** Marks an evaluation superseded without deleting it (same mechanism as the existing invalidation). */
  invalidateEvaluation(evaluationId: number, reason: string, by: string): Promise<void>;
}
