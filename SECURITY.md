# Desk Ai — Security & privacy audit

Pre-deploy review of this repository (static PWA + static marketing site).  
**Architecture note:** There is **no application backend**. Payments and license issuance are handled by **Dodo Payments**. Chats and documents stay in the browser (OPFS SQLite).

---

## 1. Secrets inventory

| Item | Found? | Location | Status |
|------|--------|----------|--------|
| Stripe secret / publishable keys | No | — | N/A (Dodo hosts checkout) |
| Supabase anon / service role | No | — | N/A |
| MongoDB / Postgres URLs | No | — | N/A (client SQLite only) |
| OAuth / JWT signing secrets | No | — | N/A (no custom auth server) |
| OpenAI / SendGrid / Twilio / AWS keys | No | — | N/A |
| Dodo **secret** API key | No | — | Must stay in Dodo dashboard only |
| Dodo license activate/validate | Public endpoints | `src/utils/license.ts` | OK by design (no secret) |
| `VITE_DODO_API_BASE` | Public URL | env / `.env.example` | Safe to expose (Vite client) |
| `VITE_MARKETING_URL` / `VITE_APP_URL` | Public URLs | env | Safe |
| Marketing `checkoutUrl` | Public product link | `marketing/config.js` | Placeholder only — replace with your Dodo buy link |

### Fixes applied
- `.env` / `.env.*` added to [`.gitignore`](./.gitignore) (keeps `.env.example`)
- [`.env.example`](./.env.example) documents that **no secret** may use the `VITE_` prefix
- Production warn if build still points at `test.dodopayments.com`

### Git history warning

> If any secret was ever committed to this repo (or another clone), **rotate it immediately** in the provider dashboard. Removing it from the current tree is not enough — old commits may still contain it. This repo currently has **no hardcoded cloud API secrets** in `src/` or `marketing/`.

---

## 2. Personal data map

### What is collected

| Data | Where entered | Where stored | Sent externally? |
|------|---------------|--------------|------------------|
| License key | Activation screen | `localStorage` (`deskai-license-activation`) | Yes — once to Dodo `POST /licenses/activate` (and optionally validate) |
| Device label | Derived from UA (`Mac`, etc.) | localStorage with license | Yes — as `name` on activate |
| Chat messages | Composer | OPFS SQLite (`messages`) | **No** (local inference only) |
| Uploaded documents | Attach / drop | OPFS SQLite (`documents`, `chunks` + embeddings) | **No** |
| Theme preference | Light/Dark toggle | `localStorage` (`selfai-theme`) | No |
| Active thread id | App | `localStorage` (`vaultai_active_thread`) | No |
| Email / password / phone / DOB / address | — | — | **Not collected by Desk Ai** |
| Payment card data | Dodo hosted checkout | Dodo / card networks | Handled entirely by Dodo — never touches our JS |

### Third parties

| Service | Data sent | Purpose |
|---------|-----------|---------|
| Dodo Payments | License key + device name; checkout email handled by Dodo | License activate / purchase |
| Hugging Face / MLC CDN (via WebLLM & transformers.js) | Model weight downloads only — **not** user docs | Local AI + embeddings |
| Google Fonts (marketing + app CSS) | Browser font request (IP to Google) | Typography |

### Logs cleaned
- ErrorBoundary no longer shows raw exception text to users; console logs truncated, no license/docs
- `__VAULT_DB__` debug handle is **DEV-only**
- `redactLicenseKey()` helper available; never log full keys

### Password handling
- **N/A** — no passwords in this app

### Cookies / storage
- No auth cookies
- License key in **localStorage** (XSS-accessible). Mitigations: no `dangerouslySetInnerHTML` for user HTML; Markdown via `react-markdown` (escaped); activation rate limit; Dodo activation caps
- Prefer browser “Clear site data” for full wipe; Menu → **Erase local data…** / **Deactivate license**

### Data deletion
- Clear / Delete chat, Export backup
- Menu → **Deactivate license**
- Menu → **Erase local data…** (+ browser clear site data for OPFS/IndexedDB)

---

## 3. Production readiness checklist

| Check | Result | Notes |
|-------|--------|-------|
| Env vars documented | Pass | `.env.example` |
| Critical server secrets required at boot | N/A | No Node server |
| Debug endpoints (`/test`, `/admin-backdoor`) | Pass | None |
| Client errors hide internals | Pass (fixed) | Generic ErrorBoundary copy |
| Security headers | Pass (fixed) | `public/_headers`, `marketing/_headers` |
| Rate limit login | Partial | Client activate ≤5/min; Dodo server-side also applies |
| CORS `*` | N/A | Static sites |
| DB TLS / open ports | N/A | Browser OPFS only |

---

## 4. Auth / payment threat model

| Issue | Risk | Mitigation |
|-------|------|------------|
| Client-side license gate | Determined user can patch JS / forge localStorage | Expected for offline-first; Dodo **activation limits** stop casual key sharing |
| Price shown on marketing page | User can ignore price; real charge is Dodo checkout | Never trust `config.js` `priceUsd` for charging |
| No webhook → app unlock | Unlock is license key entry, not a URL flag | Do not add “paid=1” query unlocks |
| IDOR on threads/docs | Local DB only; no multi-tenant server | N/A |
| SQL injection | App SQL uses bound parameters for user data | Keep using `bind:` — do not concatenate user text into SQL |
| XSS via chat Markdown | Low if sticking to react-markdown defaults | Do not enable raw HTML plugins |
| Mass activation guessing | Rate limit + Dodo | Client limiter added |

---

## 5. Attacker paths (summary)

1. **Steal another user’s chats via URL ID** — Not applicable (no shared server store).
2. **Use app without paying** — Possible by reverse-engineering the PWA (offline gate). Reduce via Dodo activation limits + monitoring; not cryptographically preventable without a server.
3. **Privilege escalation / admin** — No roles.
4. **Spam / fill storage** — User only fills their own browser; no shared quota.
5. **XSS → steal license from localStorage** — Keep dependencies updated; avoid HTML injection; CSP on marketing; app CSP limited by WebGPU/WASM needs.
6. **`.env` / `.git` exposure** — Static Netlify deploy of `dist` / `marketing` only; do not publish repo secrets.
7. **Negative payment / free trial abuse** — Controlled by Dodo product config, not this codebase.

---

## Deploy reminders

1. Set Netlify env: `VITE_DODO_API_BASE=https://live.dodopayments.com`
2. Put real checkout URL in `marketing/config.js` (public buy link only)
3. Enable license keys + activation limit (e.g. 2–3) in Dodo
4. Never put Dodo secret API keys in `VITE_*` or client bundles
