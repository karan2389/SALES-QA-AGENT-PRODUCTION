// Prepares the Google service-account key for the Worker WITHOUT ever printing it.
//
//   node scripts/google-credentials.ts check        validate the key in .env and report only non-secret facts
//   node scripts/google-credentials.ts sync-dev     write GOOGLE_SERVICE_ACCOUNT_JSON (single line) and GOOGLE_SPREADSHEET_ID into .dev.vars (gitignored)
//   node scripts/google-credentials.ts print-json   write the single-line JSON to stdout, for piping into `wrangler secret put` (never run this in a shared terminal log)
//
// The value in .env may span several lines (pretty-printed JSON); the Worker needs it on one line.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const mode = process.argv[2] ?? "check";

function readEnv(): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(".env")) return out;
  const lines = readFileSync(".env", "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2];
    if (m[1] === "GOOGLE_SERVICE_ACCOUNT_JSON") {
      // Join following lines until the braces balance (JSON may be pasted pretty-printed).
      const depth = (s: string) => [...s].reduce((d, ch) => d + (ch === "{" ? 1 : ch === "}" ? -1 : 0), 0);
      let d = depth(value);
      while (d > 0 && i + 1 < lines.length) {
        i++;
        value += "\n" + lines[i];
        d += depth(lines[i]);
      }
    }
    value = value.trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"') && !value.startsWith('{"'))) value = value.slice(1, -1);
    out.set(m[1], value);
  }
  return out;
}

function normaliseKey(raw: string): { json: string; email: string; keyId: string } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Raw line breaks inside the private_key string: escape them and retry.
    const fixed = raw.replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/, (k) => k.replace(/\r?\n/g, "\\n"));
    parsed = JSON.parse(fixed);
  }
  if (parsed?.type !== "service_account" || typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") throw new Error("not a service-account key (needs type, client_email, private_key)");
  return { json: JSON.stringify(parsed), email: parsed.client_email, keyId: String(parsed.private_key_id ?? "").slice(0, 6) };
}

function upsertDevVar(name: string, value: string): void {
  const line = `${name}='${value.replace(/'/g, "")}'`;
  const existing = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8").split(/\r?\n/) : [];
  const kept = existing.filter((l) => l.trim() !== "" && !l.startsWith(`${name}=`));
  writeFileSync(".dev.vars", [...kept, line].join("\n") + "\n");
}

try {
  const env = readEnv();
  const raw = env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  const sheetId = env.get("GOOGLE_SPREADSHEET_ID");
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set in .env");
  if (!sheetId) throw new Error("GOOGLE_SPREADSHEET_ID is not set in .env");
  const key = normaliseKey(raw);
  if (mode === "print-json") {
    process.stdout.write(key.json);
  } else if (mode === "print-spreadsheet-id") {
    process.stdout.write(sheetId);
  } else if (mode === "sync-dev") {
    upsertDevVar("GOOGLE_SERVICE_ACCOUNT_JSON", key.json);
    upsertDevVar("GOOGLE_SPREADSHEET_ID", sheetId);
    console.log(`.dev.vars updated: GOOGLE_SERVICE_ACCOUNT_JSON (single line, ${key.json.length} chars) and GOOGLE_SPREADSHEET_ID (${sheetId.length} chars). Values not shown.`);
    console.log(`service account: ${key.email}  (the spreadsheet must be shared with this address as Editor)`);
  } else {
    console.log(`service-account key OK: ${key.email}, key id ${key.keyId}…, single-line length ${key.json.length}; spreadsheet id length ${sheetId.length}. Values not shown.`);
  }
} catch (e) {
  console.error(`credential problem: ${e instanceof Error ? e.message : "unknown"}`);
  process.exit(1);
}
