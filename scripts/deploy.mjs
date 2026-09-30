// `npm run deploy`: build and deploy this installation (no database changes; `npm run update` does both).
import { buildAndDeploy, chooseCloudflareAuth, done, ok } from "./lib.mjs";

await chooseCloudflareAuth();
const address = await buildAndDeploy();
ok(`Deployed${address ? ` at ${address}` : ""}`);
done();
