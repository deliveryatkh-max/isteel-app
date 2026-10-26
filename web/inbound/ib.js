// Inbound: goods receipt log (Kim's template "GOODS RECEIPT LOG", 26 Oct 2026).
// One record per truck: PO, Inbound no., truck, PO/DN/actual qty, UoM, date, start/end time,
// time spent, productivity, manpower, truck owner, damage, remark.
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
  const tons = r => { const q = +r.actQty || 0; if (r.uom === 'Kg') return q / 1000; if (r.uom === 'Ton') return q; return null; };
  // Productivity = what one person unloads in one hour (tonnes for Kg/Ton, otherwise the UoM itself).
  const prod = r => {
    const m = r.end ? spentMin(r) : null; const mp = +r.manpower || 0; if (!m || !mp || !r.actQty) return null;
    const q = tons(r) != null ? tons(r) : +r.actQty; return q / (m / 60) / mp;
  };
  const prodUnit = r => (tons(r) != null ? t('តោន/នាក់/ម៉ោង', 't/person/h') : r.uom + t('/នាក់/ម៉ោង', '/person/h'));
  const diffPct = (a, b) => (!a || !b ? null : (a - b) / b * 100);

  // ------------------------------------------------------------------ data (demo)
  let DATA = [];
  function seed() {
    const out = []; const base = new Date(); base.setHours(0, 0, 0, 0);
    const rows = [
      // daysAgo, start, minutes, PO qty, DN qty, act qty, uom, men, owner, carrier, damaged, detail
      [0, '-420', 48, 45230, 45230, 45230, 'Kg', 3, '3PL', 'FOXS', false, ''],
      [0, '-330', 62, 38900, 38900, 38640, 'Kg', 2, 'ISI', '', true, 'ដែកដុំរឡូ 1 ដុំ ខូចគែម / 1 coil edge damaged'],
      [0, '-200', 35, 1200, 1200, 1200, 'PC', 4, '3PL', 'Queen Legacy', false, ''],
      [0, '-52', null, 52000, 52000, '', 'Kg', 3, '3PL', 'Srong Sal', false, ''],
      [0, '-25', null, 41800, 41800, '', 'Kg', 2, 'ISI', '', false, ''],
      [1, '07:30', 55, 47100, 47100, 47100, 'Kg', 3, '3PL', 'FOXS', false, ''],
      [1, '09:10', 71, 29.5, 29.5, 29.5, 'Ton', 2, 'ISI', '', false, ''],
      [1, '11:00', 40, 800, 800, 780, 'BAG', 4, '3PL', 'Chroek Kimheng', true, 'បាវរហែក 20 / 20 bags torn'],
      [1, '14:30', 55, 45230, 45230, 45230, 'Kg', 2, 'ISI', '', false, ''],
      [1, '15:50', 66, 50400, 50200, 50200, 'Kg', 3, '3PL', 'Queen Legacy', false, ''],
      [2, '08:00', 50, 44000, 44000, 44000, 'Kg', 3, '3PL', 'FOXS', false, ''],
      [2, '10:45', 90, 61200, 61200, 61200, 'Kg', 2, '3PL', 'Vannoun', false, 'រង់ចាំស៊ីរ៉ង់ / waited for crane'],
      [2, '13:20', 38, 600, 600, 600, 'M', 2, 'ISI', '', false, ''],
      [3, '07:50', 58, 46800, 46800, 46800, 'Kg', 3, 'ISI', '', false, ''],
      [3, '09:30', 64, 39950, 40000, 39950, 'Kg', 3, '3PL', 'Srong Sal', false, ''],
      [3, '14:10', 45, 24, 24, 24, 'ROL', 2, '3PL', 'FOXS', false, ''],
      [4, '08:15', 52, 48300, 48300, 48300, 'Kg', 3, '3PL', 'Queen Legacy', false, ''],
      [4, '10:00', 75, 55700, 55700, 55100, 'Kg', 2, 'ISI', '', true, 'ដែកដុំរឡូ ច្រេះ / coil rust'],
      [4, '15:00', 49, 43600, 43600, 43600, 'Kg', 3, '3PL', 'Chroek Kimheng', false, ''],
    ];
    rows.forEach((x, i) => {
      const d = new Date(base); d.setDate(d.getDate() - x[0]);
      let start = x[1];
      // today's rows are placed relative to now so the demo always looks live
      if (start[0] === '-') { const s = new Date(Math.max(base.getTime(), Date.now() + (+start) * 60000)); start = hm(s); }
      const end = x[2] == null ? '' : hm(new Date(d.getTime() + (toMin(start) + x[2]) * 60000));
      out.push({
        id: 'IB' + ymd(d).slice(2).replace(/-/g, '') + '-' + pad(i + 1),
        po: String(5100012793 + i * 7), inbound: String(1800048956 + i * 3), truck: PLATES[i % PLATES.length],
        poQty: x[3], dnQty: x[4], actQty: x[5], uom: x[6], date: ymd(d), start, end,
        manpower: x[7], owner: x[8], carrier: x[9], damaged: x[10], damageDetail: x[11],
        remark: i === 11 ? x[11] : '', photos: x[10] ? 2 : 1, by: i % 3 ? 'Sokha (Storekeeper)' : 'Dara (Checker)',
      });
      if (i === 11) out[out.length - 1].damageDetail = '';
    });
    return out;
  }
  function load() {
    const s = get('ib_demo_v2');
    if (s) { try { const o = JSON.parse(s); if (o.day === today()) { DATA = o.rows; return; } } catch (e) { /* reseed */ } }
    DATA = seed(); save();
  }
  function save() { set('ib_demo_v2', JSON.stringify({ day: today(), rows: DATA })); }
  const byId = id => DATA.find(r => r.id === id);
  const isLive = r => r.start && !r.end;

  // ------------------------------------------------------------------ chrome
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { el.hidden = true; }, 2200); }
  function paintStatic() { $$('[data-km]').forEach(el => { el.textContent = t(el.dataset.km, el.dataset.en); }); }
  function paintTabs(r) { $$('.tab[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === r)); const n = DATA.filter(isLive).length; const c = $('#liveCount'); c.textContent = n; c.hidden = !n; }
  const view = html => { $('#view').innerHTML = html; window.scrollTo(0, 0); const m = $('main'); if (m) m.scrollTop = 0; };

  function badges(r) {
    const b = [];
    if (isLive(r)) b.push(`<span class="badge live">⏱ ${t('កំពុងទម្លាក់', 'Unloading')}</span>`);
    else b.push(`<span class="badge ok">✅ ${t('រួចរាល់', 'Done')}</span>`);
    if (r.damaged) b.push(`<span class="badge dmg">⚠️ ${t('ខូចខាត', 'Damaged')}</span>`);
    const d = r.end ? diffPct(+r.actQty, +r.dnQty) : null;
    if (d) b.push(`<span class="badge diff">${d > 0 ? '+' : ''}${fmt(d, 1)}% DN</span>`);
    return b.join(' ');
  }
  const ownerTxt = r => r.owner === 'ISI' ? t('ឡាន ISI', 'ISI truck') : '3PL' + (r.carrier ? ' · ' + r.carrier : '');
  function itemHTML(r) {
    const m = spentMin(r);
    return `<a class="item${isLive(r) ? ' live' : ''}" href="#/r/${r.id}">
      <div class="top"><span class="id">🚛 ${esc(r.truck)}</span>${isLive(r) ? `<span class="timer${m > 60 ? ' slow' : ''}" data-timer="${r.id}">${clock(m)}</span>` : `<span>${badges(r)}</span>`}</div>
      <div class="ttl">PO ${esc(r.po)} · IN ${esc(r.inbound)}</div>
      <div class="meta">${esc(ownerTxt(r))} · <b>${esc(fmt(r.actQty || r.dnQty))} ${esc(r.uom)}</b> · ${esc(r.start)}${r.end ? '–' + esc(r.end) : ''} · 👷 ${esc(r.manpower)}</div>
      ${isLive(r) ? `<div class="meta">${badges(r)}</div>` : ''}
    </a>`;
  }

  // ------------------------------------------------------------------ Today
  function renderHome() {
    paintTabs('home');
    const td = DATA.filter(r => r.date === today());
    const live = td.filter(isLive), done = td.filter(r => r.end);
    const tn = done.reduce((s, r) => s + (tons(r) || 0), 0);
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
    const F = { all: () => true, live: isLive, done: r => !!r.end, dmg: r => r.damaged, diff: r => r.end && !!diffPct(+r.actQty, +r.dnQty) };
    const rows = DATA.filter(F[LF]).filter(r => !q || [r.po, r.inbound, r.truck, r.carrier, r.owner, r.uom, r.remark, r.damageDetail].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
    let last = '', html = '';
    rows.forEach(r => { if (r.date !== last) { last = r.date; html += `<div class="daylabel">${r.date === today() ? t('ថ្ងៃនេះ', 'Today') + ' · ' : ''}${showDate(r.date)}</div>`; } html += itemHTML(r); });
    const chip = (k, km, en) => `<button class="chip${LF === k ? ' on' : ''}" data-f="${k}">${t(km, en)}</button>`;
    view(`
      <input class="in search-in" id="q" type="search" placeholder="🔎 ${esc(t('ស្វែងរក៖ PO, Inbound, ផ្លាកលេខ, 3PL', 'Search: PO, inbound, plate, 3PL'))}" value="${esc(LQ)}">
      <div class="filters">${chip('all', 'ទាំងអស់', 'All')}${chip('live', '⏱ កំពុងទម្លាក់', '⏱ Unloading')}${chip('done', '✅ រួចរាល់', '✅ Done')}${chip('dmg', '⚠️ ខូចខាត', '⚠️ Damaged')}${chip('diff', '± ខុសបរិមាណ', '± Qty diff')}</div>
      <div class="list">${html || `<div class="empty">${t('រកមិនឃើញ', 'Nothing found')}</div>`}</div>
      <button class="btn" id="xls">⬇️ ${t('ទាញយក Excel', 'Download Excel')}</button>`);
    const qi = $('#q'); qi.oninput = () => { LQ = qi.value; const pos = qi.selectionStart; renderLog(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
    $$('[data-f]').forEach(b => { b.onclick = () => { LF = b.dataset.f; renderLog(); }; });
    $('#xls').onclick = () => exportCsv(rows);
  }
  function exportCsv(rows) {
    const H = ['PO Number', 'Inbound Number', 'Truck Number/Trailer', 'PO Qty', 'DN Qty', 'Actual Receipt Qty', 'UoM', 'Receipt Date', 'Start Time', 'End Time', 'Time Spent (min)', 'Productivity', 'Manpower used to Unload/Receive', 'Truck Owner', 'Damaged?', 'Damage Detail', 'Remark'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [H.map(q).join(',')].concat(rows.map(r => [
      'PO ' + r.po, 'IN ' + r.inbound, r.truck, r.poQty, r.dnQty, r.actQty, r.uom, showDate(r.date), r.start, r.end,
      r.end ? spentMin(r) : '', prod(r) == null ? '' : fmt(prod(r), 2) + ' ' + prodUnit(r), r.manpower,
      r.owner === 'ISI' ? 'ISI Truck' : '3PL Truck' + (r.carrier ? ' (' + r.carrier + ')' : ''), r.damaged ? 'Yes' : 'No', r.damageDetail, r.remark,
    ].map(q).join(',')));
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
      a.download = 'Goods_Receipt_Log.csv'; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast(t('ទាញយកមិនបាន', 'Download failed')); }
  }

  // ------------------------------------------------------------------ form
  let F = null;
  function blank() { return { id: '', po: '', inbound: '', truck: '', poQty: '', dnQty: '', actQty: '', uom: 'Kg', date: today(), start: '', end: '', manpower: 2, owner: '', carrier: '', damaged: null, damageDetail: '', remark: '', photos: 0 }; }
  function renderForm(id) {
    paintTabs('');
    if (!F || F.id !== (id || '')) F = id ? Object.assign({}, byId(id)) : blank();
    const r = F, started = !!r.start, editing = !!r.id;
    const m = r.start ? spentMin(r) : null, p = prod(r);
    const dn = diffPct(+r.dnQty, +r.poQty), act = diffPct(+r.actQty, +r.dnQty);
    const cmp = (lbl, d) => d == null ? '' : `<div class="${Math.abs(d) < 0.05 ? 'okk' : 'warn'}"><span>${lbl}</span><b>${Math.abs(d) < 0.05 ? '✓ ' + t('ត្រូវគ្នា', 'Match') : (d > 0 ? '+' : '') + fmt(d, 2) + '%'}</b></div>`;
    view(`
      <div class="head2"><h2>${editing ? (isLive(r) ? '⏱ ' + t('បញ្ចប់ការទម្លាក់', 'Finish unloading') : '✏️ ' + t('កែប្រែ', 'Edit')) : '＋ ' + t('ទទួលទំនិញថ្មី', 'New goods receipt')}</h2><a class="link" href="${editing ? '#/r/' + r.id : '#/'}">✕</a></div>

      <section class="card"><h2>📄 ${t('ឯកសារ', 'Documents')}</h2>
        <div class="row2">
          <div class="field"><label class="f">${t('លេខ PO', 'PO Number')} <span class="req">*</span></label><div class="prefix"><span>PO</span><input class="in" id="po" inputmode="numeric" value="${esc(r.po)}" placeholder="5100012793"></div></div>
          <div class="field"><label class="f">${t('លេខ Inbound', 'Inbound Number')} <span class="req">*</span></label><div class="prefix"><span>IN</span><input class="in" id="inbound" inputmode="numeric" value="${esc(r.inbound)}" placeholder="1800048956"></div></div>
        </div>
      </section>

      <section class="card"><h2>🚛 ${t('ឡាន', 'Truck')}</h2>
        <div class="field"><label class="f">${t('ផ្លាកលេខឡាន / រ៉ឺម៉ក', 'Truck number / trailer')} <span class="req">*</span></label>
          <input class="in" id="truck" list="plates" value="${esc(r.truck)}" placeholder="2A-2233" autocapitalize="characters"><datalist id="plates">${PLATES.map(x => `<option value="${x}">`).join('')}</datalist></div>
        <div class="field"><label class="f">${t('ម្ចាស់ឡាន', 'Truck owner')} <span class="req">*</span></label>
          <div class="seg"><button type="button" data-own="ISI" class="${r.owner === 'ISI' ? 'on' : ''}">🏭 ${t('ឡាន ISI', 'ISI truck')}</button><button type="button" data-own="3PL" class="${r.owner === '3PL' ? 'on' : ''}">🚚 ${t('ឡាន 3PL', '3PL truck')}</button></div></div>
        ${r.owner === '3PL' ? `<div class="field"><label class="f">${t('ក្រុមហ៊ុន 3PL', '3PL company')}</label><select class="in" id="carrier"><option value="">–</option>${CARRIERS.map(c => `<option${c === r.carrier ? ' selected' : ''}>${c}</option>`).join('')}</select></div>` : ''}
      </section>

      <section class="card"><h2>⚖️ ${t('បរិមាណ', 'Quantity')}</h2>
        <div class="row2">
          <div class="field"><label class="f">${t('បរិមាណ PO', 'PO Qty')}</label><input class="in" id="poQty" inputmode="decimal" value="${esc(r.poQty)}"></div>
          <div class="field"><label class="f">${t('បរិមាណ DN', 'DN Qty')}</label><input class="in" id="dnQty" inputmode="decimal" value="${esc(r.dnQty)}"></div>
        </div>
        <div class="row2">
          <div class="field"><label class="f">${t('ទទួលជាក់ស្តែង', 'Actual receipt Qty')}${started ? ' <span class="req">*</span>' : ''}</label><input class="in" id="actQty" inputmode="decimal" value="${esc(r.actQty)}" placeholder="${started ? '' : t('បំពេញពេលបញ្ចប់', 'Fill at finish')}"></div>
          <div class="field"><label class="f">${t('ឯកតា', 'UoM')}</label><select class="in" id="uom">${UOMS.map(u => `<option${u === r.uom ? ' selected' : ''}>${u}</option>`).join('')}</select></div>
        </div>
        <div class="cmp">${cmp(t('DN ធៀប PO', 'DN vs PO'), dn)}${cmp(t('ជាក់ស្តែង ធៀប DN', 'Actual vs DN'), act)}</div>
      </section>

      <section class="card"><h2>⏱ ${t('ការទម្លាក់ទំនិញ', 'Unloading')}</h2>
        <div class="field"><label class="f">${t('ចំនួនកម្មករលើក/ទទួល', 'Manpower to unload/receive')}</label>
          <div class="stepper"><button type="button" id="mpm">−</button><b id="mp">${esc(r.manpower)}</b><button type="button" id="mpp">＋</button><span class="hint">👷 ${t('នាក់', 'people')}</span></div></div>
        <div class="field"><label class="f">${t('ថ្ងៃទទួល', 'Receipt date')}</label><input class="in" type="date" id="date" value="${esc(r.date)}"></div>
        ${started ? `
        <div class="timebox">
          <div class="tbox"><small>▶ ${t('ម៉ោងចាប់ផ្តើម', 'Start time')}</small><input type="time" id="start" value="${esc(r.start)}"></div>
          <div class="tbox"><small>⏹ ${t('ម៉ោងបញ្ចប់', 'End time')}</small>${r.end ? `<input type="time" id="end" value="${esc(r.end)}">` : `<b>– – : – –</b>`}</div>
        </div>
        <div class="calc">
          <div class="tbox"><small>${t('រយៈពេល', 'Time spent')}</small><b>${showSpent(m)}</b></div>
          <div class="tbox"><small>${t('ផលិតភាព', 'Productivity')}</small><b>${p == null ? '–' : fmt(p, 1)}</b><small>${p == null ? t('គណនាពេលបញ្ចប់', 'Shown at finish') : esc(prodUnit(r))}</small></div>
        </div>` : `<p class="hint">${t('ម៉ោងចាប់ផ្តើមកត់ត្រាដោយស្វ័យប្រវត្តិ ពេលចុចប៊ូតុងខាងក្រោម។', 'Start time is taken automatically when you tap the button below.')}</p>`}
      </section>

      ${started ? `
      <section class="card"><h2>🔍 ${t('ការខូចខាត', 'Damage')}</h2>
        <div class="field"><label class="f">${t('មានខូចខាតទេ?', 'Damaged?')} <span class="req">*</span></label>
          <div class="seg"><button type="button" data-dmg="0" class="${r.damaged === false ? 'on' : ''}">👍 ${t('ទេ', 'No')}</button><button type="button" data-dmg="1" class="${r.damaged ? 'on bad' : ''}">⚠️ ${t('បាទ/ចាស មាន', 'Yes')}</button></div></div>
        ${r.damaged ? `<div class="field"><label class="f">${t('ព័ត៌មានលម្អិតការខូចខាត', 'Damage detail')}</label><textarea class="in" id="damageDetail" rows="2">${esc(r.damageDetail)}</textarea></div>` : ''}
        <div class="field"><label class="f">📷 ${t('រូបថត (ឡាន ឯកសារ ការខូចខាត)', 'Photos (truck, documents, damage)')}</label>
          <div class="photos">${Array.from({ length: r.photos || 0 }, () => '<div class="ph">🖼️</div>').join('')}<button type="button" class="ph add" id="addPh">📷</button></div></div>
      </section>` : ''}

      <section class="card"><h2>📝 ${t('សំគាល់', 'Remark')}</h2><textarea class="in" id="remark" rows="2">${esc(r.remark)}</textarea></section>

      ${!started ? `<button class="btn ok big bigstart" id="startBtn">▶ ${t('ចាប់ផ្តើមទម្លាក់ឥឡូវ', 'Start unloading now')}</button>`
        : isLive(r) ? `<button class="btn big bigstart endbtn" id="endBtn">⏹ ${t('បញ្ចប់ការទម្លាក់ ហើយរក្សាទុក', 'Finish unloading & save')}</button><button class="btn mt" id="saveBtn">💾 ${t('រក្សាទុក (មិនទាន់បញ្ចប់)', 'Save (not finished)')}</button>`
          : `<button class="btn ok big" id="saveBtn">💾 ${t('រក្សាទុក', 'Save')}</button>`}
      <div style="height:16px"></div>`);
    bindForm();
  }
  function collect() {
    ['po', 'inbound', 'truck', 'poQty', 'dnQty', 'actQty', 'uom', 'date', 'start', 'end', 'remark', 'damageDetail'].forEach(k => { const el = $('#' + k); if (el) F[k] = el.value.trim(); });
    const c = $('#carrier'); if (c) F.carrier = c.value;
    F.truck = F.truck.toUpperCase().replace(/\s+/g, '');
    F.po = F.po.replace(/^PO\s*/i, ''); F.inbound = F.inbound.replace(/^IN\s*/i, '');
  }
  function bindForm() {
    const re = () => { collect(); const y = window.scrollY, m = $('main'), my = m ? m.scrollTop : 0; renderForm(F.id); window.scrollTo(0, y); if (m) m.scrollTop = my; };
    $$('[data-own]').forEach(b => { b.onclick = () => { F.owner = b.dataset.own; if (F.owner === 'ISI') F.carrier = ''; re(); }; });
    $$('[data-dmg]').forEach(b => { b.onclick = () => { F.damaged = b.dataset.dmg === '1'; re(); }; });
    $('#mpm').onclick = () => { F.manpower = Math.max(1, (+F.manpower || 1) - 1); $('#mp').textContent = F.manpower; };
    $('#mpp').onclick = () => { F.manpower = (+F.manpower || 0) + 1; $('#mp').textContent = F.manpower; };
    ['poQty', 'dnQty', 'actQty', 'uom', 'start', 'end'].forEach(k => { const el = $('#' + k); if (el) el.onchange = re; });
    const ap = $('#addPh'); if (ap) ap.onclick = () => { F.photos = (F.photos || 0) + 1; re(); toast(t('សាកល្បង៖ បើកកាមេរ៉ា', 'Demo: opens the camera')); };
    const need = () => {
      const miss = [];
      if (!F.po) miss.push(t('លេខ PO', 'PO number')); if (!F.inbound) miss.push(t('លេខ Inbound', 'Inbound number'));
      if (!F.truck) miss.push(t('ផ្លាកលេខ', 'Truck number')); if (!F.owner) miss.push(t('ម្ចាស់ឡាន', 'Truck owner'));
      return miss;
    };
    const st = $('#startBtn');
    if (st) st.onclick = () => {
      collect(); const miss = need(); if (miss.length) return toast('⚠️ ' + miss.join(', '));
      F.start = nowHM(); F.id = 'IB' + F.date.slice(2).replace(/-/g, '') + '-' + pad(DATA.length + 1); F.by = t('អ្នក (សាកល្បង)', 'You (demo)');
      DATA.push(Object.assign({}, F)); save(); F = null; toast('▶ ' + t('បានចាប់ផ្តើម ', 'Started ') + nowHM()); location.hash = '#/';
    };
    const en = $('#endBtn');
    if (en) en.onclick = () => {
      collect(); const miss = need(); if (!F.actQty) miss.push(t('ទទួលជាក់ស្តែង', 'Actual qty')); if (F.damaged == null) miss.push(t('ខូចខាត?', 'Damaged?'));
      if (miss.length) return toast('⚠️ ' + miss.join(', '));
      F.end = nowHM(); store(); toast('✅ ' + t('បានរក្សាទុក ', 'Saved ') + showSpent(spentMin(F))); const id = F.id; F = null; location.hash = '#/r/' + id;
    };
    const sv = $('#saveBtn');
    if (sv) sv.onclick = () => { collect(); const miss = need(); if (miss.length) return toast('⚠️ ' + miss.join(', ')); store(); toast('💾 ' + t('បានរក្សាទុក', 'Saved')); const id = F.id; F = null; location.hash = '#/r/' + id; };
  }
  function store() { const i = DATA.findIndex(x => x.id === F.id); if (i >= 0) DATA[i] = Object.assign({}, F); else DATA.push(Object.assign({}, F)); save(); }

  // ------------------------------------------------------------------ one receipt
  function renderOne(id) {
    paintTabs('');
    const r = byId(id); if (!r) { location.hash = '#/'; return; }
    const m = spentMin(r), p = prod(r);
    const kv = (lbl, v, full) => `<div${full ? ' class="full"' : ''}><small>${lbl}</small><b>${v}</b></div>`;
    view(`
      <div class="head2"><h2>🚛 ${esc(r.truck)}</h2><a class="link" href="#/">✕</a></div>
      <div style="margin:-4px 2px 12px">${badges(r)}</div>
      <section class="card"><div class="kvs">
        ${kv(t('លេខ PO', 'PO Number'), 'PO ' + esc(r.po))}${kv(t('លេខ Inbound', 'Inbound Number'), 'IN ' + esc(r.inbound))}
        ${kv(t('ផ្លាកលេខឡាន / រ៉ឺម៉ក', 'Truck / trailer'), esc(r.truck))}${kv(t('ម្ចាស់ឡាន', 'Truck owner'), esc(ownerTxt(r)))}
        ${kv(t('បរិមាណ PO', 'PO Qty'), fmt(r.poQty, 2) + ' ' + esc(r.uom))}${kv(t('បរិមាណ DN', 'DN Qty'), fmt(r.dnQty, 2) + ' ' + esc(r.uom))}
        ${kv(t('ទទួលជាក់ស្តែង', 'Actual receipt Qty'), r.actQty === '' ? '–' : fmt(r.actQty, 2) + ' ' + esc(r.uom))}${kv(t('ថ្ងៃទទួល', 'Receipt date'), showDate(r.date))}
        ${kv(t('ម៉ោងចាប់ផ្តើម', 'Start time'), esc(r.start))}${kv(t('ម៉ោងបញ្ចប់', 'End time'), esc(r.end || '–'))}
        ${kv(t('រយៈពេល', 'Time spent'), (isLive(r) ? '⏱ ' : '') + showSpent(m))}${kv(t('ផលិតភាព', 'Productivity'), p == null ? '–' : fmt(p, 1) + ' <small>' + esc(prodUnit(r)) + '</small>')}
        ${kv(t('ចំនួនកម្មករ', 'Manpower'), '👷 ' + esc(r.manpower))}${kv(t('ខូចខាត?', 'Damaged?'), r.end ? (r.damaged ? '⚠️ ' + t('បាទ/ចាស', 'Yes') : t('ទេ', 'No')) : '–')}
        ${r.damaged ? kv(t('ព័ត៌មានលម្អិតការខូចខាត', 'Damage detail'), esc(r.damageDetail || '–'), 1) : ''}
        ${kv(t('សំគាល់', 'Remark'), esc(r.remark || '–'), 1)}
        ${kv(t('កត់ត្រាដោយ', 'Recorded by'), esc(r.by || '–'), 1)}
      </div>
      ${r.photos ? `<div class="photos mt">${Array.from({ length: r.photos }, () => '<div class="ph">🖼️</div>').join('')}</div>` : ''}
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
    const tr = rows.filter(r => tons(r) != null && prod(r) != null);
    const manH = tr.reduce((s, r) => s + spentMin(r) / 60 * r.manpower, 0);
    const avgP = manH ? tr.reduce((s, r) => s + tons(r), 0) / manH : null;
    const dmg = rows.filter(r => r.damaged).length, diff = rows.filter(r => diffPct(+r.actQty, +r.dnQty)).length;
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
        <div class="stat"><small>${t('ខុសពី DN', 'Qty ≠ DN')}</small><b style="color:var(--warn)">${diff}</b></div>
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
