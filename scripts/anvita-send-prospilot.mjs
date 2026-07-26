#!/usr/bin/env node
/**
 * Envia @prospilot e aguarda resposta antes de fechar o browser.
 *
 *   npm run anvita:msg
 *   npm run anvita:msg -- 1 2
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outDir = path.join(root, ".anvita-auto");
const HEADED =
  process.env.ANVITA_HEADED === "1" ||
  process.env.ANVITA_HEADED === "true" ||
  process.env.ANVITA_HEADED !== "0";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const slotsArg = process.argv.slice(2).map(Number).filter(Boolean);
const slots =
  slotsArg.length > 0
    ? slotsArg
    : existsSync(outDir)
      ? readdirSync(outDir)
          .filter((f) => /^storage-state-\d+\.json$/.test(f))
          .map((f) => Number(f.match(/(\d+)/)[1]))
          .sort((a, b) => a - b)
      : [];

if (!slots.length) {
  console.error("Nenhuma sessão em .anvita-auto/storage-state-*.json");
  process.exit(1);
}

const { callProspilot, launchPlaywrightBrowser } = await import("./anvita-auto-onboard.mjs");

async function main() {
  const browser = await launchPlaywrightBrowser({
    args: ["--window-size=1280,980"],
  });

  for (const slot of slots) {
    const statePath = path.join(outDir, `storage-state-${slot}.json`);
    if (!existsSync(statePath)) {
      console.warn(`[P${slot}] Sessão em falta`);
      continue;
    }
    const context = await browser.newContext({
      storageState: statePath,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    try {
      await callProspilot(page, slot);
    } catch (err) {
      console.error(`[P${slot}] ❌ ${err.message || err}`);
    } finally {
      await context.close();
    }
  }

  if (HEADED) await sleep(5_000);
  await browser.close();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
