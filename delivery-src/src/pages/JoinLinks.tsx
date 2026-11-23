import { useEffect, useState } from 'react';
import { api } from '../api';
import { errText, t, useLang } from '../i18n';
import { useApp } from '../state';
import { Alert, Spinner, toast } from '../components/ui';

type Row = { id: string; name: string; phone: string; link: string; chats: number };
type Data = { bot: boolean; botName: string; rows: Row[] };

/** The message Sales sends with the link (Khmer + English). */
const msgOf = (r: Row) => 'សួស្តី ' + r.name + '! សូមចុចតំណនេះ ហើយចុច Start ដើម្បីទទួលដំណឹង និងផែនទីផ្ទាល់ រាល់ពេលទំនិញចេញពី ISI Steel។\n'
  + 'Hello! Tap this link, then Start, to get a live map every time your steel leaves ISI Steel.\n';

/**
 * Customer Join Links (Kim, 24 Nov 2026): Sales sends each customer their Telegram join link once; after Start, every
 * Scale Gate Out sends that customer the live map by itself. "Joined?" turns Yes as soon as the bot saves the chat.
 */
export function JoinLinksPage() {
  useLang();
  const { tick, setBusy } = useApp();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'no' | 'yes'>('no');
  const [sort, setSort] = useState<{ k: keyof Row; up: boolean }>({ k: 'name', up: true });
  useEffect(() => {
    setBusy(true); setErr('');
    api<Data>('joinLinks').then(setD).catch(e => {
      const m = String(e.message || '');
      setErr(/Unknown action/.test(m) ? t('សូម paste Delivery.gs ឡើងវិញ ហើយ Deploy New version ដើម្បីបើកទំព័រនេះ។', 'Re-paste Delivery.gs and Extras.gs, then deploy a New version, to open this page.') : errText(m));
    }).finally(() => setBusy(false));
  }, [tick]);
  if (err) return <main className="max-w-3xl mx-auto p-4"><Alert tone="bad">{err}</Alert></main>;
  if (!d) return <Spinner />;
  const joined = d.rows.filter(r => r.chats > 0).length;
  const words = q.trim().toLowerCase();
  const list = d.rows
    .filter(r => (f === 'all' || (f === 'yes' ? r.chats > 0 : !r.chats)) && (!words || (r.id + ' ' + r.name + ' ' + r.phone).toLowerCase().indexOf(words) >= 0))
    .sort((a, b) => { const x = a[sort.k], y = b[sort.k]; const c = typeof x === 'number' ? (x as number) - (y as number) : String(x).localeCompare(String(y)); return sort.up ? c : -c; });
  const copy = (r: Row) => {
    const s = msgOf(r) + r.link;
    (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(() => toast('📋 ' + t('បានចម្លង', 'Copied')), () => window.prompt(t('ចម្លងសារ', 'Copy the message'), s));
  };
  const send = (r: Row) => window.open('https://t.me/share/url?url=' + encodeURIComponent(r.link) + '&text=' + encodeURIComponent(msgOf(r)), '_blank');
  const th = (k: keyof Row, km: string, en: string) => (
    <th className="sticky top-0 bg-[#0b4f6c] text-white text-left px-2 py-2 cursor-pointer select-none whitespace-nowrap" onClick={() => setSort({ k, up: sort.k === k ? !sort.up : true })}>
      {t(km, en)}{sort.k === k ? (sort.up ? ' ▲' : ' ▼') : ''}
    </th>
  );
  return (
    <main className="max-w-5xl mx-auto p-3 sm:p-4">
      {!d.bot ? <Alert tone="warn">{t('Bot មិនទាន់ដំណើរការ: ខ្វះ TRACK_BOT_TOKEN។', 'The bot is not on yet: TRACK_BOT_TOKEN is missing.')}</Alert> : null}
      <p className="muted text-[13.5px] mt-0">{t('ផ្ញើតំណម្តងទៅអតិថិជន។ ពេលគាត់ចុច Start រួច រាល់ពេលឡានថ្លឹងចេញ គាត់នឹងទទួលផែនទីផ្ទាល់ដោយស្វ័យប្រវត្តិ។', 'Send each customer their link once. After they tap Start, every Scale Gate Out sends them the live map by itself.')}</p>
      <div className="flex flex-wrap gap-2 mb-2 items-center">
        <button type="button" className={'chip ' + (f === 'no' ? 'chip-on' : '')} onClick={() => setF('no')}>⏳ {t('មិនទាន់ភ្ជាប់', 'Not yet')} {d.rows.length - joined}</button>
        <button type="button" className={'chip ' + (f === 'yes' ? 'chip-on' : '')} onClick={() => setF('yes')}>✅ {t('បានភ្ជាប់', 'Joined')} {joined}</button>
        <button type="button" className={'chip ' + (f === 'all' ? 'chip-on' : '')} onClick={() => setF('all')}>{t('ទាំងអស់', 'All')} {d.rows.length}</button>
        <input className="in flex-1 min-w-[180px]" placeholder={t('ស្វែងរក ឈ្មោះ / ID / ទូរស័ព្ទ', 'Search name / ID / phone')} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="card !p-0 overflow-auto max-h-[70vh]">
        <table className="w-full text-[13.5px] border-collapse">
          <thead><tr>{th('name', 'ឈ្មោះអតិថិជន', 'Customer name')}{th('chats', 'បានភ្ជាប់?', 'Joined?')}
            <th className="sticky top-0 bg-[#0b4f6c] text-white text-left px-2 py-2">{t('តំណភ្ជាប់', 'Join link')}</th></tr></thead>
          <tbody>
            {list.map(r => (
              <tr key={r.id} className="border-b border-line" data-cust={r.id}>
                <td className="px-2 py-1.5">{r.name}<small className="block muted">{r.id}{r.phone ? ' · 📞 ' + r.phone : ''}</small></td>
                <td className={'px-2 py-1.5 whitespace-nowrap font-bold ' + (r.chats ? 'text-ok' : 'text-warn')}>{r.chats ? '✅ ' + t('បាទ/ចាស', 'Yes') + (r.chats > 1 ? ' · ' + r.chats : '') : '⏳ ' + t('មិនទាន់', 'Not yet')}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <button type="button" className="btn btn-sm" onClick={() => send(r)}>✈ {t('ផ្ញើ', 'Send')}</button>{' '}
                  <button type="button" className="btn btn-sm" onClick={() => copy(r)}>📋</button>
                </td>
              </tr>
            ))}
            {!list.length ? <tr><td colSpan={3} className="px-2 py-4 muted text-center">{t('គ្មាន', 'None')}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
