#!/usr/bin/env node
/**
 * Instala Playwright (se faltar) e corre onboarding automático.
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function hasPlaywright() {
  return fs.existsSync(path.join(root, "node_modules", "playwright"));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!hasPlaywright()) {
  console.log("Instalando playwright…");
  execSync("npm i -D playwright", { cwd: root, stdio: "inherit", shell: true });
  console.log("Instalando Chromium…");
  execSync("npx playwright install chromium", { cwd: root, stdio: "inherit", shell: true });
}

run("node", ["scripts/anvita-auto-onboard.mjs"]);
