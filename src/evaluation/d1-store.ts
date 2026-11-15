// D1 implementation of EvaluationStore. Reads existing transcripts; writes only the evaluation tables.
import type { ActiveCallTypeLabel, CallInfo, EvaluationStore, LoadedTranscript, SaveExtras, StoredEvaluationRef } from "./evaluate.ts";
import type { InvalidationInput, LabelInput, ReviewInput } from "./labels.ts";
import { segmentsFromJson } from "./transcript.ts";
import type { EvaluationDocument } from "./types.ts";

export function createD1Store(db: D1Database): EvaluationStore {
  return {
    async loadCall(callyzerCallId: string): Promise<CallInfo | null> {
      const r = await db
        .prepare("SELECT id, callyzer_call_id, sales_agent_id AS agent_id, duration_seconds FROM calls WHERE callyzer_call_id = ?")
        .bind(callyzerCallId)
        .first<CallInfo>();
      return r ?? null;
    },

    async loadTranscript(callId: number, source: string): Promise<LoadedTranscript | null> {
      let row: { segments_json: string | null } | null;
      if (source === "production") {
        row = await db
          .prepare("SELECT segments_json FROM transcripts WHERE call_id = ? AND transcription_status = 'completed' ORDER BY created_at DESC LIMIT 1")
          .bind(callId)
          .first();
      } else if (source.startsWith("experiment:")) {
        // Read-only use of a stored whole-call experiment transcript (never a slice or chunk).
        row = await db
          .prepare("SELECT segments_json FROM transcription_experiments WHERE call_id = ? AND label = ? AND audio_range_json IS NULL AND transcription_status = 'completed'")
          .bind(callId, source.slice("experiment:".length))
          .first();
      } else return null;
      if (!row) return null;
      const { segments, language } = segmentsFromJson(row.segments_json);
      return { source, language, segments };
    },

    async getActiveCallTypeLabel(callId: number): Promise<ActiveCallTypeLabel | null> {
      // Only an active HUMAN-CONFIRMED label is authoritative; unverified overrides are audit history only.
      const r = await db
        .prepare("SELECT business_call_type, labelled_by, basis, labelled_at FROM call_type_labels WHERE call_id = ? AND superseded_at IS NULL AND verification = 'human_confirmed'")
        .bind(callId)
        .first<ActiveCallTypeLabel>();
      return r ?? null;
    },

    async findEvaluation(callId: number, rubricVersion: string, promptVersion: string): Promise<StoredEvaluationRef | null> {
      const r = await db
        .prepare(
          `SELECT e.id, e.human_review_status, e.evaluated_at,
                  EXISTS (SELECT 1 FROM evaluation_invalidations i WHERE i.evaluation_id = e.id) AS invalidated
           FROM evaluations e WHERE e.call_id = ? AND e.rubric_version = ? AND e.prompt_version = ?`,
        )
        .bind(callId, rubricVersion, promptVersion)
        .first<{ id: number; human_review_status: string; evaluated_at: string; invalidated: number }>();
      return r ? { id: r.id, human_review_status: r.human_review_status, evaluated_at: r.evaluated_at, invalidated: r.invalidated === 1 } : null;
    },

    async deleteEvaluation(id: number): Promise<void> {
      await db.batch([
        db.prepare("DELETE FROM evaluation_reviews WHERE evaluation_id = ?").bind(id),
        db.prepare("DELETE FROM evaluation_criteria WHERE evaluation_id = ?").bind(id),
        db.prepare("DELETE FROM evaluations WHERE id = ?").bind(id),
      ]);
    },

    async saveEvaluation(doc: EvaluationDocument, extras: SaveExtras): Promise<number> {
      const m = doc.metadata;
      const evaluated = doc.applicability.status === "evaluated";
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO evaluations (call_id, rubric_version, prompt_version, model_id, evaluated_at, transcript_source, transcript_sha256,
               call_type_label, call_type_labelled_by, call_type_basis, applicability_status, applicability_reason, transcript_reliability,
               coaching_json, result_json, raw_model_output, usage_json, validation_json, human_review_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          )
          .bind(
            m.call_id, m.rubric_version, m.prompt_version, m.model_id, m.evaluated_at, m.transcript_source, m.transcript_sha256,
            doc.call_type.label, doc.call_type.labelled_by, doc.call_type.basis, doc.applicability.status, doc.applicability.reason_code,
            doc.transcript_assessment?.reliability ?? null,
            doc.coaching ? JSON.stringify(doc.coaching) : null,
            JSON.stringify(doc),
            extras.rawModelOutput,
            extras.usage == null ? null : JSON.stringify(extras.usage),
            JSON.stringify(doc.validation),
          ),
      ];
      for (const cat of doc.categories) {
        for (const c of cat.criteria) {
          statements.push(
            db
              .prepare(
                `INSERT INTO evaluation_criteria (evaluation_id, category_id, category_name, criterion_id, criterion_name, outcome, score, applicable_status, reason_code,
                   elements_met_json, elements_missing_json, elements_late_json, elements_not_observable_json, element_details_json, evidence_json, absence_record_json,
                   evidence_confidence, confidence_reason, explanation, human_review_flags_json, model_original_outcome)
                 VALUES ((SELECT id FROM evaluations WHERE call_id = ? AND rubric_version = ? AND prompt_version = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                m.call_id, m.rubric_version, m.prompt_version,
                cat.category_id, cat.category_name, c.criterion_id, c.criterion_name, c.outcome, c.score, c.applicable_status, c.reason_code,
                JSON.stringify(c.elements_met), JSON.stringify(c.elements_missing), JSON.stringify(c.elements_late), JSON.stringify(c.elements_not_observable),
                JSON.stringify(c.element_details), JSON.stringify(c.evidence), c.absence_record ? JSON.stringify(c.absence_record) : null,
                c.evidence_confidence, c.confidence_reason, c.explanation, JSON.stringify(c.human_review_flags), c.model_original_outcome,
              ),
          );
        }
      }
      if (evaluated) statements.push(db.prepare("UPDATE calls SET processing_status = 'evaluated', updated_at = datetime('now') WHERE id = ?").bind(m.call_id));
      await db.batch(statements); // one atomic batch: evaluation row + criteria + status
      const row = await db
        .prepare("SELECT id FROM evaluations WHERE call_id = ? AND rubric_version = ? AND prompt_version = ?")
        .bind(m.call_id, m.rubric_version, m.prompt_version)
        .first<{ id: number }>();
      if (!row) throw new Error("evaluation row not found after insert");
      return row.id;
    },
  };
}

/**
 * Invalidate the call's valid evaluations whose call-type label differs from `newType` (status 'superseded'; nothing is deleted).
 * They drop out of every valid_* view and must be re-evaluated. Reverts calls.processing_status if no valid evaluated result remains.
 */
export function invalidateOnCallTypeChange(db: D1Database, callId: number, newType: string, by: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO evaluation_invalidations (evaluation_id, status, reason, invalidated_by)
         SELECT e.id, 'superseded', 'call type changed from ' || e.call_type_label || ' to ' || ?, ?
         FROM valid_evaluations e WHERE e.call_id = ? AND e.call_type_label <> ?`,
      )
      .bind(newType, by, callId, newType),
    db
      .prepare(
        `UPDATE calls SET processing_status = 'transcribed', updated_at = datetime('now')
         WHERE id = ? AND processing_status = 'evaluated'
           AND NOT EXISTS (SELECT 1 FROM valid_evaluations e WHERE e.call_id = calls.id AND e.applicability_status = 'evaluated')`,
      )
      .bind(callId),
  ];
}

/**
 * Record a call-type label. A human-confirmed label supersedes the previous active label (history is kept).
 * An unverified test override is stored only as already-superseded audit history and never becomes active.
 */
export async function recordCallTypeLabel(db: D1Database, callId: number, input: LabelInput): Promise<{ label_id: number; active: boolean }> {
  const statements: D1PreparedStatement[] = [];
  if (input.verification === "human_confirmed") {
    statements.push(db.prepare("UPDATE call_type_labels SET superseded_at = datetime('now') WHERE call_id = ? AND superseded_at IS NULL").bind(callId));
    statements.push(
      db.prepare("INSERT INTO call_type_labels (call_id, business_call_type, verification, labelled_by, basis) VALUES (?, ?, 'human_confirmed', ?, ?)").bind(callId, input.callType, input.labelledBy, input.basis),
    );
    // A changed call type invalidates the call's valid evaluations made under a different type (status 'superseded'; nothing is deleted).
    statements.push(...invalidateOnCallTypeChange(db, callId, input.callType, input.labelledBy));
  } else {
    statements.push(
      db
        .prepare("INSERT INTO call_type_labels (call_id, business_call_type, verification, labelled_by, basis, superseded_at) VALUES (?, ?, 'unverified_test_override', ?, ?, datetime('now'))")
        .bind(callId, input.callType, input.labelledBy, input.basis),
    );
  }
  await db.batch(statements);
  const row = await db.prepare("SELECT id FROM call_type_labels WHERE call_id = ? ORDER BY id DESC LIMIT 1").bind(callId).first<{ id: number }>();
  return { label_id: row?.id ?? 0, active: input.verification === "human_confirmed" };
}

/**
 * Mark an evaluation test_only / invalidated / superseded. The evaluation row, its criteria and its raw output are not touched
 * and not deleted. If it was the call's only valid evaluated result, calls.processing_status 'evaluated' reverts to 'transcribed'.
 */
/** Records a human review decision. Only valid (non-invalidated) evaluations can be reviewed; the model's stored result is untouched. */
export async function recordReview(db: D1Database, input: ReviewInput): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const ev = await db
    .prepare("SELECT e.id, EXISTS (SELECT 1 FROM evaluation_invalidations i WHERE i.evaluation_id = e.id) AS invalidated FROM evaluations e WHERE e.id = ?")
    .bind(input.evaluationId)
    .first<{ id: number; invalidated: number }>();
  if (!ev) return { ok: false, error: "evaluation not found" };
  if (ev.invalidated === 1) return { ok: false, error: "evaluation is invalidated and cannot be reviewed" };
  await db.batch([
    db.prepare("INSERT INTO evaluation_reviews (evaluation_id, reviewer, status, comment) VALUES (?, ?, ?, ?)").bind(input.evaluationId, input.reviewer, input.status, input.comment),
    db.prepare("UPDATE evaluations SET human_review_status = ? WHERE id = ?").bind(input.status, input.evaluationId),
  ]);
  return { ok: true, status: input.status };
}

export async function invalidateEvaluation(db: D1Database, input: InvalidationInput): Promise<{ ok: true; call_id: number; call_status: string } | { ok: false; error: string }> {
  const ev = await db
    .prepare("SELECT e.id, e.call_id, EXISTS (SELECT 1 FROM evaluation_invalidations i WHERE i.evaluation_id = e.id) AS invalidated FROM evaluations e WHERE e.id = ?")
    .bind(input.evaluationId)
    .first<{ id: number; call_id: number; invalidated: number }>();
  if (!ev) return { ok: false, error: "evaluation not found" };
  if (ev.invalidated === 1) return { ok: false, error: "evaluation is already invalidated" };
  await db.batch([
    db.prepare("INSERT INTO evaluation_invalidations (evaluation_id, status, reason, invalidated_by) VALUES (?, ?, ?, ?)").bind(input.evaluationId, input.status, input.reason, input.by),
    db
      .prepare(
        `UPDATE calls SET processing_status = 'transcribed', updated_at = datetime('now')
         WHERE id = ? AND processing_status = 'evaluated'
           AND NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.call_id = calls.id AND e.applicability_status = 'evaluated'
                           AND NOT EXISTS (SELECT 1 FROM evaluation_invalidations i WHERE i.evaluation_id = e.id))`,
      )
      .bind(ev.call_id),
  ]);
  const c = await db.prepare("SELECT processing_status FROM calls WHERE id = ?").bind(ev.call_id).first<{ processing_status: string }>();
  return { ok: true, call_id: ev.call_id, call_status: c?.processing_status ?? "unknown" };
}