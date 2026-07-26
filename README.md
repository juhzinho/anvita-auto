# anvita-auto

Automação Playwright para onboarding em [flow.anvita.xyz](https://flow.anvita.xyz): email descartável, OTP, wizard BYOA e mensagem `@prospilot`.

## VPS Windows

```powershell
git clone https://github.com/juhzinho/anvita-auto.git
cd anvita-auto
npm install
node scripts/run-anvita-vps.mjs 2 1 edge
npm run anvita:vps
```

## Variáveis

| Env | Default | Descrição |
|-----|---------|-----------|
| `ANVITA_BROWSER` | `edge` (VPS) / `brave` (PC) | `edge`, `chrome`, `chromium`, `firefox`, `brave` |
| `ANVITA_HEADED` | `0` no VPS | `1` para browser visível |
| `ANVITA_POOL_TOTAL` | `500` no VPS | Meta de contas |
| `ANVITA_POOL_WORKERS` | `2` no VPS | Workers paralelos |
| `ANVITA_POOL_RETRIES` | `8` | Tentativas por conta no pool |
| `ANVITA_BROWSER_RESTART_EVERY` | `12` | Reinicia browser a cada N contas |
| `ANVITA_STUCK_MS` | `90000` | Reenvia @prospilot se parado 90s |

Credenciais em `.anvita-auto/` (local, não commitar).
