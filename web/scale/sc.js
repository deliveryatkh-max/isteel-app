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
  // Khmer digits ០១២៣៤៥៦៧៨៩ (a barcode scanner with the Khmer keyboard on) become 0-9 (Kim, 8 Nov 2026)
  const khNum = s => String(s || '').replace(/[\u17E0-\u17E9]/g, c => String(c.charCodeAt(0) - 0x17E0));
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
  // DN is required when the truck came to load goods, and not when it came to unload (Kim, 8 Nov 2026): only the tick decides.
  const dnNeed = sel => !!sel && (F.type || sel.type || 'Out') !== 'In';

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
      // Auto mode: the port used last time, else the USB cable with the same ids as last time, else the only one allowed.
      const id = getJ('sc_port', null), same = p => { try { const i = p.getInfo(); return id && i.usbVendorId === id.v && i.usbProductId === id.p; } catch (e) { return false; } };
      const port = ask ? await navigator.serial.requestPort() : (ports.indexOf(SER.lastPort) >= 0 ? SER.lastPort : ports.filter(same)[0] || ports[0]);
      SER.off = false;
      if (!port) { paintLcd(); return; }
      await serialStop();
      const c = conn();
      await port.open({ baudRate: +c.baud, dataBits: +c.bits, parity: c.parity, stopBits: +c.stop, bufferSize: 65536 });
      try { const i = port.getInfo(); set('sc_port', JSON.stringify({ v: i.usbVendorId, p: i.usbProductId })); } catch (e) { /* no USB ids */ }
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
        for (;;) { const r = await reader.read(); if (r.done) break; if (SER.err && /overrun|break|framing|parity/i.test(SER.errRaw || '')) { SER.err = ''; SER.errRaw = ''; } onBytes(r.value); }
      } catch (e) {
        // Buffer overrun = the scale sent faster than the page read (busy PC, tab in the background): some readings
        // were dropped, the loop opens a new reader and goes on. Not worth a red message (Kim, 8 Nov 2026).
        if (/overrun/i.test(e.name + ' ' + e.message)) { SER.buf = ''; continue; }
        SER.err = e.message; SER.errRaw = e.name + ' ' + e.message;
      }
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
  // Keep the scale connected without pressing anything (Kim, 8 Nov 2026): when the app opens, when the cable is
  // plugged back in, when the PC wakes up, and every 5 s while it is lost. Only "Disconnect" stops it.
  let autoBusy = false;
  async function autoConnect() {
    if (!hasSerial() || SER.on || SER.off || SIM.on || SER.finding || autoBusy) return;
    autoBusy = true;
    try { if ((await navigator.serial.getPorts()).length) await serialStart(false); } catch (e) { /* try again later */ }
    autoBusy = false;
  }
  if (hasSerial()) {
    navigator.serial.addEventListener('connect', () => setTimeout(autoConnect, 1000));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) autoConnect(); });
    setInterval(autoConnect, 5000);
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
    return { kg: w, stable, src: SIM.on ? 'Simulator' : 'Scale', ok: stable && w != null && w >= min, live, min };
  }
  /** Says exactly why a weight can't be saved: no data, still moving, or under the minimum (Kim, 8 Nov 2026). */
  function whyNot(w) {
    if (!w.live || w.kg == null) return t('មិនទាន់មានទម្ងន់ពីជញ្ជីង', 'No weight from the scale yet');
    if (!w.stable) return t('សូមរង់ចាំទម្ងន់មានលំនឹង', 'Wait until the weight is STABLE');
    return t('ទម្ងន់ ' + kg(w.kg) + ' kg តិចជាងអប្បបរមា ' + kg(w.min) + ' kg។ Admin ប្តូរបាននៅ ការកំណត់ › ការព្រមាន & ប័ណ្ណ។', 'The weight ' + kg(w.kg) + ' kg is below the minimum ' + kg(w.min) + ' kg. An Admin can change it in Settings › Warnings & ticket.');
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
          const s = ((r && r.saved) || [])[0] || {};   // an older server copy may answer without the list; the ticket is saved all the same
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
  function paintTabs() { const st = $('.tab[data-r="set"]'); if (st) st.hidden = !isAdmin(); const dc = $('.tab[data-r="dnc"]'); if (dc) dc.hidden = !canDnc(); }

  // ---------------------------------------------------------------- router
  let screen = () => {};
  function route() {
    document.body.classList.remove('freeze'); $('#view').style.height = '';
    const h = location.hash.replace(/^#\/?/, '');
    const top = h.split('/')[0] || 'home';
    $$('.tab[data-r]').forEach(a => a.classList.toggle('on', top === a.dataset.r || (top === 't' && a.dataset.r === 'list')));
    if (!B) { $('#view').innerHTML = '<div class="spinner"></div>'; screen = route; return; }
    if (top === 'list') return renderList();
    if (top === 'tat') return renderTat();
    if (top === 'dnc') return renderDnc();
    if (top === 't') return renderTicket(decodeURIComponent(h.slice(2).split('?')[0]));
    if (top === 'set') return isAdmin() ? renderSettings(h.split('/')[1] || 'trucks') : (location.hash = '#/');
    return renderHome();
  }
  window.addEventListener('hashchange', route);
  // the frozen scale display and filters sit right under the banner, whatever its height
  const barH = () => { const b = $('.bar'); if (b) document.documentElement.style.setProperty('--barh', b.offsetHeight + 'px'); };
  barH(); window.addEventListener('resize', barH);

  // ---------------------------------------------------------------- pickers (search, "+ Add new", like the Fuel app)
  const destsOf = s => String(s || '').split(/\s*,\s*/).filter(Boolean);
  // Phnom Penh is first in the Destination list (Kim, 10 Nov 2026; not ticked by default)
  const homeDest = () => { const l = (B && B.dests) || []; return l.find(v => /^12\s*PNH\b/i.test(v)) || l.find(v => v.indexOf('ភ្នំពេញ') >= 0) || ''; };
  const destList = () => { const l = (B && B.dests) || [], h = homeDest(); return h ? [h].concat(l.filter(v => v !== h)) : l; };
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
  const EMPTY_F = () => ({ cid: '', plate: '', company: '', customer: '', item: '', type: 'Out', dns: [], dnkg: {}, driver: '', dest: '', note: '', load: get('sc_load') || LOAD_DEF });
  const LOAD_DEF = 'ISI Steel';   // loading place when this PC has none set (Kim, 8 Nov 2026)
  // Loading place (Kim, 6 Nov 2026: trucks load somewhere else too, not only KMH1): this PC's own place by default.
  const places = () => { const s = []; [get('sc_load'), LOAD_DEF].concat((B && B.dests) || [], tickets().map(x => x.load)).forEach(v => { if (v && s.indexOf(v) < 0) s.push(v); }); return s.map(v => ({ v })); };
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
    document.body.classList.add('wide', 'freeze');
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
      </div>`;   // the "Today" card was removed from this page (Kim, 8 Nov 2026): today's tickets are under Tickets
    $('#siteQ').oninput = e => { SITEQ = e.target.value; paintLists(); };
    paintForm(); paintLcd(); paintLists();
    // The waiting list ends level with the form and scrolls by itself (Kim, 8 Nov 2026)
    if (window.ResizeObserver) new ResizeObserver(fitSite).observe($('#formCard'));
  }
  /** The whole weigh screen stays still on the scale PC (Kim, 8 Nov 2026): the page fits the window, only the lists scroll. */
  function fitFreeze() {
    const v = $('#view');
    if (!document.body.classList.contains('freeze') || window.innerWidth <= 980) { v.style.height = ''; return false; }
    window.scrollTo(0, 0);
    v.style.height = Math.max(520, window.innerHeight - v.getBoundingClientRect().top - 8) + 'px';
    return true;
  }
  function fitSite() {
    if (fitFreeze()) { const tb0 = $('#site .tbl'); if (tb0) tb0.style.maxHeight = ''; return; }
    const f = $('#formCard'), tb = $('#site .tbl');
    if (!f || !tb) return;
    if (window.innerWidth <= 980) { tb.style.maxHeight = ''; return; }
    const hint = $('#site .hint');
    const h = f.getBoundingClientRect().bottom - tb.getBoundingClientRect().top - (hint ? hint.offsetHeight + 10 : 0) - 25;
    tb.style.maxHeight = Math.max(220, Math.round(h)) + 'px';
  }
  window.addEventListener('resize', () => { fitSite(); fitTables(); });
  // Table headers and filter bars always stay frozen (Kim, 8 Nov 2026): a long table scrolls inside its own box,
  // which ends at the bottom of the window, so the filters above it and its header row never move away.
  function fitTables() {
    $$('.tbl.fit').forEach(tb => {
      const top = tb.getBoundingClientRect().top + window.scrollY;
      tb.style.maxHeight = Math.max(280, Math.round(window.innerHeight - top - 20)) + 'px';
    });
  }
  let fitQ = 0;
  new MutationObserver(() => { cancelAnimationFrame(fitQ); fitQ = requestAnimationFrame(fitTables); }).observe($('#view'), { childList: true, subtree: true });

  // ---------------------------------------------------------------- truck info + photo (Kim, 8 Nov 2026)
  /** A Drive link becomes an image address the page can show; any other https link is used as it is. */
  function photoSrc(u) {
    u = String(u || '').trim();
    const m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=|thumbnail\?id=)([\w-]{20,})/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w800';
    return /^(https:\/\/|data:image\/)/.test(u) ? u : '';
  }
  /** dd-mm-yyyy or yyyy-mm-dd → days from today (negative = past), or null. */
  function daysTo(d) {
    let m = String(d || '').match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/), dt = null;
    if (m) dt = new Date(+m[3], +m[2] - 1, +m[1]);
    else if ((m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/))) dt = new Date(+m[1], +m[2] - 1, +m[3]);
    if (!dt) return null;
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    return Math.round((dt - t0) / 86400000);
  }
  function truckInfoHtml(tr) {
    // Four lines only (Kim, 8 Nov 2026): company; vehicle weight, max load, max gross; axles; loading rules.
    const i = tr.info || {}, src = photoSrc(tr.photo);
    const kgv = v => { const n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return v !== '' && v != null && isFinite(n) && n > 0 ? kg(Math.round(n)) : '—'; };
    const ax = i.axles ? String(+String(i.axles).replace(/[^0-9.]/g, '') || i.axles) : '—';
    const rules = [i.r1, i.r2, i.r3].filter(Boolean);
    return `<div class="tinfo" id="tInfo">
      <div class="ti-info">
        <div class="ti-head">🚚 <b class="mono">${esc(tr.plate)}</b></div>
        <div class="ti-row"><span>${t('ក្រុមហ៊ុន', 'Company')}</span><b>${esc(tr.company || '—')}</b></div>
        <div class="ti-w3">
          <div><span>${t('ទម្ងន់ឡាន (kg)', 'Vehicle Weight (kg)')}</span><b>${kgv(tr.empty)}</b></div>
          <div><span>${t('ផ្ទុកអតិបរមា (kg)', 'Max. Load (kg)')}</span><b>${kgv(i.load)}</b></div>
          <div><span>${t('ទម្ងន់សរុបអតិបរមា (kg)', 'Max. Gross Weight (kg)')}</span><b>${kgv(tr.max)}</b></div>
        </div>
        <div class="ti-row"><span>${t('ចំនួនអ័ក្ស', 'Number of Axles')}</span><b>${esc(ax)}</b></div>
        <div class="ti-rules${rules.length ? '' : ' none'}"><b>📏 ${t('ច្បាប់ផ្ទុកទំនិញ', 'Loading Rule')}</b>${rules.length ? `<ul>${rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ` —`}</div>
      </div>
      <div class="ti-photo">
        ${src ? `<img src="${esc(src)}" alt="${esc(tr.plate)}" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false">` : ''}
        <div class="ti-nophoto"${src ? ' hidden' : ''}>📷<br>${t('មិនទាន់មានរូបថត', 'No photo yet')}</div>
        ${isAdmin() ? `<label class="btn ti-add">📷 ${src ? t('ប្តូររូបថត', 'Change photo') : t('បន្ថែមរូបថត', 'Add photo')}<input type="file" id="tiPhotoIn" accept="image/*" hidden></label>` : ''}
      </div>
    </div>`;
  }
  /** Shrinks the photo to 1280 px JPEG on this PC, then saves it to the truck (Admin). */
  async function truckPhoto(plate, file) {
    const lab = $('.ti-add');
    if (lab) lab.classList.add('busy');
    try {
      const url = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });
      const img = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = url; });
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const r = await api('scTruckPhoto', { plate, img: cv.toDataURL('image/jpeg', 0.82) });
      B.trucks = r.trucks; set('sc_boot', JSON.stringify(B));
      toast('✅ ' + t('បានរក្សាទុករូបថត', 'Photo saved'));
    } catch (e) { toast(e.message || t('មិនអាចបើករូបថត', 'Could not open the photo')); }
    paintForm();
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
        ${sel ? `<button type="button" class="btn newtruck" id="newBtn">➕ ${t('ថ្លឹងឡានថ្មី', 'New truck')}</button>` : ''}</h2>
      <div class="fgrid toprow">
      <div class="field"><span class="f lc-blue">🔄 ${t('ឡានមកដើម្បី', 'The truck comes to')}</span>
        <div class="chips jobchips">${[['Out', '⬆️ ឡើងទំនិញ', '⬆️ Load'], ['In', '⬇️ ទំលាក់ទំនិញ', '⬇️ Unload']].map(o => `<label class="chip${(F.type || 'Out') === o[0] ? ' on' : ''}"><input type="radio" name="fJob" value="${o[0]}"${(F.type || 'Out') === o[0] ? ' checked' : ''}> ${t(o[1], o[2])}</label>`).join('')}</div></div>
      ${sel ? `<div class="field"><span class="f lc-teal">⛺ ${t('តង់', 'Canvas')} ${req}</span>
        <div class="chips jobchips${F.tarp ? '' : ' need'}" id="tarpBox">${[['Yes', '✅ គ្របតង់', '✅ Covered'], ['No', '❌ មិនគ្របតង់', '❌ Not covered']].map(o => `<label class="chip${F.tarp === o[0] ? ' on' : ''}"><input type="radio" name="fTarp" value="${o[0]}"${F.tarp === o[0] ? ' checked' : ''}> ${t(o[1], o[2])}</label>`).join('')}</div></div>` : ''}
      </div>
      <div class="fgrid">
        <div class="field"><label class="f lc-navy">🚚 ${t('លេខឡាន', 'Truck No')} ${req}</label><div class="clrwrap"><input class="in${need(F.plate)}${sel ? ' locked' : ''}" id="fPlate" autocomplete="off" value="${esc(F.plate)}" placeholder="3B-5956"${sel ? ' readonly tabindex="-1" title="' + t('មិនអាចប្តូរលេខឡាននៅលើកទី២', 'The truck number can\'t be changed at the 2nd weigh') + '"' : ''}>${sel ? '<span class="lockic" aria-hidden="true">🔒</span>' : F.plate ? `<button type="button" class="clr" id="fPlateClr" aria-label="Clear" title="${t('សម្អាត', 'Clear')}">✕</button>` : ''}</div>
          ${tr ? `<div class="hint">${tr.type ? esc(tr.type) + ' · ' : ''}${t('ទម្ងន់ទទេ', 'Empty')} ${tr.empty !== '' ? kg(tr.empty) + ' kg' : '—'} · ${t('កំណត់អតិបរមា', 'Max')} ${tr.max !== '' ? kg(tr.max) + ' kg' : '—'}${lastT ? ' · ' + t('ចុងក្រោយ', 'Last') + ' ' + kg(lastT) + ' kg' : ''}</div>`
            : F.plate ? `<div class="hint">🆕 ${t('ឡានថ្មី នឹងបន្ថែមក្នុងបញ្ជីឡាន', 'New truck: it will be added to the truck list')}</div>` : ''}</div>
        <div class="field"><label class="f lc-purple">🏢 ${t('ក្រុមហ៊ុនឡាន', 'Truck company')}</label><div><input class="in" id="fCompany" autocomplete="off" autocapitalize="characters" value="${esc(F.company)}"></div>
          <div class="hint">${t('ក្រុមហ៊ុនថ្មី: អក្សរអង់គ្លេសធំប៉ុណ្ណោះ', 'New company: English capital letters only')}</div></div>
        ${sel ? `<div class="field"><label class="f lc-orange">📦 ${t('ទំនិញ', 'Item')} ${req}</label><div><input class="in${need(F.item)}" id="fItem" autocomplete="off" value="${esc(F.item)}"></div></div>` : ''}
        ${sel ? `<div class="field"><label class="f lc-green">📍 ${t('គោលដៅ', 'Destination')} ${req}</label>
          <div class="dnbox destbox" id="destTags"${destsOf(F.dest).length ? '' : ' hidden'}></div>
          <div class="search"><input class="in ddl${!destsOf(F.dest).length ? ' need' : ''}" id="fDest" autocomplete="off" value=""><div class="sugg msel" id="destBox" hidden></div></div></div>` : ''}
        ${sel ? `<div class="field span2"><label class="f lc-pink">🧾 ${t('លេខ DN', 'DN No')}${dnNeed(sel) ? ' ' + req : ''}</label>
          <div class="dnbox in${dnNeed(sel) && !F.dns.length ? ' need' : ''}" id="dnBox">${F.dns.map((d, i) => `<span class="dn">${esc(d)}<button type="button" data-dn="${i}" aria-label="Remove">×</button></span>`).join('')}
            <input id="fDn" autocomplete="off" inputmode="text" placeholder="${t('វាយ ឬស្កេន DN ហើយចុច Enter', 'Type or scan a DN, press Enter')}"></div>
          ${F.dns.length ? `<div class="dnkg" id="dnKg"><table><tr><th>🧾 DN</th><th class="r">${t('ទម្ងន់លើ DN (kg)', 'Kg on the DN')} ${req}</th></tr>
            ${F.dns.map((d, i) => `<tr><td class="mono">${esc(d)}</td><td class="r"><input class="in dkin mono" data-dk="${i}" inputmode="numeric" autocomplete="off" value="${dnKgOf(F, d) || ''}"></td></tr>`).join('')}
            <tr class="tot"><td>${t('សរុប DN', 'DN total')}</td><td class="r mono" id="dnTot">—</td></tr></table><div id="dnCmp"></div></div>` : ''}</div>` : ''}
        <div class="field span2"><label class="f lc-grey">📝 ${t('កំណត់ចំណាំ', 'Note')}</label><input class="in" id="fNote" autocomplete="off" value="${esc(F.note)}"></div>
      </div>
      ${sel ? againRows(sel) : ''}
      <div id="warnBox"></div>
      <div class="btns">
        ${sel ? `<button type="button" class="btn big againbtn" id="agBtn">🔁 ${t('ថ្លឹងម្តងទៀត', 'Scale again')}</button><button type="button" class="btn ok big" id="w2Btn">⚖️ ${t('ថ្លឹងបញ្ចប់ + រក្សាទុក', 'Finish weigh + Save')}</button>`
              : `<button type="button" class="btn ok big" id="w1Btn">⚖️ ${t('ថ្លឹងលើកទី១', 'Weigh 1st')}</button>`}
      </div>
      ${canType() ? `<div class="manual">${MANUAL ? `<div class="alert bad">✍ ${t('ទម្ងន់វាយដោយដៃ', 'Typed weight')}: <b>${kg(MANUAL.kg)} kg</b> · ${esc(MANUAL.reason)} <button type="button" class="link" id="manOff">${t('បោះបង់', 'Cancel')}</button></div>`
        : `<button type="button" class="link" id="manOn">✍ ${manAll() ? t('វាយទម្ងន់ដោយដៃ', 'Type a weight') : t('វាយទម្ងន់ដោយដៃ (Admin)', 'Type a weight (Admin)')}</button>`}<div id="manBox"></div></div>` : ''}
      ${tr && !sel ? truckInfoHtml(tr) : ''}
      <div id="doneBox">${LASTDONE && !sel ? doneHtml(ticketBy(LASTDONE)) : ''}</div>`;

    const upd = (k, v) => { F[k] = v; keepForm(); };
    if ($('#tiPhotoIn')) $('#tiPhotoIn').onchange = e => { const f = e.target.files && e.target.files[0]; if (f) truckPhoto(tr.plate, f); };
    // Load or unload, ticked at the 1st weigh, Load by default (Kim, 8 Nov 2026). Unloading trucks need no DN.
    document.querySelectorAll('input[name="fJob"]').forEach(r => { r.onchange = () => { upd('type', r.value); paintForm(); }; });
    // Tarpaulin covered or not, ticked at the 2nd weigh (Kim, 8 Nov 2026)
    document.querySelectorAll('input[name="fTarp"]').forEach(r => { r.onchange = () => { upd('tarp', r.value); paintForm(); }; });
    // The truck number is fixed after the 1st weigh (Kim, 9 Nov 2026)
    if (!sel) picker($('#fPlate'), {
      list: () => trucks().map(x => ({ v: x.plate, sub: [x.company, x.type].filter(Boolean).join(' · ') })), addNew: true, fix: fixPlate,
      onPick: v => { const was = F.plate; upd('plate', v ? fixPlate(v) : ''); const tr2 = truckOf(v); if (tr2 && was !== F.plate) { F.company = tr2.company || F.company; if (tr2.drivers.length === 1) F.driver = tr2.drivers[0]; keepForm(); } paintForm(); },
    });
    // ✕ in the Truck No box clears the truck, its company and driver (Kim, 8 Nov 2026)
    if ($('#fPlateClr')) $('#fPlateClr').onclick = () => { const tr0 = truckOf(F.plate); F.plate = ''; if (!tr0 || F.company === tr0.company) F.company = ''; F.driver = ''; keepForm(); paintForm(); setTimeout(() => $('#fPlate') && $('#fPlate').focus(), 0); };
    const companies = () => { const s = []; trucks().forEach(x => { if (x.company && s.indexOf(x.company) < 0) s.push(x.company); }); return s.sort().map(v => ({ v })); };
    picker($('#fCompany'), { list: companies, addNew: true, fix: fixCompany, onPick: v => upd('company', v) });
    // Item and Destination are asked at the 2nd weigh only (Kim, 8 Nov 2026)
    if ($('#fItem')) picker($('#fItem'), { list: () => ((B && B.items) || []).filter(i => i[2] !== 'No').map(i => ({ v: i[0], sub: i[1] })), addNew: true, onPick: v => { upd('item', v); $('#fItem').classList.toggle('need', !v); } });
    // More than one destination can be picked (Kim, 8 Nov 2026); they are kept as one text "A, B".
    if ($('#fDest')) {
      // Tick several destinations straight in the list; it stays open until you click outside (Kim, 8 Nov 2026).
      const di = $('#fDest'), db = $('#destBox'), tags = $('#destTags');
      const setD = a => { upd('dest', a.join(', ')); di.classList.toggle('need', !a.length); paintTags(); };
      const paintTags = () => {
        const a = destsOf(F.dest);
        tags.hidden = !a.length;
        tags.innerHTML = a.map((d, i) => `<span class="dn">${esc(d)}<button type="button" data-dst="${i}" aria-label="Remove">×</button></span>`).join('');
        di.placeholder = a.length ? t('➕ ធីកគោលដៅទៀត', '➕ Tick another destination') : t('ធីកពីបញ្ជី (បានច្រើន)', 'Tick from the list (one or more)');
        if (!db.hidden) paintBox();
      };
      const paintBox = () => {
        const q = di.value.trim().toLowerCase(), a = destsOf(F.dest);
        const l = destList().filter(v => !q || v.toLowerCase().indexOf(q) >= 0);
        db.innerHTML = l.map(v => `<label class="opt mopt${a.indexOf(v) >= 0 ? ' on' : ''}"><input type="checkbox" value="${esc(v)}"${a.indexOf(v) >= 0 ? ' checked' : ''}> <span>${esc(v)}</span></label>`).join('')
          || `<div class="opt none">${t('រកមិនឃើញ', 'No match')}</div>`;
        db.hidden = false;
      };
      di.onfocus = paintBox; di.onclick = paintBox; di.oninput = paintBox;
      di.onkeydown = e => { if (e.key === 'Escape') db.hidden = true; };
      db.onmousedown = e => e.preventDefault();          // keep the box open while ticking
      db.onchange = e => { const v = e.target.value, a = destsOf(F.dest), i = a.indexOf(v); if (e.target.checked && i < 0) a.push(v); if (!e.target.checked && i >= 0) a.splice(i, 1); setD(a); };
      di.onblur = () => setTimeout(() => { db.hidden = true; di.value = ''; }, 150);
      tags.onclick = e => { const x = e.target.closest('[data-dst]'); if (x) { const a = destsOf(F.dest); a.splice(+x.dataset.dst, 1); setD(a); } };
      paintTags();
    }
    // Loading place is not asked on the weigh form (Kim, 8 Nov 2026): it is this PC's default, else ISI Steel; change it on the ticket page.
    $('#fNote').oninput = e => upd('note', e.target.value);
    const addDn = raw => {
      if (document.querySelector('.popwrap')) return;   // a message is open: the input's blur must not open a 2nd one
      if ($('#fDn')) $('#fDn').value = '';   // else repainting the form blurs the box and adds the same text again
      const used = [];
      khNum(raw).split(/[\s,;]+/).map(s => s.replace(/[^0-9A-Za-z\-\/]/g, '')).filter(Boolean).forEach(d => {
        const u = dnUsedBy(d);
        if (u) { used.push([d, u]); return; }   // one DN, one ticket (Kim, 9 Nov 2026)
        if (F.dns.indexOf(d) < 0 && F.dns.length < 30) F.dns.push(d);
      });
      keepForm(); paintForm();
      if (used.length) popup(used.map(x => `<p>⚠️ <b class="mono">${esc(x[0])}</b><br>${t('DN នេះបានប្រើរួចហើយ តាំងពី', 'This DN was used already since')} <b>${esc(x[1].date)}</b>${x[1].no ? ` · ${t('ប័ណ្ណ', 'ticket')} <span class="mono">${esc(x[1].no)}</span>` : ''}.</p>`).join(''), () => $('#fDn') && $('#fDn').focus());
      else setTimeout(() => $('#fDn') && $('#fDn').focus(), 0);   // scan every DN first, type the kg after (Kim, 10 Nov 2026)
    };
    const dn = $('#fDn');
    if (dn) {
    dn.oninput = () => { const v = khNum(dn.value); if (v !== dn.value) dn.value = v; };   // a scanner on the Khmer keyboard types ០-៩
    dn.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab' || e.key === ' ') { if (dn.value.trim()) { e.preventDefault(); addDn(dn.value); } else if (e.key === 'Enter') { const k = $$('[data-dk]').find(k => !k.value); if (k) { e.preventDefault(); k.focus(); } } }   // Enter on an empty box: to the first empty kg
      else if (e.key === 'Backspace' && !dn.value && F.dns.length) { F.dns.pop(); keepForm(); paintForm(); setTimeout(() => $('#fDn').focus(), 0); }
    };
    dn.onblur = () => { if (dn.value.trim()) addDn(dn.value); };
    dn.addEventListener('paste', e => { const s = (e.clipboardData || window.clipboardData).getData('text'); if (/[\s,;]/.test(s.trim())) { e.preventDefault(); addDn(s); } });
    $('#dnBox').onclick = e => { const x = e.target.closest('[data-dn]'); if (x) { F.dns.splice(+x.dataset.dn, 1); keepForm(); paintForm(); } else dn.focus(); };
    }
    $$('[data-dk]').forEach(k => {
      k.oninput = () => {
        const v = khNum(k.value).replace(/[^0-9]/g, '');
        if (v !== k.value) k.value = v;
        F.dnkg = F.dnkg || {};
        const d = F.dns[+k.dataset.dk];
        if (v) F.dnkg[d] = Number(v); else delete F.dnkg[d];
        k.classList.remove('need'); keepForm(); paintDnCmp();
      };
      k.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const n = $('[data-dk="' + (+k.dataset.dk + 1) + '"]') || $('#fDn'); if (n) n.focus(); } };
    });
    paintDnCmp();
    if ($('#newBtn')) $('#newBtn').onclick = () => { F = EMPTY_F(); keepForm(); PENDING = null; paintForm(); paintLcd(); };
    if ($('#w1Btn')) $('#w1Btn').onclick = weigh1;
    if ($('#w2Btn')) $('#w2Btn').onclick = () => weigh2(false);
    if ($('#agBtn')) $('#agBtn').onclick = scaleAgain;
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

  /** The ticket a DN is already on (another ticket, not cancelled), from this PC's tickets and the server's list of every DN used. */
  function dnUsedBy(d) {
    const x = tickets().filter(x => x.cid !== F.cid && x.status !== 'Void' && (x.dns || []).indexOf(d) >= 0)
      .sort((a, b) => String(a.t2 || a.t1).localeCompare(String(b.t2 || b.t1)))[0];
    if (x) return { date: dmy(x.t2 || x.t1), no: x.no || '' };
    const u = B && B.dnUsed && B.dnUsed[d];
    if (u && u[2] !== F.cid && !(LOC[u[2]] && LOC[u[2]].status === 'Void')) return { date: u[0] ? dmy(u[0]) : '', no: u[1] || '' };
    return null;
  }
  /** A message box with one OK button. */
  function popup(html, done) {
    const o = document.createElement('div');
    o.className = 'popwrap';
    o.innerHTML = `<div class="popbox" role="alertdialog">${html}<div class="btns"><button type="button" class="btn ok big" id="popOk">OK</button></div></div>`;
    document.body.appendChild(o);
    const close = () => { o.remove(); document.removeEventListener('keydown', key, true); if (done) done(); };
    const key = e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    o.querySelector('#popOk').onclick = close;
    setTimeout(() => document.addEventListener('keydown', key, true), 300);   // a scanner's own Enter must not close it at once
    o.querySelector('#popOk').focus();
  }
  function formOk(second) {
    const miss = [];
    if (!F.plate) miss.push('#fPlate');
    if (second && !F.item) miss.push('#fItem');
    if (second && !destsOf(F.dest).length) miss.push('#fDest');   // Destination required for every truck, load or unload (Kim, 9 Nov 2026)
    if (second && !F.tarp) miss.push('#tarpBox');
    if (second && !F.dns.length) {   // DN needed only when the truck leaves loaded (Out)
      if (dnNeed(ticketBy(F.cid)) || !ticketBy(F.cid)) miss.push('#dnBox');
    }
    if (second && F.dns.length) {   // the kg written on every DN (Kim, 10 Nov 2026)
      const e = $$('[data-dk]').filter(k => !dnKgOf(F, F.dns[+k.dataset.dk]));
      if (e.length) { e.forEach(k => k.classList.add('need')); miss.push('#dnKgMiss'); }
    }
    miss.forEach(s => $(s) && $(s).classList.add('need'));
    if (miss.length) { toast(t('សូមបំពេញប្រអប់ពណ៌ក្រហម', 'Fill in the red boxes')); return false; }
    return true;
  }
  // Typing a weight by hand: Admins always; everyone when an Admin ticks it in Settings (Kim, 10 Nov 2026). A reason is always needed.
  const manAll = () => String(S().SCALE_MANUAL_ALL || '').toLowerCase() === 'yes';
  const canType = () => isAdmin() || manAll();
  const fromForm = () => ({ plate: F.plate, company: F.company, customer: F.customer, item: F.item, type: F.type, dns: F.dns.slice(), dnkg: F.dns.reduce((o, d) => { const v = dnKgOf(F, d); if (v) o[d] = v; return o; }, {}), driver: F.driver, dest: F.dest, note: F.note, load: F.load || get('sc_load') || LOAD_DEF, tarp: F.tarp || '' });

  function weigh1() {
    if (!formOk(false)) return;
    const w = cur();
    if (!w.ok) { toast(whyNot(w)); return; }
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

  // "Scale again" (Kim's option A, 9 Nov 2026): a truck parked overnight is weighed again, as often as needed, before its 2nd weigh.
  const againTol = () => Math.max(0, Number(S().SCALE_AGAIN_KG) || 20);
  const lastAgain = x => (x && x.again && x.again.length ? x.again[x.again.length - 1] : null);
  /** A ticket still on site, printed with its last "Scale again" weight as the 2nd weight (Kim, 10 Nov 2026). Finished tickets print as they are. */
  function forPrint(x) {
    const c = x && x.status === 'Open' ? lastAgain(x) : null;
    if (!c) return x;
    const g = CORE.finish(Number(x.w1), Number(c.kg), truckOf(x.plate), S().SCALE_TARE_PCT);
    return Object.assign({}, x, { w2: c.kg, t2: c.t, s2: c.src || 'Scale', gross: g.gross, tare: g.tare, net: g.net, type: dirOf(x.w1, c.kg), agn: x.again.length });
  }
  const agCls = d => (Math.abs(d) <= againTol() ? 'same' : d > 0 ? 'heavy' : 'light');
  const agTxt = d => (Math.abs(d) <= againTol() ? t('ដូចមុន', 'Same as before') : d > 0 ? t('ធ្ងន់ជាងមុន', 'Heavier than before') : t('ស្រាលជាងមុន', 'Lighter than before'));
  const sgn = d => (d > 0 ? '+' : d < 0 ? '−' : '±') + kg(Math.abs(d));
  const againWarn = (sel, kgv) => { const a = lastAgain(sel), d = a ? Math.round(kgv - Number(a.kg)) : 0;
    return a && d > againTol() ? [{ km: 'ធ្ងន់ជាងការថ្លឹងម្តងទៀតចុងក្រោយ ' + sgn(d) + ' kg', en: 'Heavier than the last scale-again weight by ' + sgn(d) + ' kg' }] : []; };
  // DN kg check (Kim's option A, 10 Nov 2026): the weigher types the kg written on each DN; the DN total must match the
  // scale net within ± SCALE_DN_VAR_KG (120 kg unless an Admin changes it in Settings).
  const dnTol = () => { const v = S().SCALE_DN_VAR_KG; return v === '' || v == null || isNaN(Number(v)) ? 120 : Math.max(0, Number(v)); };
  const dnKgOf = (x, d) => { const v = x && x.dnkg ? Number(x.dnkg[d]) : 0; return v > 0 ? v : 0; };
  const dnSum = x => { const l = x.dns || []; return !l.length || l.some(d => !dnKgOf(x, d)) ? null : l.reduce((a, d) => a + dnKgOf(x, d), 0); };
  const dnCheck = x => { const s = dnSum(x); if (s == null || x.net === '' || x.net == null) return null; const d = Math.round(Number(x.net) - s); return { sum: s, d, ok: Math.abs(d) <= dnTol() }; };
  const dnList = x => (x.dns || []).map(d => (dnKgOf(x, d) ? d + ' (' + kg(dnKgOf(x, d)) + ' kg)' : d)).join(', ');
  const dnWarn = (sel, kgv) => { const s = dnSum(F); if (s == null) return []; const d = Math.round(Math.abs(kgv - Number(sel.w1)) - s);
    return Math.abs(d) > dnTol() ? [{ km: 'ទម្ងន់ DN សរុប ' + kg(s) + ' kg ខុសពីទម្ងន់សុទ្ធ ' + sgn(d) + ' kg (អនុញ្ញាត ±' + dnTol() + ' kg)', en: 'DN total ' + kg(s) + ' kg differs from the scale net by ' + sgn(d) + ' kg (allowed ±' + dnTol() + ' kg)' }] : []; };
  function paintDnCmp() {
    const box = $('#dnCmp');
    if (!box) return;
    const sel = ticketBy(F.cid), l = F.dns, ks = l.map(d => dnKgOf(F, d)), got = ks.filter(Boolean).length, sum = ks.reduce((a, b) => a + b, 0);
    const tot = got ? kg(sum) + ' kg' : '—';
    if ($('#dnTot') && $('#dnTot').textContent !== tot) $('#dnTot').textContent = tot;
    const w = cur(), net = sel && w.kg != null && sel.w1 !== '' && sel.w1 != null ? Math.abs(w.kg - Number(sel.w1)) : null;
    let h;
    if (got < l.length) h = `<div class="dncmp wait">🧮 ${t('វាយ kg ដែលសរសេរលើ DN នីមួយៗ', 'Type the kg written on each DN')} (${got}/${l.length})</div>`;
    else if (net == null) h = `<div class="dncmp wait">⚖️ ${t('រង់ចាំទម្ងន់ពីជញ្ជីង', 'Waiting for the scale weight')}</div>`;
    else {
      const d = Math.round(net - sum), ok = Math.abs(d) <= dnTol();
      h = `<div class="dncmp ${ok ? 'ok' : 'bad'}"><div><small>${t('សរុប DN', 'DN total')}</small><b>${kg(sum)}</b></div><div><small>${t('ទម្ងន់សុទ្ធជញ្ជីង', 'Scale net')}</small><b>${kg(net)}</b></div>
        <div><small>${t('ខុសគ្នា', 'Difference')}</small><b>${sgn(d)}</b></div><div class="vd"><b>${ok ? '✅ ' + t('ត្រូវគ្នា', 'Match') : '❌ ' + t('ខុសគ្នា', 'Variance')}</b><small>${t('អនុញ្ញាត', 'Allowed')} ±${kg(dnTol())} kg</small></div></div>`;
    }
    if (box._h !== h) { box._h = h; box.innerHTML = h; }
  }
  function scaleAgain() {
    const sel = ticketBy(F.cid);
    if (!sel || !formOk(false)) return;
    const w = cur();
    if (!w.ok) { toast(whyNot(w)); return; }
    const a = lastAgain(sel);
    if (a && Date.now() - new Date(a.t) < 60000 && Math.abs(Number(a.kg) - w.kg) <= againTol()) { toast(t('បានរក្សាទុករួចហើយ', 'Already saved')); return; }   // one tap = one row
    const c = { t: iso(new Date()), kg: w.kg, diff: Math.round(w.kg - (a ? Number(a.kg) : Number(sel.w1))), by: me().name || '', src: w.src };
    putTicket(Object.assign({}, sel, fromForm(), { again: (sel.again || []).concat(c) }));
    MANUAL = null; PENDING = null; LASTDONE = sel.cid;   // Print / PDF under the buttons, as after the 2nd weigh
    F = EMPTY_F(); keepForm();
    if (get('sc_autoprint') === '1') printTicket(forPrint(ticketBy(sel.cid)));
    toast('🔁 ' + sel.plate + ' · ' + kg(w.kg) + ' kg · ' + t('រក្សាទុកហើយ (មិនទាន់ចេញ)', 'saved, still on site'));
    paintForm(); paintLists(); paintLcd();
  }
  function againRows(x) {
    const l = x.again || [];
    return l.map((c, i) => `<div class="agrow">🔁 <span>${t('ថ្លឹងម្តងទៀត', 'Scale again')} #${i + 1}</span> <b class="mono">${kg(c.kg)} kg</b> <span class="muted">· ${dmy(c.t).slice(0, 5)} ${hm(c.t)}${c.by ? ' · ' + esc(c.by) : ''}</span>${i === l.length - 1 ? `<span class="agnow">${t('ឥឡូវ', 'Now')} <b id="agNow" class="agd">—</b></span>` : ''}</div>`).join('');
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
    if (!w.ok) { toast(whyNot(w)); return; }
    const f = CORE.finish(Number(sel.w1), w.kg, truckOf(F.plate), S().SCALE_TARE_PCT);
    f.warn = f.warn.concat(againWarn(sel, w.kg), dnWarn(sel, w.kg));   // heavier than the last "Scale again" (Kim, 9 Nov 2026)
    if (f.warn.length && !force) { PENDING = { kg: w.kg, src: w.src, warn: f.warn }; paintWarn(); return; }
    const use = force && PENDING ? PENDING : { kg: w.kg, src: w.src, warn: f.warn };
    const g = CORE.finish(Number(sel.w1), use.kg, truckOf(F.plate), S().SCALE_TARE_PCT);
    g.warn = g.warn.concat(againWarn(sel, use.kg), dnWarn(sel, use.kg));
    const ds = dnSum(F);
    const reason = [sel.reason, use.src === 'Manual' && MANUAL ? MANUAL.reason : ''].filter(Boolean).join(' · ');
    const tk = Object.assign({}, sel, fromForm(), { type: dirOf(sel.w1, use.kg), status: 'Done', w2: use.kg, t2: iso(new Date()), s2: use.src, gross: g.gross, tare: g.tare, net: g.net,
      warn: g.warn.map(x => x.en).join(' | '), reason: reason, dnTot: ds == null ? '' : ds, dnVar: ds == null ? '' : g.net - ds });
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
    tk = forPrint(tk);
    if (tk.agn) return `<div class="donebox"><div><b>🔁 ${esc(tk.no)}</b> · ${esc(tk.plate)} · ${t('ថ្លឹងម្តងទៀត', 'Scale again')} <b>${kg(tk.w2)} kg</b> · ${t('សុទ្ធ', 'Net')} <b>${kg(tk.net)} kg</b> <span class="badge follow">${t('មិនទាន់ចេញ', 'Still on site')}</span></div>
      <div class="btns"><button type="button" class="btn ok" data-print="${esc(tk.cid)}">🖨 ${t('បោះពុម្ព', 'Print')}</button><button type="button" class="btn" data-pdf="${esc(tk.cid)}">📄 PDF</button></div></div>`;
    return `<div class="donebox"><div><b>✅ ${esc(tk.no)}</b> · ${esc(tk.plate)} · ${t('សុទ្ធ', 'Net')} <b>${kg(tk.net)} kg</b>${tk.warn ? ` <span class="badge pending">⚠️ ${t('មានការព្រមាន', 'Warning')}</span>` : ''}</div>
      <div class="btns"><button type="button" class="btn ok" data-print="${esc(tk.cid)}">🖨 ${t('បោះពុម្ព', 'Print')}</button><button type="button" class="btn" data-pdf="${esc(tk.cid)}">📄 PDF</button></div></div>`;
  }
  function bindDone() {
    $$('[data-print]').forEach(b => { b.onclick = () => { const tk = ticketBy(b.dataset.print); if (tk) printTicket(forPrint(tk)); }; });
    $$('[data-pdf]').forEach(b => { b.onclick = async () => { const tk = ticketBy(b.dataset.pdf); if (!tk) return; busy(b, true); try { await downloadPdf(forPrint(tk)); } catch (e) { toast(e.message); } busy(b, false); }; });
  }

  let lcdRaf = 0;
  const lcdSoon = () => { if (!lcdRaf) lcdRaf = requestAnimationFrame(() => { lcdRaf = 0; paintLcd(); }); };
  function paintLcd() {
    paintDnCmp();
    const el = $('#lcd');
    if (el) {
      const w = cur();
      const state = MANUAL ? ['manual', '✍ ' + t('វាយដោយដៃ', 'TYPED')] : !w.live ? ['off', SER.on ? t('គ្មានសញ្ញា', 'NO SIGNAL') : t('មិនទាន់ភ្ជាប់', 'NOT CONNECTED')]
        : w.stable ? ['ok', t('មានលំនឹង', 'STABLE')] : ['move', t('កំពុងរំកិល', 'MOVING')];
      el.className = 'lcd ' + state[0];
      const num = `${w.kg != null ? kg(w.kg) : '-----'}<span>kg</span>`;
      // At the 2nd weigh (a waiting truck is picked): live weight, 1st weight and net side by side (Kim's option C).
      const sel = ticketBy(F.cid);
      let nums = `<div class="num">${num}</div>`;
      if (sel && sel.status === 'Open' && sel.w1 !== '' && sel.w1 != null && lastAgain(sel)) {
        // After "Scale again" (Kim's option A, 9 Nov 2026): 1st weigh, last scale-again weight, change since then, net.
        const w1 = Number(sel.w1), a = lastAgain(sel), ref = Number(a.kg), has = w.kg != null, d = has ? Math.round(w.kg - ref) : 0, cls = has ? agCls(d) : '';
        nums = `<div class="cell"><div class="lab">${t('ទម្ងន់ឥឡូវ (លើកទី២)', 'Now (2nd weigh)')}</div><div class="num">${num}</div><div class="sub">${!has || w.kg >= w1 ? 'Gross' : 'Tare'}</div></div>
          <div class="cell"><div class="lab">${t('ទម្ងន់លើកទី១', '1st weigh')}</div><div class="num n1">${kg(w1)}</div><div class="sub">${dmy(sel.t1).slice(0, 5)} ${hm(sel.t1)}</div></div>
          <div class="cell ag"><div class="lab">🔁 ${t('ថ្លឹងម្តងទៀត', 'Scale again')}</div><div class="num n1">${kg(ref)}</div><div class="sub">${dmy(a.t).slice(0, 5)} ${hm(a.t)}</div></div>
          <div class="cell ow ${!has ? 'none' : cls === 'same' ? 'ok' : cls === 'heavy' ? 'over' : 'light'}"><div class="lab">${!has ? t('ខុសពីមុន', 'Change') : (cls === 'same' ? '✅ ' : cls === 'heavy' ? '⚠️ ' : '⬇️ ') + agTxt(d)}</div><div class="owv">${has ? sgn(d) + ' kg' : '—'}</div><div class="sub">${t('អនុញ្ញាត', 'Allowed')} ±${againTol()} kg</div></div>
          <div class="cell net"><div class="lab">${t('ទម្ងន់សុទ្ធ', 'Net')}</div><div class="num nn">${has ? kg(Math.abs(w.kg - w1)) : '-----'}</div><div class="sub">${has ? typeName(dirOf(w1, w.kg)) : '&nbsp;'}</div></div>`;
      } else if (sel && sel.status === 'Open' && sel.w1 !== '' && sel.w1 != null) {
        const w1 = Number(sel.w1), has = w.kg != null, liveGross = !has || w.kg >= w1;
        const G = t('ទម្ងន់សរុប', 'Gross'), T = t('ឡានទទេ', 'Tare');
        nums = `<div class="cell"><div class="lab">${t('ទម្ងន់ឥឡូវ (លើកទី២)', 'Now (2nd weigh)')}</div><div class="num">${num}</div><div class="sub">${liveGross ? G : T}</div></div>
          <div class="cell"><div class="lab">${t('ទម្ងន់លើកទី១', '1st weigh')}</div><div class="num n1">${kg(w1)}</div><div class="sub">${liveGross ? T : G} · ${hm(sel.t1)}${sel.s1 && sel.s1 !== 'Scale' ? ' · ' + esc(sel.s1) : ''}</div></div>
          <div class="cell net"><div class="lab">${t('ទម្ងន់សុទ្ធ', 'Net')}</div><div class="num nn">${has ? kg(Math.abs(w.kg - w1)) : '-----'}</div><div class="sub">${has ? typeName(dirOf(w1, w.kg)) : '&nbsp;'}</div></div>`;
        // Over weight or not, against the truck's Max. Gross Weight (Kim, 8 Nov 2026): red when over.
        const trk = truckOf(F.plate || sel.plate), mx = trk && trk.max !== '' && trk.max != null ? Number(trk.max) : 0;
        const gross = has ? Math.max(w.kg, w1) : w1;
        if (!mx) nums += `<div class="cell ow none"><div class="lab">${t('លើសទម្ងន់?', 'Over weight?')}</div><div class="owv">—</div><div class="sub">${t('មិនទាន់មានទម្ងន់សរុបអតិបរមា', 'No Max. Gross Weight')}</div></div>`;
        else if (gross > mx) nums += `<div class="cell ow over"><div class="lab">⚠️ ${t('លើសទម្ងន់', 'OVER WEIGHT')}</div><div class="owv">+${kg(gross - mx)} kg</div><div class="sub">${t('អតិបរមា', 'Max')} ${kg(mx)} kg</div></div>`;
        else nums += `<div class="cell ow ok"><div class="lab">✅ ${t('មិនលើសទម្ងន់', 'Not over weight')}</div><div class="owv">${kg(mx - gross)} kg</div><div class="sub">${t('នៅសល់ · អតិបរមា', 'left · Max')} ${kg(mx)} kg</div></div>`;
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
      if ($('#offBtn')) $('#offBtn').onclick = () => { SER.off = true; serialStop().then(paintLcd); };
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
    if ($('#agBtn')) $('#agBtn').classList.toggle('wait', !w.ok);
    const sel = F.cid ? ticketBy(F.cid) : null;
    if (sel && $('#w2now')) {
      $('#w2now').textContent = w.kg != null ? kg(w.kg) : '—';
      $('#netNow').textContent = w.kg != null ? kg(Math.abs(w.kg - Number(sel.w1))) : '—';
    }
    const an = $('#agNow'), la = sel ? lastAgain(sel) : null;
    if (an && la) { const d = w.kg != null ? Math.round(w.kg - Number(la.kg)) : null; an.textContent = d == null ? '—' : sgn(d) + ' kg'; an.className = 'agd' + (d == null ? '' : ' ' + agCls(d)); }
  }

  function paintLists() {
    if ($('#site')) {
      const all = openTickets();
      const q = String(SITEQ || '').toLowerCase().replace(/[\s\-.]/g, '');
      const open = q ? all.filter(x => [x.plate, x.company].join(' ').toLowerCase().replace(/[\s\-.]/g, '').indexOf(q) >= 0) : all;
      $('#siteCnt').textContent = all.length ? '(' + (q ? open.length + ' / ' : '') + all.length + ')' : '';
      $('#site').innerHTML = q && all.length && !open.length ? `<div class="empty">${t('រកមិនឃើញ', 'No match')}</div>` : open.length ? `<div class="tbl"><table><tr><th>${t('ឡាន', 'Truck')}</th><th>${t('ក្រុមហ៊ុនឡាន', 'Company')}</th><th>DN</th><th>${t('ចូល', 'In')}</th><th class="r">${t('លើកទី១', '1st')}</th><th>${t('រង់ចាំ', 'Wait')}</th>${isAdmin() ? '<th></th>' : ''}</tr>
        ${open.map(x => { const m = Math.round((Date.now() - new Date(x.t1)) / 60000); return `<tr class="pick${x.cid === F.cid ? ' on' : ''}${x.err ? ' errrow' : ''}" data-open="${esc(x.cid)}"><td><b>${esc(x.plate)}</b>${lastAgain(x) ? ` <span class="agpill">🔁 ${kg(lastAgain(x).kg)}${x.again.length > 1 ? ' · ' + x.again.length + '×' : ''}</span>` : ''}</td><td>${esc(x.company || '')}</td><td>${x.dns && x.dns.length ? x.dns.length : '<span class="need-t">0</span>'}</td><td>${hm(x.t1)}</td><td class="r mono">${kg(x.w1)}</td><td><span class="badge ${m > 120 ? 'pending' : 'approved'}">${m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad(m % 60)}</span></td>${isAdmin() ? `<td class="nw rowacts"><button type="button" class="rowic" data-tedit="${esc(x.cid)}" title="${t('កែ', 'Edit')}" aria-label="Edit">✏️</button><button type="button" class="rowic del" data-tdel="${esc(x.cid)}" title="${t('លុប', 'Delete')}" aria-label="Delete">🗑</button></td>` : ''}</tr>`; }).join('')}</table></div>
        <p class="hint">${t('ចុចលើឡាន ដើម្បីថ្លឹងលើកទី២', 'Tap a truck to load it for the 2nd weigh')}</p>`
        : `<div class="empty">${t('គ្មានឡានរង់ចាំ', 'No truck waiting')}</div>`;
      fitSite();
      // Admin: edit or delete a waiting truck from the list (Kim, 9 Nov 2026)
      $$('#site [data-tedit]').forEach(b => { b.onclick = e => { e.stopPropagation(); location.hash = '#/t/' + encodeURIComponent(b.dataset.tedit) + '?edit'; }; });
      $$('#site [data-tdel]').forEach(b => { b.onclick = e => { e.stopPropagation(); location.hash = '#/t/' + encodeURIComponent(b.dataset.tdel) + '?void'; }; });
      $$('[data-open]').forEach(r => { r.onclick = () => { const x = ticketBy(r.dataset.open); if (!x) return; F = { cid: x.cid, plate: x.plate, company: x.company || '', customer: x.customer || '', item: x.item || '', type: x.type || '', dns: (x.dns || []).slice(), dnkg: Object.assign({}, x.dnkg || {}), driver: x.driver || '', dest: x.dest || '', note: x.note || '', load: x.load || '', tarp: x.tarp || '' }; keepForm(); PENDING = null; LASTDONE = ''; paintForm(); paintLists(); paintLcd(); window.scrollTo(0, 0); }; });
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
    return `<div class="tbl fit"><table class="tt"><tr><th>${t('លេខប័ណ្ណ', 'Ticket')}</th><th>${t('ឡាន', 'Truck')}</th><th>DN</th><th>${t('អតិថិជន', 'Customer')}</th><th>${t('ទំនិញ', 'Item')}</th><th>${t('ចូល/ចេញ', 'In/Out')}</th><th>${t('ម៉ោង', 'Time')}</th><th class="r">Gross</th><th class="r">Tare</th><th class="r">Net</th><th></th></tr>
      ${list.map(x => `<tr class="pick${x.status === 'Void' ? ' void' : ''}${x.err ? ' errrow' : ''}" data-tk="${esc(x.cid || x.no)}"><td class="mono">${esc(x.no)}${x.status === 'Void' ? ` <span class="badge rejected">${t('បានលុប', 'Cancelled')}</span>` : ''}${x.status === 'Open' ? ` <span class="badge follow">${t('នៅលើទីតាំង', 'On site')}</span>` : ''}</td><td>${esc(x.plate)}</td><td>${esc((x.dns || []).join(', '))}</td><td>${esc(x.customer || '')}</td><td>${esc(x.item || '')}</td><td>${esc(typeName(typeOf(x)))}</td>
        <td>${dmy(x.t1) === dmy(new Date().toISOString()) ? '' : dmy(x.t1) + ' '}${hm(x.t1)}${x.t2 ? '–' + hm(x.t2) : ''}</td><td class="r mono">${kg(x.gross)}</td><td class="r mono">${kg(x.tare)}</td><td class="r mono"><b>${kg(x.net)}</b></td>
        <td class="nw">${x.warn ? '<span title="' + esc(warnTxt(x.warn)) + '">⚠️</span>' : ''}${[x.s1, x.s2].some(s => s === 'Manual') ? '<span title="Manual">✍</span>' : ''}${[x.s1, x.s2].some(s => s === 'Simulator') ? '<span title="Simulator">🧪</span>' : ''}${x.err ? '<span title="' + esc(x.err) + '">❗</span>' : Q.indexOf(x.cid) >= 0 ? '<span title="' + t('រង់ចាំផ្ញើ', 'Waiting to send') + '">⏳</span>' : ''}</td></tr>`).join('')}</table></div>`;
  }
  function bindTable() { $$('[data-tk]').forEach(r => { r.onclick = () => { location.hash = '#/t/' + encodeURIComponent(r.dataset.tk); }; }); }

  // ---------------------------------------------------------------- ticket list, search, Excel
  const ALL_FROM = '2020-01-01';   // "All" = every ticket (Kim, 10 Nov 2026: the default)
  let LIST = { from: ALL_FROM, to: today(), q: '', rows: null, more: false, st: '' };
  // Status filter (Kim, 10 Nov 2026): '' = all, 'Done' = Complete, 'Open' = still on site
  const QSTATUS = [['', 'ស្ថានភាពទាំងអស់', 'All status'], ['Done', 'រួចរាល់', 'Complete'], ['Open', 'មិនទាន់រួច', 'Open']];
  const QRANGES = [['all', 'ទាំងអស់', 'All'], ['today', 'ថ្ងៃនេះ', 'Today'], ['month', 'ខែនេះ', 'This month']];
  function rangeOf(k) {
    const d = new Date();
    if (k === 'all') return [ALL_FROM, ymd(d)];
    if (k === 'd7') { const a = new Date(d); a.setDate(d.getDate() - 6); return [ymd(a), ymd(d)]; }
    if (k === 'month') return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(d)];
    return [ymd(d), ymd(d)];
  }
  const rangeIs = k => { const r = rangeOf(k); return LIST.from === r[0] && LIST.to === r[1]; };
  const paintRanges = () => $$('[data-rg]').forEach(b => b.classList.toggle('on', rangeIs(b.dataset.rg)));
  function renderList() {
    screen = renderList;
    document.body.classList.add('wide');
    $('#view').innerHTML = `<section class="card">
      <div class="filters">
        <label>${t('ពី', 'From')}<input type="date" class="in" id="lFrom" value="${LIST.from}"></label>
        <label>${t('ដល់', 'To')}<input type="date" class="in" id="lTo" value="${LIST.to}"></label>
        <button type="button" class="btn ok" id="lGo">🔍 ${t('បង្ហាញ', 'Show')}</button>
        <div class="qchips">${QRANGES.map(r => `<button type="button" class="chip${rangeIs(r[0]) ? ' on' : ''}" data-rg="${r[0]}">${t(r[1], r[2])}</button>`).join('')}</div>
        <div class="qchips">${QSTATUS.map(r => `<button type="button" class="chip${LIST.st === r[0] ? ' on' : ''}" data-st="${r[0]}">${t(r[1], r[2])}</button>`).join('')}</div>
        <input type="search" class="in lq" id="lQ" data-live-ok placeholder="${t('ស្វែងរក ឡាន DN អតិថិជន...', 'Search truck, DN, customer...')}" value="${esc(LIST.q)}">
        <button type="button" class="btn" id="lXls">⬇ Excel</button>
      </div>
      <div id="lSum" class="sumline"></div>
      <div id="lBody"><div class="spinner"></div></div></section>`;
    $('#lGo').onclick = () => { LIST.from = $('#lFrom').value; LIST.to = $('#lTo').value; loadList(); paintRanges(); };
    // Quick dates: Today, Last 7 days, This month (Kim, 8 Nov 2026)
    $$('[data-rg]').forEach(b => { b.onclick = () => { const r = rangeOf(b.dataset.rg); LIST.from = r[0]; LIST.to = r[1]; $('#lFrom').value = r[0]; $('#lTo').value = r[1]; paintRanges(); loadList(); }; });
    $('#lQ').oninput = e => { LIST.q = e.target.value; paintListBody(); };
    $$('[data-st]').forEach(b => { b.onclick = () => { LIST.st = b.dataset.st; $$('[data-st]').forEach(c => c.classList.toggle('on', c.dataset.st === LIST.st)); paintListBody(); }; });
    $('#lXls').onclick = exportXls;
    loadList();
  }
  async function loadList() {
    const local = tickets().filter(x => { const d = String(x.t1 || '').slice(0, 10); return d >= LIST.from && d <= LIST.to; });
    LIST.rows = local; paintListBody();
    if (DEMO) return;
    try {
      const r = await api('scList', { from: LIST.from, to: LIST.to, all: LIST.from === ALL_FROM ? 1 : '' });
      LIST.more = !!r.more;
      const map = {};
      r.tickets.forEach(x => { map[x.cid || x.no] = x; });
      local.forEach(x => { if (LOC[x.cid]) map[x.cid] = x; });
      LIST.rows = Object.keys(map).map(k => map[k]);
      paintListBody();
    } catch (e) { if (e.code !== 'NET') toast(e.message); else if ($('#lSum')) $('#lSum').insertAdjacentHTML('beforeend', ` <span class="badge pending">${t('គ្មានអ៊ីនធឺណិត៖ បង្ហាញតែទិន្នន័យក្នុងកុំព្យូទ័រ', 'Offline: showing what is on this PC')}</span>`); }
  }
  const listRows = () => {
    const q = LIST.q.trim().toLowerCase();
    return (LIST.rows || []).filter(x => !LIST.st || x.status === LIST.st).filter(x => !q || [x.no, x.plate, x.company, x.customer, x.item, x.driver, x.dest, x.note, (x.dns || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0)
      .sort((a, b) => String(b.t1).localeCompare(String(a.t1)));
  };
  function paintListBody() {
    if (!$('#lSum')) return;   // the list was left before the server answered
    const rows = listRows();
    const done = rows.filter(x => x.status === 'Done');
    const open = rows.filter(x => x.status === 'Open').length, voids = rows.length - done.length - open;   // count every ticket shown (Kim, 10 Nov 2026)
    $('#lSum').innerHTML = `<b>${rows.length}</b> ${t('ប័ណ្ណ', 'tickets')} (${done.length} ${t('រួចរាល់', 'complete')} · ${open} ${t('មិនទាន់រួច', 'open')}${voids ? ' · ' + voids + ' ' + t('បានលុប', 'cancelled') : ''}) · <b>${kg(done.reduce((s, x) => s + Number(x.net || 0), 0) / 1000)} t</b> ${t('សុទ្ធ', 'net')}${LIST.more ? ` <span class="badge pending">${t('បង្ហាញតែ ៥០០០ ប័ណ្ណចុងក្រោយ', 'Showing the newest 5,000 tickets')}</span>` : ''}`;
    $('#lBody').innerHTML = rows.length ? ticketTable(rows) : `<div class="empty">${t('គ្មានប័ណ្ណ', 'No tickets')}</div>`;
    bindTable();
  }
  function exportXls() {
    const rows = listRows();
    if (!rows.length || !window.XLSX) { toast(t('គ្មានប័ណ្ណ', 'No tickets')); return; }
    const head = ['Ticket No', 'Status', 'Truck No', 'Company', 'Customer', 'Item', 'In/Out', 'DN No', 'DN Count', 'DN Kg', 'DN Total (kg)', 'DN Variance (kg)', 'Driver', 'Loading Place', 'Destination', 'Canvas', 'Note', '1st Time', '1st Weight (kg)', '2nd Time', '2nd Weight (kg)', 'Gross (kg)', 'Tare (kg)', 'Net (kg)', 'Source', 'Warnings', 'Operator'];
    const data = rows.map(x => [x.no, x.status, x.plate, x.company, x.customer, x.item, typeOf(x), (x.dns || []).join(', '), (x.dns || []).length, (x.dns || []).filter(d => dnKgOf(x, d)).map(d => d + ': ' + dnKgOf(x, d)).join(', '), num(dnSum(x)), dnCheck(x) ? dnCheck(x).d : '', x.driver, x.load || '', x.dest, x.tarp === 'Yes' ? 'Covered' : x.tarp === 'No' ? 'Not covered' : '', x.note,
      String(x.t1 || '').replace('T', ' '), num(x.w1), String(x.t2 || '').replace('T', ' '), num(x.w2), num(x.gross), num(x.tare), num(x.net), [x.s1, x.s2].filter(Boolean).join(' / '), x.warn || '', x.op || '']);
    const ws = XLSX.utils.aoa_to_sheet([head].concat(data));
    ws['!cols'] = head.map((h, i) => ({ wch: [16, 8, 11, 16, 24, 14, 7, 28, 6, 32, 10, 10, 18, 16, 16, 12, 20, 18, 10, 18, 10, 10, 10, 10, 12, 40, 14][i] }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scale Tickets');
    XLSX.writeFile(wb, 'Scale_Tickets_' + LIST.from + (LIST.to !== LIST.from ? '_to_' + LIST.to : '') + '.xlsx');
  }
  const num = v => (v === '' || v == null ? '' : Number(v));

  // ---------------------------------------------------------------- turnaround per 3PL (Kim, feature 8)
  // Time on site = 1st weigh (truck arrives on the scale) to 2nd weigh (truck leaves). Per truck company, for
  // finished tickets in the dates picked, plus the trucks still on site now. Feeds the 3PL scorecard.
  const monthStart = () => today().slice(0, 8) + '01';
  let TAT = { from: monthStart(), to: today(), rows: null, slow: 120 };
  const mins = x => { const a = new Date(x.t1), b = new Date(x.t2); const m = (b - a) / 60000; return isFinite(m) && m >= 0 ? Math.round(m) : null; };
  const dur = m => (m == null ? '—' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad(m % 60));
  function renderTat() {
    screen = renderTat;
    document.body.classList.add('wide');
    $('#view').innerHTML = `<section class="card">
      <div class="head2"><h2>⏱️ ${t('រយៈពេលឡាននៅក្នុងរោងចក្រ តាមក្រុមហ៊ុនឡាន', 'Turnaround time per truck company')}</h2></div>
      <p class="hint">${t('ពីការថ្លឹងលើកទី១ (ឡានមកដល់) ដល់ការថ្លឹងលើកទី២ (ឡានចេញ)', 'From the 1st weigh (truck arrives) to the 2nd weigh (truck leaves)')}</p>
      <div class="filters">
        <label>${t('ពី', 'From')}<input type="date" class="in" id="tFrom" value="${TAT.from}"></label>
        <label>${t('ដល់', 'To')}<input type="date" class="in" id="tTo" value="${TAT.to}"></label>
        <label>${t('យឺត បើលើស (នាទី)', 'Slow if over (min)')}<input type="number" class="in" id="tSlow" min="10" step="10" value="${TAT.slow}" style="width:110px"></label>
        <button type="button" class="btn ok" id="tGo">🔍 ${t('បង្ហាញ', 'Show')}</button>
        <button type="button" class="btn" id="tXls">⬇ Excel</button>
      </div>
      <div id="tBody"><div class="spinner"></div></div></section>`;
    $('#tGo').onclick = () => { TAT.from = $('#tFrom').value; TAT.to = $('#tTo').value; loadTat(); };
    $('#tSlow').onchange = e => { TAT.slow = Math.max(10, +e.target.value || 120); paintTat(); };
    $('#tXls').onclick = tatXls;
    loadTat();
  }
  async function loadTat() {
    const local = tickets().filter(x => { const d = String(x.t1 || '').slice(0, 10); return d >= TAT.from && d <= TAT.to; });
    TAT.rows = local; paintTat();
    if (DEMO) return;
    try {
      const r = await api('scList', { from: TAT.from, to: TAT.to });
      const map = {};
      r.tickets.forEach(x => { map[x.cid || x.no] = x; });
      local.forEach(x => { if (LOC[x.cid]) map[x.cid] = x; });
      TAT.rows = Object.keys(map).map(k => map[k]);
      paintTat();
    } catch (e) { if (e.code !== 'NET') toast(e.message); }
  }
  function tatStats() {
    const by = {};
    const row = c => by[c] || (by[c] = { co: c, m: [], net: 0, slow: 0, onsite: 0, wait: 0, inn: 0, out: 0 });
    (TAT.rows || []).forEach(x => {
      if (x.status === 'Done') {
        const m = mins(x); if (m == null) return;
        const r = row(x.company || '—'); r.m.push(m); r.net += Number(x.net || 0); if (m > TAT.slow) r.slow++;
        if (typeOf(x) === 'In') r.inn++; else r.out++;
      }
    });
    openTickets().forEach(x => { const r = row(x.company || '—'); r.onsite++; r.wait = Math.max(r.wait, Math.round((Date.now() - new Date(x.t1)) / 60000)); });
    const list = Object.keys(by).map(k => by[k]).map(r => {
      const s = r.m.slice().sort((a, b) => a - b);
      return Object.assign(r, { n: s.length, avg: s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null, med: s.length ? Math.round((s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2) : null, max: s.length ? s[s.length - 1] : null });
    });
    return list.sort((a, b) => (b.avg || 0) - (a.avg || 0) || b.onsite - a.onsite);
  }
  function paintTat() {
    if (!$('#tBody')) return;
    const L = tatStats(), all = [].concat.apply([], L.map(r => r.m)).sort((a, b) => a - b);
    const avg = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null;
    const slow = (TAT.rows || []).filter(x => x.status === 'Done' && mins(x) > TAT.slow).sort((a, b) => mins(b) - mins(a)).slice(0, 10);
    const maxAvg = Math.max.apply(null, [1].concat(L.map(r => r.avg || 0)));
    $('#tBody').innerHTML = `
      <div class="sumline"><b>${all.length}</b> ${t('ជើងឡានចប់', 'finished trips')} · ${t('មធ្យម', 'average')} <b>${dur(avg)}</b> · ${t('យឺត', 'slow')} <b>${all.filter(m => m > TAT.slow).length}</b> · ${t('នៅលើទីតាំងឥឡូវ', 'on site now')} <b>${openTickets().length}</b></div>
      ${L.length ? `<div class="tbl"><table class="tt"><tr><th>${t('ក្រុមហ៊ុនឡាន', 'Truck company')}</th><th class="r">${t('ជើង', 'Trips')}</th><th class="r">${t('ចេញ/ចូល', 'Out/In')}</th><th>${t('មធ្យម', 'Average')}</th><th class="r">${t('កណ្តាល', 'Median')}</th><th class="r">${t('យូរបំផុត', 'Longest')}</th><th class="r">${t('យឺត', 'Slow')}</th><th class="r">${t('ទម្ងន់សុទ្ធ', 'Net')} (t)</th><th class="r">${t('នៅលើទីតាំងឥឡូវ', 'On site now')}</th></tr>
        ${L.map(r => `<tr><td><b>${esc(r.co)}</b></td><td class="r">${r.n}</td><td class="r">${r.out}/${r.inn}</td>
          <td><div class="tatbar"><i style="width:${Math.round((r.avg || 0) / maxAvg * 100)}%" class="${r.avg > TAT.slow ? 'bad' : ''}"></i><span>${dur(r.avg)}</span></div></td>
          <td class="r">${dur(r.med)}</td><td class="r">${dur(r.max)}</td><td class="r">${r.slow ? `<span class="badge pending">${r.slow} (${Math.round(r.slow / r.n * 100)}%)</span>` : r.n ? '0' : ''}</td>
          <td class="r mono">${kg(r.net / 1000)}</td><td class="r">${r.onsite ? `<span class="badge follow">${r.onsite} · ${dur(r.wait)}</span>` : ''}</td></tr>`).join('')}</table></div>`
        : `<div class="empty">${t('គ្មានប័ណ្ណ', 'No tickets')}</div>`}
      ${slow.length ? `<h3 class="mt">🐢 ${t('ជើងយឺតបំផុត', 'Slowest trips')}</h3><div class="tbl"><table class="tt"><tr><th>${t('លេខប័ណ្ណ', 'Ticket')}</th><th>${t('ឡាន', 'Truck')}</th><th>${t('ក្រុមហ៊ុនឡាន', 'Company')}</th><th>${t('ចូល', 'In')}</th><th>${t('ចេញ', 'Out')}</th><th class="r">${t('រយៈពេល', 'Time')}</th></tr>
        ${slow.map(x => `<tr class="pick" data-tk="${esc(x.cid || x.no)}"><td class="mono">${esc(x.no)}</td><td>${esc(x.plate)}</td><td>${esc(x.company || '')}</td><td>${String(x.t1 || '').slice(5, 16).replace('T', ' ')}</td><td>${String(x.t2 || '').slice(5, 16).replace('T', ' ')}</td><td class="r"><b>${dur(mins(x))}</b></td></tr>`).join('')}</table></div>` : ''}`;
    bindTable();
  }
  function tatXls() {
    if (!window.XLSX) return;
    const L = tatStats();
    const a = [['Truck company', 'Trips', 'Out', 'In', 'Average (min)', 'Median (min)', 'Longest (min)', 'Slow (> ' + TAT.slow + ' min)', 'Net (t)', 'On site now']].concat(L.map(r => [r.co, r.n, r.out, r.inn, r.avg, r.med, r.max, r.slow, Math.round(r.net) / 1000, r.onsite]));
    const b = [['Ticket No', 'Truck No', 'Company', 'In/Out', '1st Time', '2nd Time', 'Minutes']].concat((TAT.rows || []).filter(x => x.status === 'Done').map(x => [x.no, x.plate, x.company, typeOf(x), String(x.t1 || '').replace('T', ' '), String(x.t2 || '').replace('T', ' '), mins(x)]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a), 'By company');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(b), 'Trips');
    XLSX.writeFile(wb, 'Turnaround_' + TAT.from + '_' + TAT.to + '.xlsx');
  }

  // ---------------------------------------------------------------- Debit Note check (Kim, 6 Nov 2026, option C)
  // The tickets of one truck company next to the Debit Note it sent: each DN line is matched to a ticket by truck and
  // date, then the net weight, unit price, date and company are compared. Unit price and UoM come from the Price List.
  function canDnc() { return !!(me().admin || me().dnc); }
  let DNC = { from: monthStart(), to: today(), co: '', q: '', tab: 'all', rows: null, dn: null, file: '', busy: '' };
  const normC = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(CO|LTD|COLTD|COMPANY)$/, '');
  const normD = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const tripDay = x => String(x.t2 || x.t1 || '').slice(0, 10);
  const dayDiff = (a, b) => Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
  const money2 = v => (v == null || v === '' || !isFinite(v) ? '' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  function priceOf(x) {
    const P = (B && B.prices) || [];
    const d = normD(x.dest);
    if (!d) return null;
    const hit = P.find(r => normC(r[0]) === normC(x.company) && normD(r[1]) === d) || (() => { const same = P.filter(r => normD(r[1]) === d); return same.length && same.every(r => r[3] === same[0][3]) ? same[0] : null; })();
    return hit ? { price: hit[3], per: hit[2], uom: hit[4] || hit[2] || '' } : null;
  }
  function plateGap(a, b) {   // letters that differ, same length only (3E-0044 read for 3E-9044 = 1)
    a = normP(a); b = normP(b);
    if (a === b) return 0;
    if (a.length !== b.length) return 9;
    let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  }
  const dncCompanies = () => { const s = []; trucks().concat(DNC.rows || []).forEach(x => { if (x.company && s.indexOf(x.company) < 0) s.push(x.company); }); return s.sort(); };
  const dncTickets = () => {
    const q = DNC.q.trim().toLowerCase();
    return (DNC.rows || []).filter(x => x.status === 'Done' && (!DNC.co || normC(x.company) === normC(DNC.co)) &&
      (!q || [x.no, x.plate, x.company, x.item, x.dest, x.load, (x.dns || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0))
      .sort((a, b) => String(a.t2 || a.t1).localeCompare(String(b.t2 || b.t1)));
  };
  /** Pairs DN lines with tickets: same truck (or one letter off, a reading slip) within 3 days, closest weight first. */
  function dncMatch() {
    const T = dncTickets(), dn = DNC.dn;
    const res = T.map(x => ({ x, d: null, diffs: [], notes: [] }));
    if (!dn) return { res, only: [] };
    const pairs = [];
    dn.rows.forEach((d, di) => res.forEach((r, ti) => {
      // same weight to 20 kg is a strong sign: then a scan may have misread two letters of the plate or a digit of the day
      const qd = d.qty ? Math.abs(d.qty - Number(r.x.net || 0) / 1000) : 5, same = qd <= 0.02;
      const g = plateGap(d.plate, r.x.plate); if (g > (same ? 2 : 1)) return;
      const dd = d.date ? Math.abs(dayDiff(d.date, tripDay(r.x))) : 1; if (dd > (same ? 10 : 3)) return;
      pairs.push({ di, ti, s: g * 6 + dd * 2 + Math.min(qd, 5) });
    }));
    pairs.sort((a, b) => a.s - b.s);
    const usedD = {}, usedT = {};
    pairs.forEach(p => { if (usedD[p.di] || usedT[p.ti]) return; usedD[p.di] = usedT[p.ti] = 1; res[p.ti].d = dn.rows[p.di]; });
    const agent = normC(dn.agent);
    res.forEach(r => {
      const d = r.d, x = r.x; if (!d) return;
      const pl = priceOf(x), netT = Number(x.net || 0) / 1000;
      if (normP(d.plate) !== normP(x.plate)) r.notes.push(t('DN អានបាន ', 'DN read ') + d.plate);
      if (!d.ok || d.guess) r.notes.push('⚠ ' + t('ជួរនេះអានមិនច្បាស់: ពិនិត្យក្នុងតារាង DN ខាងក្រោម', 'this DN line was not read clearly: check it in the DN lines below'));
      if (d.date && d.date !== tripDay(x)) r.diffs.push({ k: 'date', txt: t('ថ្ងៃ', 'Date') + ' DN ' + dmy(d.date) + ' · ' + t('កម្មវិធី', 'app') + ' ' + dmy(tripDay(x)) });
      if (d.qty != null && Math.abs(d.qty * 1000 - Number(x.net || 0)) > 10) r.diffs.push({ k: 'net', kg: Math.round(d.qty * 1000 - Number(x.net || 0)), txt: 'Net DN ' + kg(Math.round(d.qty * 1000)) + ' · ' + t('កម្មវិធី', 'app') + ' ' + kg(x.net) + ' (' + (d.qty * 1000 > x.net ? '+' : '') + kg(Math.round(d.qty * 1000 - x.net)) + ' kg)' });
      if (pl && d.price != null && Math.abs(d.price - pl.price) > 0.005) r.diffs.push({ k: 'price', txt: t('តម្លៃ', 'Price') + ' DN ' + money2(d.price) + ' · ' + t('បញ្ជីតម្លៃ', 'price list') + ' ' + money2(pl.price) });
      if (agent && x.company && normC(x.company) !== agent && normC(x.company).indexOf(agent) < 0 && agent.indexOf(normC(x.company)) < 0) r.diffs.push({ k: 'co', txt: t('ក្រុមហ៊ុន', 'Company') + ' DN ' + dn.agent + ' · ' + t('កម្មវិធី', 'app') + ' ' + x.company });
      r.billed = d.total != null ? d.total : (d.qty || 0) * ((d.price || 0) + (d.extra || 0));
      r.app = netT * ((pl ? pl.price : d.price) || 0) + netT * (d.extra || 0);
    });
    const only = dn.rows.filter((d, i) => !usedD[i]);
    return { res, only };
  }
  function renderDnc() {
    if (!canDnc()) { location.hash = '#/'; return; }
    screen = renderDnc;
    document.body.classList.add('wide');
    $('#view').innerHTML = `<section class="card dncf">
      <div class="head2"><h2>🧾 ${t('ពិនិត្យ Debit Note', 'Debit Note check')}</h2></div>
      <div class="filters">
        <label>${t('ពី', 'From')}<input type="date" class="in" id="dFrom" value="${DNC.from}"></label>
        <label>${t('ដល់', 'To')}<input type="date" class="in" id="dTo" value="${DNC.to}"></label>
        <label>${t('ក្រុមហ៊ុនឡាន', 'Truck company')}<select class="in" id="dCo"><option value="">${t('ទាំងអស់', 'All')}</option>${dncCompanies().map(c => `<option${normC(c) === normC(DNC.co) ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <button type="button" class="btn ok" id="dGo">🔍 ${t('បង្ហាញ', 'Show')}</button>
        <input type="search" class="in grow" id="dQ" data-live-ok placeholder="${t('ស្វែងរក ឡាន DN ទីកន្លែង...', 'Search truck, DN, place...')}" value="${esc(DNC.q)}">
        <button type="button" class="btn" id="dXls">⬇ Excel</button>
        <label class="btn ok" style="display:inline-flex">⬆ ${t('ផ្ទុក Debit Note', 'Upload Debit Note')}<input type="file" id="dUp" accept="application/pdf,image/*" hidden></label>
      </div>
      <div id="dStat"></div></section>
      <div id="dBody"><div class="spinner"></div></div>`;
    $('#dGo').onclick = () => { DNC.from = $('#dFrom').value; DNC.to = $('#dTo').value; loadDnc(); };
    $('#dCo').onchange = e => { DNC.co = e.target.value; paintDnc(); };
    $('#dQ').oninput = e => { DNC.q = e.target.value; paintDnc(); };
    $('#dXls').onclick = dncXls;
    $('#dUp').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) readDn(f); };
    loadDnc();
  }
  async function loadDnc() {
    const local = tickets().filter(x => { const d = tripDay(x); return d >= DNC.from && d <= DNC.to; });
    DNC.rows = local; paintDnc();
    if (DEMO) return;
    try {
      const r = await api('scList', { from: DNC.from, to: DNC.to });
      const map = {};
      r.tickets.forEach(x => { map[x.cid || x.no] = x; });
      local.forEach(x => { if (LOC[x.cid]) map[x.cid] = x; });
      DNC.rows = Object.keys(map).map(k => map[k]);
      paintDnc();
    } catch (e) { if (e.code !== 'NET') toast(e.message); }
  }
  async function readDn(file) {
    if (!window.DnRead) { toast('dn-read.js'); return; }
    DNC.busy = t('កំពុងអាន Debit Note…', 'Reading the Debit Note…'); DNC.file = file.name; paintDnc();
    try {
      const r = await DnRead.readFile(file, s => { if (s === 'ocr') { DNC.busy = t('កំពុងអានរូបភាព (ស្កេន)… ប្រហែល ១០ វិនាទី', 'Reading the scanned page… about 10 seconds'); paintDnc(); } });
      const dn = DnRead.parse(r.lines);
      dn.scanned = r.scanned;
      DNC.dn = dn; DNC.busy = '';
      if (!dn.rows.length) toast(t('រកមិនឃើញជួរជើងឡានក្នុង Debit Note', 'No trip lines found in the Debit Note'));
      // the DN's truck company picks the filter, and its trip dates the period
      if (dn.agent) { const c = dncCompanies().find(c2 => normC(c2) === normC(dn.agent)) || dncCompanies().find(c2 => normC(c2).indexOf(normC(dn.agent)) >= 0 || normC(dn.agent).indexOf(normC(c2)) >= 0); if (c) DNC.co = c; }
      const ds = dn.rows.map(d => d.date).filter(Boolean).sort();
      if (ds.length && (ds[0] < DNC.from || ds[ds.length - 1] > DNC.to)) { DNC.from = ds[0] < DNC.from ? ds[0] : DNC.from; DNC.to = ds[ds.length - 1] > DNC.to ? ds[ds.length - 1] : DNC.to; renderDnc(); return; }
      renderDnc();
    } catch (e) { DNC.busy = ''; paintDnc(); toast(e.message); }
  }
  const CHK = {
    ok: ['approved', '✅', 'ត្រូវ', 'Matched'], diff: ['pending', '⚠️', 'ខុស', 'Different'], only: ['rejected', '➕', 'មានតែក្នុង DN', 'On DN only'], none: ['recorded', '—', 'មិនមានក្នុង DN', 'Not on DN'],
  };
  const chip = k => `<span class="badge ${CHK[k][0]}">${CHK[k][1]} ${t(CHK[k][2], CHK[k][3])}</span>`;
  function dncState(r) { return !DNC.dn ? '' : !r.d ? 'none' : r.diffs.length ? 'diff' : 'ok'; }
  function paintDnc() {
    if (!$('#dBody')) return;
    const M = dncMatch(), dn = DNC.dn;
    $('#dStat').innerHTML = DNC.busy ? `<div class="sumline"><span class="spin-s"></span> ${esc(DNC.busy)}</div>`
      : dn ? `<div class="sumline">📄 <b>${esc(DNC.file)}</b> · ${dn.no ? 'No ' + esc(dn.no) + ' · ' : ''}${dn.agent ? esc(dn.agent) + ' · ' : ''}${dn.date ? dmy(dn.date) + ' · ' : ''}${dn.rows.length} ${t('ជួរ', 'lines')}${dn.scanned ? ' · ' + t('ស្កេន', 'scanned') : ''}
          <button type="button" class="link" id="dClr">✕ ${t('ដក DN ចេញ', 'Remove DN')}</button></div>` : '';
    if ($('#dClr')) $('#dClr').onclick = () => { DNC.dn = null; DNC.file = ''; paintDnc(); };
    const n = { all: M.res.length + M.only.length, ok: 0, diff: 0, only: M.only.length, none: 0 };
    M.res.forEach(r => { const s = dncState(r); if (s) n[s]++; });
    const billed = M.res.reduce((s, r) => s + (r.billed || 0), 0) + M.only.reduce((s, d) => s + (d.total != null ? d.total : (d.qty || 0) * ((d.price || 0) + (d.extra || 0))), 0);
    const app = M.res.reduce((s, r) => s + (r.app || 0), 0);
    const card = (v, l, cls) => `<div class="dcard ${cls || ''}"><b>${v}</b><small>${l}</small></div>`;
    const cards = `<div class="dcards">${card(M.res.length, t('ជើងក្នុងកម្មវិធី', 'Trips in app'))}${card(dn ? dn.rows.length : '—', t('ជើងក្នុង DN', 'Trips on DN'))}
      ${card(dn ? n.ok : '—', t('ត្រូវ', 'Matched'), 'ok')}${card(dn ? n.diff : '—', t('ខុស', 'Different'), n.diff ? 'warn' : '')}${card(dn ? n.only : '—', t('មានតែក្នុង DN', 'On DN only'), n.only ? 'bad' : '')}
      ${card(dn ? (billed - app >= 0 ? '+' : '−') + '$' + money2(Math.abs(billed - app)) : '—', t('DN គិត − កម្មវិធី', 'Billed − app'), dn && Math.abs(billed - app) > 1 ? 'bad' : '')}</div>`;
    const tabs = dn ? `<div class="dtabs">${[['all', t('ទាំងអស់', 'All')], ['ok', t('ត្រូវ', 'Matched')], ['diff', t('ខុស', 'Different')], ['only', t('មានតែក្នុង DN', 'On DN only')], ['none', t('មិនមានក្នុង DN', 'Not on DN')]]
      .map(x => `<button type="button" class="chip${DNC.tab === x[0] ? ' on' : ''}" data-tab="${x[0]}">${x[1]} <b>${n[x[0]]}</b></button>`).join('')}</div>` : '';
    const show = s => !dn || DNC.tab === 'all' || DNC.tab === s;
    const rowHtml = r => {
      const x = r.x, pl = priceOf(x), s = dncState(r);
      return `<tr class="pick${s === 'diff' ? ' warnrow' : ''}" data-tk="${esc(x.cid || x.no)}"><td>${s ? chip(s) : ''}</td><td class="mono">${esc(x.no)}</td><td><b>${esc(x.plate)}</b></td><td>${esc(x.company || '')}</td><td>${esc((x.dns || []).join(', '))}</td><td>${esc(x.item || '')}</td>
        <td>${esc(x.load || '')}</td><td>${esc(x.dest || '')}</td><td class="nw">${dmy(tripDay(x))}</td><td class="r mono"><b>${kg(x.net)}</b></td><td class="r mono">${pl ? money2(pl.price) : ''}</td><td>${pl ? esc(pl.uom) : ''}</td>
        <td class="dd">${r.diffs.map(d => esc(d.txt)).join('<br>')}${r.notes.length ? `<small class="muted">${esc(r.notes.join(' · '))}</small>` : ''}</td></tr>`;
    };
    const onlyHtml = d => `<tr class="warnrow"><td>${chip('only')}</td><td class="muted">DN #${d.n}</td><td><b>${esc(d.plate)}</b></td><td>${esc(dn.agent || '')}</td><td></td><td></td><td></td><td>${esc(d.place || '')}</td><td class="nw">${d.date ? dmy(d.date) : '?'}</td>
      <td class="r mono">${d.qty != null ? kg(Math.round(d.qty * 1000)) : ''}</td><td class="r mono">${money2(d.price)}</td><td></td><td class="dd">${t('គ្មានប័ណ្ណថ្លឹងសម្រាប់ជួរនេះ', 'No weigh ticket for this line')}</td></tr>`;
    const body = M.res.filter(r => show(dncState(r))).map(rowHtml).join('') + (show('only') && dn ? M.only.map(onlyHtml).join('') : '');
    const list = M.res.filter(r => dncState(r) === 'diff');
    const diffList = dn ? `<h3 class="mt">📝 ${t('សេចក្តីសង្ខេបភាពខុសគ្នា', 'Summary of differences')}</h3>
      ${!list.length && !M.only.length && !n.none ? `<div class="alert ok">✅ ${t('Debit Note ត្រូវនឹងប័ណ្ណថ្លឹងទាំងអស់', 'The Debit Note matches the weigh tickets')}</div>` : `<ul class="dlist">
        ${list.map(r => `<li>${chip('diff')} <b>${esc(r.x.plate)}</b> ${dmy(tripDay(r.x))} · <span class="mono">${esc(r.x.no)}</span>: ${r.diffs.map(d => esc(d.txt)).join('; ')}${r.notes.length ? ` <small class="muted">(${esc(r.notes.join(' · '))})</small>` : ''}</li>`).join('')}
        ${M.only.map(d => `<li>${chip('only')} DN #${d.n} <b>${esc(d.plate)}</b> ${d.date ? dmy(d.date) : ''} · ${d.qty != null ? kg(Math.round(d.qty * 1000)) + ' kg' : ''} · $${money2(d.total)}: ${t('គ្មានប័ណ្ណថ្លឹង', 'no weigh ticket')}</li>`).join('')}
        ${n.none ? `<li>${chip('none')} ${n.none} ${t('ប័ណ្ណក្នុងកម្មវិធី មិនមានក្នុង Debit Note នេះទេ (អាចនៅក្នុង DN ផ្សេង)', 'tickets in the app are not on this Debit Note (they may be on another one)')}</li>` : ''}</ul>`}
      ${dncTotals(M)}
      ${dncReadTable()}` : `<p class="hint mt">${t('ផ្ទុក Debit Note (PDF ឬរូបថត) ដើម្បីប្រៀបធៀបជាមួយប័ណ្ណថ្លឹងក្នុងតារាងនេះ៖ លេខឡាន ថ្ងៃ ទម្ងន់សុទ្ធ តម្លៃ និងក្រុមហ៊ុនឡាន។', 'Upload the Debit Note (PDF or photo) to compare it with the weigh tickets in this table: truck, date, net weight, unit price and truck company.')}</p>`;
    $('#dBody').innerHTML = `<section class="card">${cards}${tabs}
      ${body ? `<div class="tbl dncfit"><table class="tt dnct"><tr><th>${t('ពិនិត្យ', 'Check')}</th><th>${t('លេខប័ណ្ណ', 'Ticket')}</th><th>${t('ឡាន', 'Truck')}</th><th>${t('ក្រុមហ៊ុនឡាន', 'Truck company')}</th><th>DN</th><th>${t('ទំនិញ', 'Item')}</th><th>${t('កន្លែងផ្ទុក', 'Loading place')}</th><th>${t('កន្លែងទម្លាក់', 'Unloading place')}</th><th>${t('ថ្ងៃដឹក', 'Trip date')}</th><th class="r">Net (kg)</th><th class="r">${t('តម្លៃឯកតា', 'Unit price')}</th><th>UoM</th><th>${t('ភាពខុសគ្នា', 'Difference')}</th></tr>${body}</table></div>`
        : `<div class="empty">${t('គ្មានប័ណ្ណ', 'No tickets')}</div>`}
      ${diffList}</section>`;
    $$('[data-tab]').forEach(b => { b.onclick = () => { DNC.tab = b.dataset.tab; paintDnc(); }; });
    bindTable();
    $$('[data-dn-row]').forEach(inp => { inp.onchange = () => { const d = DNC.dn.rows[+inp.dataset.dnRow], k = inp.dataset.k; d[k] = k === 'date' ? inp.value : k === 'plate' ? inp.value.trim().toUpperCase() : (inp.value === '' ? null : +inp.value); d.ok = true; d.guess = false; paintDnc(); }; });
    if ($('#dAdd')) $('#dAdd').onclick = () => { DNC.dn.rows.push({ n: DNC.dn.rows.length + 1, date: DNC.to, plate: '', qty: null, price: null, extra: 0, total: null, place: '', ok: true }); paintDnc(); };
  }
  function dncTotals(M) {
    const dn = DNC.dn, sumQ = dn.rows.reduce((s, d) => s + (d.qty || 0), 0), sumT = dn.rows.reduce((s, d) => s + (d.total || 0), 0), extra = dn.rows.reduce((s, d) => s + (d.qty || 0) * (d.extra || 0), 0);
    const appT = M.res.filter(r => r.d).reduce((s, r) => s + Number(r.x.net || 0), 0) / 1000;
    return `<div class="sumline mt">${t('សរុបក្នុង DN', 'DN total')}: <b>${kg(Math.round(sumQ * 1000) / 1000)} t</b> · <b>$${money2(sumT)}</b>${dn.total != null && Math.abs(dn.total - sumT) > 0.5 ? ` <span class="badge pending">${t('សរុបដែលបោះពុម្ព', 'printed total')} $${money2(dn.total)}: ${t('ពិនិត្យជួរដែលអានមិនបាន', 'check lines not read')}</span>` : ''}
      · ${t('ប័ណ្ណដែលត្រូវគ្នា', 'matched tickets')}: <b>${kg(Math.round(appT * 1000) / 1000)} t</b>${extra ? ` · ${t('ថ្លៃបន្ថែម', 'extra charge')} $${money2(extra)}` : ''}</div>`;
  }
  /** The DN lines as read, editable: a scan can misread a digit, so the person can fix it and the check runs again. */
  function dncReadTable() {
    const dn = DNC.dn, bad = dn.rows.filter(d => !d.ok || d.guess).length;
    const cell = (i, k, v, type, w) => `<input class="in sm" data-dn-row="${i}" data-k="${k}" type="${type}" value="${v == null ? '' : esc(v)}" style="width:${w}px"${type === 'number' ? ' step="0.01"' : ''}>`;
    return `<details class="mt"${bad ? ' open' : ''}><summary><b>📄 ${t('ជួរ Debit Note ដែលបានអាន', 'Debit Note lines as read')} (${dn.rows.length})</b>${bad ? ` <span class="badge pending">⚠ ${bad} ${t('សូមពិនិត្យ', 'to check')}</span>` : ''}</summary>
      <p class="hint">${t('កែលេខដែលអានខុស នោះការពិនិត្យនឹងរត់ម្តងទៀត។ ជួរ ⚠ = ចំនួន × តម្លៃ មិនស្មើសរុប ឬថ្ងៃមិនច្បាស់។', 'Fix anything read wrong and the check runs again. ⚠ = qty × price does not equal the total, or the date was not clear.')}</p>
      <div class="tbl"><table class="tt"><tr><th>#</th><th>${t('ថ្ងៃ', 'Date')}</th><th>${t('ឡាន', 'Truck')}</th><th class="r">Qty (t)</th><th class="r">${t('តម្លៃ', 'Price')}</th><th class="r">${t('បន្ថែម', 'Extra')}</th><th class="r">${t('សរុប', 'Total')}</th><th>${t('ទីកន្លែង', 'Place')}</th><th></th></tr>
      ${dn.rows.map((d, i) => `<tr class="${!d.ok || d.guess ? 'warnrow' : ''}"><td>${i + 1}</td><td>${cell(i, 'date', d.date, 'date', 150)}</td><td>${cell(i, 'plate', d.plate, 'text', 100)}</td><td class="r">${cell(i, 'qty', d.qty, 'number', 90)}</td><td class="r">${cell(i, 'price', d.price, 'number', 80)}</td><td class="r">${cell(i, 'extra', d.extra, 'number', 70)}</td><td class="r">${cell(i, 'total', d.total, 'number', 100)}</td><td>${esc(d.place || '')}</td><td>${!d.ok || d.guess ? '⚠' : ''}</td></tr>`).join('')}</table></div>
      <button type="button" class="btn mt" id="dAdd">＋ ${t('បន្ថែមជួរ', 'Add a line')}</button></details>`;
  }
  function dncXls() {
    if (!window.XLSX) return;
    const M = dncMatch(), dn = DNC.dn;
    const st = r => ({ ok: 'Matched', diff: 'Different', none: 'Not on DN', '': '' })[dncState(r)];
    const a = [['Check', 'Ticket No', 'Truck No', 'Truck Company', 'DN No', 'Item', 'Loading Place', 'Unloading Place', 'Trip Date', 'Net (kg)', 'Unit Price', 'UoM', 'DN Qty (t)', 'DN Price', 'DN Extra', 'DN Total', 'App Amount', 'Difference']]
      .concat(M.res.map(r => { const x = r.x, pl = priceOf(x), d = r.d || {}; return [st(r), x.no, x.plate, x.company, (x.dns || []).join(', '), x.item, x.load || '', x.dest, tripDay(x), num(x.net), pl ? pl.price : '', pl ? pl.uom : '', d.qty == null ? '' : d.qty, d.price == null ? '' : d.price, d.extra == null ? '' : d.extra, d.total == null ? '' : d.total, r.app ? Math.round(r.app * 100) / 100 : '', r.diffs.map(z => z.txt).concat(r.notes).join('; ')]; }))
      .concat(dn ? M.only.map(d => ['On DN only', '', d.plate, dn.agent, '', '', '', d.place, d.date, '', '', '', d.qty, d.price, d.extra, d.total, '', 'No weigh ticket']) : []);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(a);
    ws['!cols'] = a[0].map((h, i) => ({ wch: [12, 16, 11, 18, 16, 14, 16, 16, 11, 10, 9, 8, 9, 8, 8, 10, 10, 50][i] }));
    XLSX.utils.book_append_sheet(wb, ws, 'Check');
    if (dn) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['#', 'Date', 'Truck No', 'Qty (t)', 'Price', 'Extra', 'Total', 'Place', 'Read OK']].concat(dn.rows.map((d, i) => [i + 1, d.date, d.plate, d.qty, d.price, d.extra, d.total, d.place, d.ok && !d.guess ? 'Yes' : 'Check']))), 'Debit Note');
    XLSX.writeFile(wb, 'Debit_Note_Check_' + (DNC.co ? DNC.co.replace(/[^A-Za-z0-9]+/g, '_') + '_' : '') + DNC.from + '_' + DNC.to + '.xlsx');
  }

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
      ${x.status !== 'Open' ? `<div class="tprev" id="tPrev"><div class="spinner"></div></div>` : `<div class="emp">
        ${kv(t('លេខឡាន', 'Truck No'), esc(x.plate))}${kv(t('ក្រុមហ៊ុនឡាន', 'Truck company'), esc(x.company))}${kv(t('អតិថិជន', 'Customer'), esc(x.customer))}
        ${kv(t('ទំនិញ', 'Item'), esc(x.item))}${kv(t('ចូល / ចេញ', 'In / Out'), esc(typeName(typeOf(x))))}${kv('DN No', esc(dnList(x)))}
        ${kv(t('អ្នកបើកបរ', 'Driver'), esc(x.driver))}${kv(t('កន្លែងផ្ទុក', 'Loading place'), esc(x.load))}${kv(t('តង់', 'Canvas'), x.tarp === 'Yes' ? t('គ្របតង់', 'Covered') : x.tarp === 'No' ? t('មិនគ្របតង់', 'Not covered') : '')}${kv(t('គោលដៅ', 'Destination'), esc(x.dest))}${kv(t('កំណត់ចំណាំ', 'Note'), esc(x.note))}
      </div>`}
      <div class="w3 mt"><div><small>${t('លើកទី១', '1st')} · ${dmy(x.t1)} ${hm(x.t1)}</small><b>${kg(x.w1)}</b><em class="src">${esc(x.s1 || '')}</em></div>
        <div><small>${t('លើកទី២', '2nd')} · ${dmy(x.t2)} ${hm(x.t2)}</small><b>${kg(x.w2)}</b><em class="src">${esc(x.s2 || '')}</em></div>
        <div><small>${t('សុទ្ធ', 'Net')}</small><b>${kg(x.net)}</b></div></div>
      ${dnCheck(x) ? (c => `<div class="alert ${c.ok ? 'ok' : 'warn'} mt">${c.ok ? '✅' : '❌'} ${t('សរុប DN', 'DN total')} <b>${kg(c.sum)} kg</b> · ${t('សុទ្ធ', 'Net')} <b>${kg(x.net)} kg</b> · ${t('ខុសគ្នា', 'Difference')} <b>${sgn(c.d)} kg</b> · ${c.ok ? t('ត្រូវគ្នា', 'Match') : t('ខុសគ្នា', 'Variance')} (±${kg(dnTol())})</div>`)(dnCheck(x)) : ''}
      ${x.again && x.again.length ? `<h3 class="mt">🔁 ${t('ថ្លឹងម្តងទៀត', 'Scale again')}</h3><div class="tbl"><table><tr><th>#</th><th>${t('ម៉ោង', 'Time')}</th><th class="r">kg</th><th class="r">${t('ខុសពីមុន', 'Change')}</th><th>${t('អ្នកថ្លឹង', 'Weigher')}</th></tr>${x.again.map((c, i) => `<tr><td>${i + 1}</td><td>${dmy(c.t)} ${hm(c.t)}</td><td class="r mono">${kg(c.kg)}</td><td class="r mono">${sgn(Number(c.diff) || 0)}</td><td>${esc(c.by || '')}${c.src && c.src !== 'Scale' ? ' · ' + esc(c.src) : ''}</td></tr>`).join('')}</table></div>` : ''}
      ${x.warn ? `<div class="alert warn">⚠️ ${esc(warnTxt(x.warn))}</div>` : ''}
      ${x.err ? `<div class="alert bad">❗ ${esc(x.err)}</div>` : ''}
      <div class="hint">${t('អ្នកថ្លឹង', 'Weigher')}: ${esc(x.op || '')}${x.pdf ? ` · <a href="${esc(x.pdf)}" target="_blank" rel="noopener">PDF Drive</a>` : ''}</div>
      <div class="btns mt">
        <a class="btn" href="#/list">← ${t('ត្រឡប់', 'Back')}</a>
        ${x.status !== 'Open' || lastAgain(x) ? `<button type="button" class="btn ok" data-print="${esc(x.cid || x.no)}">🖨 ${t('បោះពុម្ព', 'Print')}</button><button type="button" class="btn" data-pdf="${esc(x.cid || x.no)}">📄 PDF</button>` : ''}
        ${x.cid && ((canEdit() && x.status === 'Done') || (isAdmin() && x.status === 'Open')) ? `<button type="button" class="btn" id="tEdit">✏️ ${t('កែព័ត៌មាន', 'Edit details')}</button>` : ''}
        ${isAdmin() && (x.status === 'Done' || x.status === 'Open') && x.cid ? `<button type="button" class="btn danger" id="tVoid">🗑 ${t('លុបប័ណ្ណ', 'Cancel ticket')}</button>` : ''}
        ${x.err && x.cid && LOC[x.cid] ? `<button type="button" class="btn" id="tRetry">↻ ${t('ផ្ញើម្តងទៀត', 'Send again')}</button>` : ''}
      </div>
      <div id="tMore"></div></section>`;
    bindDone();
    if ($('#tPrev')) ticketPreview(x, $('#tPrev'));
    if ($('#tRetry')) $('#tRetry').onclick = () => { putTicket(LOC[x.cid]); renderTicket(key); };
    if ($('#tVoid')) $('#tVoid').onclick = () => {
      $('#tMore').innerHTML = `<div class="alert bad"><b>${t('លុបប័ណ្ណនេះ?', 'Cancel this ticket?')}</b><input class="in mt" id="vWhy" placeholder="${t('មូលហេតុ (ចាំបាច់)', 'Reason (required)')}"><div class="btns mt"><button type="button" class="btn danger" id="vGo">${t('លុប', 'Cancel ticket')}</button></div></div>`;
      $('#vGo').onclick = () => { const why = $('#vWhy').value.trim(); if (!why) { $('#vWhy').classList.add('need'); return; } putTicket(Object.assign({}, x, { status: 'Void', reason: why })); toast(t('បានលុប', 'Cancelled')); renderTicket(key); };
    };
    if ($('#tEdit')) $('#tEdit').onclick = () => editTicket(x, key);
    if (editing && $('#tEdit')) editTicket(x, key);
    if (location.hash.indexOf('?void') > 0 && $('#tVoid')) { $('#tVoid').click(); setTimeout(() => $('#vWhy') && $('#vWhy').focus(), 0); }
  }
  function editTicket(x, key) {
    const f = (id, label, v) => `<div class="field"><label class="f">${label}</label><div><input class="in" id="${id}" autocomplete="off" value="${esc(v || '')}"></div></div>`;
    $('#tMore').innerHTML = `<div class="card soft mt"><div class="fgrid">
      ${x.status === 'Open' && isAdmin() ? f('ePlate', t('លេខឡាន', 'Truck No'), x.plate) : ''}${f('eCompany', t('ក្រុមហ៊ុនឡាន', 'Truck company'), x.company)}${f('eCustomer', t('អតិថិជន', 'Customer'), x.customer)}${f('eItem', t('ទំនិញ', 'Item'), x.item)}
      ${f('eDn', 'DN No (, )', (x.dns || []).join(', '))}${f('eDriver', t('អ្នកបើកបរ', 'Driver'), x.driver)}${f('eLoad', t('កន្លែងផ្ទុក', 'Loading place'), x.load || '')}${f('eDest', t('គោលដៅ', 'Destination'), x.dest)}
      ${f('eNote', t('កំណត់ចំណាំ', 'Note'), x.note)}${f('eWhy', t('មូលហេតុនៃការកែ', 'Reason for the change'), '')}</div>
      <div class="hint">${t('ទម្ងន់មិនអាចកែបានទេ។ ការកែទាំងអស់ត្រូវកត់ត្រាក្នុង Scale Log។', 'Weights cannot be changed here. Every change is written to the Scale Log.')}</div>
      <div class="btns mt"><button type="button" class="btn ok" id="eSave">💾 ${t('រក្សាទុក', 'Save')}</button></div></div>`;
    picker($('#eCustomer'), { list: () => ((B && B.customers) || []).map(c => ({ v: c[1], sub: c[0] })), addNew: true, onPick: () => {} });
    picker($('#eItem'), { list: () => ((B && B.items) || []).map(i => ({ v: i[0] })), addNew: true, onPick: () => {} });
    picker($('#eDest'), { list: () => destList().map(v => ({ v })), addNew: true, onPick: () => {} });
    picker($('#eLoad'), { list: places, addNew: true, onPick: () => {} });
    $('#eSave').onclick = () => {
      const v = id => $(id).value.trim();
      const nx = Object.assign({}, x, $('#ePlate') && v('#ePlate') ? { plate: fixPlate(v('#ePlate')) } : {}, { company: v('#eCompany'), customer: v('#eCustomer'), item: v('#eItem'), dns: khNum(v('#eDn')).split(/[\s,;]+/).filter(Boolean), driver: v('#eDriver'), dest: v('#eDest'), load: v('#eLoad'), note: v('#eNote'), reason: v('#eWhy') });
      putTicket(nx);
      toast(t('បានរក្សាទុក', 'Saved'));
      renderTicket(key);
    };
  }

  // ---------------------------------------------------------------- A4 ticket: picture -> Print or PDF
  let LOGO = null;
  const logo = () => LOGO || (LOGO = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = '../icons/isi-steel-logo.png'; }));
  const ticketUrl = x => location.origin + location.pathname.replace(/[^/]*$/, '') + '#/t/' + encodeURIComponent(x.no);

  /** The ticket as it will print (Word template, else the built-in ticket), shown on the ticket page (Kim). */
  async function ticketPreview(x, el) {
    try {
      if (tplOn()) {
        try {
          const box = await tplRender(x);
          const hold = await tplMount(box);
          if (!el.isConnected) { hold.remove(); return; }
          el.innerHTML = ''; el.appendChild(box); hold.remove();
          const page = box.querySelector('section.docx') || box;
          // a page wider than the screen is shown smaller (phones); the print itself is not changed
          const pw = page.offsetWidth || 794;
          const fit = () => { const room = el.clientWidth - 24; box.style.zoom = pw > room && room > 0 ? (room / pw).toFixed(3) : ''; };
          fit(); requestAnimationFrame(fit);
          if (window.ResizeObserver) new ResizeObserver(fit).observe(el);
          return;
        } catch (e) { /* template not available: built-in ticket below */ }
      }
      const c = await drawTicket(x);
      if (!el.isConnected) return;
      el.innerHTML = '';
      const img = new Image(); img.src = c.toDataURL('image/png'); img.alt = x.no; img.className = 'tprevimg';
      el.appendChild(img);
    } catch (e) { el.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; }
  }
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
    const dl = wrap(dnList(x), W - 2 * M - LW).slice(0, 3);
    dl.forEach((l, i) => g.fillText(l, M + LW, y + 44 + i * 38));
    let dh = Math.max(80, 26 + dl.length * 38);
    const dc = dnCheck(x);   // DN kg vs scale net (Kim, 10 Nov 2026)
    if (dc) { font(24, 700); g.fillStyle = dc.ok ? '#15803d' : '#b91c1c'; g.fillText((dc.ok ? '✓ MATCH' : '✗ VARIANCE') + '   DN total ' + kg(dc.sum) + ' kg  ·  Net ' + kg(x.net) + ' kg  ·  Diff ' + sgn(dc.d) + ' kg (±' + dnTol() + ')', M + LW, y + dh + 2); dh += 36; }
    y += dh; rule();
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
    if (x.agn) { font(26, 700); g.fillStyle = '#6b3fa0'; g.fillText('SCALE AGAIN #' + x.agn + ' · truck still on site, not the final ticket', M, sy - 40); }
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
      TicketNo: x.no || '', Date: dmy(x.t2 || x.t1), TruckNo: x.plate || '', Company: x.company || '', Item: x.item || '', Destination: x.dest || '', Tarp: x.tarp === 'Yes' ? 'គ្របតង់' : x.tarp === 'No' ? 'មិនគ្របតង់' : '',
      DN: dnList(x), DNCount: String(dns.length), DNTotal: dnSum(x) == null ? '' : kg(dnSum(x)), DNVariance: dnCheck(x) ? sgn(dnCheck(x).d) : '', DNCheck: dnCheck(x) ? (dnCheck(x).ok ? 'MATCH' : 'VARIANCE') : '', Note: x.note || '', Customer: x.customer || '', Driver: x.driver || '', Type: typeOf(x),
      Weight1: kg(x.w1), Time1: when(x.t1), Source1: src(x.s1), Weight2: kg(x.w2), Time2: when(x.t2), Source2: src(x.s2),
      Gross: kg(x.gross), Tare: kg(x.tare), Net: kg(x.net), Warning: x.warn ? 'Warning: ' + x.warn : '', Operator: x.op || '',
      Status: x.status === 'Void' ? 'CANCELLED' : x.agn ? 'SCALE AGAIN #' + x.agn + ' · NOT FINISHED' : x.status === 'Open' ? 'NOT FINISHED' : '',
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
    ['scale', '🔌', 'ការភ្ជាប់ជញ្ជីង', 'Scale connection'], ['rules', '⚠️', 'ការព្រមាន & ប័ណ្ណ', 'Warnings & ticket'], ['access', '👥', 'អ្នកមើល Debit Note', 'Debit Note check access']];
  let setQ = '';
  function renderSettings(tab) {
    screen = () => renderSettings(tab);
    document.body.classList.add('wide');
    $('#view').innerHTML = `<div class="setwrap"><nav class="setnav">${SET_TABS.map(x => `<a href="#/set/${x[0]}" class="${x[0] === tab ? 'on' : ''}">${x[1]} ${t(x[2], x[3])}</a>`).join('')}</nav><section class="card setbody" id="setBody"></section></div>`;
    ({ trucks: setTrucks, customers: setCustomers, items: setItems, dests: setDests, scale: setScale, rules: setRules, access: setAccess }[tab] || setTrucks)();
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
      <div class="tbl fit mt"><table><tr>${o.cols.map(c => `<th class="${c[2] || ''}">${c[0]}</th>`).join('')}</tr>
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
      note: t('បញ្ជីតែមួយ៖ ផ្ទាំង "Truck" ក្នុង Fuel Refill (មួយជួរ មួយឡាន)។ តៃកុងនៅផ្ទាំង "Driver & Truck" (CODE = ឡានធម្មតា)។ ទម្ងន់ទទេបំពេញដោយខ្លួនឯងពីការថ្លឹងលើកដំបូង។',
        'One list: the "Truck" tab of the Fuel Refill sheet, one row per plate. Drivers are in the "Driver & Truck" tab (CODE = usual truck); any driver can take any truck. An empty Empty Weight fills itself from the truck\'s first weigh.'),
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
    if ($('#sOff')) $('#sOff').onclick = () => { SER.off = true; serialStop().then(setScale); };
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
  /** Admin picks who sees the Debit Note check menu (Kim, 6 Nov 2026). Admins always see it. */
  function setAccess() {
    const on = String(S().SCALE_DNC_USERS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
    const ppl = ((B && B.people) || []).slice().sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    const extra = on.filter(e => !ppl.some(p => p.email === e));
    $('#setBody').innerHTML = `<h2>👥 ${t('អ្នកដែលមើលឃើញ "ពិនិត្យ Debit Note"', 'Who sees "Debit Note check"')}</h2>
      <p class="hint">${t('ធីកអ្នកដែលអាចមើលម៉ឺនុយនេះ (មានតម្លៃដឹកជញ្ជូន)។ Admin មើលឃើញជានិច្ច។', 'Tick the people who can see this menu (it shows transport prices). Admins always see it.')}</p>
      <input type="search" class="in" id="aQ" data-live-ok placeholder="${t('ស្វែងរក', 'Search')}">
      <div class="alist mt">${ppl.map(p => `<label class="arow" data-q="${esc((p.name + ' ' + p.email).toLowerCase())}"><input type="checkbox" value="${esc(p.email)}"${p.admin ? ' checked disabled' : on.indexOf(p.email) >= 0 ? ' checked' : ''}> <b>${esc(p.name || p.email)}</b> <small class="muted">${esc(p.email)}</small>${p.admin ? ' <span class="badge follow">Admin</span>' : ''}</label>`).join('')
        || `<div class="empty">${t('មិនទាន់មានបញ្ជីអ្នកប្រើ។ សូមដាក់ Scale.gs ថ្មី ហើយ Deploy។', 'No user list yet. Paste the new Scale.gs and deploy.')}</div>`}</div>
      ${extra.length ? `<p class="hint">${t('ផ្សេងទៀត', 'Others')}: ${esc(extra.join(', '))}</p>` : ''}
      <div class="btns mt"><button type="button" class="btn ok" id="aSave">💾 ${t('រក្សាទុក', 'Save')}</button></div>`;
    $('#aQ').oninput = e => { const q = e.target.value.trim().toLowerCase(); $$('.arow').forEach(r => { r.hidden = !!q && r.dataset.q.indexOf(q) < 0; }); };
    $('#aSave').onclick = async () => {
      const b = $('#aSave'); busy(b, true);
      const list = $$('.arow input:checked:not([disabled])').map(i => i.value).concat(extra);
      try {
        const r = await api('scSettings', { SCALE_DNC_USERS: list.join(', ') });
        B.settings = r.settings; set('sc_boot', JSON.stringify(B)); toast(t('បានរក្សាទុក', 'Saved')); setAccess();
        return;
      } catch (e) { toast(e.message); }
      busy(b, false);
    };
  }
  function setRules() {
    const s = S();
    $('#setBody').innerHTML = `<h2>⚠️ ${t('ការព្រមាន & ប័ណ្ណ', 'Warnings & ticket')}</h2>
      <div class="fgrid">
        ${inp('rPct', t('ព្រមានពេលទម្ងន់ទទេខុសពីបញ្ជីឡានលើស (%)', 'Warn when the empty weight differs from the truck list by more than (%)'), s.SCALE_TARE_PCT, 'inputmode="numeric"')}
        ${inp('rMin', t('ទម្ងន់តិចជាងនេះ មិនយក (kg)', 'Ignore weights below (kg)'), s.SCALE_MIN_KG, 'inputmode="numeric"')}
        ${inp('rDnVar', t('ពិនិត្យ kg លើ DN: ខុសពីទម្ងន់សុទ្ធបាន (± kg)', 'DN kg check: allowed difference from the net (± kg)'), dnTol(), 'inputmode="numeric"')}
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
        <span class="mono">{{TicketNo}} {{Date}} {{TruckNo}} {{Company}} {{Item}} {{Destination}} {{DN}} {{DNCount}} {{DNTotal}} {{DNVariance}} {{DNCheck}} {{Tarp}} {{Note}} {{Weight1}} {{Time1}} {{Source1}} {{Weight2}} {{Time2}} {{Source2}} {{Gross}} {{Tare}} {{Net}} {{Warning}} {{Operator}} {{Status}} {{Printed}} {{CompanyName}} {{Customer}} {{Driver}} {{Type}}</span></details>
      <div class="field mt"><label class="f" for="rTpl5">${t('Link គំរូ A5 (មិនចាំបាច់)', 'Link of the A5 template (optional)')}</label>
        <input class="in" id="rTpl5" autocomplete="off" placeholder="https://drive.google.com/file/d/..." value="${esc(s.SCALE_TEMPLATE_A5_LINK || '')}"></div>
      <p class="hint">${t('ទុកទទេ = គំរូ A4 បង្រួមជា A5 ដោយខ្លួនឯង។ ចុច "ច្បាប់ចម្លង A5" ដើម្បីទាញយក កែក្នុង Word ហើយដាក់ក្នុង Drive។',
        'Empty = the A4 template shrunk to A5 by itself. Press "A5 copy" to download it, change it in Word, then put it in Drive.')}</p>
      <div class="field mt"><label class="f" for="rLoad">${t('កន្លែងផ្ទុកលំនាំដើម (កុំព្យូទ័រនេះ)', 'Default loading place (this PC)')}</label>
        <input class="in" id="rLoad" autocomplete="off" placeholder="${LOAD_DEF}" value="${esc(get('sc_load') || '')}"></div>
      <div class="field mt"><span class="f">${t('ក្រដាសរបស់ម៉ាស៊ីនបោះពុម្ព (កុំព្យូទ័រនេះ)', 'Printer paper (this PC)')}</span>
        <div class="chips" style="display:flex;gap:8px;flex-wrap:wrap"><label class="chip"><input type="radio" name="rPaper" value="A4"${paper() === 'A4' ? ' checked' : ''}> A4</label>
        <label class="chip"><input type="radio" name="rPaper" value="A5"${paper() === 'A5' ? ' checked' : ''}> A5</label></div></div>
      ${s.SCALE_TEMPLATE_LINK ? `<div class="btns mt"><button type="button" class="btn" id="rA5">📄 ${t('ទាញយកច្បាប់ចម្លង A5 (Word)', 'Download an A5 copy (Word)')}</button>
        <button type="button" class="btn" id="rTest">🧪 ${t('សាកល្បងគំរូ (PDF)', 'Test the template (PDF)')}</button></div>` : ''}
      <div class="mt"></div><label class="chip mt"><input type="checkbox" id="rMan"${manAll() ? ' checked' : ''}> ✍ ${t('អនុញ្ញាតអ្នកថ្លឹងទាំងអស់ វាយទម្ងន់ (kg) ដោយដៃ (ត្រូវមានមូលហេតុ)', 'Allow every weigher to type the weight (kg) by hand (reason required)')}</label>
      <p class="hint">${t('មិនធីក = មានតែ Admin ទេដែលអាចវាយបាន។ ទម្ងន់វាយដោយដៃ មានសញ្ញា ✍ និងកត់ត្រាមូលហេតុ។', 'Not ticked = only Admins can type a weight. Typed weights are marked ✍ and the reason is logged.')} ${t('ចុច រក្សាទុក ខាងក្រោម។', 'Press Save below.')}</p>
      <div class="mt"></div><label class="chip mt"><input type="checkbox" id="rAuto"${get('sc_autoprint') === '1' ? ' checked' : ''}> ${t('បោះពុម្ពដោយខ្លួនឯង ក្រោយថ្លឹងលើកទី២ (កុំព្យូទ័រនេះ)', 'Print by itself after the 2nd weigh (this PC)')}</label>
      <div class="btns mt"><button type="button" class="btn ok" id="rSave">💾 ${t('រក្សាទុក', 'Save')}</button></div>`;
    $('#rAuto').onchange = e => set('sc_autoprint', e.target.checked ? '1' : null);
    picker($('#rLoad'), { list: places, addNew: true, onPick: v => { set('sc_load', v || null); if (!F.cid && !F.plate) { F.load = v || ''; keepForm(); } toast(t('បានរក្សាទុក', 'Saved')); } });
    document.querySelectorAll('input[name="rPaper"]').forEach(r => { r.onchange = () => { set('sc_paper', r.value === 'A5' ? 'A5' : null); toast(t('ក្រដាស ', 'Paper ') + r.value); if (tplOn()) tplLoad().catch(() => {}); }; });
    if ($('#rA5')) $('#rA5').onclick = async () => {
      const b = $('#rA5'); busy(b, true);
      try { await a5Copy(); } catch (e) { toast(e.message); }
      busy(b, false);
    };
    $('#rSave').onclick = async () => {
      const b = $('#rSave'); busy(b, true);
      try {
        const r = await api('scSettings', { SCALE_TARE_PCT: $('#rPct').value, SCALE_MIN_KG: $('#rMin').value, SCALE_PREFIX: $('#rPre').value.replace(/[^0-9A-Za-z]/g, '') || 'WB', SCALE_COMPANY: $('#rCo').value, SCALE_SIGN: $('#rSign').value, SCALE_TEMPLATE_LINK: $('#rTpl').value.trim(), SCALE_TEMPLATE_A5_LINK: $('#rTpl5').value.trim(), SCALE_MANUAL_ALL: $('#rMan').checked ? 'Yes' : 'No', SCALE_DN_VAR_KG: $('#rDnVar').value.replace(/[^0-9]/g, '') || '120' });
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
  autoConnect();                                 // reconnects to the port picked last time (no prompt)
  setInterval(() => { if (SER.on || SIM.on) lcdSoon(); if ($('#site')) paintLists(); }, 30000);
  setInterval(() => { if (SER.on && Date.now() - SER.last > 3000) lcdSoon(); }, 1000);

  // ---------------------------------------------------------------- demo (no API_URL, or ?demo=1)
  async function demoApi(action, p) {
    await new Promise(r => setTimeout(r, 200));
    const db = getJ('sc_demo', null) || {
      trucks: [{ plate: '3B-5956', company: 'ISI Steel', drivers: ['02.កាំង វណ្ណា'], type: 'Crane Truck', empty: 11300, max: 25000, photo: '',
        info: { loc: 'ISI Steel KMH1', mark: 'HINO', vtype: 'Crane Truck', vtypeKh: 'ដឹកទំនិញធុនធ្ងន់', colour: 'ខៀវ', year: '2019', load: '12,750.0', len: '9.7', wid: '2.5', hei: '3.6', axles: '3.0', insp: '18-08-2026', exp: '18-08-2027', r1: 'Pipes: max 12 m long, tie every 3 m', r2: 'No load over the cab' } },
        { plate: '3C-4266', company: 'ISI Steel', drivers: ['01.ទូច អេ'], type: 'Crane truck', empty: 10400, max: 24000 },
        { plate: '3F-8691', company: '3PL #1', drivers: [], type: '10-wheel', empty: '', max: '' }],
      customers: [['6100000002', '000002-Hun Bonita'], ['6100000005', '000005-ក្រុមហ៊ុន ហ្វូស៊ីន ស្ទីល ប៊ីលឌីង ឯ.ក']],
      items: [['Steel pipe', 'kg', 'Yes'], ['Steel coil', 'kg', 'Yes'], ['Scrap', 'kg', 'Yes']],
      dests: ['KPC Branch', 'Kampong Cham', '12 PNH រាជធានីភ្នំពេញ', 'Siem Reap'], tickets: [],
      settings: { SCALE_TARE_PCT: '5', SCALE_MIN_KG: '200', SCALE_PREFIX: 'WB', SCALE_SIGN: 'Weigher, Driver, Security', SCALE_COMPANY: 'ISI STEEL', SCALE_TEMPLATE_LINK: '', SCALE_DNC_USERS: '' },
      prices: [['CHROEK KIMHENG', 'KPC Branch', 'Per t', 8.5, 't'], ['3PL #1', 'Kampong Cham', 'Per t', 9, 't']],
    };
    const keep = () => set('sc_demo', JSON.stringify(db));
    const u = { name: 'Kim (demo)', email: 'kim@demo', admin: true, reviewer: true };
    if (action === 'scBoot') return { user: Object.assign({ dnc: true }, u), prices: db.prices || [], people: [{ email: 'kim@demo', name: 'Kim (demo)', admin: true }, { email: 'dara@demo', name: 'Dara' }, { email: 'sok@demo', name: 'Sok' }], trucks: db.trucks, customers: db.customers, items: db.items, dests: db.dests, settings: db.settings, tickets: db.tickets, lastTare: {}, sheetUrl: '' };
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
    if (action === 'scTruckPhoto') { const x = db.trucks.find(y => normP(y.plate) === normP(p.plate)); if (!x) throw Object.assign(new Error('This truck is not in the Truck list.'), { code: 'BAD' }); x.photo = p.img; keep(); return { trucks: db.trucks }; }
    if (action === 'scSettings') { ['SCALE_TEMPLATE_LINK', 'SCALE_TEMPLATE_A5_LINK', 'SCALE_MANUAL_ALL', 'SCALE_DN_VAR_KG'].concat(Object.keys(db.settings)).forEach(k => { if (p[k] !== undefined) db.settings[k] = p[k]; }); keep(); return { settings: db.settings }; }
    throw Object.assign(new Error('Unknown action'), { code: 'BAD' });
  }
})();
