// Scoring-integrity audit (Phase 2, priority A): edge cases for equal-weight scoring with N/A and NE, and the ethical-flag score-cap rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_CRITERIA, CATEGORIES, FLAG_IDS, SALES_STAGE_CRITERIA, SP_CRITERIA } from "../src/mrv1/rubric.ts";
import { computeSalesStageScore } from "../src/mrv1/scoring.ts";
import type { ScoredCriterion } from "../src/mrv1/scoring.ts";
import { FLAGS_WITHOUT_CAPS, FLAG_RELATIONS, applyFlagCaps, reverseDismissedFlagCaps } from "../src/mrv1/flag-caps.ts";
import { runMrv1Evaluation } from "../src/mrv1/engine.ts";
import { buildReport } from "../src/mrv1/report.ts";
import type { Adjustment } from "../src/evaluation/types.ts";
import type { Mrv1Criterion, Mrv1Flag } from "../src/mrv1/types.ts";
import { FakeStore, SEGMENTS, fakeModel } from "./mrv1-fixtures.ts";

const IDS = SALES_STAGE_CRITERIA.map((c) => c.id);
const all = (over: Record<string, string> = {}): ScoredCriterion[] => SALES_STAGE_CRITERIA.map((c) => ({ criterion_id: c.id, category_id: c.category_id, outcome: over[c.id] ?? over[c.category_id] ?? "3" }));
const score = (over: Record<string, string> = {}) => computeSalesStageScore({ state: "valid", criteria: all(over), expectedIds: IDS });
const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

// ---------- A2: ten edge cases ----------
test("edge 1: every criterion numeric -> definitive, all 19 categories applicable", () => {
  const r = score({ C03: "2" });
  assert.equal(r.status, "definitive");
  assert.equal(r.applicable_categories, 19);
  close(r.percent, (18 * 100 + (2 / 3) * 100) / 19);
});
test("edge 2: some criteria N/A -> excluded from that category's denominator only", () => {
  const r = score({ "C03-01": "N/A", "C03-02": "N/A", "C03-03": "0" });
  const c03 = r.categories.find((c) => c.category_id === "C03")!;
  close(c03.percent, (6 * 3 / (3 * 7)) * 100); // 7 numeric: six 3s and one 0
  assert.equal(c03.na_count, 2);
  assert.equal(r.status, "definitive");
});
test("edge 3: some criteria NE -> NE is not zero and does not inflate: the category is the mean of the numeric criteria and is provisional", () => {
  const withNE = score({ C05: "2", "C05-01": "NE" });
  const c = withNE.categories.find((x) => x.category_id === "C05")!;
  close(c.percent, (2 / 3) * 100);
  assert.equal(c.provisional, true);
  assert.equal(withNE.status, "provisional");
  assert.match(withNE.display, /provisional/);
  // NE counted as 3 would inflate, as 0 would deflate: the real result matches neither
  const asThree = score({ C05: "2", "C05-01": "3" }).categories.find((x) => x.category_id === "C05")!.percent!;
  const asZero = score({ C05: "2", "C05-01": "0" }).categories.find((x) => x.category_id === "C05")!.percent!;
  assert.ok(c.percent! < asThree && c.percent! > asZero);
});
test("edge 4: an entire category N/A is excluded from the average", () => {
  const r = score({ C14: "N/A" });
  assert.equal(r.applicable_categories, 18);
  assert.equal(r.status, "definitive");
  assert.equal(r.categories.find((c) => c.category_id === "C14")!.status, "not_applicable");
  assert.equal(r.percent, 100);
});
test("edge 5: an entire category NE cannot be scored, is provisional and is not counted as zero", () => {
  const r = score({ C09: "NE" });
  const c = r.categories.find((x) => x.category_id === "C09")!;
  assert.equal(c.status, "not_evaluable");
  assert.equal(c.percent, null);
  assert.equal(r.applicable_categories, 18);
  assert.equal(r.percent, 100);
  assert.equal(r.status, "provisional");
});
test("edge 6: multiple categories with NE -> provisional, one note per category, NE never blends into a definitive number", () => {
  const r = score({ "C03-04": "NE", C10: "NE", "C16-02": "NE" });
  assert.equal(r.status, "provisional");
  assert.equal(r.notes.length, 3);
  assert.ok(["C03", "C10", "C16"].every((id) => r.notes.some((n) => n.includes(id))));
});
test("edge 7: only C01/C02 evaluated can never be shown as a complete evaluation", () => {
  const partial = all().filter((c) => c.category_id === "C01" || c.category_id === "C02");
  const r = computeSalesStageScore({ state: "valid", criteria: partial, expectedIds: IDS });
  assert.equal(r.status, "incomplete");
  assert.equal(r.percent, null);
  assert.equal(r.display, "Not published");
  assert.match(r.notes[0], /61 expected criteria are missing/);
});
const run = (store: FakeStore, model = fakeModel()) => runMrv1Evaluation({ store, model }, { callyzerCallId: "CY-7" }) as Promise<any>;
test("edge 8: continuation -> C01/C02 N/A by call type, 17 categories scored, still definitive when nothing is NE", async () => {
  const model = fakeModel({ policy: (id) => (/^C0[12]-/.test(id) ? undefined : { outcome: "3" }) });
  const r = await run(new FakeStore({ label: { business_call_type: "continuation", labelled_by: "Owner", basis: "x", labelled_at: "" } }), model);
  assert.equal(r.status, "completed");
  assert.equal(r.document.scores.sales_stage.applicable_categories, 17);
  assert.equal(r.document.scores.sales_stage.status, "definitive");
  assert.equal(r.document.scores.sales_stage.percent, 100);
});
test("edge 9: unknown call type -> held, nothing scored, nothing stored, no model call", async () => {
  const store = new FakeStore({ label: { business_call_type: "unknown", labelled_by: "x", basis: null, labelled_at: "" } });
  const model = fakeModel();
  const r = await run(store, model);
  assert.equal(r.status, "hold");
  assert.equal(r.gate, 3);
  assert.equal(store.saved.length, 0);
  assert.equal(model.calls.length, 0);
});
test("edge 10: unsupported call type -> recorded without scores or a normal evaluation", async () => {
  const store = new FakeStore({ label: { business_call_type: "support_existing_customer", labelled_by: "Owner", basis: null, labelled_at: "" } });
  const r = await run(store);
  assert.equal(r.status, "unsupported");
  assert.equal(r.document.scores.sales_stage.percent, null);
  assert.equal(r.document.scores.sales_stage.display, "Not published");
  assert.equal(r.document.sales_stage.length, 0);
  assert.equal(r.document.psychology.length, 0);
});
test("the score is the average of category percentages, never the pooled criterion mean", () => {
  const over = { C03: "0" }; // 9 criteria at 0, 61 others... pooled = 52/70*100 = 74.3; equal-weight = 18/19 = 94.7
  const r = score(over);
  const pooled = ((70 - 9) * 3) / (3 * 70) * 100;
  assert.notEqual(Math.round((r.percent as number) * 10), Math.round(pooled * 10));
  close(r.percent, (18 * 100) / 19);
});

// ---------- A3: flag-cap rules ----------
const crit = (id: string, outcome: string, seg: number | null = 3): Mrv1Criterion => {
  const def = ALL_CRITERIA.find((c) => c.id === id)!;
  return {
    criterion_id: id, criterion_name: def.name, category_id: def.category_id, category_name: def.category_id, outcome: outcome as any, score: /^[0-3]$/.test(outcome) ? Number(outcome) : null,
    applicable_status: "applicable", reason_code: null, elements_met: [], elements_missing: [], elements_late: [], elements_not_observable: [], element_details: [],
    evidence: seg === null ? [] : [{ segment_start: seg, segment_end: seg, quote: SEGMENTS[seg].text, speaker: "prospect", speaker_basis: "x", start_s: SEGMENTS[seg].start, end_s: SEGMENTS[seg].end, verified: true }],
    absence_record: null, evidence_confidence: "high", confidence_reason: "", explanation: "e", human_review_flags: [], model_original_outcome: null, improvement_recommendation: "", review_status: "pending",
  };
};
const flag = (flag_id: string, over: Partial<Mrv1Flag> = {}): Mrv1Flag => ({
  flag_id: flag_id as any, severity: "high", start_s: 150, end_s: 190, segments: [3], quote: SEGMENTS[3].text, explanation: "x", interpretation: "confirmed_conduct", verification_status: "quote_verified", human_review_decision: "pending", notes: [], ...over,
});
const caps = (criteria: Mrv1Criterion[], flags: Mrv1Flag[]) => {
  const adj: Adjustment[] = [];
  applyFlagCaps(criteria, flags, adj);
  return adj;
};

test("every flag is either mapped to rubric-grounded criteria with a stated reason, or explicitly cap-free with a reason", () => {
  assert.equal(Object.keys(FLAG_RELATIONS).length + Object.keys(FLAGS_WITHOUT_CAPS).length, FLAG_IDS.length);
  for (const id of FLAG_IDS) assert.ok((id in FLAG_RELATIONS) !== (id in FLAGS_WITHOUT_CAPS), id);
  for (const [flag, rels] of Object.entries(FLAG_RELATIONS)) for (const r of rels) {
    assert.ok(SALES_STAGE_CRITERIA.some((c) => c.id === r.criterion_id), `${flag}->${r.criterion_id}`);
    assert.ok(!r.criterion_id.startsWith("SP"));
    assert.ok(r.why.length > 40 && /C\d\d/.test(r.why), `${flag}->${r.criterion_id} needs a rubric-sourced reason`);
  }
  for (const reason of Object.values(FLAGS_WITHOUT_CAPS)) assert.ok(reason.length > 40);
});

test("confirmed + quote-verified + related + overlapping + currently 2 or 3 -> capped at 1 with a full audit trail", () => {
  const c = [crit("C15-03", "3")];
  const adj = caps(c, [flag("false_earnings_promise")]);
  assert.equal(c[0].outcome, "1");
  assert.equal(c[0].score, 1);
  assert.equal(c[0].model_original_outcome, "3");
  assert.equal(adj.length, 1);
  assert.deepEqual({ k: adj[0].kind, from: adj[0].from, to: adj[0].to, refs: adj[0].flag_refs }, { k: "flag_cap", from: "3", to: "1", refs: [{ flag_id: "false_earnings_promise", segments: [3] }] });
  assert.match(adj[0].reason, /not zeroed/);
  assert.match(adj[0].reason, /C15/);
  assert.equal(c[0].evidence.length, 1); // the cited evidence is preserved
});
test("a criterion already at 0 or 1 is never lowered (no double penalty), and the cap never goes below 1", () => {
  const c = [crit("C15-03", "1"), crit("C19-02", "0", null)];
  assert.equal(caps(c, [flag("false_earnings_promise")]).length, 0);
  assert.deepEqual(c.map((x) => x.outcome), ["1", "0"]);
});
test("ambiguous flags never cap", () => {
  const c = [crit("C15-03", "3")];
  assert.equal(caps(c, [flag("false_earnings_promise", { interpretation: "ambiguous" })]).length, 0);
  assert.equal(c[0].outcome, "3");
});
test("unverified flags never cap", () => {
  for (const v of ["quote_unverified", "needs_human_review"] as const) {
    const c = [crit("C15-03", "3")];
    assert.equal(caps(c, [flag("false_earnings_promise", { verification_status: v })]).length, 0);
    assert.equal(c[0].outcome, "3");
  }
});
test("a flag a human has dismissed never caps", () => {
  const c = [crit("C15-03", "3")];
  assert.equal(caps(c, [flag("false_earnings_promise", { human_review_decision: "dismissed" as any })]).length, 0);
});
test("unrelated criteria are unaffected even when their evidence overlaps the flagged words", () => {
  const c = [crit("C03-01", "3"), crit("C11-02", "3"), crit("C07-02", "3")]; // none are related to false_earnings_promise
  assert.equal(caps(c, [flag("false_earnings_promise")]).length, 0);
  assert.deepEqual(c.map((x) => x.outcome), ["3", "3", "3"]);
});
test("a related criterion whose evidence does not overlap the flagged segments is unaffected", () => {
  const c = [crit("C15-03", "3", 6)];
  assert.equal(caps(c, [flag("false_earnings_promise", { segments: [3] })]).length, 0);
  assert.equal(c[0].outcome, "3");
});
test("flags with no rubric-grounded relationship (customer fit, unprofessional conduct) never cap anything", () => {
  const c = ALL_CRITERIA.filter((x) => x.category_id !== "SP").map((x) => crit(x.id, "3"));
  assert.equal(caps(c, [flag("unsupported_customer_fit"), flag("unprofessional_conduct")]).length, 0);
  assert.ok(c.every((x) => x.outcome === "3"));
});
test("Sales Psychology criteria are never capped by flags", () => {
  const c = SP_CRITERIA.map((x) => crit(x.id, "3"));
  const adj = caps(c, FLAG_IDS.map((id) => flag(id)));
  assert.equal(adj.length, 0);
});
test("multiple overlapping flags cap a criterion once, record every cause, and still stop at 1", () => {
  const c = [crit("C19-02", "3"), crit("C14-02", "2")];
  const adj = caps(c, [flag("false_earnings_promise"), flag("fabricated_social_proof", { segments: [2, 3] })]);
  assert.deepEqual(c.map((x) => x.outcome), ["1", "1"]);
  assert.equal(adj.length, 2);
  const a = adj.find((x) => x.criterion_id === "C19-02")!;
  assert.equal(a.flag_refs!.length, 2);
  assert.match(a.reason, /false_earnings_promise \+ fabricated_social_proof/);
  assert.equal(c[1].model_original_outcome, "2");
});
test("human review: dismissing every causing flag lifts the cap; a partial or pending decision does not; the stored evaluation is untouched", () => {
  const c = [crit("C19-02", "3")];
  const adj = caps(c, [flag("false_earnings_promise"), flag("fabricated_social_proof")]);
  const before = JSON.stringify(c);
  const both = reverseDismissedFlagCaps(c, adj, [{ flag_id: "false_earnings_promise", segments: [3], decision: "dismissed" }, { flag_id: "fabricated_social_proof", segments: [3], decision: "dismissed" }]);
  assert.equal(both[0].outcome, "3");
  assert.equal(both[0].score, 3);
  assert.equal(both[0].model_original_outcome, null);
  const one = reverseDismissedFlagCaps(c, adj, [{ flag_id: "false_earnings_promise", segments: [3], decision: "dismissed" }, { flag_id: "fabricated_social_proof", segments: [3], decision: "confirmed" }]);
  assert.equal(one[0].outcome, "1");
  const pending = reverseDismissedFlagCaps(c, adj, [{ flag_id: "false_earnings_promise", segments: [3], decision: "pending" }]);
  assert.equal(pending[0].outcome, "1");
  const elsewhere = reverseDismissedFlagCaps(c, adj, [{ flag_id: "false_earnings_promise", segments: [9], decision: "dismissed" }]);
  assert.equal(elsewhere[0].outcome, "1"); // a different flag instance does not count
  assert.equal(JSON.stringify(c), before); // pure
});
test("human review: a prior non-flag adjustment keeps its audit marker when a flag cap is lifted", () => {
  const c = [{ ...crit("C15-03", "1"), model_original_outcome: "3" as const }];
  const adj: Adjustment[] = [{ criterion_id: "C15-03", from: "3", to: "2", reason: "element cap", kind: "element_cap" }, { criterion_id: "C15-03", from: "2", to: "1", reason: "flag", kind: "flag_cap", flag_refs: [{ flag_id: "false_earnings_promise", segments: [3] }] }];
  const r = reverseDismissedFlagCaps(c, adj, [{ flag_id: "false_earnings_promise", segments: [3], decision: "dismissed" }]);
  assert.equal(r[0].outcome, "2");
  assert.equal(r[0].model_original_outcome, "3");
});

test("engine: a capped criterion keeps its flag visible in the report and every adjustment is traceable", async () => {
  const f = { flag_id: "false_earnings_promise", severity: "high", interpretation: "confirmed_conduct", segments: [3], quote: SEGMENTS[3].text, explanation: "Promised income." };
  const r = await run(new FakeStore(), fakeModel({ flags: [f], policy: (id) => (id === "C15-03" ? { outcome: "3", seg: 3 } : undefined) }));
  const c = r.document.sales_stage.find((x: any) => x.criterion_id === "C15-03");
  assert.equal(c.outcome, "1");
  assert.equal(c.model_original_outcome, "3");
  const adj = r.document.validation.adjustments.filter((a: any) => a.criterion_id === "C15-03");
  assert.equal(adj.length, 1);
  assert.equal(adj[0].kind, "flag_cap");
  assert.ok(buildReport(r.document).sections[10].lines.join("\n").includes("false_earnings_promise"));
  // adjustments of every kind carry a reason
  assert.ok(r.document.validation.adjustments.every((a: any) => typeof a.reason === "string" && a.reason.length > 10));
});
