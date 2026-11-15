export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

/** The only parts of the Worker bindings this module needs (structurally satisfied by `Env`; keeps the module testable offline). */
export interface TranscribeEnv {
  AI: { run(model: string, input: any): Promise<any> };
  DB: {
    prepare(sql: string): { bind(...values: any[]): { first<T = any>(): Promise<T | null>; run(): Promise<unknown> } };
    batch(statements: any[]): Promise<unknown>;
  };
  RECORDINGS: { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> };
}

interface WhisperOutput {
  text?: string;
  word_count?: number;
  vtt?: string;
  transcription_info?: { language?: string; language_probability?: number; duration?: number; duration_after_vad?: number };
  segments?: Array<{ start: number; end: number; text: string; words?: unknown[] }>;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Transcribe one stored call (by Callyzer call id) and save the result in D1. Returns a transcript-free summary.
 * Idempotent: a call that already has a completed transcript for this model is skipped (never overwritten, no Whisper request).
 * A failed or missing transcript is (re)attempted. One call's failure never touches another call's rows.
 */
export async function transcribeCall(env: TranscribeEnv, callyzerCallId: string) {
  const call = await env.DB.prepare(
    "SELECT id, r2_object_key, duration_seconds, audio_size_bytes FROM calls WHERE callyzer_call_id = ?",
  ).bind(callyzerCallId).first<{ id: number; r2_object_key: string; duration_seconds: number; audio_size_bytes: number }>();
  if (!call) return { ok: false, error: "call not found" };

  const existing = await env.DB.prepare(
    "SELECT id, language, length(transcript_text) AS text_chars FROM transcripts WHERE call_id = ? AND transcription_model = ? AND transcription_status = 'completed'",
  ).bind(call.id, WHISPER_MODEL).first<{ id: number; language: string | null; text_chars: number }>();
  if (existing) return { ok: true, skipped: true, status: "already_transcribed", transcript_id: existing.id, language: existing.language, text_chars: existing.text_chars };

  const obj = await env.RECORDINGS.get(call.r2_object_key);
  if (!obj) return { ok: false, error: "R2 object not found" };
  const audio = new Uint8Array(await obj.arrayBuffer());
  if (audio.length === 0 || audio.length !== call.audio_size_bytes) return { ok: false, error: "R2 object size differs from recorded size" };

  await env.DB.prepare("UPDATE calls SET processing_status='transcribing', updated_at=datetime('now') WHERE id=?").bind(call.id).run();

  let out: WhisperOutput;
  try {
    // Docs: input is { audio: <base64 string> }. Language is left unset (auto-detect not documented; checked in output).
    out = (await env.AI.run(WHISPER_MODEL, { audio: toBase64(audio) })) as WhisperOutput;
  } catch (e) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO transcripts (call_id, transcription_model, transcription_status) VALUES (?, ?, 'failed')
         ON CONFLICT(call_id, transcription_model) DO UPDATE SET transcription_status='failed'`,
      ).bind(call.id, WHISPER_MODEL),
      env.DB.prepare("UPDATE calls SET processing_status='transcription_failed', updated_at=datetime('now') WHERE id=?").bind(call.id),
    ]);
    return { ok: false, error: `Whisper call failed: ${e instanceof Error ? e.message.slice(0, 300) : "unknown"}` };
  }

  const text = (out.text ?? "").trim();
  const language = out.transcription_info?.language ?? null;
  const segmentsJson = JSON.stringify({
    transcription_info: out.transcription_info ?? null,
    word_count: out.word_count ?? null,
    segments: out.segments ?? null,
  });
  const status = text.length > 0 ? "completed" : "failed";

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO transcripts (call_id, transcription_model, language, transcript_text, transcription_status, segments_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(call_id, transcription_model) DO UPDATE SET language=excluded.language, transcript_text=excluded.transcript_text,
         transcription_status=excluded.transcription_status, segments_json=excluded.segments_json, created_at=datetime('now')`,
    ).bind(call.id, WHISPER_MODEL, language, text || null, status, segmentsJson),
    env.DB.prepare("UPDATE calls SET processing_status=?, updated_at=datetime('now') WHERE id=?").bind(
      status === "completed" ? "transcribed" : "transcription_failed", call.id),
  ]);

  const segs = out.segments ?? [];
  const lastEnd = segs.length ? segs[segs.length - 1].end : null;
  return {
    ok: status === "completed",
    status,
    language,
    language_probability: out.transcription_info?.language_probability ?? null,
    expected_duration_s: call.duration_seconds,
    whisper_duration_s: out.transcription_info?.duration ?? null,
    last_segment_end_s: lastEnd,
    segments: segs.length,
    has_word_timestamps: segs.some((s) => Array.isArray(s.words) && s.words.length > 0),
    word_count: out.word_count ?? null,
    text_chars: text.length,
    segments_json_bytes: segmentsJson.length,
    response_keys: Object.keys(out),
  };
}
