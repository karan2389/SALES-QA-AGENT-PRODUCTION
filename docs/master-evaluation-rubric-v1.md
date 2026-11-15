# Master Evaluation Rubric v1.0 (MRV1.0)

Source of truth for the executable definition: `src/mrv1/rubric.ts` (verified by `scripts/mrv1.test.ts`).
Categories 01 and 02 keep the approved detailed rules in `docs/evaluation-rubric-v1.md` (Revision 4) and `src/evaluation/rubric.ts`; MRV1.0 reuses that text and its element checks unchanged.

## Framework

| Decision | Implementation |
|---|---|
| Granularity | Criterion-level (70 sales-stage criteria + 22 psychology criteria) |
| Sales-stage categories | 19, identifiers `C01`..`C19`, criteria `Cnn-mm` |
| Scoring | 0-3, `N/A`, `NE` (never zero) |
| Weighting | Equal across categories; equal across criteria in a category |
| Sales psychology | Separate scorecard `SP-01`..`SP-22`, never merged |
| Combined score | None exists (no field, column or function) |
| Human review | Required; every evaluation, criterion and flag starts `pending` |
| Version | `MRV1.0` (`rubric_versions` table, `evaluations.rubric_version`) |

## Categories and criteria

| Category | Criteria |
|---|---|
| C01 Introduction | 3 |
| C02 Understanding Intent | 6 |
| C03 Customer Persona | 9 |
| C04 Online Business Plan of Action | 3 |
| C05 Monetary Goals | 5 |
| C06 Emotional WHY | 2 |
| C07 Why Now? | 2 |
| C08 Plan Analysis | 3 |
| C09 Challenges | 3 |
| C10 Knowledge Gap | 2 |
| C11 How Will FlexiFunnels Help? | 2 |
| C12 Past Experiences | 3 |
| C13 Pain Exaggeration | 2 |
| C14 Testimonials | 3 |
| C15 USP | 5 |
| C16 YES Mode | 5 |
| C17 Closing Questions | 4 |
| C18 Objection Handling | 4 |
| C19 Their Objections = Best Case Scenario | 4 |

Criterion names are listed in `src/mrv1/rubric.ts`. Category guidance given to the model (what must not be rewarded, e.g. borrowing, fake urgency, invented features) is in `src/mrv1/prompt.ts` (`GUIDANCE`).

## Scores

0 not demonstrated or materially failed (needs an absence record) · 1 weak · 2 mostly · 3 fully · N/A not applicable (reason mandatory) · NE not evaluable (reason mandatory).

- Category % = sum of numeric scores / (3 x number of numeric criteria) x 100.
- Sales-stage score = average of the applicable category percentages (never pooled over criteria; the Google Sheets score uses the same rule).
- N/A leaves numerator and denominator. NE does too and marks the category **provisional**. A category that is entirely N/A is excluded; one that is entirely NE cannot be scored (shown `NE`).
- Any provisional category makes the overall result **provisional** (labelled, not definitive). Held, unsupported, invalidated, blocked or incomplete evaluations publish no number.
- Sales Psychology % uses the same formula over the 22 SP criteria and is reported separately.

## Call types

| Stored label | MRV1.0 behaviour |
|---|---|
| `new_webinar_prospect` (= spec `new_webinar_attendee`) | All 19 categories |
| `continuation` | C01 and C02 are N/A (`call_type_not_covered`); C03-C19 assessed |
| missing, `unknown`, `unconfirmed`, or not human-confirmed | Held; no model call |
| `follow_up`, `renewal`, `support_existing_customer`, `no_conversation`, `other_unclassified` | Unsupported: reason recorded (`unsupported_call_type`), no normal evaluation, human review required |

The spec name `new_webinar_attendee` is accepted, but the stored label stays `new_webinar_prospect` because the existing `call_type_labels` CHECK constraint cannot be altered. A changed human-confirmed label invalidates the call's valid evaluations made under a different type (status `superseded`, nothing deleted).

## Ethical flags

`misleading_product_claim`, `false_earnings_promise`, `fake_urgency`, `financial_pressure`, `refusal_not_respected`, `misrepresented_support`, `fabricated_social_proof`, `coercive_emotional_pressure`, `unsupported_customer_fit`, `unprofessional_conduct`. Flags never change a score and stay visible regardless of scores.

## Open items (not decided by this implementation)

- The approved Objection Doc has not been supplied, so C18 judges identification, clarification, relevance and accuracy only; it never rewards "approved" wording.
- C03-C19 now have criterion-specific scoring anchors (`src/mrv1/anchors.ts`, prompt version `mrv1-prompt-v2`); they are NOT element-level rules like C01/C02 Revision 4, they have not been approved by the owner, and they have not been calibrated against human reviewers. The Sales Psychology criteria use the category guidance only.
- Calibration of every new criterion against human reviewers has not been done.
