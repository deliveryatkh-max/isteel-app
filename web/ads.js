// Startup ads for every iSteel app (Kim, 30 Oct 2026), managed in the 🖼️ Gallery Manager (gallery/).
// Usage: <script src="../config.js"></script><script src="../ads.js" data-app="fuel"></script>
// When the app opens, one ad that is live for this app, this person and its "how often" shows full screen, with Skip.
// Only ads already on the phone show, so opening an app never waits: the list is checked in the background
// (a tiny call when nothing changed) and the files are downloaded once and kept in IndexedDB.
// Without a sign-in (or before the new Code.gs is deployed) nothing shows and nothing breaks.
(function () {
  'use strict';
  const me = document.currentScript;
  const APP = (me && me.dataset.app) || '';
  const API = (window.APP_CONFIG || {}).API_URL || '';
  const TOKEN_KEY = 'fr_id_token';
  const NAMES = { fuel: ['ចាក់សាំង', 'Fuel Refill'], transport: ['ដឹកជញ្ជូន', 'Delivery'], overtime: ['ថែមម៉ោង', 'Overtime'],
    inbound: ['ទទួលទំនិញ', 'Inbound'], incident: ['គ្រោះថ្នាក់', 'Incident'], meeting: ['ប្រជុំ', 'Meetings'], home: ['ទំព័រដើម', 'Home'] };
  const CHECK_MS = 2 * 60 * 1000;     // look for new ads at most every 2 minutes
  const GAP_MS = 60 * 1000;           // never two startup ads within a minute (home menu, then an app)

  const L = (km, en) => window.LANG ? LANG.t(km, en) : km;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const getJ = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };
  const claims = () => { try { return JSON.parse(decodeURIComponent(escape(atob((get(TOKEN_KEY) || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; } };
  const signedIn = () => { const c = claims(); return !!(c && c.exp * 1000 > Date.now()); };
  const cacheKey = () => 'isteel_ads:' + ((claims() || {}).email || '');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

  async function api(action, payload) {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: get(TOKEN_KEY), payload: payload || {} }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Error');
    if (data.session) set(TOKEN_KEY, data.session);
    return data.data;
  }

  // ---------------- The list, kept on the phone ----------------
  let cache = null;
  const load = () => cache || (cache = getJ(cacheKey(), null));
  const save = c => { cache = c; set(cacheKey(), JSON.stringify(c)); };
  const settings = () => Object.assign({ apps: {}, gallery: true, skip: true, maxPerDay: 5 }, (load() || {}).settings || {});
  const list = () => (load() || {}).ads || [];
  const inDates = (a, now) => (!a.start || now >= a.start) && (!a.end || now <= a.end);
  const appsOf = a => a.apps && a.apps.length ? a.apps : ['fuel'];
  /** Switched on, not hidden, in its dates and meant for this app. */
  const liveFor = (a, app, now) => a.show && !a.hidden && inDates(a, now || Date.now()) && appsOf(a).indexOf(app) >= 0;

  let syncing = null;
  /** Gets the list again when it changed, then downloads this app's live ads one at a time. */
  function sync(force) {
    if (!API || !signedIn()) return Promise.resolve();
    if (syncing) return syncing;
    const c = load();
    if (!force && c && Date.now() - (c.at || 0) < CHECK_MS) return Promise.resolve();
    syncing = (async () => {
      const res = await api('ads', { have: c && c.version });
      if (res.same && c) save(Object.assign({}, c, { at: Date.now() }));
      else {
        save({ version: res.version, settings: res.settings || null, ads: res.ads || [], at: Date.now() });
        store.keepOnly((res.ads || []).map(a => a.key));
        changed.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
      }
      if (APP) for (const a of list().filter(x => liveFor(x, APP))) await blob(a, true).catch(() => {});
    })().catch(() => { /* offline or old server: try again next time */ }).finally(() => { syncing = null; });
    return syncing;
  }
  const changed = [];

  // ---------------- Files on the phone (IndexedDB "fr_ads", shared with the Fuel app's old ads) ----------------
  const store = {
    db: null,
    open() {
      if (this.db) return this.db;
      return (this.db = new Promise(resolve => {
        if (!window.indexedDB) return resolve(null);
        try {
          const rq = indexedDB.open('fr_ads', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('media', { keyPath: 'key' });
          rq.onsuccess = () => resolve(rq.result);
          rq.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      }));
    },
    async get(key) {
      const db = await this.open();
      if (!db || !key) return null;
      return new Promise(resolve => {
        try {
          const rq = db.transaction('media').objectStore('media').get(key);
          rq.onsuccess = () => resolve(rq.result ? rq.result.blob : null);
          rq.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    },
    async put(key, b) {
      const db = await this.open();
      if (!db || !key) return;
      return new Promise(resolve => {
        try {
          const tx = db.transaction('media', 'readwrite');
          tx.objectStore('media').put({ key, blob: b, at: Date.now() });
          tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
        } catch (e) { resolve(); }
      });
    },
    /** Removes the files of ads that were deleted, replaced or are no longer for this person. */
    async keepOnly(keys) {
      const db = await this.open();
      if (!db) return;
      try {
        const st = db.transaction('media', 'readwrite').objectStore('media');
        const rq = st.getAllKeys();
        rq.onsuccess = () => (rq.result || []).forEach(k => { if (keys.indexOf(k) < 0) st.delete(k); });
      } catch (e) { /* ignore */ }
    },
  };

  /** The ad's file: from the phone, or (download = true) fetched once and kept. */
  async function blob(ad, download) {
    let b = await store.get(ad.key);
    if (b || !download || !API) return b;
    const res = await api('adMedia', { id: ad.id });
    if (!res || !res.dataUrl) return null;
    b = await (await fetch(res.dataUrl)).blob();
    await store.put(res.key || ad.key, b);
    return b;
  }

  // ---------------- Which ad shows now ----------------
  const SEEN = 'isteel_ad_seen', DAY = 'isteel_ad_day', LAST_AT = 'isteel_ad_last_at';
  function due(a, seen, now) {
    const at = seen[a.id] || 0;
    if (a.freq === 'day') { const d = new Date(now); d.setHours(0, 0, 0, 0); return at < d.getTime(); }
    if (a.freq === 'week') return now - at >= 7 * 86400000;
    return true;
  }
  async function pick() {
    const s = settings(), now = Date.now();
    if (s.apps[APP] === false) return null;
    if (now - Number(get(LAST_AT) || 0) < GAP_MS) return null;
    const day = getJ(DAY, {});
    if (s.maxPerDay > 0 && day.d === today() && day.n >= s.maxPerDay) return null;
    const seen = getJ(SEEN, {});
    const ready = [];
    for (const a of list().filter(x => liveFor(x, APP, now) && due(x, seen, now))) { const b = await store.get(a.key); if (b) ready.push({ a, b }); }
    if (!ready.length) return null;
    const last = get('fr_ad_last');
    const pool = ready.length > 1 ? ready.filter(r => r.a.id !== last) : ready;   // never the same one twice in a row
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function remember(ad) {
    const now = Date.now(), seen = getJ(SEEN, {}), day = getJ(DAY, {});
    seen[ad.id] = now;
    // Forget ads that are gone, so the list on the phone stays small.
    const ids = list().map(a => a.id);
    Object.keys(seen).forEach(id => { if (ids.indexOf(id) < 0 && id !== ad.id) delete seen[id]; });
    set(SEEN, JSON.stringify(seen));
    set(DAY, JSON.stringify(day.d === today() ? { d: day.d, n: (day.n || 0) + 1 } : { d: today(), n: 1 }));
    set(LAST_AT, String(now));
    set('fr_ad_last', ad.id);
  }

  // ---------------- The startup screen ----------------
  const text = a => a.textEn && window.LANG && LANG.get() === 'en' ? a.textEn : a.text;
  function splash(ad, b, opts) {
    opts = opts || {};
    const url = URL.createObjectURL(b), secs = ad.seconds || 7, video = ad.type === 'video';
    const skip = opts.skip !== false, name = NAMES[opts.app || APP] || ['', ''];
    const el = document.createElement('div');
    el.className = 'ad-splash';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', L('ផ្សព្វផ្សាយ', 'Announcement'));
    el.innerHTML = `
      <div class="ad-top"><div class="ad-tag"><img src="${opts.icon || '../icons/isi-white.png'}" alt="">ISI STEEL${name[0] ? ' · ' + L(name[0], name[1]) : ''}</div>
        <span class="ad-skip${skip ? '' : ' no'}" role="${skip ? 'button' : 'timer'}" tabindex="${skip ? 0 : -1}">${skip ? L('រំលង', 'Skip') + ' ' : ''}<span class="ad-ring" style="--p:0"><b>${secs}</b></span></span></div>
      <div class="ad-media">${video
        ? `<video src="${url}" autoplay muted playsinline></video><button type="button" class="ad-mute" aria-label="${L('សំឡេង', 'Sound')}">🔇</button>`
        : `<img src="${url}" alt="">`}</div>
      ${text(ad) ? `<div class="ad-text">${esc(text(ad))}</div>` : ''}
      <div class="ad-sub">${skip ? L(`ចូលទៅកម្មវិធីក្នុង <b>${secs}</b> វិនាទី · ចុច រំលង ដើម្បីចូលភ្លាម`, `Opening the app in <b>${secs}</b> s · tap Skip to go now`)
        : L(`ចូលទៅកម្មវិធីក្នុង <b>${secs}</b> វិនាទី`, `Opening the app in <b>${secs}</b> s`)}</div>
      <div class="ad-bar"><i style="${video ? 'animation:none' : `animation-duration:${secs}s`}"></i></div>`;
    document.body.appendChild(el);
    document.body.classList.add('ad-open');
    let left = secs, done = false, tick = null;
    const $ = s => el.querySelector(s);
    const ring = $('.ad-ring'), num = $('.ad-ring b'), sub = $('.ad-sub b');
    const show = (n, part) => { num.textContent = n; if (sub) sub.textContent = n; ring.style.setProperty('--p', part); };
    // Images: the admin's 5–10 seconds. Videos play to the end unless Skip is tapped.
    const timer = () => {
      if (tick) return;
      tick = setInterval(() => { left--; if (left <= 0) return close(false); show(left, (secs - left) / secs); }, 1000);
    };
    const close = skipped => {
      if (done) return;
      done = true;
      clearInterval(tick);
      const v = $('video'); if (v) v.pause();
      el.classList.add('out');
      document.body.classList.remove('ad-open');
      setTimeout(() => { el.remove(); URL.revokeObjectURL(url); }, 250);
      if (opts.onClose) opts.onClose(skipped);
    };
    if (video) {
      const v = $('video'), bar = $('.ad-bar i');
      v.ontimeupdate = () => {
        if (!v.duration || !isFinite(v.duration)) return;
        show(Math.max(1, Math.ceil(v.duration - v.currentTime)), v.currentTime / v.duration);
        bar.style.width = (v.currentTime / v.duration * 100) + '%';
      };
      v.onended = () => close(false);
      // A video the phone can't play falls back to the seconds, so the app never gets stuck.
      v.onerror = () => { bar.style.animation = ''; bar.style.animationDuration = secs + 's'; timer(); };
      const p = v.play && v.play();
      if (p && p.catch) p.catch(() => v.onerror());
    } else timer();
    if (skip) {
      const btn = $('.ad-skip');
      btn.onclick = () => close(true);
      btn.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(true); } };
      btn.focus();
    }
    const mute = $('.ad-mute');
    if (mute) mute.onclick = () => { const v = $('video'); v.muted = !v.muted; mute.textContent = v.muted ? '🔇' : '🔊'; };
    return { close };
  }

  async function start() {
    if (!APP || !API || !signedIn() || /[?&]demo\b/.test(location.search)) return;
    const p = await pick().catch(() => null);
    if (p) {
      remember(p.a);
      splash(p.a, p.b, { skip: settings().skip, onClose: skipped => { api('adSeen', { id: p.a.id, skipped, app: APP }).catch(() => {}); } });
    }
    // Look for new ads after the app has finished opening.
    setTimeout(() => sync(false), p ? 1500 : 4000);
  }

  window.ISTEEL_ADS = { app: APP, list, settings, sync, blob, store, splash, liveFor, inDates, appsOf, text, names: NAMES, onChange: fn => changed.push(fn) };
  if (APP) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})();
