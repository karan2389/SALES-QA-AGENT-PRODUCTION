# MRV1.0 execution architecture: is the synchronous four-pass design safe?

Evidence: `npm run benchmark:mrv1` (`scripts/benchmark-mrv1.ts`, output in `docs/mrv1-benchmark-results.md`). Synthetic transcripts and a mocked model only. **Model latency was not measured** (no model was called), so every latency figure below is an assumption.

## Verdict

**Not demonstrably safe. Do not rely on it for production.** Nothing was implemented or deployed. A design for the fix is proposed below for your approval.

## What the code does today

`POST /admin/mrv1/evaluate/<id>` runs gates, then four sequential model calls (`stages_01_06`, `stages_07_12`, `stages_13_19`, `psychology_report`) inside one HTTP request, validates each, and writes everything in one D1 batch at the very end. Per call: timeout 280 s (`workers-ai-model.ts`), output cap 20,000 tokens including reasoning, one retry for timeout/model error/invalid JSON/schema error, no retry for truncation.

## Measured (mocked, synthetic)

| Item | Result |
|---|---|
| Model calls per evaluation | exactly 4 (5 with one retry; up to 8 with a retry on every pass) |
| Prompt size | about 41k to 66k input tokens per evaluation for 10 to 45 minute calls with an English token estimate; up to about 175k with a conservative Devanagari estimate. About 35k tokens of that is static rules and anchors repeated in every pass. |
| Visible output per pass (estimated from a realistic-size mock) | 5.9k to 10.6k tokens; the 13-19 pass is the largest |
| Engine CPU and memory | at most 31 ms and a few MB: validation and scoring are not a constraint |
| Failure behaviour | any failing pass stores nothing; completed earlier passes are discarded and the whole evaluation must be re-run (3 passes lost in the "fourth pass fails" case) |

## Why it is not safe

1. **Per-call time risk.** At an assumed 50 tokens/s decode (visible plus an equal amount of reasoning), the largest pass takes about 450 s, which is over the 280 s timeout; only an assumed 100 tokens/s finishes under it (about 229 s). Real speed and real reasoning volume are unknown.
2. **Request lifetime.** Four sequential calls keep one HTTP request open for between roughly 12 minutes and (ceiling) 37 minutes with a retry on every pass. Whether the caller, a proxy or the platform keeps that connection alive must be verified against current Cloudflare documentation; I could not verify it offline.
3. **No checkpointing.** A failure at pass 4 throws away about 75% of the model work and quota (Workers AI free tier: 10,000 neurons per day, a real constraint).
4. **Truncation is fatal.** Reasoning tokens share the 20,000 cap with about 10k visible tokens in the largest pass.
5. **Duplicate triggers.** Two concurrent requests for the same call both run all passes; only the final insert is protected by the unique key.

## Proposed solution (needs your approval; not implemented)

Use the existing Cloudflare stack: **D1 job state + Cloudflare Queues** (no new provider, no Durable Object needed because D1 gives the transactional state).

| Aspect | Design |
|---|---|
| Job state | New migration `0007` (proposed): `evaluation_jobs` (id, call, rubric, prompt version, status `queued/running/completed/failed/held`, attempts, error, timestamps; UNIQUE on call + rubric + prompt version) and `evaluation_job_passes` (job, pass key, status, attempts, raw output, usage, validated JSON, error; UNIQUE job + pass key). |
| Flow | Request runs gates synchronously (fast, no model), inserts the job (idempotent) and enqueues one message per pass; returns `202` with the job id. |
| Idempotency and duplicate prevention | Job unique key; pass unique key; a consumer first claims a pass row with `UPDATE ... WHERE status IN ('queued','failed') ` (compare-and-set), so a redelivered message cannot run a pass twice. |
| Retry | Queue retries with backoff, capped per pass (3 attempts); malformed output and transient errors retried; truncation fails that pass with a clear code and a smaller-pass option. |
| Partial recovery | Validated pass output is stored. A failed pass is retried alone; completed passes are never repeated. |
| Finalisation | When all four passes are validated, one consumer step assembles the document, applies flag caps, computes scores, and writes the existing evaluation tables in the same atomic batch used today. Nothing is visible to export until then. |
| Status visibility | `GET /admin/mrv1/job/<id>` returning pass statuses, attempts and error codes. |
| Migration impact | One additive migration (two tables). Nothing existing changes. Requires a Queue binding in `wrangler.jsonc` (a deployment change: your approval needed). |

### Cheaper first step (also needs approval)

Before building queues, run **one controlled latency test of one synthetic transcript** through the real GPT-OSS binding to measure per-pass latency and reasoning tokens. If the largest pass is comfortably under 280 s, a smaller change may suffice (for example run from a script that calls one endpoint per pass, with the existing pass-level validation, and store passes in D1). This uses Workers AI quota and was therefore not done.

## Decision needed

1. Approve the synthetic latency test? 2. Approve the job/queue design (migration `0007`, Queue binding) if latency is a problem?
