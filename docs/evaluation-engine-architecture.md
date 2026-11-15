# MRV1.0 evaluation engine: architecture

All new code is in `src/mrv1/`. The existing C01/C02 pipeline (`src/evaluation/`), transcription, Callyzer, R2 and the Sheets export are unchanged except where noted at the end.

## Modules

| File | Responsibility |
|---|---|
| `rubric.ts` | Versioned definitions (19 categories, 70 criteria, 22 SP criteria), flag ids, call-type applicability, model pass plan |
| `prompt.ts` | One prompt per pass; reuses the approved C01/C02 text verbatim; category guidance; output spec |
| `validate.ts` | Strict schema validation, evidence verification, timestamps derived from segments, C01/C02 element caps |
| `flags.ts` | Flag validation, quotation verification, protected-characteristic guard, lexical candidate scan |
| `scoring.ts` | Category, sales-stage and psychology scores (deterministic; the model never scores) |
| `engine.ts` | Gated orchestration, retries, duplicate handling, persistence call |
| `report.ts` | 14-section report from validated data |
| `d1-store.ts` | D1 persistence (atomic batch) |

## Gates

1. **Recording**: stored audio must exist and be at least 90% of the logged duration (duration derived from size at 32 kbps CBR). Otherwise **hold**.
2. **Transcript** (`transcript-gate.ts`): several indicators with machine-readable codes (timestamps, ordering, broken encoding, repetition loops, empty segments, word count and diversity, where the transcript ends, large untranscribed stretches, romanised-Hindi under an English label, label versus script). Decisions: `eligible`, `incomplete_transcript`, `suspected_language_mismatch`, `insufficient_speech`, `corrupted_transcript`, `requires_human_review`. Anything but `eligible` is a **hold** with `decision` and `reason_codes`; only `requires_human_review` can proceed, with an explicit human acknowledgement. Silence alone never rejects. After the model passes, a model rating of low reliability, poor speaker attribution or wrong language **blocks** the published number (the evaluation is stored for review).
3. **Call type**: must be a human-confirmed label on file (never inferred). Unknown/unconfirmed: **hold**. Unsupported: recorded, no model. A transcript that suggests a different type: **hold** until a human acknowledges.
4. **Evaluation**: four model passes (C01-C06, C07-C12, C13-C19, Sales Psychology + report data) through the existing Workers AI GPT-OSS 120B binding, so no single response holds about 90 criteria. Transient failures are retried once per pass; truncation is not retried.
5. **Output validation**: every pass is validated before anything is used. Failure of any pass means nothing is stored.
6. **Human review**: stored `pending` (evaluation, each criterion, each flag).
7. **Export**: `exportEligibility` and the `valid_*` views; test-only, invalidated and unsupported evaluations are never exported.

## Validation rules (code, not model)

- Criterion ids must match the pass exactly (no missing, extra or duplicate ids).
- Scores 1-3 need at least one quotation found (after Unicode normalisation) in the cited segments; otherwise the criterion becomes **NE** (`missing_evidence` / `quote_not_verifiable`), never 0.
- A 0 needs an absence record with a verifiable excerpt; otherwise **NE**.
- N/A and NE need a reason code from the allowed list. N/A on C01/C02 only with approved codes.
- Timestamps are computed from the cited segment numbers; model-supplied times are not used.
- C01/C02 scores above what the reported elements allow are capped (existing `maxScoreAllowed`); missing call opening turns absent or partial behaviour into NE.
- Prospect profile values without evidence are dropped ("Not established"). Coaching priorities need an observed issue, an action, a better-behaviour example and segment references; more than three are truncated with a warning.
- Flags: schema checked, quotation verified; confirmed conduct without a verified quotation is downgraded to ambiguous; explanations resting on protected characteristics are never confirmed and go to human review.

## Persistence

Reused: `evaluations` (header, `rubric_version = 'MRV1.0'`), `evaluation_criteria` (C01-C19 rows), `evaluation_reviews`, `evaluation_invalidations`, `valid_*` views, `call_type_labels`.
Added by `migrations/0006_mrv1_evaluation_engine.sql` (additive): two columns on `evaluation_criteria`, `rubric_versions`, `evaluation_sp_criteria`, `evaluation_scores`, `evaluation_flags`, `evaluation_score_corrections`, `evaluation_reports`.

Duplicate prevention uses the existing `UNIQUE (call, rubric_version, prompt_version)`. Because invalidated evaluations are never deleted, a re-evaluation after invalidation takes the next revision slot (`mrv1-prompt-v1#r2`, `#r3`, ...).

## Changes outside `src/mrv1/`

- `src/evaluation/validate.ts`: `validateCriterion` is now exported (no behaviour change).
- `src/evaluation/d1-store.ts`: `recordCallTypeLabel` now also invalidates (status `superseded`) the call's valid evaluations whose call type differs from a newly confirmed one. Previously a changed label left the old evaluation valid.
- `src/index.ts`: new route `POST /admin/mrv1/evaluate/<callyzer id>` (admin token, `dry_run=1` supported).
- `src/sheets/rows.ts`, `score.ts`, `d1-export-store.ts`: MRV1.0-aware scoring and loading (see Google Sheets below); legacy C01/C02 scoring changed from pooled to category-average and labelled partial.
- `tsconfig.scripts.json`, `package.json` (`test:mrv1`, `test:sheets`, `benchmark:mrv1`, `validation:template`).

## Google Sheets

The agent worksheets keep the approved 15-column, one-row-per-call layout (no header change, so existing tabs are not disturbed). `scoreForRecord` in `src/sheets/rows.ts` chooses the score by rubric version. MRV1.0: Overall Call Score = equal-weight average of the applicable category percentages over all 19 categories (provisional when any NE), with the separate Sales Psychology score, category scores and critical flags in the Feedback column. Legacy C01/C02 evaluations show an average of the two category percentages labelled `(partial: C01-C02 only)`. Unsupported-call-type evaluations are never exported. Nothing was exported.

## Known limits

- The route runs four model passes in one request (each up to the 280 s model timeout). This is **not demonstrated safe**: see `docs/mrv1-execution-architecture.md` and `docs/mrv1-benchmark-results.md`.
- Transcript language correctness and speaker attribution are judged by the model and by human review; there is no deterministic detector.
