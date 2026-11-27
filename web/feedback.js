/**
 * 💬 Comment on the live site (Kim, 27 Nov 2026), in every app; admins only.
 * Tap 💬, tap the spot, type the comment: the page, the spot and a screenshot (red circle on the spot) are saved
 * to the Feedback tab of the Fuel Refill sheet (Code.gs fbSave). Claude reads that tab when Kim says "do the comments".
 * Loaded by view-mode.js, so no app needs its own copy.
 */
(function () {
  if (window.ISTEEL_FB) return;
  window.ISTEEL_FB = true;
  const BASE = new URL('.', (document.currentScript && document.currentScript.src) || location.href).href;   // .../web/
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } };
  const T = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const me = (() => { try { return JSON.parse(get('steel_me') || 'null'); } catch (e) { return null; } })();
  if (!me || me.role !== 'admin') return;   // the home menu saves the role

  const APP = (location.pathname.replace(/\/index\.html$/, '/').split('/').filter(Boolean)[0]) || 'home';
  const load = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  const apiUrl = async () => {
    if (!(window.APP_CONFIG && APP_CONFIG.API_URL)) await load(BASE + 'config.js').catch(() => {});
    return window.APP_CONFIG && APP_CONFIG.API_URL;
  };

  const st = document.createElement('style');
  st.textContent =
    '#fbBtn{position:fixed;left:12px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:2147483000;width:46px;height:46px;border-radius:50%;border:0;' +
    'background:#e53935;color:#fff;font-size:21px;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer;display:grid;place-items:center}' +
    '#fbBtn .n{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#011e41;color:#fff;font:700 11px/18px system-ui,sans-serif;padding:0 4px}' +
    '#fbPick{position:fixed;inset:0;z-index:2147483001;cursor:crosshair;background:rgba(229,57,53,.08)}' +
    '#fbPick .bar,#fbBox .card{font-family:inherit}' +
    '#fbPick .bar{position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top));transform:translateX(-50%);background:#011e41;color:#fff;border-radius:999px;' +
    'padding:8px 8px 8px 16px;display:flex;gap:10px;align-items:center;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.3);white-space:nowrap}' +
    '#fbPick .bar button{border:0;border-radius:999px;background:#fff;color:#011e41;font:inherit;font-weight:700;padding:5px 12px;cursor:pointer}' +
    '#fbDot{position:fixed;z-index:2147483002;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid #e53935;border-radius:50%;pointer-events:none;box-shadow:0 0 0 4px rgba(229,57,53,.25)}' +
    '#fbBox{position:fixed;inset:0;z-index:2147483003;background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center}' +
    '#fbBox .card{width:min(520px,100%);background:#fff;color:#011e41;border-radius:18px 18px 0 0;padding:14px 14px calc(14px + env(safe-area-inset-bottom));box-shadow:0 -8px 30px rgba(0,0,0,.25)}' +
    '#fbBox h3{margin:0 0 6px;font-size:16px}#fbBox small{color:#5b6b7f;display:block;margin-bottom:8px;word-break:break-all}' +
    '#fbBox textarea{width:100%;box-sizing:border-box;min-height:96px;border:2px solid #0b76a0;border-radius:12px;padding:10px;font:inherit;font-size:15px;color:#011e41;background:#fff}' +
    '#fbBox .row{display:flex;gap:8px;margin-top:10px}#fbBox .row button{flex:1;height:46px;border-radius:12px;border:1px solid #cfd8e3;background:#fff;color:#011e41;font:inherit;font-weight:700;font-size:15px;cursor:pointer}' +
    '#fbBox .row .go{background:#1e7b46;border-color:#1e7b46;color:#fff}#fbBox .row .go:disabled{opacity:.6}' +
    '#fbBox img{display:block;max-width:100%;max-height:150px;margin:0 auto 8px;border-radius:8px;border:1px solid #dde4ee}' +
    '#fbToast{position:fixed;left:50%;bottom:calc(140px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483004;background:#011e41;color:#fff;border-radius:999px;padding:8px 16px;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.3)}' +
    '@media print{#fbBtn{display:none}}';
  document.head.appendChild(st);

  const toast = s => { let e = document.getElementById('fbToast'); if (!e) { e = document.createElement('div'); e.id = 'fbToast'; document.body.appendChild(e); } e.textContent = s; clearTimeout(e._t); e._t = setTimeout(() => e.remove(), 3500); };
  const sent = () => +(get('isteel_fb_n') || 0);

  function button() {
    if (document.getElementById('fbBtn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'fbBtn'; b.title = T('បញ្ចេញមតិលើទំព័រនេះ', 'Comment on this page'); b.setAttribute('aria-label', b.title);
    b.innerHTML = '💬' + (sent() ? '<span class="n">' + sent() + '</span>' : '');
    b.onclick = pick;
    document.body.appendChild(b);
  }

  function pick() {
    const o = document.createElement('div');
    o.id = 'fbPick';
    o.innerHTML = '<div class="bar">👆 ' + T('ចុចលើកន្លែងដែលចង់បញ្ចេញមតិ', 'Tap the spot to comment on') + ' <button type="button">✕</button></div>';
    o.querySelector('button').onclick = e => { e.stopPropagation(); o.remove(); };
    o.onclick = e => {
      if (e.target.closest('.bar')) return;
      const x = e.clientX, y = e.clientY;
      o.remove();
      const el = document.elementFromPoint(x, y);
      const dot = document.createElement('div'); dot.id = 'fbDot'; dot.style.left = x + 'px'; dot.style.top = y + 'px';
      document.body.appendChild(dot);
      write(x, y, el, dot);
    };
    document.body.appendChild(o);
  }

  // screenshot of what is on screen, with the red circle drawn on the spot
  async function shot(x, y) {
    try {
      if (!window.html2canvas) await load(BASE + 'vendor/html2canvas.min.js');
      const w = innerWidth, h = innerHeight, sc = Math.min(1.5, 1100 / Math.max(w, h));
      const c = await html2canvas(document.body, { x: scrollX, y: scrollY, width: w, height: h, windowWidth: document.documentElement.clientWidth,
        scale: sc, logging: false, useCORS: true, backgroundColor: getComputedStyle(document.body).backgroundColor || '#fff',
        ignoreElements: el => el.id === 'fbBtn' || el.id === 'fbDot' || el.id === 'fbBox' || el.id === 'fbToast' });
      const g = c.getContext('2d');
      g.strokeStyle = '#e53935'; g.lineWidth = Math.max(3, 4 * sc);
      g.beginPath(); g.arc(x * sc, y * sc, 22 * sc, 0, Math.PI * 2); g.stroke();
      return c.toDataURL('image/jpeg', 0.7);
    } catch (e) { return ''; }
  }

  async function write(x, y, el, dot) {
    const img = await shot(x, y);
    const target = el ? String(el.innerText || el.value || el.getAttribute('aria-label') || el.placeholder || el.alt || el.tagName || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    const box = document.createElement('div');
    box.id = 'fbBox';
    box.innerHTML = '<div class="card"><h3>💬 ' + T('មតិលើទំព័រនេះ', 'Comment on this page') + '</h3>' +
      '<small>' + esc(APP + ' · ' + (location.hash || location.pathname)) + (target ? ' · “' + esc(target.slice(0, 60)) + '”' : '') + '</small>' +
      (img ? '<img alt="">' : '') +
      '<textarea placeholder="' + esc(T('សរសេរអ្វីដែលចង់ឲ្យកែ…', 'What should change here…')) + '"></textarea>' +
      '<div class="row"><button type="button" class="no">' + T('បោះបង់', 'Cancel') + '</button><button type="button" class="go">' + T('ផ្ញើ', 'Send') + '</button></div></div>';
    if (img) box.querySelector('img').src = img;
    const ta = box.querySelector('textarea'), go = box.querySelector('.go');
    const close = () => { box.remove(); dot.remove(); };
    box.querySelector('.no').onclick = close;
    box.onclick = e => { if (e.target === box) close(); };
    go.onclick = async () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      go.disabled = true; go.textContent = '…';
      try {
        const url = await apiUrl();
        if (!url) throw new Error('No API');
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'fbSave', token: get('fr_id_token'), payload: { app: APP, url: location.href, x: Math.round(x / innerWidth * 100), y: Math.round(y / innerHeight * 100),
            screen: innerWidth + 'x' + innerHeight, target: target, text: text, shot: img } }) });
        const d = await res.json();
        if (!d.ok) throw new Error(/Unknown action/i.test(d.error) ? T('សូម paste Code.gs ថ្មី', 'Re-paste Code.gs first') : String(d.error).replace(/^[A-Z_]+:\s*/, ''));
        if (d.session) set('fr_id_token', d.session);
        close(); set('isteel_fb_n', String(sent() + 1));
        const b = document.getElementById('fbBtn'); if (b) b.remove(); button();
        toast('✅ ' + T('បានរក្សាទុកមតិ ', 'Comment saved ') + (d.data && d.data.id || ''));
      } catch (e) { go.disabled = false; go.textContent = T('ផ្ញើ', 'Send'); toast('⚠️ ' + e.message); }
    };
    document.body.appendChild(box);
    setTimeout(() => ta.focus(), 50);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  if (document.body) button(); else document.addEventListener('DOMContentLoaded', button);
})();
