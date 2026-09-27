# Refakatim — Uzman Refakatçi Programı

Tek sayfalık Türkçe tanıtım sitesi + form API'si. Bir Hasi Elektronic projesi.

- **Site:** Vite 5 + vanilla TypeScript + three.js (hafif 3D hero, lazy-load) → Cloudflare Pages `refakatim`
- **API:** Cloudflare Worker `refakatim-api` (`worker/`) → Turnstile + D1 + KV rate-limit + Email Routing `send_email`

## Lokal geliştirme
```bash
npm i && npm run dev                 # site: http://localhost:5173
cd worker && npm i
cp .dev.vars.example .dev.vars       # test anahtarları
npx wrangler d1 execute refakatim --local --file=schema.sql
npx wrangler dev                     # api: http://localhost:8787
```
Sitenin API'yi kullanması için `.env.local`:
```
VITE_API_URL=http://localhost:8787
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

## Ortam değişkenleri
| Nerede | Ad | Açıklama |
|---|---|---|
| Build (site) | `VITE_API_URL` | Worker URL'i |
| Build (site) | `VITE_TURNSTILE_SITE_KEY` | Turnstile site key |
| Worker secret | `TURNSTILE_SECRET` | Turnstile secret |
| Worker secret | `IP_SALT` | IP hash tuzu (rastgele) |
| Worker var | `ALLOWED_ORIGINS`, `MAIL_FROM`, `MAIL_TO` | `wrangler.toml` |

Deploy için shell'de: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. **Token'ları asla commit etme.**

## Deploy
```bash
# API
cd worker && npx wrangler deploy
# Site
cd .. && VITE_API_URL=https://refakatim-api.<subdomain>.workers.dev VITE_TURNSTILE_SITE_KEY=<key> npm run build
npx wrangler pages deploy dist --project-name=refakatim --branch=main --commit-dirty=true
```

## Başvurular nerede?
Her gönderim önce D1 `refakatim` → `submissions` tablosuna yazılır, sonra `info@hasi-elektronic.de`'ye mail gider.
Mail gelmezse kayıt yine D1'dedir:
```bash
cd worker && npx wrangler d1 execute refakatim --remote --command "SELECT created_at, kind, emailed, payload_json FROM submissions ORDER BY created_at DESC LIMIT 20"
```
12 aydan eski kayıtlar her gece (cron `17 3 * * *`) silinir.

## Turnstile anahtarını değiştirme
Dashboard → Turnstile → widget `refakatim` → yeni secret → `cd worker && npx wrangler secret put TURNSTILE_SECRET`.
Site key değişirse `VITE_TURNSTILE_SITE_KEY` ile yeniden build + deploy.

## Açık noktalar (müşteri)
- `index.html` içindeki istatistikler `TODO(client)` — doğrulanmalı.
- Impressum / Datenschutz şablondur — avukata gösterilmeli.
