#!/usr/bin/env node
/**
 * N contas em sequência (uma de cada vez) ou paralelo com --parallel.
 *
 *   npm run anvita:auto:5        → 5 contas em paralelo (Brave, tela normal)
 *   node scripts/run-anvita-auto-batch.mjs 5 --parallel
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const parallel = args.includes("--parallel");
const count = args.find((a) => /^\d+$/.test(a)) || process.env.ANVITA_BATCH || "2";

function hasPlaywright() {
  return fs.existsSync(path.join(root, "node_modules", "playwright"));
}

if (!hasPlaywright()) {
  console.log("Instalando playwright…");
  execSync("npm i -D playwright", { cwd: root, stdio: "inherit", shell: true });
  execSync("npx playwright install chromium", { cwd: root, stdio: "inherit", shell: true });
}

process.env.ANVITA_BATCH = String(count);
process.env.ANVITA_SEQUENTIAL = parallel ? "0" : "1";
if (!process.env.ANVITA_BROWSER) {
  process.env.ANVITA_BROWSER = "brave";
}
await import(pathToFileURL(path.join(root, "scripts", "anvita-auto-onboard.mjs")).href);
