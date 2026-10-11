import { useEffect, useState } from 'react';
import { api } from '../api';
import { errText, fmtDate, fmtDateTime, kg as fmtKg, L, t, useLang, ymdNow, ymdOf } from '../i18n';
import { dnHref, go, tripHref, useApp } from '../state';
import type { DnInfo } from '../types';
import { Alert, Badge, Kv, Spinner } from '../components/ui';
import { Scanner } from '../components/Scanner';
import { eventLabel } from './Trip';

type Item = { dn: string; cust: string; so: string; date: string; status: string; kg: number; planKg: number; trips: { id: string; plate: string; leg: string }[] };

/** DN / Delivery tracking: find a DN by number, customer, truck, trip or date and see where it is. */
export function DnSearchPage() {
  useLang();
  const { boot, tick, setBusy } = useApp();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState(() => ymdOf(Date.now() - 6 * 86400000));
  const [to, setTo] = useState(ymdNow);
  const [status, setStatus] = useState('');
  const [res, setRes] = useState<{ total: number; items: Item[] } | null>(null);
  const [err, setErr] = useState('');
  const [scan, setScan] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(''); setBusy(true);
    // A DN number on its own: search every date.
    const exact = /^\d{6,}$/.test(q.trim());
    api('search', { q, from: exact ? '' : from, to: exact ? '' : to, status })
      .then(r => { if (live) setRes(r); })
      .catch(e => { if (live) setErr(errText(e.message)); })
      .finally(() => setBusy(false));
    return () => { live = false; };
  }, [n, from, to, status, tick]);
  return (
    <main className="max-w-3xl mx-auto p-3 sm:p-4">
      <div className="card !p-3 grid grid-cols-2 gap-2">
        <div className="col-span-2 flex gap-2">
          <input className="in flex-1" type="search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setN(n + 1); }} placeholder={t('DN អតិថិជន ផ្លាកលេខ ជើងដឹក SO', 'DN, customer, plate, trip, SO')} aria-label="DN" />
          <button type="button" className="btn" onClick={() => setScan(true)} aria-label={t('ស្កេនបាកូដ', 'Scan barcode')}>📷</button>
        </div>
        <label className="text-[13px] muted">{t('ពីថ្ងៃ', 'From')}<input className="in" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-[13px] muted">{t('ដល់ថ្ងៃ', 'To')}<input className="in" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
        <select className="in" value={status} onChange={e => setStatus(e.target.value)} aria-label={t('ស្ថានភាព', 'Status')}>
          <option value="">{t('គ្រប់ស្ថានភាព', 'All statuses')}</option>
          {Object.keys(boot.dnStatuses).map(k => <option key={k} value={k}>{L(boot.dnStatuses[k])}</option>)}
        </select>
        <button type="button" className="btn-primary" onClick={() => setN(n + 1)}>🔍 {t('ស្វែងរក', 'Search')}</button>
      </div>
      {err ? <Alert tone="bad">{err}</Alert> : null}
      {!res ? <Spinner /> : (
        <>
          <p className="muted text-[13px]">{res.total} DN{res.total > res.items.length ? ' · ' + t('បង្ហាញ ', 'showing ') + res.items.length : ''}</p>
          {res.items.map(x => (
            <a key={x.dn} href={dnHref(x.dn)} className="card block no-underline text-ink !p-3.5">
              <div className="flex justify-between gap-2 items-start">
                <div className="min-w-0"><b className="text-[16px]">{x.dn}</b><div className="muted text-[13px] truncate">{x.cust}</div></div>
                <Badge k={x.status} label={boot.dnStatuses[x.status]} />
              </div>
              <div className="text-[13px] mt-1 flex flex-wrap gap-x-3">
                <span>📅 {x.date ? fmtDate(Date.parse(x.date + 'T12:00:00+07:00')) : '–'}</span>
                {x.planKg ? <span>{fmtKg(x.kg)} / {fmtKg(x.planKg)}</span> : x.kg ? <span>{fmtKg(x.kg)}</span> : null}
                {x.trips.map(tr => <span key={tr.id} className="muted">{tr.plate} {tr.id}</span>)}
              </div>
            </a>
          ))}
        </>
      )}
      {scan ? <Scanner onClose={() => setScan(false)} onCode={c => { setScan(false); go('/dn/' + encodeURIComponent(c.replace(/\s/g, '').toUpperCase())); }} /> : null}
    </main>
  );
}

export function DnPage(p: { dn: string }) {
  useLang();
  const { boot, tick, setBusy } = useApp();
  const [d, setD] = useState<DnInfo | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    setErr(''); setD(null); setBusy(true);
    api<DnInfo>('dn', { dn: p.dn })
      .then(x => { if (live) setD(x); })
      .catch(e => { if (live) setErr(errText(e.message)); })
      .finally(() => setBusy(false));
    return () => { live = false; };
  }, [p.dn, tick]);
  if (err) return <main className="max-w-2xl mx-auto p-4"><Alert tone="bad">{err}</Alert></main>;
  if (!d) return <Spinner />;
  const pl = d.plan;
  const pct = d.planKg ? Math.min(100, Math.round((d.kg / d.planKg) * 100)) : 0;
  return (
    <main className="max-w-2xl mx-auto p-3 sm:p-4">
      <section className="card">
        <div className="flex justify-between items-start gap-2 mb-1">
          <div><div className="muted text-[13px]">DN</div><div className="text-[22px] font-bold">{d.dn}</div></div>
          <Badge k={d.status} label={boot.dnStatuses[d.status]} />
        </div>
        {!pl && !d.legs.length ? <Alert tone="warn">{t('រកមិនឃើញ DN នេះក្នុង Delivery Plan ឬ Time Log ទេ។', 'This DN is not in Delivery Plan or Time Log.')}</Alert> : null}
        {pl ? (
          <>
            <Kv k={t('អតិថិជន', 'Customer')} v={(pl.custId ? pl.custId + ' · ' : '') + pl.custName} />
            <Kv k="SO" v={pl.so || '–'} />
            <Kv k={t('ផែនការ', 'Plan')} v={[pl.date, pl.plate, pl.round, pl.sched].filter(Boolean).join(' · ')} />
          </>
        ) : null}
        <Kv k={t('ទំងន់ប្រគល់', 'Delivered weight')} v={d.planKg ? fmtKg(d.kg) + ' / ' + fmtKg(d.planKg) : fmtKg(d.kg)} />
        {d.planKg && d.kg ? <div className="h-2 rounded-full bg-soft mt-2 overflow-hidden"><div className="h-full bg-ok" style={{ width: pct + '%' }} /></div> : null}
      </section>
      {d.legs.length ? (
        <section className="card">
          <h2 className="text-[15px] font-bold mt-0 mb-2">{t('ជើងដឹកដែលដឹក DN នេះ', 'Trips that carried this DN')}</h2>
          {d.legs.map(l => (
            <a key={l.tripId} href={tripHref(l.tripId)} className="flex justify-between items-center gap-2 py-2 border-b border-line last:border-0 no-underline text-ink">
              <span><b>{l.plate}</b> <span className="muted text-[13px]">{l.tripId}</span><span className="block muted text-[13px]">{fmtDateTime(l.time)}{l.kg ? ' · ' + fmtKg(l.kg) : ''}{l.leg === 'delivered' && !l.final ? ' · ' + t('មួយផ្នែក', 'part') : ''}</span></span>
              <Badge k={l.leg} label={boot.legs[l.leg]} />
            </a>
          ))}
        </section>
      ) : null}
      {d.rows && d.rows.length ? (
        <section className="card">
          <h2 className="text-[15px] font-bold mt-0 mb-2">{t('ប្រវត្តិជំហាន', 'Timeline')}</h2>
          {d.rows.map(r => (
            <div key={r.row} className="py-1.5 border-b border-line last:border-0 text-[14px]">
              <div className="flex justify-between gap-2"><b>{eventLabel(boot, r)}</b><span className="whitespace-nowrap">{fmtDateTime(r.time)}</span></div>
              <div className="muted text-[13px]">{[r.plate, r.trip, r.kg ? fmtKg(r.kg) : '', r.user].filter(Boolean).join(' · ')}{r.remark ? ' · 💬 ' + r.remark : ''}</div>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
