import type {
  CallRecord,
  CallyzerErrorKind,
  DownloadedRecording,
  HistoryPage,
  HistoryRequest,
} from "./types.ts";

export const DEFAULT_BASE_URL = "https://api1.callyzer.co/api/v2.3/";
export const PAGE_SIZE = 50;
export const MAX_IDS_PER_GET = 20;
/** Callyzer allows one request per two seconds; keep a small margin. */
export const MIN_INTERVAL_MS = 2100;

/**
 * Errors never carry tokens, URLs, phone numbers or response bodies.
 */
export class CallyzerError extends Error {
  readonly kind: CallyzerErrorKind;
  readonly status?: number;
  constructor(kind: CallyzerErrorKind, message: string, status?: number) {
    super(message);
    this.name = "CallyzerError";
    this.kind = kind;
    this.status = status;
  }
}

export interface CallyzerClientOptions {
  apiKey: string;
  baseUrl?: string;
  minIntervalMs?: number;
  /** Retries after the first attempt, for 429 / 5xx / network failures. */
  maxRetries?: number;
  requestTimeoutMs?: number;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class CallyzerClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  private lastRequestAt = 0;
  /** Serialises requests so the interval holds even with concurrent callers. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: CallyzerClientOptions) {
    if (!opts.apiKey || !opts.apiKey.trim()) {
      throw new CallyzerError("config", "CALLYZER_API_KEY is missing or empty");
    }
    this.apiKey = opts.apiKey.trim();
    const base = (opts.baseUrl && opts.baseUrl.trim()) || DEFAULT_BASE_URL;
    this.baseUrl = base.endsWith("/") ? base : base + "/";
    try {
      new URL(this.baseUrl);
    } catch {
      throw new CallyzerError("config", "CALLYZER_BASE_URL is not a valid URL");
    }
    this.minIntervalMs = Math.max(opts.minIntervalMs ?? MIN_INTERVAL_MS, MIN_INTERVAL_MS);
    this.maxRetries = opts.maxRetries ?? 4;
    this.timeoutMs = opts.requestTimeoutMs ?? 30_000;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.sleep = opts.sleepFn ?? defaultSleep;
  }

  /** Build a client from env-like values (Worker env or process.env). */
  static fromEnv(env: { CALLYZER_API_KEY?: string; CALLYZER_BASE_URL?: string }): CallyzerClient {
    return new CallyzerClient({ apiKey: env.CALLYZER_API_KEY ?? "", baseUrl: env.CALLYZER_BASE_URL });
  }

  // ---------------------------------------------------------------- endpoints

  /** POST /call-log/history, one page (page size fixed at 50 unless overridden). */
  async getCallHistoryPage(req: HistoryRequest): Promise<HistoryPage> {
    if (!(req.call_from < req.call_to)) {
      throw new CallyzerError("config", "call_from must be less than call_to");
    }
    const body: Record<string, unknown> = {
      call_from: req.call_from,
      call_to: req.call_to,
      call_method: req.call_method,
      call_mode: req.call_mode,
      page_no: req.page_no ?? 1,
      page_size: req.page_size ?? PAGE_SIZE,
    };
    if (req.emp_numbers && req.emp_numbers.length > 0) body.emp_numbers = req.emp_numbers;

    const json = await this.post("/call-log/history", body);
    const records = parseRecords(json);
    return {
      records,
      totalRecords: numberOr(json.total_records, records.length),
      pageNo: numberOr(json.page_no, body.page_no as number),
      pageSize: numberOr(json.page_size, body.page_size as number),
      message: typeof json.message === "string" ? json.message : "",
      raw: json,
    };
  }

  /** Async-iterate history pages. Caller must bound `maxPages` (no bulk ingestion in Phase 1). */
  async *iterateCallHistory(req: HistoryRequest, maxPages: number): AsyncGenerator<HistoryPage> {
    for (let page = req.page_no ?? 1, n = 0; n < maxPages; page++, n++) {
      const result = await this.getCallHistoryPage({ ...req, page_no: page });
      yield result;
      if (result.records.length === 0 || page * result.pageSize >= result.totalRecords) return;
    }
  }

  /** POST /call-log/get. Chunks into batches of at most 20 ids. */
  async getCallsByIds(ids: string[]): Promise<CallRecord[]> {
    const unique = [...new Set(ids.filter((i) => typeof i === "string" && i.length > 0))];
    if (unique.length === 0) throw new CallyzerError("config", "at least one unique id is required");
    const out: CallRecord[] = [];
    for (let i = 0; i < unique.length; i += MAX_IDS_PER_GET) {
      const json = await this.post("/call-log/get", { unique_ids: unique.slice(i, i + MAX_IDS_PER_GET) });
      out.push(...parseRecords(json));
    }
    return out;
  }

  // --------------------------------------------------------------- recordings

  /**
   * Download one recording. Deliberately sends NO Authorization header:
   * verified unnecessary, and the token must never go to a recording host.
   * URLs may expire, so failures are reported as a "download" error (no URL in message).
   */
  async downloadRecording(url: string, opts: { maxBytes?: number } = {}): Promise<DownloadedRecording> {
    if (!hasValidRecordingUrl(url)) {
      throw new CallyzerError("download", "recording URL is missing or not a valid http(s) URL");
    }
    const maxBytes = opts.maxBytes ?? 100 * 1024 * 1024;
    let res: Response;
    try {
      res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs * 4) });
    } catch (e) {
      throw new CallyzerError("download", `recording download failed: ${errName(e)}`);
    }
    if (!res.ok) {
      const hint = res.status === 403 || res.status === 404 || res.status === 410 ? " (URL may have expired)" : "";
      throw new CallyzerError("download", `recording download returned HTTP ${res.status}${hint}`, res.status);
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      throw new CallyzerError("download", `recording body read failed: ${errName(e)}`);
    }
    if (bytes.length === 0) throw new CallyzerError("download", "recording is empty");
    if (bytes.length > maxBytes) throw new CallyzerError("download", "recording exceeds size limit");
    if (!looksLikeMp3(bytes)) throw new CallyzerError("download", "downloaded file is not a valid MP3");
    return { bytes, contentType: res.headers.get("content-type"), size: bytes.length };
  }

  // ------------------------------------------------------------------ plumbing

  private post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const run = () => this.postWithRetry(path, body);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async postWithRetry(path: string, body: unknown): Promise<Record<string, unknown>> {
    const url = new URL(path.replace(/^\//, ""), this.baseUrl).toString();
    let lastErr: CallyzerError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();

      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        lastErr = new CallyzerError("network", `network failure calling ${path}: ${errName(e)}`);
        await this.sleep(backoffMs(attempt));
        continue;
      }
      this.lastRequestAt = Date.now();

      if (res.status === 401 || res.status === 403) {
        throw new CallyzerError("auth", `authentication/authorization failed (HTTP ${res.status}) on ${path}`, res.status);
      }
      if (res.status === 429) {
        lastErr = new CallyzerError("rate_limit", `rate limited (HTTP 429) on ${path}`, 429);
        await this.sleep(retryAfterMs(res.headers.get("retry-after")) ?? backoffMs(attempt));
        continue;
      }
      if (res.status >= 500) {
        lastErr = new CallyzerError("http", `server error HTTP ${res.status} on ${path}`, res.status);
        await this.sleep(backoffMs(attempt));
        continue;
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        if (!res.ok) throw new CallyzerError("http", `HTTP ${res.status} on ${path}`, res.status);
        throw new CallyzerError("malformed", `non-JSON response from ${path}`, res.status);
      }
      if (!res.ok) {
        throw new CallyzerError("http", `HTTP ${res.status} on ${path}: ${safeApiMessage(json)}`, res.status);
      }
      if (!isObject(json)) throw new CallyzerError("malformed", `unexpected response shape from ${path}`);
      return json;
    }
    throw lastErr ?? new CallyzerError("network", `request to ${path} failed`);
  }
}

// ------------------------------------------------------------------ helpers

export function hasValidRecordingUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Phase 1 rule: process only calls with a valid recording URL and duration > 0. */
export function isProcessableCall(r: Pick<CallRecord, "call_recording_url" | "duration">): boolean {
  return hasValidRecordingUrl(r.call_recording_url) && typeof r.duration === "number" && r.duration > 0;
}

/** ID3v2 tag ("ID3") or MPEG audio frame sync (0xFFEx). */
export function looksLikeMp3(b: Uint8Array): boolean {
  if (b.length < 4) return false;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true;
  return b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
}

function parseRecords(json: Record<string, unknown>): CallRecord[] {
  if (!Array.isArray(json.result)) throw new CallyzerError("malformed", "response 'result' is not an array");
  return json.result.map((row, i) => {
    if (!isObject(row) || typeof row.id !== "string" || !row.id) {
      throw new CallyzerError("malformed", `record ${i} is missing a string 'id'`);
    }
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      emp_name: str(r.emp_name),
      emp_code: str(r.emp_code),
      emp_number: str(r.emp_number),
      emp_country_code: str(r.emp_country_code),
      emp_tags: Array.isArray(r.emp_tags) ? r.emp_tags.filter((t): t is string => typeof t === "string") : [],
      client_name: str(r.client_name),
      client_country_code: str(r.client_country_code),
      client_number: str(r.client_number),
      duration: num(r.duration),
      call_type: str(r.call_type),
      call_date: str(r.call_date),
      call_time: str(r.call_time),
      note: str(r.note),
      call_recording_url: str(r.call_recording_url),
      lead_id: str(r.lead_id),
      crm_status: str(r.crm_status),
      reminder_date: str(r.reminder_date),
      reminder_time: str(r.reminder_time),
      synced_at: str(r.synced_at),
      modified_at: typeof r.modified_at === "string" ? r.modified_at : null,
      call_method: str(r.call_method),
      call_mode: str(r.call_mode),
      ringing_time: num(r.ringing_time),
    };
  });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numberOr = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown error");

function backoffMs(attempt: number): number {
  return Math.min(2000 * 2 ** attempt, 30_000);
}

function retryAfterMs(h: string | null): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  return Number.isFinite(s) && s >= 0 ? Math.min(s * 1000, 60_000) : undefined;
}

/** API message, truncated and stripped of long digit runs (possible phone numbers). */
function safeApiMessage(json: unknown): string {
  const m = isObject(json) && typeof json.message === "string" ? json.message : "no message";
  return m.replace(/\d{6,}/g, "[redacted]").slice(0, 160);
}
