// Pure mapping from valid D1 evaluation records to Google Sheets rows. No Cloudflare or Google types here.
// D1 is the source of truth; these rows are a reporting copy. One row per evaluated call (evaluation).
// Never includes the full transcript or customer phone numbers.
import { computeOverallScore } from "./score.ts";
import { computePsychologyScore, computeSalesStageScore } from "../mrv1/scoring.ts";
import type { EvaluationState as MrvState, ScoredCriterion } from "../mrv1/scoring.ts";
import { SALES_STAGE_CRITERIA } from "../mrv1/rubric.ts";
import type { EvaluationState, ScoreCriterion } from "./score.ts";

export const SUMMARY_TAB = "Performance Summary";

export const AGENT_HEADERS: string[] = [
  "Evaluation ID", "Call ID", "Agent Name", "Call Date", "Call Duration", "Call Direction", "Call Type", "Overall Call Score",
  "Transcript", "Feedback", "Evaluation Status", "Human Review Status", "Reviewer Comments", "Reviewer Name", "Review Date",
];
export const COLUMN_COUNT = AGENT_HEADERS.length;
export const COL_EVALUATION_ID = 0;
/** Tracking key used in sheet_export_rows.criterion_id: the sheet has one row per call, not per criterion. */
export const CALL_ROW_KEY = "CALL";

export function columnLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
export const LAST_COLUMN = columnLetter(COLUMN_COUNT);

export type Cell = string | number;

export interface ExportCriterion extends ScoreCriterion {
  criterion_id: string;
  criterion_name: string;
  reason_code: string | null;
  evidence_json: string;
  explanation: string;
}
export interface ExportFlag {
  flag_id: string;
  severity: string;
  interpretation: string;
  verification_status: string;
  human_decision: string;
  start_s: number | null;
  evidence_quote: string | null;
  explanation: string;
}
/** One valid evaluation joined with its call, agent, criteria and latest human review (from the valid_* views). */
export interface ExportRecord {
  evaluation_id: number;
  call_ext_id: string;
  agent_id: number;
  agent_name: string;
  call_date: string | null;
  duration_seconds: number;
  direction: string | null;
  call_type_label: string;
  human_review_status: string;
  coaching_json: string | null;
  applicability_reason: string | null;
  /** The evaluated transcript as compact JSON [{i, s (start seconds), t (text)}]; null if unavailable. */
  transcript_segments_json: string | null;
  state: EvaluationState;
  criteria: ExportCriterion[];
  /** MRV1.0 only (all optional so legacy C01/C02 records are unchanged). */
  rubric_version?: string;
  psychology_criteria?: ExportCriterion[];
  flags?: ExportFlag[];
  reviewer: string | null;
  review_comment: string | null;
  reviewed_at: string | null;
}

export function titleCase(name: string): string {
  return name.trim().split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ");
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
const fmtClock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Mask phone-number-like digit runs (7+ digits, optionally separated) that may be spoken in a quotation. */
export function redact(text: string): string {
  return text.replace(/\+?[0-9à¥¦-à¥¯][0-9à¥¦-à¥¯\s\-().]{5,}[0-9à¥¦-à¥¯]/g, "[number redacted]");
}
// Google Sheets allows 50,000 characters per cell.
export function clip(text: string, max = 40000): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
const bullets = (items: Array<{ text: string }> = []) => items.map((p) => `• ${p.text}`).join("\n");

type Coaching = { key_strengths: Array<{ text: string }>; missed_opportunities: Array<{ text: string }>; improvement_recommendations: Array<{ text: string }>; critical_flags: Array<{ flag: string; explanation: string }> };

/** Transcript column: the full timestamped transcript ("[mm:ss] text" per segment), digit runs that look like phone numbers masked. */
function transcriptText(r: ExportRecord): string {
  const segs = parseJson<Array<{ i: number; s: number; t: string }>>(r.transcript_segments_json, []);
  segs.sort((a, b) => a.i - b.i);
  // Mask only the spoken words: redacting whole lines would also eat timestamps.
  const lines = segs.filter((x) => typeof x.t === "string" && x.t.trim() !== "").map((x) => `[${fmtClock(x.s)}] ${redact(x.t.trim())}`);
  return clip(lines.join("\n"), 45000);
}

/** The verified evidence quotations behind each criterion result (for the reviewer; numbers masked). */
function evidenceText(r: ExportRecord): string {
  const lines: string[] = [];
  for (const c of r.criteria) {
    const ev = parseJson<Array<{ start_s: number; end_s: number; quote: string; speaker: string }>>(c.evidence_json, []);
    for (const e of ev) lines.push(`${c.criterion_id} [${fmtClock(e.start_s)}–${fmtClock(e.end_s)}] [${e.speaker}] ${redact(e.quote)}`);
  }
  return lines.join("\n");
}

function feedbackText(r: ExportRecord, status: string, scoreNotes: string[] = []): string {
  const parts: string[] = [];
  if (scoreNotes.length) parts.push(scoreNotes.join("\n"));
  if (status === "N/A") parts.push(`Not applicable: ${r.applicability_reason ?? r.criteria[0]?.reason_code ?? "call type not covered by Categories 01 and 02"}. This is not a statement of poor performance.`);
  const coaching = parseJson<Coaching | null>(r.coaching_json, null);
  if (coaching) {
    coaching.key_strengths = (coaching.key_strengths ?? []).map((p) => ({ text: redact(p.text) }));
    coaching.missed_opportunities = (coaching.missed_opportunities ?? []).map((p) => ({ text: redact(p.text) }));
    coaching.improvement_recommendations = (coaching.improvement_recommendations ?? []).map((p) => ({ text: redact(p.text) }));
    coaching.critical_flags = (coaching.critical_flags ?? []).map((p) => ({ flag: p.flag, explanation: redact(p.explanation) }));
    const s = bullets(coaching.key_strengths), m = bullets(coaching.missed_opportunities), i = bullets(coaching.improvement_recommendations);
    const f = (coaching.critical_flags ?? []).map((x) => `• ${x.flag}: ${x.explanation}`).join("\n");
    if (s) parts.push(`Key strengths:\n${s}`);
    if (m) parts.push(`Missed opportunities:\n${m}`);
    if (i) parts.push(`Improvement recommendations:\n${i}`);
    if (f) parts.push(`Critical flags:\n${f}`);
  }
  // Per-criterion results, so a reviewer sees what the overall score is made of (N/A and NE are text, never zero).
  const results = r.criteria.map((c) => `${c.criterion_id} ${c.criterion_name}: ${c.outcome === "N/A" || c.outcome === "NE" ? c.outcome : `${c.score}/3`}`).join("\n");
  if (results) parts.push(`Criterion results:\n${results}`);
  const evidence = evidenceText(r);
  if (evidence) parts.push(`Evidence cited:\n${evidence}`);
  return clip(parts.join("\n\n"), 45000);
}

export const MRV1_RUBRIC = "MRV1.0";
const MRV1_STATUS: Record<string, string> = { definitive: "Evaluated", provisional: "Provisional", not_applicable: "N/A", held: "Held", unsupported: "Unsupported", incomplete: "Incomplete", invalidated: "Invalidated", blocked: "Blocked" };

interface RowScore {
  display: string;
  status: string;
  notes: string[];
}
/**
 * The score cell and status for a record. MRV1.0: equal-weight average of the applicable category percentages over all 19 categories, with the
 * Sales Psychology score reported separately in Feedback (never combined). Legacy C01/C02 evaluations: a partial score labelled as such,
 * so a two-category result can never be read as a full sales-stage score.
 */
export function scoreForRecord(r: ExportRecord): RowScore {
  if (r.rubric_version !== MRV1_RUBRIC) {
    const s = computeOverallScore({ state: r.state, criteria: r.criteria });
    return { display: s.display, status: s.status, notes: [] };
  }
  const state: MrvState = r.applicability_reason === "unsupported_call_type" ? "unsupported" : r.state;
  const ss = computeSalesStageScore({ state, criteria: r.criteria.map((c): ScoredCriterion => ({ criterion_id: c.criterion_id, category_id: c.category_id, outcome: c.outcome })), expectedIds: SALES_STAGE_CRITERIA.map((c) => c.id) });
  const psy = state === "valid" ? computePsychologyScore((r.psychology_criteria ?? []).map((c): ScoredCriterion => ({ criterion_id: c.criterion_id, category_id: "SP", outcome: c.outcome }))) : null;
  const notes = [`Sales-stage score (equal-weight average of applicable categories): ${ss.display}`, `Sales Psychology and Conduct score (separate, never combined): ${psy ? psy.display : "Not published"}`];
  if (ss.categories.length) notes.push(`Category scores:\n${ss.categories.map((c) => `${c.category_id} ${c.category_name}: ${c.display}`).join("\n")}`);
  for (const n of ss.notes) notes.push(`Note: ${n}`);
  const flags = r.flags ?? [];
  notes.push(flags.length ? `Critical flags (${flags.length}):\n${flags.map((f) => `• ${f.flag_id} [${f.severity}] ${f.interpretation}, ${f.verification_status}, human decision ${f.human_decision}: ${redact(f.explanation)}`).join("\n")}` : "Critical flags: none raised");
  return { display: ss.display, status: MRV1_STATUS[ss.status] ?? ss.status, notes };
}

/** One sheet row per evaluated call. N/A and NE are text, never zero; the score is "N/A" or "Not published" when no number is allowed. */
export function buildAgentRow(r: ExportRecord): Cell[] {
  const s = scoreForRecord(r);
  return [
    r.evaluation_id, r.call_ext_id, titleCase(r.agent_name), r.call_date ?? "", fmtDuration(r.duration_seconds), r.direction ?? "", r.call_type_label, s.display,
    transcriptText(r), feedbackText(r, s.status, s.notes), s.status,
    r.human_review_status, r.review_comment ? clip(redact(r.review_comment), 5000) : "", r.reviewer ?? "", r.reviewed_at ?? "",
  ];
}

/** Placeholder written over the row of an evaluation that is no longer valid, so no invalid score stays visible. */
export function buildWithdrawnRow(evaluationId: number): Cell[] {
  const row: Cell[] = AGENT_HEADERS.map(() => "");
  row[COL_EVALUATION_ID] = evaluationId;
  row[AGENT_HEADERS.indexOf("Overall Call Score")] = "Not published";
  row[AGENT_HEADERS.indexOf("Evaluation Status")] = "Withdrawn";
  row[AGENT_HEADERS.indexOf("Feedback")] = "Withdrawn: this evaluation is no longer valid (test-only, invalidated or replaced) and is not part of manager-facing reporting.";
  return row;
}

/** Compare a desired row with what the sheet returned (trailing empty cells are trimmed by the API). */
export function rowsEqual(desired: Cell[], actual: unknown[] | undefined): boolean {
  const a = actual ?? [];
  for (let i = 0; i < desired.length; i++) {
    const x = desired[i];
    const y = a[i] === undefined || a[i] === null ? "" : a[i];
    if (String(x) !== String(y)) return false;
  }
  return a.slice(desired.length).every((v) => v === "" || v === null || v === undefined);
}

// ---- Performance Summary ----
export interface SummaryStat {
  agent_name: string;
  calls_processed: number;
  eligible_evaluations: number;
  na_calls: number;
  pending_reviews: number;
  reviewed_evaluations: number;
}
export const SUMMARY_HEADERS = ["Agent Name", "Number of Calls Processed", "Number of Eligible Evaluations", "Number of N/A Calls", "Number of Pending Human Reviews", "Number of Reviewed Evaluations"];

export function buildSummaryValues(stats: SummaryStat[], nowIso: string): Cell[][] {
  const rows: Cell[][] = [SUMMARY_HEADERS, ...stats.map((s) => [titleCase(s.agent_name), s.calls_processed, s.eligible_evaluations, s.na_calls, s.pending_reviews, s.reviewed_evaluations])];
  rows.push([]);
  rows.push([`Last updated (UTC): ${nowIso}. Source: Cloudflare D1 valid-evaluation views; test-only and invalidated evaluations are excluded.`]);
  rows.push(["Calls Processed = calls with a completed transcript. Eligible Evaluations = valid scored evaluations. N/A Calls = valid evaluations recorded as not applicable (not scored, not poor performance)."]);
  rows.push(["Pending Human Reviews = eligible evaluations still pending or in review. Reviewed Evaluations = eligible evaluations approved or sent back with changes. N/A records need no score review and are not counted in either."]);
  rows.push(["No agent ranking or weighting is calculated. The Overall Call Score on each agent tab is a Phase 1 rubric score (Categories 01 and 02 only), not a measure of conversion or revenue. Exporting a result does not mean a manager has approved it."]);
  return rows;
}


