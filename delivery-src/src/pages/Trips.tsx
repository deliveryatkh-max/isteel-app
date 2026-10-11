import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { errText, L, t, useLang, ymdNow, ymdOf } from '../i18n';
import { go, openTrips, useApp, useRoute } from '../state';
import type { TripSummary } from '../types';
import { TripCard } from '../components/TripCard';
import { Alert, Segmented, Spinner } from '../components/ui';

/** Active trips (live, grouped by step) and Trip History (any dates). */
export function TripsPage() {
  useLang();
  const route = useRoute();
  const view = route.path[1] === 'history' ? 'history' : 'active';
  return (
    <main className="max-w-3xl mx-auto p-3 sm:p-4">
      <div className="mb-3"><Segmented value={view} onChange={v => go(v === 'history' ? '/trips/history' : '/trips')} options={[{ v: 'active', km: 'កំពុងដំណើរការ', en: 'Active trips' }, { v: 'history', km: 'ប្រវត្តិជើងដឹក', en: 'Trip history' }]} /></div>
      {view === 'active' ? <Active /> : <History />}
    </main>
  );
}

const ORDER = ['waiting', 'at_pickup', 'departed_pickup', 'at_loading', 'loading', 'loaded', 'on_delivery', 'at_customer'];
function Active() {
  const { boot, ops } = useApp();
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = openTrips(ops).filter(x => !s || [x.id, x.plate, x.driver, x.dns.map(d => d.dn + ' ' + d.cust).join(' ')].join(' ').toLowerCase().indexOf(s) >= 0);
    return ORDER.map(k => ({ k, trips: list.filter(x => x.stage === k) })).filter(g => g.trips.length);
  }, [ops, q]);
  if (!ops) return <Spinner />;
  return (
    <>
      <input className="in mb-3" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('ស្វែងរក ផ្លាកលេខ ជើងដឹក DN…', 'Search plate, trip, DN…')} />
      {!groups.length ? <p className="muted text-center py-6">{t('មិនមានជើងដឹកកំពុងដំណើរការ', 'No active trips')}</p> : null}
      {groups.map(g => (
        <section key={g.k}>
          <h2 className="text-[14.5px] font-bold mb-2 mt-1">{L(boot.stages[g.k])} <span className="muted font-normal">· {g.trips.length}</span></h2>
          {g.trips.map(x => <TripCard key={x.id} trip={x} />)}
        </section>
      ))}
    </>
  );
}

function History() {
  const { boot, tick, setBusy } = useApp();
  const [from, setFrom] = useState(() => ymdOf(Date.now() - 6 * 86400000));
  const [to, setTo] = useState(ymdNow);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [res, setRes] = useState<{ total: number; items: TripSummary[] } | null>(null);
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(''); setBusy(true);
    api('history', { from, to, q, stage })
      .then(r => { if (live) setRes(r); })
      .catch(e => { if (live) setErr(errText(e.message)); })
      .finally(() => setBusy(false));
    return () => { live = false; };
  }, [from, to, stage, n, tick]);
  return (
    <>
      <div className="card !p-3 grid grid-cols-2 gap-2">
        <label className="text-[13px] muted">{t('ពីថ្ងៃ', 'From')}<input className="in" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-[13px] muted">{t('ដល់ថ្ងៃ', 'To')}<input className="in" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
        <input className="in col-span-2" type="search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setN(n + 1); }} placeholder={t('ផ្លាកលេខ ជើងដឹក តៃកុង DN អតិថិជន', 'Plate, trip, driver, DN, customer')} />
        <select className="in" value={stage} onChange={e => setStage(e.target.value)} aria-label={t('ស្ថានភាព', 'Status')}>
          <option value="">{t('គ្រប់ស្ថានភាព', 'All statuses')}</option>
          <option value="closed">{t('បានបិទ', 'Closed')}</option>
          {Object.keys(boot.stages).map(k => <option key={k} value={k}>{L(boot.stages[k])}</option>)}
        </select>
        <button type="button" className="btn-primary" onClick={() => setN(n + 1)}>🔍 {t('ស្វែងរក', 'Search')}</button>
      </div>
      {err ? <Alert tone="bad">{err}</Alert> : null}
      {!res ? <Spinner /> : (
        <>
          <p className="muted text-[13px]">{res.total} {t('ជើងដឹក', 'trips')}{res.total > res.items.length ? ' · ' + t('បង្ហាញ ', 'showing ') + res.items.length : ''}</p>
          {res.items.map(x => <TripCard key={x.id} trip={x} showDate />)}
        </>
      )}
    </>
  );
}
