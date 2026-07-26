#!/usr/bin/env node
/**
 * Onboarding Anvita 100% automático (email descartável + OTP).
 *
 *   npm run anvita:auto
 *
 * Requisitos: npm i -D playwright + Brave instalado (Windows default).
 * Browser: ANVITA_BROWSER=brave|chromium|chrome|edge|firefox|webkit
 * VPS Windows: npm run anvita:vps  (Edge headless por default)
 * VPS Linux:   npm run anvita:vps  (Chromium headless por default)
 * Se captcha bloquear send-otp, corre com ANVITA_HEADED=1 para ver o browser.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOW = process.env.ANVITA_FLOW_URL?.replace(/\/$/, "") || "https://flow.anvita.xyz";
const HEADED =
  process.env.ANVITA_VPS === "1"
    ? process.env.ANVITA_HEADED === "1" || process.env.ANVITA_HEADED === "true"
    : process.env.ANVITA_HEADED === "1" ||
      process.env.ANVITA_HEADED === "true" ||
      process.env.ANVITA_HEADED !== "0";
const SLOW = Number(process.env.ANVITA_SLOW_MS || 0);

const AGENT = {
  nome: process.env.ANVITA_AGENT_NAME || "MeuAgentePro",
  nickname: process.env.ANVITA_AGENT_NICK || "MeuAgentePro",
  persona: process.env.ANVITA_PERSONA || "The Sage",
};
const PROSPILOT_CMD = process.env.ANVITA_PROSPILOT_CMD || "What is Faroo?";
const RESPONSE_WAIT_MS = Number(process.env.ANVITA_WAIT_RESPONSE_MS || 600_000);
const DONE_SETTLE_MS = Number(process.env.ANVITA_DONE_SETTLE_MS || 2_000);
const IS_POOL = process.env.ANVITA_POOL === "1";
const NAV_WAIT = "domcontentloaded";
const POLL_MS = 1_500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function genPassword() {
  return `Aa1!${randomBytes(10).toString("base64url")}`.slice(0, 18);
}

function genUsername(email) {
  const base = email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16);
  return `${base}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 30);
}

const AUTO_DIR = path.join(__dirname, "..", ".anvita-auto");
const USED_EMAILS_FILE = path.join(AUTO_DIR, "used-emails.json");

function loadUsedEmails() {
  const used = new Set();
  if (existsSync(USED_EMAILS_FILE)) {
    try {
      for (const e of JSON.parse(readFileSync(USED_EMAILS_FILE, "utf8"))) {
        used.add(String(e).toLowerCase());
      }
    } catch {
      /* ignore */
    }
  }
  if (existsSync(AUTO_DIR)) {
    for (const f of readdirSync(AUTO_DIR)) {
      if (!/^account-\d+\.json$/i.test(f)) continue;
      try {
        const j = JSON.parse(readFileSync(path.join(AUTO_DIR, f), "utf8"));
        if (j.email) used.add(String(j.email).toLowerCase());
      } catch {
        /* ignore */
      }
    }
  }
  const poolPath = path.join(AUTO_DIR, "pool-results.json");
  if (existsSync(poolPath)) {
    try {
      for (const r of JSON.parse(readFileSync(poolPath, "utf8"))) {
        if (r.email) used.add(String(r.email).toLowerCase());
        if (r.creds?.email) used.add(String(r.creds.email).toLowerCase());
      }
    } catch {
      /* ignore */
    }
  }
  return used;
}

function saveUsedEmails(used) {
  mkdirSync(AUTO_DIR, { recursive: true });
  writeFileSync(USED_EMAILS_FILE, JSON.stringify([...used], null, 2));
}

function markEmailUsed(email) {
  const used = loadUsedEmails();
  used.add(String(email).toLowerCase());
  saveUsedEmails(used);
}

async function reserveFreshMailbox(tag) {
  const used = loadUsedEmails();
  for (let attempt = 1; attempt <= 12; attempt++) {
    const mb = await mailTmCreateWithRetry(`${tag}a${attempt}`);
    const key = mb.email.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      saveUsedEmails(used);
      return mb;
    }
  }
  throw new Error("Não foi possível reservar email único (todos em used-emails).");
}

async function mailTmCreate() {
  const domainsRes = await fetch("https://api.mail.tm/domains");
  if (!domainsRes.ok) throw new Error(`mail.tm domains HTTP ${domainsRes.status}`);
  const domainsJson = await domainsRes.json();
  const domain = domainsJson["hydra:member"]?.[0]?.domain;
  if (!domain) throw new Error("mail.tm sem domínios disponíveis.");

  const login = `prospilot${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const email = `${login}@${domain}`;
  const mailPassword = genPassword();

  const accRes = await fetch("https://api.mail.tm/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password: mailPassword }),
  });
  if (!accRes.ok) {
    const err = await accRes.text().catch(() => "");
    throw new Error(`mail.tm create account HTTP ${accRes.status}: ${err.slice(0, 120)}`);
  }

  const tokenRes = await fetch("https://api.mail.tm/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password: mailPassword }),
  });
  if (!tokenRes.ok) throw new Error(`mail.tm token HTTP ${tokenRes.status}`);
  const tokenJson = await tokenRes.json();

  return { email, mailPassword, token: tokenJson.token };
}

async function mailTmCreateWithRetry(slot) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      return await mailTmCreate();
    } catch (err) {
      const msg = String(err.message || err);
      if (!/429|rate|too many/i.test(msg) || attempt === 8) throw err;
      const wait = 6000 * attempt;
      slotLog(slot, `mail.tm busy — retry ${attempt}/8 em ${wait / 1000}s…`);
      await sleep(wait);
    }
  }
}

async function mailTmWaitOtp(token, timeoutMs = 120_000) {
  const started = Date.now();
  await sleep(2_000);
  while (Date.now() - started < timeoutMs) {
    const res = await fetch("https://api.mail.tm/messages", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json = await res.json();
      const msgs = json["hydra:member"] ?? [];
      for (const m of msgs) {
        const detailRes = await fetch(`https://api.mail.tm/messages/${m.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!detailRes.ok) continue;
        const detail = await detailRes.json();
        const text = `${detail.subject || ""}\n${detail.text || ""}\n${detail.html || ""}`;
        const hit = text.match(/\b(\d{6})\b/);
        if (hit) return hit[1];
      }
    }
    await sleep(POLL_MS);
  }
  throw new Error("OTP não chegou ao email descartável (timeout 2min).");
}

function assertPageOpen(page) {
  if (page.isClosed()) {
    throw new Error("Browser fechado — não feches a janela durante a automação.");
  }
}

async function smartGoto(page, url, timeout = 60_000) {
  assertPageOpen(page);
  await page.goto(url, { waitUntil: NAV_WAIT, timeout });
  await dismissPromoOverlay(page);
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    console.error(`
Playwright não instalado. Corre:
  npm i -D playwright
  npx playwright install chromium
`);
    process.exit(1);
  }
}

async function setInput(page, selector, value) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 30_000 });
  await el.click({ force: true });
  await el.fill("");
  await el.fill(value);
  await el.dispatchEvent("input").catch(() => {});
  await el.dispatchEvent("change").catch(() => {});
  await el.dispatchEvent("blur").catch(() => {});
  await sleep(150);
}

async function clickSendOtp(page) {
  await dismissPromoOverlay(page);
  await ensureWafCleared(page);

  const btn = page.getByRole("button", { name: /^Send OTP$/i }).first();
  if (await btn.count()) {
    try {
      await btn.waitFor({ state: "visible", timeout: 10_000 });
      await btn.scrollIntoViewIfNeeded();
      await dismissPromoOverlay(page);
      await btn.click({ force: true, timeout: 15_000 });
      return true;
    } catch {
      /* fallback JS */
    }
  }

  const clicked = await page
    .evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      const target = buttons.find((b) => /send otp/i.test(b.textContent || ""));
      if (!target || target.disabled) return false;
      target.click();
      return true;
    })
    .catch(() => false);

  return clicked;
}

async function isEmailAlreadyRegistered(page) {
  return page
    .getByText(/already registered|email is already|já registad/i)
    .first()
    .isVisible()
    .catch(() => false);
}

class EmailAlreadyRegisteredError extends Error {
  constructor(email) {
    super(`EMAIL_ALREADY_REGISTERED:${email}`);
    this.name = "EmailAlreadyRegisteredError";
    this.email = email;
  }
}

async function freshMailbox(slot) {
  return reserveFreshMailbox(slot);
}

async function otpSendConfirmed(page, response) {
  if (response && response.status() >= 200 && response.status() < 300) return true;
  const uiOk = await page
    .getByText(/sent|code sent|resent|check your email|otp sent/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (uiOk) return true;
  const resend = page.getByRole("button", { name: /Resend|Send OTP/i }).first();
  if (await resend.count()) {
    const label = (await resend.textContent().catch(() => "")) || "";
    if (/resend|\d+s/i.test(label)) return true;
  }
  return false;
}

async function sendOtpReliable(page, slot, email) {
  const emailSel = '#email, input[name="email"], input[type="email"]';

  for (let attempt = 1; attempt <= 12; attempt++) {
    slotLog(slot, attempt === 1 ? "2/5 Send OTP…" : `2/5 Send OTP — retry ${attempt}/12…`);

    if (!page.url().includes("/register")) {
      await openRegisterPage(page);
    }

    await ensureWafCleared(page);
    await dismissPromoOverlay(page);
    await setInput(page, emailSel, email);
    await sleep(300);
    if (await isEmailAlreadyRegistered(page)) {
      throw new EmailAlreadyRegisteredError(email);
    }
    await solveCaptchaIfAny(page).catch(() => {});

    const responsePromise = page
      .waitForResponse((r) => r.url().includes("/api/auth/send-otp"), { timeout: 50_000 })
      .catch(() => null);

    if (!(await clickSendOtp(page))) {
      slotLog(slot, "     Botão Send OTP não clicou — reload…");
      await page.reload({ waitUntil: "load", timeout: 90_000 }).catch(() => {});
      await sleep(1500);
      continue;
    }

    await sleep(400);
    await solveCaptchaIfAny(page).catch(() => {});

    const response = await responsePromise;
    if (response) {
      const status = response.status();
      const body = await response.text().catch(() => "");
      if (status >= 400 && /already|registered|exists|duplicate/i.test(body)) {
        throw new EmailAlreadyRegisteredError(email);
      }
    }
    if (await isEmailAlreadyRegistered(page)) {
      throw new EmailAlreadyRegisteredError(email);
    }
    if (await otpSendConfirmed(page, response)) {
      slotLog(slot, "OTP enviado.");
      return;
    }

    slotLog(slot, "     OTP ainda não confirmado — captcha/retry…");
    await sleep(1000 * Math.min(attempt, 3));
  }

  throw new Error("Send OTP falhou após 12 tentativas (captcha, WAF ou rate limit).");
}

async function waitCaptchaGone(page, timeoutMs = 60_000) {
  await page
    .waitForFunction(
      () => {
        const m = document.getElementById("aliyunCaptcha-mask");
        return !m || !m.classList.contains("mask-show");
      },
      { timeout: timeoutMs }
    )
    .catch(() => {});
  await sleep(500);
}

async function isTermsChecked(page) {
  const termsBtn = page.locator('button[role="checkbox"]').first();
  if (await termsBtn.count()) {
    const state = await termsBtn.getAttribute("aria-checked").catch(() => null);
    if (state === "true") return true;
  }
  const native = page.locator('input[type="checkbox"]').first();
  if (await native.count()) {
    return native.isChecked().catch(() => false);
  }
  return false;
}

async function agreeTerms(page) {
  await dismissCaptchaModal(page);
  await waitCaptchaGone(page, 15_000);

  for (let attempt = 0; attempt < 6; attempt++) {
    if (await isTermsChecked(page)) return;

    // shadcn/Radix: button[role=checkbox] — 1.º = Terms, 2.º = marketing
    const termsBtn = page.locator('button[role="checkbox"]').first();
    if (await termsBtn.count()) {
      await termsBtn.click({ force: true });
    } else {
      await page.getByText(/I have read and agree/i).click({ force: true }).catch(() => {});
    }

    await sleep(350);
  }

  if (!(await isTermsChecked(page))) {
    const shot = path.join(__dirname, "..", ".anvita-auto", "terms-fail.png");
    mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.error("Screenshot:", shot);
    throw new Error("Checkbox Terms of Service não ficou marcado.");
  }
}

async function dismissPromoOverlay(page) {
  await page
    .evaluate(() => {
      for (const el of document.querySelectorAll(
        '[class*="fixed"][class*="inset-0"][class*="z-[1000]"]'
      )) {
        el.remove();
      }
    })
    .catch(() => {});
}

async function dismissCaptchaModal(page) {
  const closeBtn = page
    .locator('.ant-modal-close, button[aria-label="Close"], [class*="modal"] button')
    .filter({ hasText: /^×|close$/i })
    .first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click({ force: true }).catch(() => {});
    await sleep(400);
  }
}

async function wafBlocking(page) {
  return page.evaluate(() => {
    const block = document.querySelector("#waf_nc_block");
    if (!block) return false;
    const r = block.getBoundingClientRect();
    if (r.width < 100 || r.height < 100) return false;
    const text = block.innerText || "";
    return /Access Verification|Please slide to verify/i.test(text);
  });
}

async function captchaVisible(page) {
  if (await wafBlocking(page)) return true;
  return page.evaluate(() => {
    const body = document.body?.innerText || "";
    if (/please complete the captcha|slide to verify/i.test(body)) return true;
    const mask = document.getElementById("aliyunCaptcha-mask");
    return Boolean(mask?.classList.contains("mask-show"));
  });
}

async function ensureWafCleared(page) {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!(await wafBlocking(page))) return true;
    console.log(`     WAF captcha — slider (${attempt + 1}/8)…`);
    await dragSliderInContext(page, page);
    await sleep(2500);
  }
  if (await wafBlocking(page)) {
    console.log("     ⚠ WAF ainda activo — desliza manualmente (90s)…");
    await page
      .waitForFunction(
        () => {
          const block = document.querySelector("#waf_nc_block");
          if (!block) return true;
          return !/Access Verification/i.test(block.innerText || "");
        },
        { timeout: 90_000 }
      )
      .catch(() => false);
  }
  return !(await wafBlocking(page));
}

async function dragSliderInContext(ctx, pageRef) {
  const page = pageRef || ("mouse" in ctx ? ctx : ctx.page());
  const mouse = page.mouse;
  const sliderSelectors = [
    "#aliyunCaptcha-sliding-slider",
    "#waf_nc_block #nc_1_n1z",
    "#waf_nc_block .btn_slide",
    '[id*="sliding-slider"]',
    ".sliding-slider",
    "#nc_1_n1z",
    ".btn_slide",
  ];
  const trackSelectors = [
    "#aliyunCaptcha-sliding-body",
    "#waf_nc_block #nc_1_n1t",
    '[id*="sliding-body"]',
    ".sliding-body",
    "#nc_1_n1t",
  ];

  let slider = null;
  for (const sel of sliderSelectors) {
    const loc = ctx.locator(sel).first();
    if (await loc.count()) {
      slider = loc;
      break;
    }
  }
  if (!slider) return false;

  let track = null;
  for (const sel of trackSelectors) {
    const loc = ctx.locator(sel).first();
    if (await loc.count()) {
      track = loc;
      break;
    }
  }

  const sliderBox = await slider.boundingBox();
  if (!sliderBox) return false;

  let endX;
  if (track) {
    const trackBox = await track.boundingBox();
    endX = trackBox ? trackBox.x + trackBox.width - sliderBox.width * 0.6 : sliderBox.x + 280;
  } else {
    endX = sliderBox.x + 280;
  }

  const startX = sliderBox.x + sliderBox.width / 2;
  const y = sliderBox.y + sliderBox.height / 2;

  await mouse.move(startX, y);
  await mouse.down();
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t * t * (3 - 2 * t);
    const x = startX + (endX - startX) * ease + (Math.random() - 0.5) * 2;
    await mouse.move(x, y + (Math.random() - 0.5) * 1.5);
    await sleep(12 + Math.random() * 18);
  }
  await mouse.up();
  return true;
}

async function solveSlideCaptcha(page) {
  if (!(await captchaVisible(page))) return true;

  console.log("     Resolvendo captcha (slider)…");
  if (await wafBlocking(page)) {
    return ensureWafCleared(page);
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    if (!(await captchaVisible(page))) return true;

    let dragged = await dragSliderInContext(page, page);
    if (!dragged) {
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        dragged = await dragSliderInContext(frame, page);
        if (dragged) break;
      }
    }

    await sleep(1500);

    if (!(await captchaVisible(page))) {
      console.log("     Captcha OK.");
      return true;
    }

    await sleep(800);
  }

  // último recurso: espera manual breve
  console.log("     ⚠ Slider auto falhou — tenta deslizar manualmente (60s)…");
  await page
    .waitForFunction(
      () => {
        const body = document.body?.innerText || "";
        const open = /please complete the captcha|slide to verify/i.test(body);
        const mask = document.getElementById("aliyunCaptcha-mask");
        const waf = document.querySelector("#waf_nc_block, .waf-nc-mask");
        return !open && !(mask?.classList.contains("mask-show")) && !(waf && waf.offsetParent);
      },
      { timeout: 60_000 }
    )
    .catch(() => false);

  return !(await captchaVisible(page));
}

async function solveCaptchaIfAny(page) {
  await waitCaptchaGone(page, 3000);
  if (await captchaVisible(page)) {
    const ok = await solveSlideCaptcha(page);
    if (!ok) throw new Error("Captcha não resolvido.");
  }
  await waitCaptchaGone(page, 10_000);
}

export {
  solveCaptchaIfAny,
  openGeneralChat,
  findChatInput,
  callProspilot,
  waitForProspilotResponse,
  getBrowserLaunchOptions,
  launchPlaywrightBrowser,
};

async function completeProfileSetup(page, username, password) {
  console.log("4/5 Username + password + termos");
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.getByText(/Set up your profile/i).waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});

  const userField = page.locator('input[name="username"]').first();
  if (await userField.isVisible().catch(() => false)) {
    await userField.fill(username);
  }

  const pass = page.locator('input[name="password"], input[type="password"]').first();
  if (await pass.isVisible().catch(() => false)) {
    await pass.fill(password);
  }

  const confirm = page.locator('input[name="confirmPassword"]').first();
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.fill(password);
  }

  await agreeTerms(page);
  await sleep(300);

  const signup = page.getByRole("button", { name: /^Sign up$/i }).first();
  const navPromise = page.waitForURL(/agent-init|agent\/chat|dashboard|home|authorize|register/i, {
    timeout: 90_000,
  });

  if (await signup.isVisible().catch(() => false)) {
    await signup.click();
  } else {
    await clickText(page, "Sign up", "Continue", "Create");
  }

  await solveCaptchaIfAny(page).catch(() => {});

  const termsError = page.getByText(/agree to the Terms of Service/i);
  if (await termsError.isVisible().catch(() => false)) {
    await agreeTerms(page);
    if (await signup.isVisible().catch(() => false)) await signup.click();
    await solveCaptchaIfAny(page).catch(() => {});
  }

  await navPromise.catch(() => {});
  await sleep(800);
}

async function clickText(page, ...patterns) {
  await dismissPromoOverlay(page);
  for (const p of patterns) {
    const btn = page.getByRole("button", { name: new RegExp(p, "i") }).first();
    if (await btn.count()) {
      try {
        await btn.waitFor({ state: "visible", timeout: 8000 });
        if (await btn.isEnabled()) {
          await dismissPromoOverlay(page);
          await btn.click({ force: true });
          return true;
        }
      } catch {
        /* tenta próximo */
      }
    }
  }
  return false;
}

async function clickContinueWhenReady(page, timeoutMs = 30_000) {
  await dismissPromoOverlay(page);
  const btn = page.getByRole("button", { name: /^Continue$/i }).first();
  await btn.waitFor({ state: "visible", timeout: timeoutMs });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await btn.isEnabled().catch(() => false)) {
      await btn.click({ force: true }).catch(async () => {
        await page.evaluate(() => {
          const b = [...document.querySelectorAll("button")].find((x) => /^Continue$/i.test(x.textContent || ""));
          b?.click();
        });
      });
      return true;
    }
    await sleep(200);
  }
  return false;
}

async function clickGenerateSoulWhenReady(page, timeoutMs = 45_000) {
  await page
    .getByText(/Set Boundaries|Almost there|Generate Soul/i)
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs })
    .catch(() => {});

  const btn = page.getByRole("button", { name: /Generate Soul/i }).first();
  await btn.waitFor({ state: "visible", timeout: timeoutMs });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await btn.isEnabled().catch(() => false)) {
      await btn.click({ force: true });
      return true;
    }
    await sleep(200);
  }
  return false;
}


async function fillReactInput(page, locator, value) {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  await locator.click();
  await locator.fill(value);
  await locator.dispatchEvent("input");
  await locator.dispatchEvent("change");
  await locator.dispatchEvent("blur");
}

async function fillAgentIdentity(page, agent = AGENT) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    await dismissPromoOverlay(page);
    await page
      .getByText(/Establish Identity|get to know each other/i)
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {});

    const byLabelAgent = page.getByRole("textbox", { name: /Agent Name/i });
    const byLabelNick = page.getByRole("textbox", { name: /How should I address you/i });

    if ((await byLabelAgent.count()) && (await byLabelNick.count())) {
      await fillReactInput(page, byLabelAgent.first(), agent.nome);
      await fillReactInput(page, byLabelNick.first(), agent.nickname);
      return;
    }

    const inputs = page.locator('input:visible:not([type="password"]):not([type="checkbox"])');
    const n = await inputs.count();
    if (n >= 2) {
      await fillReactInput(page, inputs.nth(0), agent.nome);
      await fillReactInput(page, inputs.nth(1), agent.nickname);
      return;
    }

    if (attempt < 6) {
      console.log(`     Identity inputs em falta — retry ${attempt}/6…`);
      await resolveAddAgentModal(page);
      await smartGoto(page, `${FLOW}/m/agent-init`, 60_000);
      await sleep(800);
    }
  }
  throw new Error("Wizard Identity — campos não encontrados.");
}

async function selectPersonaStep(page, agent = AGENT) {
  await page
    .getByText(/Shape Personality|Core Archetype/i)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .catch(() => {});

  const persona = agent.persona;
  const card = page.locator("button, [role=button], div, h3, h4, p").filter({
    hasText: new RegExp(`^\\s*${persona}\\s*$`),
  });
  if (await card.count()) {
    await card.first().click();
    return;
  }
  await page.getByText(persona, { exact: true }).first().click();
}

async function resolveAddAgentModal(page) {
  const modalVisible = await page
    .locator('[role="dialog"], [class*="modal"]')
    .filter({ hasText: /Add Agent/i })
    .first()
    .isVisible()
    .catch(() => false);
  const titleVisible = await page
    .getByText(/^Add Agent$/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (!modalVisible && !titleVisible) return false;

  console.log("     Modal Add Agent → Bring Your Own Agent…");
  await dismissPromoOverlay(page);

  const byoaHints = [
    () => page.getByText(/Connect your existing agent/i).first(),
    () => page.getByText(/^Bring Your Own Agent$/i).first(),
    () =>
      page
        .locator("div, button, a, [role=button]")
        .filter({ hasText: /Bring Your Own Agent/i })
        .filter({ hasNot: page.getByText(/^Anvita On$/i) })
        .first(),
  ];

  for (const getLoc of byoaHints) {
    const el = getLoc();
    if (await el.count()) {
      try {
        await el.click({ force: true, timeout: 10_000 });
        await sleep(1200);
        if (await page.getByText(/Establish Identity|Agent Name/i).first().isVisible().catch(() => false)) {
          return true;
        }
      } catch {
        /* próximo */
      }
    }
  }

  const clicked = await page
    .evaluate(() => {
      const blocks = [...document.querySelectorAll("div, button, a, [role=button]")];
      for (const el of blocks) {
        const t = (el.textContent || "").trim();
        if (!/Bring Your Own Agent|Connect your existing agent/i.test(t)) continue;
        if (/Anvita On.*Steward|personal Steward Agent/i.test(t) && !/Bring Your Own/i.test(t)) continue;
        el.click();
        return true;
      }
      return false;
    })
    .catch(() => false);

  if (clicked) {
    await sleep(1200);
    return true;
  }

  return false;
}

async function isStuckInitializing(page) {
  return page.evaluate(() => {
    const t = document.body?.innerText || "";
    return (
      (/Initializing/i.test(t) && /Shaping the soul|Anvita On/i.test(t)) ||
      (/Shaping the soul of your Anvita/i.test(t) && !/General chat/i.test(t))
    );
  });
}

async function escapeStuckInit(page) {
  if (!(await isStuckInitializing(page))) return false;
  console.log("     Preso em Initializing (Anvita On) — forçar chat BYOA…");
  await page.goto(`${FLOW}/agent/chat`, { waitUntil: "load", timeout: 90_000 }).catch(() => {});
  await sleep(2000);
  await ensureChatLoaded(page, "escape-init");
  const addAgent = page.getByRole("button", { name: /^Add Agent$/i });
  if (await addAgent.isVisible().catch(() => false)) {
    await addAgent.click({ force: true });
    await sleep(800);
    await resolveAddAgentModal(page);
  }
  return true;
}

async function waitPastInitializing(page, maxMs = 45_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (await isStuckInitializing(page)) {
      await sleep(2000);
      continue;
    }
    if (page.url().includes("/agent/chat") && !(await isChatBlank(page))) return true;
    if (await page.getByText(/General chat/i).first().isVisible().catch(() => false)) return true;
    await sleep(1500);
  }
  console.log("     Init timeout — navegar para chat…");
  await page.goto(`${FLOW}/agent/chat`, { waitUntil: "load", timeout: 90_000 }).catch(() => {});
  await sleep(2000);
  await escapeStuckInit(page);
  return true;
}

async function ensureWizardReady(page) {
  for (let i = 0; i < 5; i++) {
    await resolveAddAgentModal(page);
    const ok = await page
      .getByText(/Establish Identity|Shape Personality|Agent Name|get to know each other/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (ok || page.url().includes("/agent-init")) return true;
    await smartGoto(page, `${FLOW}/m/agent-init`);
    await sleep(800);
  }
  throw new Error("Wizard de agente não abriu (modal Add Agent).");
}

async function startAgentWizard(page) {
  await dismissPromoOverlay(page);
  await ensureWafCleared(page);

  await smartGoto(page, `${FLOW}/agent/chat`);
  await sleep(800);
  await escapeStuckInit(page);

  const addAgent = page.getByRole("button", { name: /^Add Agent$/i });
  if (await addAgent.isVisible().catch(() => false)) {
    console.log("     Clicar «Add Agent» → BYOA…");
    await addAgent.click({ force: true, timeout: 15_000 }).catch(async () => {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /add agent/i.test(x.textContent || ""));
        b?.click();
      });
    });
    await sleep(800);
    await resolveAddAgentModal(page);
  }

  if (await page.getByText(/Establish Identity|Agent Name/i).first().isVisible().catch(() => false)) {
    return;
  }

  await smartGoto(page, `${FLOW}/m/agent-init`);
  await sleep(800);
  await resolveAddAgentModal(page);
  await escapeStuckInit(page);
  await ensureWizardReady(page);
}

async function runAgentInit(page, agent = AGENT) {
  await startAgentWizard(page);

  console.log("     Passo 1: Establish Identity");
  await fillAgentIdentity(page, agent);
  if (!(await clickContinueWhenReady(page, 45_000))) {
    throw new Error("Continue bloqueado no passo Identity.");
  }
  await sleep(500);

  console.log("     Passo 2: Shape Personality →", agent.persona);
  await page.getByText(/Shape Personality|Core Archetype/i).first().waitFor({ state: "visible", timeout: 30_000 });
  await selectPersonaStep(page, agent);
  await sleep(300);
  if (!(await clickContinueWhenReady(page, 45_000))) {
    throw new Error("Continue bloqueado no passo Personality.");
  }
  await sleep(500);

  console.log("     Passo 3: Set Boundaries → Generate Soul");
  if (!(await clickGenerateSoulWhenReady(page, 45_000))) {
    throw new Error("Generate Soul não ficou disponível.");
  }
  await sleep(1000);

  console.log("     Aguardar chat…");
  await waitPastInitializing(page, 45_000);
  await page.waitForURL(/\/agent\/chat/, { timeout: 30_000 }).catch(async () => {
    await page.goto(`${FLOW}/agent/chat`, { waitUntil: "load", timeout: 90_000 });
  });
  await sleep(1000);
  await escapeStuckInit(page);
  await ensureChatLoaded(page, "pós-Generate Soul");
  await openGeneralChat(page);
  await waitForComposer(page, 60_000);
}

async function isChatBlank(page) {
  if (await isStuckInitializing(page)) return true;
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const hasGeneral = [...document.querySelectorAll("button")].some((b) =>
      /general chat/i.test(b.textContent || "")
    );
    const hasComposer = !!document.querySelector(
      '[contenteditable="true"].tiptap, [contenteditable="true"][data-placeholder*="Tell"], textarea'
    );
    const hasAgentUi = /MeuAgentePro|General chat|File List|Transfer|Tell your agent/i.test(text);
    if (hasGeneral || hasComposer || hasAgentUi) return false;
    return text.length < 120;
  });
}

async function ensureChatLoaded(page, label = "chat") {
  for (let attempt = 1; attempt <= 10; attempt++) {
    await dismissPromoOverlay(page);
    await escapeStuckInit(page);

    if (!(await isChatBlank(page))) {
      const ok =
        (await page.getByText(/General chat/i).first().isVisible().catch(() => false)) ||
        (await composerReady(page));
      if (ok) return true;
    }

    console.log(`     Tela preta/init — recuperar ${label} (${attempt}/10)…`);
    await page.goto(`${FLOW}/agent/chat`, { waitUntil: "load", timeout: 90_000 }).catch(() => {});
    if (attempt % 2 === 0) {
      await page.reload({ waitUntil: "load", timeout: 90_000 }).catch(() => {});
    }
    await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
    await sleep(1500 + attempt * 300);
    await ensureWafCleared(page);
    await clickGeneralChat(page).catch(() => {});
  }

  throw new Error("Chat ficou em tela preta após inicializar agente.");
}

async function getComposerLocator(page) {
  const tiptap = page.locator('[contenteditable="true"].tiptap, [contenteditable="true"][data-placeholder*="Tell"]').last();
  if (await tiptap.count()) return tiptap;
  return page.locator("textarea").last();
}

async function composerReady(page) {
  return page.evaluate(() => {
    const el = document.querySelector(
      '[contenteditable="true"].tiptap, [contenteditable="true"][data-placeholder*="Tell"]'
    );
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 80 && r.height > 15 && el.offsetParent !== null;
  });
}

async function waitForComposer(page, timeoutMs = 90_000) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector(
        '[contenteditable="true"].tiptap, [contenteditable="true"][data-placeholder*="Tell"]'
      );
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 80 && r.height > 15;
    },
    { timeout: timeoutMs }
  );
}

async function clickGeneralChat(page) {
  return page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent || "").includes("General chat")
    );
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    btn.click();
    return true;
  });
}

async function scrollComposerIntoView(page) {
  await page.evaluate(() => {
    const el = document.querySelector(
      '[contenteditable="true"].tiptap, [contenteditable="true"][data-placeholder*="Tell"]'
    );
    el?.scrollIntoView({ block: "center", behavior: "instant" });
    window.scrollTo(0, document.body.scrollHeight);
  });
  await sleep(400);
}

async function fillComposer(page, locator, text) {
  await ensureWafCleared(page);
  await scrollComposerIntoView(page);
  await page.evaluate((value) => {
    const el = document.querySelector(
      '[contenteditable="true"].tiptap, [contenteditable="true"][data-placeholder*="Tell"]'
    );
    if (!el) return;
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, text);
}

async function openGeneralChat(page) {
  await ensureChatLoaded(page, "General chat").catch(() => {});

  if (await composerReady(page)) return true;

  await ensureWafCleared(page);

  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt === 0) console.log("     General chat…");
    await clickGeneralChat(page);
    await sleep(800);
    await dismissPromoOverlay(page);

    if (await composerReady(page)) {
      console.log("     General chat aberto ✅");
      await scrollComposerIntoView(page);
      return true;
    }

    try {
      await waitForComposer(page, 8_000);
      console.log("     General chat aberto ✅");
      await scrollComposerIntoView(page);
      return true;
    } catch {
      /* retry */
    }
  }

  throw new Error("General chat não abriu — WAF captcha ou clique falhou.");
}

async function findChatInput(page) {
  await openGeneralChat(page);
  await ensureWafCleared(page);
  await waitForComposer(page, 90_000);
  return getComposerLocator(page);
}

async function ensureAgentChat(page) {
  await page.goto(`${FLOW}/agent/chat`, { waitUntil: "load", timeout: 90_000 });
  await sleep(1000);
  await ensureChatLoaded(page);

  const addAgent = page.getByRole("button", { name: /^Add Agent$/i });
  if (await addAgent.isVisible().catch(() => false)) {
    console.log("     Agente em falta — a iniciar wizard…");
    await runAgentInit(page);
  }

  await openGeneralChat(page);
  const input = await findChatInput(page);
  await input.waitFor({ state: "visible", timeout: 60_000 });
}

async function readChatState(page) {
  return page.evaluate(() => {
    const full = document.body?.innerText || "";
    const callingExec = /Calling exec/i.test(full);
    const deepThinking = /Deep thinking/i.test(full);
    const callToolExec = /Call tool exec/i.test(full);

    const prospilotDone =
      /from ProsPilot/i.test(full) ||
      /Matched ProsPilot,\s*reply below/i.test(full) ||
      (/reply below:/i.test(full) && /ProsPilot/i.test(full) && /AI-generated\.\s*Please verify/i.test(full));

    const delegationFailed =
      /command execution tools are unavailable/i.test(full) ||
      /cannot complete the delegation to @prospilot/i.test(full) ||
      /tools are unavailable in this session/i.test(full) ||
      (/delegation to @prospilot/i.test(full) && /unavailable|cannot complete/i.test(full)) ||
      /Try again later when command execution is available/i.test(full);

    return { callingExec, deepThinking, callToolExec, prospilotDone, delegationFailed, full };
  });
}

async function sendProspilotMessage(page, slot) {
  await openGeneralChat(page);
  await ensureWafCleared(page);
  const input = await findChatInput(page);
  await fillComposer(page, input, `@prospilot ${PROSPILOT_CMD}`);
  await sleep(250);
  if (!(await clickText(page, "Send", "Enviar", "Submit"))) {
    await page.keyboard.press("Enter");
  }
  console.log(`${slot ? `[P${slot}] ` : ""}Mensagem @prospilot enviada.`);
}

async function waitForProspilotResponse(page, slot) {
  const tag = slot ? `[P${slot}] ` : "";
  const deadline = Date.now() + RESPONSE_WAIT_MS;
  console.log(`${tag}Aguardar resposta ProsPilot…`);

  let lastLog = "";
  let polls = 0;
  let resends = 0;
  const MAX_RESEND = Number(process.env.ANVITA_PROSPILOT_RESEND || 6);

  while (Date.now() < deadline) {
    assertPageOpen(page);
    polls += 1;

    let s;
    try {
      if (polls === 1 || polls % 5 === 0) {
        await openGeneralChat(page).catch(() => {});
      }
      s = await readChatState(page);
    } catch (err) {
      if (/closed|destroyed/i.test(String(err.message || err))) {
        throw new Error("Browser fechado — não feches a janela enquanto o agente chama o ProsPilot.");
      }
      throw err;
    }

    if (
      s.delegationFailed &&
      !s.prospilotDone &&
      !s.callingExec &&
      !s.callToolExec &&
      !s.deepThinking &&
      resends < MAX_RESEND
    ) {
      resends += 1;
      console.log(
        `${tag}⚠ Tools indisponíveis — reenviar @prospilot (${resends}/${MAX_RESEND})…`
      );
      await sleep(2_500);
      await sendProspilotMessage(page, slot);
      lastLog = "";
      polls = 0;
      continue;
    }

    let phase = "a processar…";
    if (s.callToolExec || s.deepThinking) phase = "Deep thinking / Call tool exec…";
    if (s.callingExec) phase = "Calling exec (A2A em curso)…";
    if (phase !== lastLog) {
      console.log(`${tag}… ${phase}`);
      lastLog = phase;
    }

    if (s.prospilotDone && !s.callingExec) {
      console.log(`${tag}✅ Resposta ProsPilot completa.`);
      await sleep(DONE_SETTLE_MS);
      return true;
    }

    await sleep(POLL_MS);
  }

  throw new Error("Timeout aguardando resposta ProsPilot (delegação não concluiu).");
}

async function callProspilot(page, slot) {
  if (!page.url().includes("/agent/chat")) {
    await ensureAgentChat(page);
  } else {
    await openGeneralChat(page);
  }
  await sleep(400);
  await sendProspilotMessage(page, slot);
  await waitForProspilotResponse(page, slot);
}

const STATE_FILE = path.join(__dirname, "..", ".anvita-auto", "storage-state.json");
const BATCH = Math.max(1, Number(process.env.ANVITA_BATCH || 1));
const SEQUENTIAL = process.env.ANVITA_SEQUENTIAL === "1";
const VIEWPORT_SIZE = {
  width: Number(process.env.ANVITA_VIEWPORT_W || 1280),
  height: Number(process.env.ANVITA_VIEWPORT_H || 900),
};
const VIEWPORT = VIEWPORT_SIZE;
const PARALLEL_STAGGER_MS = Number(process.env.ANVITA_STAGGER_MS || (IS_POOL ? 2_000 : 3_000));
const MAIL_GAP_MS = Number(process.env.ANVITA_MAIL_GAP_MS || (IS_POOL ? 5_000 : 4_000));
const SLOT_FILES = BATCH > 1 || IS_POOL;

function slotTag(slot) {
  return `[P${slot}]`;
}

function slotLog(slot, msg) {
  console.log(`${slotTag(slot)} ${msg}`);
}

function resolveBravePath() {
  const candidates = [
    process.env.ANVITA_BRAVE_PATH,
    process.env.ANVITA_BROWSER_PATH,
    process.platform === "win32" &&
      "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    process.platform === "win32" &&
      process.env.LOCALAPPDATA &&
      path.join(
        process.env.LOCALAPPDATA,
        "BraveSoftware",
        "Brave-Browser",
        "Application",
        "brave.exe"
      ),
    process.platform === "darwin" &&
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    process.platform === "linux" && "/usr/bin/brave-browser",
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

let browserLaunchLogged = false;

function defaultBrowserPref() {
  if (process.env.ANVITA_BROWSER) return process.env.ANVITA_BROWSER.toLowerCase();
  if (process.env.ANVITA_VPS === "1") {
    return process.platform === "win32" ? "edge" : "chromium";
  }
  return process.platform === "win32" ? "brave" : "chromium";
}

function getBrowserLaunchOptions(extra = {}) {
  const browserPref = defaultBrowserPref();
  const { args: extraArgs, ...restExtra } = extra;
  const args = [
    "--disable-blink-features=AutomationControlled",
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    "--no-first-run",
    "--no-default-browser-check",
    ...(process.env.ANVITA_VPS === "1" || !HEADED
      ? ["--no-sandbox", "--disable-dev-shm-usage"]
      : []),
    ...(extraArgs || []),
  ];
  const opts = {
    headless: !HEADED,
    slowMo: SLOW,
    ignoreDefaultArgs: ["--enable-automation"],
    ...restExtra,
    args,
  };

  if (browserPref === "firefox" || browserPref === "webkit") {
    return { engine: browserPref, opts };
  }

  if (browserPref === "chrome" || browserPref === "google-chrome") {
    opts.channel = "chrome";
    if (!browserLaunchLogged) {
      console.log("Browser: Google Chrome (Playwright channel)");
      browserLaunchLogged = true;
    }
    return { engine: "chromium", opts };
  }

  if (browserPref === "edge" || browserPref === "msedge" || browserPref === "microsoft-edge") {
    opts.channel = "msedge";
    if (!browserLaunchLogged) {
      console.log("Browser: Microsoft Edge (Playwright channel)");
      browserLaunchLogged = true;
    }
    return { engine: "chromium", opts };
  }

  if (browserPref === "chromium" || browserPref === "playwright") {
    if (!browserLaunchLogged) {
      console.log("Browser: Chromium (Playwright bundled)");
      browserLaunchLogged = true;
    }
    return { engine: "chromium", opts };
  }

  if (browserPref === "brave") {
    const brave = resolveBravePath();
    if (brave) {
      opts.executablePath = brave;
      if (!browserLaunchLogged) {
        console.log(`Browser: Brave (${brave})`);
        browserLaunchLogged = true;
      }
    } else if (!browserLaunchLogged) {
      console.warn("⚠ Brave não encontrado — a usar Chromium do Playwright");
      browserLaunchLogged = true;
    }
    return { engine: "chromium", opts };
  }

  if (process.env.ANVITA_BROWSER_PATH) {
    opts.executablePath = process.env.ANVITA_BROWSER_PATH;
    if (!browserLaunchLogged) {
      console.log(`Browser: custom (${process.env.ANVITA_BROWSER_PATH})`);
      browserLaunchLogged = true;
    }
  } else if (!browserLaunchLogged) {
    console.warn(`⚠ Browser "${browserPref}" desconhecido — Chromium Playwright`);
    browserLaunchLogged = true;
  }
  return { engine: "chromium", opts };
}

async function launchPlaywrightBrowser(extra = {}) {
  const pw = await loadPlaywright();
  const { engine, opts } = getBrowserLaunchOptions(extra);
  if (engine === "firefox") return pw.firefox.launch(opts);
  if (engine === "webkit") return pw.webkit.launch(opts);
  return pw.chromium.launch(opts);
}

function browserWindowArgs() {
  const w = VIEWPORT.width;
  const h = VIEWPORT.height + 80;
  return [`--window-size=${w},${h}`];
}

async function openRegisterPage(page) {
  await smartGoto(page, `${FLOW}/register`, 60_000);
  await page
    .waitForSelector('#email, input[name="email"], input[type="email"]', {
      state: "visible",
      timeout: 30_000,
    })
    .catch(async () => {
      await page.reload({ waitUntil: NAV_WAIT, timeout: 60_000 });
      await page.waitForSelector('#email, input[name="email"], input[type="email"]', {
        state: "visible",
        timeout: 30_000,
      });
    });
}

async function launchBrowser(slot = 1) {
  const browser = await launchPlaywrightBrowser({ args: browserWindowArgs() });
  const ctxOpts = {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: VIEWPORT,
  };
  const stateForSlot =
    process.env.ANVITA_AGENT_ONLY === "1"
      ? path.join(__dirname, "..", ".anvita-auto", `storage-state-${slot}.json`)
      : STATE_FILE;
  if (process.env.ANVITA_AGENT_ONLY === "1" && existsSync(stateForSlot)) {
    ctxOpts.storageState = stateForSlot;
  }
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  await openRegisterPage(page);
  return { browser, context, page };
}

async function saveSession(context, creds, slot = 1) {
  const outDir = path.join(__dirname, "..", ".anvita-auto");
  mkdirSync(outDir, { recursive: true });
  const statePath = SLOT_FILES
    ? path.join(outDir, `storage-state-${slot}.json`)
    : STATE_FILE;
  await context.storageState({ path: statePath });
  if (creds) {
    const credPath = SLOT_FILES
      ? path.join(outDir, `account-${slot}.json`)
      : path.join(outDir, "last-account.json");
    writeFileSync(credPath, JSON.stringify({ ...creds, slot }, null, 2));
  }
}

async function runOnboard({ page, context, slot = 1, agent = AGENT, mailbox: presetMailbox }) {
  let mailbox = null;

  for (let mailTry = 1; mailTry <= 5; mailTry++) {
    if (mailTry === 1 && presetMailbox) {
      mailbox = presetMailbox;
    } else {
      slotLog(slot, mailTry === 1 ? "Reservar email novo…" : `Email ocupado — reservar novo (${mailTry}/5)…`);
      mailbox = await freshMailbox(`${slot}m${mailTry}`);
      await openRegisterPage(page);
    }

    const password = genPassword();
    const username = genUsername(mailbox.email);

    slotLog(slot, `Email:    ${mailbox.email}`);
    slotLog(slot, `Username: ${username}`);
    slotLog(slot, `Password: ${password}`);
    slotLog(slot, `Agent:    ${agent.nome} (${agent.persona})`);

    slotLog(slot, "1/5 Registo — email");
    if (!page.url().includes("/register")) {
      await openRegisterPage(page);
    }

    try {
      await sendOtpReliable(page, slot, mailbox.email);
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError || /EMAIL_ALREADY_REGISTERED/i.test(String(err.message))) {
        if (mailTry >= 5) throw new Error("Sem emails novos — todos já registados.");
        continue;
      }
      throw err;
    }

    slotLog(slot, "3/5 Aguardar OTP…");
    const otp = await mailTmWaitOtp(mailbox.token);
    slotLog(slot, `OTP: ${otp}`);

    await setInput(page, '#otp, input[name="otp"], input[placeholder*="OTP"]', otp);
    if (!(await clickContinueWhenReady(page, 45_000))) {
      await clickText(page, "Continue");
    }
    await sleep(2000);
    await solveCaptchaIfAny(page).catch(() => {});

    await completeProfileSetup(page, username, password);
    const creds = {
      email: mailbox.email,
      username,
      password,
      mailPassword: mailbox.mailPassword,
      agent,
      createdAt: new Date().toISOString(),
    };
    await saveSession(context, creds, slot);

    slotLog(slot, "5/5 Criar agente + @prospilot");
    await runAgentInit(page, agent);
    slotLog(slot, `URL: ${page.url()}`);
    await callProspilot(page, slot);
    await saveSession(context, null, slot);

    slotLog(slot, "✅ Concluído!");
    return creds;
  }

  throw new Error("Registo falhou — emails em conflito.");
}

async function agentOnlyMain() {
  console.log("Anvita — só criar agente + @prospilot\n");
  const { browser, context, page } = await launchBrowser();
  try {
    await runAgentInit(page);
    await callProspilot(page, 1);
    await saveSession(context);
    console.log("\n✅ Agente criado e @prospilot chamado.");
  } catch (err) {
    console.error("\n❌ Falhou:", err.message || err);
    process.exitCode = 1;
  } finally {
    if (HEADED) {
      console.log("\nBrowser aberto 30s…");
      await sleep(30_000);
    }
    await browser.close();
  }
}

async function main() {
  console.log("Anvita auto-onboard\n");
  const { browser, context, page } = await launchBrowser(1);
  try {
    await runOnboard({ page, context, slot: 1, agent: AGENT });
    console.log(`\nCredenciais: ${path.join(__dirname, "..", ".anvita-auto", "last-account.json")}`);
    console.log(`Chat: ${FLOW}/agent/chat`);
  } catch (err) {
    console.error("\n❌ Falhou:", err.message || err);
    process.exitCode = 1;
  } finally {
  if (HEADED) {
    console.log("\nBrowser aberto 10s para inspeção…");
    await sleep(10_000);
  }
    await browser.close();
  }
}

async function batchMain(count = 3) {
  console.log(`Anvita auto-onboard — ${count} páginas em paralelo (${VIEWPORT.width}x${VIEWPORT.height})\n`);

  console.log(`A criar ${count} emails descartáveis (sequencial, evita rate limit)…`);
  const mailboxes = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) await sleep(MAIL_GAP_MS);
    mailboxes.push(await mailTmCreateWithRetry(i + 1));
    console.log(`  email ${i + 1}: ${mailboxes[i].email}`);
  }
  console.log("");

  const runSlot = async (slot, mailbox) => {
    await sleep((slot - 1) * PARALLEL_STAGGER_MS);
    const agent = {
      nome: `${AGENT.nome}${slot}`,
      nickname: `${AGENT.nickname || AGENT.nome}${slot}`,
      persona: AGENT.persona,
    };
    const { browser, context, page } = await launchBrowser(slot);
    try {
      const creds = await runOnboard({ page, context, slot, agent, mailbox });
      return { slot, ok: true, creds };
    } catch (err) {
      slotLog(slot, `❌ Falhou: ${err.message || err}`);
      return { slot, ok: false, error: String(err.message || err) };
    } finally {
      await saveSession(context, null, slot).catch(() => {});
      await browser.close().catch(() => {});
    }
  };

  const results = await Promise.allSettled(
    mailboxes.map((mailbox, idx) => runSlot(idx + 1, mailbox))
  );

  const summary = results.map((r) => (r.status === "fulfilled" ? r.value : { ok: false, error: r.reason }));
  const outDir = path.join(__dirname, "..", ".anvita-auto");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "batch-results.json"), JSON.stringify(summary, null, 2));

  const ok = summary.filter((s) => s.ok).length;
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Batch: ${ok}/${count} concluídas`);
  console.log(`Resumo: ${path.join(outDir, "batch-results.json")}`);

  if (ok < count) process.exitCode = 1;
}

async function sequentialBatchMain(count = 5) {
  console.log(`Anvita auto-onboard — ${count} contas, uma de cada vez (${VIEWPORT.width}x${VIEWPORT.height})\n`);
  const results = [];
  const outDir = path.join(__dirname, "..", ".anvita-auto");

  for (let slot = 1; slot <= count; slot++) {
    console.log(`\n${"═".repeat(52)}`);
    console.log(`  Conta ${slot}/${count}`);
    console.log(`${"═".repeat(52)}\n`);

    const agent = {
      nome: count > 1 ? `${AGENT.nome}${slot}` : AGENT.nome,
      nickname: count > 1 ? `${AGENT.nickname || AGENT.nome}${slot}` : AGENT.nickname || AGENT.nome,
      persona: AGENT.persona,
    };

    const { browser, context, page } = await launchBrowser(slot);
    try {
      const creds = await runOnboard({ page, context, slot, agent });
      results.push({ slot, ok: true, creds });
    } catch (err) {
      slotLog(slot, `❌ Falhou: ${err.message || err}`);
      results.push({ slot, ok: false, error: String(err.message || err) });
    } finally {
      await browser.close();
    }

    if (slot < count) {
      console.log(`\nPausa 5s antes da próxima conta…\n`);
      await sleep(5000);
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "batch-results.json"), JSON.stringify(results, null, 2));

  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${"─".repeat(52)}`);
  console.log(`Sequencial: ${ok}/${count} concluídas`);
  console.log(`Resumo: ${path.join(outDir, "batch-results.json")}`);

  if (ok < count) process.exitCode = 1;
}

async function poolMain(total = 100, workers = 2) {
  const outDir = path.join(__dirname, "..", ".anvita-auto");
  mkdirSync(outDir, { recursive: true });
  const resultsPath = path.join(outDir, "pool-results.json");
  const logPath = path.join(outDir, "pool-run.log");

  const results = existsSync(resultsPath)
    ? JSON.parse(readFileSync(resultsPath, "utf8"))
    : [];

  let successCount = results.filter((r) => r.ok).length;
  let attemptSeq = results.length;
  const inFlight = new Set();
  const bootUsed = loadUsedEmails();
  console.log(`Emails já usados (nunca repetir): ${bootUsed.size}`);

  console.log(
    `Anvita pool — ${workers} workers, meta ${total} contas OK (${VIEWPORT.width}x${VIEWPORT.height})\n`
  );
  if (successCount > 0) {
    console.log(`Retomar: ${successCount}/${total} já concluídas\n`);
  }

  let lock = Promise.resolve();
  const withLock = (fn) => {
    const next = lock.then(fn, fn);
    lock = next.catch(() => {});
    return next;
  };

  async function takeMailbox(workerId, targetNum) {
    return withLock(async () => {
      await sleep(MAIL_GAP_MS);
      return reserveFreshMailbox(`${workerId}#${targetNum}`);
    });
  }

  const persist = (entry) =>
    withLock(() => {
      results.push(entry);
      writeFileSync(resultsPath, JSON.stringify(results, null, 2));
      appendFileSync(
        logPath,
        `${new Date().toISOString()} ${entry.ok ? "OK" : "FAIL"} #${entry.accountNum ?? "?"} attempt=${entry.attemptId} ${entry.email || entry.error || ""}\n`
      );
    });

  async function acquireJob(workerId) {
    for (let wait = 0; wait < 120; wait++) {
      let job = null;
      await withLock(() => {
        if (successCount >= total) return;
        const targetNum = successCount + inFlight.size + 1;
        if (targetNum > total) return;
        attemptSeq += 1;
        inFlight.add(targetNum);
        job = { attemptId: attemptSeq, targetNum };
      });
      if (job) return job;
      await sleep(1500);
    }
    return null;
  }

  async function runOneAccount(workerId) {
    const job = await acquireJob(workerId);
    if (!job) return false;

    const { attemptId, targetNum } = job;
    const tag = `[W${workerId} · #${targetNum}]`;
    const log = (msg) => console.log(`${tag} ${msg}`);

    let browser;
    let context;
    let page;

    try {
      log(`A obter email (tentativa ${attemptId})…`);
      let mailbox = await takeMailbox(workerId, targetNum);

      ({ browser, context, page } = await launchBrowser(targetNum));

      const agent = {
        nome: `${AGENT.nome}${targetNum}`,
        nickname: `${AGENT.nickname || AGENT.nome}${targetNum}`,
        persona: AGENT.persona,
      };

      let creds;
      let lastErr;
      for (let round = 1; round <= 5; round++) {
        try {
          if (round > 1) {
            log(`Retry ${round}/5 — reservar email novo…`);
            mailbox = await takeMailbox(workerId, `${targetNum}r${round}`);
            await openRegisterPage(page).catch(async () => {
              await browser.close().catch(() => {});
              ({ browser, context, page } = await launchBrowser(targetNum));
            });
          }
          creds = await runOnboard({ page, context, slot: targetNum, agent, mailbox });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          log(`     Falha round ${round}: ${err.message || err}`);
          if (/EMAIL_ALREADY_REGISTERED|already registered/i.test(String(err.message))) {
            continue;
          }
          await sleep(1500);
        }
      }
      if (lastErr) throw lastErr;

      let doneCount;
      await withLock(() => {
        successCount += 1;
        doneCount = successCount;
      });

      await persist({
        ok: true,
        accountNum: targetNum,
        attemptId,
        workerId,
        email: creds.email,
        creds,
        finishedAt: new Date().toISOString(),
      });

      log(`✅ Concluído — ${doneCount}/${total} contas OK`);
      return true;
    } catch (err) {
      log(`❌ Falhou: ${err.message || err}`);
      await persist({
        ok: false,
        accountNum: targetNum,
        attemptId,
        workerId,
        error: String(err.message || err),
        finishedAt: new Date().toISOString(),
      });
      return true;
    } finally {
      await withLock(() => inFlight.delete(targetNum));
      if (context) await saveSession(context, null, targetNum).catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }

  async function workerLoop(workerId) {
    await sleep((workerId - 1) * PARALLEL_STAGGER_MS);
    while (true) {
      const again = await runOneAccount(workerId);
      if (!again) break;
      let done;
      await withLock(() => {
        done = successCount >= total;
      });
      if (done) break;
    }
  }

  await Promise.all(Array.from({ length: workers }, (_, i) => workerLoop(i + 1)));

  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${"─".repeat(52)}`);
  console.log(`Pool: ${ok}/${total} contas OK (${fail} falhas, ${results.length} tentativas)`);
  console.log(`Resumo: ${resultsPath}`);
  console.log(`Log:    ${logPath}`);

  if (ok < total) process.exitCode = 1;
}

const POOL_TOTAL = Number(process.env.ANVITA_POOL_TOTAL || 0);
const POOL_WORKERS = Math.max(1, Number(process.env.ANVITA_POOL_WORKERS || 2));
const entry = (process.argv[1] || "").replace(/\\/g, "/");
const shouldRun =
  entry.endsWith("anvita-auto-onboard.mjs") ||
  entry.endsWith("run-anvita-auto-batch.mjs") ||
  entry.endsWith("run-anvita-auto-pool.mjs");

if (shouldRun) {
  if (process.env.ANVITA_AGENT_ONLY === "1") {
    agentOnlyMain();
  } else if (process.env.ANVITA_POOL === "1" && POOL_TOTAL > 0) {
    poolMain(POOL_TOTAL, POOL_WORKERS);
  } else if (BATCH > 1) {
    if (process.env.ANVITA_SEQUENTIAL === "1") {
      sequentialBatchMain(BATCH);
    } else {
      batchMain(BATCH);
    }
  } else {
    main();
  }
}
