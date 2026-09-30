import { beforeAll, describe, expect, it } from "vitest";
import { verifyRs256Jwt, type JwtCheck } from "../src/auth/jwt";
import { AUD, ISS, testSigner } from "./jwt";

let signer: Awaited<ReturnType<typeof testSigner>>;
let check: JwtCheck;

beforeAll(async () => {
  signer = await testSigner();
  check = { keys: signer.keys, issuers: [ISS, "accounts.google.com"], aud: AUD };
});

const emailOf = async (token: string | null, c = check) => (await verifyRs256Jwt(token, c))?.email ?? null;

describe("verifyRs256Jwt", () => {
  it("accepts a valid token from either Google issuer spelling", async () => {
    expect(await emailOf(await signer.sign({}))).toBe("dana@example.com");
    expect(await emailOf(await signer.sign({ iss: "accounts.google.com" }))).toBe("dana@example.com");
  });

  it.each([
    ["missing token", null],
    ["garbage", "not-a-jwt"],
  ])("rejects %s", async (_, token) => {
    expect(await verifyRs256Jwt(token, check)).toBeNull();
  });

  it.each([
    ["a different audience", { aud: "other-app" }],
    ["a different issuer", { iss: "https://evil.example.com" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 1 }],
    ["a not-yet-valid token", { nbf: Math.floor(Date.now() / 1000) + 600 }],
  ])("rejects %s", async (_, claims) => {
    expect(await verifyRs256Jwt(await signer.sign(claims), check)).toBeNull();
  });

  it("rejects an unknown key id", async () => {
    expect(await verifyRs256Jwt(await signer.sign({}, "other-kid"), check)).toBeNull();
  });

  it("rejects a token signed by another key", async () => {
    const other = await testSigner();
    expect(await verifyRs256Jwt(await other.sign({}), check)).toBeNull();
  });

  it.each(["none", "HS256"])("rejects alg %s (algorithm confusion)", async (alg) => {
    const [, payload, sig] = (await signer.sign({})).split(".");
    const header = btoa(JSON.stringify({ alg, kid: "k1" })).replace(/=+$/, "");
    expect(await verifyRs256Jwt(`${header}.${payload}.${sig}`, check)).toBeNull();
    expect(await verifyRs256Jwt(`${header}.${payload}.`, check)).toBeNull();
  });

  it("rejects a token with no exp", async () => {
    expect(await verifyRs256Jwt(await signer.sign({ exp: undefined }), check)).toBeNull();
  });

  it("fails closed when the key set can't be fetched", async () => {
    const broken = { ...check, keys: async () => { throw new Error("JWKS 503"); } };
    expect(await verifyRs256Jwt(await signer.sign({}), broken)).toBeNull();
  });

  it("refetches keys once on an unknown kid (key rotation)", async () => {
    const rotated = await testSigner();
    const calls: boolean[] = [];
    const rotating = { ...check, keys: async (o?: { refresh?: boolean }) => (calls.push(!!o?.refresh), o?.refresh ? rotated.keys() : signer.keys()) };
    expect(await verifyRs256Jwt(await rotated.sign({}, "k1"), rotating)).toBeNull(); // same kid, wrong key: no rescue
    calls.length = 0;
    const token = await rotated.sign({}, "k2");
    const k2 = { ...check, keys: async (o?: { refresh?: boolean }) => (calls.push(!!o?.refresh), o?.refresh ? [{ ...(await rotated.keys())[0], kid: "k2" }] : signer.keys()) };
    expect(await emailOf(token, k2)).toBe("dana@example.com");
    expect(calls).toEqual([false, true]);
  });

  it("rejects a tampered payload", async () => {
    const [h, , s] = (await signer.sign({ email: "stranger@example.com" })).split(".");
    const forged = btoa(JSON.stringify({ aud: AUD, iss: ISS, exp: 9999999999, email: "dana@example.com" }))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyRs256Jwt(`${h}.${forged}.${s}`, check)).toBeNull();
  });
});
