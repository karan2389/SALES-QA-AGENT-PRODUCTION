// Ethical safeguards. Flags are structured, evidence-checked and ALWAYS visible regardless of numeric scores; they never change a score.
// The model must separate confirmed conduct from ambiguous readings. Code verifies quotations and timestamps.
import { quoteInSegments } from "../evaluation/transcript.ts";
import { FLAG_IDS, FLAG_SEVERITIES } from "./rubric.ts";
import type { FlagId, FlagSeverity } from "./rubric.ts";
import type { Mrv1Flag } from "./types.ts";
import type { Segment } from "../evaluation/types.ts";

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Characteristics that may never be a basis for scoring or flagging a prospect (rubric section 7). */
const PROTECTED = /\b(disab(?:led|ility)|handicap(?:ped)?|military|army|veteran|ex-?serviceman|education(?:al)? (?:level|background)|uneducated|illiterate|accent|mother tongue|language background|broken english|poor english|caste|religion|gender|age(?:d)?\b|elderly|too old|too young|married|unmarried|pregnan\w*)\b/i;

export function mentionsProtectedCharacteristic(text: string): boolean {
  return PROTECTED.test(text);
}

/** Validate the model's flags; returns errors (schema) and the verified flags. Segment numbers must exist; quotations must appear. */
export function validateFlags(raw: unknown, segments: Segment[]): { errors: string[]; flags: Mrv1Flag[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const flags: Mrv1Flag[] = [];
  if (!Array.isArray(raw)) return { errors: ["critical_flags: must be an array"], flags, warnings };
  const n = segments.length;
  raw.forEach((f: unknown, i: number) => {
    const p = `critical_flags[${i}]`;
    if (!isObj(f)) return void errors.push(`${p}: not an object`);
    if (!FLAG_IDS.includes(f.flag_id)) errors.push(`${p}.flag_id: must be one of ${FLAG_IDS.join(", ")}`);
    if (!FLAG_SEVERITIES.includes(f.severity)) errors.push(`${p}.severity: must be one of ${FLAG_SEVERITIES.join(", ")}`);
    if (!["confirmed_conduct", "ambiguous"].includes(f.interpretation)) errors.push(`${p}.interpretation: confirmed_conduct or ambiguous`);
    if (typeof f.explanation !== "string" || f.explanation.trim() === "") errors.push(`${p}.explanation: required`);
    if (!Array.isArray(f.segments) || f.segments.length === 0 || !f.segments.every((s: unknown) => Number.isInteger(s) && (s as number) >= 0 && (s as number) < n)) errors.push(`${p}.segments: non-empty array of valid segment numbers (0..${n - 1})`);
    if (!(f.quote === null || typeof f.quote === "string")) errors.push(`${p}.quote: string or null`);
  });
  if (errors.length > 0) return { errors, flags, warnings };
  for (const f of raw as any[]) {
    const segs: number[] = [...new Set<number>(f.segments)].sort((a, b) => a - b);
    const lo = segs[0];
    const hi = segs[segs.length - 1];
    const notes: string[] = [];
    let verification: Mrv1Flag["verification_status"] = "needs_human_review";
    let quote: string | null = f.quote;
    if (quote !== null) {
      if (quoteInSegments(quote, segments, lo, hi, 2)) verification = "quote_verified";
      else {
        verification = "quote_unverified";
        warnings.push(`critical flag "${f.flag_id}": quotation could not be verified and was removed`);
        quote = null;
      }
    }
    let interpretation: Mrv1Flag["interpretation"] = f.interpretation;
    // A flag grounded in a protected characteristic is not an ethical finding about the salesperson's conduct: send it to a human, never confirm it.
    if (mentionsProtectedCharacteristic(f.explanation)) {
      notes.push("protected_characteristic_reference: customer fit must rest on product fit, understanding of the offer, technical requirements and realistic expectations, never on personal characteristics");
      interpretation = "ambiguous";
      verification = "needs_human_review";
    }
    // Confirmed conduct needs a verified quotation; otherwise it can only be an ambiguous reading.
    if (interpretation === "confirmed_conduct" && verification !== "quote_verified") {
      interpretation = "ambiguous";
      notes.push("downgraded to ambiguous: confirmed conduct requires a verified quotation");
    }
    flags.push({
      flag_id: f.flag_id as FlagId,
      severity: f.severity as FlagSeverity,
      start_s: segments[lo].start,
      end_s: segments[hi].end,
      segments: segs,
      quote,
      explanation: f.explanation.trim(),
      interpretation,
      verification_status: verification,
      human_review_decision: "pending",
      notes,
    });
  }
  return { errors, flags, warnings };
}

/**
 * Lexical safety net: phrases that commonly accompany risky conduct. These are CANDIDATES for human verification only; they are never
 * flags, never change a score, and are listed under needs_human_verification. Semantic judgement stays with the model and the reviewer.
 */
const CANDIDATES: Array<{ flag: FlagId; re: RegExp }> = [
  { flag: "false_earnings_promise", re: /\b(guarantee[sd]?|pakka|100\s?%)\b[^.?!]{0,60}\b(earn|income|revenue|lakh|crore|profit|paisa|paise|kamai)/i },
  { flag: "fake_urgency", re: /\b(only today|last chance|offer (?:ends|expires)|seats? (?:are )?(?:left|limited)|aaj hi|sirf aaj)\b/i },
  { flag: "financial_pressure", re: /\b(borrow|take a loan|loan lo|udhaar|udhar|credit card se|sell your (?:gold|jewel)|use your savings)\b/i },
];
export function scanCandidates(segments: Segment[]): Array<{ flag: FlagId; segment: number; text: string }> {
  const out: Array<{ flag: FlagId; segment: number; text: string }> = [];
  for (const s of segments) for (const c of CANDIDATES) if (c.re.test(s.text)) out.push({ flag: c.flag, segment: s.index, text: s.text.slice(0, 160) });
  return out;
}
