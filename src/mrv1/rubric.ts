// Master Evaluation Rubric v1.0 (MRV1.0): 19 sales-stage categories, a separate 22-criterion Sales Psychology and Conduct scorecard,
// ethical flags and call-type applicability. Stable identifiers are used by the database, API responses and Google Sheets.
// Categories 01 and 02 keep their previously approved detailed rules (src/evaluation/rubric.ts, docs/evaluation-rubric-v1.md Rev 4);
// this file only adds the criterion list for them so that all 19 categories share one definition.
import { CRITERIA as C01_C02_DETAIL } from "../evaluation/rubric.ts";

export const MRV1_VERSION = "MRV1.0";
export const MRV1_PROMPT_VERSION = "mrv1-prompt-v2"; // v2: criterion-specific anchors for C03-C19

export interface Mrv1Criterion {
  id: string;
  category_id: string;
  name: string;
}
export interface Mrv1Category {
  id: string;
  name: string;
  purpose: string;
  criteria: Array<{ id: string; name: string }>;
}

const cat = (n: number, name: string, purpose: string, criteria: string[]): Mrv1Category => {
  const id = `C${String(n).padStart(2, "0")}`;
  return { id, name, purpose, criteria: criteria.map((c, i) => ({ id: `${id}-${String(i + 1).padStart(2, "0")}`, name: c })) };
};

export const CATEGORIES: Mrv1Category[] = [
  cat(1, "Introduction", "Establish identity, call purpose and expectations.", ["Introduce self and team", "Explain purpose of the call", "Set expectations"]),
  cat(2, "Understanding Intent", "Understand webinar attendance and the prospect's interest in FlexiFunnels/Saurabh Sir.", ["Purpose of attendance", "Webinar learnings", "Following history and source of interest", "Reflection and follow-up", "Clarification of unclear answers", "Intent established before advancing"]),
  cat(3, "Customer Persona", "Understand the prospect's actual professional and business situation.", ["Current occupation", "Business and offer", "Marketing channels", "Target customers", "Sales channels", "Product/service price range", "Monthly customers served", "Annual revenue", "Team size"]),
  cat(4, "Online Business Plan of Action", "Explore the intended online business model, offer, course or growth direction.", ["Proposed online business plan", "Offer or course direction", "Relevant follow-up and depth"]),
  cat(5, "Monetary Goals", "Explore financial goals, current position, growth expectations and investment constraints respectfully.", ["Revenue goal", "Goal timeline", "Current financial baseline", "Six-to-twelve-month growth target", "Financial constraints"]),
  cat(6, "Emotional WHY", "Understand why the goal matters to the prospect.", ["Personal significance", "Life or family impact"]),
  cat(7, "Why Now?", "Understand why the prospect is considering action now.", ["Current motivation", "Timing and previous delay"]),
  cat(8, "Plan Analysis", "Understand the prospect's existing plan and identify actual gaps.", ["Existing plan", "Plan detail and practicality", "Gap between goal and plan"]),
  cat(9, "Challenges", "Explore obstacles, their impact and why the prospect has not overcome them independently.", ["Identify challenges", "Impact of challenges", "Independent execution"]),
  cat(10, "Knowledge Gap", "Explore missing knowledge, tools, resources, mentorship, support or community.", ["Identify missing knowledge or resources", "Connect the gap to non-execution"]),
  cat(11, "How Will FlexiFunnels Help?", "Ask the prospect how FlexiFunnels could help and connect it to established needs.", ["Prospect's view of solution fit", "Connect perceived help to needs"]),
  cat(12, "Past Experiences", "Understand previous attempts, tools, platforms, courses, agencies and relevant experiences.", ["Previous attempts", "Previous solution experiences", "Lessons and dissatisfaction"]),
  cat(13, "Pain Exaggeration", "Explore realistic consequences of staying in the same situation.", ["Cost of inaction", "Future-state reflection"]),
  cat(14, "Testimonials", "Use relevant, verified customer examples.", ["Relevant testimonial selection", "Share testimonial appropriately", "Explain relevance and context"]),
  cat(15, "Unique Selling Proposition (USP)", "Explain relevant FlexiFunnels differentiators, features, benefits, monetisation, training and support.", ["Relevant differentiation", "Feature-to-benefit connection", "Monetisation opportunities", "Product and support fit", "Competitive positioning"]),
  cat(16, "YES Mode", "Alignment questions that confirm understanding and readiness.", ["Confirm understanding", "Confirm challenge recognition", "Connect solution to goal", "Confirm willingness to address the barrier", "Confirm readiness for next step"]),
  cat(17, "Closing Questions", "Understand non-enrolment, preferred start, payment options and the agreed next step.", ["Understand non-enrolment", "Preferred starting approach", "Payment method discussion", "Agree next step"]),
  cat(18, "Objection Handling", "Address objections one by one with accurate approved responses.", ["Identify the objection", "Clarify underlying concern", "Respond with relevant information", "Confirm resolution or remaining concern"]),
  cat(19, "Their Objections = Best Case Scenario", "Reframe a concern only where a genuine, relevant example or resource supports it.", ["Identify a relevant reframing opportunity", "Provide a relevant example or explanation", "Connect example to available support", "Preserve prospect choice"]),
];

export const SALES_STAGE_CRITERIA: Mrv1Criterion[] = CATEGORIES.flatMap((c) => c.criteria.map((k) => ({ id: k.id, category_id: c.id, name: k.name })));

export const SP_CATEGORY_ID = "SP";
export const SP_CRITERIA: Mrv1Criterion[] = [
  "Follow the sales sequence", "Two-way conversation", "Active listening", "Allow prospect to finish", "Document and use responses", "Appropriate follow-up questions",
  "Logical question transitions", "Complete one stage before advancing", "Clarify evasive or unclear responses", "Monologue control", "Solution-focused communication",
  "Use relevant examples and social proof", "Appropriate training direction", "Diagnostic questioning", "Clear doubts before pitching", "Return to the topic",
  "Avoid unnecessary repetition", "Decision-making authority", "Financial qualification", "Ethical and truthful conduct", "Appropriate customer fit", "Respect for prospect autonomy",
].map((name, i) => ({ id: `SP-${String(i + 1).padStart(2, "0")}`, category_id: SP_CATEGORY_ID, name }));

export const ALL_CRITERIA: Mrv1Criterion[] = [...SALES_STAGE_CRITERIA, ...SP_CRITERIA];

export function criterionById(id: string): Mrv1Criterion | undefined {
  return ALL_CRITERIA.find((c) => c.id === id);
}

/** Only C01 and C02 have element-level approved rules; they are validated with the existing element definitions. */
export const ELEMENT_RULE_DEFS = C01_C02_DETAIL;

// ---- scoring vocabulary ----
export const SCORE_MEANING: Record<string, string> = {
  "3": "Fully demonstrated",
  "2": "Mostly demonstrated",
  "1": "Weakly demonstrated",
  "0": "Not demonstrated or materially failed",
  "N/A": "Not applicable",
  NE: "Not evaluable due to insufficient evidence",
};

/** N/A reasons the model may give for C03-C19 and SP criteria (a reason is mandatory). C01/C02 keep their approved codes. */
export const NA_REASONS_GENERAL = [
  "no_opportunity_arose",
  "not_applicable_to_prospect",
  "prospect_has_no_business",
  "no_material_objection",
  "no_relevant_testimonial_available",
  "sharing_inappropriate",
  "topic_declined_by_prospect",
  "prospect_not_ready",
  "call_type_not_covered",
];

// ---- ethical flags ----
export const FLAG_IDS = [
  "misleading_product_claim",
  "false_earnings_promise",
  "fake_urgency",
  "financial_pressure",
  "refusal_not_respected",
  "misrepresented_support",
  "fabricated_social_proof",
  "coercive_emotional_pressure",
  "unsupported_customer_fit",
  "unprofessional_conduct",
] as const;
export type FlagId = (typeof FLAG_IDS)[number];
export const FLAG_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type FlagSeverity = (typeof FLAG_SEVERITIES)[number];

// ---- call types ----
/** Spec name `new_webinar_attendee` is the same type as the stored label `new_webinar_prospect` (the DB CHECK constraint cannot be altered). */
export const NEW_WEBINAR_TYPES = ["new_webinar_attendee", "new_webinar_prospect"];
export const UNCONFIRMED_TYPES = ["unknown", "unconfirmed"];

export type Applicability =
  | { kind: "evaluate"; na_categories: string[]; na_reason: string | null }
  | { kind: "hold"; reason: string }
  | { kind: "unsupported"; reason: string };

/** Call-type applicability. Never inferred from duration, direction or transcript clues. */
export function applicabilityFor(callType: string | null | undefined, confirmedByHuman: boolean): Applicability {
  if (!callType || UNCONFIRMED_TYPES.includes(callType)) return { kind: "hold", reason: "call type is unknown or unconfirmed: evaluation is held until a human confirms it" };
  if (!confirmedByHuman) return { kind: "hold", reason: "call type has not been confirmed by a human: evaluation is held" };
  if (NEW_WEBINAR_TYPES.includes(callType)) return { kind: "evaluate", na_categories: [], na_reason: null };
  if (callType === "continuation") return { kind: "evaluate", na_categories: ["C01", "C02"], na_reason: "call_type_not_covered" };
  return { kind: "unsupported", reason: `call type "${callType}" is not supported by MRV1.0: no normal sales-stage evaluation is generated; a human must review this call` };
}

// ---- model passes: the evaluation is split so no single model response has to hold ~80 criteria ----
export interface Pass {
  key: string;
  categories: string[]; // category ids; "SP" = sales psychology
  extras: boolean; // also returns flags, coaching, profile, objections, summary
}
export const PASSES: Pass[] = [
  { key: "stages_01_06", categories: ["C01", "C02", "C03", "C04", "C05", "C06"], extras: false },
  { key: "stages_07_12", categories: ["C07", "C08", "C09", "C10", "C11", "C12"], extras: false },
  { key: "stages_13_19", categories: ["C13", "C14", "C15", "C16", "C17", "C18", "C19"], extras: false },
  { key: "psychology_report", categories: ["SP"], extras: true },
];

export function criteriaForPass(p: Pass): Array<Mrv1Criterion & { category_name: string }> {
  const out: Array<Mrv1Criterion & { category_name: string }> = [];
  for (const id of p.categories) {
    if (id === SP_CATEGORY_ID) out.push(...SP_CRITERIA.map((c) => ({ ...c, category_name: "Sales Psychology and Conduct" })));
    else {
      const c = CATEGORIES.find((x) => x.id === id)!;
      out.push(...c.criteria.map((k) => ({ id: k.id, category_id: c.id, name: k.name, category_name: c.name })));
    }
  }
  return out;
}
