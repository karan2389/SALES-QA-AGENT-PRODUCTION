// Ethical flags and score caps.
// A flag is ALWAYS reported, whatever happens to scores. It may additionally cap (never zero) a criterion at 1, but only when ALL of these hold:
//   1. the flag is confirmed_conduct AND its quotation was verified against the transcript (ambiguous or unverified flags never cap);
//   2. the criterion is one the rubric itself says must not be rewarded for that conduct (FLAG_RELATIONS, each with its source and reason);
//   3. the criterion's own cited evidence overlaps the flagged segments (the same behaviour is being credited);
//   4. the criterion currently scores 2 or 3 (a score of 0 or 1 is never lowered, so there is no double penalty);
//   5. no human has dismissed the flag.
// Every cap is recorded as an adjustment carrying the flag ids and segments; the model's original outcome stays on the criterion and the
// pre-cap outcome stays on the adjustment, so a human decision can reverse it exactly (reverseDismissedFlagCaps).
// Flags without a rubric-grounded relationship (unsupported_customer_fit, unprofessional_conduct) never cap anything.
// Sales Psychology criteria are never capped by flags: that scorecard is separate and its own SP-20 to SP-22 criteria already assess conduct.
import type { Adjustment } from "../evaluation/types.ts";
import type { Mrv1Criterion, Mrv1Flag } from "./types.ts";

export interface FlagRelation {
  criterion_id: string;
  /** Why this criterion is affected, quoting the rubric source. */
  why: string;
}

export const FLAG_RELATIONS: Record<string, FlagRelation[]> = {
  fake_urgency: [
    { criterion_id: "C07-01", why: "C07 (Why Now?): 'do not reward manufactured urgency or fake deadlines'; a salesperson-imposed deadline is not the prospect's motivation." },
    { criterion_id: "C07-02", why: "C07: timing and previous delay must come from the prospect; manufactured urgency earns nothing." },
    { criterion_id: "C13-01", why: "C13 (Pain Exaggeration): the cost of inaction must be realistic; urgency invented to pressure is not rewarded." },
    { criterion_id: "C17-04", why: "C17: the next step must be mutually agreed; a step produced by a fake deadline is not an agreed step." },
  ],
  financial_pressure: [
    { criterion_id: "C05-05", why: "C05 (Monetary Goals): 'never reward financial pressure or encouragement to borrow money or use essential funds'." },
    { criterion_id: "C17-03", why: "C17: payment discussion is not credited when it pressures the prospect to borrow or use essential funds." },
    { criterion_id: "C19-01", why: "C19: 'do not turn financial inability into a reason to borrow'; such a reframe is not a valid reframing opportunity." },
  ],
  coercive_emotional_pressure: [
    { criterion_id: "C06-01", why: "C06 (Emotional WHY): 'never reward guilt, shame or emotional manipulation'." },
    { criterion_id: "C06-02", why: "C06: family and life impact is sensitive; using it as pressure earns nothing." },
    { criterion_id: "C13-01", why: "C13: 'never reward fearmongering, shame or fabricated consequences'." },
  ],
  fabricated_social_proof: [
    { criterion_id: "C14-01", why: "C14 (Testimonials): 'do not invent testimonials'; an invented example is not a relevant testimonial." },
    { criterion_id: "C14-02", why: "C14: a fabricated testimonial is not shared appropriately." },
    { criterion_id: "C19-02", why: "C19: 'unsupported success stories' are not a relevant example or explanation." },
  ],
  false_earnings_promise: [
    { criterion_id: "C14-02", why: "C14: 'do not guarantee similar outcomes'." },
    { criterion_id: "C15-03", why: "C15 (USP): monetisation opportunities may be explained but earnings must not be promised." },
    { criterion_id: "C19-02", why: "C19: 'do not guarantee another customer's result'." },
  ],
  misrepresented_support: [
    { criterion_id: "C15-04", why: "C15: 'do not promise' unapproved mentoring, support, response times or training in the product and support fit." },
    { criterion_id: "C19-03", why: "C19: 'do not misrepresent training, support or product capabilities' when connecting an example to available support." },
  ],
  misleading_product_claim: [
    { criterion_id: "C15-01", why: "C15: 'do not invent features, availability, pricing, support commitments or launch dates' in the differentiation." },
    { criterion_id: "C15-02", why: "C15: a feature-to-benefit statement built on an invented feature is not credited." },
    { criterion_id: "C15-05", why: "C15: competitive positioning must not rest on unsupported claims about competitors or the product." },
    { criterion_id: "C17-03", why: "C17: payment options that do not exist are not a payment method discussion." },
    { criterion_id: "C19-03", why: "C19: 'do not misrepresent training, support or product capabilities'." },
  ],
  refusal_not_respected: [
    { criterion_id: "C16-05", why: "C16: readiness for the next step is checked, not pressed after a refusal." },
    { criterion_id: "C17-04", why: "C17: pressure after a refusal is not a mutually agreed next step." },
    { criterion_id: "C19-04", why: "C19: 'do not use pressure after a refusal'; the prospect's choice must be preserved." },
  ],
};

/** Flags that deliberately cap nothing, with the reason. They remain fully visible in reports. */
export const FLAGS_WITHOUT_CAPS: Record<string, string> = {
  unsupported_customer_fit: "The rubric names no sales-stage criterion that this conduct invalidates; customer fit is assessed in SP-21 (separate scorecard).",
  unprofessional_conduct: "General conduct is assessed in SP-20 and SP-22 (separate scorecard); no sales-stage criterion is justifiably affected.",
};

/** criterion ids affected per flag (derived; used by tests and docs). */
export const FLAG_CRITERIA: Record<string, string[]> = Object.fromEntries(Object.entries(FLAG_RELATIONS).map(([k, v]) => [k, v.map((r) => r.criterion_id)]));

export function capEligibleFlag(f: Mrv1Flag): boolean {
  return f.interpretation === "confirmed_conduct" && f.verification_status === "quote_verified" && f.human_review_decision !== ("dismissed" as string) && f.flag_id in FLAG_RELATIONS;
}

/** Mutates `criteria` (the freshly built evaluation) and appends one traceable adjustment per capped criterion. */
export function applyFlagCaps(criteria: Mrv1Criterion[], flags: Mrv1Flag[], adjustments: Adjustment[]): void {
  const eligible = flags.filter(capEligibleFlag);
  for (const c of criteria) {
    if (c.category_id === "SP" || !(c.outcome === "2" || c.outcome === "3")) continue;
    const causes = eligible.filter((f) => FLAG_RELATIONS[f.flag_id].some((r) => r.criterion_id === c.criterion_id) && c.evidence.some((e) => f.segments.some((s) => s >= e.segment_start && s <= e.segment_end)));
    if (causes.length === 0) continue;
    const refs = causes.map((f) => ({ flag_id: f.flag_id, segments: f.segments }));
    const why = [...new Set(causes.map((f) => FLAG_RELATIONS[f.flag_id].find((r) => r.criterion_id === c.criterion_id)!.why))].join(" ");
    adjustments.push({
      criterion_id: c.criterion_id, from: c.outcome, to: "1", kind: "flag_cap", flag_refs: refs,
      reason: `capped at 1 (not zeroed) because the cited evidence overlaps confirmed, quote-verified ${[...new Set(refs.map((r) => r.flag_id))].join(" + ")}. ${why}`,
    });
    c.model_original_outcome = c.model_original_outcome ?? c.outcome;
    c.outcome = "1";
    c.score = 1;
  }
}

export interface FlagDecision {
  flag_id: string;
  segments: number[];
  decision: "pending" | "confirmed" | "dismissed" | "needs_discussion";
}
const sameFlag = (a: { flag_id: string; segments: number[] }, b: { flag_id: string; segments: number[] }) => a.flag_id === b.flag_id && a.segments.join(",") === b.segments.join(",");

/**
 * The criteria as they stand once humans have ruled on flags: a cap is lifted only when EVERY flag that caused it was dismissed.
 * Pure: returns new criteria and leaves the stored evaluation untouched (the stored evaluation is evidence of what the model and the rules produced).
 */
export function reverseDismissedFlagCaps(criteria: Mrv1Criterion[], adjustments: Adjustment[], decisions: FlagDecision[]): Mrv1Criterion[] {
  return criteria.map((c) => {
    const cap = adjustments.find((a) => a.criterion_id === c.criterion_id && a.kind === "flag_cap");
    if (!cap || !cap.flag_refs || cap.flag_refs.length === 0) return c;
    const allDismissed = cap.flag_refs.every((r) => decisions.some((d) => d.decision === "dismissed" && sameFlag(d, r)));
    if (!allDismissed) return c;
    const others = adjustments.some((a) => a.criterion_id === c.criterion_id && a.kind !== "flag_cap");
    const restored = cap.from;
    return { ...c, outcome: restored, score: /^[0-3]$/.test(restored) ? Number(restored) : null, model_original_outcome: others ? c.model_original_outcome : null };
  });
}
