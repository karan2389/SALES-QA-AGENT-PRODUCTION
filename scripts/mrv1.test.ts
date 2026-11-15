import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_CRITERIA, CATEGORIES, FLAG_IDS, MRV1_VERSION, PASSES, SALES_STAGE_CRITERIA, SP_CRITERIA, applicabilityFor, criteriaForPass } from "../src/mrv1/rubric.ts";
import { categoryScore, computePsychologyScore, computeSalesStageScore } from "../src/mrv1/scoring.ts";
import type { ScoredCriterion } from "../src/mrv1/scoring.ts";
import { runMrv1Evaluation, recordingGate, exportEligibility, naCriteria } from "../src/mrv1/engine.ts";
import { scanCandidates, validateFlags, mentionsProtectedCharacteristic } from "../src/mrv1/flags.ts";
import { validatePass } from "../src/mrv1/validate.ts";
import { approvedC01C02Text, buildPassMessages } from "../src/mrv1/prompt.ts";
import { buildReport, renderReportText, REPORT_SECTIONS, NOT_ESTABLISHED } from "../src/mrv1/report.ts";
import { assessTranscript } from "../src/mrv1/transcript-gate.ts";
import { computeQuality } from "../src/evaluation/transcript.ts";
import { AUDIO_BYTES, CALL_SECONDS, FakeStore, SEGMENTS, call, fakeModel } from "./mrv1-fixtures.ts";

const sc = (cat: string, id: string, outcome: string): ScoredCriterion => ({ category_id: cat, criterion_id: id, outcome });
const run = (store: FakeStore, model = fakeModel(), req: { dryRun?: boolean; acknowledgeConflict?: boolean } = {}) => runMrv1Evaluation({ store, model }, { callyzerCallId: "CY-7", ...req });
const only = <T extends { status: string }>(r: T, s: string): T => {
  assert.equal(r.status, s, JSON.stringify(r).slice(0, 400));
  return r;
};

// ---------- rubric integrity ----------
test("rubric: version, 19 categories, exact criterion counts and ids", () => {
  assert.equal(MRV1_VERSION, "MRV1.0");
  assert.equal(CATEGORIES.length, 19);
  assert.deepEqual(CATEGORIES.map((c) => c.criteria.length), [3, 6, 9, 3, 5, 2, 2, 3, 3, 2, 2, 3, 2, 3, 5, 5, 4, 4, 4]);
  assert.equal(SALES_STAGE_CRITERIA.length, 70);
  assert.deepEqual(CATEGORIES.map((c) => c.id), Array.from({ length: 19 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`));
  assert.equal(CATEGORIES[14].criteria[4].id, "C15-05");
  assert.equal(CATEGORIES[18].criteria[3].id, "C19-04");
});
test("rubric: exactly 22 Sales Psychology criteria, no duplicate ids anywhere", () => {
  assert.equal(SP_CRITERIA.length, 22);
  assert.equal(SP_CRITERIA[0].id, "SP-01");
  assert.equal(SP_CRITERIA[21].id, "SP-22");
  assert.equal(new Set(ALL_CRITERIA.map((c) => c.id)).size, ALL_CRITERIA.length);
  assert.equal(ALL_CRITERIA.length, 92);
});
test("rubric: model passes cover every criterion exactly once", () => {
  const ids = PASSES.flatMap((p) => criteriaForPass(p).map((c) => c.id));
  assert.equal(ids.length, ALL_CRITERIA.length);
  assert.equal(new Set(ids).size, ids.length);
});
test("rubric: ten ethical flag ids", () => {
  assert.equal(FLAG_IDS.length, 10);
});

// ---------- scoring ----------
const cat3 = (outcomes: string[]) => outcomes.map((o, i) => sc("C03", `C03-0${i + 1}`, o));
test("scoring: single scores 0, 1, 2, 3", () => {
  for (const [o, pct] of [["0", 0], ["1", 100 / 3], ["2", (2 / 3) * 100], ["3", 100]] as const) assert.ok(Math.abs((categoryScore("C03", "x", cat3([o])).percent as number) - pct) < 1e-9);
});
test("scoring: N/A and NE are never zero", () => {
  assert.equal(categoryScore("C03", "x", cat3(["N/A", "N/A"])).status, "not_applicable");
  assert.equal(categoryScore("C03", "x", cat3(["N/A"])).percent, null);
  const ne = categoryScore("C03", "x", cat3(["NE", "NE"]));
  assert.equal(ne.percent, null);
  assert.equal(ne.status, "not_evaluable");
  const mixed = categoryScore("C03", "x", cat3(["3", "NE", "N/A"]));
  assert.equal(mixed.percent, 100); // NE and N/A leave numerator and denominator
  assert.equal(mixed.provisional, true);
  assert.equal(mixed.display, "100.0% (provisional)");
  assert.notEqual(categoryScore("C03", "x", cat3(["3", "0"])).percent, mixed.percent); // a genuine 0 differs from NE
});
test("scoring: mixed numeric / N/A / NE, formula sum / (3 x numeric) x 100", () => {
  assert.equal(categoryScore("C03", "x", cat3(["3", "2", "1", "N/A", "NE"])).percent, (6 / 9) * 100);
});
const full = (over: Record<string, string> = {}) => SALES_STAGE_CRITERIA.map((c) => sc(c.category_id, c.id, over[c.id] ?? over[c.category_id] ?? "3"));
test("scoring: equal category weighting regardless of criterion count", () => {
  // C03 has 9 criteria, C06 has 2: each contributes one category percentage to the average.
  const r = computeSalesStageScore({ state: "valid", criteria: full({ C03: "0", C06: "3" }), expectedIds: SALES_STAGE_CRITERIA.map((c) => c.id) });
  assert.equal(r.applicable_categories, 19);
  assert.equal(r.percent, (18 * 100 + 0) / 19);
  assert.equal(r.status, "definitive");
  assert.equal(r.display, `${((18 * 100) / 19).toFixed(1)}%`);
});
test("scoring: entirely N/A categories are excluded (continuation)", () => {
  const crit = full({ C01: "N/A", C02: "N/A" });
  const r = computeSalesStageScore({ state: "valid", criteria: crit, expectedIds: SALES_STAGE_CRITERIA.map((c) => c.id) });
  assert.equal(r.applicable_categories, 17);
  assert.equal(r.percent, 100);
});
test("scoring: a category with NE makes the overall result provisional, never definitive", () => {
  const r = computeSalesStageScore({ state: "valid", criteria: full({ "C05-01": "NE" }), expectedIds: SALES_STAGE_CRITERIA.map((c) => c.id) });
  assert.equal(r.status, "provisional");
  assert.match(r.display, /provisional/);
  assert.ok(r.notes.some((n) => n.includes("C05")));
});
test("scoring: an entirely-NE category is provisional and does not count as zero", () => {
  const r = computeSalesStageScore({ state: "valid", criteria: full({ C06: "NE" }), expectedIds: SALES_STAGE_CRITERIA.map((c) => c.id) });
  assert.equal(r.applicable_categories, 18);
  assert.equal(r.percent, 100);
  assert.equal(r.status, "provisional");
});
test("scoring: held, unsupported, invalidated, blocked and incomplete never get a number", () => {
  const ids = SALES_STAGE_CRITERIA.map((c) => c.id);
  for (const state of ["held", "unsupported", "invalidated", "test_only", "blocked", "incomplete"] as const) {
    const r = computeSalesStageScore({ state, criteria: full(), expectedIds: ids });
    assert.equal(r.percent, null);
    assert.equal(r.display, "Not published");
  }
  assert.equal(computeSalesStageScore({ state: "valid", criteria: full().slice(1), expectedIds: ids }).status, "incomplete");
});
test("scoring: every category N/A -> N/A, not 0%", () => {
  const r = computeSalesStageScore({ state: "valid", criteria: full({ ...Object.fromEntries(CATEGORIES.map((c) => [c.id, "N/A"])) }), expectedIds: SALES_STAGE_CRITERIA.map((c) => c.id) });
  assert.equal(r.display, "N/A");
  assert.equal(r.percent, null);
});
test("scoring: Sales Psychology is independent and there is no combined score", () => {
  const crit = [...full({ C03: "0" }), ...SP_CRITERIA.map((c) => sc("SP", c.id, "3"))];
  const sales = computeSalesStageScore({ state: "valid", criteria: crit.filter((c) => c.category_id !== "SP"), expectedIds: SALES_STAGE_CRITERIA.map((c) => c.id) });
  const sp = computePsychologyScore(crit);
  assert.equal(sp.percent, 100);
  assert.notEqual(sales.percent, sp.percent);
  const both = { sales, sp };
  assert.ok(!Object.keys(sales).some((k) => /combined|total|overall/i.test(k)));
  assert.ok(!Object.keys(sp).some((k) => /combined|total|overall/i.test(k)));
  assert.equal(Object.keys(both).length, 2);
  // psychology: N/A excluded, NE provisional, incomplete unpublished
  const some = SP_CRITERIA.map((c, i) => sc("SP", c.id, i === 0 ? "NE" : i === 1 ? "N/A" : "2"));
  const p2 = computePsychologyScore(some);
  assert.equal(p2.status, "provisional");
  assert.equal(p2.percent, (2 / 3) * 100);
  assert.equal(computePsychologyScore(some.slice(1)).status, "incomplete");
});

// ---------- applicability ----------
test("applicability: new webinar attendee (and stored alias) evaluate all 19 categories", () => {
  for (const t of ["new_webinar_attendee", "new_webinar_prospect"]) assert.deepEqual(applicabilityFor(t, true), { kind: "evaluate", na_categories: [], na_reason: null });
});
test("applicability: continuation makes C01 and C02 N/A with call_type_not_covered; C03-C19 stay assessable", () => {
  assert.deepEqual(applicabilityFor("continuation", true), { kind: "evaluate", na_categories: ["C01", "C02"], na_reason: "call_type_not_covered" });
  const na = naCriteria(["C01", "C02"], "call_type_not_covered", "Owner");
  assert.equal(na.length, 9);
  assert.ok(na.every((c) => c.outcome === "N/A" && c.score === null && c.reason_code === "call_type_not_covered"));
});
test("applicability: unknown, unconfirmed or unlabelled hold; never inferred", () => {
  for (const t of [null, undefined, "unknown", "unconfirmed"]) assert.equal(applicabilityFor(t, true).kind, "hold");
  assert.equal(applicabilityFor("new_webinar_prospect", false).kind, "hold");
});
test("applicability: unsupported types get no normal evaluation", () => {
  for (const t of ["follow_up", "renewal", "support_existing_customer", "no_conversation", "other_unclassified", "unsupported"]) assert.equal(applicabilityFor(t, true).kind, "unsupported");
});

// ---------- gates ----------
test("gate 1: missing or incomplete recording holds the call before any model use", async () => {
  assert.equal(recordingGate(call({ audio_size_bytes: null })).ok, false);
  assert.equal(recordingGate(call({ audio_size_bytes: 100 * 4000 })).ok, false);
  const model = fakeModel();
  const r = only(await run(new FakeStore({ call: call({ audio_size_bytes: 100 * 4000 }) }), model), "hold");
  assert.equal((r as any).gate, 1);
  assert.equal(model.calls.length, 0);
});
test("gate 2: incomplete or too-short transcripts hold", async () => {
  assert.notEqual(assessTranscript(SEGMENTS.slice(0, 3), CALL_SECONDS, "en").decision, "eligible");
  assert.equal(assessTranscript(SEGMENTS.slice(0, 6), CALL_SECONDS, "en").decision, "incomplete_transcript");
  const model = fakeModel();
  const r = await run(new FakeStore({ transcript: { source: "production", language: "hi", segments: SEGMENTS.slice(0, 6) } }), model);
  assert.equal(r.status, "hold");
  assert.equal((r as any).gate, 2);
  assert.equal(model.calls.length, 0);
  assert.equal(assessTranscript(SEGMENTS, CALL_SECONDS, "en").decision, "eligible");
});
test("gate 3: unknown/unconfirmed label holds without any model call; unsupported is recorded for human review", async () => {
  const model = fakeModel();
  for (const label of [null, { business_call_type: "unknown", labelled_by: "x", basis: null, labelled_at: "" }, { business_call_type: "new_webinar_prospect", labelled_by: " ", basis: null, labelled_at: "" }]) {
    const r = await run(new FakeStore({ label }), model);
    assert.equal(r.status, "hold");
    assert.equal((r as any).gate, 3);
  }
  assert.equal(model.calls.length, 0);
  const store = new FakeStore({ label: { business_call_type: "renewal", labelled_by: "Owner", basis: null, labelled_at: "" } });
  const u: any = only(await run(store, model), "unsupported");
  assert.equal(model.calls.length, 0);
  assert.equal(u.document.applicability.reason_code, "unsupported_call_type");
  assert.equal(u.document.scores.sales_stage.percent, null);
  assert.equal(u.document.human_review.status, "pending");
  assert.equal(buildReport(u.document).status, "not_generated");
});
test("gate 7: export eligibility", () => {
  assert.equal(exportEligibility({ invalidated: true, applicability_status: "evaluated", applicability_reason: null }).eligible, false);
  assert.equal(exportEligibility({ invalidated: false, applicability_status: "not_applicable", applicability_reason: "unsupported_call_type" }).eligible, false);
  assert.equal(exportEligibility({ invalidated: false, applicability_status: "evaluated", applicability_reason: null }).eligible, true);
});

// ---------- engine ----------
test("engine: new webinar attendee, four passes, scores calculated by code, stored pending review", async () => {
  const store = new FakeStore();
  const model = fakeModel();
  const r: any = only(await run(store, model), "completed");
  assert.deepEqual(model.calls.map((c) => c.pass), PASSES.map((p) => p.key));
  const d = r.document;
  assert.equal(d.metadata.rubric_version, "MRV1.0");
  assert.equal(d.sales_stage.length, 70);
  assert.equal(d.psychology.length, 22);
  assert.equal(d.human_review.status, "pending");
  assert.ok([...d.sales_stage, ...d.psychology].every((c: any) => c.review_status === "pending"));
  assert.equal(d.scores.sales_stage.status, "provisional"); // C01/C02 are NE in this fixture
  assert.equal(d.scores.sales_stage.categories.find((c: any) => c.category_id === "C05").percent, (2 / 3) * 100);
  assert.equal(d.scores.psychology.percent, (2 / 3) * 100);
  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0].raws.length, 4);
});
test("engine: evidence timestamps are derived from segments by code", async () => {
  const r: any = await run(new FakeStore());
  const c = r.document.sales_stage.find((x: any) => x.criterion_id === "C03-01");
  assert.equal(c.evidence[0].start_s, SEGMENTS[3].start);
  assert.equal(c.evidence[0].end_s, SEGMENTS[3].end);
  assert.equal(c.evidence[0].verified, true);
  assert.equal(c.review_status, "pending");
  assert.ok(c.improvement_recommendation.length > 0);
});
test("engine: continuation does not ask the model for C01/C02 and records them N/A", async () => {
  const store = new FakeStore({ label: { business_call_type: "continuation", labelled_by: "Owner", basis: "earlier call", labelled_at: "" } });
  const model = fakeModel();
  const r: any = only(await run(store, model), "completed");
  assert.ok(!model.calls[0].system.includes("C01-01"));
  const c01 = r.document.sales_stage.filter((c: any) => c.category_id === "C01" || c.category_id === "C02");
  assert.equal(c01.length, 9);
  assert.ok(c01.every((c: any) => c.outcome === "N/A" && c.reason_code === "call_type_not_covered"));
  assert.equal(r.document.scores.sales_stage.applicable_categories, 17);
  assert.equal(r.document.scores.sales_stage.status, "definitive");
  assert.equal(r.document.scores.sales_stage.display, "66.7%");
  assert.equal(r.document.applicability.na_categories.join(), "C01,C02");
});
test("engine: C01/C02 keep the approved element caps (score above the element limit is capped)", async () => {
  // Only one of the three identity elements is on time, so C01-01 may not exceed 1 even if the model says 3.
  const model = fakeModel({ policy: (id) => (id === "C01-01" ? { outcome: "3", seg: 0, elements: [{ code: "N", state: "on_time" }, { code: "F", state: "never" }, { code: "T", state: "never" }] } : undefined) });
  const r: any = await run(new FakeStore(), model);
  const c = r.document.sales_stage.find((x: any) => x.criterion_id === "C01-01");
  assert.equal(c.outcome, "1");
  assert.equal(c.model_original_outcome, "3");
  assert.ok(r.document.validation.adjustments.some((a: any) => a.criterion_id === "C01-01"));
});
test("engine: fabricated quotation is rejected (NE, never kept, never zero)", async () => {
  const model = fakeModel({ policy: (id) => (id === "C03-01" ? { outcome: "3", quote: "I am the president of a large company with five hundred employees" } : undefined) });
  const r: any = await run(new FakeStore(), model);
  const c = r.document.sales_stage.find((x: any) => x.criterion_id === "C03-01");
  assert.equal(c.outcome, "NE");
  assert.equal(c.score, null);
  assert.equal(c.reason_code, "quote_not_verifiable");
  assert.equal(c.evidence.length, 0);
  assert.equal(c.model_original_outcome, "3");
});
test("engine: a score of 0 needs a verifiable absence record, otherwise NE", async () => {
  const good = (await run(new FakeStore(), fakeModel({ policy: (id) => (id === "C03-02" ? { outcome: "0" } : undefined) }))) as any;
  assert.equal(good.document.sales_stage.find((x: any) => x.criterion_id === "C03-02").outcome, "0");
  const text = (pass: string) => (pass === "stages_01_06" ? undefined : undefined);
  void text;
  const bad = fakeModel({ policy: (id) => (id === "C03-02" ? { outcome: "0", extra: { absence_record: { window_start_segment: 0, window_end_segment: 5, progression_excerpts: [{ segment: 2, quote: "something the salesperson never said at all", speaker: "salesperson" }], absence_explanation: "x" } } } : undefined) });
  const r: any = await run(new FakeStore(), bad);
  const c = r.document.sales_stage.find((x: any) => x.criterion_id === "C03-02");
  assert.equal(c.outcome, "NE");
  assert.equal(c.reason_code, "absence_record_insufficient");
});
test("engine: low transcript reliability blocks every published number", async () => {
  const r: any = await run(new FakeStore(), fakeModel({ assessment: { reliability: "low" } }));
  assert.equal(r.status, "completed");
  assert.equal(r.document.scores.sales_stage.percent, null);
  assert.equal(r.document.scores.sales_stage.status, "blocked");
  assert.equal(r.document.scores.psychology.percent, null);
});
test("engine: wrong language or poor speaker attribution also blocks the number", async () => {
  for (const a of [{ language_ok: false }, { speaker_attribution: "poor" }]) {
    const r: any = await run(new FakeStore(), fakeModel({ assessment: a }));
    assert.equal(r.document.scores.sales_stage.status, "blocked");
  }
});
test("engine: call-type conflict holds unless acknowledged", async () => {
  const assessment = { call_type_conflict: { suspected_type: "follow_up", segment: 10, quote: SEGMENTS[10].text, explanation: "refers to an earlier conversation" } };
  const store = new FakeStore();
  const r: any = await run(store, fakeModel({ assessment }));
  assert.equal(r.status, "hold");
  assert.equal(r.gate, 3);
  assert.equal(store.saved.length, 0);
  const ok = await run(new FakeStore(), fakeModel({ assessment }), { acknowledgeConflict: true });
  assert.equal(ok.status, "completed");
});
test("engine: duplicate requests return the existing evaluation; invalidated ones get a new revision", async () => {
  const dup = await run(new FakeStore({ existing: [{ prompt_version: "mrv1-prompt-v2", invalidated: false }] }));
  assert.equal(dup.status, "exists");
  const store = new FakeStore({ existing: [{ prompt_version: "mrv1-prompt-v2", invalidated: true }] });
  const r: any = only(await run(store), "completed");
  assert.equal(r.document.metadata.prompt_version, "mrv1-prompt-v2#r2");
  const dry = await run(new FakeStore(), fakeModel(), { dryRun: true });
  assert.equal(dry.status, "ready");
});
test("engine: model failures are never stored; transient failure is retried once", async () => {
  const store = new FakeStore();
  const always = fakeModel({ failFirst: 99 });
  const f: any = await run(store, always);
  assert.equal(f.status, "failed");
  assert.equal(store.saved.length, 0);
  const retry = await runMrv1Evaluation({ store: new FakeStore(), model: fakeModel({ failFirst: 1 }), maxAttempts: 2 }, { callyzerCallId: "CY-7" });
  assert.equal(retry.status, "completed");
  const noRetry = await runMrv1Evaluation({ store: new FakeStore(), model: fakeModel({ failFirst: 1 }), maxAttempts: 1 }, { callyzerCallId: "CY-7" });
  assert.equal(noRetry.status, "failed");
});
test("engine: invalid JSON, schema violations, incomplete output and truncation are failures and nothing is stored", async () => {
  for (const [name, text] of [
    ["malformed_json", () => "not json at all"],
    ["schema_invalid", () => JSON.stringify({ criteria: [], transcript_assessment: {} })],
    ["malformed_json", () => ""],
  ] as const) {
    const store = new FakeStore();
    const r: any = await run(store, fakeModel({ text }));
    assert.equal(r.status, "failed");
    assert.equal(r.error_kind, name);
    assert.equal(store.saved.length, 0);
  }
  const trunc = fakeModel();
  const orig = trunc.run.bind(trunc);
  trunc.run = async (q) => ({ ...(await orig(q)), finish_reason: "length" });
  const store = new FakeStore();
  const r: any = await run(store, trunc);
  assert.equal(r.error_kind, "truncated");
  assert.equal(store.saved.length, 0);
});

// ---------- evidence validation (schema level) ----------
async function validRaw() {
  const pass = PASSES[1];
  const ids = criteriaForPass(pass).map((c) => c.id);
  const { system, user } = buildPassMessages({ pass, expectedIds: ids, naCategories: [], callTypeLabel: "new_webinar_prospect", durationSeconds: CALL_SECONDS, transcriptSource: "production", segments: SEGMENTS, quality: computeQuality(SEGMENTS, CALL_SECONDS, "hi") });
  const m = fakeModel();
  const out = await m.run({ system, user });
  return { raw: JSON.parse(out.text), pass, ids };
}
test("evidence: valid output passes; invalid segment numbers, speakers and missing fields are rejected", async () => {
  const { raw, pass, ids } = await validRaw();
  assert.equal(validatePass(structuredClone(raw), pass, ids, SEGMENTS.length).ok, true);
  const badSeg = structuredClone(raw);
  badSeg.criteria[0].evidence[0].segment_end = 99;
  assert.match(JSON.stringify((validatePass(badSeg, pass, ids, SEGMENTS.length) as any).errors), /segment_start\/segment_end/);
  const badSpk = structuredClone(raw);
  badSpk.criteria[0].evidence[0].speaker = "customer";
  assert.match(JSON.stringify((validatePass(badSpk, pass, ids, SEGMENTS.length) as any).errors), /speaker/);
  const noRec = structuredClone(raw);
  delete noRec.criteria[0].improvement_recommendation;
  assert.match(JSON.stringify((validatePass(noRec, pass, ids, SEGMENTS.length) as any).errors), /improvement_recommendation/);
  const noNaReason = structuredClone(raw);
  Object.assign(noNaReason.criteria[0], { outcome: "N/A", reason_code: null });
  assert.equal(validatePass(noNaReason, pass, ids, SEGMENTS.length).ok, false);
  const noNeReason = structuredClone(raw);
  Object.assign(noNeReason.criteria[0], { outcome: "NE", reason_code: "made_up" });
  assert.equal(validatePass(noNeReason, pass, ids, SEGMENTS.length).ok, false);
  const unknownId = structuredClone(raw);
  unknownId.criteria[0].criterion_id = "C99-01";
  assert.equal(validatePass(unknownId, pass, ids, SEGMENTS.length).ok, false);
  const missing = structuredClone(raw);
  missing.criteria.pop();
  assert.equal(validatePass(missing, pass, ids, SEGMENTS.length).ok, false);
  const dupe = structuredClone(raw);
  dupe.criteria[1].criterion_id = dupe.criteria[0].criterion_id;
  assert.equal(validatePass(dupe, pass, ids, SEGMENTS.length).ok, false);
});
test("evidence: a numeric score without evidence becomes NE (missing_evidence)", async () => {
  const model = fakeModel({ policy: (id) => (id === "C07-01" ? { outcome: "2", extra: { evidence: [] } } : undefined) });
  const r: any = await run(new FakeStore(), model);
  const c = r.document.sales_stage.find((x: any) => x.criterion_id === "C07-01");
  assert.equal(c.outcome, "NE");
  assert.equal(c.reason_code, "missing_evidence");
});

// ---------- ethical safeguards ----------
const flagIn = (flag_id: string, seg: number, over: Record<string, unknown> = {}) => ({ flag_id, severity: "high", interpretation: "confirmed_conduct", segments: [seg], quote: SEGMENTS[seg].text, explanation: "The salesperson did this.", ...over });
test("flags: every flag id is accepted with a verified quote and keeps human decision pending", () => {
  for (const id of FLAG_IDS) {
    const v = validateFlags([flagIn(id, 6)], SEGMENTS);
    assert.deepEqual(v.errors, [], id);
    assert.equal(v.flags[0].verification_status, "quote_verified");
    assert.equal(v.flags[0].interpretation, "confirmed_conduct");
    assert.equal(v.flags[0].human_review_decision, "pending");
    assert.equal(v.flags[0].start_s, SEGMENTS[6].start);
  }
});
test("flags: fabricated quotation is removed and confirmed conduct is downgraded to ambiguous", () => {
  const v = validateFlags([flagIn("fabricated_social_proof", 6, { quote: "I personally guarantee you will earn ten lakh every month" })], SEGMENTS);
  assert.equal(v.flags[0].quote, null);
  assert.equal(v.flags[0].verification_status, "quote_unverified");
  assert.equal(v.flags[0].interpretation, "ambiguous");
  assert.ok(v.warnings.length > 0);
});
test("flags: ambiguous readings stay ambiguous; confirmed needs a quote", () => {
  const amb = validateFlags([flagIn("fake_urgency", 10, { interpretation: "ambiguous" })], SEGMENTS);
  assert.equal(amb.flags[0].interpretation, "ambiguous");
  const noQuote = validateFlags([flagIn("fake_urgency", 10, { quote: null })], SEGMENTS);
  assert.equal(noQuote.flags[0].interpretation, "ambiguous");
  assert.equal(noQuote.flags[0].verification_status, "needs_human_review");
});
test("flags: schema errors for unknown id, severity, empty segments and bad segment numbers", () => {
  assert.ok(validateFlags([flagIn("made_up", 6)], SEGMENTS).errors.length > 0);
  assert.ok(validateFlags([flagIn("fake_urgency", 6, { severity: "extreme" })], SEGMENTS).errors.length > 0);
  assert.ok(validateFlags([flagIn("fake_urgency", 6, { segments: [] })], SEGMENTS).errors.length > 0);
  assert.ok(validateFlags([flagIn("fake_urgency", 6, { segments: [99] })], SEGMENTS).errors.length > 0);
});
test("flags: protected-characteristic reasoning is never confirmed as conduct", () => {
  for (const text of ["The prospect is not a good fit because of his accent and poor English.", "Prospect is a veteran with a disability so unlikely to succeed.", "He has only primary education level so cannot understand."]) {
    assert.equal(mentionsProtectedCharacteristic(text), true);
    const v = validateFlags([flagIn("unsupported_customer_fit", 6, { explanation: text })], SEGMENTS);
    assert.equal(v.flags[0].interpretation, "ambiguous");
    assert.equal(v.flags[0].verification_status, "needs_human_review");
    assert.ok(v.flags[0].notes.some((n) => n.startsWith("protected_characteristic_reference")));
  }
  assert.equal(mentionsProtectedCharacteristic("The salesperson did not check technical requirements or realistic expectations."), false);
});
test("flags: lexical candidates (earnings promise, fake urgency, financial pressure) go to human verification only", () => {
  const segs = [
    "I guarantee you will earn five lakh every month",
    "This offer ends tonight, last chance to join",
    "You can take a loan or borrow from friends to join today",
    "Let us talk about the payment options calmly",
  ].map((text, index) => ({ index, start: index * 10, end: index * 10 + 8, text }));
  const found = scanCandidates(segs);
  assert.deepEqual(found.map((f) => f.flag).sort(), ["fake_urgency", "false_earnings_promise", "financial_pressure"]);
  assert.ok(!found.some((f) => f.segment === 3));
});
test("flags: engine keeps critical flags visible regardless of scores and verifies them", async () => {
  const flags = [flagIn("false_earnings_promise", 3, { quote: SEGMENTS[3].text }), flagIn("misrepresented_support", 6, { interpretation: "ambiguous" })];
  const r: any = await run(new FakeStore(), fakeModel({ flags, policy: (id) => (id.startsWith("C0") && !/^C0[12]/.test(id) ? { outcome: "3" } : undefined) }));
  assert.equal(r.document.extras.flags.length, 2);
  assert.equal(r.document.extras.flags[0].verification_status, "quote_verified");
  const rep = buildReport(r.document);
  assert.ok(rep.sections[10].lines.join("\n").includes("false_earnings_promise"));
});

// ---------- prompt ----------
test("prompt: reuses the approved C01/C02 detail and carries the MRV1 safeguards", () => {
  assert.match(approvedC01C02Text(), /C01-01 Self and team introduction/);
  assert.match(approvedC01C02Text(), /C02-06 Intent established/);
  const ids = criteriaForPass(PASSES[0]).map((c) => c.id);
  const { system, user } = buildPassMessages({ pass: PASSES[0], expectedIds: ids, naCategories: [], callTypeLabel: "new_webinar_prospect", durationSeconds: 600, transcriptSource: "production", segments: SEGMENTS, quality: computeQuality(SEGMENTS, 600, "hi") });
  for (const s of ["Never treat N/A or NE as zero", "Do not calculate any category, overall or psychology score", "personal characteristic", "MRV1.0", "APPROVED DETAILED RULES", "never write timestamps yourself"]) assert.ok(system.includes(s), s);
  assert.ok(user.includes("#0 ["));
  const psy = buildPassMessages({ pass: PASSES[3], expectedIds: criteriaForPass(PASSES[3]).map((c) => c.id), naCategories: [], callTypeLabel: "x", durationSeconds: 600, transcriptSource: "production", segments: SEGMENTS, quality: computeQuality(SEGMENTS, 600, "hi") }).system;
  assert.match(psy, /60 seconds or less/);
  assert.match(psy, /never combined/);
  const c15 = buildPassMessages({ pass: PASSES[2], expectedIds: criteriaForPass(PASSES[2]).map((c) => c.id), naCategories: [], callTypeLabel: "x", durationSeconds: 600, transcriptSource: "production", segments: SEGMENTS, quality: computeQuality(SEGMENTS, 600, "hi") }).system;
  assert.match(c15, /sb\.flexifunnels\.com\/advanced-features/);
  assert.match(c15, /Objection Doc has not been made available/);
});

// ---------- report ----------
test("report: 14 sections, Not established for unknown profile data, max three coaching priorities", async () => {
  const priorities = [1, 2, 3, 4].map((i) => ({ observed_issue: `Issue ${i}`, recommended_action: "Do X", better_behaviour_example: "Say Y", segments: [i] }));
  const r: any = await run(new FakeStore(), fakeModel({ priorities }));
  assert.ok(r.document.validation.warnings.some((w: string) => /only the first three/.test(w)));
  const rep = buildReport(r.document);
  assert.equal(rep.sections.length, 14);
  assert.deepEqual(rep.sections.map((s) => s.title), [...REPORT_SECTIONS]);
  assert.equal(r.document.extras.coaching_priorities.length, 3);
  const text = renderReportText(rep);
  assert.ok(text.includes(`annual revenue: ${NOT_ESTABLISHED}`));
  assert.ok(text.includes("Priority 3") && !text.includes("Priority 4"));
  assert.ok(text.includes("Example of better behaviour"));
  assert.ok(text.includes("never combined with the sales-stage score"));
});
test("report: coaching priority without an example or segments is a schema failure, not stored", async () => {
  const store = new FakeStore();
  const r: any = await run(store, fakeModel({ priorities: [{ observed_issue: "x", recommended_action: "y", better_behaviour_example: "", segments: [] }] }));
  assert.equal(r.status, "failed");
  assert.equal(r.error_kind, "schema_invalid");
  assert.equal(store.saved.length, 0);
});
test("report: unknown prospect field with a value but no evidence is dropped (Not established)", async () => {
  const m = fakeModel();
  const orig = m.run.bind(m);
  m.run = async (q) => {
    const out = await orig(q);
    const j = JSON.parse(out.text);
    if (j.prospect_profile) j.prospect_profile.team_size = { value: "twelve people", segments: [] };
    return { ...out, text: JSON.stringify(j) };
  };
  const r: any = await run(new FakeStore(), m);
  assert.equal(r.document.extras.prospect_profile.team_size.value, null);
});
test("audio bytes constant matches 32 kbps", () => assert.equal(AUDIO_BYTES, 2_400_000));

