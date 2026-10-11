import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { errText, fmtDate, fmtDateTime, fmtTime, kg as fmtKg, L, t, useLang } from '../i18n';
import { dnHref, useApp } from '../state';
import type { LogRow, TripDetail } from '../types';
import { Alert, Badge, Kv, Modal, Spinner, toast } from '../components/ui';
import { nextCode } from './Record';

export function TripPage(p: { id: string }) {
  useLang();
  const { boot, tick, setBusy, refreshOps } = useApp();
  const [d, setD] = useState<TripDetail | null>(null);
  const [err, setErr] = useState('');
  const [fix, setFix] = useState<LogRow | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(''); setBusy(true);
    api<TripDetail>('trip', { tripId: p.id })
      .then(x => { if (live) setD(x); })
      .catch(e => { if (live) setErr(errText(e.message)); })
      .finally(() => setBusy(false));
    return () => { live = false; };
  }, [p.id, tick, n]);

  if (err) return <main className="max-w-2xl mx-auto p-4"><Alert tone="bad">{err}</Alert></main>;
  if (!d) return <Spinner />;
  const next = nextCode(d);
  const canNext = !d.closed && boot.events.some(e => e.can);
  return (
    <main className="max-w-2xl mx-auto p-3 sm:p-4">
      <section className="card">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <div className="text-[22px] font-bold tracking-wide">{d.plate}</div>
            <div className="muted text-[13.5px]">{d.id} · {d.round}</div>
          </div>
          <Badge k={d.stage} label={boot.stages[d.stage]} />
        </div>
        <Kv k={t('តៃកុង', 'Driver')} v={d.driver || '–'} />
        <Kv k={t('ចូលថ្លឹង', 'Gate In')} v={fmtDateTime(d.gateIn)} />
        <Kv k={t('ចេញពីកន្លែងថ្លឹង', 'Gate Out')} v={fmtDateTime(d.gateOut)} />
        {d.legacy ? <p className="muted text-[13px] mt-2 mb-0">{t('ជើងដឹកនេះកត់ត្រាដោយ AppSheet (គ្មានក្នុងតារាង Trips)។', 'This trip was recorded in AppSheet (not in the Trips tab).')}</p> : null}
        {canNext ? <a className="btn-primary w-full mt-3 no-underline" href={'#/record?trip=' + encodeURIComponent(d.id) + '&code=' + next}>➕ {t('កត់ត្រាជំហានបន្ទាប់', 'Record the next step')}</a> : null}
      </section>

      {Object.keys(d.dnInfo).length ? (
        <section className="card">
          <h2 className="text-[15px] font-bold mt-0 mb-2">{t('DN នៅលើជើងនេះ', 'DNs on this trip')}</h2>
          {d.dns.map(x => {
            const i = d.dnInfo[x.dn];
            const others = i ? i.legs.filter(l => l.tripId !== d.id) : [];
            return (
              <div key={x.dn} className="border-b border-line last:border-0 py-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <a href={dnHref(x.dn)} className="font-bold text-brand">{x.dn}</a>
                  <span className="flex gap-1.5 flex-wrap">
                    <Badge k={x.leg} label={boot.legs[x.leg]} />
                    {i ? <Badge k={i.status} label={boot.dnStatuses[i.status]} /> : null}
                  </span>
                </div>
                <div className="muted text-[13px]">{x.cust}{x.kg ? ' · ' + t('ជើងនេះ', 'this trip') + ' ' + fmtKg(x.kg) : ''}{i && i.planKg ? ' · ' + t('ផែនការ', 'plan') + ' ' + fmtKg(i.planKg) : ''}</div>
                {others.length ? (
                  <div className="text-[13px] mt-0.5">{t('ជើងផ្សេង៖', 'Other trips:')} {others.map(l => <span key={l.tripId} className="mr-2">{l.tripId} ({l.plate}) {L(boot.legs[l.leg])}</span>)}</div>
                ) : null}
              </div>
            );
          })}
          <p className="muted text-[12.5px] mb-0 mt-1">{t('ស្ថានភាព DN គណនាពីជើងដឹកទាំងអស់ (មិនមែនតែជើងនេះ)។', 'DN status counts every trip that carried it, not only this one.')}</p>
        </section>
      ) : null}

      {d.driverLink ? <DriverLink tripId={d.id} token={d.driverLink} /> : null}

      <section className="card">
        <h2 className="text-[15px] font-bold mt-0 mb-2">{t('ប្រវត្តិជំហាន', 'Timeline')}</h2>
        <ol className="list-none m-0 p-0">
          {d.rows.map(r => (
            <li key={r.row} className="relative pl-5 pb-3 border-l-2 border-line ml-1.5 last:pb-0">
              <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-accent" />
              <div className="flex justify-between gap-2">
                <b className="text-[14.5px]">{eventLabel(boot, r)}</b>
                <span className="font-semibold whitespace-nowrap">{fmtTime(r.time)}</span>
              </div>
              <div className="muted text-[13px]">
                {[fmtDate(r.time), r.dn ? 'DN ' + r.dn : '', r.cust, r.wh, r.kg ? fmtKg(r.kg) : '', r.mode === 'Partial' ? t('មួយផ្នែក', 'part') : '', r.recorder, r.user].filter(Boolean).join(' · ')}
              </div>
              {r.remark ? <div className="text-[13.5px]">💬 {r.remark}</div> : null}
              <div className="flex gap-3 text-[13px]">
                {[r.truckPhoto, r.goodsPhoto, r.billPhoto].filter(Boolean).map((u, i) => <a key={i} href={u} target="_blank" rel="noopener">📷 {t('រូបថត', 'Photo')}</a>)}
                {r.latlong ? <a href={'https://maps.google.com/?q=' + r.latlong} target="_blank" rel="noopener">📍 {t('ទីតាំង', 'Location')}</a> : null}
                {boot.canCorrect ? <button type="button" className="text-accent bg-transparent border-0 p-0 cursor-pointer underline" onClick={() => setFix(r)}>✎ {t('កែម៉ោង', 'Correct time')}</button> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
      {fix ? <CorrectTime row={fix} onClose={() => setFix(null)} onDone={() => { setFix(null); setN(n + 1); refreshOps(); toast('✅ ' + t('បានកែ និងកត់ក្នុង Audit Log', 'Corrected and written to the Audit Log')); }} /> : null}
    </main>
  );
}

export function eventLabel(boot: { events: { code: number; kh: string; en: string }[] }, r: { code: number; eventText: string }) {
  const e = boot.events.find(x => x.code === r.code);
  return e ? L(e) : r.eventText || '–';
}

/** A link + QR the driver opens without signing in, to record Arrived / Delivered / Failed for this trip only. */
function DriverLink(p: { tripId: string; token: string }) {
  useLang();
  const url = location.origin + location.pathname + '?t=' + encodeURIComponent(p.tripId) + '&k=' + p.token;
  const [open, setOpen] = useState(false);
  const svg = useMemo(() => {
    if (!open || !window.qrcode) return '';
    const q = window.qrcode(0, 'M'); q.addData(url); q.make();
    return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }, [open, url]);
  const share = async () => {
    const text = t('តំណកត់ត្រាដឹកជញ្ជូន ', 'Delivery link ') + p.tripId;
    try {
      if (navigator.share) await navigator.share({ title: text, text, url });
      else { await navigator.clipboard.writeText(url); toast(t('បានចម្លងតំណ', 'Link copied')); }
    } catch { /* closed */ }
  };
  return (
    <section className="card">
      <h2 className="text-[15px] font-bold mt-0 mb-1">{t('តំណសម្រាប់តៃកុង', 'Driver link')}</h2>
      <p className="muted text-[13px] mt-0">{t('តៃកុងស្កេន QR ឬបើកតំណ ដើម្បីកត់ត្រា មកដល់ / ប្រគល់ / បរាជ័យ សម្រាប់ជើងនេះតែប៉ុណ្ណោះ (មិនចាំបាច់ចូលគណនី)។', 'The driver scans the QR or opens the link to record Arrived / Delivered / Failed for this trip only (no sign-in).')}</p>
      <div className="flex gap-2 flex-wrap">
        <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)}>▦ QR</button>
        <button type="button" className="btn btn-sm" onClick={share}>🔗 {t('ចែករំលែកតំណ', 'Share link')}</button>
      </div>
      {open ? (svg ? <div className="bg-white rounded-xl p-2 mt-3 mx-auto max-w-[260px]" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="muted text-sm">{url}</p>) : null}
    </section>
  );
}

/** Supervisor / Admin: change the time of one record, with the reason (written to Audit Log). */
function CorrectTime(p: { row: LogRow; onClose: () => void; onDone: () => void }) {
  const { boot } = useApp();
  useLang();
  // datetime-local in Cambodia time
  const local = (ms: number) => new Date(ms + 7 * 3600000).toISOString().slice(0, 16);
  const [v, setV] = useState(local(p.row.time));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setErr('');
    const ms = Date.parse(v + ':00+07:00');
    if (!ms) return setErr(t('ម៉ោងមិនត្រឹមត្រូវ។', 'The time is not valid.'));
    if (reason.trim().length < 3) return setErr(t('សូមសរសេរមូលហេតុ។', 'Write the reason.'));
    setSaving(true);
    try { await api('correct', { row: p.row.row, key: p.row.key, time: ms, reason: reason.trim() }); p.onDone(); }
    catch (e: any) { setErr(errText(e.message)); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={t('កែម៉ោង', 'Correct time')} onClose={p.onClose}>
      <p className="mt-0 text-[14px]"><b>{eventLabel(boot, p.row)}</b><br /><span className="muted">{p.row.key} · {t('ឥឡូវ', 'now')} {fmtDateTime(p.row.time)}</span></p>
      <label className="lbl" htmlFor="ct">{t('ម៉ោងថ្មី (ម៉ោងកម្ពុជា)', 'New time (Cambodia time)')}</label>
      <input id="ct" className="in mb-3" type="datetime-local" value={v} onChange={e => setV(e.target.value)} />
      <label className="lbl" htmlFor="cr">{t('មូលហេតុ', 'Reason')} *</label>
      <textarea id="cr" className="in mb-3 min-h-[64px]" value={reason} onChange={e => setReason(e.target.value)} />
      {err ? <Alert tone="bad">{err}</Alert> : null}
      <button type="button" className="btn-primary w-full" onClick={save} disabled={saving}>{saving ? t('កំពុងរក្សាទុក…', 'Saving…') : t('រក្សាទុក', 'Save')}</button>
    </Modal>
  );
}
