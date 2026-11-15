// Test fixtures for the MRV1.0 engine: a synthetic transcript, a fake store and a fake model that returns schema-valid JSON per pass.
import type { EvaluationModel, LoadedTranscript } from "../src/evaluation/evaluate.ts";
import type { Segment } from "../src/evaluation/types.ts";
import type { Mrv1CallInfo, Mrv1Store } from "../src/mrv1/engine.ts";
import type { Mrv1Document } from "../src/mrv1/types.ts";

export const SEGMENTS: Segment[] = [
  "Hello, this is Rahul from FlexiFunnels, Mentoring Team",
  "I am calling to understand your goals and challenges",
  "I run a small coaching business for fitness trainers",
  "My monthly revenue is around two lakh rupees",
  "What is the biggest challenge in growing it online",
  "I do not know how to build funnels and run ads properly",
  "FlexiFunnels gives you funnels, payments and email in one place",
  "Does this make sense so far for your coaching business",
  "Yes it makes sense but the price is a concern for me",
  "I understand the price concern, let us look at the payment options",
  "Okay I will think about it and call you next week",
  "Sure, I will send the details and we will speak next week",
].map((text, i) => ({ index: i, start: i * 50, end: i * 50 + 40, text }));

export const CALL_SECONDS = 600;
export const AUDIO_BYTES = CALL_SECONDS * 4000; // 32 kbps CBR

export const call = (over: Partial<Mrv1CallInfo> = {}): Mrv1CallInfo => ({ id: 7, callyzer_call_id: "CY-7", agent_id: 1, duration_seconds: CALL_SECONDS, audio_size_bytes: AUDIO_BYTES, ...over });

export interface FakeStoreOpts {
  call?: Mrv1CallInfo | null;
  label?: { business_call_type: string; labelled_by: string; basis: string | null; labelled_at: string } | null;
  transcript?: LoadedTranscript | null;
  existing?: Array<{ prompt_version: string; invalidated: boolean }>;
}
export class FakeStore implements Mrv1Store {
  saved: Array<{ doc: Mrv1Document; raws: string[] }> = [];
  opts: FakeStoreOpts;
  constructor(opts: FakeStoreOpts = {}) {
    this.opts = opts;
  }
  async loadCall() { return this.opts.call === undefined ? call() : this.opts.call; }
  async loadTranscript() { return this.opts.transcript === undefined ? { source: "production", language: "en", segments: SEGMENTS } : this.opts.transcript; }
  async getActiveCallTypeLabel() { return this.opts.label === undefined ? { business_call_type: "new_webinar_prospect", labelled_by: "Owner", basis: "booking record", labelled_at: "2026-11-15" } : this.opts.label; }
  async findEvaluation(_c: number, _r: string, p: string) {
    const e = (this.opts.existing ?? []).find((x) => x.prompt_version === p);
    return e ? { id: 99, human_review_status: "pending", evaluated_at: "2026-11-15", invalidated: e.invalidated } : null;
  }
  async saveEvaluation(doc: Mrv1Document, extras: { rawModelOutputs: string[] }) {
    this.saved.push({ doc, raws: extras.rawModelOutputs });
    return 100 + this.saved.length;
  }
}

type Policy = (id: string) => { outcome: string; reason_code?: string | null; quote?: string; seg?: number; speaker?: string; elements?: any[]; extra?: Record<string, unknown> } | undefined;
export interface FakeModelOpts {
  policy?: Policy;
  assessment?: Record<string, unknown>;
  flags?: unknown[];
  priorities?: unknown[];
  failFirst?: number; // throw this many times before succeeding
  text?: (pass: string, n: number) => string | undefined; // override raw text for a pass call
}

function critJson(id: string, p: ReturnType<Policy>) {
  // C01/C02 have approved element rules; the default fixture answer for them is NE so it is valid without element data.
  const o = p ?? (/^C0[12]-/.test(id) ? { outcome: "NE" } : { outcome: "2" });
  const numeric = ["0", "1", "2", "3"].includes(o.outcome);
  const seg = o.seg ?? 3;
  const quote = o.quote ?? SEGMENTS[seg].text;
  return {
    criterion_id: id,
    outcome: o.outcome,
    reason_code: o.reason_code ?? (o.outcome === "N/A" ? "no_opportunity_arose" : o.outcome === "NE" ? "insufficient_evidence" : null),
    elements: o.elements ?? [],
    element_details: [],
    understanding_check_passed: null,
    counts: null,
    evidence: numeric && o.outcome !== "0" ? [{ segment_start: seg, segment_end: seg, quote, speaker: o.speaker ?? "prospect", speaker_basis: "answers the salesperson's question" }] : [],
    absence_record: o.outcome === "0" ? { window_start_segment: 0, window_end_segment: 11, progression_excerpts: [{ segment: 4, quote: SEGMENTS[4].text, speaker: "salesperson" }], absence_explanation: "Never asked within the call." } : null,
    evidence_confidence: "high",
    confidence_reason: "clear transcript",
    explanation: "Specific explanation tied to the evidence.",
    improvement_recommendation: numeric && o.outcome !== "3" ? "Ask one follow-up question about the answer." : "",
    human_review_flags: [],
    ...(o.extra ?? {}),
  };
}

export function fakeModel(opts: FakeModelOpts = {}): EvaluationModel & { calls: Array<{ pass: string; system: string }> } {
  const calls: Array<{ pass: string; system: string }> = [];
  let failures = opts.failFirst ?? 0;
  const counts: Record<string, number> = {};
  return {
    id: "fake-model",
    calls,
    async run(req) {
      const pass = /pass: ([a-z0-9_]+)/.exec(req.user)?.[1] ?? "unknown";
      calls.push({ pass, system: req.system });
      counts[pass] = (counts[pass] ?? 0) + 1;
      if (failures > 0) {
        failures--;
        throw new Error("simulated model failure");
      }
      const override = opts.text?.(pass, counts[pass]);
      if (override !== undefined) return { text: override };
      const list = /each once: ([A-Z0-9, -]+)\.(?: \(|\n)/.exec(req.system)?.[1] ?? "";
      const ids = list.split(",").map((s) => s.trim()).filter(Boolean);
      const out: Record<string, unknown> = {
        criteria: ids.map((id) => critJson(id, opts.policy?.(id))),
        transcript_assessment: { reliability: "high", notes: "readable", call_opening_observable: "yes", speaker_attribution: "clear", language_ok: true, call_type_conflict: null, ...opts.assessment },
      };
      if (pass === "psychology_report") {
        Object.assign(out, {
          critical_flags: opts.flags ?? [],
          what_went_well: [{ text: "Asked an open question about the business.", segments: [4] }],
          missed_opportunities: [{ text: "Did not ask how long the prospect had followed the team.", segments: [2] }],
          coaching_priorities: opts.priorities ?? [{ observed_issue: "Price concern was met with a payment-options pivot.", recommended_action: "Ask what the concern is before offering options.", better_behaviour_example: "What part of the price worries you most?", segments: [8, 9] }],
          prospect_profile: { occupation: { value: "Runs a coaching business for fitness trainers", segments: [2] }, annual_revenue: null },
          objections: [{ objection: "Price is a concern", segments: [8], handling_summary: "Salesperson moved to payment options.", outcome: "unclear" }],
          executive_summary: "The salesperson introduced the team and discussed the business, but the price objection was not explored.",
          final_coaching_note: "Explore concerns before offering solutions.",
          needs_human_verification: [],
        });
      }
      return { text: JSON.stringify(out), usage: { tokens: 1 } };
    },
  };
}


