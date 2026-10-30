// 🖼️ Gallery and Gallery Manager (Kim, 30 Oct 2026).
// Everyone: #/ shows every ad meant for them, to watch again. Admins also get the manager: post an ad, choose the
// apps it shows in, who sees it and how often, Pause / Hide it, see its numbers and the settings for every app.
// The startup ad itself is shown by ../ads.js in each app. Data: the "Ads" and "Ad Log" tabs of the Fuel Refill
// sheet, through the Fuel Apps Script (Code.gs). Nothing is deleted here: Hide keeps an ad and its numbers.
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  // ?demo opens sample ads (nothing is read from or saved to the Sheet), so the screens can be tried safely.
  const DEMO = !CFG.API_URL || /[?&]demo\b/.test(location.search);
  const ADS = window.ISTEEL_ADS;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const t = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const wide = () => window.matchMedia('(min-width: 900px)').matches;
  const split = () => window.matchMedia('(min-width: 1180px)').matches;

  const APPS = [['fuel', 'ចាក់សាំង', 'Fuel Refill'], ['transport', 'ដឹកជញ្ជូន', 'Delivery'], ['overtime', 'ថែមម៉ោង', 'Overtime'],
    ['inbound', 'ទទួលទំនិញ', 'Inbound'], ['incident', 'គ្រោះថ្នាក់', 'Incident'], ['meeting', 'ប្រជុំ', 'Meetings'], ['home', 'ទំព័រដើម', 'Home menu']];
  const appName = k => { const a = APPS.find(x => x[0] === k); return a ? t(a[1], a[2]) : k; };
  const appIcon = (k, size) => `<img src="../icons/${esc(k)}.svg" alt="" width="${size}" height="${size}" title="${esc(appName(k))}">`;
  const ROLE_NAMES = { user: ['អ្នកប្រើ', 'User'], driver: ['តៃកុង', 'Driver'], security: ['សន្តិសុខ', 'Security'], warehouse: ['ឃ្លាំង', 'Warehouse'],
    logistics: ['ភស្តុភារ', 'Logistics'], reviewer: ['អ្នកពិនិត្យ', 'Reviewer'], supervisor: ['ប្រធាន', 'Supervisor'], admin: ['Admin', 'Admin'] };
  const roleName = r => ROLE_NAMES[r] ? t(ROLE_NAMES[r][0], ROLE_NAMES[r][1]) : r;
  const FREQ = [['open', 'រាល់ពេលបើក', 'Every open'], ['day', 'ម្តង/ថ្ងៃ', 'Once a day'], ['week', 'ម្តង/សប្តាហ៍', 'Once a week']];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON_KM = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
  const p2 = n => String(n).padStart(2, '0');
  const dayShow = ms => { if (!ms) return ''; const d = new Date(ms); return `${p2(d.getDate())}-${MON[d.getMonth()]}-${d.getFullYear()}`; };
  const dayStr = ms => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const dayNice = ms => { const d = new Date(ms); return t(`ថ្ងៃ ${d.getDate()} ${MON_KM[d.getMonth()]}`, `${d.getDate()} ${MON[d.getMonth()]}`); };
  const num = n => Number(n || 0).toLocaleString('en-US');

  // ------------------------------------------------------------------ data
  let D = null;          // admin: { version, settings, ads, depts, roles }
  let E = null;          // the ad being edited: { id, f, tried }
  let S = null;          // stats { days, data }
  const F = { q: '', chip: 'all', app: '' };
  const TOKEN_KEY = 'fr_id_token';
  const claims = () => { try { return JSON.parse(decodeURIComponent(escape(atob((get(TOKEN_KEY) || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; } };
  const signedIn = () => { const c = claims(); return !!(c && c.exp * 1000 > Date.now() + 60000); };
  const email = () => (claims() || {}).email || 'demo';
  const bootKey = () => 'ga_boot_' + email();
  const adminKey = () => 'ga_admin_' + email();
  // Admins are known from the home menu (Role) or from an earlier visit to the manager.
  const isAdmin = () => DEMO || get(adminKey()) === '1' || (() => { try { const h = JSON.parse(get('home_c_' + email()) || 'null'); return !!(h && h.user && h.user.role === 'admin'); } catch (e) { return false; } })();

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
      if (/Unknown action/i.test(data.error)) throw Object.assign(new Error(t('សូមបិទភ្ជាប់ Code.gs ថ្មី រួច Deploy (New version)។', 'Please paste the new Code.gs and deploy a New version.')), { code: 'OLD' });
      const m = msgText(data.error);
      throw Object.assign(new Error(m.text), { code: m.code });
    }
    if (data.session) set(TOKEN_KEY, data.session);
    return data.data;
  }

  // Status of an ad, in the order the admin cares about.
  function status(a, now) {
    now = now || Date.now();
    if (a.hidden) return 'hidden';
    if (!a.show) return 'paused';
    if (a.start && a.start > now) return 'scheduled';
    if (a.end && a.end < now) return 'ended';
    return 'live';
  }
  const STATUS = { live: ['កំពុងផ្សាយ', 'Live', '🟢'], paused: ['ផ្អាក', 'Paused', '⏸'], scheduled: ['រង់ចាំ', 'Scheduled', '🗓'],
    ended: ['ផុតកំណត់', 'Ended', '⌛'], hidden: ['លាក់', 'Hidden', '🙈'] };
  const pill = a => {
    const s = status(a);
    return `<span class="gpill ${s}">${s === 'scheduled' ? `${esc(dayNice(a.start))} →` : t(STATUS[s][0], STATUS[s][1])}</span>`;
  };
  const audienceText = a => {
    const m = /^(dept|role):(.*)$/.exec(a.audience || 'all');
    if (!m) return t('ទាំងអស់', 'Everyone');
    const list = m[2].split('|').filter(Boolean);
    return (m[1] === 'role' ? list.map(roleName) : list).join(', ');
  };
  const adText = a => (window.LANG && LANG.get() === 'en' && a.textEn) ? a.textEn : a.text;
  const thumb = (a, cls) => `<span class="gthumb ${cls || ''}" style="${a.thumb ? `background-image:url('${a.thumb}')` : ''}">${a.thumb ? '' : (a.type === 'video' ? '🎬' : '🖼️')}${a.type === 'video' ? '<i class="gplay">▶</i>' : ''}</span>`;

  // ------------------------------------------------------------------ chrome
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { el.hidden = true; }, 2600); }
  function paintStatic() { $$('[data-km]').forEach(el => { el.textContent = t(el.dataset.km, el.dataset.en); }); }
  function paintTabs(r) {
    const adm = isAdmin();
    $$('.tab.adm').forEach(a => { a.hidden = !adm; });
    $$('.tab[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === r));
  }
  const view = html => { $('#view').innerHTML = html; };
  function blocked(e) {
    const auth = e.code === 'AUTH' || (!DEMO && !signedIn());
    view(`<div class="card done"><div class="emoji">${auth ? '👋' : e.code === 'OLD' ? '🛠️' : '🔒'}</div>
      <h2>${auth ? t('សូមចូលគណនីនៅទំព័រដើម', 'Please sign in on the home menu') : e.code === 'OLD' ? t('ត្រូវធ្វើបច្ចុប្បន្នភាព Apps Script', 'Apps Script needs an update') : t('សម្រាប់តែ Admin', 'Admins only')}</h2>
      <p>${esc(auth ? '' : e.message)}</p><a class="btn ok" href="${auth ? '../' : '#/'}">${auth ? t('ទៅទំព័រដើម', 'Go to the home menu') : t('ទៅវិចិត្រសាល', 'Go to the Gallery')}</a></div>`);
  }

  // ------------------------------------------------------------------ router
  const route = () => decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  function screen() {
    const h = route();
    if (h === '' || h === 'gal') { paintTabs('gal'); return renderGallery(); }
    if (!isAdmin() && D === null && !DEMO) { paintTabs(''); }
    if (!D) { paintTabs(h.split('/')[0] === 'e' || h === 'new' ? 'manage' : h); view('<div class="spinner"></div>'); return loadAdmin(); }
    if (h === 'stats') { paintTabs('stats'); return renderStats(); }
    if (h === 'set') { paintTabs('set'); return renderSettings(); }
    paintTabs('manage');
    if (h === 'new') return renderEdit(null);
    if (h.indexOf('e/') === 0) return renderEdit(h.slice(2));
    return renderList();
  }
  const go = h => { if (location.hash === h) screen(); else location.hash = h; };

  // ------------------------------------------------------------------ Gallery (everyone)
  function galleryList() {
    const now = Date.now();
    const src = DEMO ? (demoApi.s ? demoApi.s.ads : demoSeed().ads) : ADS.list();
    return src.filter(a => !a.hidden && (!a.start || a.start <= now));
  }
  function renderGallery() {
    const list = galleryList(), now = Date.now();
    const synced = DEMO || renderGallery.done;
    view(`<div class="um-head"><h1>🖼️ ${t('វិចិត្រសាល', 'Gallery')}</h1>
        ${isAdmin() ? `<a class="btn ok add" href="#/new">＋ ${t('បង្ហោះថ្មី', 'Post new')}</a>` : ''}</div>
      <p class="hint top">${t('ការផ្សាយទាំងអស់ សម្រាប់អ្នក · ចុចដើម្បីមើលម្តងទៀត', 'Every announcement for you · tap one to watch it again')}</p>
      ${list.length ? `<div class="ggal">${list.map(a => {
        const live = a.show && !a.hidden && ADS.inDates(a, now);
        return `<button type="button" class="ggi" data-v="${esc(a.id)}">${thumb(a, 'big')}
          ${live ? `<span class="gpill live">${t('កំពុងបង្ហាញ', 'Showing')}</span>` : ''}
          <span class="ggt">${adText(a) ? `<b>${esc(adText(a))}</b>` : ''}<small>${dayShow(a.createdAt)}</small></span></button>`;
      }).join('')}</div>`
        : synced ? `<div class="card empty"><div class="emoji">🖼️</div>${t('មិនទាន់មានរូបភាព ឬ វីដេអូ', 'No images or videos yet')}</div>` : '<div class="spinner"></div>'}`);
    $$('[data-v]').forEach(b => b.onclick = () => { const a = galleryList().find(x => x.id === b.dataset.v); if (a) viewAd(a); });
    if (!DEMO && !renderGallery.busy) {
      renderGallery.busy = true;
      ADS.sync(true).finally(() => { renderGallery.busy = false; renderGallery.done = true; if (route() === '' || route() === 'gal') LIVE ? LIVE.keep(renderGallery) : renderGallery(); });
    }
  }

  async function adBlob(a) {
    if (DEMO) return a.demoUrl ? (await fetch(a.demoUrl)).blob() : null;
    return ADS.blob(a, true);
  }
  /** Full screen view of one ad (downloads it the first time). */
  async function viewAd(a) {
    const lb = document.createElement('div');
    lb.className = 'ad-view';
    lb.innerHTML = `<button type="button" class="ad-close" aria-label="${t('បិទ', 'Close')}">✕</button>
      <div class="ad-media"><div class="ad-spin"></div></div>${adText(a) ? `<div class="ad-text">${esc(adText(a))}</div>` : ''}<div class="ad-sub">${dayShow(a.createdAt)}</div>`;
    document.body.appendChild(lb);
    document.body.classList.add('ad-open');
    let url = '';
    const close = () => { lb.remove(); document.body.classList.remove('ad-open'); if (url) URL.revokeObjectURL(url); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    $('.ad-close', lb).onclick = close;
    $('.ad-close', lb).focus();
    try {
      const b = await adBlob(a);
      if (!lb.isConnected) return;
      if (!b) { $('.ad-media', lb).innerHTML = `<div class="ad-sub">${t('មិនអាចបង្ហាញបាន', 'Not available')}</div>`; return; }
      url = URL.createObjectURL(b);
      $('.ad-media', lb).innerHTML = a.type === 'video' ? `<video src="${url}" controls autoplay playsinline></video>` : `<img src="${url}" alt="">`;
    } catch (e) { if (lb.isConnected) $('.ad-media', lb).innerHTML = `<div class="ad-sub">${esc(e.message)}</div>`; }
  }

  // ------------------------------------------------------------------ Manager: list
  const counts = list => {
    const c = { all: list.length, live: 0, paused: 0, scheduled: 0, ended: 0, hidden: 0 };
    list.forEach(a => { c[status(a)]++; });
    return c;
  };
  function filtered() {
    const q = F.q.trim().toLowerCase();
    return D.ads.filter(a => (F.chip === 'all' ? true : status(a) === F.chip)
      && (!F.app || (a.apps || ['fuel']).indexOf(F.app) >= 0)
      && (!q || [a.text, a.textEn, a.name, a.createdBy].join(' ').toLowerCase().indexOf(q) >= 0));
  }
  function listHtml(selId) {
    const all = D.ads.filter(a => !F.app || (a.apps || ['fuel']).indexOf(F.app) >= 0), c = counts(all), list = filtered();
    const chips = [['all', t('ទាំងអស់', 'All'), ''], ['live', t('ផ្សាយ', 'Live'), '🟢 '], ['paused', t('ផ្អាក', 'Paused'), '⏸ '],
      ['scheduled', t('រង់ចាំ', 'Scheduled'), '🗓 '], ['ended', t('ផុតកំណត់', 'Ended'), '⌛ '], ['hidden', t('លាក់', 'Hidden'), '🙈 ']]
      .filter(x => x[0] === 'all' || c[x[0]] || F.chip === x[0]);
    const row = a => `
      <div class="grow${a.id === selId ? ' pick' : ''}">
        <a class="gmain" href="#/e/${encodeURIComponent(a.id)}">${thumb(a)}
          <span class="gtx">${pill(a)}<b>${esc(adText(a) || a.name || a.id)}</b>
            <span class="gapps">${(a.apps || ['fuel']).map(k => appIcon(k, 22)).join('')}</span>
            <small>👥 ${esc(audienceText(a))} · 👁 ${num(a.views)} · ⏭ ${num(a.skips)}</small></span></a>
        <button type="button" class="sw${a.show && !a.hidden ? ' on' : ''}" data-sw="${esc(a.id)}" role="switch" aria-checked="${a.show && !a.hidden}" ${a.hidden ? 'disabled' : ''}
          aria-label="${t('ផ្សាយ / ផ្អាក', 'Live / Paused')}" title="${a.hidden ? t('លាក់ · បើកវិញនៅក្នុងការកែ', 'Hidden · unhide it in Edit') : t('ផ្សាយ / ផ្អាក', 'Live / Paused')}"></button>
      </div>`;
    const card = a => `
      <a class="gcard${a.id === selId ? ' pick' : ''}" href="#/e/${encodeURIComponent(a.id)}">${thumb(a, 'big')}${pill(a)}
        <span class="gtx"><b>${esc(adText(a) || a.name || a.id)}</b>
          <span class="gapps">${(a.apps || ['fuel']).map(k => appIcon(k, 20)).join('')}</span>
          <small><span>👥 ${esc(audienceText(a))}</span><span>👁 ${num(a.views)} · ⏭ ${num(a.skips)}</span></small></span></a>`;
    return `
      <div class="um-head"><h1>🖼️ ${t('គ្រប់គ្រងវិចិត្រសាល', 'Gallery Manager')}</h1><a class="btn ok add" href="#/new">＋ ${t('បង្ហោះថ្មី', 'Post new')}</a></div>
      <div class="stats">
        <button type="button" data-c="live"><b>${c.live}</b><small>${t('កំពុងផ្សាយ', 'Live now')}</small></button>
        <button type="button" data-c="paused"><b>${c.paused}</b><small>${t('ផ្អាក', 'Paused')}</small></button>
        <button type="button" data-c="scheduled"><b>${c.scheduled}</b><small>${t('រង់ចាំថ្ងៃចាប់ផ្តើម', 'Waiting to start')}</small></button>
      </div>
      <div class="filters">
        <div class="frow"><input class="in q" id="q" type="search" data-live-ok placeholder="🔍 ${t('ស្វែងរក អក្សរក្រហម…', 'Search the red text…')}" value="${esc(F.q)}">
          <select class="in dsel${F.app ? ' on' : ''}" id="fApp" data-live-ok><option value="">📱 ${t('គ្រប់កម្មវិធី', 'Every app')}</option>
            ${APPS.map(a => `<option value="${a[0]}"${F.app === a[0] ? ' selected' : ''}>${esc(t(a[1], a[2]))}</option>`).join('')}</select></div>
        <div class="chips">${chips.map(x => `<button type="button" class="chip${F.chip === x[0] ? ' on' : ''}" data-chip="${x[0]}">${x[2]}${x[1]} <small>${c[x[0]]}</small></button>`).join('')}</div>
      </div>
      ${list.length ? (wide() ? `<div class="ggrid">${list.map(card).join('')}</div>` : `<div class="card glist">${list.map(row).join('')}</div>`)
        : `<div class="card empty"><div class="emoji">🖼️</div>${D.ads.length ? t('រកមិនឃើញ', 'Nothing found') : t('មិនទាន់មានការផ្សាយ · ចុច បង្ហោះថ្មី', 'No ads yet · tap Post new')}</div>`}
      <p class="hint glegend">🟢 ${t('ផ្សាយ = បង្ហាញពេលបើកកម្មវិធី', 'Live = shows when the app opens')} · ⏸ ${t('ផ្អាក = នៅតែក្នុងវិចិត្រសាល', 'Paused = still in the Gallery')} · 🙈 ${t('លាក់ = បាត់ពីអ្នកទាំងអស់', 'Hidden = gone for everyone')}</p>`;
  }
  function bindList() {
    const q = $('#q');
    if (q) q.oninput = () => { F.q = q.value; const p = q.selectionStart; redrawList(); const n = $('#q'); if (n) { n.focus(); n.setSelectionRange(p, p); } };
    const fa = $('#fApp');
    if (fa) fa.onchange = () => { F.app = fa.value; redrawList(); };
    $$('[data-chip]').forEach(b => b.onclick = () => { F.chip = b.dataset.chip; redrawList(); });
    $$('[data-c]').forEach(b => b.onclick = () => { F.chip = F.chip === b.dataset.c ? 'all' : b.dataset.c; redrawList(); });
    $$('[data-sw]').forEach(b => b.onclick = async () => {
      const a = D.ads.find(x => x.id === b.dataset.sw);
      if (!a) return;
      b.disabled = true;
      await quick([a.id], { show: !a.show }, !a.show ? '🟢 ' + t('បានបើកផ្សាយ', 'Live') : '⏸ ' + t('បានផ្អាក', 'Paused'));
    });
  }
  function redrawList() { if (E && split()) return renderEdit(E.id); renderList(); }
  function renderList() { E = null; view(listHtml()); bindList(); }

  /** Pause / play / hide / unhide, then the new list from the server. */
  async function quick(ids, change, msg) {
    try {
      const res = await api('adQuick', Object.assign({ ids }, change));
      Object.assign(D, { version: res.version, settings: res.settings || D.settings, ads: res.ads || D.ads });
      save();
      toast(msg);
      ADS && !DEMO && ADS.sync(true);
    } catch (e) { toast(e.message); }
    screen();
  }

  // ------------------------------------------------------------------ Manager: new / edit
  function blankForm() {
    return { file: null, type: '', preview: '', name: '', text: '', textEn: '', apps: ['fuel', 'transport', 'overtime', 'inbound', 'incident', 'meeting', 'home'],
      aud: 'all', depts: [], roles: [], start: dayStr(Date.now()), end: '', freq: 'open', seconds: 7, show: true };
  }
  function formOf(a) {
    const m = /^(dept|role):(.*)$/.exec(a.audience || 'all'), list = m ? m[2].split('|').filter(Boolean) : [];
    return { file: null, type: a.type, preview: a.thumb, name: a.name || '', text: a.text || '', textEn: a.textEn || '', apps: (a.apps || ['fuel']).slice(),
      aud: m ? m[1] : 'all', depts: m && m[1] === 'dept' ? list : [], roles: m && m[1] === 'role' ? list : [],
      start: dayStr(a.start), end: dayStr(a.end ? a.end - 1000 : 0), freq: a.freq || 'open', seconds: a.seconds || 7, show: a.show };
  }
  function renderEdit(id) {
    const a = id ? D.ads.find(x => x.id === id) : null;
    if (id && !a) { go('#/manage'); return; }
    if (!E || E.id !== (id || '')) E = { id: id || '', f: a ? formOf(a) : blankForm(), tried: false };
    const f = E.f;
    const need = bad => E.tried && bad ? ' need' : '';
    const st = a ? status(a) : '';
    const deptList = (D.depts || []).slice();
    f.depts.forEach(d => { if (deptList.indexOf(d) < 0) deptList.push(d); });
    const form = `
      ${split() && a ? '' : `<a class="back" href="#/manage">‹ ${t('ថយក្រោយ', 'Back')}</a>`}
      <div class="ghead"><h2>${a ? '✏️ ' + t('ការផ្សាយ', 'Edit ad') : '＋ ' + t('បង្ហោះថ្មី', 'Post new')}</h2>${a ? pill(a) : ''}</div>
      <div class="card">
        <label class="gdrop${need(!a && !f.file)}"><input type="file" accept="image/*,video/*" hidden id="fFile">
          <span class="gpv" style="${f.preview ? `background-image:url('${f.preview}')` : ''}">${f.preview ? (f.type === 'video' ? '<i class="gplay">▶</i>' : '') : '📷'}</span>
          <span class="gdt"><b>${esc(f.name || (a ? t('ឯកសារបច្ចុប្បន្ន', 'Current file') : t('រូបភាព ឬ វីដេអូ', 'Image or video')))}</b>
            <small>${a ? `${f.type === 'video' ? t('វីដេអូ', 'Video') : t('រូបភាព', 'Image')} · 👁 ${num(a.views)} · ⏭ ${num(a.skips)}` : 'JPG, PNG, MP4 · ≤ 20 MB'}</small>
            <span class="btn sm">${f.preview ? '🔁 ' + t('ប្តូរ', 'Change') : '📁 ' + t('ជ្រើសរើស', 'Choose')}</span></span></label>
        <div id="fileMsg"></div>
        <div class="field gtop"><label class="f" for="fText">${t('អក្សរក្រហម', 'Red text')} <small class="muted">${t('ស្រេចចិត្ត', 'Optional')}</small></label>
          <input class="in" id="fText" maxlength="200" placeholder="${t('ឧ. ពាក់មួកសុវត្ថិភាព គ្រប់ពេល', 'e.g. Wear your helmet at all times')}" value="${esc(f.text)}"></div>
        <div class="field"><label class="f" for="fTextEn">English <small class="muted">${t('ស្រេចចិត្ត', 'Optional')}</small></label>
          <input class="in" id="fTextEn" maxlength="200" placeholder="${t('បង្ហាញពេលជ្រើស 🇬🇧', 'Shown when 🇬🇧 is chosen')}" value="${esc(f.textEn)}"></div>
      </div>

      <div class="sec">📱 ${t('បង្ហាញក្នុងកម្មវិធី', 'Show in these apps')}<button type="button" class="link" id="allApps">${f.apps.length === APPS.length ? t('ដកទាំងអស់', 'Clear all') : t('ជ្រើសទាំងអស់', 'Select all')}</button></div>
      <div class="card"><div class="dapps gappsel${need(!f.apps.length)}">${APPS.map(x => `<button type="button" class="dapp${f.apps.indexOf(x[0]) >= 0 ? ' on' : ''}" data-app="${x[0]}">${appIcon(x[0], 28)}<small>${esc(t(x[1], x[2]))}</small></button>`).join('')}</div>
        ${E.tried && !f.apps.length ? `<div class="msg-err">${t('សូមជ្រើសរើសកម្មវិធីយ៉ាងហោចណាស់មួយ', 'Choose at least one app')}</div>` : ''}</div>

      <div class="sec">👥 ${t('អ្នកណាឃើញ', 'Who sees it')}</div>
      <div class="card">
        <div class="seg" id="fAud">${[['all', 'ទាំងអស់', 'Everyone'], ['dept', 'តាមផ្នែក', 'Departments'], ['role', 'តាមតួនាទី', 'Roles']].map(x =>
          `<button type="button" data-aud="${x[0]}" class="${f.aud === x[0] ? 'on' : ''}">${t(x[1], x[2])}</button>`).join('')}</div>
        ${f.aud === 'dept' ? `<div class="chips gpick${need(!f.depts.length)}">${deptList.length ? deptList.map(d => `<button type="button" class="chip${f.depts.indexOf(d) >= 0 ? ' on' : ''}" data-dept="${esc(d)}">${esc(d)}</button>`).join('')
          : `<span class="hint">${t('មិនទាន់មានផ្នែក · បន្ថែមនៅក្នុង 👥 អ្នកប្រើប្រាស់', 'No departments yet · add them in 👥 Users')}</span>`}</div>` : ''}
        ${f.aud === 'role' ? `<div class="chips gpick${need(!f.roles.length)}">${(D.roles || Object.keys(ROLE_NAMES)).map(r => `<button type="button" class="chip${f.roles.indexOf(r) >= 0 ? ' on' : ''}" data-role="${esc(r)}">${esc(roleName(r))}</button>`).join('')}</div>` : ''}
        ${E.tried && ((f.aud === 'dept' && !f.depts.length) || (f.aud === 'role' && !f.roles.length)) ? `<div class="msg-err">${t('សូមជ្រើសរើសយ៉ាងហោចណាស់មួយ', 'Choose at least one')}</div>` : ''}
        <p class="hint">${t('Admin ឃើញការផ្សាយទាំងអស់ ជានិច្ច', 'Admins always see every ad')}</p>
      </div>

      <div class="sec">🗓 ${t('ពេលវេលា', 'When')}</div>
      <div class="card">
        <div class="row2"><div class="field"><label class="f" for="fStart">${t('ចាប់ផ្តើម', 'Start')}</label><input class="in" type="date" id="fStart" value="${esc(f.start)}"></div>
          <div class="field"><label class="f" for="fEnd">${t('បញ្ចប់', 'End')} <small class="muted">${t('ស្រេចចិត្ត', 'Optional')}</small></label><input class="in${need(f.end && f.start && f.end < f.start)}" type="date" id="fEnd" value="${esc(f.end)}"></div></div>
        ${E.tried && f.end && f.start && f.end < f.start ? `<div class="msg-err">${t('ថ្ងៃបញ្ចប់ មុនថ្ងៃចាប់ផ្តើម', 'End is before Start')}</div>` : ''}
        <label class="f">${t('លោតញឹកប៉ុណ្ណា', 'How often')}</label>
        <div class="seg" id="fFreq">${FREQ.map(x => `<button type="button" data-freq="${x[0]}" class="${f.freq === x[0] ? 'on' : ''}">${t(x[1], x[2])}</button>`).join('')}</div>
        <p class="hint">${t('ក្នុងមួយអ្នកប្រើ · រាល់ពេលបើក = ដូចសព្វថ្ងៃ', 'Per person · Every open = as today')}</p>
        <div class="swrow gsecs"><span><b>${t('បង្ហាញ', 'Show for')} ${f.seconds} ${t('វិនាទី', 's')}</b><small>${t('រូបភាព 5–10 វិនាទី · វីដេអូ លេងរហូតដល់ចប់', 'Images 5–10 s · videos play to the end')}</small></span>
          <span class="gstep"><button type="button" data-sec="-1" aria-label="-1">−</button><b>${f.seconds}s</b><button type="button" data-sec="1" aria-label="+1">＋</button></span></div>
      </div>
      <div id="saveErr"></div>
      <div class="savebar gbtns">
        <button type="button" class="btn" id="pv">👁 ${t('មើលជាមុន', 'Preview')}</button>
        <button type="button" class="btn ok" id="save">${a ? '💾 ' + t('រក្សាទុក', 'Save') : '🟢 ' + t('ផ្សាយ', 'Publish')}</button>
      </div>
      ${a ? `<div class="gmore">
        ${st !== 'hidden' ? `<button type="button" class="btn" id="pause">${a.show ? '⏸ ' + t('ផ្អាក', 'Pause') : '▶️ ' + t('ផ្សាយវិញ', 'Make live')}</button>` : ''}
        <button type="button" class="btn${st === 'hidden' ? ' ok' : ''}" id="hide">${st === 'hidden' ? '👁 ' + t('បង្ហាញវិញ', 'Unhide') : '🙈 ' + t('លាក់ពីអ្នកទាំងអស់', 'Hide from everyone')}</button>
        <p class="hint">${t('បង្ហោះដោយ', 'Posted by')} ${esc(a.createdBy || '–')} · ${dayShow(a.createdAt)}</p></div>` : ''}`;
    if (split() && a) {
      view(`<div class="gsplit"><div class="gleft">${listHtml(a.id)}</div><aside class="gpanel">${form}</aside></div>`);
      bindList();
    } else view(form);
    bindEdit(a);
  }

  function bindEdit(a) {
    const f = E.f;
    const keep = () => LIVE ? LIVE.keep(() => renderEdit(E.id)) : renderEdit(E.id);
    $('#fText').oninput = e => { f.text = e.target.value; };
    $('#fTextEn').oninput = e => { f.textEn = e.target.value; };
    $('#fStart').onchange = e => { f.start = e.target.value; if (E.tried) keep(); };
    $('#fEnd').onchange = e => { f.end = e.target.value; if (E.tried) keep(); };
    $$('[data-app]', $('.gappsel')).forEach(b => b.onclick = () => { const k = b.dataset.app, i = f.apps.indexOf(k); if (i >= 0) f.apps.splice(i, 1); else f.apps.push(k); keep(); });
    $('#allApps').onclick = () => { f.apps = f.apps.length === APPS.length ? [] : APPS.map(x => x[0]); keep(); };
    $$('[data-aud]').forEach(b => b.onclick = () => { f.aud = b.dataset.aud; keep(); });
    $$('[data-dept]').forEach(b => b.onclick = () => { const d = b.dataset.dept, i = f.depts.indexOf(d); if (i >= 0) f.depts.splice(i, 1); else f.depts.push(d); keep(); });
    $$('[data-role]').forEach(b => b.onclick = () => { const d = b.dataset.role, i = f.roles.indexOf(d); if (i >= 0) f.roles.splice(i, 1); else f.roles.push(d); keep(); });
    $$('[data-freq]').forEach(b => b.onclick = () => { f.freq = b.dataset.freq; keep(); });
    $$('[data-sec]').forEach(b => b.onclick = () => { f.seconds = Math.max(5, Math.min(10, f.seconds + Number(b.dataset.sec))); keep(); });
    $('#fFile').onchange = async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const msg = $('#fileMsg');
      const err = m => { msg.innerHTML = `<div class="msg-err">${m}</div>`; };
      msg.innerHTML = `<p class="hint">⏳ ${t('កំពុងរៀបចំ…', 'Preparing…')}</p>`;
      try {
        if (/^video\//.test(file.type)) {
          if (file.size > 20 * 1024 * 1024) return err(t('វីដេអូធំពេក (លើស 20 MB)។ សូមកាត់ឲ្យខ្លី។', 'The video is too big (over 20 MB). Please make it shorter.'));
          const info = await videoInfo(file);
          Object.assign(f, { file, type: 'video', preview: info.thumb, name: file.name });
        } else if (/^image\//.test(file.type)) {
          Object.assign(f, { file, type: 'image', preview: await resizeImage(file, 320, 0.6), name: file.name });
        } else return err(t('សូមជ្រើសរើសរូបភាព ឬ វីដេអូ', 'Please choose an image or a video'));
        keep();
      } catch (x) { err(esc(x.message || t('មិនអាចអានឯកសារ', 'Could not read the file'))); }
    };
    $('#pv').onclick = async () => {
      const b = f.file ? (f.type === 'image' ? await (await fetch(await resizeImage(f.file, 1600, 0.82))).blob() : f.file) : a ? await adBlob(a).catch(() => null) : null;
      if (!b) { E.tried = true; keep(); toast(t('សូមជ្រើសរើសរូបភាព ឬ វីដេអូ', 'Please choose an image or a video')); return; }
      ADS.splash({ id: 'preview', type: f.type, text: f.text, textEn: f.textEn, seconds: f.seconds }, b, { app: f.apps[0] || 'home', skip: true });
    };
    $('#save').onclick = () => saveAd(a);
    const pause = $('#pause'), hide = $('#hide');
    if (pause) pause.onclick = () => quick([a.id], { show: !a.show }, a.show ? '⏸ ' + t('បានផ្អាក', 'Paused') : '🟢 ' + t('បានបើកផ្សាយ', 'Live'));
    if (hide) hide.onclick = () => {
      const h = status(a) !== 'hidden';
      if (h && !confirm(t('លាក់ការផ្សាយនេះពីអ្នកទាំងអស់? វានឹងបាត់ពីវិចិត្រសាល ប៉ុន្តែស្ថិតិនៅដដែល។', 'Hide this ad from everyone? It leaves the Gallery, its numbers are kept.'))) return;
      quick([a.id], { hidden: h }, h ? '🙈 ' + t('បានលាក់', 'Hidden') : '👁 ' + t('បានបង្ហាញវិញ', 'Unhidden'));
    };
  }

  async function saveAd(a) {
    const f = E.f;
    E.tried = true;
    const bad = (!a && !f.file) || !f.apps.length || (f.aud === 'dept' && !f.depts.length) || (f.aud === 'role' && !f.roles.length) || (f.end && f.start && f.end < f.start);
    if (bad) { renderEdit(E.id); const n = $('.need'); if (n) n.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const btn = $('#save');
    btn.disabled = true; btn.innerHTML = `<span class="sp"></span> ${f.file ? t('កំពុងបង្ហោះ…', 'Uploading…') : t('កំពុងរក្សាទុក…', 'Saving…')}`;
    try {
      const payload = { id: a ? a.id : '', text: f.text.trim(), textEn: f.textEn.trim(), seconds: f.seconds, start: f.start, end: f.end,
        show: a ? a.show : true, apps: f.apps.slice(), freq: f.freq,
        audience: f.aud === 'dept' ? 'dept:' + f.depts.join('|') : f.aud === 'role' ? 'role:' + f.roles.join('|') : 'all' };
      let b = null;
      if (f.file) {
        // Images are made smaller first; videos go as they are.
        payload.media = f.type === 'image' ? await resizeImage(f.file, 1600, 0.82) : await blobToDataUrl(f.file);
        payload.thumb = f.preview; payload.name = f.name;
        b = f.type === 'image' ? await (await fetch(payload.media)).blob() : f.file;
      }
      const res = await api('adSave', payload);
      D = Object.assign(D, await api('adManager'));
      save();
      // This phone keeps the file it just sent, so it is not downloaded again.
      const saved = D.ads.find(x => x.id === res.id);
      if (!DEMO && b && saved) await ADS.store.put(saved.key, b);
      if (!DEMO) ADS.sync(true);
      toast(a ? '💾 ' + t('បានរក្សាទុក', 'Saved') : '🟢 ' + t('បានផ្សាយ', 'Published'));
      E = null;
      go(a && split() ? '#/e/' + encodeURIComponent(a.id) : '#/manage');
    } catch (e) {
      if (!btn.isConnected) return;
      $('#saveErr').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`;
      btn.disabled = false; btn.innerHTML = a ? '💾 ' + t('រក្សាទុក', 'Save') : '🟢 ' + t('ផ្សាយ', 'Publish');
    }
  }

  // ------------------------------------------------------------------ Manager: stats
  function renderStats() {
    const days = (S && S.days) || 30;
    const d = S && S.data;
    const top = d ? D.ads.map(a => Object.assign({ s: d.byAd[a.id] || { views: 0, skips: 0, people: 0 } }, a)).filter(x => x.s.views || status(x) === 'live').sort((x, y) => y.s.views - x.s.views) : [];
    const appRows = d ? APPS.map(x => ({ k: x[0], n: d.byApp[x[0]] || 0 })).filter(x => x.n).sort((x, y) => y.n - x.n) : [];
    const maxApp = Math.max(1, ...appRows.map(x => x.n));
    // One bar per day, oldest first.
    const bars = [];
    if (d) for (let i = days - 1; i >= 0; i--) { const dt = new Date(); dt.setHours(0, 0, 0, 0); dt.setDate(dt.getDate() - i); const k = dayStr(dt.getTime()); bars.push({ k, ms: dt.getTime(), n: d.byDay[k] || 0 }); }
    const maxBar = Math.max(1, ...bars.map(b => b.n));
    view(`<div class="um-head"><h1>📊 ${t('ស្ថិតិ', 'Stats')}</h1>
        <select class="in dsel" id="days">${[7, 30, 90].map(n => `<option value="${n}"${n === days ? ' selected' : ''}>${n} ${t('ថ្ងៃចុងក្រោយ', 'last days')}</option>`).join('')}</select></div>
      ${!d ? '<div class="spinner"></div>' : `
      <div class="stats gkpi">
        <div><b>${num(d.views)}</b><small>${t('មើល', 'Views')}</small></div>
        <div><b>${num(d.skips)}</b><small>${t('រំលង', 'Skips')}</small></div>
        <div><b>${d.views ? Math.round((d.views - d.skips) / d.views * 100) : 0}%</b><small>${t('មើលចប់', 'Watched to the end')}</small></div>
        <div><b>${num(d.people)}</b><small>${t('អ្នកប្រើ', 'People')}</small></div>
      </div>
      <div class="sec">👁 ${t('មើលតាមថ្ងៃ', 'Views by day')}</div>
      <div class="card"><div class="gbars${days > 30 ? ' thin' : ''}">${bars.map(b => `<span title="${esc(dayShow(b.ms))}: ${b.n}"><i style="height:${Math.round(b.n / maxBar * 100)}%"></i></span>`).join('')}</div>
        <div class="gbarx"><small>${dayShow(bars[0].ms)}</small><small>${t('ថ្ងៃនេះ', 'Today')}</small></div></div>
      <div class="gcols">
        <div><div class="sec">🖼️ ${t('តាមការផ្សាយ', 'By ad')}</div>
          <div class="card glist">${top.length ? top.map(a => `<a class="grow" href="#/e/${encodeURIComponent(a.id)}"><span class="gmain">${thumb(a)}
            <span class="gtx"><b>${esc(adText(a) || a.name || a.id)}</b><small>👁 ${num(a.s.views)} · ⏭ ${num(a.s.skips)} · ${t('មើលចប់', 'watched')} ${a.s.views ? Math.round((a.s.views - a.s.skips) / a.s.views * 100) : 0}% · 👥 ${num(a.s.people)}</small></span></span></a>`).join('')
            : `<p class="empty">${t('មិនទាន់មានអ្នកមើល', 'No views yet')}</p>`}</div></div>
        <div><div class="sec">📱 ${t('តាមកម្មវិធី', 'By app')}</div>
          <div class="card">${appRows.length ? appRows.map(x => `<div class="gapprow">${appIcon(x.k, 26)}<span><small>${esc(appName(x.k))}</small><i style="width:${Math.round(x.n / maxApp * 100)}%"></i></span><b>${num(x.n)}</b></div>`).join('')
            : `<p class="empty">${t('មិនទាន់មានអ្នកមើល', 'No views yet')}</p>`}</div></div>
      </div>
      <p class="hint">${t('ពីផ្ទាំង "Ad Log" ក្នុង Google Sheet · ចាប់ពីថ្ងៃ Code.gs ថ្មី', 'From the "Ad Log" tab in the Google Sheet · counted since the new Code.gs')}</p>`}`);
    $('#days').onchange = e => { S = { days: Number(e.target.value), data: null }; renderStats(); loadStats(); };
    if (!d) loadStats();
  }
  async function loadStats() {
    const days = (S && S.days) || 30;
    try {
      const data = await api('adStats', { days });
      S = { days, data };
      if (route() === 'stats') renderStats();
    } catch (e) {
      if (e.code === 'OLD' || e.code === 'NOACCESS') return blocked(e);
      toast(e.message);
    }
  }

  // ------------------------------------------------------------------ Manager: settings
  function renderSettings() {
    const s = D.settings || { apps: {}, gallery: true, skip: true, maxPerDay: 5 };
    const on = k => s.apps[k] !== false;
    view(`<div class="um-head"><h1>⚙️ ${t('ការកំណត់ការផ្សាយ', 'Ad settings')}</h1></div>
      <div class="sec">📱 ${t('ការផ្សាយពេលបើកកម្មវិធី', 'Startup ads in each app')}</div>
      <div class="card apps2">${APPS.map(x => `<div class="aline">${appIcon(x[0], 30)}<span class="at"><b>${esc(t(x[1], x[2]))}</b>
          <small>${x[0] === 'home' ? t('លោតនៅទំព័រដើម iSteel', 'Shows on the iSteel home menu') : t('លោតពេលបើកកម្មវិធី', 'Shows when the app opens')}</small></span>
          <button type="button" class="sw${on(x[0]) ? ' on' : ''}" role="switch" aria-checked="${on(x[0])}" data-sapp="${x[0]}" aria-label="${esc(t(x[1], x[2]))}"></button></div>`).join('')}</div>
      <div class="sec">🧰 ${t('ផ្សេងៗ', 'More')}</div>
      <div class="card apps2">
        <div class="aline"><img src="../icons/gallery.svg" alt="" width="30" height="30"><span class="at"><b>${t('វិចិត្រសាល សម្រាប់អ្នកប្រើ', 'Gallery for users')}</b><small>${t('ប៊ូតុងមើលការផ្សាយទាំងអស់ នៅទំព័រដើម', 'A home menu tile to watch every ad again')}</small></span>
          <button type="button" class="sw${s.gallery ? ' on' : ''}" role="switch" aria-checked="${s.gallery}" data-sk="gallery"></button></div>
        <div class="aline"><span class="gico">⏭</span><span class="at"><b>${t('អនុញ្ញាតឲ្យរំលង', 'Allow Skip')}</b><small>${t('ប៊ូតុង Skip ភ្លាមៗ', 'The Skip button shows straight away')}</small></span>
          <button type="button" class="sw${s.skip ? ' on' : ''}" role="switch" aria-checked="${s.skip}" data-sk="skip"></button></div>
        <div class="aline"><span class="gico">🔢</span><span class="at"><b>${t('ការផ្សាយច្រើនបំផុត / ថ្ងៃ', 'Most ads per day')}</b><small>${t('ក្នុងមួយអ្នកប្រើ · 0 = គ្មានកំណត់', 'Per person · 0 = no limit')}</small></span>
          <span class="gstep"><button type="button" data-max="-1" aria-label="-1">−</button><b>${s.maxPerDay || 0}</b><button type="button" data-max="1" aria-label="+1">＋</button></span></div>
      </div>
      <p class="hint">${t('រក្សាទុកភ្លាមៗ · ទូរស័ព្ទទទួលបានក្នុង 2 នាទី', 'Saved at once · phones pick it up within 2 minutes')}</p>`);
    const put = async (change, el) => {
      if (el) el.disabled = true;
      const before = JSON.stringify(D.settings);
      D.settings = Object.assign({}, s, change, { apps: Object.assign({}, s.apps, change.apps || {}) });
      renderSettings();
      try { D.settings = await api('adSettings', change); save(); toast('💾 ' + t('បានរក្សាទុក', 'Saved')); }
      catch (e) { D.settings = JSON.parse(before); toast(e.message); }
      if (route() === 'set') renderSettings();
    };
    $$('[data-sapp]').forEach(b => b.onclick = () => put({ apps: { [b.dataset.sapp]: !on(b.dataset.sapp) } }, b));
    $$('[data-sk]').forEach(b => b.onclick = () => put({ [b.dataset.sk]: !s[b.dataset.sk] }, b));
    $$('[data-max]').forEach(b => b.onclick = () => put({ maxPerDay: Math.max(0, Math.min(20, (s.maxPerDay || 0) + Number(b.dataset.max))) }, b));
  }

  // ------------------------------------------------------------------ files
  function resizeImage(file, maxSide, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('មិនអាចអានរូបភាពនេះ', 'Could not read this image'))); };
      img.src = url;
    });
  }
  const blobToDataUrl = b => new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(b); });
  /** A small picture of a video (from about 1 second in). */
  function videoInfo(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('មិនអាចអានវីដេអូនេះ', 'Could not read this video'))); };
      v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
      v.onseeked = () => {
        const k = 320 / Math.max(v.videoWidth, v.videoHeight, 1), c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * k) || 320; c.height = Math.round(v.videoHeight * k) || 180;
        let th = '';
        try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); th = c.toDataURL('image/jpeg', 0.6); } catch (e) { /* no picture */ }
        URL.revokeObjectURL(url);
        resolve({ duration: v.duration, thumb: th });
      };
      v.src = url;
    });
  }

  // ------------------------------------------------------------------ boot
  const save = () => { if (!DEMO && D) set(bootKey(), JSON.stringify(D)); };
  async function loadAdmin(quiet) {
    if (!DEMO && !signedIn()) { blocked({ code: 'AUTH' }); return; }
    if (!D && !quiet) { try { D = JSON.parse(get(bootKey()) || 'null'); } catch (e) { D = null; } if (D) screen(); }
    try {
      const d = await api('adManager');
      set(adminKey(), '1');
      if (quiet && JSON.stringify(d) === JSON.stringify(D)) return;
      D = d; save();
      if (E) return;   // never redraw over a form being filled in
      if (route() !== '' && route() !== 'gal') { if (quiet && LIVE) LIVE.keep(screen); else screen(); } else paintTabs('gal');
    } catch (e) {
      if (e.code === 'NOACCESS') set(adminKey(), null);
      if (e.code === 'AUTH' || e.code === 'NOACCESS' || e.code === 'OLD') { D = null; set(bootKey(), null); if (route() !== '' && route() !== 'gal') blocked(e); else paintTabs('gal'); return; }
      if (quiet) throw e;
      if (!D) { view(`<div class="card done"><div class="emoji">⚠️</div><p>${esc(e.message)}</p><button class="btn ok" id="retry">${t('ព្យាយាមម្តងទៀត', 'Try again')}</button></div>`); $('#retry').onclick = () => loadAdmin(); }
      else toast(e.message);
    }
  }

  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const paintTheme = () => { const th = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); $('#themeBtn').textContent = th === 'dark' ? '☀️' : '🌙'; };
  $('#themeBtn').onclick = () => { const now = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); const next = now === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); set('fr_theme', next); paintTheme(); };
  paintTheme();
  function paintDemo() { if (DEMO) { const d = $('#demo'); d.hidden = false; d.textContent = t('🧪 សាកល្បង — ទិន្នន័យគំរូ មិនរក្សាទុកក្នុង Sheet', '🧪 Demo — sample data, not saved to the Sheet'); } }
  if (window.LANG) { LANG.button($('#langBtn')); LANG.onChange(() => { paintStatic(); paintDemo(); screen(); }); }
  paintDemo(); paintStatic();
  const LIVE = window.LIVE;
  if (LIVE && !DEMO) LIVE.start({ run: () => (D && isAdmin() ? loadAdmin(true) : ADS.sync(false)), busy: () => !!E });
  window.ISTEEL_REFRESH = () => { if (E) { toast(t('កំពុងកែ · ចុច រក្សាទុក ឬ ថយក្រោយ', 'Editing · tap Save or Back')); return; } if (route() === 'stats') { S = null; renderStats(); return; } if (route() === '' || route() === 'gal') { renderGallery.done = false; renderGallery(); return; } loadAdmin(); };
  window.addEventListener('hashchange', () => { const h = route(); if (!(h === 'new' || h.indexOf('e/') === 0)) E = null; screen(); if (!(split() && h.indexOf('e/') === 0)) window.scrollTo(0, 0); });
  let wasWide = wide(), wasSplit = split();
  window.addEventListener('resize', () => { if (wide() !== wasWide || split() !== wasSplit) { wasWide = wide(); wasSplit = split(); screen(); } });

  if (!DEMO && !signedIn()) blocked({ code: 'AUTH' });
  else {
    if (DEMO) D = null;
    screen();
    // Admins: the manager's data comes in the background, so its tabs open at once.
    if (!DEMO && isAdmin() && (route() === '' || route() === 'gal')) loadAdmin(true).catch(() => {});
  }

  // ------------------------------------------------------------------ demo: sample ads, nothing saved
  function demoSeed() {
    const day = 86400000, now = Date.now(), pic = n => '../manual/ads/' + n + '.jpg';
    const mk = (id, n, text, textEn, o) => Object.assign({ id, key: id, type: 'image', thumb: pic(n), demoUrl: pic(n), text, textEn, seconds: 7, start: now - 20 * day, end: null,
      show: true, hidden: false, apps: ['fuel', 'transport', 'inbound'], audience: 'all', freq: 'open', createdAt: now - 20 * day, createdBy: 'kim@isisteel.com',
      views: 0, skips: 0, name: n + '.jpg' }, o || {});
    return {
      version: '1', settings: { apps: { meeting: false }, gallery: true, skip: true, maxPerDay: 5 },
      depts: ['Transport', 'Warehouse', 'Security', 'Production', 'Admin'], roles: Object.keys(ROLE_NAMES),
      ads: [
        mk('AD1', '01-secure-coils', 'ចងដែកដុំរមូរ (Coil) ឲ្យជាប់ មុនចេញដំណើរ', 'Secure coils before you drive', { views: 412, skips: 38, createdAt: now - 2 * day }),
        mk('AD2', '03-no-phone', 'កុំប្រើទូរស័ព្ទ ពេលបើកបរ', 'No phone while driving', { apps: ['fuel', 'transport'], audience: 'dept:Transport', views: 388, skips: 51, createdAt: now - 5 * day }),
        mk('AD3', '02-no-beer', 'ហាមផឹកស្រា ពេលម៉ោងធ្វើការ', 'No alcohol during working hours', { apps: ['fuel', 'transport', 'overtime', 'inbound', 'incident'], start: now + 2 * day, freq: 'day', createdAt: now - day }),
        mk('AD4', '07-ppe', 'ពាក់ PPE គ្រប់ពេល នៅក្នុងឃ្លាំង', 'Wear PPE in the warehouse', { apps: ['inbound', 'incident'], audience: 'dept:Warehouse', show: false, views: 205, skips: 22, freq: 'week', createdAt: now - 9 * day }),
        mk('AD5', '04-seat-belt', 'ពាក់ខ្សែក្រវាត់សុវត្ថិភាព', 'Wear your seat belt', { apps: ['fuel'], hidden: true, views: 97, skips: 9, createdAt: now - 30 * day }),
        mk('AD6', '05-engine-off', 'ពន្លត់ម៉ាស៊ីន មុនពេលចាក់សាំង', 'Engine off before refuelling', { apps: ['fuel', 'home'], audience: 'role:driver|security', views: 140, skips: 31, createdAt: now - 12 * day }),
      ],
    };
  }
  function demoApi(action, p) {
    const s = demoApi.s || (demoApi.s = demoSeed());
    const copy = () => JSON.parse(JSON.stringify({ version: s.version, settings: s.settings, ads: s.ads }));
    return new Promise(resolve => setTimeout(() => {
      const bump = () => { s.version = String(Number(s.version) + 1); };
      if (action === 'adManager') return resolve(Object.assign(copy(), { depts: s.depts, roles: s.roles }));
      if (action === 'ads') return resolve(copy());
      if (action === 'adQuick') { s.ads.forEach(a => { if (p.ids.indexOf(a.id) >= 0) { if (p.show !== undefined) a.show = p.show; if (p.hidden !== undefined) a.hidden = p.hidden; } }); bump(); return resolve(copy()); }
      if (action === 'adSettings') { s.settings = Object.assign({}, s.settings, p, { apps: Object.assign({}, s.settings.apps, p.apps || {}) }); bump(); return resolve(s.settings); }
      if (action === 'adSave') {
        let a = s.ads.find(x => x.id === p.id);
        if (!a) { a = { id: 'AD' + Date.now(), createdAt: Date.now(), createdBy: 'demo@isisteel.com', views: 0, skips: 0, hidden: false }; s.ads.unshift(a); }
        const day = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null; };
        Object.assign(a, { text: p.text, textEn: p.textEn, seconds: p.seconds, start: day(p.start), end: p.end ? day(p.end) + 86399999 : null, show: p.show !== false,
          apps: p.apps, audience: p.audience, freq: p.freq });
        if (p.media) Object.assign(a, { type: /^data:video/.test(p.media) ? 'video' : 'image', thumb: p.thumb, demoUrl: p.media, key: a.id, name: p.name });
        bump();
        return resolve({ id: a.id });
      }
      if (action === 'adStats') {
        const days = p.days || 30, byDay = {}, byAd = {}, byApp = {};
        let views = 0, skips = 0;
        for (let i = 0; i < days; i++) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); const n = Math.round(25 + 20 * Math.sin(i * 1.7) + (i % 3) * 6); byDay[dayStr(d.getTime())] = n; views += n; }
        s.ads.forEach((a, i) => { if (a.views) { const v = Math.round(views * [0.37, 0.3, 0, 0.17, 0.05, 0.11][i] || 0); byAd[a.id] = { views: v, skips: Math.round(v * a.skips / a.views), people: Math.min(63, Math.round(v / 7)) }; skips += byAd[a.id].skips; } });
        [['fuel', 0.45], ['transport', 0.28], ['inbound', 0.12], ['incident', 0.06], ['overtime', 0.05], ['home', 0.04]].forEach(x => { byApp[x[0]] = Math.round(views * x[1]); });
        return resolve({ days, views, skips, people: 63, byDay, byAd, byApp });
      }
      resolve({});
    }, 250));
  }
})();
