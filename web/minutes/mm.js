// Meeting Minutes (ប្រជុំ): record or upload a meeting, add photos of notes or a whiteboard, and get clean minutes
// (summary, discussion, decisions, action items with owner and due date, follow-up) in Khmer, English or both.
// Data: the Minutes Apps Script (Google Sheet + Drive). AI: the /mm/* relay on this site (Groq or Gemini), which needs a
// ticket from the script, so only people with ប្រជុំ ticked in Users can use it.
(function () {
  'use strict';

  const API = ((window.MM_CONFIG || {}).API_URL || '').trim();
  const RELAY = ((window.MM_CONFIG || {}).RELAY || '/mm/').replace(/\/?$/, '/');
  const DEMO = !API;
  const TOKEN_KEY = 'fr_id_token';           // shared with every app on this site: sign in once on the home menu
  const MAX_FILE = 95 * 1024 * 1024;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const t = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const getJ = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };
  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const nowHm = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const mmss = ms => { const s = Math.floor(ms / 1000); return (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
  const mb = b => (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB';
  const lines = s => String(s || '').split('\n').map(x => x.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
  const isDesk = () => window.matchMedia && matchMedia('(min-width: 1000px)').matches;

  let toastTimer = 0;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3000); }

  // ---------------------------------------------------------------- sign-in token (from the home menu)
  function claims() {
    try { return JSON.parse(decodeURIComponent(escape(atob((get(TOKEN_KEY) || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); }
    catch (e) { return null; }
  }
  const signedIn = () => { const c = claims(); return !!(c && c.exp * 1000 > Date.now() + 60000); };
  const myEmail = () => { const c = claims(); return c && c.email ? String(c.email).toLowerCase() : 'demo'; };

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

  // ---------------------------------------------------------------- AI relay (/mm/upload, /mm/generate)
  let ticket = getJ('mm_ticket', null);
  async function freshTicket(force) {
    if (!force && ticket && ticket.until > Date.now() + 600000 && ticket.email === myEmail()) return ticket.v;
    const d = await api('ticket');
    ticket = { v: d.ticket, until: Date.now() + 11 * 3600000, email: myEmail() };
    set('mm_ticket', JSON.stringify(ticket));
    return ticket.v;
  }
  const relayErr = (status, body) => {
    const m = msgOf((body && body.error) || ('AI: ' + status));
    let txt = m.text;
    if (m.code === 'LIMIT') txt = t('ប្រព័ន្ធ AI រវល់ ឬដល់ចំនួនកំណត់។ សូមរង់ចាំ 1 នាទី ហើយព្យាយាមម្តងទៀត។', 'The AI service is busy or at its limit. Wait a minute and try again.') + ' (' + m.text + ')';
    if (m.code === 'SETUP') txt = t('AI មិនទាន់រៀបចំនៅ Cloudflare ទេ។ សូមមើល SETUP.md។', 'AI is not set up in Cloudflare yet. See SETUP.md.');
    return Object.assign(new Error(txt), { code: m.code || 'AI', status });
  };

  // Which AI the relay uses: 'gemini' takes every file; 'groq' (free) takes sound files, and photos go inside the question.
  let aiKind = '';
  async function aiProvider() {
    if (aiKind) return aiKind;
    try { const d = await (await fetch(RELAY + 'ping', { cache: 'no-store' })).json(); aiKind = d.provider || 'gemini'; } catch (e) { return 'gemini'; }
    return aiKind;
  }
  /** For the free AI: a photo is made smaller on the phone and sent inside the question; a PDF cannot be read. */
  async function localDoc(file) {
    if (/^text\/plain$/.test(file.type)) return { plain: await file.text(), name: file.name };
    if (!/^image\//.test(file.type)) return { skipped: file.name };
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = 0.85, d = c.toDataURL('image/jpeg', q);
      while (d.length > 3.5e6 && q > 0.4) { q -= 0.15; d = c.toDataURL('image/jpeg', q); }
      return { inline: d, mimeType: 'image/jpeg', name: file.name };
    } catch (e) { return { skipped: file.name }; } finally { URL.revokeObjectURL(url); }
  }

  /** Sends one file to the AI through the relay. Progress 0..1 via onProgress. opts: { lang, hint } help the speech-to-text. */
  async function aiUpload(file, onProgress, retried, opts) {
    if (DEMO) return demoUpload(file, onProgress);
    if (!/^(audio|video)\//.test(file.type) && (await aiProvider()) === 'groq') { const d = await localDoc(file); onProgress(1); return d; }
    const tk = await freshTicket(false);
    const res = await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', RELAY + 'upload');
      x.setRequestHeader('X-MM-Ticket', tk);
      x.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'file'));
      x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      if (opts && opts.lang) x.setRequestHeader('X-MM-Lang', opts.lang);
      if (opts && opts.hint) x.setRequestHeader('X-MM-Hint', encodeURIComponent(String(opts.hint).slice(0, 150)));
      x.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.min(.98, e.loaded / e.total)); };
      x.onload = () => { let b = null; try { b = JSON.parse(x.responseText); } catch (e) { /* not JSON */ } resolve({ status: x.status, body: b }); };
      x.onerror = () => reject(Object.assign(new Error(t('ការផ្ទុកឡើងបានដាច់។ សូមព្យាយាមម្តងទៀត។', 'Upload was cut off. Please try again.')), { code: 'NET' }));
      x.send(file);
    });
    if (res.status === 401 && !retried) { await freshTicket(true); return aiUpload(file, onProgress, true, opts); }
    if (!res.body || !res.body.ok) throw relayErr(res.status, res.body);
    onProgress(1);
    return res.body.data;
  }

  /** Streams one AI answer. onText(fullTextSoFar) is called as words arrive. Returns { text, finish, model }. */
  async function aiGenerate(payload, onText, retried) {
    if (DEMO) return demoGenerate(payload, onText);
    const tk = await freshTicket(false);
    let res;
    try {
      res = await fetch(RELAY + 'generate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MM-Ticket': tk }, body: JSON.stringify(payload) });
    } catch (e) { throw Object.assign(new Error(t('មិនអាចភ្ជាប់អ៊ីនធឺណិត។ សូមព្យាយាមម្តងទៀត។', 'No connection. Please try again.')), { code: 'NET' }); }
    if (res.status === 401 && !retried) { await freshTicket(true); return aiGenerate(payload, onText, true); }
    if (!/event-stream/.test(res.headers.get('Content-Type') || '')) { let b = null; try { b = await res.json(); } catch (e) { /* ignore */ } throw relayErr(res.status, b); }
    const model = res.headers.get('X-MM-Model') || '';
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', text = '', finish = '', block = '';
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (ev.error) throw Object.assign(new Error(ev.error.message || 'AI error'), { code: 'AI' });
        const c = (ev.candidates || [])[0];
        if (ev.promptFeedback && ev.promptFeedback.blockReason) block = ev.promptFeedback.blockReason;
        if (!c) continue;
        ((c.content || {}).parts || []).forEach(p => { if (p.text && !p.thought) text += p.text; });
        if (c.finishReason) finish = c.finishReason;
        onText(text);
      }
    }
    if (!text && block) throw Object.assign(new Error('AI refused: ' + block), { code: 'AI' });
    return { text, finish, model };
  }

  // ---------------------------------------------------------------- recordings kept on the phone (IndexedDB)
  // Every 10 seconds of a recording is saved on the phone, so a closed tab or a dead battery loses at most a few seconds.
  const idb = (() => {
    let p = null;
    const open = () => p || (p = new Promise((res, rej) => {
      const r = indexedDB.open('mm', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('drafts', { keyPath: 'sid' }); r.result.createObjectStore('chunks', { autoIncrement: true }).createIndex('sid', 'sid'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const tx = async (store, mode, fn) => { const db = await open(); return new Promise((res, rej) => { const x = db.transaction(store, mode); const out = fn(x.objectStore(store)); x.oncomplete = () => res(out && out.result !== undefined ? out.result : out); x.onerror = () => rej(x.error); }); };
    return {
      putDraft: d => tx('drafts', 'readwrite', s => s.put(d)).catch(() => {}),
      addChunk: (sid, blob) => tx('chunks', 'readwrite', s => s.add({ sid, blob })).catch(() => {}),
      drafts: () => tx('drafts', 'readonly', s => s.getAll()).catch(() => []),
      async blob(sid, mime) {
        const db = await open();
        return new Promise((res, rej) => {
          const out = [], x = db.transaction('chunks', 'readonly');
          const c = x.objectStore('chunks').index('sid').openCursor(IDBKeyRange.only(sid));
          c.onsuccess = () => { const cur = c.result; if (cur) { out.push(cur.value.blob); cur.continue(); } };
          x.oncomplete = () => res(new Blob(out, { type: mime })); x.onerror = () => rej(x.error);
        });
      },
      async remove(sid) {
        const db = await open();
        return new Promise(res => {
          const x = db.transaction(['drafts', 'chunks'], 'readwrite');
          x.objectStore('drafts').delete(sid);
          const c = x.objectStore('chunks').index('sid').openKeyCursor(IDBKeyRange.only(sid));
          c.onsuccess = () => { const cur = c.result; if (cur) { x.objectStore('chunks').delete(cur.primaryKey); cur.continue(); } };
          x.oncomplete = () => res(); x.onerror = () => res();
        });
      },
    };
  })();

  // ---------------------------------------------------------------- recorder
  const rec = { on: false, paused: false, ms: 0, t0: 0, sid: '', mime: '', recorder: null, streams: [], ctx: null, level: 0, wake: null, timer: 0 };
  const recMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
  const canOnline = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  async function startRec(online) {
    if (rec.on) return;
    if (!window.MediaRecorder || !navigator.mediaDevices) { toast(t('ទូរស័ព្ទនេះមិនអាចថតសំឡេងបានទេ។ សូមប្រើ Chrome ឬ Safari ថ្មី។', 'This browser cannot record. Please use a recent Chrome or Safari.')); return; }
    let mic;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) { toast(t('សូមអនុញ្ញាតឲ្យប្រើមីក្រូហ្វូន (ចុចរូបសោរនៅលើ address bar)។', 'Please allow the microphone (tap the lock icon next to the address).')); return; }
    const streams = [mic];
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ctx.createMediaStreamDestination();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(mic).connect(an);
    ctx.createMediaStreamSource(mic).connect(dest);
    if (online) {
      // Zoom / Teams / Meet in another tab or window: share it "with audio", mixed with this computer's microphone.
      try {
        const scr = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (!scr.getAudioTracks().length) { scr.getTracks().forEach(x => x.stop()); toast(t('សូមធីក "Share audio" ពេលជ្រើសផ្ទាំង។', 'Tick "Share audio" when you choose the tab.')); mic.getTracks().forEach(x => x.stop()); ctx.close(); return; }
        scr.getVideoTracks().forEach(x => x.stop());
        ctx.createMediaStreamSource(scr).connect(dest);
        ctx.createMediaStreamSource(scr).connect(an);
        streams.push(scr);
      } catch (e) { mic.getTracks().forEach(x => x.stop()); ctx.close(); return; }
    }
    const mime = recMime();
    const r = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
    Object.assign(rec, { on: true, paused: false, ms: 0, t0: Date.now(), sid: 'r' + Date.now(), mime: (r.mimeType || mime || 'audio/webm'), recorder: r, streams, ctx, an, online: !!online });
    const meta = form();
    idb.putDraft({ sid: rec.sid, mime: rec.mime, started: Date.now(), ms: 0, title: meta.title || '' });
    r.ondataavailable = e => {
      if (!e.data || !e.data.size) return;
      idb.addChunk(rec.sid, e.data);
      idb.putDraft({ sid: rec.sid, mime: rec.mime, started: rec.t0, ms: elapsed(), title: (form().title || '') });
    };
    r.onstop = () => finishRec();
    r.start(10000);
    try { if (navigator.wakeLock) rec.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* fine */ }
    rec.timer = setInterval(tickRec, 250);
    paintRec();
  }
  const elapsed = () => rec.ms + (rec.on && !rec.paused ? Date.now() - rec.t0 : 0);
  function pauseRec() {
    if (!rec.on) return;
    if (rec.paused) { rec.recorder.resume(); rec.t0 = Date.now(); rec.paused = false; }
    else { rec.recorder.pause(); rec.ms += Date.now() - rec.t0; rec.paused = true; }
    paintRec();
  }
  function stopRec() { if (rec.on && rec.recorder.state !== 'inactive') { if (!rec.paused) rec.ms += Date.now() - rec.t0; rec.paused = true; rec.recorder.stop(); } }
  async function finishRec() {
    clearInterval(rec.timer);
    rec.streams.forEach(s => s.getTracks().forEach(x => x.stop()));
    try { rec.ctx.close(); } catch (e) { /* closed */ }
    try { if (rec.wake) rec.wake.release(); } catch (e) { /* released */ }
    const sid = rec.sid, ms = rec.ms;
    rec.on = false;
    await new Promise(r => setTimeout(r, 300));   // the last chunk is written to the phone first
    await idb.putDraft({ sid, mime: rec.mime, started: Date.now() - ms, ms, title: form().title || '', done: true });
    const blob = await idb.blob(sid, rec.mime);
    addRecording(blob, sid, ms);
    paintRec();
  }
  function addRecording(blob, sid, ms) {
    const ext = /mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
    const file = new File([blob], 'recording-' + today() + '-' + nowHm().replace(':', '') + '.' + ext, { type: blob.type.split(';')[0] });
    job.files.push({ kind: 'audio', file, sid, ms, rec: true });
    paintFiles();
  }
  function tickRec() {
    const el = $('#recTime');
    if (!el) return;
    el.textContent = mmss(elapsed());
    if (rec.an) {
      const a = new Uint8Array(rec.an.fftSize); rec.an.getByteTimeDomainData(a);
      let peak = 0; for (let i = 0; i < a.length; i++) peak = Math.max(peak, Math.abs(a[i] - 128));
      const lv = $('#recLevel'); if (lv) lv.style.transform = 'scaleX(' + Math.min(1, peak / 70).toFixed(2) + ')';
    }
  }

  // ---------------------------------------------------------------- state
  const job = { files: [], meta: null, lang: get('mm_lang') || 'auto', outLang: get('mm_out') || 'km' };
  let boot = getJ('mm_boot_' + myEmail(), null);
  let current = null;            // the meeting open on the review screen
  let screen = () => {};

  // ---------------------------------------------------------------- screens
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    $$('.tab').forEach(x => x.classList.toggle('on', x.dataset.r === (h.split(/[/?]/)[0] || 'home')));
    document.body.classList.toggle('wide', /^m\//.test(h));
    if (/^m\//.test(h)) return openMeeting(decodeURIComponent(h.slice(2)));
    if (/^new/.test(h)) return renderNew(/rec=1/.test(h) ? 'rec' : /online=1/.test(h) ? 'online' : '');
    if (h === 'tasks') return renderTasks();
    if (h === 'run') return renderRun();
    return renderHome();
  }
  window.addEventListener('hashchange', () => { if (rec.on && !/^new/.test(location.hash.replace(/^#\/?/, ''))) { toast(t('កំពុងថត។ សូមបញ្ចប់ការថតជាមុនសិន។', 'Still recording. Please stop the recording first.')); location.hash = '#/new'; return; } route(); });
  window.addEventListener('beforeunload', e => { if (rec.on || running) { e.preventDefault(); e.returnValue = ''; } });

  const STATUS = { Processing: ['កំពុងដំណើរការ', 'Processing', 'warn'], Done: ['រួចរាល់', 'Done', 'ok'], Draft: ['ព្រាង', 'Draft', 'soft'], Error: ['មានបញ្ហា', 'Problem', 'bad'] };
  const chip = s => { const x = STATUS[s] || STATUS.Draft; return `<span class="badge ${x[2]}">${esc(t(x[0], x[1]))}</span>`; };

  // ----- home: start buttons, unfinished recordings, all meetings
  async function renderHome() {
    screen = renderHome;
    const list = (boot && boot.recent) || [];
    const q = (get('mm_q') || '').toLowerCase();
    const shown = list.filter(m => !q || (m.title + ' ' + m.id + ' ' + m.date + ' ' + m.summary).toLowerCase().indexOf(q) >= 0);
    $('#view').innerHTML = `
      <div class="starts">
        <a class="start rec" href="#/new?rec=1"><span class="ic">🎙️</span><span><b>${t('ថតការប្រជុំផ្ទាល់', 'Record a live meeting')}</b><small>${t('ប្រើមីក្រូហ្វូនទូរស័ព្ទ ឬកុំព្យូទ័រ', 'Uses this phone or computer microphone')}</small></span></a>
        ${canOnline() ? `<a class="start" href="#/new?online=1"><span class="ic">💻</span><span><b>${t('ថតការប្រជុំអនឡាញ', 'Record an online meeting')}</b><small>Zoom · Teams · Google Meet</small></span></a>` : ''}
        <a class="start" href="#/new"><span class="ic">📁</span><span><b>${t('ផ្ទុកសំឡេង រូបភាព ឬ PDF', 'Upload audio, photos or PDF')}</b><small>${t('ឯកសារសំឡេង ក្តារខៀន កំណត់ត្រាដៃ របៀបវារៈ', 'Recordings, whiteboard, handwritten notes, agenda')}</small></span></a>
      </div>
      <div id="drafts"></div>
      <div class="head2"><h2>${t('ការប្រជុំទាំងអស់', 'All meetings')}</h2></div>
      <input class="in search" id="q" type="search" placeholder="${t('ស្វែងរក ប្រធានបទ កាលបរិច្ឆេទ...', 'Search title, date...')}" value="${esc(get('mm_q') || '')}">
      <div class="list" id="list">${boot ? (shown.length ? shown.map(cardHtml).join('') : `<div class="empty">${list.length ? t('រកមិនឃើញ', 'Nothing found') : t('មិនទាន់មានការប្រជុំទេ។ ចុច 🎙️ ដើម្បីចាប់ផ្តើម។', 'No meetings yet. Tap 🎙️ to start.')}</div>`) : '<div class="spinner"></div>'}</div>`;
    $('#q').oninput = e => { set('mm_q', e.target.value); const v = e.target.value.toLowerCase(); $('#list').innerHTML = list.filter(m => !v || (m.title + ' ' + m.id + ' ' + m.date + ' ' + m.summary).toLowerCase().indexOf(v) >= 0).map(cardHtml).join('') || `<div class="empty">${t('រកមិនឃើញ', 'Nothing found')}</div>`; };
    paintDrafts();
  }
  const cardHtml = m => `<a class="item" href="#/m/${encodeURIComponent(m.id)}">
      <div class="top"><b>${esc(m.title || t('គ្មានប្រធានបទ', 'Untitled'))}</b>${chip(m.status)}</div>
      <div class="meta">${esc([m.date, m.time].filter(Boolean).join(' · ') || m.created)}${m.open ? ` · <span class="openn">${t('កិច្ចការនៅសល់', 'open tasks')} ${m.open}</span>` : ''}</div>
      ${m.summary ? `<div class="sum">${esc(m.summary)}</div>` : ''}</a>`;

  async function paintDrafts() {
    const ds = (await idb.drafts()).filter(d => d.sid !== rec.sid && d.ms > 1500 && !job.files.some(f => f.sid === d.sid));
    const box = $('#drafts');
    if (!box) return;
    box.innerHTML = ds.length ? `<div class="card warnbox"><h2>⚠️ ${t('ការថតដែលមិនទាន់បានបង្កើតកំណត់ហេតុ', 'Recordings not turned into minutes yet')}</h2>
      ${ds.map(d => `<div class="draft"><span><b>${esc(d.title || t('ការថត', 'Recording'))}</b><small>${new Date(d.started).toLocaleString()} · ${mmss(d.ms)}</small></span>
        <button class="btn ok" data-use="${esc(d.sid)}">${t('បន្ត', 'Continue')}</button><button class="btn" data-del="${esc(d.sid)}" aria-label="${t('លុប', 'Delete')}">🗑️</button></div>`).join('')}</div>` : '';
    $$('[data-use]').forEach(b => b.onclick = async () => {
      const d = ds.find(x => x.sid === b.dataset.use);
      addRecording(await idb.blob(d.sid, d.mime), d.sid, d.ms);
      location.hash = '#/new';
    });
    $$('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm(t('លុបការថតនេះពីទូរស័ព្ទ?', 'Delete this recording from the phone?'))) return;
      await idb.remove(b.dataset.del); paintDrafts();
    });
  }

  // ----- new meeting: details, recording, files, languages
  function form() {
    const v = id => { const el = $('#' + id); return el ? el.value.trim() : ''; };
    if (!$('#fTitle')) return job.meta || {};
    job.meta = { title: v('fTitle'), date: v('fDate'), time: v('fTime'), location: v('fPlace'), attendees: v('fWho'), agenda: v('fNotes') };
    set('mm_form', JSON.stringify(job.meta));
    return job.meta;
  }
  function renderNew(mode) {
    screen = () => renderNew('');
    const m = job.meta || getJ('mm_form', null) || {};
    const fresh = !job.files.length && !rec.on && !(m.title || m.attendees || m.agenda);
    const d = fresh ? { title: '', date: today(), time: nowHm(), location: m.location || '', attendees: '', agenda: '' } : m;
    $('#view').innerHTML = `
      <div class="card"><h2><span class="n">1</span>${t('សំឡេងប្រជុំ', 'Meeting audio')}</h2>
        <div id="recBox"></div>
        <div class="row-btns">
          <label class="btn file">🎵 ${t('ជ្រើសរើសឯកសារសំឡេង ឬវីដេអូ', 'Choose audio or video file')}<input type="file" id="pickAudio" accept="audio/*,video/*,.m4a,.mp3,.wav,.webm,.ogg,.aac,.mp4" multiple hidden></label>
        </div>
        <div class="files" id="audioList"></div>
      </div>
      <div class="card"><h2><span class="n">2</span>${t('រូបភាព និងឯកសារ', 'Photos and documents')}</h2>
        <p class="hint">${t('ក្តារខៀន កំណត់ត្រាដៃ របៀបវារៈ របាយការណ៍ (រូបភាព ឬ PDF)', 'Whiteboard, handwritten notes, agenda, reports (photo or PDF)')}</p>
        <div class="row-btns">
          <label class="btn file">📷 ${t('ថតរូប', 'Take photo')}<input type="file" id="pickCam" accept="image/*" capture="environment" hidden></label>
          <label class="btn file">📎 ${t('ជ្រើសរើសឯកសារ', 'Choose files')}<input type="file" id="pickDocs" accept="image/*,application/pdf,.pdf,.txt" multiple hidden></label>
        </div>
        <div class="files thumbs" id="docList"></div>
      </div>
      <div class="card"><h2><span class="n">3</span>${t('ព័ត៌មានប្រជុំ', 'Meeting details')}</h2>
        <div class="field"><label class="f" for="fTitle">${t('ប្រធានបទ', 'Title')}</label><input class="in" id="fTitle" value="${esc(d.title)}" placeholder="${t('ឧ. ប្រជុំប្រចាំសប្តាហ៍ ឃ្លាំង និងដឹកជញ្ជូន', 'e.g. Weekly W&L meeting')}"></div>
        <div class="row3">
          <div class="field"><label class="f" for="fDate">${t('កាលបរិច្ឆេទ', 'Date')}</label><input class="in" id="fDate" type="date" value="${esc(d.date)}"></div>
          <div class="field"><label class="f" for="fTime">${t('ម៉ោង', 'Time')}</label><input class="in" id="fTime" type="time" value="${esc(d.time)}"></div>
          <div class="field"><label class="f" for="fPlace">${t('ទីកន្លែង', 'Location')}</label><input class="in" id="fPlace" value="${esc(d.location)}" placeholder="${t('ឧ. បន្ទប់ប្រជុំ ឃ្លាំង', 'e.g. WH meeting room')}"></div>
        </div>
        <div class="field"><label class="f" for="fWho">${t('អ្នកចូលរួម', 'Attendees')}</label><textarea class="in" id="fWho" rows="2" placeholder="${t('ឈ្មោះ ដោយបំបែកដោយសញ្ញាក្បៀស (ជួយ AI ស្គាល់ឈ្មោះ)', 'Names, separated by commas (helps the AI spell names)')}">${esc(d.attendees)}</textarea></div>
        <div class="field"><label class="f" for="fNotes">${t('របៀបវារៈ ឬកំណត់ចំណាំ (មិនបាច់ក៏បាន)', 'Agenda or your own notes (optional)')}</label><textarea class="in" id="fNotes" rows="3">${esc(d.agenda)}</textarea></div>
      </div>
      <div class="card"><h2><span class="n">4</span>${t('ភាសា', 'Languages')}</h2>
        <label class="f">${t('ភាសាដែលនិយាយក្នុងប្រជុំ', 'Language spoken in the meeting')}</label>
        <div class="chips" id="langChips">${[['km', 'ខ្មែរ', 'Khmer'], ['en', 'English', 'English'], ['auto', 'ខ្មែរ + English', 'Khmer + English']].map(x => `<button type="button" class="chip${job.lang === x[0] ? ' on' : ''}" data-l="${x[0]}">${esc(t(x[1], x[2]))}</button>`).join('')}</div>
        <label class="f">${t('ភាសានៃកំណត់ហេតុ', 'Language of the minutes')}</label>
        <div class="chips" id="outChips">${[['km', 'ខ្មែរ', 'Khmer'], ['en', 'English', 'English'], ['both', 'ទាំងពីរ', 'Both']].map(x => `<button type="button" class="chip${job.outLang === x[0] ? ' on' : ''}" data-o="${x[0]}">${esc(t(x[1], x[2]))}</button>`).join('')}</div>
      </div>
      <div id="goErr"></div>
      <button type="button" class="btn ok big" id="go">✨ ${t('បង្កើតកំណត់ហេតុ', 'Create minutes')}</button>
      ${job.files.length || rec.on ? '' : `<p class="hint center">${t('អាចបង្កើតពីការថត ឯកសារ ឬកំណត់ចំណាំតែមួយមុខក៏បាន។', 'Minutes can come from a recording, files or typed notes alone.')}</p>`}`;
    ['fTitle', 'fDate', 'fTime', 'fPlace', 'fWho', 'fNotes'].forEach(id => { $('#' + id).oninput = () => form(); });
    $$('#langChips .chip').forEach(b => b.onclick = () => { job.lang = b.dataset.l; set('mm_lang', job.lang); $$('#langChips .chip').forEach(x => x.classList.toggle('on', x === b)); });
    $$('#outChips .chip').forEach(b => b.onclick = () => { job.outLang = b.dataset.o; set('mm_out', job.outLang); $$('#outChips .chip').forEach(x => x.classList.toggle('on', x === b)); });
    $('#pickAudio').onchange = e => { addFiles(e.target.files, 'audio'); e.target.value = ''; };
    $('#pickCam').onchange = e => { addFiles(e.target.files, 'doc'); e.target.value = ''; };
    $('#pickDocs').onchange = e => { addFiles(e.target.files, 'doc'); e.target.value = ''; };
    $('#go').onclick = startJob;
    form();
    paintRec();
    paintFiles();
    if (mode === 'rec' || mode === 'online') { history.replaceState(null, '', '#/new'); startRec(mode === 'online'); }
  }
  function addFiles(list, kind) {
    Array.from(list || []).forEach(f => {
      if (f.size > MAX_FILE) { toast(f.name + ': ' + t('ធំជាង 95 MB។ សូមនាំចេញតែសំឡេង (m4a/mp3)។', 'over 95 MB. Please export the audio only (m4a/mp3).')); return; }
      const k = kind === 'audio' || /^(audio|video)\//.test(f.type) ? 'audio' : 'doc';
      job.files.push({ kind: k, file: f });
    });
    paintFiles();
  }
  function paintRec() {
    const box = $('#recBox');
    if (!box) return;
    if (!rec.on) {
      box.innerHTML = `<div class="row-btns"><button type="button" class="btn rec-btn" id="recGo">🎙️ ${t('ចាប់ផ្តើមថត', 'Start recording')}</button>
        ${canOnline() ? `<button type="button" class="btn" id="recOnline">💻 ${t('ថតការប្រជុំអនឡាញ', 'Record online meeting')}</button>` : ''}</div>`;
      $('#recGo').onclick = () => startRec(false);
      if ($('#recOnline')) $('#recOnline').onclick = () => startRec(true);
      return;
    }
    box.innerHTML = `<div class="recording${rec.paused ? ' paused' : ''}">
        <div class="rec-top"><span class="dot"></span><b>${rec.paused ? t('បានផ្អាក', 'Paused') : t('កំពុងថត', 'Recording')}${rec.online ? ' · ' + t('អនឡាញ', 'online') : ''}</b><span class="time" id="recTime">${mmss(elapsed())}</span></div>
        <div class="level"><span id="recLevel"></span></div>
        <div class="row-btns"><button type="button" class="btn" id="recPause">${rec.paused ? '▶️ ' + t('បន្តថត', 'Resume') : '⏸️ ' + t('ផ្អាក', 'Pause')}</button>
          <button type="button" class="btn stop" id="recStop">⏹️ ${t('បញ្ចប់', 'Stop')}</button></div>
        <p class="hint">${t('សូមទុកអេក្រង់នេះបើក។ ការថតត្រូវបានរក្សាទុកលើទូរស័ព្ទរៀងរាល់ 10 វិនាទី។', 'Keep this screen open. The recording is saved on this phone every 10 seconds.')}</p></div>`;
    $('#recPause').onclick = pauseRec;
    $('#recStop').onclick = stopRec;
    tickRec();
  }
  const urls = new Map();
  const urlOf = f => { if (!urls.has(f)) urls.set(f, URL.createObjectURL(f)); return urls.get(f); };
  function paintFiles() {
    const a = $('#audioList'), d = $('#docList');
    if (!a || !d) return;
    const row = (x, i) => x.kind === 'audio'
      ? `<div class="fileitem"><span class="fi">${x.rec ? '🎙️' : '🎵'}</span><span class="fn"><b>${esc(x.file.name)}</b><small>${mb(x.file.size)}${x.ms ? ' · ' + mmss(x.ms) : ''}</small>
          <audio controls preload="none" src="${urlOf(x.file)}"></audio></span>
          <span class="fa">${x.rec ? `<a class="btn sm" href="${urlOf(x.file)}" download="${esc(x.file.name)}" title="${t('រក្សាទុកលើទូរស័ព្ទ', 'Save to phone')}">⬇️</a>` : ''}<button type="button" class="btn sm" data-rm="${i}" aria-label="${t('ដកចេញ', 'Remove')}">✕</button></span></div>`
      : `<div class="thumb">${/^image\//.test(x.file.type) ? `<img src="${urlOf(x.file)}" alt="">` : `<span class="pdf">${/pdf/.test(x.file.type) ? 'PDF' : 'TXT'}</span>`}<small>${esc(x.file.name)}</small><button type="button" class="x" data-rm="${i}" aria-label="${t('ដកចេញ', 'Remove')}">✕</button></div>`;
    a.innerHTML = job.files.map((x, i) => x.kind === 'audio' ? row(x, i) : '').join('');
    d.innerHTML = job.files.map((x, i) => x.kind === 'doc' ? row(x, i) : '').join('');
    $$('[data-rm]').forEach(b => b.onclick = () => {
      const x = job.files[+b.dataset.rm];
      if (x.rec && !confirm(t('ដកការថតនេះចេញ? (វានៅតែរក្សាទុកលើទូរស័ព្ទ)', 'Remove this recording? (it stays saved on this phone)'))) return;
      job.files.splice(+b.dataset.rm, 1); paintFiles();
    });
  }

  // ----- processing: save → upload → transcript → photos → minutes → save
  let running = false;
  let run = null;
  const STEPS = [
    ['save', 'រក្សាទុកព័ត៌មានប្រជុំ', 'Save meeting details'],
    ['upload', 'ផ្ទុកឯកសារឡើង', 'Upload files'],
    ['transcribe', 'បម្លែងសំឡេងជាអត្ថបទ', 'Turn speech into text'],
    ['ocr', 'អានអត្ថបទពីរូបភាព និងឯកសារ', 'Read photos and documents'],
    ['minutes', 'សរសេរកំណត់ហេតុ', 'Write the minutes'],
    ['final', 'រក្សាទុកកំណត់ហេតុ', 'Save the minutes'],
  ];
  function startJob() {
    if (rec.on) { toast(t('សូមបញ្ចប់ការថតជាមុនសិន។', 'Please stop the recording first.')); return; }
    const meta = form();
    if (!job.files.length && !(meta.agenda || '').trim()) {
      $('#goErr').innerHTML = `<div class="alert bad">${t('សូមថតសំឡេង បន្ថែមឯកសារ ឬសរសេរកំណត់ចំណាំយ៉ាងហោចណាស់មួយ។', 'Record, add a file or type some notes first.')}</div>`;
      return;
    }
    run = { meta, lang: job.lang, outLang: job.outLang, files: job.files.slice(), id: '', uploaded: [], transcript: '', ocr: '', minutes: null, model: '',
      state: {}, step: 'save', err: '', live: '', pct: 0 };
    STEPS.forEach(s => { run.state[s[0]] = 'wait'; });
    if (!run.files.some(f => f.kind === 'audio')) run.state.transcribe = 'skip';
    if (!run.files.some(f => f.kind === 'doc')) run.state.ocr = 'skip';
    if (!run.files.length) run.state.upload = 'skip';
    location.hash = '#/run';
    go();
  }
  function renderRun() {
    screen = renderRun;
    if (!run) { location.hash = '#/'; return; }
    const ico = s => ({ wait: '<span class="st"></span>', doing: '<span class="st s-doing"></span>', done: '<span class="st s-done">✓</span>', skip: '<span class="st">–</span>', err: '<span class="st s-err">!</span>' })[s];
    $('#view').innerHTML = `<div class="card run">
      <h2>✨ ${esc(run.meta.title || t('កំណត់ហេតុប្រជុំ', 'Meeting minutes'))}</h2>
      <ol class="steps">${STEPS.map(s => `<li class="s-${run.state[s[0]]}">${ico(run.state[s[0]])}<span>${esc(t(s[1], s[2]))}${s[0] === 'upload' && run.state.upload === 'doing' ? ` <b>${Math.round(run.pct * 100)}%</b>` : ''}</span></li>`).join('')}</ol>
      ${run.err ? `<div class="alert bad">${esc(run.err)}</div><div class="row-btns"><button class="btn ok" id="retry">🔁 ${t('ព្យាយាមម្តងទៀត', 'Try again')}</button><a class="btn" href="#/new">${t('ត្រឡប់ក្រោយ', 'Back')}</a></div>`
        : `<p class="hint">${t('សូមទុកទំព័រនេះបើករហូតដល់រួចរាល់។ ការប្រជុំ 1 ម៉ោង ប្រហែល 2-4 នាទី។', 'Keep this page open until it finishes. A 1-hour meeting takes about 2 to 4 minutes.')}</p>`}
      <pre class="live" id="live" ${run.live ? '' : 'hidden'}>${esc(run.live.slice(-1500))}</pre></div>`;
    if ($('#retry')) $('#retry').onclick = () => { run.err = ''; go(); };
  }
  const paintRun = () => { if (location.hash === '#/run') renderRun(); };
  let liveT = 0;
  const live = s => { run.live = s; const now = Date.now(); if (now - liveT < 200) return; liveT = now; const el = $('#live'); if (el) { el.hidden = !s; el.textContent = s.slice(-1500); el.scrollTop = el.scrollHeight; } };

  async function go() {
    if (running) return;
    running = true;
    const mark = (k, s) => { run.state[k] = s; run.step = k; paintRun(); };
    try {
      if (run.state.save !== 'done') {
        mark('save', 'doing');
        const r = await api('save', { meta: run.meta, lang: run.lang, outLang: run.outLang, status: 'Processing', notes: run.meta.agenda || '' });
        run.id = r.id;
        mark('save', 'done');
      }
      if (run.state.upload === 'wait' || run.state.upload === 'err' || run.state.upload === 'doing') {
        mark('upload', 'doing');
        const total = run.files.reduce((s, f) => s + f.file.size, 0) || 1;
        let doneBytes = 0;
        for (const f of run.files) {
          if (!f.up) f.up = await aiUpload(f.file, p => { run.pct = (doneBytes + p * f.file.size) / total; paintRunPct(); }, false, { lang: run.lang, hint: run.meta.attendees });
          doneBytes += f.file.size;
          // Photos and documents are also kept in the meeting's Drive folder (recordings stay on the phone).
          if (f.kind === 'doc' && !f.kept && f.file.size <= 15 * 1048576) { await api('attach', { id: run.id, name: f.file.name, mime: f.file.type, b64: await b64(f.file) }).catch(() => null); f.kept = true; }
        }
        mark('upload', 'done');
      }
      if (run.state.transcribe !== 'done' && run.state.transcribe !== 'skip') {
        mark('transcribe', 'doing');
        const audios = run.files.filter(f => f.kind === 'audio');
        const parts = [];
        for (let i = 0; i < audios.length; i++) {
          const head = audios.length > 1 ? '=== ' + t('ការថតទី', 'Recording') + ' ' + (i + 1) + ' ===\n' : '';
          let text = '';
          // A long meeting can be longer than one AI answer: ask it to carry on from where it stopped (up to 6 times).
          for (let round = 0; round < 6; round++) {
            const before = text;
            const r = await aiGenerate({ kind: 'transcribe', files: [audios[i].up], lang: run.lang, meta: run.meta, tail: round ? before : '' },
              s => live(parts.join('\n\n') + (parts.length ? '\n\n' : '') + head + before + (round ? '\n' : '') + s));
            run.model = r.model || run.model;
            text = before + (round ? '\n' : '') + r.text.trim();
            if (r.finish !== 'MAX_TOKENS') break;
          }
          parts.push(head + text);
        }
        run.transcript = parts.join('\n\n');
        mark('transcribe', 'done');
      }
      if (run.state.ocr !== 'done' && run.state.ocr !== 'skip') {
        mark('ocr', 'doing');
        const docs = run.files.filter(f => f.kind === 'doc');
        const r = await aiGenerate({ kind: 'ocr', files: docs.map(f => f.up) }, s => live(s));
        run.ocr = r.text.trim();
        mark('ocr', 'done');
      }
      if (run.state.minutes !== 'done') {
        mark('minutes', 'doing');
        run.minutes = await writeMinutes(run, s => live(s));
        mark('minutes', 'done');
      }
      mark('final', 'doing');
      await api('save', { id: run.id, meta: run.meta, lang: run.lang, outLang: run.outLang, status: 'Done', minutes: run.minutes, transcript: run.transcript, ocr: run.ocr,
        notes: run.meta.agenda || '', model: run.model, files: run.files.map(f => ({ name: f.file.name, kind: f.kind, size: f.file.size })) });
      mark('final', 'done');
      // Done: the recordings on this phone are no longer needed, and the form starts empty next time.
      for (const f of run.files) if (f.sid) await idb.remove(f.sid);
      job.files = []; job.meta = null; set('mm_form', null);
      const id = run.id;
      running = false;
      refreshList();
      location.hash = '#/m/' + encodeURIComponent(id);
    } catch (e) {
      running = false;
      run.state[run.step] = 'err';
      run.err = e.message || String(e);
      if (run.id) api('save', { id: run.id, status: 'Error' }).catch(() => {});
      paintRun();
    }
    running = false;
  }
  function paintRunPct() { const now = Date.now(); if (now - liveT < 300) return; liveT = now; paintRun(); }
  const b64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

  /** Writes the minutes in the chosen language(s); both languages are written at the same time. */
  async function writeMinutes(src, onText) {
    const langs = src.outLang === 'both' ? ['km', 'en'] : [src.outLang === 'en' ? 'en' : 'km'];
    const texts = {};
    const outs = await Promise.all(langs.map(l => aiGenerate({ kind: 'minutes', outLang: l, meta: src.meta, transcript: src.transcript, ocr: src.ocr, notes: src.meta.agenda || '', today: today() },
      s => { texts[l] = s; onText(langs.map(x => texts[x] || '').join('\n\n')); })));
    const minutes = {};
    outs.forEach((r, i) => {
      let m;
      try { m = JSON.parse(r.text); } catch (e) { const j = r.text.match(/\{[\s\S]*\}/); m = j ? JSON.parse(j[0]) : null; }
      if (!m) throw new Error(t('AI មិនបានសរសេរកំណត់ហេតុត្រឹមត្រូវ។ សូមព្យាយាមម្តងទៀត។', 'The AI answer was not complete. Please try again.'));
      minutes[langs[i]] = normalize(m, src.meta);
    });
    return minutes;
  }
  function normalize(m, meta) {
    const arr = v => (Array.isArray(v) ? v : []);
    return {
      title: m.title || meta.title || '', meetingDate: m.meetingDate || meta.date || '', startTime: m.startTime || meta.time || '', duration: m.duration || '',
      location: m.location || meta.location || '', chair: m.chair || '',
      attendees: arr(m.attendees).map(a => (typeof a === 'string' ? { name: a, role: '' } : { name: a.name || '', role: a.role || '' })).filter(a => a.name),
      summary: m.summary || '', discussion: arr(m.discussion).map(g => ({ topic: g.topic || '', points: arr(g.points).map(String) })),
      decisions: arr(m.decisions).map(String), actions: arr(m.actions).map(a => ({ task: a.task || '', owner: a.owner || 'TBC', due: a.due || 'TBC', priority: a.priority || '' })),
      followUp: arr(m.followUp).map(String), openPoints: arr(m.openPoints).map(String), nextMeeting: m.nextMeeting || '',
      glossary: arr(m.glossary).map(g => ({ term: g.term || '', meaning: g.meaning || '' })).filter(g => g.term),
    };
  }

  // ----- review and edit
  let view = { lang: 'km', pane: 'minutes' };
  async function openMeeting(id) {
    screen = () => paintMeeting();
    const cache = getJ('mm_m_' + id, null);
    if (cache) { current = cache; pickLang(); paintMeeting(); } else { current = null; $('#view').innerHTML = '<div class="spinner"></div>'; }
    try {
      const d = await api('get', { id });
      if (!dirty) { current = d; set('mm_m_' + id, JSON.stringify(d)); pickLang(); if (location.hash.indexOf(encodeURIComponent(id)) >= 0) paintMeeting(); }
    } catch (e) {
      if (!cache) $('#view').innerHTML = `<div class="card"><div class="alert bad">${esc(e.message)}</div><a class="btn" href="#/">${t('ត្រឡប់ក្រោយ', 'Back')}</a></div>`;
    }
  }
  function pickLang() {
    const ms = (current && current.minutes) || {};
    if (!ms[view.lang]) view.lang = ms.km ? 'km' : 'en';
  }
  const ta = (id, v, rows, ph) => `<textarea class="in grow" id="${id}" rows="${rows || 2}" ${ph ? `placeholder="${esc(ph)}"` : ''}>${esc(v)}</textarea>`;
  function paintMeeting() {
    if (!current) return;
    const d = current, ms = d.minutes || {};
    const m = ms[view.lang];
    const both = ms.km && ms.en;
    const T = (km, en) => (view.lang === 'en' ? en : km);   // section names follow the minutes' language
    const src = `<div class="card srccard"><h2>📝 ${t('អត្ថបទពីសំឡេង', 'Transcript')}</h2>${ta('eTranscript', d.transcript || '', 14, t('មិនមានការថតសំឡេង', 'No recording'))}
        ${d.ocr ? `<h2 class="mt">🖼️ ${t('អត្ថបទពីរូបភាព', 'Text from photos')}</h2>${ta('eOcr', d.ocr, 8)}` : ''}
        ${d.notes ? `<h2 class="mt">✍️ ${t('កំណត់ចំណាំ', 'Typed notes')}</h2><div class="pre">${esc(d.notes)}</div>` : ''}
        <button type="button" class="btn" id="redo">✨ ${t('សរសេរកំណត់ហេតុឡើងវិញពីអត្ថបទនេះ', 'Rewrite the minutes from this text')}</button>
        <p class="hint">${t('កែអត្ថបទខាងលើ (ឧ. ឈ្មោះខុស) រួចចុចប៊ូតុងនេះ។', 'Fix the text above (e.g. a wrong name), then tap this button.')}</p></div>`;
    const minutes = !m ? `<div class="card"><div class="alert warn">${d.status === 'Processing' ? t('កំពុងដំណើរការ...', 'Still processing...') : t('កំណត់ហេតុមិនទាន់មាន។ ចុច "សរសេរកំណត់ហេតុឡើងវិញ"។', 'No minutes yet. Tap "Rewrite the minutes".')}</div></div>` : `
      <div class="card">
        <input class="in title" id="eTitle" value="${esc(m.title)}" aria-label="${t('ប្រធានបទ', 'Title')}">
        <div class="row3">
          <div><label class="f" for="eDate">${T('កាលបរិច្ឆេទ', 'Date')}</label><input class="in" id="eDate" value="${esc(m.meetingDate)}" placeholder="YYYY-MM-DD"></div>
          <div><label class="f" for="eTime">${T('ម៉ោង', 'Time')}</label><input class="in" id="eTime" value="${esc([m.startTime, m.duration].filter(Boolean).join(' · '))}"></div>
          <div><label class="f" for="ePlace">${T('ទីកន្លែង', 'Location')}</label><input class="in" id="ePlace" value="${esc(m.location)}"></div>
        </div>
        <label class="f" for="eWho">${T('អ្នកចូលរួម', 'Attendees')} <small class="il">${t('ម្នាក់មួយបន្ទាត់: ឈ្មោះ - តួនាទី', 'one per line: Name - Role')}</small></label>
        ${ta('eWho', m.attendees.map(a => a.name + (a.role ? ' - ' + a.role : '')).join('\n'), 3)}
      </div>
      <div class="card"><h2>${T('សេចក្តីសង្ខេប', 'Executive summary')}</h2>${ta('eSummary', m.summary, 4)}</div>
      <div class="card"><h2>${T('កិច្ចការត្រូវអនុវត្ត', 'Action items')}</h2>
        <div class="acts" id="acts">${m.actions.map((a, i) => actRow(a, i)).join('')}</div>
        <button type="button" class="btn sm" id="addAct">＋ ${t('បន្ថែមកិច្ចការ', 'Add task')}</button>
      </div>
      <div class="card"><h2>${T('កិច្ចព្រមព្រៀង និងសេចក្តីសម្រេច', 'Agreements & decisions')} <small class="il">${t('មួយបន្ទាត់ មួយចំណុច', 'one per line')}</small></h2>${ta('eDecisions', m.decisions.join('\n'), 3)}</div>
      <div class="card"><h2>${T('ចំណុចពិភាក្សាសំខាន់ៗ', 'Key discussion points')}</h2>
        <div id="topics">${m.discussion.map((g, i) => `<div class="topic"><div class="trow"><input class="in" data-topic="${i}" value="${esc(g.topic)}"><button type="button" class="btn sm" data-deltopic="${i}" aria-label="${t('លុប', 'Delete')}">✕</button></div>${ta('ePts' + i, g.points.join('\n'), 3)}</div>`).join('')}</div>
        <button type="button" class="btn sm" id="addTopic">＋ ${t('បន្ថែមប្រធានបទ', 'Add topic')}</button>
      </div>
      <div class="card"><h2>${T('ផែនការតាមដាន', 'Follow-up plan')} <small class="il">${t('មួយបន្ទាត់ មួយចំណុច', 'one per line')}</small></h2>${ta('eFollow', m.followUp.join('\n'), 3)}</div>
      <div class="card"><h2>${T('ចំណុចមិនទាន់សម្រេច', 'Open points')}</h2>${ta('eOpen', m.openPoints.join('\n'), 2)}
        <h2 class="mt">${T('ការប្រជុំបន្ទាប់', 'Next meeting')}</h2><input class="in" id="eNext" value="${esc(m.nextMeeting)}"></div>
      <div class="card"><h2>📘 ${T('ពាក្យបច្ចេកទេស', 'Glossary')} <small class="il">${t('ពាក្យ: អត្ថន័យ', 'term: meaning')}</small></h2>${ta('eGloss', m.glossary.map(g => g.term + ': ' + g.meaning).join('\n'), 3)}</div>`;
    const desk = isDesk();
    $('#view').innerHTML = `
      <div class="mhead"><a class="btn sm" href="#/">‹ ${t('ការប្រជុំ', 'Meetings')}</a><span class="mid">${esc(d.id)}</span>${chip(d.status)}<span class="saved" id="saved"></span></div>
      ${both ? `<div class="seg" id="langSeg"><button type="button" data-v="km" class="${view.lang === 'km' ? 'on' : ''}">ខ្មែរ</button><button type="button" data-v="en" class="${view.lang === 'en' ? 'on' : ''}">English</button></div>` : ''}
      ${desk ? '' : `<div class="seg" id="paneSeg"><button type="button" data-v="minutes" class="${view.pane === 'minutes' ? 'on' : ''}">${t('កំណត់ហេតុ', 'Minutes')}</button><button type="button" data-v="src" class="${view.pane === 'src' ? 'on' : ''}">${t('អត្ថបទដើម', 'Source text')}</button></div>`}
      <div class="split">
        ${desk || view.pane === 'src' ? `<section class="left">${src}</section>` : ''}
        ${desk || view.pane === 'minutes' ? `<section class="right">${minutes}
          <div class="card danger"><button type="button" class="btn" id="del">🗑️ ${t('លុបការប្រជុំនេះ', 'Delete this meeting')}</button></div></section>` : ''}
      </div>
      <div class="exportbar">
        <button type="button" class="btn ok" id="xEmail">✉️ ${t('ផ្ញើអ៊ីមែល', 'Email')}</button>
        <button type="button" class="btn" id="xWord">📄 Word</button>
        ${d.docUrl ? `<a class="btn" href="${esc(d.docUrl)}" target="_blank" rel="noopener">Google Doc</a>` : ''}
        <button type="button" class="btn" id="xCopy">📋 ${t('ចម្លង', 'Copy')}</button>
      </div>`;
    $$('#langSeg button').forEach(b => b.onclick = () => { collect(); view.lang = b.dataset.v; paintMeeting(); });
    $$('#paneSeg button').forEach(b => b.onclick = () => { collect(); view.pane = b.dataset.v; paintMeeting(); });
    $$('#view textarea.grow').forEach(grow);
    $$('#view input, #view textarea, #view select').forEach(el => { el.addEventListener('input', () => { if (el.tagName === 'TEXTAREA') grow(el); if (el.id === 'eTranscript' || el.id === 'eOcr') { dirty = true; schedule(); } else if (m) { dirty = true; schedule(); } }); el.addEventListener('change', () => { if (el.tagName === 'SELECT') { dirty = true; schedule(); } }); });
    if ($('#addAct')) $('#addAct').onclick = () => { collect(); m.actions.push({ task: '', owner: 'TBC', due: 'TBC', priority: 'Medium' }); paintMeeting(); const all = $$('[data-act-task]'); if (all.length) all[all.length - 1].focus(); };
    $$('[data-delact]').forEach(b => b.onclick = () => { collect(); m.actions.splice(+b.dataset.delact, 1); dirty = true; schedule(); paintMeeting(); });
    if ($('#addTopic')) $('#addTopic').onclick = () => { collect(); m.discussion.push({ topic: '', points: [] }); paintMeeting(); };
    $$('[data-deltopic]').forEach(b => b.onclick = () => { collect(); m.discussion.splice(+b.dataset.deltopic, 1); dirty = true; schedule(); paintMeeting(); });
    if ($('#redo')) $('#redo').onclick = redo;
    if ($('#del')) $('#del').onclick = delMeeting;
    $('#xEmail').onclick = () => { collect(); openEmail(); };
    $('#xWord').onclick = () => { collect(); downloadWord(); };
    $('#xCopy').onclick = () => { collect(); copyText(); };
    paintSaved();
  }
  const actRow = (a, i) => {
    const due = /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : '';
    const late = due && due < today() && a.status !== 'Done';
    return `<div class="act${a.status === 'Done' ? ' is-done' : ''}${late ? ' late' : ''}">
      <span class="num">${i + 1}</span>
      <textarea class="in grow" rows="1" data-act-task="${i}" placeholder="${t('កិច្ចការ', 'Task')}">${esc(a.task)}</textarea>
      <input class="in" data-act-owner="${i}" value="${esc(a.owner)}" placeholder="${t('អ្នកទទួលខុសត្រូវ', 'Owner')}" aria-label="${t('អ្នកទទួលខុសត្រូវ', 'Owner')}">
      <input class="in" type="date" data-act-due="${i}" value="${esc(due)}" aria-label="${t('ថ្ងៃកំណត់', 'Due date')}" title="${due ? '' : 'TBC'}">
      <select class="in" data-act-prio="${i}" aria-label="${t('អាទិភាព', 'Priority')}">${[['High', 'ខ្ពស់'], ['Medium', 'មធ្យម'], ['Low', 'ទាប']].map(p => `<option value="${p[0]}"${a.priority === p[0] ? ' selected' : ''}>${esc(t(p[1], p[0]))}</option>`).join('')}</select>
      <button type="button" class="btn sm" data-delact="${i}" aria-label="${t('លុប', 'Delete')}">✕</button>
      ${a.status === 'Done' ? `<span class="badge ok">✓ ${t('រួចរាល់', 'Done')}</span>` : late ? `<span class="badge bad">${t('ហួសកំណត់', 'Overdue')}</span>` : ''}</div>`;
  };
  function grow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, 1200) + 'px'; }

  /** Reads the edit boxes back into the meeting. */
  function collect() {
    if (!current) return;
    const v = id => { const el = $('#' + id); return el ? el.value : null; };
    if (v('eTranscript') != null) current.transcript = v('eTranscript');
    if (v('eOcr') != null) current.ocr = v('eOcr');
    const m = current.minutes && current.minutes[view.lang];
    if (!m || v('eTitle') == null) return;
    m.title = v('eTitle').trim();
    m.meetingDate = v('eDate').trim();
    const tm = v('eTime').split('·'); m.startTime = (tm[0] || '').trim(); m.duration = (tm[1] || '').trim();
    m.location = v('ePlace').trim();
    m.attendees = lines(v('eWho')).map(x => { const p = x.split(/\s+-\s+|\s+–\s+/); return { name: p[0].trim(), role: (p.slice(1).join(' - ') || '').trim() }; });
    m.summary = v('eSummary').trim();
    m.decisions = lines(v('eDecisions'));
    m.followUp = lines(v('eFollow'));
    m.openPoints = lines(v('eOpen'));
    m.nextMeeting = v('eNext').trim();
    m.glossary = lines(v('eGloss')).map(x => { const i = x.indexOf(':'); return i > 0 ? { term: x.slice(0, i).trim(), meaning: x.slice(i + 1).trim() } : { term: x, meaning: '' }; });
    m.actions = m.actions.map((a, i) => {
      const task = $(`[data-act-task="${i}"]`);
      if (!task) return a;
      return Object.assign({}, a, { task: task.value.trim(), owner: $(`[data-act-owner="${i}"]`).value.trim() || 'TBC', due: $(`[data-act-due="${i}"]`).value || 'TBC', priority: $(`[data-act-prio="${i}"]`).value });
    });
    m.discussion = m.discussion.map((g, i) => { const tp = $(`[data-topic="${i}"]`); return tp ? { topic: tp.value.trim(), points: lines(v('ePts' + i)) } : g; });
  }

  // Saves 1.5 s after the last change, in the background (never makes anyone wait).
  let dirty = false, saving = false, saveT = 0, savedAt = '';
  function schedule() { clearTimeout(saveT); saveT = setTimeout(saveNow, 1500); paintSaved(); }
  async function saveNow() {
    if (!current || saving) { if (saving) schedule(); return; }
    collect();
    saving = true; dirty = false; paintSaved();
    const snap = JSON.parse(JSON.stringify(current));
    set('mm_m_' + snap.id, JSON.stringify(snap));
    try {
      await api('save', { id: snap.id, minutes: snap.minutes, transcript: snap.transcript, ocr: snap.ocr });
      savedAt = nowHm();
    } catch (e) { dirty = true; toast(e.message); }
    saving = false; paintSaved();
  }
  function paintSaved() { const el = $('#saved'); if (el) el.textContent = saving ? t('កំពុងរក្សាទុក...', 'Saving...') : dirty ? t('មិនទាន់រក្សាទុក', 'Not saved yet') : savedAt ? '✓ ' + t('បានរក្សាទុក', 'Saved') + ' ' + savedAt : ''; }
  const flush = async () => { clearTimeout(saveT); if (dirty) await saveNow(); };

  async function redo() {
    collect();
    const b = $('#redo');
    b.disabled = true; b.innerHTML = '<span class="sp"></span> ' + t('កំពុងសរសេរ...', 'Writing...');
    try {
      const src = { meta: current.meta || {}, outLang: current.outLang || 'km', transcript: current.transcript || '', ocr: current.ocr || '' };
      src.meta = Object.assign({}, src.meta);
      const minutes = await writeMinutes(src, () => {});
      current.minutes = minutes; current.status = 'Done';
      await api('save', { id: current.id, minutes, transcript: current.transcript, ocr: current.ocr, status: 'Done' });
      set('mm_m_' + current.id, JSON.stringify(current));
      dirty = false; savedAt = nowHm(); view.pane = 'minutes'; pickLang(); paintMeeting();
      toast(t('បានសរសេរកំណត់ហេតុឡើងវិញ', 'Minutes rewritten'));
    } catch (e) { toast(e.message); b.disabled = false; b.textContent = t('ព្យាយាមម្តងទៀត', 'Try again'); }
  }
  async function delMeeting() {
    if (!confirm(t('លុបការប្រជុំនេះ? ឯកសារនៅក្នុង Drive នឹងទៅធុងសំរាម។', 'Delete this meeting? Its Drive folder goes to the bin.'))) return;
    try { await api('delete', { id: current.id }); set('mm_m_' + current.id, null); current = null; refreshList(); location.hash = '#/'; toast(t('បានលុប', 'Deleted')); }
    catch (e) { toast(e.message); }
  }
  const langChoice = () => (current.minutes.km && current.minutes.en ? 'both' : current.minutes.en ? 'en' : 'km');
  async function downloadWord() {
    await flush();
    const b = $('#xWord'); b.disabled = true; b.innerHTML = '<span class="sp"></span> Word';
    try {
      const r = await api('word', { id: current.id, lang: langChoice() });
      const bytes = Uint8Array.from(atob(r.b64), c => c.charCodeAt(0));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      a.download = r.name; document.body.appendChild(a); a.click(); a.remove();
      current.docUrl = r.docUrl; set('mm_m_' + current.id, JSON.stringify(current));
      paintMeeting();
    } catch (e) { toast(e.message); b.disabled = false; b.textContent = '📄 Word'; }
  }
  function plainText() {
    const out = [];
    ['km', 'en'].forEach(l => {
      const m = current.minutes && current.minutes[l];
      if (!m) return;
      const T = (km, en) => (l === 'en' ? en : km);
      out.push('📋 ' + m.title, [m.meetingDate, m.startTime, m.location].filter(Boolean).join(' · '));
      if (m.attendees.length) out.push('', T('អ្នកចូលរួម', 'Attendees') + ': ' + m.attendees.map(a => a.name).join(', '));
      out.push('', '■ ' + T('សេចក្តីសង្ខេប', 'Summary'), m.summary);
      if (m.decisions.length) out.push('', '■ ' + T('សេចក្តីសម្រេច', 'Decisions'), ...m.decisions.map(x => '• ' + x));
      if (m.actions.length) out.push('', '■ ' + T('កិច្ចការត្រូវអនុវត្ត', 'Action items'), ...m.actions.map((a, i) => (i + 1) + '. ' + a.task + ' (' + a.owner + ', ' + a.due + ')'));
      if (m.followUp.length) out.push('', '■ ' + T('ផែនការតាមដាន', 'Follow-up'), ...m.followUp.map(x => '• ' + x));
      out.push('');
    });
    return out.join('\n').trim();
  }
  async function copyText() {
    try { await navigator.clipboard.writeText(plainText()); toast(t('បានចម្លង។ អាចបិទភ្ជាប់ក្នុង Telegram បាន។', 'Copied. You can paste it in Telegram.')); }
    catch (e) { toast(t('មិនអាចចម្លងបានទេ', 'Could not copy')); }
  }

  // ----- email
  function openEmail() {
    const last = getJ('mm_mail', {});
    const choice = langChoice();
    const dlg = document.createElement('div');
    dlg.className = 'modal';
    dlg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <h2 id="mTitle">✉️ ${t('ផ្ញើកំណត់ហេតុតាមអ៊ីមែល', 'Email the minutes')}</h2>
      <div class="field"><label class="f" for="mTo">${t('ផ្ញើទៅ', 'To')}</label><textarea class="in" id="mTo" rows="2" placeholder="name@isisteel.com, ...">${esc(last.to || '')}</textarea></div>
      <div class="field"><label class="f" for="mCc">${t('ចម្លងជូន (CC)', 'CC')}</label><input class="in" id="mCc" value="${esc(last.cc || '')}"></div>
      ${choice === 'both' ? `<label class="f">${t('ភាសា', 'Language')}</label><div class="chips" id="mLang">${[['km', 'ខ្មែរ'], ['en', 'English'], ['both', t('ទាំងពីរ', 'Both')]].map(x => `<button type="button" class="chip${x[0] === 'both' ? ' on' : ''}" data-v="${x[0]}">${esc(x[1])}</button>`).join('')}</div>` : ''}
      <div class="field"><label class="f" for="mNote">${t('សារបន្ថែម (មិនបាច់ក៏បាន)', 'Message (optional)')}</label><textarea class="in" id="mNote" rows="3" placeholder="${t('ជូនចំពោះ ក្រុមការងារ...', 'Dear team, ...')}"></textarea></div>
      <p class="hint">${t('ឯកសារ Word ត្រូវបានភ្ជាប់ជាមួយអ៊ីមែល។ អ្នកទទួលអាចឆ្លើយតបមកអ៊ីមែលរបស់អ្នក។', 'The Word file is attached. Replies come to your email.')}</p>
      <div id="mErr"></div>
      <div class="row-btns"><button type="button" class="btn ok" id="mSend">${t('ផ្ញើ', 'Send')}</button><button type="button" class="btn" id="mClose">${t('បិទ', 'Close')}</button></div></div>`;
    document.body.appendChild(dlg);
    let lang = choice;
    $$('#mLang .chip').forEach(b => b.onclick = () => { lang = b.dataset.v; $$('#mLang .chip').forEach(x => x.classList.toggle('on', x === b)); });
    const close = () => dlg.remove();
    $('#mClose').onclick = close;
    dlg.onclick = e => { if (e.target === dlg) close(); };
    $('#mTo').focus();
    $('#mSend').onclick = async () => {
      const b = $('#mSend');
      const to = $('#mTo').value.trim(), cc = $('#mCc').value.trim();
      if (!to) { $('#mErr').innerHTML = `<div class="alert bad">${t('សូមបញ្ចូលអ៊ីមែលអ្នកទទួល។', 'Add at least one email address.')}</div>`; return; }
      b.disabled = true; b.innerHTML = '<span class="sp"></span> ' + t('កំពុងផ្ញើ...', 'Sending...');
      try {
        await flush();
        const r = await api('email', { id: current.id, to, cc, lang, note: $('#mNote').value.trim() });
        set('mm_mail', JSON.stringify({ to, cc }));
        current.docUrl = r.docUrl;
        close();
        toast(t('បានផ្ញើអ៊ីមែលទៅ ' + r.sent + ' នាក់', 'Email sent to ' + r.sent + (r.sent > 1 ? ' people' : ' person')));
        paintMeeting();
      } catch (e) { $('#mErr').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; b.disabled = false; b.textContent = t('ផ្ញើ', 'Send'); }
    };
  }

  // ----- tasks across all meetings
  let tasks = getJ('mm_tasks', null);
  async function renderTasks() {
    screen = paintTasks;
    paintTasks();
    try { tasks = await api('tasks'); set('mm_tasks', JSON.stringify(tasks)); if (location.hash === '#/tasks') paintTasks(); }
    catch (e) { if (!tasks) $('#view').innerHTML = `<div class="card"><div class="alert bad">${esc(e.message)}</div></div>`; }
  }
  function paintTasks() {
    if (!tasks) { $('#view').innerHTML = '<div class="spinner"></div>'; return; }
    const open = tasks.filter(x => x.status !== 'Done').sort((a, b) => String(a.due === 'TBC' ? '9' : a.due).localeCompare(String(b.due === 'TBC' ? '9' : b.due)));
    const done = tasks.filter(x => x.status === 'Done');
    const row = x => {
      const late = /^\d{4}-\d{2}-\d{2}$/.test(x.due) && x.due < today() && x.status !== 'Done';
      return `<div class="item task${x.status === 'Done' ? ' is-done' : ''}">
        <label class="tick"><input type="checkbox" data-id="${esc(x.id)}" data-no="${esc(x.no)}" ${x.status === 'Done' ? 'checked' : ''}><span></span></label>
        <div class="tb"><b>${esc(x.task)}</b><div class="meta">👤 ${esc(x.owner || 'TBC')} · 📅 <span class="${late ? 'late' : ''}">${esc(x.due || 'TBC')}</span>${late ? ` <span class="badge bad">${t('ហួសកំណត់', 'Overdue')}</span>` : ''}</div>
        <a class="from" href="#/m/${encodeURIComponent(x.id)}">${esc(x.title || x.id)}</a></div></div>`;
    };
    $('#view').innerHTML = `<div class="head2"><h2>${t('កិច្ចការនៅសល់', 'Open tasks')} (${open.length})</h2></div>
      <div class="list">${open.map(row).join('') || `<div class="empty">🎉 ${t('គ្មានកិច្ចការនៅសល់ទេ', 'No open tasks')}</div>`}</div>
      ${done.length ? `<details class="donebox"><summary>${t('រួចរាល់ក្នុង 30 ថ្ងៃចុងក្រោយ', 'Done in the last 30 days')} (${done.length})</summary><div class="list">${done.map(row).join('')}</div></details>` : ''}`;
    $$('.tick input').forEach(cb => cb.onchange = async () => {
      const x = tasks.find(y => y.id === cb.dataset.id && String(y.no) === cb.dataset.no);
      const prev = x.status;
      x.status = cb.checked ? 'Done' : 'Open'; x.done = cb.checked ? today() : '';
      set('mm_tasks', JSON.stringify(tasks)); paintTasks();
      try { await api('taskSet', { id: x.id, no: x.no, status: x.status }); set('mm_m_' + x.id, null); }
      catch (e) { x.status = prev; set('mm_tasks', JSON.stringify(tasks)); paintTasks(); toast(e.message); }
    });
  }

  // ---------------------------------------------------------------- start
  // quiet = background refresh: redraws the list only when it changed, and keeps the scroll position
  async function refreshList(quiet) {
    quiet = quiet === true;
    try {
      const d = await api(boot ? 'list' : 'boot');
      if (quiet && Array.isArray(d) && boot && JSON.stringify(d) === JSON.stringify(boot.recent)) return;
      if (Array.isArray(d)) boot = Object.assign({}, boot, { recent: d });
      else { boot = d; if (d.ticket) { ticket = { v: d.ticket, until: Date.now() + 11 * 3600000, email: myEmail() }; set('mm_ticket', JSON.stringify(ticket)); } }
      set('mm_boot_' + myEmail(), JSON.stringify(boot));
      if (location.hash === '' || location.hash === '#/' || location.hash === '#') { if (quiet) LIVE.keep(renderHome); else renderHome(); }
    } catch (e) {
      if (e.code === 'AUTH' || e.code === 'NOACCESS') return showBlocked(e);
      if (quiet) throw e;
      if (!boot && (location.hash === '' || location.hash === '#/')) $('#list').innerHTML = `<div class="alert bad">${esc(e.message)}</div>`;
    }
  }
  function showBlocked(e) {
    $('#view').innerHTML = `<div class="card done"><div class="emoji">🔒</div><h2>${e.code === 'AUTH' ? t('សូមចូលគណនីនៅទំព័រដើម', 'Please sign in on the home menu') : t('មិនទាន់មានសិទ្ធិ', 'No access yet')}</h2>
      <p>${esc(e.message)}</p><a class="btn ok" href="../">${t('ទៅទំព័រដើម', 'Go to the home menu')}</a></div>`;
  }

  if (DEMO) { $('#demo').hidden = false; $('#demo').textContent = t('DEMO · ឧទាហរណ៍ប៉ុណ្ណោះ AI និងទិន្នន័យមិនពិតប្រាកដ', 'DEMO · sample only, the AI and saving are simulated'); }
  if (window.LANG) { LANG.button($('#langBtn')); LANG.onChange(() => { $$('[data-km]').forEach(el => { el.textContent = t(el.dataset.km, el.dataset.en); }); collect(); screen(); }); }
  $$('[data-km]').forEach(el => { el.textContent = t(el.dataset.km, el.dataset.en); });
  const prefersDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const paintTheme = () => { const th = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); $('#themeBtn').textContent = th === 'dark' ? '☀️' : '🌙'; };
  $('#themeBtn').onclick = () => { const now = document.documentElement.getAttribute('data-theme') || (prefersDark() ? 'dark' : 'light'); const next = now === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', next); set('fr_theme', next); paintTheme(); };
  paintTheme();
  window.ISTEEL_REFRESH = () => { if (rec.on || running) return; refreshList(); if (/^#\/(m\/|tasks)/.test(location.hash)) route(); };
  let lastW = isDesk();
  window.addEventListener('resize', () => { if (isDesk() !== lastW) { lastW = isDesk(); if (/^#\/m\//.test(location.hash)) { collect(); paintMeeting(); } } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  // the meetings list refreshes in the background every minute (not while recording or the AI is working)
  if (window.LIVE && !DEMO) LIVE.start({ run: () => refreshList(true), busy: () => rec.on || running || !/^(#\/?)?$/.test(location.hash) });

  if (!DEMO && !signedIn()) showBlocked({ code: 'AUTH', message: t('ការចូលគណនីត្រូវធ្វើនៅទំព័រដើម STEEL។', 'Sign in once on the STEEL home menu, then come back.') });
  else { route(); refreshList(); }

  // ---------------------------------------------------------------- demo (no API_URL in config.js)
  function demoApi(action, p) {
    const db = getJ('mm_demo_db', { meetings: {}, n: 0 });
    const keep = () => set('mm_demo_db', JSON.stringify(db));
    const summary = d => { const m = d.minutes && (d.minutes[d.outLang === 'en' ? 'en' : 'km'] || d.minutes.en || d.minutes.km) || {}; return { id: d.id, title: m.title || (d.meta || {}).title || '', date: m.meetingDate || (d.meta || {}).date || '', time: m.startTime || (d.meta || {}).time || '', status: d.status, summary: String(m.summary || '').slice(0, 220), open: (m.actions || []).filter(a => a.status !== 'Done').length, created: d.created }; };
    return new Promise(r => setTimeout(r, 250)).then(() => {
      if (action === 'boot' || action === 'list') {
        if (!db.n) { db.n = 1; db.meetings['MM-DEMO-001'] = demoMeeting(); keep(); }
        const list = Object.values(db.meetings).reverse().map(summary);
        return action === 'list' ? list : { user: { name: 'Demo', email: 'demo', admin: true }, ticket: 'demo', recent: list };
      }
      if (action === 'ticket') return { ticket: 'demo' };
      if (action === 'save') {
        const id = p.id || 'MM-DEMO-' + String(++db.n).padStart(3, '0');
        const d = db.meetings[id] || { id, created: today() + ' ' + nowHm() };
        Object.keys(p).forEach(k => { if (p[k] !== undefined && k !== 'id') d[k] = p[k]; });
        db.meetings[id] = d; keep();
        return { id, updated: nowHm() };
      }
      if (action === 'get') { const d = db.meetings[p.id]; if (!d) throw Object.assign(new Error('Not found'), { code: 'NOTFOUND' }); return d; }
      if (action === 'attach') return { fileId: 'x' };
      if (action === 'delete') { delete db.meetings[p.id]; keep(); return {}; }
      if (action === 'word') throw new Error(t('Word មានតែពេលភ្ជាប់ជាមួយ Google Sheet ពិតប្រាកដ។', 'Word works once the app is connected to the real Google Sheet.'));
      if (action === 'email') return { sent: String(p.to).split(/[,;\s]+/).filter(Boolean).length, docUrl: '' };
      if (action === 'tasks') {
        const out = [];
        Object.values(db.meetings).forEach(d => { const m = d.minutes && (d.minutes.km || d.minutes.en); if (m) m.actions.forEach((a, i) => out.push({ id: d.id, no: String(i + 1), task: a.task, owner: a.owner, due: a.due, status: a.status || 'Open', title: m.title })); });
        return out;
      }
      if (action === 'taskSet') { const d = db.meetings[p.id]; ['km', 'en'].forEach(l => { const m = d.minutes && d.minutes[l]; if (m && m.actions[p.no - 1]) m.actions[p.no - 1].status = p.status; }); keep(); return { status: p.status }; }
      throw new Error('Unknown action');
    });
  }
  async function demoUpload(file, onProgress) {
    for (let i = 1; i <= 5; i++) { await new Promise(r => setTimeout(r, 120)); onProgress(i / 5); }
    return { uri: 'demo://' + file.name, mimeType: file.type };
  }
  async function demoGenerate(p, onText) {
    const out = p.kind === 'transcribe' ? DEMO_TRANSCRIPT : p.kind === 'ocr' ? '=== File 1 ===\nAgenda: 1) 3PL delivery complaints 2) Gate queue 3) Fuel app rollout'
      : JSON.stringify(demoMeeting().minutes[p.outLang === 'en' ? 'en' : 'km']);
    let s = '';
    for (let i = 0; i < out.length; i += 40) { s = out.slice(0, i + 40); onText(s); await new Promise(r => setTimeout(r, 15)); }
    return { text: out, finish: 'STOP', model: 'demo' };
  }
  const DEMO_TRANSCRIPT = '[00:00] Speaker 1: អរុណសួស្តីទាំងអស់គ្នា។ ថ្ងៃនេះយើងពិភាក្សាបីចំណុច៖ បណ្តឹងអតិថិជនពី 3PL, ជួរឡានដឹកនៅ Gate 2, និង Fuel app។\n' +
    '[00:42] Speaker 2: សប្តាហ៍នេះ យើងទទួលបណ្តឹងបួនដងពីអតិថិជន ថាតៃកុង 3PL មិនជួយលើកទំនិញ។\n[01:30] Speaker 1: OK, let\'s ask the 3PL to train drivers before 30 October.\n' +
    '[02:15] Speaker 3: ឡានរង់ចាំនៅ Gate 2 ជាមធ្យម 2 ម៉ោង ព្រោះ DN មិនទាន់ print។\n[03:05] Speaker 1: យើងសម្រេចឲ្យ Logistics print DN មុនម៉ោង 7 ព្រឹក ចាប់ពីថ្ងៃច័ន្ទ។';
  function demoMeeting() {
    const acts = [
      { task: 'ស្នើ 3PL បណ្តុះបណ្តាលតៃកុងអំពីសេវាអតិថិជន', owner: 'Transport Supervisor', due: '2026-10-30', priority: 'High' },
      { task: 'Print DN មុនម៉ោង 7 ព្រឹក រៀងរាល់ថ្ងៃ', owner: 'Logistics team', due: '2026-10-26', priority: 'High' },
      { task: 'ផ្ញើរបាយការណ៍ពេលរង់ចាំនៅ Gate 2 ប្រចាំសប្តាហ៍', owner: 'TBC', due: 'TBC', priority: 'Medium' },
    ];
    const km = { title: 'ប្រជុំប្រចាំសប្តាហ៍ ឃ្លាំង និងដឹកជញ្ជូន (ឧទាហរណ៍)', meetingDate: today(), startTime: '09:00', duration: '45 នាទី', location: 'បន្ទប់ប្រជុំ ឃ្លាំង', chair: 'Kim',
      attendees: [{ name: 'Kim', role: 'W&L Manager' }, { name: 'Speaker 2', role: 'Transport' }, { name: 'Speaker 3', role: 'Gate / Security' }],
      summary: 'ការប្រជុំបានពិភាក្សាអំពីបណ្តឹងអតិថិជនលើសេវាតៃកុង 3PL និងការរង់ចាំយូរនៅ Gate 2។ បានសម្រេចឲ្យ Logistics print DN មុនម៉ោង 7 ព្រឹក និងស្នើ 3PL បណ្តុះបណ្តាលតៃកុង។',
      discussion: [{ topic: 'បណ្តឹងអតិថិជនពី 3PL', points: ['បណ្តឹង 4 ដងក្នុងសប្តាហ៍នេះ', 'តៃកុងមិនជួយលើកទំនិញ'] }, { topic: 'ជួរឡាននៅ Gate 2', points: ['រង់ចាំជាមធ្យម 2 ម៉ោង', 'មូលហេតុ៖ DN មិនទាន់ print'] }],
      decisions: ['Logistics print DN មុនម៉ោង 7 ព្រឹក ចាប់ពីថ្ងៃច័ន្ទ'], actions: acts,
      followUp: ['ពិនិត្យពេលរង់ចាំនៅ Gate 2 ក្នុងប្រជុំសប្តាហ៍ក្រោយ'], openPoints: ['តើ Fuel app ត្រូវដាក់ឲ្យប្រើនៅសាខាពេលណា?'], nextMeeting: 'ថ្ងៃច័ន្ទក្រោយ ម៉ោង 9:00',
      glossary: [{ term: '3PL', meaning: 'ក្រុមហ៊ុនដឹកជញ្ជូនខាងក្រៅ (Third-party logistics)' }, { term: 'DN', meaning: 'Delivery Note: ឯកសារដឹកជញ្ជូនពី SAP' }] };
    const en = Object.assign({}, km, { title: 'Weekly Warehouse & Logistics meeting (sample)', duration: '45 min', location: 'WH meeting room',
      summary: 'The meeting covered customer complaints about 3PL drivers and long waits at Gate 2. Logistics will print DNs before 7 am, and the 3PL will be asked to train drivers.',
      discussion: [{ topic: '3PL customer complaints', points: ['4 complaints this week', 'Drivers do not help unload'] }, { topic: 'Gate 2 queue', points: ['Average wait 2 hours', 'Cause: DNs not printed yet'] }],
      decisions: ['Logistics prints DNs before 7 am from Monday'],
      actions: [{ task: 'Ask the 3PL to train drivers on customer service', owner: 'Transport Supervisor', due: '2026-10-30', priority: 'High' }, { task: 'Print DNs before 7 am every day', owner: 'Logistics team', due: '2026-10-26', priority: 'High' }, { task: 'Send a weekly Gate 2 waiting time report', owner: 'TBC', due: 'TBC', priority: 'Medium' }],
      followUp: ['Review Gate 2 waiting time at next week\'s meeting'], openPoints: ['When does the Fuel app go live at the branches?'], nextMeeting: 'Next Monday 9:00',
      glossary: [{ term: '3PL', meaning: 'Third-party logistics: an outside transport company' }, { term: 'DN', meaning: 'Delivery Note: the SAP delivery document' }] });
    return { id: 'MM-DEMO-001', status: 'Done', created: today() + ' 09:50', meta: { title: km.title }, lang: 'auto', outLang: 'both', transcript: DEMO_TRANSCRIPT, ocr: '', minutes: { km, en } };
  }
})();
