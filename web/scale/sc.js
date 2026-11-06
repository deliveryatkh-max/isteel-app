// Truck Scale (ជញ្ជីងឡាន), Kim 6 Nov 2026: replaces the supplier's old "S3 Smart Weight" program on the scale PC.
// Chrome / Edge read the Keli XK3118K8 indicator through the USB serial cable (Web Serial). The weight is taken only
// when it is stable; a typed weight needs an Admin and a reason. 1st weigh -> truck waits on site -> 2nd weigh ->
// gross / tare / net, warnings (unusual empty weight, overload), A4 ticket (Print or PDF).
// Everything is kept on the PC first and sent in the background, so the scale keeps working without internet.
// Data: apps-script-dataentry/Scale.gs (same Apps Script as Agent Data Entry). Masters come from one source each.
(function () {
  'use strict';

  const API = ((window.SC_CONFIG || {}).API_URL || '').trim();
  const DEMO = !API || /[?&]demo=1/.test(location.search);
  const TOKEN_KEY = 'fr_id_token';
  const CORE = window.SCALECORE;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const t = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const warnTxt = w => t(CORE.warnKm(w), w);   // saved warnings are English; Khmer screen shows Khmer (Kim, 6 Nov 2026)
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const getJ = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const iso = d => ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  const today = () => ymd(new Date());
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const kg = n => (n === '' || n == null || isNaN(n) ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const hm = s => (s ? String(s).slice(11, 16) : '');
  const dmy = s => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) + '/' + String(s).slice(0, 4) : '');
  const normP = s => String(s || '').toUpperCase().replace(/[\s\-.]/g, '');
  let toastTimer = 0;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500); }
  const busy = (b, on) => { if (!b) return; b.disabled = on; if (on) { b.dataset.t = b.innerHTML; b.innerHTML = '<span class="sp"></span>'; } else if (b.dataset.t) b.innerHTML = b.dataset.t; };
  const TYPE = { In: ['ចូល (ទទួល)', 'In (receive)'], Out: ['ចេញ (ដឹក)', 'Out (deliver)'] };
  const typeName = k => (TYPE[k] ? t(TYPE[k][0], TYPE[k][1]) : k || '');
  // In or Out comes from the weights: heavier at the 1st weigh = came in loaded (In, receive), lighter = left loaded (Out, deliver).
  const dirOf = (w1, w2) => (w1 === '' || w1 == null || w2 === '' || w2 == null ? '' : Number(w1) > Number(w2) ? 'In' : 'Out');
  const typeOf = x => dirOf(x.w1, x.w2);
  /** At the 2nd weigh: is a DN needed? Yes unless the scale now reads lighter than the 1st weigh (truck came in loaded). */
  const dnNeed = sel => { if (!sel) return false; const w = cur(); return !(w.kg != null && w.kg !== '' && dirOf(sel.w1, w.kg) === 'In'); };

  // ---------------------------------------------------------------- Apps Script
  const msgOf = e => { const s = String(e || 'Error'); const m = s.match(/^([A-Z_]+):\s*([\s\S]*)$/); const txt = m ? m[2] : s; const p = txt.split(' || '); return { code: m ? m[1] : '', text: t(p[1] || p[0], p[0]) }; };
  async function api(action, payload) {
    if (DEMO) return demoApi(action, payload || {});
    let data;
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: get(TOKEN_KEY), payload: payload || {} }) });
      data = await res.json();
    } catch (e) {
      throw Object.assign(new Error(t('មិនអាចភ្ជាប់អ៊ីនធឺណិត។ ទិន្នន័យនៅរក្សាក្នុងកុំព្យូទ័រ ហើយនឹងផ្ញើពេលមានអ៊ីនធឺណិត។', 'No internet. Data stays on this PC and is sent when the internet is back.')), { code: 'NET' });
    }
    if (!data.ok) { const m = msgOf(data.error); throw Object.assign(new Error(m.text), { code: m.code }); }
    if (data.session) set(TOKEN_KEY, data.session);
    return data.data;
  }
  function claims() {
    try { return JSON.parse(decodeURIComponent(escape(atob((get(TOKEN_KEY) || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch (e) { return null; }
  }
  const signedIn = () => { const c = claims(); return !!(c && c.exp * 1000 > Date.now() + 60000); };

  // ---------------------------------------------------------------- state (kept on this PC so it opens at once and works offline)
  let B = getJ('sc_boot', null);                 // trucks, customers, items, settings, recent tickets
  let LOC = getJ('sc_loc', {});                  // tickets made or changed here: cid -> ticket (until the server has them)
  let Q = getJ('sc_q', []);                      // cids waiting to be sent
  const saveLoc = () => { set('sc_loc', JSON.stringify(LOC)); set('sc_q', JSON.stringify(Q)); paintSync(); };
  const S = () => (B && B.settings) || {};
  const me = () => (B && B.user) || {};
  const isAdmin = () => !!me().admin;
  const canEdit = () => !!(me().admin || me().reviewer);
  const trucks = () => (B && B.trucks) || [];
  const truckOf = p => trucks().find(x => normP(x.plate) === normP(p)) || null;
  function tickets() {
    const map = {};
    ((B && B.tickets) || []).forEach(x => { map[x.cid || x.no] = x; });
    Object.keys(LOC).forEach(c => { map[c] = LOC[c]; });
    return Object.keys(map).map(k => map[k]);
  }
  const ticketBy = k => tickets().find(x => x.cid === k || x.no === k) || null;
  const openTickets = () => tickets().filter(x => x.status === 'Open').sort((a, b) => String(a.t1).localeCompare(String(b.t1)));

  // ---------------------------------------------------------------- the scale (Web Serial)
  const CONN_DEF = { baud: 9600, bits: 8, parity: 'none', stop: 1, fmt: 'auto', stableMs: 1500 };
  const conn = () => Object.assign({}, CONN_DEF, getJ('sc_conn', {}));
  const SER = { port: null, lastPort: null, reader: null, on: false, buf: '', raw: '', last: 0, bytes: 0, lastByte: 0, since: 0, err: '', finding: '', st: CORE.Stable(conn().stableMs) };
  const SIM = { on: false, target: 0, kg: 0, timer: 0 };
  let MANUAL = null;                             // { kg, reason } typed by an Admin, used for the next weigh only
  const hasSerial = () => 'serial' in navigator;

  async function serialStart(ask) {
    if (!hasSerial()) { SER.err = t('កម្មវិធីនេះមិនអាចភ្ជាប់ជញ្ជីងបានទេ។ សូមបើកក្នុង Chrome ឬ Edge លើកុំព្យូទ័រជញ្ជីង។', 'This browser cannot reach the scale. Open the app in Chrome or Edge on the scale PC.'); paintLcd(); return; }
    try {
      const ports = ask ? [] : await navigator.serial.getPorts();
      const port = ask ? await navigator.serial.requestPort() : (ports.indexOf(SER.lastPort) >= 0 ? SER.lastPort : ports[0]);
      if (!port) { paintLcd(); return; }
      await serialStop();
      const c = conn();
      await port.open({ baudRate: +c.baud, dataBits: +c.bits, parity: c.parity, stopBits: +c.stop, bufferSize: 4096 });
      SER.port = port; SER.lastPort = port; SER.on = true; SER.err = ''; SER.buf = ''; SER.since = Date.now(); SER.bytes = 0; SER.st.setMs(+c.stableMs || 1500); SER.st.reset();
      readLoop(port);
    } catch (e) {
      SER.err = /already open/i.test(e.message) ? t('ច្រកនេះកំពុងប្រើដោយកម្មវិធីផ្សេង (កម្មវិធីចាស់?)។ សូមបិទវាសិន។', 'The port is used by another program (the old scale software?). Close it first.')
        : /No port selected/i.test(e.message) ? '' : e.message;
    }
    paintLcd();
  }
  async function readLoop(port) {
    while (SER.port === port && port.readable) {
      const reader = port.readable.getReader();
      SER.reader = reader;
      try {
        for (;;) { const r = await reader.read(); if (r.done) break; onBytes(r.value); }
      } catch (e) { SER.err = e.message; }
      finally { try { reader.releaseLock(); } catch (e) { /* closed */ } }
      if (!SER.on) break;
    }
    if (SER.port === port) { SER.on = false; paintLcd(); }
  }
  async function serialStop() {
    const p = SER.port;
    SER.on = false; SER.port = null;
    if (SER.reader) { try { await SER.reader.cancel(); } catch (e) { /* gone */ } SER.reader = null; }
    if (p) { try { await p.close(); } catch (e) { /* gone */ } }
  }
  function onBytes(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    SER.raw = (SER.raw + s).slice(-300);
    SER.bytes += u8.length; SER.lastByte = Date.now();
    SER.buf += s;
    const r = CORE.parse(SER.buf, conn().fmt);
    SER.buf = r.rest;
    r.weights.forEach(w => { if (!SIM.on) SER.st.push(w.kg, w.stable); });
    if (r.weights.length) SER.last = Date.now();
    lcdSoon();
  }
  if (hasSerial()) navigator.serial.addEventListener('disconnect', e => { if (e.target === SER.port) { serialStop(); SER.err = t('ខ្សែជញ្ជីងត្រូវបានដក។', 'The scale cable was unplugged.'); paintLcd(); } });

  function simStart() {
    SIM.on = true; SER.st.reset();
    clearInterval(SIM.timer);
    SIM.timer = setInterval(() => {
      const d = SIM.target - SIM.kg;
      SIM.kg = Math.abs(d) < 30 ? SIM.target : SIM.kg + Math.round(d * 0.35 / 10) * 10 + (Math.random() < .5 ? -10 : 10);
      SER.st.push(SIM.kg); SER.last = Date.now(); lcdSoon();
    }, 200);
  }
  function simStop() { SIM.on = false; clearInterval(SIM.timer); SER.st.reset(); lcdSoon(); }

  /** The weight to use now: { kg, stable, src, ok } — ok only when stable and above the minimum. */
  function cur() {
    if (MANUAL) return { kg: MANUAL.kg, stable: true, src: 'Manual', ok: true };
    const live = SIM.on || (SER.on && Date.now() - SER.last < 3000);
    const w = live ? SER.st.kg : null;
    const stable = live && SER.st.isStable();
    const min = Number(S().SCALE_MIN_KG) || 200;
    return { kg: w, stable, src: SIM.on ? 'Simulator' : 'Scale', ok: stable && w != null && w >= min, live };
  }

  // ---------------------------------------------------------------- offline queue
  let flushing = false;
  async function flush() {
    if (flushing || !Q.length) { paintSync(); return; }
    flushing = true;
    let sent = 0;
    try {
      for (const cid of Q.slice()) {
        const tk = LOC[cid];
        if (!tk) { Q = Q.filter(c => c !== cid); continue; }
        if (tk.err) continue;
        const op = Object.assign({}, tk);
        delete op.err; delete op.synced; delete op.pdf;   // pdf here is the Drive link; the file itself is sent only once
        const pdf = get('sc_pdf_' + cid);
        if (pdf) op.pdf = pdf;
        try {
          const r = await api('scSave', { ops: [op] });
          const s = (r.saved || [])[0] || {};
          const now = LOC[cid];
          if (now) { now.no = s.no || now.no; if (s.pdf) now.pdf = s.pdf; now.synced = Date.now(); }
          // a newer change made while sending stays queued
          if (!now || now.v === op.v) Q = Q.filter(c => c !== cid);
          if (pdf && get('sc_pdf_' + cid) === pdf) set('sc_pdf_' + cid, null);
          sent++;
          saveLoc();
        } catch (e) {
          if (['NET', 'BUSY', 'SERVER', 'AUTH'].indexOf(e.code) >= 0) break;
          LOC[cid].err = e.message;
          Q = Q.filter(c => c !== cid);
          saveLoc();
          toast(e.message);
        }
      }
    } finally { flushing = false; paintSync(); }
    if (sent) { paintLists(); refresh(true).catch(() => {}); if (Q.some(c => LOC[c] && !LOC[c].err)) setTimeout(flush, 300); }
  }
  function putTicket(tk) {
    delete tk.err;
    tk.v = (Number(tk.v) || 0) + 1;
    LOC[tk.cid] = tk;
    if (Q.indexOf(tk.cid) < 0) Q.push(tk.cid);
    saveLoc();
    flush();
  }
  window.addEventListener('online', () => flush());
  setInterval(() => flush(), 60000);
  function paintSync() {
    const d = $('#syncDot');
    if (!d) return;
    const errs = Object.keys(LOC).filter(c => LOC[c].err).length;
    d.hidden = !Q.length && !errs;
    d.className = 'syncdot' + (errs ? ' bad' : '');
    d.textContent = errs ? '⚠ ' + errs : '⏳ ' + Q.length;
    d.title = errs ? t('ប័ណ្ណមិនបានរក្សាទុក', 'Tickets not saved') : t('កំពុងរង់ចាំផ្ញើ', 'Waiting to send');
  }

  // ---------------------------------------------------------------- data refresh
  let lastBoot = '';
  async function refresh(quiet) {
    try {
      const d = await api('scBoot');
      const json = JSON.stringify(d);
      if (quiet === true && json === lastBoot) return;
      lastBoot = json;
      B = d;
      set('sc_boot', json);
      // tickets the server has now are no longer needed here
      const have = {};
      (d.tickets || []).forEach(x => { if (x.cid) have[x.cid] = x; });
      Object.keys(LOC).forEach(c => { const l = LOC[c]; if (l.synced && Q.indexOf(c) < 0 && (have[c] || Date.now() - l.synced > 4 * 86400000)) delete LOC[c]; });
      saveLoc();
      paintTabs();
      if (quiet === true) { paintLists(); if (/^#\/?set/.test(location.hash) && !document.activeElement.closest('input,select,textarea')) route(); }
      else route();
    } catch (e) {
      if (e.code === 'AUTH' || e.code === 'NOACCESS') { set('sc_boot', null); B = null; showBlocked(e); return; }
      if (!B) { $('#view').innerHTML = `<div class="card"><div class="alert bad">${esc(e.message)}</div><button class="btn mt" id="retry">${t('ព្យាយាមម្តងទៀត', 'Try again')}</button></div>`; $('#retry').onclick = () => refresh(); }
      else if (quiet !== true) toast(e.message);
    }
  }
  function paintStatic() { $$('[data-km]').forEach(el => { el.textContent = t(el.dataset.km, el.dataset.en); }); }
  function paintTabs() { const st = $('.tab[data-r="set"]'); if (st) st.hidden = !isAdmin(); }

  // ---------------------------------------------------------------- router
  let screen = () => {};
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const top = h.split('/')[0] || 'home';
    $$('.tab[data-r]').forEach(a => a.classList.toggle('on', top === a.dataset.r || (top === 't' && a.dataset.r === 'list')));
    if (!B) { $('#view').innerHTML = '<div class="spinner"></div>'; screen = route; return; }
    if (top === 'list') return renderList();
    if (top === 't') return renderTicket(decodeURIComponent(h.slice(2)));
    if (top === 'set') return isAdmin() ? renderSettings(h.split('/')[1] || 'trucks') : (location.hash = '#/');
    return renderHome();
  }
  window.addEventListener('hashchange', route);

  // ---------------------------------------------------------------- pickers (search, "+ Add new", like the Fuel app)
  function picker(input, opts) {
    const box = document.createElement('div');
    box.className = 'sugg'; box.hidden = true;
    input.parentNode.classList.add('search');
    input.parentNode.appendChild(box);
    let items = [], at = -1;
    const norm = s => String(s || '').toLowerCase().replace(/[\s\-.]/g, '');
    function paint() {
      const q = norm(input.value);
      const all = opts.list();
      items = all.filter(x => !q || norm(x.v).indexOf(q) >= 0 || norm(x.sub).indexOf(q) >= 0).slice(0, 40);
      const exact = all.some(x => norm(x.v) === q);
      const fx = opts.fix || (v => v);
      const add = opts.addNew && q && !exact ? fx(input.value.trim()) : '';
      box.innerHTML = items.map((x, i) => `<div class="opt${i === at ? ' on' : ''}" data-i="${i}"><span>${esc(x.v)}</span>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</div>`).join('') +
        (add ? `<div class="opt add" data-add="1"><span>＋ ${t('បន្ថែមថ្មី', 'Add new')}: <b>${esc(add)}</b></span></div>` : '') +
        (!items.length && !add ? `<div class="opt none">${t('រកមិនឃើញ', 'No match')}</div>` : '');
      box.hidden = false;
    }
    const pick = v => { if (opts.fix && !opts.list().some(x => x.v === v)) v = opts.fix(v); if (!v) { input.value = ''; box.hidden = true; return; } input.value = v; box.hidden = true; at = -1; opts.onPick(v); };
    input.addEventListener('focus', () => { at = -1; paint(); });
    input.addEventListener('input', () => { at = -1; paint(); opts.onType && opts.onType(input.value); });
    input.addEventListener('keydown', e => {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { at = Math.min(items.length - 1, at + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { at = Math.max(0, at - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (at >= 0 && items[at]) pick(items[at].v); else if (items.length === 1) pick(items[0].v); else if (opts.addNew && input.value.trim()) pick(input.value.trim()); }
      else if (e.key === 'Escape') box.hidden = true;
    });
    box.addEventListener('mousedown', e => {
      const o = e.target.closest('.opt');
      if (!o || o.classList.contains('none')) return;
      e.preventDefault();
      if (o.dataset.add) pick(input.value.trim()); else pick(items[+o.dataset.i].v);
    });
    input.addEventListener('blur', () => setTimeout(() => {
      box.hidden = true;
      const v = input.value.trim();
      if (!v) { opts.onPick(''); return; }
      const hit = opts.list().find(x => norm(x.v) === norm(v));
      if (hit) { if (hit.v !== v) input.value = hit.v; opts.onPick(hit.v); }
      else if (opts.addNew) { const f = opts.fix ? opts.fix(v) : v; input.value = f; opts.onPick(f); }
      else { input.value = ''; opts.onPick(''); }
    }, 120));
  }

  // ---------------------------------------------------------------- weigh screen
  const EMPTY_F = () => ({ cid: '', plate: '', company: '', customer: '', item: '', type: '', dns: [], driver: '', dest: '', note: '' });
  /** Truck plates written one way (Kim, 6 Nov 2026): 3A1234 or 3ab1234 becomes 3A-1234 / 3AB-1234. */
  function fixPlate(v) {
    const s = String(v || '').toUpperCase().replace(/[\s\-.]/g, '');
    const m = s.match(/^(\d{0,2}[A-Z]{1,3})(\d{3,5})$/);
    return m ? m[1] + '-' + m[2] : String(v || '').toUpperCase().trim();
  }
  /** A new 3PL company is typed in English capital letters only (Kim, 6 Nov 2026). */
  const fixCompany = v => String(v || '').toUpperCase().replace(/[^A-Z0-9 &.,()\-\/]/g, '').replace(/\s+/g, ' ').trim();
  let F = getJ('sc_form', null) || EMPTY_F();
  let SITEQ = '';                                // search over the trucks waiting for the 2nd weigh (Kim, 6 Nov 2026)
  let PENDING = null;                            // 2nd weigh waiting for "Save anyway" after a warning
  let LASTDONE = '';                             // cid of the ticket just finished, shown under the buttons
  const keepForm = () => set('sc_form', JSON.stringify(F));

  function renderHome() {
    screen = renderHome;
    document.body.classList.add('wide');
    const sel = F.cid ? ticketBy(F.cid) : null;
    if (F.cid && (!sel || sel.status !== 'Open')) { F = EMPTY_F(); keepForm(); }
    $('#view').innerHTML = `
      <section class="lcd" id="lcd"></section>
      <div class="grid2">
        <section class="card" id="formCard"></section>
        <section class="card">
          <h2>🚚 ${t('ឡានកំពុងរង់ចាំថ្លឹងលើកទី២', 'On site, waiting for 2nd weigh')} <span class="cnt" id="siteCnt"></span></h2>
          <input type="search" class="in sitesearch" id="siteQ" data-live-ok autocomplete="off" placeholder="🔍 ${t('ស្វែងរកលេខឡាន', 'Search truck number')}" value="${esc(SITEQ)}">
          <div id="site"></div>
        </section>
      </div>
      <section class="card">
        <div class="head2"><h2>📋 ${t('ថ្ងៃនេះ', 'Today')} <span class="cnt" id="todayCnt"></span></h2><a class="btn" href="#/list">${t('មើលទាំងអស់', 'All tickets')}</a></div>
        <div id="todayList"></div>
      </section>`;
    $('#siteQ').oninput = e => { SITEQ = e.target.value; paintLists(); };
    paintForm(); paintLcd(); paintLists();
  }

  function paintForm() {
    const card = $('#formCard');
    if (!card) return;
    const sel = F.cid ? ticketBy(F.cid) : null;
    const tr = truckOf(F.plate);
    const lastT = B && B.lastTare && F.plate ? B.lastTare[normP(F.plate)] : null;
    const need = v => (v ? '' : ' need');
    const req = '<span class="req">*</span>';
    card.innerHTML = `
      <h2>${sel ? '⚖️ ' + t('ថ្លឹងលើកទី២', '2nd weigh') + ' · <span class="mono">' + esc(sel.no) + '</span>' : '🆕 ' + t('ថ្លឹងថ្មី (លើកទី១)', 'New weighing (1st weigh)')}
        ${sel ? `<button type="button" class="btn newtruck" id="newBtn">➕ ${t('ឡានថ្មី', 'New truck')}</button>` : ''}</h2>
      <div class="fgrid">
        <div class="field"><label class="f">${t('លេខឡាន', 'Truck No')} ${req}</label><div><input class="in${need(F.plate)}" id="fPlate" autocomplete="off" value="${esc(F.plate)}" placeholder="3B-5956"></div>
          ${tr ? `<div class="hint">${tr.type ? esc(tr.type) + ' · ' : ''}${t('ទម្ងន់ទទេ', 'Empty')} ${tr.empty !== '' ? kg(tr.empty) + ' kg' : '—'} · ${t('កំណត់អតិបរមា', 'Max')} ${tr.max !== '' ? kg(tr.max) + ' kg' : '—'}${lastT ? ' · ' + t('ចុងក្រោយ', 'Last') + ' ' + kg(lastT) + ' kg' : ''}</div>`
            : F.plate ? `<div class="hint">🆕 ${t('ឡានថ្មី នឹងបន្ថែមក្នុងបញ្ជីឡាន', 'New truck: it will be added to the truck list')}</div>` : ''}</div>
        <div class="field"><label class="f">${t('ក្រុមហ៊ុនឡាន (3PL)', 'Truck company (3PL)')}</label><div><input class="in" id="fCompany" autocomplete="off" autocapitalize="characters" value="${esc(F.company)}"></div>
          <div class="hint">${t('ក្រុមហ៊ុនថ្មី: អក្សរអង់គ្លេសធំប៉ុណ្ណោះ', 'New company: English capital letters only')}</div></div>
        <div class="field"><label class="f">${t('ទំនិញ', 'Item')} ${req}</label><div><input class="in${need(F.item)}" id="fItem" autocomplete="off" value="${esc(F.item)}"></div></div>
        <div class="field"><label class="f">${t('គោលដៅ', 'Destination')}</label><div><input class="in" id="fDest" autocomplete="off" value="${esc(F.dest)}"></div></div>
        ${sel ? `<div class="field span2"><label class="f">${t('លេខ DN (បានច្រើន)', 'DN No (one or more)')}${dnNeed(sel) ? ' ' + req : ''}</label>
          <div class="dnbox in${dnNeed(sel) && !F.dns.length ? ' need' : ''}" id="dnBox">${F.dns.map((d, i) => `<span class="dn">${esc(d)}<button type="button" data-dn="${i}" aria-label="Remove">×</button></span>`).join('')}
            <input id="fDn" autocomplete="off" inputmode="text" placeholder="${t('វាយ ឬស្កេន DN ហើយចុច Enter', 'Type or scan a DN, press Enter')}"></div></div>` : ''}
        <div class="field span2"><label class="f">${t('កំណត់ចំណាំ', 'Note')}</label><input class="in" id="fNote" autocomplete="off" value="${esc(F.note)}"></div>
      </div>
      <div id="warnBox"></div>
      <div class="btns">
        ${sel ? `<button type="button" class="btn ok big" id="w2Btn">⚖️ ${t('ថ្លឹងលើកទី២ + រក្សាទុក', 'Weigh 2nd + Save')}</button>
                 <button type="button" class="btn" id="saveOpen">💾 ${t('រក្សាទុកការកែ', 'Save changes')}</button>`
              : `<button type="button" class="btn ok big" id="w1Btn">⚖️ ${t('ថ្លឹងលើកទី១', 'Weigh 1st')}</button>`}
      </div>
      ${isAdmin() ? `<div class="manual">${MANUAL ? `<div class="alert bad">✍ ${t('ទម្ងន់វាយដោយដៃ', 'Typed weight')}: <b>${kg(MANUAL.kg)} kg</b> · ${esc(MANUAL.reason)} <button type="button" class="link" id="manOff">${t('បោះបង់', 'Cancel')}</button></div>`
        : `<button type="button" class="link" id="manOn">✍ ${t('វាយទម្ងន់ដោយដៃ (Admin)', 'Type a weight (Admin)')}</button>`}<div id="manBox"></div></div>` : ''}
      <div id="doneBox">${LASTDONE && !sel ? doneHtml(ticketBy(LASTDONE)) : ''}</div>`;

    const upd = (k, v) => { F[k] = v; keepForm(); };
    picker($('#fPlate'), {
      list: () => trucks().map(x => ({ v: x.plate, sub: [x.company, x.type].filter(Boolean).join(' · ') })), addNew: true, fix: fixPlate,
      onPick: v => { const was = F.plate; upd('plate', v ? fixPlate(v) : ''); const tr2 = truckOf(v); if (tr2 && was !== F.plate) { F.company = tr2.company || F.company; if (tr2.drivers.length === 1) F.driver = tr2.drivers[0]; keepForm(); } paintForm(); },
    });
    const companies = () => { const s = []; trucks().forEach(x => { if (x.company && s.indexOf(x.company) < 0) s.push(x.company); }); return s.sort().map(v => ({ v })); };
    picker($('#fCompany'), { list: companies, addNew: true, fix: fixCompany, onPick: v => upd('company', v) });
    picker($('#fItem'), { list: () => ((B && B.items) || []).filter(i => i[2] !== 'No').map(i => ({ v: i[0], sub: i[1] })), addNew: true, onPick: v => { upd('item', v); $('#fItem').classList.toggle('need', !v); } });
    picker($('#fDest'), { list: () => ((B && B.dests) || []).map(v => ({ v })), addNew: true, onPick: v => upd('dest', v) });
    $('#fNote').oninput = e => upd('note', e.target.value);
    const addDn = raw => {
      String(raw || '').split(/[\s,;]+/).map(s => s.replace(/[^0-9A-Za-z\-\/]/g, '')).filter(Boolean).forEach(d => { if (F.dns.indexOf(d) < 0 && F.dns.length < 30) F.dns.push(d); });
      keepForm(); paintForm(); setTimeout(() => $('#fDn') && $('#fDn').focus(), 0);
    };
    const dn = $('#fDn');
    if (dn) {
    dn.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab' || e.key === ' ') { if (dn.value.trim()) { e.preventDefault(); addDn(dn.value); } }
      else if (e.key === 'Backspace' && !dn.value && F.dns.length) { F.dns.pop(); keepForm(); paintForm(); setTimeout(() => $('#fDn').focus(), 0); }
    };
    dn.onblur = () => { if (dn.value.trim()) addDn(dn.value); };
    dn.addEventListener('paste', e => { const s = (e.clipboardData || window.clipboardData).getData('text'); if (/[\s,;]/.test(s.trim())) { e.preventDefault(); addDn(s); } });
    $('#dnBox').onclick = e => { const x = e.target.closest('[data-dn]'); if (x) { F.dns.splice(+x.dataset.dn, 1); keepForm(); paintForm(); } else dn.focus(); };
    }
    if ($('#newBtn')) $('#newBtn').onclick = () => { F = EMPTY_F(); keepForm(); PENDING = null; paintForm(); paintLcd(); };
    if ($('#w1Btn')) $('#w1Btn').onclick = weigh1;
    if ($('#w2Btn')) $('#w2Btn').onclick = () => weigh2(false);
    if ($('#saveOpen')) $('#saveOpen').onclick = saveOpen;
    if ($('#manOn')) $('#manOn').onclick = () => {
      $('#manBox').innerHTML = `<div class="manform"><input class="in" id="manKg" inputmode="numeric" placeholder="kg"><input class="in" id="manWhy" placeholder="${t('មូលហេតុ (ចាំបាច់)', 'Reason (required)')}"><button type="button" class="btn ok" id="manUse">${t('ប្រើ', 'Use')}</button></div>`;
      $('#manUse').onclick = () => {
        const v = Number(String($('#manKg').value).replace(/[^0-9.]/g, '')), why = $('#manWhy').value.trim();
        if (!(v > 0)) { $('#manKg').classList.add('need'); return; }
        if (!why) { $('#manWhy').classList.add('need'); return; }
        MANUAL = { kg: Math.round(v), reason: why }; paintForm(); paintLcd();
      };
    };
    if ($('#manOff')) $('#manOff').onclick = () => { MANUAL = null; paintForm(); paintLcd(); };
    bindDone();
    paintWarn();
    paintButtons();
  }

  function formOk(second) {
    const miss = [];
    if (!F.plate) miss.push('#fPlate');
    if (!F.item) miss.push('#fItem');
    if (second && !F.dns.length) {   // DN needed only when the truck leaves loaded (Out)
      if (dnNeed(ticketBy(F.cid)) || !ticketBy(F.cid)) miss.push('#dnBox');
    }
    miss.forEach(s => $(s) && $(s).classList.add('need'));
    if (miss.length) { toast(t('សូមបំពេញប្រអប់ពណ៌ក្រហម', 'Fill in the red boxes')); return false; }
    return true;
  }
  const fromForm = () => ({ plate: F.plate, company: F.company, customer: F.customer, item: F.item, type: F.type, dns: F.dns.slice(), driver: F.driver, dest: F.dest, note: F.note });

  function weigh1() {
    if (!formOk(false)) return;
    const w = cur();
    if (!w.ok) { toast(w.live ? t('សូមរង់ចាំទម្ងន់ឈប់ (STABLE)', 'Wait until the weight is STABLE') : t('មិនទាន់មានទម្ងន់ពីជញ្ជីង', 'No weight from the scale yet')); return; }
    if (openTickets().some(x => normP(x.plate) === normP(F.plate))) { toast(t('ឡាននេះកំពុងរង់ចាំថ្លឹងលើកទី២ហើយ។ សូមរើសពីបញ្ជីខាងស្តាំ។', 'This truck is already waiting for its 2nd weigh. Pick it from the list on the right.')); return; }
    const known = tickets().map(x => x.no);
    const tk = Object.assign(fromForm(), { cid: uid(), no: CORE.nextNo(S().SCALE_PREFIX || 'WB', new Date(), known), status: 'Open',
      w1: w.kg, t1: iso(new Date()), s1: w.src, w2: '', t2: '', s2: '', warn: '', op: me().name || '', reason: w.src === 'Manual' ? MANUAL.reason : '' });
    putTicket(tk);
    MANUAL = null; LASTDONE = '';
    F = EMPTY_F(); keepForm();
    toast('✅ ' + tk.no + ' · ' + t('លើកទី១', '1st') + ' ' + kg(tk.w1) + ' kg');
    paintForm(); paintLists(); paintLcd();
  }

  function saveOpen() {
    const sel = ticketBy(F.cid);
    if (!sel || !formOk(false)) return;
    putTicket(Object.assign({}, sel, fromForm()));
    toast(t('បានរក្សាទុក', 'Saved'));
    paintLists();
  }

  function weigh2(force) {
    const sel = ticketBy(F.cid);
    if (!sel || !formOk(true)) return;
    const w = cur();
    if (!w.ok) { toast(w.live ? t('សូមរង់ចាំទម្ងន់ឈប់ (STABLE)', 'Wait until the weight is STABLE') : t('មិនទាន់មានទម្ងន់ពីជញ្ជីង', 'No weight from the scale yet')); return; }
    const f = CORE.finish(Number(sel.w1), w.kg, truckOf(F.plate), S().SCALE_TARE_PCT);
    if (f.warn.length && !force) { PENDING = { kg: w.kg, src: w.src, warn: f.warn }; paintWarn(); return; }
    const use = force && PENDING ? PENDING : { kg: w.kg, src: w.src, warn: f.warn };
    const g = CORE.finish(Number(sel.w1), use.kg, truckOf(F.plate), S().SCALE_TARE_PCT);
    const reason = [sel.reason, use.src === 'Manual' && MANUAL ? MANUAL.reason : ''].filter(Boolean).join(' · ');
    const tk = Object.assign({}, sel, fromForm(), { type: dirOf(sel.w1, use.kg), status: 'Done', w2: use.kg, t2: iso(new Date()), s2: use.src, gross: g.gross, tare: g.tare, net: g.net,
      warn: g.warn.map(x => x.en).join(' | '), reason: reason });
    PENDING = null; MANUAL = null;
    putTicket(tk);
    LASTDONE = tk.cid;
    F = EMPTY_F(); keepForm();
    paintForm(); paintLists(); paintLcd();
    // The PDF (from the Word template when there is one, else the built-in ticket) goes up to Drive with the ticket.
    bestPdf(tk).then(b64 => { if (b64 && set('sc_pdf_' + tk.cid, b64) && LOC[tk.cid]) { LOC[tk.cid].v = (Number(LOC[tk.cid].v) || 0) + 1; if (Q.indexOf(tk.cid) < 0) Q.push(tk.cid); saveLoc(); flush(); } }).catch(() => {});
    if (get('sc_autoprint') === '1') printTicket(tk);
  }

  function paintWarn() {
    const box = $('#warnBox');
    if (!box) return;
    if (!PENDING) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="alert warn big">${PENDING.warn.map(x => `<div>⚠️ ${esc(t(x.km, x.en))}</div>`).join('')}
      <div class="btns"><button type="button" class="btn" id="wCancel">${t('បោះបង់ ហើយពិនិត្យ', 'Cancel and check')}</button><button type="button" class="btn warnbtn" id="wForce">${t('រក្សាទុកដដែល', 'Save anyway')}</button></div></div>`;
    $('#wCancel').onclick = () => { PENDING = null; paintWarn(); };
    $('#wForce').onclick = () => weigh2(true);
  }

  function doneHtml(tk) {
    if (!tk) return '';
    return `<div class="donebox"><div><b>✅ ${esc(tk.no)}</b> · ${esc(tk.plate)} · ${t('សុទ្ធ', 'Net')} <b>${kg(tk.net)} kg</b>${tk.warn ? ` <span class="badge pending">⚠️ ${t('មានការព្រមាន', 'Warning')}</span>` : ''}</div>
      <div class="btns"><button type="button" class="btn ok" data-print="${esc(tk.cid)}">🖨 ${t('បោះពុម្ព', 'Print')}</button><button type="button" class="btn" data-pdf="${esc(tk.cid)}">📄 PDF</button></div></div>`;
  }
  function bindDone() {
    $$('[data-print]').forEach(b => { b.onclick = () => { const tk = ticketBy(b.dataset.print); if (tk) printTicket(tk); }; });
    $$('[data-pdf]').forEach(b => { b.onclick = async () => { const tk = ticketBy(b.dataset.pdf); if (!tk) return; busy(b, true); try { await downloadPdf(tk); } catch (e) { toast(e.message); } busy(b, false); }; });
  }

  let lcdRaf = 0;
  const lcdSoon = () => { if (!lcdRaf) lcdRaf = requestAnimationFrame(() => { lcdRaf = 0; paintLcd(); }); };
  function paintLcd() {
    const el = $('#lcd');
    if (el) {
      const w = cur();
      const state = MANUAL ? ['manual', '✍ ' + t('វាយដោយដៃ', 'TYPED')] : !w.live ? ['off', SER.on ? t('គ្មានសញ្ញា', 'NO SIGNAL') : t('មិនទាន់ភ្ជាប់', 'NOT CONNECTED')]
        : w.stable ? ['ok', 'STABLE'] : ['move', t('កំពុងរំកិល', 'MOVING')];
      el.className = 'lcd ' + state[0];
      const num = `${w.kg != null ? kg(w.kg) : '-----'}<span>kg</span>`;
      // At the 2nd weigh (a waiting truck is picked): live weight, 1st weight and net side by side (Kim's option C).
      const sel = ticketBy(F.cid);
      let nums = `<div class="num">${num}</div>`;
      if (sel && sel.status === 'Open' && sel.w1 !== '' && sel.w1 != null) {
        const w1 = Number(sel.w1), has = w.kg != null, liveGross = !has || w.kg >= w1;
        const G = t('ទម្ងន់សរុប', 'Gross'), T = t('ឡានទទេ', 'Tare');
        nums = `<div class="cell"><div class="lab">${t('ទម្ងន់ឥឡូវ (លើកទី២)', 'Now (2nd weigh)')}</div><div class="num">${num}</div><div class="sub">${liveGross ? G : T}</div></div>
          <div class="cell"><div class="lab">${t('ទម្ងន់លើកទី១', '1st weigh')}</div><div class="num n1">${kg(w1)}</div><div class="sub">${liveGross ? T : G} · ${hm(sel.t1)}${sel.s1 && sel.s1 !== 'Scale' ? ' · ' + esc(sel.s1) : ''}</div></div>
          <div class="cell net"><div class="lab">${t('ទម្ងន់សុទ្ធ', 'Net')}</div><div class="num nn">${has ? kg(Math.abs(w.kg - w1)) : '-----'}</div><div class="sub">${has ? typeName(dirOf(w1, w.kg)) : '&nbsp;'}</div></div>`;
      }
      const side = `<div class="side"><span class="st">${state[1]}</span>
          <span>${SIM.on ? '🧪 ' + t('ម៉ាស៊ីនសាកល្បង', 'Simulator') : SER.on ? '🔌 ' + t('ភ្ជាប់ជញ្ជីង', 'Scale connected') + ' · ' + conn().baud : ''}</span>
          ${SER.finding ? `<span class="err">🔍 ${esc(SER.finding)}</span>` : SER.on && !w.live && !SIM.on && Date.now() - SER.since > 3000 ? `<span class="err">${esc(noSignalWhy())}</span>` : ''}
          <div class="lcdbtns">
          ${!SER.on && !SIM.on && !MANUAL ? `<button type="button" class="btn conn" id="connBtn">🔌 ${t('ភ្ជាប់ជញ្ជីង', 'Connect scale')}</button>` : ''}
          ${!SER.on && !SIM.on && SER.lastPort ? `<button type="button" class="btn conn2" id="reconBtn">🔄 ${t('ភ្ជាប់ឡើងវិញ', 'Reconnect')}</button>` : ''}
          ${SER.on && !SER.finding ? `<button type="button" class="btn conn2" id="reconBtn">🔄 ${t('ភ្ជាប់ឡើងវិញ', 'Reconnect')}</button><button type="button" class="btn conn2" id="offBtn">⏏ ${t('ផ្តាច់', 'Disconnect')}</button>` : ''}
          ${SER.on && !w.live && !SIM.on && !SER.finding && Date.now() - SER.since > 3000 ? `<button type="button" class="btn conn" id="findBtn">🔍 ${t('រកការកំណត់ដោយខ្លួនឯង', 'Find settings')}</button>` : ''}
          </div>
          ${SER.err ? `<span class="err">${esc(SER.err)}</span>` : ''}</div>`;
      // only the number changes many times a second; the buttons are drawn again only when they change, so clicks are not lost
      if (el._side === side && el.querySelector('.nums')) { const n = el.querySelector('.nums'); if (n._h !== nums) { n._h = nums; n.innerHTML = nums; } paintButtons(); return paintRaw(); }
      el._side = side;
      el.innerHTML = `<div class="nums">${nums}</div>` + side;
      el.querySelector('.nums')._h = nums;
      const cb = $('#connBtn');
      if (cb) cb.onclick = () => serialStart(true);
      if ($('#reconBtn')) $('#reconBtn').onclick = () => serialStart(false);
      if ($('#offBtn')) $('#offBtn').onclick = () => serialStop().then(paintLcd);
      if ($('#findBtn')) $('#findBtn').onclick = findSettings;
    }
    paintButtons();
    paintRaw();
  }
  function paintRaw() {
    const raw = $('#rawBox');
    if (raw) { raw.textContent = SER.raw.replace(/[\x00-\x1f]/g, c => c === '\n' ? '⏎\n' : c === '\r' ? '' : '[' + c.charCodeAt(0).toString(16).padStart(2, '0') + ']') || '—'; const pw = $('#rawKg'); if (pw) pw.textContent = SER.st.kg == null ? '—' : kg(SER.st.kg) + ' kg' + (SER.st.isStable() ? ' · STABLE' : ''); }
  }
  /** Why there is no weight: nothing arrives, or something arrives that can't be read. */
  function noSignalWhy() {
    if (!SER.bytes || Date.now() - SER.lastByte > 3000) return t('គ្មានទិន្នន័យពីជញ្ជីងទេ។ ពិនិត្យខ្សែ ច្រក COM ឬការកំណត់ផ្ញើទិន្នន័យលើក្បាលជញ្ជីង។', 'Nothing is coming from the scale. Check the cable, the COM port, or the indicator\'s output setting.');
    return t('មានទិន្នន័យមក តែអានមិនបាន។ ចុច "រកការកំណត់"។', 'Data is coming but can\'t be read. Press "Find settings".');
  }
  /** Tries the usual Keli settings one by one until a weight is read (about 2.5 s each). */
  async function findSettings() {
    const tries = [];
    [9600, 4800, 2400, 1200, 19200].forEach(b => { tries.push({ baud: b, bits: 8, parity: 'none', stop: 1 }); });
    [9600, 4800, 2400, 1200].forEach(b => { tries.push({ baud: b, bits: 7, parity: 'even', stop: 1 }); });
    const keep = conn();
    for (let i = 0; i < tries.length; i++) {
      const c = Object.assign({}, keep, tries[i], { fmt: 'auto' });
      SER.finding = t('កំពុងសាក', 'Trying') + ' ' + c.baud + ' ' + c.bits + (c.parity === 'none' ? 'N' : 'E') + '1 (' + (i + 1) + '/' + tries.length + ')';
      set('sc_conn', JSON.stringify(c));
      await serialStart(false);
      const t0 = Date.now();
      while (Date.now() - t0 < 2500 && !(SER.last > t0)) await new Promise(r => setTimeout(r, 200));
      if (SER.last > t0) {
        SER.finding = '';
        toast('✅ ' + t('រកឃើញ', 'Found') + ': ' + c.baud + ' ' + c.bits + (c.parity === 'none' ? 'N' : 'E') + '1');
        paintLcd(); if (/^#\/?set\/scale/.test(location.hash)) setScale();
        return;
      }
    }
    SER.finding = '';
    set('sc_conn', JSON.stringify(keep));
    await serialStart(false);
    toast(t('រកមិនឃើញ។ សូមផ្ញើរូបប្រអប់ "ទិន្នន័យពីជញ្ជីង" ក្នុង ការកំណត់ › ការភ្ជាប់ជញ្ជីង មក Claude។', 'Not found. Send Claude a screenshot of "Data from the scale" in Settings › Scale connection.'));
  }
  function paintButtons() {
    const w = cur();
    const b1 = $('#w1Btn'), b2 = $('#w2Btn');
    if (b1) b1.classList.toggle('wait', !w.ok);
    if (b2) b2.classList.toggle('wait', !w.ok);
    const sel = F.cid ? ticketBy(F.cid) : null;
    if (sel && $('#w2now')) {
      $('#w2now').textContent = w.kg != null ? kg(w.kg) : '—';
      $('#netNow').textContent = w.kg != null ? kg(Math.abs(w.kg - Number(sel.w1))) : '—';
    }
  }

  function paintLists() {
    if ($('#site')) {
      const all = openTickets();
      const q = String(SITEQ || '').toLowerCase().replace(/[\s\-.]/g, '');
      const open = q ? all.filter(x => [x.plate, x.company].join(' ').toLowerCase().replace(/[\s\-.]/g, '').indexOf(q) >= 0) : all;
      $('#siteCnt').textContent = all.length ? '(' + (q ? open.length + ' / ' : '') + all.length + ')' : '';
      $('#site').innerHTML = q && all.length && !open.length ? `<div class="empty">${t('រកមិនឃើញ', 'No match')}</div>` : open.length ? `<div class="tbl"><table><tr><th>${t('ឡាន', 'Truck')}</th><th>DN</th><th>${t('ចូល', 'In')}</th><th class="r">${t('លើកទី១', '1st')}</th><th>${t('រង់ចាំ', 'Wait')}</th></tr>
        ${open.map(x => { const m = Math.round((Date.now() - new Date(x.t1)) / 60000); return `<tr class="pick${x.cid === F.cid ? ' on' : ''}${x.err ? ' errrow' : ''}" data-open="${esc(x.cid)}"><td><b>${esc(x.plate)}</b><small>${esc(x.company || '')}</small></td><td>${x.dns && x.dns.length ? x.dns.length : '<span class="need-t">0</span>'}</td><td>${hm(x.t1)}</td><td class="r mono">${kg(x.w1)}</td><td><span class="badge ${m > 120 ? 'pending' : 'approved'}">${m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad(m % 60)}</span></td></tr>`; }).join('')}</table></div>
        <p class="hint">${t('ចុចលើឡាន ដើម្បីថ្លឹងលើកទី២', 'Tap a truck to load it for the 2nd weigh')}</p>`
        : `<div class="empty">${t('គ្មានឡានរង់ចាំ', 'No truck waiting')}</div>`;
      $$('[data-open]').forEach(r => { r.onclick = () => { const x = ticketBy(r.dataset.open); if (!x) return; F = { cid: x.cid, plate: x.plate, company: x.company || '', customer: x.customer || '', item: x.item || '', type: x.type || '', dns: (x.dns || []).slice(), driver: x.driver || '', dest: x.dest || '', note: x.note || '' }; keepForm(); PENDING = null; LASTDONE = ''; paintForm(); paintLists(); paintLcd(); window.scrollTo(0, 0); }; });
    }
    if ($('#todayList')) {
      const td = today();
      const list = tickets().filter(x => x.status !== 'Open' && String(x.t2 || x.t1).slice(0, 10) === td).sort((a, b) => String(b.t2).localeCompare(String(a.t2)));
      const done = list.filter(x => x.status === 'Done');
      $('#todayCnt').textContent = done.length ? '· ' + done.length + ' ' + t('ប័ណ្ណ', 'tickets') + ' · ' + kg(done.reduce((s, x) => s + Number(x.net || 0), 0) / 1000) + ' t' : '';
      $('#todayList').innerHTML = list.length ? ticketTable(list) : `<div class="empty">${t('មិនទាន់មានប័ណ្ណថ្ងៃនេះ', 'No tickets yet today')}</div>`;
      bindTable();
    }
  }
  function ticketTable(list) {
    return `<div class="tbl"><table class="tt"><tr><th>${t('លេខប័ណ្ណ', 'Ticket')}</th><th>${t('ឡាន', 'Truck')}</th><th>DN</th><th>${t('អតិថិជន', 'Customer')}</th><th>${t('ទំនិញ', 'Item')}</th><th>${t('ចូល/ចេញ', 'In/Out')}</th><th>${t('ម៉ោង', 'Time')}</th><th class="r">Gross</th><th class="r">Tare</th><th class="r">Net</th><th></th></tr>
      ${list.map(x => `<tr class="pick${x.status === 'Void' ? ' void' : ''}${x.err ? ' errrow' : ''}" data-tk="${esc(x.cid || x.no)}"><td class="mono">${esc(x.no)}${x.status === 'Void' ? ` <span class="badge rejected">${t('បានលុប', 'Cancelled')}</span>` : ''}${x.status === 'Open' ? ` <span class="badge follow">${t('នៅលើទីតាំង', 'On site')}</span>` : ''}</td><td>${esc(x.plate)}</td><td>${esc((x.dns || []).join(', '))}</td><td>${esc(x.customer || '')}</td><td>${esc(x.item || '')}</td><td>${esc(typeName(typeOf(x)))}</td>
        <td>${dmy(x.t1) === dmy(new Date().toISOString()) ? '' : dmy(x.t1) + ' '}${hm(x.t1)}${x.t2 ? '–' + hm(x.t2) : ''}</td><td class="r mono">${kg(x.gross)}</td><td class="r mono">${kg(x.tare)}</td><td class="r mono"><b>${kg(x.net)}</b></td>
        <td class="nw">${x.warn ? '<span title="' + esc(warnTxt(x.warn)) + '">⚠️</span>' : ''}${[x.s1, x.s2].some(s => s === 'Manual') ? '<span title="Manual">✍</span>' : ''}${[x.s1, x.s2].some(s => s === 'Simulator') ? '<span title="Simulator">🧪</span>' : ''}${x.err ? '<span title="' + esc(x.err) + '">❗</span>' : Q.indexOf(x.cid) >= 0 ? '<span title="' + t('រង់ចាំផ្ញើ', 'Waiting to send') + '">⏳</span>' : ''}</td></tr>`).join('')}</table></div>`;
  }
  function bindTable() { $$('[data-tk]').forEach(r => { r.onclick = () => { location.hash = '#/t/' + encodeURIComponent(r.dataset.tk); }; }); }

  // ---------------------------------------------------------------- ticket list, search, Excel
  let LIST = { from: today(), to: today(), q: '', rows: null };
  function renderList() {
    screen = renderList;
    document.body.classList.add('wide');
    $('#view').innerHTML = `<section class="card">
      <div class="filters">
        <label>${t('ពី', 'From')}<input type="date" class="in" id="lFrom" value="${LIST.from}"></label>
        <label>${t('ដល់', 'To')}<input type="date" class="in" id="lTo" value="${LIST.to}"></label>
        <button type="button" class="btn ok" id="lGo">🔍 ${t('បង្ហាញ', 'Show')}</button>
        <input type="search" class="in grow" id="lQ" data-live-ok placeholder="${t('ស្វែងរក ឡាន DN អតិថិជន...', 'Search truck, DN, customer...')}" value="${esc(LIST.q)}">
        <button type="button" class="btn" id="lXls">⬇ Excel</button>
      </div>
      <div id="lSum" class="sumline"></div>
      <div id="lBody"><div class="spinner"></div></div></section>`;
    $('#lGo').onclick = () => { LIST.from = $('#lFrom').value; LIST.to = $('#lTo').value; loadList(); };
    $('#lQ').oninput = e => { LIST.q = e.target.value; paintListBody(); };
    $('#lXls').onclick = exportXls;
    loadList();
  }
  async function loadList() {
    const local = tickets().filter(x => { const d = String(x.t1 || '').slice(0, 10); return d >= LIST.from && d <= LIST.to; });
    LIST.rows = local; paintListBody();
    if (DEMO) return;
    try {
      const r = await api('scList', { from: LIST.from, to: LIST.to });
      const map = {};
      r.tickets.forEach(x => { map[x.cid || x.no] = x; });
      local.forEach(x => { if (LOC[x.cid]) map[x.cid] = x; });
      LIST.rows = Object.keys(map).map(k => map[k]);
      paintListBody();
    } catch (e) { if (e.code !== 'NET') toast(e.message); else if ($('#lSum')) $('#lSum').insertAdjacentHTML('beforeend', ` <span class="badge pending">${t('គ្មានអ៊ីនធឺណិត៖ បង្ហាញតែទិន្នន័យក្នុងកុំព្យូទ័រ', 'Offline: showing what is on this PC')}</span>`); }
  }
  const listRows = () => {
    const q = LIST.q.trim().toLowerCase();
    return (LIST.rows || []).filter(x => !q || [x.no, x.plate, x.company, x.customer, x.item, x.driver, x.dest, x.note, (x.dns || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0)
      .sort((a, b) => String(b.t1).localeCompare(String(a.t1)));
  };
  function paintListBody() {
    if (!$('#lSum')) return;   // the list was left before the server answered
    const rows = listRows();
    const done = rows.filter(x => x.status === 'Done');
    $('#lSum').innerHTML = `<b>${done.length}</b> ${t('ប័ណ្ណ', 'tickets')} · <b>${kg(done.reduce((s, x) => s + Number(x.net || 0), 0) / 1000)} t</b> ${t('សុទ្ធ', 'net')}`;
    $('#lBody').innerHTML = rows.length ? ticketTable(rows) : `<div class="empty">${t('គ្មានប័ណ្ណ', 'No tickets')}</div>`;
    bindTable();
  }
  function exportXls() {
    const rows = listRows();
    if (!rows.length || !window.XLSX) { toast(t('គ្មានប័ណ្ណ', 'No tickets')); return; }
    const head = ['Ticket No', 'Status', 'Truck No', 'Company', 'Customer', 'Item', 'In/Out', 'DN No', 'DN Count', 'Driver', 'Destination', 'Note', '1st Time', '1st Weight (kg)', '2nd Time', '2nd Weight (kg)', 'Gross (kg)', 'Tare (kg)', 'Net (kg)', 'Source', 'Warnings', 'Operator'];
    const data = rows.map(x => [x.no, x.status, x.plate, x.company, x.customer, x.item, typeOf(x), (x.dns || []).join(', '), (x.dns || []).length, x.driver, x.dest, x.note,
      String(x.t1 || '').replace('T', ' '), num(x.w1), String(x.t2 || '').replace('T', ' '), num(x.w2), num(x.gross), num(x.tare), num(x.net), [x.s1, x.s2].filter(Boolean).join(' / '), x.warn || '', x.op || '']);
    const ws = XLSX.utils.aoa_to_sheet([head].concat(data));
    ws['!cols'] = head.map((h, i) => ({ wch: [16, 8, 11, 16, 24, 14, 7, 28, 6, 18, 16, 20, 18, 10, 18, 10, 10, 10, 10, 12, 40, 14][i] }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scale Tickets');
    XLSX.writeFile(wb, 'Scale_Tickets_' + LIST.from + (LIST.to !== LIST.from ? '_to_' + LIST.to : '') + '.xlsx');
  }
  const num = v => (v === '' || v == null ? '' : Number(v));

  // ---------------------------------------------------------------- one ticket
  async function renderTicket(key) {
    screen = () => renderTicket(key);
    document.body.classList.remove('wide');
    let x = ticketBy(key) || (LIST.rows || []).find(r => r.cid === key || r.no === key);
    if (!x && !DEMO) {
      $('#view').innerHTML = '<div class="spinner"></div>';
      try {
        const m = String(key).match(/-(\d{2})(\d{2})(\d{2})-/);
        const d = m ? '20' + m[1] + '-' + m[2] + '-' + m[3] : today();
        const r = await api('scList', { from: d, to: d });
        x = r.tickets.find(r2 => r2.no === key || r2.cid === key);
      } catch (e) { toast(e.message); }
      if (!/^#\/?t\//.test(location.hash)) return;   // left this ticket before the server answered
    }
    if (!x) { $('#view').innerHTML = `<div class="card empty">${t('រកមិនឃើញប័ណ្ណ', 'Ticket not found')} ${esc(key)}</div>`; return; }
    const kv = (a, b) => `<div class="kv"><span>${a}</span><b>${b || '—'}</b></div>`;
    const editing = location.hash.indexOf('?edit') > 0;
    $('#view').innerHTML = `<section class="card">
      <div class="head2"><h2 class="mono">${esc(x.no)}</h2>${x.status === 'Void' ? `<span class="badge rejected">${t('បានលុប', 'Cancelled')}</span>` : x.status === 'Open' ? `<span class="badge follow">${t('នៅលើទីតាំង', 'On site')}</span>` : `<span class="badge approved">${t('រួចរាល់', 'Done')}</span>`}</div>
      <div class="emp">
        ${kv(t('លេខឡាន', 'Truck No'), esc(x.plate))}${kv(t('ក្រុមហ៊ុនឡាន', 'Truck company'), esc(x.company))}${kv(t('អតិថិជន', 'Customer'), esc(x.customer))}
        ${kv(t('ទំនិញ', 'Item'), esc(x.item))}${kv(t('ចូល / ចេញ', 'In / Out'), esc(typeName(typeOf(x))))}${kv('DN No', esc((x.dns || []).join(', ')))}
        ${kv(t('អ្នកបើកបរ', 'Driver'), esc(x.driver))}${kv(t('គោលដៅ', 'Destination'), esc(x.dest))}${kv(t('កំណត់ចំណាំ', 'Note'), esc(x.note))}
      </div>
      <div class="w3 mt"><div><small>${t('លើកទី១', '1st')} · ${dmy(x.t1)} ${hm(x.t1)}</small><b>${kg(x.w1)}</b><em class="src">${esc(x.s1 || '')}</em></div>
        <div><small>${t('លើកទី២', '2nd')} · ${dmy(x.t2)} ${hm(x.t2)}</small><b>${kg(x.w2)}</b><em class="src">${esc(x.s2 || '')}</em></div>
        <div><small>${t('សុទ្ធ', 'Net')}</small><b>${kg(x.net)}</b></div></div>
      ${x.warn ? `<div class="alert warn">⚠️ ${esc(warnTxt(x.warn))}</div>` : ''}
      ${x.err ? `<div class="alert bad">❗ ${esc(x.err)}</div>` : ''}
      <div class="hint">${t('អ្នកថ្លឹង', 'Weigher')}: ${esc(x.op || '')}${x.pdf ? ` · <a href="${esc(x.pdf)}" target="_blank" rel="noopener">PDF Drive</a>` : ''}</div>
      <div class="btns mt">
        <a class="btn" href="#/list">← ${t('ត្រឡប់', 'Back')}</a>
        ${x.status !== 'Open' ? `<button type="button" class="btn ok" data-print="${esc(x.cid || x.no)}">🖨 ${t('បោះពុម្ព', 'Print')}</button><button type="button" class="btn" data-pdf="${esc(x.cid || x.no)}">📄 PDF</button>` : ''}
        ${canEdit() && x.status === 'Done' && x.cid ? `<button type="button" class="btn" id="tEdit">✏️ ${t('កែព័ត៌មាន', 'Edit details')}</button>` : ''}
        ${isAdmin() && x.status === 'Done' && x.cid ? `<button type="button" class="btn danger" id="tVoid">🗑 ${t('លុបប័ណ្ណ', 'Cancel ticket')}</button>` : ''}
        ${x.err && x.cid && LOC[x.cid] ? `<button type="button" class="btn" id="tRetry">↻ ${t('ផ្ញើម្តងទៀត', 'Send again')}</button>` : ''}
      </div>
      <div id="tMore"></div></section>`;
    bindDone();
    if ($('#tRetry')) $('#tRetry').onclick = () => { putTicket(LOC[x.cid]); renderTicket(key); };
    if ($('#tVoid')) $('#tVoid').onclick = () => {
      $('#tMore').innerHTML = `<div class="alert bad"><b>${t('លុបប័ណ្ណនេះ?', 'Cancel this ticket?')}</b><input class="in mt" id="vWhy" placeholder="${t('មូលហេតុ (ចាំបាច់)', 'Reason (required)')}"><div class="btns mt"><button type="button" class="btn danger" id="vGo">${t('លុប', 'Cancel ticket')}</button></div></div>`;
      $('#vGo').onclick = () => { const why = $('#vWhy').value.trim(); if (!why) { $('#vWhy').classList.add('need'); return; } putTicket(Object.assign({}, x, { status: 'Void', reason: why })); toast(t('បានលុប', 'Cancelled')); renderTicket(key); };
    };
    if ($('#tEdit')) $('#tEdit').onclick = () => editTicket(x, key);
    if (editing && $('#tEdit')) editTicket(x, key);
  }
  function editTicket(x, key) {
    const f = (id, label, v) => `<div class="field"><label class="f">${label}</label><div><input class="in" id="${id}" autocomplete="off" value="${esc(v || '')}"></div></div>`;
    $('#tMore').innerHTML = `<div class="card soft mt"><div class="fgrid">
      ${f('eCompany', t('ក្រុមហ៊ុនឡាន', 'Truck company'), x.company)}${f('eCustomer', t('អតិថិជន', 'Customer'), x.customer)}${f('eItem', t('ទំនិញ', 'Item'), x.item)}
      ${f('eDn', 'DN No (, )', (x.dns || []).join(', '))}${f('eDriver', t('អ្នកបើកបរ', 'Driver'), x.driver)}${f('eDest', t('គោលដៅ', 'Destination'), x.dest)}
      ${f('eNote', t('កំណត់ចំណាំ', 'Note'), x.note)}${f('eWhy', t('មូលហេតុនៃការកែ', 'Reason for the change'), '')}</div>
      <div class="hint">${t('ទម្ងន់មិនអាចកែបានទេ។ ការកែទាំងអស់ត្រូវកត់ត្រាក្នុង Scale Log។', 'Weights cannot be changed here. Every change is written to the Scale Log.')}</div>
      <div class="btns mt"><button type="button" class="btn ok" id="eSave">💾 ${t('រក្សាទុក', 'Save')}</button></div></div>`;
    picker($('#eCustomer'), { list: () => ((B && B.customers) || []).map(c => ({ v: c[1], sub: c[0] })), addNew: true, onPick: () => {} });
    picker($('#eItem'), { list: () => ((B && B.items) || []).map(i => ({ v: i[0] })), addNew: true, onPick: () => {} });
    picker($('#eDest'), { list: () => ((B && B.dests) || []).map(v => ({ v })), addNew: true, onPick: () => {} });
    $('#eSave').onclick = () => {
      const v = id => $(id).value.trim();
      const nx = Object.assign({}, x, { company: v('#eCompany'), customer: v('#eCustomer'), item: v('#eItem'), dns: v('#eDn').split(/[\s,;]+/).filter(Boolean), driver: v('#eDriver'), dest: v('#eDest'), note: v('#eNote'), reason: v('#eWhy') });
      putTicket(nx);
      toast(t('បានរក្សាទុក', 'Saved'));
      renderTicket(key);
    };
  }

  // ---------------------------------------------------------------- A4 ticket: picture -> Print or PDF
  let LOGO = null;
  const logo = () => LOGO || (LOGO = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = '../icons/isi-steel-logo.png'; }));
  const ticketUrl = x => location.origin + location.pathname.replace(/[^/]*$/, '') + '#/t/' + encodeURIComponent(x.no);

  async function drawTicket(x) {
    const W = 1240, H = 1754, M = 90;              // A4 at 150 dpi
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    try { await document.fonts.ready; } catch (e) { /* old browser */ }
    const KH = '"Noto Sans Khmer", "Khmer OS", sans-serif';
    const font = (px, w) => { g.font = (w || 400) + ' ' + px + 'px ' + KH; };
    const NAVY = '#011e41', BLUE = '#0b4ea2', GREY = '#555';
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const lg = await logo();
    if (lg) { const h = 92, w = lg.width * h / lg.height; g.drawImage(lg, M, M - 10, w, h); }
    g.textAlign = 'right'; g.fillStyle = NAVY;
    font(46, 700); g.fillText('WEIGHING TICKET', W - M, M + 26);
    font(30, 600); g.fillStyle = BLUE; g.fillText('សំបុត្រថ្លឹងទម្ងន់', W - M, M + 70);
    g.textAlign = 'left';
    g.fillStyle = BLUE; g.fillRect(M, M + 102, W - 2 * M, 5);
    font(26, 400); g.fillStyle = GREY; g.fillText(S().SCALE_COMPANY || 'ISI STEEL', M, M + 145);
    g.textAlign = 'right'; g.fillText('Printed ' + dmy(iso(new Date())) + ' ' + hm(iso(new Date())), W - M, M + 145); g.textAlign = 'left';

    // ticket number, date, and a QR code that opens this ticket in the app (to check it is real)
    let y = M + 210;
    font(26, 400); g.fillStyle = GREY; g.fillText('Ticket No / លេខប័ណ្ណ', M, y);
    font(52, 700); g.fillStyle = NAVY; g.fillText(x.no, M, y + 60);
    font(26, 400); g.fillStyle = GREY; g.fillText('Date / កាលបរិច្ឆេទ', M + 560, y);
    font(44, 700); g.fillStyle = NAVY; g.fillText(dmy(x.t2 || x.t1), M + 560, y + 56);
    const QS = 150;
    if (window.qrcode) {
      try {
        const qr = qrcode(0, 'M'); qr.addData(ticketUrl(x)); qr.make();
        const n = qr.getModuleCount(), cell = QS / n, qx = W - M - QS, qy = y - 30;
        g.fillStyle = '#000';
        for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++) if (qr.isDark(r, cc)) g.fillRect(qx + cc * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell));
      } catch (e) { /* too long */ }
    }
    y += 150;

    // details, two per line
    const wrap = (text, maxW) => { const out = []; let line = ''; String(text || '').split(/(\s+|,\s*)/).forEach(w => { if (g.measureText(line + w).width > maxW && line) { out.push(line.trim()); line = w.replace(/^\s+/, ''); } else line += w; }); if (line.trim()) out.push(line.trim()); return out.length ? out : ['—']; };
    const half = (W - 2 * M) / 2, LW = 175;
    const cellAt = (cx, label, kh, value, width) => {
      font(22, 400); g.fillStyle = GREY; g.fillText(label, cx, y + 30); font(21, 400); g.fillText(kh, cx, y + 58);
      font(30, 700); g.fillStyle = NAVY;
      if (wrap(value, width - LW - 20).length > 1) font(25, 700);
      const ls = wrap(value, width - LW - 20).slice(0, 2);
      ls.forEach((l, i) => g.fillText(l, cx + LW, y + (ls.length > 1 ? 32 : 44) + i * 32));
    };
    // Customer, In / Out and Driver are no longer typed on the scale (Kim, 6 Nov 2026); older tickets still show them
    const cells = [['Truck No', 'លេខឡាន', x.plate], ['Truck company', 'ក្រុមហ៊ុនឡាន', x.company], ['Item', 'ទំនិញ', x.item], ['Destination', 'គោលដៅ', x.dest]]
      .concat(x.customer ? [['Customer', 'អតិថិជន', x.customer]] : [], x.driver ? [['Driver', 'អ្នកបើកបរ', x.driver]] : [], [['Note', 'កំណត់ចំណាំ', x.note]]);
    const pairs = [];
    for (let i = 0; i < cells.length; i += 2) pairs.push([cells[i], cells[i + 1] || null]);
    g.strokeStyle = '#d0d7e2'; g.lineWidth = 2;
    const rule = () => { g.strokeStyle = '#d0d7e2'; g.beginPath(); g.moveTo(M, y); g.lineTo(W - M, y); g.stroke(); };
    rule();
    pairs.forEach(pr => { cellAt(M, pr[0][0], pr[0][1], pr[0][2], half); if (pr[1]) cellAt(M + half + 20, pr[1][0], pr[1][1], pr[1][2], half - 20); y += 80; rule(); });
    font(24, 400); g.fillStyle = GREY; g.fillText('DN No', M, y + 30); font(21, 400); g.fillText('លេខ DN (' + (x.dns || []).length + ')', M, y + 58);
    font(30, 700); g.fillStyle = NAVY;
    const dl = wrap((x.dns || []).join(', '), W - 2 * M - LW).slice(0, 3);
    dl.forEach((l, i) => g.fillText(l, M + LW, y + 44 + i * 38));
    y += Math.max(80, 26 + dl.length * 38); rule();
    y += 50;

    // weights
    const colX = [M, M + 470, W - M];
    font(24, 600); g.fillStyle = GREY;
    g.fillText('Date / Time', colX[1], y); g.textAlign = 'right'; g.fillText('Weight (kg)', colX[2], y); g.textAlign = 'left';
    y += 14; g.fillStyle = NAVY; g.fillRect(M, y, W - 2 * M, 3); y += 6;
    const wRow = (a, b, time, v, src) => {
      font(30, 600); g.fillStyle = NAVY; g.fillText(a, colX[0], y + 40); font(22, 400); g.fillStyle = GREY; g.fillText(b, colX[0], y + 68);
      font(28, 400); g.fillStyle = NAVY; g.fillText(time, colX[1], y + 46);
      g.textAlign = 'right'; font(38, 700); g.fillText(kg(v), colX[2], y + 48);
      if (src && src !== 'Scale') { font(20, 700); g.fillStyle = '#b3261e'; g.fillText(src === 'Manual' ? 'TYPED BY HAND' : 'TEST (simulator)', colX[2], y + 72); }
      g.textAlign = 'left'; y += 82; rule();
    };
    wRow('1st weigh', 'ថ្លឹងលើកទី១', dmy(x.t1) + ' ' + hm(x.t1), x.w1, x.s1);
    wRow('2nd weigh', 'ថ្លឹងលើកទី២', dmy(x.t2) + ' ' + hm(x.t2), x.w2, x.s2);
    wRow('Gross', 'ទម្ងន់សរុប', '', x.gross);
    wRow('Tare', 'ទម្ងន់ឡានទទេ', '', x.tare);
    g.fillStyle = '#e8eef8'; g.fillRect(M, y + 12, W - 2 * M, 104);
    g.fillStyle = BLUE; g.fillRect(M, y + 12, 10, 104);
    font(38, 700); g.fillStyle = NAVY; g.fillText('NET', M + 36, y + 62); font(24, 600); g.fillText('ទម្ងន់សុទ្ធ', M + 36, y + 98);
    g.textAlign = 'right'; font(62, 700); g.fillText(kg(x.net) + ' kg', W - M - 24, y + 88); g.textAlign = 'left';
    y += 150;
    if (x.warn) { font(22, 600); g.fillStyle = '#8a5a00'; wrap('Warning: ' + x.warn, W - 2 * M).slice(0, 3).forEach(l => { g.fillText(l, M, y); y += 30; }); }

    // signatures
    const names = String(S().SCALE_SIGN || 'Weigher, Driver, Security').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
    const sy = Math.max(y + 110, H - M - 150), sw = (W - 2 * M - (names.length - 1) * 50) / names.length;
    names.forEach((n, i) => {
      const sx = M + i * (sw + 50);
      g.strokeStyle = '#777'; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + sw, sy); g.stroke();
      font(26, 600); g.fillStyle = GREY; g.textAlign = 'center'; g.fillText(n, sx + sw / 2, sy + 38); g.textAlign = 'left';
    });
    // footer
    font(22, 400); g.fillStyle = '#777';
    g.fillText('Weighed by ' + (x.op || '') + ' · weight read from the scale indicator (Keli XK3118K8)', M, H - M - 40);
    g.fillText('iSteel · Truck Scale · ' + ticketUrl(x).replace(/^https?:\/\//, ''), M, H - M - 8);
    if (x.status === 'Void' || [x.s1, x.s2].indexOf('Simulator') >= 0) {
      g.save(); g.translate(W / 2, H / 2); g.rotate(-Math.PI / 6); font(150, 700); g.fillStyle = 'rgba(179,38,30,.22)'; g.textAlign = 'center';
      g.fillText(x.status === 'Void' ? 'CANCELLED' : 'TEST', 0, 0); g.restore();
    }
    return c;
  }
  async function makePdf(x) {
    const c = await drawTicket(x);
    const data = c.toDataURL('image/jpeg', 0.85);
    const bin = atob(data.split(',')[1]);
    const jpg = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) jpg[i] = bin.charCodeAt(i);
    const pdf = CORE.jpegPdf(jpg, c.width, c.height, paper());
    let s = '';
    for (let i = 0; i < pdf.length; i += 0x8000) s += String.fromCharCode.apply(null, pdf.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // Ticket from Kim's Word template (Settings › Warnings & ticket). The Word file is drawn here on the scale PC, so the
  // template keeps its own fonts (e.g. MiSans Khmer, which Google can't print) and layout. The file is kept on this PC,
  // so it works offline too. With no template, or on any error, the built-in ticket above is used.
  // Paper of this PC's printer: A4 (default) or A5. On A5 the A5 template is used, or the A4 one shrunk to A5.
  const paper = () => (get('sc_paper') === 'A5' ? 'A5' : 'A4');
  const tplOn = () => !DEMO && !!String(S().SCALE_TEMPLATE_LINK || '').trim();
  // The Word files are kept in the browser's Cache Storage (a template with its fonts is a few MB, too big for localStorage).
  set('sc_tpl', null);                           // old place
  const TPL = {}, tplAsked = {};                 // size -> { stamp, name, b64 }
  const tplKey = size => 'sc-tpl-' + size;
  async function tplCache(size, v) {
    try {
      const c = await caches.open('sc-tpl');
      if (v === undefined) { const r = await c.match(tplKey(size)); return r ? await r.json() : null; }
      if (v) await c.put(tplKey(size), new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } }));
      else await c.delete(tplKey(size));
    } catch (e) { /* no Cache Storage: kept in memory only */ }
    return v;
  }
  async function tplLoad(force, size) {
    if (!tplOn()) return null;
    size = size || paper();
    if (TPL[size] === undefined) TPL[size] = await tplCache(size);
    const T = TPL[size];
    if (!force && T && Date.now() - (tplAsked[size] || 0) < 10 * 60000) return T;
    tplAsked[size] = Date.now();
    try {
      const r = await api('scTemplate', { size: size, stamp: force ? '' : (T && T.stamp) || '' });
      if (r.none) { TPL[size] = null; tplCache(size, null); }
      else if (!r.same && r.b64) { TPL[size] = { stamp: r.stamp, name: r.name || '', b64: r.b64 }; tplCache(size, TPL[size]); }
    } catch (e) { if (!T || force) throw e; }    // offline: the copy on this PC
    return TPL[size];
  }
  const A5_PARTS = /^word\/(document|header\d*|footer\d*|styles|footnotes|endnotes)\.xml$/;
  /** Shrinks a Word file (JSZip) from A4 to A5 in place. */
  async function zipToA5(zip) {
    for (const n of Object.keys(zip.files)) if (A5_PARTS.test(n)) zip.file(n, CORE.toA5(await zip.file(n).async('string')));
  }
  /** Settings: downloads an A5 copy of the A4 template, to change in Word and put in Drive as the A5 template. */
  async function a5Copy() {
    const T = await tplLoad(true, 'A4');
    if (!T) throw new Error(t('មិនទាន់មានគំរូ', 'No template yet'));
    await loadJs('../vendor/jszip.min.js');
    const zip = await JSZip.loadAsync(T.b64, { base64: true });
    if (/^A4/.test(CORE.paperOf(await zip.file('word/document.xml').async('string')))) await zipToA5(zip);
    const u = URL.createObjectURL(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    const a = document.createElement('a');
    a.href = u; a.download = String(T.name || 'scale-ticket-template').replace(/\.docx?$/i, '') + ' A5.docx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 30000);
  }
  const libs = {};
  const loadJs = src => libs[src] || (libs[src] = new Promise((res, rej) => {
    const el = document.createElement('script'); el.src = src; el.onload = res;
    el.onerror = () => { delete libs[src]; rej(new Error('Could not load ' + src)); };
    document.head.appendChild(el);
  }));
  function qrPng(x) {
    try {
      const qr = qrcode(0, 'M'); qr.addData(ticketUrl(x)); qr.make();
      const n = qr.getModuleCount(), cell = 8, q = 4, c = document.createElement('canvas');
      c.width = c.height = (n + 2 * q) * cell;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect((k + q) * cell, (r + q) * cell, cell, cell);
      return c.toDataURL('image/png');
    } catch (e) { return ''; }
  }
  /** The words for each {{tag}} in the Word file. */
  function tplVals(x) {
    const when = v => (v ? dmy(v) + ' ' + hm(v) : '');
    const src = v => (v === 'Manual' ? 'TYPED BY HAND' : v === 'Simulator' ? 'TEST (simulator)' : '');
    const dns = x.dns || [];
    return {
      TicketNo: x.no || '', Date: dmy(x.t2 || x.t1), TruckNo: x.plate || '', Company: x.company || '', Item: x.item || '', Destination: x.dest || '',
      DN: dns.join(', '), DNCount: String(dns.length), Note: x.note || '', Customer: x.customer || '', Driver: x.driver || '', Type: typeOf(x),
      Weight1: kg(x.w1), Time1: when(x.t1), Source1: src(x.s1), Weight2: kg(x.w2), Time2: when(x.t2), Source2: src(x.s2),
      Gross: kg(x.gross), Tare: kg(x.tare), Net: kg(x.net), Warning: x.warn ? 'Warning: ' + x.warn : '', Operator: x.op || '',
      Status: x.status === 'Void' ? 'CANCELLED' : x.status === 'Open' ? 'NOT FINISHED' : '',
      Printed: dmy(iso(new Date())) + ' ' + hm(iso(new Date())), CompanyName: S().SCALE_COMPANY || 'ISI STEEL',
    };
  }
  /** Fills the Word file for this ticket and draws it into a new box (not yet on the page). */
  async function tplRender(x) {
    const T = await tplLoad();
    if (!T) throw new Error(t('មិនទាន់មានគំរូ', 'No template yet'));
    await loadJs('../vendor/jszip.min.js');
    await loadJs('../vendor/docx-preview.min.js');
    const zip = await JSZip.loadAsync(T.b64, { base64: true });
    let pp = CORE.paperOf(await zip.file('word/document.xml').async('string'));
    if (paper() === 'A5' && /^A4/.test(pp)) { await zipToA5(zip); pp = pp.replace('A4', 'A5'); }
    const vals = tplVals(x);
    const W = '(?:<[^>]*>)*';
    const re = new RegExp('\\{' + W + '\\{((?:' + W + '[A-Za-z0-9_])+)' + W + '\\}' + W + '\\}', 'g');
    const xml = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let qrTarget = '';
    for (const n of Object.keys(zip.files)) {
      if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(n)) continue;
      let d = await zip.file(n).async('string');
      d = d.replace(re, (all, k) => { k = k.replace(/<[^>]*>/g, ''); return Object.prototype.hasOwnProperty.call(vals, k) ? xml(vals[k]) : all; });
      zip.file(n, d);
      if (n === 'word/document.xml') {
        const at = d.search(/<wp:docPr\b[^>]*(?:descr|title|name)="QR"/i);
        const emb = at >= 0 ? d.slice(at).match(/r:embed="([^"]+)"/) : null;
        const rf = zip.file('word/_rels/document.xml.rels');
        if (emb && rf) {
          const rel = (await rf.async('string')).match(new RegExp('<Relationship[^>]*Id="' + emb[1] + '"[^>]*>'));
          const tg = rel && rel[0].match(/Target="([^"]+)"/);
          if (tg) qrTarget = 'word/' + tg[1].replace(/^\.?\//, '').replace(/^word\//, '');
        }
      }
    }
    const qr = qrPng(x);
    if (qrTarget && qr && zip.file(qrTarget)) zip.file(qrTarget, qr.split(',')[1], { base64: true });
    const box = document.createElement('div');
    box.className = 'tplbox';
    box.dataset.paper = pp;
    await docx.renderAsync(await zip.generateAsync({ type: 'blob' }), box, null,
      { inWrapper: false, breakPages: true, renderHeaders: true, renderFooters: true, experimental: true, ignoreLastRenderedPageBreak: true, useBase64URL: true });
    // A Word table row's "alignment" moves the row, not its text; docx-preview centres the text instead, so undo that.
    box.querySelectorAll('tr').forEach(r => { r.style.textAlign = ''; });
    return box;
  }
  /** PDF of the drawn Word file: the first page as a picture, like the built-in ticket. */
  /** Puts the drawn Word file on the page out of sight, waits for its fonts and pictures, and fits table text like Word. */
  async function tplMount(box) {
    const hold = document.createElement('div');
    hold.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff';
    hold.appendChild(box);
    document.body.appendChild(hold);
    try { await document.fonts.ready; } catch (e) { /* old browser */ }
    await Promise.all([...box.querySelectorAll('img')].map(im => (im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))));
    fitCells(box);
    return hold;
  }
  /**
   * The browser measures text a little wider than Word, so a table label that just fits on one line in Word
   * (e.g. "ក្រុមហ៊ុនឡាន / Company") can wrap here. Such text is made up to 12% smaller so it stays on one line;
   * text that really is longer than its cell still wraps, as in Word.
   */
  function fitCells(box) {
    box.querySelectorAll('td p, th p').forEach(p => {
      if (!p.textContent.trim() || p.querySelector('br')) return;
      const avail = p.clientWidth, h = p.getBoundingClientRect().height;
      if (!avail || !h) return;
      p.classList.add('fitnw');
      const rg = document.createRange(); rg.selectNodeContents(p);
      const need = rg.getBoundingClientRect().width, h1 = p.getBoundingClientRect().height;
      p.classList.remove('fitnw');
      if (!(h > h1 * 1.4 && need > avail && need <= avail * 1.12)) return;
      const k = (avail / need) * 0.98;
      const els = [p, ...p.querySelectorAll('span')];
      const sizes = els.map(e => parseFloat(getComputedStyle(e).fontSize));
      els.forEach((e, i) => { if (sizes[i]) e.style.fontSize = (sizes[i] * k).toFixed(2) + 'px'; });
    });
  }
  async function tplPdf(x) {
    await loadJs('../vendor/html2canvas.min.js');
    const box = await tplRender(x);
    const hold = await tplMount(box);
    try {
      const page = box.querySelector('section.docx') || box;
      const c = await html2canvas(page, { scale: 4, backgroundColor: '#ffffff', logging: false, useCORS: true });
      const data = c.toDataURL('image/jpeg', 0.92);
      const bin = atob(data.split(',')[1]);
      const jpg = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) jpg[i] = bin.charCodeAt(i);
      const pdf = CORE.jpegPdf(jpg, c.width, c.height, box.dataset.paper);
      let s2 = '';
      for (let i = 0; i < pdf.length; i += 0x8000) s2 += String.fromCharCode.apply(null, pdf.subarray(i, i + 0x8000));
      return btoa(s2);
    } finally { hold.remove(); }
  }
  /** Template PDF when there is a template, else the built-in one. */
  async function bestPdf(x) {
    let b64 = null;
    if (tplOn()) { try { b64 = await tplPdf(x); } catch (e) { toast(t('ប្រើប័ណ្ណស្តង់ដារ (គំរូ Word មិនដំណើរការ)', 'Using the standard ticket (Word template not available)') + ': ' + e.message); } }
    if (!b64) b64 = await makePdf(x);
    return b64;
  }
  const pdfBlob = b64 => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: 'application/pdf' }); };
  async function downloadPdf(x) {
    const b64 = await bestPdf(x);
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([u], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = x.no + '_' + String(x.plate || '').replace(/[^A-Z0-9\-]/gi, '') + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function printTicket(x) {
    if (tplOn()) {
      try {
        const box = await tplRender(x);
        const hold = await tplMount(box);
        const area = $('#printArea');
        area.innerHTML = '';
        area.appendChild(box);
        hold.remove();
        pageSize(box.dataset.paper);
        document.body.classList.add('printing');
        setTimeout(() => { window.print(); }, 80);
        return;
      } catch (e) { toast(t('ប្រើប័ណ្ណស្តង់ដារ (គំរូ Word មិនដំណើរការ)', 'Using the standard ticket (Word template not available)') + ': ' + e.message); }
    }
    const c = await drawTicket(x);
    const area = $('#printArea');
    area.innerHTML = '';
    pageSize(paper());
    const img = new Image();
    img.onload = () => { document.body.classList.add('printing'); setTimeout(() => { window.print(); }, 50); };
    img.src = c.toDataURL('image/png');
    area.appendChild(img);
  }
  /** The printed page size for the next print: A4 or A5, with L for landscape (the Word file's own page). */
  function pageSize(p) {
    let st = $('#pageSize');
    if (!st) { st = document.createElement('style'); st.id = 'pageSize'; document.head.appendChild(st); }
    const sz = /^A5/.test(p) ? 'A5' : 'A4', land = /L$/.test(p);
    st.textContent = '@media print { @page { size: ' + sz + (land ? ' landscape' : '') + '; margin: 0; }' +
      (sz === 'A5' && !land ? ' body.printing #printArea img { width: 148mm; height: 210mm; }' : '') + ' }';
  }
  window.addEventListener('afterprint', () => { document.body.classList.remove('printing'); });

  // ---------------------------------------------------------------- settings (Admin)
  const SET_TABS = [['trucks', '🚚', 'ឡាន', 'Trucks'], ['customers', '🏢', 'អតិថិជន', 'Customers'], ['items', '📦', 'ទំនិញ', 'Items'], ['dests', '📍', 'គោលដៅ', 'Destinations'],
    ['scale', '🔌', 'ការភ្ជាប់ជញ្ជីង', 'Scale connection'], ['rules', '⚠️', 'ការព្រមាន & ប័ណ្ណ', 'Warnings & ticket']];
  let setQ = '';
  function renderSettings(tab) {
    screen = () => renderSettings(tab);
    document.body.classList.add('wide');
    $('#view').innerHTML = `<div class="setwrap"><nav class="setnav">${SET_TABS.map(x => `<a href="#/set/${x[0]}" class="${x[0] === tab ? 'on' : ''}">${x[1]} ${t(x[2], x[3])}</a>`).join('')}</nav><section class="card setbody" id="setBody"></section></div>`;
    ({ trucks: setTrucks, customers: setCustomers, items: setItems, dests: setDests, scale: setScale, rules: setRules }[tab] || setTrucks)();
  }
  function masterTable(o) {
    // o: { title, note, cols: [[label, key, align]], rows: [], tmpl: [header...], fromRow(obj) -> payload row, key, form(row) html, read() -> payload row, kind }
    const body = $('#setBody');
    const q = setQ.trim().toLowerCase();
    const rows = o.rows.filter(r => !q || o.cols.map(c => r[c[1]]).join(' ').toLowerCase().indexOf(q) >= 0);
    body.innerHTML = `<div class="head2"><h2>${o.title} <span class="cnt">${o.rows.length}</span></h2>
      <div class="btns"><button type="button" class="btn" id="mTmpl">⬇ ${t('គំរូ Excel', 'Download template')}</button><label class="btn">⬆ ${t('ផ្ទុក Excel', 'Upload Excel')}<input type="file" id="mUp" accept=".xlsx,.xls,.csv" hidden></label><button type="button" class="btn ok" id="mAdd">＋ ${t('បន្ថែម', 'Add')}</button></div></div>
      <p class="hint">${o.note}</p>
      <div id="mForm"></div>
      <input type="search" class="in" id="mQ" data-live-ok placeholder="${t('ស្វែងរក', 'Search')}" value="${esc(setQ)}">
      <div class="tbl mt"><table><tr>${o.cols.map(c => `<th class="${c[2] || ''}">${c[0]}</th>`).join('')}</tr>
        ${rows.slice(0, 500).map((r, i) => `<tr class="pick" data-row="${o.rows.indexOf(r)}">${o.cols.map(c => `<td class="${c[2] || ''}">${esc(c[2] === 'r' ? kg(r[c[1]]) : r[c[1]])}</td>`).join('')}</tr>`).join('')}</table></div>`;
    $('#mQ').oninput = e => { setQ = e.target.value; masterTable(o); $('#mQ').focus(); $('#mQ').setSelectionRange(setQ.length, setQ.length); };
    const openForm = r => {
      $('#mForm').innerHTML = `<div class="card soft"><div class="fgrid">${o.form(r || {})}</div><div class="btns mt"><button type="button" class="btn ok" id="mSave">💾 ${t('រក្សាទុក', 'Save')}</button><button type="button" class="btn" id="mCancel">${t('បោះបង់', 'Cancel')}</button></div></div>`;
      $('#mCancel').onclick = () => { $('#mForm').innerHTML = ''; };
      $('#mSave').onclick = async () => { const row = o.read(); if (!row) return; await saveMaster(o.kind, [row], $('#mSave')); };
      const first = $('#mForm input:not([readonly])'); if (first) first.focus();
    };
    $('#mAdd').onclick = () => openForm(null);
    $$('[data-row]').forEach(tr => { tr.onclick = () => { openForm(o.rows[+tr.dataset.row]); window.scrollTo(0, 0); }; });
    $('#mTmpl').onclick = () => {
      const ws = XLSX.utils.aoa_to_sheet([o.tmpl].concat(o.rows.map(o.toRow)));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, o.kind); XLSX.writeFile(wb, 'Scale_' + o.kind + '_template.xlsx');
    };
    $('#mUp').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
        const head = (aoa[0] || []).map(h => String(h).trim().toLowerCase());
        const idx = o.tmpl.map(h => head.indexOf(h.toLowerCase()));
        if (idx[0] < 0) { toast(t('ជួរទី១ត្រូវមានឈ្មោះជួរឈរ ដូចគំរូ', 'Row 1 must have the column names of the template') + ': ' + o.tmpl.join(', ')); return; }
        const rows = aoa.slice(1).map(r => o.fromRow(idx.map(i => (i >= 0 ? String(r[i] == null ? '' : r[i]).trim() : undefined)))).filter(Boolean);
        if (!rows.length) { toast(t('គ្មានជួរ', 'No rows')); return; }
        await saveMaster(o.kind, rows, null);
      } catch (err) { toast(err.message); }
      e.target.value = '';
    };
  }
  async function saveMaster(kind, rows, btn) {
    if (btn) busy(btn, true);
    try {
      let added = 0, changed = 0, r;
      for (let i = 0; i < rows.length; i += 200) {
        r = await api('scMaster', { kind, rows: rows.slice(i, i + 200) });
        added += r.added; changed += r.changed;
      }
      B.trucks = r.trucks; B.customers = r.customers; B.items = r.items; set('sc_boot', JSON.stringify(B));
      toast('✅ ' + t('បន្ថែម', 'Added') + ' ' + added + ' · ' + t('កែ', 'Changed') + ' ' + changed);
      route();
    } catch (e) { toast(e.message); if (btn) busy(btn, false); }
  }
  const inp = (id, label, v, extra) => `<div class="field"><label class="f">${label}</label><input class="in" id="${id}" autocomplete="off" value="${esc(v == null ? '' : v)}" ${extra || ''}></div>`;
  function setTrucks() {
    masterTable({
      kind: 'truck', title: '🚚 ' + t('បញ្ជីឡាន', 'Truck list'),
      note: t('បញ្ជីតែមួយ៖ ផ្ទាំង "Driver & Truck" ក្នុង Fuel Refill។ កម្មវិធីបន្ថែមជួរឈរ Truck Type, Empty Weight (kg), Max Gross (kg)។ ទម្ងន់ទទេបំពេញដោយខ្លួនឯងពីការថ្លឹងលើកដំបូង។',
        'One list: the "Driver & Truck" tab of the Fuel Refill sheet. The scale added the columns Truck Type, Empty Weight (kg) and Max Gross (kg). An empty Empty Weight fills itself from the truck\'s first weigh.'),
      cols: [[t('លេខឡាន', 'Plate'), 'plate'], [t('ក្រុមហ៊ុន', 'Company'), 'company'], [t('ប្រភេទ', 'Truck type'), 'type'], [t('ទម្ងន់ទទេ (kg)', 'Empty (kg)'), 'empty', 'r'], [t('អតិបរមា (kg)', 'Max gross (kg)'), 'max', 'r'], [t('អ្នកបើកបរ', 'Drivers'), 'dr']],
      rows: trucks().map(x => Object.assign({}, x, { dr: x.drivers.join(', ') })),
      tmpl: ['Plate', 'Company', 'Truck Type', 'Empty Weight (kg)', 'Max Gross (kg)'],
      toRow: r => [r.plate, r.company, r.type, r.empty, r.max],
      fromRow: a => (a[0] ? { plate: a[0].toUpperCase(), company: a[1], type: a[2], empty: a[3], max: a[4] } : null),
      form: r => inp('tPlate', t('លេខឡាន', 'Plate') + ' <span class="req">*</span>', r.plate, r.plate ? 'readonly' : '') + inp('tCo', t('ក្រុមហ៊ុន', 'Company'), r.company) + inp('tType', t('ប្រភេទឡាន', 'Truck type'), r.type) +
        inp('tEmpty', t('ទម្ងន់ឡានទទេ (kg)', 'Empty weight (kg)'), r.empty, 'inputmode="numeric"') + inp('tMax', t('ទម្ងន់សរុបអតិបរមា (kg)', 'Max gross (kg)'), r.max, 'inputmode="numeric"'),
      read: () => { const p = $('#tPlate').value.trim().toUpperCase(); if (!p) { $('#tPlate').classList.add('need'); return null; } return { plate: p, company: $('#tCo').value.trim(), type: $('#tType').value.trim(), empty: $('#tEmpty').value.replace(/[^0-9.]/g, ''), max: $('#tMax').value.replace(/[^0-9.]/g, '') }; },
    });
  }
  function setCustomers() {
    masterTable({
      kind: 'customer', title: '🏢 ' + t('អតិថិជន', 'Customers'),
      note: t('បញ្ជីតែមួយ៖ ផ្ទាំង "Customer" ក្នុង SSK-DELIVERY-DATA (ប្រើរួមជាមួយកម្មវិធីដឹកជញ្ជូន)។', 'One list: the "Customer" tab of SSK-DELIVERY-DATA, shared with the Delivery app.'),
      cols: [['Customer ID', 'id'], [t('ឈ្មោះ', 'Customer name'), 'name']],
      rows: ((B && B.customers) || []).map(c => ({ id: c[0], name: c[1] })),
      tmpl: ['Customer ID', 'Customer Name'], toRow: r => [r.id, r.name],
      fromRow: a => (a[1] || a[0] ? { id: a[0] || '', name: a[1] || '' } : null),
      form: r => inp('cId', 'Customer ID', r.id) + inp('cName', t('ឈ្មោះ', 'Customer name') + ' <span class="req">*</span>', r.name),
      read: () => { const n = $('#cName').value.trim(); if (!n) { $('#cName').classList.add('need'); return null; } return { id: $('#cId').value.trim(), name: n }; },
    });
  }
  function setItems() {
    masterTable({
      kind: 'item', title: '📦 ' + t('ទំនិញ', 'Items'),
      note: t('ផ្ទាំង "Item List" ក្នុង SSK-WEIGHT-SCALE-DATA (មិនទាន់មានបញ្ជីទំនិញពីមុន)។ Active = No លាក់ពីបញ្ជី។', 'The "Item List" tab of SSK-WEIGHT-SCALE-DATA (there was no item list before). Active = No hides an item.'),
      cols: [[t('ទំនិញ', 'Item'), 'name'], [t('ឯកតា', 'Unit'), 'unit'], ['Active', 'active']],
      rows: ((B && B.items) || []).map(i => ({ name: i[0], unit: i[1], active: i[2] })),
      tmpl: ['Item', 'Unit', 'Active'], toRow: r => [r.name, r.unit, r.active],
      fromRow: a => (a[0] ? { name: a[0], unit: a[1] || 'kg', active: a[2] || 'Yes' } : null),
      form: r => inp('iName', t('ទំនិញ', 'Item') + ' <span class="req">*</span>', r.name, r.name ? 'readonly' : '') + inp('iUnit', t('ឯកតា', 'Unit'), r.unit || 'kg') +
        `<div class="field"><label class="f">Active</label><select class="in" id="iAct"><option${r.active !== 'No' ? ' selected' : ''}>Yes</option><option${r.active === 'No' ? ' selected' : ''}>No</option></select></div>`,
      read: () => { const n = $('#iName').value.trim(); if (!n) { $('#iName').classList.add('need'); return null; } return { name: n, unit: $('#iUnit').value.trim(), active: $('#iAct').value }; },
    });
  }
  function setDests() {
    $('#setBody').innerHTML = `<h2>📍 ${t('គោលដៅ', 'Destinations')}</h2>
      <p class="hint">${t('បញ្ជីតែមួយ៖ ជួរឈរ Destination ក្នុងផ្ទាំង "Price List" (ប្រើរួមជាមួយ Debit Note)។ កែនៅក្នុង Sheet។', 'One list: the Destination column of the "Price List" tab, shared with the Debit Note. Edit it in the sheet.')}</p>
      ${B.sheetUrl ? `<a class="btn" href="${esc(B.sheetUrl)}" target="_blank" rel="noopener">📗 ${t('បើក Sheet', 'Open the sheet')}</a>` : ''}
      <div class="chips mt">${((B && B.dests) || []).map(d => `<span class="chip">${esc(d)}</span>`).join('') || `<div class="empty">—</div>`}</div>`;
  }
  function setScale() {
    const c = conn();
    const sel = (id, label, opts, v) => `<div class="field"><label class="f">${label}</label><select class="in" id="${id}">${opts.map(o => `<option value="${o[0]}"${String(o[0]) === String(v) ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></div>`;
    $('#setBody').innerHTML = `<h2>🔌 ${t('ការភ្ជាប់ជញ្ជីង (កុំព្យូទ័រនេះ)', 'Scale connection (this PC)')}</h2>
      <p class="hint">${t('Keli XK3118K8 ភ្ជាប់តាមខ្សែ USB serial។ បិទកម្មវិធីចាស់សិន ព្រោះមួយច្រកប្រើបានតែមួយកម្មវិធី។ ចុច "ភ្ជាប់" ហើយរើសច្រក (USB Serial / COM)។ កម្មវិធីនឹងចាំ ហើយភ្ជាប់ដោយខ្លួនឯងពេលក្រោយ។',
        'Keli XK3118K8 on the USB serial cable. Close the old scale program first: only one program can use the port. Press Connect and pick the port (USB Serial / COM). The app remembers it and connects by itself next time.')}</p>
      ${hasSerial() ? '' : `<div class="alert bad">${t('កម្មវិធីរុករកនេះមិនអាចភ្ជាប់ជញ្ជីងបានទេ។ ប្រើ Chrome ឬ Edge លើកុំព្យូទ័រ។', 'This browser cannot reach the scale. Use Chrome or Edge on a computer.')}</div>`}
      <div class="btns"><button type="button" class="btn ok" id="sConn">🔌 ${SER.on ? t('ភ្ជាប់ច្រកផ្សេង', 'Choose another port') : t('ភ្ជាប់ជញ្ជីង', 'Connect scale')}</button>${SER.on ? `<button type="button" class="btn" id="sOff">${t('ផ្តាច់', 'Disconnect')}</button>` : ''}</div>
      <div class="fgrid mt">
        ${sel('sBaud', 'Baud rate', [1200, 2400, 4800, 9600, 19200].map(v => [v, v]), c.baud)}
        ${sel('sBits', 'Data bits', [[8, 8], [7, 7]], c.bits)}
        ${sel('sPar', 'Parity', [['none', 'None'], ['even', 'Even'], ['odd', 'Odd']], c.parity)}
        ${sel('sStop', 'Stop bits', [[1, 1], [2, 2]], c.stop)}
        ${sel('sFmt', t('ទម្រង់ទិន្នន័យ', 'Data format'), [['auto', 'Auto'], ['keli', 'Keli continuous (=…, tF 0)'], ['stx', 'Keli STX frame (tF 1)'], ['line', 'One reading per line']], c.fmt)}
        ${sel('sMs', t('ទម្ងន់ឈប់ក្នុងរយៈ', 'Stable for'), [[1000, '1 s'], [1500, '1.5 s'], [2000, '2 s'], [3000, '3 s']], c.stableMs)}
      </div>
      <div class="btns"><button type="button" class="btn ok" id="sSave">💾 ${t('រក្សាទុក ហើយភ្ជាប់ឡើងវិញ', 'Save and reconnect')}</button></div>
      <h3 class="mt">${t('ទិន្នន័យពីជញ្ជីង (ផ្ទាល់)', 'Data from the scale (live)')}</h3>
      <div class="rawkg">${t('អានបាន', 'Read')}: <b id="rawKg">—</b></div>
      <pre class="raw" id="rawBox">—</pre>
      <p class="hint">${t('បើលេខខុស សូមប្តូរ Baud rate ឬទម្រង់ ហើយមើលម្តងទៀត។ ផ្ញើរូបប្រអប់នេះមក Claude ប្រសិនបើមិនទាន់ត្រូវ។', 'If the number is wrong, change the baud rate or format and look again. Send a screenshot of this box to Claude if it is still wrong.')}</p>
      <h3 class="mt">🧪 ${t('ម៉ាស៊ីនសាកល្បង (បណ្តុះបណ្តាល)', 'Simulator (training)')}</h3>
      <p class="hint">${t('សាកល្បងដោយគ្មានជញ្ជីង។ ប័ណ្ណមានសញ្ញា TEST។', 'Try the app without the scale. Tickets are marked TEST.')}</p>
      <div class="btns"><label class="chip${SIM.on ? ' on' : ''}"><input type="checkbox" id="simOn"${SIM.on ? ' checked' : ''}> ${t('បើក', 'On')}</label>
        <input type="range" id="simKg" min="0" max="50000" step="10" value="${SIM.target}" ${SIM.on ? '' : 'disabled'}><b id="simV">${kg(SIM.target)} kg</b></div>`;
    $('#sConn').onclick = () => serialStart(true).then(setScale);
    if ($('#sOff')) $('#sOff').onclick = () => serialStop().then(setScale);
    $('#sSave').onclick = () => {
      set('sc_conn', JSON.stringify({ baud: +$('#sBaud').value, bits: +$('#sBits').value, parity: $('#sPar').value, stop: +$('#sStop').value, fmt: $('#sFmt').value, stableMs: +$('#sMs').value }));
      SER.st.setMs(+$('#sMs').value);
      toast(t('បានរក្សាទុក', 'Saved'));
      if (SER.on) serialStart(false).then(setScale);
    };
    $('#simOn').onchange = e => { if (e.target.checked) simStart(); else simStop(); setScale(); };
    $('#simKg').oninput = e => { SIM.target = +e.target.value; $('#simV').textContent = kg(SIM.target) + ' kg'; };
    paintLcd();
  }
  function setRules() {
    const s = S();
    $('#setBody').innerHTML = `<h2>⚠️ ${t('ការព្រមាន & ប័ណ្ណ', 'Warnings & ticket')}</h2>
      <div class="fgrid">
        ${inp('rPct', t('ព្រមានពេលទម្ងន់ទទេខុសពីបញ្ជីឡានលើស (%)', 'Warn when the empty weight differs from the truck list by more than (%)'), s.SCALE_TARE_PCT, 'inputmode="numeric"')}
        ${inp('rMin', t('ទម្ងន់តិចជាងនេះ មិនយក (kg)', 'Ignore weights below (kg)'), s.SCALE_MIN_KG, 'inputmode="numeric"')}
        ${inp('rPre', t('ផ្នែកដំបូងនៃលេខប័ណ្ណ', 'Ticket number prefix'), s.SCALE_PREFIX)}
        ${inp('rCo', t('ឈ្មោះលើប័ណ្ណ', 'Name on the ticket'), s.SCALE_COMPANY)}
        ${inp('rSign', t('ប្រអប់ហត្ថលេខា (ក្បៀស)', 'Signature boxes (comma separated)'), s.SCALE_SIGN)}
      </div>
      <p class="hint">${t('ការព្រមានលើសទម្ងន់ ប្រើ Max Gross (kg) ក្នុងបញ្ជីឡាន។', 'The overload warning uses Max Gross (kg) in the truck list.')}</p>
      <h3>📄 ${t('គំរូប័ណ្ណ Word', 'Ticket template (Word)')}</h3>
      <div class="field"><label class="f" for="rTpl">${t('Link Google Drive របស់ឯកសារ Word (ឬ Folder)', 'Google Drive link of the Word file (or its folder)')}</label>
        <input class="in" id="rTpl" autocomplete="off" placeholder="https://drive.google.com/file/d/..." value="${esc(s.SCALE_TEMPLATE_LINK || '')}"></div>
      <p class="hint">${t('ទុកទទេ = ប្រើប័ណ្ណស្តង់ដារ។ ទាញយកគំរូ កែក្នុង Word រក្សាពាក្យ {{...}} ហើយដាក់ក្នុង Drive។ រូប QR ត្រូវមាន Alt Text "QR"។ Font ក្នុង Word (ឧ. MiSans Khmer) ត្រូវភ្ជាប់ក្នុងឯកសារ (Word › Options › Save › Embed fonts) ឬដំឡើងលើកុំព្យូទ័រនេះ។',
        'Empty = the standard ticket. Download the template, change it in Word keeping the {{...}} words, then put it in Drive. The QR picture keeps the alt text "QR". The fonts used in the Word file (e.g. MiSans Khmer) must be embedded in it (Word › Options › Save › Embed fonts) or installed on this PC.')}
        <a href="scale-ticket-template.docx" download>⬇ scale-ticket-template.docx</a></p>
      <details class="hint"><summary>${t('ពាក្យ {{...}} ដែលប្រើបាន', 'Words you can use')}</summary>
        <span class="mono">{{TicketNo}} {{Date}} {{TruckNo}} {{Company}} {{Item}} {{Destination}} {{DN}} {{DNCount}} {{Note}} {{Weight1}} {{Time1}} {{Source1}} {{Weight2}} {{Time2}} {{Source2}} {{Gross}} {{Tare}} {{Net}} {{Warning}} {{Operator}} {{Status}} {{Printed}} {{CompanyName}} {{Customer}} {{Driver}} {{Type}}</span></details>
      <div class="field mt"><label class="f" for="rTpl5">${t('Link គំរូ A5 (មិនចាំបាច់)', 'Link of the A5 template (optional)')}</label>
        <input class="in" id="rTpl5" autocomplete="off" placeholder="https://drive.google.com/file/d/..." value="${esc(s.SCALE_TEMPLATE_A5_LINK || '')}"></div>
      <p class="hint">${t('ទុកទទេ = គំរូ A4 បង្រួមជា A5 ដោយខ្លួនឯង។ ចុច "ច្បាប់ចម្លង A5" ដើម្បីទាញយក កែក្នុង Word ហើយដាក់ក្នុង Drive។',
        'Empty = the A4 template shrunk to A5 by itself. Press "A5 copy" to download it, change it in Word, then put it in Drive.')}</p>
      <div class="field mt"><span class="f">${t('ក្រដាសរបស់ម៉ាស៊ីនបោះពុម្ព (កុំព្យូទ័រនេះ)', 'Printer paper (this PC)')}</span>
        <div class="chips" style="display:flex;gap:8px;flex-wrap:wrap"><label class="chip"><input type="radio" name="rPaper" value="A4"${paper() === 'A4' ? ' checked' : ''}> A4</label>
        <label class="chip"><input type="radio" name="rPaper" value="A5"${paper() === 'A5' ? ' checked' : ''}> A5</label></div></div>
      ${s.SCALE_TEMPLATE_LINK ? `<div class="btns mt"><button type="button" class="btn" id="rA5">📄 ${t('ទាញយកច្បាប់ចម្លង A5 (Word)', 'Download an A5 copy (Word)')}</button>
        <button type="button" class="btn" id="rTest">🧪 ${t('សាកល្បងគំរូ (PDF)', 'Test the template (PDF)')}</button></div>` : ''}
      <div class="mt"></div><label class="chip mt"><input type="checkbox" id="rAuto"${get('sc_autoprint') === '1' ? ' checked' : ''}> ${t('បោះពុម្ពដោយខ្លួនឯង ក្រោយថ្លឹងលើកទី២ (កុំព្យូទ័រនេះ)', 'Print by itself after the 2nd weigh (this PC)')}</label>
      <div class="btns mt"><button type="button" class="btn ok" id="rSave">💾 ${t('រក្សាទុក', 'Save')}</button></div>`;
    $('#rAuto').onchange = e => set('sc_autoprint', e.target.checked ? '1' : null);
    document.querySelectorAll('input[name="rPaper"]').forEach(r => { r.onchange = () => { set('sc_paper', r.value === 'A5' ? 'A5' : null); toast(t('ក្រដាស ', 'Paper ') + r.value); if (tplOn()) tplLoad().catch(() => {}); }; });
    if ($('#rA5')) $('#rA5').onclick = async () => {
      const b = $('#rA5'); busy(b, true);
      try { await a5Copy(); } catch (e) { toast(e.message); }
      busy(b, false);
    };
    $('#rSave').onclick = async () => {
      const b = $('#rSave'); busy(b, true);
      try {
        const r = await api('scSettings', { SCALE_TARE_PCT: $('#rPct').value, SCALE_MIN_KG: $('#rMin').value, SCALE_PREFIX: $('#rPre').value.replace(/[^0-9A-Za-z]/g, '') || 'WB', SCALE_COMPANY: $('#rCo').value, SCALE_SIGN: $('#rSign').value, SCALE_TEMPLATE_LINK: $('#rTpl').value.trim(), SCALE_TEMPLATE_A5_LINK: $('#rTpl5').value.trim() });
        B.settings = r.settings; set('sc_boot', JSON.stringify(B)); toast(t('បានរក្សាទុក', 'Saved'));
        if (tplOn()) tplLoad(true).catch(e => toast(e.message)); else { ['A4', 'A5'].forEach(z => { TPL[z] = null; tplCache(z, null); }); }
        setRules();
        return;
      } catch (e) { toast(e.message); }
      busy(b, false);
    };
    if ($('#rTest')) $('#rTest').onclick = async () => {
      const b = $('#rTest'); busy(b, true);
      const x = tickets().filter(k => k.status === 'Done').sort((a, c) => String(c.t2).localeCompare(String(a.t2)))[0] ||
        { cid: 'test', no: 'WB-TEST-001', status: 'Done', plate: '3B-5956', company: 'ISI Steel', item: 'Steel pipe', dns: ['8000123', '8000124'], dest: 'Phnom Penh', note: 'Test', w1: 32440, t1: iso(new Date()), s1: 'Scale', w2: 11300, t2: iso(new Date()), s2: 'Scale', gross: 32440, tare: 11300, net: 21140, warn: '', op: me().name || '' };
      try {
        await tplLoad(true);
        const u = URL.createObjectURL(pdfBlob(await tplPdf(x)));
        const a = document.createElement('a'); a.href = u; a.download = 'template-test.pdf'; document.body.appendChild(a); a.click(); a.remove();
        toast('✅ ' + t('គំរូដំណើរការ', 'The template works'));
      } catch (e) { toast(e.message); }
      busy(b, false);
    };
  }

  // ---------------------------------------------------------------- start
  function showBlocked(e) {
    $('#view').innerHTML = `<div class="card done"><div class="emoji">🔒</div><h2>${e.code === 'AUTH' ? t('សូមចូលគណនីនៅទំព័រដើម', 'Please sign in on the home menu') : t('មិនទាន់មានសិទ្ធិ', 'No access yet')}</h2>
      <p>${esc(e.message)}</p><a class="btn ok" href="../">${t('ទៅទំព័រដើម', 'Go to the home menu')}</a></div>`;
  }
  if (DEMO) { $('#demo').hidden = false; $('#demo').textContent = t('DEMO · ឧទាហរណ៍ប៉ុណ្ណោះ មិនរក្សាទុកក្នុង Google Sheet ទេ', 'DEMO · sample only, nothing is saved to the Google Sheet'); }
  if (window.LANG) { LANG.button($('#langBtn')); LANG.onChange(() => { paintStatic(); route(); }); }
  paintStatic();
  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const paintTheme = () => { const th = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); $('#themeBtn').textContent = th === 'dark' ? '☀️' : '🌙'; };
  $('#themeBtn').onclick = () => { const now = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); const next = now === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); set('fr_theme', next); paintTheme(); };
  paintTheme();
  window.ISTEEL_REFRESH = () => refresh();
  paintSync();
  if (!DEMO && !signedIn()) showBlocked({ code: 'AUTH', message: t('ការចូលគណនីត្រូវធ្វើនៅទំព័រដើម STEEL។', 'Sign in once on the STEEL home menu, then come back.') });
  else { if (B) paintTabs(); route(); refresh().then(flush).then(() => tplLoad()).catch(() => {}); }
  if (window.LIVE && !DEMO) LIVE.start({ run: () => refresh(true).then(flush), busy: () => /^#\/?set/.test(location.hash) });
  serialStart(false);                            // reconnects to the port picked last time (no prompt)
  setInterval(() => { if (SER.on || SIM.on) lcdSoon(); if ($('#site')) paintLists(); }, 30000);
  setInterval(() => { if (SER.on && Date.now() - SER.last > 3000) lcdSoon(); }, 1000);

  // ---------------------------------------------------------------- demo (no API_URL, or ?demo=1)
  async function demoApi(action, p) {
    await new Promise(r => setTimeout(r, 200));
    const db = getJ('sc_demo', null) || {
      trucks: [{ plate: '3B-5956', company: 'ISI Steel', drivers: ['02.កាំង វណ្ណា'], type: 'Crane truck', empty: 11300, max: 25000 },
        { plate: '3C-4266', company: 'ISI Steel', drivers: ['01.ទូច អេ'], type: 'Crane truck', empty: 10400, max: 24000 },
        { plate: '3F-8691', company: '3PL #1', drivers: [], type: '10-wheel', empty: '', max: '' }],
      customers: [['6100000002', '000002-Hun Bonita'], ['6100000005', '000005-ក្រុមហ៊ុន ហ្វូស៊ីន ស្ទីល ប៊ីលឌីង ឯ.ក']],
      items: [['Steel pipe', 'kg', 'Yes'], ['Steel coil', 'kg', 'Yes'], ['Scrap', 'kg', 'Yes']],
      dests: ['KPC Branch', 'Kampong Cham', 'Siem Reap'], tickets: [],
      settings: { SCALE_TARE_PCT: '5', SCALE_MIN_KG: '200', SCALE_PREFIX: 'WB', SCALE_SIGN: 'Weigher, Driver, Security', SCALE_COMPANY: 'ISI STEEL', SCALE_TEMPLATE_LINK: '' },
    };
    const keep = () => set('sc_demo', JSON.stringify(db));
    const u = { name: 'Kim (demo)', email: 'kim@demo', admin: true, reviewer: true };
    if (action === 'scBoot') return { user: u, trucks: db.trucks, customers: db.customers, items: db.items, dests: db.dests, settings: db.settings, tickets: db.tickets, lastTare: {}, sheetUrl: '' };
    if (action === 'scSave') {
      const out = [];
      p.ops.forEach(op => {
        const o = Object.assign({}, op); delete o.pdf; delete o.reason;
        const i = db.tickets.findIndex(x => x.cid === o.cid);
        if (o.w1 !== '' && o.w2 !== '' && o.w2 != null) { o.gross = Math.max(o.w1, o.w2); o.tare = Math.min(o.w1, o.w2); o.net = o.gross - o.tare; }
        if (i >= 0) db.tickets[i] = o; else db.tickets.push(o);
        if (!db.trucks.some(x => normP(x.plate) === normP(o.plate))) db.trucks.push({ plate: o.plate, company: o.company, drivers: [], type: '', empty: o.status === 'Done' ? o.tare : '', max: '' });
        out.push({ cid: o.cid, no: o.no });
      });
      keep();
      return { saved: out };
    }
    if (action === 'scList') return { tickets: db.tickets.filter(x => String(x.t1).slice(0, 10) >= p.from && String(x.t1).slice(0, 10) <= p.to) };
    if (action === 'scMaster') {
      let added = 0, changed = 0;
      p.rows.forEach(r => {
        if (p.kind === 'truck') { const x = db.trucks.find(y => normP(y.plate) === normP(r.plate)); if (x) { Object.assign(x, r); changed++; } else { db.trucks.push(Object.assign({ drivers: [] }, r)); added++; } }
        if (p.kind === 'customer') { const i = db.customers.findIndex(c => c[0] === r.id || c[1] === r.name); if (i >= 0) { db.customers[i] = [r.id, r.name]; changed++; } else { db.customers.push([r.id, r.name]); added++; } }
        if (p.kind === 'item') { const i = db.items.findIndex(c => c[0] === r.name); if (i >= 0) { db.items[i] = [r.name, r.unit, r.active]; changed++; } else { db.items.push([r.name, r.unit, r.active]); added++; } }
      });
      keep();
      return { added, changed, trucks: db.trucks, customers: db.customers, items: db.items };
    }
    if (action === 'scSettings') { ['SCALE_TEMPLATE_LINK', 'SCALE_TEMPLATE_A5_LINK'].concat(Object.keys(db.settings)).forEach(k => { if (p[k] !== undefined) db.settings[k] = p[k]; }); keep(); return { settings: db.settings }; }
    throw Object.assign(new Error('Unknown action'), { code: 'BAD' });
  }
})();
