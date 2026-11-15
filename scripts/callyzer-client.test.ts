// Offline unit tests with a mocked fetch. Run: npm run test:callyzer  (uses node:test)
import assert from "node:assert/strict";
import { test } from "node:test";
import { CallyzerClient, CallyzerError, isProcessableCall, looksLikeMp3 } from "../src/callyzer/client.ts";

const row = (o: Record<string, unknown> = {}) => ({ id: "abc", duration: 10, call_recording_url: "https://x.example/a.mp3", modified_at: null, ...o });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function make(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const sleeps: number[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses.shift();
    if (!r) throw new Error("no more mock responses");
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  const client = new CallyzerClient({ apiKey: "secret-token", fetchFn, sleepFn: async (ms) => void sleeps.push(ms) });
  return { client, calls, sleeps };
}
const req = { call_from: 1, call_to: 2, call_method: "PhoneCall", call_mode: "Voice" } as const;

test("history: sends bearer, verified body, emp_numbers; parses envelope", async () => {
  const { client, calls } = make([json({ result: [row()], message: "Success", total_records: 1, page_no: 1, page_size: 50 })]);
  const p = await client.getCallHistoryPage({ ...req, emp_numbers: ["123"] });
  assert.equal(calls[0].url, "https://api1.callyzer.co/api/v2.3/call-log/history");
  assert.equal((calls[0].init!.headers as Record<string, string>).Authorization, "Bearer secret-token");
  const body = JSON.parse(calls[0].init!.body as string);
  assert.deepEqual(Object.keys(body).sort(), ["call_from", "call_method", "call_mode", "call_to", "emp_numbers", "page_no", "page_size"]);
  assert.equal(body.page_size, 50);
  assert.equal(p.records[0].modified_at, null);
  assert.equal(p.totalRecords, 1);
});

test("429 retries with backoff then succeeds", async () => {
  const { client, calls, sleeps } = make([json({}, 429), json({}, 429, { "retry-after": "3" }), json({ result: [], message: "Success" })]);
  await client.getCallHistoryPage(req);
  assert.equal(calls.length, 3);
  assert.ok(sleeps.includes(2000), "exponential backoff used when no retry-after");
  assert.ok(sleeps.includes(3000), "retry-after honoured");
});

test("429 forever -> rate_limit error after retries", async () => {
  const { client } = make(Array.from({ length: 5 }, () => json({}, 429)));
  await assert.rejects(client.getCallHistoryPage(req), (e: CallyzerError) => e.kind === "rate_limit");
});

test("401 -> auth error, no retry, no token in message", async () => {
  const { client, calls } = make([json({ message: "bad" }, 401)]);
  await assert.rejects(client.getCallHistoryPage(req), (e: CallyzerError) => e.kind === "auth" && !e.message.includes("secret-token"));
  assert.equal(calls.length, 1);
});

test("network failure retried, then reported without leaking details", async () => {
  const { client } = make(Array.from({ length: 5 }, () => new TypeError("fetch failed https://secret")));
  await assert.rejects(client.getCallHistoryPage(req), (e: CallyzerError) => e.kind === "network" && !e.message.includes("secret"));
});

test("malformed responses", async () => {
  await assert.rejects(make([json({ message: "x" })]).client.getCallHistoryPage(req), (e: CallyzerError) => e.kind === "malformed");
  await assert.rejects(make([json({ result: [{ nope: 1 }] })]).client.getCallHistoryPage(req), (e: CallyzerError) => e.kind === "malformed");
  await assert.rejects(make([new Response("<html>", { status: 200 })]).client.getCallHistoryPage(req), (e: CallyzerError) => e.kind === "malformed");
});

test("rate-limit interval enforced between requests", async () => {
  const { client, sleeps } = make([json({ result: [] }), json({ result: [] })]);
  await client.getCallHistoryPage(req);
  await client.getCallHistoryPage(req);
  assert.ok(sleeps.some((s) => s > 1500 && s <= 2100), "second request waited ~2.1s");
});

test("get: dedupes and chunks at 20 ids", async () => {
  const { client, calls } = make([json({ result: [] }), json({ result: [] })]);
  const ids = Array.from({ length: 25 }, (_, i) => `id${i}`);
  await client.getCallsByIds([...ids, "id0"]);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].init!.body as string).unique_ids.length, 20);
  assert.equal(JSON.parse(calls[1].init!.body as string).unique_ids.length, 5);
});

test("get: empty ids rejected", async () => {
  await assert.rejects(make([]).client.getCallsByIds([]), (e: CallyzerError) => e.kind === "config");
});

test("processable filter", () => {
  assert.equal(isProcessableCall({ call_recording_url: "", duration: 10 }), false);
  assert.equal(isProcessableCall({ call_recording_url: "https://x.example/a.mp3", duration: 0 }), false);
  assert.equal(isProcessableCall({ call_recording_url: "not a url", duration: 5 }), false);
  assert.equal(isProcessableCall({ call_recording_url: "https://x.example/a.mp3", duration: 5 }), true);
});

test("download: sends no auth header, validates mp3; failures omit url", async () => {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0]);
  const ok = make([new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } })]);
  const d = await ok.client.downloadRecording("https://x.example/secret-path.mp3");
  assert.equal(d.size, 6);
  assert.equal(ok.calls[0].init?.headers, undefined);

  for (const bad of [new Response("", { status: 200 }), new Response("hello", { status: 200 }), new Response("no", { status: 403 })]) {
    await assert.rejects(make([bad]).client.downloadRecording("https://x.example/secret-path.mp3"), (e: CallyzerError) => e.kind === "download" && !e.message.includes("secret-path"));
  }
  await assert.rejects(make([]).client.downloadRecording(""), (e: CallyzerError) => e.kind === "download");
});

test("looksLikeMp3", () => {
  assert.equal(looksLikeMp3(new Uint8Array([0xff, 0xfb, 0x90, 0])), true);
  assert.equal(looksLikeMp3(new Uint8Array([1, 2, 3, 4])), false);
});

test("missing api key -> config error", () => {
  assert.throws(() => CallyzerClient.fromEnv({}), (e: CallyzerError) => e.kind === "config");
});
