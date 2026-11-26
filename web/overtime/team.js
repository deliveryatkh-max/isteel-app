// Overtime › My Team and My info (Kim, 26 Nov 2026, option C).
// My Team (supervisors and admins): three big buttons (Resigned, New comer, Vacancy) and the latest team changes.
// Each button opens a short form, then a check screen before saving. My info (everyone signed in): own English and
// Khmer name and an employee photo. These screens use the signed-in session of the home menu and the main iSteel
// API (apps-script/Code.gs: teamInit, teamFind, teamResign, teamNew, teamVacancy, myInfoSave).
(function () {
  'use strict';

  const API = ((window.APP_CONFIG || {}).API_URL || '').trim();
  const TOKEN_KEY = 'fr_id_token';
  const CACHE = 'ot_team_v1', PHOTO = 'ot_team_photo';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const t = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode or full */ } };
  const getJ = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };
  const claims = () => { try { return JSON.parse(decodeURIComponent(escape(atob((get(TOKEN_KEY) || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; } };
  const signedIn = () => { const c = claims(); return !!(API && c && c.exp * 1000 > Date.now() + 60000); };
  const hidden = k => !!(window.MENUS && MENUS.isOff('overtime', k));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p2 = n => String(n).padStart(2, '0');
  const showDay = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || ''); return m ? `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}` : ''; };
  const showTime = ms => { if (!ms) return ''; const d = new Date(ms); return `${d.getDate()} ${MON[d.getMonth()]} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const todayYmd = () => { const d = new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
  const KH_ONLY = /^[ក-៿᧠-᧿\s]+$/;
  const EN_ONLY = /^[A-Za-z .'-]+$/;

  let D = getJ(CACHE, null);   // { can, me, log, open, titles, warehouses }: opens at once from the last visit
  let H = null;                // hooks from ot.js: { back, enter(redrawFn) }
  let loading = null;

  // ---------- server ----------
  const msgText = s => { const m = String(s || 'Error').match(/^([A-Z_]+):\s*([\s\S]*)$/); const txt = m ? m[2] : String(s); const p = txt.split(' / '); return { code: m ? m[1] : '', text: p.length > 1 ? t(p.slice(1).join(' / '), p[0]) : txt }; };
  async function api(action, payload) {
    let data;
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: get(TOKEN_KEY), payload: payload || {} }) });
      data = await res.json();
    } catch (e) {
      throw Object.assign(new Error(t('មិនអាចភ្ជាប់អ៊ីនធឺណិត។ សូមព្យាយាមម្តងទៀត។', 'No connection. Please try again.')), { code: 'NET' });
    }
    if (!data.ok) {
      if (/Unknown action/i.test(data.error)) throw Object.assign(new Error(t('Admin ត្រូវបិទភ្ជាប់ Code.gs ថ្មី រួច Deploy (New version) ជាមុនសិន។', 'The admin needs to paste the new Code.gs and deploy a New version first.')), { code: 'OLD' });
      const m = msgText(data.error);
      throw Object.assign(new Error(m.text), { code: m.code });
    }
    if (data.session) set(TOKEN_KEY, data.session);
    return data.data;
  }
  function keep(d) {
    if (!d) return;
    const photo = d.me && d.me.photo;
    if (photo) set(PHOTO, photo);
    D = Object.assign({}, D || {}, d);
    if (D.me) D.me = Object.assign({}, D.me, { photo: undefined });
    set(CACHE, JSON.stringify(D));
  }
  /** Fresh details in the background; the menu repaints when the answer changes what it shows. */
  function refresh() {
    if (!signedIn()) return Promise.resolve();
    if (loading) return loading;
    const before = JSON.stringify([D && D.can, D && D.me && D.me.id]);
    loading = api('teamInit', {}).then(d => {
      keep(d);
      if (JSON.stringify([D.can, D.me && D.me.id]) !== before && H && H.onMenu && H.onMenu()) H.back();
      if (scr === 'team') renderTeam();
    }).catch(() => { /* keep the saved copy */ }).finally(() => { loading = null; });
    return loading;
  }

  // ---------- small UI helpers ----------
  let scr = '';
  let toastTimer = 0;
  function toast(msg) { const el = $('#toast'); if (!el) return; el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800); }
  const backBtn = id => `<button type="button" class="btn back" id="${id}">← ${t('ត្រឡប់', 'Back')}</button>`;
  const req = '<span class="req">*</span>';
  const steps = n => `<div class="tm-steps"><b class="${n === 1 ? 'on' : ''}">1</b>${t('បំពេញ', 'Details')}<span></span><b class="${n === 2 ? 'on' : ''}">2</b>${t('ពិនិត្យ', 'Check')}</div>`;
  const kv = rows => `<div class="tm-kv">${rows.filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '').map(r => `<span>${esc(r[0])}</span><b>${esc(r[1])}</b>`).join('')}</div>`;
  /** Required boxes that are still empty get a red border, cleared as soon as they are filled (Kim, 28 Oct 2026). */
  // Placeholder rows in the employee list ("Vacancy …") are never shown as people (Kim, 26 Nov 2026).
  const isVac = s => /^\s*vacan/i.test(String(s || ''));
  const people = list => (list || []).filter(e => !isVac(e.full) && !isVac(e.name));
  function markNeed() { $$('[data-need]').forEach(el => el.classList.toggle('need', !String(el.value || '').trim())); }
  function liveNeed() { $$('[data-need]').forEach(el => { el.addEventListener('input', markNeed); el.addEventListener('change', markNeed); }); markNeed(); }
  function busyBtn(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.txt = btn.innerHTML; btn.innerHTML = '<span class="sp"></span>'; } else if (btn.dataset.txt) btn.innerHTML = btn.dataset.txt; }
  function show(html, redraw, name) {
    scr = name;
    if (H) H.enter(redraw);
    $('#view').innerHTML = html;
    window.scrollTo(0, 0);
  }

  // ---------- menu tiles ----------
  function tiles(box, hooks) {
    H = hooks;
    scr = 'menu';
    if (!box) return;
    const add = (id, icon, km, en, smKm, smEn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mtile'; b.id = id;
      b.innerHTML = `<span class="mi">${icon}</span><b>${t(km, en)}</b><small>${t(smKm, smEn)}</small>`;
      box.appendChild(b);
      return b;
    };
    if (!hidden('info')) add('mInfo', '🪪', 'ព័ត៌មានរបស់ខ្ញុំ', 'My info', 'កែឈ្មោះ និងរូបថតរបស់អ្នក', 'Update your name and photo').onclick = () => renderInfo();
    if (D && D.can && signedIn() && !hidden('team')) add('mTeam', '👥', 'ក្រុមរបស់ខ្ញុំ', 'My Team', 'បុគ្គលិកលាឈប់ បុគ្គលិកថ្មី និងការជ្រើសរើស', 'Resigned, new comers and vacancies').onclick = () => renderTeam();
    refresh();
  }

  function needSignIn(back) {
    show(`${backBtn('tmBack')}
      <section class="card">
        <div class="alert warn">🔐 ${t('សូមចូលគណនី (Sign in) នៅទំព័រដើមជាមុនសិន។', 'Please sign in on the home screen first.')}</div>
        <a class="btn ok big" href="../" style="margin-top:12px">${t('ទៅទំព័រដើម', 'Go to the home screen')}</a>
      </section>`, back, 'signin');
    $('#tmBack').onclick = () => H.back();
  }

  // ---------- My Team home: three buttons and the latest changes ----------
  function renderTeam() {
    if (!signedIn()) return needSignIn(renderTeam);
    const d = D || {}, open = d.open || [], log = d.log || [];
    const chip = ty => ty === 'Resigned' ? `<span class="tm-chip bad">${t('លាឈប់', 'Left')}</span>`
      : ty === 'New comer' ? `<span class="tm-chip ok">${t('ថ្មី', 'New')}</span>`
      : ty === 'Vacancy' ? `<span class="tm-chip warn">${t('ជ្រើសរើស', 'Vacancy')}</span>`
      : `<span class="tm-chip">${t('កែព័ត៌មាន', 'Info')}</span>`;
    show(`${backBtn('tmBack')}
      <div class="tm-tiles">
        <button type="button" class="tm-tile" id="tRes"><span class="ic bad">🚪</span><span><b>${t('បុគ្គលិកលាឈប់', 'Resigned employee')}</b><small>${t('ស្វែងរកតាមលេខកាត ឬឈ្មោះ', 'Search by ID or name')}</small></span><i>›</i></button>
        <button type="button" class="tm-tile" id="tNew"><span class="ic ok">👤</span><span><b>${t('បុគ្គលិកថ្មី', 'New comer')}</b><small>${t('លេខកាត និងឈ្មោះ ខ្មែរ/អង់គ្លេស', 'ID and names in English and Khmer')}</small></span><i>›</i></button>
        <button type="button" class="tm-tile" id="tVac"><span class="ic warn">📋</span><span><b>${t('ព័ត៌មានជ្រើសរើស', 'Vacancy / recruitment')}</b><small>${open.length ? t('កំពុងជ្រើសរើស ' + open.length + ' កន្លែង', open.length + ' open') : t('មុខតំណែង ថ្ងៃចូល លេខសំណើ ឃ្លាំង', 'Title, join date, request ID, warehouse')}</small></span><i>›</i></button>
      </div>
      <h3 class="tm-sec">${t('ការផ្លាស់ប្តូរថ្មីៗ', 'Recent changes')}</h3>
      <section class="card tm-log">
        ${log.length ? log.map(x => `<div class="tm-li">${chip(x.type)}<div><b>${esc(x.id)} ${esc(x.name)}</b><small>${esc(x.detail)}</small><small>${esc(x.by)} · ${esc(showTime(x.time))}</small></div></div>`).join('')
          : `<p class="hint center" style="margin:6px 0">${loading ? '<span class="sp"></span>' : t('មិនទាន់មានការផ្លាស់ប្តូរ។', 'No changes yet.')}</p>`}
      </section>`, renderTeam, 'team');
    $('#tmBack').onclick = () => H.back();
    $('#tRes').onclick = () => { R.step = 1; renderResign(); };
    $('#tNew').onclick = () => { N.step = 1; renderNew(); };
    $('#tVac').onclick = () => { V.step = 1; renderVacancy(); };
    if (!D || !D.log) refresh();
  }

  // ---------- Resigned ----------
  const REASONS = [['Personal reason', 'មូលហេតុផ្ទាល់ខ្លួន'], ['New job', 'ការងារថ្មី'], ['Family', 'គ្រួសារ'], ['Health', 'សុខភាព'], ['Study', 'ការសិក្សា'], ['Contract ended', 'ផុតកិច្ចសន្យា'], ['Dismissed', 'បញ្ឈប់ពីការងារ'], ['Other', 'ផ្សេងៗ']];
  const R = { step: 1, q: '', hits: null, emp: null, lastDay: '', reason: '', letter: '', letterName: '', letterBusy: false, err: '', searching: false };
  function renderResign() {
    if (!signedIn()) return needSignIn(renderResign);
    if (R.step === 2) return renderResignCheck();
    const hits = R.hits;
    show(`${backBtn('tmBack')}
      ${steps(1)}
      <section class="card">
        <h2>🚪 ${t('បុគ្គលិកលាឈប់', 'Resigned employee')}</h2>
        <div class="field">
          <label class="f" for="rQ">${t('ស្វែងរកបុគ្គលិក', 'Find the employee')} ${req}</label>
          <div class="idrow">
            <input class="in${R.emp ? '' : ' need'}" id="rQ" autocomplete="off" spellcheck="false" maxlength="60" placeholder="${esc(t('លេខកាត ឬឈ្មោះ', 'ID or name'))}" value="${esc(R.q)}">
            <button type="button" class="btn ok" id="rFind">${R.searching ? '<span class="sp"></span>' : '🔎'} ${t('ស្វែងរក', 'Search')}</button>
          </div>
          ${hits && !hits.length ? `<p class="hint">${t('រកមិនឃើញ។', 'Nothing found.')}</p>` : ''}
          ${hits && hits.length ? `<div class="tm-hits">${hits.map((e, i) => `<button type="button" class="tm-hit${R.emp && R.emp.id === e.id ? ' on' : ''}" data-i="${i}"><b>${esc(e.id)} · ${esc(e.full)}</b><small>${esc(e.kh)}${e.dept ? ' · ' + esc(e.dept) : ''}${e.lastDay ? ' · ' + t('ថ្ងៃចុងក្រោយ ', 'last day ') + esc(showDay(e.lastDay)) : ''}</small></button>`).join('')}</div>` : ''}
        </div>
        <div class="field">
          <label class="f" for="rDay">${t('ថ្ងៃធ្វើការចុងក្រោយ', 'Last working day')} ${req}</label>
          <input class="in" type="date" id="rDay" value="${esc(R.lastDay)}" data-need>
        </div>
        <div class="field">
          <label class="f" for="rWhy">${t('មូលហេតុ', 'Reason')} <small class="hint">(${t('មិនចាំបាច់', 'optional')})</small></label>
          <select class="in" id="rWhy"><option value="">— ${t('ជ្រើសរើស', 'Choose')} —</option>${REASONS.map(r => `<option value="${esc(r[0])}"${R.reason === r[0] ? ' selected' : ''}>${esc(t(r[1], r[0]))}</option>`).join('')}</select>
        </div>
        <div class="field">
          <span class="f">${t('លិខិតលាឈប់', 'Resignation letter')} <small class="hint">(${t('រូបថត ឬ PDF', 'photo or PDF')})</small></span>
          ${R.letter ? `<div class="tm-letter">${R.letter.indexOf('data:image') === 0 ? `<img src="${R.letter}" alt="">` : '<span class="doc">📄</span>'}<b>${esc(R.letterName)}</b><button type="button" class="btn" id="rLetterX">✕ ${t('ដកចេញ', 'Remove')}</button></div>`
            : `<label class="btn" for="rLetter">${R.letterBusy ? '<span class="sp"></span>' : '📎'} ${t('ផ្ទុកលិខិតលាឈប់', 'Upload resignation letter')}</label>`}
          <input type="file" id="rLetter" accept="image/*,application/pdf" hidden>
        </div>
        ${R.err ? `<p class="msg-err" role="alert">${esc(R.err)}</p>` : ''}
      </section>
      <button type="button" class="btn ok big" id="rNext">${t('បន្ទាប់ ›', 'Next ›')}</button>`, renderResign, 'resign');
    liveNeed();
    const q = $('#rQ');
    const find = async () => {
      R.q = q.value.trim(); R.err = '';
      if (R.q.length < 2) { R.err = t('សូមវាយយ៉ាងហោចណាស់ ២ តួ។', 'Type at least 2 letters or digits.'); return renderResign(); }
      R.searching = true; renderResign();
      try { R.hits = people((await api('teamFind', { q: R.q })).list); if (R.hits.length === 1) R.emp = R.hits[0]; }
      catch (e) { R.err = e.message; }
      R.searching = false; renderResign();
    };
    $('#rFind').onclick = find;
    q.onkeydown = e => { if (e.key === 'Enter') find(); };
    $$('.tm-hit').forEach(b => b.onclick = () => { R.emp = R.hits[+b.dataset.i]; keepResign(); renderResign(); });
    $('#rDay').onchange = keepResign; $('#rWhy').onchange = keepResign;
    $('#rLetter').onchange = async ev => {
      const f = ev.target.files[0]; if (!f) return;
      keepResign(); R.err = '';
      const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      if (!pdf && f.type.indexOf('image/') !== 0) { R.err = t('សូមជ្រើសរូបថត ឬ PDF។', 'Choose a photo or a PDF.'); return renderResign(); }
      if (pdf && f.size > 5e6) { R.err = t('PDF ធំពេក (អតិបរមា 5 MB)។', 'The PDF is too big (max 5 MB).'); return renderResign(); }
      R.letterBusy = true; renderResign();
      try {
        R.letter = pdf ? await new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).replace(/^data:[^;]*;/, 'data:application/pdf;')); fr.onerror = bad; fr.readAsDataURL(f); })
          : await shrink(f, 1600);
        R.letterName = f.name || (pdf ? 'letter.pdf' : 'letter.jpg');
      } catch (e) { R.err = t('មិនអាចអានឯកសារបានទេ។', 'Could not read that file.'); }
      R.letterBusy = false; renderResign();
    };
    if ($('#rLetterX')) $('#rLetterX').onclick = () => { keepResign(); R.letter = ''; R.letterName = ''; renderResign(); };
    $('#tmBack').onclick = () => renderTeam();
    $('#rNext').onclick = () => {
      keepResign();
      R.err = !R.emp ? t('សូមស្វែងរក ហើយជ្រើសរើសបុគ្គលិក។', 'Search and choose the employee.') : !R.lastDay ? t('សូមបញ្ចូលថ្ងៃធ្វើការចុងក្រោយ។', 'Enter the last working day.') : '';
      if (R.err) return renderResign();
      R.step = 2; renderResign();
    };
  }
  function keepResign() { const d = $('#rDay'), w = $('#rWhy'), q = $('#rQ'); if (d) R.lastDay = d.value; if (w) R.reason = w.value; if (q) R.q = q.value.trim(); }
  function renderResignCheck() {
    const e = R.emp, past = R.lastDay < todayYmd();
    const why = REASONS.find(r => r[0] === R.reason);
    show(`${steps(2)}
      <section class="card">
        <h2>${t('ពិនិត្យមុនរក្សាទុក', 'Check before saving')}</h2>
        ${kv([[t('លេខកាត', 'Employee ID'), e.id], [t('ឈ្មោះ', 'Name'), e.full], [t('ឈ្មោះខ្មែរ', 'Khmer name'), e.kh], [t('ផ្នែក', 'Department'), e.dept],
          [t('ថ្ងៃធ្វើការចុងក្រោយ', 'Last working day'), showDay(R.lastDay)], [t('មូលហេតុ', 'Reason'), why ? t(why[1], why[0]) : ''], [t('លិខិតលាឈប់', 'Resignation letter'), R.letter ? '📎 ' + R.letterName : t('គ្មាន', 'None')]])}
        <div class="alert warn">${past ? t('ថ្ងៃចុងក្រោយបានកន្លងផុតហើយ៖ គណនីនឹងត្រូវបិទភ្លាមៗក្នុងគ្រប់កម្មវិធី។', 'The last day has passed: access to every app is switched off now.')
          : t('គណនីនឹងត្រូវបិទដោយស្វ័យប្រវត្តិ បន្ទាប់ពីថ្ងៃធ្វើការចុងក្រោយ។', 'Access to every app is switched off by itself after the last working day.')}</div>
        ${R.err ? `<p class="msg-err" role="alert">${esc(R.err)}</p>` : ''}
      </section>
      <button type="button" class="btn big tm-bad" id="rSave">${t('បញ្ជាក់ការលាឈប់', 'Confirm resigned')}</button>
      <button type="button" class="btn big" id="rEdit" style="margin-top:10px">‹ ${t('កែ', 'Back to edit')}</button>`, renderResign, 'resign');
    $('#rEdit').onclick = () => { R.step = 1; R.err = ''; renderResign(); };
    $('#rSave').onclick = async () => {
      const b = $('#rSave'); busyBtn(b, true);
      try {
        const r = await api('teamResign', { id: e.id, lastDay: R.lastDay, reason: R.reason, letter: R.letter });
        keep({ log: r.log });
        Object.assign(R, { step: 1, q: '', hits: null, emp: null, lastDay: '', reason: '', letter: '', letterName: '', err: '' });
        toast('✅ ' + t('បានរក្សាទុក៖ ' + r.id + ' លាឈប់', 'Saved: ' + r.id + ' resigned'));
        renderTeam();
      } catch (err) { R.err = err.message; busyBtn(b, false); renderResignCheck(); }
    };
  }

  // ---------- New comer ----------
  const N = { step: 1, id: '', full: '', kh: '', mgr: '', reqId: '', err: '', ok: '' };
  function renderNew() {
    if (!signedIn()) return needSignIn(renderNew);
    if (N.step === 2) return renderNewCheck();
    const mgrs = people(D && D.managers);
    if (!N.mgr && !N.mgrPicked && D && D.me && mgrs.some(x => x.name === D.me.full)) N.mgr = D.me.full;
    const open = (D && D.open) || [];
    show(`${backBtn('tmBack')}
      ${steps(1)}
      <section class="card">
        <h2>👤 ${t('បុគ្គលិកថ្មី', 'New comer')}</h2>
        <div class="field">
          <label class="f" for="nId">${t('លេខកាត', 'Employee ID')} ${req}</label>
          <input class="in" id="nId" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="${esc(t('ឧ. 106120', 'e.g. 106120'))}" value="${esc(N.id)}" data-need>
        </div>
        <div class="field">
          <label class="f" for="nFull">${t('ឈ្មោះពេញ (អក្សរឡាតាំង)', 'Full name (English)')} ${req}</label>
          <input class="in" id="nFull" autocomplete="off" spellcheck="false" maxlength="100" placeholder="CHAN SREYNET" value="${esc(N.full)}" style="text-transform:uppercase" data-need>
        </div>
        <div class="field">
          <label class="f" for="nKh">${t('ឈ្មោះពេញ (ខ្មែរ)', 'Full name (Khmer)')} ${req}</label>
          <input class="in" id="nKh" autocomplete="off" maxlength="100" placeholder="ចាន់ ស្រីនេត" value="${esc(N.kh)}" lang="km" data-need>
        </div>
        <div class="field">
          <label class="f" for="nMgr">${t('ប្រធានផ្ទាល់', 'Line manager')} ${req}</label>
          <input class="in" id="nMgr" autocomplete="off" spellcheck="false" maxlength="100" value="${esc(N.mgr)}"${mgrs.length ? ` placeholder="🔎 ${esc(t('វាយដើម្បីស្វែងរក', 'Type to search'))}" data-need` : ''}>
          <div class="tm-hits" id="nMgrList" hidden></div>
          <p class="hint">${t('ផ្នែក និងមុខងារ យកតាមរបស់អ្នក។', 'Department and function are copied from yours.')}</p>
        </div>
        ${open.length ? `<div class="field">
          <label class="f" for="nReq">${t('បំពេញកន្លែងទំនេរ', 'Fills a vacancy')} <small class="hint">(${t('មិនចាំបាច់', 'optional')})</small></label>
          <select class="in" id="nReq"><option value="">— ${t('គ្មាន', 'None')} —</option>${open.map(v => `<option value="${esc(v.reqId)}"${N.reqId === v.reqId ? ' selected' : ''}>${esc(v.reqId)} · ${esc(v.title)} · ${esc(v.wh)}</option>`).join('')}</select>
        </div>` : ''}
        ${N.err ? `<p class="msg-err" role="alert">${esc(N.err)}</p>` : ''}
      </section>
      <button type="button" class="btn ok big" id="nNext">${t('បន្ទាប់ ›', 'Next ›')}</button>`, renderNew, 'new');
    liveNeed();
    // Line manager: type any part of the name, then tap one from the list (Kim, 26 Nov 2026).
    const mIn = $('#nMgr'), mList = $('#nMgrList');
    const mShow = () => {
      if (!mgrs.length) return;
      const q = mIn.value.trim().toLowerCase();
      const hits = mgrs.filter(x => x.name.toLowerCase().indexOf(q) >= 0).slice(0, 8);
      mList.innerHTML = hits.length ? hits.map(x => `<button type="button" class="tm-hit${x.name === mIn.value ? ' on' : ''}" data-n="${esc(x.name)}"><b>${esc(x.name)}</b></button>`).join('')
        : `<p class="hint">${t('រកមិនឃើញ។', 'Nothing found.')}</p>`;
      mList.hidden = false;
    };
    mIn.addEventListener('focus', mShow);
    mIn.addEventListener('input', mShow);
    mIn.addEventListener('blur', () => setTimeout(() => { mList.hidden = true; }, 200));
    mList.addEventListener('mousedown', e => e.preventDefault());   // keep the box focused while tapping a name
    mList.addEventListener('click', e => {
      const b = e.target.closest('[data-n]'); if (!b) return;
      mIn.value = b.dataset.n; mList.hidden = true; mIn.blur(); markNeed();
    });
    $('#tmBack').onclick = () => renderTeam();
    $('#nNext').onclick = async () => {
      keepNew();
      N.err = !/^\d{6}$/.test(N.id) ? t('លេខកាតត្រូវមាន ៦ ខ្ទង់។', 'Employee ID must be 6 digits.')
        : !N.full || !EN_ONLY.test(N.full) ? t('សូមបញ្ចូលឈ្មោះជាអក្សរឡាតាំង។', 'Enter the full name in English letters.')
        : !N.kh || !KH_ONLY.test(N.kh) ? t('សូមបញ្ចូលឈ្មោះជាអក្សរខ្មែរ។', 'Enter the full name in Khmer letters.')
        : mgrs.length && !mgrs.some(x => x.name === N.mgr) ? t('សូមជ្រើសរើសប្រធានផ្ទាល់ពីបញ្ជី។', 'Choose the line manager from the list.') : '';
      if (N.err) return renderNew();
      const b = $('#nNext'); busyBtn(b, true);
      try {
        const hits = (await api('teamFind', { q: N.id })).list;
        const dup = hits.find(e => e.id === N.id);
        if (dup) { N.err = t('លេខកាត ' + N.id + ' មានក្នុងបញ្ជីរួចហើយ (' + dup.full + ')។', 'Employee ID ' + N.id + ' is already in the list (' + dup.full + ').'); return renderNew(); }
        N.ok = t('លេខកាត ' + N.id + ' មិនទាន់មានក្នុងបញ្ជីទេ', 'ID ' + N.id + ' is not in the list yet');
      } catch (e) { N.ok = ''; if (e.code === 'OLD' || e.code === 'NOACCESS' || e.code === 'AUTH') { N.err = e.message; return renderNew(); } }
      N.step = 2; renderNew();
    };
  }
  function keepNew() {
    const v = id => { const el = $('#' + id); return el ? el.value.replace(/\s+/g, ' ').trim() : undefined; };
    if ($('#nId')) { N.id = v('nId').replace(/\D/g, ''); N.full = v('nFull').toUpperCase(); N.kh = v('nKh'); N.mgr = v('nMgr'); N.mgrPicked = true; const mm = ((D && D.managers) || []).find(x => x.name.toLowerCase() === N.mgr.toLowerCase()); if (mm) N.mgr = mm.name; N.reqId = v('nReq') || ''; }
  }
  function renderNewCheck() {
    const vac = ((D && D.open) || []).find(x => x.reqId === N.reqId);
    show(`${steps(2)}
      <section class="card">
        <h2>${t('ពិនិត្យមុនរក្សាទុក', 'Check before saving')}</h2>
        ${kv([[t('លេខកាត', 'Employee ID'), N.id], [t('ឈ្មោះ (EN)', 'English name'), N.full], [t('ឈ្មោះខ្មែរ', 'Khmer name'), N.kh], [t('ប្រធានផ្ទាល់', 'Line manager'), N.mgr],
          [t('បំពេញកន្លែងទំនេរ', 'Fills vacancy'), vac ? vac.reqId + ' · ' + vac.title : '']])}
        ${N.ok ? `<div class="alert ok">✓ ${esc(N.ok)}</div>` : ''}
        ${N.err ? `<p class="msg-err" role="alert">${esc(N.err)}</p>` : ''}
      </section>
      <button type="button" class="btn ok big" id="nSave">${t('រក្សាទុក', 'Save')}</button>
      <button type="button" class="btn big" id="nEdit" style="margin-top:10px">‹ ${t('កែ', 'Back to edit')}</button>`, renderNew, 'new');
    $('#nEdit').onclick = () => { N.step = 1; N.err = ''; renderNew(); };
    $('#nSave').onclick = async () => {
      const b = $('#nSave'); busyBtn(b, true);
      try {
        const r = await api('teamNew', { id: N.id, full: N.full, kh: N.kh, mgr: N.mgr, reqId: N.reqId });
        keep({ log: r.log, open: r.open, titles: r.titles, warehouses: r.warehouses, managers: r.managers || (D && D.managers) });
        Object.assign(N, { step: 1, id: '', full: '', kh: '', mgr: '', mgrPicked: false, reqId: '', err: '', ok: '' });
        toast('✅ ' + t('បានបន្ថែម ' + r.id + ' ' + r.kh, 'Added ' + r.id + ' ' + r.full));
        renderTeam();
      } catch (err) { N.err = err.message; busyBtn(b, false); renderNewCheck(); }
    };
  }

  // ---------- Vacancy ----------
  const V = { step: 1, title: '', join: '', reqId: '', wh: '', err: '' };
  function renderVacancy() {
    if (!signedIn()) return needSignIn(renderVacancy);
    if (V.step === 2) return renderVacancyCheck();
    const d = D || {};
    show(`${backBtn('tmBack')}
      ${steps(1)}
      <section class="card">
        <h2>📋 ${t('ព័ត៌មានជ្រើសរើស', 'Vacancy / recruitment')}</h2>
        <div class="field">
          <label class="f" for="vTitle">${t('មុខតំណែងទំនេរ', 'Vacancy title')} ${req}</label>
          <input class="in" id="vTitle" list="vTitles" autocomplete="off" maxlength="100" placeholder="${esc(t('ជ្រើសរើស ឬវាយថ្មី', 'Pick or type a new one'))}" value="${esc(V.title)}" data-need>
          <datalist id="vTitles">${(d.titles || []).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
        </div>
        <div class="field">
          <label class="f" for="vJoin">${t('ថ្ងៃរំពឹងចូលធ្វើការ', 'Expected join date')} ${req}</label>
          <input class="in" type="date" id="vJoin" value="${esc(V.join)}" data-need>
        </div>
        <div class="field">
          <label class="f" for="vReq">${t('លេខសំណើ', 'Request ID')} ${req}</label>
          <input class="in" id="vReq" autocomplete="off" spellcheck="false" maxlength="40" placeholder="REQ-2026-118" value="${esc(V.reqId)}" style="text-transform:uppercase" data-need>
        </div>
        <div class="field">
          <label class="f" for="vWh">${t('ឃ្លាំង', 'Warehouse')} ${req}</label>
          <input class="in" id="vWh" list="vWhs" autocomplete="off" maxlength="60" placeholder="${esc(t('ជ្រើសរើស ឬវាយថ្មី', 'Pick or type a new one'))}" value="${esc(V.wh)}" data-need>
          <datalist id="vWhs">${(d.warehouses || []).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
          <p class="hint">${t('ឃ្លាំងថ្មី៖ វាយឈ្មោះ វានឹងត្រូវបន្ថែមក្នុងបញ្ជី។', 'New warehouse: type its name and it is added to the list.')}</p>
        </div>
        ${V.err ? `<p class="msg-err" role="alert">${esc(V.err)}</p>` : ''}
      </section>
      <button type="button" class="btn ok big" id="vNext">${t('បន្ទាប់ ›', 'Next ›')}</button>`, renderVacancy, 'vacancy');
    liveNeed();
    $('#tmBack').onclick = () => renderTeam();
    $('#vNext').onclick = () => {
      keepVac();
      V.err = !V.title ? t('សូមបញ្ចូលមុខតំណែង។', 'Enter the vacancy title.') : !V.join ? t('សូមបញ្ចូលថ្ងៃរំពឹងចូលធ្វើការ។', 'Enter the expected join date.')
        : !V.reqId ? t('សូមបញ្ចូលលេខសំណើ។', 'Enter the request ID.') : !V.wh ? t('សូមជ្រើសរើសឃ្លាំង។', 'Choose the warehouse.')
        : ((D && D.open) || []).some(x => x.reqId.toUpperCase() === V.reqId) ? t('លេខសំណើនេះមានរួចហើយ។', 'This request ID is already open.') : '';
      if (V.err) return renderVacancy();
      V.step = 2; renderVacancy();
    };
  }
  function keepVac() {
    const v = id => { const el = $('#' + id); return el ? el.value.replace(/\s+/g, ' ').trim() : ''; };
    if ($('#vTitle')) { V.title = v('vTitle'); V.join = v('vJoin'); V.reqId = v('vReq').replace(/\s+/g, '').toUpperCase(); V.wh = v('vWh'); }
  }
  function renderVacancyCheck() {
    show(`${steps(2)}
      <section class="card">
        <h2>${t('ពិនិត្យមុនរក្សាទុក', 'Check before saving')}</h2>
        ${kv([[t('មុខតំណែង', 'Vacancy title'), V.title], [t('ថ្ងៃរំពឹងចូលធ្វើការ', 'Expected join date'), showDay(V.join)], [t('លេខសំណើ', 'Request ID'), V.reqId], [t('ឃ្លាំង', 'Warehouse'), V.wh]])}
        ${V.err ? `<p class="msg-err" role="alert">${esc(V.err)}</p>` : ''}
      </section>
      <button type="button" class="btn ok big" id="vSave">${t('រក្សាទុក', 'Save')}</button>
      <button type="button" class="btn big" id="vEdit" style="margin-top:10px">‹ ${t('កែ', 'Back to edit')}</button>`, renderVacancy, 'vacancy');
    $('#vEdit').onclick = () => { V.step = 1; V.err = ''; renderVacancy(); };
    $('#vSave').onclick = async () => {
      const b = $('#vSave'); busyBtn(b, true);
      try {
        const r = await api('teamVacancy', { title: V.title, join: V.join, reqId: V.reqId, wh: V.wh });
        keep(r);
        toast('✅ ' + t('បានរក្សាទុក ' + V.reqId, 'Saved ' + V.reqId));
        Object.assign(V, { step: 1, title: '', join: '', reqId: '', wh: '', err: '' });
        renderTeam();
      } catch (err) { V.err = err.message; busyBtn(b, false); renderVacancyCheck(); }
    };
  }

  // ---------- My info (everyone) ----------
  const I = { id: null, full: null, kh: null, phone: null, photo: null, err: '' };
  function renderInfo() {
    if (!signedIn()) return needSignIn(renderInfo);
    const me = D && D.me;
    if (!me) {
      show(`${backBtn('tmBack')}<section class="card">${loading || !D ? '<div class="spinner" aria-label="Loading"></div>'
        : `<div class="alert warn">${t('Gmail របស់អ្នកមិនទាន់ភ្ជាប់នឹងលេខកាតបុគ្គលិកទេ។ សូមប្រាប់ Admin។', 'Your Gmail is not linked to an Employee ID yet. Please ask the admin.')}</div>`}</section>`, renderInfo, 'info');
      $('#tmBack').onclick = () => H.back();
      if (!D || loading) refresh().then(() => { if (scr === 'info') renderInfo(); });
      return;
    }
    if (I.full === null) { I.id = me.id || ''; I.full = me.full || ''; I.kh = me.kh || ''; I.phone = me.phone || ''; }
    const pic = I.photo || get(PHOTO);
    show(`${backBtn('tmBack')}
      <section class="card">
        <h2>🪪 ${t('ព័ត៌មានរបស់ខ្ញុំ', 'My info')}</h2>
        <div class="tm-photo">
          <div class="pic">${pic ? `<img src="${esc(pic)}" alt="">` : '<span>👤</span>'}</div>
          <label class="btn" for="iPic">📷 ${pic ? t('ប្តូររូបថត', 'Change photo') : t('ថតរូប ឬជ្រើសរូប', 'Take or choose a photo')}</label>
          <input type="file" id="iPic" accept="image/*" hidden>
        </div>
        <div class="field">
          <label class="f" for="iId">${t('លេខកាត', 'Employee ID')} ${req}</label>
          <input class="in" id="iId" inputmode="numeric" maxlength="6" autocomplete="off" value="${esc(I.id)}" data-need>
          <p class="hint">${t('លេខកាតខុស? សូមវាយលេខត្រឹមត្រូវ ហើយចុចរក្សាទុក។', 'Wrong ID? Type the correct one and press Save.')}</p>
        </div>
        <div class="field">
          <label class="f" for="iFull">${t('ឈ្មោះពេញ (អក្សរឡាតាំង)', 'Full name (English)')} ${req}</label>
          <input class="in" id="iFull" autocomplete="off" spellcheck="false" maxlength="100" value="${esc(I.full)}" style="text-transform:uppercase" data-need>
        </div>
        <div class="field">
          <label class="f" for="iKh">${t('ឈ្មោះពេញ (ខ្មែរ)', 'Full name (Khmer)')} ${req}</label>
          <input class="in" id="iKh" autocomplete="off" maxlength="100" value="${esc(I.kh)}" lang="km" data-need>
        </div>
        <div class="field">
          <label class="f" for="iPhone">${t('លេខទូរស័ព្ទ', 'Phone number')}</label>
          <input class="in" id="iPhone" type="tel" inputmode="numeric" maxlength="12" autocomplete="tel" placeholder="${esc(t('ឧ. 012345678', 'e.g. 012345678'))}" value="${esc(I.phone)}">
        </div>
        ${I.err ? `<p class="msg-err" role="alert">${esc(I.err)}</p>` : ''}
      </section>
      <button type="button" class="btn ok big" id="iSave">${t('រក្សាទុក', 'Save')}</button>`, renderInfo, 'info');
    liveNeed();
    const keepI = () => { I.id = $('#iId').value.replace(/\D/g, ''); I.phone = $('#iPhone').value.replace(/\D/g, ''); I.full = $('#iFull').value.replace(/\s+/g, ' ').trim().toUpperCase(); I.kh = $('#iKh').value.replace(/\s+/g, ' ').trim(); };
    $('#tmBack').onclick = () => { Object.assign(I, { id: null, full: null, kh: null, phone: null, photo: null, err: '' }); H.back(); };
    ['#iId', '#iPhone'].forEach(k => $(k).addEventListener('input', e => { const v = e.target.value.replace(/\D/g, ''); if (v !== e.target.value) e.target.value = v; }));   // numbers only
    $('#iPic').onchange = async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      keepI();
      try { I.photo = await shrink(f, 640); I.err = ''; } catch (err) { I.err = t('មិនអាចបើករូបនេះបានទេ។', 'Could not open this photo.'); }
      renderInfo();
    };
    $('#iSave').onclick = async () => {
      keepI();
      I.err = !/^\d{6}$/.test(I.id) ? t('លេខកាតត្រូវមាន ៦ ខ្ទង់។', 'Employee ID must be 6 digits.')
        : I.phone && !/^0?\d{8,10}$/.test(I.phone) ? t('លេខទូរស័ព្ទមិនត្រឹមត្រូវ (៩ ឬ ១០ ខ្ទង់)។', 'Phone number looks wrong (9 or 10 digits).')
        : !I.full || !EN_ONLY.test(I.full) ? t('សូមបញ្ចូលឈ្មោះជាអក្សរឡាតាំង។', 'Enter your full name in English letters.')
        : !I.kh || !KH_ONLY.test(I.kh) ? t('សូមបញ្ចូលឈ្មោះជាអក្សរខ្មែរ។', 'Enter your full name in Khmer letters.') : '';
      if (I.err) return renderInfo();
      const p = {};
      if (I.id !== me.id) p.id = I.id;
      if (I.phone !== (me.phone || '')) p.phone = I.phone;
      if (I.full !== me.full) p.full = I.full;
      if (I.kh !== me.kh) p.kh = I.kh;
      if (I.photo) p.photo = I.photo;
      if (!Object.keys(p).length) { toast(t('គ្មានអ្វីត្រូវកែទេ។', 'Nothing to change.')); return; }
      const b = $('#iSave'); busyBtn(b, true);
      try {
        await api('myInfoSave', p);
        if (I.photo) set(PHOTO, I.photo);
        keep({ me: Object.assign({}, me, { id: I.id, phone: I.phone, full: I.full, kh: I.kh, hasPhoto: me.hasPhoto || !!I.photo }) });
        Object.assign(I, { full: null, kh: null, photo: null, err: '' });
        toast('✅ ' + t('បានរក្សាទុក', 'Saved'));
        H.back();
      } catch (err) { I.err = err.message; busyBtn(b, false); renderInfo(); }
    };
  }
  /** A phone photo made small (longest side max px, JPEG) so it saves fast. */
  function shrink(file, max) {
    return new Promise((ok, bad) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('image')); };
      img.src = url;
    });
  }

  window.OT_TEAM = { tiles, refresh };
})();
