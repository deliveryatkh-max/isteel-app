// 📍 Phone GPS report (Kim, 25 Nov 2026; Admin only, in More): where trucks stopped and for how long, the places
// where they stay longest, per driver, and a timeline map of one trip (route, numbered stops, no-signal gaps).
// Points come from the driver's phone (Live GPS tab) from Gate Out until the trip ends, while the driver page is open.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { errText, t, useLang, ymdNow, ymdOf } from '../i18n';
import { useApp } from '../state';
import { Alert, Spinner, toast } from '../components/ui';

type Stop = { ll: string; from: number; to: number; min: number; gap: boolean; label: string };
type Gap = { from: number; to: number; min: number; km: number };
type Trip = {
  id: string; day: string; plate: string; driver: string; start: number; end: number; km: number; tracked: number;
  stopMin: number; noSignal: number; moving: number; stops: Stop[]; gaps: Gap[]; longest: Stop | null; path?: [number, number, number][];
};
type Place = { ll: string; label: string; visits: number; total: number; longest: number; trucks: string[]; drivers: string[] };
type Drv = { driver: string; trips: number; stopMin: number; stops: number; longest: (Stop & { trip: string; plate: string }) | null };
type Rep = {
  from: string; to: string; factory: string; traccar?: string; rules: { radiusM: number; minMin: number; gapMin: number };
  summary: { trips: number; points: number; tracked: number; stop: number; noSignal: number; moving: number; km: number; stops: number };
  places: Place[]; drivers: Drv[]; trips: Trip[];
};

const hm = (m: number | null | undefined) => (m == null ? '–' : Math.floor(m / 60) + ':' + String(Math.round(m) % 60).padStart(2, '0'));
const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Phnom_Penh' });
const dayOf = (s: string) => new Date(s + 'T12:00:00+07:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const mapsUrl = (ll: string) => 'https://www.google.com/maps?q=' + encodeURIComponent(ll);
const placeName = (label: string) => (label === 'ISI' ? t('រោងចក្រ ISI', 'ISI plant') : label || t('ទីតាំងមិនស្គាល់', 'Unknown place'));
const monthStart = () => ymdNow().slice(0, 8) + '01';

// Leaflet from cdnjs, loaded once when this page opens (same version as the customer track page).
let leafletP: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((ok, bad) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = () => ok(w.L);
    s.onerror = () => { leafletP = null; bad(new Error('map')); };
    document.head.appendChild(s);
  });
  return leafletP;
}

export default function GpsPage() {
  useLang();
  const { tick, setBusy } = useApp();
  const [from, setFrom] = useState(() => ymdOf(Date.now() - 6 * 86400000));
  const [to, setTo] = useState(ymdNow);
  const [d, setD] = useState<Rep | null>(null);
  const [err, setErr] = useState('');
  const [fresh, setFresh] = useState(0);
  const [sel, setSel] = useState<string>('');
  const [one, setOne] = useState<Trip | null>(null);
  const [sort, setSort] = useState<{ k: keyof Trip; up: boolean }>({ k: 'start', up: false });

  useEffect(() => {
    let live = true;
    setBusy(true); setErr('');
    api<Rep>('gpsReport', { from, to, fresh: fresh > 0 })
      .then(x => { if (live) setD(x); })
      .catch(e => { if (live) setErr(errText(e.message)); })
      .finally(() => setBusy(false));
    return () => { live = false; };
  }, [from, to, tick, fresh]);

  useEffect(() => {
    if (!sel) { setOne(null); return; }
    let live = true;
    setBusy(true);
    api<Rep>('gpsReport', { from, to, tripId: sel })
      .then(x => { if (live) setOne(x.trips[0] || null); })
      .catch(e => { if (live) setErr(errText(e.message)); })
      .finally(() => setBusy(false));
    return () => { live = false; };
  }, [sel, from, to]);

  const trips = useMemo(() => (d ? d.trips.slice().sort((a, b) => {
    const x = a[sort.k] as number | string, y = b[sort.k] as number | string;
    const c = typeof x === 'string' ? String(x).localeCompare(String(y)) : Number(x) - Number(y);
    return sort.up ? c : -c;
  }) : []), [d, sort]);
  const preset = (a: string, b: string) => { setFrom(a); setTo(b); setSel(''); };
  const on = (a: string, b: string) => (from === a && to === b ? ' chip-on' : '');
  const th = (k: keyof Trip, label: string, right = true) => (
    <th className={'sticky top-0 z-[1] bg-[#0b4f6c] text-white px-1.5 py-2 cursor-pointer select-none whitespace-nowrap text-[11.5px] font-semibold ' + (right ? 'text-right' : 'text-left')}
      onClick={() => setSort({ k, up: sort.k === k ? !sort.up : false })}>{label}{sort.k === k ? (sort.up ? ' ▲' : ' ▼') : ''}</th>
  );
  const plain = 'sticky top-0 z-[1] bg-[#0b4f6c] text-white px-1.5 py-2 whitespace-nowrap text-[11.5px] font-semibold';

  return (
    <main className="max-w-3xl xl:max-w-5xl mx-auto p-3 sm:p-4" data-gps>
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <button type="button" className={'chip' + on(ymdNow(), ymdNow())} onClick={() => preset(ymdNow(), ymdNow())}>{t('ថ្ងៃនេះ', 'Today')}</button>
        <button type="button" className={'chip' + on(ymdOf(Date.now() - 6 * 86400000), ymdNow())} onClick={() => preset(ymdOf(Date.now() - 6 * 86400000), ymdNow())}>{t('៧ ថ្ងៃ', '7 days')}</button>
        <button type="button" className={'chip' + on(monthStart(), ymdNow())} onClick={() => preset(monthStart(), ymdNow())}>{t('ខែនេះ', 'This month')}</button>
        <input className="in !w-auto !py-1 text-[13px]" type="date" value={from} max={to} onChange={e => { if (e.target.value) { setFrom(e.target.value); setSel(''); } }} aria-label={t('ពី', 'From')} />
        <input className="in !w-auto !py-1 text-[13px]" type="date" value={to} min={from} onChange={e => { if (e.target.value) { setTo(e.target.value); setSel(''); } }} aria-label={t('ដល់', 'To')} />
        <button type="button" className="btn btn-sm" onClick={() => setFresh(fresh + 1)}>↻</button>
      </div>
      {err ? <Alert tone="bad">{err}</Alert> : null}
      {!d ? (err ? null : <Spinner />) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
            <Tile k={t('🚚 ជើងដឹកមាន GPS', '🚚 Trips with GPS')} v={String(d.summary.trips)} sub={d.summary.points + ' ' + t('ចំណុច', 'points')} />
            <Tile k={t('🛣️ ចម្ងាយ', '🛣️ Distance')} v={d.summary.km + ' km'} sub={t('តាម GPS ទូរស័ព្ទ', 'from phone GPS')} />
            <Tile k={t('▶️ កំពុងបើក', '▶️ Moving')} v={hm(d.summary.moving)} sub={t('ម៉ោង:នាទី', 'h:mm')} />
            <Tile k={t('⏸️ ឈប់', '⏸️ Stopped')} v={hm(d.summary.stop)} sub={d.summary.stops + ' ' + t('ដង', 'stops')} tone={d.summary.stop > d.summary.moving ? 'text-warn' : ''} />
            <Tile k={t('📵 គ្មានសញ្ញា', '📵 No signal')} v={hm(d.summary.noSignal)} sub={t('ទំព័របិទ ឬគ្មានអ៊ីនធឺណិត', 'page closed or offline')} tone={d.summary.noSignal ? 'text-bad' : ''} />
          </div>

          <section className="card !p-0 overflow-hidden">
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
              <h2 className="text-[15px] font-bold m-0 flex-1">
                🗺️ {one ? t('ផែនទីពេលវេលា', 'Timeline map') + ' · ' + (one.plate || one.driver) + (one.id.indexOf('D:') === 0 ? '' : ' · ' + one.id) : t('កន្លែងដែលឡានឈប់យូរ', 'Where trucks stop longest')}
              </h2>
              {sel ? <button type="button" className="btn btn-sm" onClick={() => setSel('')}>✕ {t('ទាំងអស់', 'All')}</button> : null}
            </div>
            <GpsMap rep={d} trip={one} />
            <p className="muted text-[11.5px] px-3 py-1.5 m-0">
              {one ? t('ខ្សែពណ៌ខៀវ = ផ្លូវ · លេខ = កន្លែងឈប់ · ដាច់ៗក្រហម = គ្មានសញ្ញា', 'Blue line = route · numbers = stops · red dashes = no signal')
                : t('រង្វង់ធំ = ឈប់យូរ · ចុចជើងដឹកខាងក្រោម ដើម្បីមើលផែនទីពេលវេលា', 'Bigger circle = longer stops · tap a trip below for its timeline map')}
            </p>
          </section>

          {one ? <Timeline trip={one} /> : null}

          <section className="card">
            <h2 className="text-[15px] font-bold mt-0 mb-2">📍 {t('កន្លែងឈប់យូរបំផុត', 'Places with the longest stops')}</h2>
            {!d.places.length ? <p className="muted text-sm m-0">{t('មិនទាន់មានការឈប់', 'No stops yet')}</p> : (
              <div className="overflow-auto max-h-[360px] -mx-1">
                <table className="w-full text-[13px] border-collapse">
                  <thead><tr><th className={plain + ' text-left'}>{t('កន្លែង', 'Place')}</th><th className={plain + ' text-right'}>{t('ដង', 'Stops')}</th><th className={plain + ' text-right'}>{t('សរុប', 'Total')}</th><th className={plain + ' text-right'}>{t('យូរបំផុត', 'Longest')}</th><th className={plain + ' text-left'}>{t('ឡាន', 'Trucks')}</th></tr></thead>
                  <tbody>
                    {d.places.slice(0, 20).map((p, i) => (
                      <tr key={p.ll} className="border-b border-line">
                        <td className="px-1.5 py-1.5"><b>{i + 1}.</b> <a href={mapsUrl(p.ll)} target="_blank" rel="noopener">{placeName(p.label)}</a></td>
                        <td className="px-1.5 text-right">{p.visits}</td>
                        <td className="px-1.5 text-right font-bold">{hm(p.total)}</td>
                        <td className="px-1.5 text-right">{hm(p.longest)}</td>
                        <td className="px-1.5 text-[12px] muted">{p.trucks.slice(0, 4).join(', ')}{p.trucks.length > 4 ? ' +' + (p.trucks.length - 4) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="text-[15px] font-bold mt-0 mb-2">👤 {t('តៃកុង', 'Drivers')}</h2>
            <div className="overflow-auto max-h-[360px] -mx-1">
              <table className="w-full text-[13px] border-collapse">
                <thead><tr><th className={plain + ' text-left'}>{t('តៃកុង', 'Driver')}</th><th className={plain + ' text-right'}>{t('ជើង', 'Trips')}</th><th className={plain + ' text-right'}>{t('ឈប់សរុប', 'Stopped')}</th><th className={plain + ' text-left'}>{t('ឈប់យូរបំផុត', 'Longest stop')}</th></tr></thead>
                <tbody>
                  {d.drivers.map(x => (
                    <tr key={x.driver} className="border-b border-line">
                      <td className="px-1.5 py-1.5">{x.driver}</td>
                      <td className="px-1.5 text-right">{x.trips}</td>
                      <td className="px-1.5 text-right font-bold">{hm(x.stopMin)}</td>
                      <td className="px-1.5 text-[12.5px]">{x.longest ? <a href="#" onClick={e => { e.preventDefault(); setSel(x.longest!.trip); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{hm(x.longest.min)} · {placeName(x.longest.label)} · {clock(x.longest.from)}</a> : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2 className="text-[15px] font-bold mt-0 mb-2">🚚 {t('ជើងដឹក', 'Trips')} ({trips.length})</h2>
            <div className="overflow-auto max-h-[480px] -mx-1">
              <table className="w-full text-[13px] border-collapse">
                <thead><tr>{th('start', t('ថ្ងៃ', 'Day'), false)}{th('plate', t('ឡាន', 'Truck'), false)}{th('driver', t('តៃកុង', 'Driver'), false)}{th('km', 'km')}{th('moving', t('បើក', 'Moving'))}{th('stopMin', t('ឈប់', 'Stopped'))}{th('noSignal', t('គ្មានសញ្ញា', 'No signal'))}</tr></thead>
                <tbody>
                  {trips.map(x => (
                    <tr key={x.id} className={'border-b border-line cursor-pointer ' + (sel === x.id ? 'bg-oksoft' : 'hover:bg-[rgba(11,79,108,.06)]')} onClick={() => { setSel(x.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                      <td className="px-1.5 py-1.5 whitespace-nowrap">{dayOf(x.day)} {clock(x.start)}</td>
                      <td className="px-1.5 whitespace-nowrap font-semibold">{x.plate || (x.id.indexOf('D:') === 0 ? '📱' : '')}</td>
                      <td className="px-1.5">{x.driver}</td>
                      <td className="px-1.5 text-right">{x.km}</td>
                      <td className="px-1.5 text-right">{hm(x.moving)}</td>
                      <td className="px-1.5 text-right font-bold">{hm(x.stopMin)}</td>
                      <td className={'px-1.5 text-right ' + (x.noSignal ? 'text-bad font-bold' : '')}>{x.noSignal ? hm(x.noSignal) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {d.traccar ? <TraccarSetup url={d.traccar} /> : null}
          <p className="muted text-[12px] text-center mt-2">
            {t('ឈប់ = នៅក្នុង ' + d.rules.radiusM + ' ម៉ែត្រ យ៉ាងតិច ' + d.rules.minMin + ' នាទី · GPS ពីទូរស័ព្ទតៃកុង (ទំព័រកម្មវិធី ឬ Traccar)',
              'Stop = within ' + d.rules.radiusM + ' m for ' + d.rules.minMin + ' min or more · GPS from the driver phone, Gate Out to delivered, while the page is open')}
          </p>
        </>
      )}
    </main>
  );
}

function TraccarSetup(p: { url: string }) {
  const copy = async () => { try { await navigator.clipboard.writeText(p.url); toast(t('បានចម្លង', 'Copied')); } catch { window.prompt('Server URL', p.url); } };
  return (
    <details className="card">
      <summary className="font-bold text-[15px] cursor-pointer">📱 {t('ដំឡើង Traccar លើទូរស័ព្ទតៃកុង (តាមដាន ទោះបិទកម្មវិធី)', 'Set up Traccar on driver phones (tracks when the app is closed)')}</summary>
      <ol className="text-[13.5px] pl-5 mt-2 mb-0 space-y-1.5">
        <li>{t('ដំឡើងកម្មវិធី "Traccar Client" (ឥតគិតថ្លៃ) ពី Google Play ឬ App Store', 'Install the free "Traccar Client" app from Google Play or the App Store')}</li>
        <li>{t('Server URL ៖', 'Server URL:')} <code className="break-all text-[12px] bg-[rgba(11,79,108,.08)] px-1 rounded">{p.url}</code> <button type="button" className="btn btn-sm ml-1" onClick={copy}>{t('ចម្លង', 'Copy')}</button></li>
        <li>{t('Device identifier = លេខបុគ្គលិក (Employee ID) របស់តៃកុង ឬ ផ្លាកលេខឡាន', 'Device identifier = the driver\'s Employee ID, or the truck plate')}</li>
        <li>{t('Frequency = 60 · Accuracy = High · បើក Service', 'Frequency = 60 · Accuracy = High · turn Service on')}</li>
        <li>{t('អនុញ្ញាតទីតាំង "គ្រប់ពេល" (Allow all the time) និងកុំឲ្យសន្សំថ្ម (Battery: Unrestricted)', 'Allow location "All the time" and set Battery to Unrestricted')}</li>
      </ol>
      <p className="muted text-[12px] mt-2 mb-0">{t('កុំចែក URL នេះជាសាធារណៈ', 'Keep this URL private')}</p>
    </details>
  );
}

function Timeline(p: { trip: Trip }) {
  const x = p.trip;
  type Row = { t: number; icon: string; text: string; sub?: string; ll?: string; tone?: string };
  const rows: Row[] = [{ t: x.start, icon: '🟢', text: t('ចាប់ផ្តើម GPS', 'GPS start') }];
  x.stops.forEach((s, i) => rows.push({ t: s.from, icon: String(i + 1), text: placeName(s.label) + ' · ' + hm(s.min), sub: clock(s.from) + ' – ' + clock(s.to) + (s.gap ? ' · ' + t('បាត់សញ្ញាខ្លះ', 'some no signal') : ''), ll: s.ll, tone: s.min >= 60 ? 'text-bad' : s.min >= 30 ? 'text-warn' : '' }));
  x.gaps.filter(g => g.km > 0.15).forEach(g => rows.push({ t: g.from, icon: '📵', text: t('គ្មានសញ្ញា', 'No signal') + ' · ' + hm(g.min), sub: clock(g.from) + ' – ' + clock(g.to) + ' · ' + g.km + ' km', tone: 'text-bad' }));
  rows.push({ t: x.end, icon: '🏁', text: t('GPS ចុងក្រោយ', 'Last GPS') });
  rows.sort((a, b) => a.t - b.t);
  return (
    <section className="card">
      <h2 className="text-[15px] font-bold mt-0 mb-1">⏱️ {x.plate ? x.plate + ' · ' : ''}{x.driver}</h2>
      <div className="muted text-[12.5px] mb-2">{x.km} km · {t('បើក', 'moving')} {hm(x.moving)} · {t('ឈប់', 'stopped')} {hm(x.stopMin)}{x.noSignal ? ' · ' + t('គ្មានសញ្ញា', 'no signal') + ' ' + hm(x.noSignal) : ''}</div>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2.5 py-1.5 border-b border-line last:border-0 text-[13.5px]">
          <span className="w-12 shrink-0 muted text-[12.5px] pt-0.5">{clock(r.t)}</span>
          <span className={'w-6 h-6 shrink-0 rounded-full grid place-items-center text-[12px] font-bold ' + (/^\d+$/.test(r.icon) ? 'bg-[#0b4f6c] text-white' : '')}>{r.icon}</span>
          <span className="flex-1 min-w-0">
            <b className={r.tone || ''}>{r.text}</b>
            {r.sub ? <small className="block muted">{r.sub}</small> : null}
          </span>
          {r.ll ? <a className="text-[12px] shrink-0 pt-0.5" href={mapsUrl(r.ll)} target="_blank" rel="noopener">Maps ›</a> : null}
        </div>
      ))}
    </section>
  );
}

function GpsMap(p: { rep: Rep; trip: Trip | null }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const [fail, setFail] = useState(false);
  useEffect(() => {
    let live = true;
    loadLeaflet().then(L => {
      if (!live || !box.current) return;
      if (!map.current) {
        map.current = L.map(box.current, { zoomControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current);
      }
      if (layer.current) layer.current.remove();
      const g = L.layerGroup().addTo(map.current);
      layer.current = g;
      const ll = (s: string) => s.split(',').map(Number) as [number, number];
      const pts: [number, number][] = [];
      const pin = (at: [number, number], html: string, bg: string, size = 24) => L.marker(at, { icon: L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        html: '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + bg + ';color:#fff;font:700 12px/' + size + 'px system-ui;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">' + html + '</div>' }) });
      L.marker(ll(p.rep.factory), { icon: L.divIcon({ className: '', html: '<div style="font-size:22px">🏭</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).bindPopup(t('រោងចក្រ ISI', 'ISI plant')).addTo(g);
      const tr = p.trip;
      if (tr && tr.path && tr.path.length) {
        const path = tr.path.map(x => [x[0], x[1]] as [number, number]);
        // Route, with no-signal stretches drawn as red dashes
        let seg: [number, number][] = [path[0]];
        for (let i = 1; i < tr.path.length; i++) {
          const lost = tr.path[i][2] - tr.path[i - 1][2] > p.rep.rules.gapMin * 60000;
          if (lost) {
            L.polyline(seg, { color: '#1565c0', weight: 4, opacity: 0.85 }).addTo(g);
            L.polyline([path[i - 1], path[i]], { color: '#c62828', weight: 3, dashArray: '6 8' }).addTo(g);
            seg = [path[i]];
          } else seg.push(path[i]);
        }
        L.polyline(seg, { color: '#1565c0', weight: 4, opacity: 0.85 }).addTo(g);
        pin(path[0], '▶', '#2e7d32').bindPopup(t('ចាប់ផ្តើម', 'Start') + ' ' + clock(tr.path[0][2])).addTo(g);
        pin(path[path.length - 1], '■', '#424242').bindPopup(t('ចុងក្រោយ', 'Last') + ' ' + clock(tr.path[tr.path.length - 1][2])).addTo(g);
        tr.stops.forEach((s, i) => {
          const bg = s.min >= 60 ? '#c62828' : s.min >= 30 ? '#ef6c00' : '#0b4f6c';
          pin(ll(s.ll), String(i + 1), bg, 26).bindPopup('<b>' + (i + 1) + '. ' + placeName(s.label) + '</b><br>' + clock(s.from) + ' – ' + clock(s.to) + '<br>' + hm(s.min) + ' ' + t('ម៉ោង:នាទី', 'h:mm')).addTo(g);
        });
        pts.push(...path);
      } else {
        const max = Math.max(1, ...p.rep.places.map(x => x.total));
        p.rep.places.forEach((x, i) => {
          const at = ll(x.ll);
          const bg = x.longest >= 60 ? '#c62828' : x.longest >= 30 ? '#ef6c00' : '#0b4f6c';
          L.circleMarker(at, { radius: 7 + 18 * Math.sqrt(x.total / max), color: '#fff', weight: 2, fillColor: bg, fillOpacity: 0.75 })
            .bindPopup('<b>' + (i + 1) + '. ' + placeName(x.label) + '</b><br>' + x.visits + ' ' + t('ដង', 'stops') + ' · ' + t('សរុប', 'total') + ' ' + hm(x.total) + '<br>' + t('យូរបំផុត', 'longest') + ' ' + hm(x.longest) + '<br>' + x.trucks.slice(0, 6).join(', '))
            .addTo(g);
          pts.push(at);
        });
      }
      if (pts.length) map.current.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 16 });
      else map.current.setView(ll(p.rep.factory), 11);
      setTimeout(() => map.current && map.current.invalidateSize(), 50);
    }).catch(() => { if (live) setFail(true); });
    return () => { live = false; };
  }, [p.rep, p.trip]);
  useEffect(() => () => { if (map.current) { map.current.remove(); map.current = null; } }, []);
  if (fail) return <div className="px-3 pb-2"><Alert tone="warn">{t('មិនអាចបើកផែនទីបានទេ', 'The map could not load')}</Alert></div>;
  return <div ref={box} className="w-full h-[360px] xl:h-[460px] bg-[#e8eef1]" data-testid="gps-map" />;
}

function Tile(p: { k: string; v: string; sub: string; tone?: string }) {
  return (
    <div className="card !mb-0 !p-2.5 min-w-0">
      <div className="muted text-[11.5px] leading-tight">{p.k}</div>
      <div className={'text-[21px] font-extrabold leading-tight ' + (p.tone || '')}>{p.v}</div>
      <div className="muted text-[11px] leading-tight">{p.sub}</div>
    </div>
  );
}
