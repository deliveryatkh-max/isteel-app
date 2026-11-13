// Stock Count: scan a bin, then In / Out / Count. Count and Out work on every SKU line in the bin.
(function () {
  'use strict';
  const CFG = window.SC_CONFIG || {};
  const DEMO = !CFG.API_URL;
  const TOKEN_KEY = 'fr_id_token';
  const QUEUE_KEY = 'sc_queue';
  const CACHE_KEY = 'sc_boot';   // last boot answer, shown at once on the next open
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
  const n0 = v => (v === '' || v == null ? 0 : Number(v)) || 0;
  const isKg = u => /^(kg|kgs|ton|t)$/i.test(String(u || '').trim());
  // Counted qty in the book unit: Kg for KG lines, else bundles x pcs per bundle + pcs (same as rules.gs countedQty).
  const countedQty = (c, uom, ppb) => (isKg(uom) ? n0(c.kg) : countedPcs(n0(c.bundles), ppb, n0(c.pieces)));
  // Any one of Bundle / Kg / Pcs is enough (Kim, 13 Nov); the other two can stay blank.
  const numOk = v => v === '' || (isFinite(Number(v)) && Number(v) >= 0);
  const lineOk = c => (c.bundles === '' || whole(c.bundles)) && (c.pieces === '' || whole(c.pieces)) && numOk(c.kg) && !(c.bundles === '' && c.kg === '' && c.pieces === '');
  // The book is compared and changed only when the box in the book unit is filled (same as rules.gs comparable).
  const comparable = (c, uom) => (isKg(uom) ? c.kg !== '' : (c.bundles !== '' || c.pieces !== ''));
  const worstOf = list => (list.indexOf('SHORT') >= 0 ? 'SHORT' : list.indexOf('OVER') >= 0 ? 'OVER' : 'MATCH');

  // Demo data (sample only, not real ISI Steel stock): 2 warehouses, 10 bins, 10 materials, several batches.
  const dAgo = n => { const d = new Date(Date.now() - n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const DEMO_BINS = [
    ['I1-DB-A-01-01-01', 'WH I1'], ['I1-DB-A-02-01-01', 'WH I1'], ['I1-DB-A-03-01-01', 'WH I1'], ['I1-DB-A-04-01-01', 'WH I1'], ['I1-DB-A-05-01-01', 'WH I1'],
    ['C1-FG-A-01-01-20', 'WH C1'], ['C1-FG-A-01-01-21', 'WH C1'], ['C1-FG-A-01-01-22', 'WH C1'], ['C1-FG-A-01-01-23', 'WH C1'], ['C1-FG-A-01-01-24', 'WH C1'],
  ].map(x => ({ bin: x[0], warehouse: x[1], lastCount: '', lastStatus: '', accuracy: null }));
  const DEMO_STOCK = [
    ['I1-DB-A-01-01-01', '1100000231', 'INTANU G300AZ30 BR 1200x0.220', 'D261023018', '1020', 'KG', 1, 4620],
    ['I1-DB-A-02-01-01', '1100000231', 'INTANU G300AZ30 BR 1200x0.220', 'D261023023', '1020', 'KG', 1, 4530],
    ['I1-DB-A-03-01-01', '1100000245', 'GI COIL Z80 1219x0.30', 'D261101004', '1020', 'KG', 1, 5210],
    ['I1-DB-A-04-01-01', '1100000260', 'PPGI COIL BLUE 1200x0.35', 'D261102011', '1020', 'KG', 1, 3980],
    ['I1-DB-A-04-01-01', '1100000261', 'PPGI COIL RED 1200x0.35', 'D261102015', '1020', 'KG', 1, 4105],
    ['I1-DB-A-05-01-01', '1100000302', 'HR COIL SS400 1250x2.0', 'H261028002', '1010', 'KG', 1, 8640],
    ['C1-FG-A-01-01-20', 'PIPE-25X25', 'Square Steel Pipe 25 x 25 x 1.2', '26080153', '2010', 'PC', 150, 150],
    ['C1-FG-A-01-01-20', 'PIPE-25X25', 'Square Steel Pipe 25 x 25 x 1.2', '26080154', '2010', 'PC', 150, 80],
    ['C1-FG-A-01-01-21', 'PIPE-40X40', 'Square Steel Pipe 40 x 40 x 1.4', '26080155', '2010', 'PC', 100, 120],
    ['C1-FG-A-01-01-22', 'PIPE-RD-21', 'Round Steel Pipe 21.3 x 1.6', '26090021', '2010', 'PC', 200, 400],
    ['C1-FG-A-01-01-22', 'PIPE-RD-27', 'Round Steel Pipe 26.9 x 1.6', '26090030', '2010', 'PC', 150, 300],
    ['C1-FG-A-01-01-23', 'CPURLIN-100', 'C Purlin 100 x 50 x 2.0', '26100007', '2010', 'PC', 50, 200],
    ['C1-FG-A-01-01-24', 'ROOF-760', 'Roofing Sheet 760 x 0.35 Blue', '26100112', '2010', 'PC', 100, 650],
  ].map(x => ({ bin: x[0], material: x[1], desc: x[2], batch: x[3], sloc: x[4], uom: x[5], pcsPerBundle: x[6], book: x[7] }));
  // Opening movements, so every stock card has a history and its last balance equals the stock above.
  const DEMO_LEDGER = [];
  (function seed() {
    const add = (ago, time, type, l, qtyIn, qtyOut, balance, reference, user, otherBin) => DEMO_LEDGER.push({ id: (type === 'IN' ? 'IN' : type === 'OUT' ? 'OUT' : 'TR') + dAgo(ago).slice(2).replace(/-/g, '') + '-' + String(DEMO_LEDGER.length + 1).padStart(4, '0'),
      date: dAgo(ago), time: time, type: type, bin: l.bin, material: l.material, desc: l.desc, batch: l.batch, sloc: l.sloc, uom: l.uom, qtyIn: qtyIn, qtyOut: qtyOut, balance: balance, reference: reference, otherBin: otherBin || '', user: user });
    DEMO_STOCK.forEach((l, i) => {
      const out1 = l.uom === 'KG' ? 0 : 20 + (i % 3) * 10, in2 = l.uom === 'KG' ? 0 : 30;
      const open = l.book + out1 - in2;
      add(6, '08:1' + (i % 10), 'IN', l, open, 0, open, 'OPEN-' + String(i + 1).padStart(3, '0'), 'admin@isi');
      if (out1) add(3 - (i % 3), '10:2' + (i % 10), 'OUT', l, 0, out1, open - out1, 'DN-81004522' + (30 + i), 'sokha@isi');
      if (in2) add(1, '14:0' + (i % 10), 'IN', l, in2, 0, l.book, 'GR-00' + (40 + i), 'dara@isi');
    });
  })();
  // Counts waiting for a supervisor (only counts with a difference need review).
  const DEMO_COUNTS = [
    { id: 'SC' + dAgo(1).slice(2).replace(/-/g, '') + '-A1F0', date: dAgo(1), time: '16:40', bin: 'C1-FG-A-01-01-20', material: 'PIPE-25X25', desc: 'Square Steel Pipe 25 x 25 x 1.2', batch: '26080153', sloc: '2010', uom: 'PC', book: 150, counted: 140, variance: -10, status: 'Submitted', by: 'sokha@isi', remark: 'One bundle opened' },
    { id: 'SC' + dAgo(1).slice(2).replace(/-/g, '') + '-B7C2', date: dAgo(1), time: '16:55', bin: 'C1-FG-A-01-01-22', material: 'PIPE-RD-21', desc: 'Round Steel Pipe 21.3 x 1.6', batch: '26090021', sloc: '2010', uom: 'PC', book: 400, counted: 405, variance: 5, status: 'Submitted', by: 'dara@isi', remark: '' },
    { id: 'SC' + dAgo(2).slice(2).replace(/-/g, '') + '-C3D9', date: dAgo(2), time: '09:15', bin: 'I1-DB-A-03-01-01', material: '1100000245', desc: 'GI COIL Z80 1219x0.30', batch: 'D261101004', sloc: '1020', uom: 'KG', book: 5210, counted: 5210, variance: 0, status: 'Approved', by: 'sokha@isi', remark: '' },
  ];
  const demoBinList = () => DEMO_BINS.map(b => Object.assign({}, b, { lines: DEMO_STOCK.filter(l => l.bin === b.bin).length }));

  const S = { list: [], bins: [], stock: [], dash: null, card: null, move: null, lineIdx: -1, user: null, view: 'home', bin: null, mode: '', result: null, photo: '', signedOut: false, blocked: '' };

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
    // 45 s limit, so a lost request never leaves the screen on the loading bars.
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 45000) : null;
    try {
      const res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: get(TOKEN_KEY), payload: payload || {} }), signal: ctl ? ctl.signal : undefined });
      data = await res.json();
    } catch (e) {
      const slow = e && e.name === 'AbortError';
      throw Object.assign(new Error(slow ? T('ម៉ាស៊ីនមេយឺតពេក។ ចុចឡូហ្គោ ISI ដើម្បីព្យាយាមម្តងទៀត។', 'Server too slow. Tap the ISI logo to try again.')
        : T('មិនអាចភ្ជាប់អ៊ីនធឺណិត។ សូមព្យាយាមម្តងទៀត។', 'No connection. Please try again.')), { code: 'NET' });
    } finally { if (timer) clearTimeout(timer); }
    if (!data.ok) { const m = msgOf(data.error); throw Object.assign(new Error(m.text), { code: m.code }); }
    if (data.session) put(TOKEN_KEY, data.session);
    return data.data;
  }

  // ------------------------------------------------------------------ helpers
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
  const statusLabel = s => ({ MATCH: T('ត្រូវ', 'Match'), SHORT: T('ខ្វះ', 'Short'), OVER: T('លើស', 'Over') }[s] || '');

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
    if (DEMO) { S.bins = demoBinList(); S.stock = DEMO_STOCK; S.list = S.bins.slice(0, 5); S.user = { name: 'Demo' }; S.dash = demoDash(); return route(); }
    if (!signedIn()) { S.signedOut = true; return route(); }
    const cached = jget(CACHE_KEY, null);
    if (cached && !S.user) { useBoot(cached); route(); }   // fast: last data at once, fresh data follows
    try {
      const b = await api('boot');
      useBoot(b); put(CACHE_KEY, JSON.stringify(b));
      await flush();
    } catch (e) {
      if (e.code === 'AUTH') S.signedOut = true;
      else if (e.code === 'NOACCESS') S.blocked = e.message;
      else S.loadError = e.message;
    }
    route();
  }

  function useBoot(b) {
    S.user = b.user; S.list = b.today || []; S.bins = b.bins || []; S.stock = b.stock || []; S.dash = b.dash || null;
    S.signedOut = false; S.blocked = ''; S.loadError = '';
  }
  // Bin from the booted data (no request). null when the bin is not in Bin Master.
  function localBin(key) {
    const b = S.bins.find(x => String(x.bin).toUpperCase() === key);
    if (!b) return null;
    return Object.assign({}, b, { lines: S.stock.filter(l => String(l.bin).toUpperCase() === key).map(l => Object.assign({}, l)) });
  }

  // Counts and outs saved on the phone while offline are sent when the connection is back.
  async function flush() {
    if (DEMO) return;
    const q = queue();
    if (!q.length) return;
    const left = [];
    for (const item of q) {
      try { await api(item.action, item.payload); }
      catch (e) { if (e.code === 'NET') left.push(item); else toast(e.message); }
    }
    saveQueue(left);
    if (q.length !== left.length) toast(T('បានផ្ញើការរាប់ដែលរក្សាទុកក្នុងទូរស័ព្ទ', 'Saved counts sent'));
  }
  window.addEventListener('online', () => { flush().then(() => route()); });
  window.SC_REFRESH = () => { boot(); };

  // ------------------------------------------------------------------ screens
  function route() {
    try { route_(); }
    catch (e) {   // a drawing error must never leave the loading bars on screen
      view(`<div class="card blocked"><div class="emoji">⚠️</div><h2>${T('មានបញ្ហាបង្ហាញទំព័រ', 'Could not show the page')}</h2><p class="muted">${esc(e && e.message || e)}</p>
        <button type="button" class="btn" onclick="location.reload()">${T('ផ្ទុកឡើងវិញ', 'Reload')}</button></div>`);
    }
  }
  function route_() {
    $('#demo').hidden = !DEMO;
    $('#demo').textContent = DEMO ? T('ដំណើរការសាកល្បង: មិនទាន់រក្សាទុកទៅ Google Sheet', 'Demo mode: nothing is saved to the Google Sheet yet') : '';
    if (S.signedOut) return blockedScreen(T('សូមចូលគណនីនៅទំព័រដើម', 'Please sign in on the home menu'), T('ការចូលបានផុតកំណត់ ឬមិនទាន់ចូល', 'Not signed in or sign-in expired'));
    if (S.blocked) return blockedScreen(T('មិនទាន់មានសិទ្ធិ', 'No access yet'), S.blocked);
    document.body.classList.remove('wide');
    if (window.SC_NAV) window.SC_NAV();
    if (window.SC_PAGES && window.SC_PAGES[S.view]) return window.SC_PAGES[S.view]();
    if (S.view === 'bin' && S.bin) return binScreen();
    if (S.view === 'count' && S.bin) return lineScreen('count');
    if (S.view === 'card' && S.bin && S.card) return cardScreen();
    if (S.view === 'move' && S.bin && S.move) return moveScreen();
    if (S.view === 'result' && S.result) return resultScreen();
    return homeScreen();
  }
  function blockedScreen(title, text) {
    view(`<div class="card blocked"><div class="emoji">🔒</div><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <a class="btn" href="../">${T('ទៅទំព័រដើម', 'Go to the home menu')}</a></div>`);
  }

  function homeScreen() {
    if (DEMO) S.dash = demoDash();
    const q = queue();
    const list = S.list.map(b => `<button type="button" class="item" data-bin="${esc(b.bin)}">
        <span><span class="bin">${esc(b.bin)}</span><br>
        <span class="muted">${esc(b.warehouse)} · ${b.lines ? b.lines + ' ' + T('ប្រភេទ', 'SKU') : ''} · ${T('បានរាប់ចុងក្រោយ', 'last counted')}: ${esc(shortDate(b.lastCount))}</span></span>
        <span class="acc">${accText(b.accuracy)}<small>${T('ភាពត្រឹមត្រូវ', 'accuracy')}</small></span></button>`).join('');
    view(`
      <section class="card gate">
        <div class="gate-ic" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><rect x="7" y="7" width="4" height="4" rx=".5"/><rect x="13" y="7" width="4" height="4" rx=".5"/><rect x="7" y="13" width="4" height="4" rx=".5"/><path d="M13 13h1.5v1.5M17 13v4h-4"/></svg>
        </div>
        <h2>${T('ស្កេន QR Code របស់កុងតឺន័រ', 'Scan the bin QR code')}</h2>
        <p class="muted center">${T('សូមស្កេន QR Code ដែលបិទនៅកុងតឺន័រ ដើម្បីបើកកាតស្តុក។', 'Scan the QR code posted on the bin to open its stock card.')}</p>
        <div class="qr-view" id="qrView" hidden><video playsinline muted></video><div class="qr-frame"></div></div>
        <p class="muted center" id="binMsg" hidden></p>
        <button type="button" class="btn ok big" id="scanBtn">📷 ${T('ស្កេន QR Code', 'Scan QR code')}</button>
        <label class="btn ghost photo" id="photoBtn"><input type="file" accept="image/*" capture="environment" hidden>🖼️ ${T('ថតរូប QR ជំនួសវិញ', 'Take a photo of the QR instead')}</label>
        <div class="row" style="margin-top:12px">
          <input id="binIn" type="text" autocomplete="off" autocapitalize="characters" placeholder="${T('ឬវាយកូដកុងតឺន័រ', 'or type the bin code')}">
          <button type="button" class="btn ghost shrink" id="goBin">${T('ទៅ', 'Go')}</button>
        </div>
      </section>
      ${S.dash ? `<div class="kpis"><div><b>${S.dash.bins}</b><span>${T('កុងតឺន័រ', 'Bins')}</span></div><div><b>${S.dash.lines}</b><span>${T('ប្រភេទស្តុក', 'Stock lines')}</span></div>
        <div class="in"><b>${S.dash.inToday}</b><span>${T('ចូលថ្ងៃនេះ', 'IN today')}</span></div><div class="out"><b>${S.dash.outToday}</b><span>${T('ចេញថ្ងៃនេះ', 'OUT today')}</span></div>
        <div><b>${S.dash.transferToday}</b><span>${T('ផ្ទេរថ្ងៃនេះ', 'Transfers today')}</span></div></div>` : ''}
      ${S.loadError ? `<div class="card err"><b>⚠️ ${T('ផ្ទុកទិន្នន័យមិនបាន', 'Could not load the data')}</b><p class="muted">${esc(S.loadError)}</p><button type="button" class="btn ghost" id="retry">${T('ព្យាយាមម្តងទៀត', 'Try again')}</button></div>` : ''}
      ${q.length ? `<div class="card"><span class="pill">${q.length} ${T('រង់ចាំផ្ញើ', 'waiting to send')}</span> <button type="button" class="btn ghost" id="sendQ">${T('ផ្ញើឥឡូវ', 'Send now')}</button></div>` : ''}
      <h2>${T('បញ្ជីរាប់ថ្ងៃនេះ', "Today's count list")} (${S.list.length})</h2>
      ${list || `<p class="muted">${T('មិនទាន់មានកុងតឺន័រ។', 'No bins yet.')}</p>`}
      ${S.dash && S.dash.recent && S.dash.recent.length ? `<h2>${T('សកម្មភាពថ្មីៗ', 'Recent activity')}</h2><section class="card scroll"><table class="lines hist"><tr><th>${T('ថ្ងៃ', 'Date')}</th><th>${T('កុងតឺន័រ', 'Bin')}</th><th>${T('សម្ភារៈ', 'Material')}</th><th>${T('ប្រភេទ', 'Type')}</th><th>${T('ចំនួន', 'Qty')}</th></tr>${
        S.dash.recent.map(r => `<tr><td>${esc((r.date || '').slice(5))} <small class="muted">${esc(r.time || '')}</small></td><td>${esc(r.bin)}</td><td>${esc(r.material)}</td><td>${esc(typeLabel(r.type))}</td><td class="num ${r.qtyIn ? 'in' : 'out'}">${r.qtyIn ? '+' + fmtQty(r.qtyIn) : '-' + fmtQty(r.qtyOut)}</td></tr>`).join('')}</table></section>` : ''}
    `);
    const go = () => { const code = $('#binIn').value.trim(); if (code) openBin(code); };
    $('#goBin').onclick = go;
    $('#binIn').onkeydown = e => { if (e.key === 'Enter') go(); };
    $('#scanBtn').onclick = () => (scanner.on ? stopScan() : startScan());
    $('#photoBtn input').onchange = scanPhoto;
    if ($('#sendQ')) $('#sendQ').onclick = () => flush().then(route);
    if ($('#retry')) $('#retry').onclick = () => { view('<div class="loading"><div class="skel"></div><div class="skel short"></div></div>'); boot(); };
    document.querySelectorAll('[data-bin]').forEach(el => { el.onclick = () => openBin(el.dataset.bin); });
  }

  // Scan like the Overtime app: live camera inside the card, or a photo of the QR. Android reads QR and barcodes with the
  // built-in BarcodeDetector; other phones load jsQR (QR only). The bin code can always be typed instead.
  let qrLib = null;
  function loadQrLib() {
    return qrLib || (qrLib = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = '../vendor/jsQR.min.js'; el.onload = () => resolve(window.jsQR); el.onerror = () => { qrLib = null; reject(new Error('QR reader did not load')); };
      document.head.appendChild(el);
    }));
  }
  const qrCanvas = document.createElement('canvas');
  async function decodeQr(src) {
    const w = src.videoWidth || src.naturalWidth || src.width, h = src.videoHeight || src.naturalHeight || src.height;
    if (!w || !h) return '';
    if ('BarcodeDetector' in window) {
      try { const r = await new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'] }).detect(src); if (r[0]) return r[0].rawValue; } catch (e) { /* fall back to jsQR */ }
    }
    const jsQR = await loadQrLib();
    const k = Math.min(1, 720 / Math.max(w, h));
    qrCanvas.width = Math.round(w * k); qrCanvas.height = Math.round(h * k);
    const ctx = qrCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, qrCanvas.width, qrCanvas.height);
    const img = ctx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    return code ? code.data : '';
  }
  const scanner = { on: false, stream: null, timer: 0 };
  function stopScan() {
    scanner.on = false; clearTimeout(scanner.timer);
    if (scanner.stream) scanner.stream.getTracks().forEach(x => x.stop());
    scanner.stream = null;
    if ($('#qrView')) { $('#qrView').hidden = true; $('#binMsg').hidden = true; $('#scanBtn').innerHTML = '📷 ' + T('ស្កេន QR Code', 'Scan QR code'); }
  }
  async function startScan() {
    const view = $('#qrView'), video = $('#qrView video'), msg = $('#binMsg');
    view.hidden = false; msg.hidden = false; msg.textContent = T('ដាក់ QR ក្នុងប្រអប់', 'Hold the QR code inside the square');
    $('#scanBtn').textContent = '✖ ' + T('បិទកាមេរ៉ា', 'Close camera');
    scanner.on = true;
    if (DEMO) { scanner.timer = setTimeout(() => { stopScan(); openBin(DEMO_BINS[5].bin); }, 1200); return; }
    try {
      scanner.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (!scanner.on) { stopScan(); return; }
      video.srcObject = scanner.stream; await video.play();
      const tick = async () => {
        if (!scanner.on) return;
        const text = await decodeQr(video).catch(() => '');
        if (text) { stopScan(); openBin(text.trim()); } else scanner.timer = setTimeout(tick, 180);
      };
      tick();
    } catch (e) {
      stopScan();
      msg.hidden = false;
      msg.textContent = T('មិនអាចបើកកាមេរ៉ាបានទេ។ សូមអនុញ្ញាតកាមេរ៉ា ឬថតរូប QR ខាងក្រោម។', 'Cannot open the camera. Allow the camera, or take a photo of the QR below.');
    }
  }
  function scanPhoto(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const msg = $('#binMsg');
    const img = new Image();
    img.onload = async () => {
      const text = await decodeQr(img).catch(() => '');
      URL.revokeObjectURL(img.src);
      if (text) openBin(text.trim());
      else { msg.hidden = false; msg.textContent = T('រកមិនឃើញ QR Code ក្នុងរូបទេ។ សូមថតម្តងទៀត។', 'No QR code found in the photo. Please try again.'); }
    };
    img.src = URL.createObjectURL(file);
  }

  async function openBin(code) {
    const key = code.toUpperCase();
    let b = null;
    if (DEMO || S.bins.length) b = localBin(key);
    else {
      try { b = await api('bin', { bin: code }); }
      catch (e) { if (e.code === 'AUTH') S.signedOut = true; toast(e.message); return; }
    }
    if (!b) { toast(T('រកមិនឃើញកុងតឺន័រនេះ', 'Bin not found')); return; }
    stopScan();
    S.bin = b; S.view = 'bin'; S.photo = '';
    route();
  }

  // Bin screen: the three choices, and the bin's SKU lines.
  function binScreen() {
    const b = S.bin;
    const rows = (b.lines || []).map((l, i) => `<button type="button" class="item" data-line="${i}">
        <span><span class="sku"><b>${esc(l.material)}</b> · ${esc(l.desc)}</span><br><span class="muted">Batch: ${esc(l.batch)} · SLOC ${esc(l.sloc)}</span></span>
        <span class="acc">${fmtQty(l.book)}<small>${esc(l.uom)}</small></span></button>`).join('');
    view(`
      <section class="card hero"><div class="bin">${esc(b.bin)}</div><div class="muted">${esc(b.warehouse)} · ${(b.lines || []).length} ${T('ប្រភេទ', 'SKU')}</div></section>
      <div class="quad">
        <button type="button" class="btn ok" id="actIn">${typeLabel('IN')}</button>
        <button type="button" class="btn warn" id="actOut">${typeLabel('OUT')}</button>
        <button type="button" class="btn blue" id="actTr">${typeLabel('TRANSFER')}</button>
        <button type="button" class="btn" id="actCount">${T('រាប់ស្តុក', 'Stock Count')}</button>
      </div>
      <h2>${T('ស្តុកក្នុងកុងតឺន័រនេះ (ចុចដើម្បីមើលកាតស្តុក)', 'Stock in this bin (tap a line for its stock card)')}</h2>
      ${rows || `<p class="muted">${T('កុងតឺន័រនេះទទេ។ ប្រើ ចូលស្តុក ដើម្បីដាក់ទំនិញ។', 'This bin is empty. Use Stock IN to put material here.')}</p>`}
      <button type="button" class="btn ghost big" id="back">${T('ត្រឡប់', 'Back')}</button>`);
    $('#actIn').onclick = () => openMove('IN');
    $('#actOut').onclick = () => openMove('OUT');
    $('#actTr').onclick = () => openMove('TRANSFER');
    $('#actCount').onclick = () => { S.mode = 'count'; S.view = 'count'; S.photo = ''; route(); };
    document.querySelectorAll('[data-line]').forEach(el => { el.onclick = () => openCard(Number(el.dataset.line)); });
    $('#back').onclick = () => { S.view = 'home'; S.bin = null; route(); };
  }

  // ------------------------------------------------------------------ digital stock card: In / Out / Transfer / history
  const fmtQty = n => (n == null || n === '' ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 }));
  const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
  const typeLabel = t => ({ IN: T('ចូលស្តុក', 'Stock IN'), OUT: T('ចេញស្តុក', 'Stock OUT'), TRANSFER: T('ផ្ទេរ', 'Transfer'),
    'TRANSFER OUT': T('ផ្ទេរចេញ', 'Transfer out'), 'TRANSFER IN': T('ផ្ទេរចូល', 'Transfer in'), ADJUST: T('កែតម្រូវ', 'Adjustment') }[t] || t);
  const sameLine = (a, b) => [a.material, a.batch, a.sloc].join('|').toUpperCase() === [b.material, b.batch, b.sloc].join('|').toUpperCase();
  const round3 = n => Math.round(n * 1000) / 1000;
  // Same rules as rules.gs moveOk / transferOk; the server checks again before posting.
  const moveBad = (type, qty, balance, uom) => {
    const q = Number(qty);
    if (qty === '' || !isFinite(q) || !(q > 0)) return T('ចំនួនត្រូវធំជាង 0', 'Quantity must be above 0');
    if (!isKg(uom) && Math.floor(q) !== q) return T('ចំនួនត្រូវជាលេខគត់', 'Quantity must be a whole number');
    if (type !== 'IN' && q > Number(balance)) return T('ចំនួនច្រើនជាងស្តុកក្នុងកុងតឺន័រ', 'More than the stock in this bin');
    return '';
  };

  // Camera scan in a sheet over the screen (product barcode, destination bin). The code can always be typed instead.
  function scanSheet(title, onText, demoText) {
    stopScan();
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet"><div class="sheet-top"><b>${esc(title)}</b><button type="button" class="icon-btn dark" data-close aria-label="Close">✕</button></div>
      <div class="qr-view"><video playsinline muted></video><div class="qr-frame"></div></div><p class="muted center" data-msg>${T('ដាក់កូដក្នុងប្រអប់', 'Hold the code inside the square')}</p></div>`;
    let on = true, stream = null, timer = 0;
    const close = () => { on = false; clearTimeout(timer); if (stream) stream.getTracks().forEach(x => x.stop()); bg.remove(); };
    bg.onclick = e => { if (e.target === bg || e.target.closest('[data-close]')) close(); };
    document.body.appendChild(bg);
    if (DEMO) { timer = setTimeout(() => { close(); onText(demoText || ''); }, 1000); return; }
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!on) { stream.getTracks().forEach(x => x.stop()); return; }
        const video = bg.querySelector('video');
        video.srcObject = stream; await video.play();
        const tick = async () => {
          if (!on) return;
          const text = await decodeQr(video).catch(() => '');
          if (text) { close(); onText(text.trim()); } else timer = setTimeout(tick, 180);
        };
        tick();
      } catch (e) { bg.querySelector('.qr-view').hidden = true; bg.querySelector('[data-msg]').textContent = T('មិនអាចបើកកាមេរ៉ាបានទេ។ សូមវាយកូដ។', 'Cannot open the camera. Please type the code.'); }
    })();
  }

  // Stock card of one line: header, balance and every movement (newest first).
  async function openCard(i) {
    const l = S.bin.lines[i];
    S.lineIdx = i; S.card = { line: l, rows: null, error: '' }; S.view = 'card'; route();
    try {
      const c = DEMO ? { line: l, rows: DEMO_LEDGER.filter(r => r.bin === S.bin.bin && sameLine(r, l)).slice().reverse() }
        : await api('card', { bin: S.bin.bin, material: l.material, batch: l.batch, sloc: l.sloc });
      l.book = c.line.book;
      S.card = { line: l, rows: c.rows, error: '' };
    } catch (e) { if (e.code === 'AUTH') S.signedOut = true; S.card.rows = []; S.card.error = e.message; }
    if (S.view === 'card') route();
  }
  function cardScreen() {
    const b = S.bin, c = S.card, l = c.line;
    const rows = (c.rows || []).map(r => `<tr><td>${esc((r.date || '').slice(5))}<br><small class="muted">${esc(r.time || '')}</small></td>
      <td>${esc(r.reference || r.id || '')}${r.otherBin ? `<br><small class="muted">${r.type === 'TRANSFER IN' ? '←' : '→'} ${esc(r.otherBin)}</small>` : ''}</td>
      <td>${esc(typeLabel(r.type))}</td><td class="num in">${r.qtyIn ? fmtQty(r.qtyIn) : ''}</td><td class="num out">${r.qtyOut ? fmtQty(r.qtyOut) : ''}</td>
      <td class="num"><b>${fmtQty(r.balance)}</b></td><td><small>${esc(String(r.user || '').split('@')[0])}</small></td></tr>`).join('');
    view(`
      <section class="card hero">
        <div class="muted">${esc(b.bin)} · ${esc(b.warehouse || '')}</div>
        <div class="cdesc">${esc(l.desc)}</div>
        <div class="ccode">${esc(l.material)} <span class="muted">Batch: ${esc(l.batch)} · SLOC ${esc(l.sloc)}</span></div>
        <div class="kv"><div><span class="muted">${T('សមតុល្យបច្ចុប្បន្ន', 'Current balance')}</span><b>${fmtQty(l.book)} ${esc(l.uom)}</b></div>
          <div><span class="muted">${T('ចលនាចុងក្រោយ', 'Last movement')}</span><b style="font-size:15px">${c.rows && c.rows[0] ? esc(c.rows[0].date + ' ' + c.rows[0].time) : '—'}</b></div></div>
      </section>
      <div class="quad">
        <button type="button" class="btn ok" data-move="IN">${typeLabel('IN')}</button>
        <button type="button" class="btn warn" data-move="OUT">${typeLabel('OUT')}</button>
        <button type="button" class="btn blue" data-move="TRANSFER">${typeLabel('TRANSFER')}</button>
      </div>
      <h2>${T('ប្រវត្តិចលនា', 'Stock card history')}</h2>
      ${c.error ? `<div class="card err"><p class="muted">${esc(c.error)}</p></div>` : ''}
      ${c.rows == null ? '<div class="loading"><div class="skel"></div></div>'
        : rows ? `<section class="card scroll"><table class="lines hist"><tr><th>${T('ថ្ងៃ', 'Date')}</th><th>${T('ឯកសារ', 'Document')}</th><th>${T('ប្រភេទ', 'Type')}</th><th>IN</th><th>OUT</th><th>${T('សមតុល្យ', 'Balance')}</th><th>${T('អ្នកធ្វើ', 'By')}</th></tr>${rows}</table></section>`
        : `<p class="muted">${T('មិនទាន់មានចលនា។', 'No movements yet.')}</p>`}
      <button type="button" class="btn ghost big" id="back">${T('ត្រឡប់', 'Back')}</button>`);
    document.querySelectorAll('[data-move]').forEach(el => { el.onclick = () => openMove(el.dataset.move, S.lineIdx); });
    $('#back').onclick = () => { S.view = 'bin'; route(); };
  }

  // In / Out / Transfer form. One request id per opened form, so a double tap or a re-send is never posted twice.
  function openMove(type, lineIdx) {
    S.move = { type: type, requestId: newId(), from: S.view, line: lineIdx == null ? ((S.bin.lines || []).length === 1 ? 0 : -1) : lineIdx };
    S.view = 'move'; route();
  }
  function moveScreen() {
    const b = S.bin, m = S.move, isIn = m.type === 'IN', isTr = m.type === 'TRANSFER';
    const opts = (b.lines || []).map((l, i) => `<option value="${i}" ${m.line === i ? 'selected' : ''}>${esc(l.material)} · ${esc(l.batch)} · ${fmtQty(l.book)} ${esc(l.uom)}</option>`).join('');
    view(`
      <section class="card hero"><div class="bin">${esc(b.bin)}</div><div class="muted">${typeLabel(m.type)}</div></section>
      <section class="card form">
        <label for="mLine">${T('សម្ភារៈ / បាច់', 'Material / batch')}</label>
        <div class="row"><select id="mLine"><option value="-1">${T('— ជ្រើសរើស —', '— choose —')}</option>${opts}${isIn ? `<option value="new" ${m.line === 'new' ? 'selected' : ''}>➕ ${T('សម្ភារៈ ឬបាច់ថ្មីក្នុងកុងតឺន័រនេះ', 'New material or batch in this bin')}</option>` : ''}</select>
          <button type="button" class="btn ghost shrink" id="mScan" title="Scan">📷</button></div>
        <p class="muted" id="mInfo"></p>
        <div id="mNew" hidden>
          <div class="fields"><div><label for="nMat">${T('កូដសម្ភារៈ', 'Material code')}</label><input id="nMat" type="text" autocapitalize="characters" autocomplete="off"></div>
            <div><label for="nBatch">Batch</label><input id="nBatch" type="text" autocapitalize="characters" autocomplete="off"></div></div>
          <div class="fields"><div><label for="nSloc">SLOC</label><input id="nSloc" type="text" autocomplete="off"></div>
            <div><label for="nUom">${T('ឯកតា (សម្ភារៈថ្មីប៉ុណ្ណោះ)', 'Unit (new material only)')}</label><input id="nUom" type="text" placeholder="KG / PC" autocomplete="off"></div></div>
          <label for="nDesc">${T('បរិយាយ (សម្ភារៈថ្មីប៉ុណ្ណោះ)', 'Description (new material only)')}</label><input id="nDesc" type="text" autocomplete="off">
        </div>
        <label for="mQty">${T('ចំនួន', 'Quantity')} <span id="mUom"></span></label>
        <input id="mQty" type="number" inputmode="decimal" min="0" step="any" class="need">
        ${isTr ? `<label for="mTo">${T('កុងតឺន័រទៅ', 'Destination bin')}</label>
          <div class="row"><input id="mTo" type="text" autocapitalize="characters" autocomplete="off" class="need"><button type="button" class="btn ghost shrink" id="mToScan" title="Scan">📷</button></div>` : ''}
        <label for="mRef">${isIn ? T('លេខឯកសារយោង (GR / PO)', 'Reference document (GR / PO)') : isTr ? T('លេខឯកសារយោង (ស្រេចចិត្ត)', 'Reference (optional)') : T('លេខ DN / ឯកសារយោង', 'Delivery note / reference')}</label>
        <input id="mRef" type="text" maxlength="60" autocomplete="off" ${isTr ? '' : 'class="need"'}>
        <label for="mRemark">${T('កំណត់សម្គាល់ (ស្រេចចិត្ត)', 'Remark (optional)')}</label>
        <input id="mRemark" type="text" maxlength="200" autocomplete="off">
        <div class="live" id="mAfter"></div>
      </section>
      <button type="button" class="btn big ${isIn ? 'ok' : isTr ? 'blue' : 'warn'}" id="mSave" disabled>${T('បញ្ជាក់', 'Confirm')} ${typeLabel(m.type)}</button>
      <button type="button" class="btn ghost big" id="back">${T('ត្រឡប់', 'Back')}</button>`);

    const sel = () => { const v = $('#mLine').value; return v === 'new' ? 'new' : Number(v); };
    const line = () => (typeof sel() === 'number' && sel() >= 0 ? b.lines[sel()] : null);
    const refresh = () => {
      const l = line(), isNew = sel() === 'new', qty = $('#mQty').value, ref = $('#mRef').value.trim();
      $('#mNew').hidden = !isNew;
      $('#mUom').textContent = l ? '(' + l.uom + ')' : '';
      $('#mInfo').textContent = l ? `${l.desc} · ${T('សមតុល្យ', 'Balance')} ${fmtQty(l.book)} ${l.uom}` : '';
      const uom = l ? l.uom : ($('#nUom').value.trim() || 'KG'), bal = l ? l.book : 0;
      let bad = !l && !isNew ? T('សូមជ្រើសរើសសម្ភារៈ', 'Choose the material') : isNew && !$('#nMat').value.trim() ? T('សូមបញ្ចូលកូដសម្ភារៈ', 'Enter the material code') : moveBad(m.type, qty, bal, uom);
      if (!bad && isTr) { const to = $('#mTo').value.trim().toUpperCase(); bad = !to ? T('ស្កេន ឬវាយកុងតឺន័រទៅ', 'Scan or type the destination bin') : to === b.bin.toUpperCase() ? T('កុងតឺន័រទៅត្រូវខុសពីកុងតឺន័រដើម', 'Destination must be a different bin') : ''; }
      if (!bad && !isTr && !ref) bad = T('សូមបញ្ចូលលេខឯកសារយោង', 'Enter the reference document');
      $('#mQty').classList.toggle('need', qty === '');
      if ($('#mTo')) $('#mTo').classList.toggle('need', !$('#mTo').value.trim());
      if (!isTr) $('#mRef').classList.toggle('need', !ref);
      const after = qty !== '' && isFinite(Number(qty)) ? round3(isIn ? bal + Number(qty) : bal - Number(qty)) : null;
      $('#mAfter').innerHTML = bad ? `<span class="need-text">${esc(bad)}</span>` : `${T('សមតុល្យក្រោយ', 'Balance after')}: <b>${fmtQty(after)} ${esc(uom)}</b>`;
      $('#mSave').disabled = !!bad;
    };
    document.querySelectorAll('.form input, .form select').forEach(el => { el.oninput = refresh; el.onchange = refresh; });
    // Product barcode: matched to a line of this bin when the scanned text contains its batch or its material code.
    $('#mScan').onclick = () => scanSheet(T('ស្កេនបាកូដទំនិញ', 'Scan the product barcode'), text => {
      const up = text.toUpperCase();
      const i = (b.lines || []).findIndex(l => (l.batch && up.indexOf(String(l.batch).toUpperCase()) >= 0) || (l.material && up.indexOf(String(l.material).toUpperCase()) >= 0));
      if (i >= 0) $('#mLine').value = String(i);
      else if (isIn) { $('#mLine').value = 'new'; $('#nMat').value = text; toast(T('មិនមានក្នុងកុងតឺន័រនេះ។ សូមពិនិត្យកូដ។', 'Not in this bin yet. Check the code.')); }
      else toast(T('បាកូដនេះមិនត្រូវនឹងស្តុកក្នុងកុងតឺន័រនេះទេ', 'This barcode does not match the stock in this bin'));
      refresh();
    }, ((b.lines || [])[0] || {}).batch);
    if ($('#mToScan')) $('#mToScan').onclick = () => scanSheet(T('ស្កេនកុងតឺន័រទៅ', 'Scan the destination bin'), text => { $('#mTo').value = text; refresh(); }, (DEMO_BINS.find(x => x.bin !== b.bin) || {}).bin);
    $('#back').onclick = () => { S.view = m.from === 'card' ? 'card' : 'bin'; route(); };
    $('#mSave').onclick = () => saveMove(line(), sel() === 'new');
    refresh();
  }

  async function saveMove(l, isNew) {
    const b = S.bin, m = S.move, isTr = m.type === 'TRANSFER', qty = Number($('#mQty').value);
    const src = l || { material: $('#nMat').value.trim(), batch: $('#nBatch').value.trim(), sloc: $('#nSloc').value.trim(), desc: $('#nDesc').value.trim(), uom: $('#nUom').value.trim() };
    const pl = { requestId: m.requestId, type: m.type, bin: b.bin, material: src.material, batch: src.batch, sloc: src.sloc, qty: qty,
      reference: $('#mRef').value.trim(), remark: $('#mRemark').value.trim() };
    if (isNew) { pl.desc = src.desc; pl.uom = src.uom; }
    if (isTr) pl.toBin = $('#mTo').value.trim();
    const action = isTr ? 'transfer' : 'move';
    const btn = $('#mSave'); btn.disabled = true; btn.textContent = T('កំពុងរក្សាទុក…', 'Saving…');
    let out, offline = false;
    try { out = DEMO ? demoMove(pl, l) : await api(action, pl); }
    catch (e) {
      if (e.code === 'NET') { saveQueue(queue().concat([{ action: action, payload: pl }])); offline = true; out = {}; }
      else { if (e.code === 'AUTH') { S.signedOut = true; route(); return; } toast(e.message); btn.disabled = false; btn.textContent = T('បញ្ជាក់', 'Confirm') + ' ' + typeLabel(m.type); return; }
    }
    // Keep the phone's copy in step, then refresh quietly from the server.
    if (!offline) {
      if (l) l.book = out.balance;
      const s = S.stock.find(x => String(x.bin).toUpperCase() === b.bin.toUpperCase() && sameLine(x, src));
      if (s) s.book = out.balance;
      refreshQuiet();
    }
    const uom = out.uom || (l ? l.uom : src.uom) || '';
    S.result = { kind: 'move', status: 'MATCH', offline: offline, title: typeLabel(m.type) + ' ' + T('រួចរាល់', 'posted'),
      detail: offline ? '' : `${fmtQty(qty)} ${uom} · ${T('សមតុល្យថ្មី', 'New balance')}: ${fmtQty(out.balance)} ${uom}` + (isTr ? ` · ${out.toBin || pl.toBin}: ${fmtQty(out.toBalance)} ${uom}` : ''),
      docId: out.id || '' };
    S.view = 'result'; route();
  }
  // Fresh data from the server without leaving the current screen.
  function refreshQuiet() {
    if (DEMO) return;
    api('boot').then(bt => { useBoot(bt); put(CACHE_KEY, JSON.stringify(bt)); if (S.bin) { const nb = localBin(S.bin.bin.toUpperCase()); if (nb) S.bin = nb; } }).catch(() => {});
  }

  // Demo mode: the same checks and postings, kept in memory only.
  function demoDash() {
    const today = dAgo(0), t = DEMO_LEDGER.filter(r => r.date === today);
    return { bins: DEMO_BINS.length, lines: DEMO_STOCK.length, inToday: t.filter(r => r.type === 'IN').length, outToday: t.filter(r => r.type === 'OUT').length,
      transferToday: t.filter(r => r.type === 'TRANSFER OUT').length, recent: DEMO_LEDGER.slice(-10).reverse() };
  }
  const demoLine = (bin, l) => DEMO_STOCK.find(x => x.bin.toUpperCase() === String(bin).toUpperCase() && sameLine(x, l));
  const demoLog = (type, bin, l, qtyIn, qtyOut, balance, pl, otherBin, idPrefix) => {
    const now = new Date(), d = dAgo(0), id = idPrefix + d.slice(2).replace(/-/g, '') + '-' + String(DEMO_LEDGER.length + 1).padStart(4, '0');
    DEMO_LEDGER.push({ id: id, requestId: pl.requestId, date: d, time: now.toTimeString().slice(0, 5), type: type, bin: bin, material: l.material, desc: l.desc, batch: l.batch, sloc: l.sloc, uom: l.uom,
      qtyIn: qtyIn, qtyOut: qtyOut, balance: balance, reference: pl.reference || '', remark: pl.remark || '', otherBin: otherBin || '', user: 'demo@isi' });
    return id;
  };
  function demoMove(pl, l) {
    if (DEMO_LEDGER.some(r => r.requestId === pl.requestId)) return { duplicate: true, balance: l ? l.book : 0 };
    const isTr = pl.type === 'TRANSFER', to = isTr ? pl.toBin.trim().toUpperCase() : '';
    if (isTr && !DEMO_BINS.some(x => x.bin === to)) throw Object.assign(new Error(T('រកមិនឃើញកុងតឺន័រទៅ', 'Destination bin not found')), { code: 'NOBIN' });
    let s = l ? demoLine(pl.bin, l) : null;
    if (!s) {
      const known = DEMO_STOCK.find(x => x.material.toUpperCase() === String(pl.material).toUpperCase());
      s = { bin: pl.bin, material: known ? known.material : pl.material, desc: known ? known.desc : (pl.desc || pl.material), batch: pl.batch, sloc: pl.sloc, uom: known ? known.uom : (pl.uom || 'KG'), pcsPerBundle: known ? known.pcsPerBundle : 1, book: 0 };
      DEMO_STOCK.push(s); S.bin.lines.push(Object.assign({}, s));
    }
    const bal = round3(pl.type === 'IN' ? s.book + pl.qty : s.book - pl.qty);
    let id, toBal;
    if (isTr) {
      let d = demoLine(to, s);
      if (!d) { d = Object.assign({}, s, { bin: to, book: 0 }); DEMO_STOCK.push(d); }
      toBal = round3(d.book + pl.qty); d.book = toBal;
      id = demoLog('TRANSFER OUT', pl.bin, s, 0, pl.qty, bal, pl, to, 'TR');
      demoLog('TRANSFER IN', to, d, pl.qty, 0, toBal, { reference: pl.reference, remark: pl.remark }, pl.bin, 'TR');
    } else id = demoLog(pl.type, pl.bin, s, pl.type === 'IN' ? pl.qty : 0, pl.type === 'IN' ? 0 : pl.qty, bal, pl, '', pl.type);
    s.book = bal;
    const cur = (S.bin.lines || []).find(x => sameLine(x, s)); if (cur) cur.book = bal;
    S.bins = demoBinList();
    return { id: id, balance: bal, uom: s.uom, toBin: to, toBalance: toBal };
  }

  // Count or Out: a table of every SKU line in the bin, one submit.
  function lineScreen(mode) {
    const b = S.bin;
    const isCount = mode === 'count';
    const rows = (b.lines || []).map((l, i) => isCount
      ? `<div class="cline">
        <div class="cdesc">${esc(l.desc)}</div>
        <div class="ccode">${esc(l.material)} <span class="muted">Batch: ${esc(l.batch)}</span></div>
        <div class="cgrid chead"><span>${T('បាច់', 'Bundle')}</span><span>Kg</span><span>${T('រាយ', 'Pcs')}</span><span>${T('កំណត់សម្គាល់', 'Remark')}</span></div>
        <div class="cgrid">
          <input type="number" inputmode="numeric" min="0" data-i="${i}" data-f="bundles">
          <input type="number" inputmode="decimal" min="0" step="any" data-i="${i}" data-f="kg">
          <input type="number" inputmode="numeric" min="0" data-i="${i}" data-f="pieces">
          <input type="text" maxlength="200" data-i="${i}" data-f="remark">
        </div>
        <div class="muted chand">${T('ក្នុងស្តុក', 'On hand')} ${l.book} ${esc(l.uom)}</div>
      </div>`
      : `<tr>
        <td>${esc(l.material)}<br><small class="muted">${esc(l.desc)}</small><br><small class="muted">${esc(l.batch)} · ${esc(l.sloc)}</small></td>
        <td>${l.book}</td>
        <td class="in"><input type="number" inputmode="numeric" min="0" placeholder=" " data-i="${i}" data-f="outQty"></td><td class="diff" data-i="${i}">—</td>
      </tr>`).join('');
    view(`
      <section class="card hero"><div class="bin">${esc(b.bin)}</div><div class="muted">${isCount ? T('រាប់ស្តុកគ្រប់ប្រភេទក្នុងកុងតឺន័រ', 'Count every SKU in this bin') : T('ចេញស្តុកពីកុងតឺន័រ', 'Stock out from this bin')}</div></section>
      ${isCount ? `<section class="card">${rows}</section>`
        : `<section class="card" style="overflow-x:auto"><table class="lines"><tr><th>${T('កូដ', 'Material')}</th><th>${T('ក្នុងស្តុក', 'On hand')}</th><th>${T('ចំនួនចេញ', 'Out Qty')}</th><th>${T('នៅសល់', 'After')}</th></tr>${rows}</table></section>`}
      <section class="card" id="photoBox" hidden>
        <div class="photo" id="photoRow"><label class="btn ghost shrink" for="photoIn" style="margin:0;cursor:pointer">📷 ${T('ថតរូប', 'Take photo')}<input id="photoIn" type="file" accept="image/*" capture="environment" hidden></label>
        <img id="photoPrev" alt="" hidden><span class="need-text" id="needTxt"></span></div>
      </section>
      <label for="note">${T('កំណត់ចំណាំ (ស្រេចចិត្ត)', 'Note (optional)')}</label>
      <input id="note" type="text" maxlength="200">
      <button type="button" class="btn big" id="submit" disabled>${isCount ? T('បញ្ជូនការរាប់', 'Submit count') : T('បញ្ជូនការចេញ', 'Submit Out')}</button>
      <button type="button" class="btn ghost big" id="back">${T('ត្រឡប់', 'Back')}</button>`);

    const refresh = () => {
      let ok = true, needPhoto = false;
      const statuses = [];
      (b.lines || []).forEach((l, i) => {
        const cell = document.querySelector(`.diff[data-i="${i}"]`);
        if (isCount) {
          const c = { bundles: document.querySelector(`[data-i="${i}"][data-f="bundles"]`).value, kg: document.querySelector(`[data-i="${i}"][data-f="kg"]`).value, pieces: document.querySelector(`[data-i="${i}"][data-f="pieces"]`).value };
          const empty = c.bundles === '' && c.kg === '' && c.pieces === '';   // all three red until one has a value
          ['bundles', 'kg', 'pieces'].forEach(f => document.querySelector(`[data-i="${i}"][data-f="${f}"]`).classList.toggle('need', empty));
          if (!lineOk(c)) { ok = false; return; }
          if (comparable(c, l.uom)) statuses.push(statusOf(countedQty(c, l.uom, l.pcsPerBundle) - l.book, 0));   // status only for the photo rule
        } else {
          const v = document.querySelector(`[data-i="${i}"][data-f="outQty"]`).value;
          if (v === '') { cell.textContent = '—'; return; }   // blank line = no out
          if (!whole(v) || Number(v) === 0 || Number(v) > l.book) { cell.textContent = '!'; ok = false; return; }
          cell.textContent = l.book - Number(v);
        }
      });
      if (isCount) {
        needPhoto = false;   // no photo rule for now (Kim, 13 Nov: no Diff / Status / Photo columns in Counts)
        $('#photoBox').hidden = !needPhoto;
        $('#photoRow').classList.toggle('need', needPhoto && !S.photo);
        $('#needTxt').textContent = needPhoto && !S.photo ? T('ត្រូវថតរូបមុនបញ្ជូន', 'Photo needed before submit') : '';
      }
      $('#submit').disabled = !ok || (needPhoto && !S.photo) || (!isCount && !anyOut());
    };
    const anyOut = () => (b.lines || []).some((l, i) => Number((document.querySelector(`[data-i="${i}"][data-f="outQty"]`) || {}).value) > 0);
    document.querySelectorAll('.lines input, .cgrid input').forEach(el => { el.oninput = refresh; });
    if ($('#photoIn')) $('#photoIn').onchange = async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try { S.photo = await shrink(f); } catch (err) { toast(T('មិនអាចប្រើរូបនេះបាន', 'Cannot use this photo')); return; }
      $('#photoPrev').src = S.photo; $('#photoPrev').hidden = false;
      refresh();
    };
    $('#back').onclick = () => { S.view = 'bin'; route(); };
    $('#submit').onclick = () => (isCount ? submitCount() : submitOut());
    refresh();
  }

  function readLines(isCount) {
    return (S.bin.lines || []).map((l, i) => {
      const base = { material: l.material, batch: l.batch, sloc: l.sloc };
      if (isCount) return Object.assign(base, { bundles: document.querySelector(`[data-i="${i}"][data-f="bundles"]`).value, kg: document.querySelector(`[data-i="${i}"][data-f="kg"]`).value, pieces: document.querySelector(`[data-i="${i}"][data-f="pieces"]`).value, remark: document.querySelector(`[data-i="${i}"][data-f="remark"]`).value.trim() });
      return Object.assign(base, { outQty: Number((document.querySelector(`[data-i="${i}"][data-f="outQty"]`) || { value: 0 }).value) || 0 });
    });
  }

  async function submitCount() {
    const b = S.bin;
    const lines = readLines(true);
    const note = $('#note').value.trim();
    const pl = { bin: b.bin, lines: lines, photo: S.photo, note: note };
    const res = demoCount(b, lines) || null;
    const btn = $('#submit'); btn.disabled = true;
    let out;
    if (DEMO) out = res;
    else {
      try { out = await api('submit', { count: pl }); }
      catch (e) {
        btn.disabled = false;
        if (e.code === 'NET') { saveQueue(queue().concat([{ action: 'submit', payload: { count: pl } }])); out = Object.assign(res || {}, { offline: true }); }
        else if (e.code === 'AUTH') { S.signedOut = true; route(); return; }
        else { toast(e.message); return; }
      }
    }
    // No Diff / status on screen for now (Kim): the totals and Difference are in the Stock On Hand tab.
    S.result = { title: T('បានរក្សាទុក', 'Saved'), status: 'MATCH', lines: [], offline: !!out.offline, kind: 'saved' };
    S.view = 'result'; S.photo = ''; route();
  }

  function demoCount(b, lines) {
    const now = new Date();
    const out = (b.lines || []).map((l, i) => {
      if (!comparable(lines[i], l.uom)) return { material: l.material, desc: l.desc, uom: l.uom, book: l.book, counted: null, diff: null, status: '' };
      const counted = countedQty(lines[i], l.uom, l.pcsPerBundle);
      const diff = round3(counted - l.book);
      if (DEMO) DEMO_COUNTS.unshift({ id: 'SC' + dAgo(0).slice(2).replace(/-/g, '') + '-' + String(DEMO_COUNTS.length + 1).padStart(4, '0'), date: dAgo(0), time: now.toTimeString().slice(0, 5), bin: b.bin,
        material: l.material, desc: l.desc, batch: l.batch, sloc: l.sloc, uom: l.uom, book: l.book, counted: counted, variance: diff, status: diff === 0 ? 'Approved' : 'Submitted', by: 'demo@isi', remark: lines[i].remark || '' });
      return { material: l.material, desc: l.desc, uom: l.uom, book: l.book, counted: counted, diff: diff, status: statusOf(diff, 0) };
    });
    return { status: worstOf(out.map(x => x.status)), lines: out, accuracy: null };
  }

  async function submitOut() {
    const b = S.bin;
    const lines = readLines(false).filter(l => l.outQty > 0);
    const pl = { bin: b.bin, lines: lines, note: $('#note').value.trim() };
    const btn = $('#submit'); btn.disabled = true;
    let out;
    if (DEMO) {
      out = { lines: lines.map(l => { const s = b.lines.find(x => x.material === l.material); const after = s.book - l.outQty; s.book = after; return { material: l.material, desc: s.desc, out: l.outQty, after: after }; }) };
    } else {
      try { out = await api('out', { out: pl }); }
      catch (e) {
        btn.disabled = false;
        if (e.code === 'NET') { saveQueue(queue().concat([{ action: 'out', payload: { out: pl } }])); out = { lines: lines.map(l => ({ material: l.material, out: l.outQty })), offline: true }; }
        else if (e.code === 'AUTH') { S.signedOut = true; route(); return; }
        else { toast(e.message); return; }
      }
    }
    (out.lines || []).forEach(l => { const s = S.stock.find(x => String(x.bin).toUpperCase() === b.bin.toUpperCase() && x.material === l.material); if (s && l.after != null) s.book = l.after; });
    S.result = { title: T('ចេញស្តុករួច', 'Out saved'), status: 'OUT', lines: out.lines, offline: !!out.offline, kind: 'out' };
    S.view = 'result'; route();
  }

  function resultScreen() {
    const r = S.result;
    const cls = r.status === 'OUT' ? 'MATCH' : r.status;
    const rows = (r.lines || []).map(l => r.kind === 'out'
      ? `<tr><td>${esc(l.material)}</td><td>${l.out}</td><td>${l.after != null ? l.after : ''}</td></tr>`
      : `<tr><td>${esc(l.material)}</td><td>${l.book}</td><td>${l.counted == null ? '—' : l.counted}</td><td>${l.counted == null ? '—' : `<span class="badge ${l.status}">${l.diff > 0 ? '+' : ''}${l.diff}</span>`}</td></tr>`).join('');
    view(`
      <section class="card hero" style="text-align:center">
        <div class="emoji" style="font-size:40px">${r.status === 'OUT' || r.status === 'MATCH' ? '✅' : r.status === 'SHORT' ? '⚠️' : '🔶'}</div>
        <div class="bin">${esc(r.title)}</div>
        ${r.kind === 'count' ? `<span class="badge ${r.status}">${statusLabel(r.status)}</span>` : ''}
        ${r.detail ? `<p style="margin:10px 0 0;font-size:17px">${esc(r.detail)}</p>` : ''}${r.docId ? `<p class="muted" style="margin:4px 0 0">${esc(r.docId)}</p>` : ''}
        ${r.offline ? `<p class="muted" style="margin-top:10px">${T('បានរក្សាទុកក្នុងទូរស័ព្ទ។ នឹងផ្ញើនៅពេលមានអ៊ីនធឺណិត។', 'Saved on this phone. It will be sent when you are online.')}</p>` : ''}
      </section>
      <table class="lines" ${(r.lines || []).length ? '' : 'hidden'}>${r.kind === 'out' ? `<tr><th>Material</th><th>Out</th><th>After</th></tr>` : `<tr><th>Material</th><th>Book</th><th>Counted</th><th>Diff</th></tr>`}${rows}</table>
      <div style="height:12px"></div>
      ${r.kind === 'move' && S.bin ? `<button type="button" class="btn big" id="toBin">${T('ត្រឡប់ទៅកុងតឺន័រ', 'Back to the bin')} ${esc(S.bin.bin)}</button>` : ''}
      <button type="button" class="btn big ${r.kind === 'move' ? 'ghost' : 'ok'}" id="next">${T('ត្រឡប់ទៅបញ្ជី', 'Back to list')}</button>`);
    if ($('#toBin')) $('#toBin').onclick = () => { S.view = 'bin'; S.result = null; route(); };
    $('#next').onclick = () => { S.view = 'home'; S.bin = null; S.result = null; route(); };
  }

  // Shared with desk.js (dashboard, stock list, movements, count review, SAP reconciliation).
  window.SC = { S: S, T: T, esc: esc, $: $, view: view, route: route, toast: toast, fmtQty: fmtQty, typeLabel: typeLabel, isKg: isKg, round3: round3, sameLine: sameLine, openBin: openBin,
    DEMO: DEMO, dAgo: dAgo, demo: DEMO ? { bins: DEMO_BINS, stock: DEMO_STOCK, ledger: DEMO_LEDGER, counts: DEMO_COUNTS, log: demoLog, binList: demoBinList } : null };

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
