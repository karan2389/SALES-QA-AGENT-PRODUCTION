// Digest of docs/evaluation-rubric-v1.md (Revision 4): Category 01 (Introduction) and Category 02 (Understanding Intent).
// The markdown document remains the source of truth; scripts/check-rubric.ts verifies that these IDs and names match it.
// Categories 03-19 are intentionally NOT evaluated in this prototype.

export const RUBRIC_VERSION = "evaluation-rubric-v1-rev4-c01-c02";

export interface CriterionDef {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  /** Allowed element codes the model may report. */
  elements: string[];
  /** Element states the model may use for this criterion. */
  states: string[];
  /** Criterion-level N/A reason codes the model may use (call-level N/A is set by code). */
  na_reasons: string[];
  /** C02-01..C02-03 report whether the understanding check passed. */
  understanding_check: boolean;
  /** C02-03 must report element_details for D, W, S. */
  element_details: string[];
  /** C02-04 reports counts for the provisional 75% reflection threshold. */
  counts: boolean;
}

const TIMED = ["on_time", "late", "never", "not_observable"];
const GRADED = ["demonstrated", "partial", "never", "not_observable"];
const BEHAVIOUR = ["demonstrated", "never", "not_observable"];

export const CRITERIA: CriterionDef[] = [
  { id: "C01-01", category_id: "C01", category_name: "Introduction", name: "Self and team introduction", elements: ["N", "F", "T"], states: TIMED, na_reasons: [], understanding_check: false, element_details: [], counts: false },
  { id: "C01-02", category_id: "C01", category_name: "Introduction", name: "Purpose of the call", elements: ["P1", "P2"], states: TIMED, na_reasons: [], understanding_check: false, element_details: [], counts: false },
  { id: "C01-03", category_id: "C01", category_name: "Introduction", name: "Expectation setting", elements: ["X1", "X2"], states: TIMED, na_reasons: [], understanding_check: false, element_details: [], counts: false },
  { id: "C02-01", category_id: "C02", category_name: "Understanding Intent", name: "Purpose of attendance", elements: ["Q", "A"], states: GRADED, na_reasons: [], understanding_check: true, element_details: [], counts: false },
  { id: "C02-02", category_id: "C02", category_name: "Understanding Intent", name: "Webinar learnings", elements: ["Q", "A"], states: GRADED, na_reasons: [], understanding_check: true, element_details: [], counts: false },
  { id: "C02-03", category_id: "C02", category_name: "Understanding Intent", name: "Following history and source of interest", elements: ["D", "W", "S"], states: GRADED, na_reasons: [], understanding_check: true, element_details: ["D", "W", "S"], counts: false },
  { id: "C02-04", category_id: "C02", category_name: "Understanding Intent", name: "Reflection and follow-up on the prospect's answers", elements: ["R", "F", "N"], states: BEHAVIOUR, na_reasons: ["no_substantive_answer"], understanding_check: false, element_details: [], counts: true },
  { id: "C02-05", category_id: "C02", category_name: "Understanding Intent", name: "Clarification of unclear answers", elements: ["C", "R"], states: BEHAVIOUR, na_reasons: ["no_unclear_answer"], understanding_check: false, element_details: [], counts: false },
  { id: "C02-06", category_id: "C02", category_name: "Understanding Intent", name: "Intent established before advancing or pitching", elements: ["V1", "V2"], states: BEHAVIOUR, na_reasons: ["no_transition_observed"], understanding_check: false, element_details: [], counts: false },
];

export const CATEGORIES_EVALUATED = [
  { id: "C01", name: "Introduction" },
  { id: "C02", name: "Understanding Intent" },
];

/** Checklist sections 3-19 (from the sales call checklist). Reported as not_evaluated; never scored here. */
export const CATEGORIES_NOT_EVALUATED = [
  { id: "C03", name: "Customer Persona" },
  { id: "C04", name: "Online Business Plan of Action" },
  { id: "C05", name: "Monetary Goals" },
  { id: "C06", name: "Emotional WHY" },
  { id: "C07", name: "Why Now?" },
  { id: "C08", name: "Plan Analysis" },
  { id: "C09", name: "Challenges" },
  { id: "C10", name: "Knowledge Gap" },
  { id: "C11", name: "How Will FlexiFunnels Help?" },
  { id: "C12", name: "Past Experiences" },
  { id: "C13", name: "Pain Exaggeration" },
  { id: "C14", name: "Testimonials" },
  { id: "C15", name: "Unique Selling Proposition (USP)" },
  { id: "C16", name: "YES Mode" },
  { id: "C17", name: "Closing Questions" },
  { id: "C18", name: "Objection Handling" },
  { id: "C19", name: "Their Objections = Best Case Scenario" },
];

export const NE_REASONS = [
  "transcript_unreliable",
  "recording_begins_midway",
  "not_transcribed",
  "speaker_unclear",
  "prospect_ended_call_before_reached",
  "insufficient_evidence",
  // set by code, never by the model:
  "inconsistent_model_output",
  "missing_evidence",
  "quote_not_verifiable",
  "absence_record_insufficient",
];

export const HUMAN_REVIEW_FLAGS = [
  "unverified_claim",
  "possible_contradiction",
  "leading_question",
  "pressure_to_express_interest",
  "ignored_stated_disinterest",
  "persistence_after_decline",
  "assumed_intent",
  "misleading_or_unverified_claim",
  "speaker_attribution_uncertain",
  "transcript_unreliable",
];

/** Call-type vocabulary approved in rubric section 13. */
export const CALL_TYPES = [
  "new_webinar_prospect",
  "follow_up",
  "renewal",
  "continuation",
  "support_existing_customer",
  "no_conversation",
  "other_unclassified",
];

export const RUBRIC_PROMPT = `RUBRIC: FlexiFunnels Sales Call Evaluation Rubric v1, Revision 4. Only Category 01 (Introduction) and Category 02 (Understanding Intent) are evaluated. You judge the SALESPERSON's behaviour against the documented checklist. You never judge whether the prospect bought: a converted call is not automatically good, an unsuccessful call is not automatically poor.

== OUTCOMES (per criterion) ==
"0": the criterion is applicable and observable, the transcript is reliable, but the required behaviour was NOT demonstrated anywhere in the readable transcript. A "0" requires an absence_record (excerpts that show how the conversation progressed). Never invent a quotation to prove absence.
"1": poor or very limited. "2": partial. "3": effective.
"N/A": the criterion genuinely does not apply (only with the reason codes allowed for that criterion below).
"NE": the available evidence is insufficient to establish what happened reliably. Use NE (not 0, not a guess) when: decisive words are garbled or missing; a transcript gap or quality flag overlaps where the behaviour would be; the recording begins midway and elements were not observable; the speaker cannot be told apart and it matters; the salesperson's next turn presupposes an answer that is absent from the transcript (reason "not_transcribed"); or an uncertain element could change the score band. A transcription error is never proof that the salesperson did not do something.
Tie-break: if two adjacent scores both seem plausible because of the salesperson's WORDING, choose the lower; if because of TRANSCRIPT QUALITY, report NE.

== GENERAL EVIDENCE RULES ==
- Every criterion scored 1, 2 or 3 needs at least one evidence item: a segment range plus an EXACT quotation copied unchanged from those segments (original script, no translation, no correction). Never invent quotations, segment numbers, prospect statements or salesperson actions.
- The transcript has no speaker labels. For each evidence item state who spoke (salesperson, prospect or unclear) and how you inferred it (speaker_basis). If attribution is uncertain and decisive, use NE.
- Judge meaning in context, never keywords. A mention of "FlexiFunnels", "20", "webinar" or "selected" outside the required behaviour earns nothing.
- Hindi, English and Hinglish are equally acceptable; different wording is fine if the behaviour is clearly demonstrated. Accept equivalent renderings in either script.
- The transcript is machine-generated, often garbled in Hindi-English speech, and may omit short replies. It is evidence, not proof.
- Never score a prospect's personal characteristics (language ability, education, disability, military status, etc.). Never reward pressure, manipulation, false urgency, fake promises or misleading statements; flag them in critical_flags. Flag unsupported income guarantees, unrealistic earnings claims and misleading product or mentoring promises. Do not assert that a statement is false merely because you cannot verify it: flag it as unverified for human review.
- Separate observation (what was said, quoted) from interpretation (your judgement). Keep explanations concise and specific.

== CALL OPENING AND CALL TYPE ==
First decide transcript_assessment.call_opening_observable. "yes" only if the transcript clearly begins at the opening of the call. Answer "no" if the transcript begins mid-conversation or shows a continuation: for example the first lines are connection checks such as "hello, hello", the speakers refer to an earlier call or conversation, or the discussion is already in progress without any introduction. Answer "unclear" if you cannot tell. If the answer is not "yes", do NOT score absent introductory or intent behaviour as 0: use NE with reason "recording_begins_midway" for what could not be observed. Do not criticise the salesperson in coaching for behaviour that could not be observed.
The call type was confirmed by a human as a new webinar-attendee prospect call. Never change that label. If the transcript strongly indicates a different type (a renewal or existing-customer offer, a follow-up or continuation of an earlier conversation, a support call), set transcript_assessment.call_type_conflict to { suspected_type (follow_up, renewal, continuation, support_existing_customer, no_conversation or other_unclassified), segment, quote (exact text that shows it), explanation }. Otherwise set it to null. A mention of the webinar alone is not a reason to suspect another type.

== CATEGORY 01: INTRODUCTION (applies to new webinar-attendee prospect calls) ==
Opening phase: from the salesperson's first speech after the call connects through the salesperson's first discovery question (about the prospect's reasons, background or goals) or first substantive pitch statement, whichever comes first.
Element timing states: "on_time" = first clear occurrence inside the opening phase (a statement prompted by the prospect inside the opening phase, e.g. the prospect asks who is calling, is still on time: set prompted_by_prospect true). "late" = first clear occurrence AFTER the opening phase and clearly communicating the same introductory behaviour in context (an unrelated mention of a keyword elsewhere does not count). "never" = not found anywhere in the readable transcript. "not_observable" = could have occurred where the transcript has no usable evidence (recording begins midway, gap, garbled window).
Scoring counts only on_time elements. If no element is on time but at least one is late, the maximum is 1.
C01-01 Self and team introduction. Elements: N (the salesperson gives their own name); F (says they are calling from FlexiFunnels); T (says they are from the Mentoring Team; "Senior" is not required; "sales team" or "support team" does not satisfy T). Greetings alone, the prospect's name, or "FlexiFunnels" used in another sense do not count. 3 = N, F and T all on time; 2 = exactly two on time; 1 = exactly one on time, or none on time but at least one late; 0 = none demonstrated at all.
C01-02 Purpose of the call. Elements: P1 (the call is described as a personalised / 1:1 session); P2 (the salesperson COMMUNICATES that the prospect was specifically selected or invited, not contacted generically). Assess only the communication of selection; do not judge whether it is true. The number 20, the webinar mention and "to understand your challenges" are optional and unscored. The approved script wording ("we have selected 20 people who attended the webinar for a personalised 1-1 call") is not flagged; flag non-scripted checkable factual claims (a specific number of people, a deadline, a prize or special benefit, an earnings or results claim) as "unverified_claim". 3 = P1 and P2 on time; 2 = exactly one on time; 1 = a purpose is given but not the intended one (generic or product-led, e.g. "to tell you about our offer"), or no element on time but one late; 0 = no purpose stated, the salesperson goes straight to questions or pitch.
C01-03 Expectation setting. Elements: X1 (a time frame within 15-25 minutes, e.g. "20 minutes", "15-20", "20-25"; a figure or range outside it such as "5 minutes", "an hour" or "20-30" does not meet X1); X2 (what the call will deliver: a personalised solution, or an equivalent statement that the salesperson will understand the prospect's situation or challenges and offer a tailored solution). Actual call duration and "is this a good time?" are not evaluated. 3 = both on time; 2 = exactly one on time (including X2 plus a duration outside 15-25); 1 = an expectation is voiced meeting neither element (e.g. only "a short call"), or no element on time but one late; 0 = no expectation of any kind stated.
Recording begins midway through the introduction: observed elements are recorded; elements not found are "not_observable" (not "never"). Give 3 only if the observed elements already reach the top band, otherwise NE. If the recording begins after the point where the introduction would have ended, report NE for the unobservable elements, not 0.

== CATEGORY 02: UNDERSTANDING INTENT ==
Five information areas are ALL expected: I1 why the prospect attended the webinar; I2 what they learned from it; I3 (D) how long they have followed FlexiFunnels or Saurabh Sir; I4 (W) why they follow; I5 (S) how they found out about the webinar. The salesperson need not use scripted questions. Information volunteered by the prospect counts as established without a question. An area neither asked nor volunteered is missing. Search the WHOLE transcript (a question asked later still counts for C02-01 to C02-03; sequence is judged only in C02-06).
Definitions:
- Qualifying question: addressed to the prospect, about one of the five areas, open and neutral (does not supply or presuppose the answer, no pressure). Leading or assumptive questions do not qualify.
- Information established: the prospect's OWN statement, attributable to the prospect, readable, and specific enough to state the fact. The salesperson's restatement does not establish it. A bare "yes"/"haan" to something the salesperson supplied establishes agreement only, not the information. A question without a meaningful answer establishes nothing.
- Specific learning (I2): a particular topic, idea, method or lesson from the webinar; "it was good" or "I learned a lot" is not specific. One specific learning is enough; three are not required.
- Substantive answer: a distinct prospect answer on one of the five areas giving at least one concrete idea (topic, reason, event, name, duration). Count in transcript order; one statement giving ideas for two areas counts as two; a later answer counts separately only if it adds a new concrete idea; generic, evasive or unclear answers are not substantive (they are C02-05 events).
- Unclear answer: vague (generic), incomplete, contradictory with something said earlier, or evasive.
- Reflection: the salesperson accurately restates, paraphrases or builds on a specific idea the prospect communicated (next relevant turn, or a later turn clearly tied to it). "Okay", "right", "hmm", "accha" alone are acknowledgements, not reflection. A generic scripted question unrelated to the answer is not reflection.
- Neutral follow-up: a question built on a specific word or idea (keyword) in the prospect's answer that is open and not leading, assumptive or pressuring.
- Clarification attempt: a question aimed at the unclear point, rephrased or more specific, neutral, not a verbatim repeat, not pressuring (a later clarification counts if clearly tied to the earlier unclear answer).
- Genuine attempt (to understand the prospect's purpose, I1): a qualifying question about I1 AND, where the answer was absent, unclear or evasive, at least one clarification attempt, unless the prospect clearly declined to give the information. A simple unanswered question without a reasonable clarification attempt is NOT a genuine attempt.
- Respectfully proceeding: after the prospect remains unwilling or unable, the salesperson acknowledges it, does not keep pressing, does not invent an assumed purpose, and does not treat the missing answer as consent or interest.
- Premature pitch: a persuasive statement to the prospect about FlexiFunnels features, benefits, results, price, offers or deadlines, or an invitation to pay or enroll, made before the prospect's purpose (I1) was established or genuinely attempted. NOT a premature pitch: describing the call's purpose or process; a brief factual acknowledgement of the webinar; a brief factual answer to a question the prospect asked, if the salesperson then returns to discovery.
- Understanding check (C02-01 to C02-03): information the prospect established is not later contradicted, replaced or re-asked by the salesperson as if unanswered; failure caps the criterion at 2.
One-incident-once: count one behaviour under ONE criterion only. Missing or generic information -> C02-01 to C02-03. Contradiction or re-asking of established information -> the understanding-check cap in C02-01 to C02-03 only. Answer ignored, only acknowledged, or met with a generic move-on -> C02-04 only. Unclear answer not clarified -> C02-05 only. Pitch before purpose or assumed intent -> C02-06 only.
C02-01 Purpose of attendance (I1). Elements: Q (a qualifying question was asked, or the purpose was volunteered); A (a specific reason was established; state "partial" if only generic such as "to learn more"). 3 = Q and a specific A and the understanding check passes; 2 = generic only (not clarified), or the understanding check fails; 1 = a question was asked but no usable information was established (no answer, off-topic), or the only "information" came from the salesperson's leading or assumptive statement with at most a bare agreement; 0 = no qualifying question and nothing volunteered anywhere (absence record required) and not a case where the prospect ended the call first.
C02-02 Webinar learnings (I2). Elements: Q, A (at least one SPECIFIC learning; "partial" if only generic). Same scoring structure as C02-01.
C02-03 Following history and source of interest (I3, I4, I5). Elements D (how long they have followed), W (why they follow), S (how they found the webinar). Judge each separately and give element_details for D, W and S: asked, volunteered, established (yes / partial / no / not_transcribed), the prospect's exact quote and the segment. "partial" = addressed but generic. 3 = D, W and S all established and the understanding check passes; 2 = exactly two established, or all three established but the understanding check fails; 1 = exactly one established, or none established but at least one asked; 0 = none asked and none volunteered (absence record; state per element in the explanation).
C02-04 Reflection and follow-up on the prospect's answers (basis: cross-cutting questioning guidance; provisional calibration). Unit: each substantive answer. Reflection threshold (provisional, project-owner-approved rule): required reflected = n if n <= 2, otherwise ceil(0.75 x n). Follow-up condition for a 3: neutral keyword-based follow-ups on at least two distinct substantive answers, or on the sole substantive answer if only one exists. Response types: R reflection, F neutral keyword follow-up, A bare acknowledgement, L non-neutral follow-up (leading, assumptive, pressuring), G generic move-on. 3 = reflection threshold met AND follow-up condition met; 2 = at least one reflection or at least one neutral follow-up but not both conditions for 3; 1 = no reflection and no neutral follow-up, but at least one bare acknowledgement or non-neutral follow-up; 0 = every substantive answer met only with a generic move-on. Report counts: substantive_answers, reflected_answers, neutral_followups_on_distinct_answers. Elements: R (reflection threshold met), F (follow-up condition met), N (follow-ups were neutral). N/A (reason "no_substantive_answer") only if there is genuinely no substantive answer; N/A must not hide a failure to ask (that is scored in C02-01 to C02-03).
C02-05 Clarification of unclear answers (provisional basis). Unit: each unclear-answer event. Elements: C (a clarification attempt was made), R (resolved, or acknowledged as unresolved with respectful proceeding). 3 = every substantive unclear-answer event clarified with a clarification attempt and resolved, or respectfully left unresolved with acknowledgement; 2 = some events clarified and others passed over, or a clarification attempted but left unresolved with no acknowledgement; 1 = an attempt exists but is poor (leading, assuming the answer, pressuring, verbatim repetition only, wrong target); 0 = at least one unclear-answer event with no clarification attempt anywhere and the salesperson proceeds as if the answer were clear. N/A (reason "no_unclear_answer") if no unclear-answer event occurred.
C02-06 Intent established before advancing or pitching (provisional basis). Elements: V1 (no premature pitch before the purpose was established or genuinely attempted, with respectful proceeding if the prospect stays unwilling), V2 (no assumed intent: the salesperson does not state the prospect's intent, goals or interest as fact before the prospect said it, and does not treat webinar attendance as intent to buy). A question alone never earns 3. 3 = purpose established before pitching; OR a genuine attempt (qualifying question plus a clarification attempt where appropriate), the prospect remains unwilling or unable, and the salesperson respectfully proceeds; no premature pitch and no assumed intent. 2 = ONE brief premature-pitch lapse after which the salesperson returns to discovery (a single isolated assumed-intent statement corrected by a question is treated the same). 1 = sustained or repeated premature pitching, repeated assumptions about intent, or pitching at length before the purpose was established, including a question asked but pitching proceeding without an answer and without a reasonable clarification attempt, and premature pitching not followed by a return to discovery. 0 = the call moves into pitching, an offer or closing with NO attempt to understand the prospect's purpose anywhere. N/A (reason "no_transition_observed") if no pitch, offer, price or closing statement and no assumed-intent behaviour occurs in the observable conversation; there is no automatic 3 for the absence of a pitch.
Prospect not interested or only learning: this never lowers a score by itself; evaluate whether the salesperson understood and responded accurately and respectfully. Ignoring or pressuring after a stated lack of interest earns no credit (flag ignored_stated_disinterest or persistence_after_decline). If the prospect clearly ends the call before the salesperson had a reasonable opportunity to cover an area, the area is "unreached": outcome NE with reason "prospect_ended_call_before_reached" (not 0). If the salesperson had the opportunity and skipped it (including through unnecessary delay or unrelated conversation), score normally. Never infer interruption from the transcript.`;
