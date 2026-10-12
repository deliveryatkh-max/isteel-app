import { useMemo, useState } from 'react';
import { t, useLang } from '../i18n';
import { tripHref, useApp } from '../state';
import { insideOf, TripCard } from '../components/TripCard';
import { Badge, Spinner } from '../components/ui';

/** Home / Operations: today's numbers and the trips still running. */
export function OpsPage() {
  useLang();
  const { boot, ops } = useApp();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'active' | 'inside' | 'out' | 'today'>('active');
  const k = useMemo(() => {
    const trips = ops ? ops.trips : [];
    const today = ops ? ops.today : boot.today;
    const todays = trips.filter(x => x.date === today);
    const open = trips.filter(x => !x.closed);
    return {
      today: todays.length,
      active: open.length,
      inside: open.filter(x => x.gateIn && !x.gateOut).length,
      out: open.filter(x => x.gateOut).length,
      canceled: todays.filter(x => x.stage === 'canceled').length,
      completed: todays.filter(x => x.stage === 'completed').length,
    };
  }, [ops, boot.today]);
  const list = useMemo(() => {
    if (!ops) return [];
    let l = ops.trips;
    if (filter === 'active') l = l.filter(x => !x.closed);
    if (filter === 'inside') l = l.filter(x => !x.closed && x.gateIn && !x.gateOut);
    if (filter === 'out') l = l.filter(x => !x.closed && x.gateOut);
    if (filter === 'today') l = l.filter(x => x.date === ops.today);
    const s = q.trim().toLowerCase();
    if (s) l = l.filter(x => [x.id, x.plate, x.driver, x.dns.map(d => d.dn + ' ' + d.cust).join(' ')].join(' ').toLowerCase().indexOf(s) >= 0);
    return l;
  }, [ops, q, filter]);
  const dn = ops ? ops.dnToday : null;
  // Trucks inside the plant the longest: orange after INSIDE_WARN_MIN, red after INSIDE_LATE_MIN (Delivery Settings).
  const waitList = useMemo(() => {
    const s = boot.settings;
    return (ops ? ops.trips : []).map(x => ({ x, i: insideOf(x, s && s.warnMin, s && s.lateMin) })).filter(w => w.i)
      .sort((a, b) => b.i!.min - a.i!.min).slice(0, 5);
  }, [ops, boot.settings]);
  const lateN = waitList.filter(w => w.i!.tone !== 'ok').length;
  const Card = (c: { n: number | string; km: string; en: string; tone?: string; f?: typeof filter }) => (
    <button type="button" onClick={() => c.f && setFilter(c.f)}
      className={'card !mb-0 !p-3 text-left ' + (c.f && filter === c.f ? '!border-accent' : '')} aria-pressed={c.f ? filter === c.f : undefined}>
      <div className={'text-[26px] font-bold leading-tight ' + (c.tone || 'text-brand')}>{c.n}</div>
      <div className="text-[13px] muted leading-snug">{t(c.km, c.en)}</div>
    </button>
  );
  return (
    <main className="max-w-3xl mx-auto p-3 sm:p-4">
      <a href="#/record" className="btn-primary w-full mb-3 text-[17px] no-underline">➕ {t('កត់ត្រាដំណើរ', 'Record a journey step')}</a>
      <h2 className="text-[15px] font-bold mt-1 mb-2">{t('ជើងដឹក', 'Trips')}</h2>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Card n={k.today} km="ជើងដឹកថ្ងៃនេះ" en="Trips today" f="today" />
        <Card n={k.active} km="កំពុងដំណើរការ" en="Active trips" f="active" />
        <Card n={k.inside} km="នៅក្នុងរោងចក្រ" en="Inside the site" f="inside" tone="text-warn" />
        <Card n={k.out} km="ចេញដឹកហើយ" en="Out on delivery" f="out" />
        <Card n={k.completed} km="បានបញ្ចប់ថ្ងៃនេះ" en="Completed today" tone="text-ok" />
        <Card n={k.canceled} km="លុបចោលថ្ងៃនេះ" en="Canceled today" tone="text-bad" />
      </div>
      {waitList.length ? (
        <section className="card !p-3">
          <h2 className="text-[15px] font-bold m-0 mb-1.5">⏱ {t('រង់ចាំយូរជាងគេក្នុងរោងចក្រ', 'Waiting longest inside the plant')}
            {lateN ? <span className="text-bad"> · {lateN} {t('យឺត', 'late')}</span> : null}</h2>
          {waitList.map(({ x, i }) => (
            <a key={x.id} href={tripHref(x.id)} className="flex items-center gap-2 py-1.5 border-b border-line last:border-0 no-underline text-ink">
              <span className={'w-2.5 h-2.5 rounded-full flex-none ' + (i!.tone === 'bad' ? 'bg-bad' : i!.tone === 'warn' ? 'bg-warn' : 'bg-ok')} />
              <b className="tracking-wide">{x.plate}</b>
              <span className="flex-1 min-w-0 truncate"><Badge k={x.stage} label={boot.stages[x.stage]} /></span>
              <b className={i!.tone === 'bad' ? 'text-bad' : i!.tone === 'warn' ? 'text-warn' : 'text-brand'}>{i!.text}</b>
            </a>
          ))}
          <p className="muted text-[12px] m-0 mt-1">{t('ពណ៌ទឹកក្រូច ', 'Orange after ')}{(boot.settings || { warnMin: 90 }).warnMin}{t(' នាទី · ក្រហម ', ' min · red after ')}{(boot.settings || { lateMin: 120 }).lateMin}{t(' នាទី', ' min')}</p>
        </section>
      ) : null}
      <h2 className="text-[15px] font-bold mt-1 mb-2">{t('DN ថ្ងៃនេះ', 'DNs today')}</h2>
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Card n={dn ? dn.in_progress : '–'} km="កំពុងដឹក" en="In progress" />
        <Card n={dn ? dn.partial : '–'} km="ប្រគល់មួយផ្នែក" en="Partly delivered" tone="text-warn" />
        <Card n={dn ? dn.delivered : '–'} km="ប្រគល់រួច" en="Delivered" tone="text-ok" />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-[15px] font-bold m-0 flex-1">
          {{ active: t('ជើងដឹកកំពុងដំណើរការ', 'Active trips'), inside: t('នៅក្នុងរោងចក្រ', 'Inside the site'), out: t('ចេញដឹកហើយ', 'Out on delivery'), today: t('ជើងដឹកថ្ងៃនេះ', 'Trips today') }[filter]}
          <span className="muted font-normal"> · {list.length}</span>
        </h2>
      </div>
      <input className="in mb-3" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('ស្វែងរក ផ្លាកលេខ ជើងដឹក DN…', 'Search plate, trip, DN…')} />
      {!ops ? <Spinner /> : list.length ? list.map(x => <TripCard key={x.id} trip={x} />) : <p className="muted text-center py-6">{t('មិនមានជើងដឹក', 'No trips')}</p>}
    </main>
  );
}
