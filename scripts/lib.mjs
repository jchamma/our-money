// Shared helpers for the install scripts (setup, update, add-person, remove-person).
// Node built-ins only. Terminal text is English: many terminals render Hebrew badly.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG = join(ROOT, "wrangler.jsonc");
export const EXAMPLE = join(ROOT, "wrangler.example.jsonc");
export const DRY = process.argv.includes("--dry-run");

const WRANGLER = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const VITE = join(ROOT, "node_modules", "vite", "bin", "vite.js");

// ── terminal ────────────────────────────────────────────────────────────────

export const bold = (s) => `\x1b[1m${s}\x1b[0m`;
export const green = (s) => `\x1b[32m${s}\x1b[0m`;
export const dim = (s) => `\x1b[2m${s}\x1b[0m`;
export const step = (n, total, title) => console.log(`\n${bold(`[${n}/${total}] ${title}`)}`);
export const ok = (s) => console.log(`  ${green("✓")} ${s}`);

export function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

// One reader for the whole run, with a queue: lines typed (or piped) ahead of a question aren't lost.
// It's paused between questions so child processes (wrangler login, deploy prompts) get the keyboard.
let rl;
let muted = false;
let waiting;
const queue = [];
function reader() {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    const write = rl._writeToOutput.bind(rl);
    // While `muted`, keystrokes aren't echoed: tokens and keys never show on screen.
    rl._writeToOutput = (s) => (muted ? (/[\r\n]/.test(s) ? write("\n") : undefined) : write(s));
    rl.on("line", (line) => {
      if (!waiting) return void queue.push(line);
      const w = waiting;
      waiting = undefined;
      w(line);
    });
    rl.on("close", () => {
      rl = undefined;
      if (waiting) fail("Input ended before setup finished.");
    });
  }
  return rl;
}

/** One line of input. `hidden` doesn't echo what's typed (tokens, keys). */
export async function ask(question, { hidden = false, def } = {}) {
  const prompt = `  ${question}${def !== undefined ? dim(` [${def}]`) : ""}: `;
  const r = reader();
  r.setPrompt(prompt);
  r.prompt();
  muted = hidden;
  r.resume();
  const answer = queue.length ? queue.shift() : await new Promise((resolve) => (waiting = resolve));
  if (!process.stdin.isTTY) process.stdout.write(hidden ? "\n" : `${answer}\n`);
  muted = false;
  r.pause();
  const a = answer.trim();
  return a === "" && def !== undefined ? String(def) : a;
}

/** Let the process exit once all questions are done. */
export const done = () => rl?.close();

export async function askUntil(question, valid, opts = {}, retry = "That doesn't look right, try again.") {
  for (;;) {
    const a = await ask(question, opts);
    if (await valid(a)) return a;
    console.log(`  ${retry}`);
  }
}

export async function confirm(question, def = true) {
  const a = (await ask(`${question} (${def ? "Y/n" : "y/N"})`)).toLowerCase();
  return a === "" ? def : a === "y" || a === "yes";
}

export const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

// ── processes ───────────────────────────────────────────────────────────────

let childEnv = process.env;

/**
 * An API token in the environment overrides `wrangler login`, and often lacks the permissions
 * setup needs. Offer to ignore it for this run.
 */
export async function chooseCloudflareAuth() {
  if (!process.env.CLOUDFLARE_API_TOKEN) return;
  console.log("  CLOUDFLARE_API_TOKEN is set in your environment. Wrangler will use it instead of your login.");
  if (!(await confirm("Use your normal Cloudflare login instead (recommended)?"))) return;
  childEnv = { ...process.env };
  delete childEnv.CLOUDFLARE_API_TOKEN;
}

/**
 * Run a command. `capture` returns stdout (still echoed unless `quiet`); `input` is written to
 * stdin (used for secrets, so they never appear on a command line).
 */
export function run(file, args, opts) {
  return spawnRun(process.execPath, [file, ...args], `${file === WRANGLER ? "wrangler" : file === VITE ? "vite" : file} ${args.join(" ")}`, opts);
}

/** Run a program that isn't a Node script (the GitHub CLI). Same options as `run`. */
export const runExe = (exe, args, opts) => spawnRun(exe, args, `${basename(exe)} ${args.join(" ")}`, opts);

function spawnRun(command, argv, shown, { capture = false, quiet = false, input, allowFail = false } = {}) {
  if (DRY) {
    console.log(dim(`  (dry run) ${shown}`));
    return Promise.resolve({ code: 0, out: "" });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: ROOT,
      env: childEnv,
      stdio: [input !== undefined ? "pipe" : "inherit", capture ? "pipe" : "inherit", "inherit"],
    });
    let out = "";
    if (capture)
      child.stdout.on("data", (d) => {
        out += d;
        if (!quiet) process.stdout.write(d);
      });
    if (input !== undefined) child.stdin.end(input);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !allowFail) reject(new Error(`"${shown}" failed (exit ${code})`));
      else resolve({ code, out });
    });
  });
}

/**
 * Install the app's packages, so a guide needs only `node scripts/<x>.mjs`: the same command in
 * PowerShell (which blocks npm's .ps1 shim), Command Prompt and macOS Terminal. Uses the npm that
 * ships next to this Node.
 */
export async function installPackages() {
  const nodeDir = dirname(process.execPath);
  const npmCli = [
    process.env.npm_execpath,
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"), // Windows
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), // macOS, Linux
  ].find((p) => p && p.endsWith(".js") && existsSync(p));
  if (!npmCli) fail("Couldn't find npm next to Node. Reinstall Node.js from https://nodejs.org and try again.");
  console.log("  Getting the app ready (about a minute)…");
  await run(npmCli, ["install", "--no-audit", "--no-fund", "--loglevel=error"]);
  ok("App ready");
}

/** Install the packages if this folder doesn't have them yet. */
export const ensurePackages = () => (existsSync(WRANGLER) && existsSync(VITE) ? undefined : installPackages());

export const wrangler = (args, opts) => run(WRANGLER, args, opts);
export const vite = (args, opts) => run(VITE, args, opts);

/** Run SQL against the installation's remote D1. Values must already be safe to inline (see `sql`). */
export async function d1(dbName, command, { json = false } = {}) {
  const args = ["d1", "execute", dbName, "--remote", "--yes", "--command", command];
  if (!json) return wrangler(args, { capture: true, quiet: true });
  const { out } = await wrangler([...args, "--json"], { capture: true, quiet: true });
  return DRY ? [] : (JSON.parse(out)[0]?.results ?? []);
}

/** A SQL string literal. Only used for values we generated or validated (hashes, ciphertext, emails). */
export const sql = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** Build the app and deploy it; returns the address wrangler printed (or null). */
export async function buildAndDeploy() {
  await vite(["build"]);
  // The Vite plugin writes the built Worker's config under dist/<worker>/ and leaves a pointer to it
  // in <vite root>/.wrangler/deploy/. Our Vite root is web/, where wrangler doesn't look: pass it.
  const pointer = join(ROOT, "web", ".wrangler", "deploy", "config.json");
  const built = DRY ? "dist/<worker>/wrangler.json" : join(dirname(pointer), JSON.parse(readFileSync(pointer, "utf8")).configPath);
  const { out } = await wrangler(["deploy", "--config", built], { capture: true });
  return /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(out)?.[0] ?? null;
}

// ── wrangler.jsonc ──────────────────────────────────────────────────────────

export function readConfig() {
  if (!existsSync(CONFIG)) fail("No wrangler.jsonc here. Run `node scripts/setup.mjs` first.");
  return readFileSync(CONFIG, "utf8");
}

export const writeConfig = (text) => (DRY ? console.log(dim("  (dry run) would write wrangler.jsonc")) : writeFileSync(CONFIG, text));

/** Read a top-level-ish `"key": "value"` string from the JSONC text. */
export function getValue(text, key) {
  const m = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(text);
  return m ? JSON.parse(m[1]) : undefined;
}

/** Replace the first `"key": "…"` string value, keeping comments and layout. */
export function setValue(text, key, value) {
  const re = new RegExp(`("${key}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
  if (!re.test(text)) throw new Error(`wrangler.jsonc has no "${key}"`);
  return text.replace(re, (_, head) => head + JSON.stringify(value));
}

export const allowedEmails = (text) =>
  (getValue(text, "ALLOWED_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

// ── secrets and hashes (same formats as src/token.ts and src/auth/util.ts) ──

const AAD = new TextEncoder().encode("family-finance:riseup_token:v1");

export const newTokenKey = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");

export async function encryptToken(token, keyB64) {
  const key = await crypto.subtle.importKey("raw", Buffer.from(keyB64, "base64"), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, new TextEncoder().encode(token));
  return `v1.${Buffer.from(iv).toString("base64")}.${Buffer.from(ct).toString("base64")}`;
}

export const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export async function sha256(s) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── RiseUp ──────────────────────────────────────────────────────────────────

export const israelMonth = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);

/** "ok" | "rejected" | "unavailable". The token goes only to RiseUp, never into a message. */
export async function checkRiseupToken(token) {
  if (token.length < 16 || token.length > 512 || /\s/.test(token)) return "rejected";
  try {
    const res = await fetch(`https://input.riseup.co.il/api/external/budget/${israelMonth()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "manual",
    });
    if (res.status === 401 || res.status === 403) return "rejected";
    return res.ok ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** The SQL that stores the encrypted token, as the app's renewal screen would. */
export function tokenSql(ciphertext, now = new Date()) {
  const expires = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const rows = [
    ["riseup_token", ciphertext],
    ["riseup_token_saved_at", now.toISOString()],
    ["riseup_token_expires_at", expires],
    ["riseup_token_status", "ok"],
  ];
  return `INSERT INTO settings (key, value) VALUES ${rows.map(([k, v]) => `(${sql(k)}, ${sql(v)})`).join(", ")} ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
}

/** Cancel every invite link not used yet, so an old link can't take a freed place. */
export const revokeInvites = (dbName) => d1(dbName, "DELETE FROM invites WHERE used_at IS NULL");

/**
 * Write wrangler.jsonc, build and deploy; if the deploy fails, put the old file back so the
 * local config keeps matching what's online.
 */
export async function deployConfig(text) {
  const before = readConfig();
  writeConfig(text);
  const auto = await import("./auto-update.mjs");
  if (auto.autoUpdateOn() && !DRY) {
    if (await auto.deployThroughGitHub(text, before)) return null;
    writeConfig(before);
    fail("The change wasn't deployed. Run this again in a few minutes.");
  }
  try {
    return await buildAndDeploy();
  } catch (e) {
    writeConfig(before);
    throw e;
  }
}

/** A single-use passkey invite, valid 24 hours. Only its hash is stored. */
export async function createInvite(dbName, address) {
  const token = randomToken();
  const expires = new Date(Date.now() + 24 * 3_600_000).toISOString();
  await d1(dbName, `INSERT INTO invites (token_hash, expires_at) VALUES (${sql(await sha256(token))}, ${sql(expires)})`);
  return `${address}/invite/${token}`;
}
