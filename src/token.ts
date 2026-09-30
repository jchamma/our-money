// The RiseUp token lives in D1 only as AES-256-GCM ciphertext; the key is the TOKEN_KEY Worker
// secret (32 random bytes, base64). Keeping it in the database lets either partner renew it
// from the phone (frame 7n). The token is never returned to the client or written to a log.
import { RiseupHttpError, riseupClient, type RiseupClient } from "./riseup";

const KEY = "riseup_token";
const SAVED_AT = "riseup_token_saved_at";
const EXPIRES_AT = "riseup_token_expires_at";
const STATUS = "riseup_token_status"; // 'ok' | 'expired'
const AAD = new TextEncoder().encode("family-finance:riseup_token:v1");
const LIFETIME_DAYS = 30; // RiseUp PATs last 30 days; the API doesn't report the expiry.

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function importKey(keyB64: string | undefined): Promise<CryptoKey> {
  const raw = keyB64 ? unb64(keyB64) : new Uint8Array();
  if (raw.length !== 32) throw new Error("TOKEN_KEY must be 32 bytes, base64");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(token: string, keyB64: string | undefined): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, await importKey(keyB64), new TextEncoder().encode(token));
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

export async function decryptToken(blob: string, keyB64: string | undefined): Promise<string> {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("unknown token format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: AAD }, await importKey(keyB64), unb64(ct));
  return new TextDecoder().decode(pt);
}

type TokenEnv = { DB: D1Database; TOKEN_KEY?: string; RISEUP_PAT?: string };

const setting = (db: D1Database, key: string) =>
  db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>().then((r) => r?.value ?? null);

const put = (db: D1Database, key: string, value: string) =>
  db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, value);

/** The current token, or null. RISEUP_PAT is the Phase 1 secret, read only until the first save. */
export async function loadRiseupToken(env: TokenEnv): Promise<string | null> {
  const blob = await setting(env.DB, KEY);
  if (blob) return decryptToken(blob, env.TOKEN_KEY);
  return env.RISEUP_PAT || null;
}

export type TokenState = { status: "ok" | "expired" | "missing"; expiresAt: string | null };

export async function tokenState(env: TokenEnv): Promise<TokenState> {
  const [blob, status, expiresAt] = await Promise.all([setting(env.DB, KEY), setting(env.DB, STATUS), setting(env.DB, EXPIRES_AT)]);
  if (!blob && !env.RISEUP_PAT) return { status: "missing", expiresAt: null };
  return { status: status === "expired" ? "expired" : "ok", expiresAt };
}

export type SaveResult = { ok: true; expiresAt: string } | { ok: false; reason: "invalid" | "rejected" | "unavailable" };

/**
 * Check a new token against RiseUp, then store it encrypted. A token RiseUp rejects is never stored.
 * @param month YYYY-MM to test the token with (the current month)
 */
export async function saveRiseupToken(
  env: TokenEnv,
  token: string,
  month: string,
  now = new Date(),
  client: (t: string) => RiseupClient = riseupClient,
): Promise<SaveResult> {
  // A token copied from a config line often brings its quote marks along (RISEUP_PAT="…").
  const t = token.trim().replace(/^(["'])(.*)\1$/, "$2");
  if (t.length < 16 || t.length > 512 || /\s/.test(t)) return { ok: false, reason: "invalid" };
  try {
    await client(t).budget(month);
  } catch (e) {
    if (e instanceof RiseupHttpError && (e.status === 401 || e.status === 403)) return { ok: false, reason: "rejected" };
    return { ok: false, reason: "unavailable" };
  }
  const expiresAt = new Date(now.getTime() + LIFETIME_DAYS * 86_400_000).toISOString();
  await env.DB.batch([
    put(env.DB, KEY, await encryptToken(t, env.TOKEN_KEY)),
    put(env.DB, SAVED_AT, now.toISOString()),
    put(env.DB, EXPIRES_AT, expiresAt),
    put(env.DB, STATUS, "ok"),
  ]);
  return { ok: true, expiresAt };
}

/** Called when RiseUp answers 401: the app then shows "the data isn't updating" (frame 7m). */
export const markTokenExpired = (db: D1Database) => put(db, STATUS, "expired").run();
