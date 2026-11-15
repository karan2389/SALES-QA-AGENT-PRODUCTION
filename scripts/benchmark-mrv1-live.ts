// GPT-OSS 120B latency benchmark for MRV1.0 on SYNTHETIC transcripts. DISABLED by default: without the full opt-in it runs the mocked benchmark only.
//   mocked (default):  node scripts/benchmark-mrv1-live.ts [--minutes 20]
//   live (explicit):   MRV1_LIVE_BENCHMARK=1 node --env-file=.env scripts/benchmark-mrv1-live.ts --live --confirm-synthetic-only [--minutes 20] [--retries 1]
// A live run sends synthetic text only to Workers AI and uses account quota. It is never part of the regression suite and no recording is involved.
// Records (JSON lines) go to reports/ (gitignored) and contain sizes, timings, usage and validation outcomes, never prompt or transcript text.
import { mkdirSync, writeFileSync } from "node:fs";
import { createGptOssModel } from "../src/evaluation/workers-ai-model.ts";
import type { EvaluationModel } from "../src/evaluation/evaluate.ts";
import { createRestAi, resolveMode, runBenchmark, summarize } from "./benchmark-harness.ts";
import { fakeModel } from "./mrv1-fixtures.ts";

const argv = process.argv.slice(2);
const arg = (name: string, d: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? Number(argv[i + 1]) : d;
};
const decision = resolveMode(process.env, argv);
const minutes = arg("minutes", 20);
let model: EvaluationModel;
if (decision.mode === "live") {
  model = createGptOssModel(createRestAi({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID as string, token: process.env.CLOUDFLARE_API_TOKEN as string }) as never, { timeoutMs: 280_000 });
  console.log("LIVE MODE: sending synthetic transcripts to Workers AI (gpt-oss-120b).");
} else {
  model = fakeModel() as EvaluationModel;
  console.log(`MOCKED MODE (${decision.reason}). Latency below is VIRTUAL (assumed decode speed), not measured. Real GPT-OSS latency remains UNMEASURED.`);
}
const records = await runBenchmark({ model, mode: decision.mode, minutes, retries: arg("retries", 0), timeoutMs: 280_000, assumedTokensPerSecond: arg("tps", 50) });
for (const r of records) console.log(`pass ${r.pass_number} ${r.pass_key}: in~${r.input_token_estimate} out~${r.output_token_estimate ?? "-"} tokens, ${r.latency_ms} ms${r.simulated ? " (virtual)" : ""}, timeout=${r.timeout}, truncated=${r.truncated}, retries=${r.retry_count}, validation=${r.validation}`);
console.log(JSON.stringify(summarize(records)));
mkdirSync("reports", { recursive: true });
const file = `reports/mrv1-benchmark-${decision.mode}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`records written to ${file} (gitignored)`);
