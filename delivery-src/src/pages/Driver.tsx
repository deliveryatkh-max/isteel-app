import { useEffect, useState } from 'react';
import { api } from '../api';
import { errText, fmtTime, L, t, useLang } from '../i18n';
import type { Label, TripDn } from '../types';
import { Alert, Badge, Header, PhotoInput, Spinner, toast, Toaster } from '../components/ui';
import { useSubmit } from '../components/submit';

type DrvTrip = { trip: { id: string; plate: string; driver: string; round: string; stage: string; gateOut: number | null; dns: TripDn[] }; stages: Record<string, Label>; legs: Record<string, Label> };
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

  async function send() {
    setFormErr('');
    const sel = Object.keys(picked).filter(k => picked[k]);
    if (!sel.length) return setFormErr(t('សូមជ្រើសរើស DN។', 'Choose the DN(s).'));
    if (code === 11 && remark.trim().length < 3) return setFormErr(t('សូមសរសេរមូលហេតុ។', 'Write the reason.'));
    const dns = sel.map(dn => (code === 9 ? { dn, kg: Number(kg[dn]) || 0, final: !part[dn] } : { dn }));
    const bad = dns.find((x: any) => code === 9 && !x.final && !x.kg);
    if (bad) return setFormErr(t('ប្រគល់មួយផ្នែក: សូមវាយទំងន់ (kg)។', 'Part delivery: type the weight (kg).'));
    const r = await sub.send({ t: p.tripId, k: p.k, code, dns, remark: remark.trim(), photo: photo || undefined }, (code === 8 ? 'Arrived' : code === 9 ? 'Delivered' : 'Failed') + ' · ' + p.tripId);
    if (r.ok) { toast('✅ ' + t('បានកត់ត្រា', 'Recorded')); setPicked({}); setKg({}); setPart({}); setPhoto(''); setRemark(''); setN(n + 1); }
    else if ('queued' in r && r.queued) setQueued(true);
  }

  const tr = d && d.trip;
  const open = tr ? tr.dns.filter(z => DONE.indexOf(z.leg) < 0) : [];
  return (
    <>
      <Header title={t('តៃកុង', 'Driver')} sub={tr ? tr.plate + ' · ' + tr.id : ''} />
      <main className="max-w-xl mx-auto p-3 sm:p-4">
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
                <section className="card">
                  <span className="lbl">{t('ជំហាន', 'Step')}</span>
                  <div className="grid gap-2">
                    {([[8, '៨. មកដល់ទីតាំងទំលាក់', 'Arrived at the customer'], [9, '៩. បានប្រគល់ទំនិញ', 'Delivered'], [11, 'x. ការដឹកជញ្ជូនបរាជ័យ', 'Delivery failed']] as [8 | 9 | 11, string, string][]).map(([c, km, en]) => (
                      <button key={c} type="button" onClick={() => setCode(c)} aria-pressed={code === c}
                        className={'text-left rounded-xl border-[1.5px] px-3 py-3 text-[16px] ' + (code === c ? 'border-accent bg-soft font-bold text-brand' : 'border-line bg-card')}>{t(km, en)}</button>
                    ))}
                  </div>
                </section>
                <section className="card">
                  <span className="lbl">DN</span>
                  <div className="grid gap-2">
                    {open.map(z => (
                      <div key={z.dn} className={'rounded-xl border-[1.5px] p-2.5 ' + (picked[z.dn] ? 'border-accent bg-soft' : 'border-line')}>
                        <label className="flex items-start gap-2.5">
                          <input type="checkbox" className="w-5 h-5 mt-0.5" checked={!!picked[z.dn]} onChange={e => setPicked(Object.assign({}, picked, { [z.dn]: e.target.checked }))} />
                          <span><b>{z.dn}</b> <span className="muted text-[13px]">{L(d!.legs[z.leg])}</span><span className="block muted text-[13px]">{z.cust}</span></span>
                        </label>
                        {code === 9 && picked[z.dn] ? (
                          <div className="grid gap-2 mt-2 pl-7">
                            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" className="w-5 h-5" checked={!!part[z.dn]} onChange={e => setPart(Object.assign({}, part, { [z.dn]: e.target.checked }))} />{t('ប្រគល់តែមួយផ្នែក (នៅសល់ដឹកជើងក្រោយ)', 'Only part delivered (rest comes on another trip)')}</label>
                            <input className="in" inputMode="decimal" value={kg[z.dn] || ''} onChange={e => setKg(Object.assign({}, kg, { [z.dn]: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder={t('ទំងន់ kg', 'Weight kg')} aria-label="kg" />
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
                <section className="card grid gap-3">
                  <PhotoInput label={t('រូបថតបុង (មិនចាំបាច់)', 'Delivery note photo (optional)')} value={photo} onChange={setPhoto} />
                  <div><label className="lbl" htmlFor="drm">{t('កំណត់សំគាល់', 'Remark')}{code === 11 ? ' *' : ''}</label>
                    <textarea id="drm" className="in min-h-[64px]" value={remark} onChange={e => setRemark(e.target.value)} placeholder={code === 11 ? t('មូលហេតុ (ចាំបាច់)', 'Reason (needed)') : t('មិនចាំបាច់', 'Optional')} /></div>
                </section>
                {formErr ? <Alert tone="bad">{formErr}</Alert> : null}
                {sub.error ? <Alert tone="bad">{sub.error}</Alert> : null}
                <button type="button" className="btn-primary w-full text-[17px] mb-6" disabled={sub.sending} onClick={send}>{sub.sending ? t('កំពុងរក្សាទុក…', 'Saving…') : '✔ ' + t('កត់ត្រា', 'Record')}</button>
              </>
            )}
          </>
        ) : null}
      </main>
      {sub.dialog}
      <Toaster />
    </>
  );
}
