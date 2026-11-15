import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { runExport } from "../src/sheets/export.ts";
import type { AgentRef, ExportStore, RunCounts, TrackEntry, TrackedRow } from "../src/sheets/export.ts";
import { AGENT_HEADERS, SUMMARY_TAB, buildAgentRow } from "../src/sheets/rows.ts";
import type { Cell, ExportRecord, SummaryStat } from "../src/sheets/rows.ts";
import { SheetsApiError, createSheetsClient } from "../src/sheets/sheets-client.ts";
import type { SheetInfo, SheetsApi } from "../src/sheets/sheets-client.ts";
import { GoogleAuthError, buildJwtAssertion, clearTokenCache, getAccessToken, parseServiceAccount } from "../src/sheets/google-auth.ts";

// ---------- fakes ----------
class FakeSheets implements SheetsApi {
  tabs = new Map<string, unknown[][]>();
  writes = 0;
  failWriteFor: string | null = null;
  failList: Error | null = null;
  constructor(titles: string[] = []) {
    titles.forEach((t) => this.tabs.set(t, []));
  }
  async listSheets(): Promise<SheetInfo[]> {
    if (this.failList) throw this.failList;
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
    for (const d of data) {
      const [sheet, cells] = d.range.split("!");
      const title = sheet.replace(/^'|'$/g, "").replace(/''/g, "'");
      if (this.failWriteFor === title) throw new SheetsApiError("http", 500, "boom");
      const start = Number(/^[A-Z]+(\d+)/.exec(cells)![1]);
      const grid = this.tabs.get(title)!;
      d.values.forEach((v, i) => {
        grid[start - 1 + i] = [...v];
        rows++;
      });
      for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
    }
    this.writes++;
    return { totalUpdatedRows: rows, totalUpdatedCells: 0 };
  }
}

const IDS = [["C01-01", "C01"], ["C01-02", "C01"], ["C01-03", "C01"], ["C02-01", "C02"], ["C02-02", "C02"], ["C02-03", "C02"], ["C02-04", "C02"], ["C02-05", "C02"], ["C02-06", "C02"]];
function criteria(outcomes: string[]) {
  return IDS.map(([criterion_id, category_id], i) => {
    const o = outcomes[i];
    const na = o === "N/A";
    return {
      criterion_id, category_id, criterion_name: `Criterion ${criterion_id}`, outcome: o, score: /^[0-3]$/.test(o) ? Number(o) : null, applicable_status: na ? "not_applicable" : "applicable",
      reason_code: na ? "call_type_not_covered" : null, explanation: "fine",
      evidence_json: na || o === "NE" ? "[]" : JSON.stringify([{ start_s: 5, end_s: 9, quote: "hello, call me on 9876543210", speaker: "agent" }]),
    };
  });
}
function rec(over: Partial<ExportRecord> & { evaluation_id: number; agent_id: number; agent_name: string }, outcomes: string[] = ["2", "2", "2", "2", "2", "2", "N/A", "N/A", "N/A"]): ExportRecord {
  return {
    call_ext_id: `c${over.evaluation_id}`, call_date: "2026-11-01", duration_seconds: 125, direction: "Outgoing", call_type_label: "new_webinar_prospect",
    human_review_status: "pending", coaching_json: JSON.stringify({ key_strengths: [{ text: "Warm greeting" }], missed_opportunities: [], improvement_recommendations: [{ text: "Ask the purpose" }], critical_flags: [] }),
    applicability_reason: null, state: "valid",
    transcript_segments_json: JSON.stringify([{ i: 1, s: 65, t: " second line" }, { i: 0, s: 5, t: " hello, call me on 9876543210" }]), criteria: criteria(outcomes), reviewer: null, review_comment: null, reviewed_at: null, ...over,
  };
}

class FakeStore implements ExportStore {
  agents: AgentRef[] = [{ id: 1, name: "Alpha" }, { id: 2, name: "bravo" }];
  records: ExportRecord[] = [];
  valid = new Set<number>();
  tracked = new Map<string, TrackedRow>();
  runs: Array<{ scope: string; status: string }> = [];
  busy = false;
  async listAgents() { return this.agents; }
  async loadRecords(f: { agentId?: number; evaluationId?: number }) {
    return this.records.filter((r) => this.valid.has(r.evaluation_id) && (f.agentId === undefined || r.agent_id === f.agentId) && (f.evaluationId === undefined || r.evaluation_id === f.evaluationId));
  }
  async validEvaluationIds() { return this.valid; }
  async loadSummaryStats(): Promise<SummaryStat[]> {
    return this.agents.map((a) => ({ agent_name: a.name, calls_processed: 1, eligible_evaluations: 0, na_calls: 1, pending_reviews: 0, reviewed_evaluations: 0 }));
  }
  async loadTrackedRows(ws: string) { return [...this.tracked.values()].filter((t) => t.worksheet === ws); }
  async recordRows(entries: TrackEntry[]) {
    for (const e of entries) this.tracked.set(`${e.evaluationId}|${e.criterionId}|${e.worksheet}`, { evaluation_id: e.evaluationId, criterion_id: e.criterionId, worksheet: e.worksheet, row_number: e.rowNumber, status: e.status });
  }
  async startRun(scope: string) {
    if (this.busy) return null;
    this.runs.push({ scope, status: "running" });
    return this.runs.length;
  }
  async finishRun(id: number, status: "success" | "partial" | "failed", _c: RunCounts) { this.runs[id - 1].status = status; }
}

function setup() {
  const store = new FakeStore();
  store.records = [
    rec({ evaluation_id: 10, agent_id: 1, agent_name: "Alpha", call_type_label: "continuation", applicability_reason: "call_type_not_covered", coaching_json: null }, Array(9).fill("N/A")),
    rec({ evaluation_id: 11, agent_id: 2, agent_name: "bravo" }),
    rec({ evaluation_id: 99, agent_id: 2, agent_name: "bravo" }, Array(9).fill("3")), // test-only / invalidated, not in valid set
  ];
  store.valid = new Set([10, 11]);
  const sheets = new FakeSheets();
  const now = () => new Date("2026-11-14T00:00:00Z");
  return { store, sheets, run: (req: Parameters<typeof runExport>[1]) => runExport({ store, sheets, now }, req) };
}

// ---------- tests ----------
test("worksheets are created, rows go to the correct agent tab, header matches the spec", async () => {
  const { sheets, run } = setup();
  const r = await run({ dryRun: false });
  assert.equal(r.status, "success");
  assert.deepEqual([...sheets.tabs.keys()].sort(), [SUMMARY_TAB, "Bravo", "Alpha"].sort());
  assert.deepEqual(sheets.tabs.get("Alpha")![0], AGENT_HEADERS);
  assert.deepEqual(AGENT_HEADERS, ["Evaluation ID", "Call ID", "Agent Name", "Call Date", "Call Duration", "Call Direction", "Call Type", "Overall Call Score", "Transcript", "Feedback", "Evaluation Status", "Human Review Status", "Reviewer Comments", "Reviewer Name", "Review Date"]);
  assert.equal(sheets.tabs.get("Alpha")!.length, 2); // header + one row for the call
  assert.equal(sheets.tabs.get("Bravo")!.length, 2);
  assert.ok(sheets.tabs.get("Alpha")!.slice(1).every((row) => row[2] === "Alpha"));
  assert.ok(sheets.tabs.get("Bravo")!.slice(1).every((row) => row[2] === "Bravo"));
});

test("N/A is exported as text, never zero; invalid evaluations are excluded", async () => {
  const { sheets, run } = setup();
  await run({ dryRun: false });
  const alpha = sheets.tabs.get("Alpha")!.slice(1);
  assert.equal(alpha.length, 1);
  assert.equal(alpha[0][6], "continuation");
  assert.equal(alpha[0][7], "N/A"); // Overall Call Score: never 0%
  assert.equal(alpha[0][10], "N/A"); // Evaluation Status
  assert.ok(!String(alpha[0][7]).includes("0"));
  const bravo = sheets.tabs.get("Bravo")!.slice(1);
  assert.ok(!bravo.some((row) => row[0] === 99));
  assert.ok(![...sheets.tabs.values()].flat().some((row) => row[0] === 99));
});

test("repeated export creates no duplicates and writes nothing new", async () => {
  const { sheets, run } = setup();
  await run({ dryRun: false });
  const snapshot = JSON.stringify([...sheets.tabs.entries()]);
  const writesBefore = sheets.writes;
  const again = await run({ dryRun: false });
  const t = again.worksheets.find((w) => w.worksheet === "Alpha")!;
  assert.equal(t.appended, 0);
  assert.equal(t.skipped, 1);
  assert.equal(sheets.tabs.get("Alpha")!.length, 2);
  assert.equal(JSON.stringify([...sheets.tabs.entries()]).replace(/Last updated[^"]*/g, ""), snapshot.replace(/Last updated[^"]*/g, ""));
  assert.ok(sheets.writes >= writesBefore); // summary is rewritten in full; agent tabs untouched
});

test("changed D1 data updates the existing row in place", async () => {
  const { store, sheets, run } = setup();
  await run({ dryRun: false });
  store.records[1] = rec({ evaluation_id: 11, agent_id: 2, agent_name: "bravo", human_review_status: "approved", reviewer: "Reviewer", reviewed_at: "2026-11-05" });
  const r = await run({ dryRun: false });
  assert.equal(r.worksheets.find((w) => w.worksheet === "Bravo")!.updated, 1);
  assert.equal(sheets.tabs.get("Bravo")!.length, 2);
  assert.equal(sheets.tabs.get("Bravo")![1][11], "approved");
  assert.equal(sheets.tabs.get("Bravo")![1][13], "Reviewer");
});

test("existing sheet data is never deleted and a foreign header blocks the write", async () => {
  const { sheets, run } = setup();
  sheets.tabs.set("Alpha", [["my", "own", "notes"], ["keep", "me"]]);
  const r = await run({ dryRun: false });
  assert.equal(r.status, "partial");
  assert.equal(r.worksheets.find((w) => w.worksheet === "Alpha")!.status, "conflict");
  assert.deepEqual(sheets.tabs.get("Alpha"), [["my", "own", "notes"], ["keep", "me"]]);
  assert.equal(sheets.tabs.get("Bravo")!.length, 2); // other worksheet unaffected
});

test("dry run writes nothing and creates nothing", async () => {
  const { sheets, store, run } = setup();
  const r = await run({ dryRun: true });
  assert.equal(r.status, "dry_run");
  assert.equal(sheets.tabs.size, 0);
  assert.equal(sheets.writes, 0);
  assert.equal(store.tracked.size, 0);
  assert.equal(store.runs.length, 0);
  assert.equal(r.worksheets.find((w) => w.worksheet === "Alpha")!.appended, 1);
  assert.equal(r.worksheets.find((w) => w.worksheet === "Alpha")!.would_create_worksheet, true);
});

test("a failure in one worksheet does not stop the others, and nothing failed is marked exported", async () => {
  const { sheets, store, run } = setup();
  sheets.tabs.set("Alpha", []);
  sheets.tabs.set("Bravo", []);
  sheets.tabs.set(SUMMARY_TAB, []);
  sheets.failWriteFor = "Alpha";
  const r = await run({ dryRun: false });
  assert.equal(r.status, "partial");
  assert.equal(r.worksheets.find((w) => w.worksheet === "Alpha")!.status, "failed");
  assert.equal(r.worksheets.find((w) => w.worksheet === "Bravo")!.status, "ok");
  assert.ok([...store.tracked.values()].filter((t) => t.worksheet === "Alpha").every((t) => t.status === "failed"));
  // recovery: the next run exports the missing rows
  sheets.failWriteFor = null;
  const again = await run({ dryRun: false });
  assert.equal(again.status, "success");
  assert.equal(sheets.tabs.get("Alpha")!.length, 2);
});

test("authentication / access failure is reported and marks the run failed", async () => {
  const { sheets, store, run } = setup();
  sheets.failList = new SheetsApiError("auth", 403, "Google Sheets refused access (HTTP 403)");
  const r = await run({ dryRun: false });
  assert.equal(r.status, "failed");
  assert.match(r.error ?? "", /refused access/);
  assert.equal(store.runs[0].status, "failed");
});

test("a concurrent export is rejected (duplicate request)", async () => {
  const { store, run } = setup();
  store.busy = true;
  const r = await run({ dryRun: false });
  assert.equal(r.status, "busy");
});

test("per-agent and per-evaluation scoping", async () => {
  const { sheets, run } = setup();
  const r = await run({ dryRun: false, agent: "bravo" });
  assert.equal(r.worksheets.length, 1);
  assert.equal(sheets.tabs.get("Bravo")!.length, 2);
  assert.equal((sheets.tabs.get("Alpha") ?? []).length, 0);
  const bad = await run({ dryRun: false, agent: "nobody" });
  assert.equal(bad.status, "rejected");
  const one = await run({ dryRun: true, evaluationId: 10 });
  assert.equal(one.worksheets.length, 2); // evaluation scope still touches each agent tab, but only evaluation 10's rows are planned
  assert.equal(one.worksheets.find((w) => w.worksheet === "Alpha")!.appended, 1);
  assert.equal(one.worksheets.find((w) => w.worksheet === "Bravo")!.appended, 0);
});

test("an evaluation invalidated after export is overwritten with a withdrawn marker", async () => {
  const { store, sheets, run } = setup();
  await run({ dryRun: false });
  store.valid.delete(11); // invalidated afterwards
  const r = await run({ dryRun: false });
  assert.equal(r.worksheets.find((w) => w.worksheet === "Bravo")!.withdrawn, 1);
  const row = sheets.tabs.get("Bravo")![1];
  assert.equal(row[10], "Withdrawn");
  assert.equal(row[7], "Not published");
  assert.equal(sheets.tabs.get("Bravo")!.length, 2);
});

test("rows contain no transcripts or phone numbers and carry the review fields", () => {
  const row = buildAgentRow(rec({ evaluation_id: 1, agent_id: 1, agent_name: "alpha" }));
  assert.equal(row.length, AGENT_HEADERS.length);
  assert.ok(!row.some((c) => String(c).includes("9876543210")));
  assert.equal(row[8], "[00:05] hello, call me on [number redacted]\n[01:05] second line"); // full timestamped transcript in order, numbers masked
  assert.match(String(row[9]), /Evidence cited:\nC01-01 \[00:05–00:09\] \[agent\] hello, call me on \[number redacted\]/);
  const na = buildAgentRow(rec({ evaluation_id: 3, agent_id: 1, agent_name: "alpha", transcript_segments_json: null }, Array(9).fill("N/A")));
  assert.equal(na[8], ""); // no transcript on file -> empty, never invented
  assert.equal(row[2], "Alpha");
  assert.equal(row[7], "66.7% (partial: C01-C02 only)"); // six applicable criteria, each 2 of 3; the three N/A criteria are excluded
  const blocked = buildAgentRow(rec({ evaluation_id: 2, agent_id: 1, agent_name: "alpha", state: "blocked" }));
  assert.equal(blocked[7], "Not published");
  assert.equal(blocked[10], "Blocked");
  assert.equal(row[10], "Evaluated");
  assert.equal(row[11], "pending");
  assert.match(String(row[9]), /Key strengths:\n• Warm greeting/);
  assert.match(String(row[9]), /C01-01 Criterion C01-01: 2\/3/);
  assert.match(String(row[9]), /C02-04 Criterion C02-04: N\/A/);
});

test("performance summary has only the six agreed columns and no scores or rankings", async () => {
  const { sheets, run } = setup();
  await run({ dryRun: false });
  const s = sheets.tabs.get(SUMMARY_TAB)!;
  assert.deepEqual(s[0], ["Agent Name", "Number of Calls Processed", "Number of Eligible Evaluations", "Number of N/A Calls", "Number of Pending Human Reviews", "Number of Reviewed Evaluations"]);
  assert.equal(s[1][0], "Alpha");
  assert.ok(!JSON.stringify(s[0]).toLowerCase().match(/score|rank/));
});

// ---------- auth + client ----------
test("service-account parsing rejects bad input without echoing it", () => {
  assert.throws(() => parseServiceAccount(undefined), GoogleAuthError);
  assert.throws(() => parseServiceAccount("{not json SECRET"), (e: Error) => !e.message.includes("SECRET"));
  assert.throws(() => parseServiceAccount(JSON.stringify({ type: "service_account", client_email: "x", private_key: "nope" })), GoogleAuthError);
});

test("JWT is signed with WebCrypto and the token exchange handles success and rejection", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const sa = parseServiceAccount(JSON.stringify({ type: "service_account", client_email: "svc@x.iam.gserviceaccount.com", private_key: pem }));
  const jwt = await buildJwtAssertion(sa, "scope", 1000);
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  assert.equal(JSON.parse(Buffer.from(c, "base64url").toString()).iss, sa.client_email);
  assert.ok(s.length > 100);
  clearTokenCache();
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }), text: async () => "", headers: { get: () => null } }; };
  assert.equal(await getAccessToken(sa, ok), "tok");
  assert.equal(await getAccessToken(sa, ok), "tok");
  assert.equal(calls, 1); // cached
  clearTokenCache();
  const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }), text: async () => "", headers: { get: () => null } });
  await assert.rejects(getAccessToken(sa, bad), (e: Error) => e instanceof GoogleAuthError && /invalid_grant/.test(e.message) && !e.message.includes("PRIVATE KEY"));
});

test("sheets client retries rate limits and reports persistent failures", async () => {
  let n = 0;
  const waits: number[] = [];
  const fetchFn = async () => {
    n++;
    if (n < 3) return { ok: false, status: 429, json: async () => ({}), text: async () => "", headers: { get: () => null } };
    return { ok: true, status: 200, json: async () => ({ sheets: [{ properties: { title: "A", sheetId: 1 } }] }), text: async () => "", headers: { get: () => null } };
  };
  const client = createSheetsClient({ spreadsheetId: "sid", getToken: async () => "t", fetchFn, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(await client.listSheets(), [{ title: "A", sheetId: 1 }]);
  assert.equal(waits.length, 2);
  const always = async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => "", headers: { get: () => null } });
  const c2 = createSheetsClient({ spreadsheetId: "sid", getToken: async () => "t", fetchFn: always, sleep: async () => {}, maxRetries: 1 });
  await assert.rejects(c2.listSheets(), (e: SheetsApiError) => e.kind === "rate_limit");
  const missing = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => "", headers: { get: () => null } });
  const c3 = createSheetsClient({ spreadsheetId: "sid", getToken: async () => "t", fetchFn: missing, sleep: async () => {} });
  await assert.rejects(c3.getValues("'Nope'!A1:B2"), (e: SheetsApiError) => e.kind === "not_found");
});
