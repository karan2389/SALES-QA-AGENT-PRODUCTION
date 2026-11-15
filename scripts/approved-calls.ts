// The Phase 1 approved call selections used by the local tooling (seed-calls, store-recordings, evaluate-call, label-call).
// Real selections (Callyzer id prefix/suffix, employee name, employee-number suffix, duration) are PRIVATE and live in
// `scripts/approved-calls.local.json`, which is gitignored and must never be committed. Without that file this module returns
// clearly synthetic placeholders that match no real call, so the scripts fail safely instead of touching real recordings.
//
// Local file format: [{ "agent": 1, "prefix": "...", "suffix": "...", "name": "lower-case employee name", "empSuffix": "...", "duration": 1336 }, ...]
import { existsSync, readFileSync } from "node:fs";

export interface ApprovedCall {
  agent: number;
  prefix: string;
  suffix: string;
  name: string;
  empSuffix: string;
  duration: number;
}

/** Synthetic placeholders: NOT real calls and not approved recordings. */
export const SYNTHETIC_APPROVED: ApprovedCall[] = [
  { agent: 1, prefix: "SYNTH1", suffix: "0001", name: "synthetic agent alpha", empSuffix: "000", duration: 1200 },
  { agent: 2, prefix: "SYNTH2", suffix: "0002", name: "synthetic agent bravo", empSuffix: "000", duration: 1100 },
  { agent: 3, prefix: "SYNTH3", suffix: "0003", name: "synthetic agent charlie", empSuffix: "000", duration: 1000 },
  { agent: 4, prefix: "SYNTH4", suffix: "0004", name: "synthetic agent delta", empSuffix: "000", duration: 900 },
  { agent: 5, prefix: "SYNTH5", suffix: "0005", name: "synthetic agent echo", empSuffix: "000", duration: 1700 },
];

function load(): ApprovedCall[] {
  const file = new URL("./approved-calls.local.json", import.meta.url);
  if (!existsSync(file)) return SYNTHETIC_APPROVED;
  const rows = JSON.parse(readFileSync(file, "utf8")) as ApprovedCall[];
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("approved-calls.local.json must be a non-empty array");
  return rows;
}

export const APPROVED: ApprovedCall[] = load();

/** R2 object key convention used in Stage 4. */
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
export const r2Key = (empId: string, callId: string) => `recordings/${safe(empId)}/${safe(callId)}.mp3`;
