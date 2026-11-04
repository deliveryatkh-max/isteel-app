// Safety Walk & 5S (សុវត្ថិភាព): safety walks, 5S audits and forklift checks on the phone.
// The walker picks an area and a checklist, answers Yes / No / N/A; each No becomes an action with a photo, an owner and
// a due date. The owner marks it Done with an after photo, the walker (or a reviewer) closes it. Scores per area.
// Data: apps-script-safety/Safety.gs. A finished walk is kept on the phone and sent in the background, so the
// walker never waits and nothing is lost without signal (offline queue).
(function () {
  'use strict';

  const API = ((window.SW_CONFIG || {}).API_URL || '').trim();
  const DEMO = !API;
  const TOKEN_KEY = 'fr_id_token';            // shared with every app on this site: sign in once on the home menu
  const MAX_PHOTOS = 3;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const t = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const isEn = () => !!(window.LANG && LANG.get() === 'en');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const getJ = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  const nowHm = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const scCls = s => (s == null || s === '' ? 'n' : s >= 90 ? 'g' : s >= 75 ? 'o' : 'r');
  const scTag = s => `<span class="sc ${scCls(s)}">${s == null || s === '' ? '-' : s + '%'}</span>`;

  const loader = (km, en) => `<div class="loading" role="status"><div class="lcard"><span class="lic">⏳</span><div class="lbody"><div><small class="ldots">${esc(t(km || 'កំពុងផ្ទុក', en || 'Loading'))}</small></div>
    <div class="lbar"><i></i></div></div></div><div class="skel"></div><div class="skel"></div><div class="skel short"></div></div>`;
  let toastTimer = 0;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3200); }
  const busy = (b, on) => { if (!b) return; b.disabled = on; if (on) { b.dataset.t = b.innerHTML; b.innerHTML = '<span class="sp"></span>'; } else if (b.dataset.t) b.innerHTML = b.dataset.t; };

  // ---------------------------------------------------------------- words
  const SPOT = 'Spot check';                 // a manager's spot check: only the problems seen, picked from any checklist, no score
  const LIST_KM = { 'Safety walk': 'ដើរត្រួតពិនិត្យសុវត្ថិភាព', '5S audit': 'ត្រួតពិនិត្យ 5S', 'Forklift check': 'ត្រួតពិនិត្យហ្វកលីប', 'Spot check': 'ពិនិត្យភ្លាមៗ' };
  const LIST_IC = { 'Safety walk': '🦺', '5S audit': '🧹', 'Forklift check': '🚜', 'Spot check': '🔎' };
  const LIST_AB = { 'Safety walk': 'SW', '5S audit': '5S', 'Forklift check': 'FL' };
  const listName = n => t(LIST_KM[n] || n, n);
  const listIc = n => LIST_IC[n] || '📋';
  const ANS = { Yes: ['បាទ/ចាស', 'Yes'], No: ['ទេ', 'No'], 'N/A': ['មិនពាក់ព័ន្ធ', 'N/A'] };
  const STATUS = { Open: ['ត្រូវកែ', 'Open', 'open'], Done: ['កែរួច រង់ចាំបិទ', 'Done, to close', 'done'], Closed: ['បានបិទ', 'Closed', 'closed'] };
  const statusBadge = s => { const x = STATUS[s] || [s, s, 'open']; return `<span class="badge ${x[2]}">${esc(t(x[0], x[1]))}</span>`; };
  const FREQ = { Daily: ['រៀងរាល់ថ្ងៃ', 'Daily'], Weekly: ['រៀងរាល់សប្តាហ៍', 'Weekly'], Monthly: ['រៀងរាល់ខែ', 'Monthly'] };
  // Khmer on top, English under it, in both language modes (Kim, 4 Nov 2026)
  const qText = q => q.km || q.en || q.q || '';
  const qOther = q => { const en = q.en || q.q || ''; return en && en !== qText(q) ? en : ''; };
  // "What is wrong?" choices per question: from the Checklists tab (Problems column), else from defaults.json by the English text
  const normQ = s => String(s || '').trim().toLowerCase();
  const parseProblems = x => (Array.isArray(x) ? x : String(x || '').split(/\s*[;\n]\s*/).filter(Boolean).map(v => { const p = v.split(/\s+\/\s+/); return [p[0], p[1] || p[0]]; }))
    .filter(p => p && p[0]);
  const problemsText = x => parseProblems(x).map(p => (p[1] && p[1] !== p[0] ? p[0] + ' / ' + p[1] : p[0])).join('\n');
  let DEFP = null;                           // English question text -> problems, from defaults.json
  const DEFE = {};                           // English question text -> emoji shown before the question
  function loadDefaults() {
    if (demoDefaults) return Promise.resolve(demoDefaults);
    return fetch('defaults.json?v=20261104b').then(r => r.json()).then(d => {
      demoDefaults = d;
      DEFP = {};
      (d.questions || []).forEach(r => { if (r[6] && r[6].length) DEFP[normQ(r[2])] = r[6]; if (r[7]) DEFE[normQ(r[2])] = r[7]; });
      return d;
    });
  }
  const qEmoji = q => { const e = q.emoji || DEFE[normQ(q.en || q.q)]; return e ? `<span class="qem">${esc(e)}</span>` : ''; };
  const problemsFor = q => { const own = parseProblems(q.problems); return own.length ? own : ((DEFP && DEFP[normQ(q.en || q.q)]) || []); };

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
  let demoDefaults = null;                  // web/safety/defaults.json, read once in DEMO mode
  let B = getJ('sw_boot', null);             // boot data kept on the phone, so the app opens at once
  let screen = () => {};
  const isAdmin = () => !!(B && B.user && B.user.admin);
  const seesAll = () => !!(B && B.user && (B.user.admin || B.user.reviewer));
  const acts = () => (B && B.actions) || [];
  const walks = () => (B && B.walks) || [];
  const ownerOnly = () => !!(B && B.user && B.user.ownerOnly);
  const overdue = a => a.status === 'Open' && a.due && a.due < today();

  let lastBoot = '';
  async function refresh(quiet) {
    quiet = quiet === true;
    try {
      const d = await api('boot');
      const json = JSON.stringify(d);
      if (quiet && json === lastBoot) return;
      lastBoot = json;
      B = d;
      set('sw_boot', json);
      paintTabs();
      if (quiet && window.LIVE) LIVE.keep(screen); else screen();
    } catch (e) {
      if (e.code === 'AUTH' || e.code === 'NOACCESS') { set('sw_boot', null); B = null; showBlocked(e); return; }
      if (quiet) throw e;
      if (!B) { $('#view').innerHTML = `<div class="card"><div class="alert bad">${esc(e.message)}</div><button class="btn mt" id="retry">${t('ព្យាយាមម្តងទៀត', 'Try again')}</button></div>`; $('#retry').onclick = () => refresh(); }
      else toast(e.message);
    }
  }
  function paintStatic() { $$('[data-km]').forEach(el => { el.textContent = t(el.dataset.km, el.dataset.en); }); }
  function paintTabs() {
    const me = B && B.user ? B.user.email : '';
    const n = acts().filter(a => a.status === 'Open' && a.ownerEmail === me).length;
    const c = $('#actCount');
    if (c) { c.textContent = n > 99 ? '99+' : n; c.hidden = !n; }
    const st = $('.tab[data-r="set"]');
    if (st) st.hidden = !isAdmin();
    $('.tabs').classList.toggle('five', isAdmin());
  }

  // ---------------------------------------------------------------- router
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const top = h.split('/')[0] || 'home';
    $$('.tab[data-r]').forEach(a => a.classList.toggle('on', top === a.dataset.r || (top === 'a' && a.dataset.r === 'actions') || (['new', 'walk', 'done', 'w'].indexOf(top) >= 0 && a.dataset.r === 'home')));
    if (!B) { $('#view').innerHTML = loader('កំពុងផ្ទុក', 'Loading'); screen = route; return; }
    window.scrollTo(0, 0);
    if (h.startsWith('new')) return renderNew(h.slice(4));
    if (h === 'walk') return renderWalk();
    if (h === 'done') return renderDone();
    if (h.startsWith('w/')) return renderWalkView(decodeURIComponent(h.slice(2)));
    if (h.startsWith('a/')) return renderAction(decodeURIComponent(h.slice(2)));
    if (top === 'actions') return renderActions();
    if (top === 'scores') return renderScores();
    if (top === 'set') return renderSettings();
    return renderHome();
  }
  window.addEventListener('hashchange', route);
  const go = h => { if (location.hash === h) route(); else location.hash = h; };

  // ---------------------------------------------------------------- offline queue (finished walks waiting to be sent)
  const queue = () => getJ('sw_queue', []);
  const saveQueue = q => {
    if (set('sw_queue', JSON.stringify(q))) return true;
    // phone storage full (many photos): keep the answers, drop the oldest photos
    const lite = q.map(x => Object.assign({}, x, { payload: Object.assign({}, x.payload, { answers: x.payload.answers.map(a => Object.assign({}, a, { photos: (a.photos || []).slice(0, 1) })) }) }));
    return set('sw_queue', JSON.stringify(lite));
  };
  let flushing = false;
  async function flush() {
    if (flushing) return;
    let q = queue();
    if (!q.length) return;
    flushing = true;
    let sent = 0;
    try {
      for (const item of q.slice()) {
        if (item.error && !item.retry) continue;
        try {
          const r = await api('submit', item.payload);
          q = queue().filter(x => x.payload.clientId !== item.payload.clientId);
          saveQueue(q);
          const res = getJ('sw_sent', {}); res[item.payload.clientId] = r; set('sw_sent', JSON.stringify(res));
          sent++;
        } catch (e) {
          if (e.code === 'NET' || e.code === 'BUSY' || e.code === 'SERVER') break;   // try again later
          q = queue().map(x => (x.payload.clientId === item.payload.clientId ? Object.assign(x, { error: e.message, retry: false }) : x));
          saveQueue(q);
          if (e.code === 'AUTH') break;
        }
      }
    } finally { flushing = false; }
    if (sent) { refresh(true).catch(() => {}); if (/^#\/?(done)?$/.test(location.hash || '#/')) screen(); }
    else if (/^#\/?(done)?$/.test(location.hash || '#/')) screen();
  }
  window.addEventListener('online', () => flush());

  // ---------------------------------------------------------------- home
  function renderHome() {
    screen = renderHome;
    const me = B.user.email;
    const d = getJ('sw_draft', null);
    const q = queue();
    const mine = acts().filter(a => a.status === 'Open' && a.ownerEmail === me);
    const od = acts().filter(overdue);
    const weekAgo = addDays(today(), -7);
    const week = walks().filter(w => w.date > weekAgo);
    const lateAreas = (B.areas || []).filter(a => a.late.length || a.due.length);
    let h = '';
    if (q.length) {
      const bad = q.filter(x => x.error && !x.retry);
      h += `<div class="queue${bad.length ? ' bad' : ''}"><span>${bad.length ? '⚠️ ' + esc(bad[0].error) : '📤 ' + t(q.length + ' ការត្រួតពិនិត្យនៅលើទូរស័ព្ទ កំពុងរង់ចាំផ្ញើ', q.length + ' walk(s) on this phone, waiting to send')}</span>
        <button class="btn sm" id="qBtn">${bad.length ? t('ព្យាយាមម្តងទៀត', 'Retry') : t('ផ្ញើឥឡូវ', 'Send now')}</button></div>`;
    }
    if (ownerOnly()) h += `<div class="alert warn">${t('អ្នកឃើញតែសកម្មភាពដែលអ្នកត្រូវកែ។', 'You see only the actions you need to fix.')}</div>`;
    if (d && d.answers) {
      const qs = d.spot ? d.items || [] : (B.questions[d.list] || []);
      const n = Object.keys(d.answers).filter(k => d.answers[k].a).length;
      h += `<div class="card draft"><h2>📝 ${t('បន្តការត្រួតពិនិត្យ', 'Continue your walk')}</h2><p><b>${esc(d.area)}</b> · ${listIc(d.list)} ${esc(listName(d.list))}<br><small>${esc(d.site)} · ${d.spot ? qs.length + ' ' + t('បញ្ហា', 'problems') : n + '/' + qs.length + ' ' + t('សំណួរ', 'questions')}</small></p>
        <div class="row-btns"><a class="btn ok" href="#/walk">${t('បន្ត', 'Continue')}</a><button class="btn" id="dropDraft">${t('បោះបង់', 'Discard')}</button></div></div>`;
    } else if (!ownerOnly()) h += `<div class="start-row"><a class="btn big start-btn" href="#/new">🦺 ${t('ចាប់ផ្តើមត្រួតពិនិត្យ', 'Start a walk')}</a>
      <a class="btn big spot-btn" href="#/new/-/${encodeURIComponent(SPOT)}">🔎 ${t('ពិនិត្យភ្លាមៗ', 'Spot check')}</a></div>`;
    h += `<div class="stats"><a class="stat" href="#/actions/mine"><small>${t('ខ្ញុំត្រូវកែ', 'Mine to fix')}</small><b class="${mine.length ? 'warn' : 'ok'}">${mine.length}</b></a>
      <a class="stat" href="#/actions/late"><small>${t('ហួសកំណត់', 'Overdue')}</small><b class="${od.length ? 'bad' : 'ok'}">${od.length}</b></a>
      <a class="stat" href="#/scores"><small>${t('៧ ថ្ងៃចុងក្រោយ', 'Last 7 days')}</small><b>${week.length}</b></a></div>`;
    if (lateAreas.length && !ownerOnly()) {
      h += `<div class="card"><h2>⏰ ${t('តំបន់ត្រូវត្រួតពិនិត្យ', 'Areas due for a check')}</h2>${lateAreas.map(a => {
        const i = B.areas.indexOf(a);
        const chips = a.late.map(l => `<a class="lchip late" href="#/new/${i}/${encodeURIComponent(l)}">${listIc(l)} ${esc(listName(l))} · ${a.last[l] ? t('យឺត ' + daysBetween(a.last[l], today()) + ' ថ្ងៃ', daysBetween(a.last[l], today()) + ' days ago') : t('មិនទាន់ធ្វើ', 'never')}</a>`)
          .concat(a.due.map(l => `<a class="lchip due" href="#/new/${i}/${encodeURIComponent(l)}">${listIc(l)} ${esc(listName(l))} · ${t('ថ្ងៃនេះ', 'today')}</a>`)).join('');
        return `<div class="duerow"><div class="nm"><b>${esc(a.area)}</b><small>${esc(a.site)}${a.leader ? ' · ' + esc(a.leader) : ''}</small></div><div class="lchips">${chips}</div></div>`;
      }).join('')}</div>`;
    }
    const recent = walks().slice(0, 12);
    h += `<div class="head2"><h2>${t('ការត្រួតពិនិត្យថ្មីៗ', 'Recent walks')}</h2></div>`;
    h += recent.length ? `<div class="list">${recent.map(walkItem).join('')}</div>` : `<div class="empty">${t('មិនទាន់មានការត្រួតពិនិត្យ', 'No walks yet')}</div>`;
    $('#view').innerHTML = h;
    const qb = $('#qBtn');
    if (qb) qb.onclick = () => { saveQueue(queue().map(x => Object.assign(x, { retry: true }))); busy(qb, true); flush(); };
    const dd = $('#dropDraft');
    if (dd) dd.onclick = () => { if (confirmTwice(dd)) { set('sw_draft', null); renderHome(); } };
  }
  // a second tap within 3 s confirms (no browser dialogs)
  function confirmTwice(btn) {
    if (btn.dataset.sure) return true;
    btn.dataset.sure = '1'; const old = btn.innerHTML; btn.innerHTML = t('ចុចម្តងទៀត ដើម្បីបញ្ជាក់', 'Tap again to confirm');
    setTimeout(() => { delete btn.dataset.sure; btn.innerHTML = old; }, 3000);
    return false;
  }
  const spotTag = n => `<span class="sc spot">${n} ${t('បញ្ហា', n === 1 ? 'problem' : 'problems')}</span>`;
  const walkItem = w => `<a class="item" href="#/w/${encodeURIComponent(w.id)}"><div class="top"><span><b>${esc(w.area)}</b> · ${listIc(w.list)} ${esc(listName(w.list))}</span>${w.list === SPOT ? spotTag(w.no) : scTag(w.score)}</div>
    <div class="meta">${esc(w.date)} · ${esc(w.site)} · ${esc(w.walker)}${w.no ? ` · <b style="color:var(--bad)">${w.no} ${t('ទេ', 'No')}</b>` : ''}${w.crit ? ' · 🚨 ' + w.crit : ''}</div></a>`;

  // ---------------------------------------------------------------- new walk: site, area, checklist
  function renderNew(arg) {
    screen = () => {};
    const areas = B.areas || [];
    const [ai, al] = (arg || '').split('/');
    const pre = /^\d+$/.test(ai || '') ? areas[+ai] : null;
    const sites = Array.from(new Set(areas.map(a => a.site).filter(Boolean)));
    const f = { site: pre ? pre.site : getJ('sw_lastsite', '') || sites[0] || '', area: pre ? pre.area : '', list: al ? decodeURIComponent(al) : '', newArea: false };
    const paint = () => {
      const here = areas.filter(a => a.site === f.site);
      const listsHere = B.lists || [];
      $('#view').innerHTML = `<div class="card"><h2>🦺 ${t('ចាប់ផ្តើមត្រួតពិនិត្យ', 'Start a walk')}</h2>
        <label class="f">${t('ទីតាំង', 'Site')} <span class="req">*</span></label>
        <div class="chips" id="sites">${sites.map(s => `<button type="button" class="chip${s === f.site ? ' on' : ''}" data-s="${esc(s)}">${esc(s)}</button>`).join('')}
          <button type="button" class="chip" id="addSite">➕ ${t('ថ្មី', 'New')}</button></div>
        <div class="field mt"><label class="f">${t('តំបន់', 'Area')} <span class="req">*</span></label>
          ${f.newArea ? `<input class="in${f.area ? '' : ' err'}" id="areaIn" value="${esc(f.area)}" placeholder="${t('វាយឈ្មោះតំបន់ថ្មី', 'Type the new area name')}">`
          : `<select class="in${f.area ? '' : ' err'}" id="areaSel"><option value="">${t('ជ្រើសតំបន់', 'Pick the area')}</option>${here.map(a => `<option${a.area === f.area ? ' selected' : ''}>${esc(a.area)}</option>`).join('')}<option value="__new">➕ ${t('បន្ថែមតំបន់ថ្មី', 'Add a new area')}</option></select>`}</div>
        <label class="f mt">${t('បញ្ជីត្រួតពិនិត្យ', 'Checklist')} <span class="req">*</span></label>
        <div class="lists${f.list ? '' : ' err'}" id="lists">${listsHere.map(l => {
          const a = here.find(x => x.area === f.area);
          const fq = a && a.freq && a.freq[l.name];
          return `<button type="button" class="lcardx${l.name === f.list ? ' on' : ''}" data-l="${esc(l.name)}"><span class="ic">${listIc(l.name)}</span><span><b>${esc(listName(l.name))}</b><small>${l.n} ${t('សំណួរ', 'questions')}${fq ? ' · ' + esc(t((FREQ[fq] || [fq])[0], (FREQ[fq] || [fq, fq])[1])) : ''}${a && a.last && a.last[l.name] ? ' · ' + t('ចុងក្រោយ ', 'last ') + esc(a.last[l.name]) : ''}</small></span></button>`;
        }).join('')}<button type="button" class="lcardx spot${f.list === SPOT ? ' on' : ''}" data-l="${esc(SPOT)}"><span class="ic">🔎</span><span><b>${esc(listName(SPOT))}</b><small>${t('កត់តែបញ្ហាដែលឃើញ ជ្រើសពីបញ្ជីសំណួរ', 'Record only the problems you see, picked from the question lists')}</small></span></button></div>
        <button class="btn ok big mt" id="startBtn" style="width:100%">${t('ចាប់ផ្តើម', 'Start')} →</button></div>`;
      $$('#sites .chip[data-s]').forEach(b => { b.onclick = () => { f.site = b.dataset.s; f.area = ''; f.newArea = false; paint(); }; });
      $('#addSite').onclick = () => {
        const box = $('#sites');
        box.insertAdjacentHTML('afterend', `<input class="in mt" id="siteIn" placeholder="${t('ឈ្មោះទីតាំងថ្មី ឧ. KMH1', 'New site, e.g. KMH1')}">`);
        $('#addSite').remove();
        const si = $('#siteIn'); si.focus();
        si.onchange = () => { f.site = si.value.trim(); f.area = ''; f.newArea = true; paint(); };
      };
      const as = $('#areaSel');
      if (as) as.onchange = () => { if (as.value === '__new') { f.newArea = true; f.area = ''; } else f.area = as.value; paint(); };
      const ai2 = $('#areaIn');
      if (ai2) { ai2.oninput = () => { f.area = ai2.value.trim(); ai2.classList.toggle('err', !f.area); }; if (!f.area) ai2.focus(); }
      $$('#lists .lcardx').forEach(b => { b.onclick = () => { f.list = b.dataset.l; $$('#lists .lcardx').forEach(x => x.classList.toggle('on', x === b)); $('#lists').classList.remove('err'); }; });
      $('#startBtn').onclick = () => {
        if (!f.site || !f.area || !f.list) { toast(t('សូមជ្រើសទីតាំង តំបន់ និងបញ្ជី', 'Pick the site, area and checklist')); return; }
        set('sw_lastsite', JSON.stringify(f.site));
        const dr = { clientId: uid(), site: f.site, area: f.area, list: f.list, date: today(), started: nowHm(), answers: {}, note: '' };
        if (f.list === SPOT) Object.assign(dr, { spot: true, items: [] });
        set('sw_draft', JSON.stringify(dr));
        go('#/walk');
      };
    };
    paint();
  }

  // ---------------------------------------------------------------- the checklist
  let draft = null;
  const saveDraft = () => { if (!set('sw_draft', JSON.stringify(draft))) toast(t('ទូរស័ព្ទពេញ: រូបថតខ្លះមិនបានរក្សាទុក', 'Phone storage full: some photos were not kept')); };
  const people = () => (B && B.people) || [];
  const dueFor = q => addDays(today(), q.critical ? Math.max(1, Math.ceil(((B.settings || {}).criticalHours || 24) / 24)) : ((B.settings || {}).dueDays || 7));

  const curQs = () => (draft && draft.spot ? draft.items || [] : (B.questions[draft.list] || []));
  function renderWalk() {
    draft = getJ('sw_draft', null);
    if (!draft) return go('#/');
    screen = () => {};
    if (!DEFP) loadDefaults().then(() => { if (/^#\/?walk$/.test(location.hash)) renderWalk(); }).catch(() => {});
    if (draft.spot) return renderSpot();
    const qs = curQs();
    if (!qs.length) { $('#view').innerHTML = `<div class="card"><div class="alert bad">${t('បញ្ជីនេះគ្មានសំណួរ', 'This checklist has no questions')}</div><a class="btn mt" href="#/">←</a></div>`; return; }
    $('#view').innerHTML = `<div class="prog"><div class="row"><span><b>${esc(draft.area)}</b> · ${listIc(draft.list)} ${esc(listName(draft.list))}</span><span id="progN"></span></div><div class="pbar"><i id="progBar"></i></div></div>
      <button class="btn sm restyes" id="restYes">✅ ${t('ដាក់ "បាទ/ចាស" ឲ្យសំណួរដែលនៅសល់', 'Mark all the rest Yes')}</button>
      <div id="qs">${qs.map((q, i) => qCard(q, i)).join('')}</div>
      <div class="card"><label class="f">${t('កំណត់ចំណាំទូទៅ', 'General note')}</label><textarea class="in" id="wNote" rows="2" placeholder="${t('ជាជម្រើស', 'Optional')}">${esc(draft.note || '')}</textarea></div>
      <div class="finish"><button class="btn ok big" id="finBtn" style="width:100%">✔ ${t('បញ្ចប់ និងផ្ញើ', 'Finish and send')}</button></div>`;
    qs.forEach((q, i) => bindQ(q, i));
    $('#wNote').oninput = e => { draft.note = e.target.value; saveDraft(); };
    $('#restYes').onclick = () => { qs.forEach((q, i) => { if (!(draft.answers[q.no] || {}).a) { draft.answers[q.no] = { a: 'Yes' }; repaintQ(q, i); } }); saveDraft(); progress(); };
    $('#finBtn').onclick = finish;
    progress();
  }
  // ---------------------------------------------------------------- spot check: pick only the problems seen, from any checklist
  let spotList = '', spotFind = '';
  function renderSpot() {
    const items = draft.items = draft.items || [];
    $('#view').innerHTML = `<div class="prog"><div class="row"><span><b>${esc(draft.area)}</b> · 🔎 ${esc(listName(SPOT))}</span><span id="progN"></span></div></div>
      <div id="qs"></div>
      <div class="card pickcard"><h2>➕ ${items.length ? t('បន្ថែមបញ្ហាទៀត', 'Add another problem') : t('អ្នកឃើញបញ្ហាអ្វី?', 'What problem did you see?')}</h2>
        <p class="hint">${t('ជ្រើសពីបញ្ជីសំណួរ', 'Pick it from the question lists')}</p>
        <div class="chips" id="spLists"></div>
        <input class="in search-in mt6" id="spFind" type="search" value="${esc(spotFind)}" placeholder="🔍 ${t('ស្វែងរកសំណួរ', 'Search the questions')}">
        <div class="picklist" id="spPick"></div></div>
      <div class="card"><label class="f">${t('កំណត់ចំណាំទូទៅ', 'General note')}</label><textarea class="in" id="wNote" rows="2" placeholder="${t('ជាជម្រើស', 'Optional')}">${esc(draft.note || '')}</textarea></div>
      <div class="finish"><button class="btn ok big" id="finBtn" style="width:100%">✔ ${t('បញ្ចប់ និងផ្ញើ', 'Finish and send')}</button></div>`;
    paintSpotItems();
    paintPicker();
    const fi = $('#spFind');
    fi.oninput = () => { spotFind = fi.value; paintPicker(); };
    $('#wNote').oninput = e => { draft.note = e.target.value; saveDraft(); };
    $('#finBtn').onclick = finish;
  }
  function paintSpotItems() {
    const items = draft.items;
    $('#qs').innerHTML = items.map((q, i) => qCard(q, i)).join('');
    items.forEach((q, i) => {
      bindQ(q, i);
      const rm = $('#q' + i + ' [data-rm]');
      rm.onclick = () => {
        if (((draft.answers[q.no] || {}).photos || []).length && !confirmTwice(rm)) return;
        items.splice(i, 1); delete draft.answers[q.no]; saveDraft(); paintSpotItems(); paintPicker();
      };
    });
    progress();
  }
  const spotNo = (n, q) => (LIST_AB[n] || n.slice(0, 2).toUpperCase()) + q.no;
  function paintPicker() {
    const names = (B.lists || []).map(l => l.name).filter(n => (B.questions[n] || []).length);
    if (names.indexOf(spotList) < 0) spotList = names[0] || '';
    const s = normQ(spotFind);
    $('#spLists').innerHTML = names.map(n => `<button type="button" class="chip${!s && n === spotList ? ' on' : ''}" data-sp="${esc(n)}">${listIc(n)} ${esc(listName(n))}</button>`).join('');
    $$('#spLists [data-sp]').forEach(b => { b.onclick = () => { spotList = b.dataset.sp; spotFind = ''; $('#spFind').value = ''; paintPicker(); }; });
    const pool = [];
    names.forEach(n => (B.questions[n] || []).forEach(q => {
      if (s ? [q.en, q.km].concat(problemsFor(q).map(p => p.join(' '))).join(' ').toLowerCase().indexOf(s) >= 0 : n === spotList) pool.push({ n, q });
    }));
    const has = new Set(draft.items.map(x => x.no));
    $('#spPick').innerHTML = pool.length ? pool.slice(0, 40).map((x, k) => {
      const on = has.has(spotNo(x.n, x.q));
      return `<button type="button" class="pick${on ? ' on' : ''}" data-pk="${k}"><span class="pno">${s ? listIc(x.n) + ' ' : ''}${esc(x.q.no)}</span><span class="ptx"><b>${qEmoji(x.q)}${esc(qText(x.q))}</b>${qOther(x.q) ? `<small>${esc(qOther(x.q))}</small>` : ''}</span>${x.q.critical ? '<span class="crit">⚠</span>' : ''}<span class="padd">${on ? '✓' : '+'}</span></button>`;
    }).join('') : `<div class="empty">${t('រកមិនឃើញ', 'Nothing found')}</div>`;
    $$('#spPick [data-pk]').forEach(b => {
      b.onclick = () => {
        const x = pool[+b.dataset.pk];
        const no = spotNo(x.n, x.q);
        let i = draft.items.findIndex(it => it.no === no);
        if (i < 0) {
          const item = { no, en: x.q.en, km: x.q.km, critical: !!x.q.critical, photo: true, problems: problemsFor(x.q), src: x.n };
          draft.items.push(item);
          draft.answers[no] = { a: 'No', due: dueFor(item) };
          i = draft.items.length - 1;
          saveDraft(); paintSpotItems(); paintPicker();
          const h = $('.pickcard h2'); if (h) h.textContent = '➕ ' + t('បន្ថែមបញ្ហាទៀត', 'Add another problem');
        }
        $('#q' + i).scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
  }
  function progress() {
    const qs = curQs();
    if (draft.spot) { $('#progN').textContent = qs.length + ' ' + t('បញ្ហា', qs.length === 1 ? 'problem' : 'problems'); return; }
    const n = qs.filter(q => (draft.answers[q.no] || {}).a).length;
    $('#progN').textContent = n + ' / ' + qs.length;
    $('#progBar').style.width = (qs.length ? 100 * n / qs.length : 0) + '%';
  }
  function qCard(q, i) {
    const a = draft.answers[q.no] || {};
    const btn = (k, cls) => `<button type="button" class="${cls}${a.a === k ? ' on' : ''}" data-a="${k}">${esc(t(ANS[k][0], ANS[k][1]))}</button>`;
    return `<div class="card q" id="q${i}"><div class="qn"><b>${esc(q.no)}</b>${q.src ? `<span>${listIc(q.src)} ${esc(listName(q.src))}</span>` : ''}${q.critical ? `<span class="crit">⚠ ${t('ធ្ងន់ធ្ងរ', 'Critical')}</span>` : ''}${draft.spot ? `<button type="button" class="x-btn qdel" data-rm="${i}" aria-label="Remove">✕</button>` : ''}</div>
      <div class="qt">${qEmoji(q)}${esc(qText(q))}</div>${qOther(q) ? `<div class="qe">${esc(qOther(q))}</div>` : ''}
      ${draft.spot ? '' : `<div class="yn">${btn('Yes', 'y')}${btn('No', 'n')}${btn('N/A', 'x')}</div>`}
      ${a.a === 'No' ? noBox(q, a, i) : ''}</div>`;
  }
  function noBox(q, a, i) {
    const photos = a.photos || [];
    const needPhoto = q.photo !== false;
    return `<div class="nobox">
      <div><label class="f">📷 ${t('រូបថតបញ្ហា', 'Photo of the problem')} ${needPhoto ? '<span class="req">*</span>' : ''}</label>
        <div class="photos${needPhoto && !photos.length ? ' err' : ''}">${photos.map((p, k) => `<div class="ph"><img src="${p}" alt=""><button type="button" data-del="${k}" aria-label="Delete">×</button></div>`).join('')}
        ${photos.length < MAX_PHOTOS ? `<label class="add">📷<br>${t('ថតរូប', 'Take photo')}<input type="file" accept="image/*" capture="environment" data-photo="${i}"></label>` : ''}</div></div>
      <div>${wrongBox(q, a)}</div>
      <div class="two"><div class="search"><label class="f">👤 ${t('អ្នកកែ', 'Who fixes it')} <span class="req">*</span></label>
        <input class="in${a.owner && a.owner.n ? '' : ' err'}" data-k="owner" autocomplete="off" value="${esc(a.owner ? a.owner.n : '')}" placeholder="${t('ឈ្មោះ ឬ ID', 'Name or ID')}"><div class="sugg" hidden></div></div>
        <div><label class="f">📅 ${t('ថ្ងៃកំណត់', 'Due')} <span class="req">*</span></label><input class="in${a.due ? '' : ' err'}" type="date" data-k="due" value="${esc(a.due || '')}"></div></div></div>`;
  }
  /** "What is wrong?": the common problems of this question (Khmer · English), or Other to type. A picked problem can get extra words. */
  function wrongBox(q, a) {
    const probs = problemsFor(q);
    const lbl = `<label class="f">${t('បញ្ហាអ្វី?', 'What is wrong?')}</label>`;
    const typeIn = (v, ph) => `<input class="in" data-k="note" value="${esc(v)}" placeholder="${esc(ph)}">`;
    if (!probs.length) return lbl + typeIn(a.note || '', t('ឧ. ប៉ាឡែតនៅលើផ្លូវដើរ', 'e.g. pallets on the walkway'));
    if (a.pick == null && a.note) a.pick = 'o';      // a note typed before the list existed
    const opt = (v, txt) => `<option value="${v}"${String(a.pick) === String(v) ? ' selected' : ''}>${esc(txt)}</option>`;
    const sel = `<select class="in" data-k="pick"><option value="">${esc(t('ជ្រើសបញ្ហា', 'Pick the problem'))}</option>${probs.map((p, k) => opt(k, p[1] && p[1] !== p[0] ? p[1] + ' · ' + p[0] : p[0])).join('')}${opt('o', '✏️ ' + t('ផ្សេងទៀត (វាយ)', 'Other (type)'))}</select>`;
    if (a.pick === 'o') return lbl + sel + `<div class="mt6">${typeIn(a.note || '', t('វាយបញ្ហា', 'Type the problem'))}</div>`;
    if (a.pick !== '' && a.pick != null) return lbl + sel + `<div class="mt6"><input class="in" data-k="extra" value="${esc(a.extra || '')}" placeholder="${esc(t('ព័ត៌មានបន្ថែម ឧ. កន្លែង (ជាជម្រើស)', 'More detail, e.g. where (optional)'))}"></div>`;
    return lbl + sel;
  }
  const pickedNote = (q, a) => {
    const p = problemsFor(q)[+a.pick];
    if (!p) return a.note || '';
    const base = p[1] && p[1] !== p[0] ? p[1] + ' · ' + p[0] : p[0];
    return base + (a.extra ? ' - ' + a.extra : '');
  };
  function repaintQ(q, i) {
    const el = $('#q' + i);
    if (!el) return;
    el.outerHTML = qCard(q, i);
    bindQ(q, i);
  }
  function bindQ(q, i) {
    const el = $('#q' + i);
    el.querySelectorAll('.yn button').forEach(b => {
      b.onclick = () => {
        const a = draft.answers[q.no] = draft.answers[q.no] || {};
        a.a = a.a === b.dataset.a ? '' : b.dataset.a;
        if (a.a === 'No' && !a.due) a.due = dueFor(q);
        saveDraft(); repaintQ(q, i); progress();
        if (a.a && a.a !== 'No') { const next = $('#q' + (i + 1)); if (next && !(draft.answers[(curQs()[i + 1] || {}).no] || {}).a) next.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      };
    });
    const a = draft.answers[q.no];
    if (!a || a.a !== 'No') return;
    el.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => { a.photos.splice(+b.dataset.del, 1); saveDraft(); repaintQ(q, i); }; });
    const fi = el.querySelector('[data-photo]');
    if (fi) fi.onchange = async () => {
      const files = Array.from(fi.files || []).slice(0, MAX_PHOTOS - (a.photos || []).length);
      for (const file of files) { try { (a.photos = a.photos || []).push(await shrink(file)); } catch (e) { toast(t('មិនអាចអានរូបថត', 'Could not read the photo')); } }
      saveDraft(); repaintQ(q, i);
    };
    const nt = el.querySelector('[data-k="note"]');
    if (nt) nt.oninput = e => { a.note = e.target.value; saveDraft(); };
    const pk = el.querySelector('[data-k="pick"]');
    if (pk) pk.onchange = () => {
      a.pick = pk.value; a.extra = '';
      a.note = a.pick === 'o' || a.pick === '' ? '' : pickedNote(q, a);
      saveDraft(); repaintQ(q, i);
      const ni = $('#q' + i + ' [data-k="note"]'); if (ni) ni.focus();
    };
    const ex = el.querySelector('[data-k="extra"]');
    if (ex) ex.oninput = e => { a.extra = e.target.value; a.note = pickedNote(q, a); saveDraft(); };
    const du = el.querySelector('[data-k="due"]');
    du.onchange = () => { a.due = du.value; du.classList.toggle('err', !a.due); saveDraft(); };
    ownerPicker(el.querySelector('[data-k="owner"]'), o => { a.owner = o; saveDraft(); });
  }
  /** Name / Employee ID search over the user list; a name that is not in the list can be typed as it is (like Fuel's dropdowns). */
  function ownerPicker(inp, done) {
    const box = inp.parentNode.querySelector('.sugg');
    const pick = o => { inp.value = o.n; box.hidden = true; inp.classList.toggle('err', !o.n); done(o); };
    inp.oninput = () => {
      const s = inp.value.trim().toLowerCase();
      inp.classList.toggle('err', !s);
      done(s ? { n: inp.value.trim(), e: '', id: '' } : null);
      if (!s) { box.hidden = true; return; }
      const hits = people().filter(p => p.n.toLowerCase().indexOf(s) >= 0 || (p.id && p.id.indexOf(s) >= 0)).slice(0, 8);
      box.innerHTML = hits.map((p, k) => `<div class="opt" data-k="${k}"><b>${esc(p.id || '·')}</b><span>${esc(p.n)}</span></div>`).join('') +
        `<div class="opt" data-k="new"><b>➕</b><span>${t('ប្រើឈ្មោះនេះ', 'Use this name')}: ${esc(inp.value.trim())}</span></div>`;
      box.hidden = false;
      box.querySelectorAll('.opt').forEach(o => { o.onmousedown = e => { e.preventDefault(); pick(o.dataset.k === 'new' ? { n: inp.value.trim(), e: '', id: '' } : hits[+o.dataset.k]); }; });
    };
    inp.onblur = () => setTimeout(() => { box.hidden = true; }, 150);
  }
  /** Photo shrunk on the phone (1280 px, JPEG) with the date and time stamped in the corner. */
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, c.width, c.height);
        const stamp = today() + ' ' + nowHm();
        g.font = 'bold ' + Math.round(c.width / 28) + 'px sans-serif';
        const w = g.measureText(stamp).width, hh = Math.round(c.width / 22);
        g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, c.height - hh, w + hh * .6, hh);
        g.fillStyle = '#fff'; g.fillText(stamp, hh * .3, c.height - hh * .28);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('photo')); };
      img.src = url;
    });
  }
  function finish() {
    const qs = curQs();
    if (draft.spot && !qs.length) { toast(t('សូមបន្ថែមបញ្ហាយ៉ាងហោចណាស់មួយ', 'Add at least one problem')); return; }
    let first = -1;
    qs.forEach((q, i) => {
      const a = draft.answers[q.no] || {};
      const bad = !a.a || (a.a === 'No' && (!(a.owner && a.owner.n) || !a.due || (q.photo !== false && !(a.photos || []).length)));
      $('#q' + i).classList.toggle('miss', bad);
      if (bad && first < 0) first = i;
    });
    if (first >= 0) {
      $('#q' + first).scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(t('សូមបំពេញប្រអប់ក្រហម', 'Please fill the red boxes'));
      return;
    }
    const payload = { clientId: draft.clientId, site: draft.site, area: draft.area, list: draft.list, date: draft.date, started: draft.started, note: draft.note || '',
      answers: qs.map(q => { const a = draft.answers[q.no]; const o = { no: q.no, q: q.en, km: q.km, critical: q.critical, a: a.a };
        if (a.a === 'No' && a.pick != null && a.pick !== 'o' && a.pick !== '') a.note = pickedNote(q, a); if (a.a === 'No') Object.assign(o, { note: a.note || '', photos: a.photos || [], owner: a.owner, due: a.due }); return o; }) };
    const y = payload.answers.filter(a => a.a === 'Yes').length, n = payload.answers.filter(a => a.a === 'No').length;
    const summary = { clientId: draft.clientId, area: draft.area, site: draft.site, list: draft.list, yes: y, no: n, na: payload.answers.length - y - n,
      crit: payload.answers.filter(a => a.a === 'No' && a.critical).length, score: draft.spot ? null : y + n ? Math.round(100 * y / (y + n)) : null };
    const q = queue(); q.push({ payload, at: Date.now() });
    if (!saveQueue(q)) { toast(t('ទូរស័ព្ទពេញ សូមលុបរូបថតខ្លះ', 'Phone storage full, please remove some photos')); return; }
    set('sw_last', JSON.stringify(summary));
    set('sw_draft', null);
    go('#/done');
    flush();
  }

  // ---------------------------------------------------------------- after finishing
  function renderDone() {
    screen = renderDone;
    const s = getJ('sw_last', null);
    if (!s) return go('#/');
    const q = queue().find(x => x.payload.clientId === s.clientId);
    const sent = getJ('sw_sent', {})[s.clientId];
    const st = sent ? `<div class="alert ok sendst">✅ ${t('បានរក្សាទុក', 'Saved')} <b>${esc(sent.id)}</b>${sent.actions ? ' · ' + sent.actions + ' ' + t('សកម្មភាព', 'actions') : ''}${s.crit ? ' · 🚨 ' + t('បានផ្ញើទៅ Telegram', 'posted to Telegram') : ''}</div>`
      : q && q.error && !q.retry ? `<div class="alert bad sendst">⚠️ ${esc(q.error)}</div>`
      : `<div class="alert warn sendst">📤 ${navigator.onLine === false ? t('គ្មានអ៊ីនធឺណិត: រក្សាទុកលើទូរស័ព្ទ នឹងផ្ញើពេលមានសេវា', 'No signal: kept on the phone, it sends when you are back online') : t('កំពុងផ្ញើ…', 'Sending…')}</div>`;
    const spot = s.list === SPOT;
    $('#view').innerHTML = `<div class="card done"><div class="emoji">${s.crit ? '🚨' : spot ? '🔎' : s.no ? '🛠️' : '🎉'}</div>
      ${spot ? `<div class="big-score r">${s.no} ${t('បញ្ហា', s.no === 1 ? 'problem' : 'problems')}</div>` : `<div class="big-score ${scCls(s.score)}">${s.score == null ? '-' : s.score + '%'}</div>`}
      <p><b>${esc(s.area)}</b> · ${esc(listName(s.list))}${spot ? '' : `<br>✅ ${s.yes} · ❌ ${s.no} · ➖ ${s.na}`}</p>${st}
      <div class="row-btns">${sent ? `<button class="btn" id="pdfBtn">📄 PDF</button>` : ''}<a class="btn ok" href="#/new">🦺 ${t('ត្រួតពិនិត្យថ្មី', 'New walk')}</a><a class="btn" href="#/">${t('រួចរាល់', 'Done')}</a></div></div>`;
    const pb = $('#pdfBtn');
    if (pb) pb.onclick = () => openPdf(sent.id, pb);
  }
  async function openPdf(id, btn) {
    busy(btn, true);
    try {
      const r = await api('pdf', { id });
      const bin = atob(r.data), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url; a.download = r.name || id + '.pdf'; a.target = '_blank';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast(e.message); }
    busy(btn, false);
  }

  // ---------------------------------------------------------------- photos from the server (kept on the phone for the session)
  const photoMem = {};
  function loadPhotos(root) {
    (root || document).querySelectorAll('img[data-pid]').forEach(img => {
      const id = img.dataset.pid;
      if (photoMem[id]) { img.src = photoMem[id]; return; }
      (photoMem['p_' + id] = photoMem['p_' + id] || api('photo', { id }).then(r => { photoMem[id] = r.data; return r.data; }))
        .then(src => { document.querySelectorAll('img[data-pid="' + id + '"]').forEach(x => { x.src = src; }); }).catch(() => {});
    });
  }

  // ---------------------------------------------------------------- actions
  let actFilter = '';
  let actSearch = '';
  function renderActions() {
    screen = renderActions;
    const me = B.user.email;
    const sub = location.hash.split('/')[2];
    if (sub) { actFilter = sub; history.replaceState(null, '', '#/actions'); }
    const mine = acts().filter(a => a.ownerEmail === me && a.status !== 'Closed');
    if (!actFilter) actFilter = mine.length ? 'mine' : 'open';
    const F = { mine: [t('ខ្ញុំត្រូវកែ', 'Mine'), a => a.ownerEmail === me && a.status === 'Open'], open: [t('ត្រូវកែ', 'Open'), a => a.status === 'Open'],
      late: [t('ហួសកំណត់', 'Overdue'), overdue], done: [t('រង់ចាំបិទ', 'To close'), a => a.status === 'Done'], closed: [t('បានបិទ', 'Closed'), a => a.status === 'Closed'] };
    const f = F[actFilter] || F.open;
    const s = actSearch.toLowerCase();
    const list = acts().filter(f[1]).filter(a => !s || [a.area, a.site, a.question, a.owner, a.note, a.id].join(' ').toLowerCase().indexOf(s) >= 0)
      .sort((x, y) => (x.status === 'Open' && y.status === 'Open' ? (x.due < y.due ? -1 : 1) : 0));
    $('#view').innerHTML = `<div class="chips filter">${Object.keys(F).map(k => `<button class="chip${k === actFilter ? ' on' : ''}" data-f="${k}">${esc(F[k][0])} <b>${acts().filter(F[k][1]).length}</b></button>`).join('')}</div>
      <input class="in search-in" id="aSearch" type="search" data-live-ok value="${esc(actSearch)}" placeholder="🔍 ${t('ស្វែងរក តំបន់ បញ្ហា អ្នកកែ', 'Search area, problem, owner')}">
      ${list.length ? `<div class="list">${list.map(actItem).join('')}</div>` : `<div class="empty">${t('គ្មានសកម្មភាព', 'Nothing here')} 👍</div>`}`;
    $$('.chip[data-f]').forEach(b => { b.onclick = () => { actFilter = b.dataset.f; renderActions(); }; });
    const si = $('#aSearch');
    si.oninput = () => { actSearch = si.value; const p = si.selectionStart; renderActions(); const n = $('#aSearch'); n.focus(); n.setSelectionRange(p, p); };
    loadPhotos($('#view'));
  }
  const actItem = a => `<a class="item act" href="#/a/${encodeURIComponent(a.id)}"><div class="th">${a.photos[0] ? `<img data-pid="${esc(a.photos[0])}" alt="">` : '🛠️'}</div>
    <div><div class="top"><span>${a.critical ? '<span class="crit">⚠</span> ' : ''}<b>${esc(a.area)}</b></span>${statusBadge(a.status)}</div>
    <div class="tt">${esc(a.question)}</div>${a.note ? `<div class="meta">${esc(a.note)}</div>` : ''}
    <div class="meta">👤 ${esc(a.owner || '-')} · 📅 <span class="${overdue(a) ? 'late-t' : ''}">${esc(a.due)}${overdue(a) ? ' (' + t('ហួស ' + daysBetween(a.due, today()) + ' ថ្ងៃ', daysBetween(a.due, today()) + ' days late') + ')' : ''}</span></div></div></a>`;

  function renderAction(id) {
    const a = acts().find(x => x.id === id);
    screen = () => renderAction(id);
    if (!a) { $('#view').innerHTML = `<div class="card"><div class="alert bad">${t('រកមិនឃើញ', 'Not found')}</div><a class="btn mt" href="#/actions">←</a></div>`; return; }
    const c = a.can || {};
    $('#view').innerHTML = `<div class="card"><div class="top" style="display:flex;justify-content:space-between;gap:8px"><b>${esc(a.id)}</b>${statusBadge(a.status)}</div>
      <h2 style="margin-top:6px">${a.critical ? '<span class="crit">⚠ ' + t('ធ្ងន់ធ្ងរ', 'Critical') + '</span> ' : ''}${esc(a.question)}</h2>
      ${a.note ? `<p>${esc(a.note)}</p>` : ''}
      <div class="kv2"><span>${t('តំបន់', 'Area')}</span><b>${esc(a.site)} · ${esc(a.area)}</b><span>${t('បញ្ជី', 'Checklist')}</span><span style="color:var(--text)">${esc(listName(a.list))}${a.walk ? ` · <a href="#/w/${encodeURIComponent(a.walk)}">${esc(a.walk)}</a>` : ''}</span>
        <span>${t('អ្នកកែ', 'Owner')}</span><b>${esc(a.owner || '-')}</b><span>${t('ថ្ងៃកំណត់', 'Due')}</span><b class="${overdue(a) ? 'late-t' : ''}">${esc(a.due)}</b>
        <span>${t('រកឃើញដោយ', 'Found by')}</span><span style="color:var(--text)">${esc(a.raisedBy)} · ${esc(a.raised)}</span>
        ${a.doneAt ? `<span>${t('កែរួច', 'Done')}</span><span style="color:var(--text)">${esc(a.doneBy)} · ${esc(a.doneAt)}${a.doneNote ? '<br>' + esc(a.doneNote) : ''}</span>` : ''}
        ${a.closedAt ? `<span>${t('បិទ', 'Closed')}</span><span style="color:var(--text)">${esc(a.closedBy)} · ${esc(a.closedAt)}</span>` : ''}</div>
      <div class="pics">${a.photos.map(p => `<figure><img data-pid="${esc(p)}" alt=""><figcaption>${t('មុន', 'Before')}</figcaption></figure>`).join('')}${a.after.map(p => `<figure><img data-pid="${esc(p)}" alt=""><figcaption>${t('ក្រោយ', 'After')}</figcaption></figure>`).join('')}</div>
      <div id="doBox"></div>
      <div class="row-btns">${c.done ? `<button class="btn ok" id="doneBtn">✅ ${t('កែរួចហើយ', 'Mark done')}</button>` : ''}${c.close ? `<button class="btn ok" id="closeBtn">🔒 ${t('បិទ', 'Close')}</button>` : ''}
        ${c.reopen ? `<button class="btn" id="reopenBtn">↩️ ${t('បើកឡើងវិញ', 'Reopen')}</button>` : ''}${c.edit ? `<button class="btn" id="editBtn">✏️ ${t('ប្តូរអ្នកកែ / ថ្ងៃ', 'Change owner / due')}</button>` : ''}</div></div>
      <a class="btn" href="#/actions">← ${t('សកម្មភាព', 'Actions')}</a>`;
    loadPhotos($('#view'));
    const after = res => { B.actions = acts().map(x => (x.id === res.id ? res : x)); set('sw_boot', JSON.stringify(B)); paintTabs(); renderAction(id); };
    const db = $('#doneBtn');
    if (db) db.onclick = () => {
      const st = { photos: [] };
      const paint = () => {
        $('#doBox').innerHTML = `<div class="nobox" style="background:var(--ok-soft)"><label class="f">📷 ${t('រូបថតក្រោយកែ', 'Photo after the fix')} <span class="req">*</span></label>
          <div class="photos${st.photos.length ? '' : ' err'}">${st.photos.map((p, k) => `<div class="ph"><img src="${p}" alt=""><button type="button" data-del="${k}">×</button></div>`).join('')}
          ${st.photos.length < MAX_PHOTOS ? `<label class="add">📷<br>${t('ថតរូប', 'Take photo')}<input type="file" accept="image/*" capture="environment" id="afterIn"></label>` : ''}</div>
          <input class="in" id="doneNote" placeholder="${t('បានធ្វើអ្វី? (ជាជម្រើស)', 'What was done? (optional)')}" value="${esc(st.note || '')}">
          <button class="btn ok" id="sendDone">✅ ${t('រក្សាទុក', 'Save')}</button></div>`;
        $$('#doBox [data-del]').forEach(b => { b.onclick = () => { st.photos.splice(+b.dataset.del, 1); paint(); }; });
        const ai = $('#afterIn');
        if (ai) ai.onchange = async () => { for (const f of Array.from(ai.files || [])) { try { st.photos.push(await shrink(f)); } catch (e) { /* skip */ } } paint(); };
        $('#doneNote').oninput = e => { st.note = e.target.value; };
        $('#sendDone').onclick = async () => {
          if (!st.photos.length) { toast(t('សូមថតរូបក្រោយកែ', 'Take a photo after the fix')); return; }
          const b = $('#sendDone'); busy(b, true);
          try { after(await api('actionDone', { id, note: st.note || '', photos: st.photos })); toast(t('បានរក្សាទុក', 'Saved')); } catch (e) { busy(b, false); toast(e.message); }
        };
      };
      db.remove(); paint();
    };
    const cb = $('#closeBtn');
    if (cb) cb.onclick = async () => { busy(cb, true); try { after(await api('actionClose', { id })); toast(t('បានបិទ', 'Closed')); } catch (e) { busy(cb, false); toast(e.message); } };
    const rb = $('#reopenBtn');
    if (rb) rb.onclick = async () => { if (!confirmTwice(rb)) return; busy(rb, true); try { after(await api('actionReopen', { id })); } catch (e) { busy(rb, false); toast(e.message); } };
    const eb = $('#editBtn');
    if (eb) eb.onclick = () => {
      const st = { owner: { n: a.owner, e: a.ownerEmail, id: a.ownerId }, due: a.due };
      $('#doBox').innerHTML = `<div class="nobox" style="background:var(--soft)"><div class="two"><div class="search"><label class="f">👤 ${t('អ្នកកែ', 'Who fixes it')}</label><input class="in" id="eOwner" autocomplete="off" value="${esc(a.owner)}"><div class="sugg" hidden></div></div>
        <div><label class="f">📅 ${t('ថ្ងៃកំណត់', 'Due')}</label><input class="in" type="date" id="eDue" value="${esc(a.due)}"></div></div><button class="btn ok" id="eSave">${t('រក្សាទុក', 'Save')}</button></div>`;
      ownerPicker($('#eOwner'), o => { st.owner = o; });
      $('#eDue').onchange = e => { st.due = e.target.value; };
      $('#eSave').onclick = async () => { const b = $('#eSave'); busy(b, true); try { after(await api('actionEdit', { id, owner: st.owner, due: st.due })); toast(t('បានរក្សាទុក', 'Saved')); } catch (e) { busy(b, false); toast(e.message); } };
      eb.remove();
    };
  }

  // ---------------------------------------------------------------- one walk
  function renderWalkView(id) {
    screen = () => {};
    $('#view').innerHTML = loader();
    api('walk', { id }).then(w => {
      $('#view').innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(w.id)}</b>${w.list === SPOT ? spotTag(w.no) : scTag(w.score)}</div>
        <h2 style="margin-top:6px">${listIc(w.list)} ${esc(w.area)} · ${esc(listName(w.list))}</h2>
        <div class="kv2"><span>${t('ទីតាំង', 'Site')}</span><b>${esc(w.site)}</b><span>${t('ថ្ងៃ', 'Date')}</span><b>${esc(w.date)} ${esc(w.started || '')}</b><span>${t('អ្នកត្រួតពិនិត្យ', 'Done by')}</span><b>${esc(w.walker)}</b>
          <span>${t('ចម្លើយ', 'Answers')}</span><b>✅ ${w.yes} · ❌ ${w.no} · ➖ ${w.na}</b></div>${w.note ? `<p>${esc(w.note)}</p>` : ''}
        <div class="row-btns"><button class="btn" id="pdfBtn">📄 PDF</button></div></div>
        <div class="card"><h2>${t('ចម្លើយ', 'Answers')}</h2>${(w.answers || []).map(a => `<div class="ans"><span class="a ${a.a === 'N/A' ? 'NA' : a.a}">${esc(t(ANS[a.a] ? ANS[a.a][0] : a.a, a.a))}</span>
          <div>${a.c ? '<span class="crit">⚠</span> ' : ''}${esc(a.km || a.q)}${a.km && a.q && a.km !== a.q ? `<br><small class="qe2">${esc(a.q)}</small>` : ''}${a.note ? `<br><small>${esc(a.note)}</small>` : ''}${a.act ? ` <a href="#/a/${encodeURIComponent(a.act)}">→ ${esc(a.act)}</a>` : ''}</div></div>`).join('')}</div>
        ${(w.actionList || []).length ? `<div class="head2"><h2>${t('សកម្មភាព', 'Actions')}</h2></div><div class="list">${w.actionList.map(actItem).join('')}</div>` : ''}`;
      (w.actionList || []).forEach(a => { if (!acts().some(x => x.id === a.id)) B.actions.push(a); });
      $('#pdfBtn').onclick = () => openPdf(w.id, $('#pdfBtn'));
      loadPhotos($('#view'));
    }).catch(e => { $('#view').innerHTML = `<div class="card"><div class="alert bad">${esc(e.message)}</div><a class="btn mt" href="#/">←</a></div>`; });
  }

  // ---------------------------------------------------------------- scores
  let scDays = 30, scList = '';
  function renderScores() {
    screen = renderScores;
    const from = addDays(today(), -scDays);
    const inRange = walks().filter(w => w.date >= from);
    const ws = inRange.filter(w => w.list !== SPOT && (!scList || w.list === scList));
    const spotN = scList ? 0 : inRange.filter(w => w.list === SPOT).length;
    const y = ws.reduce((s, w) => s + w.yes, 0), n = ws.reduce((s, w) => s + w.no, 0);
    const avg = y + n ? Math.round(100 * y / (y + n)) : null;
    const by = {};
    ws.forEach(w => { const k = w.site + ' · ' + w.area; const o = by[k] = by[k] || { y: 0, n: 0, c: 0, area: w.area, site: w.site }; o.y += w.yes; o.n += w.no; o.c++; });
    const rows = Object.keys(by).map(k => Object.assign({ k, s: by[k].y + by[k].n ? Math.round(100 * by[k].y / (by[k].y + by[k].n)) : null }, by[k])).sort((a, b) => (a.s == null ? 101 : a.s) - (b.s == null ? 101 : b.s));
    // best performers: highest score, then more checks, then fewer open actions (Kim, 4 Nov 2026)
    rows.forEach(r => { r.open = acts().filter(a => a.status !== 'Closed' && a.site === r.site && a.area === r.area && (!scList || a.list === scList)).length; });
    const best = rows.filter(r => r.s != null).sort((a, b) => b.s - a.s || b.c - a.c || a.open - b.open).slice(0, 3);
    const actsIn = acts().filter(a => (a.raised || '').slice(0, 10) >= from && (!scList || a.list === scList));
    const fails = {};
    actsIn.forEach(a => { fails[a.question] = (fails[a.question] || 0) + 1; });
    const top = Object.keys(fails).sort((a, b) => fails[b] - fails[a]).slice(0, 6);
    const lateAreas = (B.areas || []).filter(a => a.late.some(l => !scList || l === scList));
    const openN = acts().filter(a => a.status !== 'Closed' && (!scList || a.list === scList)).length;
    const odN = acts().filter(a => overdue(a) && (!scList || a.list === scList)).length;
    $('#view').innerHTML = `<div class="chips filter">${[7, 30, 90].map(d => `<button class="chip${d === scDays ? ' on' : ''}" data-d="${d}">${d} ${t('ថ្ងៃ', 'days')}</button>`).join('')}</div>
      <div class="chips filter"><button class="chip${!scList ? ' on' : ''}" data-l="">${t('ទាំងអស់', 'All')}</button>${(B.lists || []).map(l => `<button class="chip${l.name === scList ? ' on' : ''}" data-l="${esc(l.name)}">${listIc(l.name)} ${esc(listName(l.name))}</button>`).join('')}</div>
      <div class="stats"><div class="stat"><small>${t('ពិន្ទុមធ្យម', 'Average score')}</small><b class="${avg == null ? '' : avg >= 90 ? 'ok' : avg >= 75 ? 'warn' : 'bad'}">${avg == null ? '-' : avg + '%'}</b></div>
        <div class="stat"><small>${t('បានត្រួតពិនិត្យ', 'Checks done')}</small><b>${ws.length}${spotN ? ` <small class="il">+ ${spotN} 🔎</small>` : ''}</b></div>
        <div class="stat"><small>${t('សកម្មភាពបើក / ហួស', 'Open / overdue')}</small><b>${openN} <span style="color:var(--bad)">/ ${odN}</span></b></div></div>
      ${best.length ? `<div class="card best"><h2>🏆 ${t('តំបន់ល្អបំផុត', 'Best areas')}</h2>${best.map((r, i) => `<div class="bestrow"><span class="medal">${['🥇', '🥈', '🥉'][i]}</span>
        <div class="nm"><b>${esc(r.area)}</b><small>${esc(r.site)} · ${r.c} ${t('ដង', r.c === 1 ? 'check' : 'checks')} · ${r.open ? r.open + ' ' + t('សកម្មភាពបើក', 'open actions') : '✅ ' + t('គ្មានសកម្មភាពបើក', 'no open actions')}</small></div>${scTag(r.s)}</div>`).join('')}</div>` : ''}
      <div class="card"><h2>📍 ${t('ពិន្ទុតាមតំបន់', 'Score by area')}</h2>${rows.length ? `<div class="bars">${rows.map(r => `<div class="brow"><span class="nm" title="${esc(r.k)}">${esc(r.area)} <small>${esc(r.site)} · ${r.c}</small></span>
        <span class="track"><i class="${scCls(r.s)}" style="width:${r.s || 0}%"></i></span><b>${r.s == null ? '-' : r.s + '%'}</b></div>`).join('')}</div>` : `<div class="empty">${t('មិនទាន់មានទិន្នន័យ', 'No data yet')}</div>`}</div>
      ${lateAreas.length ? `<div class="card"><h2>⏰ ${t('តំបន់យឺត', 'Late areas')}</h2>${lateAreas.map(a => `<div class="duerow"><div class="nm"><b>${esc(a.area)}</b><small>${esc(a.site)}</small></div><div class="lchips">${a.late.filter(l => !scList || l === scList).map(l => `<span class="lchip late">${esc(listName(l))} · ${a.last[l] ? esc(a.last[l]) : t('មិនទាន់ធ្វើ', 'never')}</span>`).join('')}</div></div>`).join('')}</div>` : ''}
      ${top.length ? `<div class="card"><h2>❌ ${t('បញ្ហាដែលរកឃើញញឹកញាប់', 'Most found problems')}</h2><div class="bars">${top.map(q => `<div class="brow"><span class="nm" title="${esc(q)}">${esc(q)}</span><span class="track"><i class="r" style="width:${Math.round(100 * fails[q] / fails[top[0]])}%"></i></span><b>${fails[q]}</b></div>`).join('')}</div></div>` : ''}`;
    $$('.chip[data-d]').forEach(b => { b.onclick = () => { scDays = +b.dataset.d; renderScores(); }; });
    $$('.chip[data-l]').forEach(b => { b.onclick = () => { scList = b.dataset.l; renderScores(); }; });
  }

  // ---------------------------------------------------------------- settings (admins)
  let S = null;
  function renderSettings() {
    screen = () => {};
    if (!isAdmin()) return go('#/');
    $('#view').innerHTML = loader();
    Promise.all([api('settings'), loadDefaults().catch(() => null)]).then(([s]) => { S = s; paintSettings(); }).catch(e => { $('#view').innerHTML = `<div class="card"><div class="alert bad">${esc(e.message)}</div></div>`; });
  }
  let setList = 'Safety walk';
  function paintSettings() {
    const freqSel = (v, k, i) => `<select class="in" data-i="${i}" data-k="${k}"><option value="">-</option>${Object.keys(FREQ).map(f => `<option value="${f}"${String(v).toLowerCase() === f.toLowerCase() ? ' selected' : ''}>${esc(t(FREQ[f][0], FREQ[f][1]))}</option>`).join('')}</select>`;
    const listNames = Array.from(new Set((B.lists || []).map(l => l.name).concat(S.questions.map(q => q.list))));
    // problems shown one per line; empty ones are filled from the starting list (saved with the next Save questions)
    S.questions.forEach(q => { if (typeof q.problems !== 'string' || !q.problems.trim()) q.problems = problemsText(problemsFor({ problems: q.problems, en: q.en })); });
    const qsHere = S.questions.map((q, i) => Object.assign({ i, problemsTxt: q.problems }, q)).filter(q => q.list === setList);
    $('#view').innerHTML = `<div class="card"><h2>📣 Telegram</h2>
        <p class="hint">${S.telegramBot ? '✅ ' + t('មាន Bot token', 'Bot token is set') : '⚠️ ' + t('បន្ថែម TELEGRAM_BOT_TOKEN ក្នុង Script properties', 'Add TELEGRAM_BOT_TOKEN in Script properties')}</p>
        <label class="f">${t('Chat ID របស់ក្រុម ISI Safety', 'Chat id of the ISI Safety group')}</label><input class="in" id="tgChat" value="${esc(S.telegramChat)}" placeholder="-100…">
        <label class="check mt"><input type="checkbox" id="daily"${S.daily ? ' checked' : ''}> ${t('បញ្ជីហួសកំណត់ រៀងរាល់ព្រឹក 08:00', 'Overdue list every morning 08:00')}</label>
        <label class="check"><input type="checkbox" id="weekly"${S.weekly ? ' checked' : ''}> ${t('សង្ខេបប្រចាំសប្តាហ៍ ថ្ងៃច័ន្ទ 08:00', 'Weekly summary Monday 08:00')}</label>
        <div class="two mt"><div><label class="f">${t('ថ្ងៃកែ (ធម្មតា)', 'Days to fix (normal)')}</label><input class="in" type="number" min="1" id="dueDays" value="${S.dueDays}"></div>
          <div><label class="f">${t('ម៉ោងកែ (ធ្ងន់ធ្ងរ)', 'Hours to fix (critical)')}</label><input class="in" type="number" min="1" id="critH" value="${S.criticalHours}"></div></div>
        <div class="row-btns"><button class="btn ok" id="saveTg">${t('រក្សាទុក', 'Save')}</button><button class="btn" id="testTg">${t('ផ្ញើសាកល្បង', 'Send a test')}</button></div></div>
      <div class="card"><h2>📍 ${t('តំបន់', 'Areas')} <small style="display:inline">(${S.areas.length})</small></h2>
        <p class="hint">${t('អ្នកដឹកនាំតំបន់: វាយឈ្មោះ ឬ Employee ID។ ពួកគេឃើញការត្រួតពិនិត្យ និងសកម្មភាពនៃតំបន់របស់ខ្លួន។', 'Area leader: type a name or Employee ID. They see the walks and actions of their area.')}</p>
        <div id="areaRows">${S.areas.map((a, i) => `<div class="setrow"><input class="in" data-i="${i}" data-k="site" value="${esc(a.site)}" placeholder="${t('ទីតាំង', 'Site')}"><input class="in${a.area ? '' : ' err'}" data-i="${i}" data-k="area" value="${esc(a.area)}" placeholder="${t('តំបន់', 'Area')}">
          <input class="in full" data-i="${i}" data-k="leader" value="${esc(a.leader)}" placeholder="${t('អ្នកដឹកនាំតំបន់', 'Area leader')}">
          <label class="f" style="margin:0">🦺 ${esc(listName('Safety walk'))}${freqSel(a.walk, 'walk', i)}</label><label class="f" style="margin:0">🧹 ${esc(listName('5S audit'))}${freqSel(a.s5, 's5', i)}</label>
          <label class="f" style="margin:0">🚜 ${esc(listName('Forklift check'))}${freqSel(a.forklift, 'forklift', i)}</label><div style="display:flex;align-items:end;justify-content:space-between"><label class="check"><input type="checkbox" data-i="${i}" data-k="active"${a.active ? ' checked' : ''}> ${t('ប្រើ', 'Active')}</label><button class="x-btn" data-delarea="${i}" title="Delete">🗑️</button></div></div>`).join('')}</div>
        <div class="row-btns"><button class="btn" id="addArea">➕ ${t('បន្ថែមតំបន់', 'Add area')}</button><button class="btn ok" id="saveAreas">${t('រក្សាទុកតំបន់', 'Save areas')}</button></div></div>
      <div class="card"><h2>📋 ${t('បញ្ជីសំណួរ', 'Checklists')}</h2>
        <div class="chips">${listNames.map(l => `<button class="chip${l === setList ? ' on' : ''}" data-sl="${esc(l)}">${listIc(l)} ${esc(listName(l))}</button>`).join('')}</div>
        <div id="qRows">${qsHere.map((q, k) => `<div class="qrow"><span class="no">${k + 1}</span><div style="display:grid;gap:6px"><input class="in" data-q="${q.i}" data-k="en" value="${esc(q.en)}" placeholder="English">
          <input class="in" data-q="${q.i}" data-k="km" value="${esc(q.km)}" placeholder="ខ្មែរ">
          <label class="f" style="margin:2px 0 0">${t('បញ្ហាញឹកញាប់ (មួយបន្ទាត់: English / ខ្មែរ)', 'Common problems (one per line: English / ខ្មែរ)')}</label>
          <textarea class="in probs" data-q="${q.i}" data-k="problems" rows="3" placeholder="Pallets on the walkway / ប៉ាឡែតនៅលើផ្លូវដើរ">${esc(q.problemsTxt)}</textarea></div>
          <div class="opts"><label class="check"><input type="checkbox" data-q="${q.i}" data-k="critical"${q.critical ? ' checked' : ''}> ⚠ ${t('ធ្ងន់ធ្ងរ', 'Critical')}</label>
            <label class="check"><input type="checkbox" data-q="${q.i}" data-k="photo"${q.photo ? ' checked' : ''}> 📷 ${t('ត្រូវរូប', 'Photo')}</label>
            <label class="check"><input type="checkbox" data-q="${q.i}" data-k="active"${q.active ? ' checked' : ''}> ${t('ប្រើ', 'Active')}</label>
            <button class="x-btn" data-delq="${q.i}" title="Delete">🗑️</button></div></div>`).join('')}</div>
        <div class="row-btns"><button class="btn" id="addQ">➕ ${t('បន្ថែមសំណួរ', 'Add question')}</button><button class="btn ok" id="saveQ">${t('រក្សាទុកសំណួរ', 'Save questions')}</button></div></div>`;
    const val = el => (el.type === 'checkbox' ? el.checked : el.value);
    $$('#areaRows [data-k]').forEach(el => { el.oninput = el.onchange = () => { S.areas[+el.dataset.i][el.dataset.k] = val(el); }; });
    $$('#qRows [data-k]').forEach(el => { el.oninput = el.onchange = () => { S.questions[+el.dataset.q][el.dataset.k] = val(el); }; });
    $$('[data-delarea]').forEach(b => { b.onclick = () => { S.areas.splice(+b.dataset.delarea, 1); paintSettings(); }; });
    $$('[data-delq]').forEach(b => { b.onclick = () => { S.questions.splice(+b.dataset.delq, 1); paintSettings(); }; });
    $$('[data-sl]').forEach(b => { b.onclick = () => { setList = b.dataset.sl; paintSettings(); }; });
    $('#addArea').onclick = () => { S.areas.push({ site: (S.areas[S.areas.length - 1] || {}).site || '', area: '', leader: '', walk: 'Weekly', s5: 'Monthly', forklift: '', active: true }); paintSettings(); };
    $('#addQ').onclick = () => { S.questions.push({ list: setList, en: '', km: '', critical: false, photo: true, active: true, problems: '' }); paintSettings(); };
    const save = async (b, payload) => { busy(b, true); try { S = await api('saveSettings', payload); toast(t('បានរក្សាទុក', 'Saved')); paintSettings(); refresh(true).catch(() => {}); } catch (e) { busy(b, false); toast(e.message); } };
    $('#saveTg').onclick = () => save($('#saveTg'), { telegramChat: $('#tgChat').value.trim(), daily: $('#daily').checked, weekly: $('#weekly').checked, dueDays: +$('#dueDays').value, criticalHours: +$('#critH').value });
    $('#saveAreas').onclick = () => { if (S.areas.some(a => !String(a.area).trim())) { toast(t('សូមបំពេញឈ្មោះតំបន់', 'Fill in every area name')); return; } save($('#saveAreas'), { areas: S.areas }); };
    $('#saveQ').onclick = () => save($('#saveQ'), { questions: S.questions });
    $('#testTg').onclick = async () => { const b = $('#testTg'); busy(b, true); try { await api('testTelegram'); toast('✅ Telegram'); } catch (e) { toast(e.message); } busy(b, false); };
  }

  // ---------------------------------------------------------------- start
  function showBlocked(e) {
    $('#view').innerHTML = `<div class="card done"><div class="emoji">🔒</div><h2>${e.code === 'AUTH' ? t('សូមចូលគណនីនៅទំព័រដើម', 'Please sign in on the home menu') : t('មិនទាន់មានសិទ្ធិ', 'No access yet')}</h2>
      <p>${esc(e.message)}</p><a class="btn ok" href="../">${t('ទៅទំព័រដើម', 'Go to the home menu')}</a></div>`;
  }
  if (DEMO) { $('#demo').hidden = false; $('#demo').textContent = t('DEMO · ឧទាហរណ៍ប៉ុណ្ណោះ មិនរក្សាទុកក្នុង Google Sheet ទេ', 'DEMO · sample only, nothing is saved to the Google Sheet'); }
  if (window.LANG) { LANG.button($('#langBtn')); LANG.onChange(() => { paintStatic(); if (/^#\/?walk$/.test(location.hash)) renderWalk(); else route(); }); }
  paintStatic();
  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const paintTheme = () => { const th = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); $('#themeBtn').textContent = th === 'dark' ? '☀️' : '🌙'; };
  $('#themeBtn').onclick = () => { const now = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); const next = now === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); set('fr_theme', next); paintTheme(); };
  paintTheme();
  const inForm = () => /^#\/?(walk|new|set)/.test(location.hash) || !!$('#doBox .nobox');
  window.ISTEEL_REFRESH = () => { if (inForm()) { toast(t('កំពុងបំពេញទម្រង់', 'Form in progress')); return; } refresh(); };
  if (!DEMO && !signedIn()) showBlocked({ code: 'AUTH', message: t('ការចូលគណនីត្រូវធ្វើនៅទំព័រដើម STEEL។', 'Sign in once on the STEEL home menu, then come back.') });
  else { if (B) paintTabs(); route(); refresh().then(flush); }
  loadDefaults().catch(() => {});
  if (window.LIVE && !DEMO) LIVE.start({ run: () => (inForm() ? Promise.resolve() : refresh(true)).then(flush), busy: inForm });

  // ---------------------------------------------------------------- demo (no API_URL in config.js)
  async function demoApi(action, p) {
    await loadDefaults();
    const db = getJ('sw_demo_db', null) || demoSeed(demoDefaults);
    const keep = () => { if (!set('sw_demo_db', JSON.stringify(db))) { db.photos = {}; set('sw_demo_db', JSON.stringify(db)); } };
    const me = { email: 'kim@demo', name: 'Kim (demo)', admin: true, reviewer: true };
    const fail = (en, km) => { throw Object.assign(new Error(t(km, en)), { code: 'BAD' }); };
    const now = () => today() + ' ' + nowHm();
    await new Promise(r => setTimeout(r, action === 'boot' ? 500 : 250));
    const qsOf = () => { const o = {}; db.questions.filter(q => q.active !== false).forEach(q => { (o[q.list] = o[q.list] || []).push({ no: String(q.no), en: q.en, km: q.km || q.en, critical: q.critical, photo: q.photo !== false, problems: parseProblems(q.problems) }); }); return o; };
    const view = a => Object.assign({}, a, { mine: a.ownerEmail === me.email, can: { done: a.status === 'Open', close: a.status === 'Done', reopen: a.status !== 'Open', edit: a.status !== 'Closed' } });
    if (action === 'boot') {
      const qs = qsOf(), td = today();
      const areas = db.areas.filter(a => a.active !== false).map(a => {
        const freq = {}; if (a.walk) freq['Safety walk'] = a.walk; if (a.s5) freq['5S audit'] = a.s5; if (a.forklift) freq['Forklift check'] = a.forklift;
        const o = { site: a.site, area: a.area, leader: a.leader, freq, last: {}, late: [], due: [] };
        Object.keys(freq).forEach(l => {
          const d = db.walks.filter(w => w.site === a.site && w.area === a.area && w.list === l).map(w => w.date).sort().pop() || '';
          o.last[l] = d; const days = { daily: 1, weekly: 7, monthly: 31 }[String(freq[l]).toLowerCase()];
          const gap = d ? daysBetween(d, td) : 9999; if (gap > days) o.late.push(l); else if (gap === days) o.due.push(l);
        });
        return o;
      });
      return { user: me, today: td, lists: ['Safety walk', '5S audit', 'Forklift check'].filter(n => qs[n]).map(n => ({ name: n, km: LIST_KM[n], icon: LIST_IC[n], n: qs[n].length })),
        questions: qs, areas, people: [{ n: 'Kim (demo)', e: 'kim@demo', id: '100001' }, { n: 'Sok Dara', e: 'dara@demo', id: '107710' }, { n: 'Chea Vuthy', e: 'vuthy@demo', id: '103661' }, { n: 'Heng Sokha', e: 'sokha@demo', id: '100826' }],
        walks: db.walks.slice().reverse().map(w => Object.assign({ mine: true }, w)), actions: db.actions.slice().reverse().map(view), settings: { dueDays: db.dueDays || 7, criticalHours: db.critH || 24 } };
    }
    if (action === 'submit') {
      if (db.walks.some(w => w.clientId === p.clientId)) return { id: db.walks.find(w => w.clientId === p.clientId).id, again: true };
      const id = 'SW-' + today().slice(2).replace(/-/g, '') + '-' + String(db.walks.filter(w => w.date === today()).length + 1).padStart(2, '0');
      let k = 0;
      const ans = p.answers.map(a => {
        let act = '';
        if (a.a === 'No') {
          k++; act = id + '-' + k;
          const ph = (a.photos || []).map((d, i) => { const pid = act + '-' + i; db.photos[pid] = d; return pid; });
          db.actions.push({ id: act, walk: id, raised: now(), site: p.site, area: p.area, list: p.list, q: a.no, question: a.q, critical: !!a.critical, note: a.note, photos: ph,
            owner: a.owner.n, ownerEmail: a.owner.e || '', ownerId: a.owner.id || '', due: a.due, status: 'Open', doneAt: '', doneBy: '', doneNote: '', after: [], closedAt: '', closedBy: '', raisedBy: me.name });
        }
        return { no: a.no, q: a.q, km: a.km, a: a.a, c: a.critical ? 1 : 0, note: a.note || '', act };
      });
      const y = ans.filter(a => a.a === 'Yes').length, n = ans.filter(a => a.a === 'No').length;
      const w = { id, clientId: p.clientId, date: p.date || today(), started: p.started, site: p.site, area: p.area, list: p.list, walker: me.name, yes: y, no: n, na: ans.length - y - n,
        score: p.list === SPOT ? null : y + n ? Math.round(100 * y / (y + n)) : null, crit: ans.filter(a => a.a === 'No' && a.c).length, actions: k, note: p.note, answers: ans };
      db.walks.push(w);
      if (!db.areas.some(a => a.site === p.site && a.area === p.area)) db.areas.push({ site: p.site, area: p.area, leader: '', walk: '', s5: '', forklift: '', active: true });
      keep();
      return { id, score: w.score, yes: y, no: n, na: w.na, actions: k, critical: w.crit };
    }
    if (action === 'walk') { const w = db.walks.find(x => x.id === p.id) || fail('Walk not found.', 'រកមិនឃើញ'); return Object.assign({}, w, { actionList: db.actions.filter(a => a.walk === w.id).map(view) }); }
    if (action === 'photo') return { data: db.photos[p.id] || 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#d4e1f5"/><text x="2" y="2" font-size="1.4" text-anchor="middle">📷</text></svg>') };
    const act = () => db.actions.find(x => x.id === p.id) || fail('Action not found.', 'រកមិនឃើញ');
    if (action === 'actionDone') { const a = act(); if (!(p.photos || []).length) fail('Take a photo after the fix.', 'សូមថតរូបក្រោយកែ'); a.after = p.photos.map((d, i) => { const pid = a.id + '-a' + i; db.photos[pid] = d; return pid; }); Object.assign(a, { status: 'Done', doneAt: now(), doneBy: me.name, doneNote: p.note }); keep(); return view(a); }
    if (action === 'actionClose') { const a = act(); Object.assign(a, { status: 'Closed', closedAt: now(), closedBy: me.name }); keep(); return view(a); }
    if (action === 'actionReopen') { const a = act(); Object.assign(a, { status: 'Open', closedAt: '', closedBy: '' }); keep(); return view(a); }
    if (action === 'actionEdit') { const a = act(); if (p.owner && p.owner.n) Object.assign(a, { owner: p.owner.n, ownerEmail: p.owner.e || '', ownerId: p.owner.id || '' }); if (p.due) a.due = p.due; keep(); return view(a); }
    if (action === 'pdf') fail('The PDF is made once the app is connected to the real Google Sheet.', 'PDF បង្កើតបាន ពេលភ្ជាប់ជាមួយ Google Sheet ពិតប្រាកដ។');
    if (action === 'settings') return { telegramChat: db.tg || '', telegramBot: false, dueDays: db.dueDays || 7, criticalHours: db.critH || 24, daily: db.daily !== false, weekly: db.weekly !== false, areas: db.areas, questions: db.questions };
    if (action === 'saveSettings') {
      if (p.telegramChat !== undefined) db.tg = p.telegramChat; if (p.dueDays) db.dueDays = p.dueDays; if (p.criticalHours) db.critH = p.criticalHours;
      if (p.daily !== undefined) db.daily = p.daily; if (p.weekly !== undefined) db.weekly = p.weekly;
      if (p.areas) db.areas = p.areas; if (p.questions) db.questions = p.questions;
      keep(); return demoApi('settings', {});
    }
    if (action === 'testTelegram') fail('Telegram works once the app is connected to the real Google Sheet.', 'Telegram ដំណើរការ ពេលភ្ជាប់ជាមួយ Google Sheet ពិតប្រាកដ។');
    throw new Error('Unknown action');
  }
  function demoSeed(def) {
    const q = def.questions.map(r => ({ list: r[0], no: r[1], en: r[2], km: r[3], critical: r[4], photo: r[5], active: true, problems: problemsText(r[6]) }));
    const areas = def.areas.map(a => ({ site: a[0], area: a[1], leader: a[2] || '', walk: a[3], s5: a[4], forklift: a[5], active: true }));
    const d = n => addDays(today(), -n);
    const walk = (id, date, area, site, list, nos, crit) => {
      const qs = q.filter(x => x.list === list);
      const answers = qs.map(x => ({ no: String(x.no), q: x.en, km: x.km, a: nos.indexOf(x.no) >= 0 ? 'No' : 'Yes', c: x.critical ? 1 : 0, note: '', act: '' }));
      let k = 0; answers.forEach(a => { if (a.a === 'No') a.act = id + '-' + (++k); });
      const y = answers.filter(a => a.a === 'Yes').length;
      return { id, clientId: id, date, started: '08:30', site, area, list, walker: 'Sok Dara', yes: y, no: nos.length, na: 0, score: Math.round(100 * y / answers.length), crit: crit || 0, actions: nos.length, note: '', answers };
    };
    const walks = [walk('SW-DEMO-01', d(20), 'Pipe yard A', 'KMH1', 'Safety walk', [2, 11]), walk('SW-DEMO-02', d(9), 'Coil shed', 'KMH1', 'Safety walk', [3], 1),
      walk('SW-DEMO-03', d(5), 'Building material store', 'KMH1', '5S audit', [1, 7, 11]), walk('SW-DEMO-04', d(1), 'Forklift fleet', 'KMH1', 'Forklift check', [])];
    const A = (id, walkId, daysAgo, area, list, qn, critical, note, owner, due, status) => {
      const qq = q.find(x => x.list === list && x.no === qn);
      return { id, walk: walkId, raised: d(daysAgo) + ' 09:10', site: 'KMH1', area, list, q: String(qn), question: qq.en, critical, note, photos: [], owner, ownerEmail: owner === 'Kim (demo)' ? 'kim@demo' : '', ownerId: '',
        due, status, doneAt: status !== 'Open' ? d(2) + ' 15:00' : '', doneBy: status !== 'Open' ? owner : '', doneNote: '', after: [], closedAt: status === 'Closed' ? d(1) + ' 10:00' : '', closedBy: status === 'Closed' ? 'Sok Dara' : '', raisedBy: 'Sok Dara' };
    };
    const actions = [A('SW-DEMO-01-1', 'SW-DEMO-01', 20, 'Pipe yard A', 'Safety walk', 2, false, 'Pallets on the walkway near bay 3', 'Heng Sokha', d(13), 'Closed'),
      A('SW-DEMO-01-2', 'SW-DEMO-01', 20, 'Pipe yard A', 'Safety walk', 11, false, 'Oil under forklift parking', 'Chea Vuthy', d(13), 'Done'),
      A('SW-DEMO-02-1', 'SW-DEMO-02', 9, 'Coil shed', 'Safety walk', 3, true, 'Pipe bundles stacked 5 high in row C', 'Kim (demo)', d(8), 'Open'),
      A('SW-DEMO-03-1', 'SW-DEMO-03', 5, 'Building material store', '5S audit', 1, false, 'Broken pallets behind rack 4', 'Kim (demo)', addDays(today(), 2), 'Open'),
      A('SW-DEMO-03-2', 'SW-DEMO-03', 5, 'Building material store', '5S audit', 7, false, 'Dust on floor at loading door', 'Heng Sokha', addDays(today(), 2), 'Open'),
      A('SW-DEMO-03-3', 'SW-DEMO-03', 5, 'Building material store', '5S audit', 11, false, 'Cleaning schedule not signed this month', 'Sok Dara', addDays(today(), 2), 'Open')];
    return { questions: q, areas, walks, actions, photos: {} };
  }
})();
