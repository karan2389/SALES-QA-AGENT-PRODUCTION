// Transcribe stored calls one by one through the running Worker (existing Whisper implementation, native Workers AI binding).
// Idempotent: calls that already have a completed transcript are skipped. A failure on one call does not stop or affect the others.
//
//   npm run dev                                   (in one terminal)
//   npm run transcribe:calls                      (agents 2-5; Agent 1 is never touched)
//   npm run transcribe:calls -- --agent 3         (one agent)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import { APPROVED } from "./approved-calls.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const wanted = arg("agent") ? [Number(arg("agent"))] : [2, 3, 4, 5];
if (wanted.includes(1)) throw new Error("Agent 1 is already transcribed and must remain untouched.");
const token = readFileSync(".dev.vars", "utf8").match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) throw new Error("ADMIN_TOKEN not found in .dev.vars");

function d1(sql: string): any[] {
  const out = execFileSync(process.execPath, ["--env-file=.env", "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "flexifunnels-call-intelligence", "--remote", "--json", "--command", sql], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out)[0].results;
}

/** POST with no client-side header timeout (Whisper can take several minutes). */
function post(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: 8787, path, method: "POST", headers: { authorization: `Bearer ${token}` }, timeout: 0 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode ?? 0, body: { ok: false, error: data.slice(0, 120) } }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

for (const n of wanted) {
  const a = APPROVED[n - 1];
  if (!a) {
    console.log(`agent ${n}: not one of the five approved calls`);
    continue;
  }
  const rows = d1(`SELECT c.callyzer_call_id, c.processing_status FROM calls c JOIN sales_agents s ON s.id = c.sales_agent_id WHERE lower(s.employee_name) = '${a.name.toLowerCase().replace(/'/g, "")}' LIMIT 1`);
  if (!rows[0]) {
    console.log(`agent ${n} (${a.name}): no call in D1`);
    continue;
  }
  const t0 = Date.now();
  let res: { status: number; body: any } | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { res = await post(`/admin/transcribe/${rows[0].callyzer_call_id}`); } catch (e) { res = { status: 0, body: { ok: false, error: String((e as Error).message).slice(0, 120) } }; }
    if (res.status === 200 || res.body?.skipped) break;
    if (attempt === 1) console.log(`agent ${n} (${a.name}): attempt 1 failed (${res.body?.error ?? res.status}); retrying once`);
  }
  const b = res!.body;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (b.skipped) console.log(`agent ${n} (${a.name}): SKIPPED, already transcribed (transcript ${b.transcript_id}, ${b.text_chars} chars)`);
  else if (b.ok) console.log(`agent ${n} (${a.name}): OK in ${secs}s - language ${b.language} (${b.language_probability}), ${b.segments} segments, ${b.word_count} words, last segment ends ${b.last_segment_end_s}s of ${b.expected_duration_s}s`);
  else console.log(`agent ${n} (${a.name}): FAILED in ${secs}s - ${b.error ?? "no text returned"}`);
}
