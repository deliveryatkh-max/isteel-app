// Agent Data Entry (Kim, 31 Oct 2026): weighing ticket image or PDF → the 8 yellow fields → Excel.
// 1 Upload  2 Review & Edit  3 Save Data to Table / Send to Google Sheet / Save to Local File / Send Excel to Email.
// Reading is done on this computer by Tesseract (free, no AI service, nothing leaves the browser until you send it).
// The table lives in this browser (localStorage). The local Excel file is written into a folder Kim picks once
// (Chrome / Edge on a computer). Google Sheet and email go through the Apps Script in apps-script-dataentry/.
(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const t = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { toast('⚠️ ' + t('ទំហំផ្ទុកពេញ', 'Browser storage is full')); } };
  const CFG = window.DE_CONFIG || {};
  const LIVE = !!CFG.API_URL;
  const TOKEN_KEY = 'fr_id_token';      // the sign-in shared by every app on this site
  const REC_KEY = 'de_records', SET_KEY = 'de_settings', BOOT_KEY = 'de_boot';
  const VENDOR = window.DE_VENDOR || new URL('../vendor/', location.href).href;   // the demo page sets its own

  // ------------------------------------------------------------------ helpers
  const pad = n => String(n).padStart(2, '0');
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ymd(new Date());
  const showDate = s => { const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? m[3] + '-' + MON[+m[2] - 1] + '-' + m[1] : ''; };
  const showTime = s => { const m = String(s || '').match(/(\d\d):(\d\d)/); if (!m) return ''; const h = +m[1]; return pad(h % 12 || 12) + ':' + m[2] + (h < 12 ? ' AM' : ' PM'); };
  const toDate = s => { const m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?/); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null; };
  const minutes = r => { const a = toDate(r.inTime), b = toDate(r.outTime); return a && b && b >= a ? Math.round((b - a) / 60000) : null; };
  const showMin = m => m == null ? '' : m >= 60 ? Math.floor(m / 60) + ' ' + t('ម៉ោង', 'H') + ' ' + pad(m % 60) + ' ' + t('នាទី', 'MIN') : m + ' ' + t('នាទី', 'MIN');
  const kg = n => n == null || n === '' || isNaN(n) ? '' : Number(n).toLocaleString('en-US');
  const toNum = v => { const s = String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''); return s === '' ? null : Number(s); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const decodeJwt = tk => { try { return JSON.parse(decodeURIComponent(escape(atob(tk.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; } };
  const claims = () => decodeJwt(get(TOKEN_KEY) || '');
  const signedIn = () => { const c = claims(); return !!(c && c.exp * 1000 > Date.now()); };
  const me = () => { const c = claims(); return (BOOT && BOOT.user && BOOT.user.name) || (c && c.email) || ''; };

  let toastTimer = 0;
  function toast(msg, ms) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2800);
  }
  function busy(btn, on) {
    if (!btn) return;
    if (on) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="sp"></span>' + btn.innerHTML; }
    else { btn.disabled = false; if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
  }

  // ------------------------------------------------------------------ stored data
  const FIELDS = ['vehicle', 'company', 'ticket', 'gross', 'tare', 'net', 'date', 'inTime', 'outTime'];
  const OPTIONAL = ['company'];
  // Company: looked up from the Vehicle No in the Fuel Refill sheet "Driver & Truck" (column G plate → column E company), Kim 31 Oct 2026.
  // The exact plate wins (3B5956 → 3PL #1); otherwise the plate without dashes or spaces (3B-5956 = 3B5956).
  const trucks = () => (BOOT && BOOT.trucks) || window.DE_TRUCKS || [];
  function companyOf(plate) {
    const p = String(plate || '').toUpperCase().trim(); if (!p) return '';
    const T = trucks(); const loose = s => String(s).toUpperCase().replace(/[\s\-.]/g, '');
    const hit = T.find(x => String(x[0]).toUpperCase().trim() === p) || T.find(x => loose(x[0]) === loose(p));
    return hit ? hit[1] : '';
  }
  const companies = () => Array.from(new Set(trucks().map(x => x[1]).filter(Boolean))).sort();
  let RECS = []; try { RECS = JSON.parse(get(REC_KEY) || '[]'); } catch (e) { RECS = []; }
  let SET = { fileName: 'Weight_Scale_Data.xlsx', emailTo: '', folderName: '' };
  try { Object.assign(SET, JSON.parse(get(SET_KEY) || '{}')); } catch (e) { /* defaults */ }
  let BOOT = null; try { BOOT = JSON.parse(get(BOOT_KEY) || 'null'); } catch (e) { BOOT = null; }
  const saveRecs = () => set(REC_KEY, JSON.stringify(RECS));
  const saveSet = () => set(SET_KEY, JSON.stringify(SET));
  const byTicket = (no, skip) => RECS.find(r => r.ticket && r.ticket === no && r.id !== skip);
  const sorted = () => RECS.slice().sort((a, b) => String(b.inTime || b.date).localeCompare(String(a.inTime || a.date)) || b.savedAt - a.savedAt);

  // The local folder (File System Access API) is kept in IndexedDB so it is picked only once.
  const idb = () => new Promise((res, rej) => { const q = indexedDB.open('de_db', 1); q.onupgradeneeded = () => q.result.createObjectStore('h'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const idbGet = async k => { const db = await idb(); return new Promise(res => { const q = db.transaction('h').objectStore('h').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); };
  const idbPut = async (k, v) => { const db = await idb(); return new Promise(res => { const tx = db.transaction('h', 'readwrite'); tx.objectStore('h').put(v, k); tx.oncomplete = res; tx.onerror = res; }); };

  // ------------------------------------------------------------------ API (Apps Script)
  async function api(action, payload) {
    let data;
    try {
      const res = await fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: get(TOKEN_KEY), payload: payload || {} }) });
      data = await res.json();
    } catch (e) { throw Object.assign(new Error(t('មិនអាចភ្ជាប់អ៊ីនធឺណិត។ សូមព្យាយាមម្តងទៀត។', 'No connection. Please try again.')), { code: 'NET' }); }
    if (!data.ok) {
      const raw = String(data.error || '');
      const code = (raw.match(/^([A-Z_]+):/) || [])[1] || '';
      const parts = raw.replace(/^[A-Z_]+:\s*/, '').split(' || ');
      throw Object.assign(new Error(parts.length > 1 ? t(parts[1], parts[0]) : parts[0]), { code });
    }
    if (data.session) set(TOKEN_KEY, data.session);
    return data.data;
  }
  async function boot() {
    if (!LIVE || !signedIn()) return;
    try { BOOT = await api('boot'); set(BOOT_KEY, JSON.stringify(BOOT)); paintTabs(); if (!isAdmin() && /settings/.test(location.hash)) location.hash = '#/entry'; if (!SET.emailTo && BOOT.emailTo) { SET.emailTo = BOOT.emailTo; saveSet(); } paintBanner(); syncSheet(); }
    catch (e) { if (e.code === 'AUTH' || e.code === 'NOACCESS') { BOOT = null; set(BOOT_KEY, null); blocked(e); } }
  }
  function blocked(e) {
    $('#view').innerHTML = `<div class="card done"><div class="emoji">🔒</div><h2>${e.code === 'NOACCESS' ? t('មិនទាន់មានសិទ្ធិ', 'No access yet') : t('សូមចូលគណនីនៅទំព័រដើម', 'Please sign in on the home menu')}</h2>
      <p>${esc(e.message || '')}</p><a class="btn ok" href="../">${t('ទៅទំព័រដើម', 'Go to the home menu')}</a></div>`;
    BLOCKED = true;
  }
  let BLOCKED = false;
  const needServer = () => { if (LIVE) return true; toast('⚙️ ' + t('Google Sheet មិនទាន់ភ្ជាប់។ មើល ការកំណត់។', 'Google Sheet is not connected yet. See Settings.'), 4000); return false; };

  // ------------------------------------------------------------------ OCR engine (loaded on first use, then cached by the browser)
  let ocrReady = null;
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); }); }
  function engine() {
    if (!ocrReady) {
      ocrReady = (async () => {
        if (!window.Tesseract) await loadScript(VENDOR + 'tesseract/tesseract.min.js');
        return Tesseract.createWorker('eng', 1, {
          workerPath: window.DE_WORKER || VENDOR + 'tesseract/worker.min.js', corePath: VENDOR + 'tesseract/', langPath: VENDOR + 'tesseract',
          gzip: true, workerBlobURL: false, cacheMethod: 'write',
        });
      })();
      ocrReady.catch(() => { ocrReady = null; });
    }
    return ocrReady;
  }
  let pdfReady = null;
  function pdfjs() {
    if (!pdfReady) pdfReady = loadScript(VENDOR + 'pdfjs/pdf.min.js').then(() => { pdfjsLib.GlobalWorkerOptions.workerSrc = VENDOR + 'pdfjs/pdf.worker.min.js'; return pdfjsLib; });
    pdfReady.catch(() => { pdfReady = null; });
    return pdfReady;
  }

  // Black and white copy for reading: the yellow marker and grey paper turn white, ink stays black.
  function forOcr(src) {
    const W0 = src.width, H0 = src.height;
    let k = 1;
    if (W0 < 1500) k = Math.min(4, 1600 / W0); else if (W0 > 2600) k = 2400 / W0;
    const c = document.createElement('canvas'); c.width = Math.round(W0 * k); c.height = Math.round(H0 * k);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height);
    const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 4) { const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); d[i] = g; hist[g]++; }
    // Otsu threshold, kept between 110 and 185 so a few dark marks do not wash out the text.
    const total = c.width * c.height; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, th = 150;
    for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = i; } }
    th = Math.max(110, Math.min(185, th));
    for (let i = 0; i < d.length; i += 4) { const v = d[i] > th ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
    x.putImageData(img, 0, 0);
    return c;
  }

  // ------------------------------------------------------------------ upload queue
  // One item per image or PDF page: { id, name, url (preview), canvas, state: wait|reading|done|err|saved, f (fields), checks, raw, rec (saved record id) }
  let Q = [], CUR = -1, EDIT = null;   // EDIT = id of a saved record opened from the table
  const cur = () => (CUR >= 0 ? Q[CUR] : null);

  async function addFiles(files) {
    files = Array.from(files || []).filter(f => /^image\//.test(f.type) || /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
    if (!files.length) { toast('⚠️ ' + t('សូមជ្រើសរូបភាព ឬ PDF', 'Please choose an image or a PDF')); return; }
    engine();   // start loading the reader now
    const first = Q.length;
    for (const f of files) {
      try {
        if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
          const lib = await pdfjs();
          const doc = await lib.getDocument({ data: await f.arrayBuffer() }).promise;
          for (let p = 1; p <= Math.min(doc.numPages, 50); p++) {
            const page = await doc.getPage(p);
            const v1 = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: Math.min(4, 2200 / v1.width) });
            const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
            const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: x, viewport: vp }).promise;
            Q.push(item(f.name + (doc.numPages > 1 ? ' · p' + p : ''), c));
          }
        } else {
          const bmp = await loadImage(f);
          const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
          c.getContext('2d').drawImage(bmp, 0, 0);
          Q.push(item(f.name, c));
        }
      } catch (e) { console.error(e); toast('⚠️ ' + t('មិនអាចបើក ', 'Could not open ') + f.name); }
    }
    if (Q.length > first) { CUR = first; EDIT = null; renderEntry(); readAll(); }
  }
  function loadImage(f) {
    return new Promise((res, rej) => { const u = URL.createObjectURL(f); const i = new Image(); i.onload = () => { res(i); }; i.onerror = () => rej(new Error('image')); i.src = u; });
  }
  function item(name, canvas) {
    return { id: uid(), name, canvas, url: preview(canvas), state: 'wait', f: blank(), checks: {}, raw: null, rec: null };
  }
  // Smaller JPEG for the screen, the table and Drive (max 1400 px wide).
  function preview(c) {
    const k = Math.min(1, 1400 / c.width);
    if (k === 1) return c.toDataURL('image/jpeg', 0.8);
    const s = document.createElement('canvas'); s.width = Math.round(c.width * k); s.height = Math.round(c.height * k);
    const x = s.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, s.width, s.height);
    return s.toDataURL('image/jpeg', 0.8);
  }
  const blank = () => ({ vehicle: '', company: '', ticket: '', gross: '', tare: '', net: '', date: '', inTime: '', outTime: '' });

  // Read the waiting tickets one after another (the one on screen first).
  let reading = false;
  async function readAll() {
    if (reading) return; reading = true;
    try {
      for (;;) {
        const c = cur();
        const next = c && c.state === 'wait' ? c : Q.find(q => q.state === 'wait');
        if (!next) break;
        await readOne(next);
      }
    } finally { reading = false; }
  }
  async function readOne(q) {
    q.state = 'reading'; paintQueue(); progress(q, 0.02, t('កំពុងរៀបចំកម្មវិធីអាន…', 'Getting the reader ready…'));
    try {
      const w = await engine();
      const img = forOcr(q.canvas);
      const r = await TicketOCR.read(w, img, img.width, img.height, (p, step) => progress(q, p, stepName(step)));
      const f = r.fields;
      q.f = { vehicle: f.vehicle || '', company: companyOf(f.vehicle), ticket: f.ticket || '', gross: f.gross == null ? '' : f.gross, tare: f.tare == null ? '' : f.tare, net: f.net == null ? '' : f.net,
        date: f.date || '', inTime: f.inTime || '', outTime: f.outTime || '' };
      q.checks = r.checks; q.raw = r.raw; q.state = 'done';
      progress(q, 1, r.anchors >= 2 ? '✅ ' + t('អានរួច។ សូមពិនិត្យលេខក្នុងជំហាន ២។', 'Read. Please check the values in step 2.')
        : '⚠️ ' + t('រកមិនឃើញទម្រង់ប័ណ្ណថ្លឹង។ សូមពិនិត្យ ឬវាយបញ្ចូលដោយដៃ។', 'This does not look like the usual weighing ticket. Please check or type the values.'));
    } catch (e) {
      console.error(e); q.state = 'err';
      progress(q, 0, '⚠️ ' + t('អានមិនបាន។ សូមវាយបញ្ចូលដោយដៃ។', 'Could not read it. Please type the values.') + ' (' + (e.message || e) + ')');
    }
    paintQueue();
    if (q === cur() && !EDIT) paintForm();
  }
  const stepName = s => ({ page: t('កំពុងអានទំព័រ…', 'Reading the page…'), date: t('កាលបរិច្ឆេទ', 'Date'), vehicle: t('លេខឡាន', 'Vehicle no'), ticket: t('លេខប័ណ្ណ', 'Ticket no'),
    gross: 'Gross', tare: 'Tare', net: 'Net', inTime: t('ម៉ោងចូល', 'In time'), outTime: t('ម៉ោងចេញ', 'Out time'), done: '' }[s] || s);
  function progress(q, p, msg) {
    q.p = p; q.msg = msg;
    if (q !== cur()) return;
    const bar = $('#pbar'), m = $('#pmsg');
    if (bar) bar.style.width = Math.round(p * 100) + '%';
    if (m) m.textContent = msg || '';
    const b = $('#extractBtn'); if (b) b.disabled = q.state === 'reading';
  }

  // ------------------------------------------------------------------ screens
  let screen = () => {};
  // Settings are for admins only (Kim, 31 Oct 2026): Role = admin in Users. Without the Google Sheet link (demo) everyone is admin.
  // Without the Google Sheet link (demo) the banner lets you try each role.
  const demoRole = () => get('de_demo_role') || 'admin';
  const isAdmin = () => (!LIVE ? demoRole() === 'admin' : !!(BOOT && BOOT.user && BOOT.user.admin));
  // Edit and Delete of saved tickets: Role Reviewer or Admin only (Kim, 31 Oct 2026).
  const canEdit = () => (!LIVE ? demoRole() !== 'user' : !!(BOOT && BOOT.user && (BOOT.user.admin || BOOT.user.reviewer)));
  function paintTabs() { const s = $('nav.tabs .tab[data-r="settings"]'); if (s) s.hidden = !isAdmin(); $('nav.tabs').style.gridTemplateColumns = 'repeat(' + $$('nav.tabs .tab:not([hidden])').length + ', 1fr)'; }
  function route() {
    if (BLOCKED) return;
    const h = location.hash.replace(/^#\/?/, '') || 'entry';
    $$('nav.tabs .tab[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === h));
    if (h === 'report') return renderReport();
    if (h === 'settings') return isAdmin() ? renderSettings() : (location.hash = '#/entry');
    return renderEntry();
  }

  // ---------- Data Entry ----------
  function renderEntry() {
    screen = renderEntry;
    const q = cur();
    const er = EDIT && RECS.find(x => x.id === EDIT);
    const pic = er ? er.img : q && q.url;
    $('#view').innerHTML = `
      <div class="de-grid">
        <div class="de-col">
          <section class="card"><h2 class="ch"><span class="l"><span class="n">1</span>📄 ${t('ផ្ទុកប័ណ្ណថ្លឹង', 'Upload Ticket')}</span>
            ${Q.length > 1 ? `<small>${CUR + 1} / ${Q.length}</small>` : ''}</h2>
            <div class="cb">
              ${er && !pic ? `<div class="empty">🖼️ ${t('រូបភាពមិនបានរក្សាទុកក្នុងកុំព្យូទ័រនេះ', 'The picture is not kept on this computer')} (${esc(er.file || '')})</div>` : ''}
              ${pic ? `<div class="prev"><img id="prevImg" src="${pic}" alt="">${er ? '' : `<button type="button" class="x" id="clearBtn" title="${t('ដកចេញ', 'Remove')}">✕</button>`}<span class="pg">${esc(er ? er.file || er.ticket : q.name)}</span></div>`
                : er ? ''
                : `<div class="drop" id="drop"><div class="big">📸</div><b>${t('ចុចដើម្បីជ្រើសរូបភាព ឬ PDF', 'Click to choose an image or PDF')}</b>
                   <span>${t('ឬអូសឯកសារមកទីនេះ · ឬ Ctrl+V បិទភ្ជាប់រូបថតអេក្រង់', 'or drag files here · or Ctrl+V to paste a screenshot')}</span>
                   <span>${t('អាចជ្រើសច្រើនក្នុងពេលតែមួយ', 'You can choose many at once')}</span>
                   ${window.DE_SAMPLE ? `<button type="button" class="btn sm" id="sampleBtn">🧪 ${t('សាកល្បងជាមួយប័ណ្ណគំរូ', 'Try the sample ticket')}</button>` : ''}</div>`}
              <div class="queue" id="queue"></div>
            </div>
          </section>
          <section class="card"><div class="cb">
            <button type="button" class="btn extract" id="extractBtn" ${q ? '' : 'disabled'}>🤖 ${t('ទាញទិន្នន័យ', 'Extract Data')}</button>
            <div class="progress"><i id="pbar"></i></div><div class="pmsg" id="pmsg"></div>
          </div></section>
        </div>
        <div class="de-col">
          <section class="card"><h2 class="ch"><span class="l"><span class="n">2</span>✏️ ${t('ពិនិត្យ និងកែទិន្នន័យ', 'Review & Edit Data')}</span>${EDIT ? `<small>✎ ${t('កំពុងកែកំណត់ត្រា', 'Editing a saved record')}</small>` : ''}</h2>
            <div class="cb"><div class="fgrid" id="form">
              ${fld('vehicle', t('លេខឡាន', 'Vehicle No'), 'text', 'plate')}
              ${fld('company', t('ក្រុមហ៊ុន', 'Company'), 'text', '', '', true)}
              ${fld('ticket', t('លេខប័ណ្ណ', 'Ticket No.'), 'text', '', 'numeric')}
              ${fld('gross', t('ទម្ងន់សរុប (គ.ក)', 'Gross (kg)'), 'text', '', 'numeric')}
              ${fld('tare', t('ទម្ងន់យាន្ត (គ.ក)', 'Tare (kg)'), 'text', '', 'numeric')}
              ${fld('net', t('ទម្ងន់សុទ្ធ (គ.ក)', 'Net (kg)'), 'text', '', 'numeric')}
              ${fld('date', t('កាលបរិច្ឆេទឯកសារ', 'Document Date'), 'date')}
              ${fld('inTime', t('ម៉ោងចូល', 'In Date/Time'), 'datetime-local')}
              ${fld('outTime', t('ម៉ោងចេញ', 'Out Date/Time'), 'datetime-local')}
              <div><label>⏱️ ${t('រយៈពេលសរុប', 'Total Time')}</label><input class="in auto" id="f_total" readonly tabindex="-1"></div>
            </div><div class="checks" id="checks"></div></div>
          </section>
          <section class="card"><h2 class="ch"><span class="l"><span class="n">3</span>💾 ${t('រក្សាទុក', 'Save')}</span></h2>
            <div class="cb">
              <div class="acts">
                <button type="button" class="btn b-save" id="aSave">＋ ${t('រក្សាទុកក្នុងតារាង', 'Save Data to Table')}</button>
              </div>
              <div class="hint">${t('រក្សាទុកហើយ វាទៅ Google Sheet ដោយខ្លួនឯង។ ឯកសារ Excel និងអ៊ីមែល នៅទំព័រ របាយការណ៍', 'Saved tickets go to the Google Sheet by themselves. Excel file and email are on the Report page')}</div>
            </div>
          </section>
        </div>
      </div>
      ${tableCard(sorted().slice(0, 30), t('កំណត់ត្រាក្នុងកុំព្យូទ័រនេះ', 'Local Data Records'), RECS.length)}`;
    wireEntry();
    paintQueue(); paintForm();
    if (q) progress(q, q.p || 0, q.msg || '');
  }
  const FEMO = { company: '🏢', vehicle: '🚚', ticket: '🎫', gross: '⚖️', tare: '🛻', net: '📦', date: '📅', inTime: '🟢', outTime: '🔴' };
  function fld(k, label, type, cls, mode, list) {
    return `<div><label for="f_${k}">${FEMO[k] || ''} ${label} ${OPTIONAL.indexOf(k) < 0 ? '<span class="req">*</span>' : ''}</label><input class="in ${cls || ''}" id="f_${k}" data-k="${k}" type="${type}" ${type === 'datetime-local' ? 'step="1"' : ''} ${mode ? `inputmode="${mode}"` : ''} ${list ? `list="dl_${k}"` : ''} autocomplete="off">${list ? `<datalist id="dl_${k}">${companies().map(c => `<option value="${esc(c)}">`).join('')}</datalist><div class="hint" id="h_${k}"></div>` : ''}</div>`;
  }
  function wireEntry() {
    const drop = $('#drop');
    if (drop) {
      drop.onclick = () => $('#fileIn').click();
      const sb = $('#sampleBtn');
      if (sb) sb.onclick = async e => { e.stopPropagation(); const b = await (await fetch(window.DE_SAMPLE)).blob(); addFiles([new File([b], 'sample-ticket.png', { type: 'image/png' })]); };
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
    }
    const clear = $('#clearBtn');
    if (clear) clear.onclick = () => { Q.splice(CUR, 1); CUR = Math.min(CUR, Q.length - 1); EDIT = null; renderEntry(); };
    const pi = $('#prevImg'); if (pi) pi.onclick = () => zoom(pi.src);
    $('#extractBtn').onclick = () => { const q = cur(); if (!q) return; q.state = 'wait'; EDIT = null; readAll(); };
    $$('#form .in[data-k]').forEach(el => { el.oninput = () => { grab(); paintChecks(); }; });
    $('#f_vehicle').onblur = e => { e.target.value = e.target.value.toUpperCase().trim(); grab(); };
    // Company follows the Vehicle No unless someone typed a different company by hand.
    $('#f_vehicle').addEventListener('input', () => { const c = $('#f_company'); const auto = companyOf($('#f_vehicle').value); if (!c.value || c.dataset.auto === c.value) { c.value = auto; c.dataset.auto = auto; grab(); } paintCompanyHint(); });
    $('#f_company').addEventListener('input', paintCompanyHint);
    ['gross', 'tare', 'net', 'ticket'].forEach(k => { $('#f_' + k).onblur = e => { const n = toNum(e.target.value); e.target.value = n == null ? '' : (k === 'ticket' ? String(n) : kg(n)); grab(); paintChecks(); }; });
    $('#aSave').onclick = () => act('table', $('#aSave'));
    wireTable();
  }
  function paintQueue() {
    const el = $('#queue'); if (!el) return;
    if (!Q.length) { el.innerHTML = ''; return; }
    el.innerHTML = Q.map((q, i) => {
      const st = q.state === 'saved' ? ['saved', '✓'] : q.state === 'done' ? ['done', '•'] : q.state === 'err' ? ['err', '!'] : q.state === 'reading' ? ['', '…'] : ['', ''];
      return `<button type="button" data-q="${i}" class="${i === CUR ? 'on' : ''}" style="background-image:url('${q.url}')" title="${esc(q.name)}">${st[1] ? `<em class="qs ${st[0]}">${st[1]}</em>` : ''}</button>`;
    }).join('') + `<button type="button" class="add" id="addMore" title="${t('បន្ថែម', 'Add more')}">＋</button>`;
    $$('[data-q]', el).forEach(b => { b.onclick = () => { grab(); CUR = +b.dataset.q; EDIT = null; renderEntry(); }; });
    $('#addMore').onclick = () => $('#fileIn').click();
  }
  // Values on screen <-> the current ticket (or the saved record being edited).
  function formTarget() { if (EDIT) { const r = RECS.find(x => x.id === EDIT); return r || null; } const q = cur(); return q ? q.f : null; }
  function paintForm() {
    const f = formTarget() || blank();
    FIELDS.forEach(k => {
      const el = $('#f_' + k); if (!el) return;
      let v = f[k] == null ? '' : f[k];
      if (k === 'inTime' || k === 'outTime') v = String(v).replace(' ', 'T');
      if (['gross', 'tare', 'net'].indexOf(k) >= 0 && v !== '') v = kg(v);
      el.value = v;
      el.classList.remove('unsure');
    });
    const q = cur();
    if (!EDIT && q && q.state === 'done' && q.raw) {   // boxes the reader could not read itself are marked yellow
      FIELDS.forEach(k => { const raw = q.raw[k] || ''; if (!raw && $('#f_' + k)) $('#f_' + k).classList.add('unsure'); });
    }
    $('#f_company').dataset.auto = companyOf(f.vehicle);
    paintCompanyHint();
    paintChecks();
  }
  function paintCompanyHint() {
    const h = $('#h_company'); if (!h) return;
    const v = $('#f_vehicle').value.trim(), auto = companyOf(v), c = $('#f_company').value.trim();
    h.textContent = !v ? '' : auto ? (c === auto ? '✓ ' + t('ពីតារាង Driver & Truck', 'From the Driver & Truck list') : '') : '⚠️ ' + t('រកមិនឃើញក្នុង Driver & Truck · វាយបញ្ចូលដោយដៃ', 'Not in the Driver & Truck list · type it');
  }
  function grab() {
    const f = formTarget(); if (!f || !$('#form')) return;
    FIELDS.forEach(k => {
      const el = $('#f_' + k); if (!el) return;
      let v = el.value.trim();
      if (k === 'vehicle') v = v.toUpperCase();
      if (['gross', 'tare', 'net'].indexOf(k) >= 0) v = toNum(v) == null ? '' : toNum(v);
      if (k === 'ticket') v = v.replace(/[^0-9A-Za-z\-]/g, '');
      if ((k === 'inTime' || k === 'outTime') && v) { v = v.replace('T', ' '); if (v.length === 16) v += ':00'; }
      f[k] = v;
    });
  }
  function paintChecks() {
    const f = formTarget();
    FIELDS.forEach(k => { const el = $('#f_' + k); if (el) el.classList.toggle('need', !!f && OPTIONAL.indexOf(k) < 0 && !el.value.trim()); });
    const box = $('#checks'); if (!box) return;
    if (!f) { box.innerHTML = ''; $('#f_total').value = ''; return; }
    const m = minutes(f);
    $('#f_total').value = showMin(m);
    const out = [];
    const g = toNum(f.gross), ta = toNum(f.tare), n = toNum(f.net);
    if (g != null && ta != null && n != null) {
      out.push(g - ta === n ? `<div class="chk ok">✓ Gross − Tare = Net (${kg(g)} − ${kg(ta)} = ${kg(n)})</div>`
        : `<div class="chk bad">⚠️ Gross − Tare = ${kg(g - ta)}, ${t('តែ Net គឺ', 'but Net is')} ${kg(n)}. ${t('សូមពិនិត្យលេខ', 'Please check the numbers')}.</div>`);
    }
    if (f.inTime && f.outTime && m == null) out.push(`<div class="chk bad">⚠️ ${t('ម៉ោងចេញមុនម៉ោងចូល', 'Out time is before In time')}</div>`);
    else if (m != null && m > 12 * 60) out.push(`<div class="chk warn">⚠️ ${t('ឡាននៅក្នុងរោងចក្រលើស ១២ ម៉ោង', 'Truck was inside more than 12 hours')}</div>`);
    if (f.date && f.inTime && f.inTime.slice(0, 10) !== f.date) out.push(`<div class="chk warn">⚠️ ${t('ថ្ងៃម៉ោងចូល ខុសពីកាលបរិច្ឆេទឯកសារ', 'In date is not the document date')}</div>`);
    const dup = f.ticket && byTicket(f.ticket, EDIT || (cur() && cur().rec));
    if (dup) out.push(`<div class="chk warn">⚠️ ${t('លេខប័ណ្ណនេះមានក្នុងតារាងរួចហើយ', 'This ticket number is already in the table')} (${esc(dup.vehicle)} · ${showDate(dup.date)}). ${canEdit() ? t('រក្សាទុកនឹងជំនួសវា', 'Saving replaces it') : t('មានតែ Reviewer ឬ Admin ទេដែលអាចកែបាន', 'Only a Reviewer or Admin can change it')}.</div>`);
    box.innerHTML = out.join('');
  }

  // ------------------------------------------------------------------ Save / send
  function missing(f) { return FIELDS.filter(k => OPTIONAL.indexOf(k) < 0 && (f[k] === '' || f[k] == null)); }
  // Puts the ticket on screen into the table (new or replacing the same ticket number). Returns the record.
  function toTable() {
    grab();
    const f = formTarget();
    if (!f) { toast('⚠️ ' + t('សូមផ្ទុកប័ណ្ណថ្លឹងជាមុន', 'Please upload a ticket first')); return null; }
    const miss = missing(f);
    if (miss.length) { paintChecks(); toast('⚠️ ' + t('សូមបំពេញប្រអប់ពណ៌ក្រហម', 'Please fill the red boxes')); const el = $('#f_' + miss[0]); if (el) el.focus(); return null; }
    const dup = f.ticket && byTicket(f.ticket, EDIT || (cur() && cur().rec));
    if (dup && !canEdit()) { toast('⚠️ ' + t('លេខប័ណ្ណនេះមានរួចហើយ។ មានតែ Reviewer ឬ Admin ទេដែលអាចកែបាន។', 'This ticket number is already saved. Only a Reviewer or Admin can change it.'), 5000); return null; }
    if (EDIT && !canEdit()) { EDIT = null; return null; }
    if (EDIT) { const r = RECS.find(x => x.id === EDIT); r.mins = minutes(r); r.sheet = false; r.local = false; r.updatedAt = Date.now(); dropDup(r); saveRecs(); return r; }
    const q = cur();
    let r = q.rec && RECS.find(x => x.id === q.rec);
    if (!r) { r = { id: uid(), savedAt: Date.now(), by: me(), file: q.name }; RECS.push(r); q.rec = r.id; }
    Object.assign(r, f, { mins: minutes(f), sheet: false, local: false, updatedAt: Date.now(), img: q.url });
    dropDup(r); stripImages();
    q.state = 'saved';
    try { saveRecs(); } catch (e) { /* toast in set() */ }
    return r;
  }
  function dropDup(r) { RECS = RECS.filter(x => x.id === r.id || x.ticket !== r.ticket); }
  // The ticket image is kept only until it is in the Google Sheet (it goes to Drive), so the browser does not fill up.
  function stripImages() {
    RECS.forEach(r => { if (r.sheet && r.img) delete r.img; });
    const withImg = RECS.filter(r => r.img).sort((a, b) => b.updatedAt - a.updatedAt);
    withImg.slice(15).forEach(r => { delete r.img; });
  }

  async function act(kind, btn) {
    const r = toTable(); if (!r) return;
    if (kind === 'table') { stripImages(); saveRecs(); toast('✅ ' + t('បានរក្សាទុកក្នុងតារាង', 'Saved to the table') + ' · ' + r.ticket); next(); syncSheet(); return; }
    if (kind === 'sheet') { if (!needServer()) { renderEntry(); return; } busy(btn, true); try { await toSheet([r]); toast('✅ ' + t('បានផ្ញើទៅ Google Sheet', 'Sent to the Google Sheet') + ' · ' + r.ticket); next(); } catch (e) { toast('⚠️ ' + e.message, 5000); renderEntry(); } return; }
    if (kind === 'file') { busy(btn, true); try { const n = await toLocalFile([r]); if (n) { toast('✅ ' + t('បានរក្សាទុកក្នុង ', 'Saved in ') + n, 4000); next(); } else renderEntry(); } catch (e) { console.error(e); toast('⚠️ ' + e.message, 6000); renderEntry(); } return; }
  }
  // After saving: the next ticket that is not saved yet, or an empty form.
  function next() {
    EDIT = null;
    const i = Q.findIndex((q, j) => j > CUR && q.state !== 'saved');
    const k = i >= 0 ? i : Q.findIndex(q => q.state !== 'saved');
    if (k >= 0) CUR = k; else { Q = []; CUR = -1; }
    renderEntry();
    readAll();
  }

  // Saved tickets go to the Google Sheet by themselves in the background (Kim, 31 Oct 2026: no Send button).
  let SYNCING = false;
  async function syncSheet() {
    if (!LIVE || !signedIn() || SYNCING || !navigator.onLine) return;
    const l = RECS.filter(r => !r.sheet); if (!l.length) return;
    SYNCING = true;
    try { await toSheet(l); if (/report/.test(location.hash)) renderReport(); }
    catch (e) { if (e.code && e.code !== 'NET') toast('⚠️ Google Sheet: ' + e.message, 5000); }
    finally { SYNCING = false; }
  }
  window.addEventListener('online', () => syncSheet());
  setInterval(() => syncSheet(), 60000);

  async function toSheet(list) {
    const rows = list.map(r => ({ id: r.id, ticket: r.ticket, vehicle: r.vehicle, company: r.company || '', date: r.date, gross: r.gross, tare: r.tare, net: r.net, inTime: r.inTime, outTime: r.outTime, mins: minutes(r), file: r.file || '', by: r.by || me(), img: r.img || '' }));
    const out = [];
    for (let i = 0; i < rows.length; i += 10) out.push(await api('save', { rows: rows.slice(i, i + 10) }));   // 10 at a time keeps each call small
    list.forEach(r => { r.sheet = true; r.sentAt = Date.now(); });
    stripImages(); saveRecs();
    return out;
  }

  // ---------- Excel ----------
  const XCOLS = ['Ticket No', 'Vehicle No', 'Company', 'Document Date', 'Gross (kg)', 'Tare (kg)', 'Net (kg)', 'In Date/Time', 'Out Date/Time', 'Total Time (min)', 'Total Time', 'Source File', 'Entered By', 'Entered At'];
  const hhmm = m => (m == null ? '' : Math.floor(m / 60) + ':' + pad(m % 60));
  function xRow(r) {
    const m = minutes(r);
    return [r.ticket, r.vehicle, r.company || '', toDate(r.date), toNum(r.gross), toNum(r.tare), toNum(r.net), toDate(r.inTime), toDate(r.outTime), m, hhmm(m), r.file || '', r.by || '', new Date(r.updatedAt || r.savedAt || Date.now())];
  }
  function sheetOf(rows) {
    const ws = XLSX.utils.aoa_to_sheet([XCOLS].concat(rows), { cellDates: true });
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = 1; R <= range.e.r; R++) {
      const fm = { 3: 'dd-mmm-yyyy', 4: '#,##0', 5: '#,##0', 6: '#,##0', 7: 'dd-mmm-yyyy hh:mm:ss', 8: 'dd-mmm-yyyy hh:mm:ss', 13: 'dd-mmm-yyyy hh:mm' };
      Object.keys(fm).forEach(C => { const c = ws[XLSX.utils.encode_cell({ r: R, c: +C })]; if (c && c.v !== '' && c.v != null) c.z = fm[C]; });
      const tk = ws[XLSX.utils.encode_cell({ r: R, c: 0 })]; if (tk) { tk.t = 's'; tk.v = String(tk.v); }
    }
    ws['!cols'] = [12, 12, 16, 14, 11, 11, 11, 20, 20, 10, 10, 26, 22, 18].map(w => ({ wch: w }));
    ws['!autofilter'] = { ref: ws['!ref'] };
    return ws;
  }
  function workbook(list) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetOf(list.map(xRow)), 'Weighing Tickets');
    return wb;
  }
  const xlsxBytes = wb => XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
  function download(list, name) {
    const blob = new Blob([xlsxBytes(workbook(list))], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (window.DE_SAVE) { window.DE_SAVE(name, blob).catch(e => toast('⚠️ ' + (e && e.message || e))); return; }   // demo page
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // Local file: one Excel file in the folder Kim picked (e.g. ...\00. Data Warehouse\Weight Scale Data).
  // Rows already in the file stay; a ticket number already there is replaced by the new values.
  const canFolder = () => typeof window.showDirectoryPicker === 'function' && !window.DE_NOFOLDER;
  async function folder(ask) {
    let dir = await idbGet('dir').catch(() => null);
    if (dir) {
      let p = await dir.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted' && ask) p = await dir.requestPermission({ mode: 'readwrite' });
      if (p === 'granted') return dir;
      if (!ask) return null;
    }
    if (!ask) return null;
    dir = await window.showDirectoryPicker({ id: 'weight-scale', mode: 'readwrite' });
    await idbPut('dir', dir); SET.folderName = dir.name; saveSet();
    return dir;
  }
  async function toLocalFile(list) {
    const name = (SET.fileName || 'Weight_Scale_Data.xlsx').replace(/[\\/:*?"<>|]/g, '').replace(/(\.xlsx)?$/i, '.xlsx');
    if (!canFolder()) {   // phone, Safari, Firefox: download instead
      download(list, name);
      list.forEach(r => { r.local = true; }); saveRecs();
      toast('⬇️ ' + t('កម្មវិធីរុករកនេះមិនអាចសរសេរក្នុង folder បានទេ៖ បានទាញយកជំនួស', 'This browser cannot write to a folder: downloaded instead'), 5000);
      return name;
    }
    let dir;
    try { dir = await folder(true); } catch (e) { if (e.name === 'AbortError') return null; throw e; }
    if (!dir) return null;
    const fh = await dir.getFileHandle(name, { create: true });
    let rows = [];
    const file = await fh.getFile();
    if (file.size) {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const ws = wb.Sheets['Weighing Tickets'] || wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const head = (aoa[0] || []).map(String);
      const ix = XCOLS.map(c => head.indexOf(c));
      rows = aoa.slice(1).filter(r => r.some(v => v !== '')).map(r => ix.map(i => (i >= 0 ? r[i] : '')));
    }
    const keep = new Set(list.map(r => String(r.ticket)));
    rows = rows.filter(r => !keep.has(String(r[0])));
    rows = rows.concat(list.map(xRow));
    rows.sort((a, b) => (a[7] instanceof Date && b[7] instanceof Date ? a[7] - b[7] : 0));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheetOf(rows), 'Weighing Tickets');
    let w;
    try { w = await fh.createWritable(); } catch (e) { throw new Error(t('ឯកសារ Excel កំពុងបើក។ សូមបិទវាក្នុង Excel ហើយព្យាយាមម្តងទៀត។', 'The Excel file is open. Close it in Excel and try again.')); }
    await w.write(new Blob([xlsxBytes(wb)])); await w.close();
    list.forEach(r => { r.local = true; }); saveRecs();
    return dir.name + '\\' + name;
  }

  // ---------- Email ----------
  function mailPanel(fromReport) {
    const box = $('#panel'); if (!box) return;
    if (box.innerHTML) { box.innerHTML = ''; return; }
    const q = cur();
    box.innerHTML = `<div class="panel">
      <label class="f" for="mTo">${t('ផ្ញើទៅ (អ៊ីមែល បំបែកដោយក្បៀស)', 'Send to (emails, comma separated)')} <span class="req">*</span></label>
      <input class="in" id="mTo" type="text" inputmode="email" value="${esc(SET.emailTo || '')}" placeholder="name@isi-group.com">
      <div class="row">
        <select class="in" id="mWhich" style="width:auto">
          ${!fromReport && (q || EDIT) ? `<option value="this">${t('ប័ណ្ណនេះ', 'This ticket')}</option>` : ''}
          ${fromReport ? `<option value="shown">${t('ដែលបង្ហាញក្នុងរបាយការណ៍', 'Shown in the report')}</option>` : ''}
          <option value="today">${t('ថ្ងៃនេះ', 'Today')} (${RECS.filter(r => r.date === today()).length})</option>
          <option value="new">${t('មិនទាន់ផ្ញើ', 'Not emailed yet')} (${RECS.filter(r => !r.mailed).length})</option>
          <option value="all">${t('ទាំងអស់', 'All records')} (${RECS.length})</option>
        </select>
        <button type="button" class="btn ok sm" id="mSend">✉️ ${t('ផ្ញើ', 'Send')}</button>
        <button type="button" class="btn sm" id="mDl">⬇️ ${t('ទាញយក Excel', 'Download Excel')}</button>
      </div></div>`;
    const pick = () => {
      const w = $('#mWhich').value;
      if (w === 'this') { const r = toTable(); return r ? [r] : null; }
      if (w === 'shown') return REPORT_ROWS;
      if (w === 'today') return RECS.filter(r => r.date === today());
      if (w === 'new') return RECS.filter(r => !r.mailed);
      return RECS.slice();
    };
    $('#mDl').onclick = () => { const l = pick(); if (!l || !l.length) return toast(t('គ្មានកំណត់ត្រា', 'No records')); download(l, 'Weighing_Tickets_' + today() + '.xlsx'); };
    $('#mSend').onclick = async () => {
      const to = $('#mTo').value.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
      $('#mTo').classList.toggle('need', !to.length);
      if (!to.length) return toast('⚠️ ' + t('សូមវាយអ៊ីមែល', 'Please type an email'));
      if (to.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) return toast('⚠️ ' + t('អ៊ីមែលមិនត្រឹមត្រូវ', 'An email address is not valid'));
      const l = pick(); if (!l) return; if (!l.length) return toast(t('គ្មានកំណត់ត្រា', 'No records'));
      if (!needServer()) return;
      const btn = $('#mSend'); busy(btn, true);
      try {
        const bytes = xlsxBytes(workbook(l));
        let bin = ''; const u8 = new Uint8Array(bytes); for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
        const sum = l.reduce((s, r) => s + (toNum(r.net) || 0), 0);
        await api('email', { to, fileName: 'Weighing_Tickets_' + today() + '.xlsx', xlsx: btoa(bin), count: l.length, net: sum,
          first: l.map(r => r.date).sort()[0], last: l.map(r => r.date).sort().slice(-1)[0] });
        l.forEach(r => { r.mailed = true; }); saveRecs();
        SET.emailTo = to.join(', '); saveSet();
        toast('✅ ' + t('បានផ្ញើអ៊ីមែល ', 'Email sent: ') + l.length + t(' ប័ណ្ណ', ' tickets'), 4000);
        $('#panel').innerHTML = '';
      } catch (e) { toast('⚠️ ' + e.message, 5000); } finally { busy(btn, false); }
    };
  }

  // ---------- Records table ----------
  function tableCard(list, title, total) {
    return `<div class="tcard"><div class="thead"><b>🗂️ ${title}</b>${screen === renderEntry && total ? `<a class="seeall" href="#/report">${t('មើលទាំងអស់', 'See all')} →</a>` : ''}<span class="cnt">${total} ${t('កំណត់ត្រា', total === 1 ? 'Record' : 'Records')}</span></div>
      <div class="tscroll">${list.length ? `<table class="rec"><thead><tr>
        <th>${t('លេខឡាន', 'Vehicle No')}</th><th>${t('ក្រុមហ៊ុន', 'Company')}</th><th>${t('លេខប័ណ្ណ', 'Ticket No')}</th><th class="r">Gross</th><th class="r">Tare</th><th class="r">Net</th>
        <th>${t('កាលបរិច្ឆេទ', 'Document Date')}</th><th>${t('ម៉ោងចូល', 'In Time')}</th><th>${t('ម៉ោងចេញ', 'Out Time')}</th><th>${t('រយៈពេល', 'Total Time')}</th>
        <th title="${t('តារាង · Google Sheet · ឯកសារ · អ៊ីមែល', 'Table · Google Sheet · Local file · Email')}">${t('ស្ថានភាព', 'Sent')}</th><th></th></tr></thead><tbody>
        ${list.map(r => { const m = minutes(r); return `<tr class="${r.id === EDIT ? 'cur' : ''}">
          <td><b>${esc(r.vehicle)}</b></td><td>${esc(r.company || '')}</td><td>${esc(r.ticket)}</td><td class="r">${kg(r.gross)} kg</td><td class="r">${kg(r.tare)} kg</td><td class="r net">${kg(r.net)} kg</td>
          <td>${showDate(r.date)}</td><td>${showTime(r.inTime)}</td><td>${showTime(r.outTime)}</td><td class="${m > 120 ? 'long' : ''}">${showMin(m)}</td>
          <td class="st"><span title="Google Sheet" class="${r.sheet ? '' : 'off'}">📤</span><span title="${t('ឯកសារ Excel', 'Local file')}" class="${r.local ? '' : 'off'}">💾</span><span title="Email" class="${r.mailed ? '' : 'off'}">✉️</span></td>
          <td>${canEdit() ? `<button type="button" class="ib" data-edit="${r.id}" title="${t('កែ', 'Edit')}">✎</button><button type="button" class="ib" data-del="${r.id}" title="${t('លុប', 'Delete')}">🗑️</button>` : ''}</td></tr>`; }).join('')}
        </tbody></table>` : `<div class="empty">${t('មិនទាន់មានកំណត់ត្រា', 'No records yet')}</div>`}</div></div>`;
  }
  function wireTable() {
    if (!canEdit()) return;
    $$('[data-edit]').forEach(b => { b.onclick = () => { grab(); EDIT = b.dataset.edit; if (location.hash !== '#/entry') location.hash = '#/entry'; else renderEntry(); window.scrollTo({ top: 0, behavior: 'smooth' }); }; });
    $$('[data-del]').forEach(b => { b.onclick = () => {
      const r = RECS.find(x => x.id === b.dataset.del); if (!r) return;
      if (!confirm(t('លុបប័ណ្ណ ', 'Delete ticket ') + r.ticket + ' (' + r.vehicle + ')?' + (r.sheet ? t('\nវានៅតែមានក្នុង Google Sheet។', '\nIt stays in the Google Sheet.') : ''))) return;
      RECS = RECS.filter(x => x.id !== r.id); if (EDIT === r.id) EDIT = null; saveRecs(); screen();
    }; });
  }

  // ---------- Report ----------
  let REPORT_ROWS = [];
  const RF = { from: '', to: '', q: '', p: '', co: '' };
  const DAYS = [['អាទិត្យ', 'Sunday'], ['ច័ន្ទ', 'Monday'], ['អង្គារ', 'Tuesday'], ['ពុធ', 'Wednesday'], ['ព្រហស្បតិ៍', 'Thursday'], ['សុក្រ', 'Friday'], ['សៅរ៍', 'Saturday']];
  const hourName = h => pad(h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
  function period(k) {
    const d = new Date(); RF.p = k;
    if (k === 'today') { RF.from = RF.to = today(); }
    else if (k === 'week') { const s0 = new Date(d); s0.setDate(d.getDate() - ((d.getDay() + 6) % 7)); RF.from = ymd(s0); RF.to = today(); }
    else if (k === 'month') { const s0 = new Date(d.getFullYear(), d.getMonth(), 1); RF.from = ymd(s0); RF.to = today(); }
    else { RF.from = ''; RF.to = ''; }
  }
  function renderReport() {
    screen = renderReport;
    if (!RF.p) period('month');
    const ql = RF.q.toLowerCase();
    REPORT_ROWS = sorted().filter(r => (!RF.co || (RF.co === '-' ? !r.company : r.company === RF.co)) && (!RF.from || r.date >= RF.from) && (!RF.to || r.date <= RF.to) && (!ql || (r.vehicle + ' ' + r.ticket + ' ' + (r.company || '') + ' ' + (r.file || '')).toLowerCase().indexOf(ql) >= 0));
    const L = REPORT_ROWS, ms = L.map(minutes).filter(m => m != null);
    const net = L.reduce((s, r) => s + (toNum(r.net) || 0), 0);
    const avg = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
    const trucks = new Set(L.map(r => r.vehicle)).size;
    // Trucks arriving per hour (like a "crowd rate"), 6 AM to 8 PM, and the busiest weekday.
    const hrs = []; for (let h = 6; h <= 20; h++) hrs.push(h);
    const byH = {}; L.forEach(r => { const d = toDate(r.inTime); if (d) byH[d.getHours()] = (byH[d.getHours()] || 0) + 1; });
    const maxH = Math.max.apply(null, [1].concat(hrs.map(h => byH[h] || 0)));
    const peak = hrs.reduce((p, h) => ((byH[h] || 0) > (byH[p] || 0) ? h : p), hrs[0]);
    const byD = [0, 0, 0, 0, 0, 0, 0]; L.forEach(r => { const d = toDate(r.date); if (d) byD[d.getDay()]++; });
    const topD = byD.indexOf(Math.max.apply(null, byD));
    // Trucks with the most tickets
    const per = {}; L.forEach(r => { const p = per[r.vehicle] || (per[r.vehicle] = { n: 0, net: 0, min: [], co: r.company || '' }); p.n++; p.net += toNum(r.net) || 0; const m = minutes(r); if (m != null) p.min.push(m); });
    const top = Object.keys(per).map(v => Object.assign({ v }, per[v])).sort((a, b) => b.n - a.n || b.net - a.net).slice(0, 6);
    const chip = (k, km, en, e) => `<button type="button" class="pill ${RF.p === k ? 'on' : ''}" data-p="${k}">${e} ${t(km, en)}</button>`;
    $('#view').innerHTML = `
      <div class="rhead"><small>${t('របាយការណ៍ប័ណ្ណថ្លឹង', 'Weighing ticket report')}</small><h1>📊 ${t('របាយការណ៍', 'Report')}</h1></div>
      <div class="searchbox"><span>🔍</span><input id="rQ" value="${esc(RF.q)}" placeholder="${t('ស្វែងរកលេខឡាន លេខប័ណ្ណ ឬក្រុមហ៊ុន…', 'Search vehicle, ticket or company…')}"></div>
      <div class="pills">${chip('today', 'ថ្ងៃនេះ', 'Today', '☀️')}${chip('week', 'សប្តាហ៍នេះ', 'This week', '📆')}${chip('month', 'ខែនេះ', 'This month', '🗓️')}${chip('all', 'ទាំងអស់', 'All', '♾️')}${chip('custom', 'ជ្រើសថ្ងៃ', 'Pick dates', '🎯')}
        <select class="pill cosel ${RF.co ? 'on' : ''}" id="rCo" aria-label="${t('ក្រុមហ៊ុន', 'Company')}">
          <option value="">🏢 ${t('គ្រប់ក្រុមហ៊ុន', 'All companies')}</option>
          ${Array.from(new Set(RECS.map(r => r.company).filter(Boolean).concat(companies()))).sort().map(c => `<option value="${esc(c)}" ${RF.co === c ? 'selected' : ''}>🏢 ${esc(c)}</option>`).join('')}
          <option value="-" ${RF.co === '-' ? 'selected' : ''}>❔ ${t('គ្មានក្រុមហ៊ុន', 'No company')}</option>
        </select></div>
      <div class="fbar" ${RF.p === 'custom' ? '' : 'hidden'}>
        <div><label for="rFrom">${t('ពីថ្ងៃ', 'From')}</label><input class="in" type="date" id="rFrom" value="${RF.from}"></div>
        <div><label for="rTo">${t('ដល់ថ្ងៃ', 'To')}</label><input class="in" type="date" id="rTo" value="${RF.to}"></div>
      </div>
      <div class="stats">
        <div class="stat"><i>🎫</i><small>${t('ប័ណ្ណថ្លឹង', 'Tickets')}</small><b>${L.length}</b></div>
        <div class="stat"><i>🚚</i><small>${t('ឡាន', 'Trucks')}</small><b>${trucks}</b></div>
        <div class="stat"><i>📦</i><small>${t('ទម្ងន់សុទ្ធសរុប', 'Total net')}</small><b>${(net / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}<em>t</em></b></div>
        <div class="stat"><i>⏱️</i><small>${t('មធ្យមក្នុងរោងចក្រ', 'Avg time inside')}</small><b>${avg == null ? '–' : avg}<em>${t('នាទី', 'min')}</em></b></div>
        <div class="stat"><i>🐢</i><small>${t('យូរជាងគេ', 'Longest')}</small><b>${ms.length ? Math.max.apply(null, ms) : '–'}<em>${t('នាទី', 'min')}</em></b></div>
      </div>
      <button type="button" class="pill showcharts" id="rCharts">${get('de_charts') === '1' ? '🙈 ' + t('លាក់ក្រាហ្វ', 'Hide charts') : '📈 ' + t('បង្ហាញក្រាហ្វ (ម៉ោង · ឡានច្រើនជាងគេ)', 'Show charts (by hour · top trucks)')}</button>
      <div class="rgrid" ${get('de_charts') === '1' ? '' : 'hidden'}>
        <section class="rcard"><h3>🕒 ${t('ឡានចូលតាមម៉ោង', 'Trucks in by hour')}</h3>
          <div class="crowd">${hrs.map(h => { const n = byH[h] || 0; return `<div class="col ${n && h === peak ? 'peak' : ''}" title="${hourName(h)}: ${n}"><span class="v">${n || ''}</span><i style="height:${Math.max(8, Math.round(n / maxH * 100))}%"></i><small>${h % 12 || 12}${h < 12 ? 'a' : 'p'}</small></div>`; }).join('')}</div>
          <p class="note">${L.length ? `${t('ម៉ោងមមាញឹកបំផុត', 'Busiest hour')} <b>${hourName(peak)}</b> · ${t('ថ្ងៃមមាញឹកបំផុត', 'busiest day')} <b>${t(DAYS[topD][0], DAYS[topD][1])}</b>` : t('មិនទាន់មានទិន្នន័យ', 'No data yet')}</p>
        </section>
        <section class="rcard"><h3>🏆 ${t('ឡានដែលថ្លឹងច្រើនជាងគេ', 'Top trucks')}</h3>
          ${top.length ? top.map(p => `<div class="act"><span class="sq">🚚</span><div><b>${esc(p.v)}</b><small>${p.co ? '🏢 ' + esc(p.co) + ' · ' : ''}${p.n} ${t('ប័ណ្ណ', p.n === 1 ? 'ticket' : 'tickets')} · ${t('មធ្យម', 'avg')} ${p.min.length ? Math.round(p.min.reduce((a, b) => a + b, 0) / p.min.length) : '–'} ${t('នាទី', 'min')}</small></div><strong>${(p.net / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} t</strong></div>`).join('') : `<p class="note">${t('មិនទាន់មានទិន្នន័យ', 'No data yet')}</p>`}
        </section>
      </div>
      <div class="pills acts2">
        <button type="button" class="pill" id="rDl">⬇️ ${t('ទាញយក Excel', 'Download Excel')}</button>
        <button type="button" class="pill" id="rFile">💾 ${t('រក្សាទុកក្នុងឯកសារ Excel', 'Save to Local File')}</button>
        <button type="button" class="pill" id="rMail">✉️ ${t('ផ្ញើ Excel តាមអ៊ីមែល', 'Send Excel to Email')}</button>
        <button type="button" class="pill dnbtn" id="rDn" title="${t('ជ្រើសក្រុមហ៊ុនមួយជាមុន', 'Pick one company first')}">🧾 ${t('បង្កើត Debit Note', 'Debit Note')}</button>
      </div>
      <div id="panel"></div>
      ${tableCard(L, t('ប័ណ្ណថ្លឹង', 'Weighing tickets'), L.length)}`;
    // The two charts stay hidden until someone clicks Show (Kim, 31 Oct 2026); the choice is remembered.
    $('#rCo').onchange = e => { RF.co = e.target.value; renderReport(); };
    $('#rCharts').onclick = () => { set('de_charts', get('de_charts') === '1' ? '0' : '1'); renderReport(); };
    $$('[data-p]').forEach(b => { b.onclick = () => { if (b.dataset.p === 'custom') { RF.p = 'custom'; if (!RF.from) period('month'), RF.p = 'custom'; } else period(b.dataset.p); renderReport(); }; });
    const re = () => { RF.from = $('#rFrom').value; RF.to = $('#rTo').value; RF.q = $('#rQ').value.trim(); const pos = $('#rQ').selectionStart; const focus = document.activeElement && document.activeElement.id; renderReport(); if (focus) { const el = $('#' + focus); el.focus(); if (focus === 'rQ') el.setSelectionRange(pos, pos); } };
    $('#rFrom').onchange = re; $('#rTo').onchange = re; $('#rQ').oninput = re;
    $('#rDl').onclick = () => L.length ? download(L, 'Weighing_Tickets_' + (RF.from || 'all') + '_' + (RF.to || '') + '.xlsx') : toast(t('គ្មានកំណត់ត្រា', 'No records'));
    $('#rFile').onclick = async () => { if (!L.length) return toast(t('គ្មានកំណត់ត្រា', 'No records')); const b = $('#rFile'); busy(b, true); try { const n = await toLocalFile(L); if (n) toast('✅ ' + L.length + t(' ប័ណ្ណ → ', ' tickets → ') + n, 4000); } catch (e) { toast('⚠️ ' + e.message, 6000); } busy(b, false); renderReport(); };
    $('#rMail').onclick = () => mailPanel(true);
    $('#rDn').onclick = () => {
      if (!RF.co || RF.co === '-') { toast('🏢 ' + t('សូមជ្រើសក្រុមហ៊ុនមួយជាមុន (ប្រអប់ All companies)', 'Pick one company first (the All companies box)'), 4000); $('#rCo').focus(); return; }
      if (!L.length) return toast(t('គ្មានកំណត់ត្រា', 'No records'));
      dnPanel(L);
    };
    if (DN_OPEN && RF.co && RF.co !== '-' && L.length) dnPanel(L); else DN_OPEN = false;
    wireTable();
  }

  // ---------- Debit Note (Kim, 31 Oct 2026) ----------
  // Prices come from the "Price List" tab: 3PL Company | Destination | Charge Per (per t / per trip) | Price | UoM.
  // The header boxes (customer, tel, GL, cost center, agent, vendor ID) are remembered per company on this computer.
  let DN_OPEN = false;
  const prices = () => (BOOT && BOOT.prices) || window.DE_PRICES || [];
  // GL Code and Cost Center lists come from the sheet tabs "GL Code" and "Cost Center": [code, description].
  const glList = () => (BOOT && BOOT.gl) || window.DE_GL || [];
  const ccList = () => (BOOT && BOOT.cc) || window.DE_CC || [];
  const pick = (id, list, val) => list.length
    ? `<select class="in" id="${id}"><option value="">—</option>${list.map(r => `<option value="${esc(r[0])}" ${String(r[0]) === String(val) ? 'selected' : ''}>${esc(r[0])}${r[1] ? ' · ' + esc(r[1]) : ''}</option>`).join('')}${val && !list.some(r => String(r[0]) === String(val)) ? `<option selected>${esc(val)}</option>` : ''}</select>`
    : `<input class="in" id="${id}" value="${esc(val || '')}">`;
  // Debit Note No runs in sequence: <DES>-MT-<MM>-<YY>-01, -02 … per destination and month.
  // The last number used is kept in the sheet tab "Debit Notes" (shared) and on this computer.
  const dnSeqs = () => { try { return JSON.parse(get('de_dn_seq') || '{}'); } catch (e) { return {}; } };
  const lastSeq = pre => Math.max(+(dnSeqs()[pre] || 0), +((BOOT && BOOT.dnSeq && BOOT.dnSeq[pre]) || 0));
  const useSeq = (pre, n) => { const m = dnSeqs(); if (n > (+m[pre] || 0)) { m[pre] = n; set('de_dn_seq', JSON.stringify(m)); } if (BOOT) { BOOT.dnSeq = BOOT.dnSeq || {}; if (n > (+BOOT.dnSeq[pre] || 0)) BOOT.dnSeq[pre] = n; } };
  const perTrip = r => /trip|truck/i.test(String(r[2]) + ' ' + String(r[4]));
  const money = n => (n == null || isNaN(n) ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const shortDate = s => { const d = toDate(s); return d ? pad(d.getDate()) + '-' + MON[d.getMonth()].charAt(0) + MON[d.getMonth()].slice(1).toLowerCase() + '-' + String(d.getFullYear()).slice(2) : ''; };
  function dnPanel(L) {
    DN_OPEN = true;
    const co = RF.co;
    const key = 'de_dn_' + co;
    let H = {}; try { H = JSON.parse(get(key) || '{}'); } catch (e) { H = {}; }
    const P = prices().filter(r => String(r[0]).trim().toLowerCase() === co.toLowerCase());
    const dests = Array.from(new Set(P.map(r => r[1]).filter(Boolean)));
    if (!H.dest || dests.indexOf(H.dest) < 0) H.dest = dests[0] || H.dest || '';
    const rates = () => P.filter(r => r[1] === H.dest);
    if (H.rate == null || !rates()[H.rate]) H.rate = 0;
    const now = new Date();
    const dnPre = () => { const d = toDate(H.date) || now; return (String(H.dest || 'DN').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'DN') + '-MT-' + pad(d.getMonth() + 1) + '-' + String(d.getFullYear()).slice(2); };
    const dnNo = () => dnPre() + '-' + pad(lastSeq(dnPre()) + 1);
    H.agent = co;   // Transportation Agent = the 3PL company
    const items = L.slice().sort((a, b) => String(a.inTime || a.date).localeCompare(String(b.inTime || b.date)));
    const OV = {};   // per-trip price or remark typed in the table
    const box = $('#panel');
    function draw() {
      const R0 = rates()[H.rate];
      const trip = R0 ? perTrip(R0) : false;
      const base = R0 ? Number(R0[3]) : null;
      let tq = 0, ta = 0;
      const rows = items.map((r, i) => {
        const q = (toNum(r.net) || 0) / 1000;
        const o = OV[r.id] || {};
        const pr = o.price != null && o.price !== '' ? Number(o.price) : base;
        const amt = pr == null ? null : Math.round((trip ? pr : q * pr) * 100) / 100;
        tq += q; ta += amt || 0;
        return { r, i, q, pr, amt, remark: o.remark || '' };
      });
      box.innerHTML = `<div class="panel dn">
        <div class="dnhead"><h3>🧾 Debit Note · ${esc(co)}</h3><button type="button" class="pill" id="dnX">✕</button></div>
        ${P.length ? '' : `<div class="chk warn">⚠️ ${t('រកមិនឃើញតម្លៃសម្រាប់', 'No price found for')} ${esc(co)} ${t('ក្នុង Price List', 'in the Price List')}. ${t('វាយតម្លៃក្នុងតារាងខាងក្រោម', 'Type the prices in the table below')}.</div>`}
        <div class="dngrid">
          <div><label>📍 ${t('ដឹកទៅ', 'Goods Delivery to')}</label><input class="in" id="dn_dest" list="dl_dest" value="${esc(H.dest)}"><datalist id="dl_dest">${dests.map(d => `<option value="${esc(d)}">`).join('')}</datalist></div>
          <div><label>💲 ${t('តម្លៃពី Price List', 'Price from the Price List')}</label><select class="in" id="dn_rate">${rates().map((r, i) => `<option value="${i}" ${i === H.rate ? 'selected' : ''}>${esc(r[2])} · $${money(r[3])} / ${esc(r[4])}</option>`).join('') || `<option>${t('គ្មាន', 'None')}</option>`}</select></div>
          <div><label>🔢 No</label><input class="in" id="dn_no" value="${esc(H.no || dnNo())}" title="${t('លេខរត់បន្តបន្ទាប់', 'Next number in sequence')}"></div>
          <div><label>📅 Date</label><input class="in" type="date" id="dn_date" value="${esc(H.date || today())}"></div>
          <div><label>👤 Customer</label><input class="in" id="dn_customer" value="${esc(H.customer || '')}"></div>
          <div><label>📞 Tel</label><input class="in" id="dn_tel" value="${esc(H.tel || '')}"></div>
          <div><label>🧑‍✈️ Transportation Agent</label><input class="in" id="dn_agent" value="${esc(co)}" readonly></div>
          <div><label>🆔 Vendor ID</label><input class="in" id="dn_vendorId" value="${esc(H.vendorId || '')}"></div>
          <div><label>📒 GL</label>${pick('dn_gl', glList(), H.gl == null ? '65009030' : H.gl)}</div>
          <div><label>🏷️ Cost Center</label>${pick('dn_costCenter', ccList(), H.costCenter || '')}</div>
        </div>
        <div class="tscroll"><table class="rec dnt"><thead><tr><th>ល.រ</th><th>Date</th><th>Truck No.</th><th class="r">Q'ty (Mt)</th><th class="r">USD/MT</th><th class="r">USD/Truck</th><th class="r">Total Amount</th><th>${t('ផ្សេងៗ', 'Remark')}</th></tr></thead><tbody>
          ${rows.map(x => `<tr><td>${x.i + 1}</td><td>${shortDate(x.r.date)}</td><td>${esc(x.r.vehicle)}</td><td class="r">${x.q.toFixed(3)}</td>
            <td class="r">${trip ? '' : `<input class="in pr" data-pr="${x.r.id}" value="${x.pr == null ? '' : x.pr}" inputmode="decimal">`}</td>
            <td class="r">${trip ? `<input class="in pr" data-pr="${x.r.id}" value="${x.pr == null ? '' : x.pr}" inputmode="decimal">` : ''}</td>
            <td class="r"><b>${x.amt == null ? '' : '$ ' + money(x.amt)}</b></td><td><input class="in rm" data-rm="${x.r.id}" value="${esc(x.remark)}"></td></tr>`).join('')}
          <tr class="tot"><td colspan="3"><b>Total:</b></td><td class="r"><b>${tq.toFixed(3)}</b></td><td></td><td></td><td class="r"><b>$ ${money(ta)}</b></td><td></td></tr>
        </tbody></table></div>
        <div class="pills" style="margin:12px 0 0"><button type="button" class="pill on" id="dnWord">📄 ${t('ទាញយក Word', 'Download Word (.docx)')}</button>
          <span class="hint">${t('ពុម្ព Word កែបាននៅ ការកំណត់ (Admin)', 'The Word template can be changed in Settings (admin)')}</span></div>
      </div>`;
      const keep = () => { ['dest', 'no', 'date', 'customer', 'tel', 'agent', 'vendorId', 'gl', 'costCenter'].forEach(k => { H[k] = $('#dn_' + k).value.trim(); }); H.agent = co; set(key, JSON.stringify(Object.assign({}, H, { no: '', date: '' }))); };
      $('#dnX').onclick = () => { DN_OPEN = false; box.innerHTML = ''; };
      $('#dn_dest').onchange = () => { keep(); H.rate = 0; H.no = ''; setTimeout(draw, 0); };
      $('#dn_date').onchange = () => { const auto = !H.no || H.no === dnNo(); keep(); if (auto) H.no = ''; setTimeout(draw, 0); };
      $('#dn_rate').onchange = e => { keep(); H.rate = +e.target.value || 0; Object.keys(OV).forEach(k => { delete OV[k].price; }); setTimeout(draw, 0); };
      $$('.dn .dngrid .in').forEach(el => { if (el.id !== 'dn_dest' && el.id !== 'dn_rate') el.onchange = keep; });
      // redraw after the event, so a box losing focus while the table is rebuilt does not draw twice
      $$('[data-pr]').forEach(el => { el.onchange = () => { keep(); (OV[el.dataset.pr] = OV[el.dataset.pr] || {}).price = el.value.trim() === '' ? null : toNum(el.value); setTimeout(draw, 0); }; });
      $$('[data-rm]').forEach(el => { el.oninput = () => { (OV[el.dataset.rm] = OV[el.dataset.rm] || {}).remark = el.value; }; });
      $('#dnWord').onclick = async () => {
        keep();
        const btn = $('#dnWord'); busy(btn, true);
        try {
          if (!window.JSZip) await loadScript(VENDOR + 'jszip.min.js');
          const tpl = await dnTemplate();
          const d = toDate(H.date) || new Date();
          // Take the next number in the sequence (the sheet gives it, so two people never get the same No).
          const auto = !H.no || H.no === dnNo();
          if (LIVE && signedIn()) {
            const res = await api('dnlog', { prefix: dnPre(), no: auto ? '' : H.no, company: co, dest: H.dest, date: H.date, period: (RF.from || '') + (RF.to && RF.to !== RF.from ? ' – ' + RF.to : ''), trips: rows.length, qty: +tq.toFixed(3), amount: Math.round(ta * 100) / 100 });
            H.no = res.no; if (res.seq) useSeq(dnPre(), res.seq);
          } else if (auto) H.no = dnNo();
          const sm = String(H.no).match(/^(.*)-(\d+)$/); if (sm) useSeq(sm[1], +sm[2]);
          const blob = await DebitNote.fill(tpl, {
            header: { customer: H.customer, tel: H.tel, deliveryTo: H.dest, gl: H.gl, costCenter: H.costCenter, agent: H.agent, no: H.no || dnNo(), vendorId: H.vendorId,
              date: pad(d.getDate()) + '-' + MON[d.getMonth()].charAt(0) + MON[d.getMonth()].slice(1).toLowerCase() + '-' + String(d.getFullYear()).slice(2),
              company: co, period: (RF.from ? showDate(RF.from) : '') + (RF.to && RF.to !== RF.from ? ' – ' + showDate(RF.to) : ''),
              totalQty: tq.toFixed(3), totalAmount: '$ ' + money(ta), preparedBy: me() },
            items: rows.map(x => ({ no: x.i + 1, date: shortDate(x.r.date), truck: x.r.vehicle, qty: x.q.toFixed(3),
              priceT: trip || x.pr == null ? '' : '$ ' + money(x.pr), priceTrip: trip && x.pr != null ? '$ ' + money(x.pr) : '',
              amount: x.amt == null ? '' : '$ ' + money(x.amt), remark: x.remark })),
          });
          const name = 'Debit_Note_' + String(H.no || dnNo()).replace(/[^\w\-]/g, '_') + '.docx';
          if (window.DE_SAVE) await window.DE_SAVE(name, blob);
          else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
          toast('✅ ' + name, 4000);
          H.no = ''; setTimeout(draw, 0);   // ready for the next Debit Note number
        } catch (e) { console.error(e); toast('⚠️ ' + (e && e.message || e), 6000); } finally { busy(btn, false); }
      };
    }
    draw();
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Template: the one an admin uploaded in Settings (kept on this computer), else the standard one.
  async function dnTemplate() {
    const own = await idbGet('dnTpl').catch(() => null);
    if (own && own.bytes) return own.bytes;
    if (window.DE_DN_TPL) return (await fetch(window.DE_DN_TPL)).arrayBuffer();
    const r = await fetch('dn-template.docx'); if (!r.ok) throw new Error('Template missing'); return r.arrayBuffer();
  }

  // ---------- Settings ----------
  async function renderSettings() {
    screen = renderSettings;
    const has = !!(await idbGet('dir').catch(() => null));
    $('#view').innerHTML = `<div class="card set">
      <h2>💾 ${t('ឯកសារ Excel ក្នុងកុំព្យូទ័រ', 'Local Excel file')}</h2>
      <div class="field"><label class="f">${t('Folder', 'Folder')}</label>
        <div class="cur">${has ? `<code>📁 ${esc(SET.folderName || '')}</code>` : `<span class="req">${t('មិនទាន់ជ្រើស', 'Not chosen yet')}</span>`}
        <button type="button" class="btn sm" id="sDir" ${canFolder() ? '' : 'disabled'}>📁 ${has ? t('ប្តូរ', 'Change') : t('ជ្រើស Folder', 'Choose folder')}</button></div>
        <div class="hint">${canFolder() ? t('ជ្រើស folder ម្តង (ឧ. OneDrive …\\00. Data Warehouse\\Weight Scale Data)។ កម្មវិធីចងចាំវា។', 'Choose it once (e.g. OneDrive …\\00. Data Warehouse\\Weight Scale Data). The app remembers it.')
          : t('កម្មវិធីរុករកនេះមិនអាចសរសេរក្នុង folder បានទេ។ ប្រើ Chrome ឬ Edge លើកុំព្យូទ័រ។ ឥឡូវនេះ Excel នឹងទាញយក។', 'This browser cannot write to a folder. Use Chrome or Edge on a computer. For now the Excel file downloads instead.')}</div></div>
      <div class="field"><label class="f" for="sName">${t('ឈ្មោះឯកសារ', 'File name')}</label><input class="in" id="sName" value="${esc(SET.fileName)}">
        <div class="hint">${t('ប័ណ្ណថ្មីត្រូវបានបន្ថែមក្នុងឯកសារនេះ (sheet "Weighing Tickets")។ លេខប័ណ្ណដដែលនឹងជំនួសជួរចាស់។', 'New tickets are added to this file (sheet "Weighing Tickets"). The same ticket number replaces its old row.')}</div></div>
    </div>
    <div class="card set">
      <h2>🧾 Debit Note</h2>
      <div class="field"><label class="f">📄 ${t('ពុម្ព Word', 'Word template')}</label>
        <div class="cur"><code id="tplName">${t('ពុម្ពស្តង់ដារ', 'Standard template')}</code>
          <button type="button" class="btn sm" id="tplGet">⬇️ ${t('ទាញយក', 'Download')}</button>
          <button type="button" class="btn sm" id="tplUp">⬆️ ${t('ផ្ទុកពុម្ពថ្មី', 'Upload new')}</button>
          <button type="button" class="btn sm" id="tplReset" hidden>↩️ ${t('ប្រើពុម្ពស្តង់ដារ', 'Use standard')}</button>
          <input type="file" id="tplFile" accept=".docx" hidden></div>
        <div class="hint">${t('កែក្នុង Word ហើយទុកពាក្យ {{...}}។ ជួរដែលមាន {{item.no}} ធ្វើម្តងទៀតសម្រាប់ជើងដឹកនីមួយៗ។', 'Edit it in Word and keep the {{...}} words. The row with {{item.no}} repeats once per trip.')}</div></div>
      <div class="field"><label class="f">💲 Price List</label>
        ${prices().length ? `<div class="tscroll"><table class="rec"><thead><tr><th>3PL Company</th><th>Destination</th><th>Charge Per</th><th class="r">Price</th><th>UoM</th></tr></thead><tbody>${prices().map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td class="r">${money(r[3])}</td><td>${esc(r[4])}</td></tr>`).join('')}</tbody></table></div>` : `<p class="hint">${t('មិនទាន់មានតម្លៃ', 'No prices yet')}</p>`}
        <div class="hint">${LIVE ? t('កែតម្លៃក្នុង Google Sheet ផ្ទាំង Price List', 'Edit the prices in the Google Sheet, tab Price List') : t('សាកល្បង៖ តម្លៃពីឯកសារ Excel របស់អ្នក', 'Demo: prices from your Excel file')}</div></div>
    </div>
    <div class="card set">
      <h2>✉️ ${t('អ៊ីមែល', 'Email')}</h2>
      <div class="field"><label class="f" for="sMail">${t('ផ្ញើទៅ (ដើម)', 'Default "Send to"')}</label><input class="in" id="sMail" value="${esc(SET.emailTo)}" placeholder="name@isi-group.com, ..."></div>
    </div>
    <div class="card set">
      <h2>📤 Google Sheet</h2>
      <div class="cur">${LIVE ? (BOOT && BOOT.sheetUrl ? `✅ ${t('បានភ្ជាប់', 'Connected')} · <a href="${esc(BOOT.sheetUrl)}" target="_blank" rel="noopener">${t('បើក Sheet', 'Open the Sheet')}</a>` : '✅ ' + t('បានភ្ជាប់', 'Connected'))
        : `<span class="req">${t('មិនទាន់ភ្ជាប់', 'Not connected yet')}</span> · ${t('ធ្វើតាម SETUP.md (apps-script-dataentry) ហើយផ្ញើ URL /exec មក Claude', 'Follow SETUP.md (apps-script-dataentry) and send the /exec URL to Claude')}`}</div>
    </div>
    <div class="card set">
      <h2>🗂️ ${t('កំណត់ត្រាក្នុងកុំព្យូទ័រនេះ', 'Records on this computer')}</h2>
      <p class="hint">${RECS.length} ${t('កំណត់ត្រា', 'records')} · ${RECS.filter(r => !r.sheet).length} ${t('មិនទាន់នៅ Google Sheet', 'not in the Google Sheet')}</p>
      <button type="button" class="btn danger sm" id="sClear">🗑️ ${t('លុបកំណត់ត្រាដែលបានផ្ញើទៅ Sheet រួច', 'Clear records already in the Google Sheet')}</button>
    </div>`;
    $('#sName').onchange = e => { SET.fileName = e.target.value.trim() || 'Weight_Scale_Data.xlsx'; saveSet(); toast('✅ ' + t('បានរក្សាទុក', 'Saved')); };
    $('#sMail').onchange = e => { SET.emailTo = e.target.value.trim(); saveSet(); toast('✅ ' + t('បានរក្សាទុក', 'Saved')); };
    $('#sDir').onclick = async () => { try { const d = await window.showDirectoryPicker({ id: 'weight-scale', mode: 'readwrite' }); await idbPut('dir', d); SET.folderName = d.name; saveSet(); toast('✅ ' + d.name); renderSettings(); } catch (e) { if (e.name !== 'AbortError') toast('⚠️ ' + e.message); } };
    idbGet('dnTpl').then(o => { if (o && o.name) { $('#tplName').textContent = '📄 ' + o.name; $('#tplReset').hidden = false; } }).catch(() => {});
    $('#tplGet').onclick = async () => { try { const b = new Blob([await dnTemplate()]); const n = 'Debit_Note_Template.docx'; if (window.DE_SAVE) await window.DE_SAVE(n, b); else { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = n; a.click(); } } catch (e) { toast('⚠️ ' + e.message); } };
    $('#tplUp').onclick = () => $('#tplFile').click();
    $('#tplFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; await idbPut('dnTpl', { name: f.name, bytes: await f.arrayBuffer() }); toast('✅ ' + f.name); renderSettings(); };
    $('#tplReset').onclick = async () => { await idbPut('dnTpl', null); toast('↩️ ' + t('ពុម្ពស្តង់ដារ', 'Standard template')); renderSettings(); };
    $('#sClear').onclick = () => { const n = RECS.filter(r => r.sheet).length; if (!n) return toast(t('គ្មាន', 'Nothing to clear')); if (!confirm(t('លុប ', 'Clear ') + n + t(' កំណត់ត្រា?', ' records?'))) return; RECS = RECS.filter(r => !r.sheet); saveRecs(); renderSettings(); };
  }

  // ------------------------------------------------------------------ zoom, paste, start
  function zoom(src) {
    const z = document.createElement('div'); z.className = 'zoom'; z.innerHTML = `<img src="${src}" alt="">`;
    z.onclick = () => z.remove(); document.body.appendChild(z);
  }
  $('#fileIn').onchange = e => { const f = e.target.files; addFiles(f); e.target.value = ''; if (location.hash.indexOf('entry') < 0 && location.hash) location.hash = '#/entry'; };
  document.addEventListener('paste', e => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (files.length && screen === renderEntry) { e.preventDefault(); addFiles(files); }
  });
  document.addEventListener('dragover', e => { if (screen === renderEntry) e.preventDefault(); });
  document.addEventListener('drop', e => { if (screen === renderEntry && !e.target.closest('#drop')) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

  function paintStatic() { $$('[data-km]').forEach(el => { el.textContent = t(el.dataset.km, el.dataset.en); }); }
  function paintBanner() {
    const d = $('#demo');
    d.hidden = LIVE;
    if (!LIVE) {
      d.innerHTML = esc(t('⚙️ Google Sheet និងអ៊ីមែល មិនទាន់ភ្ជាប់។', '⚙️ Google Sheet and email are not connected yet.')) +
        ` · ${t('សាកល្បងជា', 'Try as')} <select id="demoRole">${[['admin', 'Admin'], ['reviewer', 'Reviewer'], ['user', 'User']].map(r => `<option value="${r[0]}" ${demoRole() === r[0] ? 'selected' : ''}>${r[1]}</option>`).join('')}</select>`;
      $('#demoRole').onchange = e => { set('de_demo_role', e.target.value); EDIT = null; paintTabs(); route(); toast('👤 ' + e.target.selectedOptions[0].text); };
    }
  }
  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const paintTheme = () => { const th = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); $('#themeBtn').textContent = th === 'dark' ? '☀️' : '🌙'; };
  $('#themeBtn').onclick = () => { const now = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); const nx = now === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', nx); set('fr_theme', nx); paintTheme(); };
  paintTheme();
  if (window.LANG) { LANG.button($('#langBtn')); LANG.onChange(() => { paintStatic(); paintBanner(); grab(); route(); }); }
  window.ISTEEL_REFRESH = () => { grab(); route(); boot(); };
  window.addEventListener('hashchange', () => { grab(); route(); });
  // 🔄 Refresh: reload users, trucks, prices and lists from the sheet, send what is waiting, and redraw the page.
  $('#refreshBtn').onclick = async () => {
    const b = $('#refreshBtn'); if (b.disabled) return; b.disabled = true; b.classList.add('spin');
    try { grab(); if (LIVE && signedIn()) { await boot(); await syncSheet(); } try { RECS = JSON.parse(get(REC_KEY) || '[]'); } catch (e) { /* keep */ } route(); toast('🔄 ' + t('បានធ្វើឱ្យទាន់សម័យ', 'Refreshed')); }
    finally { b.disabled = false; b.classList.remove('spin'); }
  };
  paintStatic(); paintBanner(); paintTabs();
  if (LIVE && !signedIn()) blocked({ code: 'AUTH', message: t('ការចូលគណនីត្រូវធ្វើនៅទំព័រដើម STEEL។', 'Sign in once on the STEEL home menu, then come back.') });
  else { route(); boot(); }
  // Load the reader quietly after the page is up, so the first ticket reads faster.
  setTimeout(() => { if (!BLOCKED) engine().catch(() => {}); }, 2500);
  window.DE_DEBUG = { Q: () => Q, RECS: () => RECS };
})();
