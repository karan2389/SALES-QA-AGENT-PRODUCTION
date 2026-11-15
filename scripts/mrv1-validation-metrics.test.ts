// Validation framework: metrics and review template, tested with SYNTHETIC evaluations and invented human reviews. No accuracy claim is made here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runMrv1Evaluation } from "../src/mrv1/engine.ts";
import { FLAG_REVIEW_COLUMNS, REVIEW_COLUMNS, buildReviewTemplate, computeValidationMetrics, toCsv } from "../src/mrv1/validation-metrics.ts";
import type { HumanCriterionReview, OutcomeValue, ReviewedDocument } from "../src/mrv1/validation-metrics.ts";
import { FakeStore, fakeModel } from "./mrv1-fixtures.ts";

async function synthetic(id = 1): Promise<ReviewedDocument> {
  const r: any = await runMrv1Evaluation({ store: new FakeStore(), model: fakeModel({ flags: [{ flag_id: "fake_urgency", severity: "medium", interpretation: "ambiguous", segments: [10], quote: null, explanation: "Maybe a deadline." }] }) }, { callyzerCallId: "CY-7" });
  assert.equal(r.status, "completed");
  return { ...r.document, evaluation_id: id };
}
const base = (d: ReviewedDocument, over: Record<string, OutcomeValue> = {}): HumanCriterionReview[] =>
  [...d.sales_stage, ...d.psychology].map((c) => ({ evaluation_id: d.evaluation_id, criterion_id: c.criterion_id, human_outcome: over[c.criterion_id] ?? (c.outcome as OutcomeValue), evidence_quote_exists: null, timestamp_correct: null, speaker_correct: null, explanation_accurate: null, recommendation_relevant: null }));
const close = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} vs ${b}`);

test("perfect agreement: every metric is at its ceiling and score differences are zero", async () => {
  const d = await synthetic();
  const m = computeValidationMetrics({ documents: [d], reviews: base(d) });
  assert.equal(m.criteria_reviewed, 92);
  assert.equal(m.exact_agreement, 1);
  assert.equal(m.within_one_agreement, 1);
  assert.equal(m.na_ne_class_agreement, 1);
  assert.equal(m.mean_abs_category_diff, 0);
  assert.equal(m.mean_abs_sales_stage_diff, 0);
  assert.equal(m.mean_abs_psychology_diff, 0);
  assert.equal(m.provisional_status_agreement, 1);
  assert.equal(m.evaluations_fully_reviewed, 1);
});

test("a small sample never supports an accuracy claim, however high the agreement", async () => {
  const d = await synthetic();
  const m = computeValidationMetrics({ documents: [d], reviews: base(d) });
  assert.equal(m.sufficient_for_claims, false);
  assert.match(m.caveat, /NOT evidence that the model is accurate/);
});

test("disagreements: exact, within-one and N/A/NE class agreement are computed separately", async () => {
  const d = await synthetic();
  // model: C03-01=2, C04-01=2, C05-01=2, C06-01=2, C01-01=NE
  const r = base(d, { "C03-01": "3", "C04-01": "0", "C05-01": "NE", "C06-01": "N/A", "C01-01": "2" });
  const m = computeValidationMetrics({ documents: [d], reviews: r });
  close(m.exact_agreement, 87 / 92);
  assert.equal(m.within_one_pairs, 81); // both numeric: 83 model-numeric minus C05-01 (human NE) and C06-01 (human N/A)
  close(m.within_one_agreement, 80 / 81); // only C04-01 (2 vs 0) is more than one point apart
  close(m.na_ne_class_agreement, 89 / 92);
  assert.equal(m.class_confusion["numeric"]["NE"], 1);
  assert.equal(m.class_confusion["numeric"]["N/A"], 1);
  assert.equal(m.class_confusion["NE"]["numeric"], 1);
  const c = m.per_criterion.find((x) => x.criterion_id === "C04-01")!;
  assert.deepEqual({ n: c.n, exact: c.exact }, { n: 1, exact: 0 });
});

test("human category and overall scores are recomputed from human outcomes, with equal category weight", async () => {
  const d = await synthetic();
  const m = computeValidationMetrics({ documents: [d], reviews: base(d, { "C03-01": "3", "C04-01": "0", "C05-01": "NE", "C06-01": "N/A", "C01-01": "2" }) });
  // model: C03..C19 at 66.67 (C01/C02 NE) -> 66.67. Human: C01 (2/3) joins, C03 = 19/27, C04 = 4/9, rest 66.67.
  const human = (16 * (200 / 3) + (19 / 27) * 100 + (4 / 9) * 100) / 18;
  close(m.mean_abs_sales_stage_diff, Math.abs(human - 200 / 3), 1e-6);
  assert.equal(m.mean_abs_psychology_diff, 0); // psychology untouched, reported separately
  assert.equal(m.provisional_status_agreement, 1);
  // category differences only where both sides have a percentage: C03 and C04 differ, the rest are equal
  const diffs = [Math.abs((19 / 27) * 100 - 200 / 3), Math.abs((4 / 9) * 100 - 200 / 3)];
  close(m.mean_abs_category_diff, diffs.reduce((a, b) => a + b, 0) / 17, 1e-6);
});

test("a psychology disagreement moves only the psychology difference", async () => {
  const d = await synthetic();
  const m = computeValidationMetrics({ documents: [d], reviews: base(d, { "SP-01": "0" }) });
  assert.equal(m.mean_abs_sales_stage_diff, 0);
  close(m.mean_abs_psychology_diff, Math.abs(((0 + 21 * 2) / (3 * 22)) * 100 - (2 / 3) * 100));
});

test("evaluations that were not fully reviewed are excluded from score differences", async () => {
  const d = await synthetic();
  const m = computeValidationMetrics({ documents: [d], reviews: base(d).slice(0, 40) });
  assert.equal(m.criteria_reviewed, 40);
  assert.equal(m.evaluations_fully_reviewed, 0);
  assert.equal(m.mean_abs_sales_stage_diff, null);
});

test("evidence accuracy: unsupported-evidence rate, timestamp, speaker, explanation and recommendation rates, and traceability", async () => {
  const d = await synthetic();
  const rs = base(d).map((r, i) => (i < 10 ? { ...r, evidence_quote_exists: i < 8, timestamp_correct: i < 9, speaker_correct: i < 7, explanation_accurate: i < 6, recommendation_relevant: i < 5 } : r));
  const m = computeValidationMetrics({ documents: [d], reviews: rs });
  close(m.unsupported_evidence_rate, 2 / 10);
  close(m.timestamp_accuracy, 9 / 10);
  close(m.speaker_accuracy, 7 / 10);
  close(m.explanation_accuracy, 6 / 10);
  close(m.recommendation_relevance, 5 / 10);
  assert.equal(m.evidence_traceability_rate, 1); // every model-scored criterion carries code-verified quotations
});

test("ethical flags: precision, recall and confirmed-but-ambiguous errors", async () => {
  const d = await synthetic();
  const m = computeValidationMetrics({
    documents: [d], reviews: base(d),
    flagReviews: [
      { evaluation_id: 1, flag_id: "fake_urgency", supported: true },
      { evaluation_id: 1, flag_id: "financial_pressure", supported: true, should_be_ambiguous: true },
      { evaluation_id: 1, flag_id: "unprofessional_conduct", supported: false },
    ],
    missedFlags: [{ evaluation_id: 1, flag_id: "false_earnings_promise" }],
  });
  close(m.flag_precision, 2 / 3);
  close(m.flag_recall, 2 / 3);
  assert.equal(m.flags_confirmed_but_ambiguous, 1);
  const none = computeValidationMetrics({ documents: [d], reviews: base(d) });
  assert.equal(none.flag_precision, null); // no ground truth supplied: no figure
  assert.equal(none.flag_recall, null);
});

test("invalid human outcomes and unknown criteria are rejected or ignored, never silently counted", async () => {
  const d = await synthetic();
  assert.throws(() => computeValidationMetrics({ documents: [d], reviews: [{ ...base(d)[0], human_outcome: "4" as any }] }));
  const m = computeValidationMetrics({ documents: [d], reviews: [{ ...base(d)[0], criterion_id: "C99-01" }] });
  assert.equal(m.criteria_reviewed, 0);
  assert.equal(m.exact_agreement, null);
});

test("sample size threshold is reported only when met", async () => {
  const docs = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => synthetic(i)));
  const m = computeValidationMetrics({ documents: docs, reviews: docs.flatMap((d) => base(d)) });
  assert.equal(m.evaluations_reviewed, 10);
  assert.equal(m.sufficient_for_claims, true);
  assert.match(m.caveat, /owner must still decide acceptable thresholds/);
});

test("review template: one row per criterion with the model output filled and the human columns blank", async () => {
  const d = await synthetic(5);
  const t = buildReviewTemplate(d, 5);
  assert.equal(t.criteria.length, 92);
  assert.ok(t.criteria.every((r) => r.length === REVIEW_COLUMNS.length));
  const row = t.criteria.find((r) => r[1] === "C03-01")!;
  assert.equal(row[3], "2");
  assert.match(row[6], /^\[\d\d:\d\d\.\d-\d\d:\d\d\.\d\] \(prospect\)/);
  assert.deepEqual(row.slice(9), ["", "", "", "", "", "", "", ""]); // human_outcome ... disagreement_reason are blank
  assert.equal(t.flags.length, 1);
  assert.ok(t.flags.every((r) => r.length === FLAG_REVIEW_COLUMNS.length));
  const csv = toCsv(REVIEW_COLUMNS, [["1", 'a "quoted", value', ...Array(15).fill("")]]);
  assert.match(csv, /"a ""quoted"", value"/);
});
