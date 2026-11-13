// "Request to Admin" screen, shared by the home menu and the Fuel app, for a Gmail that is signed in but not allowed yet.
// New server (Kim, 31 Oct 2026): type the Employee ID → their details show with the names partly hidden → Send.
// Found and no Gmail on the ID yet = access at once; otherwise, or with an Employee Card photo instead, an admin decides.
// An older server gets the older form (full name, employee ID, department).
// Usage: AccessRequest.open({ call: (action, payload) => Promise, onDone: status => {} })
(function () {
  'use strict';
  const t = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const EMP_MIN = 100000, EMP_MAX = 190000;   // employee ID range (Kim, 10 Oct 2026); the server checks it too
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Icons sit next to this file: request.js on the home menu, ../request.js in the apps.
  const BASE = (() => { const s = document.currentScript && document.currentScript.src; return s ? s.replace(/request\.js(\?.*)?$/, '') : ''; })();
  const APP_NAMES = {
    fuel: ['ចាក់សាំង', 'Fuel'], transport: ['ដឹកជញ្ជូន', 'Delivery'], overtime: ['ថែមម៉ោង', 'Overtime'], location: ['ទីតាំងថ្មី', 'Location'],
    meeting: ['ប្រជុំ', 'Meetings'], incident: ['គ្រោះថ្នាក់', 'Incident'], inbound: ['ទទួលទំនិញ', 'Inbound'], dashboard: ['Dashboard', 'Dashboard'],
  };
  const appsHTML = keys => `<div class="arq-apps">${(keys || []).map(k => `<div><img src="${BASE}icons/${esc(k)}.svg" alt="" width="30" height="30">${esc(t((APP_NAMES[k] || [k, k])[0], (APP_NAMES[k] || [k, k])[1]))}</div>`).join('')}</div>`;
  const digits = v => String(v || '').replace(/[០-៩]/g, x => String('០១២៣៤៥៦៧៨៩'.indexOf(x))).replace(/\D/g, '');
  // The card photo is made smaller on the phone (longest side 1280 px) so it sends fast.
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('បើករូបមិនបាន', 'Could not open the photo'))); };
      img.src = url;
    });
  }

  const CSS = `
.arq-bg { position: fixed; inset: 0; z-index: 60; background: rgba(1,30,65,.45); display: flex; align-items: flex-end; justify-content: center; opacity: 0; transition: opacity .18s; }
.arq-bg.open { opacity: 1; }
.arq { --c-card: #fff; --c-text: #011e41; --c-muted: #546274; --c-line: #d6dee8; --c-brand: #084f6a; --c-soft: #d4e1f5; --c-bad: #b3261e; --c-bad-soft: #fbe9e7; --c-ok: #1e7b46; --c-ok-soft: #e3f4ea;
  width: 100%; max-width: 480px; max-height: 92vh; overflow: auto; background: var(--c-card); color: var(--c-text); border-radius: 20px 20px 0 0;
  padding: 18px 18px calc(18px + env(safe-area-inset-bottom)); transform: translateY(24px); transition: transform .18s; font: inherit; text-align: left; }
.arq-bg.open .arq { transform: none; }
@media (min-width: 560px) { .arq-bg { align-items: center; } .arq { border-radius: 20px; } }
:root[data-theme="dark"] .arq { --c-card: #0d1e32; --c-text: #e6eef7; --c-muted: #9cb0c6; --c-line: #213852; --c-brand: #61cbf4; --c-soft: #112d48; --c-bad: #f28b82; --c-bad-soft: #3a1c1a; --c-ok: #5cc98a; --c-ok-soft: #173327; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arq { --c-card: #0d1e32; --c-text: #e6eef7; --c-muted: #9cb0c6; --c-line: #213852; --c-brand: #61cbf4; --c-soft: #112d48; --c-bad: #f28b82; --c-bad-soft: #3a1c1a; --c-ok: #5cc98a; --c-ok-soft: #173327; } }
.arq h2 { margin: 0 0 4px; font-size: 19px; }
.arq .arq-sub { margin: 0 0 14px; color: var(--c-muted); font-size: 14px; }
.arq label { display: block; margin: 0 0 12px; }
.arq label > span { display: block; font-size: 14px; font-weight: 600; margin-bottom: 5px; }
.arq label > span i { color: var(--c-bad); font-style: normal; }
.arq input, .arq select { width: 100%; box-sizing: border-box; min-height: 46px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--c-line);
  background: var(--c-card); color: var(--c-text); font: inherit; font-size: 16px; }
.arq input:focus, .arq select:focus { outline: 2px solid var(--c-brand); outline-offset: 0; border-color: transparent; }
.arq input[readonly] { background: var(--c-soft); color: var(--c-muted); }
.arq .arq-btns { display: flex; gap: 10px; margin-top: 6px; }
.arq .arq-btns button { flex: 1; min-height: 48px; border-radius: 12px; font: inherit; font-weight: 700; cursor: pointer; border: 1px solid var(--c-line); background: var(--c-card); color: var(--c-text); }
.arq .arq-btns .go { background: var(--c-brand); border-color: var(--c-brand); color: #fff; }
:root[data-theme="dark"] .arq .arq-btns .go { color: #011e41; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arq .arq-btns .go { color: #011e41; } }
.arq .arq-btns button:disabled { opacity: .6; }
.arq .arq-msg { border-radius: 12px; padding: 10px 12px; margin: 0 0 12px; font-size: 14px; }
.arq .arq-msg.bad { background: var(--c-bad-soft); color: var(--c-bad); }
.arq .arq-msg.ok { background: var(--c-ok-soft); color: var(--c-ok); }
.arq .arq-spin { width: 30px; height: 30px; margin: 30px auto; border: 3px solid var(--c-line); border-top-color: var(--c-brand); border-radius: 50%; animation: arqspin .8s linear infinite; }
@keyframes arqspin { to { transform: rotate(360deg); } }
.arq .arq-row { display: flex; gap: 8px; }
.arq .arq-row input { flex: 1; min-width: 0; font-size: 20px; letter-spacing: 1px; }
.arq .arq-row button { min-height: 46px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--c-brand); background: var(--c-brand); color: #fff; font: inherit; font-weight: 700; cursor: pointer; white-space: nowrap; }
.arq .arq-row button.lite { background: var(--c-card); border-color: var(--c-line); color: var(--c-text); }
:root[data-theme="dark"] .arq .arq-row button:not(.lite) { color: #011e41; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arq .arq-row button:not(.lite) { color: #011e41; } }
.arq .arq-hint { font-size: 13px; color: var(--c-muted); margin: 6px 0 0; }
.arq input.need, .arq select.need { border: 2px solid var(--c-bad); background: var(--c-bad-soft); }
.arq .arq-or { display: flex; align-items: center; gap: 10px; color: var(--c-muted); font-size: 13px; margin: 16px 0 10px; }
.arq .arq-or::before, .arq .arq-or::after { content: ''; flex: 1; border-top: 1px dashed var(--c-line); }
.arq .arq-link { display: block; width: 100%; background: none; border: 0; color: var(--c-brand); font: inherit; font-weight: 700; cursor: pointer; padding: 6px; text-align: center; }
.arq .arq-dash { display: block; width: 100%; min-height: 48px; border: 1.5px dashed var(--c-brand); background: var(--c-soft); color: var(--c-brand); border-radius: 12px; font: inherit; font-weight: 700; cursor: pointer; }
.arq .arq-center { text-align: center; color: var(--c-muted); font-size: 13px; }
.arq .arq-who { display: flex; gap: 12px; border: 1.5px solid var(--c-ok); background: var(--c-ok-soft); border-radius: 14px; padding: 12px; margin: 10px 0 12px; }
.arq .arq-who .tick { flex: none; width: 30px; height: 30px; border-radius: 50%; background: var(--c-ok); color: #fff; display: grid; place-items: center; font-weight: 700; }
.arq .arq-who b { display: block; font-size: 18px; }
.arq .arq-who .en { font-weight: 700; margin-bottom: 6px; }
.arq .arq-kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 14px; }
.arq .arq-kv span { color: var(--c-muted); }
.arq .arq-warn { border-radius: 12px; padding: 10px 12px; margin: 0 0 12px; font-size: 14px; background: #fff4d6; color: #7a5200; }
:root[data-theme="dark"] .arq .arq-warn { background: #3a2f12; color: #f5d28a; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .arq .arq-warn { background: #3a2f12; color: #f5d28a; } }
.arq .arq-sec { font-size: 14px; font-weight: 600; margin: 4px 0 8px; }
.arq .arq-sec small { color: var(--c-muted); font-weight: 400; }
.arq .arq-apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 8px; margin-bottom: 12px; }
.arq .arq-apps div { background: var(--c-soft); border-radius: 12px; padding: 8px 4px; text-align: center; font-size: 11px; line-height: 1.3; }
.arq .arq-apps img { display: block; margin: 0 auto 4px; }
.arq .arq-card { position: relative; border-radius: 14px; background: #1f2d3d; min-height: 170px; display: grid; place-items: center; overflow: hidden; margin-bottom: 12px; cursor: pointer; border: 0; width: 100%; color: #fff; font: inherit; }
.arq .arq-card img { width: 100%; max-height: 260px; object-fit: contain; display: block; }
.arq .arq-card .cam { font-size: 40px; display: block; }
.arq .arq-card .again { position: absolute; right: 10px; bottom: 10px; background: #fff; color: #011e41; border-radius: 999px; padding: 4px 12px; font-size: 13px; font-weight: 700; }
.arq .arq-card.need { outline: 3px solid var(--c-bad); }
.arq .arq-big { font-size: 56px; text-align: center; margin: 6px 0; }
.arq h2.c, .arq p.c { text-align: center; }
`;

  function open(opts) {
    if (!document.getElementById('arq-css')) {
      const st = document.createElement('style');
      st.id = 'arq-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    const bg = document.createElement('div');
    bg.className = 'arq-bg';
    bg.innerHTML = `<div class="arq" role="dialog" aria-modal="true"><div class="arq-spin"></div></div>`;
    const box = bg.querySelector('.arq');
    const onKey = e => { if (e.key === 'Escape') close(); };
    function close() {
      document.removeEventListener('keydown', onKey);
      bg.classList.remove('open');
      setTimeout(() => bg.remove(), 200);
    }
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    requestAnimationFrame(() => bg.classList.add('open'));

    // The form's details come from the server; an older server without "requestForm" still gets a form, with a typed department.
    opts.call('requestForm').catch(e => (/Unknown action/i.test(e.message) ? {} : Promise.reject(e))).then(d => {
      if (d.status === 'active') { done('active'); return; }
      if (d.v >= 2) { F = d; idScreen(); } else form(d);
    }).catch(e => {
      box.innerHTML = `<div class="arq-msg bad">${esc(e.message)}</div><div class="arq-btns"><button type="button" data-x>${t('បិទ', 'Close')}</button></div>`;
      box.querySelector('[data-x]').onclick = close;
    });


    // ---------------- Employee ID screens (server v2) ----------------
    let F = null;          // requestForm answer
    let found = null;      // last ID search answer
    let card = { name: '', fn: '', photo: '' };
    const fnSelect = (id, val, need) => `<select id="${id}" class="${need ? 'need' : ''}"><option value="">${t('— ជ្រើសរើស —', '— Choose —')}</option>${(F.functions || []).map(x => `<option${x === val ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
    const err = html => { const b = box.querySelector('.arq-err'); if (b) b.innerHTML = html ? `<div class="arq-msg bad">${html}</div>` : ''; };
    const head = (icon, title, sub) => `<h2>${icon} ${title}</h2>${sub ? `<p class="arq-sub">${sub}</p>` : ''}`;

    function idScreen(typed, notFound) {
      found = null;
      box.innerHTML = `${head('📨', t('ស្នើសុំប្រើកម្មវិធី', 'Request access'), t('វាយលេខសម្គាល់បុគ្គលិក (ID) របស់អ្នក ដើម្បីរកព័ត៌មានរបស់អ្នក', 'Type your Employee ID to find your details'))}
        ${F.email ? `<label><span>${t('អ៊ីមែល', 'Email')}</span><input value="${esc(F.email)}" readonly></label>` : ''}
        <form novalidate><label><span>${t('លេខសម្គាល់បុគ្គលិក', 'Employee ID')} <i>*</i></span>
          <div class="arq-row"><input name="id" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="${esc(F.idMin || 100000)}" value="${esc(typed || '')}" class="${notFound ? 'need' : ''}">
          <button type="submit">🔍 ${t('ស្វែងរក', 'Search')}</button></div></label>
          <p class="arq-hint">${t('លេខ 6 ខ្ទង់ នៅលើកាតបុគ្គលិក · ឧ. 104836', 'The 6 digits on your Employee Card · e.g. 104836')}</p></form>
        <div class="arq-err">${notFound ? `<div class="arq-msg bad">❌ ${t(`រកមិនឃើញលេខ <b>${esc(typed)}</b> ក្នុងបញ្ជីបុគ្គលិក។ សូមពិនិត្យលេខម្តងទៀត។`, `Employee ID <b>${esc(typed)}</b> is not in the list. Please check the number.`)}</div>` : ''}</div>
        ${notFound
          ? `<div class="arq-or">${t('ឬ', 'or')}</div><button type="button" class="arq-dash" data-card>📷 ${t('ផ្ញើដោយគ្មាន ID · ថតកាតបុគ្គលិក', 'Send without ID · photo of Employee Card')}</button>
             <p class="arq-center">${t('Admin នឹងពិនិត្យកាត រួចអនុញ្ញាត', 'An admin checks the card, then allows you')}</p>`
          : `<div class="arq-or"></div><p class="arq-center">${t('រកលេខ ID មិនឃើញ?', 'Can\'t find your ID?')}</p><button type="button" class="arq-link" data-card>📷 ${t('ផ្ញើដោយថតកាតបុគ្គលិក', 'Send with a photo of your Employee Card')}</button>`}
        <div class="arq-btns"><button type="button" data-x>${t('បោះបង់', 'Cancel')}</button></div>`;
      const f = box.querySelector('form');
      box.querySelector('[data-x]').onclick = close;
      box.querySelector('[data-card]').onclick = () => cardScreen();
      f.id.addEventListener('input', () => { const v = digits(f.id.value); if (v !== f.id.value) f.id.value = v; f.id.classList.remove('need'); });
      setTimeout(() => f.id.focus(), 250);
      f.onsubmit = async e => {
        e.preventDefault();
        const id = digits(f.id.value);
        if (id.length < 4) { f.id.classList.add('need'); err(t('សូមវាយលេខសម្គាល់បុគ្គលិក', 'Please type your Employee ID')); f.id.focus(); return; }
        const btn = f.querySelector('button');
        btn.disabled = true; btn.innerHTML = `<span class="arq-spin" style="width:16px;height:16px;margin:0;display:inline-block;border-width:2px;vertical-align:middle"></span>`;
        try {
          const r = await opts.call('findEmployee', { id });
          if (!r.found) { idScreen(id, true); return; }
          foundScreen(r);
        } catch (x) {
          btn.disabled = false; btn.innerHTML = `🔍 ${t('ស្វែងរក', 'Search')}`;
          err(esc(x.message));
        }
      };
    }

    function foundScreen(r, tried) {
      found = r;
      const pick = r.pick || '';
      const apps = r.fnOk ? r.apps : (F.fnApps || {})[pick] || [];
      box.innerHTML = `${head('📨', t('ស្នើសុំប្រើកម្មវិធី', 'Request access'))}
        <label><span>${t('លេខសម្គាល់បុគ្គលិក', 'Employee ID')}</span>
          <div class="arq-row"><input value="${esc(r.id)}" readonly><button type="button" class="lite" data-edit aria-label="${t('កែ', 'Edit')}">✏️</button></div></label>
        <div class="arq-who"><span class="tick">✓</span><div>
          ${r.kh ? `<b>${esc(r.kh)}</b>` : ''}<div class="${r.kh ? 'en' : 'en'}">${r.kh ? esc(r.name) : `<b>${esc(r.name)}</b>`}</div>
          <div class="arq-kv">
            ${r.dept ? `<span>${t('ផ្នែក', 'Department')}</span><b>${esc(r.dept)}</b>` : ''}
            ${r.fn ? `<span>${t('មុខងារ', 'Function')}</span><b>${esc(r.fn)}</b>` : ''}
            ${r.manager ? `<span>${t('ប្រធាន', 'Manager')}</span><b>${esc(r.manager)}</b>` : ''}
          </div></div></div>
        ${r.fnOk ? '' : `<label><span>${t('ផ្នែក · មុខងារ', 'Department · Function')} <i>*</i></span>${fnSelect('fnPick', pick, tried && !pick)}</label>`}
        ${r.linked ? `<div class="arq-warn">⚠️ ${t('លេខ ID នេះមាន Gmail រួចហើយ។ សំណើនឹងទៅ Admin ពិនិត្យ។', 'This ID already has a Gmail. The request goes to an admin.')}</div>` : ''}
        ${apps.length ? `<div class="arq-sec">${t('កម្មវិធីដែលអ្នកនឹងទទួលបាន', 'Apps you will get')} <small>(${t('តាមមុខងារ', 'by function')})</small></div>${appsHTML(apps)}` : ''}
        <div class="arq-err"></div>
        <button type="button" class="arq-link" data-other>${t('មិនមែនខ្ញុំ? វាយលេខ ID ផ្សេង', 'Not me? Type another ID')}</button>
        <div class="arq-btns"><button type="button" data-x>${t('បោះបង់', 'Cancel')}</button><button type="button" class="go" data-send>📨 ${t('ផ្ញើសំណើ', 'Send request')}</button></div>`;
      box.querySelector('[data-x]').onclick = close;
      box.querySelector('[data-edit]').onclick = () => idScreen(r.id);
      box.querySelector('[data-other]').onclick = () => idScreen('');
      const sel = box.querySelector('#fnPick');
      if (sel) sel.onchange = () => { r.pick = sel.value; foundScreen(r, tried); };
      box.querySelector('[data-send]').onclick = async e => {
        if (!r.fnOk && !r.pick) { foundScreen(r, true); err(t('សូមជ្រើសរើសផ្នែក · មុខងារ', 'Please choose your Department · Function')); return; }
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = t('កំពុងផ្ញើ…', 'Sending…');
        try {
          const res = await opts.call('requestAccess', { mode: 'id', employeeId: r.id, fn: r.fnOk ? '' : r.pick });
          done(res.status, { who: r.kh || r.name, apps: res.apps || apps });
        } catch (x) {
          btn.disabled = false; btn.textContent = '📨 ' + t('ផ្ញើសំណើ', 'Send request');
          err(esc(x.message));
        }
      };
    }

    function cardScreen(tried) {
      box.innerHTML = `${head('📷', t('ផ្ញើដោយកាតបុគ្គលិក', 'Send with Employee Card'), t('ថតរូបកាតបុគ្គលិករបស់អ្នក ឲ្យឃើញឈ្មោះ និងរូបច្បាស់', 'Take a photo of your Employee Card with the name and photo clear'))}
        <button type="button" class="arq-card${tried && !card.photo ? ' need' : ''}" data-shot>${card.photo
          ? `<img src="${card.photo}" alt=""><span class="again">🔁 ${t('ថតម្តងទៀត', 'Retake')}</span>`
          : `<span><span class="cam">📷</span>${t('ចុចដើម្បីថតកាត', 'Tap to take the photo')}</span>`}</button>
        <input type="file" accept="image/*" capture="environment" hidden data-file>
        <label><span>${t('ឈ្មោះពេញ', 'Full name')} <i>*</i></span><input data-name maxlength="100" autocomplete="name" value="${esc(card.name)}" class="${tried && !card.name.trim() ? 'need' : ''}"></label>
        <label><span>${t('ផ្នែក · មុខងារ', 'Department · Function')} <i>*</i></span>${fnSelect('fnCard', card.fn, tried && !card.fn)}</label>
        <div class="arq-err"></div>
        <div class="arq-btns"><button type="button" data-back>${t('ថយក្រោយ', 'Back')}</button><button type="button" class="go" data-send>📨 ${t('ផ្ញើសំណើ', 'Send request')}</button></div>`;
      const file = box.querySelector('[data-file]');
      box.querySelector('[data-shot]').onclick = () => file.click();
      file.onchange = async () => {
        const fl = file.files && file.files[0];
        if (!fl) return;
        try { card.photo = await shrink(fl); cardScreen(tried); } catch (x) { err(esc(x.message)); }
      };
      box.querySelector('[data-name]').oninput = e => { card.name = e.target.value; e.target.classList.toggle('need', !!tried && !card.name.trim()); };
      box.querySelector('#fnCard').onchange = e => { card.fn = e.target.value; e.target.classList.toggle('need', !!tried && !card.fn); };
      box.querySelector('[data-back]').onclick = () => idScreen('');
      box.querySelector('[data-send]').onclick = async e => {
        if (!card.photo || !card.name.trim() || !card.fn) { cardScreen(true); err(t('សូមបំពេញប្រអប់ក្រហម', 'Please fill in the red boxes')); return; }
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = t('កំពុងផ្ញើ…', 'Sending…');
        try {
          const res = await opts.call('requestAccess', { mode: 'card', fullName: card.name.trim(), fn: card.fn, photo: card.photo });
          done(res.status);
        } catch (x) {
          btn.disabled = false; btn.textContent = '📨 ' + t('ផ្ញើសំណើ', 'Send request');
          err(esc(x.message));
        }
      };
    }

    // ---------------- older server: the first form ----------------
    function form(d) {
      const list = d.departments || [];
      box.innerHTML = `
        <h2>📨 ${t('ស្នើសុំទៅអ្នកគ្រប់គ្រង', 'Request to Admin')}</h2>
        <p class="arq-sub">${t('សូមបំពេញព័ត៌មានរបស់អ្នក ដើម្បីឲ្យអ្នកគ្រប់គ្រងអនុញ្ញាត។', 'Fill in your details so the admin can allow you.')}</p>
        <div class="arq-err"></div>
        <form novalidate>
          ${d.email ? `<label><span>${t('អ៊ីមែល', 'Email')}</span><input value="${esc(d.email)}" readonly></label>` : ''}
          <label><span>${t('ឈ្មោះពេញ', 'Full name')} <i>*</i></span>
            <input name="fullName" autocomplete="name" maxlength="100" value="${esc(d.fullName || '')}" required></label>
          <label><span>${t('លេខសម្គាល់បុគ្គលិក', 'Employee ID number')} <i>*</i></span>
            <input name="employeeId" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="${EMP_MIN} – ${EMP_MAX}" value="${esc(d.employeeId || '')}" required></label>
          <label><span>${t('ផ្នែក', 'Department')} <i>*</i></span>
            ${list.length
              ? `<select name="department" required><option value="">${t('— ជ្រើសរើស —', '— Choose —')}</option>${list.map(x => `<option${x === d.department ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`
              : `<input name="department" maxlength="100" value="${esc(d.department || '')}" required>`}</label>
          <div class="arq-btns">
            <button type="button" data-x>${t('បោះបង់', 'Cancel')}</button>
            <button type="submit" class="go">${t('ផ្ញើសំណើ', 'Send request')}</button>
          </div>
        </form>`;
      const f = box.querySelector('form');
      box.querySelector('[data-x]').onclick = close;
      // Numbers only: Khmer digits become 0-9, anything else is dropped as it is typed.
      f.employeeId.addEventListener('input', () => {
        const v = f.employeeId.value.replace(/[០-៩]/g, x => String('០១២៣៤៥៦៧៨៩'.indexOf(x))).replace(/\D/g, '');
        if (v !== f.employeeId.value) f.employeeId.value = v;
      });
      const first = [...f.querySelectorAll('input:not([readonly]),select')].find(x => !x.value);
      if (first) setTimeout(() => first.focus(), 250);
      f.onsubmit = async e => {
        e.preventDefault();
        const p = { fullName: f.fullName.value.trim(), employeeId: f.employeeId.value.trim(), department: f.department.value.trim() };
        const miss = !p.fullName ? f.fullName : !p.employeeId ? f.employeeId : !p.department ? f.department : null;
        if (!miss && !(+p.employeeId >= EMP_MIN && +p.employeeId <= EMP_MAX)) {
          box.querySelector('.arq-err').innerHTML = `<div class="arq-msg bad">${t(`លេខសម្គាល់បុគ្គលិក ត្រូវជាលេខពី ${EMP_MIN} ដល់ ${EMP_MAX}`, `Employee ID must be a number from ${EMP_MIN} to ${EMP_MAX}`)}</div>`;
          f.employeeId.focus();
          return;
        }
        if (miss) {
          box.querySelector('.arq-err').innerHTML = `<div class="arq-msg bad">${t('សូមបំពេញគ្រប់ចន្លោះដែលមានសញ្ញា *', 'Please fill in every field marked *')}</div>`;
          miss.focus();
          return;
        }
        const btn = f.querySelector('.go');
        btn.disabled = true; btn.textContent = t('កំពុងផ្ញើ…', 'Sending…');
        try {
          const r = await opts.call('requestAccess', p);
          done(r.status);
        } catch (err) {
          btn.disabled = false; btn.textContent = t('ផ្ញើសំណើ', 'Send request');
          box.querySelector('.arq-err').innerHTML = `<div class="arq-msg bad">${esc(err.message)}</div>`;
        }
      };
    }

    function done(status, info) {
      info = info || {};
      if (status === 'active' && info.who !== undefined) {
        // Joined with their Employee ID: straight into the apps.
        box.innerHTML = `<div class="arq-big">✅</div><h2 class="c">${t('ចូលប្រើបានហើយ!', 'You\'re in!')}</h2>
          <p class="arq-sub c">${t('សួស្តី', 'Hello')} ${esc(info.who)} · ${t('អ្នកអាចប្រើកម្មវិធីទាំងនេះ', 'you can use these apps')}</p>
          ${appsHTML(info.apps)}
          <div class="arq-btns"><button type="button" class="go" data-x>🏠 ${t('ទៅទំព័រដើម', 'Open the apps')}</button></div>`;
        box.querySelector('[data-x]').onclick = () => { close(); if (opts.onDone) opts.onDone('active', { enter: true }); };
        return;
      }
      box.innerHTML = status === 'active'
        ? `<div class="arq-msg ok">${t('គណនីរបស់អ្នកបានអនុញ្ញាតហើយ។ ចុច ព្យាយាមម្តងទៀត។', 'Your account is already allowed. Tap Try again.')}</div>`
        : `<div class="arq-big">⏳</div><h2 class="c">${t('បានផ្ញើសំណើ', 'Request sent')}</h2>
           <p class="arq-sub c">${t('រង់ចាំ Admin អនុញ្ញាត។ បន្ទាប់មក ចុច ព្យាយាមម្តងទៀត។', 'Wait for an admin to allow you. Then tap Try again.')}</p>`;
      box.insertAdjacentHTML('beforeend', `<div class="arq-btns"><button type="button" class="go" data-x>${t('យល់ព្រម', 'OK')}</button></div>`);
      box.querySelector('[data-x]').onclick = close;
      if (opts.onDone) opts.onDone(status);
    }
  }

  /** The server's "not allowed" messages in the reader's language (the server writes them in English). */
  function notAllowed(msg) {
    const m = String(msg || '');
    let x = /^(\S+@\S+) is not allowed to use this app/.exec(m);
    if (x) return t(`គណនី ${x[1]} មិនទាន់មានសិទ្ធិប្រើកម្មវិធីនេះទេ។ សូមចុច “ស្នើសុំទៅអ្នកគ្រប់គ្រង” ខាងក្រោម។`,
      `${x[1]} is not allowed to use this app yet. Tap “Request to Admin” below.`);
    x = /^(\S+@\S+) has no access to (.+?)\. Ask the admin/.exec(m);
    if (x) return t(`គណនី ${x[1]} មិនទាន់មានសិទ្ធិប្រើ ${x[2]} ទេ។ សូមស្នើអ្នកគ្រប់គ្រងឲ្យធីកវាក្នុង Users sheet។`, m);
    return m;
  }

  window.AccessRequest = { open, notAllowed };
})();
