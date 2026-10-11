// Khmer by default with the 🇰🇭/🇬🇧 switch (Kim, 11 Oct 2026). Same localStorage key as every iSteel app.
import { useSyncExternalStore } from 'react';

export type Lang = 'km' | 'en';
const KEY = 'app_lang';
let lang: Lang = 'km';
try { if (localStorage.getItem(KEY) === 'en') lang = 'en'; } catch { /* private mode */ }
document.documentElement.lang = lang;
const subs = new Set<() => void>();

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  document.documentElement.lang = l;
  subs.forEach(f => f());
}
export function useLang() {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f); }, () => lang);
}
/** t('ខ្មែរ', 'English') */
export const t = (km: string, en: string) => (lang === 'en' ? en : km);
/** Pick the language half of a {kh, en} label. */
export const L = (x?: { kh?: string; en?: string } | null) => (x ? (lang === 'en' ? x.en || x.kh || '' : x.kh || x.en || '') : '');
/** Server errors carry "English || ខ្មែរ". */
export function errText(msg: string) {
  const [en, kh] = String(msg || '').split(' || ');
  return lang === 'en' ? en : kh || en;
}

// Cambodia time on every screen, whatever the phone's own time zone is.
const TZ = 'Asia/Phnom_Penh';
const fmtCache: Record<string, Intl.DateTimeFormat> = {};
function f(opts: Intl.DateTimeFormatOptions) {
  const k = JSON.stringify(opts);
  return fmtCache[k] || (fmtCache[k] = new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: TZ }, opts)));
}
export const fmtTime = (ms?: number | null) => (ms ? f({ hour: '2-digit', minute: '2-digit', hour12: false }).format(ms) : '–');
export const fmtDate = (ms?: number | null) => (ms ? f({ day: '2-digit', month: 'short', year: '2-digit' }).format(ms) : '–');
export const fmtDateTime = (ms?: number | null) => (ms ? fmtDate(ms) + ' ' + fmtTime(ms) : '–');
export const ymdNow = () => f({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now()).split('/').reverse().join('-');
export const ymdOf = (ms: number) => f({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms).split('/').reverse().join('-');
export function ago(ms?: number | null) {
  if (!ms) return '';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return t('ឥឡូវនេះ', 'just now');
  if (m < 60) return m + t(' នាទីមុន', ' min ago');
  const h = Math.floor(m / 60);
  if (h < 24) return h + t(' ម៉ោងមុន', ' h ago');
  return Math.floor(h / 24) + t(' ថ្ងៃមុន', ' d ago');
}
export const kg = (n?: number) => (n ? Math.round(n).toLocaleString('en-US') + ' kg' : '–');
