// `npm run update`: after `git pull` and `npm install`, bring the database up to date and deploy
// the new version. Your data and settings stay as they are.
import { bold, buildAndDeploy, chooseCloudflareAuth, done, getValue, ok, readConfig, wrangler } from "./lib.mjs";

const config = readConfig();
const db = getValue(config, "database_name");

console.log(`\n${bold("Our Money · update")}`);
await chooseCloudflareAuth();
await wrangler(["d1", "migrations", "apply", db, "--remote"]);
ok("Database up to date");
const address = await buildAndDeploy();
ok(`New version online${address ? ` at ${address}` : ""}\n`);
done();
