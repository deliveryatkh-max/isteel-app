import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, API_URL, CLIENT_ID, flushOutbox, outbox, setToken, signedEmail, store, token } from './api';
import { errText, t, useLang } from './i18n';
import { AppCtx, go, useRoute } from './state';
import type { Boot, Ops } from './types';
import { Alert, BottomNav, Header, Spinner, Tab, Toaster, toast } from './components/ui';
import { OpsPage } from './pages/Ops';
import { ScanPage } from './pages/Scan';
import { RecordPage } from './pages/Record';
import { TripPage } from './pages/Trip';
import { TripsPage } from './pages/Trips';
import { DnPage, DnSearchPage } from './pages/Dn';
import { MorePage, QualityPage, UsersPage } from './pages/Admin';
import { ComplaintsPage } from './components/Complaints';
import { HOME, ordered, PhoneFrame, SideNav, useLayout } from './components/Nav';

// The dashboard is loaded only when opened. After an update the old file name may be gone: reload once to get the new one.
const DashboardPage = lazy(() => import('./pages/Dashboard').catch(e => {
  const k = 'dlv_chunk_reload';
  if (Date.now() - Number(sessionStorage.getItem(k) || 0) > 30000) { sessionStorage.setItem(k, String(Date.now())); location.reload(); }
  throw e;
}));

// Five buttons (Kim, 12 Oct 2026): Summary is inside Trips, DN search is inside Scan, Refresh is the ISI STEEL logo.
const TABS: Tab[] = [
  HOME,
  { id: 'ops', icon: '🚚', km: 'ជើងដឹក', en: 'Trips' },
  { id: 'scan', icon: '📷', km: 'ស្កេន', en: 'Scan', big: true },
  { id: 'record', icon: '➕', km: 'កត់ត្រា', en: 'Record' },
  { id: 'more', icon: '☰', km: 'ផ្សេងៗ', en: 'More' },
];
const TAB_OF: Record<string, string> = { '': 'ops', trips: 'ops', trip: 'ops', scan: 'scan', dn: 'scan', record: 'record', more: 'more', quality: 'more', users: 'more', complaints: 'more', dashboard: 'more' };

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
  const refreshOps = useCallback(async () => {
    setBusy(true);
    try { const o = await api<Ops>('ops'); setOps(o); store.set(opsKey(), JSON.stringify(o)); setErr(''); }
    catch (e: any) { failed(e); }
    finally { setBusy(false); }
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

  const page = route.path[0] || '';
  const tab = TAB_OF[page] || 'ops';
  let body;
  if (page === 'scan') body = <ScanPage key={route.path.join('/')} dn={route.path[1]} />;
  else if (page === 'record') body = <RecordPage key={route.q.toString()} />;
  else if (page === 'trip' && route.path[1]) body = <TripPage id={route.path[1]} />;
  else if (page === 'trips' && route.path[1] === 'history') body = <TripsPage />;
  else if (page === 'dn' && route.path[1]) body = <DnPage dn={route.path[1]} />;
  else if (page === 'dn') body = <DnSearchPage />;
  else if (page === 'more') body = <MorePage />;
  else if (page === 'quality' && boot.canCorrect) body = <QualityPage />;
  else if (page === 'users' && boot.isAdmin) body = <UsersPage />;
  else if (page === 'complaints') body = <ComplaintsPage />;
  else if (page === 'dashboard' && boot.canKpi) body = <Suspense fallback={<Spinner />}><DashboardPage /></Suspense>;
  else body = <OpsPage />;
  const titles: Record<string, [string, string]> = {
    ops: ['ជើងដឹក', 'Trips'], scan: ['ស្កេន DN', 'Scan DN'], record: ['កត់ត្រាដំណើរ', 'Record journey'], more: ['ផ្សេងៗ', 'More'],
  };
  const sub = page === 'trip' ? route.path[1] : page === 'dn' && route.path[1] ? 'DN ' + route.path[1] : page === 'quality' ? t('គុណភាពទិន្នន័យ', 'Data quality') : page === 'users' ? t('អ្នកប្រើប្រាស់', 'Users') : page === 'complaints' ? t('បណ្តឹង', 'Complaints') : page === 'dashboard' ? 'Dashboard' : t('ដំណើរដឹកជញ្ជូន', 'Delivery journey');

  return (
    <AppCtx.Provider value={{ boot, ops, tick, live, refreshOps, setBusy }}>
      <Header busy={busy} waiting={waiting} onOutbox={() => go('/more')} phoneView={phoneView} title={page === 'dn' ? t('តាមដាន DN', 'DN tracking') : t(...titles[tab])} sub={sub} />
      <div className="app-body">
        {err ? <div className="max-w-3xl mx-auto px-3 pt-3"><Alert tone="bad">{err}</Alert></div> : null}
        {body}
      </div>
      {side ? <SideNav items={ordered(TABS, lay.prefs.order)} active={tab} side={side} onTab={onTab} onSide={() => lay.save({ side: side === 'left' ? 'right' : 'left' })} onOrder={ids => lay.save({ order: ids })} />
        : <BottomNav tabs={ordered(TABS, lay.prefs.order)} active={tab} onTab={onTab} />}
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
