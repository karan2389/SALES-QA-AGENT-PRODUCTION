// Google service-account authentication that runs in the Cloudflare Workers runtime (WebCrypto only; no Node APIs, no libraries).
// Flow: sign an RS256 JWT with the service account private key, exchange it at the token endpoint for a short-lived access token.
// The private key is never logged, returned or included in error messages.

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}
export class GoogleAuthError extends Error {
  kind: "config" | "auth" | "network";
  constructor(kind: "config" | "auth" | "network", message: string) {
    super(message);
    this.kind = kind;
  }
}

export function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (!raw || raw.trim() === "") throw new GoogleAuthError("config", "GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  let j: any;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new GoogleAuthError("config", "GOOGLE_SERVICE_ACCOUNT_JSON is not valid single-line JSON");
  }
  if (j?.type !== "service_account" || typeof j.client_email !== "string" || typeof j.private_key !== "string" || !j.private_key.includes("BEGIN PRIVATE KEY"))
    throw new GoogleAuthError("config", "GOOGLE_SERVICE_ACCOUNT_JSON is not a service-account key (needs type, client_email, private_key)");
  const tokenUri = typeof j.token_uri === "string" ? j.token_uri : "https://oauth2.googleapis.com/token";
  if (!tokenUri.startsWith("https://")) throw new GoogleAuthError("config", "token_uri must be https");
  return { client_email: j.client_email, private_key: j.private_key, token_uri: tokenUri };
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\\n/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Build the signed JWT assertion (exported for tests). */
export async function buildJwtAssertion(sa: ServiceAccount, scope: string, nowSeconds: number): Promise<string> {
  const header = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(JSON.stringify({ iss: sa.client_email, scope, aud: sa.token_uri, iat: nowSeconds, exp: nowSeconds + 3600 }));
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    throw new GoogleAuthError("config", "the service-account private key could not be imported (is it a valid PKCS#8 RSA key?)");
  }
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64url(sig)}`;
}

export type FetchFn = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string>; headers: { get(name: string): string | null } }>;

const cache = new Map<string, { token: string; expiresAt: number }>();

/** Returns a cached access token or exchanges a new JWT. Errors never contain the key. */
export async function getAccessToken(sa: ServiceAccount, fetchFn: FetchFn, now: () => number = () => Date.now()): Promise<string> {
  const hit = cache.get(sa.client_email);
  if (hit && hit.expiresAt - 60_000 > now()) return hit.token;
  const assertion = await buildJwtAssertion(sa, SHEETS_SCOPE, Math.floor(now() / 1000));
  let res;
  try {
    res = await fetchFn(sa.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(assertion)}`,
    });
  } catch {
    throw new GoogleAuthError("network", "could not reach the Google token endpoint");
  }
  if (!res.ok) {
    let reason = "";
    try {
      const j = await res.json();
      reason = typeof j?.error === "string" ? j.error : "";
    } catch {
      /* ignore */
    }
    throw new GoogleAuthError("auth", `Google rejected the service-account sign-in (HTTP ${res.status}${reason ? `, ${reason}` : ""})`);
  }
  const j = await res.json();
  if (typeof j?.access_token !== "string") throw new GoogleAuthError("auth", "Google returned no access token");
  cache.set(sa.client_email, { token: j.access_token, expiresAt: now() + (typeof j.expires_in === "number" ? j.expires_in : 3600) * 1000 });
  return j.access_token;
}

export function clearTokenCache(): void {
  cache.clear();
}
