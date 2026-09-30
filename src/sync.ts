import { RiseupHttpError, type RiseupClient } from "./riseup";

/** The last `count` months, ending with the current one, in Asia/Jerusalem. */
export function recentMonths(now: Date, count = 2): string[] {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" })
    .format(now)
    .split("-")
    .map(Number);
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export type SyncResult = { runId: number; upserted: number; removed: number };

// Free Workers allow ~50 D1 queries per invocation, so each month is a constant
// 6 statements in one batch: rows go in as one JSON array and SQLite unpacks it with json_each.
const UPSERT_TRANSACTIONS = `
INSERT INTO transactions (id, cashflow_month, transaction_date, billing_date, business_name, amount, is_income,
  category_label, category_type, actual_type, envelope_id, envelope_type, is_excluded, account_hash, source,
  source_type, is_installment, installment_number, installments_total, is_postponed, raw, last_sync_run, removed_at,
  first_seen_at)
SELECT
  j.value ->> '$.t.transactionId',
  ?1,
  substr(j.value ->> '$.t.transactionDate', 1, 10),   -- RiseUp sends UTC midnight; the date part is the local day
  substr(j.value ->> '$.t.billingDate', 1, 10),
  j.value ->> '$.t.businessName',
  CAST(round((j.value ->> '$.t.amount') * 100) AS INTEGER),
  coalesce(j.value ->> '$.t.isIncome', 0),
  j.value ->> '$.t.categoryLabel',
  j.value ->> '$.t.categoryType',
  j.value ->> '$.t.actualType',
  j.value ->> '$.envelopeId',
  j.value ->> '$.envelopeType',
  j.value ->> '$.excluded',
  j.value ->> '$.account',
  j.value ->> '$.t.source',
  j.value ->> '$.t.sourceType',
  coalesce(j.value ->> '$.t.isInstallment', 0),
  j.value ->> '$.t.installmentNumber',
  coalesce(j.value ->> '$.t.totalNumberOfInstallments', j.value ->> '$.t.totalNumberOfPayments'),
  coalesce(j.value ->> '$.t.isPostponed', 0),
  j.value -> '$.t',
  ?2,
  NULL,
  ?4                                                   -- first_seen_at: never updated below
FROM json_each(?3) AS j WHERE true
ON CONFLICT (id) DO UPDATE SET cashflow_month = excluded.cashflow_month,
  transaction_date = excluded.transaction_date, billing_date = excluded.billing_date,
  business_name = excluded.business_name, amount = excluded.amount, is_income = excluded.is_income,
  category_label = excluded.category_label, category_type = excluded.category_type,
  actual_type = excluded.actual_type, envelope_id = excluded.envelope_id, envelope_type = excluded.envelope_type,
  is_excluded = excluded.is_excluded, account_hash = excluded.account_hash, source = excluded.source,
  source_type = excluded.source_type, is_installment = excluded.is_installment,
  installment_number = excluded.installment_number, installments_total = excluded.installments_total,
  is_postponed = excluded.is_postponed, raw = excluded.raw, last_sync_run = excluded.last_sync_run,
  removed_at = NULL`;

const UPSERT_ACCOUNTS = `
INSERT INTO accounts (hash, source, source_type, riseup_nickname)
SELECT j.value ->> '$.hash', j.value ->> '$.source', j.value ->> '$.sourceType', j.value ->> '$.nickname'
FROM json_each(?1) AS j WHERE true
ON CONFLICT (hash) DO UPDATE SET source = excluded.source, source_type = excluded.source_type,
  riseup_nickname = excluded.riseup_nickname`;

// Merchant rules ("always assign this merchant to the project"): only rows no person has placed
// (assignment IS NULL), first seen after the rule was made, while the project is active.
const RULE_MATCH = `
  FROM transactions t
  JOIN merchant_rules r ON r.business_name = t.business_name
  JOIN projects p ON p.id = r.project_id AND p.status = 'active'
  WHERE t.cashflow_month = ?1 AND t.assignment IS NULL AND t.project_id IS NULL AND t.removed_at IS NULL
    AND julianday(t.first_seen_at) >= julianday(r.created_at)`;
const RULE_LABEL = "coalesce(nullif(trim(t.category_label), ''), 'אחר')";
const RULE_KIND = "CASE WHEN t.is_income THEN 'income' ELSE 'expense' END";

const RULE_CATEGORIES = `
INSERT INTO project_categories (project_id, name, kind)
SELECT DISTINCT r.project_id, ${RULE_LABEL}, ${RULE_KIND} ${RULE_MATCH}
ON CONFLICT (project_id, name, kind) DO NOTHING`;

const RULE_ASSIGN = `
UPDATE transactions AS u SET
  project_id = m.project_id,
  project_category_id = (SELECT c.id FROM project_categories c WHERE c.project_id = m.project_id AND c.name = m.label AND c.kind = m.kind),
  assignment = 'rule'
FROM (SELECT t.id, r.project_id, ${RULE_LABEL} AS label, ${RULE_KIND} AS kind ${RULE_MATCH}) AS m
WHERE u.id = m.id`;

/**
 * Mirror RiseUp for the given months. RiseUp owns every transaction column except
 * project_id, project_category_id, assignment and first_seen_at, which are never overwritten here.
 */
export async function syncMonths(db: D1Database, client: RiseupClient, months: string[], now = new Date()): Promise<SyncResult> {
  const startedAt = now.toISOString();
  // A run killed by the CPU limit never reaches its catch; retire it here.
  const staleBefore = new Date(now.getTime() - 10 * 60_000).toISOString();
  const [, run] = await db.batch<{ id: number }>([
    db
      .prepare("UPDATE sync_runs SET status = 'error', error = 'interrupted' WHERE status = 'running' AND started_at < ?")
      .bind(staleBefore),
    db
      .prepare("INSERT INTO sync_runs (started_at, status, months) VALUES (?, 'running', ?) RETURNING id")
      .bind(startedAt, JSON.stringify(months)),
  ]);
  const runId = run.results[0].id;

  try {
    let upserted = 0;
    let removed = 0;
    for (const month of months) {
      const [budget, txs] = await Promise.all([client.budget(month), client.transactions(month)]);

      const envelopeOf = new Map<string, { id: string; type: string }>();
      for (const env of budget.envelopes) {
        for (const a of env.actuals ?? []) envelopeOf.set(a.transactionId, { id: env.id, type: env.type });
      }
      const excluded = new Set((budget.excluded ?? []).map((a) => a.transactionId));

      const accounts = new Map<string, object>();
      const rows = txs.map((t) => {
        const account = t.accountNumberHash ?? `source:${t.source ?? "unknown"}`;
        accounts.set(account, { hash: account, source: t.source, sourceType: t.sourceType, nickname: t.accountNickname });
        const env = envelopeOf.get(t.transactionId);
        return { t, account, envelopeId: env?.id, envelopeType: env?.type, excluded: excluded.has(t.transactionId) ? 1 : 0 };
      });

      const stmts = [
        db
          .prepare(
            `INSERT INTO budget_snapshots (month, last_updated_at, cashflow_hash, raw, synced_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (month) DO UPDATE SET last_updated_at = excluded.last_updated_at,
               cashflow_hash = excluded.cashflow_hash, raw = excluded.raw, synced_at = excluded.synced_at`,
          )
          .bind(month, budget.lastUpdatedAt ?? null, budget.cashflowHash ?? null, JSON.stringify(budget), startedAt),
        db.prepare(UPSERT_ACCOUNTS).bind(JSON.stringify([...accounts.values()])),
        db.prepare(UPSERT_TRANSACTIONS).bind(month, runId, JSON.stringify(rows), startedAt),
      ];
      // An empty answer is more likely a RiseUp glitch than a month with no transactions;
      // don't let it flag the whole month as removed.
      const removal = txs.length > 0 ? stmts.length : -1;
      if (txs.length > 0) {
        stmts.push(
          db
            .prepare("UPDATE transactions SET removed_at = ? WHERE cashflow_month = ? AND last_sync_run <> ? AND removed_at IS NULL")
            .bind(startedAt, month, runId),
        );
      }
      stmts.push(db.prepare(RULE_CATEGORIES).bind(month), db.prepare(RULE_ASSIGN).bind(month));
      const results = await db.batch(stmts);
      upserted += txs.length;
      if (removal >= 0) removed += results[removal].meta.changes;
    }

    await db
      .prepare("UPDATE sync_runs SET status = 'ok', finished_at = ?, upserted = ?, removed = ? WHERE id = ?")
      .bind(new Date().toISOString(), upserted, removed, runId)
      .run();
    return { runId, upserted, removed };
  } catch (e) {
    // Only our own messages are stored; others (e.g. a JSON SyntaxError) can quote the response body.
    const error = e instanceof RiseupHttpError ? e.message : `sync failed: ${(e as Error).name}`;
    await db
      .prepare("UPDATE sync_runs SET status = 'error', finished_at = ?, error = ? WHERE id = ?")
      .bind(new Date().toISOString(), error, runId)
      .run();
    throw e;
  }
}
