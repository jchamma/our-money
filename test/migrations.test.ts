import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const columns = async (table: string) =>
  (await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).results.map((r) => r.name);

beforeEach(async () => {
  await env.DB.batch(["sessions", "passkey_credentials", "members"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("migration 0002", () => {
  it("creates the project, auth and settings tables", async () => {
    const tables = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()).results.map((r) => r.name);
    for (const t of [
      "project_categories", "project_category_plans", "merchant_rules", "audit_log", "members", "passkey_credentials",
      "invites", "email_codes", "auth_flows", "sessions", "login_attempts", "settings",
    ]) {
      expect(tables).toContain(t);
    }
  });

  it("reshapes transactions and projects", async () => {
    const tx = await columns("transactions");
    expect(tx).toEqual(expect.arrayContaining(["project_category_id", "assignment", "first_seen_at"]));
    expect(tx).not.toContain("note");
    const projects = await columns("projects");
    for (const gone of ["budget", "starts_on", "ends_on"]) expect(projects).not.toContain(gone);
  });

  it("allows at most two members, whatever the code does", async () => {
    await env.DB.prepare("INSERT INTO members (name) VALUES ('A'), ('B')").run();
    await expect(env.DB.prepare("INSERT INTO members (name) VALUES ('C')").run()).rejects.toThrow("member limit reached");
  });

  it("rejects negative plans and unknown assignment values", async () => {
    const p = await env.DB.prepare("INSERT INTO projects (name) VALUES ('P') RETURNING id").first<{ id: number }>();
    const c = await env.DB.prepare("INSERT INTO project_categories (project_id, name, kind) VALUES (?, 'X', 'expense') RETURNING id")
      .bind(p!.id)
      .first<{ id: number }>();
    await expect(
      env.DB.prepare("INSERT INTO project_category_plans (project_category_id, month, amount) VALUES (?, '2026-09', -1)").bind(c!.id).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO transactions (id, cashflow_month, transaction_date, business_name, amount, is_income, raw, last_sync_run, assignment) VALUES ('x', '2026-09', '2026-09-01', 'S', 1, 0, '{}', 1, 'bogus')",
      ).run(),
    ).rejects.toThrow();
    await env.DB.batch([env.DB.prepare("DELETE FROM project_categories"), env.DB.prepare("DELETE FROM projects")]);
  });
});
