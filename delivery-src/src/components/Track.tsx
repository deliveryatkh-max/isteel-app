import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { t, useLang } from '../i18n';
import { Alert, toast } from './ui';

/**
 * Customer live tracking (Kim, 22 Nov 2026). After Gate Out the driver's phone shares its GPS every 30 s
 * while the page is open; the customer opens track.html (one signed link per DN) and sees the truck on a map.
 */
const SEND_EVERY_MS = 30000;

export function GpsShare(p: { tripId: string; link?: { t: string; k: string } }) {
  useLang();
  const [state, setState] = useState<'' | 'on' | 'denied' | 'none'>('');
  const last = useRef(0);
  useEffect(() => {
    if (!navigator.geolocation) { setState('none'); return; }
    const send = (pos: GeolocationPosition) => {
      setState('on');
      const now = Date.now();
      if (now - last.current < SEND_EVERY_MS || !navigator.onLine) return;
      last.current = now;
      const ll = pos.coords.latitude.toFixed(6) + ',' + pos.coords.longitude.toFixed(6);
      const acc = Math.round(pos.coords.accuracy || 0);
      const call = p.link ? api('drvGps', { t: p.link.t, k: p.link.k, ll, acc }, { noAuth: true }) : api('gps', { tripId: p.tripId, ll, acc });
      call.catch(() => { last.current = 0; });
    };
    const id = navigator.geolocation.watchPosition(send, e => setState(e.code === 1 ? 'denied' : ''), { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [p.tripId, p.link && p.link.k]);
  if (state === 'denied') return <Alert tone="warn">📍 {t('សូមអនុញ្ញាតទីតាំង (Location) ដើម្បីឲ្យអតិថិជនមើលឃើញឡាន។', 'Allow Location so the customer can see the truck.')}</Alert>;
  if (state === 'none') return null;
  return (
    <div className="flex items-center gap-2 text-[13px] text-ok font-semibold mb-2" data-testid="gps-share">
      <span className={'inline-block w-2.5 h-2.5 rounded-full ' + (state === 'on' ? 'bg-ok animate-pulse' : 'bg-line')} />
      {state === 'on' ? t('កំពុងចែករំលែកទីតាំងជាមួយអតិថិជន · សូមបើកទំព័រនេះ', 'Sharing location with the customer · keep this page open') : t('កំពុងរកទីតាំង…', 'Finding location…')}
    </div>
  );
}

/** Customer tracking link of one DN on one trip (no sign-in, no app). */
export const trackUrl = (dn: string, tripId: string, k: string) =>
  location.origin + location.pathname.replace(/[^/]*$/, '') + 'track.html?d=' + encodeURIComponent(dn) + '&t=' + encodeURIComponent(tripId) + '&k=' + k;

/** Sales: copy the live map link, or send it through Telegram. */
export function TrackLinks(p: { tripId: string; links: Record<string, string>; join?: Record<string, string>; done?: Record<string, boolean> }) {
  useLang();
  const dns = Object.keys(p.links).filter(dn => !(p.done && p.done[dn]));
  if (!dns.length) return null;
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast(t('បានចម្លងតំណ', 'Link copied')); } catch { window.prompt(t('ចម្លងតំណនេះ', 'Copy this link'), url); }
  };
  return (
    <section className="card">
      <h2 className="text-[15px] font-bold mt-0 mb-1">📍 {t('តំណតាមដានសម្រាប់អតិថិជន', 'Live tracking link for the customer')}</h2>
      <p className="muted text-[13px] mt-0">{t('ផ្ញើតំណនេះទៅអតិថិជន ដើម្បីមើលឡាននៅលើផែនទីផ្ទាល់ (មិនចាំបាច់ចូលគណនី)។', 'Send this link to the customer to see the truck on a live map (no sign-in).')}</p>
      {dns.map(dn => {
        const url = trackUrl(dn, p.tripId, p.links[dn]);
        const msg = t('🚚 ទំនិញរបស់អ្នក (DN ' + dn + ') កំពុងធ្វើដំណើរ។ មើលទីតាំងឡានផ្ទាល់:', '🚚 Your steel (DN ' + dn + ') is on the way. See the truck live:');
        return (
          <div key={dn} className="border-t border-line py-2 flex items-center justify-between gap-2 flex-wrap">
            <b>DN {dn}</b>
            <span className="flex gap-2">
              <button type="button" className="btn btn-sm" onClick={() => copy(url)}>📋 {t('ចម្លងតំណ', 'Copy link')}</button>
              <a className="btn btn-sm" target="_blank" rel="noopener" href={'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(msg)}>✈️ Telegram</a>
              <a className="btn btn-sm" target="_blank" rel="noopener" href={url}>🗺️</a>
            </span>
            {p.join && p.join[dn] ? (
              <div className="w-full text-[12.5px] muted">🤖 {t('ឲ្យអតិថិជនចុច Start លើ bot ម្តង ដើម្បីទទួលតំណដោយស្វ័យប្រវត្តិ:', 'Customer taps Start on the bot once to get links automatically:')}{' '}
                <button type="button" className="underline bg-transparent border-0 p-0 text-accent cursor-pointer" onClick={() => copy(p.join![dn])}>{t('ចម្លងតំណចូល bot', 'Copy bot join link')}</button></div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
