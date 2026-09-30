import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { RiseupHttpError, type RiseupBudget, type RiseupClient, type RiseupTransaction } from "../src/riseup";
import { recentMonths, syncMonths } from "../src/sync";

// Synthetic data only.
const tx = (id: string, over: Partial<RiseupTransaction> = {}): RiseupTransaction => ({
  transactionId: id,
  transactionDate: "2026-09-10T00:00:00.000Z",
  billingDate: "2026-10-02T00:00:00.000Z",
  cashflowDate: "2026-09",
  businessName: `Shop ${id}`,
  isIncome: false,
  amount: 123.45,
  accountNumberHash: "abc123",
  source: "max",
  sourceType: "creditCard",
  categoryLabel: "סופר",
  categoryType: "default",
  actualType: "variable",
  ...over,
});

function fakeClient(data: Record<string, { txs: RiseupTransaction[]; budget?: Partial<RiseupBudget> }>): RiseupClient {
  return {
    budget: async (m) => ({ budgetDate: m, envelopes: [], ...data[m]?.budget }),
    transactions: async (m) => data[m]?.txs ?? [],
  };
}

const rows = () => env.DB.prepare("SELECT * FROM transactions ORDER BY id").all<Record<string, unknown>>().then((r) => r.results);

beforeEach(async () => {
  const tables = ["transactions", "merchant_rules", "project_category_plans", "project_categories", "accounts", "budget_snapshots", "sync_runs", "projects"];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("syncMonths", () => {
  it("mirrors transactions, envelopes and excluded flags, with amounts in agorot", async () => {
    const client = fakeClient({
      "2026-09": {
        txs: [tx("t1"), tx("t2", { isIncome: true, amount: 10000 })],
        budget: { envelopes: [{ id: "env-var", type: "variable", actuals: [{ transactionId: "t1" }] }], excluded: [{ transactionId: "t2" }] },
      },
    });
    const res = await syncMonths(env.DB, client, ["2026-09"]);
    expect(res).toMatchObject({ upserted: 2, removed: 0 });

    const [t1, t2] = await rows();
    expect(t1).toMatchObject({ amount: 12345, is_income: 0, envelope_type: "variable", is_excluded: 0, transaction_date: "2026-09-10", billing_date: "2026-10-02" });
    expect(t2).toMatchObject({ amount: 1000000, is_income: 1, is_excluded: 1 });

    const run = await env.DB.prepare("SELECT status FROM sync_runs WHERE id = ?").bind(res.runId).first();
    expect(run).toEqual({ status: "ok" });
  });

  it("is idempotent: a second run adds no rows", async () => {
    const client = fakeClient({ "2026-09": { txs: [tx("t1"), tx("t2")] } });
    await syncMonths(env.DB, client, ["2026-09"]);
    await syncMonths(env.DB, client, ["2026-09"]);
    expect(await rows()).toHaveLength(2);
  });

  it("takes RiseUp re-categorizations but keeps our project fields and first_seen_at", async () => {
    await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("t1")] } }), ["2026-09"], new Date("2026-09-10T03:00:00Z"));
    const p = await env.DB.prepare("INSERT INTO projects (name) VALUES ('Greece trip') RETURNING id").first<{ id: number }>();
    const c = await env.DB.prepare("INSERT INTO project_categories (project_id, name, kind) VALUES (?, 'Hotel', 'expense') RETURNING id")
      .bind(p!.id)
      .first<{ id: number }>();
    await env.DB.prepare("UPDATE transactions SET project_id = ?, project_category_id = ?, assignment = 'manual' WHERE id = 't1'")
      .bind(p!.id, c!.id)
      .run();

    await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("t1", { categoryLabel: "חופשה" })] } }), ["2026-09"], new Date("2026-09-11T03:00:00Z"));
    expect((await rows())[0]).toMatchObject({
      category_label: "חופשה",
      project_id: p!.id,
      project_category_id: c!.id,
      assignment: "manual",
      first_seen_at: "2026-09-10T03:00:00.000Z",
    });
  });

  it("flags transactions RiseUp stops returning, and un-flags them if they come back", async () => {
    await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("t1"), tx("t2")] } }), ["2026-09"]);
    const res = await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("t1")] } }), ["2026-09"]);
    expect(res.removed).toBe(1);
    expect((await rows()).find((r) => r.id === "t2")?.removed_at).not.toBeNull();

    await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("t1"), tx("t2")] } }), ["2026-09"]);
    expect((await rows()).find((r) => r.id === "t2")?.removed_at).toBeNull();
  });

  it("records a failed run, storing only our own error messages", async () => {
    const tokenRejected: RiseupClient = { budget: async () => { throw new RiseupHttpError(401, "RiseUp token rejected (expired or revoked)"); }, transactions: async () => [] };
    await expect(syncMonths(env.DB, tokenRejected, ["2026-09"])).rejects.toThrow("token rejected");
    expect(await env.DB.prepare("SELECT status, error FROM sync_runs").first()).toEqual({ status: "error", error: "RiseUp token rejected (expired or revoked)" });

    const badJson: RiseupClient = { budget: async () => { throw new SyntaxError('Unexpected token "<html>secret body"'); }, transactions: async () => [] };
    await expect(syncMonths(env.DB, badJson, ["2026-09"])).rejects.toThrow();
    const last = await env.DB.prepare("SELECT error FROM sync_runs ORDER BY id DESC").first<{ error: string }>();
    expect(last!.error).toBe("sync failed: SyntaxError");
  });

  it("retires runs left 'running' by a killed invocation", async () => {
    await env.DB.prepare("INSERT INTO sync_runs (started_at, status, months) VALUES ('2026-09-01T00:00:00.000Z', 'running', '[]')").run();
    await syncMonths(env.DB, fakeClient({}), ["2026-09"], new Date("2026-09-02T00:00:00Z"));
    const stale = await env.DB.prepare("SELECT status, error FROM sync_runs ORDER BY id LIMIT 1").first();
    expect(stale).toEqual({ status: "error", error: "interrupted" });
  });

  it("handles a large month in a constant number of statements", async () => {
    const txs = Array.from({ length: 600 }, (_, i) => tx(`t${i}`, { accountNumberHash: `acc${i % 4}` }));
    const res = await syncMonths(env.DB, fakeClient({ "2026-09": { txs } }), ["2026-09"]);
    expect(res.upserted).toBe(600);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM transactions").first()).toEqual({ n: 600 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM accounts").first()).toEqual({ n: 4 });
  });

  it("does not flag a month as removed when RiseUp returns it empty", async () => {
    await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("t1")] } }), ["2026-09"]);
    const res = await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [] } }), ["2026-09"]);
    expect(res.removed).toBe(0);
    expect((await rows())[0].removed_at).toBeNull();
  });

  it("syncing one month never flags another month's rows", async () => {
    await syncMonths(env.DB, fakeClient({ "2026-08": { txs: [tx("aug", { cashflowDate: "2026-08" })] } }), ["2026-08"]);
    await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("sep")] } }), ["2026-09"]);
    expect((await rows()).map((r) => [r.id, r.removed_at])).toEqual([["aug", null], ["sep", null]]);
  });

  it("follows a transaction that RiseUp moves to another month", async () => {
    await syncMonths(env.DB, fakeClient({ "2026-08": { txs: [tx("t1", { cashflowDate: "2026-08" })] } }), ["2026-08"]);
    await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("t1")] } }), ["2026-09"]);
    const res = await syncMonths(env.DB, fakeClient({ "2026-08": { txs: [tx("other", { cashflowDate: "2026-08" })] } }), ["2026-08"]);
    expect(res.removed).toBe(0);
    expect((await rows()).find((r) => r.id === "t1")).toMatchObject({ cashflow_month: "2026-09", removed_at: null });
  });

  it.each([
    [19.99, 1999],
    [0.29, 29],
    [1234.565, 123457],
    [0.1 + 0.2, 30],
  ])("rounds %d ILS to %i agorot", async (ils, agorot) => {
    await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("t1", { amount: ils })] } }), ["2026-09"]);
    expect((await rows())[0].amount).toBe(agorot);
  });
});

describe("recentMonths", () => {
  it("uses the Israel calendar, not UTC", () => {
    // 22:30 UTC on Sep 30 is already Oct 1 in Jerusalem (UTC+3 in summer time).
    expect(recentMonths(new Date("2026-09-30T22:30:00Z"))).toEqual(["2026-09", "2026-10"]);
  });

  it("uses winter time (UTC+2) at New Year", () => {
    expect(recentMonths(new Date("2026-12-31T22:30:00Z"))).toEqual(["2026-12", "2027-01"]);
    expect(recentMonths(new Date("2026-12-31T21:30:00Z"))).toEqual(["2026-11", "2026-12"]);
  });

  it("crosses year boundaries and supports a 13-month backfill", () => {
    expect(recentMonths(new Date("2026-01-15T12:00:00Z"))).toEqual(["2025-12", "2026-01"]);
    const m = recentMonths(new Date("2026-09-15T12:00:00Z"), 13);
    expect(m).toHaveLength(13);
    expect([m[0], m[12]]).toEqual(["2025-09", "2026-09"]);
  });
});

describe("merchant rules in the sync", () => {
  const at = (iso: string) => new Date(iso);
  async function setup(status = "active") {
    const p = await env.DB.prepare("INSERT INTO projects (name, status) VALUES ('Trip', ?) RETURNING id").bind(status).first<{ id: number }>();
    await env.DB.prepare("INSERT INTO merchant_rules (business_name, project_id, created_at) VALUES ('Shop R', ?, '2026-09-10T00:00:00Z')").bind(p!.id).run();
    return p!.id;
  }
  const r = (id: string) => env.DB.prepare("SELECT project_id, assignment, project_category_id FROM transactions WHERE id = ?").bind(id).first<any>();

  it("assigns new transactions from the merchant, into the matching project category", async () => {
    const p = await setup();
    await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("n1", { businessName: "Shop R" })] } }), ["2026-09"], at("2026-09-11T03:00:00Z"));
    const row = await r("n1");
    expect(row).toMatchObject({ project_id: p, assignment: "rule" });
    const cat = await env.DB.prepare("SELECT name, kind FROM project_categories WHERE id = ?").bind(row.project_category_id).first();
    expect(cat).toEqual({ name: "סופר", kind: "expense" });
  });

  it("leaves transactions seen before the rule, other merchants, and inactive projects alone", async () => {
    await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("old", { businessName: "Shop R" })] } }), ["2026-09"], at("2026-09-09T03:00:00Z"));
    const p = await setup();
    const client = fakeClient({ "2026-09": { txs: [tx("old", { businessName: "Shop R" }), tx("other")] } });
    await syncMonths(env.DB, client, ["2026-09"], at("2026-09-11T03:00:00Z"));
    expect((await r("old")).project_id).toBeNull();
    expect((await r("other")).project_id).toBeNull();

    await env.DB.prepare("UPDATE projects SET status = 'done' WHERE id = ?").bind(p).run();
    await syncMonths(env.DB, fakeClient({ "2026-09": { txs: [tx("late", { businessName: "Shop R" })] } }), ["2026-09"], at("2026-09-12T03:00:00Z"));
    expect((await r("late")).project_id).toBeNull();
  });

  it("never overrides a person who returned the item to the ongoing", async () => {
    await setup();
    const client = fakeClient({ "2026-09": { txs: [tx("n2", { businessName: "Shop R" })] } });
    await syncMonths(env.DB, client, ["2026-09"], at("2026-09-11T03:00:00Z"));
    await env.DB.prepare("UPDATE transactions SET project_id = NULL, project_category_id = NULL, assignment = 'ongoing' WHERE id = 'n2'").run();
    await syncMonths(env.DB, client, ["2026-09"], at("2026-09-12T03:00:00Z"));
    expect(await r("n2")).toMatchObject({ project_id: null, assignment: "ongoing" });
  });
});
