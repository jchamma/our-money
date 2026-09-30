// Test-only RS256 signer standing in for Google's ID-token issuer.
export const ISS = "https://accounts.google.com";
export const AUD = "test-client-id.apps.googleusercontent.com";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

export async function testSigner() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid: "k1" };

  async function sign(claims: Record<string, unknown>, kid = "k1") {
    const now = Math.floor(Date.now() / 1000);
    const body = `${enc({ alg: "RS256", kid })}.${enc({ aud: AUD, iss: ISS, exp: now + 600, email: "dana@example.com", ...claims })}`;
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(body)));
    return `${body}.${b64url(sig)}`;
  }

  return { sign, keys: async () => [jwk] };
}
