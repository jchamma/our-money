// Sessions: a random token in an HttpOnly __Host- cookie; D1 keeps only its SHA-256.
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Member } from "../env";
import { addMinutes, iso, randomToken, sha256 } from "./util";

const SESSION = "ff_session";
const FLOW = "ff_flow";
export const SESSION_DAYS = 7;
const cookieBase = { path: "/", secure: true, httpOnly: true, sameSite: "Lax", prefix: "host" } as const;

/** Delete expired login state. Runs from the daily cron, so abandoned attempts can't pile up. */
export async function pruneAuth(db: D1Database, now: Date) {
  const dayAgo = iso(addMinutes(now, -24 * 60));
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(iso(now)),
    db.prepare("DELETE FROM auth_flows WHERE expires_at <= ?").bind(iso(now)),
    db.prepare("DELETE FROM login_attempts WHERE at <= ?").bind(dayAgo),
    db.prepare("DELETE FROM email_codes WHERE expires_at <= ?").bind(dayAgo),
    db.prepare("DELETE FROM invites WHERE expires_at <= ? AND used_at IS NULL").bind(dayAgo),
  ]);
}

/**
 * Google/email modes: members whose email is no longer allowed lose their row (and with it their
 * sessions), so a new allowed email can take the freed place in the couple.
 */
export async function dropRemovedMembers(db: D1Database, allowed: string[]) {
  const marks = allowed.map(() => "?").join(", ");
  await db.prepare(`DELETE FROM members WHERE email IS NOT NULL AND lower(email) NOT IN (${marks})`).bind(...allowed).run();
}

/** Start a session for a member, replacing any session this browser already had. */
export async function startSession(c: Context<AppEnv>, memberId: number, method: string, now: Date) {
  const token = randomToken();
  const expires = addMinutes(now, SESSION_DAYS * 24 * 60);
  const previous = getCookie(c, SESSION, "host");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(previous ? await sha256(previous) : ""),
    c.env.DB.prepare("INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), memberId, iso(expires)),
    c.env.DB.prepare("INSERT INTO audit_log (member_id, action, detail) VALUES (?, 'login', ?)").bind(memberId, JSON.stringify({ method })),
  ]);
  setCookie(c, SESSION, token, { ...cookieBase, maxAge: SESSION_DAYS * 86_400 });
}

/**
 * The logged-in member, or null. In google and email modes the member's email must still be
 * allowed, so removing an email at setup takes effect at once, not after the session expires.
 */
export async function currentMember(c: Context<AppEnv>, now: Date): Promise<Member | null> {
  const token = getCookie(c, SESSION, "host");
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT m.id, m.name, m.name_confirmed, m.email FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), iso(now))
    .first<{ id: number; name: string; name_confirmed: number; email: string | null }>();
  if (!row) return null;
  const auth = c.var.auth;
  if (auth.mode !== "passkey" && !(row.email && auth.allowedEmails.includes(row.email.toLowerCase()))) return null;
  return { id: row.id, name: row.name, nameConfirmed: row.name_confirmed === 1 };
}

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, SESSION, "host");
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  deleteCookie(c, SESSION, { path: "/", secure: true, prefix: "host" });
}

/** Short-lived state between the two halves of a login, keyed by a random id in a cookie. */
export async function startFlow(c: Context<AppEnv>, kind: string, data: unknown, now: Date, minutes = 10) {
  const id = randomToken();
  await c.env.DB.prepare("INSERT INTO auth_flows (id, kind, data, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(id), kind, JSON.stringify(data), iso(addMinutes(now, minutes)))
    .run();
  setCookie(c, FLOW, id, { ...cookieBase, maxAge: minutes * 60 });
}

/** Read and consume the flow (single use). Null if missing, expired or of another kind. */
export async function takeFlow<T>(c: Context<AppEnv>, kind: string, now: Date): Promise<T | null> {
  const id = getCookie(c, FLOW, "host");
  if (!id) return null;
  deleteCookie(c, FLOW, { path: "/", secure: true, prefix: "host" });
  const row = await c.env.DB.prepare("DELETE FROM auth_flows WHERE id = ? RETURNING kind, data, expires_at")
    .bind(await sha256(id))
    .first<{ kind: string; data: string; expires_at: string }>();
  if (!row || row.kind !== kind || row.expires_at <= iso(now)) return null;
  return JSON.parse(row.data) as T;
}
