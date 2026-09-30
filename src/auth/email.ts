// Login with a 6-digit code sent by email through Brevo (frames 7j–7k).
// "Send a code" answers identically, and just as fast, for every address; the code is created and
// sent in the background, and only for the emails chosen at setup. Codes are stored hashed, expire
// in 10 minutes, work once, allow 5 tries each, and only the newest code counts. Every email has a
// daily budget of 20 tries; the price is that a stranger can spend it and block email login for a day.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import type { AuthConfig } from "./config";
import { dropRemovedMembers, startSession } from "./session";
import { addMinutes, clientIp, iso, safeEqual, sha256, sixDigitCode, take } from "./util";

type EmailCfg = Extract<AuthConfig, { mode: "email" }>;

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const CODE_MINUTES = 10;
const TRIES_PER_CODE = 5;
const TRIES_PER_EMAIL_DAY = 20;
const SENDS_PER_EMAIL_HOUR = 5;
const SENDS_PER_IP_HOUR = 20;
const VERIFY_PER_IP_15MIN = 30;
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

const ip = (c: Context<AppEnv>) => clientIp(c.req.header("CF-Connecting-IP"));
const codeHash = (email: string, code: string, pepper: string) => sha256(`${email}:${code}:${pepper}`);

async function createAndSend(c: Context<AppEnv>, cfg: EmailCfg, email: string, now: Date, doFetch: typeof fetch) {
  const code = sixDigitCode();
  await c.env.DB.prepare("INSERT INTO email_codes (email, code_hash, expires_at) VALUES (?, ?, ?)")
    .bind(email, await codeHash(email, code, c.env.TOKEN_KEY!), iso(addMinutes(now, CODE_MINUTES)))
    .run();
  try {
    const res = await doFetch(BREVO_URL, {
      method: "POST",
      headers: { "api-key": cfg.brevoKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { email: cfg.from, name: cfg.fromName },
        to: [{ email }],
        subject: `קוד הכניסה שלך: ${code}`,
        textContent: `הקוד שלך לכניסה ל${cfg.fromName}: ${code}\nהקוד בתוקף ל-${CODE_MINUTES} דקות. אם לא ביקשת קוד, אפשר להתעלם מהמייל.`,
      }),
      redirect: "manual",
    });
    if (!res.ok) console.error(`brevo send failed: ${res.status}`);
  } catch {
    console.error("brevo send failed: network");
  }
}

export function emailRoutes(doFetch: typeof fetch, now: () => Date) {
  const r = new Hono<AppEnv>();
  const cfg = (c: Context<AppEnv>) => c.var.auth as EmailCfg;

  r.post("/start", async (c) => {
    const t = now();
    const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
    const email = (body.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return c.json({ error: "invalid" }, 400);
    // The IP limit comes first, so one source can't exhaust an address's sends. Limits apply to
    // every address alike, so they reveal nothing about who is allowed.
    if (!(await take(c.env.DB, `email-send-ip:${ip(c)}`, t, 60, SENDS_PER_IP_HOUR))) return c.json({ error: "rate" }, 429);
    if (!(await take(c.env.DB, `email-send:${email}`, t, 60, SENDS_PER_EMAIL_HOUR))) return c.json({ error: "rate" }, 429);
    if (cfg(c).allowedEmails.includes(email)) c.executionCtx.waitUntil(createAndSend(c, cfg(c), email, t, doFetch));
    return c.json({ ok: true });
  });

  r.post("/verify", async (c) => {
    const t = now();
    const invalid = () => c.json({ error: "invalid" }, 400);
    if (!(await take(c.env.DB, `email-verify-ip:${ip(c)}`, t, 15, VERIFY_PER_IP_15MIN))) return c.json({ error: "rate" }, 429);
    const body = await c.req.json<{ email?: string; code?: string }>().catch(() => ({}) as { email?: string; code?: string });
    const email = (body.email ?? "").trim().toLowerCase();
    const code = (body.code ?? "").trim();
    if (!EMAIL.test(email) || !/^\d{6}$/.test(code)) return invalid();
    // Every try spends from the address's daily budget, atomically, before anything is compared.
    // Once it's spent the answer is "try later" (it applies to every address alike, so it leaks nothing).
    if (!(await take(c.env.DB, `email-verify:${email}`, t, 24 * 60, TRIES_PER_EMAIL_DAY))) return c.json({ error: "rate" }, 429);

    // Claim one try on the newest live code only (older ones don't multiply the odds). Atomic, so
    // parallel guesses can't share a try. No allowlist check first: codes exist only for allowed
    // emails, so this matches nothing for anyone else and both paths take the same time.
    const live = await c.env.DB.prepare(
      `UPDATE email_codes SET attempts = attempts + 1
       WHERE id = (SELECT id FROM email_codes WHERE email = ?1 AND used_at IS NULL AND expires_at > ?2 ORDER BY id DESC LIMIT 1)
         AND attempts < ?3
       RETURNING id, code_hash`,
    )
      .bind(email, iso(t), TRIES_PER_CODE)
      .first<{ id: number; code_hash: string }>();
    const hash = await codeHash(email, code, c.env.TOKEN_KEY!);
    if (!live || !safeEqual(hash, live.code_hash)) return invalid();
    const match = live;
    const used = await c.env.DB.prepare("UPDATE email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL").bind(iso(t), match.id).run();
    if (used.meta.changes !== 1) return invalid();

    let member = await c.env.DB.prepare("SELECT id FROM members WHERE email = ?").bind(email).first<{ id: number }>();
    if (!member) {
      await dropRemovedMembers(c.env.DB, cfg(c).allowedEmails);
      try {
        member = await c.env.DB.prepare("INSERT INTO members (name, email) VALUES ('', ?) RETURNING id").bind(email).first<{ id: number }>();
      } catch {
        return c.json({ error: "full" }, 409);
      }
    }
    await startSession(c, member!.id, "email", t);
    return c.json({ ok: true });
  });

  return r;
}
