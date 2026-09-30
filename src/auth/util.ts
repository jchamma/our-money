// Small crypto and rate-limit helpers shared by the login methods.

const enc = new TextEncoder();

export const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A random secret for links, cookies and flow ids: 32 bytes, base64url. */
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** Hex SHA-256. Only hashes of secrets are stored. */
export async function sha256(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two strings of equal length. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A uniform 6-digit code (rejection sampling, no modulo bias). */
export function sixDigitCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

export const iso = (d: Date) => d.toISOString();
export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/**
 * Take one slot under `key` if fewer than `limit` were taken in the window. Atomic (a single
 * statement), so parallel requests can't overshoot, and nothing is written once the limit is hit.
 */
export async function take(db: D1Database, key: string, now: Date, windowMinutes: number, limit: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO login_attempts (key, at) SELECT ?1, ?2
       WHERE (SELECT count(*) FROM login_attempts WHERE key = ?1 AND at > ?3) < ?4 RETURNING id`,
    )
    .bind(key, iso(now), iso(addMinutes(now, -windowMinutes)), limit)
    .first();
  return row !== null;
}

/** The caller's IP for rate limits. IPv6 is bucketed by /64, since one household gets a whole /64. */
export function clientIp(header: string | undefined): string {
  if (!header) return "unknown";
  // Plain IPv4, or IPv6 carrying an IPv4 (::ffff:203.0.113.5): keep the whole address.
  if (!header.includes(":") || header.includes(".")) return header;
  const [head, tail = ""] = header.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = header.includes("::") && tail ? tail.split(":") : [];
  const groups = header.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Attempts under `key` in the window, without recording a new one. */
export async function attempts(db: D1Database, key: string, now: Date, windowMinutes: number): Promise<number> {
  const r = await db
    .prepare("SELECT count(*) AS n FROM login_attempts WHERE key = ? AND at > ?")
    .bind(key, iso(addMinutes(now, -windowMinutes)))
    .first<{ n: number }>();
  return r?.n ?? 0;
}
