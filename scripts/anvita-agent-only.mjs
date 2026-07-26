#!/usr/bin/env node
/**
 * Só cria o agente + chama @prospilot (conta já existente).
 * Usa sessão guardada em .anvita-auto/storage-state.json (do último anvita:auto).
 *
 *   npm run anvita:agent
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateFile = path.join(root, ".anvita-auto", "storage-state.json");

if (!fs.existsSync(stateFile)) {
  console.error(`
Sessão não encontrada: ${stateFile}

Opções:
  1. npm run anvita:auto     (conta nova + agente completo)
  2. No browser logado: clica «Add Agent» → preenche wizard manualmente
`);
  process.exit(1);
}

process.env.ANVITA_AGENT_ONLY = "1";
await import(pathToFileURL(path.join(root, "scripts", "anvita-auto-onboard.mjs")).href);
