// Deterministic 14-section detailed report built from a validated Mrv1Document. No model call; every finding comes from validated, evidence-checked data.
import { fmtTime } from "../evaluation/transcript.ts";
import { PROFILE_FIELDS } from "./validate.ts";
import type { Mrv1Document } from "./types.ts";

export const NOT_ESTABLISHED = "Not established";
export const REPORT_SECTIONS = [
  "Call Details", "Overall Performance", "Executive Summary", "Prospect Profile", "Category-wise Scorecard", "Detailed Criterion Evaluation", "Sales Psychology and Conduct",
  "Objection Analysis", "What Went Well", "Missed Opportunities", "Critical Flags", "Personal Coaching Plan", "Final Coaching Note", "Human Review",
] as const;

export interface ReportSection {
  number: number;
  title: string;
  lines: string[];
}
export interface Report {
  rubric_version: string;
  status: "generated" | "not_generated";
  reason: string | null;
  sections: ReportSection[];
}

/** "at mm:ss.s, segments 3, 4" - the time is derived by code from the cited segments. */
const ts = (_doc: Mrv1Document, p: { segments: number[]; start_s?: number }) => (p.segments.length ? `at ${fmtTime(p.start_s ?? 0)}, segments ${p.segments.join(", ")}` : "");

export function buildReport(doc: Mrv1Document): Report {
  const title = (i: number) => REPORT_SECTIONS[i];
  const sec = (i: number, lines: string[]): ReportSection => ({ number: i + 1, title: title(i), lines });
  if (doc.applicability.status !== "evaluated" || !doc.extras) {
    // Held and unsupported calls have no completed evaluation to report.
    return {
      rubric_version: doc.metadata.rubric_version,
      status: "not_generated",
      reason: doc.applicability.reason_code ?? "no completed evaluation",
      sections: [sec(0, [`Call ${doc.metadata.callyzer_call_id}`, `Call type: ${doc.call_type.label}`]), sec(13, [`Human review: ${doc.human_review.status}. No normal sales-stage evaluation was generated (${doc.applicability.reason_code ?? "n/a"}); a human must review this call.`])],
    };
  }
  const x = doc.extras;
  const ss = doc.scores.sales_stage;
  const sp = doc.scores.psychology;
  const all = [...doc.sales_stage, ...doc.psychology];

  const details = [
    `Call ID: ${doc.metadata.callyzer_call_id}`, `Call type: ${doc.call_type.label} (confirmed by ${doc.call_type.labelled_by})`, `Rubric: ${doc.metadata.rubric_version}`,
    `Model: ${doc.metadata.model_id ?? "none"}`, `Evaluated: ${doc.metadata.evaluated_at}`, `Transcript source: ${doc.metadata.transcript_source}`,
    `Recording length: ${fmtTime(doc.transcript_quality.duration_s)}; transcript coverage ${doc.transcript_quality.coverage_pct}% (not accuracy)`,
  ];
  const overall = [
    `Sales-stage score: ${ss.display}${ss.status === "provisional" ? " - provisional: not a definitive score" : ""}`,
    ...ss.notes.map((n) => `Note: ${n}`),
    `Sales Psychology and Conduct score (separate, never combined with the sales-stage score): ${sp.display}`,
    `Critical flags: ${x.flags.length} (always visible, independent of scores)`,
  ];
  const profile = PROFILE_FIELDS.map((k) => `${k.replace(/_/g, " ")}: ${x.prospect_profile[k]?.value ?? NOT_ESTABLISHED}${x.prospect_profile[k]?.value ? ` (${ts(doc, x.prospect_profile[k])})` : ""}`);
  const cats = ss.categories.map((c) => `${c.category_id} ${c.category_name}: ${c.display} (scored ${c.numeric_count}, N/A ${c.na_count}, NE ${c.ne_count})`);
  const crit = (list: typeof all) =>
    list.flatMap((c) => {
      const ev = c.evidence.map((e) => `  evidence [${fmtTime(e.start_s)}-${fmtTime(e.end_s)}] (${e.speaker}) "${e.quote}"`);
      const abs = c.absence_record ? [`  absence record ${fmtTime(c.absence_record.window_start_s)}-${fmtTime(c.absence_record.window_end_s)}: ${c.absence_record.absence_explanation}`] : [];
      return [
        `${c.criterion_id} ${c.criterion_name}: ${c.outcome === "N/A" || c.outcome === "NE" ? `${c.outcome} (${c.reason_code})` : `${c.score}/3`} | confidence ${c.evidence_confidence} | review ${c.review_status}`,
        ...ev, ...abs, `  explanation: ${c.explanation}`, ...(c.improvement_recommendation ? [`  improvement: ${c.improvement_recommendation}`] : []),
      ];
    });
  const flags = x.flags.length
    ? x.flags.flatMap((f) => [`${f.flag_id} [${f.severity}] ${f.interpretation} / ${f.verification_status} / human decision ${f.human_review_decision}${f.start_s !== null ? ` at ${fmtTime(f.start_s)}-${fmtTime(f.end_s ?? f.start_s)}` : ""}`, ...(f.quote ? [`  evidence "${f.quote}"`] : []), `  ${f.explanation}`, ...f.notes.map((n) => `  note: ${n}`)])
    : ["No critical flags were raised. A human reviewer should still confirm."];
  const plan = x.coaching_priorities.length
    ? x.coaching_priorities.slice(0, 3).flatMap((p, i) => [`Priority ${i + 1}: ${p.observed_issue} (${ts(doc, p)})`, `  Recommended action: ${p.recommended_action}`, `  Example of better behaviour: ${p.better_behaviour_example}`])
    : ["No coaching priority was identified from the evidence."];
  const objections = x.objections.length ? x.objections.map((o) => `"${o.objection}" - ${o.outcome}: ${o.handling_summary} (${ts(doc, o)})`) : ["No material objection was identified."];
  const pts = (l: Array<{ text: string; segments: number[] }>) => (l.length ? l.map((p) => `${p.text} (${ts(doc, p)})`) : ["None identified."]);

  return {
    rubric_version: doc.metadata.rubric_version,
    status: "generated",
    reason: null,
    sections: [
      sec(0, details), sec(1, overall), sec(2, [x.executive_summary]), sec(3, profile), sec(4, cats), sec(5, crit(doc.sales_stage)), sec(6, crit(doc.psychology)),
      sec(7, objections), sec(8, pts(x.strengths)), sec(9, pts(x.missed_opportunities)), sec(10, flags), sec(11, plan), sec(12, [x.final_coaching_note]),
      sec(13, [`Human review status: ${doc.human_review.status}. Every score, flag and finding requires human review; nothing here is a manager-approved result.`, ...x.needs_human_verification.map((n) => `Verify: ${n}`), ...doc.validation.warnings.map((w) => `Validation note: ${w}`), `Criteria total: ${all.length}`]),
    ],
  };
}

export function renderReportText(r: Report): string {
  return r.sections.map((s) => `${s.number}. ${s.title}\n${s.lines.map((l) => (l.startsWith(" ") ? l : `  ${l}`)).join("\n")}`).join("\n\n");
}

