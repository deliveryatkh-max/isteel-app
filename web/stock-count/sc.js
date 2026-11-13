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
  const lineOk = c => (c.bundles === '' || whole(c.bundles)) && (c.pieces === '' || whole(c.pieces)) && (c.kg === '' || (isFinite(Number(c.kg)) && Number(c.kg) >= 0)) && !(c.bundles === '' && c.kg === '' && c.pieces === '');
  const worstOf = list => (list.indexOf('SHORT') >= 0 ? 'SHORT' : list.indexOf('OVER') >= 0 ? 'OVER' : 'MATCH');

  // Demo data: one bin with two SKU lines (same shape as the Stock On Hand tab).
  const DEMO_BIN = { bin: 'A-01-01', warehouse: 'WH I1', lastCount: '', lastStatus: '', accuracy: null, lines: [
    { material: '1100000231', desc: 'INTANU G300AZ30 BR 1200x0.220', batch: 'D261023018', sloc: '1020', uom: 'KG', pcsPerBundle: 1, book: 4750 },
    { material: 'SK-1002', desc: 'Steel bar 16mm', batch: 'B2611-09', sloc: 'WH01', uom: 'PC', pcsPerBundle: 30, book: 600 },
  ] };
  const DEMO_LIST = [
    { bin: 'A-01-01', warehouse: 'WH I1', lastCount: '', lastStatus: '', accuracy: null, lines: 2 },
    { bin: 'B-02-05', warehouse: 'WH OB', lastCount: '2026-11-08 14:30', lastStatus: 'SHORT', accuracy: 60, lines: 1 },
  ];

  const S = { list: [], bins: [], stock: [], user: null, view: 'home', bin: null, mode: '', result: null, photo: '', signedOut: false, blocked: '' };

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
  const demoLines = () => (S.bin ? S.bin.lines : []);

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
    if (DEMO) { S.list = DEMO_LIST.slice(); S.user = { name: 'Demo' }; return route(); }
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
    S.user = b.user; S.list = b.today || []; S.bins = b.bins || []; S.stock = b.stock || [];
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
    if (S.view === 'bin' && S.bin) return binScreen();
    if (S.view === 'count' && S.bin) return lineScreen('count');
    if (S.view === 'out' && S.bin) return lineScreen('out');
    if (S.view === 'result' && S.result) return resultScreen();
    return homeScreen();
  }
  function blockedScreen(title, text) {
    view(`<div class="card blocked"><div class="emoji">🔒</div><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <a class="btn" href="../">${T('ទៅទំព័រដើម', 'Go to the home menu')}</a></div>`);
  }

  function homeScreen() {
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
      ${S.loadError ? `<div class="card err"><b>⚠️ ${T('ផ្ទុកទិន្នន័យមិនបាន', 'Could not load the data')}</b><p class="muted">${esc(S.loadError)}</p><button type="button" class="btn ghost" id="retry">${T('ព្យាយាមម្តងទៀត', 'Try again')}</button></div>` : ''}
      ${q.length ? `<div class="card"><span class="pill">${q.length} ${T('រង់ចាំផ្ញើ', 'waiting to send')}</span> <button type="button" class="btn ghost" id="sendQ">${T('ផ្ញើឥឡូវ', 'Send now')}</button></div>` : ''}
      <h2>${T('បញ្ជីរាប់ថ្ងៃនេះ', "Today's count list")} (${S.list.length})</h2>
      ${list || `<p class="muted">${T('មិនទាន់មានកុងតឺន័រ។', 'No bins yet.')}</p>`}
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
    if (DEMO) { scanner.timer = setTimeout(() => { stopScan(); openBin(DEMO_BIN.bin); }, 1200); return; }
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
    if (DEMO) { b = key === DEMO_BIN.bin ? JSON.parse(JSON.stringify(DEMO_BIN)) : null; }
    else if (S.bins.length) b = localBin(key);
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
    const rows = (b.lines || []).map(l => `<tr><td>${esc(l.material)}</td><td>${esc(l.desc)}</td><td>${esc(l.batch)}</td><td>${esc(l.sloc)}</td><td>${l.book}</td></tr>`).join('');
    view(`
      <section class="card hero"><div class="bin">${esc(b.bin)}</div><div class="muted">${esc(b.warehouse)} · ${accText(b.accuracy)} ${T('ភាពត្រឹមត្រូវ', 'accuracy')}</div></section>
      <section class="card"><table class="lines"><tr><th>${T('កូដ', 'Material')}</th><th>${T('បរិយាយ', 'Description')}</th><th>Batch</th><th>SLOC</th><th>${T('ក្នុងស្តុក', 'On hand')}</th></tr>${rows}</table></section>
      <div class="tri">
        <a class="btn ok" href="../inbound/">1<br>In</a>
        <button type="button" class="btn warn" id="actOut">2<br>Out</button>
        <button type="button" class="btn" id="actCount">3<br>Count</button>
      </div>
      <div class="note muted">${T('In: ទៅកម្មវិធីទទួលទំនិញ (ការងារ PO និងការដាក់ចូលកុងតឺន័រ)។', 'In: opens the Inbound app (PO, scan, put-away).')}</div>
      <button type="button" class="btn ghost big" id="back">${T('ត្រឡប់', 'Back')}</button>`);
    $('#actOut').onclick = () => { S.mode = 'out'; S.view = 'out'; route(); };
    $('#actCount').onclick = () => { S.mode = 'count'; S.view = 'count'; S.photo = ''; route(); };
    $('#back').onclick = () => { S.view = 'home'; S.bin = null; route(); };
  }

  // Count or Out: a table of every SKU line in the bin, one submit.
  function lineScreen(mode) {
    const b = S.bin;
    const isCount = mode === 'count';
    const rows = (b.lines || []).map((l, i) => isCount
      ? `<tr class="desc"><td colspan="4">${esc(l.desc)}</td></tr>
        <tr><td>${esc(l.material)}<br><small class="muted">Batch: ${esc(l.batch)}</small><br><small class="muted">${T('ក្នុងស្តុក', 'On hand')} ${l.book} ${esc(l.uom)}</small></td>
        <td><input type="number" inputmode="numeric" min="0" data-i="${i}" data-f="bundles"></td>
        <td><input type="number" inputmode="decimal" min="0" step="any" data-i="${i}" data-f="kg"></td>
        <td><input type="number" inputmode="numeric" min="0" data-i="${i}" data-f="pieces"></td></tr>`
      : `<tr>
        <td>${esc(l.material)}<br><small class="muted">${esc(l.desc)}</small><br><small class="muted">${esc(l.batch)} · ${esc(l.sloc)}</small></td>
        <td>${l.book}</td>
        <td><input type="number" inputmode="numeric" min="0" data-i="${i}" data-f="outQty"></td><td class="diff" data-i="${i}">—</td>
      </tr>`).join('');
    view(`
      <section class="card hero"><div class="bin">${esc(b.bin)}</div><div class="muted">${isCount ? T('រាប់ស្តុកគ្រប់ប្រភេទក្នុងកុងតឺន័រ', 'Count every SKU in this bin') : T('ចេញស្តុកពីកុងតឺន័រ', 'Stock out from this bin')}</div></section>
      <section class="card" style="overflow-x:auto"><table class="lines">${isCount
        ? `<tr><th colspan="4" class="cap">${T('ចំនួនរាប់បាន', 'Counted Qty')}</th></tr><tr><th>${T('កូដ/សម្ភារៈ', 'Code/Material')}</th><th>${T('បាច់', 'Bundle')}</th><th>Kg</th><th>${T('បំណែក', 'Pcs')}</th></tr>`
        : `<tr><th>${T('កូដ', 'Material')}</th><th>${T('ក្នុងស្តុក', 'On hand')}</th><th>${T('ចំនួនចេញ', 'Out Qty')}</th><th>${T('នៅសល់', 'After')}</th></tr>`}${rows}</table></section>
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
          if (!lineOk(c)) { ok = false; return; }
          statuses.push(statusOf(countedQty(c, l.uom, l.pcsPerBundle) - l.book, 0));   // no Diff column (Kim), status only for the photo rule
        } else {
          const v = document.querySelector(`[data-i="${i}"][data-f="outQty"]`).value;
          if (v === '') { cell.textContent = '—'; return; }   // blank line = no out
          if (!whole(v) || Number(v) === 0 || Number(v) > l.book) { cell.textContent = '!'; ok = false; return; }
          cell.textContent = l.book - Number(v);
        }
      });
      if (isCount) {
        needPhoto = ok && needsPhoto(worstOf(statuses));
        $('#photoBox').hidden = !needPhoto;
        $('#photoRow').classList.toggle('need', needPhoto && !S.photo);
        $('#needTxt').textContent = needPhoto && !S.photo ? T('ត្រូវថតរូបមុនបញ្ជូន', 'Photo needed before submit') : '';
      }
      $('#submit').disabled = !ok || (needPhoto && !S.photo) || (!isCount && !anyOut());
    };
    const anyOut = () => (b.lines || []).some((l, i) => Number((document.querySelector(`[data-i="${i}"][data-f="outQty"]`) || {}).value) > 0);
    document.querySelectorAll('.lines input').forEach(el => { el.oninput = refresh; });
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
      if (isCount) return Object.assign(base, { bundles: document.querySelector(`[data-i="${i}"][data-f="bundles"]`).value, kg: document.querySelector(`[data-i="${i}"][data-f="kg"]`).value, pieces: document.querySelector(`[data-i="${i}"][data-f="pieces"]`).value });
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
    (out.lines || []).forEach(l => { const s = S.stock.find(x => String(x.bin).toUpperCase() === b.bin.toUpperCase() && x.material === l.material); if (s) s.book = l.counted; });
    S.result = { title: T('បានរក្សាទុក', 'Saved'), status: out.status, lines: out.lines, accuracy: out.accuracy, offline: !!out.offline, kind: 'count' };
    S.view = 'result'; S.photo = ''; route();
  }

  function demoCount(b, lines) {
    const out = (b.lines || []).map((l, i) => {
      const counted = countedQty(lines[i], l.uom, l.pcsPerBundle);
      const diff = counted - l.book;
      return { material: l.material, desc: l.desc, uom: l.uom, book: l.book, counted: counted, diff: diff, status: statusOf(diff, 0) };
    });
    b.lines.forEach((l, i) => { l.book = out[i].counted; });   // book qty changes right away (demo)
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
      : `<tr><td>${esc(l.material)}</td><td>${l.book}</td><td>${l.counted}</td><td><span class="badge ${l.status}">${l.diff > 0 ? '+' : ''}${l.diff}</span></td></tr>`).join('');
    view(`
      <section class="card hero" style="text-align:center">
        <div class="emoji" style="font-size:40px">${r.status === 'OUT' || r.status === 'MATCH' ? '✅' : r.status === 'SHORT' ? '⚠️' : '🔶'}</div>
        <div class="bin">${esc(r.title)}</div>
        ${r.kind === 'count' ? `<span class="badge ${r.status}">${statusLabel(r.status)}</span>` : ''}
        ${r.offline ? `<p class="muted" style="margin-top:10px">${T('បានរក្សាទុកក្នុងទូរស័ព្ទ។ នឹងផ្ញើនៅពេលមានអ៊ីនធឺណិត។', 'Saved on this phone. It will be sent when you are online.')}</p>` : ''}
      </section>
      <table class="lines">${r.kind === 'out' ? `<tr><th>Material</th><th>Out</th><th>After</th></tr>` : `<tr><th>Material</th><th>Book</th><th>Counted</th><th>Diff</th></tr>`}${rows}</table>
      <div style="height:12px"></div>
      <button type="button" class="btn big ok" id="next">${T('ត្រឡប់ទៅបញ្ជី', 'Back to list')}</button>`);
    $('#next').onclick = () => { S.view = 'home'; S.bin = null; S.result = null; route(); };
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
