import { useEffect, useRef, useState } from 'react';
import { t, useLang } from '../i18n';

/**
 * Computer layout (Kim, 12 Oct 2026): on a wide screen the bottom bar becomes a menu down the left or right side,
 * its buttons can be dragged into any order, and a 📱 button shows the app at phone width.
 * The side, order and phone view are remembered on that computer only.
 */
export type NavItem = { id: string; icon: string; km: string; en: string; big?: boolean };
export const HOME: NavItem = { id: 'home', icon: '', km: 'ទំព័រដើម', en: 'Home' };
type Prefs = { side: 'left' | 'right'; phone: boolean; order: string[] };
const KEY = 'dlv_layout';
const WIDE = '(min-width: 900px)';

function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { side: p.side === 'right' ? 'right' : 'left', phone: !!p.phone, order: Array.isArray(p.order) ? p.order : [] };
  } catch { return { side: 'left', phone: false, order: [] }; }
}

export function useLayout() {
  const [prefs, setPrefs] = useState(readPrefs);
  const [wide, setWide] = useState(() => matchMedia(WIDE).matches);
  useEffect(() => {
    const m = matchMedia(WIDE);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const save = (p: Partial<Prefs>) => setPrefs(old => {
    const next = { ...old, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window */ }
    return next;
  });
  // Inside the phone-view frame the app is narrow, so it never shows the side menu or the 📱 button.
  const framed = window.self !== window.top;
  return { prefs, save, wide: wide && !framed };
}

/** The menu items in this person's saved order (new items go at the end, removed ones are dropped). */
export function ordered(items: NavItem[], order: string[]) {
  const by: Record<string, NavItem> = {};
  items.forEach(x => { by[x.id] = x; });
  const out = order.filter(id => by[id]).map(id => by[id]);
  return out.concat(items.filter(x => order.indexOf(x.id) < 0));
}

function Icon(p: { x: NavItem }) {
  return p.x.id === 'home' ? <img src="../icons/home.svg" alt="" width={22} height={22} /> : <span className="text-[19px] leading-[22px]">{p.x.icon}</span>;
}

/** The side menu on a computer. ✏️ (or holding a button) starts edit mode: drag a button, or tap one and then its new place. */
export function SideNav(p: { items: NavItem[]; active: string; side: 'left' | 'right'; onTab: (id: string) => void; onSide: () => void; onOrder: (ids: string[]) => void }) {
  useLang();
  const [edit, setEdit] = useState(false);
  const [from, setFrom] = useState('');
  const [over, setOver] = useState('');
  const hold = useRef(0);
  const ids = p.items.map(x => x.id);
  const move = (a: string, b: string) => {
    setFrom(''); setOver('');
    if (!a || a === b) return;
    const next = ids.filter(id => id !== a);
    next.splice(next.indexOf(b) + (ids.indexOf(a) < ids.indexOf(b) ? 1 : 0), 0, a);
    p.onOrder(next);
  };
  const press = () => { clearTimeout(hold.current); hold.current = window.setTimeout(() => setEdit(true), 600); };
  const release = () => clearTimeout(hold.current);
  const go = (x: NavItem) => {
    if (edit) { if (!from) setFrom(x.id); else move(from, x.id); return; }
    if (x.id === 'home') location.href = '../';
    else p.onTab(x.id);
  };
  return (
    <nav className={'side-nav ' + p.side + (edit ? ' editing' : '')} aria-label={t('ម៉ឺនុយ', 'Menu')} data-testid="side-nav">
      {p.items.map(x => (
        <button key={x.id} type="button" data-id={x.id}
          className={'side-item' + (x.big ? ' big' : '') + (p.active === x.id ? ' on' : '') + (from === x.id ? ' lifted' : '') + (over === x.id ? ' over' : '')}
          aria-current={p.active === x.id} draggable={edit}
          onClick={() => go(x)} onPointerDown={edit ? undefined : press} onPointerUp={release} onPointerLeave={release}
          onDragStart={e => { setFrom(x.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', x.id); } catch { /* old browser */ } }}
          onDragOver={e => { e.preventDefault(); if (over !== x.id) setOver(x.id); }}
          onDragLeave={() => setOver('')}
          onDrop={e => { e.preventDefault(); move(from, x.id); }}
          onDragEnd={() => { setFrom(''); setOver(''); }}>
          {x.big ? <span className="side-big">{x.icon}</span> : <Icon x={x} />}
          <b>{t(x.km, x.en)}</b>
        </button>
      ))}
      <div className="side-tools">
        {edit ? (
          <>
            <button type="button" className="side-tool" onClick={() => { p.onOrder([]); setFrom(''); }} title={t('លំដាប់ដើម', 'Normal order')}>↺</button>
            <button type="button" className="side-tool done" onClick={() => { setEdit(false); setFrom(''); }} data-testid="nav-done">✓ {t('រួចរាល់', 'Done')}</button>
          </>
        ) : (
          <>
            <button type="button" className="side-tool" onClick={p.onSide} title={t('ប្តូរទៅម្ខាងទៀត', 'Move to the other side')} aria-label={t('ប្តូរទៅម្ខាងទៀត', 'Move to the other side')} data-testid="nav-side">⇄</button>
            <button type="button" className="side-tool" onClick={() => setEdit(true)} title={t('ប្តូរលំដាប់', 'Change the order')} aria-label={t('ប្តូរលំដាប់', 'Change the order')} data-testid="nav-edit">✏️</button>
          </>
        )}
      </div>
      {edit ? <p className="side-hint">{t('អូស ឬចុចប៊ូតុង រួចចុចកន្លែងថ្មី', 'Drag, or tap a button then its new place')}</p> : null}
    </nav>
  );
}

/** Phone view on a computer: the same app in a phone-width frame, so it looks and works exactly as on a phone. */
export function PhoneFrame() {
  return (
    <div className="phone-stage">
      <iframe className="phone-frame" src={location.href} title={t('ទិដ្ឋភាពទូរស័ព្ទ', 'Phone view')} data-testid="phone-frame" />
    </div>
  );
}
