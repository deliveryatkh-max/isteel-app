// Talks to the Delivery Apps Script. One sign-in for every iSteel app: the token lives in localStorage 'fr_id_token'
// and the server swaps it for a 30-day session that it renews while the app is used.
import { t } from './i18n';

declare global {
  interface Window {
    DELIVERY_CONFIG?: { API_URL?: string };
    APP_CONFIG?: { API_URL?: string; GOOGLE_CLIENT_ID?: string };
    google?: any;
    qrcode?: any;
  }
}

export const API_URL = (window.DELIVERY_CONFIG && window.DELIVERY_CONFIG.API_URL) || '';
export const CLIENT_ID = (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_CLIENT_ID) || '';
const TOKEN_KEY = 'fr_id_token';

export const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* full or private */ } },
  json<T>(k: string): T | null { try { return JSON.parse(store.get(k) || 'null'); } catch { return null; } },
};

function decodeJwt(tok: string) {
  try { return JSON.parse(decodeURIComponent(escape(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return null; }
}
export const token = () => store.get(TOKEN_KEY) || '';
export const setToken = (v: string | null) => store.set(TOKEN_KEY, v);
export function signedEmail() { const c = decodeJwt(token()); return c && c.email ? String(c.email).toLowerCase() : ''; }
export function tokenValid() { const c = decodeJwt(token()); return !!(c && c.exp * 1000 > Date.now() + 60000); }

export class ApiError extends Error {
  code: string;
  constructor(code: string, msg: string) { super(msg); this.code = code; }
}

/** Calls an action. Errors keep the server's code (AUTH, NOACCESS, DENIED, DUPLICATE …) and the "English || ខ្មែរ" text. */
export async function api<T = any>(action: string, payload?: any, opts?: { noAuth?: boolean }): Promise<T> {
  if (!API_URL) throw new ApiError('SETUP', 'The app is not connected yet: API_URL is empty in delivery/config.js. || កម្មវិធីមិនទាន់ភ្ជាប់: API_URL នៅទទេក្នុង delivery/config.js។');
  let data: any;
  try {
    const res = await fetch(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: opts && opts.noAuth ? undefined : token(), payload: payload || {} }),
    });
    data = await res.json();
  } catch {
    throw new ApiError('NET', t('មិនអាចភ្ជាប់អ៊ីនធឺណិត។', 'No connection.') + ' || ' + t('មិនអាចភ្ជាប់អ៊ីនធឺណិត។', 'No connection.'));
  }
  if (!data || !data.ok) {
    const m = String((data && data.error) || 'SERVER: Unknown error').match(/^([A-Z_]+):\s*([\s\S]*)$/);
    throw new ApiError(m ? m[1] : 'SERVER', m ? m[2] : String(data && data.error));
  }
  if (data.session) setToken(data.session);
  return data.data as T;
}

// ---------------------------------------------------------------- Outbox
// A submission that cannot reach the server (no signal) is kept on the phone and sent again automatically,
// with the time it was really recorded. Nothing is dropped silently: the header shows how many are waiting.
export type OutItem = { ref: string; action: 'record' | 'drvRecord'; payload: any; label: string; at: number; error?: string };
const OUT_KEY = 'dlv_outbox';
const outSubs = new Set<() => void>();
export const outbox = {
  list: (): OutItem[] => store.json<OutItem[]>(OUT_KEY) || [],
  save(items: OutItem[]) { store.set(OUT_KEY, JSON.stringify(items)); outSubs.forEach(f => f()); },
  add(item: OutItem) {
    outbox.save(outbox.list().filter(x => x.ref !== item.ref).concat(item));
    // Phone storage full (photos are big): keep the step without its photo rather than lose it.
    if (!outbox.list().some(x => x.ref === item.ref)) {
      const payload = Object.assign({}, item.payload); delete payload.photo;
      outbox.save(outbox.list().concat(Object.assign({}, item, { payload, label: item.label + ' (no photo)' })));
    }
  },
  remove(ref: string) { outbox.save(outbox.list().filter(x => x.ref !== ref)); },
  subscribe(f: () => void) { outSubs.add(f); return () => { outSubs.delete(f); }; },
};

let flushing = false;
/** Sends what is waiting. Items the server refuses stay in the list with the reason, for the user to look at. */
export async function flushOutbox(onSent?: (item: OutItem, res: any) => void) {
  if (flushing || !API_URL) return;
  flushing = true;
  try {
    for (const item of outbox.list()) {
      if (item.error) continue;
      try {
        const res = await api(item.action, item.payload, { noAuth: item.action === 'drvRecord' });
        if (res && res.needConfirm) {
          // A warning appeared while it waited: keep it for the user to decide (never confirmed automatically).
          outbox.save(outbox.list().map(x => (x.ref === item.ref ? { ...x, error: res.needConfirm.map((w: any) => w.en + ' || ' + w.kh).join('\n') } : x)));
          continue;
        }
        outbox.remove(item.ref);
        onSent && onSent(item, res);
      } catch (e: any) {
        if (e.code === 'NET' || e.code === 'BUSY') break;
        outbox.save(outbox.list().map(x => (x.ref === item.ref ? { ...x, error: e.message } : x)));
      }
    }
  } finally {
    flushing = false;
  }
}

export const newRef = () => (crypto && 'randomUUID' in crypto ? (crypto as any).randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
