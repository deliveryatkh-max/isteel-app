import React, { useEffect, useMemo, useRef, useState } from 'react';
import { matches } from '../state';
import { L, setLang, t, useLang } from '../i18n';
import type { Label } from '../types';

// ---------------------------------------------------------------- header (shared iSteel banner)
export function Header(p: { busy?: boolean; waiting?: number; onOutbox?: () => void; title?: string; sub?: string; phoneView?: { on: boolean; toggle: () => void } }) {
  const lang = useLang();
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('fr_theme', next); } catch { /* private */ }
    setTheme(next);
  };
  return (
    <header className="bar">
      <div className="brand">
        <div className="isi-logo"><img src="../icons/isi-white.png" alt="ISI" width={30} height={30} /><span className="word">STEEL</span></div>
        <span className="sep" aria-hidden="true" />
        <div><b>{p.title || t('ដឹកជញ្ជូន', 'Delivery')}</b><small>{p.sub || t('ដំណើរដឹកជញ្ជូន', 'Delivery journey')}</small></div>
      </div>
      <div className="bar-right">
        {p.waiting ? <button type="button" className="icon-btn" style={{ width: 'auto', padding: '0 6px', background: '#8a5a00', borderColor: '#ffc46b' }} onClick={p.onOutbox} title={t('រង់ចាំផ្ញើ', 'Waiting to send')}>⏳{p.waiting}</button> : null}
        {p.phoneView ? (
          // Only on a computer: see the app as on a phone, and back (Kim, 12 Oct 2026).
          <button type="button" className="icon-btn" onClick={p.phoneView.toggle} data-testid="phone-view"
            title={p.phoneView.on ? t('ទិដ្ឋភាពកុំព្យូទ័រ', 'Computer view') : t('ទិដ្ឋភាពទូរស័ព្ទ', 'Phone view')}
            aria-label={p.phoneView.on ? t('ទិដ្ឋភាពកុំព្យូទ័រ', 'Computer view') : t('ទិដ្ឋភាពទូរស័ព្ទ', 'Phone view')}>{p.phoneView.on ? '🖥' : '📱'}</button>
        ) : null}
        <button type="button" className="icon-btn lang-btn" onClick={() => setLang(lang === 'en' ? 'km' : 'en')} title={lang === 'en' ? 'ភាសាខ្មែរ' : 'English'} aria-label={lang === 'en' ? 'ភាសាខ្មែរ' : 'English'}>
          <img src="../icons/flag-kh.svg" alt="ខ្មែរ" className={lang === 'km' ? 'on' : ''} />
          <img src="../icons/flag-gb.svg" alt="English" className={lang === 'en' ? 'on' : ''} />
        </button>
        <button type="button" className="icon-btn" onClick={flip} aria-label="Light / Dark" title="Light / Dark">{theme === 'dark' ? '☀️' : '🌙'}</button>
      </div>
      {p.busy ? <div className="busy-line" /> : null}
    </header>
  );
}

// ---------------------------------------------------------------- bottom navigation (phones): 5 buttons, Scan big in the middle
export type Tab = { id: string; icon: string; km: string; en: string; big?: boolean };
export function BottomNav(p: { tabs: Tab[]; active: string; onTab: (id: string) => void }) {
  useLang();
  const item = 'flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11.5px] leading-tight cursor-pointer bg-transparent border-0';
  return (
    <nav className="bottom-nav fixed bottom-0 inset-x-0 z-20 bg-card border-t border-line flex" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {p.tabs.map(x => x.id === 'home' ? (
        <a key="home" href="../" className={item + ' text-muted no-underline'}><img src="../icons/home.svg" alt="" width={22} height={22} /><b className="font-semibold truncate max-w-full">{t('ទំព័រដើម', 'Home')}</b></a>
      ) : x.big ? (
        // The Scan button sits raised in the middle, bigger than the rest.
        <button key={x.id} type="button" className={item + ' !justify-end' + (p.active === x.id ? ' text-brand' : ' text-muted')} onClick={() => p.onTab(x.id)} aria-current={p.active === x.id}>
          <span className="-mt-6 w-14 h-14 rounded-full bg-brand text-white flex items-center justify-center text-[26px] shadow-lg border-4 border-card">{x.icon}</span><b className="font-semibold truncate max-w-full">{t(x.km, x.en)}</b>
        </button>
      ) : (
        <button key={x.id} type="button" className={item + (p.active === x.id ? ' text-brand' : ' text-muted')} onClick={() => p.onTab(x.id)} aria-current={p.active === x.id}>
          <span className="text-[19px] leading-[22px]">{x.icon}</span><b className="font-semibold truncate max-w-full">{t(x.km, x.en)}</b>
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- small pieces
const STAGE_TONE: Record<string, string> = {
  waiting: 'bg-soft text-brand', at_pickup: 'bg-soft text-brand', departed_pickup: 'bg-soft text-brand', at_loading: 'bg-warnsoft text-warn',
  loading: 'bg-warnsoft text-warn', loaded: 'bg-warnsoft text-warn', on_delivery: 'bg-soft text-accent', at_customer: 'bg-soft text-accent',
  completed: 'bg-oksoft text-ok', canceled: 'bg-badsoft text-bad',
  not_started: 'bg-soft text-muted', in_progress: 'bg-soft text-accent', partial: 'bg-warnsoft text-warn', delivered: 'bg-oksoft text-ok', failed: 'bg-badsoft text-bad',
  picked: 'bg-soft text-accent', moved: 'bg-oksoft text-ok',
};
export function Badge(p: { k: string; label?: Label; text?: string }) {
  return <span className={'inline-flex items-center rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold whitespace-nowrap ' + (STAGE_TONE[p.k] || 'bg-soft text-muted')}>{p.text || L(p.label) || p.k}</span>;
}

export function Alert(p: { tone: 'bad' | 'ok' | 'warn' | 'info'; children: React.ReactNode }) {
  const c = { bad: 'bg-badsoft text-bad', ok: 'bg-oksoft text-ok', warn: 'bg-warnsoft text-warn', info: 'bg-soft text-brand' }[p.tone];
  return <div className={'rounded-xl px-3.5 py-2.5 text-[14.5px] font-semibold mb-3 whitespace-pre-line ' + c} role={p.tone === 'bad' ? 'alert' : undefined}>{p.children}</div>;
}

export function Spinner() { return <div className="spinner" aria-label="Loading" />; }

/** The part of the screen the phone keyboard leaves free, so a sheet sits on top of the keyboard (Kim, 12 Oct 2026). */
function useKeyboardGap() {
  const [vp, setVp] = useState<{ bottom: number; height: number } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const on = () => setVp({ bottom: Math.max(0, window.innerHeight - v.height - v.offsetTop), height: v.height });
    on();
    v.addEventListener('resize', on); v.addEventListener('scroll', on);
    return () => { v.removeEventListener('resize', on); v.removeEventListener('scroll', on); };
  }, []);
  return vp;
}

export function Modal(p: { title: string; onClose?: () => void; children: React.ReactNode; wide?: boolean }) {
  const vp = useKeyboardGap();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && p.onClose) p.onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [p.onClose]);
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center" style={vp && vp.bottom ? { bottom: vp.bottom } : undefined}
      onClick={e => { if (e.target === e.currentTarget && p.onClose) p.onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={p.title} className={'bg-card w-full rounded-t-2xl sm:rounded-2xl max-h-[88vh] overflow-auto p-4 ' + (p.wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
        style={vp ? { maxHeight: Math.round(vp.height * 0.88) } : undefined}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="m-0 text-[17px] font-bold">{p.title}</h2>
          {p.onClose ? <button type="button" className="btn btn-sm" onClick={p.onClose} aria-label={t('បិទ', 'Close')}>✕</button> : null}
        </div>
        {p.children}
      </div>
    </div>
  );
}

let toastSet: ((s: string) => void) | null = null;
export function toast(s: string) { toastSet && toastSet(s); }
export function Toaster() {
  const [msg, setMsg] = useState('');
  const timer = useRef(0);
  useEffect(() => { toastSet = s => { setMsg(s); clearTimeout(timer.current); timer.current = window.setTimeout(() => setMsg(''), 3200); }; return () => { toastSet = null; }; }, []);
  return msg ? <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-[84px] z-50 bg-navy text-white rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg max-w-[92vw]">{msg}</div> : null;
}

/**
 * Searchable picker. Options are {value, label, sub}. allowFree lets the user keep what they typed
 * (rented and customer trucks are not in Plate Number).
 */
export type Opt = { value: string; label: string; sub?: string };
export function Picker(p: {
  value: string; options: Opt[]; onChange: (v: string, o?: Opt) => void; placeholder?: string; allowFree?: boolean; freeLabel?: string; id?: string; upper?: boolean;
  /** "➕ Add new" button inside the list (like the Fuel app's Add new truck): check(v) returns an error text or ''. */
  addNew?: { button: string; placeholder: string; check?: (v: string) => string };
  bad?: boolean;
  /** Plate search: number keypad, and "1234" finds "3A-1234" (Kim, 12 Oct 2026). */
  digits?: boolean;
}) {
  useLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [newV, setNewV] = useState('');
  const [newErr, setNewErr] = useState('');
  const addIt = () => {
    const v = newV.trim();
    const e = !v ? t('សូមវាយ', 'Type it first') : p.addNew && p.addNew.check ? p.addNew.check(v) : '';
    if (e) { setNewErr(e); return; }
    p.onChange(v); setOpen(false); setAdding(false); setNewV(''); setNewErr('');
  };
  const list = useMemo(() => {
    const s = p.digits ? q.replace(/\D/g, '') : q.trim().toLowerCase();
    const hit = !s ? p.options : p.digits ? p.options.filter(o => o.value.replace(/\D/g, '').indexOf(s) >= 0)
      : p.options.filter(o => matches(o.label + ' ' + (o.sub || '') + ' ' + o.value, s));
    return hit.slice(0, 60);
  }, [q, p.options]);
  const cur = p.options.find(o => o.value === p.value);
  const free = q.trim() && p.allowFree && !p.digits && !p.options.some(o => o.value.toLowerCase() === q.trim().toLowerCase());
  return (
    <>
      <button type="button" id={p.id} className={'in text-left flex items-center justify-between gap-2 ' + (p.bad ? '!border-bad' : '')} onClick={() => { setQ(''); setAdding(false); setOpen(true); }}>
        <span className={p.value ? '' : 'text-muted'}>{p.value ? (cur ? cur.label : p.value) : p.placeholder || t('ជ្រើសរើស…', 'Choose…')}</span>
        <span className="text-muted">▾</span>
      </button>
      {open ? (
        <Modal title={p.placeholder || t('ជ្រើសរើស', 'Choose')} onClose={() => setOpen(false)}>
          <input autoFocus className="in mb-2" value={q} inputMode={p.digits ? 'numeric' : undefined} onChange={e => setQ(p.digits ? e.target.value.replace(/\D/g, '') : p.upper ? e.target.value.toUpperCase() : e.target.value)}
            placeholder={p.digits ? t('ស្វែងរកតាមលេខ ឧ. 1234', 'Search by number, e.g. 1234') : t('ស្វែងរក ឬវាយ…', 'Search or type…')}
            onKeyDown={e => { if (e.key === 'Enter') { const pick = list[0] && !free ? list[0] : null; if (pick) { p.onChange(pick.value, pick); setOpen(false); } else if (free) { p.onChange(q.trim()); setOpen(false); } } }} />
          {p.addNew ? (adding ? (
            <div className="rounded-xl border-[1.5px] border-accent bg-soft p-2.5 mb-2 grid gap-2">
              <input autoFocus className="in" value={newV} onChange={e => { setNewV(p.upper ? e.target.value.toUpperCase() : e.target.value); setNewErr(''); }}
                onKeyDown={e => { if (e.key === 'Enter') addIt(); }} placeholder={p.addNew.placeholder} aria-label={p.addNew.placeholder} />
              {newErr ? <span className="text-bad text-[13px] font-semibold">{newErr}</span> : null}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>{t('បោះបង់', 'Cancel')}</button>
                <button type="button" className="btn-primary btn-sm" onClick={addIt}>➕ {t('បន្ថែម', 'Add')}</button>
              </div>
            </div>
          ) : <button type="button" className="btn w-full mb-2 justify-start !border-accent text-accent font-bold" onClick={() => { setAdding(true); setNewV(q.trim()); }}>{p.addNew.button}</button>) : null}
          {free && !p.addNew ? <button type="button" className="btn w-full mb-2 justify-start" onClick={() => { p.onChange(q.trim()); setOpen(false); }}>➕ {p.freeLabel || t('ប្រើ', 'Use')} “{q.trim()}”</button> : null}
          <div className="grid gap-1">
            {list.map(o => (
              <button key={o.value} type="button" className={'text-left rounded-xl px-3 py-2 border-[1.5px] ' + (o.value === p.value ? 'border-accent bg-soft' : 'border-line bg-card')} onClick={() => { p.onChange(o.value, o); setOpen(false); }}>
                <b className="block">{o.label}</b>{o.sub ? <small className="block text-muted text-[12.5px]">{o.sub}</small> : null}
              </button>
            ))}
            {!list.length && !free ? <p className="muted text-sm">{t('រកមិនឃើញ', 'Nothing found')}</p> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- photo: camera or gallery, shrunk on the phone before sending
export async function shrinkPhoto(file: File, max = 1280): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  } finally { URL.revokeObjectURL(url); }
}
/**
 * Same stamp as the Fuel app (Kim, 17 Oct 2026): a navy strip under the photo with the ID on the left and
 * "STEEL · date time" (Phnom Penh) on the right. A photo that fails to load is sent as it is.
 */
export function watermark(dataUrl: string, id: string, at?: number): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight, band = Math.max(36, Math.round(w * 0.07));
      const c = document.createElement('canvas');
      c.width = w; c.height = h + band;
      const x = c.getContext('2d')!;
      x.drawImage(img, 0, 0);
      x.fillStyle = '#011e41'; x.fillRect(0, h, w, band);
      const d = new Date((at || Date.now()) + 7 * 3600 * 1000), p = (n: number) => String(n).padStart(2, '0');
      const when = p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
      const pad = Math.round(band * 0.35), mid = h + band / 2;
      x.textBaseline = 'middle'; x.fillStyle = '#fff';
      const right = 'STEEL · ' + when;
      const fonts = (k: number) => [`700 ${Math.round(band * 0.5 * k)}px system-ui, sans-serif`, `400 ${Math.round(band * 0.4 * k)}px system-ui, sans-serif`];
      const width = (k: number) => { const f = fonts(k); x.font = f[0]; const a = x.measureText(id).width; x.font = f[1]; return a + x.measureText(right).width; };
      const k = Math.min(1, (w - pad * 3) / Math.max(1, width(1)));   // small photo: both texts shrink so they never overlap
      const f = fonts(k);
      x.font = f[0]; x.textAlign = 'left'; x.fillText(id, pad, mid);
      x.font = f[1]; x.textAlign = 'right'; x.fillText(right, w - pad, mid);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
export function PhotoInput(p: { value: string; onChange: (v: string) => void; label?: string }) {
  useLang();
  const cam = useRef<HTMLInputElement>(null), gal = useRef<HTMLInputElement>(null);
  const pick = async (f?: File | null) => { if (f) p.onChange(await shrinkPhoto(f)); };
  return (
    <div>
      {p.label ? <span className="lbl">{p.label}</span> : null}
      {p.value ? (
        <div className="flex items-center gap-3">
          <img src={p.value} alt="" className="w-20 h-20 object-cover rounded-xl border border-line" />
          <button type="button" className="btn btn-sm" onClick={() => p.onChange('')}>✕ {t('លុប', 'Remove')}</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm" onClick={() => cam.current?.click()}>📷 {t('ថតរូប', 'Take photo')}</button>
          <button type="button" className="btn btn-sm" onClick={() => gal.current?.click()}>🖼️ {t('ពីវិចិត្រសាល', 'From gallery')}</button>
        </div>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={e => pick(e.target.files && e.target.files[0])} />
      <input ref={gal} type="file" accept="image/*" hidden onChange={e => pick(e.target.files && e.target.files[0])} />
    </div>
  );
}

export function Segmented<T extends string>(p: { value: T; options: { v: T; km: string; en: string }[]; onChange: (v: T) => void }) {
  useLang();
  return (
    <div className="flex flex-wrap gap-2">
      {p.options.map(o => <button key={o.v} type="button" className={'chip ' + (p.value === o.v ? 'chip-on' : '')} onClick={() => p.onChange(o.v)} aria-pressed={p.value === o.v}>{t(o.km, o.en)}</button>)}
    </div>
  );
}

export function Kv(p: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 py-1 border-b border-line last:border-0 text-[14.5px]"><span className="muted">{p.k}</span><span className="text-right font-semibold min-w-0 break-words">{p.v}</span></div>;
}
