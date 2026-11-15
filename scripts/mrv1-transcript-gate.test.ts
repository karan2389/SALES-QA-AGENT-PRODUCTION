// Transcript quality gate: 14 synthetic fixtures (no real recordings, no Whisper) plus engine integration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTranscript, GATE } from "../src/mrv1/transcript-gate.ts";
import type { RawSegment } from "../src/mrv1/transcript-gate.ts";
import { runMrv1Evaluation } from "../src/mrv1/engine.ts";
import { FakeStore, fakeModel } from "./mrv1-fixtures.ts";

const AUDIO = 600;
// Deterministic pseudo-words (consonant-vowel syllables that avoid the romanised-Hindi marker list).
const C = ["b", "d", "f", "g", "j", "l", "p", "s", "t", "v", "z"];
const V = ["a", "e", "i", "o", "u"];
const EN = Array.from({ length: 600 }, (_, i) => `${C[i % 11]}${V[Math.floor(i / 11) % 5]}${C[Math.floor(i / 55) % 11]}${V[Math.floor(i / 605) % 5]}`); // all distinct
const DEV_SYL = ["का", "की", "के", "मा", "पा", "सा", "ना", "ला", "रा", "बा", "ता", "दा", "गा"];
const DEV = Array.from({ length: 169 }, (_, i) => DEV_SYL[i % 13] + DEV_SYL[Math.floor(i / 13)]);
const sentence = (i: number, words: string[], n = 9) => Array.from({ length: n }, (_, j) => words[(i * n + j) % words.length]).join(" ");
/** `n` segments spread evenly over [from, to] seconds. */
function make(n: number, text: (i: number) => string, from = 0, to = 595): RawSegment[] {
  const step = (to - from) / n;
  return Array.from({ length: n }, (_, i) => ({ start: from + i * step, end: from + i * step + step * 0.9, text: text(i) }));
}
const english = (n = 60, from = 0, to = 595) => make(n, (i) => sentence(i, EN), from, to);
const codes = (r: ReturnType<typeof assessTranscript>) => r.reasons.map((x) => x.code);

test("1 complete English transcript is eligible", () => {
  const r = assessTranscript(english(), AUDIO, "en");
  assert.equal(r.decision, "eligible", JSON.stringify(r.reasons));
});
test("2 complete Hindi (Devanagari) transcript is eligible", () => {
  const r = assessTranscript(make(60, (i) => sentence(i, DEV)), AUDIO, "hi");
  assert.equal(r.decision, "eligible", JSON.stringify(r.reasons));
  assert.ok(Number(r.metrics.devanagari_pct) > 90);
});
test("3 Hinglish (Devanagari with English terms) is eligible", () => {
  const r = assessTranscript(make(60, (i) => `${sentence(i, DEV, 5)} ${sentence(i, EN, 4)}`), AUDIO, "hi");
  assert.equal(r.decision, "eligible", JSON.stringify(r.reasons));
});
test("4 transcript ending prematurely is incomplete", () => {
  const r = assessTranscript(english(30, 0, 290), AUDIO, "en");
  assert.equal(r.decision, "incomplete_transcript");
  assert.ok(codes(r).includes("ends_early"));
});
test("5 transcript with only a small opening section is incomplete", () => {
  const r = assessTranscript(english(12, 0, 60), AUDIO, "en");
  assert.equal(r.decision, "incomplete_transcript");
  assert.ok(codes(r).includes("ends_early"));
});
test("6 silence is not rejected: a short gap is eligible, a long one needs human review", () => {
  const short = [...english(30, 0, 280), ...english(30, 330, 595)]; // 50 s silence in the middle
  assert.equal(assessTranscript(short, AUDIO, "en").decision, "eligible");
  const long = [...english(30, 0, 250), ...english(30, 330, 595)]; // 80 s: 13% of the call
  const r = assessTranscript(long, AUDIO, "en");
  assert.equal(r.decision, "requires_human_review");
  assert.ok(codes(r).includes("long_gap_possible_silence"));
});
test("7 repeated segments (transcription loop) are corrupted", () => {
  const segs = [...english(30, 0, 290), ...make(30, () => "thank you for watching this call", 300, 595)];
  const r = assessTranscript(segs, AUDIO, "en");
  assert.equal(r.decision, "corrupted_transcript");
  assert.ok(codes(r).includes("repetition_loop"));
});
test("8 empty segments are ignored, but when they dominate there is insufficient speech", () => {
  const some = [...english(60), ...make(10, () => "   ", 0, 595)];
  assert.equal(assessTranscript(some, AUDIO, "en").decision, "eligible"); // empties are not counted as speech
  const mostly = [...english(30, 0, 595), ...make(40, () => "", 0, 595)];
  const r = assessTranscript(mostly, AUDIO, "en");
  assert.equal(r.decision, "insufficient_speech");
  assert.ok(codes(r).includes("empty_segments_dominate"));
});
test("9 broken encoding is corrupted; an isolated broken character is only a note", () => {
  const segs = english();
  for (let i = 0; i < 8; i++) segs[i * 7].text += " ba�";
  const r = assessTranscript(segs, AUDIO, "en");
  assert.equal(r.decision, "corrupted_transcript");
  assert.ok(codes(r).includes("broken_encoding"));
  const one = english();
  one[10].text += " ba�";
  const n = assessTranscript(one, AUDIO, "en");
  assert.equal(n.decision, "eligible");
  assert.ok(codes(n).includes("broken_encoding_minor"));
});
test("10 a timestamp gap of about a minute needs review", () => {
  const segs = [...english(30, 0, 270), ...english(30, 345, 595)];
  const r = assessTranscript(segs, AUDIO, "en");
  assert.equal(r.decision, "requires_human_review");
  assert.ok(codes(r).includes("long_gap_possible_silence"));
});
test("11 timestamps outside the recording are corrupted", () => {
  const segs = english();
  segs[59] = { start: 650, end: 700, text: sentence(99, EN) };
  const r = assessTranscript(segs, AUDIO, "en");
  assert.equal(r.decision, "corrupted_transcript");
  assert.ok(codes(r).includes("timestamps_outside_recording"));
  const bad = english();
  bad[3] = { start: 50, end: 40, text: "reversed" };
  assert.ok(codes(assessTranscript(bad, AUDIO, "en")).includes("invalid_timestamps"));
  const unordered = english();
  for (let i = 0; i < 6; i++) [unordered[i * 8], unordered[i * 8 + 1]] = [unordered[i * 8 + 1], unordered[i * 8]];
  assert.ok(codes(assessTranscript(unordered, AUDIO, "en")).includes("out_of_order_segments"));
});
test("12 plausible segment count but insufficient content", () => {
  const r = assessTranscript(make(60, (i) => (i % 2 ? "hmm" : "okay")), AUDIO, "en");
  assert.equal(r.decision, "insufficient_speech");
  assert.ok(codes(r).includes("repetitive_content") || codes(r).includes("too_little_text"));
  const tiny = assessTranscript(make(8, () => "yes"), AUDIO, "en");
  assert.notEqual(tiny.decision, "eligible");
  assert.equal(assessTranscript(english().slice(0, 3), AUDIO, "en").decision === "eligible", false);
});
test("13 a large untranscribed portion is incomplete (silence cannot be told from missing speech)", () => {
  const segs = [...english(25, 0, 200), ...english(25, 400, 595)]; // 200 s hole = 33% of the call
  const r = assessTranscript(segs, AUDIO, "en");
  assert.equal(r.decision, "incomplete_transcript");
  assert.ok(codes(r).includes("large_untranscribed_portion"));
});
test("14 valid multilingual content is eligible, and the language label is only a hint", () => {
  const mixed = make(60, (i) => (i % 3 === 0 ? sentence(i, EN, 6) : `${sentence(i, DEV, 4)} ${sentence(i, EN, 3)}`));
  assert.equal(assessTranscript(mixed, AUDIO, "hi").decision, "eligible");
  // a mismatching label on an otherwise valid transcript is a review item, not a rejection and not proof of an error
  const r = assessTranscript(mixed, AUDIO, "en");
  assert.equal(r.decision, "requires_human_review");
  assert.ok(codes(r).includes("label_script_disagree"));
});

test("Hindi transcribed as English (romanised, English business words) is a suspected language mismatch, never valid by readability", () => {
  const roman = ["aap kya karte hain mera business hai", "mujhe funnel banana hai lekin kuch nahi aata", "abhi webinar ke baad hum call kar rahe hain", "theek hai toh aap bataiye kya chahiye", "mera paisa bahut kam hai abhi", "accha matlab aap ads chalate ho"];
  const segs = make(60, (i) => `${roman[i % 6]} ${sentence(i, EN, 4)}`);
  const r = assessTranscript(segs, AUDIO, "en");
  assert.equal(r.decision, "suspected_language_mismatch");
  assert.ok(codes(r).includes("suspected_language_mismatch"));
  // under a Hindi label romanised output still needs a human check
  const h = assessTranscript(segs, AUDIO, "hi");
  assert.notEqual(h.decision, "eligible");
  // ordinary English never trips the detector
  assert.equal(assessTranscript(english(), AUDIO, "en").decision, "eligible");
});

test("every non-eligible result carries machine-readable reasons", () => {
  for (const segs of [english(30, 0, 290), english(12, 0, 60), make(60, (i) => (i % 2 ? "hmm" : "okay"))]) {
    const r = assessTranscript(segs, AUDIO, "en");
    assert.notEqual(r.decision, "eligible");
    assert.ok(r.reasons.length > 0 && r.reasons.every((x) => /^[a-z_]+$/.test(x.code) && x.detail.length > 0));
  }
  assert.ok(GATE.minLastEndRatio === 0.8);
});

test("indicators are combined: a long transcript with a premature end is still held even though segment count and broken characters pass", () => {
  const r = assessTranscript(english(120, 0, 340), AUDIO, "en");
  assert.equal(r.decision, "incomplete_transcript");
  assert.ok(Number(r.metrics.segments) >= 5 && Number(r.metrics.broken_segments) === 0);
});

// ---------- engine integration ----------
const toSegs = (raw: RawSegment[]) => raw.map((s, i) => ({ index: i, start: s.start, end: s.end, text: s.text }));
const store = (raw: RawSegment[], language: string) => new FakeStore({ transcript: { source: "production", language, segments: toSegs(raw) } });

test("engine: a blocked transcript holds with decision and reason codes before any model call", async () => {
  const model = fakeModel();
  const r: any = await runMrv1Evaluation({ store: store(english(30, 0, 290), "en"), model }, { callyzerCallId: "CY-7" });
  assert.equal(r.status, "hold");
  assert.equal(r.gate, 2);
  assert.equal(r.decision, "incomplete_transcript");
  assert.ok(r.reason_codes.includes("ends_early"));
  assert.equal(model.calls.length, 0);
});

test("engine: 'requires human review' proceeds only after explicit acknowledgement; blocking decisions never do", async () => {
  const review = [...english(30, 0, 250), ...english(30, 330, 595)];
  const m1 = fakeModel();
  const held: any = await runMrv1Evaluation({ store: store(review, "en"), model: m1 }, { callyzerCallId: "CY-7" });
  assert.equal(held.status, "hold");
  assert.equal(held.decision, "requires_human_review");
  assert.equal(m1.calls.length, 0);
  const ok: any = await runMrv1Evaluation({ store: store(review, "en"), model: fakeModel() }, { callyzerCallId: "CY-7", acknowledgeTranscriptReview: true });
  assert.equal(ok.status, "completed");
  assert.ok(ok.document.validation.warnings.some((w: string) => /human review acknowledged/.test(w)));
  const blocked: any = await runMrv1Evaluation({ store: store(english(30, 0, 290), "en"), model: fakeModel() }, { callyzerCallId: "CY-7", acknowledgeTranscriptReview: true });
  assert.equal(blocked.status, "hold");
});
