// `node scripts/setup.mjs`: a private copy of the app on your own free Cloudflare account.
// Asks everything up front, then creates the database, deploys, and prints the address
// (and, with passkeys, one invite link per person). `--dry-run` shows the steps without doing them.
import { existsSync, readFileSync } from "node:fs";
import {
  CONFIG,
  DRY,
  EMAIL,
  EXAMPLE,
  ask,
  askUntil,
  bold,
  buildAndDeploy,
  checkRiseupToken,
  chooseCloudflareAuth,
  confirm,
  createInvite,
  d1,
  dim,
  encryptToken,
  fail,
  getValue,
  revokeInvites,
  green,
  newTokenKey,
  ok,
  setValue,
  sql,
  step,
  tokenSql,
  wrangler,
  writeConfig,
  done,
  ensurePackages,
} from "./lib.mjs";
import { enableAutoUpdate } from "./auto-update.mjs";

const TOTAL = 8;

console.log(`\n${bold("Our Money · setup")}${DRY ? dim("  (dry run: nothing is created)") : ""}`);
console.log("  About 5 minutes. Everything runs on your own Cloudflare account, on the free plan.");

// wrangler.jsonc is written before deploy (the build needs it) and marked unfinished until the end,
// so a setup that stopped half way can simply be run again.
const UNFINISHED = "// UNFINISHED SETUP: run `node scripts/setup.mjs` again to finish.";
const previous = existsSync(CONFIG) ? readFileSync(CONFIG, "utf8") : null;
if (previous && !previous.startsWith(UNFINISHED) && !DRY)
  fail("wrangler.jsonc already exists, so this copy is already set up. To install a new version, run `node scripts/update.mjs`.");
if (previous?.startsWith(UNFINISHED)) console.log("  Finishing the setup that stopped last time. Answer the questions again; nothing is duplicated.");

await ensurePackages();

// ── 1. Cloudflare ──
step(1, TOTAL, "Cloudflare account");
await chooseCloudflareAuth();
const who = await wrangler(["whoami"], { capture: true, quiet: true, allowFail: true });
if (!DRY && (who.code !== 0 || /not authenticated/i.test(who.out))) {
  console.log("  A browser window will open. Log in to Cloudflare (or sign up, free) and allow access.");
  await wrangler(["login"]);
}
ok("Logged in to Cloudflare");

// ── 2. Login method ──
step(2, TOTAL, "How will you log in?");
console.log(`  1) ${bold("Passkeys")} (Face ID / fingerprint)  ${bold("RECOMMENDED")} · nothing else to set up`);
console.log("  2) Google account                  · needs a Google Cloud project (about 10 more minutes)");
console.log("  3) Code by email                   · needs a Brevo account (about 10 more minutes)");
const mode = { 1: "passkey", 2: "google", 3: "email" }[await askUntil("Choose 1, 2 or 3", (a) => ["1", "2", "3"].includes(a), { def: 1 })];
ok(`Login with ${mode === "passkey" ? "passkeys" : mode === "google" ? "Google" : "an email code"}`);

// ── 3. People ──
step(3, TOTAL, "Who gets access?");
const people = Number(await askUntil("How many people (1 or 2)", (a) => a === "1" || a === "2", { def: 2 }));
const emails = [];
if (mode !== "passkey") {
  for (let i = 1; i <= people; i++) {
    const label = mode === "google" ? "Google account (Gmail)" : "email";
    emails.push((await askUntil(`Person ${i}: ${label}`, (a) => EMAIL.test(a) && !emails.includes(a.toLowerCase()))).toLowerCase());
  }
  ok(`Only ${emails.join(" and ")} can log in`);
} else ok(`${people} ${people === 1 ? "person" : "people"}; each gets a one-time invite link at the end`);

const secrets = {};
let emailFrom = "";
if (mode === "email") {
  console.log(`\n  ${bold("Brevo")} sends the login codes. In Brevo: SMTP & API › API keys › Generate a new API key.`);
  secrets.BREVO_API_KEY = await askUntil("Brevo API key (hidden)", brevoKeyWorks, { hidden: true }, "Brevo didn't accept that key. Copy it again and paste it.");
  ok("Brevo key works");
  emailFrom = await askUntil("Send codes from (a sender email you verified in Brevo)", (a) => EMAIL.test(a));
}

// ── 4. RiseUp ──
step(4, TOTAL, "Connect RiseUp");
console.log("  Open https://input.riseup.co.il/developer/tokens , create a token with the budget:read scope, and copy it (it starts with riseup_pat_).");
let riseupToken = "";
for (;;) {
  riseupToken = await ask("RiseUp token (hidden)", { hidden: true });
  const result = DRY ? "ok" : await checkRiseupToken(riseupToken);
  if (result === "ok") break;
  if (result === "rejected") console.log("  RiseUp didn't accept this token. Create a new one and paste it.");
  else if (await confirm("Couldn't reach RiseUp to check the token. Try again?")) continue;
  else fail("Stopped before creating anything. Run `node scripts/setup.mjs` again when RiseUp is reachable.");
}
ok("RiseUp token works (it's valid for 30 days; you renew it from the app)");

const name = await askUntil("Name for this copy (letters, digits, dashes)", (a) => /^[a-z][a-z0-9-]{1,40}$/.test(a), { def: (previous && getValue(previous, "name")) || "our-money" });

// ── 5. Database ──
step(5, TOTAL, "Create the database");
const existing = await listDatabases();
let dbId = existing.find((d) => d.name === name)?.uuid;
if (dbId) {
  if (!(await confirm(`A database named "${name}" already exists on this account. Use it?`, !!previous)))
    fail("Stopped. Run `node scripts/setup.mjs` again with a different name.");
} else {
  await wrangler(["d1", "create", name], { capture: true, quiet: true });
  dbId = (await listDatabases()).find((d) => d.name === name)?.uuid ?? (DRY ? "00000000-0000-0000-0000-000000000000" : null);
  if (!dbId) fail("The database was created but couldn't be found. Run `npx wrangler d1 list` to check.");
}

let config = readFileSync(EXAMPLE, "utf8");
config = setValue(config, "name", name);
config = setValue(config, "database_name", name);
config = setValue(config, "database_id", dbId);
config = setValue(config, "AUTH_MODE", mode);
config = setValue(config, "ALLOWED_EMAILS", emails.join(","));
config = setValue(config, "EMAIL_FROM", emailFrom);
writeConfig(`${UNFINISHED}
${config}`);
ok("Settings saved in wrangler.jsonc (kept on this computer only)");

await wrangler(["d1", "migrations", "apply", name, "--remote"]);
ok("Database ready");

// ── 6. Deploy ──
step(6, TOTAL, "Put the app online");
const address = (await buildAndDeploy()) ?? (DRY ? `https://${name}.example.workers.dev` : await askAddress());
ok(`Online at ${address}`);

// The key that encrypts the RiseUp token: made here, stored only as a Cloudflare secret.
secrets.TOKEN_KEY = newTokenKey();
await wrangler(["secret", "bulk"], { input: JSON.stringify(secrets), capture: true, quiet: true });
await d1(name, tokenSql(await encryptToken(riseupToken, secrets.TOKEN_KEY)));
await d1(name, `INSERT INTO settings (key, value) VALUES ('app_url', ${sql(address)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
riseupToken = "";
ok("RiseUp token stored encrypted");

// Google needs the app's address first, so its client is created now, while setup waits.
if (mode === "google") {
  console.log(`\n  ${bold("Google")}: create an OAuth client (type "Web application") in Google Cloud with:`);
  console.log(`    Authorized JavaScript origin:  ${address}`);
  console.log(`    Authorized redirect URI:       ${address}/auth/google/callback`);
  const google = {
    GOOGLE_CLIENT_ID: await askUntil("Client ID", (a) => /\.apps\.googleusercontent\.com$/.test(a)),
    GOOGLE_CLIENT_SECRET: await askUntil("Client secret (hidden)", (a) => a.length >= 10, { hidden: true }),
  };
  await wrangler(["secret", "bulk"], { input: JSON.stringify(google), capture: true, quiet: true });
  ok("Google login connected");
}

// ── 7. Automatic updates ──
step(7, TOTAL, "Automatic updates");
console.log("  New versions (fixes, improvements) install themselves, through a private GitHub repository in your account.");
console.log(dim("  Your data never goes to GitHub. Needs a free GitHub account; you can open one now."));
if (await confirm("Turn on automatic updates (recommended)?")) await enableAutoUpdate(config);
else console.log(dim("  Skipped. To turn them on later: node scripts/auto-update.mjs"));

// ── 8. Access ──
step(8, TOTAL, "Open the app");
if (mode === "passkey") {
  console.log("  Send each person their own link. Open it on the phone, and Face ID / fingerprint does the rest.");
  console.log(`  ${dim("Each link works once, for 24 hours. Need a new one? node scripts/add-person.mjs")}\n`);
  await revokeInvites(name); // links from a setup that stopped half way
  for (let i = 1; i <= people; i++) console.log(`  Person ${i}:  ${await createInvite(name, address)}`);
} else {
  console.log(`  Open ${address} on your phone and log in with ${emails.join(" or ")}.`);
}
console.log(`\n  ${green(bold("Done."))} On the phone: Share › Add to Home Screen (iPhone), or ⋮ › Install app (Android).`);
console.log(`  ${dim("The app brings the latest from RiseUp every time you open it.")}\n`);

writeConfig(config); // setup finished
done();

// ── helpers ──

async function listDatabases() {
  const { out } = await wrangler(["d1", "list", "--json"], { capture: true, quiet: true });
  return DRY ? [] : JSON.parse(out);
}

async function brevoKeyWorks(key) {
  try {
    const res = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": key, accept: "application/json" }, redirect: "manual" });
    return res.ok;
  } catch {
    return false;
  }
}

async function askAddress() {
  console.log("  Couldn't read the app's address from the output above.");
  return (await askUntil("Paste the https://….workers.dev address it printed", (a) => /^https:\/\/[a-z0-9.-]+\.workers\.dev$/i.test(a))).replace(/\/$/, "");
}
