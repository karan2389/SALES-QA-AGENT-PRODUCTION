import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSegments, recordingCompleteness } from "../src/transcript-quality.ts";

const seg = (start: number, end: number, text: string) => ({ start, end, text });

test("a complete transcript has high coverage and no flags", () => {
  const r = analyzeSegments([seg(1, 10, "namaste ji"), seg(10, 20, "kaise hain aap"), seg(20, 59, "theek hoon")], 60);
  assert.equal(r.coverage_pct, 98.3);
  assert.deepEqual(r.flags, []);
  assert.equal(r.segments, 3);
  assert.equal(r.words, 7);
});

test("transcript that stops early is flagged (the recording-vs-transcript check)", () => {
  const r = analyzeSegments([seg(0, 30, "a b c"), seg(30, 332, "d e f")], 1700);
  assert.ok(r.coverage_pct < 25);
  assert.ok(r.flags.some((f) => f.includes("ends at")));
  assert.ok(r.flags.some((f) => f.includes("after the last segment")));
});

test("coverage is relative to the audio held, so a short recording is not mistaken for a failed transcription", () => {
  const r = analyzeSegments([seg(0, 100, "x y z"), seg(100, 333, "x y z")], 334);
  assert.ok(r.coverage_pct > 99);
  const c = recordingCompleteness(334, 1700);
  assert.equal(c.complete, false);
  assert.equal(c.ratio_pct, 19.6);
  assert.equal(recordingCompleteness(1000.7, 1003).complete, true);
});

test("largest gaps, repeats, broken characters and ordering are reported", () => {
  const r = analyzeSegments([seg(0, 5, "okay so"), seg(5, 8, "Okay, so."), seg(8, 11, "okay so"), seg(11, 14, "okay so"), seg(50, 52, "bad � word"), seg(40, 41, "late")], 60);
  assert.equal(r.largest_gaps[0].length_s, 36);
  assert.equal(r.repeated_segments, 3);
  assert.equal(r.broken_chars, 1);
  assert.equal(r.out_of_order, 1);
  assert.ok(r.flags.some((f) => f.includes("gap of 30s")));
  assert.ok(r.flags.some((f) => f.includes("repeated")));
});

test("script share distinguishes Devanagari from romanised output", () => {
  assert.ok(analyzeSegments([seg(0, 5, "हलो हलो आप कैसे हैं")], 5).script.devanagari_pct > 99);
  assert.ok(analyzeSegments([seg(0, 5, "hello how are you")], 5).script.latin_pct > 99);
});

test("empty transcript is handled", () => {
  const r = analyzeSegments([], 100);
  assert.equal(r.coverage_pct, 0);
  assert.equal(r.closing_gap_s, 100);
});
