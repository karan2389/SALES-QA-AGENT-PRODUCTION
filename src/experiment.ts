import type { Env } from "./env";
import { WHISPER_MODEL } from "./transcribe";

export interface ExperimentParams {
  label: string;
  /** Extra Whisper options, e.g. { vad_filter: true } or { language: "hi" }. */
  options: Record<string, unknown>;
  /** Optional byte range of the R2 object (used to transcribe an isolated slice). */
  range?: { offset: number; length: number };
  /** Optional caller-supplied audio (e.g. a decoded WAV chunk). When set, R2 is not read. */
  audio?: Uint8Array;
  /** Metadata stored in audio_range_json when `audio` is supplied (chunk start/end/overlap; never audio). */
  meta?: unknown;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Quality experiment: same model, different options. Stored in transcription_experiments only. */
export async function runExperiment(env: Env, callyzerCallId: string, p: ExperimentParams) {
  const call = await env.DB.prepare("SELECT id, r2_object_key, duration_seconds FROM calls WHERE callyzer_call_id = ?")
    .bind(callyzerCallId).first<{ id: number; r2_object_key: string; duration_seconds: number }>();
  if (!call) return { ok: false, error: "call not found" };
  let audio: Uint8Array;
  if (p.audio) audio = p.audio;
  else {
    const obj = await env.RECORDINGS.get(call.r2_object_key, p.range ? { range: p.range } : undefined);
    if (!obj) return { ok: false, error: "R2 object not found" };
    audio = new Uint8Array(await obj.arrayBuffer());
  }
  if (audio.length === 0) return { ok: false, error: "empty audio" };

  let out: Record<string, any> | null = null;
  let error: string | null = null;
  try {
    out = (await env.AI.run(WHISPER_MODEL, { audio: toBase64(audio), ...p.options })) as Record<string, any>;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 300) : "unknown";
  }
  const text = typeof out?.text === "string" ? out.text.trim() : "";
  const status = text ? "completed" : "failed";
  const { text: _t, vtt: _v, ...rest } = out ?? {};
  await env.DB.prepare(
    `INSERT INTO transcription_experiments (call_id, transcription_model, label, options_json, audio_range_json, language, transcript_text, transcription_status, segments_json, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(call_id, label) DO UPDATE SET options_json=excluded.options_json, audio_range_json=excluded.audio_range_json, language=excluded.language,
       transcript_text=excluded.transcript_text, transcription_status=excluded.transcription_status, segments_json=excluded.segments_json,
       error=excluded.error, created_at=datetime('now')`,
  ).bind(call.id, WHISPER_MODEL, p.label, JSON.stringify(p.options),
    p.audio ? (p.meta !== undefined ? JSON.stringify(p.meta) : null) : p.range ? JSON.stringify(p.range) : null,
    out?.transcription_info?.language ?? null, text || null, status, out ? JSON.stringify(rest) : null, error).run();

  const segs: Array<{ start: number; end: number }> = out?.segments ?? [];
  return {
    ok: status === "completed", label: p.label, status, error,
    language: out?.transcription_info?.language ?? null,
    language_probability: out?.transcription_info?.language_probability ?? null,
    whisper_duration_s: out?.transcription_info?.duration ?? null,
    duration_after_vad_s: out?.transcription_info?.duration_after_vad ?? null,
    segments: segs.length, last_segment_end_s: segs.length ? segs[segs.length - 1].end : null,
    word_count: out?.word_count ?? null, text_chars: text.length,
  };
}
