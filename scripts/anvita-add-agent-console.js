/**
 * Cola na consola (F12) em flow.anvita.xyz — wizard + @prospilot.
 * Depois de Generate Soul vai directo ao chat (sem carteira).
 */
(async () => {
  const AGENT = { nome: "MeuAgentePro", nickname: "MeuAgentePro", persona: "The Sage" };
  const CMD = "What is Faroo?";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const setVal = (el, v) => {
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, v);
    else el.value = v;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const clickText = (...parts) => {
    const btn = [...document.querySelectorAll("button,a,[role=button]")].find((b) => {
      if (b.disabled) return false;
      const t = ((b.textContent || "") + " " + (b.getAttribute("aria-label") || "")).toLowerCase();
      return parts.some((p) => t.includes(p.toLowerCase()));
    });
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  };

  const findChat = () => {
    const chat = document.querySelector("textarea,[contenteditable=true],[role=textbox]");
    return chat?.offsetParent ? chat : null;
  };

  const sendProspilot = async () => {
    for (let i = 0; i < 30; i++) {
      const chat = findChat();
      if (chat) {
        console.log("[anvita] @prospilot…");
        setVal(chat, `@prospilot ${CMD}`);
        await sleep(400);
        clickText("send") || chat.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        console.log("[anvita] ✅ Enviado.");
        return true;
      }
      await sleep(1000);
    }
    return false;
  };

  const addBtn = [...document.querySelectorAll("button")].find((b) => /^Add Agent$/i.test(b.textContent.trim()));
  if (addBtn) {
    console.log("[anvita] Add Agent…");
    addBtn.click();
    await sleep(2500);
  }

  for (let step = 0; step < 10; step++) {
    const body = document.body.innerText;

    if (/Establish Identity|get to know each other/i.test(body)) {
      console.log("[anvita] Identity…");
      const inputs = [...document.querySelectorAll("input:not([type=password]):not([type=checkbox])")].filter(
        (el) => el.offsetParent
      );
      if (inputs[0]) setVal(inputs[0], AGENT.nome);
      if (inputs[1]) setVal(inputs[1], AGENT.nickname);
      await sleep(400);
      clickText("continue");
      await sleep(2000);
      continue;
    }

    if (/Shape Personality|Core Archetype/i.test(body)) {
      console.log("[anvita] Persona:", AGENT.persona);
      const card = [...document.querySelectorAll("button,div,h3,h4,p")].find(
        (el) => (el.textContent || "").trim() === AGENT.persona && el.offsetParent
      );
      (card?.closest("button,[role=button]") || card)?.click();
      await sleep(600);
      clickText("continue");
      await sleep(2000);
      continue;
    }

    if (/Set Boundaries|Almost there|Generate Soul/i.test(body)) {
      console.log("[anvita] Generate Soul…");
      clickText("generate soul");
      await sleep(3000);
      if (!location.pathname.includes("/agent/chat")) {
        location.href = "https://flow.anvita.xyz/agent/chat";
        return;
      }
      if (await sendProspilot()) return;
      continue;
    }

    if (location.pathname.includes("/agent/chat")) {
      if (await sendProspilot()) return;
    }

    await sleep(1500);
  }

  console.warn("[anvita] Se estiveres no chat, corre só: location.href='https://flow.anvita.xyz/agent/chat'");
})();
