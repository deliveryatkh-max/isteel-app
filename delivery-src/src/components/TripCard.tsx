import { fmtDate, fmtTime, L, t, useLang } from '../i18n';
import { tripHref, useApp } from '../state';
import type { TripSummary } from '../types';
import { Badge } from './ui';

/** Minutes a truck has been inside the plant (Gate In, no Gate Out yet), with orange / red from Delivery Settings. */
export function insideOf(x: TripSummary, warnMin = 90, lateMin = 120) {
  if (!x.gateIn || x.gateOut || x.closed) return null;
  const min = Math.max(0, Math.floor((Date.now() - x.gateIn) / 60000));
  if (min > 24 * 60) return null;   // forgotten Gate Out: not a waiting truck
  return { min, text: Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0'), tone: min >= lateMin ? 'bad' : min >= warnMin ? 'warn' : 'ok' };
}
const TONE: Record<string, string> = { bad: 'bg-badsoft text-bad', warn: 'bg-warnsoft text-warn', ok: 'bg-soft text-brand' };
export function InsideChip(p: { trip: TripSummary }) {
  const { boot } = useApp();
  const s = boot.settings;
  const i = insideOf(p.trip, s && s.warnMin, s && s.lateMin);
  return i ? <span className={'inline-flex items-center rounded-full px-2 py-0.5 text-[12.5px] font-bold ' + TONE[i.tone]} title={t('នៅក្នុងរោងចក្រ', 'Inside the plant')}>⏱ {i.text}</span> : null;
}

/** One trip in a list: truck, trip number, step, DNs with their leg status. */
export function TripCard(p: { trip: TripSummary; showDate?: boolean }) {
  useLang();
  const { boot } = useApp();
  const x = p.trip;
  return (
    <a href={tripHref(x.id)} className="card block no-underline text-ink !p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <b className="text-[17px] tracking-wide">{x.plate || '—'}</b>
          <span className="muted text-[13px] ml-2">{x.round}</span>
          <div className="muted text-[13px] truncate">{x.id}{x.driver ? ' · ' + x.driver : ''}</div>
        </div>
        <Badge k={x.stage} label={boot.stages[x.stage]} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] mt-1.5">
        {p.showDate ? <span>📅 {fmtDate(x.gateIn || x.lastTime)}</span> : null}
        <span>⬇ {t('ចូល', 'In')} {fmtTime(x.gateIn)}</span>
        <span>⬆ {t('ចេញ', 'Out')} {fmtTime(x.gateOut)}</span>
        <InsideChip trip={x} />
        {x.legacy ? <span className="muted">AppSheet</span> : null}
      </div>
      {x.dns.length ? (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {x.dns.map(d => (
            <span key={d.dn} className="inline-flex items-center gap-1 text-[12.5px] border border-line rounded-lg px-2 py-0.5">
              <b>{d.dn}</b><span className="muted">{L(boot.legs[d.leg])}</span>
            </span>
          ))}
        </div>
      ) : null}
    </a>
  );
}
