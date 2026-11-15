# Sales QA Agent (Phase 1)

Cloudflare Workers + D1 + R2 + Workers AI pipeline that evaluates sales-call recordings from Callyzer and exports results to Google Sheets (one tab per agent).

Status: **foundation only**. No Callyzer integration, D1 schema or pipeline logic yet.

## Prerequisites
- Node.js 20+ (tested on 24.x), npm
- A Cloudflare account with Workers AI, D1 and R2 enabled

## Setup
```bash
npm install
npx wrangler login        # or set CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in your shell
npx wrangler d1 create <db-name>
npx wrangler r2 bucket create <bucket-name>
```
Paste the D1 `database_id`, database name and R2 bucket name into `wrangler.jsonc` (replace `REPLACE_ME`).

## Secrets
- Local dev: create `.dev.vars` (gitignored) with the values the Worker needs (see `.env.example`).
- Deployed: `npx wrangler secret put <NAME>`.
- `.env` and `.dev.vars` are gitignored. Never commit credentials or service-account JSON.

## Development
```bash
npm run typecheck
npm run dev       # wrangler dev (local bindings; Workers AI calls are remote)
npm run deploy
```

## Bindings
| Binding | Type | Purpose |
|---|---|---|
| `AI` | Workers AI | Whisper large-v3-turbo + evaluation LLM |
| `DB` | D1 | Call metadata, transcripts, evaluations |
| `RECORDINGS` | R2 | Audio storage |

## Evaluation (Phase 1 prototype)
Evaluates one transcribed call against Category 01 (Introduction) and Category 02 (Understanding Intent) of `docs/evaluation-rubric-v1.md` with `@cf/openai/gpt-oss-120b` through the `AI` binding. Categories 03-19 are reported as `not_evaluated`. No overall or weighted score is computed.
```bash
npm run check:rubric          # confirm the rubric digest matches the approved document
npm run test:evaluation       # offline tests (no model, no database)
npm run dev                   # in one terminal (remote D1 and Workers AI)
npm run evaluate:call -- --agent 1 --call-type new_webinar_prospect --labelled-by "<your name>" --dry-run   # pre-flight, no model use
npm run evaluate:call -- --agent 1 --call-type new_webinar_prospect --labelled-by "<your name>"             # evaluate and store
```
- The call type must be a human-confirmed label (`new_webinar_prospect`, `follow_up`, `renewal`, `continuation`, `support_existing_customer`, `no_conversation`, `other_unclassified`). Missing means HOLD; non-prospect types are stored as N/A without using the model.
- `--transcript experiment:<label>` evaluates a stored whole-call experiment transcript read-only instead of the production transcript.
- `--replace` re-runs an evaluation whose human review is still `pending`; `--acknowledge-conflict` stores a result after a human has seen a suspected call-type conflict.
- Results go to D1 tables `evaluations`, `evaluation_criteria` and `evaluation_reviews` (migration `0003_evaluations.sql`). Human review status defaults to `pending`.
### Call-type labels and invalid evaluations
```bash
npm run label:call -- --agent 1 --call-type continuation --labelled-by "<who confirmed>" --basis "<what it rests on>"     # human-confirmed label (supersedes the previous active one; history is kept)
npm run label:call -- --invalidate <evaluation id> --status test_only --reason "<why>" --by "<who>"                     # mark an evaluation not valid; it is kept, never deleted
```
- A call with a confirmed label cannot be evaluated as a different type until a new human-confirmed label is recorded. Types other than `new_webinar_prospect` are stored as N/A without using the model.
- Manager-facing reporting (e.g. the Sheets export) must read the views `valid_evaluations` and `valid_evaluation_criteria`, which exclude invalidated evaluations (migration `0004_call_type_labels_and_invalidations.sql`).
## Transcription (all calls)

`npm run transcribe:calls` (needs `npm run dev` running) transcribes agents 2-5 through `/admin/transcribe/<id>`; agent 1 is never touched. It is idempotent: a call that already has a completed transcript is skipped, a failure in one call does not stop the others, and a failed call is retried once. Segments and word timestamps are stored in `transcripts.segments_json`. Call types for newly transcribed calls are listed in `docs/call-type-confirmation-needed.md`; do not evaluate a call before its type is confirmed with `npm run label:call`.

## Human review

```
POST /admin/evaluation/<id>/review?status=in_review|approved|changes_requested&reviewer=<name>[&comment=<text>]   (Authorization: Bearer <ADMIN_TOKEN>)
```

Stored in `evaluation_reviews` and mirrored in `evaluations.human_review_status` (default `pending`). The model output is never modified and the Sheets export never changes review status.

## Google Sheets export

The Worker writes valid evaluations (`valid_evaluations` / `valid_evaluation_criteria` only) to the existing spreadsheet: tab "Performance Summary" plus one tab per agent (one row per evaluated call: Evaluation ID, Call ID, Agent Name, Call Date, Call Duration, Call Direction, Call Type, Overall Call Score, Transcript (full timestamped transcript, phone-number-like digit runs masked), Feedback, Evaluation Status, Human Review Status, Reviewer Comments, Reviewer Name, Review Date). It signs a service-account JWT with WebCrypto, so no Google library is needed. D1 stays authoritative; rows are matched by Evaluation ID, so repeated exports update in place and never append duplicates. Progress is tracked in `sheet_exports` and `sheet_export_rows` (migration 0005).

Local setup (values are never printed):

```
npm run google:check        # validates the key in .env, prints only the service-account email
npm run google:sync-dev     # writes a single-line GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_SPREADSHEET_ID into .dev.vars (gitignored)
```

Deployment secrets (run once; the key is piped, never shown):

```
node scripts/google-credentials.ts print-json | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
node scripts/google-credentials.ts print-spreadsheet-id | npx wrangler secret put GOOGLE_SPREADSHEET_ID
npx wrangler secret put ADMIN_TOKEN
```

The spreadsheet must be shared with the service-account email as Editor.

Export (all use `Authorization: Bearer <ADMIN_TOKEN>`):

```
POST /admin/export/google-sheets?dry_run=1                  # plan only, writes nothing
POST /admin/export/google-sheets                            # full export
POST /admin/export/google-sheets?agent=Alpha                # one agent (name or D1 agent id)
POST /admin/export/google-sheets?evaluation_id=4            # one evaluation
```

Overall Call Score = sum of applicable criterion scores / (3 x applicable evaluated criteria) x 100, Categories 01 and 02 only; N/A and NE are excluded (never zero); all-N/A shows "N/A"; incomplete, invalidated, test-only or transcript-blocked evaluations show "Not published". It is a Phase 1 rubric score, not a conversion measure.

Tests: `npm run test:sheets`, `npm run test:score`.



