// Idempotent export of VALID evaluations from D1 to Google Sheets. D1 is authoritative; the sheet is a reporting copy.
//
// Idempotency: each sheet row (one per evaluated call) is identified by its Evaluation ID, column A of the agent worksheet.
// On every export the existing worksheet is read, rows are matched by that key, identical rows are skipped, changed rows are
// updated in place, and only genuinely new rows are appended. Rows of evaluations that are no longer valid are overwritten with a
// "withdrawn" marker (never left showing an invalid score). Writes are confirmed by Google before anything is marked exported.
import { GoogleAuthError } from "./google-auth.ts";
import { AGENT_HEADERS, CALL_ROW_KEY, COLUMN_COUNT, COL_EVALUATION_ID, LAST_COLUMN, SUMMARY_HEADERS, SUMMARY_TAB, buildAgentRow, buildSummaryValues, buildWithdrawnRow, rowsEqual, titleCase } from "./rows.ts";
import type { Cell, ExportRecord, SummaryStat } from "./rows.ts";
import { SheetsApiError, quoteSheet } from "./sheets-client.ts";
import type { SheetInfo, SheetsApi } from "./sheets-client.ts";
import { sha256Hex } from "../evaluation/transcript.ts";

export interface AgentRef {
  id: number;
  name: string;
}
export interface TrackedRow {
  evaluation_id: number;
  criterion_id: string;
  worksheet: string;
  row_number: number | null;
  status: string;
}
export interface TrackEntry {
  evaluationId: number;
  criterionId: string;
  worksheet: string;
  rowNumber: number | null;
  rowHash: string | null;
  status: "exported" | "failed" | "withdrawn";
  error?: string | null;
}
export interface RunCounts {
  appended: number;
  updated: number;
  skipped: number;
  withdrawn: number;
  failed: number;
}
export interface ExportStore {
  listAgents(): Promise<AgentRef[]>;
  /** Valid (non-invalidated) criterion results only: read from valid_evaluations / valid_evaluation_criteria. */
  loadRecords(filter: { agentId?: number; evaluationId?: number }): Promise<ExportRecord[]>;
  validEvaluationIds(): Promise<Set<number>>;
  loadSummaryStats(): Promise<SummaryStat[]>;
  loadTrackedRows(worksheet: string): Promise<TrackedRow[]>;
  recordRows(entries: TrackEntry[], runId: number): Promise<void>;
  /** Returns null if another export is already running (duplicate-request lock). */
  startRun(scope: string): Promise<number | null>;
  finishRun(runId: number, status: "success" | "partial" | "failed", counts: RunCounts, error: string | null): Promise<void>;
}
export interface ExportDeps {
  store: ExportStore;
  sheets: SheetsApi;
  now?: () => Date;
}
export interface ExportRequest {
  dryRun: boolean;
  agent?: string | null;
  evaluationId?: number | null;
}
export interface WorksheetResult extends RunCounts {
  worksheet: string;
  status: "ok" | "planned" | "conflict" | "failed";
  would_create_worksheet?: boolean;
  error?: string;
  notes?: string[];
}
export interface ExportResult {
  status: "success" | "partial" | "failed" | "dry_run" | "busy" | "rejected";
  dry_run: boolean;
  scope: string;
  run_id: number | null;
  worksheets: WorksheetResult[];
  summary_tab: { status: "ok" | "planned" | "conflict" | "failed"; error?: string; agents: number } | null;
  created_worksheets: string[];
  error?: string;
}

export function describeError(e: unknown): string {
  if (e instanceof GoogleAuthError) return `google auth (${e.kind}): ${e.message}`;
  if (e instanceof SheetsApiError) return `google sheets (${e.kind}): ${e.message}`;
  return e instanceof Error ? e.message.slice(0, 200) : "unknown error";
}

const emptyCounts = (): RunCounts => ({ appended: 0, updated: 0, skipped: 0, withdrawn: 0, failed: 0 });
const isBlank = (v: unknown) => v === undefined || v === null || v === "";

export async function runExport(deps: ExportDeps, req: ExportRequest): Promise<ExportResult> {
  const now = deps.now ?? (() => new Date());
  const { store, sheets } = deps;
  const agents = await store.listAgents();
  let scoped = agents;
  if (req.agent) {
    const q = req.agent.trim().toLowerCase();
    scoped = agents.filter((a) => String(a.id) === q || a.name.trim().toLowerCase() === q || titleCase(a.name).toLowerCase() === q);
    if (scoped.length === 0) return { status: "rejected", dry_run: req.dryRun, scope: `agent:${req.agent}`, run_id: null, worksheets: [], summary_tab: null, created_worksheets: [], error: "no sales agent matches that name or id" };
  }
  const scope = [req.agent ? `agent:${titleCase(scoped[0].name)}` : "all agents", req.evaluationId ? `evaluation:${req.evaluationId}` : null].filter(Boolean).join(", ");
  const base: Pick<ExportResult, "dry_run" | "scope"> = { dry_run: req.dryRun, scope };

  // Valid data only, from D1.
  const records = await store.loadRecords({ agentId: req.agent ? scoped[0].id : undefined, evaluationId: req.evaluationId ?? undefined });
  const validIds = await store.validEvaluationIds();

  const runId = req.dryRun ? null : await store.startRun(scope);
  if (!req.dryRun && runId === null) return { ...base, status: "busy", run_id: null, worksheets: [], summary_tab: null, created_worksheets: [], error: "another export is already running; try again in a few minutes" };

  const results: WorksheetResult[] = [];
  const totals = emptyCounts();
  let summary: ExportResult["summary_tab"] = null;
  const created: string[] = [];
  let fatal: string | null = null;

  try {
    // 1. Connect (this is where a failed Google authentication or an unshared spreadsheet is detected) and make sure worksheets exist.
    let existing: SheetInfo[];
    try {
      existing = await sheets.listSheets();
    } catch (e) {
      fatal = describeError(e);
      throw e;
    }
    const sheetIds = new Map(existing.map((s) => [s.title, s.sheetId]));
    const required = [SUMMARY_TAB, ...agents.map((a) => titleCase(a.name))];
    const missing = required.filter((t) => !sheetIds.has(t));
    if (!req.dryRun && missing.length > 0) {
      try {
        for (const s of await sheets.addSheets(missing)) {
          sheetIds.set(s.title, s.sheetId);
          created.push(s.title);
          try {
            await sheets.formatHeader(s.sheetId, s.title === SUMMARY_TAB ? SUMMARY_HEADERS.length : COLUMN_COUNT);
          } catch {
            /* cosmetic only */
          }
        }
      } catch (e) {
        fatal = `could not create worksheets (${missing.join(", ")}): ${describeError(e)}`;
        throw e;
      }
    }

    // 2. One worksheet per agent; a failure in one worksheet never affects another.
    for (const agent of scoped) {
      const title = titleCase(agent.name);
      try {
        results.push(await exportAgentTab({ store, sheets, runId, dryRun: req.dryRun, title, agent, records, validIds, evaluationId: req.evaluationId ?? null, exists: sheetIds.has(title) }));
      } catch (e) {
        results.push({ worksheet: title, status: "failed", ...emptyCounts(), error: describeError(e) });
      }
    }

    // 3. Summary (always from the valid views; rewritten in full, so repeating it cannot duplicate anything).
    try {
      summary = await exportSummary({ store, sheets, dryRun: req.dryRun, now, exists: sheetIds.has(SUMMARY_TAB) });
    } catch (e) {
      summary = { status: "failed", error: describeError(e), agents: agents.length };
    }
  } catch (e) {
    fatal = fatal ?? describeError(e);
  }

  for (const r of results) for (const k of Object.keys(totals) as Array<keyof RunCounts>) totals[k] += r[k];
  const bad = results.filter((r) => r.status === "failed" || r.status === "conflict").length + (summary && (summary.status === "failed" || summary.status === "conflict") ? 1 : 0);
  const good = results.filter((r) => r.status === "ok" || r.status === "planned").length + (summary && (summary.status === "ok" || summary.status === "planned") ? 1 : 0);
  const status: ExportResult["status"] = req.dryRun ? (fatal ? "failed" : "dry_run") : fatal || good === 0 ? "failed" : bad > 0 ? "partial" : "success";
  if (runId !== null && status !== "dry_run") await store.finishRun(runId, status as "success" | "partial" | "failed", totals, fatal ?? (bad > 0 ? `${bad} worksheet(s) not exported` : null));
  return { ...base, status, run_id: runId, worksheets: results, summary_tab: summary, created_worksheets: created, ...(fatal ? { error: fatal } : {}) };
}

interface TabArgs {
  store: ExportStore;
  sheets: SheetsApi;
  runId: number | null;
  dryRun: boolean;
  title: string;
  agent: AgentRef;
  records: ExportRecord[];
  validIds: Set<number>;
  evaluationId: number | null;
  exists: boolean;
}

async function exportAgentTab(a: TabArgs): Promise<WorksheetResult> {
  const q = quoteSheet(a.title);
  const values = a.exists ? await a.sheets.getValues(`${q}!A1:${LAST_COLUMN}`) : [];
  const header = (values[0] ?? []) as unknown[];
  const headerEmpty = header.every(isBlank);
  if (!headerEmpty && !rowsEqual(AGENT_HEADERS, header)) {
    return { worksheet: a.title, status: "conflict", ...emptyCounts(), error: "row 1 of this worksheet is not the expected header; nothing was written so existing content is preserved" };
  }
  const byKey = new Map<string, { row: number; cells: unknown[] }>();
  let duplicateKeys = 0;
  for (let i = 1; i < values.length; i++) {
    const r = values[i] ?? [];
    if (isBlank(r[COL_EVALUATION_ID])) continue;
    const key = String(r[COL_EVALUATION_ID]);
    if (byKey.has(key)) duplicateKeys++;
    else byKey.set(key, { row: i + 1, cells: r });
  }
  const nextRow = Math.max(values.length, 1) + 1;

  const counts = emptyCounts();
  const track: TrackEntry[] = [];
  const updates: Array<{ row: number; cells: Cell[]; entry: TrackEntry; withdrawn: boolean }> = [];
  const appends: Array<{ cells: Cell[]; entry: TrackEntry }> = [];

  for (const rec of a.records.filter((r) => r.agent_id === a.agent.id)) {
    const cells = buildAgentRow(rec);
    const hash = await sha256Hex(JSON.stringify(cells));
    const key = String(rec.evaluation_id);
    const hit = byKey.get(key);
    const entry: TrackEntry = { evaluationId: rec.evaluation_id, criterionId: CALL_ROW_KEY, worksheet: a.title, rowNumber: hit?.row ?? null, rowHash: hash, status: "exported" };
    if (hit && rowsEqual(cells, hit.cells)) {
      counts.skipped++;
      track.push(entry);
    } else if (hit) updates.push({ row: hit.row, cells, entry, withdrawn: false });
    else appends.push({ cells, entry });
  }

  // Rows of evaluations that were exported earlier but are no longer valid are overwritten with a withdrawn marker.
  const tracked = (await a.store.loadTrackedRows(a.title)).filter((t) => t.status === "exported" && !a.validIds.has(t.evaluation_id) && (a.evaluationId === null || t.evaluation_id === a.evaluationId));
  for (const t of tracked) {
    const cells = buildWithdrawnRow(t.evaluation_id);
    const hit = byKey.get(String(t.evaluation_id));
    const entry: TrackEntry = { evaluationId: t.evaluation_id, criterionId: CALL_ROW_KEY, worksheet: a.title, rowNumber: hit?.row ?? null, rowHash: null, status: "withdrawn" };
    if (!hit || rowsEqual(cells, hit.cells)) {
      counts.withdrawn++;
      track.push(entry);
    } else updates.push({ row: hit.row, cells, entry, withdrawn: true });
  }

  const planned = { appended: appends.length, updated: updates.filter((u) => !u.withdrawn).length, withdrawn: counts.withdrawn + updates.filter((u) => u.withdrawn).length, skipped: counts.skipped, failed: 0 };
  const notes = duplicateKeys > 0 ? [`${duplicateKeys} duplicate key row(s) found in the sheet and ignored (the first occurrence is used)`] : [];
  if (a.dryRun) return { worksheet: a.title, status: "planned", ...planned, would_create_worksheet: !a.exists, notes };

  const data: Array<{ range: string; values: Cell[][] }> = [];
  if (headerEmpty) data.push({ range: `${q}!A1:${LAST_COLUMN}1`, values: [AGENT_HEADERS] });
  for (const u of updates) data.push({ range: `${q}!A${u.row}:${LAST_COLUMN}${u.row}`, values: [u.cells] });
  if (appends.length > 0) data.push({ range: `${q}!A${nextRow}:${LAST_COLUMN}${nextRow + appends.length - 1}`, values: appends.map((x) => x.cells) });

  if (data.length > 0) {
    const expectedRows = data.reduce((n, d) => n + d.values.length, 0);
    try {
      const resp = await a.sheets.batchUpdateValues(data);
      if (resp.totalUpdatedRows < expectedRows) throw new SheetsApiError("unconfirmed", 200, `Google confirmed ${resp.totalUpdatedRows} of ${expectedRows} rows`);
    } catch (e) {
      const msg = describeError(e);
      const failedEntries: TrackEntry[] = [...updates.map((u) => u.entry), ...appends.map((x, i) => ({ ...x.entry, rowNumber: nextRow + i }))].map((en) => ({ ...en, status: "failed" as const, error: msg }));
      if (a.runId !== null) await a.store.recordRows(failedEntries, a.runId);
      return { worksheet: a.title, status: "failed", appended: 0, updated: 0, skipped: counts.skipped, withdrawn: counts.withdrawn, failed: failedEntries.length, error: msg, notes };
    }
  }
  appends.forEach((x, i) => (x.entry.rowNumber = nextRow + i));
  const all = [...track, ...updates.map((u) => u.entry), ...appends.map((x) => x.entry)];
  if (a.runId !== null && all.length > 0) await a.store.recordRows(all, a.runId);
  return { worksheet: a.title, status: "ok", ...planned, notes };
}

async function exportSummary(a: { store: ExportStore; sheets: SheetsApi; dryRun: boolean; now: () => Date; exists: boolean }): Promise<NonNullable<ExportResult["summary_tab"]>> {
  const stats = await a.store.loadSummaryStats();
  const q = quoteSheet(SUMMARY_TAB);
  const first = a.exists ? await a.sheets.getValues(`${q}!A1:F2`) : [];
  const a1 = first[0]?.[0];
  if (!isBlank(a1) && a1 !== SUMMARY_HEADERS[0]) return { status: "conflict", agents: stats.length, error: "the Performance Summary worksheet already contains other content; nothing was written" };
  if (a.dryRun) return { status: "planned", agents: stats.length };
  const values = buildSummaryValues(stats, a.now().toISOString());
  const resp = await a.sheets.batchUpdateValues([{ range: `${q}!A1:F${values.length}`, values }]);
  if (resp.totalUpdatedRows < values.filter((r) => r.length > 0).length) throw new SheetsApiError("unconfirmed", 200, "Google did not confirm the summary write");
  return { status: "ok", agents: stats.length };
}
