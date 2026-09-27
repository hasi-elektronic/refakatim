import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/sections.css';
import { initForms } from './forms';
import { detectRenderTier } from './three/tier';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* header state + mobile nav */
function initHeader() {
  const header = document.querySelector<HTMLElement>('[data-header]');
  const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  if (!header || !toggle || !nav) return;
  const onScroll = () => header.classList.toggle('is-solid', window.scrollY > 40 || nav.classList.contains('is-open'));
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const setOpen = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
    onScroll();
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

/* one observer for reveal + sequenced blocks */
function initReveal() {
  const targets = document.querySelectorAll<HTMLElement>('.reveal, [data-flow], [data-handover], [data-log], .stats');
  document.querySelectorAll<HTMLElement>('[data-flow] .flow__step, [data-handover] .handover__node')
    .forEach((el) => el.style.setProperty('--s', String(Array.from(el.parentElement!.children).indexOf(el))));
  if (reduced || !('IntersectionObserver' in window)) {
    targets.forEach((el) => onEnter(el, true));
    return;
  }
  const pending = new Set<HTMLElement>(targets);
  const reveal = (el: HTMLElement, instant: boolean) => {
    if (!pending.has(el)) return;
    pending.delete(el);
    io.unobserve(el);
    onEnter(el, instant);
  };
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      // reveal on entry, and also anything already scrolled past (deep links, restored scroll)
      const above = en.boundingClientRect.bottom < 0;
      if (en.isIntersecting || above) reveal(en.target as HTMLElement, above);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
  targets.forEach((el) => io.observe(el));
  // safety net for very fast flings where IO can skip an element
  let tmr = 0;
  window.addEventListener('scroll', () => {
    if (tmr || !pending.size) return;
    tmr = window.setTimeout(() => {
      tmr = 0;
      const vh = window.innerHeight;
      pending.forEach((el) => { const r = el.getBoundingClientRect(); if (r.top < vh * 0.92) reveal(el, r.bottom < 0); });
    }, 200);
  }, { passive: true });
}

function onEnter(el: HTMLElement, instant: boolean) {
  el.classList.add('is-in');
  if (el.matches('[data-log]')) typeLog(el, instant);
  if (el.matches('.stats')) countUp(el, instant);
}

/* typewriter log */
function typeLog(root: HTMLElement, instant: boolean) {
  const items = Array.from(root.querySelectorAll<HTMLLIElement>('.log__list li'));
  if (instant) { items.forEach((li) => li.classList.add('is-shown')); return; }
  const texts = items.map((li) => li.querySelector('span')!.textContent ?? '');
  items.forEach((li) => { li.querySelector('span')!.textContent = ''; });
  let i = 0;
  const next = () => {
    if (i >= items.length) return;
    const li = items[i];
    const span = li.querySelector('span')!;
    const full = texts[i];
    li.classList.add('is-shown');
    span.classList.add('typing');
    let c = 0;
    const tick = () => {
      c += 2;
      span.textContent = full.slice(0, c);
      if (c < full.length) setTimeout(tick, 22);
      else { span.classList.remove('typing'); i++; setTimeout(next, 320); }
    };
    tick();
  };
  next();
}

/* counters */
function countUp(root: HTMLElement, instant: boolean) {
  root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    if (instant || target === 0) { el.textContent = String(target); return; }
    const t0 = performance.now();
    const dur = 1300;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* FAQ: keep one open at a time */
function initFaq() {
  const all = document.querySelectorAll<HTMLDetailsElement>('[data-faq] details');
  all.forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) all.forEach((o) => { if (o !== d) o.open = false; });
  }));
}

/* lazy 3D hero */
function initHero() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-hero-canvas]');
  const hero = document.querySelector<HTMLElement>('.hero');
  if (!canvas || !hero) return;
  if (detectRenderTier() !== 'high') return; // SVG fallback stays
  const start = () => import('./three/pulse').then((m) => m.mountPulse(canvas, hero)).catch(() => { /* keep fallback */ });
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (document.readyState === 'complete') ric ? ric(start, { timeout: 1500 }) : setTimeout(start, 600);
  else window.addEventListener('load', () => (ric ? ric(start, { timeout: 1500 }) : setTimeout(start, 600)), { once: true });
}

initHeader();
initReveal();
initFaq();
initForms();
initHero();
