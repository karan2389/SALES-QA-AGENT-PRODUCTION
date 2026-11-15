// Diagnostic: one agent -> history -> one call by id -> download ONE recording -> verify MP3.
// Run: npm run diagnose:callyzer   (reads .env via node --env-file; prints sanitized metadata only)
//
// Optional env: CALLYZER_TEST_EMP_NUMBER (agent filter), CALLYZER_TEST_DAYS (default 30)
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CallyzerClient, CallyzerError, isProcessableCall, looksLikeMp3 } from "../src/callyzer/client.ts";

const env = process.env as Record<string, string | undefined>;
const days = Number(env.CALLYZER_TEST_DAYS ?? "30");
const now = Math.floor(Date.now() / 1000);
let failed = false;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  - " + extra : ""}`);
};

let tmpDir: string | undefined;
try {
  const client = CallyzerClient.fromEnv(env);
  const empFilter = env.CALLYZER_TEST_EMP_NUMBER?.trim();
  console.log(`agent filter: ${empFilter ? "configured (emp_numbers)" : "none (first agent with a usable recording will be used)"}`);

  // 1. history
  const page = await client.getCallHistoryPage({
    call_from: now - days * 86400,
    call_to: now,
    call_method: "PhoneCall",
    call_mode: "Voice",
    page_no: 1,
    page_size: 50,
    emp_numbers: empFilter ? [empFilter] : undefined,
  });
  check("history page fetched", page.records.length > 0, `rows=${page.records.length} total=${page.totalRecords} page_size=${page.pageSize}`);
  const usable = page.records.filter(isProcessableCall);
  const skipped = page.records.length - usable.length;
  console.log(`      usable (recording url + duration>0): ${usable.length}, skipped: ${skipped}`);
  const pick = usable[0];
  check("a usable call exists", !!pick);
  if (!pick) throw new Error("nothing to test further");
  console.log(`      picked: type=${pick.call_type} duration=${pick.duration}s date=${pick.call_date} id_len=${pick.id.length}`);

  // 2. details by id
  const details = await client.getCallsByIds([pick.id]);
  const detail = details[0];
  check("call found via /call-log/get", details.length === 1 && detail?.id === pick.id);
  check("detail has valid recording url", isProcessableCall(detail));

  // 3. download one recording, to temp dir
  const rec = await client.downloadRecording(detail.call_recording_url);
  tmpDir = await mkdtemp(join(tmpdir(), "callyzer-diag-"));
  const file = join(tmpDir, "recording.mp3");
  await writeFile(file, rec.bytes);
  const onDisk = await stat(file);
  check("recording downloaded", true, `content-type=${rec.contentType} bytes=${rec.size}`);
  check("file non-empty on disk", onDisk.size > 0 && onDisk.size === rec.size, `size=${onDisk.size}`);
  check("file is valid MP3", looksLikeMp3(rec.bytes), `magic=${Buffer.from(rec.bytes.slice(0, 3)).toString("hex")}`);
} catch (e) {
  failed = true;
  if (e instanceof CallyzerError) console.log(`ERROR kind=${e.kind} status=${e.status ?? "-"} message=${e.message}`);
  else console.log(`ERROR ${e instanceof Error ? e.name + ": " + e.message : "unknown"}`);
} finally {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
}
console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: ALL CHECKS PASSED (temp file deleted)");
process.exit(failed ? 1 : 0);
