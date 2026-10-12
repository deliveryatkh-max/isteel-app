import { useEffect, useMemo, useRef, useState } from 'react';
import { L, t, useLang, kg as fmtKg } from '../i18n';
import { go, openTrips, tripHref, useApp, useRoute } from '../state';
import type { EventDef, PlanRow, TripSummary } from '../types';
import { Alert, Badge, Opt, PhotoInput, Picker, Segmented, toast } from '../components/ui';
import { Field, Section, STEP_LOOK, StepSelect, scrollToMissing } from '../components/Form';
import { warmLocation } from '../components/submit';
import { Scanner } from '../components/Scanner';
import { useSubmit } from '../components/submit';
import { MultiPhoto, ProofFields, RateLinks, SiteRateForm, siteRateSigned } from '../components/Proof';

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
  const [done, setDone] = useState<{ tripId: string; round: string; code: number; queued?: boolean; saving?: boolean; label?: string; rate?: Record<string, string>; siteRated?: boolean } | null>(null);
  const seq = useRef(0);   // which save the screen is showing (the user may move on before the answer comes back)
  const [formErr, setFormErr] = useState('');
  const sub = useSubmit('record');
  useEffect(() => { warmLocation(); }, [code, tripId]);   // GPS ready before Save is pressed

  useEffect(() => { const q = route.q.get('trip'); if (q) setTripId(q); const c = Number(route.q.get('code')); if (c) setCode(c); }, [route]);
  // Changing step or trip starts a clean form.
  useEffect(() => { setPicked({}); setDelivered({}); setLines([]); setPhoto(''); setPhotos([]); setSignature(''); setReceiver(''); setRemark(''); setFormErr(''); sub.setError(''); }, [code, tripId]);
  useEffect(() => {
    if (!trip) return;
    const open = trip.dns.filter(d => DONE_LEGS.indexOf(d.leg) < 0);
    if (open.length === 1 && [8, 9, 11].indexOf(code) >= 0) setPicked({ [open[0].dn]: true });
  }, [trip && trip.id, code]);

  const planByDn = useMemo(() => { const m: Record<string, PlanRow> = {}; boot.plan.forEach(p => { m[p.dn] = p; }); return m; }, [boot.plan]);
  // ISI trucks, then rented / customer trucks added before ("Add new truck", like the Fuel app).
  const plateOpts: Opt[] = useMemo(() => {
    const isi = new Set(boot.plates.map(p => p.plate));
    return boot.plates.map(p => ({ value: p.plate, label: '🏭 ' + p.plate, sub: p.type }))
      .concat((boot.trucks || []).filter(x => !isi.has(x.plate)).map(x => ({ value: x.plate, label: (x.type === 'customer' ? '🧑‍💼 ' : '🚛 ') + x.plate, sub: [x.co, x.type === 'customer' ? t('ឡានអតិថិជន', 'Customer truck') : t('ឡានជួល', 'Rented')].filter(Boolean).join(' · ') })));
  }, [boot.plates, boot.trucks, lang]);
  const driverOpts: Opt[] = useMemo(() => {
    const mineFirst = boot.drivers.slice().sort((a, b) => Number(b.plate === plate) - Number(a.plate === plate));
    return mineFirst.map(d => ({ value: d.name, label: d.name, sub: [d.plate, d.co].filter(Boolean).join(' · ') }));
  }, [boot.drivers, plate]);
  const tripOpts: Opt[] = useMemo(() => trips.map(x => ({ value: x.id, label: x.plate + ' · ' + x.round, sub: x.id + ' · ' + L(boot.stages[x.stage]) + (x.dns.length ? ' · ' + x.dns.map(d => d.dn).join(', ') : '') })), [trips, lang]);
  const custOpts: Opt[] = useMemo(() => boot.customers.map(c => ({ value: c.id + '-' + c.name, label: c.name, sub: c.id })), [boot.customers]);
  const whOpts: Opt[] = useMemo(() => boot.warehouses.map(w => ({ value: w, label: w })), [boot.warehouses]);
  const coOpts: Opt[] = useMemo(() => (boot.companies || []).map(c => ({ value: c, label: c })), [boot.companies]);

  const openDns = trip ? trip.dns.filter(d => DONE_LEGS.indexOf(d.leg) < 0) : [];

  // Opened from the DN scan: that DN is already chosen, and Delivered starts with its plan weight.
  const fromScan = route.q.get('from') === 'scan';
  useEffect(() => {
    const d = route.q.get('dn');
    if (!d || !trip) return;
    const pl = planByDn[d];
    if (code === 2) {
      if (trip.dns.some(x => x.dn === d)) return;
      setLines([{ dn: d, custId: pl ? pl.custId : '', custName: pl ? pl.custName : '', so: pl ? pl.so : '', kg: '', final: true, inPlan: !!pl }]);
    } else if ([8, 9, 10, 11].indexOf(code) >= 0 && openDns.some(x => x.dn === d)) {
      setPicked({ [d]: true });
      if (code === 9 && pl && pl.kg) setDelivered({ [d]: { kg: String(pl.kg), final: true } });
    }
  }, [code, tripId, trip && trip.dns.length]);

  function choosePlate(v: string) {
    setPlate(v);
    const known = boot.plates.some(p => p.plate === v);
    const tk = (boot.trucks || []).find(x => x.plate === v);
    setTruckType(known ? 'isi' : tk ? tk.type : 'rented');
    setCompany(known ? '' : tk ? tk.co : (boot.plateCo || {})[v] || '');
    const d = boot.drivers.filter(x => x.plate === v);
    if (d.length === 1) setDriver(d[0].name);
  }

  // Every field is required except the remark (Kim, 12 Oct 2026): what is missing turns red with its own message.
  // After the first Save, red marks follow the form live: a field filled in loses its mark at once.
  const [tried, setTried] = useState(false);
  useEffect(() => { setTried(false); }, [code, tripId]);

  function missing(): Record<string, string> {
    const m: Record<string, string> = {};
    if (code === 1) {
      if (!plate) m.plate = t('សូមជ្រើស ឬបន្ថែមផ្លាកលេខឡាន', 'Choose or add the truck plate');
      if (!driver.trim()) m.driver = t('សូមជ្រើស ឬវាយឈ្មោះតៃកុង', 'Choose or type the driver');
      if (truckType !== 'isi' && !company.trim()) m.company = t('សូមជ្រើស ឬវាយឈ្មោះក្រុមហ៊ុន', 'Choose or type the company');
      if (!photos.length) m.photos = t('សូមថតរូបឡាន (១–៥ រូប)', 'Take the truck photos (1–5)');
      return m;
    }
    if (!trip) { m.trip = t('សូមជ្រើសរើសជើងដឹក', 'Choose the trip'); return m; }
    if (code === 2) {
      if (!lines.length) m.dns = t('សូមបន្ថែម DN យ៉ាងហោចណាស់មួយ', 'Add at least one DN');
      lines.forEach(l => {
        if (!l.inPlan && !l.custName) m['cust_' + l.dn] = t('សូមជ្រើសអតិថិជន', 'Choose the customer');
        if (!l.inPlan && !l.so.trim()) m['so_' + l.dn] = t('សូមវាយលេខ SO', 'Type the SO number');
      });
    }
    const sel = Object.keys(picked).filter(k => picked[k]);
    if ((code === 8 || code === 9 || code === 11) && !sel.length) m.picked = t('សូមជ្រើសរើស DN', 'Choose the DN(s)');
    if (code === 9) {
      sel.forEach(dn => { if (!(Number((delivered[dn] || { kg: '' }).kg) > 0)) m['kg_' + dn] = t('សូមវាយទំងន់ដែលប្រគល់ (kg)', 'Type the delivered weight (kg)'); });
      if (!receiver.trim()) m.receiver = t('សូមវាយឈ្មោះអ្នកទទួល', 'Type the receiver name');
      if (!signature) m.signature = t('សូមឲ្យអ្នកទទួលចុះហត្ថលេខា', 'Ask the receiver to sign');
      if (!photos.length) m.photos = t('សូមថតរូប (១–៥ រូប)', 'Take the photos (1–5)');
    }
    if (code === 6) {
      if (!wh) m.wh = t('សូមជ្រើសឃ្លាំង', 'Choose the warehouse');
      if (!(Number(loadKg) > 0)) m.loadKg = t('សូមវាយទំងន់ (kg)', 'Type the weight (kg)');
      if (!websling) m.websling = t('សូមជ្រើស ប្រើ ឬមិនប្រើ', 'Choose Yes or No');
      if (!photo) m.photo = t('សូមថតរូបទំនិញ', 'Take the goods photo');
    }
    if ((code === 8 || code === 11) && !photo) m.photo = t('សូមថតរូបបុង / ភស្តុតាង', 'Take the delivery note / proof photo');
    if ((code === 10 || code === 11) && remark.trim().length < 3) m.remark = t('សូមសរសេរមូលហេតុ', 'Write the reason');
    return m;
  }

  const miss = tried ? missing() : {};

  async function submit() {
    setFormErr('');
    if (!ev) return;
    const m = missing();
    setTried(true);
    if (Object.keys(m).length) { setFormErr(t('សូមបំពេញចន្លោះពណ៌ក្រហម។', 'Please fill in the fields marked in red.')); scrollToMissing(); return; }
    const p: any = { code, remark: remark.trim() };
    if (code === 1) {
      Object.assign(p, { plate, driver: driver.trim(), truckType, photos });
      if (truckType !== 'isi') p.company = company.trim();
    } else p.tripId = trip!.id;
    if (code === 2) p.dns = lines.map(l => ({ dn: l.dn, custId: l.custId, custName: l.custName, so: l.so }));
    if ([8, 9, 11, 10].indexOf(code) >= 0) {
      const sel = Object.keys(picked).filter(k => picked[k]);
      p.dns = sel.map(dn => {
        const d = delivered[dn] || { kg: '', final: true };
        return code === 9 ? { dn, kg: Number(d.kg) || 0, final: d.final } : { dn };
      });
    }
    if (code === 6) Object.assign(p, { wh, kg: Number(loadKg) || 0, websling: websling === 'yes', photo });
    if (code === 9) Object.assign(p, { photos, signature, receiver: receiver.trim() });
    if (code === 8 || code === 11) p.photo = photo;
    const label = L(ev) + ' · ' + (code === 1 ? plate : trip ? trip.plate + ' ' + trip.id : '');
    // The answer screen shows at once (Kim: saving felt slow); it fills in when the server answers.
    const my = ++seq.current;
    setDone({ tripId: p.tripId || '', round: trip ? trip.round : '', code, saving: true, label });
    const r = await sub.send(p, label);
    const here = seq.current === my;
    if (r.ok) {
      const rate: Record<string, string> = {};
      (r.data.rate || []).forEach((x: { dn: string; k: string }) => { rate[x.dn] = x.k; });
      if (here) setDone({ tripId: r.data.tripId, round: r.data.round, code, rate });
      toast('✅ ' + t('បានកត់ត្រា', 'Recorded') + (here ? '' : ': ' + label));
      refreshOps();
    } else if ('queued' in r && r.queued) {
      if (here) setDone({ tripId: p.tripId || '', round: '', code, queued: true });
    } else if (here) setDone(null);   // refused or "No, go back": the form is still filled in
  }

  function reset(nextTrip?: string, next?: number) {
    seq.current++;
    setDone(null); setTried(false); setFormErr(''); setPlate(''); setDriver(''); setPhoto(''); setPhotos([]); setSignature(''); setReceiver(''); setCompany(''); setRemark(''); setWh(''); setLoadKg(''); setWebsling(''); setLines([]); setPicked({}); setDelivered({});
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
          {done.saving ? (
            <>
              <div className="text-[44px] animate-pulse">⏳</div>
              <h2 className="text-lg font-bold m-0">{L(boot.events.find(e => e.code === done.code))}</h2>
              <p className="muted mb-0">{t('កំពុងរក្សាទុក… អ្នកអាចបន្តការងារបាន។', 'Saving… you can carry on.')}</p>
              {done.code === 1 ? <div className="my-3"><div className="muted text-sm">{t('លេខជើងដឹក', 'Trip ID')}</div><div className="text-[30px] font-bold text-muted">…</div></div> : <p className="muted">{done.tripId}</p>}
            </>
          ) : done.queued ? (
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
            {fromScan ? <button type="button" data-testid="scan-again" className="btn-primary text-[17px] min-h-[52px]" onClick={() => { seq.current++; go('/scan'); }}>📷 {t('ស្កេន DN បន្ទាប់', 'Scan next DN')}</button> : null}
            {done.code === 1 && canPickup && !done.queued && !done.saving ? <button type="button" className="btn-primary" onClick={() => reset(done.tripId, 2)}>➕ {t('បន្ថែម DN (ដល់កន្លែងចែកបុង)', 'Add DNs (Arrival-Pickup DN)')}</button> : null}
            {done.tripId && !done.queued && !done.saving ? <a className="btn no-underline" href={tripHref(done.tripId)}>🚚 {t('មើលជើងដឹក', 'Open trip')}</a> : null}
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
        {sub.dialog}
      </main>
    );
  }

  const suggested = nextCode(trip);
  const lk = STEP_LOOK[code] || { icon: '✔', color: '#084f6a' };
  return (
    <main className="max-w-2xl mx-auto p-3 sm:p-4 grid gap-3 pb-6">
      <Section icon="🧭" title={t('ជំហាន', 'Step')} color={lk.color}>
        <StepSelect events={mine} value={code} onChange={setCode} suggested={trip ? suggested : undefined} />
      </Section>

      {code === 1 ? (
        <Section icon="🚚" title={t('ព័ត៌មានឡាន', 'Truck details')} color={lk.color}>
          <Field icon="🔢" label={t('ផ្លាកលេខឡាន', 'Truck plate')} required htmlFor="plate" error={miss.plate}>
            <Picker id="plate" value={plate} options={plateOpts} onChange={choosePlate} upper digits bad={!!miss.plate} placeholder={t('ជ្រើសផ្លាកលេខ', 'Choose the plate')}
              addNew={{ button: '➕ ' + t('បន្ថែមឡានថ្មី', 'Add new truck'), placeholder: t('ផ្លាកលេខ ឧ. 3F-1234', 'Plate, e.g. 3F-1234'), check: plateCheck }} />
          </Field>
          <Field icon="🏷️" label={t('ប្រភេទឡាន', 'Truck type')} required>
            <Segmented value={truckType} onChange={setTruckType} options={[{ v: 'isi', km: '🏭 ឡាន ISI', en: '🏭 ISI truck' }, { v: 'rented', km: '🚛 ឡានជួល', en: '🚛 Rented' }, { v: 'customer', km: '🧑‍💼 ឡានអតិថិជន', en: '🧑‍💼 Customer truck' }]} />
          </Field>
          <Field icon="👷" label={t('ឈ្មោះតៃកុង', 'Driver')} required htmlFor="driver" error={miss.driver}>
            <Picker id="driver" value={driver} options={driverOpts} onChange={v => setDriver(v)} allowFree bad={!!miss.driver} placeholder={t('ជ្រើស ឬវាយឈ្មោះតៃកុង', 'Choose or type the driver')} />
          </Field>
          {truckType !== 'isi' ? (
            <Field icon="🏢" label={t('ក្រុមហ៊ុនដឹកជញ្ជូន (3PL)', 'Transport company (3PL)')} required htmlFor="co" error={miss.company}>
              <Picker id="co" value={company} options={coOpts} onChange={v => setCompany(v)} allowFree bad={!!miss.company} placeholder={t('ជ្រើស ឬវាយឈ្មោះក្រុមហ៊ុន', 'Choose or type the company')} />
            </Field>
          ) : null}
          <Field icon="📸" label={t('រូបថតឡាន (១–៥)', 'Truck photos (1–5)')} required error={miss.photos}>
            <MultiPhoto value={photos} onChange={setPhotos} />
          </Field>
        </Section>
      ) : (
        <Section icon="🚚" title={t('ជើងដឹក', 'Trip')} color={lk.color}>
          <Field icon="🔎" label={t('ជើងដឹក', 'Trip')} required htmlFor="trip" error={miss.trip}>
            <Picker id="trip" value={tripId} options={tripOpts} onChange={v => setTripId(v)} bad={!!miss.trip} placeholder={t('ជ្រើសរើសឡាន / ជើងដឹក', 'Choose the truck / trip')} />
            {trip ? (
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[13.5px]">
                <Badge k={trip.stage} label={boot.stages[trip.stage]} /><span className="muted">{trip.id}</span>{trip.driver ? <span className="muted">· 👷 {trip.driver}</span> : null}
              </div>
            ) : !trips.length ? <p className="muted text-sm mt-2 mb-0">{t('មិនមានជើងដឹកកំពុងដំណើរការ។ ចាប់ផ្តើមដោយ ចូលថ្លឹង។', 'No open trips. Start one with Gate In.')}</p> : null}
          </Field>
        </Section>
      )}

      {code === 2 && trip ? <DnAdder lines={lines} setLines={setLines} planByDn={planByDn} plate={trip.plate} onTrip={trip.dns.map(d => d.dn)} custOpts={custOpts} plan={boot.plan} miss={miss} color={lk.color} /> : null}

      {[8, 9, 10, 11].indexOf(code) >= 0 && trip ? (
        <Section icon="📄" title={code === 10 ? t('DN ដែលលុបចោល', 'DNs to cancel') : t('DN', 'DN')} color={lk.color}>
          <Field icon="☑️" label={code === 10 ? t('ទុកទទេ = លុបចោលជើងដឹកទាំងមូល', 'None = cancel the whole trip') : t('ជ្រើស DN', 'Choose the DN(s)')} required={code !== 10} error={miss.picked}>
            {!openDns.length ? <p className="muted text-sm m-0">{t('ជើងដឹកនេះមិនមាន DN បើកទេ។', 'This trip has no open DN.')}</p> : null}
            <div className="grid gap-2">
              {openDns.map(d => {
                const on = !!picked[d.dn];
                const pl = planByDn[d.dn];
                const dv = delivered[d.dn] || { kg: '', final: true };
                const kgMiss = miss['kg_' + d.dn];
                return (
                  <div key={d.dn} className={'rounded-xl border-[1.5px] p-2.5 ' + (on ? 'border-accent bg-soft' : 'border-line')}>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input type="checkbox" className="w-5 h-5 mt-0.5 accent-[#0b76a0]" checked={on} onChange={e => setPicked(Object.assign({}, picked, { [d.dn]: e.target.checked }))} />
                      <span className="min-w-0"><b>📄 {d.dn}</b> <span className="muted text-[13px]">{L(boot.legs[d.leg])}</span>
                        <span className="block text-[13px] muted truncate">🏢 {d.cust}{pl && pl.kg ? ' · ' + t('ផែនការ', 'plan') + ' ' + fmtKg(pl.kg) : ''}</span></span>
                    </label>
                    {code === 9 && on ? (
                      <div className="grid gap-2 mt-2 pl-7" data-missing={kgMiss ? '1' : undefined}>
                        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" className="w-5 h-5 accent-[#0b76a0]" checked={dv.final} onChange={e => setDelivered(Object.assign({}, delivered, { [d.dn]: { kg: dv.kg, final: e.target.checked } }))} />
                          {t('DN នេះប្រគល់គ្រប់ (ឬផ្នែកចុងក្រោយ)', 'This finishes the DN (all, or the last part)')}</label>
                        <label className="font-bold text-[14px]">⚖️ {t('ទំងន់ដែលប្រគល់ (kg)', 'Delivered weight (kg)')} <span className="text-bad">*</span></label>
                        <input className={'in ' + (kgMiss ? '!border-bad' : '')} inputMode="decimal" value={dv.kg} onChange={e => setDelivered(Object.assign({}, delivered, { [d.dn]: { kg: e.target.value.replace(/[^0-9.]/g, ''), final: dv.final } }))}
                          placeholder={pl && pl.kg ? String(pl.kg) : 'kg'} aria-label="kg" />
                        {kgMiss ? <span className="text-bad text-[13px] font-semibold">⚠️ {kgMiss}</span> : null}
                        {pl && pl.kg && Number(dv.kg) > 0 && Number(dv.kg) < pl.kg * 0.995 ? <span className="text-[12.5px] text-warn font-semibold">{t('តិចជាងផែនការ (' + fmtKg(pl.kg) + '): DN នឹងនៅ ប្រគល់មួយផ្នែក រហូតដល់គ្រប់ទំងន់។', 'Less than the plan (' + fmtKg(pl.kg) + '): the DN stays Partly delivered until the weight is complete.')}</span> : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Field>
        </Section>
      ) : null}

      {code === 6 && trip ? (
        <Section icon="🏗️" title={t('ការផ្ទុកទំនិញ', 'Loading')} color={lk.color}>
          <Field icon="🏬" label={t('ឃ្លាំង', 'Warehouse')} required htmlFor="wh" error={miss.wh}>
            <Picker id="wh" value={wh} options={whOpts} onChange={v => setWh(v)} bad={!!miss.wh} placeholder={t('ជ្រើសឃ្លាំង', 'Choose the warehouse')} />
          </Field>
          <Field icon="⚖️" label={t('ទំងន់ (kg)', 'Weight (kg)')} required htmlFor="loadkg" error={miss.loadKg}>
            <input id="loadkg" className={'in ' + (miss.loadKg ? '!border-bad' : '')} inputMode="decimal" value={loadKg} onChange={e => setLoadKg(e.target.value.replace(/[^0-9.]/g, ''))} />
          </Field>
          <Field icon="🪢" label={t('ប្រើ Websling?', 'Websling used?')} required error={miss.websling}>
            <Segmented value={websling} onChange={setWebsling} options={[{ v: 'yes', km: '✅ ប្រើ', en: '✅ Yes' }, { v: 'no', km: '❌ មិនប្រើ', en: '❌ No' }]} />
          </Field>
          <Field icon="📸" label={t('រូបថតទំនិញ', 'Goods photo')} required error={miss.photo}>
            <PhotoInput value={photo} onChange={setPhoto} />
          </Field>
        </Section>
      ) : null}

      {code === 9 && trip ? <ProofFields receiver={receiver} setReceiver={setReceiver} signature={signature} setSignature={setSignature} photos={photos} setPhotos={setPhotos} miss={miss} /> : null}
      {[8, 11].indexOf(code) >= 0 && trip ? (
        <Section icon="📸" title={t('ភស្តុតាង', 'Proof')} color={lk.color}>
          <Field icon="🧾" label={t('រូបថតបុង / ភស្តុតាង', 'Delivery note / proof photo')} required error={miss.photo}>
            <PhotoInput value={photo} onChange={setPhoto} />
          </Field>
        </Section>
      ) : null}

      <Section icon="📝" title={t('កំណត់សំគាល់', 'Remark')} color="#546274">
        <Field icon="💬" label={code === 10 || code === 11 ? t('មូលហេតុ', 'Reason') : t('កំណត់សំគាល់', 'Remark')} required={code === 10 || code === 11} optional={!(code === 10 || code === 11)} htmlFor="remark" error={miss.remark}>
          <textarea id="remark" className={'in min-h-[70px] ' + (miss.remark ? '!border-bad' : '')} value={remark} onChange={e => setRemark(e.target.value)}
            placeholder={code === 10 || code === 11 ? t('សរសេរមូលហេតុ', 'Write the reason') : t('មិនចាំបាច់', 'Optional')} />
        </Field>
      </Section>

      {formErr ? <Alert tone="bad">{formErr}</Alert> : null}
      {sub.error ? <Alert tone="bad">{sub.error}</Alert> : null}
      <button type="button" data-testid="save" className="btn w-full text-[17px] font-bold text-white border-0 min-h-[54px] shadow-md" style={{ background: lk.color }} onClick={submit} disabled={sub.sending}>
        {sub.sending ? '⏳ ' + t('កំពុងរក្សាទុក…', 'Saving…') : lk.icon + ' ' + t('កត់ត្រា', 'Record') + ' ' + (ev ? L(ev) : '')}
      </button>
      {sub.dialog}
    </main>
  );
}

/** Plate typed in "Add new truck": same rule as the server. */
function plateCheck(v: string) {
  const s = v.toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9\u1780-\u17FF.-]{3,15}$/.test(s) && /\d/.test(s) ? '' : t('ផ្លាកលេខមិនត្រឹមត្រូវ (ឧ. 3F-1234)', 'That plate does not look right (e.g. 3F-1234)');
}

/** Arrival-Pickup DN: add DNs from the plan, by typing, or by scanning the Delivery Note barcode. */
function DnAdder(p: { lines: DnLine[]; setLines: (l: DnLine[]) => void; planByDn: Record<string, PlanRow>; plate: string; onTrip: string[]; custOpts: Opt[]; plan: PlanRow[]; miss: Record<string, string>; color: string }) {
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
    <Section icon="📄" title={t('DN ដែលយកនៅលើជើងនេះ', 'DNs picked up on this trip')} color={p.color}>
      <Field icon="➕" label={t('បន្ថែម DN', 'Add DNs')} required error={p.miss.dns}>
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
              <b>📄 {l.dn}</b>
              <button type="button" className="btn btn-sm" onClick={() => p.setLines(p.lines.filter(x => x.dn !== l.dn))} aria-label={t('ដកចេញ', 'Remove')}>✕</button>
            </div>
            {l.inPlan ? (
              <div className="text-[13px] muted">{l.custName}{l.so ? ' · SO ' + l.so : ''}{p.planByDn[l.dn].plate && p.planByDn[l.dn].plate !== p.plate ? ' · ' + t('ផែនការ', 'plan') + ' ' + p.planByDn[l.dn].plate : ''}</div>
            ) : (
              <div className="grid gap-1.5 mt-1.5">
                <span className="text-[13px] text-warn font-semibold">{t('មិនមានក្នុង Delivery Plan: ជ្រើសអតិថិជន', 'Not in Delivery Plan: choose the customer')}</span>
                <div data-missing={p.miss['cust_' + l.dn] ? '1' : undefined}>
                  <Picker value={l.custName ? (l.custId ? l.custId + '-' : '') + l.custName : ''} options={p.custOpts} allowFree bad={!!p.miss['cust_' + l.dn]} placeholder={'🏢 ' + t('អតិថិជន *', 'Customer *')}
                    onChange={(v, o) => { if (o) setLine(l.dn, { custId: o.sub || '', custName: o.label }); else setLine(l.dn, { custId: '', custName: v }); }} />
                  {p.miss['cust_' + l.dn] ? <span className="text-bad text-[13px] font-semibold">⚠️ {p.miss['cust_' + l.dn]}</span> : null}
                </div>
                <div data-missing={p.miss['so_' + l.dn] ? '1' : undefined}>
                  <input className={'in ' + (p.miss['so_' + l.dn] ? '!border-bad' : '')} inputMode="numeric" value={l.so} onChange={e => setLine(l.dn, { so: e.target.value.replace(/\s/g, '') })} placeholder={t('លេខ SO *', 'SO number *')} aria-label="SO" />
                  {p.miss['so_' + l.dn] ? <span className="text-bad text-[13px] font-semibold">⚠️ {p.miss['so_' + l.dn]}</span> : null}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      </Field>
      {scan ? <Scanner onClose={() => setScan(false)} onCode={c => { setScan(false); add(c); }} /> : null}
    </Section>
  );
}
