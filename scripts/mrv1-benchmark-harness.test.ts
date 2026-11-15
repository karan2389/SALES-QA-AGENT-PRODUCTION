// Benchmark harness tests: mocked mode only. No test makes a live model call or touches the network (fetch is injected).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGptOssModel } from "../src/evaluation/workers-ai-model.ts";
import { createRestAi, resolveMode, runBenchmark, summarize, syntheticSegments, tokenEstimate } from "./benchmark-harness.ts";
import { fakeModel } from "./mrv1-fixtures.ts";

test("live mode needs every opt-in; anything less is the mocked benchmark", () => {
  const env = { MRV1_LIVE_BENCHMARK: "1", CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" };
  assert.equal(resolveMode(env, ["--live", "--confirm-synthetic-only"]).mode, "live");
  for (const [e, a, why] of [
    [env, [], /--live/],
    [{ ...env, MRV1_LIVE_BENCHMARK: undefined }, ["--live", "--confirm-synthetic-only"], /MRV1_LIVE_BENCHMARK/],
    [env, ["--live"], /confirm-synthetic-only/],
    [{ ...env, CLOUDFLARE_API_TOKEN: undefined }, ["--live", "--confirm-synthetic-only"], /credentials/],
    [{ MRV1_LIVE_BENCHMARK: "0" }, ["--live", "--confirm-synthetic-only"], /MRV1_LIVE_BENCHMARK/],
  ] as const) {
    const d: any = resolveMode(e as any, a as any);
    assert.equal(d.mode, "mock");
    assert.match(d.reason, why);
  }
});

test("mocked benchmark records every required field for all four passes and is labelled simulated", async () => {
  const recs = await runBenchmark({ model: fakeModel(), mode: "mock", minutes: 20, retries: 0, timeoutMs: 280_000, assumedTokensPerSecond: 50 });
  assert.equal(recs.length, 4);
  assert.deepEqual(recs.map((r) => r.pass_number), [1, 2, 3, 4]);
  for (const r of recs) {
    for (const k of ["pass_number", "pass_key", "input_token_estimate", "output_token_estimate", "usage", "started_at", "ended_at", "latency_ms", "timeout", "retry_count", "validation", "truncated"]) assert.ok(k in r, k);
    assert.equal(r.simulated, true);
    assert.equal(r.mode, "mock");
    assert.ok(r.input_token_estimate > 1000);
    assert.equal(r.validation === "ok" || r.validation === "schema_invalid", true);
    assert.ok(Date.parse(r.ended_at) >= Date.parse(r.started_at));
  }
});

test("mocked records never contain prompt or transcript text", async () => {
  const recs = await runBenchmark({ model: fakeModel(), mode: "mock", minutes: 10, retries: 0, timeoutMs: 280_000 });
  const blob = JSON.stringify(recs);
  const { segments } = syntheticSegments(10);
  assert.ok(!blob.includes(segments[40].text));
  assert.ok(!/RUBRIC|OUTPUT FORMAT|You are a careful/.test(blob));
});

test("virtual latency follows the assumed decode speed and flags a timeout without sleeping", async () => {
  const t0 = Date.now();
  const slow = await runBenchmark({ model: fakeModel(), mode: "mock", minutes: 20, retries: 0, timeoutMs: 280_000, assumedTokensPerSecond: 1 });
  assert.ok(Date.now() - t0 < 5000); // virtual time: nothing was slept
  assert.ok(summarize(slow).timeouts >= 1);
  const fast = await runBenchmark({ model: fakeModel(), mode: "mock", minutes: 20, retries: 0, timeoutMs: 280_000, assumedTokensPerSecond: 100000 });
  assert.equal(summarize(fast).timeouts, 0);
});

test("failures are recorded: truncation (not retried), model errors (retried), invalid JSON", async () => {
  const mk = (b: "truncate" | "fail" | "bad") => {
    const inner = fakeModel();
    let n = 0;
    return { id: "x", async run(req: any) {
      n++;
      if (b === "fail") throw Object.assign(new Error("boom"), { kind: "timeout" });
      const o = await inner.run(req);
      return b === "truncate" ? { ...o, finish_reason: "length" } : { text: "{ nope" };
    }, get calls() { return n; } };
  };
  const t = mk("truncate");
  const tr = await runBenchmark({ model: t as any, mode: "mock", minutes: 10, retries: 2, timeoutMs: 280_000 });
  assert.ok(tr.every((r) => r.truncated && r.retry_count === 0));
  assert.equal(t.calls, 4);
  const f = mk("fail");
  const fr = await runBenchmark({ model: f as any, mode: "mock", minutes: 10, retries: 2, timeoutMs: 280_000 });
  assert.ok(fr.every((r) => r.timeout && r.error_kind === "timeout" && r.retry_count === 2));
  assert.equal(f.calls, 12);
  const b = await runBenchmark({ model: mk("bad") as any, mode: "mock", minutes: 10, retries: 0, timeoutMs: 280_000 });
  assert.ok(b.every((r) => r.validation === "invalid_json"));
});

test("the REST adapter sends the bearer token only as a header, parses the result and never returns or logs the token", async () => {
  const seen: any[] = [];
  const fetchFn = (async (url: string, init: any) => {
    seen.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ success: true, result: { choices: [{ message: { content: JSON.stringify({ hello: "world" }) }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7 } } }) };
  }) as any;
  const ai = createRestAi({ accountId: "acct123", token: "SECRET-TOKEN-VALUE", fetchFn });
  const model = createGptOssModel(ai as any);
  const r = await model.run({ system: "s", user: "u" });
  assert.match(seen[0].url, /\/accounts\/acct123\/ai\/run\/@cf\/openai\/gpt-oss-120b$/);
  assert.equal(seen[0].init.headers.authorization, "Bearer SECRET-TOKEN-VALUE");
  assert.ok(!seen[0].init.body.includes("SECRET-TOKEN-VALUE"));
  assert.ok(!JSON.stringify(r).includes("SECRET-TOKEN-VALUE"));
  assert.deepEqual(JSON.parse(r.text), { hello: "world" });
  assert.deepEqual((r.usage as any).prompt_tokens, 11);
  // REST failure: a safe message (status and code only)
  const bad = createRestAi({ accountId: "a", token: "SECRET-TOKEN-VALUE", fetchFn: (async () => ({ ok: false, status: 429, json: async () => ({ success: false, errors: [{ code: 4006, message: "quota" }] }) })) as any });
  await assert.rejects(() => bad.run("m", {}), (e: any) => /429/.test(e.message) && /4006/.test(e.message) && !/SECRET/.test(e.message));
});

test("token estimate is conservative and the synthetic transcript is made only of invented words", () => {
  assert.equal(tokenEstimate(300), 100);
  const { segments, seconds } = syntheticSegments(30);
  assert.equal(seconds, 1800);
  assert.ok(segments.length >= 200);
  assert.ok(segments.every((s) => /^[a-z ]+$/.test(s.text)));
});
