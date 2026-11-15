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
}
