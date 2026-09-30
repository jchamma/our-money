// Login configuration, checked on every request. Anything missing or malformed fails closed:
// the Worker answers 503 and serves nothing (see src/index.ts).
import type { Env } from "../env";

export type AuthConfig =
  | { mode: "passkey" }
  | { mode: "google"; allowedEmails: string[]; clientId: string; clientSecret: string }
  | { mode: "email"; allowedEmails: string[]; brevoKey: string; from: string; fromName: string };

const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

function emails(raw: string | undefined): string[] | null {
  const list = (raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (list.length < 1 || list.length > 2 || !list.every((e) => EMAIL.test(e))) return null;
  return list;
}

function keyOk(k: string | undefined): boolean {
  try {
    return !!k && atob(k).length === 32;
  } catch {
    return false;
  }
}

/** The parsed config, or a reason it's unusable (logged, never shown to visitors). */
export function authConfig(env: Env): AuthConfig | { error: string } {
  if (!keyOk(env.TOKEN_KEY)) return { error: "TOKEN_KEY missing or not 32 bytes" };
  switch (env.AUTH_MODE) {
    case "passkey":
      return { mode: "passkey" };
    case "google": {
      const allowed = emails(env.ALLOWED_EMAILS);
      if (!allowed) return { error: "ALLOWED_EMAILS must list 1–2 emails" };
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return { error: "GOOGLE_CLIENT_ID/SECRET missing" };
      return { mode: "google", allowedEmails: allowed, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
    }
    case "email": {
      const allowed = emails(env.ALLOWED_EMAILS);
      if (!allowed) return { error: "ALLOWED_EMAILS must list 1–2 emails" };
      if (!env.BREVO_API_KEY || !env.EMAIL_FROM || !EMAIL.test(env.EMAIL_FROM)) return { error: "BREVO_API_KEY/EMAIL_FROM missing" };
      return { mode: "email", allowedEmails: allowed, brevoKey: env.BREVO_API_KEY, from: env.EMAIL_FROM, fromName: env.EMAIL_FROM_NAME || "הכסף שלנו" };
    }
    default:
      return { error: "AUTH_MODE must be passkey, google or email" };
  }
}
