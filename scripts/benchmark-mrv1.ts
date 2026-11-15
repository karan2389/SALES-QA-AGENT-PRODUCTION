// Offline benchmark of the four-pass MRV1.0 execution. SYNTHETIC transcripts and a MOCKED model only: no Workers AI, no network, no real calls.
// What is measured: invocation counts, prompt sizes, mocked response sizes, engine CPU time and memory, and behaviour under failure.
// What is NOT measured (no real model is called): model latency. Latency scenarios below are explicit assumptions, labelled as such.
//   node scripts/benchmark-mrv1.ts            (prints a markdown report)
import { runMrv1Evaluation } from "../src/mrv1/engine.ts";
import type { Mrv1CallInfo } from "../src/mrv1/engine.ts";
import { PASSES } from "../src/mrv1/rubric.ts";
import { FakeStore, SEGMENTS, fakeModel } from "./mrv1-fixtures.ts";

const C = ["b", "d", "f", "g", "j", "l", "p", "s", "t", "v", "z"];
const V = ["a", "e", "i", "o", "u"];
const word = (i: number) => `${C[i % 11]}${V[Math.floor(i / 11) % 5]}${C[Math.floor(i / 55) % 11]}${V[Math.floor(i / 605) % 5]}`;
const TOKENS_PER_CHAR_EN = 1 / 4; // typical for English
const TOKENS_PER_CHAR_HI = 1 / 1.5; // Devanagari is far less efficient: used as the conservative bound
const tokens = (chars: number, perChar: number) => Math.round(chars * perChar);

/** A synthetic call of `minutes`, ~9 segments a minute, first 12 segments = the fixture transcript so the mock's quotations verify. */
function syntheticCall(minutes: number) {
  const seconds = minutes * 60;
  const n = Math.max(30, Math.round(minutes * 9));
  const step = (seconds - 5) / n;
  const segments = Array.from({ length: n }, (_, i) => ({
    index: i,
    start: i * step,
    end: i * step + step * 0.9,
    text: i < SEGMENTS.length ? SEGMENTS[i].text : Array.from({ length: 11 }, (_, j) => word(i * 11 + j)).join(" "),
  }));
  const call: Mrv1CallInfo = { id: 7, callyzer_call_id: "CY-7", agent_id: 1, duration_seconds: seconds, audio_size_bytes: seconds * 4000 };
  return { call, segments };
}

/** Makes the mock's JSON as large as a real answer (~700 chars of prose per criterion) so response-size estimates are realistic. */
function paddedModel(latencyMs = 0) {
  const m = fakeModel();
  const sizes: Array<{ pass: string; promptChars: number; outputChars: number; ms: number }> = [];
  const inner = m.run.bind(m);
  m.run = async (req) => {
    const t0 = performance.now();
    const out = await inner(req);
    const j = JSON.parse(out.text);
    const pad = " The salesperson's wording, the prospect's reply and the surrounding context were weighed against the anchor for this criterion before settling on this outcome.".repeat(3);
    for (const c of j.criteria) {
      c.explanation += pad;
      c.improvement_recommendation = c.improvement_recommendation ? c.improvement_recommendation + pad : "";
      c.confidence_reason += " confirmed against neighbouring segments";
    }
    const text = JSON.stringify(j);
    if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
    sizes.push({ pass: /pass: ([a-z0-9_]+)/.exec(req.user)?.[1] ?? "?", promptChars: req.system.length + req.user.length, outputChars: text.length, ms: performance.now() - t0 });
    return { ...out, text };
  };
  return { model: m, sizes };
}

async function once(minutes: number) {
  const { call, segments } = syntheticCall(minutes);
  const store = new FakeStore({ call, transcript: { source: "production", language: "en", segments } });
  const { model, sizes } = paddedModel();
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const r = await runMrv1Evaluation({ store, model }, { callyzerCallId: "CY-7" });
  const cpuMs = performance.now() - t0;
  const heap1 = process.memoryUsage();
  return { r, sizes, cpuMs, heapMb: (heap1.heapUsed - heap0) / 1e6, rssMb: heap1.rss / 1e6, calls: model.calls.length, segments: segments.length };
}

const out: string[] = [];
const log = (s = "") => out.push(s);
log("# MRV1.0 four-pass benchmark (synthetic transcripts, mocked model)\n");
log(`Node ${process.version}. Passes: ${PASSES.map((p) => p.key).join(", ")}.\n`);

const lengths = [10, 20, 30, 45];
log("## 1. Invocations and sizes per evaluation\n");
log("| Call length | Segments | Model calls | Prompt tokens, English bound (sum of 4) | Prompt tokens, Devanagari bound (sum of 4) | Output tokens est. (sum of 4) | Largest single output (tokens) | Engine CPU (ms) | Heap growth (MB) |");
log("|---|---|---|---|---|---|---|---|---|");
const rows: Array<Awaited<ReturnType<typeof once>>> = [];
for (const m of lengths) {
  const x = await once(m);
  rows.push(x);
  if (x.r.status !== "completed") throw new Error(`benchmark call ${m} min did not complete: ${JSON.stringify(x.r).slice(0, 200)}`);
  const pc = x.sizes.reduce((s, v) => s + v.promptChars, 0);
  const oc = x.sizes.reduce((s, v) => s + v.outputChars, 0);
  const maxOut = Math.max(...x.sizes.map((v) => tokens(v.outputChars, TOKENS_PER_CHAR_EN)));
  log(`| ${m} min | ${x.segments} | ${x.calls} | ${tokens(pc, TOKENS_PER_CHAR_EN)} | ${tokens(pc, TOKENS_PER_CHAR_HI)} | ${tokens(oc, TOKENS_PER_CHAR_EN)} | ${maxOut} | ${x.cpuMs.toFixed(0)} | ${x.heapMb.toFixed(1)} |`);
}
const last = rows[rows.length - 1];
log("\nPer pass, 45-minute call:\n");
log("| Pass | Prompt chars | Output chars (mock) | Output tokens est. | Share of 20,000-token output cap (incl. reasoning) |");
log("|---|---|---|---|---|");
for (const s of last.sizes) log(`| ${s.pass} | ${s.promptChars} | ${s.outputChars} | ${tokens(s.outputChars, TOKENS_PER_CHAR_EN)} | ${(100 * tokens(s.outputChars, TOKENS_PER_CHAR_EN) / 20000).toFixed(0)}% (before reasoning tokens) |`);

log("\n## 2. Wall-clock under ASSUMED model speeds (not measured)\n");
log("Latency per pass = prompt_tokens / prefill_rate + (output_tokens + reasoning_tokens) / decode_rate. Reasoning tokens are assumed equal to the visible output (reasoning_effort=medium). Real values must come from a controlled test on approved recordings.\n");
log("| Scenario | Decode tok/s | 20 min call, total (s) | Slowest pass (s) | 45 min call, total (s) | Slowest pass (s) | Worst case with one retry per pass (s) |");
log("|---|---|---|---|---|---|---|");
for (const [name, decode, prefill] of [["fast", 100, 3000], ["typical", 50, 1500], ["slow", 20, 800]] as const) {
  const calc = (x: (typeof rows)[number]) => {
    const per = x.sizes.map((s) => tokens(s.promptChars, TOKENS_PER_CHAR_HI) / prefill + (2 * tokens(s.outputChars, TOKENS_PER_CHAR_EN)) / decode);
    return { total: per.reduce((a, b) => a + b, 0), max: Math.max(...per) };
  };
  const a = calc(rows[1]);
  const b = calc(rows[3]);
  log(`| ${name} | ${decode} | ${a.total.toFixed(0)} | ${a.max.toFixed(0)} | ${b.total.toFixed(0)} | ${b.max.toFixed(0)} | ${Math.min(b.total * 2, 4 * 2 * 280).toFixed(0)} (hard ceiling 4 x 2 x 280 = 2240) |`);
}

log("\n## 3. Behaviour under failure (mocked)\n");
const failScenarios: Array<{ name: string; make: () => ReturnType<typeof fakeModel> }> = [
  { name: "transient failure on the first call (retry succeeds)", make: () => fakeModel({ failFirst: 1 }) },
  { name: "invalid JSON on the 4th pass, both attempts", make: () => fakeModel({ text: (p) => (p === "psychology_report" ? "{ not json" : undefined) }) },
  { name: "model always fails", make: () => fakeModel({ failFirst: 99 }) },
];
log("| Scenario | Model calls made | Result | Rows stored | Work lost |");
log("|---|---|---|---|---|");
for (const s of failScenarios) {
  const { call, segments } = syntheticCall(20);
  const store = new FakeStore({ call, transcript: { source: "production", language: "en", segments } });
  const model = s.make();
  const r: any = await runMrv1Evaluation({ store, model }, { callyzerCallId: "CY-7" });
  const lost = r.status === "completed" ? "none" : `${new Set(model.calls.map((c) => c.pass)).size - (r.status === "failed" ? 1 : 0)} completed pass(es) discarded; whole evaluation must be re-run`;
  log(`| ${s.name} | ${model.calls.length} | ${r.status}${r.error_kind ? ` (${r.error_kind}, pass ${r.pass ?? "-"})` : ""} | ${store.saved.length} | ${lost} |`);
}

log("\n## 4. Findings\n");
const maxCpu = Math.max(...rows.map((r) => r.cpuMs));
log(`- Engine CPU time is ${maxCpu.toFixed(0)} ms at most for a 45-minute transcript, and heap growth is a few MB: validation and scoring are not a constraint.`);
log("- Every evaluation makes exactly 4 model calls; each re-attempt repeats a whole pass. A failure in any pass discards all earlier passes (no checkpoint).");
log("- The binding limit is model latency, which this offline benchmark cannot measure. The timeout is 280 s per call, so the ceiling is 4 x 280 s = 1120 s (2240 s with one retry per pass) while one HTTP request stays open.");
log("- Output budget: the largest pass is well below the 20,000-token cap before reasoning tokens, but reasoning tokens share that cap; a truncation is NOT retried and fails the whole evaluation.");
console.log(out.join("\n"));
