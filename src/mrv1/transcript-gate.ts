// Gate 2: transcript eligibility. Several independent indicators, each with a machine-readable code; no single number decides.
// These are INDICATORS: none proves the words are right. Language detection is never treated as proof of correctness, and silence alone never rejects a call.
import { analyzeSegments } from "../transcript-quality.ts";

export type TranscriptDecision = "eligible" | "incomplete_transcript" | "suspected_language_mismatch" | "insufficient_speech" | "corrupted_transcript" | "requires_human_review";
export interface GateReason {
  code: string;
  /** block: the decision cannot be eligible. review: a human must look. note: informational, does not change the decision. */
  severity: "block" | "review" | "note";
  detail: string;
}
export interface RawSegment {
  start: number;
  end: number;
  text: string;
}
export interface TranscriptGateResult {
  decision: TranscriptDecision;
  reasons: GateReason[];
  metrics: Record<string, number | string | null>;
}

export const GATE = {
  minSegments: 5,
  minWords: 60,
  minLastEndRatio: 0.8,
  endToleranceS: 5,
  maxBrokenSegmentRatio: 0.05,
  maxRepeatRatio: 0.2,
  reviewRepeatRatio: 0.05,
  maxEmptyRatio: 0.5,
  minLexicalDiversity: 0.15,
  reviewGapS: 60,
  blockGapRatio: 0.25,
  minSpeechPct: 30,
  hindiMarkerRatio: 0.08,
};

/** Romanised-Hindi function words that rarely occur in English. */
const HINDI_MARKERS = new Set(["hai", "hain", "nahi", "nahin", "kya", "aap", "mera", "meri", "hum", "karna", "karte", "kuch", "bahut", "abhi", "lekin", "toh", "wala", "wali", "accha", "achha", "theek", "kaise", "kyun", "kyunki", "mujhe", "aapko", "humein", "karenge", "chahiye", "matlab", "bilkul", "paisa", "sir"]);
const wordsOf = (t: string) => t.toLowerCase().match(/[a-zऀ-ॿ]+/g) ?? [];

/** `language` is the transcriber's label ("en", "hi", ...) and is treated as a hint only. */
export function assessTranscript(raw: RawSegment[], audioSeconds: number, language: string | null): TranscriptGateResult {
  const reasons: GateReason[] = [];
  const add = (code: string, severity: GateReason["severity"], detail: string) => reasons.push({ code, severity, detail });
  const total = raw.length;
  const segs = raw.filter((s) => typeof s.text === "string" && s.text.trim() !== "");
  const empty = total - segs.length;
  const metrics: TranscriptGateResult["metrics"] = { audio_s: Math.round(audioSeconds), segments: segs.length, empty_segments: empty, language_label: language };

  // --- corrupted ---
  const badRange = raw.filter((s) => !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end < s.start).length;
  if (badRange > 0) add("invalid_timestamps", "block", `${badRange} segment(s) have missing, negative or reversed timestamps`);
  const outside = raw.filter((s) => Number.isFinite(s.end) && (s.end > audioSeconds + GATE.endToleranceS || s.start >= audioSeconds)).length;
  if (outside > 0) add("timestamps_outside_recording", "block", `${outside} segment(s) lie beyond the ${Math.round(audioSeconds)} s recording`);
  const clean = segs.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start);
  const q = analyzeSegments(clean, audioSeconds);
  metrics.words = q.words;
  metrics.coverage_pct = q.coverage_pct;
  metrics.speech_pct = q.speech_pct;
  metrics.largest_gap_s = q.largest_gaps[0]?.length_s ?? 0;
  if (clean.length > 0 && q.out_of_order >= 3 && q.out_of_order / clean.length > 0.02) add("out_of_order_segments", "block", `${q.out_of_order} segments start before the previous one`);
  const broken = clean.filter((s) => s.text.includes("�")).length;
  metrics.broken_segments = broken;
  if (clean.length > 0 && broken / clean.length > GATE.maxBrokenSegmentRatio) add("broken_encoding", "block", `${broken} of ${clean.length} segments contain replacement characters`);
  else if (broken > 0) add("broken_encoding_minor", "note", `${broken} segment(s) contain replacement characters; affected criteria may be NE`);
  const repRatio = clean.length ? q.repeated_segments / clean.length : 0;
  metrics.repeated_ratio = Math.round(repRatio * 1000) / 1000;
  if (q.repeated_segments >= 3 && repRatio > GATE.maxRepeatRatio) add("repetition_loop", "block", `${q.repeated_segments} consecutive repeated segments (${Math.round(repRatio * 100)}%): typical of a transcription loop`);
  else if (q.repeated_segments >= 3 && repRatio > GATE.reviewRepeatRatio) add("repetition_notable", "review", `${q.repeated_segments} consecutive repeated segments`);

  // --- insufficient speech ---
  if (segs.length < GATE.minSegments) add("too_few_segments", "block", `only ${segs.length} non-empty segment(s)`);
  if (total > 0 && empty / total > GATE.maxEmptyRatio) add("empty_segments_dominate", "block", `${empty} of ${total} segments are empty`);
  const words = wordsOf(segs.map((s) => s.text).join(" "));
  const diversity = words.length ? new Set(words).size / words.length : 0;
  metrics.lexical_diversity = Math.round(diversity * 1000) / 1000;
  if (segs.length >= GATE.minSegments && words.length < GATE.minWords) add("too_little_text", "block", `${words.length} words in ${Math.round(audioSeconds)} s of recording`);
  else if (words.length >= 20 && diversity < GATE.minLexicalDiversity) add("repetitive_content", "block", `only ${Math.round(diversity * 100)}% of words are distinct: filler or repetition, not conversation`);

  // --- incomplete ---
  const last = clean.length ? Math.max(...clean.map((s) => s.end)) : 0;
  if (clean.length > 0 && last < GATE.minLastEndRatio * audioSeconds) add("ends_early", "block", `the transcript ends at ${Math.round(last)} s of ${Math.round(audioSeconds)} s`);
  const gap = q.largest_gaps[0]?.length_s ?? 0;
  if (audioSeconds > 0 && gap >= GATE.blockGapRatio * audioSeconds) add("large_untranscribed_portion", "block", `a ${Math.round(gap)} s stretch (${Math.round((gap / audioSeconds) * 100)}% of the recording) has no transcript: silence cannot be told apart from missing speech`);
  else if (gap >= GATE.reviewGapS) add("long_gap_possible_silence", "review", `a ${Math.round(gap)} s stretch has no transcript (silence is acceptable, missing speech is not)`);
  if (clean.length > 0 && q.speech_pct < GATE.minSpeechPct && !reasons.some((r) => r.code === "large_untranscribed_portion" || r.code === "ends_early")) add("low_speech_coverage", "review", `transcribed speech covers ${q.speech_pct}% of the recording`);

  // --- language: the label is never proof ---
  const dev = q.script.devanagari_pct;
  const lat = q.script.latin_pct;
  const latinWords = words.filter((w) => /^[a-z]+$/.test(w));
  const markerRatio = latinWords.length ? latinWords.filter((w) => HINDI_MARKERS.has(w)).length / latinWords.length : 0;
  metrics.devanagari_pct = dev;
  metrics.hindi_marker_ratio = Math.round(markerRatio * 1000) / 1000;
  const label = (language ?? "").toLowerCase();
  if (dev < 5 && markerRatio >= GATE.hindiMarkerRatio && label !== "hi") add("suspected_language_mismatch", "block", `Hindi speech appears to have been transcribed as "${language ?? "unknown"}" in Latin script (${Math.round(markerRatio * 100)}% romanised-Hindi words, ${dev}% Devanagari): readable English words do not prove a correct transcript`);
  else if (label === "hi" && dev < 5 && lat >= 95 && words.length >= GATE.minWords) add("label_script_disagree", "review", `labelled Hindi but ${lat}% of letters are Latin`);
  else if (label === "en" && dev >= 20) add("label_script_disagree", "review", `labelled English but ${dev}% of letters are Devanagari`);
  else if (dev < 5 && markerRatio >= GATE.hindiMarkerRatio / 2 && label === "hi") add("romanised_hindi_possible", "review", "romanised Hindi under a Hindi label: accuracy of names and numbers needs a human check");

  const has = (sev: GateReason["severity"]) => reasons.some((r) => r.severity === sev);
  const blockCodes = reasons.filter((r) => r.severity === "block").map((r) => r.code);
  let decision: TranscriptDecision = "eligible";
  if (has("block")) {
    if (blockCodes.some((c) => ["invalid_timestamps", "timestamps_outside_recording", "out_of_order_segments", "broken_encoding", "repetition_loop"].includes(c))) decision = "corrupted_transcript";
    else if (blockCodes.some((c) => ["ends_early", "large_untranscribed_portion"].includes(c))) decision = "incomplete_transcript";
    else if (blockCodes.includes("suspected_language_mismatch")) decision = "suspected_language_mismatch";
    else decision = "insufficient_speech";
  } else if (has("review")) decision = "requires_human_review";
  return { decision, reasons, metrics };
}
