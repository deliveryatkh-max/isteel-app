// Delivery dashboard (English only, like every iSteel dashboard): turnaround, OTIF and the 3PL scorecard.
// Loaded only when opened, so the everyday screens stay light.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { errText, ymdNow, ymdOf } from '../i18n';
import { dnHref, useApp } from '../state';
import { Alert, Spinner } from '../components/ui';

type Kpi = {
  from: string; to: string; settings: { turnaroundTarget: number; otifTarget: number; ratingTarget: number };
  trips: number; avgTotal: number | null; underTargetPct: number | null;
  segments: { key: string; avg: number | null; n: number }[];
  byWh: { wh: string; avg: number | null; n: number }[]; byDay: { day: string; avg: number | null; n: number }[];
  otif: { due: number; ok: number; late: number; short: number; failed: number; open: number; excluded: number; pct: number | null };
  misses: { dn: string; cust: string; due: string; doneAt: number; onTime: boolean; inFull: boolean; failed: boolean; co: string }[];
  rating: { n: number; avg: number | null }; complaints: { n: number; open: number; types: Record<string, number> };
  scorecard: { co: string; trips: number; dns: number; otif: number | null; failed: number; complaints: number; rating: number | null; ratingN: number; inPlant: number | null; pod: number | null }[];
  builtAt: number;
};
const SEG: Record<string, string> = {
  gate_to_bill: 'Gate In → bill desk', at_bill: 'At the bill desk', to_wh: 'To the warehouse', wait_load: 'Waiting to load', loading: 'Loading', to_gate_out: 'Loaded → Gate Out',
};
const hm = (m: number | null | undefined) => (m == null ? '–' : Math.floor(m / 60) + ':' + String(Math.round(m) % 60).padStart(2, '0'));
const day = (s: string) => new Date(s + 'T12:00:00+07:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
function monthRange(back: number) {
  const [y, m] = ymdNow().split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 - back, 1)), last = new Date(Date.UTC(y, m - back, 0));
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return [f(first), back ? f(last) : ymdNow()];
}

export default function DashboardPage() {
  const { tick, setBusy } = useApp();
  const [from, setFrom] = useState(() => ymdOf(Date.now() - 6 * 86400000));
  const [to, setTo] = useState(ymdNow);
  const [d, setD] = useState<Kpi | null>(null);
  const [err, setErr] = useState('');
  const [fresh, setFresh] = useState(0);
  useEffect(() => {
    let live = true;
    setBusy(true); setErr('');
    api<Kpi>('kpi', { from, to, fresh: fresh > 0 })
      .then(x => { if (live) setD(x); })
      .catch(e => { if (live) setErr(errText(e.message)); })
      .finally(() => setBusy(false));
    return () => { live = false; };
  }, [from, to, tick, fresh]);
  const range = (a: string, b: string) => { setFrom(a); setTo(b); };
  const tgt = d ? d.settings : { turnaroundTarget: 180, otifTarget: 95, ratingTarget: 4 };
  const maxSeg = d ? Math.max(1, ...d.segments.map(s => s.avg || 0)) : 1;
  const maxDay = d ? Math.max(1, tgt.turnaroundTarget, ...d.byDay.map(s => s.avg || 0)) : 1;
  return (
    <main className="max-w-4xl mx-auto p-3 sm:p-4" lang="en">
      <div className="card !p-3 flex flex-wrap items-end gap-2">
        <label className="text-[13px] muted">From<input className="in" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-[13px] muted">To<input className="in" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
        <button type="button" className="chip" onClick={() => range(ymdOf(Date.now() - 6 * 86400000), ymdNow())}>Last 7 days</button>
        <button type="button" className="chip" onClick={() => range(...(monthRange(0) as [string, string]))}>This month</button>
        <button type="button" className="chip" onClick={() => range(...(monthRange(1) as [string, string]))}>Last month</button>
        <button type="button" className="chip" onClick={() => setFresh(fresh + 1)}>↻ Recalculate</button>
      </div>
      {err ? <Alert tone="bad">{err}</Alert> : null}
      {!d ? (err ? null : <Spinner />) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <Tile v={d.otif.pct == null ? '–' : d.otif.pct + '%'} k="OTIF" sub={'target ' + tgt.otifTarget + '% · ' + d.otif.due + ' DNs'} tone={d.otif.pct == null ? '' : d.otif.pct >= tgt.otifTarget ? 'ok' : 'bad'} />
            <Tile v={hm(d.avgTotal)} k="Avg Gate In → Out" sub={'target ' + hm(tgt.turnaroundTarget) + ' · ' + (d.underTargetPct == null ? '–' : d.underTargetPct + '% on target')} tone={d.avgTotal == null ? '' : d.avgTotal <= tgt.turnaroundTarget ? 'ok' : 'warn'} />
            <Tile v={d.rating.avg == null ? '–' : d.rating.avg + ' ★'} k="Customer rating" sub={d.rating.n + ' ratings · target ' + tgt.ratingTarget} tone={d.rating.avg == null ? '' : d.rating.avg >= tgt.ratingTarget ? 'ok' : 'warn'} />
            <Tile v={String(d.complaints.n)} k="Complaints" sub={d.complaints.open + ' still open'} tone={d.complaints.open ? 'bad' : 'ok'} />
          </div>

          <section className="card">
            <h2 className="text-[15px] font-bold mt-0 mb-1">Where trucks spend time inside the plant</h2>
            <p className="muted text-[12.5px] mt-0">Average minutes per step · {d.trips} trips with Gate In in the period</p>
            {d.segments.map(s => (
              <div key={s.key} className="grid grid-cols-[150px_1fr_52px] items-center gap-2 py-1 text-[13.5px]">
                <span className="truncate">{SEG[s.key] || s.key}</span>
                <div className="h-3.5 rounded-full bg-soft overflow-hidden"><div className="h-full bg-accent rounded-full" style={{ width: ((s.avg || 0) / maxSeg) * 100 + '%' }} /></div>
                <b className="text-right">{hm(s.avg)}</b>
              </div>
            ))}
          </section>

          <div className="grid sm:grid-cols-2 gap-3">
            <section className="card !mb-0">
              <h2 className="text-[15px] font-bold mt-0 mb-2">Gate In → Out by day</h2>
              {!d.byDay.length ? <p className="muted text-sm">No trips</p> : (
                <div className="flex items-end gap-1 h-[120px] relative">
                  <div className="absolute inset-x-0 border-t border-dashed border-bad" style={{ bottom: (tgt.turnaroundTarget / maxDay) * 100 + '%' }} title="Target" />
                  {d.byDay.map(x => (
                    <div key={x.day} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={day(x.day) + ': ' + hm(x.avg) + ' (' + x.n + ' trips)'}>
                      <div className={'w-full rounded-t ' + ((x.avg || 0) > tgt.turnaroundTarget ? 'bg-warn' : 'bg-accent')} style={{ height: ((x.avg || 0) / maxDay) * 100 + '%' }} />
                    </div>
                  ))}
                </div>
              )}
              {d.byDay.length ? <div className="flex justify-between muted text-[11.5px] mt-1"><span>{day(d.byDay[0].day)}</span><span>dashed line = target</span><span>{day(d.byDay[d.byDay.length - 1].day)}</span></div> : null}
            </section>
            <section className="card !mb-0">
              <h2 className="text-[15px] font-bold mt-0 mb-2">By warehouse</h2>
              {d.byWh.map(x => (
                <div key={x.wh} className="flex justify-between py-1 border-b border-line last:border-0 text-[14px]">
                  <span>{x.wh} <span className="muted text-[12.5px]">· {x.n} trips</span></span>
                  <b className={(x.avg || 0) > tgt.turnaroundTarget ? 'text-warn' : ''}>{hm(x.avg)}</b>
                </div>
              ))}
              {!d.byWh.length ? <p className="muted text-sm">No finished trips</p> : null}
            </section>
          </div>

          <section className="card mt-3">
            <h2 className="text-[15px] font-bold mt-0 mb-1">3PL scorecard</h2>
            <p className="muted text-[12.5px] mt-0">OTIF per DN (credited to the truck that made the last delivery) · rating from customers · POD = Delivered steps with a photo</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px] border-collapse min-w-[620px]">
                <thead><tr className="text-left muted">{['3PL', 'Trips', 'DNs', 'OTIF', 'Failed', 'Complaints', 'Rating', 'In plant', 'POD'].map(h => <th key={h} className="py-1.5 pr-2 font-semibold border-b border-line">{h}</th>)}</tr></thead>
                <tbody>
                  {d.scorecard.map(r => (
                    <tr key={r.co} className="border-b border-line last:border-0">
                      <td className="py-1.5 pr-2 font-bold">{r.co}</td>
                      <td className="pr-2">{r.trips}</td>
                      <td className="pr-2">{r.dns}</td>
                      <td className={'pr-2 font-bold ' + (r.otif == null ? '' : r.otif >= tgt.otifTarget ? 'text-ok' : 'text-bad')}>{r.otif == null ? '–' : r.otif + '%'}</td>
                      <td className={'pr-2 ' + (r.failed ? 'text-bad font-bold' : '')}>{r.failed}</td>
                      <td className={'pr-2 ' + (r.complaints ? 'text-bad font-bold' : '')}>{r.complaints}</td>
                      <td className={'pr-2 ' + (r.rating == null ? '' : r.rating >= tgt.ratingTarget ? 'text-ok' : 'text-warn')}>{r.rating == null ? '–' : r.rating + ' ★ (' + r.ratingN + ')'}</td>
                      <td className={'pr-2 ' + ((r.inPlant || 0) > tgt.turnaroundTarget ? 'text-warn' : '')}>{hm(r.inPlant)}</td>
                      <td className="pr-2">{r.pod == null ? '–' : r.pod + '%'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!d.scorecard.length ? <p className="muted text-sm">No trips in the period</p> : null}
            </div>
          </section>

          <section className="card">
            <h2 className="text-[15px] font-bold mt-0 mb-1">OTIF</h2>
            <p className="muted text-[12.5px] mt-0">DNs with a plan date in the period. On time = last delivery on or before the plan date; in full = DN delivered (weight ≥ 99.5% of plan, or "whole DN" ticked).
              Canceled DNs and confirmed customer delays are left out.</p>
            <div className="flex flex-wrap gap-2 mb-2 text-[13px]">
              <span className="chip !cursor-default">✔ OTIF {d.otif.ok}</span><span className="chip !cursor-default">⏰ Late {d.otif.late}</span>
              <span className="chip !cursor-default">⚖ Short {d.otif.short}</span><span className="chip !cursor-default">✕ Failed {d.otif.failed}</span>
              <span className="chip !cursor-default">… Still due today {d.otif.open}</span><span className="chip !cursor-default">Left out {d.otif.excluded}</span>
            </div>
            {d.misses.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px] border-collapse min-w-[520px]">
                  <thead><tr className="text-left muted">{['DN', 'Customer', 'Plan date', 'Delivered', 'Why', '3PL'].map(h => <th key={h} className="py-1.5 pr-2 font-semibold border-b border-line">{h}</th>)}</tr></thead>
                  <tbody>
                    {d.misses.map(m => (
                      <tr key={m.dn} className="border-b border-line last:border-0">
                        <td className="py-1.5 pr-2"><a href={dnHref(m.dn)} className="font-bold">{m.dn}</a></td>
                        <td className="pr-2 max-w-[180px] truncate">{m.cust}</td>
                        <td className="pr-2 whitespace-nowrap">{day(m.due)}</td>
                        <td className="pr-2 whitespace-nowrap">{m.doneAt ? day(ymdOf(m.doneAt)) : '–'}</td>
                        <td className="pr-2 text-bad">{m.failed ? 'Failed' : !m.doneAt ? 'Not delivered' : !m.inFull ? 'Short' : 'Late'}</td>
                        <td className="pr-2">{m.co}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted text-sm m-0">No misses 🎉</p>}
          </section>
          <p className="muted text-[12px] text-center">Updated {new Date(d.builtAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Phnom_Penh' })} · numbers are kept for 5 minutes</p>
        </>
      )}
    </main>
  );
}

function Tile(p: { v: string; k: string; sub: string; tone: string }) {
  const c = { ok: 'text-ok', bad: 'text-bad', warn: 'text-warn' }[p.tone] || 'text-brand';
  return (
    <div className="card !mb-0 !p-3">
      <div className={'text-[24px] font-bold leading-tight ' + c}>{p.v}</div>
      <div className="text-[13px] font-semibold">{p.k}</div>
      <div className="muted text-[12px] leading-snug">{p.sub}</div>
    </div>
  );
}
