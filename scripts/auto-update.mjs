// `node scripts/auto-update.mjs`: turn on automatic updates. Creates a private GitHub repository in
// your account whose workflow checks for a new version every hour, and installs it (database first,
// then the app) with a Cloudflare API token you create once. setup.mjs and update.mjs offer this too.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DRY, ROOT, ask, bold, dim, done, ok, readConfig, runExe } from "./lib.mjs";

/** The project the installations follow. */
export const UPSTREAM = "jchamma/our-money";
const REPO_NAME = "our-money-updates";
/** Remembers the repository, so later config changes reach it too (gitignored). */
const STATE = join(ROOT, ".auto-update.json");

const WORKFLOW = `# Installs each new version of Our Money (${UPSTREAM}) on your Cloudflare account.
# Made by scripts/auto-update.mjs. To stop automatic updates, delete this repository.
name: Update
on:
  schedule:
    - cron: "${Math.floor(Math.random() * 60)} */3 * * *"
  workflow_dispatch:
    inputs:
      force:
        description: Install even if nothing changed
        type: boolean
        default: false
jobs:
  update:
    uses: ${UPSTREAM}/.github/workflows/auto-update.yml@master
    with:
      force: \${{ inputs.force == true }}
    secrets:
      CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      WRANGLER_CONFIG: \${{ secrets.WRANGLER_CONFIG }}
`;

// The token form, pre-filled with exactly what an update needs.
const TOKEN_URL = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(
  JSON.stringify([
    { key: "workers_scripts", type: "edit" },
    { key: "d1", type: "edit" },
    { key: "account_settings", type: "read" },
  ]),
)}&accountId=*&zoneId=all&name=${REPO_NAME}`;

const readState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null);
const writeState = (state) => DRY || writeFileSync(STATE, JSON.stringify(state, null, 2));

/** Is the GitHub CLI installed? Returns its path, installing it on Windows if needed. */
async function findGh() {
  const winPath = "C:\\Program Files\\GitHub CLI\\gh.exe";
  for (const exe of ["gh", winPath]) {
    const r = await runExe(exe, ["--version"], { capture: true, quiet: true, allowFail: true }).catch(() => null);
    if (r?.code === 0) return exe;
  }
  if (process.platform === "win32") {
    console.log("  Installing the GitHub CLI (about a minute)…");
    const r = await runExe("winget", ["install", "--id", "GitHub.cli", "-e", "--silent", "--accept-source-agreements", "--accept-package-agreements"], {
      allowFail: true,
    }).catch(() => null);
    if (r?.code === 0 && existsSync(winPath)) return winPath;
  } else if (process.platform === "darwin") {
    const r = await runExe("brew", ["install", "gh"], { allowFail: true }).catch(() => null);
    if (r?.code === 0) return "gh";
  }
  return null;
}

/** The GitHub user, logged in with the scopes this needs (repo, workflow). */
async function githubLogin(gh) {
  const who = async () => {
    const { code, out } = await runExe(gh, ["api", "-i", "user"], { capture: true, quiet: true, allowFail: true });
    if (code !== 0) return null;
    const scopes = /x-oauth-scopes:\s*(.*)/i.exec(out)?.[1] ?? "";
    return { login: JSON.parse(out.slice(out.indexOf("{"))).login, workflow: /\bworkflow\b/.test(scopes) };
  };
  let user = await who();
  if (!user) {
    console.log("  A browser window will open. Log in to GitHub (or sign up, free), enter the code shown here, and allow access.");
    await runExe(gh, ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web", "--scopes", "workflow"]);
    user = await who();
  } else if (!user.workflow) {
    console.log("  GitHub needs one more permission (to create the update workflow). A browser window will open.");
    await runExe(gh, ["auth", "refresh", "--hostname", "github.com", "--scopes", "workflow"]);
    user = await who();
  }
  if (!user?.login) throw new Error("Couldn't log in to GitHub");
  return user.login;
}

async function cloudflareApi(path, token) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" });
  return res.ok ? (await res.json()).result : null;
}

/** Asks for the API token until Cloudflare accepts it; returns it with the account it can use. */
async function cloudflareToken() {
  console.log(`\n  Create a Cloudflare API token for the updates. Open this link (the form is already filled in):`);
  console.log(`\n  ${TOKEN_URL}\n`);
  console.log("  Under Account Resources choose your account, then: Continue to summary › Create Token › Copy.");
  for (;;) {
    const token = await ask("Cloudflare API token (hidden)", { hidden: true });
    if (DRY) return { token, accountId: "dry-run" };
    const verified = await cloudflareApi("/user/tokens/verify", token).catch(() => null);
    const accounts = verified?.status === "active" ? await cloudflareApi("/accounts", token).catch(() => null) : null;
    if (accounts?.length === 1) return { token, accountId: accounts[0].id };
    if (accounts?.length > 1) {
      accounts.forEach((a, i) => console.log(`  ${i + 1}) ${a.name}`));
      const n = Number(await ask("Which account is the app on"));
      if (accounts[n - 1]) return { token, accountId: accounts[n - 1].id };
    }
    console.log("  Cloudflare didn't accept that token. Copy it again (or create a new one) and paste it.");
  }
}

const setSecret = (gh, repo, name, value) => runExe(gh, ["secret", "set", name, "--repo", repo], { input: value, capture: true, quiet: true });

/** Put the workflow file in the repository (creating or replacing it). */
async function putWorkflow(gh, repo) {
  const path = `repos/${repo}/contents/.github/workflows/update.yml`;
  const current = await runExe(gh, ["api", path, "--jq", ".sha"], { capture: true, quiet: true, allowFail: true });
  const args = ["api", "-X", "PUT", path, "-f", "message=Automatic updates for Our Money", "-f", `content=${Buffer.from(WORKFLOW).toString("base64")}`];
  if (current.code === 0 && current.out.trim()) args.push("-f", `sha=${current.out.trim()}`);
  await runExe(gh, args, { capture: true, quiet: true });
}

/** Run the workflow now (forced, so it deploys even with nothing new) and wait for it. */
async function runNow(gh, repo) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const since = Date.now() - 60_000; // GitHub's clock may differ a little from ours
  let started = false;
  for (let i = 0; i < 10 && !started; i++) {
    started = (await runExe(gh, ["workflow", "run", "update.yml", "--repo", repo, "-f", "force=true"], { capture: true, quiet: true, allowFail: true })).code === 0;
    if (!started) await sleep(3000); // a new workflow takes a few seconds to register
  }
  if (DRY) return true;
  if (!started) return false;
  let id;
  for (let i = 0; i < 20 && !id; i++) {
    await sleep(3000);
    const { out } = await runExe(
      gh,
      ["run", "list", "--repo", repo, "--workflow", "update.yml", "--event", "workflow_dispatch", "--limit", "5", "--json", "databaseId,createdAt"],
      { capture: true, quiet: true, allowFail: true },
    );
    id = JSON.parse(out || "[]").find((r) => Date.parse(r.createdAt) >= since)?.databaseId;
  }
  if (!id) return false;
  const { code } = await runExe(gh, ["run", "watch", String(id), "--repo", repo, "--exit-status", "--interval", "10"], { capture: true, quiet: true, allowFail: true });
  return code === 0;
}

/**
 * Set up (or repair) automatic updates for the installation described by `config`.
 * Returns false if it couldn't, with what to do printed; the app itself is unaffected.
 */
export async function enableAutoUpdate(config) {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    console.log("  GH_TOKEN or GITHUB_TOKEN is set in your environment, so the GitHub login can't be used. Remove it, then run: node scripts/auto-update.mjs");
    return false;
  }
  const gh = DRY ? "gh" : await findGh();
  if (!gh) {
    console.log(`  Install the GitHub CLI from ${bold("https://cli.github.com")}, then run: node scripts/auto-update.mjs`);
    return false;
  }
  try {
    const login = DRY ? "you" : await githubLogin(gh);
    const repo = `${login}/${REPO_NAME}`;
    const exists = (await runExe(gh, ["repo", "view", repo, "--json", "name"], { capture: true, quiet: true, allowFail: true })).code === 0;
    if (!exists || DRY)
      await runExe(gh, ["repo", "create", repo, "--private", "--description", "Automatic updates for Our Money"], { capture: true, quiet: true });
    ok(`GitHub repository ${repo} (private)`);

    const { token, accountId } = await cloudflareToken();
    await setSecret(gh, repo, "CLOUDFLARE_API_TOKEN", token);
    await setSecret(gh, repo, "CLOUDFLARE_ACCOUNT_ID", accountId);
    await setSecret(gh, repo, "WRANGLER_CONFIG", config);
    await putWorkflow(gh, repo);
    writeState({ repo, verified: false });

    console.log("  Checking it works: installing the current version through GitHub (2–4 minutes)…");
    if (!(await runNow(gh, repo))) {
      console.log(`  The first update didn't finish. See why at https://github.com/${repo}/actions , then run: node scripts/auto-update.mjs`);
      return false;
    }
    writeState({ repo, verified: true });
    ok("Automatic updates are on: every new version installs itself within about 3 hours");
    return true;
  } catch (e) {
    console.log(`  Couldn't turn on automatic updates (${e.message}). Run: node scripts/auto-update.mjs`);
    return false;
  }
}

/**
 * With automatic updates on, a settings change (add-person, remove-person) is deployed by the
 * workflow, with the newest version: deploying from this folder could put an older version back.
 * Returns false if it didn't work; the workflow's settings are then put back to `before`.
 */
export async function deployThroughGitHub(config, before) {
  const { repo } = readState();
  const gh = await findGh();
  if (!gh) return false;
  console.log("  Deploying through your automatic updates (2–4 minutes)…");
  try {
    await setSecret(gh, repo, "WRANGLER_CONFIG", config);
    if (await runNow(gh, repo)) return true;
    console.log(`  See why at https://github.com/${repo}/actions`);
  } catch {
    /* falls through */
  }
  await setSecret(gh, repo, "WRANGLER_CONFIG", before).catch(() => undefined);
  return false;
}

/** Automatic updates set up and proven by a first run. */
export const autoUpdateOn = () => !!readState()?.verified;

if (process.argv[1] && basename(process.argv[1]) === "auto-update.mjs") {
  console.log(`\n${bold("Our Money · automatic updates")}`);
  console.log(dim("  A private GitHub repository installs each new version for you. Your data never goes to GitHub."));
  const on = await enableAutoUpdate(readConfig());
  console.log("");
  done();
  process.exit(on ? 0 : 1);
}
