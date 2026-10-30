// 👥 User Management (Kim, 28 Oct 2026): admins manage everyone for every iSteel app from one screen.
// It reads and writes the same Users tab every app already uses, through the Fuel Refill Apps Script (Code.gs).
// Nobody is deleted: switching a person off keeps their history. Every change goes to the "User Log" tab.
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  // ?demo opens sample people (nothing is read from or saved to the Sheet), so the screens can be tried safely.
  const DEMO = !CFG.API_URL || /[?&]demo\b/.test(location.search);
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const t = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const wide = () => window.matchMedia('(min-width: 900px)').matches;

  // Same names as the home menu tiles; the server sends which ones have a column in Users.
  const APP_NAMES = {
    fuel: ['ចាក់សាំង', 'Fuel Refill'], transport: ['ដឹកជញ្ជូន', 'Transport'], overtime: ['ថែមម៉ោង', 'Overtime'],
    location: ['ទីតាំងថ្មី', 'New Location'], meeting: ['ប្រជុំ', 'Meetings'], incident: ['គ្រោះថ្នាក់', 'Incident Report'],
    inbound: ['ទទួលទំនិញ', 'Inbound'], dashboard: ['Dashboard', 'Fuel Dashboard'],
  };
  const appName = a => { const n = APP_NAMES[a.key]; return n ? t(n[0], n[1]) : a.col; };
  const appIcon = (key, size) => `<img src="../icons/${esc(key)}.svg" alt="" width="${size}" height="${size}">`;
  // One Role column for every app (Kim, 30 Oct 2026). The job roles say which Delivery steps a person records.
  const ROLES = [['user', 'អ្នកប្រើ', 'User', 'ប្រើកម្មវិធី', 'Uses the apps'],
    ['driver', 'តៃកុង', 'Driver', 'ដឹកជញ្ជូន៖ ជំហានតៃកុង', 'Delivery: driver steps'],
    ['security', 'សន្តិសុខ', 'Security', 'ដឹកជញ្ជូន៖ ចូល/ចេញ ថ្លឹង', 'Delivery: gate in and out'],
    ['warehouse', 'ឃ្លាំង', 'Warehouse', 'ដឹកជញ្ជូន៖ ជំហានឃ្លាំង', 'Delivery: loading steps'],
    ['logistics', 'ភស្តុភារ', 'Logistics', 'ដឹកជញ្ជូន៖ ជំហានភស្តុភារ', 'Delivery: logistics steps'],
    ['reviewer', 'អ្នកពិនិត្យ', 'Reviewer', 'ពិនិត្យការចាក់សាំង គ្រោះថ្នាក់ ទទួលទំនិញ', 'Checks Fuel, Incident and Inbound entries'],
    ['supervisor', 'ប្រធាន', 'Supervisor', 'ពិនិត្យ + គ្រប់ជំហានដឹកជញ្ជូន', 'Checks entries + every Delivery step'],
    ['admin', 'Admin', 'Admin', 'គ្រប់យ៉ាង', 'Everything']];
  const isChecker = r => r === 'reviewer' || r === 'supervisor';
  const roleName = r => { const x = ROLES.find(y => y[0] === r) || ROLES[0]; return t(x[1], x[2]); };
  const COLORS = ['#0B76A0', '#084F6A', '#7a5af8', '#d9480f', '#2b8a3e', '#c2255c', '#5c7cfa', '#e67700', '#0c8599', '#9c36b5'];
  const color = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const initials = u => (u.name || u.email).split(/[\s.@_-]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const avatar = (u, cls) => `<span class="av ${cls || ''}" style="background:${u.active ? color(u.email) : '#9aa5b1'}">${esc(initials(u))}</span>`;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p2 = n => String(n).padStart(2, '0');
  const when = ms => { if (!ms) return ''; const d = new Date(ms); return `${p2(d.getDate())}-${MON[d.getMonth()]}-${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const isWaiting = u => !u.active && !u.offAt;

  // ------------------------------------------------------------------ data
  let D = null;        // { me, users, apps, depts, log }
  let OT = null;       // OT line managers, loaded when an edit screen needs them
  let otBusy = null;
  const sel = new Set();   // selected people in the computer table
  const F = { q: '', chip: 'all', dept: '' };   // dept: '' = every department, '-' = no department
  const TOKEN_KEY = 'fr_id_token';
  const claims = () => { try { return JSON.parse(decodeURIComponent(escape(atob((get(TOKEN_KEY) || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; } };
  const signedIn = () => { const c = claims(); return !!(c && c.exp * 1000 > Date.now() + 60000); };
  const bootKey = () => 'um_boot_' + ((claims() || {}).email || 'demo');
  const save = () => { if (!DEMO && D) set(bootKey(), JSON.stringify(D)); };
  const byEmail = e => D.users.find(u => u.email === e);
  function merge(users) { (users || []).forEach(u => { const i = D.users.findIndex(x => x.email === u.email); if (i >= 0) D.users[i] = u; else D.users.push(u); }); }
  function addLog(log) { if (log && log.length) D.log = log.concat(D.log).slice(0, 100); }

  // The server's messages are "English / ខ្មែរ": show the half for the chosen language.
  const msgText = s => { const m = String(s || 'Error').match(/^([A-Z_]+):\s*([\s\S]*)$/); const txt = m ? m[2] : String(s); const p = txt.split(' / '); return { code: m ? m[1] : '', text: p.length > 1 ? t(p.slice(1).join(' / '), p[0]) : txt }; };
  async function api(action, payload) {
    if (DEMO) return demoApi(action, payload || {});
    let data;
    try {
      const res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: get(TOKEN_KEY), payload: payload || {} }) });
      data = await res.json();
    } catch (e) {
      throw Object.assign(new Error(t('មិនអាចភ្ជាប់អ៊ីនធឺណិត។ សូមព្យាយាមម្តងទៀត។', 'No connection. Please try again.')), { code: 'NET' });
    }
    if (!data.ok) {
      const m = msgText(data.error);
      // Apps Script not updated yet
      if (/Unknown action/i.test(data.error)) throw Object.assign(new Error(t('សូមបិទភ្ជាប់ Code.gs ថ្មី រួច Deploy (New version)។', 'Please paste the new Code.gs and deploy a New version.')), { code: 'OLD' });
      throw Object.assign(new Error(m.text), { code: m.code });
    }
    if (data.session) set(TOKEN_KEY, data.session);
    return data.data;
  }

  // ------------------------------------------------------------------ chrome
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { el.hidden = true; }, 2600); }
  function paintStatic() { $$('[data-km]').forEach(el => { el.textContent = t(el.dataset.km, el.dataset.en); }); }
  function paintTabs(r) {
    $$('.tab[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === r));
    const n = D ? D.users.filter(isWaiting).length : 0;
    const c = $('#reqCount'); c.textContent = n; c.hidden = !n;
  }
  const view = html => { $('#view').innerHTML = html; };
  function blocked(e) {
    $('#tabs').hidden = true;
    const auth = e.code === 'AUTH' || !signedIn();
    view(`<div class="card done"><div class="emoji">${auth ? '👋' : '🔒'}</div>
      <h2>${auth ? t('សូមចូលគណនីនៅទំព័រដើម', 'Please sign in on the home menu') : e.code === 'OLD' ? t('ត្រូវធ្វើបច្ចុប្បន្នភាព Apps Script', 'Apps Script needs an update') : t('សម្រាប់តែ Admin', 'Admins only')}</h2>
      <p>${esc(auth ? '' : e.message)}</p><a class="btn ok" href="../">${t('ទៅទំព័រដើម', 'Go to the home menu')}</a></div>`);
  }

  // ------------------------------------------------------------------ router
  function screen() {
    if (!D) return;
    $('#tabs').hidden = false;
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    if (h === 'req') return renderReq();
    if (h === 'dept') return renderDept();
    if (h === 'log') return renderLog();
    if (h === 'new') return renderEdit(null);
    if (h.indexOf('u/') === 0) return renderEdit(h.slice(2));
    return renderList();
  }
  const go = h => { if (location.hash === h) screen(); else location.hash = h; };

  // ------------------------------------------------------------------ list
  const inDept = u => !F.dept || (F.dept === '-' ? !u.dept : u.dept === F.dept);
  function deptNames() { const n = D.depts.map(d => d.name); D.users.forEach(u => { if (u.dept && n.indexOf(u.dept) < 0) n.push(u.dept); }); return n.sort((a, b) => a.localeCompare(b)); }
  function chipList() {
    const us = D.users.filter(inDept);
    const c = [['all', t('ទាំងអស់', 'All'), us.filter(u => !isWaiting(u)).length],
      ['admin', 'Admin', us.filter(u => u.role === 'admin').length],
      ['reviewer', t('អ្នកពិនិត្យ', 'Reviewer'), us.filter(u => isChecker(u.role)).length],
      ['off', t('បិទ', 'Off'), us.filter(u => !u.active && u.offAt).length]];
    D.apps.forEach(a => c.push(['app:' + a.key, appName(a), us.filter(u => u.active && u.apps[a.key]).length, a.key]));
    return c;
  }
  function filtered() {
    const q = F.q.trim().toLowerCase();
    return D.users.filter(u => {
      if (!inDept(u)) return false;
      if (F.chip === 'all' && isWaiting(u)) return false;
      if (F.chip === 'admin' && u.role !== 'admin') return false;
      if (F.chip === 'reviewer' && !isChecker(u.role)) return false;
      if (F.chip === 'off' && !(!u.active && u.offAt)) return false;
      if (F.chip.indexOf('app:') === 0 && !(u.active && u.apps[F.chip.slice(4)])) return false;
      if (!q) return true;
      return [u.name, u.email, u.empId, u.dept, roleName(u.role)].join(' ').toLowerCase().indexOf(q) >= 0;
    }).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  }
  const pill = u => `<span class="rp ${u.role}">${esc(roleName(u.role))}</span>${isWaiting(u) ? ` <span class="rp wait">${t('រង់ចាំ', 'Waiting')}</span>` : ''}`;
  const sw = (on, attrs, label) => `<button type="button" class="sw${on ? ' on' : ''}" role="switch" aria-checked="${!!on}" aria-label="${esc(label || '')}" ${attrs}></button>`;

  function renderList() {
    paintTabs('list');
    const us = D.users, waiting = us.filter(isWaiting).length;
    view(`<div class="um-head"><h1>👥 ${t('គ្រប់គ្រងអ្នកប្រើ', 'User Management')}</h1>
        <a class="btn ok add" href="#/new">＋ ${t('បន្ថែមអ្នកប្រើ', 'Add user')}</a></div>
      <div class="stats"><div><b>${us.filter(u => u.active).length}</b><small>${t('សកម្ម', 'Active')}</small></div>
        <div><b>${us.filter(u => !u.active && u.offAt).length}</b><small>${t('បិទ', 'Off')}</small></div>
        <a href="#/req" class="${waiting ? 'warn' : ''}"><b>${waiting}</b><small>${t('សំណើរង់ចាំ', 'Requests')}</small></a></div>
      ${waiting ? `<a class="reqbar" href="#/req">📨 <b>${t('សំណើថ្មី', 'New requests')} ${waiting}</b><span>${t('មើល', 'Open')} ›</span></a>` : ''}
      <div class="filters"><div class="frow"><input class="in q" id="q" type="search" placeholder="🔍 ${t('ស្វែងរក ឈ្មោះ អ៊ីមែល ID ផ្នែក…', 'Search name, email, ID, department…')}" value="${esc(F.q)}">
        <select class="in dsel${F.dept ? ' on' : ''}" id="fDeptF" aria-label="${t('ផ្នែក', 'Department')}"><option value="">🏢 ${t('គ្រប់ផ្នែក', 'All departments')}</option>${deptNames().map(d => `<option value="${esc(d)}" ${F.dept === d ? 'selected' : ''}>${esc(d)} (${D.users.filter(u => u.dept === d && !isWaiting(u)).length})</option>`).join('')}${D.users.some(u => !u.dept) ? `<option value="-" ${F.dept === '-' ? 'selected' : ''}>${t('គ្មានផ្នែក', 'No department')}</option>` : ''}</select></div>
        <div class="chips">${chipList().map(c => `<button type="button" class="chip${F.chip === c[0] ? ' on' : ''}" data-chip="${c[0]}">${c[3] ? appIcon(c[3], 16) : ''}${esc(c[1])} <small>${c[2]}</small></button>`).join('')}</div></div>
      <div id="bulk"></div><div id="res"></div>`);
    $('#q').oninput = e => { F.q = e.target.value; drawResults(); };
    $('#fDeptF').onchange = e => { F.dept = e.target.value; sel.clear(); renderList(); };
    $$('[data-chip]').forEach(b => b.onclick = () => { F.chip = b.dataset.chip; $$('[data-chip]').forEach(x => x.classList.toggle('on', x === b)); drawResults(); });
    drawResults();
  }

  function drawResults() {
    const list = filtered();
    const box = $('#res');
    if (!box) return;
    if (!list.length) { box.innerHTML = `<div class="empty">${t('រកមិនឃើញ', 'Nobody found')}</div>`; drawBulk(); return; }
    if (wide()) {
      box.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr>
        <th><input type="checkbox" id="selAll" aria-label="${t('ជ្រើសទាំងអស់', 'Select all')}" ${list.every(u => sel.has(u.email)) ? 'checked' : ''}></th>
        <th>${t('ឈ្មោះ', 'Name')}</th><th>ID</th><th>${t('ផ្នែក', 'Dept')}</th><th>${t('តួនាទី', 'Role')}</th>
        ${D.apps.map(a => `<th class="tk" title="${esc(appName(a))}">${appIcon(a.key, 22)}<small>${esc(appName(a))}</small></th>`).join('')}
        <th>${t('សកម្ម', 'Active')}</th><th></th></tr></thead><tbody>${list.map(u => `
        <tr class="${u.active ? '' : 'off'}${sel.has(u.email) ? ' pick' : ''}" data-row="${esc(u.email)}">
          <td><input type="checkbox" data-sel="${esc(u.email)}" ${sel.has(u.email) ? 'checked' : ''} aria-label="${esc(u.name)}"></td>
          <td><a class="nm" href="#/u/${encodeURIComponent(u.email)}">${avatar(u, 'sm')}<span><b>${esc(u.name || '–')}</b><small>${esc(u.email)}</small></span></a></td>
          <td>${esc(u.empId || '–')}</td><td>${esc(u.dept || '–')}</td><td>${pill(u)}</td>
          ${D.apps.map(a => `<td class="tk"><button type="button" class="tick${u.apps[a.key] ? ' on' : ''}" data-tick="${esc(u.email)}" data-app="${a.key}" aria-pressed="${!!u.apps[a.key]}" aria-label="${esc(appName(a))}">${u.apps[a.key] ? '✓' : ''}</button></td>`).join('')}
          <td>${sw(u.active, `data-act="${esc(u.email)}"`, t('សកម្ម', 'Active'))}</td>
          <td><a class="ed" href="#/u/${encodeURIComponent(u.email)}" aria-label="${t('កែ', 'Edit')}">✏️</a></td></tr>`).join('')}</tbody></table></div>
        <div class="hint">${t('ចុចលើប្រអប់ ✓ ដើម្បីបើក/បិទកម្មវិធីភ្លាមៗ · ជ្រើសច្រើននាក់ ដើម្បីកែក្នុងពេលតែមួយ', 'Tap a ✓ box to switch an app on or off at once · select several people to change them together')} · ${list.length} / ${D.users.length}</div>`;
      $('#selAll').onchange = e => { list.forEach(u => e.target.checked ? sel.add(u.email) : sel.delete(u.email)); drawResults(); };
      $$('[data-sel]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); c.closest('tr').classList.toggle('pick', c.checked); drawBulk(); });
      $$('[data-tick]').forEach(b => b.onclick = () => quickApp(b.dataset.tick, b.dataset.app));
    } else {
      box.innerHTML = `<div class="card ulist">${list.map(u => `
        <div class="urow${u.active ? '' : ' off'}"><a class="um" href="#/u/${encodeURIComponent(u.email)}">${avatar(u)}
          <span class="ut"><span class="l1"><b>${esc(u.name || u.email)}</b>${pill(u)}</span>
          <small>${esc([u.dept, u.empId && 'ID ' + u.empId].filter(Boolean).join(' · ') || u.email)}</small>
          <span class="apps">${D.apps.map(a => `<span class="ai${u.apps[a.key] ? '' : ' no'}" title="${esc(appName(a))}">${appIcon(a.key, 20)}</span>`).join('')}</span></span></a>
          ${sw(u.active, `data-act="${esc(u.email)}"`, t('សកម្ម', 'Active'))}</div>`).join('')}</div>`;
    }
    $$('[data-act]').forEach(b => b.onclick = () => quickActive(b.dataset.act));
    drawBulk();
  }

  // ---- quick changes (no form): saved at once, put back if the server says no
  async function quickApp(email, key) {
    const u = byEmail(email); if (!u) return;
    const on = !u.apps[key];
    const old = JSON.parse(JSON.stringify(u));
    u.apps[key] = on; drawResults();
    try { const r = await api('umSave', { email, apps: { [key]: on } }); merge([r.user]); addLog(r.log); save(); toast(`${on ? '✓' : '✗'} ${appName(D.apps.find(a => a.key === key))} · ${u.name}`); }
    catch (e) { merge([old]); toast(e.message); }
    drawResults();
  }
  async function quickActive(email) {
    const u = byEmail(email); if (!u) return;
    const on = !u.active;
    if (!on && !confirm(t(`បិទ ${u.name || u.email}? គាត់នឹងចូលកម្មវិធីណាមួយមិនបាន (ប្រវត្តិនៅដដែល)។`, `Switch off ${u.name || u.email}? They can't open any app (their history stays).`))) { drawResults(); return; }
    const old = JSON.parse(JSON.stringify(u));
    u.active = on; if (!on) u.offAt = Date.now(); drawResults();
    try { const r = await api('umSave', { email, active: on }); merge([r.user]); addLog(r.log); save(); toast(on ? t('បានបើក', 'Switched on') : t('បានបិទ', 'Switched off')); }
    catch (e) { merge([old]); toast(e.message); }
    if (/^#\/?$|^$/.test(location.hash)) drawResults(); else screen();
  }

  // ---- computer table: one change for everyone selected
  function drawBulk() {
    const box = $('#bulk');
    if (!box) return;
    const n = Array.from(sel).filter(byEmail).length;
    if (!wide() || !n) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="bulk"><b>☑ ${t('បានជ្រើស', 'Selected')} ${n}</b>
      <select class="in sm" id="bApp"><option value="">${t('បើក/បិទកម្មវិធី…', 'Tick an app…')}</option>${D.apps.map(a => `<option value="${a.key}:1">✓ ${esc(appName(a))}</option><option value="${a.key}:0">✗ ${esc(appName(a))}</option>`).join('')}</select>
      <select class="in sm" id="bRole"><option value="">${t('ប្តូរតួនាទី…', 'Set role…')}</option>${ROLES.map(r => `<option value="${r[0]}">${esc(t(r[1], r[2]))}</option>`).join('')}</select>
      <select class="in sm" id="bDept"><option value="">${t('ប្តូរផ្នែក…', 'Department…')}</option>${D.depts.map(d => `<option>${esc(d.name)}</option>`).join('')}</select>
      <button type="button" class="btn sm" id="bOn">${t('បើក', 'Switch on')}</button>
      <button type="button" class="btn sm bad" id="bOff">${t('បិទ', 'Switch off')}</button>
      <button type="button" class="link" id="bClear">${t('លុបការជ្រើស', 'Clear')}</button></div>`;
    $('#bApp').onchange = e => { const [k, v] = e.target.value.split(':'); if (k) bulk({ apps: { [k]: v === '1' } }, (v === '1' ? '✓ ' : '✗ ') + appName(D.apps.find(a => a.key === k))); };
    $('#bRole').onchange = e => { if (e.target.value) bulk({ role: e.target.value }, roleName(e.target.value)); };
    $('#bDept').onchange = e => { if (e.target.value) bulk({ dept: e.target.value }, e.target.value); };
    $('#bOn').onclick = () => bulk({ active: true }, t('បើក', 'Switch on'));
    $('#bOff').onclick = () => bulk({ active: false }, t('បិទ', 'Switch off'));
    $('#bClear').onclick = () => { sel.clear(); drawResults(); };
  }
  async function bulk(patch, what) {
    const emails = Array.from(sel).filter(byEmail);
    if (!confirm(`${what} → ${emails.length} ${t('នាក់', 'people')}?`)) { drawBulk(); return; }
    $('#bulk').innerHTML = `<div class="bulk"><span class="sp"></span> ${t('កំពុងរក្សាទុក…', 'Saving…')}</div>`;
    try {
      const r = await api('umBulk', { emails, patch });
      merge(r.users); addLog(r.log); save();
      toast(`✓ ${what} · ${r.users.length} ${t('នាក់', 'people')}`);
    } catch (e) { toast(e.message); }
    drawResults();
  }

  // ------------------------------------------------------------------ edit / add
  let E = null;   // the form being edited: { key, orig, f, ot }
  function renderEdit(email) {
    paintTabs('list');
    const isNew = !email;
    const key = email || '#new';
    if (!E || E.key !== key) {
      const u = isNew ? null : byEmail(email);
      if (!isNew && !u) { view(`<div class="empty">${t('រកមិនឃើញ', 'Not found')}</div>`); return; }
      const blank = { email: '', name: '', empId: '', dept: '', role: 'user', active: true, apps: {}, offNote: '' };
      if (isNew) D.apps.forEach(a => { blank.apps[a.key] = ['fuel', 'transport', 'overtime', 'location', 'incident'].indexOf(a.key) >= 0; });
      const orig = JSON.parse(JSON.stringify(u || blank));
      E = { key, isNew, orig, f: JSON.parse(JSON.stringify(orig)), ot: null, otOrig: null, tried: false };
    }
    const f = E.f, me = !isNew && f.email === D.me;
    const deptOpts = D.depts.map(d => d.name);
    if (f.dept && deptOpts.indexOf(f.dept) < 0) deptOpts.unshift(f.dept);
    const need = (v, extra) => (E.tried && !String(v || '').trim()) || extra ? ' need' : '';
    const deptApps = (D.depts.find(d => d.name === f.dept) || {}).apps;
    view(`<a class="back" href="${isWaiting(E.orig) && !isNew ? '#/req' : '#/'}">‹ ${t('ថយក្រោយ', 'Back')}</a>
      <div class="prof">${avatar(Object.assign({}, f, { email: f.email || f.name || '?' }), 'big')}<div>
        <h1>${esc(f.name || (isNew ? t('អ្នកប្រើថ្មី', 'New user') : f.email))}</h1>
        ${isNew ? '' : `<small>${esc(f.email)}</small>`}${!isNew ? `<small>${pill(E.orig)}${E.orig.offAt ? ` · ${t('បិទនៅ', 'Off since')} ${when(E.orig.offAt)}` : ''}</small>` : ''}</div></div>
      <div class="card">
        ${isNew ? `<div class="field"><label class="f" for="fEmail">${t('អ៊ីមែល Google', 'Google email')} <span class="req">*</span></label>
          <input class="in${need(f.email)}" id="fEmail" type="email" inputmode="email" autocomplete="off" placeholder="name@gmail.com" value="${esc(f.email)}"></div>` : ''}
        <div class="row2"><div class="field"><label class="f" for="fName">${t('ឈ្មោះពេញ', 'Full name')} <span class="req">*</span></label>
            <input class="in${need(f.name)}" id="fName" value="${esc(f.name)}"></div>
          <div class="field"><label class="f" for="fId">Employee ID</label><input class="in" id="fId" inputmode="numeric" placeholder="100000–190000" value="${esc(f.empId)}"></div></div>
        <div class="field"><label class="f" for="fDept">${t('ផ្នែក', 'Department')}</label>
          <select class="in" id="fDept"><option value="">–</option>${deptOpts.map(d => `<option ${d === f.dept ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
          ${!isNew && deptApps ? `<button type="button" class="link" id="useDept">${t('ប្រើកម្មវិធីតាមផ្នែកនេះ', 'Use this department\'s apps')}</button>` : ''}</div>
        <div class="field"><label class="f">${t('តួនាទី', 'Role')}</label>
          <div class="seg roles">${ROLES.map(r => `<button type="button" class="${f.role === r[0] ? 'on' : ''}" data-role="${r[0]}" ${me ? 'disabled' : ''}>${esc(t(r[1], r[2]))}<small>${esc(t(r[3], r[4]))}</small></button>`).join('')}</div>
          ${me ? `<div class="hint">${t('អ្នកមិនអាចដកសិទ្ធិ Admin របស់ខ្លួនឯងបានទេ', 'You can\'t remove your own admin access')}</div>` : f.role === 'admin' ? `<div class="hint">${t('Admin បើកបានគ្រប់កម្មវិធី និងគ្រប់គ្រងអ្នកប្រើ', 'Admins can open every app and manage users')}</div>` : ''}</div>
        <div class="swrow"><span><b>${t('សកម្ម', 'Active')}</b><small>${t('បិទ = ចូលកម្មវិធីណាមួយមិនបាន ប្រវត្តិនៅដដែល', 'Off = can\'t open any app, history stays')}</small></span>${sw(f.active, `id="fActive" ${me ? 'disabled' : ''}`, t('សកម្ម', 'Active'))}</div>
        ${!f.active && !isNew ? `<div class="field"><label class="f" for="fNote">${t('មូលហេតុ', 'Reason')} <small class="inl">${t('ស្រេចចិត្ត', 'optional')}</small></label><input class="in" id="fNote" placeholder="${t('ឧ. ឈប់ធ្វើការ', 'e.g. Left the company')}" value="${esc(f.offNote)}"></div>` : ''}
      </div>
      <div class="sec">${t('កម្មវិធីដែលអាចប្រើ', 'Apps')}${f.role === 'admin' ? ` <small class="inl">· ${t('Admin ប្រើបានទាំងអស់', 'Admins can open all')}</small>` : ''}</div>
      <div class="card apps2">${D.apps.map(a => `<div class="aline">${appIcon(a.key, 30)}<div class="at"><b>${esc(appName(a))}</b>${appExtra(a.key)}</div>${sw(f.apps[a.key], `data-app="${a.key}"`, appName(a))}</div>`).join('')}</div>
      <div id="eErr"></div>
      <div class="savebar"><button type="button" class="btn ok big" id="fSave">💾 ${isNew ? t('បន្ថែម', 'Add') : t('រក្សាទុក', 'Save')}</button></div>`);
    const bind = (id, k, cb) => { const el = $(id); if (el) el.oninput = el.onchange = e => { f[k] = e.target.value; if (cb) cb(); }; };
    bind('#fEmail', 'email', () => $('#fEmail').classList.toggle('need', E.tried && !f.email.trim()));
    bind('#fName', 'name', () => $('#fName').classList.toggle('need', E.tried && !f.name.trim()));
    bind('#fId', 'empId');
    bind('#fNote', 'offNote');
    $('#fDept').onchange = e => {
      f.dept = e.target.value;
      // A new person gets the department's usual apps straight away.
      const d = D.depts.find(x => x.name === f.dept);
      if (isNew && d) D.apps.forEach(a => { f.apps[a.key] = !!d.apps[a.key]; });
      renderEdit(email);
    };
    if ($('#useDept')) $('#useDept').onclick = () => { D.apps.forEach(a => { f.apps[a.key] = !!deptApps[a.key]; }); renderEdit(email); toast(t('បានដាក់កម្មវិធីតាមផ្នែក · ចុច រក្សាទុក', 'Department apps set · tap Save')); };
    $$('[data-role]').forEach(b => b.onclick = () => { f.role = b.dataset.role; renderEdit(email); });
    $('#fActive').onclick = () => { if (me) return; f.active = !f.active; renderEdit(email); };
    $$('.aline [data-app]').forEach(b => b.onclick = () => { f.apps[b.dataset.app] = !f.apps[b.dataset.app]; renderEdit(email); });
    const om = $('#fOt'); if (om) om.onchange = e => { E.ot = e.target.value ? JSON.parse(e.target.value) : null; };
    $('#fSave').onclick = () => saveEdit(email);
    if (f.apps.overtime && !OT) loadOt().then(() => { if (E && E.key === key) renderEdit(email); });
  }

  // Extra choice under an app: the line manager for Overtime (Delivery steps come from Role).
  function appExtra(key) {
    const f = E.f;
    if (!f.apps[key]) return '';
    if (key === 'overtime') {
      if (!OT) return `<div class="sub hint"><span class="sp"></span> ${t('កំពុងផ្ទុកអ្នកអនុម័ត…', 'Loading approvers…')}</div>`;
      if (!OT.ok) return `<div class="sub hint">⚠️ ${t('អានសន្លឹក OT មិនបាន', 'Could not read the OT sheet')}: ${esc(OT.error)}</div>`;
      const cur = OT.byId[String(f.empId || '').trim()];
      if (!cur) return `<div class="sub hint">${f.empId ? t('Employee ID នេះមិនទាន់មានក្នុងបញ្ជីបុគ្គលិក OT (SSK_OT_DATA)', 'This Employee ID is not in the OT employee list (SSK_OT_DATA) yet') : t('បញ្ចូល Employee ID ដើម្បីដាក់អ្នកអនុម័ត', 'Enter the Employee ID to set the approver')}</div>`;
      if (E.otOrig === null) { E.otOrig = { manager: cur.manager, tg: cur.tg }; if (!E.ot) E.ot = E.otOrig; }
      const val = E.ot || E.otOrig;
      return `<div class="sub"><label for="fOt">${t('អ្នកអនុម័ត', 'Approver')}</label><select class="in sm" id="fOt">${OT.managers.map(m => `<option value="${esc(JSON.stringify(m))}" ${m.name === val.manager && m.tg === val.tg ? 'selected' : ''}>${esc(m.name)}${m.tg ? ' · ' + esc(m.tg) : ''}</option>`).join('')}</select></div>`;
    }
    return '';
  }
  function loadOt() {
    if (OT) return Promise.resolve(OT);
    if (!otBusy) otBusy = api('umOt').then(r => (OT = r)).catch(e => (OT = { ok: false, error: e.message, byId: {}, managers: [] })).finally(() => { otBusy = null; });
    return otBusy;
  }

  async function saveEdit(email) {
    const f = E.f, o = E.orig, isNew = E.isNew;
    E.tried = true;
    const missing = (isNew && !f.email.trim()) || !f.name.trim();
    if (missing) { renderEdit(email); $('#eErr').innerHTML = `<div class="alert bad">${t('សូមបំពេញប្រអប់ក្រហម', 'Please fill in the red boxes')}</div>`; return; }
    const p = isNew ? { isNew: true, email: f.email.trim() } : { email: o.email };
    ['name', 'empId', 'dept', 'role', 'active'].forEach(k => { if (isNew || f[k] !== o[k]) p[k] = f[k]; });
    if (!f.active && (f.active !== o.active || f.offNote !== o.offNote)) p.offNote = f.offNote;
    const apps = {};
    D.apps.forEach(a => { if (isNew || !!f.apps[a.key] !== !!o.apps[a.key]) apps[a.key] = !!f.apps[a.key]; });
    if (Object.keys(apps).length) p.apps = apps;
    const otChange = E.ot && E.otOrig && (E.ot.manager !== E.otOrig.manager || E.ot.tg !== E.otOrig.tg);
    if (Object.keys(p).length <= 1 && !otChange) { toast(t('គ្មានការផ្លាស់ប្តូរ', 'No changes')); return; }
    const btn = $('#fSave');
    btn.disabled = true; btn.innerHTML = `<span class="sp"></span> ${t('កំពុងរក្សាទុក…', 'Saving…')}`;
    try {
      let u = o;
      if (Object.keys(p).length > 1) { const r = await api('umSave', p); merge([r.user]); addLog(r.log); u = r.user; }
      if (otChange) {
        const r = await api('umOtSave', { empId: f.empId, manager: E.ot.manager, tg: E.ot.tg, email: u.email });
        addLog(r.log); OT.byId[String(f.empId).trim()] = Object.assign({}, OT.byId[String(f.empId).trim()], { manager: r.manager, tg: r.tg });
      }
      save();
      toast('💾 ' + (isNew ? t('បានបន្ថែម', 'Added') : t('បានរក្សាទុក', 'Saved')) + ' · ' + (u.name || u.email));
      const back = isWaiting(o) && !isNew ? '#/req' : '#/';
      E = null;
      go(back);
    } catch (e) {
      if (!btn.isConnected) return;
      btn.disabled = false; btn.innerHTML = `💾 ${isNew ? t('បន្ថែម', 'Add') : t('រក្សាទុក', 'Save')}`;
      $('#eErr').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`;
    }
  }

  // ------------------------------------------------------------------ requests
  function renderReq() {
    paintTabs('req');
    const list = D.users.filter(isWaiting);
    view(`<div class="um-head"><h1>📨 ${t('សំណើចូលប្រើ', 'Access requests')}</h1></div>
      <p class="hint top">${t('មកពីប៊ូតុង “ស្នើសុំទៅអ្នកគ្រប់គ្រង” · កម្មវិធីតាមផ្នែករបស់គាត់ បានធីករួច', 'From the “Request to Admin” button · the apps for their department are already ticked')}</p>
      ${list.length ? `<div class="reqgrid">${list.map(u => `<div class="card rq">
        <div class="rqh">${avatar(Object.assign({}, u, { active: true }))}<div><b>${esc(u.name || '–')}</b><small>${esc(u.email)}</small></div></div>
        <div class="kv"><span>Employee ID</span><b>${esc(u.empId || '–')}</b><span>${t('ផ្នែក', 'Dept')}</span><b>${esc(u.dept || '–')}</b></div>
        <div class="apps">${D.apps.map(a => `<span class="ai${u.apps[a.key] ? '' : ' no'}" title="${esc(appName(a))}">${appIcon(a.key, 24)}</span>`).join('')}</div>
        <div class="rqb"><button type="button" class="btn ok" data-ok="${esc(u.email)}">✅ ${t('អនុញ្ញាត', 'Approve')}</button>
          <a class="btn" href="#/u/${encodeURIComponent(u.email)}">✏️ ${t('កែ', 'Edit')}</a>
          <button type="button" class="btn bad" data-no="${esc(u.email)}">✕ ${t('បដិសេធ', 'Reject')}</button></div></div>`).join('')}</div>`
        : `<div class="card empty">✅ ${t('គ្មានសំណើរង់ចាំ', 'No requests waiting')}</div>`}
      <div class="sec">🕘 ${t('ការផ្លាស់ប្តូរចុងក្រោយ', 'Recent changes')} <a class="link" href="#/log">${t('មើលទាំងអស់', 'See all')}</a></div>
      ${logHTML(D.log.slice(0, 6))}`);
    $$('[data-ok]').forEach(b => b.onclick = () => answer(b, b.dataset.ok, true));
    $$('[data-no]').forEach(b => b.onclick = () => {
      const u = byEmail(b.dataset.no);
      if (confirm(t(`បដិសេធ ${u.name || u.email}?`, `Reject ${u.name || u.email}?`))) answer(b, b.dataset.no, false);
    });
  }
  async function answer(btn, email, ok) {
    btn.disabled = true; btn.innerHTML = '<span class="sp"></span>';
    try {
      const r = await api('umSave', ok ? { email, active: true } : { email, active: false, offNote: 'Request rejected' });
      merge([r.user]); addLog(r.log); save();
      toast(ok ? '✅ ' + t('បានអនុញ្ញាត', 'Approved') + ' · ' + (r.user.name || email) : t('បានបដិសេធ', 'Rejected'));
    } catch (e) { toast(e.message); }
    renderReq();
  }

  // ------------------------------------------------------------------ departments
  function renderDept() {
    paintTabs('dept');
    view(`<div class="um-head"><h1>🏢 ${t('ផ្នែក', 'Departments')}</h1><button type="button" class="btn ok add" id="dNew">＋ ${t('បន្ថែមផ្នែក', 'Add department')}</button></div>
      <p class="hint top">${t('កម្មវិធីដែលមនុស្សថ្មីពីផ្នែកនីមួយៗ ទទួលបានដោយស្វ័យប្រវត្តិ (ពេលស្នើសុំ ឬពេលបន្ថែម)', 'The apps a new person from each department gets automatically (on request or when added)')}</p>
      ${D.depts.length ? `<div class="deptgrid">${D.depts.map(d => `<div class="card dept${d.active ? '' : ' off'}">
        <div class="dh"><b>${esc(d.name)}</b><small>${D.users.filter(u => u.dept === d.name && u.active).length} ${t('នាក់', 'people')}</small>${sw(d.active, `data-dact="${esc(d.name)}"`, t('សកម្ម', 'Active'))}</div>
        <div class="dapps">${D.apps.map(a => `<button type="button" class="dapp${d.apps[a.key] ? ' on' : ''}" data-dapp="${esc(d.name)}" data-app="${a.key}" aria-pressed="${!!d.apps[a.key]}">${appIcon(a.key, 26)}<small>${esc(appName(a))}</small></button>`).join('')}</div></div>`).join('')}</div>`
        : `<div class="card empty">${t('មិនទាន់មានផ្នែក', 'No departments yet')}</div>`}`);
    $('#dNew').onclick = async () => {
      const name = (prompt(t('ឈ្មោះផ្នែកថ្មី', 'New department name')) || '').trim();
      if (name) deptSave({ name, isNew: true });
    };
    $$('[data-dapp]').forEach(b => b.onclick = () => {
      const d = D.depts.find(x => x.name === b.dataset.dapp);
      deptSave({ name: d.name, apps: { [b.dataset.app]: !d.apps[b.dataset.app] } });
    });
    $$('[data-dact]').forEach(b => b.onclick = () => { const d = D.depts.find(x => x.name === b.dataset.dact); deptSave({ name: d.name, active: !d.active }); });
  }
  async function deptSave(p) {
    try { const r = await api('umDept', p); D.depts = r.depts; addLog(r.log); save(); toast('✓ ' + p.name); }
    catch (e) { toast(e.message); }
    renderDept();
  }

  // ------------------------------------------------------------------ change log
  function logHTML(list) {
    if (!list.length) return `<div class="card empty">${t('មិនទាន់មានការផ្លាស់ប្តូរ', 'No changes yet')}</div>`;
    return `<div class="card log">${list.map(l => `<div class="le"><b>${esc(l.by)}</b> → <b>${esc(l.name || l.email)}</b>${l.email && l.name ? ` <small class="inl">${esc(l.email)}</small>` : ''}<div>${esc(l.change)}</div><small>${when(l.time)}</small></div>`).join('')}</div>`;
  }
  let logQ = '';
  function renderLog() {
    paintTabs('log');
    view(`<div class="um-head"><h1>🕘 ${t('ប្រវត្តិការផ្លាស់ប្តូរ', 'Change log')}</h1></div>
      <input class="in q" id="lq" type="search" placeholder="🔍 ${t('ស្វែងរក…', 'Search…')}" value="${esc(logQ)}"><div id="lres"></div>
      <p class="hint">${t('កត់ត្រាក្នុងតារាង “User Log” នៃ Google Sheet ចាក់សាំង', 'Kept in the “User Log” tab of the Fuel Refill Google Sheet')}</p>`);
    const draw = () => { const q = logQ.toLowerCase(); $('#lres').innerHTML = logHTML(D.log.filter(l => !q || [l.by, l.name, l.email, l.change].join(' ').toLowerCase().indexOf(q) >= 0)); };
    $('#lq').oninput = e => { logQ = e.target.value; draw(); };
    draw();
  }

  // ------------------------------------------------------------------ start
  // quiet = background refresh: redraws only when something changed, and keeps the scroll position
  async function refresh(quiet) {
    quiet = quiet === true;
    try {
      const d = await api('umList');
      if (quiet && JSON.stringify(d) === JSON.stringify(D)) return;
      D = d; save();
      if (E) paintTabs('list'); else if (quiet) LIVE.keep(screen); else screen();
    } catch (e) {
      if (e.code === 'AUTH' || e.code === 'NOACCESS' || e.code === 'OLD') { set(bootKey(), null); D = null; blocked(e); return; }
      if (quiet) throw e;
      if (!D) view(`<div class="card done"><div class="emoji">⚠️</div><p>${esc(e.message)}</p><button class="btn ok" id="retry">${t('ព្យាយាមម្តងទៀត', 'Try again')}</button></div>`), $('#retry').onclick = refresh;
      else toast(e.message);
    }
  }
  function start() {
    if (!DEMO && !signedIn()) { blocked({ code: 'AUTH' }); return; }
    try { D = JSON.parse(get(bootKey()) || 'null'); } catch (e) { D = null; }
    if (D) screen();   // opens at once from the saved copy, then checks with the server
    $('#bar').classList.add('busy');
    refresh().finally(() => $('#bar').classList.remove('busy'));
  }

  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const paintTheme = () => { const th = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); $('#themeBtn').textContent = th === 'dark' ? '☀️' : '🌙'; };
  $('#themeBtn').onclick = () => { const now = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); const next = now === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); set('fr_theme', next); paintTheme(); };
  paintTheme();
  function paintDemo() { if (DEMO) { const d = $('#demo'); d.hidden = false; d.textContent = t('🧪 សាកល្បង — ទិន្នន័យគំរូ មិនរក្សាទុកក្នុង Sheet', '🧪 Demo — sample data, not saved to the Sheet'); } }
  if (window.LANG) { LANG.button($('#langBtn')); LANG.onChange(() => { paintStatic(); paintDemo(); screen(); }); }
  paintDemo(); paintStatic();
  if (window.LIVE && !DEMO) LIVE.start({ run: () => refresh(true), busy: () => !!E || !D });
  window.ISTEEL_REFRESH = () => { if (E) { toast(t('កំពុងកែ · ចុច រក្សាទុក ឬ ថយក្រោយ', 'Editing · tap Save or Back')); return; } refresh(); };
  window.addEventListener('hashchange', () => { if (!/^#\/(u\/|new)/.test(location.hash)) E = null; screen(); window.scrollTo(0, 0); });
  let wasWide = wide();
  window.addEventListener('resize', () => { if (wide() !== wasWide) { wasWide = wide(); screen(); } });

  // ------------------------------------------------------------------ demo (no API_URL): sample people, nothing saved
  function demoApi(action, p) {
    const S = demoApi.s || (demoApi.s = demoSeed());
    const clone = x => JSON.parse(JSON.stringify(x));
    const log = (email, name, change) => { const l = { time: Date.now(), by: 'Demo Admin', email, name, change }; S.log.unshift(l); return [l]; };
    return new Promise((resolve, reject) => setTimeout(() => {
      try {
        if (action === 'umList') return resolve(clone(S));
        if (action === 'umSave' || action === 'umBulk') {
          const emails = action === 'umBulk' ? p.emails : [String(p.email || '').toLowerCase()];
          const patch = action === 'umBulk' ? p.patch : p;
          const out = [], logs = [];
          emails.forEach(email => {
            let u = S.users.find(x => x.email === email);
            if (p.isNew) { if (u) throw new Error(email + ' is already in the list. / មានក្នុងបញ្ជីរួចហើយ។'); u = { email, name: '', role: 'user', active: true, empId: '', dept: '', apps: {}, offAt: 0, offNote: '' }; S.users.push(u); }
            if (email === S.me && (patch.role && patch.role !== 'admin' || patch.active === false)) { if (action === 'umSave') throw new Error('You cannot remove your own admin access. / អ្នកមិនអាចដកសិទ្ធិ Admin របស់ខ្លួនឯងបានទេ។'); return; }
            ['name', 'empId', 'dept', 'role'].forEach(k => { if (patch[k] !== undefined) u[k] = patch[k]; });
            if (patch.apps) Object.assign(u.apps, patch.apps);
            if (patch.active !== undefined && (patch.active !== u.active || (!patch.active && !u.offAt))) { u.active = patch.active; u.offAt = patch.active ? 0 : Date.now(); u.offNote = patch.active ? '' : (patch.offNote || ''); }
            out.push(clone(u));
            logs.push(...log(email, u.name, p.isNew ? 'Added' : Object.keys(patch).filter(k => k !== 'email').join(', ') + ' changed'));
          });
          return resolve(action === 'umBulk' ? { users: out, log: logs } : { user: out[0], log: logs });
        }
        if (action === 'umDept') {
          let d = S.depts.find(x => x.name === p.name);
          if (p.isNew) { if (d) throw new Error('Already in the list.'); d = { name: p.name, active: true, apps: { fuel: true, transport: true, overtime: true, location: true, incident: true } }; S.depts.push(d); }
          if (p.apps) Object.assign(d.apps, p.apps);
          if (p.active !== undefined) d.active = p.active;
          return resolve({ depts: clone(S.depts), log: log('', 'Department: ' + p.name, 'changed') });
        }
        if (action === 'umOt') return resolve({ ok: true, byId: { 125771: { manager: 'Sok Dara', tg: '@sokdara' }, 130452: { manager: 'Kim Sopheakdey', tg: '@pheakdey' } }, managers: [{ name: 'Kim Sopheakdey', tg: '@pheakdey' }, { name: 'Sok Dara', tg: '@sokdara' }] });
        if (action === 'umOtSave') return resolve({ manager: p.manager, tg: p.tg, log: log(p.email, '', 'OT approver → ' + p.manager) });
        reject(new Error('Unknown action'));
      } catch (e) { const m = msgText(e.message); reject(Object.assign(new Error(m.text), { code: m.code })); }
    }, 250));
  }
  function demoSeed() {
    const A = s => { const k = ['fuel', 'transport', 'overtime', 'location', 'meeting', 'incident', 'inbound', 'dashboard'], o = {}; k.forEach((x, i) => { o[x] = s[i] === '1'; }); return o; };
    const day = 864e5, now = Date.now();
    return {
      me: 'admin.demo@gmail.com',
      apps: ['fuel', 'transport', 'overtime', 'location', 'meeting', 'incident', 'inbound', 'dashboard'].map(key => ({ key, col: APP_NAMES[key][0] })),
      depts: [{ name: 'Warehouse', active: true, apps: A('10101110') }, { name: 'Transport', active: true, apps: A('11110100') }, { name: 'Security', active: true, apps: A('01100100') }, { name: 'HR', active: false, apps: A('00101100') }],
      users: [
        { email: 'admin.demo@gmail.com', name: 'Demo Admin', role: 'admin', active: true, empId: '101245', dept: 'Warehouse', apps: A('11111111'), offAt: 0, offNote: '' },
        { email: 'sokdara.isi@gmail.com', name: 'Sok Dara', role: 'supervisor', active: true, empId: '112308', dept: 'Transport', apps: A('11110001'), offAt: 0, offNote: '' },
        { email: 'vibol.chan@gmail.com', name: 'Chan Vibol', role: 'driver', active: true, empId: '125771', dept: 'Transport', apps: A('11100100'), offAt: 0, offNote: '' },
        { email: 'sreymom.h@gmail.com', name: 'Heng Sreymom', role: 'warehouse', active: true, empId: '130452', dept: 'Warehouse', apps: A('10101110'), offAt: 0, offNote: '' },
        { email: 'rithy.phan@gmail.com', name: 'Phan Rithy', role: 'security', active: true, empId: '141903', dept: 'Security', apps: A('01100100'), offAt: 0, offNote: '' },
        { email: 'sophal.keo@gmail.com', name: 'Keo Sophal', role: 'user', active: false, empId: '150617', dept: 'Warehouse', apps: A('10100100'), offAt: now - 2 * day, offNote: 'Left the company' },
        { email: 'chenda.mao@gmail.com', name: 'Mao Chenda', role: 'user', active: false, empId: '163220', dept: 'Transport', apps: A('11110100'), offAt: 0, offNote: '' },
        { email: 'sovann.ly@gmail.com', name: 'Ly Sovann', role: 'user', active: false, empId: '158004', dept: 'Warehouse', apps: A('10101110'), offAt: 0, offNote: '' },
      ],
      log: [
        { time: now - 3 * 3600e3, by: 'Demo Admin', email: 'sreymom.h@gmail.com', name: 'Heng Sreymom', change: 'ទទួលទំនិញ ✓' },
        { time: now - day, by: 'Demo Admin', email: 'sophal.keo@gmail.com', name: 'Keo Sophal', change: 'Switched off (Left the company)' },
        { time: now - 2 * day, by: 'Demo Admin', email: 'sokdara.isi@gmail.com', name: 'Sok Dara', change: 'Role: user → reviewer' },
      ],
    };
  }

  start();
})();
