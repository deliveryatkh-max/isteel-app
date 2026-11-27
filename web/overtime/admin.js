// Overtime › admin menus (Kim, 27 Nov 2026, from the mockups): 📊 Dashboard, 📑 Report and ⚙️ Setting.
// Admins only (Role = admin; the server checks again). Uses the signed-in session of the home menu and the main iSteel
// API (apps-script/Code.gs: otAdmin, otFix, otSettings, otSettingsSave). Dashboard and Report are worked out here in the
// browser from every OT row, so filters answer at once; the last copy is kept so the screens open straight away.
(function () {
  'use strict';

  const API = ((window.APP_CONFIG || {}).API_URL || '').trim();
  const TOKEN_KEY = 'fr_id_token';
  const CACHE = 'ot_admin_v1', SCACHE = 'ot_admin_set_v1';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const t = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode or full */ } };
  const getJ = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };
  const claims = () => { try { return JSON.parse(decodeURIComponent(escape(atob((get(TOKEN_KEY) || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; } };
  const signedIn = () => { const c = claims(); return !!(API && c && c.exp * 1000 > Date.now() + 60000); };
  const isAdmin = () => { const me = getJ('steel_me', null); return !!(me && me.role === 'admin'); };
  const hidden = k => !!(window.MENUS && MENUS.isOff('overtime', k));
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p2 = n => String(n).padStart(2, '0');
  const ymdOf = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  const todayYmd = () => ymdOf(new Date());
  const dmy = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
  const showDay = ymd => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || ''); return m ? `${+m[3]} ${MON[+m[2] - 1]} ${m[1]}` : ''; };
  const showTime = ms => { if (!ms) return ''; const d = new Date(ms); return `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const hrs = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const WAIT = ['Pending', 'Requires Follow-up'];

  let H = null, scr = '', redraw = null;
  const mine = () => !!(H && H.onAdmin && H.onAdmin());   // still on an admin screen (not moved to another tab)
  let A = getJ(CACHE, null), S = getJ(SCACHE, null);   // OT rows (otAdmin) and the Setting screen data (otSettings)
  let loading = null, sLoading = null, loadErr = '';

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
  function load() {
    if (loading) return loading;
    loading = api('otAdmin', {}).then(d => { A = d; ROWS = null; loadErr = ''; set(CACHE, JSON.stringify(d)); })
      .catch(e => { loadErr = e.message; })
      .finally(() => { loading = null; if (mine() && scr !== 'menu' && scr !== 'fix' && redraw) redraw(); else if (scr === 'menu' && H && H.onMenu && H.onMenu()) paintWaitTile(); });
    return loading;
  }
  function loadSettings() {
    if (sLoading) return sLoading;
    sLoading = api('otSettings', {}).then(d => { S = d; loadErr = ''; set(SCACHE, JSON.stringify(d)); })
      .catch(e => { loadErr = e.message; })
      .finally(() => { sLoading = null; if (mine() && scr === 'setting') renderSetting(); });
    return sLoading;
  }

  // ---------- rows ----------
  let ROWS = null;
  function rows() {
    if (ROWS) return ROWS;
    if (!A || !A.rows) return [];
    const c = A.cols, ix = n => c.indexOf(n);
    const k = {}; c.forEach(n => { k[n] = ix(n); });
    ROWS = A.rows.map(r => ({
      row: r[k.row], date: r[k.date], id: r[k.id], name: r[k.name], kh: r[k.kh], from: r[k.from], to: r[k.to], hours: +r[k.hours] || 0,
      reason: r[k.reason], status: r[k.status] || 'Recorded', approver: r[k.approver], decided: r[k.decided], record: r[k.record],
      reqId: r[k.reqId], dept: r[k.dept] || '—', shift: r[k.shift], rej: r[k.rejectReason],
    }));
    return ROWS;
  }
  const isWait = r => WAIT.indexOf(r.status) >= 0;
  const overdue = r => isWait(r) && r.record && Date.now() - r.record > 24 * 3600000;
  const counts = r => r.status === 'Approved' || r.status === 'Recorded';   // hours that count for pay (old rows have no status)
  function minsOf(s) {
    const m = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(String(s || ''));
    if (!m) return null;
    let h = +m[1]; if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
    return h * 60 + +m[2];
  }
  // Payroll split (assumed, Kim to confirm): public holiday from the Setting tab, Sunday, then night = shift 3 or a start
  // from 10 PM to before 5 AM, else weekday day.
  function otType(r) {
    const hol = (A && A.holidays || []).some(h => h.date === r.date);
    if (hol) return 'ph';
    const d = new Date(r.date + 'T00:00:00');
    if (d.getDay() === 0) return 'sun';
    const st = minsOf(r.from);
    if (/\b3\b/.test(r.shift || '') || (st != null && (st >= 22 * 60 || st < 5 * 60))) return 'night';
    return 'day';
  }

  // ---------- small UI helpers ----------
  let toastTimer = 0;
  function toast(msg) { const el = $('#toast'); if (!el) return; el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800); }
  const backBtn = id => `<button type="button" class="btn back oa-noprint" id="${id}">← ${t('ត្រឡប់', 'Back')}</button>`;
  function busyBtn(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.txt = btn.innerHTML; btn.innerHTML = '<span class="sp"></span>'; } else if (btn.dataset.txt) btn.innerHTML = btn.dataset.txt; }
  function show(html, fn, name) {
    scr = name; redraw = fn;
    if (H) H.enter(fn);
    $('#view').innerHTML = html;
  }
  const chip = s => {
    const cls = s === 'Approved' ? 'ok' : s === 'Rejected' ? 'bad' : WAIT.indexOf(s) >= 0 ? 'warn' : '';
    const km = { Approved: 'អនុម័ត', Rejected: 'បដិសេធ', Pending: 'កំពុងរង់ចាំ', 'Requires Follow-up': 'ត្រូវតាមដាន', Recorded: 'កត់ត្រា' }[s] || s;
    return `<span class="tm-chip ${cls}">${esc(t(km, s))}</span>`;
  };
  const top = (title, id) => `<div class="oa-top">${backBtn(id)}<h2>${title}</h2>
    <button type="button" class="btn sm oa-noprint" id="oaRef" title="${t('ទាញទិន្នន័យថ្មី', 'Refresh')}">${loading || sLoading ? '<span class="sp"></span>' : '↻'}</button></div>
    ${loadErr ? `<div class="alert bad oa-noprint">${esc(loadErr)}</div>` : ''}`;
  function needSignIn(back) {
    show(`${backBtn('oaBack')}<section class="card"><div class="alert warn">🔐 ${t('សូមចូលគណនី (Sign in) នៅទំព័រដើមជាមុនសិន។', 'Please sign in on the home screen first.')}</div>
      <a class="btn ok big" href="../" style="margin-top:12px">${t('ទៅទំព័រដើម', 'Go to the home screen')}</a></section>`, back, 'signin');
    $('#oaBack').onclick = () => H.back();
  }
  const spin = `<p class="hint center" style="margin:18px 0"><span class="sp" style="display:inline-block;width:20px;height:20px;border:2.5px solid var(--accent);border-right-color:transparent;border-radius:50%;animation:spin .7s linear infinite"></span></p>`;

  // ---------- menu tiles ----------
  function tiles(box, hooks) {
    H = hooks; scr = 'menu';
    if (!box || !isAdmin() || !signedIn()) return;
    const add = (id, icon, km, en, smKm, smEn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mtile'; b.id = id;
      b.innerHTML = `<span class="mi">${icon}</span><b>${t(km, en)}</b><small>${t(smKm, smEn)}</small>`;
      box.appendChild(b);
      return b;
    };
    const go = fn => () => { loadErr = ''; ST.loaded = false; fn(); };
    if (!hidden('dash')) add('mDash', '📊', 'ផ្ទាំងគ្រប់គ្រង', 'Dashboard', 'ម៉ោង OT ថ្ងៃនេះ សប្តាហ៍ ខែ និងសំណើរង់ចាំ', 'OT hours today, this week, this month and waiting').onclick = go(renderDash);
    if (!hidden('report')) add('mReport', '📑', 'របាយការណ៍', 'Report', 'តម្រង តាមបុគ្គលិក ផ្នែក និងបើកប្រាក់ · Excel', 'Filters, per person, per dept, payroll · Excel').onclick = go(renderReport);
    if (!hidden('setting')) add('mSetting', '⚙️', 'ការកំណត់', 'Setting', 'ច្បាប់ មូលហេតុ ផ្នែក QR អ្នកអនុម័ត ថ្ងៃឈប់', 'Rules, reasons, depts & QR, approvers, holidays').onclick = go(renderSetting);
    paintWaitTile();
    load();
  }
  function paintWaitTile() {
    const el = $('#mDash small');
    if (!el || !A) return;
    const n = rows().filter(overdue).length;
    if (n) el.innerHTML = `<span class="oa-late">⚠ ${t(n + ' សំណើរង់ចាំលើស 24 ម៉ោង', n + ' waiting over 24 h')}</span>`;
  }

  // ---------- 📊 Dashboard ----------
  const D = { period: 'month' };
  function periodRange(p) {
    const now = new Date(), to = todayYmd();
    if (p === 'today') return [to, to];
    if (p === 'week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [ymdOf(d), to]; }
    return [ymdOf(new Date(now.getFullYear(), now.getMonth(), 1)), to];
  }
  function renderDash() {
    if (!signedIn()) return needSignIn(renderDash);
    if (!A) { show(top('📊 ' + t('ផ្ទាំងគ្រប់គ្រង', 'Dashboard'), 'oaBack') + (loadErr ? '' : spin), renderDash, 'dash'); wire(); if (!loadErr) load(); return; }
    const [from, to] = periodRange(D.period);
    const all = rows(), list = all.filter(r => r.date >= from && r.date <= to);
    const sum = a => a.reduce((s, r) => s + r.hours, 0);
    const wait = all.filter(isWait), late = all.filter(overdue);
    const appr = list.filter(r => r.status === 'Approved').length, rej = list.filter(r => r.status === 'Rejected').length;
    const by = (a, key) => { const o = {}; a.forEach(r => { const k = key(r); o[k] = (o[k] || 0) + r.hours; }); return Object.keys(o).map(k => [k, o[k]]).sort((x, y) => y[1] - x[1]); };
    const depts = by(list.filter(counts).concat(list.filter(isWait)), r => r.dept);
    const max = depts.length ? depts[0][1] : 1;
    const people = {}; list.forEach(r => { const p = people[r.id] || (people[r.id] = { id: r.id, name: r.name, dept: r.dept, h: 0, n: 0 }); p.h += r.hours; p.n++; });
    const topStaff = Object.values(people).sort((a, b) => b.h - a.h).slice(0, 5);
    // Approvers: still waiting now, and how fast they answered in this period
    const ap = {};
    const apOf = n => ap[n] || (ap[n] = { name: n, wait: 0, late: 0, sumH: 0, n: 0 });
    wait.forEach(r => { if (!r.approver) return; const a = apOf(r.approver); a.wait++; if (overdue(r)) a.late++; });
    list.forEach(r => { if (r.approver && r.decided && r.record && r.decided > r.record) { const a = apOf(r.approver); a.sumH += (r.decided - r.record) / 3600000; a.n++; } });
    const apList = Object.values(ap).sort((a, b) => (b.late - a.late) || (b.wait - a.wait) || ((b.n ? b.sumH / b.n : 0) - (a.n ? a.sumH / a.n : 0))).slice(0, 8);
    const seg = window.FB ? FB.seg([['today', t('ថ្ងៃនេះ', 'Today')], ['week', t('សប្តាហ៍នេះ', 'This week')], ['month', t('ខែនេះ', 'This month')]], D.period, 'oaper') : '';
    show(`${top('📊 ' + t('ផ្ទាំងគ្រប់គ្រង', 'Dashboard'), 'oaBack')}
      <div class="fb-wrap oa-bar">${seg}<small>${esc(showDay(from))}${from !== to ? ' – ' + esc(showDay(to)) : ''}</small></div>
      <div class="oa-kpis">
        <div class="oa-kpi"><span>${t('ម៉ោង OT', 'OT hours')}</span><b>${hrs(sum(list))}</b></div>
        <div class="oa-kpi"><span>${t('សំណើ', 'Requests')}</span><b>${list.length}</b></div>
        <button type="button" class="oa-kpi${wait.length ? ' warn' : ''}" id="kWait"><span>${t('កំពុងរង់ចាំ (ទាំងអស់)', 'Waiting (all)')}</span><b>${wait.length}</b></button>
        <div class="oa-kpi"><span>${t('អនុម័ត / បដិសេធ', 'Approved / Rejected')}</span><b>${appr} / ${rej}</b></div>
      </div>
      ${late.length ? `<button type="button" class="oa-warn" id="kLate">⚠ ${t(late.length + ' សំណើរង់ចាំលើស 24 ម៉ោង', late.length + ' requests waiting over 24 hours')} <i>›</i></button>` : ''}
      <div class="oa-grid">
        <section class="card"><h2>🏢 ${t('ម៉ោងតាមផ្នែក', 'Hours by department')}</h2>
          ${depts.length ? depts.map(([k, v]) => `<button type="button" class="oa-hb" data-dept="${esc(k)}"><span>${esc(k)}</span><i style="width:${Math.max(2, Math.round(v / max * 100))}%"></i><em>${hrs(v)}</em></button>`).join('') : `<p class="hint">${t('មិនមានទិន្នន័យ', 'No data')}</p>`}
        </section>
        <section class="card"><h2>🏅 ${t('បុគ្គលិក OT ច្រើនជាងគេ', 'Top OT staff')}</h2>
          ${topStaff.length ? topStaff.map((p, i) => `<button type="button" class="oa-li oa-hit" data-q="${esc(p.id)}"><b class="oa-rank">${i + 1}</b><span class="grow"><b>${esc(p.name)}</b><small>${esc(p.id)} · ${esc(p.dept)} · ${p.n} ${t('សំណើ', 'requests')}</small></span><em>${hrs(p.h)} h</em></button>`).join('') : `<p class="hint">${t('មិនមានទិន្នន័យ', 'No data')}</p>`}
        </section>
        <section class="card"><h2>⏳ ${t('អ្នកអនុម័ត', 'Approvers')}</h2>
          ${apList.length ? `<div class="oa-li oa-lh"><span class="grow">${t('ឈ្មោះ', 'Name')}</span><span>${t('រង់ចាំ', 'Waiting')}</span><span>${t('ល្បឿនមធ្យម', 'Avg answer')}</span></div>` + apList.map(a => `<button type="button" class="oa-li oa-hit" data-appr="${esc(a.name)}"><span class="grow"><b>${esc(a.name)}</b>${a.late ? `<small class="oa-late">⚠ ${a.late} ${t('លើស 24 ម៉ោង', 'over 24 h')}</small>` : ''}</span><span>${a.wait}</span><span>${a.n ? hrs(a.sumH / a.n) + ' h' : '—'}</span></button>`).join('') : `<p class="hint">${t('មិនមានទិន្នន័យ', 'No data')}</p>`}
        </section>
      </div>`, renderDash, 'dash');
    wire();
    $$('[data-oaper]').forEach(b => b.onclick = () => { D.period = b.dataset.oaper; renderDash(); });
    const goReport = f => { Object.assign(R, { from, to, dept: '', status: '', appr: '', q: '', tab: 'req' }, f); renderReport(); };
    if ($('#kWait')) $('#kWait').onclick = () => goReport({ from: '', to: '', status: 'wait' });
    if ($('#kLate')) $('#kLate').onclick = () => goReport({ from: '', to: '', status: 'late' });
    $$('[data-dept]').forEach(b => b.onclick = () => goReport({ dept: b.dataset.dept }));
    $$('[data-q]').forEach(b => b.onclick = () => goReport({ q: b.dataset.q }));
    $$('[data-appr]').forEach(b => b.onclick = () => goReport({ from: '', to: '', appr: b.dataset.appr, status: 'wait' }));
  }
  function wire() {
    if ($('#oaBack')) $('#oaBack').onclick = () => H.back();
    if ($('#oaRef')) $('#oaRef').onclick = () => { loadErr = ''; busyBtn($('#oaRef'), true); (scr === 'setting' ? loadSettings() : load()); };
  }

  // ---------- 📑 Report ----------
  const R = { from: '', to: '', dept: '', status: '', appr: '', q: '', tab: 'req' };
  (function () { const [f, to] = periodRange('month'); R.from = f; R.to = to; })();
  const STATUSES = [['', 'ទាំងអស់', 'All'], ['wait', 'កំពុងរង់ចាំ', 'Waiting'], ['late', 'រង់ចាំលើស 24 ម៉ោង', 'Waiting over 24 h'], ['Approved', 'អនុម័ត', 'Approved'], ['Rejected', 'បដិសេធ', 'Rejected'], ['Recorded', 'កត់ត្រា (ចាស់)', 'Recorded (old)']];
  function filtered() {
    const q = R.q.trim().toLowerCase();
    return rows().filter(r => (!R.from || r.date >= R.from) && (!R.to || r.date <= R.to) && (!R.dept || r.dept === R.dept) && (!R.appr || r.approver === R.appr)
      && (!R.status || (R.status === 'wait' ? isWait(r) : R.status === 'late' ? overdue(r) : r.status === R.status))
      && (!q || (r.id + ' ' + r.name + ' ' + r.kh + ' ' + r.reqId).toLowerCase().indexOf(q) >= 0))
      .sort((a, b) => (b.date.localeCompare(a.date)) || (b.record - a.record));
  }
  // Each tab as [headers, rows, number columns, total row]; the same arrays feed the screen and Excel.
  function table(list) {
    if (R.tab === 'person' || R.tab === 'pay') {
      const o = {};
      list.forEach(r => {
        const p = o[r.id] || (o[r.id] = { id: r.id, name: r.name, dept: r.dept, n: 0, h: 0, ok: 0, wait: 0, ph: 0, sun: 0, day: 0, night: 0 });
        p.n++; p.h += r.hours;
        if (counts(r)) { p.ok += r.hours; p[otType(r)] += r.hours; }
        if (isWait(r)) p.wait++;
      });
      const ps = Object.values(o).sort((a, b) => b.h - a.h);
      if (R.tab === 'person') {
        const tot = ps.reduce((s, p) => [s[0] + p.n, s[1] + p.h, s[2] + p.ok, s[3] + p.wait], [0, 0, 0, 0]);
        return [[t('លេខកាត', 'ID'), t('ឈ្មោះ', 'Name'), t('ផ្នែក', 'Dept'), t('សំណើ', 'Requests'), t('ម៉ោងសរុប', 'Total h'), t('ម៉ោងអនុម័ត', 'Approved h'), t('រង់ចាំ', 'Waiting')],
          ps.map(p => [p.id, p.name, p.dept, p.n, hrs(p.h), hrs(p.ok), p.wait]), [3, 4, 5, 6],
          [t('សរុប', 'Total') + ' (' + ps.length + ')', '', '', tot[0], hrs(tot[1]), hrs(tot[2]), tot[3]]];
      }
      const rate = k => { const x = (A && A.rates || []).find(r => r.type.toLowerCase().indexOf(k) === 0); const m = x && /\(([^)]+)\)/.exec(x.rate); return m ? ' ' + m[1] : ''; };
      const pay = ps.filter(p => p.ok > 0);
      const tot = pay.reduce((s, p) => [s[0] + p.ph, s[1] + p.sun, s[2] + p.day, s[3] + p.night, s[4] + p.ok], [0, 0, 0, 0, 0]);
      return [[t('លេខកាត', 'ID'), t('ឈ្មោះ', 'Name'), t('ផ្នែក', 'Dept'), t('ថ្ងៃបុណ្យ', 'Holiday') + rate('ph'), t('ថ្ងៃអាទិត្យ', 'Sunday') + rate('weekend'), t('ថ្ងៃធម្មតា', 'Weekday') + rate('weekday (day'), t('យប់', 'Night') + rate('weekday (night'), t('សរុប', 'Total')],
        pay.map(p => [p.id, p.name, p.dept, hrs(p.ph), hrs(p.sun), hrs(p.day), hrs(p.night), hrs(p.ok)]), [3, 4, 5, 6, 7],
        [t('សរុប', 'Total') + ' (' + pay.length + ')', '', '', hrs(tot[0]), hrs(tot[1]), hrs(tot[2]), hrs(tot[3]), hrs(tot[4])]];
    }
    if (R.tab === 'dept') {
      const o = {};
      list.forEach(r => { const d = o[r.dept] || (o[r.dept] = { dept: r.dept, staff: {}, n: 0, h: 0, ok: 0 }); d.staff[r.id] = 1; d.n++; d.h += r.hours; if (counts(r)) d.ok += r.hours; });
      const ds = Object.values(o).sort((a, b) => b.h - a.h);
      const tot = ds.reduce((s, d) => [s[0] + Object.keys(d.staff).length, s[1] + d.n, s[2] + d.h, s[3] + d.ok], [0, 0, 0, 0]);
      return [[t('ផ្នែក', 'Department'), t('បុគ្គលិក', 'Staff'), t('សំណើ', 'Requests'), t('ម៉ោងសរុប', 'Total h'), t('ម៉ោងអនុម័ត', 'Approved h'), t('មធ្យម/សំណើ', 'Avg h / request')],
        ds.map(d => [d.dept, Object.keys(d.staff).length, d.n, hrs(d.h), hrs(d.ok), hrs(d.n ? d.h / d.n : 0)]), [1, 2, 3, 4, 5],
        [t('សរុប', 'Total'), tot[0], tot[1], hrs(tot[2]), hrs(tot[3]), hrs(tot[1] ? tot[2] / tot[1] : 0)]];
    }
    const tot = list.reduce((s, r) => s + r.hours, 0);
    return [[t('ថ្ងៃ', 'Date'), t('លេខកាត', 'ID'), t('ឈ្មោះ', 'Name'), t('ផ្នែក', 'Dept'), t('ចាប់ពី', 'From'), t('ដល់', 'To'), t('ម៉ោង', 'OT hr'), t('មូលហេតុ', 'Reason'), t('ស្ថានភាព', 'Status'), t('អ្នកអនុម័ត', 'Approver'), t('លេខសំណើ', 'Request ID')],
      list.map(r => [dmy(r.date), r.id, r.name, r.dept, r.from, r.to, hrs(r.hours), r.reason, r.status, r.approver, r.reqId]), [6],
      [t('សរុប', 'Total') + ' (' + list.length + ')', '', '', '', '', '', hrs(tot), '', '', '', '']];
  }
  function renderReport() {
    if (!signedIn()) return needSignIn(renderReport);
    if (!A) { show(top('📑 ' + t('របាយការណ៍', 'Report'), 'oaBack') + (loadErr ? '' : spin), renderReport, 'report'); wire(); if (!loadErr) load(); return; }
    const all = rows();
    const uniq = a => a.filter((x, i) => x && a.indexOf(x) === i).sort((a2, b) => a2.localeCompare(b));
    const depts = uniq(all.map(r => r.dept)), apprs = uniq(all.map(r => r.approver));
    const opt = (v, label, on) => `<option value="${esc(v)}"${v === on ? ' selected' : ''}>${esc(label)}</option>`;
    const list = filtered();
    const [head, body, nums, foot] = table(list);
    const MAX = 500, shown = body.slice(0, MAX);
    const cell = (v, i, tag) => `<${tag}${nums.indexOf(i) >= 0 ? ' class="n"' : ''}>${i === 8 && R.tab === 'req' && tag === 'td' ? chip(v) : esc(v)}</${tag}>`;
    const fb = window.FB;
    show(`${backBtn('oaBack')}
      <div class="fb-wrap">
        ${fb.head('otr', '📑 ' + t('របាយការណ៍ OT', 'OT report'),
          `<button type="button" class="fb-btn" id="oaXl">${fb.xl} Excel</button><button type="button" class="fb-btn" id="oaPrint">🖨 PDF</button><button type="button" class="fb-btn" id="oaRef">${loading ? '<span class="sp"></span>' : '↻'}</button>`,
          () => { Object.assign(R, { from: '', to: '', dept: '', status: '', appr: '', q: '' }); renderReport(); })}
        ${fb.panel('otr', fb.range('rFrom', 'rTo', R.from, R.to)
          + fb.field(t('ផ្នែក', 'Department'), `<select id="rDept">${opt('', t('ទាំងអស់', 'All'), R.dept)}${depts.map(d => opt(d, d, R.dept)).join('')}</select>`)
          + fb.field(t('ស្ថានភាព', 'Status'), `<select id="rStatus">${STATUSES.map(s => opt(s[0], t(s[1], s[2]), R.status)).join('')}</select>`)
          + fb.field(t('អ្នកអនុម័ត', 'Approver'), `<select id="rAppr">${opt('', t('ទាំងអស់', 'All'), R.appr)}${apprs.map(d => opt(d, d, R.appr)).join('')}</select>`)
          + fb.search('rQ', t('លេខកាត ឈ្មោះ ឬលេខសំណើ', 'ID, name or request ID'), R.q))}
      </div>
      ${loadErr ? `<div class="alert bad oa-noprint">${esc(loadErr)}</div>` : ''}
      <div class="fb-wrap oa-bar oa-noprint">${fb.seg([['req', t('សំណើ', 'Requests')], ['person', t('តាមបុគ្គលិក', 'Per person')], ['dept', t('តាមផ្នែក', 'Per dept')], ['pay', t('បើកប្រាក់', 'Payroll')]], R.tab, 'oatab')}</div>
      <p class="oa-print-only"><b>${t('របាយការណ៍ OT', 'OT report')}</b> · ${esc(R.from ? dmy(R.from) : '…')} – ${esc(R.to ? dmy(R.to) : '…')}${R.dept ? ' · ' + esc(R.dept) : ''}</p>
      ${R.tab === 'pay' ? `<p class="hint oa-noprint">${t('រាប់តែម៉ោងដែលបានអនុម័ត (និងជួរចាស់ដែលគ្មានស្ថានភាព)។ យប់ = វេនទី 3 ឬចាប់ផ្តើមពីម៉ោង 10 យប់ ដល់មុនម៉ោង 5 ព្រឹក។', 'Counts approved hours only (and old rows with no status). Night = shift 3, or a start from 10 PM to before 5 AM.')}</p>` : ''}
      ${R.tab === 'req' ? `<p class="hint oa-noprint">${t('ចុចលើជួរ ដើម្បីកែស្ថានភាព ឬម៉ោង។', 'Tap a row to fix its status or hours.')}</p>` : ''}
      <div class="oa-tw"><table class="oa-t">
        <thead><tr>${head.map((h, i) => cell(h, i, 'th')).join('')}</tr></thead>
        <tbody>${shown.length ? shown.map((r, k) => `<tr${R.tab === 'req' ? ` class="click" data-k="${k}"` : ''}>${r.map((v, i) => cell(v, i, 'td')).join('')}</tr>`).join('')
          : `<tr><td colspan="${head.length}" class="center">${t('មិនមានទិន្នន័យ', 'No data')}</td></tr>`}</tbody>
        ${body.length ? `<tfoot><tr>${foot.map((v, i) => `<td${nums.indexOf(i) >= 0 ? ' class="n"' : ''}>${esc(v)}</td>`).join('')}</tr></tfoot>` : ''}
      </table></div>
      ${body.length > MAX ? `<p class="hint">${t('បង្ហាញ ' + MAX + ' ជួរដំបូង។ Excel មានទាំងអស់ ' + body.length + ' ជួរ។', 'Showing the first ' + MAX + ' rows. Excel has all ' + body.length + '.')}</p>` : ''}`, renderReport, 'report');
    wire();
    const re = () => { R.from = $('#rFrom').value; R.to = $('#rTo').value; R.dept = $('#rDept').value; R.status = $('#rStatus').value; R.appr = $('#rAppr').value; renderReport(); };
    ['#rFrom', '#rTo', '#rDept', '#rStatus', '#rAppr'].forEach(s => { $(s).onchange = re; });
    let qt = 0;
    $('#rQ').oninput = () => { clearTimeout(qt); qt = setTimeout(() => { R.q = $('#rQ').value; renderReport(); const q = $('#rQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 300); };
    $$('[data-oatab]').forEach(b => b.onclick = () => { R.tab = b.dataset.oatab; renderReport(); });
    $$('tr[data-k]').forEach(tr => tr.onclick = () => renderFix(list[+tr.dataset.k]));
    $('#oaXl').onclick = () => excel(head, body, foot);
    $('#oaPrint').onclick = () => window.print();
  }
  function needXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = '../vendor/xlsx.mini.min.js'; s.onload = ok; s.onerror = () => no(new Error('Excel tool did not load.')); document.head.appendChild(s); });
  }
  async function excel(head, body, foot) {
    try {
      await needXlsx();
      const num = v => (typeof v === 'string' && /^-?[\d,]*\.?\d+$/.test(v) ? +v.replace(/,/g, '') : v);
      const ws = XLSX.utils.aoa_to_sheet([head].concat(body.map(r => r.map(num)), [foot.map(num)]));
      ws['!cols'] = head.map(h => ({ wch: Math.max(10, String(h).length + 2) }));
      const wb = XLSX.utils.book_new();
      const name = { req: 'Requests', person: 'Per person', dept: 'Per dept', pay: 'Payroll' }[R.tab];
      XLSX.utils.book_append_sheet(wb, ws, name);
      XLSX.writeFile(wb, 'OT ' + name + ' ' + (R.from || 'all') + ' to ' + (R.to || todayYmd()) + '.xlsx');
    } catch (e) { toast(e.message); }
  }

  // Admin fix of one request: status and/or hours, with a reason (logged; the old values go in Note).
  function renderFix(r) {
    if (!r) return;
    const st = ['Pending', 'Approved', 'Rejected', 'Requires Follow-up'];
    const canFix = !!r.reqId;
    show(`${backBtn('oaBack')}
      <section class="card">
        <h2>✏️ ${t('កែសំណើ OT', 'Fix OT request')}</h2>
        <div class="tm-kv">
          <span>${t('លេខសំណើ', 'Request ID')}</span><b>${esc(r.reqId || '—')}</b>
          <span>${t('បុគ្គលិក', 'Employee')}</span><b>${esc(r.id)} ${esc(r.name)}</b>
          <span>${t('ថ្ងៃ', 'Date')}</span><b>${esc(showDay(r.date))} · ${esc(r.from)} – ${esc(r.to)}</b>
          <span>${t('ផ្នែក', 'Dept')}</span><b>${esc(r.dept)}</b>
          <span>${t('មូលហេតុ', 'Reason')}</span><b>${esc(r.reason)}</b>
          <span>${t('ស្ថានភាព', 'Status')}</span><b>${chip(r.status)}</b>
          <span>${t('អ្នកអនុម័ត', 'Approver')}</span><b>${esc(r.approver || '—')}</b>
          ${r.rej ? `<span>${t('មូលហេតុបដិសេធ', 'Rejection reason')}</span><b>${esc(r.rej)}</b>` : ''}
        </div>
      </section>
      ${canFix ? `<section class="card">
        <div class="row2">
          <div class="field"><label class="f" for="fSt">${t('ស្ថានភាព', 'Status')}</label><select class="in" id="fSt">${st.map(s => `<option value="${s}"${s === r.status ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
          <div class="field"><label class="f" for="fH">${t('ម៉ោង OT', 'OT hours')}</label><input class="in" id="fH" type="number" step="0.25" min="0.25" max="24" inputmode="decimal" value="${esc(r.hours)}"></div>
        </div>
        <div class="field"><label class="f" for="fWhy">${t('មូលហេតុនៃការកែ', 'Reason for the change')} <span class="req">*</span></label><textarea class="in" id="fWhy" data-need placeholder="${t('ឧ. អ្នកអនុម័តបានយល់ព្រមតាមទូរស័ព្ទ', 'e.g. Manager approved by phone')}"></textarea></div>
        <p class="hint">${t('ការកែត្រូវបានកត់ត្រាក្នុង Note និង OT Log។ មិនផ្ញើ Telegram ទេ។', 'The change is written in Note and OT Log. No Telegram message is sent.')}</p>
        <div id="fErr" class="msg-err"></div>
        <button type="button" class="btn ok big" id="fSave">${t('រក្សាទុក', 'Save')}</button>
      </section>` : `<div class="alert warn">${t('ជួរចាស់នេះគ្មានលេខសំណើ ដូច្នេះកែក្នុង Sheet ផ្ទាល់។', 'This old row has no Request ID, so fix it in the sheet itself.')}</div>`}`, () => renderFix(r), 'fix');
    $('#oaBack').onclick = () => renderReport();
    const why = $('#fWhy');
    if (why) { const mark = () => why.classList.toggle('need', !why.value.trim()); why.oninput = mark; mark(); }
    if (!$('#fSave')) return;
    $('#fSave').onclick = async () => {
      const status = $('#fSt').value, hours = $('#fH').value, w = why.value.trim();
      if (w.length < 3) { $('#fErr').textContent = t('សូមសរសេរមូលហេតុនៃការកែ។', 'Please type the reason for the change.'); return; }
      busyBtn($('#fSave'), true);
      try {
        await api('otFix', { row: r.row, reqId: r.reqId, id: r.id, status, hours: +hours === r.hours ? '' : hours, why: w });
        const raw = A.rows.find(x => x[0] === r.row);
        if (raw) { raw[A.cols.indexOf('status')] = status; raw[A.cols.indexOf('hours')] = +hours; ROWS = null; set(CACHE, JSON.stringify(A)); }
        toast(t('បានរក្សាទុក ✓', 'Saved ✓'));
        renderReport();
        load();
      } catch (e) { $('#fErr').textContent = e.message; busyBtn($('#fSave'), false); }
    };
  }

  // ---------- ⚙️ Setting ----------
  const ST = { tab: 'rules', edit: null, confirm: '', upload: null };
  const RULES = [
    ['DATE_TIME_MODE', 'ថ្ងៃ និងម៉ោង', 'Date & time', 'Auto = ថ្ងៃនេះ ម៉ោងចាប់ពីចប់វេន · Manual = បុគ្គលិកវាយខ្លួនឯង', 'Auto = today, start at shift end · Manual = staff type them', 'mode'],
    ['MAX_HOURS_PER_REQUEST', 'ម៉ោងច្រើនបំផុតក្នុងមួយសំណើ', 'Max hours per request', 'ទទេ = គ្មានកំណត់', 'Blank = no limit', 'num'],
    ['MAX_DAYS_IN_PAST', 'ថ្ងៃថយក្រោយបាន', 'Days back allowed', '0 = ថ្ងៃនេះប៉ុណ្ណោះ', '0 = today only', 'num'],
    ['MAX_DAYS_IN_FUTURE', 'ថ្ងៃទៅមុខបាន', 'Days ahead allowed', 'ទទេ = គ្មានកំណត់', 'Blank = no limit', 'num'],
    ['ALLOW_OVERNIGHT', 'OT ឆ្លងយប់', 'Overnight OT', 'ម៉ោងចប់មុនម៉ោងចាប់ផ្តើម = ព្រឹកបន្ទាប់', 'End before start = next morning', 'yes'],
    ['SITE_LATLONG', 'ទីតាំង GPS ឃ្លាំង', 'Site GPS', 'ឧ. 11.5564, 104.9282 · ទទេ = មិនពិនិត្យ', 'e.g. 11.5564, 104.9282 · blank = no check', 'text'],
    ['SITE_RADIUS_M', 'ចម្ងាយពីឃ្លាំង (ម៉ែត្រ)', 'Distance from site (m)', 'ទូរស័ព្ទត្រូវនៅក្នុងចម្ងាយនេះ', 'The phone must be within this distance', 'num'],
    ['REMIND_AFTER_H', 'រំលឹកអ្នកអនុម័តក្រោយ (ម៉ោង)', 'Remind approver after (h)', 'Telegram រំលឹកម្តង បើនៅរង់ចាំ · ទទេ = បិទ', 'One Telegram reminder if still waiting · blank = off', 'num'],
  ];
  function renderSetting() {
    if (!signedIn()) return needSignIn(renderSetting);
    const tabs = [['rules', t('ច្បាប់', 'Rules')], ['reasons', t('មូលហេតុ', 'Reasons')], ['depts', t('ផ្នែក & QR', 'Depts & QR')], ['appr', t('អ្នកអនុម័ត', 'Approvers')], ['hol', t('ថ្ងៃឈប់', 'Holidays')], ['shifts', t('វេន', 'Shifts')], ['log', t('ប្រវត្តិ', 'History')]];
    const body = !S ? (loadErr ? '' : spin) : ({ rules: setRules, reasons: setReasons, depts: setDepts, appr: setAppr, hol: setHol, shifts: setShifts, log: setLog }[ST.tab])();
    show(`${top('⚙️ ' + t('ការកំណត់', 'Setting'), 'oaBack')}
      <div class="fb-wrap oa-bar oa-scroll">${FB.seg(tabs, ST.tab, 'oaset', true)}</div>
      ${body}
      <p class="hint">${t('ការផ្លាស់ប្តូរបង្ហាញលើទម្រង់ស្នើសុំក្នុងរយៈពេល 2 នាទី។', 'Changes reach the request form within 2 minutes.')}</p>`, renderSetting, 'setting');
    wire();
    $$('[data-oaset]').forEach(b => b.onclick = () => { ST.tab = b.dataset.oaset; ST.edit = null; ST.confirm = ''; ST.upload = null; renderSetting(); });
    if (S) ({ rules: wireRules, reasons: wireReasons, depts: wireDepts, appr: wireAppr, hol: wireHol, shifts: wireShifts, log: () => {} }[ST.tab])();
    if (!ST.loaded) { ST.loaded = true; loadSettings(); }
  }
  async function save(btn, payload, okMsg) {
    busyBtn(btn, true);
    try {
      const d = await api('otSettingsSave', payload);
      S = d; set(SCACHE, JSON.stringify(d));
      ST.edit = null; ST.confirm = ''; ST.upload = null;
      toast(d.saved ? (okMsg || t('បានរក្សាទុក ✓', 'Saved ✓')) : t('មិនមានអ្វីផ្លាស់ប្តូរ', 'Nothing changed'));
      renderSetting();
      return true;
    } catch (e) { toast(e.message); busyBtn(btn, false); return false; }
  }
  const li = (main, side) => `<div class="oa-li"><span class="grow">${main}</span>${side || ''}</div>`;

  function setRules() {
    const v = S.rules || {};
    const input = r => {
      const val = v[r[0]] == null ? '' : v[r[0]];
      if (r[5] === 'mode') return `<select class="in" data-rule="${r[0]}">${['Auto', 'Manual'].map(o => `<option${/^manual/i.test(val) === (o === 'Manual') ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
      if (r[5] === 'yes') return `<select class="in" data-rule="${r[0]}">${['Yes', 'No'].map(o => `<option${/^(no|n|false|0)$/i.test(val) === (o === 'No') ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
      return `<input class="in" data-rule="${r[0]}" ${r[5] === 'num' ? 'type="number" min="0" step="any" inputmode="decimal"' : 'type="text"'} value="${esc(val)}">`;
    };
    return `<section class="card">${RULES.map(r => `<div class="oa-rule"><label>${t(r[1], r[2])}<small>${t(r[3], r[4])}</small></label>${input(r)}</div>`).join('')}
      <button type="button" class="btn ok big" id="rSave" style="margin-top:12px">${t('រក្សាទុក', 'Save')}</button></section>`;
  }
  function wireRules() {
    $('#rSave').onclick = () => { const values = {}; $$('[data-rule]').forEach(el => { values[el.dataset.rule] = el.value.trim(); }); save($('#rSave'), { kind: 'rules', values }); };
  }

  function setReasons() {
    const list = S.reasons || [];
    return `<section class="card">
      <div class="idrow"><input class="in" id="rsNew" placeholder="${t('មូលហេតុថ្មី', 'New reason')}" maxlength="200"><button type="button" class="btn ok" id="rsAdd">＋ ${t('បន្ថែម', 'Add')}</button></div>
      <div style="margin-top:10px">${list.map((x, i) => ST.edit === 'r' + i
        ? li(`<input class="in" id="rsEd" value="${esc(x)}" maxlength="200">`, `<button type="button" class="btn sm ok" id="rsOk" data-i="${i}">${t('រក្សាទុក', 'Save')}</button><button type="button" class="btn sm" id="rsNo">✕</button>`)
        : li(esc(x), `<button type="button" class="btn sm" data-ren="${i}" title="${t('កែ', 'Rename')}">✏️</button><button type="button" class="btn sm${ST.confirm === 'r' + i ? ' tm-bad' : ''}" data-del="${i}">${ST.confirm === 'r' + i ? t('លុប?', 'Remove?') : '🗑'}</button>`)).join('')
        || `<p class="hint">${t('មិនទាន់មានមូលហេតុ', 'No reasons yet')}</p>`}</div></section>`;
  }
  function wireReasons() {
    const list = S.reasons || [];
    $('#rsAdd').onclick = () => { const v = $('#rsNew').value.trim(); if (v) save($('#rsAdd'), { kind: 'reason', op: 'add', to: v }); };
    $('#rsNew').onkeydown = e => { if (e.key === 'Enter') $('#rsAdd').click(); };
    $$('[data-ren]').forEach(b => b.onclick = () => { ST.edit = 'r' + b.dataset.ren; ST.confirm = ''; renderSetting(); const e = $('#rsEd'); if (e) e.focus(); });
    $$('[data-del]').forEach(b => b.onclick = () => {
      const k = 'r' + b.dataset.del;
      if (ST.confirm !== k) { ST.confirm = k; renderSetting(); return; }
      save(b, { kind: 'reason', op: 'remove', from: list[+b.dataset.del] });
    });
    if ($('#rsOk')) $('#rsOk').onclick = () => save($('#rsOk'), { kind: 'reason', op: 'rename', from: list[+$('#rsOk').dataset.i], to: $('#rsEd').value.trim() });
    if ($('#rsNo')) $('#rsNo').onclick = () => { ST.edit = null; renderSetting(); };
  }

  function setDepts() {
    const list = S.depts || [];
    return `<section class="card">
      <div class="row2"><input class="in" id="dName" placeholder="${t('ឈ្មោះផ្នែក', 'Department name')}"><input class="in" id="dFn" placeholder="${t('មុខងារ (មិនបាច់ក៏បាន)', 'Function (optional)')}"></div>
      <button type="button" class="btn ok" id="dAdd" style="margin-top:10px;width:100%">＋ ${t('បន្ថែមផ្នែក និងបង្កើត QR', 'Add department and make its QR')}</button>
      <div style="margin-top:10px">${list.map((d, i) => li(`<b>${esc(d.name)}</b><small>${esc(d.id)}${d.fn ? ' · ' + esc(d.fn) : ''}</small>`,
        `${d.print ? `<a class="btn sm" href="${esc(d.print)}" target="_blank" rel="noopener">🖨 QR</a>` : ''}<button type="button" class="btn sm oa-tog${d.active ? ' on' : ''}" data-act="${i}">${d.active ? t('បើក', 'On') : t('បិទ', 'Off')}</button>`)).join('')}</div>
      <p class="hint">${t('បិទ = QR របស់ផ្នែកនោះលែងប្រើបាន។', 'Off = that department QR stops working.')}</p></section>`;
  }
  function wireDepts() {
    const list = S.depts || [];
    $('#dAdd').onclick = () => { const name = $('#dName').value.trim(); if (!name) { $('#dName').classList.add('need'); return; } save($('#dAdd'), { kind: 'dept', op: 'add', name, fn: $('#dFn').value.trim() }); };
    $$('[data-act]').forEach(b => b.onclick = () => { const d = list[+b.dataset.act]; save(b, { kind: 'dept', op: 'active', row: d.row, name: d.name, on: !d.active }); });
  }

  function setAppr() {
    const list = S.approvers || [], off = list.filter(a => !a.linked);
    return `<div class="oa-kpis oa-k2">
        <div class="oa-kpi"><span>${t('ភ្ជាប់ Telegram រួច', 'Telegram linked')}</span><b>${list.length - off.length}</b></div>
        <div class="oa-kpi${off.length ? ' warn' : ''}"><span>${t('មិនទាន់ភ្ជាប់', 'Not linked')}</span><b>${off.length}</b></div>
      </div>
      ${off.length ? `<button type="button" class="btn" id="aCopy" style="width:100%;margin-bottom:12px">📋 ${t('ចម្លងការណែនាំចុះឈ្មោះ', 'Copy sign-up steps')}</button>` : ''}
      <section class="card">${list.map(a => li(`<b>${esc(a.name)}</b><small>${esc(a.tg || t('គ្មាន Telegram ក្នុងបញ្ជី', 'No Telegram in the list'))} · ${a.staff} ${t('នាក់', 'staff')}${a.linked && a.at ? ' · ' + esc(showTime(a.at)) : ''}</small>`,
        a.linked ? `<span class="tm-chip ok">✓ ${t('ភ្ជាប់', 'Linked')}</span>` : `<span class="tm-chip warn">⚠ ${t('មិនទាន់', 'Not yet')}</span>`)).join('') || `<p class="hint">${t('មិនមានទិន្នន័យ', 'No data')}</p>`}</section>`;
  }
  function wireAppr() {
    if (!$('#aCopy')) return;
    $('#aCopy').onclick = async () => {
      const url = S.formUrl || 'https://isteel-app.pages.dev/overtime/';
      const txt = 'ដើម្បីអនុម័ត OT តាម Telegram៖\n1. បើក ' + url + '\n2. ចុច 📲 ចុះឈ្មោះជាអ្នកអនុម័ត OT\n3. វាយលេខកាតបុគ្គលិករបស់អ្នក\n4. បើក Telegram ហើយចុច Start\n\n'
        + 'To approve OT on Telegram:\n1. Open ' + url + '\n2. Tap 📲 Sign up as OT approver\n3. Type your Employee ID\n4. Open Telegram and press Start';
      try { await navigator.clipboard.writeText(txt); toast(t('បានចម្លង ✓', 'Copied ✓')); } catch (e) { toast(t('ចម្លងមិនបាន', 'Could not copy')); }
    };
  }

  function setHol() {
    const list = (S.holidays || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const e = ST.edit && ST.edit.hol ? ST.edit : null;
    const up = ST.upload;
    return `<section class="card">
      <h2>${e ? '✏️ ' + t('កែថ្ងៃឈប់', 'Edit holiday') : '＋ ' + t('បន្ថែមថ្ងៃឈប់', 'Add holiday')}</h2>
      <div class="field"><label class="f" for="hDate">${t('ថ្ងៃខែ', 'Date')}</label><input class="in" type="date" id="hDate" value="${esc(e ? e.date : '')}"></div>
      <div class="field"><label class="f" for="hEn">${t('ឈ្មោះ (អង់គ្លេស)', 'Name (English)')}</label><input class="in" id="hEn" value="${esc(e ? e.en : '')}"></div>
      <div class="field"><label class="f" for="hKh">${t('ឈ្មោះ (ខ្មែរ)', 'Name (Khmer)')}</label><input class="in" id="hKh" value="${esc(e ? e.kh : '')}"></div>
      <div class="oa-btns"><button type="button" class="btn ok" id="hSave">${t('រក្សាទុក', 'Save')}</button>${e ? `<button type="button" class="btn" id="hCancel">${t('បោះបង់', 'Cancel')}</button>` : ''}
        <label class="btn" for="hFile">⬆ ${t('បញ្ចូល Excel', 'Upload Excel')}</label><input type="file" id="hFile" accept=".xlsx,.xls,.csv" hidden></div>
      <p class="hint">${t('Excel៖ ជួរឈរ Date, Public Holiday, Khmer (ថ្ងៃដដែល = កែប្រែ)។', 'Excel: columns Date, Public Holiday, Khmer (same date = update).')}</p>
      ${up ? `<div class="alert ok">${t('រកឃើញ ' + up.length + ' ថ្ងៃឈប់', up.length + ' holidays found')}: ${up.slice(0, 3).map(h => esc(dmy(h.date) + ' ' + (h.en || h.kh))).join(', ')}${up.length > 3 ? '…' : ''}
        <div class="oa-btns" style="margin-top:8px"><button type="button" class="btn ok sm" id="hUp">${t('បញ្ចូលទាំងអស់', 'Upload all')}</button><button type="button" class="btn sm" id="hUpNo">✕</button></div></div>` : ''}
    </section>
    <div class="oa-tw"><table class="oa-t"><thead><tr><th>${t('ថ្ងៃខែ', 'Date')}</th><th>${t('ថ្ងៃឈប់', 'Holiday')}</th><th>${t('ខ្មែរ', 'Khmer')}</th><th data-nosort></th></tr></thead>
      <tbody>${list.map(h => `<tr><td>${esc(dmy(h.date))}</td><td>${esc(h.en)}</td><td>${esc(h.kh)}</td><td class="oa-act"><button type="button" class="btn sm" data-hed="${h.row}">✏️</button><button type="button" class="btn sm${ST.confirm === 'h' + h.row ? ' tm-bad' : ''}" data-hdel="${h.row}">${ST.confirm === 'h' + h.row ? t('លុប?', 'Remove?') : '🗑'}</button></td></tr>`).join('')
        || `<tr><td colspan="4" class="center">${t('មិនមានទិន្នន័យ', 'No data')}</td></tr>`}</tbody></table></div>`;
  }
  function wireHol() {
    const list = S.holidays || [];
    const e = ST.edit && ST.edit.hol ? ST.edit : null;
    $('#hSave').onclick = () => {
      const date = $('#hDate').value, en = $('#hEn').value.trim(), kh = $('#hKh').value.trim();
      if (!date || !(en || kh)) { ['#hDate', '#hEn'].forEach(s => $(s).classList.toggle('need', !$(s).value.trim())); return; }
      save($('#hSave'), Object.assign({ kind: 'holiday', date, en, kh }, e ? { row: e.row, was: e.date } : {}));
    };
    if ($('#hCancel')) $('#hCancel').onclick = () => { ST.edit = null; renderSetting(); };
    $$('[data-hed]').forEach(b => b.onclick = () => { const h = list.find(x => x.row === +b.dataset.hed); ST.edit = Object.assign({ hol: 1 }, h); ST.confirm = ''; renderSetting(); window.scrollTo(0, 0); });
    $$('[data-hdel]').forEach(b => b.onclick = () => {
      const k = 'h' + b.dataset.hdel;
      if (ST.confirm !== k) { ST.confirm = k; renderSetting(); return; }
      const h = list.find(x => x.row === +b.dataset.hdel);
      save(b, { kind: 'holiday', remove: true, row: h.row, date: h.date });
    });
    $('#hFile').onchange = async ev => {
      const f = ev.target.files[0];
      if (!f) return;
      try { await needXlsx(); const up = parseHolidays(XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true })); ST.upload = up.length ? up : null; if (!up.length) toast(t('រកមិនឃើញថ្ងៃឈប់ក្នុងឯកសារ', 'No holidays found in the file')); renderSetting(); }
      catch (err) { toast(err.message); }
    };
    if ($('#hUp')) $('#hUp').onclick = () => save($('#hUp'), { kind: 'holidays', rows: ST.upload });
    if ($('#hUpNo')) $('#hUpNo').onclick = () => { ST.upload = null; renderSetting(); };
  }
  // The first sheet: a header row with "Date" and "Holiday" (Khmer column optional); without headers, columns A, B, C.
  function parseHolidays(wb) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const key = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
    let hr = aoa.findIndex(r => r.some(c => key(c) === 'date') && r.some(c => key(c).indexOf('holiday') >= 0));
    let dc = 0, ec = 1, kc = 2;
    if (hr >= 0) {
      const h = aoa[hr].map(key);
      dc = h.indexOf('date'); ec = h.findIndex(k => k.indexOf('holiday') >= 0 && k.indexOf('khmer') < 0); kc = h.findIndex(k => k.indexOf('khmer') >= 0);
    }
    const toYmd = v => {
      if (v instanceof Date && !isNaN(v)) return ymdOf(v);
      if (typeof v === 'number' && v > 20000 && v < 80000) return ymdOf(new Date(Math.round((v - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000));
      const s = String(v || '').trim();
      let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
      if (m) return m[1] + '-' + p2(m[2]) + '-' + p2(m[3]);
      m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2,4})$/.exec(s);
      if (m && MON.indexOf(m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()) >= 0) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + p2(MON.indexOf(m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()) + 1) + '-' + p2(m[1]);
      m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
      if (m) return m[3] + '-' + p2(m[2]) + '-' + p2(m[1]);   // day first, as in Cambodia
      return '';
    };
    const out = [], seen = {};
    aoa.slice(hr + 1).forEach(r => {
      const date = toYmd(r[dc]), en = ec >= 0 ? String(r[ec] || '').trim() : '', kh = kc >= 0 ? String(r[kc] || '').trim() : '';
      if (!date || !(en || kh) || seen[date + en]) return;
      seen[date + en] = 1;
      out.push(Object.assign({ date, en }, kc >= 0 && kh ? { kh } : {}));
    });
    return out;
  }

  function setShifts() {
    const list = S.shifts || [];
    const e = ST.edit && ST.edit.shift ? ST.edit : null;
    return `<section class="card">${list.map(s => li(`<b>${esc(s.name)}</b><small>${esc(s.from)} – ${esc(s.to)}${s.brk ? ' · ' + t('សម្រាក', 'Break') + ' ' + esc(s.brk) : ''}</small>`, `<button type="button" class="btn sm" data-sed="${s.row}">✏️</button>`)).join('')}</section>
      <section class="card"><h2>${e ? '✏️ ' + t('កែវេន', 'Edit shift') : '＋ ' + t('បន្ថែមវេន', 'Add shift')}</h2>
        <div class="field"><label class="f" for="sName">${t('ឈ្មោះវេន', 'Shift name')}</label><input class="in" id="sName" value="${esc(e ? e.name : '')}"></div>
        <div class="row2"><div class="field"><label class="f" for="sFrom">${t('ចាប់ពី', 'From')}</label><input class="in" id="sFrom" placeholder="7:00 AM" value="${esc(e ? e.from : '')}"></div>
          <div class="field"><label class="f" for="sTo">${t('ដល់', 'To')}</label><input class="in" id="sTo" placeholder="4:00 PM" value="${esc(e ? e.to : '')}"></div></div>
        <div class="field"><label class="f" for="sBrk">${t('សម្រាក', 'Break')}</label><input class="in" id="sBrk" placeholder="1 Hour" value="${esc(e ? e.brk : '')}"></div>
        <div class="oa-btns"><button type="button" class="btn ok" id="sSave">${t('រក្សាទុក', 'Save')}</button>${e ? `<button type="button" class="btn" id="sCancel">${t('បោះបង់', 'Cancel')}</button>` : ''}</div>
        <p class="hint">${t('វេនស្ថិតនៅក្នុង Master Data (Working Shift)។', 'Shifts live in Master Data (Working Shift).')}</p></section>`;
  }
  function wireShifts() {
    const list = S.shifts || [];
    const e = ST.edit && ST.edit.shift ? ST.edit : null;
    $$('[data-sed]').forEach(b => b.onclick = () => { ST.edit = Object.assign({ shift: 1 }, list.find(x => x.row === +b.dataset.sed)); renderSetting(); const n = $('#sName'); if (n) n.scrollIntoView({ block: 'center' }); });
    if ($('#sCancel')) $('#sCancel').onclick = () => { ST.edit = null; renderSetting(); };
    $('#sSave').onclick = () => save($('#sSave'), Object.assign({ kind: 'shift', name: $('#sName').value.trim(), from: $('#sFrom').value.trim(), to: $('#sTo').value.trim(), brk: $('#sBrk').value.trim() }, e ? { row: e.row, was: e.name } : {}));
  }

  function setLog() {
    const list = S.log || [];
    return `<section class="card tm-log">${list.map(x => `<div class="tm-li"><span class="tm-chip${x.event === 'ADMIN_FIX' ? ' warn' : ''}">${x.event === 'ADMIN_FIX' ? t('កែសំណើ', 'Fix') : t('ការកំណត់', 'Setting')}</span><div><b>${esc(x.detail)}</b><small>${esc(x.by)} · ${esc(showTime(x.time))}${x.reqId ? ' · ' + esc(x.reqId) : ''}</small></div></div>`).join('')
      || `<p class="hint center" style="margin:6px 0">${t('មិនទាន់មានការផ្លាស់ប្តូរ។', 'No changes yet.')}</p>`}</section>`;
  }

  window.OT_ADMIN = { tiles };
})();
