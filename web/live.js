// Background refresh shared by the iSteel apps (Kim, 30 Oct 2026): screens pick up new data on their own,
// without the user pressing Refresh, and never while the user is typing.
// Usage: LIVE.start({ run: () => promise, every: 60000, busy: () => bool })
//        LIVE.keep(() => redraw())   redraws without jumping the page back to the top
// A check runs only when the page is on screen, online, and someone touched the phone in the last
// 15 minutes, so an idle phone left open does not use up the Apps Script quota.
(function () {
  'use strict';
  const IDLE_MS = 15 * 60 * 1000;
  let lastUse = Date.now();
  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach(ev =>
    window.addEventListener(ev, () => { lastUse = Date.now(); }, { passive: true, capture: true }));

  const TYPING = /^(text|search|email|tel|number|url|password|date|time|datetime-local|month|week)$/;
  /** True while the user is in a text box, or has typed or ticked something on screen that is not saved yet. */
  function typing() {
    const a = document.activeElement;
    if (a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && TYPING.test(a.type)))) return true;
    if (document.querySelector('dialog[open], .arq-bg, [data-live-hold]')) return true;
    const els = document.querySelectorAll('input, textarea, select');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      // list search boxes keep their text in the app and are drawn again with it
      if (el.hasAttribute('data-live-ok') || el.disabled || /^(hidden|file|search)$/.test(el.type)) continue;
      if (el.tagName === 'SELECT') {
        if (el.multiple || !el.options.length) continue;
        let d = 0;
        for (let k = 0; k < el.options.length; k++) if (el.options[k].defaultSelected) { d = k; break; }
        if (el.selectedIndex !== d) return true;
      }
      else if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) return true; }
      else if (el.value !== el.defaultValue) return true;
    }
    return false;
  }

  /** Runs a redraw (which may return a promise) and puts the page (and a scrolling <main>) back where the user was. */
  function keep(fn) {
    const y = window.scrollY, m = document.querySelector('main'), my = m ? m.scrollTop : 0;
    const put = () => {
      if (window.scrollY !== y) window.scrollTo(0, y);
      const m2 = document.querySelector('main');
      if (m2 && m2.scrollTop !== my) m2.scrollTop = my;
    };
    const out = fn();
    put();
    if (out && typeof out.then === 'function') return out.then(v => { put(); return v; });
    return out;
  }

  function start(o) {
    const every = o.every || 60000;
    let last = Date.now(), wait = every, running = false, runAt = 0;
    // a check stuck for over 75 s (phone slept mid-request) no longer blocks the next ones
    const ready = () => document.visibilityState === 'visible' && navigator.onLine !== false && !(running && Date.now() - runAt < 75000)
      && !typing() && !(o.busy && o.busy());
    async function tick(force) {
      if (!ready()) return;
      if (!force && (Date.now() - last < wait || Date.now() - lastUse > IDLE_MS)) return;
      running = true; runAt = last = Date.now();
      try { await o.run(); wait = every; }
      catch (e) { wait = Math.min(wait * 2, 5 * 60 * 1000); }   // server trouble: check less often
      finally { running = false; }
    }
    setInterval(() => tick(false), 5000);
    // Back on screen (or back online) after a while away: check at once.
    const back = () => { if (document.visibilityState === 'visible' && Date.now() - last > 20000) { lastUse = Date.now(); tick(true); } };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('online', back);
    return { now: () => tick(true) };
  }

  // ---- "Last updated" stamp in the app bar (Kim, 3 Nov 2026): every good answer from the Apps Script counts as fresh data.
  // Shown under the app name as dd-Mmm-yyyy HH:MM (amber when older than 3 minutes); kept per app so a reopened app
  // shows when its saved data is from until the first answer arrives.
  const AT_KEY = 'live_at:' + location.pathname.replace(/index\.html$/, '');
  let at = 0;
  try { at = +(localStorage.getItem(AT_KEY) || 0); } catch (e) { /* private mode */ }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const two = n => (n < 10 ? '0' : '') + n;
  // Phones leave out the year so the bar fits (Kim, 13 Nov 2026, option C).
  const narrow = () => window.matchMedia && matchMedia('(max-width: 600px)').matches;
  const stamp = d => two(d.getDate()) + '-' + MON[d.getMonth()] + (narrow() ? '' : '-' + d.getFullYear()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  function paintAt() {
    if (!at) return;
    let el = document.getElementById('liveAt');
    if (!el) {
      const box = document.querySelector('header .sep + div') || document.querySelector('header .logo-col');
      if (!box) return;
      if (!document.getElementById('liveAtCss')) {
        const st = document.createElement('style'); st.id = 'liveAtCss';
        st.textContent = 'header .sep + div.has-at small:not(.live-at){display:none}header .sep + div.has-at{display:flex;flex-direction:column;justify-content:center;min-width:0}' +
          '.live-at{display:block;font-size:10.5px;line-height:1.25;font-weight:600;color:rgba(255,255,255,.78);white-space:nowrap;letter-spacing:0}.live-at.old{color:#fbbf24}';
        document.head.appendChild(st);
      }
      el = document.createElement('small'); el.id = 'liveAt'; el.className = 'live-at';
      box.classList.add('has-at'); box.appendChild(el);
    }
    if (spinning) return;
    const old = Date.now() - at > 3 * 60 * 1000;
    el.className = 'live-at' + (old ? ' old' : '');
    el.textContent = (old ? '⚠ ' : '🔄 ') + stamp(new Date(at));
    el.title = 'Data last updated';
  }
  function mark() { at = Date.now(); try { localStorage.setItem(AT_KEY, String(at)); } catch (e) { /* private mode */ } paintAt(); }
  // ---- Refresh you can see (Kim, 5 Nov 2026: "click refresh many times, nothing happens"): the ISI STEEL logo turns while
  // the app's data is loading, the bar says so (with the seconds when the server is slow), then shows the new time
  // with a tick, or a warning when the refresh failed.
  const inflight = {};
  let pending = 0, spinning = false, spinAt = 0, spinSawCall = false, spinGood = false, spinBad = false, spinTimer = 0, flashTimer = 0;
  const L = (km, en) => (window.LANG && LANG.get && LANG.get() === 'en' ? en : km);
  function spinCss() {
    if (document.getElementById('liveSpinCss')) return;
    const st = document.createElement('style'); st.id = 'liveSpinCss';
    st.textContent = '.isi-logo.live-spin img{animation:liveSpin 1s linear infinite}@keyframes liveSpin{to{transform:rotate(360deg)}}' +
      '.live-at.busy{color:#fff}.live-at.good{color:#4ade80}.live-at.bad{color:#fbbf24}@media (prefers-reduced-motion:reduce){.isi-logo.live-spin img{animation:none;opacity:.6}}';
    document.head.appendChild(st);
  }
  function spinStart() {
    spinCss();
    spinning = true; spinAt = Date.now(); spinSawCall = pending > 0; spinGood = spinBad = false;
    document.querySelectorAll('.isi-logo').forEach(el => el.classList.add('live-spin'));
    clearInterval(spinTimer);
    spinTimer = setInterval(() => {
      const sec = Math.round((Date.now() - spinAt) / 1000);
      // the app did not ask the server (a form is open, or it only redrew): stop turning
      if (!spinSawCall && sec >= 3) return spinEnd(true);
      if (sec > 95) { spinBad = true; return spinEnd(); }
      paintBusy(sec);
    }, 1000);
    paintBusy(0);
  }
  function paintBusy(sec) {
    if (!at) at = Date.now() - 1;
    paintAt();
    const el = document.getElementById('liveAt');
    if (!el || !spinning) return;
    el.className = 'live-at busy';
    el.textContent = '⏳ ' + (sec >= 8 ? L('ម៉ាស៊ីនមេយឺត ' + sec + ' វិនាទី…', 'Server is slow, ' + sec + ' s…') : L('កំពុងធ្វើបច្ចុប្បន្នភាព…', 'Refreshing…'));
  }
  function spinEnd(quiet) {
    if (!spinning) return;
    spinning = false; clearInterval(spinTimer);
    document.querySelectorAll('.isi-logo').forEach(el => el.classList.remove('live-spin'));
    paintAt();
    const el = document.getElementById('liveAt');
    if (!el || quiet) return;
    clearTimeout(flashTimer);
    if (spinBad && !spinGood) {
      el.className = 'live-at bad';
      el.textContent = '⚠ ' + L('មិនបានធ្វើបច្ចុប្បន្នភាព · ចុចម្តងទៀត', 'Not refreshed · tap again');
      flashTimer = setTimeout(paintAt, 6000);
    } else {
      el.className = 'live-at good';
      el.textContent = '✓ ' + stamp(new Date(at));
      flashTimer = setTimeout(paintAt, 2500);
    }
  }
  document.addEventListener('click', e => {
    if (!(e.target && e.target.closest && e.target.closest('.isi-logo'))) return;
    if (spinning) return;   // already loading: the same request is reused, nothing new is sent
    spinStart();
  }, true);

  if (window.fetch) {
    const f0 = window.fetch.bind(window);
    window.fetch = function (url, opt) {
      const api = /script\.google(usercontent)?\.com/.test(String((url && url.url) || url));
      // Kim, 5 Nov 2026: a request cut off while the phone slept never answered, and the app waited on it forever.
      // Calls to the Apps Script now give up after 90 s, so the app shows the error and the next refresh runs.
      let timer = 0;
      if (api && window.AbortController && !(opt && opt.signal)) {
        const c = new AbortController(); timer = setTimeout(() => c.abort(), 90000);
        opt = Object.assign({}, opt, { signal: c.signal });
      }
      // Kim, 5 Nov 2026: tapping Refresh again while the first one was still loading sent the same request again and
      // again, and the Apps Script got slower with each copy. The same request now waits for the one already on its way.
      const key = api && typeof (opt && opt.body) === 'string' ? String((url && url.url) || url) + '|' + opt.body : '';
      if (key && inflight[key]) { if (timer) clearTimeout(timer); return inflight[key].then(r => r.clone()); }
      const p = f0(url, opt);
      if (timer) p.then(() => clearTimeout(timer), () => clearTimeout(timer));
      if (key) { inflight[key] = p; const drop = () => { delete inflight[key]; }; p.then(drop, drop); }
      // only the app's own data counts: startup ads and photo downloads come from other calls and would hide a failing refresh
      let act = '';
      try { act = JSON.parse((opt && opt.body) || '{}').action || ''; } catch (e) { /* not JSON */ }
      if (api && !/^(ads|adMedia|adSeen|photos?|thumbs?|media|voice)$/.test(act)) {
        pending++; spinSawCall = true;
        const done = good => { pending = Math.max(0, pending - 1); if (good) spinGood = true; else spinBad = true; if (!pending) spinEnd(); };
        p.then(res => {
          if (!res.ok) return done(false);
          res.clone().json().then(d => { const ok = d && d.ok !== false && !d.error; if (ok) mark(); done(ok); }).catch(() => done(false));
        }, () => done(false));
        return key ? p.then(r => r.clone()) : p;
      }
      return key ? p.then(r => r.clone()) : p;
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintAt); else paintAt();
  setInterval(paintAt, 30000);

  // ---- New app version (Kim, 3 Nov 2026: "the phone is not updated"): a phone keeps the app open for days and the
  // ISI STEEL refresh only reloads data, so the page compares its own ?v= file tags with the site's newest page and
  // reloads itself when they differ: on the logo tap, back on screen after 2+ minutes, and every 5 minutes.
  const tags = list => list.filter(u => /\?v=/.test(u) && !/^https?:/.test(u));
  function mine() { return tags([].map.call(document.querySelectorAll('script[src],link[href]'), el => el.getAttribute('src') || el.getAttribute('href'))); }
  let checking = false, lastCheck = 0;
  function checkVersion() {
    if (checking || !navigator.onLine || /[?&]demo/.test(location.search)) return;
    checking = true; lastCheck = Date.now();
    fetch(location.pathname + '?nosw=1', { cache: 'no-store' }).then(r => (r.ok ? r.text() : '')).then(html => {
      const have = mine(), site = tags((html.match(/(?:src|href)="[^"]+"/g) || []).map(a => a.replace(/^(?:src|href)="|"$/g, '')));
      if (!have.length || !site.length) return;
      if (site.some(u => have.indexOf(u) < 0) && !typing()) location.reload();
    }).catch(() => {}).then(() => { checking = false; });
  }
  document.addEventListener('click', e => { if (e.target && e.target.closest && e.target.closest('.isi-logo')) checkVersion(); }, true);
  let hidAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { hidAt = Date.now(); return; }
    if (hidAt && Date.now() - hidAt > 2 * 60 * 1000) checkVersion();
  });
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastCheck > 5 * 60 * 1000) checkVersion(); }, 60000);

  window.LIVE = { start, keep, typing, mark, checkVersion };
})();
