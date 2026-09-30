import { afterEach, describe, expect, it, vi } from "vitest";
import { riseupClient } from "../src/riseup";

const PAT = "riseup_pat_fake_secret_value";

afterEach(() => vi.restoreAllMocks());

function stubFetch(res: Response) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
}

describe("riseupClient", () => {
  it("only talks to input.riseup.co.il, with the token, without following redirects", async () => {
    const spy = stubFetch(Response.json({ transactions: [] }));
    await riseupClient(PAT).transactions("2026-09");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).host).toBe("input.riseup.co.il");
    expect(url).toBe("https://input.riseup.co.il/api/external/transactions?cashflowMonth=2026-09");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${PAT}`);
    expect(init.redirect).toBe("manual");
  });

  it("refuses a redirect instead of following it", async () => {
    stubFetch(new Response(null, { status: 302, headers: { Location: "https://evil.example/" } }));
    await expect(riseupClient(PAT).budget("2026-09")).rejects.toThrow("refusing to follow");
  });

  it.each([401, 500])("errors on %i without leaking the token or the response body", async (status) => {
    stubFetch(new Response("secret-body-content", { status }));
    const err = await riseupClient(PAT).budget("2026-09").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(PAT);
    expect((err as Error).message).not.toContain("secret-body-content");
  });
});
