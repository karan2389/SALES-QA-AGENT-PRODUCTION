// Offline tests for the evaluation pipeline: no network, no model, no database. Run: npm run test:evaluation
// All transcript text below is synthetic (written for these tests); no real call content is used.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { EvaluationModelError, runEvaluation } from "../src/evaluation/evaluate.ts";
import { NA_PROMPT_VERSION } from "../src/evaluation/evaluate.ts";
import type { ActiveCallTypeLabel, EvaluationModel, EvaluationStore, LoadedTranscript, StoredEvaluationRef } from "../src/evaluation/evaluate.ts";
import { validateInvalidationInput, validateLabelInput, validateReviewInput } from "../src/evaluation/labels.ts";
import { extractModelText } from "../src/evaluation/model-output.ts";
import { CATEGORIES_NOT_EVALUATED, CRITERIA, RUBRIC_VERSION } from "../src/evaluation/rubric.ts";
import { PROMPT_VERSION } from "../src/evaluation/prompt.ts";
import { normalizeForMatch, quoteInSegments } from "../src/evaluation/transcript.ts";
import { parseModelJson } from "../src/evaluation/validate.ts";
import type { EvaluationDocument, Segment } from "../src/evaluation/types.ts";
import { checkRubricAgainstDocument } from "./check-rubric.ts";

const LINES = [
  "Hi, this is Riya. I am calling from the mentoring team of FlexiFunnels.", // 0
  "We have selected you for a personalised one to one session. For the next 20 minutes we will talk about your goals.", // 1
  "Why did you attend the webinar?", // 2
  "I wanted to learn how to sell my yoga course online.", // 3
  "Okay, you want to sell a yoga course online. What did you learn from the webinar?", // 4
  "I learned about landing pages and how funnels capture leads.", // 5
  "Landing pages, nice. How long have you been following FlexiFunnels?", // 6
  "About two years.", // 7
  "What made you follow it?", // 8
  "The free trainings were really practical.", // 9
  "And how did you find out about this webinar?", // 10
  "I saw an ad on Instagram.", // 11
  "Great. Let me tell you about our software features.", // 12
];
const SEGMENTS: Segment[] = LINES.map((text, i) => ({ index: i, start: i * 10, end: i * 10 + 9, text }));
const DURATION = 130;

// ---- builders for model output ----
const ev = (seg: number, quote: string, speaker = "salesperson") => ({ segment_start: seg, segment_end: seg, quote, speaker, speaker_basis: "context" });
function crit(id: string, over: Record<string, unknown> = {}) {
  const def = CRITERIA.find((c) => c.id === id)!;
  const state = def.states.includes("on_time") ? "on_time" : "demonstrated";
  return {
    criterion_id: id, outcome: "3", reason_code: null,
    elements: def.elements.map((code) => ({ code, state, prompted_by_prospect: false })),
    element_details: def.element_details.map((element, i) => ({ element, asked: true, volunteered: false, established: "yes", quote: LINES[[7, 9, 11][i]], segment: [7, 9, 11][i] })),
    understanding_check_passed: def.understanding_check ? true : null,
    counts: def.counts ? { substantive_answers: 5, reflected_answers: 4, neutral_followups_on_distinct_answers: 2 } : null,
    evidence: [ev(0, "this is Riya")], absence_record: null,
    evidence_confidence: "high", confidence_reason: "clear in transcript", explanation: "Behaviour clearly demonstrated.", human_review_flags: [],
    ...over,
  };
}
function goodOutput(): any {
  return {
    criteria: [
      crit("C01-01"),
      crit("C01-02", { evidence: [ev(1, "selected you for a personalised one to one session")] }),
      crit("C01-03", { evidence: [ev(1, "next 20 minutes we will talk about your goals")] }),
      crit("C02-01", { evidence: [ev(2, "Why did you attend the webinar"), ev(3, "learn how to sell my yoga course online", "prospect")] }),
      crit("C02-02", { evidence: [ev(5, "landing pages and how funnels capture leads", "prospect")] }),
      crit("C02-03", { evidence: [ev(7, "About two years", "prospect"), ev(9, "free trainings were really practical", "prospect"), ev(11, "ad on Instagram", "prospect")] }),
      crit("C02-04", { outcome: "3", evidence: [ev(4, "you want to sell a yoga course online")] }),
      crit("C02-05", { outcome: "N/A", reason_code: "no_unclear_answer", evidence: [], elements: [] }),
      crit("C02-06", { evidence: [ev(2, "Why did you attend the webinar"), ev(12, "Let me tell you about our software features")] }),
    ],
    coaching: {
      key_strengths: [{ text: "Clear introduction naming self, team and company.", segments: [0] }],
      missed_opportunities: [{ text: "Did not ask a follow-up about the Instagram ad.", segments: [11, 12] }],
      improvement_recommendations: [{ text: "Probe the prospect's goals before moving to software features.", segments: [12] }],
      critical_flags: [],
      needs_human_verification: [],
    },
    transcript_assessment: { reliability: "high", notes: "Synthetic test transcript.", call_opening_observable: "yes", call_type_conflict: null },
  };
}
const setCrit = (o: any, id: string, patch: Record<string, unknown>) => Object.assign(o.criteria.find((c: any) => c.criterion_id === id), patch);

// ---- in-memory store and mock model ----
function makeStore(opts: { transcript?: LoadedTranscript | null; call?: boolean; activeLabel?: ActiveCallTypeLabel | null; invalidated?: Set<number> } = {}) {
  const evals: Array<{ id: number; doc: EvaluationDocument; review: string }> = [];
  const invalidated = opts.invalidated ?? new Set<number>();
  let nextId = 1;
  const store: EvaluationStore = {
    async loadCall(id) {
      return opts.call === false ? null : { id: 7, callyzer_call_id: id, agent_id: 3, duration_seconds: DURATION };
    },
    async loadTranscript(_callId, source) {
      if (opts.transcript === null) return null;
      return opts.transcript ?? { source, language: "hi", segments: SEGMENTS };
    },
    async getActiveCallTypeLabel() {
      return opts.activeLabel ?? null;
    },
    async findEvaluation(callId, rubric, prompt): Promise<StoredEvaluationRef | null> {
      const e = evals.find((x) => x.doc.metadata.call_id === callId && x.doc.metadata.rubric_version === rubric && x.doc.metadata.prompt_version === prompt);
      return e ? { id: e.id, human_review_status: e.review, evaluated_at: e.doc.metadata.evaluated_at, invalidated: invalidated.has(e.id) } : null;
    },
    async deleteEvaluation(id) {
      evals.splice(evals.findIndex((x) => x.id === id), 1);
    },
    async saveEvaluation(doc) {
      if (evals.some((x) => x.doc.metadata.call_id === doc.metadata.call_id && x.doc.metadata.rubric_version === doc.metadata.rubric_version && x.doc.metadata.prompt_version === doc.metadata.prompt_version))
        throw new Error("UNIQUE constraint failed: evaluations.call_id");
      const id = nextId++;
      evals.push({ id, doc, review: doc.human_review.status });
      return id;
    },
  };
  return { store, evals, invalidated };
}
function mockModel(respond: () => string | Promise<string> | never, finish: string | null = "stop") {
  const m = { calls: 0, id: "@cf/openai/gpt-oss-120b", async run() { m.calls++; return { text: await respond(), finish_reason: finish, usage: { total_tokens: 1 } }; } };
  return m as EvaluationModel & { calls: number };
}
const REQ = { callyzerCallId: "call_abc", callType: "new_webinar_prospect", labelledBy: "test-reviewer", basis: "unit test" };
const run = (store: EvaluationStore, model: EvaluationModel, over: Record<string, unknown> = {}) => runEvaluation({ store, model, now: () => new Date("2026-11-14T10:00:00Z") }, { ...REQ, ...over });
const crit_of = (doc: EvaluationDocument, id: string) => doc.categories.flatMap((c) => c.criteria).find((c) => c.criterion_id === id)!;

test("rubric digest loads and matches the approved document headings", () => {
  assert.equal(CRITERIA.length, 9);
  assert.deepEqual(checkRubricAgainstDocument(readFileSync("docs/evaluation-rubric-v1.md", "utf8")), []);
});

test("valid model response is validated, stored, and carries model id, versions and pending review", async () => {
  const { store, evals } = makeStore();
  const model = mockModel(() => JSON.stringify(goodOutput()));
  const r = await run(store, model);
  assert.equal(r.status, "completed");
  assert.equal(evals.length, 1);
  const doc = (r as any).document as EvaluationDocument;
  assert.equal(doc.metadata.model_id, "@cf/openai/gpt-oss-120b");
  assert.equal(doc.metadata.prompt_version, PROMPT_VERSION);
  assert.equal(doc.metadata.rubric_version, RUBRIC_VERSION);
  assert.equal(doc.metadata.call_id, 7);
  assert.equal(doc.metadata.agent_id, 3);
  assert.equal(doc.human_review.status, "pending");
  assert.equal(doc.categories.filter((c) => c.status === "evaluated").length, 2);
  assert.equal(crit_of(doc, "C01-01").score, 3);
  assert.equal(crit_of(doc, "C02-05").outcome, "N/A");
  // timestamps are derived from segments, not from the model
  assert.deepEqual([crit_of(doc, "C01-01").evidence[0].start_s, crit_of(doc, "C01-01").evidence[0].end_s], [0, 9]);
  assert.equal(JSON.stringify(doc).includes("overall"), false); // no overall or weighted score
});

test("categories 03-19 are reported as not_evaluated with no criteria or scores", async () => {
  const { store } = makeStore();
  const r: any = await run(store, mockModel(() => JSON.stringify(goodOutput())));
  const ne = r.document.categories.filter((c: any) => c.status === "not_evaluated");
  assert.equal(ne.length, CATEGORIES_NOT_EVALUATED.length);
  assert.ok(ne.every((c: any) => c.criteria.length === 0));
});

test("malformed JSON is rejected and nothing is stored", async () => {
  const { store, evals } = makeStore();
  const r: any = await run(store, mockModel(() => "Sure! Here is my evaluation: {criteria: [oops"));
  assert.equal(r.status, "failed");
  assert.equal(r.error_kind, "malformed_json");
  assert.equal(evals.length, 0);
});

test("JSON inside code fences or surrounded by prose is still parsed", () => {
  const p = parseModelJson("Here you go:\n```json\n{\"a\": 1}\n```\nDone.");
  assert.deepEqual(p.ok && p.value, { a: 1 });
  assert.equal(parseModelJson("").ok, false);
});

test("missing required fields are rejected with every problem listed", async () => {
  const { store, evals } = makeStore();
  const bad = goodOutput();
  bad.criteria = bad.criteria.filter((c: any) => c.criterion_id !== "C02-06");
  delete bad.coaching;
  const r: any = await run(store, mockModel(() => JSON.stringify(bad)));
  assert.equal(r.status, "failed");
  assert.equal(r.error_kind, "schema_invalid");
  assert.ok(r.errors.some((e: string) => e.includes("missing C02-06")));
  assert.ok(r.errors.some((e: string) => e.includes("coaching")));
  assert.equal(evals.length, 0);
});

test("invalid score values are rejected", async () => {
  for (const outcome of ["5", 3, "high", "-1"]) {
    const { store, evals } = makeStore();
    const bad = goodOutput();
    setCrit(bad, "C01-01", { outcome });
    const r: any = await run(store, mockModel(() => JSON.stringify(bad)));
    assert.equal(r.status, "failed", `outcome ${JSON.stringify(outcome)} should fail`);
    assert.equal(r.error_kind, "schema_invalid");
    assert.equal(evals.length, 0);
  }
});

test("a score with no evidence becomes NE (missing_evidence), never a stored score", async () => {
  const { store } = makeStore();
  const bad = goodOutput();
  setCrit(bad, "C01-02", { evidence: [] });
  const r: any = await run(store, mockModel(() => JSON.stringify(bad)));
  assert.equal(r.status, "completed");
  const c = crit_of(r.document, "C01-02");
  assert.equal(c.outcome, "NE");
  assert.equal(c.reason_code, "missing_evidence");
  assert.equal(c.score, null);
  assert.equal(c.model_original_outcome, "3");
  assert.ok(r.document.validation.adjustments.some((a: any) => a.criterion_id === "C01-02"));
});

test("a fabricated quotation is removed and the criterion becomes NE (quote_not_verifiable)", async () => {
  const { store } = makeStore();
  const bad = goodOutput();
  setCrit(bad, "C01-01", { evidence: [ev(0, "I am the CEO of FlexiFunnels and this call is guaranteed to double your income")] });
  const r: any = await run(store, mockModel(() => JSON.stringify(bad)));
  const c = crit_of(r.document, "C01-01");
  assert.equal(c.outcome, "NE");
  assert.equal(c.reason_code, "quote_not_verifiable");
  assert.equal(c.evidence.length, 0);
  assert.ok(r.document.validation.warnings.some((w: string) => w.includes("C01-01")));
});

test("scores above what the reported elements allow are capped by code", async () => {
  const { store } = makeStore();
  const bad = goodOutput();
  setCrit(bad, "C01-01", { outcome: "3", elements: [{ code: "N", state: "on_time" }, { code: "F", state: "on_time" }, { code: "T", state: "never" }] });
  setCrit(bad, "C02-04", { outcome: "3", counts: { substantive_answers: 5, reflected_answers: 3, neutral_followups_on_distinct_answers: 2 } }); // needs 4 of 5
  setCrit(bad, "C02-01", { outcome: "3", understanding_check_passed: false });
  const r: any = await run(store, mockModel(() => JSON.stringify(bad)));
  assert.equal(crit_of(r.document, "C01-01").outcome, "2");
  assert.equal(crit_of(r.document, "C02-04").outcome, "2");
  assert.equal(crit_of(r.document, "C02-01").outcome, "2");
  assert.equal(crit_of(r.document, "C01-01").model_original_outcome, "3");
});

test("the provisional 75% reflection threshold: 4 answers need 3 reflected; 1-2 answers need all", async () => {
  const mk = async (n: number, reflected: number, follow: number) => {
    const { store } = makeStore();
    const o = goodOutput();
    setCrit(o, "C02-04", { outcome: "3", counts: { substantive_answers: n, reflected_answers: reflected, neutral_followups_on_distinct_answers: follow } });
    return crit_of(((await run(store, mockModel(() => JSON.stringify(o)))) as any).document, "C02-04").outcome;
  };
  assert.equal(await mk(4, 3, 2), "3");
  assert.equal(await mk(4, 2, 2), "2");
  assert.equal(await mk(2, 2, 2), "3");
  assert.equal(await mk(2, 1, 2), "2");
  assert.equal(await mk(1, 1, 1), "3");
  assert.equal(await mk(8, 6, 2), "3");
  assert.equal(await mk(8, 5, 2), "2");
});

test("a zero needs an absence record with a verifiable excerpt; otherwise NE; zero with demonstrated elements is NE", async () => {
  const zero = (extra: Record<string, unknown>) => {
    const o = goodOutput();
    setCrit(o, "C01-03", { outcome: "0", evidence: [], elements: [{ code: "X1", state: "never" }, { code: "X2", state: "never" }], ...extra });
    return o;
  };
  const goodRecord = { window_start_segment: 0, window_end_segment: 2, progression_excerpts: [{ segment: 2, quote: "Why did you attend the webinar", speaker: "salesperson" }], absence_explanation: "No expectation statement before the first discovery question." };
  let r: any = await run(makeStore().store, mockModel(() => JSON.stringify(zero({ absence_record: goodRecord }))));
  assert.equal(crit_of(r.document, "C01-03").outcome, "0");
  assert.ok(crit_of(r.document, "C01-03").absence_record);
  r = await run(makeStore().store, mockModel(() => JSON.stringify(zero({ absence_record: null }))));
  assert.equal(crit_of(r.document, "C01-03").outcome, "NE");
  assert.equal(crit_of(r.document, "C01-03").reason_code, "absence_record_insufficient");
  r = await run(makeStore().store, mockModel(() => JSON.stringify(zero({ absence_record: { ...goodRecord, progression_excerpts: [{ segment: 2, quote: "an invented excerpt nobody said", speaker: "salesperson" }] } }))));
  assert.equal(crit_of(r.document, "C01-03").outcome, "NE");
  r = await run(makeStore().store, mockModel(() => JSON.stringify(zero({ absence_record: goodRecord, elements: [{ code: "X1", state: "on_time" }, { code: "X2", state: "never" }] }))));
  assert.equal(crit_of(r.document, "C01-03").reason_code, "inconsistent_model_output");
});

test("N/A is only accepted with an allowed reason code", async () => {
  const bad = goodOutput();
  setCrit(bad, "C01-01", { outcome: "N/A", reason_code: "no_substantive_answer", evidence: [], elements: [] });
  const r: any = await run(makeStore().store, mockModel(() => JSON.stringify(bad)));
  assert.equal(r.status, "failed");
  assert.equal(r.error_kind, "schema_invalid");
});

test("model invocation failure and timeout are reported, nothing stored", async () => {
  for (const [err, kind] of [[new Error("Workers AI 5xx"), "model_error"], [new EvaluationModelError("timeout", "no response"), "timeout"]] as const) {
    const { store, evals } = makeStore();
    const r: any = await run(store, mockModel(() => { throw err; }));
    assert.equal(r.status, "failed");
    assert.equal(r.error_kind, kind);
    assert.equal(evals.length, 0);
  }
});

test("a response cut off at the output limit is rejected as truncated", async () => {
  const { store, evals } = makeStore();
  const r: any = await run(store, mockModel(() => '{"criteria": [', "length"));
  assert.equal(r.error_kind, "truncated");
  assert.equal(evals.length, 0);
});

test("duplicate evaluations are prevented; replace works only while review is pending", async () => {
  const { store, evals } = makeStore();
  const model = mockModel(() => JSON.stringify(goodOutput()));
  const first: any = await run(store, model);
  const second: any = await run(store, model);
  assert.equal(first.status, "completed");
  assert.equal(second.status, "exists");
  assert.equal(second.evaluation_id, first.evaluation_id);
  assert.equal(model.calls, 1, "the duplicate must not use the model");
  assert.equal(evals.length, 1);
  const replaced: any = await run(store, model, { replace: true });
  assert.equal(replaced.status, "completed");
  assert.equal(model.calls, 2);
  assert.equal(evals.length, 1);
  evals[0].review = "in_review";
  const refused: any = await run(store, model, { replace: true });
  assert.equal(refused.status, "failed");
  assert.equal(refused.error_kind, "replace_refused");
  assert.equal(model.calls, 2);
});

test("a database unique-constraint race returns the existing evaluation instead of failing", async () => {
  const { store } = makeStore();
  const winner: any = await run(store, mockModel(() => JSON.stringify(goodOutput())));
  const racing: EvaluationStore = { ...store, async findEvaluation() { return calls++ === 0 ? null : { id: winner.evaluation_id, human_review_status: "pending", evaluated_at: "x", invalidated: false }; } };
  let calls = 0;
  const r: any = await run(racing, mockModel(() => JSON.stringify(goodOutput())));
  assert.equal(r.status, "exists");
});

test("missing or invalid call type holds the call: no model use, nothing stored, never a score", async () => {
  for (const over of [{ callType: undefined }, { callType: "" }, { callType: "renewall" }, { labelledBy: "" }, { labelledBy: undefined }]) {
    const { store, evals } = makeStore();
    const model = mockModel(() => JSON.stringify(goodOutput()));
    const r: any = await run(store, model, over);
    assert.equal(r.status, "hold");
    assert.equal(model.calls, 0);
    assert.equal(evals.length, 0);
  }
});

test("calls that are not new webinar-prospect calls are N/A with no model use (rubric section 13)", async () => {
  for (const [type, reason] of [["renewal", "call_type_not_covered"], ["follow_up", "call_type_not_covered"], ["support_existing_customer", "call_type_not_covered"], ["no_conversation", "no_conversation"]] as const) {
    const { store, evals } = makeStore();
    const model = mockModel(() => JSON.stringify(goodOutput()));
    const r: any = await run(store, model, { callType: type });
    assert.equal(r.status, "not_applicable");
    assert.equal(model.calls, 0);
    assert.equal(evals.length, 1);
    assert.equal(r.document.metadata.model_id, null);
    assert.ok(r.document.categories.filter((c: any) => c.status === "not_applicable").length === 2);
    assert.ok(r.document.categories.flatMap((c: any) => c.criteria).every((c: any) => c.outcome === "N/A" && c.reason_code === reason && c.score === null));
  }
});

test("no stored transcript or unknown call: no model use", async () => {
  const model = mockModel(() => JSON.stringify(goodOutput()));
  let r: any = await run(makeStore({ transcript: null }).store, model);
  assert.equal(r.error_kind, "transcript_missing");
  r = await run(makeStore({ transcript: { source: "production", language: null, segments: [] } }).store, model);
  assert.equal(r.error_kind, "transcript_missing");
  r = await run(makeStore({ call: false }).store, model);
  assert.equal(r.error_kind, "call_not_found");
  assert.equal(model.calls, 0);
});

test("dry run confirms the transcript, segments and timestamps are available without using the model", async () => {
  const model = mockModel(() => "never used");
  const r: any = await run(makeStore().store, model, { dryRun: true });
  assert.equal(r.status, "ready");
  assert.equal(r.segments, SEGMENTS.length);
  assert.equal(r.quality.segment_count, SEGMENTS.length);
  assert.equal(model.calls, 0);
});

test("model output layouts: chat-completions, Responses-style and empty", () => {
  assert.equal(extractModelText({ choices: [{ message: { content: "{\"a\":1}" }, finish_reason: "stop" }], usage: { total_tokens: 5 } }).text, "{\"a\":1}");
  assert.equal(extractModelText({ choices: [{ message: { content: null, reasoning_content: "thinking" }, finish_reason: "length" }] }).text, "");
  assert.equal(extractModelText({ output: [{ type: "reasoning", summary: [] }, { type: "message", content: [{ type: "output_text", text: "{\"b\":2}" }] }], status: "completed" }).text, "{\"b\":2}");
  assert.equal(extractModelText({ output_text: "hi", status: "incomplete" }).finish, "length");
  assert.equal(extractModelText({}).text, "");
});

test("quote matching tolerates case, punctuation and spacing but not invented words", () => {
  assert.equal(normalizeForMatch("Hello,  World!"), "helloworld");
  assert.ok(quoteInSegments("hi this is riya", SEGMENTS, 0, 0));
  assert.ok(quoteInSegments("आपने क्यों", [{ index: 0, start: 0, end: 1, text: "आपने क्यों attend किया?" }], 0, 0));
  assert.equal(quoteInSegments("this was never said", SEGMENTS, 0, 12), false);
  assert.equal(quoteInSegments("ok", SEGMENTS, 0, 12), false); // too short to count as evidence
});

// ---- call opening, call-type conflict and coaching verification (added after the first live run) ----
test("when the call opening is not observable, absent or partial behaviour is NE (recording_begins_midway), not 0", async () => {
  const o = goodOutput();
  o.transcript_assessment.call_opening_observable = "no";
  setCrit(o, "C01-01", { outcome: "0", evidence: [], elements: [{ code: "N", state: "never" }, { code: "F", state: "never" }, { code: "T", state: "never" }],
    absence_record: { window_start_segment: 0, window_end_segment: 2, progression_excerpts: [{ segment: 2, quote: "Why did you attend the webinar", speaker: "salesperson" }], absence_explanation: "x" } });
  setCrit(o, "C01-02", { outcome: "2", elements: [{ code: "P1", state: "on_time" }, { code: "P2", state: "never" }] }); // partial intro with an unobserved opening
  setCrit(o, "C02-01", { outcome: "0", evidence: [], elements: [{ code: "Q", state: "never" }, { code: "A", state: "never" }], understanding_check_passed: null,
    absence_record: { window_start_segment: 0, window_end_segment: 2, progression_excerpts: [{ segment: 2, quote: "Why did you attend the webinar", speaker: "salesperson" }], absence_explanation: "x" } });
  const r: any = await run(makeStore().store, mockModel(() => JSON.stringify(o)));
  for (const id of ["C01-01", "C01-02", "C02-01"]) {
    assert.equal(crit_of(r.document, id).outcome, "NE", id);
    assert.equal(crit_of(r.document, id).reason_code, "recording_begins_midway", id);
  }
  assert.equal(crit_of(r.document, "C01-03").outcome, "3", "a fully demonstrated criterion keeps its score");
  assert.equal(crit_of(r.document, "C02-02").outcome, "3", "scores resting on observed evidence are kept");
});

const CONFLICT = { suspected_type: "renewal", segment: 12, quote: "Let me tell you about our software features", explanation: "Sounds like an existing-customer offer." };

test("a transcript that indicates another call type holds the call (not stored) until a human acknowledges the conflict", async () => {
  const o = goodOutput();
  o.transcript_assessment.call_type_conflict = CONFLICT;
  const { store, evals } = makeStore();
  const model = mockModel(() => JSON.stringify(o));
  const held: any = await run(store, model);
  assert.equal(held.status, "hold");
  assert.match(held.reason, /renewal/);
  assert.equal(evals.length, 0, "a held evaluation must not be stored");
  assert.equal(held.document.call_type.conflict_suspected.suspected_type, "renewal");
  const stored: any = await run(store, model, { acknowledgeConflict: true });
  assert.equal(stored.status, "completed");
  assert.equal(stored.document.call_type.label, "new_webinar_prospect", "the human label is never overridden");
  assert.equal(stored.document.call_type.conflict_acknowledged, true);
  assert.equal(stored.document.call_type.conflict_suspected.suspected_type, "renewal");
  assert.equal(evals.length, 1);
});

test("an unverifiable call-type conflict claim is ignored; an invalid suspected type is rejected", async () => {
  const o = goodOutput();
  o.transcript_assessment.call_type_conflict = { ...CONFLICT, quote: "this was never said in the call" };
  const r: any = await run(makeStore().store, mockModel(() => JSON.stringify(o)));
  assert.equal(r.status, "completed");
  assert.equal(r.document.call_type.conflict_suspected, null);
  assert.ok(r.document.validation.warnings.some((w: string) => w.includes("call-type conflict")));
  const bad = goodOutput();
  bad.transcript_assessment.call_type_conflict = { ...CONFLICT, suspected_type: "new_webinar_prospect" };
  const r2: any = await run(makeStore().store, mockModel(() => JSON.stringify(bad)));
  assert.equal(r2.error_kind, "schema_invalid");
});

test("critical-flag quotations are verified against the transcript; invalid segment numbers are dropped", async () => {
  const o = goodOutput();
  o.coaching.critical_flags = [
    { flag: "unverified_claim", explanation: "real quote with ellipsis", segments: [4, 5], quote: "you want to sell a yoga course ... landing pages and how funnels" },
    { flag: "invented", explanation: "fabricated", segments: [4], quote: "we guarantee you will earn ten lakhs a month" },
  ];
  o.coaching.key_strengths = [{ text: "ok", segments: [0, 999, -1] }];
  const r: any = await run(makeStore().store, mockModel(() => JSON.stringify(o)));
  const flags = r.document.coaching.critical_flags;
  assert.ok(flags[0].quote, "a genuine ellipsis-separated quote is kept");
  assert.equal(flags[1].quote, null, "a fabricated quote is removed");
  assert.deepEqual(r.document.coaching.key_strengths[0].segments, [0]);
  assert.ok(r.document.validation.warnings.some((w: string) => w.includes("invented")));
});

test("not-applicable documents carry the call-type conflict fields (null) and never call the model", async () => {
  const { store } = makeStore();
  const r: any = await run(store, mockModel(() => "never used"), { callType: "renewal" });
  assert.equal(r.document.call_type.conflict_suspected, null);
  assert.equal(r.document.call_type.conflict_acknowledged, false);
});
test("all three introduction criteria scoring 0 raises a human-verification flag without changing scores", async () => {
  const rec = { window_start_segment: 0, window_end_segment: 2, progression_excerpts: [{ segment: 2, quote: "Why did you attend the webinar", speaker: "salesperson" }], absence_explanation: "x" };
  const o = goodOutput();
  for (const [id, codes] of [["C01-01", ["N", "F", "T"]], ["C01-02", ["P1", "P2"]], ["C01-03", ["X1", "X2"]]] as const)
    setCrit(o, id, { outcome: "0", evidence: [], elements: codes.map((code) => ({ code, state: "never" })), absence_record: rec });
  const r: any = await run(makeStore().store, mockModel(() => JSON.stringify(o)));
  for (const id of ["C01-01", "C01-02", "C01-03"]) {
    assert.equal(crit_of(r.document, id).outcome, "0", "scores are not changed");
    assert.ok(crit_of(r.document, id).human_review_flags.includes("verify_call_opening_and_type"));
  }
  assert.ok(r.document.coaching.needs_human_verification[0].includes("All three introduction criteria scored 0"));
  const one = goodOutput();
  const r2: any = await run(makeStore().store, mockModel(() => JSON.stringify(one)));
  assert.equal(crit_of(r2.document, "C01-01").human_review_flags.includes("verify_call_opening_and_type"), false);
});
// ---- confirmed call-type label, evaluation invalidation and re-evaluation guards (Agent 1 correction) ----
const CONTINUATION: ActiveCallTypeLabel = { business_call_type: "continuation", labelled_by: "project owner (confirmed in chat)", basis: "User confirmed this is a continuation call.", labelled_at: "2026-11-14 16:00:00" };

test("a call with a confirmed continuation label is stored as N/A (call_type_not_covered) with no model use", async () => {
  const { store, evals } = makeStore({ activeLabel: CONTINUATION });
  const model = mockModel(() => { throw new Error("the model must not be called"); });
  const r: any = await run(store, model, { callType: undefined, labelledBy: undefined, basis: undefined });
  assert.equal(r.status, "not_applicable");
  assert.equal(model.calls, 0);
  assert.equal(evals.length, 1);
  const d: EvaluationDocument = r.document;
  assert.equal(d.call_type.label, "continuation");
  assert.equal(d.call_type.labelled_by, CONTINUATION.labelled_by);
  assert.equal(d.metadata.model_id, null);
  assert.equal(d.metadata.prompt_version, NA_PROMPT_VERSION);
  assert.ok(d.categories.flatMap((c) => c.criteria).every((c) => c.outcome === "N/A" && c.reason_code === "call_type_not_covered" && c.score === null));
  assert.equal(d.categories.flatMap((c) => c.criteria).length, 9, "all nine Category 01 and 02 criteria are recorded N/A");
});

test("a confirmed continuation call cannot be evaluated as a new webinar prospect without a verified label change", async () => {
  const { store, evals } = makeStore({ activeLabel: CONTINUATION });
  const model = mockModel(() => JSON.stringify(goodOutput()));
  for (const over of [{ callType: "new_webinar_prospect" }, { callType: "new_webinar_prospect", acknowledgeConflict: true }, { callType: "renewal" }]) {
    const r: any = await run(store, model, over);
    assert.equal(r.status, "hold");
    assert.match(r.reason, /explicit, verified classification change/);
  }
  assert.equal(model.calls, 0);
  assert.equal(evals.length, 0);
});

test("repeating the not-applicable run does not duplicate; a matching request label is accepted", async () => {
  const { store, evals } = makeStore({ activeLabel: CONTINUATION });
  const model = mockModel(() => "never");
  const a: any = await run(store, model, { callType: "continuation", labelledBy: "x", basis: "y" });
  const b: any = await run(store, model, { callType: undefined, labelledBy: undefined });
  assert.equal(a.status, "not_applicable");
  assert.equal(b.status, "exists");
  assert.equal(evals.length, 1);
});

test("without a confirmed label on file the request label still works (unchanged behaviour); an active label always wins", async () => {
  const none: any = await run(makeStore().store, mockModel(() => JSON.stringify(goodOutput())));
  assert.equal(none.status, "completed");
  const held: any = await run(makeStore({ activeLabel: CONTINUATION }).store, mockModel(() => "never"), { callType: "follow_up" });
  assert.equal(held.status, "hold");
});

test("an invalidated evaluation is audit-only: it blocks the model path, is never replaced, and does not block the N/A record", async () => {
  const opts: { activeLabel?: ActiveCallTypeLabel | null } = {};
  const { store, evals, invalidated } = makeStore(opts);
  const model = mockModel(() => JSON.stringify(goodOutput()));
  const first: any = await run(store, model);
  invalidated.add(first.evaluation_id);
  const again: any = await run(store, model);
  assert.equal(again.status, "failed");
  assert.equal(again.error_kind, "invalidated_evaluation_exists");
  const replace: any = await run(store, model, { replace: true });
  assert.equal(replace.error_kind, "invalidated_evaluation_exists");
  assert.equal(model.calls, 1);
  assert.equal(evals.length, 1, "the invalidated evaluation is kept");
  // a confirmed continuation label produces a separate N/A record under the no-model prompt marker, next to the audit record
  opts.activeLabel = CONTINUATION;
  const na: any = await run(store, mockModel(() => { throw new Error("the model must not be called"); }), { callType: undefined, labelledBy: undefined });
  assert.equal(na.status, "not_applicable");
  assert.equal(evals.length, 2, "audit record and N/A record coexist");
  assert.equal(evals[0].doc.metadata.prompt_version, PROMPT_VERSION);
  assert.equal(evals[1].doc.metadata.prompt_version, NA_PROMPT_VERSION);
});

test("label and invalidation inputs are validated", () => {
  assert.equal(validateLabelInput({ callType: "continuation", labelledBy: "owner", basis: "confirmed", verification: null }).ok, true);
  assert.equal(validateLabelInput({ callType: "continuation", labelledBy: "owner", basis: null, verification: null }).ok, false, "a confirmed label needs a basis");
  assert.equal(validateLabelInput({ callType: "renewall", labelledBy: "owner", basis: "x", verification: null }).ok, false);
  assert.equal(validateLabelInput({ callType: "continuation", labelledBy: " ", basis: "x", verification: null }).ok, false);
  assert.equal(validateLabelInput({ callType: "new_webinar_prospect", labelledBy: "dev", basis: null, verification: "unverified_test_override" }).ok, true);
  assert.equal(validateLabelInput({ callType: "continuation", labelledBy: "o", basis: "x", verification: "maybe" }).ok, false);
  assert.equal(validateInvalidationInput({ id: "3", status: "test_only", reason: "unverified override", by: "owner" }).ok, true);
  for (const bad of [{ id: "0" }, { id: "abc" }, { status: "deleted" }, { reason: " " }, { by: "" }]) assert.equal(validateInvalidationInput({ id: "3", status: "test_only", reason: "r", by: "b", ...bad }).ok, false);
});
test("human review input: separate from model output, validated, default stays pending", () => {
  assert.equal(validateReviewInput({ id: "4", status: "approved", reviewer: "Reviewer", comment: null }).ok, true);
  assert.equal(validateReviewInput({ id: "4", status: "pending", reviewer: "Reviewer", comment: null }).ok, false); // 'pending' is the default, never set by a reviewer
  assert.equal(validateReviewInput({ id: "4", status: "approved", reviewer: " ", comment: null }).ok, false);
  assert.equal(validateReviewInput({ id: "4", status: "changes_requested", reviewer: "K", comment: "" }).ok, false);
  assert.equal(validateReviewInput({ id: "0", status: "approved", reviewer: "K", comment: null }).ok, false);
});
