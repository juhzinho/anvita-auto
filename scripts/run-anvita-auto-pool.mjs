#!/usr/bin/env node
/**
 * Pool contínuo: N workers — quando um termina, abre outro até atingir a meta.
 *
 *   npm run anvita:auto:100          → 100 contas, 3 workers (pool contínuo)
 *   node scripts/run-anvita-auto-pool.mjs 100 3   → 100 contas, 3 workers
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const total = args[0] || process.env.ANVITA_POOL_TOTAL || "100";
const workers = args[1] || process.env.ANVITA_POOL_WORKERS || "3";

function hasPlaywright() {
  return fs.existsSync(path.join(root, "node_modules", "playwright"));
}

if (!hasPlaywright()) {
  console.log("Instalando playwright…");
  execSync("npm i -D playwright", { cwd: root, stdio: "inherit", shell: true });
  execSync("npx playwright install chromium", { cwd: root, stdio: "inherit", shell: true });
}

process.env.ANVITA_POOL = "1";
process.env.ANVITA_POOL_TOTAL = String(total);
process.env.ANVITA_POOL_WORKERS = String(workers);
if (!process.env.ANVITA_BROWSER) {
  if (process.env.ANVITA_VPS === "1") {
    process.env.ANVITA_BROWSER = process.platform === "win32" ? "edge" : "chromium";
  } else {
    process.env.ANVITA_BROWSER = process.platform === "win32" ? "brave" : "chromium";
  }
}

await import(pathToFileURL(path.join(root, "scripts", "anvita-auto-onboard.mjs")).href);
