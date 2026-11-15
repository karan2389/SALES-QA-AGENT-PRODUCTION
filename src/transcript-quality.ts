// Pure transcript completeness checks (no Cloudflare types). Coverage is an INDICATOR only: it says where speech was
// recognised, not that the words are right. Used by scripts/validate-transcripts.ts and the tests.

export interface Seg {
  start: number;
  end: number;
  text: string;
}
export interface Gap {
  from_s: number;
  to_s: number;
  length_s: number;
}
export interface QualityReport {
  audio_s: number;
  segments: number;
  words: number;
  first_start_s: number | null;
  last_end_s: number | null;
  coverage_pct: number; // last segment end / audio duration
  speech_pct: number; // time inside segments / audio duration
  opening_gap_s: number;
  closing_gap_s: number;
  largest_gaps: Gap[];
  repeated_segments: number; // consecutive segments with identical text
  broken_chars: number; // U+FFFD replacement characters
  out_of_order: number; // segments that start before the previous one started
  script: { devanagari_pct: number; latin_pct: number };
  flags: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[\s.,!?।'"-]+/g, " ").trim();
export const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** `audioSeconds` should be the duration of the audio actually held (decoded or reported by Whisper), not the call-log duration. */
export function analyzeSegments(segs: Seg[], audioSeconds: number, opts: { gapThresholdS?: number; topGaps?: number } = {}): QualityReport {
  const gapMin = opts.gapThresholdS ?? 8;
  const gaps: Gap[] = [];
  let repeated = 0;
  let outOfOrder = 0;
  let speech = 0;
  for (let i = 0; i < segs.length; i++) {
    speech += Math.max(0, segs[i].end - segs[i].start);
    if (i === 0) continue;
    const g = segs[i].start - segs[i - 1].end;
    if (g >= gapMin) gaps.push({ from_s: round(segs[i - 1].end), to_s: round(segs[i].start), length_s: round(g) });
    if (norm(segs[i].text) && norm(segs[i].text) === norm(segs[i - 1].text)) repeated++;
    if (segs[i].start < segs[i - 1].start) outOfOrder++;
  }
  gaps.sort((a, b) => b.length_s - a.length_s);
  const text = segs.map((s) => s.text).join(" ");
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  const dev = letters.filter((c) => /[ऀ-ॿ]/.test(c)).length;
  const lat = letters.filter((c) => /[A-Za-z]/.test(c)).length;
  const last = segs.length ? segs[segs.length - 1].end : null;
  const first = segs.length ? segs[0].start : null;
  const report: QualityReport = {
    audio_s: round(audioSeconds),
    segments: segs.length,
    words: countWords(text),
    first_start_s: first === null ? null : round(first),
    last_end_s: last === null ? null : round(last),
    coverage_pct: last === null || audioSeconds <= 0 ? 0 : round((last / audioSeconds) * 100),
    speech_pct: audioSeconds <= 0 ? 0 : round((speech / audioSeconds) * 100),
    opening_gap_s: first === null ? round(audioSeconds) : round(first),
    closing_gap_s: last === null ? round(audioSeconds) : round(Math.max(0, audioSeconds - last)),
    largest_gaps: gaps.slice(0, opts.topGaps ?? 3),
    repeated_segments: repeated,
    broken_chars: (text.match(/�/g) ?? []).length,
    out_of_order: outOfOrder,
    script: { devanagari_pct: letters.length ? round((dev / letters.length) * 100) : 0, latin_pct: letters.length ? round((lat / letters.length) * 100) : 0 },
    flags: [],
  };
  if (report.coverage_pct < 95) report.flags.push(`transcript ends at ${report.coverage_pct}% of the audio`);
  if (report.opening_gap_s > 20) report.flags.push(`first speech only at ${report.opening_gap_s}s`);
  if (report.closing_gap_s > 20) report.flags.push(`${report.closing_gap_s}s of audio after the last segment`);
  if (gaps.some((g) => g.length_s >= 30)) report.flags.push("gap of 30s or more inside the transcript");
  if (report.repeated_segments >= 3) report.flags.push(`${report.repeated_segments} consecutive repeated segments`);
  if (report.broken_chars > 0) report.flags.push(`${report.broken_chars} broken (replacement) characters`);
  if (report.out_of_order > 0) report.flags.push(`${report.out_of_order} out-of-order segments`);
  return report;
}

/** The recording held in storage vs the duration Callyzer logged for the call. */
export function recordingCompleteness(audioSeconds: number, callLogSeconds: number): { ratio_pct: number; complete: boolean } {
  const ratio = callLogSeconds > 0 ? (audioSeconds / callLogSeconds) * 100 : 100;
  return { ratio_pct: round(ratio), complete: ratio >= 90 };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
