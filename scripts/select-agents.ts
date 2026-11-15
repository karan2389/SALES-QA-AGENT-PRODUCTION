// Stage 3 discovery: find five distinct agents, each with one eligible recording. Read-only; downloads nothing.
// Run: npm run select:agents   (optional env: SELECT_MAX_PAGES, default 60)
import { CallyzerClient, CallyzerError, isProcessableCall } from "../src/callyzer/client.ts";
import type { CallRecord } from "../src/callyzer/types.ts";

const env = process.env as Record<string, string | undefined>;
const MAX_PAGES = Number(env.SELECT_MAX_PAGES ?? "60");
const WANT = 5;
const PREF_MIN = 15 * 60;
const PREF_MAX = 30 * 60;
const PREF_MID = 22.5 * 60;

const inWindow = (d: number) => d >= PREF_MIN && d <= PREF_MAX;
// lower score = better. In-window beats out-of-window; within window, closest to the middle.
const score = (d: number) => (inWindow(d) ? Math.abs(d - PREF_MID) : 1_000_000 + Math.abs(d - PREF_MID));

const mask = (s: string) => (s.length <= 4 ? "***" : "*".repeat(s.length - 3) + s.slice(-3));
const mmss = (s: number) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`;
const agentKey = (r: CallRecord) => r.emp_number.trim() || r.emp_code.trim();

const best = new Map<string, CallRecord>();
const eligibleAgents = new Set<string>();
let pages = 0, scanned = 0, eligible = 0, noAgentId = 0, notVoice = 0, totalRecords = 0, exhausted = false;

try {
  const client = CallyzerClient.fromEnv(env);
  const now = Math.floor(Date.now() / 1000);
  const req = { call_from: now - 30 * 86400, call_to: now, call_method: "PhoneCall", call_mode: "Voice", page_size: 50 } as const;

  const maxPages = Number.isFinite(MAX_PAGES) && MAX_PAGES > 0 ? MAX_PAGES : 60;
  let fullyIterated = true;
  for await (const page of client.iterateCallHistory({ ...req, page_no: 1 }, maxPages)) {
    pages++;
    totalRecords = page.totalRecords;
    for (const r of page.records) {
      scanned++;
      if (!isProcessableCall(r)) continue;
      if (r.call_mode !== "Voice") { notVoice++; continue; }
      const key = agentKey(r);
      if (!key) { noAgentId++; continue; }
      eligible++;
      eligibleAgents.add(key);
      const cur = best.get(key);
      if (!cur || score(r.duration) < score(cur.duration)) best.set(key, r);
    }
    // Stop as soon as five distinct agents each have a preferred-length (15-30 min) call.
    const preferred = [...best.values()].filter((r) => inWindow(r.duration)).length;
    if (preferred >= WANT) break;
    if (pages * 50 >= totalRecords) { exhausted = true; fullyIterated = false; break; }
  }
  if (!exhausted && pages >= maxPages) console.log(`note: stopped at page cap (${maxPages}) before preferred-length calls found for five agents`);
  void fullyIterated;
} catch (e) {
  if (e instanceof CallyzerError) console.log(`ERROR kind=${e.kind} status=${e.status ?? "-"} message=${e.message}`);
  else console.log(`ERROR ${e instanceof Error ? e.name : "unknown"}`);
  process.exitCode = 1;
}

// Rank agents: preferred-length first, then by closeness; take five.
const picks = [...best.values()].sort((a, b) => score(a.duration) - score(b.duration)).slice(0, WANT);

console.log("\n=== Discovery summary ===");
console.log(`pages inspected: ${pages} (page size 50; API total_records in range: ${totalRecords})`);
console.log(`records scanned: ${scanned}`);
console.log(`eligible calls found: ${eligible} (skipped: no agent id=${noAgentId}, not voice=${notVoice})`);
console.log(`distinct eligible agents found: ${eligibleAgents.size}`);
console.log(`all pages examined: ${exhausted ? "yes" : "no"}`);

console.log("\n=== Proposed selection ===");
console.log("| # | Employee name | Emp code | Emp number (masked) | Call ID | Call date | Duration | Type | Recording | In 15-30 min |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
picks.forEach((r, i) => {
  console.log(
    `| Agent ${i + 1} | ${r.emp_name || "-"} | ${r.emp_code || "-"} | ${r.emp_number ? mask(r.emp_number) : "-"} | ${short(r.id)} | ${r.call_date} | ${mmss(r.duration)} | ${r.call_type} | Yes | ${inWindow(r.duration) ? "yes" : "no"} |`,
  );
});
if (picks.length < WANT) {
  console.log(`\nOnly ${picks.length} eligible agent(s) found: ${exhausted ? "all pages in the 30-day range were examined." : "page cap reached; raise SELECT_MAX_PAGES to search further."}`);
}
