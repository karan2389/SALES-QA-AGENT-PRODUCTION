-- Phase 1 prototype: model-generated call evaluations (Workers AI gpt-oss-120b), stored separately from human review.
-- Additive only: no existing table is altered. The original transcripts and experiments are untouched.
--
--   evaluations          one row per (call, rubric version, prompt version): the validated evaluation document,
--                        the model id used, the human-confirmed call type, and the review status (default 'pending').
--   evaluation_criteria  one row per criterion (C01-01 ... C02-06): outcome, score, elements, evidence, explanation.
--   evaluation_reviews   human review notes and decisions. Kept apart from model output so a reviewer's comment
--                        never overwrites or mixes with model-generated feedback.

CREATE TABLE evaluations (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id                INTEGER NOT NULL REFERENCES calls(id),
  rubric_version         TEXT NOT NULL,
  prompt_version         TEXT NOT NULL,
  model_id               TEXT,                    -- exact model identifier; NULL when no model was used (not-applicable call types)
  evaluated_at           TEXT NOT NULL,
  transcript_source      TEXT NOT NULL,           -- 'production' or 'experiment:<label>' (read-only source)
  transcript_sha256      TEXT NOT NULL,           -- hash of the segment text that was evaluated
  call_type_label        TEXT NOT NULL,           -- human-confirmed business call type (rubric section 13)
  call_type_labelled_by  TEXT NOT NULL,
  call_type_basis        TEXT,
  applicability_status   TEXT NOT NULL CHECK (applicability_status IN ('evaluated','not_applicable')),
  applicability_reason   TEXT,
  transcript_reliability TEXT,                    -- the model's own rating (hint only)
  coaching_json          TEXT,                    -- strengths, missed opportunities, recommendations, flags
  result_json            TEXT NOT NULL,           -- full validated evaluation document
  raw_model_output       TEXT,                    -- exactly what the model returned (audit)
  usage_json             TEXT,
  validation_json        TEXT,                    -- warnings and code adjustments
  human_review_status    TEXT NOT NULL DEFAULT 'pending'
    CHECK (human_review_status IN ('pending','in_review','approved','changes_requested')),
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (call_id, rubric_version, prompt_version)  -- prevents duplicate evaluations of the same call
);
CREATE INDEX idx_evaluations_call ON evaluations(call_id);

CREATE TABLE evaluation_criteria (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id               INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  category_id                 TEXT NOT NULL,
  category_name               TEXT NOT NULL,
  criterion_id                TEXT NOT NULL,
  criterion_name              TEXT NOT NULL,
  outcome                     TEXT NOT NULL CHECK (outcome IN ('0','1','2','3','N/A','NE')),
  score                       INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 3)),
  applicable_status           TEXT NOT NULL CHECK (applicable_status IN ('applicable','not_applicable')),
  reason_code                 TEXT,
  elements_met_json           TEXT NOT NULL,
  elements_missing_json       TEXT NOT NULL,
  elements_late_json          TEXT NOT NULL,
  elements_not_observable_json TEXT NOT NULL,
  element_details_json        TEXT NOT NULL,
  evidence_json               TEXT NOT NULL,      -- verified quotations with code-derived timestamps
  absence_record_json         TEXT,
  evidence_confidence         TEXT NOT NULL CHECK (evidence_confidence IN ('high','medium','low')),
  confidence_reason           TEXT,
  explanation                 TEXT NOT NULL,
  human_review_flags_json     TEXT NOT NULL,
  model_original_outcome      TEXT,               -- set only if code changed the model's outcome
  UNIQUE (evaluation_id, criterion_id)
);

CREATE TABLE evaluation_reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id  INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  reviewer       TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('in_review','approved','changes_requested')),
  comment        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_evaluation_reviews_eval ON evaluation_reviews(evaluation_id);
