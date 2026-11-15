-- Additive only. No existing table is altered and no existing row is changed by this migration.
--
-- 1) call_type_labels: append-only history of the human-confirmed business call type of each call (rubric section 13).
--    At most ONE active (non-superseded) label per call (partial unique index). The evaluator treats only an active
--    'human_confirmed' label as authoritative; an 'unverified_test_override' row is audit history and never active.
-- 2) evaluation_invalidations: marks an existing evaluation as test_only / invalidated / superseded WITHOUT touching or deleting it.
--    (evaluations.human_review_status has a CHECK constraint that cannot be extended without rebuilding the table.)
--    A row here also blocks deleting the evaluation (foreign key), which protects the audit trail.
-- 3) valid_evaluations / valid_evaluation_criteria: the only views manager-facing reporting (e.g. the Google Sheets export)
--    should read. They exclude every invalidated evaluation.

CREATE TABLE call_type_labels (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id            INTEGER NOT NULL REFERENCES calls(id),
  business_call_type TEXT NOT NULL CHECK (business_call_type IN
    ('new_webinar_prospect','follow_up','renewal','continuation','support_existing_customer','no_conversation','other_unclassified')),
  verification       TEXT NOT NULL CHECK (verification IN ('human_confirmed','unverified_test_override')),
  labelled_by        TEXT NOT NULL,
  basis              TEXT,
  labelled_at        TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_at      TEXT
);
CREATE UNIQUE INDEX uq_call_type_labels_active ON call_type_labels(call_id) WHERE superseded_at IS NULL;
CREATE INDEX idx_call_type_labels_call ON call_type_labels(call_id);

CREATE TABLE evaluation_invalidations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id   INTEGER NOT NULL UNIQUE REFERENCES evaluations(id),
  status          TEXT NOT NULL CHECK (status IN ('test_only','invalidated','superseded')),
  reason          TEXT NOT NULL,
  invalidated_by  TEXT NOT NULL,
  invalidated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIEW valid_evaluations AS
  SELECT e.* FROM evaluations e
  WHERE NOT EXISTS (SELECT 1 FROM evaluation_invalidations i WHERE i.evaluation_id = e.id);

CREATE VIEW valid_evaluation_criteria AS
  SELECT c.* FROM evaluation_criteria c
  WHERE c.evaluation_id IN (SELECT id FROM valid_evaluations);
