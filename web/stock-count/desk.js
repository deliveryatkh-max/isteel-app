// Stock Count menu screens. Live app: dashboard, stock list, movements (Stock Ledger) and SAP check, on the real stock.
// Demo mode (no API_URL, sample data only) adds count review, roles and the role switcher, which have no backend yet.
// SAP figures are only compared with the digital balance. They never overwrite it.
(function () {
  'use strict';
  const SC = window.SC;
  if (!SC) return;
  const DEMO = SC.DEMO;
  const { S, T, esc, $, view, route, toast, fmtQty, typeLabel, round3, sameLine, openBin, dAgo } = SC;
  // Live data: stock and bins come with the app start; the ledger is read when a screen needs it.
  const D = DEMO ? SC.demo : { get stock() { return S.stock || []; }, get bins() { return S.bins || []; }, ledger: [], counts: [], at: 0, old: false, busy: false };
  function loadLedger(again) {
    if (DEMO || D.busy || Date.now() - D.at < 30000) return;
    D.busy = true;
    SC.api('ledger', {}).then(r => { D.ledger = r.rows || []; D.old = false; }, e => {
      // Old Code.gs (not re-pasted yet): show the last movements that came with the app start.
      D.old = true; D.ledger = ((S.dash && S.dash.recent) || []).slice().reverse();
    }).then(() => { D.busy = false; D.at = Date.now(); if (S.view === again) route(); });
  }
  const oldNote = () => (!DEMO && D.old ? `<p class="muted">⚠️ ${T('បង្ហាញតែចលនា ១០ ចុងក្រោយ។ សូម paste Code.gs ថ្មី ដើម្បីមើលទាំងអស់។', 'Showing the last 10 movements only. Re-paste Code.gs to see them all.')}</p>` : '');
  const $$ = s => Array.from(document.querySelectorAll(s));
  const SNAP = !DEMO ? [] : D.stock.map(l => Object.assign({}, l));   // stock at page load = base of the SAP sample files

  // ------------------------------------------------------------------ roles
  const PAGES = [
    ['home', '📷', 'ស្កេន', 'Scan'], ['dash', '📊', 'ផ្ទាំងគ្រប់គ្រង', 'Dashboard'], ['stock', '📦', 'បញ្ជីស្តុក', 'Stock list'],
    ['moves', '🔁', 'ចលនាស្តុក', 'Movements'], ['binsum', '🗂️', 'សង្ខេបទីតាំង', 'Bin summary'], ['review', '✅', 'ពិនិត្យការរាប់', 'Count review'], ['sap', '🧮', 'ផ្ទៀងផ្ទាត់ SAP', 'SAP check'], ['varhist', '📉', 'ប្រវត្តិខុសគ្នា', 'Variance history'], ['roles', '👥', 'តួនាទី', 'Roles'],
  ];
  const ROLES = [
    { id: 'operator', km: 'បុគ្គលិកឃ្លាំង', en: 'Warehouse Operator', pages: ['home', 'stock'], can: [] },
    { id: 'supervisor', km: 'ប្រធានក្រុមឃ្លាំង', en: 'Warehouse Supervisor', pages: ['home', 'dash', 'stock', 'moves', 'binsum', 'review'], can: ['approve', 'export'] },
    { id: 'controller', km: 'អ្នកត្រួតពិនិត្យស្តុក', en: 'Inventory Controller', pages: ['home', 'dash', 'stock', 'moves', 'binsum', 'review', 'sap', 'varhist'], can: ['approve', 'export', 'adjust', 'sap'] },
    { id: 'admin', km: 'អ្នកគ្រប់គ្រងប្រព័ន្ធ', en: 'Administrator', pages: ['home', 'dash', 'stock', 'moves', 'binsum', 'review', 'sap', 'varhist', 'roles'], can: ['approve', 'export', 'adjust', 'sap', 'users'] },
  ];
  const RIGHTS = [
    ['scan', 'ស្កេន៖ ចូល / ចេញ / ផ្ទេរ / រាប់', 'Scan: IN / OUT / Transfer / Count'], ['stockv', 'មើលបញ្ជីស្តុក', 'See the stock list'],
    ['dashv', 'មើលផ្ទាំងគ្រប់គ្រង និងចលនាស្តុក', 'See dashboard and movements'], ['approve', 'អនុម័ត ឬបដិសេធការរាប់', 'Approve or reject counts'],
    ['export', 'ទាញយក CSV', 'Export CSV'], ['adjust', 'កែតម្រូវស្តុកតាមការរាប់', 'Post count adjustments'],
    ['sap', 'នាំចូល SAP និងផ្ទៀងផ្ទាត់', 'SAP import and reconciliation'], ['users', 'កំណត់តួនាទីអ្នកប្រើ', 'Set user roles'],
  ];
  let roleId = 'admin';
  try { roleId = localStorage.getItem('sc_demo_role') || 'admin'; } catch (e) { /* private mode */ }
  const LIVE_ROLE = { id: 'live', pages: ['home', 'dash', 'stock', 'moves', 'binsum', 'sap', 'varhist'], can: ['export', 'sap'] };
  const role = () => (!DEMO ? LIVE_ROLE : ROLES.find(r => r.id === roleId) || ROLES[3]);
  const can = what => role().can.indexOf(what) >= 0;
  const has = (r, right) => (right === 'scan' || right === 'stockv' ? true : right === 'dashv' ? r.pages.indexOf('dash') >= 0 : r.can.indexOf(right) >= 0);

  window.SC_NAV = function () {
    const r = role(), nav = $('#scTabs');
    if (!nav) return;
    const isPage = PAGES.some(p => p[0] === S.view && p[0] !== 'home');
    if (isPage && r.pages.indexOf(S.view) < 0) S.view = 'home';
    const on = isPage && r.pages.indexOf(S.view) >= 0 ? S.view : 'home';
    nav.hidden = false;
    nav.innerHTML = `<a href="../" class="tab home-tab"><span>🏠</span><b>${T('ទំព័រដើម', 'Home')}</b></a>` + PAGES.filter(p => r.pages.indexOf(p[0]) >= 0).map(p => `<button type="button" class="tab${p[0] === on ? ' on' : ''}" data-tab="${p[0]}"><span>${p[1]}</span><b>${T(p[2], p[3])}</b>${
      p[0] === 'review' && pending() ? `<i class="count">${pending()}</i>` : ''}</button>`).join('');
    nav.querySelectorAll('.tab[data-tab]').forEach(b => { b.onclick = () => { S.view = b.dataset.tab; route(); window.scrollTo(0, 0); }; });
    if (!DEMO) return;
    const d = $('#demo');
    d.innerHTML = `${T('សាកល្បង៖ ទិន្នន័យគំរូ មិនមែនស្តុកពិត', 'Demo: sample data, not real stock')} · <label class="role-pick">${T('តួនាទី', 'Role')}
      <select id="rolePick">${ROLES.map(x => `<option value="${x.id}"${x.id === r.id ? ' selected' : ''}>${T(x.km, x.en)}</option>`).join('')}</select></label>`;
    $('#rolePick').onchange = e => { roleId = e.target.value; try { localStorage.setItem('sc_demo_role', roleId); } catch (err) { /* private mode */ } route(); };
  };

  // ------------------------------------------------------------------ helpers
  const newest = () => D.ledger.map((r, i) => [r, i]).sort((a, b) => (b[0].date + b[0].time).localeCompare(a[0].date + a[0].time) || b[1] - a[1]).map(x => x[0]);
  const pending = () => D.counts.filter(c => c.status === 'Submitted').length;
  const whOf = bin => { const b = D.bins.find(x => x.bin === bin); return b ? b.warehouse : ''; };
  const isIn = t => t === 'IN' || t === 'TRANSFER IN';
  const tLabel = t => (t === 'ADJUST' ? T('កែតម្រូវ', 'Adjustment') : typeLabel(t));
  const qtyCell = r => `<td class="num ${r.qtyIn ? 'in' : 'out'}">${r.qtyIn ? '+' + fmtQty(r.qtyIn) : '-' + fmtQty(r.qtyOut)}</td>`;
  const wide = () => document.body.classList.add('wide');
  const now = () => { const d = new Date(); return dAgo(0) + ' ' + d.toTimeString().slice(0, 5); };
  function download(name, rows) {
    const csv = rows.map(r => r.map(v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
    const plain = () => { const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); toast(T('បានទាញយក ', 'Downloaded ') + name); };
    // Inside a Claude preview page a file can only be saved through its own save box.
    if (window.claude && window.claude.use) window.claude.use('downloads').then(d => (d ? d.save({ filename: name, data: '\ufeff' + csv }).then(() => toast(T('បានទាញយក ', 'Downloaded ') + name), () => {}) : plain()), plain);
    else plain();
  }
  const stBadge = s => `<span class="st st-${s.replace(/\s+/g, '').toLowerCase()}">${esc({ Submitted: T('រង់ចាំអនុម័ត', 'Submitted'), Approved: T('បានអនុម័ត', 'Approved'), Rejected: T('បដិសេធ', 'Rejected'),
    'Adjustment Posted': T('បានកែតម្រូវ', 'Adjustment posted') }[s] || s)}</span>`;

  // ------------------------------------------------------------------ dashboard
  let lastSap = null;
  function dash() {
    wide(); loadLedger('dash');
    const today = dAgo(0), led = D.ledger, td = led.filter(r => r.date === today);
    const kg = D.stock.filter(l => SC.isKg(l.uom)).reduce((a, l) => a + l.book, 0), pc = D.stock.filter(l => !SC.isKg(l.uom)).reduce((a, l) => a + l.book, 0);
    const done = D.counts.filter(c => c.status !== 'Submitted'), okCount = D.counts.filter(c => c.variance === 0).length;
    const acc = D.counts.length ? Math.round(okCount / D.counts.length * 100) : null;
    const stat = (v, label, cls, go) => `<div class="stat ${cls || ''}"${go ? ` data-go="${go}"` : ''}><b>${v}</b><span>${label}</span></div>`;
    const days = [6, 5, 4, 3, 2, 1, 0].map(n => { const d = dAgo(n), rows = led.filter(r => r.date === d); return { d: d.slice(5), i: rows.filter(r => isIn(r.type)).length, o: rows.filter(r => r.type === 'OUT' || r.type === 'TRANSFER OUT').length }; });
    const max = Math.max(1, ...days.map(x => Math.max(x.i, x.o)));
    const whs = Array.from(new Set(D.bins.map(b => b.warehouse))).map(w => { const ls = D.stock.filter(l => whOf(l.bin) === w); return { w: w, bins: D.bins.filter(b => b.warehouse === w).length, lines: ls.length,
      kg: ls.filter(l => SC.isKg(l.uom)).reduce((a, l) => a + l.book, 0), pc: ls.filter(l => !SC.isKg(l.uom)).reduce((a, l) => a + l.book, 0) }; });
    view(`
      <h2 class="ptitle">${T('ផ្ទាំងគ្រប់គ្រងស្តុក', 'Stock dashboard')} <small class="muted">${now()}</small></h2>
      <div class="dash-kpis">
        ${stat(new Set(D.stock.map(l => l.material)).size, T('សម្ភារៈ (SKU)', 'Active SKUs'), '', 'stock')}
        ${stat(new Set(D.stock.map(l => l.bin)).size + ' / ' + D.bins.length, T('ទីតាំងមានស្តុក', 'Bins in use'), '', 'stock')}
        ${stat(fmtQty(kg), T('ស្តុកសរុប Kg', 'Total Kg'))}
        ${stat(fmtQty(pc), T('ស្តុកសរុប Pcs', 'Total Pcs'))}
        ${stat(td.filter(r => r.type === 'IN').length, T('ចូលថ្ងៃនេះ', 'IN today'), 'in', 'moves')}
        ${stat(td.filter(r => r.type === 'OUT').length, T('ចេញថ្ងៃនេះ', 'OUT today'), 'out', 'moves')}
        ${DEMO ? stat(pending(), T('ការរាប់រង់ចាំអនុម័ត', 'Counts to review'), pending() ? 'warn' : '', 'review') : ''}
        ${DEMO ? stat(acc == null ? '—' : acc + '%', T('ភាពត្រឹមត្រូវនៃការរាប់', 'Count accuracy')) : ''}
        ${stat(lastSap ? lastSap.variances : '—', lastSap ? T('ខុសគ្នាជាមួយ SAP', 'SAP variances') + ' · ' + lastSap.at.slice(5) : T('មិនទាន់នាំចូល SAP', 'No SAP import yet'), lastSap && lastSap.variances ? 'warn' : '', role().pages.indexOf('sap') >= 0 ? 'sap' : '')}
      </div>
      <div class="dgrid">
        <section class="card"><h3>${T('ចលនាស្តុក ៧ ថ្ងៃ (ចំនួនប្រតិបត្តិការ)', 'Movements, last 7 days (transactions)')}</h3>
          <div class="chart">${days.map(x => `<div class="cday"><div class="cbars"><i class="bi" style="height:${x.i / max * 100}%" title="IN ${x.i}">${x.i ? `<em>${x.i}</em>` : ''}</i><i class="bo" style="height:${x.o / max * 100}%" title="OUT ${x.o}">${x.o ? `<em>${x.o}</em>` : ''}</i></div><span>${x.d}</span></div>`).join('')}</div>
          <p class="legend"><i class="bi"></i> ${T('ចូល', 'IN')} <i class="bo"></i> ${T('ចេញ', 'OUT')}</p></section>
        <section class="card scroll"><h3>${T('ស្តុកតាមឃ្លាំង', 'Stock by warehouse')}</h3>
          <table class="lines hist"><tr><th>${T('ឃ្លាំង', 'Warehouse')}</th><th>${T('ទីតាំង', 'Bins')}</th><th>${T('ប្រភេទស្តុក', 'Lines')}</th><th>Kg</th><th>Pcs</th></tr>
          ${whs.map(w => `<tr><td><b>${esc(w.w)}</b></td><td class="num">${w.bins}</td><td class="num">${w.lines}</td><td class="num">${fmtQty(w.kg)}</td><td class="num">${fmtQty(w.pc)}</td></tr>`).join('')}</table></section>
        ${DEMO ? `<section class="card scroll"><h3>${T('ការរាប់ចុងក្រោយ', 'Latest counts')}</h3>
          <table class="lines hist"><tr><th>${T('ថ្ងៃ', 'Date')}</th><th>${T('ទីតាំង', 'Bin')}</th><th>${T('សម្ភារៈ', 'Material')}</th><th>${T('ខុសគ្នា', 'Variance')}</th><th>${T('ស្ថានភាព', 'Status')}</th></tr>
          ${D.counts.slice(0, 6).map(c => `<tr><td>${esc(c.date.slice(5))}</td><td>${esc(c.bin)}</td><td>${esc(c.material)}</td><td class="num ${c.variance < 0 ? 'out' : c.variance > 0 ? 'in' : ''}">${c.variance > 0 ? '+' : ''}${fmtQty(c.variance)}</td><td>${stBadge(c.status)}</td></tr>`).join('')}</table></section>` : ''}
        <section class="card scroll"><h3>${T('ប្រតិបត្តិការថ្មីៗ', 'Recent transactions')}</h3>
          <table class="lines hist"><tr><th>${T('ថ្ងៃ', 'Date')}</th><th>${T('ប្រភេទ', 'Type')}</th><th>${T('ទីតាំង', 'Bin')}</th><th>${T('សម្ភារៈ', 'Material')}</th><th>${T('ចំនួន', 'Qty')}</th><th>${T('អ្នកប្រើ', 'User')}</th></tr>
          ${newest().slice(0, 10).map(r => `<tr><td>${esc(r.date.slice(5))} <small class="muted">${esc(r.time)}</small></td><td>${esc(tLabel(r.type))}</td><td>${esc(r.bin)}</td><td>${esc(r.material)}</td>${qtyCell(r)}<td>${esc(String(r.user || '').split('@')[0])}</td></tr>`).join('')}</table></section>
      </div>`);
    $$('[data-go]').forEach(el => { el.onclick = () => { S.view = el.dataset.go; route(); }; });
  }

  // ------------------------------------------------------------------ stock list
  const F = { q: '', wh: '', mq: '', mt: '', mfrom: dAgo(0).slice(0, 8) + '01', mto: dAgo(0), mwh: '', mzone: '', mgrp: '', msloc: '', mdir: '', onlyVar: true, zone: '', grp: '', sloc: '', uom: '', qty: '', sd: '', cd: '' };
  const hit = (q, vals) => !q || vals.join(' ').toLowerCase().indexOf(q.toLowerCase()) >= 0;
  // Stock list filters (Kim picked list mockup 1, 20 Nov): Warehouse, Bin Zone, Material Group, SLoc, UoM, Stock,
  // Stock Date (last IN of the line, from the ledger) and Count Date (last count, Stock On Hand). Chips show what is on.
  const zoneOf = bin => String(bin || '').split('-')[1] || '';
  const groupOf = l => {
    if (l.group) return l.group;
    const p = (S.products || []).find(x => String(x.material).toUpperCase() === String(l.material).toUpperCase());
    if (p && p.group) return p.group;
    const d = String(l.desc || '').toUpperCase();   // demo, or no group in the Product Master yet
    return /DEBAR|DEFORMED/.test(d) ? 'Deformed Bar' : /PIPE/.test(d) ? 'Pipe' : /PURLIN/.test(d) ? 'Purlin' : /COIL/.test(d) ? 'Coil' : /ROOF/.test(d) ? 'Roofing' : '';
  };
  const lineKey = l => [l.bin, l.material, l.batch, l.sloc].join('|').toUpperCase();
  function lineDates() {
    const sd = {}, cd = {};
    D.ledger.forEach(r => { if (r.type === 'IN' || r.type === 'TRANSFER IN') { const k = lineKey(r), v = ((r.date || '') + ' ' + (r.time || '')).trim(); if (!sd[k] || v > sd[k]) sd[k] = v; } });
    const cr = {};
    (D.counts || []).forEach(c => { const k = lineKey(c), v = ((c.date || '') + ' ' + (c.time || '')).trim(); if (!cd[k] || v > cd[k]) { cd[k] = v; cr[k] = c; } });
    return { sd: sd, cd: cd, cr: cr };
  }
  const daysAgo = v => (v ? Math.floor((Date.now() - new Date(String(v).slice(0, 10) + 'T00:00:00').getTime()) / 86400000) : null);
  const SD_OPT = [['', T('ទាំងអស់', 'All')], ['0', T('ថ្ងៃនេះ', 'Today')], ['7', T('៧ ថ្ងៃចុងក្រោយ', 'Last 7 days')], ['30', T('៣០ ថ្ងៃចុងក្រោយ', 'Last 30 days')], ['old', T('ចាស់ជាង ៣០ ថ្ងៃ', 'Older than 30 days')]];
  const CD_OPT = [['', T('ទាំងអស់', 'All')], ['7', T('រាប់ ៧ ថ្ងៃចុងក្រោយ', 'Counted last 7 days')], ['30', T('រាប់ ៣០ ថ្ងៃចុងក្រោយ', 'Counted last 30 days')], ['old', T('មិនបានរាប់ ៣០ ថ្ងៃ+', 'Not counted 30 days+')], ['never', T('មិនទាន់រាប់', 'Never counted')]];
  const QTY_OPT = [['', T('ទាំងអស់', 'All')], ['pos', T('មានស្តុក', 'Has stock')], ['zero', T('ទទេ (0)', 'Empty (0)')]];
  const dateOk = (v, f, isCount) => {
    if (!f) return true;
    const d = daysAgo(v);
    if (f === 'never') return d == null;
    if (f === 'old') return d == null ? isCount : d > 30;
    return d != null && d <= Number(f);
  };
  function stock() {
    wide(); loadLedger('stock');
    const dt = lineDates();
    const all = D.stock.map(l => Object.assign({}, l, { wh: whOf(l.bin), zone: zoneOf(l.bin), grp: groupOf(l), sd: dt.sd[lineKey(l)] || '', cd: l.countDate || dt.cd[lineKey(l)] || '',
      counted: l.counted != null && l.counted !== '' ? l.counted : (dt.cr[lineKey(l)] || {}).counted, diff: l.diff != null && l.diff !== '' ? l.diff : (dt.cr[lineKey(l)] || {}).variance,
      by: l.countedBy || String((dt.cr[lineKey(l)] || {}).by || '').split('@')[0] }));
    if (pvMode('stock')) {
      const data = all.map(l => ({ bin: l.bin, wh: l.wh, zone: l.zone, grp: l.grp, material: l.material, desc: l.desc, batch: l.batch, sloc: l.sloc, uom: l.uom,
        sd: String(l.sd).slice(0, 10), cd: String(l.cd).slice(0, 10), book: Number(l.book) || 0, by: l.by || '',
        counted: l.counted == null || l.counted === '' ? '' : Number(l.counted), diff: l.diff == null || l.diff === '' ? '' : Number(l.diff),
        kg: SC.isKg(l.uom) ? Number(l.book) || 0 : SC.round3((Number(l.book) || 0) * (Number(l.kgPerPc) || 0)) }));
      return pivotScreen('stock', '📦 ' + T('បញ្ជីស្តុក', 'Stock list'), data, [
        ['wh', 'ឃ្លាំង', 'Warehouse'], ['zone', 'តំបន់', 'Bin Zone'], ['bin', 'ទីតាំង', 'Bin'], ['grp', 'ក្រុមសម្ភារៈ', 'Material Group'], ['material', 'សម្ភារៈ', 'Material'],
        ['desc', 'បរិយាយ', 'Description'], ['batch', 'Batch', 'Batch'], ['sloc', 'SLoc', 'SLoc'], ['uom', 'UoM', 'UoM'], ['sd', 'ថ្ងៃចូលស្តុក', 'Stock Date'], ['cd', 'ថ្ងៃរាប់', 'Count Date'],
        ['by', 'រាប់ដោយ', 'Counted by'], ['book', 'ស្តុក', 'On hand', 1], ['kg', 'ទម្ងន់ Kg', 'Weight Kg', 1], ['counted', 'ចំនួនរាប់បាន', 'Counted Qty', 1], ['diff', 'ខុសគ្នា', 'Difference', 1]],
        { rows: ['grp', 'material'], cols: ['uom'], vals: [{ k: 'book', agg: 'sum' }], filters: {} }, stock);
    }
    const uniq = f => Array.from(new Set(all.map(l => l[f]).filter(Boolean))).sort();
    const rows = all.filter(l => inSel(F.wh, l.wh) && inSel(F.zone, l.zone) && inSel(F.grp, l.grp) && inSel(F.sloc, l.sloc)
      && inSel(F.uom, l.uom) && (!F.qty || (F.qty === 'pos' ? l.book > 0 : l.book === 0)) && dateOk(l.sd, F.sd, false) && dateOk(l.cd, F.cd, true)
      && hit(F.q, [l.bin, l.material, l.desc, l.batch, l.sloc, l.grp]));
    const list = f => [['', T('ទាំងអស់', 'All')]].concat(uniq(f).map(v => [v, v]));
    const FILTERS = [['fwh', T('ឃ្លាំង', 'Warehouse'), 'wh', list('wh')], ['fzone', T('តំបន់', 'Bin Zone'), 'zone', list('zone')],
      ['fgrp', T('ក្រុមសម្ភារៈ', 'Material Group'), 'grp', list('grp')], ['fsloc', 'SLoc', 'sloc', list('sloc')], ['fuom', 'UoM', 'uom', list('uom')],
      ['fqty', T('ស្តុក', 'Stock'), 'qty', QTY_OPT], ['fsd', T('ថ្ងៃចូលស្តុក', 'Stock Date'), 'sd', SD_OPT], ['fcd', T('ថ្ងៃរាប់', 'Count Date'), 'cd', CD_OPT]];
    const tot = kg => rows.filter(l => kg === SC.isKg(l.uom)).reduce((a, l) => a + l.book, 0);
    const sumU = f => { const pc = rows.filter(l => !SC.isKg(l.uom)).reduce((a, l) => a + (Number(l[f]) || 0), 0), kg = rows.filter(l => SC.isKg(l.uom)).reduce((a, l) => a + (Number(l[f]) || 0), 0);
      return [pc ? fmtQty(SC.round3(pc)) + ' PC' : '', kg ? fmtQty(SC.round3(kg)) + ' KG' : ''].filter(Boolean).join('<br>') || '0'; };
    const nCounted = rows.filter(l => l.cd).length;
    view(`
      <div class="fb-wrap">${repHead('stock', '📦 ' + T('បញ្ជីស្តុក', 'Stock list'), can('export') ? `<button type="button" class="fb-btn" id="exp">${FB.xl} Excel</button>` : '',
        () => { FILTERS.forEach(f => { F[f[2]] = ''; }); F.q = ''; stock(); })}
      ${FB.panel('stock', FILTERS.map((f, i) => (i < 5 ? msel(f[0], f[1], f[3].filter(o => o[0]), F[f[2]]) : FB.field(f[1], `<select id="${f[0]}">${f[3].map(o => `<option value="${esc(o[0])}"${o[0] === F[f[2]] ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`))).join('')
        + FB.search('fq', T('ស្វែងរក ទីតាំង សម្ភារៈ ឬ Batch', 'Search bin, material or batch'), F.q))}</div>
      <div class="sumline"><b>${rows.length}</b> ${T('ជួរ', 'lines')} · <b>${new Set(rows.map(l => l.bin)).size}</b> ${T('ទីតាំង', 'bins')} · ${T('ស្តុក', 'On hand')} <b>${fmtQty(tot(false))}</b> PC · <b>${fmtQty(tot(true))}</b> KG · ${T('បានរាប់', 'Counted')} <b>${nCounted}</b> · ${T('មិនទាន់រាប់', 'Never')} <b>${rows.length - nCounted}</b></div>
      <section class="screp"><table class="rep stocktbl"><thead><tr><th>${T('ទីតាំង', 'Bin')}</th><th>${T('ឃ្លាំង', 'Warehouse')}</th><th>${T('តំបន់', 'Zone')}</th><th>${T('ក្រុមសម្ភារៈ', 'Material Group')}</th><th>${T('សម្ភារៈ', 'Material')}</th><th>${T('បរិយាយ', 'Description')}</th><th>Batch</th><th>SLoc</th><th>${T('ស្តុក', 'On hand')}</th><th>UoM</th><th>${T('ថ្ងៃចូលស្តុក', 'Stock Date')}</th><th>${T('ថ្ងៃរាប់', 'Count Date')}</th><th>${T('ចំនួនរាប់បាន', 'Counted Qty')}</th><th>${T('ខុសគ្នា', 'Difference')}</th><th>${T('រាប់ដោយ', 'Counted by')}</th></tr></thead><tbody>
        ${rows.map(l => `<tr class="go" data-bin="${esc(l.bin)}"><td class="mono">${esc(l.bin)}</td><td>${esc(l.wh)}</td><td>${esc(l.zone)}</td><td>${esc(l.grp)}</td><td class="mono">${esc(l.material)}</td><td>${esc(l.desc)}</td><td class="mono">${esc(l.batch)}</td><td>${esc(l.sloc)}</td><td class="num mono">${fmtQty(l.book)}</td><td>${esc(l.uom)}</td><td>${esc(l.sd || '—')}</td><td>${l.cd ? esc(l.cd) : `<span class="pill never">${T('មិនទាន់រាប់', 'Never')}</span>`}</td><td class="num mono">${l.counted == null || l.counted === '' ? '' : fmtQty(l.counted)}</td><td class="num mono ${Number(l.diff) < 0 ? 'out' : Number(l.diff) > 0 ? 'in' : ''}">${l.diff == null || l.diff === '' ? '' : (Number(l.diff) > 0 ? '+' : '') + fmtQty(l.diff)}</td><td>${esc(l.by || '')}</td></tr>`).join('')
          || `<tr><td class="muted" colspan="15">${T('រកមិនឃើញ', 'Nothing found')}</td></tr>`}</tbody>
        <tfoot><tr class="gtot"><th>${T('សរុបរួម', 'Grand total')}</th>${'<th></th>'.repeat(7)}<th class="num mono">${sumU('book')}</th>${'<th></th>'.repeat(3)}<th class="num mono">${sumU('counted')}</th><th class="num mono">${sumU('diff')}</th><th></th></tr></tfoot></table></section>
      ${oldNote()}<p class="muted">${T('ចុចលើជួរ ដើម្បីបើកទីតាំង។', 'Tap a row to open the bin.')}</p>`);
    pvWire('stock', stock);
    setTimeout(fitRep, 0);
    keep('#fq', v => { F.q = v; stock(); });
    FILTERS.forEach((f, i) => { if (i < 5) mselWire(f[0], v => { F[f[2]] = v; stock(); }); else $('#' + f[0]).onchange = e => { F[f[2]] = e.target.value; stock(); }; });
    $$('tr.go').forEach(tr => { tr.onclick = () => openBin(tr.dataset.bin); });
    if ($('#exp')) $('#exp').onclick = () => download('stock-on-hand.csv', [['Bin', 'Warehouse', 'Zone', 'Material Group', 'Material', 'Description', 'Batch', 'SLoc', 'On hand', 'UoM', 'Stock Date', 'Count Date', 'Counted Qty', 'Difference', 'Counted By']]
      .concat(rows.map(l => [l.bin, l.wh, l.zone, l.grp, l.material, l.desc, l.batch, l.sloc, l.book, l.uom, l.sd, l.cd, l.counted == null ? '' : l.counted, l.diff == null ? '' : l.diff, l.by])));
  }
  // Table | Pivot switch on Stock list and Movements (Kim, 20 Nov: drag and drop like an Excel pivot table).
  const pvMode = id => { try { return localStorage.getItem('sc_view_' + id) === 'pivot'; } catch (e) { return false; } };
  const vMode = id => { try { return localStorage.getItem('sc_view_' + id) || 'table'; } catch (e) { return 'table'; } };
  // Table box ends at the window bottom on a computer, so the frozen filter + table header stay in view (Kim, 20 Nov).
  const fitRep = () => { const el = document.querySelector('#view .screp'); if (!el) return;
    el.style.maxHeight = innerWidth >= 900 ? Math.max(260, innerHeight - (el.getBoundingClientRect().top + window.scrollY) - 40) + 'px' : ''; };
  window.addEventListener('resize', fitRep);
  // Report header in the Truck Scale "Trip report" style (Kim, 20 Nov): title, Clear all, Table|Pivot, actions, Columns, Filter.
  const repHead = (id, title, acts, onClear, noCols) => FB.head(id, title, `<span class="fb-seg pvsw"><button type="button" data-pv="${id}" data-m="table" class="${vMode(id) === 'pivot' || (id === 'moves' && vMode(id) === 'mb51') ? '' : 'on'}">▤ ${T('តារាង', 'Table')}</button><button type="button" data-pv="${id}" data-m="pivot" class="${pvMode(id) ? 'on' : ''}">⊞ Pivot</button>${id === 'moves' ? `<button type="button" data-pv="moves" data-m="mb51" class="${vMode(id) === 'mb51' ? 'on' : ''}">⇄ MB51</button>` : ''}</span>`
    + (acts || '') + (noCols ? '' : `<button type="button" class="fb-btn" data-tcopen>⚙️ ${T('ជួរឈរ', 'Columns')}</button>`), onClear);
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-tcopen]'); if (!b) return; let c = (document.querySelector('.screp') || {}).previousElementSibling; c = c && c.classList.contains('tc-bar') ? c.querySelector('.tc-btn') : null; if (c) c.click(); });
  const pvToggle = id => `<span class="seg pvseg"><button type="button" data-pv="${id}" data-m="table" class="${pvMode(id) ? '' : 'on'}">▤ ${T('តារាង', 'Table')}</button><button type="button" data-pv="${id}" data-m="pivot" class="${pvMode(id) ? 'on' : ''}">⊞ Pivot</button></span>`;
  function pvWire(id, redraw) {
    $$(`[data-pv="${id}"]`).forEach(b => { b.onclick = () => { try { localStorage.setItem('sc_view_' + id, b.dataset.m); } catch (e) { /* private mode */ } redraw(); }; });
  }
  function pivotScreen(id, title, data, fields, def, redraw) {
    view(`<div class="fb-wrap">${repHead(id, title, '', null, true)}</div><div class="sumline"><b>${data.length}</b> ${T('ជួរ', 'rows')}</div>${oldNote()}<div id="pvBox"></div>`);
    pvWire(id, redraw);
    window.SCPivot.mount($('#pvBox'), { id: id, data: data, T: T, def: def, fields: fields.map(f => ({ k: f[0], km: f[1], en: f[2], num: !!f[3] })),
      onExport: grid => download(id + '-pivot.csv', grid) });
  }
  // Multi-select filter (Kim, 27 Nov: "allow multiple selection"). State is an array; empty = All.
  const inSel = (sel, v) => !sel || !sel.length || (Array.isArray(sel) ? sel.indexOf(String(v)) >= 0 : sel === String(v));
  const asArr = v => (Array.isArray(v) ? v : v ? [v] : []);
  function msel(id, label, opts, sel) {
    const a = asArr(sel), lab = v => { const o = opts.find(x => x[0] === v); return o ? o[1] : v; };
    const txt = !a.length ? T('ទាំងអស់', 'All') : a.length <= 2 ? a.map(lab).join(', ') : a.length + ' ' + T('បានជ្រើស', 'selected');
    return `<div class="fb-field">${label}<div class="msel" id="${id}"><button type="button" class="msel-btn${a.length ? ' on' : ''}">${esc(txt)}</button><div class="msel-pop" hidden>
      ${opts.length > 8 ? `<input type="search" class="msel-q" placeholder="${T('ស្វែងរក', 'Search')}">` : ''}<div class="msel-acts"><button type="button" data-ms="all">${T('ជ្រើសទាំងអស់', 'Select all')}</button><button type="button" data-ms="none">${T('សម្អាត', 'Clear')}</button></div>
      <div class="msel-list">${opts.map(o => `<label><input type="checkbox" value="${esc(o[0])}"${a.indexOf(o[0]) >= 0 ? ' checked' : ''}> ${esc(o[1])}</label>`).join('') || `<span class="muted">—</span>`}</div>
      <button type="button" class="msel-ok">OK</button></div></div></div>`;
  }
  let mselOpen = null;
  function mselWire(id, done) {
    const box = $('#' + id); if (!box) return;
    const pop = box.querySelector('.msel-pop'), get = () => Array.from(pop.querySelectorAll('input[type=checkbox]:checked')).map(c => c.value);
    const start = get().join('|');
    const close = () => { pop.hidden = true; mselOpen = null; const v = get(); if (v.join('|') !== start) done(v); };
    box.querySelector('.msel-btn').onclick = e => { e.stopPropagation(); if (mselOpen && mselOpen !== close) mselOpen(); if (pop.hidden) { pop.hidden = false; mselOpen = close; const q = pop.querySelector('.msel-q'); if (q) q.focus(); } else close(); };
    pop.onclick = e => e.stopPropagation();
    pop.querySelector('.msel-ok').onclick = close;
    pop.querySelectorAll('[data-ms]').forEach(b => { b.onclick = () => pop.querySelectorAll('.msel-list label').forEach(l => { if (!l.hidden) l.querySelector('input').checked = b.dataset.ms === 'all'; }); });
    const q = pop.querySelector('.msel-q');
    if (q) q.oninput = () => { const t = q.value.toLowerCase(); pop.querySelectorAll('.msel-list label').forEach(l => { l.hidden = t && l.textContent.toLowerCase().indexOf(t) < 0; }); };
  }
  document.addEventListener('click', () => { if (mselOpen) mselOpen(); });
  // Search box that keeps the cursor when the table is drawn again.
  function keep(sel, fn) {
    const el = $(sel);
    el.oninput = () => { const pos = el.selectionStart; fn(el.value); const n = $(sel); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* number box */ } };
  }

  // ------------------------------------------------------------------ movements (the ledger)
  function moves() {
    wide(); loadLedger('moves');
    if (vMode('moves') === 'mb51') return mb51View();
    const types = ['IN', 'OUT', 'TRANSFER OUT', 'TRANSFER IN', 'ADJUST'];
    if (pvMode('moves')) {
      const data = newest().map(r => ({ date: r.date, month: String(r.date || '').slice(0, 7), type: tLabel(r.type), bin: r.bin, wh: whOf(r.bin), zone: zoneOf(r.bin), grp: groupOf(r),
        material: r.material, desc: r.desc, batch: r.batch, sloc: r.sloc, uom: r.uom, reference: r.reference, user: String(r.user || '').split('@')[0],
        qin: Number(r.qtyIn) || 0, qout: Number(r.qtyOut) || 0, net: (Number(r.qtyIn) || 0) - (Number(r.qtyOut) || 0) }));
      return pivotScreen('moves', '🔄 ' + T('ចលនាស្តុក', 'Movements'), data, [
        ['date', 'ថ្ងៃ', 'Date'], ['month', 'ខែ', 'Month'], ['type', 'ប្រភេទ', 'Type'], ['wh', 'ឃ្លាំង', 'Warehouse'], ['zone', 'តំបន់', 'Bin Zone'], ['bin', 'ទីតាំង', 'Bin'],
        ['grp', 'ក្រុមសម្ភារៈ', 'Material Group'], ['material', 'សម្ភារៈ', 'Material'], ['desc', 'បរិយាយ', 'Description'], ['batch', 'Batch', 'Batch'], ['sloc', 'SLoc', 'SLoc'],
        ['uom', 'UoM', 'UoM'], ['reference', 'ឯកសារយោង', 'Reference'], ['user', 'អ្នកប្រើ', 'User'],
        ['qin', 'ចូល', 'In', 1], ['qout', 'ចេញ', 'Out', 1], ['net', 'សុទ្ធ', 'Net', 1]],
        { rows: ['date'], cols: ['type'], vals: [{ k: 'net', agg: 'sum' }], filters: {} }, moves);
    }
    // Movements filters + all columns (Kim, 20 Nov: "put all the columns, I will hide it later"; no User filter).
    const mon = dAgo(0).slice(0, 8) + '01';
    const QD = [['today', T('ថ្ងៃនេះ', 'Today'), dAgo(0), dAgo(0)], ['7', T('៧ ថ្ងៃ', '7 days'), dAgo(6), dAgo(0)], ['month', T('ខែនេះ', 'This month'), mon, dAgo(0)], ['all', T('ទាំងអស់', 'All'), '', '']];
    const ppbOf = r => { const p = (S.products || []).find(x => String(x.material).toUpperCase() === String(r.material).toUpperCase()); const l = (D.stock || []).find(x => String(x.material).toUpperCase() === String(r.material).toUpperCase());
      return { ppb: Number((p && p.ppb) || (l && l.pcsPerBundle)) || 1, kg: Number((p && p.kg) || (l && l.kgPerPc)) || 0 }; };
    const bdOf = (q, r) => { const u = ppbOf(r); if (!(u.ppb > 1)) return ''; const pcs = SC.isKg(r.uom) ? (u.kg ? q / u.kg : null) : q; if (pcs == null) return '';
      const bd = Math.floor(pcs / u.ppb), rem = Math.round(pcs - bd * u.ppb); return `${fmtQty(bd)} ${T('បាច់', 'bd')}${rem ? ' + ' + fmtQty(rem) : ''}`; };
    const all = newest().map(r => Object.assign({}, r, { wh: whOf(r.bin), zone: zoneOf(r.bin), grp: groupOf(r) }));
    const uq = f => Array.from(new Set(all.map(r => r[f]).filter(Boolean))).sort();
    const MF = [['mt', T('ប្រភេទ', 'Type'), types.map(t => [t, tLabel(t)])], ['mwh', T('ឃ្លាំង', 'Warehouse'), uq('wh').map(v => [v, v])], ['mzone', T('តំបន់', 'Bin Zone'), uq('zone').map(v => [v, v])],
      ['mgrp', T('ក្រុមសម្ភារៈ', 'Material Group'), uq('grp').map(v => [v, v])], ['msloc', 'SLoc', uq('sloc').map(v => [v, v])], ['mdir', T('ចូល / ចេញ', 'Direction (In / Out)'), [['in', T('ចូល', 'In')], ['out', T('ចេញ', 'Out')]]]];
    const dirOk = r => !asArr(F.mdir).length || asArr(F.mdir).some(d => (d === 'in' ? Number(r.qtyIn) > 0 : Number(r.qtyOut) > 0));
    const rows = all.filter(r => inSel(F.mt, r.type) && inSel(F.mwh, r.wh) && inSel(F.mzone, r.zone) && inSel(F.mgrp, r.grp) && inSel(F.msloc, r.sloc)
      && dirOk(r) && (!F.mfrom || String(r.date) >= F.mfrom) && (!F.mto || String(r.date) <= F.mto)
      && hit(F.mq, [r.id, r.bin, r.material, r.desc, r.batch, r.reference, r.user, r.otherBin, r.remark]));
    const sumUom = f => { const pc = rows.filter(r => !SC.isKg(r.uom)).reduce((a, r) => a + (Number(r[f]) || 0), 0), kg = rows.filter(r => SC.isKg(r.uom)).reduce((a, r) => a + (Number(r[f]) || 0), 0);
      return [pc ? fmtQty(round3(pc)) + ' PC' : '', kg ? fmtQty(round3(kg)) + ' KG' : ''].filter(Boolean).join('<br>'); };
    const nIn = rows.filter(r => Number(r.qtyIn) > 0).length, nOut = rows.filter(r => Number(r.qtyOut) > 0).length;
    const H = [T('ថ្ងៃ', 'Date'), T('ម៉ោង', 'Time'), T('លេខ', 'Txn ID'), T('ប្រភេទ', 'Type'), T('ឃ្លាំង', 'Warehouse'), T('ទីតាំង', 'Bin'), T('តំបន់', 'Bin Zone'), T('ពី / ទៅទីតាំង', 'From / To bin'),
      T('សម្ភារៈ', 'Material'), T('បរិយាយ', 'Description'), T('ក្រុមសម្ភារៈ', 'Material Group'), 'Batch', 'SLoc', T('ចូល', 'In'), T('ចេញ', 'Out'), 'UoM', T('សមតុល្យ', 'Balance'), T('សមតុល្យ (បាច់)', 'Balance (bundles)'),
      T('ឯកសារយោង', 'Reference'), T('កំណត់សម្គាល់', 'Remark'), T('អ្នកប្រើ', 'User')];
    const qOn = (QD.find(q => q[2] === F.mfrom && q[3] === F.mto) || [''])[0];
    view(`
      <div class="fb-wrap">${repHead('moves', '🔄 ' + T('ចលនាស្តុក (សៀវភៅប្រតិបត្តិការ)', 'Movements (stock ledger)'), can('export') ? `<button type="button" class="fb-btn" id="exp">${FB.xl} Excel</button>` : '',
        () => { MF.forEach(f => { F[f[0]] = ''; }); F.mq = ''; F.mfrom = F.mto = ''; moves(); })}
      ${FB.panel('moves', FB.seg(QD.map(q => [q[0], q[1]]), qOn, 'mqd') + FB.range('mFrom', 'mTo', F.mfrom, F.mto) + FB.show('mGo')
        + MF.map(f => msel(f[0], f[1], f[2], F[f[0]])).join('')
        + FB.search('mq', T('ស្វែងរក ទីតាំង សម្ភារៈ Batch ឯកសារយោង', 'Search bin, material, batch, reference, Txn ID'), F.mq))}</div>
      <div class="sumline"><b>${rows.length}</b> ${T('ជួរ', 'rows')} · ${T('ចូល', 'In')} <b>${nIn}</b> · ${T('ចេញ', 'Out')} <b>${nOut}</b> · <b>${new Set(rows.map(r => r.user).filter(Boolean)).size}</b> ${T('អ្នកប្រើ', 'users')}</div>
      <section class="screp"><table class="rep"><thead><tr>${H.map((h, i) => `<th${i === 13 || i === 14 || i === 16 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>
        ${rows.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td class="mono">${esc(r.id)}</td><td><span class="pill ${isIn(r.type) ? 'in' : 'out'}">${esc(tLabel(r.type))}</span></td><td>${esc(r.wh)}</td>
          <td class="mono">${esc(r.bin)}</td><td>${esc(r.zone)}</td><td class="mono muted">${r.otherBin ? (isIn(r.type) ? '← ' : '→ ') + esc(r.otherBin) : ''}</td><td class="mono">${esc(r.material)}</td><td>${esc(r.desc)}</td><td>${esc(r.grp)}</td>
          <td class="mono">${esc(r.batch)}</td><td>${esc(r.sloc)}</td><td class="num in">${Number(r.qtyIn) ? '+' + fmtQty(r.qtyIn) : ''}</td><td class="num out">${Number(r.qtyOut) ? '-' + fmtQty(r.qtyOut) : ''}</td><td>${esc(r.uom)}</td>
          <td class="num mono">${fmtQty(r.balance)}</td><td>${bdOf(Number(r.balance) || 0, r)}</td><td>${esc(r.reference)}</td><td>${esc(r.remark || '')}</td><td>${esc(String(r.user || '').split('@')[0])}</td></tr>`).join('')
          || `<tr><td class="muted" colspan="21">${T('រកមិនឃើញ', 'Nothing found')}</td></tr>`}</tbody>
        <tfoot><tr class="gtot"><th>${T('សរុបរួម', 'Grand total')}</th>${'<th></th>'.repeat(12)}<th class="num mono">${sumUom('qtyIn')}</th><th class="num mono">${sumUom('qtyOut')}</th>${'<th></th>'.repeat(6)}</tr></tfoot></table></section>
      ${oldNote()}
      <p class="muted">${T('ជួរនីមួយៗមិនអាចកែ ឬលុបបានទេ។ កំហុសត្រូវកែដោយប្រតិបត្តិការថ្មី។', 'Rows are never edited or deleted. A mistake is corrected with a new transaction.')}</p>`);
    pvWire('moves', moves);
    setTimeout(fitRep, 0);
    keep('#mq', v => { F.mq = v; moves(); });
    MF.forEach(f => mselWire(f[0], v => { F[f[0]] = v; moves(); }));
    $$('[data-mqd]').forEach(bn => { bn.onclick = () => { const q = QD.find(x => x[0] === bn.dataset.mqd); F.mfrom = q[2]; F.mto = q[3]; moves(); }; });
    $('#mGo').onclick = () => { F.mfrom = $('#mFrom').value; F.mto = $('#mTo').value; moves(); };
    $('#mFrom').onchange = $('#mTo').onchange = () => { F.mfrom = $('#mFrom').value; F.mto = $('#mTo').value; moves(); };
    if ($('#exp')) $('#exp').onclick = () => download('stock-ledger.csv', [['Date', 'Time', 'Txn ID', 'Type', 'Warehouse', 'Bin', 'Bin Zone', 'From / To bin', 'Material', 'Description', 'Material Group', 'Batch', 'SLoc', 'In', 'Out', 'UoM', 'Balance', 'Balance (bundles)', 'Reference', 'Remark', 'User']]
      .concat(rows.map(r => [r.date, r.time, r.id, r.type, r.wh, r.bin, r.zone, r.otherBin, r.material, r.desc, r.grp, r.batch, r.sloc, r.qtyIn, r.qtyOut, r.uom, r.balance, bdOf(Number(r.balance) || 0, r), r.reference, r.remark, r.user])));
  }

  // ------------------------------------------------------------------ count review (supervisor approves, controller posts the adjustment)
  function review() {
    wide();
    const who = T(role().km, role().en);
    const act = c => {
      if (c.status === 'Submitted' && can('approve')) return `<button type="button" class="btn ok sm" data-act="approve" data-id="${esc(c.id)}">${T('អនុម័ត', 'Approve')}</button> <button type="button" class="btn ghost sm" data-act="reject" data-id="${esc(c.id)}">${T('បដិសេធ', 'Reject')}</button>`;
      if (c.status === 'Approved' && c.variance !== 0) return can('adjust') ? `<button type="button" class="btn blue sm" data-act="post" data-id="${esc(c.id)}">${T('កែតម្រូវស្តុក', 'Post adjustment')}</button>` : `<small class="muted">${T('រង់ចាំអ្នកត្រួតពិនិត្យស្តុក', 'Waiting for Inventory Controller')}</small>`;
      return c.doneBy ? `<small class="muted">${esc(c.doneBy)}</small>` : '';
    };
    view(`
      <h2 class="ptitle">${T('ពិនិត្យការរាប់ស្តុក', 'Count review')} <small class="muted">${pending()} ${T('រង់ចាំអនុម័ត', 'to review')}</small></h2>
      <div class="steps"><span>1 · ${T('បុគ្គលិករាប់', 'Operator counts')}</span><span>2 · ${T('ប្រធានក្រុមអនុម័ត ឬបដិសេធ', 'Supervisor approves or rejects')}</span><span>3 · ${T('អ្នកត្រួតពិនិត្យស្តុកកែតម្រូវស្តុក', 'Inventory Controller posts the adjustment')}</span></div>
      <section class="card scroll tall"><table class="lines hist"><tr><th>${T('ថ្ងៃ', 'Date')}</th><th>${T('ទីតាំង', 'Bin')}</th><th>${T('សម្ភារៈ', 'Material')}</th><th>Batch</th><th>${T('ក្នុងប្រព័ន្ធ', 'Book')}</th><th>${T('រាប់បាន', 'Counted')}</th><th>${T('ខុសគ្នា', 'Variance')}</th><th>${T('រាប់ដោយ', 'Counted by')}</th><th>${T('ស្ថានភាព', 'Status')}</th><th data-nosort>${T('សកម្មភាព', 'Action')}</th></tr>
        ${D.counts.map(c => `<tr><td>${esc(c.date.slice(5))} <small class="muted">${esc(c.time)}</small></td><td>${esc(c.bin)}</td><td>${esc(c.material)}<br><small class="muted">${esc(c.desc)}${c.remark ? ' · ' + esc(c.remark) : ''}</small></td><td>${esc(c.batch)}</td>
          <td class="num">${fmtQty(c.book)}</td><td class="num"><b>${fmtQty(c.counted)}</b> ${esc(c.uom)}</td><td class="num ${c.variance < 0 ? 'out' : c.variance > 0 ? 'in' : ''}">${c.variance > 0 ? '+' : ''}${fmtQty(c.variance)}</td><td>${esc(String(c.by || '').split('@')[0])}</td><td>${stBadge(c.status)}</td><td class="acts">${act(c)}</td></tr>`).join('')}</table></section>
      <p class="muted">${T('អ្នកកំពុងមើលជា', 'You are viewing as')} <b>${esc(who)}</b>. ${T('ស្តុកក្នុងប្រព័ន្ធមិនប្តូរទេ រហូតដល់ការកែតម្រូវត្រូវបានបញ្ចូល។', 'The book balance does not change until the adjustment is posted.')}</p>`);
    $$('[data-act]').forEach(b => { b.onclick = () => {
      const c = D.counts.find(x => x.id === b.dataset.id), me = roleId + '@isi';
      if (b.dataset.act === 'approve') { c.status = 'Approved'; c.doneBy = me; toast(T('បានអនុម័ត', 'Approved')); }
      if (b.dataset.act === 'reject') { c.status = 'Rejected'; c.doneBy = me; toast(T('បានបដិសេធ៖ ត្រូវរាប់ម្តងទៀត', 'Rejected: count again')); }
      if (b.dataset.act === 'post') {
        const l = D.stock.find(x => x.bin === c.bin && sameLine(x, c));
        if (!l) { toast(T('រកមិនឃើញស្តុក', 'Stock line not found')); return; }
        // The adjustment is the counted variance, applied to the balance of today (stock may have moved since the count).
        const bal = round3(l.book + c.variance);
        if (bal < 0) { toast(T('ស្តុកមិនអាចអវិជ្ជមាន', 'Stock cannot go below zero')); return; }
        D.log('ADJUST', c.bin, l, c.variance > 0 ? c.variance : 0, c.variance < 0 ? -c.variance : 0, bal, { reference: c.id, remark: 'Count adjustment', requestId: 'adj-' + c.id }, '', 'ADJ');
        l.book = bal; c.status = 'Adjustment Posted'; c.doneBy = me; S.bins = D.binList();
        toast(T('បានកែតម្រូវស្តុក ', 'Adjustment posted: ') + (c.variance > 0 ? '+' : '') + fmtQty(c.variance) + ' ' + c.uom);
      }
      route();
    }; });
  }

  // ------------------------------------------------------------------ SAP import and reconciliation
  const FIELDS = [['material', 'Material', /material$|^material|product$|^sku|item code/i, true], ['bin', 'Bin', /\bbin\b/i], ['batch', 'Batch', /batch/i], ['sloc', 'SLoc', /sloc|storage loc|^s\.?loc/i],
    ['qty', 'Quantity', /unrestricted|quantity|qty|on hand/i, true], ['uom', 'UoM', /uom|unit/i]];
  const R = { name: '', at: '', headers: [], rows: [], map: {}, error: '' };
  function parseCsv(text) {
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.match(/\t/g) || []).length ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    const out = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); out.push(row); }
    return out.filter(r => r.some(c => String(c).trim() !== ''));
  }
  function loadSap(name, text) {
    const rows = parseCsv(text.replace(/^﻿/, ''));
    R.error = '';
    if (rows.length < 2) { R.error = T('ឯកសារគ្មានទិន្នន័យ', 'The file has no data rows'); R.rows = []; return sap(); }
    R.name = name; R.at = now(); R.headers = rows[0].map(h => String(h).trim()); R.rows = rows.slice(1); R.map = {};
    FIELDS.forEach(f => { const i = R.headers.findIndex((h, k) => f[2].test(h) && !/desc/i.test(h) && Object.values(R.map).indexOf(k) < 0); R.map[f[0]] = i; });
    R.dcol = R.headers.findIndex(h => /desc/i.test(h));
    sap();
  }
  const numSap = v => { const s = String(v == null ? '' : v).trim().replace(/,/g, ''); return s === '' || !isFinite(Number(s)) ? NaN : Number(s); };
  function reconcile() {
    const m = R.map, level = ['bin', 'material', 'batch', 'sloc'].filter(k => m[k] >= 0);
    const keyOf = o => level.map(k => String(o[k] == null ? '' : o[k]).trim().toUpperCase()).join('|');
    const all = {}; let bad = 0;
    const slot = (k, o) => all[k] || (all[k] = { key: k, o: o, digital: null, sap: null, desc: '', uom: '' });
    D.stock.forEach(l => { const x = slot(keyOf(l), l); x.digital = round3((x.digital || 0) + l.book); x.desc = l.desc; x.uom = l.uom; });
    R.rows.forEach(r => {
      const o = {}; level.forEach(k => { o[k] = r[m[k]]; });
      const q = numSap(r[m.qty]);
      if (!String(o.material || '').trim() || isNaN(q)) { bad++; return; }
      const x = slot(keyOf(o), o); x.sap = round3((x.sap || 0) + q);
      if (!x.uom && m.uom >= 0) x.uom = r[m.uom];
      // Description (Kim, 27 Nov: blank for lines only in SAP): the SAP file's own column, then the stock, then the Product Master.
      if (!x.desc && R.dcol >= 0) x.desc = String(r[R.dcol] == null ? '' : r[R.dcol]).trim();
      if (!x.desc) { const mk = String(o.material).trim().toUpperCase(); const known = D.stock.find(l => l.material.toUpperCase() === mk) || (S.products || []).find(q => String(q.material).toUpperCase() === mk); x.desc = known ? known.desc : ''; }
    });
    const list = Object.keys(all).map(k => { const x = all[k]; const v = round3((x.digital || 0) - (x.sap || 0));
      return Object.assign(x, { variance: v, status: x.sap == null ? 'digital' : x.digital == null ? 'sap' : v === 0 ? 'match' : 'var' }); })
      .sort((a, b) => (a.status === 'match') - (b.status === 'match') || Math.abs(b.variance) - Math.abs(a.variance));
    return { level: level, list: list, bad: bad };
  }
  const SAMPLE = {
    mb52: () => { const rows = [['Material', 'Material Description', 'Plant', 'Storage Location', 'Batch', 'Unrestricted', 'Base Unit of Measure']];
      SNAP.forEach((l, i) => { if (i === 11) return; rows.push([l.material, l.desc, l.sloc.slice(0, 2) + '00', l.sloc, l.batch, (l.book + (i === 1 ? 120 : i === 6 ? -10 : 0)).toLocaleString('en-US', { minimumFractionDigits: 3 }), l.uom]); });
      rows.push(['PIPE-50X50', 'Square Steel Pipe 50 x 50 x 1.8', '2000', '2010', '26100200', '60.000', 'PC']);
      return rows; },
    ewm: () => { const rows = [['Storage Bin', 'Product', 'Product Description', 'Batch', 'Quantity', 'Base Unit']];
      SNAP.forEach((l, i) => rows.push([l.bin, l.material, l.desc, l.batch, String(l.book + (i === 3 ? -55 : i === 9 ? 20 : 0)), l.uom]));
      return rows; },
  };
  const toCsv = rows => rows.map(r => r.map(v => (/[",]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v)).join(',')).join('\n');
  const SL = { match: ['ត្រូវគ្នា', 'Match'], var: ['ខុសគ្នា', 'Variance'], sap: ['មានតែក្នុង SAP', 'Only in SAP'], digital: ['មានតែក្នុងកាតស្តុក', 'Only in digital'] };

  // SheetJS (already in the repo for Scale and Data Entry), loaded only when an Excel file is chosen.
  let xlsxP = null;
  const xlsxLib = () => (window.XLSX ? Promise.resolve(window.XLSX) : (xlsxP = xlsxP || new Promise((ok, no) => {
    const sc = document.createElement('script'); sc.src = '../vendor/xlsx.mini.min.js'; sc.onload = () => (window.XLSX ? ok(window.XLSX) : no()); sc.onerror = () => { xlsxP = null; no(); }; document.head.appendChild(sc); })));
  function sap() {
    wide();
    const ok = R.rows.length && R.map.material >= 0 && R.map.qty >= 0;
    const res = ok ? reconcile() : null;
    // Product filters like the Product menu (Kim, 20 Nov): L1–L4, Size, Grade, Brand, Class + search; the numbers follow the filters.
    if (res) loadProducts();
    const PI = {}, H = PT.head || [];
    if (res && PT.head) { const mi = H.indexOf('Material'); PT.rows.forEach(r => { PI[String(r[mi]).toUpperCase()] = r; }); }
    const pAt = (x, name) => { const r = PI[String(x.o.material || '').trim().toUpperCase()], i = H.indexOf(name); return r && i >= 0 ? r[i] : ''; };
    const pfOk = (x, skip) => PF.every(f => f === skip || !SFV[f[0]] || pAt(x, f[0]) === SFV[f[0]]);
    const lv = res ? res.level.join('+') : '';
    if (res) loadVar('sap');
    const rsnOf = x => { const r = RS[x.key]; if (r && r.reason != null) return r.reason; const c = openCase(lv, x.key); return c ? c.Reason || '' : ''; };
    const rmkOf = x => { const r = RS[x.key]; if (r && r.remark != null) return r.remark; const c = openCase(lv, x.key); return c ? c.Remark || '' : ''; };
    const list = res ? res.list.filter(x => pfOk(x) && (!SR || (SR === '-' ? !rsnOf(x) && x.status !== 'match' : rsnOf(x) === SR)) && (!sq || [x.o.bin, x.o.material, x.o.batch, x.o.sloc, x.desc].join(' ').toLowerCase().indexOf(sq.toLowerCase()) >= 0)) : [];
    const sopts = f => Array.from(new Set(res.list.filter(x => pfOk(x, f)).map(x => pAt(x, f[0])).filter(Boolean))).sort();
    const vars = list.filter(x => x.status !== 'match');
    if (res) lastSap = { at: R.at, variances: res.list.filter(x => x.status !== 'match').length, name: R.name };
    const shown = res ? (F.onlyVar ? vars : list) : [];
    const lvName = res ? res.level.map(k => FIELDS.find(f => f[0] === k)[1]).join(' + ') : '';
    const pct = x => (x.status === 'match' ? '' : x.sap ? (Math.round(x.variance / Math.abs(x.sap) * 1000) / 10) + '%' : x.digital ? '+100%' : '−100%');
    const sumU = f => { const u = {}; shown.forEach(x => { if (x[f] == null) return; const k = String(x.uom || '').toUpperCase(); u[k] = (u[k] || 0) + Number(x[f]); });
      return Object.keys(u).sort().map(k => `${f === 'variance' && u[k] > 0 ? '+' : ''}${fmtQty(round3(u[k]))} ${esc(k)}`).join('<br>') || '0'; };
    const seen = x => { const c = openCase(lv, x.key); return !c ? (x.status === 'match' ? '' : T('ថ្មី', 'New')) : `<span class="st ${Number(c.Times) >= 3 ? 'st-sap' : 'st-var'}">${esc(c.Times)}× · ${esc(String(c['First Seen']).slice(5, 10))}</span>`; };
    view(`
      <h2 class="ptitle">${T('នាំចូល SAP និងផ្ទៀងផ្ទាត់', 'SAP import and reconciliation')}</h2>
      <section class="card">
        <div class="fbar"><label class="btn sm file">⬆ ${T('ជ្រើសឯកសារ Excel ឬ CSV ពី SAP', 'Choose SAP Excel or CSV file')}<input type="file" id="sapFile" accept=".csv,.txt,.xlsx,.xlsm,.xls,text/csv" hidden></label>
          ${DEMO ? `<button type="button" class="btn ghost sm" data-sample="mb52">${T('គំរូ MB52', 'Sample MB52')}</button>
          <button type="button" class="btn ghost sm" data-sample="ewm">${T('គំរូ EWM (មានទីតាំង)', 'Sample EWM (with bins)')}</button>` : ''}</div>
        <details class="paste"><summary>${T('ឬបិទភ្ជាប់ពី Excel', 'or paste from Excel')}</summary><textarea id="sapPaste" rows="4" placeholder="Material&#9;Batch&#9;Storage Location&#9;Unrestricted"></textarea>
          <button type="button" class="btn ghost sm" id="usePaste">${T('ប្រើទិន្នន័យនេះ', 'Use this data')}</button></details>
        ${R.error ? `<p class="bad">⚠️ ${esc(R.error)}</p>` : ''}
        ${R.rows.length ? `<p class="muted">📄 <b>${esc(R.name)}</b> · ${R.rows.length} ${T('ជួរ', 'rows')} · ${T('នាំចូលនៅ', 'snapshot')} ${esc(R.at)}${res && res.bad ? ` · <span class="bad">${res.bad} ${T('ជួរមិនអាចអាន', 'rows skipped (no material or quantity)')}</span>` : ''}</p>
          <div class="mapgrid">${FIELDS.map(f => `<label>${f[1]}${f[3] ? ' *' : ''}<select data-map="${f[0]}"${f[3] && R.map[f[0]] < 0 ? ' class="need"' : ''}><option value="-1">—</option>${R.headers.map((h, i) => `<option value="${i}"${R.map[f[0]] === i ? ' selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div>`
        : `<p class="muted">${T('នាំចេញ MB52 ឬ EWM ពី SAP ជា Excel ឬ CSV រួចជ្រើសឯកសារនៅទីនេះ (Excel អានសន្លឹកទីមួយ)។ ', 'Export MB52 or EWM stock from SAP to Excel or CSV, then choose the file here (Excel: the first sheet is read) or paste the rows.')}</p>`}
      </section>
      ${res ? `
      <div class="dash-kpis">
        <div class="stat"><b>${list.length}</b><span>${T('ជួរប្រៀបធៀប', 'Lines compared')}</span></div>
        <div class="stat in"><b>${list.length - vars.length}</b><span>${T('ត្រូវគ្នា', 'Match')}</span></div>
        <div class="stat ${vars.length ? 'out' : ''}"><b>${vars.length}</b><span>${T('ខុសគ្នា', 'Variances')}</span></div>
        <div class="stat warn"><b>${vars.filter(x => rsnOf(x)).length} / ${vars.length}</b><span>${T('មានមូលហេតុ', 'Reason given')}</span></div>
        <div class="stat"><b>${list.length ? Math.round((list.length - vars.length) / list.length * 100) : 0}%</b><span>${T('អត្រាត្រូវគ្នា', 'Match rate')}</span></div>
      </div>
      <div class="fb-wrap sapf">${FB.head('sapf', `<span class="muted">${T('ប្រៀបធៀបតាម', 'Compared by')} <b>${esc(lvName)}</b></span>`,
        `<button type="button" class="fb-btn pri" id="varSave">💾 ${T('រក្សាទុកខុសគ្នា', 'Save variance')}</button><label class="chk"><input type="checkbox" id="onlyVar"${F.onlyVar ? ' checked' : ''}> ${T('បង្ហាញតែជួរខុសគ្នា', 'Variances only')}</label>`
        + (can('export') ? `<button type="button" class="fb-btn" id="exp">${FB.xl} Excel</button>` : '') + `<button type="button" class="fb-btn" data-tcopen>⚙️ ${T('ជួរឈរ', 'Columns')}</button>`,
        () => { PF.forEach(f => { SFV[f[0]] = ''; }); sq = ''; SR = ''; sap(); })}
      ${FB.panel('sapf', (PT.head ? PF.map((f, k) => FB.field(T(f[1], f[2]), `<select id="sf${k}"><option value="">${T('ទាំងអស់', 'All')}</option>${sopts(f).map(v => `<option value="${esc(v)}"${v === SFV[f[0]] ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`)).join('')
        : `<p class="muted">${PT.err ? T('តម្រងផលិតផល សម្រាប់អ្នកគ្រប់គ្រង និងប្រធានក្រុម', 'Product filters are for admins and supervisors') : T('កំពុងផ្ទុក…', 'Loading…')}</p>`)
        + FB.field(T('មូលហេតុ', 'Reason'), `<select id="sfr"><option value="">${T('ទាំងអស់', 'All')}</option><option value="-"${SR === '-' ? ' selected' : ''}>${T('មិនទាន់មានមូលហេតុ', 'No reason yet')}</option>${RSN.map(r => `<option value="${esc(r[0])}"${r[0] === SR ? ' selected' : ''}>${esc(T(r[1], r[0]))}</option>`).join('')}</select>`)
        + FB.search('sq', T('ស្វែងរក ទីតាំង សម្ភារៈ Batch', 'Search bin, material, batch'), sq))}</div>
      <section class="screp"><table class="rep"><thead><tr>${res.level.map(k => `<th>${FIELDS.find(f => f[0] === k)[1]}</th>`).join('')}<th>${T('បរិយាយ', 'Description')}</th><th>${T('កាតស្តុក', 'Digital')}</th><th>SAP</th><th>${T('ខុសគ្នា', 'Variance')}</th><th class="num">%</th><th>UoM</th><th>${T('លទ្ធផល', 'Result')}</th><th>${T('មូលហេតុ', 'Reason')}</th><th>${T('កំណត់សម្គាល់', 'Remark')}</th><th>${T('ធ្លាប់ឃើញ', 'Seen before')}</th></tr></thead><tbody>
        ${shown.map(x => `<tr>${res.level.map(k => `<td>${esc(String(x.o[k] == null ? '' : x.o[k]))}</td>`).join('')}<td>${esc(x.desc)}</td><td class="num">${x.digital == null ? '—' : fmtQty(x.digital)}</td><td class="num">${x.sap == null ? '—' : fmtQty(x.sap)}</td>
          <td class="num ${x.variance < 0 ? 'out' : x.variance > 0 ? 'in' : ''}"><b>${x.variance > 0 ? '+' : ''}${fmtQty(x.variance)}</b></td><td class="num">${pct(x)}</td><td>${esc(x.uom)}</td><td><span class="st st-${x.status}">${T(SL[x.status][0], SL[x.status][1])}</span></td>
          ${x.status === 'match' ? '<td></td><td></td><td></td>' : `<td><select class="cell${rsnOf(x) ? '' : ' need'}" data-rsn="${esc(x.key)}"><option value="">${T('ជ្រើសមូលហេតុ', 'Choose reason')}</option>${RSN.map(r => `<option value="${esc(r[0])}"${r[0] === rsnOf(x) ? ' selected' : ''}>${esc(T(r[1], r[0]))}</option>`).join('')}</select></td>
          <td><input class="cell" data-rmk="${esc(x.key)}" value="${esc(rmkOf(x))}" placeholder="${T('កំណត់សម្គាល់…', 'Remark…')}"></td><td>${seen(x)}</td>`}</tr>`).join('')
          || `<tr><td class="muted" colspan="${res.level.length + 10}">${T('គ្មានជួរខុសគ្នា 🎉', 'No variances 🎉')}</td></tr>`}</tbody>
        <tfoot><tr class="gtot"><th>${T('សរុប', 'Subtotal')} (${shown.length})</th>${'<th></th>'.repeat(res.level.length)}<th class="num mono">${sumU('digital')}</th><th class="num mono">${sumU('sap')}</th><th class="num mono">${sumU('variance')}</th>${'<th></th>'.repeat(6)}</tr></tfoot></table></section>
      <p class="muted">${T('ខុសគ្នា = កាតស្តុក − SAP។ ទិន្នន័យ SAP មិនដែលសរសេរជាន់លើស្តុកក្នុងកាតស្តុកទេ។ ជួរខុសគ្នាត្រូវពិនិត្យដោយការរាប់។', 'Variance = Digital − SAP. SAP figures never overwrite the digital balance. A variance is checked with a count.')}</p>` : ''}`);
    // Excel files too (Kim, 20 Nov): .xlsx / .xls read from the FIRST sheet, turned into CSV for the same import.
    $('#sapFile').onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
      if (/\.(xlsx|xlsm|xls)$/i.test(f.name)) {
        rd.onload = () => xlsxLib().then(X => { const wb = X.read(new Uint8Array(rd.result), { type: 'array' }); const sh = wb.Sheets[wb.SheetNames[0]];
          loadSap(f.name + ' · ' + wb.SheetNames[0], X.utils.sheet_to_csv(sh, { blankrows: false })); }, () => toast(T('មិនអាចអាន Excel បានទេ', 'Could not read the Excel file')));
        rd.readAsArrayBuffer(f);
      } else { rd.onload = () => loadSap(f.name, String(rd.result)); rd.readAsText(f); } };
    $$('[data-sample]').forEach(b => { b.onclick = () => loadSap(b.dataset.sample === 'mb52' ? 'MB52_sample.csv' : 'EWM_stock_sample.csv', toCsv(SAMPLE[b.dataset.sample]())); });
    $('#usePaste').onclick = () => { const t = $('#sapPaste').value; if (t.trim()) loadSap(T('ទិន្នន័យបិទភ្ជាប់', 'Pasted data'), t); };
    $$('[data-map]').forEach(s => { s.onchange = () => { R.map[s.dataset.map] = Number(s.value); sap(); }; });
    if ($('#onlyVar')) $('#onlyVar').onchange = e => { F.onlyVar = e.target.checked; sap(); };
    PF.forEach((f, k) => { if ($('#sf' + k)) $('#sf' + k).onchange = e => { SFV[f[0]] = e.target.value; sap(); }; });
    if ($('#sq')) keep('#sq', v => { sq = v; sap(); });
    if (res) setTimeout(fitRep, 0);
    if ($('#sfr')) $('#sfr').onchange = e => { SR = e.target.value; sap(); };
    $$('[data-rsn]').forEach(el => { el.onchange = () => { (RS[el.dataset.rsn] = RS[el.dataset.rsn] || {}).reason = el.value; el.classList.toggle('need', !el.value); }; });
    $$('[data-rmk]').forEach(el => { el.onchange = () => { (RS[el.dataset.rmk] = RS[el.dataset.rmk] || {}).remark = el.value; }; });
    if ($('#varSave')) $('#varSave').onclick = () => saveVariance(res, lv);
    if ($('#exp')) $('#exp').onclick = () => download('sap-reconciliation.csv', [res.level.map(k => FIELDS.find(f => f[0] === k)[1]).concat(['Description', 'Digital', 'SAP', 'Variance', 'UoM', 'Result', 'Reason', 'Remark', 'SAP file', 'Snapshot'])]
      .concat(shown.map(x => res.level.map(k => x.o[k]).concat([x.desc, x.digital, x.sap, x.variance, x.uom, SL[x.status][1], rsnOf(x), rmkOf(x), R.name, R.at]))));
  }

  // ------------------------------------------------------------------ roles
  function roles() {
    wide();
    view(`
      <h2 class="ptitle">${T('តួនាទី និងសិទ្ធិ', 'Roles and rights')}</h2>
      <section class="card scroll"><table class="lines hist" data-nosort><tr><th>${T('សិទ្ធិ', 'Right')}</th>${ROLES.map(r => `<th class="ctr${r.id === roleId ? ' me' : ''}">${T(r.km, r.en)}</th>`).join('')}</tr>
        ${RIGHTS.map(x => `<tr><td>${T(x[1], x[2])}</td>${ROLES.map(r => `<td class="ctr${r.id === roleId ? ' me' : ''}">${has(r, x[0]) ? '✅' : '<span class="muted">—</span>'}</td>`).join('')}</tr>`).join('')}</table></section>
      <p class="muted">${T('ក្នុងកម្មវិធីពិត តួនាទីរបស់អ្នកប្រើនីមួយៗ កំណត់ក្នុង 👥 អ្នកប្រើ › 🔐 ម៉ឺនុយ (បញ្ជីអ្នកប្រើតែមួយ) ហើយម៉ាស៊ីនមេពិនិត្យសិទ្ធិគ្រប់ប្រតិបត្តិការ។ ប្តូរតួនាទីនៅខាងលើ ដើម្បីមើលអ្វីដែលតួនាទីនីមួយៗឃើញ។',
        'In the live app each user gets a role in 👥 Users › 🔐 Menus (the one user list), and the server checks the right on every posting. Change the role at the top to see what each role sees.')}</p>`);
  }

  // ------------------------------------------------------------------ product (Kim, 20 Nov): the Product Master, all columns, 8 filters
  const PT = { head: null, rows: [], at: 0, busy: false, err: '' };
  const PF = [['Material Group L1', 'ក្រុម L1', 'Material Group L1'], ['Material Group L2', 'ក្រុម L2', 'Material Group L2'], ['Material Group L3', 'ក្រុម L3', 'Material Group L3'],
    ['Material Group L4', 'ក្រុម L4', 'Material Group L4'], ['Size', 'ទំហំ', 'Size'], ['Grade', 'Grade', 'Grade'], ['Brand', 'ម៉ាក', 'Brand'], ['ABC Class', 'ថ្នាក់', 'Class']];
  const SFV = {}; let sq = '', SR = '';
  function loadProducts() {
    if (PT.busy || (PT.head && Date.now() - PT.at < 600000)) return;
    if (DEMO) {
      const g = p => (/Debar/i.test(p.desc) ? ['FG Trading', 'Trading', 'TR-Debar', 'Deformed Bar'] : ['Finished Goods', 'Structural', 'FG-PIPE', 'Pipe']);
      PT.head = ['Material', 'Description', 'Material Group L1', 'Material Group L2', 'Material Group L3', 'Material Group L4', 'ABC Class', 'Size', 'Grade', 'Brand', 'UoM', 'PC/Bundle', 'Kg/PC', 'Source'];
      PT.rows = (S.products || []).map(p => [p.material, p.desc].concat(g(p), ['A', (String(p.desc).match(/\d+mm/) || [''])[0], (String(p.desc).match(/SD\d+/) || [''])[0], /HOA PHAT/.test(p.desc) ? 'HOA PHAT' : 'ISI', p.uom, String(p.ppb), String(p.kg), 'Demo']));
      PT.at = Date.now(); return;
    }
    PT.busy = true; PT.err = '';
    SC.api('products', {}).then(r => { PT.head = r.head || []; PT.rows = r.rows || []; PT.at = Date.now(); }, e => { PT.err = String(e && e.message || e); })
      .then(() => { PT.busy = false; if (S.view === 'sap') sap(); });
  }

  // ------------------------------------------------------------------ bin movement summary (Kim picked mockup A, 26 Nov 2026)
  // One row per bin + UoM: Opening (before From) + In - Out = Balance, from the Stock Ledger.
  const BF = { from: dAgo(0).slice(0, 8) + '01', to: dAgo(0), wh: '', zone: '', grp: '', uom: '', q: '' };
  function binsum() {
    wide(); loadLedger('binsum');
    const mon = dAgo(0).slice(0, 8) + '01';
    const QD = [['today', T('ថ្ងៃនេះ', 'Today'), dAgo(0), dAgo(0)], ['7', T('៧ ថ្ងៃ', '7 days'), dAgo(6), dAgo(0)], ['month', T('ខែនេះ', 'This month'), mon, dAgo(0)], ['all', T('ទាំងអស់', 'All'), '', '']];
    const led = D.ledger.map(r => Object.assign({}, r, { wh: whOf(r.bin), zone: zoneOf(r.bin), grp: groupOf(r), uom: String(r.uom || 'PC').toUpperCase() }));
    const uq = f => Array.from(new Set(led.map(r => r[f]).filter(Boolean))).sort();
    const keepR = r => inSel(BF.wh, r.wh) && inSel(BF.zone, r.zone) && inSel(BF.grp, r.grp) && inSel(BF.uom, r.uom)
      && hit(BF.q, [r.bin, r.material, r.desc, r.batch]) && (!BF.to || String(r.date) <= BF.to);
    const by = {};
    led.filter(keepR).forEach(r => {
      const k = r.bin + '|' + r.uom, x = by[k] || (by[k] = { bin: r.bin, wh: r.wh, zone: r.zone, uom: r.uom, open: 0, qin: 0, qout: 0, moves: 0, last: '', mats: {} });
      const qi = Number(r.qtyIn) || 0, qo = Number(r.qtyOut) || 0;
      if (BF.from && String(r.date) < BF.from) { x.open += qi - qo; return; }
      x.qin += qi; x.qout += qo; x.moves++; x.mats[r.material] = 1;
      const w = (r.date || '') + ' ' + (r.time || ''); if (w > x.last) x.last = w;
    });
    const rows = Object.keys(by).map(k => by[k]).map(x => Object.assign(x, { open: round3(x.open), qin: round3(x.qin), qout: round3(x.qout), net: round3(x.qin - x.qout), bal: round3(x.open + x.qin - x.qout), nm: Object.keys(x.mats).length }))
      .filter(x => x.moves)   // only bins that moved in the dates (Kim, 26 Nov).sort((a, b) => b.moves - a.moves || a.bin.localeCompare(b.bin));
    const sumU = f => { const u = {}; rows.forEach(x => { u[x.uom] = (u[x.uom] || 0) + x[f]; });
      return Object.keys(u).sort().filter(k => u[k] || (f !== 'qin' && f !== 'qout')).map(k => `${f === 'qin' ? '+' : f === 'qout' ? '−' : ''}${fmtQty(round3(u[k]))} ${esc(k)}`).join('<br>') || '0'; };
    const tIn = rows.reduce((a, x) => a + x.qin, 0), tOut = rows.reduce((a, x) => a + x.qout, 0), tMv = rows.reduce((a, x) => a + x.moves, 0);
    const BFL = [['bwh', T('ឃ្លាំង', 'Warehouse'), 'wh', uq('wh')], ['bzone', T('តំបន់', 'Bin Zone'), 'zone', uq('zone')], ['bgrp', T('ក្រុមសម្ភារៈ', 'Material Group'), 'grp', uq('grp')], ['buom', 'UoM', 'uom', uq('uom')]];
    const qOn = (QD.find(q => q[2] === BF.from && q[3] === BF.to) || [''])[0];
    const H = [T('ទីតាំង', 'Bin'), T('ឃ្លាំង', 'Warehouse'), T('តំបន់', 'Bin Zone'), T('សម្ភារៈ', 'Materials'), T('ចលនា', 'Moves'), T('ដើមគ្រា', 'Opening'), T('ចូល', 'In'), T('ចេញ', 'Out'), T('សុទ្ធ', 'Net'), T('សមតុល្យ', 'Balance'), 'UoM', T('ចលនាចុងក្រោយ', 'Last move')];
    view(`
      <div class="fb-wrap">${FB.head('binsum', '🗂️ ' + T('សង្ខេបចលនាតាមទីតាំង', 'Bin movement summary'), (can('export') ? `<button type="button" class="fb-btn" id="exp">${FB.xl} Excel</button>` : '')
        + `<button type="button" class="fb-btn" data-tcopen>⚙️ ${T('ជួរឈរ', 'Columns')}</button>`, () => { Object.assign(BF, { from: mon, to: dAgo(0), wh: '', zone: '', grp: '', uom: '', q: '' }); binsum(); })}
      ${FB.panel('binsum', FB.seg(QD.map(q => [q[0], q[1]]), qOn, 'bqd') + FB.range('bFrom', 'bTo', BF.from, BF.to) + FB.show('bGo')
        + BFL.map(f => msel(f[0], f[1], f[3].map(v => [v, v]), BF[f[2]])).join('')
        + FB.search('bq', T('ស្វែងរក ទីតាំង ឬសម្ភារៈ', 'Search bin or material'), BF.q))}</div>
      <div class="sumline"><b>${new Set(rows.map(x => x.bin)).size}</b> ${T('ទីតាំង', 'bins')} · <b>${tMv}</b> ${T('ចលនា', 'moves')} · ${T('ចូល', 'In')} <b class="in">+${fmtQty(round3(tIn))}</b> · ${T('ចេញ', 'Out')} <b class="out">−${fmtQty(round3(tOut))}</b></div>
      <section class="screp"><table class="rep bstbl"><thead><tr>${H.map((h, i) => `<th${i >= 3 && i <= 9 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>
        ${rows.map(x => `<tr class="go" data-bin="${esc(x.bin)}"><td class="mono">${esc(x.bin)}</td><td>${esc(x.wh)}</td><td>${esc(x.zone)}</td><td class="num">${x.nm}</td><td class="num">${x.moves}</td>
          <td class="num mono">${fmtQty(x.open)}</td><td class="num mono in">${x.qin ? '+' + fmtQty(x.qin) : ''}</td><td class="num mono out">${x.qout ? '−' + fmtQty(x.qout) : ''}</td>
          <td class="num mono ${x.net < 0 ? 'out' : x.net > 0 ? 'in' : ''}">${x.net > 0 ? '+' : ''}${fmtQty(x.net)}</td><td class="num mono"><b>${fmtQty(x.bal)}</b></td><td>${esc(x.uom)}</td><td>${esc(x.last.trim())}</td></tr>`).join('')
          || `<tr><td class="muted" colspan="12">${T('រកមិនឃើញ', 'Nothing found')}</td></tr>`}</tbody>
        <tfoot><tr class="gtot"><th>${T('សរុបរួម', 'Grand total')}</th><th></th><th></th><th></th><th class="num">${tMv}</th><th class="num mono">${sumU('open')}</th><th class="num mono">${sumU('qin')}</th><th class="num mono">${sumU('qout')}</th><th class="num mono">${sumU('net')}</th><th class="num mono">${sumU('bal')}</th><th></th><th></th></tr></tfoot></table></section>
      ${oldNote()}<p class="muted">${T('សមតុល្យ = ដើមគ្រា (មុនថ្ងៃចាប់ផ្តើម) + ចូល − ចេញ។ ចុចលើជួរ ដើម្បីបើកទីតាំង។', 'Balance = Opening (before the From date) + In − Out. Tap a row to open the bin.')}</p>`);
    setTimeout(fitRep, 0);
    keep('#bq', v => { BF.q = v; binsum(); });
    BFL.forEach(f => mselWire(f[0], v => { BF[f[2]] = v; binsum(); }));
    $$('[data-bqd]').forEach(bn => { bn.onclick = () => { const q = QD.find(x => x[0] === bn.dataset.bqd); BF.from = q[2]; BF.to = q[3]; binsum(); }; });
    $('#bGo').onclick = () => { BF.from = $('#bFrom').value; BF.to = $('#bTo').value; binsum(); };
    $('#bFrom').onchange = $('#bTo').onchange = () => { BF.from = $('#bFrom').value; BF.to = $('#bTo').value; binsum(); };
    $$('tr.go').forEach(tr => { tr.onclick = () => openBin(tr.dataset.bin); });
    if ($('#exp')) $('#exp').onclick = () => download('bin-movement-summary.csv', [['Bin', 'Warehouse', 'Bin Zone', 'Materials', 'Moves', 'Opening', 'In', 'Out', 'Net', 'Balance', 'UoM', 'Last move', 'From', 'To']]
      .concat(rows.map(x => [x.bin, x.wh, x.zone, x.nm, x.moves, x.open, x.qin, x.qout, x.net, x.bal, x.uom, x.last.trim(), BF.from, BF.to])));
  }

  // ------------------------------------------------------------------ SAP variance log (Kim, 27 Nov 2026: Reason + Save variance + Variance history)
  // One case per variance line (Variance Log tab). Saving the same SAP file again updates it; a case closes when the next saved file matches.
  const RSN = [['Delivery not posted in SAP', 'ការដឹកចេញមិនទាន់ post ក្នុង SAP'], ['GR not posted in SAP', 'ការទទួលមិនទាន់ post ក្នុង SAP'],
    ['Not received in app', 'មិនទាន់ទទួលក្នុងកម្មវិធី'], ['Not issued in app', 'មិនទាន់ចេញក្នុងកម្មវិធី'], ['Wrong batch', 'Batch ខុស'], ['Wrong bin / SLoc', 'ទីតាំង / SLoc ខុស'],
    ['UoM / conversion', 'ខ្នាតខុស (UoM)'], ['Count error', 'រាប់ខុស'], ['Damage / scrap', 'ខូចខាត / សំណល់'], ['Transfer in transit', 'កំពុងផ្ទេរ'], ['Other', 'ផ្សេងៗ']];
  const ACTS = [['SAP adjustment', 'កែតម្រូវក្នុង SAP'], ['Digital adjustment', 'កែតម្រូវកាតស្តុក'], ['Recount', 'រាប់ឡើងវិញ'], ['Post missing document', 'Post ឯកសារដែលខ្វះ'], ['No action', 'មិនចាំបាច់'], ['Matched in SAP', 'ត្រូវគ្នាក្នុង SAP']];
  const VST = [['Open', 'បើក'], ['Investigating', 'កំពុងពិនិត្យ'], ['Resolved', 'បានដោះស្រាយ']];
  const lbl = (L, v) => { const x = L.find(a => a[0] === v); return x ? T(x[1], x[0]) : v; };
  const VR = { cases: [], snaps: [], at: 0, busy: false, err: '' };
  if (DEMO) D.vlog = D.vlog || { cases: [], snaps: [] };
  function loadVar(again, force) {
    if (DEMO) { VR.cases = D.vlog.cases; VR.snaps = D.vlog.snaps; VR.at = Date.now(); return; }
    if (VR.busy || (!force && Date.now() - VR.at < 60000)) return;
    VR.busy = true;
    SC.api('varList', {}).then(r => { VR.cases = r.cases || []; VR.snaps = r.snaps || []; VR.err = ''; }, e => { VR.err = String(e && e.message || e); })
      .then(() => { VR.busy = false; VR.at = Date.now(); if (S.view === again) route(); });
  }
  const RS = {};   // reason / remark typed on the SAP check, by line key, until saved
  const openCase = (lv, key) => VR.cases.find(c => c.Key === lv + ':' + key && !/^resolved/i.test(c.Status));
  const nowStamp = () => { const d = new Date(), p = n => ('0' + n).slice(-2); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  // Demo only: the same rules as varSave_ / varUpdate_ in Code.gs, on the in-memory log.
  function demoVarSave(p) {
    const st = D.vlog, by = 'Demo', now = nowStamp(), sid = 'VS-' + p.file + '|' + p.at;
    const s0 = st.snaps.find(s => s['Snapshot ID'] === sid), srow = { 'Snapshot ID': sid, 'Saved At': now, File: p.file, Snapshot: p.at, 'Compared By': p.level, Lines: String(p.lines), Match: String(p.match), Variances: String(p.rows.length), 'Saved By': by };
    if (s0) Object.assign(s0, srow); else st.snaps.push(srow);
    const out = { added: 0, updated: 0, closed: 0 };
    p.rows.forEach(r => {
      const key = p.level + ':' + r.key, vals = { Bin: r.bin || '', Material: r.material, Batch: r.batch || '', SLOC: r.sloc || '', Description: r.desc, UoM: r.uom, Digital: r.digital == null ? '' : String(r.digital), SAP: r.sap == null ? '' : String(r.sap), Variance: String(r.variance), Result: r.status, 'Last Seen': p.at };
      if (r.reason) vals.Reason = r.reason; if (r.remark) vals.Remark = r.remark;
      let c = st.cases.find(x => x.Key === key && !/^resolved/i.test(x.Status));
      if (c) { if (c['Last Snapshot'] !== sid) c.Times = String(Number(c.Times || 1) + 1); Object.assign(c, vals, { 'Last Snapshot': sid }); out.updated++; }
      else { st.cases.push(Object.assign({ 'Case ID': 'VC-' + (st.cases.length + 1), 'First Seen': p.at, Times: '1', Key: key, Reason: '', Remark: '', Owner: '', Status: 'Open', Action: '', 'Resolved At': '' }, vals, { 'Last Snapshot': sid })); out.added++; }
    });
    st.cases.forEach(c => { if (!/^resolved/i.test(c.Status) && p.matched.indexOf(c.Key.slice(p.level.length + 1)) >= 0 && c.Key.indexOf(p.level + ':') === 0) { c.Status = 'Resolved'; c.Action = c.Action || 'Matched in SAP'; c['Resolved At'] = now; out.closed++; } });
    return out;
  }
  function demoVarUpdate(p) {
    const c = D.vlog.cases.find(x => x['Case ID'] === p.id);
    ['reason', 'remark', 'owner', 'action'].forEach(k => { if (p[k] != null) c[k[0].toUpperCase() + k.slice(1)] = p[k]; });
    if (p.status) { if (p.status === 'Resolved' && !c.Action) throw new Error('BAD: Choose the action before you resolve it. || សូមជ្រើសសកម្មភាព មុនបិទ។'); c['Resolved At'] = p.status === 'Resolved' ? (c['Resolved At'] || nowStamp()) : ''; c.Status = p.status; }
    return { case: c };
  }
  const errText = e => { const m = String(e && e.message || e).replace(/^[A-Z_]+:\s*/, '').split(' || '); return T(m[1] || m[0], m[0]); };
  async function saveVariance(res, lv) {
    const vars = res.list.filter(x => x.status !== 'match');
    const p = { file: R.name, at: R.at, level: lv, lines: res.list.length, match: res.list.length - vars.length, matched: res.list.filter(x => x.status === 'match').map(x => x.key),
      rows: vars.map(x => { const c = openCase(lv, x.key) || {}, rs = RS[x.key] || {};
        return { key: x.key, bin: x.o.bin || '', material: x.o.material, batch: x.o.batch || '', sloc: x.o.sloc || '', desc: x.desc, uom: x.uom, digital: x.digital, sap: x.sap, variance: x.variance, status: x.status,
          reason: rs.reason != null ? rs.reason : c.Reason || '', remark: rs.remark != null ? rs.remark : c.Remark || '' }; }) };
    const b = $('#varSave'); if (b) { b.disabled = true; b.textContent = T('កំពុងរក្សាទុក…', 'Saving…'); }
    try {
      const r = DEMO ? demoVarSave(p) : await SC.api('varSave', p);
      Object.keys(RS).forEach(k => { delete RS[k]; });
      toast(T(`បានរក្សាទុក៖ ថ្មី ${r.added} · កែ ${r.updated} · បិទ ${r.closed}`, `Saved: ${r.added} new · ${r.updated} updated · ${r.closed} closed`));
      VR.at = 0; loadVar('sap', true);
    } catch (e) { toast(errText(e)); }
    if (S.view === 'sap') sap();
  }

  // Variance history menu (Kim picked mockup 2, 27 Nov): open cases, owner, age, times seen, status and action; match rate per saved file.
  const VF = { st: 'open', rsn: '', own: '', q: '' };
  function varhist() {
    wide(); loadVar('varhist');
    const all = VR.cases.slice().reverse();
    const ageOf = c => (/^resolved/i.test(c.Status) ? null : daysAgo(c['First Seen']));
    const rows = all.filter(c => (VF.st === 'all' || (VF.st === 'open' ? !/^resolved/i.test(c.Status) : /^resolved/i.test(c.Status))) && (!VF.rsn || (VF.rsn === '-' ? !c.Reason : c.Reason === VF.rsn))
      && (!VF.own || c.Owner === VF.own) && hit(VF.q, [c.Material, c.Batch, c.Bin, c.Description, c.Remark, c['Case ID']]));
    const open = all.filter(c => !/^resolved/i.test(c.Status));
    const mon = dAgo(0).slice(0, 7);
    const snaps = VR.snaps.slice(-8), rate = s => (Number(s.Lines) ? Math.round(Number(s.Match) / Number(s.Lines) * 1000) / 10 : 0);
    const last = snaps[snaps.length - 1];
    const rc = {}; all.forEach(c => { if (c.Reason) rc[c.Reason] = (rc[c.Reason] || 0) + 1; });
    const rTot = Object.keys(rc).reduce((a, k) => a + rc[k], 0), rTop = Object.keys(rc).sort((a, b) => rc[b] - rc[a]).slice(0, 6);
    const owners = Array.from(new Set(all.map(c => c.Owner).filter(Boolean))).sort();
    const opt = (L, v) => L.map(o => `<option value="${esc(o[0])}"${o[0] === v ? ' selected' : ''}>${esc(o[1])}</option>`).join('');
    view(`
      <div class="fb-wrap">${FB.head('varhist', '📉 ' + T('ប្រវត្តិខុសគ្នា SAP', 'Variance history'), (can('export') ? `<button type="button" class="fb-btn" id="exp">${FB.xl} Excel</button>` : '') + `<button type="button" class="fb-btn" data-tcopen>⚙️ ${T('ជួរឈរ', 'Columns')}</button>`,
        () => { Object.assign(VF, { st: 'open', rsn: '', own: '', q: '' }); varhist(); })}
      ${FB.panel('varhist', FB.field(T('ស្ថានភាព', 'Status'), `<select id="vst">${opt([['open', T('មិនទាន់បិទ', 'Open')], ['done', T('បានដោះស្រាយ', 'Resolved')], ['all', T('ទាំងអស់', 'All')]], VF.st)}</select>`)
        + FB.field(T('មូលហេតុ', 'Reason'), `<select id="vrsn">${opt([['', T('ទាំងអស់', 'All')], ['-', T('មិនទាន់មានមូលហេតុ', 'No reason yet')]].concat(RSN.map(r => [r[0], T(r[1], r[0])])), VF.rsn)}</select>`)
        + FB.field(T('អ្នកទទួលខុសត្រូវ', 'Owner'), `<select id="vown">${opt([['', T('ទាំងអស់', 'All')]].concat(owners.map(o => [o, o])), VF.own)}</select>`)
        + FB.search('vq', T('ស្វែងរក សម្ភារៈ Batch', 'Search material, batch'), VF.q))}</div>
      ${VR.err ? `<p class="bad">⚠️ ${esc(errText(VR.err))} · ${T('សូម paste Code.gs ថ្មី', 'Re-paste Code.gs')}</p>` : ''}
      <div class="dash-kpis">
        <div class="stat"><b>${last ? rate(last) + '%' : '—'}</b><span>${T('អត្រាត្រូវគ្នា ឯកសារចុងក្រោយ', 'Match rate, last SAP file')}</span></div>
        <div class="stat ${open.length ? 'out' : ''}"><b>${open.length}</b><span>${T('មិនទាន់បិទ', 'Open variances')}</span></div>
        <div class="stat warn"><b>${open.filter(c => daysAgo(c['First Seen']) > 7).length}</b><span>${T('បើកលើស ៧ ថ្ងៃ', 'Open more than 7 days')}</span></div>
        <div class="stat"><b>${open.filter(c => Number(c.Times) >= 3).length}</b><span>${T('កើតឡើងដដែល (៣ ដង+)', 'Repeat items (3+ files)')}</span></div>
        <div class="stat in"><b>${all.filter(c => /^resolved/i.test(c.Status) && String(c['Resolved At']).slice(0, 7) === mon).length}</b><span>${T('បានដោះស្រាយខែនេះ', 'Resolved this month')}</span></div>
      </div>
      <div class="vgrid"><section class="card"><h3>${T('អត្រាត្រូវគ្នា តាមឯកសារ SAP', 'Match rate per saved SAP file')}</h3>
        ${snaps.length ? `<div class="chart">${snaps.map(s => `<div class="cday"><div class="cbars"><i class="bi" style="height:${rate(s)}%;width:60%;max-width:40px;background:#2563eb"><em>${rate(s)}%</em></i></div><span>${esc(String(s.Snapshot).slice(5, 10))}</span></div>`).join('')}</div>` : `<p class="muted">${T('មិនទាន់មានការរក្សាទុក', 'Nothing saved yet. Use 💾 Save variance on the SAP check.')}</p>`}</section>
        <section class="card"><h3>${T('មូលហេតុច្រើនបំផុត', 'Top reasons')}</h3>${rTop.map(k => `<div class="hbar"><span>${esc(lbl(RSN, k))}</span><i style="width:${Math.round(rc[k] / rTot * 100)}%"></i><b>${Math.round(rc[k] / rTot * 100)}%</b></div>`).join('') || `<p class="muted">—</p>`}</section></div>
      <section class="screp"><table class="rep vtbl"><thead><tr><th>${T('លើកដំបូង', 'First seen')}</th><th>${T('ទីតាំង', 'Bin')}</th><th>${T('សម្ភារៈ', 'Material')}</th><th>Batch</th><th>${T('បរិយាយ', 'Description')}</th><th class="num">${T('ខុសគ្នា', 'Variance')}</th><th>UoM</th><th>${T('មូលហេតុ', 'Reason')}</th><th>${T('កំណត់សម្គាល់', 'Remark')}</th><th>${T('អ្នកទទួលខុសត្រូវ', 'Owner')}</th><th class="num">${T('រយៈពេល', 'Age')}</th><th class="num">${T('ចំនួនដង', 'Times')}</th><th>${T('ស្ថានភាព', 'Status')}</th><th>${T('សកម្មភាព', 'Action')}</th></tr></thead><tbody>
        ${rows.map(c => { const v = Number(c.Variance) || 0, age = ageOf(c), id = esc(c['Case ID']);
          return `<tr><td>${esc(String(c['First Seen']).slice(0, 10))}</td><td class="mono">${esc(c.Bin)}</td><td class="mono">${esc(c.Material)}</td><td class="mono">${esc(c.Batch)}</td><td>${esc(c.Description)}</td>
          <td class="num mono ${v < 0 ? 'out' : v > 0 ? 'in' : ''}"><b>${v > 0 ? '+' : ''}${fmtQty(v)}</b></td><td>${esc(c.UoM)}</td>
          <td><select class="cell${c.Reason ? '' : ' need'}" data-vid="${id}" data-f="reason"><option value="">${T('ជ្រើសមូលហេតុ', 'Choose reason')}</option>${RSN.map(r => `<option value="${esc(r[0])}"${r[0] === c.Reason ? ' selected' : ''}>${esc(T(r[1], r[0]))}</option>`).join('')}</select></td>
          <td><input class="cell" data-vid="${id}" data-f="remark" value="${esc(c.Remark)}" placeholder="${T('កំណត់សម្គាល់…', 'Remark…')}"></td>
          <td><input class="cell sm" data-vid="${id}" data-f="owner" value="${esc(c.Owner)}" placeholder="${T('ឈ្មោះ', 'Name')}"></td>
          <td class="num ${age > 7 ? 'out' : ''}">${age == null ? '—' : age + ' ' + T('ថ្ងៃ', 'd')}</td><td class="num">${esc(c.Times)}</td>
          <td><select class="cell st-${String(c.Status).toLowerCase()}" data-vid="${id}" data-f="status">${VST.map(s => `<option value="${s[0]}"${s[0] === c.Status ? ' selected' : ''}>${esc(T(s[1], s[0]))}</option>`).join('')}</select></td>
          <td><select class="cell" data-vid="${id}" data-f="action"><option value="">—</option>${ACTS.map(a => `<option value="${esc(a[0])}"${a[0] === c.Action ? ' selected' : ''}>${esc(T(a[1], a[0]))}</option>`).join('')}</select></td></tr>`; }).join('')
          || `<tr><td class="muted" colspan="14">${VR.busy ? T('កំពុងផ្ទុក…', 'Loading…') : T('រកមិនឃើញ', 'Nothing found')}</td></tr>`}</tbody></table></section>
      <p class="muted">${T('ខុសគ្នានីមួយៗ នៅបើករហូតដល់ជ្រើសសកម្មភាព ហើយដាក់ "បានដោះស្រាយ"។ វាបិទដោយខ្លួនឯង ពេលឯកសារ SAP បន្ទាប់ត្រូវគ្នា។',
        'A variance stays open until you pick the action and set it to Resolved. It closes by itself when the next saved SAP file matches.')}</p>`);
    setTimeout(fitRep, 0);
    keep('#vq', v => { VF.q = v; varhist(); });
    [['vst', 'st'], ['vrsn', 'rsn'], ['vown', 'own']].forEach(f => { $('#' + f[0]).onchange = e => { VF[f[1]] = e.target.value; varhist(); }; });
    $$('[data-vid]').forEach(el => { el.onchange = async () => {
      const p = { id: el.dataset.vid }; p[el.dataset.f] = el.value;
      try { const r = DEMO ? demoVarUpdate(p) : await SC.api('varUpdate', p); const i = VR.cases.findIndex(c => c['Case ID'] === p.id); if (i >= 0) VR.cases[i] = Object.assign(VR.cases[i], r.case); toast(T('បានរក្សាទុក', 'Saved')); }
      catch (e) { toast(errText(e)); }
      varhist(); }; });
    if ($('#exp')) $('#exp').onclick = () => download('variance-history.csv', [['Case ID', 'First Seen', 'Last Seen', 'Bin', 'Material', 'Batch', 'Description', 'Digital', 'SAP', 'Variance', 'UoM', 'Reason', 'Remark', 'Owner', 'Times', 'Status', 'Action', 'Resolved At']]
      .concat(rows.map(c => [c['Case ID'], c['First Seen'], c['Last Seen'], c.Bin, c.Material, c.Batch, c.Description, c.Digital, c.SAP, c.Variance, c.UoM, c.Reason, c.Remark, c.Owner, c.Times, c.Status, c.Action, c['Resolved At']])));
  }

  // ------------------------------------------------------------------ MB51 compare (Kim picked the mockup, 27 Nov 2026)
  // Movements › ⇄ MB51: upload the SAP MB51 export; app IN/OUT lines are matched on Reference (= MB51 Reference, Material Document,
  // Purchase order or Order) + Material + Batch. Only the MB51 date range and the SLocs the app knows are compared. Browser only.
  const MB = { name: '', rows: null, err: '', F: { res: [], note: [], mvt: [], wh: [], grp: [], sloc: [], q: '' } };
  const nref = v => String(v == null ? '' : v).trim().toUpperCase().replace(/^0+(?=\d)/, '');
  const ndate = v => {
    if (v instanceof Date && !isNaN(v)) { const d = new Date(v.getTime() + 12 * 3600000); return `${d.getFullYear()}-${('0' + (d.getMonth() + 1)).slice(-2)}-${('0' + d.getDate()).slice(-2)}`; }
    const s = String(v == null ? '' : v).trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${('0' + m[2]).slice(-2)}-${('0' + m[3]).slice(-2)}`;
    if ((m = s.match(/^(\d{1,2})([./-])(\d{1,2})[./-](\d{2,4})/))) { const y = m[4].length === 2 ? '20' + m[4] : m[4], us = m[2] === '/' && Number(m[3]) > 12 || (m[2] === '/' && Number(m[1]) <= 12);
      const dd = us ? m[3] : m[1], mm = us ? m[1] : m[3]; return `${y}-${('0' + mm).slice(-2)}-${('0' + dd).slice(-2)}`; }   // SAP dd.mm.yyyy; Excel m/d/yyyy
    return s.slice(0, 10);
  };
  function loadMb51(name, grid) {
    MB.err = ''; MB.rows = null; MB.name = name;
    let hr = grid.findIndex(r => r.some(c => /^material$/i.test(String(c).trim())) && r.some(c => /quantity|qty/i.test(String(c))));
    if (hr < 0) { MB.err = T('រកមិនឃើញជួរឈរ Material និង Quantity', 'Columns Material and Quantity not found. Is this an MB51 export?'); return moves(); }
    const H = grid[hr].map(h => String(h).trim()), col = (...res) => { for (const re of res) { const i = H.findIndex(h => re.test(h)); if (i >= 0) return i; } return -1; };
    const c = { mat: col(/^material$/i), batch: col(/^batch$/i), ref: col(/^reference$/i), doc: col(/^material document$/i), po: col(/^purchase order$/i), ord: col(/^order$/i),
      mvt: col(/^movement type$/i, /^mvt/i), date: col(/^posting date$/i), sloc: col(/^storage location$/i, /^sloc$/i), qty: col(/^quantity$/i, /^qty in unit of entry$/i, /quantity|qty/i),
      uom: col(/^base unit of measure$/i, /^unit of entry$/i, /uom|unit/i), desc: col(/^material description$/i, /desc/i), time: col(/^time of entry$/i), user: col(/^user name$/i), text: col(/^movement type text$/i), cust: col(/^name 1$/i), plant: col(/^plant$/i) };
    MB.rows = grid.slice(hr + 1).map((r, i) => {
      const g = k => (c[k] < 0 || r[c[k]] == null ? '' : r[c[k]] instanceof Date ? (k === 'date' ? ndate(r[c[k]]) : r[c[k]].toTimeString().slice(0, 8)) : String(r[c[k]]).trim());
      const q = Number(g('qty').replace(/,/g, '').replace(/^(.*)-$/, '-$1'));   // SAP shows 120- for negative
      return { i: i, mat: g('mat'), batch: g('batch'), ref: g('ref'), doc: g('doc'), po: g('po'), ord: g('ord'), mvt: g('mvt'), date: ndate(g('date')), sloc: g('sloc'), qty: isFinite(q) ? q : 0, uom: g('uom').toUpperCase(), desc: g('desc'), time: g('time'), user: g('user'), text: g('text'), cust: g('cust'), plant: g('plant') };
    }).filter(r => r.mat);
    moves();
  }
  function mbCompare() {
    const known = new Set(D.stock.map(l => String(l.sloc)).concat(D.ledger.map(r => String(r.sloc))).filter(Boolean));
    const fileSloc = new Set(MB.rows.map(r => r.sloc).filter(Boolean));
    const keepSloc = s => !known.size || !s || known.has(String(s));
    const sap = MB.rows.filter(r => keepSloc(r.sloc));
    const dates = sap.map(r => r.date).filter(Boolean).sort(), from = dates[0] || '', to = dates[dates.length - 1] || '';
    const app = D.ledger.filter(r => (r.type === 'IN' || r.type === 'OUT') && (!from || String(r.date) >= from) && (!to || String(r.date) <= to) && (!fileSloc.size || !r.sloc || fileSloc.has(String(r.sloc))));
    // App side: one group per Reference + Material + Batch.
    const ag = {};
    app.forEach(r => { const k = [nref(r.reference), nref(r.material), nref(r.batch)].join('|');
      const g = ag[k] || (ag[k] = { ref: String(r.reference || ''), material: r.material, batch: r.batch, desc: r.desc, uom: String(r.uom || '').toUpperCase(), bins: new Set(), sloc: r.sloc, when: '', qty: 0, n: 0, ar: [] });
      g.ar.push(r);
      g.qty = round3(g.qty + (Number(r.qtyIn) || 0) - (Number(r.qtyOut) || 0)); g.n++; if (r.bin) g.bins.add(r.bin);
      const w = (r.date || '') + ' ' + (r.time || ''); if (!g.when || w < g.when) g.when = w; });
    // SAP side index: every reference-like value of a line + material (+ batch).
    const ix = {}, ixm = {}, add = (o, k, i) => { (o[k] = o[k] || []).push(i); };
    sap.forEach((r, i) => { new Set([r.ref, r.doc, r.po, r.ord].map(nref).filter(Boolean)).forEach(v => { add(ix, [v, nref(r.mat), nref(r.batch)].join('|'), i); add(ixm, v + '|' + nref(r.mat), i); }); });
    const used = new Set(), out = [];
    const sapInfo = ids => { const L = ids.map(i => sap[i]); return { sapQty: round3(L.reduce((a, r) => a + r.qty, 0)), post: Array.from(new Set(L.map(r => r.date))).sort().join(', '), doc: Array.from(new Set(L.map(r => r.doc).filter(Boolean))).join(', '),
      mvt: Array.from(new Set(L.map(r => r.mvt).filter(Boolean))).sort().join(', '), sbatch: Array.from(new Set(L.map(r => r.batch))).join(', ') }; };
    Object.keys(ag).forEach(k => {
      const g = ag[k], r0 = nref(g.ref), m0 = nref(g.material);
      let ids = r0 ? (ix[[r0, m0, nref(g.batch)].join('|')] || []).filter(i => !used.has(i)) : [], batchOk = true;
      if (!ids.length && r0) { ids = (ixm[r0 + '|' + m0] || []).filter(i => !used.has(i)); batchOk = false; }
      const base = { when: g.when, ref: g.ref, material: g.material, batch: g.batch, desc: g.desc, uom: g.uom, bin: Array.from(g.bins).join(', '), sloc: g.sloc, appQty: g.qty, ar: g.ar, sl: [] };
      if (!ids.length) { out.push(Object.assign(base, { sapQty: null, post: '', doc: '', mvt: '', diff: g.qty, res: 'app' })); return; }
      ids.forEach(i => used.add(i));
      const s = sapInfo(ids), diff = round3(g.qty - s.sapQty);
      out.push(Object.assign(base, s, { sl: ids.map(i => sap[i]), uom: g.uom || sap[ids[0]].uom, diff: diff, res: diff ? 'qty' : 'ok', note: batchOk ? '' : 'batch', sbatch: batchOk ? '' : s.sbatch }));
    });
    const rest = {};
    sap.forEach((r, i) => { if (used.has(i)) return; const k = [nref(r.ref || r.doc), nref(r.mat), nref(r.batch)].join('|'); (rest[k] = rest[k] || []).push(i); });
    Object.keys(rest).forEach(k => { const L = rest[k].map(i => sap[i]), s = sapInfo(rest[k]);
      const st = D.stock.find(l => nref(l.material) === nref(L[0].mat) && nref(l.batch) === nref(L[0].batch)) || D.stock.find(l => nref(l.material) === nref(L[0].mat));
      out.push(Object.assign(s, { ar: [], sl: L, when: '', ref: L[0].ref || L[0].doc, material: L[0].mat, batch: L[0].batch, desc: L[0].desc || (st && st.desc) || '', uom: L[0].uom, bin: '', sloc: L[0].sloc, appQty: null, diff: round3(-s.sapQty), res: 'sap' })); });
    out.forEach(x => { x.wh = x.bin ? whOf(x.bin.split(', ')[0]) : ''; x.grp = groupOf({ material: x.material, desc: x.desc }); });
    const ord = { qty: 0, sap: 1, app: 2, ok: 3 };
    out.sort((a, b) => ord[a.res] - ord[b.res] || Math.abs(b.diff || 0) - Math.abs(a.diff || 0));
    return { list: out, from: from, to: to, nApp: app.length, nSap: sap.length, slocs: Array.from(fileSloc).filter(keepSloc).sort(), skipped: MB.rows.length - sap.length };
  }
  const MBR = { ok: ['ត្រូវគ្នា', 'Matched', 'st-match'], qty: ['ចំនួនខុស', 'Qty different', 'st-var'], sap: ['មានតែក្នុង SAP', 'Only in SAP', 'st-sap'], app: ['មានតែក្នុងកម្មវិធី', 'Only in app', 'st-digital'] };
  // Row detail (Kim, 27 Nov: "click row to see the detail of transaction"): every app movement and every MB51 line behind the row.
  function mbDetail(x) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg mbsheet-bg';
    const q = v => `<span class="${v < 0 ? 'out' : v > 0 ? 'in' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtQty(Math.abs(v))}</span>`;
    const appQ = r => (Number(r.qtyIn) || 0) - (Number(r.qtyOut) || 0);
    bg.innerHTML = `<div class="sheet mbsheet" role="dialog" aria-modal="true" data-nocols><div class="sheet-top"><b>${esc(x.material)} · ${esc(x.desc)}</b><button type="button" class="icon-btn dark" data-close aria-label="Close">✕</button></div>
      <p class="muted">${T('ឯកសារយោង', 'Reference')} <b>${esc(x.ref || '—')}</b> · Batch <b>${esc(x.batch)}</b> · <span class="st ${MBR[x.res][2]}">${T(MBR[x.res][0], MBR[x.res][1])}</span>${x.note ? ` <span class="st st-var">${T('Batch ខុស', 'Batch different')} (MB51 ${esc(x.sbatch)})</span>` : ''}
        · ${T('កម្មវិធី', 'App')} <b>${x.appQty == null ? '—' : q(x.appQty)}</b> · MB51 <b>${x.sapQty == null ? '—' : q(x.sapQty)}</b> · ${T('ខុសគ្នា', 'Diff')} <b>${x.diff ? q(x.diff) : '0'}</b> ${esc(x.uom)}</p>
      <h4>📱 ${T('ចលនាក្នុងកម្មវិធី', 'App movements')} (${x.ar.length})</h4>
      ${x.ar.length ? `<div class="scroll"><table class="rep"><thead><tr><th>${T('ថ្ងៃ', 'Date')}</th><th>${T('ម៉ោង', 'Time')}</th><th>${T('លេខ', 'Txn ID')}</th><th>${T('ប្រភេទ', 'Type')}</th><th>${T('ទីតាំង', 'Bin')}</th><th>Batch</th><th>SLoc</th><th class="num">${T('ចំនួន', 'Qty')}</th><th>UoM</th><th>${T('ឯកសារយោង', 'Reference')}</th><th>${T('អ្នកប្រើ', 'User')}</th><th>${T('កំណត់សម្គាល់', 'Remark')}</th></tr></thead><tbody>
        ${x.ar.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td class="mono">${esc(r.id)}</td><td>${esc(tLabel(r.type))}</td><td class="mono">${esc(r.bin)}</td><td class="mono">${esc(r.batch)}</td><td>${esc(r.sloc)}</td><td class="num mono">${q(appQ(r))}</td><td>${esc(r.uom)}</td><td class="mono">${esc(r.reference)}</td><td>${esc(String(r.user || '').split('@')[0])}</td><td>${esc(r.remark || '')}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="bad">${T('មិនមានក្នុងកម្មវិធី៖ គ្មាននរណាស្កេនចលនានេះទេ។', 'Not in the app: nobody scanned this movement.')}</p>`}
      <h4>🧾 MB51 (${x.sl.length})</h4>
      ${x.sl.length ? `<div class="scroll"><table class="rep"><thead><tr><th>${T('ថ្ងៃ Post', 'Posting date')}</th><th>${T('ម៉ោង', 'Time')}</th><th>Mat. doc</th><th>Mvt</th><th>${T('ប្រភេទ', 'Text')}</th><th>Batch</th><th>Plant</th><th>SLoc</th><th class="num">${T('ចំនួន', 'Qty')}</th><th>UoM</th><th>Reference</th><th>PO / Order</th><th>${T('អតិថិជន / អ្នកផ្គត់ផ្គង់', 'Customer / supplier')}</th><th>${T('អ្នកប្រើ SAP', 'SAP user')}</th></tr></thead><tbody>
        ${x.sl.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.time)}</td><td class="mono">${esc(r.doc)}</td><td>${esc(r.mvt)}</td><td>${esc(r.text)}</td><td class="mono">${esc(r.batch)}</td><td>${esc(r.plant)}</td><td>${esc(r.sloc)}</td><td class="num mono">${q(r.qty)}</td><td>${esc(r.uom)}</td><td class="mono">${esc(r.ref)}</td><td class="mono">${esc(r.po || r.ord)}</td><td>${esc(r.cust)}</td><td>${esc(r.user)}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="bad">${T('មិនមានក្នុង MB51៖ មិនទាន់ post ក្នុង SAP (ឬឯកសារយោងខុស)។', 'Not in MB51: not posted in SAP yet (or the reference is different).')}</p>`}</div>`;
    const onKey = e => { if (e.key === 'Escape') shut(); };
    const shut = () => { bg.parentNode && bg.parentNode.removeChild(bg); document.removeEventListener('keydown', onKey); };
    bg.onclick = e => { if (e.target === bg || e.target.closest('[data-close]')) shut(); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
  }
  function mb51View() {
    loadLedger('moves');
    const F = MB.F, res = MB.rows ? mbCompare() : null;
    const L = res ? res.list : [];
    const uq = f => Array.from(new Set(L.flatMap(x => String(x[f] || '').split(', ')).filter(Boolean))).sort();
    const rows = L.filter(x => inSel(F.res, x.res) && inSel(F.note, x.note || '-') && (!F.mvt.length || String(x.mvt).split(', ').some(m => F.mvt.indexOf(m) >= 0)) && inSel(F.wh, x.wh) && inSel(F.grp, x.grp) && inSel(F.sloc, x.sloc)
      && hit(F.q, [x.ref, x.doc, x.material, x.desc, x.batch, x.bin]));
    const cnt = k => L.filter(x => x.res === k).length;
    const sumU = f => { const u = {}; rows.forEach(x => { if (x[f] == null) return; u[x.uom] = (u[x.uom] || 0) + Number(x[f]); }); return Object.keys(u).sort().map(k => `${fmtQty(round3(u[k]))} ${esc(k)}`).join('<br>') || '0'; };
    const sq = v => (v == null ? '—' : `<span class="${v < 0 ? 'out' : v > 0 ? 'in' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtQty(Math.abs(v))}</span>`);
    const FL = [['mbres', T('លទ្ធផល', 'Result'), 'res', Object.keys(MBR).map(k => [k, T(MBR[k][0], MBR[k][1])])], ['mbmvt', T('ប្រភេទចលនា', 'Movement type'), 'mvt', uq('mvt').map(v => [v, v])],
      ['mbnote', T('កំណត់សម្គាល់', 'Remark'), 'note', [['batch', T('Batch ខុស', 'Batch different')], ['-', T('គ្មាន', 'None')]]], ['mbwh', T('ឃ្លាំង', 'Warehouse'), 'wh', uq('wh').map(v => [v, v])], ['mbgrp', T('ក្រុមសម្ភារៈ', 'Material Group'), 'grp', uq('grp').map(v => [v, v])], ['mbsloc', 'SLoc', 'sloc', uq('sloc').map(v => [v, v])]];
    view(`
      <div class="fb-wrap">${repHead('moves', '🔄 ' + T('ចលនាស្តុក (សៀវភៅប្រតិបត្តិការ)', 'Movements (stock ledger)'), res && can('export') ? `<button type="button" class="fb-btn" id="exp">${FB.xl} Excel</button>` : '',
        () => { Object.assign(F, { res: [], note: [], mvt: [], wh: [], grp: [], sloc: [], q: '' }); moves(); })}
      <section class="card mbfile"><label class="btn sm file">⬆ ${T('នាំចូល MB51 (Excel ឬ CSV)', 'Upload MB51 (Excel / CSV)')}<input type="file" id="mbFile" accept=".csv,.txt,.xlsx,.xlsm,.xls" hidden></label>
        ${DEMO ? `<button type="button" class="btn ghost sm" id="mbSample">${T('គំរូ MB51', 'Sample MB51')}</button>` : ''}
        ${MB.err ? `<span class="bad">⚠️ ${esc(MB.err)}</span>` : res ? `<span class="muted">📄 <b>${esc(MB.name)}</b> · ${MB.rows.length} ${T('ជួរ', 'rows')} · ${esc(res.from)} → ${esc(res.to)} · SLoc ${esc(res.slocs.join(', ') || '—')}${res.skipped ? ` · ${res.skipped} ${T('ជួរ SLoc ផ្សេង មិនបានប្រៀបធៀប', 'rows of other SLocs skipped')}` : ''}</span>`
          : `<span class="muted">${T('នាំចេញ MB51 ពី SAP ជា Excel រួចជ្រើសនៅទីនេះ (សន្លឹកទីមួយ)។ ផ្គូផ្គងតាម ឯកសារយោង + សម្ភារៈ + Batch។', 'Export MB51 from SAP to Excel and choose it here (first sheet). Lines are matched on Reference + Material + Batch.')}</span>`}</section>
      ${res ? `${FB.panel('moves', FL.map(f => msel(f[0], f[1], f[3], F[f[2]])).join('') + FB.search('mbq', T('ស្វែងរក ឯកសារយោង សម្ភារៈ Batch', 'Search reference, material, batch'), F.q))}
      <div class="dash-kpis mbk">
        <div class="stat"><b>${res.nApp}</b><span>${T('ចលនាក្នុងកម្មវិធី', 'App movements')}</span></div>
        <div class="stat"><b>${res.nSap}</b><span>${T('ជួរ MB51', 'MB51 lines')}</span></div>
        <div class="stat in"><b>${cnt('ok')}</b><span>${T('ត្រូវគ្នា', 'Matched')}</span></div>
        <div class="stat warn"><b>${cnt('qty')}</b><span>${T('ចំនួនខុស', 'Qty different')}</span></div>
        <div class="stat ${cnt('sap') ? 'out' : ''}"><b>${cnt('sap')}</b><span>${T('មានតែក្នុង SAP (មិនបានស្កេន)', 'Only in SAP (not scanned in app)')}</span></div>
        <div class="stat ${cnt('app') ? 'out' : ''}"><b>${cnt('app')}</b><span>${T('មានតែក្នុងកម្មវិធី (មិនទាន់ post)', 'Only in app (not posted in SAP)')}</span></div>
        <div class="stat"><b>${L.length ? Math.round(cnt('ok') / L.length * 100) : 0}%</b><span>${T('អត្រាត្រូវគ្នា', 'Match rate')}</span></div>
      </div>
      <section class="screp"><table class="rep mbtbl"><thead><tr><th>${T('ថ្ងៃក្នុងកម្មវិធី', 'Date app')}</th><th>${T('ថ្ងៃ Post', 'Posting date')}</th><th>${T('ឯកសារយោង', 'Reference')}</th><th>Mat. doc</th><th>Mvt</th><th>${T('សម្ភារៈ', 'Material')}</th><th>${T('បរិយាយ', 'Description')}</th><th>Batch</th><th>${T('ទីតាំង', 'Bin')}</th><th>SLoc</th><th class="num">${T('ចំនួនកម្មវិធី', 'App qty')}</th><th class="num">${T('ចំនួន MB51', 'MB51 qty')}</th><th class="num">${T('ខុសគ្នា', 'Diff')}</th><th>UoM</th><th>${T('លទ្ធផល', 'Result')}</th><th>${T('កំណត់សម្គាល់', 'Remark')}</th></tr></thead><tbody>
        ${rows.map((x, i) => `<tr class="go" data-mbi="${i}"><td>${esc(String(x.when).slice(5, 16))}</td><td>${esc(x.post)}</td><td class="mono">${esc(x.ref)}</td><td class="mono">${esc(x.doc)}</td><td>${esc(x.mvt)}</td><td class="mono">${esc(x.material)}</td><td>${esc(x.desc)}</td><td class="mono">${esc(x.batch)}</td><td class="mono">${esc(x.bin)}</td><td>${esc(x.sloc)}</td>
          <td class="num mono">${sq(x.appQty)}</td><td class="num mono">${sq(x.sapQty)}</td><td class="num mono"><b>${x.diff ? sq(x.diff) : ''}</b></td><td>${esc(x.uom)}</td><td><span class="st ${MBR[x.res][2]}">${T(MBR[x.res][0], MBR[x.res][1])}</span></td><td>${x.note ? `<span class="st st-var" title="MB51: ${esc(x.sbatch)}">${T('Batch ខុស', 'Batch different')}</span> <span class="muted mono">MB51 ${esc(x.sbatch)}</span>` : ''}</td></tr>`).join('')
          || `<tr><td class="muted" colspan="16">${T('រកមិនឃើញ', 'Nothing found')}</td></tr>`}</tbody>
        <tfoot><tr class="gtot"><th>${T('សរុប', 'Subtotal')} (${rows.length})</th>${'<th></th>'.repeat(9)}<th class="num mono">${sumU('appQty')}</th><th class="num mono">${sumU('sapQty')}</th><th class="num mono">${sumU('diff')}</th><th></th><th></th><th></th></tr></tfoot></table></section>
      <p class="muted">${T('ផ្គូផ្គង ឯកសារយោងក្នុងកម្មវិធី (DN / PO / GR) ជាមួយ Reference, Material Document, Purchase order ឬ Order ក្នុង MB51 + សម្ភារៈ + Batch។ ចេញ = ចំនួនអវិជ្ជមាន។ ការផ្ទេររវាងទីតាំង និងការកែតម្រូវ មិនបានប្រៀបធៀបទេ។',
        'App Reference (DN / PO / GR) is matched with MB51 Reference, Material Document, Purchase order or Order, plus Material + Batch. Out = negative qty. Bin transfers and adjustments are not compared (they are not in MB51).')}</p>` : ''}`);
    pvWire('moves', moves);
    if (res) setTimeout(fitRep, 0);
    $('#mbFile').onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
      if (/\.(xlsx|xlsm|xls)$/i.test(f.name)) {
        rd.onload = () => xlsxLib().then(X => { const wb = X.read(new Uint8Array(rd.result), { type: 'array', cellDates: true }); const sh = wb.Sheets[wb.SheetNames[0]];
          loadMb51(f.name, X.utils.sheet_to_json(sh, { header: 1, raw: true, defval: '' })); }, () => toast(T('មិនអាចអាន Excel បានទេ', 'Could not read the Excel file')));
        rd.readAsArrayBuffer(f);
      } else { rd.onload = () => loadMb51(f.name, parseCsv(String(rd.result).replace(/^﻿/, ''))); rd.readAsText(f); } };
    if ($('#mbSample')) $('#mbSample').onclick = () => {
      const g = [['Material Document', 'Material', 'Batch', 'Posting Date', 'Storage location', 'Movement type', 'Quantity', 'Base Unit of Measure', 'Material Description', 'Reference', 'Purchase order']];
      D.ledger.filter(r => r.type === 'IN' || r.type === 'OUT').forEach((r, i) => { if (i % 7 === 3) return; const q = (Number(r.qtyIn) || 0) - (Number(r.qtyOut) || 0) + (i % 9 === 4 ? -5 : 0);
        g.push(['49008' + ('0000' + i).slice(-5), r.material, i % 11 === 6 ? 'X' + r.batch : r.batch, r.date, r.sloc, r.type === 'IN' ? '101' : '601', String(q), r.uom, r.desc, r.type === 'IN' ? '' : r.reference, r.type === 'IN' ? r.reference : '']); });
      const l0 = D.ledger[0] || {}; g.push(['4900899999', l0.material || 'PIPE-25X25', l0.batch || '', l0.date || dAgo(1), l0.sloc || '2010', '601', '-12', l0.uom || 'PC', l0.desc || '', '81039999', '']);
      loadMb51('MB51_sample.xlsx', g); };
    if (!res) return;
    keep('#mbq', v => { F.q = v; moves(); });
    $$('tr[data-mbi]').forEach(tr => { tr.onclick = () => mbDetail(rows[Number(tr.dataset.mbi)]); });
    FL.forEach(f => mselWire(f[0], v => { F[f[2]] = v; moves(); }));
    if ($('#exp')) $('#exp').onclick = () => download('mb51-compare.csv', [['Date app', 'Posting date', 'Reference', 'Material Document', 'Movement type', 'Material', 'Description', 'Batch', 'Bin', 'SLoc', 'App qty', 'MB51 qty', 'Diff', 'UoM', 'Result', 'Remark', 'MB51 batch', 'MB51 file']]
      .concat(rows.map(x => [x.when, x.post, x.ref, x.doc, x.mvt, x.material, x.desc, x.batch, x.bin, x.sloc, x.appQty == null ? '' : x.appQty, x.sapQty == null ? '' : x.sapQty, x.diff, x.uom, MBR[x.res][1], x.note ? 'Batch different' : '', x.sbatch || '', MB.name])));
  }

  window.SC_PAGES = { varhist: varhist, binsum: binsum, dash: dash, stock: stock, moves: moves, review: review, sap: sap, roles: roles };   // Product menu removed (Kim, 22 Nov: heavy data, not needed)
  route();
})();
