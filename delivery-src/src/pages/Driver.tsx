import { useEffect, useState } from 'react';
import { api, flushOutbox } from '../api';
import { errText, fmtTime, L, t, useLang } from '../i18n';
import type { Label, TripDn } from '../types';
import { Alert, Badge, Header, PhotoInput, Spinner, toast, Toaster } from '../components/ui';
import { useSubmit, warmLocation } from '../components/submit';
import { Field, Section, STEP_LOOK, scrollToMissing } from '../components/Form';
import { ProofFields, RateLinks, SiteRateForm } from '../components/Proof';

type DrvTrip = {
  trip: { id: string; plate: string; driver: string; round: string; stage: string; gateOut: number | null; closed?: boolean; dns: TripDn[] };
  stages: Record<string, Label>; legs: Record<string, Label>; rate?: Record<string, string>; siteRated?: string[];
};
const DONE = ['delivered', 'failed', 'canceled', 'moved'];

/**
 * Driver page (?t=trip&k=key): no sign-in. The signed link allows only this trip's
 * Arrived / Delivered / Delivery Failed steps, until the trip is finished.
 */
export function DriverPage(p: { tripId: string; k: string }) {
  useLang();
  const [d, setD] = useState<DrvTrip | null>(null);
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  const [code, setCode] = useState<8 | 9 | 11>(8);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [kg, setKg] = useState<Record<string, string>>({});
  const [part, setPart] = useState<Record<string, boolean>>({});
  const [photo, setPhoto] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [signature, setSignature] = useState('');
  const [receiver, setReceiver] = useState('');
  const [remark, setRemark] = useState('');
  const [formErr, setFormErr] = useState('');
  const [queued, setQueued] = useState(false);
  const sub = useSubmit('drvRecord');
  useEffect(() => {
    api<DrvTrip>('drvTrip', { t: p.tripId, k: p.k }, { noAuth: true })
      .then(x => {
        setD(x); setErr('');
        const open = x.trip.dns.filter(z => DONE.indexOf(z.leg) < 0);
        if (open.length === 1) setPicked({ [open[0].dn]: true });
        setCode(open.some(z => z.leg === 'at_customer') ? 9 : 8);
      })
      .catch(e => setErr(errText(e.message)));
  }, [n]);

  const [tried, setTried] = useState(false);
  useEffect(() => { setTried(false); warmLocation(); }, [code]);
  // Photos sent after the step: keep trying while this page is open.
  useEffect(() => { const iv = setInterval(() => { if (navigator.onLine) flushOutbox(); }, 30000); return () => clearInterval(iv); }, []);

  function missing() {
    const sel = Object.keys(picked).filter(k => picked[k]);
    const m: Record<string, string> = {};
    if (!sel.length) m.picked = t('សូមជ្រើសរើស DN', 'Choose the DN(s)');
    if (code === 9) {
      sel.forEach(dn => { if (!(Number(kg[dn]) > 0)) m['kg_' + dn] = t('សូមវាយទំងន់ (kg)', 'Type the weight (kg)'); });
      if (!receiver.trim()) m.receiver = t('សូមវាយឈ្មោះអ្នកទទួល', 'Type the receiver name');
      if (!signature) m.signature = t('សូមឲ្យអ្នកទទួលចុះហត្ថលេខា', 'Ask the receiver to sign');
      if (!photos.length) m.photos = t('សូមថតរូប (១–៥ រូប)', 'Take the photos (1–5)');
    } else if (!photo) m.photo = t('សូមថតរូបបុង / ភស្តុតាង', 'Take the delivery note / proof photo');
    if (code === 11 && remark.trim().length < 3) m.remark = t('សូមសរសេរមូលហេតុ', 'Write the reason');
    return m;
  }
  const miss = tried ? missing() : {};

  async function send() {
    setFormErr('');
    const sel = Object.keys(picked).filter(k => picked[k]);
    const m = missing();
    setTried(true);
    if (Object.keys(m).length) { setFormErr(t('សូមបំពេញចន្លោះពណ៌ក្រហម។', 'Please fill in the fields marked in red.')); scrollToMissing(); return; }
    const dns = sel.map(dn => (code === 9 ? { dn, kg: Number(kg[dn]) || 0, final: !part[dn] } : { dn }));
    const proof = code === 9 ? { photos, signature, receiver: receiver.trim() } : { photo };
    const r = await sub.send(Object.assign({ t: p.tripId, k: p.k, code, dns, remark: remark.trim() }, proof), (code === 8 ? 'Arrived' : code === 9 ? 'Delivered' : 'Failed') + ' · ' + p.tripId);
    if (r.ok) { toast('✅ ' + t('បានកត់ត្រា', 'Recorded')); setTried(false); setFormErr(''); setPicked({}); setKg({}); setPart({}); setPhoto(''); setPhotos([]); setSignature(''); setReceiver(''); setRemark(''); setN(n + 1); }
    else if ('queued' in r && r.queued) setQueued(true);
  }

  const tr = d && d.trip;
  const open = tr ? tr.dns.filter(z => DONE.indexOf(z.leg) < 0) : [];
  const lk = STEP_LOOK[code];
  return (
    <>
      <Header title={t('តៃកុង', 'Driver')} sub={tr ? tr.plate + ' · ' + tr.id : ''} />
      <main className="max-w-xl mx-auto p-3 sm:p-4 grid gap-3">
        {err ? <Alert tone={/finished|បញ្ចប់/.test(err) ? 'ok' : 'bad'}>{err}</Alert> : null}
        {queued ? <Alert tone="warn">⏳ {t('គ្មានអ៊ីនធឺណិត។ រក្សាទុកក្នុងទូរស័ព្ទ ហើយនឹងផ្ញើពេលមានសេវា។ កុំបិទទំព័រនេះ។', 'No connection. Saved on the phone and sent when there is signal. Keep this page open.')}</Alert> : null}
        {!d && !err ? <Spinner /> : null}
        {tr ? (
          <>
            <section className="card">
              <div className="flex justify-between items-start gap-2">
                <div><div className="text-[22px] font-bold">{tr.plate}</div><div className="muted text-[13px]">{tr.id} · {tr.round}{tr.driver ? ' · ' + tr.driver : ''}</div></div>
                <Badge k={tr.stage} label={d!.stages[tr.stage]} />
              </div>
              <div className="text-[13px] mt-1">⬆ {t('ចេញពីកន្លែងថ្លឹង', 'Gate Out')} {fmtTime(tr.gateOut)}</div>
            </section>
            {!open.length ? <Alert tone="ok">{t('DN ទាំងអស់បានកត់ត្រារួច។ សូមអរគុណ!', 'All DNs are recorded. Thank you!')}</Alert> : (
              <>
                <Section icon="🧭" title={t('ជំហាន', 'Step')} color={lk.color}>
                  <div className="grid gap-2">
                    {([[8, '៨. មកដល់ទីតាំងទំលាក់', 'Arrived at the customer'], [9, '៩. បានប្រគល់ទំនិញ', 'Delivered'], [11, 'x. ការដឹកជញ្ជូនបរាជ័យ', 'Delivery failed']] as [8 | 9 | 11, string, string][]).map(([c, km, en]) => {
                      const l = STEP_LOOK[c], on = code === c;
                      return (
                        <button key={c} type="button" onClick={() => setCode(c)} aria-pressed={on}
                          className={'flex items-center gap-3 text-left rounded-xl border-2 px-3 py-2.5 text-[16px] cursor-pointer ' + (on ? 'font-bold' : 'border-line bg-card')}
                          style={on ? { borderColor: l.color, background: l.color + '1a', color: l.color } : undefined}>
                          <span className="w-9 h-9 rounded-lg flex items-center justify-center text-[20px]" style={{ background: l.color + '22' }}>{l.icon}</span>{t(km, en)}
                        </button>
                      );
                    })}
                  </div>
                </Section>
                <Section icon="📄" title="DN" color={lk.color}>
                  <Field icon="☑️" label={t('ជ្រើស DN', 'Choose the DN(s)')} required error={miss.picked}>
                  <div className="grid gap-2">
                    {open.map(z => (
                      <div key={z.dn} className={'rounded-xl border-[1.5px] p-2.5 ' + (picked[z.dn] ? 'border-accent bg-soft' : 'border-line')}>
                        <label className="flex items-start gap-2.5">
                          <input type="checkbox" className="w-5 h-5 mt-0.5" checked={!!picked[z.dn]} onChange={e => setPicked(Object.assign({}, picked, { [z.dn]: e.target.checked }))} />
                          <span><b>📄 {z.dn}</b> <span className="muted text-[13px]">{L(d!.legs[z.leg])}</span><span className="block muted text-[13px]">{z.cust}</span></span>
                        </label>
                        {code === 9 && picked[z.dn] ? (
                          <div className="grid gap-2 mt-2 pl-7">
                            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" className="w-5 h-5" checked={!!part[z.dn]} onChange={e => setPart(Object.assign({}, part, { [z.dn]: e.target.checked }))} />{t('ប្រគល់តែមួយផ្នែក (នៅសល់ដឹកជើងក្រោយ)', 'Only part delivered (rest comes on another trip)')}</label>
                            <label className="font-bold text-[14px]">⚖️ {t('ទំងន់ដែលប្រគល់ (kg)', 'Delivered weight (kg)')} <span className="text-bad">*</span></label>
                            <input className={'in ' + (miss['kg_' + z.dn] ? '!border-bad' : '')} data-missing={miss['kg_' + z.dn] ? '1' : undefined} inputMode="decimal" value={kg[z.dn] || ''} onChange={e => setKg(Object.assign({}, kg, { [z.dn]: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder="kg" aria-label="kg" />
                            {miss['kg_' + z.dn] ? <span className="text-bad text-[13px] font-semibold">⚠️ {miss['kg_' + z.dn]}</span> : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  </Field>
                </Section>
                {code === 9 ? <ProofFields receiver={receiver} setReceiver={setReceiver} signature={signature} setSignature={setSignature} photos={photos} setPhotos={setPhotos} miss={miss} /> : (
                  <Section icon="📸" title={t('ភស្តុតាង', 'Proof')} color={lk.color}>
                    <Field icon="🧾" label={t('រូបថតបុង / ភស្តុតាង', 'Delivery note / proof photo')} required error={miss.photo}><PhotoInput value={photo} onChange={setPhoto} /></Field>
                  </Section>
                )}
                <Section icon="📝" title={t('កំណត់សំគាល់', 'Remark')} color="#546274">
                  <Field icon="💬" label={code === 11 ? t('មូលហេតុ', 'Reason') : t('កំណត់សំគាល់', 'Remark')} required={code === 11} optional={code !== 11} htmlFor="drm" error={miss.remark}>
                    <textarea id="drm" className={'in min-h-[64px] ' + (miss.remark ? '!border-bad' : '')} value={remark} onChange={e => setRemark(e.target.value)} placeholder={code === 11 ? t('សរសេរមូលហេតុ', 'Write the reason') : t('មិនចាំបាច់', 'Optional')} />
                  </Field>
                </Section>
                {formErr ? <Alert tone="bad">{formErr}</Alert> : null}
                {sub.error ? <Alert tone="bad">{sub.error}</Alert> : null}
                <button type="button" data-testid="save" className="btn w-full text-[17px] font-bold text-white border-0 min-h-[54px] mb-6 shadow-md" style={{ background: lk.color }} disabled={sub.sending} onClick={send}>{sub.sending ? '⏳ ' + t('កំពុងរក្សាទុក…', 'Saving…') : lk.icon + ' ' + t('កត់ត្រា', 'Record')}</button>
              </>
            )}
            {d!.rate ? <RateLinks tripId={tr.id} links={d!.rate} /> : null}
            {d!.rate ? <SiteRateForm key={n} dns={Object.keys(d!.rate).filter(dn => (d!.siteRated || []).indexOf(dn) < 0)}
              send={body => api('drvSiteRate', Object.assign({ t: p.tripId, k: p.k }, body), { noAuth: true })} onDone={() => setN(n + 1)} /> : null}
          </>
        ) : null}
      </main>
      {sub.dialog}
      <Toaster />
    </>
  );
}
