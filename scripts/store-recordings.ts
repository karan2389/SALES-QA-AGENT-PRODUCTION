// Stage 4: download the five approved recordings and store them in R2 (bucket: sales-call-recordings).
// Run: npm run store:recordings
// Uses `wrangler r2 object put --remote` (authenticated via CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in .env).
// Prints and writes only sanitized metadata. Never prints URLs, tokens, customer data or full employee numbers.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CallyzerClient, CallyzerError, isProcessableCall } from "../src/callyzer/client.ts";
import type { CallRecord } from "../src/callyzer/types.ts";
import { APPROVED } from "./approved-calls.ts";

const BUCKET = "sales-call-recordings";
const WRANGLER = join("node_modules", "wrangler", "bin", "wrangler.js");


const env = process.env as Record<string, string | undefined>;
const mask = (s: string) => "*".repeat(Math.max(0, s.length - 3)) + s.slice(-3);
const short = (id: string) => `${id.slice(0, 6)}…${id.slice(-4)}`;
const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");
const wrangler = (args: string[]) =>
  execFileSync(process.execPath, [WRANGLER, ...args], { env: { ...process.env, NODE_NO_WARNINGS: "1" }, stdio: ["ignore", "pipe", "pipe"] });

interface Row {
  agent: number; name: string; empMasked: string; callId: string; key: string; maskedKey: string;
  bytes: number; contentType: string | null; md5: string; downloaded: boolean; uploaded: boolean; verified: boolean; error?: string;
}
const rows: Row[] = [];
let tmp: string | undefined;

try {
  const client = CallyzerClient.fromEnv(env);
  const matches = (r: CallRecord, a: (typeof APPROVED)[number]) =>
    r.id.startsWith(a.prefix) && r.id.endsWith(a.suffix);

  // 1. Resolve the approved calls' full IDs from history (targeted lookup, not discovery).
  const resolved = new Map<number, string>();
  const now = Math.floor(Date.now() / 1000);
  let pages = 0;
  for await (const page of client.iterateCallHistory(
    { call_from: now - 30 * 86400, call_to: now, call_method: "PhoneCall", call_mode: "Voice", page_no: 1, page_size: 50 }, 80)) {
    pages++;
    for (const r of page.records) for (const a of APPROVED) if (!resolved.has(a.agent) && matches(r, a)) resolved.set(a.agent, r.id);
    if (resolved.size === APPROVED.length) break;
  }
  console.log(`resolved ${resolved.size}/${APPROVED.length} approved call IDs (history pages read: ${pages})`);

  // 2. Fetch details via /call-log/get (single batch, <= 20 ids).
  const ids = [...resolved.values()];
  const details = ids.length ? await client.getCallsByIds(ids) : [];
  const byId = new Map(details.map((d) => [d.id, d]));
  tmp = await mkdtemp(join(tmpdir(), "stage4-"));

  for (const a of APPROVED) {
    const row: Row = { agent: a.agent, name: "", empMasked: "", callId: "", key: "", maskedKey: "", bytes: 0, contentType: null, md5: "", downloaded: false, uploaded: false, verified: false };
    rows.push(row);
    try {
      const id = resolved.get(a.agent);
      if (!id) throw new Error("approved call not found in history");
      const d = byId.get(id);
      if (!d) throw new Error("call not returned by /call-log/get");
      // 3. Validate identifiers against the approved report.
      if (d.id !== id) throw new Error("call id mismatch");
      const emp = d.emp_number.trim() || d.emp_code.trim();
      if (!emp) throw new Error("missing employee identifier");
      if (d.emp_name.trim().toLowerCase() !== a.name) throw new Error("employee name differs from approved selection");
      if (!emp.endsWith(a.empSuffix)) throw new Error("employee number differs from approved selection");
      if (d.duration !== a.duration) throw new Error("duration differs from approved selection");
      if (!isProcessableCall(d)) throw new Error("call not processable (no valid recording url / zero duration)");
      row.name = d.emp_name; row.empMasked = mask(emp); row.callId = short(id);

      // 4. Download (no Authorization header) + MP3 validation happen inside the client.
      const rec = await client.downloadRecording(d.call_recording_url);
      row.downloaded = true; row.bytes = rec.size; row.contentType = rec.contentType; row.md5 = md5(rec.bytes);

      // 5. Upload to R2. Key: recordings/<employee id>/<call id>.mp3
      const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
      row.key = `recordings/${safe(emp)}/${safe(id)}.mp3`;
      row.maskedKey = `recordings/${mask(safe(emp))}/${short(id)}.mp3`;
      const file = join(tmp, `a${a.agent}.mp3`);
      await writeFile(file, rec.bytes);
      wrangler(["r2", "object", "put", `${BUCKET}/${row.key}`, "--file", file, "--content-type", "audio/mpeg", "--remote"]);
      row.uploaded = true;

      // 6. Verify: read the object back and compare size + checksum.
      const back = join(tmp, `v${a.agent}.mp3`);
      wrangler(["r2", "object", "get", `${BUCKET}/${row.key}`, "--file", back, "--remote"]);
      const bs = await stat(back);
      const bd = md5(await readFile(back));
      row.verified = bs.size > 0 && bs.size === row.bytes && bd === row.md5;
      if (!row.verified) row.error = "R2 object size/checksum mismatch";
    } catch (e) {
      row.error = e instanceof CallyzerError ? `${e.kind}: ${e.message}` : e instanceof Error && !("stderr" in e) ? e.message : "wrangler command failed";
    }
  }
} catch (e) {
  console.log(`ERROR ${e instanceof CallyzerError ? `${e.kind}: ${e.message}` : e instanceof Error ? e.name : "unknown"}`);
  process.exitCode = 1;
} finally {
  if (tmp) await rm(tmp, { recursive: true, force: true });
}

const n = (f: (r: Row) => boolean) => rows.filter(f).length;
console.log("\n| # | Employee | Emp no. (masked) | Call ID | Object key (masked) | Bytes | Type | MD5 | Down | Up | Verified |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows)
  console.log(`| ${r.agent} | ${r.name || "-"} | ${r.empMasked || "-"} | ${r.callId || "-"} | ${r.maskedKey || "-"} | ${r.bytes} | ${r.contentType ?? "-"} | ${r.md5.slice(0, 8) || "-"} | ${r.downloaded ? "yes" : "NO"} | ${r.uploaded ? "yes" : "NO"} | ${r.verified ? "yes" : "NO"} |`);
for (const r of rows) if (r.error) console.log(`failure agent ${r.agent}: ${r.error}`);
console.log(`\ndownloaded: ${n((r) => r.downloaded)}/5, uploaded: ${n((r) => r.uploaded)}/5, verified in R2 (non-zero, size+md5 match): ${n((r) => r.verified)}/5`);

await mkdir("reports", { recursive: true });
await writeFile(
  join("reports", "stage4-r2-upload.json"),
  JSON.stringify({ bucket: BUCKET, at: new Date().toISOString(), recordings: rows.map(({ key: _k, ...r }) => r) }, null, 2),
);
if (n((r) => r.verified) !== 5) process.exitCode = 1;
