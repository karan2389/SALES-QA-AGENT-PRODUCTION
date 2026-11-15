import { CRITERIA, HUMAN_REVIEW_FLAGS, NE_REASONS, RUBRIC_PROMPT } from "./rubric.ts";
import { fmtTime, formatTranscriptForPrompt } from "./transcript.ts";
import type { Segment, TranscriptQuality } from "./types.ts";

export const PROMPT_VERSION = "eval-prompt-v2";

function outputSpec(): string {
  const crit = CRITERIA.map((c) => {
    const na = c.na_reasons.length ? `N/A reason codes: ${c.na_reasons.join(", ")}` : "N/A not allowed";
    const extra = [
      c.understanding_check ? "understanding_check_passed (boolean) required for scores 0-3" : "",
      c.element_details.length ? `element_details required for ${c.element_details.join(", ")}` : "",
      c.counts ? "counts required for scores 0-3" : "",
    ]
      .filter(Boolean)
      .join("; ");
    return `- ${c.id} "${c.name}": element codes ${c.elements.join(", ")}; allowed states ${c.states.join(" | ")}; ${na}${extra ? `; ${extra}` : ""}`;
  }).join("\n");
  return `OUTPUT FORMAT. Return ONLY one JSON object, with no text before or after it and no code fences. Include all nine criteria, exactly once each, in this shape:
{
  "criteria": [
    {
      "criterion_id": "C01-01",
      "outcome": "0" | "1" | "2" | "3" | "N/A" | "NE",
      "reason_code": null | "<N/A or NE reason code>",
      "elements": [ { "code": "<element code>", "state": "<allowed state>", "prompted_by_prospect": true | false | null } ],
      "element_details": [ { "element": "D", "asked": true, "volunteered": false, "established": "yes" | "partial" | "no" | "not_transcribed", "quote": "<exact quote or null>", "segment": <segment number or null> } ],
      "understanding_check_passed": true | false | null,
      "counts": null | { "substantive_answers": 0, "reflected_answers": 0, "neutral_followups_on_distinct_answers": 0 },
      "evidence": [ { "segment_start": <segment number>, "segment_end": <segment number>, "quote": "<EXACT text copied from those segments>", "speaker": "salesperson" | "prospect" | "unclear", "speaker_basis": "<how you inferred the speaker>" } ],
      "absence_record": null | { "window_start_segment": <n>, "window_end_segment": <n>, "progression_excerpts": [ { "segment": <n>, "quote": "<exact text>", "speaker": "salesperson" | "prospect" | "unclear" } ], "absence_explanation": "<1-3 sentences>" },
      "evidence_confidence": "high" | "medium" | "low",
      "confidence_reason": "<short>",
      "explanation": "<1-3 concise sentences linking evidence to the score boundary used>",
      "human_review_flags": [ "<flag>" ]
    }
  ],
  "coaching": {
    "key_strengths": [ { "text": "<specific, evidence-backed>", "segments": [<segment numbers>] } ],
    "missed_opportunities": [ { "text": "...", "segments": [] } ],
    "improvement_recommendations": [ { "text": "<specific, actionable>", "segments": [] } ],
    "critical_flags": [ { "flag": "<short name>", "explanation": "...", "segments": [], "quote": "<exact quote or null>" } ],
    "needs_human_verification": [ "<things a human must check, e.g. garbled stretches, uncertain speaker attribution, unverifiable claims>" ]
  },
  "transcript_assessment": { "reliability": "high" | "medium" | "low", "notes": "<how transcript quality limited the evaluation>", "call_opening_observable": "yes" | "no" | "unclear", "call_type_conflict": null | { "suspected_type": "<call type>", "segment": <n>, "quote": "<exact text>", "explanation": "<short>" } }
}
Criteria and their element codes:
${crit}
Allowed NE reason codes: ${NE_REASONS.filter((r) => !["inconsistent_model_output", "missing_evidence", "quote_not_verifiable", "absence_record_insufficient"].includes(r)).join(", ")}.
Suggested human_review_flags: ${HUMAN_REVIEW_FLAGS.join(", ")}.
Rules for the JSON: "segment" numbers are the #N markers in the transcript. Every quote must be copied exactly (original script) from the cited segments. For outcomes "N/A" and "NE" evidence may be empty. For outcomes "1", "2", "3" evidence must contain at least one item. For outcome "0" give an absence_record with at least one exact excerpt from the observable part of the call. Keep coaching specific, concise and tied to segments; do not repeat the rubric. Do not compute any overall or weighted score.`;
}

export interface PromptContext {
  callTypeLabel: string;
  durationSeconds: number;
  transcriptSource: string;
  segments: Segment[];
  quality: TranscriptQuality;
}

export function buildMessages(ctx: PromptContext): { system: string; user: string } {
  const system = `You are a careful sales-call evaluator for the FlexiFunnels Senior Mentoring Team. You evaluate one transcribed call against a fixed rubric and return strictly valid JSON. You are conservative: you never invent evidence, and you say NE when the transcript cannot support a judgement.\n\n${RUBRIC_PROMPT}\n\n${outputSpec()}`;
  const q = ctx.quality;
  const gaps = q.gaps_over_5s.length ? q.gaps_over_5s.slice(0, 20).map((g) => `${fmtTime(g.start_s)}-${fmtTime(g.end_s)}`).join(", ") : "none";
  const user = `CALL CONTEXT
- Call type (confirmed by a human): ${ctx.callTypeLabel} (the call is a new webinar-attendee prospect call; evaluate Category 01 and Category 02 only)
- Recording length: ${fmtTime(ctx.durationSeconds)}
- Transcript: machine-generated by Whisper (source: ${ctx.transcriptSource}); language label: ${q.language ?? "unknown"}; segments: ${q.segment_count}; coverage of the recording by segments: ${q.coverage_pct}% (NOT accuracy)
- Gaps longer than 5 s where speech may be missing: ${gaps}
- Segments ending in a broken character (possible cut-off words): ${q.broken_char_segments.length ? q.broken_char_segments.join(", ") : "none"}
- No speaker labels: infer who is the salesperson and who is the prospect from context. Hindi and English are mixed; treat the transcript as evidence, not proof, and prefer NE over a low score when decisive words are unreadable.

TRANSCRIPT (each line: #segment [start-end in mm:ss.s] text)
${formatTranscriptForPrompt(ctx.segments)}

Return the JSON object now.`;
  return { system, user };
}
