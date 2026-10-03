// `node scripts/add-person.mjs`: give someone access (at most 2 people).
// Passkeys: prints a new one-time invite link (also for a new phone, after `node scripts/remove-person.mjs`).
// Google / email code: adds the email to the allowed list and deploys.
import {
  EMAIL,
  allowedEmails,
  askUntil,
  bold,
  chooseCloudflareAuth,
  createInvite,
  d1,
  deployConfig,
  done,
  ensurePackages,
  fail,
  getValue,
  ok,
  readConfig,
  revokeInvites,
  setValue,
} from "./lib.mjs";

const config = readConfig();
const mode = getValue(config, "AUTH_MODE");
const db = getValue(config, "database_name");

console.log(`\n${bold("Our Money · add a person")}`);
await ensurePackages();
await chooseCloudflareAuth();

if (mode === "passkey") {
  const [{ n } = { n: 0 }] = await d1(db, "SELECT count(*) AS n FROM members", { json: true });
  if (n >= 2) fail("Two people already have access. Remove one first: node scripts/remove-person.mjs");
  const [{ value: address } = {}] = await d1(db, "SELECT value FROM settings WHERE key = 'app_url'", { json: true });
  const base = address ?? (await askUntil("The app's address (https://…)", (a) => /^https:\/\/\S+$/.test(a))).replace(/\/$/, "");
  await revokeInvites(db); // only the newest link works
  console.log("\n  Send this link to the person. It works once, for 24 hours (earlier unused links stop working):\n");
  console.log(`  ${await createInvite(db, base)}\n`);
} else {
  const emails = allowedEmails(config);
  if (emails.length >= 2) fail(`Two people already have access (${emails.join(", ")}). Remove one first: node scripts/remove-person.mjs`);
  const email = (await askUntil(mode === "google" ? "Their Google account (Gmail)" : "Their email", (a) => EMAIL.test(a) && !emails.includes(a.toLowerCase()))).toLowerCase();
  await deployConfig(setValue(config, "ALLOWED_EMAILS", [...emails, email].join(",")));
  ok(`${email} can log in now${mode === "google" ? " (with Google in \"Testing\" mode, also add it under Test users)" : ""}\n`);
}
done();
