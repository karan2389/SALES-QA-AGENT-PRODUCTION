// Sheets regression coverage that the fake-store tests cannot give: the REAL D1 export store (SQL) against SQLite with migrations 0001-0006,
// driven end to end by runExport with an in-memory fake of the Google Sheets API. No Google calls, no export, synthetic data only.
// Added in Phase 2 because the original sheets.test.ts could not be recovered (see docs/sheets-test-baseline.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createD1ExportStore } from "../src/sheets/d1-export-store.ts";
import { runExport } from "../src/sheets/export.ts";
import { AGENT_HEADERS, SUMMARY_TAB } from "../src/sheets/rows.ts";
import type { Cell } from "../src/sheets/rows.ts";
import { createMrv1Store } from "../src/mrv1/d1-store.ts";
import { runMrv1Evaluation } from "../src/mrv1/engine.ts";
import { SheetsApiError } from "../src/sheets/sheets-client.ts";
import type { SheetInfo, SheetsApi } from "../src/sheets/sheets-client.ts";
import { AUDIO_BYTES, CALL_SECONDS, SEGMENTS, fakeModel } from "./mrv1-fixtures.ts";

function d1(db: DatabaseSync): any {
  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const stmt: any = {
      bind: (...b: unknown[]) => ((binds = b), stmt),
      run: async () => {
        const r = db.prepare(sql).run(...(binds as any[]));
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
      all: async () => ({ results: db.prepare(sql).all(...(binds as any[])) }),
      first: async () => db.prepare(sql).get(...(binds as any[])) ?? null,
    };
    return stmt;
  };
  return {
    prepare,
    batch: async (stmts: any[]) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

class FakeSheets implements SheetsApi {
  tabs = new Map<string, unknown[][]>();
  writes = 0;
  async listSheets(): Promise<SheetInfo[]> {
    return [...this.tabs.keys()].map((title, i) => ({ title, sheetId: i + 1 }));
  }
  async addSheets(titles: string[]) {
    titles.forEach((t) => this.tabs.set(t, []));
    return titles.map((title, i) => ({ title, sheetId: 100 + i }));
  }
  async formatHeader() {}
  async getValues(range: string) {
    const title = range.split("!")[0].replace(/^'|'$/g, "").replace(/''/g, "'");
    return (this.tabs.get(title) ?? []).map((r) => [...r]);
  }
  async batchUpdateValues(data: Array<{ range: string; values: Cell[][] }>) {
    let rows = 0;
    for (const dd of data) {
      const [sheet, cells] = dd.range.split("!");
      const title = sheet.replace(/^'|'$/g, "").replace(/''/g, "'");
      if (!this.tabs.has(title)) throw new SheetsApiError("http", 400, "no such sheet");
      const start = Number(/^[A-Z]+(\d+)/.exec(cells)![1]);
      const grid = this.tabs.get(title)!;
      dd.values.forEach((v, i) => {
        grid[start - 1 + i] = [...v];
        rows++;
      });
      for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
    }
    this.writes++;
    return { totalUpdatedRows: rows, totalUpdatedCells: 0 };
  }
}

const MIGRATIONS = readdirSync("migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
async function world() {
  const db = new DatabaseSync(":memory:");
  for (const f of MIGRATIONS) db.exec(readFileSync(`migrations/${f}`, "utf8"));
  const segs = JSON.stringify({ segments: SEGMENTS.map((s) => ({ start: s.start, end: s.end, text: s.text })), transcription_info: { language: "en" } });
  for (const [i, name] of [[1, "alpha agent"], [2, "bravo agent"]] as const) {
    db.prepare("INSERT INTO sales_agents (employee_number, employee_name) VALUES (?, ?)").run(`90${i}`, name);
    db.prepare("INSERT INTO calls (callyzer_call_id, sales_agent_id, call_date, duration_seconds, call_type, r2_object_key, audio_size_bytes, processing_status) VALUES (?, ?, '2026-11-01', ?, 'Outgoing', 'k', ?, 'transcribed')").run(`CY-${i}`, i, CALL_SECONDS, AUDIO_BYTES);
    db.prepare("INSERT INTO transcripts (call_id, transcription_model, language, transcript_text, transcription_status, segments_json) VALUES (?, 'whisper', 'en', 't', 'completed', ?)").run(i, segs);
    db.prepare("INSERT INTO call_type_labels (call_id, business_call_type, verification, labelled_by, basis) VALUES (?, 'new_webinar_prospect', 'human_confirmed', 'Owner', 'x')").run(i);
  }
  const ids: number[] = [];
  for (const cy of ["CY-1", "CY-2"]) {
    const r: any = await runMrv1Evaluation({ store: createMrv1Store(d1(db)), model: fakeModel() }, { callyzerCallId: cy });
    assert.equal(r.status, "completed");
    ids.push(r.evaluation_id);
  }
  const sheets = new FakeSheets();
  const store = createD1ExportStore(d1(db));
  const now = () => new Date("2026-11-14T00:00:00Z");
  return { db, ids, sheets, store, run: (req: Parameters<typeof runExport>[1]) => runExport({ store, sheets, now }, req) };
}
const count = (db: DatabaseSync, sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any).n as number;

test("end to end: real SQL store, one row per call on the right agent tab, 15 columns, summary tab", async () => {
  const { sheets, run, ids } = await world();
  const r = await run({ dryRun: false });
  assert.equal(r.status, "success");
  assert.deepEqual([...sheets.tabs.keys()].sort(), [SUMMARY_TAB, "Alpha Agent", "Bravo Agent"].sort());
  for (const tab of ["Alpha Agent", "Bravo Agent"]) {
    const rows = sheets.tabs.get(tab)!;
    assert.deepEqual(rows[0], AGENT_HEADERS);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].length, 15);
    assert.equal(rows[1][7], "66.7% (provisional)"); // MRV1.0 equal-weight score; C01/C02 are NE in this fixture
    assert.equal(rows[1][10], "Provisional");
  }
  assert.equal(sheets.tabs.get("Alpha Agent")![1][0], ids[0]);
  const summary = sheets.tabs.get(SUMMARY_TAB)!;
  assert.equal(summary[0].length, 6);
  assert.ok(summary.slice(1, 3).every((row) => row[1] === 1)); // each agent: one call with a completed transcript
});

test("repeated export is idempotent: nothing new is written and tracking has exactly one CALL row per evaluation", async () => {
  const { db, sheets, run } = await world();
  await run({ dryRun: false });
  const snapshot = JSON.stringify([...sheets.tabs.entries()].filter(([k]) => k !== SUMMARY_TAB));
  const again = await run({ dryRun: false });
  assert.equal(again.status, "success");
  assert.ok(again.worksheets.every((w) => w.appended === 0 && w.updated === 0));
  assert.equal(JSON.stringify([...sheets.tabs.entries()].filter(([k]) => k !== SUMMARY_TAB)), snapshot); // agent tabs byte-identical (the summary tab is rewritten each run by design)
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM sheet_export_rows WHERE criterion_id = 'CALL' AND status = 'exported'"), 2);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM sheet_export_rows"), 2); // Evaluation ID + criterion key tracked, no duplicates
});

test("export history is recorded: one run row per export with counts, none left running", async () => {
  const { db, run } = await world();
  await run({ dryRun: false });
  await run({ dryRun: false });
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM sheet_exports"), 2);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM sheet_exports WHERE status = 'running'"), 0);
  const first = db.prepare("SELECT rows_appended, rows_failed FROM sheet_exports ORDER BY id LIMIT 1").get() as any;
  assert.equal(first.rows_appended, 2);
  assert.equal(first.rows_failed, 0);
});

test("dry run writes nothing and tracks nothing", async () => {
  const { db, sheets, run } = await world();
  const r = await run({ dryRun: true });
  assert.equal(r.dry_run, true);
  assert.equal(sheets.writes, 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM sheet_export_rows"), 0);
});

test("agent and evaluation filters scope the export", async () => {
  const { sheets, run, ids } = await world();
  await run({ dryRun: false, agent: "bravo agent" });
  assert.equal((sheets.tabs.get("Alpha Agent") ?? []).length, 0);
  assert.equal(sheets.tabs.get("Bravo Agent")!.length, 2);
  await run({ dryRun: false, evaluationId: ids[0] });
  assert.equal(sheets.tabs.get("Alpha Agent")!.length, 2);
});

test("test-only and invalidated evaluations are never exported, and one invalidated after export is replaced by a withdrawn marker", async () => {
  const { db, sheets, run, ids } = await world();
  db.prepare("INSERT INTO evaluation_invalidations (evaluation_id, status, reason, invalidated_by) VALUES (?, 'test_only', 't', 'x')").run(ids[1]);
  await run({ dryRun: false });
  assert.ok((sheets.tabs.get("Bravo Agent") ?? [[]]).length <= 1); // no data row was ever exported (at most the header)
  assert.equal(sheets.tabs.get("Alpha Agent")!.length, 2);
  db.prepare("INSERT INTO evaluation_invalidations (evaluation_id, status, reason, invalidated_by) VALUES (?, 'invalidated', 'r', 'x')").run(ids[0]);
  const r = await run({ dryRun: false });
  assert.equal(r.worksheets.find((w) => w.worksheet === "Alpha Agent")!.withdrawn, 1);
  const row = sheets.tabs.get("Alpha Agent")![1];
  assert.equal(row[10], "Withdrawn");
  assert.equal(row[7], "Not published");
  assert.equal(sheets.tabs.get("Alpha Agent")!.length, 2); // updated in place, not duplicated
});

test("human review changes update the existing row in place; N/A and NE are never exported as zero", async () => {
  const { db, sheets, run, ids } = await world();
  await run({ dryRun: false });
  db.prepare("INSERT INTO evaluation_reviews (evaluation_id, reviewer, status, comment) VALUES (?, 'Manager', 'approved', 'ok')").run(ids[0]);
  db.prepare("UPDATE evaluations SET human_review_status = 'approved' WHERE id = ?").run(ids[0]);
  const r = await run({ dryRun: false });
  assert.equal(r.worksheets.find((w) => w.worksheet === "Alpha Agent")!.updated, 1);
  assert.equal(sheets.tabs.get("Alpha Agent")!.length, 2);
  const row = sheets.tabs.get("Alpha Agent")![1];
  assert.equal(row[11], "approved");
  assert.equal(row[13], "Manager");
  assert.ok(!String(row[7]).startsWith("0"));
  assert.ok(String(row[9]).includes("C01-01 Introduce self and team: NE")); // NE shown as text, not 0/3
});

test("a run already in progress rejects a concurrent export; a crashed run (stale lock) does not block", async () => {
  const { db, run } = await world();
  db.prepare("INSERT INTO sheet_exports (scope, status) VALUES ('x', 'running')").run();
  const busy = await run({ dryRun: false });
  assert.equal(busy.status, "busy");
  db.prepare("UPDATE sheet_exports SET started_at = datetime('now','-30 minutes') WHERE status = 'running'").run();
  const ok = await run({ dryRun: false });
  assert.equal(ok.status, "success");
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM sheet_exports WHERE error LIKE 'abandoned%'"), 1);
});

test("a foreign header blocks the write (the existing sheet content is never overwritten)", async () => {
  const { sheets, run } = await world();
  sheets.tabs.set("Alpha Agent", [["my", "own", "notes"], ["keep", "me"]]);
  const r = await run({ dryRun: false });
  assert.equal(r.worksheets.find((w) => w.worksheet === "Alpha Agent")!.status, "conflict");
  assert.deepEqual(sheets.tabs.get("Alpha Agent"), [["my", "own", "notes"], ["keep", "me"]]);
  assert.equal(sheets.tabs.get("Bravo Agent")!.length, 2); // other worksheets are unaffected
});

test("the export path never evaluates anything and unsupported-type evaluations are not exported", async () => {
  const { db, sheets, run } = await world();
  db.prepare("UPDATE call_type_labels SET superseded_at = datetime('now') WHERE call_id = 2").run();
  db.prepare("INSERT INTO call_type_labels (call_id, business_call_type, verification, labelled_by, basis) VALUES (2, 'renewal', 'human_confirmed', 'Owner', 'x')").run();
  db.prepare("INSERT INTO evaluation_invalidations (evaluation_id, status, reason, invalidated_by) SELECT id, 'superseded', 'type changed', 'Owner' FROM evaluations WHERE call_id = 2").run();
  const r: any = await runMrv1Evaluation({ store: createMrv1Store(d1(db)), model: fakeModel() }, { callyzerCallId: "CY-2" });
  assert.equal(r.status, "unsupported");
  const before = count(db, "SELECT COUNT(*) AS n FROM evaluations");
  await run({ dryRun: false });
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM evaluations"), before); // exporting never creates evaluations
  assert.ok((sheets.tabs.get("Bravo Agent") ?? [[]]).length <= 1); // header at most, no data row
});
