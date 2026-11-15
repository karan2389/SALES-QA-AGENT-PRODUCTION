# Ethical flags and score caps (audit, Phase 2)

Code: `src/mrv1/flag-caps.ts`. Tests: `scripts/mrv1-scoring-audit.test.ts`.

**Status: the narrowed relationship table below was approved by the project owner on 2026-11-15.**

## Principle

Flags are **always reported**. A flag may additionally cap (never zero) a sales-stage criterion at **1** only when every condition holds: the flag is `confirmed_conduct` and its quotation was verified; the criterion is one the rubric itself says must not be rewarded for that conduct; the criterion's own cited evidence overlaps the flagged segments; the criterion currently scores 2 or 3; and no human dismissed the flag. Otherwise nothing is capped. If a relationship is not clearly grounded in the rubric, there is no cap.

## Audit result: the previous relationship table was too broad

The first version linked several criteria without a rubric basis. These links were **removed**: fake_urgency to C13-02, C17-02, C19-01, C19-04; financial_pressure to C19-02, C19-04; coercive_emotional_pressure to C13-02, C19-04; false_earnings_promise to C19-03; misleading_product_claim to C11-02. `unsupported_customer_fit` and `unprofessional_conduct` cap nothing (their conduct is assessed in the separate scorecard, SP-20 to SP-22). **This was a behaviour change from the previous round; the owner approved it on 2026-11-15** (no real evaluation was affected: none exists).

## Relationships kept (each has its rubric reason in `FLAG_RELATIONS`)

| Flag | Criteria it can cap | Basis |
|---|---|---|
| fake_urgency | C07-01, C07-02, C13-01, C17-04 | C07 "do not reward manufactured urgency"; C13 realistic cost of inaction; C17 next step must be agreed |
| financial_pressure | C05-05, C17-03, C19-01 | C05 "never reward financial pressure or borrowing"; C17 payment; C19 "do not turn financial inability into a reason to borrow" |
| coercive_emotional_pressure | C06-01, C06-02, C13-01 | C06 "never reward guilt, shame or emotional manipulation"; C13 "never reward fearmongering or shame" |
| fabricated_social_proof | C14-01, C14-02, C19-02 | C14 "do not invent testimonials"; C19 unsupported success stories |
| false_earnings_promise | C14-02, C15-03, C19-02 | C14 no guaranteed outcomes; C15 monetisation without promised earnings; C19 no guaranteed results |
| misrepresented_support | C15-04, C19-03 | C15 and C19 prohibit unapproved support or training promises |
| misleading_product_claim | C15-01, C15-02, C15-05, C17-03, C19-03 | C15 no invented features, pricing or competitor claims; C17 invented payment options; C19 product misrepresentation |
| refusal_not_respected | C16-05, C17-04, C19-04 | pressure after a refusal is not readiness, an agreed step or preserved choice |

Sales Psychology criteria are never capped by flags.

## Traceability

Each cap is an adjustment `{ kind: "flag_cap", from, to: "1", flag_refs: [{flag_id, segments}], reason }`; the criterion keeps `model_original_outcome` and its evidence. A criterion already at 0 or 1 is not touched (no double penalty). Several flags on the same criterion produce one adjustment listing all causes. Other rules also set `kind` (`evidence`, `element_cap`, `prospect_answer_cap`).

## Human review

`reverseDismissedFlagCaps` returns the criteria as they stand after humans rule on flags: a cap is lifted only if **every** flag that caused it is dismissed, restoring the pre-cap outcome exactly; confirmed, pending or different-instance decisions leave it; a prior non-flag adjustment keeps its marker. It is pure: the stored evaluation is not changed. **Not yet wired**: there is no review endpoint that records flag decisions or recomputes stored scores; `evaluation_flags.human_decision` exists (migration 0006) but nothing writes it yet. Disputed flags stay in every report regardless.

## Invalidation and re-evaluation

A capped evaluation is invalidated like any other (rows, flags and `model_original_outcome` are kept); re-evaluation takes a new revision slot and re-applies the rules to the new output.
