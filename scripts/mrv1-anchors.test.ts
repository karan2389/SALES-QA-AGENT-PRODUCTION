// C03-C19 criterion-specific anchors. Two separate layers are tested:
//   (1) rubric interpretation: the anchors themselves and what the prompt tells the model (content assertions, no model);
//   (2) the scoring engine: deterministic guards applied to MOCKED model output (the model is never called).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ANCHORS, PROSPECT_ANSWER_REQUIRED, anchorText, criteriaNeedingAnchors } from "../src/mrv1/anchors.ts";
import { FLAG_CRITERIA } from "../src/mrv1/flag-caps.ts";
import { ALL_CRITERIA, NA_REASONS_GENERAL, PASSES, criteriaForPass } from "../src/mrv1/rubric.ts";
import { buildPassMessages } from "../src/mrv1/prompt.ts";
import { runMrv1Evaluation } from "../src/mrv1/engine.ts";
import { computeQuality } from "../src/evaluation/transcript.ts";
import { CALL_SECONDS, FakeStore, SEGMENTS, fakeModel } from "./mrv1-fixtures.ts";

const run = (model: ReturnType<typeof fakeModel>) => runMrv1Evaluation({ store: new FakeStore(), model }, { callyzerCallId: "CY-7" }) as Promise<any>;
const crit = (r: any, id: string) => [...r.document.sales_stage, ...r.document.psychology].find((c: any) => c.criterion_id === id);

// ---------- (1) rubric interpretation ----------
test("anchors: every C03-C19 criterion has complete anchors; C01/C02 keep their approved rules", () => {
  const ids = criteriaNeedingAnchors();
  assert.equal(ids.length, 61);
  for (const id of ids) {
    const a = ANCHORS[id];
    assert.ok(a, `missing anchor ${id}`);
    for (const k of ["s3", "s2", "s1", "s0", "na", "ne", "evidence", "avoid"] as const) assert.ok(a[k].trim().length >= 10, `${id}.${k}`);
  }
  assert.equal(Object.keys(ANCHORS).length, 61);
  assert.ok(!("C01-01" in ANCHORS) && !("C02-01" in ANCHORS));
  assert.ok(Object.keys(ANCHORS).every((id) => ALL_CRITERIA.some((c) => c.id === id)));
});

test("anchors: N/A reason codes named in anchors exist in the allowed list", () => {
  for (const [id, a] of Object.entries(ANCHORS)) for (const m of a.na.matchAll(/\(([a-z_]+)(?: \/ ([a-z_]+))?\)/g)) for (const code of [m[1], m[2]].filter(Boolean)) assert.ok(NA_REASONS_GENERAL.includes(code), `${id}: ${code}`);
});

test("anchors: criteria that need prospect answers state that a question alone is not an answer", () => {
  for (const id of ["C03-08", "C05-01", "C07-02", "C12-03", "C17-01"]) assert.match(ANCHORS[id].avoid, /question alone is not an answer/i, id);
  assert.match(ANCHORS["C03-08"].avoid, /annualise|estimate/i);
  assert.match(ANCHORS["C03-07"].avoid, /never infer/i);
  assert.match(ANCHORS["C03-08"].s2, /did not confirm|approximate/);
});

test("anchors: feature mentions, urgency, borrowing, testimonials, support and refusals are addressed where they matter", () => {
  assert.match(ANCHORS["C11-02"].avoid, /feature never earns full credit/i);
  assert.match(ANCHORS["C15-02"].avoid, /not explaining its benefit/i);
  assert.match(ANCHORS["C07-02"].avoid, /fake_urgency/);
  assert.match(ANCHORS["C05-05"].avoid, /borrow/);
  assert.match(ANCHORS["C19-01"].s0, /borrow/);
  assert.match(ANCHORS["C14-01"].avoid, /WhatsApp/);
  assert.match(ANCHORS["C14-02"].s0, /fabricated|guaranteed/);
  assert.match(ANCHORS["C15-03"].s0, /earnings promise|false_earnings_promise/);
  assert.match(ANCHORS["C15-04"].s0, /Saurabh Bhatnagar/);
  assert.match(ANCHORS["C19-04"].s0, /refusal_not_respected/);
  assert.match(ANCHORS["C16-02"].avoid, /does not penalise|not the prospect's answer/i);
  assert.match(ANCHORS["C16-01"].s1, /not independent agreement/);
  assert.match(ANCHORS["C06-01"].avoid, /coercive_emotional_pressure/);
  assert.match(ANCHORS["C17-03"].na, /prospect_not_ready/);
  assert.match(ANCHORS["C08-02"].avoid, /Do not replace the prospect's plan/);
  assert.match(ANCHORS["C09-01"].avoid, /manufactured problems/);
  assert.match(ANCHORS["C10-01"].avoid, /every resource/);
  assert.match(ANCHORS["C04-02"].avoid, /course-based/);
});

test("anchors: C18 never invents approved responses and requires human verification of policy compliance", () => {
  for (const id of ["C18-01", "C18-02", "C18-03", "C18-04"]) {
    assert.match(ANCHORS[id].avoid, /Objection Doc is unavailable/);
    assert.match(ANCHORS[id].avoid, /objection_policy_unverified/);
    assert.match(ANCHORS[id].na, /no_material_objection/);
    assert.match(ANCHORS[id].ne, /has not been supplied/);
  }
});

test("anchors: every anchored criterion appears in the prompt of its pass with all score levels", () => {
  for (const pass of PASSES) {
    const defs = criteriaForPass(pass);
    const ids = defs.map((d) => d.id);
    const { system } = buildPassMessages({ pass, expectedIds: ids, naCategories: [], callTypeLabel: "new_webinar_prospect", durationSeconds: CALL_SECONDS, transcriptSource: "production", segments: SEGMENTS, quality: computeQuality(SEGMENTS, CALL_SECONDS, "en") });
    for (const id of ids.filter((i) => ANCHORS[i])) {
      const block = anchorText(id);
      assert.ok(system.includes(block), `${id} anchors missing from pass ${pass.key}`);
      for (const m of ["  3 = ", "  2 = ", "  1 = ", "  0 = ", "  N/A: ", "  NE: ", "  Evidence: ", "  Do not: "]) assert.ok(block.includes(m));
    }
  }
});

test("anchors: code-enforced guard lists refer to real criteria", () => {
  const ids = new Set(ALL_CRITERIA.map((c) => c.id));
  for (const id of PROSPECT_ANSWER_REQUIRED) assert.ok(ids.has(id) && ANCHORS[id], id);
  for (const list of Object.values(FLAG_CRITERIA)) for (const id of list) assert.ok(ids.has(id) && ANCHORS[id], id);
});

// ---------- (2) scoring engine, mocked model output ----------
test("engine: fully demonstrated (3), partial (2), weak (1), not demonstrated (0), N/A and NE are all stored with the right status", async () => {
  const policy = (id: string) =>
    ({
      "C03-08": { outcome: "3", seg: 3 },
      "C05-01": { outcome: "2", seg: 3 },
      "C07-01": { outcome: "1", seg: 4, speaker: "salesperson" },
      "C13-01": { outcome: "0" },
      "C14-01": { outcome: "N/A", reason_code: "no_relevant_testimonial_available" },
      "C12-02": { outcome: "NE", reason_code: "speaker_unclear" },
    } as Record<string, any>)[id];
  const r = await run(fakeModel({ policy }));
  assert.equal(r.status, "completed", JSON.stringify(r).slice(0, 300));
  assert.deepEqual(["C03-08", "C05-01", "C07-01", "C13-01", "C14-01", "C12-02"].map((id) => crit(r, id).outcome), ["3", "2", "1", "0", "N/A", "NE"]);
  assert.equal(crit(r, "C14-01").reason_code, "no_relevant_testimonial_available");
  assert.equal(crit(r, "C12-02").score, null);
  assert.equal(crit(r, "C13-01").absence_record.progression_excerpts.length, 1);
});

test("engine: a question alone is not an answer (annual revenue scored 3 on the salesperson's question is capped at 1)", async () => {
  const r = await run(fakeModel({ policy: (id) => (id === "C03-08" ? { outcome: "3", seg: 4, speaker: "salesperson" } : undefined) }));
  const c = crit(r, "C03-08");
  assert.equal(c.outcome, "1");
  assert.equal(c.model_original_outcome, "3");
  assert.ok(r.document.validation.adjustments.some((a: any) => a.criterion_id === "C03-08" && /question alone/.test(a.reason)));
});

test("engine: prospect information the model attributes to the salesperson, or invents, is never credited", async () => {
  // the salesperson's own statement cannot establish team size (2 or 3 needs a prospect-attributed quotation)
  const r = await run(fakeModel({ policy: (id) => (id === "C03-09" ? { outcome: "2", seg: 6, speaker: "salesperson" } : id === "C03-07" ? { outcome: "3", quote: "I serve about two hundred customers every month" } : undefined) }));
  assert.equal(crit(r, "C03-09").outcome, "1");
  // a figure that appears nowhere in the transcript fails quotation verification: NE, never kept
  assert.equal(crit(r, "C03-07").outcome, "NE");
  assert.equal(crit(r, "C03-07").reason_code, "quote_not_verifiable");
});

test("engine: insufficient evidence becomes NE, never 0", async () => {
  const r = await run(fakeModel({ policy: (id) => (id === "C09-02" ? { outcome: "2", extra: { evidence: [] } } : undefined) }));
  assert.equal(crit(r, "C09-02").outcome, "NE");
  assert.equal(crit(r, "C09-02").reason_code, "missing_evidence");
});

test("engine: N/A and NE need allowed reason codes", async () => {
  const bad = fakeModel({ policy: (id) => (id === "C18-01" ? { outcome: "N/A", reason_code: "i_felt_like_it" } : undefined) });
  const store = new FakeStore();
  const r: any = await runMrv1Evaluation({ store, model: bad, maxAttempts: 1 }, { callyzerCallId: "CY-7" });
  assert.equal(r.status, "failed");
  assert.equal(r.error_kind, "schema_invalid");
  assert.equal(store.saved.length, 0);
  const ok = await run(fakeModel({ policy: (id) => (id.startsWith("C18") ? { outcome: "N/A", reason_code: "no_material_objection" } : undefined) }));
  assert.equal(ok.document.sales_stage.filter((c: any) => c.category_id === "C18" && c.outcome === "N/A").length, 4);
});

test("engine: scored C18 criteria are marked for human verification of response policy (Objection Doc unavailable)", async () => {
  const r = await run(fakeModel({ policy: (id) => (id === "C18-03" ? { outcome: "2", seg: 8 } : undefined) }));
  assert.ok(crit(r, "C18-03").human_review_flags.includes("objection_policy_unverified"));
  const na = await run(fakeModel({ policy: (id) => (id.startsWith("C18") ? { outcome: "N/A", reason_code: "no_material_objection" } : undefined) }));
  assert.ok(!crit(na, "C18-03").human_review_flags.includes("objection_policy_unverified")); // nothing to verify when no objection arose
});

test("engine: confirmed verified flags cap the criteria they overlap; ambiguous or non-overlapping flags do not", async () => {
  const flag = (flag_id: string, seg: number, interpretation = "confirmed_conduct") => ({ flag_id, severity: "high", interpretation, segments: [seg], quote: SEGMENTS[seg].text, explanation: "Conduct noted." });
  const pol = (id: string) => (["C15-03", "C07-02", "C19-04", "C11-02"].includes(id) ? { outcome: "3", seg: 3 } : undefined);
  // false earnings promise cites segment 3 (the same segment C15-03 cites): capped
  const capped = await run(fakeModel({ policy: pol, flags: [flag("false_earnings_promise", 3), flag("fake_urgency", 3), flag("refusal_not_respected", 3)] }));
  assert.equal(crit(capped, "C15-03").outcome, "1");
  assert.equal(crit(capped, "C07-02").outcome, "1");
  assert.equal(crit(capped, "C19-04").outcome, "1");
  assert.equal(crit(capped, "C11-02").outcome, "3"); // linked only to misleading_product_claim, which was not raised
  assert.ok(capped.document.validation.adjustments.some((a: any) => /quote-verified false_earnings_promise/.test(a.reason)));
  // ambiguous reading: no cap, but the flag stays visible
  const amb = await run(fakeModel({ policy: pol, flags: [flag("false_earnings_promise", 3, "ambiguous")] }));
  assert.equal(crit(amb, "C15-03").outcome, "3");
  assert.equal(amb.document.extras.flags.length, 1);
  // flag elsewhere in the call (segment 10): criteria citing segment 3 are untouched
  const elsewhere = await run(fakeModel({ policy: pol, flags: [flag("false_earnings_promise", 10)] }));
  assert.equal(crit(elsewhere, "C15-03").outcome, "3");
});

test("engine: a financial-pressure flag also caps the closing payment criterion", async () => {
  const f = { flag_id: "financial_pressure", severity: "critical", interpretation: "confirmed_conduct", segments: [3], quote: SEGMENTS[3].text, explanation: "Urged the prospect to borrow." };
  const r = await run(fakeModel({ policy: (id) => (id === "C17-03" || id === "C05-05" ? { outcome: "3", seg: 3 } : undefined), flags: [f] }));
  assert.equal(crit(r, "C17-03").outcome, "1");
  assert.equal(crit(r, "C05-05").outcome, "1");
});
