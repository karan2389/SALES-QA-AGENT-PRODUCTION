// MRV1.0 prompt construction. One prompt per model pass; the approved C01/C02 detailed rules are reused verbatim from src/evaluation/rubric.ts.
import { RUBRIC_PROMPT } from "../evaluation/rubric.ts";
import { anchorText } from "./anchors.ts";
import { FLAG_IDS, FLAG_SEVERITIES, MRV1_VERSION, NA_REASONS_GENERAL, SCORE_MEANING, criteriaForPass } from "./rubric.ts";
import type { Pass } from "./rubric.ts";
import { fmtTime, formatTranscriptForPrompt } from "../evaluation/transcript.ts";
import type { Segment, TranscriptQuality } from "../evaluation/types.ts";
import { NE_REASONS, HUMAN_REVIEW_FLAGS } from "../evaluation/rubric.ts";

/** Sections of the approved Rev 4 text that are reused: general evidence rules and the C01/C02 detail. */
export function approvedC01C02Text(): string {
  const a = RUBRIC_PROMPT.indexOf("== GENERAL EVIDENCE RULES ==");
  const b = RUBRIC_PROMPT.indexOf("== CALL OPENING AND CALL TYPE ==");
  const c = RUBRIC_PROMPT.indexOf("== CATEGORY 01: INTRODUCTION");
  if (a < 0 || b < 0 || c < 0) throw new Error("approved rubric text markers not found");
  return `${RUBRIC_PROMPT.slice(a, b).trim()}\n\n${RUBRIC_PROMPT.slice(c).trim()}`;
}

export const GUIDANCE: Record<string, string> = {
  C03: "Understand the prospect's actual professional and business situation. If the prospect has not started a business, use N/A (reason prospect_has_no_business) for metrics that genuinely do not apply. Never infer revenue or customer numbers.",
  C04: "Explore the prospect's intended online business model, offer, course or growth direction. Do not force a course-launch discussion on someone whose model is not course-based.",
  C05: "Explore financial goals, current position, growth expectations and investment constraints respectfully. Never reward financial pressure or encouragement to borrow money or use essential funds.",
  C06: "Understand why the goal matters. Personal and family information is optional and sensitive. Never reward guilt, shame or emotional manipulation.",
  C07: "Understand why the prospect is considering action now. Do not reward manufactured urgency or fake deadlines.",
  C08: "Understand the prospect's existing plan and identify actual gaps. Do not replace the prospect's plan with unsupported salesperson assumptions.",
  C09: "Explore obstacles, their impact and why the prospect has not overcome them independently. Do not manufacture problems to sell the product.",
  C10: "Explore missing knowledge, tools, resources, mentorship, support or community. Do not assume every prospect needs every resource.",
  C11: "The salesperson should ask how the prospect believes FlexiFunnels could help and connect the answer to previously established needs. Do not give full credit merely because the salesperson lists product features.",
  C12: "Understand previous attempts, tools, platforms, courses, agencies and relevant experiences. Do not reward unsupported competitor claims.",
  C13: "Explore realistic consequences of staying in the same situation and whether the prospect wants that future. Never reward fearmongering, shame or fabricated consequences.",
  C14: "Relevant, verified customer examples. Do not reward invented testimonials or guarantees of similar outcomes. N/A may apply if no relevant testimonial exists or sharing is inappropriate. A salesperson saying a WhatsApp testimonial was sent is not proof of delivery.",
  C15: "Explain relevant FlexiFunnels differentiators, features, benefits, monetisation opportunities, training and support. 'ONLY Solution' means relevant differentiation and best-fit positioning, not an unsupported claim that no competing solution exists. Reference: https://sb.flexifunnels.com/advanced-features . Do not reward invented features, availability, pricing, support commitments or launch dates. Do not reward promises of full custom development, personal mentoring or direct one-to-one access to Saurabh Bhatnagar, unapproved support or response times, or training not in the approved resources; flag such promises as misrepresented_support.",
  C16: "Intended alignment questions: does this make sense so far; does the prospect agree the challenge is a roadblock; can they see how solving it helps the goal; do they want to address the barrier; if addressed, are they ready for an appropriate next step. A leading-question 'yes' is not independent agreement. Do not penalise a salesperson because a prospect disagrees.",
  C17: "Understand why the prospect did not enrol during the webinar, how they would like to proceed, relevant payment options and the mutually agreed next step. Do not penalise a salesperson for not requesting payment when the prospect is not ready.",
  C18: "Objections are addressed one by one using accurate approved responses. The approved Objection Doc has not been made available and verified: do not reward or invent 'approved' responses; judge identification, clarification, relevance and accuracy only, and put unverifiable claims under human review. N/A (reason no_material_objection) when no material objection arises.",
  C19: "Reframe a concern only where a genuine, relevant example or resource supports the alternative perspective. Do not reward turning financial inability into a reason to borrow, guaranteeing another customer's result, pressure after a refusal, or misrepresenting training, support or product capabilities.",
  SP: "Sales Psychology and Conduct scorecard: 22 independent criteria, scored separately from the sales-stage categories and never combined with them. Monologue guideline: target 60 seconds or less per salesperson monologue; longer explanations can be acceptable when justified and useful; never lower a score only because a duration threshold was passed. SP-18 decision-making authority and SP-19 financial qualification: N/A when the topic genuinely did not arise. SP-21 customer fit rests on actual product fit, ability to understand the offer, technical requirements, realistic expectations and informed voluntary decision-making, NEVER on disability, military status, education, language background, accent or any personal characteristic.",
};

const PREAMBLE = `You are a careful sales-call evaluator for the FlexiFunnels Senior Mentoring Team applying the Master Evaluation Rubric ${MRV1_VERSION} to ONE transcribed call and returning strictly valid JSON. You evaluate only the provided transcript and verified metadata. You never judge whether the prospect bought. You are conservative: you never invent evidence, and you say NE when the transcript cannot support a judgement.

== SCORING ==
${Object.entries(SCORE_MEANING).map(([k, v]) => `${k} = ${v}`).join("\n")}
Universal anchors. 3: the required behaviour is clearly performed and its purpose achieved. 2: the main behaviour is performed but a limited detail, follow-up or confirmation is missing. 1: an attempt is made but execution is substantially incomplete, vague, poorly timed or ineffective. 0: the salesperson does not perform an applicable action despite a reasonable opportunity, or materially mishandles it (needs an absence_record). N/A: the criterion does not reasonably apply (a reason code is mandatory). NE: recording, transcript, speaker attribution or evidence is insufficient for a reliable judgement (a reason code is mandatory). Never treat N/A or NE as zero. When the transcript is incomplete use NE rather than assuming an event did not occur.
Evaluate each criterion independently. Search the whole transcript where a behaviour could occur at any point. A question alone does not establish an answer where the criterion requires information to be obtained. Prospect-volunteered information counts where the criterion permits it. Do not infer that the prospect agreed, understood, trusted the salesperson or intended to buy without evidence. Do not penalise the same underlying behaviour twice unless genuinely different behaviours are assessed. Never fabricate quotations, timestamps, prospect answers, salesperson statements, customer outcomes, testimonials or missing information. Do not reward conversion pressure. Never judge a prospect by a personal characteristic (disability, military status, education, language background, accent, etc.).
Every criterion needs: evidence (exact quotation from cited segments, with who spoke and how you inferred it), an explanation, an improvement_recommendation (specific to this call; for a 3, N/A or NE it may restate what to keep doing or be empty), a confidence (evidence_confidence) and its reason. Timestamps are derived by the system from the segment numbers you cite; never write timestamps yourself. Do not calculate any category, overall or psychology score.
Critical flags (ethical or misleading conduct): ids ${FLAG_IDS.join(", ")}; severities ${FLAG_SEVERITIES.join(", ")}. Mark interpretation "confirmed_conduct" only if the transcript clearly shows it, otherwise "ambiguous". Never flag based on a personal characteristic of the prospect.`;

function outputSpec(pass: Pass, ids: string[], naCats: string[]): string {
  const extras = pass.extras
    ? `,
  "critical_flags": [ { "flag_id": "<flag id>", "severity": "low|medium|high|critical", "interpretation": "confirmed_conduct" | "ambiguous", "segments": [<n>], "quote": "<exact quote or null>", "explanation": "<short>" } ],
  "what_went_well": [ { "text": "<specific, evidence-backed>", "segments": [<n>] } ],
  "missed_opportunities": [ { "text": "...", "segments": [<n>] } ],
  "coaching_priorities": [ { "observed_issue": "...", "recommended_action": "...", "better_behaviour_example": "<what the salesperson could have said>", "segments": [<n>] } ],
  "prospect_profile": { ${["occupation", "business_and_offer", "marketing_channels", "target_customers", "sales_channels", "price_range", "monthly_customers", "annual_revenue", "team_size", "goals", "challenges"].map((k) => `"${k}": null | { "value": "<what the PROSPECT said>", "segments": [<n>] }`).join(", ")} },
  "objections": [ { "objection": "...", "segments": [<n>], "handling_summary": "...", "outcome": "resolved" | "unresolved" | "unclear" } ],
  "executive_summary": "<3-5 sentences>",
  "final_coaching_note": "<short, specific, respectful>",
  "needs_human_verification": [ "<what a human must check>" ]`
    : "";
  const extraRules = pass.extras ? "\nAt most three coaching_priorities, each tied to segments; no generic advice. Unknown prospect information must be null (it is shown as \"Not established\"); never guess it." : "";
  return `OUTPUT FORMAT. Return ONLY one JSON object (no text before or after, no code fences) with EXACTLY these criteria, each once: ${ids.join(", ")}.${naCats.length ? ` (Categories ${naCats.join(", ")} are not applicable to this call type and are handled by the system; do not return them.)` : ""}
{
  "criteria": [
    {
      "criterion_id": "<id>",
      "outcome": "0" | "1" | "2" | "3" | "N/A" | "NE",
      "reason_code": null | "<N/A or NE reason code>",
      "elements": [],   // only C01 and C02 use elements (codes and states defined in their rules); otherwise []
      "element_details": [], "understanding_check_passed": null, "counts": null,   // only where the C01/C02 rules require them
      "evidence": [ { "segment_start": <n>, "segment_end": <n>, "quote": "<EXACT text copied from those segments>", "speaker": "salesperson" | "prospect" | "unclear", "speaker_basis": "<how inferred>" } ],
      "absence_record": null | { "window_start_segment": <n>, "window_end_segment": <n>, "progression_excerpts": [ { "segment": <n>, "quote": "<exact>", "speaker": "salesperson" | "prospect" | "unclear" } ], "absence_explanation": "<1-3 sentences>" },
      "evidence_confidence": "high" | "medium" | "low",
      "confidence_reason": "<short>",
      "explanation": "<1-3 concise sentences>",
      "improvement_recommendation": "<specific to this call>",
      "human_review_flags": [ "<flag>" ]
    }
  ],
  "transcript_assessment": { "reliability": "high"|"medium"|"low", "notes": "<how transcript quality limited the evaluation>", "call_opening_observable": "yes"|"no"|"unclear", "speaker_attribution": "clear"|"uncertain"|"poor", "language_ok": true | false, "call_type_conflict": null | { "suspected_type": "<call type>", "segment": <n>, "quote": "<exact>", "explanation": "<short>" } }${extras}
}
N/A reason codes: C01/C02 use only their approved codes (see their rules); other criteria: ${NA_REASONS_GENERAL.join(", ")}. NE reason codes: ${NE_REASONS.filter((r) => !["inconsistent_model_output", "missing_evidence", "quote_not_verifiable", "absence_record_insufficient"].includes(r)).join(", ")}. Suggested human_review_flags: ${HUMAN_REVIEW_FLAGS.join(", ")}.
Segment numbers are the #N markers. Scores 1-3 need at least one evidence item; 0 needs an absence_record with an exact excerpt; N/A and NE may have empty evidence.${extraRules}`;
}

export interface PassPromptContext {
  pass: Pass;
  expectedIds: string[];
  naCategories: string[];
  callTypeLabel: string;
  durationSeconds: number;
  transcriptSource: string;
  segments: Segment[];
  quality: TranscriptQuality;
}

export function buildPassMessages(ctx: PassPromptContext): { system: string; user: string } {
  const defs = criteriaForPass(ctx.pass).filter((c) => ctx.expectedIds.includes(c.id));
  const catIds = [...new Set(defs.map((d) => d.category_id))];
  const guidance = catIds
    .map((id) => {
      const names = defs.filter((d) => d.category_id === id);
      const list = names.map((d) => `${d.id} ${d.name}`).join("; ");
      if (id === "C01" || id === "C02") return `== ${id} ${names[0].category_name.toUpperCase()}: ${list}`;
      const anchors = names.map((d) => `${d.id} ${d.name}\n${anchorText(d.id)}`).join("\n");
      return `== ${id} ${names[0].category_name.toUpperCase()}: ${list}\n${GUIDANCE[id] ?? ""}\nCriterion-specific anchors (they refine the universal 0-3 / N/A / NE scale; the strictest applicable rule wins):\n${anchors}`;
    })
    .join("\n\n");
  const approved = catIds.some((c) => c === "C01" || c === "C02") ? `\n\n== APPROVED DETAILED RULES FOR CATEGORIES 01 AND 02 (these override any shorter description) ==\n${approvedC01C02Text()}` : "";
  const system = `${PREAMBLE}\n\n== CRITERIA FOR THIS PASS ==\n${guidance}${approved}\n\n${outputSpec(ctx.pass, defs.map((d) => d.id), ctx.naCategories.filter((c) => catIds.includes(c)))}`;
  const q = ctx.quality;
  const gaps = q.gaps_over_5s.length ? q.gaps_over_5s.slice(0, 20).map((g) => `${fmtTime(g.start_s)}-${fmtTime(g.end_s)}`).join(", ") : "none";
  const user = `CALL CONTEXT
- Rubric: ${MRV1_VERSION}; pass: ${ctx.pass.key}
- Call type (confirmed by a human): ${ctx.callTypeLabel}${ctx.naCategories.length ? ` (Categories ${ctx.naCategories.join(" and ")} are N/A for this type; Categories 03-19 remain assessable where relevant)` : ""}
- Recording length: ${fmtTime(ctx.durationSeconds)}
- Transcript: machine-generated by Whisper (source: ${ctx.transcriptSource}); language label: ${q.language ?? "unknown"}; segments: ${q.segment_count}; coverage: ${q.coverage_pct}% (NOT accuracy)
- Gaps longer than 5 s where speech may be missing: ${gaps}
- Segments ending in a broken character: ${q.broken_char_segments.length ? q.broken_char_segments.join(", ") : "none"}
- No speaker labels: infer salesperson and prospect from context. Hindi and English are mixed; the transcript is evidence, not proof; prefer NE over a low score when decisive words are unreadable.

TRANSCRIPT (each line: #segment [start-end in mm:ss.s] text)
${formatTranscriptForPrompt(ctx.segments)}

Return the JSON object now.`;
  return { system, user };
}
