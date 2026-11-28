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
    inbound: ['ទទួលទំនិញ', 'Inbound'], dataentry: ['បញ្ចូលទិន្នន័យ', 'Agent Data Entry'], safety: ['សុវត្ថិភាព & 5S', 'Safety & 5S'], scale: ['ជញ្ជីងឡាន', 'Truck Scale'],
    dashboard: ['Dashboard', 'Fuel Dashboard'],
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
  // New Location removed (Kim, 28 Nov 2026): no tick column even before Code.gs is re-pasted.
  const noLoc = d => { if (d && d.apps) d.apps = d.apps.filter(a => a.key !== 'location'); return d; };
  let OT = null;       // OT line managers, loaded when an edit screen needs them
  let otBusy = null;
  const sel = new Set();   // selected people (computer table, or phone "Select" mode)
  let PICK = false;        // phone: tap rows to select several people, then change them together (Kim, 2 Nov 2026)
  const F = { q: '', chip: 'all', dept: '', role: '', stock: '', ib: '' };   // dept: '' = every department, '-' = no department
  const TOKEN_KEY = 'fr_id_token';
  const claims = () => { try { return JSON.parse(decodeURIComponent(escape(atob((get(TOKEN_KEY) || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; } };
  const signedIn = () => { const c = claims(); return !!(c && c.exp * 1000 > Date.now() + 60000); };
  const bootKey = () => 'um_boot_' + ((claims() || {}).email || 'demo');
  const save = () => { if (!DEMO && D) set(bootKey(), JSON.stringify(D)); };
  const byEmail = e => D.users.find(u => u.email === e);
  function merge(users, gone) {
    (users || []).forEach(u => { if (!u) return; const i = D.users.findIndex(x => x.email === u.email); if (i >= 0) D.users[i] = u; else D.users.push(u); });
    (gone || []).forEach(e => { D.users = D.users.filter(x => x.email !== e); });
  }
  // A person with two Gmails is two lines on one row: a save sends back every line of that row.
  const mergeSave = r => merge(r.users && r.users.length ? r.users : [r.user], r.gone);
  const empOf = id => (D.emps || []).find(e => e.id === String(id || '').trim());
  // Employee ID + password sign-in (Kim, 28 Nov 2026): kept as "<ID>@id.isteel" next to the person's Gmails.
  const ID_LOGIN = '@id.isteel';
  const isIdLogin = e => String(e || '').slice(-ID_LOGIN.length) === ID_LOGIN;
  const shownEmail = e => (isIdLogin(e) ? '🔑 ID ' + e.slice(0, -ID_LOGIN.length) + ' + ' + t('ពាក្យសម្ងាត់', 'password') : e);
  let photos = {};   // card photos already loaded (email → data URL)
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

  // ------------------------------------------------------------------ menus (Kim, 13 Nov 2026, option C)
  // One big table: people down, every app's menus across. Ticked = the person sees that menu. The server keeps
  // the unticked ones per person ("Hidden Menus"); the list of menus is ../menus.js. Admins always see everything.
  const MF = { q: '', dept: '', app: '', role: '' };
  let MP = {};   // changes not saved yet: email → menus hidden
  const MENU_ALL = () => (window.MENUS && MENUS.all) || {};
  const mOff = u => MP[u.email] || u.menusOff || [];
  const sameList = (a, b) => a.slice().sort().join(',') === b.slice().sort().join(',');
  const mChanged = () => D.users.filter(u => MP[u.email] && !sameList(MP[u.email], u.menusOff || []));
  function mPeople() {
    const q = MF.q.trim().toLowerCase();
    return D.users.filter(u => u.active && (!MF.dept || (MF.dept === '-' ? !u.dept : u.dept === MF.dept))
      && (!MF.app || u.role === 'admin' || u.apps[MF.app])
      && (!MF.role || u.role === MF.role)
      && (!q || [u.name, u.email, u.empId, u.dept].join(' ').toLowerCase().indexOf(q) >= 0))
      .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  }
  const mApps = () => D.apps.filter(a => MENU_ALL()[a.key] && (!MF.app || a.key === MF.app));

  function renderMenus() {
    paintTabs('menus');
    const ALL = MENU_ALL();
    view(`<div class="um-head"><h1>🔐 ${t('ម៉ឺនុយ', 'Menus')}</h1></div>
      <p class="mx-hint">${t('ធីក = អ្នកនោះឃើញម៉ឺនុយ។ ចុចឈ្មោះម៉ឺនុយ ដើម្បីធីក ឬដកធីកទាំងជួរ។ Admin ឃើញគ្រប់ម៉ឺនុយ។', 'Ticked = the person sees the menu. Tap a menu name to tick or untick the whole column. Admins see every menu.')}</p>
      <div class="fb-wrap">${FB.head('menus', '', '', () => { MF.q = ''; MF.dept = ''; MF.app = ''; MF.role = ''; renderMenus(); })}
      ${FB.panel('menus', FB.field(t('កម្មវិធី', 'App'), `<select id="mApp"><option value="">${t('គ្រប់កម្មវិធី', 'All apps')}</option>${D.apps.filter(a => ALL[a.key]).map(a => `<option value="${a.key}" ${MF.app === a.key ? 'selected' : ''}>${esc(appName(a))}</option>`).join('')}</select>`) +
        FB.field(t('ផ្នែក', 'Department'), `<select id="mDept"><option value="">${t('គ្រប់ផ្នែក', 'All departments')}</option>${deptNames().map(d => `<option value="${esc(d)}" ${MF.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}${D.users.some(u => !u.dept) ? `<option value="-" ${MF.dept === '-' ? 'selected' : ''}>${t('គ្មានផ្នែក', 'No department')}</option>` : ''}</select>`) +
        FB.field(t('តួនាទី', 'Role'), `<select id="mRole"><option value="">${t('គ្រប់តួនាទី', 'All roles')}</option>${ROLES.filter(x => D.users.some(u => u.active && u.role === x[0])).map(x => `<option value="${x[0]}" ${MF.role === x[0] ? 'selected' : ''}>${esc(t(x[1], x[2]))} (${D.users.filter(u => u.active && u.role === x[0]).length})</option>`).join('')}</select>`) +
        FB.search('mQ', t('ស្វែងរក ឈ្មោះ អ៊ីមែល ID…', 'Search name, email, ID…'), MF.q))}</div>
      <div id="mres"></div><div id="msave"></div>`);
    $('#mApp').onchange = e => { MF.app = e.target.value; drawMenus(); };
    $('#mDept').onchange = e => { MF.dept = e.target.value; drawMenus(); };
    $('#mRole').onchange = e => { MF.role = e.target.value; drawMenus(); };
    $('#mQ').oninput = e => { MF.q = e.target.value; clearTimeout(renderMenus.h); renderMenus.h = setTimeout(drawMenus, 120); };
    drawMenus();
  }

  function drawMenus() {
    const box = $('#mres');
    if (!box) return;
    const ALL = MENU_ALL(), apps = mApps(), list = mPeople();
    if (!apps.length) { box.innerHTML = `<div class="empty">${t('មិនទាន់មានម៉ឺនុយ', 'No menus yet')}</div>`; return; }
    if (!list.length) { box.innerHTML = `<div class="empty">${t('រកមិនឃើញ', 'Nobody found')}</div>`; drawMenuSave(); return; }
    const cell = (u, a, m) => {
      const k = a.key + '.' + m[0];
      if (u.role === 'admin') return `<td class="mx-c adm" title="Admin">✓</td>`;
      if (!u.apps[a.key]) return `<td class="mx-c na" title="${esc(t('មិនមានកម្មវិធីនេះ', 'No access to this app'))}">–</td>`;
      const on = mOff(u).indexOf(k) < 0, was = (u.menusOff || []).indexOf(k) < 0;
      return `<td class="mx-c${on !== was ? ' chg' : ''}"><input type="checkbox" data-u="${esc(u.email)}" data-k="${k}"${on ? ' checked' : ''} aria-label="${esc(u.name + ' · ' + t(m[1], m[2]))}"></td>`;
    };
    box.innerHTML = `<div class="tbl-wrap mx-wrap"><table class="tbl mx" data-nosort data-nocols><thead>
      <tr><th rowspan="2" class="mx-name">${t('ឈ្មោះ', 'Name')} <small>${list.length}</small></th>${apps.map((a, i) => `<th colspan="${ALL[a.key].length}" class="mx-app${i % 2 ? ' alt' : ''}">${appIcon(a.key, 18)} ${esc(appName(a))}</th>`).join('')}</tr>
      <tr>${apps.map((a, i) => ALL[a.key].map((m, j) => `<th class="mx-m${i % 2 ? ' alt' : ''}${j === 0 ? ' first' : ''}" data-col="${a.key}.${m[0]}" title="${esc(t('ធីក / ដកធីក ទាំងជួរ', 'Tick / untick the whole column'))}">${esc(t(m[1], m[2]))}</th>`).join('')).join('')}</tr></thead>
      <tbody>${list.map(u => `<tr><td class="mx-name"><b>${esc(u.name)}</b><small>${esc(u.dept || u.email)}</small></td>${apps.map(a => ALL[a.key].map(m => cell(u, a, m)).join('')).join('')}</tr>`).join('')}</tbody></table></div>`;
    box.querySelector('tbody').onchange = e => {
      const cb = e.target; if (!cb.dataset || !cb.dataset.u) return;
      const u = byEmail(cb.dataset.u); if (!u) return;
      const off = mOff(u).filter(k => k !== cb.dataset.k);
      if (!cb.checked) off.push(cb.dataset.k);
      MP[u.email] = off;
      cb.parentElement.classList.toggle('chg', cb.checked !== ((u.menusOff || []).indexOf(cb.dataset.k) < 0));
      drawMenuSave();
    };
    $$('th[data-col]', box).forEach(th => th.onclick = () => {
      const k = th.dataset.col, app = k.split('.')[0];
      const who = list.filter(u => u.role !== 'admin' && u.apps[app]);
      if (!who.length) return;
      const tick = who.some(u => mOff(u).indexOf(k) >= 0);   // any unticked → tick all, else untick all
      who.forEach(u => { const off = mOff(u).filter(x => x !== k); if (!tick) off.push(k); MP[u.email] = off; });
      drawMenus();
    });
    drawMenuSave();
  }

  function drawMenuSave() {
    const bar = $('#msave'); if (!bar) return;
    const n = mChanged().length;
    bar.className = n ? 'mx-save' : '';
    bar.innerHTML = n ? `<span>✏️ ${t(`កែ ${n} នាក់ មិនទាន់រក្សាទុក`, `${n} ${n === 1 ? 'person' : 'people'} changed, not saved`)}</span>
      <button type="button" class="btn" id="mUndo">↶ ${t('បោះបង់', 'Undo')}</button>
      <button type="button" class="btn ok" id="mSave">💾 ${t('រក្សាទុក', 'Save')}</button>` : '';
    if (!n) return;
    $('#mUndo').onclick = () => { MP = {}; drawMenus(); };
    $('#mSave').onclick = async () => {
      const b = $('#mSave'); b.disabled = true; b.textContent = '⏳ ' + t('កំពុងរក្សាទុក…', 'Saving…');
      try {
        const r = await api('umMenus', { changes: mChanged().map(u => ({ email: u.email, menusOff: MP[u.email] })) });
        merge(r.users); addLog(r.log); MP = {}; save();
        toast('✓ ' + t('បានរក្សាទុក', 'Saved'));
        drawMenus();
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = '💾 ' + t('រក្សាទុក', 'Save'); }
    };
  }

  // ------------------------------------------------------------------ stock access (Kim, 27 Nov 2026, option A)
  // People down, product groups (Material Group L4, grouped under L2) across. Ticked = the person sees that group in
  // Stock Count. Nothing ticked = sees everything. Saved in the master Employee List column "Stock Categories".
  const SF = { q: '', dept: '', whg: '', region: '', role: '', grp: '', only: true, view: 'list' };
  let SP = {};   // changes not saved yet: email → groups
  const sCats = u => SP[u.email] || u.stockCats || [];
  const sChanged = () => D.users.filter(u => SP[u.email] && !sameList(SP[u.email], u.stockCats || []));
  const sGroups = () => (D.stockGroups || []).map(g => (typeof g === 'string' ? { n: g, p: '' } : g)).filter(g => !SF.grp || g.p === SF.grp);
  const uniqOf = f => Array.from(new Set(D.users.filter(u => u.active).map(f).filter(Boolean))).sort();
  function sPeople() {
    const q = SF.q.trim().toLowerCase();
    return D.users.filter(u => u.active && (!SF.only || u.role === 'admin' || (u.apps && u.apps.stockcount))
      && (!SF.dept || (u.deptName || String(u.dept || '').split(' · ')[0]) === SF.dept)
      && (!SF.whg || (SF.whg === '-' ? !u.whGroup : u.whGroup === SF.whg))
      && (!SF.region || (SF.region === '-' ? !u.region : u.region === SF.region))
      && (!SF.role || u.role === SF.role)
      && (!q || [u.name, u.email, u.empId, u.dept].join(' ').toLowerCase().indexOf(q) >= 0))
      .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  }
  function renderStock() {
    paintTabs('stock');
    if (!D.stockGroups) { view(`<div class="card done"><div class="emoji">🔄</div><h2>${t('ត្រូវធ្វើបច្ចុប្បន្នភាព Apps Script', 'Apps Script needs an update')}</h2><p>${t('សូម paste apps-script/Code.gs ថ្មី ហើយ Deploy New version។', 'Re-paste apps-script/Code.gs and deploy a New version.')}</p></div>`); return; }
    const opt = (list, cur, none) => list.map(v => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(v)}</option>`).join('') + (none ? `<option value="-" ${cur === '-' ? 'selected' : ''}>${t('មិនទាន់កំណត់', 'Not set')}</option>` : '');
    const l2 = Array.from(new Set((D.stockGroups || []).map(g => g.p || '').filter(Boolean))).sort();
    view(`<div class="um-head"><h1>📦 ${t('សិទ្ធិមើលស្តុក', 'Stock access')}</h1></div>
      <p class="mx-hint">${t('ធីក = អ្នកនោះឃើញក្រុមផលិតផលនោះក្នុង ការរាប់ស្តុក។ មិនធីកសោះ = ឃើញទាំងអស់។ ចុចឈ្មោះក្រុម ដើម្បីធីកទាំងជួរ។', 'Ticked = the person sees that product group in Stock Count. Nothing ticked = sees everything. Tap a group name to tick the whole column.')}</p>
      <div class="fb-wrap">${FB.head('stock', '', `<span class="sx-view">${[['list', '☰ ' + t('បញ្ជី', 'List')], ['table', '▦ ' + t('តារាង', 'Table')]].map(v => `<button type="button" data-sv="${v[0]}" class="${SF.view === v[0] ? 'on' : ''}">${v[1]}</button>`).join('')}</span>`, () => { Object.assign(SF, { q: '', dept: '', whg: '', region: '', role: '', grp: '' }); renderStock(); })}
      ${FB.panel('stock', FB.field(t('ផ្នែក', 'Department'), `<select id="sDept"><option value="">${t('ទាំងអស់', 'All')}</option>${opt(uniqOf(u => u.deptName || String(u.dept || '').split(' · ')[0]), SF.dept)}</select>`) +
        FB.field('WH Group', `<select id="sWhg"><option value="">${t('ទាំងអស់', 'All')}</option>${opt(uniqOf(u => u.whGroup), SF.whg, true)}</select>`) +
        FB.field(t('តំបន់', 'Region'), `<select id="sReg"><option value="">${t('ទាំងអស់', 'All')}</option>${opt(uniqOf(u => u.region), SF.region, true)}</select>`) +
        FB.field(t('តួនាទី', 'Role'), `<select id="sRole"><option value="">${t('ទាំងអស់', 'All')}</option>${ROLES.filter(x => D.users.some(u => u.active && u.role === x[0])).map(x => `<option value="${x[0]}" ${SF.role === x[0] ? 'selected' : ''}>${esc(t(x[1], x[2]))}</option>`).join('')}</select>`) +
        FB.field(t('ក្រុមផលិតផល (L2)', 'Product group (L2)'), `<select id="sGrp"><option value="">${t('ទាំងអស់', 'All')}</option>${opt(l2, SF.grp)}</select>`) +
        FB.field(' ', `<label class="chk"><input type="checkbox" id="sOnly"${SF.only ? ' checked' : ''}> ${t('តែអ្នកមានសិទ្ធិ ការរាប់ស្តុក', 'Only people with Stock Count')}</label>`) +
        FB.search('sQ', t('ស្វែងរក ឈ្មោះ អ៊ីមែល ID…', 'Search name, email, ID…'), SF.q))}</div>
      <div id="sres"></div><div id="ssave"></div>`);
    const on = (id, k, f) => { $(id).onchange = e => { SF[k] = f ? f(e.target) : e.target.value; drawStock(); }; };
    on('#sDept', 'dept'); on('#sWhg', 'whg'); on('#sReg', 'region'); on('#sRole', 'role'); on('#sGrp', 'grp'); on('#sOnly', 'only', el => el.checked);
    $('#sQ').oninput = e => { SF.q = e.target.value; clearTimeout(renderStock.h); renderStock.h = setTimeout(drawStock, 120); };
    $$('[data-sv]').forEach(b => b.onclick = () => { SF.view = b.dataset.sv; $$('[data-sv]').forEach(x => x.classList.toggle('on', x === b)); drawStock(); });
    drawStock();
  }
  function drawStock() {
    if (SF.view !== 'table') return drawStockList();
    const box = $('#sres'); if (!box) return;
    const gs = sGroups(), list = sPeople();
    if (!gs.length) { box.innerHTML = `<div class="empty">${t('មិនមានក្រុមផលិតផល (Product Master L4)', 'No product groups (Product Master L4)')}</div>`; return; }
    if (!list.length) { box.innerHTML = `<div class="empty">${t('រកមិនឃើញ', 'Nobody found')}</div>`; drawStockSave(); return; }
    const parts = []; gs.forEach(g => { const l = parts[parts.length - 1]; if (l && l.p === g.p) l.n++; else parts.push({ p: g.p, n: 1 }); });
    const pIdx = {}; parts.forEach((x, i) => { pIdx[x.p] = i; });
    const sees = u => { const c = sCats(u); return c.length ? `<span class="sx-chip">${c.length} ${t('ក្រុម', c.length === 1 ? 'group' : 'groups')}</span>` : `<span class="sx-chip all">${t('ទាំងអស់', 'All')}</span>`; };
    box.innerHTML = `<div class="tbl-wrap mx-wrap"><table class="tbl mx" data-nosort data-nocols><thead>
      <tr><th rowspan="2" class="mx-name">${t('ឈ្មោះ', 'Name')} <small>${list.length}</small></th><th rowspan="2" class="mx-sees">${t('ឃើញ', 'Sees')}</th>${parts.map((x, i) => `<th colspan="${x.n}" class="mx-app${i % 2 ? ' alt' : ''}" data-l2col="${esc(x.p)}" title="${esc(t('ធីក / ដកធីក ទាំងក្រុម', 'Tick / untick the whole group'))}" style="cursor:pointer">${esc(x.p || '—')}</th>`).join('')}</tr>
      <tr>${gs.map((g, j) => `<th class="mx-m${pIdx[g.p] % 2 ? ' alt' : ''}${j === 0 || gs[j - 1].p !== g.p ? ' first' : ''}" data-col="${esc(g.n)}" title="${esc(t('ធីក / ដកធីក ទាំងជួរ', 'Tick / untick the whole column'))}">${esc(g.n)}</th>`).join('')}</tr></thead>
      <tbody>${list.map(u => `<tr><td class="mx-name"><b>${esc(u.name)}</b><small>${esc([u.deptName || u.dept, u.whGroup, u.region].filter(Boolean).join(' · ') || u.email)}</small></td><td class="mx-sees" data-sees="${esc(u.email)}">${sees(u)}</td>
        ${gs.map(g => { const c = sCats(u).indexOf(g.n) >= 0, was = (u.stockCats || []).indexOf(g.n) >= 0;
          return `<td class="mx-c${c !== was ? ' chg' : ''}"><input type="checkbox" data-u="${esc(u.email)}" data-g="${esc(g.n)}"${c ? ' checked' : ''} aria-label="${esc(u.name + ' · ' + g.n)}"></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
    box.querySelector('tbody').onchange = e => {
      const cb = e.target; if (!cb.dataset || !cb.dataset.u) return;
      const u = byEmail(cb.dataset.u); if (!u) return;
      const c = sCats(u).filter(x => x !== cb.dataset.g);
      if (cb.checked) c.push(cb.dataset.g);
      SP[u.email] = c;
      cb.parentElement.classList.toggle('chg', cb.checked !== ((u.stockCats || []).indexOf(cb.dataset.g) >= 0));
      const cell = box.querySelector(`[data-sees="${CSS.escape(u.email)}"]`); if (cell) cell.innerHTML = sees(u);
      drawStockSave();
    };
    $$('th[data-l2col]', box).forEach(th => th.onclick = () => {
      const names = gs.filter(g => g.p === th.dataset.l2col).map(g => g.n);
      const tick = list.some(u => names.some(n => sCats(u).indexOf(n) < 0));
      list.forEach(u => { const c = sCats(u).filter(x => names.indexOf(x) < 0); SP[u.email] = tick ? c.concat(names) : c; });
      drawStock();
    });
    $$('th[data-col]', box).forEach(th => th.onclick = () => {
      const g = th.dataset.col, tick = list.some(u => sCats(u).indexOf(g) < 0);   // any unticked → tick all, else untick all
      list.forEach(u => { const c = sCats(u).filter(x => x !== g); if (tick) c.push(g); SP[u.email] = c; });
      drawStock();
    });
    drawStockSave();
  }
  // Faster ticking (Kim, 28 Nov: "too much to tick one by one"): list view with a group picker per person, tick several
  // people and set their groups in one go (replace / add / remove), copy another person's groups, tick a whole L2 at once.
  const SEL = new Set();
  const allGroups = () => (D.stockGroups || []).map(g => (typeof g === 'string' ? { n: g, p: '' } : g));
  function drawStockList() {
    const box = $('#sres'); if (!box) return;
    const list = sPeople();
    Array.from(SEL).forEach(e => { if (!list.some(u => u.email === e)) SEL.delete(e); });
    if (!list.length) { box.innerHTML = `<div class="empty">${t('រកមិនឃើញ', 'Nobody found')}</div>`; drawStockSave(); return; }
    const chips = u => { const c = sCats(u), was = u.stockCats || [];
      if (!c.length) return `<span class="sx-chip all${was.length ? ' chg' : ''}">${t('ឃើញទាំងអស់', 'Sees everything')}</span>`;
      return c.slice(0, 8).map(x => `<span class="sx-chip${was.indexOf(x) < 0 ? ' chg' : ''}">${esc(x)}</span>`).join('') + (c.length > 8 ? `<span class="sx-chip more">+${c.length - 8}</span>` : ''); };
    const allOn = list.every(u => SEL.has(u.email));
    box.innerHTML = `${SEL.size ? `<div class="sx-bulk"><b>☑ ${SEL.size} ${t('នាក់បានជ្រើស', SEL.size === 1 ? 'person selected' : 'people selected')}</b>
        <button type="button" class="btn ok sm" id="sxBulk">✏️ ${t('កំណត់ក្រុមឲ្យអ្នកដែលបានជ្រើស', 'Set groups for selected')}</button>
        <button type="button" class="btn sm" id="sxAll0">🌐 ${t('ឲ្យឃើញទាំងអស់', 'Sees everything')}</button>
        <button type="button" class="btn sm" id="sxNone">✕ ${t('ដកការជ្រើស', 'Clear selection')}</button></div>` : `<p class="mx-hint">☑ ${t('ធីកមនុស្សច្រើននាក់ ដើម្បីកំណត់ក្រុមម្តងតែមួយ។ ចុច ✏️ ដើម្បីជ្រើសក្រុមឲ្យម្នាក់។', 'Tick several people to set their groups in one go, or tap ✏️ to pick groups for one person.')}</p>`}
      <div class="tbl-wrap"><table class="tbl sx-list" data-nosort data-nocols><thead><tr><th class="sx-ck"><input type="checkbox" id="sxAll"${allOn ? ' checked' : ''} aria-label="${t('ជ្រើសទាំងអស់', 'Select all')}"></th>
        <th>${t('ឈ្មោះ', 'Name')} <small>${list.length}</small></th><th>${t('ឃើញក្រុម', 'Sees')}</th><th></th></tr></thead>
      <tbody>${list.map(u => `<tr class="${SEL.has(u.email) ? 'sel' : ''}"><td class="sx-ck"><input type="checkbox" data-sel="${esc(u.email)}"${SEL.has(u.email) ? ' checked' : ''} aria-label="${esc(u.name)}"></td>
        <td class="sx-who"><b>${esc(u.name)}</b><small>${esc([u.deptName || u.dept, u.whGroup, u.region].filter(Boolean).join(' · ') || u.email)}</small></td>
        <td class="sx-chips">${chips(u)}</td><td class="sx-ed"><button type="button" class="btn sm" data-edit="${esc(u.email)}">✏️ ${t('កែ', 'Edit')}</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#sxAll').onchange = e => { list.forEach(u => (e.target.checked ? SEL.add(u.email) : SEL.delete(u.email))); drawStockList(); };
    $$('[data-sel]', box).forEach(cb => cb.onchange = () => { (cb.checked ? SEL.add(cb.dataset.sel) : SEL.delete(cb.dataset.sel)); drawStockList(); });
    $$('[data-edit]', box).forEach(b => b.onclick = () => picker([byEmail(b.dataset.edit)]));
    $$('.sx-who', box).forEach((td, i) => td.onclick = () => picker([list[i]]));
    if ($('#sxBulk')) $('#sxBulk').onclick = () => picker(list.filter(u => SEL.has(u.email)));
    if ($('#sxAll0')) $('#sxAll0').onclick = () => { list.filter(u => SEL.has(u.email)).forEach(u => { SP[u.email] = []; }); drawStockList(); };
    if ($('#sxNone')) $('#sxNone').onclick = () => { SEL.clear(); drawStockList(); };
    drawStockSave();
  }

  // The picker: groups by L2 with a tick for the whole L2, search, copy from someone, and for several people Replace / Add / Remove.
  function picker(people) {
    people = people.filter(Boolean); if (!people.length) return;
    const many = people.length > 1, gs = allGroups();
    let pick = new Set(many ? [] : sCats(people[0])), mode = 'replace', q = '';
    const parts = []; gs.forEach(g => { const l = parts[parts.length - 1]; if (l && l.p === g.p) l.list.push(g.n); else parts.push({ p: g.p, list: [g.n] }); });
    const donors = D.users.filter(u => u.active && sCats(u).length && people.indexOf(u) < 0).sort((a, b) => a.name.localeCompare(b.name));
    const back = document.createElement('div'); back.className = 'sx-back';
    back.innerHTML = `<div class="sx-pick" role="dialog" aria-modal="true">
      <div class="sx-ph"><b>📦 ${many ? t(`${people.length} នាក់`, `${people.length} people`) : esc(people[0].name)}</b><button type="button" class="btn sm" data-x>✕</button></div>
      ${many ? `<div class="sx-mode">${[['replace', t('ជំនួស', 'Replace')], ['add', t('បន្ថែម', 'Add')], ['remove', t('ដកចេញ', 'Remove')]].map(m => `<button type="button" data-mode="${m[0]}" class="${m[0] === mode ? 'on' : ''}">${m[1]}</button>`).join('')}</div>` : ''}
      <div class="sx-tools"><input type="search" id="sxQ" placeholder="🔍 ${t('ស្វែងរកក្រុម…', 'Search group…')}">
        ${donors.length ? `<select id="sxCopy"><option value="">📋 ${t('ចម្លងពី…', 'Copy from…')}</option>${donors.map(u => `<option value="${esc(u.email)}">${esc(u.name)} (${sCats(u).length})</option>`).join('')}</select>` : ''}
        <button type="button" class="btn sm" id="sxClr">${t('ដកធីកទាំងអស់', 'Untick all')}</button></div>
      <div class="sx-body" id="sxBody"></div>
      <div class="sx-pf"><span id="sxSum"></span><button type="button" class="btn" data-x>${t('បោះបង់', 'Cancel')}</button><button type="button" class="btn ok" id="sxOk">✓ ${t('យក', 'Apply')}</button></div></div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    const body = $('#sxBody', back);
    const draw = () => {
      const hit = n => !q || n.toLowerCase().indexOf(q) >= 0;
      body.innerHTML = parts.map((x, i) => { const vis = x.list.filter(hit); if (!vis.length) return '';
        const n = vis.filter(g => pick.has(g)).length;
        return `<section class="sx-sec"><label class="sx-l2"><input type="checkbox" data-l2="${i}"${n === vis.length ? ' checked' : ''}${n && n < vis.length ? ' data-mid="1"' : ''}> <b>${esc(x.p || '—')}</b> <small>${n}/${vis.length}</small></label>
          <div class="sx-grid">${vis.map(g => `<label class="sx-g${pick.has(g) ? ' on' : ''}"><input type="checkbox" data-g="${esc(g)}"${pick.has(g) ? ' checked' : ''}> ${esc(g)}</label>`).join('')}</div></section>`; }).join('') || `<div class="empty">${t('រកមិនឃើញ', 'Nothing found')}</div>`;
      $$('[data-mid]', body).forEach(cb => { cb.indeterminate = true; });
      $('#sxSum', back).textContent = pick.size ? t(`បានធីក ${pick.size} ក្រុម`, `${pick.size} ${pick.size === 1 ? 'group' : 'groups'} ticked`) : (many && mode !== 'replace' ? '' : t('មិនធីក = ឃើញទាំងអស់', 'Nothing ticked = sees everything'));
    };
    body.onchange = e => {
      const cb = e.target;
      if (cb.dataset.g) { cb.checked ? pick.add(cb.dataset.g) : pick.delete(cb.dataset.g); }
      else if (cb.dataset.l2 != null) { parts[+cb.dataset.l2].list.filter(n => !q || n.toLowerCase().indexOf(q) >= 0).forEach(n => (cb.checked ? pick.add(n) : pick.delete(n))); }
      draw();
    };
    $('#sxQ', back).oninput = e => { q = e.target.value.trim().toLowerCase(); draw(); };
    if ($('#sxCopy', back)) $('#sxCopy', back).onchange = e => { const u = byEmail(e.target.value); if (u) { pick = new Set(sCats(u)); draw(); } };
    $('#sxClr', back).onclick = () => { pick.clear(); draw(); };
    $$('[data-mode]', back).forEach(b => b.onclick = () => { mode = b.dataset.mode; $$('[data-mode]', back).forEach(x => x.classList.toggle('on', x === b)); draw(); });
    $$('[data-x]', back).forEach(b => b.onclick = close);
    back.onclick = e => { if (e.target === back) close(); };
    $('#sxOk', back).onclick = () => {
      const order = gs.map(g => g.n);
      people.forEach(u => {
        const cur = new Set(sCats(u));
        const next = mode === 'add' ? new Set([...cur, ...pick]) : mode === 'remove' ? new Set([...cur].filter(x => !pick.has(x))) : new Set(pick);
        SP[u.email] = order.filter(n => next.has(n)).concat([...next].filter(n => order.indexOf(n) < 0));
      });
      close(); drawStock();
    };
    draw();
    setTimeout(() => $('#sxQ', back).focus(), 50);
  }

  function drawStockSave() {
    const bar = $('#ssave'); if (!bar) return;
    const n = sChanged().length;
    bar.className = n ? 'mx-save' : '';
    bar.innerHTML = n ? `<span>✏️ ${t(`កែ ${n} នាក់ មិនទាន់រក្សាទុក`, `${n} ${n === 1 ? 'person' : 'people'} changed, not saved`)}</span>
      <button type="button" class="btn" id="sUndo">↶ ${t('បោះបង់', 'Undo')}</button>
      <button type="button" class="btn ok" id="sSave">💾 ${t('រក្សាទុក', 'Save')}</button>` : '';
    if (!n) return;
    $('#sUndo').onclick = () => { SP = {}; drawStock(); };
    $('#sSave').onclick = async () => {
      const b = $('#sSave'); b.disabled = true; b.textContent = '⏳ ' + t('កំពុងរក្សាទុក…', 'Saving…');
      try {
        const r = await api('umStock', { changes: sChanged().map(u => ({ email: u.email, stockCats: SP[u.email] })) });
        merge(r.users); addLog(r.log); SP = {}; save();
        toast('✓ ' + t('បានរក្សាទុក', 'Saved'));
        drawStock();
      } catch (e) { toast(e.message); b.disabled = false; b.textContent = '💾 ' + t('រក្សាទុក', 'Save'); }
    };
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
    if (h === 'menus') return renderMenus();
    if (h === 'stock') return renderStock();
    if (h === 'bg') return renderBg();
    if (h === 'usage') return renderUsage();
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
      if (F.role && u.role !== F.role) return false;
      // Stock access (blank = sees everything): 'none' = no limit, 'some' = limited, else the group ticked for the person.
      const sc = u.stockCats || [];
      if (F.stock === 'none' && sc.length) return false;
      if (F.stock === 'some' && !sc.length) return false;
      if (F.stock.indexOf('g:') === 0 && sc.indexOf(F.stock.slice(2)) < 0) return false;
      // Inbound access: 'All' = All ticked, '-' = nothing ticked, or a warehouse ticked (All counts for every warehouse).
      const ib = u.ibWh || [];
      if (F.ib === 'All' && ib.indexOf('All') < 0) return false;
      if (F.ib === '-' && ib.length) return false;
      if (F.ib && F.ib !== 'All' && F.ib !== '-' && !(ib.indexOf(F.ib) >= 0 || ib.indexOf('All') >= 0)) return false;
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
        <span class="hbtns">${wide() ? '' : `<button type="button" class="btn add pk${PICK ? ' on' : ''}" id="pickBtn">${PICK ? '✕ ' + t('បោះបង់', 'Cancel') : '☑ ' + t('ជ្រើសច្រើន', 'Select')}</button>`}
        <a class="btn add" href="#/usage" title="${t('ការប្រើប្រាស់', 'Usage')}">📈</a><a class="btn add" href="#/bg" title="${t('រូបផ្ទាំងចូល', 'Sign-in picture')}">🖼</a><a class="btn ok add" href="#/new">＋ ${t('បន្ថែម', 'Add')}</a></span></div>
      <div class="stats"><span><b>${us.filter(u => u.active).length}</b> ${t('សកម្ម', 'Active')}</span>
        <span><b>${us.filter(u => !u.active && u.offAt).length}</b> ${t('បិទ', 'Off')}</span>
        ${waiting ? `<a href="#/req" class="warn">📨 <b>${waiting}</b> ${t('សំណើថ្មី', 'New requests')} ›</a>` : `<a href="#/req">📨 <b>0</b> ${t('សំណើ', 'Requests')}</a>`}</div>
      <div class="fb-wrap">${FB.head('users', '', '', () => { F.q = ''; F.dept = ''; F.chip = 'all'; F.role = ''; F.stock = ''; F.ib = ''; sel.clear(); renderList(); })}
      ${FB.panel('users', FB.field(t('ផ្នែក', 'Department'), `<select id="fDeptF"><option value="">${t('គ្រប់ផ្នែក', 'All departments')}</option>${deptNames().map(d => `<option value="${esc(d)}" ${F.dept === d ? 'selected' : ''}>${esc(d)} (${D.users.filter(u => u.dept === d && !isWaiting(u)).length})</option>`).join('')}${D.users.some(u => !u.dept) ? `<option value="-" ${F.dept === '-' ? 'selected' : ''}>${t('គ្មានផ្នែក', 'No department')}</option>` : ''}</select>`) +
        FB.field(t('តួនាទី', 'Role'), `<select id="fRoleF"><option value="">${t('គ្រប់តួនាទី', 'All roles')}</option>${ROLES.filter(x => D.users.some(u => u.role === x[0] && !isWaiting(u))).map(x => `<option value="${x[0]}" ${F.role === x[0] ? 'selected' : ''}>${esc(t(x[1], x[2]))} (${D.users.filter(u => u.role === x[0] && !isWaiting(u)).length})</option>`).join('')}</select>`) +
        FB.field(t('សិទ្ធិស្តុក', 'Stock access'), `<select id="fStockF"><option value="">${t('ទាំងអស់', 'Any')}</option><option value="none" ${F.stock === 'none' ? 'selected' : ''}>${t('មើលបានទាំងអស់ (គ្មានកំណត់)', 'Sees everything')} (${D.users.filter(u => !isWaiting(u) && !(u.stockCats || []).length).length})</option><option value="some" ${F.stock === 'some' ? 'selected' : ''}>${t('កំណត់ត្រឹមតែខ្លះ', 'Limited to some')} (${D.users.filter(u => (u.stockCats || []).length).length})</option>${(D.stockGroups || []).map(g => (typeof g === 'string' ? g : g.n)).map(n => `<option value="g:${esc(n)}" ${F.stock === 'g:' + n ? 'selected' : ''}>📦 ${esc(n)} (${D.users.filter(u => (u.stockCats || []).indexOf(n) >= 0).length})</option>`).join('')}</select>`) +
        FB.field(t('សិទ្ធិ Inbound', 'Inbound access'), `<select id="fIbF"><option value="">${t('ទាំងអស់', 'Any')}</option><option value="All" ${F.ib === 'All' ? 'selected' : ''}>${t('គ្រប់ឃ្លាំង', 'All warehouses')}</option>${(D.ibWarehouses || ['WH IB', 'WH OB', 'WH GVM', 'WH BDM', 'WH METAL']).map(w => `<option value="${esc(w)}" ${F.ib === w ? 'selected' : ''}>🏭 ${esc(w)} (${D.users.filter(u => (u.ibWh || []).indexOf(w) >= 0 || (u.ibWh || []).indexOf('All') >= 0).length})</option>`).join('')}<option value="-" ${F.ib === '-' ? 'selected' : ''}>${t('មិនបានកំណត់', 'Nothing ticked')} (${D.users.filter(u => !(u.ibWh || []).length).length})</option></select>`) +
        FB.field(t('ការមើល', 'View'), `<select id="fChip">${chipList().map(c => `<option value="${c[0]}" ${F.chip === c[0] ? 'selected' : ''}>${esc(c[1])} (${c[2]})</option>`).join('')}</select>`) +
        FB.search('q', t('ស្វែងរក ឈ្មោះ អ៊ីមែល ID ផ្នែក…', 'Search name, email, ID, department…'), F.q))}</div>
      <div id="bulk"></div><div id="res"></div>`);
    const pb = $('#pickBtn'); if (pb) pb.onclick = () => { PICK = !PICK; if (!PICK) sel.clear(); renderList(); };
    $('#q').oninput = e => { F.q = e.target.value; drawResults(); };
    $('#fDeptF').onchange = e => { F.dept = e.target.value; sel.clear(); renderList(); };
    $('#fChip').onchange = e => { F.chip = e.target.value; drawResults(); };
    $('#fRoleF').onchange = e => { F.role = e.target.value; drawResults(); };
    $('#fStockF').onchange = e => { F.stock = e.target.value; drawResults(); };
    $('#fIbF').onchange = e => { F.ib = e.target.value; drawResults(); };
    drawResults();
  }

  // Frozen header (Kim, 28 Nov 2026): on computers the user table scrolls inside a box that ends at the window bottom,
  // so its header row (and the Name column, sideways) always shows.
  function fitList() {
    const w = document.querySelector('.ulist');
    if (!w) return;
    w.style.maxHeight = wide() ? Math.max(320, window.innerHeight - (w.getBoundingClientRect().top + window.scrollY) - 52) + 'px' : '';
  }
  function drawResults() {
    const list = filtered();
    const box = $('#res');
    if (!box) return;
    if (!list.length) { box.innerHTML = `<div class="empty">${t('រកមិនឃើញ', 'Nobody found')}</div>`; drawBulk(); return; }
    if (wide()) {
      box.innerHTML = `<div class="tbl-wrap ulist"><table class="tbl"><thead><tr>
        <th class="c-ck"><input type="checkbox" id="selAll" aria-label="${t('ជ្រើសទាំងអស់', 'Select all')}" ${list.every(u => sel.has(u.email)) ? 'checked' : ''}></th>
        <th class="c-nm">${t('ឈ្មោះ', 'Name')}</th><th>ID</th><th>${t('ផ្នែក', 'Dept')}</th><th>${t('តួនាទី', 'Role')}</th>
        ${D.apps.map(a => `<th class="tk" title="${esc(appName(a))}">${appIcon(a.key, 22)}<small>${esc(appName(a))}</small></th>`).join('')}
        <th>${t('សកម្ម', 'Active')}</th><th></th></tr></thead><tbody>${list.map(u => `
        <tr class="${u.active ? '' : 'off'}${sel.has(u.email) ? ' pick' : ''}" data-row="${esc(u.email)}">
          <td class="c-ck"><input type="checkbox" data-sel="${esc(u.email)}" ${sel.has(u.email) ? 'checked' : ''} aria-label="${esc(u.name)}"></td>
          <td class="c-nm"><a class="nm" href="#/u/${encodeURIComponent(u.email)}">${avatar(u, 'sm')}<span><b>${esc(u.name || '–')}</b><small>${esc(shownEmail(u.email))}</small></span></a></td>
          <td>${esc(u.empId || '–')}</td><td>${esc(u.dept || '–')}</td><td>${pill(u)}</td>
          ${D.apps.map(a => `<td class="tk"><button type="button" class="tick${u.apps[a.key] ? ' on' : ''}" data-tick="${esc(u.email)}" data-app="${a.key}" aria-pressed="${!!u.apps[a.key]}" aria-label="${esc(appName(a))}">${u.apps[a.key] ? '✓' : ''}</button></td>`).join('')}
          <td>${sw(u.active, `data-act="${esc(u.email)}"`, t('សកម្ម', 'Active'))}</td>
          <td><a class="ed" href="#/u/${encodeURIComponent(u.email)}" aria-label="${t('កែ', 'Edit')}">✏️</a></td></tr>`).join('')}</tbody></table></div>
        <div class="hint">${t('ចុចលើប្រអប់ ✓ ដើម្បីបើក/បិទកម្មវិធីភ្លាមៗ · ជ្រើសច្រើននាក់ ដើម្បីកែក្នុងពេលតែមួយ', 'Tap a ✓ box to switch an app on or off at once · select several people to change them together')} · ${list.length} / ${D.users.length}</div>`;
      $('#selAll').onchange = e => { list.forEach(u => e.target.checked ? sel.add(u.email) : sel.delete(u.email)); drawResults(); };
      $$('[data-sel]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); c.closest('tr').classList.toggle('pick', c.checked); drawBulk(); });
      $$('[data-tick]').forEach(b => b.onclick = () => quickApp(b.dataset.tick, b.dataset.app));
    } else {
      box.innerHTML = (PICK ? `<label class="pkall"><input type="checkbox" id="selAll" ${list.every(u => sel.has(u.email)) ? 'checked' : ''}> ${t('ជ្រើសទាំងអស់ដែលបង្ហាញ', 'Select all shown')} (${list.length})</label>` : '') + `<div class="card ulist${PICK ? ' picking' : ''}">${list.map(u => `
        <div class="urow${u.active ? '' : ' off'}${PICK && sel.has(u.email) ? ' pick' : ''}">${PICK ? `<input type="checkbox" class="pkc" data-sel="${esc(u.email)}" ${sel.has(u.email) ? 'checked' : ''} aria-label="${esc(u.name)}">` : ''}<a class="um" href="#/u/${encodeURIComponent(u.email)}"${PICK ? ` data-pk="${esc(u.email)}"` : ''}>${avatar(u)}
          <span class="ut"><span class="l1"><b>${esc(u.name || u.email)}</b>${pill(u)}</span>
          <small>${esc([isIdLogin(u.email) && '🔑', u.dept, u.empId && 'ID ' + u.empId].filter(Boolean).join(' · ') || u.email)}</small>
          <span class="apps">${D.apps.map(a => `<span class="ai${u.apps[a.key] ? '' : ' no'}" title="${esc(appName(a))}">${appIcon(a.key, 20)}</span>`).join('')}</span></span></a>
          ${PICK ? '' : sw(u.active, `data-act="${esc(u.email)}"`, t('សកម្ម', 'Active'))}</div>`).join('')}</div>`;
      if (PICK) {
        const flip = (email, on) => { on ? sel.add(email) : sel.delete(email); drawResults(); };
        $('#selAll').onchange = e => { list.forEach(u => e.target.checked ? sel.add(u.email) : sel.delete(u.email)); drawResults(); };
        $$('[data-sel]').forEach(c => c.onchange = () => flip(c.dataset.sel, c.checked));
        $$('[data-pk]').forEach(a => a.onclick = e => { e.preventDefault(); flip(a.dataset.pk, !sel.has(a.dataset.pk)); });
      }
    }
    $$('[data-act]').forEach(b => b.onclick = () => quickActive(b.dataset.act));
    fitList();
    drawBulk();
  }

  // ---- quick changes (no form): saved at once, put back if the server says no
  async function quickApp(email, key) {
    const u = byEmail(email); if (!u) return;
    const on = !u.apps[key];
    const old = JSON.parse(JSON.stringify(u));
    u.apps[key] = on; drawResults();
    try { const r = await api('umSave', { email, apps: { [key]: on } }); mergeSave(r); addLog(r.log); save(); toast(`${on ? '✓' : '✗'} ${appName(D.apps.find(a => a.key === key))} · ${u.name}`); }
    catch (e) { merge([old]); toast(e.message); }
    drawResults();
  }
  async function quickActive(email) {
    const u = byEmail(email); if (!u) return;
    const on = !u.active;
    if (!on && !confirm(t(`បិទ ${u.name || u.email}? គាត់នឹងចូលកម្មវិធីណាមួយមិនបាន (ប្រវត្តិនៅដដែល)។`, `Switch off ${u.name || u.email}? They can't open any app (their history stays).`))) { drawResults(); return; }
    const old = JSON.parse(JSON.stringify(u));
    u.active = on; if (!on) u.offAt = Date.now(); drawResults();
    try { const r = await api('umSave', { email, active: on }); mergeSave(r); addLog(r.log); save(); toast(on ? t('បានបើក', 'Switched on') : t('បានបិទ', 'Switched off')); }
    catch (e) { merge([old]); toast(e.message); }
    if (/^#\/?$|^$/.test(location.hash)) drawResults(); else screen();
  }

  // ---- computer table: one change for everyone selected
  function drawBulk() {
    const box = $('#bulk');
    if (!box) return;
    const n = Array.from(sel).filter(byEmail).length;
    if (!n || !(wide() || PICK)) { box.innerHTML = ''; return; }
    const whs = D.ibWarehouses || ['WH IB', 'WH OB', 'WH GVM', 'WH BDM', 'WH METAL'];
    box.innerHTML = `<div class="bulk"><b>☑ ${t('បានជ្រើស', 'Selected')} ${n}</b>
      <select class="in sm" id="bApp"><option value="">${t('បើក/បិទកម្មវិធី…', 'Tick an app…')}</option>${D.apps.map(a => `<option value="${a.key}:1">✓ ${esc(appName(a))}</option><option value="${a.key}:0">✗ ${esc(appName(a))}</option>`).join('')}</select>
      <select class="in sm" id="bRole"><option value="">${t('ប្តូរតួនាទី…', 'Set role…')}</option>${ROLES.map(r => `<option value="${r[0]}">${esc(t(r[1], r[2]))}</option>`).join('')}</select>
      <select class="in sm" id="bWh"><option value="">🏭 ${t('WH Group…', 'WH Group…')}</option>${whs.map(w => `<option value="${esc(w)}">${esc(w)}</option>`).join('')}<option value="All">🌐 ${t('ទាំងអស់', 'All')}</option><option value="-">${t('គ្មាន (ឃើញទាំងអស់)', 'None (sees all)')}</option></select>
      <select class="in sm" id="bDept"><option value="">${t('ប្តូរផ្នែក…', 'Department…')}</option>${D.depts.map(d => `<option>${esc(d.name)}</option>`).join('')}</select>
      <button type="button" class="btn sm" id="bOn">${t('បើក', 'Switch on')}</button>
      <button type="button" class="btn sm bad" id="bOff">${t('បិទ', 'Switch off')}</button>
      <button type="button" class="link" id="bClear">${t('លុបការជ្រើស', 'Clear')}</button></div>`;
    $('#bApp').onchange = e => { const [k, v] = e.target.value.split(':'); if (k) bulk({ apps: { [k]: v === '1' } }, (v === '1' ? '✓ ' : '✗ ') + appName(D.apps.find(a => a.key === k))); };
    $('#bRole').onchange = e => { if (e.target.value) bulk({ role: e.target.value }, roleName(e.target.value)); };
    $('#bWh').onchange = e => { const v = e.target.value; if (v) bulk({ ibWh: v === '-' ? [] : [v] }, '🏭 ' + (v === '-' ? t('គ្មានឃ្លាំង', 'No warehouse') : v)); };
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
      const blank = { email: '', name: '', empId: '', dept: '', role: 'user', active: true, apps: {}, offNote: '', ibWh: [] };
      if (isNew) D.apps.forEach(a => { blank.apps[a.key] = ['fuel', 'transport', 'overtime', 'incident'].indexOf(a.key) >= 0; });
      const orig = JSON.parse(JSON.stringify(u || blank));
      if (!orig.ibWh) orig.ibWh = [];
      E = { key, isNew, orig, f: JSON.parse(JSON.stringify(orig)), ot: null, otOrig: null, tried: false };
    }
    const f = E.f, me = !isNew && f.email === D.me;
    const deptOpts = D.depts.map(d => d.name);
    if (f.dept && deptOpts.indexOf(f.dept) < 0) deptOpts.unshift(f.dept);
    const need = (v, extra) => (E.tried && !String(v || '').trim()) || extra ? ' need' : '';
    const deptApps = (D.depts.find(d => d.name === f.dept) || {}).apps;
    view(`<div class="prof">${avatar(Object.assign({}, f, { email: f.email || f.name || '?' }), 'big')}<div>
        <h1>${esc(f.name || (isNew ? t('អ្នកប្រើថ្មី', 'New user') : f.email))}</h1>
        ${isNew ? '' : `<small>${esc(shownEmail(f.email))}${(E.orig.others || []).length ? ' · ' + t('Gmail ផ្សេង', 'also') + ' ' + esc(E.orig.others.map(shownEmail).join(', ')) : ''}</small>`}
        ${!isNew && (E.orig.fullName || E.orig.kh) ? `<small>${esc([E.orig.fullName, E.orig.kh].filter(Boolean).join(' · '))}${E.orig.manager ? ' · ' + t('ប្រធាន', 'Manager') + ' ' + esc(E.orig.manager) : ''}</small>` : ''}${!isNew ? `<small>${pill(E.orig)}${E.orig.offAt ? ` · ${t('បិទនៅ', 'Off since')} ${when(E.orig.offAt)}` : ''}</small>` : ''}</div></div>
      <div class="card">
        ${isNew ? `<div class="field"><label class="f">${t('ចូលដោយ', 'Signs in with')}</label>
          <div class="seg">${[['google', 'Google (Gmail)'], ['id', '🔑 ' + t('Employee ID + ពាក្យសម្ងាត់', 'Employee ID + password')]].map(o => `<button type="button" class="${(f.how || 'google') === o[0] ? 'on' : ''}" data-how="${o[0]}">${esc(o[1])}</button>`).join('')}</div></div>
          ${f.how === 'id' ? `<div class="field"><label class="f" for="fPw">${t('ពាក្យសម្ងាត់', 'Password')} <span class="req">*</span> <small class="inl">${t('យ៉ាងតិច ៦ តួ · ប្រាប់អ្នកប្រើផ្ទាល់', 'at least 6 characters · tell the person yourself')}</small></label>
          <input class="in${need(f.pw, E.tried && String(f.pw || '').length < 6)}" id="fPw" type="text" autocomplete="new-password" spellcheck="false" value="${esc(f.pw || '')}"></div>`
          : `<div class="field"><label class="f" for="fEmail">${t('អ៊ីមែល Google', 'Google email')} <span class="req">*</span></label>
          <input class="in${need(f.email)}" id="fEmail" type="email" inputmode="email" autocomplete="off" placeholder="name@gmail.com" value="${esc(f.email)}"></div>`}` : ''}
        <div class="row2"><div class="field"><label class="f" for="fName">${t('ឈ្មោះពេញ', 'Full name')} <span class="req">*</span></label>
            <input class="in${need(f.name)}" id="fName" value="${esc(f.name)}"></div>
          <div class="field"><label class="f" for="fId">Employee ID${isNew && f.how === 'id' ? ' <span class="req">*</span>' : ''}</label><input class="in${isNew && f.how === 'id' ? need(f.empId) : ''}" id="fId" inputmode="numeric" list="empList" placeholder="100000–190000" value="${esc(f.empId)}">
            ${D.emps && f.empId !== E.orig.empId && f.empId ? `<div class="hint">${empOf(f.empId) ? '→ ' + esc(empOf(f.empId).name) : '➕ ' + t('លេខថ្មី', 'New number')}</div>` : ''}</div></div>
        ${D.emps ? `<datalist id="empList">${D.emps.map(e => `<option value="${esc(e.id)}">${esc(e.name)}${e.kh ? ' · ' + esc(e.kh) : ''}</option>`).join('')}</datalist>` : ''}
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
      ${!isNew && E.orig.empId ? pwCard() : ''}
      ${!isNew && (E.orig.others || []).length && !me ? `<button type="button" class="link bad" id="fDrop">✕ ${t('ដក Gmail នេះចេញ', 'Remove this Gmail')} (${esc(f.email)})</button>` : ''}
      <div id="eErr"></div>
      <div class="savebar"><button type="button" class="btn ok big" id="fSave">💾 ${isNew ? t('បន្ថែម', 'Add') : t('រក្សាទុក', 'Save')}</button></div>`);
    const bind = (id, k, cb) => { const el = $(id); if (el) el.oninput = el.onchange = e => { f[k] = e.target.value; if (cb) cb(); }; };
    bind('#fEmail', 'email', () => $('#fEmail').classList.toggle('need', E.tried && !f.email.trim()));
    bind('#fName', 'name', () => $('#fName').classList.toggle('need', E.tried && !f.name.trim()));
    bind('#fPw', 'pw');
    $$('[data-how]').forEach(b => b.onclick = () => { f.how = b.dataset.how; renderEdit(email); });
    bindPw(email);
    bind('#fId', 'empId');
    if ($('#fId') && D.emps) $('#fId').onchange = e => { f.empId = e.target.value.trim(); renderEdit(email); };
    if ($('#fDrop')) $('#fDrop').onclick = async () => {
      if (!confirm(t(`ដក ${f.email} ចេញ?`, `Remove ${f.email}?`))) return;
      try { const r = await api('umSave', { email: f.email, removeEmail: true }); mergeSave(r); addLog(r.log); save(); toast('✓ ' + f.email); E = null; go('#/'); }
      catch (e) { toast(e.message); }
    };
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
    $$('[data-ibwh]').forEach(b => b.onclick = () => {
      const w = b.dataset.ibwh, on = f.ibWh || (f.ibWh = []), k = on.indexOf(w);
      if (k >= 0) on.splice(k, 1); else if (w === 'All') f.ibWh = ['All']; else { on.push(w); const a = on.indexOf('All'); if (a >= 0) on.splice(a, 1); }
      renderEdit(email);
    });
    const om = $('#fOt'); if (om) om.onchange = e => { E.ot = e.target.value ? JSON.parse(e.target.value) : null; };
    $('#fSave').onclick = () => saveEdit(email);
    if (f.apps.overtime && !OT) loadOt().then(() => { if (E && E.key === key) renderEdit(email); });
  }

  /** 🔑 Employee ID + password for this person: set, change or remove (saved at once, not with 💾). */
  function pwCard() {
    const id = E.orig.empId, on = !!E.orig.idLogin || isIdLogin(E.orig.email) || (E.orig.others || []).some(isIdLogin);
    return `<div class="sec">🔑 ${t('ចូលដោយ Employee ID + ពាក្យសម្ងាត់', 'Employee ID + password sign-in')}</div>
      <div class="card pwc"><div class="hint" style="margin-top:0">${on
        ? `✅ ${t('បើក · ចូលដោយ ID', 'On · signs in with ID')} <b>${esc(id)}</b>`
        : t('បិទ · កំណត់ពាក្យសម្ងាត់ ដើម្បីឲ្យគាត់ចូលបានដោយគ្មាន Gmail', 'Off · set a password so they can sign in without Gmail')}</div>
        <div class="pwrow"><input class="in" id="fNewPw" type="text" autocomplete="new-password" spellcheck="false" placeholder="${t('ពាក្យសម្ងាត់ថ្មី (យ៉ាងតិច ៦ តួ)', 'New password (6+ characters)')}">
        <button type="button" class="btn ok" id="fSetPw">${on ? t('ប្តូរ', 'Change') : t('កំណត់', 'Set')}</button></div>
        ${on ? `<button type="button" class="link bad" id="fOffPw">✕ ${t('បិទការចូលដោយ ID', 'Turn off ID sign-in')}</button>` : ''}
        <div class="hint">${t('ប្រាប់ពាក្យសម្ងាត់ទៅគាត់ផ្ទាល់។ ពាក្យសម្ងាត់ត្រូវបានរក្សាទុកជាកូដ ហើយមើលវិញមិនបាន។', 'Tell them the password yourself. It is stored scrambled and can\'t be seen again.')}</div></div>`;
  }
  function bindPw(email) {
    const set = $('#fSetPw'), off = $('#fOffPw');
    const run = async (payload, done) => {
      try {
        const r = await api('umPassword', payload);
        merge(r.users, r.gone); addLog(r.log); save(); toast(done);
        const keep = (r.users || []).find(u => u.email === email) ? email : ((r.users || []).find(u => !isIdLogin(u.email)) || (r.users || [])[0] || {}).email;
        E = null;
        if (keep) { if (keep === email) renderEdit(keep); else go('#/u/' + encodeURIComponent(keep)); } else go('#/');
      } catch (e) { $('#eErr').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; if (set) set.disabled = false; }
    };
    if (set) set.onclick = () => {
      const pw = $('#fNewPw').value;
      if (pw.length < 6) { $('#fNewPw').classList.add('need'); $('#eErr').innerHTML = `<div class="alert bad">${t('ពាក្យសម្ងាត់យ៉ាងតិច ៦ តួ', 'Password: at least 6 characters')}</div>`; return; }
      set.disabled = true;
      run({ id: E.orig.empId, pw }, '🔑 ' + t('បានកំណត់ពាក្យសម្ងាត់', 'Password set'));
    };
    if (off) off.onclick = () => {
      if (!confirm(t('បិទការចូលដោយ Employee ID + ពាក្យសម្ងាត់?', 'Turn off Employee ID + password sign-in?'))) return;
      run({ id: E.orig.empId, off: true }, t('បានបិទ', 'Turned off'));
    };
  }

  // Extra choice under an app: the line manager for Overtime (Delivery steps come from Role),
  // the warehouse(s) for Inbound (Kim, 2 Nov 2026: each team sees only its own warehouse).
  function appExtra(key) {
    const f = E.f;
    if (!f.apps[key] && !(key === 'inbound' && f.role === 'admin')) return '';
    if (key === 'inbound') {
      const list = (D.ibWarehouses || ['WH IB', 'WH OB', 'WH GVM', 'WH BDM', 'WH METAL']).concat('All'), on = f.ibWh || [];
      return `<div class="sub ibwh"><span>🏭 WH Group</span>${list.map(w => `<button type="button" class="whc${on.indexOf(w) >= 0 ? ' on' : ''}" data-ibwh="${esc(w)}">${on.indexOf(w) >= 0 ? '☑' : '☐'} ${w === 'All' ? '🌐 ' + t('ទាំងអស់', 'All') : esc(w)}</button>`).join('')}
        ${on.length ? '' : `<div class="hint" style="width:100%">${t('មិនទាន់ជ្រើស = ឃើញគ្រប់ឃ្លាំង', 'None ticked = sees every warehouse')}</div>`}</div>`;
    }
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
    const byId = isNew && f.how === 'id';
    const missing = byId ? (!String(f.empId || '').trim() || String(f.pw || '').length < 6 || (!f.name.trim() && !empOf(f.empId)))
      : ((isNew && !f.email.trim()) || !f.name.trim());
    if (missing) { renderEdit(email); $('#eErr').innerHTML = `<div class="alert bad">${t('សូមបំពេញប្រអប់ក្រហម', 'Please fill in the red boxes')}${byId ? ' · ' + t('ពាក្យសម្ងាត់យ៉ាងតិច ៦ តួ', 'password: at least 6 characters') : ''}</div>`; return; }
    const p = isNew ? { isNew: true, email: byId ? String(f.empId).trim() + ID_LOGIN : f.email.trim() } : { email: o.email };
    if (byId) p.password = f.pw;
    ['name', 'empId', 'dept', 'role', 'active'].forEach(k => { if (isNew || f[k] !== o[k]) p[k] = f[k]; });
    if (byId && !String(p.name || '').trim()) delete p.name;   // the name comes from the employee list
    if (!f.active && (f.active !== o.active || f.offNote !== o.offNote)) p.offNote = f.offNote;
    const apps = {};
    D.apps.forEach(a => { if (isNew || !!f.apps[a.key] !== !!o.apps[a.key]) apps[a.key] = !!f.apps[a.key]; });
    if (Object.keys(apps).length) p.apps = apps;
    if ((f.ibWh || []).join(',') !== (o.ibWh || []).join(',')) p.ibWh = f.ibWh;
    const otChange = E.ot && E.otOrig && (E.ot.manager !== E.otOrig.manager || E.ot.tg !== E.otOrig.tg);
    if (Object.keys(p).length <= 1 && !otChange) { toast(t('គ្មានការផ្លាស់ប្តូរ', 'No changes')); return; }
    const btn = $('#fSave');
    btn.disabled = true; btn.innerHTML = `<span class="sp"></span> ${t('កំពុងរក្សាទុក…', 'Saving…')}`;
    try {
      let u = o;
      if (Object.keys(p).length > 1) { const r = await api('umSave', p); mergeSave(r); addLog(r.log); u = r.user || o; if (p.empId !== undefined && D.v) refresh(true).catch(() => {}); }
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
    const list = D.users.filter(isWaiting).sort((a, b) => (b.reqAt || 0) - (a.reqAt || 0));
    const badge = u => u.claimed ? `<span class="rp warn">⚠️ ${t('ID មាន Gmail រួច', 'ID has a Gmail')}</span>` : !u.empId ? `<span class="rp wait">📷 ${t('គ្មាន ID', 'No ID')}</span>` : '';
    const one = u => {
      const owner = u.claimed ? empOf(u.claimed) : null;
      const link = !u.empId && !u.claimed;
      return `<div class="card rq">
        <div class="rqh">${avatar(Object.assign({}, u, { active: true }))}<div class="grow"><b>${esc(u.name || '–')}</b><small>${esc(u.email)}</small></div>${badge(u)}</div>
        ${u.photo ? `<button type="button" class="rqphoto" data-photo="${esc(u.email)}">${photos[u.email] ? `<img src="${photos[u.email]}" alt="">` : `<span class="sp"></span>`}</button>` : ''}
        ${link ? `<label class="f" for="lk_${esc(u.email)}">${t('ភ្ជាប់ទៅបុគ្គលិក', 'Link to employee')}</label>
          <input class="in" id="lk_${esc(u.email)}" data-link="${esc(u.email)}" list="empList" inputmode="numeric" placeholder="🔍 ${t('វាយលេខ ID ឬឈ្មោះ…', 'Type the ID or name…')}">
          <div class="hint" data-linkname="${esc(u.email)}">${t('ទុកទទេ = អនុញ្ញាតដោយគ្មាន ID', 'Leave empty = allow without an ID')}</div>` : ''}
        <div class="kv">
          ${u.claimed ? `<span>Employee ID</span><b>${esc(u.claimed)}${owner ? ' · ' + esc(owner.name) : ''}</b><span>${t('Gmail ចាស់', 'Old Gmail')}</span><b>${esc(owner ? owner.emails.join(', ') : '–')}</b>` : u.empId ? `<span>Employee ID</span><b>${esc(u.empId)}</b>` : ''}
          <span>${t('មុខងារ', 'Function')}</span><b>${esc(u.dept || '–')}</b>
          ${u.reqAt ? `<span>${t('ពេលផ្ញើ', 'Sent')}</span><b>${when(u.reqAt)}</b>` : ''}
          ${u.offNote ? `<span>${t('ចំណាំ', 'Note')}</span><b>${esc(u.offNote)}</b>` : ''}</div>
        <div class="apps">${D.apps.map(a => `<span class="ai${u.apps[a.key] ? '' : ' no'}" title="${esc(appName(a))}">${appIcon(a.key, 24)}</span>`).join('')}</div>
        <div class="rqb"><button type="button" class="btn ok" data-ok="${esc(u.email)}">${u.claimed ? '➕ ' + t('បន្ថែម Gmail ទី 2', 'Add as 2nd Gmail') : '✅ ' + t('អនុញ្ញាត', 'Approve')}</button>
          <a class="btn" href="#/u/${encodeURIComponent(u.email)}">✏️ ${t('កែ', 'Edit')}</a>
          <button type="button" class="btn bad" data-no="${esc(u.email)}">✕ ${t('បដិសេធ', 'Reject')}</button></div></div>`;
    };
    view(`<div class="um-head"><h1>📨 ${t('សំណើចូលប្រើ', 'Access requests')}</h1></div>
      <p class="hint top">${t('អ្នកដែលមានលេខ ID ត្រឹមត្រូវ ចូលប្រើបានភ្លាម។ នៅទីនេះ៖ ផ្ញើដោយកាតបុគ្គលិក ឬ ID ដែលមាន Gmail រួច', 'People with a free Employee ID get in at once. Here: requests with a card photo, or an ID that already has a Gmail')}</p>
      ${list.length ? `<div class="reqgrid">${list.map(one).join('')}</div>`
        : `<div class="card empty">✅ ${t('គ្មានសំណើរង់ចាំ', 'No requests waiting')}</div>`}
      <datalist id="empList">${(D.emps || []).map(e => `<option value="${esc(e.id)}">${esc(e.name)}${e.kh ? ' · ' + esc(e.kh) : ''}${e.emails.length ? ' · 📧' : ''}</option>`).join('')}</datalist>
      <div class="sec">🕘 ${t('ការផ្លាស់ប្តូរចុងក្រោយ', 'Recent changes')} <a class="link" href="#/log">${t('មើលទាំងអស់', 'See all')}</a></div>
      ${logHTML(D.log.slice(0, 6))}`);
    $$('[data-link]').forEach(inp => inp.oninput = () => {
      const v = inp.value.trim(), id = (v.match(/\d{4,}/) || [''])[0];
      const e = empOf(id) || (!id && v ? (D.emps || []).find(x => (x.name + ' ' + x.kh).toLowerCase().indexOf(v.toLowerCase()) >= 0) : null);
      const hint = $(`[data-linkname="${CSS.escape(inp.dataset.link)}"]`);
      inp.dataset.id = e ? e.id : id;
      hint.innerHTML = e ? `✓ <b>${esc(e.name)}</b>${e.kh ? ' · ' + esc(e.kh) : ''} · ${esc(e.dept || '–')}${e.emails.length ? ` · <span class="bad">⚠️ ${t('មាន Gmail រួច', 'already has')} ${esc(e.emails.join(', '))}</span>` : ''}`
        : id ? `➕ ${t('លេខថ្មី · នឹងបន្ថែមជាបុគ្គលិកថ្មី', 'New number · adds a new employee')}` : t('ទុកទទេ = អនុញ្ញាតដោយគ្មាន ID', 'Leave empty = allow without an ID');
    });
    $$('[data-ok]').forEach(b => b.onclick = () => {
      const u = byEmail(b.dataset.ok), inp = $(`[data-link="${CSS.escape(u.email)}"]`);
      const id = u.claimed || (inp && inp.dataset.id) || '';
      answer(b, u.email, true, id);
    });
    $$('[data-no]').forEach(b => b.onclick = () => {
      const u = byEmail(b.dataset.no);
      if (confirm(t(`បដិសេធ ${u.name || u.email}?`, `Reject ${u.name || u.email}?`))) answer(b, b.dataset.no, false);
    });
    $$('[data-photo]').forEach(b => {
      const email = b.dataset.photo;
      b.onclick = () => { if (photos[email]) window.open(photos[email], '_blank'); };
      if (!photos[email]) api('umPhoto', { email }).then(r => { if (r && r.dataUrl) { photos[email] = r.dataUrl; b.innerHTML = `<img src="${r.dataUrl}" alt="">`; } else b.innerHTML = '📷 –'; }).catch(() => { b.innerHTML = '📷 –'; });
    });
  }
  async function answer(btn, email, ok, id) {
    btn.disabled = true; btn.innerHTML = '<span class="sp"></span>';
    try {
      const p = ok ? { email, active: true } : { email, active: false, offNote: 'Request rejected' };
      if (ok && id) p.empId = id;
      const r = await api('umSave', p);
      mergeSave(r); addLog(r.log); save();
      toast(ok ? '✅ ' + t('បានអនុញ្ញាត', 'Approved') + ' · ' + ((r.user && r.user.name) || email) : t('បានបដិសេធ', 'Rejected'));
      if (id) refresh(true).catch(() => {});
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
      const name = (prompt(t('ផ្នែក · មុខងារ ថ្មី (ឧ. Supply Chain · QA)', 'New Department · Function (e.g. Supply Chain · QA)')) || '').trim().replace(/\s*[·|/]\s*/, ' · ');
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
  // ------------------------------------------------------------------ 🖼 sign-in picture (Kim, 28 Nov 2026)
  // The picture behind the sign-in screen (home + Fuel). Default = the ISI poster; an upload replaces it for everyone.
  const BG_DEF = '../icons/login-bg.jpg';
  let BG = null;   // { v, pos, src, w, h, file }
  function renderBg() {
    paintTabs('list');
    if (!BG) {
      BG = { v: '', pos: 'left', src: BG_DEF };
      api('loginBg', { v: '' }).then(d => { if (d && d.v && d.dataUrl) Object.assign(BG, { v: d.v, pos: d.pos, src: d.dataUrl, w: d.w, h: d.h }); if (location.hash === '#/bg') renderBg(); }).catch(() => {});
    }
    const pos = [['left', t('ឆ្វេង', 'Left')], ['center', t('កណ្តាល', 'Middle')], ['right', t('ស្តាំ', 'Right')]];
    view(`<div class="um-head"><h1>🖼 ${t('រូបផ្ទាំងចូល', 'Sign-in picture')}</h1><a class="btn add" href="#/">‹ ${t('ត្រឡប់', 'Back')}</a></div>
      <div class="card bgc"><div class="bgprev"><img id="bgImg" src="${esc(BG.src)}" alt=""><i class="bgbox ${esc(BG.pos)}"></i></div>
        <div class="field"><label class="f">${t('ប្រអប់ចូលនៅ', 'Sign-in boxes on the')}</label>
          <div class="seg">${pos.map(o => `<button type="button" class="${BG.pos === o[0] ? 'on' : ''}" data-pos="${o[0]}">${esc(o[1])}</button>`).join('')}</div></div>
        <label class="btn" style="display:block;text-align:center;margin-top:12px">📷 ${t('ជ្រើសរូបថ្មី', 'Choose a new picture')}<input type="file" id="bgFile" accept="image/*" hidden></label>
        <div id="eErr"></div>
        <div style="margin-top:12px;display:flex;gap:8px"><button type="button" class="btn ok" id="bgSave" style="flex:1">💾 ${t('រក្សាទុក', 'Save')}</button>
          ${BG.v || BG.file ? `<button type="button" class="btn" id="bgReset">↺ ${t('រូបដើម', 'Default')}</button>` : ''}</div>
        <p class="hint">${t('រូបបញ្ឈរល្អបំផុត។ ប្រអប់ពណ៌ខៀវលើរូប = កន្លែងប៊ូតុងចូល។ ប្តូរសម្រាប់គ្រប់គ្នា។', 'A tall picture works best. The blue box shows where the sign-in buttons go. Changes it for everyone.')}</p></div>`);
    $$('[data-pos]').forEach(b => b.onclick = () => { BG.pos = b.dataset.pos; renderBg(); });
    $('#bgFile').onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        Object.assign(BG, { src: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height, file: true });
        renderBg();
      };
      img.onerror = () => { $('#eErr').innerHTML = `<div class="alert bad">${t('មិនអាចបើករូបនេះ', 'Could not open this picture')}</div>`; };
      img.src = url;
    };
    const run = async (payload, done) => {
      const b = $('#bgSave'); b.disabled = true; b.textContent = '⏳';
      try {
        const r = await api('loginBgSave', payload);
        BG = r.v ? Object.assign(BG, { v: r.v, pos: r.pos, file: false }) : { v: '', pos: 'left', src: BG_DEF };
        try { localStorage.removeItem('idl_bg'); } catch (e) { /* ignore */ }
        toast(done); renderBg();
      } catch (e) { $('#eErr').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; b.disabled = false; b.textContent = '💾 ' + t('រក្សាទុក', 'Save'); }
    };
    $('#bgSave').onclick = () => {
      if (!BG.v && !BG.file) { toast(t('សូមជ្រើសរូបថ្មីសិន', 'Choose a new picture first')); return; }
      run(BG.file ? { dataUrl: BG.src, w: BG.w, h: BG.h, pos: BG.pos } : { pos: BG.pos }, '🖼 ' + t('បានរក្សាទុក', 'Saved'));
    };
    const rs = $('#bgReset');
    if (rs) rs.onclick = () => {
      if (!BG.v) { BG = { v: '', pos: 'left', src: BG_DEF }; renderBg(); return; }
      if (!confirm(t('ប្រើរូបដើមវិញ?', 'Go back to the default picture?'))) return;
      run({ reset: true }, t('បានប្រើរូបដើមវិញ', 'Default picture back'));
    };
  }

  // ------------------------------------------------------------------ 📈 usage (Kim, 28 Nov 2026)
  // Daily active people and opens per day / per app / per person, from the "Usage Log" tab (every app sends one tiny ping).
  let U = null, usageDays = 30, usageErr = '';
  const APP_NAMES2 = { home: ['ទំព័រដើម', 'Home'], fuel: ['ចាក់សាំង', 'Fuel Refill'], delivery: ['ដឹកជញ្ជូន', 'Delivery'], 'stock-count': ['ការរាប់ស្តុក', 'Stock Count'], users: ['អ្នកប្រើប្រាស់', 'Users'], dashboards: ['Dashboard', 'Dashboards'], minutes: ['ប្រជុំ', 'Meetings'], scale: ['ជញ្ជីងឡាន', 'Truck Scale'], dataentry: ['បញ្ចូលទិន្នន័យ', 'Data Entry'], safety: ['សុវត្ថិភាព', 'Safety & 5S'], overtime: ['ថែមម៉ោង', 'Overtime'], inbound: ['ទទួលទំនិញ', 'Inbound'], incident: ['គ្រោះថ្នាក់', 'Incident'], gallery: ['វិចិត្រសាល', 'Gallery'], 'gate-scale': ['Gate vs Scale', 'Gate vs Scale'] };
  const APP_LABEL = k => { const n = APP_NAMES2[k]; return n ? t(n[0], n[1]) : k; };
  const lastFmt = s => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + ' ' + s.slice(11) : '');
  const dShort = d => { const m = d.split('-'); return Number(m[2]) + '/' + Number(m[1]); };
  async function renderUsage(fresh) {
    paintTabs('list');
    view(`<div class="um-head"><h1>📈 ${t('ការប្រើប្រាស់', 'Usage')}</h1><a class="btn add" href="#/">‹ ${t('ត្រឡប់', 'Back')}</a></div>
      <div class="chips" id="uChips">${[7, 30, 90].map(n => `<button type="button" class="chip${usageDays === n ? ' on' : ''}" data-ud="${n}">${n} ${t('ថ្ងៃ', 'days')}</button>`).join('')}<button type="button" class="chip" id="uRef">↻ ${t('ធ្វើបច្ចុប្បន្នភាព', 'Refresh')}</button></div>
      <div id="uBody">${U && U.days === usageDays ? '' : '<div class="spinner"></div>'}</div>`);
    $$('[data-ud]').forEach(b => b.onclick = () => { usageDays = Number(b.dataset.ud); U = null; renderUsage(); });
    $('#uRef').onclick = () => { U = null; renderUsage(true); };
    if (!U || U.days !== usageDays) {
      try { U = await api('usageData', { days: usageDays, fresh: !!fresh }); usageErr = ''; }
      catch (e) { usageErr = e.code === 'OLD' ? e.message : e.message; }
      if (location.hash !== '#/usage') return;
    }
    const box = $('#uBody');
    if (!box) return;
    if (usageErr || !U) { box.innerHTML = `<div class="alert bad">${esc(usageErr || 'No data')}</div>`; return; }
    const days = U.perDay, max = Math.max(1, ...days.map(d => d.users));
    const step = window.innerWidth < 700 ? Math.ceil(days.length / 6) : Math.ceil(days.length / 30);   // fewer date labels when bars are narrow
    const todayRow = days[days.length - 1] || { users: 0, opens: 0 };
    const active = days.filter(d => d.users > 0), avg = active.length ? Math.round(days.reduce((a, d) => a + d.users, 0) / days.length * 10) / 10 : 0;
    const people = D.users.filter(u => u.active && !isWaiting(u));
    const usedKeys = {};
    U.people.forEach(q => { usedKeys[q.key] = q; });
    const rows = people.map(u => {
      const keys = [u.empId].concat([u.email], u.others || []).filter(Boolean);
      const q = keys.map(k => usedKeys[k] || usedKeys[String(k).toLowerCase()]).find(Boolean);
      return { name: u.name || u.email, id: u.empId || '', dept: u.dept || '', opens: q ? q.opens : 0, days: q ? q.days : 0, last: q ? q.last : '', top: q ? q.top : '', phone: q ? q.phone : 0 };
    });
    const idle = rows.filter(r => !r.opens).length;
    box.innerHTML = `<div class="stats usage-k"><span><b>${todayRow.users}</b> ${t('សកម្មថ្ងៃនេះ', 'active today')}</span><span><b>${todayRow.opens}</b> ${t('ការបើកថ្ងៃនេះ', 'opens today')}</span>
        <span><b>${avg}</b> ${t('មធ្យម/ថ្ងៃ', 'avg users/day')}</span><span><b>${U.people.length}</b> ${t('នាក់បានប្រើ', 'people used')}</span><span class="${idle ? 'warn' : ''}"><b>${idle}</b> ${t('មិនទាន់ប្រើ', 'never opened')}</span></div>
      <div class="card ubars"><div class="ubar-h">${t('អ្នកសកម្មក្នុងមួយថ្ងៃ', 'Active people per day')} <small>${t('ចុច/ដាក់លើរបារ ដើម្បីមើលលេខ', 'hover a bar for the numbers')}</small></div>
        <div class="ubar-w">${days.map((d, i) => `<div class="ubar" title="${esc(d.d)} · ${d.users} ${t('នាក់', 'people')} · ${d.opens} ${t('បើក', 'opens')}"><i style="height:${Math.round(d.users / max * 100)}%">${d.users && days.length <= 31 ? `<b>${d.users}</b>` : ''}</i><small>${i % step === 0 ? dShort(d.d) : ''}</small></div>`).join('')}</div></div>
      <div class="um-sub">${t('តាមកម្មវិធី', 'By app')}</div>
      <div class="tbl-wrap"><table class="tbl" data-nocols><thead><tr><th>${t('កម្មវិធី', 'App')}</th><th>${t('ការបើក', 'Opens')}</th><th>${t('អ្នកប្រើ', 'People')}</th></tr></thead><tbody>${U.perApp.map(a => `<tr><td>${esc(APP_LABEL(a.app))}</td><td>${a.opens}</td><td>${a.users}</td></tr>`).join('') || `<tr><td colspan="3" class="empty">${t('មិនទាន់មានទិន្នន័យ', 'No data yet')}</td></tr>`}</tbody></table></div>
      <div class="um-sub">${t('តាមបុគ្គល', 'By person')}</div>
      <div class="tbl-wrap ulist nock"><table class="tbl" data-nocols><thead><tr><th class="c-nm">${t('ឈ្មោះ', 'Name')}</th><th>ID</th><th>${t('ផ្នែក', 'Dept')}</th><th>${t('ការបើក', 'Opens')}</th><th>${t('ថ្ងៃសកម្ម', 'Days active')}</th><th>${t('ចុងក្រោយ', 'Last seen')}</th><th>${t('កម្មវិធីចម្បង', 'Top app')}</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.opens ? '' : 'off'}"><td class="c-nm">${esc(r.name)}</td><td>${esc(r.id || '–')}</td><td>${esc(r.dept || '–')}</td><td>${r.opens}</td><td>${r.days}</td><td>${esc(r.last ? lastFmt(r.last) : t('មិនទាន់', 'never'))}</td><td>${esc(r.top ? APP_LABEL(r.top) : '–')}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">${t('រាប់ម្តងក្នុង ៣០ នាទី ក្នុងមួយកម្មវិធី មួយឧបករណ៍។ រក្សា ៩០ ថ្ងៃ។', 'Counted once per app per device every 30 minutes. Kept for 90 days.')} · ${esc(U.asOf)}</p>`;
    fitList();
  }

  function renderLog() {
    paintTabs('log');
    view(`<div class="um-head"><h1>🕘 ${t('ប្រវត្តិការផ្លាស់ប្តូរ', 'Change log')}</h1></div>
      <div class="fb-wrap">${FB.head('log', '', '', () => { logQ = ''; renderLog(); })}${FB.panel('log', FB.search('lq', t('ស្វែងរក…', 'Search…'), logQ))}</div><div id="lres"></div>
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
      D = noLoc(d); save();
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
    try { D = noLoc(JSON.parse(get(bootKey()) || 'null')); } catch (e) { D = null; }
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
  if (window.LIVE && !DEMO) LIVE.start({ run: () => refresh(true), busy: () => !!E || !D || !!(D && mChanged().length) });
  window.ISTEEL_REFRESH = () => { if (E) { toast(t('កំពុងកែ · ចុច រក្សាទុក ឬ ថយក្រោយ', 'Editing · tap Save or Back')); return; } refresh(); };
  window.addEventListener('hashchange', () => { if (!/^#\/(u\/|new)/.test(location.hash)) E = null; screen(); window.scrollTo(0, 0); });
  let wasWide = wide();
  window.addEventListener('resize', () => { if (wide() !== wasWide) { wasWide = wide(); screen(); } else fitList(); });

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
            if (patch.ibWh) u.ibWh = patch.ibWh.slice();
            if (patch.active) u.claimed = '';
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
        if (action === 'umMenus') {
          const out = [], logs = [];
          p.changes.forEach(c => { const u = S.users.find(x => x.email === c.email); if (!u) return; u.menusOff = c.menusOff.slice(); out.push(clone(u)); logs.push(...log(u.email, u.name, 'Menus changed')); });
          return resolve({ users: out, log: logs });
        }
        if (action === 'umStock') {
          const out = [], logs = [];
          p.changes.forEach(c => { const u = S.users.find(x => x.email === c.email); if (!u) return; u.stockCats = c.stockCats.slice(); out.push(clone(u)); logs.push(...log(u.email, u.name, 'Stock access: ' + (c.stockCats.join(', ') || 'All'))); });
          return resolve({ users: out, log: logs });
        }
        if (action === 'usageData') {
          const n = p.days || 30, td = new Date(), pad = x => String(x).padStart(2, '0'), ds = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
          const perDay = Array.from({ length: n }, (_, i) => { const d = new Date(td.getTime() - (n - 1 - i) * 86400000), u = d.getDay() === 0 ? 1 : 6 + ((i * 7) % 9); return { d: ds(d), users: u, opens: u * 3 + (i % 5) }; });
          const emps = S.users.filter(u => u.empId);
          return resolve({ days: n, today: ds(td), asOf: pad(td.getDate()) + '-Nov ' + pad(td.getHours()) + ':' + pad(td.getMinutes()), perDay,
            perApp: [{ app: 'fuel', opens: 220, users: 12 }, { app: 'home', opens: 180, users: 14 }, { app: 'stock-count', opens: 95, users: 6 }, { app: 'scale', opens: 40, users: 3 }],
            people: emps.slice(0, Math.max(1, emps.length - 1)).map((u, i) => ({ key: u.empId, id: u.empId, email: u.email, name: u.name, opens: 40 - i * 9, days: 12 - i, last: ds(td) + ' ' + pad(8 + i) + ':15', top: i % 2 ? 'fuel' : 'home', phone: 20 })) });
        }
        if (action === 'loginBg') return resolve(S.bg && S.bg.v !== p.v ? S.bg : (S.bg ? { v: S.bg.v, pos: S.bg.pos } : { v: '' }));
        if (action === 'loginBgSave') { S.bg = p.reset ? null : Object.assign(S.bg || {}, p.dataUrl ? { dataUrl: p.dataUrl, w: p.w, h: p.h } : {}, { v: String(Date.now()), pos: p.pos }); return resolve(S.bg ? { v: S.bg.v, pos: S.bg.pos } : { v: '' }); }
        if (action === 'umPassword') {
          const id = String(p.id), login = id + ID_LOGIN, base = S.users.find(x => x.empId === id && !isIdLogin(x.email)) || S.users.find(x => x.empId === id);
          if (!base) throw new Error('Employee ID ' + id + ' is not in the list.');
          if (!p.off && String(p.pw || '').length < 6) throw new Error('Password needs at least 6 characters. / ពាក្យសម្ងាត់ត្រូវមានយ៉ាងតិច ៦ តួ។');
          if (p.off) {
            S.users = S.users.filter(x => x.email !== login);
            S.users.forEach(x => { if (x.empId === id) { x.idLogin = false; x.others = (x.others || []).filter(o => o !== login); } });
            return resolve({ users: clone(S.users.filter(x => x.empId === id)), gone: [login], log: log(login, base.name, '🔑 Password sign-in removed') });
          }
          if (!S.users.find(x => x.email === login)) {
            S.users.forEach(x => { if (x.empId === id) x.others = (x.others || []).concat(login); });
            S.users.push(Object.assign(clone(base), { email: login, others: [base.email] }));
          }
          S.users.forEach(x => { if (x.empId === id) x.idLogin = true; });
          return resolve({ users: clone(S.users.filter(x => x.empId === id)), gone: [], log: log(login, base.name, '🔑 Password set') });
        }
        if (action === 'umPhoto') return resolve({ dataUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" rx="14" fill="#f4f6f9"/><rect x="18" y="30" width="90" height="120" rx="8" fill="#b9c3cf"/><text x="128" y="60" font-family="sans-serif" font-weight="700" font-size="20" fill="#011e41">ISI STEEL</text><text x="128" y="95" font-family="sans-serif" font-size="13" fill="#546274">NAME: SOK DARA</text><text x="128" y="120" font-family="sans-serif" font-size="13" fill="#546274">ID: 108765</text></svg>') });
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
        { email: 'admin.demo@gmail.com', name: 'Demo Admin', role: 'admin', active: true, empId: '101245', dept: 'Warehouse', apps: Object.assign(A('11111111'), { stockcount: true }), offAt: 0, offNote: '', whGroup: 'Central', region: 'Phnom Penh' },
        { email: 'sokdara.isi@gmail.com', name: 'Sok Dara', role: 'supervisor', active: true, empId: '112308', dept: 'Transport', apps: Object.assign(A('11110001'), { stockcount: true }), offAt: 0, offNote: '', whGroup: 'GVM', region: 'Phnom Penh', stockCats: ['Deformed Bar', 'Wire Rod', 'Wire Roll'] },
        { email: 'vibol.chan@gmail.com', name: 'Chan Vibol', role: 'driver', active: true, empId: '125771', dept: 'Transport', apps: A('11100100'), offAt: 0, offNote: '', menusOff: ['fuel.review', 'fuel.report'] },
        { email: 'sreymom.h@gmail.com', name: 'Heng Sreymom', role: 'warehouse', active: true, empId: '130452', dept: 'Warehouse', apps: Object.assign(A('10101110'), { stockcount: true }), offAt: 0, offNote: '', whGroup: 'Central', region: 'Siem Reap', stockCats: ['Round-GI', 'Square-GI'] },
        { email: 'rithy.phan@gmail.com', name: 'Phan Rithy', role: 'security', active: true, empId: '141903', dept: 'Security', apps: A('01100100'), offAt: 0, offNote: '' },
        { email: 'sophal.keo@gmail.com', name: 'Keo Sophal', role: 'user', active: false, empId: '150617', dept: 'Warehouse', apps: A('10100100'), offAt: now - 2 * day, offNote: 'Left the company' },
        { email: 'chenda.mao@gmail.com', name: 'Mao Chenda', role: 'user', active: false, empId: '163220', dept: 'Transport', apps: A('11110100'), offAt: 0, offNote: '' },
        { email: 'sovann.ly@gmail.com', name: 'Ly Sovann', role: 'user', active: false, empId: '158004', dept: 'Warehouse', apps: A('10101110'), offAt: 0, offNote: '' },
        { email: 'sokdara77@gmail.com', name: 'សុខ ដារ៉ា', role: 'user', active: false, empId: '', dept: 'Supply Chain · Warehouse GVM', apps: A('10101110'), offAt: 0, offNote: '', photo: true, reqAt: now - 40 * 60e3 },
        { email: 'sokom.c@gmail.com', name: 'CHEA SOKOM', role: 'user', active: false, empId: '', claimed: '100752', dept: 'Supply Chain · Central Warehouse', apps: A('10101110'), offAt: 0, offNote: '', reqAt: now - 90 * 60e3 },
      ],
      emps: [{ id: '100752', name: 'CHEA SOKOM', kh: 'ជា សុគុម', dept: 'Supply Chain · Central Warehouse', emails: ['chea.sokom@gmail.com'] },
        { id: '104836', name: 'THEY SEYHA', kh: 'ថី សីហា', dept: 'Supply Chain · Transport & Fleet', emails: [] },
        { id: '108765', name: 'SOK DARA', kh: 'សុខ ដារ៉ា', dept: 'Supply Chain · Warehouse GVM', emails: [] }],
      stockGroups: [['Deformed Bar', 'Trading'], ['Wire Rod', 'Trading'], ['Wire Roll', 'Trading'], ['I-Beam', 'Trading'], ['Round-GI', 'Pipe'], ['Square-GI', 'Pipe'], ['Rectangular-GI', 'Pipe'], ['C-Purlin', 'Roofing'], ['Palm Profile', 'Roofing'], ['GI (Galvanized Coil)', 'Coil']].map(x => ({ n: x[0], p: x[1] })),
      v: 2,
      log: [
        { time: now - 3 * 3600e3, by: 'Demo Admin', email: 'sreymom.h@gmail.com', name: 'Heng Sreymom', change: 'ទទួលទំនិញ ✓' },
        { time: now - day, by: 'Demo Admin', email: 'sophal.keo@gmail.com', name: 'Keo Sophal', change: 'Switched off (Left the company)' },
        { time: now - 2 * day, by: 'Demo Admin', email: 'sokdara.isi@gmail.com', name: 'Sok Dara', change: 'Role: user → reviewer' },
      ],
    };
  }

  start();
})();
