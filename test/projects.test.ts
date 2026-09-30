import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptAllWebAuthn, client, resetDb, signedIn, T0, type Jar } from "./helpers";

// Synthetic data only; amounts in agorot.
const call = client({ now: () => T0, webauthn: acceptAllWebAuthn });
let jar: Jar;

async function tx(id: string, over: { label?: string | null; income?: number; merchant?: string } = {}) {
  await env.DB.prepare(
    `INSERT INTO transactions (id, cashflow_month, transaction_date, business_name, amount, is_income, category_label, raw, last_sync_run, first_seen_at)
     VALUES (?, '2026-09', '2026-09-10', ?, 41200, ?, ?, '{}', 1, '2026-09-10T03:00:00.000Z')`,
  )
    .bind(id, over.merchant ?? "Shop A", over.income ?? 0, over.label === undefined ? "סופר" : over.label)
    .run();
}
const row = (id: string) => env.DB.prepare("SELECT project_id, project_category_id, assignment FROM transactions WHERE id = ?").bind(id).first<any>();
const post = (path: string, body: unknown) => call(path, { method: "POST", body, jar });
async function project(name = "BBQ") {
  return (await (await post("/api/projects", { name })).json<{ id: number }>()).id;
}

beforeEach(async () => {
  await resetDb([
    "transactions", "merchant_rules", "project_category_plans", "project_categories", "projects",
    "sessions", "passkey_credentials", "invites", "auth_flows", "login_attempts", "audit_log", "members",
  ]);
  jar = await signedIn(call);
});

describe("projects and categories", () => {
  it("needs a session", async () => {
    expect((await call("/api/projects")).status).toBe(401);
    expect((await call("/api/projects", { method: "POST", body: { name: "X" } })).status).toBe(401);
  });

  it("creates and lists projects", async () => {
    const id = await project("Greece trip");
    const list = await (await call("/api/projects", { jar })).json<any>();
    expect(list.projects).toEqual([{ id, name: "Greece trip", status: "active" }]);
    expect((await post("/api/projects", { name: "  " })).status).toBe(400);
  });

  it("adds a category with this month's plan, and edits the plan", async () => {
    const p = await project();
    const res = await post(`/api/projects/${p}/categories`, { name: "Drinks", kind: "expense", month: "2026-09", plan: 40000 });
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: number }>();
    expect((await post(`/api/projects/${p}/categories`, { name: "Drinks", kind: "expense", month: "2026-09", plan: 1 })).status).toBe(409);

    expect((await call(`/api/project-categories/${id}/plans/2026-09`, { method: "PUT", body: { amount: 30000 }, jar })).status).toBe(200);
    const plan = await env.DB.prepare("SELECT amount FROM project_category_plans WHERE project_category_id = ? AND month = '2026-09'").bind(id).first<any>();
    expect(plan.amount).toBe(30000);
  });

  it.each([
    ["a negative plan", { plan: -1 }],
    ["a fractional plan", { plan: 10.5 }],
    ["a bad month", { month: "2026-13" }],
    ["an unknown kind", { kind: "savings" }],
  ])("rejects %s", async (_, over) => {
    const p = await project();
    expect((await post(`/api/projects/${p}/categories`, { name: "X", kind: "expense", month: "2026-09", plan: 100, ...over })).status).toBe(400);
  });
});

describe("assigning and reassigning", () => {
  it("moves an item into its RiseUp category inside the project and offers the rule once", async () => {
    await tx("t1");
    await tx("t2");
    const p = await project();
    const a = await (await post("/api/transactions/t1/assign", { projectId: p })).json<any>();
    expect(a.offerRule).toBe(true);
    const cat = await env.DB.prepare("SELECT name, kind FROM project_categories WHERE id = ?").bind(a.projectCategoryId).first();
    expect(cat).toEqual({ name: "סופר", kind: "expense" });
    expect(await row("t1")).toEqual({ project_id: p, project_category_id: a.projectCategoryId, assignment: "manual" });

    expect((await post("/api/merchant-rules", { businessName: "Shop A", projectId: p })).status).toBe(201);
    const b = await (await post("/api/transactions/t2/assign", { projectId: p })).json<any>();
    expect(b).toMatchObject({ offerRule: false, projectCategoryId: a.projectCategoryId });
  });

  it("files income under an income category, and items with no RiseUp category under 'אחר'", async () => {
    await tx("inc", { income: 1, label: "העברות" });
    await tx("nolabel", { label: null });
    const p = await project();
    const inc = await (await post("/api/transactions/inc/assign", { projectId: p })).json<any>();
    const none = await (await post("/api/transactions/nolabel/assign", { projectId: p })).json<any>();
    const cats = await env.DB.prepare("SELECT id, name, kind FROM project_categories ORDER BY id").all();
    expect(cats.results).toEqual([
      { id: inc.projectCategoryId, name: "העברות", kind: "income" },
      { id: none.projectCategoryId, name: "אחר", kind: "expense" },
    ]);
  });

  it("recategorizes only within the same project and direction", async () => {
    await tx("t1");
    const p = await project();
    const other = await project("Kitchen");
    await post("/api/transactions/t1/assign", { projectId: p });
    const meat = (await (await post(`/api/projects/${p}/categories`, { name: "Meat", kind: "expense", month: "2026-09", plan: 0 })).json<any>()).id;
    const refunds = (await (await post(`/api/projects/${p}/categories`, { name: "Refunds", kind: "income", month: "2026-09", plan: 0 })).json<any>()).id;
    const elsewhere = (await (await post(`/api/projects/${other}/categories`, { name: "Tiles", kind: "expense", month: "2026-09", plan: 0 })).json<any>()).id;

    expect((await post("/api/transactions/t1/reassign", { projectCategoryId: meat })).status).toBe(200);
    expect((await row("t1")).project_category_id).toBe(meat);
    expect((await post("/api/transactions/t1/reassign", { projectCategoryId: refunds })).status).toBe(400);
    expect((await post("/api/transactions/t1/reassign", { projectCategoryId: elsewhere })).status).toBe(400);
  });

  it("moves to another project, and returns to the ongoing marked as a person's choice", async () => {
    await tx("t1");
    const p = await project();
    const other = await project("Kitchen");
    await post("/api/transactions/t1/assign", { projectId: p });
    await post("/api/transactions/t1/reassign", { projectId: other });
    expect((await row("t1")).project_id).toBe(other);

    await post("/api/transactions/t1/reassign", { toOngoing: true });
    expect(await row("t1")).toEqual({ project_id: null, project_category_id: null, assignment: "ongoing" });
    expect((await post("/api/transactions/t1/reassign", { toOngoing: true })).status).toBe(404);
  });

  it("refuses inactive projects and unknown transactions", async () => {
    await tx("t1");
    const p = await project();
    await env.DB.prepare("UPDATE projects SET status = 'done' WHERE id = ?").bind(p).run();
    expect((await post("/api/transactions/t1/assign", { projectId: p })).status).toBe(404);
    expect((await post("/api/transactions/nope/assign", { projectId: p })).status).toBe(404);
  });

  it("writes every change to the audit log, without amounts", async () => {
    await tx("t1");
    const p = await project();
    await post("/api/transactions/t1/assign", { projectId: p });
    const log = await env.DB.prepare("SELECT action, detail FROM audit_log WHERE action <> 'login' ORDER BY id").all<any>();
    expect(log.results.map((r) => r.action)).toEqual(["project-create", "assign"]);
    expect(log.results.map((r) => r.detail).join()).not.toContain("41200");
  });
});
