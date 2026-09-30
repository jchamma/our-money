// Passkeys (WebAuthn): Face ID / fingerprint, no password and no third party.
// Enrolment needs a single-use invite created by the owner's setup script; once both members
// exist, there is no way to register.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { startFlow, startSession, takeFlow } from "./session";
import { attempts, clientIp, iso, sha256, take } from "./util";

export type WebAuthn = {
  generateRegistrationOptions: typeof generateRegistrationOptions;
  verifyRegistrationResponse: typeof verifyRegistrationResponse;
  generateAuthenticationOptions: typeof generateAuthenticationOptions;
  verifyAuthenticationResponse: typeof verifyAuthenticationResponse;
};

export const realWebAuthn: WebAuthn = {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
};

const RP_NAME = "הכסף שלנו";
const MAX_MEMBERS = 2;
const FAIL_LIMIT = 10; // failed passkey logins per IP per 15 minutes
const OPTIONS_LIMIT = 60; // login option requests per IP per 15 minutes

const site = (c: Context<AppEnv>) => {
  const url = new URL(c.req.url);
  return { origin: url.origin, rpID: url.hostname };
};
const ip = (c: Context<AppEnv>) => clientIp(c.req.header("CF-Connecting-IP"));

async function inviteIsOpen(db: D1Database, tokenHash: string, now: Date): Promise<boolean> {
  const [invite, members] = await db.batch<{ n: number }>([
    db.prepare("SELECT count(*) AS n FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(tokenHash, iso(now)),
    db.prepare("SELECT count(*) AS n FROM members"),
  ]);
  return invite.results[0].n === 1 && members.results[0].n < MAX_MEMBERS;
}

type RegFlow = { challenge: string; inviteHash: string; name: string; userId: string };
type AuthFlow = { challenge: string };

export function passkeyRoutes(webauthn: WebAuthn, now: () => Date) {
  const r = new Hono<AppEnv>();

  // Frame 7b vs 7g: is this invite link still usable?
  // POST with the token in the body, so it never lands in a URL log.
  r.post("/invite", async (c) => {
    const body = await c.req.json<{ invite?: unknown }>().catch(() => ({}) as { invite?: unknown });
    const token = typeof body.invite === "string" ? body.invite : "";
    return c.json({ valid: token.length > 0 && token.length <= 128 && (await inviteIsOpen(c.env.DB, await sha256(token), now())) });
  });

  r.post("/register/options", async (c) => {
    const body = await c.req.json<{ invite?: string; name?: string }>().catch(() => ({}) as { invite?: string; name?: string });
    const name = (body.name ?? "").trim();
    if (!body.invite || name.length < 1 || name.length > 40) return c.json({ error: "invalid" }, 400);
    const inviteHash = await sha256(body.invite);
    if (!(await inviteIsOpen(c.env.DB, inviteHash, now()))) return c.json({ error: "invite" }, 410);

    const { rpID } = site(c);
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const options = await webauthn.generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: name,
      userDisplayName: name,
      userID: userId,
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    await startFlow(c, "passkey-reg", { challenge: options.challenge, inviteHash, name, userId: isoBase64URL.fromBuffer(userId) } satisfies RegFlow, now());
    return c.json(options);
  });

  r.post("/register/verify", async (c) => {
    const t = now();
    const flow = await takeFlow<RegFlow>(c, "passkey-reg", t);
    if (!flow) return c.json({ error: "expired" }, 400);
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid" }, 400);

    const { origin, rpID } = site(c);
    let info;
    try {
      const v = await webauthn.verifyRegistrationResponse({
        response: body,
        expectedChallenge: flow.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!v.verified || !v.registrationInfo) return c.json({ error: "invalid" }, 400);
      info = v.registrationInfo;
    } catch {
      return c.json({ error: "invalid" }, 400);
    }

    // One transaction: use up the invite, add the member, store the passkey. Each step runs only if
    // the one before changed a row, and any error (e.g. the member-limit trigger) rolls all back.
    const cred = info.credential;
    const db = c.env.DB;
    let results: D1Result[];
    try {
      results = await db.batch([
        db.prepare("UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").bind(iso(t), flow.inviteHash, iso(t)),
        db.prepare("INSERT INTO members (name, name_confirmed) SELECT ?, 1 WHERE changes() = 1").bind(flow.name),
        db.prepare(
          "INSERT INTO passkey_credentials (id, member_id, public_key, counter, transports) SELECT ?, last_insert_rowid(), ?, ?, ? WHERE changes() = 1",
        ).bind(cred.id, isoBase64URL.fromBuffer(cred.publicKey), cred.counter, JSON.stringify(cred.transports ?? [])),
      ]);
    } catch (e) {
      // Everything rolled back, including the invite. Only the member-limit trigger means "full".
      if (String((e as Error)?.message).includes("member limit reached")) return c.json({ error: "full" }, 409);
      return c.json({ error: "failed" }, 500);
    }
    if (results[2].meta.changes !== 1) return c.json({ error: "invite" }, 410);
    const memberId = results[1].meta.last_row_id;
    await startSession(c, memberId, "passkey-register", t);
    return c.json({ ok: true, name: flow.name });
  });

  r.post("/login/options", async (c) => {
    const t = now();
    if (!(await take(c.env.DB, `passkey-options:${ip(c)}`, t, 15, OPTIONS_LIMIT))) return c.json({ error: "rate" }, 429);
    const options = await webauthn.generateAuthenticationOptions({ rpID: site(c).rpID, userVerification: "required" });
    await startFlow(c, "passkey-auth", { challenge: options.challenge } satisfies AuthFlow, t);
    return c.json(options);
  });

  r.post("/login/verify", async (c) => {
    const t = now();
    const failKey = `passkey-fail:${ip(c)}`;
    if ((await attempts(c.env.DB, failKey, t, 15)) >= FAIL_LIMIT) return c.json({ error: "rate" }, 429);
    const flow = await takeFlow<AuthFlow>(c, "passkey-auth", t);
    const body = await c.req.json<{ id?: string }>().catch(() => null);
    const fail = async () => (await take(c.env.DB, failKey, t, 15, FAIL_LIMIT), c.json({ error: "invalid" }, 401));
    if (!flow || !body?.id) return fail();

    const cred = await c.env.DB.prepare("SELECT id, member_id, public_key, counter, transports FROM passkey_credentials WHERE id = ?")
      .bind(body.id)
      .first<{ id: string; member_id: number; public_key: string; counter: number; transports: string | null }>();
    if (!cred) return fail();

    const { origin, rpID } = site(c);
    try {
      const v = await webauthn.verifyAuthenticationResponse({
        response: body as Parameters<WebAuthn["verifyAuthenticationResponse"]>[0]["response"],
        expectedChallenge: flow.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: cred.id,
          publicKey: isoBase64URL.toBuffer(cred.public_key),
          counter: cred.counter,
          transports: cred.transports ? JSON.parse(cred.transports) : undefined,
        },
      });
      if (!v.verified) return fail();
      await c.env.DB.prepare("UPDATE passkey_credentials SET counter = ?, last_used_at = ? WHERE id = ?")
        .bind(v.authenticationInfo.newCounter, iso(t), cred.id)
        .run();
    } catch {
      return fail();
    }
    await startSession(c, cred.member_id, "passkey", t);
    return c.json({ ok: true });
  });

  return r;
}
