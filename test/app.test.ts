import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WebAuthn } from "../src/auth/passkey";
import { sha256 } from "../src/auth/util";
import { RiseupHttpError, type RiseupClient } from "../src/riseup";
import { client, ORIGIN, T0, type Jar } from "./helpers";
import { AUD, testSigner } from "./jwt";

// Synthetic people and data only.

const okRiseup = (): RiseupClient => ({ budget: async (m) => ({ budgetDate: m, envelopes: [] }), transactions: async () => [] });

beforeEach(async () => {
  const tables = ["sessions", "passkey_credentials", "invites", "email_codes", "auth_flows", "login_attempts", "audit_log", "members", "settings"];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("configuration fails closed", () => {
  const call = client({ now: () => T0 });
  it.each([
    ["no AUTH_MODE", { AUTH_MODE: undefined }],
    ["an unknown AUTH_MODE", { AUTH_MODE: "access" }],
    ["no TOKEN_KEY", { TOKEN_KEY: undefined }],
    ["a short TOKEN_KEY", { TOKEN_KEY: btoa("short") }],
    ["google without a client", { AUTH_MODE: "google", ALLOWED_EMAILS: "dana@example.com" }],
    ["google with three emails", { AUTH_MODE: "google", ALLOWED_EMAILS: "a@x.com,b@x.com,c@x.com", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }],
    ["email without Brevo", { AUTH_MODE: "email", ALLOWED_EMAILS: "dana@example.com" }],
  ])("serves nothing with %s", async (_, vars) => {
    for (const path of ["/", "/api/me", "/auth/mode", "/auth/passkey/login/options"]) {
      expect((await call(path, { vars })).status).toBe(503);
    }
  });
});

describe("guards", () => {
  const call = client({ now: () => T0 });
  it("requires a session for every /api route", async () => {
    for (const path of ["/api/me", "/api/sync/status"]) expect((await call(path)).status).toBe(401);
    expect((await call("/api/sync", { method: "POST" })).status).toBe(401);
  });

  it("rejects state-changing requests from other sites, or with no origin information", async () => {
    expect((await call("/auth/passkey/login/options", { method: "POST", origin: "https://evil.example" })).status).toBe(403);
    expect((await call("/auth/passkey/login/options", { method: "POST", origin: null })).status).toBe(403);
    expect((await call("/auth/logout", { method: "POST", origin: "https://evil.example" })).status).toBe(403);
  });

  it("exposes only the configured login method", async () => {
    expect((await call("/auth/google/start")).status).toBe(404);
    expect((await call("/auth/email/start", { method: "POST", body: { email: "dana@example.com" } })).status).toBe(404);
    expect(await (await call("/auth/mode")).json()).toEqual({ mode: "passkey" });
  });
});

describe("passkeys", () => {
  // A stand-in for the WebAuthn library: it checks we pass the right expectations, not real signatures.
  const fake = {
    generateRegistrationOptions: async (o: { rpID: string }) => ({ challenge: "chal-reg", rp: { id: o.rpID } }),
    verifyRegistrationResponse: async (a: any) =>
      a.response.ok && a.expectedChallenge === "chal-reg" && a.expectedOrigin === ORIGIN && a.expectedRPID === "app.test" && a.requireUserVerification
        ? { verified: true, registrationInfo: { credential: { id: a.response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] } } }
        : { verified: false },
    generateAuthenticationOptions: async () => ({ challenge: "chal-auth" }),
    verifyAuthenticationResponse: async (a: any) => ({
      verified: a.response.ok && a.expectedChallenge === "chal-auth" && a.credential.id === a.response.id && a.requireUserVerification,
      authenticationInfo: { newCounter: 1 },
    }),
  } as unknown as WebAuthn;

  let now = T0;
  const call = client({ webauthn: fake, now: () => now });
  beforeEach(() => {
    now = T0;
  });

  const invite = async (token: string, expires = "2026-10-01T08:00:00.000Z") =>
    env.DB.prepare("INSERT INTO invites (token_hash, expires_at) VALUES (?, ?)").bind(await sha256(token), expires).run();

  async function enrol(token: string, name: string, credId: string) {
    const jar: Jar = new Map();
    const opts = await call("/auth/passkey/register/options", { method: "POST", body: { invite: token, name }, jar });
    if (opts.status !== 200) return { status: opts.status, jar };
    const res = await call("/auth/passkey/register/verify", { method: "POST", body: { id: credId, ok: true }, jar });
    return { status: res.status, jar };
  }

  it("enrols with a valid invite, starts a session, and the invite works only once", async () => {
    await invite("inv-1");
    expect(await (await call("/auth/passkey/invite", { method: "POST", body: { invite: "inv-1" } })).json()).toEqual({ valid: true });
    const { status, jar } = await enrol("inv-1", "Dana", "cred-1");
    expect(status).toBe(200);
    const me = await (await call("/api/me", { jar })).json<any>();
    expect(me.me).toMatchObject({ name: "Dana", nameConfirmed: true });

    expect(await (await call("/auth/passkey/invite", { method: "POST", body: { invite: "inv-1" } })).json()).toEqual({ valid: false });
    expect((await enrol("inv-1", "Omer", "cred-2")).status).toBe(410);
  });

  it("refuses unknown and expired invites", async () => {
    expect((await enrol("nope", "Dana", "c")).status).toBe(410);
    await invite("old", "2026-09-29T08:00:00.000Z");
    expect((await enrol("old", "Dana", "c")).status).toBe(410);
  });

  it("closes registration once two members exist", async () => {
    await env.DB.prepare("INSERT INTO members (name) VALUES ('A'), ('B')").run();
    await invite("third");
    expect((await enrol("third", "C", "c3")).status).toBe(410);
  });

  it("rejects a failed WebAuthn verification, and a verify without its options step", async () => {
    await invite("inv-2");
    const jar: Jar = new Map();
    await call("/auth/passkey/register/options", { method: "POST", body: { invite: "inv-2", name: "Dana" }, jar });
    expect((await call("/auth/passkey/register/verify", { method: "POST", body: { id: "c", ok: false }, jar })).status).toBe(400);
    expect((await call("/auth/passkey/register/verify", { method: "POST", body: { id: "c", ok: true } })).status).toBe(400);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM members").first<{ n: number }>())!.n).toBe(0);
  });

  it("logs in with a registered passkey; rejects unknown ones and rate-limits failures", async () => {
    await invite("inv-3");
    await enrol("inv-3", "Dana", "cred-3");

    const login = async (credId: string, ok = true) => {
      const jar: Jar = new Map();
      await call("/auth/passkey/login/options", { method: "POST", jar });
      return { res: await call("/auth/passkey/login/verify", { method: "POST", body: { id: credId, ok }, jar }), jar };
    };
    const good = await login("cred-3");
    expect(good.res.status).toBe(200);
    expect((await call("/api/me", { jar: good.jar })).status).toBe(200);

    expect((await login("unknown")).res.status).toBe(401);
    for (let i = 0; i < 9; i++) await login("cred-3", false);
    expect((await login("cred-3")).res.status).toBe(429);
  });

  it("ends sessions on logout and after 7 days", async () => {
    await invite("inv-4");
    const { jar } = await enrol("inv-4", "Dana", "cred-4");
    const copy = new Map(jar);
    expect((await call("/auth/logout", { method: "POST", jar })).status).toBe(204);
    expect((await call("/api/me", { jar: copy })).status).toBe(401);

    await invite("inv-5");
    const s = await enrol("inv-5", "Omer", "cred-5");
    now = new Date(T0.getTime() + 7 * 86_400_000 + 1000);
    expect((await call("/api/me", { jar: s.jar })).status).toBe(401);
  });
});

describe("Google", () => {
  const vars = { AUTH_MODE: "google", ALLOWED_EMAILS: "dana@example.com, omer@example.com", GOOGLE_CLIENT_ID: AUD, GOOGLE_CLIENT_SECRET: "test-secret" };
  let signer: Awaited<ReturnType<typeof testSigner>>;
  let idClaims: Record<string, unknown>;
  let tokenRequests: URLSearchParams[];
  let call: ReturnType<typeof client>;

  beforeAll(async () => {
    signer = await testSigner();
  });
  beforeEach(() => {
    tokenRequests = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      tokenRequests.push(new URLSearchParams(String(init.body)));
      return Response.json({ id_token: await signer.sign(idClaims) });
    }) as typeof fetch;
    call = client({ now: () => new Date(), googleKeys: signer.keys, fetch: fakeFetch });
  });

  async function signIn(claims: (nonce: string) => Record<string, unknown>, stateOverride?: string) {
    const jar: Jar = new Map();
    const start = await call("/auth/google/start", { jar, vars });
    const to = new URL(start.headers.get("Location")!);
    idClaims = claims(to.searchParams.get("nonce")!);
    const state = stateOverride ?? to.searchParams.get("state")!;
    const cb = await call(`/auth/google/callback?code=abc&state=${state}`, { jar, vars });
    return { start: to, location: cb.headers.get("Location"), jar };
  }

  it("redirects to Google with state, nonce and PKCE", async () => {
    const { start } = await signIn((nonce) => ({ nonce, email_verified: true, name: "Dana Example" }));
    expect(start.origin).toBe("https://accounts.google.com");
    expect(start.searchParams.get("code_challenge_method")).toBe("S256");
    expect(start.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/google/callback`);
    expect(tokenRequests[0].get("code_verifier")).toBeTruthy();
    expect(tokenRequests[0].get("client_secret")).toBe("test-secret");
  });

  it("lets an allowed email in, with the name from Google to confirm", async () => {
    const { location, jar } = await signIn((nonce) => ({ nonce, email_verified: true, name: "Dana Example" }));
    expect(location).toBe("/");
    const me = await (await call("/api/me", { jar, vars })).json<any>();
    expect(me.me).toMatchObject({ name: "Dana Example", nameConfirmed: false });
    expect((await call("/api/me/name", { method: "PUT", body: { name: "Dana" }, jar, vars })).status).toBe(200);
    expect((await (await call("/api/me", { jar, vars })).json<any>()).me).toMatchObject({ name: "Dana", nameConfirmed: true });
  });

  it("sends anyone else to the no-access screen, without a session", async () => {
    const { location, jar } = await signIn((nonce) => ({ nonce, email_verified: true, email: "stranger@example.com" }));
    expect(location).toBe("/no-access");
    expect((await call("/api/me", { jar, vars })).status).toBe(401);
  });

  it.each([
    ["a wrong nonce", () => ({ nonce: "other", email_verified: true })],
    ["an unverified email", (nonce: string) => ({ nonce, email_verified: false })],
    ["another app's token", (nonce: string) => ({ nonce, email_verified: true, aud: "other-client" })],
  ])("refuses %s", async (_, claims) => {
    const { location, jar } = await signIn(claims as (n: string) => Record<string, unknown>);
    expect(location).toBe("/login?error=google");
    expect((await call("/api/me", { jar, vars })).status).toBe(401);
  });

  it("refuses a callback whose state doesn't match", async () => {
    const { location } = await signIn((nonce) => ({ nonce, email_verified: true }), "forged-state");
    expect(location).toBe("/login?error=google");
    expect(tokenRequests).toHaveLength(0);
  });
});

describe("email code", () => {
  const vars = { AUTH_MODE: "email", ALLOWED_EMAILS: "dana@example.com", BREVO_API_KEY: "test-brevo", EMAIL_FROM: "owner@example.com" };
  let sent: { to: string; code: string }[];
  let now: Date;
  let call: ReturnType<typeof client>;

  beforeEach(() => {
    sent = [];
    now = T0;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push({ to: body.to[0].email, code: /(\d{6})/.exec(body.textContent)![1] });
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    call = client({ now: () => now, fetch: fakeFetch });
  });

  const start = (email: string) => call("/auth/email/start", { method: "POST", body: { email }, vars });
  const verify = (email: string, code: string, jar?: Jar) => call("/auth/email/verify", { method: "POST", body: { email, code }, jar, vars });

  it("sends a code only to an allowed email, and answers the same either way", async () => {
    const a = await start("Dana@Example.com");
    const b = await start("stranger@example.com");
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
    expect(sent.map((s) => s.to)).toEqual(["dana@example.com"]);
  });

  it("logs in with the code once, then asks for the name", async () => {
    await start("dana@example.com");
    const jar: Jar = new Map();
    expect((await verify("dana@example.com", sent[0].code, jar)).status).toBe(200);
    expect((await (await call("/api/me", { jar, vars })).json<any>()).me).toMatchObject({ name: "", nameConfirmed: false });
    expect((await verify("dana@example.com", sent[0].code)).status).toBe(400);
  });

  it("stops accepting a code after 5 wrong tries, and after 10 minutes", async () => {
    await start("dana@example.com");
    const wrong = sent[0].code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await verify("dana@example.com", wrong)).status).toBe(400);
    expect((await verify("dana@example.com", sent[0].code)).status).toBe(400);

    await start("dana@example.com");
    now = new Date(T0.getTime() + 11 * 60_000);
    expect((await verify("dana@example.com", sent[1].code)).status).toBe(400);
  });

  it("rate-limits sends per address", async () => {
    for (let i = 0; i < 5; i++) expect((await start("dana@example.com")).status).toBe(200);
    expect((await start("dana@example.com")).status).toBe(429);
  });
});

describe("RiseUp token renewal", () => {
  let riseupOk = true;
  const riseup = () =>
    ({
      budget: async (m: string) => {
        if (!riseupOk) throw new RiseupHttpError(401, "RiseUp token rejected (expired or revoked)");
        return { budgetDate: m, envelopes: [] };
      },
      transactions: async () => [],
    }) as RiseupClient;
  const fake = {
    generateRegistrationOptions: async () => ({ challenge: "c" }),
    verifyRegistrationResponse: async (a: any) => ({ verified: true, registrationInfo: { credential: { id: a.response.id, publicKey: new Uint8Array([1]), counter: 0 } } }),
  } as unknown as WebAuthn;
  const call = client({ now: () => T0, riseup, webauthn: fake });

  async function session() {
    await env.DB.prepare("INSERT INTO invites (token_hash, expires_at) VALUES (?, '2026-10-01T00:00:00Z')").bind(await sha256("i")).run();
    const jar: Jar = new Map();
    await call("/auth/passkey/register/options", { method: "POST", body: { invite: "i", name: "Dana" }, jar });
    await call("/auth/passkey/register/verify", { method: "POST", body: { id: "c1" }, jar });
    return jar;
  }

  it("saves a working token, never echoes it, and reports the new expiry", async () => {
    const jar = await session();
    riseupOk = true;
    const res = await call("/api/riseup-token", { method: "PUT", body: { token: "riseup_pat_fake_renewed_000000" }, jar });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("riseup_pat_fake_renewed");
    const me = await (await call("/api/me", { jar })).json<any>();
    expect(me.token).toEqual({ status: "ok", expiresAt: "2026-10-30T08:00:00.000Z" });
  });

  it("refuses a token RiseUp rejects", async () => {
    const jar = await session();
    riseupOk = false;
    expect((await call("/api/riseup-token", { method: "PUT", body: { token: "riseup_pat_fake_revoked_00000" }, jar })).status).toBe(400);
  });
});

describe("sync API", () => {
  it("rejects a month outside the last 13 months before calling RiseUp", async () => {
    const fake = {
      generateRegistrationOptions: async () => ({ challenge: "c" }),
      verifyRegistrationResponse: async (a: any) => ({ verified: true, registrationInfo: { credential: { id: a.response.id, publicKey: new Uint8Array([1]), counter: 0 } } }),
    } as unknown as WebAuthn;
    const call = client({ now: () => T0, webauthn: fake, riseup: okRiseup });
    await env.DB.prepare("INSERT INTO invites (token_hash, expires_at) VALUES (?, '2026-10-01T00:00:00Z')").bind(await sha256("s")).run();
    const jar: Jar = new Map();
    await call("/auth/passkey/register/options", { method: "POST", body: { invite: "s", name: "Dana" }, jar });
    await call("/auth/passkey/register/verify", { method: "POST", body: { id: "cs" }, jar });
    expect((await call("/api/sync?month=1999-01", { method: "POST", jar })).status).toBe(400);
  });
});

it("tests never see the real RiseUp token from .dev.vars", () => {
  expect(env.RISEUP_PAT).toBe("riseup_pat_test");
});

describe("review regressions", () => {
  it("buckets IPv6 by /64 for rate limits", async () => {
    const { clientIp } = await import("../src/auth/util");
    expect(clientIp("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(clientIp("2001:db8:1:2:bbbb:cccc:dddd:eeee")).toBe("2001:db8:1:2::/64");
    expect(clientIp("2001:db8::5")).toBe("2001:db8:0:0::/64");
    expect(clientIp("203.0.113.9")).toBe("203.0.113.9");
    expect(clientIp("::ffff:203.0.113.5")).toBe("::ffff:203.0.113.5");
    expect(clientIp(undefined)).toBe("unknown");
  });

  it("can't beat the 5-try limit with parallel email guesses", async () => {
    const vars = { AUTH_MODE: "email", ALLOWED_EMAILS: "dana@example.com", BREVO_API_KEY: "k", EMAIL_FROM: "owner@example.com" };
    let code = "";
    const call = client({
      now: () => T0,
      fetch: (async (_u: string, init: RequestInit) => {
        code = /(\d{6})/.exec(JSON.parse(String(init.body)).textContent)![1];
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    });
    await call("/auth/email/start", { method: "POST", body: { email: "dana@example.com" }, vars });
    const wrong = code === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 12 }, () => call("/auth/email/verify", { method: "POST", body: { email: "dana@example.com", code: wrong }, vars })));
    const row = await env.DB.prepare("SELECT attempts FROM email_codes").first<{ attempts: number }>();
    expect(row!.attempts).toBe(5);
    expect((await call("/auth/email/verify", { method: "POST", body: { email: "dana@example.com", code }, vars })).status).toBe(400);
  });

  it("ends access at once when an email is removed from the allowed list", async () => {
    const vars = { AUTH_MODE: "email", ALLOWED_EMAILS: "dana@example.com", BREVO_API_KEY: "k", EMAIL_FROM: "owner@example.com" };
    let code = "";
    const call = client({
      now: () => T0,
      fetch: (async (_u: string, init: RequestInit) => {
        code = /(\d{6})/.exec(JSON.parse(String(init.body)).textContent)![1];
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    });
    await call("/auth/email/start", { method: "POST", body: { email: "dana@example.com" }, vars });
    const jar: Jar = new Map();
    await call("/auth/email/verify", { method: "POST", body: { email: "dana@example.com", code }, jar, vars });
    expect((await call("/api/me", { jar, vars })).status).toBe(200);
    expect((await call("/api/me", { jar, vars: { ...vars, ALLOWED_EMAILS: "omer@example.com" } })).status).toBe(401);

    // The freed place goes to the new email, even with the couple otherwise full.
    await env.DB.prepare("INSERT INTO members (name, email) VALUES ('B', 'b@example.com')").run();
    const swapped = { ...vars, ALLOWED_EMAILS: "omer@example.com,b@example.com" };
    await call("/auth/email/start", { method: "POST", body: { email: "omer@example.com" }, vars: swapped });
    expect((await call("/auth/email/verify", { method: "POST", body: { email: "omer@example.com", code }, vars: swapped })).status).toBe(200);
  });

  it("rolls enrolment back entirely when the passkey can't be stored", async () => {
    const fake = {
      generateRegistrationOptions: async () => ({ challenge: "c" }),
      verifyRegistrationResponse: async () => ({ verified: true, registrationInfo: { credential: { id: "dup", publicKey: new Uint8Array([1]), counter: 0 } } }),
    } as unknown as WebAuthn;
    const call = client({ now: () => T0, webauthn: fake });
    const enrol = async (token: string) => {
      await env.DB.prepare("INSERT INTO invites (token_hash, expires_at) VALUES (?, '2099-01-01T00:00:00Z')").bind(await sha256(token)).run();
      const jar: Jar = new Map();
      await call("/auth/passkey/register/options", { method: "POST", body: { invite: token, name: "X" }, jar });
      return call("/auth/passkey/register/verify", { method: "POST", body: { id: "dup" }, jar });
    };
    expect((await enrol("a")).status).toBe(200);
    expect((await enrol("b")).status).toBe(500); // same credential id: the insert fails, not "full"
    const members = await env.DB.prepare("SELECT count(*) AS n FROM members").first<{ n: number }>();
    const unused = await env.DB.prepare("SELECT count(*) AS n FROM invites WHERE used_at IS NULL").first<{ n: number }>();
    expect([members!.n, unused!.n]).toEqual([1, 1]);
  });
});
