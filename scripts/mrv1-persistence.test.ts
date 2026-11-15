// Persistence and export tests against a real SQLite database (node:sqlite) with the project's actual migrations 0001-0006.
// A thin adapter gives SQLite the D1 prepare/bind/run/all/first/batch surface used by the stores. No Cloudflare, no network, no real calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createMrv1Store } from "../src/mrv1/d1-store.ts";
import { recordCallTypeLabel, recordReview, invalidateEvaluation } from "../src/evaluation/d1-store.ts";
import { runMrv1Evaluation } from "../src/mrv1/engine.ts";
import { createD1ExportStore } from "../src/sheets/d1-export-store.ts";
import { buildAgentRow } from "../src/sheets/rows.ts";
import { AUDIO_BYTES, CALL_SECONDS, SEGMENTS, fakeModel } from "./mrv1-fixtures.ts";

function d1(db: DatabaseSync): any {
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt: any = {
      bind: (...b: unknown[]) => {
        binds = b;
        return stmt;
      },
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
function migrate(db: DatabaseSync, upTo?: string) {
  for (const f of MIGRATIONS) {
    if (upTo && f > upTo) break;
    db.exec(readFileSync(`migrations/${f}`, "utf8"));
  }
}

function seed(db: DatabaseSync) {
  db.exec(`INSERT INTO sales_agents (employee_number, employee_name) VALUES ('900', 'test agent')`);
  db.prepare(`INSERT INTO calls (callyzer_call_id, sales_agent_id, call_date, duration_seconds, call_type, r2_object_key, audio_size_bytes, processing_status) VALUES ('CY-7', 1, '2026-11-01', ?, 'Outgoing', 'k', ?, 'transcribed')`).run(CALL_SECONDS, AUDIO_BYTES);
  const segs = SEGMENTS.map((s) => ({ start: s.start, end: s.end, text: s.text }));
  db.prepare(`INSERT INTO transcripts (call_id, transcription_model, language, transcript_text, transcription_status, segments_json) VALUES (1, 'whisper', 'en', 't', 'completed', ?)`).run(JSON.stringify({ segments: segs, transcription_info: { language: "en" } }));
}
const label = (db: DatabaseSync, type: string) => db.prepare(`INSERT INTO call_type_labels (call_id, business_call_type, verification, labelled_by, basis) VALUES (1, ?, 'human_confirmed', 'Owner', 'booking record')`).run(type);
const count = (db: DatabaseSync, sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any).n as number;

test("migration 0006 is additive: existing evaluation, criteria and review rows are preserved unchanged", () => {
  const db = new DatabaseSync(":memory:");
  migrate(db, "0005_sheet_exports.sql");
  seed(db);
  db.exec(`INSERT INTO evaluations (call_id, rubric_version, prompt_version, model_id, evaluated_at, transcript_source, transcript_sha256, call_type_label, call_type_labelled_by, applicability_status, result_json, human_review_status)
           VALUES (1, 'evaluation-rubric-v1-rev4-c01-c02', 'eval-prompt-v2', 'm', '2026-11-14', 'production', 'h', 'continuation', 'Owner', 'not_applicable', '{}', 'approved')`);
  db.exec(`INSERT INTO evaluation_criteria (evaluation_id, category_id, category_name, criterion_id, criterion_name, outcome, score, applicable_status, elements_met_json, elements_missing_json, elements_late_json, elements_not_observable_json, element_details_json, evidence_json, evidence_confidence, explanation, human_review_flags_json)
           VALUES (1, 'C01', 'Introduction', 'C01-01', 'x', 'N/A', NULL, 'not_applicable', '[]','[]','[]','[]','[]','[]','high','e','[]')`);
  db.exec(`INSERT INTO evaluation_reviews (evaluation_id, reviewer, status, comment) VALUES (1, 'R', 'approved', 'ok')`);
  const before = { e: db.prepare("SELECT * FROM evaluations").all(), c: db.prepare("SELECT outcome, score, explanation FROM evaluation_criteria").all(), r: db.prepare("SELECT * FROM evaluation_reviews").all() };
  db.exec(readFileSync("migrations/0006_mrv1_evaluation_engine.sql", "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM evaluations").all(), before.e);
  assert.deepEqual(db.prepare("SELECT outcome, score, explanation FROM evaluation_criteria").all(), before.c);
  assert.deepEqual(db.prepare("SELECT * FROM evaluation_reviews").all(), before.r);
  const old = db.prepare("SELECT improvement_recommendation, criterion_review_status FROM evaluation_criteria").get() as any;
  assert.equal(old.improvement_recommendation, null);
  assert.equal(old.criterion_review_status, "pending");
  const rv = db.prepare("SELECT * FROM rubric_versions").get() as any;
  assert.equal(rv.version, "MRV1.0");
  assert.equal(rv.category_count, 19);
  assert.equal(rv.criteria_count, 70);
  assert.equal(rv.psychology_criteria_count, 22);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM valid_evaluations"), 1);
});

async function evaluate(db: DatabaseSync, model = fakeModel()) {
  return runMrv1Evaluation({ store: createMrv1Store(d1(db)), model }, { callyzerCallId: "CY-7" });
}

test("an MRV1.0 evaluation is stored criterion-by-criterion, with the Sales Psychology scorecard kept separate", async () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seed(db);
  label(db, "new_webinar_prospect");
  const r: any = await evaluate(db, fakeModel({ policy: (id) => (id === "C03-02" ? { outcome: "N/A", reason_code: "prospect_has_no_business" } : undefined) }));
  assert.equal(r.status, "completed", JSON.stringify(r).slice(0, 300));
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluation_criteria WHERE evaluation_id = ?", r.evaluation_id), 70);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluation_sp_criteria WHERE evaluation_id = ?", r.evaluation_id), 22);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluation_criteria WHERE criterion_id LIKE 'SP-%'"), 0);
  const ev = db.prepare("SELECT rubric_version, prompt_version, model_id, human_review_status, applicability_status FROM evaluations").get() as any;
  assert.deepEqual({ ...ev }, { rubric_version: "MRV1.0", prompt_version: "mrv1-prompt-v2", model_id: "fake-model", human_review_status: "pending", applicability_status: "evaluated" });
  // N/A and NE are stored as outcomes with a NULL score, never as a numeric zero
  const na = db.prepare("SELECT outcome, score, reason_code FROM evaluation_criteria WHERE criterion_id = 'C03-02'").get() as any;
  assert.deepEqual({ ...na }, { outcome: "N/A", score: null, reason_code: "prospect_has_no_business" });
  const ne = db.prepare("SELECT outcome, score FROM evaluation_criteria WHERE criterion_id = 'C01-01'").get() as any;
  assert.deepEqual({ ...ne }, { outcome: "NE", score: null });
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluation_criteria WHERE outcome IN ('N/A','NE') AND score = 0"), 0);
  // scores table has no combined column
  const cols = (db.prepare("PRAGMA table_info(evaluation_scores)").all() as any[]).map((c) => c.name);
  assert.ok(!cols.some((c) => /combined|total|overall/.test(c)));
  const s = db.prepare("SELECT * FROM evaluation_scores").get() as any;
  assert.equal(s.sales_stage_status, "provisional");
  assert.ok(Math.abs(s.psychology_percent - (2 / 3) * 100) < 1e-9);
  const rep = db.prepare("SELECT status, report_json FROM evaluation_reports").get() as any;
  assert.equal(rep.status, "generated");
  assert.equal(JSON.parse(rep.report_json).sections.length, 14);
  assert.equal((db.prepare("SELECT processing_status FROM calls").get() as any).processing_status, "evaluated");
  // duplicate request is idempotent
  const again: any = await evaluate(db);
  assert.equal(again.status, "exists");
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluations"), 1);
});

test("critical flags are stored with a pending human decision", async () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seed(db);
  label(db, "new_webinar_prospect");
  const flags = [{ flag_id: "fake_urgency", severity: "medium", interpretation: "confirmed_conduct", segments: [10], quote: SEGMENTS[10].text, explanation: "Imposed a deadline." }];
  const r: any = await evaluate(db, fakeModel({ flags }));
  assert.equal(r.status, "completed");
  const f = db.prepare("SELECT flag_id, severity, evidence_quote, verification_status, human_decision, start_s FROM evaluation_flags").get() as any;
  assert.deepEqual({ ...f }, { flag_id: "fake_urgency", severity: "medium", evidence_quote: SEGMENTS[10].text, verification_status: "quote_verified", human_decision: "pending", start_s: SEGMENTS[10].start });
});

test("a failed or partial evaluation leaves nothing behind", async () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seed(db);
  label(db, "new_webinar_prospect");
  const r: any = await evaluate(db, fakeModel({ text: (pass) => (pass === "psychology_report" ? "{ broken" : undefined) }));
  assert.equal(r.status, "failed");
  for (const t of ["evaluations", "evaluation_criteria", "evaluation_sp_criteria", "evaluation_scores", "evaluation_flags", "evaluation_reports"]) assert.equal(count(db, `SELECT COUNT(*) AS n FROM ${t}`), 0, t);
  assert.equal((db.prepare("SELECT processing_status FROM calls").get() as any).processing_status, "transcribed");
});

test("invalidated and test-only evaluations are excluded from the valid views and from the export", async () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seed(db);
  label(db, "new_webinar_prospect");
  const r: any = await evaluate(db);
  const store = createD1ExportStore(d1(db));
  assert.equal((await store.loadRecords({})).length, 1);
  assert.ok((await store.validEvaluationIds()).has(r.evaluation_id));
  for (const status of ["test_only", "invalidated"]) {
    db.exec("DELETE FROM evaluation_invalidations");
    db.prepare("INSERT INTO evaluation_invalidations (evaluation_id, status, reason, invalidated_by) VALUES (?, ?, 'r', 'me')").run(r.evaluation_id, status);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM valid_evaluations"), 0, status);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM valid_evaluation_criteria"), 0, status);
    assert.equal((await store.loadRecords({})).length, 0, status);
    assert.equal((await store.validEvaluationIds()).size, 0, status);
  }
  // the evaluation row itself is never deleted
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluations"), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluation_criteria"), 70);
  // re-evaluation after invalidation uses a new revision and never overwrites the invalidated record
  const again: any = await evaluate(db);
  assert.equal(again.status, "completed");
  assert.equal(again.document.metadata.prompt_version, "mrv1-prompt-v2#r2");
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluations"), 2);
});

test("changing the human-confirmed call type invalidates affected evaluations and requires re-evaluation", async () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seed(db);
  label(db, "new_webinar_prospect");
  const first: any = await evaluate(db);
  assert.equal(first.status, "completed");
  // same type re-confirmed: nothing invalidated
  await recordCallTypeLabel(d1(db), 1, { callType: "new_webinar_prospect", verification: "human_confirmed", labelledBy: "Owner", basis: "again" } as any);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluation_invalidations"), 0);
  // changed type: invalidated (superseded), kept for audit, status reverted
  await recordCallTypeLabel(d1(db), 1, { callType: "continuation", verification: "human_confirmed", labelledBy: "Owner", basis: "customer said this was the second call" } as any);
  const inv = db.prepare("SELECT evaluation_id, status, reason FROM evaluation_invalidations").get() as any;
  assert.equal(inv.status, "superseded");
  assert.match(inv.reason, /new_webinar_prospect to continuation/);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM valid_evaluations"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluations"), 1);
  assert.equal((db.prepare("SELECT processing_status FROM calls").get() as any).processing_status, "transcribed");
  // re-evaluation under the new type: C01/C02 are N/A
  const second: any = await evaluate(db);
  assert.equal(second.status, "completed");
  assert.equal(second.document.sales_stage.filter((c: any) => c.outcome === "N/A" && c.reason_code === "call_type_not_covered").length, 9);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM valid_evaluations"), 1);
  // a third change to an unsupported type invalidates again and a re-run records the unsupported result for human review
  await recordCallTypeLabel(d1(db), 1, { callType: "renewal", verification: "human_confirmed", labelledBy: "Owner", basis: "renewal list" } as any);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM valid_evaluations"), 0);
  const third: any = await evaluate(db);
  assert.equal(third.status, "unsupported");
  const u = db.prepare("SELECT applicability_status, applicability_reason, human_review_status FROM valid_evaluations").get() as any;
  assert.deepEqual({ ...u }, { applicability_status: "not_applicable", applicability_reason: "unsupported_call_type", human_review_status: "pending" });
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluation_criteria WHERE evaluation_id = ?", third.evaluation_id), 0);
});

test("human review status is preserved across re-runs and appears in the export; N/A and NE are never exported as zero", async () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seed(db);
  label(db, "new_webinar_prospect");
  const r: any = await evaluate(db);
  const rv = await recordReview(d1(db), { evaluationId: r.evaluation_id, status: "approved", reviewer: "Manager", comment: "Checked" } as any);
  assert.equal(rv.ok, true);
  const again: any = await evaluate(db);
  assert.equal(again.status, "exists");
  assert.equal(again.human_review_status, "approved");
  const recs = await createD1ExportStore(d1(db)).loadRecords({});
  assert.equal(recs[0].human_review_status, "approved");
  assert.equal(recs[0].reviewer, "Manager");
  const row = buildAgentRow(recs[0]);
  assert.equal(row[11], "approved");
  assert.equal(row[13], "Manager");
  // the sheet score is the equal-weight category average over all 19 categories; NE is never a zero
  assert.equal(row[7], "66.7% (provisional)"); // C01/C02 are NE in this fixture, the other 17 categories are 2/3
  assert.equal(row[10], "Provisional");
  assert.ok(recs[0].criteria.some((c) => c.outcome === "NE" && c.score === null));
  assert.ok(recs[0].criteria.every((c) => !((c.outcome === "N/A" || c.outcome === "NE") && c.score === 0)));
});

test("a recorded invalidation can still be made through the existing invalidate path", async () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seed(db);
  label(db, "new_webinar_prospect");
  const r: any = await evaluate(db);
  const x: any = await invalidateEvaluation(d1(db), { evaluationId: r.evaluation_id, status: "invalidated", reason: "test", by: "me" } as any);
  assert.equal(x.ok, true);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM valid_evaluations"), 0);
});

test("flag-capped scores are stored with their audit trail, survive invalidation, and re-evaluation applies the rules again on a new revision", async () => {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  seed(db);
  label(db, "new_webinar_prospect");
  const flags = [{ flag_id: "false_earnings_promise", severity: "high", interpretation: "confirmed_conduct", segments: [3], quote: SEGMENTS[3].text, explanation: "Promised income." }];
  const model = () => fakeModel({ flags, policy: (id) => (id === "C15-03" ? { outcome: "3", seg: 3 } : undefined) });
  const first: any = await runMrv1Evaluation({ store: createMrv1Store(d1(db)), model: model() }, { callyzerCallId: "CY-7" });
  assert.equal(first.status, "completed");
  const row = db.prepare("SELECT outcome, score, model_original_outcome FROM evaluation_criteria WHERE criterion_id = 'C15-03'").get() as any;
  assert.deepEqual({ ...row }, { outcome: "1", score: 1, model_original_outcome: "3" });
  assert.equal((JSON.parse((db.prepare("SELECT validation_json FROM evaluations").get() as any).validation_json).adjustments as any[]).filter((a) => a.kind === "flag_cap").length, 3); // C14-02, C15-03 and C19-02 all cite the flagged segment and are linked to false_earnings_promise
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluation_flags"), 1);
  await invalidateEvaluation(d1(db), { evaluationId: first.evaluation_id, status: "invalidated", reason: "test", by: "me" } as any);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM valid_evaluations"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluation_flags"), 1); // flags and criteria are kept for audit
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluation_criteria WHERE model_original_outcome = '3'"), 1);
  const again: any = await runMrv1Evaluation({ store: createMrv1Store(d1(db)), model: model() }, { callyzerCallId: "CY-7" });
  assert.equal(again.document.metadata.prompt_version, "mrv1-prompt-v2#r2");
  assert.equal(again.document.sales_stage.find((c: any) => c.criterion_id === "C15-03").outcome, "1");
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM valid_evaluations"), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluation_flags"), 2);
});