// Stage 5B: idempotently insert the five approved agents + calls into remote D1.
// Run: npm run seed:calls
// Re-resolves the approved calls from Callyzer history (read-only), takes audio size/type from the Stage 4 report.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CallyzerClient, CallyzerError } from "../src/callyzer/client.ts";
import type { CallRecord } from "../src/callyzer/types.ts";
import { APPROVED, r2Key } from "./approved-calls.ts";

const DB = "flexifunnels-call-intelligence";
const q = (v: string | number | null) => (v === null ? "NULL" : typeof v === "number" ? String(Math.trunc(v)) : `'${v.replace(/'/g, "''")}'`);
const mask = (s: string) => "*".repeat(Math.max(0, s.length - 3)) + s.slice(-3);

let tmp: string | undefined;
try {
  const report = JSON.parse(await readFile(join("reports", "stage4-r2-upload.json"), "utf8")) as {
    recordings: Array<{ agent: number; bytes: number; contentType: string | null; verified: boolean }>;
  };
  const client = CallyzerClient.fromEnv(process.env as Record<string, string | undefined>);
  const found = new Map<number, CallRecord>();
  const now = Math.floor(Date.now() / 1000);
  for await (const page of client.iterateCallHistory(
    { call_from: now - 30 * 86400, call_to: now, call_method: "PhoneCall", call_mode: "Voice", page_no: 1, page_size: 50 }, 80)) {
    for (const r of page.records)
      for (const a of APPROVED) if (!found.has(a.agent) && r.id.startsWith(a.prefix) && r.id.endsWith(a.suffix)) found.set(a.agent, r);
    if (found.size === APPROVED.length) break;
  }
  if (found.size !== APPROVED.length) throw new Error(`only resolved ${found.size}/5 approved calls`);

  const sql: string[] = [];
  for (const a of APPROVED) {
    const r = found.get(a.agent)!;
    const emp = r.emp_number.trim();
    const stage4 = report.recordings.find((x) => x.agent === a.agent);
    if (!emp || r.emp_name.trim().toLowerCase() !== a.name || !emp.endsWith(a.empSuffix) || r.duration !== a.duration)
      throw new Error(`agent ${a.agent}: Callyzer data differs from approved selection`);
    if (!stage4?.verified) throw new Error(`agent ${a.agent}: no verified Stage 4 upload in report`);
    sql.push(
      `INSERT INTO sales_agents (employee_number, employee_code, employee_name) VALUES (${q(emp)}, ${q(r.emp_code.trim() || null)}, ${q(r.emp_name.trim())})
       ON CONFLICT(employee_number) DO UPDATE SET employee_code = excluded.employee_code, employee_name = excluded.employee_name;`,
      `INSERT INTO calls (callyzer_call_id, sales_agent_id, call_date, call_time, duration_seconds, call_type, call_method, call_mode, r2_object_key, audio_content_type, audio_size_bytes)
       VALUES (${q(r.id)}, (SELECT id FROM sales_agents WHERE employee_number = ${q(emp)}), ${q(r.call_date)}, ${q(r.call_time)}, ${q(r.duration)}, ${q(r.call_type)}, ${q(r.call_method)}, ${q(r.call_mode)}, ${q(r2Key(emp, r.id))}, ${q(stage4.contentType)}, ${q(stage4.bytes)})
       ON CONFLICT(callyzer_call_id) DO UPDATE SET r2_object_key = excluded.r2_object_key, audio_content_type = excluded.audio_content_type, audio_size_bytes = excluded.audio_size_bytes, updated_at = datetime('now');`,
    );
    console.log(`agent ${a.agent}: ${r.emp_name} ${mask(emp)} -> ${r.id.slice(0, 6)}…${r.id.slice(-4)}`);
  }
  tmp = await mkdtemp(join(tmpdir(), "seed-"));
  const file = join(tmp, "seed.sql");
  await writeFile(file, sql.join("\n"));
  execFileSync(process.execPath, [join("node_modules", "wrangler", "bin", "wrangler.js"), "d1", "execute", DB, "--remote", "--file", file],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  console.log("seed applied (idempotent upserts)");
} catch (e) {
  console.log(`ERROR ${e instanceof CallyzerError ? `${e.kind}: ${e.message}` : e instanceof Error && !("stderr" in e) ? e.message : "wrangler command failed"}`);
  process.exitCode = 1;
} finally {
  if (tmp) await rm(tmp, { recursive: true, force: true });
}
