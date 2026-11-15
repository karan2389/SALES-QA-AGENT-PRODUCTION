// Google Sheets scoring integrity for MRV1.0: the row score is the equal-weight average of the applicable category percentages over all
// 19 categories; Sales Psychology is reported separately; legacy C01/C02 results are labelled partial. Pure tests (no network, no export).
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_HEADERS, buildAgentRow, rowsEqual, scoreForRecord } from "../src/sheets/rows.ts";
import type { ExportCriterion, ExportRecord } from "../src/sheets/rows.ts";
import { CATEGORIES, SALES_STAGE_CRITERIA, SP_CRITERIA } from "../src/mrv1/rubric.ts";

const crit = (id: string, category_id: string, outcome: string): ExportCriterion => ({
  criterion_id: id, category_id, criterion_name: id, outcome, score: /^[0-3]$/.test(outcome) ? Number(outcome) : null,
  applicable_status: outcome === "N/A" ? "not_applicable" : "applicable", reason_code: null, evidence_json: "[]", explanation: "",
});
/** over: criterion id or category id -> outcome; everything else "3". */
const sales = (over: Record<string, string> = {}) => SALES_STAGE_CRITERIA.map((c) => crit(c.id, c.category_id, over[c.id] ?? over[c.category_id] ?? "3"));
const psych = (outcome = "3") => SP_CRITERIA.map((c) => crit(c.id, "SP", outcome));
const rec = (over: Partial<ExportRecord> = {}): ExportRecord => ({
  evaluation_id: 1, call_ext_id: "CY-1", agent_id: 1, agent_name: "alpha", call_date: "2026-11-01", duration_seconds: 600, direction: "Outgoing", call_type_label: "new_webinar_prospect",
  human_review_status: "pending", coaching_json: null, applicability_reason: null, transcript_segments_json: null, state: "valid",
  rubric_version: "MRV1.0", criteria: sales(), psychology_criteria: psych(), flags: [], reviewer: null, review_comment: null, reviewed_at: null, ...over,
});
const cell = (r: ExportRecord, header: string) => buildAgentRow(r)[AGENT_HEADERS.indexOf(header)];

test("all 19 categories contribute to the sheet score", () => {
  const all3 = rec();
  assert.equal(cell(all3, "Overall Call Score"), "100.0%");
  // dropping any single category to 0 lowers the score by exactly 100/19 points
  for (const c of CATEGORIES) {
    const r = rec({ criteria: sales({ [c.id]: "0" }) });
    assert.equal(cell(r, "Overall Call Score"), `${((18 * 100) / 19).toFixed(1)}%`, c.id);
  }
});

test("categories carry equal weight; a category with more criteria gets no extra weight", () => {
  // C03 has 9 criteria, C06 has 2. Zeroing C03 or C06 changes the score identically.
  assert.equal(cell(rec({ criteria: sales({ C03: "0" }) }), "Overall Call Score"), cell(rec({ criteria: sales({ C06: "0" }) }), "Overall Call Score"));
  // one weak criterion in C06 (1 of 2 criteria) moves the score more than one weak criterion in C03 (1 of 9)
  const c03 = scoreForRecord(rec({ criteria: sales({ "C03-01": "0" }) })).display;
  const c06 = scoreForRecord(rec({ criteria: sales({ "C06-01": "0" }) })).display;
  assert.ok(parseFloat(c06) < parseFloat(c03));
  // exact values: C03 at 24/27 -> (18 x 100 + 88.9) / 19 = 99.4; pooled over 70 criteria would be 207/210 = 98.6
  assert.equal(c03, `${((18 * 100 + (24 / 27) * 100) / 19).toFixed(1)}%`);
  assert.notEqual(c03, `${((207 / 210) * 100).toFixed(1)}%`);
});

test("N/A is excluded from denominators and a fully N/A category is excluded", () => {
  const r = rec({ criteria: sales({ C01: "N/A", C02: "N/A" }) });
  assert.equal(cell(r, "Overall Call Score"), "100.0%");
  assert.match(String(cell(r, "Feedback")), /C01 Introduction: N\/A/);
  const partialNA = rec({ criteria: sales({ "C03-02": "N/A", "C03-03": "0" }) });
  // C03: scores 3,0,3,3,3,3,3,3 (8 numeric, one N/A excluded) -> 21/24
  const catPct = (21 / 24) * 100;
  assert.equal(cell(partialNA, "Overall Call Score"), `${((18 * 100 + catPct) / 19).toFixed(1)}%`);
});

test("NE never becomes zero and makes the result provisional", () => {
  const ne = rec({ criteria: sales({ "C05-03": "NE" }) });
  assert.equal(cell(ne, "Overall Call Score"), "100.0% (provisional)");
  assert.equal(cell(ne, "Evaluation Status"), "Provisional");
  const zero = rec({ criteria: sales({ "C05-03": "0" }) });
  assert.notEqual(cell(zero, "Overall Call Score"), cell(ne, "Overall Call Score"));
  assert.match(String(cell(ne, "Feedback")), /contains NE/);
  // an entirely-NE category cannot be scored and is not counted as zero
  const allNe = rec({ criteria: sales({ C06: "NE" }) });
  assert.equal(cell(allNe, "Overall Call Score"), "100.0% (provisional)");
});

test("Sales Psychology is reported separately and never combined", () => {
  const r = rec({ criteria: sales({ C03: "0" }), psychology_criteria: psych("2") });
  const fb = String(cell(r, "Feedback"));
  assert.match(fb, /Sales Psychology and Conduct score \(separate, never combined\): 66\.7%/);
  assert.notEqual(cell(r, "Overall Call Score"), "66.7%");
  // changing only psychology never changes the sales-stage score
  assert.equal(cell(rec({ psychology_criteria: psych("0") }), "Overall Call Score"), cell(rec({ psychology_criteria: psych("3") }), "Overall Call Score"));
});

test("category scores, critical flags and review status appear in the row", () => {
  const r = rec({ human_review_status: "approved", reviewer: "Manager", flags: [{ flag_id: "fake_urgency", severity: "high", interpretation: "confirmed_conduct", verification_status: "quote_verified", human_decision: "pending", start_s: 10, evidence_quote: "x", explanation: "Deadline imposed" }] });
  const fb = String(cell(r, "Feedback"));
  assert.match(fb, /C15 Unique Selling Proposition \(USP\): 100\.0%/);
  assert.match(fb, /Critical flags \(1\):\n• fake_urgency \[high\] confirmed_conduct/);
  assert.equal(cell(r, "Human Review Status"), "approved");
  assert.equal(cell(rec(), "Feedback").toString().includes("Critical flags: none raised"), true);
});

test("a C01/C02-only evaluation can never look like a full sales-stage score", () => {
  // MRV1.0 record that only has the nine C01/C02 criteria: incomplete, no number
  const only = rec({ criteria: sales().filter((c) => c.category_id === "C01" || c.category_id === "C02") });
  assert.equal(cell(only, "Overall Call Score"), "Not published");
  assert.equal(cell(only, "Evaluation Status"), "Incomplete");
  // legacy rubric record: the number is labelled partial
  const legacy = rec({ rubric_version: "evaluation-rubric-v1-rev4-c01-c02", criteria: sales().filter((c) => c.category_id === "C01" || c.category_id === "C02"), psychology_criteria: undefined });
  assert.equal(cell(legacy, "Overall Call Score"), "100.0% (partial: C01-C02 only)");
  // no rubric_version at all behaves as legacy
  const bare = rec({ rubric_version: undefined, criteria: legacy.criteria });
  assert.match(String(cell(bare, "Overall Call Score")), /partial/);
});

test("invalidated, blocked and unsupported records publish no number", () => {
  for (const [state, status] of [["invalidated", "Invalidated"], ["blocked", "Blocked"], ["incomplete", "Incomplete"]] as const) {
    const r = rec({ state });
    assert.equal(cell(r, "Overall Call Score"), "Not published");
    assert.equal(cell(r, "Evaluation Status"), status);
  }
  const u = rec({ applicability_reason: "unsupported_call_type", criteria: [], psychology_criteria: [] });
  assert.equal(cell(u, "Overall Call Score"), "Not published");
  assert.equal(cell(u, "Evaluation Status"), "Unsupported");
});

test("continuation: C01/C02 N/A by call type are excluded and the other 17 categories are scored", () => {
  const r = rec({ call_type_label: "continuation", criteria: sales({ C01: "N/A", C02: "N/A", C07: "2" }) });
  assert.equal(cell(r, "Overall Call Score"), `${((16 * 100 + (2 / 3) * 100) / 17).toFixed(1)}%`);
});

test("rows are deterministic, so repeated exports compare equal (idempotent updates)", () => {
  const a = buildAgentRow(rec());
  const b = buildAgentRow(rec());
  assert.deepEqual(a, b);
  assert.equal(rowsEqual(a, b.map((x) => String(x))), true);
  assert.equal(a.length, AGENT_HEADERS.length);
});
