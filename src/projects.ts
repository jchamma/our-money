// Projects: the only things this app changes. Amounts arrive as integer agorot.
import { Hono, type Context } from "hono";
import type { AppEnv } from "./env";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const KINDS = new Set(["expense", "income"]);
const MAX_AMOUNT = 100_000_000_00; // ₪100M, a sanity bound

type Tx = { id: string; is_income: number; category_label: string | null; business_name: string; project_id: number | null; removed_at: string | null };

const name = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const amountOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_AMOUNT;
const body = <T>(c: Context<AppEnv>) => c.req.json<T>().catch(() => ({}) as T);

function audit(c: Context<AppEnv>, action: string, detail: object) {
  return c.env.DB.prepare("INSERT INTO audit_log (member_id, action, detail) VALUES (?, ?, ?)").bind(c.var.member.id, action, JSON.stringify(detail));
}

async function activeProject(db: D1Database, id: unknown) {
  if (!Number.isInteger(id)) return null;
  return db.prepare("SELECT id FROM projects WHERE id = ? AND status = 'active'").bind(id).first<{ id: number }>();
}

async function loadTx(db: D1Database, id: string) {
  return db
    .prepare("SELECT id, is_income, category_label, business_name, project_id, removed_at FROM transactions WHERE id = ?")
    .bind(id)
    .first<Tx>();
}

/** The project category matching the item's RiseUp category and direction; created (no plan) if missing. */
async function categoryFor(db: D1Database, projectId: number, tx: Tx): Promise<number> {
  const kind = tx.is_income ? "income" : "expense";
  const label = tx.category_label?.trim() || "אחר";
  const row = await db
    .prepare(
      `INSERT INTO project_categories (project_id, name, kind) VALUES (?, ?, ?)
       ON CONFLICT (project_id, name, kind) DO UPDATE SET name = excluded.name RETURNING id`,
    )
    .bind(projectId, label, kind)
    .first<{ id: number }>();
  return row!.id;
}

export function projectRoutes() {
  const r = new Hono<AppEnv>();

  r.get("/projects", async (c) => {
    const rows = await c.env.DB.prepare("SELECT id, name, status FROM projects ORDER BY status = 'active' DESC, id").all();
    return c.json({ projects: rows.results });
  });

  // "+ new project" in the assign sheet (6c): name only.
  r.post("/projects", async (c) => {
    const n = name((await body<{ name?: string }>(c)).name);
    if (n.length < 1 || n.length > 60) return c.json({ error: "invalid" }, 400);
    const p = await c.env.DB.prepare("INSERT INTO projects (name) VALUES (?) RETURNING id").bind(n).first<{ id: number }>();
    await audit(c, "project-create", { projectId: p!.id }).run();
    return c.json({ id: p!.id }, 201);
  });

  // "+ add a category" (6h): name, kind and this month's expected amount.
  r.post("/projects/:id/categories", async (c) => {
    const b = await body<{ name?: string; kind?: string; month?: string; plan?: number }>(c);
    const n = name(b.name);
    const projectId = Number(c.req.param("id"));
    if (n.length < 1 || n.length > 40 || !KINDS.has(b.kind ?? "") || !MONTH.test(b.month ?? "") || !amountOk(b.plan)) {
      return c.json({ error: "invalid" }, 400);
    }
    if (!(await activeProject(c.env.DB, projectId))) return c.json({ error: "not-found" }, 404);
    let id: number;
    try {
      const row = await c.env.DB.prepare("INSERT INTO project_categories (project_id, name, kind) VALUES (?, ?, ?) RETURNING id")
        .bind(projectId, n, b.kind)
        .first<{ id: number }>();
      id = row!.id;
    } catch {
      return c.json({ error: "exists" }, 409);
    }
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO project_category_plans (project_category_id, month, amount) VALUES (?, ?, ?)").bind(id, b.month, b.plan),
      audit(c, "category-create", { projectId, categoryId: id }),
    ]);
    return c.json({ id }, 201);
  });

  // ⋮ on a project category card (6g): this month's expected amount.
  r.put("/project-categories/:id/plans/:month", async (c) => {
    const id = Number(c.req.param("id"));
    const month = c.req.param("month");
    const { amount } = await body<{ amount?: number }>(c);
    if (!Number.isInteger(id) || !MONTH.test(month) || !amountOk(amount)) return c.json({ error: "invalid" }, 400);
    const exists = await c.env.DB.prepare("SELECT 1 FROM project_categories WHERE id = ?").bind(id).first();
    if (!exists) return c.json({ error: "not-found" }, 404);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO project_category_plans (project_category_id, month, amount) VALUES (?, ?, ?)
         ON CONFLICT (project_category_id, month) DO UPDATE SET amount = excluded.amount`,
      ).bind(id, month, amount),
      audit(c, "plan-set", { categoryId: id, month }),
    ]);
    return c.json({ ok: true });
  });

  // "Move to project" (6b–6c). Returns whether to offer the always-assign prompt (6d).
  r.post("/transactions/:id/assign", async (c) => {
    const { projectId } = await body<{ projectId?: number }>(c);
    const tx = await loadTx(c.env.DB, c.req.param("id"));
    if (!tx || tx.removed_at) return c.json({ error: "not-found" }, 404);
    if (!(await activeProject(c.env.DB, projectId))) return c.json({ error: "not-found" }, 404);
    const categoryId = await categoryFor(c.env.DB, projectId!, tx);
    const [, , rule] = await c.env.DB.batch<{ n: number }>([
      c.env.DB.prepare("UPDATE transactions SET project_id = ?, project_category_id = ?, assignment = 'manual' WHERE id = ?").bind(projectId, categoryId, tx.id),
      audit(c, "assign", { transactionId: tx.id, projectId }),
      c.env.DB.prepare("SELECT count(*) AS n FROM merchant_rules WHERE business_name = ?").bind(tx.business_name),
    ]);
    return c.json({ ok: true, projectCategoryId: categoryId, offerRule: rule.results[0].n === 0 });
  });

  // "Reassign" inside a project (6f): another category, another project, or back to the ongoing.
  r.post("/transactions/:id/reassign", async (c) => {
    const b = await body<{ projectCategoryId?: number; projectId?: number; toOngoing?: boolean }>(c);
    const tx = await loadTx(c.env.DB, c.req.param("id"));
    if (!tx || tx.removed_at || tx.project_id === null) return c.json({ error: "not-found" }, 404);

    if (b.toOngoing === true) {
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE transactions SET project_id = NULL, project_category_id = NULL, assignment = 'ongoing' WHERE id = ?").bind(tx.id),
        audit(c, "return-to-ongoing", { transactionId: tx.id }),
      ]);
      return c.json({ ok: true });
    }
    if (b.projectId !== undefined) {
      if (!(await activeProject(c.env.DB, b.projectId))) return c.json({ error: "not-found" }, 404);
      const categoryId = await categoryFor(c.env.DB, b.projectId, tx);
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE transactions SET project_id = ?, project_category_id = ?, assignment = 'manual' WHERE id = ?").bind(b.projectId, categoryId, tx.id),
        audit(c, "move-project", { transactionId: tx.id, projectId: b.projectId }),
      ]);
      return c.json({ ok: true, projectCategoryId: categoryId });
    }
    if (Number.isInteger(b.projectCategoryId)) {
      const cat = await c.env.DB.prepare("SELECT kind FROM project_categories WHERE id = ? AND project_id = ?")
        .bind(b.projectCategoryId, tx.project_id)
        .first<{ kind: string }>();
      if (!cat || cat.kind !== (tx.is_income ? "income" : "expense")) return c.json({ error: "invalid" }, 400);
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE transactions SET project_category_id = ?, assignment = 'manual' WHERE id = ?").bind(b.projectCategoryId, tx.id),
        audit(c, "recategorize", { transactionId: tx.id, categoryId: b.projectCategoryId }),
      ]);
      return c.json({ ok: true });
    }
    return c.json({ error: "invalid" }, 400);
  });

  // "Yes, always" on the prompt (6d): new transactions from this merchant go to the project while it's active.
  r.post("/merchant-rules", async (c) => {
    const b = await body<{ businessName?: string; projectId?: number }>(c);
    const merchant = name(b.businessName);
    if (merchant.length < 1 || merchant.length > 200) return c.json({ error: "invalid" }, 400);
    if (!(await activeProject(c.env.DB, b.projectId))) return c.json({ error: "not-found" }, 404);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO merchant_rules (business_name, project_id, created_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT (business_name) DO UPDATE SET project_id = excluded.project_id, created_at = excluded.created_at`,
      ).bind(merchant, b.projectId),
      audit(c, "rule-set", { projectId: b.projectId }),
    ]);
    return c.json({ ok: true }, 201);
  });

  return r;
}
