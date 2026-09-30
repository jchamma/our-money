import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { RiseupHttpError, type RiseupClient } from "../src/riseup";
import { decryptToken, encryptToken, loadRiseupToken, markTokenExpired, saveRiseupToken, tokenState } from "../src/token";

const TOKEN = "riseup_pat_fake_0123456789abcdef";
const OTHER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

const okClient = (): RiseupClient => ({ budget: async (m) => ({ budgetDate: m, envelopes: [] }), transactions: async () => [] });
const failingClient = (status: number) => (): RiseupClient => ({
  budget: async () => {
    throw new RiseupHttpError(status, "RiseUp token rejected (expired or revoked)");
  },
  transactions: async () => [],
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM settings").run();
});

describe("token encryption", () => {
  it("round-trips, with a fresh IV every time", async () => {
    const a = await encryptToken(TOKEN, env.TOKEN_KEY);
    const b = await encryptToken(TOKEN, env.TOKEN_KEY);
    expect(a).not.toBe(b);
    expect(a).not.toContain(TOKEN);
    expect(await decryptToken(a, env.TOKEN_KEY)).toBe(TOKEN);
  });

  it("fails with the wrong key, or with no key at all", async () => {
    const blob = await encryptToken(TOKEN, env.TOKEN_KEY);
    await expect(decryptToken(blob, OTHER_KEY)).rejects.toThrow();
    await expect(encryptToken(TOKEN, undefined)).rejects.toThrow("TOKEN_KEY");
  });
});

describe("saving the RiseUp token", () => {
  it("stores only ciphertext, with a 30-day expiry", async () => {
    const now = new Date("2026-09-30T08:00:00Z");
    const res = await saveRiseupToken(env, TOKEN, "2026-09", now, okClient);
    expect(res).toEqual({ ok: true, expiresAt: "2026-10-30T08:00:00.000Z" });

    const all = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
    expect(JSON.stringify(all.results)).not.toContain(TOKEN);
    expect(await loadRiseupToken(env)).toBe(TOKEN);
    expect(await tokenState(env)).toEqual({ status: "ok", expiresAt: "2026-10-30T08:00:00.000Z" });
  });

  it("never stores a token RiseUp rejects", async () => {
    expect(await saveRiseupToken(env, TOKEN, "2026-09", new Date(), failingClient(401))).toEqual({ ok: false, reason: "rejected" });
    expect(await saveRiseupToken(env, TOKEN, "2026-09", new Date(), failingClient(503))).toEqual({ ok: false, reason: "unavailable" });
    expect(await saveRiseupToken(env, "short", "2026-09", new Date(), okClient)).toEqual({ ok: false, reason: "invalid" });
    expect(await saveRiseupToken(env, "has space in it 1234567890", "2026-09", new Date(), okClient)).toEqual({ ok: false, reason: "invalid" });
    const n = await env.DB.prepare("SELECT count(*) AS n FROM settings").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("falls back to the Phase 1 secret until a token is saved, then prefers the saved one", async () => {
    expect(await loadRiseupToken(env)).toBe("riseup_pat_test");
    await saveRiseupToken(env, TOKEN, "2026-09", new Date(), okClient);
    expect(await loadRiseupToken(env)).toBe(TOKEN);
  });

  it("is marked expired after a 401, and a new save clears it", async () => {
    await saveRiseupToken(env, TOKEN, "2026-09", new Date(), okClient);
    await markTokenExpired(env.DB);
    expect((await tokenState(env)).status).toBe("expired");
    await saveRiseupToken(env, TOKEN, "2026-09", new Date(), okClient);
    expect((await tokenState(env)).status).toBe("ok");
  });
});
