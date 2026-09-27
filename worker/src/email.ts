import { EmailMessage } from 'cloudflare:email';
import type { Clean, Kind } from './validate';

const LABELS: Record<string, string> = {
  name: 'Ad soyad', phone: 'Telefon', email: 'E-posta', relation: 'Yakınlık', place: 'Bakım yeri',
  start: 'Başlangıç', days: 'Süre (gün)', message: 'Mesaj / Not', profession: 'Meslek', years: 'Deneyim (yıl)',
  city: 'Şehir', documents: 'Belgeler', availability: 'Müsaitlik',
};

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
};
/** RFC 2047 encoded-word so Turkish characters survive in the subject. */
const encSubject = (s: string) => `=?UTF-8?B?${b64(s)}?=`;
const wrap76 = (s: string) => s.replace(/.{1,76}/g, (m) => m + '\r\n');

export function buildRaw(opts: {
  from: string; to: string; kind: Kind; data: Clean; id: string; duplicate: boolean;
}): string {
  const { from, to, kind, data, id, duplicate } = opts;
  const title = kind === 'contact' ? 'Yeni refakatçi talebi' : 'Yeni refakatçi başvurusu';
  const subject = `${duplicate ? '[TEKRAR] ' : ''}Refakatim · ${title} · ${data.name}`;
  const lines = Object.entries(data)
    .filter(([k]) => k !== 'consent')
    .map(([k, v]) => `${(LABELS[k] ?? k).padEnd(16)}: ${v}`);
  const body = [
    title, '='.repeat(title.length), '',
    ...lines, '',
    `Kayıt ID       : ${id}`,
    `Zaman (UTC)    : ${new Date().toISOString()}`,
    'Onay           : Gizlilik bilgilendirmesi kabul edildi',
    '', '— refakatim.pages.dev form servisi',
  ].join('\r\n');
  const headers = [
    `From: Refakatim Form <${from}>`,
    `To: <${to}>`,
    ...(typeof data.email === 'string' ? [`Reply-To: <${data.email}>`] : []),
    `Subject: ${encSubject(subject)}`,
    `Message-ID: <${id}@${from.split('@')[1]}>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  return headers.join('\r\n') + '\r\n\r\n' + wrap76(b64(body));
}

export async function sendMail(binding: SendEmail, from: string, to: string, raw: string) {
  await binding.send(new EmailMessage(from, to, raw));
}
