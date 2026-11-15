// GPT-OSS 120B latency benchmark harness for MRV1.0, SYNTHETIC transcripts only. DISABLED by default.
// A live call needs ALL of: --live on the command line, MRV1_LIVE_BENCHMARK=1 in the environment, --confirm-synthetic-only, and Cloudflare credentials.
// Otherwise it runs the mocked benchmark (virtual time, no network) and says plainly that real model latency is still unmeasured.
// Records never contain prompt or transcript text, only sizes, timings, usage and validation results.
import { parseModelJson } from "../src/evaluation/validate.ts";
import type { EvaluationModel } from "../src/evaluation/evaluate.ts";
import { buildPassMessages } from "../src/mrv1/prompt.ts";
import { ALL_CRITERIA, PASSES, criteriaForPass } from "../src/mrv1/rubric.ts";
import { validatePass } from "../src/mrv1/validate.ts";
import { computeQuality } from "../src/evaluation/transcript.ts";
import type { Segment } from "../src/evaluation/types.ts";

export interface BenchRecord {
  mode: "mock" | "live";
  simulated: boolean;
  pass_number: number;
  pass_key: string;
  call_minutes: number;
  input_token_estimate: number;
  output_token_estimate: number | null;
  usage: unknown | null;
  started_at: string;
  ended_at: string;
  latency_ms: number;
  timeout: boolean;
  retry_count: number;
  truncated: boolean;
  validation: "ok" | "invalid_json" | "schema_invalid" | "not_run";
  validation_errors: number;
  error_kind: string | null;
}

export type ModeDecision = { mode: "live" } | { mode: "mock"; reason: string };
/** Live mode requires an explicit, multi-part opt-in. Anything less is the mocked benchmark. */
export function resolveMode(env: Record<string, string | undefined>, argv: string[]): ModeDecision {
  if (!argv.includes("--live")) return { mode: "mock", reason: "--live was not given" };
  if (env.MRV1_LIVE_BENCHMARK !== "1") return { mode: "mock", reason: "MRV1_LIVE_BENCHMARK=1 is not set" };
  if (!argv.includes("--confirm-synthetic-only")) return { mode: "mock", reason: "--confirm-synthetic-only was not given" };
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) return { mode: "mock", reason: "Cloudflare credentials are not available in the environment" };
  return { mode: "live" };
}

const C = ["b", "d", "f", "g", "j", "l", "p", "s", "t", "v", "z"];
const V = ["a", "e", "i", "o", "u"];
const word = (i: number) => `${C[i % 11]}${V[Math.floor(i / 11) % 5]}${C[Math.floor(i / 55) % 11]}${V[Math.floor(i / 605) % 5]}`;
/** A synthetic transcript of `minutes` (invented pseudo-words, ~9 segments a minute). Contains no real speech or customer data. */
export function syntheticSegments(minutes: number): { segments: Segment[]; seconds: number } {
  const seconds = minutes * 60;
  const n = Math.max(30, Math.round(minutes * 9));
  const step = (seconds - 5) / n;
  return { seconds, segments: Array.from({ length: n }, (_, i) => ({ index: i, start: i * step, end: i * step + step * 0.9, text: Array.from({ length: 11 }, (_, j) => word(i * 11 + j)).join(" ") })) };
}
export const tokenEstimate = (chars: number) => Math.round(chars / 3); // conservative between English (4 chars/token) and Devanagari (1.5)

export interface BenchOptions {
  model: EvaluationModel;
  mode: "mock" | "live";
  minutes: number;
  retries: number; // extra attempts after a failure (0 = one attempt)
  timeoutMs: number;
  now?: () => number;
  /** mock mode only: assumed decode speed used to compute virtual latency */
  assumedTokensPerSecond?: number;
}

/** Runs the four passes once and returns one record per pass attempt-series. */
export async function runBenchmark(o: BenchOptions): Promise<BenchRecord[]> {
  const now = o.now ?? (() => Date.now());
  const { segments, seconds } = syntheticSegments(o.minutes);
  const quality = computeQuality(segments, seconds, "en");
  const out: BenchRecord[] = [];
  let n = 0;
  for (const pass of PASSES) {
    n++;
    const ids = criteriaForPass(pass).map((c) => c.id);
    const { system, user } = buildPassMessages({ pass, expectedIds: ids, naCategories: [], callTypeLabel: "new_webinar_prospect", durationSeconds: seconds, transcriptSource: "synthetic", segments, quality });
    const inputTokens = tokenEstimate(system.length + user.length);
    let retryCount = 0;
    let rec: BenchRecord | null = null;
    for (let attempt = 0; attempt <= o.retries; attempt++) {
      const t0 = now();
      const started = new Date(t0).toISOString();
      let text = "";
      let usage: unknown = null;
      let truncated = false;
      let errorKind: string | null = null;
      try {
        const r = await o.model.run({ system, user });
        text = r.text;
        usage = r.usage ?? null;
        truncated = r.finish_reason === "length";
      } catch (e) {
        errorKind = (e as { kind?: string }).kind ?? "model_error";
      }
      let latency = now() - t0;
      if (o.mode === "mock" && !errorKind) latency = Math.round(((tokenEstimate(text.length) * 2) / (o.assumedTokensPerSecond ?? 50)) * 1000); // virtual time, never slept
      const timedOut = errorKind === "timeout" || latency > o.timeoutMs;
      let validation: BenchRecord["validation"] = "not_run";
      let errs = 0;
      if (!errorKind && !truncated) {
        const parsed = parseModelJson(text);
        if (!parsed.ok) validation = "invalid_json";
        else {
          const v = validatePass(parsed.value, pass, ids, segments.length);
          validation = v.ok ? "ok" : "schema_invalid";
          errs = v.ok ? 0 : v.errors.length;
        }
      }
      rec = {
        mode: o.mode, simulated: o.mode === "mock", pass_number: n, pass_key: pass.key, call_minutes: o.minutes, input_token_estimate: inputTokens,
        output_token_estimate: text ? tokenEstimate(text.length) : null, usage, started_at: started, ended_at: new Date(t0 + latency).toISOString(), latency_ms: latency,
        timeout: timedOut, retry_count: retryCount, truncated, validation, validation_errors: errs, error_kind: errorKind,
      };
      if (!errorKind && !truncated && validation === "ok") break;
      if (truncated) break; // the same request would truncate again
      retryCount++;
    }
    out.push(rec as BenchRecord);
  }
  return out;
}

export function summarize(records: BenchRecord[]): { total_latency_ms: number; max_pass_latency_ms: number; timeouts: number; truncated: number; invalid: number } {
  return {
    total_latency_ms: records.reduce((a, r) => a + r.latency_ms, 0),
    max_pass_latency_ms: Math.max(...records.map((r) => r.latency_ms)),
    timeouts: records.filter((r) => r.timeout).length,
    truncated: records.filter((r) => r.truncated).length,
    invalid: records.filter((r) => r.validation !== "ok").length,
  };
}

/**
 * Adapter with the shape of the Workers AI binding's `run`, backed by the Cloudflare REST API, so the live benchmark exercises exactly the request
 * and response handling of createGptOssModel. The token is only placed in the Authorization header; it is never logged or returned.
 */
export function createRestAi(opts: { accountId: string; token: string; fetchFn?: typeof fetch }): { run(model: string, input: unknown): Promise<unknown> } {
  const f = opts.fetchFn ?? fetch;
  return {
    async run(model: string, input: unknown) {
      const res = await f(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(opts.accountId)}/ai/run/${model}`, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const j = (await res.json().catch(() => null)) as { success?: boolean; result?: unknown; errors?: Array<{ code?: number }> } | null;
      if (!res.ok || !j || j.success === false) throw new Error(`Workers AI REST error: HTTP ${res.status}${j?.errors?.[0]?.code ? ` code ${j.errors[0].code}` : ""}`);
      return j.result;
    },
  };
}

export { ALL_CRITERIA };
