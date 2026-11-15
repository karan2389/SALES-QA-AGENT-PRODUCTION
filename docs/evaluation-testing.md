# Testing the evaluation engine

```bash
npm run typecheck
npm run test:mrv1        # MRV1.0: rubric, anchors, scoring, gates, transcript gate, flags, report, validation metrics, persistence
npm run benchmark:mrv1   # offline four-pass benchmark (synthetic, mocked): see docs/mrv1-benchmark-results.md
npm run test:evaluation  # existing C01/C02 pipeline (36)
npm run check:rubric
npm run test:sheets      # idempotent export and MRV1.0 sheet scoring (legacy 16 + 10)
npm run test:score && npm run test:quality && npm run test:transcribe && npm run test:callyzer
```

No test calls Workers AI, Google, Callyzer or Cloudflare. The model is a fake that returns schema-valid JSON (`scripts/mrv1-fixtures.ts`).
Persistence tests (`scripts/mrv1-persistence.test.ts`) run the real migrations 0001-0006 in an in-memory SQLite database through a small D1 adapter (`node:sqlite`). That file is excluded from `tsconfig.scripts.json` because it imports the Workers-only D1 store; it still runs under Node.

## Coverage map

| Area | Where |
|---|---|
| 19 categories, counts, ids, 22 SP, no duplicates, `MRV1.0` | `mrv1.test.ts` rubric tests |
| Scores 0/1/2/3, N/A, NE, mixed, equal weighting, provisional, no combined score | scoring tests |
| New webinar, continuation, unknown/unconfirmed, unsupported, changed call type | applicability tests; persistence "changing the human-confirmed call type" |
| Valid/invalid timestamps, missing/fabricated evidence, speaker, incomplete transcript | engine and evidence tests; gate 2 |
| Flags: false earnings promise, fake urgency, financial pressure, misleading claims, misrepresented support, refusal, fabricated testimonials, protected characteristics | flag tests (all ten ids; lexical candidates for the first three) |
| Existing records preserved, invalidated and test-only excluded, N/A/NE not zero, review status preserved | persistence tests |
| Idempotent Sheets updates | `sheets.test.ts` (unchanged) plus persistence duplicate test |

## Limits of these tests

They prove the plumbing and validation, not model quality. Whether GPT-OSS scores C03-C19 consistently with human reviewers is unmeasured: that needs reviewed real calls, which this task deliberately did not use.
