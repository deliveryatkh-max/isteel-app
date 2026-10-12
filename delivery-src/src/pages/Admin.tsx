import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, flushOutbox, outbox } from '../api';
import { errText, fmtDateTime, L, t, useLang } from '../i18n';
import { matches, tripHref, useApp } from '../state';
import { Alert, Spinner, toast } from '../components/ui';

/** More: who is signed in, steps waiting on this phone, and the Supervisor / Admin screens. */
export function MorePage() {
  useLang();
  const { boot, refreshOps } = useApp();
  const items = useSyncExternalStore(outbox.subscribe, () => JSON.stringify(outbox.list()));
  const list = JSON.parse(items) as ReturnType<typeof outbox.list>;
  const Link = (p: { href: string; icon: string; km: string; en: string; sub?: string }) => (
    <a href={p.href} className="card flex items-center gap-3 no-underline text-ink !p-3.5">
      <span className="text-[24px]">{p.icon}</span>
      <span className="flex-1"><b>{t(p.km, p.en)}</b>{p.sub ? <small className="block muted">{p.sub}</small> : null}</span>
      <span className="muted">›</span>
    </a>
  );
  return (
    <main className="max-w-2xl mx-auto p-3 sm:p-4">
      <section className="card">
        <div className="muted text-[13px]">{t('ចូលជា', 'Signed in as')}</div>
        <b>{boot.user.name || boot.user.email}</b>
        <div className="muted text-[13.5px]">{boot.user.email} · {t('តួនាទី', 'Role')}: {boot.user.role || '–'}</div>
      </section>
      <section className="card" id="outbox">
        <h2 className="text-[15px] font-bold mt-0 mb-1">⏳ {t('រង់ចាំផ្ញើ', 'Waiting to send')} ({list.length})</h2>
        {!list.length ? <p className="muted text-sm m-0">{t('គ្មាន។ អ្វីៗទាំងអស់បានផ្ញើរួចហើយ។', 'Nothing. Everything has been sent.')}</p> : (
          <>
            {list.map(x => (
              <div key={x.ref} className="py-2 border-b border-line last:border-0 text-[14px]">
                <b>{x.label}</b><div className="muted text-[13px]">{fmtDateTime(x.at)}</div>
                {x.error ? (
                  <>
                    <div className="text-bad text-[13px] whitespace-pre-line">{errText(x.error.split('\n')[0])}</div>
                    <div className="flex gap-2 mt-1">
                      <button type="button" className="btn btn-sm" onClick={() => { outbox.save(outbox.list().map(y => (y.ref === x.ref ? Object.assign({}, y, { error: undefined, payload: Object.assign({}, y.payload, { confirm: ['OPEN_PREV_TRIP', 'NO_GATE_IN', 'NO_DN', 'ORDER', 'NOT_OUT', 'DN_NOT_IN_PLAN', 'DN_OPEN_ELSEWHERE', 'PLAN_OTHER_TRUCK'] }) }) : y))); flushOutbox(() => refreshOps()); }}>
                        {t('បញ្ជាក់ ហើយផ្ញើ', 'Confirm and send')}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => { if (confirm(t('លុបជំហាននេះចេញពីទូរស័ព្ទ?', 'Delete this step from the phone?'))) outbox.remove(x.ref); }}>🗑 {t('លុប', 'Delete')}</button>
                    </div>
                  </>
                ) : null}
              </div>
            ))}
            <button type="button" className="btn btn-sm mt-2" onClick={() => flushOutbox(() => { refreshOps(); toast('✅ ' + t('បានផ្ញើ', 'Sent')); })}>↻ {t('ផ្ញើឥឡូវ', 'Send now')}</button>
          </>
        )}
      </section>
      {boot.canKpi ? <Link href="#/dashboard" icon="📈" km="Dashboard" en="Dashboard" sub="OTIF · Turnaround · 3PL scorecard" /> : null}
      <Link href="#/complaints" icon="📣" km="បណ្តឹងអតិថិជន" en="Customer complaints" />
      <Link href="#/trips/history" icon="🗂️" km="ប្រវត្តិជើងដឹក" en="Trip history" />
      {boot.canCorrect ? <Link href="#/quality" icon="🩺" km="ពិនិត្យគុណភាពទិន្នន័យ" en="Data quality check" sub={t('បង្ហាញតែបញ្ហា មិនកែស្វ័យប្រវត្តិ', 'Shows problems only; nothing is changed')} /> : null}
      {boot.isAdmin ? <Link href="#/users" icon="👥" km="អ្នកប្រើប្រាស់ និងតួនាទី" en="Users and roles" /> : null}
    </main>
  );
}

type Issue = { type: string; trip: string; en: string; kh: string };
const TYPE_LABEL: Record<string, [string, string]> = {
  NO_GATE_IN: ['គ្មាន ចូលថ្លឹង', 'No Gate In'], PLATES: ['ឡានច្រើនលើជើងតែមួយ', 'Several trucks on one trip'], ORDER: ['លំដាប់ម៉ោងខុស', 'Times out of order'],
  REPEAT: ['កត់ត្រាស្ទួន', 'Recorded twice'], NO_PICKUP: ['គ្មាន ដល់កន្លែងចែកបុង', 'No Arrival-Pickup DN'], STALE: ['បើកយូរពេក', 'Open too long'],
  FAR: ['ឆ្ងាយពីទីតាំងអតិថិជន', 'Far from the customer site'],
};
export function QualityPage() {
  useLang();
  const { tick, setBusy } = useApp();
  const [d, setD] = useState<{ issues: Issue[]; total: number; checkedRows: number } | null>(null);
  const [err, setErr] = useState('');
  const [type, setType] = useState('');
  useEffect(() => {
    setBusy(true); setErr('');
    api('quality').then(setD).catch(e => setErr(errText(e.message))).finally(() => setBusy(false));
  }, [tick]);
  if (err) return <main className="max-w-2xl mx-auto p-4"><Alert tone="bad">{err}</Alert></main>;
  if (!d) return <Spinner />;
  const counts: Record<string, number> = {};
  d.issues.forEach(i => { counts[i.type] = (counts[i.type] || 0) + 1; });
  const list = type ? d.issues.filter(i => i.type === type) : d.issues;
  return (
    <main className="max-w-2xl mx-auto p-3 sm:p-4">
      <Alert tone="info">{t('ការពិនិត្យនេះអានតែប៉ុណ្ណោះ: មិនកែទិន្នន័យដោយស្វ័យប្រវត្តិទេ។', 'This check only reads: nothing is corrected automatically.')}</Alert>
      <p className="muted text-[13px]">{t('បានពិនិត្យ ', 'Checked ')}{d.checkedRows}{t(' ជួរចុងក្រោយ · ', ' latest rows · ')}{d.total}{t(' បញ្ហា', ' issues')}</p>
      <div className="flex flex-wrap gap-2 mb-3">
        <button type="button" className={'chip ' + (!type ? 'chip-on' : '')} onClick={() => setType('')}>{t('ទាំងអស់', 'All')} {d.issues.length}</button>
        {Object.keys(counts).map(k => <button key={k} type="button" className={'chip ' + (type === k ? 'chip-on' : '')} onClick={() => setType(k)}>{t(...(TYPE_LABEL[k] || [k, k]) as [string, string])} {counts[k]}</button>)}
      </div>
      {list.map((i, n) => (
        <a key={n} href={tripHref(i.trip)} className="card block no-underline text-ink !p-3">
          <b>{i.trip}</b> <span className="muted text-[13px]">{t(...(TYPE_LABEL[i.type] || [i.type, i.type]) as [string, string])}</span>
          <div className="text-[14px]">{L({ kh: i.kh, en: i.en })}</div>
        </a>
      ))}
    </main>
  );
}

type User = { email: string; name: string; role: string };
export function UsersPage() {
  useLang();
  const { boot, setBusy, tick } = useApp();
  const [d, setD] = useState<{ users: User[]; roles: string[] } | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [add, setAdd] = useState({ email: '', name: '', role: 'Driver' });
  const [saving, setSaving] = useState('');
  useEffect(() => {
    setBusy(true);
    api('users').then(setD).catch(e => setErr(errText(e.message))).finally(() => setBusy(false));
  }, [tick]);
  const save = async (u: { email: string; name?: string; role: string }) => {
    setErr(''); setSaving(u.email);
    try { setD(await api('setUser', u)); toast('✅ ' + t('បានរក្សាទុក', 'Saved')); return true; }
    catch (e: any) { setErr(errText(e.message)); return false; }
    finally { setSaving(''); }
  };
  if (!d) return err ? <main className="max-w-2xl mx-auto p-4"><Alert tone="bad">{err}</Alert></main> : <Spinner />;
  const s = q.trim().toLowerCase();
  const roles = d.roles.concat(d.users.some(u => u.role === 'LT') ? ['LT'] : []);
  return (
    <main className="max-w-2xl mx-auto p-3 sm:p-4">
      <Alert tone="info">{t('តួនាទីរក្សាទុកក្នុងជួរឈរ ROLE នៃ User Manager (AppSheet ប្រើដូចគ្នា)។ ការផ្លាស់ប្តូរកត់ក្នុង Audit Log។', 'Roles are saved in the User Manager ROLE column (shared with AppSheet). Changes are written to the Audit Log.')}</Alert>
      {err ? <Alert tone="bad">{err}</Alert> : null}
      <section className="card grid gap-2">
        <b>{t('បន្ថែមអ្នកប្រើ', 'Add a user')}</b>
        <input className="in" type="email" value={add.email} onChange={e => setAdd(Object.assign({}, add, { email: e.target.value.trim() }))} placeholder="name@gmail.com" aria-label="Email" />
        <input className="in" value={add.name} onChange={e => setAdd(Object.assign({}, add, { name: e.target.value }))} placeholder={t('ឈ្មោះ', 'Name')} aria-label={t('ឈ្មោះ', 'Name')} />
        <select className="in" value={add.role} onChange={e => setAdd(Object.assign({}, add, { role: e.target.value }))} aria-label={t('តួនាទី', 'Role')}>{roles.map(r => <option key={r}>{r}</option>)}</select>
        <button type="button" className="btn-primary" disabled={!!saving || !add.email} onClick={async () => { if (await save(add)) setAdd({ email: '', name: '', role: 'Driver' }); }}>{t('បន្ថែម', 'Add')}</button>
      </section>
      <input className="in mb-3" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('ស្វែងរកអ្នកប្រើ', 'Search users')} />
      {d.users.filter(u => matches(u.email + ' ' + u.name + ' ' + u.role, s)).map(u => (
        <div key={u.email} className="card !p-3 flex items-center gap-2">
          <div className="flex-1 min-w-0"><b className="block truncate">{u.name || u.email}</b><small className="muted block truncate">{u.email}</small></div>
          <select className="in !w-auto !min-h-[40px]" value={u.role} disabled={saving === u.email || u.email === boot.user.email} onChange={e => save({ email: u.email, role: e.target.value })} aria-label={t('តួនាទី', 'Role') + ' ' + u.email}>
            <option value="">{t('គ្មាន', 'None')}</option>
            {roles.concat(u.role && roles.indexOf(u.role) < 0 ? [u.role] : []).map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
      ))}
    </main>
  );
}
