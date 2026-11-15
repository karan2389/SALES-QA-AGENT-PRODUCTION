# Sheets regression-test baseline

## Can the original `sheets.test.ts` be recovered?

**No.** Evidence:

- The repository had no commit before the full-project commit, and that commit (and the pre-scrub backup bundle) already contain the reconstructed file; the public history was then rewritten. The bundle copy differs from the current file only by the synthetic renames of agent names.
- The reflog and unreachable objects were expired during the history rewrite.
- The only remaining source of the pre-reconstruction file is the session transcript. It was replayed once to rebuild the file. In that replay every edit that "did not apply" was checked: each one is either an edit whose result is already present in the file or one superseded by a later change. So the reconstruction matches the last recorded state of the file, but **exact equivalence to the original cannot be claimed**.

## Audit of current coverage against the implementation

`scripts/sheets.test.ts` (16 tests, fake store and fake Sheets API): worksheet creation and header, N/A as text, idempotent repeats, in-place updates, no deletion and foreign-header protection, dry run, failure isolation per worksheet, authentication failure, concurrent export rejection, agent and evaluation scoping, withdrawn marker, redaction and review fields, Performance Summary columns, service-account parsing, JWT signing, client retries.

Gaps found (the SQL store, the layer most likely to regress, had no direct test) and the tests added:

- `scripts/sheets-store.test.ts` (10 tests, real SQL via SQLite with migrations 0001-0007): end-to-end export through the real store; repeated export leaves agent tabs byte-identical and tracking has exactly one `CALL` row per evaluation; export history rows and no run left `running`; dry run tracks nothing; agent and evaluation filters; test-only and invalidated exclusion and the withdrawn marker; review changes update the row in place and NE is text not zero; a run in progress rejects a concurrent export and a stale lock does not; foreign header conflict leaves other tabs unaffected; exporting never creates evaluations and unsupported-type evaluations are not exported.
- `scripts/sheets-mrv1.test.ts` (10 tests): MRV1.0 scoring on the sheet.

Preserved and tested: the 15-column layout, per-agent worksheets, Performance Summary, idempotent exports, Evaluation ID and criterion-key tracking, test-only and invalidated exclusion, dry run, filters, export history.

No export was executed against Google.
