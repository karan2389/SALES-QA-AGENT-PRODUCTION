// Durable MRV1.0 job pipeline, tested against the REAL job store SQL (SQLite with migrations 0001-0007), a mocked model and an in-memory queue.
// Nothing here calls Workers AI, Cloudflare, Google or a real recording. The queue is simulated: messages are processed one at a time, failures are
// injected, duplicates are delivered on purpose, and the clock is controlled so leases can expire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createMrv1Store } from "../src/mrv1/d1-store.ts";
import { createD1JobStore } from "../src/mrv1/jobs/d1-job-store.ts";
import { backoffSeconds, cancelJob, createEvaluationJob, getJobStatus, processJobMessage, retryJob } from "../src/mrv1/jobs/service.ts";
import { createD1ExportStore } from "../src/sheets/d1-export-store.ts";
import { AUDIO_BYTES, CALL_SECONDS, SEGMENTS, fakeModel } from "./mrv1-fixtures.ts";

function d1(db: DatabaseSync): any {
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt: any = {
      bind: (...b: unknown[]) => ((binds = b), stmt),
      run: async () => {
        const r = db.prepare(sql).run(...(binds as any[]));
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
      all: async () => ({ results: db.prepare(sql).all(...(binds as any[])) }),
      first: async () => db.prepare(sql).get(...(binds as any[])) ?? null,
    };
    return stmt;
  };
  return {
    prepare,
    batch: async (stmts: any[]) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
const MIGRATIONS = readdirSync("migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

class MemQueue {
  msgs: Array<{ msg: any; delay: number }> = [];
  sent: any[] = [];
  failSends = 0;
  async send(msg: any, opts?: { delaySeconds?: number }) {
    if (this.failSends > 0) {
      this.failSends--;
      throw new Error("queue unavailable");
    }
    this.sent.push(msg);
    this.msgs.push({ msg, delay: opts?.delaySeconds ?? 0 });
  }
}
type Behaviour = "ok" | "fail" | "truncate" | "badjson";
/** Wraps the fixture model: `plan(callNumber, pass)` decides each call's behaviour. Counts calls per pass. */
function plannedModel(plan: (n: number, pass: string) => Behaviour = () => "ok") {
  const inner = fakeModel();
  const calls: Array<{ n: number; pass: string; b: Behaviour }> = [];
  return {
    id: "fake-model",
    calls,
    async run(req: any) {
      const pass = /pass: ([a-z0-9_]+)/.exec(req.user)?.[1] ?? "?";
      const n = calls.length + 1;
      const b = plan(n, pass);
      calls.push({ n, pass, b });
      if (b === "fail") throw new Error("simulated model failure");
      const out = await inner.run(req);
      if (b === "truncate") return { ...out, finish_reason: "length" };
      if (b === "badjson") return { text: "{ this is not json" };
      return out;
    },
  };
}
/** Injects failures into a store object's methods: faults = { method: timesToFail }. */
function faulty<T extends object>(target: T, faults: Record<string, number>): T {
  return new Proxy(target, {
    get(t: any, p: string) {
      const v = t[p];
      if (typeof v !== "function") return v;
      return async (...a: unknown[]) => {
        if ((faults[p] ?? 0) > 0) {
          faults[p]--;
          throw new Error(`injected ${p} failure`);
        }
        return v.apply(t, a);
      };
    },
  });
}

async function world(opts: { plan?: (n: number, pass: string) => Behaviour; maxStageAttempts?: number; storeFaults?: Record<string, number>; jobFaults?: Record<string, number> } = {}) {
  const db = new DatabaseSync(":memory:");
  for (const f of MIGRATIONS) db.exec(readFileSync(`migrations/${f}`, "utf8"));
  const segs = JSON.stringify({ segments: SEGMENTS.map((s) => ({ start: s.start, end: s.end, text: s.text })), transcription_info: { language: "en" } });
  db.prepare("INSERT INTO sales_agents (employee_number, employee_name) VALUES ('901', 'alpha agent')").run();
  db.prepare("INSERT INTO calls (callyzer_call_id, sales_agent_id, call_date, duration_seconds, call_type, r2_object_key, audio_size_bytes, processing_status) VALUES ('CY-7', 1, '2026-11-01', ?, 'Outgoing', 'k', ?, 'transcribed')").run(CALL_SECONDS, AUDIO_BYTES);
  db.prepare("INSERT INTO transcripts (call_id, transcription_model, language, transcript_text, transcription_status, segments_json) VALUES (1, 'whisper', 'en', 't', 'completed', ?)").run(segs);
  db.prepare("INSERT INTO call_type_labels (call_id, business_call_type, verification, labelled_by, basis) VALUES (1, 'new_webinar_prospect', 'human_confirmed', 'Owner', 'x')").run();
  const clock = { t: Date.parse("2026-11-15T10:00:00.000Z") };
  const queue = new MemQueue();
  const model = plannedModel(opts.plan);
  const logs: any[] = [];
  const mrvStore = createMrv1Store(d1(db));
  const deps: any = {
    jobs: faulty(createD1JobStore(d1(db)), opts.jobFaults ?? {}),
    mrv1: { store: faulty(mrvStore, opts.storeFaults ?? {}), model, maxAttempts: 1 },
    queue,
    now: () => new Date(clock.t),
    maxStageAttempts: opts.maxStageAttempts ?? 3,
    leaseSeconds: 600,
    log: (e: any) => logs.push(e),
  };
  return { db, deps, queue, model, clock, logs, count: (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any).n as number };
}
/** Simulated queue worker. Retried messages go back to the queue (the clock advances by the requested delay). */
async function drain(w: Awaited<ReturnType<typeof world>>, o: { max?: number; duplicate?: boolean; stopWhen?: () => boolean } = {}) {
  const outcomes: any[] = [];
  for (let i = 0; i < (o.max ?? 80) && w.queue.msgs.length > 0; i++) {
    if (o.stopWhen?.()) break;
    const m = w.queue.msgs.shift()!;
    const out = await processJobMessage(w.deps, m.msg);
    outcomes.push({ stage: m.msg.stage, ...out });
    if (out.action === "retry") {
      w.clock.t += out.delaySeconds * 1000;
      w.queue.msgs.push({ msg: m.msg, delay: out.delaySeconds });
    }
    if (o.duplicate) outcomes.push({ stage: m.msg.stage, dup: true, ...(await processJobMessage(w.deps, m.msg)) }); // the same message delivered twice
  }
  return outcomes;
}
const create = (w: Awaited<ReturnType<typeof world>>, extra: object = {}) => createEvaluationJob(w.deps, { callyzerCallId: "CY-7", ...extra });
const job = (w: Awaited<ReturnType<typeof world>>, id = 1) => w.db.prepare("SELECT * FROM evaluation_jobs WHERE id = ?").get(id) as any;
const stage = (w: Awaited<ReturnType<typeof world>>, s: string, id = 1) => w.db.prepare("SELECT * FROM evaluation_job_stages WHERE job_id = ? AND stage = ?").get(id, s) as any;

test("job creation: one job with six stage rows, gate completed, first pass queued with identifiers only", async () => {
  const w = await world();
  const r: any = await create(w);
  assert.equal(r.status, "queued");
  assert.equal(job(w).status, "queued");
  assert.equal(job(w).call_type_label, "new_webinar_prospect");
  assert.equal(job(w).prompt_version, "mrv1-prompt-v2");
  assert.deepEqual((w.db.prepare("SELECT stage, status FROM evaluation_job_stages ORDER BY ordinal").all() as any[]).map((s) => `${s.stage}:${s.status}`), ["gate:completed", "stages_01_06:pending", "stages_07_12:pending", "stages_13_19:pending", "psychology_report:pending", "finalize:pending"]);
  assert.deepEqual(w.queue.sent, [{ v: 1, job_id: 1, stage: "stages_01_06" }]);
  assert.equal(w.model.calls.length, 0); // creating a job never calls the model
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 0);
});

test("successful completion: stages run in order, one evaluation is written, the job completes, status is human-readable", async () => {
  const w = await world();
  await create(w);
  await drain(w);
  assert.equal(job(w).status, "completed");
  assert.equal(job(w).evaluation_id, 1);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 1);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluation_criteria"), 70);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluation_sp_criteria"), 22);
  assert.deepEqual(w.model.calls.map((c) => c.pass), ["stages_01_06", "stages_07_12", "stages_13_19", "psychology_report"]);
  assert.ok((w.db.prepare("SELECT status FROM evaluation_job_stages").all() as any[]).every((s) => s.status === "completed"));
  assert.equal((w.db.prepare("SELECT human_review_status FROM evaluations").get() as any).human_review_status, "pending");
  const s: any = await getJobStatus(w.deps, 1);
  assert.match(s.summary, /^Completed: evaluation 1\. Awaiting human review; nothing was exported\./);
  assert.equal(s.stages.length, 6);
});

test("duplicate job creation (sequential and concurrent) returns the same job and queues nothing new", async () => {
  const w = await world();
  const a: any = await create(w);
  const b: any = await create(w);
  assert.equal(b.status, "existing_job");
  assert.equal(b.job.id, a.job.id);
  const c = await Promise.all([create(w), create(w), create(w)]);
  assert.ok(c.every((x: any) => x.status === "existing_job"));
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluation_jobs"), 1);
  assert.equal(w.queue.sent.length, 1);
  // a request for a call that already has an evaluation is rejected as existing, with no job
  await drain(w);
  const d: any = await create(w);
  assert.equal(d.status, "rejected");
  assert.equal(d.result.status, "exists");
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluation_jobs"), 1);
});

test("duplicate message delivery: every message delivered twice, still one model call per pass and one evaluation", async () => {
  const w = await world();
  await create(w);
  await drain(w, { duplicate: true });
  assert.equal(job(w).status, "completed");
  assert.equal(w.model.calls.length, 4);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 1);
});

test("a message for a stage another delivery is running is retried later, not executed", async () => {
  const w = await world();
  await create(w);
  const msg = w.queue.msgs.shift()!.msg;
  // simulate another consumer holding the lease
  w.db.prepare("UPDATE evaluation_job_stages SET status = 'running', attempts = 1, lease_expires_at = ? WHERE job_id = 1 AND stage = 'stages_01_06'").run(new Date(w.clock.t + 300_000).toISOString());
  const o: any = await processJobMessage(w.deps, msg);
  assert.equal(o.action, "retry");
  assert.ok(o.delaySeconds >= 15);
  assert.equal(w.model.calls.length, 0);
});

test("retry after model failure: backoff is exponential, passes already done are not repeated, the job completes", async () => {
  const w = await world({ plan: (n) => (n === 2 ? "fail" : "ok") }); // second model call fails once
  await create(w);
  const out = await drain(w);
  const retries = out.filter((o) => o.action === "retry");
  assert.equal(retries.length, 1);
  assert.equal(retries[0].delaySeconds, 30);
  assert.equal(job(w).status, "completed");
  assert.equal(w.model.calls.length, 5); // 4 passes + 1 retried call
  assert.equal(w.model.calls.filter((c) => c.pass === "stages_01_06").length, 1); // the finished pass was not repeated
  assert.equal(stage(w, "stages_07_12").attempts, 2);
  assert.equal(backoffSeconds(1), 30);
  assert.equal(backoffSeconds(2), 60);
  assert.equal(backoffSeconds(10), 900);
});

test("job status shows retrying with the preserved passes while a retry is pending", async () => {
  const w = await world({ plan: (n) => (n === 2 ? "fail" : "ok") });
  await create(w);
  await drain(w, { stopWhen: () => w.queue.msgs.length > 0 && w.model.calls.length === 2 });
  const s: any = await getJobStatus(w.deps, 1);
  assert.equal(s.job.status, "retrying");
  assert.match(s.summary, /Retrying stages_07_12 \(attempt 1\): model_error\. 1 of 4 passes preserved\./);
});

test("retry after D1 failure on stage completion: the stage is redone and the job still completes", async () => {
  const w = await world({ jobFaults: { completeStage: 1 } });
  await create(w);
  const out = await drain(w);
  assert.ok(out.some((o) => o.action === "retry" && o.note === "unexpected_error"));
  assert.equal(job(w).status, "completed");
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 1);
});

test("retry after D1 failure while writing the evaluation: nothing partial is stored and the retry writes it once", async () => {
  const w = await world({ storeFaults: { saveEvaluation: 1 } });
  await create(w);
  const out = await drain(w);
  assert.ok(out.some((o) => o.action === "retry" && o.note === "persist_failed"));
  assert.equal(job(w).status, "completed");
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 1);
  assert.equal(w.model.calls.length, 4); // finalize retried without calling the model again
});

test("worker termination: a stage left 'running' is not stolen before its lease expires and is recovered afterwards", async () => {
  const w = await world();
  await create(w);
  // a worker claims the first stage and dies before completing it
  const store = createD1JobStore(d1(w.db));
  await store.claimStage(1, "stages_01_06", new Date(w.clock.t).toISOString(), new Date(w.clock.t + 600_000).toISOString());
  const early: any = await processJobMessage(w.deps, w.queue.msgs.shift()!.msg);
  assert.equal(early.action, "retry");
  assert.equal(w.model.calls.length, 0);
  w.clock.t += 601_000; // lease expired
  w.queue.msgs.push({ msg: { v: 1, job_id: 1, stage: "stages_01_06" }, delay: 0 });
  await drain(w);
  assert.equal(job(w).status, "completed");
  assert.equal(stage(w, "stages_01_06").attempts, 2);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 1);
});

test("invalid JSON from the model: retried up to the stage limit, then the job stops as retry-eligible with a safe error code", async () => {
  const w = await world({ plan: () => "badjson" });
  await create(w);
  const out = await drain(w);
  assert.equal(w.model.calls.length, 3); // maxStageAttempts = 3, one model call per attempt in this test
  assert.equal(job(w).status, "failed");
  assert.equal(job(w).last_error_code, "malformed_json");
  assert.equal(job(w).retry_eligible, 1);
  assert.equal(out.filter((o) => o.action === "retry").length, 2);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 0);
  assert.ok(!String(job(w).last_error).includes("this is not json")); // raw model text never lands in the error
});

test("truncated model output is not retried: the job stops immediately with code 'truncated'", async () => {
  const w = await world({ plan: (n) => (n === 1 ? "truncate" : "ok") });
  await create(w);
  const out = await drain(w);
  assert.equal(w.model.calls.length, 1);
  assert.equal(out.filter((o) => o.action === "retry").length, 0);
  assert.equal(job(w).status, "failed");
  assert.equal(job(w).last_error_code, "truncated");
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 0);
});

test("partial completion is preserved and a manual retry resumes without repeating finished passes", async () => {
  // passes 1 and 2 succeed; pass 3 returns truncated output
  const w = await world({ plan: (n) => (n === 3 ? "truncate" : "ok") });
  await create(w);
  await drain(w);
  assert.equal(job(w).status, "partially_completed");
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluation_job_stages WHERE status = 'completed' AND stage LIKE 'stages_%'"), 2);
  const s: any = await getJobStatus(w.deps, 1);
  assert.match(s.summary, /2 of 4 passes preserved\. Retry will resume without repeating them\./);
  assert.ok(stage(w, "stages_01_06").raw_output.length > 100);
  const before = w.model.calls.length;
  const r: any = await retryJob(w.deps, 1);
  assert.equal(r.ok, true);
  assert.deepEqual(w.queue.msgs.map((m) => m.msg.stage), ["stages_13_19"]);
  await drain(w);
  assert.equal(job(w).status, "completed");
  assert.deepEqual(w.model.calls.slice(before).map((c) => c.pass), ["stages_13_19", "psychology_report"]); // only the unfinished passes ran
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 1);
});

test("a job that cannot be retried (completed, or not retry-eligible) is refused", async () => {
  const w = await world();
  await create(w);
  await drain(w);
  assert.equal(((await retryJob(w.deps, 1)) as any).ok, false);
  assert.equal(((await cancelJob(w.deps, 1, "x")) as any).ok, false);
});

test("poison message: a stage beyond its attempt limit stops the job instead of looping", async () => {
  const w = await world({ maxStageAttempts: 2 });
  await create(w);
  w.db.prepare("UPDATE evaluation_job_stages SET attempts = 2 WHERE job_id = 1 AND stage = 'stages_01_06'").run();
  const out = await drain(w);
  assert.equal(job(w).status, "failed");
  assert.equal(job(w).last_error_code, "max_attempts_exceeded");
  assert.equal(w.model.calls.length, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].action, "ack");
});

test("unknown job, unknown stage and closed jobs are acknowledged and do nothing", async () => {
  const w = await world();
  assert.equal(((await processJobMessage(w.deps, { v: 1, job_id: 99, stage: "stages_01_06" })) as any).note, "unknown_job");
  await create(w);
  assert.equal(((await processJobMessage(w.deps, { v: 1, job_id: 1, stage: "bogus" as any })) as any).note, "invalid_stage");
  assert.equal(((await processJobMessage(w.deps, { v: 1, job_id: 1, stage: "gate" })) as any).note, "invalid_stage");
  assert.equal(w.model.calls.length, 0);
});

test("operator cancellation mid-run: remaining messages do nothing and no evaluation is published", async () => {
  const w = await world();
  await create(w);
  await drain(w, { stopWhen: () => w.model.calls.length === 2 });
  assert.equal(((await cancelJob(w.deps, 1, "operator stopped it")) as any).ok, true);
  await drain(w);
  assert.equal(job(w).status, "cancelled");
  assert.equal(w.model.calls.length, 2);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 0);
});

test("call type changed while the job runs: the job is invalidated, nothing is published, a re-confirmation of the same type is harmless", async () => {
  const w = await world();
  await create(w);
  await drain(w, { stopWhen: () => w.model.calls.length === 1 });
  // same type re-confirmed by a human: not stale
  w.db.prepare("UPDATE call_type_labels SET superseded_at = datetime('now') WHERE call_id = 1 AND superseded_at IS NULL").run();
  w.db.prepare("INSERT INTO call_type_labels (call_id, business_call_type, verification, labelled_by, basis) VALUES (1, 'new_webinar_prospect', 'human_confirmed', 'Owner', 'again')").run();
  await drain(w, { stopWhen: () => w.model.calls.length === 2 });
  assert.equal(job(w).status, "running");
  // changed type
  w.db.prepare("UPDATE call_type_labels SET superseded_at = datetime('now') WHERE call_id = 1 AND superseded_at IS NULL").run();
  w.db.prepare("INSERT INTO call_type_labels (call_id, business_call_type, verification, labelled_by, basis) VALUES (1, 'renewal', 'human_confirmed', 'Owner', 'changed')").run();
  await drain(w);
  assert.equal(job(w).status, "invalidated");
  assert.equal(job(w).last_error_code, "call_type_changed");
  assert.equal(w.model.calls.length, 2);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 0);
  assert.equal(((await retryJob(w.deps, 1)) as any).ok, false); // an invalidated job is not resumed
  // the re-evaluation is a new job (the old one is closed): it is now an unsupported type, recorded without a model
  const again: any = await create(w);
  assert.equal(again.status, "rejected");
  assert.equal(again.result.status, "unsupported");
});

test("call type changed after the last check but before completion is caught: the saved evaluation is superseded and the job is invalidated", async () => {
  const w = await world();
  const base = w.deps.mrv1.store;
  const realSave = base.saveEvaluation;
  // the type changes while the evaluation is being written
  w.deps.mrv1.store = { saveEvaluation: async (doc: any, ex: any) => {
    const id = await realSave(doc, ex);
    w.db.prepare("UPDATE call_type_labels SET superseded_at = datetime('now') WHERE call_id = 1 AND superseded_at IS NULL").run();
    w.db.prepare("INSERT INTO call_type_labels (call_id, business_call_type, verification, labelled_by, basis) VALUES (1, 'continuation', 'human_confirmed', 'Owner', 'raced')").run();
    return id;
  }, getActiveCallTypeLabel: (id: number) => base.getActiveCallTypeLabel(id), loadCall: (c: string) => base.loadCall(c), loadTranscript: (a: number, b: string) => base.loadTranscript(a, b), findEvaluation: (a: number, b: string, c: string) => base.findEvaluation(a, b, c) };
  await create(w);
  await drain(w);
  assert.equal(job(w).status, "invalidated");
  assert.equal(job(w).last_error_code, "call_type_changed");
  assert.equal(w.count("SELECT COUNT(*) AS n FROM valid_evaluations"), 0); // never left valid
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 1); // kept for audit
  assert.equal((w.db.prepare("SELECT status FROM evaluation_invalidations").get() as any).status, "superseded");
});

test("evaluation invalidated during processing never becomes a completed job", async () => {
  const w = await world();
  const base = w.deps.mrv1.store;
  const realSave = base.saveEvaluation;
  w.deps.mrv1.store = { saveEvaluation: async (doc: any, ex: any) => {
    const id = await realSave(doc, ex);
    w.db.prepare("INSERT INTO evaluation_invalidations (evaluation_id, status, reason, invalidated_by) VALUES (?, 'invalidated', 'human invalidated it', 'Owner')").run(id);
    return id;
  }, getActiveCallTypeLabel: (id: number) => base.getActiveCallTypeLabel(id), loadCall: (c: string) => base.loadCall(c), loadTranscript: (a: number, b: string) => base.loadTranscript(a, b), findEvaluation: (a: number, b: string, c: string) => base.findEvaluation(a, b, c) };
  await create(w);
  await drain(w);
  assert.equal(job(w).status, "invalidated");
  assert.equal(job(w).last_error_code, "evaluation_invalidated_during_processing");
  assert.equal(w.count("SELECT COUNT(*) AS n FROM valid_evaluations"), 0);
});

test("redelivered finalize after the evaluation was written completes the job without a duplicate evaluation", async () => {
  const w = await world({ jobFaults: { setJobStatus: 0 } });
  await create(w);
  await drain(w, { stopWhen: () => w.queue.msgs.length === 1 && w.queue.msgs[0].msg.stage === "finalize" });
  // finalize runs and writes the evaluation, but the worker dies before the job is marked completed
  const realSet = w.deps.jobs.setJobStatus;
  let crashed = false;
  w.deps.jobs = new Proxy(w.deps.jobs, { get: (t: any, p: string) => (p === "setJobStatus" ? async (id: number, now: string, patch: any) => { if (patch.status === "completed" && !crashed) { crashed = true; throw new Error("worker died"); } return realSet.call(t, id, now, patch); } : t[p]) });
  await drain(w);
  assert.equal(job(w).status, "completed");
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 1);
  assert.equal(job(w).evaluation_id, 1);
});

test("held, unknown and unsupported calls never create a job; unsupported is recorded without any model call", async () => {
  const w = await world();
  w.db.prepare("UPDATE call_type_labels SET business_call_type = 'renewal' WHERE call_id = 1").run();
  const r: any = await create(w);
  assert.equal(r.status, "rejected");
  assert.equal(r.result.status, "unsupported");
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluation_jobs"), 0);
  assert.equal(w.model.calls.length, 0);
  const w2 = await world();
  w2.db.prepare("DELETE FROM call_type_labels").run();
  const r2: any = await create(w2);
  assert.equal(r2.status, "rejected");
  assert.equal(r2.result.status, "hold");
  assert.equal(r2.result.gate, 3);
  const w3 = await world();
  w3.db.prepare("UPDATE calls SET audio_size_bytes = 1000").run();
  assert.equal(((await create(w3)) as any).result.gate, 1);
});

test("continuation: stages that do not apply are skipped and the job still completes", async () => {
  const w = await world();
  w.db.prepare("UPDATE call_type_labels SET business_call_type = 'continuation' WHERE call_id = 1").run();
  await create(w);
  await drain(w);
  assert.equal(job(w).status, "completed");
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluation_criteria WHERE outcome = 'N/A' AND reason_code = 'call_type_not_covered'"), 9);
});

test("enqueue failure after job creation marks the job retry-eligible; retrying resumes it", async () => {
  const w = await world();
  w.queue.failSends = 1;
  const r: any = await create(w);
  assert.equal(r.status, "enqueue_failed");
  assert.equal(job(w).status, "failed");
  assert.equal(job(w).last_error_code, "enqueue_failed");
  assert.equal(job(w).retry_eligible, 1);
  const rr: any = await retryJob(w.deps, 1);
  assert.equal(rr.ok, true);
  await drain(w);
  assert.equal(job(w).status, "completed");
});

test("a transcript that needs human review stops the job for a human, and resumes after an explicit acknowledgement", async () => {
  const w = await world();
  // 80 s hole in the middle: acceptable silence needs review (gate decision requires_human_review)
  const long: any[] = [];
  for (let i = 0; i < 60; i++) {
    const startAt = i < 30 ? i * 8 : 330 + (i - 30) * 8.8;
    long.push({ start: startAt, end: startAt + 7, text: Array.from({ length: 10 }, (_, j) => `w${i}x${j}`).join(" ").replace(/\d/g, (d) => "abcdefghij"[Number(d)]) });
  }
  w.db.prepare("UPDATE transcripts SET segments_json = ?").run(JSON.stringify({ segments: long, transcription_info: { language: "en" } }));
  const held: any = await create(w);
  assert.equal(held.status, "rejected");
  assert.equal(held.result.decision, "requires_human_review");
  const ok: any = await create(w, { acknowledgeTranscriptReview: true });
  assert.equal(ok.status, "queued");
});

test("the pipeline never runs a Google Sheets export and never creates export records", async () => {
  const w = await world();
  await create(w);
  await drain(w, { duplicate: true });
  assert.equal(w.count("SELECT COUNT(*) AS n FROM sheet_exports"), 0);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM sheet_export_rows"), 0);
  // the export store sees exactly one valid evaluation, so a later controlled export cannot produce duplicates
  assert.equal((await createD1ExportStore(d1(w.db)).loadRecords({})).length, 1);
  // static guarantee: no pipeline source file refers to the sheets integration
  for (const f of ["service.ts", "d1-job-store.ts", "types.ts"]) assert.ok(!/sheets/i.test(readFileSync(`src/mrv1/jobs/${f}`, "utf8").replace(/Google Sheets export|sheets export|Sheets export/g, "")), f);
});

test("logs and queue messages carry identifiers and codes only, never transcript text, prompts or model output", async () => {
  const w = await world({ plan: (n) => (n === 2 ? "fail" : "ok") });
  await create(w);
  await drain(w);
  const blob = JSON.stringify([w.logs, w.queue.sent]);
  for (const s of SEGMENTS) assert.ok(!blob.includes(s.text), "transcript text leaked");
  assert.ok(!blob.includes("criteria"));
  assert.ok(!/system|prompt|raw_output/i.test(JSON.stringify(w.queue.sent)));
  assert.ok(w.logs.length > 5);
  assert.ok(w.logs.every((l) => l.component === "mrv1-jobs" && typeof l.event === "string"));
});

test("one active job per call: a second revision cannot start while one is in flight; after invalidation a new revision gets a new job", async () => {
  const w = await world();
  await create(w);
  await drain(w);
  w.db.prepare("INSERT INTO evaluation_invalidations (evaluation_id, status, reason, invalidated_by) VALUES (1, 'superseded', 'r', 'x')").run();
  const again: any = await create(w);
  assert.equal(again.status, "queued");
  assert.equal(again.job.prompt_version, "mrv1-prompt-v2#r2");
  const third: any = await create(w);
  assert.equal(third.status, "existing_job");
  await drain(w);
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 2); // history kept
  assert.equal(w.count("SELECT COUNT(*) AS n FROM valid_evaluations"), 1);
});

test("migration 0007 is additive and the job tables enforce idempotency in SQL", async () => {
  const w = await world();
  await create(w);
  assert.throws(() => w.db.prepare("INSERT INTO evaluation_jobs (call_id, callyzer_call_id, rubric_version, prompt_version, idempotency_key, transcript_source, transcript_sha256, call_type_label, call_type_labelled_at, status, created_at, updated_at) VALUES (1,'CY-7','MRV1.0','mrv1-prompt-v2','1:MRV1.0:mrv1-prompt-v2','production','x','new_webinar_prospect','t','queued','t','t')").run(), /UNIQUE/i);
  assert.throws(() => w.db.prepare("INSERT INTO evaluation_jobs (call_id, callyzer_call_id, rubric_version, prompt_version, idempotency_key, transcript_source, transcript_sha256, call_type_label, call_type_labelled_at, status, created_at, updated_at) VALUES (1,'CY-7','MRV1.0','other','other','production','x','new_webinar_prospect','t','queued','t','t')").run(), /UNIQUE/i); // second active job for the call
  assert.throws(() => w.db.prepare("UPDATE evaluation_jobs SET status = 'bogus'").run(), /CHECK/i);
  const sql = readFileSync("migrations/0007_mrv1_durable_jobs.sql", "utf8");
  assert.ok(!/\b(DROP\s|ALTER\s+TABLE|DELETE\s+FROM|UPDATE\s)/i.test(sql.replace(/--.*$/gm, ""))); // ON DELETE CASCADE on the new tables only
  assert.equal(w.count("SELECT COUNT(*) AS n FROM evaluations"), 0);
});
