/**
 * Sign in with Employee ID + password (Kim, 28 Nov 2026), under the Google button on a sign-in screen.
 * For staff without a Gmail: the admin sets the password in 👥 Users. The server (Fuel Code.gs, action pwLogin) checks it
 * and sends back the same 30-day session as a Google sign-in, so every app opens with it.
 *   ID_LOGIN.mount(element, { url: API_URL, done: token => { … save it and open the app … } })
 */
(function () {
  const T = (km, en) => (window.LANG ? LANG.t(km, en) : km);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function css() {
    if (document.getElementById('idlCss')) return;
    const st = document.createElement('style');
    st.id = 'idlCss';
    st.textContent = '.idl{max-width:340px;margin:14px auto 0;text-align:left}' +
      '.idl-or{display:flex;align-items:center;gap:10px;color:var(--muted,#7a8799);font-size:13px;margin:0 0 12px}.idl-or:before,.idl-or:after{content:"";flex:1;height:1px;background:var(--line,#d6dee8)}' +
      '.idl label{display:block;font-weight:600;font-size:14px;margin:0 0 10px}' +
      '.idl input{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:12px;border:1.5px solid var(--line,#cfd8e3);border-radius:12px;font:inherit;font-size:16px;background:#fff;color:#011e41}' +
      '.idl input:focus{outline:none;border-color:var(--accent,#0b76a0);box-shadow:0 0 0 3px rgba(11,118,160,.18)}' +
      '.idl .pw{position:relative}.idl .pw input{padding-right:46px}.idl .eye{position:absolute;right:6px;bottom:6px;width:36px;height:36px;border:0;background:none;font-size:17px;cursor:pointer;color:#011e41}' +
      '.idl .go{display:block;width:100%;margin-top:4px;padding:13px;border:0;border-radius:12px;background:#011e41;color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer}' +
      '.idl .go:disabled{opacity:.6;cursor:default}:root[data-theme="dark"] .idl .go{background:#1d4f86}' +
      '.idl .err{color:var(--bad,#b3261e);background:var(--bad-soft,#fbe9e7);border-radius:10px;padding:8px 10px;font-size:13.5px;margin:0 0 10px}' +
      '.idl .note{text-align:center;font-size:13px;color:var(--muted,#7a8799);margin-top:10px}';
    document.head.appendChild(st);
  }
  function mount(el, opt) {
    if (!el) return;
    css();
    let showPw = false;
    const draw = (id, msg) => {
      el.innerHTML = `<form class="idl" autocomplete="on" novalidate>
        <div class="idl-or">${T('ឬ', 'or')}</div>
        ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
        <label>${T('លេខសម្គាល់បុគ្គលិក (Employee ID)', 'Employee ID')}<input name="username" id="idlId" inputmode="numeric" autocomplete="username" value="${esc(id || '')}"></label>
        <label>${T('ពាក្យសម្ងាត់', 'Password')}<span class="pw"><input name="password" id="idlPw" type="${showPw ? 'text' : 'password'}" autocomplete="current-password">
          <button type="button" class="eye" id="idlEye" aria-label="${T('បង្ហាញពាក្យសម្ងាត់', 'Show password')}">${showPw ? '🙈' : '👁'}</button></span></label>
        <button type="submit" class="go" id="idlGo">🔑 ${T('ចូល', 'Sign in')}</button>
        <div class="note">${T('ភ្លេចពាក្យសម្ងាត់? សូមសួរ Admin', 'Forgot your password? Ask the admin')}</div></form>`;
      const f = el.querySelector('form'), idIn = el.querySelector('#idlId'), pwIn = el.querySelector('#idlPw');
      idIn.oninput = () => { idIn.value = idIn.value.replace(/[០-៩]/g, d => String('០១២៣៤៥៦៧៨៩'.indexOf(d))).replace(/\D+/g, ''); };
      el.querySelector('#idlEye').onclick = () => { showPw = !showPw; const v = pwIn.value; draw(idIn.value, ''); el.querySelector('#idlPw').value = v; };
      f.onsubmit = async e => {
        e.preventDefault();
        const id = idIn.value.trim(), pw = pwIn.value;
        if (!id || !pw) { draw(id, T('សូមបញ្ចូល Employee ID និងពាក្យសម្ងាត់', 'Type your Employee ID and password')); return; }
        const go = el.querySelector('#idlGo');
        go.disabled = true; go.textContent = '⏳ ' + T('កំពុងចូល…', 'Signing in…');
        let data = null;
        try {
          const res = await fetch(opt.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'pwLogin', payload: { id, pw } }) });
          data = await res.json();
        } catch (err) { draw(id, T('មិនអាចភ្ជាប់អ៊ីនធឺណិត។ សូមព្យាយាមម្តងទៀត។', 'No connection. Please try again.')); return; }
        if (!data || !data.ok || !data.data || !data.data.session) {
          const m = String((data && data.error) || 'Error').split(' / ');
          draw(id, m.length > 1 ? T(m[1], m[0]) : m[0]);
          return;
        }
        opt.done(data.data.session);
      };
    };
    draw('', '');
  }
  // ---------------------------------------------------------------- poster sign-in screen
  // Kim, 28 Nov 2026: the ISI poster as the whole sign-in screen, with Google + Employee ID over its empty blue panel.
  // An admin can upload another picture in 👥 Users › 🖼; phones keep it (idl_bg) and fetch it again only when it changes.
  const BG_KEY = 'idl_bg';
  const DEF = { v: '', pos: 'left', w: 1638, h: 2048, src: new URL('icons/login-bg.jpg', (document.currentScript || {}).src || location.href).href, panel: 872 / 1638, top: 0.515, fill: '#014898' };
  let bg = null;
  const readBg = () => { try { const b = JSON.parse(localStorage.getItem(BG_KEY) || 'null'); return b && b.dataUrl ? b : null; } catch (e) { return null; } };
  const cur = () => {
    const b = bg || readBg();
    return b ? { v: b.v, pos: b.pos || 'left', w: b.w || 1600, h: b.h || 2000, src: b.dataUrl, panel: 0.55, top: -1, fill: '#0b1d3a', custom: true } : DEF;
  };
  function posterCss() {
    if (document.getElementById('idlpCss')) return;
    const st = document.createElement('style');
    st.id = 'idlpCss';
    st.textContent = '.idlp{position:fixed;left:0;right:0;bottom:0;top:0;z-index:40;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch}' +
      '.idlp-box{position:absolute;top:0;background:center/100% 100% no-repeat}' +
      '.idlp-f{position:absolute;color:#fff}.idlp-f.mid{transform:translateY(-50%)}.idlp-f.card{background:rgba(1,30,65,.55);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border-radius:18px;padding:18px}' +
      '.idlp .idl{max-width:none;margin:0}.idlp .idl-or{color:rgba(255,255,255,.85)}.idlp .idl-or:before,.idlp .idl-or:after{background:rgba(255,255,255,.45)}' +
      '.idlp .idl label{color:#fff}.idlp .idl input{border-color:transparent}.idlp .idl .note{color:rgba(255,255,255,.85)}' +
      '.idlp .idl .go{background:#fff;color:#011e41}:root[data-theme="dark"] .idlp .idl .go{background:#fff}' +
      '.idlp .idl .err{background:#fff}.idlp-g{min-height:44px;display:flex;justify-content:center;margin-bottom:14px}.idlp-x .alert{margin:0 0 10px}';
    document.head.appendChild(st);
  }
  function fit() {
    const o = document.getElementById('idlp');
    if (!o) { removeEventListener('resize', fit); return; }
    const bar = document.querySelector('header.bar, header.topbar, .topbar, header');
    o.style.top = (bar && bar.offsetParent !== null ? Math.max(0, bar.getBoundingClientRect().bottom) : 0) + 'px';
    const c = cur(), box = o.querySelector('.idlp-box'), f = o.querySelector('.idlp-f');
    const W = o.clientWidth, H = o.clientHeight, ar = c.w / c.h, phone = W < 700;
    o.style.background = c.fill;
    box.style.backgroundImage = 'url("' + c.src + '")';
    let bw, bh, left;
    if (c.pos === 'center') { bw = Math.max(W, H * ar); bh = bw / ar; left = (W - bw) / 2; }
    else if (phone) { bw = Math.max(H * ar, W / c.panel * 0.86); bh = bw / ar; left = c.pos === 'right' ? W - bw : 0; }
    else { bh = Math.max(H, 700); bw = bh * ar; if (bw > W) { bw = W; bh = bw / ar; } left = (W - bw) / 2; }
    Object.assign(box.style, { width: bw + 'px', height: bh + 'px', left: left + 'px' });
    f.className = 'idlp-f';
    let fw, fx, fy;
    if (c.pos === 'center') {
      fw = Math.min(360, W - 32); fx = (bw - fw) / 2; fy = Math.max(16, (Math.min(H, bh) - 430) / 2); f.classList.add('card');
    } else {
      const px = c.pos === 'right' ? 1 - c.panel : 0;
      fw = Math.max(Math.min(280, W - 32), (c.panel - 0.066) * bw); fx = (px + 0.044) * bw;
      if (phone) fx = Math.min(Math.max(fx, -left + 16), -left + W - 16 - fw);
      if (c.top >= 0) fy = c.top * bh; else { fy = Math.min(H, bh) / 2; f.classList.add('mid', 'card'); }
    }
    Object.assign(f.style, { width: fw + 'px', left: fx + 'px', top: fy + 'px' });
  }
  /** The poster sign-in screen inside `host`. opt: { url, done, html (extra lines above the buttons) }. Google goes in #gsiButton. */
  function poster(host, opt) {
    css(); posterCss();
    host.insertAdjacentHTML('beforeend', `<div class="idlp" id="idlp"><div class="idlp-box"><div class="idlp-f">
      <div class="idlp-x">${opt.html || ''}</div><div class="idlp-g" id="gsiButton"></div><div id="idLogin"></div></div></div></div>`);
    if (opt.url) mount(document.getElementById('idLogin'), opt);
    fit();
    addEventListener('resize', fit);
    if (!opt.url) return;
    const had = readBg();
    fetch(opt.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'loginBg', payload: { v: had ? had.v : '' } }) })
      .then(r => r.json()).then(d => {
        if (!d || !d.ok || !d.data) return;   // old Code.gs: keep the default
        const n = d.data;
        if (!n.v) { bg = null; try { localStorage.removeItem(BG_KEY); } catch (e) { /* ignore */ } }
        else if (n.dataUrl) { bg = n; try { localStorage.setItem(BG_KEY, JSON.stringify(n)); } catch (e) { /* too big to keep: shown this time */ } }
        else if (had) { bg = Object.assign({}, had, { pos: n.pos, w: n.w || had.w, h: n.h || had.h }); try { localStorage.setItem(BG_KEY, JSON.stringify(bg)); } catch (e) { /* ignore */ } }
        fit();
      }).catch(() => { /* offline: keep what we have */ });
  }
  /** Width for the Google button so it lines up with the boxes below it. */
  const width = () => { const f = document.querySelector('.idlp-f'); return f ? Math.round(Math.min(400, f.clientWidth - (f.classList.contains('card') ? 36 : 0))) : 300; };
  window.ID_LOGIN = { mount, poster, width };
})();
