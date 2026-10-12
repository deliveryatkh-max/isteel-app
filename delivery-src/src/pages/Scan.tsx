import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { errText, kg as fmtKg, L, t, useLang } from '../i18n';
import { dnHref, go, openTrips, tripHref, useApp } from '../state';
import type { DnInfo, TripSummary } from '../types';
import { Alert, Badge, Spinner } from '../components/ui';
import { ScanView } from '../components/Scanner';
import { STEP_LOOK } from '../components/Form';
import { nextCode } from './Record';

const DONE_LEGS = ['delivered', 'failed', 'canceled', 'moved'];
const cleanDn = (s: string) => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[^0-9A-Z-]/g, '');
const AUTO_MS = 2000;   // Kim, 12 Oct 2026: the next step opens by itself after 2 s

type Found =
  | { kind: 'trip'; dn: string; trip: TripSummary; code: number; others: number[] }
  | { kind: 'noStep'; dn: string; trip: TripSummary }
  | { kind: 'plan'; dn: string; trips: TripSummary[] }
  | { kind: 'server'; dn: string; info: DnInfo | null }
  | { kind: 'bad'; dn: string };

/** The record link for a step on a trip, with the scanned DN already chosen. */
export const stepHref = (tripId: string, code: number, dn: string) =>
  '/record?trip=' + encodeURIComponent(tripId) + '&code=' + code + '&dn=' + encodeURIComponent(dn) + '&from=scan';

/**
 * DN scan: one clean screen. The DN is looked up on the phone (open trips and plan are already loaded),
 * so the next step shows at once; only a DN that is on no open trip asks the server.
 */
export function ScanPage(p: { dn?: string }) {
  useLang();
  const { boot, ops, refreshOps } = useApp();
  const mine = useMemo(() => boot.events.filter(e => e.can).map(e => e.code), [boot.events]);
  const [dn, setDn] = useState(p.dn ? cleanDn(p.dn) : '');
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [left, setLeft] = useState(0);   // ms until the next step opens; 0 = stopped

  const [stayed, setStayed] = useState(false);
  const [choices, setChoices] = useState<string[]>([]);
  // Typing only part of a DN (e.g. the last 4 digits) is enough (Kim, 12 Oct 2026).
  const findTyped = () => {
    const q = cleanDn(typed);
    if (!q) return;
    const all: Record<string, 1> = {};
    openTrips(ops).forEach(x => x.dns.forEach(z => { all[z.dn] = 1; }));
    boot.plan.forEach(x => { if (x.dn) all[x.dn] = 1; });
    const hits = Object.keys(all).filter(d => d.indexOf(q) >= 0);
    if (hits.indexOf(q) >= 0 || (!hits.length && q.length >= 8)) setDn(q);
    else if (hits.length === 1) setDn(hits[0]);
    else if (hits.length) setChoices(hits.sort((a, b) => Number(b.endsWith(q)) - Number(a.endsWith(q)) || a.localeCompare(b)).slice(0, 12));
    else go('/dn?q=' + encodeURIComponent(q));   // not on an open trip or today's plan: search every DN
  };
  const asked = useRef(0);
  // Trips are read fresh when the screen opens (another phone may have just added the DN); the answer updates if they change.
  useEffect(() => { refreshOps(); }, []);
  useEffect(() => { if (dn) look(dn); }, [dn, ops]);

  function stepFor(trip: TripSummary, d: string): { code: number; others: number[] } | null {
    const leg = (trip.dns.find(x => x.dn === d) || { leg: '' }).leg;
    let want: number[];
    if (trip.gateOut) want = leg === 'at_customer' ? [9, 11, 8] : [8, 9, 11];
    else {
      let n = nextCode(trip);
      if (n === 2) n = 3;   // the DN is already on the trip: Arrival-Pickup DN is done for it
      want = [n].concat([3, 4, 5, 6, 7].filter(c => c > n));
    }
    const ok = want.filter(c => mine.indexOf(c) >= 0);
    return ok.length ? { code: ok[0], others: ok.slice(1, 3) } : null;
  }

  async function look(d: string) {
    if (!ops) return;   // trips not loaded yet: looked up as soon as they are
    setErr('');
    if (!/^[0-9A-Z-]{4,20}$/.test(d)) { setLeft(0); setFound({ kind: 'bad', dn: d }); return; }
    const trips = openTrips(ops).filter(x => x.dns.some(z => z.dn === d && DONE_LEGS.indexOf(z.leg) < 0));
    if (trips.length) {
      // A split DN can be open on two trips: the newest trip where this user has a step wins.
      trips.sort((a, b) => (b.gateIn || 0) - (a.gateIn || 0) || b.id.localeCompare(a.id));
      for (const trip of trips) {
        const s = stepFor(trip, d);
        if (s) {
          asked.current++;
          const same = found && found.kind === 'trip' && found.dn === d && found.trip.id === trip.id && found.code === s.code;
          setFound({ kind: 'trip', dn: d, trip, code: s.code, others: s.others });
          if (!same && !stayed) setLeft(AUTO_MS);
          return;
        }
      }
      setLeft(0); setFound({ kind: 'noStep', dn: d, trip: trips[0] });
      return;
    }
    const plan = boot.plan.find(x => x.dn === d);
    if (plan && mine.indexOf(2) >= 0) {
      const open = openTrips(ops).filter(x => !x.gateOut);
      const sorted = open.sort((a, b) => Number(b.plate === plan.plate) - Number(a.plate === plan.plate) || b.lastTime - a.lastTime);
      setLeft(0); setFound({ kind: 'plan', dn: d, trips: sorted });
      return;
    }
    setLeft(0);
    if (found && found.kind === 'server' && found.dn === d) return;
    // Not on an open trip on this phone: ask the server (finished DN, or a DN from an older plan).
    setLoading(true);
    const ask = ++asked.current;   // only the latest question's answer is shown
    try { const info = await api<DnInfo>('dn', { dn: d }); if (ask === asked.current) setFound({ kind: 'server', dn: d, info }); }
    catch (e: any) { if (ask === asked.current) { setErr(errText(e.message)); setFound({ kind: 'server', dn: d, info: null }); } }
    finally { setLoading(false); }
  }

  // Count down, then open the next step.
  useEffect(() => {
    if (!left || !found || found.kind !== 'trip') return;
    const id = setTimeout(() => { if (left <= 100) go(stepHref(found.trip.id, found.code, found.dn)); else setLeft(left - 100); }, 100);
    return () => clearTimeout(id);
  }, [left, found]);

  const again = () => { setDn(''); setFound(null); setTyped(''); setLeft(0); setErr(''); setStayed(false); setChoices([]); };

  if (!dn) {
    return (
      <main className="max-w-xl mx-auto p-3 sm:p-4 grid gap-3">
        <ScanView tall onCode={c => setDn(cleanDn(c.replace(/^.*\/scan\//, '')))} />
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); findTyped(); }}>
          <input className="in flex-1" inputMode="numeric" value={typed} onChange={e => { setTyped(e.target.value); setChoices([]); }} placeholder={'⌨️ ' + t('វាយលេខ DN ឬ ៤ ខ្ទង់ចុងក្រោយ', 'DN number or its last 4 digits')} aria-label="DN" />
          <button type="submit" className="btn-primary" disabled={!typed.trim()}>{t('រក', 'Find')}</button>
        </form>
        {choices.length ? (
          <section className="card !p-3 grid gap-2" data-testid="dn-choices">
            <b className="text-[14px]">{t('ជ្រើស DN', 'Choose the DN')}</b>
            {choices.map(d => <button key={d} type="button" className="btn justify-start text-[16px] tracking-wide" onClick={() => setDn(d)}>📄 {d}</button>)}
          </section>
        ) : null}
        <a href="#/dn" className="btn w-full no-underline">🔍 {t('ស្វែងរក DN តាមអតិថិជន ផ្លាកលេខ ឬថ្ងៃ', 'Search DNs by customer, truck or date')}</a>
      </main>
    );
  }

  const card = (trip: TripSummary, d: string) => {
    const z = trip.dns.find(x => x.dn === d);
    const pl = boot.plan.find(x => x.dn === d);
    return (
      <section className="card grid gap-1">
        <div className="flex items-center justify-between gap-2"><b className="text-[19px] tracking-wide">📄 {d}</b><Badge k={trip.stage} label={boot.stages[trip.stage]} /></div>
        {z ? <div className="text-[14px]">🏢 {z.cust}</div> : null}
        <div className="text-[14px]">🚚 {trip.plate} · {trip.round} · <a href={tripHref(trip.id)}>{trip.id}</a></div>
        {pl && pl.kg ? <div className="muted text-[13px]">⚖️ {t('ផែនការ', 'Plan')} {fmtKg(pl.kg)}</div> : null}
      </section>
    );
  };

  return (
    <main className="max-w-xl mx-auto p-3 sm:p-4 grid gap-3">
      {loading ? <Spinner /> : null}
      {err ? <Alert tone="bad">{err}</Alert> : null}

      {found && found.kind === 'trip' ? (() => {
        const lk = STEP_LOOK[found.code];
        const ev = boot.events.find(e => e.code === found.code);
        return (
          <>
            {card(found.trip, found.dn)}
            <section className="rounded-2xl border-2 p-3 grid gap-2" style={{ borderColor: lk.color, background: lk.color + '14' }}>
              <span className="font-bold text-[13.5px]" style={{ color: lk.color }}>{t('ជំហានបន្ទាប់', 'Next step')}</span>
              <button type="button" data-testid="scan-next" className="btn w-full text-[17px] font-bold text-white border-0 min-h-[54px]" style={{ background: lk.color }}
                onClick={() => go(stepHref(found.trip.id, found.code, found.dn))}>{lk.icon} {L(ev)}</button>
              {left ? (
                <>
                  <div className="h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full" style={{ width: (100 - (left / AUTO_MS) * 100) + '%', background: lk.color }} /></div>
                  <span className="muted text-[13px]">{t('បើកក្នុង ' + Math.ceil(left / 1000) + ' វិនាទី…', 'Opening in ' + Math.ceil(left / 1000) + ' s…')}</span>
                </>
              ) : null}
            </section>
            {left ? <button type="button" className="btn" onClick={() => { setLeft(0); setStayed(true); }}>✕ {t('ឈប់នៅទីនេះ', 'Stay here')}</button> : null}
            {found.others.length ? (
              <div className="flex flex-wrap gap-2 items-center"><span className="muted text-[13px]">{t('ជំហានផ្សេង:', 'Other steps:')}</span>
                {found.others.map(c => <a key={c} className="chip no-underline" href={'#' + stepHref(found.trip.id, c, found.dn)}>{STEP_LOOK[c].icon} {L(boot.events.find(e => e.code === c))}</a>)}
              </div>
            ) : null}
          </>
        );
      })() : null}

      {found && found.kind === 'noStep' ? (
        <>
          {card(found.trip, found.dn)}
          <Alert tone="info">{t('តួនាទីរបស់អ្នកមិនមានជំហានបន្ទាប់សម្រាប់ DN នេះទេ។', 'Your role has no next step for this DN.')}</Alert>
          <a className="btn no-underline" href={tripHref(found.trip.id)}>🚚 {t('មើលជើងដឹក', 'Open trip')}</a>
        </>
      ) : null}

      {found && found.kind === 'plan' ? (
        <>
          <section className="card grid gap-1" style={{ borderColor: '#c77700' }}>
            <div className="flex items-center justify-between gap-2"><b className="text-[19px]">📄 {found.dn}</b><span className="rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold bg-warnsoft text-warn">{t('មិនទាន់នៅលើជើងដឹក', 'Not on a trip yet')}</span></div>
            {(() => { const pl = boot.plan.find(x => x.dn === found.dn)!; return <div className="text-[14px]">🏢 {pl.custName}{pl.plate ? ' · ' + t('ផែនការ', 'plan') + ' ' + pl.plate : ''}{pl.kg ? ' · ' + fmtKg(pl.kg) : ''}</div>; })()}
          </section>
          <section className="card grid gap-2">
            <b className="text-[14.5px]">📋 {t('ដាក់លើជើងដឹក (ដល់កន្លែងចែកបុង)', 'Put it on a trip (Arrival-Pickup DN)')}</b>
            {!found.trips.length ? <p className="muted text-sm m-0">{t('មិនមានឡាននៅក្នុងរោងចក្រទេ។ ចូលថ្លឹងជាមុនសិន។', 'No truck is inside the plant. Record Gate In first.')}</p> : null}
            {found.trips.map((x, i) => (
              <a key={x.id} className={'btn no-underline justify-between ' + (i === 0 && x.plate === (boot.plan.find(y => y.dn === found.dn) || { plate: '' }).plate ? '!border-accent' : '')} href={'#' + stepHref(x.id, 2, found.dn)}>
                <span>🚛 {x.plate} · {x.id}</span>{x.plate === (boot.plan.find(y => y.dn === found.dn) || { plate: '' }).plate ? <span className="text-accent text-[12.5px]">{t('ផែនការ', 'plan')}</span> : null}
              </a>
            ))}
          </section>
        </>
      ) : null}

      {found && found.kind === 'server' && found.info ? (
        <section className="card grid gap-2">
          <div className="flex items-center justify-between gap-2"><b className="text-[19px]">📄 {found.dn}</b><Badge k={found.info.status} label={boot.dnStatuses[found.info.status]} /></div>
          {found.info.legs.length ? <span className="muted text-[13.5px]">{t('DN នេះមិនមានជំហានបើកទេ។', 'This DN has no open step.')}</span>
            : found.info.plan ? <span className="muted text-[13.5px]">{t('DN នេះនៅក្នុងផែនការ តែមិនទាន់នៅលើជើងដឹក។', 'This DN is in the plan but not on a trip yet.')}</span>
            : <span className="text-bad font-semibold">⛔ {t('រកមិនឃើញ DN នេះនៅលើជើងដឹក ឬក្នុងផែនការទេ។ សូមពិនិត្យលេខ។', 'This DN is not on any trip or in the plan. Check the number.')}</span>}
          <a className="btn no-underline" href={dnHref(found.dn)}>📄 {t('មើល DN', 'Open DN')}</a>
        </section>
      ) : null}

      {found && found.kind === 'bad' ? <Alert tone="bad">⛔ {t('"' + found.dn + '" មិនមែនជាលេខ DN ទេ។', '"' + found.dn + '" is not a DN number.')}</Alert> : null}

      <button type="button" className="btn-primary w-full text-[16px] min-h-[50px]" onClick={() => { again(); go('/scan'); }}>📷 {t('ស្កេនម្តងទៀត', 'Scan again')}</button>
    </main>
  );
}
