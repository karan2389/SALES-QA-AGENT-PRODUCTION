# MRV1.0 durable execution: audit, design and what is implemented

Status: **implemented and tested with a mocked model and synthetic data; not deployed.** Migration `0007` is not applied remotely, no Queue exists, and real GPT-OSS latency is still unmeasured. See `docs/mrv1-execution-architecture.md` for the benchmark that motivated this.

## 1. Audit: what the synchronous engine does on failure

The synchronous engine (`runMrv1Evaluation`) is unchanged in behaviour and kept for tests and controlled local use. Its route is now **off by default** (`MRV1_ALLOW_SYNC=1` re-enables it).

| Situation | Synchronous engine | Durable pipeline (new) |
|---|---|---|
| 1. Pass 1 ok, pass 2 fails | whole evaluation fails, pass 1 discarded, nothing stored | pass 1's validated output stays in D1; pass 2 is retried alone with backoff |
| 2. Pass 2 ok, pass 3 fails | passes 1-2 discarded | passes 1-2 kept; only pass 3 retried; a manual retry after a stop resumes at pass 3 |
| 3. Pass 4 fails after 1-3 | three passes of model work and quota discarded | the three passes are kept (`partially_completed`) and resumed |
| 4. Worker terminates | request dies; nothing stored; caller sees an error or timeout | the stage's lease expires, the redelivered message reclaims it; completed stages are not repeated |
| 5. Request submitted twice | both run all passes; only the final insert is protected by the unique key | the idempotency key and the one-active-job-per-call index return the existing job; no second run |
| 6. Queue message delivered twice | n/a | compare-and-set stage lease: the second delivery finds the stage completed (advances) or held (retries later); the model is called once per pass |
| 7. D1 unavailable | persistence fails at the end after all model work (`persist_failed`) | the failing step is retried with backoff; model output already stored is reused; finalize retries without calling the model |
| 8. Malformed JSON | retried once inside the pass, then the whole evaluation fails | the same in-pass retry, then queue-level retries (limit 3), then the job stops retry-eligible with code `malformed_json` |
| 9. Truncated response | not retried, whole evaluation fails | not retried: the job stops at once with `truncated` (retrying the same request would truncate again) |
| 10. Retry after partial persistence | no partial persistence exists (one atomic write at the end) | the evaluation is still written by the one existing atomic batch; a finalize redelivered after the write completes the job without a duplicate (found while testing: the job is now settled before the finalize stage is marked completed) |

Existing protections kept: strict per-pass validation, evidence verification, atomic evaluation write, unique `(call, rubric, prompt)` key, revision slots (`#r2`...) after invalidation.

## 2. Lifecycle (adapted to the existing schema)

The proposed linear state list is represented as **job status** plus **stage rows**, because stages repeat and can be retried independently.

- Job status: `queued`, `running`, `retrying`, `partially_completed`, `completed`, `failed`, `requires_human_review`, `cancelled`, `invalidated`.
- Stages: `gate` (completed when the job is created: gates 1-3 and the transcript gate run synchronously, no model), `stages_01_06`, `stages_07_12`, `stages_13_19`, `psychology_report`, `finalize` (validate again, flag caps, scores, report, one atomic persistence).
- Differences from the proposal: "validation", "scoring" and "persistence" are one `finalize` stage because they must happen in one atomic write; `evaluation_requested` and `job_created` are the moment the job row is inserted; a pass with no applicable criteria is `skipped`.

## 3. Job and stage persistence (`migrations/0007_mrv1_durable_jobs.sql`, additive)

`evaluation_jobs`: id, call, rubric and prompt revision, idempotency key (`<call>:<rubric>:<prompt version>`), transcript source and SHA-256, snapshot of the confirmed call type, acknowledgement flags, status, current stage, attempt count, evaluation id, last error code and safe description, retry eligibility, created/updated/started/completed times.
`evaluation_job_stages`: job, stage, ordinal, status, attempts, lease expiry, start/completion times, error code and message, the validated pass's raw model output, usage.

The transcript is **not** copied: it is reloaded from the existing tables on every stage and its hash is compared with the job's snapshot. Error descriptions never contain transcript text, prompts or model output (tested). Constraints: unique idempotency key; unique index allowing one non-terminal job per call; CHECK constraints on statuses.

## 4. Queue reliability

| Concern | Mechanism |
|---|---|
| Duplicate delivery | stage lease via compare-and-set `UPDATE ... WHERE status IN ('pending','failed') OR lease expired`; completed stage means "advance", never "run again" |
| Retry limits and backoff | queue-level attempts per stage (3), delay 30 s doubling to 900 s; each attempt also retries inside the pass once |
| Poison messages | a stage over its attempt limit stops the job (`max_attempts_exceeded`); malformed bodies are acknowledged and dropped by the consumer |
| Dead-letter | the job row is the durable record (status, stage, code, retry eligibility); the platform dead-letter queue (configured with `max_retries`) catches messages that keep throwing outside the pipeline's handling |
| Idempotency keys | job key, stage primary key `(job, stage)`, evaluation unique key |
| Concurrency | consumer `max_concurrency: 1` recommended; leases make higher values safe for different jobs |
| Worker termination | lease expiry (600 s, above the 2 x 280 s in-pass worst case) |
| D1 write failure | exception caught, stage released, redelivery with backoff; at the attempt limit the job stops retry-eligible |
| Model failure | classified: `truncated` is final, everything else retried |
| Invalidation while running | see section 5 |

## 5. Stale processing never publishes

A job is stale when it was cancelled or invalidated, the human-confirmed call type changed (re-confirming the same type is harmless) or was removed, the transcript hash changed, or its revision slot changed. The check runs before claiming each stage, again after rebuilding the context, again immediately before the evaluation is written, and once more after the write. If the job became stale between the write and the completion, the evaluation is **superseded** (`evaluation_invalidations`, status `superseded`, kept for audit) and the job ends `invalidated`. Residual window: milliseconds between the write and the last check, during which the evaluation row exists as valid; export is a separate manual action, so nothing is published in that window. All of this is tested.

## 6. Components

Producer (`createEvaluationJob`): gates, create job (idempotent), send the first stage message. Consumer (`processJobMessage`): one stage per message. Also `getJobStatus`, `retryJob` (resume; completed passes kept), `cancelJob`. Worker routes: `POST /admin/mrv1/jobs/<callyzer id>` (202), `GET /admin/mrv1/job/<id>`, `POST /admin/mrv1/job/<id>/retry`, `POST /admin/mrv1/job/<id>/cancel`, plus the `queue()` handler. The pipeline never imports or calls the Google Sheets export. Logs are one JSON line per event with identifiers and codes only.

Unchanged: model interface (`EvaluationModel`), Workers AI binding, evaluation tables and views, the atomic evaluation write, gates, scoring.

## 7. Observability

Structured log events (`job_created`, `stage_started`, `pass_completed`, `pass_failed`, `stage_error`, `job_dead`, `job_stale`, `job_completed`, `job_requeued`) with job id, stage, attempt and error code. Status endpoint returns a plain-language summary ("Stopped at psychology_report (truncated) with 3 of 4 passes preserved. Retry will resume without repeating them.").

## 8. Cost and operations

Same model work as the synchronous path when nothing fails (4 calls); failures cost one pass instead of up to four. Input tokens are repeated per pass (transcript plus rules) as before. Queues add a per-message cost (five messages per evaluation: four passes and finalize, plus any retries) and one new D1 table pair; confirm current Cloudflare pricing and plan limits before enabling. Quota exhaustion (Workers AI free tier) shows as repeated retryable failures; the job stops after three attempts per stage rather than spinning.

## 9. Required Cloudflare resources (not created)

1. Queue `mrv1-evaluation-jobs` and dead-letter queue `mrv1-evaluation-jobs-dlq`.
2. Producer binding `EVAL_QUEUE` and consumer settings (`max_batch_size 1`, `max_concurrency 1`, `max_retries 5`, `dead_letter_queue`): the commented block in `wrangler.jsonc`.
3. Apply migration `0007` to D1 (and `0006` first, if not yet applied).
4. Optionally `MRV1_ALLOW_SYNC=1` in local `.dev.vars` only.

## 10. Rollback

Remove the queue binding and consumer; the job routes answer 503 and the synchronous route can be re-enabled with `MRV1_ALLOW_SYNC=1`. Migration 0007 only adds two tables; leaving them is harmless and nothing else depends on them. Evaluations already written are ordinary evaluation rows and are unaffected.

## 11. Open decisions

1. Approve creating the queues, applying 0006 and 0007 and deploying.
2. Run the controlled synthetic latency benchmark (`npm run benchmark:live` with the full opt-in) to size pass splits and leases from real numbers.
3. Whether 3 queue-level attempts, the 600 s lease and the backoff curve fit the measured latency.
