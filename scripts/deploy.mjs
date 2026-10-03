// `npm run deploy`: build and deploy this installation (no database changes; `npm run update` does both).
import { buildAndDeploy, chooseCloudflareAuth, done, ensurePackages, ok } from "./lib.mjs";

await ensurePackages();
await chooseCloudflareAuth();
const address = await buildAndDeploy();
ok(`Deployed${address ? ` at ${address}` : ""}`);
done();
