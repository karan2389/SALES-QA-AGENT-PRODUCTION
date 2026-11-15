// Minimal Google Sheets v4 REST client (fetch only). Retries rate limits and transient errors with backoff; never logs tokens.
import type { FetchFn } from "./google-auth.ts";
import type { Cell } from "./rows.ts";

export class SheetsApiError extends Error {
  kind: "auth" | "not_found" | "rate_limit" | "http" | "network" | "unconfirmed";
  status: number;
  constructor(kind: SheetsApiError["kind"], status: number, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export interface SheetInfo {
  title: string;
  sheetId: number;
}
export interface SheetsApi {
  listSheets(): Promise<SheetInfo[]>;
  addSheets(titles: string[]): Promise<SheetInfo[]>;
  /** Freeze the header row and make it bold (cosmetic; only called for newly created worksheets). */
  formatHeader(sheetId: number, columnCount: number): Promise<void>;
  getValues(range: string): Promise<unknown[][]>;
  batchUpdateValues(data: Array<{ range: string; values: Cell[][] }>): Promise<{ totalUpdatedRows: number; totalUpdatedCells: number }>;
}

export interface SheetsClientOptions {
  spreadsheetId: string;
  getToken: () => Promise<string>;
  fetchFn: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";
export const quoteSheet = (title: string) => `'${title.replace(/'/g, "''")}'`;

export function createSheetsClient(o: SheetsClientOptions): SheetsApi {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = o.maxRetries ?? 3;

  async function call(method: string, path: string, body?: unknown): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      const token = await o.getToken();
      let res;
      try {
        res = await o.fetchFn(`${BASE}/${o.spreadsheetId}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        if (attempt < maxRetries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new SheetsApiError("network", 0, "could not reach the Google Sheets API");
      }
      if (res.ok) return res.json();
      const retriable = res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
      if (retriable && attempt < maxRetries) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      let msg = "";
      try {
        const j = await res.json();
        msg = typeof j?.error?.message === "string" ? j.error.message.slice(0, 200) : "";
      } catch {
        /* ignore */
      }
      if (res.status === 401 || res.status === 403) throw new SheetsApiError("auth", res.status, `Google Sheets refused access (HTTP ${res.status}${msg ? `: ${msg}` : ""}). Is the spreadsheet shared with the service account as Editor?`);
      if (res.status === 404) throw new SheetsApiError("not_found", 404, "spreadsheet or range not found (check GOOGLE_SPREADSHEET_ID and the worksheet name)");
      if (res.status === 429) throw new SheetsApiError("rate_limit", 429, "Google Sheets rate limit persisted after retries");
      throw new SheetsApiError("http", res.status, `Google Sheets API error (HTTP ${res.status}${msg ? `: ${msg}` : ""})`);
    }
  }

  return {
    async listSheets() {
      const j = await call("GET", "?fields=sheets.properties(sheetId,title)");
      return (j.sheets ?? []).map((s: any) => ({ title: s.properties.title as string, sheetId: s.properties.sheetId as number }));
    },
    async addSheets(titles) {
      if (titles.length === 0) return [];
      const j = await call("POST", ":batchUpdate", { requests: titles.map((title) => ({ addSheet: { properties: { title } } })) });
      return (j.replies ?? []).map((r: any) => ({ title: r.addSheet.properties.title as string, sheetId: r.addSheet.properties.sheetId as number }));
    },
    async formatHeader(sheetId, columnCount) {
      await call("POST", ":batchUpdate", {
        requests: [
          { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
          { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } },
        ],
      });
    },
    async getValues(range) {
      const j = await call("GET", `/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
      return (j.values ?? []) as unknown[][];
    },
    async batchUpdateValues(data) {
      const j = await call("POST", "/values:batchUpdate", { valueInputOption: "RAW", data });
      return { totalUpdatedRows: Number(j.totalUpdatedRows ?? 0), totalUpdatedCells: Number(j.totalUpdatedCells ?? 0) };
    },
  };
}
