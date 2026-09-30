// Shared test plumbing: an HTTP client with a cookie jar, and a signed-in session.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import type { WebAuthn } from "../src/auth/passkey";
import { sha256 } from "../src/auth/util";
import { createApp, type Deps } from "../src/index";

export const ORIGIN = "https://app.test";
export const T0 = new Date("2026-09-30T08:00:00Z");

export type Jar = Map<string, string>;
export type Req = { method?: string; body?: unknown; jar?: Jar; origin?: string | null; vars?: Record<string, string | undefined> };

export function client(overrides: Partial<Deps>) {
  const app = createApp(overrides);
  return async (path: string, { method = "GET", body, jar, origin = ORIGIN, vars = {} }: Req = {}) => {
    const headers = new Headers();
    if (origin) headers.set("Origin", origin);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (jar?.size) headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const ctx = createExecutionContext();
    const res = await app.request(
      `${ORIGIN}${path}`,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" },
      { ...env, AUTH_MODE: "passkey", ...vars },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [k, v] = pair.split("=");
      if (attrs.some((a) => /max-age=0/i.test(a)) || v === "") jar?.delete(k);
      else jar?.set(k, v);
    }
    return res;
  };
}

/** Accepts any registration; enough to get a session in tests that aren't about login. */
export const acceptAllWebAuthn = {
  generateRegistrationOptions: async () => ({ challenge: "c" }),
  verifyRegistrationResponse: async (a: { response: { id: string } }) => ({
    verified: true,
    registrationInfo: { credential: { id: a.response.id, publicKey: new Uint8Array([1]), counter: 0 } },
  }),
} as unknown as WebAuthn;

/** Enrol a member through an invite and return their cookie jar. */
export async function signedIn(call: ReturnType<typeof client>, name = "Dana"): Promise<Jar> {
  const token = `invite-${name}-${Math.random()}`;
  await env.DB.prepare("INSERT INTO invites (token_hash, expires_at) VALUES (?, '2099-01-01T00:00:00Z')").bind(await sha256(token)).run();
  const jar: Jar = new Map();
  await call("/auth/passkey/register/options", { method: "POST", body: { invite: token, name }, jar });
  const res = await call("/auth/passkey/register/verify", { method: "POST", body: { id: `cred-${token}` }, jar });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
  return jar;
}

export async function resetDb(tables: string[]) {
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}
