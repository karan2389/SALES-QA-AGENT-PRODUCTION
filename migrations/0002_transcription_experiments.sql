-- Separate store for transcription quality experiments. The production `transcripts` table is untouched.
CREATE TABLE transcription_experiments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id              INTEGER NOT NULL REFERENCES calls(id),
  label                TEXT NOT NULL,         -- e.g. vad, hi, gap_1
  transcription_model  TEXT NOT NULL,
  options_json         TEXT NOT NULL,         -- Whisper options used (never the audio)
  audio_range_json     TEXT,                  -- byte/second range if a slice of the recording was used
  language             TEXT,
  transcript_text      TEXT,
  transcription_status TEXT NOT NULL CHECK (transcription_status IN ('completed','failed')),
  segments_json        TEXT,                  -- full Whisper output minus the text/vtt duplicates
  error                TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (call_id, label)
);
