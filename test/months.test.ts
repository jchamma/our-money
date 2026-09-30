import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptAllWebAuthn, client, resetDb, signedIn, T0, type Jar } from "./helpers";

// Synthetic September; T0 is 30.9 in Israel. Budget amounts in shekels (as RiseUp sends), rows in agorot.
const call = client({ now: () => T0, webauthn: acceptAllWebAuthn });
let jar: Jar;

const SUPER = "2026-09#trackingCategory#super";
const budget = {
  envelopes: [
    { id: "salary", type: "fixed", originalAmount: -10000, balanceDate: "2026-09-10T00:00:00Z" },
    { id: "bonus", type: "fixed", originalAmount: -500, balanceDate: "2026-10-04T00:00:00Z" }, // not yet due: counts
    { id: "rent", type: "fixed", originalAmount: 4000, balanceDate: "2026-09-05T00:00:00Z" },
    { id: "late", type: "fixed", originalAmount: 150, balanceDate: "2026-09-22T00:00:00Z" }, // passed, never came: 0
    { id: `${SUPER}#0`, type: "trackingCategory", originalAmount: 1000 },
    { id: `${SUPER}#1`, type: "trackingCategory", originalAmount: 1000 },
    { id: "var", type: "variable", originalAmount: null },
  ],
};

async function tx(id: string, envelope: string | null, amount: number, over: { income?: number; excluded?: number; label?: string; project?: number; cat?: number } = {}) {
  await env.DB.prepare(
    `INSERT INTO transactions (id, cashflow_month, transaction_date, business_name, amount, is_income, category_label, envelope_id, envelope_type,
       is_excluded, raw, last_sync_run, project_id, project_category_id)
     VALUES (?, '2026-09', '2026-09-12', ?, ?, ?, ?, ?, ?, ?, '{}', 1, ?, ?)`,
  )
    .bind(
      id, `Shop ${id}`, amount, over.income ?? 0, over.label ?? null, envelope,
      envelope ? (budget.envelopes.find((e) => e.id === envelope)?.type ?? null) : null,
      over.excluded ?? 0, over.project ?? null, over.cat ?? null,
    )
    .run();
}

beforeEach(async () => {
  await resetDb([
    "transactions", "budget_snapshots", "project_category_plans", "project_categories", "projects",
    "sessions", "passkey_credentials", "invites", "auth_flows", "login_attempts", "audit_log", "members",
  ]);
  jar = await signedIn(call);
  await env.DB.prepare("INSERT INTO budget_snapshots (month, raw, synced_at) VALUES ('2026-09', ?, '2026-09-30T03:00:00Z')").bind(JSON.stringify(budget)).run();
  await tx("s1", "salary", 980_000, { income: 1 });
  await tx("r1", "rent", 400_000);
  await tx("w0", `${SUPER}#0`, 150_000, { label: "כלכלה" });
  await tx("w1", `${SUPER}#1`, 80_000, { label: "כלכלה" });
  await tx("v1", "var", 20_000);
  await tx("x1", null, 5_000, { excluded: 1 });
});

const home = async () => (await call("/api/months/2026-09", { jar })).json<any>();

describe("home month", () => {
  it("computes RiseUp's net: arrived fixed, due-but-not-arrived plans, merged weekly categories, variable spent", async () => {
    const h = await home();
    expect(h.income.expected).toBe(980_000 + 50_000);
    expect(h.fixed.expected).toBe(400_000);
    expect(h.tracked).toHaveLength(1);
    expect(h.tracked[0]).toMatchObject({ name: "כלכלה", plan: 200_000, actual: 230_000, expected: 230_000 });
    expect(h.variable.expected).toBe(20_000);
    expect(h.net).toBe(1_030_000 - 400_000 - 230_000 - 20_000);
    expect(h.notInCashflow.map((t: any) => t.id)).toEqual(["x1"]);
    expect(h.summary).toEqual({ ongoing: h.net, projects: [], total: h.net });
  });

  it("moves project items out of the ongoing and into the summary line", async () => {
    const p = await env.DB.prepare("INSERT INTO projects (name) VALUES ('BBQ') RETURNING id").first<{ id: number }>();
    const cat = await env.DB.prepare("INSERT INTO project_categories (project_id, name, kind) VALUES (?, 'Meat', 'expense') RETURNING id").bind(p!.id).first<{ id: number }>();
    await env.DB.prepare("INSERT INTO project_category_plans (project_category_id, month, amount) VALUES (?, '2026-09', 10000)").bind(cat!.id).run();
    const before = (await home()).net;
    await env.DB.prepare("UPDATE transactions SET project_id = ?, project_category_id = ? WHERE id = 'w0'").bind(p!.id, cat!.id).run();

    const h = await home();
    expect(h.net - before).toBe(30_000); // supermarket falls from 230,000 actual to its 200,000 plan
    expect(h.tracked[0].transactions.map((t: any) => t.id)).toEqual(["w1"]);
    expect(h.summary.projects).toEqual([{ id: p!.id, name: "BBQ", net: -150_000 }]);
    expect(h.summary.total).toBe(h.net - 150_000);

    const page = await (await call(`/api/projects/${p!.id}/months/2026-09`, { jar })).json<any>();
    expect(page).toMatchObject({ net: -150_000, expenses: { plan: 10_000, actual: 150_000, expected: 150_000 } });
    expect(page.categories[0].transactions.map((t: any) => t.id)).toEqual(["w0"]);
  });

  it("validates the month and the project", async () => {
    expect((await call("/api/months/2026-13", { jar })).status).toBe(400);
    expect((await call("/api/projects/999/months/2026-09", { jar })).status).toBe(404);
    expect((await call("/api/months/2026-09")).status).toBe(401);
  });
});
