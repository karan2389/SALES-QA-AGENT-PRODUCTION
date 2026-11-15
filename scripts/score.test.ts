import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOverallScore, NOT_PUBLISHED } from "../src/sheets/score.ts";
import type { ScoreCriterion } from "../src/sheets/score.ts";

// Legacy C01/C02 score: average of the C01 and C02 category percentages (equal category weight, never pooled), labelled partial.
const PARTIAL = " (partial: C01-C02 only)";
const IDS = ["C01", "C01", "C01", "C02", "C02", "C02", "C02", "C02", "C02"];
const mk = (outcomes: string[]): ScoreCriterion[] =>
  outcomes.map((o, i) => ({ category_id: IDS[i], outcome: o, applicable_status: o === "N/A" ? "not_applicable" : "applicable", score: /^[0-3]$/.test(o) ? Number(o) : null }));

test("normal calculation: average of category percentages, one decimal, labelled partial", () => {
  const r = computeOverallScore({ state: "valid", criteria: mk(["3", "2", "1", "0", "3", "2", "1", "3", "2"]) });
  assert.equal(r.score_sum, 17);
  assert.equal(r.applicable_criteria, 9);
  assert.equal(r.score, ((6 / 9) * 100 + (11 / 18) * 100) / 2); // C01 66.7%, C02 61.1%: NOT the pooled 17/27 = 63.0%
  assert.equal(r.display, `63.9%${PARTIAL}`);
  assert.equal(r.status, "Evaluated");
});

test("a category with more criteria gets no extra weight", () => {
  // C01 has 3 criteria all 3 (100%); C02 has 6 criteria all 0 (0%): pooled would be 33.3%, equal category weight gives 50%.
  const r = computeOverallScore({ state: "valid", criteria: mk(["3", "3", "3", "0", "0", "0", "0", "0", "0"]) });
  assert.equal(r.score, 50);
});

test("full precision is kept internally; only the display is rounded", () => {
  const r = computeOverallScore({ state: "valid", criteria: mk(["3", "3", "2", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]) });
  assert.equal(r.score, (8 / 9) * 100);
  assert.equal(r.display, `88.9%${PARTIAL}`);
});

test("mixed applicable and N/A: N/A leaves both numerator and denominator", () => {
  const r = computeOverallScore({ state: "valid", criteria: mk(["3", "3", "3", "2", "N/A", "N/A", "N/A", "N/A", "N/A"]) });
  assert.equal(r.applicable_criteria, 4);
  assert.equal(r.score, (100 + (2 / 3) * 100) / 2); // C01 100%, C02 66.7%
  assert.equal(r.display, `83.3%${PARTIAL}`);
});

test("NE is excluded from numerator and denominator, never zero", () => {
  const withNE = computeOverallScore({ state: "valid", criteria: mk(["2", "2", "NE", "NE", "N/A", "N/A", "N/A", "N/A", "N/A"]) });
  assert.equal(withNE.applicable_criteria, 2);
  assert.equal(withNE.display, `66.7%${PARTIAL}`);
  const zeroed = computeOverallScore({ state: "valid", criteria: mk(["2", "2", "0", "0", "N/A", "N/A", "N/A", "N/A", "N/A"]) });
  assert.notEqual(zeroed.display, withNE.display); // a genuine 0 is different from NE
});

test("a genuine 0 score counts as a score", () => {
  assert.equal(computeOverallScore({ state: "valid", criteria: mk(["0", "0", "0", "0", "0", "0", "0", "0", "0"]) }).display, `0.0%${PARTIAL}`);
});

test("all criteria N/A -> N/A, never 0% (Alpha, continuation)", () => {
  const r = computeOverallScore({ state: "valid", criteria: mk(Array(9).fill("N/A")) });
  assert.equal(r.display, "N/A");
  assert.equal(r.score, null);
  assert.equal(r.status, "N/A");
});

test("all criteria NE -> score N/A with its own status", () => {
  const r = computeOverallScore({ state: "valid", criteria: mk(Array(9).fill("NE")) });
  assert.equal(r.display, "N/A");
  assert.equal(r.status, "Insufficient evidence");
});

test("incomplete evaluation (missing criteria, flagged, or malformed) publishes no number", () => {
  assert.equal(computeOverallScore({ state: "valid", criteria: mk(["3", "3", "3", "3", "3", "3", "3", "3", "3"]).slice(0, 8) }).display, NOT_PUBLISHED);
  assert.equal(computeOverallScore({ state: "incomplete", criteria: mk(Array(9).fill("3")) }).status, "Incomplete");
  const bad = mk(Array(9).fill("3"));
  bad[0].outcome = "7";
  assert.equal(computeOverallScore({ state: "valid", criteria: bad }).display, NOT_PUBLISHED);
});

test("invalidated and test-only evaluations never get a number", () => {
  const all3 = mk(Array(9).fill("3"));
  const inv = computeOverallScore({ state: "invalidated", criteria: all3 });
  assert.equal(inv.score, null);
  assert.equal(inv.display, NOT_PUBLISHED);
  assert.equal(inv.status, "Invalidated");
  const t = computeOverallScore({ state: "test_only", criteria: all3 });
  assert.equal(t.score, null);
  assert.equal(t.status, "Test-only");
});

test("a transcript-blocked evaluation never gets a number", () => {
  const r = computeOverallScore({ state: "blocked", criteria: mk(Array(9).fill("3")) });
  assert.equal(r.score, null);
  assert.equal(r.display, NOT_PUBLISHED);
  assert.equal(r.status, "Blocked");
});

test("categories outside 01 and 02 are ignored", () => {
  const extra: ScoreCriterion[] = [...mk(["3", "3", "3", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]), { category_id: "C03", outcome: "0", applicable_status: "applicable", score: 0 }];
  const r = computeOverallScore({ state: "valid", criteria: extra });
  assert.equal(r.applicable_criteria, 3);
  assert.equal(r.display, `100.0%${PARTIAL}`);
});
