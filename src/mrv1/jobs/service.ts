// Durable MRV1.0 evaluation pipeline: producer (create a job and queue its first stage), consumer (run ONE stage per message), status, retry, cancel.
// Provider-independent: the job store, the queue and the model are injected, so it runs unchanged under tests with mocks.
// Safety properties (each is covered by scripts/mrv1-jobs.test.ts):
//   * a stage can only be executed by the delivery that wins the compare-and-set lease: duplicate messages and duplicate requests never run a stage twice;
//   * each model pass is validated BEFORE its stage is marked completed, and stored; a later failure never repeats completed passes;
//   * a job is 'completed' only after the evaluation has been written by the existing atomic batch; nothing is published for a stale job;
//   * the pipeline never calls the Google Sheets export (export stays a separate, controlled action);
//   * logs and queue messages carry identifiers and error codes only, never transcript text, prompts or credentials.
import { parseModelJson } from "../../evaluation/validate.ts";
import { assembleMrv1, executePass, expectedIdsFor, prepareMrv1, saveUnsupported } from "../engine.ts";
import type { Mrv1Context, Mrv1Deps, Mrv1Request, Mrv1Result, PassOutput } from "../engine.ts";
import { MRV1_VERSION, PASSES } from "../rubric.ts";
import { validatePass } from "../validate.ts";
import { JOB_STAGES, PASS_STAGES } from "./types.ts";
import type { JobMessage, JobQueue, JobRecord, JobStage, JobStore, StageRecord } from "./types.ts";

export interface JobDeps {
  jobs: JobStore;
  mrv1: Mrv1Deps;
  queue: JobQueue;
  now?: () => Date;
  /** Lease for a running stage. Must exceed the model timeout times the in-pass attempts. Default 600 s. */
  leaseSeconds?: number;
  /** Queue-level attempts per stage (each attempt itself retries inside the pass). Default 3. */
  maxStageAttempts?: number;
  /** Structured log sink; receives identifiers and codes only. Default: console.log of one JSON line. */
  log?: (event: Record<string, unknown>) => void;
}
const cfg = (d: JobDeps) => ({ lease: d.leaseSeconds ?? 600, max: d.maxStageAttempts ?? 3, now: d.now ?? (() => new Date()) });
const iso = (d: Date) => d.toISOString();
const log = (d: JobDeps, e: Record<string, unknown>) => (d.log ?? ((x) => console.log(JSON.stringify(x))))({ component: "mrv1-jobs", ...e });
export const backoffSeconds = (attempts: number) => Math.min(900, 30 * 2 ** Math.max(0, attempts - 1));

export type Outcome = { action: "ack"; note: string } | { action: "retry"; delaySeconds: number; note: string };
const ack = (note: string): Outcome => ({ action: "ack", note });
const retry = (delaySeconds: number, note: string): Outcome => ({ action: "retry", delaySeconds, note });

const requestFor = (job: JobRecord): Mrv1Request => ({ callyzerCallId: job.callyzer_call_id, transcriptSource: job.transcript_source, acknowledgeConflict: job.acknowledge_conflict, acknowledgeTranscriptReview: job.acknowledge_transcript_review });
const nextStage = (stages: StageRecord[]): StageRecord | undefined => stages.find((s) => s.ordinal > 0 && s.status !== "completed" && s.status !== "skipped");

// ---------------- producer ----------------
export type CreateJobResult =
  | { status: "queued"; job: JobRecord }
  | { status: "existing_job"; job: JobRecord }
  | { status: "rejected"; result: Mrv1Result }
  | { status: "enqueue_failed"; job: JobRecord; message: string };

/** Gates 1-3 run now (no model). A job is created only for a call that may be evaluated; the model passes run later, one stage per queue message. */
export async function createEvaluationJob(deps: JobDeps, req: Mrv1Request & { requestedBy?: string | null }): Promise<CreateJobResult> {
  const { now } = cfg(deps);
  const prep = await prepareMrv1(deps.mrv1, { ...req, dryRun: false });
  if (!prep.ok) return { status: "rejected", result: prep.result };
  const ctx = prep.ctx;
  if (ctx.app.kind === "unsupported") return { status: "rejected", result: await saveUnsupported(deps.mrv1, ctx) }; // no model involved: recorded immediately
  const skipped = PASS_STAGES.filter((s) => expectedIdsFor(ctx, PASSES.find((p) => p.key === s)!).length === 0);
  const { job, created } = await deps.jobs.createJob(
    {
      call_id: ctx.call.id, callyzer_call_id: ctx.call.callyzer_call_id, rubric_version: MRV1_VERSION, prompt_version: ctx.promptVersion, transcript_source: ctx.source, transcript_sha256: ctx.sha,
      call_type_label: ctx.callType, call_type_labelled_at: ctx.label.labelled_at, acknowledge_conflict: Boolean(req.acknowledgeConflict), acknowledge_transcript_review: Boolean(req.acknowledgeTranscriptReview),
      requested_by: req.requestedBy ?? null, skipped_stages: skipped,
    },
    iso(now()),
  );
  if (!created) return { status: "existing_job", job };
  const first = nextStage(await deps.jobs.listStages(job.id));
  try {
    if (first) await deps.queue.send({ v: 1, job_id: job.id, stage: first.stage });
  } catch (e) {
    await deps.jobs.setJobStatus(job.id, iso(now()), { status: "failed", error_code: "enqueue_failed", error: "the queue rejected the first message", retry_eligible: true });
    return { status: "enqueue_failed", job: (await deps.jobs.getJob(job.id))!, message: e instanceof Error ? e.message.slice(0, 200) : "queue error" };
  }
  log(deps, { event: "job_created", job_id: job.id, call_id: job.call_id, prompt_version: job.prompt_version });
  return { status: "queued", job };
}

// ---------------- staleness ----------------
/** A job is stale if it was closed, the human-confirmed call type changed or disappeared, or the transcript or revision slot changed. */
async function staleReason(deps: JobDeps, job: JobRecord, ctx?: Mrv1Context): Promise<string | null> {
  const fresh = await deps.jobs.getJob(job.id);
  if (!fresh || fresh.status === "cancelled" || fresh.status === "invalidated") return "job_cancelled_or_invalidated";
  const label = await deps.mrv1.store.getActiveCallTypeLabel(job.call_id);
  if (!label) return "call_type_label_removed";
  if (label.business_call_type !== job.call_type_label) return "call_type_changed";
  if (ctx && ctx.sha !== job.transcript_sha256) return "transcript_changed";
  if (ctx && ctx.promptVersion !== job.prompt_version) return "revision_slot_changed";
  return null;
}
async function closeStale(deps: JobDeps, job: JobRecord, reason: string): Promise<Outcome> {
  const { now } = cfg(deps);
  await deps.jobs.setJobStatus(job.id, iso(now()), { status: "invalidated", error_code: reason, error: `the job is stale (${reason}); nothing was published; request a new evaluation`, retry_eligible: false, completed: true });
  log(deps, { event: "job_stale", job_id: job.id, reason });
  return ack(`stale:${reason}`);
}

// ---------------- consumer ----------------
/** Process ONE queue message. Returns what the queue handler must do (ack, or retry after a delay). Never throws for expected failures. */
export async function processJobMessage(deps: JobDeps, msg: JobMessage): Promise<Outcome> {
  const { lease, max, now } = cfg(deps);
  const job = await deps.jobs.getJob(msg.job_id);
  if (!job) return ack("unknown_job");
  if (!(JOB_STAGES as readonly string[]).includes(msg.stage) || msg.stage === "gate") return ack("invalid_stage");
  if (["completed", "failed", "cancelled", "invalidated", "partially_completed", "requires_human_review"].includes(job.status)) return ack(`job_${job.status}`);

  const early = await staleReason(deps, job);
  if (early) return closeStale(deps, job, early);

  const t = now();
  const claim = await deps.jobs.claimStage(job.id, msg.stage, iso(t), iso(new Date(t.getTime() + lease * 1000)));
  if (claim.result === "missing" || claim.result === "job_closed") return ack(`claim_${claim.result}`);
  if (claim.result === "already_completed") return advance(deps, job.id, "duplicate_delivery");
  if (claim.result === "held_by_other") {
    const wait = claim.stage?.lease_expires_at ? Math.max(15, Math.ceil((Date.parse(claim.stage.lease_expires_at) - t.getTime()) / 1000)) : 30;
    return retry(Math.min(wait, 900), "stage_in_progress_elsewhere");
  }
  const stage = claim.stage as StageRecord;
  await deps.jobs.addAttempt(job.id);
  if (stage.attempts > max) return deadJob(deps, job, msg.stage, "max_attempts_exceeded", "the stage exceeded its attempt limit (poison message)");
  await deps.jobs.setJobStatus(job.id, iso(now()), { status: "running", current_stage: msg.stage });
  log(deps, { event: "stage_started", job_id: job.id, stage: msg.stage, attempt: stage.attempts });

  try {
    return msg.stage === "finalize" ? await runFinalize(deps, job, stage) : await runPassStage(deps, job, stage);
  } catch (e) {
    // Unexpected failure (for example D1 unavailable): release the stage if possible and let the queue redeliver with backoff.
    const code = "unexpected_error";
    try {
      await deps.jobs.failStage(job.id, msg.stage, iso(now()), { code, message: e instanceof Error ? e.message.slice(0, 120) : "error" });
    } catch {
      /* the lease will expire on its own */
    }
    log(deps, { event: "stage_error", job_id: job.id, stage: msg.stage, attempt: stage.attempts, error_code: code });
    if (stage.attempts >= max) return deadJob(deps, job, msg.stage, code, "an unexpected error persisted");
    return retry(backoffSeconds(stage.attempts), code);
  }
}

async function advance(deps: JobDeps, jobId: number, note: string): Promise<Outcome> {
  const stages = await deps.jobs.listStages(jobId);
  const next = nextStage(stages);
  if (next) await deps.queue.send({ v: 1, job_id: jobId, stage: next.stage });
  return ack(next ? `${note};next:${next.stage}` : note);
}

async function deadJob(deps: JobDeps, job: JobRecord, stage: JobStage, code: string, message: string): Promise<Outcome> {
  const { now } = cfg(deps);
  const done = (await deps.jobs.listStages(job.id)).filter((s) => PASS_STAGES.includes(s.stage) && s.status === "completed").length;
  await deps.jobs.setJobStatus(job.id, iso(now()), { status: done > 0 ? "partially_completed" : "failed", current_stage: stage, error_code: code, error: message, retry_eligible: true });
  log(deps, { event: "job_dead", job_id: job.id, stage, error_code: code, passes_completed: done });
  return ack(`dead:${code}`);
}

async function prepareOrClose(deps: JobDeps, job: JobRecord, stage: JobStage): Promise<{ ctx: Mrv1Context } | { outcome: Outcome }> {
  const { now } = cfg(deps);
  const prep = await prepareMrv1(deps.mrv1, requestFor(job));
  if (!prep.ok) {
    const r = prep.result;
    const t = iso(now());
    if (r.status === "exists" && stage === "finalize") {
      // A redelivered finalize after the evaluation was already written: the job is done, and no duplicate evaluation is created.
      await deps.jobs.setJobStatus(job.id, t, { status: "completed", current_stage: "finalize", evaluation_id: r.evaluation_id, completed: true });
      await deps.jobs.completeStage(job.id, "finalize", t, { raw_output: null, usage_json: null });
      return { outcome: ack("completed:existing_evaluation") };
    }
    if (r.status === "exists") {
      await deps.jobs.failStage(job.id, stage, t, { code: "evaluation_already_exists", message: "another evaluation already occupies this revision" });
      await deps.jobs.setJobStatus(job.id, t, { status: "cancelled", error_code: "evaluation_already_exists", error: "an evaluation already exists for this call and revision", evaluation_id: r.evaluation_id, completed: true });
      return { outcome: ack("cancelled:evaluation_exists") };
    }
    if (r.status === "hold") {
      const review = r.decision === "requires_human_review";
      const code = review ? "transcript_requires_review" : `gate_${r.gate}_hold`;
      await deps.jobs.failStage(job.id, stage, t, { code, message: r.reason.slice(0, 200) });
      await deps.jobs.setJobStatus(job.id, t, { status: review ? "requires_human_review" : "failed", current_stage: stage, error_code: code, error: r.reason, retry_eligible: true });
      return { outcome: ack(`hold:${code}`) };
    }
    const code = r.status === "failed" ? r.error_kind : `unexpected_${r.status}`;
    await deps.jobs.failStage(job.id, stage, t, { code, message: "preparation failed" });
    await deps.jobs.setJobStatus(job.id, t, { status: "failed", current_stage: stage, error_code: code, error: "the call could not be prepared for evaluation", retry_eligible: false });
    return { outcome: ack(`failed:${code}`) };
  }
  const stale = await staleReason(deps, job, prep.ctx);
  if (stale) {
    await deps.jobs.failStage(job.id, stage, iso(now()), { code: stale, message: "stale" });
    return { outcome: await closeStale(deps, job, stale) };
  }
  return { ctx: prep.ctx };
}

async function runPassStage(deps: JobDeps, job: JobRecord, stage: StageRecord): Promise<Outcome> {
  const { max, now } = cfg(deps);
  const p = await prepareOrClose(deps, job, stage.stage);
  if ("outcome" in p) return p.outcome;
  const pass = PASSES.find((x) => x.key === stage.stage)!;
  const out = await executePass(deps.mrv1, p.ctx, pass);
  if (!out.ok) {
    const r = out.result;
    const code = r.status === "failed" ? r.error_kind : `unexpected_${r.status}`;
    const message = r.status === "failed" ? `${r.error_kind}: ${r.message}`.slice(0, 200) : code;
    await deps.jobs.failStage(job.id, stage.stage, iso(now()), { code, message });
    log(deps, { event: "pass_failed", job_id: job.id, stage: stage.stage, attempt: stage.attempts, error_code: code });
    if (code === "truncated") return deadJob(deps, job, stage.stage, code, "the model output was truncated at its limit; retrying the same request would truncate again");
    if (stage.attempts >= max) return deadJob(deps, job, stage.stage, code, message);
    await deps.jobs.setJobStatus(job.id, iso(now()), { status: "retrying", current_stage: stage.stage, error_code: code, error: message, retry_eligible: true });
    return retry(backoffSeconds(stage.attempts), code);
  }
  await deps.jobs.completeStage(job.id, stage.stage, iso(now()), { raw_output: out.output.raw, usage_json: out.output.usage == null ? null : JSON.stringify(out.output.usage) });
  log(deps, { event: "pass_completed", job_id: job.id, stage: stage.stage, attempt: stage.attempts });
  return advance(deps, job.id, "stage_completed");
}

async function runFinalize(deps: JobDeps, job: JobRecord, stage: StageRecord): Promise<Outcome> {
  const { max, now } = cfg(deps);
  const p = await prepareOrClose(deps, job, "finalize");
  if ("outcome" in p) return p.outcome;
  const ctx = p.ctx;
  // Rebuild every pass from the stored raw output, re-validating it (defence in depth: the stored text is validated again, not trusted).
  const stages = await deps.jobs.listStages(job.id);
  const outputs: PassOutput[] = [];
  for (const pass of PASSES) {
    const row = stages.find((s) => s.stage === pass.key);
    if (!row || row.status === "skipped") continue;
    const ids = expectedIdsFor(ctx, pass);
    if (ids.length === 0) continue;
    const parsed = row.status === "completed" && row.raw_output ? parseModelJson(row.raw_output) : null;
    const valid = parsed && parsed.ok ? validatePass(parsed.value, pass, ids, ctx.transcript.segments.length) : null;
    if (!valid || !valid.ok) {
      await deps.jobs.failStage(job.id, "finalize", iso(now()), { code: "stored_output_invalid", message: `pass ${pass.key} is missing or no longer validates` });
      await deps.jobs.setJobStatus(job.id, iso(now()), { status: "failed", current_stage: "finalize", error_code: "stored_output_invalid", error: `the stored output of ${pass.key} is missing or invalid; reprocess from scratch`, retry_eligible: false });
      return ack("dead:stored_output_invalid");
    }
    outputs.push({ pass_key: pass.key, expected_ids: ids, value: valid.value, raw: row.raw_output as string, usage: row.usage_json ? JSON.parse(row.usage_json) : null });
  }
  const late = await staleReason(deps, job, ctx); // last check before anything is written
  if (late) {
    await deps.jobs.failStage(job.id, "finalize", iso(now()), { code: late, message: "stale before persistence" });
    return closeStale(deps, job, late);
  }
  const res = await assembleMrv1(deps.mrv1, ctx, outputs, { acknowledgeConflict: job.acknowledge_conflict });
  const t = iso(now());
  if (res.status === "completed") {
    // Order matters: the job is settled BEFORE the finalize stage is marked completed, so a crash in between leaves a re-runnable stage, never a finished stage on an unfinished job.
    // Race guard: the call type or the evaluation may have changed while it was being written. A stale evaluation is superseded, never left valid.
    const after = (await staleReason(deps, job)) ?? ((await deps.jobs.isEvaluationInvalidated(res.evaluation_id)) ? "evaluation_invalidated_during_processing" : null);
    if (after) {
      await deps.jobs.invalidateEvaluation(res.evaluation_id, `stale job: ${after}`, "mrv1-job");
      await deps.jobs.setJobStatus(job.id, t, { status: "invalidated", evaluation_id: res.evaluation_id, error_code: after, error: `the evaluation was superseded because the job became stale (${after})`, completed: true });
      await deps.jobs.completeStage(job.id, "finalize", t, { raw_output: null, usage_json: null });
      log(deps, { event: "job_invalidated_after_save", job_id: job.id, evaluation_id: res.evaluation_id, reason: after });
      return ack(`invalidated_after_save:${after}`);
    }
    await deps.jobs.setJobStatus(job.id, t, { status: "completed", current_stage: "finalize", evaluation_id: res.evaluation_id, completed: true });
    await deps.jobs.completeStage(job.id, "finalize", t, { raw_output: null, usage_json: null });
    log(deps, { event: "job_completed", job_id: job.id, evaluation_id: res.evaluation_id });
    return ack("completed");
  }
  if (res.status === "exists") {
    await deps.jobs.failStage(job.id, "finalize", t, { code: "evaluation_already_exists", message: "evaluation already written" });
    await deps.jobs.setJobStatus(job.id, t, { status: "completed", evaluation_id: res.evaluation_id, completed: true }); // a redelivered finalize after a successful write: same evaluation, no duplicate
    return ack("completed:existing_evaluation");
  }
  if (res.status === "hold") {
    await deps.jobs.failStage(job.id, "finalize", t, { code: "call_type_conflict", message: res.reason.slice(0, 200) });
    await deps.jobs.setJobStatus(job.id, t, { status: "requires_human_review", current_stage: "finalize", error_code: "call_type_conflict", error: res.reason, retry_eligible: true });
    return ack("hold:call_type_conflict");
  }
  const code = res.status === "failed" ? res.error_kind : `unexpected_${res.status}`;
  await deps.jobs.failStage(job.id, "finalize", t, { code, message: res.status === "failed" ? res.message : code });
  if (code === "persist_failed" && stage.attempts < max) {
    await deps.jobs.setJobStatus(job.id, t, { status: "retrying", current_stage: "finalize", error_code: code, error: "the database write failed; retrying", retry_eligible: true });
    return retry(backoffSeconds(stage.attempts), code);
  }
  return deadJob(deps, job, "finalize", code, res.status === "failed" ? res.message : code);
}

// ---------------- control and status ----------------
export interface JobStatusView {
  job: JobRecord;
  stages: Array<{ stage: JobStage; status: string; attempts: number; error_code: string | null }>;
  summary: string;
}
export async function getJobStatus(deps: JobDeps, jobId: number): Promise<JobStatusView | null> {
  const job = await deps.jobs.getJob(jobId);
  if (!job) return null;
  const stages = await deps.jobs.listStages(jobId);
  const passes = stages.filter((s) => PASS_STAGES.includes(s.stage));
  const done = passes.filter((s) => s.status === "completed" || s.status === "skipped").length;
  const cur = stages.find((s) => s.stage === job.current_stage);
  const summary =
    job.status === "completed" ? `Completed: evaluation ${job.evaluation_id}. Awaiting human review; nothing was exported.`
    : job.status === "queued" ? `Queued: ${done} of ${passes.length} passes done.`
    : job.status === "running" ? `Running ${job.current_stage}: ${done} of ${passes.length} passes done.`
    : job.status === "retrying" ? `Retrying ${job.current_stage} (attempt ${cur?.attempts ?? 0}): ${job.last_error_code}. ${done} of ${passes.length} passes preserved.`
    : job.status === "partially_completed" ? `Stopped at ${job.current_stage} (${job.last_error_code}) with ${done} of ${passes.length} passes preserved. Retry will resume without repeating them.`
    : job.status === "requires_human_review" ? `Waiting for a human: ${job.last_error_code}.`
    : job.status === "cancelled" ? `Cancelled: ${job.last_error_code ?? "operator request"}.`
    : job.status === "invalidated" ? `Invalidated: ${job.last_error_code}. Nothing was published.`
    : `Failed at ${job.current_stage}: ${job.last_error_code}.${job.retry_eligible ? " Retry is possible." : ""}`;
  return { job, stages: stages.map((s) => ({ stage: s.stage, status: s.status, attempts: s.attempts, error_code: s.error_code })), summary };
}

/** Resume a stopped job after a failure or a human decision. Completed passes are kept; only unfinished stages run. */
export async function retryJob(deps: JobDeps, jobId: number, opts: { acknowledgeConflict?: boolean; acknowledgeTranscriptReview?: boolean } = {}): Promise<{ ok: true; job: JobRecord } | { ok: false; error: string }> {
  const { now } = cfg(deps);
  const job = await deps.jobs.getJob(jobId);
  if (!job) return { ok: false, error: "job not found" };
  if (!["failed", "partially_completed", "requires_human_review"].includes(job.status) || !job.retry_eligible) return { ok: false, error: `a ${job.status} job cannot be retried${job.retry_eligible ? "" : " (not retry-eligible)"}` };
  const stale = await staleReason(deps, job);
  if (stale) {
    await closeStale(deps, job, stale);
    return { ok: false, error: `the job is stale (${stale}); request a new evaluation` };
  }
  const t = iso(now());
  await deps.jobs.resetStagesForRetry(job.id, t);
  if (opts.acknowledgeConflict || opts.acknowledgeTranscriptReview) await deps.jobs.setAcknowledgements(job.id, { conflict: opts.acknowledgeConflict ?? job.acknowledge_conflict, review: opts.acknowledgeTranscriptReview ?? job.acknowledge_transcript_review });
  await deps.jobs.setJobStatus(job.id, t, { status: "queued", error_code: null, error: null, retry_eligible: false });
  const next = nextStage(await deps.jobs.listStages(job.id));
  if (next) await deps.queue.send({ v: 1, job_id: job.id, stage: next.stage });
  log(deps, { event: "job_requeued", job_id: job.id, next_stage: next?.stage ?? null });
  return { ok: true, job: (await deps.jobs.getJob(job.id))! };
}

/** Stop a job. Messages already in flight see the status and do nothing. A completed job cannot be cancelled (invalidate its evaluation instead). */
export async function cancelJob(deps: JobDeps, jobId: number, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { now } = cfg(deps);
  const job = await deps.jobs.getJob(jobId);
  if (!job) return { ok: false, error: "job not found" };
  if (["completed", "cancelled", "invalidated"].includes(job.status)) return { ok: false, error: `a ${job.status} job cannot be cancelled` };
  await deps.jobs.setJobStatus(job.id, iso(now()), { status: "cancelled", error_code: "cancelled_by_operator", error: reason.slice(0, 200), completed: true });
  return { ok: true };
}
