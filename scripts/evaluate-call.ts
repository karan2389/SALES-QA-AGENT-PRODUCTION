// Evaluate ONE existing transcribed call with @cf/openai/gpt-oss-120b (Category 01 + 02) through the running Worker.
//
// 1) In one terminal:   npm run dev            (wrangler dev; D1 and Workers AI are remote)
// 2) In another:        npm run evaluate:call -- --agent 1 --call-type new_webinar_prospect --labelled-by "<your name>" [--dry-run]
//
// The call type is a required HUMAN-CONFIRMED input (rubric section 13). If the call has a confirmed label on file (npm run label:call),
// that label is used and --call-type may be omitted; a different --call-type is refused. With no label on file and no --call-type the call is held, not scored.
// Options: --agent <1-5> | --call-id <callyzer id>; --call-type <label>; --labelled-by <name>; --basis <text>;
//          --transcript production|experiment:<label> (default production); --replace; --dry-run; --acknowledge-conflict; --debug; --json; --url <base>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { APPROVED } from "./approved-calls.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

let callId = arg("call-id");
const agent = arg("agent");
if (!callId && agent) {
  const a = APPROVED[Number(agent) - 1];
  if (!a) throw new Error("--agent must be 1-5");
  const out = execFileSync(
    process.execPath,
    ["--env-file=.env", "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "flexifunnels-call-intelligence", "--remote", "--json", "--command",
     `SELECT c.callyzer_call_id FROM calls c JOIN sales_agents s ON s.id = c.sales_agent_id WHERE lower(s.employee_name) = '${a.name.toLowerCase().replace(/'/g, "")}' LIMIT 1`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  callId = JSON.parse(out)[0]?.results?.[0]?.callyzer_call_id;
}
if (!callId) {
  console.error("Provide --agent <1-5> or --call-id <callyzer id>.");
  process.exit(2);
}

const token = readFileSync(".dev.vars", "utf8").match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) throw new Error("ADMIN_TOKEN not found in .dev.vars");
const params = new URLSearchParams();
for (const [k, v] of [["call_type", arg("call-type")], ["labelled_by", arg("labelled-by")], ["basis", arg("basis")], ["transcript", arg("transcript")]] as const) if (v) params.set(k, v);
if (flag("replace")) params.set("replace", "1");
if (flag("acknowledge-conflict")) params.set("acknowledge_conflict", "1");
if (flag("dry-run")) params.set("dry_run", "1");
if (flag("debug")) params.set("debug", "1");
const base = arg("url") ?? "http://127.0.0.1:8787";

const t0 = Date.now();
const res = await fetch(`${base}/admin/evaluate/${callId}?${params}`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
const body: any = await res.json().catch(() => ({ status: "failed", message: `non-JSON response (HTTP ${res.status})` }));
const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (flag("json")) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(res.ok ? 0 : 1);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
console.log(`HTTP ${res.status} in ${secs}s — status: ${body.status}${body.error_kind ? ` (${body.error_kind})` : ""}`);
if (body.status === "hold") {
  console.log(`HOLD: ${body.reason}`);
  const cf = body.document?.call_type?.conflict_suspected;
  if (cf) console.log(`  conflict evidence at ${Math.floor(cf.start_s / 60)}:${String(Math.floor(cf.start_s % 60)).padStart(2, "0")} (segment ${cf.segment}): "${cf.quote.slice(0, 120)}" — ${cf.explanation}`);
}
else if (body.status === "exists") console.log(`Already evaluated (evaluation ${body.evaluation_id}, review: ${body.human_review_status}). Use --replace to re-run while review is pending.`);
else if (body.status === "ready") {
  console.log(`Ready: call ${body.call_id}; transcript "${body.transcript_source}" has ${body.segments} segments; coverage ${body.quality.coverage_pct}%; gaps>5s: ${body.quality.gaps_over_5s.length}; existing evaluation: ${body.existing_evaluation_id ?? "none"}; call type: ${body.call_type}`);
} else if (body.status === "failed") {
  console.log(`FAILED: ${body.message}`);
  for (const e of body.errors ?? []) console.log(` - ${e}`);
  if (body.raw_output) console.log(`(raw model output returned, ${body.raw_output.length} chars; use --json to see it)`);
} else if (body.document) {
  const d = body.document;
  console.log(`Evaluation ${body.evaluation_id} saved to D1. Model: ${d.metadata.model_id ?? "none (no model used)"}; prompt ${d.metadata.prompt_version}; rubric ${d.metadata.rubric_version}; transcript ${d.metadata.transcript_source}; review: ${d.human_review.status}`);
  console.log(`Call type: ${d.call_type.label} (confirmed by ${d.call_type.labelled_by}); applicability: ${d.applicability.status}${d.applicability.reason_code ? ` (${d.applicability.reason_code})` : ""}`);
  const cs = d.call_type.conflict_suspected;
  if (cs) console.log(`CALL-TYPE CONFLICT SUSPECTED (${d.call_type.conflict_acknowledged ? "acknowledged by the human label" : "not acknowledged"}): transcript suggests "${cs.suspected_type}" at ${Math.floor(cs.start_s / 60)}:${String(Math.floor(cs.start_s % 60)).padStart(2, "0")} — "${cs.quote.slice(0, 100)}"`);
  console.log("");
  for (const cat of d.categories.filter((c: any) => c.status !== "not_evaluated")) {
    console.log(`${cat.category_id} ${cat.category_name} [${cat.status}]`);
    for (const c of cat.criteria) {
      console.log(`  ${c.criterion_id} ${clip(c.criterion_name, 44).padEnd(44)} outcome ${String(c.outcome).padEnd(3)} conf ${c.evidence_confidence}${c.reason_code ? ` reason ${c.reason_code}` : ""}${c.model_original_outcome ? ` (model said ${c.model_original_outcome})` : ""}`);
      console.log(`     ${clip(c.explanation, 220)}`);
      const e = c.evidence[0];
      if (e) console.log(`     evidence ${Math.floor(e.start_s / 60)}:${String(Math.floor(e.start_s % 60)).padStart(2, "0")} [${e.speaker}] "${clip(e.quote, 90)}"`);
    }
  }
  console.log(`\nNot evaluated in this prototype: ${d.categories.filter((c: any) => c.status === "not_evaluated").map((c: any) => c.category_id).join(", ")}`);
  if (d.coaching) {
    console.log(`Coaching: ${d.coaching.key_strengths.length} strengths, ${d.coaching.missed_opportunities.length} missed opportunities, ${d.coaching.improvement_recommendations.length} recommendations, ${d.coaching.critical_flags.length} critical flags, ${d.coaching.needs_human_verification.length} items for human verification`);
    for (const f of d.coaching.critical_flags) console.log(`  FLAG ${f.flag}: ${clip(f.explanation, 160)}`);
  }
  if (d.validation.warnings.length || d.validation.adjustments.length) console.log(`Validation: ${d.validation.warnings.length} warning(s), ${d.validation.adjustments.length} adjustment(s) made by code (see --json)`);
}
process.exit(res.ok ? 0 : 1);
