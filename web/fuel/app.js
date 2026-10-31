/* Fuel Refill App – data collection front end (no reports). */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.API_URL;
  const STATUS_OK = 'ត្រឹមត្រូវ';
  const STATUS_BAD = 'មិនត្រឹមត្រូវ';
  const TOKEN_KEY = 'fr_id_token';
  const MIN_KM = 1000;        // lower km readings are placeholders (0, 1, 100…), same rule as the server
  const MAX_JUMP_KM = 2000;   // more than this since the last refill needs a note

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  // Khmer by default; the 🇰🇭 / 🇬🇧 switch in the header (../lang.js) changes it for every app.
  const L = (km, en) => window.LANG ? LANG.t(km, en) : km;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KH = '០១២៣៤៥៦៧៨៩';
  const toNum = v => {
    if (v === null || v === undefined || v === '') return NaN;
    return Number(String(v).replace(/[០-៩]/g, d => KH.indexOf(d)).replace(/,/g, '').trim());
  };
  const fmtNum = n => (n === null || n === undefined || n === '' || isNaN(n)) ? '–' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = ms => {
    if (!ms) return '';
    const d = new Date(ms), p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const emojiOf = name => (String(name).match(/^\S+/) || [''])[0];
  const textOf = name => String(name).replace(/^\S+\s*/, '');

  let redraw = null;   // the login / error screen on show, redrawn when the language changes
  const state = {
    token: null,
    config: null,
    tab: 'new',
    form: null,
    editing: null,      // entry being edited, or null for a new entry
    gps: { status: 'idle' },
    busy: false,
  };

  // ---------------- API ----------------

  let inFlight = 0;
  function busy(delta) {
    inFlight = Math.max(0, inFlight + delta);
    const head = $('.head');
    if (head) head.classList.toggle('busy', inFlight > 0);
  }

  async function api(action, payload) {
    busy(1);
    try { return await (DEMO ? demoApi(action, payload || {}) : callServer(action, payload)); }
    finally { busy(-1); }
  }

  async function callServer(action, payload) {
    let res;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: state.token, payload: payload || {} }),
      });
    } catch (e) {
      throw Object.assign(new Error(L('មិនអាចភ្ជាប់អ៊ីនធឺណិត។ សូមព្យាយាមម្តងទៀត។', 'No connection. Please try again.')), { transient: true });
    }
    let data;
    try { data = await res.json(); }
    catch (e) { throw Object.assign(new Error(L('ម៉ាស៊ីនមេរវល់។ សូមព្យាយាមម្តងទៀត។', 'Server busy. Please try again.')), { transient: true }); }
    if (!data.ok) {
      const code = (String(data.error).match(/^(AUTH|NOACCESS):/) || [])[1];
      if (code === 'AUTH') { signOut(true); }
      const err = new Error(String(data.error).replace(/^(AUTH|NOACCESS):\s*/, ''));
      err.code = code;
      // Google-side hiccups (busy lock, time limit, quotas) are worth retrying; validation errors are not.
      err.transient = !code && /lock|timed? ?out|too many|exceeded|service|try again|internal error/i.test(err.message);
      throw err;
    }
    // Stay signed in: the server swaps the 1-hour Google sign-in for a session that renews itself.
    if (data.session && state.token) { state.token = data.session; storeSet(TOKEN_KEY, data.session); }
    return data.data;
  }

  // ---------------- Saved copies ----------------
  // The last server answers are kept on the phone, so screens open at once
  // and are refreshed in the background. Cleared on sign-out.

  const LOCAL_PREFIX = 'fr_c_';
  const who = () => { const c = state.token && decodeJwt(state.token); return c && c.email ? String(c.email).toLowerCase() : ''; };
  const local = {
    get(k) {
      if (DEMO || !who()) return null;
      try { const v = localStorage.getItem(LOCAL_PREFIX + who() + ':' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    set(k, v) {
      if (DEMO || !who()) return;
      try { localStorage.setItem(LOCAL_PREFIX + who() + ':' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ }
    },
    clear() {
      try { Object.keys(localStorage).filter(k => k.indexOf(LOCAL_PREFIX) === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
    },
  };
  const sameData = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Photos already opened in this session, by their sheet link.
  const photoCache = new Map();
  function rememberPhoto(url, dataUrl) {
    photoCache.set(url, dataUrl);
    if (photoCache.size > 40) photoCache.delete(photoCache.keys().next().value);
  }

  // Odometer previews in the Reviewer list (Kim, 19 Oct 2026). Loaded only for rows on screen,
  // a few per call and without the busy bar, then shrunk and kept on the phone so each loads once.
  const thumbs = {
    KEY: 'fr_thumbs', MAX: 300, map: null, queue: new Set(), timer: 0, saveTimer: 0, running: 0, seen: null,
    load() {
      if (this.map) return this.map;
      try { this.map = new Map(Object.entries(JSON.parse(localStorage.getItem(this.KEY) || '{}'))); } catch (e) { this.map = new Map(); }
      return this.map;
    },
    save() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        const m = this.load();
        while (m.size > this.MAX) m.delete(m.keys().next().value);
        try { localStorage.setItem(this.KEY, JSON.stringify(Object.fromEntries(m))); } catch (e) { /* storage full or blocked */ }
      }, 400);
    },
    get(url) { return this.load().get(url); },
    // One observer for the list: rows ask for their photo when they scroll into view.
    watch(root) {
      if (this.seen) this.seen.disconnect();
      if (!('IntersectionObserver' in window)) return;
      this.seen = new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting) return;
        this.seen.unobserve(e.target);
        this.queue.add(e.target.dataset.thumb);
        clearTimeout(this.timer); this.timer = setTimeout(() => this.fetch(), 120);
      }), { rootMargin: '200px 0px' });
      $$('[data-thumb]:not(.has-img)', root).forEach(el => this.seen.observe(el));
    },
    async fetch() {
      if (this.running >= 2 || !this.queue.size) return;
      const urls = [...this.queue].slice(0, 10);
      urls.forEach(u => this.queue.delete(u));
      this.running++;
      try {
        const res = await (DEMO ? demoApi('thumbs', { urls }) : callServer('thumbs', { urls }));
        for (const url of urls) {
          const data = res.thumbs && res.thumbs[url];
          if (!data) continue;
          const small = await shrink(data, 96).catch(() => data);
          this.load().set(url, small);
          $$(`[data-thumb="${CSS.escape(url)}"]`).forEach(el => { el.style.backgroundImage = `url('${small}')`; el.classList.add('has-img'); });
        }
        this.save();
      } catch (e) { /* offline or busy: rows keep their icon */ }
      finally { this.running--; if (this.queue.size) this.fetch(); }
    },
  };
  function shrink(dataUrl, size) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = size / Math.min(img.width, img.height), c = document.createElement('canvas');
        if (k >= 1) return resolve(dataUrl);
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  // ---------------- Outbox ----------------
  // New entries are kept on the phone and sent in the background, so Submit doesn't wait for Google.
  // They are stored in IndexedDB, so an entry still sending survives closing the app and is sent
  // the next time it opens. Each entry has a ref, so the server never saves the same one twice.

  const outbox = {
    items: [], db: null, ready: null, sent: {}, recent: [],
    load() {
      if (this.ready) return this.ready;
      this.ready = new Promise(resolve => {
        if (DEMO || !window.indexedDB) return resolve();
        try {
          const rq = indexedDB.open('fr_outbox', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('items', { keyPath: 'ref' });
          rq.onerror = () => resolve();
          rq.onsuccess = () => {
            this.db = rq.result;
            const all = this.db.transaction('items').objectStore('items').getAll();
            all.onsuccess = () => {
              const known = new Set(this.items.map(i => i.ref));
              this.items = this.items.concat((all.result || []).filter(i => !known.has(i.ref))).sort((a, b) => a.takenAt - b.takenAt);
              resolve();
            };
            all.onerror = () => resolve();
          };
        } catch (e) { resolve(); }
      });
      return this.ready;
    },
    write(fn) {
      if (!this.db) return Promise.resolve();
      return new Promise(resolve => {
        try {
          const tx = this.db.transaction('items', 'readwrite');
          fn(tx.objectStore('items'));
          tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
        } catch (e) { resolve(); }
      });
    },
    async add(item) { await this.load(); this.items.push(item); await this.write(st => st.put(item)); },
    save(item) { return this.write(st => st.put(item)); },
    remove(ref) { this.items = this.items.filter(i => i.ref !== ref); return this.write(st => st.delete(ref)); },
    get(ref) { return this.items.find(i => i.ref === ref) || null; },
    mine() {
      const me = state.config && state.config.user && state.config.user.email;
      return this.items.filter(i => i.user === me);
    },
  };
  const newRef = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);

  let flushing = null, retryTimer = null, retryDelay = 0;
  /** Sends waiting entries one by one, oldest first. Safe to call any time. */
  function flushOutbox() {
    if (flushing) return flushing;
    if (!state.config || (!DEMO && !state.token)) return Promise.resolve();
    clearTimeout(retryTimer);
    flushing = (async () => {
      await outbox.load();
      let sentAny = false;
      // Picks the next waiting entry each time, so entries added while sending are sent too.
      for (let item; (item = outbox.mine().find(i => !i.error));) {
        try {
          const res = await api('submit', item.payload);
          await outbox.remove(item.ref);
          outbox.sent[item.ref] = res.id;
          const p = Object.assign({}, item.payload, res.driver ? { driver: res.driver, plate: res.plate } : {});
          outbox.recent.push({ p, at: item.takenAt });   // until the lists come back from the server
          const row = Object.assign(localRow(p), {
            id: res.id, dateTime: item.takenAt, status: '', reviewedBy: '', user: item.user,
            latLong: `${(+p.lat).toFixed(6)}, ${(+p.lng).toFixed(6)}`,
          });
          if (!state.mine) state.mine = local.get('mine');
          if (state.mine && !state.mine.some(r => r.id === res.id)) { state.mine.unshift(row); local.set('mine', state.mine); }
          if (rv.rows && !rv.rows.some(r => r.id === res.id)) { rv.rows.unshift(row); rv.fetchedAt = 0; }
          sentAny = true;
          retryDelay = 0;
        } catch (e) {
          if (e.code === 'AUTH' || e.code === 'NOACCESS') break;   // sent again after signing in
          if (e.transient) {
            item.tries = (item.tries || 0) + 1;
            outbox.save(item);
            retryDelay = Math.min(retryDelay ? retryDelay * 2 : 5000, 60000);
            retryTimer = setTimeout(flushOutbox, retryDelay);
            break;
          }
          item.error = e.message;
          await outbox.save(item);
          toast('⚠️ ' + L('មិនទាន់បានរក្សាទុក', 'Not saved') + ': ' + e.message);
        }
        outboxChanged();
      }
      if (sentAny) refreshConfig();
    })().finally(() => { flushing = null; outboxChanged(); });
    return flushing;
  }
  window.addEventListener('online', () => flushOutbox());
  // A phone can keep the app open for days. Back on screen after 10+ minutes, it checks whether a newer
  // version is on the site and reloads when nothing is being typed (Kim, 17 Oct 2026).
  const MY_VERSION = ((document.currentScript && document.currentScript.src.match(/[?&]v=([\w.-]+)/)) || [])[1] || '';
  let hiddenAt = 0;
  function untouched() {
    const f = state.form;
    return !state.editing && (!f || !(f.km || f.hour || f.litres || f.note || f.odoPhoto || f.hourPhoto || f.pumpPhoto));
  }
  function checkVersion() {
    if (!MY_VERSION || DEMO) return;
    fetch('./?nosw=1', { cache: 'no-store' }).then(r => r.text()).then(html => {
      const v = (html.match(/app\.js\?v=([\w.-]+)/) || [])[1];
      if (v && v !== MY_VERSION && untouched()) location.reload();
    }).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return; }
    flushOutbox();
    if (hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000) checkVersion();
  });
  window.addEventListener('beforeunload', e => {
    // Entries are kept in IndexedDB; only warn when this browser can't keep them.
    if (!outbox.db && outbox.mine().length && !DEMO) { e.preventDefault(); e.returnValue = ''; }
  });

  /** Refreshes whatever on screen shows waiting entries. */
  function outboxChanged() {
    const c = current();
    if (!c || $('#tabs').hidden) return;
    if (c.s === 'mine') drawMine();
    else if (c.s === 'success') renderSuccess(c.ref);
    else if (c.s === 'new') drawOutboxNote();
  }

  /** Small note at the top of the New form about entries still sending or not saved. */
  function drawOutboxNote() {
    const box = $('#outboxNote');
    if (!box) return;
    const items = outbox.mine(), failed = items.filter(i => i.error).length, sending = items.length - failed;
    box.innerHTML = (failed ? `<div class="alert bad ob-note">⚠️ ${failed} ${L('មិនទាន់បានរក្សាទុក', 'not saved')}.
        <button type="button" class="btn small" data-ob-view>${L('មើល', 'View')}</button></div>` : '')
      + (sending ? `<div class="alert warn ob-note">⏳ ${L('កំពុងបញ្ជូន', 'Sending')} ${sending}…</div>` : '');
    $$('[data-ob-view]', box).forEach(b => b.onclick = () => go({ s: 'mine' }));
  }

  /** Waiting entries as the My entries list shows them. */
  function outboxRows() {
    return outbox.mine().slice().reverse().map(i => Object.assign(localRow(i.payload), {
      id: '', ref: i.ref, dateTime: i.takenAt, status: '', error: i.error || '',
    }));
  }

  /** A not-saved entry goes back into the New form so it can be fixed and sent again. */
  async function fixOutboxItem(ref) {
    const item = outbox.get(ref);
    if (!item) return;
    const p = item.payload;
    await outbox.remove(ref);
    if (state.editing) leaveEdit();
    // Keeps the original time and place of the refill.
    state.editing = null;
    state.form = { type: p.type, plate: p.plate, driver: p.driver, km: p.km || '', hour: p.hour || '',
      litres: p.litres, note: p.note || '', odoPhoto: p.odoPhoto || null, hourPhoto: p.hourPhoto || null,
      pumpPhoto: p.pumpPhoto || null, signature: p.signature || null, takenAt: item.takenAt, meterBroken: !!p.meterBroken,
      newDriver: !!p.newDriver, newPlate: !!p.newPlate,
      stamped: p.stamped ? { odoPhoto: true, hourPhoto: true, pumpPhoto: true } : null };
    state.gps = { status: 'ok', lat: p.lat, lng: p.lng, acc: 0 };
    go({ s: 'new' });
    toast(L('សូមកែ ហើយបញ្ជូនម្តងទៀត', 'Fix it and submit again'));
  }

  // ---------------- Demo mode ----------------

  const demo = { rows: (window.DEMO_DATA && window.DEMO_DATA.rows || []).map(r => Object.assign({}, r)), photos: {}, reads: {}, user: null,
    ads: (window.DEMO_DATA && window.DEMO_DATA.ads || []).map(a => Object.assign({}, a)), adsVer: 1 };
  function demoApi(action, p) {
    const D = window.DEMO_DATA;
    const user = demo.user;
    const find = id => demo.rows.find(r => r.id === id);
    return new Promise((resolve, reject) => setTimeout(() => {
      try {
        if (action === 'config') {
          const last = JSON.parse(JSON.stringify(D.lastReadings));
          demo.rows.forEach(r => {
            if (r.status === STATUS_BAD) return;
            const o = last[r.plate] || (last[r.plate] = { km: 0, kmAt: 0, hour: 0, hourAt: 0 });
            if (r.km > 1 && r.dateTime > o.kmAt) { o.km = r.km; o.kmAt = r.dateTime; }
            if (r.hour > 1 && r.dateTime > o.hourAt) { o.hour = r.hour; o.hourAt = r.dateTime; }
          });
          return resolve({ user, types: D.types, plates: D.plates, drivers: D.drivers, equipment: D.equipment, litreLimit: D.litreLimit, lastReadings: last, brokenPlates: D.brokenPlates || [],
            isAdmin: user.role === 'admin', adsVersion: String(demo.adsVer) });
        }
        const savePhotos = (r, src) => ['odoPhoto', 'hourPhoto', 'pumpPhoto', 'signature'].forEach(k => {
          if (src[k]) { const key = 'demo://' + r.id + '/' + k + '/' + Date.now(); demo.photos[key] = src[k]; r[k] = key; }
        });
        if (action === 'submit') {
          const id = p.newId || entryId(Date.now());
          const r = { id, type: p.type, plate: p.plate, driver: p.driver, km: toNum(p.km) || null, hour: toNum(p.hour) || null,
            litres: toNum(p.litres), note: p.note || '', latLong: `${(+p.lat).toFixed(6)}, ${(+p.lng).toFixed(6)}`,
            user: user.email, dateTime: Date.now(), status: '', reviewedBy: '' };
          savePhotos(r, p);
          // Demo photo check: the demo reader's answers (see readPhoto) stand in for the server's.
          if (p.reads && Object.keys(p.reads).length) r.pc = Object.assign({}, p.reads.odoPhoto || p.reads.hourPhoto ? { meter: (demo.reads[p.reads.odoPhoto || p.reads.hourPhoto] || {}).value, meterWrong: (demo.reads[p.reads.odoPhoto || p.reads.hourPhoto] || {}).wrong } : {},
            p.reads.pumpPhoto ? { litres: (demo.reads[p.reads.pumpPhoto] || {}).value, pumpWrong: (demo.reads[p.reads.pumpPhoto] || {}).wrong } : {});
          demo.rows.push(r);
          return resolve({ id });
        }
        if (action === 'update') {
          const r = find(p.id);
          if (!r || (r.status && user.role === 'user')) throw new Error('This entry has already been reviewed and can no longer be edited.');
          r.updatedAt = Date.now();
          Object.assign(r, { type: p.type, plate: p.plate, driver: p.driver, km: toNum(p.km) || null, hour: toNum(p.hour) || null, litres: toNum(p.litres), note: p.note || '' });
          savePhotos(r, p);
          return resolve({ id: r.id });
        }
        if (action === 'mine') return resolve(demo.rows.filter(r => r.user === user.email).slice().reverse());
        if (action === 'all') {
          if (user.role === 'user') throw new Error('Only reviewers can see this list.');
          return resolve(demo.rows.slice().sort((a, b) => b.dateTime - a.dateTime));
        }
        if (action === 'review') {
          const r = find(p.id); r.status = p.status; r.reviewedBy = user.email; r.reviewedAt = Date.now();
          if (p.note) r.note = (r.note ? r.note + ' | ' : '') + 'Review: ' + p.note;
          return resolve({ id: r.id });
        }
        if (action === 'photo') return resolve({ dataUrl: demo.photos[p.url] || null });
        if (action === 'transcribe') return setTimeout(() => resolve({ text: 'ចាក់សាំងនៅស្ថានីយ៍ទួលគោក' }), 800);
        if (action === 'readPhoto') {
          const res = window.DEMO_READ ? window.DEMO_READ(p) : { value: p.kind === 'litres' ? 120 : p.kind === 'km' ? 474500 : null };
          res.token = 'demo' + Math.random(); demo.reads[res.token] = res;
          return setTimeout(() => resolve(res), 1200);
        }
        if (action === 'ads') return resolve({ version: String(demo.adsVer), ads: demo.ads.slice().sort((a, b) => b.createdAt - a.createdAt).map(a => Object.assign({}, a, { media: undefined })) });
        if (action === 'adMedia') { const a = demo.ads.find(x => x.id === p.id); return setTimeout(() => resolve({ key: a && a.key, dataUrl: a ? a.media : null }), 400); }
        if (action === 'adSave') {
          let a = demo.ads.find(x => x.id === p.id);
          if (!a) { a = { id: 'AD' + Date.now(), createdAt: Date.now(), createdBy: user.email, views: 0, skips: 0 }; demo.ads.push(a); }
          if (p.media) Object.assign(a, { media: p.media, key: 'k' + Date.now(), type: /^data:video/.test(p.media) ? 'video' : 'image', name: p.name });
          if (p.thumb) a.thumb = p.thumb;
          const day = v => v ? new Date(v + 'T00:00:00').getTime() : null;
          Object.assign(a, { text: p.text || '', seconds: p.seconds, start: day(p.start), end: p.end ? day(p.end) + 864e5 - 1 : null, show: p.show !== false, updatedAt: Date.now() });
          demo.adsVer++;
          return setTimeout(() => resolve({ id: a.id }), 600);
        }
        if (action === 'adDelete') { demo.ads = demo.ads.filter(x => x.id !== p.id); demo.adsVer++; return resolve({ id: p.id }); }
        if (action === 'adSeen') { const a = demo.ads.find(x => x.id === p.id); if (a) { a.views++; if (p.skipped) a.skips++; } return resolve({ counted: !!a }); }
        if (action === 'thumbs') return resolve({ thumbs: Object.fromEntries(p.urls.map(u => [u, demo.photos[u] || null])) });
        throw new Error('Unknown action');
      } catch (e) { reject(e); }
    }, 150));
  }

  // ---------------- Auth ----------------

  function decodeJwt(t) {
    try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch (e) { return null; }
  }
  function tokenValid(t) {
    const c = t && decodeJwt(t);
    return !!(c && c.exp * 1000 > Date.now() + 60000);
  }
  function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  function signOut(expired) {
    state.token = null;
    storeSet(TOKEN_KEY, null);
    if (!DEMO && window.google && google.accounts) google.accounts.id.disableAutoSelect();
    if (!expired) {
      local.clear(); photoCache.clear(); thumbs.map = new Map(); try { localStorage.removeItem(thumbs.KEY); } catch (e) { /* ignore */ }
      state.config = null; state.form = null; state.draft = null; state.editing = null; state.mine = null;
      demo.user = null; rv.rows = null; rv.fetchedAt = 0; nav.stack = []; nav.i = -1;
    }
    renderLogin(expired);
  }

  function loadGsi() {
    return new Promise((resolve, reject) => {
      if (window.google && google.accounts) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.onload = resolve; s.onerror = () => reject(new Error('Could not load Google Sign-In.'));
      document.head.appendChild(s);
    });
  }

  function renderLogin(expired) {
    redraw = () => renderLogin(expired);
    $('#tabs').hidden = true;
    $('#homeOnly').hidden = false;
    $('#navbar').hidden = true;
    $('#who').innerHTML = '';
    $('#view').innerHTML = `
      <div class="login">
        <div class="big">⛽</div>
        <h2>${L('កត់ត្រាការចាក់សាំង', 'Fuel refill record')}</h2>
        ${expired ? `<div class="alert warn">${L('សូមចូលម្តងទៀត។ ទិន្នន័យដែលបានបំពេញនៅរក្សាទុក។', 'Please sign in again. Your form is kept.')}</div>` : ''}
        ${DEMO ? `
          <p class="hint">Demo mode: choose who to sign in as.</p>
          <div class="row" style="margin-top:16px">
            <button class="btn" data-demo="user">🚚 ${L('អ្នកបើកបរ', 'Driver')}</button>
            <button class="btn" data-demo="reviewer">✅ ${L('អ្នកពិនិត្យ', 'Reviewer')}</button>
            <button class="btn" data-demo="admin">📣 Admin</button>
          </div>` : `
          <p class="hint">${L('ចូលដោយគណនី Google របស់អ្នក', 'Sign in with your Google account')}</p>
          <div id="gsiButton"><div class="spinner"></div></div>
          <div id="loginErr"></div>`}
      </div>`;
    if (DEMO) {
      $$('[data-demo]').forEach(b => b.onclick = () => {
        demo.user = b.dataset.demo === 'user'
          ? { email: 'driver.demo@gmail.com', name: 'Demo Driver', role: 'user' }
          : b.dataset.demo === 'admin' ? { email: 'admin.demo@gmail.com', name: 'Demo Admin', role: 'admin' }
          : { email: 'pheakdeykim@gmail.com', name: 'Demo Reviewer', role: 'reviewer' };
        start();
      });
      return;
    }
    if (!CFG.GOOGLE_CLIENT_ID) {
      $('#gsiButton').innerHTML = '<div class="alert bad">GOOGLE_CLIENT_ID is missing in config.js</div>';
      return;
    }
    loadGsi().then(() => {
      google.accounts.id.initialize({
        client_id: CFG.GOOGLE_CLIENT_ID,
        auto_select: true,
        callback: resp => {
          state.token = resp.credential;
          storeSet(TOKEN_KEY, resp.credential);
          start();
        },
      });
      $('#gsiButton').innerHTML = '';
      google.accounts.id.renderButton($('#gsiButton'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: L('km', 'en') });
      google.accounts.id.prompt();
    }).catch(e => { $('#gsiButton').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; });
  }

  async function start() {
    const cached = local.get('config');
    if (cached) {
      // Open straight away with the saved lists; refresh them quietly.
      state.config = cached;
      enterApp();
      api('config').then(c => {
        if (!state.config) return;
        state.config = c;
        local.set('config', c);
        showRole();
      }).catch(e => {
        if (e.code === 'NOACCESS') { local.clear(); state.config = null; start(); }
      });
      return;
    }
    $('#view').innerHTML = '<div class="spinner"></div>';
    try {
      state.config = await api('config');
    } catch (e) {
      if (!state.token && !DEMO) return;   // signOut already re-rendered the login
      redraw = () => start();
      $('#view').innerHTML = `<div class="login"><div class="big">🚫</div><div class="alert bad">${esc(e.code === 'NOACCESS' && window.AccessRequest ? AccessRequest.notAllowed(e.message) : e.message)}</div>
        <p><button class="btn" id="retry">${L('ព្យាយាមម្តងទៀត', 'Try again')}</button> <button class="btn" id="out">${L('ចាកចេញ', 'Sign out')}</button></p>
        ${e.code === 'NOACCESS' ? `<p id="reqBox"><button class="btn ok" id="req">📨 ${L('ស្នើសុំទៅអ្នកគ្រប់គ្រង', 'Request to Admin')}</button></p>` : ''}</div>`;
      $('#retry').onclick = start; $('#out').onclick = () => signOut(false);
      if ($('#req')) $('#req').onclick = requestAccess;
      return;
    }
    local.set('config', state.config);
    enterApp();
  }

  // Asks the admin to add this Google account: the server adds it to the Users sheet as not active yet and tells the Telegram group.
  function requestAccess() {
    AccessRequest.open({
      call: (action, payload) => api(action, payload),
      onDone: status => {
        $('#reqBox').innerHTML = status === 'active'
          ? `<div class="alert ok">${L('គណនីរបស់អ្នកបានអនុញ្ញាតហើយ។ ចុច ព្យាយាមម្តងទៀត។', 'Your account is already allowed. Tap Try again.')}</div>`
          : `<div class="alert ok">✅ ${L('សំណើបានផ្ញើទៅអ្នកគ្រប់គ្រង។ សូមរង់ចាំការអនុញ្ញាត រួចចុច ព្យាយាមម្តងទៀត។', 'Request sent to the admin. Once they allow you, tap Try again.')}</div>`;
      },
    });
  }

  function showRole() {
    const u = state.config.user;
    // No name or Sign out in the bar (Kim, 2026-10-11): signing out is done from the home menu.
    $('#who').innerHTML = '';
    $('#reviewTab').hidden = !(u.role === 'reviewer' || u.role === 'admin');
    $('#tabs').classList.toggle('many', $$('#tabs .tab:not([hidden])').length > 4);
    reviewBadge();
  }

  function enterApp() {
    redraw = null;
    showRole();
    $('#tabs').hidden = false;
    $('#homeOnly').hidden = true;
    $('#navbar').hidden = false;
    if (!state.form) resetForm();
    // Opened from a truck's QR sticker with the phone camera: start a new entry for that truck.
    const params = new URLSearchParams(location.search);
    const qrPlate = params.get('plate'), checkId = params.get('check');
    if (checkId) {
      // Opened from the "Check" button on a Telegram post: show that entry (openDetail checks who may see it).
      try { history.replaceState(history.state, '', location.pathname); } catch (e) { /* ignore */ }
      go({ s: 'detail', id: checkId });
    } else if (qrPlate) {
      try { history.replaceState(history.state, '', location.pathname); } catch (e) { /* ignore */ }
      if (state.editing) leaveEdit();
      useTruckCode(qrPlate);
      if (current() && current().s === 'new') paint(current()); else go({ s: 'new' });
    } else if (nav.i >= 0 && nav.stack[nav.i]) paint(nav.stack[nav.i]);
    else go({ s: 'new' });
    outbox.load().then(() => { outboxChanged(); flushOutbox(); });
  }

  // ---------------- Navigation (Back / Forward) ----------------
  // Every screen is a step in one history list, so the Back / Forward buttons and the
  // phone's own back gesture move through the same screens.
  // Screens: {s:'new'} {s:'mine'} {s:'review'} {s:'detail', id} {s:'edit', id, from} {s:'success', ref}

  const nav = { stack: [], i: -1, hist: false };
  try { nav.hist = window.top === window && !!(window.history && history.pushState); } catch (e) { nav.hist = false; }
  const TITLES = {
    new: ['បញ្ចូលថ្មី', 'New'], mine: ['របស់ខ្ញុំ', 'My entries'], review: ['អ្នកត្រួតពិនិត្យ', 'Reviewer'],
    detail: ['ព័ត៌មានលម្អិត', 'Detail'], edit: ['កែប្រែ', 'Edit'], success: ['បានបញ្ជូន', 'Saved'],
  };

  function go(screen, replace) {
    const first = nav.i < 0;
    if (replace && !first) nav.stack[nav.i] = screen;
    else { nav.stack = nav.stack.slice(0, nav.i + 1); nav.stack.push(screen); nav.i++; }
    if (nav.hist) {
      try { history[replace || first ? 'replaceState' : 'pushState']({ fr: nav.i }, ''); } catch (e) { nav.hist = false; }
    }
    paint(screen);
  }
  function back() {
    if (nav.i <= 0) return;
    if (nav.hist) history.back();
    else { nav.i--; paint(nav.stack[nav.i]); }
  }
  function forward() {
    if (nav.i >= nav.stack.length - 1) return;
    if (nav.hist) history.forward();
    else { nav.i++; paint(nav.stack[nav.i]); }
  }
  window.addEventListener('popstate', e => {
    const i = e.state && e.state.fr;
    if (typeof i !== 'number' || !nav.stack[i] || !state.config) return;
    nav.i = i;
    paint(nav.stack[i]);
  });
  $('#navBack').onclick = back;
  $('#navFwd').onclick = forward;

  const current = () => nav.stack[nav.i];

  /** Red count on the Reviewer tab: entries not reviewed yet (from the list when loaded, else from the server). */
  function reviewBadge() {
    const tab = $('#reviewTab');
    if (!tab || tab.hidden || !state.config) return;
    const n = rv.rows ? rv.rows.filter(r => !r.status).length : (state.config.pendingCount || 0);
    let b = $('.tab-badge', tab);
    if (!b) { tab.insertAdjacentHTML('beforeend', '<i class="tab-badge"></i>'); b = $('.tab-badge', tab); }
    b.textContent = n > 99 ? '99+' : String(n);
    b.hidden = !n;
  }

  /** Draws a screen without changing the history. */
  function paint(screen) {
    if (screen.s !== 'edit' && state.editing) leaveEdit();
    const tab = screen.s === 'detail' ? 'review'
      : screen.s === 'edit' ? (screen.from || 'mine')
      : screen.s === 'success' ? 'new' : screen.s;
    state.tab = tab;
    $$('.tab[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    $('#navBack').disabled = nav.i <= 0;
    $('#navFwd').disabled = nav.i >= nav.stack.length - 1;
    $('#navTitle').textContent = TITLES[screen.s] ? L(...TITLES[screen.s]) : '';
    reviewBadge();
    window.scrollTo(0, 0);
    if (screen.s === 'new') renderForm();
    else if (screen.s === 'mine') renderMine();
    else if (screen.s === 'review') renderReview();
    else if (screen.s === 'detail') openDetail(screen.id);
    else if (screen.s === 'edit') openEdit(screen);
    else if (screen.s === 'success') renderSuccess(screen.ref);
  }

  function show(tab) {
    const c = current();
    if (c && c.s === tab) paint(c);
    else go({ s: tab });
  }
  $$('.tab[data-tab]').forEach(b => b.onclick = () => show(b.dataset.tab));

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ---------------- Form ----------------

  function resetForm() {
    state.editing = null;
    state.form = { type: '', plate: '', driver: '', km: '', hour: '', litres: '', note: '',
      odoPhoto: null, hourPhoto: null, pumpPhoto: null, signature: null };
    applyRemembered(state.form);
    startGps();
  }

  // ---------------- Remembered truck and driver (per phone) ----------------
  // The last truck and driver used on this phone fill the next form, with a green "remembered" tag.
  const lastKey = () => 'fr_last_' + (who() || 'demo');
  function remember(f) {
    storeSet(lastKey(), JSON.stringify({ type: f.type, plate: f.plate, driver: f.driver }));
  }
  function applyRemembered(f) {
    const cfg = state.config;
    let last = null;
    try { last = JSON.parse(storeGet(lastKey()) || 'null'); } catch (e) { /* ignore */ }
    if (!cfg || !last || !typeInfo(last.type)) return;
    const t = typeInfo(last.type);
    const plates = t.meter === 'km' ? cfg.plates : ((cfg.equipment || {})[t.name] || null);
    f.type = last.type;
    if (last.plate && (!plates || plates.includes(last.plate))) { f.plate = last.plate; f.remembered = { plate: true }; }
    if (last.driver && cfg.drivers.some(d => d.name === last.driver)) { f.driver = last.driver; f.remembered = Object.assign({}, f.remembered, { driver: true }); }
    if (t.meter === 'km' && f.plate && plateBroken(f.plate)) { f.meterBroken = true; f.autoBroken = true; }
  }

  /** Puts a truck on the form with its odometer-broken tick. The driver is left empty for the driver to pick (Kim, 19 Oct 2026). */
  function pickPlate(v, isNew) {
    const f = state.form;
    f.plate = v;
    f.newPlate = !!isNew;
    if (f.remembered) f.remembered.plate = false;
    f.driver = ''; f.newDriver = false;
    if (f.remembered) f.remembered.driver = false;
    // Trucks marked "Odometer Broken? = Yes" in Driver & Truck get Meter broken ticked for them.
    if (plateBroken(v)) { f.meterBroken = true; f.km = ''; f.autoBroken = true; }
    else if (f.autoBroken) { f.meterBroken = false; f.autoBroken = false; }
  }

  // ---------------- Truck QR code ----------------
  // Each truck has a sticker with a link like https://…/fuel/?plate=3F-5849. Scanning it in the app, or
  // opening the link with the phone camera, fills the truck.
  function plateFromCode(text) {
    const s = String(text || '').trim();
    let p = '';
    try { p = new URL(s).searchParams.get('plate') || ''; } catch (e) { p = s; }
    p = p.toUpperCase().replace(/\s+/g, '');
    return (state.config.plates || []).find(x => x.toUpperCase() === p) || '';
  }
  function useTruckCode(text) {
    const plate = plateFromCode(text);
    if (!plate) { toast(L('QR នេះមិនមែនជាឡានក្នុងបញ្ជីទេ', 'This QR code is not a truck in the list')); return false; }
    if (state.editing) return false;
    const truckType = (state.config.types || []).find(t => t.meter === 'km');
    if (truckType && typeInfo(state.form.type) !== truckType) { state.form.type = truckType.name; }
    pickPlate(plate, false);
    toast('🚚 ' + plate);
    return true;
  }
  let qrLib = null;
  function loadQrLib() {
    return qrLib || (qrLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../vendor/jsQR.min.js'; s.onload = () => resolve(window.jsQR); s.onerror = () => { qrLib = null; reject(new Error('QR reader did not load')); };
      document.head.appendChild(s);
    }));
  }
  async function scanTruck() {
    let stream = null, stopped = false, timer = 0;
    const stop = () => { stopped = true; clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); };
    const sh = openSheet(L('ស្កេន QR លើឡាន', 'Scan the truck QR'), `
      <div class="qr-view"><video playsinline muted></video><div class="qr-frame"></div></div>
      <p class="hint center" id="qrMsg">${L('ដាក់ QR ក្នុងប្រអប់', 'Hold the QR code inside the square')}</p>
      <label class="sheet-btn"><input type="file" accept="image/*" capture="environment"><span class="ic">📷</span><span>${L('ថតរូប QR ជំនួសវិញ', 'Take a photo of the QR instead')}</span></label>`, 'qr-sheet', stop);
    const video = $('video', sh.el), msg = $('#qrMsg', sh.el);
    const done = text => {
      if (stopped) return;
      if (useTruckCode(text)) { sh.close(); renderForm(); }
    };
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const decodeFrom = async src => {
      const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
      if (!w || !h) return '';
      if ('BarcodeDetector' in window) {
        try { const r = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(src); if (r[0]) return r[0].rawValue; } catch (e) { /* fall back to jsQR */ }
      }
      const jsQR = await loadQrLib();
      const scale = Math.min(1, 720 / Math.max(w, h));
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      return code ? code.data : '';
    };
    $('input[type=file]', sh.el).onchange = async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const img = new Image();
      img.onload = async () => { const text = await decodeFrom(img).catch(() => ''); URL.revokeObjectURL(img.src); if (text) done(text); else msg.textContent = L('រកមិនឃើញ QR ក្នុងរូប', 'No QR code found in the photo'); };
      img.src = URL.createObjectURL(file);
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (stopped) { stop(); return; }
      video.srcObject = stream; await video.play();
      const tick = async () => {
        if (stopped) return;
        const text = await decodeFrom(video).catch(() => '');
        if (text) done(text); else timer = setTimeout(tick, 180);
      };
      tick();
    } catch (e) {
      msg.textContent = L('មិនអាចបើកកាមេរ៉ា។ សូមថតរូប QR ខាងក្រោម។', 'Camera not available. Take a photo of the QR below.');
      $('.qr-view', sh.el).hidden = true;
    }
  }

  const plateBroken = plate => (state.config.brokenPlates || []).includes(plate);

  function typeInfo(name) {
    return (state.config.types || []).find(t => t.name === name) || null;
  }

  /** Last km / hour reading for a plate, counting entries still sending or sent a moment ago. */
  function lastFor(plate) {
    let o = (state.config.lastReadings || {})[plate] || null;
    const recent = outbox.mine().filter(i => !i.error).map(i => ({ p: i.payload, at: i.takenAt })).concat(outbox.recent);
    recent.forEach(({ p, at }) => {
      if (p.plate !== plate) return;
      const km = toNum(p.km), hour = toNum(p.hour);
      if (km > 1 && (!o || at > (o.kmAt || 0))) o = Object.assign({}, o, { km, kmAt: at });
      if (hour > 1 && (!o || at > (o.hourAt || 0))) o = Object.assign({}, o, { hour, hourAt: at });
    });
    return o;
  }

  /** How a new driver will be saved: the next number after the highest one in the list, e.g. "39.មាស តារា". */
  function newDriverLabel(name) {
    let max = 0;
    (state.config.drivers || []).forEach(d => {
      const m = String(d.name).match(/^\s*([0-9០-៩]+)\s*\./);
      if (m) max = Math.max(max, toNum(m[1]) || 0);
    });
    const no = max + 1;
    return (no < 10 ? '0' : '') + no + '.' + name;
  }

  /** Returns {errors:[], warnings:[], needNote:bool} for the current form. */
  function check() {
    const f = state.form, t = typeInfo(f.type), errors = [], warnings = [];
    const editing = !!state.editing;
    if (!t) { errors.push(L('ចាក់សាំងសម្រាប់', 'Refill type')); return { errors, warnings, needNote: false }; }
    if (!f.plate.trim()) errors.push(t.meter === 'km' ? L('ផ្លាកលេខ', 'Plate') : L('គ្រឿងចក្រ', 'Equipment'));
    if (!f.driver) errors.push(L('ឈ្មោះតៃកុង', 'Driver'));
    const last = lastFor(f.plate);
    if (t.meter === 'km') {
      if (t.required && !f.meterBroken && !f.odoPhoto && !(editing && state.editing.odoPhoto)) errors.push(L('រូបថតកុងទ័រឡាន', 'Odometer photo'));
      const km = f.meterBroken ? 0 : toNum(f.km);
      if (t.required && !f.meterBroken && !(km > 0)) errors.push(L('លេខកុងទ័រ (Km) ឬ ធីក កុងទ័រខូច', 'Odometer, or tick Meter broken'));
      // 0, 1, 100… are typed when the meter can't be read: the tick box is the right answer. New trucks (last reading under 1,000) are fine.
      else if (km > 0 && km < MIN_KM && !(last && last.km && last.km < MIN_KM)) errors.push(L(`Km ${fmtNum(km)} មិនត្រឹមត្រូវ (តិចជាង ${fmtNum(MIN_KM)}) បើកុងទ័រខូច សូមធីក កុងទ័រខូច`, `Km ${fmtNum(km)} looks wrong (under ${fmtNum(MIN_KM)}). If the meter is broken, tick Meter broken`));
      else if (!editing && km > 0 && last && last.km && km <= last.km) warnings.push(L(`Km (${fmtNum(km)}) មិនលើសលើកមុន (${fmtNum(last.km)})`, `Km (${fmtNum(km)}) is not higher than the last reading (${fmtNum(last.km)})`));
      else if (!editing && km > 0 && last && last.km && km - last.km > MAX_JUMP_KM) warnings.push(L(`Km លើសលើកមុន ${fmtNum(km - last.km)} km (លើកមុន ${fmtNum(last.km)})`, `Km is ${fmtNum(km - last.km)} km more than the last reading (${fmtNum(last.km)}), over ${fmtNum(MAX_JUMP_KM)} km`));
    }
    if (t.meter === 'hour') {
      if (t.required && !f.hourPhoto && !(editing && state.editing.hourPhoto)) errors.push(L('រូបថតកុងទ័រម៉ោង', 'Hour meter photo'));
      const h = toNum(f.hour);
      if (t.required && !(h > 0)) errors.push(L('កុងទ័រម៉ោង', 'Hour meter'));
      else if (!editing && h > 0 && last && last.hour && h <= last.hour) warnings.push(L(`ម៉ោង (${fmtNum(h)}) មិនលើសលើកមុន (${fmtNum(last.hour)})`, `Hours (${fmtNum(h)}) not higher than the last reading (${fmtNum(last.hour)})`));
    }
    if (!editing && !f.pumpPhoto) errors.push(L('រូបថតកុងទ័រសាំង', 'Fuel pump photo'));
    const l = toNum(f.litres);
    if (!(l > 0)) errors.push(L('ចំនួនចាក់ (លីត្រ)', 'Litres'));
    else if (l > state.config.litreLimit) warnings.push(L(`${fmtNum(l)} L លើស ${state.config.litreLimit} L`, `${fmtNum(l)} L is above the ${state.config.litreLimit} L limit`));
    if (!editing && state.gps.status !== 'ok') errors.push(L('ទីតាំង GPS', 'GPS location'));
    ['odoPhoto', 'hourPhoto', 'pumpPhoto'].forEach(k => {
      const m = readState(f, k, t);
      if (m.state === 'wrong') warnings.push(L(`រូបថតខុស: មិនមែនជារូប${PC_NAME[k][0]}ទេ`, `Wrong photo: this is not the ${PC_NAME[k][1]}`));
      if (m.state === 'bad') warnings.push(L(`លេខ ${m.typedTxt} មិនត្រូវនឹងរូបថត (រូបថតបង្ហាញ ${m.readTxt})`, `${m.typedTxt} does not match the photo (photo shows ${m.readTxt})`));
    });
    const needNote = warnings.length > 0;
    if (needNote && !f.note.trim()) errors.push(L('សំគាល់ (ត្រូវការ)', 'Note required for the warning'));
    return { errors, warnings, needNote };
  }

  function renderForm() {
    const f = state.form, cfg = state.config, t = typeInfo(f.type), editing = state.editing;
    const last = lastFor(f.plate);
    const equip = t ? ((cfg.equipment || {})[t.name] || null) : null;
    const req = t && t.required ? ' <span class="req">*</span>' : '';
    const pickBtn = (id, value, isNew) => `
      <button type="button" class="picker" id="${id}">
        <span class="${value ? '' : 'ph'}">${esc(value || L('— ជ្រើសរើស —', '— Select —'))}${isNew ? ` <small class="new-tag">${L('ថ្មី', 'New')}</small>` : value && f.remembered && f.remembered[id] ? ` <small class="new-tag kept">${L('ចងចាំពីលើកមុន', 'Remembered')}</small>` : ''}</span><span class="pk-ic" aria-hidden="true">🔍</span>
      </button>`;

    const photoSlot = (key, km, en, required, existing) => { const title = L(km, en); return `
      <button type="button" class="photo-slot ${f[key] || existing ? 'has' : ''}" data-photo="${key}" data-title="${esc(title)}">
        <div class="thumb" style="${f[key] ? `background-image:url('${f[key]}')` : ''}">${f[key] ? '' : (existing ? '✔️' : '📷')}</div>
        <div class="ps-text"><div class="txt">${title} ${required ? '<span class="req">*</span>' : ''}</div>
          ${f[key] || existing ? `<small>${L('មានរូបរួច ចុចដើម្បីប្តូរ', f[key] ? 'Tap to change' : 'Saved. Tap to replace')}</small>` : ''}</div>
        <span class="ps-add" aria-hidden="true">${f[key] || existing ? '↻' : '+'}</span>
      </button>`; };

    $('#view').innerHTML = `
      <h2>${editing ? `${L('កែប្រែ', 'Edit')} ${esc(editing.id)}` : L('ការចាក់សាំងថ្មី', 'New fuel refill')}</h2>
      ${editing ? '' : '<div id="outboxNote"></div>'}
      ${editing || !(cfg.types || []).some(x => x.meter === 'km') ? '' : `<button type="button" class="qr-btn" id="qrScan"><span class="qr-ic" aria-hidden="true">📷</span><span><b>${L('ស្កេន QR លើឡាន', 'Scan the truck QR')}</b><small>${L('ផ្លាកលេខ និងតៃកុង បំពេញដោយស្វ័យប្រវត្តិ', 'Fills the plate and driver for you')}</small></span></button>`}

      <div class="card">
        <div class="field">
          <div class="label"><span>${L('ចាក់សាំងសម្រាប់', 'Refill for')} <span class="req">*</span></span></div>
          <div class="types">
            ${cfg.types.map(x => `<button type="button" class="type-btn ${x.name === f.type ? 'on' : ''}" data-type="${esc(x.name)}">
              <span class="emo">${esc(emojiOf(x.name))}</span><span>${esc(textOf(x.name))}</span></button>`).join('')}
          </div>
        </div>
      </div>

      ${t ? `
      <div class="card">
        <div class="field">
          ${t.meter === 'km' ? `
            <div class="label"><span>${L('ផ្លាកលេខឡាន', 'Plate number')} <span class="req">*</span></span></div>
            ${pickBtn('plate', f.plate, f.newPlate)}` : equip ? `
            <div class="label"><span>${L('គ្រឿងចក្រ', 'Equipment')} <span class="req">*</span></span></div>
            ${pickBtn('plate', f.plate)}` : `
            <div class="label"><span>${L('គ្រឿងចក្រ / សម្រាប់អ្វី', 'Equipment / purpose')} <span class="req">*</span></span></div>
            <input type="text" id="plate" value="${esc(f.plate)}" placeholder="${L('ឧ. អេឡេវ៉ាទ័រ T50', 'e.g. forklift T50')}" autocomplete="off">`}
        </div>
        <div class="field">
          <div class="label"><span>${L('ឈ្មោះតៃកុង', 'Driver / operator')} <span class="req">*</span></span></div>
          ${pickBtn('driver', f.newDriver ? newDriverLabel(f.driver) : f.driver, f.newDriver)}
        </div>
      </div>

      ${t.meter === 'km' ? `
      <div class="card">
        <div class="field">${photoSlot('odoPhoto', 'រូបថតកុងទ័រឡាន', 'Odometer photo', t.required && !f.meterBroken, editing && editing.odoPhoto)}</div>
        <div class="field">
          <div class="label"><span>${L('លេខកុងទ័រ (Km)', 'Odometer (Km)')}${f.meterBroken ? '' : req}</span></div>
          <div class="km-row">
            <input type="text" inputmode="decimal" id="km" class="big-input" value="${f.meterBroken ? '' : esc(f.km)}" placeholder="${f.meterBroken ? '—' : '0'}" autocomplete="off" ${f.meterBroken ? 'disabled' : ''}>
            <label class="broken ${toNum(f.km) > 0 && !f.meterBroken ? 'off' : ''}"><span>${L('កុងទ័រខូច', 'Meter broken')}</span>
              <input type="checkbox" id="meterBroken" ${f.meterBroken ? 'checked' : ''} ${toNum(f.km) > 0 && !f.meterBroken ? 'disabled' : ''}></label>
          </div>
          <div class="pc-hint" data-pc="odoPhoto"></div>
          ${plateBroken(f.plate) ? `<div class="hint">🔧 ${L('ឡាននេះកុងទ័រខូច (Driver &amp; Truck)', 'This truck\'s odometer is marked broken (Driver &amp; Truck)')}</div>` : ''}
          ${last && last.km ? `<div class="hint">${L('លើកមុន', 'Last')}: <b>${fmtNum(last.km)} km</b> · ${fmtDate(last.kmAt)}</div>` : ''}
        </div>
      </div>` : ''}

      ${t.meter === 'hour' ? `
      <div class="card">
        <div class="field">${photoSlot('hourPhoto', 'រូបថតកុងទ័រម៉ោង', 'Hour meter photo', t.required, editing && editing.hourPhoto)}</div>
        <div class="field">
          <div class="label"><span>${L('កុងទ័រម៉ោង', 'Hour meter')}${req}</span></div>
          <input type="text" inputmode="decimal" id="hour" class="big-input" value="${esc(f.hour)}" placeholder="0" autocomplete="off">
          <div class="pc-hint" data-pc="hourPhoto"></div>
          ${last && last.hour ? `<div class="hint">${L('លើកមុន', 'Last')}: <b>${fmtNum(last.hour)} h</b> · ${fmtDate(last.hourAt)}</div>` : ''}
        </div>
      </div>` : ''}

      <div class="card">
        <div class="field">${photoSlot('pumpPhoto', 'រូបថតកុងទ័រសាំង', 'Fuel pump photo', !editing, editing && editing.pumpPhoto)}</div>
        <div class="field">
          <div class="label"><span>${L('ចំនួនចាក់ (លីត្រ)', 'Litres')} <span class="req">*</span></span></div>
          <input type="text" inputmode="decimal" id="litres" class="big-input" value="${esc(f.litres)}" placeholder="0" autocomplete="off">
          <div class="pc-hint" data-pc="pumpPhoto"></div>
        </div>
      </div>

      <div class="card">
        <div class="field">
          <div class="label"><span>${L('សំគាល់', 'Note')} <span class="req" id="noteReq" hidden>*</span></span>${voiceOK() ? `<button type="button" class="mic-btn" id="mic"></button>` : ''}</div>
          <textarea id="note" placeholder="${L('ឧ. ទៅកំពង់សោម', 'e.g. trip to Sihanoukville')}">${esc(f.note)}</textarea>
          <div id="warnBox"></div>
        </div>
        ${editing ? '' : `<div class="field"><div class="gps" id="gps"></div></div>`}
      </div>` : ''}

      <div id="errBox"></div>
      ${t ? `<button class="btn primary" id="submit">${editing ? '💾 ' + L('រក្សាទុក', 'Save changes') : '✔️ ' + L('បញ្ជូន', 'Submit')}</button>` : ''}
      ${editing ? `<p class="center"><button class="btn" id="cancelEdit">${L('បោះបង់', 'Cancel')}</button></p>` : ''}
    `;
    drawOutboxNote();
    if ($('#qrScan')) $('#qrScan').onclick = scanTruck;

    // type tiles
    $$('.type-btn').forEach(b => b.onclick = () => {
      if (f.type === b.dataset.type) return;
      const next = typeInfo(b.dataset.type);
      const wasDefault = !f.plate || (t && f.plate === t.defaultEquipment);
      const hasList = x => x && (x.meter === 'km' || (cfg.equipment || {})[x.name]);
      if (hasList(next) || hasList(t)) { f.plate = ''; f.newPlate = false; }
      if (next.defaultEquipment && (wasDefault || !f.plate)) f.plate = next.defaultEquipment;
      else if (t && t.defaultEquipment && f.plate === t.defaultEquipment) f.plate = '';
      f.type = b.dataset.type;
      f.remembered = null;
      renderForm();
    });
    if (!t) return;

    const plate = $('#plate');
    if (plate.tagName === 'BUTTON') {
      const list = t.meter === 'km' ? cfg.plates : equip;
      const items = list.map(x => {
        const who = t.meter === 'km' ? cfg.drivers.filter(d => d.plate === x).map(d => d.name) : [];
        return { value: x, sub: who.join(', ') };
      });
      if (f.plate && !list.includes(f.plate)) items.unshift({ value: f.plate, sub: f.newPlate ? L('ថ្មី', 'New') : '' });
      plate.onclick = () => openPicker({
        title: t.meter === 'km' ? L('ផ្លាកលេខឡាន', 'Plate number') : L('គ្រឿងចក្រ', 'Equipment'),
        groups: [{ items }], value: f.plate,
        // Trucks not in the list yet can be added; equipment stays limited to the Equipment sheet.
        addNew: t.meter === 'km' ? {
          button: '➕ ' + L('បន្ថែមឡានថ្មី', 'Add new truck'),
          placeholder: L('ផ្លាកលេខ ឧ. 3F-1234', 'Plate e.g. 3F-1234'),
          saved: v => v,
          clean: q => {
            const v = q.toUpperCase().trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
            const m = v.match(/^(\d[A-Z]{1,2})-?(\d{4})$/);
            return m ? m[1] + '-' + m[2] : v;
          },
          label: v => `➕ ${L('បន្ថែមឡានថ្មី', 'Add new truck')}: ${v}`,
        } : null,
        onPick: (v, isNew) => { pickPlate(v, isNew); renderForm(); },
      });
    } else {
      plate.oninput = () => { f.plate = plate.value; };
    }
    $('#driver').onclick = () => {
      // One row per driver name; drivers linked to the chosen plate (CODE) are listed first.
      const byName = new Map();
      cfg.drivers.forEach(d => {
        const it = byName.get(d.name) || { value: d.name, plates: [] };
        if (d.plate && !it.plates.includes(d.plate)) it.plates.push(d.plate);
        byName.set(d.name, it);
      });
      const all = Array.from(byName.values()).map(it => ({ value: it.value, sub: it.plates.join(', '), mine: !!f.plate && it.plates.includes(f.plate) }));
      if (f.driver && !byName.has(f.driver)) all.unshift({ value: f.driver, sub: '' });
      const linked = all.filter(x => x.mine);
      openPicker({
        title: L('ឈ្មោះតៃកុង', 'Driver'),
        groups: linked.length
          ? [{ label: L(`ឡាន ${f.plate}`, `Truck ${f.plate}`), items: linked }, { label: L('ទាំងអស់', 'All drivers'), items: all.filter(x => !x.mine) }]
          : [{ items: all }],
        value: f.driver,
        addNew: {
          button: '➕ ' + L('បន្ថែមតៃកុងថ្មី', 'Add new driver'),
          placeholder: L('ឈ្មោះ ឧ. មាស តារា', 'Name e.g. មាស តារា'),
          saved: v => newDriverLabel(v),
          clean: q => q.replace(/^\s*[0-9០-៩]+\s*[.)\-]?\s*/, '').replace(/\s+/g, ' ').trim(),
          label: v => `➕ ${L('បន្ថែមតៃកុងថ្មី', 'Add new driver')}: ${newDriverLabel(v)}`,
        },
        onPick: (v, isNew) => { f.driver = v; f.newDriver = !!isNew; if (f.remembered) f.remembered.driver = false; renderForm(); },
      });
    };
    ['km', 'hour', 'litres'].forEach(k => {
      const el = $('#' + k);
      if (el) el.oninput = () => { f[k] = el.value; updateWarnings(); };
    });
    paintReads();
    // Meter broken and a km number exclude each other: ticking clears and locks Km, typing a number locks the tick box.
    const broken = $('#meterBroken');
    if (broken) {
      const kmEl = $('#km');
      const sync = () => {
        const hasKm = toNum(kmEl.value) > 0;
        broken.disabled = hasKm && !f.meterBroken;
        broken.closest('.broken').classList.toggle('off', broken.disabled);
      };
      kmEl.addEventListener('input', sync);
      broken.onchange = () => { f.meterBroken = broken.checked; if (f.meterBroken) f.km = ''; renderForm(); };
    }
    $('#note').oninput = e => { f.note = e.target.value; };
    if ($('#mic')) { $('#mic').onclick = () => toggleVoice(f); paintMic(); }

    $$('[data-photo]').forEach(slot => slot.onclick = () => photoSheet(slot.dataset.photo, slot.dataset.title));

    if (!editing) renderGps();
    updateWarnings();

    $('#submit').onclick = submit;
    if (editing) $('#cancelEdit').onclick = back;
  }

  /** Opens a bottom sheet. Tapping outside, ✕ or Esc closes it. */
  function openSheet(title, body, cls, onClose) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `
      <div class="sheet ${cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-grip"></div>
        <div class="sheet-top"><div class="sheet-h">${esc(title)}</div><button type="button" class="icon-btn" data-close aria-label="${L('បិទ', 'Close')}">✕</button></div>
        ${body}
      </div>`;
    const onKey = e => { if (e.key === 'Escape') close(); };
    const close = () => {
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
      bg.classList.remove('open');
      setTimeout(() => bg.remove(), 200);
    };
    bg.onclick = e => { if (e.target === bg || e.target.closest('[data-close]')) close(); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    requestAnimationFrame(() => bg.classList.add('open'));
    return { el: bg, close };
  }

  /** Searchable list. groups: [{label?, items: [{value, sub?}]}]. Search matches the name and the small text. */
  function openPicker(opts) {
    const sh = openSheet(opts.title, `
      <label class="search"><span aria-hidden="true">🔍</span><input type="search" placeholder="${L('ស្វែងរក', 'Search')}" autocomplete="off" enterkeyhint="search"></label>
      ${opts.addNew ? `<div class="add-box"><button type="button" class="btn ok small add-open">${esc(opts.addNew.button)}</button></div>` : ''}
      <div class="pick-list"></div>`, 'picker-sheet');
    const input = $('input', sh.el), list = $('.pick-list', sh.el);
    // "Add new" opens a small form inside the list: type the name, see how it will be saved, tap Add.
    const addOpen = $('.add-open', sh.el);
    if (addOpen) addOpen.onclick = () => {
      const box = $('.add-box', sh.el);
      box.innerHTML = `<input type="text" class="add-input" placeholder="${esc(opts.addNew.placeholder)}" autocomplete="off" enterkeyhint="done">
        <div class="add-preview"></div>
        <div class="add-actions"><button type="button" class="btn small add-cancel">${L('បោះបង់', 'Cancel')}</button><button type="button" class="btn ok small add-save" disabled>➕ ${L('បន្ថែម', 'Add')}</button></div>`;
      const ai = $('.add-input', box), save = $('.add-save', box), pv = $('.add-preview', box);
      const upd = () => {
        const v = opts.addNew.clean(ai.value);
        const same = v && opts.groups.some(g => g.items.find(it => norm(it.value) === norm(v) || norm(it.value).replace(/^[0-9]+/, '') === norm(v)));
        save.disabled = !v || same;
        pv.innerHTML = !v ? '' : same ? `<span class="bad-t">${L('មានក្នុងបញ្ជីរួចហើយ ស្វែងរកខាងលើ', 'Already in the list, search above')}</span>`
          : `${L('រក្សាទុកជា', 'Saved as')}: <b>${esc(opts.addNew.saved(v))}</b>`;
      };
      ai.value = input.value; ai.oninput = upd; upd(); ai.focus();
      ai.onkeydown = e => { if (e.key === 'Enter' && !save.disabled) save.click(); };
      save.onclick = () => { const v = opts.addNew.clean(ai.value); sh.close(); opts.onPick(v, true); };
      $('.add-cancel', box).onclick = () => { box.innerHTML = ''; box.appendChild(addOpen); };
    };
    const norm = v => String(v || '').toLowerCase().replace(/[\s\-.]/g, '').replace(/[០-៩]/g, d => KH.indexOf(d));
    const draw = () => {
      const q = norm(input.value);
      const html = opts.groups.map(g => {
        const items = g.items.filter(it => !q || norm(it.value).includes(q) || norm(it.sub).includes(q));
        if (!items.length) return '';
        return (g.label ? `<div class="pick-group">${esc(g.label)}</div>` : '') + items.map(it => `
          <button type="button" class="pick-item ${it.value === opts.value ? 'on' : ''}" data-v="${esc(it.value)}">
            <span><b>${esc(it.value)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.value === opts.value ? '<span class="tick">✓</span>' : ''}
          </button>`).join('');
      }).join('');
      // Typed text that matches nothing exactly can be added as a new name.
      const add = opts.addNew && opts.addNew.clean(input.value);
      const exists = add && opts.groups.some(g => g.items.some(it => norm(it.value) === norm(add) || norm(it.value).replace(/^[0-9]+/, '') === norm(add)));
      const addRow = add && !exists
        ? `<button type="button" class="pick-item pick-add" data-add="${esc(add)}"><span><b>${esc(opts.addNew.label(add))}</b></span></button>` : '';
      list.innerHTML = (html || addRow ? html + addRow : '')
        || `<div class="empty">${L('រកមិនឃើញ', 'No match')}${opts.addNew ? `<br><small>${L('វាយឈ្មោះ ដើម្បីបន្ថែមថ្មី', 'Type a name to add a new one')}</small>` : ''}</div>`;
    };
    input.oninput = draw;
    list.onclick = e => {
      const a = e.target.closest('[data-add]');
      if (a) { sh.close(); opts.onPick(a.dataset.add, true); return; }
      const b = e.target.closest('[data-v]');
      if (!b) return;
      sh.close();
      opts.onPick(b.dataset.v, false);
    };
    draw();
    const on = $('.pick-item.on', list);
    if (on) on.scrollIntoView({ block: 'center' });
  }

  /** Bottom sheet: take a new photo with the camera, or pick one from the gallery. */
  function photoSheet(key, title) {
    const f = state.form;
    const sh = openSheet(title, `
      <label class="sheet-btn"><input type="file" accept="image/*" capture="environment"><span class="ic">📷</span><span>${L('ថតរូប', 'Take photo')}</span></label>
      <label class="sheet-btn"><input type="file" accept="image/*"><span class="ic">🖼️</span><span>${L('ជ្រើសរើសពីរូបភាព', 'Choose from gallery')}</span></label>
      ${f[key] ? `<button type="button" class="sheet-btn danger" data-remove><span class="ic">🗑</span><span>${L('ដករូបចេញ', 'Remove photo')}</span></button>` : ''}`);
    const stillHere = () => state.form === f && current() && (current().s === 'new' || current().s === 'edit');
    const rm = $('[data-remove]', sh.el);
    if (rm) rm.onclick = () => { f[key] = null; if (f.stamped) delete f.stamped[key]; if (f.reads) delete f.reads[key]; sh.close(); if (stillHere()) renderForm(); };
    $$('input[type=file]', sh.el).forEach(input => input.onchange = async () => {
      const file = input.files && input.files[0];
      sh.close();
      if (!file) return;
      try {
        f[key] = await resizeImage(file, 1280, 0.72);
        if (f.stamped) delete f.stamped[key];
        if (stillHere()) renderForm();
        readPhoto(f, key);
      } catch (e) { toast(L('រូបថតមិនត្រឹមត្រូវ', 'Could not read photo')); }
    });
  }

  function updateWarnings() {
    const box = $('#warnBox');
    if (!box) return;
    const { warnings } = check();
    box.innerHTML = warnings.length ? `<div class="alert warn">⚠️ ${L('សូមសរសេរសំគាល់', 'Please add a note')}:<ul>${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '';
    $('#noteReq').hidden = !warnings.length;
    paintReads();
  }

  // ---------------- Voice note (Kim, 19 Oct 2026) ----------------
  // 🎤 next to Note: tap to talk, tap again to stop (stops by itself after a minute). Google's AI writes what was
  // said into the Note box in Khmer, added after anything already typed. The recording itself is not kept.
  const voice = { rec: null, chunks: [], t0: 0, timer: 0, busy: false };
  const voiceOK = () => !!(window.MediaRecorder && navigator.mediaDevices && (DEMO || (state.config && state.config.photoCheck)));
  const blobToDataUrl = blob => new Promise((resolve, reject) => {
    const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob);
  });

  async function toggleVoice(f) {
    if (voice.busy) return;
    if (voice.rec) { voice.rec.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast(L('សូមអនុញ្ញាតឲ្យប្រើមីក្រូហ្វូន', 'Please allow the microphone')); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : {});
    Object.assign(voice, { rec, chunks: [], t0: Date.now() });
    rec.ondataavailable = e => { if (e.data && e.data.size) voice.chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(voice.timer);
      voice.rec = null;
      const blob = new Blob(voice.chunks, { type: rec.mimeType || mime || 'audio/webm' });
      if (Date.now() - voice.t0 < 700 || !blob.size) { paintMic(); return; }   // a tap by mistake
      voice.busy = true; paintMic();
      try {
        const audio = await blobToDataUrl(blob);
        const res = await (DEMO ? demoApi('transcribe', { audio }) : callServer('transcribe', { audio }));
        if (!res.text) toast(L('មិនឮសំឡេង សូមនិយាយម្តងទៀត', 'No speech heard. Please try again'));
        else if (state.form === f) {
          f.note = (f.note.trim() ? f.note.trim() + ' ' : '') + res.text;
          const el = $('#note'); if (el) el.value = f.note;
          updateWarnings();
        }
      } catch (e) { toast(e.message); }
      voice.busy = false; paintMic();
    };
    rec.start(1000);
    voice.timer = setInterval(() => { if (Date.now() - voice.t0 >= 60000 && voice.rec) voice.rec.stop(); else paintMic(); }, 500);
    paintMic();
  }

  function paintMic() {
    const b = $('#mic');
    if (!b) return;
    const secs = Math.floor((Date.now() - voice.t0) / 1000);
    b.className = 'mic-btn' + (voice.rec ? ' on' : voice.busy ? ' busy' : '');
    b.innerHTML = voice.rec ? `<span class="rec-dot"></span> ${L('ឈប់', 'Stop')} 0:${String(secs).padStart(2, '0')}`
      : voice.busy ? `<span class="spin-sm"></span> ${L('កំពុងសរសេរ…', 'Writing…')}` : `🎤 ${L('និយាយ', 'Speak')}`;
  }

  // ---------------- Photo check while entering (Kim, 19 Oct 2026) ----------------
  // As soon as a meter or pump photo is added, Google's AI reads its number in the background (the driver keeps
  // typing). When the typed number is more than 1 away from the photo, the field turns red and Submit asks for a
  // note, like the other warnings. No connection or no answer: nothing is shown and the entry goes as normal.
  const PC_KIND = { odoPhoto: ['km', 'km'], hourPhoto: ['hour', 'h'], pumpPhoto: ['litres', 'L'] };
  const PC_NAME = { odoPhoto: ['កុងទ័រឡាន', 'odometer'], hourPhoto: ['កុងទ័រម៉ោង', 'hour meter'], pumpPhoto: ['កុងទ័រសាំង', 'fuel pump'] };
  const photoMark = d => d ? d.length + ':' + d.slice(-40) : '';

  /** The server's own readings of these exact photos, so it doesn't read them again after Submit. */
  function readTokens(f, t) {
    const out = {};
    ['odoPhoto', 'hourPhoto', 'pumpPhoto'].forEach(k => {
      const r = f.reads && f.reads[k];
      if (r && r.token && r.mark === photoMark(f[k]) && readState(f, k, t).state !== '') out[k] = r.token;
    });
    return out;
  }

  async function readPhoto(f, key) {
    if (!DEMO && !(state.config && state.config.photoCheck)) return;
    const data = f[key];
    if (!data) return;
    f.reads = f.reads || {};
    const r = f.reads[key] = { status: 'reading', mark: photoMark(data) };
    paintReads();
    try {
      const p = { kind: PC_KIND[key][0], photo: data };
      const res = await (DEMO ? demoApi('readPhoto', p) : callServer('readPhoto', p));
      if (f.reads[key] !== r) return;   // a newer photo replaced it
      if (res.off) { delete f.reads[key]; return; }
      r.status = 'done'; r.value = res.value == null ? null : Number(res.value); r.token = res.token || ''; r.wrong = !!res.wrong;
      // A wrong photo is told straight away, wherever the driver is on the form.
      if (r.wrong && state.form === f) toast(`⚠️ ${L(`រូបថតខុស! នេះមិនមែនជារូប${PC_NAME[key][0]}ទេ`, `Wrong photo! This is not the ${PC_NAME[key][1]}`)}`);
    } catch (e) {
      if (f.reads[key] === r) r.status = 'fail';
    }
    if (state.form === f) updateWarnings();
  }

  /** {state: ''|'reading'|'ok'|'bad'|'unread', typedTxt, readTxt} for one photo of the form. */
  function readState(f, key, t) {
    const r = f.reads && f.reads[key];
    if (!r || r.mark !== photoMark(f[key]) || !t) return { state: '' };
    if ((key === 'odoPhoto' && (t.meter !== 'km' || f.meterBroken)) || (key === 'hourPhoto' && t.meter !== 'hour')) return { state: '' };
    if (r.status === 'reading') return { state: 'reading' };
    if (r.status !== 'done') return { state: '' };
    if (r.wrong) return { state: 'wrong' };
    if (r.value === null) return { state: 'unread' };
    const [field, unit] = PC_KIND[key], typed = toNum(f[field]);
    if (!(typed > 0)) return { state: '' };
    return { state: Math.abs(typed - r.value) <= 1 ? 'ok' : 'bad', typedTxt: fmtNum(typed) + ' ' + unit, readTxt: fmtNum(r.value) + ' ' + unit };
  }

  function paintReads() {
    const f = state.form, t = typeInfo(f && f.type);
    $$('[data-pc]').forEach(el => {
      const m = readState(f, el.dataset.pc, t);
      el.className = 'pc-hint ' + m.state;
      el.innerHTML = m.state === 'reading' ? `<span class="spin-sm"></span> ${L('កំពុងអានលេខពីរូបថត…', 'Reading the photo…')}`
        : m.state === 'ok' ? `✅ ${L('ត្រូវនឹងរូបថត', 'Matches the photo')}`
        : m.state === 'bad' ? `⚠️ ${L(`រូបថតបង្ហាញ <b>${m.readTxt}</b> · សូមពិនិត្យលេខ ឬ ថតរូបម្តងទៀត`, `The photo shows <b>${m.readTxt}</b>. Check the number or retake the photo`)}`
        : m.state === 'wrong' ? `❌ ${L(`រូបថតខុស! នេះមិនមែនជារូប${PC_NAME[el.dataset.pc][0]}ទេ · សូមថតម្តងទៀត`, `Wrong photo! This is not the ${PC_NAME[el.dataset.pc][1]}. Please retake it`)}`
        : m.state === 'unread' ? `📷 ${L('អានលេខពីរូបមិនបាន · សូមថតឲ្យច្បាស់', 'Could not read the photo. Take a clearer one')}` : '';
    });
  }

  async function submit() {
    const f = state.form;
    const { errors } = check();
    if (errors.length) {
      $('#errBox').innerHTML = `<div class="alert bad">${L('សូមបំពេញ', 'Please complete')}:<ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
      $('#errBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const btn = $('#submit');
    btn.disabled = true; btn.textContent = L('កំពុងបញ្ជូន...', 'Sending...');
    $('#errBox').innerHTML = '';
    const t = typeInfo(f.type);
    const takenAt = f.takenAt || Date.now();
    const photoId = state.editing ? state.editing.id : entryId(takenAt);
    const photoAt = state.editing ? state.editing.dateTime : takenAt;
    const photos = {};
    for (const k of ['odoPhoto', 'hourPhoto', 'pumpPhoto']) {
      photos[k] = f[k] && !(f.stamped && f.stamped[k]) ? await watermark(f[k], photoId, photoAt).catch(() => f[k]) : f[k];
    }
    const payload = {
      type: f.type, plate: f.plate.trim(), driver: f.driver,
      km: t.meter === 'km' && !f.meterBroken ? f.km : '', hour: t.meter === 'hour' ? f.hour : '',
      meterBroken: t.meter === 'km' && !!f.meterBroken,
      litres: f.litres, note: f.note.trim(),
      odoPhoto: t.meter === 'km' ? photos.odoPhoto : null,
      hourPhoto: t.meter === 'hour' ? photos.hourPhoto : null,
      pumpPhoto: photos.pumpPhoto, signature: f.signature,
      newDriver: !!f.newDriver, newPlate: !!f.newPlate,
      reads: readTokens(f, t),
    };
    try {
      if (state.editing) {
        payload.id = state.editing.id;
        const res = await api('update', payload);
        toast('✔️ ' + L('បានរក្សាទុក', 'Saved'));
        Object.assign(state.editing, localRow(Object.assign(payload, res && res.driver ? { driver: res.driver, plate: res.plate } : {})), { updatedAt: Date.now() });
        rv.fetchedAt = 0;
        refreshConfig();
        leaveEdit();
        back();
      } else {
        payload.lat = state.gps.lat; payload.lng = state.gps.lng;
        const item = { ref: newRef(), user: state.config.user.email, takenAt, tries: 0, error: '', payload };
        payload.ref = item.ref; payload.takenAt = item.takenAt; payload.newId = photoId; payload.stamped = true;
        await outbox.add(item);
        remember(f);
        resetForm();
        go({ s: 'success', ref: item.ref });
        flushOutbox();
      }
    } catch (e) {
      if (!$('#errBox')) return;   // sign-in screen is showing; form state is kept
      $('#errBox').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`;
      btn.disabled = false; btn.textContent = state.editing ? '💾 ' + L('រក្សាទុក', 'Save changes') : '✔️ ' + L('បញ្ជូន', 'Submit');
    }
  }

  /** The saved entry as the lists show it, before the server copy arrives. New photos are shown from the phone. */
  function localRow(p) {
    const row = { type: p.type, plate: p.plate, driver: p.driver, km: toNum(p.km) || null, hour: toNum(p.hour) || null,
      litres: toNum(p.litres), note: p.note };
    ['odoPhoto', 'hourPhoto', 'pumpPhoto'].forEach(k => { if (p[k]) row[k] = p[k]; });
    return row;
  }

  function refreshConfig() {
    const upTo = outbox.recent.length;
    api('config').then(c => { state.config = c; local.set('config', c); outbox.recent.splice(0, upTo); }).catch(() => {});
  }

  function renderSuccess(ref) {
    const id = outbox.sent[ref], item = outbox.get(ref);
    const status = id ? `<div class="idtag">${esc(id)}</div>`
      : item && item.error ? `<div class="alert bad">⚠️ ${L('មិនទាន់បានរក្សាទុក', 'Not saved')}: ${esc(item.error)}</div>
          <p><button class="btn" id="fixIt">✏️ ${L('កែ', 'Fix')}</button></p>`
      : `<p class="send-state"><span class="spinner sm"></span><span>${L('កំពុងបញ្ជូនក្នុងផ្ទៃខាងក្រោយ។ អ្នកអាចបញ្ចូលថ្មីបាន។', 'Sending in the background. You can start the next entry.')}</span></p>`;
    $('#view').innerHTML = `
      <div class="card success">
        <div class="big">✅</div>
        <h2>${id ? L('បានបញ្ជូនរួចរាល់', 'Refill saved') : L('បានរក្សាទុកក្នុងទូរស័ព្ទ', 'Saved on this phone')}</h2>
        ${status}
        <button class="btn primary" id="again">➕ ${L('បញ្ចូលថ្មី', 'New entry')}</button>
      </div>`;
    $('#again').onclick = () => go({ s: 'new' });
    const fix = $('#fixIt');
    if (fix) fix.onclick = () => fixOutboxItem(ref);
  }

  // ---------------- GPS ----------------

  function startGps() {
    if (DEMO && !navigator.geolocation) { state.gps = { status: 'ok', lat: 11.5254, lng: 104.8687, acc: 10 }; return; }
    if (!navigator.geolocation) { state.gps = { status: 'err', msg: L('ទូរស័ព្ទនេះគ្មាន GPS', 'This phone has no GPS support.') }; return; }
    state.gps = { status: 'wait' };
    renderGps();
    navigator.geolocation.getCurrentPosition(pos => {
      state.gps = { status: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      renderGps();
    }, err => {
      if (DEMO) { state.gps = { status: 'ok', lat: 11.5254, lng: 104.8687, acc: 10 }; renderGps(); return; }
      state.gps = { status: 'err', msg: err.code === 1 ? L('ការអនុញ្ញាតទីតាំងត្រូវបានបិទ។ សូមអនុញ្ញាតទីតាំងសម្រាប់គេហទំព័រនេះ។', 'Location permission is blocked. Allow location for this site.') : L('មិនអាចរកទីតាំងបាន', 'Could not get location.') };
      renderGps();
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  }

  function renderGps() {
    const el = $('#gps');
    if (!el) return;
    const g = state.gps;
    el.className = 'gps ' + (g.status === 'ok' ? 'ok' : g.status === 'err' ? 'err' : '');
    el.innerHTML = g.status === 'ok'
      ? `<span class="dot"></span><span>📍 ${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}<small>${L('ទីតាំង', 'Location')} ±${Math.round(g.acc || 0)} m</small></span>`
      : g.status === 'err'
        ? `<span class="dot"></span><span>${L('មិនមានទីតាំង', 'No location')}<small>${esc(g.msg)}</small></span><button class="btn small" id="gpsRetry">${L('ព្យាយាមម្តងទៀត', 'Retry')}</button>`
        : `<span class="dot"></span><span>${L('កំពុងស្វែងរកទីតាំង...', 'Getting location...')}</span>`;
    const r = $('#gpsRetry');
    if (r) r.onclick = startGps;
  }

  // ---------------- Images ----------------

  function resizeImage(file, maxSide, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  /** The ID the server gives a new entry: FR + date-time of Submit in Cambodia time (UTC+7, no summer time). */
  function entryId(t) {
    const d = new Date(t + 7 * 3600 * 1000), p = n => String(n).padStart(2, '0');
    return 'FR' + p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate())
      + '-' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());
  }

  /** Kim, 17 Oct 2026: every photo carries its entry ID and date-time in a navy strip under the picture. */
  function watermark(dataUrl, id, at) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight, band = Math.max(36, Math.round(w * 0.07));
        const c = document.createElement('canvas');
        c.width = w; c.height = h + band;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        x.fillStyle = '#011e41'; x.fillRect(0, h, w, band);
        const d = new Date((at || Date.now()) + 7 * 3600 * 1000), p = n => String(n).padStart(2, '0');
        const when = p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
        const pad = Math.round(band * 0.35), mid = h + band / 2;
        x.textBaseline = 'middle'; x.fillStyle = '#fff';
        x.font = `700 ${Math.round(band * 0.5)}px system-ui, sans-serif`;
        x.textAlign = 'left'; x.fillText(id, pad, mid);
        x.font = `400 ${Math.round(band * 0.4)}px system-ui, sans-serif`;
        x.textAlign = 'right'; x.fillText('STEEL · ' + when, w - pad, mid);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('bad image'));
      img.src = dataUrl;
    });
  }

  function openLightbox(src) {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `<img src="${src}" alt="">`;
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
  }

  // ---------------- Lists ----------------

  function badge(status) {
    if (status === STATUS_OK) return `<span class="badge ok">✔ ${L(STATUS_OK, 'Correct')}</span>`;
    if (status === STATUS_BAD) return `<span class="badge bad">✖ ${L(STATUS_BAD, 'Not correct')}</span>`;
    return `<span class="badge pending">${L('រង់ចាំ', 'Pending')}</span>`;
  }

  function entryCard(r, extra) {
    const meter = r.km ? `${fmtNum(r.km)} km` : r.hour ? `${fmtNum(r.hour)} h` : '–';
    return `
      <div class="card list-item" data-id="${esc(r.id)}">
        <div class="li-top">
          <div><div class="li-title">${esc(emojiOf(r.type))} ${esc(r.plate || '–')}</div>
            <div class="li-meta">${r.ref ? '' : esc(r.id) + ' · '}${fmtDate(r.dateTime)}</div></div>
          ${r.ref ? (r.error ? `<span class="badge bad">⚠️ ${L('មិនទាន់រក្សាទុក', 'Not saved')}</span>` : `<span class="badge sending">⏳ ${L('កំពុងបញ្ជូន', 'Sending')}</span>`) : badge(r.status)}
        </div>
        <div class="li-grid">
          <div><small>${L('តៃកុង', 'Driver')}</small>${esc(r.driver)}</div>
          <div><small>${L('កុងទ័រ', 'Meter')}</small>${meter}</div>
          <div><small>${L('លីត្រ', 'Litres')}</small><b>${fmtNum(r.litres)}</b></div>
        </div>
        ${r.note ? `<div class="hint">📝 ${esc(r.note)}</div>` : ''}
        ${extra || ''}
      </div>`;
  }

  // Complete Data streak: entries the reviewer marked ត្រឹមត្រូវ in a row (newest first). Entries not reviewed
  // yet are skipped; one marked មិនត្រឹមត្រូវ ends the streak. Badges at 5, 10 and 15.
  const BADGES = [[5, '🥉', 'ផ្លាកសំរិទ្ធ', 'Bronze'], [10, '🥈', 'ផ្លាកប្រាក់', 'Silver'], [15, '🥇', 'ផ្លាកមាស', 'Gold']];
  function streakOf(rows) {
    let n = 0;
    for (const r of rows.slice().sort((a, b) => (b.dateTime || 0) - (a.dateTime || 0))) {
      if (!r.status) continue;
      if (r.status !== STATUS_OK) break;
      n++;
    }
    return n;
  }
  function streakHtml(rows) {
    if (!rows || !rows.some(r => r.status)) return '';
    const n = streakOf(rows);
    const next = BADGES.find(b => n < b[0]);
    const prev = BADGES.filter(b => n >= b[0]).pop();
    const from = prev ? prev[0] : 0, to = next ? next[0] : from;
    const pct = next ? Math.round((n - from) / (to - from) * 100) : 100;
    return `<div class="streak">
        <div class="streak-top"><span class="streak-ic" aria-hidden="true">${n ? '⭐' : '🌱'}</span>
          <div><b>${n ? L(`ទិន្នន័យត្រឹមត្រូវ ${n} ដងជាប់គ្នា!`, `${n} correct entries in a row!`) : L('ចាប់ផ្តើមស៊េរីថ្មី', 'Start a new streak')}</b>
            <small>${L('រូបថត Km និងលីត្រ ត្រឹមត្រូវ ដែលអ្នកពិនិត្យបានបញ្ជាក់', 'Photos, km and litres confirmed by the reviewer')}</small></div></div>
        <div class="streak-bar"><i style="width:${pct}%"></i></div>
        <small class="streak-next">${next ? L(`${next[0] - n} ដងទៀត ដើម្បីទទួលបាន ${next[1]} ${next[2]}`, `${next[0] - n} more for the ${next[1]} ${next[3]} badge`) : L('🎉 អ្នកទទួលបានផ្លាកមាសហើយ!', '🎉 You have the Gold badge!')}</small>
      </div>
      <div class="badges">${BADGES.map(([k, ic, km, en]) => `<div class="badge-box ${n >= k ? 'on' : ''}"><span>${ic}</span><b>${L(km, en)}</b><small>${k} ${L('ដង', 'in a row')}</small></div>`).join('')}</div>`;
  }

  const MINE_HEAD = () => `<h2>${L('ការចាក់សាំងរបស់ខ្ញុំ (៤៥ ថ្ងៃចុងក្រោយ)', 'My entries (last 45 days)')}</h2>`;

  /** Draws My entries from what is already on the phone: entries still sending first, then the saved list. */
  function drawMine() {
    const waiting = outboxRows(), rows = state.mine;
    if (!rows && !waiting.length) return;
    const card = r => r.ref
      ? entryCard(r, r.error
        ? `<div class="alert bad">${esc(r.error)}</div><div class="actions" data-ref="${esc(r.ref)}">
            <button class="btn small" data-fix>✏️ ${L('កែ ហើយបញ្ជូនម្តងទៀត', 'Fix &amp; resend')}</button>
            <button class="btn small ghost" data-discard>🗑 ${L('លុប', 'Discard')}</button></div>`
        : '')
      : entryCard(r, r.status ? '' : `<div class="actions"><button class="btn small" data-edit>✏️ ${L('កែប្រែ', 'Edit')}</button></div>`);
    const all = waiting.concat(rows || []);
    $('#view').innerHTML = MINE_HEAD() + streakHtml(rows) + (all.length ? all.map(card).join('')
      : `<div class="empty">${L('មិនទាន់មានទិន្នន័យ', 'No entries yet')}</div>`) + (rows ? '' : '<div class="spinner"></div>');
    $$('[data-edit]').forEach(b => b.onclick = () => go({ s: 'edit', id: b.closest('[data-id]').dataset.id, from: 'mine' }));
    $$('[data-fix]').forEach(b => b.onclick = () => fixOutboxItem(b.closest('[data-ref]').dataset.ref));
    $$('[data-discard]').forEach(b => b.onclick = async () => {
      if (!confirm(L('លុបការចាក់សាំងនេះចោល? មិនទាន់បានរក្សាទុកក្នុង Sheet ទេ។', 'Discard this entry? It was never saved to the sheet.'))) return;
      await outbox.remove(b.closest('[data-ref]').dataset.ref);
      drawMine();
    });
  }

  async function renderMine() {
    const me = current();
    const have = state.mine || local.get('mine');
    if (have) state.mine = have;
    if (have || outbox.mine().length) drawMine();
    else $('#view').innerHTML = MINE_HEAD() + '<div class="spinner"></div>';
    let rows;
    try { rows = await api('mine'); }
    catch (e) {
      if (current() !== me || $('#tabs').hidden) return;
      if (have || outbox.mine().length) toast(e.message); else $('#view').innerHTML = MINE_HEAD() + `<div class="alert bad">${esc(e.message)}</div>`;
      return;
    }
    // Entries sent a moment ago may not be in the server list yet; keep them until they are.
    const fresh = (state.mine || []).filter(r => Date.now() - (r.dateTime || 0) < 120000 && !rows.some(x => x.id === r.id));
    rows = fresh.concat(rows);
    const changed = !sameData(rows, state.mine);
    state.mine = rows;
    local.set('mine', rows);
    if (current() === me && (changed || !have) && !state.editing) drawMine();
  }

  /** Background refresh (every minute while the app is on screen): My entries and the Reviewer list pick up
   *  changes made by others without pressing Refresh. Never while an entry is being typed or edited. */
  async function liveRefresh() {
    const me = current();
    if (!me || $('#tabs').hidden || state.editing) return;
    if (me.s === 'mine') {
      let rows = await api('mine');
      const fresh = (state.mine || []).filter(r => Date.now() - (r.dateTime || 0) < 120000 && !rows.some(x => x.id === r.id));
      rows = fresh.concat(rows);
      if (sameData(rows, state.mine)) return;
      state.mine = rows; local.set('mine', rows);
      if (current() === me && !state.editing) LIVE.keep(drawMine);
    } else if (me.s === 'review') {
      const changed = await refreshRows();
      reviewBadge();
      if (changed && current() === me) await LIVE.keep(() => renderReview());
    }
  }
  if (window.LIVE && !DEMO) LIVE.start({ run: liveRefresh, busy: () => { const c = current(); return !c || (c.s !== 'mine' && c.s !== 'review') || !!state.editing; } });

  // ---------------- Reviewer tab ----------------

  const KH_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
  const KH_DAYS = ['អាទិត្យ', 'ច័ន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍'];
  const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const FILTERS = [
    ['pending', 'រង់ចាំ', 'Pending', r => !r.status],
    ['ok', STATUS_OK, 'Correct', r => r.status === STATUS_OK],
    ['bad', 'លុបចោល', 'Cancelled', r => r.status === STATUS_BAD],
    ['all', 'ទាំងអស់', 'All', () => true],
  ];
  const rv = { rows: null, filter: 'pending', open: {}, restoreY: null, fetchedAt: 0, loading: null, pending: {} };
  const pad2 = n => String(n).padStart(2, '0');
  const timeOf = ms => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const statusCls = status => status === STATUS_OK ? 'ok' : status === STATUS_BAD ? 'bad' : 'pending';

  function statusDot(status) {
    const label = status === STATUS_OK ? L(STATUS_OK, 'Correct') : status === STATUS_BAD ? L('លុបចោល', 'Cancelled') : L('រង់ចាំ', 'Pending');
    return `<span class="pill ${statusCls(status)}">${label}</span>`;
  }

  /** Fetches all entries; resolves true when they differ from what is shown. */
  function refreshRows() {
    if (!rv.loading) {
      rv.loading = api('all').then(rows => {
        // Reviews still being saved win over the server copy.
        rows.forEach(r => { if (rv.pending[r.id]) Object.assign(r, rv.pending[r.id]); });
        const changed = !sameData(rows, rv.rows);
        rv.rows = rows;
        rv.fetchedAt = Date.now();
        local.set('all', rows);
        return changed;
      }).finally(() => { rv.loading = null; });
    }
    return rv.loading;
  }

  /**
   * Makes sure entries are available. With a saved copy it returns at once and refreshes in the
   * background (onChange redraws if the screen is still open); otherwise it waits for the server.
   */
  async function ensureRows(me, onChange) {
    if (!rv.rows) rv.rows = local.get('all');
    if (rv.rows) {
      if (Date.now() - rv.fetchedAt > 15000) {
        refreshRows().then(changed => { if (changed && current() === me) onChange(); })
          .catch(e => { if (current() === me) toast(e.message); });
      }
      return true;
    }
    $('#view').innerHTML = '<div class="spinner"></div>';
    try { await refreshRows(); }
    catch (e) { if (current() === me) $('#view').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; return false; }
    return current() === me;
  }

  async function renderReview(refresh) {
    const me = current();
    if (refresh) rv.fetchedAt = 0;
    if (!(await ensureRows(me, () => renderReview()))) return;
    const pass = FILTERS.find(f => f[0] === rv.filter)[3];
    const rows = rv.rows.filter(pass);

    // Year → month → day
    const years = [];
    rows.forEach(r => {
      const d = new Date(r.dateTime || 0);
      const yk = String(d.getFullYear()), mk = yk + '-' + pad2(d.getMonth() + 1), dk = mk + '-' + pad2(d.getDate());
      let y = years.find(x => x.key === yk); if (!y) years.push(y = { key: yk, months: [], count: 0 });
      let m = y.months.find(x => x.key === mk); if (!m) y.months.push(m = { key: mk, kh: KH_MONTHS[d.getMonth()], en: `${MONTHS[d.getMonth()]} ${yk}`, days: [], count: 0 });
      let day = m.days.find(x => x.key === dk);
      if (!day) m.days.push(day = { key: dk, kh: `${KH_DAYS[d.getDay()]} ${pad2(d.getDate())}`, en: `${EN_DAYS[d.getDay()]} ${pad2(d.getDate())}`, rows: [] });
      day.rows.push(r); m.count++; y.count++;
    });
    // newest year and month start open
    if (years[0] && rv.open[years[0].key] === undefined) rv.open[years[0].key] = true;
    if (years[0] && years[0].months[0] && rv.open[years[0].months[0].key] === undefined) rv.open[years[0].months[0].key] = true;

    // The odometer photo (hour meter for machines) instead of the type icon; the icon stays when there is none.
    const PC_SIGN = { ok: '✓', bad: '✕', unread: '?' };
    const rowIcon = (r, pc) => {
      const url = r.odoPhoto || r.hourPhoto;
      const badge = pc ? `<span class="pc-b ${pc.mark}">${PC_SIGN[pc.mark]}</span>` : '';
      if (!url) return `<span class="rv-ic">${esc(emojiOf(r.type))}${badge}</span>`;
      const img = thumbs.get(url);
      return `<span class="rv-ic thumb-ic ${img ? 'has-img' : ''}" data-thumb="${esc(url)}"${img ? ` style="background-image:url('${img}')"` : ''}>${esc(emojiOf(r.type))}${badge}</span>`;
    };
    const rowHtml = r => { const pc = pcResult(r); return `
      <button type="button" class="rv-row" data-open="${esc(r.id)}">
        ${rowIcon(r, pc)}
        <span class="rv-main"><b>${esc(r.plate || '–')}</b><small>${esc(r.driver || '–')} · ${timeOf(r.dateTime)}</small>${pc && pc.mark === 'bad' ? `<span class="pc-note">⚠ ${pc.parts.filter(x => x.state === 'bad' || x.state === 'wrong').map(x => esc(x.short)).join(' · ')}</span>` : ''}</span>
        <span class="rv-right"><b>${fmtNum(r.litres)} <i>L</i></b>${statusDot(r.status)}</span>
      </button>`; };

    $('#view').innerHTML = `
      <div class="rv-head">
        <h2>${L('អ្នកត្រួតពិនិត្យ', 'Reviewer · all entries')}</h2>
        <a class="btn small" href="qr.html" title="${L('បោះពុម្ព QR សម្រាប់ឡាននីមួយៗ', 'Print a QR sticker for each truck')}">🖨 QR</a>
        <button type="button" class="icon-btn round" id="rvRefresh" aria-label="${L('ទាញថ្មី', 'Refresh')}" title="${L('ទាញថ្មី', 'Refresh')}">↻</button>
      </div>
      <div class="seg" role="tablist">${FILTERS.map(([k, kh, en, fn]) => `
        <button type="button" role="tab" aria-selected="${k === rv.filter}" class="seg-btn ${k === rv.filter ? 'on' : ''} f-${k}" data-filter="${k}">
          <span class="seg-n">${rv.rows.filter(fn).length}</span><span class="seg-kh">${L(kh, en)}</span>
        </button>`).join('')}
      </div>
      ${rv.rows.some(r => r.pc) ? `<div class="pc-legend"><span><b class="ok">✓</b> ${L('ត្រូវនឹងរូបថត', 'Matches the photo')}</span><span><b class="bad">✕</b> ${L('មិនត្រូវនឹងរូបថត', 'Does not match')}</span><span><b class="unread">?</b> ${L('អានរូបមិនបាន', 'Photo not readable')}</span></div>` : ''}
      ${years.length ? years.map(y => `
        <section class="rv-year ${rv.open[y.key] ? 'open' : ''}" data-key="${y.key}">
          <button type="button" class="yr-h" data-toggle aria-expanded="${!!rv.open[y.key]}"><span>${y.key}</span><span class="cnt">${y.count}</span><span class="chev" aria-hidden="true"></span></button>
          <div class="grp-body">
          ${y.months.map(m => `
            <section class="rv-month ${rv.open[m.key] ? 'open' : ''}" data-key="${m.key}">
              <button type="button" class="mo-h" data-toggle aria-expanded="${!!rv.open[m.key]}">
                <span class="mo-name">${L(m.kh, m.en)}</span><span class="cnt">${m.count}</span><span class="chev" aria-hidden="true"></span>
              </button>
              <div class="grp-body">
                ${m.days.map(d => `
                  <div class="day-h"><span>${L(d.kh, d.en)}</span><span>${d.rows.length}</span></div>
                  <div class="day-card">${d.rows.map(rowHtml).join('')}</div>`).join('')}
              </div>
            </section>`).join('')}
          </div>
        </section>`).join('')
      : `<div class="empty"><div class="big">🎉</div>${L('គ្មានទិន្នន័យ', 'No entries')}</div>`}`;

    $$('[data-filter]').forEach(b => b.onclick = () => { rv.filter = b.dataset.filter; renderReview(); });
    $('#rvRefresh').onclick = () => renderReview(true);
    reviewBadge();
    $$('[data-toggle]').forEach(b => b.onclick = () => {
      const sec = b.parentElement, open = !sec.classList.contains('open');
      sec.classList.toggle('open', open);
      b.setAttribute('aria-expanded', open);
      rv.open[sec.dataset.key] = open;
    });
    $$('[data-open]').forEach(b => b.onclick = () => { rv.restoreY = window.scrollY; go({ s: 'detail', id: b.dataset.open }); });
    if (rv.restoreY != null) { window.scrollTo(0, rv.restoreY); rv.restoreY = null; }
    thumbs.watch($('#view'));
  }

  /**
   * The AI's readings of an entry's photos (Photo Check tab) against what was typed: one part per photo,
   * and one mark for the row: ✕ when any part doesn't match or is the wrong photo, ? when one couldn't be read.
   */
  function pcResult(r) {
    const c = r.pc;
    if (!c) return null;
    const parts = [];
    const add = (key, typed, read, wrong) => {
      const [, unit] = PC_KIND[key];
      const state = wrong ? 'wrong' : read == null || typed == null ? 'unread' : Math.abs(typed - read) <= 1 ? 'ok' : 'bad';
      parts.push({ key, state, typed, read, unit,
        short: wrong ? L(`រូប${PC_NAME[key][0]}ខុស`, `Wrong ${PC_NAME[key][1]} photo`) : L(`រូបថតបង្ហាញ ${fmtNum(read)} ${unit}`, `Photo shows ${fmtNum(read)} ${unit}`) });
    };
    const meterKey = r.odoPhoto ? 'odoPhoto' : r.hourPhoto ? 'hourPhoto' : '';
    if (meterKey && 'meter' in c) add(meterKey, meterKey === 'odoPhoto' ? r.km : r.hour, c.meter, c.meterWrong);
    if (r.pumpPhoto && 'litres' in c) add('pumpPhoto', r.litres, c.litres, c.pumpWrong);
    if (!parts.length) return null;
    const mark = parts.some(x => x.state === 'bad' || x.state === 'wrong') ? 'bad' : parts.some(x => x.state === 'unread') ? 'unread' : 'ok';
    return { parts, mark };
  }

  function pcCard(r) {
    const pc = pcResult(r);
    if (!pc) {
      const waiting = state.config && state.config.photoCheck && (r.odoPhoto || r.hourPhoto || r.pumpPhoto) && r.status !== STATUS_BAD;
      return waiting ? `<div class="pc-card"><h3>🤖 ${L('ពិនិត្យលេខពីរូបថត', 'Photo check')}</h3><div class="hint">⏳ ${L('កំពុងរង់ចាំអានរូបថត (ប្រហែល ៥ នាទី)', 'Waiting for the photos to be read (about 5 minutes)')}</div></div>` : '';
    }
    const pill = { ok: ['ok', '✓ ' + L('ត្រូវ', 'Match')], bad: ['bad', '✕ ' + L('មិនត្រូវ', 'No match')], wrong: ['bad', '✕ ' + L('រូបថតខុស', 'Wrong photo')], unread: ['unread', '? ' + L('អានមិនបាន', 'Not readable')] };
    return `<div class="pc-card"><h3>🤖 ${L('ពិនិត្យលេខពីរូបថត', 'Photo check')}</h3>
      ${pc.parts.map(x => `<div class="pc-row"><span class="lbl">${L(PC_NAME[x.key][0], PC_NAME[x.key][1].replace(/^./, ch => ch.toUpperCase()))}
        <small>${L('វាយ', 'Typed')} ${x.typed == null ? '–' : fmtNum(x.typed) + ' ' + x.unit} · ${L('រូបថត', 'Photo')} ${x.state === 'wrong' ? L('មិនមែនរូបកុងទ័រ', 'not a meter') : x.read == null ? '–' : fmtNum(x.read) + ' ' + x.unit}</small></span>
        <span class="pc-pill ${pill[x.state][0]}">${pill[x.state][1]}</span></div>`).join('')}
    </div>`;
  }

  /** Reviewers, admins and people with the Dashboard ticked may open an entry's details (also from Telegram). */
  function canCheck() {
    const c = state.config || {}, u = c.user || {};
    return c.canCheck != null ? !!c.canCheck : (u.role === 'reviewer' || u.role === 'admin');
  }
  const canReview = () => { const u = (state.config || {}).user || {}; return u.role === 'reviewer' || u.role === 'admin'; };

  async function openDetail(id) {
    const me = current();
    if (!canCheck()) {
      $('#view').innerHTML = `<div class="card success"><div class="big">🔒</div>
        <p>${L('មានតែអ្នកត្រួតពិនិត្យ អ្នកគ្រប់គ្រង ឬអ្នកមានសិទ្ធិប្រើ Dashboard ទេ ដែលអាចមើលព័ត៌មាននេះបាន។', 'Only reviewers, admins and people with Dashboard access can see these details.')}</p>
        <button class="btn primary" id="toNew">➕ ${L('បញ្ចូលថ្មី', 'New entry')}</button></div>`;
      $('#toNew').onclick = () => go({ s: 'new' });
      return;
    }
    const redraw = () => { const box = $('#dReason'); if (!box || !box.innerHTML) renderDetail(id); };
    if (!(await ensureRows(me, redraw))) return;
    renderDetail(id);
  }

  function renderDetail(id) {
    const r = rv.rows.find(x => x.id === id);
    if (!r) { $('#view').innerHTML = `<div class="empty">${L('រកមិនឃើញ', 'Entry not found')}</div>`; return; }
    const tile = (kh, en, v, wide) => `<div class="tile ${wide ? 'wide' : ''}"><small>${L(kh, en)}</small><div>${v}</div></div>`;
    const photos = [['odoPhoto', 'កុងទ័រឡាន', 'Odometer'], ['hourPhoto', 'កុងទ័រម៉ោង', 'Hour meter'], ['pumpPhoto', 'កុងទ័រសាំង', 'Fuel pump'], ['signature', 'ហត្ថលេខា', 'Signature']].filter(([k]) => r[k]);
    $('#view').innerHTML = `
      <div class="dt-hero">
        <div class="dt-top">
          <span class="dt-ic">${esc(emojiOf(r.type))}</span>
          <div class="dt-title"><b>${esc(r.plate || '–')}</b><small>${esc(textOf(r.type))}</small></div>
          ${statusDot(r.status)}
        </div>
        <div class="dt-big">${fmtNum(r.litres)}<span>${L('លីត្រ', 'litres')}</span></div>
        <div class="dt-sub">${fmtDate(r.dateTime)} · <span class="mono" lang="en">${esc(r.id)}</span></div>
      </div>
      ${pcCard(r)}
      <div class="tiles">
        ${tile('ឈ្មោះតៃកុង', 'Driver', esc(r.driver || '–'))}
        ${r.km != null ? tile('លេខកុងទ័រ', 'Odometer', fmtNum(r.km) + ' km') : ''}
        ${r.hour != null ? tile('កុងទ័រម៉ោង', 'Hour meter', fmtNum(r.hour) + ' h') : ''}
        ${r.status ? tile('ពិនិត្យដោយ', 'Reviewed by', `${esc(r.reviewedByName || String(r.reviewedBy || '').split('@')[0])}${r.reviewedAt ? '<small>' + fmtDate(r.reviewedAt) + '</small>' : ''}`) : ''}
        ${r.updatedAt ? tile('កែចុងក្រោយ', 'Last edited', fmtDate(r.updatedAt)) : ''}
        ${r.note ? tile('សំគាល់', 'Note', esc(r.note), true) : ''}
      </div>
      <div class="sec-h">${L('រូបថត', 'Photos')}</div>
      <div class="gallery" id="dPhotos">${photos.length
        ? photos.map(([k, kh, en]) => `<figure data-k="${k}"><div class="ph-box"><div class="spinner"></div></div><figcaption>${L(kh, en)}</figcaption></figure>`).join('')
        : `<div class="hint">${L('គ្មានរូបថត', 'No photos')}</div>`}</div>
      <div id="dReason"></div>
      <div class="decide ${r.status ? 'done' : ''}" ${canReview() ? '' : 'hidden'}>
        <button type="button" class="btn ok" id="dOk" ${r.status ? 'disabled' : ''}>✔ ${L('ត្រឹមត្រូវ', 'Correct')}</button>
        <button type="button" class="btn ghost" id="dEdit" ${r.status ? 'disabled' : ''}>✏️ ${L('កែតម្រូវ', 'Correct data')}</button>
        <button type="button" class="btn bad" id="dCancel" ${r.status ? 'disabled' : ''}>🗑 ${L('លុបចោល', 'Cancel entry')}</button>
      </div>`;

    photos.forEach(async ([k]) => {
      const fig = $(`#dPhotos [data-k="${k}"]`);
      const box = $('.ph-box', fig);
      const url = r[k];
      try {
        let dataUrl = /^data:/.test(url) ? url : photoCache.get(url);
        if (dataUrl === undefined) {
          dataUrl = (await api('photo', { url })).dataUrl;
          rememberPhoto(url, dataUrl);
        }
        if (!fig.isConnected) return;
        box.innerHTML = dataUrl ? `<img src="${dataUrl}" alt="">` : `<div class="noimg">${L('មិនអាចបង្ហាញរូប', 'Photo not available')}</div>`;
        const img = $('img', box);
        if (img) img.onclick = () => openLightbox(img.src);
      } catch (e) { if (fig.isConnected) box.innerHTML = `<div class="noimg">${esc(e.message)}</div>`; }
    });

    // The decision shows at once and is saved in the background; if saving fails it is undone.
    const setStatus = (status, note) => {
      note = (note || '').trim();
      const before = { status: r.status, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, note: r.note };
      const after = { status, reviewedBy: state.config.user.email, reviewedByName: state.config.user.name || '', reviewedAt: Date.now(),
        note: note ? (r.note ? r.note + ' | ' : '') + 'Review: ' + note : r.note };
      Object.assign(r, after);
      rv.pending[r.id] = after;
      local.set('all', rv.rows);
      toast(status === STATUS_OK ? '✔ ' + L(STATUS_OK, 'Correct') : '🗑 ' + L('លុបចោល', 'Cancelled'));
      api('review', { id: r.id, status, note }).then(() => {
        delete rv.pending[r.id];
      }).catch(e => {
        delete rv.pending[r.id];
        Object.assign(r, before);
        local.set('all', rv.rows);
        toast(`${L('មិនបានរក្សាទុក', 'Not saved')}: ${r.plate || r.id} · ${e.message}`);
        const c = current();
        if (c && c.s === 'review') renderReview();
        else if (c && c.s === 'detail' && c.id === r.id) renderDetail(r.id);
      });
      const prev = nav.stack[nav.i - 1];
      if (prev && prev.s === 'review') back();
      else go({ s: 'review' }, true);
    };
    $('#dOk').onclick = () => setStatus(STATUS_OK, '');
    $('#dCancel').onclick = () => {
      // First tap asks for a reason, second tap confirms. The row stays in the sheet, marked មិនត្រឹមត្រូវ.
      const box = $('#dReason');
      if (!box.innerHTML) {
        box.innerHTML = `<div class="card reason"><div class="label"><span>${L('មូលហេតុលុបចោល (ស្រេចចិត្ត)', 'Reason (optional)')}</span></div>
          <input type="text" id="cancelReason" placeholder="${L('ឧ. ចុចបញ្ចូលស្ទួន', 'e.g. duplicate entry')}">
          <div class="hint">${L(`ទិន្នន័យនៅតែមានក្នុងសន្លឹក ដោយសម្គាល់ថា “${STATUS_BAD}”។ ចុច 🗑 ម្តងទៀតដើម្បីបញ្ជាក់។`, `The row stays in the sheet, marked “${STATUS_BAD}”. Tap 🗑 again to confirm.`)}</div></div>`;
        $('#cancelReason').focus();
        return;
      }
      setStatus(STATUS_BAD, $('#cancelReason').value);
    };
    $('#dEdit').onclick = () => go({ s: 'edit', id: r.id, from: 'review' });
  }

  /** Shows the entry form pre-filled for editing. A half-filled new entry is kept and comes back afterwards. */
  async function openEdit(screen) {
    if (state.editing && state.editing.id === screen.id) return renderForm();
    const fromReview = screen.from === 'review';
    let list = fromReview ? (rv.rows || (rv.rows = local.get('all'))) : (state.mine || (state.mine = local.get('mine')));
    if (!list) {
      $('#view').innerHTML = '<div class="spinner"></div>';
      try { list = fromReview ? (rv.rows = await api('all')) : (state.mine = await api('mine')); }
      catch (e) { if (current() === screen) $('#view').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; return; }
      if (current() !== screen) return;
    }
    const r = list.find(x => x.id === screen.id);
    if (!r || (!fromReview && r.status)) {
      $('#view').innerHTML = `<div class="empty">${r ? L('បានពិនិត្យរួច មិនអាចកែបានទេ', 'Already reviewed, can no longer be edited') : L('រកមិនឃើញ', 'Entry not found')}</div>`;
      return;
    }
    if (!state.editing) state.draft = state.form;
    state.editing = r;
    state.returnTo = screen.from;
    // The server writes "កុងទ័រខូច / Odometer broken" at the start of the note; the edit form shows it as the tick box.
    const brokenNote = /^កុងទ័រខូច \/ Odometer broken(\s*·\s*)?/;
    const wasBroken = r.km == null && brokenNote.test(r.note || '');
    state.form = { type: r.type, plate: r.plate, driver: r.driver,
      km: r.km == null ? '' : String(r.km), hour: r.hour == null ? '' : String(r.hour), meterBroken: wasBroken,
      litres: String(r.litres), note: wasBroken ? (r.note || '').replace(brokenNote, '') : (r.note || ''),
      odoPhoto: null, hourPhoto: null, pumpPhoto: null, signature: null };
    renderForm();
  }

  function leaveEdit() {
    state.editing = null;
    if (state.draft) { state.form = state.draft; state.draft = null; }
    else resetForm();
  }

  // Startup ads and the Gallery moved out of this app (Kim, 30 Oct 2026): ../ads.js shows the startup ad in every
  // app, and admins manage ads in the 🖼️ Gallery Manager (../gallery/).

  // ---------------- Light / dark switch ----------------

  const THEME_KEY = 'fr_theme';
  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    const dark = (document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light')) === 'dark';
    $('#themeBtn').textContent = dark ? '☀️' : '🌙';
  }
  $('#themeBtn').onclick = () => {
    const dark = (document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light')) === 'dark';
    const next = dark ? 'light' : 'dark';
    storeSet(THEME_KEY, next);
    applyTheme(next);
  };
  applyTheme(storeGet(THEME_KEY));

  // ---------------- Khmer / English switch ----------------

  const STATIC = [
    ['#brandName', 'ចាក់សាំង', 'Fuel Refill'], ['#navBack span', 'ថយក្រោយ', 'Back'], ['#navFwd span', 'ទៅមុខ', 'Forward'],
    ['.home-tab .lb', 'ទំព័រដើម', 'Home'], ['[data-tab="new"] .lb', 'បញ្ចូលថ្មី', 'New'],
    ['[data-tab="mine"] .lb', 'របស់ខ្ញុំ', 'My entries'], ['[data-tab="review"] .lb', 'អ្នកត្រួតពិនិត្យ', 'Reviewer'],
    ['#demoBanner', 'DEMO · ទិន្នន័យមិនត្រូវបានរក្សាទុកទេ', 'DEMO · Nothing is saved'],
  ];
  function paintStatic() {
    STATIC.forEach(([sel, km, en]) => $$(sel).forEach(el => { el.textContent = L(km, en); }));
    $('#navBack').setAttribute('aria-label', L('ថយក្រោយ', 'Back'));
    $('#navFwd').setAttribute('aria-label', L('ទៅមុខ', 'Forward'));
    $('#themeBtn').title = L('ពន្លឺ / ងងឹត', 'Light / Dark');
  }
  if (window.LANG) {
    LANG.button($('#langBtn'));
    LANG.onChange(() => {
      paintStatic();
      if (redraw) redraw();
      else if (state.config && current()) {
        if (state.config.user) showRole();
        const y = window.scrollY;
        paint(current());
        window.scrollTo(0, y);
      }
    });
  }
  paintStatic();

  // ---------------- Boot ----------------

  if (DEMO) $('#demoBanner').hidden = false;
  // Keeps the whole site on the phone so it opens at once, even offline (see ../sw.js).
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
  const saved = storeGet(TOKEN_KEY);
  if (!DEMO && tokenValid(saved)) { state.token = saved; start(); }
  else renderLogin(false);
})();
