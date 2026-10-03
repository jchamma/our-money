// `node scripts/update.mjs` (or `node scripts/update.mjs`): after downloading a new version, bring the database up to date and deploy
// the new version. Your data and settings stay as they are.
import { bold, buildAndDeploy, chooseCloudflareAuth, done, getValue, installPackages, ok, readConfig, wrangler } from "./lib.mjs";

const config = readConfig();
const db = getValue(config, "database_name");

console.log(`\n${bold("Our Money · update")}`);
await installPackages(); // a new version can bring new packages
await chooseCloudflareAuth();
await wrangler(["d1", "migrations", "apply", db, "--remote"]);
ok("Database up to date");
const address = await buildAndDeploy();
ok(`New version online${address ? ` at ${address}` : ""}\n`);
done();
