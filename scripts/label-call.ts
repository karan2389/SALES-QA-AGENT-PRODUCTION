// Record a human-confirmed call-type label for a call, or mark an evaluation as not valid (kept for audit, never deleted).
// Requires `npm run dev` to be running (remote D1).
//
//   npm run label:call -- --agent 1 --call-type continuation --labelled-by "<who confirmed>" --basis "<what the confirmation rests on>"
//   npm run label:call -- --agent 1 --call-type new_webinar_prospect --labelled-by "dev" --verification unverified_test_override --basis "<note>"
//   npm run label:call -- --invalidate 3 --status test_only --reason "<why>" --by "<who>"
//
// A human-confirmed label supersedes the previous active label (history is kept). Statuses: test_only | invalidated | superseded.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { APPROVED } from "./approved-calls.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const token = readFileSync(".dev.vars", "utf8").match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) throw new Error("ADMIN_TOKEN not found in .dev.vars");
const base = arg("url") ?? "http://127.0.0.1:8787";

async function post(path: string, params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const res = await fetch(`${base}${path}?${p}`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({ status: "failed", error: `non-JSON response (HTTP ${res.status})` }));
  console.log(`HTTP ${res.status}`, JSON.stringify(body));
  process.exit(res.ok ? 0 : 1);
}

const invalidate = arg("invalidate");
if (invalidate) {
  await post(`/admin/evaluation/${invalidate}/invalidate`, { status: arg("status"), reason: arg("reason"), by: arg("by") });
} else {
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
    console.error("Provide --agent <1-5> or --call-id <callyzer id>, or --invalidate <evaluation id>.");
    process.exit(2);
  }
  await post(`/admin/call-type/${callId}`, { call_type: arg("call-type"), labelled_by: arg("labelled-by"), basis: arg("basis"), verification: arg("verification") });
}
