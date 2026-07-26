#!/usr/bin/env node
/**
 * Runner VPS (Windows ou Linux) — headless, multi-browser.
 *
 *   npm run anvita:vps
 *   node scripts/run-anvita-vps.mjs 500 2 edge
 *   node scripts/run-anvita-vps.mjs 50 3 chrome
 *
 * Windows VPS default: Edge (já vem instalado)
 * Linux VPS default: chromium
 *
 * Browsers: edge | chrome | chromium | brave | firefox | webkit
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const total = args[0] || process.env.ANVITA_POOL_TOTAL || "500";
const workers = args[1] || process.env.ANVITA_POOL_WORKERS || "2";
const defaultBrowser = process.platform === "win32" ? "edge" : "chromium";
const browser = (args[2] || process.env.ANVITA_BROWSER || defaultBrowser).toLowerCase();

process.env.ANVITA_VPS = "1";
if (process.env.ANVITA_HEADED == null) process.env.ANVITA_HEADED = "0";
process.env.ANVITA_BROWSER = browser;
process.env.ANVITA_POOL_TOTAL = String(total);
process.env.ANVITA_POOL_WORKERS = String(workers);

const platformLabel = process.platform === "win32" ? "Windows VPS" : "Linux VPS";
const headless = process.env.ANVITA_HEADED === "0";
console.log(
  `Anvita ${platformLabel} — ${total} contas, ${workers} workers, browser=${browser}, headless=${headless}`
);

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function installBrowser(name) {
  const map = {
    firefox: "firefox",
    webkit: "webkit",
    chrome: "chrome",
    "google-chrome": "chrome",
    edge: "msedge",
    msedge: "msedge",
    "microsoft-edge": "msedge",
    brave: "chromium",
    chromium: "chromium",
    playwright: "chromium",
  };
  const pkg = map[name] || "chromium";
  try {
    execSync(`npx playwright install ${pkg}`, { cwd: root, stdio: "inherit", shell: true });
  } catch {
    console.warn(`⚠ playwright install ${pkg} falhou — a tentar chromium`);
    execSync("npx playwright install chromium", { cwd: root, stdio: "inherit", shell: true });
  }
}

if (!fs.existsSync(path.join(root, "node_modules", "playwright"))) {
  console.log("Instalando dependências…");
  execSync("npm install", { cwd: root, stdio: "inherit", shell: true });
}

if (browser !== "brave") {
  installBrowser(browser);
} else {
  console.log("Browser brave — usa Brave instalado no sistema (sem download Playwright)");
}

run("node", ["scripts/run-anvita-auto-pool.mjs", total, workers]);
