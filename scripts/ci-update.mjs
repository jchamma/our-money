// Run by GitHub Actions (.github/workflows/auto-update.yml): what update.mjs does, unattended.
// The installation's wrangler.jsonc arrives as the WRANGLER_CONFIG secret; its own values go into
// this version's wrangler.example.jsonc, so a new version's config changes reach every installation.
import { readFileSync } from "node:fs";
import { EXAMPLE, buildAndDeploy, fail, getValue, ok, setValue, wrangler, writeConfig } from "./lib.mjs";

const own = process.env.WRANGLER_CONFIG;
if (!own) fail("WRANGLER_CONFIG is empty. Run `node scripts/auto-update.mjs` again on the computer you installed from.");

// The values setup.mjs fills in.
const KEYS = ["name", "database_name", "database_id", "AUTH_MODE", "ALLOWED_EMAILS", "EMAIL_FROM"];
let config = readFileSync(EXAMPLE, "utf8");
for (const key of KEYS) {
  const value = getValue(own, key);
  if (value !== undefined) config = setValue(config, key, value);
}
writeConfig(config);
const db = getValue(config, "database_name");

// D1 Time Travel can restore the database to any minute of the last 7 days (free plan); this logs
// the point just before the migrations, in case one goes wrong. Only a log line, so never fatal.
await wrangler(["d1", "time-travel", "info", db], { allowFail: true });
await wrangler(["d1", "migrations", "apply", db, "--remote"]);
ok("Database up to date");
const address = await buildAndDeploy();
ok(`New version online${address ? ` at ${address}` : ""}`);
