import { validate, type Kind } from './validate';
import { buildRaw, sendMail } from './email';

export interface Env {
  DB: D1Database;
  RATE: KVNamespace;
  MAILER: SendEmail;
  TURNSTILE_SECRET?: string;
  IP_SALT: string;
  ALLOWED_ORIGINS: string;   // comma separated
  MAIL_FROM: string;
  MAIL_TO: string;
}

const RATE_LIMIT = 5;
const RATE_WINDOW_S = 600;

function cors(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const ok = origin && allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin! : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (status: number, body: unknown, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...h } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyTurnstile(token: string, ip: string, secret: string) {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const j = (await r.json()) as { success: boolean };
  return j.success === true;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const h = cors(origin, env);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (url.pathname === '/health' || url.pathname === '/api/health') return json(200, { ok: true }, h);

    const kind = ({ '/api/contact': 'contact', '/api/apply': 'apply' } as Record<string, Kind>)[url.pathname];
    if (!kind) return json(404, { ok: false, error: 'not_found' }, h);
    if (req.method !== 'POST') return json(405, { ok: false, error: 'method' }, h);
    if (!origin || !env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(origin)) {
      return json(403, { ok: false, error: 'origin' }, h);
    }
    if (Number(req.headers.get('content-length') ?? 0) > 16_000) return json(413, { ok: false, error: 'too_large' }, h);

    const ip = req.headers.get('CF-Connecting-IP') ?? '';
    const ipHash = (await sha256(`${env.IP_SALT}:${ip}`)).slice(0, 32);

    // rate limit: 5 requests / 10 min / IP
    const rlKey = `rl:${ipHash}`;
    const count = Number((await env.RATE.get(rlKey)) ?? 0);
    if (count >= RATE_LIMIT) return json(429, { ok: false, error: 'rate_limited' }, { ...h, 'Retry-After': String(RATE_WINDOW_S) });
    ctx.waitUntil(env.RATE.put(rlKey, String(count + 1), { expirationTtl: RATE_WINDOW_S }));

    let body: Record<string, unknown>;
    try { body = (await req.json()) as Record<string, unknown>; } catch { return json(400, { ok: false, error: 'bad_json' }, h); }

    // bot protection: honeypot + human fill time always; Turnstile when configured
    const hp = typeof body.website === 'string' ? body.website.trim() : '';
    const elapsed = Date.now() - Number(body.t ?? 0);
    if (hp || !Number.isFinite(elapsed) || elapsed < 3000 || elapsed > 86_400_000) {
      return json(403, { ok: false, error: 'bot' }, h);
    }
    if (env.TURNSTILE_SECRET) {
      const token = typeof body.token === 'string' ? body.token : '';
      if (!token || !(await verifyTurnstile(token, ip, env.TURNSTILE_SECRET))) {
        return json(403, { ok: false, error: 'captcha' }, h);
      }
    }

    const v = validate(kind, body);
    if (!v.ok) return json(400, { ok: false, errors: v.errors }, h);

    const id = crypto.randomUUID();
    const phoneKey = String(v.data.phone).replace(/\D/g, '');
    const dup = await env.DB.prepare(
      "SELECT 1 FROM submissions WHERE phone = ?1 AND kind = ?2 AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes') LIMIT 1",
    ).bind(phoneKey, kind).first();
    const duplicate = !!dup;

    // 1) never lose a submission: store first
    await env.DB.prepare(
      'INSERT INTO submissions (id, kind, payload_json, phone, ip_hash, duplicate) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    ).bind(id, kind, JSON.stringify(v.data), phoneKey, ipHash, duplicate ? 1 : 0).run();

    // 2) then notify
    let emailed = false;
    try {
      const raw = buildRaw({ from: env.MAIL_FROM, to: env.MAIL_TO, kind, data: v.data, id, duplicate });
      await sendMail(env.MAILER, env.MAIL_FROM, env.MAIL_TO, raw);
      emailed = true;
      ctx.waitUntil(env.DB.prepare('UPDATE submissions SET emailed = 1 WHERE id = ?1').bind(id).run());
    } catch (err) {
      console.error('send_email failed', (err as Error).message);
    }

    return json(200, { ok: true, id, emailed }, h);
  },

  // daily cleanup: delete submissions older than 12 months (DSGVO retention promise)
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    await env.DB.prepare("DELETE FROM submissions WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-12 months')").run();
  },
};
