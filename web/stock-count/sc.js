// Stock Count: digital stock card per bin. Flow: scan bin > SKU and qty on hand > bundles + pieces > submit > result.
(function () {
  'use strict';
  const CFG = window.SC_CONFIG || {};
  const DEMO = !CFG.API_URL;
  const TOKEN_KEY = 'fr_id_token';
  const QUEUE_KEY = 'sc_queue';
  const T = (km, en) => LANG.t(km, en);
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const jget = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };

  // Same rules as apps-script-stock-count/rules.gs (keep in step).
  const countedPcs = (b, ppb, p) => (Number(b) || 0) * (Number(ppb) || 1) + (Number(p) || 0);
  const statusOf = (diff, tol) => (Math.abs(diff) <= (Number(tol) || 0) ? 'MATCH' : diff < 0 ? 'SHORT' : 'OVER');
  const needsPhoto = s => s === 'SHORT' || s === 'OVER';
  const whole = v => v !== '' && v != null && isFinite(Number(v)) && Number(v) >= 0 && Math.floor(Number(v)) === Number(v);

  const DEMO_BINS = [
    { bin: 'A-01-01', warehouse: 'WH IB', sku: 'SK-1001', desc: 'Steel bar 12mm', uom: 'PC', pcsPerBundle: 50, book: 1200, lastCount: '', lastStatus: '', accuracy: null },
    { bin: 'A-01-02', warehouse: 'WH IB', sku: 'SK-1002', desc: 'Steel bar 16mm', uom: 'PC', pcsPerBundle: 30, book: 600, lastCount: '2026-11-10 09:12', lastStatus: 'MATCH', accuracy: 90 },
    { bin: 'B-02-05', warehouse: 'WH OB', sku: 'SK-2044', desc: 'Angle 50x50', uom: 'PC', pcsPerBundle: 20, book: 340, lastCount: '2026-11-08 14:30', lastStatus: 'SHORT', accuracy: 60 },
    { bin: 'C-03-01', warehouse: 'WH BDM', sku: 'SK-3310', desc: 'Pipe 2 inch', uom: 'PC', pcsPerBundle: 10, book: 90, lastCount: '2026-11-11 11:05', lastStatus: 'OVER', accuracy: 70 },
  ];

  const S = { bins: [], user: null, view: 'home', cur: null, photo: '', result: null, signedOut: false };

  // ------------------------------------------------------------------ Apps Script (same sign-in as every iSteel app)
  function claims() {
    try { return JSON.parse(decodeURIComponent(escape(atob((get(TOKEN_KEY) || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch (e) { return null; }
  }
  const signedIn = () => { const c = claims(); return !!(c && c.exp * 1000 > Date.now() + 60000); };
  const msgOf = e => {
    const s = String(e || 'Error');
    const m = s.match(/^([A-Z_]+):\s*([\s\S]*)$/);
    const txt = m ? m[2] : s;
    const p = txt.split(' || ');
    return { code: m ? m[1] : '', text: T(p[1] || p[0], p[0]) };
  };
  async function api(action, payload) {
    let data;
    try {
      const res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: get(TOKEN_KEY), payload: payload || {} }) });
      data = await res.json();
    } catch (e) {
      throw Object.assign(new Error(T('មិនអាចភ្ជាប់អ៊ីនធឺណិត។ សូមព្យាយាមម្តងទៀត។', 'No connection. Please try again.')), { code: 'NET' });
    }
    if (!data.ok) { const m = msgOf(data.error); throw Object.assign(new Error(m.text), { code: m.code }); }
    if (data.session) put(TOKEN_KEY, data.session);
    return data.data;
  }

  // ------------------------------------------------------------------ small helpers
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }
  const view = html => { $('#view').innerHTML = html; };
  const queue = () => jget(QUEUE_KEY, []);
  const saveQueue = q => put(QUEUE_KEY, JSON.stringify(q));
  const accText = a => (a == null ? '—' : a + '%');
  const shortDate = s => (s ? s.slice(5, 16) : T('ยังไม่เคย', 'Never'));
  function statusLabel(s) {
    return { MATCH: T('ត្រូវ', 'Match'), SHORT: T('ខ្វះ', 'Short'), OVER: T('លើស', 'Over') }[s] || '';
  }

  // Shrinks a phone photo before sending it (keeps the upload small and fast).
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // ------------------------------------------------------------------ boot and queue
  async function boot() {
    if (DEMO) { S.bins = DEMO_BINS.map(b => Object.assign({}, b)); S.user = { name: 'Demo' }; return route(); }
    if (!signedIn()) { S.signedOut = true; return route(); }
    try {
      const b = await api('boot');
      S.user = b.user; S.bins = b.today || []; S.binCount = b.binCount;
      S.signedOut = false;
      await flush();
    } catch (e) {
      if (e.code === 'AUTH') S.signedOut = true;
      else if (e.code === 'NOACCESS') S.blocked = e.message;
      else toast(e.message);
    }
    route();
  }

  // Counts saved on the phone while offline are sent when the connection comes back.
  async function flush() {
    if (DEMO) return;
    let q = queue();
    if (!q.length) return;
    const left = [];
    for (const item of q) {
      try { await api('submit', { count: item }); }
      catch (e) { if (e.code === 'NET') left.push(item); else toast(e.message); }
    }
    saveQueue(left);
    if (q.length !== left.length) toast(T('បានផ្ញើការរាប់ដែលរក្សាទុកក្នុងទូរស័ព្ទ', 'Saved counts sent'));
  }
  window.addEventListener('online', () => { flush().then(() => route()); });
  window.SC_REFRESH = () => { boot(); };

  // ------------------------------------------------------------------ screens
  function route() {
    paintHeader();
    if (S.signedOut) return blockedScreen(T('សូមចូលគណនីនៅទំព័រដើម', 'Please sign in on the home menu'), T('ការចូលបានផុតកំណត់ ឬមិនទាន់ចូល', 'Not signed in or sign-in expired'));
    if (S.blocked) return blockedScreen(T('មិនទាន់មានសិទ្ធិ', 'No access yet'), S.blocked);
    if (S.view === 'count' && S.cur) return countScreen();
    if (S.view === 'result' && S.result) return resultScreen();
    return homeScreen();
  }
  function paintHeader() {
    $('#demo').hidden = !DEMO;
    $('#demo').textContent = DEMO ? T('ដំណើរការសាកល្បង: មិនទាន់រក្សាទុកទៅ Google Sheet', 'Demo mode: nothing is saved to the Google Sheet yet') : '';
  }
  function blockedScreen(title, text) {
    view(`<div class="card blocked"><div class="emoji">🔒</div><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <a class="btn" href="../">${T('ទៅទំព័រដើម', 'Go to the home menu')}</a></div>`);
  }

  function homeScreen() {
    const q = queue();
    const list = S.bins.map(b => `<button type="button" class="item" data-bin="${esc(b.bin)}">
        <span><span class="bin">${esc(b.bin)}</span><br><span class="sku">${esc(b.sku)} · ${esc(b.desc)}</span><br>
        <span class="muted">${esc(b.warehouse)} · ${T('បានរាប់ចុងក្រោយ', 'last counted')}: ${esc(shortDate(b.lastCount))}</span></span>
        <span class="acc">${accText(b.accuracy)}<small>${T('ភាពត្រឹមត្រូវ', 'accuracy')}</small></span></button>`).join('');
    view(`
      <section class="card">
        <label for="binIn">${T('ស្កេន ឬវាយកូដកុងតឺន័រ', 'Scan or type bin code')}</label>
        <div class="row">
          <input id="binIn" type="text" autocomplete="off" autocapitalize="characters" placeholder="A-01-01">
          <button type="button" class="btn" id="goBin">${T('ទៅ', 'Go')}</button>
          <label class="btn ghost shrink" for="camIn" style="margin:0;cursor:pointer" title="Camera">📷<input id="camIn" type="file" accept="image/*" capture="environment" hidden></label>
        </div>
        <p class="muted" id="binMsg"></p>
      </section>
      ${q.length ? `<div class="card"><span class="pill">${q.length} ${T('រង់ចាំផ្ញើ', 'waiting to send')}</span> <button type="button" class="btn ghost" id="sendQ">${T('ផ្ញើឥឡូវ', 'Send now')}</button></div>` : ''}
      <h2>${T('បញ្ជីរាប់ថ្ងៃនេះ', "Today's count list")} (${S.bins.length ? S.bins.length : 0})</h2>
      ${list || `<p class="muted">${T('មិនទាន់មានកុងតឺន័រ។ ឲ្យ Kim បន្ថែមក្នុង Bin Master។', 'No bins yet. Kim adds them in Bin Master.')}</p>`}
    `);
    const go = () => {
      const code = $('#binIn').value.trim();
      if (code) openBin(code);
    };
    $('#goBin').onclick = go;
    $('#binIn').onkeydown = e => { if (e.key === 'Enter') go(); };
    $('#camIn').onchange = scanPhoto;
    $('#sendQ') && ($('#sendQ').onclick = () => flush().then(route));
    document.querySelectorAll('[data-bin]').forEach(el => { el.onclick = () => openBin(el.dataset.bin); });
  }

  // Reads a bin barcode from a photo when the phone supports it; otherwise the user types the code.
  async function scanPhoto(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const msg = $('#binMsg');
    if (!('BarcodeDetector' in window)) { msg.textContent = T('ទូរស័ព្ទនេះស្កេនមិនបាន។ សូមវាយកូដ។', 'This phone cannot read barcodes. Please type the code.'); return; }
    try {
      const bmp = await createImageBitmap(f);
      const found = await new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] }).detect(bmp);
      if (found.length) return openBin(found[0].rawValue.trim());
      msg.textContent = T('រកមិនឃើញកូដ។ សូមថតឲ្យជិតជាង។', 'No code found. Try again, closer.');
    } catch (err) { msg.textContent = T('ស្កេនមិនបាន។ សូមវាយកូដ។', 'Scan failed. Please type the code.'); }
  }

  async function openBin(code) {
    const key = code.toUpperCase();
    let b = S.bins.find(x => x.bin.toUpperCase() === key) || null;
    if (!b && DEMO) { const d = DEMO_BINS.find(x => x.bin.toUpperCase() === key); b = d ? Object.assign({}, d) : null; }
    if (!b && !DEMO) {
      try { b = await api('bin', { bin: code }); }
      catch (e) { if (e.code === 'AUTH') S.signedOut = true; toast(e.message); return; }
    }
    if (!b) { toast(T('រកមិនឃើញកុងតឺន័រនេះ', 'Bin not found')); return; }
    S.cur = b; S.view = 'count'; S.photo = '';
    route();
  }

  function countScreen() {
    const b = S.cur;
    const ppb = b.pcsPerBundle || 1;
    view(`
      <section class="card hero">
        <div class="bin">${esc(b.bin)}</div>
        <div class="desc">${esc(b.sku)} · ${esc(b.desc)}</div>
        <div class="muted">${esc(b.warehouse)} · ${esc(b.uom)} · ${T('១ កញ្ចប់', '1 bundle')} = ${ppb} ${esc(b.uom)}</div>
        <div class="kv">
          <div><span class="muted">${T('ចំនួនក្នុងសៀវភៅ', 'Qty on hand (book)')}</span><b>${b.book}</b></div>
          <div><span class="muted">${T('ភាពត្រឹមត្រូវ', 'Accuracy')}</span><b>${accText(b.accuracy)}</b></div>
        </div>
      </section>
      <section class="card">
        <div class="fields">
          <div><label for="qB">${T('ចំនួនកញ្ចប់', 'Qty in bundle')}</label><input id="qB" type="number" inputmode="numeric" min="0" step="1"></div>
          <div><label for="qP">${T('ចំនួនបំណែក', 'Qty in piece')}</label><input id="qP" type="number" inputmode="numeric" min="0" step="1"></div>
        </div>
        <div class="live" id="live">${T('រាប់បាន', 'Counted')}: — ${esc(b.uom)}</div>
        <div id="photoBox" hidden>
          <div class="photo" id="photoRow">
            <label class="btn ghost shrink" for="photoIn" style="margin:0;cursor:pointer">📷 ${T('ថតរូប', 'Take photo')}<input id="photoIn" type="file" accept="image/*" capture="environment" hidden></label>
            <img id="photoPrev" alt="" hidden>
            <span class="need-text" id="needTxt"></span>
          </div>
        </div>
        <label for="note">${T('កំណត់ចំណាំ (ស្រេចចិត្ត)', 'Note (optional)')}</label>
        <input id="note" type="text" maxlength="200">
        <div style="height:12px"></div>
        <button type="button" class="btn big" id="submit">${T('បញ្ជូនការរាប់', 'Submit count')}</button>
        <div class="row" style="margin-top:10px"><button type="button" class="btn ghost" id="back">${T('ត្រឡប់', 'Back')}</button></div>
      </section>`);
    const qB = $('#qB'), qP = $('#qP');
    const refresh = () => {
      const bad = !whole(qB.value) || !whole(qP.value);
      const counted = countedPcs(qB.value || 0, ppb, qP.value || 0);
      const filled = qB.value !== '' && qP.value !== '';
      const diff = counted - b.book;
      const st = filled ? statusOf(diff, 0) : '';
      $('#live').innerHTML = filled && !bad
        ? `${T('រាប់បាន', 'Counted')}: <b>${counted}</b> ${esc(b.uom)} · ${T('ខុសគ្នា', 'Difference')}: <span class="diff-${st}">${diff > 0 ? '+' : ''}${diff}</span> · <span class="badge ${st}">${statusLabel(st)}</span>`
        : `${T('រាប់បាន', 'Counted')}: — ${esc(b.uom)}`;
      const needPhoto = filled && !bad && needsPhoto(st);
      $('#photoBox').hidden = !needPhoto;
      $('#photoRow').classList.toggle('need', needPhoto && !S.photo);
      $('#needTxt').textContent = needPhoto && !S.photo ? T('ត្រូវថតរូបមុនបញ្ជូន', 'Photo needed before submit') : '';
    };
    qB.oninput = qP.oninput = refresh;
    $('#photoIn').onchange = async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try { S.photo = await shrink(f); } catch (err) { toast(T('មិនអាចប្រើរូបនេះបាន', 'Cannot use this photo')); return; }
      $('#photoPrev').src = S.photo; $('#photoPrev').hidden = false;
      refresh();
    };
    $('#back').onclick = () => { S.view = 'home'; S.cur = null; route(); };
    $('#submit').onclick = submitCount;
    refresh();
  }

  async function submitCount() {
    const b = S.cur;
    const qB = $('#qB').value, qP = $('#qP').value;
    if (!whole(qB) || !whole(qP)) { toast(T('បញ្ចូលចំនួនជាលេខគត់ (0 បាន)', 'Enter whole numbers (0 is allowed)')); return; }
    const counted = countedPcs(qB, b.pcsPerBundle, qP);
    const diff = counted - b.book;
    const status = statusOf(diff, 0);
    if (needsPhoto(status) && !S.photo) { toast(T('ត្រូវថតរូបមុន', 'Take a photo first')); return; }
    const count = { bin: b.bin, bundles: Number(qB), pieces: Number(qP), note: $('#note').value.trim(), photo: S.photo, clientId: Date.now() + '' };
    const btn = $('#submit'); btn.disabled = true;
    let res;
    if (DEMO) {
      res = { id: 'DEMO-' + count.clientId.slice(-5), status, diff, counted, book: b.book, uom: b.uom, sku: b.sku, desc: b.desc, accuracy: b.accuracy };
    } else {
      try {
        res = await api('submit', { count });
        S.bins = S.bins.filter(x => x.bin !== b.bin);   // counted now, so it leaves today's list
      } catch (e) {
        btn.disabled = false;
        if (e.code === 'NET') {
          saveQueue(queue().concat([count]));
          res = { id: 'PHONE', status, diff, counted, book: b.book, uom: b.uom, sku: b.sku, desc: b.desc, accuracy: b.accuracy, offline: true };
        } else if (e.code === 'AUTH') { S.signedOut = true; route(); return; }
        else { toast(e.message); return; }
      }
    }
    S.result = res; S.view = 'result'; S.cur = b; S.photo = '';
    route();
  }

  function resultScreen() {
    const r = S.result;
    const b = S.cur;
    const sign = r.diff > 0 ? '+' : '';
    view(`
      <section class="card hero" style="text-align:center">
        <div class="emoji" style="font-size:44px">${r.status === 'MATCH' ? '✅' : r.status === 'SHORT' ? '⚠️' : '🔶'}</div>
        <span class="badge ${r.status}">${statusLabel(r.status)}</span>
        <div class="bin" style="margin-top:8px">${esc(b.bin)}</div>
        <div class="desc">${esc(r.sku)} · ${esc(r.desc)}</div>
        <div class="kv">
          <div><span class="muted">${T('ក្នុងសៀវភៅ', 'Book')}</span><b>${r.book}</b></div>
          <div><span class="muted">${T('រាប់បាន', 'Counted')}</span><b>${r.counted}</b></div>
          <div><span class="muted">${T('ខុសគ្នា', 'Difference')}</span><b class="diff-${r.status}">${sign}${r.diff}</b></div>
          <div><span class="muted">${T('ភាពត្រឹមត្រូវ', 'Accuracy')}</span><b>${accText(r.accuracy)}</b></div>
        </div>
        ${r.offline ? `<p class="muted" style="margin-top:10px">${T('បានរក្សាទុកក្នុងទូរស័ព្ទ។ នឹងផ្ញើនៅពេលមានអ៊ីនធឺណិត។', 'Saved on this phone. It will be sent when you are online.')}</p>` : ''}
        ${r.id && r.id !== 'PHONE' ? `<p class="muted">${esc(r.id)}</p>` : ''}
      </section>
      <button type="button" class="btn big ok" id="next">${T('បន្ទាប់', 'Next bin')}</button>
      <div style="height:10px"></div>
      <button type="button" class="btn ghost big" id="home">${T('ត្រឡប់ទៅបញ្ជី', 'Back to list')}</button>`);
    $('#next').onclick = () => { S.view = 'home'; S.result = null; S.cur = null; route(); const first = S.bins[0]; if (first) openBin(first.bin); };
    $('#home').onclick = () => { S.view = 'home'; S.result = null; S.cur = null; route(); };
  }

  // ------------------------------------------------------------------ start
  window.addEventListener('DOMContentLoaded', () => {
    LANG.button($('#langBtn'));
    LANG.onChange(() => route());
    const dark = $('#themeBtn');
    const paintTheme = () => { dark.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙'; };
    dark.onclick = () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next); put('fr_theme', next); paintTheme();
    };
    paintTheme();
    boot();
  });
})();
