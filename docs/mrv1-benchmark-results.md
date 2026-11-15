# MRV1.0 four-pass benchmark (synthetic transcripts, mocked model)

Node v24.14.1. Passes: stages_01_06, stages_07_12, stages_13_19, psychology_report.

## 1. Invocations and sizes per evaluation

| Call length | Segments | Model calls | Prompt tokens, English bound (sum of 4) | Prompt tokens, Devanagari bound (sum of 4) | Output tokens est. (sum of 4) | Largest single output (tokens) | Engine CPU (ms) | Heap growth (MB) |
|---|---|---|---|---|---|---|---|---|
| 10 min | 90 | 4 | 41015 | 109373 | 35008 | 10638 | 31 | 1.5 |
| 20 min | 180 | 4 | 48026 | 128069 | 35008 | 10638 | 6 | 1.1 |
| 30 min | 270 | 4 | 55046 | 146789 | 35008 | 10638 | 11 | 4.4 |
| 45 min | 405 | 4 | 65576 | 174869 | 35008 | 10638 | 12 | -0.1 |

Per pass, 45-minute call:

| Pass | Prompt chars | Output chars (mock) | Output tokens est. | Share of 20,000-token output cap (incl. reasoning) |
|---|---|---|---|---|
| stages_01_06 | 84875 | 38107 | 9527 | 48% (before reasoning tokens) |
| stages_07_12 | 60781 | 23722 | 5931 | 30% (before reasoning tokens) |
| stages_13_19 | 74259 | 42550 | 10638 | 53% (before reasoning tokens) |
| psychology_report | 42389 | 35654 | 8914 | 45% (before reasoning tokens) |

## 2. Wall-clock under ASSUMED model speeds (not measured)

Latency per pass = prompt_tokens / prefill_rate + (output_tokens + reasoning_tokens) / decode_rate. Reasoning tokens are assumed equal to the visible output (reasoning_effort=medium). Real values must come from a controlled test on approved recordings.

| Scenario | Decode tok/s | 20 min call, total (s) | Slowest pass (s) | 45 min call, total (s) | Slowest pass (s) | Worst case with one retry per pass (s) |
|---|---|---|---|---|---|---|
| fast | 100 | 743 | 225 | 758 | 229 | 1517 (hard ceiling 4 x 2 x 280 = 2240) |
| typical | 50 | 1486 | 451 | 1517 | 459 | 2240 (hard ceiling 4 x 2 x 280 = 2240) |
| slow | 20 | 3661 | 1111 | 3720 | 1126 | 2240 (hard ceiling 4 x 2 x 280 = 2240) |

## 3. Behaviour under failure (mocked)

| Scenario | Model calls made | Result | Rows stored | Work lost |
|---|---|---|---|---|
| transient failure on the first call (retry succeeds) | 5 | completed | 1 | none |
| invalid JSON on the 4th pass, both attempts | 5 | failed (malformed_json, pass psychology_report) | 0 | 3 completed pass(es) discarded; whole evaluation must be re-run |
| model always fails | 2 | failed (model_error, pass stages_01_06) | 0 | 0 completed pass(es) discarded; whole evaluation must be re-run |

## 4. Findings

- Engine CPU time is 31 ms at most for a 45-minute transcript, and heap growth is a few MB: validation and scoring are not a constraint.
- Every evaluation makes exactly 4 model calls; each re-attempt repeats a whole pass. A failure in any pass discards all earlier passes (no checkpoint).
- The binding limit is model latency, which this offline benchmark cannot measure. The timeout is 280 s per call, so the ceiling is 4 x 280 s = 1120 s (2240 s with one retry per pass) while one HTTP request stays open.
- Output budget: the largest pass is well below the 20,000-token cap before reasoning tokens, but reasoning tokens share that cap; a truncation is NOT retried and fails the whole evaluation.
