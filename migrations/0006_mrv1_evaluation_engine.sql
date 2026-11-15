-- MRV1.0 evaluation engine. ADDITIVE ONLY: no table is dropped, no row is changed or deleted, no existing column is altered.
--
-- Reused as they are (they already support the requirement):
--   evaluations (header, call type, review status; rubric_version 'MRV1.0'), evaluation_criteria (criterion-level rows for C01-C19),
--   evaluation_reviews (human review), evaluation_invalidations + valid_* views (invalidation, test-only exclusion), call_type_labels.
-- Added here:
--   * two nullable/defaulted columns on evaluation_criteria (improvement recommendation, criterion review status)
--   * rubric_versions: which rubric versions exist and a hash of the code definition that produced an evaluation
--   * evaluation_sp_criteria: the SEPARATE Sales Psychology and Conduct scorecard (never mixed with evaluation_criteria)
--   * evaluation_scores: deterministic scores, sales-stage and psychology kept in separate columns (no combined score exists)
--   * evaluation_flags: structured critical flags with a human review decision
--   * evaluation_score_corrections: human corrections; the model's original outcome is never overwritten
--   * evaluation_reports: report generation status and the generated 14-section report

ALTER TABLE evaluation_criteria ADD COLUMN improvement_recommendation TEXT;
ALTER TABLE evaluation_criteria ADD COLUMN criterion_review_status TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE rubric_versions (
  version        TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  category_count INTEGER NOT NULL,
  criteria_count INTEGER NOT NULL,
  psychology_criteria_count INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('draft','active','retired')),
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO rubric_versions (version, title, category_count, criteria_count, psychology_criteria_count, status, notes)
VALUES ('MRV1.0', 'Master Evaluation Rubric v1.0', 19, 70, 22, 'active',
        'Definitions live in src/mrv1/rubric.ts (verified by scripts/mrv1.test.ts). Categories 01 and 02 keep the approved Revision 4 element rules.');

CREATE TABLE evaluation_sp_criteria (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id           INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  criterion_id            TEXT NOT NULL,            -- SP-01 ... SP-22
  criterion_name          TEXT NOT NULL,
  outcome                 TEXT NOT NULL CHECK (outcome IN ('0','1','2','3','N/A','NE')),
  score                   INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 3)),
  applicable_status       TEXT NOT NULL CHECK (applicable_status IN ('applicable','not_applicable')),
  reason_code             TEXT,
  evidence_json           TEXT NOT NULL,
  absence_record_json     TEXT,
  evidence_confidence     TEXT NOT NULL CHECK (evidence_confidence IN ('high','medium','low')),
  confidence_reason       TEXT,
  explanation             TEXT NOT NULL,
  improvement_recommendation TEXT,
  human_review_flags_json TEXT NOT NULL,
  model_original_outcome  TEXT,
  criterion_review_status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE (evaluation_id, criterion_id)
);

CREATE TABLE evaluation_scores (
  evaluation_id          INTEGER PRIMARY KEY REFERENCES evaluations(id) ON DELETE CASCADE,
  sales_stage_percent    REAL,                      -- NULL when no number is published
  sales_stage_status     TEXT NOT NULL,             -- definitive | provisional | not_applicable | held | unsupported | incomplete | invalidated | blocked
  sales_stage_categories_json TEXT NOT NULL,        -- per-category percent / status / counts
  psychology_percent     REAL,
  psychology_status      TEXT NOT NULL,
  computed_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE evaluation_flags (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id        INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  flag_id              TEXT NOT NULL CHECK (flag_id IN ('misleading_product_claim','false_earnings_promise','fake_urgency','financial_pressure',
                         'refusal_not_respected','misrepresented_support','fabricated_social_proof','coercive_emotional_pressure',
                         'unsupported_customer_fit','unprofessional_conduct')),
  severity             TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  start_s              REAL,
  end_s                REAL,
  evidence_quote       TEXT,
  segments_json        TEXT NOT NULL,
  explanation          TEXT NOT NULL,
  interpretation       TEXT NOT NULL CHECK (interpretation IN ('confirmed_conduct','ambiguous')),
  verification_status  TEXT NOT NULL CHECK (verification_status IN ('quote_verified','quote_unverified','needs_human_review')),
  notes_json           TEXT NOT NULL,
  human_decision       TEXT NOT NULL DEFAULT 'pending' CHECK (human_decision IN ('pending','confirmed','dismissed','needs_discussion')),
  decided_by           TEXT,
  decided_at           TEXT,
  decision_note        TEXT
);
CREATE INDEX idx_evaluation_flags_eval ON evaluation_flags(evaluation_id);

CREATE TABLE evaluation_score_corrections (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id      INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  criterion_id       TEXT NOT NULL,
  original_outcome   TEXT NOT NULL CHECK (original_outcome IN ('0','1','2','3','N/A','NE')),
  corrected_outcome  TEXT NOT NULL CHECK (corrected_outcome IN ('0','1','2','3','N/A','NE')),
  reason             TEXT NOT NULL,
  corrected_by       TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_score_corrections_eval ON evaluation_score_corrections(evaluation_id);

CREATE TABLE evaluation_reports (
  evaluation_id  INTEGER PRIMARY KEY REFERENCES evaluations(id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('pending','generated','not_generated','failed')),
  report_json    TEXT,
  error          TEXT,
  generated_at   TEXT
);
