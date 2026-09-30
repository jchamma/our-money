// Read API for the home screen (6a) and a project's page (6e). All amounts integer agorot.
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { categoryKey, monthSummary, ongoingForecast, projectForecast, type Envelope, type EnvelopeActual } from "./forecast";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Today's date in Israel, YYYY-MM-DD. */
export const israelToday = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);

type TxRow = {
  id: string;
  transaction_date: string;
  business_name: string;
  amount: number;
  is_income: number;
  category_label: string | null;
  envelope_id: string | null;
  envelope_type: string | null;
  is_excluded: number;
  project_id: number | null;
  project_category_id: number | null;
  account: string | null;
};

const TX_SELECT = `
  SELECT t.id, t.transaction_date, t.business_name, t.amount, t.is_income, t.category_label, t.envelope_id, t.envelope_type,
         t.is_excluded, t.project_id, t.project_category_id, coalesce(a.nickname, a.riseup_nickname) AS account
  FROM transactions t LEFT JOIN accounts a ON a.hash = t.account_hash
  WHERE t.cashflow_month = ? AND t.removed_at IS NULL`;

const txView = (t: TxRow) => ({
  id: t.id,
  date: t.transaction_date,
  merchant: t.business_name,
  amount: t.amount,
  income: t.is_income === 1,
  category: t.category_label,
  account: t.account,
  projectId: t.project_id,
  projectCategoryId: t.project_category_id,
});

function envelopesOf(raw: string | null): Envelope[] {
  if (!raw) return [];
  const budget = JSON.parse(raw) as { envelopes?: { id: string; type: string; originalAmount?: number | null; balanceDate?: string }[] };
  return (budget.envelopes ?? []).map((e) => ({
    id: e.id,
    type: e.type,
    plan: Math.round((e.originalAmount ?? 0) * 100),
    balanceDate: e.balanceDate?.slice(0, 10),
  }));
}

/** Net forecast per project for a month, for the summary card and the project page. */
async function projectNets(db: D1Database, month: string) {
  const [projects, cats, txs] = await db.batch<any>([
    db.prepare("SELECT id, name, status FROM projects ORDER BY id"),
    db.prepare(
      `SELECT c.id, c.project_id, c.name, c.kind, coalesce(p.amount, 0) AS plan
       FROM project_categories c LEFT JOIN project_category_plans p ON p.project_category_id = c.id AND p.month = ?`,
    ).bind(month),
    db.prepare(
      `SELECT project_category_id AS id, sum(amount) AS actual FROM transactions
       WHERE cashflow_month = ? AND removed_at IS NULL AND project_id IS NOT NULL GROUP BY project_category_id`,
    ).bind(month),
  ]);
  const actual = new Map<number, number>(txs.results.map((r: any) => [r.id, r.actual]));
  return (projects.results as { id: number; name: string; status: string }[]).map((p) => {
    const categories = (cats.results as any[])
      .filter((c) => c.project_id === p.id)
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind, plan: c.plan, actual: actual.get(c.id) ?? 0 }));
    const f = projectForecast(categories);
    const active = categories.some((c) => c.plan > 0 || c.actual > 0);
    return { ...p, forecast: f, active };
  });
}

export function monthRoutes(now: () => Date) {
  const r = new Hono<AppEnv>();

  r.get("/months/:month", async (c) => {
    const month = c.req.param("month");
    if (!MONTH.test(month)) return c.json({ error: "invalid" }, 400);
    const db = c.env.DB;
    const [snapshot, txs, labels] = await db.batch<any>([
      db.prepare("SELECT raw, synced_at FROM budget_snapshots WHERE month = ?").bind(month),
      db.prepare(`${TX_SELECT} ORDER BY t.transaction_date DESC, t.id`).bind(month),
      // A tracked category's display name: the latest RiseUp label seen for it in any month.
      db.prepare(
        // The category = the envelope id without its "YYYY-MM#" prefix and any weekly "#n" suffix.
        // SQLite: bare columns come from the row holding the max, i.e. the latest month.
        `SELECT CASE WHEN substr(envelope_id, -2, 1) = '#' THEN substr(envelope_id, 9, length(envelope_id) - 10)
                     ELSE substr(envelope_id, 9) END AS suffix,
                category_label AS label, max(cashflow_month) AS latest
         FROM transactions WHERE envelope_type = 'trackingCategory' AND category_label IS NOT NULL
         GROUP BY suffix`,
      ),
    ]);
    const rows = txs.results as TxRow[];
    const envelopes = envelopesOf(snapshot.results[0]?.raw ?? null);

    const actuals = new Map<string, EnvelopeActual>();
    for (const t of rows) {
      if (!t.envelope_id || t.is_excluded) continue;
      const a = actuals.get(t.envelope_id) ?? { arrived: 0, amount: 0 };
      a.arrived += 1;
      if (t.project_id === null) a.amount += t.amount;
      actuals.set(t.envelope_id, a);
    }
    const f = ongoingForecast(envelopes, actuals, israelToday(now()));

    const nameOf = new Map<string, string>((labels.results as any[]).map((l) => [categoryKey(l.suffix), l.label]));
    const ongoing = rows.filter((t) => t.project_id === null && !t.is_excluded);
    const byKey = (key: string) => ongoing.filter((t) => t.envelope_id && categoryKey(t.envelope_id) === key).map(txView);
    const byType = (pred: (t: TxRow) => boolean) => ongoing.filter(pred).map(txView);

    const projects = (await projectNets(db, month)).filter((p) => p.status === "active" || p.active);
    return c.json({
      month,
      syncedAt: snapshot.results[0]?.synced_at ?? null,
      hasBudget: envelopes.length > 0,
      net: f.net,
      variable: { ...f.variable, transactions: byType((t) => t.envelope_type === "variable") },
      tracked: f.tracked
        .filter((t) => t.plan > 0 || t.actual > 0)
        .map((t) => ({ ...t, name: nameOf.get(t.key.slice(8)) ?? null, transactions: byKey(t.key) })),
      fixed: { ...f.fixed, transactions: byType((t) => t.envelope_type === "fixed" && !t.is_income) },
      // Only income that the income line counts; a refund inside a category stays listed there.
      income: { ...f.income, transactions: byType((t) => !!t.is_income && (t.envelope_type === "fixed" || t.envelope_type === "variableIncome")) },
      notInCashflow: rows.filter((t) => t.is_excluded && t.project_id === null).map(txView),
      summary: monthSummary(f.net, projects.map((p) => ({ id: p.id, name: p.name, net: p.forecast.net }))),
    });
  });

  r.get("/projects/:id/months/:month", async (c) => {
    const id = Number(c.req.param("id"));
    const month = c.req.param("month");
    if (!Number.isInteger(id) || !MONTH.test(month)) return c.json({ error: "invalid" }, 400);
    const project = (await projectNets(c.env.DB, month)).find((p) => p.id === id);
    if (!project) return c.json({ error: "not-found" }, 404);
    const txs = await c.env.DB.prepare(`${TX_SELECT} AND t.project_id = ? ORDER BY t.transaction_date DESC, t.id`).bind(month, id).all<TxRow>();
    const f = project.forecast;
    return c.json({
      project: { id: project.id, name: project.name, status: project.status },
      month,
      net: f.net,
      expenses: f.expenses,
      income: f.income,
      categories: f.categories.map((cat) => ({
        ...cat,
        transactions: txs.results.filter((t) => t.project_category_id === cat.id).map(txView),
      })),
    });
  });

  return r;
}
