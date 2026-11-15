// D1 implementation of Mrv1Store. Reuses the existing evaluations / evaluation_criteria tables for the header and C01-C19 criteria and writes the
// MRV1.0-specific tables added by migration 0006. Nothing existing is altered or deleted.
import type { ActiveCallTypeLabel, LoadedTranscript, StoredEvaluationRef } from "../evaluation/evaluate.ts";
import { createD1Store } from "../evaluation/d1-store.ts";
import type { Mrv1CallInfo, Mrv1Store, SaveExtras } from "./engine.ts";
import { buildReport } from "./report.ts";
import type { Mrv1Document } from "./types.ts";

/** Coaching JSON in the shape the existing Google Sheets Feedback column already understands. */
export function coachingCompat(doc: Mrv1Document): string | null {
  const x = doc.extras;
  if (!x) return null;
  return JSON.stringify({
    key_strengths: x.strengths,
    missed_opportunities: x.missed_opportunities,
    improvement_recommendations: x.coaching_priorities.map((p) => ({ text: `${p.observed_issue} Action: ${p.recommended_action} Example: ${p.better_behaviour_example}`, segments: p.segments })),
    critical_flags: x.flags.map((f) => ({ flag: f.flag_id, explanation: f.explanation, segments: f.segments, quote: f.quote })),
    needs_human_verification: x.needs_human_verification,
  });
}

export function createMrv1Store(db: D1Database): Mrv1Store {
  const base = createD1Store(db);
  return {
    async loadCall(callyzerCallId: string): Promise<Mrv1CallInfo | null> {
      const r = await db.prepare("SELECT id, callyzer_call_id, sales_agent_id AS agent_id, duration_seconds, audio_size_bytes FROM calls WHERE callyzer_call_id = ?").bind(callyzerCallId).first<Mrv1CallInfo>();
      return r ?? null;
    },
    loadTranscript: (callId: number, source: string): Promise<LoadedTranscript | null> => base.loadTranscript(callId, source),
    getActiveCallTypeLabel: (callId: number): Promise<ActiveCallTypeLabel | null> => base.getActiveCallTypeLabel(callId),
    findEvaluation: (callId: number, rubricVersion: string, promptVersion: string): Promise<StoredEvaluationRef | null> => base.findEvaluation(callId, rubricVersion, promptVersion),

    async saveEvaluation(doc: Mrv1Document, extras: SaveExtras): Promise<number> {
      const m = doc.metadata;
      const evaluated = doc.applicability.status === "evaluated";
      const report = buildReport(doc);
      const idOf = "(SELECT id FROM evaluations WHERE call_id = ? AND rubric_version = ? AND prompt_version = ?)";
      const key = [m.call_id, m.rubric_version, m.prompt_version];
      const st: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO evaluations (call_id, rubric_version, prompt_version, model_id, evaluated_at, transcript_source, transcript_sha256,
               call_type_label, call_type_labelled_by, call_type_basis, applicability_status, applicability_reason, transcript_reliability,
               coaching_json, result_json, raw_model_output, usage_json, validation_json, human_review_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          )
          .bind(
            ...key, m.model_id, m.evaluated_at, m.transcript_source, m.transcript_sha256, doc.call_type.label, doc.call_type.labelled_by, doc.call_type.basis,
            doc.applicability.status, doc.applicability.reason_code, doc.transcript_assessment?.reliability ?? null, coachingCompat(doc), JSON.stringify(doc),
            extras.rawModelOutputs.length ? JSON.stringify(extras.rawModelOutputs) : null, extras.usage.length ? JSON.stringify(extras.usage) : null, JSON.stringify(doc.validation),
          ),
      ];
      for (const c of doc.sales_stage) {
        st.push(
          db
            .prepare(
              `INSERT INTO evaluation_criteria (evaluation_id, category_id, category_name, criterion_id, criterion_name, outcome, score, applicable_status, reason_code,
                 elements_met_json, elements_missing_json, elements_late_json, elements_not_observable_json, element_details_json, evidence_json, absence_record_json,
                 evidence_confidence, confidence_reason, explanation, human_review_flags_json, model_original_outcome, improvement_recommendation, criterion_review_status)
               VALUES (${idOf}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              ...key, c.category_id, c.category_name, c.criterion_id, c.criterion_name, c.outcome, c.score, c.applicable_status, c.reason_code,
              JSON.stringify(c.elements_met), JSON.stringify(c.elements_missing), JSON.stringify(c.elements_late), JSON.stringify(c.elements_not_observable),
              JSON.stringify(c.element_details), JSON.stringify(c.evidence), c.absence_record ? JSON.stringify(c.absence_record) : null,
              c.evidence_confidence, c.confidence_reason, c.explanation, JSON.stringify(c.human_review_flags), c.model_original_outcome, c.improvement_recommendation, c.review_status,
            ),
        );
      }
      for (const c of doc.psychology) {
        st.push(
          db
            .prepare(
              `INSERT INTO evaluation_sp_criteria (evaluation_id, criterion_id, criterion_name, outcome, score, applicable_status, reason_code, evidence_json, absence_record_json,
                 evidence_confidence, confidence_reason, explanation, improvement_recommendation, human_review_flags_json, model_original_outcome, criterion_review_status)
               VALUES (${idOf}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              ...key, c.criterion_id, c.criterion_name, c.outcome, c.score, c.applicable_status, c.reason_code, JSON.stringify(c.evidence), c.absence_record ? JSON.stringify(c.absence_record) : null,
              c.evidence_confidence, c.confidence_reason, c.explanation, c.improvement_recommendation, JSON.stringify(c.human_review_flags), c.model_original_outcome, c.review_status,
            ),
        );
      }
      const s = doc.scores;
      st.push(
        db
          .prepare(`INSERT INTO evaluation_scores (evaluation_id, sales_stage_percent, sales_stage_status, sales_stage_categories_json, psychology_percent, psychology_status) VALUES (${idOf}, ?, ?, ?, ?, ?)`)
          .bind(...key, s.sales_stage.percent, s.sales_stage.status, JSON.stringify(s.sales_stage.categories), s.psychology.percent, s.psychology.status),
      );
      for (const f of doc.extras?.flags ?? []) {
        st.push(
          db
            .prepare(
              `INSERT INTO evaluation_flags (evaluation_id, flag_id, severity, start_s, end_s, evidence_quote, segments_json, explanation, interpretation, verification_status, notes_json)
               VALUES (${idOf}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(...key, f.flag_id, f.severity, f.start_s, f.end_s, f.quote, JSON.stringify(f.segments), f.explanation, f.interpretation, f.verification_status, JSON.stringify(f.notes)),
        );
      }
      st.push(db.prepare(`INSERT INTO evaluation_reports (evaluation_id, status, report_json, generated_at) VALUES (${idOf}, ?, ?, datetime('now'))`).bind(...key, report.status, JSON.stringify(report)));
      if (evaluated) st.push(db.prepare("UPDATE calls SET processing_status = 'evaluated', updated_at = datetime('now') WHERE id = ?").bind(m.call_id));
      await db.batch(st); // one atomic batch: header + criteria + psychology + scores + flags + report
      const row = await db.prepare("SELECT id FROM evaluations WHERE call_id = ? AND rubric_version = ? AND prompt_version = ?").bind(...key).first<{ id: number }>();
      if (!row) throw new Error("evaluation row not found after insert");
      return row.id;
    },
  };
}

