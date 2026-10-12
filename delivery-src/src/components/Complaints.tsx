import { useEffect, useState } from 'react';
import { api } from '../api';
import { errText, fmtDateTime, t, useLang } from '../i18n';
import { dnHref, tripHref, useApp } from '../state';
import type { Complaint } from '../types';
import { Alert, Modal, Spinner, toast } from './ui';

export const COMPLAINT_TYPE: Record<string, [string, string]> = {
  late: ['យឺត', 'Late'], driver: ['អាកប្បកិរិយាតៃកុង', 'Driver behaviour'], damage: ['ទំនិញខូច', 'Damaged goods'],
  short: ['ខ្វះទំនិញ', 'Short delivery'], wrong: ['ទំនិញខុស', 'Wrong goods'], other: ['ផ្សេងៗ', 'Other'],
};
const typeText = (k: string) => t(...(COMPLAINT_TYPE[k] || [k, k]));
const canResolve = (roleKey: string) => ['admin', 'supervisor', 'logistics'].indexOf(roleKey) >= 0;

/** One complaint with its Resolve button. */
export function ComplaintItem(p: { c: Complaint; showDn?: boolean; onChanged: (items: Complaint[]) => void }) {
  useLang();
  const { boot } = useApp();
  const c = p.c;
  const [fix, setFix] = useState(false);
  return (
    <div className="py-2 border-b border-line last:border-0 text-[14px]">
      <div className="flex justify-between gap-2 flex-wrap">
        <b>{c.id} · {typeText(c.type)}</b>
        <span className={'text-[12.5px] font-bold rounded-full px-2 py-0.5 ' + (c.status === 'Resolved' ? 'bg-oksoft text-ok' : 'bg-badsoft text-bad')}>{c.status === 'Resolved' ? t('បានដោះស្រាយ', 'Resolved') : t('កំពុងបើក', 'Open')}</span>
      </div>
      <div>{c.detail}</div>
      <div className="muted text-[12.5px]">
        {fmtDateTime(c.time)}
        {p.showDn ? <> · <a href={dnHref(c.dn)}>DN {c.dn}</a></> : null}
        {c.trip ? <> · <a href={tripHref(c.trip)}>{c.plate || c.trip}</a></> : null}
        {c.co ? ' · ' + c.co : ''}{c.cust ? ' · ' + c.cust : ''}{c.source ? ' · ' + c.source : ''}
      </div>
      {c.status === 'Resolved' ? <div className="text-[13px] text-ok">✔ {c.resolution} <span className="muted">({c.resolvedBy})</span></div>
        : canResolve(boot.user.roleKey) ? <button type="button" className="btn btn-sm mt-1" onClick={() => setFix(true)}>✔ {t('ដោះស្រាយ', 'Resolve')}</button> : null}
      {fix ? <Resolve c={c} onClose={() => setFix(false)} onDone={items => { setFix(false); p.onChanged(items); }} /> : null}
    </div>
  );
}

function Resolve(p: { c: Complaint; onClose: () => void; onDone: (items: Complaint[]) => void }) {
  useLang();
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (note.trim().length < 3) return setErr(t('សូមសរសេររបៀបដោះស្រាយ។', 'Write how it was resolved.'));
    setSaving(true); setErr('');
    try { const r = await api<{ items: Complaint[] }>('complaintResolve', { row: p.c.row, id: p.c.id, resolution: note.trim() }); toast('✅ ' + t('បានរក្សាទុក', 'Saved')); p.onDone(r.items); }
    catch (e: any) { setErr(errText(e.message)); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={t('ដោះស្រាយបណ្តឹង ', 'Resolve complaint ') + p.c.id} onClose={p.onClose}>
      <textarea className="in min-h-[80px] mb-3" value={note} onChange={e => setNote(e.target.value)} placeholder={t('បានដោះស្រាយយ៉ាងដូចម្តេច', 'How was it resolved?')} aria-label={t('ដំណោះស្រាយ', 'Resolution')} />
      {err ? <Alert tone="bad">{err}</Alert> : null}
      <button type="button" className="btn-primary w-full" disabled={saving} onClick={save}>{saving ? t('កំពុងរក្សាទុក…', 'Saving…') : t('រក្សាទុក', 'Save')}</button>
    </Modal>
  );
}

/** Complaints of one DN, with the form to add one (DN screen). */
export function DnComplaints(p: { dn: string; items: Complaint[]; trips: { id: string; plate: string }[] }) {
  useLang();
  const { boot } = useApp();
  const [items, setItems] = useState(p.items);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('');
  const [detail, setDetail] = useState('');
  const [source, setSource] = useState('');
  const [trip, setTrip] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setItems(p.items), [p.items]);
  const canAdd = !!boot.user.roleKey && boot.user.roleKey !== 'driver';
  const save = async () => {
    if (!type || detail.trim().length < 3) return setErr(t('សូមជ្រើសប្រភេទ ហើយពិពណ៌នាបណ្តឹង។', 'Choose the type and describe the complaint.'));
    setSaving(true); setErr('');
    try {
      const r = await api<{ items: Complaint[] }>('complaintAdd', { dn: p.dn, type, detail: detail.trim(), source: source.trim(), trip: trip || undefined });
      setItems(r.items); setOpen(false); setType(''); setDetail(''); setSource(''); toast('✅ ' + t('បានកត់ត្រាបណ្តឹង', 'Complaint recorded'));
    } catch (e: any) { setErr(errText(e.message)); }
    finally { setSaving(false); }
  };
  return (
    <section className="card">
      <div className="flex justify-between items-center gap-2 mb-1">
        <h2 className="text-[15px] font-bold m-0">📣 {t('បណ្តឹង', 'Complaints')} ({items.length})</h2>
        {canAdd && !open ? <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>➕ {t('បន្ថែម', 'Add')}</button> : null}
      </div>
      {open ? (
        <div className="grid gap-2 mb-2">
          <div className="flex flex-wrap gap-2">
            {(boot.complaintTypes || Object.keys(COMPLAINT_TYPE)).map(k => <button key={k} type="button" className={'chip ' + (type === k ? 'chip-on' : '')} onClick={() => setType(k)} aria-pressed={type === k}>{typeText(k)}</button>)}
          </div>
          {p.trips.length > 1 ? (
            <select className="in" value={trip} onChange={e => setTrip(e.target.value)} aria-label={t('ជើងដឹក', 'Trip')}>
              <option value="">{t('ជើងដែលប្រគល់ចុងក្រោយ', 'The trip that delivered last')}</option>
              {p.trips.map(x => <option key={x.id} value={x.id}>{x.plate} · {x.id}</option>)}
            </select>
          ) : null}
          <textarea className="in min-h-[70px]" value={detail} onChange={e => setDetail(e.target.value)} placeholder={t('ពិពណ៌នាបណ្តឹង', 'Describe the complaint')} aria-label={t('ពិពណ៌នា', 'Detail')} />
          <input className="in" value={source} onChange={e => setSource(e.target.value)} placeholder={t('ពីអ្នកណា / តាមអ្វី (ទូរស័ព្ទ, Telegram…)', 'From whom / how (phone, Telegram…)')} aria-label={t('ប្រភព', 'Source')} />
          {err ? <Alert tone="bad">{err}</Alert> : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('បោះបង់', 'Cancel')}</button>
            <button type="button" className="btn-primary" disabled={saving} onClick={save}>{saving ? t('កំពុងរក្សាទុក…', 'Saving…') : t('រក្សាទុក', 'Save')}</button>
          </div>
        </div>
      ) : null}
      {!items.length && !open ? <p className="muted text-sm m-0">{t('គ្មានបណ្តឹង', 'No complaints')}</p> : null}
      {items.map(c => <ComplaintItem key={c.id + c.row} c={c} onChanged={setItems} />)}
    </section>
  );
}

/** More → Complaints: open ones first. */
export function ComplaintsPage() {
  useLang();
  const { tick, setBusy } = useApp();
  const [status, setStatus] = useState('Open');
  const [items, setItems] = useState<Complaint[] | null>(null);
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    setBusy(true); setErr('');
    api<{ items: Complaint[] }>('complaints', { status }).then(r => setItems(r.items)).catch(e => setErr(errText(e.message))).finally(() => setBusy(false));
  }, [status, tick, n]);
  return (
    <main className="max-w-2xl mx-auto p-3 sm:p-4">
      <div className="flex gap-2 mb-3">
        {[['Open', 'កំពុងបើក', 'Open'], ['Resolved', 'បានដោះស្រាយ', 'Resolved'], ['', 'ទាំងអស់', 'All']].map(([v, km, en]) => (
          <button key={v} type="button" className={'chip ' + (status === v ? 'chip-on' : '')} onClick={() => setStatus(v)}>{t(km, en)}</button>
        ))}
      </div>
      <Alert tone="info">{t('បន្ថែមបណ្តឹងពីទំព័រ DN (ស្វែងរក DN → 📣 បណ្តឹង)។', 'Add a complaint from the DN screen (find the DN → 📣 Complaints).')}</Alert>
      {err ? <Alert tone="bad">{err}</Alert> : null}
      {!items ? <Spinner /> : !items.length ? <p className="muted text-center py-6">{t('គ្មានបណ្តឹង', 'No complaints')}</p> : (
        <section className="card">{items.map(c => <ComplaintItem key={c.id + c.row} c={c} showDn onChanged={() => setN(n + 1)} />)}</section>
      )}
    </main>
  );
}
