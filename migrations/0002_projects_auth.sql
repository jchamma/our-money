-- Phases 3–4: project categories and plans, merchant rules, our own login, and the
-- RiseUp token stored encrypted in the database. Money stays INTEGER agorot.

-- Projects no longer carry a budget or dates; plans live on project categories.
ALTER TABLE projects DROP COLUMN budget;
ALTER TABLE projects DROP COLUMN starts_on;
ALTER TABLE projects DROP COLUMN ends_on;

CREATE TABLE project_categories (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (project_id, name, kind)
);

-- One expected amount per project category per month; a missing month counts as 0.
CREATE TABLE project_category_plans (
  project_category_id INTEGER NOT NULL REFERENCES project_categories(id),
  month               TEXT NOT NULL,   -- YYYY-MM
  amount              INTEGER NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (project_category_id, month)
);

-- "Always assign this merchant to this project", applied by the sync to new rows only.
CREATE TABLE merchant_rules (
  id            INTEGER PRIMARY KEY,
  business_name TEXT NOT NULL UNIQUE,
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- RiseUp still owns every other column. `assignment` records who put the row where it is:
-- 'manual' (moved by a person), 'rule' (a merchant rule), 'ongoing' (a person returned it).
-- Rules only touch rows whose assignment is NULL, so a manual choice is never overridden.
ALTER TABLE transactions DROP COLUMN note;
ALTER TABLE transactions ADD COLUMN project_category_id INTEGER REFERENCES project_categories(id);
ALTER TABLE transactions ADD COLUMN assignment TEXT CHECK (assignment IN ('manual', 'rule', 'ongoing'));
ALTER TABLE transactions ADD COLUMN first_seen_at TEXT;  -- set on insert only
UPDATE transactions SET first_seen_at = coalesce((SELECT min(started_at) FROM sync_runs), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE transactions SET assignment = 'manual' WHERE project_id IS NOT NULL;
-- Any row already in a project (none expected: Phase 1 had no assign route) gets a category,
-- so it can't end up in neither the ongoing nor a project.
INSERT INTO project_categories (project_id, name, kind)
SELECT DISTINCT project_id, 'אחר', CASE WHEN is_income THEN 'income' ELSE 'expense' END
FROM transactions WHERE project_id IS NOT NULL AND project_category_id IS NULL;
UPDATE transactions SET project_category_id = (
  SELECT c.id FROM project_categories c
  WHERE c.project_id = transactions.project_id AND c.name = 'אחר'
    AND c.kind = CASE WHEN transactions.is_income THEN 'income' ELSE 'expense' END
) WHERE project_id IS NOT NULL AND project_category_id IS NULL;
CREATE INDEX transactions_business ON transactions (business_name);

CREATE TABLE members (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE COLLATE NOCASE,  -- Google and email modes
  name_confirmed INTEGER NOT NULL DEFAULT 0, -- 0 until the person confirms their name (frame 7e)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
-- A couple at most, whatever the code does.
CREATE TRIGGER members_limit BEFORE INSERT ON members
WHEN (SELECT count(*) FROM members) >= 2
BEGIN SELECT RAISE(ABORT, 'member limit reached'); END;

CREATE TABLE passkey_credentials (
  id            TEXT PRIMARY KEY,          -- WebAuthn credential id, base64url
  member_id     INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  public_key    TEXT NOT NULL,             -- base64url COSE key
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,                      -- JSON array
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_used_at  TEXT
);

-- Only hashes of secrets are stored: invite links, email codes, sessions, login flow state.
CREATE TABLE invites (
  token_hash  TEXT PRIMARY KEY,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE email_codes (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL COLLATE NOCASE,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX email_codes_email ON email_codes (email, created_at);

-- Short-lived state between the two halves of a login (WebAuthn challenge, Google state/nonce/PKCE).
CREATE TABLE auth_flows (
  id          TEXT PRIMARY KEY,            -- hash of the flow id held in a cookie
  kind        TEXT NOT NULL,
  data        TEXT NOT NULL,               -- JSON
  expires_at  TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at  TEXT NOT NULL
);

-- Rate limiting: one row per attempt, keyed by e.g. 'ip:1.2.3.4' or 'email:x@y'.
CREATE TABLE login_attempts (
  id   INTEGER PRIMARY KEY,
  key  TEXT NOT NULL,
  at   TEXT NOT NULL
);
CREATE INDEX login_attempts_key ON login_attempts (key, at);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  member_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     TEXT                          -- JSON, never amounts or the token
);

-- Key/value settings. The RiseUp token is stored here only as AES-GCM ciphertext;
-- the key is a Worker secret.
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
