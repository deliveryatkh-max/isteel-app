import { Fragment, useContext, useEffect, useMemo, useState } from 'react';
import { api, store } from '../api';
import { errText, fmtDateTime, fmtTime, kg as fmtKg, L, t, useLang } from '../i18n';
import { AppCtx, go, openTrips, useApp } from '../state';
import type { Label, TripDetail, TripSummary } from '../types';
import { Alert, Badge, Modal, Opt, PhotoInput, Picker, Segmented, Spinner, toast } from '../components/ui';
import { Field, Section, scrollToMissing } from '../components/Form';
import { MultiPhoto, RateLinks, SignaturePad, SiteRateForm, siteRateSigned } from '../components/Proof';
import { TripSections } from './Trip';
import { GpsShare } from '../components/Track';
import { beep, ScanView, Scanner } from '../components/Scanner';
import { useSubmit, warmLocation } from '../components/submit';

/**
 * Kim's 9-step flow (20 Nov 2026). Gate In and Gate Out come from the Truck Scale.
 * Warehouse: 2 Arrival at loading area (warehouse), 3 Start Loading (DNs), 4 End Loading (total kg, photos, websling); 3–4 repeat per warehouse.
 * Driver: scans a DN to open only their own truck; 6 Arrival, 7 Start unloading, 8 Finish unloading, 9 Delivered / Failed / Canceled, per DN.
 */
const cleanDn = (s: string) => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[^0-9A-Z-]/g, '');
const DONE = ['delivered', 'failed', 'canceled', 'moved'];
const MODE_KEY = 'dlv_steps_mode';
type Mode = 'wh' | 'drv';

export const STEP_NAMES: Record<number, [string, string]> = {
  1: ['ចូលថ្លឹង (ជញ្ជីង)', 'Gate In (scale)'], 2: ['ដល់កន្លែងឡើងទំនិញ', 'Arrival at loading area'], 3: ['ចាប់ផ្តើមឡើងទំនិញ', 'Start loading'],
  4: ['ឡើងទំនិញរួចរាល់', 'End loading'], 5: ['ចេញពីជញ្ជីង', 'Gate Out (scale)'], 6: ['មកដល់ទីតាំងទំលាក់', 'Arrival at destination'],
  7: ['ចាប់ផ្តើមទំលាក់ទំនិញ', 'Start unloading'], 8: ['ទំលាក់ទំនិញរួចរាល់', 'Finish unloading'], 9: ['ប្រគល់ / បរាជ័យ / លុបចោល', 'Delivered / Failed / Canceled'],
};
const stepName = (n: number) => n + '. ' + t(...STEP_NAMES[n]);

/** Last loading step done at the current warehouse (4, 5, 6) or 0. Works with the old script too. */
export const lastLoadOf = (x: TripSummary) => (x.lastLoad != null ? x.lastLoad : [4, 5, 6].indexOf(x.lastCode) >= 0 ? x.lastCode : 0);
/** Driver step (6–9) for a DN, from its leg. 0 = done. */
export const drvStepOf = (leg: string) => (DONE.indexOf(leg) >= 0 ? 0 : leg === 'at_customer' ? 7 : leg === 'unloading' ? 8 : leg === 'unloaded' ? 9 : 6);

/** Steps done on the 9-step bar (0–9): warehouse steps until Gate Out, then the least advanced DN. */
export function tripDone(trip: TripSummary): number {
  if (trip.closed) return 9;
  if (!trip.gateOut) { const ll = lastLoadOf(trip); return ll === 6 ? 4 : ll === 5 ? 3 : ll === 4 ? 2 : trip.gateIn ? 1 : 0; }
  const open = trip.dns.filter(d => d.leg !== 'canceled' && drvStepOf(d.leg));
  return open.length ? Math.min(...open.map(d => drvStepOf(d.leg))) - 1 : 9;
}
/** The 9-step tracker (Kim, 24 Nov 2026): green ticks = done, pulsing dot = next step, hollow = later. */
export function StepBar(p: { done: number }) {
  return (
    <div className="flex items-center mt-3" data-bar={p.done}>
      {Array.from({ length: 9 }, (_, i) => (
        <Fragment key={i}>
          {i ? <i className="flex-1 h-[2px]" style={{ background: i <= p.done ? 'var(--ok)' : 'var(--line)' }} /> : null}
          <span className={'stepdot' + (i < p.done ? ' done' : i === p.done ? ' now' : '')} title={stepName(i + 1)}>
            {i < p.done ? <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 6.2l2.2 2.2 4.8-4.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : i === p.done ? <b /> : null}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
const OFFICE = ['admin', 'supervisor', 'logistics', 'security'];

export function useStepsMode(): [Mode, ((m: Mode) => void) | null] {
  const { boot } = useApp();
  const k = boot.user.roleKey;
  const fixed: Mode | null = k === 'driver' ? 'drv' : k === 'warehouse' ? 'wh' : null;
  const [m, setM] = useState<Mode>(() => (store.get(MODE_KEY) === 'drv' ? 'drv' : 'wh'));
  if (fixed) return [fixed, null];
  return [m, (v: Mode) => { setM(v); store.set(MODE_KEY, v); }];
}

export function StepsPage(p: { tripId?: string; dn?: string }) {
  useLang();
  const { boot, refreshOps } = useApp();
  const [mode, setMode] = useStepsMode();
  useEffect(() => { refreshOps(); warmLocation(); }, []);
  if (!boot.flow) {
    return (
      <main className="max-w-2xl mx-auto p-4">
        <Alert tone="warn">{t('ជំហានថ្មីត្រូវការ Apps Script ថ្មី។ សូមឲ្យអ្នកគ្រប់គ្រងបិទភ្ជាប់ Logic.gs និង Delivery.gs ហើយ Deploy New version។', 'The new steps need the new Apps Script. Ask the admin to re-paste Logic.gs and Delivery.gs and deploy a New version.')}</Alert>
        <a className="btn no-underline" href="#/record?old=1">➕ {t('ទម្រង់ចាស់', 'Old form')}</a>
      </main>
    );
  }
  return (
    <main className="max-w-2xl mx-auto p-3 sm:p-4 space-y-3">
      {setMode ? (
        <Segmented value={mode} onChange={v => { setMode(v); if (p.tripId) go('/steps'); }}
          options={[{ v: 'wh', km: '🏭 ឃ្លាំង', en: '🏭 Warehouse' }, { v: 'drv', km: '🚚 តៃកុង', en: '🚚 Driver' }]} />
      ) : null}
      {p.tripId ? <TruckSteps key={p.tripId + mode} id={p.tripId} mode={mode} dn={p.dn} />
        : mode === 'wh' ? <WarehouseList /> : <DriverScan />}
    </main>
  );
}

/** Warehouse: trucks that came in at the scale and have not gone out yet. */
function WarehouseList() {
  const { ops } = useApp();
  if (!ops) return <Spinner />;
  const list = openTrips(ops).filter(x => x.gateIn && !x.gateOut).sort((a, b) => (b.gateIn || 0) - (a.gateIn || 0));
  return (
    <>
      <h2 className="text-base font-bold m-0">{t('ឡាននៅក្នុងរោងចក្រ', 'Trucks inside')} ({list.length})</h2>
      {!list.length ? <Alert tone="info">{t('គ្មានឡាននៅក្នុងទេ។ ឡានចូលពេលថ្លឹងលើកទី១។', 'No truck inside. A truck comes in at the 1st weigh.')}</Alert> : null}
      {list.map(x => {
        const ll = lastLoadOf(x);
        const n = ll === 0 ? 2 : ll === 4 ? 3 : ll === 5 ? 4 : 5;
        return (
          <button key={x.id} type="button" className="card w-full text-left flex items-center gap-3 cursor-pointer" onClick={() => go('/steps/' + encodeURIComponent(x.id))}>
            {/* Kim's W1 A (23 Nov 2026): plate, time in, one status chip. */}
            <span className="flex-1 min-w-0">
              <b className="block text-[20px] font-extrabold tracking-wide">{x.plate}</b>
              <small className="muted">{t('ចូល ', 'In ') + fmtTime(x.gateIn)}</small>
            </span>
            <span className={'text-[12.5px] font-bold rounded-full px-2.5 py-1 whitespace-nowrap ' + (n === 5 ? 'bg-oksoft text-ok' : 'bg-warnsoft text-warn')}>{n === 5 ? t('រង់ចាំថ្លឹងចេញ', 'Wait Gate Out') : n === 2 ? t('រង់ចាំឃ្លាំង', 'Waiting for warehouse') : t('ជំហានបន្ទាប់៖ ', 'Next step: ') + stepName(n) + (x.wh ? ' · ' + x.wh : '')}</span>
          </button>
        );
      })}
    </>
  );
}

/** Driver: scan or type a DN; only that DN's truck opens (Kim, 20 Nov 2026). */
function DriverScan() {
  const { ops } = useApp();
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function open(raw: string) {
    const d = cleanDn(raw);
    setErr('');
    if (!/^[0-9A-Z-]{4,20}$/.test(d)) { setErr(t('លេខ DN មិនត្រឹមត្រូវ', 'Not a DN number')); return; }
    const own = openTrips(ops).filter(x => x.dns.some(z => z.dn === d)).sort((a, b) => (b.gateIn || 0) - (a.gateIn || 0));
    if (own.length) { go('/steps/' + encodeURIComponent(own[0].id) + '?dn=' + d); return; }
    setBusy(true);
    try {
      const info = await api<{ openTrips: string[] }>('dn', { dn: d });
      if (info && info.openTrips && info.openTrips.length) go('/steps/' + encodeURIComponent(info.openTrips[info.openTrips.length - 1]) + '?dn=' + d);
      else setErr(t('DN ' + d + ' មិនទាន់នៅលើឡានណាមួយទេ។ ឃ្លាំងត្រូវវាយ DN ពេលឡើងទំនិញ។', 'DN ' + d + ' is not on a truck yet. The warehouse adds it at Start Loading.'));
    } catch (e: any) { setErr(errText(e.message)); }
    finally { setBusy(false); }
  }
  return (
    <>
      <Alert tone="info">{t('ស្កេន DN ដើម្បីបើកឡានរបស់អ្នក។', 'Scan a DN to open your truck.')}</Alert>
      <ScanView onCode={open} tall />
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); open(typed); }}>
        <input className="in flex-1" inputMode="numeric" placeholder={t('ឬវាយលេខ DN', 'or type the DN')} value={typed} onChange={e => setTyped(e.target.value)} />
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? '…' : t('បើក', 'Open')}</button>
      </form>
      {err ? <Alert tone="bad">{err}</Alert> : null}
    </>
  );
}

function TruckSteps(p: { id: string; mode: Mode; dn?: string }) {
  const { boot, ops, live, tick } = useApp();
  const fromOps = openTrips(ops).find(x => x.id === p.id) || null;
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [err, setErr] = useState('');
  const [hist, setHist] = useState(false);
  const [links, setLinks] = useState(false);
  const [n, setN] = useState(0);
  const [cancel, setCancel] = useState(false);
  useEffect(() => {
    let on = true;
    api<TripDetail>('trip', { tripId: p.id }).then(x => { if (on) setDetail(x); }).catch(e => { if (on && !fromOps) setErr(errText(e.message)); });
    return () => { on = false; };
  }, [p.id, live, tick, n, fromOps && fromOps.lastTime, fromOps && fromOps.dns.map(d => d.leg).join()]);
  const trip: TripSummary | null = fromOps || detail;
  if (err) return <Alert tone="bad">{err}</Alert>;
  if (!trip) return <Spinner />;
  const truckType = boot.plates.some(x => x.plate === trip.plate) ? 'isi' : 'rented';
  const office = OFFICE.indexOf(boot.user.roleKey) >= 0;
  const canCancel = !trip.closed && office && boot.events.some(e => e.code === 10 && e.can);   // drivers and warehouse see only their step
  const done = tripDone(trip), cur = Math.min(done + 1, 9);
  // Kim (24 Nov 2026): say "Next step" so the chip is not read as the current status.
  const chip = trip.closed ? L(boot.stages[trip.stage]) || trip.stage : t('ជំហានបន្ទាប់៖ ', 'Next step: ') + stepName(cur) + (!trip.gateOut && trip.wh && cur >= 3 ? ' · ' + trip.wh : '');
  return (
    <>
      {/* Kim's picks (23 Nov 2026): W2–W4 A / D1–D4 header = plate + step + bar; O1 B adds driver, times and the stops. */}
      <div className="card">
        <div className="flex items-center justify-between gap-2">
          <b className="text-[22px] font-extrabold tracking-wide">{trip.plate}</b>
          <span className="text-[12.5px] font-bold rounded-full px-2.5 py-1 bg-warnsoft text-warn text-right" data-chip="step">{chip}</span>
        </div>
        {office ? <small className="muted block">{[trip.driver, detail && detail.company, trip.round].filter(Boolean).join(' · ')}</small> : null}
        <StepBar done={done} />
        {office ? (
          <div className="flex justify-between muted text-[12px] mt-1">
            <span>⚖️ {t('ចូល', 'In')} {trip.gateIn ? fmtTime(trip.gateIn) : '–'}</span>
            <span>⚖️ {t('ចេញ', 'Out')} {trip.gateOut ? fmtTime(trip.gateOut) : '–'}</span>
            <span>{trip.id}</span>
          </div>
        ) : null}
      </div>
      {office && trip.dns.length ? <StopsCard trip={trip} /> : null}
      {trip.closed ? <Alert tone="ok">✅ {t('ជើងដឹកនេះបានបញ្ចប់', 'This trip is finished')}</Alert>
        : p.mode === 'wh' ? <WarehouseStep trip={trip} truckType={truckType} />
        : <DriverSteps trip={trip} truckType={truckType} dn={p.dn} sites={detail ? detail.sites : undefined} />}
      {office && detail ? (
        <div className="grid gap-2">
          <button type="button" className="btn w-full" onClick={() => setLinks(!links)}>🔗 {t('តំណតៃកុង / អតិថិជន', 'Driver / customer links')}</button>
          {links ? <TripSections d={detail} reload={() => setN(n + 1)} show="links" /> : null}
          <button type="button" className="btn w-full" onClick={() => setHist(!hist)}>🕒 {t('ប្រវត្តិ · រូបថត · ភស្តុតាង', 'History · photos · proof')}</button>
          {hist ? <TripSections d={detail} reload={() => setN(n + 1)} show="history" /> : null}
          {canCancel ? <button type="button" className="btn w-full !text-bad" onClick={() => setCancel(true)}>🚫 {t('លុបចោលជើងដឹក', 'Cancel trip')}</button> : null}
        </div>
      ) : null}
      {cancel ? <CancelTrip trip={trip} truckType={truckType} onClose={() => setCancel(false)} onDone={() => { setCancel(false); setN(n + 1); }} /> : null}
    </>
  );
}

/** Office (O1 B): DNs grouped by customer = stops, each DN ticked when delivered. */
function StopsCard(p: { trip: TripSummary }) {
  const stops = groupStops(p.trip.dns.filter(d => d.leg !== 'canceled'), false);
  return (
    <div className="card grid gap-2" data-stops={stops.length}>
      {stops.map(sp => (
        <div key={sp.key}>
          <div className="flex justify-between gap-2"><b>📍 {sp.cust ? sp.cust.replace(/^\s*\d+\s*-\s*/, '') : 'DN ' + sp.dns[0].dn}</b><span className="muted text-[12.5px] whitespace-nowrap">{sp.dns.length} DN{sp.kg ? ' · ' + fmtKg(sp.kg) : ''}</span></div>
          <div className="flex flex-wrap gap-1.5 mt-1">{sp.dns.map(d => <span key={d.dn} className={'text-[12.5px] font-bold rounded-md px-2 py-0.5 ' + (d.leg === 'delivered' ? 'bg-oksoft text-ok' : d.leg === 'failed' ? 'bg-badsoft text-bad' : 'bg-soft text-brand')}>{d.dn}{d.leg === 'delivered' ? ' ✓' : d.leg === 'failed' ? ' ✗' : ''}</span>)}</div>
        </div>
      ))}
    </div>
  );
}

/** DNs to the same customer = one stop (Kim, 23 Nov 2026). byStep: also split by the driver step, so a stop records together. */
type Stop = { key: string; cust: string; step: number; dns: TripSummary['dns']; kg: number };
function groupStops(dns: TripSummary['dns'], byStep: boolean): Stop[] {
  const out: Stop[] = [];
  dns.forEach(d => {
    const step = drvStepOf(d.leg);
    const key = (d.cust || 'dn:' + d.dn) + (byStep ? '|' + step : '');
    let g = out.find(x => x.key === key);
    if (!g) { g = { key, cust: d.cust, step, dns: [], kg: 0 }; out.push(g); }
    g.dns.push(d);
    g.kg += Number(d.kg || d.loadKg || 0);
  });
  return out;
}

/** Cancel the whole trip with the reason (old form's Cancel, Kim 22 Nov 2026). */
function CancelTrip(p: { trip: TripSummary; truckType: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const st = useStep();
  const bad = reason.trim().length < 3;
  async function go() {
    setTried(true);
    if (bad) return;
    const ok = await st.save({ tripId: p.trip.id, truckType: p.truckType, code: 10, remark: reason.trim() }, t('លុបចោលជើងដឹក', 'Cancel trip') + ' · ' + p.trip.plate);
    if (ok) p.onDone();
  }
  return (
    <Modal title={'🚫 ' + t('លុបចោលជើងដឹក', 'Cancel trip')} onClose={p.onClose}>
      {st.dialog}
      <p className="mt-0">{p.trip.plate} · {p.trip.id}</p>
      <Field icon="📝" label={t('មូលហេតុ', 'Reason')} required need={bad} error={tried && bad ? t('សូមសរសេរមូលហេតុ', 'Write the reason') : ''} id="creason">
        <textarea className={'in min-h-[64px] ' + (tried && bad ? '!border-bad' : '')} value={reason} onChange={e => setReason(e.target.value)} />
      </Field>
      {st.error ? <Alert tone="bad">{st.error}</Alert> : null}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn" onClick={p.onClose}>{t('ត្រលប់', 'Back')}</button>
        <button type="button" className="btn !bg-bad !border-bad !text-white" disabled={st.saving} onClick={go}>{st.saving ? '…' : '🚫 ' + t('លុបចោល', 'Cancel trip')}</button>
      </div>
    </Modal>
  );
}

/** Saves one step; returns the server answer ({} when kept on the phone to send later), or null when it was not saved. */
function useStep(link?: { t: string; k: string }, onSaved?: () => void) {
  const app = useContext(AppCtx);   // missing on the driver link page (no sign-in)
  const sub = useSubmit(link ? 'drvRecord' : 'record');
  const [saving, setSaving] = useState(false);
  async function save(payload: any, label: string): Promise<any> {
    setSaving(true);
    try {
      const r = await sub.send(Object.assign({ v2: true }, payload, link || {}), label);
      if (r.ok || ('queued' in r && r.queued)) { toast('✅ ' + t('បានកត់ត្រា', 'Recorded') + ': ' + label); if (app) app.refreshOps(); else if (onSaved) onSaved(); return r.ok ? r.data || {} : {}; }
      return null;
    } finally { setSaving(false); }
  }
  return { save, saving, error: sub.error, dialog: sub.dialog };
}

function WarehouseStep(p: { trip: TripSummary; truckType: string }) {
  const { boot, ops } = useApp();
  const trip = p.trip;
  const ll = lastLoadOf(trip);
  const [again, setAgain] = useState(false);
  const [done, setDone] = useState(false);
  const [wh, setWh] = useState('');
  const [dns, setDns] = useState<string[]>([]);
  const [dnIn, setDnIn] = useState('');
  const [dnErr, setDnErr] = useState('');
  // Kim (23 Nov 2026): a DN not in the Delivery Plan gets its customer here (for the live map and the customer's Telegram).
  const [custs, setCusts] = useState<Record<string, { custId: string; custName: string }>>({});
  const [kgIn, setKgIn] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [websling, setWebsling] = useState<'' | 'yes' | 'no'>('');
  const [scan, setScan] = useState(false);
  const [tried, setTried] = useState(false);
  const st = useStep();
  const whOpts: Opt[] = useMemo(() => boot.warehouses.map(w => ({ value: w, label: w, sub: (boot.whNames || {})[w] || undefined })), [boot.warehouses]);
  const custOpts: Opt[] = useMemo(() => boot.customers.map(c => ({ value: c.id + '-' + c.name, label: c.name, sub: c.id })), [boot.customers]);
  const [planHit, setPlanHit] = useState<Record<string, boolean>>({});   // older plan rows found by the DN lookup
  const planSet = useMemo(() => new Set(boot.plan.map(x => x.dn)), [boot.plan]);
  const inPlan = { has: (d: string) => planSet.has(d) || !!planHit[d] };
  const splitCust = (c: string) => { const m = /^\s*(\d{6,})\s*-\s*(.*)$/.exec(c || ''); return m ? { custId: m[1], custName: m[2] } : { custId: '', custName: (c || '').trim() }; };
  useEffect(() => { setTried(false); setCusts({}); setWh(''); setDns([]); setKgIn(''); setPhotos([]); setWebsling(''); }, [ll]);

  if (trip.gateOut) return <Alert tone="ok">⚖️ {t('ឡានបានចេញពីជញ្ជីងហើយ', 'The truck has gone out at the scale')}</Alert>;
  const n = ll === 0 ? 2 : ll === 4 ? 3 : ll === 5 ? 4 : again ? 3 : 0;
  const base = { tripId: trip.id, truckType: p.truckType };
  const label = (k: number) => stepName(k) + ' · ' + trip.plate;
  // Kim (22 Nov 2026): a DN already on another trip is flagged as soon as it is typed or scanned, not at Record.
  // Kim (23 Nov 2026): one DN may have several pickups, so it is only a warning; anyone can still add it.
  const usedMsg = (d: string, ids: string[]) => t('DN ' + d + ' មាននៅលើជើងដឹក ' + ids.join(', ') + ' រួចហើយ។', 'DN ' + d + ' is already on trip ' + ids.join(', ') + '.');
  const addDn = async (raw: string) => {
    const d = cleanDn(raw);
    setDnIn('');
    if (!/^[0-9A-Z-]{4,20}$/.test(d) || dns.indexOf(d) >= 0) return;
    setDnErr('');
    if ((trip.dns || []).some(z => z.dn === d && z.leg !== 'canceled')) {
      // Kim (23 Nov 2026): the same DN can be loaded again at another warehouse: warn only.
      beep();
      setDnErr(t('DN ' + d + ' បានឡើងលើឡាននេះរួចហើយ។', 'DN ' + d + ' was already loaded on this truck.'));
      // Same DN = same customer (Kim, 23 Nov 2026): fill the customer it was loaded with before.
      const prev = ((trip.dns || []).find(z => z.dn === d && z.cust) || {}).cust || '';
      if (!inPlan.has(d) && prev) setCusts(cur => (cur[d] ? cur : { ...cur, [d]: splitCust(prev) }));
      setDns(cur => (cur.indexOf(d) >= 0 ? cur : cur.concat(d)));
      return;
    }
    const local = openTrips(ops).filter(x => x.id !== trip.id && x.dns.some(z => z.dn === d && z.leg !== 'canceled')).map(x => x.id);
    let used = local;
    let knownCust = '';
    openTrips(ops).forEach(x => x.dns.forEach(z => { if (z.dn === d && z.cust && !knownCust) knownCust = z.cust; }));
    if (!used.length) {
      try {
        const info = await api<{ plan?: unknown; legs: { tripId: string; leg: string; cust?: string }[] }>('dn', { dn: d });
        if (info.plan) setPlanHit(cur => ({ ...cur, [d]: true }));
        used = Array.from(new Set((info.legs || []).filter(l => l.tripId !== trip.id && l.leg !== 'canceled').map(l => l.tripId)));
        if (!knownCust) knownCust = ((info.legs || []).find(l => l.cust) || {}).cust || '';
      } catch { /* offline: the server checks again at Record */ }
    }
    if (!inPlan.has(d) && knownCust) setCusts(cur => (cur[d] ? cur : { ...cur, [d]: splitCust(knownCust) }));
    if (used.length) {
      beep();
      setDnErr(usedMsg(d, used));
    }
    setDns(cur => (cur.indexOf(d) >= 0 ? cur : cur.concat(d)));
  };

  if (n === 0) {
    if (done) return <Alert tone="info">⏳ {t('ឡើងទំនិញរួចរាល់។ រង់ចាំថ្លឹងចេញនៅជញ្ជីង។', 'Picking done. Waiting for Gate Out at the scale.')}</Alert>;
    return (
      <Section icon="✅" title={t('ឡើងទំនិញរួចនៅ ', 'Loading done at ') + (trip.wh || '')}>
        <p className="muted mt-0">{t('តើឡានត្រូវទៅឃ្លាំងមួយទៀតទេ?', 'Does the truck go to another warehouse?')}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn" onClick={() => setAgain(true)}>🏭 {t('ឃ្លាំងបន្ទាប់', 'Next warehouse')}</button>
          <button type="button" className="btn-primary" onClick={() => setDone(true)}>✔ {t('រួចរាល់', 'Picking done')}</button>
        </div>
      </Section>
    );
  }

  const miss: Record<string, string> = {};
  if ((n === 2 || (n === 3 && again)) && !wh) miss.wh = t('សូមជ្រើសឃ្លាំង', 'Choose the warehouse');
  if (n === 3) {
    if (!dns.length) miss.dns = t('សូមបន្ថែម DN យ៉ាងហោចណាស់មួយ', 'Add at least one DN');
    dns.forEach(d => { if (!inPlan.has(d) && !(custs[d] && (custs[d].custName || custs[d].custId))) miss['cust_' + d] = t('សូមជ្រើសអតិថិជន', 'Choose the customer'); });
  }
  // Kim (22 Nov 2026): the total kg and goods photos are typed when each warehouse finishes loading (step 4).
  if (n === 4) {
    if (!(Number(kgIn) > 0)) miss.kg = t('សូមវាយទំងន់សរុប (kg)', 'Type the total weight (kg)');
    if (!photos.length) miss.photos = t('សូមថតរូបទំនិញ', 'Take the goods photos');
    if (!websling) miss.websling = t('សូមជ្រើស ប្រើ ឬមិនប្រើ', 'Choose Yes or No');
  }
  const m = tried ? miss : {};
  async function submit() {
    setTried(true);
    if (Object.keys(miss).length) { scrollToMissing(); return; }
    if (n === 2) await st.save({ ...base, code: 4, wh }, label(2));
    else if (n === 3) {
      const ok = await st.save({ ...base, code: 5, wh: again ? wh : trip.wh, dns: dns.map(dn => ({ dn, ...(inPlan.has(dn) ? {} : custs[dn] || {}) })) }, label(3));
      if (ok) setAgain(false);
    } else await st.save({ ...base, code: 6, wh: trip.wh, kg: Number(kgIn), photos, websling: websling === 'yes' }, label(4));
  }
  return (
    <Section icon={n === 2 ? '🏭' : n === 3 ? '🏗️' : '✅'} title={stepName(n)}>
      {st.dialog}
      {n === 2 || (n === 3 && again) ? (
        <Field icon="🏭" label={t('លេខកូដឃ្លាំង', 'Warehouse code')} required need={!!miss.wh} error={m.wh} id="wh">
          <Picker value={wh} options={whOpts} onChange={v => setWh(v)} bad={!!m.wh} placeholder={t('ជ្រើសឃ្លាំង', 'Choose the warehouse')} />
        </Field>
      ) : <p className="muted mt-0">🏭 {trip.wh}</p>}
      {n === 3 ? (
        <>
          <Field icon="📄" label={t('លេខ DN', 'DN number(s)')} required need={!!miss.dns} error={m.dns} id="dns">
            <div className="flex gap-2">
              <input className="in flex-1" inputMode="numeric" value={dnIn} onChange={e => setDnIn(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDn(dnIn); } }} placeholder={t('វាយលេខ DN', 'Type the DN')} />
              <button type="button" className="btn" onClick={() => addDn(dnIn)}>➕</button>
              <button type="button" className="btn" onClick={() => setScan(true)}>📷</button>
            </div>
            {dnErr ? <div className="mt-2"><Alert tone="warn">⚠️ {dnErr}</Alert></div> : null}
            <div className="flex flex-wrap gap-2 mt-2">
              {dns.map(d => <button key={d} type="button" className="chip chip-on" onClick={() => setDns(dns.filter(x => x !== d))}>{d} ✕</button>)}
            </div>
            {/* Kim's W3 A: the customer from the Delivery Plan under the DNs. */}
            {Array.from(new Set(dns.map(d => (boot.plan.find(x => x.dn === d) || { custName: '' }).custName).filter(Boolean))).map(c => <div key={c} className="muted text-[13px] mt-1">🏢 {c} ({t('ពីផែនការ', 'from plan')})</div>)}
          </Field>
          {dns.filter(d => !inPlan.has(d)).map(d => {
            const c = custs[d];
            return (
              <Field key={d} icon="🏢" label={t('អតិថិជនរបស់ DN ', 'Customer of DN ') + d} required need={!!miss['cust_' + d]} error={m['cust_' + d]} id={'cust_' + d}>
                <div className="text-[12.5px] text-warn font-semibold mb-1">{t('មិនមានក្នុង Delivery Plan', 'Not in the Delivery Plan')}</div>
                <Picker value={c ? (c.custId ? c.custId + '-' : '') + c.custName : ''} options={custOpts} allowFree bad={!!m['cust_' + d]} placeholder={t('ជ្រើសអតិថិជន', 'Choose the customer')}
                  onChange={(v, o) => setCusts(cur => ({ ...cur, [d]: o ? { custId: o.sub || '', custName: o.label } : { custId: '', custName: v } }))} />
              </Field>
            );
          })}
          {scan ? <Scanner onCode={c => { addDn(c); setScan(false); }} onClose={() => setScan(false)} /> : null}
        </>
      ) : null}
      {n === 4 ? (<>
          <Field icon="⚖️" label={t('ទំងន់សរុបជាក់ស្តែង (kg)', 'Total actual weight (kg)')} required need={!!miss.kg} error={m.kg} id="kg">
            <input className={'in ' + (m.kg ? '!border-bad' : '')} inputMode="decimal" value={kgIn} onChange={e => setKgIn(e.target.value.replace(/[^0-9.]/g, ''))} />
          </Field>
          <Field icon="📷" label={t('រូបថតទំនិញ', 'Goods photos')} required need={!!miss.photos} error={m.photos} id="photos">
            <MultiPhoto value={photos} onChange={setPhotos} />
          </Field>
        <Field icon="🪢" label={t('ប្រើ Websling?', 'Websling used?')} required need={!!miss.websling} error={m.websling} id="websling">
          <Segmented value={websling} onChange={setWebsling} options={[{ v: 'yes', km: 'ប្រើ', en: 'Yes' }, { v: 'no', km: 'មិនប្រើ', en: 'No' }]} />
        </Field>
      </>) : null}
      {st.error ? <Alert tone="bad">{st.error}</Alert> : null}
      <button type="button" className="btn-primary w-full mt-2" disabled={st.saving} onClick={submit}>{st.saving ? '…' : '💾 ' + t('កត់ត្រា', 'Record') + ' · ' + t(...STEP_NAMES[n])}</button>
    </Section>
  );
}

/** Driver link page (no sign-in): the signed trip link, the DN legs' names and a refresh after each save. */
export type DrvLink = { t: string; k: string; legs: Record<string, Label>; reload: () => void };
/**
 * Driver steps 6–9 per stop (Kim, 23 Nov 2026): DNs to the same customer at the same step are recorded once together.
 * D2 B: map + route before arrival; D3 B: one arrival photo for the stop; D4 A: one Delivered form, untick a DN that is not delivered.
 */
export function DriverSteps(p: { trip: TripSummary; truckType: string; dn?: string; link?: DrvLink; sites?: Record<string, string> }) {
  const trip = p.trip;
  // After Delivered: the customer rating QR and the site rating stay on screen (the stop itself moves on).
  const [rate, setRate] = useState<Record<string, string> | null>(null);
  const [siteRated, setSiteRated] = useState(false);
  if (!trip.gateOut) return <Alert tone="info">⏳ {t('រង់ចាំឡានថ្លឹងចេញនៅជញ្ជីង មុនពេលចេញដឹក។', 'Waiting for Gate Out at the scale before delivery.')}</Alert>;
  const after = rate && Object.keys(rate).length ? (
    <>
      <RateLinks tripId={trip.id} links={rate} open />
      {!siteRated ? <SiteRateForm dns={Object.keys(rate)} send={p.link ? (body: any) => api('drvSiteRate', Object.assign({ t: p.link!.t, k: p.link!.k }, body), { noAuth: true }) : siteRateSigned(trip.id)} onDone={() => setSiteRated(true)} /> : null}
    </>
  ) : null;
  const stops = groupStops(trip.dns.filter(d => d.leg !== 'canceled'), true)
    .sort((a, b) => Number(b.dns.some(d => d.dn === p.dn)) - Number(a.dns.some(d => d.dn === p.dn)) || Number(!!b.step) - Number(!!a.step));
  const first = (stops.find(x => x.step) || { key: '' }).key;
  return <>{!trip.closed ? <GpsShare tripId={trip.id} link={p.link ? { t: p.link.t, k: p.link.k } : undefined} /> : null}{stops.map(sp => <StopStep key={sp.key + sp.dns.map(d => d.dn + d.leg).join()} trip={trip} truckType={p.truckType} stop={sp} open={sp.key === first} link={p.link} onRate={o => { setRate(o); setSiteRated(false); }} site={sp.dns.map(d => (p.sites || {})[d.dn]).filter(Boolean)[0] || ''} />)}{after}</>;
}

function StopStep(p: { trip: TripSummary; truckType: string; stop: Stop; open: boolean; link?: DrvLink; site: string; onRate: (o: Record<string, string>) => void }) {
  const app = useContext(AppCtx);
  const legs = app ? app.boot.legs : p.link ? p.link.legs : {};
  const plan = app ? app.boot.plan : [];
  const sp = p.stop, dnsAll = sp.dns.map(d => d.dn);
  const n = sp.step;
  const [open, setOpen] = useState(p.open);
  const [photo, setPhoto] = useState('');
  const [signed, setSigned] = useState('');
  const [result, setResult] = useState<'ok' | 'fail' | 'cancel'>('ok');
  const [reason, setReason] = useState('');
  const [receiver, setReceiver] = useState('');
  const [signature, setSignature] = useState('');
  const [part, setPart] = useState(false);
  const [tick, setTick] = useState<Record<string, boolean>>(() => Object.fromEntries(dnsAll.map(d => [d, true])));
  const [kgs, setKgs] = useState<Record<string, string>>(() => Object.fromEntries(sp.dns.map(d => {
    const pl = plan.find(x => x.dn === d.dn);
    return [d.dn, String(d.kg || d.loadKg || (pl && pl.kg) || '')];
  })));
  const [tried, setTried] = useState(false);
  const st = useStep(p.link ? { t: p.link.t, k: p.link.k } : undefined, p.link ? p.link.reload : undefined);
  const base = { tripId: p.trip.id, truckType: p.truckType };
  const name = sp.cust ? sp.cust.replace(/^\s*\d+\s*-\s*/, '') : 'DN ' + dnsAll[0];
  const label = stepName(n || 9) + ' · ' + name;
  const count = ' (' + dnsAll.length + ' DN)';
  const head = (
    <button type="button" className="w-full text-left bg-transparent border-0 p-0 cursor-pointer" onClick={() => setOpen(!open)}>
      <div className="flex items-start justify-between gap-2">
        <b className="text-[16px]">📍 {name}</b>
        <span className="text-[12px] font-bold rounded-full px-2.5 py-1 whitespace-nowrap bg-oksoft text-ok">{n ? stepName(n) : L(legs[sp.dns[0].leg]) || sp.dns[0].leg}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-1.5">{dnsAll.map(d => <span key={d} className="text-[12.5px] font-bold rounded-md px-2 py-0.5 bg-soft text-brand">{d}</span>)}</div>
    </button>
  );
  if (!n || !open) return <div className="card" data-stop={dnsAll.join(',')}>{head}</div>;

  const picked = dnsAll.filter(d => tick[d]);
  const miss: Record<string, string> = {};
  if (n === 6 && !photo) miss.photo = t('សូមថតរូបភស្តុតាង', 'Take the proof photo');
  if (n === 9 && result === 'ok') {
    if (!picked.length) miss.dns = t('សូមធីក DN ដែលបានប្រគល់', 'Tick the DNs delivered');
    picked.forEach(d => { if (!(Number(kgs[d]) > 0)) miss.dns = t('សូមវាយទំងន់ (kg) របស់ DN ', 'Type the weight (kg) of DN ') + d; });
    if (!signed) miss.signed = t('សូមថតរូប DN ដែលអតិថិជនចុះហត្ថលេខា', 'Take the photo of the DN signed by the customer');
    if (!photo) miss.photo = t('សូមថតរូបទំនិញដែលបានប្រគល់', 'Take the photo of the goods delivered');
    if (!receiver.trim()) miss.receiver = t('សូមវាយឈ្មោះអ្នកទទួល', 'Type the receiver name');
    if (!signature) miss.signature = t('សូមឲ្យអ្នកទទួលចុះហត្ថលេខា', 'Ask the receiver to sign');
  }
  if (n === 9 && result !== 'ok') {
    if (reason.trim().length < 3) miss.reason = t('សូមសរសេរមូលហេតុ', 'Write the reason');
    if (!photo) miss.photo = t('សូមថតរូបភស្តុតាង', 'Take the proof photo');
  }
  const m = tried ? miss : {};
  async function submit() {
    setTried(true);
    if (Object.keys(miss).length) { scrollToMissing(); return; }
    const all = dnsAll.map(dn => ({ dn }));
    let r: any = null;
    if (n === 6) r = await st.save({ ...base, code: 8, dns: all, photo }, label);
    else if (n === 7) r = await st.save({ ...base, code: 12, dns: all }, label);
    else if (n === 8) r = await st.save({ ...base, code: 13, dns: all }, label);
    else if (result === 'ok') {
      r = await st.save({ ...base, code: 9, dns: picked.map(dn => ({ dn, kg: Number(kgs[dn]), final: !part })), photos: [signed, photo], receiver: receiver.trim(), signature }, label);
      if (r && r.rate && r.rate.length) { const o: Record<string, string> = {}; r.rate.forEach((x: { dn: string; k: string }) => { o[x.dn] = x.k; }); p.onRate(o); }
    } else r = await st.save({ ...base, code: result === 'fail' ? 11 : 10, dns: all, remark: reason.trim(), photo }, label);
    if (r) { setTried(false); setPhoto(''); setSigned(''); setSignature(''); }
  }
  const saveText = n === 9 ? (result === 'ok' ? t('បានប្រគល់', 'Delivered') + ' (' + picked.length + ' DN)' : (result === 'fail' ? t('បរាជ័យ', 'Failed') : t('លុបចោល', 'Canceled')) + count) : t(...STEP_NAMES[n]) + count;
  return (
    <>
    <div className="card space-y-3" data-stop={dnsAll.join(',')}>
      {st.dialog}
      {head}
      {n === 6 ? (
        <>
          {p.site ? (
            <>
              <iframe title="map" className="w-full h-[200px] rounded-xl border-0" loading="lazy" src={'https://maps.google.com/maps?q=' + encodeURIComponent(p.site) + '&z=13&output=embed'} />
              <a className="btn w-full no-underline" href={'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(p.site)} target="_blank" rel="noopener">🧭 {t('បើកផ្លូវ', 'Directions')}</a>
            </>
          ) : null}
          <Field icon="📷" label={t('រូបថតមកដល់', 'Arrival photo')} required need={!!miss.photo} error={m.photo} id="photo"><PhotoInput value={photo} onChange={setPhoto} /></Field>
          {dnsAll.length > 1 ? <div className="text-[12.5px] rounded-lg px-2.5 py-1.5 bg-warnsoft text-warn">💡 {t('រូបថតមួយ ប្រើសម្រាប់ DN ទាំង ' + dnsAll.length, 'One photo for all ' + dnsAll.length + ' DNs')}</div> : null}
        </>
      ) : null}
      {n === 9 ? (
        <>
          <Segmented value={result} onChange={setResult} options={[{ v: 'ok', km: '✅ បានប្រគល់', en: '✅ Delivered' }, { v: 'fail', km: '⚠️ បរាជ័យ', en: '⚠️ Failed' }, { v: 'cancel', km: '🚫 លុបចោល', en: '🚫 Canceled' }]} />
          {result === 'ok' ? (
            <>
              <Field icon="📄" label={t('DN ដែលបានប្រគល់ · ទំងន់ (kg)', 'DNs delivered · weight (kg)')} required need={!!miss.dns} error={m.dns} id="dnsok">
                <div className="grid gap-1.5">
                  {dnsAll.map(d => (
                    <label key={d} className="flex items-center gap-2">
                      <input type="checkbox" className="w-5 h-5" checked={!!tick[d]} onChange={e => setTick({ ...tick, [d]: e.target.checked })} />
                      <b className="flex-1 text-[14px]">{d}</b>
                      <input className="in !w-[110px] text-right" inputMode="decimal" disabled={!tick[d]} value={kgs[d] || ''} onChange={e => setKgs({ ...kgs, [d]: e.target.value.replace(/[^0-9.]/g, '') })} aria-label={'kg ' + d} />
                    </label>
                  ))}
                  {dnsAll.length > 1 ? <span className="muted text-[12px]">{t('ដោះធីក DN ដែលមិនបានប្រគល់ (កត់ត្រាវាដាច់ដោយឡែកបន្ទាប់)', 'Untick a DN not delivered (record it on its own after)')}</span> : null}
                </div>
              </Field>
              <Field icon="✍️" label={t('រូបថត DN ដែលអតិថិជនចុះហត្ថលេខា', 'DN signed by customer')} required need={!!miss.signed} error={m.signed} id="signed"><PhotoInput value={signed} onChange={setSigned} /></Field>
              <Field icon="📦" label={t('រូបថតទំនិញដែលបានប្រគល់', 'Goods delivered photo')} required need={!!miss.photo} error={m.photo} id="photo"><PhotoInput value={photo} onChange={setPhoto} /></Field>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" className="w-5 h-5" checked={part} onChange={e => setPart(e.target.checked)} />{t('ប្រគល់តែមួយផ្នែក (នៅសល់ដឹកជើងក្រោយ)', 'Only part delivered (rest comes on another trip)')}</label>
              <Field icon="🙋" label={t('ឈ្មោះអ្នកទទួល', 'Receiver name')} required need={!!miss.receiver} error={m.receiver} id="rcv">
                <input className={'in ' + (m.receiver ? '!border-bad' : '')} value={receiver} onChange={e => setReceiver(e.target.value)} />
              </Field>
              <Field icon="✍️" label={t('ហត្ថលេខាអ្នកទទួល', 'Receiver signature')} required need={!!miss.signature} error={m.signature} id="sig"><SignaturePad value={signature} onChange={setSignature} label={false} /></Field>
            </>
          ) : (
            <>
              <Field icon="📝" label={t('មូលហេតុ', 'Reason')} required need={!!miss.reason} error={m.reason} id="reason">
                <textarea className={'in ' + (m.reason ? '!border-bad' : '')} rows={2} value={reason} onChange={e => setReason(e.target.value)} />
              </Field>
              <Field icon="📷" label={t('រូបថតភស្តុតាង', 'Proof photo')} required need={!!miss.photo} error={m.photo} id="photo"><PhotoInput value={photo} onChange={setPhoto} /></Field>
            </>
          )}
        </>
      ) : null}
      {st.error ? <Alert tone="bad">{st.error}</Alert> : null}
      <button type="button" className={'btn-primary w-full ' + (n === 7 || n === 8 ? '!py-4 !text-[17px]' : '')} disabled={st.saving} onClick={submit}>{st.saving ? '…' : '💾 ' + saveText}</button>
    </div>
    </>
  );
}
