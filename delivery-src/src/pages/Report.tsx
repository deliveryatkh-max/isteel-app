// 📊 Report tab (Kim, 24 Nov 2026, option C): time spent at each area, compared by warehouse / 3PL / customer / driver,
// red when over the target (Delivery Settings), the customers who keep trucks longest, and an Excel (CSV) download.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { errText, t, useLang, ymdNow, ymdOf } from '../i18n';
import { useApp } from '../state';
import { Alert, Spinner } from '../components/ui';

type Row = { key: string; trips: number; [col: string]: number | string | null };
type Trip = { id: string; day: string; plate: string; co: string; driver: string; wh: string; cust: string; wait: number | null; load: number | null; gate: number | null; road: number | null; site: number | null; plant: number | null; total: number | null };
type Rep = {
  from: string; to: string; builtAt: number;
  targets: { wait: number; load: number; gate: number; site: number; plant: number };
  summary: { trips: number; done: number; total: number | null; plant: number | null; wait: number | null; load: number | null; gate: number | null; road: number | null; site: number | null; underPlant: number | null };
  views: Record<'wh' | 'co' | 'cust' | 'driver', Row[]>;
  trips: Trip[];
};
type View = 'wh' | 'co' | 'cust' | 'driver';
type Col = { k: string; icon: string; km: string; en: string; tgt?: keyof Rep['targets'] };

const VIEWS: { v: View; km: string; en: string; key: [string, string] }[] = [
  { v: 'wh', km: 'ឃ្លាំង', en: 'Warehouse', key: ['ឃ្លាំង', 'Warehouse'] },
  { v: 'co', km: '3PL', en: '3PL', key: ['ក្រុមហ៊ុន', 'Company'] },
  { v: 'cust', km: 'អតិថិជន', en: 'Customer', key: ['អតិថិជន', 'Customer'] },
  { v: 'driver', km: 'តៃកុង', en: 'Driver', key: ['តៃកុង', 'Driver'] },
];
const COLS: Record<View, Col[]> = {
  wh: [{ k: 'wait', icon: '🏭', km: 'រង់ចាំ', en: 'Wait', tgt: 'wait' }, { k: 'load', icon: '📦', km: 'ឡើង', en: 'Load', tgt: 'load' }, { k: 'gate', icon: '⚖️', km: 'ថ្លឹងចេញ', en: 'To Gate Out', tgt: 'gate' }],
  co: [{ k: 'plant', icon: '🏭', km: 'ក្នុងរោងចក្រ', en: 'In plant', tgt: 'plant' }, { k: 'road', icon: '🚚', km: 'ផ្លូវ', en: 'Road' }, { k: 'site', icon: '📍', km: 'នៅអតិថិជន', en: 'At customer', tgt: 'site' }, { k: 'total', icon: '⏱️', km: 'សរុប', en: 'Total' }],
  driver: [{ k: 'plant', icon: '🏭', km: 'ក្នុងរោងចក្រ', en: 'In plant', tgt: 'plant' }, { k: 'road', icon: '🚚', km: 'ផ្លូវ', en: 'Road' }, { k: 'site', icon: '📍', km: 'នៅអតិថិជន', en: 'At customer', tgt: 'site' }, { k: 'total', icon: '⏱️', km: 'សរុប', en: 'Total' }],
  cust: [{ k: 'road', icon: '🚚', km: 'ផ្លូវ', en: 'Road' }, { k: 'wait', icon: '⏳', km: 'រង់ចាំ', en: 'Wait' }, { k: 'unload', icon: '📦', km: 'ទម្លាក់', en: 'Unload' }, { k: 'site', icon: '📍', km: 'សរុបនៅទីតាំង', en: 'At site', tgt: 'site' }],
};
const hm = (m: number | null | undefined | string) => (m == null || m === '' ? '–' : Math.floor(Number(m) / 60) + ':' + String(Math.round(Number(m)) % 60).padStart(2, '0'));
function monthStart() { return ymdNow().slice(0, 8) + '01'; }

export default function ReportPage() {
  useLang();
  const { tick, setBusy } = useApp();
  const [from, setFrom] = useState(() => ymdOf(Date.now() - 6 * 86400000));
  const [to, setTo] = useState(ymdNow);
  const [view, setView] = useState<View>(() => { try { return (sessionStorage.getItem('dlv_rep_view') as View) || 'wh'; } catch (e) { return 'wh'; } });
  const [sort, setSort] = useState<{ k: string; up: boolean }>({ k: 'trips', up: false });
  const [d, setD] = useState<Rep | null>(null);
  const [err, setErr] = useState('');
  const [fresh, setFresh] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true); setErr('');
    api<Rep>('report', { from, to, fresh: fresh > 0 })
      .then(x => { if (live) setD(x); })
      .catch(e => { if (live) setErr(errText(e.message)); })
      .finally(() => setBusy(false));
    return () => { live = false; };
  }, [from, to, tick, fresh]);
  useEffect(() => { try { sessionStorage.setItem('dlv_rep_view', view); } catch (e) { /* none */ } setSort({ k: 'trips', up: false }); }, [view]);

  const cols = COLS[view];
  const rows = useMemo(() => {
    const list = (d ? d.views[view] : []).slice();
    return list.sort((a, b) => {
      const x = a[sort.k], y = b[sort.k];
      const c = sort.k === 'key' ? String(x).localeCompare(String(y)) : (x == null ? -1 : Number(x)) - (y == null ? -1 : Number(y));
      return sort.up ? c : -c;
    });
  }, [d, view, sort]);
  const longest = useMemo(() => (d ? d.views.cust.filter(r => r.site != null).sort((a, b) => Number(b.site) - Number(a.site)).slice(0, 5) : []), [d]);
  const tgt = d ? d.targets : null;
  const tone = (c: Col, v: Row[string]) => {
    if (!tgt || !c.tgt || v == null) return '';
    const g = tgt[c.tgt];
    return Number(v) > g ? 'bg-badsoft text-bad font-bold' : Number(v) <= g * 0.75 ? 'bg-oksoft text-ok font-bold' : '';
  };
  const day = (s: string) => new Date(s + 'T12:00:00+07:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  // Excel: one row per trip (opens in Excel; times in minutes)
  const excel = () => {
    if (!d) return;
    const head = ['Trip ID', 'Gate In date', 'Truck', '3PL', 'Driver', 'Warehouse', 'Customer', 'Wait for warehouse (min)', 'Loading (min)', 'End Loading to Gate Out (min)', 'Road to first customer (min)', 'At customer (min)', 'Gate In to Gate Out (min)', 'Gate In to Delivered (min)'];
    const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [head.join(',')].concat(d.trips.map(x => [x.id, x.day, x.plate, x.co, x.driver, x.wh, x.cust, x.wait, x.load, x.gate, x.road, x.site, x.plant, x.total].map(q).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'Delivery report ' + d.from + ' to ' + d.to + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  const preset = (a: string, b: string) => { setFrom(a); setTo(b); };
  const on = (a: string, b: string) => (from === a && to === b ? ' chip-on' : '');
  const th = (k: string, label: string, right = true) => (
    <th key={k} className={'sticky top-0 z-[1] bg-[#0b4f6c] text-white px-1.5 py-2 cursor-pointer select-none whitespace-nowrap text-[11.5px] font-semibold ' + (right ? 'text-right' : 'text-left')}
      onClick={() => setSort({ k, up: sort.k === k ? !sort.up : k === 'key' })}>{label}{sort.k === k ? (sort.up ? ' ▲' : ' ▼') : ''}</th>
  );
  const vk = VIEWS.find(x => x.v === view)!;

  return (
    <main className="max-w-3xl xl:max-w-5xl mx-auto p-3 sm:p-4" data-report>
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <button type="button" className={'chip' + on(ymdNow(), ymdNow())} onClick={() => preset(ymdNow(), ymdNow())}>{t('ថ្ងៃនេះ', 'Today')}</button>
        <button type="button" className={'chip' + on(ymdOf(Date.now() - 6 * 86400000), ymdNow())} onClick={() => preset(ymdOf(Date.now() - 6 * 86400000), ymdNow())}>{t('៧ ថ្ងៃ', '7 days')}</button>
        <button type="button" className={'chip' + on(monthStart(), ymdNow())} onClick={() => preset(monthStart(), ymdNow())}>{t('ខែនេះ', 'This month')}</button>
        <input className="in !w-auto !py-1 text-[13px]" type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} aria-label={t('ពី', 'From')} />
        <input className="in !w-auto !py-1 text-[13px]" type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} aria-label={t('ដល់', 'To')} />
        <button type="button" className="chip" onClick={() => setFresh(fresh + 1)}>↻</button>
      </div>
      {err ? <Alert tone="bad">{err}</Alert> : null}
      {!d ? (err ? null : <Spinner />) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Tile k={t('⏱️ ពេលសរុបជាមធ្យម', '⏱️ Avg total time')} v={hm(d.summary.total)} sub={t('Gate In → បានប្រគល់', 'Gate In → Delivered')} />
            <Tile k={t('🏭 ក្នុងរោងចក្រ', '🏭 In the plant')} v={hm(d.summary.plant)} sub={(d.summary.underPlant == null ? '–' : d.summary.underPlant + '% ') + t('ទាន់គោលដៅ ', 'on target ') + hm(d.targets.plant)}
              tone={d.summary.plant == null ? '' : d.summary.plant > d.targets.plant ? 'text-bad' : 'text-ok'} />
            <Tile k={t('🚚 ជើងដឹក', '🚚 Trips')} v={String(d.summary.trips)} sub={d.summary.done + ' ' + t('បានបញ្ចប់', 'finished')} />
          </div>
          <div className="seg-tabs" role="tablist">
            {VIEWS.map(x => <button key={x.v} type="button" role="tab" aria-selected={view === x.v} className={view === x.v ? 'on' : ''} onClick={() => setView(x.v)}>{t(x.km, x.en)}</button>)}
          </div>
          <section className="card !p-0 overflow-hidden mt-2">
            <div className="px-3 pt-2.5 pb-1.5 text-[13px] font-bold">{t('មធ្យម (ម៉ោង:នាទី) · ក្រហម = លើសគោលដៅ', 'Average (h:mm) · red = over target')}</div>
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-[13px] border-collapse tabular-nums">
                <thead><tr>{th('key', t(...vk.key), false)}{cols.map(c => th(c.k, c.icon + ' ' + t(c.km, c.en)))}{th('trips', view === 'cust' ? t('ដង', 'Stops') : t('ជើង', 'Trips'))}</tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.key} className="border-b border-line">
                      <td className="px-1.5 py-1.5 max-w-[120px] sm:max-w-[220px] truncate" title={r.key}>{r.key}</td>
                      {cols.map(c => <td key={c.k} className={'px-1.5 py-1.5 text-right whitespace-nowrap ' + tone(c, r[c.k])}>{hm(r[c.k])}</td>)}
                      <td className="px-2 py-1.5 text-right">{r.trips}</td>
                    </tr>
                  ))}
                  {!rows.length ? <tr><td colSpan={cols.length + 2} className="px-2 py-4 text-center muted">{t('គ្មានជើងដឹកក្នុងរយៈពេលនេះ', 'No trips in this period')}</td></tr> : null}
                  {rows.length && cols.some(c => c.tgt) ? (
                    <tr className="muted text-[12px]"><td className="px-2 py-1.5">🎯 {t('គោលដៅ', 'Target')}</td>{cols.map(c => <td key={c.k} className="px-2 py-1.5 text-right">{c.tgt ? hm(d.targets[c.tgt]) : ''}</td>)}<td /></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
          {longest.length ? (
            <section className="card">
              <h2 className="text-[14px] font-bold m-0 mb-2">📍 {t('អតិថិជនដែលរក្សាឡានយូរបំផុត', 'Customers who keep trucks longest')}</h2>
              {longest.map(r => (
                <div key={r.key} className="grid grid-cols-[1fr_96px_44px] gap-2 items-center py-1 text-[13px]" title={r.key + ': ' + hm(r.site)}>
                  <span className="truncate">{r.key}</span>
                  <span className="h-2 rounded-r bg-accent" style={{ width: (Number(r.site) / Number(longest[0].site || 1)) * 100 + '%' }} />
                  <b className="text-right tabular-nums">{hm(r.site)}</b>
                </div>
              ))}
            </section>
          ) : null}
          <button type="button" className="btn w-full" onClick={excel} disabled={!d.trips.length}>⬇️ Excel ({d.trips.length} {t('ជើងដឹក', 'trips')})</button>
          <p className="muted text-[12px] text-center mt-2">
            {day(d.from)} – {day(d.to)} · {t('គោលដៅកែបាននៅ Delivery Settings', 'Targets are set in Delivery Settings')} · {t('ធ្វើបច្ចុប្បន្នភាព', 'Updated')} {new Date(d.builtAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Phnom_Penh' })}
          </p>
        </>
      )}
    </main>
  );
}

function Tile(p: { k: string; v: string; sub: string; tone?: string }) {
  return (
    <div className="card !mb-0 !p-2.5 min-w-0">
      <div className="muted text-[11.5px] leading-tight">{p.k}</div>
      <div className={'text-[21px] font-extrabold leading-tight ' + (p.tone || '')}>{p.v}</div>
      <div className="muted text-[11px] leading-tight">{p.sub}</div>
    </div>
  );
}
