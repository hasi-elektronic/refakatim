const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '';

type Kind = 'contact' | 'apply';
type Turnstile = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile; __tsReady?: () => void } }

const MSG = {
  required: 'Bu alan zorunludur.',
  email: 'Geçerli bir e-posta adresi girin.',
  phone: 'Geçerli bir telefon numarası girin.',
  consent: 'Devam etmek için onay vermelisiniz.',
  range: 'Geçerli bir değer girin.',
};

function setErr(input: HTMLElement, msg: string | null) {
  const field = input.closest('.field, .check') as HTMLElement | null;
  if (!field) return;
  field.classList.toggle('is-invalid', !!msg);
  field.querySelector('.field__err')?.remove();
  (input as HTMLInputElement).setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (msg) {
    const e = document.createElement('span');
    e.className = 'field__err';
    e.textContent = msg;
    if (field.classList.contains('check')) field.querySelector('span')!.after(e);
    else field.append(e);
  }
}

function validate(form: HTMLFormElement): boolean {
  let firstBad: HTMLElement | null = null;
  const els = Array.from(form.elements) as HTMLInputElement[];
  const seenRadio = new Set<string>();
  for (const el of els) {
    if (!el.name || el.type === 'hidden') continue;
    let msg: string | null = null;
    const v = (el.value ?? '').trim();
    if (el.type === 'radio') {
      if (seenRadio.has(el.name)) continue;
      seenRadio.add(el.name);
      const group = form.querySelectorAll<HTMLInputElement>(`input[name="${el.name}"]`);
      const req = Array.from(group).some((r) => r.required);
      if (req && !Array.from(group).some((r) => r.checked)) msg = MSG.required;
      const fs = el.closest('fieldset') as HTMLElement;
      fs.classList.toggle('is-invalid', !!msg);
      fs.querySelector('.field__err')?.remove();
      if (msg) { const s = document.createElement('span'); s.className = 'field__err'; s.textContent = msg; fs.append(s); }
      if (msg && !firstBad) firstBad = el;
      continue;
    }
    if (el.type === 'checkbox') msg = el.required && !el.checked ? MSG.consent : null;
    else if (el.required && !v) msg = MSG.required;
    else if (v && el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = MSG.email;
    else if (v && el.type === 'tel' && !/^[+()\d\s/-]{6,30}$/.test(v)) msg = MSG.phone;
    else if (v && el.type === 'number') {
      const n = Number(v), min = Number(el.min), max = Number(el.max);
      if (!Number.isFinite(n) || (el.min && n < min) || (el.max && n > max)) msg = MSG.range;
    }
    setErr(el, msg);
    if (msg && !firstBad) firstBad = el;
  }
  firstBad?.focus();
  return !firstBad;
}

function loadTurnstile(): Promise<Turnstile | null> {
  if (!SITE_KEY) return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((res) => {
    window.__tsReady = () => res(window.turnstile ?? null);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__tsReady';
    s.async = true;
    s.onerror = () => res(null);
    document.head.append(s);
  });
}

export function initForms() {
  // tabs
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  const select = (id: string, focus = false) => {
    tabs.forEach((t) => {
      const on = t.dataset.tab === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.dataset.tab!)!;
      panel.hidden = !on;
      if (on && focus) t.focus();
    });
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t.dataset.tab!));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      select(n.dataset.tab!, true);
    });
  });
  // deep links (#talep / #basvuru) switch the tab
  const syncHash = () => { const h = location.hash.slice(1); if (h === 'talep' || h === 'basvuru') select(h); };
  window.addEventListener('hashchange', syncHash);
  document.querySelectorAll<HTMLAnchorElement>('a[href="#talep"], a[href="#basvuru"]').forEach((a) =>
    a.addEventListener('click', () => select(a.getAttribute('href')!.slice(1))));
  syncHash();

  const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form[data-form]'));
  const widgets = new Map<HTMLFormElement, string>();

  // Load Turnstile only when the form section approaches the viewport
  const section = document.getElementById('formlar');
  if (section && SITE_KEY) {
    const io = new IntersectionObserver(async ([en]) => {
      if (!en.isIntersecting) return;
      io.disconnect();
      const ts = await loadTurnstile();
      if (!ts) return;
      forms.forEach((f) => {
        const slot = f.querySelector<HTMLElement>('[data-turnstile]');
        if (slot) widgets.set(f, ts.render(slot, { sitekey: SITE_KEY, language: 'tr', theme: 'auto', size: 'flexible' }));
      });
    }, { rootMargin: '400px' });
    io.observe(section);
  }
  if (!API || !SITE_KEY) {
    forms.forEach((f) => {
      const warn = document.createElement('p');
      warn.className = 'form__dev';
      warn.textContent = 'Form şu anda test modunda — gönderim henüz etkin değil.';
      f.querySelector('.form__foot')?.before(warn);
    });
  }

  forms.forEach((form) => {
    form.addEventListener('input', (e) => {
      const el = e.target as HTMLElement;
      if (el.closest('.is-invalid')) setErr(el, null);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = form.querySelector<HTMLElement>('.form__status')!;
      const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
      status.className = 'form__status';
      status.textContent = '';
      if (!validate(form)) return;
      if (!API || !SITE_KEY) {
        status.classList.add('is-err');
        status.textContent = 'Gönderim henüz etkin değil. Lütfen daha sonra tekrar deneyin.';
        return;
      }
      const fd = new FormData(form);
      const token = String(fd.get('cf-turnstile-response') ?? '');
      if (!token) {
        status.classList.add('is-err');
        status.textContent = 'Lütfen güvenlik doğrulamasının tamamlanmasını bekleyin.';
        return;
      }
      const kind = form.dataset.form as Kind;
      const payload: Record<string, string | boolean> = {};
      fd.forEach((v, k) => { if (k !== 'cf-turnstile-response') payload[k] = String(v).trim(); });
      payload.consent = fd.get('consent') === 'on';

      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = 'Gönderiliyor…';
      try {
        const r = await fetch(`${API}/api/${kind}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, token }),
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; errors?: Record<string, string>; error?: string };
        if (r.ok && j.ok) {
          form.classList.add('is-done');
          status.classList.add('is-ok');
          status.textContent = kind === 'contact'
            ? 'Teşekkürler, talebiniz alındı. 24 saat içinde size dönüş yapacağız.'
            : 'Teşekkürler, başvurunuz alındı. Bilgileriniz incelendikten sonra sizinle iletişime geçeceğiz.';
          status.focus?.();
          return;
        }
        if (r.status === 400 && j.errors) {
          Object.entries(j.errors).forEach(([name, msg]) => {
            const el = form.querySelector<HTMLElement>(`[name="${name}"]`);
            if (el) setErr(el, msg);
          });
        }
        status.classList.add('is-err');
        status.textContent = r.status === 429
          ? 'Çok fazla deneme yapıldı. Lütfen 10 dakika sonra tekrar deneyin.'
          : 'Gönderilemedi. Lütfen bilgileri kontrol edip tekrar deneyin.';
      } catch {
        status.classList.add('is-err');
        status.textContent = 'Bağlantı hatası. Lütfen tekrar deneyin.';
      } finally {
        btn.disabled = false;
        btn.textContent = label;
        const id = widgets.get(form);
        if (id && !form.classList.contains('is-done')) window.turnstile?.reset(id);
      }
    });
  });
}
