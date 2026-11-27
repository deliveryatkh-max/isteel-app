import { useState } from 'react';
import { t, useLang } from '../i18n';
import { tripHref } from '../state';
import type { TripSummary } from '../types';
import { Scanner } from './Scanner';

/** Trip search box with a 📷 Scan DN button (Kim, 27 Nov 2026, point 1). A DN that is on one trip opens that trip. */
export function SearchScan(p: { q: string; setQ: (v: string) => void; trips: TripSummary[] }) {
  useLang();
  const [scan, setScan] = useState(false);
  const onCode = (raw: string) => {
    setScan(false);
    const code = raw.replace(/\s/g, '').toUpperCase(), n = (v: string) => String(v || '').replace(/\s/g, '').toUpperCase().replace(/^0+(?=\d)/, '');
    p.setQ(code);
    const hit = p.trips.filter(x => x.dns.some(d => n(d.dn) === n(code)));
    if (hit.length === 1) location.hash = tripHref(hit[0].id);
  };
  return (
    <div className="flex gap-2 mb-3">
      <input className="in flex-1 min-w-0" type="search" value={p.q} onChange={e => p.setQ(e.target.value)} placeholder={t('ស្វែងរក ផ្លាកលេខ ជើងដឹក DN…', 'Search plate, trip, DN…')} />
      <button type="button" className="btn shrink-0 whitespace-nowrap" onClick={() => setScan(true)} aria-label={t('ស្កេន DN', 'Scan DN')}>📷 {t('ស្កេន DN', 'Scan DN')}</button>
      {scan ? <Scanner onClose={() => setScan(false)} onCode={onCode} /> : null}
    </div>
  );
}
