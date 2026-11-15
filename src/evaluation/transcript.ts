import type { Segment, TranscriptQuality } from "./types.ts";

/** Parse the Whisper output stored in D1 (segments_json) into numbered segments. Empty segments are dropped. */
export function segmentsFromJson(segmentsJson: string | null): { segments: Segment[]; language: string | null } {
  if (!segmentsJson) return { segments: [], language: null };
  let j: any;
  try {
    j = JSON.parse(segmentsJson);
  } catch {
    return { segments: [], language: null };
  }
  const raw: any[] = Array.isArray(j?.segments) ? j.segments : [];
  const segments: Segment[] = [];
  for (const s of raw) {
    if (typeof s?.text !== "string" || typeof s?.start !== "number" || typeof s?.end !== "number") continue;
    const text = s.text.trim();
    if (!text) continue;
    segments.push({ index: segments.length, start: s.start, end: s.end, text });
  }
  const language = typeof j?.transcription_info?.language === "string" ? j.transcription_info.language : null;
  return { segments, language };
}

/** mm:ss.s with rounding that cannot produce "60.0" seconds. */
export function fmtTime(s: number): string {
  const t = Math.max(0, Math.round(s * 10));
  const mm = Math.floor(t / 600);
  const ss = (t % 600) / 10;
  return `${String(mm).padStart(2, "0")}:${ss.toFixed(1).padStart(4, "0")}`;
}

/** The transcript as shown to the model: numbered, timestamped segments. */
export function formatTranscriptForPrompt(segments: Segment[]): string {
  return segments.map((s) => `#${s.index} [${fmtTime(s.start)}-${fmtTime(s.end)}] ${s.text}`).join("\n");
}

/** Deterministic transcript-quality indicators (hints, not accuracy). */
export function computeQuality(segments: Segment[], durationSeconds: number, language: string | null): TranscriptQuality {
  const gaps: Array<{ start_s: number; end_s: number }> = [];
  let covered = 0;
  let prevEnd = 0;
  for (const s of segments) {
    covered += Math.max(0, s.end - s.start);
    if (s.start - prevEnd > 5) gaps.push({ start_s: round1(prevEnd), end_s: round1(s.start) });
    prevEnd = Math.max(prevEnd, s.end);
  }
  if (segments.length > 0 && durationSeconds - prevEnd > 5) gaps.push({ start_s: round1(prevEnd), end_s: round1(durationSeconds) });
  const broken = segments.filter((s) => s.text.includes("�")).map((s) => s.index);
  const coverage = durationSeconds > 0 ? Math.min(100, (100 * covered) / durationSeconds) : 0;
  const notes: string[] = [
    "Coverage is the share of the recording covered by transcript segments; it is not accuracy.",
    "The transcript has no speaker labels; speakers must be inferred from context.",
  ];
  if (gaps.length > 0) notes.push(`${gaps.length} gap(s) longer than 5 s: speech may be missing there.`);
  if (broken.length > 0) notes.push(`${broken.length} segment(s) end in a broken character (possible cut-off words).`);
  if (language) notes.push(`Transcript language label: "${language}" (a setting or detector output, not a measure of correctness).`);
  return {
    language,
    duration_s: round1(durationSeconds),
    segment_count: segments.length,
    coverage_pct: round1(coverage),
    last_segment_end_s: segments.length ? round1(segments[segments.length - 1].end) : null,
    gaps_over_5s: gaps,
    broken_char_segments: broken,
    notes,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Normalise for quote matching: Unicode NFC, lower-case, keep only letters, digits and combining marks. */
export function normalizeForMatch(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
}

/** True if the quote appears (after normalisation) in the cited segments plus `slack` neighbours either side. */
export function quoteInSegments(quote: string, segments: Segment[], from: number, to: number, slack = 1): boolean {
  // A quote may mark omitted stretches with "..." or an ellipsis; every part must then appear in the cited segments.
  const parts = quote.split(/\.{3,}|…/).map(normalizeForMatch).filter((p) => p.length > 0);
  if (parts.length === 0 || parts.some((p) => p.length < 4)) return false;
  const lo = Math.max(0, from - slack);
  const hi = Math.min(segments.length - 1, to + slack);
  const hay = normalizeForMatch(segments.slice(lo, hi + 1).map((s) => s.text).join(" "));
  return parts.every((p) => hay.includes(p));
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
