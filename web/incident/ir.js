// Incident Report (គ្រោះថ្នាក់): road and warehouse incidents by drivers and near misses by employees.
// The reporter fills 5 short steps and signs; the Warehouse Supervisor signs (or sends it back); the Apps Script makes
// the signed A4 PDF, posts it to Telegram and emails the admin's lists. Data: apps-script-incident/Incident.gs.
// Drivers without an account report through the QR / link (?k=...), which only shows the form.
(function () {
  'use strict';

  const API = ((window.IR_CONFIG || {}).API_URL || '').trim();
  const DEMO = !API;
  const TOKEN_KEY = 'fr_id_token';            // shared with every app on this site: sign in once on the home menu
  const PUBLIC_KEY = (new URLSearchParams(location.search).get('k') || '').trim();
  const PUBLIC = !!PUBLIC_KEY;
  const MAX_PHOTOS = 6;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  // Words the admin changed in the Texts tab of the sheet, by the original English text: { key: [Khmer, English] }.
  let TX = {};
  const t = (km, en) => { const o = TX[en]; if (o) { km = o[0] || km; en = o[1] || en; } return window.LANG ? LANG.t(km, en) : km; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const getJ = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };
  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const nowHm = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const isDesk = () => window.matchMedia && matchMedia('(min-width: 1000px)').matches;

  // Animated progress while the Apps Script answers (Kim, 25 Oct 2026: progress instead of a spinner).
  // loading card: a % that counts up with the bar (fast, then slower), like Kim's picture B
  const loader = (km, en) => { lpctStart(); return `<div class="loading" role="status"><div class="lcard"><span class="lic">⏳</span><div class="lbody"><div><b class="lpct">0%</b> <small class="ldots">${esc(t(km || 'កំពុងផ្ទុក', en || 'Loading'))}</small></div>
    <div class="lbar"><i></i></div></div></div><div class="skel"></div><div class="skel"></div><div class="skel short"></div></div>`; };
  let lpctTimer = 0;
  function lpctStart() {
    const t0 = Date.now();
    clearInterval(lpctTimer);
    lpctTimer = setInterval(() => {
      const els = document.querySelectorAll('.lpct');
      if (!els.length && Date.now() - t0 > 500) { clearInterval(lpctTimer); return; }
      const v = Math.round(95 * (1 - Math.exp(-(Date.now() - t0) / 1800)));
      els.forEach(el => { el.textContent = v + '%'; });
    }, 80);
  }
  let toastTimer = 0;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3200); }

  // ---------------------------------------------------------------- words in both languages
  const TYPES = {
    road: { km: 'គ្រោះថ្នាក់លើផ្លូវ', en: 'Road incident', who: ['តៃកុង', 'driver'], ic: '🚚', hint: ['លើផ្លូវ ពេលកំពុងដឹក', 'On the road during a trip'] },
    wh: { km: 'គ្រោះថ្នាក់ក្នុងឃ្លាំង', en: 'Warehouse incident', who: ['តៃកុង', 'driver'], ic: '🏭', hint: ['ក្នុងរោងចក្រ ឃ្លាំង ឬទីតាំងអតិថិជន', 'Inside the plant, warehouse or customer site'] },
    near: { km: 'ជិតកើតគ្រោះថ្នាក់', en: 'Near miss', who: ['បុគ្គលិក', 'employee'], ic: '👀', hint: ['គ្មាននរណារបួស គ្មានអ្វីខូច តែអាចកើតឡើង', 'Nobody hurt and nothing damaged, but it could have been'] },
  };
  const typeName = k => (TYPES[k] ? t(TYPES[k].km, TYPES[k].en) + ' (' + t(TYPES[k].who[0], TYPES[k].who[1]) + ')' : k || '');
  const typeOfEn = en => Object.keys(TYPES).find(k => en && en.indexOf(TYPES[k].en) === 0) || '';
  const SEV = [['ជិតកើត (គ្មានរបួស)', 'Near miss (no injury)'], ['ស្រាល (ជំនួយបឋម)', 'Minor (first aid)'], ['មធ្យម (ពេទ្យ / ឈប់ការងារ)', 'Moderate (medical / lost time)'],
    ['ធ្ងន់ (មន្ទីរពេទ្យ / ខូចខាតធំ)', 'Major (hospital / big damage)'], ['ធ្ងន់ធ្ងរបំផុត (ស្លាប់ / ខាតធំណាស់)', 'Critical (fatal / very big loss)']];
  const LIK = [['កម្រ', 'Rare'], ['មិនសូវកើត', 'Unlikely'], ['អាចកើត', 'Possible'], ['ទំនងកើត', 'Likely'], ['ស្ទើរតែប្រាកដ', 'Almost certain']];
  const CAUSES = [['មនុស្ស (ឥរិយាបថ ការបណ្តុះបណ្តាល)', 'People (behaviour, training)'], ['ឧបករណ៍ / ឡាន', 'Equipment / vehicle'], ['វិធីសាស្ត្រ / នីតិវិធី', 'Method / procedure'],
    ['បរិស្ថាន (ផ្លូវ អាកាសធាតុ ពន្លឺ)', 'Environment (road, weather, light)'], ['ទំនិញ / ការផ្ទុក', 'Material / load'], ['ការគ្រប់គ្រង / ត្រួតពិនិត្យ', 'Management / supervision']];
  const CAUSE_ICONS = { 'People (behaviour, training)': '🧍', 'Equipment / vehicle': '🚛', 'Method / procedure': '📋', 'Environment (road, weather, light)': '🌧️', 'Material / load': '📦', 'Management / supervision': '👔' };
  const YESNO = [['បាទ/ចាស', 'Yes'], ['ទេ', 'No']];
  const HAVE = [['មាន', 'Have'], ['គ្មាន', 'None']];
  const DAMAGES = [['ខូចខាតឡាន ក្រុមហ៊ុន', 'Company vehicle'], ['ខូចខាតឡាន អ្នកដទៃ', 'Other vehicle'], ['ខូចខាតទំនិញលើឡាន', 'Goods on the truck'], ['ខូចខាតទ្រព្យសម្បត្តិភាគីទី៣', '3rd-party property'], ['ខូចខាត ទ្រព្យសម្បត្តិក្រុមហ៊ុន', 'Company property'], ['ផ្សេងទៀត', 'Other damage']];
  const IMMEDIATE = [['🩹 ផ្តល់ជំនួយបឋម', 'First aid given'], ['🚑 បញ្ជូនទៅមន្ទីរពេទ្យ', 'Sent to hospital / clinic'], ['🛑 បញ្ឈប់ការងារ / ម៉ាស៊ីន', 'Stopped the work / machine'],
    ['🚧 ធ្វើឲ្យកន្លែងមានសុវត្ថិភាព ដាក់របាំង', 'Made the area safe, blocked it off'], ['⚠️ ដាក់ស្លាកព្រមាន / កោណ', 'Put warning signs / cones'], ['📦 ចងទំនិញឡើងវិញ / រើចេញ', 'Secured or moved the load'],
    ['🧹 សម្អាតការកំពប់ / ប្រេង', 'Cleaned up the spill / oil'], ['🧯 ពន្លត់ភ្លើង', 'Put out the fire'], ['📷 ថតរូបទីកន្លែង', 'Took photos of the place'],
    ['📞 រាយការណ៍ប្រធាន', 'Told the supervisor'], ['👮 ហៅប៉ូលីស', 'Called the police'], ['📣 ប្រាប់អតិថិជន', 'Told the customer']];
  const INJ_TYPES = [['បុគ្គលិក ISI', 'ISI Employee'], ['បុគ្គលិក 3PL', '3PL Employee'], ['ភាគីទី៣', 'Third-party']];
  // recommended corrective actions; a group that does not fit the incident type is greyed out (e.g. driving for a near miss in the warehouse)
  const RECS = [
    ['drive', '🚗 បណ្តុះបណ្តាលបើកបរដោយសុវត្ថិភាពឡើងវិញ', 'Defensive driving refresher for the driver'], ['drive', '⏱️ ពិនិត្យម៉ោងបើកបរ និងការសម្រាក', 'Check driving hours and rest breaks'],
    ['drive', '🛣️ ជូនដំណឹងតៃកុងពីផ្លូវ / ចំណុចគ្រោះថ្នាក់នេះ', 'Warn drivers about this road / spot'], ['drive', '🔧 ពិនិត្យ និងជួសជុលឡាន', 'Inspect and repair the truck'],
    ['load', '⛓️ ចងទំនិញ / ខ្សែដែកឲ្យរឹងមាំ (ច្រវាក់ ឈើទប់)', 'Secure coils / load with chains and wedges'], ['load', '📋 ពិនិត្យការផ្ទុកមុនចេញដំណើរ', 'Check the load before leaving'],
    ['crane', '🏗️ បណ្តុះបណ្តាលអ្នកបើកស្ទូច / ហ្វកលីហ្វឡើងវិញ', 'Crane / forklift operator refresher'], ['crane', '🔍 ពិនិត្យខ្សែស្លីង ទំពក់ និងស្ទូចមុនប្រើ', 'Check slings, hooks and crane before use'],
    ['crane', '👷 ប្រើអ្នកណែនាំពេលលើក និងថយក្រោយ', 'Use a spotter when lifting and reversing'],
    ['walk', '🚶 ដើរតាមផ្លូវដែលបានគូសសម្គាល់', 'Keep to the marked walkway'], ['walk', '🚧 គូស / ខ័ណ្ឌតំបន់គ្រោះថ្នាក់', 'Mark / fence off the danger zone'],
    ['walk', '🦺 ពាក់ឧបករណ៍ការពារ (មួក អាវ ស្បែកជើង)', 'Wear PPE (helmet, vest, safety shoes)'],
    ['all', '📢 ប្រជុំសុវត្ថិភាពខ្លីជាមួយក្រុម', 'Toolbox talk with the team'], ['all', '📝 កែសម្រួលនីតិវិធីការងារ (SOP)', 'Update the work procedure (SOP)']];
  const REC_FIT = { road: ['drive', 'load', 'all'], wh: ['drive', 'load', 'crane', 'walk', 'all'], near: ['load', 'crane', 'walk', 'all'] };
  const fitRecs = type => RECS.filter(r => (REC_FIT[type] || REC_FIT.wh).indexOf(r[0]) >= 0);
  const recTicks = type => `<select class="in" id="naRec"><option value="">💡 ${esc(t('ជ្រើសវិធានការណែនាំ', 'Pick a suggested action'))}</option>${fitRecs(type).map(r => `<option value="${esc(t(r[1], r[2]).replace(/^\S+\s/, ''))}">${esc(t(r[1], r[2]))}</option>`).join('')}</select>`;
  const COMPANIES = [['ISI Steel', 'ISI Steel'], ['3PL / ឡានជួល', '3PL / Rented'], ['អតិថិជន', 'Customer'], ['ភ្ញៀវ / អ្នកម៉ៅការ', 'Visitor / Contractor']];
  const ROLES = [['តៃកុង', 'Driver'], ['ជំនួយការតៃកុង', 'Driver assistant'], ['អ្នកបើកហ្វកលីហ្វ', 'Forklift operator'], ['អ្នកបើកស្ទូច', 'Crane operator'],
    ['បុគ្គលិកឃ្លាំង', 'Warehouse staff'], ['សន្តិសុខ', 'Security'], ['ប្រធានក្រុម', 'Supervisor'], ['ផ្សេងៗ', 'Other']];
  const SHIFTS = [['ថ្ងៃ', 'Day'], ['យប់', 'Night']];
  const WAREHOUSES = ['Warehouse A-D', 'Warehouse E', 'Warehouse G', 'Warehouse H', 'Warehouse I'];
  const ROADS = [['ស្ងួត', 'Dry'], ['សើម', 'Wet'], ['គ្រហុក / ខូច', 'Potholes'], ['ភក់', 'Mud'], ['ចង្អៀត', 'Narrow road'], ['ចរាចរណ៍ច្រើន', 'Heavy traffic']];
  const WEATHER = [['ថ្ងៃភ្លឺ', 'Daylight'], ['ភ្លៀង', 'Rain'], ['យប់', 'Night'], ['ងងឹត / ពន្លឺតិច', 'Poor light']];
  // choices that contradict each other: ticking one unticks the others (Kim, 25 Oct 2026)
  const CLASH = { Dry: ['Wet', 'Mud'], Wet: ['Dry'], Mud: ['Dry'], Daylight: ['Night', 'Poor light'], Night: ['Daylight'], 'Poor light': ['Daylight'] };
  const STATUS = {
    'Waiting supervisor': ['រង់ចាំប្រធានឃ្លាំង', 'Waiting supervisor', 'pending'], Returned: ['បានបញ្ជូនត្រឡប់', 'Returned', 'rejected'],
    Signed: ['ចុះហត្ថលេខារួច', 'Signed', 'approved'], Closed: ['បានបិទ', 'Closed', 'recorded'],
  };
  const statusBadge = s => { const x = STATUS[s] || [s, s, 'follow']; return `<span class="badge ${x[2]}">${esc(t(x[0], x[1]))}</span>`; };
  const pick = (list, en) => { const x = list.find(p => p[1] === en); return x ? t(x[0], x[1]) : en || ''; };
  const level = s => (!s ? '' : s >= 15 ? 'HIGH' : s >= 8 ? 'MEDIUM' : 'LOW');
  const levelKm = l => ({ HIGH: 'ខ្ពស់', MEDIUM: 'មធ្យម', LOW: 'ទាប' }[l] || '');
  const levelBadge = s => { const l = level(s); return l ? `<span class="badge lv-${l.toLowerCase()}">${s} · ${esc(t(levelKm(l), l))}</span>` : ''; };
  // Emoji before each category in the dropdown (the Icon column of the Categories tab wins).
  const CAT_ICONS = { 'Collision with vehicle': '🚗', 'Collision with object / building': '🧱', Rollover: '🔄', 'Load fell / shifted': '📦',
    'Goods damaged': '💔', 'Injury to person': '🤕', 'Slip / trip / fall': '🚶', 'Forklift / crane': '🏗️', 'Lifting / websling': '⛓️',
    'Speeding / unsafe driving': '⚡', 'Fuel / oil spill': '🛢️', Fire: '🔥', 'Theft / security': '🔒', Other: '🏷️' };
  const catIcon = c => (c && (c.icon || CAT_ICONS[c.en])) || '🏷️';
  let CATS = [];
  const catName = en => { const c = CATS.find(x => x.en === en); return c ? t(c.km || c.en, c.en) : en || ''; };

  // ---------------------------------------------------------------- sign-in token (from the home menu)
  function claims() {
    try { return JSON.parse(decodeURIComponent(escape(atob((get(TOKEN_KEY) || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch (e) { return null; }
  }
  const signedIn = () => { const c = claims(); return !!(c && c.exp * 1000 > Date.now() + 60000); };

  // ---------------------------------------------------------------- Apps Script
  const msgOf = e => { const s = String(e || 'Error'); const m = s.match(/^([A-Z_]+):\s*([\s\S]*)$/); const txt = m ? m[2] : s; const p = txt.split(' || '); return { code: m ? m[1] : '', text: t(p[1] || p[0], p[0]) }; };
  async function api(action, payload) {
    if (DEMO) return demoApi(action, payload || {});
    let data;
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: get(TOKEN_KEY), payload: payload || {} }) });
      data = await res.json();
    } catch (e) {
      throw Object.assign(new Error(t('មិនអាចភ្ជាប់អ៊ីនធឺណិត។ សូមព្យាយាមម្តងទៀត។', 'No connection. Please try again.')), { code: 'NET' });
    }
    if (!data.ok) { const m = msgOf(data.error); throw Object.assign(new Error(m.text), { code: m.code }); }
    if (data.session) set(TOKEN_KEY, data.session);
    return data.data;
  }

  // ---------------------------------------------------------------- state
  let B = getJ('ir_boot', null);           // boot data, kept on the phone so the app opens at once
  TX = getJ('ir_texts', {});
  let screen = () => {};
  const isAdmin = () => !!(B && B.user && B.user.admin);
  const seesAll = () => !!(B && B.user && (B.user.admin || B.user.reviewer));
  const reports = () => (B && B.reports) || [];
  const toSign = () => reports().filter(r => r.toSign);

  async function refresh() {
    try {
      const d = PUBLIC ? await api('publicBoot', { key: PUBLIC_KEY }) : await api('boot');
      B = PUBLIC ? Object.assign({ user: null, reports: [] }, d) : d;
      CATS = B.categories || [];
      useTexts(B.texts);
      if (!PUBLIC) set('ir_boot', JSON.stringify(B));
      paintTabs();
      screen();
    } catch (e) {
      if (e.code === 'AUTH' || e.code === 'NOACCESS') { set('ir_boot', null); B = null; showBlocked(e); return; }
      if (!B) $('#view').innerHTML = `<div class="card"><div class="alert bad">${esc(e.message)}</div><button class="btn mt" id="retry">${t('ព្យាយាមម្តងទៀត', 'Try again')}</button></div>`, $('#retry').onclick = refresh;
      else toast(e.message);
    }
  }

  function useTexts(map) {
    if (!map) return;
    TX = map;
    set('ir_texts', JSON.stringify(map));
    paintStatic();
    // An admin's phone adds the app's new texts to the Texts tab, so they can be edited there.
    const missing = (window.IR_TEXTS || []).filter(r => !(r[0] in map));
    if (missing.length && isAdmin() && !DEMO) api('syncTexts', { rows: missing }).catch(() => {});
  }
  function paintStatic() { $$('[data-km]').forEach(el => { el.textContent = t(el.dataset.km, el.dataset.en); }); }

  // ---------------------------------------------------------------- router
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    $$('.tab[data-r]').forEach(a => a.classList.toggle('on', (h.split('/')[0] || 'home') === a.dataset.r));
    if (PUBLIC) return renderForm(null);
    if (!B) { $('#view').innerHTML = loader('កំពុងផ្ទុករបាយការណ៍', 'Loading reports'); screen = route; return; }
    if (h === 'new') return renderForm(null);
    if (h.startsWith('edit/')) return openEdit(decodeURIComponent(h.slice(5)));
    if (h.startsWith('r/')) return openReport(decodeURIComponent(h.slice(2)));
    if (h === 'sign') return renderList('sign');
    if (h === 'sum') return renderSummary();
    if (h === 'set') return renderSettings();
    return renderList('home');
  }
  window.addEventListener('hashchange', route);
  function paintTabs() {
    const n = toSign().length;
    const b = $('#signCount');
    if (b) { b.textContent = n > 99 ? '99+' : n; b.hidden = !n; }
    const st = $('.tab[data-r="set"]');
    if (st) st.hidden = !isAdmin();
    $('.tabs').classList.toggle('five', isAdmin());
  }

  // ---------------------------------------------------------------- list screens
  let filter = getJ('ir_filter', 'all');
  // tapping a number or a bar (list, summary) opens the reports behind it; ✕ on its chip goes back to the normal filters
  let drill = null;
  const openDrill = (label, fn) => { drill = { label, fn }; if (location.hash === '#/' || location.hash === '') renderList(); else location.hash = '#/'; window.scrollTo(0, 0); };
  function renderList(mode) {
    screen = () => renderList(mode);
    const all = mode === 'sign' ? toSign() : reports();
    const draft = getJ(draftKey(), null);
    const yr = String(new Date().getFullYear());
    const year = reports().filter(r => String(r.date || r.reported).slice(0, 4) === yr);
    const open = reports().filter(r => r.status !== 'Closed').length;
    const F = { all: () => true, open: r => r.status !== 'Closed', mine: r => r.mine, high: r => r.score >= 15 };
    const shown = mode === 'sign' ? all : drill ? all.filter(drill.fn) : all.filter(F[filter] || F.all);
    const q = ($('#q') && $('#q').value || '').trim().toLowerCase();
    const list = q ? shown.filter(r => [r.id, r.category, r.location, r.warehouse, r.plate, r.driver, r.reporter, r.status].join(' ').toLowerCase().includes(q)) : shown;
    $('#view').innerHTML = mode === 'sign' ? `
      <div class="head2"><h2>${t('រង់ចាំហត្ថលេខារបស់ខ្ញុំ', 'Waiting for my signature')}</h2></div>
      ${list.length ? '' : `<div class="card empty">✅ ${t('គ្មានរបាយការណ៍រង់ចាំទេ', 'Nothing to sign')}</div>`}
      <div class="list">${list.map(item).join('')}</div>` : `
      <a class="btn big report-btn" href="#/new">⚠️ ${t('រាយការណ៍ថ្មី', 'New report')}</a>
      ${draft && draft.type ? `<a class="item draftrow" href="#/new"><b>📝 ${t('សេចក្តីព្រាងមិនទាន់ផ្ញើ', 'Draft not sent yet')}</b><div class="meta">${esc(typeName(draft.type))} · ${esc(catName(draft.category))} · ${t('ចុចដើម្បីបន្ត', 'tap to continue')}</div></a>` : ''}
      ${toSign().length ? `<a class="alert warn signrow" href="#/sign">✍️ ${t('មានរបាយការណ៍', 'You have')} <b>${toSign().length}</b> ${t('រង់ចាំហត្ថលេខារបស់អ្នក', 'report(s) waiting for your signature')}</a>` : ''}
      <div class="stats">
        <button type="button" class="stat" data-drill="year"><small>${t('ឆ្នាំនេះ', 'This year')}</small><b>${year.length}</b></button>
        <button type="button" class="stat" data-f="open"><small>${t('មិនទាន់បិទ', 'Open')}</small><b class="warn">${open}</b></button>
        <button type="button" class="stat" data-f="high"><small>${t('ហានិភ័យខ្ពស់', 'High risk')}</small><b class="bad">${year.filter(r => r.score >= 15).length}</b></button>
      </div>
      <div class="chips">${[['all', 'ទាំងអស់', 'All'], ['open', 'មិនទាន់បិទ', 'Open'], ['mine', 'របស់ខ្ញុំ', 'Mine'], ['high', 'ហានិភ័យខ្ពស់', 'High risk']]
        .map(c => `<button type="button" class="chip ${!drill && filter === c[0] ? 'on' : ''}" data-f="${c[0]}">${esc(t(c[1], c[2]))}</button>`).join('')}${drill ? `<button type="button" class="chip on" data-f="${esc(filter)}">${esc(drill.label)} ✕</button>` : ''}</div>
      <input class="in search-in" id="q" type="search" placeholder="🔎 ${esc(t('ស្វែងរក៖ លេខ ផ្លាក តៃកុង ទីកន្លែង', 'Search: number, plate, driver, place'))}" value="${esc(q)}">
      <div class="head2"><h2>${seesAll() ? t('របាយការណ៍ទាំងអស់', 'All reports') : t('របាយការណ៍', 'Reports')}</h2><small>${list.length}</small></div>
      ${list.length ? '' : `<div class="card empty">${t('មិនទាន់មានរបាយការណ៍ទេ', 'No reports yet')}</div>`}
      <div class="list">${list.map(item).join('')}</div>`;
    $$('[data-f]').forEach(b => { b.onclick = () => { drill = null; filter = b.dataset.f; set('ir_filter', JSON.stringify(filter)); renderList(mode); }; });
    $$('[data-drill="year"]').forEach(b => { b.onclick = () => { const y = String(new Date().getFullYear()); openDrill(t('ឆ្នាំនេះ', 'This year'), r => String(r.date || r.reported).slice(0, 4) === y); }; });
    const qi = $('#q');
    if (qi) { qi.oninput = () => { const pos = qi.selectionStart; renderList(mode); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); }; if (q) qi.focus(); }
  }
  function item(r) {
    const k = typeOfEn(r.type);
    return `<a class="item" href="#/r/${encodeURIComponent(r.id)}">
      <div class="top"><span class="id">${(TYPES[k] || {}).ic || '⚠️'} ${esc(r.id)}</span>${statusBadge(r.status)}</div>
      <div class="ttl">${esc(catName(r.category))}${r.injured && r.injured !== '0' ? ` · 🤕 ${esc(r.injured)}` : ''}</div>
      <div class="meta">${esc([r.plate, r.driver, r.location || r.warehouse].filter(Boolean).join(' · '))}</div>
      <div class="meta">${esc(r.date)} ${esc(r.time)} · ${esc(r.reporter)} ${levelBadge(r.score)}${r.open ? ` <span class="openn">· ${r.open} ${t('វិធានការបើក', 'open action(s)')}</span>` : ''}</div></a>`;
  }

  // ---------------------------------------------------------------- the form (5 steps)
  const EMPTY = () => ({ type: '', category: '', shift: 'Day', date: today(), time: nowHm(),
    location: '', warehouse: '', gps: '', road: '', weather: '', driver: '', driverId: '', plate: '', company: '', tripId: '', dn: '', customer: '', load: '',
    people: [], story: '', couldHappen: '', firstAid: '', hospital: '', vehicleDamage: '', goodsDamage: '', property: '', police: '', policeNo: '', insurance: '', cost: '', daysLost: '',
    severity: 0, likelihood: 0, cause: '', whys: ['', '', '', '', ''], immediate: '', actions: [], witnesses: [], evidence: '',
    reporterName: '', reporterPhone: '', supervisor: '', anonymous: false, photos: [], keepPhotos: [], voice: '', keepVoice: '', anyInjured: '', injuredList: [], step: 1 });
  let f = null;           // the report being filled in
  let editId = '';        // a returned report being sent again
  let sending = false;
  // A draft belongs to the person signed in, so a shared phone never shows someone else's report.
  // The driver link (no sign-in) keeps no draft at all.
  const draftKey = () => { const c = !PUBLIC && claims(); const em = (c && c.email) || (DEMO && B && B.user && B.user.email); return em ? 'ir_draft:' + String(em).toLowerCase() : ''; };
  set('ir_draft', null); set('ir_pdraft', null);   // old shared drafts from before
  const saveDraft = () => { if (!editId && f && draftKey()) set(draftKey(), JSON.stringify(Object.assign({}, f, { photos: f.photos.slice(0, 3), voice: f.voice && f.voice.length < 1500000 ? f.voice : '' }))); };

  async function openEdit(id) {
    $('#view').innerHTML = loader('កំពុងបើករបាយការណ៍', 'Opening the report');
    try {
      const d = await api('get', { id });
      if (!d.can || !d.can.edit) { location.hash = '#/r/' + encodeURIComponent(id); return; }
      editId = id;
      f = Object.assign(EMPTY(), d, { reporterName: d.reporter.name, reporterPhone: d.reporter.phone, supervisor: d.supervisor.email, photos: [], keepPhotos: (d.photos || []).slice(), voice: '', keepVoice: d.voice || '', injuredList: (d.injuredList || []).map(x => Object.assign({}, x)), step: 1,
        whys: (d.whys || []).concat(['', '', '', '', '']).slice(0, 5), cost: d.cost || '', daysLost: d.daysLost || '' });
      renderForm(f, true);
    } catch (e) { $('#view').innerHTML = `<div class="card"><div class="alert bad">${esc(e.message)}</div></div>`; }
  }

  function renderForm(start, keep) {
    if (!keep) {
      editId = '';
      f = start || Object.assign(EMPTY(), (draftKey() ? getJ(draftKey(), {}) : {}));
      if (!f.whys || f.whys.length < 5) f.whys = (f.whys || []).concat(['', '', '', '', '']).slice(0, 5);
      if (!f.reporterName && B && B.user) f.reporterName = B.user.name || '';
      if (!f.reporterPhone && B && B.user) f.reporterPhone = B.user.phone || '';
      locate();   // a fresh place every time a new report opens (Kim, 28 Oct 2026)
    }
    screen = () => { collect(); paintForm(); };
    paintForm();
  }

  /** GPS of the phone, then the place name from OpenStreetMap (free) into Location when it is empty. Tap 📍 GPS to fetch it again. */
  function locate(force) {
    const hint = msg => { const h = $('#gpsHint'); if (h) h.textContent = msg; };
    if (force) hint('⏳ ' + t('កំពុងរកទីតាំង...', 'Finding the place...'));
    const got = async (lat, lon) => {
      if (!f) return;
      f.gps = lat.toFixed(5) + ', ' + lon.toFixed(5);
      saveDraft();
      const name = await placeName(lat, lon);
      if (!f) return;
      if (name && (force || !f.location || f.locAuto)) { f.location = name; f.locAuto = true; const el = $('#location'); if (el) el.value = name; saveDraft(); }
      hint(name ? '📍 ' + t('យកពី GPS', 'From GPS') + ' · ' + f.gps : '📍 ' + f.gps + (force ? ' · ' + t('រកឈ្មោះទីកន្លែងមិនឃើញ សូមវាយ', 'No place name found, please type it') : ''));
    };
    if (DEMO) { setTimeout(() => got(11.9521, 104.6632), force ? 700 : 1500); return; }
    if (!navigator.geolocation) { if (force) hint(t('ទូរស័ព្ទនេះមិនមាន GPS', 'This phone has no GPS')); return; }
    navigator.geolocation.getCurrentPosition(p => got(p.coords.latitude, p.coords.longitude),
      () => { if (force) hint('⚠️ ' + t('សូមបើក Location ក្នុងទូរស័ព្ទ', 'Turn on Location on the phone')); },
      { timeout: 10000, maximumAge: force ? 0 : 60000, enableHighAccuracy: !!force });
  }

  async function placeName(lat, lon) {
    if (DEMO) return t('ផ្លូវជាតិលេខ 5, កំពង់ឆ្នាំង', 'National Road 5, Kampong Chhnang');
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=' + lat + '&lon=' + lon + '&accept-language=' + (window.LANG && LANG.get() === 'en' ? 'en' : 'km,en'));
      const j = await r.json(), a = j.address || {};
      const parts = [a.road || a.pedestrian || a.industrial || a.amenity, a.village || a.suburb || a.neighbourhood || a.quarter, a.city_district || a.county || a.town || a.city, a.state || a.province];
      const name = Array.from(new Set(parts.filter(Boolean))).join(', ');
      return name || String(j.display_name || '').split(', ').slice(0, 3).join(', ');
    } catch (e) { return ''; }
  }

  const STEPS = [['ប្រភេទ', 'Type'], ['ពេល ទីកន្លែង', 'When, where'], ['អ្វីកើតឡើង', 'What happened'], ['ហានិភ័យ', 'Risk'], ['ហត្ថលេខា', 'Sign']];
  const field = (id, km, en, opts) => {
    opts = opts || {};
    const v = f[id] == null ? '' : f[id];
    const req = opts.req ? ' <span class="req">*</span>' : '';
    const input = opts.area ? `<textarea class="in" id="${id}" rows="${opts.rows || 3}" placeholder="${esc(opts.ph || '')}">${esc(v)}</textarea>`
      : opts.select ? `<select class="in" id="${id}"><option value=""></option>${opts.select.map(o => `<option value="${esc(o[1])}" ${o[1] === v ? 'selected' : ''}>${esc(t(o[0], o[1]))}</option>`).join('')}</select>`
        : `<input class="in" id="${id}" type="${opts.type || 'text'}" value="${esc(v)}" ${opts.list ? `list="${opts.list}"` : ''} ${opts.mode ? `inputmode="${opts.mode}"` : ''} placeholder="${esc(opts.ph || '')}" autocomplete="off">`;
    return `<div class="field"><label class="f" for="${id}">${esc(t(km, en))}${req}</label>${input}${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}</div>`;
  };
  // one tick box per choice, only one can be ticked (tap it again to untick)
  const one = (id, list) => `<div class="ticks" data-one="${id}">${list.map(o => `<label class="check"><input type="checkbox" value="${esc(o[1])}" ${f[id] === o[1] ? 'checked' : ''}> ${esc(t(o[0], o[1]))}</label>`).join('')}</div>`;
  // damage ticks <-> the vehicleDamage / goodsDamage / property fields the sheet already has ("Company vehicle: scratch; Other vehicle: dent")
  const dmgFrom = d => {
    const o = {};
    String(d.vehicleDamage || '').split('; ').filter(Boolean).forEach(x => { const m = x.match(/^(Company vehicle|Other vehicle): ?(.*)$/); o[m ? m[1] : 'Company vehicle'] = (m ? m[2] : x) || ' '; });
    if (d.goodsDamage) o['Goods on the truck'] = d.goodsDamage;
    String(d.property || '').split('; ').filter(Boolean).forEach(x => { const m = x.match(/^(3rd-party property|Company property|Other damage): ?(.*)$/); o[m ? m[1] : '3rd-party property'] = (m ? m[2] : x) || ' '; });
    return o;
  };
  // "Company property: wall" -> "ខូចខាត ទ្រព្យសម្បត្តិក្រុមហ៊ុន: wall" in Khmer
  const dmgText = v => String(v || '').split('; ').filter(Boolean).map(x => { const o = DAMAGES.find(d => x.indexOf(d[1] + ':') === 0); return o ? t(o[0], o[1]) + ((x.slice(o[1].length + 1).trim() === 'Yes') ? '' : ':' + x.slice(o[1].length + 1)) : x; }).join(' · ');
  const dmgTo = () => {
    const g = k => (f.dmg[k] != null ? String(f.dmg[k]).trim() || 'Yes' : '');
    f.vehicleDamage = ['Company vehicle', 'Other vehicle'].filter(k => f.dmg[k] != null).map(k => k + ': ' + g(k)).join('; ');
    f.goodsDamage = g('Goods on the truck');
    f.property = ['3rd-party property', 'Company property', 'Other damage'].filter(k => f.dmg[k] != null).map(k => k + ': ' + g(k)).join('; ');
  };
  // immediate actions: ticked choices plus "other" text, saved as one line ("First aid given; Told the supervisor; ...")
  const immFrom = v => { const all = IMMEDIATE.map(o => o[1]), parts = String(v || '').split('; ').filter(Boolean); return { ticks: parts.filter(x => all.indexOf(x) >= 0), other: parts.filter(x => all.indexOf(x) < 0).join('; ') }; };
  const immText = v => String(v || '').split('; ').map(x => { const o = IMMEDIATE.find(i => i[1] === x); return o ? t(o[0], o[1]) : x; }).join(' · ');
  const chips = (id, list, multi) => `<div class="chips" data-chips="${id}">${list.map(o => `<button type="button" class="chip ${(multi ? String(f[id]).split(', ').indexOf(o[1]) >= 0 : f[id] === o[1]) ? 'on' : ''}" data-v="${esc(o[1])}">${esc(t(o[0], o[1]))}</button>`).join('')}</div>`;
  // Kim's warehouse list first, then any other warehouse named in the Supervisors tab
  const warehouses = () => Array.from(new Set(WAREHOUSES.concat(((B && B.supervisors) || []).map(s => s.warehouse).filter(Boolean))));
  // step 1 already says where it happened: the warehouse box is open for warehouse incidents and near misses, greyed for road incidents
  const inWh = () => f.type !== 'road';
  const pickBtn = id => `<button type="button" class="picker" id="${id}">${pickIn(id)}</button>`;
  const pickIn = id => `<span class="${f[id] ? '' : 'pph'}">${esc(f[id] || t('— ជ្រើសរើស —', '— Select —'))}${f[id] && f['new_' + id] ? ` <small class="new-tag">${t('ថ្មី', 'New')}</small>` : ''}</span><span class="pk-ic" aria-hidden="true">🔍</span>`;
  const showPick = id => { const b = $('#' + id); if (b && b.tagName === 'BUTTON') b.innerHTML = pickIn(id); };

  let paintedStep = 0;
  function paintForm() {
    const s = f.step;
    const sc = f.severity && f.likelihood ? f.severity * f.likelihood : 0;
    const grow = s !== paintedStep;     // fill the bar only when the step changes, not on every tap
    paintedStep = s;
    const head = `<div class="steps ${grow ? 'grow' : ''}">${STEPS.map((x, i) => `<button type="button" class="st ${i + 1 < s ? 'd' : ''} ${i + 1 === s ? 'on' : ''} ${i + 1 > openStep() ? 'lock' : ''}" data-go="${i + 1}" aria-label="${esc(t(x[0], x[1]))}"><span>${i + 1 < s ? '✓' : i + 1 === s ? i + 1 : ''}</span><small>${esc(t(x[0], x[1]))}</small></button>`).join('')}</div>`;
    let body = '';
    if (editId && f.returnNote) body += `<div class="alert warn">↩️ ${t('ប្រធានឃ្លាំងសុំឲ្យកែ៖', 'The supervisor asked for changes:')} <b>${esc(f.returnNote)}</b></div>`;
    if (s === 1) {
      body += `<div class="card"><h2>${t('តើជាហេតុការណ៍ប្រភេទអ្វី?', 'What kind of incident?')} <span class="req">*</span></h2>
        <div class="types">${Object.keys(TYPES).map(k => `<button type="button" class="typ ${f.type === k ? 'on' : ''}" data-type="${k}"><span class="e">${TYPES[k].ic}</span><span><b>${esc(typeName(k))}</b><small>${esc(t(TYPES[k].hint[0], TYPES[k].hint[1]))}</small></span></button>`).join('')}</div></div>`;
      if (f.type) {
        const cats = CATS.filter(c => !c.types || c.types.indexOf(f.type) >= 0);
        body += `<div class="card"><h2>${t('ប្រភេទរង', 'Category')} <span class="req">*</span></h2>
          <select class="in cat-sel" id="catSel"><option value="">${esc(t('— ជ្រើសរើស —', '— Choose —'))}</option>${cats.map(c => `<option value="${esc(c.en)}" ${f.category === c.en ? 'selected' : ''}>${esc(catIcon(c) + '  ' + t(c.km || c.en, c.en))}</option>`).join('')}</select>
          <label class="f">${t('វេន', 'Shift')}</label><div class="ticks">${SHIFTS.map(o => `<label class="check"><input type="checkbox" data-shift="${esc(o[1])}" ${(f.shift || 'Day') === o[1] ? 'checked' : ''}> ${esc(t(o[0], o[1]))}</label>`).join('')}</div>
          ${f.type === 'near' ? `<label class="check"><input type="checkbox" id="anonymous" ${f.anonymous ? 'checked' : ''}> ${t('មិនបង្ហាញឈ្មោះខ្ញុំ (អនាមិក)', 'Don\'t show my name (anonymous)')}</label>
            <div class="hint">${t('ឈ្មោះមិនបង្ហាញក្នុង PDF Telegram ឬអ៊ីមែលទេ។ មិនចាំបាច់ចុះហត្ថលេខា។', 'Your name is not shown in the PDF, Telegram or email. No signature needed.')}</div>` : ''}</div>`;
      }
    } else if (s === 2) {
      body += `<div class="card"><h2>📍 ${t('ពេលវេលា និងទីកន្លែង', 'When and where')}</h2>
        <div class="row2">${field('date', 'ថ្ងៃកើតហេតុ', 'Date', { type: 'date', req: true })}${field('time', 'ម៉ោង', 'Time', { type: 'time' })}</div>
        <div class="field"><label class="f" for="location">${t('ទីកន្លែង / អាសយដ្ឋាន', 'Location / address')} <span class="req">*</span></label>
          <div class="locrow"><input class="in" id="location" value="${esc(f.location)}" placeholder="${esc(t('ឧ. ផ្លូវជាតិលេខ 5 គ.ម 82', 'e.g. NR5 km 82'))}" autocomplete="off"><button type="button" class="btn sm" id="gpsBtn">📍 GPS</button></div>
          <div class="hint" id="gpsHint">${f.gps ? '📍 ' + t('យកពី GPS', 'From GPS') + ' · ' + esc(f.gps) : ''}</div></div>
        <div class="field ${inWh() ? '' : 'off'}"><label class="f" for="warehouse">${t('ឃ្លាំង / តំបន់', 'Warehouse / area')}</label><select class="in" id="warehouse" ${inWh() ? '' : 'disabled'}><option value=""></option>${warehouses().map(w => `<option value="${esc(w)}" ${w === f.warehouse ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></div>
        <label class="f">${t('ស្ថានភាពផ្លូវ / ទីតាំង', 'Road / site condition')}</label>${chips('road', ROADS, true)}
        <label class="f">${t('អាកាសធាតុ / ពន្លឺ', 'Weather / light')}</label>${chips('weather', WEATHER, true)}</div>`;
      body += `<div class="card"><h2>🚛 ${t('តៃកុង ឡាន និងជើងដឹក', 'Driver, truck and trip')}${f.type === 'near' ? ` <small class="il">(${t('បើមាន', 'if any')})</small>` : ''}</h2>
        <label class="check"><input type="checkbox" id="noVeh" ${f.noVehicle ? 'checked' : ''}> ${t('គ្រោះថ្នាក់មិនពាក់ព័ន្ធឡាន', 'No vehicle involved')}</label>
        <div class="vehbox ${f.noVehicle ? 'off' : ''}">
        <div class="row2"><div class="field"><label class="f" for="plate">${t('ផ្លាកលេខឡាន', 'Truck plate')}</label>${pickBtn('plate')}</div>
        <div class="field"><label class="f" for="driver">${t('ឈ្មោះតៃកុង', 'Driver name')}</label>${pickBtn('driver')}</div></div>
        <div id="tripInfo"></div>
        ${field('company', 'ក្រុមហ៊ុន', 'Company', { select: COMPANIES })}
        <div class="field"><label class="f" for="dn">${t('លេខដឹកជញ្ជូន (DN #)', 'Delivery no. (DN #)')}</label><div class="locrow"><input class="in" id="dn" value="${esc(f.dn)}" autocomplete="off"><button type="button" class="btn sm" id="scanDn" aria-label="${esc(t('ស្កេនបាកូដ', 'Scan barcode'))}">📷 ${t('ស្កេន', 'Scan')}</button></div></div></div></div>`;
      body += `<div class="card"><h2>📷 ${t('រូបថត', 'Photos')} <small class="il">(${t('ច្រើនបំផុត', 'up to')} ${MAX_PHOTOS})</small></h2>
        <div class="photos">${(f.keepPhotos || []).map((id, i) => `<div class="ph kept"><span>📎 ${i + 1}</span><button type="button" data-unkeep="${i}" aria-label="Remove">✕</button></div>`).join('')}
        ${f.photos.map((u, i) => `<div class="ph"><img src="${u}" alt=""><button type="button" data-unphoto="${i}" aria-label="Remove">✕</button></div>`).join('')}
        ${(f.keepPhotos || []).length + f.photos.length < MAX_PHOTOS ? `<label class="ph add">＋<input type="file" id="photoIn" accept="image/*" multiple hidden></label>` : ''}</div>
        <div class="hint">${t('ថតឡាន ទំនិញ ទីកន្លែង និងការខូចខាត', 'Take photos of the truck, goods, place and damage')}</div></div>`;
    } else if (s === 3) {
      body += `<div class="card"><h2>📝 ${t('តើមានអ្វីកើតឡើង', 'What happened')}</h2>
        ${field('story', 'រៀបរាប់មួយជំហានម្តងៗ (អ្វី របៀប នរណា)', 'Describe step by step (what, how, who)', { area: true, rows: 5, req: true })}
        <div class="voice" id="voiceBox">${voiceHtml()}</div>
</div>`;
      body += `<div class="card"><h2>👥 ${t('អ្នកពាក់ព័ន្ធ', 'People involved')}</h2>
        ${f.people.map((p, i) => `<div class="person" data-i="${i}">
          <div class="row2"><input class="in" data-p="name" placeholder="${esc(t('ឈ្មោះ', 'Name'))}" value="${esc(p.name)}"><input class="in" data-p="empId" placeholder="${esc(t('លេខបុគ្គលិក', 'Employee ID'))}" value="${esc(p.empId)}"></div>
          <div class="row2"><select class="in" data-p="company"><option value="">${esc(t('ក្រុមហ៊ុន', 'Company'))}</option>${COMPANIES.map(o => `<option value="${esc(o[1])}" ${p.company === o[1] ? 'selected' : ''}>${esc(t(o[0], o[1]))}</option>`).join('')}</select>
          <select class="in" data-p="role"><option value="">${esc(t('តួនាទី', 'Role'))}</option>${ROLES.map(o => `<option value="${esc(o[1])}" ${p.role === o[1] ? 'selected' : ''}>${esc(t(o[0], o[1]))}</option>`).join('')}</select></div>
          <label class="check"><input type="checkbox" data-p="injured" ${p.injured ? 'checked' : ''}> 🤕 ${t('មានរបួស', 'Injured')}</label>
          ${p.injured ? `<input class="in" data-p="injury" placeholder="${esc(t('របួស / ផ្នែករាងកាយ', 'Injury / body part'))}" value="${esc(p.injury)}">` : ''}
          <button type="button" class="btn sm ghost" data-delperson="${i}">✕ ${t('លុប', 'Remove')}</button></div>`).join('')}
        <button type="button" class="btn sm" id="addPerson">＋ ${t('បន្ថែមអ្នកពាក់ព័ន្ធ', 'Add person')}</button></div>`;
      if (!f.dmg) f.dmg = dmgFrom(f);
      body += `<div class="card"><h2>🩹 ${t('របួស និងការខូចខាត', 'Injury and damage')}</h2>
        <label class="f">${t('មានអ្នករងរបួស?', 'Anyone injured?')}</label>${one('anyInjured', YESNO)}
        ${f.anyInjured === 'Yes' ? `<div class="injlist">${f.injuredList.map((x, i) => `<div class="inj" data-i="${i}">
          <div class="row2"><input class="in" data-j="name" placeholder="${esc(t('ឈ្មោះអ្នករងរបួស', 'Injured person name'))}" value="${esc(x.name)}">
          <select class="in" data-j="type"><option value="">${esc(t('ប្រភេទ', 'Type'))}</option>${INJ_TYPES.map(o => `<option value="${esc(o[1])}" ${x.type === o[1] ? 'selected' : ''}>${esc(t(o[0], o[1]))}</option>`).join('')}</select></div>
          <div class="injfoot"><label class="check"><input type="checkbox" data-j="lti" ${x.lti ? 'checked' : ''}> ${t('របួសបាត់បង់ពេលការងារ (LTI)', 'Lost time injury (LTI)')}</label>
          <button type="button" class="btn sm ghost" data-delinj="${i}">✕</button></div></div>`).join('')}
          <button type="button" class="btn sm" id="addInj">＋ ${t('បន្ថែមអ្នករងរបួស', 'Add injured person')}</button></div>` : ''}
        <label class="f">${t('ការខូចខាត', 'Damage')}</label>
        <div class="dmg">${DAMAGES.map(o => `<div class="dmgrow"><label class="check"><input type="checkbox" data-dmg="${esc(o[1])}" ${f.dmg[o[1]] != null ? 'checked' : ''}> ${esc(t(o[0], o[1]))}</label>
          ${f.dmg[o[1]] != null ? `<input class="in" data-dmgnote="${esc(o[1])}" value="${esc(String(f.dmg[o[1]]).trim())}" placeholder="${o[1] === 'Other damage' ? esc(t('សរសេរការខូចខាតផ្សេងទៀត', 'Describe the other damage')) : esc(t('ខូចអ្វីខ្លះ (ឧ. ប៉ារ៉ាសុកក្រោយ, DN, kg)', 'What is damaged (e.g. rear bumper, DN, kg)'))}">` : ''}</div>`).join('')}</div>
        <label class="f">${t('មានក្រុមហ៊ុនធានារ៉ាប់រងមកត្រួតពិនិត្យ?', 'Insurance company came to inspect?')}</label>${one('insurance', YESNO)}</div>`;
      body += `<div class="card"><h2>👁️ ${t('សាក្សី និងភស្តុតាង', 'Witnesses and evidence')}</h2>
        ${f.witnesses.map((w, i) => `<div class="row2 wit" data-i="${i}"><input class="in" data-w="name" placeholder="${esc(t('ឈ្មោះសាក្សី', 'Witness name'))}" value="${esc(w.name)}"><input class="in" data-w="phone" inputmode="tel" placeholder="${esc(t('ទូរស័ព្ទ', 'Phone'))}" value="${esc(w.phone)}"></div>`).join('')}
        <button type="button" class="btn sm" id="addWit">＋ ${t('បន្ថែមសាក្សី', 'Add witness')}</button>
        <label class="f mt">${t('វីដេអូ / CCTV / កាមេរ៉ាឡាន', 'Video / CCTV / dashcam')}</label>${one('evidence', HAVE)}</div>`;
    } else if (s === 4) {
      body += `<div class="card"><h2>⚖️ ${t('កម្រិតហានិភ័យ', 'Risk rating')}</h2>
        <label class="f">${t('ភាពធ្ងន់ធ្ងរ', 'Severity')}</label>
        <div class="scale">${SEV.map((x, i) => `<button type="button" class="sc ${f.severity === i + 1 ? 'on' : ''}" data-sev="${i + 1}"><b>${i + 1}</b>${esc(t(x[0], x[1]))}</button>`).join('')}</div>
        <label class="f mt">${t('លទ្ធភាពកើតម្តងទៀត', 'Likelihood')}</label>
        <div class="scale five">${LIK.map((x, i) => `<button type="button" class="sc ${f.likelihood === i + 1 ? 'on' : ''}" data-lik="${i + 1}"><b>${i + 1}</b>${esc(t(x[0], x[1]))}</button>`).join('')}</div>
        <div class="score lv-${(level(sc) || 'none').toLowerCase()}"><b>${sc || '–'}</b><span>${sc ? esc(t(levelKm(level(sc)), level(sc))) : t('ជ្រើសភាពធ្ងន់ធ្ងរ និងលទ្ធភាព', 'Pick severity and likelihood')}</span><small>${t('ពិន្ទុ 1–25 · ≥15 ខ្ពស់ · 8–14 មធ្យម', 'Score 1–25 · 15+ high · 8–14 medium')}</small></div></div>`;
      body += `<div class="card"><h2>🔎 ${t('ហេតុអ្វីបានជាកើតឡើង', 'Why did it happen')}</h2>
        <div class="field"><label class="f" for="causeSel">${t('មូលហេតុចម្បង', 'Main cause')}</label><select class="in cat-sel" id="causeSel"><option value="">${esc(t('— ជ្រើសរើស —', '— Choose —'))}</option>${CAUSES.map(o => `<option value="${esc(o[1])}" ${f.cause === o[1] ? 'selected' : ''}>${CAUSE_ICONS[o[1]] || '•'}  ${esc(t(o[0], o[1]))}</option>`).join('')}</select></div>
        <div class="field"><label class="f" for="why0">${t('ហេតុអ្វី?', 'Why?')}</label><input class="in" id="why0" data-why="0" value="${esc(f.whys[0] || '')}"></div>
        <div class="hint">${t('ពន្យល់ពីមូលហេតុបន្ថែមបើអាច', 'Explain the cause in more detail if you can')}</div></div>`;
      body += `<div class="card"><h2>🛠️ ${t('វិធានការ', 'Actions')}</h2>
        <label class="f">${t('វិធានការភ្លាមៗដែលបានធ្វើ ក្រោយកើតហេតុ', 'Immediate action taken')} <small class="il">(${t('ជ្រើសបានច្រើន', 'tick all that apply')})</small></label>
        <div class="imm">${(() => { const im = immFrom(f.immediate); return IMMEDIATE.map(o => `<label class="check"><input type="checkbox" data-imm="${esc(o[1])}" ${im.ticks.indexOf(o[1]) >= 0 ? 'checked' : ''}> ${esc(t(o[0], o[1]))}</label>`).join('') +
          `<input class="in mt" id="immOther" value="${esc(im.other)}" placeholder="${esc(t('ផ្សេងទៀត (វាយបន្ថែម)', 'Other (type here)'))}">`; })()}</div>
</div>`;
    } else {
      const sups = (B && B.supervisors) || [];
      const auto = f.supervisor || ((sups.find(x => x.warehouse === f.warehouse) || {}).email) || (sups.length === 1 ? sups[0].email : '');
      f.supervisor = auto;
      const people = f.people.filter(p => p.injured).length;
      body += `<div class="card"><h2>📋 ${t('ពិនិត្យមុនផ្ញើ', 'Check before sending')}</h2>
        <div class="sumbox"><b>${esc(typeName(f.type))} · ${esc(catName(f.category))}</b>
        <div class="meta">${esc(f.date)} ${esc(f.time)} · ${esc(f.location || f.warehouse)}</div>
        <div class="meta">${esc([f.plate, f.driver].filter(Boolean).join(' · '))}${people ? ` · 🤕 ${people}` : ''} ${levelBadge(sc)}</div>
        <div class="meta">${esc(String(f.story).slice(0, 160))}</div>
        <div class="meta">📷 ${(f.keepPhotos || []).length + f.photos.length} · 🛠️ ${f.actions.filter(a => a.what).length}</div></div>
        ${[1, 2, 3, 4].filter(n => !stepOk(n, true)).map(n => `<div class="alert bad">${esc(stepOk(n))} <a href="#" data-go="${n}">${t('កែ', 'Fix')}</a></div>`).join('')}</div>`;
      body += `<div class="card"><h2>✍️ ${t('ហត្ថលេខា', 'Sign-off')}</h2>
        ${f.anonymous ? `<div class="alert ok">${t('អនាមិក៖ មិនចាំបាច់ឈ្មោះ ឬហត្ថលេខា', 'Anonymous: no name or signature needed')}</div>` : `
        <div class="row2">${field('reporterName', 'ឈ្មោះអ្នករាយការណ៍', 'Reporter name', { req: true })}${field('reporterPhone', 'ទូរស័ព្ទ', 'Phone', { type: 'tel', req: PUBLIC })}</div>
        <label class="f">${t('ហត្ថលេខាអ្នករាយការណ៍', 'Reporter signature')} <span class="req">*</span></label>
        <div class="sigpad"><canvas id="sig"></canvas><button type="button" class="btn sm ghost" id="sigClear">${t('លុប', 'Clear')}</button><span class="sighint">${t('ចុះហត្ថលេខាក្នុងប្រអប់', 'Sign inside the box')}</span></div>`}
        <div class="field mt"><label class="f" for="supervisor">${t('ប្រធានឃ្លាំង (អ្នកចុះហត្ថលេខាទី២)', 'Warehouse Supervisor (second signature)')} <span class="req">*</span></label>
        <select class="in" id="supervisor"><option value=""></option>${sups.map(x => `<option value="${esc(x.email)}" ${x.email === auto ? 'selected' : ''}>${esc(x.name || x.email)}${x.warehouse ? ' · ' + esc(x.warehouse) : ''}</option>`).join('')}</select>
        ${sups.length ? '' : `<div class="msg-err">${t('Admin មិនទាន់បញ្ចូលប្រធានឃ្លាំងក្នុងការកំណត់ទេ', 'The admin has not added any supervisors in Settings yet')}</div>`}</div>
        <button type="button" class="btn ok big" id="send" ${sending ? 'disabled' : ''}>${sending ? '<span class="sp"></span>' : '📤'} ${t('ចុះហត្ថលេខា និងផ្ញើ', 'Sign and send')}</button></div>`;
    }
    const nav = `<div class="navrow">${s > 1 ? `<button type="button" class="btn" data-go="${s - 1}">‹ ${t('ថយក្រោយ', 'Back')}</button>` : `<a class="btn" href="${PUBLIC ? '#' : '#/'}" id="cancelForm">${PUBLIC ? t('សម្អាត', 'Clear') : t('បោះបង់', 'Cancel')}</a>`}
      ${s < 5 ? `<button type="button" class="btn ok" data-next="1">${t('បន្ទាប់', 'Next')} ›</button>` : ''}</div><div class="navspace"></div>`;
    $('#view').innerHTML = `${PUBLIC ? `<div class="alert ok pubnote">🚚 ${t('រាយការណ៍ដោយមិនចាំបាច់ចូលគណនី', 'Report without signing in')}</div>` : ''}
      <div class="formhead"><div class="head2"><h2>${editId ? t('កែ និងផ្ញើម្តងទៀត', 'Edit and send again') + ' · ' + esc(editId) : t('រាយការណ៍ថ្មី', 'New report')}</h2><small>${t('ជំហាន', 'Step')} ${s}/5 <b class="pct">${Math.round(s / 5 * 100)}%</b></small></div>
      ${head}</div>${body}${nav}`;
    // no browser suggestions from earlier reports or other people on this phone
    $$('#view input, #view textarea').forEach(el => { if (el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'file') el.setAttribute('autocomplete', 'off'); });
    wireForm();
  }

  function collect() {
    if (!f || !$('#view .steps')) return;
    $$('#view input.in[id], #view textarea.in[id], #view select.in[id]').forEach(el => { if (el.id in f && !el.dataset.why) f[el.id] = el.value; });
    $$('[data-why]').forEach(el => { f.whys[+el.dataset.why] = el.value; });
    $$('.person').forEach(row => { const p = f.people[+row.dataset.i]; if (!p) return; row.querySelectorAll('[data-p]').forEach(el => { p[el.dataset.p] = el.type === 'checkbox' ? el.checked : el.value; }); });
    $$('.wit').forEach(row => { const w = f.witnesses[+row.dataset.i]; if (!w) return; row.querySelectorAll('[data-w]').forEach(el => { w[el.dataset.w] = el.value; }); });
    $$('.act').forEach(row => { const a = f.actions[+row.dataset.i]; if (!a) return; row.querySelectorAll('[data-a]').forEach(el => { a[el.dataset.a] = el.value; }); });
    $$('.inj').forEach(row => { const x = f.injuredList[+row.dataset.i]; if (!x) return; row.querySelectorAll('[data-j]').forEach(el => { x[el.dataset.j] = el.type === 'checkbox' ? el.checked : el.value; }); });
    const an = $('#anonymous'); if (an) f.anonymous = an.checked;
    if ($('[data-dmg]')) { $$('[data-dmgnote]').forEach(el => { f.dmg[el.dataset.dmgnote] = el.value; }); dmgTo(); }
    if ($('[data-imm]')) f.immediate = $$('[data-imm]').filter(el => el.checked).map(el => el.dataset.imm).concat(($('#immOther').value || '').trim() ? [$('#immOther').value.trim()] : []).join('; ');
    if (f.plate) f.plate = f.plate.toUpperCase().replace(/\s+/g, '');
    saveDraft();
  }

  /** null when the step is complete; otherwise the message (or false with quiet). */
  function stepOk(n, quiet) {
    let m = '';
    if (n === 1 && !f.type) m = t('សូមជ្រើសរើសប្រភេទហេតុការណ៍', 'Choose the incident type');
    else if (n === 1 && !f.category) m = t('សូមជ្រើសរើសប្រភេទរង', 'Choose a category');
    else if (n === 2 && !f.date) m = t('សូមបញ្ចូលថ្ងៃកើតហេតុ', 'Enter the date');
    else if (n === 2 && !f.location) m = t('សូមបញ្ចូលទីកន្លែង', 'Enter the location');
    else if (n === 3 && !String(f.story).trim() && !f.voice && !f.keepVoice) m = t('សូមរៀបរាប់អំពីអ្វីដែលបានកើតឡើង', 'Describe what happened');
    if (quiet) return !m;
    return m || null;
  }

  // The first step with a required field still empty: steps after it can't be opened (Kim, 25 Oct 2026).
  const openStep = () => [1, 2, 3, 4].find(n => !stepOk(n, true)) || 5;
  const MISS = { 'Choose the incident type': '.types', 'Choose a category': '#catSel', 'Enter the date': '#date', 'Enter the location': '#location', 'Describe what happened': '#story' };
  function stopAt(n) {
    const m = stepOk(n);
    if (f.step !== n) { f.step = n; paintForm(); }
    toast(m);
    const sel = MISS[stepOkEn(n)], el = sel && $(sel);
    if (!el) return;
    el.classList.add('miss');
    const clear = () => el.classList.remove('miss');
    ['input', 'change', 'click'].forEach(ev => el.addEventListener(ev, clear, { once: true }));
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (el.tagName !== 'DIV') el.focus({ preventScroll: true });
  }
  function stepOkEn(n) {
    if (n === 1) return !f.type ? 'Choose the incident type' : !f.category ? 'Choose a category' : '';
    if (n === 2) return !f.date ? 'Enter the date' : !f.location ? 'Enter the location' : '';
    if (n === 3) return !String(f.story).trim() && !f.voice && !f.keepVoice ? 'Describe what happened' : '';
    return '';
  }

  function wireForm() {
    const goTo = n => { collect(); const o = openStep(); if (n > f.step && n > o) { stopAt(o); return; } f.step = n; paintForm(); window.scrollTo(0, 0); };
    $$('[data-go]').forEach(b => { b.onclick = e => { e.preventDefault(); goTo(+b.dataset.go); }; });
    $$('[data-next]').forEach(b => { b.onclick = () => goTo(f.step + 1); });
    $$('[data-type]').forEach(b => { b.onclick = () => { collect(); f.type = b.dataset.type; if (f.type !== 'near') f.anonymous = false; if (f.type === 'road') f.warehouse = ''; const cat = CATS.find(c => c.en === f.category); if (cat && cat.types && cat.types.indexOf(f.type) < 0) f.category = ''; paintForm(); }; });
    $$('[data-chips]').forEach(box => {
      const id = box.dataset.chips, multi = id === 'road' || id === 'weather';
      box.querySelectorAll('.chip').forEach(c => { c.onclick = () => {
        collect();
        if (multi) { const cur = String(f[id] || '').split(', ').filter(Boolean); const i = cur.indexOf(c.dataset.v); if (i >= 0) cur.splice(i, 1); else { cur.splice(0, cur.length, ...cur.filter(v => (CLASH[c.dataset.v] || []).indexOf(v) < 0)); cur.push(c.dataset.v); } f[id] = cur.join(', '); }
        else f[id] = f[id] === c.dataset.v ? '' : c.dataset.v;
        saveDraft(); paintForm();
      }; });
    });
    $$('[data-shift]').forEach(b => { b.onchange = () => { f.shift = b.dataset.shift; $$('[data-shift]').forEach(x => { x.checked = x === b; }); saveDraft(); }; });
    const cs = $('#catSel'); if (cs) cs.onchange = () => { f.category = cs.value; saveDraft(); };
    const cz = $('#causeSel'); if (cz) cz.onchange = () => { f.cause = cz.value; saveDraft(); };
    $$('[data-one]').forEach(box => { const all = box.querySelectorAll('input'); all.forEach(b => { b.onchange = () => {
      collect(); f[box.dataset.one] = b.checked ? b.value : ''; all.forEach(x => { if (x !== b) x.checked = false; }); saveDraft();
      if (box.dataset.one === 'anyInjured') { if (f.anyInjured === 'Yes' && !f.injuredList.length) f.injuredList.push({ name: '', type: '', lti: false }); paintForm(); }
    }; }); });
    $$('[data-delinj]').forEach(b => { b.onclick = () => { collect(); f.injuredList.splice(+b.dataset.delinj, 1); saveDraft(); paintForm(); }; });
    $$('[data-dmg]').forEach(b => { b.onchange = () => { collect(); if (b.checked) f.dmg[b.dataset.dmg] = ''; else delete f.dmg[b.dataset.dmg]; dmgTo(); saveDraft(); paintForm(); const n = $(`[data-dmgnote="${b.dataset.dmg}"]`); if (n) n.focus(); }; });
    wireVoice();
    $$('[data-sev]').forEach(b => { b.onclick = () => { collect(); f.severity = +b.dataset.sev; saveDraft(); paintForm(); }; });
    $$('[data-lik]').forEach(b => { b.onclick = () => { collect(); f.likelihood = +b.dataset.lik; saveDraft(); paintForm(); }; });
    const add = (id, fn) => { const b = $(id); if (b) b.onclick = () => { collect(); fn(); saveDraft(); paintForm(); }; };
    add('#addPerson', () => f.people.push({ name: '', empId: '', company: '', role: '', injured: false, injury: '' }));
    add('#addWit', () => f.witnesses.push({ name: '', phone: '' }));
    add('#addAct', () => f.actions.push({ what: '', owner: '', due: '', status: 'Open' }));
    add('#addInj', () => f.injuredList.push({ name: '', type: '', lti: false }));
    $$('[data-delperson]').forEach(b => { b.onclick = () => { collect(); f.people.splice(+b.dataset.delperson, 1); saveDraft(); paintForm(); }; });
    $$('[data-delact]').forEach(b => { b.onclick = () => { collect(); f.actions.splice(+b.dataset.delact, 1); saveDraft(); paintForm(); }; });
    $$('.person [data-p="injured"]').forEach(b => { b.onchange = () => { collect(); paintForm(); }; });
    $$('[data-unphoto]').forEach(b => { b.onclick = () => { collect(); f.photos.splice(+b.dataset.unphoto, 1); saveDraft(); paintForm(); }; });
    $$('[data-unkeep]').forEach(b => { b.onclick = () => { collect(); f.keepPhotos.splice(+b.dataset.unkeep, 1); paintForm(); }; });
    const pi = $('#photoIn');
    if (pi) pi.onchange = async () => {
      collect();
      const room = MAX_PHOTOS - f.photos.length - (f.keepPhotos || []).length;
      for (const file of Array.from(pi.files).slice(0, room)) { try { f.photos.push(await shrink(file)); } catch (e) { toast(t('មិនអាចអានរូបថតនេះបានទេ', 'Could not read this photo')); } }
      saveDraft(); paintForm();
    };
    const cancel = $('#cancelForm');
    if (cancel) cancel.onclick = e => {
      if (!confirmBox(cancel, t('លុបសេចក្តីព្រាងនេះ?', 'Delete this draft?'))) { e.preventDefault(); return; }
      if (draftKey()) set(draftKey(), null); f = null;
      if (PUBLIC) { e.preventDefault(); renderForm(null); }
    };
    const pl = $('#plate');
    if (pl) pl.onclick = () => {
      collect();
      const plates = ((B && B.plates) || []).slice();
      if (f.plate && plates.indexOf(f.plate) < 0) plates.unshift(f.plate);
      const items = plates.map(x => ({ value: x, sub: ((B && B.drivers) || []).filter(d => d.plate === x).map(d => d.name).join(', ') }));
      openPicker({
        title: t('ផ្លាកលេខឡាន', 'Truck plate'), groups: [{ items }], value: f.plate,
        addNew: {
          label: t('បន្ថែមឡានថ្មី', 'Add new truck'),
          clean: q => { const v = q.toUpperCase().trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-'); const m = v.match(/^(\d[A-Z]{1,2})-?(\d{4})$/); return m ? m[1] + '-' + m[2] : v; },
        },
        onPick: (v, isNew) => { f.plate = v; f.new_plate = !!isNew; showPick('plate'); saveDraft(); fillFromPlate(); },
      });
    };
    const dr = $('#driver');
    if (dr) dr.onclick = () => {
      collect();
      // one row per driver name; drivers of the chosen truck come first
      const byName = new Map();
      ((B && B.drivers) || []).forEach(d => { const it = byName.get(d.name) || { value: d.name, plates: [] }; if (d.plate && it.plates.indexOf(d.plate) < 0) it.plates.push(d.plate); byName.set(d.name, it); });
      const all = Array.from(byName.values()).map(it => ({ value: it.value, sub: it.plates.join(', '), mine: !!f.plate && it.plates.indexOf(f.plate) >= 0 }));
      if (f.driver && !byName.has(f.driver)) all.unshift({ value: f.driver, sub: '' });
      const mine = all.filter(x => x.mine);
      openPicker({
        title: t('ឈ្មោះតៃកុង', 'Driver name'), value: f.driver,
        groups: mine.length ? [{ label: t('ឡាន ', 'Truck ') + f.plate, items: mine }, { label: t('តៃកុងទាំងអស់', 'All drivers'), items: all.filter(x => !x.mine) }] : [{ items: all }],
        addNew: { label: t('បន្ថែមតៃកុងថ្មី', 'Add new driver'), clean: q => q.replace(/\s+/g, ' ').trim() },
        onPick: (v, isNew) => {
          f.driver = v; f.new_driver = !!isNew; showPick('driver');
          const d = ((B && B.drivers) || []).find(x => x.name === v);
          if (d && d.plate && !f.plate) { f.plate = d.plate; f.new_plate = false; showPick('plate'); fillFromPlate(); }
          saveDraft();
        },
      });
    };
    const nv = $('#noVeh');
    if (nv) nv.onchange = () => { collect(); f.noVehicle = nv.checked; if (nv.checked) ['plate', 'driver', 'company', 'dn', 'tripId', 'customer', 'new_plate', 'new_driver'].forEach(k => { f[k] = k.indexOf('new_') ? '' : false; }); saveDraft(); paintForm(); };
    if (f && f.noVehicle) $$('.vehbox button, .vehbox input, .vehbox select').forEach(el => { el.disabled = true; });
    const sd = $('#scanDn');
    if (sd) sd.onclick = () => { collect(); scanCode(code => { const have = String(f.dn || '').split(/[\s,]+/).filter(Boolean); if (have.indexOf(code) < 0) have.push(code); f.dn = have.join(', '); const el = $('#dn'); if (el) el.value = f.dn; saveDraft(); toast('✅ DN ' + code); }); };
    const gb = $('#gpsBtn');
    if (gb) gb.onclick = () => { collect(); locate(true); };
    const le = $('#location');
    if (le) le.addEventListener('input', () => { if (f) f.locAuto = false; });   // typed by hand: GPS no longer replaces it
    $$('#view input.in, #view textarea.in, #view select.in').forEach(el => { el.addEventListener('change', collect); });
    if ($('#sig')) sigPad($('#sig'), $('#sigClear'));
    const send = $('#send');
    if (send) send.onclick = submit;
  }

  /** Two taps to confirm: the first tap turns the button red and asks; the second does it. */
  function confirmBox(el, q) {
    if (el.dataset.sure) return true;
    el.dataset.sure = '1'; el.dataset.txt = el.textContent; el.textContent = q; el.classList.add('danger');
    setTimeout(() => { if (el.isConnected) { delete el.dataset.sure; el.textContent = el.dataset.txt; el.classList.remove('danger'); } }, 3500);
    return false;
  }

  // ---- voice note for "what happened": record on the phone (up to 3 minutes), play it back, sent with the report
  const VOICE_MAX = 180;
  let rec = null;
  function voiceHtml() {
    if (rec) return `<button type="button" class="btn sm danger" id="vStop">⏹ ${t('ឈប់ថត', 'Stop')} <span id="vTime">0:00</span></button> <span class="vdot"></span>`;
    if (f.voice || f.keepVoice) return `<div class="vrow">${f.voice ? `<audio controls src="${f.voice}"></audio>` : `<span class="hint">🎤 ${t('មានសំឡេងពីមុន', 'Voice note already saved')}</span>`}<button type="button" class="btn sm ghost" id="vDel">✕ ${t('លុប', 'Delete')}</button></div>`;
    return `<button type="button" class="btn sm" id="vRec">🎤 ${t('ថតសំឡេងជំនួសការវាយ', 'Record voice instead of typing')}</button>`;
  }
  function wireVoice() {
    const box = $('#voiceBox');
    if (!box) return;
    const redraw = () => { box.innerHTML = voiceHtml(); wireVoice(); };
    const r = $('#vRec'), st = $('#vStop'), del = $('#vDel');
    if (r) r.onclick = async () => {
      if (!navigator.mediaDevices || !window.MediaRecorder) { toast(t('ទូរស័ព្ទនេះមិនអាចថតសំឡេងបានទេ', 'This phone cannot record voice')); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast(t('សូមអនុញ្ញាតមីក្រូហ្វូន', 'Please allow the microphone')); return; }
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(x => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(x)) || '';
      const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
      const chunks = [], t0 = Date.now();
      rec = { mr, timer: setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000), el = $('#vTime'); if (el) el.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); if (sec >= VOICE_MAX) mr.stop(); }, 500) };
      mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        clearInterval(rec.timer); rec = null; stream.getTracks().forEach(x => x.stop());
        const fr = new FileReader();
        fr.onload = () => { if (!f) return; f.voice = fr.result; f.keepVoice = ''; saveDraft(); redraw(); };
        fr.readAsDataURL(new Blob(chunks, { type: (mr.mimeType || 'audio/webm').split(';')[0] }));
      };
      mr.start(1000); redraw();
    };
    if (st) st.onclick = () => { if (rec) rec.mr.stop(); };
    if (del) del.onclick = () => { f.voice = ''; f.keepVoice = ''; saveDraft(); redraw(); };
  }

  /** Searchable list in a bottom sheet, like the Fuel app. groups: [{label?, items: [{value, sub?}]}]. Text that matches nothing can be added as new. */
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

  /** Camera barcode scan (DN). Android uses the built-in BarcodeDetector; other phones load the zxing reader. The number can always be typed instead. */
  function scanCode(onCode) {
    let stream = null, stopped = false, timer = 0, ctrl = null;
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-grip"></div>
        <div class="sheet-top"><div class="sheet-h">${esc(t('ស្កេនបាកូដ DN', 'Scan the DN barcode'))}</div><button type="button" class="icon-btn" data-close aria-label="${esc(t('បិទ', 'Close'))}">✕</button></div>
        <div class="scan-view"><video playsinline muted></video><div class="scan-frame"></div></div>
        <p class="hint center" id="scanMsg">${esc(t('ដាក់បាកូដក្នុងប្រអប់', 'Hold the barcode inside the box'))}</p></div>`;
    const video = bg.querySelector('video'), msg = bg.querySelector('#scanMsg');
    const close = () => { stopped = true; clearTimeout(timer); if (ctrl) try { ctrl.stop(); } catch (e) { /* already stopped */ } if (stream) stream.getTracks().forEach(x => x.stop()); bg.classList.remove('open'); setTimeout(() => bg.remove(), 200); };
    const done = code => { if (stopped || !code) return; code = String(code).trim(); close(); onCode(code); };
    bg.onclick = e => { if (e.target === bg || e.target.closest('[data-close]')) close(); };
    document.body.appendChild(bg);
    requestAnimationFrame(() => bg.classList.add('open'));
    const fail = () => { if (stopped) return; msg.textContent = t('មិនអាចបើកកាមេរ៉ាបានទេ។ សូមវាយលេខ DN។', 'Camera not available. Please type the DN number.'); bg.querySelector('.scan-view').hidden = true; };
    if (DEMO) { timer = setTimeout(() => done('8100452231'), 1500); return; }
    (async () => {
      try {
        if ('BarcodeDetector' in window) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
          if (stopped) { stream.getTracks().forEach(x => x.stop()); return; }
          video.srcObject = stream; await video.play();
          const det = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'qr_code', 'upc_a', 'codabar'] });
          const tick = async () => { if (stopped) return; try { const r = await det.detect(video); if (r && r[0] && r[0].rawValue) return done(r[0].rawValue); } catch (e) { /* next frame */ } timer = setTimeout(tick, 150); };
          tick();
        } else {
          const z = await import('../vendor/zxing-browser.min.js');
          if (stopped) return;
          ctrl = await new z.BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video, r => { if (r) done(r.getText()); });
          if (stopped) ctrl.stop();
        }
      } catch (e) { fail(); }
    })();
  }

  async function fillFromPlate() {
    const box = $('#tripInfo');
    const d = ((B && B.drivers) || []).find(x => x.plate === f.plate);
    if (d && !f.driver) { f.driver = d.name; f.new_driver = false; showPick('driver'); }
    if (d && !f.company) { f.company = d.company && !/isi/i.test(d.company) ? '3PL / Rented' : 'ISI Steel'; const el = $('#company'); if (el) el.value = f.company; }
    if (!f.plate || PUBLIC || !box) return;
    box.innerHTML = `<div class="hint">⏳ ${t('កំពុងរកជើងដឹក...', 'Looking for the trip...')}</div>`;
    try {
      const tr = await api('trip', { plate: f.plate, date: f.date });
      if (!tr || !tr.tripId) { box.innerHTML = ''; return; }
      ['tripId', 'dn', 'customer'].forEach(k => { if (tr[k] && !f[k]) { f[k] = tr[k]; const el = $('#' + k); if (el) el.value = tr[k]; } });
      if (tr.driver && !f.driver) { f.driver = tr.driver; showPick('driver'); }
      box.innerHTML = `<div class="tripbox">🔗 ${t('ពីជើងដឹក', 'From Delivery trip')} <b>${esc(tr.tripId)}</b><div class="meta">${esc([tr.driver, tr.dn, tr.customer].filter(Boolean).join(' · '))}</div></div>`;
      saveDraft();
    } catch (e) { box.innerHTML = ''; }
  }

  /** Photo made smaller on the phone (1280 px JPEG), so sending is quick on 4G. */
  function shrink(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, c.width, c.height);
        // stamp like the other iSteel apps: navy strip with the date and time
        const h = Math.max(22, Math.round(c.height * 0.045));
        g.fillStyle = 'rgba(1,30,65,.85)'; g.fillRect(0, c.height - h, c.width, h);
        g.fillStyle = '#fff'; g.font = `600 ${Math.round(h * 0.55)}px sans-serif`; g.textBaseline = 'middle';
        const d = new Date();
        g.fillText('STEEL · ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()), 8, c.height - h / 2);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
      img.src = url;
    });
  }

  // ---------------------------------------------------------------- signature pad
  let sigData = '';
  function sigPad(canvas, clearBtn) {
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.parentElement.clientWidth, h = 170;
    canvas.width = w * ratio; canvas.height = h * ratio; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const g = canvas.getContext('2d');
    g.scale(ratio, ratio); g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0b3a75';
    let drawing = false, last = null, inked = false;
    sigData = '';
    // Locked until "Unlock to sign" is tapped, so scrolling over the box never draws by mistake (Kim, 28 Oct 2026).
    const pad = canvas.parentElement;
    pad.classList.add('locked');
    const un = document.createElement('button');
    un.type = 'button'; un.className = 'sigunlock';
    un.innerHTML = `🔒 ${t('ដោះសោដើម្បីចុះហត្ថលេខា', 'Unlock to sign')}`;
    un.onclick = () => { pad.classList.remove('locked'); un.remove(); };
    pad.appendChild(un);
    const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.onpointerdown = e => { if (pad.classList.contains('locked')) return; e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; last = pos(e); g.beginPath(); g.arc(last.x, last.y, 1.2, 0, 7); g.fill(); };
    canvas.onpointermove = e => { if (!drawing) return; const p = pos(e); g.beginPath(); g.moveTo(last.x, last.y); g.lineTo(p.x, p.y); g.stroke(); last = p; inked = true; };
    const end = () => { if (!drawing) return; drawing = false; if (inked) sigData = canvas.toDataURL('image/png'); canvas.parentElement.classList.toggle('inked', inked); };
    canvas.onpointerup = end; canvas.onpointercancel = end; canvas.onpointerleave = end;
    if (clearBtn) clearBtn.onclick = () => { g.clearRect(0, 0, w, h); inked = false; sigData = ''; canvas.parentElement.classList.remove('inked'); };
  }

  async function submit() {
    collect();
    for (const n of [1, 2, 3]) { const m = stepOk(n); if (m) { toast(m); f.step = n; paintForm(); return; } }
    if (!f.anonymous && !String(f.reporterName).trim()) { toast(t('សូមបញ្ចូលឈ្មោះរបស់អ្នក', 'Enter your name')); return; }
    if (PUBLIC && !String(f.reporterPhone).trim()) { toast(t('សូមបញ្ចូលលេខទូរស័ព្ទ', 'Enter your phone number')); return; }
    if (!f.anonymous && !sigData) { toast(t('សូមចុះហត្ថលេខាមុនពេលផ្ញើ', 'Please sign before sending')); return; }
    if (!f.supervisor) { toast(t('សូមជ្រើសរើសប្រធានឃ្លាំង', 'Choose the Warehouse Supervisor')); return; }
    sending = true;
    const btn = $('#send'); btn.disabled = true; btn.innerHTML = `<span class="sp"></span> ${t('កំពុងផ្ញើ...', 'Sending...')}`;
    const payload = Object.assign({}, f, { id: editId || undefined, signature: f.anonymous ? '' : sigData, key: PUBLIC_KEY || undefined });
    delete payload.step; delete payload.can; delete payload.history; delete payload.dmg; delete payload.voiceData;
    try {
      const r = await api(PUBLIC ? 'publicSubmit' : 'submit', payload);
      if (draftKey()) set(draftKey(), null);
      sending = false;
      const id = r.id;
      f = null; editId = ''; screen = () => {};
      $('#view').innerHTML = `<div class="card done"><div class="emoji">✅</div><h2>${t('បានផ្ញើរួចរាល់', 'Sent')}</h2>
        <div class="reqid">${esc(id)}</div><p>${t('ប្រធានឃ្លាំងបានទទួលដំណឹងតាម Telegram ហើយនឹងចុះហត្ថលេខា។', 'The Warehouse Supervisor gets it on Telegram and will sign it.')}</p>
        ${PUBLIC ? `<button class="btn ok big" id="again">${t('រាយការណ៍មួយទៀត', 'Report another')}</button>` : `<a class="btn ok big" href="#/r/${encodeURIComponent(id)}">${t('មើលរបាយការណ៍', 'Open the report')}</a><a class="btn big mt" href="#/">${t('ទៅបញ្ជី', 'Back to the list')}</a>`}</div>`;
      if (PUBLIC) $('#again').onclick = () => renderForm(null);
      else refresh();
    } catch (e) {
      sending = false;
      btn.disabled = false; btn.innerHTML = `📤 ${t('ចុះហត្ថលេខា និងផ្ញើ', 'Sign and send')}`;
      toast(e.message);
    }
  }

  // ---------------------------------------------------------------- one report
  let cur = null;
  // Reports opened before show at once from this phone's copy, then refresh quietly (photos stay in memory only).
  const repKey = () => { const k = draftKey(); return k ? k.replace('ir_draft:', 'ir_reps:') : ''; };
  const repStore = () => (repKey() ? getJ(repKey(), {}) : {});
  const plain = d => { const o = Object.assign({}, d); delete o.photoThumbs; delete o.voiceData; delete o.fullPhotos; delete o.mediaBusy; return o; };
  function keepReport(d) {
    if (!repKey()) return;
    const all = repStore(); all[d.id] = Object.assign(plain(d), { _at: Date.now() });
    const ids = Object.keys(all).sort((a, b) => all[b]._at - all[a]._at);
    ids.slice(20).forEach(k => delete all[k]);
    set(repKey(), JSON.stringify(all));
  }
  const memMedia = {};
  const mediaKey = d => JSON.stringify(d.photos || []) + '|' + (d.voice || '');
  const withMedia = d => { const m = memMedia[d.id]; if (!d.photoThumbs && m && m.k === mediaKey(d)) { d.photoThumbs = m.photoThumbs; d.voiceData = m.voiceData; } return d; };
  async function openReport(id) {
    screen = () => (cur && cur.id === id ? paintReport() : openReport(id));
    const saved = repStore()[id];
    if (saved) { cur = Object.assign({}, saved); paintReport(); }
    else {
      const brief = reports().find(r => r.id === id);
      $('#view').innerHTML = brief ? `<div class="item">${item(brief).replace(/^<a[^>]*>|<\/a>$/g, '')}</div>${loader('កំពុងបើករបាយការណ៍', 'Opening the report')}` : loader('កំពុងបើករបាយការណ៍', 'Opening the report');
    }
    try {
      const d = await api('get', { id });
      const same = saved && JSON.stringify(Object.assign({}, plain(saved), { _at: 0 })) === JSON.stringify(Object.assign({}, plain(d), { _at: 0 }));
      keepReport(d);
      if (!location.hash.endsWith('/r/' + encodeURIComponent(id)) && !location.hash.endsWith('/r/' + id)) return;
      if (same) return;
      cur = d; paintReport();
    } catch (e) { if (!saved) $('#view').innerHTML = `<div class="card"><div class="alert bad">${esc(e.message)}</div><a class="btn mt" href="#/">${t('ទៅបញ្ជី', 'Back to the list')}</a></div>`; }
  }

  const kv = (km, en, v) => (v ? `<div class="kv"><span>${esc(t(km, en))}</span><b>${esc(v)}</b></div>` : '');
  function paintReport() {
    withMedia(cur); keepReport(cur);
    const d = cur, c = d.can || {};
    const sc = d.severity && d.likelihood ? d.severity * d.likelihood : 0;
    const sec = (title, inner) => (inner.trim() ? `<div class="card sec"><h2>${title}</h2>${inner}</div>` : '');
    let html = `<div class="card rhead"><div class="top"><span class="id">${(TYPES[d.type] || {}).ic || '⚠️'} ${esc(d.id)}</span>${statusBadge(d.status)}</div>
      <h2 class="rt">${esc(typeName(d.type))} · ${esc(catName(d.category))}</h2>
      <div class="meta">${esc(d.date)} ${esc(d.time)} · ${esc(d.location || d.warehouse)}</div>
      <div class="meta">${levelBadge(sc)}</div>
      <div class="signs"><div class="${d.reporter.at ? 'ok' : ''}">✍️ ${esc(d.reporter.name)}<small>${esc(d.reporter.at || '')}</small></div>
        <div class="${d.supervisor.at ? 'ok' : ''}">✍️ ${esc(d.supervisor.name || d.supervisor.email)}<small>${esc(d.supervisor.at || t('រង់ចាំ', 'waiting'))}</small></div></div>
      <div class="row-btns"><button class="btn sm" id="pdfBtn">📄 PDF</button>${c.email ? `<button class="btn sm ok" id="mailBtn">✉️ ${t('ផ្ញើតាមអ៊ីមែល', 'Send by email')}</button>` : ''}
        ${c.edit ? `<a class="btn sm ok" href="#/edit/${encodeURIComponent(d.id)}">✏️ ${t('កែ និងផ្ញើម្តងទៀត', 'Edit and send again')}</a>` : ''}</div>
      ${d.status === 'Returned' && d.returnNote ? `<div class="alert warn">↩️ ${esc(d.returnNote)}</div>` : ''}
      <div id="mailBox"></div></div>`;
    html += sec(`🚛 ${t('ពេល ទីកន្លែង ឡាន', 'When, where, truck')}`, kv('វេន', 'Shift', pick(SHIFTS, d.shift)) + kv('ឃ្លាំង', 'Warehouse', d.warehouse) + kv('GPS', 'GPS', d.gps) +
      kv('ផ្លូវ', 'Road / site', d.road) + kv('អាកាសធាតុ', 'Weather', d.weather) + kv('ផ្លាកលេខ', 'Plate', d.plate) + kv('តៃកុង', 'Driver', [d.driver, d.driverId].filter(Boolean).join(' · ')) +
      kv('ក្រុមហ៊ុន', 'Company', pick(COMPANIES, d.company)) + kv('Trip ID', 'Trip ID', d.tripId) + kv('DN', 'DN', d.dn) + kv('អតិថិជន', 'Customer', d.customer) + kv('ទំនិញ', 'Load', d.load));
    html += sec(`📝 ${t('អ្វីកើតឡើង', 'What happened')}`, `<p class="story">${esc(d.story)}</p>${d.voice ? `<div class="kv"><span>🎤 ${t('សំឡេង', 'Voice')}</span></div><div id="voiceSlot">${d.voiceData ? `<audio controls preload="none" src="${d.voiceData}"></audio>` : `<p class="hint">${t('កំពុងផ្ទុក…', 'Loading…')}</p>`}</div>` : ''}${d.couldHappen ? `<p class="hint">${t('អាចកើតឡើង៖', 'Could have happened:')} ${esc(d.couldHappen)}</p>` : ''}
      ${(d.people || []).map(p => `<div class="kv"><span>${p.injured ? '🤕' : '👤'} ${esc(p.name)}</span><b>${esc([pick(ROLES, p.role), pick(COMPANIES, p.company), p.injury].filter(Boolean).join(' · '))}</b></div>`).join('')}`);
    html += sec(`🩹 ${t('របួស និងការខូចខាត', 'Injury and damage')}`, kv('មានអ្នករងរបួស', 'Anyone injured', pick(YESNO, d.anyInjured)) +
      (d.injuredList || []).map(x => `<div class="kv"><span>🤕 ${esc(x.name)}</span><b>${esc([pick(INJ_TYPES, x.type), x.lti ? 'LTI' : ''].filter(Boolean).join(' · '))}</b></div>`).join('') +
      kv('ជំនួយបឋម', 'First aid', pick(YESNO, d.firstAid)) + kv('មន្ទីរពេទ្យ', 'Hospital', d.hospital) + kv('ឡាន', 'Vehicle', dmgText(d.vehicleDamage)) +
      kv('ទំនិញ', 'Goods', d.goodsDamage) + kv('ទ្រព្យសម្បត្តិ', 'Property', dmgText(d.property)) + kv('ប៉ូលីស', 'Police', [pick(YESNO, d.police), d.policeNo].filter(Boolean).join(' · ')) + kv('ធានារ៉ាប់រង', 'Insurance', pick(YESNO, d.insurance)) + kv('វីដេអូ / CCTV', 'Video / CCTV', pick(HAVE, d.evidence)) +
      kv('ថ្លៃប៉ាន់ស្មាន', 'Est. cost', d.cost ? '$' + d.cost : '') + kv('ថ្ងៃឈប់ការងារ', 'Days lost', d.daysLost ? String(d.daysLost) : ''));
    html += sec(`🔎 ${t('ហានិភ័យ និងមូលហេតុ', 'Risk and cause')}`, kv('ភាពធ្ងន់ធ្ងរ', 'Severity', d.severity ? d.severity + ' · ' + t(SEV[d.severity - 1][0], SEV[d.severity - 1][1]) : '') +
      kv('លទ្ធភាព', 'Likelihood', d.likelihood ? d.likelihood + ' · ' + t(LIK[d.likelihood - 1][0], LIK[d.likelihood - 1][1]) : '') + kv('មូលហេតុចម្បង', 'Main cause', pick(CAUSES, d.cause)) +
      (d.whys || []).map((w, i) => kv('ហេតុអ្វី ' + (i + 1), 'Why ' + (i + 1), w)).join('') + kv('វិធានការភ្លាមៗ', 'Immediate action', immText(d.immediate)));
    const acts = d.actions || [];
    html += `<div class="card sec"><h2>🛠️ ${t('វិធានការ (បំពេញដោយប្រធានក្រុម)', 'Actions (filled by team leader)')}</h2>
      ${acts.length ? acts.map((a, i) => `<div class="actrow" data-i="${i}"><div><b>${esc(a.what)}</b><small>${esc([a.owner, a.due].filter(Boolean).join(' · '))}${a.done ? ' · ✅ ' + esc(a.done) : ''}</small></div>
        ${c.actions ? `<select class="in st-sel" data-ai="${i}">${[['បើក', 'Open'], ['កំពុងធ្វើ', 'In progress'], ['រួចរាល់', 'Done']].map(o => `<option value="${o[1]}" ${a.status === o[1] ? 'selected' : ''}>${esc(t(o[0], o[1]))}</option>`).join('')}</select>`
          : `<span class="badge ${a.status === 'Done' ? 'approved' : a.due && a.due < today() ? 'rejected' : 'pending'}">${esc(t({ Open: 'បើក', 'In progress': 'កំពុងធ្វើ', Done: 'រួចរាល់' }[a.status] || a.status, a.status))}</span>`}</div>`).join('')
        : `<p class="hint">${t('មិនទាន់មានវិធានការ', 'No actions yet')}</p>`}
      ${c.actions ? `<div class="newact">${recTicks(d.type)}<input class="in opt" id="naWhat" placeholder="${esc(t('វិធានការផ្សេងទៀត (បើមិនមានក្នុងបញ្ជី)', 'Other action (if not in the list)'))}"><div class="row2"><input class="in" id="naOwner" placeholder="${esc(t('អ្នកទទួលខុសត្រូវ', 'Owner'))}"><input class="in" id="naDue" type="date"></div></div>` : ''}
      ${c.actions || c.close ? `<div class="actbtns${c.actions && c.close ? ' two' : ''}">${c.actions ? `<button class="btn big" id="saveActs">💾 ${t('រក្សាទុកវិធានការ', 'Save actions')}</button>` : ''}${c.close ? `<button class="btn big" id="closeBtn">🔒 ${t('បិទករណីនេះ', 'Close this case')}</button>` : ''}</div>` : ''}</div>`;
    const nPh = (d.photos || []).length;
    if (nPh) html += `<div class="card sec"><h2>📷 ${t('រូបថត', 'Photos')} (${nPh})</h2><div class="photos">${d.photos.map((x, i) => `<button type="button" class="ph view" data-ph="${i}">${(d.photoThumbs || [])[i] ? `<img src="${d.photoThumbs[i]}" alt="">` : '<span class="spin"></span>'}</button>`).join('')}</div></div>`;
    if (c.sign) html += `<div class="card signcard"><h2>✍️ ${t('ចុះហត្ថលេខាជាប្រធានឃ្លាំង', 'Sign as Warehouse Supervisor')}</h2>
      <p class="hint">${t('ពិនិត្យរបាយការណ៍ខាងលើ កែវិធានការបើចាំបាច់ ហើយចុះហត្ថលេខា។', 'Check the report above, adjust the actions if needed, then sign.')}</p>
      <div class="field"><label class="f" for="supComment">${t('មតិ (បើមាន)', 'Comment (optional)')}</label><textarea class="in" id="supComment" rows="2"></textarea></div>
      <div class="sigpad"><canvas id="sig"></canvas><button type="button" class="btn sm ghost" id="sigClear">${t('លុប', 'Clear')}</button><span class="sighint">${t('ចុះហត្ថលេខាក្នុងប្រអប់', 'Sign inside the box')}</span></div>
      <button class="btn ok big mt" id="signBtn">✅ ${t('ចុះហត្ថលេខា', 'Sign')}</button>
      <button class="btn big mt" id="backBtn">↩️ ${t('បញ្ជូនត្រឡប់ឲ្យកែ', 'Send back for changes')}</button></div>`;
    html += sec(`🕓 ${t('ប្រវត្តិ', 'History')}`, (d.history || []).slice().reverse().map(h => `<div class="kv"><span>${esc(h.at)}</span><b>${esc(h.by)}: ${esc(h.what)}</b></div>`).join(''));
    $('#view').innerHTML = html;
    wireReport();
  }

  function busy(btn, on, label) { btn.disabled = on; if (on) { btn.dataset.l = btn.innerHTML; btn.innerHTML = `<span class="sp"></span> ${label || ''}`; } else if (btn.dataset.l) btn.innerHTML = btn.dataset.l; }
  // Photos and the voice note load after the report is on screen; tapping a photo opens it here, in the app.
  async function loadMedia(d) {
    if ((d.photoThumbs && d.photoThumbs.some(Boolean)) || d.mediaBusy || !((d.photos || []).length || d.voice)) return;
    d.mediaBusy = true;
    let why = '';
    try {
      const m = await api('media', { id: d.id });
      d.photoThumbs = m.photos || []; d.voiceData = m.voice || '';
      if (d.photoThumbs.some(Boolean)) memMedia[d.id] = { k: mediaKey(d), photoThumbs: d.photoThumbs, voiceData: d.voiceData };
    } catch (e) { why = e.message; }
    if (!(d.photoThumbs || []).some(Boolean)) {
      // an Apps Script from before 'media' sends the photos with the report itself
      try { const g = await api('get', { id: d.id }); if ((g.photoThumbs || []).some(Boolean)) { d.photoThumbs = g.photoThumbs; d.voiceData = g.voiceData || d.voiceData || ''; } }
      catch (x) { why = why || x.message; }
    }
    d.mediaBusy = false;
    d.photoThumbs = d.photoThumbs || []; d.voiceData = d.voiceData || '';
    if (cur !== d) return;
    $$('[data-ph]').forEach(b => { const u = d.photoThumbs[+b.dataset.ph]; b.innerHTML = u ? `<img src="${u}" alt="">` : '⚠️'; });
    if (!d.photoThumbs.some(Boolean) && $('[data-ph]')) { const box = $('[data-ph]').parentElement; if (box && !box.nextElementSibling) box.insertAdjacentHTML('afterend', `<p class="hint">⚠️ ${t('មិនអាចបើករូបថត', 'Photos could not be loaded')}${why ? ': ' + esc(why) : ''}</p>`); }
    const vs = $('#voiceSlot');
    if (vs) vs.innerHTML = d.voiceData ? `<audio controls preload="none" src="${d.voiceData}"></audio>` : `<p class="hint">${t('មិនអាចបើកសំឡេង', 'Voice note could not be loaded')}</p>`;
  }
  function viewPhoto(d, i) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<button type="button" class="lb-x" aria-label="Close">✕</button>${(d.photoThumbs || [])[i] ? `<img src="${d.photoThumbs[i]}" alt="">` : ''}<span class="spin"></span>`;
    const close = () => { box.remove(); document.removeEventListener('keydown', esc_); };
    const esc_ = e => { if (e.key === 'Escape') close(); };
    box.onclick = close;
    document.addEventListener('keydown', esc_);
    document.body.appendChild(box);
    d.fullPhotos = d.fullPhotos || {};
    const show = u => { if (!box.isConnected) return; const sp = box.querySelector('.spin'); if (sp) sp.remove(); let im = box.querySelector('img'); if (!im) { im = document.createElement('img'); box.appendChild(im); } im.src = u; };
    if (d.fullPhotos[i]) return show(d.fullPhotos[i]);
    api('photo', { id: d.id, i }).then(r => { d.fullPhotos[i] = r.data; show(r.data); }).catch(() => { const sp = box.querySelector('.spin'); if (sp) sp.remove(); });
  }

  function wireReport() {
    const d = cur;
    $$('[data-ph]').forEach(b => { b.onclick = () => viewPhoto(d, +b.dataset.ph); });
    loadMedia(d);
    $('#pdfBtn').onclick = async () => {
      const b = $('#pdfBtn'); busy(b, true, 'PDF');
      try {
        const r = await api('pdf', { id: d.id });
        const bytes = Uint8Array.from(atob(r.b64), ch => ch.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = document.createElement('a'); a.href = url; a.download = r.name || d.id + '.pdf'; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) { toast(e.message); }
      busy(b, false);
    };
    const mb = $('#mailBtn');
    if (mb) mb.onclick = () => paintMail();
    if ($('#sig')) sigPad($('#sig'), $('#sigClear'));
    const sb = $('#signBtn');
    if (sb) sb.onclick = async () => {
      if (!sigData) { toast(t('សូមចុះហត្ថលេខាជាមុនសិន', 'Please sign first')); return; }
      busy(sb, true, t('កំពុងបង្កើត PDF...', 'Making the PDF...'));
      try {
        const r = await api('sign', { id: d.id, signature: sigData, comment: $('#supComment').value, actions: readActs() });
        toast(t('បានចុះហត្ថលេខា', 'Signed') + (r.emailed ? ' · ✉️ ' + r.emailed : ''));
        await refresh(); openReport(d.id);
      } catch (e) { toast(e.message); busy(sb, false); }
    };
    const bb = $('#backBtn');
    if (bb) bb.onclick = async () => {
      const note = $('#supComment').value.trim();
      if (!note) { toast(t('សូមសរសេរអ្វីដែលត្រូវកែក្នុងប្រអប់មតិ', 'Write what needs to change in the comment box')); $('#supComment').focus(); return; }
      busy(bb, true);
      try { await api('sendBack', { id: d.id, note }); toast(t('បានបញ្ជូនត្រឡប់', 'Sent back')); await refresh(); openReport(d.id); }
      catch (e) { toast(e.message); busy(bb, false); }
    };
    const sa = $('#saveActs');
    if (sa) sa.onclick = async () => {
      busy(sa, true);
      try { cur = await api('actions', { id: d.id, actions: readActs() }); toast(t('បានរក្សាទុក', 'Saved')); paintReport(); refresh(); }
      catch (e) { toast(e.message); busy(sa, false); }
    };
    const cb = $('#closeBtn');
    if (cb) cb.onclick = async () => {
      const open = (d.actions || []).filter(a => a.status !== 'Done').length;
      if (open && !confirmBox(cb, t('នៅមានវិធានការ ' + open + ' មិនទាន់រួច។ បិទដដែល?', open + ' action(s) not done. Close anyway?'))) return;
      busy(cb, true);
      try { cur = await api('close', { id: d.id, force: true }); toast(t('បានបិទ', 'Closed')); paintReport(); refresh(); }
      catch (e) { toast(e.message); busy(cb, false); }
    };
  }
  function readActs() {
    const acts = (cur.actions || []).map((a, i) => { const s = document.querySelector(`[data-ai="${i}"]`); return Object.assign({}, a, { status: s ? s.value : a.status }); });
    const own = $('#naOwner') ? $('#naOwner').value.trim() : '', due = $('#naDue') ? $('#naDue').value : '';
    const rec = $('#naRec');
    if (rec && rec.value) acts.push({ what: rec.value, owner: own, due, status: 'Open' });
    const w = $('#naWhat');
    if (w && w.value.trim()) acts.push({ what: w.value.trim(), owner: $('#naOwner').value.trim(), due: $('#naDue').value, status: 'Open' });
    return acts;
  }

  function paintMail() {
    const lists = (B && B.lists) || [];
    const box = $('#mailBox');
    if (box.innerHTML) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="mailbox"><b>✉️ ${t('ផ្ញើតាមអ៊ីមែល', 'Send by email')}</b>
      ${lists.length ? `<div class="hint">${t('បញ្ជីអ៊ីមែល (កំណត់ដោយ Admin)', 'Email lists (set by the admin)')}</div>` + lists.map((l, i) => `<label class="check"><input type="checkbox" data-list="${i}" ${l.when !== 'button' ? 'checked' : ''}> <span><b>${esc(l.name)}</b> <small class="il">${l.count} ${t('នាក់', 'people')}</small></span></label>`).join('')
        : `<div class="hint">${t('Admin មិនទាន់បង្កើតបញ្ជីអ៊ីមែលទេ', 'The admin has not made any email lists yet')}</div>`}
      <div class="field mt"><label class="f" for="mailExtra">${t('អ៊ីមែលផ្សេងទៀត (បើមាន)', 'Other emails (optional)')}</label><input class="in" id="mailExtra" type="email" multiple placeholder="name@isisteel.com"></div>
      <div class="field"><label class="f" for="mailNote">${t('សារ (បើមាន)', 'Message (optional)')}</label><textarea class="in" id="mailNote" rows="2"></textarea></div>
      <div class="hint">${t('ភ្ជាប់ PDF ដែលបានចុះហត្ថលេខា', 'The signed PDF is attached')}</div>
      <button class="btn ok big mt" id="mailSend">📤 ${t('ផ្ញើ', 'Send')}</button></div>`;
    $('#mailSend').onclick = async () => {
      const chosen = $$('[data-list]').filter(x => x.checked).map(x => lists[+x.dataset.list].name);
      const b = $('#mailSend'); busy(b, true);
      try {
        const r = await api('email', { id: cur.id, lists: chosen, extra: $('#mailExtra').value, note: $('#mailNote').value });
        toast(t('បានផ្ញើទៅ ', 'Sent to ') + r.sent + t(' នាក់', ' people'));
        cur = await api('get', { id: cur.id }); paintReport();
      } catch (e) { toast(e.message); busy(b, false); }
    };
  }

  // ---------------------------------------------------------------- summary
  function renderSummary() {
    screen = renderSummary;
    const yr = getJ('ir_year', new Date().getFullYear());
    const all = reports();
    const years = Array.from(new Set(all.map(r => +String(r.date).slice(0, 4)).filter(Boolean).concat([new Date().getFullYear()]))).sort((a, b) => b - a);
    const rs = all.filter(r => +String(r.date).slice(0, 4) === yr);
    const cnt = fn => { const m = {}; rs.forEach(r => { const k = fn(r) || '–'; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    const bars = (rows, name, key) => { const max = Math.max(1, ...rows.map(r => r[1])); return rows.map(r => `<div class="bar-row" ${key ? `data-bk="${key}" data-bv="${esc(r[0])}" data-bl="${esc(name ? name(r[0]) : r[0])}" role="button" tabindex="0"` : ''}><span>${esc(name ? name(r[0]) : r[0])}</span><div><i style="width:${(r[1] / max) * 100}%"></i></div><b>${r[1]}</b></div>`).join('') || `<p class="hint">${t('គ្មានទិន្នន័យ', 'No data')}</p>`; };
    const months = new Array(12).fill(0);
    rs.forEach(r => { const m = +String(r.date).slice(5, 7); if (m) months[m - 1]++; });
    const mmax = Math.max(1, ...months);
    const MN = t('មករា កុម្ភៈ មីនា មេសា ឧសភា មិថុនា កក្កដា សីហា កញ្ញា តុលា វិច្ឆិកា ធ្នូ', 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec').split(' ');
    const injured = rs.reduce((s, r) => s + (+r.injured || 0), 0);
    $('#view').innerHTML = `<div class="head2"><h2>📊 ${t('សង្ខេប', 'Summary')}</h2><select class="in yearsel" id="yearSel">${years.map(y => `<option ${y === yr ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
      ${seesAll() ? '' : `<p class="hint">${t('បង្ហាញតែរបាយការណ៍ដែលអ្នកអាចមើលបាន', 'Shows only the reports you can see')}</p>`}
      <div class="stats">
        <button type="button" class="stat" data-sd="all"><small>${t('ហេតុការណ៍', 'Incidents')}</small><b>${rs.length}</b></button>
        <button type="button" class="stat" data-sd="injured"><small>${t('អ្នករបួស', 'Injured')}</small><b class="bad">${injured}</b></button>
        <button type="button" class="stat" data-sd="open"><small>${t('មិនទាន់បិទ', 'Open')}</small><b class="warn">${rs.filter(r => r.status !== 'Closed').length}</b></button>
      </div>
      <div class="card"><h2>${t('តាមខែ', 'By month')}</h2><div class="months">${months.map((n, i) => `<div><i style="height:${(n / mmax) * 100}%"></i><b>${n || ''}</b><small>${esc(MN[i])}</small></div>`).join('')}</div></div>
      <div class="card"><h2>${t('តាមប្រភេទ', 'By type')}</h2>${bars(cnt(r => typeOfEn(r.type)), k => typeName(k) || k, 'type')}</div>
      <div class="card"><h2>${t('តាមកម្រិតហានិភ័យ', 'By risk level')}</h2>${bars(cnt(r => level(r.score)), k => (k === '–' ? t('មិនទាន់វាយតម្លៃ', 'Not rated') : t(levelKm(k), k)), 'level')}</div>
      <div class="card"><h2>${t('តាមប្រភេទរង', 'By category')}</h2>${bars(cnt(r => r.category), catName, 'category')}</div>
      <div class="card"><h2>${t('តាមមូលហេតុ', 'By main cause')}</h2>${bars(cnt(r => r.cause), k => pick(CAUSES, k), 'cause')}</div>
      <div class="card"><h2>${t('តាមក្រុមហ៊ុន', 'By company')}</h2>${bars(cnt(r => r.company), k => pick(COMPANIES, k), 'company')}</div>
      <div class="card"><h2>${t('តាមឃ្លាំង', 'By warehouse')}</h2>${bars(cnt(r => r.warehouse), null, 'warehouse')}</div>
      <div class="card"><h2>${t('ឡានដែលកើតហេតុច្រើន', 'Trucks with most incidents')}</h2>${bars(cnt(r => r.plate).filter(r => r[0] !== '–').slice(0, 8), null, 'plate')}</div>`;
    $('#yearSel').onchange = e => { set('ir_year', e.target.value); renderSummary(); };
    const inYr = r => +String(r.date).slice(0, 4) === yr;
    const SD = { all: [t('ហេតុការណ៍', 'Incidents'), r => true], injured: [t('អ្នករបួស', 'Injured'), r => +r.injured > 0], open: [t('មិនទាន់បិទ', 'Open'), r => r.status !== 'Closed'] };
    $$('[data-sd]').forEach(b => { b.onclick = () => { const x = SD[b.dataset.sd]; openDrill(x[0] + ' · ' + yr, r => inYr(r) && x[1](r)); }; });
    const BK = { type: r => typeOfEn(r.type), level: r => level(r.score), category: r => r.category, cause: r => r.cause, company: r => r.company, warehouse: r => r.warehouse, plate: r => r.plate };
    $$('[data-bk]').forEach(b => { b.onclick = () => { const k = b.dataset.bk, v = b.dataset.bv; openDrill(b.dataset.bl + ' · ' + yr, r => inYr(r) && (BK[k](r) || '–') === v); }; });
  }

  // ---------------------------------------------------------------- settings (admins)
  let S = null;
  async function renderSettings() {
    screen = () => (S ? paintSettings() : renderSettings());
    if (!isAdmin()) { $('#view').innerHTML = `<div class="card empty">🔒 ${t('សម្រាប់ Admin ប៉ុណ្ណោះ', 'Admins only')}</div>`; return; }
    $('#view').innerHTML = loader('កំពុងផ្ទុកការកំណត់', 'Loading settings');
    try { S = await api('settings'); paintSettings(); } catch (e) { $('#view').innerHTML = `<div class="card"><div class="alert bad">${esc(e.message)}</div></div>`; }
  }
  let setTab = 'mail';
  function paintSettings() {
    const WHEN = [['button', 'ចុចផ្ញើប៉ុណ្ណោះ', 'Button only'], ['auto', 'ផ្ញើស្វ័យប្រវត្តិក្រោយចុះហត្ថលេខា', 'Auto after sign-off'], ['high', 'ស្វ័យប្រវត្តិ តែហានិភ័យខ្ពស់', 'Auto, HIGH risk only']];
    const tabs = [['mail', '✉️', 'បញ្ជីអ៊ីមែល', 'Email lists'], ['sup', '👷', 'ប្រធានឃ្លាំង', 'Supervisors'], ['cat', '🏷️', 'ប្រភេទរង', 'Categories'], ['more', '⚙️', 'ផ្សេងៗ', 'Other']];
    let body = '';
    if (setTab === 'mail') {
      body = `<p class="hint">${t('ពេលចុច "ផ្ញើតាមអ៊ីមែល" អ្នកប្រើជ្រើសបញ្ជីទាំងនេះ។ បញ្ជី "ស្វ័យប្រវត្តិ" ទទួល PDF ភ្លាមពេលប្រធានឃ្លាំងចុះហត្ថលេខា។', 'People tick these lists when they tap "Send by email". "Auto" lists get the PDF as soon as the supervisor signs.')}</p>
        ${S.lists.map((l, i) => `<div class="card setrow" data-i="${i}">
          <div class="row2"><input class="in" data-k="name" value="${esc(l.name)}" placeholder="${esc(t('ឈ្មោះបញ្ជី', 'List name'))}"><select class="in" data-k="when">${WHEN.map(w => `<option value="${w[0]}" ${l.when === w[0] ? 'selected' : ''}>${esc(t(w[1], w[2]))}</option>`).join('')}</select></div>
          <textarea class="in mt" data-k="emails" rows="3" placeholder="name@isisteel.com, ...">${esc((l.emails || []).join(', '))}</textarea>
          <div class="setfoot"><label class="check"><input type="checkbox" data-k="active" ${l.active !== false ? 'checked' : ''}> ${t('ប្រើ', 'Active')}</label><small>${(l.emails || []).length} ${t('អ៊ីមែល', 'emails')}</small><button class="btn sm ghost" data-del="${i}">✕ ${t('លុប', 'Delete')}</button></div></div>`).join('')}
        <button class="btn" id="addRow">＋ ${t('បញ្ជីអ៊ីមែលថ្មី', 'New email list')}</button>`;
    } else if (setTab === 'sup') {
      body = `<p class="hint">${t('ប្រធានឃ្លាំងចុះហត្ថលេខាទី២ ហើយមើលឃើញរបាយការណ៍របស់ឃ្លាំងខ្លួន។ ជំនួស = អ្នកចុះហត្ថលេខាពេលប្រធានមិននៅ។', 'The supervisor gives the second signature and sees their warehouse\'s reports. Backup = signs when they are away.')}</p>
        ${S.supervisors.map((s, i) => `<div class="card setrow" data-i="${i}">
          <div class="row2"><input class="in" data-k="warehouse" value="${esc(s.warehouse)}" placeholder="${esc(t('ឃ្លាំង / សាខា', 'Warehouse / branch'))}"><input class="in" data-k="name" value="${esc(s.name)}" placeholder="${esc(t('ឈ្មោះ', 'Name'))}"></div>
          <div class="row2 mt"><input class="in" data-k="email" type="email" value="${esc(s.email)}" placeholder="${esc(t('អ៊ីមែល', 'Email'))}"><input class="in" data-k="backup" type="email" value="${esc(s.backup)}" placeholder="${esc(t('អ៊ីមែលអ្នកជំនួស', 'Backup email'))}"></div>
          <div class="setfoot"><span></span><button class="btn sm ghost" data-del="${i}">✕ ${t('លុប', 'Delete')}</button></div></div>`).join('')}
        <button class="btn" id="addRow">＋ ${t('ប្រធានឃ្លាំងថ្មី', 'New supervisor')}</button>
        <p class="hint">${t('ពួកគេត្រូវមានធីក គ្រោះថ្នាក់ ក្នុង Users ផងដែរ។', 'They also need គ្រោះថ្នាក់ ticked in Users.')}</p>`;
    } else if (setTab === 'cat') {
      body = `${S.categories.map((c, i) => `<div class="card setrow" data-i="${i}">
          <div class="catrow"><input class="in icon-in" data-k="icon" value="${esc(catIcon(c))}" placeholder="🏷️" maxlength="8" aria-label="Icon"><input class="in" data-k="en" value="${esc(c.en)}" placeholder="English"><input class="in" data-k="km" value="${esc(c.km)}" placeholder="ខ្មែរ"></div>
          <div class="setfoot">${Object.keys(TYPES).map(k => `<label class="check"><input type="checkbox" data-type-k="${k}" ${String(c.types || 'road,wh,near').split(',').indexOf(k) >= 0 ? 'checked' : ''}> ${TYPES[k].ic}</label>`).join('')}
          <label class="check"><input type="checkbox" data-k="active" ${c.active !== false ? 'checked' : ''}> ${t('ប្រើ', 'Active')}</label><button class="btn sm ghost" data-del="${i}">✕</button></div></div>`).join('')}
        <button class="btn" id="addRow">＋ ${t('ប្រភេទរងថ្មី', 'New category')}</button>
        <p class="hint">🚚 ${t('លើផ្លូវ', 'road')} · 🏭 ${t('ក្នុងឃ្លាំង', 'warehouse')} · 👀 ${t('ជិតកើត', 'near miss')}: ${t('ប្រភេទណាអាចជ្រើសប្រភេទរងនេះ', 'which types offer this category')}</p>`;
    } else {
      const link = S.publicLink ? location.origin + location.pathname + '?k=' + S.publicLink : '';
      body = `<div class="card"><h2>📨 Telegram</h2>
          ${S.telegramBot ? '' : `<div class="alert warn">${t('មិនទាន់មាន TELEGRAM_BOT_TOKEN ក្នុង Script properties ទេ', 'TELEGRAM_BOT_TOKEN is not in Script properties yet')}</div>`}
          <div class="field mt"><label class="f" for="tgChat">Chat ID</label><input class="in" id="tgChat" value="${esc(S.telegramChat)}" placeholder="-100..."><div class="hint">${t('អាចប្រើ TELEGRAM_CHAT_ID ដូចកម្មវិធីចាក់សាំង', 'You can use the same TELEGRAM_CHAT_ID as the Fuel app')}</div></div>
          <button class="btn sm" id="tgTest">📨 ${t('ផ្ញើសាកល្បង', 'Send a test')}</button></div>
        <div class="card"><h2>🔢 ${t('លេខរបាយការណ៍', 'Report number')}</h2>
          <div class="field"><label class="f" for="prefix">${t('អក្សរនាំមុខ', 'Prefix')}</label><input class="in" id="prefix" value="${esc(S.prefix)}"><div class="hint">${esc(S.prefix || 'IR')}-${new Date().getFullYear()}-001</div></div></div>
        <div class="card"><h2>🚚 ${t('តំណសម្រាប់តៃកុង (មិនចាំបាច់ចូលគណនី)', 'Driver link (no sign-in)')}</h2>
          <label class="check"><input type="checkbox" id="pubOn" ${S.publicLink ? 'checked' : ''}> ${t('អនុញ្ញាតឲ្យតៃកុងរាយការណ៍តាម QR', 'Let drivers report through the QR')}</label>
          ${link ? `<div class="qrbox" id="qr"></div><div class="linkbox">${esc(link)}</div>
          <div class="row-btns"><button class="btn sm" id="copyLink">📋 ${t('ចម្លង', 'Copy')}</button><button class="btn sm ghost" id="newKey">🔄 ${t('តំណថ្មី (បិទ QR ចាស់)', 'New link (stops old QR)')}</button></div>` : ''}</div>
        <div class="card"><h2>🔗 ${t('ភ្ជាប់ជើងដឹក', 'Delivery trips')}</h2><p class="hint">${S.delivery ? '✅ ' + t('ជ្រើសផ្លាក → បំពេញ Trip ID, DN, អតិថិជន', 'Picking a plate fills the Trip ID, DN and customer') : t('បន្ថែម DELIVERY_SHEET_ID ក្នុង Script properties ដើម្បីភ្ជាប់', 'Add DELIVERY_SHEET_ID in Script properties to turn this on')}</p></div>`;
    }
    $('#view').innerHTML = `<div class="head2"><h2>⚙️ ${t('ការកំណត់', 'Settings')}</h2></div>
      <div class="chips">${tabs.map(x => `<button type="button" class="chip ${setTab === x[0] ? 'on' : ''}" data-st="${x[0]}">${x[1]} ${esc(t(x[2], x[3]))}</button>`).join('')}</div>
      ${body}<button class="btn ok big mt" id="saveSet">💾 ${t('រក្សាទុក', 'Save')}</button>`;
    $$('[data-st]').forEach(b => { b.onclick = () => { readSettings(); setTab = b.dataset.st; paintSettings(); }; });
    const key = { mail: 'lists', sup: 'supervisors', cat: 'categories' }[setTab];
    const blank = { mail: { name: '', emails: [], when: 'button', active: true }, sup: { warehouse: '', name: '', email: '', backup: '' }, cat: { icon: '', en: '', km: '', types: 'road,wh,near', active: true } }[setTab];
    const ar = $('#addRow'); if (ar) ar.onclick = () => { readSettings(); S[key].push(Object.assign({}, blank)); paintSettings(); };
    $$('[data-del]').forEach(b => { b.onclick = () => { readSettings(); S[key].splice(+b.dataset.del, 1); paintSettings(); }; });
    const qr = $('#qr');
    if (qr && window.qrcode) { const q = window.qrcode(0, 'M'); q.addData(location.origin + location.pathname + '?k=' + S.publicLink); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); }
    const cl = $('#copyLink');
    if (cl) cl.onclick = () => { const txt = $('.linkbox').textContent; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast(t('បានចម្លង', 'Copied')), () => toast(txt)); };
    const nk = $('#newKey');
    if (nk) nk.onclick = () => { if (confirmBox(nk, t('ចុចម្តងទៀតដើម្បីបញ្ជាក់', 'Tap again to confirm'))) save({ newPublicKey: true }); };
    const tt = $('#tgTest');
    if (tt) tt.onclick = async () => { readSettings(); busy(tt, true); try { await save({}, true); await api('testTelegram'); toast(t('បានផ្ញើទៅ Telegram', 'Sent to Telegram')); } catch (e) { toast(e.message); } busy(tt, false); };
    $('#saveSet').onclick = () => save({});
  }
  function readSettings() {
    const key = { mail: 'lists', sup: 'supervisors', cat: 'categories' }[setTab];
    if (key) $$('.setrow').forEach(row => {
      const o = S[key][+row.dataset.i]; if (!o) return;
      row.querySelectorAll('[data-k]').forEach(el => { o[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.dataset.k === 'emails' ? el.value.split(/[\s,;]+/).filter(Boolean) : el.value.trim(); });
      if (key === 'categories') o.types = Array.from(row.querySelectorAll('[data-type-k]')).filter(x => x.checked).map(x => x.dataset.typeK).join(',');
    });
    if ($('#tgChat')) S.telegramChat = $('#tgChat').value.trim();
    if ($('#prefix')) S.prefix = $('#prefix').value.trim();
    if ($('#pubOn')) S.publicOn = $('#pubOn').checked;
  }
  async function save(extra, quiet) {
    readSettings();
    const b = $('#saveSet'); busy(b, true);
    try {
      S = await api('saveSettings', Object.assign({ lists: S.lists, supervisors: S.supervisors, categories: S.categories, telegramChat: S.telegramChat, prefix: S.prefix,
        publicOn: S.publicOn !== undefined ? S.publicOn : !!S.publicLink }, extra));
      if (!quiet) toast(t('បានរក្សាទុក', 'Saved'));
      paintSettings(); refresh();
    } catch (e) { busy(b, false); if (quiet) throw e; toast(e.message); }
  }

  // ---------------------------------------------------------------- start
  function showBlocked(e) {
    $('#view').innerHTML = `<div class="card done"><div class="emoji">🔒</div><h2>${e.code === 'AUTH' ? t('សូមចូលគណនីនៅទំព័រដើម', 'Please sign in on the home menu') : t('មិនទាន់មានសិទ្ធិ', 'No access yet')}</h2>
      <p>${esc(e.message)}</p>${PUBLIC ? '' : `<a class="btn ok" href="../">${t('ទៅទំព័រដើម', 'Go to the home menu')}</a>`}</div>`;
  }
  if (DEMO) { $('#demo').hidden = false; $('#demo').textContent = t('DEMO · ឧទាហរណ៍ប៉ុណ្ណោះ មិនរក្សាទុកក្នុង Google Sheet ទេ', 'DEMO · sample only, nothing is saved to the Google Sheet'); }
  if (PUBLIC) { document.body.classList.add('public'); $('.tabs').hidden = true; }
  if (window.LANG) { LANG.button($('#langBtn')); LANG.onChange(() => { paintStatic(); screen(); }); }
  paintStatic();
  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const paintTheme = () => { const th = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); $('#themeBtn').textContent = th === 'dark' ? '☀️' : '🌙'; };
  $('#themeBtn').onclick = () => { const now = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); const next = now === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); set('fr_theme', next); paintTheme(); };
  paintTheme();
  window.ISTEEL_REFRESH = () => { if (sending || (f && $('#view .steps'))) { toast(t('កំពុងបំពេញទម្រង់', 'Form in progress')); return; } refresh(); };
  if (B) CATS = B.categories || [];
  if (!DEMO && !PUBLIC && !signedIn()) showBlocked({ code: 'AUTH', message: t('ការចូលគណនីត្រូវធ្វើនៅទំព័រដើម STEEL។', 'Sign in once on the STEEL home menu, then come back.') });
  else { if (B) paintTabs(); route(); refresh(); }
  // Screens auto-refresh when the phone comes back to the app (not while a form is open).
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !PUBLIC && !(f && $('#view .steps'))) refresh(); });

  // ---------------------------------------------------------------- demo (no API_URL in config.js)
  function demoApi(action, p) {
    const db = getJ('ir_demo_db', null) || demoSeed();
    const keep = () => set('ir_demo_db', JSON.stringify(db));
    const me = { email: 'kim@demo', name: 'Kim (demo)', phone: '012 345 678', admin: true, reviewer: true, supervisorOf: ['SSK Warehouse'] };
    const row = d => { const sc = d.severity * d.likelihood || 0; return { id: d.id, reported: d.created, status: d.status, type: (TYPES[d.type] || {}).en + ' (' + (TYPES[d.type] || { who: ['', ''] }).who[1] + ')', category: d.category, date: d.date, time: d.time, location: d.location, warehouse: d.warehouse, plate: d.plate, driver: d.driver, company: d.company, injured: String((d.people || []).filter(x => x.injured).length), score: sc, level: level(sc), cause: d.cause, cost: +d.cost || 0, open: (d.actions || []).filter(a => a.status !== 'Done').length, reporter: d.reporter.name, mine: d.reporter.email === me.email, toSign: d.status === 'Waiting supervisor' }; };
    const can = d => ({ edit: d.status === 'Returned' && d.reporter.email === me.email, sign: d.status === 'Waiting supervisor', actions: (d.status === 'Signed' || d.status === 'Waiting supervisor') && (me.admin || me.reviewer), close: d.status === 'Signed', email: d.status === 'Signed' || d.status === 'Closed' });
    const now = () => today() + ' ' + nowHm();
    const fail = (en, km) => { throw Object.assign(new Error(t(km, en)), { code: 'BAD' }); };
    return new Promise(r => setTimeout(r, action === 'boot' || action === 'get' || action === 'settings' ? 1200 : 200)).then(() => {
      const boot = () => ({ user: me, categories: db.categories, supervisors: db.supervisors.map(s => ({ warehouse: s.warehouse, name: s.name, email: s.email })),
        lists: db.lists.filter(l => l.active && l.emails.length).map(l => ({ name: l.name, count: l.emails.length, when: l.when })),
        plates: ['3A-2102', '3E-2588', '3F-8691', '3C-4471'], drivers: [{ name: 'ជា វុទ្ធី', plate: '3E-2588', company: 'ISI' }, { name: 'សុខ ដារា', plate: '3A-2102', company: 'ISI' }],
        reports: db.reports.slice().reverse().map(row) });
      if (action === 'boot' || action === 'publicBoot') return boot();
      if (action === 'list') return boot().reports;
      const find = id => db.reports.find(x => x.id === id) || fail('Report not found.', 'រកមិនឃើញរបាយការណ៍នេះទេ។');
      if (action === 'get') { const d = find(p.id); const o = Object.assign({}, d, { can: can(d), photos: d.photos || (d.photoThumbs || []).map((x, i) => 'demo' + i) }); delete o.photoThumbs; delete o.voiceData; return o; }
      if (action === 'media') { const d = find(p.id); return { photos: d.photoThumbs || [], voice: d.voiceData || '' }; }
      if (action === 'photo') { const d = find(p.id); return { data: (d.photoThumbs || [])[p.i] || '' }; }
      if (action === 'submit' || action === 'publicSubmit') {
        if (!p.anonymous && !p.signature) fail('Please sign before sending.', 'សូមចុះហត្ថលេខាមុនពេលផ្ញើ។');
        const old = p.id ? find(p.id) : null;
        const id = old ? old.id : 'IR-' + new Date().getFullYear() + '-' + String(db.reports.length + 1).padStart(3, '0');
        const sup = db.supervisors.find(s => s.email === p.supervisor) || db.supervisors[0];
        const d = Object.assign(old || { created: now(), history: [] }, p, { id, status: 'Waiting supervisor', returnNote: '', photoThumbs: (old && old.photoThumbs || []).concat(p.photos || []).slice(0, 6),
          reporter: { name: p.anonymous ? 'Anonymous' : p.reporterName, phone: p.reporterPhone, email: action === 'publicSubmit' ? '' : me.email, at: now(), anonymous: !!p.anonymous },
          supervisor: { name: sup.name, email: sup.email, at: '' } });
        d.voiceData = p.voice || (old && p.keepVoice ? old.voiceData : '') || ''; d.voice = d.voiceData ? 'demo' : '';
        ['photos', 'signature', 'reporterName', 'reporterPhone', 'keepPhotos', 'keepVoice', 'key'].forEach(k => delete d[k]);
        d.history.push({ at: now(), by: d.reporter.name, what: old ? 'Sent again' : 'Reported and signed' });
        if (!old) db.reports.push(d);
        keep(); return { id, status: d.status };
      }
      if (action === 'sign') { const d = find(p.id); d.status = 'Signed'; d.supervisor.at = now(); if (p.comment) d.supComment = p.comment; if (p.actions) d.actions = p.actions; d.history.push({ at: now(), by: me.name, what: 'Signed by Warehouse Supervisor' }); keep(); return { id: d.id, status: d.status, emailed: db.lists.filter(l => l.when === 'auto').reduce((s, l) => s + l.emails.length, 0) }; }
      if (action === 'sendBack') { const d = find(p.id); d.status = 'Returned'; d.returnNote = p.note; d.history.push({ at: now(), by: me.name, what: 'Sent back: ' + p.note }); keep(); return { id: d.id }; }
      if (action === 'actions') { const d = find(p.id); d.actions = (p.actions || []).map(a => Object.assign(a, { done: a.status === 'Done' ? a.done || today() : '' })); keep(); return Object.assign({}, d, { can: can(d) }); }
      if (action === 'close') { const d = find(p.id); d.status = 'Closed'; d.closedAt = now(); d.history.push({ at: now(), by: me.name, what: 'Case closed' }); keep(); return Object.assign({}, d, { can: can(d) }); }
      if (action === 'pdf') fail('The PDF is made once the app is connected to the real Google Sheet.', 'PDF បង្កើតបាន ពេលភ្ជាប់ជាមួយ Google Sheet ពិតប្រាកដ។');
      if (action === 'email') { const d = find(p.id); const n = db.lists.filter(l => (p.lists || []).indexOf(l.name) >= 0).reduce((s, l) => s + l.emails.length, 0) + String(p.extra || '').split(/[\s,;]+/).filter(Boolean).length; if (!n) fail('Tick a list or type an email.', 'សូមធីកបញ្ជី ឬវាយអ៊ីមែល។'); d.history.push({ at: now(), by: me.name, what: 'Emailed to ' + n + ' people' }); keep(); return { sent: n }; }
      if (action === 'trip') return p.plate === '3E-2588' ? { tripId: '26-10-25-004', driver: 'ជា វុទ្ធី', dn: '8100452231', customer: 'Heng Ly Construction' } : {};
      if (action === 'settings') return { lists: db.lists, supervisors: db.supervisors, categories: db.categories.map(c => Object.assign({ active: true }, c, { types: (c.types || []).join ? c.types.join(',') : c.types })), telegramChat: db.tg || '', telegramBot: false, prefix: 'IR', publicLink: db.pub === false ? '' : 'demo123', delivery: true };
      if (action === 'saveSettings') {
        if (p.lists) db.lists = p.lists; if (p.supervisors) db.supervisors = p.supervisors;
        if (p.categories) db.categories = p.categories.filter(c => c.active !== false).map(c => ({ en: c.en, km: c.km, icon: c.icon, types: String(c.types).split(',') }));
        if (p.telegramChat !== undefined) db.tg = p.telegramChat; if (p.publicOn !== undefined) db.pub = p.publicOn;
        keep(); return demoApi('settings', {});
      }
      if (action === 'testTelegram') fail('Telegram works once the app is connected to the real Google Sheet.', 'Telegram ដំណើរការ ពេលភ្ជាប់ជាមួយ Google Sheet ពិតប្រាកដ។');
      throw new Error('Unknown action');
    });
  }
  function demoSeed() {
    const cats = [['Collision with vehicle', 'បុកយានយន្តផ្សេង', 'road,wh'], ['Collision with object / building', 'បុកវត្ថុ ឬអគារ', 'road,wh,near'], ['Rollover', 'ក្រឡាប់ឡាន', 'road,wh'],
      ['Load fell / shifted', 'ទំនិញធ្លាក់ ឬរអិល', 'road,wh,near'], ['Goods damaged', 'ទំនិញខូចខាត', 'road,wh,near'], ['Injury to person', 'របួសមនុស្ស', 'road,wh,near'],
      ['Slip / trip / fall', 'រអិល ជំពប់ ដួល', 'wh,near'], ['Forklift / crane', 'ហ្វកលីហ្វ / ស្ទូច', 'wh,near'], ['Lifting / websling', 'ការលើក / Websling', 'wh,near'],
      ['Speeding / unsafe driving', 'បើកបរលឿន ឬគ្មានសុវត្ថិភាព', 'road,wh'], ['Fuel / oil spill', 'សាំង ឬប្រេងកំពប់', 'road,wh,near'], ['Fire', 'អគ្គិភ័យ', 'road,wh,near'],
      ['Theft / security', 'លួច / សន្តិសុខ', 'road,wh,near'], ['Other', 'ផ្សេងៗ', 'road,wh,near']].map(c => ({ en: c[0], km: c[1], types: c[2].split(',') }));
    const base = { shift: 'Day', gps: '', road: '', weather: '', driverId: '', tripId: '', dn: '', customer: '', load: '', couldHappen: '', firstAid: '', hospital: '', vehicleDamage: '', goodsDamage: '', property: '', police: '', policeNo: '', cost: '', daysLost: '', whys: [], immediate: '', witnesses: [], evidence: '', photoThumbs: [] };
    const y = new Date().getFullYear();
    return {
      categories: cats,
      supervisors: [{ warehouse: 'SSK Warehouse', name: 'Sok Pisey', email: 'kim@demo', backup: '' }, { warehouse: 'Kampong Thom', name: 'Chan Rithy', email: 'rithy@demo', backup: '' }],
      lists: [{ name: 'W&L Management', emails: ['manager.whl@isisteel.com', 'wh.ssk@isisteel.com', 'transport.lead@isisteel.com'], when: 'auto', active: true },
        { name: 'HSE team', emails: ['hse@isisteel.com', 'hse.officer@isisteel.com'], when: 'high', active: true },
        { name: 'Transport / 3PL', emails: ['3pl.a@demo.com', '3pl.b@demo.com', '3pl.c@demo.com', '3pl.d@demo.com'], when: 'button', active: true }],
      reports: [
        Object.assign({}, base, { id: 'IR-' + y + '-001', created: y + '-10-19 09:12', status: 'Closed', type: 'near', category: 'Forklift / crane', date: y + '-10-19', time: '08:40', location: 'Coil yard', warehouse: 'SSK Warehouse', plate: '', driver: '', company: 'ISI Steel', people: [{ name: 'សុខ ដារា', empId: '107710', company: 'ISI Steel', role: 'Forklift operator', injured: false, injury: '' }], story: 'Forklift reversed without a spotter; a worker walked behind it and stepped away just in time.', severity: 3, likelihood: 3, cause: 'Method / procedure', actions: [{ what: 'Spotter rule for reversing in the coil yard', owner: 'Sok Pisey', due: y + '-10-25', status: 'Done', done: y + '-10-23' }], reporter: { name: 'Anonymous', email: 'staff@demo', at: y + '-10-19 09:12', anonymous: true }, supervisor: { name: 'Sok Pisey', email: 'kim@demo', at: y + '-10-19 11:30' }, history: [{ at: y + '-10-19 09:12', by: 'Anonymous', what: 'Reported' }, { at: y + '-10-19 11:30', by: 'Sok Pisey', what: 'Signed by Warehouse Supervisor' }, { at: y + '-10-23 16:00', by: 'Sok Pisey', what: 'Case closed' }] }),
        Object.assign({}, base, { id: 'IR-' + y + '-002', created: y + '-10-21 15:02', status: 'Signed', type: 'wh', category: 'Load fell / shifted', date: y + '-10-21', time: '14:30', location: 'SSK WH Bay 4', warehouse: 'SSK Warehouse', plate: '3A-2102', driver: 'សុខ ដារា', company: 'ISI Steel', people: [], story: 'One coil rolled off the trailer while the websling was being removed. No one hurt; coil edge damaged.', goodsDamage: 'DN 8100451190, 1 coil 4.2 t', cost: '420', severity: 4, likelihood: 2, cause: 'Material / load', actions: [{ what: 'Use wedges before removing slings', owner: 'Loading team lead', due: y + '-10-28', status: 'Open', done: '' }], reporter: { name: 'សុខ ដារា', email: 'driver@demo', at: y + '-10-21 15:02' }, supervisor: { name: 'Sok Pisey', email: 'kim@demo', at: y + '-10-21 16:40' }, history: [{ at: y + '-10-21 15:02', by: 'សុខ ដារា', what: 'Reported and signed' }, { at: y + '-10-21 16:40', by: 'Sok Pisey', what: 'Signed by Warehouse Supervisor' }] }),
        Object.assign({}, base, { id: 'IR-' + y + '-003', created: y + '-10-24 14:48', status: 'Waiting supervisor', type: 'road', category: 'Collision with vehicle', date: y + '-10-24', time: '14:20', location: 'NR5 km 82, Kampong Chhnang', warehouse: 'SSK Warehouse', gps: '11.95210, 104.66320', road: 'Dry, Heavy traffic', weather: 'Daylight', plate: '3E-2588', driver: 'ជា វុទ្ធី', company: 'ISI Steel', tripId: '26-10-24-011', dn: '8100452231', customer: 'Heng Ly Construction', load: '18,400 kg rebar', people: [{ name: 'Motorbike rider', empId: '', company: 'Visitor / Contractor', role: 'Other', injured: true, injury: 'Small cut on the left arm' }], story: 'A motorbike cut in from the left. The driver braked; the rear of the truck touched the bike. The rider had a small cut and got first aid on site.', firstAid: 'Yes', vehicleDamage: 'Scratch on rear bumper', police: 'No', cost: '350', severity: 3, likelihood: 4, cause: 'People (behaviour, training)', whys: ['Driver was following too close in town traffic', 'Schedule pressure to reach the customer before 16:00', '', '', ''], immediate: 'First aid; photos taken; customer informed of 30 min delay.', actions: [{ what: 'Defensive driving refresher', owner: 'Transport Supervisor', due: y + '-11-08', status: 'Open', done: '' }], reporter: { name: 'ជា វុទ្ធី', email: 'kim@demo', at: y + '-10-24 14:48' }, supervisor: { name: 'Sok Pisey', email: 'kim@demo', at: '' }, history: [{ at: y + '-10-24 14:48', by: 'ជា វុទ្ធី', what: 'Reported and signed' }] }),
      ],
    };
  }
})();
