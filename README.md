# Desk Ai

Private offline document Q&A — runs entirely in your browser with WebGPU + local SQLite storage.

## Development

```bash
npm install
npm run dev
```

## Build (PWA app)

```bash
npm run build
npm run preview
```

## Deploy on Netlify (two sites from one repo)

### Site 1 — App (PWA)

- **Base directory:** `.` (repo root)
- **Build command:** `npm run build`
- **Publish directory:** `dist`
- Uses [netlify.toml](./netlify.toml) — COOP/COEP headers come from [public/_headers](./public/_headers)

Set environment variables in Netlify:

| Variable | Example |
|---|---|
| `VITE_DODO_API_BASE` | `https://live.dodopayments.com` |
| `VITE_MARKETING_URL` | `https://desk-ai.com` |

### Site 2 — Marketing

- **Base directory:** `marketing`
- **Build command:** *(none)*
- **Publish directory:** `marketing`

Edit [marketing/config.js](./marketing/config.js):

- `checkoutUrl` — your Dodo Payments product checkout link
- `appUrl` — deployed PWA URL (e.g. `https://app.desk-ai.com`)

Set Dodo checkout success redirect to: `https://your-marketing-domain/thank-you`

## License flow

1. Customer buys on the marketing site → Dodo emails a license key
2. Customer opens the app → pastes key on the activation screen
3. App calls Dodo `POST /licenses/activate` once (public endpoint, no secret key)
4. Activation is stored locally — app works offline after that

Copy [.env.example](./.env.example) to `.env` for local development.

## Security

Full audit notes: [SECURITY.md](./SECURITY.md).

**Git history:** If any API key, password, or connection string was ever committed, rotate that credential immediately — deleting it from the current files is not enough.

Rules of thumb:

- Never put Dodo secret keys, Stripe secrets, or DB URLs in `VITE_*` variables (Vite ships them to the browser).
- Keep `.env` out of git (see `.gitignore`).
- User documents and chats never leave the device; only license activation talks to Dodo.

