// Inbound: goods receipt log (Kim's template "GOODS RECEIPT LOG", 26 Oct 2026).
// One record per truck (several items from one PO): arrival / GR / damaged qty per item, date,
// start/end time, time spent, productivity, manpower, truck owner, remark.
// Demo mode while IB_CONFIG.API_URL is empty: data lives in this browser only.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const t = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const CFG = window.IB_CONFIG || {};
  const DEMO = !CFG.API_URL;

  const UOMS = ['Kg', 'Ton', 'PC', 'M', 'BAG', 'ROL'];
  const PLATES = ['2A-2233', '3E-2588', '3E-4320', '3E-6115', '3A-2102', '2B-7741', '3C-1180', '2A-9054', '3F-3307', '3B-5521'];
  const CARRIERS = ['FOXS', 'Queen Legacy', 'Srong Sal', 'Chroek Kimheng', 'Vannoun'];

  // ------------------------------------------------------------------ time helpers
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const showDate = s => { if (!s) return ''; const p = s.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; };
  const toMin = s => { if (!s) return null; const p = s.split(':'); return +p[0] * 60 + +p[1]; };
  const today = () => ymd(new Date());
  const nowHM = () => hm(new Date());
  const spentMin = r => { const a = toMin(r.start), b = r.end ? toMin(r.end) : toMin(nowHM()); if (a == null || b == null) return null; let m = b - a; if (m < 0) m += 1440; return m; };
  const showSpent = m => m == null ? '–' : (m >= 60 ? Math.floor(m / 60) + t('ម៉ោង ', 'h ') + pad(m % 60) + t('នាទី', 'm') : m + t(' នាទី', ' min'));
  const clock = m => (m == null ? '–' : m >= 60 ? Math.floor(m / 60) + ':' + pad(m % 60) : m + t(' នាទី', ' min'));
  const fmt = (n, d = 0) => n == null || isNaN(n) ? '–' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  // A receipt (one truck) carries several items: { material, desc, poQty, arrQty, grQty, dmgQty, dmgType, dmgPh[] }.
  const tot = (r, k) => (r.items || []).reduce((s, i) => s + (+i[k] || 0), 0);
  const tons = r => tot(r, 'grQty') / 1000;
  const isDamaged = r => (r.items || []).some(i => +i.dmgQty > 0);
  const isLessItem = i => i.grQty !== '' && i.grQty != null && +i.grQty < +i.arrQty;
  const isLess = r => !!r.end && (r.items || []).some(isLessItem);
  // Productivity = what one person unloads in one hour (tonnes).
  const prod = r => {
    const m = r.end ? spentMin(r) : null; const mp = +r.manpower || 0; const q = tons(r); if (!m || !mp || !q) return null;
    return q / (m / 60) / mp;
  };
  const prodUnit = () => t('តោន/នាក់/ម៉ោង', 't/person/h');
  const diffPct = (a, b) => (!a || !b ? null : (a - b) / b * 100);

  // ------------------------------------------------------------------ incoming plan (Kim's "Incoming Packing List Template")
  // One row per PO line: the real app reads these from the Incoming Plan tab of the sheet.
  const PL = (po, inbound, ref, eta, supplier, lines) => lines.map(l => ({ po, inbound, ref, eta, supplier, material: l[0], desc: l[1], plant: 'KMH1', sloc: l[4] || '1020', kg: l[2], pcs: l[3] }));
  const PLAN = [].concat(
    PL('PO5100012725', 'Test IN 1800048956', '1072003238-Lot1', '2026-10-18', 'Regency', [
      ['1100000230', 'INTANU G300AZ30 BT 1200x0.260', 32520, 7], ['1100000231', 'INTANU G300AZ30 BR 1200x0.220', 23550, 5],
      ['1100000232', 'INTANU G300AZ30 BR 1200x0.260', 49000, 11], ['1100000233', 'INTANU G300AZ30 BR 1200x0.310', 36230, 8],
      ['1100000968', 'INTANU G300AZ30 BR 1200x0.360', 46140, 10], ['1100000234', 'INTANU G300AZ30 CH 1200x0.260', 46290, 10],
      ['1100000239', 'INTANU G300AZ30 LB 1200x0.220', 18400, 4], ['1100000240', 'INTANU G300AZ30 LB 1200x0.260', 88170, 19],
      ['1100000241', 'INTANU G300AZ30 LB 1200x0.310', 52560, 12], ['1100000242', 'INTANU G300AZ30 MK 1200x0.260', 37080, 8],
      ['1100000780', 'INTANU G300AZ30 MK 1200x0.310', 53030, 12], ['1100000781', 'INTANU G300AZ30 MK 1200x0.360', 22830, 5],
      ['1100001392', 'INTANU G300AZ30 SW 1065x0.220', 20870, 5], ['1100001393', 'INTANU G300AZ30 SW 1110x0.220', 53360, 12],
      ['1100000244', 'INTANU G300AZ30 YL 1200x0.220', 50730, 11], ['1100000245', 'INTANU G300AZ30 YL 1200x0.260', 174450, 39],
      ['1100000246', 'INTANU G300AZ30 YL 1200x0.310', 90890, 20], ['1100000247', 'INTANU G300AZ30 YL 1200x0.360', 42170, 10]]),
    PL('PO5100012740', 'IN 1800049012', '1072003255-Lot2', '2026-10-24', 'Sample Supplier A', [
      ['1100000300', 'HRC SS400 1219x2.00 (sample)', 41200, 2], ['1100000301', 'HRC SS400 1219x2.50 (sample)', 38900, 2], ['1100000302', 'HRC SS400 1219x3.00 (sample)', 44700, 2]]),
    PL('PO5100012751', 'IN 1800049030', 'ZN-2026-117', '2026-10-27', 'Sample Supplier B', [
      ['1200000101', 'ZINC INGOT SHG 99.995% (sample)', 25000, 1000]]));
  const POS = Array.from(new Set(PLAN.map(p => p.po)));
  const lineOf = (po, mat) => PLAN.find(p => p.po === po && p.material === mat);
  const showEta = s => showDate(s);

  // damage types (Kim, 28 Oct 2026: Dent, Rust, ... "suggest more")
  const DMG = [
    ['dent', '🔨', 'ផត / បុក', 'Dent'],
    ['rust', '🟤', 'ច្រេះ', 'Rust'],
    ['wet', '💧', 'ទទឹកទឹក', 'Wet / water'],
    ['edge', '🧩', 'ខូចគែម', 'Edge damage'],
    ['scratch', '〰️', 'ស្នាមឆ្កូត', 'Scratch'],
    ['bent', '↪️', 'កោង / ខូចរាង', 'Bent / out of shape'],
    ['coat', '🎨', 'របកថ្នាំ / ស្រទាប់', 'Coating peeled'],
    ['pack', '📦', 'វេចខ្ចប់រហែក', 'Packing torn'],
    ['wrong', '❌', 'ទំនិញខុស', 'Wrong item'],
    ['other', '❓', 'ផ្សេងៗ', 'Other'],
  ];
  const dmgName = k => { const d = DMG.find(x => x[0] === k); return d ? d[1] + ' ' + t(d[2], d[3]) : (k || ''); };
  const MAX_DMG_PH = 6;

  // ------------------------------------------------------------------ data (demo)
  let DATA = [];
  function seed() {
    const out = []; const base = new Date(); base.setHours(0, 0, 0, 0);
    const rows = [
      // daysAgo, start, minutes, items [plan line, arrival kg, GR diff, damaged qty, damage type], men, owner, carrier
      [0, '-420', 48, [[0, 32520, 0]], 3, '3PL', 'FOXS'],
      [0, '-330', 62, [[1, 23550, -120, 1, 'dent'], [6, 18400, 0]], 2, 'ISI', ''],
      [0, '-200', 35, [[21, 25000, 0]], 4, '3PL', 'Queen Legacy'],
      [0, '-52', null, [[18, 41200]], 3, '3PL', 'Srong Sal'],
      [0, '-25', null, [[3, 36230]], 2, 'ISI', ''],
      [1, '07:30', 55, [[2, 40000, 0]], 3, '3PL', 'FOXS'],
      [1, '09:10', 71, [[4, 26140, 0], [11, 12830, 0]], 2, 'ISI', ''],
      [1, '11:00', 40, [[19, 38900, -500, 2, 'rust']], 4, '3PL', 'Chroek Kimheng'],
      [1, '14:30', 55, [[5, 40000, 0]], 2, 'ISI', ''],
      [2, '08:00', 50, [[7, 40000, 0]], 3, '3PL', 'FOXS'],
      [2, '10:45', 90, [[7, 40000, 0]], 2, '3PL', 'Vannoun'],
      [3, '07:50', 58, [[8, 38000, 0]], 3, 'ISI', ''],
      [3, '09:30', 64, [[15, 40000, -50]], 3, '3PL', 'Srong Sal'],
      [4, '08:15', 52, [[15, 40000, 0]], 3, '3PL', 'Queen Legacy'],
      [4, '10:00', 75, [[16, 39000, -600, 1, 'edge']], 2, 'ISI', ''],
    ];
    rows.forEach((x, i) => {
      const d = new Date(base); d.setDate(d.getDate() - x[0]);
      let start = x[1];
      // today's rows are placed relative to now so the demo always looks live
      if (start[0] === '-') { const s = new Date(Math.max(base.getTime(), Date.now() + (+start) * 60000)); start = hm(s); }
      const end = x[2] == null ? '' : hm(new Date(d.getTime() + (toMin(start) + x[2]) * 60000));
      const p0 = PLAN[x[3][0][0]];
      out.push(Object.assign(header(p0), {
        id: 'IB' + ymd(d).slice(2).replace(/-/g, '') + '-' + pad(i + 1), truck: PLATES[i % PLATES.length], dn3pl: 'DN-' + (26100 + i * 7),
        items: x[3].map(it => Object.assign(item(PLAN[it[0]]), { arrQty: it[1], grQty: end ? it[1] + (it[2] || 0) : '', dmgQty: end ? it[3] || 0 : '', dmgType: it[4] || '', dmgPh: it[3] ? ['sample', 'sample'] : [] })),
        date: ymd(d), start, end, manpower: x[4], owner: end ? x[5] : '', carrier: x[6],
        remark: i === 10 ? 'រង់ចាំស៊ីរ៉ង់ / waited for crane' : '', ph: { front: 'sample', load: 'sample', doc: 'sample' }, by: i % 3 ? 'Sokha (Storekeeper)' : 'Dara (Checker)',
      }));
    });
    return out;
  }
  // the greyed fields copied from the plan
  function header(p) { return { po: p.po, inbound: p.inbound, ref: p.ref, supplier: p.supplier, eta: p.eta, uom: 'Kg' }; }
  function item(p) { return { material: p.material, desc: p.desc, poQty: p.kg, pcs: p.pcs, arrQty: '', grQty: '', dmgQty: '', dmgType: '', dmgPh: [] }; }
  // kg already arrived (being unloaded) or received against one plan line
  const recvd = (po, mat, skip) => DATA.filter(r => r.po === po && r.id !== skip).reduce((s, r) => s + (r.items || []).filter(i => i.material === mat).reduce((a, i) => a + (+(r.end ? i.grQty : i.arrQty) || 0), 0), 0);
  const left = (x, skip) => Math.max(0, x.kg - recvd(x.po, x.material, skip));
  // a PO is pending while any of its lines still has kg to receive
  const pendingLines = (po, skip) => PLAN.filter(x => x.po === po && left(x, skip) > 0);
  const pendingPOs = skip => POS.filter(po => pendingLines(po, skip).length);
  function load() {
    const s = get('ib_demo_v5');
    if (s) { try { const o = JSON.parse(s); if (o.day === today()) { DATA = o.rows; return; } } catch (e) { /* reseed */ } }
    DATA = seed(); save();
  }
  function save() { set('ib_demo_v5', JSON.stringify({ day: today(), rows: DATA })); }
  const byId = id => DATA.find(r => r.id === id);
  const isLive = r => r.start && !r.end;

  // ------------------------------------------------------------------ chrome
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { el.hidden = true; }, 2400); }
  function paintStatic() { $$('[data-km]').forEach(el => { el.textContent = t(el.dataset.km, el.dataset.en); }); }
  function paintTabs(r) { $$('.tab[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === r)); const n = DATA.filter(isLive).length; const c = $('#liveCount'); c.textContent = n; c.hidden = !n; }
  const view = html => { $('#view').innerHTML = html; window.scrollTo(0, 0); const m = $('main'); if (m) m.scrollTop = 0; };

  const lessBadge = () => `<span class="badge less">⬇ ${t('ទទួលខ្វះ', 'Received less')}</span>`;
  function badges(r) {
    const b = [];
    if (isLive(r)) b.push(`<span class="badge live">⏱ ${t('កំពុងទម្លាក់', 'Unloading')}</span>`);
    else b.push(`<span class="badge ok">✅ ${t('រួចរាល់', 'Done')}</span>`);
    if (isDamaged(r)) b.push(`<span class="badge dmg">⚠️ ${t('ខូចខាត', 'Damaged')} ${fmt(tot(r, 'dmgQty'))}</span>`);
    if (isLess(r)) b.push(lessBadge());
    return b.join(' ');
  }
  const ownerTxt = r => r.owner === 'ISI' ? t('ឡាន ISI', 'ISI truck') : '3PL' + (r.carrier ? ' · ' + r.carrier : '');
  function itemHTML(r) {
    const m = spentMin(r), its = r.items || [];
    return `<a class="item${isLive(r) ? ' live' : ''}" href="#/r/${r.id}">
      <div class="top"><span class="id">🚛 ${esc(r.truck)}</span>${isLive(r) ? `<span class="timer${m > 60 ? ' slow' : ''}" data-timer="${r.id}">${clock(m)}</span>` : `<span>${badges(r)}</span>`}</div>
      <div class="ttl">${esc(its[0] ? its[0].desc : '')}${its.length > 1 ? ` <small class="il">+${its.length - 1} ${t('មុខទៀត', 'more')}</small>` : ''}</div>
      <div class="meta">${esc(r.po)} · ${esc(r.supplier)}</div>
      <div class="meta">${esc(ownerTxt(r))} · <b>${esc(fmt(r.end ? tot(r, 'grQty') : tot(r, 'arrQty')))} ${esc(r.uom)}</b> · ${esc(r.start)}${r.end ? '–' + esc(r.end) : ''} · 👷 ${esc(r.manpower)}</div>
      ${isLive(r) ? `<div class="meta">${badges(r)}</div>` : ''}
    </a>`;
  }

  // ------------------------------------------------------------------ Today
  function renderHome() {
    paintTabs('home');
    const td = DATA.filter(r => r.date === today());
    const live = td.filter(isLive), done = td.filter(r => r.end);
    const tn = done.reduce((s, r) => s + tons(r), 0);
    const avg = done.length ? done.reduce((s, r) => s + spentMin(r), 0) / done.length : null;
    view(`
      <button class="btn ok big new-btn" id="newBtn">＋ ${t('ទទួលទំនិញថ្មី', 'New goods receipt')}</button>
      <div class="stats">
        <div class="stat"><small>${t('ឡានថ្ងៃនេះ', 'Trucks today')}</small><b>${td.length}</b></div>
        <div class="stat"><small>${t('កំពុងទម្លាក់', 'Unloading now')}</small><b>${live.length}</b></div>
        <div class="stat"><small>${t('បានទទួល', 'Received')}</small><b>${fmt(tn, 1)}<em>t</em></b></div>
        <div class="stat"><small>${t('រយៈពេលមធ្យម', 'Avg time')}</small><b>${avg == null ? '–' : fmt(avg)}<em>${t('នាទី', 'min')}</em></b></div>
      </div>
      <div class="head2"><h2>⏱ ${t('កំពុងទម្លាក់ឥឡូវនេះ', 'Unloading now')}</h2></div>
      <div class="list">${live.length ? live.map(itemHTML).join('') : `<div class="empty">${t('គ្មានឡានកំពុងទម្លាក់', 'No truck unloading')}</div>`}</div>
      <div class="head2"><h2>✅ ${t('រួចរាល់ថ្ងៃនេះ', 'Done today')}</h2><a class="link" href="#/log">${t('មើលទាំងអស់', 'See all')} ›</a></div>
      <div class="list">${done.length ? done.slice().reverse().map(itemHTML).join('') : `<div class="empty">${t('មិនទាន់មាន', 'None yet')}</div>`}</div>`);
    $('#newBtn').onclick = () => { location.hash = '#/new'; };
  }

  // ------------------------------------------------------------------ Log
  let LQ = '', LF = 'all';
  function renderLog() {
    paintTabs('log');
    const q = LQ.toLowerCase();
    const F = { all: () => true, live: isLive, done: r => !!r.end, dmg: isDamaged, less: isLess };
    const rows = DATA.filter(F[LF]).filter(r => !q || [r.po, r.inbound, r.ref, r.supplier, r.dn3pl, r.truck, r.carrier, r.owner, r.remark].concat((r.items || []).map(i => i.material + ' ' + i.desc)).join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
    let last = '', html = '';
    rows.forEach(r => { if (r.date !== last) { last = r.date; html += `<div class="daylabel">${r.date === today() ? t('ថ្ងៃនេះ', 'Today') + ' · ' : ''}${showDate(r.date)}</div>`; } html += itemHTML(r); });
    const chip = (k, km, en) => `<button class="chip${LF === k ? ' on' : ''}" data-f="${k}">${t(km, en)}</button>`;
    view(`
      <input class="in search-in" id="q" type="search" placeholder="🔎 ${esc(t('ស្វែងរក៖ PO, សម្ភារៈ, ផ្លាកលេខ, DN', 'Search: PO, material, plate, DN'))}" value="${esc(LQ)}">
      <div class="filters">${chip('all', 'ទាំងអស់', 'All')}${chip('live', '⏱ កំពុងទម្លាក់', '⏱ Unloading')}${chip('done', '✅ រួចរាល់', '✅ Done')}${chip('dmg', '⚠️ ខូចខាត', '⚠️ Damaged')}${chip('less', '⬇ ទទួលខ្វះ', '⬇ Received less')}</div>
      <div class="list">${html || `<div class="empty">${t('រកមិនឃើញ', 'Nothing found')}</div>`}</div>
      <button class="btn" id="xls">⬇️ ${t('ទាញយក Excel', 'Download Excel')}</button>`);
    const qi = $('#q'); qi.oninput = () => { LQ = qi.value; const pos = qi.selectionStart; renderLog(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
    $$('[data-f]').forEach(b => { b.onclick = () => { LF = b.dataset.f; renderLog(); }; });
    $('#xls').onclick = () => (DEMO ? toast(t('សាកល្បង៖ កម្មវិធីពិតនឹងទាញយក Excel', 'Demo: the real app downloads Excel')) : exportCsv(rows));
  }
  // one row per item, in the order of Kim's GOODS RECEIPT LOG
  function exportCsv(rows) {
    const H = ['PO Number', 'Inbound Number', 'Ref. No.', 'Supplier', 'ETA', '3PL DN Number', 'Material', 'Material Description', 'Truck Number/Trailer', 'PO Qty', 'Arrival Qty', 'Actual GR Qty', 'Damaged Qty', 'Damage Type', 'Received Less', 'UoM', 'Receipt Date', 'Start Time', 'End Time', 'Time Spent (min)', 'Productivity (t/person/h)', 'Manpower used to Unload/Receive', 'Truck Owner', 'Remark'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [H.map(q).join(',')];
    rows.forEach(r => (r.items || []).forEach(i => lines.push([
      r.po, r.inbound, r.ref, r.supplier, showDate(r.eta), r.dn3pl, i.material, i.desc, r.truck, i.poQty, i.arrQty, i.grQty, i.dmgQty, i.dmgType ? DMG.find(d => d[0] === i.dmgType)[3] : '', isLessItem(i) ? 'Yes' : '', r.uom,
      showDate(r.date), r.start, r.end, r.end ? spentMin(r) : '', prod(r) == null ? '' : fmt(prod(r), 2), r.manpower,
      r.owner === 'ISI' ? 'ISI Truck' : r.owner ? '3PL Truck' + (r.carrier ? ' (' + r.carrier + ')' : '') : '', r.remark,
    ].map(q).join(','))));
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
      a.download = 'Goods_Receipt_Log.csv'; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast(t('ទាញយកមិនបាន', 'Download failed')); }
  }

  // ------------------------------------------------------------------ form
  // Step 1 (arrival): pick a pending PO, tick the items on this truck, type arrival qty, 3PL DN no., truck, 3 photos.
  // Step 2 (finish): actual GR qty + damaged qty per item (damage type + up to 6 photos), owner, manpower.
  let F = null;
  const PHOTOS = [
    ['front', '🚛', 'រូបថតមុខឡាន (ឃើញផ្លាកលេខ)', 'Front of truck (plate visible)'],
    ['load', '📦', 'រូបថតទំនិញពេញឡាន', 'Full load on the truck'],
    ['doc', '📄', 'រូបថតឯកសារ (Packing List)', 'Shipping document (Packing List)'],
  ];
  function blank() { return { id: '', po: '', inbound: '', ref: '', supplier: '', eta: '', dn3pl: '', truck: '', items: [], uom: 'Kg', date: today(), start: '', end: '', manpower: 2, owner: '', carrier: '', remark: '', ph: {} }; }
  const pickBtn = (id, v, cls, isNew) => `<button type="button" class="picker${cls || ''}" id="${id}"><span class="${v ? '' : 'pph'}">${esc(v || t('— ជ្រើសរើស —', '— Select —'))}${v && isNew ? ` <small class="new-tag">${t('ថ្មី', 'New')}</small>` : ''}</span><span class="pk-ic" aria-hidden="true">🔍</span></button>`;
  const grey = (lbl, v) => `<div class="field"><label class="f">${lbl}</label><input class="in ro" value="${esc(v)}" readonly tabindex="-1" placeholder="—"></div>`;
  const phImg = (v, ic) => v && v !== 'sample' ? `<img src="${v}" alt="">` : `<span class="sam">${ic}<small>${v ? t('គំរូ', 'sample') : t('ថត', 'Take')}</small></span>`;
  function phTile(k, ic, km, en) {
    const v = F.ph && F.ph[k];
    return `<label class="shot${v ? ' has' : ''}"><input type="file" accept="image/*" capture="environment" data-ph="${k}" hidden><div class="ph">${phImg(v, v ? ic : '📷')}</div><small>${ic} ${t(km, en)} <span class="req">*</span></small></label>`;
  }
  // the items table: Item | PO Qty | Arrival Qty | Actual GR Qty | Damaged Qty | UoM.
  // Columns that are not asked yet are greyed (arrival: GR + damaged; finish: arrival).
  function itemsTable(r, mode) {
    const cell = (i, n, k, on) => on ? `<input class="qin" data-it="${n}" data-k="${k}" inputmode="decimal" value="${esc(i[k])}" placeholder="${k === 'grQty' ? esc(i.arrQty) : k === 'dmgQty' ? '0' : ''}">`
      : `<span class="qro">${i[k] === '' || i[k] == null ? '—' : fmt(i[k])}</span>`;
    const rows = r.items.map((i, n) => {
      const less = isLessItem(i), dm = +i.dmgQty > 0;
      let out = `<tr class="nmrow${less ? ' lessrow' : ''}"><td colspan="5" class="nm"><b>${n + 1}. ${esc(i.desc)}</b><small>${esc(i.material)}${i.pcs ? ' · ' + esc(i.pcs) + ' PCS' : ''}</small>${less ? ` ${lessBadge()} <small class="il">${fmt(i.grQty - i.arrQty)}</small>` : ''}${mode === 'arr' ? `<button type="button" class="rm" data-rm="${n}" aria-label="remove">✕</button>` : ''}</td></tr>
        <tr class="qrow${less ? ' lessrow' : ''}">
        <td class="n">${cell(i, n, 'poQty', false)}</td>
        <td class="n">${cell(i, n, 'arrQty', mode === 'arr')}</td>
        <td class="n">${cell(i, n, 'grQty', mode === 'fin')}</td>
        <td class="n">${cell(i, n, 'dmgQty', mode === 'fin')}</td>
        <td class="u">${esc(r.uom)}</td></tr>`;
      if (dm) {
        const ph = i.dmgPh || [];
        out += `<tr class="dmgrow"><td colspan="5">
          <div class="dmgbox">
            <label class="f">⚠️ ${t('ប្រភេទខូចខាត', 'Damage type')}${mode === 'fin' ? ' <span class="req">*</span>' : ''}</label>
            ${mode === 'fin' ? pickBtn('dt' + n, i.dmgType ? dmgName(i.dmgType) : '') : `<b>${esc(dmgName(i.dmgType) || '–')}</b>`}
            <label class="f mt">📷 ${t('រូបថតការខូចខាត', 'Damage photos')} <small class="il">${ph.length}/${MAX_DMG_PH}</small>${mode === 'fin' ? ' <span class="req">*</span>' : ''}</label>
            <div class="photos">${ph.map((v, j) => `<div class="ph">${phImg(v, '⚠️')}${mode === 'fin' ? `<button type="button" data-delph="${n}:${j}" aria-label="remove">✕</button>` : ''}</div>`).join('')}${mode === 'fin' && ph.length < MAX_DMG_PH ? `<label class="ph add"><input type="file" accept="image/*" capture="environment" data-dph="${n}" hidden>📷</label>` : ''}</div>
          </div></td></tr>`;
      }
      return out;
    }).join('');
    const sum = k => fmt(tot(r, k));
    return `<div class="tblwrap"><table class="itbl">
      <thead><tr><th class="n">${t('បរិមាណ PO', 'PO Qty')}</th><th class="n${mode === 'arr' ? ' on' : ''}">${t('បរិមាណមកដល់', 'Arrival Qty')}</th><th class="n${mode === 'fin' ? ' on' : ''}">${t('ទទួលជាក់ស្តែង', 'Actual GR Qty')}</th><th class="n${mode === 'fin' ? ' on' : ''}">${t('ខូចខាត', 'Damaged Qty')}</th><th class="u">${t('ឯកតា', 'UoM')}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="5" class="tl">${t('សរុប', 'Total')} · ${r.items.length} ${t('មុខ', 'items')}</td></tr><tr><td class="n">${sum('poQty')}</td><td class="n">${sum('arrQty')}</td><td class="n">${mode === 'arr' ? '—' : sum('grQty')}</td><td class="n">${mode === 'arr' ? '—' : sum('dmgQty')}</td><td class="u">${esc(r.uom)}</td></tr></tfoot>
    </table></div>`;
  }
  function renderForm(id) {
    paintTabs('');
    if (!F || F.id !== (id || '')) F = id ? JSON.parse(JSON.stringify(byId(id))) : blank();
    const r = F, started = !!r.start, editing = !!r.id;
    const m = r.start ? spentMin(r) : null, p = prod(r);
    const lock = editing ? ' off' : '';
    const mode = started ? 'fin' : 'arr';
    const pend = r.po ? pendingLines(r.po, r.id) : [];
    view(`
      <div class="head2"><h2>${editing ? (isLive(r) ? '⏱ ' + t('បញ្ចប់ការទម្លាក់', 'Finish unloading') : '✏️ ' + t('កែប្រែ', 'Edit')) : '＋ ' + t('ទទួលទំនិញថ្មី', 'New goods receipt')}</h2><a class="link" href="${editing ? '#/r/' + r.id : '#/'}">✕</a></div>

      <section class="card"><h2>📄 ${t('ផែនការទំនិញចូល', 'Incoming plan')}</h2>
        <div class="field"><label class="f">${t('លេខ PO', 'PO Number')} <span class="req">*</span> <small class="il">${t('តែ PO មិនទាន់ទទួលគ្រប់', 'pending POs only')}</small></label>
          ${pickBtn('po', r.po, lock)}</div>
        ${r.po ? `
        <div class="row2">${grey(t('លេខ Inbound', 'Inbound Number'), r.inbound)}${grey('Ref. No.', r.ref)}</div>
        <div class="row2">${grey(t('អ្នកផ្គត់ផ្គង់', 'Supplier'), r.supplier)}${grey('ETA', showEta(r.eta))}</div>
        <div class="field"><label class="f">${t('ទំនិញលើឡាននេះ', 'Items on this truck')} <span class="req">*</span> <small class="il">${pend.length} ${t('មុខមិនទាន់ទទួល', 'pending')}</small></label>
          ${editing ? '' : `<button type="button" class="picker" id="items"><span class="${r.items.length ? '' : 'pph'}">${r.items.length ? '☑️ ' + r.items.length + ' ' + t('មុខបានជ្រើស', 'items chosen') : t('— ជ្រើសទំនិញ (ច្រើនមុខបាន) —', '— Choose items (several allowed) —')}</span><span class="pk-ic" aria-hidden="true">🔍</span></button>`}</div>
        ${r.items.length ? itemsTable(r, mode) : ''}` : `<p class="hint">${t('ជ្រើស PO ដើម្បីបង្ហាញព័ត៌មានពីផែនការដោយស្វ័យប្រវត្តិ។', 'Choose a PO to fill the details from the plan automatically.')}</p>`}
      </section>

      <section class="card"><h2>🚛 ${t('ឡាន និងរូបថត', 'Truck and photos')}</h2>
        <div class="row2">
          <div class="field"><label class="f">${t('ផ្លាកលេខឡាន / រ៉ឺម៉ក', 'Truck number / trailer')} <span class="req">*</span></label>
            ${pickBtn('truck', r.truck, '', r.newTruck)}</div>
          ${grey(t('ថ្ងៃទទួល', 'Receipt date'), showDate(r.date))}
        </div>
        <div class="field"><label class="f">${t('លេខ DN របស់ 3PL', '3PL DN Number')} <span class="req">*</span></label><input class="in" id="dn3pl" value="${esc(r.dn3pl)}" placeholder="DN-..." autocapitalize="characters"></div>
        <div class="shots">${PHOTOS.map(x => phTile(...x)).join('')}</div>
      </section>

      ${started ? `
      <section class="card"><h2>👷 ${t('ឡាន និងកម្មករ', 'Truck owner and manpower')}</h2>
        <div class="field"><label class="f">${t('ម្ចាស់ឡាន', 'Truck owner')} <span class="req">*</span></label>
          <div class="seg"><button type="button" data-own="ISI" class="${r.owner === 'ISI' ? 'on' : ''}">🏭 ${t('ឡាន ISI', 'ISI truck')}</button><button type="button" data-own="3PL" class="${r.owner === '3PL' ? 'on' : ''}">🚚 ${t('ឡាន 3PL', '3PL truck')}</button></div></div>
        ${r.owner === '3PL' ? `<div class="field"><label class="f">${t('ក្រុមហ៊ុន 3PL', '3PL company')}</label>${pickBtn('carrier', r.carrier, '', r.newCarrier)}</div>` : ''}
        <div class="field"><label class="f">${t('ចំនួនកម្មករលើក/ទទួល', 'Manpower to unload/receive')}</label>
          <div class="stepper"><button type="button" id="mpm">−</button><b id="mp">${esc(r.manpower)}</b><button type="button" id="mpp">＋</button><span class="hint">👷 ${t('នាក់', 'people')}</span></div></div>
      </section>

      <section class="card"><h2>⏱ ${t('ម៉ោងទម្លាក់', 'Unloading time')}</h2>
        <div class="timebox">
          <div class="tbox"><small>▶ ${t('ម៉ោងចាប់ផ្តើម', 'Start time')}</small><input type="time" id="start" value="${esc(r.start)}"></div>
          <div class="tbox"><small>⏹ ${t('ម៉ោងបញ្ចប់', 'End time')}</small>${r.end ? `<input type="time" id="end" value="${esc(r.end)}">` : `<b>– – : – –</b>`}</div>
        </div>
        <div class="calc">
          <div class="tbox"><small>${t('រយៈពេល', 'Time spent')}</small><b>${showSpent(m)}</b></div>
          <div class="tbox"><small>${t('ផលិតភាព', 'Productivity')}</small><b>${p == null ? '–' : fmt(p, 1)}</b><small>${p == null ? t('គណនាពេលបញ្ចប់', 'Shown at finish') : esc(prodUnit())}</small></div>
        </div>
      </section>
      <section class="card"><h2>📝 ${t('សំគាល់', 'Remark')}</h2><textarea class="in" id="remark" rows="2">${esc(r.remark)}</textarea></section>` : `
      <p class="hint">${t('ម៉ោងចាប់ផ្តើមកត់ត្រាដោយស្វ័យប្រវត្តិ ពេលចុចប៊ូតុងខាងក្រោម។ បរិមាណទទួលជាក់ស្តែង និងខូចខាត បំពេញពេលបញ្ចប់។', 'Start time is taken when you tap the button below. Actual GR qty and damaged qty are filled at finish.')}</p>`}

      ${!started ? `<button class="btn ok big bigstart" id="startBtn">▶ ${t('ចាប់ផ្តើមទម្លាក់ឥឡូវ', 'Start unloading now')}</button>`
        : isLive(r) ? `<button class="btn big bigstart endbtn" id="endBtn">⏹ ${t('បញ្ចប់ការទម្លាក់ ហើយរក្សាទុក', 'Finish unloading & save')}</button><button class="btn mt" id="saveBtn">💾 ${t('រក្សាទុក (មិនទាន់បញ្ចប់)', 'Save (not finished)')}</button>`
          : `<button class="btn ok big" id="saveBtn">💾 ${t('រក្សាទុក', 'Save')}</button>`}
      <div style="height:16px"></div>`);
    bindForm();
  }
  function collect() {
    ['dn3pl', 'start', 'end', 'remark'].forEach(k => { const el = $('#' + k); if (el) F[k] = el.value.trim(); });
    $$('[data-it]').forEach(el => { const v = el.value.replace(/,/g, '').trim(); F.items[+el.dataset.it][el.dataset.k] = v === '' ? '' : +v; });
  }
  function pickPO(po) {
    const keep = { id: F.id, dn3pl: F.dn3pl, truck: F.truck, newTruck: F.newTruck, by: F.by, ph: F.ph, date: F.date, manpower: F.manpower };
    const b = blank(); const l = PLAN.find(x => x.po === po);
    F = Object.assign(b, l ? header(l) : {}, keep);
    const pend = pendingLines(po, F.id);
    if (pend.length === 1) F.items = [Object.assign(item(pend[0]), { arrQty: left(pend[0], F.id) })];
  }
  // photos are shrunk on the phone (long side 1280 px, JPEG) so saving stays fast on 4G
  function shrink(file, done) {
    const rd = new FileReader();
    rd.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, 1280 / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); done(c.toDataURL('image/jpeg', 0.72)); }; im.onerror = () => done(rd.result); im.src = rd.result; };
    rd.readAsDataURL(file);
  }
  // tick several items at once (same look as the picker)
  function openMulti(o) {
    const chosen = new Set(o.value);
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet picker-sheet" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
        <div class="sheet-grip"></div>
        <div class="sheet-top"><div class="sheet-h">${esc(o.title)}</div><button type="button" class="icon-btn" data-close aria-label="${esc(t('បិទ', 'Close'))}">✕</button></div>
        <label class="search"><span aria-hidden="true">🔍</span><input type="search" placeholder="${esc(t('ស្វែងរក', 'Search'))}" autocomplete="off" enterkeyhint="search"></label>
        <div class="pick-list"></div>
        <button type="button" class="btn ok big mt" data-done></button></div>`;
    const input = bg.querySelector('input'), list = bg.querySelector('.pick-list'), done = bg.querySelector('[data-done]');
    const close = () => { bg.classList.remove('open'); setTimeout(() => bg.remove(), 200); };
    const norm = v => String(v || '').toLowerCase().replace(/[\s\-.]/g, '');
    const draw = () => {
      const q = norm(input.value);
      const items = o.items.filter(it => !q || norm(it.label).includes(q) || norm(it.sub).includes(q));
      list.innerHTML = items.map(it => `<label class="pick-item mchk${chosen.has(it.value) ? ' on' : ''}"><span><b>${esc(it.label)}</b><small>${esc(it.sub)}</small></span><input type="checkbox" data-v="${esc(it.value)}"${chosen.has(it.value) ? ' checked' : ''}></label>`).join('') || `<div class="empty">${esc(t('រកមិនឃើញ', 'No match'))}</div>`;
      done.textContent = '✓ ' + t('រួចរាល់', 'Done') + ' (' + chosen.size + ')';
    };
    input.oninput = draw;
    list.onchange = e => { const c = e.target.closest('[data-v]'); if (!c) return; if (c.checked) chosen.add(c.dataset.v); else chosen.delete(c.dataset.v); draw(); };
    bg.onclick = e => {
      if (e.target === bg || e.target.closest('[data-close]')) close();
      else if (e.target.closest('[data-done]')) { close(); o.onDone(Array.from(chosen)); }
    };
    document.body.appendChild(bg);
    draw();
    requestAnimationFrame(() => bg.classList.add('open'));
  }
  function bindForm() {
    const re = () => { collect(); const y = window.scrollY, m = $('main'), my = m ? m.scrollTop : 0; renderForm(F.id); window.scrollTo(0, y); if (m) m.scrollTop = my; };
    const pk = (id, o) => { const b = $('#' + id); if (b && !b.classList.contains('off')) b.onclick = () => { collect(); openPicker(o()); }; };
    pk('po', () => ({ title: t('លេខ PO (មិនទាន់ទទួលគ្រប់)', 'PO Number (pending only)'), value: F.po,
      groups: [{ items: pendingPOs(F.id).map(x => { const l = PLAN.filter(y => y.po === x); const pl = pendingLines(x, F.id); return { value: x, sub: l[0].supplier + ' · ETA ' + showEta(l[0].eta) + ' · ' + pl.length + '/' + l.length + t(' មុខមិនទាន់ទទួល', ' lines pending') + ' · ' + fmt(pl.reduce((s, y) => s + left(y, F.id), 0)) + ' Kg' }; }) }],
      onPick: v => { pickPO(v); re(); } }));
    const it = $('#items');
    if (it) it.onclick = () => { collect(); openMulti({ title: t('ទំនិញលើឡាននេះ', 'Items on this truck'), value: F.items.map(i => i.material),
      items: pendingLines(F.po, F.id).map(x => ({ value: x.material, label: x.desc, sub: x.material + ' · ' + t('នៅសល់ ', 'left ') + fmt(left(x, F.id)) + ' / ' + fmt(x.kg) + ' Kg · ' + x.pcs + ' PCS' })),
      onDone: mats => { const had = {}; F.items.forEach(i => { had[i.material] = i; }); F.items = mats.map(mt => had[mt] || Object.assign(item(lineOf(F.po, mt)), { arrQty: left(lineOf(F.po, mt), F.id) })); re(); } }); };
    $$('[data-rm]').forEach(b => { b.onclick = () => { collect(); F.items.splice(+b.dataset.rm, 1); re(); }; });
    $$('[data-it]').forEach(el => { el.onchange = re; });
    F.items.forEach((i, n) => pk('dt' + n, () => ({ title: t('ប្រភេទខូចខាត', 'Damage type'), value: i.dmgType ? dmgName(i.dmgType) : '',
      groups: [{ items: DMG.map(d => ({ value: d[1] + ' ' + t(d[2], d[3]), key: d[0] })) }],
      onPick: v => { const d = DMG.find(x => x[1] + ' ' + t(x[2], x[3]) === v); i.dmgType = d ? d[0] : v; re(); } })));
    $$('[data-dph]').forEach(inp => { inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return; collect(); const i = F.items[+inp.dataset.dph]; shrink(f, url => { i.dmgPh = (i.dmgPh || []).concat(url).slice(0, MAX_DMG_PH); re(); }); }; });
    $$('[data-delph]').forEach(b => { b.onclick = e => { e.preventDefault(); collect(); const [n, j] = b.dataset.delph.split(':'); F.items[+n].dmgPh.splice(+j, 1); re(); }; });
    const plate = v => String(v || '').toUpperCase().replace(/\s+/g, '');
    pk('truck', () => { const used = Array.from(new Set(DATA.map(r => r.truck).concat(PLATES))); return { title: t('ផ្លាកលេខឡាន / រ៉ឺម៉ក', 'Truck number / trailer'), value: F.truck,
      groups: [{ items: used.map(x => ({ value: x })) }], addNew: { label: t('បន្ថែមឡានថ្មី', 'Add new truck'), clean: plate },
      onPick: (v, isNew) => { F.truck = v; F.newTruck = !!isNew; re(); } }; });
    pk('carrier', () => ({ title: t('ក្រុមហ៊ុន 3PL', '3PL company'), value: F.carrier,
      groups: [{ items: CARRIERS.map(x => ({ value: x })) }], addNew: { label: t('បន្ថែមក្រុមហ៊ុនថ្មី', 'Add new company'), clean: v => String(v || '').trim() },
      onPick: (v, isNew) => { F.carrier = v; F.newCarrier = !!isNew; if (isNew && CARRIERS.indexOf(v) < 0) CARRIERS.push(v); re(); } }));
    $$('[data-own]').forEach(b => { b.onclick = () => { F.owner = b.dataset.own; if (F.owner === 'ISI') F.carrier = ''; re(); }; });
    const mm = $('#mpm'); if (mm) mm.onclick = () => { F.manpower = Math.max(1, (+F.manpower || 1) - 1); $('#mp').textContent = F.manpower; };
    const mp = $('#mpp'); if (mp) mp.onclick = () => { F.manpower = (+F.manpower || 0) + 1; $('#mp').textContent = F.manpower; };
    ['start', 'end'].forEach(k => { const el = $('#' + k); if (el) el.onchange = re; });
    $$('[data-ph]').forEach(inp => { inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return; collect(); shrink(f, url => { F.ph = Object.assign({}, F.ph, { [inp.dataset.ph]: url }); re(); }); }; });
    const need = () => {
      const miss = [];
      if (!F.po) miss.push(t('លេខ PO', 'PO number'));
      if (!F.items.length) miss.push(t('ទំនិញ', 'Items'));
      else if (F.items.some(i => !(+i.arrQty > 0))) miss.push(t('បរិមាណមកដល់', 'Arrival Qty'));
      if (!F.truck) miss.push(t('ផ្លាកលេខ', 'Truck number')); if (!F.dn3pl) miss.push(t('លេខ DN 3PL', '3PL DN Number'));
      PHOTOS.forEach(x => { if (!F.ph || !F.ph[x[0]]) miss.push(x[1]); });
      return miss;
    };
    const needFin = () => {
      const miss = need();
      if (F.items.some(i => i.grQty === '' || i.grQty == null)) miss.push(t('ទទួលជាក់ស្តែង', 'Actual GR Qty'));
      F.items.forEach(i => { if (i.dmgQty === '' || i.dmgQty == null) i.dmgQty = 0; });
      const dm = F.items.filter(i => +i.dmgQty > 0);
      if (dm.some(i => !i.dmgType)) miss.push(t('ប្រភេទខូចខាត', 'Damage type'));
      if (dm.some(i => !(i.dmgPh || []).length)) miss.push(t('រូបថតខូចខាត', 'Damage photo'));
      if (!F.owner) miss.push(t('ម្ចាស់ឡាន', 'Truck owner'));
      return miss;
    };
    const st = $('#startBtn');
    if (st) st.onclick = () => {
      collect(); const miss = need(); if (miss.length) return toast('⚠️ ' + miss.join(', '));
      F.date = today(); F.start = nowHM(); F.id = 'IB' + F.date.slice(2).replace(/-/g, '') + '-' + pad(DATA.length + 1); F.by = t('អ្នក (សាកល្បង)', 'You (demo)');
      DATA.push(JSON.parse(JSON.stringify(F))); save(); F = null; toast('▶ ' + t('បានចាប់ផ្តើម ', 'Started ') + nowHM()); location.hash = '#/';
    };
    const en = $('#endBtn');
    if (en) en.onclick = () => {
      collect(); const miss = needFin(); if (miss.length) return toast('⚠️ ' + miss.join(', '));
      F.end = nowHM(); store(); toast('✅ ' + t('បានរក្សាទុក ', 'Saved ') + showSpent(spentMin(F))); const id = F.id; F = null; location.hash = '#/r/' + id;
    };
    const sv = $('#saveBtn');
    if (sv) sv.onclick = () => { collect(); const miss = F.end ? needFin() : need(); if (miss.length) return toast('⚠️ ' + miss.join(', ')); store(); toast('💾 ' + t('បានរក្សាទុក', 'Saved')); const id = F.id; F = null; location.hash = '#/r/' + id; };
  }
  // Searchable picker with "add new", same as the Fuel app.
  function openPicker(o) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet picker-sheet" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
        <div class="sheet-grip"></div>
        <div class="sheet-top"><div class="sheet-h">${esc(o.title)}</div><button type="button" class="icon-btn" data-close aria-label="${esc(t('បិទ', 'Close'))}">✕</button></div>
        <label class="search"><span aria-hidden="true">🔍</span><input type="search" placeholder="${esc(t('ស្វែងរក ឬវាយឈ្មោះថ្មី', 'Search or type a new one'))}" autocomplete="off" enterkeyhint="search"></label>
        <div class="pick-list"></div></div>`;
    const input = bg.querySelector('input'), list = bg.querySelector('.pick-list');
    const onKey = e => { if (e.key === 'Escape') close(); };
    const close = () => { document.removeEventListener('keydown', onKey); bg.classList.remove('open'); setTimeout(() => bg.remove(), 200); };
    const norm = v => String(v || '').toLowerCase().replace(/[\s\-.]/g, '');
    const draw = () => {
      const q = norm(input.value);
      const html = o.groups.map(g => {
        const items = g.items.filter(it => !q || norm(it.value).includes(q) || norm(it.sub).includes(q));
        if (!items.length) return '';
        return (g.label ? `<div class="pick-group">${esc(g.label)}</div>` : '') + items.map(it => `<button type="button" class="pick-item ${it.value === o.value ? 'on' : ''}" data-v="${esc(it.value)}"><span><b>${esc(it.value)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.value === o.value ? '<span class="tick">✓</span>' : ''}</button>`).join('');
      }).join('');
      const add = o.addNew && o.addNew.clean(input.value);
      const exists = add && o.groups.some(g => g.items.some(it => norm(it.value) === norm(add)));
      const addRow = add && !exists ? `<button type="button" class="pick-item pick-add" data-add="${esc(add)}"><span><b>➕ ${esc(o.addNew.label)}: ${esc(add)}</b></span></button>` : '';
      list.innerHTML = html + addRow || `<div class="empty">${esc(t('រកមិនឃើញ', 'No match'))}${o.addNew ? `<br><small>${esc(t('វាយឈ្មោះ ដើម្បីបន្ថែមថ្មី', 'Type a name to add a new one'))}</small>` : ''}</div>`;
    };
    input.oninput = draw;
    bg.onclick = e => {
      if (e.target === bg || e.target.closest('[data-close]')) { close(); return; }
      const a = e.target.closest('[data-add]'), b = e.target.closest('[data-v]');
      if (a) { close(); o.onPick(a.dataset.add, true); } else if (b) { close(); o.onPick(b.dataset.v, false); }
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    draw();
    requestAnimationFrame(() => bg.classList.add('open'));
    const on = list.querySelector('.pick-item.on');
    if (on) on.scrollIntoView({ block: 'center' });
  }

  function store() { const i = DATA.findIndex(x => x.id === F.id); const c = JSON.parse(JSON.stringify(F)); if (i >= 0) DATA[i] = c; else DATA.push(c); save(); }


  // ------------------------------------------------------------------ one receipt
  function renderOne(id) {
    paintTabs('');
    const r = byId(id); if (!r) { location.hash = '#/'; return; }
    const m = spentMin(r), p = prod(r);
    const kv = (lbl, v, full) => `<div${full ? ' class="full"' : ''}><small>${lbl}</small><b>${v}</b></div>`;
    const ph = r.ph || {};
    view(`
      <div class="head2"><h2>🚛 ${esc(r.truck)}</h2><a class="link" href="#/">✕</a></div>
      <div style="margin:-4px 2px 12px">${badges(r)}</div>
      <section class="card"><div class="kvs">
        ${kv(t('លេខ PO', 'PO Number'), esc(r.po))}${kv(t('លេខ Inbound', 'Inbound Number'), esc(r.inbound))}
        ${kv('Ref. No.', esc(r.ref || '–'))}${kv(t('អ្នកផ្គត់ផ្គង់', 'Supplier'), esc(r.supplier || '–'))}
        ${kv('ETA', showEta(r.eta) || '–')}${kv(t('លេខ DN របស់ 3PL', '3PL DN Number'), esc(r.dn3pl || '–'))}
        ${kv(t('ផ្លាកលេខឡាន / រ៉ឺម៉ក', 'Truck / trailer'), esc(r.truck))}${kv(t('ម្ចាស់ឡាន', 'Truck owner'), r.owner ? esc(ownerTxt(r)) : '–')}
      </div></section>
      <section class="card"><h2>📦 ${t('ទំនិញ', 'Items')}</h2>${itemsTable(r, 'view')}</section>
      <section class="card"><div class="kvs">
        ${kv(t('ថ្ងៃទទួល', 'Receipt date'), showDate(r.date))}${kv(t('ចំនួនកម្មករ', 'Manpower'), '👷 ' + esc(r.manpower))}
        ${kv(t('ម៉ោងចាប់ផ្តើម', 'Start time'), esc(r.start))}${kv(t('ម៉ោងបញ្ចប់', 'End time'), esc(r.end || '–'))}
        ${kv(t('រយៈពេល', 'Time spent'), (isLive(r) ? '⏱ ' : '') + showSpent(m))}${kv(t('ផលិតភាព', 'Productivity'), p == null ? '–' : fmt(p, 1) + ' <small>' + esc(prodUnit()) + '</small>')}
        ${kv(t('សំគាល់', 'Remark'), esc(r.remark || '–'), 1)}
        ${kv(t('កត់ត្រាដោយ', 'Recorded by'), esc(r.by || '–'), 1)}
      </div>
      <div class="shots mt">${PHOTOS.map(x => `<div class="shot has"><div class="ph">${phImg(ph[x[0]], x[1])}</div><small>${x[1]} ${t(x[2], x[3])}</small></div>`).join('')}</div>
      </section>
      ${isLive(r) ? `<button class="btn big bigstart endbtn" id="fin">⏹ ${t('បញ្ចប់ការទម្លាក់', 'Finish unloading')}</button>` : `<button class="btn" id="edit">✏️ ${t('កែប្រែ', 'Edit')}</button>`}`);
    const b = $('#fin') || $('#edit'); b.onclick = () => { F = null; location.hash = '#/edit/' + id; };
  }

  // ------------------------------------------------------------------ Summary
  let SP = '7';
  function renderSum() {
    paintTabs('sum');
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (SP === '1' ? 0 : SP === '7' ? 6 : from.getDate() - 1));
    const rows = DATA.filter(r => r.end && r.date >= ymd(from));
    const tn = rows.reduce((s, r) => s + (tons(r) || 0), 0);
    const avgM = rows.length ? rows.reduce((s, r) => s + spentMin(r), 0) / rows.length : null;
    const tr = rows.filter(r => prod(r) != null);
    const manH = tr.reduce((s, r) => s + spentMin(r) / 60 * r.manpower, 0);
    const avgP = manH ? tr.reduce((s, r) => s + tons(r), 0) / manH : null;
    const dmg = rows.filter(isDamaged).length, diff = rows.filter(isLess).length;
    // tonnes by day
    const days = {}; rows.forEach(r => { days[r.date] = (days[r.date] || 0) + (tons(r) || 0); });
    const dk = Object.keys(days).sort(); const mx = Math.max(1, ...dk.map(k => days[k]));
    // owners
    const isi = rows.filter(r => r.owner === 'ISI').length, pl = rows.length - isi;
    const by = {}; rows.forEach(r => { const k = r.owner === 'ISI' ? 'ISI' : (r.carrier || '3PL'); const o = by[k] || (by[k] = { n: 0, t: 0, m: 0 }); o.n++; o.t += tons(r) || 0; o.m += spentMin(r); });
    const chip = (k, km, en) => `<button class="chip${SP === k ? ' on' : ''}" data-p="${k}">${t(km, en)}</button>`;
    view(`
      <div class="filters">${chip('1', 'ថ្ងៃនេះ', 'Today')}${chip('7', '៧ ថ្ងៃ', '7 days')}${chip('m', 'ខែនេះ', 'This month')}</div>
      <div class="stats">
        <div class="stat"><small>${t('ឡានទទួលរួច', 'Trucks received')}</small><b>${rows.length}</b></div>
        <div class="stat"><small>${t('បរិមាណទទួល', 'Received')}</small><b>${fmt(tn, 1)}<em>t</em></b></div>
        <div class="stat"><small>${t('រយៈពេលមធ្យម/ឡាន', 'Avg time / truck')}</small><b>${avgM == null ? '–' : fmt(avgM)}<em>${t('នាទី', 'min')}</em></b></div>
        <div class="stat"><small>${t('ផលិតភាពមធ្យម', 'Avg productivity')}</small><b>${avgP == null ? '–' : fmt(avgP, 1)}<em>${t('ត/នាក់/ម៉', 't/person/h')}</em></b></div>
        <div class="stat"><small>${t('ខូចខាត', 'Damaged')}</small><b style="color:var(--bad)">${dmg}</b></div>
        <div class="stat"><small>⬇ ${t('ទទួលខ្វះ', 'Received less')}</small><b style="color:var(--warn)">${diff}</b></div>
      </div>
      <section class="card"><h2>📦 ${t('តោនទទួលតាមថ្ងៃ', 'Tonnes received by day')}</h2>
        <div class="bars">${dk.map(k => `<div class="barrow"><span>${showDate(k).slice(0, 5)}</span><div class="tr"><i style="width:${days[k] / mx * 100}%"></i></div><span>${fmt(days[k], 1)} t</span></div>`).join('') || `<div class="empty">–</div>`}</div>
      </section>
      <section class="card"><h2>🚚 ${t('ឡាន ISI ធៀប 3PL', 'ISI vs 3PL trucks')}</h2>
        <div class="split"><i style="width:${rows.length ? isi / rows.length * 100 : 0}%;background:var(--accent)"></i><i style="flex:1;background:#61cbf4"></i></div>
        <div class="legend"><span><i style="background:var(--accent)"></i>ISI ${isi}</span><span><i style="background:#61cbf4"></i>3PL ${pl}</span></div>
        <table class="tb mt"><tr><th>${t('ម្ចាស់ឡាន', 'Owner')}</th><th class="n">${t('ឡាន', 'Trucks')}</th><th class="n">${t('តោន', 'Tonnes')}</th><th class="n">${t('នាទី/ឡាន', 'Min/truck')}</th></tr>
          ${Object.keys(by).sort((a, b) => by[b].n - by[a].n).map(k => `<tr><td>${esc(k)}</td><td class="n">${by[k].n}</td><td class="n">${fmt(by[k].t, 1)}</td><td class="n">${fmt(by[k].m / by[k].n)}</td></tr>`).join('')}
        </table>
      </section>
      <p class="hint center">${t('ផលិតភាព = បរិមាណទទួល ÷ ម៉ោង ÷ ចំនួនកម្មករ', 'Productivity = qty received ÷ hours ÷ manpower')}</p>`);
    $$('[data-p]').forEach(b => { b.onclick = () => { SP = b.dataset.p; renderSum(); }; });
  }

  // ------------------------------------------------------------------ router
  function screen() {
    const h = location.hash.replace(/^#\/?/, '');
    if (h === 'new') return renderForm('');
    if (h.indexOf('edit/') === 0) return renderForm(h.slice(5));
    if (h.indexOf('r/') === 0) return renderOne(h.slice(2));
    if (h === 'log') return renderLog();
    if (h === 'sum') return renderSum();
    return renderHome();
  }
  // live timers tick every 20 s without redrawing the screen
  setInterval(() => { $$('[data-timer]').forEach(el => { const r = byId(el.dataset.timer); if (r) { const m = spentMin(r); el.textContent = clock(m); el.classList.toggle('slow', m > 60); } }); }, 20000);

  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const paintTheme = () => { const th = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); $('#themeBtn').textContent = th === 'dark' ? '☀️' : '🌙'; };
  $('#themeBtn').onclick = () => { const now = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); const next = now === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); set('fr_theme', next); paintTheme(); };
  paintTheme();
  if (window.LANG) { LANG.button($('#langBtn')); LANG.onChange(() => { paintStatic(); paintDemo(); screen(); }); }
  function paintDemo() { if (DEMO) { const d = $('#demo'); d.hidden = false; d.textContent = t('🧪 សាកល្បង — ទិន្នន័យគំរូ មិនរក្សាទុកក្នុង Sheet', '🧪 Demo — sample data, not saved to the Sheet'); } }
  paintDemo();
  window.ISTEEL_REFRESH = screen;
  load(); paintStatic(); window.addEventListener('hashchange', screen); screen();
})();
