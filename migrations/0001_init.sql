-- Phase 1 minimal schema. Customer names/numbers are intentionally NOT stored.

CREATE TABLE sales_agents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_number TEXT NOT NULL UNIQUE,   -- Callyzer emp_number (primary identifier)
  employee_code   TEXT,                   -- Callyzer emp_code (may be empty -> NULL)
  employee_name   TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE calls (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  callyzer_call_id  TEXT NOT NULL UNIQUE, -- Callyzer call-log id (external id)
  sales_agent_id    INTEGER NOT NULL REFERENCES sales_agents(id),
  call_date         TEXT,                 -- yyyy-mm-dd
  call_time         TEXT,                 -- 24h time
  duration_seconds  INTEGER NOT NULL,
  call_type         TEXT,                 -- Incoming / Outgoing ...
  call_method       TEXT,
  call_mode         TEXT,
  r2_object_key     TEXT NOT NULL,
  audio_content_type TEXT,
  audio_size_bytes  INTEGER,
  processing_status TEXT NOT NULL DEFAULT 'audio_stored'
    CHECK (processing_status IN ('audio_stored','transcribing','transcribed','transcription_failed','evaluated','failed')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_calls_sales_agent ON calls(sales_agent_id);

CREATE TABLE transcripts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id              INTEGER NOT NULL REFERENCES calls(id),
  transcription_model  TEXT NOT NULL,
  language             TEXT,
  transcript_text      TEXT,
  transcription_status TEXT NOT NULL CHECK (transcription_status IN ('completed','failed')),
  segments_json        TEXT,              -- Whisper segments/timestamps + transcription_info, if returned
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (call_id, transcription_model)
);
