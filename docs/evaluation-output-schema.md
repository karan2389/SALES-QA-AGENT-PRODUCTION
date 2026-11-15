# MRV1.0 output schema

## What the model returns (per pass)

```jsonc
{
  "criteria": [{
    "criterion_id": "C03-01",
    "outcome": "0" | "1" | "2" | "3" | "N/A" | "NE",
    "reason_code": null | "<mandatory for N/A and NE>",
    "elements": [],                       // C01/C02 only (approved element rules)
    "evidence": [{ "segment_start": 3, "segment_end": 3, "quote": "<exact>", "speaker": "salesperson|prospect|unclear", "speaker_basis": "..." }],
    "absence_record": null | { "window_start_segment": 0, "window_end_segment": 11, "progression_excerpts": [...], "absence_explanation": "..." },
    "evidence_confidence": "high|medium|low", "confidence_reason": "...",
    "explanation": "...", "improvement_recommendation": "...", "human_review_flags": []
  }],
  "transcript_assessment": { "reliability": "high|medium|low", "notes": "...", "call_opening_observable": "yes|no|unclear",
                             "speaker_attribution": "clear|uncertain|poor", "language_ok": true, "call_type_conflict": null },
  // last pass only:
  "critical_flags": [{ "flag_id": "...", "severity": "low|medium|high|critical", "interpretation": "confirmed_conduct|ambiguous", "segments": [3], "quote": "..." , "explanation": "..." }],
  "what_went_well": [{ "text": "...", "segments": [4] }], "missed_opportunities": [...],
  "coaching_priorities": [{ "observed_issue": "", "recommended_action": "", "better_behaviour_example": "", "segments": [] }],
  "prospect_profile": { "occupation": null | { "value": "...", "segments": [2] }, ... },
  "objections": [...], "executive_summary": "...", "final_coaching_note": "...", "needs_human_verification": []
}
```

The model never supplies scores, category percentages, overall values or timestamps.

## What the system stores (`Mrv1Document`, in `evaluations.result_json`)

`metadata` (rubric `MRV1.0`, prompt version, model id, transcript source and SHA-256, passes) · `call_type` (label, labelled by, basis) · `applicability` (status, reason, N/A categories) · `sales_stage[]` (70 criteria, each with verified evidence including `start_s`/`end_s`, score, reason, confidence, improvement recommendation, `review_status`) · `psychology[]` (22 criteria) · `scores.sales_stage` and `scores.psychology` (separate) · `extras` (flags, strengths, missed opportunities, three coaching priorities, profile, objections, summary) · `transcript_assessment` · `transcript_quality` · `validation` (warnings, adjustments with original outcomes) · `human_review`.

## Score objects

`scores.sales_stage`: `{ percent | null, display, status: definitive|provisional|not_applicable|held|unsupported|incomplete|invalidated|blocked, applicable_categories, categories[], notes[] }`.
`scores.psychology`: `{ percent | null, display, status, numeric_count, na_count, ne_count }`.
`display` is one decimal ("66.7%"), `"... (provisional)"`, `"N/A"` or `"Not published"`. `percent` keeps full precision.

## Report (`evaluation_reports.report_json`)

14 sections in order: Call Details, Overall Performance, Executive Summary, Prospect Profile, Category-wise Scorecard, Detailed Criterion Evaluation, Sales Psychology and Conduct, Objection Analysis, What Went Well, Missed Opportunities, Critical Flags, Personal Coaching Plan, Final Coaching Note, Human Review. Unknown profile data reads "Not established". Held and unsupported calls store `status: "not_generated"`.

## Tables

See `migrations/0006_mrv1_evaluation_engine.sql` (comments explain each table).
