// Runtime bindings and secrets.
export interface Env {
  AI: Ai;
  DB: D1Database;
  RECORDINGS: R2Bucket;

  /** Guards the /admin/* routes. Set in .dev.vars locally or via `wrangler secret put`. Routes refuse all requests if unset. */
  ADMIN_TOKEN?: string;

  // Secrets / vars (set via .dev.vars locally, `wrangler secret put` when deployed)
  CALLYZER_API_KEY?: string;
  CALLYZER_BASE_URL?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_SPREADSHEET_ID?: string;

  /** MRV1.0 durable evaluation queue (producer binding). Optional until the queue exists: the job routes answer 503 without it. */
  EVAL_QUEUE?: Queue<import("./mrv1/jobs/types.ts").JobMessage>;
  /** "1" re-enables the synchronous four-pass route (/admin/mrv1/evaluate) for controlled local use only. Off by default. */
  MRV1_ALLOW_SYNC?: string;
}
