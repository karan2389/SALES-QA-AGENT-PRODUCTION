// D1 implementation of JobStore (tables from migrations/0007_mrv1_durable_jobs.sql). Compare-and-set SQL gives idempotent stage execution.
import { JOB_STAGES } from "./types.ts";
import type { ClaimResult, JobRecord, JobStage, JobStatus, JobStore, NewJob, StageRecord } from "./types.ts";

type JobRow = Omit<JobRecord, "acknowledge_conflict" | "acknowledge_transcript_review" | "retry_eligible"> & { acknowledge_conflict: number; acknowledge_transcript_review: number; retry_eligible: number };
const toJob = (r: JobRow): JobRecord => ({ ...r, acknowledge_conflict: r.acknowledge_conflict === 1, acknowledge_transcript_review: r.acknowledge_transcript_review === 1, retry_eligible: r.retry_eligible === 1 });
const ACTIVE_SQL = "('queued','running','retrying','partially_completed','requires_human_review')";

export function createD1JobStore(db: D1Database): JobStore {
  const getJob = async (id: number) => {
    const r = await db.prepare("SELECT * FROM evaluation_jobs WHERE id = ?").bind(id).first<JobRow>();
    return r ? toJob(r) : null;
  };
  return {
    getJob,

    async createJob(job: NewJob, nowIso: string) {
      const key = `${job.call_id}:${job.rubric_version}:${job.prompt_version}`;
      const existing = await db.prepare("SELECT * FROM evaluation_jobs WHERE idempotency_key = ?").bind(key).first<JobRow>();
      if (existing) return { job: toJob(existing), created: false };
      const active = await db.prepare(`SELECT * FROM evaluation_jobs WHERE call_id = ? AND status IN ${ACTIVE_SQL}`).bind(job.call_id).first<JobRow>();
      if (active) return { job: toJob(active), created: false }; // another revision is already in flight for this call
      const jobStmt = db
        .prepare(
          `INSERT INTO evaluation_jobs (call_id, callyzer_call_id, rubric_version, prompt_version, idempotency_key, transcript_source, transcript_sha256, call_type_label, call_type_labelled_at,
             acknowledge_conflict, acknowledge_transcript_review, status, current_stage, requested_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
        )
        .bind(job.call_id, job.callyzer_call_id, job.rubric_version, job.prompt_version, key, job.transcript_source, job.transcript_sha256, job.call_type_label, job.call_type_labelled_at,
          job.acknowledge_conflict ? 1 : 0, job.acknowledge_transcript_review ? 1 : 0, JOB_STAGES[1], job.requested_by, nowIso, nowIso);
      const stageStmts = JOB_STAGES.map((stage, i) => {
        const status = stage === "gate" ? "completed" : job.skipped_stages.includes(stage) ? "skipped" : "pending";
        return db
          .prepare("INSERT OR IGNORE INTO evaluation_job_stages (job_id, stage, ordinal, status, completed_at) VALUES ((SELECT id FROM evaluation_jobs WHERE idempotency_key = ?), ?, ?, ?, ?)")
          .bind(key, stage, i, status, status === "pending" ? null : nowIso);
      });
      try {
        await db.batch([jobStmt, ...stageStmts]); // atomic: a job never exists without its stage rows
      } catch (e) {
        // lost a race with a concurrent identical request: the unique key or the active-job index rejected the insert
        const again = (await db.prepare("SELECT * FROM evaluation_jobs WHERE idempotency_key = ?").bind(key).first<JobRow>()) ?? (await db.prepare(`SELECT * FROM evaluation_jobs WHERE call_id = ? AND status IN ${ACTIVE_SQL}`).bind(job.call_id).first<JobRow>());
        if (again) return { job: toJob(again), created: false };
        throw e;
      }
      return { job: (await getJob((await db.prepare("SELECT id FROM evaluation_jobs WHERE idempotency_key = ?").bind(key).first<{ id: number }>())!.id))!, created: true };
    },

    async listStages(jobId: number) {
      const r = await db.prepare("SELECT * FROM evaluation_job_stages WHERE job_id = ? ORDER BY ordinal").bind(jobId).all<StageRecord>();
      return r.results;
    },

    async claimStage(jobId: number, stage: JobStage, nowIso: string, leaseUntilIso: string) {
      const job = await getJob(jobId);
      if (!job) return { result: "missing" as ClaimResult, stage: null };
      if (["completed", "failed", "cancelled", "invalidated", "partially_completed", "requires_human_review"].includes(job.status)) return { result: "job_closed" as ClaimResult, stage: null };
      const upd = await db
        .prepare(
          `UPDATE evaluation_job_stages SET status = 'running', attempts = attempts + 1, lease_expires_at = ?, started_at = COALESCE(started_at, ?), error_code = NULL, error_message = NULL
           WHERE job_id = ? AND stage = ? AND (status IN ('pending','failed') OR (status = 'running' AND lease_expires_at < ?))`,
        )
        .bind(leaseUntilIso, nowIso, jobId, stage, nowIso)
        .run();
      const row = await db.prepare("SELECT * FROM evaluation_job_stages WHERE job_id = ? AND stage = ?").bind(jobId, stage).first<StageRecord>();
      if (!row) return { result: "missing" as ClaimResult, stage: null };
      if (upd.meta.changes === 1) return { result: "claimed" as ClaimResult, stage: row };
      if (row.status === "completed" || row.status === "skipped") return { result: "already_completed" as ClaimResult, stage: row };
      return { result: "held_by_other" as ClaimResult, stage: row };
    },

    async completeStage(jobId, stage, nowIso, out) {
      await db
        .prepare("UPDATE evaluation_job_stages SET status = 'completed', completed_at = ?, lease_expires_at = NULL, error_code = NULL, error_message = NULL, raw_output = ?, usage_json = ? WHERE job_id = ? AND stage = ?")
        .bind(nowIso, out.raw_output, out.usage_json, jobId, stage)
        .run();
    },

    async failStage(jobId, stage, nowIso, err) {
      await db.prepare("UPDATE evaluation_job_stages SET status = 'failed', lease_expires_at = NULL, error_code = ?, error_message = ?, completed_at = NULL WHERE job_id = ? AND stage = ? AND status = 'running'").bind(err.code, err.message.slice(0, 300), jobId, stage).run();
      void nowIso;
    },

    async resetStagesForRetry(jobId, nowIso) {
      await db.prepare("UPDATE evaluation_job_stages SET status = 'pending', attempts = 0, lease_expires_at = NULL WHERE job_id = ? AND status IN ('failed','running')").bind(jobId).run();
      void nowIso;
    },

    async setJobStatus(jobId, nowIso, p) {
      await db
        .prepare(
          `UPDATE evaluation_jobs SET status = ?, current_stage = COALESCE(?, current_stage), last_error_code = ?, last_error = ?, retry_eligible = ?, evaluation_id = COALESCE(?, evaluation_id),
             updated_at = ?, started_at = COALESCE(started_at, CASE WHEN ? = 'running' THEN ? END), completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END WHERE id = ?`,
        )
        .bind(p.status as JobStatus, p.current_stage ?? null, p.error_code ?? null, p.error ? p.error.slice(0, 300) : null, p.retry_eligible ? 1 : 0, p.evaluation_id ?? null, nowIso, p.status, nowIso, p.completed ? 1 : 0, nowIso, jobId)
        .run();
    },

    async setAcknowledgements(jobId, a) {
      await db.prepare("UPDATE evaluation_jobs SET acknowledge_conflict = ?, acknowledge_transcript_review = ? WHERE id = ?").bind(a.conflict ? 1 : 0, a.review ? 1 : 0, jobId).run();
    },

    async addAttempt(jobId) {
      await db.prepare("UPDATE evaluation_jobs SET attempt_count = attempt_count + 1 WHERE id = ?").bind(jobId).run();
    },

    async isEvaluationInvalidated(evaluationId) {
      const r = await db.prepare("SELECT 1 AS x FROM evaluation_invalidations WHERE evaluation_id = ?").bind(evaluationId).first();
      return r !== null;
    },

    async invalidateEvaluation(evaluationId, reason, by) {
      await db.prepare("INSERT OR IGNORE INTO evaluation_invalidations (evaluation_id, status, reason, invalidated_by) VALUES (?, 'superseded', ?, ?)").bind(evaluationId, reason.slice(0, 300), by).run();
    },
  };
}
