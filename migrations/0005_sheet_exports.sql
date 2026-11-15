-- Additive only. Tracks the Google Sheets reporting copy of D1 evaluation data. D1 stays the source of truth.
--
--   sheet_exports      one row per export run (status, counts, error). Also acts as a lock: a 'running' row blocks a concurrent export.
--   sheet_export_rows  one row per (evaluation, criterion, worksheet): where it lives in the sheet, a hash of what was written,
--                      and whether the last write was confirmed by Google ('exported'), failed, or replaced by a withdrawn marker.
--                      No foreign key to evaluations on purpose: a row must still be withdrawable if its evaluation is invalidated.

CREATE TABLE sheet_exports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  scope           TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('running','success','partial','failed')),
  rows_appended   INTEGER NOT NULL DEFAULT 0,
  rows_updated    INTEGER NOT NULL DEFAULT 0,
  rows_skipped    INTEGER NOT NULL DEFAULT 0,
  rows_withdrawn  INTEGER NOT NULL DEFAULT 0,
  rows_failed     INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);

CREATE TABLE sheet_export_rows (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id     INTEGER NOT NULL,
  criterion_id      TEXT NOT NULL,
  worksheet         TEXT NOT NULL,
  row_number        INTEGER,
  row_hash          TEXT,
  status            TEXT NOT NULL CHECK (status IN ('exported','failed','withdrawn')),
  last_error        TEXT,
  last_exported_at  TEXT,
  last_run_id       INTEGER REFERENCES sheet_exports(id),
  UNIQUE (evaluation_id, criterion_id, worksheet)
);
CREATE INDEX idx_sheet_export_rows_ws ON sheet_export_rows(worksheet, status);
