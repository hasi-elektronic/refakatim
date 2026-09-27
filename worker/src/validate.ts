export type Kind = 'contact' | 'apply';
export type Clean = Record<string, string | number | boolean>;
type Result = { ok: true; data: Clean } | { ok: false; errors: Record<string, string> };

const T = {
  req: 'Bu alan zorunludur.',
  email: 'Geçerli bir e-posta adresi girin.',
  phone: 'Geçerli bir telefon numarası girin.',
  len: 'Metin çok uzun.',
  choice: 'Geçersiz seçim.',
  num: 'Geçerli bir değer girin.',
  date: 'Geçerli bir tarih girin.',
  consent: 'Onay gereklidir.',
};

const str = (v: unknown) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '');

export function validate(kind: Kind, body: Record<string, unknown>): Result {
  const e: Record<string, string> = {};
  const d: Clean = {};
  const text = (k: string, max: number, required = false) => {
    const v = str(body[k]);
    if (!v) { if (required) e[k] = T.req; return; }
    if (v.length > max) { e[k] = T.len; return; }
    d[k] = v;
  };
  const email = (required: boolean) => {
    const v = str(body.email);
    if (!v) { if (required) e.email = T.req; return; }
    if (v.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { e.email = T.email; return; }
    d.email = v.toLowerCase();
  };
  const choice = (k: string, opts: string[], required = false) => {
    const v = str(body[k]);
    if (!v) { if (required) e[k] = T.req; return; }
    if (!opts.includes(v)) { e[k] = T.choice; return; }
    d[k] = v;
  };
  const num = (k: string, min: number, max: number, required = false) => {
    const raw = str(body[k]);
    if (!raw) { if (required) e[k] = T.req; return; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) { e[k] = T.num; return; }
    d[k] = n;
  };

  text('name', 80, true);
  const phone = str(body.phone);
  if (!phone) e.phone = T.req;
  else if (!/^[+()\d\s/-]{6,30}$/.test(phone) || phone.replace(/\D/g, '').length < 6) e.phone = T.phone;
  else d.phone = phone;
  if (body.consent !== true) e.consent = T.consent;
  text('message', 600);

  if (kind === 'contact') {
    email(false);
    choice('relation', ['Çocuğu', 'Eşi', 'Kardeşi', 'Torunu', 'Diğer']);
    choice('place', ['hastane', 'ev'], true);
    const start = str(body.start);
    if (start) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start))) e.start = T.date;
      else d.start = start;
    }
    num('days', 1, 365);
  } else {
    email(true);
    choice('profession', ['Emekli hemşire', 'Emekli doktor', 'Sağlık personeli', 'Hasta bakım personeli', 'Diğer'], true);
    num('years', 0, 60, true);
    text('city', 60, true);
    text('documents', 200);
    choice('availability', ['Hafta içi', 'Hafta sonu', 'Gece', 'Esnek']);
  }
  d.consent = true;
  return Object.keys(e).length ? { ok: false, errors: e } : { ok: true, data: d };
}
