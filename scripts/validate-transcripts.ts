// Read-only transcript validation for every call: duration, coverage, gaps, repeats, language. Prints a table; changes nothing.
// Run: npm run validate:transcripts [-- --label <experiment label for call N as N=label> ...]
//   e.g. npm run validate:transcripts -- --exp 2=bravo_hi
// Without --exp the production transcript (transcripts table) is validated; with --exp N=label the stored experiment is.
import { execFileSync } from "node:child_process";
import { analyzeSegments, recordingCompleteness } from "../src/transcript-quality.ts";

const exp = new Map<number, string>();
process.argv.forEach((a, i) => {
  if (a === "--exp") {
    const m = /^(\d+)=([a-z0-9_]+)$/.exec(process.argv[i + 1] ?? "");
    if (m) exp.set(Number(m[1]), m[2]);
  }
});

function d1(sql: string): any[] {
  const out = execFileSync(process.execPath, ["--env-file=.env", "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "flexifunnels-call-intelligence", "--remote", "--json", "--command", sql], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}

const calls = d1("SELECT c.id, a.employee_name AS agent, c.duration_seconds AS call_log_s, c.audio_size_bytes AS bytes FROM calls c JOIN sales_agents a ON a.id = c.sales_agent_id ORDER BY c.id");
const rows: string[] = [];
for (const c of calls) {
  const label = exp.get(c.id);
  const t = label
    ? d1(`SELECT language, segments_json, transcript_text FROM transcription_experiments WHERE call_id = ${c.id} AND label = '${label}' AND transcription_status = 'completed'`)[0]
    : d1(`SELECT language, segments_json, transcript_text FROM transcripts WHERE call_id = ${c.id} AND transcription_status = 'completed'`)[0];
  if (!t) {
    rows.push(`| ${c.agent} | ${c.call_log_s}s | - | - | - | - | - | no completed transcript |`);
    continue;
  }
  const j = JSON.parse(t.segments_json);
  const segs = (j.segments ?? []).map((s: any) => ({ start: s.start, end: s.end, text: s.text }));
  // Duration of the audio actually stored: CBR 32 kbps MP3 (verified against a full decode), else Whisper's own reported duration.
  const audioS = j.transcription_info?.duration ?? (c.bytes * 8) / 32000;
  const q = analyzeSegments(segs, audioS);
  const rec = recordingCompleteness(audioS, c.call_log_s);
  const ready = q.flags.length === 0 && rec.complete;
  rows.push(
    `| ${c.agent} | ${c.call_log_s}s call log / ${q.audio_s}s audio (${rec.ratio_pct}%) | ${q.last_end_s}s | ${q.words} | ${q.segments} | ${t.language} | ${q.coverage_pct}% | ` +
      `${q.largest_gaps.map((g) => `${g.length_s}s@${g.from_s}`).join(", ") || "none ≥8s"} | script dev ${q.script.devanagari_pct}% / latin ${q.script.latin_pct}% | ${[...q.flags, ...(rec.complete ? [] : [`recording holds only ${rec.ratio_pct}% of the logged call`])].join("; ") || "-"} | ${ready ? "mechanically complete" : "NOT ready"} |`,
  );
}
console.log("| Agent | Recording (call log / stored audio) | Transcript ends | Words | Segments | Language | Coverage | Largest gaps | Script | Flags | Result |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
rows.forEach((r) => console.log(r));
console.log("\nCoverage is an indicator, not proof of accuracy; read the text before relying on a transcript.");
