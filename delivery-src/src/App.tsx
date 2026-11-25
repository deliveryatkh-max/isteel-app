import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, API_URL, CLIENT_ID, flushOutbox, outbox, setToken, signedEmail, store, token } from './api';
import { errText, t, useLang } from './i18n';
import { AppCtx, go, useRoute } from './state';
import type { Boot, Ops, TripSummary } from './types';
import { Alert, BottomNav, Header, Spinner, Tab, Toaster, toast } from './components/ui';
import { OpsPage } from './pages/Ops';
import { ScanPage } from './pages/Scan';
import ReportPage from './pages/Report';
import GpsPage from './pages/Gps';
import DashboardPage from './pages/Dashboard';   // in the main file: a lazy chunk loads a second copy of the app (delivery.js without ?v)
import { RecordPage } from './pages/Record';
import { StepsPage } from './pages/Steps';
import { TripPage } from './pages/Trip';
import { TripsPage } from './pages/Trips';
import { DnPage, DnSearchPage } from './pages/Dn';
import { MorePage, QualityPage, UsersPage } from './pages/Admin';
import { JoinLinksPage } from './pages/JoinLinks';
import { ComplaintsPage } from './components/Complaints';
import { HOME, ordered, PhoneFrame, SideNav, useLayout } from './components/Nav';

// The dashboard is loaded only when opened. After an update the old file name may be gone: reload once to get the new one.


// Five buttons (Kim, 12 Oct 2026): Summary is inside Trips, DN search is inside Scan, Refresh is the ISI STEEL logo.
const TABS: Tab[] = [
  HOME,
  { id: 'ops', icon: '🚚', km: 'ជើងដឹក', en: 'Trips' },
  { id: 'scan', icon: '📷', km: 'ស្កេន', en: 'Scan', big: true },
  { id: 'record', icon: '➕', km: 'កត់ត្រា', en: 'Record' },
  { id: 'more', icon: '☰', km: 'ផ្សេងៗ', en: 'More' },
];
// Kim's 9-step flow (20 Nov 2026): Record opens the new Steps screen. Drivers see only their own truck (opened by scanning a DN),
// so they get no Trips, Scan or old Record tab; warehouse staff open on the trucks inside.
// Kim (24 Nov 2026): office roles get 📊 Report in place of Scan (Scan / DN search moved to More).
const REPORT_TAB: Tab = { id: 'report', icon: '📊', km: 'របាយការណ៍', en: 'Report', big: true };
const OFFICE_TABS: Tab[] = TABS.map(x => (x.id === 'scan' ? REPORT_TAB : x));
const DRIVER_TABS: Tab[] = [HOME, { id: 'record', icon: '📷', km: 'ស្កេន DN', en: 'Scan DN', big: true }, { id: 'more', icon: '☰', km: 'ផ្សេងៗ', en: 'More' }];
const OLD_FORM = false;
export const OFFICE = ['admin', 'supervisor', 'logistics'];
const DRIVER_PAGES = ['', 'record', 'steps', 'more', 'complaints'];
const TAB_OF: Record<string, string> = { steps: 'record', '': 'ops', trips: 'ops', trip: 'ops', scan: 'scan', dn: 'scan', record: 'record', more: 'more', quality: 'more', users: 'more', complaints: 'more', dashboard: 'more', joinlinks: 'more', gps: 'more', report: 'report' };

// Opens at once from what the phone saw last time, then refreshes from the server (Kim: everything must be fast).
const bootKey = () => 'dlv_boot_' + signedEmail();
const opsKey = () => 'dlv_ops_' + signedEmail();

/** On a computer with 📱 Phone view on, only the phone frame shows (the app inside it loads the data); otherwise the app. */
export function Root() {
  const lay = useLayout();
  if (lay.wide && lay.prefs.phone) {
    return <><Header phoneView={{ on: true, toggle: () => lay.save({ phone: false }) }} /><PhoneFrame /></>;
  }
  return <App lay={lay} />;
}

function App({ lay }: { lay: ReturnType<typeof useLayout> }) {
  useLang();
  const [boot, setBoot] = useState<Boot | null>(() => (token() ? store.json<Boot>(bootKey()) : null));
  const [ops, setOps] = useState<Ops | null>(() => (token() ? store.json<Ops>(opsKey()) : null));
  const [need, setNeed] = useState<'' | 'signin' | 'noaccess' | 'setup'>(() => (!API_URL ? 'setup' : token() ? '' : 'signin'));
  const [err, setErr] = useState('');
  const [busyN, setBusyN] = useState(0);
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState(0);
  const waiting = useSyncExternalStore(outbox.subscribe, () => outbox.list().length);
  const route = useRoute();
  const phoneView = lay.wide ? { on: lay.prefs.phone, toggle: () => lay.save({ phone: !lay.prefs.phone }) } : undefined;
  const side = lay.wide && !lay.prefs.phone ? lay.prefs.side : '';
  useEffect(() => {
    const c = document.body.classList;
    c.toggle('nav-side', !!side); c.toggle('nav-left', side === 'left'); c.toggle('nav-right', side === 'right');
    return () => { c.remove('nav-side', 'nav-left', 'nav-right'); };
  }, [side]);

  const setBusy = useCallback((b: boolean) => setBusyN(n => Math.max(0, n + (b ? 1 : -1))), []);
  const failed = (e: any) => {
    if (e.code === 'AUTH') { setToken(null); setNeed('signin'); return; }
    if (e.code === 'NOACCESS') { setNeed('noaccess'); setErr(errText(e.message)); return; }
    setErr(errText(e.message));
  };
  // Trips shown ahead of the server while their step is still being sent (an older 'ops' answer must not undo them).
  const held = useRef<Record<string, TripSummary>>({});
  const withHeld = (o: Ops): Ops => (Object.keys(held.current).length ? { ...o, trips: o.trips.map(x => held.current[x.id] || x) } : o);
  const refreshOps = useCallback(async () => {
    setBusy(true);
    try { const o = withHeld(await api<Ops>('ops')); setOps(o); store.set(opsKey(), JSON.stringify(o)); setErr(''); }
    catch (e: any) { failed(e); }
    finally { setBusy(false); }
  }, []);
  const patchTrip = useCallback((trip: TripSummary, hold?: boolean | 'release') => {
    if (hold === true) held.current[trip.id] = trip; else delete held.current[trip.id];
    if (hold === 'release') return;
    setOps(o => {
      if (!o) return o;
      const has = o.trips.some(x => x.id === trip.id);
      const n = { ...o, trips: has ? o.trips.map(x => (x.id === trip.id ? trip : x)) : [trip].concat(o.trips) };
      store.set(opsKey(), JSON.stringify(n));
      return n;
    });
  }, []);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const b = await api<Boot>('boot');
      setBoot(b); store.set(bootKey(), JSON.stringify(b)); setNeed(''); setErr('');
      refreshOps();
      flushOutbox(() => refreshOps());
    } catch (e: any) { failed(e); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (!need) load(); }, [need === '']);

  // Steps saved without signal go out as soon as the phone is back online, and the Active list stays fresh.
  const last = useRef(Date.now());
  useEffect(() => {
    const on = () => { flushOutbox(() => refreshOps()); };
    // Back on screen after a while: fresh numbers straight away, without tapping anything.
    const vis = () => { if (document.visibilityState === 'visible' && Date.now() - last.current > 20000) { last.current = Date.now(); refreshOps(); setLive(x => x + 1); on(); } };
    addEventListener('online', on);
    document.addEventListener('visibilitychange', vis);
    // Live view (Kim, 12 Oct 2026: refresh in the background without clicking): every 30 s while the app is on screen
    // the trips and counts reload, and an open trip or DN page reloads every minute.
    let k = 0;
    const iv = setInterval(() => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      on();
      if (Date.now() - last.current > 25000) { last.current = Date.now(); refreshOps(); if (++k % 2 === 0) setLive(x => x + 1); }
    }, 30000);
    return () => { removeEventListener('online', on); document.removeEventListener('visibilitychange', vis); clearInterval(iv); };
  }, []);

  const refresh = () => { load(); setTick(x => x + 1); toast(t('កំពុងផ្ទុកឡើងវិញ…', 'Refreshing…')); };
  // The ISI STEEL logo in the header refreshes like the Refresh button (index.html click handler).
  useEffect(() => { (window as any).ISTEEL_REFRESH = refresh; return () => { delete (window as any).ISTEEL_REFRESH; }; });
  const busy = busyN > 0;
  const onTab = (id: string) => go(id === 'ops' ? '/' : '/' + id);

  if (need === 'setup') return <Shell busy={false}><Alert tone="warn">{t('កម្មវិធីមិនទាន់ភ្ជាប់ទៅ Google Sheet ទេ (API_URL នៅទទេក្នុង delivery/config.js)។ សូមមើល SETUP.md។', 'The app is not connected to the Google Sheet yet (API_URL is empty in delivery/config.js). See SETUP.md.')}</Alert></Shell>;
  if (need === 'signin') return <Shell busy={busy}><SignIn onToken={tok => { setToken(tok); setNeed(''); }} /></Shell>;
  if (need === 'noaccess') {
    return (
      <Shell busy={busy}>
        <Alert tone="bad">{err}</Alert>
        <p>{t('សូមស្នើសិទ្ធិពីទំព័រដើម ឬសួរអ្នកគ្រប់គ្រងឲ្យបន្ថែមអ្នកក្នុង User Manager ជាមួយតួនាទី។', 'Ask for access from the home menu, or ask the admin to add you to User Manager with a role.')}</p>
        <a className="btn-primary no-underline" href="../">{t('ទៅទំព័រដើម', 'Go to home menu')}</a>
      </Shell>
    );
  }
  if (!boot) return <Shell busy={busy}>{err ? <><Alert tone="bad">{err}</Alert><button type="button" className="btn" onClick={load}>{t('ព្យាយាមម្តងទៀត', 'Try again')}</button></> : <Spinner />}</Shell>;

  const roleKey = boot.user.roleKey;
  const isDriver = roleKey === 'driver';
  let page = route.path[0] || '';
  if (isDriver && DRIVER_PAGES.indexOf(page) < 0) page = 'steps';
  if (page === '' && (isDriver || roleKey === 'warehouse')) page = 'steps';
  const tab = TAB_OF[page] || 'ops';
  // Kim (24 Nov 2026): 📊 Report only for Admin and Supervisor, ☰ More only for Admin. The ⏳ waiting icon still opens More.
  const canReport = roleKey === 'admin' || roleKey === 'supervisor';
  const tabs = (isDriver ? DRIVER_TABS : canReport ? OFFICE_TABS : TABS).filter(x => x.id !== 'more' || boot.isAdmin);
  const navOrder = canReport ? lay.prefs.order.map(id => (id === 'scan' ? 'report' : id)) : lay.prefs.order;   // a saved order keeps Report where Scan was
  let body;
  if (page === 'scan') body = <ScanPage key={route.path.join('/')} dn={route.path[1]} />;
  // Old step form: opened with a query (Trip page "next step" links, "Other step") or while the Apps Script is still the old one.
  // Old step form hidden (Kim, 22 Nov 2026: keep only the new steps). It shows only while the Apps Script is still the old one,
  // or again when OLD_FORM is set to true. Links to it (Trip page, Scan) open the new steps of that trip instead.
  else if (page === 'record' && !isDriver && (!boot.flow || (OLD_FORM && route.q.toString()))) body = <RecordPage key={route.q.toString()} />;
  else if (page === 'record' || page === 'steps') body = <StepsPage key={route.path.join('/') + route.q.toString()} tripId={page === 'steps' ? route.path[1] : route.q.get('trip') || undefined} dn={route.q.get('dn') || undefined} />;
  // Kim's O1 B (23 Nov 2026): the trip page is the clean Steps view (old TripPage kept for the old form only).
  else if (page === 'trip' && route.path[1]) body = OLD_FORM ? <TripPage id={route.path[1]} /> : <StepsPage key={'t' + route.path[1]} tripId={route.path[1]} />;
  else if (page === 'trips' && route.path[1] === 'history') body = <TripsPage />;
  else if (page === 'dn' && route.path[1]) body = <DnPage dn={route.path[1]} />;
  else if (page === 'dn') body = <DnSearchPage />;
  else if (page === 'more') body = <MorePage />;
  else if (page === 'quality' && boot.canCorrect) body = <QualityPage />;
  else if (page === 'users' && boot.isAdmin) body = <UsersPage />;
  else if (page === 'complaints') body = <ComplaintsPage />;
  else if (page === 'joinlinks' && OFFICE.indexOf(roleKey) >= 0) body = <JoinLinksPage />;
  else if (page === 'report' && canReport) body = <ReportPage />;
  else if (page === 'gps' && boot.isAdmin) body = <GpsPage />;
  else if (page === 'dashboard' && boot.canKpi) body = <DashboardPage />;
  else body = <OpsPage />;
  const titles: Record<string, [string, string]> = {
    ops: ['ជើងដឹក', 'Trips'], scan: ['ស្កេន DN', 'Scan DN'], report: ['របាយការណ៍', 'Report'], record: ['កត់ត្រាដំណើរ', 'Record journey'], more: ['ផ្សេងៗ', 'More'],
  };
  const sub = page === 'trip' ? route.path[1] : page === 'dn' && route.path[1] ? 'DN ' + route.path[1] : page === 'quality' ? t('គុណភាពទិន្នន័យ', 'Data quality') : page === 'users' ? t('អ្នកប្រើប្រាស់', 'Users') : page === 'complaints' ? t('បណ្តឹង', 'Complaints') : page === 'dashboard' ? 'Dashboard' : page === 'gps' ? t('ចលនាឡាន (GPS ទូរស័ព្ទ)', 'Truck movement (phone GPS)') : page === 'joinlinks' ? t('តំណភ្ជាប់ Telegram អតិថិជន', 'Customer join links') : t('ដំណើរដឹកជញ្ជូន', 'Delivery journey');

  return (
    <AppCtx.Provider value={{ boot, ops, tick, live, refreshOps, patchTrip, setBusy }}>
      <Header busy={busy} waiting={waiting} onOutbox={() => go('/more')} phoneView={phoneView} title={page === 'dn' ? t('តាមដាន DN', 'DN tracking') : t(...titles[tab])} sub={sub} />
      <div className="app-body">
        {err ? <div className="max-w-3xl mx-auto px-3 pt-3"><Alert tone="bad">{err}</Alert></div> : null}
        {body}
      </div>
      {side ? <SideNav items={ordered(tabs, navOrder)} active={tab} side={side} onTab={onTab} onSide={() => lay.save({ side: side === 'left' ? 'right' : 'left' })} onOrder={ids => lay.save({ order: ids })} />
        : <BottomNav tabs={ordered(tabs, navOrder)} active={tab} onTab={onTab} />}
      <Toaster />
    </AppCtx.Provider>
  );
}

function Shell(p: { busy: boolean; children: React.ReactNode }) {
  return (
    <>
      <Header busy={p.busy} />
      <main className="max-w-md mx-auto p-4">{p.children}</main>
      <nav className="fixed bottom-0 inset-x-0 bg-card border-t border-line flex justify-center py-2" style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}>
        <a href="../" className="flex flex-col items-center text-[11.5px] text-muted no-underline font-semibold"><img src="../icons/home.svg" alt="" width={22} height={22} />{t('ទំព័រដើម', 'Home')}</a>
      </nav>
    </>
  );
}

/** Same Google sign-in as every iSteel app: signing in once on the home menu is enough. */
function SignIn(p: { onToken: (tok: string) => void }) {
  useLang();
  const box = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!CLIENT_ID) { setErr('GOOGLE_CLIENT_ID is missing in config.js'); return; }
    const ready = () => {
      const g = window.google;
      g.accounts.id.initialize({ client_id: CLIENT_ID, auto_select: true, callback: (r: any) => p.onToken(r.credential) });
      if (box.current) { box.current.innerHTML = ''; g.accounts.id.renderButton(box.current, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: t('km', 'en') }); }
      g.accounts.id.prompt();
    };
    if (window.google && window.google.accounts) return ready();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = ready; s.onerror = () => setErr('Could not load Google Sign-In.');
    document.head.appendChild(s);
  }, []);
  return (
    <div className="card text-center">
      <div className="text-[40px]">👋</div>
      <h2 className="text-lg font-bold mt-1">{t('សូមស្វាគមន៍', 'Welcome')}</h2>
      <p className="muted">{t('ចូលដោយគណនី Google របស់អ្នក', 'Sign in with your Google account')}</p>
      {err ? <Alert tone="bad">{err}</Alert> : <div ref={box} className="flex justify-center min-h-[44px]"><Spinner /></div>}
    </div>
  );
}
