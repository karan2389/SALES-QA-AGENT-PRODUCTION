// D1 side of the Google Sheets export. Reads ONLY from valid_evaluations / valid_evaluation_criteria (test-only and invalidated
// evaluations never appear) and records what was written in sheet_exports / sheet_export_rows.
import type { AgentRef, ExportStore, RunCounts, TrackEntry, TrackedRow } from "./export.ts";
import type { ExportCriterion, ExportFlag, ExportRecord, SummaryStat } from "./rows.ts";

export function createD1ExportStore(db: D1Database): ExportStore {
  return {
    async listAgents() {
      const r = await db.prepare("SELECT id, employee_name AS name FROM sales_agents ORDER BY id").all<AgentRef>();
      return r.results;
    },

    async loadRecords(filter) {
      // Unsupported-call-type records have no normal evaluation and are never exported (gate 7).
      const where: string[] = ["NOT (e.applicability_status = 'not_applicable' AND e.applicability_reason = 'unsupported_call_type')"];
      const binds: unknown[] = [];
      if (filter.agentId !== undefined) {
        where.push("a.id = ?");
        binds.push(filter.agentId);
      }
      if (filter.evaluationId !== undefined) {
        where.push("e.id = ?");
        binds.push(filter.evaluationId);
      }
      const evSql = `
        SELECT e.id AS evaluation_id, c.callyzer_call_id AS call_ext_id, a.id AS agent_id, a.employee_name AS agent_name,
               c.call_date, c.duration_seconds, c.call_type AS direction, e.call_type_label,
               e.human_review_status, e.coaching_json, e.applicability_reason, e.transcript_reliability, e.rubric_version, e.applicability_status,
               (SELECT json_group_array(json_object('i', s.key, 's', json_extract(s.value, '$.start'), 't', json_extract(s.value, '$.text')))
                  FROM json_each(COALESCE(x.segments_json, t.segments_json), '$.segments') s) AS transcript_segments_json,
               r.reviewer, r.comment AS review_comment, r.created_at AS reviewed_at
        FROM valid_evaluations e
        JOIN calls c ON c.id = e.call_id
        JOIN sales_agents a ON a.id = c.sales_agent_id
        LEFT JOIN transcripts t ON t.id = (SELECT MIN(t2.id) FROM transcripts t2 WHERE t2.call_id = e.call_id AND t2.transcription_status = 'completed')
        LEFT JOIN transcription_experiments x ON x.call_id = e.call_id AND e.transcript_source = 'experiment:' || x.label AND x.transcription_status = 'completed'
        LEFT JOIN evaluation_reviews r ON r.id = (SELECT MAX(r2.id) FROM evaluation_reviews r2 WHERE r2.evaluation_id = e.id)
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY e.id`;
      const evs = await db.prepare(evSql).bind(...binds).all<Omit<ExportRecord, "criteria" | "state"> & { transcript_reliability: string | null; applicability_status: string }>();
      if (evs.results.length === 0) return [];
      const ids = evs.results.map((x) => x.evaluation_id);
      const crit = await db
        .prepare(
          `SELECT evaluation_id, category_id, criterion_id, criterion_name, outcome, score, applicable_status, reason_code, evidence_json, explanation
           FROM valid_evaluation_criteria WHERE evaluation_id IN (${ids.map(() => "?").join(",")}) ORDER BY evaluation_id, id`,
        )
        .bind(...ids)
        .all<ExportCriterion & { evaluation_id: number }>();
      const byEval = new Map<number, ExportCriterion[]>();
      for (const k of crit.results) (byEval.get(k.evaluation_id) ?? byEval.set(k.evaluation_id, []).get(k.evaluation_id)!).push(k);
      // MRV1.0 only (these tables exist once migration 0006 is applied; no MRV1.0 evaluation can exist before that).
      const mrvIds = evs.results.filter((x) => x.rubric_version === "MRV1.0").map((x) => x.evaluation_id);
      const spBy = new Map<number, ExportCriterion[]>();
      const flagBy = new Map<number, ExportFlag[]>();
      const blockedBy = new Set<number>();
      if (mrvIds.length > 0) {
        const ph = mrvIds.map(() => "?").join(",");
        const sp = await db.prepare(`SELECT evaluation_id, 'SP' AS category_id, criterion_id, criterion_name, outcome, score, applicable_status, reason_code, evidence_json, explanation FROM evaluation_sp_criteria WHERE evaluation_id IN (${ph}) ORDER BY evaluation_id, id`).bind(...mrvIds).all<ExportCriterion & { evaluation_id: number }>();
        for (const k of sp.results) (spBy.get(k.evaluation_id) ?? spBy.set(k.evaluation_id, []).get(k.evaluation_id)!).push(k);
        const fl = await db.prepare(`SELECT evaluation_id, flag_id, severity, interpretation, verification_status, human_decision, start_s, evidence_quote, explanation FROM evaluation_flags WHERE evaluation_id IN (${ph}) ORDER BY evaluation_id, id`).bind(...mrvIds).all<ExportFlag & { evaluation_id: number }>();
        for (const f of fl.results) (flagBy.get(f.evaluation_id) ?? flagBy.set(f.evaluation_id, []).get(f.evaluation_id)!).push(f);
        const sc = await db.prepare(`SELECT evaluation_id FROM evaluation_scores WHERE evaluation_id IN (${ph}) AND sales_stage_status = 'blocked'`).bind(...mrvIds).all<{ evaluation_id: number }>();
        for (const b of sc.results) blockedBy.add(b.evaluation_id);
      }
      return evs.results.map((x) => {
        const { transcript_reliability, applicability_status: _a, ...rest } = x;
        // Invalidated / test-only evaluations are not in the valid views at all. A transcript the model rated "low" (or, for MRV1.0, a gate that blocked it) blocks the number.
        const blocked = transcript_reliability === "low" || blockedBy.has(x.evaluation_id);
        return { ...rest, state: blocked ? ("blocked" as const) : ("valid" as const), criteria: byEval.get(x.evaluation_id) ?? [], psychology_criteria: spBy.get(x.evaluation_id), flags: flagBy.get(x.evaluation_id) };
      });
    },

    async validEvaluationIds() {
      const r = await db.prepare("SELECT id FROM valid_evaluations WHERE NOT (applicability_status = 'not_applicable' AND applicability_reason = 'unsupported_call_type')").all<{ id: number }>();
      return new Set(r.results.map((x) => x.id));
    },

    async loadSummaryStats() {
      const r = await db
        .prepare(
          `SELECT a.employee_name AS agent_name,
             (SELECT COUNT(DISTINCT c.id) FROM calls c JOIN transcripts t ON t.call_id = c.id AND t.transcription_status = 'completed' WHERE c.sales_agent_id = a.id) AS calls_processed,
             (SELECT COUNT(*) FROM valid_evaluations e JOIN calls c ON c.id = e.call_id WHERE c.sales_agent_id = a.id AND e.applicability_status = 'evaluated') AS eligible_evaluations,
             (SELECT COUNT(*) FROM valid_evaluations e JOIN calls c ON c.id = e.call_id WHERE c.sales_agent_id = a.id AND e.applicability_status = 'not_applicable') AS na_calls,
             (SELECT COUNT(*) FROM valid_evaluations e JOIN calls c ON c.id = e.call_id WHERE c.sales_agent_id = a.id AND e.applicability_status = 'evaluated' AND e.human_review_status IN ('pending','in_review')) AS pending_reviews,
             (SELECT COUNT(*) FROM valid_evaluations e JOIN calls c ON c.id = e.call_id WHERE c.sales_agent_id = a.id AND e.applicability_status = 'evaluated' AND e.human_review_status IN ('approved','changes_requested')) AS reviewed_evaluations
           FROM sales_agents a ORDER BY a.id`,
        )
        .all<SummaryStat>();
      return r.results;
    },

    async loadTrackedRows(worksheet) {
      const r = await db.prepare("SELECT evaluation_id, criterion_id, worksheet, row_number, status FROM sheet_export_rows WHERE worksheet = ?").bind(worksheet).all<TrackedRow>();
      return r.results;
    },

    async recordRows(entries: TrackEntry[], runId: number) {
      const stmt = db.prepare(
        `INSERT INTO sheet_export_rows (evaluation_id, criterion_id, worksheet, row_number, row_hash, status, last_error, last_exported_at, last_run_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'failed' THEN NULL ELSE datetime('now') END, ?)
         ON CONFLICT (evaluation_id, criterion_id, worksheet) DO UPDATE SET
           row_number = COALESCE(excluded.row_number, sheet_export_rows.row_number),
           row_hash = CASE WHEN excluded.status = 'failed' THEN sheet_export_rows.row_hash ELSE excluded.row_hash END,
           status = excluded.status,
           last_error = excluded.last_error,
           last_exported_at = CASE WHEN excluded.status = 'failed' THEN sheet_export_rows.last_exported_at ELSE excluded.last_exported_at END,
           last_run_id = excluded.last_run_id`,
      );
      for (let i = 0; i < entries.length; i += 50) {
        await db.batch(entries.slice(i, i + 50).map((e) => stmt.bind(e.evaluationId, e.criterionId, e.worksheet, e.rowNumber, e.rowHash, e.status, e.error ?? null, e.status, runId)));
      }
    },

    async startRun(scope: string) {
      // A 'running' row younger than 10 minutes blocks a concurrent export; older ones are treated as crashed runs.
      await db.prepare("UPDATE sheet_exports SET status = 'failed', finished_at = datetime('now'), error = 'abandoned (no completion recorded)' WHERE status = 'running' AND started_at < datetime('now','-10 minutes')").run();
      const active = await db.prepare("SELECT id FROM sheet_exports WHERE status = 'running'").first<{ id: number }>();
      if (active) return null;
      const r = await db.prepare("INSERT INTO sheet_exports (scope, status) VALUES (?, 'running')").bind(scope).run();
      return Number(r.meta.last_row_id);
    },

    async finishRun(runId: number, status: "success" | "partial" | "failed", counts: RunCounts, error: string | null) {
      await db
        .prepare("UPDATE sheet_exports SET status = ?, finished_at = datetime('now'), rows_appended = ?, rows_updated = ?, rows_skipped = ?, rows_withdrawn = ?, rows_failed = ?, error = ? WHERE id = ?")
        .bind(status, counts.appended, counts.updated, counts.skipped, counts.withdrawn, counts.failed, error, runId)
        .run();
    },
  };
}

