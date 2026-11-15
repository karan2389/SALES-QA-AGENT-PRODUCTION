# MRV1.0 human validation procedure

**Status: prepared, not performed.** Passing unit tests proves plumbing and validation. It does not show that GPT-OSS evaluates real sales conversations accurately. Until the procedure below has been run on approved recordings and the owner has accepted the results, MRV1.0 scores must not drive sales-quality decisions, and nobody should say the model is accurate.

Code: `src/mrv1/validation-metrics.ts` (metrics and review template), `scripts/validation-template.ts` (CSV generator). Tests use invented data only (`scripts/mrv1-validation-metrics.test.ts`).

## 1. Who and what

- **Reviewers:** at least two people who know the sales process. They do not see each other's scores. A third person resolves differences.
- **Sample:** approved recordings only, owner-selected, covering all call types in scope and at least one clearly good, one clearly poor and one difficult-audio call. The code treats fewer than **10 evaluations or 300 reviewed criteria as too small for any claim** (`MIN_EVALUATIONS_FOR_CLAIMS`, `MIN_CRITERIA_FOR_CLAIMS`). These numbers are provisional: the owner sets the real ones and the acceptance thresholds before the run.
- **Order of work:** the reviewer listens to the recording and scores each criterion **before** reading the model's score and explanation (blind first pass), then opens the model output and fills the evidence columns.

## 2. Materials (generated, not hand-made)

1. The owner exports the `result_json` of an evaluation row to a local file.
2. `node scripts/validation-template.ts result.json <evaluation_id> review-<id>` writes three CSVs: criteria (92 rows), flags (model-raised flags), missed flags (empty, for flags the model failed to raise).
3. Reviewers fill the human columns. Do not edit the model columns.

## 3. What the reviewer records

### A. Criterion score agreement (one row per criterion)

| Column | Meaning |
|---|---|
| `human_outcome` | 0, 1, 2, 3, N/A or NE, chosen from the recording using the rubric anchors |
| `agreement` | exact / within one point / N/A-NE class differs / differs more (computed afterwards from the two scores) |
| `disagreement_reason` | wording of the criterion, transcript error, missed evidence, wrong anchor, reviewer error, other |

### B. Evidence accuracy

`evidence_quote_exists` (the quotation is in the transcript), `timestamp_correct`, `speaker_correct` (salesperson or prospect named correctly), `explanation_accurate` (reflects what was said), `recommendation_relevant` (specific to this call, not generic). Each is yes, no or blank when not assessed.

### C. N/A and NE accuracy

The reviewer uses the same three-way split as the model: **not applicable** (the criterion does not apply), **not evaluable** (evidence insufficient: audio, transcript or speaker), **not demonstrated** (applicable, evidence adequate, behaviour absent = 0). Typical errors to note: NE used where audio was clear; 0 used where the transcript was unreadable; N/A used for a topic that did arise.

### D. Ethical flags

For each model flag: `supported (yes/no)`, `severity_appropriate`, `should_be_ambiguous` (the model said confirmed conduct but the evidence supports only a possible reading). For flags the model missed: the missed-flags file (flag id, time, comment). Protected-characteristic reasoning (accent, education, disability, military status and similar) is always recorded as an error if it appears.

### E. Scoring consistency

Computed by code, not by reviewers. The reviewer confirms only that the category scores shown in the report are consistent with the criterion scores they can see, that categories count equally, that Sales Psychology is shown separately, and that an evaluation containing NE is labelled provisional.

## 4. Metrics (`computeValidationMetrics`)

| Metric | Definition |
|---|---|
| Exact criterion-score agreement | share of reviewed criteria where model and human outcome are identical (0-3, N/A, NE) |
| Agreement within one point | among criteria both scored numerically, share differing by at most 1 |
| N/A / NE classification agreement | share where both fall in the same class (numeric, N/A, NE), plus a confusion matrix |
| Evidence traceability rate | share of model-scored non-zero criteria whose quotations were all verified against the transcript by code |
| Unsupported evidence rate | share of human-assessed items where the quotation was NOT found |
| Timestamp, speaker, explanation, recommendation rates | share marked correct among assessed items |
| Ethical-flag precision | supported model flags / model flags reviewed |
| Ethical-flag recall | supported flags / (supported + missed flags): only where humans labelled ground truth |
| Confirmed-but-ambiguous | model flags marked confirmed that a human reads as ambiguous |
| Category-score difference | mean absolute difference between model and human category percentages (only where both exist), human percentages recomputed from human outcomes |
| Overall and Sales Psychology score difference | mean absolute difference, reported separately; only for fully reviewed evaluations |
| Provisional-status agreement | share where the model and the human outcomes give the same overall status |
| Per-criterion exact agreement | to find criteria whose anchors need rewriting |

The output carries `sufficient_for_claims` and a caveat text; below the threshold the figures describe the sample only.

## 5. After the review

1. Reviewers compare scores on disagreements and agree a consensus; the consensus is the human outcome used in the metrics.
2. Each criterion with a low exact agreement is read against its anchor (`src/mrv1/anchors.ts`). Changes to anchors are rubric changes: they need owner approval, a new `MRV1_PROMPT_VERSION` and a re-run, and never silently alter stored evaluations.
3. The owner decides acceptance thresholds and whether any decision may use MRV1.0 scores. Nothing in the code makes that decision.

## 6. Open requirements before the first review

- The owner selects approved recordings and the reviewers.
- The approved Objection Doc is needed to validate C18 response quality; until then C18 reviewers record policy compliance as unknown.
- Controlled real-call evaluation requires explicit approval, applying migration 0006 and recording call-type labels.
