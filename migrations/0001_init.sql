-- Money is stored as INTEGER agorot (ILS * 100) so sums are exact.

CREATE TABLE projects (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  budget       INTEGER,              -- agorot, positive = planned spend
  starts_on    TEXT,                 -- YYYY-MM-DD
  ends_on      TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'archived')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE accounts (
  hash         TEXT PRIMARY KEY,     -- RiseUp accountNumberHash
  source       TEXT,
  source_type  TEXT,
  riseup_nickname TEXT,
  nickname     TEXT                  -- ours; set once in the app
);

-- RiseUp owns every column except project_id and note; sync overwrites the rest.
CREATE TABLE transactions (
  id               TEXT PRIMARY KEY, -- RiseUp transactionId
  cashflow_month   TEXT NOT NULL,    -- YYYY-MM
  transaction_date TEXT NOT NULL,    -- YYYY-MM-DD (local date)
  billing_date     TEXT,
  business_name    TEXT NOT NULL,
  amount           INTEGER NOT NULL, -- agorot, always positive
  is_income        INTEGER NOT NULL,
  category_label   TEXT,
  category_type    TEXT,
  actual_type      TEXT,
  envelope_id      TEXT,
  envelope_type    TEXT,
  is_excluded      INTEGER NOT NULL DEFAULT 0,
  account_hash     TEXT,
  source           TEXT,
  source_type      TEXT,
  is_installment   INTEGER NOT NULL DEFAULT 0,
  installment_number INTEGER,
  installments_total INTEGER,
  is_postponed     INTEGER NOT NULL DEFAULT 0,
  raw              TEXT NOT NULL,    -- RiseUp payload as received
  last_sync_run    INTEGER NOT NULL,
  removed_at       TEXT,             -- set when RiseUp stops returning it
  project_id       INTEGER REFERENCES projects(id),
  note             TEXT
);
CREATE INDEX transactions_month ON transactions (cashflow_month);
CREATE INDEX transactions_project ON transactions (project_id);

CREATE TABLE budget_snapshots (
  month           TEXT PRIMARY KEY,  -- YYYY-MM
  last_updated_at TEXT,
  cashflow_hash   TEXT,
  raw             TEXT NOT NULL,
  synced_at       TEXT NOT NULL
);

CREATE TABLE sync_runs (
  id           INTEGER PRIMARY KEY,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
  months       TEXT NOT NULL,        -- JSON array of YYYY-MM
  upserted     INTEGER NOT NULL DEFAULT 0,
  removed      INTEGER NOT NULL DEFAULT 0,
  error        TEXT
);
