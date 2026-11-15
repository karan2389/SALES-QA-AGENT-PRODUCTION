// Types based on the verified Callyzer v2.3 contract (see README / test notes).

export type CallMethod = "PhoneCall" | "WhatsAppCall";
export type CallMode = "Voice" | "Video";

/** One call-log record as returned by /call-log/history and /call-log/get. */
export interface CallRecord {
  id: string;
  emp_name: string;
  emp_code: string;
  emp_number: string;
  emp_country_code: string;
  emp_tags: string[];
  client_name: string;
  client_country_code: string;
  client_number: string;
  /** seconds */
  duration: number;
  call_type: string;
  /** yyyy-mm-dd */
  call_date: string;
  /** 24h time */
  call_time: string;
  note: string;
  call_recording_url: string;
  lead_id: string;
  crm_status: string;
  reminder_date: string;
  reminder_time: string;
  synced_at: string;
  /** Observed null in /call-log/history rows, string in /call-log/get rows. */
  modified_at: string | null;
  call_method: string;
  call_mode: string;
  /** seconds */
  ringing_time: number;
}

export interface HistoryRequest {
  /** UNIX seconds, UTC */
  call_from: number;
  /** UNIX seconds, UTC */
  call_to: number;
  call_method: CallMethod;
  call_mode: CallMode;
  page_no?: number;
  page_size?: number;
  /** Registered employee numbers; country code separated by '-' if present. */
  emp_numbers?: string[];
}

export interface HistoryPage {
  records: CallRecord[];
  totalRecords: number;
  pageNo: number;
  pageSize: number;
  message: string;
  /** Raw response envelope (contains customer data; never log it). */
  raw: unknown;
}

export interface DownloadedRecording {
  bytes: Uint8Array;
  contentType: string | null;
  size: number;
}

export type CallyzerErrorKind =
  | "config"
  | "auth"
  | "rate_limit"
  | "http"
  | "network"
  | "malformed"
  | "download";
