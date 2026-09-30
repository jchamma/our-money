import { Hono } from "hono";
import { authConfig } from "./auth/config";
import { emailRoutes } from "./auth/email";
import { GOOGLE_JWKS, googleRoutes } from "./auth/google";
import { remoteKeys, type KeySource } from "./auth/jwt";
import { passkeyRoutes, realWebAuthn, type WebAuthn } from "./auth/passkey";
import { currentMember, endSession, pruneAuth } from "./auth/session";
import type { AppEnv, Env } from "./env";
import { monthRoutes } from "./months";
import { projectRoutes } from "./projects";
import { RiseupHttpError, riseupClient, type RiseupClient } from "./riseup";
import { recentMonths, syncMonths } from "./sync";
import { loadRiseupToken, markTokenExpired, saveRiseupToken, tokenState } from "./token";

export type { Env } from "./env";

export class NoTokenError extends Error {
  constructor() {
    super("no RiseUp token saved");
  }
}

/** A log line that can't carry payload text (a JSON SyntaxError can quote the response body). */
export const safeError = (e: unknown) => (e instanceof RiseupHttpError || e instanceof NoTokenError ? e.message : `${(e as Error)?.name ?? "Error"}`);

/** Sync with the stored token; a 401 marks the token expired so the app can ask for a new one. */
export async function runSync(env: Env, months: string[], client: (token: string) => RiseupClient = riseupClient) {
  const token = await loadRiseupToken(env);
  if (!token) throw new NoTokenError();
  try {
    return await syncMonths(env.DB, client(token), months);
  } catch (e) {
    if (e instanceof RiseupHttpError && e.status === 401) await markTokenExpired(env.DB);
    throw e;
  }
}

/** Everything the app talks to outside D1, replaceable in tests. */
export type Deps = {
  now: () => Date;
  webauthn: WebAuthn;
  googleKeys: KeySource;
  fetch: typeof fetch;
  riseup: (token: string) => RiseupClient;
};

const defaultDeps = (): Deps => ({
  now: () => new Date(),
  webauthn: realWebAuthn,
  googleKeys: remoteKeys(GOOGLE_JWKS),
  fetch: (...args) => fetch(...args),
  riseup: riseupClient,
});

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createApp(overrides: Partial<Deps> = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const app = new Hono<AppEnv>();

  app.onError((e, c) => {
    console.error(`request failed: ${safeError(e)}`);
    if (e instanceof NoTokenError) return c.json({ error: "no-token" }, 409);
    if (e instanceof RiseupHttpError) return c.json({ error: "riseup" }, 502);
    return c.json({ error: "internal" }, 500);
  });

  // Fail closed: without a complete login config the Worker serves nothing at all.
  app.use("*", async (c, next) => {
    const cfg = authConfig(c.env);
    if ("error" in cfg) {
      console.error(`config: ${cfg.error}`);
      return c.text("Service unavailable: the app isn't configured. Run `npm run setup`.", 503);
    }
    c.set("auth", cfg);
    await next();
  });

  // CSRF: state-changing requests must come from our own pages.
  app.use("*", async (c, next) => {
    if (UNSAFE.has(c.req.method)) {
      const origin = c.req.header("Origin");
      const sameSite = c.req.header("Sec-Fetch-Site");
      const own = new URL(c.req.url).origin;
      if (origin ? origin !== own : sameSite !== "same-origin") return c.json({ error: "forbidden" }, 403);
    }
    await next();
  });

  // Login routes: only the configured method is reachable.
  app.use("/auth/passkey/*", async (c, next) => (c.var.auth.mode === "passkey" ? next() : c.notFound()));
  app.use("/auth/google/*", async (c, next) => (c.var.auth.mode === "google" ? next() : c.notFound()));
  app.use("/auth/email/*", async (c, next) => (c.var.auth.mode === "email" ? next() : c.notFound()));
  app.route("/auth/passkey", passkeyRoutes(deps.webauthn, deps.now));
  app.route("/auth/google", googleRoutes(deps.googleKeys, deps.fetch, deps.now));
  app.route("/auth/email", emailRoutes(deps.fetch, deps.now));

  app.get("/auth/mode", (c) => c.json({ mode: c.var.auth.mode }));
  app.post("/auth/logout", async (c) => {
    await endSession(c);
    return c.body(null, 204);
  });

  // Everything under /api needs a session.
  app.use("/api/*", async (c, next) => {
    const member = await currentMember(c, deps.now());
    if (!member) return c.json({ error: "unauthorized" }, 401);
    c.set("member", member);
    await next();
  });

  app.route("/api", projectRoutes());
  app.route("/api", monthRoutes(deps.now));

  // Greeting, footer and token banner (frames 7a, 7h, 7m).
  app.get("/api/me", async (c) => {
    const [members, lastSync, token] = await Promise.all([
      c.env.DB.prepare("SELECT id, name FROM members ORDER BY id").all<{ id: number; name: string }>(),
      c.env.DB.prepare("SELECT finished_at, status FROM sync_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1").first(),
      tokenState(c.env),
    ]);
    return c.json({ me: c.var.member, members: members.results, lastSync, token, mode: c.var.auth.mode });
  });

  // First-login name (frame 7e).
  app.put("/api/me/name", async (c) => {
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    const name = (body.name ?? "").trim();
    if (name.length < 1 || name.length > 40) return c.json({ error: "invalid" }, 400);
    await c.env.DB.prepare("UPDATE members SET name = ?, name_confirmed = 1 WHERE id = ?").bind(name, c.var.member.id).run();
    return c.json({ ok: true });
  });

  // Renew the RiseUp token from the phone (frame 7n). The token is never sent back.
  app.put("/api/riseup-token", async (c) => {
    const body = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
    const month = recentMonths(deps.now(), 1)[0];
    const res = await saveRiseupToken(c.env, body.token ?? "", month, deps.now(), deps.riseup);
    if (!res.ok) return c.json({ error: res.reason }, res.reason === "unavailable" ? 502 : 400);
    await c.env.DB.prepare("INSERT INTO audit_log (member_id, action) VALUES (?, 'riseup-token-renewed')").bind(c.var.member.id).run();
    c.executionCtx.waitUntil(runSync(c.env, recentMonths(deps.now()), deps.riseup).catch(() => undefined));
    return c.json({ ok: true, expiresAt: res.expiresAt });
  });

  app.get("/api/sync/status", async (c) => {
    const last = await c.env.DB.prepare(
      "SELECT id, started_at, finished_at, status, months, upserted, removed, error FROM sync_runs ORDER BY id DESC LIMIT 1",
    ).first();
    return c.json({ last });
  });

  // Default: previous + current month. ?month=YYYY-MM syncs one month (the backfill calls this per month,
  // keeping each invocation well inside the free plan's per-invocation D1 query limit).
  app.post("/api/sync", async (c) => {
    const month = c.req.query("month");
    const window = recentMonths(deps.now(), 13);
    if (month !== undefined && !window.includes(month)) return c.text("month must be YYYY-MM within the last 13 months", 400);
    return c.json(await runSync(c.env, month ? [month] : recentMonths(deps.now()), deps.riseup));
  });

  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const now = new Date();
    ctx.waitUntil(
      Promise.all([
        runSync(env, recentMonths(now)).catch((e) => console.error(`sync failed: ${safeError(e)}`)),
        pruneAuth(env.DB, now).catch((e) => console.error(`prune failed: ${safeError(e)}`)),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;
