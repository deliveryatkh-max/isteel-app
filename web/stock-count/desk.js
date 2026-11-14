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
    ['moves', '🔁', 'ចលនាស្តុក', 'Movements'], ['review', '✅', 'ពិនិត្យការរាប់', 'Count review'], ['sap', '🧮', 'ផ្ទៀងផ្ទាត់ SAP', 'SAP check'], ['roles', '👥', 'តួនាទី', 'Roles'],
  ];
  const ROLES = [
    { id: 'operator', km: 'បុគ្គលិកឃ្លាំង', en: 'Warehouse Operator', pages: ['home', 'stock'], can: [] },
    { id: 'supervisor', km: 'ប្រធានក្រុមឃ្លាំង', en: 'Warehouse Supervisor', pages: ['home', 'dash', 'stock', 'moves', 'review'], can: ['approve', 'export'] },
    { id: 'controller', km: 'អ្នកត្រួតពិនិត្យស្តុក', en: 'Inventory Controller', pages: ['home', 'dash', 'stock', 'moves', 'review', 'sap'], can: ['approve', 'export', 'adjust', 'sap'] },
    { id: 'admin', km: 'អ្នកគ្រប់គ្រងប្រព័ន្ធ', en: 'Administrator', pages: ['home', 'dash', 'stock', 'moves', 'review', 'sap', 'roles'], can: ['approve', 'export', 'adjust', 'sap', 'users'] },
  ];
  const RIGHTS = [
    ['scan', 'ស្កេន៖ ចូល / ចេញ / ផ្ទេរ / រាប់', 'Scan: IN / OUT / Transfer / Count'], ['stockv', 'មើលបញ្ជីស្តុក', 'See the stock list'],
    ['dashv', 'មើលផ្ទាំងគ្រប់គ្រង និងចលនាស្តុក', 'See dashboard and movements'], ['approve', 'អនុម័ត ឬបដិសេធការរាប់', 'Approve or reject counts'],
    ['export', 'ទាញយក CSV', 'Export CSV'], ['adjust', 'កែតម្រូវស្តុកតាមការរាប់', 'Post count adjustments'],
    ['sap', 'នាំចូល SAP និងផ្ទៀងផ្ទាត់', 'SAP import and reconciliation'], ['users', 'កំណត់តួនាទីអ្នកប្រើ', 'Set user roles'],
  ];
  let roleId = 'admin';
  try { roleId = localStorage.getItem('sc_demo_role') || 'admin'; } catch (e) { /* private mode */ }
  const LIVE_ROLE = { id: 'live', pages: ['home', 'dash', 'stock', 'moves', 'sap'], can: ['export', 'sap'] };
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
    nav.innerHTML = PAGES.filter(p => r.pages.indexOf(p[0]) >= 0).map(p => `<button type="button" class="tab${p[0] === on ? ' on' : ''}" data-tab="${p[0]}"><span>${p[1]}</span><b>${T(p[2], p[3])}</b>${
      p[0] === 'review' && pending() ? `<i class="count">${pending()}</i>` : ''}</button>`).join('');
    nav.querySelectorAll('.tab').forEach(b => { b.onclick = () => { S.view = b.dataset.tab; route(); window.scrollTo(0, 0); }; });
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
        ${stat(new Set(D.stock.map(l => l.bin)).size + ' / ' + D.bins.length, T('កុងតឺន័រមានស្តុក', 'Bins in use'), '', 'stock')}
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
          <table class="lines hist"><tr><th>${T('ឃ្លាំង', 'Warehouse')}</th><th>${T('កុងតឺន័រ', 'Bins')}</th><th>${T('ប្រភេទស្តុក', 'Lines')}</th><th>Kg</th><th>Pcs</th></tr>
          ${whs.map(w => `<tr><td><b>${esc(w.w)}</b></td><td class="num">${w.bins}</td><td class="num">${w.lines}</td><td class="num">${fmtQty(w.kg)}</td><td class="num">${fmtQty(w.pc)}</td></tr>`).join('')}</table></section>
        ${DEMO ? `<section class="card scroll"><h3>${T('ការរាប់ចុងក្រោយ', 'Latest counts')}</h3>
          <table class="lines hist"><tr><th>${T('ថ្ងៃ', 'Date')}</th><th>${T('កុងតឺន័រ', 'Bin')}</th><th>${T('សម្ភារៈ', 'Material')}</th><th>${T('ខុសគ្នា', 'Variance')}</th><th>${T('ស្ថានភាព', 'Status')}</th></tr>
          ${D.counts.slice(0, 6).map(c => `<tr><td>${esc(c.date.slice(5))}</td><td>${esc(c.bin)}</td><td>${esc(c.material)}</td><td class="num ${c.variance < 0 ? 'out' : c.variance > 0 ? 'in' : ''}">${c.variance > 0 ? '+' : ''}${fmtQty(c.variance)}</td><td>${stBadge(c.status)}</td></tr>`).join('')}</table></section>` : ''}
        <section class="card scroll"><h3>${T('ប្រតិបត្តិការថ្មីៗ', 'Recent transactions')}</h3>
          <table class="lines hist"><tr><th>${T('ថ្ងៃ', 'Date')}</th><th>${T('ប្រភេទ', 'Type')}</th><th>${T('កុងតឺន័រ', 'Bin')}</th><th>${T('សម្ភារៈ', 'Material')}</th><th>${T('ចំនួន', 'Qty')}</th><th>${T('អ្នកប្រើ', 'User')}</th></tr>
          ${newest().slice(0, 10).map(r => `<tr><td>${esc(r.date.slice(5))} <small class="muted">${esc(r.time)}</small></td><td>${esc(tLabel(r.type))}</td><td>${esc(r.bin)}</td><td>${esc(r.material)}</td>${qtyCell(r)}<td>${esc(String(r.user || '').split('@')[0])}</td></tr>`).join('')}</table></section>
      </div>`);
    $$('[data-go]').forEach(el => { el.onclick = () => { S.view = el.dataset.go; route(); }; });
  }

  // ------------------------------------------------------------------ stock list
  const F = { q: '', wh: '', mq: '', mt: '', onlyVar: true };
  const hit = (q, vals) => !q || vals.join(' ').toLowerCase().indexOf(q.toLowerCase()) >= 0;
  function stock() {
    wide();
    const whs = Array.from(new Set(D.bins.map(b => b.warehouse)));
    const rows = D.stock.filter(l => (!F.wh || whOf(l.bin) === F.wh) && hit(F.q, [l.bin, l.material, l.desc, l.batch, l.sloc]));
    view(`
      <h2 class="ptitle">${T('បញ្ជីស្តុក', 'Stock list')} <small class="muted">${rows.length} ${T('ជួរ', 'lines')}</small></h2>
      <div class="fbar"><input type="search" id="fq" placeholder="${T('ស្វែងរក កុងតឺន័រ សម្ភារៈ ឬ Batch', 'Search bin, material or batch')}" value="${esc(F.q)}">
        <select id="fwh"><option value="">${T('គ្រប់ឃ្លាំង', 'All warehouses')}</option>${whs.map(w => `<option${w === F.wh ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select>
        ${can('export') ? `<button type="button" class="btn ghost sm" id="exp">⬇ CSV</button>` : ''}</div>
      <section class="card scroll tall"><table class="lines hist"><tr><th>${T('កុងតឺន័រ', 'Bin')}</th><th>${T('ឃ្លាំង', 'Warehouse')}</th><th>${T('សម្ភារៈ', 'Material')}</th><th>${T('បរិយាយ', 'Description')}</th><th>Batch</th><th>SLoc</th><th>${T('ស្តុក', 'On hand')}</th><th>UoM</th></tr>
        ${rows.map(l => `<tr class="go" data-bin="${esc(l.bin)}"><td><b>${esc(l.bin)}</b></td><td>${esc(whOf(l.bin))}</td><td>${esc(l.material)}</td><td>${esc(l.desc)}</td><td>${esc(l.batch)}</td><td>${esc(l.sloc)}</td><td class="num"><b>${fmtQty(l.book)}</b></td><td>${esc(l.uom)}</td></tr>`).join('')
          || `<tr><td class="muted">${T('រកមិនឃើញ', 'Nothing found')}</td></tr>`}</table></section>
      <p class="muted">${T('ចុចលើជួរ ដើម្បីបើកកុងតឺន័រ។', 'Tap a row to open the bin.')}</p>`);
    keep('#fq', v => { F.q = v; stock(); });
    $('#fwh').onchange = e => { F.wh = e.target.value; stock(); };
    $$('tr.go').forEach(tr => { tr.onclick = () => openBin(tr.dataset.bin); });
    if ($('#exp')) $('#exp').onclick = () => download('stock-on-hand.csv', [['Bin', 'Warehouse', 'Material', 'Description', 'Batch', 'SLoc', 'On hand', 'UoM']].concat(rows.map(l => [l.bin, whOf(l.bin), l.material, l.desc, l.batch, l.sloc, l.book, l.uom])));
  }
  // Search box that keeps the cursor when the table is drawn again.
  function keep(sel, fn) {
    const el = $(sel);
    el.oninput = () => { const pos = el.selectionStart; fn(el.value); const n = $(sel); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* number box */ } };
  }

  // ------------------------------------------------------------------ movements (the ledger)
  function moves() {
    wide(); loadLedger('moves');
    const types = ['IN', 'OUT', 'TRANSFER OUT', 'TRANSFER IN', 'ADJUST'];
    const rows = newest().filter(r => (!F.mt || r.type === F.mt) && hit(F.mq, [r.id, r.bin, r.material, r.desc, r.batch, r.reference, r.user]));
    view(`
      <h2 class="ptitle">${T('ចលនាស្តុក (សៀវភៅប្រតិបត្តិការ)', 'Movements (stock ledger)')} <small class="muted">${rows.length} ${T('ជួរ', 'rows')}</small></h2>
      <div class="fbar"><input type="search" id="mq" placeholder="${T('ស្វែងរក កុងតឺន័រ សម្ភារៈ ឯកសារយោង', 'Search bin, material, reference')}" value="${esc(F.mq)}">
        <select id="mt"><option value="">${T('គ្រប់ប្រភេទ', 'All types')}</option>${types.map(t => `<option value="${t}"${t === F.mt ? ' selected' : ''}>${esc(tLabel(t))}</option>`).join('')}</select>
        ${can('export') ? `<button type="button" class="btn ghost sm" id="exp">⬇ CSV</button>` : ''}</div>
      <section class="card scroll tall"><table class="lines hist"><tr><th>${T('ថ្ងៃ', 'Date')}</th><th>${T('លេខ', 'Txn ID')}</th><th>${T('ប្រភេទ', 'Type')}</th><th>${T('កុងតឺន័រ', 'Bin')}</th><th>${T('សម្ភារៈ', 'Material')}</th><th>Batch</th><th>${T('ចំនួន', 'Qty')}</th><th>${T('សមតុល្យ', 'Balance')}</th><th>${T('ឯកសារយោង', 'Reference')}</th><th>${T('អ្នកប្រើ', 'User')}</th></tr>
        ${rows.map(r => `<tr><td>${esc(r.date)} <small class="muted">${esc(r.time)}</small></td><td>${esc(r.id)}</td><td>${esc(tLabel(r.type))}</td><td>${esc(r.bin)}${r.otherBin ? ` <small class="muted">${isIn(r.type) ? '←' : '→'} ${esc(r.otherBin)}</small>` : ''}</td><td>${esc(r.material)}</td><td>${esc(r.batch)}</td>${qtyCell(r)}<td class="num">${fmtQty(r.balance)} ${esc(r.uom)}</td><td>${esc(r.reference)}</td><td>${esc(String(r.user || '').split('@')[0])}</td></tr>`).join('')
          || `<tr><td class="muted">${T('រកមិនឃើញ', 'Nothing found')}</td></tr>`}</table></section>
      ${oldNote()}
      <p class="muted">${T('ជួរនីមួយៗមិនអាចកែ ឬលុបបានទេ។ កំហុសត្រូវកែដោយប្រតិបត្តិការថ្មី។', 'Rows are never edited or deleted. A mistake is corrected with a new transaction.')}</p>`);
    keep('#mq', v => { F.mq = v; moves(); });
    $('#mt').onchange = e => { F.mt = e.target.value; moves(); };
    if ($('#exp')) $('#exp').onclick = () => download('stock-ledger.csv', [['Txn ID', 'Date', 'Time', 'Type', 'Bin', 'Material', 'Description', 'Batch', 'SLoc', 'UoM', 'In', 'Out', 'Balance', 'Reference', 'Other Bin', 'User']]
      .concat(rows.map(r => [r.id, r.date, r.time, r.type, r.bin, r.material, r.desc, r.batch, r.sloc, r.uom, r.qtyIn, r.qtyOut, r.balance, r.reference, r.otherBin, r.user])));
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
      <section class="card scroll tall"><table class="lines hist"><tr><th>${T('ថ្ងៃ', 'Date')}</th><th>${T('កុងតឺន័រ', 'Bin')}</th><th>${T('សម្ភារៈ', 'Material')}</th><th>Batch</th><th>${T('ក្នុងប្រព័ន្ធ', 'Book')}</th><th>${T('រាប់បាន', 'Counted')}</th><th>${T('ខុសគ្នា', 'Variance')}</th><th>${T('រាប់ដោយ', 'Counted by')}</th><th>${T('ស្ថានភាព', 'Status')}</th><th data-nosort>${T('សកម្មភាព', 'Action')}</th></tr>
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
      if (!x.desc) { const known = D.stock.find(l => l.material.toUpperCase() === String(o.material).trim().toUpperCase()); x.desc = known ? known.desc : ''; }
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

  function sap() {
    wide();
    const ok = R.rows.length && R.map.material >= 0 && R.map.qty >= 0;
    const res = ok ? reconcile() : null;
    const vars = res ? res.list.filter(x => x.status !== 'match') : [];
    if (res) lastSap = { at: R.at, variances: vars.length, name: R.name };
    const shown = res ? (F.onlyVar ? vars : res.list) : [];
    const lv = res ? res.level.map(k => FIELDS.find(f => f[0] === k)[1]).join(' + ') : '';
    view(`
      <h2 class="ptitle">${T('នាំចូល SAP និងផ្ទៀងផ្ទាត់', 'SAP import and reconciliation')}</h2>
      <section class="card">
        <div class="fbar"><label class="btn sm file">⬆ ${T('ជ្រើសឯកសារ CSV ពី SAP', 'Choose SAP CSV file')}<input type="file" id="sapFile" accept=".csv,.txt,text/csv" hidden></label>
          ${DEMO ? `<button type="button" class="btn ghost sm" data-sample="mb52">${T('គំរូ MB52', 'Sample MB52')}</button>
          <button type="button" class="btn ghost sm" data-sample="ewm">${T('គំរូ EWM (មានកុងតឺន័រ)', 'Sample EWM (with bins)')}</button>` : ''}</div>
        <details class="paste"><summary>${T('ឬបិទភ្ជាប់ពី Excel', 'or paste from Excel')}</summary><textarea id="sapPaste" rows="4" placeholder="Material&#9;Batch&#9;Storage Location&#9;Unrestricted"></textarea>
          <button type="button" class="btn ghost sm" id="usePaste">${T('ប្រើទិន្នន័យនេះ', 'Use this data')}</button></details>
        ${R.error ? `<p class="bad">⚠️ ${esc(R.error)}</p>` : ''}
        ${R.rows.length ? `<p class="muted">📄 <b>${esc(R.name)}</b> · ${R.rows.length} ${T('ជួរ', 'rows')} · ${T('នាំចូលនៅ', 'snapshot')} ${esc(R.at)}${res && res.bad ? ` · <span class="bad">${res.bad} ${T('ជួរមិនអាចអាន', 'rows skipped (no material or quantity)')}</span>` : ''}</p>
          <div class="mapgrid">${FIELDS.map(f => `<label>${f[1]}${f[3] ? ' *' : ''}<select data-map="${f[0]}"${f[3] && R.map[f[0]] < 0 ? ' class="need"' : ''}><option value="-1">—</option>${R.headers.map((h, i) => `<option value="${i}"${R.map[f[0]] === i ? ' selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</div>`
        : `<p class="muted">${T('នាំចេញ MB52 ឬ EWM ពី SAP ជា CSV រួចជ្រើសឯកសារនៅទីនេះ។ ', 'Export MB52 or EWM stock from SAP as CSV (Excel: Save as CSV), then choose the file here or paste the rows.')}</p>`}
      </section>
      ${res ? `
      <div class="dash-kpis">
        <div class="stat"><b>${res.list.length}</b><span>${T('ជួរប្រៀបធៀប', 'Lines compared')}</span></div>
        <div class="stat in"><b>${res.list.length - vars.length}</b><span>${T('ត្រូវគ្នា', 'Match')}</span></div>
        <div class="stat ${vars.length ? 'out' : ''}"><b>${vars.length}</b><span>${T('ខុសគ្នា', 'Variances')}</span></div>
        <div class="stat"><b>${res.list.length ? Math.round((res.list.length - vars.length) / res.list.length * 100) : 0}%</b><span>${T('អត្រាត្រូវគ្នា', 'Match rate')}</span></div>
      </div>
      <div class="fbar"><span class="muted">${T('ប្រៀបធៀបតាម', 'Compared by')} <b>${esc(lv)}</b></span>
        <label class="chk"><input type="checkbox" id="onlyVar"${F.onlyVar ? ' checked' : ''}> ${T('បង្ហាញតែជួរខុសគ្នា', 'Variances only')}</label>
        ${can('export') ? `<button type="button" class="btn ghost sm" id="exp">⬇ CSV</button>` : ''}</div>
      <section class="card scroll tall"><table class="lines hist"><tr>${res.level.map(k => `<th>${FIELDS.find(f => f[0] === k)[1]}</th>`).join('')}<th>${T('បរិយាយ', 'Description')}</th><th>${T('កាតស្តុក', 'Digital')}</th><th>SAP</th><th>${T('ខុសគ្នា', 'Variance')}</th><th>UoM</th><th>${T('លទ្ធផល', 'Result')}</th></tr>
        ${shown.map(x => `<tr>${res.level.map(k => `<td>${esc(String(x.o[k] == null ? '' : x.o[k]))}</td>`).join('')}<td>${esc(x.desc)}</td><td class="num">${x.digital == null ? '—' : fmtQty(x.digital)}</td><td class="num">${x.sap == null ? '—' : fmtQty(x.sap)}</td>
          <td class="num ${x.variance < 0 ? 'out' : x.variance > 0 ? 'in' : ''}"><b>${x.variance > 0 ? '+' : ''}${fmtQty(x.variance)}</b></td><td>${esc(x.uom)}</td><td><span class="st st-${x.status}">${T(SL[x.status][0], SL[x.status][1])}</span></td></tr>`).join('')
          || `<tr><td class="muted">${T('គ្មានជួរខុសគ្នា 🎉', 'No variances 🎉')}</td></tr>`}</table></section>
      <p class="muted">${T('ខុសគ្នា = កាតស្តុក − SAP។ ទិន្នន័យ SAP មិនដែលសរសេរជាន់លើស្តុកក្នុងកាតស្តុកទេ។ ជួរខុសគ្នាត្រូវពិនិត្យដោយការរាប់។', 'Variance = Digital − SAP. SAP figures never overwrite the digital balance. A variance is checked with a count.')}</p>` : ''}`);
    $('#sapFile').onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => loadSap(f.name, String(rd.result)); rd.readAsText(f); };
    $$('[data-sample]').forEach(b => { b.onclick = () => loadSap(b.dataset.sample === 'mb52' ? 'MB52_sample.csv' : 'EWM_stock_sample.csv', toCsv(SAMPLE[b.dataset.sample]())); });
    $('#usePaste').onclick = () => { const t = $('#sapPaste').value; if (t.trim()) loadSap(T('ទិន្នន័យបិទភ្ជាប់', 'Pasted data'), t); };
    $$('[data-map]').forEach(s => { s.onchange = () => { R.map[s.dataset.map] = Number(s.value); sap(); }; });
    if ($('#onlyVar')) $('#onlyVar').onchange = e => { F.onlyVar = e.target.checked; sap(); };
    if ($('#exp')) $('#exp').onclick = () => download('sap-reconciliation.csv', [res.level.map(k => FIELDS.find(f => f[0] === k)[1]).concat(['Description', 'Digital', 'SAP', 'Variance', 'UoM', 'Result', 'SAP file', 'Snapshot'])]
      .concat(shown.map(x => res.level.map(k => x.o[k]).concat([x.desc, x.digital, x.sap, x.variance, x.uom, SL[x.status][1], R.name, R.at]))));
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

  window.SC_PAGES = { dash: dash, stock: stock, moves: moves, review: review, sap: sap, roles: roles };
  route();
})();
