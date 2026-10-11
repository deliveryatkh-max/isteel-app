import { fmtDate, fmtTime, L, t, useLang } from '../i18n';
import { tripHref, useApp } from '../state';
import type { TripSummary } from '../types';
import { Badge } from './ui';

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
