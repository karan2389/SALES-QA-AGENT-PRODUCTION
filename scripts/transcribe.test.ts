// Offline tests of the real transcribeCall() against fake D1 / R2 / Workers AI bindings. Run: npm run test:transcribe
import assert from "node:assert/strict";
import { test } from "node:test";
import { transcribeCall, WHISPER_MODEL } from "../src/transcribe.ts";
import type { TranscribeEnv } from "../src/transcribe.ts";

interface CallRow { id: number; callyzer_call_id: string; r2_object_key: string; duration_seconds: number; audio_size_bytes: number; processing_status: string }
interface TranscriptRow { call_id: number; model: string; language: string | null; text: string | null; status: string; segments_json: string | null }

function makeEnv(opts: { aiFor?: (audioB64: string) => any; missingR2?: string[] } = {}) {
  const calls: CallRow[] = [1, 2, 3].map((i) => ({ id: i, callyzer_call_id: `cid${i}`, r2_object_key: `rec/${i}.mp3`, duration_seconds: 600, audio_size_bytes: 4 + i, processing_status: "audio_stored" }));
  const transcripts: TranscriptRow[] = [];
  const log = { whisperCalls: [] as string[], r2Gets: [] as string[] };
  const run = (sql: string, a: any[]) => {
    if (/^UPDATE calls SET processing_status='transcribing'/.test(sql)) calls.find((c) => c.id === a[0])!.processing_status = "transcribing";
    else if (/^UPDATE calls SET processing_status='transcription_failed'/.test(sql)) calls.find((c) => c.id === a[0])!.processing_status = "transcription_failed";
    else if (/^UPDATE calls SET processing_status=\?/.test(sql)) calls.find((c) => c.id === a[1])!.processing_status = a[0];
    else if (/INSERT INTO transcripts[\s\S]*'failed'/.test(sql)) {
      const t = transcripts.find((x) => x.call_id === a[0] && x.model === a[1]);
      if (t) t.status = "failed";
      else transcripts.push({ call_id: a[0], model: a[1], language: null, text: null, status: "failed", segments_json: null });
    } else if (/INSERT INTO transcripts/.test(sql)) {
      const row = { call_id: a[0], model: a[1], language: a[2], text: a[3], status: a[4], segments_json: a[5] };
      const i = transcripts.findIndex((x) => x.call_id === a[0] && x.model === a[1]);
      if (i >= 0) transcripts[i] = row; else transcripts.push(row);
    } else throw new Error("unexpected SQL in fake: " + sql.slice(0, 60));
  };
  const first = (sql: string, a: any[]) => {
    if (/FROM calls WHERE callyzer_call_id/.test(sql)) return calls.find((c) => c.callyzer_call_id === a[0]) ?? null;
    if (/FROM transcripts WHERE call_id = \? AND transcription_model = \? AND transcription_status = 'completed'/.test(sql)) {
      const t = transcripts.find((x) => x.call_id === a[0] && x.model === a[1] && x.status === "completed");
      return t ? { id: 1, language: t.language, text_chars: (t.text ?? "").length } : null;
    }
    throw new Error("unexpected SELECT in fake: " + sql.slice(0, 60));
  };
  const stmt = (sql: string) => ({ bind: (...a: any[]) => ({ sql, a, first: async () => first(sql, a) as any, run: async () => run(sql, a) }) });
  const env: TranscribeEnv = {
    AI: {
      async run(model: string, input: any) {
        assert.equal(model, WHISPER_MODEL);
        log.whisperCalls.push(input.audio);
        return (opts.aiFor ?? (() => ({ text: "hello world", word_count: 2, transcription_info: { language: "en", language_probability: 0.9, duration: 600 }, segments: [{ start: 0, end: 4.5, text: "hello", words: [{ word: "hello", start: 0, end: 1 }] }, { start: 4.5, end: 9, text: "world" }] })))(input.audio);
      },
    },
    DB: { prepare: (sql: string) => stmt(sql), batch: async (stmts: any[]) => { for (const s of stmts) run(s.sql, s.a); } },
    RECORDINGS: {
      async get(key: string) {
        log.r2Gets.push(key);
        if (opts.missingR2?.includes(key)) return null;
        const n = Number(key.match(/(\d)\.mp3/)![1]) + 4; // matches audio_size_bytes above
        return { arrayBuffer: async () => new Uint8Array(n).fill(7).buffer };
      },
    },
  };
  return { env, calls, transcripts, log };
}

test("a stored recording is fetched from R2, transcribed, and saved with text, language and timestamped segments", async () => {
  const { env, calls, transcripts, log } = makeEnv();
  const r: any = await transcribeCall(env, "cid1");
  assert.equal(r.ok, true);
  assert.equal(r.segments, 2);
  assert.equal(r.word_count, 2);
  assert.equal(r.has_word_timestamps, true);
  assert.deepEqual(log.r2Gets, ["rec/1.mp3"]);
  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0].status, "completed");
  assert.equal(transcripts[0].text, "hello world");
  const j = JSON.parse(transcripts[0].segments_json!);
  assert.equal(j.segments.length, 2);
  assert.deepEqual([j.segments[1].start, j.segments[1].end], [4.5, 9]);
  assert.equal(calls[0].processing_status, "transcribed");
  assert.equal(calls[1].processing_status, "audio_stored", "other calls are untouched");
});

test("a second run is skipped: no R2 read, no Whisper request, the stored transcript is not overwritten", async () => {
  const { env, transcripts, log } = makeEnv();
  await transcribeCall(env, "cid1");
  const before = JSON.stringify(transcripts);
  const again: any = await transcribeCall(env, "cid1");
  assert.equal(again.ok, true);
  assert.equal(again.skipped, true);
  assert.equal(again.status, "already_transcribed");
  assert.equal(log.whisperCalls.length, 1);
  assert.equal(log.r2Gets.length, 1);
  assert.equal(JSON.stringify(transcripts), before);
});

test("a Whisper failure marks only that call failed; other calls are not affected; a later retry succeeds", async () => {
  let failFirst = true;
  const { env, calls, transcripts } = makeEnv({ aiFor: () => { if (failFirst) { failFirst = false; throw new Error("Workers AI 5xx"); } return { text: "ok text", word_count: 2, transcription_info: { language: "hi" }, segments: [{ start: 0, end: 2, text: "ok text" }] }; } });
  const bad: any = await transcribeCall(env, "cid1");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Whisper call failed/);
  assert.equal(calls[0].processing_status, "transcription_failed");
  const good: any = await transcribeCall(env, "cid2");
  assert.equal(good.ok, true);
  assert.equal(calls[1].processing_status, "transcribed");
  assert.equal(transcripts.find((t) => t.call_id === 1)!.status, "failed", "the failed call keeps its failed row");
  const retry: any = await transcribeCall(env, "cid1");
  assert.equal(retry.ok, true, "a failed transcript is retried, only a completed one is skipped");
  assert.equal(calls[0].processing_status, "transcribed");
  assert.equal(transcripts.filter((t) => t.call_id === 1).length, 1);
});

test("an empty transcript is stored as failed, not as a valid transcript", async () => {
  const { env, calls, transcripts } = makeEnv({ aiFor: () => ({ text: "   ", segments: [] }) });
  const r: any = await transcribeCall(env, "cid3");
  assert.equal(r.ok, false);
  assert.equal(transcripts[0].status, "failed");
  assert.equal(calls[2].processing_status, "transcription_failed");
});

test("unknown call or missing recording: clear error, nothing written", async () => {
  const a = makeEnv({ missingR2: ["rec/2.mp3"] });
  assert.equal(((await transcribeCall(a.env, "nope")) as any).error, "call not found");
  assert.equal(((await transcribeCall(a.env, "cid2")) as any).error, "R2 object not found");
  assert.equal(a.transcripts.length, 0);
  assert.equal(a.calls[1].processing_status, "audio_stored");
  assert.equal(a.log.whisperCalls.length, 0);
});
