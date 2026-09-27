#!/usr/bin/env bash
# Refakatim — tek komutla kurulum + deploy
# Gerekli env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GH_TOKEN
# Token yetkileri (Cloudflare): Account → Cloudflare Pages:Edit, Workers Scripts:Edit, D1:Edit,
#   Workers KV Storage:Edit, Turnstile:Edit, Email Routing Addresses:Read · Zone → Zone:Read, Email Routing Rules:Read
set -euo pipefail
cd "$(dirname "$0")"

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN eksik}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID eksik}"
: "${GH_TOKEN:?GH_TOKEN eksik}"
ACC="$CLOUDFLARE_ACCOUNT_ID"
API="https://api.cloudflare.com/client/v4"
GH_ORG="hasi-elektronic"
SLUG="refakatim"
ZONE_NAME="hasi-elektronic.de"
MAIL_TO="info@hasi-elektronic.de"

cf() { curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }
js() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const v=($1);process.stdout.write(v==null?'':String(v))})"; }
step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }

step "Token kontrolü"
cf "$API/accounts/$ACC/tokens/verify" | js 'j.success' | grep -q true || { echo "Token geçersiz"; exit 1; }

step "Email Routing kontrolü ($ZONE_NAME)"
ZONE_ID=$(cf "$API/zones?name=$ZONE_NAME" | js 'j.result[0]?.id')
ER=$(cf "$API/zones/$ZONE_ID/email/routing" | js 'j.result?.enabled' || true)
[ "$ER" = "true" ] && echo "Email Routing açık" || warn "Email Routing KAPALI → Dashboard > $ZONE_NAME > Email > Email Routing > Enable. Formlar yine D1'e kaydeder."
VER=$(cf "$API/accounts/$ACC/email/routing/addresses" | js "j.result.find(a=>a.email==='$MAIL_TO')?.verified" || true)
[ -n "$VER" ] && echo "$MAIL_TO doğrulanmış" || warn "$MAIL_TO Email Routing'de doğrulanmış hedef değil → Destination addresses > Add + mail'deki linke tıkla."

step "D1 veritabanı"
D1_ID=$(cf "$API/accounts/$ACC/d1/database?name=$SLUG" | js "j.result.find(d=>d.name==='$SLUG')?.uuid")
if [ -z "$D1_ID" ]; then D1_ID=$(cf -X POST "$API/accounts/$ACC/d1/database" -d "{\"name\":\"$SLUG\"}" | js 'j.result.uuid'); fi
echo "D1: $D1_ID"

step "KV namespace (rate limit)"
KV_ID=$(cf "$API/accounts/$ACC/storage/kv/namespaces?per_page=100" | js "j.result.find(n=>n.title==='$SLUG-rate')?.id")
if [ -z "$KV_ID" ]; then KV_ID=$(cf -X POST "$API/accounts/$ACC/storage/kv/namespaces" -d "{\"title\":\"$SLUG-rate\"}" | js 'j.result.id'); fi
echo "KV: $KV_ID"

step "Turnstile widget"
TS_JSON=$(cf "$API/accounts/$ACC/challenges/widgets?per_page=100")
SITE_KEY=$(echo "$TS_JSON" | js "j.result.find(w=>w.name==='$SLUG')?.sitekey")
TS_SECRET=""
if [ -z "$SITE_KEY" ]; then
  NEW=$(cf -X POST "$API/accounts/$ACC/challenges/widgets" -d "{\"name\":\"$SLUG\",\"domains\":[\"$SLUG.pages.dev\",\"localhost\"],\"mode\":\"managed\"}")
  SITE_KEY=$(echo "$NEW" | js 'j.result.sitekey'); TS_SECRET=$(echo "$NEW" | js 'j.result.secret')
else
  TS_SECRET=$(cf "$API/accounts/$ACC/challenges/widgets/$SITE_KEY" | js 'j.result.secret')
fi
echo "Turnstile site key: $SITE_KEY"

step "Worker yapılandırması"
cd worker
sed -i.bak -e "s/^database_id = .*/database_id = \"$D1_ID\"/" -e "s/^id = \"REPLACE_WITH_KV_ID\"/id = \"$KV_ID\"/" wrangler.toml && rm -f wrangler.toml.bak
npm i --silent
npx wrangler d1 execute "$SLUG" --remote --file=schema.sql -y
npx wrangler deploy
printf '%s' "$TS_SECRET" | npx wrangler secret put TURNSTILE_SECRET
node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))" | npx wrangler secret put IP_SALT
SUB=$(cf "$API/accounts/$ACC/workers/subdomain" | js 'j.result.subdomain')
API_URL="https://$SLUG-api.$SUB.workers.dev"
cd ..
echo "API: $API_URL"
curl -fsS "$API_URL/health" && echo

step "Site build"
npm i --silent
VITE_API_URL="$API_URL" VITE_TURNSTILE_SITE_KEY="$SITE_KEY" npm run build

step "Cloudflare Pages"
if ! cf "$API/accounts/$ACC/pages/projects/$SLUG" >/dev/null 2>&1; then
  cf -X POST "$API/accounts/$ACC/pages/projects" -d "{\"name\":\"$SLUG\",\"production_branch\":\"main\"}" >/dev/null
fi
npx --yes wrangler@4 pages deploy dist --project-name="$SLUG" --branch=main --commit-dirty=true

step "GitHub"
if ! curl -fsS -H "Authorization: token $GH_TOKEN" "https://api.github.com/repos/$GH_ORG/$SLUG" >/dev/null 2>&1; then
  curl -fsS -H "Authorization: token $GH_TOKEN" "https://api.github.com/orgs/$GH_ORG/repos" \
    -d "{\"name\":\"$SLUG\",\"private\":false,\"description\":\"Refakatim — Uzman Refakatçi Programı\"}" >/dev/null \
  || curl -fsS -H "Authorization: token $GH_TOKEN" "https://api.github.com/user/repos" -d "{\"name\":\"$SLUG\",\"private\":false}" >/dev/null
fi
[ -d .git ] || git init -q -b main
git add -A
git -c user.name="Hasi Elektronic" -c user.email="info@hasi-elektronic.de" commit -qm "deploy: $(date -u +%Y-%m-%dT%H:%MZ)" || true
git push -q "https://x-access-token:$GH_TOKEN@github.com/$GH_ORG/$SLUG.git" main

step "Doğrulama"
sleep 5
printf 'Site: '; curl -s -o /dev/null -w "%{http_code}\n" "https://$SLUG.pages.dev/"
printf 'Impressum: '; curl -s -o /dev/null -w "%{http_code}\n" "https://$SLUG.pages.dev/impressum.html"
curl -s "https://$SLUG.pages.dev/" | grep -c 'og:image' | sed 's/^/OG tags: /'

cat <<EOF

✅ Refakatim canlıda
🌐 https://$SLUG.pages.dev
📧 API: $API_URL
📁 https://github.com/$GH_ORG/$SLUG
EOF
