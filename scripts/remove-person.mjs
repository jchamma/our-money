// `npm run remove-person`: take someone's access away. They're logged out everywhere at once.
// Passkeys: deletes the person with their passkeys. Google / email code: removes the email and deploys.
import {
  allowedEmails,
  ask,
  askUntil,
  bold,
  chooseCloudflareAuth,
  confirm,
  d1,
  deployConfig,
  done,
  fail,
  getValue,
  ok,
  readConfig,
  revokeInvites,
  setValue,
  sql,
} from "./lib.mjs";

const config = readConfig();
const mode = getValue(config, "AUTH_MODE");
const db = getValue(config, "database_name");

console.log(`\n${bold("Our Money · remove a person")}`);
await chooseCloudflareAuth();

if (mode === "passkey") {
  const members = await d1(db, "SELECT id, name FROM members ORDER BY id", { json: true });
  if (members.length === 0) fail("Nobody has access yet.");
  members.forEach((m, i) => console.log(`  ${i + 1}) ${m.name || "(no name yet)"}`));
  const pick = members[Number(await askUntil("Who", (a) => Number(a) >= 1 && Number(a) <= members.length)) - 1];
  if (!(await confirm(`Remove ${pick.name || "this person"}? Their passkeys stop working.`, false))) process.exit(0);
  // Unused links first, or one could take the freed place. Passkeys and sessions go with the
  // member (ON DELETE CASCADE).
  await revokeInvites(db);
  await d1(db, `DELETE FROM members WHERE id = ${Number(pick.id)}`);
  ok("Removed. To let them in again (say, on a new phone): npm run add-person\n");
} else {
  const emails = allowedEmails(config);
  if (emails.length === 0) fail("Nobody has access yet.");
  emails.forEach((e, i) => console.log(`  ${i + 1}) ${e}`));
  const email = emails[Number(await askUntil("Who", (a) => Number(a) >= 1 && Number(a) <= emails.length)) - 1];
  if (emails.length === 1) console.log("  This is the last person: nobody will be able to log in until you add someone.");
  if (!(await confirm(`Remove ${email}?`, false))) process.exit(0);
  const rest = emails.filter((e) => e !== email);
  if (rest.length === 0 && (await ask("Type REMOVE to confirm")) !== "REMOVE") process.exit(0);
  // Deploy first: their row is removed only once the live app no longer lets them in.
  await deployConfig(setValue(config, "ALLOWED_EMAILS", rest.join(",")));
  await d1(db, `DELETE FROM members WHERE lower(email) = ${sql(email)}`);
  ok(`${email} can't log in any more\n`);
}
done();
