// RS256 JWT verification against a remote JWKS (used for Google ID tokens).

type Jwk = JsonWebKey & { kid: string };

export type KeySource = (opts?: { refresh?: boolean }) => Promise<Jwk[]>;

const cache = new Map<string, { keys: Jwk[]; at: number }>();

/**
 * JWKS from `url`, cached per isolate for an hour.
 * `refresh` (used on an unknown kid, i.e. key rotation) refetches at most once a minute.
 */
export function remoteKeys(url: string): KeySource {
  return async ({ refresh = false } = {}) => {
    const hit = cache.get(url);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit && age < (refresh ? 60_000 : 3_600_000)) return hit.keys;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`JWKS ${res.status}`);
    const keys = (await res.json<{ keys: Jwk[] }>()).keys;
    cache.set(url, { keys, at: Date.now() });
    return keys;
  };
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const decodeJson = <T>(s: string): T => JSON.parse(new TextDecoder().decode(b64url(s)));

export type JwtCheck = { keys: KeySource; issuers: string[]; aud: string };
export type Claims = { aud: string | string[]; iss: string; exp: number; nbf?: number; [k: string]: unknown };

/** The verified claims, or null if the token is missing or invalid in any way. */
export async function verifyRs256Jwt(token: string | null | undefined, check: JwtCheck, now = Date.now()): Promise<Claims | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = decodeJson<{ alg: string; kid: string }>(parts[0]);
    if (header.alg !== "RS256") return null;
    const find = (keys: Jwk[]) => keys.find((k) => k.kid === header.kid);
    const jwk = find(await check.keys()) ?? find(await check.keys({ refresh: true }));
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;

    const claims = decodeJson<Claims>(parts[1]);
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const nowSec = Math.floor(now / 1000);
    if (!auds.includes(check.aud)) return null;
    if (!check.issuers.includes(claims.iss)) return null;
    if (typeof claims.exp !== "number" || claims.exp <= nowSec) return null;
    if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > nowSec)) return null;
    return claims;
  } catch {
    return null;
  }
}
