/**
 * Gate vs Scale (Kim, 14 Nov 2026), under the Dashboard tile: the Inbound team and the Truck Scale team both write down
 * the plate of every truck that comes in to unload. This page puts the two lists side by side for the chosen days and
 * shows which trucks match, which plates were typed differently, and which truck is on one list only.
 * Reads the two existing Apps Scripts with the user's iSteel sign-in (Inbound "boot", Scale "scList"); nothing is saved,
 * so no Apps Script change is needed. Matching rules: gs-core.js.
 */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const t = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* full or private window */ } };
  const getJ = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };
  const C = window.GSCORE;
  const IB_API = (window.IB_CONFIG || {}).API_URL, SC_API = (window.SC_CONFIG || {}).API_URL;
  const TOKEN_KEY = 'fr_id_token';
  const pad = n => ('0' + n).slice(-2);
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ymd(new Date());
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dShow = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '-' + MON[+m[2] - 1] : ''; };
  const hm = v => { const m = String(v || '').match(/[T ](\d{1,2}:\d{2})/); return m ? m[1].padStart(5, '0') : ''; };
  const num = v => (v === '' || v == null ? '' : Number(v).toLocaleString('en-US'));
  let toastT = 0;
  function toast(m) { const el = $('#toast'); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3000); }

  // ---------------------------------------------------------------- sign-in + the two Apps Scripts
  function claims() {
    try { return JSON.parse(decodeURIComponent(escape(atob((get(TOKEN_KEY) || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch (e) { return null; }
  }
  const signedIn = () => { const c = claims(); return !!(c && c.exp * 1000 > Date.now() + 60000); };
  const msgOf = e => { const s = String(e || 'Error'); const m = s.match(/^([A-Z_]+):\s*([\s\S]*)$/); const txt = m ? m[2] : s; const p = txt.split(' || '); return t(p[1] || p[0], p[0]); };
  async function api(url, action, payload) {
    let data;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: get(TOKEN_KEY), payload: payload || {} }) });
      data = await res.json();
    } catch (e) { throw new Error(t('មិនអាចភ្ជាប់អ៊ីនធឺណិត។', 'No connection.')); }
    if (!data.ok) throw new Error(msgOf(data.error));
    if (data.session) set(TOKEN_KEY, data.session);
    return data.data;
  }

  // ---------------------------------------------------------------- data, kept on this device so the page opens at once
  // Only the fields this page uses are kept (photos and the rest stay on the server).
  const slimR = r => ({ id: r.id, status: r.status, truck: r.truck, date: r.date, start: r.start, end: r.end, site: r.site, warehouse: r.warehouse,
    carrier: r.carrier, owner: r.owner, po: r.po, uom: r.uom, by: r.by, items: (r.items || []).map(i => ({ grQty: i.grQty, arrQty: i.arrQty })) });
  const slimT = x => ({ no: x.no, status: x.status, plate: x.plate, type: x.type, t1: x.t1, t2: x.t2, w1: x.w1, w2: x.w2, net: x.net, company: x.company, driver: x.driver, created: x.created });
  let IB = getJ('gs_ib', null);          // { at, receipts }
  let SC = getJ('gs_sc', null);          // { at, from, to, tickets }
  let ERR = { ib: '', sc: '' };
  let F = Object.assign({ st: 'all', wh: '', q: '' }, getJ('gs_f', {}), { from: today(), to: today() });
  const saveF = () => set('gs_f', JSON.stringify({ st: F.st, wh: F.wh, q: F.q }));
  let busy = false;

  async function load() {
    if (busy) return;
    if (!signedIn()) { render(); return; }
    busy = true;
    const lo = C.addDays(F.from, -1), hi = C.addDays(F.to, 1);
    const [a, b] = await Promise.allSettled([api(IB_API, 'boot'), api(SC_API, 'scList', { from: lo, to: hi, all: true })]);
    busy = false;
    if (a.status === 'fulfilled') { IB = { at: Date.now(), receipts: (a.value.receipts || []).map(slimR) }; ERR.ib = ''; set('gs_ib', JSON.stringify(IB)); }
    else ERR.ib = a.reason.message;
    if (b.status === 'fulfilled') { SC = { at: Date.now(), from: lo, to: hi, tickets: (b.value.tickets || []).map(slimT) }; ERR.sc = ''; set('gs_sc', JSON.stringify(SC)); }
    else ERR.sc = b.reason.message;
    if (window.LIVE) LIVE.keep(render); else render();
  }
  // The Scale list in memory covers the days asked for (with one day each side)?
  const scCovers = () => SC && SC.from <= C.addDays(F.from, -1) && SC.to >= C.addDays(F.to, 1);

  // ---------------------------------------------------------------- screen
  const ST = {
    ok: ['✅', 'ត្រូវគ្នា', 'Matched', 'ok'],
    day: ['✅', 'ត្រូវគ្នា (ឆ្លងថ្ងៃ)', 'Matched (overnight)', 'ok'],
    typo: ['🟠', 'ផ្លាកលេខខុសគ្នា', 'Plate typed differently', 'typo'],
    ib: ['🔴', 'មានតែ Inbound', 'Inbound only', 'ib'],
    sc: ['🟣', 'មានតែជញ្ជីង', 'Scale only', 'sc'],
  };
  const GROUPS = [['ok', '✅', 'ត្រូវគ្នា', 'Matched'], ['typo', '🟠', 'ផ្លាកលេខខុសគ្នា', 'Plate differs'], ['ib', '🔴', 'មានតែ Inbound', 'Inbound only'], ['sc', '🟣', 'មានតែជញ្ជីង', 'Scale only']];
  const groupOf = st => ST[st][3];

  function noteOf(w) {
    const n = [];
    if (w.st === 'typo') n.push(t('Inbound៖ ', 'Inbound: ') + w.ib.truck + ' · ' + t('ជញ្ជីង៖ ', 'Scale: ') + w.sc.plate);
    if (w.st === 'day') n.push(t('ថ្លឹងលើកទី១ ថ្ងៃ ', '1st weigh on ') + dShow(w.sc.t1));
    if (w.st === 'ib') n.push(w.outNo ? t('មានលើជញ្ជីង ជា "ឡើងទំនិញ" ', 'On the Scale as Load ') + w.outNo : t('គ្មានប័ណ្ណថ្លឹង', 'No Scale ticket'));
    if (w.st === 'sc') n.push(t('គ្មានកំណត់ត្រា Inbound', 'No Inbound record'));
    if (w.sc && w.sc.status === 'Open') n.push(t('ឡាននៅក្នុងរោងចក្រ', 'Truck still on site'));
    if (w.ib && w.ib.status && w.ib.status !== 'Done') n.push(t('កំពុងទម្លាក់', 'Unloading'));
    return n.join(' · ');
  }
  const bigDiff = w => w.diff !== '' && Math.abs(w.diff) > Math.max(200, 0.01 * (w.scKg || 0));

  function rowsNow() {
    const all = IB && SC ? C.match(IB.receipts, SC.tickets, F.from, F.to) : [];
    const q = C.norm(F.q);
    const byWh = all.filter(w => !F.wh || (w.ib ? w.ib.site === F.wh : true));
    return { all: byWh, rows: byWh.filter(w => (F.st === 'all' || groupOf(w.st) === F.st) && (!q || [w.ib && w.ib.truck, w.sc && w.sc.plate, w.ib && w.ib.id, w.sc && w.sc.no].some(v => C.norm(v).indexOf(q) >= 0))) };
  }

  // Header colour and emoji per source app (Kim, 14 Nov 2026): 📦 Inbound teal, ⚖️ Scale amber, both / neither navy.
  const SRC = { ib: '📦', sc: '⚖️' };
  const COLS = [
    ['st', 'ស្ថានភាព', 'Status'], ['date', 'ថ្ងៃ', 'Date'], ['ibp', 'ផ្លាកលេខ', 'Plate', 'ib'], ['scp', 'ផ្លាកលេខ', 'Plate', 'sc'],
    ['rid', 'លេខ Inbound', 'Receipt No', 'ib'], ['unl', 'ម៉ោងទម្លាក់', 'Unload time', 'ib'], ['wh', 'ឃ្លាំង', 'Warehouse', 'ib'], ['carrier', 'ក្រុមហ៊ុនដឹក', 'Carrier', 'ib'],
    ['tk', 'លេខប័ណ្ណថ្លឹង', 'Ticket No', 'sc'], ['w', 'ថ្លឹង ចូល–ចេញ', 'Weigh in–out', 'sc'], ['co', 'ក្រុមហ៊ុនឡាន', 'Truck company', 'sc'],
    ['ikg', 'ទទួល (kg)', 'GR (kg)', 'ib'], ['skg', 'Net (kg)', 'Net (kg)', 'sc'], ['dkg', 'ខុសគ្នា (kg)', 'Diff (kg)'], ['note', 'កំណត់សម្គាល់', 'Note'],
  ];
  const thOf = c => `<th class="${[c[3] ? 'src-' + c[3] : '', /^(ikg|skg|dkg)$/.test(c[0]) ? 'n' : ''].filter(Boolean).join(' ')}"${c[3] ? ` title="${c[3] === 'ib' ? 'Inbound' : t('ជញ្ជីង', 'Truck Scale')}"` : ''}>${c[3] ? SRC[c[3]] + ' ' : ''}${t(c[1], c[2])}</th>`;
  function cell(k, w) {
    const ib = w.ib || {}, sc = w.sc || {};
    switch (k) {
      case 'st': return `<td class="st ${ST[w.st][3]}">${ST[w.st][0]} ${t(ST[w.st][1], ST[w.st][2])}</td>`;
      case 'date': return `<td class="nw">${dShow(w.date)}</td>`;
      case 'ibp': return `<td class="pl${w.st === 'typo' ? ' bad' : ''}">${esc(ib.truck || '')}</td>`;
      case 'scp': return `<td class="pl${w.st === 'typo' ? ' bad' : ''}">${esc(sc.plate || '')}</td>`;
      case 'rid': return `<td class="nw">${ib.id ? `<a href="../inbound/#/r/${encodeURIComponent(ib.id)}" target="_blank" rel="noopener">${esc(ib.id)}</a>` : ''}</td>`;
      case 'unl': return `<td class="nw">${esc(ib.start || '')}${ib.end ? '–' + esc(ib.end) : ''}</td>`;
      case 'wh': return `<td class="nw">${esc([ib.site, ib.warehouse].filter(Boolean).join(' · '))}</td>`;
      case 'carrier': return `<td>${esc(ib.carrier || ib.owner || '')}</td>`;
      case 'tk': return `<td class="nw">${sc.no ? `<a href="../scale/#/t/${encodeURIComponent(sc.no)}" target="_blank" rel="noopener">${esc(sc.no)}</a>` : ''}</td>`;
      case 'w': return `<td class="nw">${sc.t1 ? (w.st === 'day' ? dShow(sc.t1) + ' ' : '') + hm(sc.t1) + '–' + (sc.t2 ? (String(sc.t2).slice(0, 10) !== String(sc.t1).slice(0, 10) ? dShow(sc.t2) + ' ' : '') + hm(sc.t2) : '…') : ''}</td>`;
      case 'co': return `<td>${esc(sc.company || '')}</td>`;
      case 'ikg': return `<td class="n">${num(w.ibKg)}</td>`;
      case 'skg': return `<td class="n">${num(w.scKg)}</td>`;
      case 'dkg': return `<td class="n${bigDiff(w) ? ' warn' : ''}">${w.diff === '' ? '' : (w.diff > 0 ? '+' : '') + num(w.diff)}</td>`;
      case 'note': return `<td class="note">${esc(noteOf(w))}</td>`;
    }
    return '<td></td>';
  }
  const stamp = at => { if (!at) return '–'; const d = new Date(at); return pad(d.getDate()) + '-' + MON[d.getMonth()] + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  function render() {
    if (!IB_API || !SC_API) { $('#view').innerHTML = `<div class="card empty">${t('មិនទាន់កំណត់ Inbound ឬ ជញ្ជីង។', 'Inbound or Scale is not set up.')}</div>`; return; }
    if (!signedIn() && !(IB && SC)) {
      $('#view').innerHTML = `<div class="card empty">${t('សូមចូលគណនីពីទំព័រដើមជាមុនសិន។', 'Please sign in from the Home page first.')}<br><a class="gs-link" href="../">‹ ${t('ទំព័រដើម', 'Home')}</a></div>`;
      return;
    }
    const { all, rows } = rowsNow();
    const cnt = { ok: 0, typo: 0, ib: 0, sc: 0 };
    all.forEach(w => { cnt[groupOf(w.st)]++; });
    const sites = []; ((IB && IB.receipts) || []).forEach(r => { if (r.site && sites.indexOf(r.site) < 0) sites.push(r.site); });
    const quick = [['t', t('ថ្ងៃនេះ', 'Today')], ['y', t('ម្សិលមិញ', 'Yesterday')], ['7', t('៧ ថ្ងៃ', '7 days')], ['30', t('៣០ ថ្ងៃ', '30 days')]];
    const qOn = F.from === today() && F.to === today() ? 't' : F.from === C.addDays(today(), -1) && F.to === F.from ? 'y'
      : F.to === today() && F.from === C.addDays(today(), -6) ? '7' : F.to === today() && F.from === C.addDays(today(), -29) ? '30' : '';
    const errs = [ERR.ib && `Inbound: ${esc(ERR.ib)}`, ERR.sc && `${t('ជញ្ជីង', 'Scale')}: ${esc(ERR.sc)}`].filter(Boolean);
    const total = all.length, okPct = total ? Math.round(cnt.ok / total * 100) : 0;
    const ibDays = IB && IB.receipts.length ? IB.receipts.reduce((m, r) => (r.date && r.date < m ? r.date : m), '9999') : '';
    const old = ibDays && F.from < ibDays;

    $('#view').innerHTML = `
      <div class="fb-wrap">${FB.head('gs', `⚖️ ${t('ផ្ទៀងផ្ទាត់ ឡានចូល Inbound ទល់ ជញ្ជីង', 'Inbound trucks vs Truck Scale')}`,
        `<button class="fb-btn" id="xls" type="button">${FB.xl} Excel</button>`, () => { F.st = 'all'; F.wh = ''; F.q = ''; F.from = F.to = today(); saveF(); render(); load(); })}
      ${FB.panel('gs', FB.seg(quick, qOn, 'qd') + FB.range('dFrom', 'dTo', F.from, F.to) + FB.show('dGo') +
        (sites.length > 1 ? FB.field('🏭 ' + t('ឃ្លាំង', 'Warehouse'), `<select id="wh"><option value="">${t('ទាំងអស់', 'All')}</option>${sites.map(s => `<option${s === F.wh ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>`) : '') +
        FB.search('q', t('ស្វែងរក៖ ផ្លាកលេខ, លេខ Inbound, លេខប័ណ្ណ', 'Search: plate, receipt no, ticket no'), F.q))}</div>
      ${errs.length ? `<div class="gs-err">⚠️ ${errs.join('<br>')}</div>` : ''}
      ${old ? `<div class="gs-err">⚠️ ${t('Inbound បង្ហាញតែចាប់ពីថ្ងៃ ', 'Inbound only sends receipts from ')}${dShow(ibDays)}</div>` : ''}
      <div class="gs-cards">
        ${GROUPS.map(g => `<button type="button" class="gs-card ${g[0]}${F.st === g[0] ? ' on' : ''}" data-st="${g[0]}"><span>${g[1]} ${t(g[2], g[3])}</span><b>${cnt[g[0]]}</b></button>`).join('')}
        <div class="gs-card pct"><span>${t('ត្រូវគ្នា', 'Match rate')}</span><b>${okPct}%</b><small>${total} ${t('ជើង', 'trips')}</small></div>
      </div>
      <div class="gs-src"><span class="key rate">${t('ត្រូវគ្នា', 'Match rate')} ${okPct}% · ${total} ${t('ជើង', 'trips')}</span><span class="key ib">📦 Inbound · ${stamp(IB && IB.at)}</span><span class="key sc">⚖️ ${t('ជញ្ជីង', 'Truck Scale')} · ${stamp(SC && SC.at)}</span>${F.st !== 'all' ? `<button type="button" class="gs-link" data-st="all">✕ ${t('បង្ហាញទាំងអស់', 'Show all')}</button>` : ''}</div>
      ${(!IB || !SC || !scCovers()) && (busy || (!ERR.ib && !ERR.sc)) ? `<div class="spinner" role="status"></div>` : !IB || !SC || !scCovers() ? '' : rows.length ? `
      <div class="tbl-wrap"><table class="gs-tbl" data-tc="gs">
        <thead><tr>${COLS.map(thOf).join('')}</tr></thead>
        <tbody>${rows.map(w => `<tr class="r-${ST[w.st][3]}">${COLS.map(c => cell(c[0], w)).join('')}</tr>`).join('')}</tbody>
      </table></div>` : `<div class="card empty">${total ? t('គ្មានជួរត្រូវនឹងតម្រង', 'No rows match the filter') : t('គ្មានឡានចូលទម្លាក់ទំនិញក្នុងថ្ងៃទាំងនេះ', 'No trucks came in to unload on these days')}</div>`}
      <p class="gs-help">${t('ប្រៀបធៀប៖ កំណត់ត្រា Inbound ទល់ ប័ណ្ណថ្លឹង "ទំលាក់ទំនិញ" (មិនរាប់ប័ណ្ណបានលុប)។ ត្រូវគ្នា = ផ្លាកលេខដូចគ្នា ថ្ងៃដូចគ្នា ឬឡាននៅលើទីតាំងឆ្លងថ្ងៃ។ ផ្លាកលេខខុសគ្នា = ខុសតែ ១ តួអក្សរ សូមពិនិត្យ។',
        'Compares Inbound records with Scale tickets ticked Unload (cancelled tickets left out). Matched = same plate on the same day, or the truck stayed on site overnight. Plate typed differently = one letter or digit apart, please check which is right.')}</p>`;
    paintNav(cnt, total);
    wire();
  }

  // Side menu on computers (Kim picked mockup C, 14 Nov 2026): Home, Dashboards, then the status filters with their counts.
  // Phones keep the 3-button bottom bar (Home, Dashboards, Cross-check) and the count cards above the table.
  function paintNav(cnt, total) {
    const nav = $('nav.tabs'); if (!nav) return;
    const item = (st, ico, km, en, n) => `<a href="#" class="tab flt${F.st === st ? ' on' : ''}" data-st="${st}"><span aria-hidden="true">${ico}</span><b>${t(km, en)}</b><i class="cnt">${n}</i></a>`;
    nav.innerHTML = `<a href="../" class="tab"><img src="../icons/home.svg" alt="" width="24" height="24"><b>${t('ទំព័រដើម', 'Home')}</b></a>
      <a href="../dashboards/" class="tab"><img src="../icons/dashboard.svg" alt="" width="24" height="24"><b>${t('ផ្ទាំងព័ត៌មាន', 'Dashboards')}</b></a>
      <a href="#" class="tab cur on"><span aria-hidden="true">⚖️</span><b>${t('ផ្ទៀងផ្ទាត់', 'Cross-check')}</b></a>
      <div class="nav-sec">${t('ច្រកចូល ទល់ ជញ្ជីង', 'Gate vs Scale')}</div>
      ${item('all', '📋', 'ជើងទាំងអស់', 'All trips', total)}${GROUPS.map(g => item(g[0], g[1], g[2], g[3], cnt[g[0]])).join('')}`;
  }

  function wire() {
    $$('[data-st]').forEach(b => { b.onclick = e => { e.preventDefault(); F.st = b.dataset.st === 'all' || F.st === b.dataset.st ? 'all' : b.dataset.st; saveF(); render(); }; });
    $$('[data-qd]').forEach(b => {
      b.onclick = () => {
        const k = b.dataset.qd, td = today();
        if (k === 't') F.from = F.to = td;
        if (k === 'y') F.from = F.to = C.addDays(td, -1);
        if (k === '7') { F.from = C.addDays(td, -6); F.to = td; }
        if (k === '30') { F.from = C.addDays(td, -29); F.to = td; }
        go();
      };
    });
    const go = () => { if (F.from > F.to) { const x = F.from; F.from = F.to; F.to = x; } render(); if (!scCovers()) load(); };
    const dGo = $('#dGo');
    if (dGo) dGo.onclick = () => { F.from = $('#dFrom').value || today(); F.to = $('#dTo').value || F.from; go(); };
    const wh = $('#wh'); if (wh) wh.onchange = () => { F.wh = wh.value; saveF(); render(); };
    const q = $('#q');
    if (q) q.oninput = () => { F.q = q.value; saveF(); const p = q.selectionStart; render(); const n = $('#q'); if (n) { n.focus(); n.setSelectionRange(p, p); } };
    const x = $('#xls'); if (x) x.onclick = excel;
  }

  // ---------------------------------------------------------------- Excel
  function xlsxLib() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = '../vendor/xlsx.mini.min.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  }
  async function excel() {
    const { rows } = rowsNow();
    if (!rows.length) { toast(t('គ្មានទិន្នន័យ', 'Nothing to export')); return; }
    try { await xlsxLib(); } catch (e) { toast(t('មិនអាចផ្ទុក Excel', 'Could not load Excel')); return; }
    const head = ['Status', 'Date', 'Plate (Inbound)', 'Plate (Scale)', 'Receipt No', 'Unload start', 'Unload end', 'Warehouse', 'Entrance', 'Carrier (Inbound)',
      'Ticket No', '1st weigh', '2nd weigh', 'Truck company (Scale)', 'Inbound (kg)', 'Scale net (kg)', 'Diff (kg)', 'Note'];
    const data = rows.map(w => { const ib = w.ib || {}, sc = w.sc || {}; return [ST[w.st][2], w.date, ib.truck || '', sc.plate || '', ib.id || '', ib.start || '', ib.end || '', ib.site || '', ib.warehouse || '',
      ib.carrier || ib.owner || '', sc.no || '', String(sc.t1 || '').replace('T', ' ').slice(0, 16), String(sc.t2 || '').replace('T', ' ').slice(0, 16), sc.company || '', w.ibKg, w.scKg, w.diff,
      noteOf(w)]; });
    const ws = XLSX.utils.aoa_to_sheet([head].concat(data));
    ws['!cols'] = head.map((h, i) => ({ wch: [24, 11, 14, 14, 14, 9, 9, 10, 9, 16, 15, 17, 17, 22, 12, 12, 10, 40][i] }));
    ws['!autofilter'] = { ref: 'A1:R' + (data.length + 1) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Gate vs Scale');
    XLSX.writeFile(wb, 'Gate_vs_Scale_' + F.from + (F.to !== F.from ? '_to_' + F.to : '') + '.xlsx');
  }

  // ---------------------------------------------------------------- bar buttons, refresh
  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const paintTheme = () => { const th = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); $('#themeBtn').textContent = th === 'dark' ? '☀️' : '🌙'; };
  $('#themeBtn').onclick = () => { const now = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); const next = now === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); set('fr_theme', next); paintTheme(); };
  paintTheme();
  const paintStatic = () => $$('[data-km]').forEach(el => { el.textContent = t(el.dataset.km, el.dataset.en); });
  if (window.LANG) { LANG.button($('#langBtn')); LANG.onChange(() => { paintStatic(); render(); }); }
  paintStatic();
  window.ISTEEL_REFRESH = () => { render(); load(); };
  render();
  load();
  if (window.LIVE) LIVE.start({ run: load, every: 120000, busy: () => busy });
})();
