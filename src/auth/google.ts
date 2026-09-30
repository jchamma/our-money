// Sign in with Google: OpenID Connect authorization-code flow with state, nonce and PKCE.
// Only the emails chosen at setup get in; everyone else lands on the "no access" screen (7f).
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import type { AuthConfig } from "./config";
import { verifyRs256Jwt, type KeySource } from "./jwt";
import { dropRemovedMembers, startFlow, startSession, takeFlow } from "./session";
import { b64url, clientIp, randomToken, safeEqual, take } from "./util";

type Google = Extract<AuthConfig, { mode: "google" }>;
type GoogleFlow = { state: string; nonce: string; verifier: string };

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const START_LIMIT = 30; // login starts per IP per 15 minutes

const redirectUri = (c: Context<AppEnv>) => `${new URL(c.req.url).origin}/auth/google/callback`;

async function challenge(verifier: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export function googleRoutes(keys: KeySource, doFetch: typeof fetch, now: () => Date) {
  const r = new Hono<AppEnv>();
  const cfg = (c: Context<AppEnv>) => c.var.auth as Google;

  r.get("/start", async (c) => {
    const t = now();
    if (!(await take(c.env.DB, `google-start:${clientIp(c.req.header("CF-Connecting-IP"))}`, t, 15, START_LIMIT))) {
      return c.redirect("/login?error=rate", 302);
    }
    const flow: GoogleFlow = { state: randomToken(), nonce: randomToken(), verifier: randomToken(48) };
    await startFlow(c, "google", flow, t);
    const q = new URLSearchParams({
      client_id: cfg(c).clientId,
      redirect_uri: redirectUri(c),
      response_type: "code",
      scope: "openid email profile",
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: await challenge(flow.verifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return c.redirect(`${AUTH_URL}?${q}`, 302);
  });

  r.get("/callback", async (c) => {
    const t = now();
    const failed = () => c.redirect("/login?error=google", 302);
    const flow = await takeFlow<GoogleFlow>(c, "google", t);
    const code = c.req.query("code");
    const state = c.req.query("state") ?? "";
    if (!flow || !code || !safeEqual(state, flow.state)) return failed();

    let idToken: string | undefined;
    try {
      const res = await doFetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: cfg(c).clientId,
          client_secret: cfg(c).clientSecret,
          redirect_uri: redirectUri(c),
          grant_type: "authorization_code",
          code_verifier: flow.verifier,
        }),
        redirect: "manual",
      });
      if (!res.ok) return failed();
      idToken = (await res.json<{ id_token?: string }>()).id_token;
    } catch {
      return failed();
    }

    const claims = await verifyRs256Jwt(idToken, { keys, issuers: ISSUERS, aud: cfg(c).clientId }, t.getTime());
    if (!claims || claims.nonce !== flow.nonce || claims.email_verified !== true || typeof claims.email !== "string") return failed();
    const email = claims.email.toLowerCase();
    // No email in the URL: it would end up in browser history and logs.
    if (!cfg(c).allowedEmails.includes(email)) return c.redirect("/no-access", 302);

    const googleName = typeof claims.name === "string" ? claims.name.slice(0, 40) : "";
    let member = await c.env.DB.prepare("SELECT id FROM members WHERE email = ?").bind(email).first<{ id: number }>();
    if (!member) {
      await dropRemovedMembers(c.env.DB, cfg(c).allowedEmails);
      try {
        member = await c.env.DB.prepare("INSERT INTO members (name, email) VALUES (?, ?) RETURNING id").bind(googleName, email).first<{ id: number }>();
      } catch {
        return failed(); // member limit
      }
    }
    await startSession(c, member!.id, "google", t);
    return c.redirect("/", 302);
  });

  return r;
}
