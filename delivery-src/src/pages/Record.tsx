import { useEffect, useMemo, useState } from 'react';
import { L, t, useLang, kg as fmtKg } from '../i18n';
import { go, openTrips, tripHref, useApp, useRoute } from '../state';
import type { EventDef, PlanRow, TripSummary } from '../types';
import { Alert, Badge, Opt, PhotoInput, Picker, Segmented, toast } from '../components/ui';
import { Scanner } from '../components/Scanner';
import { useSubmit } from '../components/submit';
import { ProofFields, RateLinks, SiteRateForm, siteRateSigned } from '../components/Proof';

export type DnLine = { dn: string; custId: string; custName: string; so: string; kg: string; final: boolean; inPlan: boolean };
const DONE_LEGS = ['delivered', 'failed', 'canceled', 'moved'];
const cleanDn = (s: string) => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/[^0-9A-Z-]/g, '');

/** The step that usually comes next for a trip (highlighted, never forced). */
export function nextCode(trip?: TripSummary | null) {
  if (!trip) return 1;
  if (trip.gateOut) return trip.dns.some(d => d.leg === 'at_customer') ? 9 : 8;
  const c = trip.lastCode || 1;
  return c >= 7 ? 8 : c === 1 ? 2 : c + 1;
}

export function RecordPage() {
  const lang = useLang();
  const { boot, ops, refreshOps } = useApp();
  const route = useRoute();
  const mine = boot.events.filter(e => e.can);
  const trips = openTrips(ops);
  const [tripId, setTripId] = useState(route.q.get('trip') || '');
  const trip = trips.find(x => x.id === tripId) || null;
  const [code, setCode] = useState<number>(() => {
    const c = Number(route.q.get('code'));
    if (c && mine.some(e => e.code === c)) return c;
    const n = nextCode(trips.find(x => x.id === route.q.get('trip')));
    return mine.some(e => e.code === n) ? n : mine[0] ? mine[0].code : 0;
  });
  const ev = boot.events.find(e => e.code === code) as EventDef | undefined;

  // form fields
  const [plate, setPlate] = useState('');
  const [truckType, setTruckType] = useState<'isi' | 'rented' | 'customer'>('isi');
  const [driver, setDriver] = useState('');
  const [photo, setPhoto] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [signature, setSignature] = useState('');
  const [receiver, setReceiver] = useState('');
  const [company, setCompany] = useState('');
  const [remark, setRemark] = useState('');
  const [wh, setWh] = useState('');
  const [loadKg, setLoadKg] = useState('');
  const [websling, setWebsling] = useState<'' | 'yes' | 'no'>('');
  const [lines, setLines] = useState<DnLine[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [delivered, setDelivered] = useState<Record<string, { kg: string; final: boolean }>>({});
  const [done, setDone] = useState<{ tripId: string; round: string; code: number; queued?: boolean; rate?: Record<string, string>; siteRated?: boolean } | null>(null);
  const [formErr, setFormErr] = useState('');
  const sub = useSubmit('record');

  useEffect(() => { const q = route.q.get('trip'); if (q) setTripId(q); const c = Number(route.q.get('code')); if (c) setCode(c); }, [route]);
  // Changing step or trip starts a clean form.
  useEffect(() => { setPicked({}); setDelivered({}); setLines([]); setPhoto(''); setPhotos([]); setSignature(''); setReceiver(''); setRemark(''); setFormErr(''); sub.setError(''); }, [code, tripId]);
  useEffect(() => {
    if (!trip) return;
    const open = trip.dns.filter(d => DONE_LEGS.indexOf(d.leg) < 0);
    if (open.length === 1 && [8, 9, 11].indexOf(code) >= 0) setPicked({ [open[0].dn]: true });
  }, [trip && trip.id, code]);

  const planByDn = useMemo(() => { const m: Record<string, PlanRow> = {}; boot.plan.forEach(p => { m[p.dn] = p; }); return m; }, [boot.plan]);
  const plateOpts: Opt[] = useMemo(() => boot.plates.map(p => ({ value: p.plate, label: p.plate, sub: p.type })), [boot.plates]);
  const driverOpts: Opt[] = useMemo(() => {
    const mineFirst = boot.drivers.slice().sort((a, b) => Number(b.plate === plate) - Number(a.plate === plate));
    return mineFirst.map(d => ({ value: d.name, label: d.name, sub: [d.plate, d.co].filter(Boolean).join(' · ') }));
  }, [boot.drivers, plate]);
  const tripOpts: Opt[] = useMemo(() => trips.map(x => ({ value: x.id, label: x.plate + ' · ' + x.round, sub: x.id + ' · ' + L(boot.stages[x.stage]) + (x.dns.length ? ' · ' + x.dns.map(d => d.dn).join(', ') : '') })), [trips, lang]);
  const custOpts: Opt[] = useMemo(() => boot.customers.map(c => ({ value: c.id + '-' + c.name, label: c.name, sub: c.id })), [boot.customers]);
  const whOpts: Opt[] = useMemo(() => boot.warehouses.map(w => ({ value: w, label: w })), [boot.warehouses]);
  const coOpts: Opt[] = useMemo(() => (boot.companies || []).map(c => ({ value: c, label: c })), [boot.companies]);

  const openDns = trip ? trip.dns.filter(d => DONE_LEGS.indexOf(d.leg) < 0) : [];

  function choosePlate(v: string) {
    setPlate(v);
    const known = boot.plates.some(p => p.plate === v);
    setTruckType(known ? 'isi' : 'rented');
    setCompany(known ? '' : (boot.plateCo || {})[v] || '');
    const d = boot.drivers.filter(x => x.plate === v);
    if (d.length === 1) setDriver(d[0].name);
  }

  async function submit() {
    setFormErr('');
    if (!ev) return;
    const p: any = { code, remark: remark.trim() };
    if (code === 1) {
      if (!plate) return setFormErr(t('សូមជ្រើស ឬវាយផ្លាកលេខឡាន។', 'Choose or type the truck plate.'));
      Object.assign(p, { plate, driver, truckType });
      if (truckType !== 'isi' && company) p.company = company;
    } else {
      if (!trip) return setFormErr(t('សូមជ្រើសរើសជើងដឹក។', 'Choose the trip.'));
      p.tripId = trip.id;
    }
    if (code === 2) {
      if (!lines.length) return setFormErr(t('សូមបន្ថែម DN យ៉ាងហោចណាស់មួយ។', 'Add at least one DN.'));
      const noCust = lines.find(l => !l.inPlan && !l.custName);
      if (noCust) return setFormErr(t('DN ' + noCust.dn + ' មិនមានក្នុងផែនការ សូមជ្រើសអតិថិជន។', 'DN ' + noCust.dn + ' is not in the plan: choose the customer.'));
      p.dns = lines.map(l => ({ dn: l.dn, custId: l.custId, custName: l.custName, so: l.so }));
    }
    if ([8, 9, 11, 10].indexOf(code) >= 0) {
      const sel = Object.keys(picked).filter(k => picked[k]);
      if (code !== 10 && !sel.length) return setFormErr(t('សូមជ្រើសរើស DN។', 'Choose the DN(s).'));
      p.dns = sel.map(dn => {
        const d = delivered[dn] || { kg: '', final: true };
        return code === 9 ? { dn, kg: Number(d.kg) || 0, final: d.final } : { dn };
      });
      if (code === 9) {
        const bad = p.dns.find((d: any) => !d.final && !d.kg);
        if (bad) return setFormErr(t('DN ' + bad.dn + ' ប្រគល់មួយផ្នែក: សូមវាយទំងន់ (kg)។', 'DN ' + bad.dn + ' is a part delivery: type the weight (kg).'));
      }
    }
    if (code === 6) {
      if (!wh) return setFormErr(t('សូមជ្រើសរើសឃ្លាំង។', 'Choose the warehouse.'));
      Object.assign(p, { wh, kg: Number(loadKg) || 0, websling: websling === 'yes' ? true : websling === 'no' ? false : null });
    }
    if ((code === 10 || code === 11) && p.remark.length < 3) return setFormErr(t('សូមសរសេរមូលហេតុ។', 'Write the reason.'));
    if (code === 9) {
      if (photos.length) p.photos = photos;
      if (signature) p.signature = signature;
      if (receiver.trim()) p.receiver = receiver.trim();
    } else if (photo) p.photo = photo;
    const label = L(ev) + ' · ' + (code === 1 ? plate : trip ? trip.plate + ' ' + trip.id : '');
    const r = await sub.send(p, label);
    if (r.ok) {
      const rate: Record<string, string> = {};
      (r.data.rate || []).forEach((x: { dn: string; k: string }) => { rate[x.dn] = x.k; });
      setDone({ tripId: r.data.tripId, round: r.data.round, code, rate });
      toast('✅ ' + t('បានកត់ត្រា', 'Recorded'));
      refreshOps();
    } else if ('queued' in r && r.queued) {
      setDone({ tripId: p.tripId || '', round: '', code, queued: true });
    }
  }

  function reset(nextTrip?: string, next?: number) {
    setDone(null); setPlate(''); setDriver(''); setPhoto(''); setPhotos([]); setSignature(''); setReceiver(''); setCompany(''); setRemark(''); setWh(''); setLoadKg(''); setWebsling(''); setLines([]); setPicked({}); setDelivered({});
    if (nextTrip !== undefined) setTripId(nextTrip);
    if (next) setCode(next);
    go('/record' + (nextTrip ? '?trip=' + encodeURIComponent(nextTrip) + (next ? '&code=' + next : '') : ''));
  }

  if (!mine.length) {
    return <main className="max-w-2xl mx-auto p-4"><Alert tone="warn">{t('តួនាទីរបស់អ្នក (' + (boot.user.role || 'គ្មាន') + ') មិនអាចកត់ត្រាបានទេ។ សូមសួរអ្នកគ្រប់គ្រង។', 'Your role (' + (boot.user.role || 'none') + ') cannot record steps. Ask the admin.')}</Alert></main>;
  }

  if (done) {
    const canPickup = mine.some(e => e.code === 2);
    return (
      <main className="max-w-2xl mx-auto p-3 sm:p-4">
        <div className="card text-center">
          {done.queued ? (
            <>
              <div className="text-[44px]">⏳</div>
              <h2 className="text-lg font-bold m-0">{t('រក្សាទុកក្នុងទូរស័ព្ទ', 'Saved on this phone')}</h2>
              <p className="muted">{t('គ្មានអ៊ីនធឺណិត។ នឹងផ្ញើដោយស្វ័យប្រវត្តិពេលមានសេវា ជាមួយម៉ោងពិត។', 'No connection. It will be sent automatically when there is signal, with the real time.')}</p>
            </>
          ) : (
            <>
              <div className="text-[44px]">✅</div>
              <h2 className="text-lg font-bold m-0">{L(boot.events.find(e => e.code === done.code))}</h2>
              {done.code === 1 ? (
                <div className="my-3">
                  <div className="muted text-sm">{t('លេខជើងដឹក', 'Trip ID')}</div>
                  <div className="text-[30px] font-bold tracking-wide text-brand" data-testid="new-trip-id">{done.tripId}</div>
                  <div className="font-semibold">{done.round}</div>
                </div>
              ) : <p className="muted">{done.tripId}</p>}
            </>
          )}
          <div className="grid gap-2 mt-3">
            {done.code === 1 && canPickup && !done.queued ? <button type="button" className="btn-primary" onClick={() => reset(done.tripId, 2)}>➕ {t('បន្ថែម DN (ដល់កន្លែងចែកបុង)', 'Add DNs (Arrival-Pickup DN)')}</button> : null}
            {done.tripId && !done.queued ? <a className="btn no-underline" href={tripHref(done.tripId)}>🚚 {t('មើលជើងដឹក', 'Open trip')}</a> : null}
            {done.tripId && done.code !== 1 && !done.queued ? <button type="button" className="btn" onClick={() => reset(done.tripId)}>{t('កត់ត្រាជំហានបន្ទាប់', 'Record the next step')}</button> : null}
            <button type="button" className="btn" onClick={() => reset('')}>{t('កត់ត្រាថ្មី', 'Record another')}</button>
          </div>
        </div>
        {done.rate && Object.keys(done.rate).length ? (
          <>
            <RateLinks tripId={done.tripId} links={done.rate} open />
            {!done.siteRated ? <SiteRateForm dns={Object.keys(done.rate)} send={siteRateSigned(done.tripId)} onDone={() => setDone(Object.assign({}, done, { siteRated: true }))} /> : null}
          </>
        ) : null}
      </main>
    );
  }

  const suggested = nextCode(trip);
  return (
    <main className="max-w-2xl mx-auto p-3 sm:p-4">
      <section className="card">
        <span className="lbl">1. {t('ជំហាន', 'Step')}</span>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {mine.map(e => (
            <button key={e.code} type="button" role="radio" aria-checked={code === e.code} onClick={() => setCode(e.code)}
              className={'text-left rounded-xl border-[1.5px] px-3 py-2 text-[14.5px] leading-snug ' + (code === e.code ? 'border-accent bg-soft font-bold text-brand' : 'border-line bg-card') + (e.code >= 10 ? ' col-span-1' : '')}>
              {L(e)}{trip && e.code === suggested && code !== e.code ? <span className="block text-[11.5px] text-accent font-semibold">{t('ជំហានបន្ទាប់', 'Next step')}</span> : null}
            </button>
          ))}
        </div>
      </section>

      {code === 1 ? (
        <section className="card grid gap-3">
          <div><label className="lbl" htmlFor="plate">2. {t('ផ្លាកលេខឡាន', 'Truck plate')}</label>
            <Picker id="plate" value={plate} options={plateOpts} onChange={choosePlate} allowFree upper placeholder={t('ជ្រើស ឬវាយផ្លាកលេខ', 'Choose or type the plate')} freeLabel={t('ឡានជួល/អតិថិជន', 'Rented / customer truck')} /></div>
          <div><span className="lbl">{t('ប្រភេទឡាន', 'Truck type')}</span>
            <Segmented value={truckType} onChange={setTruckType} options={[{ v: 'isi', km: 'ឡាន ISI', en: 'ISI truck' }, { v: 'rented', km: 'ឡានជួល', en: 'Rented' }, { v: 'customer', km: 'ឡានអតិថិជន', en: 'Customer truck' }]} /></div>
          <div><label className="lbl" htmlFor="driver">{t('ឈ្មោះតៃកុង', 'Driver')}</label>
            <Picker id="driver" value={driver} options={driverOpts} onChange={v => setDriver(v)} allowFree placeholder={t('ជ្រើស ឬវាយឈ្មោះតៃកុង', 'Choose or type the driver')} /></div>
          {truckType !== 'isi' ? (
            <div><label className="lbl" htmlFor="co">{t('ក្រុមហ៊ុនដឹកជញ្ជូន (3PL)', 'Transport company (3PL)')}</label>
              <Picker id="co" value={company} options={coOpts} onChange={v => setCompany(v)} allowFree placeholder={t('ជ្រើស ឬវាយឈ្មោះក្រុមហ៊ុន', 'Choose or type the company')} /></div>
          ) : null}
          <PhotoInput label={t('រូបថតឡាន (មិនចាំបាច់)', 'Truck photo (optional)')} value={photo} onChange={setPhoto} />
        </section>
      ) : (
        <section className="card">
          <label className="lbl" htmlFor="trip">2. {t('ជើងដឹក', 'Trip')}</label>
          <Picker id="trip" value={tripId} options={tripOpts} onChange={v => setTripId(v)} placeholder={t('ជ្រើសរើសឡាន / ជើងដឹក', 'Choose the truck / trip')} />
          {trip ? (
            <div className="flex flex-wrap items-center gap-2 mt-2 text-[13.5px]">
              <Badge k={trip.stage} label={boot.stages[trip.stage]} /><span className="muted">{trip.id}</span>{trip.driver ? <span className="muted">· {trip.driver}</span> : null}
            </div>
          ) : !trips.length ? <p className="muted text-sm mt-2">{t('មិនមានជើងដឹកកំពុងដំណើរការ។ ចាប់ផ្តើមដោយ ចូលថ្លឹង។', 'No open trips. Start one with Gate In.')}</p> : null}
        </section>
      )}

      {code === 2 && trip ? <DnAdder lines={lines} setLines={setLines} planByDn={planByDn} plate={trip.plate} onTrip={trip.dns.map(d => d.dn)} custOpts={custOpts} plan={boot.plan} /> : null}

      {[8, 9, 10, 11].indexOf(code) >= 0 && trip ? (
        <section className="card">
          <span className="lbl">3. {code === 10 ? t('DN ដែលលុបចោល (ទុកទទេ = លុបចោលជើងដឹកទាំងមូល)', 'DNs to cancel (none = cancel the whole trip)') : t('DN', 'DN')}</span>
          {!openDns.length ? <p className="muted text-sm">{t('ជើងដឹកនេះមិនមាន DN បើកទេ។', 'This trip has no open DN.')}</p> : null}
          <div className="grid gap-2">
            {openDns.map(d => {
              const on = !!picked[d.dn];
              const pl = planByDn[d.dn];
              const dv = delivered[d.dn] || { kg: '', final: true };
              return (
                <div key={d.dn} className={'rounded-xl border-[1.5px] p-2.5 ' + (on ? 'border-accent bg-soft' : 'border-line')}>
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" className="w-5 h-5 mt-0.5 accent-[#0b76a0]" checked={on} onChange={e => setPicked(Object.assign({}, picked, { [d.dn]: e.target.checked }))} />
                    <span className="min-w-0"><b>{d.dn}</b> <span className="muted text-[13px]">{L(boot.legs[d.leg])}</span>
                      <span className="block text-[13px] muted truncate">{d.cust}{pl && pl.kg ? ' · ' + t('ផែនការ', 'plan') + ' ' + fmtKg(pl.kg) : ''}</span></span>
                  </label>
                  {code === 9 && on ? (
                    <div className="grid gap-2 mt-2 pl-7">
                      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" className="w-5 h-5 accent-[#0b76a0]" checked={dv.final} onChange={e => setDelivered(Object.assign({}, delivered, { [d.dn]: { kg: dv.kg, final: e.target.checked } }))} />
                        {t('DN នេះប្រគល់គ្រប់ (ឬផ្នែកចុងក្រោយ)', 'This finishes the DN (all, or the last part)')}</label>
                      <input className="in" inputMode="decimal" value={dv.kg} onChange={e => setDelivered(Object.assign({}, delivered, { [d.dn]: { kg: e.target.value.replace(/[^0-9.]/g, ''), final: dv.final } }))}
                        placeholder={dv.final ? t('ទំងន់ដែលប្រគល់ kg (មិនចាំបាច់)', 'Delivered weight kg (optional)') : t('ទំងន់ដែលប្រគល់ kg (ចាំបាច់)', 'Delivered weight kg (needed)')} aria-label="kg" />
                      {pl && pl.kg && Number(dv.kg) > 0 && Number(dv.kg) < pl.kg * 0.995 ? <span className="text-[12.5px] text-warn font-semibold">{t('តិចជាងផែនការ (' + fmtKg(pl.kg) + '): DN នឹងនៅ ប្រគល់មួយផ្នែក រហូតដល់គ្រប់ទំងន់។', 'Less than the plan (' + fmtKg(pl.kg) + '): the DN stays Partly delivered until the weight is complete.')}</span> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {code === 6 && trip ? (
        <section className="card grid gap-3">
          <div><label className="lbl" htmlFor="wh">3. {t('ឃ្លាំង', 'Warehouse')}</label><Picker id="wh" value={wh} options={whOpts} onChange={v => setWh(v)} placeholder={t('ជ្រើសឃ្លាំង', 'Choose the warehouse')} /></div>
          <div><label className="lbl" htmlFor="loadkg">{t('ទំងន់ (kg)', 'Weight (kg)')}</label><input id="loadkg" className="in" inputMode="decimal" value={loadKg} onChange={e => setLoadKg(e.target.value.replace(/[^0-9.]/g, ''))} /></div>
          <div><span className="lbl">{t('ប្រើ Websling?', 'Websling used?')}</span><Segmented value={websling} onChange={setWebsling} options={[{ v: 'yes', km: 'ប្រើ', en: 'Yes' }, { v: 'no', km: 'មិនប្រើ', en: 'No' }]} /></div>
          <PhotoInput label={t('រូបថតទំនិញ (មិនចាំបាច់)', 'Goods photo (optional)')} value={photo} onChange={setPhoto} />
        </section>
      ) : null}

      {code === 9 && trip ? <ProofFields receiver={receiver} setReceiver={setReceiver} signature={signature} setSignature={setSignature} photos={photos} setPhotos={setPhotos} /> : null}
      {[8, 11].indexOf(code) >= 0 && trip ? (
        <section className="card"><PhotoInput label={t('រូបថតបុង / ភស្តុតាង (មិនចាំបាច់)', 'Delivery note / proof photo (optional)')} value={photo} onChange={setPhoto} /></section>
      ) : null}

      <section className="card">
        <label className="lbl" htmlFor="remark">{t('កំណត់សំគាល់', 'Remark')}{code === 10 || code === 11 ? ' *' : ''}</label>
        <textarea id="remark" className="in min-h-[70px]" value={remark} onChange={e => setRemark(e.target.value)}
          placeholder={code === 10 || code === 11 ? t('មូលហេតុ (ចាំបាច់)', 'Reason (needed)') : t('មិនចាំបាច់', 'Optional')} />
      </section>

      {formErr ? <Alert tone="bad">{formErr}</Alert> : null}
      {sub.error ? <Alert tone="bad">{sub.error}</Alert> : null}
      <button type="button" className="btn-primary w-full text-[17px] mb-6" onClick={submit} disabled={sub.sending || (code !== 1 && !trip)}>
        {sub.sending ? t('កំពុងរក្សាទុក…', 'Saving…') : '✔ ' + t('កត់ត្រា', 'Record') + ' ' + (ev ? L(ev) : '')}
      </button>
      {sub.dialog}
    </main>
  );
}

/** Arrival-Pickup DN: add DNs from the plan, by typing, or by scanning the Delivery Note barcode. */
function DnAdder(p: { lines: DnLine[]; setLines: (l: DnLine[]) => void; planByDn: Record<string, PlanRow>; plate: string; onTrip: string[]; custOpts: Opt[]; plan: PlanRow[] }) {
  useLang();
  const [typed, setTyped] = useState('');
  const [scan, setScan] = useState(false);
  const [err, setErr] = useState('');
  const planOpts: Opt[] = useMemo(() => p.plan
    .filter(r => p.onTrip.indexOf(r.dn) < 0)
    .sort((a, b) => Number(b.plate === p.plate) - Number(a.plate === p.plate) || (b.date || '').localeCompare(a.date || ''))
    .map(r => ({ value: r.dn, label: r.dn + ' · ' + r.custName, sub: [r.date, r.plate, r.round, r.kg ? fmtKg(r.kg) : ''].filter(Boolean).join(' · ') })), [p.plan, p.plate]);
  function add(raw: string) {
    setErr('');
    const dn = cleanDn(raw);
    if (!/^[0-9A-Z-]{4,20}$/.test(dn)) { setErr(t('លេខ DN មិនត្រឹមត្រូវ។', 'That is not a DN number.')); return; }
    if (p.onTrip.indexOf(dn) >= 0) { setErr(t('DN ' + dn + ' មាននៅលើជើងដឹកនេះរួចហើយ។', 'DN ' + dn + ' is already on this trip.')); return; }
    if (p.lines.some(l => l.dn === dn)) return;
    const pl = p.planByDn[dn];
    p.setLines(p.lines.concat({ dn, custId: pl ? pl.custId : '', custName: pl ? pl.custName : '', so: pl ? pl.so : '', kg: '', final: true, inPlan: !!pl }));
    setTyped('');
  }
  const setLine = (dn: string, f: Partial<DnLine>) => p.setLines(p.lines.map(l => (l.dn === dn ? Object.assign({}, l, f) : l)));
  return (
    <section className="card">
      <span className="lbl">3. {t('DN ដែលយកនៅលើជើងនេះ', 'DNs picked up on this trip')}</span>
      <div className="grid gap-2 mb-2">
        <Picker value="" options={planOpts} onChange={v => add(v)} placeholder={t('ជ្រើសពី Delivery Plan', 'Choose from Delivery Plan')} />
        <div className="flex gap-2">
          <input className="in flex-1" inputMode="numeric" value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(typed); }} placeholder={t('វាយលេខ DN', 'Type the DN number')} aria-label="DN" />
          <button type="button" className="btn" onClick={() => add(typed)} disabled={!typed.trim()}>{t('បន្ថែម', 'Add')}</button>
          <button type="button" className="btn" onClick={() => setScan(true)} aria-label={t('ស្កេនបាកូដ', 'Scan barcode')}>📷</button>
        </div>
      </div>
      {err ? <Alert tone="bad">{err}</Alert> : null}
      <div className="grid gap-2">
        {p.lines.map(l => (
          <div key={l.dn} className="rounded-xl border-[1.5px] border-line p-2.5">
            <div className="flex items-center justify-between gap-2">
              <b>{l.dn}</b>
              <button type="button" className="btn btn-sm" onClick={() => p.setLines(p.lines.filter(x => x.dn !== l.dn))} aria-label={t('ដកចេញ', 'Remove')}>✕</button>
            </div>
            {l.inPlan ? (
              <div className="text-[13px] muted">{l.custName}{l.so ? ' · SO ' + l.so : ''}{p.planByDn[l.dn].plate && p.planByDn[l.dn].plate !== p.plate ? ' · ' + t('ផែនការ', 'plan') + ' ' + p.planByDn[l.dn].plate : ''}</div>
            ) : (
              <div className="grid gap-1.5 mt-1.5">
                <span className="text-[13px] text-warn font-semibold">{t('មិនមានក្នុង Delivery Plan: ជ្រើសអតិថិជន', 'Not in Delivery Plan: choose the customer')}</span>
                <Picker value={l.custName ? (l.custId ? l.custId + '-' : '') + l.custName : ''} options={p.custOpts} allowFree placeholder={t('អតិថិជន', 'Customer')}
                  onChange={(v, o) => { if (o) setLine(l.dn, { custId: o.sub || '', custName: o.label }); else setLine(l.dn, { custId: '', custName: v }); }} />
                <input className="in" inputMode="numeric" value={l.so} onChange={e => setLine(l.dn, { so: e.target.value.replace(/\s/g, '') })} placeholder={t('លេខ SO (មិនចាំបាច់)', 'SO number (optional)')} />
              </div>
            )}
          </div>
        ))}
      </div>
      {scan ? <Scanner onClose={() => setScan(false)} onCode={c => { setScan(false); add(c); }} /> : null}
    </section>
  );
}
