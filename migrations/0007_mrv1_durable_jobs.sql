-- MRV1.0 durable evaluation jobs (Cloudflare Queues + D1 job state). ADDITIVE ONLY: nothing existing is altered, dropped or deleted.
-- NOT applied remotely by this change; it is tested against an in-memory SQLite database with migrations 0001-0007.
--
--   evaluation_jobs        one durable job per (call, rubric, prompt revision). The idempotency key makes duplicate requests harmless.
--                          Snapshots the human-confirmed call type and the transcript hash, so a job that outlives either can be recognised as stale.
--   evaluation_job_stages  one row per stage: gate, the four model passes, finalize. Holds the validated-pass raw model output (not the transcript),
--                          attempt counts, a lease (so a duplicate or crashed delivery cannot run a stage twice) and a safe error code.
--
-- A job never becomes 'completed' until the evaluation row (and its criteria, scores, flags and report) has been written by the existing
-- atomic batch. The queue path never calls the Google Sheets export.

CREATE TABLE evaluation_jobs (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id                       INTEGER NOT NULL REFERENCES calls(id),
  callyzer_call_id              TEXT NOT NULL,
  rubric_version                TEXT NOT NULL,
  prompt_version                TEXT NOT NULL,             -- includes the revision slot, e.g. mrv1-prompt-v2#r2
  idempotency_key               TEXT NOT NULL UNIQUE,      -- '<call_id>:<rubric_version>:<prompt_version>'
  transcript_source             TEXT NOT NULL,
  transcript_sha256             TEXT NOT NULL,
  call_type_label               TEXT NOT NULL,             -- snapshot of the confirmed call type when the job was created
  call_type_labelled_at         TEXT NOT NULL,
  acknowledge_conflict          INTEGER NOT NULL DEFAULT 0,
  acknowledge_transcript_review INTEGER NOT NULL DEFAULT 0,
  status                        TEXT NOT NULL CHECK (status IN
    ('queued','running','retrying','partially_completed','completed','failed','requires_human_review','cancelled','invalidated')),
  current_stage                 TEXT,
  attempt_count                 INTEGER NOT NULL DEFAULT 0, -- total stage attempts across the job
  evaluation_id                 INTEGER REFERENCES evaluations(id),
  last_error_code               TEXT,                       -- machine-readable
  last_error                    TEXT,                       -- safe description: never transcript text, prompts or credentials
  retry_eligible                INTEGER NOT NULL DEFAULT 0,
  requested_by                  TEXT,
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT NOT NULL,
  started_at                    TEXT,
  completed_at                  TEXT
);
CREATE INDEX idx_evaluation_jobs_call ON evaluation_jobs(call_id);
CREATE INDEX idx_evaluation_jobs_status ON evaluation_jobs(status);
-- At most one non-terminal job per call: a second request while one is in flight returns the existing job.
CREATE UNIQUE INDEX uq_evaluation_jobs_active_call ON evaluation_jobs(call_id)
  WHERE status IN ('queued','running','retrying','partially_completed','requires_human_review');

CREATE TABLE evaluation_job_stages (
  job_id           INTEGER NOT NULL REFERENCES evaluation_jobs(id) ON DELETE CASCADE,
  stage            TEXT NOT NULL,                           -- gate | stages_01_06 | stages_07_12 | stages_13_19 | psychology_report | finalize
  ordinal          INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','skipped')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  started_at       TEXT,
  completed_at     TEXT,
  error_code       TEXT,
  error_message    TEXT,
  raw_output       TEXT,                                    -- the model's response for a pass (validated before the stage is marked completed)
  usage_json       TEXT,
  PRIMARY KEY (job_id, stage)
);
CREATE INDEX idx_evaluation_job_stages_status ON evaluation_job_stages(status);
